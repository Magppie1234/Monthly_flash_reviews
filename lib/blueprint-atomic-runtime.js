'use strict';

const crypto = require('node:crypto');
const { getBlueprintIdentityAuthorizationStatus } = require('./blueprint-identity-authorization');

const SAFE_IDENTIFIER = /^[A-Za-z][A-Za-z0-9_$]*$/;
const SAFE_INTERNAL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const SAFE_CONFIGURATION_ID = /^\d{1,30}$/;
const MAX_TEXT_LENGTH = 1200;
const MAX_PATCH_FIELDS = 64;
const DEFAULT_POSITIVE_TTL_MS = 60_000;
const DEFAULT_NEGATIVE_TTL_MS = 15_000;
const DEFAULT_VERIFICATION_TIMEOUT_MS = 6_000;
const SQL_UNAVAILABLE_MESSAGE = 'Atomic Blueprint execution is unavailable until the exact transaction function and fail-closed canary are verified.';
const IDENTITY_UNAVAILABLE_MESSAGE = 'Atomic Blueprint execution is unavailable until a verified local request principal, Blueprint authorization, and audit actor binding are implemented.';

const UNVERIFIED_STATUS = Object.freeze({
  verification_complete: false,
  catalog_verified: false,
  fail_closed_canary_rejected: false,
  database_changes: 0,
  request_principal_verified: false,
  identity_authorization_verified: false,
  audit_actor_binding_verified: false,
  runtime_executable: false,
  code: 'BLUEPRINT_ATOMIC_RUNTIME_UNVERIFIED',
  message: `${SQL_UNAVAILABLE_MESSAGE} ${IDENTITY_UNAVAILABLE_MESSAGE}`,
});

class BlueprintAtomicRuntimeError extends Error {
  constructor(code, message, status, details = {}) {
    super(message);
    this.name = 'BlueprintAtomicRuntimeError';
    this.code = code;
    this.status = status;
    this.details = Object.freeze({ ...details });
  }
}

function fail(code, message, status = 422, details = {}) {
  throw new BlueprintAtomicRuntimeError(code, message, status, details);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Reflect.ownKeys(value).forEach(key => deepFreeze(value[key]));
  return value;
}

function snapshotPlain(value, label, state = { seen: new Set(), properties: 0 }, depth = 0) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (!value || typeof value !== 'object' || depth > 10 || state.seen.has(value)) {
    fail('BLUEPRINT_ATOMIC_INPUT_INVALID', `${label} must contain only bounded plain data.`);
  }
  let prototype;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    fail('BLUEPRINT_ATOMIC_INPUT_INVALID', `${label} could not be inspected safely.`);
  }
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some(key => typeof key !== 'string')) {
    fail('BLUEPRINT_ATOMIC_INPUT_INVALID', `${label} contains an unsupported property.`);
  }
  state.properties += keys.length;
  if (state.properties > 1000) fail('BLUEPRINT_ATOMIC_INPUT_INVALID', `${label} is too large.`);
  state.seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (prototype !== Array.prototype) fail('BLUEPRINT_ATOMIC_INPUT_INVALID', `${label} must be a regular array.`);
      const lengthDescriptor = descriptors.length;
      if (!lengthDescriptor || !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value')
          || lengthDescriptor.enumerable !== false || !Number.isSafeInteger(lengthDescriptor.value)
          || lengthDescriptor.value < 0 || keys.length !== lengthDescriptor.value + 1) {
        fail('BLUEPRINT_ATOMIC_INPUT_INVALID', `${label} must be a dense regular array.`);
      }
      const output = new Array(lengthDescriptor.value);
      for (let index = 0; index < lengthDescriptor.value; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value') || descriptor.enumerable !== true) {
          fail('BLUEPRINT_ATOMIC_INPUT_INVALID', `${label} must be a dense regular array.`);
        }
        output[index] = snapshotPlain(descriptor.value, `${label}[${index}]`, state, depth + 1);
      }
      return output;
    }
    if (prototype !== Object.prototype && prototype !== null) {
      fail('BLUEPRINT_ATOMIC_INPUT_INVALID', `${label} must be a plain object.`);
    }
    const output = {};
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!Object.prototype.hasOwnProperty.call(descriptor, 'value') || descriptor.enumerable !== true) {
        fail('BLUEPRINT_ATOMIC_INPUT_INVALID', `${label} contains an unsupported property descriptor.`);
      }
      output[key] = snapshotPlain(descriptor.value, `${label}.${key}`, state, depth + 1);
    }
    return output;
  } finally {
    state.seen.delete(value);
  }
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail('BLUEPRINT_ATOMIC_INPUT_INVALID', `${label} has an unsupported or missing property.`);
  }
}

function boundedText(value, label, max = MAX_TEXT_LENGTH) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    fail('BLUEPRINT_ATOMIC_INPUT_INVALID', `${label} must be bounded text.`);
  }
  return value.trim();
}

function identifier(value, label) {
  const text = boundedText(value, label, 160);
  if (!SAFE_IDENTIFIER.test(text)) fail('BLUEPRINT_ATOMIC_INPUT_INVALID', `${label} must be a safe API name.`);
  return text;
}

function internalId(value, label) {
  const text = boundedText(value, label, 200);
  if (!SAFE_INTERNAL_ID.test(text)) fail('BLUEPRINT_ATOMIC_INPUT_INVALID', `${label} is invalid.`);
  return text;
}

function configurationId(value, label) {
  const text = boundedText(String(value ?? ''), label, 30);
  if (!SAFE_CONFIGURATION_ID.test(text)) fail('BLUEPRINT_ATOMIC_INPUT_INVALID', `${label} is invalid.`);
  return text;
}

function timestamp(value, label) {
  const text = boundedText(value, label, 80);
  if (Number.isNaN(Date.parse(text))) fail('BLUEPRINT_ATOMIC_INPUT_INVALID', `${label} must be a valid timestamp.`);
  return text;
}

function safePatch(value, stateField) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('BLUEPRINT_ATOMIC_INPUT_INVALID', 'patch must be a plain object.');
  }
  const keys = Object.keys(value);
  if (keys.length > MAX_PATCH_FIELDS) fail('BLUEPRINT_ATOMIC_INPUT_INVALID', 'patch contains too many fields.');
  const output = {};
  for (const key of keys) {
    if (!SAFE_IDENTIFIER.test(key) || ['id', 'Created_Time', 'Modified_Time', stateField].includes(key)) {
      fail('BLUEPRINT_ATOMIC_INPUT_INVALID', 'patch contains a protected or invalid field.');
    }
    const item = value[key];
    if (item !== null && !['string', 'number', 'boolean'].includes(typeof item)) {
      fail('BLUEPRINT_ATOMIC_INPUT_INVALID', 'patch values must be safe scalars.');
    }
    if (typeof item === 'number' && !Number.isFinite(item)) {
      fail('BLUEPRINT_ATOMIC_INPUT_INVALID', 'patch values must be finite.');
    }
    if (typeof item === 'number' && Object.is(item, -0)) {
      fail('BLUEPRINT_ATOMIC_INPUT_INVALID', 'patch values must have a stable JSON representation.');
    }
    if (typeof item === 'string' && item.length > 100000) {
      fail('BLUEPRINT_ATOMIC_INPUT_INVALID', 'patch text values must be bounded.');
    }
    output[key] = item;
  }
  return output;
}

function safeNote(value, createNoteId) {
  if (value === null) return { id: null, title: null, content: null };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('BLUEPRINT_ATOMIC_INPUT_INVALID', 'note must be null or a plain object.');
  }
  exactKeys(value, ['title', 'content'], 'note');
  const content = boundedText(value.content, 'note.content', 100000);
  const title = boundedText(value.title, 'note.title', 500);
  let generated;
  try {
    generated = createNoteId();
  } catch {
    fail('BLUEPRINT_ATOMIC_INPUT_INVALID', 'A safe Note identity could not be created.');
  }
  const suffix = internalId(String(generated ?? ''), 'note identity');
  return { id: `local-note-${suffix}`, title, content };
}

function buildAtomicRequest(input, { createNoteId = () => crypto.randomUUID() } = {}) {
  const source = snapshotPlain(input, 'atomic transition input');
  exactKeys(source, [
    'module', 'recordId', 'stateField', 'expectedState', 'expectedModifiedTime', 'nextState',
    'blueprintId', 'blueprintName', 'transitionId', 'transitionName', 'patch', 'note',
  ], 'atomic transition input');
  const module = identifier(source.module, 'module');
  const recordId = internalId(source.recordId, 'recordId');
  const stateField = identifier(source.stateField, 'stateField');
  const expectedState = boundedText(source.expectedState, 'expectedState', 500);
  const nextState = boundedText(source.nextState, 'nextState', 500);
  const expectedModifiedTime = timestamp(source.expectedModifiedTime, 'expectedModifiedTime');
  const blueprintId = configurationId(source.blueprintId, 'blueprintId');
  const transitionId = configurationId(source.transitionId, 'transitionId');
  const note = safeNote(source.note, createNoteId);
  const request = {
    p_module: module,
    p_id: recordId,
    p_state_field: stateField,
    p_expected_state: expectedState,
    p_expected_modified_time: expectedModifiedTime,
    p_next_state: nextState,
    p_blueprint_id: blueprintId,
    p_blueprint_name: boundedText(source.blueprintName, 'blueprintName', 500),
    p_transition_id: transitionId,
    p_transition_name: boundedText(source.transitionName, 'transitionName', 500),
    p_patch: safePatch(source.patch, stateField),
    p_note_id: note.id,
    p_note_title: note.title,
    p_note_content: note.content,
  };
  return deepFreeze(request);
}

function identityStatus(value) {
  const snapshot = snapshotPlain(value, 'Blueprint identity authorization status');
  exactKeys(snapshot, [
    'request_principal_verified', 'identity_authorization_verified', 'audit_actor_binding_verified',
  ], 'Blueprint identity authorization status');
  for (const key of Object.keys(snapshot)) {
    if (typeof snapshot[key] !== 'boolean') {
      fail('BLUEPRINT_ATOMIC_VERIFICATION_INVALID', 'The Blueprint identity authorization status is invalid.', 503);
    }
  }
  return snapshot;
}

function verifiedStatus(result, identityResult) {
  const snapshot = snapshotPlain(result, 'Blueprint verifier result');
  exactKeys(snapshot, ['catalog_verified', 'fail_closed_canary_rejected', 'database_changes'], 'Blueprint verifier result');
  if (snapshot.catalog_verified !== true || snapshot.fail_closed_canary_rejected !== true || snapshot.database_changes !== 0) {
    fail('BLUEPRINT_ATOMIC_VERIFICATION_INVALID', 'The Blueprint atomic verifier returned an unsupported result.', 503);
  }
  const identity = identityStatus(identityResult);
  const identityVerified = identity.request_principal_verified
    && identity.identity_authorization_verified
    && identity.audit_actor_binding_verified;
  return deepFreeze({
    verification_complete: true,
    catalog_verified: true,
    fail_closed_canary_rejected: true,
    database_changes: 0,
    ...identity,
    runtime_executable: identityVerified,
    code: identityVerified ? 'BLUEPRINT_ATOMIC_RUNTIME_VERIFIED' : 'BLUEPRINT_IDENTITY_AUTHORIZATION_UNAVAILABLE',
    message: identityVerified
      ? 'The exact atomic Blueprint transaction, fail-closed canary, request authorization, and audit actor binding are verified.'
      : IDENTITY_UNAVAILABLE_MESSAGE,
  });
}

function unavailableStatus() {
  return deepFreeze({
    ...UNVERIFIED_STATUS,
    verification_complete: true,
    code: 'BLUEPRINT_ATOMIC_RUNTIME_UNAVAILABLE',
    message: `${SQL_UNAVAILABLE_MESSAGE} ${IDENTITY_UNAVAILABLE_MESSAGE}`,
  });
}

function errorData(error) {
  if (!error || typeof error !== 'object') return {};
  let descriptors;
  try {
    descriptors = Object.getOwnPropertyDescriptors(error);
  } catch {
    return {};
  }
  const valueFor = key => {
    const descriptor = descriptors[key];
    return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value') ? descriptor.value : undefined;
  };
  return { dbCode: valueFor('dbCode'), dbMessage: valueFor('dbMessage') };
}

function mapDatabaseError(error) {
  const { dbCode, dbMessage } = errorData(error);
  if (dbCode === '40001' && dbMessage === 'Blueprint expected-current-state conflict') {
    return new BlueprintAtomicRuntimeError(
      'BLUEPRINT_STATE_CONFLICT',
      'The record state changed before the atomic Blueprint transition could be committed. Refresh and review the transition again.',
      409,
      { retryable_after_refresh: true },
    );
  }
  if (dbCode === '40001' && dbMessage === 'Blueprint expected-modified-time conflict') {
    return new BlueprintAtomicRuntimeError(
      'BLUEPRINT_VERSION_CONFLICT',
      'The record was modified before the atomic Blueprint transition could be committed. Refresh and review the transition again.',
      409,
      { retryable_after_refresh: true },
    );
  }
  if (dbCode === 'P0002' && dbMessage === 'Blueprint record not found') {
    return new BlueprintAtomicRuntimeError('BLUEPRINT_RECORD_NOT_FOUND', 'The Blueprint record is no longer available.', 404);
  }
  return new BlueprintAtomicRuntimeError(
    'BLUEPRINT_ATOMIC_EXECUTION_FAILED',
    'The atomic Blueprint transition was not committed.',
    502,
  );
}

function validateAtomicResponse(value, request) {
  const response = snapshotPlain(value, 'atomic Blueprint response');
  exactKeys(response, [
    'module', 'record_id', 'blueprint_id', 'transition_id', 'from', 'to', 'modified_time', 'note_id', 'data',
  ], 'atomic Blueprint response');
  if (response.module !== request.p_module || response.record_id !== request.p_id
      || String(response.blueprint_id) !== request.p_blueprint_id
      || String(response.transition_id) !== request.p_transition_id
      || response.from !== request.p_expected_state || response.to !== request.p_next_state
      || response.note_id !== request.p_note_id
      || !response.data || typeof response.data !== 'object' || Array.isArray(response.data)
      || response.data.id !== request.p_id
      || response.data[request.p_state_field] !== request.p_next_state) {
    fail('BLUEPRINT_ATOMIC_RESPONSE_INVALID', 'The atomic Blueprint response did not match the requested transition.', 502);
  }
  const modifiedTime = timestamp(response.modified_time, 'atomic response modified_time');
  if (response.data.Modified_Time !== modifiedTime
      || Object.entries(request.p_patch).some(([key, expected]) => (
        !Object.prototype.hasOwnProperty.call(response.data, key)
        || !Object.is(response.data[key], expected)
      ))) {
    fail('BLUEPRINT_ATOMIC_RESPONSE_INVALID', 'The atomic Blueprint response did not match the requested transition.', 502);
  }
  return deepFreeze({
    status: 'success',
    transition_id: request.p_transition_id,
    from: request.p_expected_state,
    to: request.p_next_state,
    modified_time: modifiedTime,
    note_created: request.p_note_id !== null,
  });
}

function createBlueprintAtomicRuntime({
  verify,
  callRpc,
  createNoteId = () => crypto.randomUUID(),
  getIdentityAuthorizationStatus = getBlueprintIdentityAuthorizationStatus,
  positiveTtlMs = DEFAULT_POSITIVE_TTL_MS,
  negativeTtlMs = DEFAULT_NEGATIVE_TTL_MS,
  verificationTimeoutMs = DEFAULT_VERIFICATION_TIMEOUT_MS,
  now = () => Date.now(),
} = {}) {
  if (typeof verify !== 'function' || typeof callRpc !== 'function' || typeof createNoteId !== 'function'
      || typeof getIdentityAuthorizationStatus !== 'function' || typeof now !== 'function') {
    throw new TypeError('Blueprint atomic runtime dependencies are required.');
  }
  for (const [label, value] of [
    ['positiveTtlMs', positiveTtlMs],
    ['negativeTtlMs', negativeTtlMs],
    ['verificationTimeoutMs', verificationTimeoutMs],
  ]) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 300_000) {
      throw new TypeError(`${label} must be a bounded positive integer.`);
    }
  }
  let status = UNVERIFIED_STATUS;
  let verificationPromise = null;
  let verifiedAt = 0;

  const initialize = async ({ force = false } = {}) => {
    if (verificationPromise) return verificationPromise;
    const ttl = status.catalog_verified ? positiveTtlMs : negativeTtlMs;
    if (!force && status.verification_complete && now() - verifiedAt < ttl) return status;

    const controller = new AbortController();
    let timer;
    const timeout = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('Blueprint verification timed out.'));
      }, verificationTimeoutMs);
    });
    const current = Promise.race([
      Promise.resolve().then(() => verify({ signal: controller.signal })),
      timeout,
    ])
      .then(result => {
        status = verifiedStatus(result, getIdentityAuthorizationStatus());
      })
      .catch(() => {
        status = unavailableStatus();
      })
      .then(() => {
        verifiedAt = now();
        return status;
      })
      .finally(() => {
        clearTimeout(timer);
        if (verificationPromise === current) verificationPromise = null;
      });
    verificationPromise = current;
    return current;
  };

  const execute = async input => {
    const request = buildAtomicRequest(input, { createNoteId });
    const readiness = await initialize({ force: true });
    if (!readiness.runtime_executable) {
      throw new BlueprintAtomicRuntimeError(
        readiness.code,
        readiness.message,
        503,
      );
    }
    let response;
    try {
      response = await callRpc(request);
    } catch (error) {
      throw mapDatabaseError(error);
    }
    return validateAtomicResponse(response, request);
  };

  return Object.freeze({
    initialize,
    status: () => status,
    execute,
  });
}

module.exports = {
  BlueprintAtomicRuntimeError,
  buildAtomicRequest,
  createBlueprintAtomicRuntime,
};
