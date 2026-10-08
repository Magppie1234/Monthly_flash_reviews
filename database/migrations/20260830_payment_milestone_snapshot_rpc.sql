-- Staged atomic RPC for the timestamp-less Payment_Milestones snapshot.
--
-- This migration is intentionally not installed automatically. Apply it only
-- through an authorized PostgreSQL DDL session, then run the fail-closed
-- catalog verifier before wiring production traffic to the RPC.
--
-- Payment_Milestones does not currently expose Modified_Time in Zoho CRM.
-- This dedicated contract therefore orders complete observations by one exact
-- source_seen_at value instead of inventing a business modification timestamp.

BEGIN;

-- Existing deployments may predate source-observation ordering. Do not
-- backfill this column from Created_Time, Last_Activity_Time, or any other
-- business field: those timestamps have different semantics.
ALTER TABLE public.crm_records
  ADD COLUMN IF NOT EXISTS source_seen_at timestamp with time zone;

CREATE OR REPLACE FUNCTION public.crm_payment_milestone_snapshot_upsert(rows jsonb, s text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET lock_timeout TO '2s'
 SET statement_timeout TO '30s'
AS $function$
declare
  v_expected_count integer;
  v_changed integer;
  v_lock jsonb;
  v_row jsonb;
  v_data jsonb;
  v_id text;
  v_seen_ids text[] := array[]::text[];
  v_source_org_id text;
  v_row_source_org_id text;
  v_source_seen_at_text text;
  v_row_source_seen_at_text text;
  v_source_seen_at timestamp with time zone;
  v_created_time_text text;
begin
  if not exists (select 1 from public.crm_secret where secret = s) then
    raise exception using errcode = '42501', message = 'unauthorized';
  end if;

  if rows is null
    or jsonb_typeof(rows) <> 'array'
    or jsonb_array_length(rows) < 1
    or jsonb_array_length(rows) > 200 then
    raise exception using errcode = '22023', message = 'invalid payment milestone snapshot batch';
  end if;
  v_expected_count := jsonb_array_length(rows);

  -- Validate the complete input before reading the organization lock, taking
  -- advisory locks, or changing crm_records. The exact row shape prevents a
  -- general-purpose upsert payload from being routed through this exception.
  for v_row in select value from jsonb_array_elements(rows)
  loop
    v_data := v_row -> 'data';
    v_id := v_row ->> 'id';
    v_row_source_org_id := v_row ->> 'source_org_id';
    v_row_source_seen_at_text := v_row ->> 'source_seen_at';
    v_created_time_text := v_row ->> 'created_time';

    if jsonb_typeof(v_row) <> 'object'
      or not (v_row ?& array[
        'module', 'id', 'data', 'name', 'search_text', 'created_time',
        'modified_time', 'source_org_id', 'source_seen_at'
      ])
      or (select count(*) from jsonb_object_keys(v_row)) <> 9
      or jsonb_typeof(v_row -> 'module') <> 'string'
      or v_row ->> 'module' is distinct from 'Payment_Milestones'
      or jsonb_typeof(v_row -> 'id') <> 'string'
      or v_id !~ '^[0-9]{8,32}$'
      or jsonb_typeof(v_data) <> 'object'
      or jsonb_typeof(v_data -> 'id') <> 'string'
      or v_data ->> 'id' is distinct from v_id
      or v_data ? 'Modified_Time'
      or jsonb_typeof(v_row -> 'modified_time') <> 'null'
      or jsonb_typeof(v_row -> 'source_org_id') <> 'string'
      or v_row_source_org_id !~ '^org[0-9]{8,32}$'
      or jsonb_typeof(v_row -> 'source_seen_at') <> 'string'
      or v_row_source_seen_at_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
      or jsonb_typeof(v_row -> 'name') not in ('string', 'null')
      or jsonb_typeof(v_row -> 'search_text') not in ('string', 'null')
      or jsonb_typeof(v_row -> 'created_time') not in ('string', 'null')
      or (jsonb_typeof(v_row -> 'name') = 'string' and char_length(v_row ->> 'name') > 1000)
      or (jsonb_typeof(v_row -> 'search_text') = 'string' and char_length(v_row ->> 'search_text') > 500) then
      raise exception using errcode = '22023', message = 'invalid payment milestone snapshot row';
    end if;

    if v_id = any(v_seen_ids) then
      raise exception using errcode = '22023', message = 'duplicate payment milestone snapshot identifier';
    end if;
    v_seen_ids := array_append(v_seen_ids, v_id);

    if v_source_org_id is null then
      v_source_org_id := v_row_source_org_id;
      v_source_seen_at_text := v_row_source_seen_at_text;
    elsif v_row_source_org_id is distinct from v_source_org_id
      or v_row_source_seen_at_text is distinct from v_source_seen_at_text then
      raise exception using errcode = '22023', message = 'payment milestone snapshot observation mismatch';
    end if;

    if v_created_time_text is not null then
      begin
        perform v_created_time_text::timestamp with time zone;
      exception when others then
        raise exception using errcode = '22023', message = 'invalid payment milestone snapshot created time';
      end;
    end if;
  end loop;

  begin
    v_source_seen_at := v_source_seen_at_text::timestamp with time zone;
  exception when others then
    raise exception using errcode = '22023', message = 'invalid payment milestone snapshot observation time';
  end;
  if pg_catalog.to_char(
      v_source_seen_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ) is distinct from v_source_seen_at_text then
    raise exception using errcode = '22023', message = 'noncanonical payment milestone snapshot observation time';
  end if;

  select m.data
    into v_lock
    from public.crm_meta as m
    where m.key = 'source_replication_lock';

  if v_lock is null
    or jsonb_typeof(v_lock) <> 'object'
    or v_lock -> 'verified' is distinct from 'true'::jsonb
    or (v_lock ->> 'source_org_id') !~ '^org[0-9]{8,32}$'
    or v_source_org_id is distinct from v_lock ->> 'source_org_id' then
    raise exception using errcode = '42501', message = 'source replication organization lock mismatch';
  end if;

  -- One module-wide transaction lock serializes snapshot commits. The ordered
  -- per-record locks also coordinate with the existing source-upsert contract.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      concat_ws(E'\\x1f', v_source_org_id, 'Payment_Milestones', 'snapshot'),
      0
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        concat_ws(E'\\x1f', v_source_org_id, 'Payment_Milestones', incoming.value ->> 'id'),
        0
      )
    )
    from jsonb_array_elements(rows) as incoming(value)
    order by incoming.value ->> 'id';

  -- Reject the whole observation before DML if any target row is newer. The
  -- ON CONFLICT predicate below repeats this ordering check as a race guard.
  if exists (
    select 1
      from public.crm_records as target
      join jsonb_array_elements(rows) as incoming(value)
        on target.module = 'Payment_Milestones'
        and target.id = incoming.value ->> 'id'
      where target.source_seen_at is not null
        and target.source_seen_at > v_source_seen_at
  ) then
    raise exception using errcode = '40001', message = 'stale payment milestone snapshot observation';
  end if;

  insert into public.crm_records (
    module, id, data, name, search_text, created_time, modified_time,
    status, due_date, ts2, owner, source_seen_at
  )
  select
    'Payment_Milestones',
    incoming.value ->> 'id',
    incoming.value -> 'data',
    incoming.value ->> 'name',
    incoming.value ->> 'search_text',
    nullif(incoming.value ->> 'created_time', '')::timestamp with time zone,
    null::timestamp with time zone,
    derived.o_status,
    derived.o_due,
    derived.o_ts2,
    derived.o_owner,
    v_source_seen_at
  from jsonb_array_elements(rows) as incoming(value)
  cross join lateral public.crm_derive('Payment_Milestones', incoming.value -> 'data') as derived
  on conflict (module, id) do update
    set data = excluded.data,
        name = excluded.name,
        search_text = excluded.search_text,
        created_time = excluded.created_time,
        modified_time = null,
        status = excluded.status,
        due_date = excluded.due_date,
        ts2 = excluded.ts2,
        owner = excluded.owner,
        source_seen_at = excluded.source_seen_at
    where crm_records.source_seen_at is null
      or excluded.source_seen_at >= crm_records.source_seen_at;

  get diagnostics v_changed = row_count;
  if v_changed is distinct from v_expected_count then
    raise exception using errcode = '40001', message = 'payment milestone snapshot upsert count mismatch';
  end if;
  return v_expected_count;
end
$function$;

ALTER FUNCTION public.crm_payment_milestone_snapshot_upsert(jsonb, text) OWNER TO postgres;

-- CREATE OR REPLACE preserves existing ACLs, so remove every non-owner grant
-- before establishing the exact Supabase RPC execution contract.
DO $payment_milestone_snapshot_acl$
declare
  v_grantee text;
begin
  for v_grantee in
    select distinct grantee_role.rolname
      from pg_catalog.pg_proc as function_catalog
      join pg_catalog.pg_namespace as namespace_catalog
        on namespace_catalog.oid = function_catalog.pronamespace
      cross join lateral pg_catalog.aclexplode(
        coalesce(
          function_catalog.proacl,
          pg_catalog.acldefault('f', function_catalog.proowner)
        )
      ) as privilege
      join pg_catalog.pg_roles as grantee_role on grantee_role.oid = privilege.grantee
      where namespace_catalog.nspname = 'public'
        and function_catalog.oid = 'public.crm_payment_milestone_snapshot_upsert(jsonb, text)'::pg_catalog.regprocedure
        and privilege.grantee <> function_catalog.proowner
  loop
    execute pg_catalog.format(
      'REVOKE ALL PRIVILEGES ON FUNCTION public.crm_payment_milestone_snapshot_upsert(jsonb, text) FROM %I CASCADE',
      v_grantee
    );
  end loop;
end
$payment_milestone_snapshot_acl$;

REVOKE ALL PRIVILEGES ON FUNCTION public.crm_payment_milestone_snapshot_upsert(jsonb, text)
  FROM PUBLIC CASCADE;
GRANT EXECUTE ON FUNCTION public.crm_payment_milestone_snapshot_upsert(jsonb, text)
  TO anon, authenticated, service_role;

COMMIT;
