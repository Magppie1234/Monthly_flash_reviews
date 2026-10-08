-- MAGPPIE CRM sanitized local database bootstrap
-- Generated from the existing local-replica database. No customer rows are included.
-- Replace every __REPLACE_AT_DEPLOYMENT__ placeholder with a new deployment-only secret before applying.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS public."crm_secret" (
  "secret" text NOT NULL
);

CREATE TABLE IF NOT EXISTS public."crm_records" (
  "module" text NOT NULL,
  "id" text NOT NULL,
  "data" jsonb NOT NULL,
  "name" text,
  "search_text" text,
  "created_time" timestamp with time zone,
  "modified_time" timestamp with time zone,
  "status" text,
  "due_date" text,
  "ts2" text,
  "owner" text,
  "source_seen_at" timestamp with time zone
);

ALTER TABLE public."crm_records"
  ADD COLUMN IF NOT EXISTS "source_seen_at" timestamp with time zone;

CREATE TABLE IF NOT EXISTS public."crm_meta" (
  "key" text NOT NULL,
  "data" jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."crm_audit" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "module" text NOT NULL,
  "record_id" text NOT NULL,
  "at" timestamp with time zone DEFAULT now() NOT NULL,
  "actor" text,
  "action" text NOT NULL,
  "changes" jsonb
);

CREATE TABLE IF NOT EXISTS public."crm_record_tombstones" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "source_org_id" text NOT NULL,
  "module" text NOT NULL,
  "record_id" text NOT NULL,
  "deleted_time" timestamp with time zone NOT NULL,
  "deletion_type" text NOT NULL,
  "observed_at" timestamp with time zone NOT NULL,
  "archived_at" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  "row_present" boolean NOT NULL,
  "record_snapshot" jsonb NOT NULL,
  "snapshot_modified_time" timestamp with time zone,
  "snapshot_source_seen_at" timestamp with time zone,
  "reactivated_at" timestamp with time zone,
  "reactivated_by_modified_time" timestamp with time zone,
  "reactivated_by_source_seen_at" timestamp with time zone,
  "superseded_at" timestamp with time zone,
  "superseded_by_deleted_time" timestamp with time zone,
  CONSTRAINT "crm_record_tombstones_source_org_format" CHECK (source_org_id ~ '^org[0-9]{8,32}$'),
  CONSTRAINT "crm_record_tombstones_module_safe" CHECK (module IN (
    'Leads', 'Contacts', 'Accounts', 'Deals', 'Tasks', 'Events', 'Calls', 'Products',
    'Vendors', 'Developers', 'Referral_Partners', 'Payment_Milestones', 'Designers',
    'Visit_Module', 'AMS_Complaints'
  )),
  CONSTRAINT "crm_record_tombstones_record_id_format" CHECK (record_id ~ '^[0-9]{8,32}$'),
  CONSTRAINT "crm_record_tombstones_deletion_type" CHECK (deletion_type IN ('recycle', 'permanent')),
  CONSTRAINT "crm_record_tombstones_time_order" CHECK (deleted_time <= observed_at AND archived_at >= observed_at),
  CONSTRAINT "crm_record_tombstones_snapshot_object" CHECK (jsonb_typeof(record_snapshot) = 'object'),
  CONSTRAINT "crm_record_tombstones_snapshot_identity" CHECK (
    record_snapshot ->> 'module' = module
    AND record_snapshot ->> 'id' = record_id
    AND jsonb_typeof(record_snapshot -> 'data') = 'object'
    AND record_snapshot -> 'data' ->> 'id' = record_id
  ),
  CONSTRAINT "crm_record_tombstones_row_snapshot" CHECK (
    (row_present AND snapshot_source_seen_at IS NOT NULL)
    OR (
      NOT row_present
      AND snapshot_modified_time IS NULL
      AND snapshot_source_seen_at IS NULL
      AND record_snapshot = jsonb_build_object(
        'module', module,
        'id', record_id,
        'data', jsonb_build_object('id', record_id)
      )
    )
  ),
  CONSTRAINT "crm_record_tombstones_reactivation_consistency" CHECK (
    (reactivated_at IS NULL AND reactivated_by_source_seen_at IS NULL AND reactivated_by_modified_time IS NULL)
    OR (reactivated_at IS NOT NULL AND reactivated_by_source_seen_at IS NOT NULL)
  ),
  CONSTRAINT "crm_record_tombstones_supersession_consistency" CHECK (
    (superseded_at IS NULL AND superseded_by_deleted_time IS NULL)
    OR (superseded_at IS NOT NULL AND superseded_by_deleted_time IS NOT NULL)
  ),
  CONSTRAINT "crm_record_tombstones_terminal_state" CHECK (
    NOT (reactivated_at IS NOT NULL AND superseded_at IS NOT NULL)
  ),
  CONSTRAINT "crm_record_tombstones_deletion_event_key" UNIQUE (
    source_org_id, module, record_id, deleted_time, deletion_type
  )
);

CREATE TABLE IF NOT EXISTS public."crm_replication_leases" (
  "lease_key" text PRIMARY KEY,
  "owner_id" uuid NOT NULL,
  "acquired_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  CONSTRAINT "crm_replication_leases_fixed_key" CHECK (lease_key = 'source-deletion-sync-v1'),
  CONSTRAINT "crm_replication_leases_time_order" CHECK (expires_at > acquired_at)
);

DO $migration$ BEGIN
  ALTER TABLE public."crm_audit" ADD CONSTRAINT "crm_audit_pkey" PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;

DO $migration$ BEGIN
  ALTER TABLE public."crm_meta" ADD CONSTRAINT "crm_meta_pkey" PRIMARY KEY (key);
EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;

DO $migration$ BEGIN
  ALTER TABLE public."crm_records" ADD CONSTRAINT "crm_records_pkey" PRIMARY KEY (module, id);
EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;

DO $migration$ BEGIN
  ALTER TABLE public."crm_secret" ADD CONSTRAINT "crm_secret_pkey" PRIMARY KEY (secret);
EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;

CREATE INDEX IF NOT EXISTS crm_audit_rec_idx ON public.crm_audit USING btree (module, record_id, at DESC);

CREATE INDEX IF NOT EXISTS crm_contacts_fup_idx ON public.crm_records USING btree (((data ->> 'Next_Follow_UP_Date'::text))) WHERE (module = 'Contacts'::text);

CREATE INDEX IF NOT EXISTS crm_contacts_nfup_idx ON public.crm_records USING btree (((data ->> 'Next_Follow_Up_Date1'::text))) WHERE (module = 'Contacts'::text);

CREATE INDEX IF NOT EXISTS crm_leads_fup_idx ON public.crm_records USING btree (((data ->> 'Follow_Up_Date_Time'::text))) WHERE (module = 'Leads'::text);

CREATE INDEX IF NOT EXISTS crm_leads_nfup_idx ON public.crm_records USING btree (((data ->> 'Next_Follow_UP_Date'::text))) WHERE (module = 'Leads'::text);

CREATE INDEX IF NOT EXISTS crm_notes_parent_idx ON public.crm_records USING btree ((((data -> 'Parent_Id'::text) ->> 'id'::text))) WHERE (module = 'Notes'::text);

CREATE INDEX IF NOT EXISTS crm_records_mod_created_idx ON public.crm_records USING btree (module, created_time DESC);

CREATE INDEX IF NOT EXISTS crm_records_mod_modified_idx ON public.crm_records USING btree (module, modified_time DESC);

CREATE INDEX IF NOT EXISTS crm_records_mod_owner_idx ON public.crm_records USING btree (module, owner);

CREATE INDEX IF NOT EXISTS crm_records_mod_status_idx ON public.crm_records USING btree (module, status);

CREATE INDEX IF NOT EXISTS crm_records_search_idx ON public.crm_records USING gin (search_text gin_trgm_ops);

CREATE INDEX IF NOT EXISTS crm_records_tasks_due_idx ON public.crm_records USING btree (due_date) WHERE ((module = 'Tasks'::text) AND (COALESCE(status, ''::text) <> 'Completed'::text));

CREATE INDEX IF NOT EXISTS crm_records_ts2_idx ON public.crm_records USING btree (module, ts2);

CREATE UNIQUE INDEX IF NOT EXISTS crm_record_tombstones_current_idx
  ON public.crm_record_tombstones (source_org_id, module, record_id)
  WHERE reactivated_at IS NULL AND superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS crm_record_tombstones_deleted_idx
  ON public.crm_record_tombstones (source_org_id, deleted_time DESC, id DESC);
CREATE INDEX IF NOT EXISTS crm_record_tombstones_record_history_idx
  ON public.crm_record_tombstones (module, record_id, deleted_time DESC, id DESC);
CREATE INDEX IF NOT EXISTS crm_record_tombstones_reactivated_idx
  ON public.crm_record_tombstones (reactivated_at DESC)
  WHERE reactivated_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_replication_leases_expiry_idx
  ON public.crm_replication_leases (expires_at);

-- Covers the aggregate-only Analytics scan without reading CRM JSON documents.
-- Existing deployments should build the equivalent index CONCURRENTLY outside
-- this bootstrap transaction, then ANALYZE public.crm_records.
CREATE INDEX IF NOT EXISTS crm_records_analytics_cover_idx
  ON public.crm_records USING btree (module)
  INCLUDE (id, status, created_time, modified_time, due_date, ts2)
  WHERE module IN ('Leads', 'Contacts', 'Deals', 'Tasks', 'Calls', 'Events');

ALTER TABLE public."crm_audit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."crm_meta" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."crm_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."crm_secret" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."crm_record_tombstones" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."crm_record_tombstones" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."crm_replication_leases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."crm_replication_leases" FORCE ROW LEVEL SECURITY;

INSERT INTO public.crm_secret (secret) VALUES ('__REPLACE_AT_DEPLOYMENT__') ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.crm_derive(p_module text, d jsonb)
 RETURNS TABLE(o_status text, o_due text, o_ts2 text, o_owner text)
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select
    case when p_module = 'Leads' then d->>'Lead_Status'
         when p_module in ('Deals','Contacts') then d->>'Stage'
         else d->>'Status' end,
    case when p_module = 'Tasks' then d->>'Due_Date' end,
    case when p_module = 'Calls' then d->>'Call_Start_Time'
         when p_module = 'Events' then d->>'Start_DateTime' end,
    d->'Owner'->>'name'
$function$;

CREATE OR REPLACE FUNCTION public.crm_sql(q text, s text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '15s'
AS $function$
declare result jsonb;
begin
  if not exists (select 1 from crm_secret where secret = s) then raise exception 'unauthorized'; end if;
  if q !~* '^\s*(select|with)\M' then raise exception 'select only'; end if;
  execute 'select coalesce(jsonb_agg(t), ''[]''::jsonb) from (' || q || ') t' into result;
  return result;
end $function$;

CREATE OR REPLACE FUNCTION public.crm_bulk_upsert(rows jsonb, s text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET lock_timeout TO '2s'
 SET statement_timeout TO '120s'
AS $function$
declare
  n integer := 0;
  v_changed integer;
  v_lock jsonb;
  v_source_org_id text;
  v_row jsonb;
  v_module text;
  v_id text;
  v_data jsonb;
  v_source_seen_at timestamp with time zone;
  v_modified_time timestamp with time zone;
  v_tombstone public.crm_record_tombstones%rowtype;
begin
  if not exists (select 1 from public.crm_secret where secret = s) then
    raise exception using errcode = '42501', message = 'unauthorized';
  end if;

  if rows is null
    or jsonb_typeof(rows) <> 'array'
    or jsonb_array_length(rows) < 1
    or jsonb_array_length(rows) > 1000 then
    raise exception using errcode = '22023', message = 'invalid source upsert batch';
  end if;

  select m.data
    into v_lock
    from public.crm_meta as m
    where m.key = 'source_replication_lock';

  if v_lock is null
    or jsonb_typeof(v_lock) <> 'object'
    or v_lock -> 'verified' is distinct from 'true'::jsonb
    or (v_lock ->> 'source_org_id') !~ '^org[0-9]{8,32}$' then
    raise exception using errcode = '42501', message = 'source replication organization lock mismatch';
  end if;
  v_source_org_id := v_lock ->> 'source_org_id';

  for v_row in select value from jsonb_array_elements(rows)
  loop
    v_module := v_row ->> 'module';
    v_id := v_row ->> 'id';
    v_data := v_row -> 'data';
    if jsonb_typeof(v_row) <> 'object'
      or v_row ->> 'source_org_id' is distinct from v_source_org_id
      or v_module !~ '^[A-Za-z][A-Za-z0-9_$]{0,159}$'
      or v_id !~ '^[0-9]{8,32}$'
      or jsonb_typeof(v_data) <> 'object'
      or v_data ->> 'id' is distinct from v_id
      or nullif(v_row ->> 'modified_time', '') is null
      or nullif(v_row ->> 'source_seen_at', '') is null then
      raise exception using errcode = '22023', message = 'invalid source upsert row';
    end if;
    v_modified_time := (v_row ->> 'modified_time')::timestamp with time zone;
    v_source_seen_at := (v_row ->> 'source_seen_at')::timestamp with time zone;
    if v_source_seen_at < v_modified_time then
      raise exception using errcode = '22023', message = 'invalid source upsert timestamp order';
    end if;
  end loop;

  for v_row in select value from jsonb_array_elements(rows)
  loop
    v_module := v_row ->> 'module';
    v_id := v_row ->> 'id';
    v_data := v_row -> 'data';
    v_modified_time := (v_row ->> 'modified_time')::timestamp with time zone;
    v_source_seen_at := (v_row ->> 'source_seen_at')::timestamp with time zone;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(concat_ws(E'\\x1f', v_source_org_id, v_module, v_id), 0)
    );

    select t.*
      into v_tombstone
      from public.crm_record_tombstones as t
      where t.source_org_id = v_source_org_id
        and t.module = v_module
        and t.record_id = v_id
        and t.reactivated_at is null
        and t.superseded_at is null
      for update;

    if found and v_source_seen_at <= v_tombstone.observed_at then
      continue;
    end if;

    if found then
      update public.crm_record_tombstones
        set reactivated_at = v_source_seen_at,
            reactivated_by_modified_time = v_modified_time,
            reactivated_by_source_seen_at = v_source_seen_at
        where id = v_tombstone.id
          and reactivated_at is null
          and superseded_at is null;

      if found then
        insert into public.crm_audit (module, record_id, action, changes, actor)
        values (
          v_module,
          v_id,
          'source_reactivated',
          jsonb_build_object(
            'previous_deletion_type', v_tombstone.deletion_type,
            'previous_deleted_time', v_tombstone.deleted_time,
            'source_seen_at', v_source_seen_at
          ),
          'MAGPPIE CRM replication'
        );
      end if;
    end if;

    insert into public.crm_records (
      module, id, data, name, search_text, created_time, modified_time,
      status, due_date, ts2, owner, source_seen_at
    )
    select
      v_module,
      v_id,
      v_data,
      v_row ->> 'name',
      v_row ->> 'search_text',
      nullif(v_row ->> 'created_time', '')::timestamp with time zone,
      v_modified_time,
      d.o_status,
      d.o_due,
      d.o_ts2,
      d.o_owner,
      v_source_seen_at
    from public.crm_derive(v_module, v_data) as d
    on conflict (module, id) do update
      set data = excluded.data,
          name = excluded.name,
          search_text = excluded.search_text,
          created_time = excluded.created_time,
          modified_time = excluded.modified_time,
          status = excluded.status,
          due_date = excluded.due_date,
          ts2 = excluded.ts2,
          owner = excluded.owner,
          source_seen_at = excluded.source_seen_at
      where crm_records.source_seen_at is null
        or excluded.source_seen_at > crm_records.source_seen_at
        or (
          excluded.source_seen_at = crm_records.source_seen_at
          and excluded.modified_time >= crm_records.modified_time
        );
    get diagnostics v_changed = row_count;
    n := n + v_changed;
  end loop;

  return n;
end
$function$;

CREATE OR REPLACE FUNCTION public.crm_meta_upsert(k text, d jsonb, s text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from crm_secret where secret = s) then raise exception 'unauthorized'; end if;
  insert into crm_meta (key, data, updated_at) values (k, d, now())
  on conflict (key) do update set data = excluded.data, updated_at = now();
end $function$;

CREATE OR REPLACE FUNCTION public.crm_insert(
  p_module text,
  p_id text,
  d jsonb,
  p_name text,
  p_search text,
  s text
)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '15s'
AS $function$
begin
  if not exists (select 1 from public.crm_secret where secret = s) then
    raise exception using errcode = '42501', message = 'unauthorized';
  end if;
  if p_id is null
    or p_id !~ '^(local|local-note)-[A-Za-z0-9][A-Za-z0-9._:-]{0,188}$'
    or d is null
    or jsonb_typeof(d) <> 'object'
    or d ->> 'id' is distinct from p_id then
    raise exception using errcode = '22023', message = 'invalid local record identity';
  end if;
  insert into public.crm_records (
    module, id, data, name, search_text, created_time, modified_time,
    status, due_date, ts2, owner, source_seen_at
  )
  select p_module, p_id, d, p_name, p_search, now(), now(),
    dv.o_status, dv.o_due, dv.o_ts2, dv.o_owner, null
  from public.crm_derive(p_module, d) as dv;
  insert into public.crm_audit (module, record_id, action, actor)
  values (p_module, p_id, 'created', 'MAGPPIE CRM user');
  return p_id;
end
$function$;

CREATE OR REPLACE FUNCTION public.crm_archive_source_record(
  p_source_org_id text,
  p_module text,
  p_record_id text,
  p_deleted_time timestamp with time zone,
  p_deletion_type text,
  p_observed_at timestamp with time zone,
  p_expected_modified_time timestamp with time zone,
  p_expected_source_seen_at timestamp with time zone,
  s text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET lock_timeout TO '2s'
 SET statement_timeout TO '15s'
AS $function$
declare
  v_lock jsonb;
  v_record public.crm_records%rowtype;
  v_current public.crm_record_tombstones%rowtype;
  v_has_record boolean := false;
  v_has_current boolean := false;
  v_snapshot jsonb;
begin
  if not exists (select 1 from public.crm_secret where secret = s) then
    raise exception using errcode = '42501', message = 'unauthorized';
  end if;

  if p_source_org_id is null
    or p_source_org_id !~ '^org[0-9]{8,32}$'
    or p_module is null
    or p_module not in (
      'Leads', 'Contacts', 'Accounts', 'Deals', 'Tasks', 'Events', 'Calls', 'Products',
      'Vendors', 'Developers', 'Referral_Partners', 'Payment_Milestones', 'Designers',
      'Visit_Module', 'AMS_Complaints'
    )
    or p_record_id is null
    or p_record_id !~ '^[0-9]{8,32}$'
    or p_deleted_time is null
    or p_observed_at is null
    or p_deleted_time > p_observed_at
    or p_deletion_type not in ('recycle', 'permanent')
    or ((p_expected_modified_time is null) <> (p_expected_source_seen_at is null)) then
    raise exception using errcode = '22023', message = 'invalid source-deletion archive arguments';
  end if;

  select m.data
    into v_lock
    from public.crm_meta as m
    where m.key = 'source_replication_lock';

  if v_lock is null
    or jsonb_typeof(v_lock) <> 'object'
    or v_lock ->> 'source_org_id' is distinct from p_source_org_id
    or v_lock -> 'verified' is distinct from 'true'::jsonb then
    raise exception using errcode = '42501', message = 'source replication organization lock mismatch';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(concat_ws(E'\\x1f', p_source_org_id, p_module, p_record_id), 0)
  );

  select t.*
    into v_current
    from public.crm_record_tombstones as t
    where t.source_org_id = p_source_org_id
      and t.module = p_module
      and t.record_id = p_record_id
      and t.reactivated_at is null
      and t.superseded_at is null
    for update;
  v_has_current := found;

  select r.*
    into v_record
    from public.crm_records as r
    where r.module = p_module and r.id = p_record_id
    for update;
  v_has_record := found;

  if v_has_current
    and v_current.deleted_time = p_deleted_time
    and v_current.deletion_type = p_deletion_type then
    if v_has_record then
      raise exception using errcode = '40001', message = 'source-deletion active-row tombstone conflict';
    end if;
    return jsonb_build_object(
      'processed', true,
      'applied', false,
      'outcome', 'already_archived',
      'row_present', v_current.row_present
    );
  end if;

  if v_has_record then
    if v_record.id like 'local-%'
      or v_record.data ? '__local'
      or v_record.data ? '__test'
      or jsonb_typeof(v_record.data) <> 'object'
      or v_record.data ->> 'id' is distinct from p_record_id then
      raise exception using errcode = '22023', message = 'source-deletion target is protected';
    end if;

    if p_expected_modified_time is null
      or p_expected_source_seen_at is null
      or v_record.modified_time is distinct from p_expected_modified_time
      or v_record.source_seen_at is distinct from p_expected_source_seen_at then
      raise exception using errcode = '40001', message = 'source-deletion expected-row conflict';
    end if;

    if v_record.source_seen_at > p_observed_at
      or v_record.modified_time > p_deleted_time then
      return jsonb_build_object(
        'processed', true,
        'applied', false,
        'outcome', 'noop_stale',
        'row_present', true
      );
    end if;

  elsif p_expected_modified_time is not null or p_expected_source_seen_at is not null then
    raise exception using errcode = '40001', message = 'source-deletion expected-row conflict';
  end if;

  if v_has_current then
    if v_current.deleted_time > p_deleted_time
      or (
        v_current.deleted_time = p_deleted_time
        and v_current.deletion_type = 'permanent'
      ) then
      return jsonb_build_object(
        'processed', true,
        'applied', false,
        'outcome', 'noop_stale',
        'row_present', v_has_record
      );
    end if;

    update public.crm_record_tombstones
      set superseded_at = p_observed_at,
          superseded_by_deleted_time = p_deleted_time
      where id = v_current.id
        and reactivated_at is null
        and superseded_at is null;
  end if;

  if v_has_record then
    v_snapshot := to_jsonb(v_record);
  else
    v_snapshot := jsonb_build_object(
      'module', p_module,
      'id', p_record_id,
      'data', jsonb_build_object('id', p_record_id)
    );
  end if;

  insert into public.crm_record_tombstones (
    source_org_id, module, record_id, deleted_time, deletion_type,
    observed_at, row_present, record_snapshot,
    snapshot_modified_time, snapshot_source_seen_at
  ) values (
    p_source_org_id, p_module, p_record_id, p_deleted_time, p_deletion_type,
    p_observed_at, v_has_record, v_snapshot,
    case when v_has_record then v_record.modified_time else null end,
    case when v_has_record then v_record.source_seen_at else null end
  );

  if v_has_record then
    delete from public.crm_records
      where module = p_module
        and id = p_record_id
        and modified_time is not distinct from p_expected_modified_time
        and source_seen_at is not distinct from p_expected_source_seen_at;
    if not found then
      raise exception using errcode = '40001', message = 'source-deletion expected-row conflict';
    end if;
  end if;

  insert into public.crm_audit (module, record_id, action, changes, actor)
  values (
    p_module,
    p_record_id,
    case when v_has_record then 'source_archived' else 'source_deleted_absent' end,
    jsonb_build_object(
      'deletion_type', p_deletion_type,
      'deleted_time', p_deleted_time,
      'observed_at', p_observed_at,
      'row_present', v_has_record
    ),
    'MAGPPIE CRM replication'
  );

  return jsonb_build_object(
    'processed', true,
    'applied', true,
    'outcome', case when v_has_record then 'archived' else 'tombstone_recorded' end,
    'row_present', v_has_record
  );
end
$function$;
CREATE OR REPLACE FUNCTION public.crm_acquire_replication_lease(
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
  v_acquired boolean := false;
begin
  if not exists (select 1 from public.crm_secret where secret = s) then
    raise exception using errcode = '42501', message = 'unauthorized';
  end if;
  if p_owner_id is null or p_ttl_seconds is null or p_ttl_seconds < 5 or p_ttl_seconds > 300 then
    raise exception using errcode = '22023', message = 'invalid replication lease arguments';
  end if;

  insert into public.crm_replication_leases (lease_key, owner_id, acquired_at, expires_at)
  values (
    'source-deletion-sync-v1',
    p_owner_id,
    v_now,
    v_now + make_interval(secs => p_ttl_seconds)
  )
  on conflict (lease_key) do update
    set owner_id = excluded.owner_id,
        acquired_at = excluded.acquired_at,
        expires_at = excluded.expires_at
    where crm_replication_leases.expires_at <= v_now
      or crm_replication_leases.owner_id = excluded.owner_id;
  v_acquired := found;

  return jsonb_build_object('acquired', v_acquired, 'lease_key', 'source-deletion-sync-v1');
end
$function$;
CREATE OR REPLACE FUNCTION public.crm_release_replication_lease(p_owner_id uuid, s text)
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
    raise exception using errcode = '22023', message = 'invalid replication lease arguments';
  end if;

  delete from public.crm_replication_leases
    where lease_key = 'source-deletion-sync-v1' and owner_id = p_owner_id;
  v_released := found;
  return jsonb_build_object('released', v_released, 'lease_key', 'source-deletion-sync-v1');
end
$function$;

CREATE OR REPLACE FUNCTION public.crm_patch(p_module text, p_id text, patch jsonb, s text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '15s'
AS $function$
declare olddata jsonb; newdata jsonb; diffs jsonb;
begin
  if not exists (select 1 from crm_secret where secret = s) then raise exception 'unauthorized'; end if;
  select data into olddata from crm_records where module = p_module and id = p_id;
  if olddata is null then raise exception 'record not found'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('field', k, 'from', olddata->k, 'to', patch->k)), '[]'::jsonb)
    into diffs
    from jsonb_object_keys(patch) k
    where left(k, 2) <> '__' and (olddata->k) is distinct from (patch->k);
  update crm_records
    set data = data || patch || jsonb_build_object('Modified_Time', to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS+05:30')),
        modified_time = now()
    where module = p_module and id = p_id
    returning data into newdata;
  update crm_records set (status, due_date, ts2, owner) = (select * from crm_derive(p_module, newdata)),
    name = coalesce(case when p_module='Leads' then newdata->>'Full_Name' when p_module='Deals' then newdata->>'Deal_Name' else name end, name)
    where module = p_module and id = p_id;
  if jsonb_array_length(diffs) > 0 then
    insert into crm_audit (module, record_id, action, changes, actor)
    values (p_module, p_id, 'updated', diffs, 'MAGPPIE CRM user');
  end if;
  return newdata;
end $function$;

-- Atomic local Blueprint execution: guarded record patch, optional Note, and audit events.
CREATE OR REPLACE FUNCTION public.crm_blueprint_transition(
  p_module text,
  p_id text,
  p_state_field text,
  p_expected_state text,
  p_expected_modified_time timestamp with time zone,
  p_next_state text,
  p_blueprint_id text,
  p_blueprint_name text,
  p_transition_id text,
  p_transition_name text,
  p_patch jsonb,
  s text,
  p_note_id text DEFAULT NULL,
  p_note_title text DEFAULT NULL,
  p_note_content text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '15s'
AS $function$
declare
  v_olddata jsonb;
  v_old_modified_time timestamp with time zone;
  v_current_state text;
  v_business_patch jsonb;
  v_newdata jsonb;
  v_diffs jsonb;
  v_changed_at timestamp with time zone;
  v_changed_text text;
  v_status text;
  v_due_date text;
  v_ts2 text;
  v_owner text;
  v_note_data jsonb;
  v_note_status text;
  v_note_due_date text;
  v_note_ts2 text;
  v_note_owner text;
  v_has_note boolean;
begin
  if not exists (select 1 from public.crm_secret where secret = s) then
    raise exception using errcode = '42501', message = 'unauthorized';
  end if;

  if nullif(btrim(p_module), '') is null
    or nullif(btrim(p_id), '') is null
    or nullif(btrim(p_blueprint_id), '') is null
    or nullif(btrim(p_blueprint_name), '') is null
    or nullif(btrim(p_transition_id), '') is null
    or nullif(btrim(p_transition_name), '') is null
    or nullif(btrim(p_next_state), '') is null
    or p_expected_modified_time is null then
    raise exception using errcode = '22023', message = 'invalid Blueprint transition arguments';
  end if;

  if p_state_field is null
    or p_state_field !~ '^[A-Za-z][A-Za-z0-9_$]*$'
    or p_state_field in ('id', 'Created_Time', 'Modified_Time') then
    raise exception using errcode = '22023', message = 'invalid Blueprint state field';
  end if;

  if p_module !~ '^[A-Za-z][A-Za-z0-9_$]{0,159}$'
    or p_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
    or p_blueprint_id !~ '^[0-9]{1,30}$'
    or p_transition_id !~ '^[0-9]{1,30}$'
    or nullif(btrim(p_expected_state), '') is null
    or char_length(p_expected_state) > 500
    or char_length(p_next_state) > 500
    or char_length(p_blueprint_name) > 500
    or char_length(p_transition_name) > 500
    or p_expected_state ~ '[[:cntrl:]]'
    or p_next_state ~ '[[:cntrl:]]'
    or p_blueprint_name ~ '[[:cntrl:]]'
    or p_transition_name ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'invalid bounded Blueprint transition arguments';
  end if;

  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception using errcode = '22023', message = 'Blueprint patch must be a JSON object';
  end if;

  if p_patch ?| array['id', 'Created_Time', 'Modified_Time']
    or p_patch ? p_state_field
    or (select count(*) from jsonb_object_keys(p_patch)) > 64
    or exists (
      select 1
      from jsonb_each(p_patch) as patch_entries(key_name, field_value)
      where key_name !~ '^[A-Za-z][A-Za-z0-9_$]*$'
        or jsonb_typeof(field_value) not in ('string', 'number', 'boolean', 'null')
        or (jsonb_typeof(field_value) = 'string' and char_length(field_value #>> '{}') > 100000)
    ) then
    raise exception using errcode = '22023', message = 'Blueprint patch contains a protected field';
  end if;

  v_has_note := nullif(btrim(coalesce(p_note_content, '')), '') is not null;
  if v_has_note then
    if p_note_id is null
      or p_note_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
      or nullif(btrim(coalesce(p_note_title, '')), '') is null
      or char_length(coalesce(p_note_title, '')) > 500
      or char_length(p_note_content) > 100000 then
      raise exception using errcode = '22023', message = 'invalid Blueprint Note arguments';
    end if;
  elsif p_note_id is not null or nullif(btrim(coalesce(p_note_title, '')), '') is not null then
    raise exception using errcode = '22023', message = 'Blueprint Note metadata requires Note content';
  end if;

  select r.data, r.modified_time
    into v_olddata, v_old_modified_time
    from public.crm_records as r
    where r.module = p_module and r.id = p_id
    for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Blueprint record not found';
  end if;

  if jsonb_typeof(v_olddata) <> 'object' then
    raise exception using errcode = '22023', message = 'Blueprint record data must be a JSON object';
  end if;

  if (v_olddata ->> 'id') is distinct from p_id then
    raise exception using errcode = '22023', message = 'Blueprint record identity mismatch';
  end if;

  v_current_state := v_olddata ->> p_state_field;
  if v_current_state is distinct from p_expected_state then
    raise exception using errcode = '40001', message = 'Blueprint expected-current-state conflict';
  end if;

  if v_old_modified_time is distinct from p_expected_modified_time then
    raise exception using errcode = '40001', message = 'Blueprint expected-modified-time conflict';
  end if;

  v_changed_at := greatest(
    clock_timestamp(),
    v_old_modified_time + interval '1 microsecond'
  );
  v_changed_text := to_char(
    v_changed_at at time zone 'Asia/Kolkata',
    'YYYY-MM-DD"T"HH24:MI:SS.US'
  ) || '+05:30';
  v_business_patch := p_patch || jsonb_build_object(p_state_field, p_next_state);
  v_newdata := v_olddata || v_business_patch || jsonb_build_object('Modified_Time', v_changed_text);

  select d.o_status, d.o_due, d.o_ts2, d.o_owner
    into v_status, v_due_date, v_ts2, v_owner
    from public.crm_derive(p_module, v_newdata) as d;

  select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'field', patch_keys.key_name,
          'from', v_olddata -> patch_keys.key_name,
          'to', v_business_patch -> patch_keys.key_name
        )
        order by patch_keys.key_name
      ),
      '[]'::jsonb
    )
    into v_diffs
    from jsonb_object_keys(v_business_patch) as patch_keys(key_name)
    where (v_olddata -> patch_keys.key_name)
      is distinct from (v_business_patch -> patch_keys.key_name);

  update public.crm_records as target
    set data = v_newdata,
        modified_time = v_changed_at,
        status = v_status,
        due_date = v_due_date,
        ts2 = v_ts2,
        owner = v_owner,
        name = coalesce(
          case
            when p_module = 'Leads' then v_newdata ->> 'Full_Name'
            when p_module = 'Deals' then v_newdata ->> 'Deal_Name'
            else target.name
          end,
          target.name
        )
    where target.module = p_module and target.id = p_id;

  if jsonb_array_length(v_diffs) > 0 then
    insert into public.crm_audit (module, record_id, action, changes, actor)
    values (p_module, p_id, 'updated', v_diffs, 'MAGPPIE CRM user');
  end if;

  if v_has_note then
    v_note_data := jsonb_build_object(
      'id', p_note_id,
      'Note_Title', coalesce(p_note_title, ''),
      'Note_Content', p_note_content,
      'Parent_Id', jsonb_build_object('id', p_id),
      'Created_Time', v_changed_text,
      'Modified_Time', v_changed_text,
      'Created_By', jsonb_build_object('name', 'MAGPPIE CRM')
    );

    select d.o_status, d.o_due, d.o_ts2, d.o_owner
      into v_note_status, v_note_due_date, v_note_ts2, v_note_owner
      from public.crm_derive('Notes', v_note_data) as d;

    insert into public.crm_records (
      module, id, data, name, search_text, created_time, modified_time,
      status, due_date, ts2, owner
    ) values (
      'Notes',
      p_note_id,
      v_note_data,
      nullif(p_note_title, ''),
      left(concat_ws(' ', nullif(p_note_title, ''), p_note_content), 300),
      v_changed_at,
      v_changed_at,
      v_note_status,
      v_note_due_date,
      v_note_ts2,
      v_note_owner
    );

    insert into public.crm_audit (module, record_id, action, changes, actor)
    values ('Notes', p_note_id, 'created', null, 'MAGPPIE CRM user');

    insert into public.crm_audit (module, record_id, action, changes, actor)
    values (
      p_module,
      p_id,
      'note_added',
      jsonb_build_object('note_id', p_note_id),
      'MAGPPIE CRM user'
    );
  end if;

  insert into public.crm_audit (module, record_id, action, changes, actor)
  values (
    p_module,
    p_id,
    'blueprint_transition',
    jsonb_build_object(
      'blueprint_id', p_blueprint_id,
      'blueprint', p_blueprint_name,
      'transition_id', p_transition_id,
      'transition', p_transition_name,
      'from', p_expected_state,
      'to', p_next_state,
      'note_id', case when v_has_note then p_note_id else null end,
      'modified_time', v_changed_text
    ),
    'MAGPPIE CRM user'
  );

  return jsonb_build_object(
    'module', p_module,
    'record_id', p_id,
    'blueprint_id', p_blueprint_id,
    'transition_id', p_transition_id,
    'from', p_expected_state,
    'to', p_next_state,
    'modified_time', v_changed_text,
    'note_id', case when v_has_note then p_note_id else null end,
    'data', v_newdata
  );
end
$function$;

ALTER FUNCTION public.crm_blueprint_transition(
  text, text, text, text, timestamp with time zone, text,
  text, text, text, text, jsonb, text, text, text, text
) OWNER TO postgres;

DO $blueprint_transition_acl$
declare
  v_grantee text;
begin
  for v_grantee in
    select distinct grantee_role.rolname
      from pg_catalog.pg_proc as p
      cross join lateral pg_catalog.aclexplode(
        coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
      ) as privilege
      join pg_catalog.pg_roles as grantee_role on grantee_role.oid = privilege.grantee
      where p.oid = 'public.crm_blueprint_transition(text, text, text, text, timestamp with time zone, text, text, text, text, text, jsonb, text, text, text, text)'::pg_catalog.regprocedure
        and privilege.grantee <> p.proowner
  loop
    execute format(
      'REVOKE ALL PRIVILEGES ON FUNCTION public.crm_blueprint_transition(text, text, text, text, timestamp with time zone, text, text, text, text, text, jsonb, text, text, text, text) FROM %I CASCADE',
      v_grantee
    );
  end loop;
end
$blueprint_transition_acl$;

REVOKE ALL PRIVILEGES ON FUNCTION public.crm_blueprint_transition(
  text, text, text, text, timestamp with time zone, text,
  text, text, text, text, jsonb, text, text, text, text
) FROM PUBLIC CASCADE;
GRANT EXECUTE ON FUNCTION public.crm_blueprint_transition(
  text, text, text, text, timestamp with time zone, text,
  text, text, text, text, jsonb, text, text, text, text
) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.crm_log(p_module text, p_record text, p_action text, p_changes jsonb, s text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from crm_secret where secret = s) then raise exception 'unauthorized'; end if;
  insert into crm_audit (module, record_id, action, changes, actor) values (p_module, p_record, p_action, p_changes, 'MAGPPIE CRM user');
end $function$;

GRANT DELETE ON TABLE public."crm_audit" TO "anon";
GRANT INSERT ON TABLE public."crm_audit" TO "anon";
GRANT REFERENCES ON TABLE public."crm_audit" TO "anon";
GRANT SELECT ON TABLE public."crm_audit" TO "anon";
GRANT TRIGGER ON TABLE public."crm_audit" TO "anon";
GRANT TRUNCATE ON TABLE public."crm_audit" TO "anon";
GRANT UPDATE ON TABLE public."crm_audit" TO "anon";
GRANT DELETE ON TABLE public."crm_audit" TO "authenticated";
GRANT INSERT ON TABLE public."crm_audit" TO "authenticated";
GRANT REFERENCES ON TABLE public."crm_audit" TO "authenticated";
GRANT SELECT ON TABLE public."crm_audit" TO "authenticated";
GRANT TRIGGER ON TABLE public."crm_audit" TO "authenticated";
GRANT TRUNCATE ON TABLE public."crm_audit" TO "authenticated";
GRANT UPDATE ON TABLE public."crm_audit" TO "authenticated";
GRANT DELETE ON TABLE public."crm_audit" TO "service_role";
GRANT INSERT ON TABLE public."crm_audit" TO "service_role";
GRANT REFERENCES ON TABLE public."crm_audit" TO "service_role";
GRANT SELECT ON TABLE public."crm_audit" TO "service_role";
GRANT TRIGGER ON TABLE public."crm_audit" TO "service_role";
GRANT TRUNCATE ON TABLE public."crm_audit" TO "service_role";
GRANT UPDATE ON TABLE public."crm_audit" TO "service_role";
GRANT DELETE ON TABLE public."crm_meta" TO "anon";
GRANT INSERT ON TABLE public."crm_meta" TO "anon";
GRANT REFERENCES ON TABLE public."crm_meta" TO "anon";
GRANT SELECT ON TABLE public."crm_meta" TO "anon";
GRANT TRIGGER ON TABLE public."crm_meta" TO "anon";
GRANT TRUNCATE ON TABLE public."crm_meta" TO "anon";
GRANT UPDATE ON TABLE public."crm_meta" TO "anon";
GRANT DELETE ON TABLE public."crm_meta" TO "authenticated";
GRANT INSERT ON TABLE public."crm_meta" TO "authenticated";
GRANT REFERENCES ON TABLE public."crm_meta" TO "authenticated";
GRANT SELECT ON TABLE public."crm_meta" TO "authenticated";
GRANT TRIGGER ON TABLE public."crm_meta" TO "authenticated";
GRANT TRUNCATE ON TABLE public."crm_meta" TO "authenticated";
GRANT UPDATE ON TABLE public."crm_meta" TO "authenticated";
GRANT DELETE ON TABLE public."crm_meta" TO "service_role";
GRANT INSERT ON TABLE public."crm_meta" TO "service_role";
GRANT REFERENCES ON TABLE public."crm_meta" TO "service_role";
GRANT SELECT ON TABLE public."crm_meta" TO "service_role";
GRANT TRIGGER ON TABLE public."crm_meta" TO "service_role";
GRANT TRUNCATE ON TABLE public."crm_meta" TO "service_role";
GRANT UPDATE ON TABLE public."crm_meta" TO "service_role";
GRANT DELETE ON TABLE public."crm_records" TO "anon";
GRANT INSERT ON TABLE public."crm_records" TO "anon";
GRANT REFERENCES ON TABLE public."crm_records" TO "anon";
GRANT SELECT ON TABLE public."crm_records" TO "anon";
GRANT TRIGGER ON TABLE public."crm_records" TO "anon";
GRANT TRUNCATE ON TABLE public."crm_records" TO "anon";
GRANT UPDATE ON TABLE public."crm_records" TO "anon";
GRANT DELETE ON TABLE public."crm_records" TO "authenticated";
GRANT INSERT ON TABLE public."crm_records" TO "authenticated";
GRANT REFERENCES ON TABLE public."crm_records" TO "authenticated";
GRANT SELECT ON TABLE public."crm_records" TO "authenticated";
GRANT TRIGGER ON TABLE public."crm_records" TO "authenticated";
GRANT TRUNCATE ON TABLE public."crm_records" TO "authenticated";
GRANT UPDATE ON TABLE public."crm_records" TO "authenticated";
GRANT DELETE ON TABLE public."crm_records" TO "service_role";
GRANT INSERT ON TABLE public."crm_records" TO "service_role";
GRANT REFERENCES ON TABLE public."crm_records" TO "service_role";
GRANT SELECT ON TABLE public."crm_records" TO "service_role";
GRANT TRIGGER ON TABLE public."crm_records" TO "service_role";
GRANT TRUNCATE ON TABLE public."crm_records" TO "service_role";
GRANT UPDATE ON TABLE public."crm_records" TO "service_role";
GRANT DELETE ON TABLE public."crm_secret" TO "anon";
GRANT INSERT ON TABLE public."crm_secret" TO "anon";
GRANT REFERENCES ON TABLE public."crm_secret" TO "anon";
GRANT SELECT ON TABLE public."crm_secret" TO "anon";
GRANT TRIGGER ON TABLE public."crm_secret" TO "anon";
GRANT TRUNCATE ON TABLE public."crm_secret" TO "anon";
GRANT UPDATE ON TABLE public."crm_secret" TO "anon";
GRANT DELETE ON TABLE public."crm_secret" TO "authenticated";
GRANT INSERT ON TABLE public."crm_secret" TO "authenticated";
GRANT REFERENCES ON TABLE public."crm_secret" TO "authenticated";
GRANT SELECT ON TABLE public."crm_secret" TO "authenticated";
GRANT TRIGGER ON TABLE public."crm_secret" TO "authenticated";
GRANT TRUNCATE ON TABLE public."crm_secret" TO "authenticated";
GRANT UPDATE ON TABLE public."crm_secret" TO "authenticated";
GRANT DELETE ON TABLE public."crm_secret" TO "service_role";
GRANT INSERT ON TABLE public."crm_secret" TO "service_role";
GRANT REFERENCES ON TABLE public."crm_secret" TO "service_role";
GRANT SELECT ON TABLE public."crm_secret" TO "service_role";
GRANT TRIGGER ON TABLE public."crm_secret" TO "service_role";
GRANT TRUNCATE ON TABLE public."crm_secret" TO "service_role";
GRANT UPDATE ON TABLE public."crm_secret" TO "service_role";
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO "anon";
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO "authenticated";
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO "service_role";

ALTER TABLE public.crm_record_tombstones OWNER TO postgres;
ALTER TABLE public.crm_replication_leases OWNER TO postgres;
ALTER SEQUENCE public.crm_record_tombstones_id_seq OWNER TO postgres;

ALTER FUNCTION public.crm_archive_source_record(
  text, text, text, timestamp with time zone, text, timestamp with time zone,
  timestamp with time zone, timestamp with time zone, text
) OWNER TO postgres;
ALTER FUNCTION public.crm_bulk_upsert(jsonb, text) OWNER TO postgres;
ALTER FUNCTION public.crm_insert(text, text, jsonb, text, text, text) OWNER TO postgres;
ALTER FUNCTION public.crm_acquire_replication_lease(uuid, integer, text) OWNER TO postgres;
ALTER FUNCTION public.crm_release_replication_lease(uuid, text) OWNER TO postgres;

DO $source_deletion_acl$
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
          'public.crm_archive_source_record(text, text, text, timestamp with time zone, text, timestamp with time zone, timestamp with time zone, timestamp with time zone, text)'::pg_catalog.regprocedure,
          'public.crm_bulk_upsert(jsonb, text)'::pg_catalog.regprocedure,
          'public.crm_insert(text, text, jsonb, text, text, text)'::pg_catalog.regprocedure,
          'public.crm_acquire_replication_lease(uuid, integer, text)'::pg_catalog.regprocedure,
          'public.crm_release_replication_lease(uuid, text)'::pg_catalog.regprocedure
        )
  loop
    for v_grantee in
      select distinct grantee_role.rolname
        from pg_catalog.aclexplode(
          coalesce((select proacl from pg_catalog.pg_proc where oid = v_object.oid), pg_catalog.acldefault('f', v_object.proowner))
        ) as privilege
        join pg_catalog.pg_roles as grantee_role on grantee_role.oid = privilege.grantee
        where privilege.grantee <> v_object.proowner
    loop
      execute pg_catalog.format('REVOKE ALL PRIVILEGES ON FUNCTION %s FROM %I CASCADE', v_object.signature, v_grantee);
    end loop;
  end loop;

  for v_object in
    select relation.oid, namespace_catalog.nspname, relation.relname, relation.relowner
      from pg_catalog.pg_class as relation
      join pg_catalog.pg_namespace as namespace_catalog on namespace_catalog.oid = relation.relnamespace
      where namespace_catalog.nspname = 'public'
        and relation.relname in ('crm_record_tombstones', 'crm_replication_leases')
        and relation.relkind = 'r'
  loop
    for v_grantee in
      select distinct grantee_role.rolname
        from pg_catalog.aclexplode(
          coalesce(
            (select relacl from pg_catalog.pg_class where oid = v_object.oid),
            pg_catalog.acldefault('r', v_object.relowner)
          )
        ) as privilege
        join pg_catalog.pg_roles as grantee_role on grantee_role.oid = privilege.grantee
        where privilege.grantee <> v_object.relowner
    loop
      execute pg_catalog.format(
        'REVOKE ALL PRIVILEGES ON TABLE %I.%I FROM %I CASCADE',
        v_object.nspname,
        v_object.relname,
        v_grantee
      );
    end loop;
  end loop;
end
$source_deletion_acl$;

REVOKE ALL PRIVILEGES ON FUNCTION public.crm_archive_source_record(
  text, text, text, timestamp with time zone, text, timestamp with time zone,
  timestamp with time zone, timestamp with time zone, text
) FROM PUBLIC CASCADE;
REVOKE ALL PRIVILEGES ON FUNCTION public.crm_bulk_upsert(jsonb, text) FROM PUBLIC CASCADE;
REVOKE ALL PRIVILEGES ON FUNCTION public.crm_insert(text, text, jsonb, text, text, text) FROM PUBLIC CASCADE;
REVOKE ALL PRIVILEGES ON FUNCTION public.crm_acquire_replication_lease(uuid, integer, text) FROM PUBLIC CASCADE;
REVOKE ALL PRIVILEGES ON FUNCTION public.crm_release_replication_lease(uuid, text) FROM PUBLIC CASCADE;

GRANT EXECUTE ON FUNCTION public.crm_archive_source_record(
  text, text, text, timestamp with time zone, text, timestamp with time zone,
  timestamp with time zone, timestamp with time zone, text
) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_bulk_upsert(jsonb, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_insert(text, text, jsonb, text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_acquire_replication_lease(uuid, integer, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_release_replication_lease(uuid, text) TO anon, authenticated, service_role;

REVOKE ALL PRIVILEGES ON TABLE public.crm_record_tombstones
  FROM PUBLIC, anon, authenticated, service_role CASCADE;
REVOKE ALL PRIVILEGES ON SEQUENCE public.crm_record_tombstones_id_seq
  FROM PUBLIC, anon, authenticated, service_role CASCADE;
REVOKE ALL PRIVILEGES ON TABLE public.crm_replication_leases
  FROM PUBLIC, anon, authenticated, service_role CASCADE;

COMMIT;
