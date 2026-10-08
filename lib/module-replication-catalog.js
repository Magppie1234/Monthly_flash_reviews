'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CONFIG_PATH = path.resolve(__dirname, '..', 'config', 'module-replication-catalog.json');
const RAW_CATALOG = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

const API_NAME = /^[A-Za-z][A-Za-z0-9_]{0,95}$/;
const GENERATED_TYPES = new Set(['field_tracker', 'linking', 'subform']);
const MODULE_TYPES = new Set(['custom', 'default', ...GENERATED_TYPES]);
const SOURCE_UNAVAILABLE_HTTP_STATUSES = new Set([400, 401, 403, 500]);

const EXPECTED_SCOPE = Object.freeze({
  source_module_definition_count: 153,
  api_supported_dataset_count: 122,
  api_unsupported_definition_count: 31,
  scheduled_dataset_count: 16,
  unscheduled_dataset_count: 106,
});

const EXPECTED_SCHEDULED_DATASETS = Object.freeze([
  'Leads', 'Contacts', 'Accounts', 'Deals', 'Tasks', 'Events', 'Calls', 'Products',
  'Vendors', 'Developers', 'Referral_Partners', 'Payment_Milestones', 'Designers',
  'Visit_Module', 'AMS_Complaints', 'Notes',
]);

const CLASSIFICATION_RULES = Object.freeze({
  reconciled_active_ids: Object.freeze({
    state: 'reconciled',
    reason_code: 'SAME_EPOCH_ACTIVE_ID_PARITY',
    expected_count: 1,
    evidence: 'active_ids',
    generated: false,
  }),
  active_id_parity_count_scope_unresolved: Object.freeze({
    state: 'unresolved',
    reason_code: 'COUNT_SCOPE_EXCEEDS_ACTIVE_ID_ENUMERATION',
    expected_count: 5,
    evidence: 'active_ids_with_gap',
    generated: null,
  }),
  count_only_unresolved: Object.freeze({
    state: 'unresolved',
    reason_code: 'SOURCE_COUNT_WITHOUT_EXACT_ID_PAYLOAD_PARITY',
    expected_count: 24,
    evidence: 'count_only',
    generated: false,
  }),
  generated_count_only_unresolved: Object.freeze({
    state: 'unresolved',
    reason_code: 'GENERATED_SCOPE_HAS_COUNT_ONLY_EVIDENCE',
    expected_count: 7,
    evidence: 'count_only',
    generated: true,
  }),
  source_unavailable_unresolved: Object.freeze({
    state: 'unresolved',
    reason_code: 'SOURCE_COUNT_UNAVAILABLE',
    expected_count: 74,
    evidence: 'unavailable',
    generated: false,
  }),
  generated_source_unavailable_unresolved: Object.freeze({
    state: 'unresolved',
    reason_code: 'GENERATED_SCOPE_SOURCE_COUNT_UNAVAILABLE',
    expected_count: 11,
    evidence: 'unavailable',
    generated: true,
  }),
});

const FORBIDDEN_KEYS = new Set([
  'authorization', 'cookie', 'credential', 'credentials', 'email', 'endpoint', 'first_name',
  'full_name', 'id', 'last_name', 'mobile', 'organization', 'organization_id', 'org_id',
  'password', 'path', 'phone', 'private_path', 'secret', 'token', 'url', 'user_name',
]);
const FORBIDDEN_VALUE_PATTERNS = [
  /https?:\/\//i,
  /\bwww\./i,
  /\/(?:Users|home|var|tmp|opt|etc)\//i,
  /\.private\//i,
  /\borg\d{6,}\b/i,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\bbearer\s+[A-Z0-9._~+/=-]{8,}/i,
  /\b(?:api[_ -]?key|authorization|password|secret|token|credential)\b\s*(?:[:=]|is)\s*["']?[A-Z0-9._~+/=-]{8,}/i,
];

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function object(value, label) {
  if (!isObject(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function exactInteger(value, expected, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value !== expected) {
    throw new Error(`${label} changed and requires a new source review.`);
  }
  return value;
}

function integer(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer.`);
  return value;
}

function text(value, label, maximum = 120) {
  if (typeof value !== 'string' || !value || value.length > maximum) {
    throw new Error(`${label} must be a bounded non-empty string.`);
  }
  return value;
}

function timestamp(value, label) {
  const parsed = text(value, label, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(parsed)
      || Number.isNaN(Date.parse(parsed))) {
    throw new Error(`${label} must be a valid UTC timestamp.`);
  }
  return parsed;
}

function apiName(value, label) {
  const parsed = text(value, label, 96);
  if (!API_NAME.test(parsed)) throw new Error(`${label} is not a safe API name.`);
  return parsed;
}

function assertNoSensitiveData(value) {
  if (Array.isArray(value)) {
    value.forEach(assertNoSensitiveData);
    return true;
  }
  if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
        throw new Error('Module replication catalog contains a forbidden sensitive key.');
      }
      assertNoSensitiveData(child);
    }
    return true;
  }
  if (typeof value === 'string' && FORBIDDEN_VALUE_PATTERNS.some(pattern => pattern.test(value))) {
    throw new Error('Module replication catalog contains a forbidden sensitive value.');
  }
  return true;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function exactStringArray(value, expected, label) {
  if (!Array.isArray(value) || value.length !== expected.length) {
    throw new Error(`${label} changed and requires a new source review.`);
  }
  const copied = value.map((item, index) => apiName(item, `${label}[${index}]`));
  if (copied.some((item, index) => item !== expected[index])) {
    throw new Error(`${label} changed and requires a new source review.`);
  }
  return copied;
}

function classificationRows(groups, classification) {
  const rows = groups[classification];
  const rule = CLASSIFICATION_RULES[classification];
  if (!Array.isArray(rows) || rows.length !== rule.expected_count) {
    throw new Error(`${classification} changed and requires a new source review.`);
  }
  return rows;
}

function validateGeneratedType(row, rule, label) {
  const generatedType = text(row.generated_type, `${label}.generated_type`, 40);
  if (!MODULE_TYPES.has(generatedType)) throw new Error(`${label}.generated_type is not recognized.`);
  const generated = GENERATED_TYPES.has(generatedType);
  if (rule.generated !== null && generated !== rule.generated) {
    throw new Error(`${label} is in the wrong generated-scope classification.`);
  }
  return { generatedType, generated };
}

function activeIdEvidence(row, rule, label) {
  const sourceCount = integer(row.source_count, `${label}.source_count`);
  const sourceActiveIds = integer(row.source_active_ids, `${label}.source_active_ids`);
  const localSourceActiveIds = integer(row.local_source_active_ids, `${label}.local_source_active_ids`);
  const countOnlyUnavailable = integer(row.count_only_unavailable, `${label}.count_only_unavailable`);
  const sourceOnlyActiveIds = integer(row.source_only_active_ids, `${label}.source_only_active_ids`);
  const localOnlyActiveIds = integer(row.local_only_active_ids, `${label}.local_only_active_ids`);
  const observedAt = timestamp(row.observed_at, `${label}.observed_at`);
  if (sourceCount !== sourceActiveIds + countOnlyUnavailable) {
    throw new Error(`${label} source count does not reconcile to active IDs plus the unavailable count-only scope.`);
  }
  if (sourceActiveIds !== localSourceActiveIds || sourceOnlyActiveIds !== 0 || localOnlyActiveIds !== 0) {
    throw new Error(`${label} does not establish exact active-ID parity.`);
  }
  if (rule.evidence === 'active_ids' && countOnlyUnavailable !== 0) {
    throw new Error(`${label} cannot be reconciled while count-only rows remain unavailable.`);
  }
  if (rule.evidence === 'active_ids_with_gap' && countOnlyUnavailable === 0) {
    throw new Error(`${label} must preserve its unresolved count-scope gap.`);
  }
  return {
    source_active_ids: sourceActiveIds,
    local_source_active_ids: localSourceActiveIds,
    count_only_unavailable: countOnlyUnavailable,
    source_only_active_ids: sourceOnlyActiveIds,
    local_only_active_ids: localOnlyActiveIds,
    observed_at: observedAt,
  };
}

function buildDataset(row, classification, rule, scheduledDatasets, epochs, index) {
  const label = `datasets_by_classification.${classification}[${index}]`;
  const input = object(row, label);
  const name = apiName(input.api_name, `${label}.api_name`);
  const { generatedType, generated } = validateGeneratedType(input, rule, label);
  let sourceCountObservation;
  let evidence = null;

  if (rule.evidence === 'unavailable') {
    if (!SOURCE_UNAVAILABLE_HTTP_STATUSES.has(input.http_status)) {
      throw new Error(`${label}.http_status is not an observed unavailable status.`);
    }
    if (Object.prototype.hasOwnProperty.call(input, 'source_count')) {
      throw new Error(`${label} must keep an unavailable source count null rather than inventing zero.`);
    }
    sourceCountObservation = {
      availability: 'unavailable',
      http_status: input.http_status,
      count: null,
      observed_at: epochs.module_count_capture_at,
    };
  } else {
    const sourceCount = integer(input.source_count, `${label}.source_count`);
    const observedAt = rule.evidence.startsWith('active_ids')
      ? timestamp(input.observed_at, `${label}.observed_at`)
      : epochs.module_count_capture_at;
    sourceCountObservation = {
      availability: 'observed_count',
      http_status: 200,
      count: sourceCount,
      observed_at: observedAt,
    };
    if (rule.evidence.startsWith('active_ids')) {
      evidence = activeIdEvidence(input, rule, label);
      if (evidence.observed_at !== observedAt) throw new Error(`${label} evidence epochs do not match.`);
    }
  }

  return {
    api_name: name,
    api_supported: true,
    generated_type: generatedType,
    generated,
    scheduled: scheduledDatasets.has(name),
    source_count_observation: sourceCountObservation,
    replication: {
      state: rule.state,
      classification,
      reason_code: rule.reason_code,
      active_id_evidence: evidence,
    },
  };
}

function buildModuleReplicationCatalog(raw = RAW_CATALOG) {
  const input = object(raw, 'module_replication_catalog');
  assertNoSensitiveData(input);
  exactInteger(input.schema_version, 1, 'schema_version');
  const observedAt = timestamp(input.observed_at, 'observed_at');
  if (input.source_mode !== 'read_only_captures') {
    throw new Error('source_mode changed and requires a new source review.');
  }

  const epochInput = object(input.evidence_epochs, 'evidence_epochs');
  const epochs = {
    module_count_capture_at: timestamp(epochInput.module_count_capture_at, 'evidence_epochs.module_count_capture_at'),
    task_generated_audit_at: timestamp(epochInput.task_generated_audit_at, 'evidence_epochs.task_generated_audit_at'),
    notes_audit_at: timestamp(epochInput.notes_audit_at, 'evidence_epochs.notes_audit_at'),
  };
  if (observedAt !== epochs.notes_audit_at) throw new Error('Catalog observation must match its latest evidence epoch.');

  const scopeInput = object(input.expected_scope, 'expected_scope');
  const scope = Object.fromEntries(Object.entries(EXPECTED_SCOPE).map(([key, expected]) => [
    key,
    exactInteger(scopeInput[key], expected, `expected_scope.${key}`),
  ]));
  if (scope.source_module_definition_count
      !== scope.api_supported_dataset_count + scope.api_unsupported_definition_count) {
    throw new Error('Source module definition counts do not reconcile.');
  }

  const scheduled = exactStringArray(input.scheduled_datasets, EXPECTED_SCHEDULED_DATASETS, 'scheduled_datasets');
  const scheduledDatasets = new Set(scheduled);
  if (scheduledDatasets.size !== scheduled.length) throw new Error('scheduled_datasets contains duplicates.');

  const groups = object(input.datasets_by_classification, 'datasets_by_classification');
  const groupKeys = Object.keys(groups).sort();
  const expectedGroupKeys = Object.keys(CLASSIFICATION_RULES).sort();
  if (groupKeys.length !== expectedGroupKeys.length
      || groupKeys.some((key, index) => key !== expectedGroupKeys[index])) {
    throw new Error('Dataset classification groups changed and require a new source review.');
  }

  const datasets = [];
  const classificationCounts = {};
  for (const [classification, rule] of Object.entries(CLASSIFICATION_RULES)) {
    const rows = classificationRows(groups, classification);
    classificationCounts[classification] = rows.length;
    rows.forEach((row, index) => datasets.push(buildDataset(
      row, classification, rule, scheduledDatasets, epochs, index,
    )));
  }

  if (datasets.length !== scope.api_supported_dataset_count) {
    throw new Error('The API-supported dataset catalog is incomplete.');
  }
  const names = new Set(datasets.map(dataset => dataset.api_name));
  if (names.size !== datasets.length) throw new Error('The API-supported dataset catalog contains duplicate API names.');
  for (const name of scheduledDatasets) {
    if (!names.has(name)) throw new Error(`Scheduled dataset ${name} is missing from the source catalog.`);
  }

  const scheduledCount = datasets.filter(dataset => dataset.scheduled).length;
  const unresolvedCount = datasets.filter(dataset => dataset.replication.state === 'unresolved').length;
  const reconciledCount = datasets.length - unresolvedCount;
  const unavailableCount = datasets.filter(dataset => dataset.source_count_observation.availability === 'unavailable').length;
  const observedCount = datasets.length - unavailableCount;
  const observedZeroCount = datasets.filter(dataset => dataset.source_count_observation.count === 0).length;
  const generatedCount = datasets.filter(dataset => dataset.generated).length;
  if (scheduledCount !== scope.scheduled_dataset_count
      || datasets.length - scheduledCount !== scope.unscheduled_dataset_count) {
    throw new Error('Scheduled and unscheduled dataset counts do not reconcile.');
  }
  if (reconciledCount !== 1 || unresolvedCount !== 121 || observedCount !== 37
      || unavailableCount !== 85 || observedZeroCount !== 12 || generatedCount !== 22) {
    throw new Error('Catalog evidence totals changed and require a new source review.');
  }
  if (datasets.some(dataset => dataset.source_count_observation.count === 0
      && dataset.replication.state !== 'unresolved')) {
    throw new Error('An observed zero count cannot establish replication parity.');
  }

  const output = {
    schema_version: 1,
    observed_at: observedAt,
    source_mode: 'read_only_captures',
    evidence_epochs: epochs,
    scope,
    summary: {
      classification_counts: classificationCounts,
      state_counts: { reconciled: reconciledCount, unresolved: unresolvedCount },
      source_count_observations: {
        observed: observedCount,
        unavailable: unavailableCount,
        observed_zero_but_unresolved: observedZeroCount,
      },
      generated_datasets: generatedCount,
      scheduled_datasets: scheduledCount,
      unscheduled_datasets: datasets.length - scheduledCount,
    },
    scheduled_datasets: scheduled,
    datasets,
  };
  assertNoSensitiveData(output);
  return deepFreeze(output);
}

const CATALOG = buildModuleReplicationCatalog(RAW_CATALOG);

function getModuleReplicationCatalog() {
  return CATALOG;
}

function getModuleReplicationDataset(name) {
  const key = apiName(name, 'api_name');
  return CATALOG.datasets.find(dataset => dataset.api_name === key) || null;
}

module.exports = {
  CLASSIFICATION_RULES,
  EXPECTED_SCHEDULED_DATASETS,
  EXPECTED_SCOPE,
  assertNoSensitiveData,
  buildModuleReplicationCatalog,
  getModuleReplicationCatalog,
  getModuleReplicationDataset,
};
