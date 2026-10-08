'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SourceDeletionReadinessError,
  buildSourceDeletionReadiness,
} = require('../lib/source-deletion-readiness');

const scheduled = ['Leads', 'Contacts', 'Notes'];
const documented = ['Leads', 'Contacts'];

test('reports the staged but unverified contract without exposing module keys', () => {
  const result = buildSourceDeletionReadiness({
    scheduledModules: scheduled,
    documentedModules: documented,
    engineImplemented: true,
    migrationStaged: true,
  });
  assert.deepEqual(result, {
    source_mode: 'read-only',
    classification: 'partial_refresh',
    reason_code: 'DELETION_ARCHIVE_CONTRACT_UNVERIFIED',
    coverage: {
      scheduled_record_modules: 3,
      documented_deleted_record_modules: 2,
      unsupported_scheduled_modules: 1,
    },
    readiness: {
      engine_implemented: true,
      migration_staged: true,
      contract_verified: false,
      lease_verified: false,
      baseline_ready_modules: 0,
      feature_enabled_modules: 0,
      runtime_executable: false,
      operationally_current: false,
    },
    operational_evidence: {
      last_successful_run_at: null,
      successful_through_modules: 0,
      maximum_age_minutes: 30,
    },
  });
  assert.equal(JSON.stringify(result).includes('Leads'), false);
  assert.equal(JSON.stringify(result).includes('Notes'), false);
});

test('requires every independent gate before declaring runtime executable', () => {
  const common = {
    scheduledModules: documented,
    documentedModules: documented,
    engineImplemented: true,
    migrationStaged: true,
    contractVerified: true,
    leaseVerified: true,
    baselineReadyModules: documented.length,
    featureEnabledModules: documented.length,
    operationalEvidence: {
      finished_at: '2026-08-30T11:50:00.000Z',
      global_success: true,
      module_summary: { total: 2, complete: 2, partial: 0, error: 0 },
      successful_through_modules: 2,
    },
    now: '2026-08-30T12:00:00.000Z',
  };
  const ready = buildSourceDeletionReadiness(common);
  assert.equal(ready.classification, 'reconciled_current');
  assert.equal(ready.reason_code, 'DELETION_RUNTIME_READY');
  assert.equal(ready.readiness.runtime_executable, true);

  const cases = [
    ['engineImplemented', false, 'DELETION_ENGINE_UNAVAILABLE'],
    ['migrationStaged', false, 'DELETION_ARCHIVE_CONTRACT_UNAVAILABLE'],
    ['contractVerified', false, 'DELETION_ARCHIVE_CONTRACT_UNVERIFIED'],
    ['leaseVerified', false, 'DELETION_LEASE_UNVERIFIED'],
    ['baselineReadyModules', 1, 'DELETION_BASELINE_REQUIRED'],
    ['featureEnabledModules', 1, 'DELETION_FEATURE_DISABLED'],
  ];
  for (const [field, value, reason] of cases) {
    const result = buildSourceDeletionReadiness({ ...common, [field]: value });
    assert.equal(result.readiness.runtime_executable, false, field);
    assert.equal(result.reason_code, reason, field);
  }
  const noRunEvidence = buildSourceDeletionReadiness({ ...common, operationalEvidence: null });
  assert.equal(noRunEvidence.readiness.runtime_executable, true);
  assert.equal(noRunEvidence.readiness.operationally_current, false);
  assert.equal(noRunEvidence.classification, 'partial_refresh');
  assert.equal(noRunEvidence.reason_code, 'DELETION_RUN_EVIDENCE_REQUIRED');
});

test('retains partial scope when a scheduled module lacks a documented deleted-record stream', () => {
  const result = buildSourceDeletionReadiness({
    scheduledModules: scheduled,
    documentedModules: documented,
    engineImplemented: true,
    migrationStaged: true,
    contractVerified: true,
    leaseVerified: true,
    baselineReadyModules: 2,
    featureEnabledModules: 2,
    operationalEvidence: {
      finished_at: '2026-08-30T11:50:00.000Z',
      global_success: true,
      module_summary: { total: 2, complete: 2, partial: 0, error: 0 },
      successful_through_modules: 2,
    },
    now: '2026-08-30T12:00:00.000Z',
  });
  assert.equal(result.readiness.runtime_executable, true);
  assert.equal(result.classification, 'partial_refresh');
  assert.equal(result.reason_code, 'DELETION_PARTIAL_MODULE_SCOPE');
});

test('rejects out-of-scope modules, malformed keys, and impossible counts', () => {
  assert.throws(
    () => buildSourceDeletionReadiness({ scheduledModules: ['Leads'], documentedModules: ['Contacts'] }),
    error => error instanceof SourceDeletionReadinessError && error.code === 'DOCUMENTED_SCOPE_MISMATCH',
  );
  assert.throws(
    () => buildSourceDeletionReadiness({ scheduledModules: ['Leads;drop'], documentedModules: [] }),
    error => error instanceof SourceDeletionReadinessError && error.code === 'INVALID_MODULE_SET',
  );
  assert.throws(
    () => buildSourceDeletionReadiness({
      scheduledModules: ['Leads'], documentedModules: ['Leads'], baselineReadyModules: 2,
    }),
    error => error instanceof SourceDeletionReadinessError && error.code === 'INVALID_READINESS_COUNT',
  );
  for (const invalid of [true, '1', null]) {
    assert.throws(
      () => buildSourceDeletionReadiness({
        scheduledModules: ['Leads'],
        documentedModules: ['Leads'],
        baselineReadyModules: invalid,
      }),
      error => error instanceof SourceDeletionReadinessError && error.code === 'INVALID_READINESS_COUNT',
    );
  }
  assert.throws(
    () => buildSourceDeletionReadiness({
      scheduledModules: ['Leads'], documentedModules: ['Leads'], maxRunAgeMs: '1800000',
    }),
    error => error instanceof SourceDeletionReadinessError && error.code === 'INVALID_OPERATIONAL_EVIDENCE',
  );
});
