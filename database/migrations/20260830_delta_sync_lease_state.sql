-- Staged distributed lease and compare-and-swap state contract for the
-- 15-minute Zoho delta sync. This migration is not installed automatically.
-- It contains no customer rows, credentials, or deployment identifiers.
--
-- Deployment order:
--   1. Pause every delta-sync trigger.
--   2. Apply this migration through an authorized PostgreSQL DDL session.
--   3. Run scripts/verify-delta-sync-lease-state.js.
--   4. Deploy the application integration, then resume the scheduler.
--
-- The migration imports the last delta_sync_state_v2 object from crm_meta once.
-- Subsequent reads and writes must use the lease RPCs below; crm_meta_upsert is
-- deliberately not part of the new state path.

BEGIN;

DO $delta_sync_state_preflight$
declare
  v_legacy_state jsonb;
begin
  select data
    into v_legacy_state
    from public.crm_meta
    where key = 'delta_sync_state_v2'
    for update;

  if v_legacy_state is not null and jsonb_typeof(v_legacy_state) <> 'object' then
    raise exception using errcode = '55000', message = 'delta-sync legacy state is invalid';
  end if;
end
$delta_sync_state_preflight$;

CREATE TABLE IF NOT EXISTS public.crm_delta_sync_control (
  singleton_key text PRIMARY KEY,
  owner_id uuid,
  acquired_at timestamp with time zone,
  expires_at timestamp with time zone,
  state_revision bigint NOT NULL DEFAULT 0,
  state jsonb,
  updated_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT crm_delta_sync_control_fixed_key CHECK (singleton_key = 'zoho-delta-sync-v1'),
  CONSTRAINT crm_delta_sync_control_lease_consistency CHECK (
    (owner_id IS NULL AND acquired_at IS NULL AND expires_at IS NULL)
    OR (owner_id IS NOT NULL AND acquired_at IS NOT NULL AND expires_at IS NOT NULL)
  ),
  CONSTRAINT crm_delta_sync_control_time_order CHECK (
    expires_at IS NULL OR expires_at > acquired_at
  ),
  CONSTRAINT crm_delta_sync_control_duration_bound CHECK (
    expires_at IS NULL OR expires_at <= acquired_at + interval '50 seconds'
  ),
  CONSTRAINT crm_delta_sync_control_revision_nonnegative CHECK (state_revision >= 0),
  CONSTRAINT crm_delta_sync_control_state_object CHECK (
    state IS NULL OR jsonb_typeof(state) = 'object'
  )
);

INSERT INTO public.crm_delta_sync_control (singleton_key, state)
SELECT 'zoho-delta-sync-v1', data
  FROM public.crm_meta
  WHERE key = 'delta_sync_state_v2'
ON CONFLICT (singleton_key) DO NOTHING;

INSERT INTO public.crm_delta_sync_control (singleton_key, state)
VALUES ('zoho-delta-sync-v1', NULL)
ON CONFLICT (singleton_key) DO NOTHING;

ALTER TABLE public.crm_delta_sync_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_delta_sync_control FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.crm_acquire_delta_sync_lease(
  p_owner_id uuid,
  p_ttl_seconds integer,
  s text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET lock_timeout TO '2s'
 SET statement_timeout TO '5s'
AS $function$
declare
  v_now timestamp with time zone := clock_timestamp();
  v_revision bigint;
  v_state jsonb;
  v_expires_at timestamp with time zone;
begin
  if not exists (select 1 from public.crm_secret where secret = s) then
    raise exception using errcode = '42501', message = 'unauthorized';
  end if;
  if p_owner_id is null
    or p_ttl_seconds is null
    or p_ttl_seconds < 5
    or p_ttl_seconds > 50 then
    raise exception using errcode = '22023', message = 'invalid delta-sync lease arguments';
  end if;

  update public.crm_delta_sync_control
    set owner_id = p_owner_id,
        acquired_at = v_now,
        expires_at = v_now + make_interval(secs => p_ttl_seconds),
        updated_at = v_now
    where singleton_key = 'zoho-delta-sync-v1'
      and (owner_id is null or expires_at <= v_now)
    returning state_revision, state, expires_at
      into v_revision, v_state, v_expires_at;

  if not found then
    return jsonb_build_object('acquired', false);
  end if;

  return jsonb_build_object(
    'acquired', true,
    'revision', v_revision,
    'state', v_state,
    'lease_expires_at', v_expires_at
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.crm_renew_delta_sync_lease(
  p_owner_id uuid,
  p_ttl_seconds integer,
  s text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET lock_timeout TO '2s'
 SET statement_timeout TO '5s'
AS $function$
declare
  v_now timestamp with time zone := clock_timestamp();
  v_expires_at timestamp with time zone;
begin
  if not exists (select 1 from public.crm_secret where secret = s) then
    raise exception using errcode = '42501', message = 'unauthorized';
  end if;
  if p_owner_id is null
    or p_ttl_seconds is null
    or p_ttl_seconds < 5
    or p_ttl_seconds > 50 then
    raise exception using errcode = '22023', message = 'invalid delta-sync lease arguments';
  end if;

  update public.crm_delta_sync_control
    set acquired_at = v_now,
        expires_at = v_now + make_interval(secs => p_ttl_seconds),
        updated_at = v_now
    where singleton_key = 'zoho-delta-sync-v1'
      and owner_id = p_owner_id
      and expires_at > v_now
    returning expires_at into v_expires_at;

  return jsonb_build_object(
    'renewed', found,
    'lease_expires_at', case when found then v_expires_at else null end
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.crm_save_delta_sync_state(
  p_owner_id uuid,
  p_expected_revision bigint,
  p_state jsonb,
  s text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET lock_timeout TO '2s'
 SET statement_timeout TO '5s'
AS $function$
declare
  v_now timestamp with time zone := clock_timestamp();
  v_revision bigint;
begin
  if not exists (select 1 from public.crm_secret where secret = s) then
    raise exception using errcode = '42501', message = 'unauthorized';
  end if;
  if p_owner_id is null
    or p_expected_revision is null
    or p_expected_revision < 0
    or p_state is null
    or jsonb_typeof(p_state) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid delta-sync state arguments';
  end if;

  update public.crm_delta_sync_control
    set state = p_state,
        state_revision = state_revision + 1,
        updated_at = v_now
    where singleton_key = 'zoho-delta-sync-v1'
      and owner_id = p_owner_id
      and expires_at > v_now
      and state_revision = p_expected_revision
    returning state_revision into v_revision;

  if not found then
    raise exception using errcode = '40001', message = 'delta-sync state compare-and-swap conflict';
  end if;

  return jsonb_build_object('saved', true, 'revision', v_revision);
end
$function$;

CREATE OR REPLACE FUNCTION public.crm_release_delta_sync_lease(
  p_owner_id uuid,
  s text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET lock_timeout TO '2s'
 SET statement_timeout TO '5s'
AS $function$
declare
  v_released boolean := false;
begin
  if not exists (select 1 from public.crm_secret where secret = s) then
    raise exception using errcode = '42501', message = 'unauthorized';
  end if;
  if p_owner_id is null then
    raise exception using errcode = '22023', message = 'invalid delta-sync lease arguments';
  end if;

  update public.crm_delta_sync_control
    set owner_id = null,
        acquired_at = null,
        expires_at = null,
        updated_at = clock_timestamp()
    where singleton_key = 'zoho-delta-sync-v1'
      and owner_id = p_owner_id;
  v_released := found;

  return jsonb_build_object('released', v_released);
end
$function$;

CREATE OR REPLACE FUNCTION public.crm_read_delta_sync_state(s text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '5s'
AS $function$
declare
  v_now timestamp with time zone := clock_timestamp();
  v_revision bigint;
  v_state jsonb;
  v_lease_active boolean;
begin
  if not exists (select 1 from public.crm_secret where secret = s) then
    raise exception using errcode = '42501', message = 'unauthorized';
  end if;

  select state_revision,
      state,
      owner_id is not null and expires_at > v_now
    into v_revision, v_state, v_lease_active
    from public.crm_delta_sync_control
    where singleton_key = 'zoho-delta-sync-v1';

  if not found then
    raise exception using errcode = '55000', message = 'delta-sync control row is unavailable';
  end if;

  return jsonb_build_object(
    'revision', v_revision,
    'state', v_state,
    'lease_active', v_lease_active
  );
end
$function$;

ALTER TABLE public.crm_delta_sync_control OWNER TO postgres;
ALTER FUNCTION public.crm_acquire_delta_sync_lease(uuid, integer, text) OWNER TO postgres;
ALTER FUNCTION public.crm_renew_delta_sync_lease(uuid, integer, text) OWNER TO postgres;
ALTER FUNCTION public.crm_save_delta_sync_state(uuid, bigint, jsonb, text) OWNER TO postgres;
ALTER FUNCTION public.crm_release_delta_sync_lease(uuid, text) OWNER TO postgres;
ALTER FUNCTION public.crm_read_delta_sync_state(text) OWNER TO postgres;

DO $delta_sync_acl$
declare
  v_object record;
  v_grantee text;
begin
  for v_object in
    select p.oid,
        pg_catalog.format(
          '%I.%I(%s)',
          n.nspname,
          p.proname,
          pg_catalog.pg_get_function_identity_arguments(p.oid)
        ) as signature,
        p.proowner
      from pg_catalog.pg_proc as p
      join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.oid in (
          'public.crm_acquire_delta_sync_lease(uuid, integer, text)'::pg_catalog.regprocedure,
          'public.crm_renew_delta_sync_lease(uuid, integer, text)'::pg_catalog.regprocedure,
          'public.crm_save_delta_sync_state(uuid, bigint, jsonb, text)'::pg_catalog.regprocedure,
          'public.crm_release_delta_sync_lease(uuid, text)'::pg_catalog.regprocedure,
          'public.crm_read_delta_sync_state(text)'::pg_catalog.regprocedure
        )
  loop
    for v_grantee in
      select distinct grantee_role.rolname
        from pg_catalog.aclexplode(
          coalesce(
            (select proacl from pg_catalog.pg_proc where oid = v_object.oid),
            pg_catalog.acldefault('f', v_object.proowner)
          )
        ) as privilege
        join pg_catalog.pg_roles as grantee_role on grantee_role.oid = privilege.grantee
        where privilege.grantee <> v_object.proowner
    loop
      execute pg_catalog.format(
        'REVOKE ALL PRIVILEGES ON FUNCTION %s FROM %I CASCADE',
        v_object.signature,
        v_grantee
      );
    end loop;
  end loop;

  for v_grantee in
    select distinct grantee_role.rolname
      from pg_catalog.aclexplode(
        coalesce(
          (select relacl
            from pg_catalog.pg_class as relation
            join pg_catalog.pg_namespace as namespace_catalog
              on namespace_catalog.oid = relation.relnamespace
            where namespace_catalog.nspname = 'public'
              and relation.relname = 'crm_delta_sync_control'),
          pg_catalog.acldefault(
            'r',
            (select relowner
              from pg_catalog.pg_class as relation
              join pg_catalog.pg_namespace as namespace_catalog
                on namespace_catalog.oid = relation.relnamespace
              where namespace_catalog.nspname = 'public'
                and relation.relname = 'crm_delta_sync_control')
          )
        )
      ) as privilege
      join pg_catalog.pg_roles as grantee_role on grantee_role.oid = privilege.grantee
      where privilege.grantee <> (
        select relowner
          from pg_catalog.pg_class as relation
          join pg_catalog.pg_namespace as namespace_catalog
            on namespace_catalog.oid = relation.relnamespace
          where namespace_catalog.nspname = 'public'
            and relation.relname = 'crm_delta_sync_control'
      )
  loop
    execute pg_catalog.format(
      'REVOKE ALL PRIVILEGES ON TABLE public.crm_delta_sync_control FROM %I CASCADE',
      v_grantee
    );
  end loop;
end
$delta_sync_acl$;

REVOKE ALL PRIVILEGES ON FUNCTION public.crm_acquire_delta_sync_lease(uuid, integer, text) FROM PUBLIC CASCADE;
REVOKE ALL PRIVILEGES ON FUNCTION public.crm_renew_delta_sync_lease(uuid, integer, text) FROM PUBLIC CASCADE;
REVOKE ALL PRIVILEGES ON FUNCTION public.crm_save_delta_sync_state(uuid, bigint, jsonb, text) FROM PUBLIC CASCADE;
REVOKE ALL PRIVILEGES ON FUNCTION public.crm_release_delta_sync_lease(uuid, text) FROM PUBLIC CASCADE;
REVOKE ALL PRIVILEGES ON FUNCTION public.crm_read_delta_sync_state(text) FROM PUBLIC CASCADE;

GRANT EXECUTE ON FUNCTION public.crm_acquire_delta_sync_lease(uuid, integer, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_renew_delta_sync_lease(uuid, integer, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_save_delta_sync_state(uuid, bigint, jsonb, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_release_delta_sync_lease(uuid, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_read_delta_sync_state(text) TO anon, authenticated, service_role;

REVOKE ALL PRIVILEGES ON TABLE public.crm_delta_sync_control
  FROM PUBLIC, anon, authenticated, service_role CASCADE;

COMMIT;
