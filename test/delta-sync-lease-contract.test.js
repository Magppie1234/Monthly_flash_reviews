'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  MAX_LEASE_TTL_SECONDS,
  MIN_LEASE_TTL_SECONDS,
  RPC_NAMES,
  DeltaSyncLeaseError,
  createDeltaSyncLeaseClient,
} = require('../lib/delta-sync-lease');
const {
  CATALOG_QUERY,
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
} = require('../scripts/verify-delta-sync-lease-state');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'database', 'migrations', '20260830_delta_sync_lease_state.sql'),
  'utf8',
);
const migrationBodies = extractMigrationBodies(migration);
const OWNER_A = '11111111-1111-4111-8111-111111111111';
const OWNER_B = '22222222-2222-4222-8222-222222222222';
const EXPIRES_AT = '2026-08-30T18:30:45.000Z';

function functionRows() {
  return EXPECTED_FUNCTION_NAMES.map(name => ({
    name,
    argument_types: [...FUNCTION_CONTRACTS[name].argument_types],
    argument_names: [...FUNCTION_CONTRACTS[name].argument_names],
    argument_modes: null,
    default_count: 0,
    result_type: 'jsonb',
    returns_set: false,
    function_kind: 'f',
    language: 'plpgsql',
    owner_name: EXPECTED_OWNER,
    security_definer: true,
    volatility: 'v',
    settings: [...FUNCTION_CONTRACTS[name].settings],
    source: migrationBodies[name],
    explicit_acl: true,
    public_execute_revoked: true,
    direct_acl: EXPECTED_FUNCTION_ACL_GRANTEES.map(grantee => ({
      grantee,
      privilege_type: 'EXECUTE',
      is_grantable: false,
    })),
    unintended_effective_execute_roles: [],
  }));
}

function tableRow() {
  return {
    name: 'crm_delta_sync_control',
    owner_name: EXPECTED_OWNER,
    row_security: true,
    force_row_security: true,
    policy_count: 0,
    columns: EXPECTED_COLUMNS.map(column => ({
      ...column,
      default_expression: column.name === 'state_revision'
        ? '0'
        : (column.name === 'updated_at' ? 'clock_timestamp()' : null),
    })),
    constraints: EXPECTED_CONSTRAINT_NAMES.map(name => ({
      name,
      definition: name === 'crm_delta_sync_control_duration_bound'
        ? "CHECK ((expires_at <= (acquired_at + '00:00:50'::interval))) /* 50 seconds */"
        : (name === 'crm_delta_sync_control_revision_nonnegative'
          ? 'CHECK ((state_revision >= 0))'
          : 'CHECK (true)'),
    })),
    public_access_revoked: true,
    anon_access_revoked: true,
    authenticated_access_revoked: true,
    service_role_access_revoked: true,
    unintended_effective_access_roles: [],
  };
}

function catalogPayload(overrides = {}) {
  return [{
    contract: {
      functions: functionRows(),
      tables: [tableRow()],
      ...overrides,
    },
  }];
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test('staged SQL authenticates every RPC, bounds leases below 60 seconds, recovers expiry, fences state, and hides owner tokens', () => {
  assert.equal(assertStaticContract(migration, migrationBodies), true);
  assert.match(migration, /p_ttl_seconds < 5[\s\S]*p_ttl_seconds > 50/i);
  assert.match(migrationBodies.crm_acquire_delta_sync_lease, /owner_id is null or expires_at <= v_now/i);
  assert.match(migrationBodies.crm_save_delta_sync_state, /state_revision = p_expected_revision/i);
  assert.match(migrationBodies.crm_save_delta_sync_state, /state_revision = state_revision \+ 1/i);
  assert.match(migrationBodies.crm_release_delta_sync_lease, /owner_id = p_owner_id/i);
  assert.doesNotMatch(migration, /'owner_id'/i);
  assert.doesNotMatch(migrationBodies.crm_read_delta_sync_state, /select[\s\S]*owner_id\s*,/i);
});

test('client enforces the database TTL envelope and canonical unguessable owner tokens', async () => {
  const noopRpc = async () => ({ acquired: false });
  assert.throws(
    () => createDeltaSyncLeaseClient({ callRpc: noopRpc, ttlSeconds: MIN_LEASE_TTL_SECONDS - 1 }),
    /ttlSeconds/i,
  );
  assert.throws(
    () => createDeltaSyncLeaseClient({ callRpc: noopRpc, ttlSeconds: MAX_LEASE_TTL_SECONDS + 1 }),
    /ttlSeconds/i,
  );
  const client = createDeltaSyncLeaseClient({
    callRpc: noopRpc,
    generateOwnerId: () => 'not-a-uuid',
  });
  await assert.rejects(() => client.acquire(), error => (
    error instanceof DeltaSyncLeaseError && error.code === 'OWNER_TOKEN_INVALID'
  ));
});

test('lease session uses one private owner token for acquire, renewal, CAS save, and matching release', async () => {
  const calls = [];
  const initialState = { schema_version: 2, modules: {} };
  const client = createDeltaSyncLeaseClient({
    generateOwnerId: () => OWNER_A,
    callRpc: async (name, body) => {
      calls.push({ name, body: structuredClone(body) });
      if (name === RPC_NAMES.acquire) {
        return { acquired: true, revision: 7, state: initialState, lease_expires_at: EXPIRES_AT };
      }
      if (name === RPC_NAMES.renew) return { renewed: true, lease_expires_at: EXPIRES_AT };
      if (name === RPC_NAMES.save) return { saved: true, revision: 8 };
      if (name === RPC_NAMES.release) return { released: true };
      throw new Error('unexpected RPC');
    },
  });

  const session = await client.acquire();
  assert.deepEqual(await session.stateStore.load(), initialState);
  initialState.modules.Leads = { cursor: { record_id: 'mutated-outside' } };
  assert.deepEqual(await session.stateStore.load(), { schema_version: 2, modules: {} });
  assert.deepEqual(await session.renew(), { renewed: true, lease_expires_at: EXPIRES_AT });
  const savedState = { schema_version: 2, modules: { Leads: { cursor: null } } };
  assert.deepEqual(await session.stateStore.save(savedState), savedState);
  assert.equal(session.status().revision, 8);
  assert.equal(await session.release(), true);

  assert.deepEqual(calls.map(call => call.name), [
    RPC_NAMES.acquire,
    RPC_NAMES.renew,
    RPC_NAMES.save,
    RPC_NAMES.release,
  ]);
  assert.equal(calls[0].body.p_owner_id, OWNER_A);
  assert.equal(calls[1].body.p_owner_id, OWNER_A);
  assert.equal(calls[2].body.p_owner_id, OWNER_A);
  assert.equal(calls[2].body.p_expected_revision, 7);
  assert.deepEqual(calls[2].body.p_state, savedState);
  assert.equal(calls[3].body.p_owner_id, OWNER_A);
  assert.equal(Object.prototype.hasOwnProperty.call(session, 'owner_id'), false);
  assert.equal(JSON.stringify(session.status()).includes(OWNER_A), false);
  await assert.rejects(() => session.stateStore.load(), /not held/i);
});

test('overlap is rejected without starting work or exposing the current owner', async () => {
  let workCalls = 0;
  let timerCalls = 0;
  const client = createDeltaSyncLeaseClient({
    generateOwnerId: () => OWNER_B,
    callRpc: async name => {
      assert.equal(name, RPC_NAMES.acquire);
      return { acquired: false };
    },
    setIntervalImpl: () => { timerCalls += 1; },
  });
  const result = await client.runExclusive(async () => { workCalls += 1; });
  assert.deepEqual(result, { acquired: false, reason: 'already_running' });
  assert.equal(workCalls, 0);
  assert.equal(timerCalls, 0);
  assert.equal(JSON.stringify(result).includes(OWNER_B), false);
});

test('uncertain or stale CAS failure is fail-closed and the public error omits database details', async () => {
  const calls = [];
  const client = createDeltaSyncLeaseClient({
    generateOwnerId: () => OWNER_A,
    callRpc: async (name, body) => {
      calls.push({ name, body });
      if (name === RPC_NAMES.acquire) {
        return { acquired: true, revision: 4, state: {}, lease_expires_at: EXPIRES_AT };
      }
      if (name === RPC_NAMES.save) {
        throw new Error(`40001 stale owner ${OWNER_A} database-secret-value`);
      }
      if (name === RPC_NAMES.release) return { released: false };
      throw new Error('unexpected RPC');
    },
  });
  const session = await client.acquire();
  await assert.rejects(
    () => session.stateStore.save({ schema_version: 2 }),
    error => error.code === 'STATE_CAS_FAILED'
      && error.message === 'Delta-sync state could not be persisted safely.'
      && !error.message.includes(OWNER_A)
      && !error.message.includes('database-secret-value'),
  );
  await assert.rejects(() => session.stateStore.save({ schema_version: 2 }), /could not be persisted safely/i);
  assert.equal(await session.release(), false);
  assert.deepEqual(calls.map(call => call.name), [RPC_NAMES.acquire, RPC_NAMES.save, RPC_NAMES.release]);
});

test('release failures retain the bounded release error contract', async () => {
  const client = createDeltaSyncLeaseClient({
    generateOwnerId: () => OWNER_A,
    callRpc: async name => {
      if (name === RPC_NAMES.acquire) {
        return { acquired: true, revision: 0, state: null, lease_expires_at: EXPIRES_AT };
      }
      if (name === RPC_NAMES.release) throw new Error(`private release detail ${OWNER_A}`);
      throw new Error('unexpected RPC');
    },
  });
  const session = await client.acquire();
  await assert.rejects(
    () => session.release(),
    error => error instanceof DeltaSyncLeaseError
      && error.code === 'LEASE_RELEASE_FAILED'
      && error.message === 'The delta-sync lease could not be released.'
      && !error.message.includes(OWNER_A),
  );
});

test('read-only state RPC returns revision and lease activity without an owner token', async () => {
  const client = createDeltaSyncLeaseClient({
    callRpc: async (name, body) => {
      assert.equal(name, RPC_NAMES.read);
      assert.deepEqual(body, {});
      return { revision: 12, state: { schema_version: 2 }, lease_active: true };
    },
  });
  const result = await client.readState();
  assert.deepEqual(result, { revision: 12, state: { schema_version: 2 }, lease_active: true });
  assert.equal(JSON.stringify(result).includes(OWNER_A), false);
});

test('catalog verifier is fixed, read-only, and validates exact functions, RLS, constraints, and ACLs', async () => {
  assert.equal(assertCatalogQueryIsReadOnly(CATALOG_QUERY), CATALOG_QUERY.trim());
  assert.doesNotMatch(CATALOG_QUERY, /\bfrom\s+(?:public\.)?crm_delta_sync_control\b/i);
  assert.throws(
    () => assertCatalogQueryIsReadOnly(`${CATALOG_QUERY}; update crm_delta_sync_control set state = '{}'`),
    /not read-only/i,
  );
  assert.equal(validateCatalogRows(catalogPayload(), migrationBodies), true);

  const env = {
    SUPABASE_URL: 'https://delta-lease-verifier.supabase.co',
    SUPABASE_ANON_KEY: 'test-anon-key',
    CRM_SQL_SECRET: 'test-sql-secret',
  };
  assert.deepEqual(connection(env), {
    base: 'https://delta-lease-verifier.supabase.co',
    apiKey: 'test-anon-key',
    sqlSecret: 'test-sql-secret',
  });
  let request;
  const result = await verifyDeltaSyncLeaseState({
    env,
    migrationSql: migration,
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return response(200, catalogPayload());
    },
  });
  assert.deepEqual(result, { catalog_verified: true, database_changes: 0 });
  assert.equal(request.url, 'https://delta-lease-verifier.supabase.co/rest/v1/rpc/crm_sql');
  assert.equal(request.body.q, CATALOG_QUERY.trim());
  assert.equal(request.body.s, env.CRM_SQL_SECRET);
  assert.equal(request.options.signal instanceof AbortSignal, true);
});

test('catalog verifier fails closed on body, ACL, constraint, or connection drift', async () => {
  const bodyDrift = catalogPayload();
  bodyDrift[0].contract.functions[0].source += '\n-- drift';
  assert.throws(() => validateCatalogRows(bodyDrift, migrationBodies), /differs/i);

  const aclDrift = catalogPayload();
  aclDrift[0].contract.functions[0].direct_acl.push({
    grantee: 'stale_role',
    privilege_type: 'EXECUTE',
    is_grantable: false,
  });
  assert.throws(() => validateCatalogRows(aclDrift, migrationBodies), /differs/i);

  const constraintDrift = catalogPayload();
  constraintDrift[0].contract.tables[0].constraints = constraintDrift[0].contract.tables[0].constraints
    .filter(item => item.name !== 'crm_delta_sync_control_duration_bound');
  assert.throws(() => validateCatalogRows(constraintDrift, migrationBodies), /differs/i);

  assert.throws(() => connection({
    SUPABASE_URL: 'http://delta-lease-verifier.supabase.co',
    SUPABASE_ANON_KEY: 'key',
    CRM_SQL_SECRET: 'secret',
  }), /failed closed/i);
  assert.throws(() => connection({
    SUPABASE_URL: 'https://user:password@delta-lease-verifier.supabase.co',
    SUPABASE_ANON_KEY: 'key',
    CRM_SQL_SECRET: 'secret',
  }), /failed closed/i);
});
