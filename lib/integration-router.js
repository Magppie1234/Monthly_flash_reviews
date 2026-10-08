'use strict';

const express = require('express');
const { IntegrationError, sanitizeMessage } = require('./integration-safety');
const { createOzonetelClientFromEnv } = require('./ozonetel-client');
const { createPickyAssistClientFromEnv } = require('./picky-assist-client');

const INTEGRATION_BODY_LIMIT_BYTES = 32 * 1024;

const ROUTE_FIELDS = Object.freeze({
  cdr: Object.freeze(['fromDate', 'toDate', 'pageNo', 'pageSize', 'ucid', 'campaignName', 'monitorUCID', 'callType', 'status']),
  dial: Object.freeze([
    'agentID',
    'campaignName',
    'customerNumber',
    'includeUcid',
    'uui',
    'preflight',
    'confirmation',
    'idempotencyKey',
    'skipCustomerNumberValidation',
  ]),
  session: Object.freeze(['number', 'message', 'sessionOpenedAt', 'confirmation', 'idempotencyKey']),
  template: Object.freeze([
    'number',
    'templateId',
    'language',
    'templateMessage',
    'templateStatus',
    'templateStatusCheckedAt',
    'confirmation',
    'idempotencyKey',
  ]),
});

function assertClient(client, name, methods) {
  if (!client || typeof client !== 'object') throw new TypeError(`${name} client is required.`);
  for (const method of methods) {
    if (typeof client[method] !== 'function') throw new TypeError(`${name} client must implement ${method}().`);
  }
}

function validatedBody(body, allowedFields) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.getPrototypeOf(body) !== Object.prototype) {
    throw new IntegrationError('INVALID_REQUEST', 'Request body must be a JSON object.');
  }
  const allowed = new Set(allowedFields);
  if (Object.keys(body).some(key => !allowed.has(key))) {
    throw new IntegrationError('UNSUPPORTED_FIELDS', 'Request contains unsupported fields.');
  }
  return body;
}

function safeStringArray(value) {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string').slice(0, 20) : [];
}

function publicOzonetelStatus(status = {}) {
  return {
    provider: status.provider,
    source_mode: status.source_mode,
    base_url: status.base_url,
    allowed_paths: safeStringArray(status.allowed_paths),
    api_key_configured: status.api_key_configured === true,
    username_configured: status.username_configured === true,
    reporting_timezone_offset_configured: status.reporting_timezone_offset_configured === true,
    reporting_timezone_offset_minutes: Number.isSafeInteger(status.reporting_timezone_offset_minutes)
      ? status.reporting_timezone_offset_minutes
      : null,
    webhook_secret_configured: status.webhook_secret_configured === true,
    outbound_calls_enabled: status.outbound_calls_enabled === true,
    token_cached: status.token_cached === true,
    token_cache_expires_at: typeof status.token_cache_expires_at === 'string' ? status.token_cache_expires_at : null,
    token_generation: {
      limit: Number.isSafeInteger(status.token_generation?.limit) ? status.token_generation.limit : null,
      window_minutes: Number.isFinite(status.token_generation?.window_minutes) ? status.token_generation.window_minutes : null,
      remaining: Number.isSafeInteger(status.token_generation?.remaining) ? status.token_generation.remaining : null,
    },
    cdr_reads: {
      limit: Number.isSafeInteger(status.cdr_reads?.limit) ? status.cdr_reads.limit : null,
      window_minutes: Number.isFinite(status.cdr_reads?.window_minutes) ? status.cdr_reads.window_minutes : null,
      remaining: Number.isSafeInteger(status.cdr_reads?.remaining) ? status.cdr_reads.remaining : null,
      page_size_max: Number.isSafeInteger(status.cdr_reads?.page_size_max) ? status.cdr_reads.page_size_max : null,
      lookback_days: Number.isSafeInteger(status.cdr_reads?.lookback_days) ? status.cdr_reads.lookback_days : null,
    },
    call_audio_behavior: status.call_audio_behavior,
    manual_dial_confirmation: status.manual_dial_confirmation,
  };
}

function publicPickyAssistStatus(status = {}) {
  return {
    provider: status.provider,
    source_mode: status.source_mode,
    push_url: status.push_url,
    allowed_paths: safeStringArray(status.allowed_paths),
    api_token_configured: status.api_token_configured === true,
    application_configured: status.application_configured === true,
    project_id_configured: status.project_id_configured === true,
    webhook_secret_configured: status.webhook_secret_configured === true,
    webhook_generation: status.webhook_generation,
    outbound_messages_enabled: status.outbound_messages_enabled === true,
    push_rate: {
      limit: Number.isSafeInteger(status.push_rate?.limit) ? status.push_rate.limit : null,
      window_minutes: Number.isFinite(status.push_rate?.window_minutes) ? status.push_rate.window_minutes : null,
      remaining: Number.isSafeInteger(status.push_rate?.remaining) ? status.push_rate.remaining : null,
    },
    session_requirement: status.session_requirement,
    template_requirement: status.template_requirement,
    delivery_semantics: status.delivery_semantics,
    message_confirmation: status.message_confirmation,
  };
}

function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response)).catch(next);
}

function payloadTooLargeError() {
  return new IntegrationError('PAYLOAD_TOO_LARGE', 'Request body exceeds 32 KiB.', { statusCode: 413 });
}

function rejectDeclaredOversize(request, response, next) {
  const contentLength = request.get('content-length');
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > INTEGRATION_BODY_LIMIT_BYTES) {
    next(payloadTooLargeError());
    return;
  }
  next();
}

function rejectParsedOversize(request, response, next) {
  if (request.body === undefined) {
    next();
    return;
  }
  let serialized;
  try {
    serialized = JSON.stringify(request.body);
  } catch {
    next(new IntegrationError('INVALID_REQUEST', 'Request body must be serializable JSON.'));
    return;
  }
  if (Buffer.byteLength(serialized || '', 'utf8') > INTEGRATION_BODY_LIMIT_BYTES) {
    next(payloadTooLargeError());
    return;
  }
  next();
}

function integrationErrorResponse(error, response) {
  if (error?.type === 'entity.too.large') {
    response.status(413).json({ ok: false, error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds 32 KiB.' } });
    return;
  }
  if (error instanceof SyntaxError && error.status === 400 && Object.prototype.hasOwnProperty.call(error, 'body')) {
    response.status(400).json({ ok: false, error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } });
    return;
  }
  if (error instanceof IntegrationError) {
    const statusCode = Number.isSafeInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode <= 599
      ? error.statusCode
      : 500;
    const errorCode = typeof error.code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.code)
      ? error.code
      : 'INTEGRATION_ERROR';
    const body = {
      ok: false,
      error: {
        code: errorCode,
        message: sanitizeMessage(error, { fallback: 'Integration request failed.', max: 180 }),
      },
    };
    if (Number.isSafeInteger(error.retryAfterMs) && error.retryAfterMs > 0) {
      body.error.retry_after_ms = Math.min(error.retryAfterMs, 24 * 60 * 60 * 1000);
      response.set('Retry-After', String(Math.max(1, Math.ceil(body.error.retry_after_ms / 1000))));
    }
    response.status(statusCode).json(body);
    return;
  }
  response.status(500).json({
    ok: false,
    error: { code: 'INTERNAL_INTEGRATION_ERROR', message: 'Integration request failed.' },
  });
}

function createIntegrationRouter({
  ozonetelClient = createOzonetelClientFromEnv(),
  pickyAssistClient = createPickyAssistClientFromEnv(),
} = {}) {
  assertClient(ozonetelClient, 'Ozonetel', ['status', 'fetchCdrByPagination', 'agentManualDial']);
  assertClient(pickyAssistClient, 'Picky Assist', ['status', 'sendSessionMessage', 'sendApprovedTemplateMessage']);

  const router = express.Router();
  router.use((request, response, next) => {
    response.set('Cache-Control', 'no-store');
    response.set('X-Content-Type-Options', 'nosniff');
    next();
  });
  router.use(rejectDeclaredOversize);
  router.use(express.json({ limit: INTEGRATION_BODY_LIMIT_BYTES, strict: true, type: 'application/json' }));
  router.use(rejectParsedOversize);

  router.get('/status', asyncRoute(async (request, response) => {
    const [ozonetel, pickyAssist] = await Promise.all([
      Promise.resolve().then(() => ozonetelClient.status()),
      Promise.resolve().then(() => pickyAssistClient.status()),
    ]);
    response.status(200).json({
      ok: true,
      integrations: {
        ozonetel: publicOzonetelStatus(ozonetel),
        picky_assist: publicPickyAssistStatus(pickyAssist),
      },
    });
  }));

  router.post('/ozonetel/cdr', asyncRoute(async (request, response) => {
    const result = await ozonetelClient.fetchCdrByPagination(validatedBody(request.body, ROUTE_FIELDS.cdr));
    response.status(200).json({ ok: true, data: result });
  }));

  router.post('/ozonetel/dial', asyncRoute(async (request, response) => {
    const result = await ozonetelClient.agentManualDial(validatedBody(request.body, ROUTE_FIELDS.dial));
    response.status(202).json({ ok: true, data: result });
  }));

  router.post('/picky/session', asyncRoute(async (request, response) => {
    const result = await pickyAssistClient.sendSessionMessage(validatedBody(request.body, ROUTE_FIELDS.session));
    response.status(202).json({ ok: true, data: result });
  }));

  router.post('/picky/template', asyncRoute(async (request, response) => {
    const result = await pickyAssistClient.sendApprovedTemplateMessage(validatedBody(request.body, ROUTE_FIELDS.template));
    response.status(202).json({ ok: true, data: result });
  }));

  router.use((error, request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }
    integrationErrorResponse(error, response);
  });

  return router;
}

module.exports = {
  INTEGRATION_BODY_LIMIT_BYTES,
  ROUTE_FIELDS,
  createIntegrationRouter,
};
