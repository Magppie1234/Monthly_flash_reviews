'use strict';

const fs = require('node:fs');
const path = require('node:path');

const INVENTORY_PATH = path.resolve(__dirname, '..', 'config', 'widget-behavior-inventory.json');
const RAW_INVENTORY = JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf8'));

const EXPECTED_RECONCILIATION = Object.freeze({
  source_widget_rows: 40,
  zoho_hosted_widgets: 20,
  external_hosted_widgets: 20,
  expected_zoho_packages: 20,
  captured_zoho_packages: 20,
  validated_zoho_packages: 20,
  unmatched_zoho_packages: 0,
  external_packages_unavailable: 20,
  status: 'Reconciled',
});

const EXPECTED_TYPE_SUMMARY = Object.freeze({
  Blueprint: 19,
  Button: 16,
  'Home Page Dashboard': 3,
  Settings: 1,
  'Web Tab': 1,
});

const EXPECTED_ARCHIVE_SAFETY = Object.freeze({
  crc_test: 'Passed',
  path_traversal: 'None detected',
  absolute_paths: 'None detected',
  backslash_paths: 'None detected',
  symbolic_links: 'None detected',
  duplicate_entries: 'None detected',
  size_limits: 'Passed',
  regular_files: 38,
  total_uncompressed_bytes: 1109175,
  maximum_entries_in_one_package: 4,
  maximum_uncompressed_bytes_in_one_package: 126247,
});

const ALLOWED_TYPES = new Set(Object.keys(EXPECTED_TYPE_SUMMARY));
const FORBIDDEN_KEYS = new Set([
  'archive_name',
  'body',
  'code',
  'connection',
  'connections',
  'content',
  'credential',
  'credentials',
  'endpoint',
  'external_identifier',
  'external_identifiers',
  'external_url',
  'file',
  'hash',
  'headers',
  'local_path',
  'path',
  'secret',
  'secrets',
  'sha256',
  'source_body',
  'source_code',
  'token',
  'tokens',
  'url',
  'urls',
]);

const FORBIDDEN_VALUE_PATTERNS = [
  /https?:\/\//i,
  /\bwww\./i,
  /\/(?:Users|home|var|tmp|opt|etc)\//i,
  /\.private\//i,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\bbearer\s+[A-Z0-9._~+/=-]{8,}/i,
  /\b(?:api[_ -]?key|authorization|password|secret|token|credential)\b\s*(?:[:=]|is)\s*["']?[A-Z0-9._~+/=-]{8,}/i,
  /\b[A-F0-9]{32,128}\b/i,
];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertNoSensitiveData(value) {
  if (Array.isArray(value)) {
    value.forEach(assertNoSensitiveData);
    return;
  }
  if (isPlainObject(value)) {
    Object.entries(value).forEach(([key, child]) => {
      if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
        throw new Error('Widget behavior inventory contains a forbidden sensitive key.');
      }
      assertNoSensitiveData(child);
    });
    return;
  }
  if (typeof value === 'string' && FORBIDDEN_VALUE_PATTERNS.some(pattern => pattern.test(value))) {
    throw new Error('Widget behavior inventory contains a forbidden sensitive value.');
  }
}

function requiredObject(value, label) {
  if (!isPlainObject(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function requiredString(value, label, maxLength = 1600) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new Error(`${label} must be a non-empty bounded string.`);
  }
  return value.trim();
}

function requiredBoolean(value, label) {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean.`);
  return value;
}

function requiredNonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`);
  return value;
}

function stringArray(value, label, maxItems = 80) {
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`${label} must be a bounded array.`);
  return value.map((item, index) => requiredString(item, `${label}[${index}]`, 1200));
}

function copyExactObject(value, expected, label) {
  const object = requiredObject(value, label);
  const output = {};
  Object.entries(expected).forEach(([key, expectedValue]) => {
    if (object[key] !== expectedValue) throw new Error(`${label}.${key} does not match the reconciled value.`);
    output[key] = expectedValue;
  });
  return output;
}

function copyPackage(value, captured, label) {
  const pkg = requiredObject(value, label);
  if (pkg.captured !== captured) throw new Error(`${label}.captured does not match source hosting.`);
  const output = {
    captured,
    match_basis: requiredString(pkg.match_basis, `${label}.match_basis`, 320),
    archive_validation: requiredString(pkg.archive_validation, `${label}.archive_validation`, 120),
    static_analysis: requiredString(pkg.static_analysis, `${label}.static_analysis`, 320),
  };
  if (captured) {
    if (output.archive_validation !== 'Passed') throw new Error(`${label}.archive_validation must be Passed.`);
    if (output.static_analysis !== 'Completed without executing widget code') {
      throw new Error(`${label}.static_analysis does not preserve the offline execution boundary.`);
    }
    output.entries = requiredNonNegativeInteger(pkg.entries, `${label}.entries`);
    output.regular_files = requiredNonNegativeInteger(pkg.regular_files, `${label}.regular_files`);
    output.uncompressed_bytes = requiredNonNegativeInteger(pkg.uncompressed_bytes, `${label}.uncompressed_bytes`);
    if (output.entries === 0 || output.regular_files === 0 || output.uncompressed_bytes === 0) {
      throw new Error(`${label} must contain validated archive content.`);
    }
  } else if (output.archive_validation !== 'Not applicable') {
    throw new Error(`${label}.archive_validation must remain Not applicable for external hosting.`);
  }
  return output;
}

function copyBehavior(value, label) {
  const behavior = requiredObject(value, label);
  return {
    purpose: requiredString(behavior.purpose, `${label}.purpose`),
    context_modules: stringArray(behavior.context_modules, `${label}.context_modules`),
    modules_read: stringArray(behavior.modules_read, `${label}.modules_read`),
    modules_written: stringArray(behavior.modules_written, `${label}.modules_written`),
    record_actions: stringArray(behavior.record_actions, `${label}.record_actions`),
    mandatory_input_status: requiredString(behavior.mandatory_input_status, `${label}.mandatory_input_status`, 240),
    mandatory_inputs: stringArray(behavior.mandatory_inputs, `${label}.mandatory_inputs`),
    dependencies: stringArray(behavior.dependencies, `${label}.dependencies`),
    local_equivalent_feasibility: requiredString(behavior.local_equivalent_feasibility, `${label}.local_equivalent_feasibility`, 120),
    local_blockers: stringArray(behavior.local_blockers, `${label}.local_blockers`),
    mapping_confidence: requiredString(behavior.mapping_confidence, `${label}.mapping_confidence`, 120),
  };
}

function copyLocalExecution(value, label) {
  const execution = requiredObject(value, label);
  const output = {
    status: requiredString(execution.status, `${label}.status`, 80),
    enabled: requiredBoolean(execution.enabled, `${label}.enabled`),
    fail_closed: requiredBoolean(execution.fail_closed, `${label}.fail_closed`),
    reason: requiredString(execution.reason, `${label}.reason`, 600),
  };
  if (output.status !== 'Blocked' || output.enabled !== false || output.fail_closed !== true) {
    throw new Error(`${label} violates the fail-closed execution boundary.`);
  }
  return output;
}

function copyWidget(value, index) {
  const widget = requiredObject(value, `widgets[${index}]`);
  const id = requiredString(widget.id, `widgets[${index}].id`, 24);
  if (!/^\d{19}$/.test(id)) throw new Error(`widgets[${index}].id is invalid.`);
  const hosting = requiredString(widget.hosting, `widgets[${index}].hosting`, 16);
  if (hosting !== 'Zoho' && hosting !== 'External') throw new Error(`widgets[${index}].hosting is invalid.`);
  const type = requiredString(widget.type, `widgets[${index}].type`, 80);
  if (!ALLOWED_TYPES.has(type)) throw new Error(`widgets[${index}].type is invalid.`);
  return {
    id,
    name: requiredString(widget.name, `widgets[${index}].name`, 240),
    source_display_name: requiredString(widget.source_display_name, `widgets[${index}].source_display_name`, 240),
    hosting,
    type,
    package: copyPackage(widget.package, hosting === 'Zoho', `widgets[${index}].package`),
    behavior: copyBehavior(widget.behavior, `widgets[${index}].behavior`),
    local_execution: copyLocalExecution(widget.local_execution, `widgets[${index}].local_execution`),
  };
}

function copyExecutionBoundary(value) {
  const boundary = requiredObject(value, 'execution_boundary');
  const output = {
    local_widget_execution_enabled: requiredBoolean(boundary.local_widget_execution_enabled, 'execution_boundary.local_widget_execution_enabled'),
    source_widget_execution_enabled: requiredBoolean(boundary.source_widget_execution_enabled, 'execution_boundary.source_widget_execution_enabled'),
    source_writes_enabled: requiredBoolean(boundary.source_writes_enabled, 'execution_boundary.source_writes_enabled'),
    outbound_delivery_enabled: requiredBoolean(boundary.outbound_delivery_enabled, 'execution_boundary.outbound_delivery_enabled'),
    status: requiredString(boundary.status, 'execution_boundary.status', 80),
    reason: requiredString(boundary.reason, 'execution_boundary.reason', 600),
  };
  if (
    output.local_widget_execution_enabled !== false
    || output.source_widget_execution_enabled !== false
    || output.source_writes_enabled !== false
    || output.outbound_delivery_enabled !== false
    || output.status !== 'Blocked'
  ) {
    throw new Error('Widget execution boundary must remain fully fail-closed.');
  }
  return output;
}

function copyPrivacy(value) {
  const privacy = requiredObject(value, 'privacy');
  const keys = [
    'widget_code_exposed',
    'external_targets_exposed',
    'archive_hashes_exposed',
    'local_paths_exposed',
    'credentials_exposed',
    'personally_identifiable_information_exposed',
  ];
  return Object.fromEntries(keys.map(key => {
    const exposed = requiredBoolean(privacy[key], `privacy.${key}`);
    if (exposed) throw new Error(`privacy.${key} must remain false.`);
    return [key, false];
  }));
}

function validateDerivedCoverage(widgets) {
  const ids = new Set(widgets.map(widget => widget.id));
  if (ids.size !== EXPECTED_RECONCILIATION.source_widget_rows) throw new Error('Widget IDs are not unique and reconciled.');
  const zoho = widgets.filter(widget => widget.hosting === 'Zoho');
  const external = widgets.filter(widget => widget.hosting === 'External');
  const captured = widgets.filter(widget => widget.package.captured);
  const validated = widgets.filter(widget => widget.package.archive_validation === 'Passed');
  if (
    widgets.length !== EXPECTED_RECONCILIATION.source_widget_rows
    || zoho.length !== EXPECTED_RECONCILIATION.zoho_hosted_widgets
    || external.length !== EXPECTED_RECONCILIATION.external_hosted_widgets
    || captured.length !== EXPECTED_RECONCILIATION.captured_zoho_packages
    || validated.length !== EXPECTED_RECONCILIATION.validated_zoho_packages
  ) {
    throw new Error('Derived widget coverage does not reconcile to the exact source counts.');
  }
  Object.entries(EXPECTED_TYPE_SUMMARY).forEach(([type, expected]) => {
    if (widgets.filter(widget => widget.type === type).length !== expected) {
      throw new Error('Derived widget type coverage does not reconcile.');
    }
  });
}

function buildWidgetBehaviorInventory(rawInventory) {
  assertNoSensitiveData(rawInventory);
  const raw = requiredObject(rawInventory, 'widget inventory');
  if (raw.schema_version !== 1) throw new Error('Widget inventory schema version is unsupported.');
  if (raw.source_mode !== 'read-only') throw new Error('Widget inventory source mode must remain read-only.');
  const widgets = Array.isArray(raw.widgets) ? raw.widgets.map(copyWidget) : [];
  validateDerivedCoverage(widgets);
  const output = {
    schema_version: 1,
    generated_at: requiredString(raw.generated_at, 'generated_at', 80),
    source_mode: 'read-only',
    analysis_mode: requiredString(raw.analysis_mode, 'analysis_mode', 320),
    reconciliation: copyExactObject(raw.reconciliation, EXPECTED_RECONCILIATION, 'reconciliation'),
    archive_safety: copyExactObject(raw.archive_safety, EXPECTED_ARCHIVE_SAFETY, 'archive_safety'),
    type_summary: copyExactObject(raw.type_summary, EXPECTED_TYPE_SUMMARY, 'type_summary'),
    execution_boundary: copyExecutionBoundary(raw.execution_boundary),
    privacy: copyPrivacy(raw.privacy),
    widgets,
  };
  assertNoSensitiveData(output);
  return output;
}

function getWidgetBehaviorInventory() {
  return buildWidgetBehaviorInventory(RAW_INVENTORY);
}

module.exports = {
  buildWidgetBehaviorInventory,
  getWidgetBehaviorInventory,
};
