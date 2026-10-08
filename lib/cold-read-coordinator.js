'use strict';

const { createKeyedTaskQueue } = require('./keyed-task-queue');

const DEFAULT_MAX_QUEUED_COLD_READS = 16;
const ANALYTICS_KEY_PATTERN = /^[0-9]{1,12}:[0-9]{4}-[0-9]{2}-[0-9]{2}\|[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

function createColdReadCoordinator({ maxQueued = DEFAULT_MAX_QUEUED_COLD_READS } = {}) {
  const queue = createKeyedTaskQueue({ concurrency: 1, maxQueued });

  function runAnalytics(rangeKey, task) {
    const normalizedKey = String(rangeKey || '');
    if (!ANALYTICS_KEY_PATTERN.test(normalizedKey)) {
      return Promise.reject(new TypeError('Analytics cold-read key must contain only a generation and canonical date range.'));
    }
    return queue.run(`analytics:${normalizedKey}`, task);
  }

  function runAssistantScope(generation, task) {
    if (!Number.isSafeInteger(generation) || generation < 0) {
      return Promise.reject(new TypeError('Assistant scope generation must be a non-negative safe integer.'));
    }
    return queue.run(`assistant:permission-scope:${generation}`, task);
  }

  return Object.freeze({
    runAnalytics,
    runAssistantScope,
    status: queue.status,
  });
}

module.exports = {
  ANALYTICS_KEY_PATTERN,
  DEFAULT_MAX_QUEUED_COLD_READS,
  createColdReadCoordinator,
};
