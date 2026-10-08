'use strict';

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`${label} must be a positive integer.`);
  return value;
}

function createKeyedTaskQueue({ concurrency = 1, maxQueued = 250 } = {}) {
  const limit = positiveInteger(concurrency, 'concurrency');
  const queueLimit = positiveInteger(maxQueued, 'maxQueued');
  const pending = new Map();
  const queue = [];
  let active = 0;

  function pump() {
    while (active < limit && queue.length) {
      const item = queue.shift();
      active += 1;
      Promise.resolve()
        .then(item.task)
        .then(value => {
          active -= 1;
          pending.delete(item.key);
          pump();
          item.resolve(value);
        }, error => {
          active -= 1;
          pending.delete(item.key);
          pump();
          item.reject(error);
        });
    }
  }

  function run(key, task) {
    const normalizedKey = String(key || '');
    if (!normalizedKey) return Promise.reject(new TypeError('Task key is required.'));
    if (typeof task !== 'function') return Promise.reject(new TypeError('Task must be a function.'));
    if (pending.has(normalizedKey)) return pending.get(normalizedKey);
    if (queue.length >= queueLimit) {
      const error = new Error('Background task queue is full.');
      error.code = 'BACKGROUND_TASK_QUEUE_FULL';
      return Promise.reject(error);
    }

    let resolve;
    let reject;
    const promise = new Promise((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    });
    pending.set(normalizedKey, promise);
    queue.push({ key: normalizedKey, task, resolve, reject });
    pump();
    return promise;
  }

  function status() {
    return { active, queued: queue.length, pending: pending.size, concurrency: limit, max_queued: queueLimit };
  }

  return { run, status };
}

module.exports = { createKeyedTaskQueue };
