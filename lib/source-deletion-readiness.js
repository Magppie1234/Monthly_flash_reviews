'use strict';

const MODULE_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

class SourceDeletionReadinessError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SourceDeletionReadinessError';
    this.code = code;
  }
}

function normalizeModules(values, label) {
  if (!Array.isArray(values)) {
    throw new SourceDeletionReadinessError('INVALID_MODULE_SET', `${label} must be an array.`);
  }
  const result = [];
  const seen = new Set();
  for (const value of values) {
    const moduleKey = String(value || '').trim();
    if (!MODULE_KEY_PATTERN.test(moduleKey)) {
      throw new SourceDeletionReadinessError('INVALID_MODULE_SET', `${label} contains an invalid module key.`);
    }
    if (!seen.has(moduleKey)) {
      seen.add(moduleKey);
      result.push(moduleKey);
    }
  }
  return result;
}

function safeCount(value, label, maximum) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new SourceDeletionReadinessError('INVALID_READINESS_COUNT', `${label} is outside the supported range.`);
  }
  return value;
}

function safeIso(value) {
  if (typeof value !== 'string' && !(value instanceof Date)) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function operationalStatus(evidence, documentedCount, now, maxRunAgeMs) {
  const finishedAt = safeIso(evidence?.finished_at);
  const throughModules = typeof evidence?.successful_through_modules === 'number'
    && Number.isSafeInteger(evidence.successful_through_modules)
    && evidence.successful_through_modules >= 0
    && evidence.successful_through_modules <= documentedCount
    ? evidence.successful_through_modules
    : 0;
  const summary = evidence?.module_summary || {};
  const exactSummary = evidence?.global_success === true
    && summary.total === documentedCount
    && summary.complete === documentedCount
    && summary.partial === 0
    && summary.error === 0;
  const observedAt = safeIso(now);
  const age = finishedAt && observedAt ? Date.parse(observedAt) - Date.parse(finishedAt) : Number.POSITIVE_INFINITY;
  const current = exactSummary && throughModules === documentedCount
    && age >= 0 && age <= maxRunAgeMs;
  return {
    current,
    finishedAt,
    throughModules,
  };
}

function buildSourceDeletionReadiness({
  scheduledModules = [],
  documentedModules = [],
  engineImplemented = false,
  migrationStaged = false,
  contractVerified = false,
  leaseVerified = false,
  baselineReadyModules = 0,
  featureEnabledModules = 0,
  operationalEvidence = null,
  now = new Date(),
  maxRunAgeMs = 30 * 60 * 1_000,
} = {}) {
  const scheduled = normalizeModules(scheduledModules, 'scheduledModules');
  const documented = normalizeModules(documentedModules, 'documentedModules');
  const scheduledSet = new Set(scheduled);
  if (documented.some(moduleKey => !scheduledSet.has(moduleKey))) {
    throw new SourceDeletionReadinessError(
      'DOCUMENTED_SCOPE_MISMATCH',
      'Documented deletion modules must be a subset of the scheduled record modules.',
    );
  }

  const documentedCount = documented.length;
  const baselineReady = safeCount(baselineReadyModules, 'baselineReadyModules', documentedCount);
  const featureEnabled = safeCount(featureEnabledModules, 'featureEnabledModules', documentedCount);
  if (typeof maxRunAgeMs !== 'number' || !Number.isSafeInteger(maxRunAgeMs)
      || maxRunAgeMs < 60_000 || maxRunAgeMs > 24 * 60 * 60 * 1_000 || !safeIso(now)) {
    throw new SourceDeletionReadinessError('INVALID_OPERATIONAL_EVIDENCE', 'Deletion run freshness settings are invalid.');
  }
  const operational = operationalStatus(operationalEvidence, documentedCount, now, maxRunAgeMs);
  const runtimeExecutable = engineImplemented === true
    && migrationStaged === true
    && contractVerified === true
    && leaseVerified === true
    && baselineReady === documentedCount
    && featureEnabled === documentedCount
    && documentedCount > 0;

  let reasonCode = documentedCount === scheduled.length
    ? 'DELETION_RUNTIME_READY'
    : 'DELETION_PARTIAL_MODULE_SCOPE';
  if (engineImplemented !== true) reasonCode = 'DELETION_ENGINE_UNAVAILABLE';
  else if (migrationStaged !== true) reasonCode = 'DELETION_ARCHIVE_CONTRACT_UNAVAILABLE';
  else if (contractVerified !== true) reasonCode = 'DELETION_ARCHIVE_CONTRACT_UNVERIFIED';
  else if (leaseVerified !== true) reasonCode = 'DELETION_LEASE_UNVERIFIED';
  else if (baselineReady !== documentedCount) reasonCode = 'DELETION_BASELINE_REQUIRED';
  else if (featureEnabled !== documentedCount) reasonCode = 'DELETION_FEATURE_DISABLED';
  else if (!operational.current) reasonCode = 'DELETION_RUN_EVIDENCE_REQUIRED';

  return {
    source_mode: 'read-only',
    classification: runtimeExecutable && operational.current
      && documentedCount === scheduled.length
      ? 'reconciled_current'
      : 'partial_refresh',
    reason_code: reasonCode,
    coverage: {
      scheduled_record_modules: scheduled.length,
      documented_deleted_record_modules: documentedCount,
      unsupported_scheduled_modules: Math.max(0, scheduled.length - documentedCount),
    },
    readiness: {
      engine_implemented: engineImplemented === true,
      migration_staged: migrationStaged === true,
      contract_verified: contractVerified === true,
      lease_verified: leaseVerified === true,
      baseline_ready_modules: baselineReady,
      feature_enabled_modules: featureEnabled,
      runtime_executable: runtimeExecutable,
      operationally_current: runtimeExecutable && operational.current,
    },
    operational_evidence: {
      last_successful_run_at: operational.finishedAt,
      successful_through_modules: operational.throughModules,
      maximum_age_minutes: Math.floor(maxRunAgeMs / 60_000),
    },
  };
}

module.exports = {
  SourceDeletionReadinessError,
  buildSourceDeletionReadiness,
};
