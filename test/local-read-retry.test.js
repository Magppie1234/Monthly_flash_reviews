'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  LOCAL_READ_MAX_ATTEMPTS,
  executeBoundedLocalRead,
  isRetryableBoundedAttemptTimeout,
  isRetryableStatementTimeout,
} = require('../lib/local-read-retry');

function statementTimeout() {
  const error = new Error('canceling statement due to statement timeout');
  error.dbCode = '57014';
  return error;
}

test('bounded local read retries exactly one classified statement timeout', async () => {
  let calls = 0;
  const execution = await executeBoundedLocalRead({
    statement: 'select count(*) from crm_records',
    readOnlyQuery: async (_statement, { signal }) => {
      calls++;
      assert.equal(signal.aborted, false);
      if (calls === 1) throw statementTimeout();
      return [{ count: 3 }];
    },
  });
  assert.deepEqual(execution, { result: [{ count: 3 }], attempts: 2 });
  assert.equal(calls, LOCAL_READ_MAX_ATTEMPTS);
  assert.equal(isRetryableStatementTimeout(statementTimeout()), true);
});

test('bounded local read never retries generic errors or attempts a third statement', async () => {
  let genericCalls = 0;
  await assert.rejects(() => executeBoundedLocalRead({
    statement: 'select 1',
    readOnlyQuery: async () => {
      genericCalls++;
      throw new Error('upstream unavailable');
    },
  }), /upstream unavailable/);
  assert.equal(genericCalls, 1);

  let timeoutCalls = 0;
  await assert.rejects(() => executeBoundedLocalRead({
    statement: 'with bounded as (select 1) select * from bounded',
    readOnlyQuery: async () => {
      timeoutCalls++;
      throw statementTimeout();
    },
  }), /statement timeout/);
  assert.equal(timeoutCalls, 2);
  assert.equal(isRetryableStatementTimeout(new Error('statement timeout')), false);
});

test('bounded local read retries only its own exact client timeout and never a caller abort', async () => {
  let boundedCalls = 0;
  const execution = await executeBoundedLocalRead({
    statement: 'select count(*) from crm_records',
    attemptTimeoutMs: 5,
    readOnlyQuery: async (_statement, { signal }) => {
      boundedCalls++;
      if (boundedCalls === 1) {
        await new Promise((resolve, reject) => {
          if (signal.aborted) return reject(signal.reason);
          const keepAlive = setTimeout(() => reject(new Error('Bounded signal did not abort.')), 100);
          signal.addEventListener('abort', () => {
            clearTimeout(keepAlive);
            reject(signal.reason);
          }, { once: true });
        });
      }
      return [{ count: 3 }];
    },
  });
  assert.deepEqual(execution, { result: [{ count: 3 }], attempts: 2 });
  assert.equal(boundedCalls, 2);

  let arbitraryTimeoutCalls = 0;
  await assert.rejects(() => executeBoundedLocalRead({
    statement: 'select 1',
    readOnlyQuery: async () => {
      arbitraryTimeoutCalls++;
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    },
  }), { name: 'TimeoutError' });
  assert.equal(arbitraryTimeoutCalls, 1);
  assert.equal(isRetryableBoundedAttemptTimeout(
    new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
    { timeoutSignal: { aborted: false } },
  ), false);

  const caller = new AbortController();
  caller.abort(new DOMException('Caller cancelled the request', 'AbortError'));
  let callerAbortCalls = 0;
  await assert.rejects(() => executeBoundedLocalRead({
    statement: 'select 1',
    abortSignal: caller.signal,
    readOnlyQuery: async (_statement, { signal }) => {
      callerAbortCalls++;
      throw signal.reason;
    },
  }), { name: 'AbortError' });
  assert.equal(callerAbortCalls, 1);
});

test('bounded local read rejects writes, excessive attempts, and invalid abort signals before querying', async () => {
  let calls = 0;
  const readOnlyQuery = async () => { calls++; };
  await assert.rejects(() => executeBoundedLocalRead({ statement: 'delete from crm_records', readOnlyQuery }), /read-only SELECT or WITH/);
  await assert.rejects(() => executeBoundedLocalRead({ statement: 'select 1', readOnlyQuery, maxAttempts: 3 }), /reviewed bound/);
  await assert.rejects(() => executeBoundedLocalRead({ statement: 'select 1', readOnlyQuery, abortSignal: true }), /abortSignal/);
  assert.equal(calls, 0);
});

test('Data Completeness uses the bounded read retry without adding a write or source request path', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'server.js'), 'utf8');
  const computeStart = source.indexOf('async function computeDataCompleteness(');
  const computeEnd = source.indexOf('\ndataCompletenessCache = createDataCompletenessCache(', computeStart);
  const computation = source.slice(computeStart, computeEnd);
  const routeStart = source.indexOf("app.get('/api/meta/data_completeness'");
  const routeEnd = source.indexOf("app.get('/api/meta/custom_buttons'", routeStart);
  const route = source.slice(routeStart, routeEnd);

  assert.ok(computeStart >= 0 && computeEnd > computeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart);
  assert.match(source, /const \{ executeBoundedLocalRead \} = require\('\.\/lib\/local-read-retry'\)/);
  assert.match(computation, /const completenessStatement = `with record_sets as/);
  assert.match(computation, /executeBoundedLocalRead\(\{\s*readOnlyQuery: sql,\s*statement: completenessStatement,\s*abortSignal: signal/);
  assert.doesNotMatch(computation, /\b(?:zoho|rpc|insert|update|delete|upsert)\s*\(/i);
  assert.match(route, /dataCompletenessCache\.get\(\{\s*generation: derivedReadCacheGeneration/);
});
