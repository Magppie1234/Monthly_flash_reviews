'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CONFIG_PATH = path.resolve(__dirname, '..', 'config', 'source-setup-ui-evidence.json');
const RAW_COVERAGE = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

const VERIFIED_EMPTY_MODULES = Object.freeze([
  'Leads', 'Products', 'Quotes', 'SalesOrders', 'PurchaseOrders', 'Invoices', 'Campaigns', 'Vendors',
]);
const RATE_LIMITED_MODULES = Object.freeze([
  'Contacts', 'Tasks', 'Potentials', 'Accounts', 'Events', 'Calls',
]);
const NOT_YET_AUDITED_MODULES = Object.freeze([
  'PriceBooks', 'Cases', 'Solutions', 'Visits', 'Services', 'Appointments', 'CustomModule4',
  'CustomModule5', 'CustomModule6', 'CustomModule7', 'CustomModule8', 'CustomModule9',
  'LinkingModule14', 'CustomModule10',
]);
const UNRESOLVED_MODULES = Object.freeze([...RATE_LIMITED_MODULES, ...NOT_YET_AUDITED_MODULES]);

const FORBIDDEN_KEYS = new Set([
  'api_key', 'authorization', 'cookie', 'credential', 'credentials', 'email', 'endpoint',
  'first_name', 'full_name', 'last_name', 'mobile', 'password', 'phone', 'private_path',
  'secret', 'source_id', 'token', 'url', 'user_name',
]);
const FORBIDDEN_VALUE_PATTERNS = [
  /https?:\/\//i,
  /\bwww\./i,
  /\/(?:Users|home|var|tmp|opt|etc)\//i,
  /\.private\//i,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\bbearer\s+[A-Z0-9._~+/=-]{8,}/i,
  /\b(?:api[_ -]?key|authorization|password|secret|token|credential)\b\s*(?:[:=]|is)\s*["']?[A-Z0-9._~+/=-]{8,}/i,
  /\b\d{15,25}\b/,
];

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function object(value, label) {
  if (!isObject(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function text(value, label, maxLength = 1200) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new Error(`${label} must be a bounded non-empty string.`);
  }
  return value.trim();
}

function integer(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`);
  return value;
}

function boolean(value, label) {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean.`);
  return value;
}

function exact(value, expected, label) {
  if (value !== expected) throw new Error(`${label} changed and requires a new source review.`);
  return value;
}

function exactStringArray(value, expected, label) {
  if (!Array.isArray(value) || value.length !== expected.length) {
    throw new Error(`${label} changed and requires a new source review.`);
  }
  const copied = value.map((item, index) => text(item, `${label}[${index}]`, 80));
  if (copied.some((item, index) => item !== expected[index])) {
    throw new Error(`${label} changed and requires a new source review.`);
  }
  return copied;
}

function assertNoSensitiveData(value) {
  if (Array.isArray(value)) {
    value.forEach(assertNoSensitiveData);
    return;
  }
  if (isObject(value)) {
    Object.entries(value).forEach(([key, child]) => {
      if (FORBIDDEN_KEYS.has(key.toLowerCase())) throw new Error('Setup-process evidence contains a forbidden sensitive key.');
      assertNoSensitiveData(child);
    });
    return;
  }
  if (typeof value === 'string' && FORBIDDEN_VALUE_PATTERNS.some(pattern => pattern.test(value))) {
    throw new Error('Setup-process evidence contains a forbidden sensitive value.');
  }
}

function buildSetupProcessCoverage(raw = RAW_COVERAGE) {
  const input = object(raw, 'setup_process_coverage');
  assertNoSensitiveData(input);
  exact(integer(input.schema_version, 'schema_version'), 1, 'schema_version');
  const observedAt = text(input.observed_at, 'observed_at', 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(observedAt) || Number.isNaN(Date.parse(observedAt))) {
    throw new Error('observed_at must be a valid UTC timestamp.');
  }

  const scope = object(input.evidence_scope, 'evidence_scope');
  const evidenceScope = {
    source_mode: exact(text(scope.source_mode, 'evidence_scope.source_mode'), 'authenticated_read_only_ui', 'evidence_scope.source_mode'),
    source_contacted: exact(boolean(scope.source_contacted, 'evidence_scope.source_contacted'), true, 'evidence_scope.source_contacted'),
    mutation_attempted: exact(boolean(scope.mutation_attempted, 'evidence_scope.mutation_attempted'), false, 'evidence_scope.mutation_attempted'),
    source_mutations: exact(boolean(scope.source_mutations, 'evidence_scope.source_mutations'), false, 'evidence_scope.source_mutations'),
    local_mutations: exact(boolean(scope.local_mutations, 'evidence_scope.local_mutations'), false, 'evidence_scope.local_mutations'),
    configured_module_count: exact(integer(scope.configured_module_count, 'evidence_scope.configured_module_count'), 28, 'evidence_scope.configured_module_count'),
  };

  const pipelinesInput = object(input.pipelines, 'pipelines');
  const pipelines = {
    status: exact(text(pipelinesInput.status, 'pipelines.status'), 'Verified empty', 'pipelines.status'),
    definitions_observed: exact(integer(pipelinesInput.definitions_observed, 'pipelines.definitions_observed'), 0, 'pipelines.definitions_observed'),
    evidence: text(pipelinesInput.evidence, 'pipelines.evidence'),
  };

  const approvalsInput = object(input.approval_processes, 'approval_processes');
  const approvalProcesses = {
    status: exact(text(approvalsInput.status, 'approval_processes.status'), 'Verified empty', 'approval_processes.status'),
    definitions_observed: exact(integer(approvalsInput.definitions_observed, 'approval_processes.definitions_observed'), 0, 'approval_processes.definitions_observed'),
    evidence: text(approvalsInput.evidence, 'approval_processes.evidence'),
  };

  const validationInput = object(input.validation_rules, 'validation_rules');
  const verifiedEmptyModules = exactStringArray(validationInput.verified_empty_modules, VERIFIED_EMPTY_MODULES, 'validation_rules.verified_empty_modules');
  const unresolvedModules = exactStringArray(validationInput.unresolved_modules, UNRESOLVED_MODULES, 'validation_rules.unresolved_modules');
  const rateLimitedModules = exactStringArray(validationInput.rate_limited_modules, RATE_LIMITED_MODULES, 'validation_rules.rate_limited_modules');
  const notYetAuditedModules = exactStringArray(validationInput.not_yet_audited_modules, NOT_YET_AUDITED_MODULES, 'validation_rules.not_yet_audited_modules');
  const validationRules = {
    status: exact(text(validationInput.status, 'validation_rules.status'), 'Partially verified empty', 'validation_rules.status'),
    configured_module_count: exact(integer(validationInput.configured_module_count, 'validation_rules.configured_module_count'), 28, 'validation_rules.configured_module_count'),
    verified_empty_module_count: exact(integer(validationInput.verified_empty_module_count, 'validation_rules.verified_empty_module_count'), verifiedEmptyModules.length, 'validation_rules.verified_empty_module_count'),
    verified_empty_modules: verifiedEmptyModules,
    unresolved_module_count: exact(integer(validationInput.unresolved_module_count, 'validation_rules.unresolved_module_count'), unresolvedModules.length, 'validation_rules.unresolved_module_count'),
    unresolved_modules: unresolvedModules,
    rate_limited_modules: rateLimitedModules,
    not_yet_audited_modules: notYetAuditedModules,
    evidence: text(validationInput.evidence, 'validation_rules.evidence'),
  };
  if (new Set([...verifiedEmptyModules, ...unresolvedModules]).size !== 28) {
    throw new Error('Validation-rule module classifications must be disjoint and complete.');
  }
  const reasons = [...rateLimitedModules, ...notYetAuditedModules];
  if (new Set(reasons).size !== reasons.length || reasons.some((module, index) => module !== unresolvedModules[index])) {
    throw new Error('Unresolved validation-rule reasons must reconcile to the unresolved module list.');
  }

  const boundaryInput = object(input.execution_boundary, 'execution_boundary');
  const executionBoundary = {
    source_equivalence: exact(text(boundaryInput.source_equivalence, 'execution_boundary.source_equivalence'), 'Partial', 'execution_boundary.source_equivalence'),
    verified_empty_behavior: text(boundaryInput.verified_empty_behavior, 'execution_boundary.verified_empty_behavior'),
    unresolved_behavior: exact(text(boundaryInput.unresolved_behavior, 'execution_boundary.unresolved_behavior'), 'Deny', 'execution_boundary.unresolved_behavior'),
    refresh_requirement: text(boundaryInput.refresh_requirement, 'execution_boundary.refresh_requirement'),
  };

  const output = {
    schema_version: 1,
    observed_at: observedAt,
    evidence_scope: evidenceScope,
    pipelines,
    approval_processes: approvalProcesses,
    validation_rules: validationRules,
    execution_boundary: executionBoundary,
  };
  assertNoSensitiveData(output);
  return output;
}

function getSetupProcessCoverage() {
  return buildSetupProcessCoverage(RAW_COVERAGE);
}

module.exports = {
  NOT_YET_AUDITED_MODULES,
  RATE_LIMITED_MODULES,
  UNRESOLVED_MODULES,
  VERIFIED_EMPTY_MODULES,
  assertNoSensitiveData,
  buildSetupProcessCoverage,
  getSetupProcessCoverage,
};
