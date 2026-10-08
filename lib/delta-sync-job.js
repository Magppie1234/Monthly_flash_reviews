'use strict';

const DEFAULT_DELTA_SYNC_SOURCE_DEADLINE_MS = 35_000;
const DEFAULT_DELTA_SYNC_HARD_DEADLINE_MS = 55_000;

function deltaSyncJobError(code, message, cause) {
  const error = new Error(message, cause === undefined ? undefined : { cause });
  error.code = code;
  return error;
}

function createBoundedDeltaSyncJob({
  createLeaseClient,
  runSync,
  sourceDeadlineMs = DEFAULT_DELTA_SYNC_SOURCE_DEADLINE_MS,
  hardDeadlineMs = DEFAULT_DELTA_SYNC_HARD_DEADLINE_MS,
  AbortControllerImpl = AbortController,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
} = {}) {
  if (typeof createLeaseClient !== 'function') throw new TypeError('createLeaseClient must be a function.');
  if (typeof runSync !== 'function') throw new TypeError('runSync must be a function.');
  if (!Number.isSafeInteger(sourceDeadlineMs) || sourceDeadlineMs < 1_000) {
    throw new TypeError('sourceDeadlineMs must be an integer of at least 1000.');
  }
  if (!Number.isSafeInteger(hardDeadlineMs)
      || hardDeadlineMs > 59_000
      || hardDeadlineMs - sourceDeadlineMs < 5_000) {
    throw new TypeError('hardDeadlineMs must be at least 5000ms after sourceDeadlineMs and no more than 59000.');
  }
  if (typeof AbortControllerImpl !== 'function') throw new TypeError('AbortControllerImpl must be a function.');
  if (typeof setTimeoutImpl !== 'function' || typeof clearTimeoutImpl !== 'function') {
    throw new TypeError('Timer implementations must be functions.');
  }

  return async function runBoundedDeltaSyncJob() {
    const sourceController = new AbortControllerImpl();
    const hardController = new AbortControllerImpl();
    const sourceDeadline = setTimeoutImpl(() => sourceController.abort(), sourceDeadlineMs);
    const hardDeadline = setTimeoutImpl(() => {
      hardController.abort();
      sourceController.abort();
    }, hardDeadlineMs);
    if (sourceDeadline && typeof sourceDeadline.unref === 'function') sourceDeadline.unref();
    if (hardDeadline && typeof hardDeadline.unref === 'function') hardDeadline.unref();

    try {
      const leaseClient = createLeaseClient({ signal: hardController.signal });
      if (!leaseClient || typeof leaseClient.runExclusive !== 'function') {
        throw new TypeError('createLeaseClient must return a lease client.');
      }
      const leased = await leaseClient.runExclusive(async ({ stateStore, assertHeld }) => {
        if (typeof assertHeld !== 'function') throw new TypeError('The lease session must expose assertHeld.');
        const run = await runSync({ stateStore, signal: sourceController.signal });
        assertHeld();
        return run;
      });

      if (hardController.signal.aborted) {
        throw deltaSyncJobError(
          'DELTA_SYNC_DEADLINE_EXCEEDED',
          'The bounded delta refresh deadline was exceeded.',
        );
      }
      if (!leased?.acquired) {
        throw deltaSyncJobError('DELTA_SYNC_ALREADY_RUNNING', 'A delta refresh is already active.');
      }
      if (leased.result?.global_success !== true) {
        throw deltaSyncJobError(
          'DELTA_SYNC_INCOMPLETE',
          'Delta refresh completed with partial or failed module results.',
        );
      }
      return leased.result;
    } catch (cause) {
      if (hardController.signal.aborted && cause?.code !== 'DELTA_SYNC_DEADLINE_EXCEEDED') {
        throw deltaSyncJobError(
          'DELTA_SYNC_DEADLINE_EXCEEDED',
          'The bounded delta refresh deadline was exceeded.',
          cause,
        );
      }
      throw cause;
    } finally {
      clearTimeoutImpl(sourceDeadline);
      clearTimeoutImpl(hardDeadline);
    }
  };
}

module.exports = {
  DEFAULT_DELTA_SYNC_SOURCE_DEADLINE_MS,
  DEFAULT_DELTA_SYNC_HARD_DEADLINE_MS,
  createBoundedDeltaSyncJob,
};
