'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  CATALOG_QUERY,
  EXPECTED_DIRECT_ACL,
  EXPECTED_ARGUMENT_NAMES,
  EXPECTED_ARGUMENT_TYPES,
  EXPECTED_OWNER,
  EXPECTED_SETTINGS,
  assertCatalogQueryIsReadOnly,
  assertFailClosedCanaryProof,
  connection,
  extractMigrationBody,
  verifyBlueprintTransitionRpc,
} = require('../scripts/verify-blueprint-transition-rpc');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'database', 'migrations', '20260830_blueprint_transition_rpc.sql'),
  'utf8',
);
const migrationBody = extractMigrationBody(migration);
const env = {
  SUPABASE_URL: 'https://blueprint-verifier.supabase.co',
  SUPABASE_ANON_KEY: 'test-anon-key',
  CRM_SQL_SECRET: 'test-sql-secret',
};

function catalogRow(overrides = {}) {
  return {
    argument_types: [...EXPECTED_ARGUMENT_TYPES],
    argument_names: [...EXPECTED_ARGUMENT_NAMES],
    argument_modes: null,
    default_count: 3,
    default_expressions: 'NULL::text, NULL::text, NULL::text',
    result_type: 'jsonb',
    returns_set: false,
    function_kind: 'f',
    language: 'plpgsql',
    owner_name: EXPECTED_OWNER,
    security_definer: true,
    volatility: 'v',
    settings: [...EXPECTED_SETTINGS],
    source: migrationBody,
    explicit_acl: true,
    public_execute_revoked: true,
    direct_acl: EXPECTED_DIRECT_ACL.map(item => ({ ...item })),
    unintended_effective_execute_roles: [],
    anon_execute: true,
    authenticated_execute: true,
    service_role_execute: true,
    ...overrides,
  };
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test('uses one fixed catalog-only SELECT and proves the protected-field canary precedes record access', () => {
  assert.equal(assertCatalogQueryIsReadOnly(CATALOG_QUERY), CATALOG_QUERY.trim());
  assert.match(CATALOG_QUERY, /from pg_catalog\.pg_proc/i);
  assert.match(CATALOG_QUERY, /owner_role\.rolname as owner_name/i);
  assert.match(CATALOG_QUERY, /aclexplode[\s\S]*direct_acl/i);
  assert.match(CATALOG_QUERY, /unintended_effective_execute_roles/i);
  assert.doesNotMatch(CATALOG_QUERY, /\b(?:crm_records|crm_audit|crm_meta|crm_secret)\b/i);
  assert.equal(assertFailClosedCanaryProof(migrationBody), true);
  assert.throws(
    () => assertCatalogQueryIsReadOnly('select * from pg_catalog.pg_proc; update crm_records set data = null'),
    /not read-only/i,
  );
  assert.throws(
    () => assertFailClosedCanaryProof(migrationBody.replace('for update;', '')),
    /does not prove/i,
  );
});

test('fails closed for non-Supabase, credential-bearing, or incomplete connection settings', () => {
  assert.deepEqual(connection(env), {
    base: 'https://blueprint-verifier.supabase.co',
    apiKey: 'test-anon-key',
    sqlSecret: 'test-sql-secret',
  });
  assert.throws(() => connection({ ...env, SUPABASE_URL: 'http://blueprint-verifier.supabase.co' }), /failed closed/i);
  assert.throws(() => connection({ ...env, SUPABASE_URL: 'https://user:password@blueprint-verifier.supabase.co' }), /failed closed/i);
  assert.throws(() => connection({ ...env, CRM_SQL_SECRET: '' }), /failed closed/i);
});

test('verifies catalog first, then sends only the pre-lock protected-field rejection canary', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options, body: JSON.parse(options.body) });
    if (requests.length === 1) return response(200, [catalogRow()]);
    return response(400, { code: '22023', message: 'invalid Blueprint state field' });
  };

  const result = await verifyBlueprintTransitionRpc({ env, fetchImpl, migrationSql: migration });

  assert.deepEqual(result, {
    catalog_verified: true,
    fail_closed_canary_rejected: true,
    database_changes: 0,
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, 'https://blueprint-verifier.supabase.co/rest/v1/rpc/crm_sql');
  assert.equal(requests[0].body.q, CATALOG_QUERY.trim());
  assert.equal(requests[0].body.s, env.CRM_SQL_SECRET);
  assert.equal(requests[1].url, 'https://blueprint-verifier.supabase.co/rest/v1/rpc/crm_blueprint_transition');
  assert.equal(requests[1].body.p_state_field, 'id');
  assert.deepEqual(requests[1].body.p_patch, {});
  assert.equal(requests[1].body.p_module, '__blueprint_verifier__');
  assert.equal(requests[1].body.p_id, '__non_record__');
  assert.equal(requests[1].body.s, env.CRM_SQL_SECRET);
});

test('never runs the canary when the live body, exact signature, settings, owner, ACL, or effective grants drift', async () => {
  for (const row of [
    catalogRow({ source: `${migrationBody}\n-- drift` }),
    catalogRow({ argument_types: ['text'] }),
    catalogRow({ argument_modes: ['i'] }),
    catalogRow({ argument_modes: [] }),
    catalogRow({ default_expressions: 'NULL::text' }),
    catalogRow({ returns_set: true }),
    catalogRow({ settings: [...EXPECTED_SETTINGS, 'work_mem=64MB'] }),
    catalogRow({ owner_name: 'stale_owner' }),
    catalogRow({ explicit_acl: false }),
    catalogRow({ public_execute_revoked: false }),
    catalogRow({
      direct_acl: [
        ...EXPECTED_DIRECT_ACL.map(item => ({ ...item })),
        { grantor: 'postgres', grantee: 'stale_role', privilege_type: 'EXECUTE', is_grantable: false },
      ],
    }),
    catalogRow({
      direct_acl: EXPECTED_DIRECT_ACL.map(item => (
        item.grantee === 'anon' ? { ...item, is_grantable: true } : { ...item }
      )),
    }),
    catalogRow({
      direct_acl: EXPECTED_DIRECT_ACL.map(item => (
        item.grantee === 'postgres' ? { ...item, is_grantable: true } : { ...item }
      )),
    }),
    catalogRow({
      direct_acl: EXPECTED_DIRECT_ACL.map(item => (
        item.grantee === 'authenticated' ? { ...item, grantor: 'wrong_grantor' } : { ...item }
      )),
    }),
    catalogRow({ unintended_effective_execute_roles: ['inherited_role'] }),
  ]) {
    let calls = 0;
    await assert.rejects(
      () => verifyBlueprintTransitionRpc({
        env,
        migrationSql: migration,
        fetchImpl: async () => {
          calls += 1;
          return response(200, [row]);
        },
      }),
      /live Blueprint RPC/i,
    );
    assert.equal(calls, 1);
  }
});

test('uses one bounded AbortSignal for catalog and canary and times out a hung transport safely', async () => {
  const seenSignals = [];
  let calls = 0;
  const result = await verifyBlueprintTransitionRpc({
    env,
    migrationSql: migration,
    timeoutMs: 100,
    fetchImpl: async (_url, options) => {
      calls += 1;
      seenSignals.push(options.signal);
      return calls === 1
        ? response(200, [catalogRow()])
        : response(400, { code: '22023', message: 'invalid Blueprint state field' });
    },
  });
  assert.equal(result.catalog_verified, true);
  assert.equal(seenSignals.length, 2);
  assert.equal(seenSignals[0], seenSignals[1]);
  assert.equal(seenSignals[0] instanceof AbortSignal, true);

  const abortObserved = new Promise(resolve => {
    verifyBlueprintTransitionRpc({
      env,
      migrationSql: migration,
      timeoutMs: 10,
      fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          resolve(true);
          reject(new Error('aborted'));
        }, { once: true });
      }),
    }).catch(() => {});
  });
  assert.equal(await abortObserved, true);
  await assert.rejects(
    () => verifyBlueprintTransitionRpc({
      env,
      migrationSql: migration,
      timeoutMs: 10,
      fetchImpl: async () => new Promise(() => {}),
    }),
    /timed out safely/i,
  );
});

test('an already-aborted caller signal fails before any catalog request', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(
    () => verifyBlueprintTransitionRpc({
      env,
      migrationSql: migration,
      signal: controller.signal,
      fetchImpl: async () => { calls += 1; return response(200, [catalogRow()]); },
    }),
    /cancelled safely/i,
  );
  assert.equal(calls, 0);
});

test('reports an absent staged function precisely and does not run a canary', async () => {
  let calls = 0;
  await assert.rejects(
    () => verifyBlueprintTransitionRpc({
      env,
      migrationSql: migration,
      fetchImpl: async () => {
        calls += 1;
        return response(200, []);
      },
    }),
    /not installed in the live function catalog/i,
  );
  assert.equal(calls, 1);
});

test('stops safely on catalog transport errors or any unexpected canary outcome', async () => {
  await assert.rejects(
    () => verifyBlueprintTransitionRpc({
      env,
      migrationSql: migration,
      fetchImpl: async () => { throw new Error('postgres://user:password@host token=top-secret'); },
    }),
    error => {
      assert.match(error.message, /catalog request failed/i);
      assert.doesNotMatch(error.message, /postgres|password|top-secret|host/i);
      return true;
    },
  );

  let calls = 0;
  await assert.rejects(
    () => verifyBlueprintTransitionRpc({
      env,
      migrationSql: migration,
      fetchImpl: async () => {
        calls += 1;
        return calls === 1 ? response(200, [catalogRow()]) : response(200, { accepted: true });
      },
    }),
    /unexpectedly accepted/i,
  );
});
