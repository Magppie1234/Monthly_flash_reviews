'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  MAX_DATA_COMPLETENESS_CACHE_TTL_MS,
  createDataCompletenessCache,
} = require('../lib/data-completeness-cache');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

test('coalesces concurrent loads and preserves the original observation timestamps on fresh hits', async () => {
  let loads = 0;
  let now = 1_000;
  const pending = deferred();
  const observedAt = '2026-08-31T08:15:30.000Z';
  const response = {
    notes: { current_observed_at: observedAt },
    task_subforms: { datasets: [{ current_observed_at: observedAt }] },
  };
  const cache = createDataCompletenessCache({
    freshTtlMs: 30_000,
    now: () => now,
    load: async () => {
      loads += 1;
      return pending.promise;
    },
  });

  const callers = Array.from({ length: 12 }, () => cache.get({ generation: 0 }));
  pending.resolve(response);
  const results = await Promise.all(callers);

  assert.equal(loads, 1);
  assert.ok(results.every(result => result === response));
  now += 29_999;
  assert.equal(await cache.get({ generation: 0 }), response);
  assert.equal(loads, 1);
  assert.equal(response.notes.current_observed_at, observedAt);
  assert.equal(response.task_subforms.datasets[0].current_observed_at, observedAt);
});

test('blocks on expiry, coalesces the refresh, and never falls back to an expired success after failure', async () => {
  let loads = 0;
  let now = 10_000;
  const refresh = deferred();
  const first = { notes: { current_observed_at: '2026-08-31T08:00:00.000Z' } };
  const third = { notes: { current_observed_at: '2026-08-31T08:00:02.000Z' } };
  const failure = new Error('database unavailable');
  const cache = createDataCompletenessCache({
    freshTtlMs: 1_000,
    now: () => now,
    load: () => {
      loads += 1;
      if (loads === 1) return first;
      if (loads === 2) return refresh.promise;
      return third;
    },
  });

  assert.equal(await cache.get({ generation: 0 }), first);
  now += 1_000;
  const firstExpiredCaller = cache.get({ generation: 0 });
  const secondExpiredCaller = cache.get({ generation: 0 });
  assert.equal(loads, 1, 'The shared refresh begins in the next microtask.');
  refresh.reject(failure);
  await assert.rejects(firstExpiredCaller, error => error === failure);
  await assert.rejects(secondExpiredCaller, error => error === failure);
  assert.equal(loads, 2);

  assert.equal(await cache.get({ generation: 0 }), third);
  assert.equal(loads, 3, 'A failed refresh must not promote or serve the expired response.');
});

test('invalidation aborts the old generation and prevents an abort-ignoring load from publishing', async () => {
  let loads = 0;
  let oldSignal;
  const oldLoad = deferred();
  const oldResponse = { notes: { current_observed_at: '2026-08-31T08:00:00.000Z' } };
  const newResponse = { notes: { current_observed_at: '2026-08-31T08:01:00.000Z' } };
  const cache = createDataCompletenessCache({
    freshTtlMs: 30_000,
    load: ({ signal }) => {
      loads += 1;
      if (loads === 1) {
        oldSignal = signal;
        return oldLoad.promise;
      }
      return newResponse;
    },
  });

  const staleCaller = cache.get({ generation: 0 });
  await Promise.resolve();
  cache.invalidate();

  assert.equal(oldSignal.aborted, true);
  await assert.rejects(staleCaller, error => error?.code === 'DATA_COMPLETENESS_READ_INVALIDATED');
  assert.equal(await cache.get({ generation: 1 }), newResponse);
  oldLoad.resolve(oldResponse);
  await Promise.resolve();
  assert.equal(await cache.get({ generation: 1 }), newResponse);
  assert.equal(loads, 2);
});

test('rejects unbounded configuration, invalid generations, and non-object loader results', async () => {
  assert.throws(
    () => createDataCompletenessCache({ load: async () => ({}), freshTtlMs: MAX_DATA_COMPLETENESS_CACHE_TTL_MS + 1 }),
    /freshTtlMs/,
  );
  const cache = createDataCompletenessCache({ load: async () => [] });
  assert.throws(() => cache.get({ generation: -1 }), /generation/);
  await assert.rejects(cache.get({ generation: 0 }), /must return an object/);
});

test('server caches only sanitized local-read responses and uses the derived-read invalidation generation', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const computeStart = source.indexOf('async function computeDataCompleteness(');
  const computeEnd = source.indexOf('\ndataCompletenessCache = createDataCompletenessCache(', computeStart);
  const computation = source.slice(computeStart, computeEnd);
  const invalidationStart = source.indexOf('function invalidateDerivedReadCaches(');
  const invalidationEnd = source.indexOf('\nasync function cachedAnalyticsOverview(', invalidationStart);
  const invalidation = source.slice(invalidationStart, invalidationEnd);
  const routeStart = source.indexOf("app.get('/api/meta/data_completeness'");
  const routeEnd = source.indexOf("app.get('/api/meta/custom_buttons'", routeStart);
  const route = source.slice(routeStart, routeEnd);

  assert.ok(computeStart >= 0 && computeEnd > computeStart);
  assert.match(computation, /executeBoundedLocalRead\(\{[\s\S]*abortSignal: signal/);
  assert.match(computation, /assertSafeCompletenessOutput\(response\);\s*return response;/);
  assert.ok(
    computation.indexOf('assertSafeCompletenessOutput(response);') < computation.indexOf('return response;'),
    'The response must pass the existing sanitizer before it can enter the cache.',
  );
  assert.match(invalidation, /derivedReadCacheGeneration \+= 1;[\s\S]*dataCompletenessCache\.invalidate\(\)/);
  assert.match(route, /wrap\(res, async \(\) => dataCompletenessCache\.get/);
  assert.match(route, /dataCompletenessCache\.get\(\{\s*generation: derivedReadCacheGeneration/);
});
