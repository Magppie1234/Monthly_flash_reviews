#!/usr/bin/env node
'use strict';

// Exact, idempotent source-to-local reconciliation for Tasks and four
// generated subform datasets. Zoho CRM transport is GET-only. Local writes are
// restricted to source-present/local-missing IDs and require --apply.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const util = require('util');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ROOT = path.join(__dirname, '..');
const PRIVATE_DIR = path.join(ROOT, '.private', 'data-reconciliation');
const PRIVATE_AUDIT = path.join(PRIVATE_DIR, 'tasks-subforms-latest.json');
const PRIVATE_PREVIEW_AUDIT = path.join(PRIVATE_DIR, 'tasks-subforms-preview.json');
const APPLY = process.argv.includes('--apply');
const API = String(process.env.ZOHO_API_DOMAIN || '');
const ACCOUNTS = String(process.env.ZOHO_ACCOUNTS_URL || '');
const SUPA = String(process.env.SUPABASE_URL || '');
const KEY = process.env.SUPABASE_ANON_KEY;
const SECRET = process.env.CRM_SQL_SECRET;
const EXPECTED_ORG = String(process.env.ZOHO_CRM_ORG_ID || process.env.ZOHO_ORGANIZATION_ID || '').trim();
let VERIFIED_SOURCE_ORG_ID = null;

const TARGETS = Object.freeze([
  { module: 'Tasks', generated_type: 'default', parent_module: null, parent_field: null, name_fields: ['Subject'] },
  { module: 'Product_Details', generated_type: 'subform', parent_module: 'Deals', parent_field: 'Sunrooof_Products', name_fields: ['Product', 'Area'] },
  { module: 'Product_Details1', generated_type: 'subform', parent_module: 'Contacts', parent_field: 'Product_Details1', name_fields: ['Product_Name', 'Product'] },
  { module: 'Project_Details', generated_type: 'subform', parent_module: 'Developers', parent_field: 'Project_Details', name_fields: ['Project_Name'] },
  { module: 'Project_Detail', generated_type: 'subform', parent_module: 'Contacts', parent_field: 'Project_Detail', name_fields: ['Project_Name'] },
]);
const TARGET_BY_MODULE = new Map(TARGETS.map(target => [target.module, target]));

let accessToken = null;

function assertHttpsEndpoint(value, label, hostnamePattern) {
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || !hostnamePattern.test(parsed.hostname)) {
    throw new Error(`${label} is not a permitted HTTPS endpoint`);
  }
}

async function token() {
  if (accessToken) return accessToken;
  const params = new URLSearchParams({
    refresh_token: process.env.ZOHO_REFRESH_TOKEN || '',
    client_id: process.env.ZOHO_CLIENT_ID || '',
    client_secret: process.env.ZOHO_CLIENT_SECRET || '',
    grant_type: 'refresh_token',
  });
  const response = await fetch(`${ACCOUNTS}/oauth/v2/token?${params}`, { method: 'POST' });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.access_token) throw new Error(`Zoho authentication failed (${response.status})`);
  accessToken = body.access_token;
  return accessToken;
}

function assertSourcePath(pathname) {
  const parsed = new URL(pathname, 'https://source.invalid');
  if (parsed.origin !== 'https://source.invalid' || !parsed.pathname.startsWith('/crm/v8/')) {
    throw new Error('Unexpected Zoho CRM path');
  }
  const allowed = parsed.pathname === '/crm/v8/org'
    || TARGETS.some(target => parsed.pathname === `/crm/v8/settings/fields` && parsed.searchParams.get('module') === target.module)
    || TARGETS.some(target => parsed.pathname === `/crm/v8/${target.module}`)
    || TARGETS.some(target => parsed.pathname === `/crm/v8/${target.module}/actions/count`);
  if (!allowed) throw new Error('Zoho CRM path is outside the reconciliation allowlist');
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
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const response = await fetch(`${SUPA}/rest/v1/rpc/${functionName}`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, s: SECRET }),
    });
    if (response.ok) return response.json().catch(() => null);
    if (attempt === retries) throw new Error(`Local ${functionName} failed (${response.status})`);
    await new Promise(resolve => setTimeout(resolve, 750 * (attempt + 1)));
  }
  throw new Error(`Local ${functionName} retry limit exceeded`);
}

async function sql(query) {
  return rpc('crm_sql', { q: query });
}

const literal = value => `'${String(value).replace(/'/g, "''")}'`;

function chunks(values, size) {
  const out = [];
  for (let index = 0; index < values.length; index += size) out.push(values.slice(index, index + size));
  return out;
}

function diff(left, right) {
  return [...left].filter(id => !right.has(id)).sort();
}

function hashIds(ids) {
  return crypto.createHash('sha256').update([...ids].sort().join('\n')).digest('hex');
}

function classifyCountScope(target, reportedCount, activeCount) {
  if (!Number.isFinite(reportedCount) || !Number.isInteger(activeCount) || activeCount < 0) {
    throw new Error(`${target.module} count evidence is invalid`);
  }
  const delta = reportedCount - activeCount;
  if (target.generated_type !== 'subform' && delta !== 0) {
    throw new Error(`${target.module} count/enumeration mismatch (${reportedCount} reported; ${activeCount} enumerated)`);
  }
  if (target.generated_type === 'subform' && delta < 0) {
    throw new Error(`${target.module} count endpoint is lower than the reconciled active-ID set`);
  }
  return {
    delta,
    blocker: delta > 0 ? `${delta} count-only rows have no IDs or payloads in the active records API and are not importable` : null,
  };
}

function fieldChunks(fields) {
  const usable = fields.filter(field => field?.api_name && field.api_name !== 'id'
    && !['subform', 'fileupload', 'imageupload', 'profileimage'].includes(field.data_type));
  const names = [...new Set(usable.map(field => field.api_name))];
  if (!names.includes('Created_Time')) names.push('Created_Time');
  if (!names.includes('Modified_Time')) names.push('Modified_Time');
  return chunks(names, 45);
}

function mergeChunkRows(base, rows, requestedFields) {
  const ids = new Set();
  rows.forEach(row => {
    const id = String(row?.id || '');
    if (!/^\d+$/.test(id)) throw new Error('Source response contained an invalid record ID');
    if (ids.has(id)) throw new Error('Source pagination returned a duplicate record ID');
    ids.add(id);
    const previous = base.get(id) || {};
    base.set(id, { ...previous, ...row });
  });
  return {
    ids,
    requested_field_count: requestedFields.length,
    returned_field_names: [...new Set(rows.flatMap(row => Object.keys(row).filter(key => key !== 'id')))].sort(),
  };
}

function assertSameIds(expected, actual, module, chunkIndex) {
  if (!expected) return;
  const missing = diff(expected, actual);
  const extra = diff(actual, expected);
  if (missing.length || extra.length) {
    throw new Error(`${module} source ID set changed between field chunks (${chunkIndex}; missing ${missing.length}; extra ${extra.length})`);
  }
}

async function enumerateChunk(module, requestedFields) {
  const rows = [];
  let pageToken = null;
  for (let page = 1; page <= 500; page += 1) {
    const params = new URLSearchParams({ fields: requestedFields.join(','), per_page: '200' });
    if (pageToken) params.set('page_token', pageToken);
    else params.set('page', '1');
    const body = await sourceGet(`/crm/v8/${module}?${params}`);
    rows.push(...(body?.data || []));
    if (!body?.info?.more_records) return rows;
    pageToken = body?.info?.next_page_token;
    if (!pageToken) throw new Error(`${module} source pagination ended without a next-page token`);
  }
  throw new Error(`${module} source pagination exceeded the safety limit`);
}

async function enumerateSource(target) {
  const [fieldBody, countBody] = await Promise.all([
    sourceGet(`/crm/v8/settings/fields?module=${target.module}`),
    sourceGet(`/crm/v8/${target.module}/actions/count`),
  ]);
  const fields = fieldBody?.fields || [];
  if (!fields.length) throw new Error(`${target.module} field metadata is unavailable`);
  if (target.generated_type === 'subform') {
    const parentField = fields.find(field => field.api_name === 'Parent_Id');
    if (parentField?.data_type !== 'lookup' || parentField.lookup?.module?.api_name !== target.parent_module) {
      throw new Error(`${target.module} Parent_Id metadata does not identify the expected parent module`);
    }
  }
  const requests = fieldChunks(fields);
  if (!requests.length) throw new Error(`${target.module} has no safely enumerable fields`);
  const records = new Map();
  let expectedIds = null;
  const chunkCoverage = [];
  for (let index = 0; index < requests.length; index += 1) {
    const rows = await enumerateChunk(target.module, requests[index]);
    const coverage = mergeChunkRows(records, rows, requests[index]);
    assertSameIds(expectedIds, coverage.ids, target.module, index + 1);
    expectedIds = expectedIds || coverage.ids;
    chunkCoverage.push({
      chunk: index + 1,
      requested_field_count: coverage.requested_field_count,
      returned_field_count: coverage.returned_field_names.length,
      enumerated_record_count: coverage.ids.size,
    });
  }
  const count = Number(countBody?.count ?? NaN);
  if (!Number.isFinite(count)) throw new Error(`${target.module} count endpoint did not return a number`);
  const countScope = classifyCountScope(target, count, records.size);
  return {
    fields,
    records,
    reported_count: count,
    count_scope_delta: countScope.delta,
    active_id_authority: `GET /crm/v8/${target.module}`,
    count_only_blocker: countScope.blocker,
    chunk_coverage: chunkCoverage,
  };
}

async function localIds(module) {
  const rows = await sql(`select id from crm_records where module = ${literal(module)} and id ~ '^[0-9]+$' order by id`);
  return new Set((rows || []).map(row => String(row.id)));
}

function parentModuleName(parent) {
  const module = parent?.module;
  return typeof module === 'string' ? module : module?.api_name;
}

function validateSourceRecord(target, record) {
  if (!record || !/^\d+$/.test(String(record.id || ''))) throw new Error(`${target.module} source payload has no valid ID`);
  for (const field of ['Created_Time', 'Modified_Time']) {
    if (!Object.prototype.hasOwnProperty.call(record, field) || typeof record[field] !== 'string') {
      throw new Error(`${target.module} source payload ${record.id} omitted ${field}`);
    }
  }
  if (target.generated_type === 'subform') {
    if (!record.Parent_Id || !/^\d+$/.test(String(record.Parent_Id.id || ''))) {
      throw new Error(`${target.module} source payload ${record.id} has no parent ID`);
    }
    const payloadParentModule = parentModuleName(record.Parent_Id);
    if (payloadParentModule && payloadParentModule !== target.parent_module) {
      throw new Error(`${target.module} source payload ${record.id} has an unexpected parent module`);
    }
  }
}

function scalarName(record, target) {
  for (const field of target.name_fields) {
    const value = record[field];
    if (typeof value === 'string' && value) return value;
    if (value && typeof value === 'object' && typeof value.name === 'string') return value.name;
  }
  return null;
}

function searchText(record, target) {
  const names = [...target.name_fields, 'Description', 'Remarks', 'Product_SKU'];
  return names.map(field => record[field]).map(value => {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && typeof value.name === 'string') return value.name;
    return '';
  }).filter(Boolean).join(' ').slice(0, 500);
}

async function assertStillMissing(module, ids) {
  if (!ids.length) return;
  for (const batch of chunks(ids, 200)) {
    const rows = await sql(`select id from crm_records where module = ${literal(module)} and id in (${batch.map(literal).join(',')})`);
    if (rows.length) throw new Error(`${module} local state changed after preflight; refusing to overwrite an existing row`);
  }
}

async function upsertMissing(target, sourceRecords, missingIds) {
  await assertStillMissing(target.module, missingIds);
  if (!/^org\d{8,32}$/.test(String(VERIFIED_SOURCE_ORG_ID || ''))) {
    throw new Error('Verified source organization identity is unavailable');
  }
  const sourceSeenAt = new Date().toISOString();
  for (const batchIds of chunks(missingIds, 200)) {
    const rows = batchIds.map(id => {
      const record = sourceRecords.get(id);
      validateSourceRecord(target, record);
      return {
        module: target.module,
        id,
        data: record,
        name: scalarName(record, target),
        search_text: searchText(record, target),
        created_time: record.Created_Time,
        modified_time: record.Modified_Time,
        source_org_id: VERIFIED_SOURCE_ORG_ID,
        source_seen_at: sourceSeenAt,
      };
    });
    await rpc('crm_bulk_upsert', { rows });
  }
}

async function verifyPayloads(target, sourceRecords, importedIds) {
  for (const batch of chunks(importedIds, 100)) {
    const rows = await sql(`select id,data from crm_records where module = ${literal(target.module)} and id in (${batch.map(literal).join(',')}) order by id`);
    if (rows.length !== batch.length) throw new Error(`${target.module} imported-payload verification returned the wrong row count`);
    for (const row of rows) {
      if (!util.isDeepStrictEqual(row.data, sourceRecords.get(String(row.id)))) {
        throw new Error(`${target.module} imported payload ${row.id} differs from the exact source response`);
      }
    }
  }
}

function safeAuditModule(target, source, localBefore, sourceOnly, localOnly) {
  return {
    module: target.module,
    generated_type: target.generated_type,
    parent_module: target.parent_module,
    source_reported_count: source.reported_count,
    source_enumerated_count: source.records.size,
    source_count_scope_delta: source.count_scope_delta,
    source_ids_sha256: hashIds(source.records.keys()),
    local_source_id_count_before: localBefore.size,
    local_source_ids_sha256_before: hashIds(localBefore),
    source_only_count_before: sourceOnly.length,
    source_only_ids_sha256_before: hashIds(sourceOnly),
    source_only_ids: sourceOnly,
    local_only_count_before: localOnly.length,
    local_only_ids_sha256_before: hashIds(localOnly),
    local_only_ids: localOnly,
    field_chunk_coverage: source.chunk_coverage,
    active_id_authority: source.active_id_authority,
    count_only_blocker: source.count_only_blocker,
  };
}

function privateAuditPathForMode(apply, paths = { latest: PRIVATE_AUDIT, preview: PRIVATE_PREVIEW_AUDIT }) {
  return apply ? paths.latest : paths.preview;
}

function writePrivateAudit(audit, destination) {
  fs.mkdirSync(PRIVATE_DIR, { recursive: true, mode: 0o700 });
  fs.chmodSync(PRIVATE_DIR, 0o700);
  const temporary = path.join(PRIVATE_DIR, `.tasks-subforms-${process.pid}-${Date.now()}.tmp`);
  fs.writeFileSync(temporary, `${JSON.stringify(audit, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, destination);
  fs.chmodSync(destination, 0o600);
}

async function verifyOrganization() {
  if (!EXPECTED_ORG) throw new Error('Configured Zoho CRM organization ID is required');
  const body = await sourceGet('/crm/v8/org');
  const organization = body?.org?.[0] || {};
  const candidates = [organization.id, organization.zgid, organization.domain_name].filter(Boolean).map(String);
  if (!candidates.includes(EXPECTED_ORG)) throw new Error('Authenticated Zoho organization does not match the configured source organization');
  const stableNumericIdentity = [organization.zgid, organization.id]
    .map(value => String(value || '').replace(/^org/, ''))
    .find(value => /^\d{8,32}$/.test(value));
  if (!stableNumericIdentity) throw new Error('Authenticated Zoho organization has no stable numeric identity');
  VERIFIED_SOURCE_ORG_ID = `org${stableNumericIdentity}`;
}

async function main() {
  assertHttpsEndpoint(API, 'ZOHO_API_DOMAIN', /(^|\.)zohoapis\.(in|com|eu|com\.au|jp|ca)$/i);
  assertHttpsEndpoint(ACCOUNTS, 'ZOHO_ACCOUNTS_URL', /(^|\.)zoho\.(in|com|eu|com\.au|jp|ca)$/i);
  assertHttpsEndpoint(SUPA, 'SUPABASE_URL', /(^|\.)supabase\.co$/i);
  console.log('Task/subform reconciliation: verifying read-only source organization');
  await verifyOrganization();

  const plans = [];
  for (const target of TARGETS) {
    console.log(`${target.module}: enumerating all readable source fields and active IDs with CRM GET only`);
    const [source, localBefore] = await Promise.all([enumerateSource(target), localIds(target.module)]);
    const sourceIds = new Set(source.records.keys());
    const sourceOnly = diff(sourceIds, localBefore);
    const localOnly = diff(localBefore, sourceIds);
    for (const id of sourceOnly) validateSourceRecord(target, source.records.get(id));
    const audit = safeAuditModule(target, source, localBefore, sourceOnly, localOnly);
    plans.push({ target, source, localBefore, sourceOnly, localOnly, audit });
    console.log(`${target.module}: active source ${source.records.size}; count endpoint ${source.reported_count}; count-only/unavailable ${source.count_scope_delta}; local source-derived ${localBefore.size}; source-only ${sourceOnly.length}; local-only ${localOnly.length}; source-only set SHA-256 ${audit.source_only_ids_sha256_before}`);
  }

  const startedAt = new Date().toISOString();
  const audit = {
    schema_version: 1,
    started_at: startedAt,
    completed_at: null,
    source_mode: 'read-only',
    crm_methods_used: ['GET'],
    local_mode: APPLY ? 'missing-row upsert only' : 'dry-run',
    status: APPLY ? 'preflight-complete' : 'dry-run-complete',
    modules: plans.map(plan => plan.audit),
  };
  // A dry run or an interrupted apply must never replace the last completed
  // reconciliation evidence consumed by the runtime completeness endpoint.
  writePrivateAudit(audit, privateAuditPathForMode(false));
  if (!APPLY) {
    console.log('Dry run complete; no local writes or deletes were made. Preview ID evidence is stored separately from the last reconciled audit.');
    return;
  }

  for (const plan of plans) {
    if (plan.sourceOnly.length) {
      await upsertMissing(plan.target, plan.source.records, plan.sourceOnly);
      await verifyPayloads(plan.target, plan.source.records, plan.sourceOnly);
    }
    const localAfter = await localIds(plan.target.module);
    const sourceIds = new Set(plan.source.records.keys());
    const sourceOnlyAfter = diff(sourceIds, localAfter);
    const localOnlyAfter = diff(localAfter, sourceIds);
    if (sourceOnlyAfter.length) throw new Error(`${plan.target.module} still has ${sourceOnlyAfter.length} source-present/local-missing IDs after upsert`);
    if (!util.isDeepStrictEqual(localOnlyAfter, plan.localOnly)) throw new Error(`${plan.target.module} local-only ID set changed unexpectedly`);
    Object.assign(plan.audit, {
      imported_count: plan.sourceOnly.length,
      imported_payloads_verified: plan.sourceOnly.length,
      local_source_id_count_after: localAfter.size,
      local_source_ids_sha256_after: hashIds(localAfter),
      source_only_count_after: 0,
      local_only_count_after: localOnlyAfter.length,
      local_only_ids_sha256_after: hashIds(localOnlyAfter),
      local_excess_deleted_count: 0,
    });
    console.log(`${plan.target.module}: imported ${plan.sourceOnly.length}; exact payloads verified ${plan.sourceOnly.length}; source-only after 0; local-only preserved ${localOnlyAfter.length}; deletes 0`);
  }

  audit.completed_at = new Date().toISOString();
  audit.status = 'reconciled';
  writePrivateAudit(audit, privateAuditPathForMode(true));
  console.log('Task/subform reconciliation complete; Zoho CRM writes 0; local deletes 0.');
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  TARGETS,
  TARGET_BY_MODULE,
  assertSourcePath,
  classifyCountScope,
  chunks,
  diff,
  fieldChunks,
  hashIds,
  mergeChunkRows,
  parentModuleName,
  privateAuditPathForMode,
  safeAuditModule,
  validateSourceRecord,
};
