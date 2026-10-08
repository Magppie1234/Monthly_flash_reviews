'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { inspect } = require('node:util');
const { fetchJson } = require('../lib/integration-safety');
const {
  OZONETEL_DOMESTIC_ORIGIN,
  OZONETEL_MANUAL_DIAL_CONFIRMATION,
  OZONETEL_PATHS,
  createOzonetelClient,
} = require('../lib/ozonetel-client');

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const NOW = Date.parse('2026-08-30T12:00:00.000Z');
const API_KEY = 'ozonetel-api-key-placeholder';
const USER_NAME = 'cloudagent-user';
const WEBHOOK_SECRET = 'local-webhook-secret-32-characters';

function readyPreflight(overrides = {}) {
  return {
    agentLoggedIn: true,
    agentAvailable: true,
    agentMode: 'manual',
    campaignRunning: true,
    manualDialEnabled: true,
    holidayBlocked: false,
    verifiedAt: new Date(NOW).toISOString(),
    ...overrides,
  };
}

function deterministicTimeoutDependencies({ fireOnSchedule = 1 } = {}) {
  const state = { scheduled: 0, cleared: 0, aborted: 0 };
  return {
    state,
    options: {
      requestTimeoutMs: 250,
      abortControllerFactory: () => {
        const controller = new AbortController();
        controller.signal.addEventListener('abort', () => { state.aborted += 1; }, { once: true });
        return controller;
      },
      setTimeoutImpl: callback => {
        state.scheduled += 1;
        const handle = Object.freeze({ sequence: state.scheduled });
        if (state.scheduled === fireOnSchedule) queueMicrotask(callback);
        return handle;
      },
      clearTimeoutImpl: () => { state.cleared += 1; },
    },
  };
}

test('shared provider transport aborts a declared oversize response before reading it', async () => {
  const state = { aborted: 0, cancelled: 0, textCalls: 0 };
  await assert.rejects(() => fetchJson({
    fetchImpl: async (url, options) => {
      options.signal.addEventListener('abort', () => { state.aborted += 1; }, { once: true });
      return {
        ok: true,
        status: 200,
        headers: { get: name => (name === 'content-length' ? '9' : null) },
        body: { cancel: () => { state.cancelled += 1; return new Promise(() => {}); } },
        text: async () => { state.textCalls += 1; return '{}'; },
      };
    },
    url: new URL('https://provider.example.invalid/test'),
    options: { method: 'GET' },
    maxBytes: 8,
    label: 'Mock provider',
    timeoutMs: 250,
  }), error => error.code === 'RESPONSE_TOO_LARGE' && error.statusCode === 502);
  assert.deepEqual(state, { aborted: 1, cancelled: 1, textCalls: 0 });
});

test('shared provider transport caps an unannounced stream before copying overflow bytes', async () => {
  const state = { aborted: 0, cancelled: 0, released: 0, reads: 0 };
  const chunks = [
    new TextEncoder().encode('{"a":'),
    new TextEncoder().encode('"long"}'),
  ];
  await assert.rejects(() => fetchJson({
    fetchImpl: async (url, options) => {
      options.signal.addEventListener('abort', () => { state.aborted += 1; }, { once: true });
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: {
          getReader: () => ({
            read: async () => {
              const value = chunks[state.reads];
              state.reads += 1;
              return value ? { done: false, value } : { done: true, value: undefined };
            },
            cancel: async () => { state.cancelled += 1; },
            releaseLock: () => { state.released += 1; },
          }),
        },
      };
    },
    url: new URL('https://provider.example.invalid/test'),
    options: { method: 'GET' },
    maxBytes: 8,
    label: 'Mock provider',
    timeoutMs: 250,
  }), error => error.code === 'RESPONSE_TOO_LARGE' && error.statusCode === 502);
  assert.deepEqual(state, { aborted: 1, cancelled: 1, released: 1, reads: 2 });
});

test('shared provider transport accepts exact-limit UTF-8 JSON split across byte boundaries', async () => {
  const bytes = new TextEncoder().encode('{"value":"✓"}');
  const split = bytes.indexOf(0xe2) + 1;
  const chunks = [bytes.slice(0, split), bytes.slice(split)];
  let reads = 0;
  const payload = await fetchJson({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: {
        getReader: () => ({
          read: async () => {
            const value = chunks[reads];
            reads += 1;
            return value ? { done: false, value } : { done: true, value: undefined };
          },
          cancel: async () => {},
          releaseLock: () => {},
        }),
      },
    }),
    url: new URL('https://provider.example.invalid/test'),
    options: { method: 'GET' },
    maxBytes: bytes.byteLength,
    label: 'Mock provider',
    timeoutMs: 250,
  });
  assert.deepEqual(payload, { value: '✓' });
});

test('shared provider timeout covers a pending streamed response body and exposes no raw cause', async () => {
  const state = { aborted: 0, cleared: 0, released: 0, scheduled: 0 };
  let fireTimeout;
  let markReadStarted;
  const readStarted = new Promise(resolve => { markReadStarted = resolve; });
  const request = fetchJson({
    fetchImpl: async (url, options) => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: {
        getReader: () => ({
          read: async () => new Promise((resolve, reject) => {
            options.signal.addEventListener('abort', () => {
              const error = new Error(`stream retained ${API_KEY}`);
              error.name = 'AbortError';
              reject(error);
            }, { once: true });
            markReadStarted();
          }),
          cancel: async () => {},
          releaseLock: () => { state.released += 1; },
        }),
      },
    }),
    url: new URL('https://provider.example.invalid/test'),
    options: { method: 'GET' },
    secrets: [API_KEY],
    maxBytes: 32,
    label: 'Mock provider',
    timeoutMs: 250,
    abortControllerFactory: () => {
      const controller = new AbortController();
      controller.signal.addEventListener('abort', () => { state.aborted += 1; }, { once: true });
      return controller;
    },
    setTimeoutImpl: callback => {
      state.scheduled += 1;
      fireTimeout = callback;
      return Object.freeze({ timer: state.scheduled });
    },
    clearTimeoutImpl: () => { state.cleared += 1; },
  });
  await readStarted;
  fireTimeout();
  await assert.rejects(request, error => {
    assert.equal(error.code, 'TRANSPORT_TIMEOUT');
    assert.equal(error.statusCode, 504);
    assert.equal(Object.prototype.hasOwnProperty.call(error, 'cause'), false);
    assert.doesNotMatch(inspect(error, { depth: 8 }), new RegExp(API_KEY));
    return true;
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(state, { aborted: 1, cleared: 1, released: 1, scheduled: 1 });
});

test('Ozonetel status is credential-safe, domestic-only, and outbound-disabled by default', () => {
  const client = createOzonetelClient({ apiKey: API_KEY, userName: USER_NAME, now: () => NOW });
  const status = client.status();
  assert.equal(status.base_url, OZONETEL_DOMESTIC_ORIGIN);
  assert.deepEqual(status.allowed_paths, Object.values(OZONETEL_PATHS));
  assert.equal(status.outbound_calls_enabled, false);
  assert.equal(status.token_generation.limit, 10);
  assert.equal(status.cdr_reads.limit, 2);
  assert.equal(status.cdr_reads.page_size_max, 500);
  assert.equal(status.cdr_reads.lookback_days, 15);
  assert.doesNotMatch(JSON.stringify(status), new RegExp(API_KEY));
});

test('Ozonetel token generation uses one mocked fetch for concurrent callers and caches for 55 minutes', async () => {
  let calls = 0;
  let release;
  let timersScheduled = 0;
  let timersCleared = 0;
  const fetchImpl = async (url, options) => {
    calls += 1;
    assert.equal(url.toString(), `${OZONETEL_DOMESTIC_ORIGIN}${OZONETEL_PATHS.token}`);
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.apiKey, API_KEY);
    assert.deepEqual(JSON.parse(options.body), { userName: USER_NAME });
    await new Promise(resolve => { release = resolve; });
    return jsonResponse({ token: 'mocked-token-value-long-enough', message: '' });
  };
  const client = createOzonetelClient({
    apiKey: API_KEY,
    userName: USER_NAME,
    fetchImpl,
    now: () => NOW,
    setTimeoutImpl: () => { timersScheduled += 1; return Object.freeze({ timer: timersScheduled }); },
    clearTimeoutImpl: () => { timersCleared += 1; },
  });
  const first = client.getToken();
  const second = client.getToken();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  release();
  assert.equal(await first, 'mocked-token-value-long-enough');
  assert.equal(await second, 'mocked-token-value-long-enough');
  assert.equal(await client.getToken(), 'mocked-token-value-long-enough');
  assert.equal(calls, 1);
  assert.equal(client.status().token_cached, true);
  assert.equal(timersScheduled, 1);
  assert.equal(timersCleared, 1);
});

test('Ozonetel token timeout aborts the pending transport, stays sanitized, and clears its timer', async () => {
  const timeout = deterministicTimeoutDependencies();
  const client = createOzonetelClient({
    apiKey: API_KEY,
    userName: USER_NAME,
    now: () => NOW,
    fetchImpl: async (url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error(`token transport retained ${API_KEY}`);
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    }),
    ...timeout.options,
  });

  await assert.rejects(() => client.getToken(), error => {
    assert.equal(error.code, 'TRANSPORT_TIMEOUT');
    assert.equal(error.statusCode, 504);
    assert.equal(error.message, 'Ozonetel token request timed out.');
    assert.doesNotMatch(error.message, new RegExp(API_KEY));
    assert.equal(Object.prototype.hasOwnProperty.call(error, 'cause'), false);
    assert.doesNotMatch(inspect(error, { depth: 8 }), new RegExp(API_KEY));
    return true;
  });
  assert.deepEqual(timeout.state, { scheduled: 1, cleared: 1, aborted: 1 });
  assert.equal(client.status().token_cached, false);
});

test('provider request timeout hard ceiling rejects unsafe configuration before transport', async () => {
  let calls = 0;
  const client = createOzonetelClient({
    apiKey: API_KEY,
    userName: USER_NAME,
    requestTimeoutMs: 30_001,
    now: () => NOW,
    fetchImpl: async () => { calls += 1; return jsonResponse({}); },
  });
  await assert.rejects(() => client.getToken(), error => error.code === 'INVALID_INPUT');
  assert.equal(calls, 0);
});

test('Ozonetel locally limits token generations to ten per rolling hour', async () => {
  let calls = 0;
  const client = createOzonetelClient({
    apiKey: API_KEY,
    userName: USER_NAME,
    reportingTimeZoneOffsetMinutes: 0,
    now: () => NOW,
    fetchImpl: async () => jsonResponse({ token: `mocked-token-${String(++calls).padStart(8, '0')}` }),
  });
  for (let index = 0; index < 10; index += 1) await client.getToken({ forceRefresh: true });
  await assert.rejects(() => client.getToken({ forceRefresh: true }), error => {
    assert.equal(error.code, 'LOCAL_RATE_LIMITED');
    assert.equal(error.statusCode, 429);
    assert.ok(error.retryAfterMs > 0);
    return true;
  });
  assert.equal(calls, 10);
});

test('Ozonetel CDR builder enforces one recent day, page size, rate limit, and never fetches CallAudio', async () => {
  let tokenCalls = 0;
  let cdrCalls = 0;
  const cdrRequestImpl = async request => {
    cdrCalls += 1;
    assert.equal(request.url.origin, OZONETEL_DOMESTIC_ORIGIN);
    assert.equal(request.url.pathname, OZONETEL_PATHS.cdr);
    assert.equal(request.url.searchParams.get('pageNo'), '2');
    assert.equal(request.url.searchParams.get('pageSize'), '500');
    assert.equal(request.method, 'GET');
    assert.equal(request.headers.Authorization, 'Bearer mocked-token-value-long-enough');
    assert.deepEqual(request.body, {
      fromDate: '2026-08-30 00:00:00',
      toDate: '2026-08-30 11:59:59',
      userName: USER_NAME,
      campaignName: 'Installations',
    });
    return {
      status: 'success',
      message: 'success',
      totalCount: 1,
      details: [{ CallID: 'call-1', CallAudio: 'https://recordings.example.invalid/opaque.mp3' }],
    };
  };
  const client = createOzonetelClient({
    apiKey: API_KEY,
    userName: USER_NAME,
    reportingTimeZoneOffsetMinutes: 0,
    now: () => NOW,
    fetchImpl: async () => { tokenCalls += 1; return jsonResponse({ token: 'mocked-token-value-long-enough' }); },
    cdrRequestImpl,
  });

  await assert.rejects(() => client.fetchCdrByPagination({
    fromDate: '2026-08-29 00:00:00',
    toDate: '2026-08-30 00:00:00',
  }), error => error.code === 'INVALID_CDR_DATE_RANGE');
  await assert.rejects(() => client.fetchCdrByPagination({
    fromDate: '2026-08-30 00:00:00',
    toDate: '2026-08-30 11:59:59',
    pageSize: 501,
  }), error => error.code === 'INVALID_INPUT');
  await assert.rejects(() => client.fetchCdrByPagination({
    fromDate: '2026-08-15 00:00:00',
    toDate: '2026-08-15 23:59:59',
  }), error => error.code === 'INVALID_CDR_DATE_RANGE');
  assert.equal(tokenCalls, 0);
  assert.equal(cdrCalls, 0);

  const input = {
    fromDate: '2026-08-30 00:00:00',
    toDate: '2026-08-30 11:59:59',
    pageNo: 2,
    pageSize: 500,
    campaignName: 'Installations',
  };
  const first = await client.fetchCdrByPagination(input);
  const second = await client.fetchCdrByPagination(input);
  assert.equal(first.totalCount, 1);
  assert.equal(first.recordings, 1);
  assert.equal(first.details[0].CallAudio, 'https://recordings.example.invalid/opaque.mp3');
  assert.equal(second.status, 'success');
  await assert.rejects(() => client.fetchCdrByPagination(input), error => error.code === 'LOCAL_RATE_LIMITED');
  assert.equal(tokenCalls, 1);
  assert.equal(cdrCalls, 2);
});

test('Ozonetel AgentManualDial stays fail-closed and validates official readiness conditions', async () => {
  let fetchCalls = 0;
  const disabled = createOzonetelClient({
    apiKey: API_KEY,
    userName: USER_NAME,
    now: () => NOW,
    fetchImpl: async () => { fetchCalls += 1; return jsonResponse({}); },
  });
  const action = {
    agentID: 'agent-1',
    campaignName: 'Manual Sales',
    customerNumber: '+919876543210',
    preflight: readyPreflight(),
    confirmation: OZONETEL_MANUAL_DIAL_CONFIRMATION,
    idempotencyKey: 'dial:record-1234:attempt-1',
  };
  await assert.rejects(() => disabled.agentManualDial(action), error => error.code === 'OUTBOUND_DISABLED');
  await assert.rejects(() => disabled.agentManualDial({ ...action, preflight: readyPreflight({ agentMode: 'progressive' }) }), error => error.code === 'AGENT_NOT_READY');
  await assert.rejects(() => disabled.agentManualDial({ ...action, skipCustomerNumberValidation: true }), error => error.code === 'UNSAFE_OPTION_REJECTED');
  assert.equal(fetchCalls, 0);
});

test('enabled Ozonetel AgentManualDial uses only the validated endpoint and blocks duplicate idempotency keys', async () => {
  const requests = [];
  const client = createOzonetelClient({
    apiKey: API_KEY,
    userName: USER_NAME,
    outboundCallsEnabled: true,
    now: () => NOW,
    fetchImpl: async (url, options) => {
      requests.push({ url: url.toString(), options });
      if (url.pathname === OZONETEL_PATHS.token) return jsonResponse({ token: 'mocked-token-value-long-enough' });
      return jsonResponse({ ucid: 'mock-ucid', status: 'queued successfully' });
    },
  });
  const action = {
    agentID: 'agent-1',
    campaignName: 'Manual Sales',
    customerNumber: '+919876543210',
    includeUcid: true,
    preflight: readyPreflight(),
    confirmation: OZONETEL_MANUAL_DIAL_CONFIRMATION,
    idempotencyKey: 'dial:record-1234:attempt-1',
  };
  const result = await client.agentManualDial(action);
  assert.equal(result.accepted, true);
  assert.equal(result.ucid, 'mock-ucid');
  assert.equal(requests.length, 2);
  assert.equal(requests[1].url, `${OZONETEL_DOMESTIC_ORIGIN}${OZONETEL_PATHS.manualDial}`);
  assert.equal(requests[1].options.method, 'POST');
  const body = JSON.parse(requests[1].options.body);
  assert.equal(body.userName, USER_NAME);
  assert.equal(body.agentID, 'agent-1');
  assert.equal(body.customerNumber, '+919876543210');
  assert.equal(body.UCID, 'true');
  assert.equal(body.skipCustomerNumberValidation, false);
  await assert.rejects(() => client.agentManualDial(action), error => error.code === 'DUPLICATE_IDEMPOTENCY_KEY');
  assert.equal(requests.length, 2);
});

test('Ozonetel manual-dial timeout covers the second fetch and clears both request timers', async () => {
  const timeout = deterministicTimeoutDependencies({ fireOnSchedule: 2 });
  let calls = 0;
  const client = createOzonetelClient({
    apiKey: API_KEY,
    userName: USER_NAME,
    outboundCallsEnabled: true,
    now: () => NOW,
    fetchImpl: async (url, options) => {
      calls += 1;
      if (url.pathname === OZONETEL_PATHS.token) return jsonResponse({ token: 'mocked-token-value-long-enough' });
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error(`manual dial retained ${API_KEY}`);
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      });
    },
    ...timeout.options,
  });

  await assert.rejects(() => client.agentManualDial({
    agentID: 'agent-1',
    campaignName: 'Manual Sales',
    customerNumber: '+919876543210',
    preflight: readyPreflight(),
    confirmation: OZONETEL_MANUAL_DIAL_CONFIRMATION,
    idempotencyKey: 'dial:record-1234:timeout-1',
  }), error => {
    assert.equal(error.code, 'TRANSPORT_TIMEOUT');
    assert.equal(error.statusCode, 504);
    assert.equal(error.message, 'Ozonetel manual dial request timed out.');
    assert.doesNotMatch(error.message, new RegExp(API_KEY));
    assert.equal(Object.prototype.hasOwnProperty.call(error, 'cause'), false);
    assert.doesNotMatch(inspect(error, { depth: 8 }), new RegExp(API_KEY));
    return true;
  });
  assert.equal(calls, 2);
  assert.deepEqual(timeout.state, { scheduled: 2, cleared: 2, aborted: 1 });
});

test('Ozonetel webhook parser rejects unauthenticated input before parsing the body', () => {
  const client = createOzonetelClient({ webhookSecret: WEBHOOK_SECRET, now: () => NOW });
  assert.throws(() => client.validateInboundWebhook({ headers: {}, rawBody: '{not json' }), error => error.code === 'WEBHOOK_UNAUTHORIZED');
  const payload = client.validateInboundWebhook({
    headers: { 'X-Magppie-Webhook-Secret': WEBHOOK_SECRET },
    rawBody: Buffer.from('{"event":"call-ended"}'),
  });
  assert.deepEqual(payload, { event: 'call-ended' });
});

test('Ozonetel transport errors are bounded and redact configured credentials', async () => {
  const client = createOzonetelClient({
    apiKey: API_KEY,
    userName: USER_NAME,
    now: () => NOW,
    fetchImpl: async () => { throw new Error(`request failed with apiKey=${API_KEY}, userName=${USER_NAME}, and a private stack`); },
  });
  await assert.rejects(() => client.getToken(), error => {
    assert.equal(error.code, 'TRANSPORT_ERROR');
    assert.ok(error.message.length <= 240);
    assert.doesNotMatch(error.message, new RegExp(API_KEY));
    assert.doesNotMatch(error.message, new RegExp(USER_NAME));
    assert.equal(Object.prototype.hasOwnProperty.call(error, 'cause'), false);
    assert.doesNotMatch(inspect(error, { depth: 8 }), new RegExp(API_KEY));
    assert.doesNotMatch(inspect(error, { depth: 8 }), new RegExp(USER_NAME));
    return true;
  });
});
