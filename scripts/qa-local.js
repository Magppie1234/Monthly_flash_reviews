#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ROOT = path.join(__dirname, '..');
const ORIGIN = `http://127.0.0.1:${process.env.CLONE_PORT || 3100}`;
const UNSUPPORTED_LEAD_VIEW = {
  id: '1032257000000029711',
  name: 'My Leads',
};
const SYNTHETIC_CONTACT_ID = 'local-1788023271479-969';
let cookie = '';

async function request(pathname, options = {}) {
  const response = await fetch(`${ORIGIN}${pathname}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body, headers: response.headers };
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function checkSyncScheduleShape(status, label) {
  check(status && typeof status === 'object' && !Array.isArray(status), `${label} is missing or invalid`);
  check(status.source_mode === 'read-only', `${label} source boundary is not read-only`);
  check(status.organization_lock === 'verified-before-refresh', `${label} organization lock is unavailable`);
  check(status.interval_minutes === 15, `${label} interval is not exactly 15 minutes`);
  check(typeof status.enabled === 'boolean', `${label} enabled flag is not boolean`);
  check(typeof status.started === 'boolean', `${label} started flag is not boolean`);
  check(typeof status.running === 'boolean', `${label} running flag is not boolean`);
  for (const field of ['next_run_at', 'last_started_at', 'last_finished_at', 'last_succeeded_at']) {
    const value = status[field];
    check(value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value))), `${label} ${field} is not null or a valid timestamp`);
  }
  check(status.last_trigger === null || (typeof status.last_trigger === 'string' && status.last_trigger.length > 0), `${label} last_trigger is invalid`);
  check(status.last_error === null || (typeof status.last_error === 'string' && status.last_error.length > 0), `${label} last_error is invalid`);
  check(!status.running || status.started, `${label} cannot be running while stopped`);
  check(status.started ? status.next_run_at !== null : status.next_run_at === null, `${label} next_run_at is inconsistent with started`);
}

function configuredPicklistLabels(fieldMetadata, apiName) {
  const field = (fieldMetadata?.fields || []).find(item => item.api_name === apiName);
  check(field, `Missing ${apiName} field metadata`);
  return (field.pick_list_values || [])
    .filter(value => value?.type !== 'unused')
    .slice()
    .sort((left, right) => Number(left.sequence_number || 0) - Number(right.sequence_number || 0))
    .map(value => String(value.display_value ?? value.actual_value ?? '').trim());
}

function configuredJourneyLabels(lane) {
  return (lane?.phases || [])
    .filter(phase => phase.kind === 'configured')
    .flatMap(phase => phase.stages || [])
    .map(stage => stage.label);
}

function journeyStageCount(lane) {
  return (lane?.phases || []).flatMap(phase => phase.stages || [])
    .reduce((sum, stage) => sum + Number(stage.count || 0), 0);
}

function checkFailClosed(response, { status, code, label }) {
  check(response.status === status, `${label} returned ${response.status}, expected ${status}`);
  check(response.body?.code === code, `${label} returned ${response.body?.code || 'no error code'}, expected ${code}`);
  check(!Object.prototype.hasOwnProperty.call(response.body || {}, 'data'), `${label} leaked a data payload`);
  check(!Object.prototype.hasOwnProperty.call(response.body || {}, 'records'), `${label} leaked a records payload`);
}

function findForbiddenWebhookField(value, currentPath = 'webhook') {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const match = findForbiddenWebhookField(value[index], `${currentPath}[${index}]`);
      if (match) return match;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;

  const allowedStorageMarkers = new Set(['endpoint_stored', 'headers_stored']);
  const forbiddenFragments = ['endpoint', 'url', 'header', 'credential', 'secret'];
  for (const [key, child] of Object.entries(value)) {
    const fieldPath = `${currentPath}.${key}`;
    const normalizedKey = key.toLowerCase();
    if (
      !allowedStorageMarkers.has(normalizedKey)
      && forbiddenFragments.some(fragment => normalizedKey.includes(fragment))
    ) return fieldPath;
    const match = findForbiddenWebhookField(child, fieldPath);
    if (match) return match;
  }
  return null;
}

function hasDefinitionContent(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return ['number', 'boolean'].includes(typeof value);
}

function findForbiddenEmailNotificationField(value, currentPath = 'email_notification') {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const match = findForbiddenEmailNotificationField(value[index], `${currentPath}[${index}]`);
      if (match) return match;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;

  const forbiddenNames = new Set([
    'address', 'email', 'email_address', 'from', 'from_address', 'reply_to', 'reply_to_address',
  ]);
  const forbiddenFragments = [
    'authorization', 'credential', 'secret', 'password', 'token', 'cookie', 'connection', 'header', 'endpoint', 'url',
  ];
  for (const [key, child] of Object.entries(value)) {
    const fieldPath = `${currentPath}.${key}`;
    const normalizedKey = key.toLowerCase();
    if (
      forbiddenNames.has(normalizedKey)
      || forbiddenFragments.some(fragment => normalizedKey.includes(fragment))
    ) return fieldPath;
    const match = findForbiddenEmailNotificationField(child, fieldPath);
    if (match) return match;
  }
  return null;
}

function findLiteralEmailAddress(value, currentPath = 'email_notification') {
  if (typeof value === 'string') {
    return /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value) ? currentPath : null;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const match = findLiteralEmailAddress(value[index], `${currentPath}[${index}]`);
      if (match) return match;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value)) {
    const match = findLiteralEmailAddress(child, `${currentPath}.${key}`);
    if (match) return match;
  }
  return null;
}

function findForbiddenFunctionBehaviorField(value, currentPath = 'function_behavior') {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const match = findForbiddenFunctionBehaviorField(value[index], `${currentPath}[${index}]`);
      if (match) return match;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const forbiddenNames = new Set([
    'body', 'code', 'content', 'sha256', 'hash', 'file', 'path', 'url', 'endpoint',
    'credential', 'credentials', 'secret', 'secret_scan', 'token', 'connection',
    'connection_dependencies', 'external_services', 'inputs', 'fields_read', 'fields_written',
  ]);
  for (const [key, child] of Object.entries(value)) {
    const fieldPath = `${currentPath}.${key}`;
    if (forbiddenNames.has(key.toLowerCase())) return fieldPath;
    const match = findForbiddenFunctionBehaviorField(child, fieldPath);
    if (match) return match;
  }
  return null;
}

function findForbiddenWidgetBehaviorField(value, currentPath = 'widget_behavior') {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const match = findForbiddenWidgetBehaviorField(value[index], `${currentPath}[${index}]`);
      if (match) return match;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const forbiddenNames = new Set([
    'archive_name', 'body', 'code', 'content', 'credential', 'credentials', 'endpoint',
    'external_url', 'file', 'hash', 'headers', 'local_path', 'path', 'secret', 'sha256',
    'source_body', 'source_code', 'token', 'url',
  ]);
  for (const [key, child] of Object.entries(value)) {
    const fieldPath = `${currentPath}.${key}`;
    if (forbiddenNames.has(key.toLowerCase())) return fieldPath;
    const match = findForbiddenWidgetBehaviorField(child, fieldPath);
    if (match) return match;
  }
  return null;
}

function findForbiddenNamedField(value, forbiddenNames, currentPath) {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const match = findForbiddenNamedField(value[index], forbiddenNames, `${currentPath}[${index}]`);
      if (match) return match;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value)) {
    const fieldPath = `${currentPath}.${key}`;
    if (forbiddenNames.has(key.toLowerCase())) return fieldPath;
    const match = findForbiddenNamedField(child, forbiddenNames, fieldPath);
    if (match) return match;
  }
  return null;
}

function isSyntheticArtifact(record) {
  return String(record?.id || '') === SYNTHETIC_CONTACT_ID
    || String(record?.__test_artifact || '').toLowerCase() === 'true';
}

async function checkSyntheticArtifactIsolation() {
  const search = await request('/api/search/Contacts?word=Layout%20test&per_page=100');
  check(search.status === 200 && Array.isArray(search.body?.data), `Contact search failed (${search.status})`);
  check(!search.body.data.some(isSyntheticArtifact), 'Synthetic Contact leaked into user-visible search results');

  const perPage = 2000;
  const seenIds = new Set();
  let visibleCount = 0;
  let finalInfo = null;
  let pages = 0;

  for (let page = 1; page <= 100; page += 1) {
    const list = await request(`/api/records/Contacts?per_page=${perPage}&page=${page}&sort_by=id&sort_order=asc`);
    check(list.status === 200 && Array.isArray(list.body?.data), `Contact list page ${page} failed (${list.status})`);
    check(!list.body.data.some(isSyntheticArtifact), `Synthetic Contact leaked into user-visible list page ${page}`);
    for (const record of list.body.data) {
      const id = String(record?.id || '');
      check(id && !seenIds.has(id), `Contact list pagination returned a duplicate or missing ID on page ${page}`);
      seenIds.add(id);
    }
    visibleCount += list.body.data.length;
    pages = page;
    finalInfo = list.body?.info || null;
    if (!finalInfo?.more_records) break;
  }

  check(finalInfo && !finalInfo.more_records, 'Contact list pagination did not terminate within 100 pages');

  for (let attempt = 0; attempt < 20 && !finalInfo?.total_exact; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 100));
    const countProbe = await request('/api/records/Contacts?per_page=1&page=1');
    check(countProbe.status === 200, `Contact count probe failed (${countProbe.status})`);
    finalInfo = countProbe.body?.info || null;
  }

  check(finalInfo?.total_exact === true, 'Contact list total did not become exact');
  check(Number(finalInfo.total) === visibleCount, `Contact list count mismatch: total=${finalInfo.total}, enumerated=${visibleCount}`);
  return { visibleCount, pages };
}

async function main() {
  if (process.env.ACCESS_CODE) {
    const auth = await request('/auth', {
      method: 'POST',
      body: JSON.stringify({ code: process.env.ACCESS_CODE }),
    });
    check(auth.status === 200, `Local authentication failed (${auth.status})`);
    cookie = String(auth.headers.get('set-cookie') || '').split(';')[0];
  }

  const version = await request('/api/version');
  check(version.status === 200 && version.body?.v, 'Version endpoint failed');

  const boot = await request('/api/boot');
  check(boot.status === 200, `Boot endpoint failed (${boot.status})`);
  check(boot.body?.zoho_source_mode === 'read-only', 'Zoho source boundary is not read-only');
  check(Array.isArray(boot.body?.modules?.modules) && boot.body.modules.modules.length > 0, 'No module metadata returned');
  checkSyncScheduleShape(boot.body?.sync_schedule, 'Boot sync schedule');

  const syncStatus = await request('/api/sync/status');
  check(syncStatus.status === 200, `Sync status endpoint failed (${syncStatus.status})`);
  checkSyncScheduleShape(syncStatus.body, 'Sync status');
  check(syncStatus.body.enabled === boot.body.sync_schedule.enabled, 'Sync status enabled flag disagrees with boot');
  check(syncStatus.body.interval_minutes === boot.body.sync_schedule.interval_minutes, 'Sync status interval disagrees with boot');

  const replicationHealth = await request('/api/meta/replication_health');
  check(replicationHealth.status === 200, `Replication-health endpoint failed (${replicationHealth.status})`);
  check(replicationHealth.body?.source_mode === 'read-only', 'Replication-health source boundary is not read-only');
  check(replicationHealth.body?.coverage?.module_definitions === 153, 'Replication-health module-definition count mismatch');
  check(replicationHealth.body?.coverage?.api_supported_modules === 122, 'Replication-health API-supported count mismatch');
  check(replicationHealth.body?.coverage?.scheduled_record_modules === 16, 'Replication-health scheduled-module count mismatch');
  check(replicationHealth.body?.coverage?.unscheduled_api_supported_modules === 106, 'Replication-health unscheduled-module count mismatch');
  check(replicationHealth.body?.coverage?.classification === 'partial_refresh', 'Replication-health coverage must disclose partial scope');
  const healthEvidence = new Map((replicationHealth.body?.reconciliation || []).map(item => [item.dataset_key, item]));
  for (const [datasetKey, expectedCount] of [['Notes', 67798], ['Tasks', 12422]]) {
    const evidence = healthEvidence.get(datasetKey);
    check(evidence?.current_local_count === expectedCount, `${datasetKey} health local count mismatch`);
    check(evidence?.current_source_count === expectedCount, `${datasetKey} health audited-source count mismatch`);
    check(evidence?.current_matches_audited_set === true, `${datasetKey} current local set no longer matches its exact private audit`);
    const sameEpoch = evidence?.local_observed_at === evidence?.source_recheck_at;
    check(
      sameEpoch
        ? evidence?.classification === 'reconciled_current' && evidence?.exact_source_local_parity === true
        : evidence?.classification === 'ahead_of_audit_recheck_required' && evidence?.exact_source_local_parity === false,
      `${datasetKey} same-epoch truth classification is inconsistent`,
    );
  }
  const exclusionKeys = ['attachments', 'child_datasets', 'dashboards', 'deletions', 'metadata', 'reports'];
  check(
    JSON.stringify(Object.keys(replicationHealth.body?.exclusions || {}).sort()) === JSON.stringify(exclusionKeys),
    'Replication-health exclusion inventory mismatch',
  );
  const deletionExclusion = replicationHealth.body?.exclusions?.deletions;
  check(
    deletionExclusion?.included === false && deletionExclusion?.classification === 'partial_refresh',
    'Deletion replication must remain an explicit partial-refresh exclusion while its runtime gates are unresolved',
  );
  check(
    exclusionKeys
      .filter(key => key !== 'deletions')
      .every(key => {
        const item = replicationHealth.body?.exclusions?.[key];
        return item?.included === false && item?.classification === 'unsupported_scope';
      }),
    'Non-deletion replication exclusions are not explicitly unsupported',
  );
  const forbiddenHealthField = findForbiddenNamedField(replicationHealth.body, new Set([
    'authorization', 'body', 'content', 'cookie', 'credential', 'credentials', 'email', 'emails',
    'hash', 'href', 'id', 'ids', 'name', 'names', 'password', 'path', 'payload', 'payloads',
    'phone', 'phones', 'secret', 'sha256', 'token', 'url', 'urls',
  ]), 'replication_health');
  check(!forbiddenHealthField, `Replication-health endpoint exposes forbidden field ${forbiddenHealthField}`);
  const serializedHealth = JSON.stringify(replicationHealth.body);
  check(!/https?:\/\/|\bwww\./i.test(serializedHealth), 'Replication-health endpoint exposes a URL');
  check(!/\b\d{15,25}\b|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(serializedHealth), 'Replication-health endpoint exposes customer or source identifiers');

  const analyticsTo = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const analyticsFrom = new Date(new Date(`${analyticsTo}T00:00:00.000Z`).getTime() - 29 * 86400000).toISOString().slice(0, 10);
  const [agentStatus, integrationStatus, analyticsOverview] = await Promise.all([
    request('/api/agent/status'),
    request('/api/integrations/status'),
    request(`/api/analytics/overview?from=${analyticsFrom}&to=${analyticsTo}`),
  ]);
  check(agentStatus.status === 200, `CRM assistant status failed (${agentStatus.status})`);
  check(agentStatus.body?.source_mode === 'local-replica-read-only', 'CRM assistant source boundary is not local read-only');
  check(agentStatus.body?.telemetry_enabled === false, 'CRM assistant telemetry must remain disabled');
  check(
    JSON.stringify(agentStatus.body?.tools) === JSON.stringify([
      'aggregate_records',
      'search_records',
      'get_record',
      'inspect_module_metadata',
      'prepare_record_creation_draft',
    ]),
    'CRM assistant tool allowlist drifted',
  );
  if (agentStatus.body?.available === true) {
    check(agentStatus.body?.permission_scope?.loaded === true, 'Available CRM assistant has no verified permission scope');
  } else {
    check(agentStatus.body?.reason_code === 'AI_GATEWAY_CREDENTIAL_MISSING', 'Unavailable CRM assistant has an unexpected blocker');
    check(agentStatus.body?.deterministic_available === true, 'Keyless deterministic CRM assistant is unavailable');
    check(agentStatus.body?.status === 'DeterministicOnly', 'Keyless CRM assistant mode is not explicit');
    check(agentStatus.body?.model === null, 'Keyless CRM assistant must not claim a model');
    check(agentStatus.body?.provider === 'Local deterministic parser', 'Keyless CRM assistant provider is not local deterministic');
    check(agentStatus.body?.network_attempted === false, 'Keyless CRM assistant attempted a network call');
    check(agentStatus.body?.fallback?.network_attempted === false, 'Keyless CRM assistant fallback attempted a network call');
    check(agentStatus.body?.permission_scope?.loaded === true, 'Keyless CRM assistant has no verified permission scope');
    const reviewedQuestions = agentStatus.body?.fallback?.reviewed_questions;
    const supportedQuestions = agentStatus.body?.fallback?.supported_questions;
    check(Array.isArray(reviewedQuestions) && reviewedQuestions.length === 7, 'Keyless CRM assistant reviewed-question contract drifted');
    check(Array.isArray(supportedQuestions) && Array.isArray(reviewedQuestions) && supportedQuestions.length === reviewedQuestions.length, 'Not all reviewed keyless CRM questions passed capability preflight');
    check(agentStatus.body?.fallback?.unavailable_questions?.length === 0, 'A reviewed keyless CRM question is unavailable');

    const askKeyless = prompt => request('/api/agent/chat', {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    });
    const countAnswer = await askKeyless('Count Leads by Lead Status');
    check(countAnswer.status === 200 && countAnswer.body?.status === 'Complete', 'Keyless Lead Status count failed');
    check(countAnswer.body?.deterministic_intent === 'count_leads_by_status', 'Keyless Lead Status intent drifted');
    check(JSON.stringify(countAnswer.body?.executed_tools) === JSON.stringify(['aggregate_records']), 'Keyless Lead Status count used an unexpected tool');
    check(/Leads by Lead Status/.test(countAnswer.body?.answer || ''), 'Keyless Lead Status answer is malformed');

    const overdueAnswer = await askKeyless('Find up to 10 overdue Tasks');
    check(overdueAnswer.status === 200 && overdueAnswer.body?.status === 'Complete', 'Keyless overdue Task lookup failed');
    check(overdueAnswer.body?.deterministic_intent === 'find_overdue_tasks', 'Keyless overdue Task intent drifted');
    check(JSON.stringify(overdueAnswer.body?.executed_tools) === JSON.stringify(['search_records']), 'Keyless overdue Task lookup used an unexpected tool');

    const requiredAnswer = await askKeyless('Show required fields for a new Lead');
    check(requiredAnswer.status === 200 && requiredAnswer.body?.status === 'Complete', 'Keyless Lead required-field lookup failed');
    check(requiredAnswer.body?.deterministic_intent === 'required_lead_fields', 'Keyless Lead required-field intent drifted');
    check(requiredAnswer.body?.answer?.includes('Last Name (Last_Name)'), 'Keyless Lead required-field answer omitted the exact mandatory Last_Name field');

    const draftAnswer = await askKeyless('Prepare a new Lead draft for review with Last Name: QA Preview Only');
    const draft = draftAnswer.body?.draft_preview;
    check(draftAnswer.status === 200 && draftAnswer.body?.status === 'Complete', 'Keyless Lead draft preview failed');
    check(draftAnswer.body?.deterministic_intent === 'prepare_lead_draft', 'Keyless Lead draft intent drifted');
    check(JSON.stringify(draftAnswer.body?.executed_tools) === JSON.stringify(['prepare_record_creation_draft']), 'Keyless Lead draft used an unexpected tool');
    check(draft?.status === 'PreviewOnly' && draft?.values?.Last_Name === 'QA Preview Only', 'Keyless Lead draft preview values are invalid');
    check(draft?.validation?.valid === true && draft?.validation?.metadata_complete === true, 'Keyless Lead draft did not pass mirrored required-field precheck');
    check(Object.values(draft?.execution || {}).every(value => value === false), 'Keyless Lead draft executed a write or outbound action');
    check(!JSON.stringify(draftAnswer.body).includes('/api/record'), 'Keyless Lead draft exposed a create route');

    const moduleCountAnswer = await askKeyless('Count records in Leads');
    check(moduleCountAnswer.status === 200 && moduleCountAnswer.body?.status === 'Complete', 'Keyless generic module count failed');
    check(moduleCountAnswer.body?.deterministic_intent === 'count_module_records', 'Keyless generic module-count intent drifted');
    check(JSON.stringify(moduleCountAnswer.body?.executed_tools) === JSON.stringify(['aggregate_records']), 'Keyless generic module count used an unexpected tool');
    check(/records in the permission-scoped local replica/.test(moduleCountAnswer.body?.answer || ''), 'Keyless generic module-count answer is malformed');

    const groupedCountAnswer = await askKeyless('Count records in Calls by Call Result');
    check(groupedCountAnswer.status === 200 && groupedCountAnswer.body?.status === 'Complete', 'Keyless generic grouped count failed');
    check(groupedCountAnswer.body?.deterministic_intent === 'count_module_by_safe_field', 'Keyless generic grouped-count intent drifted');
    check(JSON.stringify(groupedCountAnswer.body?.executed_tools) === JSON.stringify(['aggregate_records']), 'Keyless generic grouped count used an unexpected tool');
    check(/Calls by Call Result/.test(groupedCountAnswer.body?.answer || ''), 'Keyless generic grouped-count answer is malformed');

    const filteredGroupedCountAnswer = await askKeyless('Count records in Calls by Call Type where Call Result is empty');
    check(filteredGroupedCountAnswer.status === 200 && filteredGroupedCountAnswer.body?.status === 'Complete', 'Keyless filtered grouped count failed');
    check(filteredGroupedCountAnswer.body?.deterministic_intent === 'count_module_by_safe_field_where_empty', 'Keyless filtered grouped-count intent drifted');
    check(JSON.stringify(filteredGroupedCountAnswer.body?.executed_tools) === JSON.stringify(['aggregate_records']), 'Keyless filtered grouped count used an unexpected tool');
    check(/Calls by Call Type where Call Result is empty/.test(filteredGroupedCountAnswer.body?.answer || ''), 'Keyless filtered grouped-count answer is malformed');
    check(filteredGroupedCountAnswer.body?.draft_preview === null, 'Keyless filtered grouped count returned a draft');
    check(!Object.prototype.hasOwnProperty.call(filteredGroupedCountAnswer.body || {}, 'records'), 'Keyless filtered grouped count exposed customer records');
    check(!Object.prototype.hasOwnProperty.call(filteredGroupedCountAnswer.body || {}, 'data'), 'Keyless filtered grouped count exposed customer data');

    const unsafeFilteredAggregateAnswer = await askKeyless('Count records in Leads by Lead Status where Designer Name is empty');
    check(unsafeFilteredAggregateAnswer.status === 200 && unsafeFilteredAggregateAnswer.body?.deterministic_intent === 'count_module_by_safe_field_where_empty', 'Unsafe filtered aggregate prompt did not resolve to the bounded filtered intent');
    check(unsafeFilteredAggregateAnswer.body?.deterministic_reason_code === 'DETERMINISTIC_AGGREGATE_FIELD_UNAVAILABLE', 'Unsafe filtered aggregate prompt reason drifted');
    check(Array.isArray(unsafeFilteredAggregateAnswer.body?.executed_tools) && unsafeFilteredAggregateAnswer.body.executed_tools.length === 0, 'Unsafe filtered aggregate prompt executed a tool');
    check(!Object.prototype.hasOwnProperty.call(unsafeFilteredAggregateAnswer.body || {}, 'records'), 'Unsafe filtered aggregate prompt exposed customer records');
    check(!Object.prototype.hasOwnProperty.call(unsafeFilteredAggregateAnswer.body || {}, 'data'), 'Unsafe filtered aggregate prompt exposed customer data');

    const unsafeAggregateAnswer = await askKeyless('Count records in Leads by Designer Name');
    check(unsafeAggregateAnswer.status === 200 && unsafeAggregateAnswer.body?.deterministic_intent === 'count_module_by_safe_field', 'Unsafe aggregate prompt did not resolve to the bounded aggregate intent');
    check(unsafeAggregateAnswer.body?.deterministic_reason_code === 'DETERMINISTIC_AGGREGATE_FIELD_UNAVAILABLE', 'Unsafe aggregate prompt reason drifted');
    check(Array.isArray(unsafeAggregateAnswer.body?.executed_tools) && unsafeAggregateAnswer.body.executed_tools.length === 0, 'Unsafe aggregate prompt executed a tool');

    const unsupportedAnswer = await askKeyless('Delete every Lead');
    check(unsupportedAnswer.status === 200 && unsupportedAnswer.body?.deterministic_intent === 'unsupported', 'Unsupported keyless prompt did not fail closed');
    check(unsupportedAnswer.body?.deterministic_reason_code === 'DETERMINISTIC_PROMPT_UNSUPPORTED', 'Unsupported keyless prompt reason drifted');
    check(Array.isArray(unsupportedAnswer.body?.executed_tools) && unsupportedAnswer.body.executed_tools.length === 0, 'Unsupported keyless prompt executed a tool');

    const sensitiveAnswer = await askKeyless('password=qa-placeholder-value');
    check(sensitiveAnswer.status === 400 && sensitiveAnswer.body?.error?.code === 'AGENT_SENSITIVE_PROMPT_BLOCKED', 'Credential-shaped keyless prompt was not blocked');
    check(!JSON.stringify(sensitiveAnswer.body).includes('qa-placeholder-value'), 'Credential-shaped keyless prompt was echoed');
  }

  check(integrationStatus.status === 200 && integrationStatus.body?.ok === true, `Integration readiness failed (${integrationStatus.status})`);
  const ozonetelStatus = integrationStatus.body?.integrations?.ozonetel;
  const pickyAssistStatus = integrationStatus.body?.integrations?.picky_assist;
  check(ozonetelStatus?.provider === 'ozonetel', 'Ozonetel readiness contract is unavailable');
  check(ozonetelStatus?.source_mode === 'read-only-by-default', 'Ozonetel default source boundary is unsafe');
  check(Array.isArray(ozonetelStatus?.allowed_paths) && ozonetelStatus.allowed_paths.length === 3, 'Ozonetel destination allowlist drifted');
  check(typeof ozonetelStatus?.outbound_calls_enabled === 'boolean', 'Ozonetel outbound state is invalid');
  check(pickyAssistStatus?.provider === 'picky-assist', 'Picky Assist readiness contract is unavailable');
  check(pickyAssistStatus?.source_mode === 'read-only-by-default', 'Picky Assist default source boundary is unsafe');
  check(pickyAssistStatus?.push_url === 'https://pickyassist.com/app/api/v2/push', 'Picky Assist push destination drifted');
  check(typeof pickyAssistStatus?.outbound_messages_enabled === 'boolean', 'Picky Assist outbound state is invalid');

  check(analyticsOverview.status === 200, `Analytics overview failed (${analyticsOverview.status})`);
  check(analyticsOverview.body?.schema_version === 1, 'Analytics schema version drifted');
  check(analyticsOverview.body?.source?.query_mode === 'local-read-only', 'Analytics source boundary is not local read-only');
  check(analyticsOverview.body?.source?.output_grain === 'aggregate-only', 'Analytics output is not aggregate-only');
  check(analyticsOverview.body?.source?.customer_rows_or_identifiers === false, 'Analytics incorrectly claims customer-row output');
  check(JSON.stringify(analyticsOverview.body?.source?.tables) === JSON.stringify(['crm_records', 'crm_meta']), 'Analytics source-table allowlist drifted');
  check(analyticsOverview.body?.date_range?.from === analyticsFrom && analyticsOverview.body?.date_range?.to === analyticsTo && analyticsOverview.body?.date_range?.days === 30, 'Analytics 30-day date contract drifted');
  const expectedComparisonTo = new Date(new Date(`${analyticsFrom}T00:00:00.000Z`).getTime() - 86400000).toISOString().slice(0, 10);
  const expectedComparisonFrom = new Date(new Date(`${expectedComparisonTo}T00:00:00.000Z`).getTime() - 29 * 86400000).toISOString().slice(0, 10);
  const comparisonPeriod = analyticsOverview.body?.date_range?.comparison_period;
  check(
    comparisonPeriod?.from === expectedComparisonFrom
      && comparisonPeriod?.to === expectedComparisonTo
      && comparisonPeriod?.days === 30
      && comparisonPeriod?.time_zone === 'Asia/Kolkata',
    'Analytics comparison period is not the preceding 30-day period ending one day before the selected range',
  );
  check(Array.isArray(analyticsOverview.body?.hero_metrics) && analyticsOverview.body.hero_metrics.length === 6, 'Analytics executive metric count drifted');
  check(Array.isArray(analyticsOverview.body?.datasets?.module_inventory) && analyticsOverview.body.datasets.module_inventory.length === 6, 'Analytics module inventory count drifted');
  check(Array.isArray(analyticsOverview.body?.datasets?.pipeline_stage_mix) && analyticsOverview.body.datasets.pipeline_stage_mix.length === 3, 'Analytics pipeline lane count drifted');
  check(Array.isArray(analyticsOverview.body?.datasets?.activity_daily) && analyticsOverview.body.datasets.activity_daily.length === 30, 'Analytics daily activity series drifted');
  const periodComparison = analyticsOverview.body?.datasets?.period_comparison;
  const expectedComparisonModules = ['Leads', 'Contacts', 'Deals', 'Calls', 'Events'];
  check(Array.isArray(periodComparison) && periodComparison.length === 5, 'Analytics period-comparison metric count drifted');
  check(JSON.stringify((periodComparison || []).map(metric => metric.module)) === JSON.stringify(expectedComparisonModules), 'Analytics period-comparison module order drifted');
  check(!(periodComparison || []).some(metric => metric.module === 'Tasks'), 'Analytics period comparison must not include Tasks');
  for (const metric of periodComparison || []) {
    check(['available', 'data_not_available'].includes(metric.availability), `Analytics period-comparison availability is invalid for ${metric.module}`);
    if (metric.availability === 'data_not_available') {
      check(
        metric.current_count === null
          && metric.previous_count === null
          && metric.absolute_change === null
          && metric.percentage_change === null,
        `Unavailable analytics period comparison is not null-safe for ${metric.module}`,
      );
      continue;
    }
    check(Number.isSafeInteger(metric.current_count) && metric.current_count >= 0, `Analytics current-period count is invalid for ${metric.module}`);
    check(Number.isSafeInteger(metric.previous_count) && metric.previous_count >= 0, `Analytics previous-period count is invalid for ${metric.module}`);
    const expectedAbsoluteChange = metric.current_count - metric.previous_count;
    check(metric.absolute_change === expectedAbsoluteChange, `Analytics absolute period delta is invalid for ${metric.module}`);
    const expectedPercentageChange = metric.previous_count === 0
      ? null
      : Number(((expectedAbsoluteChange / metric.previous_count) * 100).toFixed(1));
    check(metric.percentage_change === expectedPercentageChange, `Analytics percentage period delta is invalid for ${metric.module}`);
  }
  check(Array.isArray(analyticsOverview.body?.data_quality?.checks) && analyticsOverview.body.data_quality.checks.length > 0, 'Analytics reconciliation checks are missing');
  check(analyticsOverview.body?.unsupported_metrics?.includes('lead_to_qualified_opportunity_conversion_rate'), 'Analytics no-conversion boundary is missing');
  check((analyticsOverview.body?.hero_metrics || []).every(metric => metric.value === null || (Number.isSafeInteger(metric.value) && metric.value >= 0)), 'Analytics returned an invalid metric value');
  const serializedAnalytics = JSON.stringify(analyticsOverview.body);
  check(!/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(serializedAnalytics), 'Analytics exposes a literal email address');
  const forbiddenAnalyticsField = findForbiddenNamedField(analyticsOverview.body, new Set([
    'customer', 'customer_id', 'email', 'full_name', 'mobile', 'owner', 'phone', 'record', 'record_id', 'records',
  ]), 'analytics');
  check(!forbiddenAnalyticsField, `Analytics exposes forbidden customer-level field ${forbiddenAnalyticsField}`);
  check(!/\b\d{15,25}\b/.test(serializedAnalytics), 'Analytics exposes a raw source identifier');

  const [dashboard, leadFields, contactFields] = await Promise.all([
    request('/api/dashboard?force=1'),
    request('/api/meta/fields?module=Leads'),
    request('/api/meta/fields?module=Contacts'),
  ]);
  check(dashboard.status === 200, `Journey dashboard failed (${dashboard.status})`);
  const journey = dashboard.body?.journey;
  check(journey?.schema_version === 1, 'Journey dashboard schema is unavailable');
  check(journey.source?.upstream_boundary === 'Zoho CRM read-only replication', 'Journey source boundary is not read-only');
  check(journey.bridge?.linked_conversion_available === false, 'Journey dashboard falsely exposes linked conversion');
  check(journey.cohort?.kind === 'all_records', 'All-time Journey cohort is mislabeled');
  const leadLane = journey.lanes?.leads;
  const opportunityLane = journey.lanes?.opportunities;
  check(leadLane?.module === 'Leads' && leadLane.field === 'Lead_Status', 'Journey Lead lane source field is incorrect');
  check(opportunityLane?.module === 'Contacts' && opportunityLane.field === 'Stage', 'Journey opportunity lane source field is incorrect');
  check(opportunityLane?.value_field === 'Total_Opportunity_Value' && opportunityLane.value_unit === 'lacs', 'Journey opportunity value basis is incorrect');
  check(
    JSON.stringify(configuredJourneyLabels(leadLane)) === JSON.stringify(configuredPicklistLabels(leadFields.body, 'Lead_Status')),
    'Journey Lead labels do not match active source picklist order',
  );
  check(
    JSON.stringify(configuredJourneyLabels(opportunityLane)) === JSON.stringify(configuredPicklistLabels(contactFields.body, 'Stage')),
    'Journey opportunity labels do not match active source picklist order',
  );
  check(journeyStageCount(leadLane) === Number(leadLane.record_count), 'Journey Lead aggregate does not reconcile to its stages');
  check(journeyStageCount(opportunityLane) === Number(opportunityLane.record_count), 'Journey opportunity aggregate does not reconcile to its stages');
  check(Number.isFinite(Number(opportunityLane.value_lacs)), 'Journey opportunity value is not numeric');

  const populatedLeadStage = leadLane.phases.flatMap(phase => phase.stages || [])
    .find(stage => stage.count > 0 && !stage.missing && stage.raw_values?.length);
  check(populatedLeadStage, 'Journey has no populated exact Lead stage for drilldown QA');
  const drillQuery = new URLSearchParams({ per_page: '10', page: '1' });
  populatedLeadStage.raw_values.forEach(value => drillQuery.append('value', value));
  const leadDrilldown = await request(`/api/dashboard/journey/records/leads?${drillQuery}`);
  check(leadDrilldown.status === 200, `Journey Lead drilldown failed (${leadDrilldown.status})`);
  check(leadDrilldown.body?.source_mode === 'local-read-only', 'Journey drilldown source mode is not local read-only');
  check(leadDrilldown.body?.match?.field === 'Lead_Status' && leadDrilldown.body?.match?.kind === 'exact', 'Journey drilldown match is not exact Lead_Status equality');
  check(
    (leadDrilldown.body?.data || []).every(record => populatedLeadStage.raw_values.includes(record.source_value)),
    'Journey Lead drilldown returned a non-contributing field value',
  );

  const invalidJourneyLane = await request('/api/dashboard/journey/records/qa-not-a-lane?value=test');
  check(invalidJourneyLane.status === 404 && invalidJourneyLane.body?.code === 'JOURNEY_LANE_NOT_FOUND', 'Unknown Journey lane did not fail closed');

  const buttons = await request('/api/meta/custom_buttons');
  check(buttons.status === 200 && Array.isArray(buttons.body?.buttons), 'Custom-button inventory endpoint failed');
  const readOnlyPreviewButtons = (buttons.body?.buttons || []).filter(button => button.local_status === 'Read-only preview');
  check(readOnlyPreviewButtons.length === 1, 'Custom-button inventory must expose exactly one read-only preview');
  const estimatePreviewButton = readOnlyPreviewButtons[0];
  check(String(estimatePreviewButton?.id || '') === '1032257000011958248', 'Unexpected custom button received read-only preview status');
  check(String(estimatePreviewButton?.action_reference?.id || '') === '1032257000012167001', 'Estimate custom-button action reference drifted');
  check(/calculation-only preview/i.test(estimatePreviewButton?.block_reason || ''), 'Estimate custom-button boundary does not state calculation-only preview');
  check(/full source action remains blocked/i.test(estimatePreviewButton?.block_reason || ''), 'Estimate custom-button boundary does not keep the full source action blocked');
  const reviseApproveButton = (buttons.body?.buttons || []).find(button => String(button?.id || '') === '1032257000017358923');
  check(
    reviseApproveButton?.module === 'Contacts'
      && reviseApproveButton?.name === 'Revise-Approve Quote'
      && reviseApproveButton?.api_name === 'Revise_Approve_Quote'
      && reviseApproveButton?.position === 'view'
      && reviseApproveButton?.action === 'widget'
      && reviseApproveButton?.source === 'crm'
      && reviseApproveButton?.sequence_number === 2
      && JSON.stringify(reviseApproveButton?.layout_ids || []) === JSON.stringify(['1032257000000000171', '1032257000005515301'])
      && String(reviseApproveButton?.action_reference?.id || '') === '1032257000017358913'
      && reviseApproveButton?.action_reference?.name === 'Revise-Approve Quote-Any Stage'
      && reviseApproveButton?.action_reference?.type === 'widget',
    'Revise-Approve exact Contacts view-button/widget/layout contract drifted',
  );
  check(reviseApproveButton?.local_status === 'Blocked', 'Revise-Approve captured source action must remain blocked');
  check(
    (buttons.body?.buttons || []).filter(button => String(button.id || '') !== '1032257000011958248').every(button => button.local_status === 'Blocked'),
    'A non-Estimate custom button was enabled or relaxed',
  );

  const dataCompleteness = await request('/api/meta/data_completeness');
  check(dataCompleteness.status === 200, `Data-completeness endpoint failed (${dataCompleteness.status})`);
  check(dataCompleteness.body?.source_mode === 'read-only', 'Data-completeness source boundary is not read-only');
  const auditedNoteCount = Number(dataCompleteness.body?.notes?.source_active_id_count);
  const currentNoteCount = Number(dataCompleteness.body?.notes?.current_local_source_derived_id_count);
  check(Number.isSafeInteger(auditedNoteCount) && auditedNoteCount > 0, 'Audited active source Note count is invalid');
  check(auditedNoteCount === 67798 && currentNoteCount === 67798, 'Current exact Note count evidence mismatch');
  check(dataCompleteness.body?.notes?.current_count_parity === true, 'Current Note count no longer matches the exact audit');
  check(dataCompleteness.body?.notes?.current_matches_audited_set === true, 'Current Note set no longer matches the private audited source set');
  check(dataCompleteness.body?.notes?.reconciliation_classification === 'ahead_of_audit_recheck_required', 'Later local Note observation must require a same-epoch source recheck');
  check(dataCompleteness.body?.notes?.source_only_id_count === 0 && dataCompleteness.body?.notes?.local_only_source_id_count === 0, 'Active Note ID parity is incomplete');
  check(dataCompleteness.body?.notes?.audited_snapshot_id_parity === true, 'Audited Note ID parity is not preserved');
  check(dataCompleteness.body?.notes?.current_exact_id_parity === null, 'Current Note parity incorrectly claims a same-epoch source/local comparison');
  check(dataCompleteness.body?.attachments?.source_id_count === 78758, 'Source attachment ID count mismatch');
  check(dataCompleteness.body?.attachments?.local_linked_record_count === 2, 'Local linked attachment count mismatch');
  check(dataCompleteness.body?.attachments?.current_local_linked_record_count === 2, 'Current source-derived linked attachment count mismatch');
  check(dataCompleteness.body?.attachments?.absent_local_id_count === 78756, 'Absent attachment ID count mismatch');
  check(dataCompleteness.body?.attachments?.current_absent_source_id_count === 78756, 'Current absent attachment count mismatch');
  check(dataCompleteness.body?.attachments?.source_declared_bytes === 205279257214, 'Source attachment declared-byte total mismatch');
  check(dataCompleteness.body?.attachments?.content_downloaded === false, 'Attachment completeness metadata incorrectly claims content download');
  check(dataCompleteness.body?.attachments?.storage_bucket_enumerated === false, 'Attachment completeness metadata incorrectly claims bucket enumeration');
  check(dataCompleteness.body?.related_lists?.source_definition_count === 375, 'Source related-list definition count mismatch');
  check(dataCompleteness.body?.related_lists?.source_parent_module_count === 29, 'Source related-list parent-module count mismatch');
  check(dataCompleteness.body?.related_lists?.local_definition_count === 375, 'Local related-list definition count mismatch');
  check(dataCompleteness.body?.related_lists?.local_parent_module_count === 29, 'Local related-list parent-module count mismatch');
  check(dataCompleteness.body?.related_lists?.visible_definition_count === 350, 'Visible related-list definition count mismatch');
  check(dataCompleteness.body?.related_lists?.generic_ui_excluded_definition_count === 69, 'Generic Related UI excluded-definition count mismatch');
  check(dataCompleteness.body?.related_lists?.generic_ui_evaluated_definition_count === 281, 'Generic Related UI evaluated-definition count mismatch');
  check(dataCompleteness.body?.related_lists?.queryable_definition_count === 99, 'Queryable related-list count mismatch');
  check(dataCompleteness.body?.related_lists?.unresolved_definition_count === 182, 'Unresolved related-list count mismatch');
  check(dataCompleteness.body?.related_lists?.queryable_basis_counts?.exact_source_lookup_relation === 48, 'Exact source lookup relation count mismatch');
  check(dataCompleteness.body?.related_lists?.queryable_basis_counts?.source_polymorphic_base_relation === 51, 'Polymorphic base relation count mismatch');
  check(dataCompleteness.body?.related_lists?.unresolved_reason_counts?.RELATED_LINK_PATH_UNRESOLVED === 100, 'Unresolved related-link path count mismatch');
  check(dataCompleteness.body?.related_lists?.unresolved_reason_counts?.RELATED_TARGET_FIELDS_UNAVAILABLE === 33, 'Unavailable target-field count mismatch');
  check(dataCompleteness.body?.related_lists?.unresolved_reason_counts?.RELATED_TARGET_MODULE_UNRESOLVED === 49, 'Unresolved target-module count mismatch');
  const [baseTasks, taskHistory, allOrders, defaultDeals] = await Promise.all([
    request('/api/related/Leads/local-qa-missing/Tasks?per_page=1'),
    request('/api/related/Leads/local-qa-missing/Tasks_History?per_page=1'),
    request('/api/related/Contacts/local-qa-missing/All_Orders?per_page=1'),
    request('/api/related/Contacts/local-qa-missing/Deals?per_page=1'),
  ]);
  check(baseTasks.status === 200 && baseTasks.body?.availability === 'queryable' && baseTasks.body?.link_fields?.join(',') === 'What_Id', 'Base Tasks relationship did not resolve through its source polymorphic field');
  check(taskHistory.status === 200 && taskHistory.body?.availability === 'unresolved' && taskHistory.body?.reason_code === 'RELATED_LINK_PATH_UNRESOLVED', 'Task History incorrectly reused the base Tasks relationship');
  check(allOrders.status === 200 && allOrders.body?.availability === 'queryable' && allOrders.body?.link_fields?.join(',') === 'Opportunity_Name', 'All Orders did not resolve through its exact source lookup');
  check(defaultDeals.status === 200 && defaultDeals.body?.availability === 'unresolved' && defaultDeals.body?.reason_code === 'RELATED_LINK_PATH_UNRESOLVED', 'Default Deals incorrectly reused the All Orders lookup');
  const taskSubforms = dataCompleteness.body?.task_subforms;
  check(taskSubforms?.source_mode === 'read-only', 'Task/subform reconciliation source boundary is not read-only');
  check(taskSubforms?.source_writes === 0 && taskSubforms?.local_deletes === 0, 'Task/subform reconciliation mutation boundary is invalid');
  check(taskSubforms?.summary?.source_count_endpoint_total === 24986, 'Task/subform source count total mismatch');
  check(taskSubforms?.summary?.source_active_id_total === 20249, 'Task/subform active-ID total mismatch');
  check(taskSubforms?.summary?.current_local_source_id_total >= taskSubforms?.summary?.source_active_id_total, 'Task/subform current local count regressed below the audited active-ID baseline');
  check(taskSubforms?.summary?.blocked_count_only_unavailable_total === 4737, 'Task/subform count-only blocker total mismatch');
  check(taskSubforms?.summary?.imported_total === 0 && taskSubforms?.summary?.exact_payloads_verified === 0, 'Current Task/subform audit must not claim imports or payload verification');
  check(taskSubforms?.summary?.historical_imported_total === 2 && taskSubforms?.summary?.historical_exact_payloads_verified === 2, 'Historical Task/subform import verification was not preserved');
  check(taskSubforms?.summary?.exact_id_parity_available === true, 'Private audited Task/subform digests are unavailable');
  check(taskSubforms?.summary?.current_matches_audited_sets === true, 'Current Task/subform sets no longer match the private exact audit');
  check(taskSubforms?.summary?.active_id_parity === null, 'Task/subform summary incorrectly claims a same-epoch current source/local comparison');
  check(Array.isArray(taskSubforms?.datasets) && taskSubforms.datasets.length === 5, 'Task/subform dataset inventory mismatch');
  check(taskSubforms.datasets.every(dataset => (
    dataset.current_local_source_id_count === dataset.source_active_ids
      && dataset.current_count_parity === true
      && dataset.current_matches_audited_set === true
      && dataset.active_id_parity === null
      && dataset.reconciliation_classification === 'ahead_of_audit_recheck_required'
      && dataset.parity_basis === 'Private audited ID-set digest'
  )), 'A Task/subform dataset has inconsistent current-vs-audit or same-epoch freshness evidence');
  const taskDataset = taskSubforms.datasets.find(dataset => dataset.module === 'Tasks');
  check(taskDataset?.current_local_source_id_count === 12422, 'Tasks current exact audited-set count mismatch');
  check(taskDataset?.imported === 0 && taskDataset?.historical_imported === 1 && taskDataset?.historical_exact_payloads_verified === 1, 'Task dataset current/historical import evidence is inconsistent');
  check(taskSubforms.datasets.filter(dataset => dataset.module !== 'Tasks').every(dataset => dataset.count_only_unavailable > 0), 'A child dataset lost its count-only blocker evidence');
  const forbiddenCompletenessField = findForbiddenNamedField(dataCompleteness.body, new Set([
    'authorization', 'body', 'code', 'content', 'cookie', 'credential', 'credentials',
    'hash', 'href', 'id', 'ids', 'local_only_ids', 'local_only_ids_sha256', 'password', 'path',
    'payload', 'payloads', 'private_path', 'secret', 'sha256', 'source_ids',
    'source_ids_sha256', 'source_only_ids', 'source_only_ids_sha256', 'token', 'url', 'urls',
  ]), 'data_completeness');
  check(!forbiddenCompletenessField, `Data-completeness endpoint exposes forbidden field ${forbiddenCompletenessField}`);
  const serializedCompleteness = JSON.stringify(dataCompleteness.body);
  check(!/https?:\/\/|\bwww\./i.test(serializedCompleteness), 'Data-completeness endpoint exposes a URL');
  check(!/\/(?:Users|home|var|tmp|opt|etc)\/|\.private\//i.test(serializedCompleteness), 'Data-completeness endpoint exposes a private path');
  check(!/\borg\d{6,}\b|\b\d{15,25}\b/i.test(serializedCompleteness), 'Data-completeness endpoint exposes a raw source or organization identifier');
  check(!/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(serializedCompleteness), 'Data-completeness endpoint exposes a literal email address');
  check(!/\bbearer\s+[A-Z0-9._~+/=-]{8,}|\b(?:api[_ -]?key|authorization|password|secret|token|credential)\b\s*(?:[:=]|is)\s*["']?[A-Z0-9._~+/=-]{8,}/i.test(serializedCompleteness), 'Data-completeness endpoint exposes credential-shaped material');

  const functionCodeCoverage = await request('/api/meta/function_code_coverage');
  const capturedFunctions = functionCodeCoverage.body?.functions;
  check(functionCodeCoverage.status === 200 && Array.isArray(capturedFunctions), `Function-code coverage endpoint failed (${functionCodeCoverage.status})`);
  check(capturedFunctions.length === 60, `Function-code coverage count mismatch: ${capturedFunctions.length}, expected 60`);
  check(capturedFunctions.every(fn => fn.captured === true && Number(fn.byte_length) > 0), 'Function-code coverage contains an uncaptured or empty body');
  check(functionCodeCoverage.body?.reconciliation?.downloaded_count === 60, 'Function-code download reconciliation is incomplete');
  const forbiddenFunctionCoverageKeys = new Set(['body', 'code', 'content', 'file', 'path', 'sha256', 'hash', 'secret', 'token', 'credential']);
  for (const fn of capturedFunctions) {
    const exposed = Object.keys(fn).find(key => forbiddenFunctionCoverageKeys.has(key.toLowerCase()));
    check(!exposed, `Function-code coverage exposes forbidden per-function field ${exposed}`);
  }

  const functionBehaviorCoverage = await request('/api/meta/function_behavior_coverage');
  const functionBehaviors = functionBehaviorCoverage.body?.functions;
  check(functionBehaviorCoverage.status === 200 && Array.isArray(functionBehaviors), `Function-behavior coverage endpoint failed (${functionBehaviorCoverage.status})`);
  check(functionBehaviorCoverage.body?.source_mode === 'read-only', 'Function-behavior source boundary is not read-only');
  check(functionBehaviorCoverage.body?.coverage?.status === 'Reconciled', 'Function-behavior inventory is not reconciled');
  check(functionBehaviorCoverage.body?.coverage?.active_workflow_rules === 39, 'Active workflow-rule behavior scope mismatch');
  check(functionBehaviorCoverage.body?.coverage?.workflow_function_associations === 22, 'Workflow function-association count mismatch');
  check(functionBehaviorCoverage.body?.coverage?.mapped_workflow_functions === 21, 'Mapped workflow-function count mismatch');
  check(functionBehaviorCoverage.body?.coverage?.custom_function_button_references === 2, 'Custom function-button reference count mismatch');
  check(functionBehaviorCoverage.body?.coverage?.mapped_button_functions === 2, 'Mapped button-function count mismatch');
  check(functionBehaviorCoverage.body?.coverage?.unresolved_in_scope_references === 0, 'Function-behavior inventory has unresolved in-scope references');
  check(functionBehaviors.length === 23, `Function-behavior count mismatch: ${functionBehaviors.length}, expected 23`);
  check(functionBehaviors.flatMap(fn => fn.associations || []).length === 24, 'Function-behavior association count mismatch');
  check(functionBehaviors.every(fn => fn.local_execution === 'Blocked'), 'A function-behavior entry is not blocked locally');
  check(functionBehaviorCoverage.body?.affected?.module_count === 10, 'Affected function module count mismatch');
  check(functionBehaviorCoverage.body?.affected?.field_references?.read === 106, 'Function read-field reference count mismatch');
  check(functionBehaviorCoverage.body?.affected?.field_references?.write === 118, 'Function write-field reference count mismatch');
  check(functionBehaviorCoverage.body?.affected?.field_references?.total === 224, 'Function total field-reference count mismatch');
  check(functionBehaviorCoverage.body?.execution?.local_function_execution_enabled === false, 'Local function execution is not fail-closed');
  check(functionBehaviorCoverage.body?.execution?.source_execution_enabled === false, 'Source function execution is not fail-closed');
  check(functionBehaviorCoverage.body?.execution?.source_writes_enabled === false, 'Source writes are not fail-closed');
  check(functionBehaviorCoverage.body?.execution?.outbound_delivery_enabled === false, 'Outbound function delivery is not fail-closed');
  const forbiddenFunctionBehaviorField = findForbiddenFunctionBehaviorField(functionBehaviorCoverage.body);
  check(!forbiddenFunctionBehaviorField, `Function-behavior endpoint exposes forbidden field ${forbiddenFunctionBehaviorField}`);
  const serializedFunctionBehavior = JSON.stringify(functionBehaviorCoverage.body);
  check(!/https?:\/\/|\bwww\./i.test(serializedFunctionBehavior), 'Function-behavior endpoint exposes a URL');
  check(!/\/Users\/|\/home\/|\.private\//i.test(serializedFunctionBehavior), 'Function-behavior endpoint exposes a private file path');
  check(!/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(serializedFunctionBehavior), 'Function-behavior endpoint exposes a literal email address');

  const widgetBehaviorCoverage = await request('/api/meta/widget_behavior_coverage');
  const widgetBehaviors = widgetBehaviorCoverage.body?.widgets;
  check(widgetBehaviorCoverage.status === 200 && Array.isArray(widgetBehaviors), `Widget-behavior coverage endpoint failed (${widgetBehaviorCoverage.status})`);
  check(widgetBehaviorCoverage.body?.source_mode === 'read-only', 'Widget-behavior source boundary is not read-only');
  check(widgetBehaviorCoverage.body?.reconciliation?.status === 'Reconciled', 'Widget-behavior inventory is not reconciled');
  check(widgetBehaviorCoverage.body?.reconciliation?.source_widget_rows === 40, 'Source widget registration count mismatch');
  check(widgetBehaviorCoverage.body?.reconciliation?.zoho_hosted_widgets === 20, 'Zoho-hosted widget count mismatch');
  check(widgetBehaviorCoverage.body?.reconciliation?.external_hosted_widgets === 20, 'External-hosted widget count mismatch');
  check(widgetBehaviorCoverage.body?.reconciliation?.captured_zoho_packages === 20, 'Captured Zoho package count mismatch');
  check(widgetBehaviorCoverage.body?.reconciliation?.validated_zoho_packages === 20, 'Validated Zoho package count mismatch');
  check(widgetBehaviors.length === 40, `Widget-behavior count mismatch: ${widgetBehaviors.length}, expected 40`);
  check(widgetBehaviors.filter(widget => widget.hosting === 'Zoho').length === 20, 'Derived Zoho-hosted widget count mismatch');
  check(widgetBehaviors.filter(widget => widget.hosting === 'External').length === 20, 'Derived external-hosted widget count mismatch');
  check(widgetBehaviors.filter(widget => widget.package?.captured).length === 20, 'Derived captured-package count mismatch');
  check(widgetBehaviors.every(widget => widget.local_execution?.status === 'Blocked' && widget.local_execution?.enabled === false && widget.local_execution?.fail_closed === true), 'A widget-behavior entry is not fail-closed');
  check(widgetBehaviorCoverage.body?.execution_boundary?.local_widget_execution_enabled === false, 'Local widget execution is not fail-closed');
  check(widgetBehaviorCoverage.body?.execution_boundary?.source_widget_execution_enabled === false, 'Source widget execution is not fail-closed');
  check(widgetBehaviorCoverage.body?.execution_boundary?.source_writes_enabled === false, 'Source widget writes are not fail-closed');
  check(widgetBehaviorCoverage.body?.execution_boundary?.outbound_delivery_enabled === false, 'Outbound widget delivery is not fail-closed');
  const forbiddenWidgetBehaviorField = findForbiddenWidgetBehaviorField(widgetBehaviorCoverage.body);
  check(!forbiddenWidgetBehaviorField, `Widget-behavior endpoint exposes forbidden field ${forbiddenWidgetBehaviorField}`);
  const serializedWidgetBehavior = JSON.stringify(widgetBehaviorCoverage.body);
  check(!/https?:\/\/|\bwww\./i.test(serializedWidgetBehavior), 'Widget-behavior endpoint exposes a URL');
  check(!/\/Users\/|\/home\/|\.private\//i.test(serializedWidgetBehavior), 'Widget-behavior endpoint exposes a private file path');
  check(!/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(serializedWidgetBehavior), 'Widget-behavior endpoint exposes a literal email address');

  const widgetRuntimeCompatibility = await request('/api/meta/widget_runtime_compatibility');
  const widgetRuntimeProfiles = widgetRuntimeCompatibility.body?.widgets;
  check(widgetRuntimeCompatibility.status === 200 && Array.isArray(widgetRuntimeProfiles), `Widget runtime compatibility endpoint failed (${widgetRuntimeCompatibility.status})`);
  check(widgetRuntimeProfiles.length === 12, `Widget runtime profile count mismatch: ${widgetRuntimeProfiles.length}, expected 12`);
  check(widgetRuntimeCompatibility.body?.source_mode === 'offline-static-analysis', 'Widget runtime source mode drifted');
  check(widgetRuntimeCompatibility.body?.archive_set?.captured_packages === 12 && widgetRuntimeCompatibility.body?.archive_set?.entries === 35, 'Widget runtime archive reconciliation drifted');
  check(widgetRuntimeCompatibility.body?.summary?.implemented_local_previews === 9, 'Widget runtime implemented read-only count drifted');
  check(widgetRuntimeCompatibility.body?.summary?.local_preview_candidates === 0, 'Widget runtime preview-candidate count drifted');
  check(widgetRuntimeCompatibility.body?.summary?.quarantined_packages === 3, 'Widget runtime quarantine count drifted');
  check(widgetRuntimeCompatibility.body?.summary?.quarantined_pending_sensitive_review === 0, 'Widget runtime pending sensitive-review count drifted');
  check(widgetRuntimeCompatibility.body?.summary?.quarantined_review_complete_contract_blocked === 3, 'Widget runtime reviewed contract-blocked count drifted');
  check(widgetRuntimeCompatibility.body?.summary?.full_local_ready === 0, 'Widget runtime incorrectly claims a full local runtime');
  check(widgetRuntimeCompatibility.body?.archive_set?.sensitive_review_required_packages === 0, 'Widget runtime archive pending-review count drifted');
  check(widgetRuntimeCompatibility.body?.archive_set?.sensitive_review_completed_packages === 5, 'Widget runtime completed bounded-review count drifted');
  check(widgetRuntimeCompatibility.body?.execution_boundary?.captured_source_execution_enabled === false, 'Captured widget source execution is enabled');
  check(widgetRuntimeCompatibility.body?.execution_boundary?.source_writes_enabled === false, 'Widget source writes are enabled');
  check(widgetRuntimeCompatibility.body?.execution_boundary?.third_party_outbound_enabled === false, 'Widget third-party outbound access is enabled');
  const implementedWidgetProfiles = widgetRuntimeProfiles.filter(widget => widget.preview_runtime_status === 'implemented-read-only');
  const candidateWidgetProfiles = widgetRuntimeProfiles.filter(widget => widget.preview_runtime_status === 'candidate');
  const quarantinedWidgetProfiles = widgetRuntimeProfiles.filter(widget => widget.preview_runtime_status === 'quarantined');
  check(implementedWidgetProfiles.length === 9, 'Widget runtime must expose exactly nine implemented read-only previews');
  const estimateWidgetProfile = implementedWidgetProfiles.find(widget => String(widget.id) === '1032257000012167001');
  const assignTechnicianWidgetProfile = implementedWidgetProfiles.find(widget => String(widget.id) === '1032257000023774783');
  const designerFormWidgetProfile = implementedWidgetProfiles.find(widget => String(widget.id) === '1032257000010677855');
  const paymentMilestoneWidgetProfile = implementedWidgetProfiles.find(widget => String(widget.id) === '1032257000007994308');
  const reviseQuoteWidgetProfile = implementedWidgetProfiles.find(widget => String(widget.id) === '1032257000010720459');
  const closureNewWidgetProfile = implementedWidgetProfiles.find(widget => String(widget.id) === '1032257000025407208');
  const reviseApproveWidgetProfile = implementedWidgetProfiles.find(widget => String(widget.id) === '1032257000017358913');
  const deployTeamWidgetProfile = implementedWidgetProfiles.find(widget => String(widget.id) === '1032257000022961582');
  const handoverPostTeamWidgetProfile = implementedWidgetProfiles.find(widget => String(widget.id) === '1032257000023117488');
  check(String(estimateWidgetProfile?.id || '') === '1032257000012167001', 'Unexpected widget received implemented read-only status');
  check(estimateWidgetProfile?.name === 'Estimate Widget', 'Implemented read-only widget name drifted');
  check(estimateWidgetProfile?.preview_classification === 'calculation-preview-candidate', 'Estimate widget preview classification drifted');
  check(estimateWidgetProfile?.full_runtime_status === 'blocked', 'Estimate widget incorrectly claims a full runtime');
  check(assignTechnicianWidgetProfile?.name === 'Assign Technician Widget', 'Assign Technician read-only widget name drifted');
  check(assignTechnicianWidgetProfile?.preview_classification === 'fixture-preview-candidate', 'Assign Technician preview classification drifted');
  check(assignTechnicianWidgetProfile?.full_runtime_status === 'blocked', 'Assign Technician widget incorrectly claims a full runtime');
  check(designerFormWidgetProfile?.name === 'Designer Form Widget', 'Designer Form read-only widget name drifted');
  check(designerFormWidgetProfile?.preview_classification === 'fixture-preview-candidate', 'Designer Form preview classification drifted');
  check(designerFormWidgetProfile?.full_runtime_status === 'blocked', 'Designer Form widget incorrectly claims a full runtime');
  check(String(paymentMilestoneWidgetProfile?.id || '') === '1032257000007994308', 'Payment Milestone widget is missing its implemented read-only profile');
  check(paymentMilestoneWidgetProfile?.name === 'Payment Milestone Widget', 'Payment Milestone read-only widget name drifted');
  check(paymentMilestoneWidgetProfile?.preview_classification === 'fixture-preview-candidate', 'Payment Milestone preview classification drifted');
  check(
    JSON.stringify(paymentMilestoneWidgetProfile?.modules_read || []) === JSON.stringify(['Contacts', 'Payment_Milestones']),
    'Payment Milestone exact read-module contract drifted',
  );
  check(paymentMilestoneWidgetProfile?.full_runtime_status === 'blocked', 'Payment Milestone widget incorrectly claims a full runtime');
  check(reviseQuoteWidgetProfile?.name === 'Revise Quote - Widget', 'Revise Quote read-only widget name drifted');
  check(reviseQuoteWidgetProfile?.preview_classification === 'fixture-preview-candidate', 'Revise Quote preview classification drifted');
  check(
    JSON.stringify(reviseQuoteWidgetProfile?.modules_read || []) === JSON.stringify(['Contacts', 'Deals', 'Stage_History']),
    'Revise Quote reviewed read-module evidence drifted',
  );
  check(reviseQuoteWidgetProfile?.full_runtime_status === 'blocked', 'Revise Quote widget incorrectly claims a full runtime');
  check(closureNewWidgetProfile?.name === 'Closure New - Pinki', 'Closure New read-only widget name drifted');
  check(closureNewWidgetProfile?.preview_classification === 'fixture-preview-candidate', 'Closure New preview classification drifted');
  check(
    JSON.stringify(closureNewWidgetProfile?.modules_read || []) === JSON.stringify(['Contacts', 'Deals', 'Payment_Milestones']),
    'Closure New exact read-module contract drifted',
  );
  check(closureNewWidgetProfile?.full_runtime_status === 'blocked', 'Closure New widget incorrectly claims a full runtime');
  check(reviseApproveWidgetProfile?.name === 'Revise-Approve Quote-Any Stage', 'Revise-Approve read-only widget name drifted');
  check(reviseApproveWidgetProfile?.preview_classification === 'fixture-preview-candidate', 'Revise-Approve preview classification drifted');
  check(
    JSON.stringify(reviseApproveWidgetProfile?.modules_read || []) === JSON.stringify(['Contacts', 'Deals', 'Stage_History']),
    'Revise-Approve reviewed read-module evidence drifted',
  );
  check(reviseApproveWidgetProfile?.full_runtime_status === 'blocked', 'Revise-Approve widget incorrectly claims a full runtime');
  check(deployTeamWidgetProfile?.name === 'Deploy Team', 'Deploy Team read-only widget name drifted');
  check(deployTeamWidgetProfile?.preview_classification === 'fixture-preview-candidate', 'Deploy Team preview classification drifted');
  check(deployTeamWidgetProfile?.archive_evidence?.sensitive_literal_review_completed === true, 'Deploy Team bounded-review evidence drifted');
  check(
    JSON.stringify(deployTeamWidgetProfile?.modules_read || []) === JSON.stringify(['Contacts', 'Deals', 'Users', 'Visit_Module']),
    'Deploy Team exact read-module contract drifted',
  );
  check(deployTeamWidgetProfile?.full_runtime_status === 'blocked', 'Deploy Team widget incorrectly claims a full runtime');
  check(handoverPostTeamWidgetProfile?.name === 'Handover To Post Team', 'Final Handover read-only widget name drifted');
  check(handoverPostTeamWidgetProfile?.preview_classification === 'fixture-preview-candidate', 'Final Handover preview classification drifted');
  check(handoverPostTeamWidgetProfile?.archive_evidence?.sensitive_literal_review_completed === true, 'Final Handover bounded-review evidence drifted');
  check(
    JSON.stringify(handoverPostTeamWidgetProfile?.modules_read || []) === JSON.stringify(['Contacts', 'Deals', 'AMS_Complaints', 'Attachments']),
    'Final Handover exact read-module contract drifted',
  );
  check(handoverPostTeamWidgetProfile?.full_runtime_status === 'blocked', 'Final Handover widget incorrectly claims a full runtime');
  check(candidateWidgetProfiles.length === 0, 'Widget runtime candidate status count drifted');
  check(candidateWidgetProfiles.every(widget => widget.preview_classification === 'fixture-preview-candidate'), 'A widget candidate has an inconsistent preview classification');
  check(quarantinedWidgetProfiles.length === 3, 'Widget runtime quarantined status count drifted');
  const pendingReviewWidgetProfiles = quarantinedWidgetProfiles.filter(widget => widget.preview_classification === 'quarantined-pending-review');
  const reviewedContractBlockedWidgetProfiles = quarantinedWidgetProfiles.filter(widget => widget.preview_classification === 'quarantined-reviewed-contract-blocked');
  check(pendingReviewWidgetProfiles.length === 0, 'Widget runtime pending-review quarantine count drifted');
  check(pendingReviewWidgetProfiles.every(widget => widget.archive_evidence?.sensitive_literal_review_required === true && widget.archive_evidence?.sensitive_literal_review_completed === false), 'A pending-review widget has inconsistent review evidence');
  check(reviewedContractBlockedWidgetProfiles.length === 3, 'Widget runtime reviewed contract-blocked quarantine count drifted');
  check(
    JSON.stringify(reviewedContractBlockedWidgetProfiles.map(widget => widget.name).sort())
      === JSON.stringify(['Closure Order Stage Update', 'Handover to Post Design', 'Sunrooof Mark Closures'].sort()),
    'Unexpected widgets received reviewed contract-blocked status',
  );
  check(reviewedContractBlockedWidgetProfiles.every(widget => widget.archive_evidence?.sensitive_literal_review_required === false && widget.archive_evidence?.sensitive_literal_review_completed === true), 'Reviewed contract-blocked widget evidence drifted');
  const completedReviewWidgetProfiles = widgetRuntimeProfiles.filter(widget => widget.archive_evidence?.sensitive_literal_review_completed === true);
  check(completedReviewWidgetProfiles.length === 5, 'Widget runtime completed bounded-review profile count drifted');
  check(
    JSON.stringify(completedReviewWidgetProfiles.map(widget => widget.name).sort())
      === JSON.stringify(['Closure Order Stage Update', 'Deploy Team', 'Handover To Post Team', 'Handover to Post Design', 'Sunrooof Mark Closures'].sort()),
    'Widget runtime completed bounded-review set drifted',
  );
  check(widgetRuntimeProfiles.every(widget => widget.full_runtime_status === 'blocked'), 'A supplied widget runtime is not blocked');
  const forbiddenWidgetRuntimeField = findForbiddenWidgetBehaviorField(widgetRuntimeCompatibility.body);
  check(!forbiddenWidgetRuntimeField, `Widget runtime compatibility exposes forbidden field ${forbiddenWidgetRuntimeField}`);
  const serializedWidgetRuntime = JSON.stringify(widgetRuntimeCompatibility.body);
  check(!/https?:\/\/|\bwww\./i.test(serializedWidgetRuntime), 'Widget runtime compatibility exposes a URL');
  check(!/\/(?:Users|home|var|tmp|opt|etc)\/|\.private\//i.test(serializedWidgetRuntime), 'Widget runtime compatibility exposes a private path');
  check(!/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(serializedWidgetRuntime), 'Widget runtime compatibility exposes a literal email address');

  const reportDashboardCoverage = await request('/api/meta/report_dashboard_coverage');
  check(reportDashboardCoverage.status === 200, `Report/dashboard coverage endpoint failed (${reportDashboardCoverage.status})`);
  check(reportDashboardCoverage.body?.source_mode === 'read-only', 'Report/dashboard source boundary is not read-only');
  check(reportDashboardCoverage.body?.coverage?.reports?.discovered === 202, 'Report catalog count mismatch');
  check(reportDashboardCoverage.body?.coverage?.reports?.categories === 29, 'Report category count mismatch');
  check(reportDashboardCoverage.body?.coverage?.reports?.verified_private_exports === 1, 'Verified private report-export count mismatch');
  check(reportDashboardCoverage.body?.coverage?.reports?.verified_private_export_rows === 226, 'Verified private report-export row count mismatch');
  check(reportDashboardCoverage.body?.coverage?.dashboards?.discovered === 32, 'Dashboard catalog count mismatch');
  check(reportDashboardCoverage.body?.coverage?.dashboards?.selected_dashboard?.component_count === 20, 'Selected dashboard component count mismatch');
  check(reportDashboardCoverage.body?.coverage?.dashboards?.selected_dashboard?.component_names?.length === 20, 'Selected dashboard component-name count mismatch');
  check(reportDashboardCoverage.body?.execution_boundary?.status === 'Blocked', 'Report/dashboard execution is not blocked');
  check(Object.entries(reportDashboardCoverage.body?.execution_boundary || {}).filter(([key]) => key.endsWith('_enabled')).every(([, value]) => value === false), 'A report/dashboard execution boundary is enabled');
  const forbiddenReportField = findForbiddenNamedField(reportDashboardCoverage.body, new Set([
    'credential', 'credentials', 'data', 'hash', 'href', 'id', 'organization_id', 'org_id',
    'path', 'private_path', 'recipient', 'recipients', 'report_id', 'rows', 'sha256', 'token', 'url', 'urls',
  ]), 'report_dashboard');
  check(!forbiddenReportField, `Report/dashboard coverage exposes forbidden field ${forbiddenReportField}`);
  const serializedReportCoverage = JSON.stringify(reportDashboardCoverage.body);
  check(!/https?:\/\/|\bwww\./i.test(serializedReportCoverage), 'Report/dashboard coverage exposes a URL');
  check(!/\/Users\/|\/home\/|\.private\//i.test(serializedReportCoverage), 'Report/dashboard coverage exposes a private file path');
  check(!/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(serializedReportCoverage), 'Report/dashboard coverage exposes a literal email address');

  const permissionCoverage = await request('/api/meta/permission_coverage');
  check(permissionCoverage.status === 200, `Permission coverage endpoint failed (${permissionCoverage.status})`);
  check(permissionCoverage.body?.source_mode === 'read-only', 'Permission source boundary is not read-only');
  check(permissionCoverage.body?.source_coverage?.roles === 14, 'Role catalog count mismatch');
  check(permissionCoverage.body?.source_coverage?.profiles === 11, 'Profile catalog count mismatch');
  check(permissionCoverage.body?.source_coverage?.users === 63, 'Aggregate source-user count mismatch');
  check(permissionCoverage.body?.source_coverage?.profile_module_assignments === 506, 'Profile-module assignment count mismatch');
  check(permissionCoverage.body?.source_coverage?.field_exception_assignments === 2836, 'Field-exception assignment count mismatch');
  check(permissionCoverage.body?.roles?.length === 14 && permissionCoverage.body?.profiles?.length === 11, 'Permission catalog array count mismatch');
  check(permissionCoverage.body?.profiles?.flatMap(profile => profile.module_permissions || []).length === 506, 'Permission module matrix count mismatch');
  check(permissionCoverage.body?.field_permission_model?.exceptions?.length === 273, 'Field-exception group count mismatch');
  check(permissionCoverage.body?.source_user_aggregates?.local_users_mapped === 0, 'Permission coverage incorrectly claims local user mappings');
  check(permissionCoverage.body?.local_authorization?.source_permission_enforcement?.status === 'Blocked', 'Local permission enforcement is not blocked');
  check(permissionCoverage.body?.enforcement_boundary?.local_permission_enforcement_enabled === false, 'Local permission enforcement is enabled');
  check(permissionCoverage.body?.enforcement_boundary?.default_permission_decision === 'Deny', 'Default permission decision is not Deny');
  check(permissionCoverage.body?.identity_provider_decision?.identity_provider === 'Unselected', 'Permission coverage incorrectly claims an identity provider');
  const forbiddenPermissionField = findForbiddenNamedField(permissionCoverage.body, new Set([
    'alias', 'api_key', 'authorization', 'credential', 'credentials', 'email', 'endpoint',
    'first_name', 'full_name', 'id', 'last_name', 'mobile', 'password', 'phone', 'private_path',
    'profile_id', 'role_id', 'secret', 'source_endpoint', 'source_id', 'token', 'user_id', 'user_name', 'url',
  ]), 'permission');
  check(!forbiddenPermissionField, `Permission coverage exposes forbidden field ${forbiddenPermissionField}`);
  const serializedPermissionCoverage = JSON.stringify(permissionCoverage.body);
  check(!/https?:\/\/|\bwww\./i.test(serializedPermissionCoverage), 'Permission coverage exposes a URL');
  check(!/\/Users\/|\/home\/|\.private\//i.test(serializedPermissionCoverage), 'Permission coverage exposes a private file path');
  check(!/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(serializedPermissionCoverage), 'Permission coverage exposes a literal email address');
  check(!/\b\d{15,25}\b/.test(serializedPermissionCoverage), 'Permission coverage exposes a raw source identifier');

  const ruleLayoutCoverage = await request('/api/meta/rule_layout_coverage');
  check(ruleLayoutCoverage.status === 200 && ruleLayoutCoverage.body?.source_coverage, `Rule/layout coverage endpoint failed (${ruleLayoutCoverage.status})`);
  check(ruleLayoutCoverage.body?.evidence_scope?.modules_cataloged === 122, 'Rule/layout module scope mismatch');
  check(ruleLayoutCoverage.body?.source_coverage?.layouts?.definitions_captured === 70, 'Layout definition count mismatch');
  check(ruleLayoutCoverage.body?.source_coverage?.layouts?.blocked_responses === 47, 'Blocked layout-response count mismatch');
  check(ruleLayoutCoverage.body?.source_coverage?.custom_views?.list_rows_captured === 386, 'Custom-view row count mismatch');
  check(ruleLayoutCoverage.body?.source_coverage?.custom_views?.criteria_details_captured === 0, 'Custom-view criteria coverage incorrectly claims source detail');
  check(ruleLayoutCoverage.body?.source_coverage?.custom_views?.source_criteria_compile_blocked === 386, 'Custom-view source-parity blocker count mismatch');
  const currentRuntime = ruleLayoutCoverage.body?.current_mirrored_runtime;
  const currentRuntimeViews = currentRuntime?.custom_views;
  check(currentRuntime?.modules_cataloged === 153 && currentRuntimeViews?.modules_with_definitions === 41, 'Current hydrated-runtime custom-view module scope mismatch');
  check(currentRuntimeViews?.definitions_mirrored === 386 && currentRuntimeViews?.criteria_bearing_definitions === 199 && currentRuntimeViews?.criteria_leaf_count === 321, 'Current hydrated-runtime custom-view criteria inventory mismatch');
  check(currentRuntimeViews?.compilation?.definitions_reviewed === 386 && currentRuntimeViews?.compilation?.executable_criteria_definitions === 102 && currentRuntimeViews?.compilation?.explicitly_safe_unfiltered_definitions === 53 && currentRuntimeViews?.compilation?.unresolved_criteria_bodies === 134 && currentRuntimeViews?.compilation?.unsupported_criteria_definitions === 97 && currentRuntimeViews?.compilation?.compiled_definitions === 155 && currentRuntimeViews?.compilation?.blocked_definitions === 231, 'Current hydrated-runtime custom-view compilation mismatch');
  check(currentRuntimeViews?.system_defined_compilation?.definitions_reviewed === 306 && currentRuntimeViews?.system_defined_compilation?.compiled_definitions === 81 && currentRuntimeViews?.system_defined_compilation?.blocked_definitions === 225, 'Current hydrated-runtime system-view compilation mismatch');
  check(currentRuntimeViews?.default_compilation?.definitions_reviewed === 41 && currentRuntimeViews?.default_compilation?.executable_criteria_definitions === 4 && currentRuntimeViews?.default_compilation?.explicitly_safe_unfiltered_definitions === 10 && currentRuntimeViews?.default_compilation?.unresolved_criteria_bodies === 26 && currentRuntimeViews?.default_compilation?.unsupported_criteria_definitions === 1 && currentRuntimeViews?.default_compilation?.compiled_definitions === 14 && currentRuntimeViews?.default_compilation?.blocked_definitions === 27, 'Current hydrated-runtime default-view compilation mismatch');
  check(JSON.stringify(currentRuntimeViews?.default_compilation?.blocking_dynamic_families) === JSON.stringify(['CURRENTUSER', 'TODAYANDOVERDUE']), 'Current hydrated-runtime default-view blocker families drifted');
  check(currentRuntimeViews?.explicit_unsupported_selection_decision === 'Deny', 'Explicit unsupported custom-view selection is not fail-closed');
  check(ruleLayoutCoverage.body?.source_coverage?.validation_rules?.blocked_responses === 122, 'Validation-rule inaccessible-response count mismatch');
  check(ruleLayoutCoverage.body?.source_coverage?.assignment_rules?.definitions_captured === 1, 'Assignment-rule definition count mismatch');
  check(ruleLayoutCoverage.body?.source_coverage?.assignment_rules?.executable_definitions_captured === 0, 'Assignment-rule inventory incorrectly claims an executable definition');
  check(ruleLayoutCoverage.body?.source_coverage?.approval_rules?.blocked_responses === 122, 'Approval-rule inaccessible-response count mismatch');
  check(ruleLayoutCoverage.body?.source_coverage?.pipelines?.definitions_captured === 0 && ruleLayoutCoverage.body?.source_coverage?.pipelines?.blocked_responses === 69, 'Pipeline coverage mismatch');
  check(ruleLayoutCoverage.body?.local_enforcement?.layouts?.field_overlay_applied_before_validation === true, 'Layout field-overlay enforcement is not confirmed');
  check(ruleLayoutCoverage.body?.local_enforcement?.layouts?.layout_profile_visibility_enforced === false, 'Layout profile visibility is incorrectly claimed as enforced');
  check(ruleLayoutCoverage.body?.enforcement_boundary?.source_rule_execution_enabled === false, 'Source rule execution is not fail-closed');
  check(ruleLayoutCoverage.body?.enforcement_boundary?.source_rule_mutations_enabled === false, 'Source rule mutations are not fail-closed');
  check(ruleLayoutCoverage.body?.enforcement_boundary?.default_rule_decision === 'Deny', 'Default source-rule decision is not Deny');
  const serializedRuleLayoutCoverage = JSON.stringify(ruleLayoutCoverage.body);
  check(!/https?:\/\/|\bwww\./i.test(serializedRuleLayoutCoverage), 'Rule/layout coverage endpoint exposes a URL');
  check(!/\/Users\/|\/home\/|\.private\//i.test(serializedRuleLayoutCoverage), 'Rule/layout coverage endpoint exposes a private file path');
  check(!/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(serializedRuleLayoutCoverage), 'Rule/layout coverage endpoint exposes a literal email address');
  check(!/\b\d{15,25}\b/.test(serializedRuleLayoutCoverage), 'Rule/layout coverage endpoint exposes a raw source identifier');

  const metadataParity = await request('/api/meta/metadata_parity');
  check(metadataParity.status === 200 && metadataParity.body?.areas, `Metadata parity endpoint failed (${metadataParity.status})`);
  check(metadataParity.body?.parity_status === 'Blocked', 'Metadata parity endpoint does not preserve its blocked status');
  const metadataAreas = metadataParity.body.areas;
  check(metadataAreas.modules?.source_definitions === 153 && metadataAreas.modules?.local_definitions === 153 && metadataAreas.modules?.semantic_drift === 0, 'Module metadata parity mismatch');
  check(metadataAreas.fields?.source_definitions === 2377 && metadataAreas.fields?.local_definitions === 2377 && metadataAreas.fields?.source_only === 0, 'Field metadata parity mismatch');
  check(metadataAreas.layouts?.source_definitions === 70 && metadataAreas.layouts?.local_definitions === 70 && metadataAreas.layouts?.source_only === 0, 'Layout metadata parity mismatch');
  check(metadataAreas.picklists?.source_definitions === 387 && metadataAreas.picklists?.local_definitions === 381 && metadataAreas.picklists?.source_only === 6, 'Picklist metadata parity mismatch');
  check(metadataAreas.picklists?.components?.field_picklists?.matched_definitions === 381 && metadataAreas.picklists?.components?.global_picklists?.source_only === 6, 'Field/global picklist split mismatch');
  check(metadataAreas.picklists?.option_coverage?.source_field_option_values === 31807 && metadataAreas.picklists?.option_coverage?.local_field_option_values === 31807 && metadataAreas.picklists?.option_coverage?.source_only_field_option_values === 0, 'Picklist-option metadata parity mismatch');
  check(metadataAreas.custom_views?.source_definitions === 386 && metadataAreas.custom_views?.local_definitions === 386 && metadataAreas.custom_views?.source_only === 0 && metadataAreas.custom_views?.semantic_drift === 2, 'Custom-view metadata parity mismatch');
  check(metadataAreas.custom_views?.criteria_coverage?.captured_rows_with_criteria === 0 && metadataAreas.custom_views?.criteria_coverage?.local_rows_with_criteria === 252, 'Custom-view criteria-scope distinction mismatch');
  check(metadataAreas.related_lists?.source_definitions === 375 && metadataAreas.related_lists?.local_definitions === 375 && metadataAreas.related_lists?.source_only === 0, 'Related-list metadata parity mismatch');
  check(metadataAreas.pipelines?.source_definitions === 0 && metadataAreas.pipelines?.local_definitions === 0 && metadataAreas.pipelines?.source_capture?.failed_requests === 69 && metadataAreas.pipelines?.status === 'Blocked', 'Pipeline metadata evidence incorrectly represents 0/0 as parity');
  check(metadataParity.body?.mutation_boundary?.source_calls_enabled === false, 'Metadata audit source calls are not fail-closed');
  check(metadataParity.body?.mutation_boundary?.source_writes_enabled === false, 'Metadata audit source writes are not fail-closed');
  check(metadataParity.body?.mutation_boundary?.local_metadata_writes_enabled === false, 'Metadata audit local writes are not fail-closed');
  check(metadataParity.body?.mutation_boundary?.automatic_delete_enabled === false, 'Metadata audit automatic deletes are not fail-closed');
  const forbiddenMetadataParityField = findForbiddenNamedField(metadataParity.body, new Set([
    'credential', 'credentials', 'customer_data', 'hash', 'href', 'hrefs', 'id', 'ids',
    'identities', 'org_id', 'organization', 'organization_id', 'path', 'paths',
    'private_path', 'secret', 'sha256', 'source_id', 'source_ids', 'token', 'url', 'urls',
  ]), 'metadata_parity');
  check(!forbiddenMetadataParityField, `Metadata parity endpoint exposes forbidden field ${forbiddenMetadataParityField}`);
  const serializedMetadataParity = JSON.stringify(metadataParity.body);
  check(!/https?:\/\/|\bwww\./i.test(serializedMetadataParity), 'Metadata parity endpoint exposes a URL');
  check(!/\/Users\/|\/home\/|\.private\//i.test(serializedMetadataParity), 'Metadata parity endpoint exposes a private file path');
  check(!/\borg\d{6,}\b|\b\d{15,25}\b/i.test(serializedMetadataParity), 'Metadata parity endpoint exposes a raw source or organization identifier');
  check(!/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(serializedMetadataParity), 'Metadata parity endpoint exposes a literal email address');

  const blueprintCatalog = await request('/api/meta/blueprint_catalog');
  const catalogBlueprints = blueprintCatalog.body?.blueprints;
  check(blueprintCatalog.status === 200 && Array.isArray(catalogBlueprints), `Blueprint catalog endpoint failed (${blueprintCatalog.status})`);
  check(catalogBlueprints.length === 7, `Blueprint catalog count mismatch: ${catalogBlueprints.length}, expected 7`);

  const phaseDetailExpectations = [
    { label: 'Leads', expected: 8, matches: blueprint => blueprint.module === 'Leads' },
    { label: 'Contacts complete phase evidence', expected: 83, matches: blueprint => blueprint.module === 'Contacts' },
    { label: 'Tasks complete phase evidence', expected: 5, matches: blueprint => blueprint.module === 'Tasks' },
    { label: 'Deals complete phase evidence', expected: 80, matches: blueprint => blueprint.module === 'Deals' },
    { label: 'Visit_Module', expected: 1, matches: blueprint => blueprint.module === 'Visit_Module' },
    { label: 'Complaint Flow - Installation', expected: 10, matches: blueprint => blueprint.name === 'Complaint Flow - Installation' },
    { label: 'AMS/Complaint Flow', expected: 15, matches: blueprint => blueprint.name === 'AMS/Complaint Flow' },
  ];
  for (const expectation of phaseDetailExpectations) {
    const matches = catalogBlueprints.filter(expectation.matches);
    check(matches.length === 1, `Blueprint catalog has ${matches.length} matches for ${expectation.label}, expected 1`);
    check(
      matches[0].phase_detail_count === expectation.expected,
      `${expectation.label} phase-detail count mismatch: ${matches[0].phase_detail_count}, expected ${expectation.expected}`,
    );
  }
  const dealsBlueprint = catalogBlueprints.find(blueprint => blueprint.module === 'Deals');
  check(dealsBlueprint?.id === '1032257000000535747', 'Unexpected Deals Blueprint definition');
  check(dealsBlueprint?.transition_count === 80 && dealsBlueprint?.phase_detail_count === 80, 'Deals Blueprint phase coverage is not exactly 80 of 80');
  check(dealsBlueprint?.policy_eligible_count === 0, 'Deals Blueprint phase evidence incorrectly claims policy-eligible transitions');
  check(dealsBlueprint?.atomic_runtime_ready_count === 0, 'Deals Blueprint incorrectly claims an atomically ready transition');
  const tasksBlueprint = catalogBlueprints.find(blueprint => blueprint.module === 'Tasks');
  check(tasksBlueprint?.transition_count === 5 && tasksBlueprint?.phase_detail_count === 5, 'Tasks Blueprint phase coverage is not exactly 5 of 5');
  check(tasksBlueprint?.policy_eligible_count === 0, 'Tasks Blueprint phase evidence incorrectly claims policy-eligible transitions');
  check(tasksBlueprint?.atomic_runtime_ready_count === 0, 'Tasks Blueprint incorrectly claims an atomically ready transition');
  const blueprintTransitionCount = catalogBlueprints.reduce((total, blueprint) => total + blueprint.transition_count, 0);
  const blueprintPhaseDetailCount = catalogBlueprints.reduce((total, blueprint) => total + blueprint.phase_detail_count, 0);
  check(blueprintTransitionCount === 202, `Blueprint transition count mismatch: ${blueprintTransitionCount}, expected 202`);
  check(blueprintPhaseDetailCount === 202, `Blueprint phase-detail count mismatch: ${blueprintPhaseDetailCount}, expected 202`);

  check(
    catalogBlueprints.every(blueprint => Number.isInteger(blueprint.policy_eligible_count)
      && Number.isInteger(blueprint.policy_blocked_count)
      && Number.isInteger(blueprint.atomic_runtime_ready_count)),
    'Blueprint catalog policy/runtime counts are incomplete or invalid',
  );
  const blueprintPolicyEligibleCount = catalogBlueprints.reduce((total, blueprint) => total + blueprint.policy_eligible_count, 0);
  const blueprintPolicyBlockedCount = catalogBlueprints.reduce((total, blueprint) => total + blueprint.policy_blocked_count, 0);
  const blueprintAtomicRuntimeReadyCount = catalogBlueprints.reduce((total, blueprint) => total + blueprint.atomic_runtime_ready_count, 0);
  check(blueprintPolicyEligibleCount === 5, `Blueprint policy-eligible count mismatch: ${blueprintPolicyEligibleCount}, expected 5`);
  check(blueprintPolicyBlockedCount === 197, `Blueprint policy-blocked count mismatch: ${blueprintPolicyBlockedCount}, expected 197`);
  check(blueprintAtomicRuntimeReadyCount === 0, `Blueprint atomic-runtime-ready count mismatch: ${blueprintAtomicRuntimeReadyCount}, expected 0`);
  check(blueprintCatalog.body?.coverage?.policy_eligible_transition_count === 5, 'Blueprint catalog policy-eligible aggregate drifted');
  check(blueprintCatalog.body?.coverage?.policy_blocked_transition_count === 197, 'Blueprint catalog policy-blocked aggregate drifted');
  check(blueprintCatalog.body?.coverage?.atomic_runtime_ready_transition_count === 0, 'Blueprint catalog atomic-runtime-ready aggregate drifted');
  check(blueprintCatalog.body?.atomic_runtime?.runtime_executable === false, 'Blueprint catalog unexpectedly reports the atomic runtime as executable');

  const blueprintStudio = await request('/api/meta/blueprint_studio');
  const studioBlueprints = blueprintStudio.body?.blueprints;
  check(blueprintStudio.status === 200 && Array.isArray(studioBlueprints), `Blueprint Studio endpoint failed (${blueprintStudio.status})`);
  check(blueprintStudio.body?.coverage?.transition_count === 202, 'Blueprint Studio transition coverage drifted');
  check(blueprintStudio.body?.coverage?.policy_eligible_transition_count === 5, 'Blueprint Studio policy-eligible count drifted');
  check(blueprintStudio.body?.coverage?.policy_blocked_transition_count === 197, 'Blueprint Studio policy-blocked count drifted');
  check(blueprintStudio.body?.coverage?.atomic_runtime_ready_transition_count === 0, 'Blueprint Studio atomic-runtime-ready count drifted');
  check(blueprintStudio.body?.execution_boundary?.local_transition_execution_enabled === false, 'Blueprint Studio unexpectedly enables local transition execution');
  const contactsOpportunityBlueprint = studioBlueprints.find(blueprint => blueprint.id === '1032257000001044611');
  check(
    contactsOpportunityBlueprint?.module === 'Contacts'
      && contactsOpportunityBlueprint?.name === 'Opportunity Stage'
      && contactsOpportunityBlueprint?.layout?.id === '1032257000000000171'
      && contactsOpportunityBlueprint?.state_field === 'Stage',
    'Contacts Opportunity Stage Blueprint identity drifted',
  );
  const reviseQuoteTransition = contactsOpportunityBlueprint?.transitions?.find(transition => transition.id === '1032257000010720046');
  check(
    reviseQuoteTransition?.name === 'Approve/Revise Quote'
      && reviseQuoteTransition?.from?.display_value === 'Design Form Filled'
      && reviseQuoteTransition?.from?.actual_value === 'Assigned Designer'
      && reviseQuoteTransition?.to?.display_value === 'Approve/Disapprove Quote'
      && reviseQuoteTransition?.to?.actual_value === 'Approve/Disapprove Quote'
      && JSON.stringify(reviseQuoteTransition?.before?.owners || []) === JSON.stringify(['All Users'])
      && reviseQuoteTransition?.during?.input_count === 1
      && reviseQuoteTransition?.during?.inputs?.[0]?.kind === 'widget'
      && reviseQuoteTransition?.during?.inputs?.[0]?.name === 'Revise Quote - Widget'
      && reviseQuoteTransition?.during?.inputs?.[0]?.required === false
      && reviseQuoteTransition?.after?.action_count === 0
      && reviseQuoteTransition?.execution?.executable === false,
    'Revise Quote parent Blueprint/widget tuple drifted',
  );
  const closureNewTransition = contactsOpportunityBlueprint?.transitions?.find(transition => transition.id === '1032257000025407204');
  check(
    closureNewTransition?.name === 'Closure New - Pinki'
      && closureNewTransition?.from?.display_value === 'Principally Closed'
      && closureNewTransition?.from?.actual_value === 'Payment Awaited'
      && closureNewTransition?.to?.display_value === 'Closure'
      && closureNewTransition?.to?.actual_value === 'Principally Closure'
      && JSON.stringify(closureNewTransition?.before?.owners || []) === JSON.stringify(['Specific Users (1)'])
      && closureNewTransition?.during?.input_count === 1
      && closureNewTransition?.during?.inputs?.[0]?.kind === 'widget'
      && closureNewTransition?.during?.inputs?.[0]?.name === 'Closure New - Pinki'
      && closureNewTransition?.during?.inputs?.[0]?.required === false
      && closureNewTransition?.after?.action_count === 0
      && closureNewTransition?.execution?.executable === false,
    'Closure New parent Blueprint/widget tuple drifted',
  );
  const orderStagesBlueprint = studioBlueprints.find(blueprint => blueprint.id === '1032257000000535747');
  check(
    orderStagesBlueprint?.module === 'Deals'
      && orderStagesBlueprint?.name === 'Order Stages'
      && orderStagesBlueprint?.layout?.id === '1032257000000000173'
      && orderStagesBlueprint?.state_field === 'Stage',
    'Deals Order Stages Blueprint identity drifted',
  );
  const revisionRequiredTransition = orderStagesBlueprint?.transitions?.find(transition => transition.id === '1032257000011087211');
  const designApprovedTransition = orderStagesBlueprint?.transitions?.find(transition => transition.id === '1032257000008327496');
  const commonClosureTransition = orderStagesBlueprint?.transitions?.find(transition => transition.id === '1032257000000535729');
  const sunrooofClosureTransition = orderStagesBlueprint?.transitions?.find(transition => transition.id === '1032257000021717028');
  check(
    revisionRequiredTransition?.name === 'Revision Required'
      && revisionRequiredTransition?.from?.display_value === 'Sent for Approval'
      && revisionRequiredTransition?.to?.display_value === 'Revision Required'
      && revisionRequiredTransition?.during?.inputs?.[0]?.api_name === 'Reason_for_Design_Revision1'
      && revisionRequiredTransition?.during?.inputs?.[0]?.required === true
      && revisionRequiredTransition?.after?.actions?.[0]?.name === 'updateRevisionCount',
    'Revision Required child Blueprint contract drifted',
  );
  check(
    designApprovedTransition?.name === 'Design Approved'
      && designApprovedTransition?.from?.display_value === 'Sent for Approval'
      && designApprovedTransition?.to?.display_value === 'Price Discussion'
      && designApprovedTransition?.during?.input_count === 0
      && designApprovedTransition?.after?.actions?.[0]?.name === 'Design Approved Date',
    'Design Approved child Blueprint contract drifted',
  );
  check(
    commonClosureTransition?.name === 'Closure'
      && commonClosureTransition?.from?.display_value === 'Payment Awaited'
      && commonClosureTransition?.to?.display_value === 'Closure'
      && commonClosureTransition?.during?.inputs?.[0]?.api_name === 'Est_Handover_Date'
      && commonClosureTransition?.during?.inputs?.[0]?.required === true
      && commonClosureTransition?.after?.action_count === 0,
    'Common Closure child Blueprint contract drifted',
  );
  check(
    sunrooofClosureTransition?.name === 'Closure Sunrooof'
      && sunrooofClosureTransition?.from?.display_value === 'Payment Awaited'
      && sunrooofClosureTransition?.to?.display_value === 'Closure'
      && sunrooofClosureTransition?.before?.criteria_logic_supported === false
      && sunrooofClosureTransition?.after?.actions?.[0]?.name === 'Sync Magppie To Sunrooof',
    'Blocked SUNROOOF Closure contract drifted',
  );

  const automation = await request('/api/meta/automation');
  check(automation.status === 200 && automation.body && typeof automation.body === 'object', `Automation inventory endpoint failed (${automation.status})`);
  const automationCollections = [
    { label: 'workflow list', value: automation.body['automation:workflow_rules']?.workflow_rules, expected: 44 },
    { label: 'detailed workflow', value: automation.body['automation:workflow_rule_details']?.workflow_rules, expected: 44 },
    { label: 'field update', value: automation.body['automation:field_updates']?.field_updates, expected: 60 },
    { label: 'task', value: automation.body['automation:tasks']?.tasks, expected: 14 },
    { label: 'email notification', value: automation.body['automation:email_notifications']?.email_notifications, expected: 6 },
    { label: 'webhook', value: automation.body['automation:webhooks']?.webhooks, expected: 19 },
    { label: 'function', value: automation.body['automation:functions']?.functions, expected: 60 },
    { label: 'analytics', value: automation.body['automation:analytics']?.Analytics, expected: 32 },
  ];
  for (const collection of automationCollections) {
    check(Array.isArray(collection.value), `Automation ${collection.label} inventory is missing or invalid`);
    check(
      collection.value.length === collection.expected,
      `Automation ${collection.label} count mismatch: ${collection.value.length}, expected ${collection.expected}`,
    );
  }

  const workflowStudio = await request('/api/meta/workflow_studio');
  const workflowStudioRules = workflowStudio.body?.rules;
  check(workflowStudio.status === 200 && Array.isArray(workflowStudioRules), `Workflow Studio endpoint failed (${workflowStudio.status})`);
  check(workflowStudioRules.length === 44, `Workflow Studio rule count mismatch: ${workflowStudioRules.length}, expected 44`);
  check(workflowStudio.body?.aggregates?.eligible_plan_only_rules === 4, 'Workflow Studio plan-eligible active count drifted');
  check(workflowStudio.body?.aggregates?.blocked_active_rules === 35, 'Workflow Studio blocked-active count drifted');
  check(workflowStudio.body?.aggregates?.function_adapters === 1, 'Workflow Studio reviewed function-adapter count drifted');
  check(workflowStudio.body?.execution_boundary?.function_adapters_registered === 2, 'Workflow Studio reviewed adapter-definition count drifted');
  check(workflowStudioRules.filter(rule => rule.studio_status === 'Eligible plan only').length === 4, 'Workflow Studio eligible-rule classification drifted');
  check(workflowStudioRules.filter(rule => rule.studio_status === 'Blocked active').length === 35, 'Workflow Studio blocked-active classification drifted');
  const plannedFunctionAdapters = workflowStudioRules.flatMap(rule => (rule.planned_function_adapters || []).map(adapter => ({ rule, adapter })));
  check(plannedFunctionAdapters.length === 1, 'Workflow Studio must expose exactly one reviewed function adapter');
  const reviewedFunctionAdapter = plannedFunctionAdapters[0];
  check(reviewedFunctionAdapter?.rule?.id === '1032257000016568154', 'Reviewed function adapter is attached to an unexpected workflow rule');
  check(reviewedFunctionAdapter?.rule?.name === 'Update Expected Closing Date Change Counter', 'Reviewed function-adapter rule name drifted');
  check(
    JSON.stringify(reviewedFunctionAdapter?.adapter || null) === JSON.stringify({
      condition_sequence: 1,
      order: 1,
      action_id: '1032257000016568150',
      action_name: 'Update Expected Closing Date Change Counter',
      adapter: 'increment_integer_field_v1',
      operation: 'increment_field',
      field: 'Expected_Closing_Date_Change_Counter',
      default_value: 0,
      increment: 1,
      minimum_current: 0,
      maximum_current: 999999998,
    }),
    'Workflow Studio reviewed function-adapter contract drifted',
  );
  const markVisitDoneRule = workflowStudioRules.find(rule => rule.id === '1032257000023782470');
  check(markVisitDoneRule?.name === 'Mark Visit Done', 'Mark Visit Done workflow rule is missing');
  check(markVisitDoneRule?.studio_status === 'Blocked active', 'Mark Visit Done must remain blocked active');
  check(
    JSON.stringify(markVisitDoneRule?.block_reasons || []) === JSON.stringify([{
      code: 'FUNCTION_PARAMETER_BINDING_UNVERIFIED',
      message: 'The captured workflow action does not expose authoritative function parameter-to-field bindings.',
    }]),
    'Mark Visit Done parameter-binding blocker drifted',
  );
  check((markVisitDoneRule?.planned_function_adapters || []).length === 0, 'Mark Visit Done exposes an unverified plan adapter');
  check(workflowStudio.body?.execution_boundary?.source_calls_enabled === false, 'Workflow Studio source calls are not fail-closed');
  check(workflowStudio.body?.execution_boundary?.source_writes_enabled === false, 'Workflow Studio source writes are not fail-closed');
  check(workflowStudio.body?.execution_boundary?.local_writes_enabled === false, 'Workflow Studio local writes are not fail-closed');
  check(workflowStudio.body?.execution_boundary?.outbound_delivery_enabled === false, 'Workflow Studio outbound delivery is not fail-closed');

  const webhooks = automation.body['automation:webhooks'].webhooks;
  for (let index = 0; index < webhooks.length; index += 1) {
    const webhook = webhooks[index];
    check(webhook && typeof webhook === 'object' && !Array.isArray(webhook), `Webhook ${index + 1} is not an object`);
    check(webhook.endpoint_stored === false, `Webhook ${index + 1} does not explicitly disable endpoint storage`);
    check(webhook.headers_stored === false, `Webhook ${index + 1} does not explicitly disable header storage`);
    const forbiddenField = findForbiddenWebhookField(webhook, `webhooks[${index}]`);
    check(!forbiddenField, `Sanitized webhook inventory contains forbidden field ${forbiddenField}`);
  }

  const fieldUpdates = automation.body['automation:field_updates'].field_updates;
  const automationTasks = automation.body['automation:tasks'].tasks;
  const emailNotifications = automation.body['automation:email_notifications'].email_notifications;
  for (const [label, actions] of [
    ['field update', fieldUpdates],
    ['task', automationTasks],
    ['email notification', emailNotifications],
  ]) {
    for (let index = 0; index < actions.length; index += 1) {
      check(
        actions[index] && typeof actions[index] === 'object' && !Array.isArray(actions[index]),
        `Automation ${label} ${index + 1} is not an object`,
      );
      check(actions[index].local_execution === 'Blocked', `Automation ${label} ${index + 1} is not blocked locally`);
    }
  }

  for (let index = 0; index < fieldUpdates.length; index += 1) {
    const fieldUpdate = fieldUpdates[index];
    check(hasDefinitionContent(fieldUpdate.field), `Field update ${index + 1} has an empty field definition`);
    check(
      Object.prototype.hasOwnProperty.call(fieldUpdate, 'value') && hasDefinitionContent(fieldUpdate.value),
      `Field update ${index + 1} has an empty value definition`,
    );
  }

  for (let taskIndex = 0; taskIndex < automationTasks.length; taskIndex += 1) {
    const task = automationTasks[taskIndex];
    check(
      Array.isArray(task.field_mappings) && task.field_mappings.length > 0,
      `Automation task ${taskIndex + 1} has no field mappings`,
    );
    for (let mappingIndex = 0; mappingIndex < task.field_mappings.length; mappingIndex += 1) {
      const mapping = task.field_mappings[mappingIndex];
      check(
        mapping && typeof mapping === 'object' && !Array.isArray(mapping) && hasDefinitionContent(mapping.field),
        `Automation task ${taskIndex + 1} field mapping ${mappingIndex + 1} has an empty field definition`,
      );
      check(
        Object.prototype.hasOwnProperty.call(mapping, 'value') && hasDefinitionContent(mapping.value),
        `Automation task ${taskIndex + 1} field mapping ${mappingIndex + 1} has an empty value definition`,
      );
    }
  }

  for (let index = 0; index < emailNotifications.length; index += 1) {
    const notification = emailNotifications[index];
    check(
      typeof notification.from_address_configured === 'boolean',
      `Email notification ${index + 1} sender configuration marker is not boolean`,
    );
    check(
      typeof notification.reply_to_address_configured === 'boolean',
      `Email notification ${index + 1} reply-to configuration marker is not boolean`,
    );
    const forbiddenField = findForbiddenEmailNotificationField(notification, `email_notifications[${index}]`);
    check(!forbiddenField, `Sanitized email-notification inventory contains forbidden field ${forbiddenField}`);
    const literalAddress = findLiteralEmailAddress(notification, `email_notifications[${index}]`);
    check(!literalAddress, `Sanitized email-notification inventory contains a literal address at ${literalAddress}`);
  }

  const tasksDefaultBundle = await request('/api/module_bundle/Tasks?per_page=1&page=1');
  const tasksFallbackView = (tasksDefaultBundle.body?.views?.custom_views || [])
    .find(view => String(view?.id || '') === String(tasksDefaultBundle.body?.cvid || ''));
  check(
    tasksDefaultBundle.status === 200
      && tasksDefaultBundle.body?.view_fallback?.applied === true
      && tasksDefaultBundle.body?.view_fallback?.reason_code === 'LOCAL_DEFAULT_VIEW_CRITERIA_UNAVAILABLE'
      && tasksFallbackView?.criteria === null,
    'Implicit unsupported Tasks default did not visibly fall back to an explicitly unfiltered mirrored view',
  );

  const unknownView = await request('/api/records/Leads?per_page=1&page=1&cvid=qa-missing-custom-view');
  checkFailClosed(unknownView, {
    status: 404,
    code: 'CUSTOM_VIEW_NOT_FOUND',
    label: 'Unknown custom view',
  });

  const unsupportedViewMeta = await request(`/api/meta/view?module=Leads&id=${UNSUPPORTED_LEAD_VIEW.id}`);
  const unsupportedView = unsupportedViewMeta.body?.custom_views?.[0];
  check(
    unsupportedViewMeta.status === 200
      && String(unsupportedView?.id || '') === UNSUPPORTED_LEAD_VIEW.id
      && unsupportedView?.name === UNSUPPORTED_LEAD_VIEW.name,
    `Stable unsupported Lead view ${UNSUPPORTED_LEAD_VIEW.name} is unavailable`,
  );
  const unsupportedViewResult = await request(`/api/records/Leads?per_page=1&page=1&cvid=${UNSUPPORTED_LEAD_VIEW.id}`);
  checkFailClosed(unsupportedViewResult, {
    status: 422,
    code: 'CUSTOM_VIEW_CRITERIA_UNSUPPORTED',
    label: `Unsupported custom view ${UNSUPPORTED_LEAD_VIEW.name}`,
  });

  const contactArtifactIsolation = await checkSyntheticArtifactIsolation();

  const leads = await request('/api/records/Leads?per_page=1&page=1');
  const leadId = leads.body?.data?.[0]?.id;
  check(leads.status === 200 && leadId, 'Could not load a Lead for negative transition testing');

  const unresolvedRelated = await request(`/api/related/Leads/${encodeURIComponent(leadId)}/Entity_Cadences_leads?page=1&per_page=1`);
  check(unresolvedRelated.status === 200, `Unresolved related-list endpoint failed (${unresolvedRelated.status})`);
  check(unresolvedRelated.body?.availability === 'unresolved', 'Structurally unresolved related list was not marked unavailable');
  check(unresolvedRelated.body?.reason_code === 'RELATED_TARGET_FIELDS_UNAVAILABLE', 'Structurally unresolved related list returned the wrong reason');
  check(Array.isArray(unresolvedRelated.body?.data) && unresolvedRelated.body.data.length === 0, 'Structurally unresolved related list returned data');
  check(unresolvedRelated.body?.pagination === null, 'Structurally unresolved related list returned false pagination');
  check(!/^empty$/i.test(String(unresolvedRelated.body?.message || '').trim()), 'Structurally unresolved related list was falsely described as empty');

  const queryableRelated = await request(`/api/related/Leads/${encodeURIComponent(leadId)}/Calls?page=1&per_page=1`);
  check(queryableRelated.status === 200, `Queryable related-list endpoint failed (${queryableRelated.status})`);
  check(queryableRelated.body?.availability === 'queryable', 'Queryable related list is not marked queryable');
  check(Array.isArray(queryableRelated.body?.data), 'Queryable related list returned no data array');
  check(queryableRelated.body?.pagination?.page === 1, 'Related-list pagination page mismatch');
  check(queryableRelated.body?.pagination?.per_page === 1, 'Related-list pagination limit mismatch');
  check(queryableRelated.body?.pagination?.returned === queryableRelated.body.data.length, 'Related-list pagination returned-count mismatch');
  check(typeof queryableRelated.body?.pagination?.has_more === 'boolean', 'Related-list pagination has_more is not explicit');
  check(queryableRelated.body?.pagination?.limit_applied === true, 'Related-list pagination does not disclose its applied limit');

  const invalidCreate = await request('/api/record/Leads', {
    method: 'POST',
    body: JSON.stringify({ __unknown_field__: 'must be rejected' }),
  });
  check(invalidCreate.status === 422, `Invalid create was not rejected (${invalidCreate.status})`);

  const blueprint = await request(`/api/blueprint/Leads/${encodeURIComponent(leadId)}`);
  check(blueprint.status === 200, `Lead Blueprint endpoint failed (${blueprint.status})`);
  check(blueprint.body?.blueprint_id === '1032257000000416697', 'Unexpected Lead Blueprint definition');
  check(Array.isArray(blueprint.body?.transitions) && blueprint.body.transitions.length >= 7, 'Common Lead Blueprint transitions are missing');
  const qualified = blueprint.body.transitions.find(item => item.id === '1032257000009279001');
  const humanIntervention = blueprint.body.transitions.find(item => item.id === '1032257000009322035');
  check(
    qualified?.phase_coverage === 'Specified'
      && qualified?.policy_eligible === true
      && qualified?.runtime_executable === false
      && qualified?.executable === false,
    'Qualified transition is not phase-complete, policy-eligible, and atomically blocked',
  );
  check(
    humanIntervention?.phase_coverage === 'Specified'
      && humanIntervention?.policy_eligible === true
      && humanIntervention?.runtime_executable === false
      && humanIntervention?.executable === false,
    'Human Intervention transition is not phase-complete, policy-eligible, and atomically blocked',
  );
  check(blueprint.body?.atomic_runtime?.runtime_executable === false, 'Lead Blueprint unexpectedly reports an executable atomic runtime');
  check(
    JSON.stringify((qualified?.during_inputs || []).map(item => [item.kind, item.api_name, item.required]))
      === JSON.stringify([
        ['field', 'Oppourtunity_Value', true],
        ['associated_item', 'Notes', true],
        ['field', 'Type_of_Client', true],
      ]),
    'Qualified exact mandatory During inputs are incomplete',
  );
  check(
    JSON.stringify((humanIntervention?.during_inputs || []).map(item => [item.kind, item.api_name, item.required]))
      === JSON.stringify([['associated_item', 'Notes', true]]),
    'Human Intervention exact mandatory Notes input is incomplete',
  );

  let rawQuoteContact = null;
  let revisedDesignDiscussionContact = null;
  let approveDisapproveQuoteContact = null;
  let priceDiscussionContact = null;
  for (
    let page = 1;
    page <= 3 && (!rawQuoteContact || !revisedDesignDiscussionContact || !approveDisapproveQuoteContact || !priceDiscussionContact);
    page += 1
  ) {
    const contacts = await request(`/api/records/Contacts?per_page=2000&page=${page}&schedule_count=false`);
    check(contacts.status === 200 && Array.isArray(contacts.body?.data), `Could not inspect Contacts page ${page} for Blueprint QA`);
    rawQuoteContact ||= contacts.body.data.find(record => record.Stage === 'Raw Quote') || null;
    revisedDesignDiscussionContact ||= contacts.body.data.find(record => record.Stage === 'Revised Design Discussion') || null;
    approveDisapproveQuoteContact ||= contacts.body.data.find(record => record.Stage === 'Approve/Disapprove Quote') || null;
    priceDiscussionContact ||= contacts.body.data.find(record => record.Stage === 'Price Discussion') || null;
    if (!contacts.body?.info?.more_records) break;
  }
  check(rawQuoteContact?.id, 'Could not locate a mirrored Raw Quote Contact for read-only Blueprint contract QA');
  const contactBlueprint = await request(`/api/blueprint/Contacts/${encodeURIComponent(rawQuoteContact.id)}`);
  check(contactBlueprint.status === 200 && contactBlueprint.body?.blueprint_id === '1032257000001044611', 'Unexpected Contacts Blueprint definition');
  const ringingNoResponse = (contactBlueprint.body?.transitions || []).find(item => item.id === '1032257000001044561');
  check(
    ringingNoResponse?.policy_eligible === true
      && ringingNoResponse?.runtime_executable === false
      && ringingNoResponse?.executable === false,
    'Ringing No Response is not policy-eligible and atomically blocked under its reviewed contract',
  );
  check(ringingNoResponse?.next_value === 'Ringing No Response' && ringingNoResponse?.next_actual_value === 'Ringing No Response', 'Ringing No Response destination contract drifted');
  check(JSON.stringify(ringingNoResponse?.before?.owners) === JSON.stringify(['All Users']), 'Ringing No Response owner contract drifted');
  check((ringingNoResponse?.before?.criteria || []).length === 0, 'Ringing No Response unexpectedly has Before criteria');
  check((ringingNoResponse?.during_inputs || []).length === 0, 'Ringing No Response unexpectedly has During inputs');
  check((ringingNoResponse?.after_actions || []).length === 0, 'Ringing No Response unexpectedly has After actions');

  check(revisedDesignDiscussionContact?.id, 'Could not locate a mirrored Revised Design Discussion Contact for read-only Blueprint contract QA');
  const revisedContactBlueprint = await request(`/api/blueprint/Contacts/${encodeURIComponent(revisedDesignDiscussionContact.id)}`);
  check(revisedContactBlueprint.status === 200 && revisedContactBlueprint.body?.blueprint_id === '1032257000001044611', 'Unexpected revised-design Contacts Blueprint definition');
  check(revisedContactBlueprint.body?.current === 'Revised Design Discussion', 'Revised Design Discussion current-state contract drifted');
  const revisedDesignDiscussion1 = (revisedContactBlueprint.body?.transitions || []).find(item => item.id === '1032257000001044845');
  check(
    revisedDesignDiscussion1?.name === 'Revised Design Discussion1'
      && revisedDesignDiscussion1?.policy_eligible === true
      && revisedDesignDiscussion1?.runtime_executable === false
      && revisedDesignDiscussion1?.executable === false,
    'Revised Design Discussion1 is not policy-eligible and atomically blocked under its reviewed contract',
  );
  check(revisedDesignDiscussion1?.next_value === 'Revised Design Discussion1' && revisedDesignDiscussion1?.next_actual_value === 'Revised Design Discussion1', 'Revised Design Discussion1 destination contract drifted');
  check(JSON.stringify(revisedDesignDiscussion1?.before?.owners) === JSON.stringify(['All Users']), 'Revised Design Discussion1 owner contract drifted');
  check((revisedDesignDiscussion1?.before?.criteria || []).length === 0, 'Revised Design Discussion1 unexpectedly has Before criteria');
  check((revisedDesignDiscussion1?.during_inputs || []).length === 0, 'Revised Design Discussion1 unexpectedly has During inputs');
  check((revisedDesignDiscussion1?.after_actions || []).length === 0, 'Revised Design Discussion1 unexpectedly has After actions');

  check(approveDisapproveQuoteContact?.id, 'Could not locate a mirrored Approve/Disapprove Quote Contact for read-only Blueprint contract QA');
  const approveQuoteBlueprint = await request(`/api/blueprint/Contacts/${encodeURIComponent(approveDisapproveQuoteContact.id)}`);
  check(approveQuoteBlueprint.status === 200 && approveQuoteBlueprint.body?.blueprint_id === '1032257000001044611', 'Unexpected approve-quote Contacts Blueprint definition');
  check(approveQuoteBlueprint.body?.current === 'Approve/Disapprove Quote', 'Raw Quotation current-state contract drifted');
  const rawQuotation = (approveQuoteBlueprint.body?.transitions || []).find(item => item.id === '1032257000001044557');
  check(
    rawQuotation?.name === 'Raw Quotation'
      && rawQuotation?.policy_eligible === true
      && rawQuotation?.runtime_executable === false
      && rawQuotation?.executable === false,
    'Raw Quotation is not policy-eligible and atomically blocked under its reviewed contract',
  );
  check(rawQuotation?.next_value === 'Raw Quote' && rawQuotation?.next_actual_value === 'Raw Quote', 'Raw Quotation destination contract drifted');
  check(JSON.stringify(rawQuotation?.before?.owners) === JSON.stringify(['All Users']), 'Raw Quotation owner contract drifted');
  check((rawQuotation?.before?.criteria || []).length === 0, 'Raw Quotation unexpectedly has Before criteria');
  check(
    JSON.stringify((rawQuotation?.during_inputs || []).map(item => [item.kind, item.api_name, item.data_type, item.required]))
      === JSON.stringify([
        ['field', 'Next_Follow_UP_Date', 'date', true],
        ['field', 'Amount', 'integer', false],
      ]),
    'Raw Quotation exact During input contract drifted',
  );
  check((rawQuotation?.after_actions || []).length === 0, 'Raw Quotation unexpectedly has After actions');

  check(priceDiscussionContact?.id, 'Could not locate a mirrored Price Discussion Contact for Payment Milestone read-only QA');
  check(priceDiscussionContact?.Stage === 'Price Discussion', 'Payment Milestone QA record display Stage drifted');
  const paymentMilestoneBlueprint = await request(`/api/blueprint/Contacts/${encodeURIComponent(priceDiscussionContact.id)}`);
  check(paymentMilestoneBlueprint.status === 200 && paymentMilestoneBlueprint.body?.blueprint_id === '1032257000001044611', 'Unexpected Payment Milestone Contacts Blueprint definition');
  check(paymentMilestoneBlueprint.body?.current === 'Price Discussion', 'Payment Milestone current display-state contract drifted');
  const createPaymentTerms = (paymentMilestoneBlueprint.body?.transitions || []).find(item => item.id === '1032257000025407036');
  check(createPaymentTerms?.name === 'Create Payment Terms', 'Create Payment Terms transition is unavailable');
  check(
    createPaymentTerms?.policy_eligible === false
      && createPaymentTerms?.runtime_executable === false
      && createPaymentTerms?.executable === false,
    'Create Payment Terms must remain policy-blocked while its read-only preview is available',
  );
  check(
    createPaymentTerms?.next_value === 'Principally Closed' && createPaymentTerms?.next_actual_value === 'Payment Awaited',
    'Create Payment Terms display/actual destination contract drifted',
  );
  check(JSON.stringify(createPaymentTerms?.before?.owners) === JSON.stringify(['Specific Users (1)']), 'Create Payment Terms owner contract drifted');
  check((createPaymentTerms?.before?.criteria || []).length === 0, 'Create Payment Terms unexpectedly has Before criteria');
  check(
    JSON.stringify((createPaymentTerms?.during_inputs || []).map(item => [item.kind, item.widget_id, item.name]))
      === JSON.stringify([['widget', '1032257000007994308', 'Payment Milestone Widget']]),
    'Create Payment Terms exact Payment Milestone widget contract drifted',
  );
  check((createPaymentTerms?.after_actions || []).length === 0, 'Create Payment Terms unexpectedly has After actions');

  let amsRecord = null;
  for (let page = 1; page <= 5 && !amsRecord; page += 1) {
    const records = await request(`/api/records/AMS_Complaints?per_page=200&page=${page}&schedule_count=false`);
    check(records.status === 200 && Array.isArray(records.body?.data), `Could not inspect AMS/Complaints page ${page} for Blueprint QA`);
    amsRecord = records.body.data.find(record => record.Record_Type === 'AMS') || null;
    if (!records.body?.info?.more_records) break;
  }
  check(amsRecord?.id, 'Could not locate a mirrored AMS record for Assign Technician preview QA');
  const amsBlueprint = await request(`/api/blueprint/AMS_Complaints/${encodeURIComponent(amsRecord.id)}`);
  check(amsBlueprint.status === 200 && amsBlueprint.body?.blueprint_id === '1032257000023685467', 'Unexpected AMS/Complaint Blueprint definition');
  const assignTechnician = (amsBlueprint.body?.transitions || []).find(item => item.id === '1032257000023685453');
  check(
    assignTechnician?.name === 'Assign Technician'
      && assignTechnician?.policy_eligible === false
      && assignTechnician?.runtime_executable === false
      && assignTechnician?.executable === false,
    'Assign Technician transition must remain policy-blocked while its preview is available',
  );
  check(
    JSON.stringify((assignTechnician?.during_inputs || []).map(item => [item.kind, item.widget_id, item.name]))
      === JSON.stringify([['widget', '1032257000023774783', 'Assign Technician Widget']]),
    'Assign Technician exact widget contract is unavailable',
  );
  check((assignTechnician?.after_actions || []).length === 0, 'Assign Technician unexpectedly has After actions');

  const unknownTransition = await request(`/api/blueprint/Leads/${encodeURIComponent(leadId)}`, {
    method: 'POST',
    body: JSON.stringify({ transition_id: 'qa-must-not-execute' }),
  });
  check(unknownTransition.status === 404 && unknownTransition.body?.code === 'TRANSITION_NOT_FOUND', `Unknown Blueprint transition was not rejected safely (${unknownTransition.status})`);

  const incompletePolicyEligibleTransition = await request(`/api/blueprint/Leads/${encodeURIComponent(leadId)}`, {
    method: 'POST',
    body: JSON.stringify({ transition_id: '1032257000009279001', data: {}, associated_items: { Notes: { content: '' } } }),
  });
  check(
    incompletePolicyEligibleTransition.status === 422
      && incompletePolicyEligibleTransition.body?.code === 'BLUEPRINT_VALIDATION',
    `Policy-eligible Blueprint input did not fail before atomic execution (${incompletePolicyEligibleTransition.status})`,
  );

  const blockedTransition = await request(`/api/blueprint/Leads/${encodeURIComponent(leadId)}`, {
    method: 'POST',
    body: JSON.stringify({ transition_id: '1032257000000636029' }),
  });
  check(blockedTransition.status === 409 && blockedTransition.body?.code === 'TRANSITION_EXECUTION_BLOCKED', `Non-executable Blueprint transition was not blocked (${blockedTransition.status})`);

  const result = {
    generated_at: new Date().toISOString(),
    origin: ORIGIN,
    checks: {
      version: 'passed',
      boot_and_module_metadata: 'passed',
      zoho_source_mode_read_only: 'passed',
      get_only_sync_schedule_status_15_minutes: 'passed',
      replication_truth_scope_freshness_and_privacy: 'passed',
      journey_source_order_aggregates_values_and_exact_drilldown: 'passed',
      analytics_aggregate_only_metrics_freshness_and_reconciliation: 'passed',
      custom_button_inventory: 'passed',
      sanitized_data_completeness_inventory: 'passed',
      task_and_child_active_id_reconciliation_with_count_only_blocker: 'passed',
      rule_layout_view_and_pipeline_coverage_fail_closed: 'passed',
      metadata_parity_counts_drift_and_mutation_boundary: 'passed',
      private_function_code_coverage_without_code_exposure: 'passed',
      active_function_behavior_coverage_without_sensitive_exposure: 'passed',
      function_execution_boundaries_fail_closed: 'passed',
      widget_runtime_archive_preflight_and_execution_boundaries: 'passed',
      blueprint_catalog_policy_atomic_counts_and_phase_details: 'passed',
      automation_inventory_counts: 'passed',
      action_definition_catalogs_blocked_and_complete: 'passed',
      sanitized_email_notification_inventory: 'passed',
      sanitized_webhook_inventory: 'passed',
      tasks_unsupported_default_visible_unfiltered_fallback: 'passed',
      unknown_custom_view_failed_closed_404: 'passed',
      unsupported_custom_view_failed_closed_422: 'passed',
      synthetic_artifact_excluded_from_search_list_and_count: 'passed',
      related_lists_unresolved_vs_empty_and_pagination: 'passed',
      invalid_create_rejected_422: 'passed',
      lead_blueprint_policy_eligible_atomic_block_and_phase_details: 'passed',
      assign_technician_blocked_transition_and_preview_contract: 'passed',
      contact_ringing_no_response_policy_eligible_atomic_block_read_only: 'passed',
      contact_revised_design_discussion1_policy_eligible_atomic_block_read_only: 'passed',
      contact_raw_quotation_policy_eligible_atomic_block_read_only: 'passed',
      payment_milestone_blocked_transition_and_preview_contract: 'passed',
      workflow_studio_plan_only_and_reviewed_function_adapter: 'passed',
      unknown_blueprint_transition_rejected_404: 'passed',
      policy_eligible_blueprint_missing_inputs_rejected_before_atomic_execution_422: 'passed',
      non_executable_blueprint_transition_blocked_409: 'passed',
    },
    module_count: boot.body.modules.modules.length,
    active_blueprint_module_count: boot.body.blueprint_modules?.length || 0,
    sync_schedule_enabled: syncStatus.body.enabled,
    sync_schedule_interval_minutes: syncStatus.body.interval_minutes,
    blueprint_catalog_count: catalogBlueprints.length,
    blueprint_phase_detail_count: blueprintPhaseDetailCount,
    blueprint_policy_eligible_count: blueprintPolicyEligibleCount,
    blueprint_policy_blocked_count: blueprintPolicyBlockedCount,
    blueprint_atomic_runtime_ready_count: blueprintAtomicRuntimeReadyCount,
    custom_button_count: buttons.body.buttons.length,
    captured_function_code_count: capturedFunctions.length,
    active_function_behavior_count: functionBehaviors.length,
    active_function_behavior_association_count: functionBehaviors.flatMap(fn => fn.associations || []).length,
    widget_runtime_profile_count: widgetRuntimeProfiles.length,
    widget_runtime_implemented_preview_count: widgetRuntimeCompatibility.body.summary.implemented_local_previews,
    widget_runtime_preview_candidate_count: widgetRuntimeCompatibility.body.summary.local_preview_candidates,
    widget_runtime_quarantined_count: widgetRuntimeCompatibility.body.summary.quarantined_packages,
    widget_runtime_quarantined_pending_review_count: widgetRuntimeCompatibility.body.summary.quarantined_pending_sensitive_review,
    widget_runtime_quarantined_review_complete_contract_blocked_count: widgetRuntimeCompatibility.body.summary.quarantined_review_complete_contract_blocked,
    widget_runtime_completed_bounded_review_count: widgetRuntimeCompatibility.body.archive_set.sensitive_review_completed_packages,
    workflow_studio_plan_eligible_count: workflowStudio.body.aggregates.eligible_plan_only_rules,
    workflow_studio_blocked_active_count: workflowStudio.body.aggregates.blocked_active_rules,
    workflow_studio_function_adapter_count: workflowStudio.body.aggregates.function_adapters,
    automation_counts: Object.fromEntries(automationCollections.map(collection => [collection.label, collection.value.length])),
    user_visible_contact_count: contactArtifactIsolation.visibleCount,
    user_visible_contact_pages_checked: contactArtifactIsolation.pages,
  };

  const outDir = path.join(ROOT, '.private', 'qa');
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const target = path.join(outDir, 'live-api.json');
  fs.writeFileSync(target, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(target, 0o600);
  console.log(`Local QA passed: ${result.module_count} modules; ${result.active_blueprint_module_count} active Blueprint modules; ${result.custom_button_count} custom buttons.`);
}

main().catch(error => {
  console.error(`Local QA failed: ${error.message}`);
  process.exitCode = 1;
});
