'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');

process.env.ACCESS_CODE = 'cron-route-test-access';
process.env.CRON_SECRET = 'cron-route-test-secret';
process.env.CRM_SQL_SECRET = 'cron-route-test-database-secret';

const app = require('../server');
const {
  constantTimeStringEqual,
  createVercelCronDeltaSyncHandler,
  isExactVercelCronDeltaSyncRequest,
} = app;

function responseHarness() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function requestHarness({ authorization, query = {}, cookie } = {}) {
  const headers = {};
  if (authorization !== undefined) headers.authorization = authorization;
  if (cookie !== undefined) headers.cookie = cookie;
  return {
    method: 'GET',
    path: '/api/cron/delta-sync',
    query,
    headers,
    get(name) {
      return headers[String(name).toLowerCase()];
    },
  };
}

async function invokeHandler(options = {}) {
  const secret = Object.hasOwn(options, 'secret') ? options.secret : 'dedicated-cron-secret';
  const configured = Object.hasOwn(options, 'configured') ? options.configured : true;
  const authorization = Object.hasOwn(options, 'authorization')
    ? options.authorization
    : `Bearer ${secret}`;
  const query = options.query;
  const cookie = options.cookie;
  const outcome = Object.hasOwn(options, 'outcome')
    ? options.outcome
    : { accepted: true, result: { global_success: true } };
  const error = options.error || null;
  const triggerCalls = [];
  const handler = createVercelCronDeltaSyncHandler({
    getCronSecret: () => secret,
    isConfigured: () => configured,
    trigger: async options => {
      triggerCalls.push(options);
      if (error) throw error;
      return outcome;
    },
  });
  const response = responseHarness();
  await handler(requestHarness({ authorization, query, cookie }), response);
  return { response, triggerCalls };
}

function requestServer(server, { method = 'GET', route = '/', headers = {} } = {}) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port: address.port,
      method,
      path: route,
      headers,
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({
        statusCode: response.statusCode,
        headers: response.headers,
        text: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.on('error', reject);
    request.end();
  });
}

test('cron authorization uses an exact constant-time string comparison', () => {
  assert.equal(constantTimeStringEqual('Bearer exact', 'Bearer exact'), true);
  assert.equal(constantTimeStringEqual('Bearer exact ', 'Bearer exact'), false);
  assert.equal(constantTimeStringEqual('bearer exact', 'Bearer exact'), false);
  assert.equal(constantTimeStringEqual(undefined, 'Bearer exact'), false);
});

test('cron fails closed when CRON_SECRET is absent', async () => {
  const { response, triggerCalls } = await invokeHandler({
    secret: undefined,
    authorization: 'Bearer anything',
  });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, { status: 'unavailable' });
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(triggerCalls.length, 0);
});

test('cron rejects absent and wrong headers without accepting query, cookie, or database-secret auth', async () => {
  const attempts = [
    { authorization: undefined },
    { authorization: 'Bearer wrong-secret' },
    { authorization: 'Bearer cron-route-test-database-secret' },
    {
      authorization: undefined,
      query: { authorization: 'Bearer dedicated-cron-secret', wk: 'dedicated-cron-secret' },
      cookie: 'crm_auth=dedicated-cron-secret',
    },
  ];

  for (const attempt of attempts) {
    const { response, triggerCalls } = await invokeHandler(attempt);
    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.body, { status: 'unauthorized' });
    assert.equal(triggerCalls.length, 0);
  }
});

test('exact cron authorization triggers the existing singleton contract once', async () => {
  const { response, triggerCalls } = await invokeHandler({
    outcome: {
      accepted: true,
      result: {
        global_success: true,
        source_record_ids: ['must-not-leak'],
        payloads: [{ private: true }],
        secret: 'must-not-leak',
      },
    },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { status: 'succeeded', global_success: true });
  assert.deepEqual(triggerCalls, [{ reason: 'vercel-cron' }]);
  assert.doesNotMatch(JSON.stringify(response.body), /must-not-leak|record_ids|payloads|secret/i);
});

test('overlap returns 202 without exposing runner state', async () => {
  const { response } = await invokeHandler({
    outcome: {
      accepted: false,
      reason: 'already_running',
      schedule: { record_id: 'must-not-leak', last_error: 'private provider response' },
    },
  });
  assert.equal(response.statusCode, 202);
  assert.deepEqual(response.body, { status: 'already_running', accepted: false });
  assert.doesNotMatch(JSON.stringify(response.body), /must-not-leak|provider|record_id|last_error/i);

  const overlapError = new Error('private lease state must not leak');
  overlapError.code = 'DELTA_SYNC_ALREADY_RUNNING';
  const thrownOverlap = await invokeHandler({ error: overlapError });
  assert.equal(thrownOverlap.response.statusCode, 202);
  assert.deepEqual(thrownOverlap.response.body, { status: 'already_running', accepted: false });
});

test('incomplete refreshes return a safe 503', async () => {
  const returnedPartial = await invokeHandler({
    outcome: { accepted: true, result: { global_success: false, ids: ['must-not-leak'] } },
  });
  assert.equal(returnedPartial.response.statusCode, 503);
  assert.deepEqual(returnedPartial.response.body, { status: 'partial_refresh', global_success: false });

  const partialError = new Error('private record and provider payload must not leak');
  partialError.code = 'DELTA_SYNC_INCOMPLETE';
  const thrownPartial = await invokeHandler({ error: partialError });
  assert.equal(thrownPartial.response.statusCode, 503);
  assert.deepEqual(thrownPartial.response.body, { status: 'partial_refresh', global_success: false });
});

test('unavailable configuration and unexpected failures are sanitized', async () => {
  const unavailable = await invokeHandler({ configured: false });
  assert.equal(unavailable.response.statusCode, 503);
  assert.deepEqual(unavailable.response.body, { status: 'unavailable' });
  assert.equal(unavailable.triggerCalls.length, 0);

  const leaseUnavailableError = new Error('private database response must not leak');
  leaseUnavailableError.code = 'LEASE_ACQUIRE_FAILED';
  const leaseUnavailable = await invokeHandler({ error: leaseUnavailableError });
  assert.equal(leaseUnavailable.response.statusCode, 503);
  assert.deepEqual(leaseUnavailable.response.body, { status: 'unavailable' });

  for (const code of [
    'DELTA_SYNC_DEADLINE_EXCEEDED',
    'SNAPSHOT_STORAGE_UNVERIFIED',
    'SNAPSHOT_CAPABILITY_UNVERIFIED',
    'SNAPSHOT_STRATEGY_DRIFT',
    'SOURCE_REPLICATION_LOCK_MISMATCH',
    'ZOHO_ORG_MISMATCH',
    'ZOHO_ORG_VERIFICATION_FAILED',
  ]) {
    const setupError = new Error('private setup detail must not leak');
    setupError.code = code;
    const setupUnavailable = await invokeHandler({ error: setupError });
    assert.equal(setupUnavailable.response.statusCode, 503);
    assert.deepEqual(setupUnavailable.response.body, { status: 'unavailable' });
  }

  const unexpected = await invokeHandler({
    error: new Error('authorization=private-value record_id=123 payload={private:true}'),
  });
  assert.equal(unexpected.response.statusCode, 500);
  assert.deepEqual(unexpected.response.body, { status: 'failed' });
  assert.doesNotMatch(JSON.stringify(unexpected.response.body), /private-value|record_id|payload|authorization/i);
});

test('only the exact GET path qualifies for the pre-gate cron handler', () => {
  assert.equal(isExactVercelCronDeltaSyncRequest({ method: 'GET', path: '/api/cron/delta-sync' }), true);
  assert.equal(isExactVercelCronDeltaSyncRequest({ method: 'POST', path: '/api/cron/delta-sync' }), false);
  assert.equal(isExactVercelCronDeltaSyncRequest({ method: 'HEAD', path: '/api/cron/delta-sync' }), false);
  assert.equal(isExactVercelCronDeltaSyncRequest({ method: 'GET', path: '/api/cron/delta-sync/' }), false);
  assert.equal(isExactVercelCronDeltaSyncRequest({ method: 'GET', path: '/api/sync/delta' }), false);

  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const cronMount = source.indexOf('if (!isExactVercelCronDeltaSyncRequest(req)) return next();');
  const accessGate = source.indexOf('// ---------- access gate');
  assert.ok(cronMount >= 0 && accessGate > cronMount, 'cron handler must be mounted before the access gate');
  assert.match(source, /deltaSyncRunner\.trigger\(\{ reason: 'vercel-cron' \}\)/);
});

test('HTTP route keeps CRM cookies and query secrets out of cron authorization', async t => {
  const server = await new Promise(resolve => {
    const candidate = app.listen(0, '127.0.0.1', () => resolve(candidate));
  });
  t.after(() => new Promise(resolve => server.close(resolve)));

  const cookie = 'crm_auth=cron-route-test-access';
  const wrongHeader = await requestServer(server, {
    route: '/api/cron/delta-sync',
    headers: { authorization: 'Bearer wrong', cookie },
  });
  assert.equal(wrongHeader.statusCode, 401);
  assert.deepEqual(JSON.parse(wrongHeader.text), { status: 'unauthorized' });

  const querySecret = await requestServer(server, {
    route: '/api/cron/delta-sync?wk=cron-route-test-database-secret',
    headers: { cookie },
  });
  assert.equal(querySecret.statusCode, 401);
  assert.deepEqual(JSON.parse(querySecret.text), { status: 'unauthorized' });

  const post = await requestServer(server, { method: 'POST', route: '/api/cron/delta-sync' });
  assert.equal(post.statusCode, 401);

  const trailingSlash = await requestServer(server, { route: '/api/cron/delta-sync/' });
  assert.equal(trailingSlash.statusCode, 401);

  const formerDatabaseSecretBypass = await requestServer(server, {
    route: '/api/sync/status?wk=cron-route-test-database-secret',
  });
  assert.equal(formerDatabaseSecretBypass.statusCode, 401);
});

test('Vercel snapshot-only production config removes the external refresh cron', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  assert.equal(config.crons, undefined);
  assert.equal(config.functions?.['api/index.js']?.includeFiles, 'snapshot-data/**');

  const entrypoint = fs.readFileSync(path.join(__dirname, '..', 'api', 'index.js'), 'utf8');
  assert.match(entrypoint, /require\('\.\.\/server-offline\.js'\)/);
  assert.doesNotMatch(entrypoint, /require\('\.\.\/server\.js'\)/);
});
