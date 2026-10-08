#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MIGRATION_PATH = path.join(ROOT, 'database', 'migrations', '20260830_blueprint_transition_rpc.sql');
const FUNCTION_NAME = 'crm_blueprint_transition';
const DEFAULT_VERIFICATION_TIMEOUT_MS = 5_000;
const EXPECTED_OWNER = 'postgres';
const EXPECTED_SETTINGS = Object.freeze(['search_path=public', 'statement_timeout=15s']);
const EXPECTED_DIRECT_ACL = Object.freeze([
  Object.freeze({ grantor: 'postgres', grantee: 'anon', privilege_type: 'EXECUTE', is_grantable: false }),
  Object.freeze({ grantor: 'postgres', grantee: 'authenticated', privilege_type: 'EXECUTE', is_grantable: false }),
  Object.freeze({ grantor: 'postgres', grantee: 'postgres', privilege_type: 'EXECUTE', is_grantable: false }),
  Object.freeze({ grantor: 'postgres', grantee: 'service_role', privilege_type: 'EXECUTE', is_grantable: false }),
]);
const EXPECTED_ARGUMENT_NAMES = Object.freeze([
  'p_module', 'p_id', 'p_state_field', 'p_expected_state', 'p_expected_modified_time',
  'p_next_state', 'p_blueprint_id', 'p_blueprint_name', 'p_transition_id',
  'p_transition_name', 'p_patch', 's', 'p_note_id', 'p_note_title', 'p_note_content',
]);
const EXPECTED_ARGUMENT_TYPES = Object.freeze([
  'text', 'text', 'text', 'text', 'timestamp with time zone', 'text', 'text', 'text',
  'text', 'text', 'jsonb', 'text', 'text', 'text', 'text',
]);

// This statement is deliberately constant: the verifier never accepts SQL from
// arguments or environment variables, and it reads only PostgreSQL catalogs.
const CATALOG_QUERY = `select
  array(select pg_catalog.format_type(arg_type, null) from unnest(p.proargtypes) with ordinality as args(arg_type, position) order by position) as argument_types,
  p.proargnames as argument_names,
  p.proargmodes as argument_modes,
  p.pronargdefaults as default_count,
  pg_catalog.pg_get_expr(p.proargdefaults, 0) as default_expressions,
  p.prorettype::pg_catalog.regtype::text as result_type,
  p.proretset as returns_set,
  p.prokind as function_kind,
  l.lanname as language,
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
        'grantor', grantor_role.rolname,
        'grantee', case when privilege.grantee = 0 then 'PUBLIC' else grantee_role.rolname end,
        'privilege_type', privilege.privilege_type,
        'is_grantable', privilege.is_grantable
      )
      order by (case when privilege.grantee = 0 then 'PUBLIC' else grantee_role.rolname end) collate "C",
        privilege.privilege_type collate "C",
        grantor_role.rolname collate "C",
        privilege.is_grantable
    )
    from pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) as privilege
    join pg_catalog.pg_roles as grantor_role on grantor_role.oid = privilege.grantor
    left join pg_catalog.pg_roles as grantee_role on grantee_role.oid = privilege.grantee
  ), '[]'::jsonb) as direct_acl,
  coalesce((
    select jsonb_agg(candidate.rolname order by candidate.rolname)
    from pg_catalog.pg_roles as candidate
    where candidate.rolsuper = false
      and candidate.rolname not in (owner_role.rolname, 'anon', 'authenticated', 'service_role')
      and pg_catalog.has_function_privilege(candidate.oid, p.oid, 'EXECUTE')
  ), '[]'::jsonb) as unintended_effective_execute_roles,
  pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
  pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
  pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute
from pg_catalog.pg_proc as p
join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
join pg_catalog.pg_language as l on l.oid = p.prolang
join pg_catalog.pg_roles as owner_role on owner_role.oid = p.proowner
where n.nspname = 'public' and p.proname = '${FUNCTION_NAME}'
order by p.oid`;

function verifierError(message) {
  const error = new Error(message);
  error.name = 'BlueprintRpcVerifierError';
  return error;
}

function connection(env = process.env) {
  const apiKey = String(env.SUPABASE_ANON_KEY || '');
  const sqlSecret = String(env.CRM_SQL_SECRET || '');
  let parsed;
  try {
    parsed = new URL(String(env.SUPABASE_URL || ''));
  } catch {
    throw verifierError('Read-only Blueprint RPC verification is not configured.');
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.supabase.co')
      || parsed.username || parsed.password || !apiKey || !sqlSecret) {
    throw verifierError('Read-only Blueprint RPC verification failed closed.');
  }
  return { base: parsed.origin, apiKey, sqlSecret };
}

function extractMigrationBody(sql) {
  const match = String(sql || '').match(
    /CREATE OR REPLACE FUNCTION public\.crm_blueprint_transition\([\s\S]*?\nAS \$function\$\n([\s\S]*?)\n\$function\$;/,
  );
  if (!match) throw verifierError('The staged Blueprint RPC migration contract is unavailable.');
  return match[1].trim();
}

function assertCatalogQueryIsReadOnly(query = CATALOG_QUERY) {
  const normalized = String(query || '').trim();
  if (!/^select\b/i.test(normalized) || /;\s*\S/.test(normalized)
      || /\b(?:insert|update|delete|merge|alter|drop|truncate|create|grant|revoke|copy|call|do)\b/i.test(normalized)
      || /\b(?:crm_records|crm_audit|crm_meta|crm_secret)\b/i.test(normalized)
      || !/\bfrom\s+pg_catalog\.pg_proc\b/i.test(normalized)) {
    throw verifierError('The Blueprint RPC catalog query is not read-only.');
  }
  return normalized;
}

function assertFailClosedCanaryProof(migrationBody) {
  const body = String(migrationBody || '');
  const authentication = body.indexOf('if not exists (select 1 from public.crm_secret where secret = s) then');
  const authenticationRejection = body.indexOf("errcode = '42501', message = 'unauthorized'", authentication);
  const invalidStateGuard = body.indexOf("p_state_field in ('id', 'Created_Time', 'Modified_Time')", authenticationRejection);
  const invalidStateRejection = body.indexOf("errcode = '22023', message = 'invalid Blueprint state field'", invalidStateGuard);
  const recordRead = body.indexOf('from public.crm_records as r', invalidStateRejection);
  const rowLock = body.indexOf('for update;', recordRead);
  const firstMutation = Math.min(...[
    'update public.crm_records', 'insert into public.crm_records', 'insert into public.crm_audit',
  ].map(fragment => {
    const index = body.indexOf(fragment);
    return index === -1 ? Number.POSITIVE_INFINITY : index;
  }));
  if (!(authentication >= 0 && authentication < authenticationRejection
      && authenticationRejection < invalidStateGuard && invalidStateGuard < invalidStateRejection
      && invalidStateRejection < recordRead && recordRead < rowLock && rowLock < firstMutation)) {
    throw verifierError('The staged migration does not prove a non-mutating fail-closed canary.');
  }
  return true;
}

function normalizeStringArray(value) {
  return Array.isArray(value) ? value.map(item => String(item)) : [];
}

function normalizeDirectAcl(value) {
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

function validateCatalogRows(rows, migrationBody) {
  if (!Array.isArray(rows)) throw verifierError('The live Blueprint RPC catalog returned an invalid shape.');
  if (rows.length === 0) throw verifierError('The staged Blueprint RPC is not installed in the live function catalog.');
  if (rows.length !== 1) throw verifierError('The live Blueprint RPC catalog contains multiple overloads.');
  const row = rows[0] || {};
  if (JSON.stringify(normalizeStringArray(row.argument_names)) !== JSON.stringify(EXPECTED_ARGUMENT_NAMES)
      || JSON.stringify(normalizeStringArray(row.argument_types)) !== JSON.stringify(EXPECTED_ARGUMENT_TYPES)
      || row.argument_modes !== null
      || Number(row.default_count) !== 3
      || row.default_expressions !== 'NULL::text, NULL::text, NULL::text'
      || row.result_type !== 'jsonb' || row.returns_set !== false || row.function_kind !== 'f'
      || row.language !== 'plpgsql' || row.owner_name !== EXPECTED_OWNER
      || row.security_definer !== true || row.volatility !== 'v'
      || JSON.stringify(normalizeStringArray(row.settings)) !== JSON.stringify(EXPECTED_SETTINGS)
      || row.explicit_acl !== true
      || row.public_execute_revoked !== true || row.anon_execute !== true
      || row.authenticated_execute !== true || row.service_role_execute !== true
      || JSON.stringify(normalizeDirectAcl(row.direct_acl)) !== JSON.stringify(EXPECTED_DIRECT_ACL)
      || JSON.stringify(normalizeStringArray(row.unintended_effective_execute_roles)) !== '[]') {
    throw verifierError('The live Blueprint RPC signature or execution policy differs from the staged contract.');
  }
  if (String(row.source || '').trim() !== String(migrationBody || '').trim()) {
    throw verifierError('The live Blueprint RPC body differs from the staged migration.');
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
    throw verifierError('The read-only Blueprint RPC catalog request failed.');
  }
  if (!response.ok) {
    throw verifierError(`The read-only Blueprint RPC catalog request returned HTTP ${response.status}.`);
  }
  return fetchJson(response, 'The read-only Blueprint RPC catalog returned an invalid response.');
}

async function runFailClosedCanary({ base, apiKey, sqlSecret, fetchImpl, signal }) {
  const request = {
    p_module: '__blueprint_verifier__',
    p_id: '__non_record__',
    p_state_field: 'id',
    p_expected_state: '__unchanged__',
    p_expected_modified_time: '2000-01-01T00:00:00.000Z',
    p_next_state: '__rejected__',
    p_blueprint_id: '__verification__',
    p_blueprint_name: '__verification__',
    p_transition_id: '__verification__',
    p_transition_name: '__verification__',
    p_patch: {},
    s: sqlSecret,
    p_note_id: null,
    p_note_title: null,
    p_note_content: null,
  };
  let response;
  try {
    response = await fetchImpl(`${base}/rest/v1/rpc/${FUNCTION_NAME}`, {
      method: 'POST',
      headers: { apikey: apiKey, Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    });
  } catch {
    throw verifierError('The fail-closed Blueprint RPC canary request failed.');
  }
  if (response.ok) throw verifierError('The fail-closed Blueprint RPC canary was unexpectedly accepted.');
  const error = await fetchJson(response, 'The fail-closed Blueprint RPC canary returned an invalid response.');
  if (response.status !== 400 || error?.code !== '22023' || error?.message !== 'invalid Blueprint state field') {
    throw verifierError('The fail-closed Blueprint RPC canary did not return the expected rejection.');
  }
  return true;
}

async function verifyBlueprintTransitionRpc({
  env = process.env,
  fetchImpl = fetch,
  migrationSql,
  signal,
  timeoutMs = DEFAULT_VERIFICATION_TIMEOUT_MS,
} = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw verifierError('Blueprint RPC verification timeout is invalid.');
  }
  const stagedSql = migrationSql === undefined ? fs.readFileSync(MIGRATION_PATH, 'utf8') : migrationSql;
  const migrationBody = extractMigrationBody(stagedSql);
  assertFailClosedCanaryProof(migrationBody);
  const liveConnection = connection(env);
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener?.('abort', abortFromCaller, { once: true });
  let timer;
  const deadline = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(verifierError('Blueprint RPC verification timed out safely.'));
    }, timeoutMs);
  });
  const verification = (async () => {
    if (controller.signal.aborted) throw verifierError('Blueprint RPC verification was cancelled safely.');
    const rows = await readLiveCatalog({ ...liveConnection, fetchImpl, signal: controller.signal });
    validateCatalogRows(rows, migrationBody);
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
  await verifyBlueprintTransitionRpc();
  console.log('Blueprint transition RPC verified: the live catalog matches the staged 15-parameter contract, and the fail-closed canary was rejected before record access. No database changes were made.');
}

if (require.main === module) {
  main().catch(error => {
    const message = error?.name === 'BlueprintRpcVerifierError'
      ? error.message
      : 'Blueprint RPC verification stopped safely.';
    console.error(`Blueprint transition RPC verification failed: ${message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  CATALOG_QUERY,
  DEFAULT_VERIFICATION_TIMEOUT_MS,
  EXPECTED_DIRECT_ACL,
  EXPECTED_ARGUMENT_NAMES,
  EXPECTED_ARGUMENT_TYPES,
  EXPECTED_OWNER,
  EXPECTED_SETTINGS,
  assertCatalogQueryIsReadOnly,
  assertFailClosedCanaryProof,
  connection,
  extractMigrationBody,
  readLiveCatalog,
  runFailClosedCanary,
  validateCatalogRows,
  verifyBlueprintTransitionRpc,
};
