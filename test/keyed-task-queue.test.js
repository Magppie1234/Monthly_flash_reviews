'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createKeyedTaskQueue } = require('../lib/keyed-task-queue');

function deferred() {
  let resolve;
  const promise = new Promise(onResolve => { resolve = onResolve; });
  return { promise, resolve };
}

const nextTurn = () => new Promise(resolve => setImmediate(resolve));

test('keyed task queue bounds concurrency and drains in order', async () => {
  const queue = createKeyedTaskQueue({ concurrency: 2, maxQueued: 4 });
  const gates = [deferred(), deferred(), deferred(), deferred()];
  const started = [];
  const runs = gates.map((gate, index) => queue.run(`task-${index}`, async () => {
    started.push(index);
    await gate.promise;
    return index;
  }));

  await Promise.resolve();
  assert.deepEqual(started, [0, 1]);
  assert.deepEqual(queue.status(), { active: 2, queued: 2, pending: 4, concurrency: 2, max_queued: 4 });

  gates[0].resolve();
  await runs[0];
  await nextTurn();
  assert.deepEqual(started, [0, 1, 2]);

  gates[1].resolve();
  gates[2].resolve();
  gates[3].resolve();
  assert.deepEqual(await Promise.all(runs), [0, 1, 2, 3]);
  assert.deepEqual(queue.status(), { active: 0, queued: 0, pending: 0, concurrency: 2, max_queued: 4 });
});

test('keyed task queue coalesces duplicate keys and rejects overflow', async () => {
  const queue = createKeyedTaskQueue({ concurrency: 1, maxQueued: 1 });
  const firstGate = deferred();
  let duplicateCalls = 0;
  const first = queue.run('same', async () => {
    duplicateCalls += 1;
    await firstGate.promise;
    return 'done';
  });
  const duplicate = queue.run('same', async () => {
    duplicateCalls += 1;
    return 'wrong';
  });
  assert.equal(duplicate, first);

  const queued = queue.run('second', async () => 'second');
  await assert.rejects(
    queue.run('third', async () => 'third'),
    error => error.code === 'BACKGROUND_TASK_QUEUE_FULL',
  );

  firstGate.resolve();
  assert.equal(await first, 'done');
  assert.equal(await queued, 'second');
  assert.equal(duplicateCalls, 1);
});

test('keyed task queue validates its bounds and clears failed keys', async () => {
  assert.throws(() => createKeyedTaskQueue({ concurrency: 0 }), /positive integer/);
  assert.throws(() => createKeyedTaskQueue({ maxQueued: 0 }), /positive integer/);

  const queue = createKeyedTaskQueue();
  await assert.rejects(queue.run('', () => null), /key is required/);
  await assert.rejects(queue.run('bad-task', null), /must be a function/);
  await assert.rejects(queue.run('retryable', async () => { throw new Error('expected'); }), /expected/);
  assert.equal(await queue.run('retryable', async () => 'recovered'), 'recovered');
  assert.deepEqual(queue.status(), { active: 0, queued: 0, pending: 0, concurrency: 1, max_queued: 250 });

  let completedRuns = 0;
  assert.equal(await queue.run('repeatable-success', async () => { completedRuns += 1; return completedRuns; }), 1);
  assert.equal(await queue.run('repeatable-success', async () => { completedRuns += 1; return completedRuns; }), 2);
});
