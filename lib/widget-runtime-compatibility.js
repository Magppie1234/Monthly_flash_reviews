'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CONFIG_PATH = path.resolve(__dirname, '..', 'config', 'widget-runtime-compatibility.json');
const RAW_CONFIG = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

const EXPECTED_ARCHIVE_SET = Object.freeze({
  expected_packages: 12,
  captured_packages: 12,
  entries: 35,
  uncompressed_bytes: 734029,
  crc_reads_passed: true,
  path_traversal_detected: false,
  absolute_paths_detected: false,
  backslash_paths_detected: false,
  symbolic_links_detected: false,
  duplicate_entries_detected: false,
  sensitive_review_required_packages: 0,
  sensitive_review_completed_packages: 5,
});

const EXPECTED_SUMMARY = Object.freeze({
  captured_source_read_only_ready: 0,
  local_preview_candidates: 0,
  implemented_local_previews: 9,
  quarantined_packages: 3,
  quarantined_pending_sensitive_review: 0,
  quarantined_review_complete_contract_blocked: 3,
  full_local_ready: 0,
});

const EXPECTED_BOUNDARY = Object.freeze({
  captured_source_execution_enabled: false,
  source_writes_enabled: false,
  third_party_outbound_enabled: false,
  protected_value_use_enabled: false,
  preview_implementation: 'local-reimplementation-only',
  status: 'Fail closed',
});

const ALLOWED_TYPES = new Set(['Blueprint', 'Button']);
const ALLOWED_PREVIEW_CLASSIFICATIONS = new Set([
  'calculation-preview-candidate',
  'fixture-preview-candidate',
  'quarantined-pending-review',
  'quarantined-reviewed-contract-blocked',
]);
const ALLOWED_PREVIEW_RUNTIME_STATUSES = new Set([
  'candidate',
  'implemented-read-only',
  'quarantined',
]);
const IMPLEMENTED_READ_ONLY_WIDGET_IDS = new Set([
  '1032257000012167001',
  '1032257000023774783',
  '1032257000010677855',
  '1032257000007994308',
  '1032257000010720459',
  '1032257000025407208',
  '1032257000017358913',
  '1032257000022961582',
  '1032257000023117488',
]);
const IMPLEMENTED_READ_ONLY_CLASSIFICATIONS = new Map([
  ['1032257000012167001', 'calculation-preview-candidate'],
  ['1032257000023774783', 'fixture-preview-candidate'],
  ['1032257000010677855', 'fixture-preview-candidate'],
  ['1032257000007994308', 'fixture-preview-candidate'],
  ['1032257000010720459', 'fixture-preview-candidate'],
  ['1032257000025407208', 'fixture-preview-candidate'],
  ['1032257000017358913', 'fixture-preview-candidate'],
  ['1032257000022961582', 'fixture-preview-candidate'],
  ['1032257000023117488', 'fixture-preview-candidate'],
]);
const REVIEWED_CONTRACT_BLOCKED_WIDGET_IDS = new Set([
  '1032257000018181042',
  '1032257000020866834',
  '1032257000023270884',
]);
const SENSITIVE_REVIEW_COMPLETED_WIDGET_IDS = new Set([
  '1032257000018181042',
  '1032257000020866834',
  '1032257000022961582',
  '1032257000023117488',
  '1032257000023270884',
]);
const ALLOWED_NETWORK_PRIMITIVES = new Set(['fetch', 'xhr', 'zoho.crm.http']);
const ALLOWED_PROVIDERS = new Set([
  'zoho.accounts.oauth',
  'zoho.crm.read',
  'zoho.crm.write',
  'zoho.crm.blueprint',
  'zoho.crm.attachment',
  'zoho.crm.workflow',
  'zoho.crm.cross_org',
  'zoho.crm.user-directory',
  'zoho.workdrive.write',
  'zoho.workdrive.share',
]);
const ALLOWED_CAPABILITIES = new Set([
  'record.create',
  'record.update',
  'record.delete',
  'note.create',
  'attachment.write',
  'blueprint.transition',
  'user.identity',
  'atomic.multi_record',
  'relation.replace',
  'pricing.acceptance',
  'authorized.request',
]);
const FORBIDDEN_CONFIG_KEYS = new Set([
  'archive_name',
  'body',
  'code',
  'content',
  'credential',
  'credentials',
  'endpoint',
  'external_target',
  'file',
  'hash',
  'headers',
  'local_path',
  'password',
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
const FORBIDDEN_CONFIG_VALUES = [
  /https?:\/\//i,
  /\bwww\./i,
  /\/(?:Users|home|var|tmp|opt|etc)\//i,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\bbearer\s+[A-Z0-9._~+/=-]{8,}/i,
  /\b(?:api[_ -]?key|authorization|password|secret|token|credential)\b\s*(?:[:=]|is)\s*["']?[A-Z0-9._~+/=-]{8,}/i,
];

const SAFE_ERROR_MESSAGES = Object.freeze({
  ARCHIVE_INVALID: 'Widget archive metadata is invalid.',
  ARCHIVE_LIMIT_EXCEEDED: 'Widget archive exceeds a defensive size or entry limit.',
  ARCHIVE_PATH_UNSAFE: 'Widget archive contains an unsafe entry name.',
  ARCHIVE_DUPLICATE_ENTRY: 'Widget archive contains an ambiguous duplicate entry.',
  ARCHIVE_SPECIAL_FILE: 'Widget archive contains a disallowed special file.',
  ARCHIVE_COMPRESSION_UNSAFE: 'Widget archive has an unsafe compression ratio.',
  INPUT_INVALID: 'Widget runtime input is invalid.',
  WIDGET_NOT_FOUND: 'Widget runtime profile was not found.',
});

class WidgetRuntimePolicyError extends Error {
  constructor(code) {
    super(SAFE_ERROR_MESSAGES[code] || 'Widget runtime policy rejected the request.');
    this.name = 'WidgetRuntimePolicyError';
    this.code = code;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredObject(value, label) {
  if (!isPlainObject(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function requiredString(value, label, maxLength = 800) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new Error(`${label} must be a non-empty bounded string.`);
  }
  return value.trim();
}

function requiredBoolean(value, label) {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean.`);
  return value;
}

function requiredInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`);
  return value;
}

function assertNoSensitiveConfigData(value) {
  if (Array.isArray(value)) {
    value.forEach(assertNoSensitiveConfigData);
    return;
  }
  if (isPlainObject(value)) {
    Object.entries(value).forEach(([key, child]) => {
      if (FORBIDDEN_CONFIG_KEYS.has(key.toLowerCase())) {
        throw new Error('Widget runtime compatibility contains a forbidden sensitive key.');
      }
      assertNoSensitiveConfigData(child);
    });
    return;
  }
  if (typeof value === 'string' && FORBIDDEN_CONFIG_VALUES.some(pattern => pattern.test(value))) {
    throw new Error('Widget runtime compatibility contains a forbidden sensitive value.');
  }
}

function copyExactObject(value, expected, label) {
  const object = requiredObject(value, label);
  const output = {};
  Object.entries(expected).forEach(([key, expectedValue]) => {
    if (object[key] !== expectedValue) throw new Error(`${label}.${key} does not match audited evidence.`);
    output[key] = expectedValue;
  });
  return output;
}

function copyStringArray(value, label, options = {}) {
  const { maxItems = 40, allow = null, pattern = null } = options;
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`${label} must be a bounded array.`);
  const output = value.map((item, index) => requiredString(item, `${label}[${index}]`, 160));
  if (new Set(output).size !== output.length) throw new Error(`${label} must not contain duplicates.`);
  if (allow && output.some(item => !allow.has(item))) throw new Error(`${label} contains an unsupported value.`);
  if (pattern && output.some(item => !pattern.test(item))) throw new Error(`${label} contains an invalid value.`);
  return output;
}

function copyArchiveEvidence(value, label) {
  const evidence = requiredObject(value, label);
  return {
    entries: requiredInteger(evidence.entries, `${label}.entries`),
    uncompressed_bytes: requiredInteger(evidence.uncompressed_bytes, `${label}.uncompressed_bytes`),
    structure_safe: requiredBoolean(evidence.structure_safe, `${label}.structure_safe`),
    sensitive_literal_review_required: requiredBoolean(
      evidence.sensitive_literal_review_required,
      `${label}.sensitive_literal_review_required`,
    ),
    sensitive_literal_review_completed: requiredBoolean(
      evidence.sensitive_literal_review_completed,
      `${label}.sensitive_literal_review_completed`,
    ),
    network_literals_present: requiredBoolean(evidence.network_literals_present, `${label}.network_literals_present`),
  };
}

function copyWidget(value, index) {
  const label = `widgets[${index}]`;
  const widget = requiredObject(value, label);
  const id = requiredString(widget.id, `${label}.id`, 24);
  if (!/^\d{19}$/.test(id)) throw new Error(`${label}.id is invalid.`);
  const type = requiredString(widget.type, `${label}.type`, 40);
  if (!ALLOWED_TYPES.has(type)) throw new Error(`${label}.type is invalid.`);
  const previewClassification = requiredString(widget.preview_classification, `${label}.preview_classification`, 80);
  if (!ALLOWED_PREVIEW_CLASSIFICATIONS.has(previewClassification)) {
    throw new Error(`${label}.preview_classification is invalid.`);
  }
  const previewRuntimeStatus = requiredString(widget.preview_runtime_status, `${label}.preview_runtime_status`, 80);
  if (!ALLOWED_PREVIEW_RUNTIME_STATUSES.has(previewRuntimeStatus)) {
    throw new Error(`${label}.preview_runtime_status is invalid.`);
  }
  const archiveEvidence = copyArchiveEvidence(widget.archive_evidence, `${label}.archive_evidence`);
  if (!archiveEvidence.structure_safe || archiveEvidence.entries === 0 || archiveEvidence.uncompressed_bytes === 0) {
    throw new Error(`${label}.archive_evidence violates the safe captured-package boundary.`);
  }
  if (archiveEvidence.sensitive_literal_review_required && archiveEvidence.sensitive_literal_review_completed) {
    throw new Error(`${label} review state cannot be both pending and completed.`);
  }
  if (
    archiveEvidence.sensitive_literal_review_required !== (previewClassification === 'quarantined-pending-review')
    || archiveEvidence.sensitive_literal_review_completed !== SENSITIVE_REVIEW_COMPLETED_WIDGET_IDS.has(id)
    || REVIEWED_CONTRACT_BLOCKED_WIDGET_IDS.has(id) !== (previewClassification === 'quarantined-reviewed-contract-blocked')
  ) {
    throw new Error(`${label} review state is inconsistent.`);
  }
  const expectedRuntimeStatus = IMPLEMENTED_READ_ONLY_WIDGET_IDS.has(id)
    ? 'implemented-read-only'
    : previewClassification.startsWith('quarantined-')
      ? 'quarantined'
      : 'candidate';
  if (previewRuntimeStatus !== expectedRuntimeStatus) {
    throw new Error(`${label} preview runtime status does not match reviewed implementation evidence.`);
  }
  if (
    (previewRuntimeStatus === 'implemented-read-only' && IMPLEMENTED_READ_ONLY_CLASSIFICATIONS.get(id) !== previewClassification)
    || (previewRuntimeStatus === 'quarantined' && !previewClassification.startsWith('quarantined-'))
    || (previewRuntimeStatus === 'candidate' && previewClassification.startsWith('quarantined-'))
  ) {
    throw new Error(`${label} preview classification and runtime status are inconsistent.`);
  }
  if (widget.full_runtime_status !== 'blocked') throw new Error(`${label}.full_runtime_status must be blocked.`);
  const output = {
    id,
    name: requiredString(widget.name, `${label}.name`, 240),
    type,
    archive_evidence: archiveEvidence,
    observed_sdk_methods: copyStringArray(widget.observed_sdk_methods, `${label}.observed_sdk_methods`, {
      pattern: /^ZOHO\.CRM\.(?:API|BLUEPRINT|HTTP|META|UI)\.[A-Za-z_][A-Za-z0-9_]*$/,
    }),
    network_primitives: copyStringArray(widget.network_primitives, `${label}.network_primitives`, {
      allow: ALLOWED_NETWORK_PRIMITIVES,
    }),
    modules_read: copyStringArray(widget.modules_read, `${label}.modules_read`, {
      pattern: /^[A-Za-z][A-Za-z0-9_]*$/,
    }),
    modules_written: copyStringArray(widget.modules_written, `${label}.modules_written`, {
      pattern: /^[A-Za-z][A-Za-z0-9_]*$/,
    }),
    required_capabilities: copyStringArray(widget.required_capabilities, `${label}.required_capabilities`, {
      allow: ALLOWED_CAPABILITIES,
    }),
    provider_access: copyStringArray(widget.provider_access, `${label}.provider_access`, {
      allow: ALLOWED_PROVIDERS,
    }),
    third_party_providers: copyStringArray(widget.third_party_providers, `${label}.third_party_providers`),
    preview_classification: previewClassification,
    preview_runtime_status: previewRuntimeStatus,
    preview_rationale: requiredString(widget.preview_rationale, `${label}.preview_rationale`, 520),
    full_runtime_status: 'blocked',
  };
  if (output.modules_written.length === 0 || output.required_capabilities.length === 0) {
    throw new Error(`${label} does not preserve the observed mutation boundary.`);
  }
  if (output.third_party_providers.length !== 0) {
    throw new Error(`${label}.third_party_providers must remain empty until a provider is explicitly reviewed.`);
  }
  return output;
}

function validateDerivedCounts(output) {
  const { widgets } = output;
  if (widgets.length !== EXPECTED_ARCHIVE_SET.expected_packages) throw new Error('Widget profile count does not reconcile.');
  if (new Set(widgets.map(widget => widget.id)).size !== widgets.length) throw new Error('Widget IDs must be unique.');
  if (new Set(widgets.map(widget => widget.name.toLowerCase())).size !== widgets.length) {
    throw new Error('Widget names must be unique.');
  }
  const entries = widgets.reduce((sum, widget) => sum + widget.archive_evidence.entries, 0);
  const bytes = widgets.reduce((sum, widget) => sum + widget.archive_evidence.uncompressed_bytes, 0);
  const pendingSensitiveReview = widgets.filter(widget => widget.archive_evidence.sensitive_literal_review_required).length;
  const completedSensitiveReview = widgets.filter(widget => widget.archive_evidence.sensitive_literal_review_completed).length;
  const reviewedContractBlocked = widgets.filter(widget => widget.preview_classification === 'quarantined-reviewed-contract-blocked').length;
  const previewCandidates = widgets.filter(widget => widget.preview_runtime_status === 'candidate').length;
  const implementedPreviews = widgets.filter(widget => widget.preview_runtime_status === 'implemented-read-only').length;
  const statusQuarantined = widgets.filter(widget => widget.preview_runtime_status === 'quarantined').length;
  if (
    entries !== output.archive_set.entries
    || bytes !== output.archive_set.uncompressed_bytes
    || pendingSensitiveReview !== output.archive_set.sensitive_review_required_packages
    || completedSensitiveReview !== output.archive_set.sensitive_review_completed_packages
    || previewCandidates !== output.summary.local_preview_candidates
    || implementedPreviews !== output.summary.implemented_local_previews
    || statusQuarantined !== output.summary.quarantined_packages
    || pendingSensitiveReview !== output.summary.quarantined_pending_sensitive_review
    || reviewedContractBlocked !== output.summary.quarantined_review_complete_contract_blocked
    || statusQuarantined !== pendingSensitiveReview + reviewedContractBlocked
    || previewCandidates + implementedPreviews + statusQuarantined !== widgets.length
  ) {
    throw new Error('Derived widget runtime evidence does not reconcile.');
  }
}

function buildWidgetRuntimeCompatibility(rawConfig) {
  assertNoSensitiveConfigData(rawConfig);
  const raw = requiredObject(rawConfig, 'widget runtime compatibility');
  if (raw.schema_version !== 1) throw new Error('Widget runtime compatibility schema is unsupported.');
  if (raw.source_mode !== 'offline-static-analysis') throw new Error('Widget source mode must remain offline static analysis.');
  const output = {
    schema_version: 1,
    generated_at: requiredString(raw.generated_at, 'generated_at', 80),
    source_mode: 'offline-static-analysis',
    analysis_boundary: requiredString(raw.analysis_boundary, 'analysis_boundary', 320),
    archive_set: copyExactObject(raw.archive_set, EXPECTED_ARCHIVE_SET, 'archive_set'),
    execution_boundary: copyExactObject(raw.execution_boundary, EXPECTED_BOUNDARY, 'execution_boundary'),
    summary: copyExactObject(raw.summary, EXPECTED_SUMMARY, 'summary'),
    widgets: Array.isArray(raw.widgets) ? raw.widgets.map(copyWidget) : [],
  };
  validateDerivedCounts(output);
  assertNoSensitiveConfigData(output);
  return output;
}

function getWidgetRuntimeCompatibility() {
  return buildWidgetRuntimeCompatibility(RAW_CONFIG);
}

function getWidgetProfile(reference, config = getWidgetRuntimeCompatibility()) {
  if (typeof reference !== 'string' || !reference.trim() || reference.length > 240) {
    throw new WidgetRuntimePolicyError('INPUT_INVALID');
  }
  const normalized = reference.trim().toLowerCase();
  const widget = config.widgets.find(item => item.id === reference.trim() || item.name.toLowerCase() === normalized);
  if (!widget) throw new WidgetRuntimePolicyError('WIDGET_NOT_FOUND');
  return widget;
}

function boundedStringSet(value, label) {
  if (value === undefined) return new Set();
  const items = value instanceof Set ? [...value] : value;
  if (!Array.isArray(items) || items.length > 240) throw new WidgetRuntimePolicyError('INPUT_INVALID');
  const output = new Set();
  items.forEach(item => {
    if (typeof item !== 'string' || !item || item.length > 160) throw new WidgetRuntimePolicyError('INPUT_INVALID');
    output.add(item);
  });
  return output;
}

function blocker(code, message) {
  return { code, message };
}

function preflightWidgetRuntime(reference, options = {}) {
  if (!isPlainObject(options)) throw new WidgetRuntimePolicyError('INPUT_INVALID');
  const config = getWidgetRuntimeCompatibility();
  const widget = getWidgetProfile(reference, config);
  const mode = options.mode === undefined ? 'captured-source' : options.mode;
  if (!['captured-source', 'local-preview', 'full-local'].includes(mode)) {
    throw new WidgetRuntimePolicyError('INPUT_INVALID');
  }
  const localModules = boundedStringSet(options.localModules, 'localModules');
  const availableCapabilities = boundedStringSet(options.availableCapabilities, 'availableCapabilities');
  const fixtures = options.fixtures === undefined ? 'none' : options.fixtures;
  const writeGuard = options.writeGuard === undefined ? 'deny' : options.writeGuard;
  const networkGuard = options.networkGuard === undefined ? 'deny' : options.networkGuard;
  const useCapturedSource = options.useCapturedSource === true;
  if (!['none', 'reviewed'].includes(fixtures) || !['deny', 'allow'].includes(writeGuard) || !['deny', 'allow'].includes(networkGuard)) {
    throw new WidgetRuntimePolicyError('INPUT_INVALID');
  }

  const blockers = [];
  const missingModules = widget.modules_read.filter(moduleName => !localModules.has(moduleName));
  const missingCapabilities = widget.required_capabilities.filter(capability => !availableCapabilities.has(capability));

  if (mode === 'captured-source') {
    blockers.push(blocker(
      'CAPTURED_SOURCE_EXECUTION_DISABLED',
      'Captured widget code is evidence only and may not execute in the local CRM.',
    ));
    blockers.push(blocker(
      'SOURCE_MUTATION_HANDLERS_PRESENT',
      'The captured package contains record, file, or Blueprint mutation behavior.',
    ));
    if (widget.archive_evidence.network_literals_present || widget.network_primitives.length > 0) {
      blockers.push(blocker(
        'NETWORK_BOUNDARY_REQUIRED',
        'The captured package includes network-facing behavior that is not permitted locally.',
      ));
    }
    if (widget.archive_evidence.sensitive_literal_review_required) {
      blockers.push(blocker(
        'SENSITIVE_REVIEW_REQUIRED',
        'Sensitive-shaped literals require review without exposing matched values.',
      ));
    }
  } else if (mode === 'local-preview') {
    if (useCapturedSource) {
      blockers.push(blocker(
        'REIMPLEMENTATION_REQUIRED',
        'Local preview must use a reviewed reimplementation, not captured source code.',
      ));
    }
    if (writeGuard !== 'deny') {
      blockers.push(blocker('WRITE_GUARD_REQUIRED', 'Local preview requires an enforced deny-all write guard.'));
    }
    if (networkGuard !== 'deny') {
      blockers.push(blocker('NETWORK_GUARD_REQUIRED', 'Local preview requires an enforced deny-all outbound guard.'));
    }
    if (widget.archive_evidence.sensitive_literal_review_required) {
      blockers.push(blocker(
        'SENSITIVE_REVIEW_REQUIRED',
        'A bounded review must approve the reimplementation inputs before preview is available.',
      ));
    }
    if (widget.preview_classification === 'quarantined-reviewed-contract-blocked') {
      blockers.push(blocker(
        'PREVIEW_CONTRACT_INCOMPLETE',
        'Reviewed evidence does not prove the exact binding, provider, data, identity, or transactional contract required for a safe local preview.',
      ));
    }
    if (missingModules.length > 0 && fixtures !== 'reviewed') {
      blockers.push(blocker(
        'MODULE_DATA_UNAVAILABLE',
        'Required local read data is unavailable and no reviewed fixture set was supplied.',
      ));
    }
  } else {
    blockers.push(blocker(
      'SOURCE_WRITES_DISABLED',
      'Full widget execution remains disabled because source writes are outside the local safety boundary.',
    ));
    if (missingCapabilities.length > 0) {
      blockers.push(blocker(
        'CAPABILITIES_UNAVAILABLE',
        'One or more required transactional capabilities are unavailable.',
      ));
    }
    if (widget.provider_access.length > 0) {
      blockers.push(blocker(
        'PROVIDER_ACCESS_DISABLED',
        'Required CRM provider access is not enabled for widget execution.',
      ));
    }
  }

  return {
    widget: { id: widget.id, name: widget.name, type: widget.type },
    mode,
    allowed: blockers.length === 0,
    classification: mode === 'local-preview' ? widget.preview_classification : 'blocked',
    implementation: mode === 'local-preview' ? 'local-reimplementation-only' : 'disabled',
    source_code_execution: false,
    source_writes: false,
    outbound_network: false,
    data_source: mode === 'local-preview' && blockers.length === 0
      ? (missingModules.length === 0 ? 'local-mirror' : 'reviewed-fixtures')
      : 'none',
    missing_modules: missingModules,
    missing_capabilities: mode === 'full-local' ? missingCapabilities : [],
    required_capabilities: [...widget.required_capabilities],
    provider_access: [...widget.provider_access],
    blockers,
  };
}

function validateArchiveEntryMetadata(entries, options = {}) {
  if (!Array.isArray(entries) || !isPlainObject(options)) throw new WidgetRuntimePolicyError('ARCHIVE_INVALID');
  const limits = {
    maxEntries: options.maxEntries === undefined ? 200 : options.maxEntries,
    maxTotalBytes: options.maxTotalBytes === undefined ? 5 * 1024 * 1024 : options.maxTotalBytes,
    maxEntryBytes: options.maxEntryBytes === undefined ? 2 * 1024 * 1024 : options.maxEntryBytes,
    maxCompressionRatio: options.maxCompressionRatio === undefined ? 200 : options.maxCompressionRatio,
  };
  if (
    !Number.isInteger(limits.maxEntries) || limits.maxEntries < 1
    || !Number.isInteger(limits.maxTotalBytes) || limits.maxTotalBytes < 1
    || !Number.isInteger(limits.maxEntryBytes) || limits.maxEntryBytes < 1
    || typeof limits.maxCompressionRatio !== 'number' || !Number.isFinite(limits.maxCompressionRatio)
    || limits.maxCompressionRatio < 1
  ) {
    throw new WidgetRuntimePolicyError('ARCHIVE_INVALID');
  }
  if (entries.length === 0 || entries.length > limits.maxEntries) {
    throw new WidgetRuntimePolicyError('ARCHIVE_LIMIT_EXCEEDED');
  }
  let totalBytes = 0;
  let regularFiles = 0;
  const canonicalNames = new Set();
  for (const entry of entries) {
    if (!isPlainObject(entry) || typeof entry.name !== 'string' || !entry.name || entry.name.length > 512) {
      throw new WidgetRuntimePolicyError('ARCHIVE_INVALID');
    }
    const name = entry.name;
    if (
      name.includes('\0')
      || name.includes('\\')
      || name.startsWith('/')
      || /^[A-Za-z]:/.test(name)
      || name.includes('//')
      || /%(?:2e|2f|5c)/i.test(name)
    ) {
      throw new WidgetRuntimePolicyError('ARCHIVE_PATH_UNSAFE');
    }
    const parts = name.split('/');
    const meaningfulParts = name.endsWith('/') ? parts.slice(0, -1) : parts;
    if (meaningfulParts.some(part => !part || part === '.' || part === '..')) {
      throw new WidgetRuntimePolicyError('ARCHIVE_PATH_UNSAFE');
    }
    const canonicalName = name.normalize('NFC').toLowerCase();
    if (canonicalNames.has(canonicalName)) throw new WidgetRuntimePolicyError('ARCHIVE_DUPLICATE_ENTRY');
    canonicalNames.add(canonicalName);

    const kind = entry.kind === undefined ? (name.endsWith('/') ? 'directory' : 'file') : entry.kind;
    if (!['file', 'directory'].includes(kind)) throw new WidgetRuntimePolicyError('ARCHIVE_SPECIAL_FILE');
    if (entry.unixMode !== undefined) {
      if (!Number.isInteger(entry.unixMode) || entry.unixMode < 0) throw new WidgetRuntimePolicyError('ARCHIVE_INVALID');
      const fileType = entry.unixMode & 0o170000;
      if (fileType && fileType !== 0o100000 && fileType !== 0o040000) {
        throw new WidgetRuntimePolicyError('ARCHIVE_SPECIAL_FILE');
      }
    }
    const uncompressedBytes = entry.uncompressedBytes === undefined ? 0 : entry.uncompressedBytes;
    const compressedBytes = entry.compressedBytes === undefined ? uncompressedBytes : entry.compressedBytes;
    if (
      !Number.isInteger(uncompressedBytes) || uncompressedBytes < 0
      || !Number.isInteger(compressedBytes) || compressedBytes < 0
    ) {
      throw new WidgetRuntimePolicyError('ARCHIVE_INVALID');
    }
    if (kind === 'directory' && uncompressedBytes !== 0) throw new WidgetRuntimePolicyError('ARCHIVE_INVALID');
    if (uncompressedBytes > limits.maxEntryBytes) throw new WidgetRuntimePolicyError('ARCHIVE_LIMIT_EXCEEDED');
    if (kind === 'file') {
      regularFiles += 1;
      totalBytes += uncompressedBytes;
      if (
        uncompressedBytes > 64 * 1024
        && (compressedBytes === 0 || uncompressedBytes / compressedBytes > limits.maxCompressionRatio)
      ) {
        throw new WidgetRuntimePolicyError('ARCHIVE_COMPRESSION_UNSAFE');
      }
    }
    if (totalBytes > limits.maxTotalBytes) throw new WidgetRuntimePolicyError('ARCHIVE_LIMIT_EXCEEDED');
  }
  if (regularFiles === 0) throw new WidgetRuntimePolicyError('ARCHIVE_INVALID');
  return {
    entries: entries.length,
    regular_files: regularFiles,
    uncompressed_bytes: totalBytes,
    path_safety: 'passed',
    special_file_safety: 'passed',
    compression_safety: 'passed',
  };
}

function scanTextForSensitiveShapes(value, options = {}) {
  if (!isPlainObject(options)) throw new WidgetRuntimePolicyError('INPUT_INVALID');
  const maxBytes = options.maxBytes === undefined ? 2 * 1024 * 1024 : options.maxBytes;
  if (!Number.isInteger(maxBytes) || maxBytes < 1) throw new WidgetRuntimePolicyError('INPUT_INVALID');
  let text;
  if (Buffer.isBuffer(value)) {
    if (value.length > maxBytes) throw new WidgetRuntimePolicyError('INPUT_INVALID');
    text = value.toString('utf8');
  } else if (typeof value === 'string') {
    if (Buffer.byteLength(value, 'utf8') > maxBytes) throw new WidgetRuntimePolicyError('INPUT_INVALID');
    text = value;
  } else {
    throw new WidgetRuntimePolicyError('INPUT_INVALID');
  }
  const detectors = [
    ['private_key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i],
    ['authorization_value', /\bbearer\s+[A-Z0-9._~+/=-]{8,}/i],
    ['protected_assignment', /\b(?:api[_ -]?key|authorization|password|secret|token|credential)\b\s*(?:[:=]|is)\s*["']?[A-Z0-9._~+/=-]{8,}/i],
    ['email_address', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i],
  ];
  const categories = detectors.filter(([, pattern]) => pattern.test(text)).map(([category]) => category);
  return {
    review_required: categories.length > 0,
    categories,
    matched_values_exposed: false,
  };
}

module.exports = {
  WidgetRuntimePolicyError,
  buildWidgetRuntimeCompatibility,
  getWidgetRuntimeCompatibility,
  getWidgetProfile,
  preflightWidgetRuntime,
  scanTextForSensitiveShapes,
  validateArchiveEntryMetadata,
};
