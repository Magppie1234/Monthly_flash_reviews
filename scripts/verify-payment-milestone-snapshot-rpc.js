#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MIGRATION_PATH = path.join(
  ROOT,
  'database',
  'migrations',
  '20260830_payment_milestone_snapshot_rpc.sql',
);
const FUNCTION_NAME = 'crm_payment_milestone_snapshot_upsert';
const DEFAULT_VERIFICATION_TIMEOUT_MS = 5_000;
const EXPECTED_OWNER = 'postgres';
const EXPECTED_ARGUMENT_NAMES = Object.freeze(['rows', 's']);
const EXPECTED_ARGUMENT_TYPES = Object.freeze(['jsonb', 'text']);
const EXPECTED_SETTINGS = Object.freeze([
  'lock_timeout=2s',
  'search_path=public',
  'statement_timeout=30s',
]);
const EXPECTED_DIRECT_ACL = Object.freeze([
  Object.freeze({ grantor: 'postgres', grantee: 'anon', privilege_type: 'EXECUTE', is_grantable: false }),
  Object.freeze({ grantor: 'postgres', grantee: 'authenticated', privilege_type: 'EXECUTE', is_grantable: false }),
  Object.freeze({ grantor: 'postgres', grantee: 'postgres', privilege_type: 'EXECUTE', is_grantable: false }),
  Object.freeze({ grantor: 'postgres', grantee: 'service_role', privilege_type: 'EXECUTE', is_grantable: false }),
]);
const EXPECTED_SOURCE_SEEN_COLUMN = Object.freeze({
  name: 'source_seen_at',
  type: 'timestamp with time zone',
  not_null: false,
  default_expression: null,
});

// This is the verifier's only inspection statement. It is constant,
// catalog-only, and returns no CRM records, metadata values, or secrets.
const CATALOG_QUERY = `select
  coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'name', function_catalog.proname,
        'argument_types', array(
          select pg_catalog.format_type(argument_type, null)
          from unnest(function_catalog.proargtypes) with ordinality as arguments(argument_type, position)
          order by position
        ),
        'argument_names', function_catalog.proargnames,
        'argument_modes', function_catalog.proargmodes,
        'default_count', function_catalog.pronargdefaults,
        'result_type', function_catalog.prorettype::pg_catalog.regtype::text,
        'returns_set', function_catalog.proretset,
        'function_kind', function_catalog.prokind,
        'language', language_catalog.lanname,
        'owner_name', owner_role.rolname,
        'security_definer', function_catalog.prosecdef,
        'volatility', function_catalog.provolatile,
        'settings', array(
          select setting
          from unnest(coalesce(function_catalog.proconfig, array[]::text[])) as configured(setting)
          order by setting collate "C"
        ),
        'source', function_catalog.prosrc,
        'explicit_acl', function_catalog.proacl is not null,
        'public_execute_revoked', not exists (
          select 1
          from pg_catalog.aclexplode(
            coalesce(function_catalog.proacl, pg_catalog.acldefault('f', function_catalog.proowner))
          ) as privilege
          where privilege.grantee = 0 and privilege.privilege_type = 'EXECUTE'
        ),
        'direct_acl', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'grantor', grantor_role.rolname,
              'grantee', case when privilege.grantee = 0 then 'PUBLIC' else grantee_role.rolname end,
              'privilege_type', privilege.privilege_type,
              'is_grantable', privilege.is_grantable
            )
            order by
              (case when privilege.grantee = 0 then 'PUBLIC' else grantee_role.rolname end) collate "C",
              privilege.privilege_type collate "C",
              grantor_role.rolname collate "C",
              privilege.is_grantable
          )
          from pg_catalog.aclexplode(
            coalesce(function_catalog.proacl, pg_catalog.acldefault('f', function_catalog.proowner))
          ) as privilege
          join pg_catalog.pg_roles as grantor_role on grantor_role.oid = privilege.grantor
          left join pg_catalog.pg_roles as grantee_role on grantee_role.oid = privilege.grantee
        ), '[]'::jsonb),
        'unintended_effective_execute_roles', coalesce((
          select jsonb_agg(candidate.rolname order by candidate.rolname collate "C")
          from pg_catalog.pg_roles as candidate
          where candidate.rolsuper = false
            and candidate.rolname not in (owner_role.rolname, 'anon', 'authenticated', 'service_role')
            and pg_catalog.has_function_privilege(candidate.oid, function_catalog.oid, 'EXECUTE')
        ), '[]'::jsonb),
        'anon_execute', pg_catalog.has_function_privilege('anon', function_catalog.oid, 'EXECUTE'),
        'authenticated_execute', pg_catalog.has_function_privilege('authenticated', function_catalog.oid, 'EXECUTE'),
        'service_role_execute', pg_catalog.has_function_privilege('service_role', function_catalog.oid, 'EXECUTE')
      )
      order by function_catalog.oid
    )
    from pg_catalog.pg_proc as function_catalog
    join pg_catalog.pg_namespace as namespace_catalog
      on namespace_catalog.oid = function_catalog.pronamespace
    join pg_catalog.pg_language as language_catalog
      on language_catalog.oid = function_catalog.prolang
    join pg_catalog.pg_roles as owner_role on owner_role.oid = function_catalog.proowner
    where namespace_catalog.nspname = 'public'
      and function_catalog.proname = '${FUNCTION_NAME}'
  ), '[]'::jsonb) as functions,
  coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'name', attribute.attname,
        'type', pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
        'not_null', attribute.attnotnull,
        'default_expression', pg_catalog.pg_get_expr(default_catalog.adbin, default_catalog.adrelid)
      )
      order by attribute.attnum
    )
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace_catalog
      on namespace_catalog.oid = relation.relnamespace
    join pg_catalog.pg_attribute as attribute
      on attribute.attrelid = relation.oid
    left join pg_catalog.pg_attrdef as default_catalog
      on default_catalog.adrelid = relation.oid and default_catalog.adnum = attribute.attnum
    where namespace_catalog.nspname = 'public'
      and relation.relname = 'crm_records'
      and relation.relkind in ('r', 'p')
      and attribute.attname = 'source_seen_at'
      and attribute.attnum > 0
      and not attribute.attisdropped
  ), '[]'::jsonb) as source_seen_columns`;

function verifierError(message) {
  const error = new Error(message);
  error.name = 'PaymentMilestoneSnapshotRpcVerifierError';
  return error;
}

function connection(env = process.env) {
  const apiKey = String(env.SUPABASE_ANON_KEY || '');
  const sqlSecret = String(env.CRM_SQL_SECRET || '');
  let parsed;
  try {
    parsed = new URL(String(env.SUPABASE_URL || ''));
  } catch {
    throw verifierError('Read-only payment milestone snapshot RPC verification is not configured.');
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.supabase.co')
      || parsed.username || parsed.password || parsed.pathname !== '/'
      || parsed.search || parsed.hash || !apiKey || !sqlSecret) {
    throw verifierError('Read-only payment milestone snapshot RPC verification failed closed.');
  }
  return { base: parsed.origin, apiKey, sqlSecret };
}

function extractMigrationBody(sql) {
  const match = String(sql || '').match(
    /CREATE OR REPLACE FUNCTION public\.crm_payment_milestone_snapshot_upsert\(rows jsonb, s text\)[\s\S]*?\nAS \$function\$\n([\s\S]*?)\n\$function\$;/,
  );
  if (!match) throw verifierError('The staged payment milestone snapshot RPC migration contract is unavailable.');
  return match[1].trim();
}

function firstIndex(body, fragments) {
  return Math.min(...fragments.map(fragment => {
    const index = body.indexOf(fragment);
    return index === -1 ? Number.POSITIVE_INFINITY : index;
  }));
}

function assertFailClosedCanaryProof(migrationBody) {
  const body = String(migrationBody || '');
  const authentication = body.indexOf('if not exists (select 1 from public.crm_secret where secret = s) then');
  const authenticationRejection = body.indexOf("errcode = '42501', message = 'unauthorized'", authentication);
  const completeValidation = body.indexOf("v_id !~ '^[0-9]{8,32}$'", authenticationRejection);
  const malformedRowRejection = body.indexOf(
    "errcode = '22023', message = 'invalid payment milestone snapshot row'",
    completeValidation,
  );
  const organizationRead = body.indexOf('from public.crm_meta as m', malformedRowRejection);
  const advisoryLock = body.indexOf('pg_catalog.pg_advisory_xact_lock(', organizationRead);
  const firstMutation = firstIndex(body, [
    'insert into public.crm_records',
    'update public.crm_records',
    'delete from public.crm_records',
  ]);
  if (!(authentication >= 0 && authentication < authenticationRejection
      && authenticationRejection < completeValidation
      && completeValidation < malformedRowRejection
      && malformedRowRejection < organizationRead
      && organizationRead < advisoryLock
      && advisoryLock < firstMutation
      && Number.isFinite(firstMutation))) {
    throw verifierError('The staged migration does not prove a non-mutating fail-closed snapshot canary.');
  }
  return true;
}

function assertCatalogQueryIsReadOnly(query = CATALOG_QUERY) {
  const normalized = String(query || '').trim();
  if (!/^select\b/i.test(normalized)
      || /;\s*\S/.test(normalized)
      || /\b(?:insert|update|delete|merge|alter|drop|truncate|create|grant|revoke|copy|call|do)\b/i.test(normalized)
      || /\bfrom\s+(?:public\.)?crm_(?:records|meta|secret|audit)\b/i.test(normalized)
      || !/\bfrom\s+pg_catalog\.pg_proc\b/i.test(normalized)
      || !/\bfrom\s+pg_catalog\.pg_class\b/i.test(normalized)) {
    throw verifierError('The payment milestone snapshot RPC catalog query is not read-only.');
  }
  return normalized;
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

function normalizeSourceSeenColumns(value) {
  if (!Array.isArray(value)) return null;
  return value.map(column => ({
    name: String(column?.name || ''),
    type: String(column?.type || ''),
    not_null: column?.not_null === true,
    default_expression: column?.default_expression === null
      ? null
      : String(column?.default_expression || ''),
  }));
}

function validateCatalogRows(rows, migrationBody) {
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || typeof rows[0] !== 'object') {
    throw verifierError('The live payment milestone snapshot RPC catalog returned an invalid shape.');
  }
  const functions = Array.isArray(rows[0].functions) ? rows[0].functions : [];
  if (functions.length === 0) {
    throw verifierError('The staged payment milestone snapshot RPC is not installed in the live function catalog.');
  }
  if (functions.length !== 1) {
    throw verifierError('The live payment milestone snapshot RPC catalog contains multiple overloads.');
  }
  const row = functions[0] || {};
  if (row.name !== FUNCTION_NAME
      || JSON.stringify(normalizeStringArray(row.argument_names)) !== JSON.stringify(EXPECTED_ARGUMENT_NAMES)
      || JSON.stringify(normalizeStringArray(row.argument_types)) !== JSON.stringify(EXPECTED_ARGUMENT_TYPES)
      || row.argument_modes !== null || Number(row.default_count) !== 0
      || row.result_type !== 'integer' || row.returns_set !== false || row.function_kind !== 'f'
      || row.language !== 'plpgsql' || row.owner_name !== EXPECTED_OWNER
      || row.security_definer !== true || row.volatility !== 'v'
      || JSON.stringify(normalizeStringArray(row.settings)) !== JSON.stringify(EXPECTED_SETTINGS)
      || row.explicit_acl !== true || row.public_execute_revoked !== true
      || row.anon_execute !== true || row.authenticated_execute !== true || row.service_role_execute !== true
      || JSON.stringify(normalizeDirectAcl(row.direct_acl)) !== JSON.stringify(EXPECTED_DIRECT_ACL)
      || JSON.stringify(normalizeStringArray(row.unintended_effective_execute_roles)) !== '[]'
      || String(row.source || '').trim() !== String(migrationBody || '').trim()) {
    throw verifierError('The live payment milestone snapshot RPC contract differs from the staged migration.');
  }

  const columns = normalizeSourceSeenColumns(rows[0].source_seen_columns);
  if (JSON.stringify(columns) !== JSON.stringify([EXPECTED_SOURCE_SEEN_COLUMN])) {
    throw verifierError('The live crm_records source-observation column differs from the staged contract.');
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
    throw verifierError('The read-only payment milestone snapshot RPC catalog request failed.');
  }
  if (!response.ok) {
    throw verifierError(`The read-only payment milestone snapshot RPC catalog request returned HTTP ${response.status}.`);
  }
  return fetchJson(response, 'The read-only payment milestone snapshot RPC catalog returned an invalid response.');
}

async function runFailClosedCanary({ base, apiKey, sqlSecret, fetchImpl, signal }) {
  const observedAt = '2000-01-01T00:00:00.000Z';
  const record = {
    module: 'Payment_Milestones',
    id: 'not-numeric',
    data: { id: 'not-numeric', Name: 'non-mutating verifier canary' },
    name: 'non-mutating verifier canary',
    search_text: 'non-mutating verifier canary',
    created_time: null,
    modified_time: null,
    source_org_id: 'org00000000',
    source_seen_at: observedAt,
  };
  let response;
  try {
    response = await fetchImpl(`${base}/rest/v1/rpc/${FUNCTION_NAME}`, {
      method: 'POST',
      headers: { apikey: apiKey, Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: [record], s: sqlSecret }),
      signal,
    });
  } catch {
    throw verifierError('The fail-closed payment milestone snapshot RPC canary request failed.');
  }
  if (response.ok) {
    throw verifierError('The fail-closed payment milestone snapshot RPC canary was unexpectedly accepted.');
  }
  const error = await fetchJson(
    response,
    'The fail-closed payment milestone snapshot RPC canary returned an invalid response.',
  );
  if (response.status !== 400 || error?.code !== '22023'
      || error?.message !== 'invalid payment milestone snapshot row') {
    throw verifierError('The fail-closed payment milestone snapshot RPC canary did not return the expected rejection.');
  }
  return true;
}

async function verifyPaymentMilestoneSnapshotRpc({
  env = process.env,
  fetchImpl = fetch,
  migrationSql,
  signal,
  timeoutMs = DEFAULT_VERIFICATION_TIMEOUT_MS,
} = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw verifierError('Payment milestone snapshot RPC verification timeout is invalid.');
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
      reject(verifierError('Payment milestone snapshot RPC verification timed out safely.'));
    }, timeoutMs);
  });
  const verification = (async () => {
    if (controller.signal.aborted) {
      throw verifierError('Payment milestone snapshot RPC verification was cancelled safely.');
    }
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
  await verifyPaymentMilestoneSnapshotRpc();
  console.log('Payment milestone snapshot RPC verified: the live catalog matches the staged atomic contract, and the malformed-ID canary was rejected before organization lookup or DML. No database changes were made.');
}

if (require.main === module) {
  main().catch(error => {
    const message = error?.name === 'PaymentMilestoneSnapshotRpcVerifierError'
      ? error.message
      : 'Payment milestone snapshot RPC verification stopped safely.';
    console.error(`Payment milestone snapshot RPC verification failed: ${message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  CATALOG_QUERY,
  DEFAULT_VERIFICATION_TIMEOUT_MS,
  EXPECTED_ARGUMENT_NAMES,
  EXPECTED_ARGUMENT_TYPES,
  EXPECTED_DIRECT_ACL,
  EXPECTED_OWNER,
  EXPECTED_SETTINGS,
  EXPECTED_SOURCE_SEEN_COLUMN,
  FUNCTION_NAME,
  assertCatalogQueryIsReadOnly,
  assertFailClosedCanaryProof,
  connection,
  extractMigrationBody,
  readLiveCatalog,
  runFailClosedCanary,
  validateCatalogRows,
  verifyPaymentMilestoneSnapshotRpc,
};
