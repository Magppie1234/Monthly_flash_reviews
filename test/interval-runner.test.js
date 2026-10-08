'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createIntervalRunner } = require('../lib/interval-runner');

test('interval runner rejects overlapping executions without invoking the job twice', async () => {
  let release;
  let calls = 0;
  const runner = createIntervalRunner({
    intervalMs: 15 * 60 * 1000,
    run: async () => {
      calls += 1;
      await new Promise(resolve => { release = resolve; });
      return { ok: true };
    },
  });

  const first = runner.trigger({ reason: 'manual' });
  await new Promise(resolve => setImmediate(resolve));
  const overlap = await runner.trigger({ reason: 'scheduled' });
  assert.equal(overlap.accepted, false);
  assert.equal(overlap.reason, 'already_running');
  assert.equal(calls, 1);

  release();
  const completed = await first;
  assert.equal(completed.accepted, true);
  assert.deepEqual(completed.result, { ok: true });
  assert.equal(runner.status().running, false);
});

test('interval runner schedules the first source refresh exactly one interval after start', async () => {
  const epoch = Date.parse('2026-08-30T06:00:00.000Z');
  let callback;
  let unrefCalled = false;
  let runReason = null;
  const timer = { unref: () => { unrefCalled = true; } };
  const runner = createIntervalRunner({
    intervalMs: 15 * 60 * 1000,
    now: () => epoch,
    setIntervalImpl: (fn, delay) => {
      assert.equal(delay, 15 * 60 * 1000);
      callback = fn;
      return timer;
    },
    clearIntervalImpl: value => assert.equal(value, timer),
    run: async ({ reason }) => { runReason = reason; return { refreshed: true }; },
  });

  const initial = runner.start();
  assert.equal(initial.started, true);
  assert.equal(initial.interval_minutes, 15);
  assert.equal(initial.next_run_at, '2026-08-30T06:15:00.000Z');
  assert.equal(unrefCalled, true);

  callback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(runReason, 'scheduled');
  assert.equal(runner.status().last_succeeded_at, '2026-08-30T06:00:00.000Z');
  assert.equal(runner.stop().started, false);
});

test('interval runner records a bounded failure without leaking stack details', async () => {
  const runner = createIntervalRunner({
    intervalMs: 15 * 60 * 1000,
    run: async () => { throw new Error('source unavailable\nprivate stack must not appear'); },
  });

  await assert.rejects(() => runner.trigger({ reason: 'scheduled' }), /source unavailable/);
  const current = runner.status();
  assert.equal(current.running, false);
  assert.equal(current.last_error, 'source unavailable private stack must not appear');
});
