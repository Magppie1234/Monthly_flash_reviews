'use strict';

const DEFAULT_FRESH_TTL_MS = 60_000;
const DEFAULT_COMPUTE_TIMEOUT_MS = 8_000;
const MAX_COMPUTE_TIMEOUT_MS = 120_000;

const HOME_DASHBOARD_STATES = Object.freeze({
  COLD: 'cold',
  REFRESHING: 'refreshing',
  FRESH: 'fresh',
  STALE: 'stale',
  STALE_REFRESHING: 'stale_refreshing',
  UNAVAILABLE: 'unavailable',
});

const PUBLIC_ERROR = Object.freeze({
  status: 503,
  code: 'HOME_DASHBOARD_UNAVAILABLE',
  message: 'Home dashboard is temporarily unavailable. Existing CRM records were not changed.',
});

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function computeTimeout(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_COMPUTE_TIMEOUT_MS) {
    throw new TypeError(`computeTimeoutMs must be an integer from 1 to ${MAX_COMPUTE_TIMEOUT_MS}.`);
  }
  return value;
}

function dashboardPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('The local dashboard computation must return an object.');
  }
  return value;
}

function availabilityError() {
  const error = new Error(PUBLIC_ERROR.message);
  error.status = PUBLIC_ERROR.status;
  error.code = PUBLIC_ERROR.code;
  return error;
}

/**
 * Resilience boundary for the already-local dashboard computation.
 *
 * The service deliberately accepts no URL, credentials, HTTP client, or
 * provider adapter. `compute` is the existing local replica calculation and
 * receives only an AbortSignal plus the private cache generation.
 */
function createHomeDashboardService({
  compute,
  freshTtlMs = DEFAULT_FRESH_TTL_MS,
  computeTimeoutMs = DEFAULT_COMPUTE_TIMEOUT_MS,
  now = () => Date.now(),
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  AbortControllerImpl = globalThis.AbortController,
} = {}) {
  if (typeof compute !== 'function') throw new TypeError('compute must be a function.');
  const freshFor = nonNegativeInteger(freshTtlMs, 'freshTtlMs');
  const deadline = computeTimeout(computeTimeoutMs);
  if (typeof now !== 'function') throw new TypeError('now must be a function.');
  if (typeof setTimeoutImpl !== 'function' || typeof clearTimeoutImpl !== 'function') {
    throw new TypeError('Timer implementations must be functions.');
  }
  if (typeof AbortControllerImpl !== 'function') throw new TypeError('AbortControllerImpl must be a constructor.');

  let generation = 0;
  let lastKnownGood = null;
  let inFlight = null;
  let lastAttemptFailed = false;
  let lastFailureAt = null;
  let lastSuccessAt = null;

  function clock() {
    const value = now();
    if (!Number.isFinite(value) || value < 0) throw new TypeError('now must return a non-negative finite timestamp.');
    return Math.trunc(value);
  }

  function iso(timestamp) {
    return timestamp === null ? null : new Date(timestamp).toISOString();
  }

  function currentCache() {
    return lastKnownGood?.generation === generation ? lastKnownGood : null;
  }

  function isFresh(cache, observedAt = clock()) {
    return Boolean(cache)
      && cache.invalidated !== true
      && Math.max(0, observedAt - cache.storedAt) < freshFor;
  }

  function boundedComputation(flightGeneration) {
    const controller = new AbortControllerImpl();
    let timer = null;
    let settled = false;
    let settleResolve;
    let settleReject;

    const promise = new Promise((resolve, reject) => {
      settleResolve = resolve;
      settleReject = reject;
    });

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeoutImpl(timer);
      callback(value);
    };

    const cancel = () => {
      if (settled) return;
      try { controller.abort(); } catch { /* abort is best-effort */ }
      finish(settleReject, availabilityError());
    };

    timer = setTimeoutImpl(cancel, deadline);
    Promise.resolve()
      .then(() => compute({ signal: controller.signal, generation: flightGeneration }))
      .then(
        value => {
          let payload;
          try {
            payload = dashboardPayload(value);
          } catch {
            finish(settleReject, availabilityError());
            return;
          }
          finish(settleResolve, payload);
        },
        () => finish(settleReject, availabilityError()),
      );

    return { promise, cancel, controller };
  }

  function startRefresh() {
    if (inFlight?.generation === generation) return inFlight.promise;

    const flightGeneration = generation;
    const bounded = boundedComputation(flightGeneration);
    const flight = {
      generation: flightGeneration,
      cancel: bounded.cancel,
      controller: bounded.controller,
      promise: null,
    };

    flight.promise = bounded.promise.then(value => {
      if (generation !== flightGeneration) throw availabilityError();
      const completedAt = clock();
      lastKnownGood = {
        data: value,
        storedAt: completedAt,
        generation: flightGeneration,
        invalidated: false,
      };
      lastSuccessAt = completedAt;
      lastAttemptFailed = false;
      return value;
    }, () => {
      if (generation === flightGeneration) {
        lastAttemptFailed = true;
        lastFailureAt = clock();
      }
      throw availabilityError();
    }).finally(() => {
      if (inFlight === flight) inFlight = null;
    });

    inFlight = flight;
    return flight.promise;
  }

  /**
   * Fresh and stale last-known-good hits are intentionally synchronous.
   * A stale hit starts one bounded refresh and remains immediately usable.
   * Only a truly cold read returns the shared refresh Promise.
   */
  function get({ force = false } = {}) {
    if (force) return startRefresh();
    const cache = currentCache();
    if (isFresh(cache)) return cache.data;
    if (cache) {
      startRefresh().catch(() => {});
      return cache.data;
    }
    return startRefresh();
  }

  function refresh() {
    return startRefresh();
  }

  /**
   * Seeds a verified local/persisted last-known-good value before first use.
   * It never overwrites a value already accepted in the current generation.
   */
  function seed(data, { storedAt = clock() } = {}) {
    if (currentCache()) return false;
    const value = dashboardPayload(data);
    const observedAt = clock();
    const normalizedAt = nonNegativeInteger(storedAt, 'storedAt');
    const acceptedAt = Math.min(normalizedAt, observedAt);
    lastKnownGood = {
      data: value,
      storedAt: acceptedAt,
      generation,
      invalidated: false,
    };
    lastSuccessAt = acceptedAt;
    lastAttemptFailed = false;
    return true;
  }

  /**
   * Invalidating advances the generation before cancelling the old flight.
   * A computation that ignores AbortSignal therefore still cannot publish.
   */
  function invalidate({ dropLastKnownGood = false } = {}) {
    const previous = dropLastKnownGood ? null : currentCache();
    generation += 1;
    lastKnownGood = previous
      ? {
        data: previous.data,
        storedAt: previous.storedAt,
        generation,
        invalidated: true,
      }
      : null;
    lastAttemptFailed = false;
    lastFailureAt = null;
    if (!previous) lastSuccessAt = null;
    const staleFlight = inFlight;
    if (staleFlight) staleFlight.cancel();
    return status();
  }

  function status() {
    const observedAt = clock();
    const cache = currentCache();
    const refreshing = inFlight?.generation === generation;
    let state = HOME_DASHBOARD_STATES.COLD;
    if (cache) {
      if (isFresh(cache, observedAt)) state = HOME_DASHBOARD_STATES.FRESH;
      else state = refreshing ? HOME_DASHBOARD_STATES.STALE_REFRESHING : HOME_DASHBOARD_STATES.STALE;
    } else if (refreshing) {
      state = HOME_DASHBOARD_STATES.REFRESHING;
    } else if (lastAttemptFailed) {
      state = HOME_DASHBOARD_STATES.UNAVAILABLE;
    }
    return Object.freeze({
      state,
      has_last_known_good: Boolean(cache),
      refreshing: Boolean(refreshing),
      generation,
      fresh_ttl_ms: freshFor,
      compute_timeout_ms: deadline,
      last_success_at: iso(lastSuccessAt),
      last_failure_at: iso(lastFailureAt),
    });
  }

  return Object.freeze({ get, refresh, seed, invalidate, status });
}

module.exports = {
  DEFAULT_COMPUTE_TIMEOUT_MS,
  DEFAULT_FRESH_TTL_MS,
  HOME_DASHBOARD_STATES,
  createHomeDashboardService,
};
