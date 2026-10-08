'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const deltaJobSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'delta-sync-job.js'), 'utf8');
const syncStart = source.indexOf('// ---------- Zoho sync: delta records + automation metadata ----------');
const syncEnd = source.indexOf("app.get('/api/sync/automation'", syncStart);
const syncSource = source.slice(syncStart, syncEnd);
const completenessStart = source.indexOf('async function computeDataCompleteness(');
const completenessEnd = source.indexOf('\ndataCompletenessCache = createDataCompletenessCache(', completenessStart);
const completenessSource = source.slice(completenessStart, completenessEnd);

test('server uses the v2 engine with one fenced 60-record global budget', () => {
  assert.ok(syncStart >= 0 && syncEnd > syncStart);
  assert.match(syncSource, /DELTA_SYNC_STATE_KEY = 'delta_sync_state_v2'/);
  assert.match(syncSource, /DELTA_SYNC_MAX_RECORDS_PER_RUN = 60/);
  assert.match(syncSource, /DELTA_SYNC_MAX_RECORDS_PER_MODULE = 60/);
  assert.match(syncSource, /createDeltaSyncLeaseClient\(\{/);
  assert.match(syncSource, /createLeaseClient: makeDeltaSyncLeaseClient/);
  assert.match(syncSource, /runSync: runDeltaSync/);
  assert.match(syncSource, /runZohoDeltaSync\(\{[\s\S]*maxRecordsPerRun: DELTA_SYNC_MAX_RECORDS_PER_RUN/);
  assert.doesNotMatch(syncSource, /createPersistedDeltaSyncStateStore/);
  assert.doesNotMatch(syncSource, /for \(let p = 0; p < 4/);
  assert.doesNotMatch(syncSource, /let budget = 60/);
});

test('source adapters remain exact GET-only reads ordered by Modified_Time', () => {
  assert.match(source, /if \(!\['GET', 'HEAD'\]\.includes\(method\)\)/);
  const storage = syncSource.indexOf('await paymentMilestoneSnapshotAdapter.assertStorageCapability();');
  const guard = syncSource.indexOf('await zohoOrgGuard.assertExpectedOrg({ signal });');
  const sourceLock = syncSource.indexOf('await ensureSourceReplicationLock({ signal });');
  const sourceCapability = syncSource.indexOf('await paymentMilestoneSnapshotAdapter.assertCapability();');
  const engine = syncSource.indexOf('await runZohoDeltaSync({');
  assert.ok(
    storage >= 0 && guard > storage && sourceLock > guard && sourceCapability > sourceLock && engine > sourceCapability,
    'Storage canary, expected-org guard, source lock, and source metadata preflight must precede record reads.',
  );
  assert.match(syncSource, /fields=Modified_Time&per_page=\$\{perPage\}&sort_by=Modified_Time&sort_order=desc/);
  assert.match(syncSource, /async function fetchZohoRecord\(\{ module, recordId \}, \{ signal \} = \{\}\)[\s\S]*\/crm\/v8\/\$\{module\}\/\$\{encodeURIComponent/);
  assert.match(syncSource, /await rpc\('crm_bulk_upsert', \{ rows: \[row\] \}, \{ signal \}\)/);
  assert.match(syncSource, /DELTA_SYNC_MODULE_STRATEGIES = Object\.freeze\(\{[\s\S]*PAYMENT_MILESTONE_MODULE[\s\S]*mode: 'snapshot'/);
  assert.match(syncSource, /await paymentMilestoneSnapshotAdapter\.assertCapability\(\)/);
  assert.match(syncSource, /listSnapshotIds: options => paymentMilestoneSnapshotAdapter\.listSnapshotIds\(options\)/);
  assert.match(syncSource, /upsertSnapshot: snapshot => paymentMilestoneSnapshotAdapter\.upsertSnapshot\(snapshot\)/);
  assert.match(syncSource, /rpc\('crm_payment_milestone_snapshot_upsert', \{ rows \}, \{ signal \}\)/);
  assert.match(syncSource, /body: JSON\.stringify\(\{ rows: \[\], s: SECRET \}\)/);
  assert.match(syncSource, /source_org_id: ZOHO_SOURCE_ORG_ID/);
  assert.match(syncSource, /source_seen_at: new Date\(sourceSeenAt\)\.toISOString\(\)/);
  assert.doesNotMatch(syncSource, /zoho\([^\n]*method:\s*['"](?:POST|PUT|PATCH|DELETE)/);
});

test('scheduled execution has separate Vercel-safe source and hard deadlines with CAS-only persisted state', () => {
  assert.match(syncSource, /DELTA_SYNC_SOURCE_DEADLINE_MS = 35_000/);
  assert.match(syncSource, /DELTA_SYNC_HARD_DEADLINE_MS = 55_000/);
  assert.match(source, /loadOrg: \(\{ signal \} = \{\}\) => zoho\('\/crm\/v8\/org', \{ signal \}\)/);
  assert.match(syncSource, /sourceDeadlineMs: DELTA_SYNC_SOURCE_DEADLINE_MS/);
  assert.match(syncSource, /hardDeadlineMs: DELTA_SYNC_HARD_DEADLINE_MS/);
  assert.match(syncSource, /await zohoOrgGuard\.assertExpectedOrg\(\{ signal \}\)/);
  assert.match(deltaJobSource, /createLeaseClient\(\{ signal: hardController\.signal \}\)/);
  assert.match(deltaJobSource, /runSync\(\{ stateStore, signal: sourceController\.signal \}\)/);
  assert.match(deltaJobSource, /hardController\.signal\.aborted/);
  assert.match(deltaJobSource, /'DELTA_SYNC_DEADLINE_EXCEEDED'/);
  assert.match(source, /DELTA_SYNC_UNAVAILABLE_ERROR_CODES\.has\(error\?\.code\)/);
  assert.match(source, /'SNAPSHOT_STORAGE_UNVERIFIED'/);
  assert.match(syncSource, /loadDeltaSyncStateEvidence\(\{ signal \} = \{\}\)/);
  assert.doesNotMatch(syncSource, /crm_meta_upsert[\s\S]{0,120}DELTA_SYNC_STATE_KEY/);
  assert.match(deltaJobSource, /'DELTA_SYNC_ALREADY_RUNNING'/);
});

test('partial engine results persist first and reject the interval-runner success path', () => {
  const persisted = syncSource.indexOf('const run = await runZohoDeltaSync({');
  assert.ok(persisted >= 0);
  assert.match(deltaJobSource, /leased\.result\?\.global_success !== true/);
  assert.match(deltaJobSource, /'DELTA_SYNC_INCOMPLETE'/);
  assert.match(syncSource, /run: \(\) => runDeltaSyncJob\(\)/);
  assert.match(syncSource, /status: 'partial_refresh', global_success: false/);
  assert.doesNotMatch(syncSource, /return \{ \.\.\.outcome\.result/);
});

test('public replication health uses SQL-side private digests and numeric source-ID predicates', () => {
  assert.match(source, /app\.get\('\/api\/meta\/replication_health'/);
  assert.doesNotMatch(source, /app\.post\('\/api\/meta\/replication_health'/);
  assert.match(syncSource, /extensions\.digest\(coalesce\(string_agg\(id, E'\\\\n' order by id\), ''\), 'sha256'\)/);
  assert.match(syncSource, /id ~ '\^\[0-9\]\+\$'/);
  assert.match(syncSource, /buildReplicationHealth\(\{/);
  assert.match(syncSource, /moduleDefinitions: 153, apiSupportedModules: 122/);
  assert.match(syncSource, /scheduledRecordModules: SYNC_MODULES\.length/);
  assert.match(syncSource, /const DELETION_SYNC_MODULES = SYNC_MODULES\.filter\(moduleKey => moduleKey !== 'Notes'\)/);
  assert.match(syncSource, /buildSourceDeletionReadiness\(\{[\s\S]*documentedModules: DELETION_SYNC_MODULES/);
  assert.match(syncSource, /contractVerified: false/);
  assert.match(syncSource, /leaseVerified: false/);
  assert.match(syncSource, /baselineReadyModules: 0/);
  assert.match(syncSource, /featureEnabledModules: 0/);
  assert.match(syncSource, /operationalEvidence: null/);
  assert.match(syncSource, /deletionReplication,/);
  assert.doesNotMatch(syncSource, /digestComparedAt/);
});

test('replication health coalesces and bounds exact set reads without opening CRM JSON bodies', () => {
  const evidenceStart = source.indexOf('async function queryCurrentReplicationSetEvidence(');
  const evidenceEnd = source.indexOf('\nfunction exactReplicationEvidence(', evidenceStart);
  const evidenceSource = source.slice(evidenceStart, evidenceEnd);
  assert.ok(evidenceStart >= 0 && evidenceEnd > evidenceStart);
  assert.match(evidenceSource, /statement_timestamp\(\) as observed_at/);
  assert.match(evidenceSource, /string_agg\(id, E'\\\\n' order by id\)/);
  assert.match(evidenceSource, /createBoundedSnapshotCache\(\{/);
  assert.match(evidenceSource, /replicationSetEvidenceService\.get\(\{/);
  assert.match(evidenceSource, /REPLICATION_SET_EVIDENCE_QUERY_TIMEOUT_MS/);
  assert.match(evidenceSource, /REPLICATION_HEALTH_RESPONSE_WAIT_MS/);
  assert.match(evidenceSource, /refresh_status: 'partial'/);
  assert.doesNotMatch(evidenceSource, /data->>|data\s*->/);
});

test('replication health state failures are bounded and explicitly fail closed', () => {
  assert.match(syncSource, /boundedReplicationHealthState\(\)/);
  assert.match(syncSource, /stateAvailable: stateEvidence\.available/);
  assert.match(syncSource, /replicationHealthStateService = createBoundedSnapshotCache\(\{/);
  assert.match(syncSource, /available: false,[\s\S]*state: evidence\?\.state \|\| emptyDeltaSyncState\(\)/);
});

test('visibility-changing invalidation cancels the replication evidence snapshot generation', () => {
  const invalidationStart = source.indexOf('function invalidateDerivedReadCaches(');
  const invalidationEnd = source.indexOf('\nasync function cachedAnalyticsOverview(', invalidationStart);
  const invalidationSource = source.slice(invalidationStart, invalidationEnd);
  assert.match(invalidationSource, /derivedReadCacheGeneration \+= 1/);
  assert.match(invalidationSource, /replicationSetEvidenceService\.invalidate\(\)/);
  assert.match(invalidationSource, /replicationHealthStateService\.invalidate\(\)/);
});

test('data completeness no longer returns large ID arrays or a false Drift detected label', () => {
  assert.ok(completenessStart >= 0 && completenessEnd > completenessStart);
  assert.match(completenessSource, /extensions\.digest\(/);
  assert.match(completenessSource, /id ~ '\^\[0-9\]\+\$'/);
  assert.doesNotMatch(completenessSource, /jsonb_agg\(id/);
  assert.doesNotMatch(completenessSource, /'Drift detected'/);
  assert.match(completenessSource, /reconciliation_classification/);
  assert.match(completenessSource, /Source recheck required/);
});

test('data completeness current-set digest stays on source ID keys without opening record JSON', () => {
  const recordSetsStart = completenessSource.indexOf('with record_sets as (');
  const recordSetsEnd = completenessSource.indexOf('\n  )\n  select', recordSetsStart);
  const recordSetsSource = completenessSource.slice(recordSetsStart, recordSetsEnd);

  assert.ok(recordSetsStart >= 0 && recordSetsEnd > recordSetsStart);
  assert.match(recordSetsSource, /module = any\(array\[/);
  assert.match(recordSetsSource, /id ~ '\^\[0-9\]\+\$'/);
  assert.match(recordSetsSource, /string_agg\(id, E'\\\\n' order by id\)/);
  assert.doesNotMatch(recordSetsSource, /\bdata\s*->|__test_artifact/);

  const schema = fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8');
  assert.match(schema, /v_id !~ '\^\[0-9\]\{8,32\}\$'/);
  assert.match(schema, /p_id !~ '\^\(local\|local-note\)-/);
});

test('visibility-changing source events have a hard dashboard and aggregate cache invalidation path', () => {
  assert.match(source, /dropDashboardLastKnownGood = false/);
  assert.match(source, /homeDashboardService\.invalidate\(\{[\s\S]*dropLastKnownGood: dropDashboardLastKnownGood/);
  assert.match(source, /listCountCache\.clear\(\)/);
  assert.match(source, /matrixCache\.clear\(\)/);
});
