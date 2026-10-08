#!/usr/bin/env node
'use strict';

// Exact, audit-only reconciliation of active Zoho Note IDs against the local
// source-derived replica. Zoho CRM access is GET-only and local database access
// is SELECT-only. Raw IDs and record payloads are never logged or persisted.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ROOT = path.join(__dirname, '..');
const PRIVATE_DIR = path.join(ROOT, '.private', 'data-reconciliation');
const PRIVATE_AUDIT = path.join(PRIVATE_DIR, 'notes-latest.json');
const API = String(process.env.ZOHO_API_DOMAIN || '');
const ACCOUNTS = String(process.env.ZOHO_ACCOUNTS_URL || '');
const SUPA = String(process.env.SUPABASE_URL || '');
const KEY = process.env.SUPABASE_ANON_KEY;
const SECRET = process.env.CRM_SQL_SECRET;
const EXPECTED_ORG = String(process.env.ZOHO_CRM_ORG_ID || process.env.ZOHO_ORGANIZATION_ID || '').trim();
const EMPTY_SET_SHA256 = crypto.createHash('sha256').update('').digest('hex');
const AUDIT_KEYS = Object.freeze([
  'schema_version',
  'dataset',
  'started_at',
  'completed_at',
  'source_mode',
  'crm_methods_used',
  'local_mode',
  'status',
  'source_count_endpoint',
  'source_count_endpoint_status',
  'source_active_id_count',
  'local_source_derived_id_count',
  'source_ids_sha256',
  'local_source_ids_sha256',
  'source_only_id_count',
  'local_only_source_id_count',
  'source_only_ids_sha256',
  'local_only_source_ids_sha256',
  'source_record_writes',
  'local_record_writes',
  'local_record_deletes',
]);

let accessToken = null;
let accessTokenPromise = null;

function parseArguments(argv = process.argv.slice(2)) {
  const options = { persistAudit: false, help: false };
  for (const argument of argv) {
    if (argument === '--audit') options.persistAudit = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else throw new Error('Unknown Notes reconciliation argument');
  }
  return options;
}

function usage() {
  return [
    'Usage: node scripts/reconcile-notes.js [--audit]',
    '',
    'Without --audit, runs the same GET-only/SELECT-only comparison without persisting it.',
    'With --audit, atomically persists only an exact zero-gap sanitized private audit.',
  ].join('\n');
}

function assertConfiguredHttps(value, label, hostnamePattern) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} is not a permitted HTTPS endpoint`);
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || !hostnamePattern.test(parsed.hostname)
  ) throw new Error(`${label} is not a permitted HTTPS endpoint`);
}

async function token() {
  if (accessToken) return accessToken;
  if (!accessTokenPromise) {
    const params = new URLSearchParams({
      refresh_token: process.env.ZOHO_REFRESH_TOKEN || '',
      client_id: process.env.ZOHO_CLIENT_ID || '',
      client_secret: process.env.ZOHO_CLIENT_SECRET || '',
      grant_type: 'refresh_token',
    });
    accessTokenPromise = fetch(`${ACCOUNTS}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    }).then(async response => {
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.access_token) throw new Error(`Zoho authentication failed (${response.status})`);
      accessToken = body.access_token;
      return accessToken;
    }).finally(() => {
      accessTokenPromise = null;
    });
  }
  return accessTokenPromise;
}

function assertSourcePath(pathname) {
  const parsed = new URL(pathname, 'https://source.invalid');
  if (parsed.origin !== 'https://source.invalid') throw new Error('Unexpected Zoho CRM path');
  if (parsed.pathname === '/crm/v8/org' && !parsed.search) return;
  if (parsed.pathname === '/crm/v8/Notes/actions/count' && !parsed.search) return;
  if (parsed.pathname !== '/crm/v8/Notes') throw new Error('Zoho CRM path is outside the Notes audit allowlist');

  const allowedParameters = new Set(['fields', 'per_page', 'page', 'page_token']);
  for (const key of parsed.searchParams.keys()) {
    if (!allowedParameters.has(key)) throw new Error('Zoho CRM Notes query is outside the audit allowlist');
  }
  if (parsed.searchParams.get('fields') !== 'Modified_Time' || parsed.searchParams.get('per_page') !== '200') {
    throw new Error('Zoho CRM Notes query is outside the audit allowlist');
  }
  const page = parsed.searchParams.get('page');
  const pageToken = parsed.searchParams.get('page_token');
  if ((page === '1') === Boolean(pageToken)) throw new Error('Zoho CRM Notes pagination is invalid');
}

async function sourceGet(pathname, retries = 3) {
  assertSourcePath(pathname);
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const response = await fetch(`${API}${pathname}`, {
      method: 'GET',
      headers: { Authorization: `Zoho-oauthtoken ${await token()}` },
    });
    if ((response.status === 429 || response.status >= 500) && attempt < retries) {
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      continue;
    }
    if (response.status === 204) return null;
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`Zoho CRM GET failed (${response.status})`);
    return body;
  }
  throw new Error('Zoho CRM GET retry limit exceeded');
}

async function rpc(functionName, body, retries = 3) {
  if (functionName !== 'crm_sql') throw new Error('Notes audit permits only the local SELECT RPC');
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const response = await fetch(`${SUPA}/rest/v1/rpc/${functionName}`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, s: SECRET }),
    });
    if (response.ok) return response.json().catch(() => null);
    if (attempt === retries) throw new Error(`Local SELECT failed (${response.status})`);
    await new Promise(resolve => setTimeout(resolve, 750 * (attempt + 1)));
  }
  throw new Error('Local SELECT retry limit exceeded');
}

async function sql(query) {
  if (query !== "select id from crm_records where module = 'Notes' and id ~ '^[0-9]+$' order by id") {
    throw new Error('Unexpected local Notes audit query');
  }
  return rpc('crm_sql', { q: query });
}

async function verifyOrganization(sourceGetFn = sourceGet) {
  if (!EXPECTED_ORG) throw new Error('Configured Zoho CRM organization ID is required');
  const body = await sourceGetFn('/crm/v8/org');
  const organization = body?.org?.[0] || {};
  const candidates = [organization.id, organization.zgid, organization.domain_name].filter(Boolean).map(String);
  if (!candidates.includes(EXPECTED_ORG)) throw new Error('Authenticated Zoho organization does not match the configured source organization');
}

async function sourceActiveNoteIds(sourceGetFn = sourceGet) {
  const ids = new Set();
  let pageToken = null;
  for (let page = 1; page <= 500; page += 1) {
    const query = pageToken
      ? `fields=Modified_Time&per_page=200&page_token=${encodeURIComponent(pageToken)}`
      : 'fields=Modified_Time&per_page=200&page=1';
    const body = await sourceGetFn(`/crm/v8/Notes?${query}`);
    for (const row of body?.data || []) {
      const id = String(row?.id || '');
      if (!/^\d+$/.test(id)) throw new Error('Source Notes response contained an invalid ID');
      if (ids.has(id)) throw new Error('Source Notes pagination returned a duplicate ID');
      ids.add(id);
    }
    if (!body?.info?.more_records) return ids;
    pageToken = body?.info?.next_page_token;
    if (!pageToken) throw new Error('Source Notes pagination ended without a next-page token');
  }
  throw new Error('Source Notes pagination exceeded the safety limit');
}

async function sourceNoteCount(sourceGetFn = sourceGet) {
  const body = await sourceGetFn('/crm/v8/Notes/actions/count');
  if (body?.count === null || body?.count === undefined || body?.count === '') {
    throw new Error('Source Notes count endpoint did not return a non-negative integer');
  }
  const count = Number(body?.count);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Source Notes count endpoint did not return a non-negative integer');
  return count;
}

async function localSourceNoteIds(sqlFn = sql) {
  const rows = await sqlFn("select id from crm_records where module = 'Notes' and id ~ '^[0-9]+$' order by id");
  const ids = new Set();
  for (const row of rows || []) {
    const id = String(row?.id || '');
    if (!/^\d+$/.test(id)) throw new Error('Local Notes query contained an invalid source-derived ID');
    if (ids.has(id)) throw new Error('Local Notes query returned a duplicate ID');
    ids.add(id);
  }
  return ids;
}

function diff(left, right) {
  return [...left].filter(id => !right.has(id)).sort();
}

function hashIds(ids) {
  return crypto.createHash('sha256').update([...ids].map(String).sort().join('\n')).digest('hex');
}

function isoTimestamp(value, label) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO timestamp`);
  return new Date(value).toISOString();
}

function buildSanitizedAudit({ sourceIds, localIds, sourceCountEndpoint, startedAt, completedAt }) {
  if (!(sourceIds instanceof Set) || !(localIds instanceof Set)) throw new Error('Notes audit ID sets are required');
  if (!Number.isSafeInteger(sourceCountEndpoint) || sourceCountEndpoint < sourceIds.size) {
    throw new Error('Source Notes aggregate count is invalid or narrower than the active-ID set');
  }
  const sourceOnly = diff(sourceIds, localIds);
  const localOnly = diff(localIds, sourceIds);
  const exact = sourceOnly.length === 0 && localOnly.length === 0;
  return {
    schema_version: 1,
    dataset: 'Notes',
    started_at: isoTimestamp(startedAt, 'started_at'),
    completed_at: isoTimestamp(completedAt, 'completed_at'),
    source_mode: 'read-only',
    crm_methods_used: ['GET'],
    local_mode: 'select-only',
    status: exact ? 'reconciled' : 'gap_detected',
    source_count_endpoint: sourceCountEndpoint,
    source_count_endpoint_status: 'observed_same_audit_epoch',
    source_active_id_count: sourceIds.size,
    local_source_derived_id_count: localIds.size,
    source_ids_sha256: hashIds(sourceIds),
    local_source_ids_sha256: hashIds(localIds),
    source_only_id_count: sourceOnly.length,
    local_only_source_id_count: localOnly.length,
    source_only_ids_sha256: hashIds(sourceOnly),
    local_only_source_ids_sha256: hashIds(localOnly),
    source_record_writes: 0,
    local_record_writes: 0,
    local_record_deletes: 0,
  };
}

function validatePersistableAudit(audit) {
  if (!audit || typeof audit !== 'object' || Array.isArray(audit)) throw new Error('Notes audit must be an object');
  const keys = Object.keys(audit).sort();
  const expectedKeys = [...AUDIT_KEYS].sort();
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error('Notes audit schema contains an unexpected field');
  }
  if (
    audit.schema_version !== 1
    || audit.dataset !== 'Notes'
    || audit.source_mode !== 'read-only'
    || audit.local_mode !== 'select-only'
    || audit.status !== 'reconciled'
    || JSON.stringify(audit.crm_methods_used) !== '["GET"]'
    || audit.source_count_endpoint_status !== 'observed_same_audit_epoch'
  ) throw new Error('Notes audit is not exact read-only evidence');
  isoTimestamp(audit.started_at, 'started_at');
  isoTimestamp(audit.completed_at, 'completed_at');
  if (Date.parse(audit.completed_at) < Date.parse(audit.started_at)) throw new Error('Notes audit timestamps are out of order');
  for (const key of [
    'source_count_endpoint',
    'source_active_id_count',
    'local_source_derived_id_count',
    'source_only_id_count',
    'local_only_source_id_count',
    'source_record_writes',
    'local_record_writes',
    'local_record_deletes',
  ]) {
    if (!Number.isSafeInteger(audit[key]) || audit[key] < 0) throw new Error(`Notes audit ${key} is invalid`);
  }
  if (
    audit.source_active_id_count !== audit.local_source_derived_id_count
    || audit.source_only_id_count !== 0
    || audit.local_only_source_id_count !== 0
    || audit.source_record_writes !== 0
    || audit.local_record_writes !== 0
    || audit.local_record_deletes !== 0
  ) throw new Error('Notes audit is not zero-gap, zero-write evidence');
  for (const key of ['source_ids_sha256', 'local_source_ids_sha256', 'source_only_ids_sha256', 'local_only_source_ids_sha256']) {
    if (!/^[a-f0-9]{64}$/.test(String(audit[key] || ''))) throw new Error(`Notes audit ${key} is invalid`);
  }
  if (
    audit.source_ids_sha256 !== audit.local_source_ids_sha256
    || audit.source_only_ids_sha256 !== EMPTY_SET_SHA256
    || audit.local_only_source_ids_sha256 !== EMPTY_SET_SHA256
  ) throw new Error('Notes audit digests do not prove exact zero-gap parity');
  return audit;
}

function writePrivateAudit(audit, destination = PRIVATE_AUDIT) {
  validatePersistableAudit(audit);
  const directory = path.dirname(destination);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  const temporary = path.join(directory, `.notes-audit-${process.pid}-${Date.now()}.tmp`);
  let descriptor = null;
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(temporary, destination);
    fs.chmodSync(destination, 0o600);
    const directoryDescriptor = fs.openSync(directory, 'r');
    try {
      fs.fsyncSync(directoryDescriptor);
    } finally {
      fs.closeSync(directoryDescriptor);
    }
  } catch (error) {
    if (descriptor !== null) fs.closeSync(descriptor);
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

async function runAudit({
  sourceGetFn = sourceGet,
  localIdsFn = localSourceNoteIds,
  now = () => new Date().toISOString(),
} = {}) {
  const startedAt = now();
  await verifyOrganization(sourceGetFn);
  const sourceIds = await sourceActiveNoteIds(sourceGetFn);
  const sourceCountEndpoint = await sourceNoteCount(sourceGetFn);
  const localIds = await localIdsFn();
  return buildSanitizedAudit({
    sourceIds,
    localIds,
    sourceCountEndpoint,
    startedAt,
    completedAt: now(),
  });
}

async function main() {
  const options = parseArguments();
  if (options.help) {
    console.log(usage());
    return;
  }
  assertConfiguredHttps(API, 'ZOHO_API_DOMAIN', /(^|\.)zohoapis\.(in|com|eu|com\.au|jp|ca)$/i);
  assertConfiguredHttps(ACCOUNTS, 'ZOHO_ACCOUNTS_URL', /(^|\.)zoho\.(in|com|eu|com\.au|jp|ca)$/i);
  assertConfiguredHttps(SUPA, 'SUPABASE_URL', /(^|\.)supabase\.co$/i);
  console.log('Notes reconciliation: verifying the configured read-only source organization');
  const audit = await runAudit();
  console.log(`Notes reconciliation: source active ${audit.source_active_id_count}; local source-derived ${audit.local_source_derived_id_count}; source-only ${audit.source_only_id_count}; local-only ${audit.local_only_source_id_count}`);
  if (audit.status !== 'reconciled') {
    throw new Error('Notes active-ID parity is not exact; private exact-parity evidence was not replaced');
  }
  if (options.persistAudit) {
    writePrivateAudit(audit);
    console.log('Notes reconciliation: exact zero-gap private audit persisted atomically; source record writes 0; local record writes 0; local deletes 0');
  } else {
    console.log('Notes reconciliation: exact dry run complete; no audit or record write was made');
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  AUDIT_KEYS,
  EMPTY_SET_SHA256,
  PRIVATE_AUDIT,
  assertSourcePath,
  buildSanitizedAudit,
  diff,
  hashIds,
  parseArguments,
  runAudit,
  sourceActiveNoteIds,
  sourceNoteCount,
  usage,
  validatePersistableAudit,
  writePrivateAudit,
};
