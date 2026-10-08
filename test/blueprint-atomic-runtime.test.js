'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BlueprintAtomicRuntimeError,
  buildAtomicRequest,
  createBlueprintAtomicRuntime,
} = require('../lib/blueprint-atomic-runtime');

const VERIFIED = Object.freeze({
  catalog_verified: true,
  fail_closed_canary_rejected: true,
  database_changes: 0,
});
const VERIFIED_IDENTITY = Object.freeze({
  request_principal_verified: true,
  identity_authorization_verified: true,
  audit_actor_binding_verified: true,
});
const verifiedIdentity = () => VERIFIED_IDENTITY;

function input(overrides = {}) {
  return {
    module: 'Leads',
    recordId: 'record-test-1',
    stateField: 'Lead_Status',
    expectedState: 'New',
    expectedModifiedTime: '2026-08-30T10:00:00.000Z',
    nextState: 'Qualified',
    blueprintId: '1001',
    blueprintName: 'Lead process',
    transitionId: '2001',
    transitionName: 'Qualify',
    patch: { Rating: 'Warm', Score: 4, Reviewed: true, Optional_Value: null },
    note: { title: 'Qualify — Blueprint', content: 'Synthetic transition note.' },
    ...overrides,
  };
}

function atomicResponse(request, overrides = {}) {
  const modifiedTime = '2026-08-30T15:30:00.123456+05:30';
  return {
    module: request.p_module,
    record_id: request.p_id,
    blueprint_id: request.p_blueprint_id,
    transition_id: request.p_transition_id,
    from: request.p_expected_state,
    to: request.p_next_state,
    modified_time: modifiedTime,
    note_id: request.p_note_id,
    data: {
      id: request.p_id,
      [request.p_state_field]: request.p_next_state,
      ...request.p_patch,
      Modified_Time: modifiedTime,
    },
    ...overrides,
  };
}

test('builds the exact immutable atomic RPC arguments without mutating caller input', () => {
  const source = input();
  const before = JSON.stringify(source);
  const request = buildAtomicRequest(source, { createNoteId: () => 'test-note-1' });

  assert.deepEqual(Object.keys(request), [
    'p_module', 'p_id', 'p_state_field', 'p_expected_state', 'p_expected_modified_time',
    'p_next_state', 'p_blueprint_id', 'p_blueprint_name', 'p_transition_id',
    'p_transition_name', 'p_patch', 'p_note_id', 'p_note_title', 'p_note_content',
  ]);
  assert.deepEqual(request.p_patch, { Rating: 'Warm', Score: 4, Reviewed: true, Optional_Value: null });
  assert.equal(request.p_note_id, 'local-note-test-note-1');
  assert.equal(Object.isFrozen(request), true);
  assert.equal(Object.isFrozen(request.p_patch), true);
  assert.equal(JSON.stringify(source), before);
  assert.equal(Object.prototype.hasOwnProperty.call(request, 's'), false);
});

test('rejects protected fields, nested values, non-finite numbers, extra keys, and accessors before verification or RPC', async () => {
  for (const value of [
    input({ patch: { Modified_Time: 'changed' } }),
    input({ patch: { Nested: { unsafe: true } } }),
    input({ patch: { Score: Number.POSITIVE_INFINITY } }),
    input({ patch: { Score: -0 } }),
    { ...input(), unexpected: true },
  ]) {
    assert.throws(() => buildAtomicRequest(value), error => (
      error instanceof BlueprintAtomicRuntimeError
      && error.code === 'BLUEPRINT_ATOMIC_INPUT_INVALID'
      && error.status === 422
    ));
  }

  const accessor = input();
  Object.defineProperty(accessor.patch, 'Unsafe', { enumerable: true, get: () => 'must not run' });
  assert.throws(() => buildAtomicRequest(accessor), /unsupported property descriptor/i);

  let verifyCalls = 0;
  let rpcCalls = 0;
  const runtime = createBlueprintAtomicRuntime({
    verify: async () => { verifyCalls += 1; return VERIFIED; },
    callRpc: async () => { rpcCalls += 1; return {}; },
  });
  await assert.rejects(() => runtime.execute(input({ patch: { Lead_Status: 'Bypass' } })), /protected or invalid field/i);
  assert.equal(verifyCalls, 0);
  assert.equal(rpcCalls, 0);
});

test('fails closed and executes no RPC when exact verification is absent, throws, or drifts', async () => {
  for (const verify of [
    async () => { throw new Error('credential-shaped verifier detail must stay private'); },
    async () => ({ ...VERIFIED, database_changes: 1 }),
    async () => ({ catalog_verified: true, fail_closed_canary_rejected: true }),
  ]) {
    let rpcCalls = 0;
    const runtime = createBlueprintAtomicRuntime({
      verify,
      callRpc: async () => { rpcCalls += 1; },
      createNoteId: () => 'unused-note',
      getIdentityAuthorizationStatus: verifiedIdentity,
    });
    const status = await runtime.initialize();
    assert.equal(status.runtime_executable, false);
    assert.equal(status.catalog_verified, false);
    await assert.rejects(
      () => runtime.execute(input({ note: null })),
      error => error.code === 'BLUEPRINT_ATOMIC_RUNTIME_UNAVAILABLE'
        && error.status === 503
        && !/credential-shaped|private/i.test(error.message),
    );
    assert.equal(rpcCalls, 0);
  }
});

test('exact SQL verification alone never enables execution without server-owned identity authorization and actor binding', async () => {
  let verifyCalls = 0;
  let rpcCalls = 0;
  const runtime = createBlueprintAtomicRuntime({
    verify: async () => { verifyCalls += 1; return VERIFIED; },
    callRpc: async () => { rpcCalls += 1; },
    createNoteId: () => 'unused-note',
  });

  const status = await runtime.initialize();
  assert.equal(status.catalog_verified, true);
  assert.equal(status.fail_closed_canary_rejected, true);
  assert.equal(status.request_principal_verified, false);
  assert.equal(status.identity_authorization_verified, false);
  assert.equal(status.audit_actor_binding_verified, false);
  assert.equal(status.runtime_executable, false);
  assert.equal(status.code, 'BLUEPRINT_IDENTITY_AUTHORIZATION_UNAVAILABLE');

  await assert.rejects(
    () => runtime.execute(input({ note: null })),
    error => error.code === 'BLUEPRINT_IDENTITY_AUTHORIZATION_UNAVAILABLE'
      && error.status === 503,
  );
  assert.equal(verifyCalls, 2, 'execute must force a fresh exact verification');
  assert.equal(rpcCalls, 0);
});

test('after exact verification, sends one frozen request and returns only a sanitized success receipt', async () => {
  let verifyCalls = 0;
  const requests = [];
  const runtime = createBlueprintAtomicRuntime({
    verify: async () => { verifyCalls += 1; return VERIFIED; },
    getIdentityAuthorizationStatus: verifiedIdentity,
    createNoteId: () => 'test-note-2',
    callRpc: async request => {
      requests.push(request);
      assert.equal(Object.isFrozen(request), true);
      assert.equal(Object.isFrozen(request.p_patch), true);
      return atomicResponse(request);
    },
  });

  const result = await runtime.execute(input());
  assert.equal(verifyCalls, 1);
  assert.equal(requests.length, 1);
  assert.deepEqual(result, {
    status: 'success',
    transition_id: '2001',
    from: 'New',
    to: 'Qualified',
    modified_time: '2026-08-30T15:30:00.123456+05:30',
    note_created: true,
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'record_id'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'data'), false);

  const sequentialRequest = buildAtomicRequest(input({
    expectedState: result.to,
    expectedModifiedTime: result.modified_time,
    nextState: 'Converted',
    note: null,
  }));
  assert.equal(sequentialRequest.p_expected_modified_time, '2026-08-30T15:30:00.123456+05:30');

  await runtime.initialize();
  assert.equal(verifyCalls, 1, 'a positive GET-status check may use its bounded TTL');
});

test('distinguishes optimistic state and Modified_Time conflicts while sanitizing every other database failure', async () => {
  const cases = [
    {
      dbCode: '40001',
      dbMessage: 'Blueprint expected-current-state conflict',
      expectedCode: 'BLUEPRINT_STATE_CONFLICT',
      expectedStatus: 409,
    },
    {
      dbCode: '40001',
      dbMessage: 'Blueprint expected-modified-time conflict',
      expectedCode: 'BLUEPRINT_VERSION_CONFLICT',
      expectedStatus: 409,
    },
    {
      dbCode: 'XX000',
      dbMessage: 'private database detail',
      expectedCode: 'BLUEPRINT_ATOMIC_EXECUTION_FAILED',
      expectedStatus: 502,
    },
  ];

  for (const item of cases) {
    const runtime = createBlueprintAtomicRuntime({
      verify: async () => VERIFIED,
      getIdentityAuthorizationStatus: verifiedIdentity,
      createNoteId: () => 'unused-note',
      callRpc: async () => {
        const error = new Error('password=must-not-escape');
        error.dbCode = item.dbCode;
        error.dbMessage = item.dbMessage;
        throw error;
      },
    });
    await assert.rejects(
      () => runtime.execute(input({ note: null })),
      error => error.code === item.expectedCode
        && error.status === item.expectedStatus
        && !/password|private database detail|XX000/i.test(error.message),
    );
  }
});

test('fails closed when an otherwise successful RPC response does not match the immutable request', async () => {
  const adversarialResponses = [
    request => atomicResponse(request, { to: 'Unexpected state' }),
    request => atomicResponse(request, { data: { ...atomicResponse(request).data, id: 'wrong-record' } }),
    request => atomicResponse(request, { data: { ...atomicResponse(request).data, [request.p_state_field]: 'Old state' } }),
    request => atomicResponse(request, { data: { ...atomicResponse(request).data, Rating: 'Cold' } }),
    request => atomicResponse(request, { data: { ...atomicResponse(request).data, Modified_Time: '2026-08-30T15:30:00.123455+05:30' } }),
  ];
  for (const createResponse of adversarialResponses) {
    const runtime = createBlueprintAtomicRuntime({
      verify: async () => VERIFIED,
      getIdentityAuthorizationStatus: verifiedIdentity,
      createNoteId: () => 'unused-note',
      callRpc: async request => createResponse(request),
    });
    await assert.rejects(
      () => runtime.execute(input({ note: null })),
      error => error.code === 'BLUEPRINT_ATOMIC_RESPONSE_INVALID' && error.status === 502,
    );
  }
});

test('bounded positive and negative status TTLs refresh, while every execute forces a fresh verifier result', async () => {
  let clock = 1_000;
  let shouldVerify = true;
  let verifyCalls = 0;
  let rpcCalls = 0;
  const runtime = createBlueprintAtomicRuntime({
    verify: async () => {
      verifyCalls += 1;
      if (!shouldVerify) throw new Error('synthetic drift');
      return VERIFIED;
    },
    getIdentityAuthorizationStatus: verifiedIdentity,
    callRpc: async request => { rpcCalls += 1; return atomicResponse(request); },
    positiveTtlMs: 100,
    negativeTtlMs: 20,
    verificationTimeoutMs: 50,
    now: () => clock,
  });

  assert.equal((await runtime.initialize()).runtime_executable, true);
  await runtime.initialize();
  assert.equal(verifyCalls, 1);
  clock += 101;
  shouldVerify = false;
  assert.equal((await runtime.initialize()).runtime_executable, false);
  assert.equal(verifyCalls, 2);
  clock += 19;
  await runtime.initialize();
  assert.equal(verifyCalls, 2);
  clock += 2;
  shouldVerify = true;
  assert.equal((await runtime.initialize()).runtime_executable, true);
  assert.equal(verifyCalls, 3);

  shouldVerify = false;
  await assert.rejects(() => runtime.execute(input({ note: null })), error => (
    error.code === 'BLUEPRINT_ATOMIC_RUNTIME_UNAVAILABLE'
  ));
  assert.equal(verifyCalls, 4);
  assert.equal(rpcCalls, 0);
});

test('a hanging verifier is bounded and fails closed without calling the RPC', async () => {
  let rpcCalls = 0;
  const runtime = createBlueprintAtomicRuntime({
    verify: async () => new Promise(() => {}),
    getIdentityAuthorizationStatus: verifiedIdentity,
    callRpc: async () => { rpcCalls += 1; },
    verificationTimeoutMs: 10,
  });
  const started = Date.now();
  const status = await runtime.initialize();
  assert.equal(status.runtime_executable, false);
  assert.ok(Date.now() - started < 500, 'verification must not hang the endpoint');
  await assert.rejects(() => runtime.execute(input({ note: null })), error => error.status === 503);
  assert.equal(rpcCalls, 0);
});
