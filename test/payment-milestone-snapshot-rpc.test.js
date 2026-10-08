'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  CATALOG_QUERY,
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
  validateCatalogRows,
  verifyPaymentMilestoneSnapshotRpc,
} = require('../scripts/verify-payment-milestone-snapshot-rpc');

const migration = fs.readFileSync(
  path.join(
    __dirname,
    '..',
    'database',
    'migrations',
    '20260830_payment_milestone_snapshot_rpc.sql',
  ),
  'utf8',
);
const migrationBody = extractMigrationBody(migration);
const env = {
  SUPABASE_URL: 'https://payment-snapshot-verifier.supabase.co',
  SUPABASE_ANON_KEY: 'test-anon-key',
  CRM_SQL_SECRET: 'test-sql-secret',
};

function functionRow(overrides = {}) {
  return {
    name: FUNCTION_NAME,
    argument_types: [...EXPECTED_ARGUMENT_TYPES],
    argument_names: [...EXPECTED_ARGUMENT_NAMES],
    argument_modes: null,
    default_count: 0,
    result_type: 'integer',
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

function catalogPayload(overrides = {}) {
  return [{
    functions: [functionRow()],
    source_seen_columns: [{ ...EXPECTED_SOURCE_SEEN_COLUMN }],
    ...overrides,
  }];
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test('migration stages only the dedicated atomic RPC and nullable source observation column', () => {
  assert.match(migration, /^-- Staged atomic RPC/m);
  assert.match(migration, /\bBEGIN;[\s\S]*\bCOMMIT;\s*$/);
  assert.match(
    migration,
    /ALTER TABLE public\.crm_records[\s\S]*ADD COLUMN IF NOT EXISTS source_seen_at timestamp with time zone/,
  );
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.crm_payment_milestone_snapshot_upsert\(rows jsonb, s text\)[\s\S]*RETURNS integer/i,
  );
  assert.match(migration, /SECURITY DEFINER[\s\S]*SET search_path TO 'public'[\s\S]*SET lock_timeout TO '2s'[\s\S]*SET statement_timeout TO '30s'/);
  assert.match(migration, /ALTER FUNCTION public\.crm_payment_milestone_snapshot_upsert\(jsonb, text\) OWNER TO postgres/);
  assert.match(migration, /REVOKE ALL PRIVILEGES ON FUNCTION public\.crm_payment_milestone_snapshot_upsert\(jsonb, text\)[\s\S]*FROM PUBLIC CASCADE/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.crm_payment_milestone_snapshot_upsert\(jsonb, text\)[\s\S]*TO anon, authenticated, service_role/);
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE)\b/i);
});

test('RPC authenticates first and validates every bounded input row before organization reads, locks, or DML', () => {
  assert.equal(assertFailClosedCanaryProof(migrationBody), true);
  const authentication = migrationBody.indexOf('from public.crm_secret');
  const validationLoop = migrationBody.indexOf('for v_row in select value from jsonb_array_elements(rows)');
  const loopEnd = migrationBody.indexOf('end loop;', validationLoop);
  const organizationRead = migrationBody.indexOf('from public.crm_meta as m');
  const advisoryLock = migrationBody.indexOf('pg_catalog.pg_advisory_xact_lock(', organizationRead);
  const mutation = migrationBody.indexOf('insert into public.crm_records');
  assert.ok(authentication >= 0 && authentication < validationLoop);
  assert.ok(validationLoop < loopEnd && loopEnd < organizationRead);
  assert.ok(organizationRead < advisoryLock && advisoryLock < mutation);
  assert.match(migrationBody, /jsonb_array_length\(rows\) < 1[\s\S]*jsonb_array_length\(rows\) > 200/);
  assert.throws(
    () => assertFailClosedCanaryProof(migrationBody.replace("v_id !~ '^[0-9]{8,32}$'", 'false')),
    /does not prove/i,
  );
});

test('RPC is allowlisted to exact timestamp-less Payment_Milestones rows and one shared source observation', () => {
  assert.match(migrationBody, /v_row ->> 'module' is distinct from 'Payment_Milestones'/);
  assert.match(migrationBody, /v_id !~ '\^\[0-9\]\{8,32\}\$'/);
  assert.match(migrationBody, /jsonb_typeof\(v_data -> 'id'\) <> 'string'[\s\S]*v_data ->> 'id' is distinct from v_id/);
  assert.match(migrationBody, /v_data \? 'Modified_Time'/);
  assert.match(migrationBody, /jsonb_typeof\(v_row -> 'modified_time'\) <> 'null'/);
  assert.match(migrationBody, /duplicate payment milestone snapshot identifier/);
  assert.match(
    migrationBody,
    /v_row_source_org_id is distinct from v_source_org_id[\s\S]*v_row_source_seen_at_text is distinct from v_source_seen_at_text/,
  );
  assert.match(migrationBody, /noncanonical payment milestone snapshot observation time/);
  assert.doesNotMatch(migrationBody, /Last_Activity_Time/);
});

test('RPC requires the exact verified organization lock and coordinates one ordered transaction', () => {
  assert.match(migrationBody, /m\.key = 'source_replication_lock'/);
  assert.match(migrationBody, /v_lock -> 'verified' is distinct from 'true'::jsonb/);
  assert.match(migrationBody, /v_source_org_id is distinct from v_lock ->> 'source_org_id'/);
  const locks = migrationBody.match(/pg_catalog\.pg_advisory_xact_lock\(/g) || [];
  assert.equal(locks.length, 2);
  assert.match(migrationBody, /'Payment_Milestones', 'snapshot'/);
  assert.match(migrationBody, /order by incoming\.value ->> 'id'/);
});

test('RPC rejects stale batches and writes exactly the full input count with null modified_time ordering', () => {
  const staleGuard = migrationBody.indexOf("target.source_seen_at > v_source_seen_at");
  const mutation = migrationBody.indexOf('insert into public.crm_records');
  assert.ok(staleGuard >= 0 && staleGuard < mutation);
  assert.match(migrationBody, /null::timestamp with time zone,[\s\S]*v_source_seen_at/);
  assert.match(migrationBody, /modified_time = null,[\s\S]*source_seen_at = excluded\.source_seen_at/);
  assert.match(
    migrationBody,
    /where crm_records\.source_seen_at is null[\s\S]*excluded\.source_seen_at >= crm_records\.source_seen_at/,
  );
  assert.match(migrationBody, /get diagnostics v_changed = row_count/);
  assert.match(migrationBody, /v_changed is distinct from v_expected_count[\s\S]*raise exception[\s\S]*return v_expected_count/);
  assert.doesNotMatch(migrationBody, /\bcontinue\s*;/i);
  assert.equal((migrationBody.match(/insert into public\.crm_records/g) || []).length, 1);
  assert.equal((migrationBody.match(/update public\.crm_records/g) || []).length, 0);
  assert.equal((migrationBody.match(/delete from public\.crm_records/g) || []).length, 0);
});

test('catalog inspection is fixed, read-only, and returns no CRM data rows', () => {
  assert.equal(assertCatalogQueryIsReadOnly(CATALOG_QUERY), CATALOG_QUERY.trim());
  assert.match(CATALOG_QUERY, /from pg_catalog\.pg_proc/i);
  assert.match(CATALOG_QUERY, /from pg_catalog\.pg_class/i);
  assert.match(CATALOG_QUERY, /aclexplode/i);
  assert.match(CATALOG_QUERY, /unintended_effective_execute_roles/i);
  assert.doesNotMatch(CATALOG_QUERY, /\bfrom\s+(?:public\.)?crm_(?:records|meta|secret|audit)\b/i);
  assert.throws(
    () => assertCatalogQueryIsReadOnly('select * from pg_catalog.pg_proc; update crm_records set data = null'),
    /not read-only/i,
  );
});

test('verifier connection settings fail closed', () => {
  assert.deepEqual(connection(env), {
    base: 'https://payment-snapshot-verifier.supabase.co',
    apiKey: 'test-anon-key',
    sqlSecret: 'test-sql-secret',
  });
  assert.throws(() => connection({ ...env, SUPABASE_URL: 'http://payment-snapshot-verifier.supabase.co' }), /failed closed/i);
  assert.throws(() => connection({ ...env, SUPABASE_URL: 'https://user:pass@payment-snapshot-verifier.supabase.co' }), /failed closed/i);
  assert.throws(() => connection({ ...env, SUPABASE_URL: 'https://payment-snapshot-verifier.supabase.co/path' }), /failed closed/i);
  assert.throws(() => connection({ ...env, CRM_SQL_SECRET: '' }), /failed closed/i);
});

test('verifier confirms exact catalog state before one malformed-ID non-mutating canary', async () => {
  const requests = [];
  const result = await verifyPaymentMilestoneSnapshotRpc({
    env,
    migrationSql: migration,
    fetchImpl: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body), signal: options.signal });
      return requests.length === 1
        ? response(200, catalogPayload())
        : response(400, { code: '22023', message: 'invalid payment milestone snapshot row' });
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
  assert.equal(requests[1].url, `${env.SUPABASE_URL}/rest/v1/rpc/${FUNCTION_NAME}`);
  assert.equal(requests[1].body.rows.length, 1);
  assert.equal(requests[1].body.rows[0].module, 'Payment_Milestones');
  assert.equal(requests[1].body.rows[0].id, 'not-numeric');
  assert.equal(requests[1].body.rows[0].data.id, 'not-numeric');
  assert.equal(requests[1].body.rows[0].modified_time, null);
  assert.equal(Object.hasOwn(requests[1].body.rows[0].data, 'Modified_Time'), false);
  assert.equal(requests[1].body.s, env.CRM_SQL_SECRET);
  assert.equal(requests[0].signal, requests[1].signal);
});

test('catalog drift or overloads block the canary', async () => {
  const mutations = [
    rows => { rows[0].functions[0].source += '\n-- drift'; },
    rows => { rows[0].functions[0].argument_types = ['text']; },
    rows => { rows[0].functions[0].argument_modes = ['i', 'i']; },
    rows => { rows[0].functions[0].default_count = 1; },
    rows => { rows[0].functions[0].result_type = 'jsonb'; },
    rows => { rows[0].functions[0].settings.push('work_mem=64MB'); },
    rows => { rows[0].functions[0].owner_name = 'wrong_owner'; },
    rows => { rows[0].functions[0].security_definer = false; },
    rows => { rows[0].functions[0].public_execute_revoked = false; },
    rows => { rows[0].functions[0].direct_acl[0].is_grantable = true; },
    rows => { rows[0].functions[0].unintended_effective_execute_roles = ['inherited_role']; },
    rows => { rows[0].functions.push(functionRow()); },
  ];
  for (const mutate of mutations) {
    const rows = catalogPayload();
    mutate(rows);
    let calls = 0;
    await assert.rejects(
      () => verifyPaymentMilestoneSnapshotRpc({
        env,
        migrationSql: migration,
        fetchImpl: async () => { calls += 1; return response(200, rows); },
      }),
      /catalog contains multiple overloads|contract differs/i,
    );
    assert.equal(calls, 1);
  }
});

test('missing or drifted nullable source_seen_at column blocks the canary', () => {
  for (const source_seen_columns of [
    [],
    [{ ...EXPECTED_SOURCE_SEEN_COLUMN, type: 'timestamp without time zone' }],
    [{ ...EXPECTED_SOURCE_SEEN_COLUMN, not_null: true }],
    [{ ...EXPECTED_SOURCE_SEEN_COLUMN, default_expression: 'now()' }],
    [{ ...EXPECTED_SOURCE_SEEN_COLUMN }, { ...EXPECTED_SOURCE_SEEN_COLUMN }],
  ]) {
    assert.throws(
      () => validateCatalogRows(catalogPayload({ source_seen_columns }), migrationBody),
      /source-observation column/i,
    );
  }
});

test('absent function, unexpected canary success, and wrong rejection fail closed', async () => {
  let calls = 0;
  await assert.rejects(
    () => verifyPaymentMilestoneSnapshotRpc({
      env,
      migrationSql: migration,
      fetchImpl: async () => { calls += 1; return response(200, catalogPayload({ functions: [] })); },
    }),
    /not installed/i,
  );
  assert.equal(calls, 1);

  for (const canaryResponse of [
    response(200, 1),
    response(400, { code: '22023', message: 'different rejection' }),
    response(401, { code: '42501', message: 'unauthorized' }),
  ]) {
    let requestNumber = 0;
    await assert.rejects(
      () => verifyPaymentMilestoneSnapshotRpc({
        env,
        migrationSql: migration,
        fetchImpl: async () => {
          requestNumber += 1;
          return requestNumber === 1 ? response(200, catalogPayload()) : canaryResponse;
        },
      }),
      /canary/i,
    );
    assert.equal(requestNumber, 2);
  }
});

test('one bounded abort signal covers catalog and canary; cancellation and timeouts stop safely', async () => {
  const seenSignals = [];
  let calls = 0;
  const result = await verifyPaymentMilestoneSnapshotRpc({
    env,
    migrationSql: migration,
    timeoutMs: 100,
    fetchImpl: async (_url, options) => {
      calls += 1;
      seenSignals.push(options.signal);
      return calls === 1
        ? response(200, catalogPayload())
        : response(400, { code: '22023', message: 'invalid payment milestone snapshot row' });
    },
  });
  assert.equal(result.catalog_verified, true);
  assert.equal(seenSignals.length, 2);
  assert.equal(seenSignals[0], seenSignals[1]);
  assert.equal(seenSignals[0] instanceof AbortSignal, true);

  const controller = new AbortController();
  controller.abort();
  calls = 0;
  await assert.rejects(
    () => verifyPaymentMilestoneSnapshotRpc({
      env,
      migrationSql: migration,
      signal: controller.signal,
      fetchImpl: async () => { calls += 1; return response(200, catalogPayload()); },
    }),
    /cancelled safely/i,
  );
  assert.equal(calls, 0);

  const abortObserved = new Promise(resolve => {
    verifyPaymentMilestoneSnapshotRpc({
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
});

test('invalid verifier timeout and malformed migration text stop before any network request', async () => {
  let calls = 0;
  for (const timeoutMs of [0, -1, 60_001, 1.5]) {
    await assert.rejects(
      () => verifyPaymentMilestoneSnapshotRpc({
        env,
        migrationSql: migration,
        timeoutMs,
        fetchImpl: async () => { calls += 1; return response(200, catalogPayload()); },
      }),
      /timeout is invalid/i,
    );
  }
  await assert.rejects(
    () => verifyPaymentMilestoneSnapshotRpc({
      env,
      migrationSql: 'select 1;',
      fetchImpl: async () => { calls += 1; return response(200, catalogPayload()); },
    }),
    /migration contract is unavailable/i,
  );
  assert.equal(calls, 0);
});
