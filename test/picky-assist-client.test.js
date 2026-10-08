'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { inspect } = require('node:util');
const {
  PICKY_ASSIST_MESSAGE_CONFIRMATION,
  PICKY_ASSIST_ORIGIN,
  PICKY_ASSIST_PUSH_PATH,
  createPickyAssistClient,
  validatePickyAssistNumber,
} = require('../lib/picky-assist-client');

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const NOW = Date.parse('2026-08-30T12:00:00.000Z');
const API_TOKEN = 'picky-api-token-placeholder-long';
const WEBHOOK_SECRET = 'local-webhook-secret-32-characters';

function deterministicTimeoutDependencies({ fire = true } = {}) {
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
        if (fire) queueMicrotask(callback);
        return Object.freeze({ sequence: state.scheduled });
      },
      clearTimeoutImpl: () => { state.cleared += 1; },
    },
  };
}

test('Picky Assist status exposes only the fixed push endpoint and keeps messaging disabled', () => {
  const client = createPickyAssistClient({
    apiToken: API_TOKEN,
    application: 101,
    projectId: 'project-placeholder',
    now: () => NOW,
  });
  const status = client.status();
  assert.equal(status.push_url, `${PICKY_ASSIST_ORIGIN}${PICKY_ASSIST_PUSH_PATH}`);
  assert.deepEqual(status.allowed_paths, [PICKY_ASSIST_PUSH_PATH]);
  assert.equal(status.outbound_messages_enabled, false);
  assert.equal(status.push_rate.limit, 90);
  assert.equal(status.webhook_generation, 'V4 per project');
  assert.doesNotMatch(JSON.stringify(status), new RegExp(API_TOKEN));
});

test('Picky Assist number validation requires full country code without plus, spaces, or leading zero', () => {
  assert.equal(validatePickyAssistNumber('919876543210'), '919876543210');
  for (const number of ['+919876543210', '09876543210', '91 9876543210', '1234', '9198765432101234']) {
    assert.throws(() => validatePickyAssistNumber(number), error => error.code === 'INVALID_INPUT');
  }
});

test('Picky Assist session messaging is disabled before any mocked fetch', async () => {
  let calls = 0;
  const client = createPickyAssistClient({
    apiToken: API_TOKEN,
    application: 101,
    now: () => NOW,
    fetchImpl: async () => { calls += 1; return jsonResponse({}); },
  });
  await assert.rejects(() => client.sendSessionMessage({
    number: '919876543210',
    message: 'Service update',
    sessionOpenedAt: new Date(NOW - 60_000).toISOString(),
    confirmation: PICKY_ASSIST_MESSAGE_CONFIRMATION,
    idempotencyKey: 'message:record-1234:attempt-1',
  }), error => error.code === 'OUTBOUND_DISABLED');
  assert.equal(calls, 0);
});

test('Picky Assist sends POST JSON with its project token in the body only after a recent session assertion', async () => {
  const requests = [];
  const client = createPickyAssistClient({
    apiToken: API_TOKEN,
    application: 101,
    outboundMessagesEnabled: true,
    now: () => NOW,
    fetchImpl: async (url, options) => {
      requests.push({ url: url.toString(), options });
      return jsonResponse({ status: 100, push_id: 'push-1', message: 'Success', data: [{ msg_id: 'msg-1' }] });
    },
  });
  const input = {
    number: '919876543210',
    message: 'Your service visit has been assigned.',
    sessionOpenedAt: new Date(NOW - 10 * 60_000).toISOString(),
    confirmation: PICKY_ASSIST_MESSAGE_CONFIRMATION,
    idempotencyKey: 'message:record-1234:attempt-1',
  };
  const result = await client.sendSessionMessage(input);
  assert.deepEqual(result, {
    accepted: true,
    delivered: false,
    provider_status: 100,
    push_id: 'push-1',
    message_ids: ['msg-1'],
    idempotency_key: 'message:record-1234:attempt-1',
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, `${PICKY_ASSIST_ORIGIN}${PICKY_ASSIST_PUSH_PATH}`);
  assert.equal(requests[0].options.method, 'POST');
  assert.deepEqual(requests[0].options.headers, { 'Content-Type': 'application/json' });
  const body = JSON.parse(requests[0].options.body);
  assert.equal(body.token, API_TOKEN);
  assert.equal(body.application, 101);
  assert.equal(body.reference_number, undefined);
  assert.equal(body.globalmessage, input.message);
  assert.deepEqual(body.data, [{ number: input.number, message: '', reference_number: input.idempotencyKey }]);

  await assert.rejects(() => client.sendSessionMessage(input), error => error.code === 'DUPLICATE_IDEMPOTENCY_KEY');
  assert.equal(requests.length, 1);
});

test('Picky Assist push timeout aborts the pending transport, stays sanitized, and clears its timer', async () => {
  const timeout = deterministicTimeoutDependencies();
  const client = createPickyAssistClient({
    apiToken: API_TOKEN,
    application: 101,
    outboundMessagesEnabled: true,
    now: () => NOW,
    fetchImpl: async (url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error(`push transport retained ${API_TOKEN}`);
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    }),
    ...timeout.options,
  });

  await assert.rejects(() => client.sendSessionMessage({
    number: '919876543210',
    message: 'Service update',
    sessionOpenedAt: new Date(NOW - 60_000).toISOString(),
    confirmation: PICKY_ASSIST_MESSAGE_CONFIRMATION,
    idempotencyKey: 'message:record-1234:timeout-1',
  }), error => {
    assert.equal(error.code, 'TRANSPORT_TIMEOUT');
    assert.equal(error.statusCode, 504);
    assert.equal(error.message, 'Picky Assist push request timed out.');
    assert.doesNotMatch(error.message, new RegExp(API_TOKEN));
    assert.equal(Object.prototype.hasOwnProperty.call(error, 'cause'), false);
    assert.doesNotMatch(inspect(error, { depth: 8 }), new RegExp(API_TOKEN));
    return true;
  });
  assert.deepEqual(timeout.state, { scheduled: 1, cleared: 1, aborted: 1 });
});

test('Picky Assist classifies an upstream abort separately from timeout and still clears its timer', async () => {
  const timeout = deterministicTimeoutDependencies({ fire: false });
  const client = createPickyAssistClient({
    apiToken: API_TOKEN,
    application: 101,
    outboundMessagesEnabled: true,
    now: () => NOW,
    fetchImpl: async () => {
      const error = new Error(`aborted transport retained ${API_TOKEN}`);
      error.name = 'AbortError';
      throw error;
    },
    ...timeout.options,
  });

  await assert.rejects(() => client.sendSessionMessage({
    number: '919876543210',
    message: 'Service update',
    sessionOpenedAt: new Date(NOW - 60_000).toISOString(),
    confirmation: PICKY_ASSIST_MESSAGE_CONFIRMATION,
    idempotencyKey: 'message:record-1234:aborted-1',
  }), error => {
    assert.equal(error.code, 'TRANSPORT_ABORTED');
    assert.equal(error.statusCode, 502);
    assert.equal(error.message, 'Picky Assist push request was aborted.');
    assert.doesNotMatch(error.message, new RegExp(API_TOKEN));
    assert.equal(Object.prototype.hasOwnProperty.call(error, 'cause'), false);
    assert.doesNotMatch(inspect(error, { depth: 8 }), new RegExp(API_TOKEN));
    return true;
  });
  assert.deepEqual(timeout.state, { scheduled: 1, cleared: 1, aborted: 0 });
});

test('Picky Assist rejects stale sessions and unapproved templates before mocked fetch', async () => {
  let calls = 0;
  const client = createPickyAssistClient({
    apiToken: API_TOKEN,
    application: 101,
    outboundMessagesEnabled: true,
    now: () => NOW,
    fetchImpl: async () => { calls += 1; return jsonResponse({ status: 100 }); },
  });
  await assert.rejects(() => client.sendSessionMessage({
    number: '919876543210',
    message: 'Stale session message',
    sessionOpenedAt: new Date(NOW - 24 * 60 * 60 * 1000 - 1).toISOString(),
    confirmation: PICKY_ASSIST_MESSAGE_CONFIRMATION,
    idempotencyKey: 'message:record-1234:stale-1',
  }), error => error.code === 'STALE_PREFLIGHT');
  await assert.rejects(() => client.sendApprovedTemplateMessage({
    number: '919876543210',
    templateId: 'VG7935',
    language: 'en',
    templateStatus: 2,
    templateStatusCheckedAt: new Date(NOW).toISOString(),
    confirmation: PICKY_ASSIST_MESSAGE_CONFIRMATION,
    idempotencyKey: 'message:record-1234:template-1',
  }), error => error.code === 'TEMPLATE_NOT_APPROVED');
  assert.equal(calls, 0);
});

test('Picky Assist approved-template method sends only template values after status 3 verification', async () => {
  let request;
  const client = createPickyAssistClient({
    apiToken: API_TOKEN,
    application: 121,
    outboundMessagesEnabled: true,
    now: () => NOW,
    fetchImpl: async (url, options) => {
      request = { url: url.toString(), options };
      return jsonResponse({ status: 100, push_id: 34, message: 'Success' });
    },
  });
  const result = await client.sendApprovedTemplateMessage({
    number: '919876543210',
    templateId: 'VG7935',
    language: 'en',
    templateMessage: ['ORDER-123', '31 Aug 2026'],
    templateStatus: 3,
    templateStatusCheckedAt: new Date(NOW - 60_000).toISOString(),
    confirmation: PICKY_ASSIST_MESSAGE_CONFIRMATION,
    idempotencyKey: 'message:record-1234:template-2',
  });
  assert.equal(result.accepted, true);
  assert.equal(result.delivered, false);
  assert.deepEqual(JSON.parse(request.options.body), {
    token: API_TOKEN,
    application: 121,
    priority: 0,
    template_id: 'VG7935',
    data: [{
      number: '919876543210',
      template_message: ['ORDER-123', '31 Aug 2026'],
      language: 'en',
      reference_number: 'message:record-1234:template-2',
    }],
  });
});

test('Picky Assist locally caps push requests at 90 per rolling minute', async () => {
  let calls = 0;
  const client = createPickyAssistClient({
    apiToken: API_TOKEN,
    application: 101,
    outboundMessagesEnabled: true,
    now: () => NOW,
    fetchImpl: async () => { calls += 1; return jsonResponse({ status: 100, push_id: String(calls) }); },
  });
  for (let index = 0; index < 90; index += 1) {
    await client.sendSessionMessage({
      number: '919876543210',
      message: 'Service update',
      sessionOpenedAt: new Date(NOW - 60_000).toISOString(),
      confirmation: PICKY_ASSIST_MESSAGE_CONFIRMATION,
      idempotencyKey: `message:record-${String(index).padStart(4, '0')}:attempt-1`,
    });
  }
  await assert.rejects(() => client.sendSessionMessage({
    number: '919876543210',
    message: 'Service update',
    sessionOpenedAt: new Date(NOW - 60_000).toISOString(),
    confirmation: PICKY_ASSIST_MESSAGE_CONFIRMATION,
    idempotencyKey: 'message:record-0090:attempt-1',
  }), error => error.code === 'LOCAL_RATE_LIMITED');
  assert.equal(calls, 90);
});

test('Picky Assist webhook parser requires the separate local secret before JSON parsing', () => {
  const client = createPickyAssistClient({ webhookSecret: WEBHOOK_SECRET, now: () => NOW });
  assert.throws(() => client.validateInboundWebhook({ headers: {}, rawBody: '{not json' }), error => error.code === 'WEBHOOK_UNAUTHORIZED');
  assert.deepEqual(client.validateInboundWebhook({
    headers: { 'x-magppie-webhook-secret': WEBHOOK_SECRET },
    rawBody: '{"message-in":"hello"}',
  }), { 'message-in': 'hello' });
});

test('Picky Assist mocked transport errors never expose the body token', async () => {
  const client = createPickyAssistClient({
    apiToken: API_TOKEN,
    application: 101,
    outboundMessagesEnabled: true,
    now: () => NOW,
    fetchImpl: async () => { throw new Error(`token=${API_TOKEN} transport failed`); },
  });
  await assert.rejects(() => client.sendSessionMessage({
    number: '919876543210',
    message: 'Service update',
    sessionOpenedAt: new Date(NOW - 60_000).toISOString(),
    confirmation: PICKY_ASSIST_MESSAGE_CONFIRMATION,
    idempotencyKey: 'message:record-1234:error-1',
  }), error => {
    assert.equal(error.code, 'TRANSPORT_ERROR');
    assert.doesNotMatch(error.message, new RegExp(API_TOKEN));
    assert.equal(Object.prototype.hasOwnProperty.call(error, 'cause'), false);
    assert.doesNotMatch(inspect(error, { depth: 8 }), new RegExp(API_TOKEN));
    return true;
  });
});
