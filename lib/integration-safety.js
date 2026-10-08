'use strict';

const crypto = require('node:crypto');

const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_MAX_WEBHOOK_BYTES = 256 * 1024;
const DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS = 15_000;
const MAX_PROVIDER_REQUEST_TIMEOUT_MS = 30_000;

class IntegrationError extends Error {
  constructor(code, message, { statusCode = 400, retryAfterMs = null } = {}) {
    super(String(message || 'Integration request failed.').slice(0, 240));
    this.name = 'IntegrationError';
    this.code = String(code || 'INTEGRATION_ERROR');
    this.statusCode = statusCode;
    this.retryAfterMs = retryAfterMs;
  }
}

function requireString(value, name, { min = 1, max = 200, pattern = null, trim = true, allowLineBreaks = false } = {}) {
  if (typeof value !== 'string') throw new IntegrationError('INVALID_INPUT', `${name} must be a string.`);
  const normalized = trim ? value.trim() : value;
  if (normalized.length < min || normalized.length > max) {
    throw new IntegrationError('INVALID_INPUT', `${name} must contain ${min}-${max} characters.`);
  }
  if (!trim && normalized.trim().length < min) throw new IntegrationError('INVALID_INPUT', `${name} must not be blank.`);
  const invalidControl = allowLineBreaks
    ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u
    : /\p{Cc}/u;
  if (invalidControl.test(normalized)) throw new IntegrationError('INVALID_INPUT', `${name} contains control characters.`);
  if (pattern && !pattern.test(normalized)) throw new IntegrationError('INVALID_INPUT', `${name} has an invalid format.`);
  return normalized;
}

function requireInteger(value, name, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new IntegrationError('INVALID_INPUT', `${name} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

function strictBooleanFromEnv(value) {
  return value === 'true';
}

function buildAllowlistedUrl({ origin, pathname, allowedOrigin, allowedPaths, query = null }) {
  if (origin !== allowedOrigin || !allowedPaths.includes(pathname)) {
    throw new IntegrationError('DESTINATION_NOT_ALLOWED', 'Integration destination is not allowlisted.', { statusCode: 500 });
  }
  const url = new URL(pathname, origin);
  if (url.origin !== allowedOrigin || url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) {
    throw new IntegrationError('DESTINATION_NOT_ALLOWED', 'Integration destination is not allowlisted.', { statusCode: 500 });
  }
  if (query) {
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
  }
  return url;
}

function sanitizeMessage(error, { secrets = [], fallback = 'Integration request failed.', max = 180 } = {}) {
  let message = String(error?.message || error || fallback).replace(/\s+/g, ' ').trim();
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length >= 4) message = message.split(secret).join('[REDACTED]');
  }
  message = message
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/ig, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|token|password|secret)\s*[:=]\s*)[^\s,;}&]+/ig, '$1[REDACTED]')
    .replace(/https:\/\/[^\s?#]+\?[^\s]+/ig, '[URL REDACTED]');
  return (message || fallback).slice(0, max);
}

function createSlidingWindowRateLimiter({ limit, windowMs, now = () => Date.now(), label = 'Integration' } = {}) {
  requireInteger(limit, 'limit', { min: 1, max: 100_000 });
  requireInteger(windowMs, 'windowMs', { min: 1000, max: 24 * 60 * 60 * 1000 });
  if (typeof now !== 'function') throw new TypeError('now must be a function.');
  let events = [];

  function prune(timestamp) {
    const cutoff = timestamp - windowMs;
    events = events.filter(event => event > cutoff);
  }

  function status() {
    const timestamp = now();
    prune(timestamp);
    const retryAfterMs = events.length >= limit ? Math.max(1, events[0] + windowMs - timestamp) : 0;
    return {
      limit,
      window_ms: windowMs,
      used: events.length,
      remaining: Math.max(0, limit - events.length),
      retry_after_ms: retryAfterMs,
    };
  }

  function consume() {
    const timestamp = now();
    prune(timestamp);
    if (events.length >= limit) {
      const retryAfterMs = Math.max(1, events[0] + windowMs - timestamp);
      throw new IntegrationError('LOCAL_RATE_LIMITED', `${label} local rate limit reached.`, {
        statusCode: 429,
        retryAfterMs,
      });
    }
    events.push(timestamp);
    return status();
  }

  return { consume, status };
}

function validateIdempotencyKey(value) {
  return requireString(value, 'idempotencyKey', {
    min: 16,
    max: 128,
    pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/,
  });
}

function requireOutboundAuthorization({ enabled, confirmation, expectedConfirmation, idempotencyKey, usedKeys }) {
  if (enabled !== true) {
    throw new IntegrationError('OUTBOUND_DISABLED', 'Outbound integration action is disabled.', { statusCode: 403 });
  }
  const expected = requireString(expectedConfirmation, 'expectedConfirmation', { min: 8, max: 100 });
  if (confirmation !== expected) {
    throw new IntegrationError('CONFIRMATION_REQUIRED', `Set confirmation to ${expected} for this action.`, { statusCode: 403 });
  }
  const key = validateIdempotencyKey(idempotencyKey);
  if (usedKeys.has(key)) {
    throw new IntegrationError('DUPLICATE_IDEMPOTENCY_KEY', 'This outbound idempotency key has already been used.', { statusCode: 409 });
  }
  if (usedKeys.size >= 10_000) {
    throw new IntegrationError('IDEMPOTENCY_CAPACITY_REACHED', 'Local idempotency capacity was reached; outbound actions are paused.', { statusCode: 503 });
  }
  usedKeys.add(key);
  return key;
}

function parseIsoTimestamp(value, name) {
  const normalized = requireString(value, name, { min: 20, max: 35 });
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(normalized)) {
    throw new IntegrationError('INVALID_INPUT', `${name} must be an ISO-8601 timestamp with a timezone.`);
  }
  const milliseconds = Date.parse(normalized);
  if (!Number.isFinite(milliseconds)) throw new IntegrationError('INVALID_INPUT', `${name} is not a valid timestamp.`);
  return milliseconds;
}

function validateRecentAssertion(value, name, { now = () => Date.now(), maxAgeMs, futureSkewMs = 60_000 } = {}) {
  const timestamp = parseIsoTimestamp(value, name);
  const current = now();
  if (timestamp > current + futureSkewMs || current - timestamp > maxAgeMs) {
    throw new IntegrationError('STALE_PREFLIGHT', `${name} is outside the allowed verification window.`, { statusCode: 412 });
  }
  return timestamp;
}

function parseJsonText(text, { maxBytes = DEFAULT_MAX_RESPONSE_BYTES, label = 'response' } = {}) {
  const source = String(text ?? '');
  if (Buffer.byteLength(source, 'utf8') > maxBytes) {
    throw new IntegrationError('RESPONSE_TOO_LARGE', `${label} exceeded the local size limit.`, { statusCode: 502 });
  }
  try {
    return JSON.parse(source);
  } catch {
    throw new IntegrationError('INVALID_JSON_RESPONSE', `${label} was not valid JSON.`, { statusCode: 502 });
  }
}

function isAbortError(error) {
  return error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
}

function cancelOversizeResponse(response, controller) {
  try {
    if (response?.body && typeof response.body.cancel === 'function') {
      const cancellation = response.body.cancel();
      if (cancellation && typeof cancellation.catch === 'function') cancellation.catch(() => {});
    }
  } catch {
    // The bounded local rejection remains authoritative even if cancellation fails.
  }
  try { controller.abort(); } catch { /* bounded local rejection remains authoritative */ }
}

async function readBoundedResponseText(response, { maxBytes, label, controller }) {
  const contentLength = Number(response?.headers?.get?.('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    cancelOversizeResponse(response, controller);
    throw new IntegrationError('RESPONSE_TOO_LARGE', `${label} response exceeded the local size limit.`, { statusCode: 502 });
  }

  if (response?.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = [];
    let totalBytes = 0;
    try {
      while (true) {
        const result = await reader.read();
        if (!result || typeof result.done !== 'boolean') {
          throw new IntegrationError('INVALID_RESPONSE_BODY', `${label} response body was invalid.`, { statusCode: 502 });
        }
        if (result.done) break;
        if (!(result.value instanceof Uint8Array)) {
          throw new IntegrationError('INVALID_RESPONSE_BODY', `${label} response body was invalid.`, { statusCode: 502 });
        }
        totalBytes += result.value.byteLength;
        if (totalBytes > maxBytes) {
          try {
            const cancellation = reader.cancel();
            if (cancellation && typeof cancellation.catch === 'function') cancellation.catch(() => {});
          } catch { /* bounded local rejection remains authoritative */ }
          try { controller.abort(); } catch { /* bounded local rejection remains authoritative */ }
          throw new IntegrationError('RESPONSE_TOO_LARGE', `${label} response exceeded the local size limit.`, { statusCode: 502 });
        }
        chunks.push(result.value);
      }
    } finally {
      try { reader.releaseLock(); } catch { /* no retained reader lock */ }
    }
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new IntegrationError('INVALID_RESPONSE_BODY', `${label} response body was invalid.`, { statusCode: 502 });
    }
  }

  throw new IntegrationError('INVALID_RESPONSE_BODY', `${label} response body was unavailable.`, { statusCode: 502 });
}

async function fetchJson({
  fetchImpl,
  url,
  options,
  secrets = [],
  maxBytes = DEFAULT_MAX_RESPONSE_BYTES,
  label = 'Provider',
  timeoutMs = DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS,
  abortControllerFactory = () => new AbortController(),
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
}) {
  if (typeof fetchImpl !== 'function') {
    throw new IntegrationError('TRANSPORT_NOT_CONFIGURED', `${label} HTTP transport is not configured.`, { statusCode: 503 });
  }
  requireInteger(maxBytes, 'maxBytes', { min: 1, max: DEFAULT_MAX_RESPONSE_BYTES });
  requireInteger(timeoutMs, 'timeoutMs', { min: 1, max: MAX_PROVIDER_REQUEST_TIMEOUT_MS });
  if (typeof abortControllerFactory !== 'function') throw new TypeError('abortControllerFactory must be a function.');
  if (typeof setTimeoutImpl !== 'function') throw new TypeError('setTimeoutImpl must be a function.');
  if (typeof clearTimeoutImpl !== 'function') throw new TypeError('clearTimeoutImpl must be a function.');

  const controller = abortControllerFactory();
  if (!controller || typeof controller.abort !== 'function' || !controller.signal || typeof controller.signal.aborted !== 'boolean') {
    throw new TypeError('abortControllerFactory must return an AbortController-compatible object.');
  }

  let timeoutHandle;
  let timeoutFired = false;
  const timeoutPromise = new Promise((resolve, reject) => {
    timeoutHandle = setTimeoutImpl(() => {
      timeoutFired = true;
      reject(new IntegrationError('TRANSPORT_TIMEOUT', `${label} request timed out.`, { statusCode: 504 }));
      try { controller.abort(); } catch { /* timeout rejection remains authoritative */ }
    }, timeoutMs);
  });

  function transportFailure(error, fallback) {
    if (timeoutFired) {
      return new IntegrationError('TRANSPORT_TIMEOUT', `${label} request timed out.`, { statusCode: 504 });
    }
    if (isAbortError(error)) {
      return new IntegrationError('TRANSPORT_ABORTED', `${label} request was aborted.`, { statusCode: 502 });
    }
    return new IntegrationError('TRANSPORT_ERROR', fallback, { statusCode: 502 });
  }

  const operationPromise = (async () => {
    let response;
    try {
      response = await fetchImpl(url, { ...(options || {}), signal: controller.signal });
    } catch (error) {
      throw transportFailure(error, `${label} request failed.`);
    }

    let text;
    try {
      text = await readBoundedResponseText(response, { maxBytes, label, controller });
    } catch (error) {
      if (error instanceof IntegrationError) throw error;
      throw transportFailure(error, `${label} response could not be read.`);
    }
    let payload;
    try {
      payload = parseJsonText(text, { maxBytes, label: `${label} response` });
    } catch (error) {
      if (!response.ok) {
        throw new IntegrationError('PROVIDER_HTTP_ERROR', `${label} returned HTTP ${response.status}.`, { statusCode: 502 });
      }
      throw error;
    }
    if (!response.ok) {
      throw new IntegrationError('PROVIDER_HTTP_ERROR', `${label} returned HTTP ${response.status}.`, { statusCode: 502 });
    }
    return payload;
  })();

  try {
    return await Promise.race([operationPromise, timeoutPromise]);
  } finally {
    clearTimeoutImpl(timeoutHandle);
  }
}

function readHeader(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return headers.get(name) || '';
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return Array.isArray(value) ? value[0] : value;
  }
  return '';
}

function verifyWebhookSecret({ configuredSecret, headers, headerName = 'x-magppie-webhook-secret' }) {
  if (typeof configuredSecret !== 'string' || configuredSecret.length < 24 || configuredSecret.length > 256) {
    throw new IntegrationError('WEBHOOK_SECRET_NOT_CONFIGURED', 'Webhook authentication is not configured.', { statusCode: 503 });
  }
  const expected = configuredSecret;
  const suppliedValue = readHeader(headers, headerName);
  if (typeof suppliedValue !== 'string' || suppliedValue.length === 0 || suppliedValue.length > 256) {
    throw new IntegrationError('WEBHOOK_UNAUTHORIZED', 'Webhook authentication failed.', { statusCode: 401 });
  }
  const supplied = Buffer.from(suppliedValue, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (supplied.length !== expectedBuffer.length || !crypto.timingSafeEqual(supplied, expectedBuffer)) {
    throw new IntegrationError('WEBHOOK_UNAUTHORIZED', 'Webhook authentication failed.', { statusCode: 401 });
  }
  return true;
}

function parseAuthenticatedWebhook({ configuredSecret, headers, rawBody, headerName, maxBytes = DEFAULT_MAX_WEBHOOK_BYTES }) {
  verifyWebhookSecret({ configuredSecret, headers, headerName });
  if (!(typeof rawBody === 'string' || Buffer.isBuffer(rawBody))) {
    throw new IntegrationError('INVALID_WEBHOOK', 'Webhook body must be raw JSON text or a Buffer.');
  }
  const payload = parseJsonText(rawBody, { maxBytes, label: 'Webhook body' });
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new IntegrationError('INVALID_WEBHOOK', 'Webhook body must be a JSON object.');
  }
  return payload;
}

module.exports = {
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_MAX_WEBHOOK_BYTES,
  DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS,
  MAX_PROVIDER_REQUEST_TIMEOUT_MS,
  IntegrationError,
  buildAllowlistedUrl,
  createSlidingWindowRateLimiter,
  fetchJson,
  parseAuthenticatedWebhook,
  parseIsoTimestamp,
  requireInteger,
  requireOutboundAuthorization,
  requireString,
  sanitizeMessage,
  strictBooleanFromEnv,
  validateIdempotencyKey,
  validateRecentAssertion,
  verifyWebhookSecret,
};
