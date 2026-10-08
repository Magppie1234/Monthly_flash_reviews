#!/usr/bin/env node
'use strict';

// Read-only Zoho CRM discovery. This script never calls a source endpoint that
// can create, update, delete, transition, send, or otherwise mutate CRM data.
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const ATTACHMENT_AUDIT_FLAG = '--audit-attachment-manifest-counts';
if (require.main === module && !process.argv.includes(ATTACHMENT_AUDIT_FLAG)) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
}
const {
  buildReconciliationEvidence,
  resolveModuleEvidence,
} = require('../lib/reconciliation-doc-evidence');

const ROOT = path.join(__dirname, '..');
const PRIVATE_DIR = path.join(ROOT, '.private', 'zoho-discovery');
const ATTACHMENT_MANIFEST_PATH = path.join(ROOT, '.private', 'attachment-replication', 'manifest.jsonl');
const ATTACHMENT_BASELINE_PATH = path.join(ROOT, 'config', 'attachment-replication-baseline.json');
const EXPECTED_SOURCE_ORG = 'org60046349006';
const API = process.env.ZOHO_API_DOMAIN;
const ACCOUNTS = process.env.ZOHO_ACCOUNTS_URL;
const SUPABASE = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const SQL_SECRET = process.env.CRM_SQL_SECRET;
const REQUIRED = ['ZOHO_API_DOMAIN', 'ZOHO_ACCOUNTS_URL', 'ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN'];
const missing = REQUIRED.filter(k => !process.env[k]);

const STATUS = new Set([
  'Not Inspected', 'Inspected', 'Specified', 'In Development', 'Implemented',
  'Data Migrated', 'Tested', 'Reconciled', 'Blocked', 'Not Accessible', 'Not Applicable',
]);
const md = v => String(v ?? '').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ').trim();
const arr = v => Array.isArray(v) ? v : [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const stamp = new Date().toISOString();

const nonnegativeInteger = value => Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;

function attachmentEvidenceFromBaseline(baseline = {}) {
  const sourceAttachmentIds = nonnegativeInteger(baseline.source_attachment_unique_ids);
  const quarantinedRows = nonnegativeInteger(baseline.missing_parent_module_references);
  const locallyLinkedIds = nonnegativeInteger(baseline.local_crm_record_attachment_ids);
  const absentFromLocalRecords = nonnegativeInteger(baseline.source_ids_absent_from_crm_records);
  const exactAddressableTriples = sourceAttachmentIds !== null && quarantinedRows !== null
    ? Math.max(0, sourceAttachmentIds - quarantinedRows)
    : null;
  return {
    source_attachment_ids: sourceAttachmentIds,
    exact_addressable_triples: exactAddressableTriples,
    quarantined_rows: quarantinedRows,
    locally_linked_ids: locallyLinkedIds,
    absent_from_local_records: absentFromLocalRecords,
    migrated_attachment_bodies: baseline.migration_executed === false ? 0 : null,
  };
}

function attachmentAuditError(code) {
  const error = new Error('Attachment manifest count audit failed safely.');
  error.code = code;
  return error;
}

async function auditAttachmentManifestCounts(
  manifestPath = ATTACHMENT_MANIFEST_PATH,
  baselinePath = ATTACHMENT_BASELINE_PATH,
) {
  let baseline;
  try {
    baseline = JSON.parse(await fs.promises.readFile(baselinePath, 'utf8'));
  } catch (error) {
    throw attachmentAuditError(error?.code === 'ENOENT' ? 'ATTACHMENT_BASELINE_NOT_FOUND' : 'ATTACHMENT_BASELINE_INVALID');
  }
  const evidence = attachmentEvidenceFromBaseline(baseline);
  const attachmentIds = new Set();
  let manifestRows = 0;
  let exactAddressableTriples = 0;
  let quarantinedRows = 0;
  let metadataOnlyRows = 0;
  let verifiedMigratedBodies = 0;
  let rowsWithUploadedBytes = 0;
  let duplicateAttachmentIds = 0;
  let wrongOrganizationRows = 0;

  try {
    const lines = readline.createInterface({
      input: fs.createReadStream(manifestPath),
      crlfDelay: Infinity,
    });
    for await (const line of lines) {
      if (!line.trim()) continue;
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        throw attachmentAuditError('ATTACHMENT_MANIFEST_INVALID_JSON');
      }
      manifestRows++;
      const attachmentId = String(row.attachment_id || '').trim();
      if (attachmentId) {
        if (attachmentIds.has(attachmentId)) duplicateAttachmentIds++;
        attachmentIds.add(attachmentId);
      }
      const quarantineReasons = Array.isArray(row.quarantine_reasons) ? row.quarantine_reasons : [];
      const quarantined = row.replication_status === 'quarantined' || quarantineReasons.length > 0;
      if (quarantined) quarantinedRows++;
      if (row.source_org_id !== EXPECTED_SOURCE_ORG) wrongOrganizationRows++;
      if (!quarantined
        && row.source_org_id === EXPECTED_SOURCE_ORG
        && attachmentId
        && String(row.parent_module || '').trim()
        && String(row.parent_record_id || '').trim()) {
        exactAddressableTriples++;
      }
      if (row.replication_status === 'metadata_only') metadataOnlyRows++;
      if (Number(row.uploaded_size_bytes) > 0) rowsWithUploadedBytes++;
      if (row.replication_status === 'verified'
        && row.verification_status === 'sha256_and_size_verified'
        && /^[a-f0-9]{64}$/.test(String(row.content_sha256 || ''))
        && Number(row.uploaded_size_bytes) === Number(row.declared_size_bytes)) {
        verifiedMigratedBodies++;
      }
    }
  } catch (error) {
    if (error?.code?.startsWith('ATTACHMENT_')) throw error;
    throw attachmentAuditError(error?.code === 'ENOENT' ? 'ATTACHMENT_MANIFEST_NOT_FOUND' : 'ATTACHMENT_MANIFEST_READ_FAILED');
  }

  return {
    manifest_rows: manifestRows,
    unique_attachment_ids: attachmentIds.size,
    exact_addressable_triples: exactAddressableTriples,
    quarantined_rows: quarantinedRows,
    metadata_only_rows: metadataOnlyRows,
    verified_migrated_attachment_bodies: verifiedMigratedBodies,
    rows_with_uploaded_bytes: rowsWithUploadedBytes,
    locally_linked_attachment_ids: evidence.locally_linked_ids,
    source_ids_absent_from_local_records: evidence.absent_from_local_records,
    duplicate_attachment_ids: duplicateAttachmentIds,
    wrong_organization_rows: wrongOrganizationRows,
    baseline_counts_match: manifestRows === evidence.source_attachment_ids
      && attachmentIds.size === evidence.source_attachment_ids
      && exactAddressableTriples === evidence.exact_addressable_triples
      && quarantinedRows === evidence.quarantined_rows
      && verifiedMigratedBodies === evidence.migrated_attachment_bodies,
  };
}

let accessToken = null;
async function token() {
  if (accessToken) return accessToken;
  const params = new URLSearchParams({
    refresh_token: process.env.ZOHO_REFRESH_TOKEN,
    client_id: process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });
  const response = await fetch(`${ACCOUNTS}/oauth/v2/token?${params}`, { method: 'POST' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) throw new Error(`Zoho authentication failed (${response.status})`);
  accessToken = body.access_token;
  return accessToken;
}

async function getSource(endpoint, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(`${API}${endpoint}`, {
      method: 'GET',
      headers: { Authorization: `Zoho-oauthtoken ${await token()}` },
    });
    if ((response.status === 429 || response.status >= 500) && attempt < retries) {
      await sleep(1000 * (attempt + 1));
      continue;
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, status: response.status, endpoint, data: null };
    return { ok: true, status: response.status, endpoint, data };
  }
  return { ok: false, status: 599, endpoint, data: null };
}

async function getSourceCount(apiName, retries = 3) {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(apiName)) return { ok: false, status: 400, count: null };
  // Zoho provides an official GET-only record-count action for standard and
  // custom modules, which preserves the source read-only boundary end to end.
  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(`${API}/crm/v8/${encodeURIComponent(apiName)}/actions/count`, {
      method: 'GET',
      headers: { Authorization: `Zoho-oauthtoken ${await token()}` },
    });
    if ((response.status === 429 || response.status >= 500) && attempt < retries) {
      await sleep(1000 * (attempt + 1));
      continue;
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, status: response.status, count: null };
    const value = data?.count ?? arr(data?.data)[0]?.count ?? null;
    return { ok: Number.isFinite(Number(value)), status: response.status, count: Number.isFinite(Number(value)) ? Number(value) : null };
  }
  return { ok: false, status: 599, count: null };
}

async function localSql(query) {
  if (!SUPABASE || !SUPABASE_KEY || !SQL_SECRET) return [];
  try {
    const response = await fetch(`${SUPABASE}/rest/v1/rpc/crm_sql`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, s: SQL_SECRET }),
    });
    if (!response.ok) return [];
    return arr(await response.json());
  } catch {
    return [];
  }
}

async function getLocal(endpoint) {
  try {
    const response = await fetch(`http://127.0.0.1:3100${endpoint}`, { headers: { Accept: 'application/json' } });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function pool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, run));
  return results;
}

const extract = (result, key) => result?.ok ? arr(result.data?.[key]) : [];
const statusFor = result => result?.ok ? 'Inspected' : (result?.status === 401 || result?.status === 403 ? 'Not Accessible' : 'Blocked');
const assertStatus = value => STATUS.has(value) ? value : 'Blocked';

function writePrivate(name, value) {
  fs.mkdirSync(PRIVATE_DIR, { recursive: true, mode: 0o700 });
  const target = path.join(PRIVATE_DIR, name);
  fs.writeFileSync(target, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.chmodSync(target, 0o600);
}

function writeDoc(name, lines) {
  const target = path.join(ROOT, name);
  fs.writeFileSync(target, `${lines.join('\n').trim()}\n`, 'utf8');
}

function moduleLabel(module) {
  return module.plural_label || module.module_name || module.api_name;
}

function fieldRows(fields) {
  return arr(fields?.data?.fields);
}

function relatedTarget(field) {
  return field.lookup?.module?.api_name || field.subform?.module?.api_name || field.multi_module_lookup?.module?.api_name || '';
}

function picklistText(field) {
  const values = arr(field.pick_list_values).map(v => v.display_value || v.actual_value).filter(Boolean);
  return values.length ? values.map(v => String(v).replace(/`/g, '\\`')).join('; ') : '';
}

function sanitizeReference(value, keys = ['id', 'name', 'api_name']) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out = {};
  for (const key of keys) {
    if (['string', 'number', 'boolean'].includes(typeof value[key])) out[key] = value[key];
  }
  return Object.keys(out).length ? out : null;
}

function sanitizeCriterionValue(value) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.map(sanitizeCriterionValue).filter(item => item !== undefined);
  return sanitizeReference(value, ['id', 'name', 'api_name', 'display_value', 'actual_value']) || undefined;
}

function sanitizeCriteria(criteria) {
  if (!criteria || typeof criteria !== 'object' || Array.isArray(criteria)) return null;
  if (Array.isArray(criteria.group)) {
    const group = criteria.group.map(sanitizeCriteria).filter(Boolean);
    if (!group.length) return null;
    return { group_operator: String(criteria.group_operator || 'AND').toUpperCase(), group };
  }
  const field = sanitizeReference(criteria.field, ['id', 'api_name']);
  if (!field) return null;
  const out = { field };
  if (criteria.comparator !== undefined) out.comparator = String(criteria.comparator);
  if (criteria.type !== undefined) out.type = String(criteria.type);
  if (criteria.value !== undefined) out.value = sanitizeCriterionValue(criteria.value);
  return out;
}

function flattenCompatibleEntryCriteria(criteria) {
  if (!criteria) return [];
  if (Array.isArray(criteria.group)) {
    if (String(criteria.group_operator || 'AND').toUpperCase() !== 'AND') return [];
    const children = criteria.group.map(flattenCompatibleEntryCriteria);
    if (children.some(child => !child.length)) return [];
    return children.flat();
  }
  const field = criteria.field?.api_name;
  if (!field || criteria.value === undefined) return [];
  return [{ field, operator: String(criteria.comparator || 'equal'), value: criteria.value }];
}

function sanitizeState(state) {
  if (!state || typeof state !== 'object') return null;
  const out = sanitizeReference(state, ['id', 'name']) || {};
  if (typeof state.sla_configured === 'boolean') out.sla_configured = state.sla_configured;
  if (typeof state.unsupported_features_present === 'boolean') out.unsupported_features_present = state.unsupported_features_present;
  return out.id || out.name ? out : null;
}

function sanitizeIncludedState(item) {
  if (!item || typeof item !== 'object') return null;
  const state = sanitizeState(item.state);
  if (!state) return null;
  const out = { state };
  if (item.id !== undefined) out.id = String(item.id);
  if (Number.isFinite(Number(item.precedence))) out.precedence = Number(item.precedence);
  return out;
}

function sanitizeTransition(transition) {
  if (!transition || typeof transition !== 'object' || transition.id === undefined) return null;
  const out = {
    id: String(transition.id),
    name: transition.name || null,
    api_name: transition.api_name || null,
    trigger_type: transition.trigger_type || null,
    transition_type: transition.transition_type || null,
    global: transition.global === true,
    include_states: arr(transition.include_states).map(sanitizeIncludedState).filter(Boolean),
  };
  if (typeof transition.unsupported_features_present === 'boolean') out.unsupported_features_present = transition.unsupported_features_present;
  return out;
}

function sanitizeConnection(connection) {
  if (!connection || typeof connection !== 'object') return null;
  const fromState = sanitizeState(connection.from_state || connection.from);
  const toState = sanitizeState(connection.to_state || connection.to);
  const transition = sanitizeReference(connection.transitions || connection.transition, ['id', 'name', 'api_name', 'common', 'precedence']);
  if (!fromState || !toState || !transition?.id) return null;
  return {
    id: connection.id === undefined ? null : String(connection.id),
    from_state: fromState,
    to_state: toState,
    transition,
  };
}

function exactBlueprint(result, expectedId) {
  return extract(result, 'blueprints').find(item => String(item.id) === String(expectedId)) || null;
}

function stateEndpoint(state, actualById) {
  if (!state) return { id: null, display_value: 'Unknown', actual_value: 'Unknown' };
  const id = state.id === undefined ? null : String(state.id);
  const display = state.name || (id ? `State ${id}` : 'Unknown');
  return { id, display_value: display, actual_value: actualById.get(String(id)) || display };
}

function parseUiEntryCriteria(lines, fields) {
  return arr(lines).map(line => {
    const match = String(line).match(/^\d+\s+(.+?)\s+IS\s+(.+)$/i);
    if (!match) return null;
    const criterionField = fields.find(item => [item.field_label, item.display_label, item.api_name].includes(match[1]));
    return criterionField ? { field: criterionField.api_name, operator: 'equal', value: match[2] } : null;
  }).filter(Boolean);
}

async function main() {
  if (missing.length) throw new Error(`Missing required environment keys: ${missing.join(', ')}`);
  console.log('Read-only discovery: authenticating and verifying organization');
  const org = await getSource('/crm/v8/org');
  if (!org.ok) throw new Error(`Organization inspection failed (${org.status})`);
  const sourceOrg = arr(org.data?.org)[0] || {};
  const configuredOrg = String(process.env.ZOHO_CRM_ORG_ID || process.env.ZOHO_ORGANIZATION_ID || '').trim();
  const orgCandidates = [sourceOrg.id, sourceOrg.zgid, sourceOrg.domain_name].filter(Boolean).map(String);
  const orgVerified = configuredOrg ? orgCandidates.includes(configuredOrg) : false;
  if (configuredOrg && !orgVerified) throw new Error('Authenticated Zoho organization does not match the configured target organization');

  const globalSpecs = {
    modules: '/crm/v8/settings/modules',
    users: '/crm/v8/users?type=AllUsers&per_page=200',
    roles: '/crm/v8/settings/roles',
    profiles: '/crm/v8/settings/profiles',
    territories: '/crm/v8/settings/territories',
    currencies: '/crm/v8/org/currencies',
    global_picklists: '/crm/v8/settings/global_picklists',
    variables: '/crm/v8/settings/variables',
    workflow_rules: '/crm/v8/settings/automation/workflow_rules?per_page=200&page=1',
    field_updates: '/crm/v8/settings/automation/field_updates?per_page=200&page=1',
    email_notifications: '/crm/v8/settings/automation/email_notifications?per_page=200&page=1',
    automation_tasks: '/crm/v8/settings/automation/tasks?per_page=200&page=1',
    webhooks: '/crm/v8/settings/automation/webhooks?per_page=200&page=1',
    functions: '/crm/v8/settings/functions?per_page=200&page=1',
  };
  const globalEntries = Object.entries(globalSpecs);
  const globalResults = Object.fromEntries(await pool(globalEntries, 4, async ([key, endpoint]) => [key, await getSource(endpoint)]));
  const listedWorkflowRules = extract(globalResults.workflow_rules, 'workflow_rules');
  globalResults.workflow_rule_details = await pool(listedWorkflowRules, 3, rule => getSource(`/crm/v8/settings/automation/workflow_rules/${encodeURIComponent(rule.id)}`));
  const automationActionSpecs = [
    ['field_updates', 'field_updates'],
    ['email_notifications', 'email_notifications'],
    ['automation_tasks', 'tasks'],
  ];
  const referencedWorkflowActions = arr(globalResults.workflow_rule_details).flatMap(result => extract(result, 'workflow_rules')).flatMap(rule => arr(rule.conditions).flatMap(condition => [
    ...arr(condition.instant_actions?.actions),
    ...arr(condition.scheduled_actions).flatMap(schedule => arr(schedule.actions)),
  ]));
  for (const [resultKey, responseKey] of automationActionSpecs) {
    const listedActions = extract(globalResults[resultKey], responseKey);
    const listedIds = new Set(listedActions.map(action => String(action.id)));
    const missingReferences = referencedWorkflowActions
      .filter(action => action.type === responseKey && !listedIds.has(String(action.id)))
      .map(action => ({ id: String(action.id), name: action.name, referenced_only: true }));
    const detailTargets = [...listedActions, ...new Map(missingReferences.map(action => [String(action.id), action])).values()];
    globalResults[`${resultKey}_details`] = await pool(detailTargets, 3, action => getSource(`/crm/v8/settings/automation/${responseKey}/${encodeURIComponent(action.id)}`));
  }
  const profileList = extract(globalResults.profiles, 'profiles');
  globalResults.profile_details = await pool(profileList, 3, profile => getSource(`/crm/v8/settings/profiles/${encodeURIComponent(profile.id)}`));
  const modules = extract(globalResults.modules, 'modules');
  if (!modules.length) throw new Error('No accessible CRM modules were returned');
  console.log(`Read-only discovery: ${modules.length} module definitions found`);

  const accessibleModules = modules.filter(module => module.api_name && module.api_supported !== false);
  const moduleDiscovery = await pool(accessibleModules, 3, async module => {
    const apiName = module.api_name;
    const encoded = encodeURIComponent(apiName);
    const specs = {
      fields: `/crm/v8/settings/fields?module=${encoded}`,
      layouts: `/crm/v8/settings/layouts?module=${encoded}`,
      views: `/crm/v8/settings/custom_views?module=${encoded}`,
      related_lists: `/crm/v8/settings/related_lists?module=${encoded}`,
      blueprints: `/crm/v8/settings/blueprints?module=${encoded}`,
      custom_buttons: `/crm/v8/settings/custom_buttons?module=${encoded}`,
      wizards: `/crm/v8/settings/wizards?module=${encoded}`,
      validation_rules: `/crm/v8/settings/automation/validation_rules?module=${encoded}`,
      assignment_rules: `/crm/v8/settings/automation/assignment_rules?module=${encoded}`,
      approval_rules: `/crm/v8/settings/automation/approval_rules?module=${encoded}`,
    };
    const entries = Object.entries(specs);
    const results = Object.fromEntries(await pool(entries, 3, async ([key, endpoint]) => [key, await getSource(endpoint)]));
    const layouts = extract(results.layouts, 'layouts');
    results.pipelines = await pool(layouts.filter(layout => layout.id), 2, layout => getSource(`/crm/v8/settings/pipeline?layout_id=${encodeURIComponent(layout.id)}`));
    return { module, results };
  });

  const listedBlueprints = moduleDiscovery.flatMap(entry => extract(entry.results.blueprints, 'blueprints')
    .filter(blueprint => blueprint.id)
    .map(blueprint => ({ module: entry.module.api_name, blueprint })));
  console.log(`Read-only discovery: requesting authoritative state/transition graphs for ${listedBlueprints.length} listed Blueprints`);
  const blueprintStructureRequests = await pool(listedBlueprints, 2, async listed => {
    const endpoint = `/crm/v8/settings/blueprints/${encodeURIComponent(listed.blueprint.id)}?include=state,transition`;
    const result = await getSource(endpoint);
    const blueprint = exactBlueprint(result, listed.blueprint.id);
    return { module: listed.module, listed: listed.blueprint, result, blueprint };
  });
  const successfulBlueprintStructures = blueprintStructureRequests.filter(item => item.blueprint);
  // Full successful responses stay only in the ignored, permission-restricted
  // private snapshot. Public config is built later from an explicit allowlist.
  globalResults.blueprint_structures = successfulBlueprintStructures.map(item => ({
    module: item.module,
    blueprint_id: String(item.listed.id),
    response: item.result.data,
  }));
  globalResults.blueprint_structure_status = blueprintStructureRequests.map(item => ({
    module: item.module,
    blueprint_id: String(item.listed.id),
    ok: Boolean(item.blueprint),
    status: item.result.status,
  }));
  const blueprintStructureById = new Map(successfulBlueprintStructures.map(item => [String(item.listed.id), item.blueprint]));

  let functionCodeManifest = { functions: [], reconciliation: null };
  try {
    functionCodeManifest = JSON.parse(fs.readFileSync(path.join(PRIVATE_DIR, 'functions-code', 'manifest.json'), 'utf8'));
  } catch {}
  const capturedFunctionCodeIds = new Set(arr(functionCodeManifest.functions)
    .filter(item => item.status === 200 && Number(item.byte_length) > 0)
    .map(item => String(item.id)));

  let reportDashboardUi = { all_reports: [], report_categories: [], dashboard_names: [] };
  try {
    reportDashboardUi = JSON.parse(fs.readFileSync(path.join(PRIVATE_DIR, 'report-dashboard-ui.json'), 'utf8'));
  } catch {}
  let reportExportManifest = { exports: [] };
  try {
    reportExportManifest = JSON.parse(fs.readFileSync(path.join(PRIVATE_DIR, 'report-export-manifest.json'), 'utf8'));
  } catch {}
  const reportInventoryCount = arr(reportDashboardUi.all_reports).length;
  const reportCategoryCount = arr(reportDashboardUi.report_categories).length;
  const dashboardInventoryCount = arr(reportDashboardUi.dashboard_names).length;
  const verifiedReportExportCount = arr(reportExportManifest.exports).filter(report => report.status === 'verified').length;

  let widgetBehaviorInventory = { reconciliation: {} };
  try {
    widgetBehaviorInventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'widget-behavior-inventory.json'), 'utf8'));
  } catch {}
  const widgetReconciliation = widgetBehaviorInventory.reconciliation || {};

  let attachmentBaseline = {};
  try {
    attachmentBaseline = JSON.parse(fs.readFileSync(ATTACHMENT_BASELINE_PATH, 'utf8'));
  } catch {}
  const attachmentEvidence = attachmentEvidenceFromBaseline(attachmentBaseline);

  let permissionCoverage = { source_coverage: {} };
  try {
    permissionCoverage = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'permission-coverage.json'), 'utf8'));
  } catch {}
  const permissionSourceCoverage = permissionCoverage.source_coverage || {};

  let dataCompleteness = {};
  try {
    dataCompleteness = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'data-completeness.json'), 'utf8'));
  } catch {}
  let taskSubformReconciliation = {};
  try {
    taskSubformReconciliation = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'task-subform-reconciliation.json'), 'utf8'));
  } catch {}
  const reconciliationEvidence = buildReconciliationEvidence(dataCompleteness, taskSubformReconciliation);
  const relatedListEvidence = dataCompleteness.related_lists || {};
  const relatedListEvidenceUsable = [
    relatedListEvidence.generic_ui_evaluated_definition_count,
    relatedListEvidence.queryable_definition_count,
    relatedListEvidence.unresolved_definition_count,
  ].every(Number.isSafeInteger)
    && relatedListEvidence.queryable_definition_count + relatedListEvidence.unresolved_definition_count
      === relatedListEvidence.generic_ui_evaluated_definition_count;
  let metadataParityAudit = { areas: {} };
  try {
    metadataParityAudit = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'metadata-parity-audit.json'), 'utf8'));
  } catch {}
  const metadataAreas = metadataParityAudit.areas || {};
  let ruleLayoutCoverage = { source_coverage: {}, local_enforcement: {} };
  try {
    ruleLayoutCoverage = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'rule-layout-coverage.json'), 'utf8'));
  } catch {}

  let blueprintUi = { blueprints: [] };
  try {
    blueprintUi = JSON.parse(fs.readFileSync(path.join(PRIVATE_DIR, 'blueprint-ui.json'), 'utf8'));
  } catch {}
  let blueprintLocalPhases = { blueprints: {} };
  try {
    blueprintLocalPhases = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'blueprint-transition-details.json'), 'utf8'));
  } catch {}
  const transitionIds = [...new Set(arr(blueprintUi.blueprints).flatMap(blueprint => arr(blueprint.transitions).map(transition => transition.transition_id).filter(Boolean)))];
  const transitionChunks = [];
  for (let index = 0; index < transitionIds.length; index += 50) transitionChunks.push(transitionIds.slice(index, index + 50));
  const transitionResults = await pool(transitionChunks, 2, ids => getSource(`/crm/v8/settings/blueprints/transitions?ids=${encodeURIComponent(ids.join(','))}`));
  const transitionDetails = transitionResults.flatMap(result => result.ok ? arr(result.data?.transitions) : []);
  const transitionById = new Map(transitionDetails.map(transition => [String(transition.id), transition]));
  globalResults.blueprint_transition_details = transitionResults;

  console.log('Read-only discovery: reconciling source and local record counts');
  const countResults = await pool(accessibleModules, 3, module => getSourceCount(module.api_name));
  moduleDiscovery.forEach((entry, index) => { entry.source_count = countResults[index]; });

  const localModulesRaw = await getLocal('/api/meta/modules');
  const localModules = arr(localModulesRaw?.modules);
  const localSyncRows = await localSql("select data from crm_meta where key = 'sync_info'");
  const localSync = localSyncRows[0]?.data || await getLocal('/api/meta/sync_info');
  const localModuleNames = new Set(localModules.map(module => module.api_name));
  const localCountRows = await localSql("select module, count(*)::int as count, count(*) filter (where id not like 'local-%')::int as source_derived_count, count(*) filter (where id like 'local-%')::int as local_only_count, count(*) filter (where id like 'local-%' and lower(coalesce(data->>'__test_artifact', '')) = 'true')::int as local_qa_count from crm_records group by module order by module");
  const snapshotCounts = Object.fromEntries(localCountRows.map(row => [row.module, Number(row.count)]));
  const sourceDerivedCounts = Object.fromEntries(localCountRows.map(row => [row.module, Number(row.source_derived_count)]));
  const localOnlyCounts = Object.fromEntries(localCountRows.map(row => [row.module, Number(row.local_only_count)]));
  const localQaCounts = Object.fromEntries(localCountRows.map(row => [row.module, Number(row.local_qa_count)]));
  const countedDatasets = countResults.filter(result => result.ok).length;
  const reconciledDatasets = moduleDiscovery.filter(({ module, source_count }) => source_count.ok && Number.isFinite(sourceDerivedCounts[module.api_name]) && source_count.count === sourceDerivedCounts[module.api_name]).length;
  const countBlockedDatasets = accessibleModules.length - countedDatasets;
  const localPhysicalRecordTotal = Object.values(snapshotCounts).reduce((sum, count) => sum + Number(count || 0), 0);
  const localSourceDerivedRecordTotal = Object.values(sourceDerivedCounts).reduce((sum, count) => sum + Number(count || 0), 0);
  const localOnlyRecordTotal = Object.values(localOnlyCounts).reduce((sum, count) => sum + Number(count || 0), 0);
  const localQaRecordTotal = Object.values(localQaCounts).reduce((sum, count) => sum + Number(count || 0), 0);
  const localDeltaCandidate = localSync?.last_delta?.at || localSync?.delta_at;
  const localDeltaAt = typeof localDeltaCandidate === 'string' && Number.isFinite(Date.parse(localDeltaCandidate))
    ? new Date(localDeltaCandidate).toISOString()
    : null;

  const discovery = {
    generated_at: stamp,
    source_mode: 'read-only',
    organization_verified: orgVerified,
    organization: org,
    global: globalResults,
    modules: moduleDiscovery,
    local: {
      modules: localModules,
      sync_info: localSync,
      record_counts: snapshotCounts,
      source_derived_record_counts: sourceDerivedCounts,
      local_only_record_counts: localOnlyCounts,
      local_qa_record_counts: localQaCounts,
    },
  };
  writePrivate('latest.json', discovery);

  const sourceCountFor = apiName => moduleDiscovery.find(entry => entry.module.api_name === apiName)?.source_count?.count;
  const evidenceFor = apiName => resolveModuleEvidence(reconciliationEvidence, apiName, sourceCountFor(apiName));
  const notesEvidence = evidenceFor('Notes');
  const tasksEvidence = evidenceFor('Tasks');
  const childEvidenceSummary = reconciliationEvidence.summary || {};
  const usableActiveEvidence = evidence => evidence?.active_id_parity && !evidence.count_endpoint_drift;
  const childEvidence = Object.values(reconciliationEvidence.modules || {})
    .filter(item => item.evidence_kind === 'generated-child-active-id-audit')
    .map(item => evidenceFor(item.module));
  const usableChildEvidence = childEvidence.length === 4 && childEvidence.every(usableActiveEvidence);
  const formatCount = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
    ? Number(value).toLocaleString('en-IN')
    : 'Pending';
  const localOnlySummary = localOnlyRecordTotal === 1 && localQaRecordTotal === 1 && localQaCounts.Contacts === 1
    ? 'one retained local-only Contacts QA row'
    : `${formatCount(localOnlyRecordTotal)} local-only row(s)`;
  const moduleLocalStatus = (apiName, sourceCount, localSourceDerivedCount, localOnlyCount = 0, localQaCount = 0) => {
    const evidence = resolveModuleEvidence(reconciliationEvidence, apiName, sourceCount);
    if (usableActiveEvidence(evidence)) {
      if (evidence.count_scope_kind === 'count-only' && evidence.count_scope_delta > 0) {
        const noun = evidence.count_scope_delta === 1 ? 'row' : 'rows';
        return `Blocked: active-ID parity; ${formatCount(evidence.count_scope_delta)} count-only ${noun} unavailable`;
      }
      if (evidence.count_scope_kind === 'aggregate-scope' && evidence.count_scope_delta > 0) {
        return `Reconciled active IDs; ${formatCount(evidence.count_scope_delta)}-row aggregate scope unresolved`;
      }
      return 'Reconciled';
    }
    return Number.isFinite(sourceCount) && Number.isFinite(localSourceDerivedCount) && sourceCount === localSourceDerivedCount
      ? (localOnlyCount > 0
        ? `Reconciled source-derived rows; ${formatCount(localOnlyCount)} local-only${localQaCount === localOnlyCount ? ' QA' : ''} row(s) retained`
        : 'Reconciled')
      : (Number.isFinite(localSourceDerivedCount) ? 'Data Migrated' : 'Not Inspected');
  };

  const sourceInventory = [
    '# Zoho CRM Source Inventory', '',
    `Generated: ${stamp}`, '',
    `Source mode: **read-only**`, '',
    `Authenticated target organization verified: **${orgVerified ? 'Yes' : 'Not configured'}**`, '',
    'Raw API responses are stored only in the ignored, permission-restricted `.private/zoho-discovery/` directory.', '',
    'The authenticated Setup index was also mapped in read-only mode. See `ZOHO_SETUP_UI_INVENTORY.md` for the accessible Setup surface.', '',
    `The module table covers ${accessibleModules.length} API-supported datasets within the ${modules.length}-module catalog. Data Volume is the aggregate count endpoint when available; it must not be read as active-ID parity.`, '',
    usableActiveEvidence(notesEvidence) && usableActiveEvidence(tasksEvidence) && usableChildEvidence
      ? `Audited active IDs reconcile exactly for Notes at ${formatCount(notesEvidence.source_active_ids)}/${formatCount(notesEvidence.local_active_ids)} and Tasks at ${formatCount(tasksEvidence.source_active_ids)}/${formatCount(tasksEvidence.local_active_ids)}. The four generated child datasets reconcile ${formatCount(childEvidenceSummary.child_source_active_ids)}/${formatCount(childEvidenceSummary.child_local_active_ids)} enumerable active IDs; ${formatCount(childEvidenceSummary.child_count_only_unavailable)} additional count-only rows expose no IDs or payloads.`
      : 'Active-ID evidence is incomplete; aggregate count equality is not treated as record-level parity.', '',
    `The local store contains ${formatCount(localPhysicalRecordTotal)} physical rows: ${formatCount(localSourceDerivedRecordTotal)} source-derived rows and ${localOnlySummary}. Aggregate source-count comparisons use source-derived rows only.`, '',
    localDeltaAt ? `These local totals were read after the latest recorded local delta at ${localDeltaAt}.` : 'The latest local-delta timestamp is unavailable.', '',
    `Attachment evidence is metadata-only: ${formatCount(attachmentEvidence.source_attachment_ids)} source IDs, ${formatCount(attachmentEvidence.exact_addressable_triples)} exact addressable triples, ${formatCount(attachmentEvidence.quarantined_rows)} quarantined rows, ${formatCount(attachmentEvidence.locally_linked_ids)} locally linked IDs, ${formatCount(attachmentEvidence.absent_from_local_records)} source IDs absent locally, and ${formatCount(attachmentEvidence.migrated_attachment_bodies)} bodies migrated. On-demand access is implemented and tested but unmounted. Reproduce count-only evidence without loading credentials or accessing the source with <code>node scripts/discover-zoho.js --audit-attachment-manifest-counts</code>. See [Attachment Replication](ATTACHMENT_REPLICATION.md), [On-demand Access](docs/on-demand-attachment-access.md), [Migration Manifest](ZOHO_MIGRATION_MANIFEST.md), and [Reconciliation Report](ZOHO_RECONCILIATION_REPORT.md).`, '',
    '| Category | Source Item | Configuration | Dependencies | Data Volume | Local Status | Verification |',
    '| --- | --- | --- | --- | ---: | --- | --- |',
  ];
  for (const entry of moduleDiscovery) {
    const { module, results, source_count } = entry;
    const fields = extract(results.fields, 'fields');
    const layouts = extract(results.layouts, 'layouts');
    const views = extract(results.views, 'custom_views');
    const related = extract(results.related_lists, 'related_lists');
    const localCount = sourceDerivedCounts[module.api_name];
    const localStatus = module.api_name === 'Attachments'
      ? `Metadata only: ${formatCount(attachmentEvidence.source_attachment_ids)} IDs indexed; ${formatCount(attachmentEvidence.migrated_attachment_bodies)} bodies migrated; on-demand access unmounted`
      : moduleLocalStatus(module.api_name, source_count.ok ? source_count.count : null, localCount, localOnlyCounts[module.api_name] || 0, localQaCounts[module.api_name] || 0);
    const dataVolume = module.api_name === 'Attachments'
      ? `${formatCount(attachmentEvidence.source_attachment_ids)} metadata IDs`
      : (source_count.ok ? md(source_count.count) : 'Pending');
    sourceInventory.push(`| Module | ${md(moduleLabel(module))} (${md(module.api_name)}) | ${fields.length} fields; ${layouts.length} layouts; ${views.length} views; ${related.length} related lists | Metadata and lookup map | ${dataVolume} | ${localStatus} | ${assertStatus(statusFor(results.fields))} |`);
  }
  sourceInventory.push('', '## Organization-Level Discovery', '', '| Area | Endpoint status | Coverage status |', '| --- | ---: | --- |');
  for (const [key] of globalEntries) sourceInventory.push(`| ${md(key.replace(/_/g, ' '))} | ${globalResults[key].status} | ${assertStatus(statusFor(globalResults[key]))} |`);
  writeDoc('ZOHO_SOURCE_INVENTORY.md', sourceInventory);

  const coverage = [
    '# Zoho CRM Coverage Matrix', '',
    `Generated: ${stamp}`, '',
    'Allowed statuses: Not Inspected, Inspected, Specified, In Development, Implemented, Data Migrated, Tested, Reconciled, Blocked, Not Accessible, Not Applicable.', '',
    metadataAreas.modules
      ? `Module metadata reconciles at ${formatCount(metadataAreas.modules.source_definitions)}/${formatCount(metadataAreas.modules.local_definitions)}. Local metadata remains incomplete for fields (${formatCount(metadataAreas.fields?.local_definitions)}/${formatCount(metadataAreas.fields?.source_definitions)}), layouts (${formatCount(metadataAreas.layouts?.local_definitions)}/${formatCount(metadataAreas.layouts?.source_definitions)}), picklists (${formatCount(metadataAreas.picklists?.local_definitions)}/${formatCount(metadataAreas.picklists?.source_definitions)}), custom views (${formatCount(metadataAreas.custom_views?.local_definitions)}/${formatCount(metadataAreas.custom_views?.source_definitions)}), and related lists (${formatCount(metadataAreas.related_lists?.local_definitions)}/${formatCount(metadataAreas.related_lists?.source_definitions)}).`
      : `Module catalog evidence contains ${formatCount(modules.length)} source definitions and ${formatCount(localModules.length)} local definitions; detailed metadata parity evidence is unavailable.`, '',
    usableActiveEvidence(notesEvidence) && usableActiveEvidence(tasksEvidence) && usableChildEvidence
      ? `Active Notes and Tasks reconcile exactly at ${formatCount(notesEvidence.source_active_ids)}/${formatCount(notesEvidence.local_active_ids)} and ${formatCount(tasksEvidence.source_active_ids)}/${formatCount(tasksEvidence.local_active_ids)}. Four generated child datasets reconcile every enumerable active ID, while ${formatCount(childEvidenceSummary.child_count_only_unavailable)} additional count-only rows remain blocked because the source exposes no IDs or payloads for them.`
      : 'Active-ID evidence is incomplete; aggregate count equality is not treated as record-level parity.', '',
    '| Module | Metadata | Layouts | Fields | Views | Related Lists | Blueprints | Buttons | Validation | Permissions | Data | Tests | Reconciliation |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const { module, results, source_count } of moduleDiscovery) {
    if (module.api_name === 'Attachments') {
      coverage.push(`| ${md(moduleLabel(module))} | ${assertStatus(statusFor(results.fields))} | ${assertStatus(statusFor(results.layouts))} | ${assertStatus(statusFor(results.fields))} | ${assertStatus(statusFor(results.views))} | ${assertStatus(statusFor(results.related_lists))} | ${assertStatus(statusFor(results.blueprints))} | ${assertStatus(statusFor(results.custom_buttons))} | ${assertStatus(statusFor(results.validation_rules))} | Blocked | Blocked | Tested | Blocked |`);
      continue;
    }
    const localCount = sourceDerivedCounts[module.api_name];
    const evidence = resolveModuleEvidence(reconciliationEvidence, module.api_name, source_count.ok ? source_count.count : null);
    const aggregateReconciled = source_count.ok && Number.isFinite(localCount) && source_count.count === localCount;
    const dataStatus = usableActiveEvidence(evidence)
      ? (evidence.evidence_kind === 'generated-child-active-id-audit' ? 'Data Migrated' : 'Reconciled')
      : (aggregateReconciled ? 'Reconciled' : (Number.isFinite(localCount) ? 'Data Migrated' : 'Not Inspected'));
    const testStatus = usableActiveEvidence(evidence) ? 'Tested' : 'Not Inspected';
    const reconcileStatus = usableActiveEvidence(evidence)
      ? (evidence.count_scope_delta > 0 ? 'Blocked' : 'Reconciled')
      : (aggregateReconciled ? 'Reconciled' : 'Not Inspected');
    coverage.push(`| ${md(moduleLabel(module))} | ${assertStatus(statusFor(results.fields))} | ${assertStatus(statusFor(results.layouts))} | ${assertStatus(statusFor(results.fields))} | ${assertStatus(statusFor(results.views))} | ${assertStatus(statusFor(results.related_lists))} | ${assertStatus(statusFor(results.blueprints))} | ${assertStatus(statusFor(results.custom_buttons))} | ${assertStatus(statusFor(results.validation_rules))} | Not Inspected | ${dataStatus} | ${testStatus} | ${reconcileStatus} |`);
  }
  writeDoc('ZOHO_CRM_COVERAGE_MATRIX.md', coverage);

  const dictionary = ['# Zoho CRM Data Dictionary', '', `Generated: ${stamp}`, ''];
  for (const { module, results } of moduleDiscovery) {
    dictionary.push(`## ${md(moduleLabel(module))} (${md(module.api_name)})`, '', '| Label | API Name | Type | Required | Read Only | Unique | Length | Lookup/Subform Target | Picklist Values |', '| --- | --- | --- | --- | --- | --- | ---: | --- | --- |');
    for (const field of fieldRows(results.fields)) {
      dictionary.push(`| ${md(field.field_label || field.display_label)} | ${md(field.api_name)} | ${md(field.data_type)} | ${field.system_mandatory || field.required ? 'Yes' : 'No'} | ${field.read_only ? 'Yes' : 'No'} | ${field.unique?.casesensitive !== undefined ? 'Yes' : 'No'} | ${md(field.length || '')} | ${md(relatedTarget(field))} | ${md(picklistText(field))} |`);
    }
    if (!fieldRows(results.fields).length) dictionary.push('| — | — | — | — | — | — | — | — | — |');
    dictionary.push('');
  }
  writeDoc('ZOHO_DATA_DICTIONARY.md', dictionary);

  const relationships = ['# Zoho CRM Relationship Map', '', `Generated: ${stamp}`, '', '| Source Module | Field | Type | Target Module | Required | Coverage |', '| --- | --- | --- | --- | --- | --- |'];
  for (const { module, results } of moduleDiscovery) {
    for (const field of fieldRows(results.fields).filter(field => relatedTarget(field) || ['lookup', 'ownerlookup', 'userlookup', 'multiselectlookup', 'subform'].includes(field.data_type))) {
      relationships.push(`| ${md(module.api_name)} | ${md(field.api_name)} | ${md(field.data_type)} | ${md(relatedTarget(field) || 'Users/Multiple')} | ${field.system_mandatory || field.required ? 'Yes' : 'No'} | Specified |`);
    }
  }
  writeDoc('ZOHO_RELATIONSHIP_MAP.md', relationships);

  const blueprintConfig = { generated_at: stamp, source_mode: 'read-only', blueprints: [] };
  const blueprintPhaseSummaryById = new Map();
  for (const listed of listedBlueprints) {
    const sourceBlueprint = listed.blueprint;
    const moduleEntry = moduleDiscovery.find(entry => entry.module.api_name === listed.module);
    const uiBlueprint = arr(blueprintUi.blueprints).find(item => String(item.id) === String(sourceBlueprint.id)) || { transitions: [], criteria: [] };
    const structure = blueprintStructureById.get(String(sourceBlueprint.id));
    const stateField = structure?.field?.api_name || sourceBlueprint?.field?.api_name || '';
    const field = fieldRows(moduleEntry?.results?.fields).find(item => item.api_name === stateField);
    const valueById = new Map(arr(field?.pick_list_values).map(value => [String(value.id), value.display_value || value.actual_value]));
    const actualById = new Map(arr(field?.pick_list_values).map(value => [String(value.id), value.actual_value || value.display_value]));
    const sourceCriteria = sanitizeCriteria(structure?.criteria);
    const exactEntryCriteria = flattenCompatibleEntryCriteria(sourceCriteria);
    const fallbackEntryCriteria = parseUiEntryCriteria(uiBlueprint.criteria, fieldRows(moduleEntry?.results?.fields));
    const entryCriteria = sourceCriteria ? exactEntryCriteria : fallbackEntryCriteria;

    let states;
    let connections;
    let configTransitions;
    if (structure) {
      states = arr(structure.states).map(sanitizeState).filter(Boolean);
      connections = arr(structure.connections).map(sanitizeConnection).filter(Boolean);
      const firstConnectionByTransition = new Map();
      for (const connection of connections) {
        const transitionId = String(connection.transition.id);
        if (!firstConnectionByTransition.has(transitionId)) firstConnectionByTransition.set(transitionId, connection);
      }
      configTransitions = arr(structure.transitions).map(sanitizeTransition).filter(Boolean).map(transition => {
        const connection = firstConnectionByTransition.get(String(transition.id));
        return {
          ...transition,
          from: stateEndpoint(connection?.from_state, actualById),
          to: stateEndpoint(connection?.to_state, actualById),
          criteria: null,
          owners: [],
          during_inputs: [],
          actions: [],
        };
      });
    } else {
      const fallbackStateById = new Map();
      connections = arr(uiBlueprint.transitions).map(uiTransition => {
        const [fromId, toId] = arr(uiTransition.edge);
        const fromState = { id: fromId === undefined ? null : String(fromId), name: valueById.get(String(fromId)) || (fromId ? `State ${fromId}` : 'Any/Unknown') };
        const toState = { id: toId === undefined ? null : String(toId), name: valueById.get(String(toId)) || (toId ? `State ${toId}` : 'Unknown') };
        if (fromState.id) fallbackStateById.set(fromState.id, fromState);
        if (toState.id) fallbackStateById.set(toState.id, toState);
        const detail = transitionById.get(String(uiTransition.transition_id)) || {};
        const name = detail.name || String(uiTransition.name || '').replace(/C$/, '');
        return {
          id: null,
          from_state: fromState,
          to_state: toState,
          transition: {
            id: String(uiTransition.transition_id),
            name,
            api_name: detail.api_name || null,
            common: detail.global === true || /C$/.test(String(uiTransition.name || '')),
          },
        };
      });
      states = [...fallbackStateById.values()];
      configTransitions = arr(uiBlueprint.transitions).map(uiTransition => {
        const detail = transitionById.get(String(uiTransition.transition_id)) || {};
        const [fromId, toId] = arr(uiTransition.edge);
        const name = detail.name || String(uiTransition.name || '').replace(/C$/, '');
        return {
          id: String(uiTransition.transition_id),
          name,
          api_name: detail.api_name || null,
          trigger_type: detail.trigger_type || null,
          transition_type: detail.transition_type || null,
          global: detail.global === true || /C$/.test(String(uiTransition.name || '')),
          include_states: [],
          from: { id: fromId || null, display_value: valueById.get(String(fromId)) || (fromId ? `State ${fromId}` : 'Any/Unknown'), actual_value: actualById.get(String(fromId)) || valueById.get(String(fromId)) || (fromId ? `State ${fromId}` : 'Any/Unknown') },
          to: { id: toId || null, display_value: valueById.get(String(toId)) || (toId ? `State ${toId}` : 'Unknown'), actual_value: actualById.get(String(toId)) || valueById.get(String(toId)) || (toId ? `State ${toId}` : 'Unknown') },
          criteria: sanitizeCriteria(detail.criteria),
          owners: arr(detail.owners).map(owner => sanitizeReference(owner, ['type'])).filter(Boolean),
          during_inputs: [],
          actions: [],
        };
      });
    }

    const request = blueprintStructureRequests.find(item => String(item.listed.id) === String(sourceBlueprint.id));
    const localPhaseDefinitions = blueprintLocalPhases.blueprints?.[String(sourceBlueprint.id)]?.transitions || {};
    const configuredTransitionIds = new Set(configTransitions.map(transition => String(transition.id)));
    const automaticTransitionIds = new Set(configTransitions
      .filter(transition => String(transition.trigger_type || '').toLowerCase() === 'automatic')
      .map(transition => String(transition.id)));
    const specifiedTransitionIds = Object.entries(localPhaseDefinitions)
      .filter(([id, definition]) => configuredTransitionIds.has(String(id))
        && definition
        && typeof definition === 'object'
        && Object.hasOwn(definition, 'before')
        && Array.isArray(definition.during_inputs)
        && Array.isArray(definition.after_actions))
      .map(([id]) => String(id));
    const implementedTransitionIds = Object.entries(localPhaseDefinitions)
      .filter(([id, definition]) => configuredTransitionIds.has(String(id))
        && !automaticTransitionIds.has(String(id))
        && definition?.local_execution === 'Implemented')
      .map(([id]) => String(id));
    blueprintPhaseSummaryById.set(String(sourceBlueprint.id), {
      specified_transition_ids: specifiedTransitionIds,
      specified_count: specifiedTransitionIds.length,
      executable_count: implementedTransitionIds.length,
      blocked_count: configTransitions.length - implementedTransitionIds.length,
      total_count: configTransitions.length,
      automatic_count: automaticTransitionIds.size,
    });
    blueprintConfig.blueprints.push({
      id: String(sourceBlueprint.id),
      name: structure?.name || sourceBlueprint.name || uiBlueprint.name,
      api_name: structure?.api_name || sourceBlueprint.api_name || null,
      module: listed.module,
      source_module: sanitizeReference(structure?.module, ['id', 'api_name']),
      ui_module: uiBlueprint.uiModule || null,
      status: sourceBlueprint?.status || 'Unknown',
      layout: sanitizeReference(structure?.layout || sourceBlueprint?.layout, ['id', 'name', 'api_name']),
      field: sanitizeReference(structure?.field || sourceBlueprint?.field, ['id', 'api_name', 'field_label']),
      state_field: stateField,
      continuous: typeof structure?.continuous === 'boolean' ? structure.continuous : null,
      graph_source: structure ? 'settings-blueprint-detail' : 'authenticated-ui-fallback',
      graph_http_status: request?.result?.status || null,
      entry_criteria_evidence: arr(uiBlueprint.criteria),
      entry_criteria_tree: sourceCriteria,
      entry_criteria: entryCriteria,
      entry_criteria_logic_supported: !sourceCriteria || exactEntryCriteria.length > 0,
      states,
      transitions: configTransitions,
      connections,
      local_execution: {
        implemented_transition_ids: implementedTransitionIds,
        implemented_count: implementedTransitionIds.length,
        total_count: configTransitions.length,
      },
    });
  }

  const blueprintConfigById = new Map(blueprintConfig.blueprints.map(item => [String(item.id), item]));
  const blueprintPhaseTotals = [...blueprintPhaseSummaryById.values()].reduce((summary, item) => ({
    specified: summary.specified + item.specified_count,
    executable: summary.executable + item.executable_count,
    blocked: summary.blocked + item.blocked_count,
    total: summary.total + item.total_count,
  }), { specified: 0, executable: 0, blocked: 0, total: 0 });
  const blueprintsWithPhaseDetail = [...blueprintPhaseSummaryById.values()].filter(item => item.specified_count > 0).length;
  const phaseSummaryForModule = moduleName => {
    const blueprint = blueprintConfig.blueprints.find(item => item.module === moduleName);
    return blueprint ? blueprintPhaseSummaryById.get(String(blueprint.id)) : null;
  };
  const contactsPhaseSummary = phaseSummaryForModule('Contacts');
  const dealsPhaseSummary = phaseSummaryForModule('Deals');
  const tasksPhaseSummary = phaseSummaryForModule('Tasks');
  const modulePhaseCoverage = [
    ['Contacts', contactsPhaseSummary],
    ['Deals', dealsPhaseSummary],
    ['Tasks', tasksPhaseSummary],
  ].map(([label, summary]) => `${label} ${summary?.specified_count || 0}/${summary?.total_count || 0}`).join('; ');
  const blueprints = ['# Zoho CRM Blueprint Matrix', '', `Generated: ${stamp}`, '', 'Source Blueprint inspection is read-only. The authoritative structural endpoint is requested for every listed Blueprint. Raw successful responses remain private; this document and `config/blueprints.json` contain only sanitized graph fields.', '', 'Phase-detail and policy-eligibility counts use unique Blueprint transitions, not graph connections. A captured automatic transition is included in phase-detail coverage but is never treated as a manually executable transition. “Source Coverage” reports `Phase specified` when complete Before/During/After evidence exists; otherwise it reports structural graph coverage only. Atomic runtime readiness is independently gated by the exact live RPC verifier and is not asserted by discovery.', '', `Authenticated read-only phase evidence covers ${blueprintPhaseTotals.specified}/${blueprintPhaseTotals.total} transitions across ${blueprintsWithPhaseDetail} Blueprints. Module coverage: ${modulePhaseCoverage}. Policy eligibility is ${blueprintPhaseTotals.executable}/${blueprintPhaseTotals.total} eligible and ${blueprintPhaseTotals.blocked}/${blueprintPhaseTotals.total} blocked; Tasks is ${tasksPhaseSummary?.specified_count || 0}/${tasksPhaseSummary?.total_count || 0} specified and ${tasksPhaseSummary?.blocked_count || 0}/${tasksPhaseSummary?.total_count || 0} policy blocked.`, '', '| Module | Blueprint | Layout | State Field | Status | Structural Graph | Phase Details / Policy Eligibility |', '| --- | --- | --- | --- | --- | --- | --- |'];
  for (const { module, results } of moduleDiscovery) {
    const items = extract(results.blueprints, 'blueprints');
    if (!items.length && results.blueprints.ok) {
      blueprints.push(`| ${md(module.api_name)} | None returned | — | — | Inspected | Not Applicable | Not Applicable |`);
      continue;
    }
    for (const item of items) {
      const configured = blueprintConfigById.get(String(item.id));
      const graph = configured?.graph_source === 'settings-blueprint-detail'
        ? `${configured.states.length} states; ${configured.transitions.length} transitions; ${configured.connections.length} connections`
        : `HTTP ${configured?.graph_http_status || 'unknown'}; authenticated UI fallback`;
      const phaseSummary = blueprintPhaseSummaryById.get(String(item.id));
      const localExecution = phaseSummary
        ? `${phaseSummary.specified_count}/${phaseSummary.total_count} phase details specified; ${phaseSummary.executable_count}/${phaseSummary.total_count} policy eligible; ${phaseSummary.blocked_count}/${phaseSummary.total_count} policy blocked${phaseSummary.automatic_count ? `; ${phaseSummary.automatic_count} automatic` : ''}`
        : 'Not Inspected';
      blueprints.push(`| ${md(module.api_name)} | ${md(item.name)} | ${md(item.layout?.name || item.layout?.id)} | ${md(item.field?.api_name || item.field?.name)} | ${md(item.status || 'Unknown')} | ${md(graph)} | ${md(localExecution)} |`);
    }
    if (!results.blueprints.ok) blueprints.push(`| ${md(module.api_name)} | — | — | — | ${assertStatus(statusFor(results.blueprints))} | Not Accessible | Blocked |`);
  }
  blueprints.push('', '## Transition Matrices', '');
  for (const blueprint of blueprintConfig.blueprints) {
    const phaseSummary = blueprintPhaseSummaryById.get(String(blueprint.id));
    const localPhaseDefinitions = blueprintLocalPhases.blueprints?.[String(blueprint.id)]?.transitions || {};
    const phaseSummaryText = phaseSummary
      ? ` Phase details: ${phaseSummary.specified_count}/${phaseSummary.total_count} specified. Policy eligibility: ${phaseSummary.executable_count}/${phaseSummary.total_count} eligible; ${phaseSummary.blocked_count}/${phaseSummary.total_count} blocked. Atomic runtime readiness is not asserted by discovery.${phaseSummary.automatic_count ? ` Automatic transitions: ${phaseSummary.automatic_count}.` : ''}`
      : '';
    blueprints.push(`### ${md(blueprint.name)} — ${md(blueprint.module)}`, '', `State field: \`${md(blueprint.state_field)}\`. Source status: ${md(blueprint.status)}. Graph source: ${md(blueprint.graph_source)} (HTTP ${md(blueprint.graph_http_status || 'unknown')}).${phaseSummaryText}`);
    const capturedPhaseRows = Object.entries(localPhaseDefinitions)
      .filter(([transitionId, definition]) => blueprint.transitions.some(item => String(item.id) === String(transitionId))
        && definition
        && typeof definition === 'object'
        && Object.hasOwn(definition, 'before')
        && Array.isArray(definition.during_inputs)
        && Array.isArray(definition.after_actions));
    if (capturedPhaseRows.length) {
      blueprints.push('', 'Captured phase evidence:', '');
      for (const [transitionId, definition] of capturedPhaseRows) {
        const transition = blueprint.transitions.find(item => String(item.id) === String(transitionId));
        const owners = arr(definition.before?.owners).map(owner => typeof owner === 'string' ? owner : owner?.name).filter(Boolean);
        const during = arr(definition.during_inputs).map(input => {
          const label = input.label || input.api_name || input.kind || 'input';
          return `${input.kind || 'input'} ${label} (${input.required ? 'required' : 'optional'})`;
        });
        const after = arr(definition.after_actions).map(action => action.name || action.type).filter(Boolean);
        const blockReason = String(definition.block_reason || '').replace(/[.!?]+$/, '');
        const reason = blockReason ? `; reason: ${blockReason}` : '';
        blueprints.push(`- **${md(transition?.name || transitionId)}** — trigger: ${md(definition.trigger_type || transition?.trigger_type || 'Unknown')}; before owners: ${md(owners.join(', ') || 'none captured')}; during: ${md(during.join(', ') || 'none')}; after actions: ${md(after.join(', ') || 'none')}; local: ${md(definition.local_execution || 'Blocked')}${md(reason)}.`);
      }
    }
    blueprints.push('', '| Current State | Transition | API Name | Trigger | Global | Included States | Next State | Source Coverage | Local Status |', '| --- | --- | --- | --- | --- | ---: | --- | --- | --- |');
    for (const connection of blueprint.connections) {
      const transition = blueprint.transitions.find(item => String(item.id) === String(connection.transition.id)) || connection.transition;
      const localPhaseDefinition = localPhaseDefinitions[String(transition.id)];
      const localStatus = blueprint.local_execution.implemented_transition_ids.includes(String(transition.id)) ? 'Implemented' : 'Blocked';
      const sourceCoverage = localPhaseDefinition ? 'Phase specified' : (blueprint.graph_source === 'settings-blueprint-detail' ? 'Specified' : 'Inspected');
      blueprints.push(`| ${md(connection.from_state?.name)} | ${md(transition.name)} | ${md(transition.api_name || '—')} | ${md(localPhaseDefinition?.trigger_type || transition.trigger_type || 'Unknown')} | ${transition.global ? 'Yes' : 'No'} | ${arr(transition.include_states).length} | ${md(connection.to_state?.name)} | ${sourceCoverage} | ${localStatus} |`);
    }
    if (!blueprint.connections.length) blueprints.push('| — | — | — | — | — | — | — | Not Inspected | Blocked |');
    blueprints.push('');
  }
  writeDoc('ZOHO_BLUEPRINT_MATRIX.md', blueprints);
  fs.mkdirSync(path.join(ROOT, 'config'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'config', 'blueprints.json'), `${JSON.stringify(blueprintConfig, null, 2)}\n`, 'utf8');

  const customButtonConfig = { generated_at: stamp, source_mode: 'read-only', buttons: [] };
  for (const { module, results } of moduleDiscovery) {
    for (const button of extract(results.custom_buttons, 'custom_buttons')) {
      customButtonConfig.buttons.push({
        id: String(button.id),
        module: module.api_name,
        name: button.name,
        api_name: button.api_name || null,
        description: button.description || null,
        position: button.position,
        action: button.action,
        source: button.source,
        sequence_number: button.sequence_number,
        profile_ids: arr(button.profiles).map(profile => String(profile.id)),
        layout_ids: arr(button.layouts).map(layout => String(layout.id)),
        user_types: arr(button.user_types),
        action_reference: button.details?.custom_function ? { type: 'custom_function', id: button.details.custom_function.id, name: button.details.custom_function.name } : (button.details?.widget ? { type: 'widget', id: button.details.widget.id, name: button.details.widget.name } : null),
        local_status: 'Blocked',
        block_reason: 'Source action is inventoried but local execution is disabled until its behavior, permissions, inputs, side effects, and failure handling are fully reproduced and tested.',
      });
    }
  }
  fs.writeFileSync(path.join(ROOT, 'config', 'custom-buttons.json'), `${JSON.stringify(customButtonConfig, null, 2)}\n`, 'utf8');

  const workflowListItems = extract(globalResults.workflow_rules, 'workflow_rules');
  const workflowDetailItems = arr(globalResults.workflow_rule_details).flatMap(result => extract(result, 'workflow_rules'));
  const workflowDetailById = new Map(workflowDetailItems.map(item => [String(item.id), item]));
  const workflowItems = workflowListItems.map(item => workflowDetailById.get(String(item.id)) || item);
  const webhookItems = extract(globalResults.webhooks, 'webhooks');
  const functionItems = extract(globalResults.functions, 'functions');
  const mergeActionDetails = (resultKey, responseKey) => {
    const listed = extract(globalResults[resultKey], responseKey);
    const detailed = arr(globalResults[`${resultKey}_details`]).flatMap(result => extract(result, responseKey));
    const detailById = new Map(detailed.map(item => [String(item.id), item]));
    const listedIds = new Set(listed.map(item => String(item.id)));
    const referencedOnly = detailed.filter(item => !listedIds.has(String(item.id)));
    return { items: [...listed.map(item => detailById.get(String(item.id)) || item), ...referencedOnly], detailById };
  };
  const fieldUpdateCatalog = mergeActionDetails('field_updates', 'field_updates');
  const emailNotificationCatalog = mergeActionDetails('email_notifications', 'email_notifications');
  const automationTaskCatalog = mergeActionDetails('automation_tasks', 'tasks');
  const fieldUpdateItems = fieldUpdateCatalog.items;
  const emailNotificationItems = emailNotificationCatalog.items;
  const automationTaskItems = automationTaskCatalog.items;
  const actionIdsByType = {
    field_updates: new Set(fieldUpdateItems.map(item => String(item.id))),
    tasks: new Set(automationTaskItems.map(item => String(item.id))),
    email_notifications: new Set(emailNotificationItems.map(item => String(item.id))),
  };
  const catalogActionReferences = referencedWorkflowActions.filter(action => actionIdsByType[action.type]);
  const unresolvedCatalogActionReferences = catalogActionReferences.filter(action => !actionIdsByType[action.type].has(String(action.id)));
  const automation = [
    '# Zoho CRM Automation Inventory', '', `Generated: ${stamp}`, '',
    'External communication actions remain disabled in the localhost target until a sandbox destination and separate approval are provided.', '',
    `Workflow action-definition references reconciled: ${catalogActionReferences.length - unresolvedCatalogActionReferences.length}/${catalogActionReferences.length}. Missing definitions remain blocked and are never inferred.`, '',
    `Exact custom-function bodies captured privately and hash-verified: ${capturedFunctionCodeIds.size}/${functionItems.length}. Source code and embedded credentials are never published in this inventory.`, '',
    '| Type | Module | Name | Active | Trigger/Source | Source Coverage | Local Coverage |', '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const item of workflowItems) {
    const actions = arr(item.conditions).flatMap(condition => [
      ...arr(condition.instant_actions?.actions),
      ...arr(condition.scheduled_actions).flatMap(scheduled => arr(scheduled.actions)),
    ]);
    const actionTypes = [...new Set(actions.map(action => action.type).filter(Boolean))];
    const trigger = [item.execute_when?.type, actionTypes.length ? `actions: ${actionTypes.join(', ')}` : null].filter(Boolean).join('; ');
    automation.push(`| Workflow Rule | ${md(item.module?.api_name)} | ${md(item.name)} | ${item.status?.active === false ? 'No' : 'Yes'} | ${md(trigger || 'Unknown')} | ${workflowDetailById.has(String(item.id)) ? 'Specified' : 'Inspected'} | Blocked |`);
  }
  for (const item of fieldUpdateItems) automation.push(`| Field Update Action | ${md(item.module?.api_name)} | ${md(item.name)} | ${item.associated === false ? 'No' : 'Yes'} | ${md([item.field?.api_name, item.display_value ?? item.value].filter(value => value !== null && value !== undefined && value !== '').join(' = ') || item.type || 'Static field update')} | ${fieldUpdateCatalog.detailById.has(String(item.id)) ? 'Specified' : 'Inspected'} | Blocked |`);
  for (const item of automationTaskItems) automation.push(`| Task Action | ${md(item.module?.api_name)} | ${md(item.name)} | ${item.associated === false ? 'No' : 'Yes'} | ${arr(item.field_mappings).length} field mappings | ${automationTaskCatalog.detailById.has(String(item.id)) ? 'Specified' : 'Inspected'} | Blocked |`);
  for (const item of emailNotificationItems) automation.push(`| Email Notification Action | ${md(item.module?.api_name)} | ${md(item.name)} | ${item.associated === false ? 'No' : 'Yes'} | ${md(item.template?.name || 'Template configured')} | ${emailNotificationCatalog.detailById.has(String(item.id)) ? 'Specified' : 'Inspected'} | Blocked |`);
  for (const item of webhookItems) automation.push(`| Webhook | ${md(item.module?.api_name)} | ${md(item.name)} | ${item.active === false || item.status?.active === false ? 'No' : 'Yes'} | ${md([item.method || item.http_method, item.feature_type].filter(Boolean).join('; ') || 'External request')} | Inspected | Blocked |`);
  for (const item of functionItems) automation.push(`| Function | ${md(item.module?.api_name)} | ${md(item.name || item.display_name)} | ${item.active === false || item.state === 'inactive' ? 'No' : 'Yes'} | ${md([item.source, item.api_name].filter(Boolean).join('; '))} | ${capturedFunctionCodeIds.has(String(item.id)) ? 'Specified' : 'Inspected'} | Blocked |`);
  for (const { module, results } of moduleDiscovery) {
    const bpItems = extract(results.blueprints, 'blueprints');
    const vrItems = extract(results.validation_rules, 'validation_rules');
    const arItems = extract(results.assignment_rules, 'assignment_rules');
    const apItems = extract(results.approval_rules, 'approval_rules');
    for (const item of bpItems) automation.push(`| Blueprint | ${md(module.api_name)} | ${md(item.name)} | ${item.active === false ? 'No' : 'Yes'} | State transition | Inspected | Blocked |`);
    for (const item of vrItems) automation.push(`| Validation Rule | ${md(module.api_name)} | ${md(item.name)} | ${item.active === false ? 'No' : 'Yes'} | Record validation | Inspected | Not Inspected |`);
    for (const item of arItems) automation.push(`| Assignment Rule | ${md(module.api_name)} | ${md(item.name)} | ${item.active === false ? 'No' : 'Yes'} | Assignment | Inspected | Not Inspected |`);
    for (const item of apItems) automation.push(`| Approval Rule | ${md(module.api_name)} | ${md(item.name)} | ${item.active === false ? 'No' : 'Yes'} | Approval | Inspected | Not Inspected |`);
  }
  if (automation.length === 12) automation.push('| — | — | — | — | — | Not Accessible | Not Inspected |');
  writeDoc('ZOHO_AUTOMATION_INVENTORY.md', automation);

  const roles = extract(globalResults.roles, 'roles');
  const profiles = extract(globalResults.profiles, 'profiles');
  const permissions = [
    '# Zoho CRM Permission Matrix', '', `Generated: ${stamp}`, '',
    `Roles discovered: ${roles.length}. Profiles discovered: ${profiles.length}. Users are stored only in the private discovery snapshot and are not listed here.`, '',
    '| Security Layer | Source Count | Source Coverage | Local Enforcement | Verification |', '| --- | ---: | --- | --- | --- |',
    `| Roles | ${roles.length} | ${assertStatus(statusFor(globalResults.roles))} | Not Inspected | Not Inspected |`,
    `| Profiles | ${profiles.length} | ${assertStatus(statusFor(globalResults.profiles))} | Not Inspected | Not Inspected |`,
    `| Users | ${extract(globalResults.users, 'users').length} | ${assertStatus(statusFor(globalResults.users))} | Not Inspected | Not Inspected |`,
    `| Territories | ${extract(globalResults.territories, 'territories').length} | ${assertStatus(statusFor(globalResults.territories))} | Not Inspected | Not Inspected |`,
    '| Field-level permissions | Profile field exceptions listed below | Specified | Not Inspected | Not Inspected |',
    '| Record-level sharing | Pending Setup inspection | Not Inspected | Not Inspected | Not Inspected |',
  ];
  permissions.push('', '## Profile Module Permissions', '', '| Profile | Module | View | Create | Edit | Delete | Source Coverage | Local Enforcement |', '| --- | --- | --- | --- | --- | --- | --- | --- |');
  globalResults.profile_details.forEach((result, index) => {
    const profile = arr(result?.data?.profiles)[0] || profiles[index] || {};
    if (!result.ok) {
      permissions.push(`| ${md(profile.name || profile.display_label)} | — | — | — | — | — | ${assertStatus(statusFor(result))} | Not Inspected |`);
      return;
    }
    const byModule = new Map();
    for (const permission of arr(profile.permissions_details)) {
      const moduleName = permission.module;
      if (!moduleName) continue;
      if (!byModule.has(moduleName)) byModule.set(moduleName, {});
      const action = String(permission.display_label || '').toLowerCase();
      if (['view', 'create', 'edit', 'delete'].includes(action)) byModule.get(moduleName)[action] = permission.enabled === true;
    }
    for (const [moduleName, actions] of [...byModule.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])))) {
      permissions.push(`| ${md(profile.name || profile.display_label)} | ${md(moduleName)} | ${actions.view ? 'Yes' : 'No'} | ${actions.create ? 'Yes' : 'No'} | ${actions.edit ? 'Yes' : 'No'} | ${actions.delete ? 'Yes' : 'No'} | Specified | Not Inspected |`);
    }
  });
  permissions.push('', '## Field-Level Permission Exceptions', '', 'Fields omitted below are read/write for every profile returned by the source metadata.', '', '| Module | Field | Profile | Permission | Source Coverage | Local Enforcement |', '| --- | --- | --- | --- | --- | --- |');
  let fieldExceptionCount = 0;
  for (const { module, results } of moduleDiscovery) {
    for (const field of fieldRows(results.fields)) {
      for (const profile of arr(field.profiles).filter(profile => profile.permission_type && profile.permission_type !== 'read_write')) {
        permissions.push(`| ${md(module.api_name)} | ${md(field.api_name)} | ${md(profile.name)} | ${md(profile.permission_type)} | Specified | Not Inspected |`);
        fieldExceptionCount++;
      }
    }
  }
  if (!fieldExceptionCount) permissions.push('| — | — | — | — | Inspected | Not Applicable |');
  writeDoc('ZOHO_PERMISSION_MATRIX.md', permissions);

  const manifest = [
    '# Zoho CRM Migration Manifest', '', `Generated: ${stamp}`, '',
    'Raw exports and attachments must remain outside version control. Source Count is the aggregate count endpoint when available; active-ID audits are stated separately and take precedence for their audited scope.', '',
    usableActiveEvidence(notesEvidence) && usableActiveEvidence(tasksEvidence) && usableChildEvidence
      ? `Audited active IDs reconcile exactly for Notes at ${formatCount(notesEvidence.source_active_ids)}/${formatCount(notesEvidence.local_active_ids)} and Tasks at ${formatCount(tasksEvidence.source_active_ids)}/${formatCount(tasksEvidence.local_active_ids)}. Four generated child datasets have ${formatCount(childEvidenceSummary.child_source_active_ids)}/${formatCount(childEvidenceSummary.child_local_active_ids)} active-ID parity and ${formatCount(childEvidenceSummary.child_count_only_unavailable)} additional count-only rows without retrievable IDs or payloads.`
      : 'Active-ID reconciliation evidence is incomplete and remains blocked.', '',
    `The local store contains ${formatCount(localPhysicalRecordTotal)} physical rows: ${formatCount(localSourceDerivedRecordTotal)} source-derived rows and ${localOnlySummary}. Aggregate source-count comparisons use source-derived rows only.`, '',
    localDeltaAt ? `These local totals were read after the latest recorded local delta at ${localDeltaAt}.` : 'The latest local-delta timestamp is unavailable.', '',
    `Attachments are metadata-only and must never be inferred from module-row presence: ${formatCount(attachmentEvidence.source_attachment_ids)} source IDs, ${formatCount(attachmentEvidence.exact_addressable_triples)} exact addressable triples, ${formatCount(attachmentEvidence.quarantined_rows)} quarantined rows, ${formatCount(attachmentEvidence.locally_linked_ids)} locally linked IDs, ${formatCount(attachmentEvidence.absent_from_local_records)} source IDs absent locally, and ${formatCount(attachmentEvidence.migrated_attachment_bodies)} bodies migrated. The tested on-demand service remains unmounted. Reproduce count-only evidence without loading credentials or accessing the source with <code>node scripts/discover-zoho.js --audit-attachment-manifest-counts</code>. See [Attachment Replication](ATTACHMENT_REPLICATION.md), [On-demand Access](docs/on-demand-attachment-access.md), [Source Inventory](ZOHO_SOURCE_INVENTORY.md), and [Reconciliation Report](ZOHO_RECONCILIATION_REPORT.md).`, '',
    '| Module | Source Count Endpoint | Export Method | Export Timestamp | Field Count | Related Datasets / Active-ID Evidence | Attachment Count | Export Status | Import Status | Reconciliation |',
    '| --- | ---: | --- | --- | ---: | --- | ---: | --- | --- | --- |',
  ];
  for (const { module, results, source_count } of moduleDiscovery) {
    if (module.api_name === 'Attachments') {
      manifest.push(`| Attachments | ${formatCount(attachmentEvidence.source_attachment_ids)} metadata IDs | Read-only metadata manifest | ${stamp} | ${fieldRows(results.fields).length} | ${formatCount(attachmentEvidence.exact_addressable_triples)} exact addressable triples; ${formatCount(attachmentEvidence.quarantined_rows)} quarantined | ${formatCount(attachmentEvidence.source_attachment_ids)} metadata rows | Inspected | ${formatCount(attachmentEvidence.migrated_attachment_bodies)} bodies migrated; on-demand access unmounted | Metadata reconciled only; body parity blocked |`);
      continue;
    }
    const localCount = sourceDerivedCounts[module.api_name];
    const evidence = resolveModuleEvidence(reconciliationEvidence, module.api_name, source_count.ok ? source_count.count : null);
    const aggregateReconciled = source_count.ok && Number.isFinite(localCount) && source_count.count === localCount;
    let relatedEvidence = 'See relationship map';
    let importStatus = Number.isFinite(localCount) ? 'Data Migrated' : 'Not Inspected';
    let reconciliationStatus = aggregateReconciled ? 'Reconciled' : 'Not Inspected';
    if (usableActiveEvidence(evidence)) {
      relatedEvidence = `Active IDs ${formatCount(evidence.source_active_ids)}/${formatCount(evidence.local_active_ids)}`;
      if (evidence.exact_payloads_verified > 0) relatedEvidence += `; ${formatCount(evidence.exact_payloads_verified)} imported payload(s) verified exactly`;
      if (evidence.count_scope_kind === 'count-only' && evidence.count_scope_delta > 0) {
        relatedEvidence += `; ${formatCount(evidence.count_scope_delta)} count-only rows unavailable`;
        reconciliationStatus = 'Active-ID parity; count-only blocked';
        importStatus = 'Data Migrated';
      } else if (evidence.count_scope_kind === 'aggregate-scope' && evidence.count_scope_delta > 0) {
        relatedEvidence += `; ${formatCount(evidence.count_scope_delta)} aggregate-scope delta unresolved`;
        reconciliationStatus = 'Active-ID parity; aggregate scope unresolved';
        importStatus = 'Reconciled active IDs';
      } else {
        importStatus = 'Reconciled';
        reconciliationStatus = 'Reconciled';
      }
    }
    manifest.push(`| ${md(module.api_name)} | ${source_count.ok ? md(source_count.count) : 'Pending'} | Official Zoho API | ${stamp} | ${fieldRows(results.fields).length} | ${md(relatedEvidence)} | Pending | Inspected | ${md(importStatus)} | ${md(reconciliationStatus)} |`);
  }
  writeDoc('ZOHO_MIGRATION_MANIFEST.md', manifest);

  const reconciliation = [
    '# Zoho CRM Reconciliation Report', '', `Generated: ${stamp}`, '',
    `The official read-only count endpoint returned usable counts for ${countedDatasets} of ${accessibleModules.length} API-supported datasets; ${reconciledDatasets} of those currently match the source-derived local row counts exactly.`, '',
    usableActiveEvidence(notesEvidence) && usableActiveEvidence(tasksEvidence) && usableChildEvidence
      ? `The official count endpoint is not always the same scope as the active-record enumeration API. Separate exhaustive active-ID audits prove exact parity for Notes at ${formatCount(notesEvidence.source_active_ids)}/${formatCount(notesEvidence.local_active_ids)} and Tasks at ${formatCount(tasksEvidence.source_active_ids)}/${formatCount(tasksEvidence.local_active_ids)}. Four generated child datasets also match all ${formatCount(childEvidenceSummary.child_source_active_ids)} enumerable active IDs, while their aggregate counts include ${formatCount(childEvidenceSummary.child_count_only_unavailable)} additional rows with no retrievable IDs or payloads.`
      : 'Active-ID reconciliation evidence is incomplete; aggregate count equality is not treated as record-level parity.', '',
    `The local database contains ${formatCount(localPhysicalRecordTotal)} physical rows across ${Object.keys(snapshotCounts).length} datasets: ${formatCount(localSourceDerivedRecordTotal)} source-derived rows plus ${localOnlySummary}.${localDeltaAt ? ` These local totals were read after the latest recorded local delta at ${localDeltaAt}.` : ''} Zoho is live, so counts can change after this timestamp. A non-match is never silently deleted or fabricated.`, '',
    `Attachment reconciliation covers metadata, not bodies: ${formatCount(attachmentEvidence.source_attachment_ids)} source IDs, ${formatCount(attachmentEvidence.exact_addressable_triples)} exact addressable triples, ${formatCount(attachmentEvidence.quarantined_rows)} quarantined rows, ${formatCount(attachmentEvidence.locally_linked_ids)} locally linked IDs, ${formatCount(attachmentEvidence.absent_from_local_records)} source IDs absent locally, and ${formatCount(attachmentEvidence.migrated_attachment_bodies)} bodies migrated. The tested on-demand service remains unmounted. Reproduce count-only evidence without loading credentials or accessing the source with <code>node scripts/discover-zoho.js --audit-attachment-manifest-counts</code>. See [Attachment Replication](ATTACHMENT_REPLICATION.md), [On-demand Access](docs/on-demand-attachment-access.md), [Source Inventory](ZOHO_SOURCE_INVENTORY.md), and [Migration Manifest](ZOHO_MIGRATION_MANIFEST.md).`, '',
    '| Dataset | Zoho Count Endpoint | Exported | Local Source-Derived / Active IDs | Valid | Failed | Active gap / count scope | Local-only / duplicate | Reconciliation |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  ];
  for (const { module, source_count } of moduleDiscovery) {
    if (module.api_name === 'Attachments') {
      reconciliation.push(`| Attachments | ${formatCount(attachmentEvidence.source_attachment_ids)} metadata IDs | ${formatCount(attachmentEvidence.source_attachment_ids)} metadata rows | ${formatCount(attachmentEvidence.locally_linked_ids)} locally linked IDs | ${formatCount(attachmentEvidence.migrated_attachment_bodies)} migrated bodies | ${formatCount(attachmentEvidence.absent_from_local_records)} source IDs absent locally | ${formatCount(attachmentEvidence.exact_addressable_triples)} addressable / ${formatCount(attachmentEvidence.quarantined_rows)} quarantined | ${formatCount(attachmentEvidence.migrated_attachment_bodies)} verified migrated bodies | Metadata reconciled only; body parity blocked; on-demand access unmounted |`);
      continue;
    }
    const localCount = sourceDerivedCounts[module.api_name];
    const localOnlyCount = localOnlyCounts[module.api_name];
    const localQaCount = localQaCounts[module.api_name] || 0;
    const evidence = resolveModuleEvidence(reconciliationEvidence, module.api_name, source_count.ok ? source_count.count : null);
    const aggregateReconciled = source_count.ok && Number.isFinite(localCount) && source_count.count === localCount;
    const missingCount = source_count.ok && Number.isFinite(localCount) ? Math.max(0, source_count.count - localCount) : null;
    const duplicateCount = source_count.ok && Number.isFinite(localCount) ? Math.max(0, localCount - source_count.count) : null;
    let displayedLocalCount = Number.isFinite(localCount) ? localCount : null;
    let gapText = missingCount === null ? 'Pending' : String(missingCount);
    let localOnlyText = Number.isFinite(localOnlyCount) && localOnlyCount > 0
      ? `${formatCount(localOnlyCount)} local-only${localQaCount === localOnlyCount ? ' QA row' : ''}`
      : (duplicateCount === null ? 'Pending' : String(duplicateCount));
    let reconciliationStatus = aggregateReconciled
      ? (localOnlyCount > 0 ? 'Reconciled source-derived rows' : 'Reconciled')
      : 'Not Inspected';
    if (usableActiveEvidence(evidence)) {
      displayedLocalCount = evidence.local_active_ids;
      localOnlyText = String(evidence.local_only_active_ids);
      if (evidence.count_scope_kind === 'count-only' && evidence.count_scope_delta > 0) {
        gapText = `0 active / ${formatCount(evidence.count_scope_delta)} count-only`;
        reconciliationStatus = 'Active-ID parity; count-only blocked';
      } else if (evidence.count_scope_kind === 'aggregate-scope' && evidence.count_scope_delta > 0) {
        gapText = `0 active / ${formatCount(evidence.count_scope_delta)} aggregate-scope delta`;
        reconciliationStatus = 'Active-ID parity; aggregate scope unresolved';
      } else {
        gapText = '0';
        reconciliationStatus = 'Reconciled';
      }
    }
    reconciliation.push(`| ${md(module.api_name)} | ${source_count.ok ? md(source_count.count) : 'Pending'} | Pending | ${displayedLocalCount === null ? 'Pending' : md(displayedLocalCount)} | Pending | Pending | ${md(gapText)} | ${md(localOnlyText)} | ${md(reconciliationStatus)} |`);
  }
  writeDoc('ZOHO_RECONCILIATION_REPORT.md', reconciliation);

  const notesAggregateDelta = notesEvidence?.count_scope_delta || 0;
  const blockers = [
    '# Zoho CRM Limitations and Blockers', '', `Generated: ${stamp}`, '',
    localDeltaAt ? `Local totals in this document were read after the latest recorded local delta at ${localDeltaAt}.` : 'The latest local-delta timestamp is unavailable.', '',
    '| Feature | Source Location | Reason | Work Completed | Impact | Safest Resolution | Other Work Can Continue | Status |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    '| Live-source writes | Zoho CRM API | Explicitly prohibited by the replication boundary | GET-only enforcement added to localhost server | Local edits do not update Zoho | Keep source permanently read-only and implement local equivalents | Yes | Implemented |',
    `| Local access gate | Local server | ${process.env.ACCESS_CODE ? 'A shared access code is configured' : 'ACCESS_CODE is not configured in the current environment'} | Optional shared-code gate exists | ${process.env.ACCESS_CODE ? 'Basic local access is restricted, but this is not Zoho user parity' : 'Anyone who can reach localhost can open the replica'} | Configure ACCESS_CODE immediately; do not treat it as profile-level RBAC | Yes | ${process.env.ACCESS_CODE ? 'Implemented' : 'Blocked'} |`,
    `| Authentication and authorization parity | Setup → Security Control | ${permissionSourceCoverage.roles || 0} roles, ${permissionSourceCoverage.profiles || 0} profiles, ${permissionSourceCoverage.users || 0} aggregate source users, ${permissionSourceCoverage.profile_module_assignments || 0} profile-module assignments, and ${permissionSourceCoverage.field_exception_assignments || 0} field-exception assignments were captured, but no verified local principal or identity-provider mapping exists | Sanitized full permission catalog and fail-closed evaluator generated; every caller-supplied role/profile claim denies | Local app does not enforce per-user module, record, field, ownership, sharing, territory, or audit-actor rules | Choose the local identity provider, map authorized principals to source users/profiles/roles, define disabled/deleted-user and sharing behavior, then acceptance-test before enabling enforcement | Yes | Blocked |`,
    `| Blueprint transition execution | Process Management → Blueprint | The structural endpoint returned ${successfulBlueprintStructures.length} of ${listedBlueprints.length} listed Blueprint graphs; Before/During/After details cover ${blueprintPhaseTotals.specified}/${blueprintPhaseTotals.total} transitions across ${blueprintsWithPhaseDetail} Blueprints; ${modulePhaseCoverage} | All ${listedBlueprints.length} structural catalogs and ${blueprintPhaseTotals.total} graph transitions are sanitized locally; ${blueprintPhaseTotals.specified} transitions have phase detail, ${blueprintPhaseTotals.executable} are policy eligible, and ${blueprintPhaseTotals.blocked} are policy blocked. Discovery does not enable atomic runtime execution. Tasks is ${tasksPhaseSummary?.specified_count || 0}/${tasksPhaseSummary?.total_count || 0} specified with all ${tasksPhaseSummary?.blocked_count || 0} transitions policy blocked; direct source stage edits remain blocked | The policy-eligible paths require independent exact atomic-RPC verification before runtime execution. The ${blueprintPhaseTotals.blocked} policy-blocked transitions additionally require source-equivalent identity, permissions, validation, mandatory-input, action-adapter, scheduling, and transactional behavior to be implemented and acceptance-tested as applicable | Verify the exact staged atomic RPC separately, then implement and acceptance-test remaining local dependencies one transition at a time; keep the inactive Tasks Blueprint blocked unless its source-equivalent activation and execution contract is explicitly approved | Yes | Blocked |`,
    `| Source record counts | Module record-count action | ${countBlockedDatasets} of ${accessibleModules.length} API-supported datasets did not return a usable count; aggregate count scope can differ from active-record enumeration | ${countedDatasets} datasets counted; ${reconciledDatasets} match the source-derived local row counts; the physical local total is ${formatCount(localPhysicalRecordTotal)} rows, comprising ${formatCount(localSourceDerivedRecordTotal)} source-derived rows and ${localOnlySummary} | A full record-by-record parity claim is impossible for uncounted datasets or unresolved aggregate scopes | Grant the required read permissions or provide an authorized source export, then rerun discovery and reconciliation | Yes | Blocked |`,
    usableActiveEvidence(notesEvidence) && usableActiveEvidence(tasksEvidence) && usableChildEvidence
      ? `| Notes, Tasks, generated child rows, and related-list resolution | Notes, Tasks, four generated subform datasets, and module Related tabs | Notes and Tasks are exact at ${formatCount(notesEvidence.source_active_ids)} and ${formatCount(tasksEvidence.source_active_ids)} active IDs; all ${formatCount(childEvidenceSummary.child_source_active_ids)} enumerable child IDs are local; the Notes aggregate endpoint has a ${formatCount(notesAggregateDelta)}-row scope delta; four child count endpoints exceed active enumeration by ${formatCount(childEvidenceSummary.child_count_only_unavailable)} rows without exposing IDs or payloads${relatedListEvidenceUsable ? `; and ${formatCount(relatedListEvidence.unresolved_definition_count)}/${formatCount(relatedListEvidence.generic_ui_evaluated_definition_count)} generic related-list definitions lack an exact locally reproducible link path` : ''} | Exact active-ID audits are retained in sanitized configuration and merged into every generated public reconciliation document; sibling related lists require an exact source lookup relation and fail closed instead of returning aliased rows; no source writes or local deletes occurred | The Notes aggregate scope remains unresolved, the ${formatCount(childEvidenceSummary.child_count_only_unavailable)} count-only child rows cannot be represented or related locally${relatedListEvidenceUsable ? `, and only ${formatCount(relatedListEvidence.queryable_definition_count)}/${formatCount(relatedListEvidence.generic_ui_evaluated_definition_count)} generic related-list definitions are safely queryable` : ''} | Obtain authorized exports or APIs that expose stable IDs, payloads, parent links, deletion state, and exact relationship/filter definitions for unresolved scopes | Yes | Blocked |`
      : '| Notes, Tasks, and generated child rows | Module records API | Active-ID evidence is incomplete | No parity claim is generated | Record-level parity cannot be established | Rerun the dedicated GET-only reconciliation audits | Yes | Blocked |',
    metadataAreas.modules
      ? `| Metadata definitions | Modules, Fields, Layouts, Picklists, Views, Related Lists, Pipelines | Modules reconcile at ${formatCount(metadataAreas.modules.source_definitions)}/${formatCount(metadataAreas.modules.local_definitions)}, but local metadata contains only ${formatCount(metadataAreas.fields?.local_definitions)}/${formatCount(metadataAreas.fields?.source_definitions)} fields, ${formatCount(metadataAreas.layouts?.local_definitions)}/${formatCount(metadataAreas.layouts?.source_definitions)} layouts, ${formatCount(metadataAreas.picklists?.local_definitions)}/${formatCount(metadataAreas.picklists?.source_definitions)} picklists, ${formatCount(metadataAreas.custom_views?.local_definitions)}/${formatCount(metadataAreas.custom_views?.source_definitions)} custom views, and ${formatCount(metadataAreas.related_lists?.local_definitions)}/${formatCount(metadataAreas.related_lists?.source_definitions)} related lists; ${formatCount(metadataAreas.custom_views?.semantic_drift)} matched view defaults drift; pipeline 0/0 is inconclusive | A privacy-safe, SELECT-only parity audit and fail-closed runtime endpoint were added; no metadata updater or delete path exists | Forms, validation, picklists, views, related navigation, and pipeline behavior cannot match the source for missing definitions | Complete source reads, review view drift, design an idempotent add/update-only metadata migration, and retest every affected module | Yes | Blocked |`
      : '| Metadata definitions | Modules and Fields | Sanitized metadata parity evidence is unavailable | No updater is generated | Metadata parity cannot be established | Regenerate the SELECT-only metadata audit | Yes | Blocked |',
    `| Validation, assignment, approval, pipeline, and custom-view criteria | Setup rule families and module views | ${formatCount(ruleLayoutCoverage.source_coverage?.custom_views?.definitions_captured)} custom-view list rows contain ${formatCount(ruleLayoutCoverage.source_coverage?.custom_views?.criteria_details_captured)} criteria details; validation and approval definitions are inaccessible; ${formatCount(ruleLayoutCoverage.source_coverage?.assignment_rules?.definitions_captured)} assignment rule has no captured criteria/actions; pipeline definitions are unavailable | Local layout-aware validation and a fail-closed custom-view compiler are implemented; unverified source-rule outcomes default to Deny | Source rules, assignment, approvals, view filters, and pipeline progression are not locally equivalent | Capture complete definitions including ordering, actor context, actions, failure behavior, and view criteria; implement and acceptance-test each family | Yes | Blocked |`,
    `| Reports and dashboards | Reports and Analytics UI | Names and visible structure are discoverable, but formulas, component queries, sharing, schedules, and ${Math.max(0, reportInventoryCount - verifiedReportExportCount)} authoritative result sets were not exported | ${reportInventoryCount} reports, ${reportCategoryCount} folders/categories, and ${dashboardInventoryCount} dashboards inventoried read-only; ${verifiedReportExportCount} detailed report export(s) captured and row-count reconciled privately | Report and dashboard parity is not implemented or reconciled | Export or authorize the remaining report/dashboard definitions and result sets | Yes | Blocked |`,
    `| Workflow, webhook, and function execution | Setup → Automation and Developer Hub | ${workflowItems.length} workflow rules (${workflowDetailItems.length} detailed), ${fieldUpdateItems.length} field-update actions, ${automationTaskItems.length} task actions, ${emailNotificationItems.length} email-notification actions, ${webhookItems.length} webhooks, and ${functionItems.length} functions were inventoried; ${capturedFunctionCodeIds.size}/${functionItems.length} exact function bodies are stored privately and hash-verified; ${unresolvedCatalogActionReferences.length} workflow action reference(s) have no retrievable definition; credentials, communication targets, and safe local adapters are not complete | Trigger criteria, ${catalogActionReferences.length - unresolvedCatalogActionReferences.length}/${catalogActionReferences.length} referenced action definitions, and ${capturedFunctionCodeIds.size}/${functionItems.length} exact function bodies are captured; source-originated actions remain disabled | Automated behavior is not locally equivalent | Translate and test the captured function behavior, repair stale/missing action definitions, supply sandbox destinations and local integration credentials, then verify idempotency and failure paths | Yes | Blocked |`,
    `| Widget behavior and execution | Setup → Developer Hub → Widgets | ${widgetReconciliation.external_hosted_widgets || 0} external-hosted registrations have no captured package; local data-write, Blueprint, identity, credential, and rollback contracts remain incomplete | ${widgetReconciliation.source_widget_rows || 0} registrations reconciled; ${widgetReconciliation.validated_zoho_packages || 0}/${widgetReconciliation.zoho_hosted_widgets || 0} Zoho-hosted packages validated offline; behavior, inputs, dependencies, feasibility, and blockers mapped; all execution fail-closed | Widget UI actions are not yet locally equivalent | Obtain and authorize external-hosted implementations, complete each dependency contract, then acceptance-test positive, negative, idempotency, and rollback paths before enabling one widget at a time | Yes | Blocked |`,
    `| Attachments and email bodies | Module related lists | ${formatCount(attachmentEvidence.absent_from_local_records)} of ${formatCount(attachmentEvidence.source_attachment_ids)} source attachment IDs are absent from local CRM records; ${formatCount(attachmentEvidence.exact_addressable_triples)} exact triples are addressable, ${formatCount(attachmentEvidence.quarantined_rows)} are quarantined, ${formatCount(attachmentEvidence.locally_linked_ids)} are locally linked, and ${formatCount(attachmentEvidence.migrated_attachment_bodies)} bodies were migrated; ${attachmentBaseline.current_linked_objects_anonymous_head_accessible ? 'the currently linked local objects accept anonymous HEAD requests' : 'private-object access has not been independently verified'} | Exact metadata baseline captured; a GET-only, exact-org, size-verifying, rate/concurrency-bounded on-demand service and resumable private-bucket pipeline are implemented and tested but unmounted; no customer bytes or bucket changes were made | Attachment content parity is not live, and mounting without per-user record authorization could expose customer files | Implement real identity and record authorization, prove attachment-read scope, classify link attachments, reconcile quarantined parents, and atomically refresh the allowlist before mounting or transferring bytes | Yes | Blocked |`,
  ];
  for (const [key, result] of globalEntries.map(([key]) => [key, globalResults[key]]).filter(([, result]) => !result.ok)) {
    blockers.push(`| ${md(key.replace(/_/g, ' '))} | Zoho settings API | HTTP ${result.status} from authenticated read-only request | Access attempted and recorded | Configuration parity remains incomplete | Verify account permission or inspect equivalent Setup page | Yes | ${assertStatus(statusFor(result))} |`);
  }
  writeDoc('ZOHO_LIMITATIONS_AND_BLOCKERS.md', blockers);

  console.log(`Read-only discovery complete: ${accessibleModules.length} accessible modules; ${workflowItems.length} workflows (${workflowDetailItems.length} detailed); ${fieldUpdateItems.length} field updates; ${automationTaskItems.length} task actions; ${emailNotificationItems.length} email notifications; ${webhookItems.length} webhooks; ${functionItems.length} functions`);
  console.log(`Blueprint graphs: ${successfulBlueprintStructures.length}/${listedBlueprints.length} authoritative structural responses; ${blueprintStructureRequests.length - successfulBlueprintStructures.length} UI fallbacks`);
  console.log(`Record counts: ${countedDatasets}/${accessibleModules.length} source datasets counted; ${reconciledDatasets} currently reconciled`);
  console.log('Coverage artifacts and private discovery snapshot updated');
}

async function runCli() {
  if (process.argv.includes(ATTACHMENT_AUDIT_FLAG)) {
    const counts = await auditAttachmentManifestCounts();
    console.log(JSON.stringify(counts, null, 2));
    return;
  }
  await main();
}

if (require.main === module) {
  runCli().catch(error => {
    if (process.argv.includes(ATTACHMENT_AUDIT_FLAG)) {
      console.error(`Attachment manifest count audit failed: ${error?.code || 'ATTACHMENT_AUDIT_FAILED'}`);
    } else {
      console.error(`Read-only discovery failed: ${error.message}`);
    }
    process.exitCode = 1;
  });
}

module.exports = {
  attachmentEvidenceFromBaseline,
  auditAttachmentManifestCounts,
};
