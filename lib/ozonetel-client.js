'use strict';

const https = require('node:https');
const {
  DEFAULT_MAX_RESPONSE_BYTES,
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

const OZONETEL_DOMESTIC_ORIGIN = 'https://in1-ccaas-api.ozonetel.com';
const OZONETEL_PATHS = Object.freeze({
  token: '/ca_apis/CAToken/generateToken',
  cdr: '/ca_reports/fetchCdrByPagination',
  manualDial: '/ca_apis/AgentManualDial',
});
const OZONETEL_ALLOWED_PATHS = Object.freeze(Object.values(OZONETEL_PATHS));
const OZONETEL_MANUAL_DIAL_CONFIRMATION = 'CONFIRM_OZONETEL_AGENT_MANUAL_DIAL';
const WEBHOOK_HEADER = 'x-magppie-webhook-secret';
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

function allowedUrl(pathname, query = null) {
  return buildAllowlistedUrl({
    origin: OZONETEL_DOMESTIC_ORIGIN,
    pathname,
    allowedOrigin: OZONETEL_DOMESTIC_ORIGIN,
    allowedPaths: OZONETEL_ALLOWED_PATHS,
    query,
  });
}

function requireCredentials({ apiKey, userName }) {
  return {
    apiKey: requireString(apiKey, 'OZONETEL_API_KEY', { min: 8, max: 512, trim: false }),
    userName: requireString(userName, 'OZONETEL_USERNAME', { min: 1, max: 200 }),
  };
}

function parseCdrTimestamp(value, name, timeZoneOffsetMinutes = 0) {
  const normalized = requireString(value, name, { min: 19, max: 19 });
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(normalized);
  if (!match) throw new IntegrationError('INVALID_CDR_DATE', `${name} must use YYYY-MM-DD HH:mm:ss.`);
  const parts = match.slice(1).map(Number);
  const [year, month, day, hour, minute, second] = parts;
  const wallClockEpoch = Date.UTC(year, month - 1, day, hour, minute, second);
  const parsed = new Date(wallClockEpoch);
  if (
    parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day ||
    parsed.getUTCHours() !== hour || parsed.getUTCMinutes() !== minute || parsed.getUTCSeconds() !== second
  ) {
    throw new IntegrationError('INVALID_CDR_DATE', `${name} is not a real calendar timestamp.`);
  }
  return {
    value: normalized,
    epoch: wallClockEpoch - timeZoneOffsetMinutes * MINUTE_MS,
    date: normalized.slice(0, 10),
    dayEpoch: Date.UTC(year, month - 1, day),
  };
}

function validateCdrWindow({ fromDate, toDate }, now = () => Date.now(), timeZoneOffsetMinutes = 0) {
  requireInteger(timeZoneOffsetMinutes, 'reportingTimeZoneOffsetMinutes', { min: -720, max: 840 });
  const from = parseCdrTimestamp(fromDate, 'fromDate', timeZoneOffsetMinutes);
  const to = parseCdrTimestamp(toDate, 'toDate', timeZoneOffsetMinutes);
  if (from.date !== to.date) throw new IntegrationError('INVALID_CDR_DATE_RANGE', 'fromDate and toDate must be on the same calendar day.');
  if (from.epoch > to.epoch) throw new IntegrationError('INVALID_CDR_DATE_RANGE', 'fromDate must not be later than toDate.');
  const current = now();
  if (to.epoch > current) throw new IntegrationError('INVALID_CDR_DATE_RANGE', 'CDR dates must not be in the future.');
  const today = new Date(current + timeZoneOffsetMinutes * MINUTE_MS);
  const todayEpoch = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const ageMs = todayEpoch - from.dayEpoch;
  if (ageMs < 0 || ageMs >= 15 * DAY_MS) {
    throw new IntegrationError('INVALID_CDR_DATE_RANGE', 'CDR dates must be within the past 15 calendar days.');
  }
  return { fromDate: from.value, toDate: to.value };
}

function optionalFilter(value, name, max = 160) {
  if (value === undefined || value === null || value === '') return null;
  return requireString(value, name, { min: 1, max });
}

function validateOzonetelCustomerNumber(value) {
  return requireString(value, 'customerNumber', {
    min: 5,
    max: 16,
    pattern: /^\+?[1-9]\d{4,14}$/,
  });
}

function validateManualDialPreflight(preflight, now) {
  if (!preflight || typeof preflight !== 'object' || Array.isArray(preflight)) {
    throw new IntegrationError('PREFLIGHT_REQUIRED', 'A recent AgentManualDial preflight is required.', { statusCode: 412 });
  }
  if (preflight.agentLoggedIn !== true || preflight.agentAvailable !== true) {
    throw new IntegrationError('AGENT_NOT_READY', 'The agent must be logged in and available.', { statusCode: 412 });
  }
  if (!['manual', 'blended'].includes(preflight.agentMode)) {
    throw new IntegrationError('AGENT_NOT_READY', 'The agent mode must be manual or blended.', { statusCode: 412 });
  }
  if (preflight.campaignRunning !== true || preflight.manualDialEnabled !== true) {
    throw new IntegrationError('CAMPAIGN_NOT_READY', 'The campaign must be running with manual dial enabled.', { statusCode: 412 });
  }
  if (preflight.holidayBlocked !== false) {
    throw new IntegrationError('HOLIDAY_BLOCKED', 'Manual dial is blocked until the holiday check is clear.', { statusCode: 412 });
  }
  validateRecentAssertion(preflight.verifiedAt, 'preflight.verifiedAt', { now, maxAgeMs: 2 * MINUTE_MS });
}

function defaultCdrRequest({ url, method, headers, body, maxBytes = DEFAULT_MAX_RESPONSE_BYTES }) {
  if (!(url instanceof URL) || url.origin !== OZONETEL_DOMESTIC_ORIGIN || url.pathname !== OZONETEL_PATHS.cdr) {
    return Promise.reject(new IntegrationError('DESTINATION_NOT_ALLOWED', 'Ozonetel CDR destination is not allowlisted.', { statusCode: 500 }));
  }
  const bodyText = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method,
      headers: {
        ...headers,
        'Content-Length': Buffer.byteLength(bodyText),
      },
      timeout: 15_000,
    }, response => {
      const chunks = [];
      let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          request.destroy(new IntegrationError('RESPONSE_TOO_LARGE', 'Ozonetel CDR response exceeded the local size limit.', { statusCode: 502 }));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        let payload;
        try {
          payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          reject(new IntegrationError('INVALID_JSON_RESPONSE', 'Ozonetel CDR response was not valid JSON.', { statusCode: 502 }));
          return;
        }
        if ((response.statusCode || 500) < 200 || (response.statusCode || 500) >= 300) {
          reject(new IntegrationError('PROVIDER_HTTP_ERROR', `Ozonetel returned HTTP ${response.statusCode || 500}.`, { statusCode: 502 }));
          return;
        }
        resolve(payload);
      });
    });
    request.on('timeout', () => request.destroy(new Error('Ozonetel CDR request timed out.')));
    request.on('error', reject);
    request.end(bodyText);
  });
}

function createOzonetelClient({
  apiKey = '',
  userName = '',
  reportingTimeZoneOffsetMinutes = null,
  outboundCallsEnabled = false,
  webhookSecret = '',
  fetchImpl = globalThis.fetch,
  cdrRequestImpl = defaultCdrRequest,
  requestTimeoutMs = DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS,
  abortControllerFactory,
  setTimeoutImpl,
  clearTimeoutImpl,
  now = () => Date.now(),
} = {}) {
  if (typeof now !== 'function') throw new TypeError('now must be a function.');
  const tokenLimiter = createSlidingWindowRateLimiter({ limit: 10, windowMs: 60 * MINUTE_MS, now, label: 'Ozonetel token' });
  const cdrLimiter = createSlidingWindowRateLimiter({ limit: 2, windowMs: MINUTE_MS, now, label: 'Ozonetel CDR' });
  const usedDialKeys = new Set();
  let cachedToken = null;
  let tokenExpiresAt = 0;
  let tokenInFlight = null;

  async function getToken({ forceRefresh = false } = {}) {
    const credentials = requireCredentials({ apiKey, userName });
    if (!forceRefresh && cachedToken && now() < tokenExpiresAt) return cachedToken;
    if (tokenInFlight) return tokenInFlight;

    tokenInFlight = (async () => {
      tokenLimiter.consume();
      const url = allowedUrl(OZONETEL_PATHS.token);
      const payload = await fetchJson({
        fetchImpl,
        url,
        options: {
          method: 'POST',
          redirect: 'error',
          headers: { 'Content-Type': 'application/json', apiKey: credentials.apiKey },
          body: JSON.stringify({ userName: credentials.userName }),
        },
        secrets: [credentials.apiKey],
        label: 'Ozonetel token',
        timeoutMs: requestTimeoutMs,
        abortControllerFactory,
        setTimeoutImpl,
        clearTimeoutImpl,
      });
      if (!payload || typeof payload !== 'object' || typeof payload.token !== 'string') {
        throw new IntegrationError(
          'PROVIDER_REJECTED',
          'Ozonetel token request was rejected.',
          { statusCode: 502 },
        );
      }
      cachedToken = requireString(payload.token, 'Ozonetel token', { min: 16, max: 8192, trim: false });
      tokenExpiresAt = now() + 55 * MINUTE_MS;
      return cachedToken;
    })().finally(() => { tokenInFlight = null; });

    return tokenInFlight;
  }

  async function fetchCdrByPagination({
    fromDate,
    toDate,
    pageNo = 1,
    pageSize = 100,
    ucid,
    campaignName,
    monitorUCID,
    callType,
    status: callStatus,
  } = {}) {
    const credentials = requireCredentials({ apiKey, userName });
    const reportingOffset = requireInteger(reportingTimeZoneOffsetMinutes, 'OZONETEL_REPORTING_TIMEZONE_OFFSET_MINUTES', { min: -720, max: 840 });
    const dates = validateCdrWindow({ fromDate, toDate }, now, reportingOffset);
    const page = requireInteger(pageNo, 'pageNo', { min: 1, max: Number.MAX_SAFE_INTEGER });
    const size = requireInteger(pageSize, 'pageSize', { min: 1, max: 500 });
    const body = { ...dates, userName: credentials.userName };
    const filters = {
      ucid: optionalFilter(ucid, 'ucid'),
      campaignName: optionalFilter(campaignName, 'campaignName'),
      monitorUCID: optionalFilter(monitorUCID, 'monitorUCID'),
      callType: optionalFilter(callType, 'callType'),
      status: optionalFilter(callStatus, 'status'),
    };
    for (const [key, value] of Object.entries(filters)) if (value !== null) body[key] = value;

    const token = await getToken();
    cdrLimiter.consume();
    const url = allowedUrl(OZONETEL_PATHS.cdr, { pageNo: page, pageSize: size });
    let payload;
    try {
      payload = await cdrRequestImpl({
        url,
        method: 'GET',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body,
        maxBytes: DEFAULT_MAX_RESPONSE_BYTES,
      });
    } catch (error) {
      if (error instanceof IntegrationError) throw error;
      throw new IntegrationError('TRANSPORT_ERROR', 'Ozonetel CDR request failed.', {
        statusCode: 502,
      });
    }
    if (!payload || payload.status !== 'success' || !Array.isArray(payload.details) || !Number.isFinite(Number(payload.totalCount))) {
      throw new IntegrationError('PROVIDER_REJECTED', 'Ozonetel CDR request was rejected.', { statusCode: 502 });
    }
    return {
      details: payload.details,
      totalCount: Number(payload.totalCount),
      message: String(payload.message || ''),
      status: payload.status,
      recordings: payload.details.reduce((count, record) => count + (typeof record?.CallAudio === 'string' && record.CallAudio ? 1 : 0), 0),
    };
  }

  async function agentManualDial({
    agentID,
    campaignName,
    customerNumber,
    includeUcid = true,
    uui,
    preflight,
    confirmation,
    idempotencyKey,
    skipCustomerNumberValidation = false,
  } = {}) {
    const credentials = requireCredentials({ apiKey, userName });
    const normalizedAgentId = requireString(agentID, 'agentID', { min: 1, max: 160 });
    const normalizedCampaign = requireString(campaignName, 'campaignName', { min: 1, max: 160 });
    const normalizedNumber = validateOzonetelCustomerNumber(customerNumber);
    if (typeof includeUcid !== 'boolean') throw new IntegrationError('INVALID_INPUT', 'includeUcid must be boolean.');
    if (skipCustomerNumberValidation !== false) {
      throw new IntegrationError('UNSAFE_OPTION_REJECTED', 'skipCustomerNumberValidation cannot be enabled.', { statusCode: 403 });
    }
    validateManualDialPreflight(preflight, now);
    const key = requireOutboundAuthorization({
      enabled: outboundCallsEnabled,
      confirmation,
      expectedConfirmation: OZONETEL_MANUAL_DIAL_CONFIRMATION,
      idempotencyKey,
      usedKeys: usedDialKeys,
    });
    const body = {
      userName: credentials.userName,
      agentID: normalizedAgentId,
      campaignName: normalizedCampaign,
      customerNumber: normalizedNumber,
      UCID: includeUcid ? 'true' : 'false',
      skipCustomerNumberValidation: false,
    };
    const normalizedUui = optionalFilter(uui, 'uui', 512);
    if (normalizedUui !== null) body.uui = normalizedUui;

    const token = await getToken();
    const payload = await fetchJson({
      fetchImpl,
      url: allowedUrl(OZONETEL_PATHS.manualDial),
      options: {
        method: 'POST',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      },
      secrets: [credentials.apiKey, token],
      label: 'Ozonetel manual dial',
      timeoutMs: requestTimeoutMs,
      abortControllerFactory,
      setTimeoutImpl,
      clearTimeoutImpl,
    });
    if (!payload || String(payload.status || '').toLowerCase() !== 'queued successfully') {
      throw new IntegrationError('PROVIDER_REJECTED', 'Ozonetel manual dial was rejected.', { statusCode: 502 });
    }
    return {
      accepted: true,
      provider_status: payload.status,
      ucid: typeof payload.ucid === 'string' ? payload.ucid : null,
      idempotency_key: key,
    };
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
    const tokenStatus = tokenLimiter.status();
    const cdrStatus = cdrLimiter.status();
    return {
      provider: 'ozonetel',
      source_mode: 'read-only-by-default',
      base_url: OZONETEL_DOMESTIC_ORIGIN,
      allowed_paths: [...OZONETEL_ALLOWED_PATHS],
      api_key_configured: typeof apiKey === 'string' && apiKey.length >= 8,
      username_configured: typeof userName === 'string' && userName.trim().length > 0,
      reporting_timezone_offset_configured: Number.isSafeInteger(reportingTimeZoneOffsetMinutes),
      reporting_timezone_offset_minutes: Number.isSafeInteger(reportingTimeZoneOffsetMinutes) ? reportingTimeZoneOffsetMinutes : null,
      webhook_secret_configured: typeof webhookSecret === 'string' && webhookSecret.length >= 24,
      outbound_calls_enabled: outboundCallsEnabled === true,
      token_cached: Boolean(cachedToken && now() < tokenExpiresAt),
      token_cache_expires_at: cachedToken && tokenExpiresAt ? new Date(tokenExpiresAt).toISOString() : null,
      token_generation: { limit: tokenStatus.limit, window_minutes: 60, remaining: tokenStatus.remaining },
      cdr_reads: { limit: cdrStatus.limit, window_minutes: 1, remaining: cdrStatus.remaining, page_size_max: 500, lookback_days: 15 },
      call_audio_behavior: 'reference-only; never auto-fetched',
      manual_dial_confirmation: OZONETEL_MANUAL_DIAL_CONFIRMATION,
    };
  }

  return { agentManualDial, fetchCdrByPagination, getToken, status, validateInboundWebhook };
}

function createOzonetelClientFromEnv(env = process.env, overrides = {}) {
  const reportingOffset = /^-?\d+$/.test(env.OZONETEL_REPORTING_TIMEZONE_OFFSET_MINUTES || '')
    ? Number(env.OZONETEL_REPORTING_TIMEZONE_OFFSET_MINUTES)
    : null;
  return createOzonetelClient({
    apiKey: env.OZONETEL_API_KEY || '',
    userName: env.OZONETEL_USERNAME || '',
    reportingTimeZoneOffsetMinutes: reportingOffset,
    outboundCallsEnabled: strictBooleanFromEnv(env.OZONETEL_OUTBOUND_CALLS_ENABLED),
    webhookSecret: env.OZONETEL_WEBHOOK_SECRET || '',
    ...overrides,
  });
}

module.exports = {
  OZONETEL_ALLOWED_PATHS,
  OZONETEL_DOMESTIC_ORIGIN,
  OZONETEL_MANUAL_DIAL_CONFIRMATION,
  OZONETEL_PATHS,
  createOzonetelClient,
  createOzonetelClientFromEnv,
  validateCdrWindow,
  validateOzonetelCustomerNumber,
};
