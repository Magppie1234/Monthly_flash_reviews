#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MIGRATION_PATH = path.join(ROOT, 'database', 'migrations', '20260830_delta_sync_lease_state.sql');
const DEFAULT_TIMEOUT_MS = 5_000;
const EXPECTED_OWNER = 'postgres';
const EXPECTED_FUNCTION_ACL_GRANTEES = Object.freeze(['anon', 'authenticated', 'postgres', 'service_role']);
const FUNCTION_CONTRACTS = Object.freeze({
  crm_acquire_delta_sync_lease: Object.freeze({
    argument_names: Object.freeze(['p_owner_id', 'p_ttl_seconds', 's']),
    argument_types: Object.freeze(['uuid', 'integer', 'text']),
    settings: Object.freeze(['lock_timeout=2s', 'search_path=public', 'statement_timeout=5s']),
  }),
  crm_read_delta_sync_state: Object.freeze({
    argument_names: Object.freeze(['s']),
    argument_types: Object.freeze(['text']),
    settings: Object.freeze(['search_path=public', 'statement_timeout=5s']),
  }),
  crm_release_delta_sync_lease: Object.freeze({
    argument_names: Object.freeze(['p_owner_id', 's']),
    argument_types: Object.freeze(['uuid', 'text']),
    settings: Object.freeze(['lock_timeout=2s', 'search_path=public', 'statement_timeout=5s']),
  }),
  crm_renew_delta_sync_lease: Object.freeze({
    argument_names: Object.freeze(['p_owner_id', 'p_ttl_seconds', 's']),
    argument_types: Object.freeze(['uuid', 'integer', 'text']),
    settings: Object.freeze(['lock_timeout=2s', 'search_path=public', 'statement_timeout=5s']),
  }),
  crm_save_delta_sync_state: Object.freeze({
    argument_names: Object.freeze(['p_owner_id', 'p_expected_revision', 'p_state', 's']),
    argument_types: Object.freeze(['uuid', 'bigint', 'jsonb', 'text']),
    settings: Object.freeze(['lock_timeout=2s', 'search_path=public', 'statement_timeout=5s']),
  }),
});
const EXPECTED_FUNCTION_NAMES = Object.freeze(Object.keys(FUNCTION_CONTRACTS).sort());
const EXPECTED_COLUMNS = Object.freeze([
  Object.freeze({ name: 'singleton_key', type: 'text', not_null: true }),
  Object.freeze({ name: 'owner_id', type: 'uuid', not_null: false }),
  Object.freeze({ name: 'acquired_at', type: 'timestamp with time zone', not_null: false }),
  Object.freeze({ name: 'expires_at', type: 'timestamp with time zone', not_null: false }),
  Object.freeze({ name: 'state_revision', type: 'bigint', not_null: true }),
  Object.freeze({ name: 'state', type: 'jsonb', not_null: false }),
  Object.freeze({ name: 'updated_at', type: 'timestamp with time zone', not_null: true }),
]);
const EXPECTED_CONSTRAINT_NAMES = Object.freeze([
  'crm_delta_sync_control_duration_bound',
  'crm_delta_sync_control_fixed_key',
  'crm_delta_sync_control_lease_consistency',
  'crm_delta_sync_control_pkey',
  'crm_delta_sync_control_revision_nonnegative',
  'crm_delta_sync_control_state_object',
  'crm_delta_sync_control_time_order',
]);

// Constant catalog-only query. crm_sql accepts SELECT/WITH only; this query
// inspects metadata and never reads the singleton control row or CRM records.
const CATALOG_QUERY = `with function_catalog as (
  select
    p.proname as name,
    array(
      select pg_catalog.format_type(argument_type, null)
      from unnest(p.proargtypes) with ordinality as arguments(argument_type, position)
      order by position
    ) as argument_types,
    p.proargnames as argument_names,
    p.proargmodes as argument_modes,
    p.pronargdefaults as default_count,
    p.prorettype::pg_catalog.regtype::text as result_type,
    p.proretset as returns_set,
    p.prokind as function_kind,
    language_catalog.lanname as language,
    owner_role.rolname as owner_name,
    p.prosecdef as security_definer,
    p.provolatile as volatility,
    array(
      select setting
      from unnest(coalesce(p.proconfig, array[]::text[])) as configured(setting)
      order by setting collate "C"
    ) as settings,
    p.prosrc as source,
    p.proacl is not null as explicit_acl,
    not exists (
      select 1
      from pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) as privilege
      where privilege.grantee = 0 and privilege.privilege_type = 'EXECUTE'
    ) as public_execute_revoked,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'grantee', case when privilege.grantee = 0 then 'PUBLIC' else grantee_role.rolname end,
          'privilege_type', privilege.privilege_type,
          'is_grantable', privilege.is_grantable
        )
        order by (case when privilege.grantee = 0 then 'PUBLIC' else grantee_role.rolname end) collate "C"
      )
      from pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) as privilege
      left join pg_catalog.pg_roles as grantee_role on grantee_role.oid = privilege.grantee
    ), '[]'::jsonb) as direct_acl,
    coalesce((
      select jsonb_agg(candidate.rolname order by candidate.rolname)
      from pg_catalog.pg_roles as candidate
      where candidate.rolsuper = false
        and candidate.rolname not in (owner_role.rolname, 'anon', 'authenticated', 'service_role')
        and pg_catalog.has_function_privilege(candidate.oid, p.oid, 'EXECUTE')
    ), '[]'::jsonb) as unintended_effective_execute_roles
  from pg_catalog.pg_proc as p
  join pg_catalog.pg_namespace as namespace_catalog on namespace_catalog.oid = p.pronamespace
  join pg_catalog.pg_language as language_catalog on language_catalog.oid = p.prolang
  join pg_catalog.pg_roles as owner_role on owner_role.oid = p.proowner
  where namespace_catalog.nspname = 'public'
    and p.proname = any(array[
      'crm_acquire_delta_sync_lease',
      'crm_read_delta_sync_state',
      'crm_release_delta_sync_lease',
      'crm_renew_delta_sync_lease',
      'crm_save_delta_sync_state'
    ])
), table_catalog as (
  select
    relation.relname as name,
    owner_role.rolname as owner_name,
    relation.relrowsecurity as row_security,
    relation.relforcerowsecurity as force_row_security,
    (select count(*)::integer from pg_catalog.pg_policy where polrelid = relation.oid) as policy_count,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'name', attribute.attname,
          'type', pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
          'not_null', attribute.attnotnull,
          'default_expression', pg_catalog.pg_get_expr(default_catalog.adbin, default_catalog.adrelid)
        ) order by attribute.attnum
      )
      from pg_catalog.pg_attribute as attribute
      left join pg_catalog.pg_attrdef as default_catalog
        on default_catalog.adrelid = attribute.attrelid and default_catalog.adnum = attribute.attnum
      where attribute.attrelid = relation.oid and attribute.attnum > 0 and not attribute.attisdropped
    ), '[]'::jsonb) as columns,
    coalesce((
      select jsonb_agg(
        jsonb_build_object('name', constraint_catalog.conname, 'definition', pg_catalog.pg_get_constraintdef(constraint_catalog.oid))
        order by constraint_catalog.conname
      )
      from pg_catalog.pg_constraint as constraint_catalog
      where constraint_catalog.conrelid = relation.oid
    ), '[]'::jsonb) as constraints,
    not exists (
      select 1
      from pg_catalog.aclexplode(coalesce(relation.relacl, pg_catalog.acldefault('r', relation.relowner))) as public_privilege
      where public_privilege.grantee = 0
    ) as public_access_revoked,
    not pg_catalog.has_table_privilege('anon', relation.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as anon_access_revoked,
    not pg_catalog.has_table_privilege('authenticated', relation.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as authenticated_access_revoked,
    not pg_catalog.has_table_privilege('service_role', relation.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as service_role_access_revoked,
    coalesce((
      select jsonb_agg(candidate.rolname order by candidate.rolname)
      from pg_catalog.pg_roles as candidate
      where candidate.rolsuper = false
        and candidate.rolname not in (owner_role.rolname, 'anon', 'authenticated', 'service_role')
        and pg_catalog.has_table_privilege(candidate.oid, relation.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    ), '[]'::jsonb) as unintended_effective_access_roles
  from pg_catalog.pg_class as relation
  join pg_catalog.pg_namespace as namespace_catalog on namespace_catalog.oid = relation.relnamespace
  join pg_catalog.pg_roles as owner_role on owner_role.oid = relation.relowner
  where namespace_catalog.nspname = 'public'
    and relation.relname = 'crm_delta_sync_control'
    and relation.relkind = 'r'
)
select jsonb_build_object(
  'functions', coalesce((select jsonb_agg(to_jsonb(item) order by item.name) from function_catalog as item), '[]'::jsonb),
  'tables', coalesce((select jsonb_agg(to_jsonb(item) order by item.name) from table_catalog as item), '[]'::jsonb)
) as contract`;

function verifierError(message) {
  const error = new Error(message);
  error.name = 'DeltaSyncLeaseVerifierError';
  return error;
}

function connection(env = process.env) {
  const apiKey = String(env.SUPABASE_ANON_KEY || '');
  const sqlSecret = String(env.CRM_SQL_SECRET || '');
  let parsed;
  try {
    parsed = new URL(String(env.SUPABASE_URL || ''));
  } catch {
    throw verifierError('Read-only delta-sync lease verification is not configured.');
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.supabase.co')
      || parsed.username || parsed.password || !apiKey || !sqlSecret) {
    throw verifierError('Read-only delta-sync lease verification failed closed.');
  }
  return { base: parsed.origin, apiKey, sqlSecret };
}

function assertCatalogQueryIsReadOnly(query = CATALOG_QUERY) {
  const normalized = String(query || '').trim();
  const withoutStringLiterals = normalized.replace(/'(?:''|[^'])*'/g, "''");
  if (!/^with\b/i.test(normalized)
      || /;\s*\S/.test(normalized)
      || /\b(?:insert|update|delete|merge|alter|drop|truncate|create|grant|revoke|copy|call|do)\b/i.test(withoutStringLiterals)
      || !/\bfrom\s+pg_catalog\.pg_proc\b/i.test(normalized)
      || !/\bfrom\s+pg_catalog\.pg_class\b/i.test(normalized)
      || /\bfrom\s+(?:public\.)?crm_delta_sync_control\b/i.test(normalized)) {
    throw verifierError('The delta-sync lease catalog query is not read-only.');
  }
  return normalized;
}

function extractMigrationBodies(sql) {
  const source = String(sql || '');
  const bodies = {};
  for (const name of EXPECTED_FUNCTION_NAMES) {
    const expression = new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\nAS \\$function\\$\\n([\\s\\S]*?)\\n\\$function\\$;`,
    );
    const match = source.match(expression);
    if (!match) throw verifierError(`The staged ${name} migration contract is unavailable.`);
    bodies[name] = match[1].trim();
  }
  return bodies;
}

function assertStaticContract(sql, bodies = extractMigrationBodies(sql)) {
  const source = String(sql || '');
  const acquire = bodies.crm_acquire_delta_sync_lease;
  const renew = bodies.crm_renew_delta_sync_lease;
  const save = bodies.crm_save_delta_sync_state;
  const release = bodies.crm_release_delta_sync_lease;
  const read = bodies.crm_read_delta_sync_state;

  if (!source.includes("expires_at <= acquired_at + interval '50 seconds'")
      || !/p_ttl_seconds\s*>\s*50/i.test(acquire)
      || !/owner_id is null or expires_at <= v_now/i.test(acquire)
      || !/owner_id = p_owner_id[\s\S]*expires_at > v_now/i.test(renew)
      || !/owner_id = p_owner_id[\s\S]*expires_at > v_now[\s\S]*state_revision = p_expected_revision/i.test(save)
      || !/state_revision = state_revision \+ 1/i.test(save)
      || !/errcode = '40001', message = 'delta-sync state compare-and-swap conflict'/i.test(save)
      || !/where singleton_key = 'zoho-delta-sync-v1'[\s\S]*owner_id = p_owner_id/i.test(release)
      || /owner_id\s*=\s*p_owner_id/i.test(read)
      || source.includes("'owner_id'")) {
    throw verifierError('The staged delta-sync lease or fencing contract is incomplete.');
  }

  for (const body of Object.values(bodies)) {
    const authentication = body.indexOf('if not exists (select 1 from public.crm_secret where secret = s) then');
    const firstControlAccess = body.search(/(?:update\s+public|from\s+public)\.crm_delta_sync_control/i);
    if (authentication < 0 || firstControlAccess < 0 || authentication > firstControlAccess) {
      throw verifierError('A staged delta-sync RPC does not authenticate before control access.');
    }
  }
  return true;
}

function stringArray(value) {
  return Array.isArray(value) ? value.map(item => String(item)) : [];
}

function validateCatalogRows(rows, migrationBodies) {
  if (!Array.isArray(rows) || rows.length !== 1 || !isObject(rows[0]?.contract)) {
    throw verifierError('The live delta-sync lease catalog returned an invalid shape.');
  }
  const contract = rows[0].contract;
  if (!Array.isArray(contract.functions) || !Array.isArray(contract.tables)) {
    throw verifierError('The live delta-sync lease catalog is incomplete.');
  }
  if (contract.functions.length !== EXPECTED_FUNCTION_NAMES.length || contract.tables.length !== 1) {
    throw verifierError('The staged delta-sync lease contract is not installed exactly once.');
  }

  const functions = [...contract.functions].sort((left, right) => String(left.name).localeCompare(String(right.name)));
  for (let index = 0; index < EXPECTED_FUNCTION_NAMES.length; index += 1) {
    const name = EXPECTED_FUNCTION_NAMES[index];
    const row = functions[index] || {};
    const expected = FUNCTION_CONTRACTS[name];
    const acl = Array.isArray(row.direct_acl) ? row.direct_acl : [];
    const executeGrantees = acl
      .filter(item => item?.privilege_type === 'EXECUTE' && item.is_grantable === false)
      .map(item => String(item.grantee))
      .sort();
    if (row.name !== name
        || JSON.stringify(stringArray(row.argument_names)) !== JSON.stringify(expected.argument_names)
        || JSON.stringify(stringArray(row.argument_types)) !== JSON.stringify(expected.argument_types)
        || row.argument_modes !== null || Number(row.default_count) !== 0
        || row.result_type !== 'jsonb' || row.returns_set !== false || row.function_kind !== 'f'
        || row.language !== 'plpgsql' || row.owner_name !== EXPECTED_OWNER
        || row.security_definer !== true || row.volatility !== 'v'
        || JSON.stringify(stringArray(row.settings).sort()) !== JSON.stringify([...expected.settings].sort())
        || row.explicit_acl !== true || row.public_execute_revoked !== true
        || JSON.stringify(executeGrantees) !== JSON.stringify(EXPECTED_FUNCTION_ACL_GRANTEES)
        || JSON.stringify(stringArray(row.unintended_effective_execute_roles)) !== '[]'
        || String(row.source || '').trim() !== String(migrationBodies[name] || '').trim()) {
      throw verifierError(`The live ${name} contract differs from the staged migration.`);
    }
  }

  const table = contract.tables[0] || {};
  const columns = Array.isArray(table.columns) ? table.columns : [];
  const constraints = Array.isArray(table.constraints) ? table.constraints : [];
  const normalizedColumns = columns.map(column => ({
    name: String(column.name),
    type: String(column.type),
    not_null: column.not_null === true,
  }));
  const constraintNames = constraints.map(item => String(item.name)).sort();
  const constraintText = JSON.stringify(constraints);
  if (table.name !== 'crm_delta_sync_control' || table.owner_name !== EXPECTED_OWNER
      || table.row_security !== true || table.force_row_security !== true
      || Number(table.policy_count) !== 0
      || JSON.stringify(normalizedColumns) !== JSON.stringify(EXPECTED_COLUMNS)
      || JSON.stringify(constraintNames) !== JSON.stringify(EXPECTED_CONSTRAINT_NAMES)
      || !/(?:50 seconds|00:00:50)/i.test(constraintText)
      || !/state_revision.*>=.*0/i.test(constraintText)
      || table.public_access_revoked !== true || table.anon_access_revoked !== true
      || table.authenticated_access_revoked !== true || table.service_role_access_revoked !== true
      || JSON.stringify(stringArray(table.unintended_effective_access_roles)) !== '[]') {
    throw verifierError('The live delta-sync control table differs from the staged contract.');
  }
  return true;
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function verifyDeltaSyncLeaseState({
  env = process.env,
  fetchImpl = fetch,
  migrationSql = fs.readFileSync(MIGRATION_PATH, 'utf8'),
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function.');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
    throw new TypeError('timeoutMs must be an integer from 100 to 30000.');
  }
  const config = connection(env);
  const bodies = extractMigrationBodies(migrationSql);
  assertStaticContract(migrationSql, bodies);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timeout.unref === 'function') timeout.unref();
  let response;
  try {
    response = await fetchImpl(`${config.base}/rest/v1/rpc/crm_sql`, {
      method: 'POST',
      headers: {
        apikey: config.apiKey,
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: assertCatalogQueryIsReadOnly(), s: config.sqlSecret }),
      signal: controller.signal,
    });
  } catch {
    throw verifierError('The live delta-sync lease catalog could not be read.');
  } finally {
    clearTimeout(timeout);
  }
  if (!response?.ok) throw verifierError('The live delta-sync lease catalog request failed.');
  let rows;
  try {
    rows = await response.json();
  } catch {
    throw verifierError('The live delta-sync lease catalog returned invalid JSON.');
  }
  validateCatalogRows(rows, bodies);
  return Object.freeze({ catalog_verified: true, database_changes: 0 });
}

async function main() {
  require('dotenv').config({ path: path.join(ROOT, '.env') });
  const result = await verifyDeltaSyncLeaseState();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${String(error?.message || 'Delta-sync lease verification failed.')}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  CATALOG_QUERY,
  DEFAULT_TIMEOUT_MS,
  EXPECTED_COLUMNS,
  EXPECTED_CONSTRAINT_NAMES,
  EXPECTED_FUNCTION_ACL_GRANTEES,
  EXPECTED_FUNCTION_NAMES,
  EXPECTED_OWNER,
  FUNCTION_CONTRACTS,
  assertCatalogQueryIsReadOnly,
  assertStaticContract,
  connection,
  extractMigrationBodies,
  validateCatalogRows,
  verifyDeltaSyncLeaseState,
};
