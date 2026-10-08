#!/usr/bin/env node
'use strict';

// Target-only, read-only Zoho CRM Blueprint transition discovery.
//
// Source CRM safety contract:
// - CRM is called only through crmGet(), which always uses HTTP GET.
// - No source record, Blueprint, transition, or setup mutation endpoint exists
//   in this script.
// - OAuth token exchange is a POST to Zoho Accounts, not Zoho CRM.
// - No local output is written until organization verification, all downloads,
//   phase validation, and exact transition-ID reconciliation have succeeded.

const fs = require('fs');
const path = require('path');
const { executionPolicyDecision } = require('../lib/blueprint-execution-policy');

const ROOT = path.join(__dirname, '..');
const PRIVATE_DISCOVERY_DIR = path.join(ROOT, '.private', 'zoho-discovery');
const UI_ARTIFACT_PATH = path.join(PRIVATE_DISCOVERY_DIR, 'blueprint-ui.json');
const BLUEPRINT_CONFIG_PATH = path.join(ROOT, 'config', 'blueprints.json');
const PHASE_CONFIG_PATH = path.join(ROOT, 'config', 'blueprint-transition-details.json');
const EXECUTION_POLICY_PATH = path.join(ROOT, 'config', 'blueprint-execution-policies.json');

const EXPECTED_ORG_ZGID = '60046349006';
const EXPECTED_ORG_DOMAIN = `org${EXPECTED_ORG_ZGID}`;
const REQUIRED_SCOPE = 'ZohoCRM.settings.transitions.read';
const MAX_BATCH_SIZE = 50;

const TARGETS = Object.freeze([
  Object.freeze({
    blueprint_id: '1032257000001044611',
    module: 'Contacts',
    ui_module: 'Contacts',
    name: 'Opportunity Stage',
    expected_transition_count: 83,
    accepted_api_modules: Object.freeze(['Contacts']),
  }),
  Object.freeze({
    blueprint_id: '1032257000000535747',
    module: 'Deals',
    ui_module: 'Potentials',
    name: 'Order Stages',
    expected_transition_count: 80,
    accepted_api_modules: Object.freeze(['Deals', 'Potentials']),
  }),
]);

const REQUIRED_ENV_KEYS = Object.freeze([
  'ZOHO_API_DOMAIN',
  'ZOHO_ACCOUNTS_URL',
  'ZOHO_CLIENT_ID',
  'ZOHO_CLIENT_SECRET',
  'ZOHO_REFRESH_TOKEN',
]);

const SENSITIVE_KEY = /(authorization|credential|secret|password|token|cookie|connection|header|endpoint|\burl\b|\buri\b|recipient|address|payload|request_body|function_body|script|source_code)/i;
const EXTERNAL_TARGET = /(?:https?:\/\/|^[^\s@]+@[^\s@]+\.[^\s@]+$)/i;

const arr = value => Array.isArray(value) ? value : [];
const hasOwn = (value, key) => Boolean(value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key));
const idOf = value => value === null || value === undefined ? '' : String(value);

class ExtractionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ExtractionError';
    this.code = code;
    this.details = details;
  }
}

function parseArgs(argv) {
  const options = { writePublicConfig: false, help: false };
  for (const argument of argv) {
    if (argument === '--write-public-config') options.writePublicConfig = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else throw new ExtractionError('INVALID_ARGUMENT', `Unknown argument: ${argument}`);
  }
  return options;
}

function usage() {
  return [
    'Usage: node scripts/extract-blueprint-transition-phases.js [--write-public-config]',
    '',
    'Default: verify the source organization, download Contacts and Deals transition',
    'metadata through CRM GET requests, then write raw and normalized preview JSON',
    'only under .private/zoho-discovery with mode 0600.',
    '',
    '--write-public-config  Also merge the validated, sanitized definitions into',
    '                       config/blueprint-transition-details.json.',
  ].join('\n');
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new ExtractionError('LOCAL_INPUT_INVALID', `${label} could not be read as JSON.`, {
      file: filePath,
      reason: error instanceof SyntaxError ? 'invalid_json' : 'unavailable',
    });
  }
}

function assertHttpsZohoBase(rawValue, kind) {
  let parsed;
  try {
    parsed = new URL(rawValue);
  } catch {
    throw new ExtractionError('ENVIRONMENT_INVALID', `${kind} is not a valid URL.`);
  }
  const expectedHostPattern = kind === 'ZOHO_API_DOMAIN' ? /(^|\.)zohoapis\./i : /(^|\.)zoho\./i;
  if (parsed.protocol !== 'https:' || !expectedHostPattern.test(parsed.hostname)) {
    throw new ExtractionError('ENVIRONMENT_INVALID', `${kind} must be an HTTPS Zoho endpoint.`);
  }
  return parsed.origin;
}

function validateEnvironment(environment) {
  const missing = REQUIRED_ENV_KEYS.filter(key => !environment[key]);
  if (missing.length) {
    throw new ExtractionError('ENVIRONMENT_INVALID', 'Required Zoho environment values are missing.', { missing });
  }
  return {
    apiDomain: assertHttpsZohoBase(environment.ZOHO_API_DOMAIN, 'ZOHO_API_DOMAIN'),
    accountsUrl: assertHttpsZohoBase(environment.ZOHO_ACCOUNTS_URL, 'ZOHO_ACCOUNTS_URL'),
    clientId: environment.ZOHO_CLIENT_ID,
    clientSecret: environment.ZOHO_CLIENT_SECRET,
    refreshToken: environment.ZOHO_REFRESH_TOKEN,
  };
}

function chunk(items, size = MAX_BATCH_SIZE) {
  if (!Number.isInteger(size) || size < 1 || size > MAX_BATCH_SIZE) {
    throw new ExtractionError('BATCH_SIZE_INVALID', `Batch size must be between 1 and ${MAX_BATCH_SIZE}.`);
  }
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function buildTargetManifest(uiArtifact, blueprintConfig) {
  const uiBlueprints = arr(uiArtifact?.blueprints);
  const configuredBlueprints = arr(blueprintConfig?.blueprints);
  const entries = [];
  const targets = [];

  for (const target of TARGETS) {
    const uiBlueprint = uiBlueprints.find(item => idOf(item?.id) === target.blueprint_id);
    const configuredBlueprint = configuredBlueprints.find(item => idOf(item?.id) === target.blueprint_id);
    if (!uiBlueprint || !configuredBlueprint) {
      throw new ExtractionError('MANIFEST_INCOMPLETE', `Blueprint manifest is missing ${target.module}.`, {
        blueprint_id: target.blueprint_id,
        ui_present: Boolean(uiBlueprint),
        config_present: Boolean(configuredBlueprint),
      });
    }
    if (configuredBlueprint.module !== target.module || uiBlueprint.uiModule !== target.ui_module) {
      throw new ExtractionError('MANIFEST_MISMATCH', `Blueprint module identity does not match ${target.module}.`, {
        blueprint_id: target.blueprint_id,
      });
    }

    const uiTransitions = arr(uiBlueprint.transitions);
    const configuredTransitions = arr(configuredBlueprint.transitions);
    const uiIds = uiTransitions.map(item => idOf(item?.transition_id));
    const configuredIds = configuredTransitions.map(item => idOf(item?.id));
    if (uiIds.some(id => !/^\d+$/.test(id)) || configuredIds.some(id => !/^\d+$/.test(id))) {
      throw new ExtractionError('MANIFEST_INVALID_ID', `${target.module} contains a malformed transition ID.`);
    }
    if (new Set(uiIds).size !== uiIds.length || new Set(configuredIds).size !== configuredIds.length) {
      throw new ExtractionError('MANIFEST_DUPLICATE_ID', `${target.module} contains duplicate transition IDs.`);
    }
    if (uiIds.length !== target.expected_transition_count || configuredIds.length !== target.expected_transition_count) {
      throw new ExtractionError('MANIFEST_COUNT_MISMATCH', `${target.module} transition count does not match the audited manifest.`, {
        expected: target.expected_transition_count,
        ui: uiIds.length,
        config: configuredIds.length,
      });
    }
    const missingFromConfig = uiIds.filter(id => !configuredIds.includes(id));
    const missingFromUi = configuredIds.filter(id => !uiIds.includes(id));
    if (missingFromConfig.length || missingFromUi.length) {
      throw new ExtractionError('MANIFEST_ID_MISMATCH', `${target.module} UI and config transition IDs do not reconcile.`, {
        missing_from_config: missingFromConfig,
        missing_from_ui: missingFromUi,
      });
    }

    const configuredById = new Map(configuredTransitions.map(item => [idOf(item.id), item]));
    for (const uiTransition of uiTransitions) {
      const transitionId = idOf(uiTransition.transition_id);
      const configuredTransition = configuredById.get(transitionId);
      entries.push({
        id: transitionId,
        blueprint_id: target.blueprint_id,
        blueprint_name: configuredBlueprint.name || target.name,
        module: target.module,
        accepted_api_modules: [...target.accepted_api_modules],
        graph: {
          name: configuredTransition?.name || String(uiTransition.name || '').replace(/C$/, ''),
          global: configuredTransition?.global === true || /C$/.test(String(uiTransition.name || '')),
          relationship_id: idOf(uiTransition.relationship_id) || null,
        },
      });
    }
    targets.push({
      blueprint_id: target.blueprint_id,
      name: configuredBlueprint.name || target.name,
      module: target.module,
      transition_count: uiIds.length,
    });
  }

  const combinedIds = entries.map(item => item.id);
  if (combinedIds.length !== 163 || new Set(combinedIds).size !== 163) {
    throw new ExtractionError('MANIFEST_TOTAL_MISMATCH', 'Contacts and Deals must reconcile to exactly 163 unique transition IDs.', {
      total: combinedIds.length,
      unique: new Set(combinedIds).size,
    });
  }
  return { targets, entries };
}

function sanitizeReference(value, keys = ['id', 'name', 'api_name']) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out = {};
  for (const key of keys) {
    if (['string', 'number', 'boolean'].includes(typeof value[key])) out[key] = value[key];
  }
  return Object.keys(out).length ? out : null;
}

function safeValue(value, depth = 0) {
  if (value === null || ['number', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'string') return EXTERNAL_TARGET.test(value) ? '[redacted external target]' : value;
  if (depth >= 6) return '[nested configuration omitted]';
  if (Array.isArray(value)) return value.map(item => safeValue(item, depth + 1)).filter(item => item !== undefined);
  if (!value || typeof value !== 'object') return undefined;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) continue;
    const sanitized = safeValue(child, depth + 1);
    if (sanitized !== undefined) out[key] = sanitized;
  }
  return out;
}

function sanitizeCriterionValue(value) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return safeValue(value);
  if (Array.isArray(value)) return value.map(sanitizeCriterionValue).filter(item => item !== undefined);
  return sanitizeReference(value, ['id', 'name', 'api_name', 'display_value', 'actual_value']) || undefined;
}

function normalizeCriteriaTree(criteria) {
  if (!criteria || typeof criteria !== 'object' || Array.isArray(criteria)) return null;
  if (Array.isArray(criteria.group)) {
    const group = criteria.group.map(normalizeCriteriaTree).filter(Boolean);
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

function flattenCriteria(criteriaTree) {
  if (!criteriaTree) return { criteria: [], logic_supported: true };
  if (Array.isArray(criteriaTree.group)) {
    if (criteriaTree.group_operator !== 'AND') return { criteria: [], logic_supported: false };
    const children = criteriaTree.group.map(flattenCriteria);
    if (children.some(child => !child.logic_supported)) return { criteria: [], logic_supported: false };
    return { criteria: children.flatMap(child => child.criteria), logic_supported: true };
  }
  if (!criteriaTree.field?.api_name || !hasOwn(criteriaTree, 'value')) return { criteria: [], logic_supported: false };
  return {
    criteria: [{
      field: criteriaTree.field.api_name,
      operator: String(criteriaTree.comparator || 'equal'),
      value: criteriaTree.value,
    }],
    logic_supported: true,
  };
}

function ownerTypeLabel(type) {
  const normalized = String(type || '').toLowerCase();
  const labels = {
    record_owner: 'Record Owner',
    all_users: 'All Users',
    all: 'All Users',
    users: 'Specific Users',
    user: 'Specific Users',
    profiles: 'Profiles',
    profile: 'Profiles',
    roles: 'Roles',
    role: 'Roles',
    groups: 'Groups',
    group: 'Groups',
    superiors: 'Superiors',
  };
  if (labels[normalized]) return labels[normalized];
  return normalized ? normalized.split('_').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ') : 'Unknown Owner Type';
}

function normalizeOwners(owners) {
  const ownerDetails = arr(owners).map(owner => {
    const type = String(owner?.type || 'unknown');
    return {
      type,
      resources: arr(owner?.resources).map(resource => sanitizeReference(resource, ['id', 'name', 'api_name'])).filter(Boolean),
    };
  });
  const labels = [...new Set(ownerDetails.map(owner => {
    const base = ownerTypeLabel(owner.type);
    return owner.resources.length ? `${base} (${owner.resources.length})` : base;
  }))];
  return { labels, details: ownerDetails };
}

function normalizeDuringInput(input, index) {
  const sourceType = String(input?.type || 'unknown').toLowerCase();
  const field = sanitizeReference(input?.field, ['id', 'api_name', 'field_label', 'name', 'data_type']);
  const sequenceValue = input?.sequence_number ?? input?.sequence ?? index + 1;
  const sequence = Number.isFinite(Number(sequenceValue)) ? Number(sequenceValue) : index + 1;
  let kind = sourceType;
  if (field && sourceType === 'field') kind = 'field';
  else if (/associated|related/.test(sourceType)) kind = 'associated_item';
  else if (/checklist/.test(sourceType)) kind = 'checklist';
  else if (/widget/.test(sourceType)) kind = 'widget';
  else if (/info|message/.test(sourceType)) kind = 'message';
  else if (field) kind = 'field';

  const out = {
    id: idOf(input?.id) || null,
    kind,
    source_type: sourceType,
    api_name: field?.api_name || input?.api_name || null,
    label: field?.field_label || field?.name || input?.name || field?.api_name || null,
    data_type: field?.data_type || input?.data_type || null,
    required: input?.optional === false,
    sequence,
  };
  if (input?.module !== undefined) out.module = safeValue(input.module);
  if (input?.message !== undefined) out.message = safeValue(input.message);
  if (input?.validation_filter !== undefined) out.validation_filter = safeValue(input.validation_filter);
  if (input?.checklist_info !== undefined) out.checklist_info = safeValue(input.checklist_info);
  if (input?.widget !== undefined) out.widget = sanitizeReference(input.widget, ['id', 'name', 'api_name']);
  return out;
}

function normalizeAfterAction(action) {
  const detailsPresent = hasOwn(action, 'details') && action.details !== null;
  return {
    id: idOf(action?.id) || null,
    type: action?.type ? String(action.type) : 'unknown',
    name: action?.name || null,
    details: detailsPresent ? safeValue(action.details) : null,
    details_present: detailsPresent,
  };
}

function assertPhaseKeys(detail) {
  const required = ['criteria', 'owners', 'during_inputs', 'actions'];
  const missing = required.filter(key => !hasOwn(detail, key));
  if (missing.length) {
    throw new ExtractionError('PHASE_METADATA_INCOMPLETE', `Transition ${idOf(detail?.id) || 'unknown'} is missing authoritative phase keys.`, {
      transition_id: idOf(detail?.id) || null,
      missing_keys: missing,
    });
  }
}

function normalizeTransition(detail, manifestEntry) {
  assertPhaseKeys(detail);
  const criteriaTree = normalizeCriteriaTree(detail.criteria);
  const flattened = flattenCriteria(criteriaTree);
  const owners = normalizeOwners(detail.owners);
  const common = typeof detail.global === 'boolean' ? detail.global : manifestEntry.graph.global;
  const inputs = arr(detail.during_inputs)
    .map(normalizeDuringInput)
    .sort((left, right) => left.sequence - right.sequence || String(left.id).localeCompare(String(right.id)));
  const definition = {
    name: detail.name || manifestEntry.graph.name,
    common,
    trigger_type: detail.trigger_type || null,
    transition_type: detail.transition_type || null,
    before: {
      owners: owners.labels,
      owner_details: owners.details,
      criteria: flattened.criteria,
      criteria_tree: criteriaTree,
      criteria_logic_supported: flattened.logic_supported,
    },
    during_inputs: inputs,
    after_actions: arr(detail.actions).map(normalizeAfterAction),
    local_execution: 'Blocked',
    block_reason: 'Captured from read-only source metadata. Local execution remains blocked until owner rules, inputs, and every After action are implemented and tested.',
    source_evidence: {
      method: 'GET',
      transition_id: manifestEntry.id,
      process_id: idOf(detail.process_id) || null,
      phase_keys_complete: true,
    },
  };
  if (hasOwn(detail, 'trigger_after')) definition.trigger_after = safeValue(detail.trigger_after);
  if (hasOwn(detail, 'include_all_states')) definition.include_all_states = detail.include_all_states === true;
  return definition;
}

function reconcileTransitionDetails(details, manifest) {
  const expectedById = new Map(manifest.entries.map(entry => [entry.id, entry]));
  const returnedById = new Map();
  const duplicateIds = [];
  const unexpectedIds = [];

  for (const detail of details) {
    const id = idOf(detail?.id);
    if (!expectedById.has(id)) unexpectedIds.push(id || null);
    if (returnedById.has(id)) duplicateIds.push(id || null);
    returnedById.set(id, detail);
  }
  const missingIds = [...expectedById.keys()].filter(id => !returnedById.has(id));
  if (details.length !== manifest.entries.length || duplicateIds.length || unexpectedIds.length || missingIds.length) {
    throw new ExtractionError('TRANSITION_RECONCILIATION_FAILED', 'Downloaded transition IDs do not exactly match the 163-ID target manifest.', {
      expected: manifest.entries.length,
      returned: details.length,
      duplicate_ids: duplicateIds,
      unexpected_ids: unexpectedIds,
      missing_ids: missingIds,
    });
  }

  for (const [id, detail] of returnedById) {
    const expected = expectedById.get(id);
    if (detail.process_id !== undefined && detail.process_id !== null && idOf(detail.process_id) !== expected.blueprint_id) {
      throw new ExtractionError('TRANSITION_PROCESS_MISMATCH', `Transition ${id} belongs to an unexpected Blueprint process.`, {
        transition_id: id,
        expected_process_id: expected.blueprint_id,
        returned_process_id: idOf(detail.process_id),
      });
    }
    const apiModule = detail.module?.api_name;
    if (apiModule && !expected.accepted_api_modules.includes(apiModule)) {
      throw new ExtractionError('TRANSITION_MODULE_MISMATCH', `Transition ${id} belongs to an unexpected module.`, {
        transition_id: id,
        returned_module: apiModule,
      });
    }
    assertPhaseKeys(detail);
  }
  return manifest.entries.map(entry => returnedById.get(entry.id));
}

function normalizePreview(orderedDetails, manifest, organization, generatedAt = new Date().toISOString()) {
  const detailById = new Map(orderedDetails.map(detail => [idOf(detail.id), detail]));
  const manifestById = new Map(manifest.entries.map(entry => [entry.id, entry]));
  const blueprints = {};
  for (const target of manifest.targets) {
    const transitions = {};
    for (const entry of manifest.entries.filter(item => item.blueprint_id === target.blueprint_id)) {
      transitions[entry.id] = normalizeTransition(detailById.get(entry.id), manifestById.get(entry.id));
    }
    blueprints[target.blueprint_id] = {
      name: target.name,
      module: target.module,
      phase_coverage: 'Specified',
      transitions,
    };
  }
  return {
    version: 1,
    generated_at: generatedAt,
    source_mode: 'read-only-api-private-preview',
    organization: {
      zgid: organization.zgid,
      domain_name: organization.domain_name,
      verified: true,
    },
    required_scope: REQUIRED_SCOPE,
    summary: {
      blueprint_count: manifest.targets.length,
      transition_count: manifest.entries.length,
      source_crm_method: 'GET',
      source_crm_mutations: 0,
      local_execution_enabled: 0,
    },
    blueprints,
  };
}

async function jsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function exchangeAccessToken(configuration, fetchImpl = fetch) {
  const params = new URLSearchParams({
    refresh_token: configuration.refreshToken,
    client_id: configuration.clientId,
    client_secret: configuration.clientSecret,
    grant_type: 'refresh_token',
  });
  const response = await fetchImpl(`${configuration.accountsUrl}/oauth/v2/token`, {
    method: 'POST',
    redirect: 'error',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const body = await jsonResponse(response);
  if (!response.ok || !body?.access_token) {
    throw new ExtractionError('AUTHENTICATION_FAILURE', `Zoho Accounts authentication failed with HTTP ${response.status}.`, {
      http_status: response.status,
    });
  }
  return body.access_token;
}

async function crmGet(apiDomain, endpoint, accessToken, fetchImpl = fetch) {
  if (typeof endpoint !== 'string' || !endpoint.startsWith('/crm/') || endpoint.includes('://')) {
    throw new ExtractionError('CRM_ENDPOINT_REJECTED', 'CRM endpoint must be a relative /crm/ path.');
  }
  const response = await fetchImpl(`${apiDomain}${endpoint}`, {
    method: 'GET',
    redirect: 'error',
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      Accept: 'application/json',
    },
  });
  return {
    ok: response.ok,
    status: response.status,
    endpoint,
    body: await jsonResponse(response),
  };
}

async function verifyOrganization(configuration, accessToken, fetchImpl = fetch) {
  const result = await crmGet(configuration.apiDomain, '/crm/v8/org', accessToken, fetchImpl);
  if (!result.ok) {
    throw new ExtractionError(result.body?.code || 'ORG_VERIFICATION_FAILED', `Organization verification failed with HTTP ${result.status}.`, {
      http_status: result.status,
    });
  }
  const organizations = arr(result.body?.org);
  const organization = organizations.find(item => idOf(item?.zgid) === EXPECTED_ORG_ZGID && item?.domain_name === EXPECTED_ORG_DOMAIN);
  if (!organization) {
    throw new ExtractionError('ORG_MISMATCH', `Authenticated CRM organization is not ${EXPECTED_ORG_DOMAIN}.`, {
      expected_zgid: EXPECTED_ORG_ZGID,
      returned_organization_count: organizations.length,
    });
  }
  return { zgid: EXPECTED_ORG_ZGID, domain_name: EXPECTED_ORG_DOMAIN };
}

async function downloadTransitionDetails(configuration, accessToken, manifest, fetchImpl = fetch) {
  const batches = chunk(manifest.entries, MAX_BATCH_SIZE);
  const rawBatches = [];
  const details = [];
  for (let index = 0; index < batches.length; index++) {
    const ids = batches[index].map(item => item.id);
    const query = new URLSearchParams({ ids: ids.join(',') });
    const endpoint = `/crm/v8/settings/blueprints/transitions?${query}`;
    const result = await crmGet(configuration.apiDomain, endpoint, accessToken, fetchImpl);
    if (!result.ok) {
      const code = result.body?.code || `HTTP_${result.status}`;
      const message = code === 'OAUTH_SCOPE_MISMATCH'
        ? `Blueprint transition metadata is blocked by OAuth scope. Reauthorize the refresh token with ${REQUIRED_SCOPE}.`
        : `Blueprint transition batch ${index + 1}/${batches.length} failed with HTTP ${result.status}.`;
      throw new ExtractionError(code, message, {
        http_status: result.status,
        organization_verified: true,
        failed_batch: index + 1,
        total_batches: batches.length,
        batch_size: ids.length,
        transitions_downloaded: details.length,
        required_scope: REQUIRED_SCOPE,
      });
    }
    const transitions = arr(result.body?.transitions);
    rawBatches.push({
      batch_number: index + 1,
      requested_ids: ids,
      http_status: result.status,
      response: result.body,
    });
    details.push(...transitions);
  }
  return { batches: rawBatches, details };
}

function privateFilenameTimestamp(isoTimestamp) {
  return isoTimestamp.replace(/[:.]/g, '-');
}

function secureWriteJson(filePath, value, mode) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true, mode: directory.includes(`${path.sep}.private${path.sep}`) ? 0o700 : 0o755 });
  if (directory.includes(`${path.sep}.private${path.sep}`)) fs.chmodSync(directory, 0o700);
  const temporary = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode, flag: 'wx' });
    fs.chmodSync(temporary, mode);
    fs.renameSync(temporary, filePath);
    fs.chmodSync(filePath, mode);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

function publicDefinition(definition) {
  const copy = JSON.parse(JSON.stringify(definition));
  if (copy.before?.owner_details) {
    copy.before.owner_details = copy.before.owner_details.map(owner => ({
      type: owner.type,
      resource_count: arr(owner.resources).length,
    }));
  }
  return copy;
}

function mergePublicPhaseConfig(current, preview, { executionPolicies = null, blueprintConfig = null } = {}) {
  const merged = JSON.parse(JSON.stringify(current));
  merged.version = merged.version || 1;
  merged.generated_at = preview.generated_at;
  merged.source_mode = 'mixed-read-only-inspection';
  merged.blueprints = merged.blueprints && typeof merged.blueprints === 'object' ? merged.blueprints : {};
  for (const [blueprintId, blueprint] of Object.entries(preview.blueprints)) {
    const graphBlueprint = blueprintConfig?.blueprints?.find(item => idOf(item?.id) === blueprintId) || null;
    merged.blueprints[blueprintId] = {
      name: blueprint.name,
      module: blueprint.module,
      phase_coverage: blueprint.phase_coverage,
      transitions: Object.fromEntries(Object.entries(blueprint.transitions).map(([transitionId, definition]) => {
        const normalized = publicDefinition(definition);
        const graphTransition = graphBlueprint?.transitions?.find(item => idOf(item?.id) === transitionId) || null;
        if (executionPolicies && graphBlueprint && graphTransition
          && executionPolicyDecision(executionPolicies, graphBlueprint, graphTransition, normalized).approved) {
          normalized.local_execution = 'Implemented';
          normalized.block_reason = null;
        }
        return [transitionId, normalized];
      })),
    };
  }
  return merged;
}

async function run(options = {}, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl || fetch;
  const environment = dependencies.environment || process.env;
  const executionState = dependencies.executionState || { localFilesWritten: 0, publicConfigWritten: false };
  const configuration = validateEnvironment(environment);
  const uiArtifact = dependencies.uiArtifact || readJson(UI_ARTIFACT_PATH, 'Private Blueprint UI artifact');
  const blueprintConfig = dependencies.blueprintConfig || readJson(BLUEPRINT_CONFIG_PATH, 'Blueprint config manifest');
  const manifest = buildTargetManifest(uiArtifact, blueprintConfig);
  const accessToken = await exchangeAccessToken(configuration, fetchImpl);
  const organization = await verifyOrganization(configuration, accessToken, fetchImpl);
  const download = await downloadTransitionDetails(configuration, accessToken, manifest, fetchImpl);
  const orderedDetails = reconcileTransitionDetails(download.details, manifest);
  const generatedAt = new Date().toISOString();
  const preview = normalizePreview(orderedDetails, manifest, organization, generatedAt);

  // Deliberately after all network and reconciliation checks: any failure above
  // leaves the local filesystem unchanged.
  const timestamp = privateFilenameTimestamp(generatedAt);
  const rawPath = path.join(PRIVATE_DISCOVERY_DIR, `contacts-deals-blueprint-transition-raw-${timestamp}.json`);
  const previewPath = path.join(PRIVATE_DISCOVERY_DIR, `contacts-deals-blueprint-transition-preview-${timestamp}.json`);
  const raw = {
    generated_at: generatedAt,
    source_mode: 'read-only-api-raw',
    organization,
    required_scope: REQUIRED_SCOPE,
    targets: manifest.targets,
    source_crm_method: 'GET',
    source_crm_mutations: 0,
    batches: download.batches,
  };
  secureWriteJson(rawPath, raw, 0o600);
  executionState.localFilesWritten += 1;
  secureWriteJson(previewPath, preview, 0o600);
  executionState.localFilesWritten += 1;

  let publicConfigWritten = false;
  if (options.writePublicConfig) {
    const current = readJson(PHASE_CONFIG_PATH, 'Public Blueprint phase config');
    const executionPolicies = readJson(EXECUTION_POLICY_PATH, 'Blueprint execution policies');
    const merged = mergePublicPhaseConfig(current, preview, { executionPolicies, blueprintConfig });
    secureWriteJson(PHASE_CONFIG_PATH, merged, 0o644);
    publicConfigWritten = true;
    executionState.localFilesWritten += 1;
    executionState.publicConfigWritten = true;
  }

  return {
    status: 'success',
    organization: EXPECTED_ORG_DOMAIN,
    targets: manifest.targets,
    transition_count: manifest.entries.length,
    batch_sizes: download.batches.map(batch => batch.requested_ids.length),
    source_crm_methods: ['GET'],
    source_crm_mutations: 0,
    local_private_files: [rawPath, previewPath],
    public_config_written: publicConfigWritten,
  };
}

async function main() {
  let options;
  const executionState = { localFilesWritten: 0, publicConfigWritten: false };
  try {
    options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      return;
    }
    require('dotenv').config({ path: path.join(ROOT, '.env') });
    const summary = await run(options, { executionState });
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    const expected = error instanceof ExtractionError;
    const summary = {
      status: 'blocked',
      code: expected ? error.code : 'UNEXPECTED_ERROR',
      message: expected ? error.message : 'Blueprint transition extraction failed before any public config write.',
      ...(expected ? error.details : {}),
      expected_organization: EXPECTED_ORG_DOMAIN,
      source_crm_allowed_methods: ['GET'],
      source_crm_mutations: 0,
      local_files_written: executionState.localFilesWritten,
      public_config_written: executionState.publicConfigWritten,
    };
    console.error(JSON.stringify(summary, null, 2));
    process.exitCode = error?.code === 'OAUTH_SCOPE_MISMATCH' ? 2 : 1;
  }
}

if (require.main === module) main();

module.exports = {
  EXPECTED_ORG_DOMAIN,
  EXPECTED_ORG_ZGID,
  MAX_BATCH_SIZE,
  REQUIRED_SCOPE,
  TARGETS,
  ExtractionError,
  buildTargetManifest,
  chunk,
  crmGet,
  flattenCriteria,
  mergePublicPhaseConfig,
  normalizeAfterAction,
  normalizeCriteriaTree,
  normalizeDuringInput,
  normalizeOwners,
  normalizePreview,
  normalizeTransition,
  parseArgs,
  reconcileTransitionDetails,
  safeValue,
};
