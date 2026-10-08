'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  HOME_DASHBOARD_STATES,
  createHomeDashboardService,
} = require('../lib/home-dashboard-service');

const FIXED_ERROR = Object.freeze({
  status: 503,
  code: 'HOME_DASHBOARD_UNAVAILABLE',
  message: 'Home dashboard is temporarily unavailable. Existing CRM records were not changed.',
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function assertFixedAvailabilityError(error) {
  assert.equal(error?.status, FIXED_ERROR.status);
  assert.equal(error?.code, FIXED_ERROR.code);
  assert.equal(error?.message, FIXED_ERROR.message);
  assert.equal(error?.cause, undefined);
  assert.deepEqual(Object.keys(error).sort(), ['code', 'status']);
  return true;
}

test('ten concurrent cold callers share exactly one local computation', async () => {
  const cold = deferred();
  let calls = 0;
  const service = createHomeDashboardService({
    compute: async () => {
      calls += 1;
      return cold.promise;
    },
    computeTimeoutMs: 1_000,
  });

  const reads = Array.from({ length: 10 }, () => service.get());
  assert.ok(reads.every(read => read === reads[0]), 'cold callers must receive the same flight Promise');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(service.status().state, HOME_DASHBOARD_STATES.REFRESHING);

  const dashboard = { generated_at: '2026-08-30T00:00:00.000Z', kpis: { totalLeads: 10 } };
  cold.resolve(dashboard);
  assert.deepEqual(await Promise.all(reads), Array(10).fill(dashboard));
  assert.equal(calls, 1);
  assert.equal(service.status().state, HOME_DASHBOARD_STATES.FRESH);
});

test('fresh cache path is synchronous by design and performs no recomputation', async () => {
  let calls = 0;
  const dashboard = { kpis: { totalLeads: 12 } };
  const service = createHomeDashboardService({
    compute: async () => {
      calls += 1;
      return dashboard;
    },
  });

  assert.strictEqual(await service.get(), dashboard);
  const warm = service.get();
  assert.strictEqual(warm, dashboard);
  assert.equal(typeof warm?.then, 'undefined', 'warm cache hit must not create an awaitable path');
  assert.equal(calls, 1);
});

test('stale last-known-good returns immediately while only one bounded refresh runs', async () => {
  let nowMs = 10_000;
  const refresh = deferred();
  let calls = 0;
  const stale = { generated_at: '2026-08-29T00:00:00.000Z', kpis: { totalLeads: 8 } };
  const current = { generated_at: '2026-08-30T00:00:00.000Z', kpis: { totalLeads: 9 } };
  const service = createHomeDashboardService({
    compute: () => {
      calls += 1;
      return refresh.promise;
    },
    freshTtlMs: 100,
    computeTimeoutMs: 1_000,
    now: () => nowMs,
  });
  service.seed(stale, { storedAt: 9_000 });

  const first = service.get();
  const second = service.get();
  assert.strictEqual(first, stale);
  assert.strictEqual(second, stale);
  assert.equal(typeof first?.then, 'undefined');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(service.status().state, HOME_DASHBOARD_STATES.STALE_REFRESHING);

  nowMs = 10_010;
  refresh.resolve(current);
  assert.strictEqual(await service.refresh(), current);
  assert.strictEqual(service.get(), current);
  assert.equal(calls, 1);
});

test('PostgreSQL 57014, generic failures, and invalid cold results expose the same fixed availability error', async t => {
  const failures = [
    Object.assign(new Error('canceling statement due to statement timeout: select data from crm_records'), { code: '57014' }),
    Object.assign(new Error('database host and credentials must stay private'), { internal: { record_id: 'private' } }),
    null,
  ];

  for (const [index, failure] of failures.entries()) {
    await t.test(`failure ${index + 1}`, async () => {
      let nowMs = 50_000 + index;
      const service = createHomeDashboardService({
        compute: async () => {
          if (failure === null) return null;
          throw failure;
        },
        now: () => nowMs++,
      });
      await assert.rejects(service.get(), assertFixedAvailabilityError);
      const serialized = JSON.stringify(service.status());
      assert.equal(service.status().state, HOME_DASHBOARD_STATES.UNAVAILABLE);
      assert.doesNotMatch(serialized, /57014|select|crm_records|credentials|record_id|private/i);
    });
  }
});

test('failed stale refresh never destroys last-known-good data', async () => {
  let nowMs = 2_000;
  let calls = 0;
  const stale = { kpis: { totalLeads: 21 } };
  const service = createHomeDashboardService({
    compute: async () => {
      calls += 1;
      throw new Error('raw database failure');
    },
    freshTtlMs: 10,
    now: () => nowMs,
  });
  service.seed(stale, { storedAt: 1_000 });

  assert.strictEqual(service.get(), stale);
  await assert.rejects(service.refresh(), assertFixedAvailabilityError);
  assert.equal(calls, 1);
  assert.equal(service.status().state, HOME_DASHBOARD_STATES.STALE);
  assert.equal(service.status().has_last_known_good, true);
  assert.strictEqual(service.get(), stale);
});

test('invalidation prevents an old flight from publishing into the new generation', async () => {
  const oldFlight = deferred();
  const newFlight = deferred();
  let calls = 0;
  const service = createHomeDashboardService({
    compute: () => {
      calls += 1;
      return calls === 1 ? oldFlight.promise : newFlight.promise;
    },
    computeTimeoutMs: 1_000,
  });

  const oldRead = service.get();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  service.invalidate();
  await assert.rejects(oldRead, assertFixedAvailabilityError);

  const newRead = service.get();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 2);
  const current = { kpis: { totalLeads: 31 } };
  newFlight.resolve(current);
  assert.strictEqual(await newRead, current);

  oldFlight.resolve({ kpis: { totalLeads: 1 } });
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(service.get(), current, 'old completion must not replace the new generation');
  assert.equal(service.status().generation, 1);
});

test('invalidation preserves last-known-good as stale while one new-generation refresh runs', async () => {
  const refresh = deferred();
  let calls = 0;
  const stale = { kpis: { totalLeads: 40 } };
  const current = { kpis: { totalLeads: 41 } };
  const service = createHomeDashboardService({
    compute: () => {
      calls += 1;
      return refresh.promise;
    },
    computeTimeoutMs: 1_000,
  });
  service.seed(stale);

  service.invalidate();
  assert.equal(service.status().state, HOME_DASHBOARD_STATES.STALE);
  assert.equal(service.status().has_last_known_good, true);
  assert.strictEqual(service.get(), stale);
  assert.strictEqual(service.get(), stale);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(service.status().state, HOME_DASHBOARD_STATES.STALE_REFRESHING);

  refresh.resolve(current);
  assert.strictEqual(await service.refresh(), current);
  assert.strictEqual(service.get(), current);
});

test('visibility-sensitive invalidation discards last-known-good rows before refreshing', async () => {
  const refresh = deferred();
  const stale = { kpis: { totalLeads: 40 } };
  const current = { kpis: { totalLeads: 39 } };
  const service = createHomeDashboardService({
    compute: () => refresh.promise,
    computeTimeoutMs: 1_000,
  });
  service.seed(stale);

  service.invalidate({ dropLastKnownGood: true });
  assert.equal(service.status().has_last_known_good, false);
  const coldRead = service.get();
  assert.equal(typeof coldRead?.then, 'function');
  refresh.resolve(current);
  assert.strictEqual(await coldRead, current);
  assert.strictEqual(service.get(), current);
});

test('hung computation is aborted and every cold client settles within the configured bound', async () => {
  let observedSignal = null;
  const service = createHomeDashboardService({
    compute: ({ signal }) => {
      observedSignal = signal;
      return new Promise(() => {});
    },
    computeTimeoutMs: 20,
  });

  const startedAt = Date.now();
  await assert.rejects(service.get(), assertFixedAvailabilityError);
  const elapsedMs = Date.now() - startedAt;
  assert.equal(observedSignal?.aborted, true);
  assert.ok(elapsedMs < 250, `client promise remained pending for ${elapsedMs}ms`);
  assert.equal(service.status().refreshing, false);
  assert.equal(service.status().state, HOME_DASHBOARD_STATES.UNAVAILABLE);
});

test('seed never overwrites an accepted last-known-good, including after invalidation', () => {
  let nowMs = 5_000;
  const first = { kpis: { totalLeads: 1 } };
  const second = { kpis: { totalLeads: 2 } };
  const service = createHomeDashboardService({ compute: async () => second, now: () => nowMs });

  assert.equal(service.seed(first, { storedAt: 4_000 }), true);
  assert.equal(service.seed(second, { storedAt: 4_500 }), false);
  assert.strictEqual(service.get(), first);
  service.invalidate();
  nowMs = 6_000;
  assert.equal(service.seed(second, { storedAt: 5_500 }), false);
  assert.strictEqual(service.get(), first);
});

test('service has no network/provider dependency and public status is a fixed allowlist', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'home-dashboard-service.js'), 'utf8');
  assert.doesNotMatch(source, /require\(['"](?:node:)?https?['"]\)|\bfetch\s*\(|axios|cloudagent|zohoapis|pickyassist/i);

  const service = createHomeDashboardService({ compute: async () => ({}) });
  assert.deepEqual(Object.keys(service.status()).sort(), [
    'compute_timeout_ms',
    'fresh_ttl_ms',
    'generation',
    'has_last_known_good',
    'last_failure_at',
    'last_success_at',
    'refreshing',
    'state',
  ]);
  assert.ok(Object.values(HOME_DASHBOARD_STATES).includes(service.status().state));
});
