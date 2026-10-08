'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ANALYTICS_KEY_PATTERN,
  DEFAULT_MAX_QUEUED_COLD_READS,
  createColdReadCoordinator,
} = require('../lib/cold-read-coordinator');

function deferred() {
  let resolve;
  const promise = new Promise(onResolve => { resolve = onResolve; });
  return { promise, resolve };
}

const nextTurn = () => new Promise(resolve => setImmediate(resolve));

test('cold-read coordinator serializes Analytics and assistant scope while same Analytics callers coalesce', async () => {
  const coordinator = createColdReadCoordinator();
  const analyticsGate = deferred();
  const events = [];
  let active = 0;
  let maxActive = 0;
  let analyticsCalls = 0;

  const analytics = coordinator.runAnalytics('0:2026-08-01|2026-08-30', async () => {
    analyticsCalls += 1;
    active += 1;
    maxActive = Math.max(maxActive, active);
    events.push('analytics:start');
    await analyticsGate.promise;
    events.push('analytics:end');
    active -= 1;
    return { aggregate_only: true };
  });
  const duplicate = coordinator.runAnalytics('0:2026-08-01|2026-08-30', async () => {
    analyticsCalls += 1;
    throw new Error('duplicate Analytics task must not execute');
  });
  const assistant = coordinator.runAssistantScope(0, async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    events.push('assistant:start');
    await nextTurn();
    events.push('assistant:end');
    active -= 1;
    return { module_count: 41 };
  });

  assert.equal(duplicate, analytics);
  await nextTurn();
  assert.deepEqual(events, ['analytics:start']);
  assert.deepEqual(coordinator.status(), {
    active: 1, queued: 1, pending: 2, concurrency: 1, max_queued: DEFAULT_MAX_QUEUED_COLD_READS,
  });

  analyticsGate.resolve();
  assert.deepEqual(await analytics, { aggregate_only: true });
  assert.deepEqual(await duplicate, { aggregate_only: true });
  assert.deepEqual(await assistant, { module_count: 41 });
  assert.equal(analyticsCalls, 1);
  assert.equal(maxActive, 1);
  assert.deepEqual(events, ['analytics:start', 'analytics:end', 'assistant:start', 'assistant:end']);
  assert.deepEqual(coordinator.status(), {
    active: 0, queued: 0, pending: 0, concurrency: 1, max_queued: DEFAULT_MAX_QUEUED_COLD_READS,
  });
});

test('cold-read coordinator releases a failed Analytics task so assistant and retry can complete', async () => {
  const coordinator = createColdReadCoordinator({ maxQueued: 3 });
  const expected = new Error('expected cold Analytics failure');
  const failed = coordinator.runAnalytics('7:2026-08-01|2026-08-30', async () => { throw expected; });
  const assistant = coordinator.runAssistantScope(7, async () => ({ module_count: 41 }));

  await assert.rejects(failed, error => error === expected);
  assert.deepEqual(await assistant, { module_count: 41 });
  assert.equal(
    await coordinator.runAnalytics('7:2026-08-01|2026-08-30', async () => 'recovered'),
    'recovered',
  );
  assert.deepEqual(coordinator.status(), {
    active: 0, queued: 0, pending: 0, concurrency: 1, max_queued: 3,
  });
});

test('cold-read coordinator rejects unbounded or non-canonical Analytics keys', async () => {
  assert.match('12:2026-08-01|2026-08-30', ANALYTICS_KEY_PATTERN);
  const coordinator = createColdReadCoordinator();
  await assert.rejects(coordinator.runAnalytics('', async () => null), /canonical date range/);
  await assert.rejects(coordinator.runAnalytics('0:2026-08-01|2026-08-30:private', async () => null), /canonical date range/);
  await assert.rejects(coordinator.runAnalytics('0:2026-08-01|2026-08-30', null), /must be a function/);
  await assert.rejects(coordinator.runAssistantScope(-1, async () => null), /non-negative safe integer/);
  await assert.rejects(coordinator.runAssistantScope(0, null), /must be a function/);
});
