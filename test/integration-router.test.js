'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { IntegrationError } = require('../lib/integration-safety');
const { createIntegrationRouter, INTEGRATION_BODY_LIMIT_BYTES } = require('../lib/integration-router');
const { createOzonetelClient, OZONETEL_MANUAL_DIAL_CONFIRMATION } = require('../lib/ozonetel-client');
const { createPickyAssistClient, PICKY_ASSIST_MESSAGE_CONFIRMATION } = require('../lib/picky-assist-client');

const NOW = Date.parse('2026-08-30T12:00:00.000Z');
const MOUNT = '/custom/integrations';

function ozonetelStatus(extra = {}) {
  return {
    provider: 'ozonetel',
    source_mode: 'read-only-by-default',
    base_url: 'https://in1-ccaas-api.ozonetel.com',
    allowed_paths: ['/ca_apis/CAToken/generateToken', '/ca_reports/fetchCdrByPagination', '/ca_apis/AgentManualDial'],
    api_key_configured: true,
    username_configured: true,
    reporting_timezone_offset_configured: true,
    reporting_timezone_offset_minutes: 330,
    webhook_secret_configured: false,
    outbound_calls_enabled: false,
    token_cached: false,
    token_cache_expires_at: null,
    token_generation: { limit: 10, window_minutes: 60, remaining: 10 },
    cdr_reads: { limit: 2, window_minutes: 1, remaining: 2, page_size_max: 500, lookback_days: 15 },
    call_audio_behavior: 'reference-only; never auto-fetched',
    manual_dial_confirmation: OZONETEL_MANUAL_DIAL_CONFIRMATION,
    ...extra,
  };
}

function pickyStatus(extra = {}) {
  return {
    provider: 'picky-assist',
    source_mode: 'read-only-by-default',
    push_url: 'https://pickyassist.com/app/api/v2/push',
    allowed_paths: ['/app/api/v2/push'],
    api_token_configured: true,
    application_configured: true,
    project_id_configured: true,
    webhook_secret_configured: false,
    webhook_generation: 'V4 per project',
    outbound_messages_enabled: false,
    push_rate: { limit: 90, window_minutes: 1, remaining: 90 },
    session_requirement: 'verified inbound session opened within 24 hours',
    template_requirement: 'template status 3 (Approved), checked within 24 hours',
    delivery_semantics: 'status 100 means accepted for processing, not delivered',
    message_confirmation: PICKY_ASSIST_MESSAGE_CONFIRMATION,
    ...extra,
  };
}

function fakeClients(overrides = {}) {
  return {
    ozonetelClient: {
      status: () => ozonetelStatus(),
      fetchCdrByPagination: async input => ({ input }),
      agentManualDial: async input => ({ accepted: true, input }),
      ...overrides.ozonetelClient,
    },
    pickyAssistClient: {
      status: () => pickyStatus(),
      sendSessionMessage: async input => ({ accepted: true, input }),
      sendApprovedTemplateMessage: async input => ({ accepted: true, input }),
      ...overrides.pickyAssistClient,
    },
  };
}

async function withRouter(clients, run, { parseGlobally = false, stripContentLengthAfterParse = false } = {}) {
  const app = express();
  if (parseGlobally) app.use(express.json({ limit: '2mb' }));
  if (stripContentLengthAfterParse) {
    app.use((request, response, next) => {
      delete request.headers['content-length'];
      next();
    });
  }
  app.use(MOUNT, createIntegrationRouter(clients));
  const server = await new Promise((resolve, reject) => {
    const candidate = app.listen(0, '127.0.0.1', () => resolve(candidate));
    candidate.once('error', reject);
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}${MOUNT}`;
  try {
    await run(baseUrl);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

async function postJson(baseUrl, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

test('GET /status returns a no-store, whitelist-only credential-safe readiness contract', async () => {
  const credentials = ['raw-ozonetel-api-key', 'raw-ozonetel-token', 'raw-picky-api-token'];
  const clients = fakeClients({
    ozonetelClient: {
      status: () => ozonetelStatus({
        api_key: credentials[0],
        token: credentials[1],
        nested_private: { password: 'private-password' },
      }),
    },
    pickyAssistClient: {
      status: () => pickyStatus({ api_token: credentials[2], secret: 'private-webhook-secret' }),
    },
  });

  await withRouter(clients, async baseUrl => {
    const response = await fetch(`${baseUrl}/status`);
    const text = await response.text();
    const payload = JSON.parse(text);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(payload.ok, true);
    assert.equal(payload.integrations.ozonetel.base_url, 'https://in1-ccaas-api.ozonetel.com');
    assert.equal(payload.integrations.ozonetel.token_generation.limit, 10);
    assert.equal(payload.integrations.picky_assist.push_url, 'https://pickyassist.com/app/api/v2/push');
    assert.equal(payload.integrations.picky_assist.push_rate.limit, 90);
    for (const credential of credentials) assert.doesNotMatch(text, new RegExp(credential));
    assert.doesNotMatch(text, /private-password|private-webhook-secret/);
  });
});

test('the four POST routes forward only their documented fields and return exact HTTP semantics', async () => {
  const calls = [];
  const clients = fakeClients({
    ozonetelClient: {
      fetchCdrByPagination: async input => { calls.push(['cdr', input]); return { totalCount: 0, details: [] }; },
      agentManualDial: async input => { calls.push(['dial', input]); return { accepted: true, provider_status: 'queued successfully' }; },
    },
    pickyAssistClient: {
      sendSessionMessage: async input => { calls.push(['session', input]); return { accepted: true, delivered: false }; },
      sendApprovedTemplateMessage: async input => { calls.push(['template', input]); return { accepted: true, delivered: false }; },
    },
  });

  await withRouter(clients, async baseUrl => {
    const cdrInput = {
      fromDate: '2026-08-30 00:00:00',
      toDate: '2026-08-30 11:59:59',
      pageNo: 1,
      pageSize: 100,
      status: 'Answered',
    };
    const cdr = await postJson(baseUrl, '/ozonetel/cdr', cdrInput);
    assert.equal(cdr.response.status, 200);
    assert.deepEqual(cdr.payload, { ok: true, data: { totalCount: 0, details: [] } });

    const dialInput = {
      agentID: 'agent-1',
      campaignName: 'Manual Sales',
      customerNumber: '+919876543210',
      preflight: { verifiedAt: new Date(NOW).toISOString() },
      confirmation: OZONETEL_MANUAL_DIAL_CONFIRMATION,
      idempotencyKey: 'dial:record-1234:attempt-1',
    };
    const dial = await postJson(baseUrl, '/ozonetel/dial', dialInput);
    assert.equal(dial.response.status, 202);
    assert.equal(dial.payload.data.provider_status, 'queued successfully');

    const sessionInput = {
      number: '919876543210',
      message: 'Service update',
      sessionOpenedAt: new Date(NOW - 60_000).toISOString(),
      confirmation: PICKY_ASSIST_MESSAGE_CONFIRMATION,
      idempotencyKey: 'message:record-1234:attempt-1',
    };
    const session = await postJson(baseUrl, '/picky/session', sessionInput);
    assert.equal(session.response.status, 202);
    assert.equal(session.payload.data.delivered, false);

    const templateInput = {
      number: '919876543210',
      templateId: 'VG7935',
      language: 'en',
      templateMessage: ['ORDER-123'],
      templateStatus: 3,
      templateStatusCheckedAt: new Date(NOW - 60_000).toISOString(),
      confirmation: PICKY_ASSIST_MESSAGE_CONFIRMATION,
      idempotencyKey: 'message:record-1234:template-1',
    };
    const template = await postJson(baseUrl, '/picky/template', templateInput);
    assert.equal(template.response.status, 202);
    assert.equal(template.payload.data.delivered, false);

    assert.deepEqual(calls, [
      ['cdr', cdrInput],
      ['dial', dialInput],
      ['session', sessionInput],
      ['template', templateInput],
    ]);

    const absentWebhook = await fetch(`${baseUrl}/webhook`, { method: 'POST' });
    assert.equal(absentWebhook.status, 404);
  });
});

test('unsupported fields, malformed JSON, and bodies above 32 KiB fail before a client method', async () => {
  let calls = 0;
  const clients = fakeClients({
    ozonetelClient: { fetchCdrByPagination: async () => { calls += 1; return {}; } },
    pickyAssistClient: { sendSessionMessage: async () => { calls += 1; return {}; } },
  });

  await withRouter(clients, async baseUrl => {
    const unsupported = await postJson(baseUrl, '/ozonetel/cdr', {
      fromDate: '2026-08-30 00:00:00',
      toDate: '2026-08-30 11:59:59',
      apiKey: 'must-not-be-accepted',
    });
    assert.equal(unsupported.response.status, 400);
    assert.equal(unsupported.payload.error.code, 'UNSUPPORTED_FIELDS');

    const malformedResponse = await fetch(`${baseUrl}/picky/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"number":',
    });
    const malformed = await malformedResponse.json();
    assert.equal(malformedResponse.status, 400);
    assert.equal(malformed.error.code, 'INVALID_JSON');

    const oversizedResponse = await fetch(`${baseUrl}/picky/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'x'.repeat(INTEGRATION_BODY_LIMIT_BYTES + 1) }),
    });
    const oversized = await oversizedResponse.json();
    assert.equal(oversizedResponse.status, 413);
    assert.equal(oversized.error.code, 'PAYLOAD_TOO_LARGE');
    assert.equal(calls, 0);
  });
});

test('parsed-body guard rejects more than 32 KiB behind a 2 MB global JSON parser', async () => {
  let calls = 0;
  const clients = fakeClients({
    pickyAssistClient: { sendSessionMessage: async () => { calls += 1; return {}; } },
  });

  await withRouter(clients, async baseUrl => {
    const oversizedResponse = await fetch(`${baseUrl}/picky/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        number: '919876543210',
        message: 'x'.repeat(INTEGRATION_BODY_LIMIT_BYTES + 1),
        sessionOpenedAt: new Date(NOW - 60_000).toISOString(),
        confirmation: PICKY_ASSIST_MESSAGE_CONFIRMATION,
        idempotencyKey: 'message:record-1234:oversized-1',
      }),
    });
    const oversized = await oversizedResponse.json();
    assert.equal(oversizedResponse.status, 413);
    assert.deepEqual(oversized, {
      ok: false,
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds 32 KiB.' },
    });
    assert.equal(calls, 0);
  }, { parseGlobally: true, stripContentLengthAfterParse: true });
});

test('router preserves actual client outbound gates without any provider transport call', async () => {
  let providerCalls = 0;
  const fetchImpl = async () => {
    providerCalls += 1;
    throw new Error('Provider transport must not run in this test.');
  };
  const clients = {
    ozonetelClient: createOzonetelClient({
      apiKey: 'ozonetel-api-key-placeholder',
      userName: 'cloudagent-user',
      reportingTimeZoneOffsetMinutes: 330,
      outboundCallsEnabled: false,
      now: () => NOW,
      fetchImpl,
    }),
    pickyAssistClient: createPickyAssistClient({
      apiToken: 'picky-api-token-placeholder-long',
      application: 101,
      projectId: 'project-placeholder',
      outboundMessagesEnabled: false,
      now: () => NOW,
      fetchImpl,
    }),
  };

  await withRouter(clients, async baseUrl => {
    const dial = await postJson(baseUrl, '/ozonetel/dial', {
      agentID: 'agent-1',
      campaignName: 'Manual Sales',
      customerNumber: '+919876543210',
      preflight: {
        agentLoggedIn: true,
        agentAvailable: true,
        agentMode: 'manual',
        campaignRunning: true,
        manualDialEnabled: true,
        holidayBlocked: false,
        verifiedAt: new Date(NOW).toISOString(),
      },
      confirmation: OZONETEL_MANUAL_DIAL_CONFIRMATION,
      idempotencyKey: 'dial:record-1234:attempt-1',
    });
    assert.equal(dial.response.status, 403);
    assert.equal(dial.payload.error.code, 'OUTBOUND_DISABLED');

    const session = await postJson(baseUrl, '/picky/session', {
      number: '919876543210',
      message: 'Service update',
      sessionOpenedAt: new Date(NOW - 60_000).toISOString(),
      confirmation: PICKY_ASSIST_MESSAGE_CONFIRMATION,
      idempotencyKey: 'message:record-1234:attempt-1',
    });
    assert.equal(session.response.status, 403);
    assert.equal(session.payload.error.code, 'OUTBOUND_DISABLED');

    const template = await postJson(baseUrl, '/picky/template', {
      number: '919876543210',
      templateId: 'VG7935',
      language: 'en',
      templateMessage: ['ORDER-123'],
      templateStatus: 3,
      templateStatusCheckedAt: new Date(NOW - 60_000).toISOString(),
      confirmation: PICKY_ASSIST_MESSAGE_CONFIRMATION,
      idempotencyKey: 'message:record-1234:template-1',
    });
    assert.equal(template.response.status, 403);
    assert.equal(template.payload.error.code, 'OUTBOUND_DISABLED');
    assert.equal(providerCalls, 0);
  });
});

test('structured client errors are sanitized and unknown errors are fully generic', async () => {
  const clients = fakeClients({
    ozonetelClient: {
      fetchCdrByPagination: async () => {
        throw new IntegrationError(
          'LOCAL_RATE_LIMITED',
          'token=raw-private-token apiKey=raw-private-key request refused',
          { statusCode: 429, retryAfterMs: 1500 },
        );
      },
      agentManualDial: async () => { throw new Error('credential value raw-unlabelled-secret'); },
    },
  });

  await withRouter(clients, async baseUrl => {
    const limited = await postJson(baseUrl, '/ozonetel/cdr', {
      fromDate: '2026-08-30 00:00:00',
      toDate: '2026-08-30 11:59:59',
    });
    const limitedText = JSON.stringify(limited.payload);
    assert.equal(limited.response.status, 429);
    assert.equal(limited.response.headers.get('retry-after'), '2');
    assert.equal(limited.payload.error.code, 'LOCAL_RATE_LIMITED');
    assert.equal(limited.payload.error.retry_after_ms, 1500);
    assert.doesNotMatch(limitedText, /raw-private-token|raw-private-key/);

    const unknown = await postJson(baseUrl, '/ozonetel/dial', {
      agentID: 'agent-1',
      campaignName: 'Manual Sales',
      customerNumber: '+919876543210',
      confirmation: OZONETEL_MANUAL_DIAL_CONFIRMATION,
      idempotencyKey: 'dial:record-1234:attempt-1',
    });
    assert.equal(unknown.response.status, 500);
    assert.deepEqual(unknown.payload, {
      ok: false,
      error: { code: 'INTERNAL_INTEGRATION_ERROR', message: 'Integration request failed.' },
    });
    assert.doesNotMatch(JSON.stringify(unknown.payload), /raw-unlabelled-secret/);
  });
});

test('router factory rejects incomplete injected clients at construction time', () => {
  assert.throws(() => createIntegrationRouter({
    ozonetelClient: {},
    pickyAssistClient: fakeClients().pickyAssistClient,
  }), /Ozonetel client must implement status/);
});
