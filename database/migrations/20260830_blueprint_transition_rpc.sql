-- Staged transactional RPC for local-only Blueprint execution.
-- This migration is not installed automatically. The wired runtime remains
-- disabled until exact catalog/canary verification and identity authorization.
-- Apply only through an authorized PostgreSQL DDL session after review.

BEGIN;

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

COMMIT;
