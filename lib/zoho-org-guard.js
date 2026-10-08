'use strict';

const EXPECTED_ZOHO_ZGID = '60046349006';
const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000;

function orgMismatchError() {
  const error = new Error('Configured Zoho connection does not match the locked source organization.');
  error.code = 'ZOHO_ORG_MISMATCH';
  return error;
}

function createZohoOrgGuard({
  loadOrg,
  expectedZgid = EXPECTED_ZOHO_ZGID,
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  now = () => Date.now(),
} = {}) {
  if (typeof loadOrg !== 'function') throw new TypeError('loadOrg must be a function.');
  if (!/^\d{8,20}$/.test(String(expectedZgid))) throw new TypeError('expectedZgid must be a numeric Zoho organization identifier.');
  if (!Number.isSafeInteger(cacheTtlMs) || cacheTtlMs < 0) throw new TypeError('cacheTtlMs must be a non-negative integer.');

  let verifiedAt = 0;
  let verification = null;

  async function assertExpectedOrg(options = {}) {
    if (verifiedAt && now() - verifiedAt < cacheTtlMs) return { verified: true };
    if (verification) return verification;

    verification = Promise.resolve()
      .then(() => loadOrg(options))
      .then(payload => {
        const organizations = Array.isArray(payload?.org) ? payload.org : [];
        if (organizations.length !== 1 || String(organizations[0]?.zgid || '') !== String(expectedZgid)) {
          verifiedAt = 0;
          throw orgMismatchError();
        }
        verifiedAt = now();
        return { verified: true };
      })
      .catch(error => {
        verifiedAt = 0;
        if (error?.code === 'ZOHO_ORG_MISMATCH') throw error;
        const wrapped = new Error('Unable to verify the locked Zoho source organization.');
        wrapped.code = 'ZOHO_ORG_VERIFICATION_FAILED';
        throw wrapped;
      })
      .finally(() => { verification = null; });

    return verification;
  }

  function clear() {
    verifiedAt = 0;
  }

  return { assertExpectedOrg, clear };
}

module.exports = {
  EXPECTED_ZOHO_ZGID,
  DEFAULT_CACHE_TTL_MS,
  createZohoOrgGuard,
};
