'use strict';

const DEFAULT_DATA_COMPLETENESS_CACHE_TTL_MS = 30_000;
const MAX_DATA_COMPLETENESS_CACHE_TTL_MS = 5 * 60_000;

function cacheTtl(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_DATA_COMPLETENESS_CACHE_TTL_MS) {
    throw new TypeError(`freshTtlMs must be an integer from 1 to ${MAX_DATA_COMPLETENESS_CACHE_TTL_MS}.`);
  }
  return value;
}

function cacheGeneration(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('generation must be a non-negative safe integer.');
  }
  return value;
}

function responsePayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('The data-completeness loader must return an object.');
  }
  return value;
}

function invalidatedError() {
  const error = new Error('The data-completeness read was invalidated.');
  error.code = 'DATA_COMPLETENESS_READ_INVALIDATED';
  return error;
}

/**
 * One-entry, generation-aware cache for the local Data Completeness read.
 *
 * Expired values are never returned while refreshing. This keeps the existing
 * response shape intact: there is no unlabeled stale-success fallback, and the
 * observation timestamps inside a cached response remain the timestamps from
 * the database read that produced it.
 */
function createDataCompletenessCache({
  load,
  freshTtlMs = DEFAULT_DATA_COMPLETENESS_CACHE_TTL_MS,
  now = () => Date.now(),
  AbortControllerImpl = globalThis.AbortController,
} = {}) {
  if (typeof load !== 'function') throw new TypeError('load must be a function.');
  const freshFor = cacheTtl(freshTtlMs);
  if (typeof now !== 'function') throw new TypeError('now must be a function.');
  if (typeof AbortControllerImpl !== 'function') throw new TypeError('AbortControllerImpl must be a constructor.');

  let invalidationGeneration = 0;
  let cached = null;
  let inFlight = null;

  function clock() {
    const value = now();
    if (!Number.isFinite(value) || value < 0) {
      throw new TypeError('now must return a non-negative finite timestamp.');
    }
    return Math.trunc(value);
  }

  function cancelFlight(flight) {
    try { flight.controller.abort(); } catch { /* abort is best-effort */ }
    flight.rejectCancellation(invalidatedError());
  }

  function invalidate() {
    invalidationGeneration += 1;
    cached = null;
    const staleFlight = inFlight;
    inFlight = null;
    if (staleFlight) cancelFlight(staleFlight);
  }

  function start(generation) {
    if (inFlight?.generation === generation) return inFlight.promise;
    if (inFlight) invalidate();

    const controller = new AbortControllerImpl();
    const startedInvalidationGeneration = invalidationGeneration;
    let rejectCancellation;
    const cancellation = new Promise((resolve, reject) => { rejectCancellation = reject; });
    const loadPromise = Promise.resolve().then(() => load({
      signal: controller.signal,
      generation,
    }));
    const flight = {
      controller,
      generation,
      promise: null,
      rejectCancellation,
    };

    flight.promise = Promise.race([loadPromise, cancellation])
      .then(value => {
        if (startedInvalidationGeneration !== invalidationGeneration || inFlight !== flight) {
          throw invalidatedError();
        }
        const data = responsePayload(value);
        cached = { data, generation, storedAt: clock() };
        return data;
      })
      .finally(() => {
        if (inFlight === flight) inFlight = null;
      });
    inFlight = flight;
    return flight.promise;
  }

  function get({ generation } = {}) {
    const requestedGeneration = cacheGeneration(generation);
    const observedAt = clock();
    if (cached) {
      const age = Math.max(0, observedAt - cached.storedAt);
      if (cached.generation === requestedGeneration && age < freshFor) return cached.data;
      cached = null;
    }
    if (inFlight?.generation === requestedGeneration) return inFlight.promise;
    return start(requestedGeneration);
  }

  return Object.freeze({ get, invalidate });
}

module.exports = {
  DEFAULT_DATA_COMPLETENESS_CACHE_TTL_MS,
  MAX_DATA_COMPLETENESS_CACHE_TTL_MS,
  createDataCompletenessCache,
};
