'use strict';

const crypto = require('crypto');
const fs = require('fs');
const readline = require('readline');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const express = require('express');
const { createZohoOrgGuard, EXPECTED_ZOHO_ZGID } = require('./zoho-org-guard');

const EXPECTED_SOURCE_ORG = `org${EXPECTED_ZOHO_ZGID}`;
const ZOHO_API_ORIGIN = 'https://www.zohoapis.in';
const DEFAULT_MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
const HARD_MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
const DEFAULT_SOURCE_TIMEOUT_MS = 120_000;
const HARD_MAX_SOURCE_TIMEOUT_MS = 300_000;
const DEFAULT_ORG_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_MANIFEST_BYTES = 128 * 1024 * 1024;
const MAX_MANIFEST_ENTRIES = 100_000;
const MAX_MANIFEST_LINE_BYTES = 16 * 1024;
const DEFAULT_GLOBAL_STREAM_LIMIT = 2;
const DEFAULT_ACTOR_STREAM_LIMIT = 1;
const DEFAULT_GLOBAL_REQUEST_LIMIT = 120;
const DEFAULT_ACTOR_REQUEST_LIMIT = 30;
const DEFAULT_RATE_WINDOW_MS = 5 * 60 * 1000;
const ORG_RESPONSE_MAX_BYTES = 64 * 1024;

const MODULE_PATTERN = /^[A-Za-z][A-Za-z0-9_$]{0,79}$/;
const ZOHO_ID_PATTERN = /^\d{8,32}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9._~+/=-]{8,4096}$/;

class AttachmentAccessError extends Error {
  constructor(code, message, statusCode = 500, options = {}) {
    super(message, options);
    this.name = 'AttachmentAccessError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function fail(code, message, statusCode, options) {
  throw new AttachmentAccessError(code, message, statusCode, options);
}

function assertIntegerWithin(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value;
}

function assertZohoReadMethod(method) {
  const normalized = String(method || '').toUpperCase();
  if (!['GET', 'HEAD'].includes(normalized)) {
    fail('SOURCE_WRITE_BLOCKED', 'Zoho CRM source access is restricted to GET and HEAD.', 500);
  }
  return normalized;
}

function normalizeZohoOrigin(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ''));
  } catch {
    fail('SOURCE_ORIGIN_BLOCKED', 'The Zoho CRM API origin is not allowlisted.', 500);
  }
  if (
    parsed.origin !== ZOHO_API_ORIGIN
    || parsed.username
    || parsed.password
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash
  ) {
    fail('SOURCE_ORIGIN_BLOCKED', 'The Zoho CRM API origin is not allowlisted.', 500);
  }
  return parsed.origin;
}

function validateRouteIdentifiers(moduleName, recordId, attachmentId) {
  if (!MODULE_PATTERN.test(String(moduleName || ''))
    || !ZOHO_ID_PATTERN.test(String(recordId || ''))
    || !ZOHO_ID_PATTERN.test(String(attachmentId || ''))) {
    fail('ATTACHMENT_NOT_AVAILABLE', 'The requested attachment is not available.', 404);
  }
  return {
    module: String(moduleName),
    recordId: String(recordId),
    attachmentId: String(attachmentId),
  };
}

function isPrivateRegularFile(stat) {
  if (!stat.isFile() || stat.isSymbolicLink()) return false;
  if ((stat.mode & 0o077) !== 0) return false;
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) return false;
  return true;
}

function manifestRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    fail('ATTACHMENT_MANIFEST_INVALID', 'The private attachment manifest is invalid.', 503);
  }
  if (String(row.source_org_id || '') !== EXPECTED_SOURCE_ORG) {
    fail('ATTACHMENT_MANIFEST_SCOPE_MISMATCH', 'The private attachment manifest does not match the locked source organization.', 503);
  }
  const attachmentId = String(row.attachment_id || '');
  if (!ZOHO_ID_PATTERN.test(attachmentId)) {
    fail('ATTACHMENT_MANIFEST_INVALID', 'The private attachment manifest is invalid.', 503);
  }
  const quarantined = row.replication_status === 'quarantined'
    || (Array.isArray(row.quarantine_reasons) && row.quarantine_reasons.length > 0);
  if (quarantined) return { attachmentId, quarantined: true };

  const moduleName = String(row.parent_module || '');
  const recordId = String(row.parent_record_id || '');
  const fileName = String(row.file_name || '');
  const declaredSizeBytes = Number(row.declared_size_bytes);
  if (
    !MODULE_PATTERN.test(moduleName)
    || !ZOHO_ID_PATTERN.test(recordId)
    || !fileName
    || fileName.length > 1_024
    || /[\u0000-\u001f\u007f]/.test(fileName)
    || !Number.isSafeInteger(declaredSizeBytes)
    || declaredSizeBytes < 0
  ) {
    fail('ATTACHMENT_MANIFEST_INVALID', 'The private attachment manifest is invalid.', 503);
  }
  return {
    attachmentId,
    quarantined: false,
    value: Object.freeze({
      sourceOrgId: EXPECTED_SOURCE_ORG,
      module: moduleName,
      recordId,
      attachmentId,
      fileName,
      declaredSizeBytes,
    }),
  };
}

async function loadPrivateAttachmentAllowlist(manifestPath, options = {}) {
  if (typeof manifestPath !== 'string' || !manifestPath) {
    throw new TypeError('manifestPath is required.');
  }
  const maxManifestBytes = assertIntegerWithin(
    options.maxManifestBytes ?? MAX_MANIFEST_BYTES,
    'maxManifestBytes',
    1,
    MAX_MANIFEST_BYTES,
  );
  const maxEntries = assertIntegerWithin(
    options.maxEntries ?? MAX_MANIFEST_ENTRIES,
    'maxEntries',
    1,
    MAX_MANIFEST_ENTRIES,
  );
  const stat = await fs.promises.lstat(manifestPath).catch(() => null);
  if (!stat || !isPrivateRegularFile(stat)) {
    fail('ATTACHMENT_MANIFEST_NOT_PRIVATE', 'Attachment access requires an owner-only private regular-file manifest.', 503);
  }
  if (stat.size < 1 || stat.size > maxManifestBytes) {
    fail('ATTACHMENT_MANIFEST_SIZE_INVALID', 'The private attachment manifest is outside the reviewed size bound.', 503);
  }

  const rowsByAttachmentId = new Map();
  const seenAttachmentIds = new Set();
  let totalEntries = 0;
  let quarantinedEntries = 0;
  const input = fs.createReadStream(manifestPath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      totalEntries += 1;
      if (totalEntries > maxEntries || Buffer.byteLength(line, 'utf8') > MAX_MANIFEST_LINE_BYTES) {
        fail('ATTACHMENT_MANIFEST_SIZE_INVALID', 'The private attachment manifest is outside the reviewed entry bound.', 503);
      }
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        fail('ATTACHMENT_MANIFEST_INVALID', 'The private attachment manifest is invalid.', 503);
      }
      const normalized = manifestRow(parsed);
      if (seenAttachmentIds.has(normalized.attachmentId)) {
        fail('ATTACHMENT_MANIFEST_DUPLICATE', 'The private attachment manifest contains an ambiguous attachment identifier.', 503);
      }
      seenAttachmentIds.add(normalized.attachmentId);
      if (normalized.quarantined) {
        quarantinedEntries += 1;
        continue;
      }
      rowsByAttachmentId.set(normalized.attachmentId, normalized.value);
    }
  } finally {
    lines.close();
    input.destroy();
  }
  if (totalEntries === 0) {
    fail('ATTACHMENT_MANIFEST_INVALID', 'The private attachment manifest is empty.', 503);
  }

  function resolve(moduleName, recordId, attachmentId) {
    const requested = validateRouteIdentifiers(moduleName, recordId, attachmentId);
    const row = rowsByAttachmentId.get(requested.attachmentId);
    if (!row || row.module !== requested.module || row.recordId !== requested.recordId) {
      fail('ATTACHMENT_NOT_AVAILABLE', 'The requested attachment is not available.', 404);
    }
    return row;
  }

  return Object.freeze({
    resolve,
    status: Object.freeze({
      source_org_locked: true,
      total_entries: totalEntries,
      streamable_entries: rowsByAttachmentId.size,
      quarantined_entries: quarantinedEntries,
    }),
  });
}

function toNodeReadable(body) {
  if (!body) fail('SOURCE_BODY_UNAVAILABLE', 'The attachment source did not return a stream.', 502);
  if (typeof body.getReader === 'function') return Readable.fromWeb(body);
  if (typeof body.on === 'function' && typeof body[Symbol.asyncIterator] === 'function') return body;
  fail('SOURCE_BODY_UNAVAILABLE', 'The attachment source did not return a supported stream.', 502);
}

async function readBodyBounded(response, maximumBytes) {
  const body = toNodeReadable(response.body);
  const chunks = [];
  let size = 0;
  for await (const chunk of body) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > maximumBytes) {
      body.destroy();
      fail('SOURCE_RESPONSE_INVALID', 'The Zoho CRM source response exceeded its reviewed bound.', 502);
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, size);
}

function safeAccessToken(value) {
  const token = String(value || '');
  if (!TOKEN_PATTERN.test(token)) {
    fail('SOURCE_AUTH_UNAVAILABLE', 'Zoho CRM attachment authorization is unavailable.', 503);
  }
  return token;
}

function tokenFingerprint(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function exactContentLength(response, expectedBytes, maximumBytes) {
  const encoding = String(response.headers.get('content-encoding') || '').toLowerCase();
  if (encoding && encoding !== 'identity') {
    fail('SOURCE_LENGTH_UNVERIFIED', 'The attachment source returned an unsupported content encoding.', 502);
  }
  const header = response.headers.get('content-length');
  if (!header || !/^\d+$/.test(header)) {
    fail('SOURCE_LENGTH_UNVERIFIED', 'The attachment source did not provide a verifiable content length.', 502);
  }
  const contentLength = Number(header);
  if (!Number.isSafeInteger(contentLength) || contentLength > maximumBytes || contentLength !== expectedBytes) {
    fail('SOURCE_LENGTH_MISMATCH', 'The attachment source length does not match the private metadata manifest.', 502);
  }
  return contentLength;
}

function exactLengthReadable(body, expectedBytes, controller, timeoutState, clearTimer) {
  const source = toNodeReadable(body);
  async function* bounded() {
    let seen = 0;
    let complete = false;
    try {
      for await (const chunk of source) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (seen + bytes.length > expectedBytes) {
          fail('SOURCE_STREAM_OVERRUN', 'The attachment source exceeded its verified content length.', 502);
        }
        seen += bytes.length;
        yield bytes;
      }
      if (seen !== expectedBytes) {
        fail('SOURCE_STREAM_TRUNCATED', 'The attachment source ended before its verified content length.', 502);
      }
      complete = true;
    } catch (error) {
      if (error instanceof AttachmentAccessError) throw error;
      if (timeoutState.fired) {
        throw new AttachmentAccessError('SOURCE_TIMEOUT', 'The Zoho CRM attachment request timed out.', 504);
      }
      throw new AttachmentAccessError('SOURCE_STREAM_FAILED', 'The Zoho CRM attachment stream failed.', 502);
    } finally {
      clearTimer();
      if (!complete) {
        if (!controller.signal.aborted) controller.abort();
        source.destroy();
      }
    }
  }
  return Readable.from(bounded());
}

class ZohoOnDemandAttachmentService {
  constructor({
    allowlist,
    accessTokenProvider,
    fetchImpl = fetch,
    apiOrigin = ZOHO_API_ORIGIN,
    maxAttachmentBytes = DEFAULT_MAX_ATTACHMENT_BYTES,
    sourceTimeoutMs = DEFAULT_SOURCE_TIMEOUT_MS,
    orgCacheTtlMs = DEFAULT_ORG_CACHE_TTL_MS,
  } = {}) {
    if (!allowlist || typeof allowlist.resolve !== 'function') throw new TypeError('allowlist.resolve is required.');
    if (typeof accessTokenProvider !== 'function') throw new TypeError('accessTokenProvider is required.');
    if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required.');
    this.allowlist = allowlist;
    this.accessTokenProvider = accessTokenProvider;
    this.fetchImpl = fetchImpl;
    this.apiOrigin = normalizeZohoOrigin(apiOrigin);
    this.maxAttachmentBytes = assertIntegerWithin(
      maxAttachmentBytes,
      'maxAttachmentBytes',
      1,
      HARD_MAX_ATTACHMENT_BYTES,
    );
    this.sourceTimeoutMs = assertIntegerWithin(
      sourceTimeoutMs,
      'sourceTimeoutMs',
      1_000,
      HARD_MAX_SOURCE_TIMEOUT_MS,
    );
    this.orgCacheTtlMs = assertIntegerWithin(
      orgCacheTtlMs,
      'orgCacheTtlMs',
      0,
      DEFAULT_ORG_CACHE_TTL_MS,
    );
    this.tokenGuards = new Map();
  }

  async _fetchWithTimeout(endpoint, token, options = {}) {
    const method = assertZohoReadMethod(options.method || 'GET');
    if (typeof endpoint !== 'string' || !endpoint.startsWith('/crm/v8/')) {
      fail('SOURCE_ENDPOINT_BLOCKED', 'The Zoho CRM source endpoint is not allowlisted.', 500);
    }
    const url = new URL(endpoint, `${this.apiOrigin}/`);
    if (url.origin !== this.apiOrigin || url.username || url.password || url.search || url.hash) {
      fail('SOURCE_ENDPOINT_BLOCKED', 'The Zoho CRM source endpoint is not allowlisted.', 500);
    }
    const controller = new AbortController();
    const timeoutState = { fired: false };
    const timer = setTimeout(() => {
      timeoutState.fired = true;
      controller.abort();
    }, this.sourceTimeoutMs);
    let cleared = false;
    const clearTimer = () => {
      if (cleared) return;
      cleared = true;
      clearTimeout(timer);
    };
    try {
      const response = await this.fetchImpl(url, {
        method,
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          Accept: options.accept || 'application/octet-stream',
          'Accept-Encoding': 'identity',
          'Cache-Control': 'no-store',
        },
      });
      return { response, controller, timeoutState, clearTimer };
    } catch (error) {
      clearTimer();
      if (timeoutState.fired) fail('SOURCE_TIMEOUT', 'The Zoho CRM attachment request timed out.', 504);
      fail('SOURCE_REQUEST_FAILED', 'The Zoho CRM source request failed.', 502, { cause: error });
    }
  }

  async _loadOrganization(token) {
    const request = await this._fetchWithTimeout('/crm/v8/org', token, { accept: 'application/json' });
    try {
      if (request.response.status < 200 || request.response.status > 299) {
        fail('SOURCE_ORG_VERIFICATION_FAILED', 'The Zoho CRM source organization could not be verified.', 503);
      }
      const declared = request.response.headers.get('content-length');
      if (declared && (!/^\d+$/.test(declared) || Number(declared) > ORG_RESPONSE_MAX_BYTES)) {
        fail('SOURCE_ORG_VERIFICATION_FAILED', 'The Zoho CRM source organization could not be verified.', 503);
      }
      const bytes = await readBodyBounded(request.response, ORG_RESPONSE_MAX_BYTES);
      try {
        return JSON.parse(bytes.toString('utf8'));
      } catch {
        fail('SOURCE_ORG_VERIFICATION_FAILED', 'The Zoho CRM source organization could not be verified.', 503);
      }
    } finally {
      request.clearTimer();
      if (!request.controller.signal.aborted) request.controller.abort();
    }
  }

  _guardForToken(token) {
    const fingerprint = tokenFingerprint(token);
    let entry = this.tokenGuards.get(fingerprint);
    if (!entry) {
      entry = {
        lastUsedAt: Date.now(),
        guard: createZohoOrgGuard({
          expectedZgid: EXPECTED_ZOHO_ZGID,
          cacheTtlMs: this.orgCacheTtlMs,
          loadOrg: () => this._loadOrganization(token),
        }),
      };
      this.tokenGuards.set(fingerprint, entry);
      if (this.tokenGuards.size > 2) {
        const oldest = [...this.tokenGuards.entries()]
          .filter(([key]) => key !== fingerprint)
          .sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt)[0];
        if (oldest) this.tokenGuards.delete(oldest[0]);
      }
    }
    entry.lastUsedAt = Date.now();
    return entry.guard;
  }

  async _verifiedToken() {
    let token;
    try {
      token = safeAccessToken(await this.accessTokenProvider());
    } catch (error) {
      if (error instanceof AttachmentAccessError) throw error;
      fail('SOURCE_AUTH_UNAVAILABLE', 'Zoho CRM attachment authorization is unavailable.', 503);
    }
    try {
      await this._guardForToken(token).assertExpectedOrg();
    } catch {
      fail('SOURCE_ORG_VERIFICATION_FAILED', 'The Zoho CRM source organization could not be verified.', 503);
    }
    return token;
  }

  _knownAttachment(moduleName, recordId, attachmentId) {
    const row = this.allowlist.resolve(moduleName, recordId, attachmentId);
    if (row.declaredSizeBytes > this.maxAttachmentBytes) {
      fail('ATTACHMENT_SIZE_LIMIT', 'The requested attachment exceeds the reviewed on-demand size limit.', 413);
    }
    return row;
  }

  async describe(moduleName, recordId, attachmentId) {
    const row = this._knownAttachment(moduleName, recordId, attachmentId);
    await this._verifiedToken();
    return row;
  }

  async open(moduleName, recordId, attachmentId) {
    const row = this._knownAttachment(moduleName, recordId, attachmentId);
    const token = await this._verifiedToken();
    const endpoint = `/crm/v8/${encodeURIComponent(row.module)}/${encodeURIComponent(row.recordId)}/Attachments/${encodeURIComponent(row.attachmentId)}`;
    const request = await this._fetchWithTimeout(endpoint, token);
    const response = request.response;
    if (response.status >= 300 && response.status <= 399) {
      request.clearTimer();
      request.controller.abort();
      fail('SOURCE_REDIRECT_BLOCKED', 'Zoho CRM attachment redirects are blocked.', 502);
    }
    if (response.status !== 200 || !response.body) {
      request.clearTimer();
      request.controller.abort();
      fail('SOURCE_ATTACHMENT_UNAVAILABLE', 'The Zoho CRM attachment is unavailable.', 502);
    }
    let length;
    try {
      length = exactContentLength(response, row.declaredSizeBytes, this.maxAttachmentBytes);
    } catch (error) {
      request.clearTimer();
      request.controller.abort();
      throw error;
    }
    return Object.freeze({
      fileName: row.fileName,
      declaredSizeBytes: length,
      body: exactLengthReadable(
        response.body,
        length,
        request.controller,
        request.timeoutState,
        request.clearTimer,
      ),
    });
  }

  status() {
    return Object.freeze({
      source_mode: 'zoho-crm-read-only-on-demand',
      source_org_locked: true,
      source_methods: Object.freeze(['GET', 'HEAD']),
      source_origin: ZOHO_API_ORIGIN,
      max_attachment_bytes: this.maxAttachmentBytes,
      manifest: this.allowlist.status || null,
      cache_attachment_bodies: false,
    });
  }
}

function createAttachmentStreamLimiter({
  globalLimit = DEFAULT_GLOBAL_STREAM_LIMIT,
  actorLimit = DEFAULT_ACTOR_STREAM_LIMIT,
  globalRequestsPerWindow = DEFAULT_GLOBAL_REQUEST_LIMIT,
  actorRequestsPerWindow = DEFAULT_ACTOR_REQUEST_LIMIT,
  windowMs = DEFAULT_RATE_WINDOW_MS,
  now = () => Date.now(),
} = {}) {
  assertIntegerWithin(globalLimit, 'globalLimit', 1, 4);
  assertIntegerWithin(actorLimit, 'actorLimit', 1, globalLimit);
  assertIntegerWithin(globalRequestsPerWindow, 'globalRequestsPerWindow', 1, 480);
  assertIntegerWithin(actorRequestsPerWindow, 'actorRequestsPerWindow', 1, globalRequestsPerWindow);
  assertIntegerWithin(windowMs, 'windowMs', 1_000, 60 * 60 * 1000);
  if (typeof now !== 'function') throw new TypeError('now must be a function.');
  let globalActive = 0;
  const actorActive = new Map();
  let globalRequests = [];
  const actorRequests = new Map();

  function prune(timestamp) {
    const cutoff = timestamp - windowMs;
    globalRequests = globalRequests.filter(value => value > cutoff);
    for (const [key, values] of actorRequests) {
      const current = values.filter(value => value > cutoff);
      if (current.length) actorRequests.set(key, current);
      else if (!actorActive.has(key)) actorRequests.delete(key);
    }
  }

  function acquire(actorId) {
    const actor = String(actorId || '');
    if (!actor || actor.length > 256 || /[\u0000-\u001f\u007f]/.test(actor)) {
      fail('ATTACHMENT_AUTH_REQUIRED', 'Attachment access requires an authenticated user.', 401);
    }
    const timestamp = Number(now());
    if (!Number.isFinite(timestamp)) throw new TypeError('now must return a finite timestamp.');
    prune(timestamp);
    const recentActorRequests = actorRequests.get(actor) || [];
    if (globalRequests.length >= globalRequestsPerWindow || recentActorRequests.length >= actorRequestsPerWindow) {
      fail('ATTACHMENT_RATE_LIMIT', 'Attachment request rate limit reached. Try again later.', 429);
    }
    const currentActor = actorActive.get(actor) || 0;
    if (globalActive >= globalLimit || currentActor >= actorLimit) {
      fail('ATTACHMENT_STREAM_LIMIT', 'Another attachment stream is already active. Try again shortly.', 429);
    }
    globalActive += 1;
    actorActive.set(actor, currentActor + 1);
    globalRequests.push(timestamp);
    recentActorRequests.push(timestamp);
    actorRequests.set(actor, recentActorRequests);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      globalActive -= 1;
      const remaining = (actorActive.get(actor) || 1) - 1;
      if (remaining > 0) actorActive.set(actor, remaining);
      else actorActive.delete(actor);
    };
  }

  return Object.freeze({
    acquire,
    status: () => Object.freeze({
      global_active: globalActive,
      active_actor_count: actorActive.size,
      recent_request_count: globalRequests.length,
      recent_actor_count: actorRequests.size,
    }),
  });
}

function safeDownloadName(value) {
  const beforeControl = String(value || 'attachment').split(/[\u0000-\u001f\u007f]/, 1)[0];
  const withoutPath = beforeControl
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    .trim()
    .slice(0, 180) || 'attachment';
  const ascii = withoutPath.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'attachment';
  const encoded = encodeURIComponent(withoutPath).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function attachmentSecurityHeaders(response) {
  response.set({
    'Cache-Control': 'private, no-store, max-age=0',
    Pragma: 'no-cache',
    'Content-Security-Policy': "sandbox; default-src 'none'",
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
  });
}

function publicError(error) {
  if (error instanceof AttachmentAccessError) {
    return {
      statusCode: error.statusCode,
      body: { ok: false, error: { code: error.code, message: error.message } },
    };
  }
  return {
    statusCode: 500,
    body: { ok: false, error: { code: 'ATTACHMENT_ACCESS_FAILED', message: 'Attachment access failed.' } },
  };
}

function actorIdentifier(value) {
  const actorId = typeof value === 'string' ? value : value?.actorId;
  const normalized = String(actorId || '');
  if (!normalized || normalized.length > 256 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    fail('ATTACHMENT_AUTH_REQUIRED', 'Attachment access requires an authenticated user.', 401);
  }
  return normalized;
}

function createAttachmentAccessRouter({
  service,
  authorizeRequest,
  authorizeRecord,
  limiter = createAttachmentStreamLimiter(),
} = {}) {
  if (!service || typeof service.describe !== 'function' || typeof service.open !== 'function') {
    throw new TypeError('service must implement describe() and open().');
  }
  if (typeof authorizeRequest !== 'function') throw new TypeError('authorizeRequest is required.');
  if (typeof authorizeRecord !== 'function') throw new TypeError('authorizeRecord is required.');
  if (!limiter || typeof limiter.acquire !== 'function') throw new TypeError('limiter.acquire is required.');

  const router = express.Router();
  router.use((request, response, next) => {
    attachmentSecurityHeaders(response);
    if (Object.keys(request.query || {}).length > 0) {
      next(new AttachmentAccessError('ATTACHMENT_QUERY_BLOCKED', 'Attachment access does not accept URL query parameters.', 400));
      return;
    }
    if (request.get('x-crm-attachment-request') !== '1') {
      next(new AttachmentAccessError('ATTACHMENT_REQUEST_HEADER_REQUIRED', 'The protected attachment request header is required.', 403));
      return;
    }
    if (request.get('range')) {
      next(new AttachmentAccessError('ATTACHMENT_RANGE_UNSUPPORTED', 'Partial attachment requests are not enabled.', 416));
      return;
    }
    next();
  });

  async function authorize(request) {
    const requested = validateRouteIdentifiers(
      request.params.module,
      request.params.recordId,
      request.params.attachmentId,
    );
    let actor;
    try {
      actor = actorIdentifier(await authorizeRequest(request));
    } catch (error) {
      if (error instanceof AttachmentAccessError) throw error;
      fail('ATTACHMENT_AUTH_REQUIRED', 'Attachment access requires an authenticated user.', 401);
    }
    let permitted = false;
    try {
      permitted = await authorizeRecord({
        actorId: actor,
        module: requested.module,
        recordId: requested.recordId,
        request,
      });
    } catch {
      permitted = false;
    }
    if (permitted !== true) {
      fail('ATTACHMENT_NOT_AVAILABLE', 'The requested attachment is not available.', 404);
    }
    return actor;
  }

  router.head('/:module/:recordId/:attachmentId', async (request, response, next) => {
    try {
      await authorize(request);
      const attachment = await service.describe(request.params.module, request.params.recordId, request.params.attachmentId);
      response.status(200).set({
        'Content-Length': String(attachment.declaredSizeBytes),
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': safeDownloadName(attachment.fileName),
      }).end();
    } catch (error) {
      next(error);
    }
  });

  router.get('/:module/:recordId/:attachmentId', async (request, response, next) => {
    let release = null;
    try {
      const actor = await authorize(request);
      release = limiter.acquire(actor);
      const attachment = await service.open(request.params.module, request.params.recordId, request.params.attachmentId);
      response.status(200).set({
        'Content-Length': String(attachment.declaredSizeBytes),
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': safeDownloadName(attachment.fileName),
      });
      await pipeline(attachment.body, response);
      release();
      release = null;
    } catch (error) {
      if (release) release();
      if (response.headersSent) {
        response.destroy();
        return;
      }
      next(error);
    }
  });

  router.all('/:module/:recordId/:attachmentId', (request, response) => {
    response.status(405).set('Allow', 'GET, HEAD').json({
      ok: false,
      error: { code: 'ATTACHMENT_METHOD_BLOCKED', message: 'Only GET and HEAD are available for attachments.' },
    });
  });

  router.use((error, request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }
    const output = publicError(error);
    response.status(output.statusCode).json(output.body);
  });
  return router;
}

module.exports = {
  EXPECTED_SOURCE_ORG,
  ZOHO_API_ORIGIN,
  DEFAULT_MAX_ATTACHMENT_BYTES,
  HARD_MAX_ATTACHMENT_BYTES,
  DEFAULT_SOURCE_TIMEOUT_MS,
  MAX_MANIFEST_BYTES,
  MAX_MANIFEST_ENTRIES,
  AttachmentAccessError,
  assertZohoReadMethod,
  normalizeZohoOrigin,
  loadPrivateAttachmentAllowlist,
  ZohoOnDemandAttachmentService,
  createAttachmentStreamLimiter,
  createAttachmentAccessRouter,
  safeDownloadName,
};
