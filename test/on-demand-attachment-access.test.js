'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const express = require('express');
const {
  EXPECTED_SOURCE_ORG,
  ZOHO_API_ORIGIN,
  AttachmentAccessError,
  assertZohoReadMethod,
  normalizeZohoOrigin,
  loadPrivateAttachmentAllowlist,
  ZohoOnDemandAttachmentService,
  createAttachmentStreamLimiter,
  createAttachmentAccessRouter,
  safeDownloadName,
} = require('../lib/on-demand-attachment-access');

const RECORD_ID = '1032257000000899307';
const ATTACHMENT_ID = '1032257000001060049';
const TOKEN = '1000.test-access-token_123456789';

function sourceRow(overrides = {}) {
  return {
    source_org_id: EXPECTED_SOURCE_ORG,
    attachment_id: ATTACHMENT_ID,
    parent_module: 'Leads',
    parent_record_id: RECORD_ID,
    file_name: 'Customer document.pdf',
    declared_size_bytes: 7,
    replication_status: 'metadata_only',
    quarantine_reasons: [],
    ...overrides,
  };
}

async function privateManifest(lines, mode = 0o600) {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'crm-attachment-allowlist-'));
  const file = path.join(directory, 'manifest.jsonl');
  await fs.promises.writeFile(file, `${lines.map(line => JSON.stringify(line)).join('\n')}\n`, { mode: 0o600 });
  await fs.promises.chmod(file, mode);
  return { directory, file };
}

async function removeFixture(fixture) {
  await fs.promises.rm(fixture.directory, { recursive: true, force: true });
}

function allowlistFor(row = sourceRow()) {
  const normalized = {
    sourceOrgId: row.source_org_id,
    module: row.parent_module,
    recordId: row.parent_record_id,
    attachmentId: row.attachment_id,
    fileName: row.file_name,
    declaredSizeBytes: row.declared_size_bytes,
  };
  return {
    resolve(moduleName, recordId, attachmentId) {
      if (moduleName !== normalized.module || recordId !== normalized.recordId || attachmentId !== normalized.attachmentId) {
        throw new AttachmentAccessError('ATTACHMENT_NOT_AVAILABLE', 'The requested attachment is not available.', 404);
      }
      return normalized;
    },
    status: { total_entries: 1, streamable_entries: 1, quarantined_entries: 0 },
  };
}

function responseWithBody(bytes, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.includeLength !== false) headers.set('content-length', String(options.contentLength ?? bytes.length));
  return new Response(Readable.toWeb(Readable.from([bytes])), {
    status: options.status || 200,
    headers,
  });
}

function organizationResponse(zgid = '60046349006') {
  const bytes = Buffer.from(JSON.stringify({ org: [{ zgid }] }));
  return responseWithBody(bytes, {
    headers: { 'content-type': 'application/json' },
  });
}

async function consume(readable) {
  const chunks = [];
  for await (const chunk of readable) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function mockService(options = {}) {
  const bytes = options.bytes || Buffer.from('1234567');
  const calls = [];
  const fetchImpl = async (url, request) => {
    calls.push({ url: String(url), request });
    if (new URL(url).pathname === '/crm/v8/org') return organizationResponse(options.zgid);
    if (options.attachmentResponse) return options.attachmentResponse();
    return responseWithBody(bytes);
  };
  return {
    calls,
    service: new ZohoOnDemandAttachmentService({
      allowlist: options.allowlist || allowlistFor(options.row),
      accessTokenProvider: options.accessTokenProvider || (async () => TOKEN),
      fetchImpl,
      apiOrigin: options.apiOrigin || ZOHO_API_ORIGIN,
      maxAttachmentBytes: options.maxAttachmentBytes || 1024,
      sourceTimeoutMs: options.sourceTimeoutMs || 5_000,
      orgCacheTtlMs: options.orgCacheTtlMs ?? 600_000,
    }),
  };
}

test('private manifest builds an exact triple allowlist and excludes quarantined rows', async () => {
  const fixture = await privateManifest([
    sourceRow(),
    sourceRow({
      attachment_id: '1032257000001060050',
      parent_module: null,
      parent_record_id: null,
      file_name: null,
      declared_size_bytes: null,
      replication_status: 'quarantined',
      quarantine_reasons: ['missing_parent_module'],
    }),
  ]);
  try {
    const allowlist = await loadPrivateAttachmentAllowlist(fixture.file);
    assert.deepEqual(allowlist.status, {
      source_org_locked: true,
      total_entries: 2,
      streamable_entries: 1,
      quarantined_entries: 1,
    });
    const row = allowlist.resolve('Leads', RECORD_ID, ATTACHMENT_ID);
    assert.equal(row.fileName, 'Customer document.pdf');
    assert.equal(row.declaredSizeBytes, 7);
    assert.throws(() => allowlist.resolve('Contacts', RECORD_ID, ATTACHMENT_ID), { code: 'ATTACHMENT_NOT_AVAILABLE' });
    assert.throws(() => allowlist.resolve('Leads', '1032257000000899308', ATTACHMENT_ID), { code: 'ATTACHMENT_NOT_AVAILABLE' });
    assert.throws(() => allowlist.resolve('Leads', RECORD_ID, '1032257000001060050'), { code: 'ATTACHMENT_NOT_AVAILABLE' });
  } finally {
    await removeFixture(fixture);
  }
});

test('manifest loading rejects public permissions, symlinks, wrong organizations, and duplicate IDs', async () => {
  const publicFixture = await privateManifest([sourceRow()], 0o644);
  const wrongOrg = await privateManifest([sourceRow({ source_org_id: 'org60000000000' })]);
  const duplicate = await privateManifest([sourceRow(), sourceRow()]);
  const symlinkDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'crm-attachment-symlink-'));
  const symlinkPath = path.join(symlinkDirectory, 'manifest.jsonl');
  await fs.promises.symlink(duplicate.file, symlinkPath);
  try {
    await assert.rejects(loadPrivateAttachmentAllowlist(publicFixture.file), { code: 'ATTACHMENT_MANIFEST_NOT_PRIVATE' });
    await assert.rejects(loadPrivateAttachmentAllowlist(symlinkPath), { code: 'ATTACHMENT_MANIFEST_NOT_PRIVATE' });
    await assert.rejects(loadPrivateAttachmentAllowlist(wrongOrg.file), { code: 'ATTACHMENT_MANIFEST_SCOPE_MISMATCH' });
    await assert.rejects(loadPrivateAttachmentAllowlist(duplicate.file), { code: 'ATTACHMENT_MANIFEST_DUPLICATE' });
  } finally {
    await Promise.all([removeFixture(publicFixture), removeFixture(wrongOrg), removeFixture(duplicate)]);
    await fs.promises.rm(symlinkDirectory, { recursive: true, force: true });
  }
});

test('Zoho source method and India API origin are hard allowlisted', () => {
  assert.equal(assertZohoReadMethod('get'), 'GET');
  assert.equal(assertZohoReadMethod('HEAD'), 'HEAD');
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.throws(() => assertZohoReadMethod(method), { code: 'SOURCE_WRITE_BLOCKED' });
  }
  assert.equal(normalizeZohoOrigin('https://www.zohoapis.in/'), ZOHO_API_ORIGIN);
  for (const value of [
    'http://www.zohoapis.in',
    'https://www.zohoapis.com',
    'https://user:secret@www.zohoapis.in',
    'https://www.zohoapis.in/crm/v8',
  ]) assert.throws(() => normalizeZohoOrigin(value), { code: 'SOURCE_ORIGIN_BLOCKED' });
});

test('Zoho source endpoints reject query parameters before network access', async () => {
  const { service, calls } = mockService();
  await assert.rejects(
    service._fetchWithTimeout('/crm/v8/org?access_token=blocked', TOKEN),
    { code: 'SOURCE_ENDPOINT_BLOCKED' },
  );
  assert.equal(calls.length, 0);
});

test('on-demand open verifies the exact org and streams only the allowlisted attachment with GET', async () => {
  const { service, calls } = mockService();
  const opened = await service.open('Leads', RECORD_ID, ATTACHMENT_ID);
  assert.deepEqual(await consume(opened.body), Buffer.from('1234567'));
  assert.equal(opened.declaredSizeBytes, 7);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(call => new URL(call.url).pathname), [
    '/crm/v8/org',
    `/crm/v8/Leads/${RECORD_ID}/Attachments/${ATTACHMENT_ID}`,
  ]);
  for (const call of calls) {
    assert.equal(call.request.method, 'GET');
    assert.equal(call.request.redirect, 'manual');
    assert.equal(new URL(call.url).origin, ZOHO_API_ORIGIN);
    assert.equal(new URL(call.url).search, '');
    assert.equal(call.url.includes(TOKEN), false);
    assert.equal(call.request.headers.Authorization, `Zoho-oauthtoken ${TOKEN}`);
  }
  assert.deepEqual(service.status().source_methods, ['GET', 'HEAD']);
  assert.equal(service.status().cache_attachment_bodies, false);
});

test('organization verification cache is bound to the exact access token fingerprint', async () => {
  let token = TOKEN;
  const { service, calls } = mockService({ accessTokenProvider: async () => token });
  await consume((await service.open('Leads', RECORD_ID, ATTACHMENT_ID)).body);
  await consume((await service.open('Leads', RECORD_ID, ATTACHMENT_ID)).body);
  token = '1000.rotated-access-token_987654321';
  await consume((await service.open('Leads', RECORD_ID, ATTACHMENT_ID)).body);
  assert.equal(calls.filter(call => new URL(call.url).pathname === '/crm/v8/org').length, 2);
  assert.equal(calls.filter(call => new URL(call.url).pathname.includes('/Attachments/')).length, 3);
});

test('wrong source organization blocks before any attachment GET', async () => {
  const { service, calls } = mockService({ zgid: '60000000000' });
  await assert.rejects(service.open('Leads', RECORD_ID, ATTACHMENT_ID), { code: 'SOURCE_ORG_VERIFICATION_FAILED' });
  assert.deepEqual(calls.map(call => new URL(call.url).pathname), ['/crm/v8/org']);
});

test('source redirects, absent lengths, and mismatched lengths fail before streaming', async () => {
  for (const [attachmentResponse, code] of [
    [() => new Response(null, { status: 302, headers: { location: 'https://example.invalid/file' } }), 'SOURCE_REDIRECT_BLOCKED'],
    [() => responseWithBody(Buffer.from('1234567'), { includeLength: false }), 'SOURCE_LENGTH_UNVERIFIED'],
    [() => responseWithBody(Buffer.from('1234567'), { contentLength: 6 }), 'SOURCE_LENGTH_MISMATCH'],
  ]) {
    const { service } = mockService({ attachmentResponse });
    await assert.rejects(service.open('Leads', RECORD_ID, ATTACHMENT_ID), { code });
  }
});

test('bounded stream rejects truncated and overrun source bodies', async () => {
  const truncated = mockService({
    attachmentResponse: () => responseWithBody(Buffer.from('1234'), { contentLength: 7 }),
  }).service;
  await assert.rejects(
    async () => consume((await truncated.open('Leads', RECORD_ID, ATTACHMENT_ID)).body),
    { code: 'SOURCE_STREAM_TRUNCATED' },
  );

  const overrun = mockService({
    attachmentResponse: () => responseWithBody(Buffer.from('12345678'), { contentLength: 7 }),
  }).service;
  await assert.rejects(
    async () => consume((await overrun.open('Leads', RECORD_ID, ATTACHMENT_ID)).body),
    { code: 'SOURCE_STREAM_OVERRUN' },
  );
});

test('known attachment size cap fails before token or network access', async () => {
  let tokenCalls = 0;
  const { service, calls } = mockService({
    row: sourceRow({ declared_size_bytes: 1025 }),
    accessTokenProvider: async () => {
      tokenCalls += 1;
      return TOKEN;
    },
    maxAttachmentBytes: 1024,
  });
  await assert.rejects(service.open('Leads', RECORD_ID, ATTACHMENT_ID), { code: 'ATTACHMENT_SIZE_LIMIT' });
  assert.equal(tokenCalls, 0);
  assert.equal(calls.length, 0);
});

test('stream limiter enforces one stream per actor and bounded global concurrency', () => {
  const limiter = createAttachmentStreamLimiter({ globalLimit: 2, actorLimit: 1 });
  const releaseA = limiter.acquire('actor-a');
  assert.throws(() => limiter.acquire('actor-a'), { code: 'ATTACHMENT_STREAM_LIMIT' });
  const releaseB = limiter.acquire('actor-b');
  assert.throws(() => limiter.acquire('actor-c'), { code: 'ATTACHMENT_STREAM_LIMIT' });
  assert.deepEqual(limiter.status(), {
    global_active: 2,
    active_actor_count: 2,
    recent_request_count: 2,
    recent_actor_count: 2,
  });
  releaseA();
  releaseA();
  releaseB();
  assert.deepEqual(limiter.status(), {
    global_active: 0,
    active_actor_count: 0,
    recent_request_count: 2,
    recent_actor_count: 2,
  });
});

test('stream limiter also bounds sequential requests and expires the fixed window', () => {
  let currentTime = 10_000;
  const limiter = createAttachmentStreamLimiter({
    globalLimit: 2,
    actorLimit: 1,
    globalRequestsPerWindow: 3,
    actorRequestsPerWindow: 2,
    windowMs: 1_000,
    now: () => currentTime,
  });
  limiter.acquire('actor-a')();
  limiter.acquire('actor-a')();
  assert.throws(() => limiter.acquire('actor-a'), { code: 'ATTACHMENT_RATE_LIMIT' });
  limiter.acquire('actor-b')();
  assert.throws(() => limiter.acquire('actor-c'), { code: 'ATTACHMENT_RATE_LIMIT' });
  currentTime += 1_001;
  limiter.acquire('actor-a')();
  assert.deepEqual(limiter.status(), {
    global_active: 0,
    active_actor_count: 0,
    recent_request_count: 1,
    recent_actor_count: 1,
  });
});

test('download filename is path-safe and does not permit response-header injection', () => {
  const header = safeDownloadName('../private\\Customer दस्तावेज़.pdf\r\nX-Evil: yes');
  assert.match(header, /^attachment; filename=/);
  assert.doesNotMatch(header, /\.\.\/|\\|\r|\n|X-Evil/i);
  assert.match(header, /filename\*=UTF-8''/);
});

async function listening(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  return {
    server,
    origin: `http://127.0.0.1:${server.address().port}`,
  };
}

test('router requires protected request header and record authorization, then serves a no-store download', async () => {
  const calls = [];
  const service = {
    async describe(moduleName, recordId, attachmentId) {
      calls.push(['describe', moduleName, recordId, attachmentId]);
      return { fileName: 'Customer दस्तावेज़.pdf', declaredSizeBytes: 7 };
    },
    async open(moduleName, recordId, attachmentId) {
      calls.push(['open', moduleName, recordId, attachmentId]);
      return { fileName: 'Customer दस्तावेज़.pdf', declaredSizeBytes: 7, body: Readable.from(['1234567']) };
    },
  };
  const app = express();
  app.use('/api/attachments/open', createAttachmentAccessRouter({
    service,
    authorizeRequest: async request => ({ actorId: request.get('x-test-actor') }),
    authorizeRecord: async ({ module, recordId }) => module === 'Leads' && recordId === RECORD_ID,
  }));
  const live = await listening(app);
  const url = `${live.origin}/api/attachments/open/Leads/${RECORD_ID}/${ATTACHMENT_ID}`;
  try {
    const missingHeader = await fetch(url, { headers: { 'x-test-actor': 'agent-1' } });
    assert.equal(missingHeader.status, 403);
    assert.equal((await missingHeader.json()).error.code, 'ATTACHMENT_REQUEST_HEADER_REQUIRED');

    const denied = await fetch(url.replace('/Leads/', '/Contacts/'), {
      headers: { 'x-test-actor': 'agent-1', 'x-crm-attachment-request': '1' },
    });
    assert.equal(denied.status, 404);
    assert.equal((await denied.json()).error.code, 'ATTACHMENT_NOT_AVAILABLE');

    const response = await fetch(url, {
      headers: { 'x-test-actor': 'agent-1', 'x-crm-attachment-request': '1' },
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '1234567');
    assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0');
    assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('content-type'), 'application/octet-stream');
    assert.match(response.headers.get('content-disposition'), /^attachment;/);

    const head = await fetch(url, {
      method: 'HEAD',
      headers: { 'x-test-actor': 'agent-1', 'x-crm-attachment-request': '1' },
    });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), '7');
    assert.equal(await head.text(), '');

    const query = await fetch(`${url}?token=blocked`, {
      headers: { 'x-test-actor': 'agent-1', 'x-crm-attachment-request': '1' },
    });
    assert.equal(query.status, 400);
    assert.equal((await query.json()).error.code, 'ATTACHMENT_QUERY_BLOCKED');

    const range = await fetch(url, {
      headers: {
        'x-test-actor': 'agent-1',
        'x-crm-attachment-request': '1',
        range: 'bytes=0-2',
      },
    });
    assert.equal(range.status, 416);
    assert.equal((await range.json()).error.code, 'ATTACHMENT_RANGE_UNSUPPORTED');

    assert.deepEqual(calls, [
      ['open', 'Leads', RECORD_ID, ATTACHMENT_ID],
      ['describe', 'Leads', RECORD_ID, ATTACHMENT_ID],
    ]);
  } finally {
    await new Promise(resolve => live.server.close(resolve));
  }
});

test('router construction fails closed without both authentication callbacks', () => {
  const service = { describe: async () => ({}), open: async () => ({}) };
  assert.throws(() => createAttachmentAccessRouter({ service }), /authorizeRequest/);
  assert.throws(() => createAttachmentAccessRouter({ service, authorizeRequest: async () => 'actor' }), /authorizeRecord/);
});
