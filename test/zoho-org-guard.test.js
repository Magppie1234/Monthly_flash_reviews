'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EXPECTED_ZOHO_ZGID, createZohoOrgGuard } = require('../lib/zoho-org-guard');

test('accepts exactly one organization with the locked canonical zgid and caches briefly', async () => {
  let calls = 0;
  let currentTime = 1_000;
  const guard = createZohoOrgGuard({
    loadOrg: async () => { calls += 1; return { org: [{ zgid: EXPECTED_ZOHO_ZGID }] }; },
    now: () => currentTime,
    cacheTtlMs: 600_000,
  });

  assert.deepEqual(await guard.assertExpectedOrg(), { verified: true });
  currentTime += 60_000;
  assert.deepEqual(await guard.assertExpectedOrg(), { verified: true });
  assert.equal(calls, 1);
});

test('fails closed for an empty, ambiguous, or mismatched organization response without exposing identifiers', async () => {
  const invalidPayloads = [
    null,
    { org: [] },
    { org: [{ zgid: '10000000000000' }] },
    { org: [{ zgid: EXPECTED_ZOHO_ZGID }, { zgid: EXPECTED_ZOHO_ZGID }] },
  ];

  for (const payload of invalidPayloads) {
    const guard = createZohoOrgGuard({ loadOrg: async () => payload });
    await assert.rejects(
      () => guard.assertExpectedOrg(),
      error => error.code === 'ZOHO_ORG_MISMATCH'
        && !error.message.includes(EXPECTED_ZOHO_ZGID)
        && !error.message.includes('10000000000000'),
    );
  }
});

test('coalesces concurrent verification and sanitizes upstream errors', async () => {
  let calls = 0;
  let release;
  const guard = createZohoOrgGuard({
    loadOrg: async () => {
      calls += 1;
      await new Promise(resolve => { release = resolve; });
      throw new Error('private upstream response and token details');
    },
  });

  const first = guard.assertExpectedOrg();
  const second = guard.assertExpectedOrg();
  await new Promise(resolve => setImmediate(resolve));
  release();
  for (const outcome of [first, second]) {
    await assert.rejects(
      () => outcome,
      error => error.code === 'ZOHO_ORG_VERIFICATION_FAILED'
        && !error.message.includes('private upstream response'),
    );
  }
  assert.equal(calls, 1);
});

test('forwards the caller abort signal into an uncached organization load', async () => {
  const controller = new AbortController();
  let receivedSignal = null;
  const guard = createZohoOrgGuard({
    loadOrg: async options => {
      receivedSignal = options.signal;
      return { org: [{ zgid: EXPECTED_ZOHO_ZGID }] };
    },
  });

  await guard.assertExpectedOrg({ signal: controller.signal });
  assert.equal(receivedSignal, controller.signal);
});
