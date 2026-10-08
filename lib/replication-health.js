'use strict';

const HEALTH_SCHEMA_VERSION = 2;
const DEFAULT_SCOPE_COUNTS = Object.freeze({
  module_definitions: 153,
  api_supported_modules: 122,
  scheduled_record_modules: 16,
});
const RECONCILIATION_CLASSIFICATIONS = Object.freeze([
  'reconciled_current',
  'ahead_of_audit_recheck_required',
  'behind_source',
  'partial_refresh',
  'unsupported_scope',
]);
const EXCLUSION_REASON_CODES = Object.freeze({
  deletions: 'DELETIONS_NOT_DISCOVERED',
  attachments: 'ATTACHMENT_BODIES_NOT_IN_RECORD_DELTA',
  metadata: 'METADATA_NOT_IN_RECORD_DELTA',
  reports: 'REPORT_DEFINITIONS_AND_RESULTS_NOT_REPLICATED',
  dashboards: 'DASHBOARD_DEFINITIONS_AND_RESULTS_NOT_REPLICATED',
  child_datasets: 'GENERATED_CHILD_DATASETS_NOT_IN_RECORD_DELTA',
});

const FORBIDDEN_KEY_SEGMENTS = new Set([
  'id', 'ids', 'name', 'names', 'email', 'emails', 'phone', 'phones', 'mobile', 'mobiles',
  'url', 'urls', 'uri', 'uris', 'href', 'hash', 'hashes', 'sha', 'sha256', 'credential',
  'credentials', 'password', 'passwords', 'secret', 'secrets', 'token', 'tokens', 'body',
  'bodies', 'content', 'contents', 'payload', 'payloads', 'authorization', 'cookie', 'cookies',
  'filename', 'filenames', 'owner', 'owners', 'contact', 'contacts', 'customer', 'customers',
  'person', 'people', 'assignee', 'assignees',
]);

class ReplicationHealthError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ReplicationHealthError';
    this.code = code;
  }
}

function createBoundedSnapshotCache({
  load,
  degrade,
  freshTtlMs,
  fallbackRetryMs,
  responseWaitMs,
  queryTimeoutMs,
  now = Date.now,
} = {}) {
  if (typeof load !== 'function' || typeof degrade !== 'function') {
    throw new TypeError('load and degrade must be functions.');
  }
  for (const [label, value] of Object.entries({ freshTtlMs, fallbackRetryMs, responseWaitMs, queryTimeoutMs })) {
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} must be a positive integer.`);
  }
  if (typeof now !== 'function') throw new TypeError('now must be a function.');

  let cache = null;
  let degradedCache = null;
  let flight = null;

  function settleWithin(promise, timeoutMs) {
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve({ status: 'timeout' }), timeoutMs);
      promise.then(
        value => {
          clearTimeout(timer);
          resolve({ status: 'fulfilled', value });
        },
        () => {
          clearTimeout(timer);
          resolve({ status: 'rejected' });
        },
      );
    });
  }

  function start(generation) {
    if (flight?.generation === generation) return flight.promise;
    if (flight) flight.cancel();

    const controller = new AbortController();
    let cancelFlight;
    const cancellation = new Promise((resolve, reject) => { cancelFlight = reject; });
    const current = {
      generation,
      controller,
      promise: null,
      cancel() {
        controller.abort();
        cancelFlight(new Error('Snapshot load was invalidated.'));
      },
    };
    const timeout = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        controller.abort();
        reject(new Error('Snapshot load timed out.'));
      }, queryTimeoutMs);
      current.clearTimeout = () => clearTimeout(timer);
    });
    const loadPromise = Promise.resolve().then(() => load({ signal: controller.signal }));
    current.promise = Promise.race([loadPromise, timeout, cancellation])
      .then(value => {
        cache = { generation, storedAt: now(), value };
        if (degradedCache?.generation === generation) degradedCache = null;
        return value;
      })
      .finally(() => {
        current.clearTimeout();
        if (flight === current) flight = null;
      });
    flight = current;
    return current.promise;
  }

  async function get({ generation, fallback }) {
    if (!Number.isSafeInteger(generation) || generation < 0) {
      throw new TypeError('generation must be a non-negative safe integer.');
    }
    if (cache?.generation === generation) {
      if (now() - cache.storedAt >= freshTtlMs) start(generation).catch(() => {});
      return cache.value;
    }
    if (degradedCache?.generation === generation) {
      if (!flight && now() - degradedCache.storedAt >= fallbackRetryMs) {
        start(generation).catch(() => {});
      }
      return degradedCache.value;
    }
    const settled = await settleWithin(start(generation), responseWaitMs);
    if (settled.status === 'fulfilled') return settled.value;
    const value = degrade(cache?.value ?? fallback);
    degradedCache = { generation, storedAt: now(), value };
    return value;
  }

  function invalidate() {
    if (flight) flight.cancel();
    flight = null;
  }

  return Object.freeze({ get, invalidate });
}

function toSnakeCase(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function assertPrivacySafeString(value, path) {
  if (/\bhttps?:\/\/|\bwww\./i.test(value)) {
    throw new ReplicationHealthError('PUBLIC_PAYLOAD_UNSAFE', `${path} contains a URL-like value.`);
  }
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value)) {
    throw new ReplicationHealthError('PUBLIC_PAYLOAD_UNSAFE', `${path} contains an email-like value.`);
  }
  if (/^\+?[\d\s().-]{7,}$/.test(value) || /\b\d{12,}\b/.test(value)) {
    throw new ReplicationHealthError('PUBLIC_PAYLOAD_UNSAFE', `${path} contains an identifier or phone-like value.`);
  }
  if (/\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]+/i.test(value)
      || /\bsk-[A-Za-z0-9_-]{8,}\b/.test(value)
      || /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) {
    throw new ReplicationHealthError('PUBLIC_PAYLOAD_UNSAFE', `${path} contains a credential-like value.`);
  }
  if (/^[a-f0-9]{32,}$/i.test(value)) {
    throw new ReplicationHealthError('PUBLIC_PAYLOAD_UNSAFE', `${path} contains a hash-like value.`);
  }
  if (/^(?:\/Users\/|\/home\/|[A-Za-z]:\\)/.test(value)) {
    throw new ReplicationHealthError('PUBLIC_PAYLOAD_UNSAFE', `${path} contains a private path.`);
  }
}

function assertPrivacySafePublicPayload(value, path = '$', seen = new WeakSet()) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') {
    assertPrivacySafeString(value, path);
    return true;
  }
  if (typeof value !== 'object') return true;
  if (seen.has(value)) {
    throw new ReplicationHealthError('PUBLIC_PAYLOAD_UNSAFE', `${path} contains a circular reference.`);
  }
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPrivacySafePublicPayload(item, `${path}[${index}]`, seen));
    seen.delete(value);
    return true;
  }

  for (const [key, child] of Object.entries(value)) {
    const segments = toSnakeCase(key).split('_').filter(Boolean);
    if (segments.some(segment => FORBIDDEN_KEY_SEGMENTS.has(segment))) {
      throw new ReplicationHealthError('PUBLIC_PAYLOAD_UNSAFE', `${path}.${key} is not permitted in a public health payload.`);
    }
    assertPrivacySafePublicPayload(child, `${path}.${key}`, seen);
  }
  seen.delete(value);
  return true;
}

function finiteCount(value) {
  if (value === null || value === undefined || value === '') return null;
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

function strictFiniteCount(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function optionalIso(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function safeDatasetKey(value) {
  const key = String(value || '').trim();
  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)) {
    throw new ReplicationHealthError('INVALID_DATASET_KEY', 'Reconciliation dataset keys must use a safe API-name format.');
  }
  return key;
}

function classificationResult(classification, reasonCode) {
  return { classification, reason_code: reasonCode };
}

function classifyReconciliationEvidence(evidence = {}) {
  if (evidence.supported === false) {
    return classificationResult('unsupported_scope', 'DATASET_OUTSIDE_SUPPORTED_SCOPE');
  }
  if (['partial', 'error', 'failed'].includes(evidence.refreshStatus)) {
    return classificationResult('partial_refresh', 'REFRESH_NOT_COMPLETE');
  }

  const localCount = finiteCount(evidence.local?.count);
  const localObservedAt = optionalIso(evidence.local?.observedAt);
  const auditCount = finiteCount(evidence.audit?.count);
  const auditAt = optionalIso(evidence.audit?.at);
  const sourceRecheck = evidence.sourceRecheck;

  if (sourceRecheck && typeof sourceRecheck === 'object') {
    const sourceCount = finiteCount(sourceRecheck.count);
    const sourceRecheckAt = optionalIso(sourceRecheck.at);
    if (localCount === null || sourceCount === null || !sourceRecheckAt) {
      return classificationResult('partial_refresh', 'SOURCE_RECHECK_INCOMPLETE');
    }
    if (localCount < sourceCount) {
      return classificationResult('behind_source', 'LOCAL_COUNT_BEHIND_CURRENT_SOURCE');
    }
    if (localCount > sourceCount) {
      if (localObservedAt && Date.parse(localObservedAt) > Date.parse(sourceRecheckAt)) {
        return classificationResult('ahead_of_audit_recheck_required', 'LOCAL_COUNT_AHEAD_OF_SOURCE_RECHECK');
      }
      return classificationResult('partial_refresh', 'LOCAL_SOURCE_COUNT_MISMATCH');
    }
    if (sourceRecheck.exactIdParity !== true) {
      return classificationResult('partial_refresh', 'SOURCE_RECHECK_NOT_EXACT');
    }
    if (!localObservedAt) {
      return classificationResult('partial_refresh', 'LOCAL_OBSERVATION_EPOCH_MISSING');
    }
    const localEpoch = Date.parse(localObservedAt);
    const sourceEpoch = Date.parse(sourceRecheckAt);
    if (localEpoch > sourceEpoch) {
      return classificationResult('ahead_of_audit_recheck_required', 'LOCAL_OBSERVED_AFTER_SOURCE_RECHECK');
    }
    if (localEpoch !== sourceEpoch) {
      return classificationResult('partial_refresh', 'SOURCE_LOCAL_EPOCH_MISMATCH');
    }
    return classificationResult('reconciled_current', 'CURRENT_SOURCE_LOCAL_EXACT');
  }

  if (localCount === null || auditCount === null || !auditAt) {
    return classificationResult('partial_refresh', 'AUDIT_COMPARISON_INCOMPLETE');
  }
  if (localCount < auditCount) {
    return classificationResult('behind_source', 'LOCAL_COUNT_BEHIND_AUDITED_SOURCE');
  }
  if (localCount > auditCount) {
    return classificationResult('ahead_of_audit_recheck_required', 'LOCAL_COUNT_AHEAD_OF_FROZEN_AUDIT');
  }
  if (!localObservedAt || new Date(localObservedAt).getTime() > new Date(auditAt).getTime()) {
    return classificationResult('ahead_of_audit_recheck_required', 'FROZEN_AUDIT_RECHECK_REQUIRED');
  }
  if (evidence.audit?.exact === true) {
    return classificationResult('reconciled_current', 'AUDITED_SOURCE_LOCAL_EXACT');
  }
  return classificationResult('partial_refresh', 'AUDIT_NOT_EXACT');
}

function safeRunSummary(value) {
  if (!value || typeof value !== 'object') return null;
  const moduleSummary = value.module_summary || {};
  const total = finiteCount(moduleSummary.total);
  const complete = finiteCount(moduleSummary.complete);
  const partial = finiteCount(moduleSummary.partial);
  const error = finiteCount(moduleSummary.error);
  const startedAt = optionalIso(value.started_at);
  const finishedAt = optionalIso(value.finished_at);
  if ([total, complete, partial, error].includes(null) || !startedAt || !finishedAt) return null;
  const seenModules = new Set();
  const moduleResults = (Array.isArray(value.module_results) ? value.module_results : [])
    .map(item => {
      const moduleKey = String(item?.module_key || '').trim();
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(moduleKey) || seenModules.has(moduleKey)) return null;
      seenModules.add(moduleKey);
      const status = ['complete', 'partial', 'error'].includes(item?.status) ? item.status : 'error';
      const reasonCode = item?.reason_code === null || item?.reason_code === undefined
        ? null
        : String(item.reason_code);
      return {
        module_key: moduleKey,
        status,
        pages_scanned: finiteCount(item?.pages_scanned) ?? 0,
        discovered_changes: finiteCount(item?.discovered_changes),
        attempted_changes: finiteCount(item?.attempted_changes) ?? 0,
        processed_changes: finiteCount(item?.processed_changes) ?? 0,
        remaining_changes: finiteCount(item?.remaining_changes),
        cursor_advanced: item?.cursor_advanced === true,
        reason_code: /^[A-Z][A-Z0-9_]*$/.test(reasonCode || '') ? reasonCode : null,
      };
    })
    .filter(Boolean);
  const moduleResultsComplete = moduleResults.length === 0
    || (moduleResults.length === total && moduleResults.every(item => item.status === 'complete'));
  const structurallySuccessful = total > 0
    && complete === total
    && partial === 0
    && error === 0
    && moduleResultsComplete;
  const globalSuccess = value.global_success === true && structurallySuccessful;
  const budget = value.record_budget || {};
  const budgetLimit = finiteCount(budget.limit);
  const budgetAttempted = finiteCount(budget.attempted);
  const budgetProcessed = finiteCount(budget.processed);
  return {
    started_at: startedAt,
    finished_at: finishedAt,
    status: globalSuccess ? 'succeeded' : (total > 0 && error === total ? 'failed' : 'partial'),
    global_success: globalSuccess,
    module_summary: {
      total,
      complete,
      partial,
      error,
    },
    record_budget: budgetLimit === null || budgetAttempted === null || budgetProcessed === null
      ? null
      : {
        limit: budgetLimit,
        attempted: Math.min(budgetAttempted, budgetLimit),
        processed: Math.min(budgetProcessed, budgetAttempted, budgetLimit),
        remaining_capacity: Math.max(0, budgetLimit - Math.min(budgetAttempted, budgetLimit)),
      },
    module_results: moduleResults,
  };
}

function safeSchedule(schedule = {}, persistedState = {}) {
  const intervalMinutes = Number(schedule.intervalMinutes ?? schedule.interval_minutes ?? 15);
  const requestedSchedulerMode = schedule.schedulerMode ?? schedule.scheduler_mode;
  const schedulerMode = requestedSchedulerMode === 'vercel-cron' ? 'vercel-cron' : 'local-interval';
  const lastCompletedRun = safeRunSummary(persistedState.last_completed_run);
  const lastSuccessfulRun = safeRunSummary(persistedState.last_successful_run);
  return {
    enabled: schedule.enabled === true,
    started: schedule.started === true,
    running: schedule.running === true,
    scheduler_mode: schedulerMode,
    externally_scheduled: schedulerMode === 'vercel-cron' && schedule.externally_scheduled === true,
    execution_fenced: schedule.executionFenced === true || schedule.execution_fenced === true,
    state_available: schedule.stateAvailable !== false,
    interval_minutes: Number.isFinite(intervalMinutes) && intervalMinutes > 0 ? intervalMinutes : 15,
    next_run_at: optionalIso(schedule.nextRunAt ?? schedule.next_run_at),
    last_completed_run: lastCompletedRun,
    last_successful_run: lastSuccessfulRun?.global_success === true ? lastSuccessfulRun : null,
  };
}

function safeScopeCounts(catalog = {}, schedule = {}) {
  const moduleDefinitions = finiteCount(catalog.moduleDefinitions ?? catalog.module_definitions)
    ?? DEFAULT_SCOPE_COUNTS.module_definitions;
  const apiSupported = finiteCount(catalog.apiSupportedModules ?? catalog.api_supported_modules)
    ?? DEFAULT_SCOPE_COUNTS.api_supported_modules;
  const scheduled = finiteCount(schedule.scheduledRecordModules ?? schedule.scheduled_record_modules)
    ?? DEFAULT_SCOPE_COUNTS.scheduled_record_modules;
  const unscheduled = Math.max(0, apiSupported - scheduled);
  return {
    module_definitions: moduleDefinitions,
    api_supported_modules: apiSupported,
    scheduled_record_modules: scheduled,
    unscheduled_api_supported_modules: unscheduled,
    classification: scheduled < apiSupported ? 'partial_refresh' : 'reconciled_current',
  };
}

function publicReconciliationEvidence(evidence) {
  const verdict = classifyReconciliationEvidence(evidence);
  const exactAuditedSetMatch = evidence.sourceRecheck?.exactIdParity === true;
  return {
    dataset_key: safeDatasetKey(evidence.dataset ?? evidence.datasetKey),
    classification: verdict.classification,
    reason_code: verdict.reason_code,
    audit_at: optionalIso(evidence.audit?.at),
    audited_source_count: finiteCount(evidence.audit?.count),
    local_observed_at: optionalIso(evidence.local?.observedAt),
    current_local_count: finiteCount(evidence.local?.count),
    source_recheck_at: optionalIso(evidence.sourceRecheck?.at),
    current_source_count: finiteCount(evidence.sourceRecheck?.count),
    exact_source_local_parity: verdict.classification === 'reconciled_current' && exactAuditedSetMatch,
    current_matches_audited_set: exactAuditedSetMatch,
  };
}

function safeDeletionReplication(value, generatedAt) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const coverage = value.coverage || {};
  const readiness = value.readiness || {};
  const operationalEvidence = value.operational_evidence || {};
  const scheduled = strictFiniteCount(coverage.scheduled_record_modules);
  const documented = strictFiniteCount(coverage.documented_deleted_record_modules);
  const unsupported = strictFiniteCount(coverage.unsupported_scheduled_modules);
  if ([scheduled, documented, unsupported].includes(null)
      || documented > scheduled || unsupported !== scheduled - documented) {
    throw new ReplicationHealthError(
      'INVALID_DELETION_READINESS',
      'Deletion-replication coverage is inconsistent.',
    );
  }
  const baselineReady = strictFiniteCount(readiness.baseline_ready_modules);
  const featureEnabled = strictFiniteCount(readiness.feature_enabled_modules);
  if (baselineReady === null || featureEnabled === null
      || baselineReady > documented || featureEnabled > documented) {
    throw new ReplicationHealthError(
      'INVALID_DELETION_READINESS',
      'Deletion-replication readiness counts are inconsistent.',
    );
  }
  const engineImplemented = readiness.engine_implemented === true;
  const migrationStaged = readiness.migration_staged === true;
  const contractVerified = readiness.contract_verified === true;
  const leaseVerified = readiness.lease_verified === true;
  const successfulThroughModules = strictFiniteCount(operationalEvidence.successful_through_modules);
  const maximumAgeMinutes = strictFiniteCount(operationalEvidence.maximum_age_minutes);
  const lastSuccessfulRunAt = optionalIso(operationalEvidence.last_successful_run_at);
  if (successfulThroughModules === null || successfulThroughModules > documented
      || maximumAgeMinutes === null || maximumAgeMinutes < 1 || maximumAgeMinutes > 1_440) {
    throw new ReplicationHealthError(
      'INVALID_DELETION_READINESS',
      'Deletion-replication operational evidence is inconsistent.',
    );
  }
  const operationalAge = lastSuccessfulRunAt
    ? Date.parse(generatedAt) - Date.parse(lastSuccessfulRunAt)
    : Number.POSITIVE_INFINITY;
  const structurallyExecutable = documented > 0
    && engineImplemented && migrationStaged && contractVerified && leaseVerified
    && baselineReady === documented && featureEnabled === documented;
  const runtimeExecutable = readiness.runtime_executable === true && structurallyExecutable;
  const operationallyCurrent = runtimeExecutable
    && readiness.operationally_current === true
    && successfulThroughModules === documented
    && operationalAge >= 0
    && operationalAge <= maximumAgeMinutes * 60_000;
  const fullScope = runtimeExecutable && operationallyCurrent && documented === scheduled;
  const reasonCode = String(value.reason_code || '');
  return {
    source_mode: 'read-only',
    classification: fullScope ? 'reconciled_current' : 'partial_refresh',
    reason_code: /^[A-Z][A-Z0-9_]*$/.test(reasonCode) ? reasonCode : null,
    coverage: {
      scheduled_record_modules: scheduled,
      documented_deleted_record_modules: documented,
      unsupported_scheduled_modules: unsupported,
    },
    readiness: {
      engine_implemented: engineImplemented,
      migration_staged: migrationStaged,
      contract_verified: contractVerified,
      lease_verified: leaseVerified,
      baseline_ready_modules: baselineReady,
      feature_enabled_modules: featureEnabled,
      runtime_executable: runtimeExecutable,
      operationally_current: operationallyCurrent,
    },
    operational_evidence: {
      last_successful_run_at: lastSuccessfulRunAt,
      successful_through_modules: successfulThroughModules,
      maximum_age_minutes: maximumAgeMinutes,
    },
  };
}

function explicitExclusions(deletionReplication = null) {
  return Object.fromEntries(Object.entries(EXCLUSION_REASON_CODES).map(([scope, reasonCode]) => {
    if (scope === 'deletions' && deletionReplication) {
      const fullScope = deletionReplication.classification === 'reconciled_current';
      return [scope, {
        included: fullScope,
        classification: deletionReplication.classification,
        reason_code: deletionReplication.reason_code || reasonCode,
      }];
    }
    return [scope, {
      included: false,
      classification: 'unsupported_scope',
      reason_code: reasonCode,
    }];
  }));
}

function overallClassification({ coverage, reconciliation, schedule, deletionReplication = null }) {
  if (deletionReplication && deletionReplication.classification !== 'reconciled_current') return 'partial_refresh';
  if (schedule.state_available === false) return 'partial_refresh';
  if (reconciliation.some(item => item.classification === 'partial_refresh')) return 'partial_refresh';
  if (schedule.last_completed_run && schedule.last_completed_run.global_success !== true) return 'partial_refresh';
  if (reconciliation.some(item => item.classification === 'behind_source')) return 'behind_source';
  if (reconciliation.some(item => item.classification === 'ahead_of_audit_recheck_required')) {
    return 'ahead_of_audit_recheck_required';
  }
  if (coverage.classification === 'partial_refresh') return 'partial_refresh';
  if (reconciliation.length && reconciliation.every(item => item.classification === 'unsupported_scope')) {
    return 'unsupported_scope';
  }
  return 'reconciled_current';
}

function buildReplicationHealth({
  generatedAt = new Date(),
  catalog = {},
  schedule = {},
  persistedState = {},
  reconciliation = [],
  deletionReplication = null,
} = {}) {
  if (!Array.isArray(reconciliation)) {
    throw new TypeError('reconciliation must be an array.');
  }
  const generatedAtIso = optionalIso(generatedAt);
  if (!generatedAtIso) throw new ReplicationHealthError('INVALID_GENERATED_AT', 'generatedAt must be a valid timestamp.');

  const coverage = safeScopeCounts(catalog, schedule);
  const publicSchedule = safeSchedule(schedule, persistedState);
  const publicReconciliation = reconciliation.map(publicReconciliationEvidence);
  const publicDeletionReplication = safeDeletionReplication(deletionReplication, generatedAtIso);
  const result = {
    schema_version: HEALTH_SCHEMA_VERSION,
    generated_at: generatedAtIso,
    source_mode: 'read-only',
    overall_classification: overallClassification({
      coverage,
      reconciliation: publicReconciliation,
      schedule: publicSchedule,
      deletionReplication: publicDeletionReplication,
    }),
    coverage,
    schedule: publicSchedule,
    exclusions: explicitExclusions(publicDeletionReplication),
    reconciliation: publicReconciliation,
  };
  if (publicDeletionReplication) result.deletion_replication = publicDeletionReplication;
  assertPrivacySafePublicPayload(result);
  return result;
}

module.exports = {
  HEALTH_SCHEMA_VERSION,
  DEFAULT_SCOPE_COUNTS,
  RECONCILIATION_CLASSIFICATIONS,
  EXCLUSION_REASON_CODES,
  ReplicationHealthError,
  createBoundedSnapshotCache,
  classifyReconciliationEvidence,
  assertPrivacySafePublicPayload,
  buildReplicationHealth,
};
