'use strict';

const { randomUUID } = require('node:crypto');

const MIN_LEASE_TTL_SECONDS = 5;
const MAX_LEASE_TTL_SECONDS = 50;
const DEFAULT_LEASE_TTL_SECONDS = 45;
const DEFAULT_RENEW_INTERVAL_MS = 15_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RPC_NAMES = Object.freeze({
  acquire: 'crm_acquire_delta_sync_lease',
  renew: 'crm_renew_delta_sync_lease',
  save: 'crm_save_delta_sync_state',
  release: 'crm_release_delta_sync_lease',
  read: 'crm_read_delta_sync_state',
});

class DeltaSyncLeaseError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'DeltaSyncLeaseError';
    this.code = code;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneJson(value) {
  return value === null ? null : JSON.parse(JSON.stringify(value));
}

function safeRevision(value, label = 'State revision') {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DeltaSyncLeaseError('LEASE_RPC_INVALID_RESPONSE', `${label} is invalid.`);
  }
  return value;
}

function safeExpiry(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new DeltaSyncLeaseError('LEASE_RPC_INVALID_RESPONSE', 'Lease expiry is invalid.');
  }
  return new Date(value).toISOString();
}

function validateTtl(ttlSeconds) {
  if (!Number.isSafeInteger(ttlSeconds)
      || ttlSeconds < MIN_LEASE_TTL_SECONDS
      || ttlSeconds > MAX_LEASE_TTL_SECONDS) {
    throw new TypeError(`ttlSeconds must be an integer from ${MIN_LEASE_TTL_SECONDS} to ${MAX_LEASE_TTL_SECONDS}.`);
  }
  return ttlSeconds;
}

function validateRenewInterval(renewIntervalMs, ttlSeconds) {
  if (!Number.isSafeInteger(renewIntervalMs)
      || renewIntervalMs < 1_000
      || renewIntervalMs >= ttlSeconds * 1_000) {
    throw new TypeError('renewIntervalMs must be at least 1000 and shorter than the lease TTL.');
  }
  return renewIntervalMs;
}

function normalizeState(value) {
  if (value === null) return null;
  if (!isPlainObject(value)) {
    throw new DeltaSyncLeaseError('LEASE_RPC_INVALID_RESPONSE', 'Persisted delta-sync state is invalid.');
  }
  return cloneJson(value);
}

function createDeltaSyncLeaseClient({
  callRpc,
  generateOwnerId = randomUUID,
  ttlSeconds = DEFAULT_LEASE_TTL_SECONDS,
  renewIntervalMs = DEFAULT_RENEW_INTERVAL_MS,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
} = {}) {
  if (typeof callRpc !== 'function') throw new TypeError('callRpc must be a function.');
  if (typeof generateOwnerId !== 'function') throw new TypeError('generateOwnerId must be a function.');
  if (typeof setIntervalImpl !== 'function' || typeof clearIntervalImpl !== 'function') {
    throw new TypeError('Timer implementations must be functions.');
  }
  const resolvedTtl = validateTtl(ttlSeconds);
  const resolvedRenewInterval = validateRenewInterval(renewIntervalMs, resolvedTtl);

  async function invoke(name, body, failureCode, failureMessage) {
    try {
      return await callRpc(name, body);
    } catch (error) {
      throw new DeltaSyncLeaseError(failureCode, failureMessage, { cause: error });
    }
  }

  async function readState() {
    const response = await invoke(
      RPC_NAMES.read,
      {},
      'STATE_READ_FAILED',
      'Delta-sync state could not be read.',
    );
    if (!isPlainObject(response)
        || typeof response.lease_active !== 'boolean'
        || !Object.prototype.hasOwnProperty.call(response, 'state')) {
      throw new DeltaSyncLeaseError('LEASE_RPC_INVALID_RESPONSE', 'Delta-sync state response is invalid.');
    }
    return Object.freeze({
      revision: safeRevision(response.revision),
      state: normalizeState(response.state),
      lease_active: response.lease_active,
    });
  }

  async function acquire() {
    const ownerId = String(generateOwnerId() || '').trim();
    if (!UUID_PATTERN.test(ownerId)) {
      throw new DeltaSyncLeaseError('OWNER_TOKEN_INVALID', 'A valid lease owner token could not be generated.');
    }

    const response = await invoke(
      RPC_NAMES.acquire,
      { p_owner_id: ownerId, p_ttl_seconds: resolvedTtl },
      'LEASE_ACQUIRE_FAILED',
      'The delta-sync lease could not be acquired.',
    );
    if (!isPlainObject(response) || typeof response.acquired !== 'boolean') {
      throw new DeltaSyncLeaseError('LEASE_RPC_INVALID_RESPONSE', 'Lease acquisition response is invalid.');
    }
    if (!response.acquired) return null;
    if (!Object.prototype.hasOwnProperty.call(response, 'state')) {
      throw new DeltaSyncLeaseError('LEASE_RPC_INVALID_RESPONSE', 'Lease acquisition state is missing.');
    }

    let revision = safeRevision(response.revision);
    let snapshot = normalizeState(response.state);
    let leaseExpiresAt = safeExpiry(response.lease_expires_at);
    let active = true;
    let unusableError = null;

    const ensureUsable = () => {
      if (unusableError) throw unusableError;
      if (!active) throw new DeltaSyncLeaseError('LEASE_NOT_HELD', 'The delta-sync lease is not held.');
    };

    async function renew() {
      ensureUsable();
      let renewed;
      try {
        renewed = await invoke(
          RPC_NAMES.renew,
          { p_owner_id: ownerId, p_ttl_seconds: resolvedTtl },
          'LEASE_RENEW_FAILED',
          'The delta-sync lease could not be renewed.',
        );
      } catch (error) {
        unusableError = error;
        throw error;
      }
      if (!isPlainObject(renewed) || typeof renewed.renewed !== 'boolean') {
        unusableError = new DeltaSyncLeaseError('LEASE_RPC_INVALID_RESPONSE', 'Lease renewal response is invalid.');
        throw unusableError;
      }
      if (!renewed.renewed) {
        unusableError = new DeltaSyncLeaseError('LEASE_LOST', 'The delta-sync lease is no longer held.');
        throw unusableError;
      }
      try {
        leaseExpiresAt = safeExpiry(renewed.lease_expires_at);
      } catch (error) {
        unusableError = error;
        throw error;
      }
      return Object.freeze({ renewed: true, lease_expires_at: leaseExpiresAt });
    }

    async function saveSnapshot(nextState) {
      ensureUsable();
      if (!isPlainObject(nextState)) {
        throw new TypeError('Delta-sync state must be a plain object.');
      }
      const expectedRevision = revision;
      const nextSnapshot = cloneJson(nextState);
      let saved;
      try {
        saved = await invoke(
          RPC_NAMES.save,
          {
            p_owner_id: ownerId,
            p_expected_revision: expectedRevision,
            p_state: nextSnapshot,
          },
          'STATE_CAS_FAILED',
          'Delta-sync state could not be persisted safely.',
        );
      } catch (error) {
        unusableError = error;
        throw error;
      }
      if (!isPlainObject(saved)
          || saved.saved !== true
          || safeRevision(saved.revision) !== expectedRevision + 1) {
        unusableError = new DeltaSyncLeaseError('LEASE_RPC_INVALID_RESPONSE', 'Delta-sync save response is invalid.');
        throw unusableError;
      }
      revision = saved.revision;
      snapshot = nextSnapshot;
      return cloneJson(snapshot);
    }

    async function release() {
      if (!active) return false;
      active = false;
      const released = await invoke(
        RPC_NAMES.release,
        { p_owner_id: ownerId },
        'LEASE_RELEASE_FAILED',
        'The delta-sync lease could not be released.',
      );
      if (!isPlainObject(released) || typeof released.released !== 'boolean') {
        throw new DeltaSyncLeaseError('LEASE_RPC_INVALID_RESPONSE', 'Lease release response is invalid.');
      }
      return released.released;
    }

    const stateStore = Object.freeze({
      async load() {
        ensureUsable();
        return cloneJson(snapshot);
      },
      save: saveSnapshot,
    });

    return Object.freeze({
      stateStore,
      renew,
      release,
      assertHeld: ensureUsable,
      status: () => Object.freeze({
        active: active && !unusableError,
        revision,
        lease_expires_at: leaseExpiresAt,
      }),
    });
  }

  async function runExclusive(work) {
    if (typeof work !== 'function') throw new TypeError('work must be a function.');
    const session = await acquire();
    if (!session) {
      return Object.freeze({ acquired: false, reason: 'already_running' });
    }

    let timer = null;
    let renewalInFlight = null;
    let heartbeatError = null;
    let workError = null;
    let result;

    const heartbeat = () => {
      if (renewalInFlight || heartbeatError) return;
      renewalInFlight = session.renew()
        .catch(error => { heartbeatError = error; })
        .finally(() => { renewalInFlight = null; });
    };

    timer = setIntervalImpl(heartbeat, resolvedRenewInterval);
    if (timer && typeof timer.unref === 'function') timer.unref();

    try {
      result = await work(Object.freeze({
        stateStore: session.stateStore,
        assertHeld: session.assertHeld,
      }));
      if (renewalInFlight) await renewalInFlight;
      if (heartbeatError) throw heartbeatError;
    } catch (error) {
      workError = error;
    } finally {
      if (timer) clearIntervalImpl(timer);
      try {
        await session.release();
      } catch (releaseError) {
        if (!workError) workError = releaseError;
      }
    }

    if (workError) throw workError;
    return Object.freeze({ acquired: true, result });
  }

  return Object.freeze({ acquire, readState, runExclusive });
}

module.exports = {
  MIN_LEASE_TTL_SECONDS,
  MAX_LEASE_TTL_SECONDS,
  DEFAULT_LEASE_TTL_SECONDS,
  DEFAULT_RENEW_INTERVAL_MS,
  RPC_NAMES,
  DeltaSyncLeaseError,
  createDeltaSyncLeaseClient,
};
