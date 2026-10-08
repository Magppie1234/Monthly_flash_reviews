'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  CATALOG_QUERY,
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
  validateCatalogRows,
  verifySourceDeletionArchive,
} = require('../scripts/verify-source-deletion-archive');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'database', 'migrations', '20260830_source_deletion_archive.sql'),
  'utf8',
);
const bodies = extractMigrationBodies(migration);
const env = {
  SUPABASE_URL: 'https://source-deletion-verifier.supabase.co',
  SUPABASE_ANON_KEY: 'test-anon-key',
  CRM_SQL_SECRET: 'test-sql-secret',
};

function functionRows() {
  return EXPECTED_FUNCTION_NAMES.map(name => ({
    name,
    argument_types: [...FUNCTION_CONTRACTS[name].argument_types],
    argument_names: [...FUNCTION_CONTRACTS[name].argument_names],
    argument_modes: null,
    default_count: 0,
    result_type: FUNCTION_CONTRACTS[name].result_type,
    returns_set: false,
    function_kind: 'f',
    language: 'plpgsql',
    owner_name: EXPECTED_OWNER,
    security_definer: true,
    volatility: 'v',
    settings: [...FUNCTION_CONTRACTS[name].settings],
    source: bodies[name],
    explicit_acl: true,
    public_execute_revoked: true,
    direct_acl: EXPECTED_FUNCTION_ACL.map(item => ({ ...item })),
    unintended_effective_execute_roles: [],
    anon_execute: true,
    authenticated_execute: true,
    service_role_execute: true,
  }));
}

function constraintDefinition(table, name) {
  const definitions = {
    crm_record_tombstones_source_org_format: "CHECK ((source_org_id ~ '^org[0-9]{8,32}$'::text))",
    crm_record_tombstones_module_safe: "CHECK ((module = ANY (ARRAY['Leads'::text, 'Contacts'::text, 'Accounts'::text, 'Deals'::text, 'Tasks'::text, 'Events'::text, 'Calls'::text, 'Products'::text, 'Vendors'::text, 'Developers'::text, 'Referral_Partners'::text, 'Payment_Milestones'::text, 'Designers'::text, 'Visit_Module'::text, 'AMS_Complaints'::text])))",
    crm_record_tombstones_record_id_format: "CHECK ((record_id ~ '^[0-9]{8,32}$'::text))",
    crm_record_tombstones_deletion_type: "CHECK ((deletion_type = ANY (ARRAY['recycle'::text, 'permanent'::text])))",
    crm_record_tombstones_time_order: 'CHECK (((deleted_time <= observed_at) AND (archived_at >= observed_at)))',
    crm_record_tombstones_snapshot_object: "CHECK ((jsonb_typeof(record_snapshot) = 'object'::text))",
    crm_record_tombstones_snapshot_identity: "CHECK ((((record_snapshot ->> 'module'::text) = module) AND ((record_snapshot ->> 'id'::text) = record_id) AND (((record_snapshot -> 'data'::text) ->> 'id'::text) = record_id)))",
    crm_record_tombstones_row_snapshot: "CHECK ((row_present AND snapshot_source_seen_at IS NOT NULL) OR (NOT row_present AND record_snapshot = jsonb_build_object('module', module, 'id', record_id, 'data', jsonb_build_object('id', record_id))))",
    crm_record_tombstones_reactivation_consistency: 'CHECK (((reactivated_at IS NULL) AND (reactivated_by_source_seen_at IS NULL) AND (reactivated_by_modified_time IS NULL)) OR ((reactivated_at IS NOT NULL) AND (reactivated_by_source_seen_at IS NOT NULL)))',
    crm_record_tombstones_supersession_consistency: 'CHECK (((superseded_at IS NULL) AND (superseded_by_deleted_time IS NULL)) OR ((superseded_at IS NOT NULL) AND (superseded_by_deleted_time IS NOT NULL)))',
    crm_record_tombstones_terminal_state: 'CHECK ((NOT ((reactivated_at IS NOT NULL) AND (superseded_at IS NOT NULL))))',
    crm_record_tombstones_deletion_event_key: 'UNIQUE (source_org_id, module, record_id, deleted_time, deletion_type)',
    crm_record_tombstones_pkey: 'PRIMARY KEY (id)',
    crm_replication_leases_fixed_key: "CHECK ((lease_key = 'source-deletion-sync-v1'::text))",
    crm_replication_leases_time_order: 'CHECK ((expires_at > acquired_at))',
    crm_replication_leases_pkey: 'PRIMARY KEY (lease_key)',
  };
  if (definitions[name]) return definitions[name];
  return name.endsWith('_pkey') ? `PRIMARY KEY (${table === 'crm_record_tombstones' ? 'id' : 'lease_key'})` : 'CHECK (true)';
}

function indexDefinition(table, name) {
  if (name === 'crm_record_tombstones_current_idx') {
    return 'CREATE UNIQUE INDEX crm_record_tombstones_current_idx ON public.crm_record_tombstones USING btree (source_org_id, module, record_id) WHERE ((reactivated_at IS NULL) AND (superseded_at IS NULL))';
  }
  if (name === 'crm_replication_leases_expiry_idx') {
    return 'CREATE INDEX crm_replication_leases_expiry_idx ON public.crm_replication_leases USING btree (expires_at)';
  }
  const definitions = {
    crm_record_tombstones_deleted_idx: 'CREATE INDEX crm_record_tombstones_deleted_idx ON public.crm_record_tombstones USING btree (source_org_id, deleted_time DESC, id DESC)',
    crm_record_tombstones_deletion_event_key: 'CREATE UNIQUE INDEX crm_record_tombstones_deletion_event_key ON public.crm_record_tombstones USING btree (source_org_id, module, record_id, deleted_time, deletion_type)',
    crm_record_tombstones_pkey: 'CREATE UNIQUE INDEX crm_record_tombstones_pkey ON public.crm_record_tombstones USING btree (id)',
    crm_record_tombstones_reactivated_idx: 'CREATE INDEX crm_record_tombstones_reactivated_idx ON public.crm_record_tombstones USING btree (reactivated_at DESC) WHERE (reactivated_at IS NOT NULL)',
    crm_record_tombstones_record_history_idx: 'CREATE INDEX crm_record_tombstones_record_history_idx ON public.crm_record_tombstones USING btree (module, record_id, deleted_time DESC, id DESC)',
    crm_replication_leases_pkey: 'CREATE UNIQUE INDEX crm_replication_leases_pkey ON public.crm_replication_leases USING btree (lease_key)',
  };
  if (definitions[name]) return definitions[name];
  return `CREATE INDEX ${name} ON public.${table} USING btree (id)`;
}

function tableRows() {
  return Object.keys(EXPECTED_COLUMNS).sort().map(name => ({
    name,
    owner_name: EXPECTED_OWNER,
    row_security: true,
    force_row_security: true,
    policy_count: 0,
    columns: EXPECTED_COLUMNS[name].map(item => ({ ...item })),
    constraints: EXPECTED_CONSTRAINT_NAMES[name].map(constraintName => ({
      name: constraintName,
      definition: constraintDefinition(name, constraintName),
    })),
    indexes: EXPECTED_INDEX_NAMES[name].map(indexName => ({
      name: indexName,
      definition: indexDefinition(name, indexName),
    })),
    direct_acl: EXPECTED_TABLE_ACL.map(item => ({ ...item })),
    public_access: false,
    anon_access: false,
    authenticated_access: false,
    service_role_access: false,
    unintended_effective_access_roles: [],
  }));
}

function catalogPayload(overrides = {}) {
  return [{
    functions: functionRows(),
    tables: tableRows(),
    record_source_seen_column: [{
      name: 'source_seen_at',
      type: 'timestamp with time zone',
      not_null: false,
      default_expression: null,
    }],
    ...overrides,
  }];
}

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test('catalog inspection is fixed, read-only, and never selects CRM or tombstone rows', () => {
  assert.equal(assertCatalogQueryIsReadOnly(CATALOG_QUERY), CATALOG_QUERY.trim());
  assert.match(CATALOG_QUERY, /from pg_catalog\.pg_proc/i);
  assert.match(CATALOG_QUERY, /from pg_catalog\.pg_class/i);
  assert.match(CATALOG_QUERY, /pg_get_constraintdef/i);
  assert.match(CATALOG_QUERY, /pg_get_indexdef/i);
  assert.match(CATALOG_QUERY, /relforcerowsecurity/i);
  assert.doesNotMatch(CATALOG_QUERY, /\bfrom\s+(?:public\.)?crm_(?:records|record_tombstones|replication_leases|audit|meta|secret)\b/i);
  assert.throws(
    () => assertCatalogQueryIsReadOnly('select * from pg_catalog.pg_proc; delete from crm_records'),
    /not read-only/i,
  );
});

test('static proof places malformed-ID rejection before org, tombstone, and active-row reads', () => {
  assert.equal(assertFailClosedCanaryProof(bodies.crm_archive_source_record), true);
  assert.throws(
    () => assertFailClosedCanaryProof(bodies.crm_archive_source_record.replace("p_record_id !~ '^[0-9]{8,32}$'", 'false')),
    /does not prove/i,
  );
});

test('connection settings fail closed without a credential-free HTTPS Supabase origin', () => {
  assert.deepEqual(connection(env), {
    base: 'https://source-deletion-verifier.supabase.co',
    apiKey: 'test-anon-key',
    sqlSecret: 'test-sql-secret',
  });
  assert.throws(() => connection({ ...env, SUPABASE_URL: 'http://source-deletion-verifier.supabase.co' }), /failed closed/i);
  assert.throws(() => connection({ ...env, SUPABASE_URL: 'https://user:pass@source-deletion-verifier.supabase.co' }), /failed closed/i);
  assert.throws(() => connection({ ...env, CRM_SQL_SECRET: '' }), /failed closed/i);
});

test('verifies exact catalogs before sending only a malformed-ID non-mutating canary', async () => {
  const requests = [];
  const result = await verifySourceDeletionArchive({
    env,
    migrationSql: migration,
    fetchImpl: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body), signal: options.signal });
      return requests.length === 1
        ? response(200, catalogPayload())
        : response(400, { code: '22023', message: 'invalid source-deletion archive arguments' });
    },
  });
  assert.deepEqual(result, {
    catalog_verified: true,
    fail_closed_canary_rejected: true,
    database_changes: 0,
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, `${env.SUPABASE_URL}/rest/v1/rpc/crm_sql`);
  assert.equal(requests[0].body.q, CATALOG_QUERY.trim());
  assert.equal(requests[0].body.s, env.CRM_SQL_SECRET);
  assert.equal(requests[1].url, `${env.SUPABASE_URL}/rest/v1/rpc/crm_archive_source_record`);
  assert.equal(requests[1].body.p_record_id, 'local-source-deletion-canary');
  assert.equal(requests[1].body.p_module, 'Leads');
  assert.equal(requests[1].body.p_expected_modified_time, null);
  assert.equal(requests[1].body.p_expected_source_seen_at, null);
  assert.equal(requests[1].body.s, env.CRM_SQL_SECRET);
  assert.equal(requests[0].signal, requests[1].signal);
});

test('any function signature, body, setting, ACL, ownership, or inherited grant drift blocks the canary', async () => {
  const mutations = [
    rows => { rows[0].functions[0].source += '\n-- drift'; },
    rows => { rows[0].functions[0].argument_types = ['text']; },
    rows => { rows[0].functions[0].settings.push('work_mem=64MB'); },
    rows => { rows[0].functions[0].owner_name = 'wrong_owner'; },
    rows => { rows[0].functions[0].public_execute_revoked = false; },
    rows => { rows[0].functions[0].direct_acl.push({ grantor: 'postgres', grantee: 'extra_role', privilege_type: 'EXECUTE', is_grantable: false }); },
    rows => { rows[0].functions[0].unintended_effective_execute_roles = ['inherited_role']; },
  ];
  for (const mutate of mutations) {
    const rows = catalogPayload();
    mutate(rows);
    let calls = 0;
    await assert.rejects(
      () => verifySourceDeletionArchive({
        env,
        migrationSql: migration,
        fetchImpl: async () => { calls += 1; return response(200, rows); },
      }),
      /function contract/i,
    );
    assert.equal(calls, 1);
  }
});

test('table columns, constraints, indexes, forced RLS, policies, or grants may not drift', () => {
  const mutations = [
    rows => { rows[0].tables[0].columns[0].type = 'text'; },
    rows => { rows[0].tables[0].constraints.pop(); },
    rows => { rows[0].tables[0].indexes.pop(); },
    rows => { rows[0].tables[0].force_row_security = false; },
    rows => { rows[0].tables[0].policy_count = 1; },
    rows => { rows[0].tables[0].anon_access = true; },
    rows => { rows[0].tables[0].direct_acl.push({ grantor: 'postgres', grantee: 'anon', privilege_type: 'SELECT', is_grantable: false }); },
    rows => { rows[0].record_source_seen_column[0].default_expression = 'now()'; },
  ];
  for (const mutate of mutations) {
    const rows = catalogPayload();
    mutate(rows);
    assert.throws(() => validateCatalogRows(rows, bodies), /contract/i);
  }
});

test('timeouts, cancellation, transport failures, and unexpected canary success stop safely', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(
    () => verifySourceDeletionArchive({
      env,
      migrationSql: migration,
      signal: controller.signal,
      fetchImpl: async () => { calls += 1; return response(200, catalogPayload()); },
    }),
    /cancelled safely/i,
  );
  assert.equal(calls, 0);

  await assert.rejects(
    () => verifySourceDeletionArchive({
      env,
      migrationSql: migration,
      timeoutMs: 10,
      fetchImpl: async () => new Promise(() => {}),
    }),
    /timed out safely/i,
  );

  await assert.rejects(
    () => verifySourceDeletionArchive({
      env,
      migrationSql: migration,
      fetchImpl: async () => { throw new Error('postgres://user:password@host token=secret'); },
    }),
    error => {
      assert.match(error.message, /catalog request failed/i);
      assert.doesNotMatch(error.message, /postgres|password|token|secret|host/i);
      return true;
    },
  );

  calls = 0;
  await assert.rejects(
    () => verifySourceDeletionArchive({
      env,
      migrationSql: migration,
      fetchImpl: async () => {
        calls += 1;
        return calls === 1 ? response(200, catalogPayload()) : response(200, { accepted: true });
      },
    }),
    /unexpectedly accepted/i,
  );
});
