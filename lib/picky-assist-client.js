'use strict';

const {
  DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS,
  IntegrationError,
  buildAllowlistedUrl,
  createSlidingWindowRateLimiter,
  fetchJson,
  parseAuthenticatedWebhook,
  requireInteger,
  requireOutboundAuthorization,
  requireString,
  strictBooleanFromEnv,
  validateRecentAssertion,
} = require('./integration-safety');

const PICKY_ASSIST_ORIGIN = 'https://pickyassist.com';
const PICKY_ASSIST_PUSH_PATH = '/app/api/v2/push';
const PICKY_ASSIST_ALLOWED_PATHS = Object.freeze([PICKY_ASSIST_PUSH_PATH]);
const PICKY_ASSIST_MESSAGE_CONFIRMATION = 'CONFIRM_PICKY_ASSIST_MESSAGE';
const WEBHOOK_HEADER = 'x-magppie-webhook-secret';
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

function pushUrl() {
  return buildAllowlistedUrl({
    origin: PICKY_ASSIST_ORIGIN,
    pathname: PICKY_ASSIST_PUSH_PATH,
    allowedOrigin: PICKY_ASSIST_ORIGIN,
    allowedPaths: PICKY_ASSIST_ALLOWED_PATHS,
  });
}

function validatePickyAssistNumber(value) {
  return requireString(value, 'number', {
    min: 5,
    max: 15,
    pattern: /^[1-9]\d{4,14}$/,
  });
}

function validateApplication(value) {
  return requireInteger(value, 'PICKY_ASSIST_APPLICATION_ID', { min: 1, max: 1_000_000_000 });
}

function validateTemplateValues(values) {
  if (values === undefined) return [];
  if (!Array.isArray(values) || values.length > 100) {
    throw new IntegrationError('INVALID_INPUT', 'templateMessage must be an array with at most 100 values.');
  }
  return values.map((value, index) => requireString(value, `templateMessage[${index}]`, {
    min: 1,
    max: 1024,
    allowLineBreaks: true,
  }));
}

function createPickyAssistClient({
  apiToken = '',
  application = null,
  projectId = '',
  outboundMessagesEnabled = false,
  webhookSecret = '',
  fetchImpl = globalThis.fetch,
  requestTimeoutMs = DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS,
  abortControllerFactory,
  setTimeoutImpl,
  clearTimeoutImpl,
  now = () => Date.now(),
} = {}) {
  if (typeof now !== 'function') throw new TypeError('now must be a function.');
  const sendLimiter = createSlidingWindowRateLimiter({ limit: 90, windowMs: MINUTE_MS, now, label: 'Picky Assist push' });
  const usedMessageKeys = new Set();

  function requireConfiguration() {
    return {
      token: requireString(apiToken, 'PICKY_ASSIST_API_TOKEN', { min: 16, max: 512, trim: false }),
      application: validateApplication(application),
    };
  }

  async function sendPayload({ payload, confirmation, idempotencyKey }) {
    const configuration = requireConfiguration();
    const key = requireOutboundAuthorization({
      enabled: outboundMessagesEnabled,
      confirmation,
      expectedConfirmation: PICKY_ASSIST_MESSAGE_CONFIRMATION,
      idempotencyKey,
      usedKeys: usedMessageKeys,
    });
    sendLimiter.consume();
    const actionPayload = {
      ...payload,
      data: payload.data.map(item => ({ ...item, reference_number: key })),
    };
    const response = await fetchJson({
      fetchImpl,
      url: pushUrl(),
      options: {
        method: 'POST',
        redirect: 'error',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: configuration.token,
          application: configuration.application,
          priority: 0,
          ...actionPayload,
        }),
      },
      secrets: [configuration.token],
      label: 'Picky Assist push',
      timeoutMs: requestTimeoutMs,
      abortControllerFactory,
      setTimeoutImpl,
      clearTimeoutImpl,
    });
    if (!response || Number(response.status) !== 100) {
      throw new IntegrationError(
        'PROVIDER_REJECTED',
        'Picky Assist push was rejected.',
        { statusCode: 502 },
      );
    }
    return {
      accepted: true,
      delivered: false,
      provider_status: 100,
      push_id: response.push_id === undefined ? null : String(response.push_id),
      message_ids: Array.isArray(response.data)
        ? response.data.map(item => item?.msg_id).filter(value => value !== undefined).map(String)
        : [],
      idempotency_key: key,
    };
  }

  async function sendSessionMessage({
    number,
    message,
    sessionOpenedAt,
    confirmation,
    idempotencyKey,
  } = {}) {
    const normalizedNumber = validatePickyAssistNumber(number);
    const normalizedMessage = requireString(message, 'message', { min: 1, max: 4096, trim: false, allowLineBreaks: true });
    validateRecentAssertion(sessionOpenedAt, 'sessionOpenedAt', { now, maxAgeMs: DAY_MS, futureSkewMs: 0 });
    return sendPayload({
      payload: {
        globalmessage: normalizedMessage,
        globalmedia: '',
        data: [{ number: normalizedNumber, message: '' }],
      },
      confirmation,
      idempotencyKey,
    });
  }

  async function sendApprovedTemplateMessage({
    number,
    templateId,
    language,
    templateMessage = [],
    templateStatus,
    templateStatusCheckedAt,
    confirmation,
    idempotencyKey,
  } = {}) {
    const normalizedNumber = validatePickyAssistNumber(number);
    const normalizedTemplateId = requireString(templateId, 'templateId', {
      min: 2,
      max: 100,
      pattern: /^[A-Za-z0-9_-]+$/,
    });
    const normalizedLanguage = requireString(language, 'language', {
      min: 2,
      max: 16,
      pattern: /^[A-Za-z]{2,3}(?:[_-][A-Za-z0-9]{2,8})?$/,
    });
    if (templateStatus !== 3) {
      throw new IntegrationError('TEMPLATE_NOT_APPROVED', 'Picky Assist template status must be 3 (Approved).', { statusCode: 412 });
    }
    validateRecentAssertion(templateStatusCheckedAt, 'templateStatusCheckedAt', { now, maxAgeMs: DAY_MS });
    const values = validateTemplateValues(templateMessage);
    return sendPayload({
      payload: {
        template_id: normalizedTemplateId,
        data: [{
          number: normalizedNumber,
          template_message: values,
          language: normalizedLanguage,
        }],
      },
      confirmation,
      idempotencyKey,
    });
  }

  function validateInboundWebhook({ headers, rawBody } = {}) {
    return parseAuthenticatedWebhook({
      configuredSecret: webhookSecret,
      headers,
      rawBody,
      headerName: WEBHOOK_HEADER,
    });
  }

  function status() {
    const rate = sendLimiter.status();
    return {
      provider: 'picky-assist',
      source_mode: 'read-only-by-default',
      push_url: `${PICKY_ASSIST_ORIGIN}${PICKY_ASSIST_PUSH_PATH}`,
      allowed_paths: [...PICKY_ASSIST_ALLOWED_PATHS],
      api_token_configured: typeof apiToken === 'string' && apiToken.length >= 16,
      application_configured: Number.isSafeInteger(application) && application > 0,
      project_id_configured: typeof projectId === 'string' && projectId.trim().length > 0,
      webhook_secret_configured: typeof webhookSecret === 'string' && webhookSecret.length >= 24,
      webhook_generation: 'V4 per project',
      outbound_messages_enabled: outboundMessagesEnabled === true,
      push_rate: { limit: rate.limit, window_minutes: 1, remaining: rate.remaining },
      session_requirement: 'verified inbound session opened within 24 hours',
      template_requirement: 'template status 3 (Approved), checked within 24 hours',
      delivery_semantics: 'status 100 means accepted for processing, not delivered',
      message_confirmation: PICKY_ASSIST_MESSAGE_CONFIRMATION,
    };
  }

  return { sendApprovedTemplateMessage, sendSessionMessage, status, validateInboundWebhook };
}

function createPickyAssistClientFromEnv(env = process.env, overrides = {}) {
  const applicationValue = /^\d+$/.test(env.PICKY_ASSIST_APPLICATION_ID || '')
    ? Number(env.PICKY_ASSIST_APPLICATION_ID)
    : null;
  return createPickyAssistClient({
    apiToken: env.PICKY_ASSIST_API_TOKEN || '',
    application: applicationValue,
    projectId: env.PICKY_ASSIST_PROJECT_ID || '',
    outboundMessagesEnabled: strictBooleanFromEnv(env.PICKY_ASSIST_OUTBOUND_MESSAGES_ENABLED),
    webhookSecret: env.PICKY_ASSIST_WEBHOOK_SECRET || '',
    ...overrides,
  });
}

module.exports = {
  PICKY_ASSIST_ALLOWED_PATHS,
  PICKY_ASSIST_MESSAGE_CONFIRMATION,
  PICKY_ASSIST_ORIGIN,
  PICKY_ASSIST_PUSH_PATH,
  createPickyAssistClient,
  createPickyAssistClientFromEnv,
  validatePickyAssistNumber,
};
