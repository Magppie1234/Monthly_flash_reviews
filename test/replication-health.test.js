'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EXCLUSION_REASON_CODES,
  ReplicationHealthError,
  assertPrivacySafePublicPayload,
  buildReplicationHealth,
  classifyReconciliationEvidence,
  createBoundedSnapshotCache,
} = require('../lib/replication-health');

const generatedAt = '2026-08-30T12:00:00.000Z';

function exactEvidence(dataset, count) {
  return {
    dataset,
    supported: true,
    refreshStatus: 'complete',
    audit: {
      at: '2026-08-29T12:00:00.000Z',
      count: count - 5,
      exact: true,
    },
    local: {
      observedAt: '2026-08-30T11:59:00.000Z',
      count,
    },
    sourceRecheck: {
      at: '2026-08-30T11:59:00.000Z',
      count,
      exactIdParity: true,
    },
  };
}

test('a local count ahead of a frozen audit requests a source recheck instead of reporting drift', () => {
  const verdict = classifyReconciliationEvidence({
    supported: true,
    refreshStatus: 'complete',
    audit: { at: '2026-08-29T10:00:00.000Z', count: 67_793, exact: true },
    local: { observedAt: '2026-08-30T10:00:00.000Z', count: 67_798 },
  });
  assert.deepEqual(verdict, {
    classification: 'ahead_of_audit_recheck_required',
    reason_code: 'LOCAL_COUNT_AHEAD_OF_FROZEN_AUDIT',
  });
});

test('fresh exact source/local rechecks classify the current Notes and Tasks evidence as reconciled', () => {
  const notes = classifyReconciliationEvidence(exactEvidence('Notes', 67_798));
  const tasks = classifyReconciliationEvidence(exactEvidence('Tasks', 12_422));
  assert.equal(notes.classification, 'reconciled_current');
  assert.equal(tasks.classification, 'reconciled_current');
  assert.equal(notes.reason_code, 'CURRENT_SOURCE_LOCAL_EXACT');
});

test('a later local observation requires a new same-epoch source recheck', () => {
  const laterLocal = exactEvidence('Notes', 67_798);
  laterLocal.local.observedAt = '2026-08-30T12:00:00.000Z';
  assert.deepEqual(classifyReconciliationEvidence(laterLocal), {
    classification: 'ahead_of_audit_recheck_required',
    reason_code: 'LOCAL_OBSERVED_AFTER_SOURCE_RECHECK',
  });

  laterLocal.sourceRecheck.digestComparedAt = laterLocal.local.observedAt;
  assert.deepEqual(classifyReconciliationEvidence(laterLocal), {
    classification: 'ahead_of_audit_recheck_required',
    reason_code: 'LOCAL_OBSERVED_AFTER_SOURCE_RECHECK',
  });
});

test('behind, partial, unsupported, and count-only evidence remain distinct truthful states', () => {
  const behind = classifyReconciliationEvidence({
    supported: true,
    refreshStatus: 'complete',
    local: { count: 12_417 },
    sourceRecheck: { at: generatedAt, count: 12_422, exactIdParity: true },
  });
  const partial = classifyReconciliationEvidence({
    supported: true,
    refreshStatus: 'partial',
    local: { count: 12_422 },
    sourceRecheck: { at: generatedAt, count: 12_422, exactIdParity: true },
  });
  const unsupported = classifyReconciliationEvidence({ supported: false });
  const countOnly = classifyReconciliationEvidence({
    supported: true,
    refreshStatus: 'complete',
    local: { count: 4_737 },
    sourceRecheck: { at: generatedAt, count: 4_737, exactIdParity: false },
  });

  assert.equal(behind.classification, 'behind_source');
  assert.equal(partial.classification, 'partial_refresh');
  assert.equal(unsupported.classification, 'unsupported_scope');
  assert.deepEqual(countOnly, {
    classification: 'partial_refresh',
    reason_code: 'SOURCE_RECHECK_NOT_EXACT',
  });
});

test('missing aggregate counts remain unavailable and are never coerced to zero', () => {
  const health = buildReplicationHealth({
    generatedAt,
    reconciliation: [{
      dataset: 'Notes',
      supported: true,
      refreshStatus: 'partial',
      audit: { at: generatedAt, count: 67_798, exact: true },
      local: { observedAt: null, count: null },
      sourceRecheck: null,
    }],
  });
  assert.equal(health.reconciliation[0].current_local_count, null);
  assert.equal(health.reconciliation[0].audited_source_count, 67_798);
  assert.equal(health.reconciliation[0].classification, 'partial_refresh');
});

test('public health shows 16 scheduled of 122 API-supported modules and all explicit exclusions', () => {
  const health = buildReplicationHealth({
    generatedAt,
    catalog: { moduleDefinitions: 153, apiSupportedModules: 122 },
    schedule: {
      enabled: true,
      started: true,
      running: false,
      intervalMinutes: 15,
      scheduledRecordModules: 16,
      nextRunAt: '2026-08-30T12:15:00.000Z',
    },
    reconciliation: [exactEvidence('Notes', 67_798), exactEvidence('Tasks', 12_422)],
  });

  assert.deepEqual(health.coverage, {
    module_definitions: 153,
    api_supported_modules: 122,
    scheduled_record_modules: 16,
    unscheduled_api_supported_modules: 106,
    classification: 'partial_refresh',
  });
  assert.equal(health.schedule.interval_minutes, 15);
  assert.equal(health.overall_classification, 'partial_refresh');
  assert.deepEqual(Object.keys(health.exclusions).sort(), Object.keys(EXCLUSION_REASON_CODES).sort());
  assert.ok(Object.values(health.exclusions).every(item => (
    item.included === false && item.classification === 'unsupported_scope'
  )));
  assert.deepEqual(
    health.reconciliation.map(item => [item.dataset_key, item.current_local_count, item.current_source_count, item.classification]),
    [
      ['Notes', 67_798, 67_798, 'reconciled_current'],
      ['Tasks', 12_422, 12_422, 'reconciled_current'],
    ],
  );
});

test('only aggregate persisted run state is public and a partial module prevents global success', () => {
  const persistedState = {
    schema_version: 1,
    modules: {
      Leads: {
        cursor: {
          modified_time: '2026-08-30T11:00:00.000Z',
          record_id: '1032257000026160092',
        },
      },
    },
    last_completed_run: {
      started_at: '2026-08-30T11:45:00.000Z',
      finished_at: '2026-08-30T11:46:00.000Z',
      status: 'partial',
      global_success: false,
      module_summary: { total: 16, complete: 15, partial: 1, error: 0 },
      record_budget: { limit: 60, attempted: 60, processed: 59, remaining_capacity: 0 },
      module_results: [{
        module_key: 'Leads',
        status: 'partial',
        pages_scanned: 2,
        discovered_changes: 9,
        attempted_changes: 4,
        processed_changes: 3,
        remaining_changes: 6,
        cursor_advanced: true,
        reason_code: 'RECORD_FETCH_FAILED',
      }],
      modules: { Leads: { reason_code: 'RECORD_FETCH_FAILED' } },
    },
    last_successful_run: {
      started_at: '2026-08-30T11:30:00.000Z',
      finished_at: '2026-08-30T11:31:00.000Z',
      status: 'succeeded',
      global_success: true,
      module_summary: { total: 16, complete: 16, partial: 0, error: 0 },
    },
  };
  const health = buildReplicationHealth({
    generatedAt,
    schedule: { enabled: true, started: true, scheduledRecordModules: 16 },
    persistedState,
    reconciliation: [exactEvidence('Notes', 67_798)],
  });

  assert.equal(health.schedule.last_completed_run.global_success, false);
  assert.equal(health.schedule.last_successful_run.global_success, true);
  assert.deepEqual(health.schedule.last_completed_run.record_budget, {
    limit: 60,
    attempted: 60,
    processed: 59,
    remaining_capacity: 0,
  });
  assert.deepEqual(health.schedule.last_completed_run.module_results, [{
    module_key: 'Leads',
    status: 'partial',
    pages_scanned: 2,
    discovered_changes: 9,
    attempted_changes: 4,
    processed_changes: 3,
    remaining_changes: 6,
    cursor_advanced: true,
    reason_code: 'RECORD_FETCH_FAILED',
  }]);
  assert.equal(health.overall_classification, 'partial_refresh');
  const serialized = JSON.stringify(health);
  assert.equal(serialized.includes('1032257000026160092'), false);
  assert.equal(serialized.includes('record_id'), false);
  assert.equal(serialized.includes('modules\":{'), false);
});

test('an inconsistent persisted success flag is downgraded when any module is partial', () => {
  const health = buildReplicationHealth({
    generatedAt,
    schedule: { enabled: true, started: true, scheduledRecordModules: 16 },
    persistedState: {
      last_completed_run: {
        started_at: '2026-08-30T11:45:00.000Z',
        finished_at: '2026-08-30T11:46:00.000Z',
        status: 'succeeded',
        global_success: true,
        module_summary: { total: 16, complete: 15, partial: 1, error: 0 },
      },
      last_successful_run: {
        started_at: '2026-08-30T11:45:00.000Z',
        finished_at: '2026-08-30T11:46:00.000Z',
        status: 'succeeded',
        global_success: true,
        module_summary: { total: 16, complete: 15, partial: 1, error: 0 },
      },
    },
    reconciliation: [exactEvidence('Notes', 67_798)],
  });

  assert.equal(health.schedule.last_completed_run.global_success, false);
  assert.equal(health.schedule.last_completed_run.status, 'partial');
  assert.equal(health.schedule.last_successful_run, null);
  assert.equal(health.overall_classification, 'partial_refresh');
});

test('privacy guard rejects identifiers, names, contacts, URLs, hashes, credentials, and bodies', () => {
  const unsafePayloads = [
    { record_id: '1032257000026160092' },
    { owner_name: 'Private Person' },
    { email: 'private@example.com' },
    { phone: '+91 98765 43210' },
    { link: 'https://private.example/path' },
    { digest: 'a'.repeat(64) },
    { credential: 'Bearer private-token-value' },
    { response_body: 'private source body' },
  ];
  for (const payload of unsafePayloads) {
    assert.throws(
      () => assertPrivacySafePublicPayload(payload),
      error => error instanceof ReplicationHealthError && error.code === 'PUBLIC_PAYLOAD_UNSAFE',
    );
  }
});

test('the built public payload passes recursive privacy validation', () => {
  const health = buildReplicationHealth({
    generatedAt,
    schedule: { enabled: true, started: true, intervalMinutes: 15, scheduledRecordModules: 16 },
    reconciliation: [exactEvidence('Notes', 67_798), exactEvidence('Tasks', 12_422)],
  });
  assert.equal(assertPrivacySafePublicPayload(health), true);
  const serialized = JSON.stringify(health);
  for (const fragment of ['record_id', 'owner_name', '@', 'http://', 'https://', 'Bearer ', 'response_body']) {
    assert.equal(serialized.includes(fragment), false);
  }
});

test('deletion readiness is aggregate-only and cannot overstate an unverified staged runtime', () => {
  const health = buildReplicationHealth({
    generatedAt,
    schedule: { enabled: true, started: true, scheduledRecordModules: 16 },
    deletionReplication: {
      source_mode: 'read-only',
      classification: 'reconciled_current',
      reason_code: 'DELETION_ARCHIVE_CONTRACT_UNVERIFIED',
      coverage: {
        scheduled_record_modules: 16,
        documented_deleted_record_modules: 15,
        unsupported_scheduled_modules: 1,
      },
      readiness: {
        engine_implemented: true,
        migration_staged: true,
        contract_verified: false,
        lease_verified: false,
        baseline_ready_modules: 0,
        feature_enabled_modules: 0,
        runtime_executable: true,
        operationally_current: true,
      },
      operational_evidence: {
        last_successful_run_at: '2026-08-30T11:55:00.000Z',
        successful_through_modules: 15,
        maximum_age_minutes: 30,
      },
    },
  });
  assert.equal(health.deletion_replication.classification, 'partial_refresh');
  assert.equal(health.deletion_replication.readiness.runtime_executable, false);
  assert.equal(health.deletion_replication.readiness.operationally_current, false);
  assert.deepEqual(health.deletion_replication.coverage, {
    scheduled_record_modules: 16,
    documented_deleted_record_modules: 15,
    unsupported_scheduled_modules: 1,
  });
  assert.deepEqual(health.exclusions.deletions, {
    included: false,
    classification: 'partial_refresh',
    reason_code: 'DELETION_ARCHIVE_CONTRACT_UNVERIFIED',
  });
  assert.equal(assertPrivacySafePublicPayload(health), true);
});

test('invalid deletion readiness counts fail closed', () => {
  assert.throws(
    () => buildReplicationHealth({
      generatedAt,
      deletionReplication: {
        coverage: {
          scheduled_record_modules: 16,
          documented_deleted_record_modules: 15,
          unsupported_scheduled_modules: 0,
        },
          readiness: { baseline_ready_modules: 0, feature_enabled_modules: 0 },
          operational_evidence: {
            last_successful_run_at: null,
            successful_through_modules: 0,
            maximum_age_minutes: 30,
          },
      },
    }),
    error => error instanceof ReplicationHealthError && error.code === 'INVALID_DELETION_READINESS',
  );
  for (const invalid of [true, '1']) {
    assert.throws(
      () => buildReplicationHealth({
        generatedAt,
        deletionReplication: {
          coverage: {
            scheduled_record_modules: 1,
            documented_deleted_record_modules: 1,
            unsupported_scheduled_modules: 0,
          },
          readiness: {
            baseline_ready_modules: invalid,
            feature_enabled_modules: 0,
          },
          operational_evidence: {
            last_successful_run_at: null,
            successful_through_modules: 0,
            maximum_age_minutes: 30,
          },
        },
      }),
      error => error instanceof ReplicationHealthError && error.code === 'INVALID_DELETION_READINESS',
    );
  }
});

test('bounded snapshot cache coalesces concurrent exact evidence reads', async () => {
  let loads = 0;
  const exact = Object.freeze({ observed_at: generatedAt, value: 42 });
  const cache = createBoundedSnapshotCache({
    load: async () => {
      loads += 1;
      await new Promise(resolve => setTimeout(resolve, 10));
      return exact;
    },
    degrade: value => ({ ...value, partial: true }),
    freshTtlMs: 1_000,
    fallbackRetryMs: 20,
    responseWaitMs: 100,
    queryTimeoutMs: 500,
  });

  const results = await Promise.all(Array.from({ length: 8 }, () => cache.get({
    generation: 0,
    fallback: { value: 0 },
  })));
  assert.equal(loads, 1);
  assert.ok(results.every(result => result === exact));
});

test('bounded snapshot cache returns an explicitly degraded fallback on timeout', async () => {
  let loads = 0;
  const cache = createBoundedSnapshotCache({
    load: ({ signal }) => new Promise((resolve, reject) => {
      loads += 1;
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }),
    degrade: value => ({ ...value, refresh_status: 'partial' }),
    freshTtlMs: 1_000,
    fallbackRetryMs: 20,
    responseWaitMs: 5,
    queryTimeoutMs: 20,
  });

  const startedAt = Date.now();
  const result = await cache.get({ generation: 0, fallback: { value: 7 } });
  assert.deepEqual(result, { value: 7, refresh_status: 'partial' });
  assert.ok(Date.now() - startedAt < 100);
  const warmStartedAt = Date.now();
  assert.deepEqual(
    await cache.get({ generation: 0, fallback: { value: 8 } }),
    { value: 7, refresh_status: 'partial' },
  );
  assert.ok(Date.now() - warmStartedAt < 5, 'A repeated fallback read must not wait on the active flight.');
  await new Promise(resolve => setTimeout(resolve, 30));
  await cache.get({ generation: 0, fallback: { value: 8 } });
  assert.equal(loads, 2, 'Timed-out work must clear so a later request can retry.');
});

test('snapshot invalidation never serves the prior generation as current evidence', async () => {
  let loads = 0;
  let finishRefresh;
  const first = Object.freeze({ value: 1, refresh_status: 'complete' });
  const second = Object.freeze({ value: 2, refresh_status: 'complete' });
  const cache = createBoundedSnapshotCache({
    load: () => {
      loads += 1;
      if (loads === 1) return Promise.resolve(first);
      return new Promise(resolve => { finishRefresh = () => resolve(second); });
    },
    degrade: value => ({ ...value, refresh_status: 'partial' }),
    freshTtlMs: 1_000,
    fallbackRetryMs: 20,
    responseWaitMs: 5,
    queryTimeoutMs: 500,
  });

  assert.equal(await cache.get({ generation: 0, fallback: { value: 0 } }), first);
  cache.invalidate();
  const degraded = await cache.get({ generation: 1, fallback: { value: 0 } });
  assert.deepEqual(degraded, { value: 1, refresh_status: 'partial' });
  finishRefresh();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(await cache.get({ generation: 1, fallback: { value: 0 } }), second);
});

test('an unavailable persisted sync-state read is explicit and forces partial health', () => {
  const health = buildReplicationHealth({
    generatedAt,
    schedule: {
      enabled: true,
      started: true,
      stateAvailable: false,
      scheduledRecordModules: 16,
    },
    persistedState: {
      last_completed_run: {
        started_at: '2026-08-30T11:45:00.000Z',
        finished_at: '2026-08-30T11:46:00.000Z',
        status: 'succeeded',
        global_success: true,
        module_summary: { total: 16, complete: 16, partial: 0, error: 0 },
      },
    },
    reconciliation: [exactEvidence('Notes', 67_798)],
  });

  assert.equal(health.schedule.state_available, false);
  assert.equal(health.overall_classification, 'partial_refresh');
  assert.equal(assertPrivacySafePublicPayload(health), true);
});
