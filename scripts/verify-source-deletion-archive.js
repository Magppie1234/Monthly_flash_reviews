#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MIGRATION_PATH = path.join(
  ROOT,
  'database',
  'migrations',
  '20260830_source_deletion_archive.sql',
);
const DEFAULT_VERIFICATION_TIMEOUT_MS = 5_000;
const EXPECTED_OWNER = 'postgres';
const FUNCTION_CONTRACTS = Object.freeze({
  crm_archive_source_record: Object.freeze({
    argument_names: Object.freeze([
      'p_source_org_id', 'p_module', 'p_record_id', 'p_deleted_time', 'p_deletion_type',
      'p_observed_at', 'p_expected_modified_time', 'p_expected_source_seen_at', 's',
    ]),
    argument_types: Object.freeze([
      'text', 'text', 'text', 'timestamp with time zone', 'text', 'timestamp with time zone',
      'timestamp with time zone', 'timestamp with time zone', 'text',
    ]),
    result_type: 'jsonb',
    settings: Object.freeze(['lock_timeout=2s', 'search_path=public', 'statement_timeout=15s']),
  }),
  crm_bulk_upsert: Object.freeze({
    argument_names: Object.freeze(['rows', 's']),
    argument_types: Object.freeze(['jsonb', 'text']),
    result_type: 'integer',
    settings: Object.freeze(['lock_timeout=2s', 'search_path=public', 'statement_timeout=120s']),
  }),
  crm_insert: Object.freeze({
    argument_names: Object.freeze(['p_module', 'p_id', 'd', 'p_name', 'p_search', 's']),
    argument_types: Object.freeze(['text', 'text', 'jsonb', 'text', 'text', 'text']),
    result_type: 'text',
    settings: Object.freeze(['search_path=public', 'statement_timeout=15s']),
  }),
  crm_acquire_replication_lease: Object.freeze({
    argument_names: Object.freeze(['p_owner_id', 'p_ttl_seconds', 's']),
    argument_types: Object.freeze(['uuid', 'integer', 'text']),
    result_type: 'jsonb',
    settings: Object.freeze(['lock_timeout=2s', 'search_path=public', 'statement_timeout=5s']),
  }),
  crm_release_replication_lease: Object.freeze({
    argument_names: Object.freeze(['p_owner_id', 's']),
    argument_types: Object.freeze(['uuid', 'text']),
    result_type: 'jsonb',
    settings: Object.freeze(['lock_timeout=2s', 'search_path=public', 'statement_timeout=5s']),
  }),
});
const EXPECTED_FUNCTION_NAMES = Object.freeze(Object.keys(FUNCTION_CONTRACTS).sort());
const EXPECTED_FUNCTION_ACL = Object.freeze([
  Object.freeze({ grantor: 'postgres', grantee: 'anon', privilege_type: 'EXECUTE', is_grantable: false }),
  Object.freeze({ grantor: 'postgres', grantee: 'authenticated', privilege_type: 'EXECUTE', is_grantable: false }),
  Object.freeze({ grantor: 'postgres', grantee: 'postgres', privilege_type: 'EXECUTE', is_grantable: false }),
  Object.freeze({ grantor: 'postgres', grantee: 'service_role', privilege_type: 'EXECUTE', is_grantable: false }),
]);
const EXPECTED_TABLE_ACL = Object.freeze([
  'DELETE', 'INSERT', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE',
].map(privilege => Object.freeze({
  grantor: 'postgres',
  grantee: 'postgres',
  privilege_type: privilege,
  is_grantable: false,
})));
const EXPECTED_COLUMNS = Object.freeze({
  crm_record_tombstones: Object.freeze([
    ['id', 'bigint', true, null, 'a'],
    ['source_org_id', 'text', true, null, ''],
    ['module', 'text', true, null, ''],
    ['record_id', 'text', true, null, ''],
    ['deleted_time', 'timestamp with time zone', true, null, ''],
    ['deletion_type', 'text', true, null, ''],
    ['observed_at', 'timestamp with time zone', true, null, ''],
    ['archived_at', 'timestamp with time zone', true, 'clock_timestamp()', ''],
    ['row_present', 'boolean', true, null, ''],
    ['record_snapshot', 'jsonb', true, null, ''],
    ['snapshot_modified_time', 'timestamp with time zone', false, null, ''],
    ['snapshot_source_seen_at', 'timestamp with time zone', false, null, ''],
    ['reactivated_at', 'timestamp with time zone', false, null, ''],
    ['reactivated_by_modified_time', 'timestamp with time zone', false, null, ''],
    ['reactivated_by_source_seen_at', 'timestamp with time zone', false, null, ''],
    ['superseded_at', 'timestamp with time zone', false, null, ''],
    ['superseded_by_deleted_time', 'timestamp with time zone', false, null, ''],
  ].map(([name, type, not_null, default_expression, identity]) => Object.freeze({
    name, type, not_null, default_expression, identity,
  }))),
  crm_replication_leases: Object.freeze([
    ['lease_key', 'text', true, null, ''],
    ['owner_id', 'uuid', true, null, ''],
    ['acquired_at', 'timestamp with time zone', true, null, ''],
    ['expires_at', 'timestamp with time zone', true, null, ''],
  ].map(([name, type, not_null, default_expression, identity]) => Object.freeze({
    name, type, not_null, default_expression, identity,
  }))),
});
const EXPECTED_CONSTRAINT_NAMES = Object.freeze({
  crm_record_tombstones: Object.freeze([
    'crm_record_tombstones_deletion_event_key',
    'crm_record_tombstones_deletion_type',
    'crm_record_tombstones_module_safe',
    'crm_record_tombstones_pkey',
    'crm_record_tombstones_reactivation_consistency',
    'crm_record_tombstones_record_id_format',
    'crm_record_tombstones_row_snapshot',
    'crm_record_tombstones_snapshot_identity',
    'crm_record_tombstones_snapshot_object',
    'crm_record_tombstones_source_org_format',
    'crm_record_tombstones_supersession_consistency',
    'crm_record_tombstones_terminal_state',
    'crm_record_tombstones_time_order',
  ]),
  crm_replication_leases: Object.freeze([
    'crm_replication_leases_fixed_key',
    'crm_replication_leases_pkey',
    'crm_replication_leases_time_order',
  ]),
});
const EXPECTED_INDEX_NAMES = Object.freeze({
  crm_record_tombstones: Object.freeze([
    'crm_record_tombstones_current_idx',
    'crm_record_tombstones_deleted_idx',
    'crm_record_tombstones_deletion_event_key',
    'crm_record_tombstones_pkey',
    'crm_record_tombstones_reactivated_idx',
    'crm_record_tombstones_record_history_idx',
  ]),
  crm_replication_leases: Object.freeze([
    'crm_replication_leases_expiry_idx',
    'crm_replication_leases_pkey',
  ]),
});

// The only database inspection statement is constant, catalog-only, and
// returns definitions rather than CRM rows or tombstone snapshots.
const CATALOG_QUERY = `select
  coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'name', p.proname,
        'argument_types', array(select pg_catalog.format_type(arg_type, null) from unnest(p.proargtypes) with ordinality as args(arg_type, position) order by position),
        'argument_names', p.proargnames,
        'argument_modes', p.proargmodes,
        'default_count', p.pronargdefaults,
        'result_type', p.prorettype::pg_catalog.regtype::text,
        'returns_set', p.proretset,
        'function_kind', p.prokind,
        'language', language_catalog.lanname,
        'owner_name', owner_role.rolname,
        'security_definer', p.prosecdef,
        'volatility', p.provolatile,
        'settings', array(select setting from unnest(coalesce(p.proconfig, array[]::text[])) as configured(setting) order by setting collate "C"),
        'source', p.prosrc,
        'explicit_acl', p.proacl is not null,
        'public_execute_revoked', not exists (
          select 1 from pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) as privilege
          where privilege.grantee = 0 and privilege.privilege_type = 'EXECUTE'
        ),
        'direct_acl', coalesce((
          select jsonb_agg(jsonb_build_object(
            'grantor', grantor_role.rolname,
            'grantee', case when privilege.grantee = 0 then 'PUBLIC' else grantee_role.rolname end,
            'privilege_type', privilege.privilege_type,
            'is_grantable', privilege.is_grantable
          ) order by (case when privilege.grantee = 0 then 'PUBLIC' else grantee_role.rolname end) collate "C", privilege.privilege_type collate "C")
          from pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) as privilege
          join pg_catalog.pg_roles as grantor_role on grantor_role.oid = privilege.grantor
          left join pg_catalog.pg_roles as grantee_role on grantee_role.oid = privilege.grantee
        ), '[]'::jsonb),
        'unintended_effective_execute_roles', coalesce((
          select jsonb_agg(candidate.rolname order by candidate.rolname)
          from pg_catalog.pg_roles as candidate
          where candidate.rolsuper = false
            and candidate.rolname not in (owner_role.rolname, 'anon', 'authenticated', 'service_role')
            and pg_catalog.has_function_privilege(candidate.oid, p.oid, 'EXECUTE')
        ), '[]'::jsonb),
        'anon_execute', pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'),
        'authenticated_execute', pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'),
        'service_role_execute', pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
      ) order by p.proname collate "C"
    )
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as function_namespace on function_namespace.oid = p.pronamespace
    join pg_catalog.pg_language as language_catalog on language_catalog.oid = p.prolang
    join pg_catalog.pg_roles as owner_role on owner_role.oid = p.proowner
    where function_namespace.nspname = 'public'
      and p.proname in (
        'crm_archive_source_record', 'crm_bulk_upsert', 'crm_insert',
        'crm_acquire_replication_lease', 'crm_release_replication_lease'
      )
  ), '[]'::jsonb) as functions,
  coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'name', relation.relname,
        'owner_name', owner_role.rolname,
        'row_security', relation.relrowsecurity,
        'force_row_security', relation.relforcerowsecurity,
        'policy_count', (select count(*) from pg_catalog.pg_policy as policy where policy.polrelid = relation.oid),
        'columns', coalesce((
          select jsonb_agg(jsonb_build_object(
            'name', attribute.attname,
            'type', pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
            'not_null', attribute.attnotnull,
            'default_expression', pg_catalog.pg_get_expr(default_catalog.adbin, default_catalog.adrelid),
            'identity', attribute.attidentity::text
          ) order by attribute.attnum)
          from pg_catalog.pg_attribute as attribute
          left join pg_catalog.pg_attrdef as default_catalog
            on default_catalog.adrelid = attribute.attrelid and default_catalog.adnum = attribute.attnum
          where attribute.attrelid = relation.oid and attribute.attnum > 0 and not attribute.attisdropped
        ), '[]'::jsonb),
        'constraints', coalesce((
          select jsonb_agg(jsonb_build_object(
            'name', constraint_catalog.conname,
            'definition', pg_catalog.pg_get_constraintdef(constraint_catalog.oid, true)
          ) order by constraint_catalog.conname collate "C")
          from pg_catalog.pg_constraint as constraint_catalog
          where constraint_catalog.conrelid = relation.oid
        ), '[]'::jsonb),
        'indexes', coalesce((
          select jsonb_agg(jsonb_build_object(
            'name', index_relation.relname,
            'definition', pg_catalog.pg_get_indexdef(index_relation.oid)
          ) order by index_relation.relname collate "C")
          from pg_catalog.pg_index as index_catalog
          join pg_catalog.pg_class as index_relation on index_relation.oid = index_catalog.indexrelid
          where index_catalog.indrelid = relation.oid
        ), '[]'::jsonb),
        'direct_acl', coalesce((
          select jsonb_agg(jsonb_build_object(
            'grantor', grantor_role.rolname,
            'grantee', case when privilege.grantee = 0 then 'PUBLIC' else grantee_role.rolname end,
            'privilege_type', privilege.privilege_type,
            'is_grantable', privilege.is_grantable
          ) order by (case when privilege.grantee = 0 then 'PUBLIC' else grantee_role.rolname end) collate "C", privilege.privilege_type collate "C")
          from pg_catalog.aclexplode(coalesce(relation.relacl, pg_catalog.acldefault('r', relation.relowner))) as privilege
          join pg_catalog.pg_roles as grantor_role on grantor_role.oid = privilege.grantor
          left join pg_catalog.pg_roles as grantee_role on grantee_role.oid = privilege.grantee
        ), '[]'::jsonb),
        'public_access', exists (
          select 1
          from pg_catalog.aclexplode(coalesce(relation.relacl, pg_catalog.acldefault('r', relation.relowner))) as public_privilege
          where public_privilege.grantee = 0
        ),
        'anon_access', pg_catalog.has_table_privilege('anon', relation.oid, 'SELECT,' || 'IN' || 'SERT,' || 'UP' || 'DATE,' || 'DE' || 'LETE,' || 'TRUN' || 'CATE,REFERENCES,TRIGGER'),
        'authenticated_access', pg_catalog.has_table_privilege('authenticated', relation.oid, 'SELECT,' || 'IN' || 'SERT,' || 'UP' || 'DATE,' || 'DE' || 'LETE,' || 'TRUN' || 'CATE,REFERENCES,TRIGGER'),
        'service_role_access', pg_catalog.has_table_privilege('service_role', relation.oid, 'SELECT,' || 'IN' || 'SERT,' || 'UP' || 'DATE,' || 'DE' || 'LETE,' || 'TRUN' || 'CATE,REFERENCES,TRIGGER'),
        'unintended_effective_access_roles', coalesce((
          select jsonb_agg(candidate.rolname order by candidate.rolname)
          from pg_catalog.pg_roles as candidate
          where candidate.rolsuper = false
            and candidate.rolname <> owner_role.rolname
            and pg_catalog.has_table_privilege(candidate.oid, relation.oid, 'SELECT,' || 'IN' || 'SERT,' || 'UP' || 'DATE,' || 'DE' || 'LETE,' || 'TRUN' || 'CATE,REFERENCES,TRIGGER')
        ), '[]'::jsonb)
      ) order by relation.relname collate "C"
    )
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as table_namespace on table_namespace.oid = relation.relnamespace
    join pg_catalog.pg_roles as owner_role on owner_role.oid = relation.relowner
    where table_namespace.nspname = 'public'
      and relation.relkind = 'r'
      and relation.relname in ('crm_record_tombstones', 'crm_replication_leases')
  ), '[]'::jsonb) as tables,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', attribute.attname,
      'type', pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
      'not_null', attribute.attnotnull,
      'default_expression', pg_catalog.pg_get_expr(default_catalog.adbin, default_catalog.adrelid)
    ) order by attribute.attnum)
    from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_class as relation on relation.oid = attribute.attrelid
    join pg_catalog.pg_namespace as namespace_catalog on namespace_catalog.oid = relation.relnamespace
    left join pg_catalog.pg_attrdef as default_catalog
      on default_catalog.adrelid = attribute.attrelid and default_catalog.adnum = attribute.attnum
    where namespace_catalog.nspname = 'public'
      and relation.relname = 'crm_records'
      and attribute.attname = 'source_seen_at'
      and attribute.attnum > 0
      and not attribute.attisdropped
  ), '[]'::jsonb) as record_source_seen_column`;

function verifierError(message) {
  const error = new Error(message);
  error.name = 'SourceDeletionArchiveVerifierError';
  return error;
}

function connection(env = process.env) {
  const apiKey = String(env.SUPABASE_ANON_KEY || '');
  const sqlSecret = String(env.CRM_SQL_SECRET || '');
  let parsed;
  try {
    parsed = new URL(String(env.SUPABASE_URL || ''));
  } catch {
    throw verifierError('Read-only source-deletion archive verification is not configured.');
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.supabase.co')
      || parsed.username || parsed.password || !apiKey || !sqlSecret) {
    throw verifierError('Read-only source-deletion archive verification failed closed.');
  }
  return { base: parsed.origin, apiKey, sqlSecret };
}

function extractMigrationBodies(sql) {
  const source = String(sql || '');
  const bodies = {};
  for (const name of EXPECTED_FUNCTION_NAMES) {
    const expression = new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\nAS \\$function\\$\\n([\\s\\S]*?)\\n\\$function\\$;`,
    );
    const match = source.match(expression);
    if (!match) throw verifierError(`The staged ${name} contract is unavailable.`);
    bodies[name] = match[1].trim();
  }
  return Object.freeze(bodies);
}

function assertCatalogQueryIsReadOnly(query = CATALOG_QUERY) {
  const normalized = String(query || '').trim();
  if (!/^select\b/i.test(normalized) || /;\s*\S/.test(normalized)
      || /\b(?:insert|update|delete|merge|alter|drop|truncate|create|grant|revoke|copy|call|do)\b/i.test(normalized)
      || /\bfrom\s+(?:public\.)?crm_(?:records|record_tombstones|replication_leases|audit|meta|secret)\b/i.test(normalized)
      || !/\bfrom\s+pg_catalog\.pg_proc\b/i.test(normalized)
      || !/\bfrom\s+pg_catalog\.pg_class\b/i.test(normalized)) {
    throw verifierError('The source-deletion archive catalog query is not read-only.');
  }
  return normalized;
}

function assertFailClosedCanaryProof(archiveBody) {
  const body = String(archiveBody || '');
  const authentication = body.indexOf('if not exists (select 1 from public.crm_secret where secret = s) then');
  const authRejection = body.indexOf("errcode = '42501', message = 'unauthorized'", authentication);
  const invalidIdGuard = body.indexOf("p_record_id !~ '^[0-9]{8,32}$'", authRejection);
  const validationRejection = body.indexOf(
    "errcode = '22023', message = 'invalid source-deletion archive arguments'",
    invalidIdGuard,
  );
  const lockRead = body.indexOf("where m.key = 'source_replication_lock'", validationRejection);
  const tombstoneRead = body.indexOf('from public.crm_record_tombstones as t', lockRead);
  const recordRead = body.indexOf('from public.crm_records as r', tombstoneRead);
  const firstMutation = Math.min(...[
    'update public.crm_record_tombstones',
    'insert into public.crm_record_tombstones',
    'delete from public.crm_records',
    'insert into public.crm_audit',
  ].map(fragment => {
    const index = body.indexOf(fragment);
    return index === -1 ? Number.POSITIVE_INFINITY : index;
  }));
  if (!(authentication >= 0 && authentication < authRejection
      && authRejection < invalidIdGuard && invalidIdGuard < validationRejection
      && validationRejection < lockRead && lockRead < tombstoneRead
      && tombstoneRead < recordRead && recordRead < firstMutation)) {
    throw verifierError('The staged archive does not prove a non-mutating fail-closed canary.');
  }
  return true;
}

function normalizeStringArray(value) {
  return Array.isArray(value) ? value.map(item => String(item)) : [];
}

function normalizeAcl(value) {
  if (!Array.isArray(value)) return null;
  const expectedKeys = ['grantee', 'grantor', 'is_grantable', 'privilege_type'];
  const normalized = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)
        || JSON.stringify(Object.keys(item).sort()) !== JSON.stringify(expectedKeys)
        || typeof item.grantor !== 'string' || typeof item.grantee !== 'string'
        || typeof item.privilege_type !== 'string' || typeof item.is_grantable !== 'boolean') return null;
    normalized.push({
      grantor: item.grantor,
      grantee: item.grantee,
      privilege_type: item.privilege_type,
      is_grantable: item.is_grantable,
    });
  }
  return normalized;
}

function normalizeColumns(value) {
  if (!Array.isArray(value)) return null;
  return value.map(column => ({
    name: String(column?.name || ''),
    type: String(column?.type || ''),
    not_null: column?.not_null === true,
    default_expression: column?.default_expression === null ? null : String(column?.default_expression || ''),
    identity: String(column?.identity || ''),
  }));
}

function namedDefinitions(value) {
  if (!Array.isArray(value)) return null;
  return value.map(item => ({ name: String(item?.name || ''), definition: String(item?.definition || '') }));
}

function namesOf(value) {
  return value.map(item => item.name).sort();
}

function assertDefinitionEvidence(tableName, constraints, indexes) {
  const constraintText = Object.fromEntries(constraints.map(item => [item.name, item.definition]));
  const indexText = Object.fromEntries(indexes.map(item => [item.name, item.definition]));
  if (tableName === 'crm_record_tombstones') {
    const requiredConstraintEvidence = {
      crm_record_tombstones_source_org_format: /org.*0-9.*8,32/i,
      crm_record_tombstones_module_safe: /leads.*contacts.*accounts.*deals.*tasks.*events.*calls.*products.*vendors.*developers.*referral_partners.*payment_milestones.*designers.*visit_module.*ams_complaints/is,
      crm_record_tombstones_record_id_format: /0-9.*8,32/i,
      crm_record_tombstones_deletion_type: /recycle.*permanent/is,
      crm_record_tombstones_time_order: /deleted_time.*observed_at.*archived_at.*observed_at/is,
      crm_record_tombstones_snapshot_object: /jsonb_typeof.*record_snapshot.*object/is,
      crm_record_tombstones_snapshot_identity: /record_snapshot.*module.*record_id.*data.*record_id/is,
      crm_record_tombstones_row_snapshot: /row_present.*snapshot_source_seen_at.*jsonb_build_object/is,
      crm_record_tombstones_reactivation_consistency: /reactivated_at.*reactivated_by_source_seen_at.*reactivated_by_modified_time/is,
      crm_record_tombstones_supersession_consistency: /superseded_at.*superseded_by_deleted_time/is,
      crm_record_tombstones_terminal_state: /reactivated_at.*superseded_at/is,
      crm_record_tombstones_deletion_event_key: /unique.*source_org_id.*module.*record_id.*deleted_time.*deletion_type/is,
      crm_record_tombstones_pkey: /primary key.*id/is,
    };
    for (const [name, pattern] of Object.entries(requiredConstraintEvidence)) {
      if (!pattern.test(constraintText[name] || '')) {
        throw verifierError('The live source-deletion archive constraint definitions differ from the staged contract.');
      }
    }
    if (/(?:^|[^A-Za-z0-9_])Notes(?:[^A-Za-z0-9_]|$)/.test(
      constraintText.crm_record_tombstones_module_safe || '',
    )) {
      throw verifierError('The live source-deletion archive constraint definitions differ from the staged contract.');
    }
    if (!/unique index.*source_org_id.*module.*record_id.*where.*reactivated_at is null.*superseded_at is null/is
      .test(indexText.crm_record_tombstones_current_idx || '')) {
      throw verifierError('The live source-deletion archive index definitions differ from the staged contract.');
    }
    const requiredIndexEvidence = {
      crm_record_tombstones_deleted_idx: /source_org_id.*deleted_time desc.*id desc/is,
      crm_record_tombstones_deletion_event_key: /unique index.*source_org_id.*module.*record_id.*deleted_time.*deletion_type/is,
      crm_record_tombstones_pkey: /unique index.*id/is,
      crm_record_tombstones_reactivated_idx: /reactivated_at desc.*where.*reactivated_at is not null/is,
      crm_record_tombstones_record_history_idx: /module.*record_id.*deleted_time desc.*id desc/is,
    };
    for (const [name, pattern] of Object.entries(requiredIndexEvidence)) {
      if (!pattern.test(indexText[name] || '')) {
        throw verifierError('The live source-deletion archive index definitions differ from the staged contract.');
      }
    }
  } else {
    if (!/source-deletion-sync-v1/i.test(constraintText.crm_replication_leases_fixed_key || '')
        || !/expires_at.*acquired_at/is.test(constraintText.crm_replication_leases_time_order || '')
        || !/primary key.*lease_key/is.test(constraintText.crm_replication_leases_pkey || '')
        || !/expires_at/i.test(indexText.crm_replication_leases_expiry_idx || '')
        || !/unique index.*lease_key/is.test(indexText.crm_replication_leases_pkey || '')) {
      throw verifierError('The live replication lease definitions differ from the staged contract.');
    }
  }
}

function validateCatalogRows(rows, migrationBodies) {
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || typeof rows[0] !== 'object') {
    throw verifierError('The live source-deletion archive catalog returned an invalid shape.');
  }
  const functions = Array.isArray(rows[0].functions) ? rows[0].functions : [];
  if (JSON.stringify(functions.map(item => String(item?.name || '')).sort())
      !== JSON.stringify(EXPECTED_FUNCTION_NAMES)) {
    throw verifierError('The staged source-deletion archive functions are absent or overloaded.');
  }
  for (const row of functions) {
    const contract = FUNCTION_CONTRACTS[row.name];
    if (!contract
        || JSON.stringify(normalizeStringArray(row.argument_names)) !== JSON.stringify(contract.argument_names)
        || JSON.stringify(normalizeStringArray(row.argument_types)) !== JSON.stringify(contract.argument_types)
        || row.argument_modes !== null || Number(row.default_count) !== 0
        || row.result_type !== contract.result_type || row.returns_set !== false || row.function_kind !== 'f'
        || row.language !== 'plpgsql' || row.owner_name !== EXPECTED_OWNER
        || row.security_definer !== true || row.volatility !== 'v'
        || JSON.stringify(normalizeStringArray(row.settings)) !== JSON.stringify(contract.settings)
        || row.explicit_acl !== true || row.public_execute_revoked !== true
        || row.anon_execute !== true || row.authenticated_execute !== true || row.service_role_execute !== true
        || JSON.stringify(normalizeAcl(row.direct_acl)) !== JSON.stringify(EXPECTED_FUNCTION_ACL)
        || JSON.stringify(normalizeStringArray(row.unintended_effective_execute_roles)) !== '[]'
        || String(row.source || '').trim() !== String(migrationBodies[row.name] || '').trim()) {
      throw verifierError('The live source-deletion archive function contract differs from the staged migration.');
    }
  }

  const tables = Array.isArray(rows[0].tables) ? rows[0].tables : [];
  if (JSON.stringify(tables.map(item => String(item?.name || '')).sort())
      !== JSON.stringify(Object.keys(EXPECTED_COLUMNS).sort())) {
    throw verifierError('The staged source-deletion archive tables are not installed exactly once.');
  }
  for (const table of tables) {
    const constraints = namedDefinitions(table.constraints);
    const indexes = namedDefinitions(table.indexes);
    if (table.owner_name !== EXPECTED_OWNER || table.row_security !== true || table.force_row_security !== true
        || Number(table.policy_count) !== 0
        || JSON.stringify(normalizeColumns(table.columns)) !== JSON.stringify(EXPECTED_COLUMNS[table.name])
        || JSON.stringify(normalizeAcl(table.direct_acl)) !== JSON.stringify(EXPECTED_TABLE_ACL)
        || table.public_access !== false || table.anon_access !== false
        || table.authenticated_access !== false || table.service_role_access !== false
        || JSON.stringify(normalizeStringArray(table.unintended_effective_access_roles)) !== '[]'
        || !constraints || !indexes
        || JSON.stringify(namesOf(constraints)) !== JSON.stringify(EXPECTED_CONSTRAINT_NAMES[table.name])
        || JSON.stringify(namesOf(indexes)) !== JSON.stringify(EXPECTED_INDEX_NAMES[table.name])) {
      throw verifierError('The live source-deletion archive table contract differs from the staged migration.');
    }
    assertDefinitionEvidence(table.name, constraints, indexes);
  }

  const sourceSeenColumns = (Array.isArray(rows[0].record_source_seen_column)
    ? rows[0].record_source_seen_column
    : []).map(column => ({
    name: String(column?.name || ''),
    type: String(column?.type || ''),
    not_null: column?.not_null === true,
    default_expression: column?.default_expression === null
      ? null
      : String(column?.default_expression || ''),
  }));
  if (JSON.stringify(sourceSeenColumns) !== JSON.stringify([{
    name: 'source_seen_at',
    type: 'timestamp with time zone',
    not_null: false,
    default_expression: null,
  }])) {
    throw verifierError('The live crm_records source observation contract differs from the staged migration.');
  }
  return true;
}

async function fetchJson(response, failureMessage) {
  try {
    return await response.json();
  } catch {
    throw verifierError(failureMessage);
  }
}

async function readLiveCatalog({ base, apiKey, sqlSecret, fetchImpl, signal }) {
  let response;
  try {
    response = await fetchImpl(`${base}/rest/v1/rpc/crm_sql`, {
      method: 'POST',
      headers: { apikey: apiKey, Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: assertCatalogQueryIsReadOnly(), s: sqlSecret }),
      signal,
    });
  } catch {
    throw verifierError('The read-only source-deletion archive catalog request failed.');
  }
  if (!response.ok) {
    throw verifierError(`The read-only source-deletion archive catalog request returned HTTP ${response.status}.`);
  }
  return fetchJson(response, 'The read-only source-deletion archive catalog returned an invalid response.');
}

async function runFailClosedCanary({ base, apiKey, sqlSecret, fetchImpl, signal }) {
  const request = {
    p_source_org_id: 'org00000000',
    p_module: 'Leads',
    p_record_id: 'local-source-deletion-canary',
    p_deleted_time: '2000-01-01T00:00:00.000Z',
    p_deletion_type: 'recycle',
    p_observed_at: '2000-01-01T00:00:01.000Z',
    p_expected_modified_time: null,
    p_expected_source_seen_at: null,
    s: sqlSecret,
  };
  let response;
  try {
    response = await fetchImpl(`${base}/rest/v1/rpc/crm_archive_source_record`, {
      method: 'POST',
      headers: { apikey: apiKey, Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    });
  } catch {
    throw verifierError('The fail-closed source-deletion archive canary request failed.');
  }
  if (response.ok) throw verifierError('The fail-closed source-deletion archive canary was unexpectedly accepted.');
  const error = await fetchJson(response, 'The fail-closed source-deletion archive canary returned an invalid response.');
  if (response.status !== 400 || error?.code !== '22023'
      || error?.message !== 'invalid source-deletion archive arguments') {
    throw verifierError('The fail-closed source-deletion archive canary did not return the expected rejection.');
  }
  return true;
}

async function verifySourceDeletionArchive({
  env = process.env,
  fetchImpl = fetch,
  migrationSql,
  signal,
  timeoutMs = DEFAULT_VERIFICATION_TIMEOUT_MS,
} = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw verifierError('Source-deletion archive verification timeout is invalid.');
  }
  const stagedSql = migrationSql === undefined ? fs.readFileSync(MIGRATION_PATH, 'utf8') : migrationSql;
  const migrationBodies = extractMigrationBodies(stagedSql);
  assertFailClosedCanaryProof(migrationBodies.crm_archive_source_record);
  const liveConnection = connection(env);
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener?.('abort', abortFromCaller, { once: true });
  let timer;
  const deadline = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(verifierError('Source-deletion archive verification timed out safely.'));
    }, timeoutMs);
  });
  const verification = (async () => {
    if (controller.signal.aborted) {
      throw verifierError('Source-deletion archive verification was cancelled safely.');
    }
    const rows = await readLiveCatalog({ ...liveConnection, fetchImpl, signal: controller.signal });
    validateCatalogRows(rows, migrationBodies);
    await runFailClosedCanary({ ...liveConnection, fetchImpl, signal: controller.signal });
    return Object.freeze({ catalog_verified: true, fail_closed_canary_rejected: true, database_changes: 0 });
  })();
  try {
    return await Promise.race([verification, deadline]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', abortFromCaller);
  }
}

async function main() {
  require('dotenv').config({ path: path.join(ROOT, '.env') });
  await verifySourceDeletionArchive();
  console.log('Source-deletion archive verified: the catalog matches the staged functions and forced-RLS tables, and the malformed-ID canary was rejected before row access. No database changes were made.');
}

if (require.main === module) {
  main().catch(error => {
    const message = error?.name === 'SourceDeletionArchiveVerifierError'
      ? error.message
      : 'Source-deletion archive verification stopped safely.';
    console.error(`Source-deletion archive verification failed: ${message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  CATALOG_QUERY,
  DEFAULT_VERIFICATION_TIMEOUT_MS,
  EXPECTED_COLUMNS,
  EXPECTED_CONSTRAINT_NAMES,
  EXPECTED_FUNCTION_ACL,
  EXPECTED_FUNCTION_NAMES,
  EXPECTED_INDEX_NAMES,
  EXPECTED_OWNER,
  EXPECTED_TABLE_ACL,
  FUNCTION_CONTRACTS,
  assertCatalogQueryIsReadOnly,
  assertFailClosedCanaryProof,
  connection,
  extractMigrationBodies,
  readLiveCatalog,
  runFailClosedCanary,
  validateCatalogRows,
  verifySourceDeletionArchive,
};
