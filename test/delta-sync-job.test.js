'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBoundedDeltaSyncJob } = require('../lib/delta-sync-job');

test('the hard abort signal bounds lease acquisition and becomes a sanitized deadline error', async () => {
  let leaseSignal = null;
  let timerIndex = 0;
  const runJob = createBoundedDeltaSyncJob({
    sourceDeadlineMs: 1_000,
    hardDeadlineMs: 6_000,
    setTimeoutImpl: callback => {
      timerIndex += 1;
      if (timerIndex === 2) queueMicrotask(callback);
      return { unref() {} };
    },
    clearTimeoutImpl() {},
    createLeaseClient: ({ signal }) => {
      leaseSignal = signal;
      return {
        runExclusive: () => new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('private database timeout detail')), { once: true });
        }),
      };
    },
    runSync: async () => {
      throw new Error('source work must not start before lease acquisition');
    },
  });

  await assert.rejects(
    () => runJob(),
    error => error.code === 'DELTA_SYNC_DEADLINE_EXCEEDED'
      && !error.message.includes('private database timeout detail'),
  );
  assert.equal(leaseSignal?.aborted, true);
});

test('the same signal covers fenced source work and is cleared after exact success', async () => {
  let leaseSignal = null;
  let workSignal = null;
  let heldChecks = 0;
  let clears = 0;
  const stateStore = Object.freeze({ load: async () => null, save: async () => {} });
  const expected = Object.freeze({ global_success: true });
  const runJob = createBoundedDeltaSyncJob({
    sourceDeadlineMs: 1_000,
    hardDeadlineMs: 6_000,
    setTimeoutImpl: () => ({ unref() {} }),
    clearTimeoutImpl: () => { clears += 1; },
    createLeaseClient: ({ signal }) => {
      leaseSignal = signal;
      return {
        runExclusive: async work => ({
          acquired: true,
          result: await work({ stateStore, assertHeld: () => { heldChecks += 1; } }),
        }),
      };
    },
    runSync: async options => {
      workSignal = options.signal;
      assert.equal(options.stateStore, stateStore);
      return expected;
    },
  });

  assert.equal(await runJob(), expected);
  assert.notEqual(workSignal, leaseSignal);
  assert.equal(workSignal.aborted, false);
  assert.equal(leaseSignal.aborted, false);
  assert.equal(heldChecks, 1);
  assert.equal(clears, 2);
});

test('a soft source cutoff preserves the hard lease signal for checkpoint and release', async () => {
  let timerIndex = 0;
  let hardSignal = null;
  let sourceSignal = null;
  let checkpointed = false;
  let released = false;
  const runJob = createBoundedDeltaSyncJob({
    sourceDeadlineMs: 1_000,
    hardDeadlineMs: 6_000,
    setTimeoutImpl: callback => {
      timerIndex += 1;
      if (timerIndex === 1) queueMicrotask(callback);
      return { unref() {} };
    },
    clearTimeoutImpl() {},
    createLeaseClient: ({ signal }) => {
      hardSignal = signal;
      return {
        runExclusive: async work => {
          const result = await work({
            stateStore: {
              load: async () => null,
              save: async () => { checkpointed = !signal.aborted; },
            },
            assertHeld() {},
          });
          released = !signal.aborted;
          return { acquired: true, result };
        },
      };
    },
    runSync: async ({ stateStore, signal }) => {
      sourceSignal = signal;
      await new Promise(resolve => {
        if (signal.aborted) resolve();
        else signal.addEventListener('abort', resolve, { once: true });
      });
      await stateStore.save({ schema_version: 2 });
      return { global_success: false };
    },
  });

  await assert.rejects(() => runJob(), error => error.code === 'DELTA_SYNC_INCOMPLETE');
  assert.equal(sourceSignal.aborted, true);
  assert.equal(hardSignal.aborted, false);
  assert.equal(checkpointed, true);
  assert.equal(released, true);
});

test('overlap and incomplete results retain distinct bounded contracts', async () => {
  for (const [leased, code] of [
    [{ acquired: false, reason: 'already_running' }, 'DELTA_SYNC_ALREADY_RUNNING'],
    [{ acquired: true, result: { global_success: false } }, 'DELTA_SYNC_INCOMPLETE'],
  ]) {
    const runJob = createBoundedDeltaSyncJob({
      sourceDeadlineMs: 1_000,
      hardDeadlineMs: 6_000,
      createLeaseClient: () => ({ runExclusive: async () => leased }),
      runSync: async () => ({ global_success: true }),
    });
    await assert.rejects(() => runJob(), error => error.code === code);
  }
});
