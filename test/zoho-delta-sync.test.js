'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DeltaSyncError,
  createInMemoryDeltaSyncStateStore,
  createPersistedDeltaSyncStateStore,
  runZohoDeltaSync,
} = require('../lib/zoho-delta-sync');

function syntheticChanges(count, prefix = 'row') {
  const epoch = Date.parse('2026-08-01T00:00:00.000Z');
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${String(index + 1).padStart(5, '0')}`,
    Modified_Time: new Date(epoch + (index + 1) * 1_000).toISOString(),
  }));
}

function pagedSource(changes, calls = []) {
  const newestFirst = [...changes].reverse();
  return async ({ module, page, pageToken, perPage }) => {
    calls.push({ module, page, pageToken, perPage });
    const offset = (page - 1) * perPage;
    const data = newestFirst.slice(offset, offset + perPage);
    return {
      data,
      info: {
        more_records: offset + data.length < newestFirst.length,
        next_page_token: offset + data.length < newestFirst.length ? `private-page-${page + 1}` : null,
      },
    };
  };
}

function monotonicNow() {
  let tick = 0;
  const epoch = Date.parse('2026-08-30T00:00:00.000Z');
  return () => new Date(epoch + tick++ * 1_000);
}

function numericRecordIds(count, offset = 1n) {
  const base = 1032257000000000000n + offset;
  return Array.from({ length: count }, (_, index) => String(base + BigInt(index)));
}

function snapshotPage(ids, info = { more_records: false }) {
  return {
    data: ids.map(id => ({ id })),
    info,
  };
}

test('more than 800 source changes converge over bounded runs without skips', async () => {
  const changes = syntheticChanges(1_005);
  const pageCalls = [];
  const upserted = [];
  const stateStore = createInMemoryDeltaSyncStateStore();
  const now = monotonicNow();
  const runs = [];

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const run = await runZohoDeltaSync({
      modules: ['Leads'],
      listModified: pagedSource(changes, pageCalls),
      fetchRecord: async ({ recordId }) => ({ id: recordId, safe_value: true }),
      upsertRecord: async ({ record }) => { upserted.push(record.id); },
      stateStore,
      now,
      perPage: 200,
      maxPages: 10,
      maxRecordsPerModule: 250,
      maxRecordsPerRun: 250,
    });
    runs.push(run);
    if (run.global_success) break;
  }

  assert.equal(runs.length, 5);
  assert.ok(runs.slice(0, -1).every(run => run.status === 'partial' && run.global_success === false));
  assert.equal(runs.at(-1).status, 'succeeded');
  assert.equal(runs.at(-1).global_success, true);
  assert.equal(Math.max(...runs.map(run => run.modules.Leads.pages_scanned)), 6);
  assert.ok(pageCalls.some(call => call.page > 4));
  assert.equal(upserted.length, changes.length);
  assert.equal(new Set(upserted).size, changes.length);
  assert.deepEqual(upserted, changes.map(change => change.id));

  const state = stateStore.snapshot();
  assert.equal(state.last_completed_run.global_success, true);
  assert.equal(state.last_successful_run.global_success, true);
  assert.equal(state.modules.Leads.cursor.record_id, changes.at(-1).id);
});

test('record fetch failure marks the module partial and preserves a retry-safe cursor', async () => {
  const changes = syntheticChanges(3, 'task');
  const stateStore = createInMemoryDeltaSyncStateStore();
  const upserted = [];
  let failOnce = true;
  const adapters = {
    modules: ['Tasks'],
    listModified: pagedSource(changes),
    fetchRecord: async ({ recordId }) => {
      if (recordId === changes[1].id && failOnce) {
        failOnce = false;
        throw new Error('private upstream failure details');
      }
      return { id: recordId };
    },
    upsertRecord: async ({ record }) => { upserted.push(record.id); },
    stateStore,
    now: monotonicNow(),
    maxRecordsPerModule: 10,
  };

  const first = await runZohoDeltaSync(adapters);
  assert.equal(first.global_success, false);
  assert.equal(first.status, 'partial');
  assert.deepEqual(first.modules.Tasks, {
    status: 'partial',
    pages_scanned: 1,
    discovered_changes: 3,
    attempted_changes: 2,
    processed_changes: 1,
    remaining_changes: 2,
    cursor_advanced: true,
    reason_code: 'RECORD_FETCH_FAILED',
  });
  assert.equal(stateStore.snapshot().modules.Tasks.cursor.record_id, changes[0].id);
  assert.equal(stateStore.snapshot().last_successful_run, null);
  assert.equal(JSON.stringify(first).includes('private upstream failure details'), false);

  const second = await runZohoDeltaSync(adapters);
  assert.equal(second.global_success, true);
  assert.deepEqual(upserted, changes.map(change => change.id));
  assert.equal(stateStore.snapshot().modules.Tasks.cursor.record_id, changes.at(-1).id);
});

test('an incomplete page scan processes nothing and leaves the cursor unchanged', async () => {
  const changes = syntheticChanges(1_001, 'note');
  const stateStore = createInMemoryDeltaSyncStateStore();
  let fetches = 0;
  let upserts = 0;
  const run = await runZohoDeltaSync({
    modules: ['Notes'],
    listModified: pagedSource(changes),
    fetchRecord: async () => { fetches += 1; return {}; },
    upsertRecord: async () => { upserts += 1; },
    stateStore,
    now: monotonicNow(),
    perPage: 200,
    maxPages: 4,
    maxRecordsPerModule: 1_001,
  });

  assert.equal(run.global_success, false);
  assert.deepEqual(run.modules.Notes, {
    status: 'partial',
    pages_scanned: 4,
    discovered_changes: null,
    attempted_changes: 0,
    processed_changes: 0,
    remaining_changes: null,
    cursor_advanced: false,
    reason_code: 'PAGE_BOUND_REACHED',
  });
  assert.equal(fetches, 0);
  assert.equal(upserts, 0);
  assert.equal(stateStore.snapshot().modules.Notes.cursor, null);
});

test('one module error prevents global success and does not expose the raw error', async () => {
  const stateStore = createInMemoryDeltaSyncStateStore();
  const run = await runZohoDeltaSync({
    modules: ['Leads', 'Tasks'],
    listModified: async ({ module }) => {
      if (module === 'Tasks') throw new Error('https://private.example/token/secret');
      return { data: [], info: { more_records: false } };
    },
    fetchRecord: async () => ({}),
    upsertRecord: async () => {},
    stateStore,
    now: monotonicNow(),
  });

  assert.equal(run.global_success, false);
  assert.equal(run.status, 'partial');
  assert.deepEqual(run.module_summary, { total: 2, complete: 1, partial: 0, error: 1 });
  assert.equal(run.modules.Tasks.reason_code, 'CHANGE_LIST_FAILED');
  assert.equal(JSON.stringify(run).includes('private.example'), false);
  assert.equal(stateStore.snapshot().last_successful_run, null);
});

test('completed state persists across adapter instances without leaking internal cursors into the run payload', async () => {
  const changes = syntheticChanges(1, 'account');
  let backingSnapshot = null;
  const saveSnapshot = async snapshot => { backingSnapshot = JSON.stringify(snapshot); };
  const firstStore = createPersistedDeltaSyncStateStore({
    loadSnapshot: async () => backingSnapshot,
    saveSnapshot,
  });
  const run = await runZohoDeltaSync({
    modules: ['Accounts'],
    listModified: pagedSource(changes),
    fetchRecord: async ({ recordId }) => ({ id: recordId, body: 'must remain internal' }),
    upsertRecord: async () => {},
    stateStore: firstStore,
    now: monotonicNow(),
  });

  const secondStore = createPersistedDeltaSyncStateStore({
    loadSnapshot: async () => backingSnapshot,
    saveSnapshot,
  });
  const reloaded = await secondStore.load();
  assert.equal(reloaded.last_completed_run.global_success, true);
  assert.equal(reloaded.last_successful_run.global_success, true);
  assert.equal(reloaded.modules.Accounts.cursor.record_id, changes[0].id);

  const serializedRun = JSON.stringify(run);
  assert.equal(serializedRun.includes(changes[0].id), false);
  assert.equal(serializedRun.includes('private-page'), false);
  assert.equal(serializedRun.includes('must remain internal'), false);
  assert.equal(serializedRun.includes('record_id'), false);
});

test('one global 60-record budget is allocated fairly across all 16 scheduled modules', async () => {
  const modules = Array.from({ length: 16 }, (_, index) => `Module_${index + 1}`);
  const changesByModule = new Map(modules.map(module => [module, syntheticChanges(10, module)]));
  const processedByModule = new Map(modules.map(module => [module, 0]));
  const stateStore = createInMemoryDeltaSyncStateStore();
  const run = await runZohoDeltaSync({
    modules,
    listModified: async ({ module }) => ({
      data: [...changesByModule.get(module)].reverse(),
      info: { more_records: false },
    }),
    fetchRecord: async ({ module, recordId }) => ({ module, id: recordId }),
    upsertRecord: async ({ module }) => {
      processedByModule.set(module, processedByModule.get(module) + 1);
    },
    stateStore,
    now: monotonicNow(),
    maxRecordsPerModule: 10,
    maxRecordsPerRun: 60,
  });

  assert.deepEqual(run.record_budget, {
    limit: 60,
    attempted: 60,
    processed: 60,
    remaining_capacity: 0,
  });
  assert.equal([...processedByModule.values()].reduce((sum, count) => sum + count, 0), 60);
  assert.ok([...processedByModule.values()].every(count => count === 3 || count === 4));
  assert.ok(run.module_results.every(result => result.status === 'partial'));
  assert.equal(run.global_success, false);
  assert.equal(stateStore.snapshot().last_completed_run.module_results.length, 16);
  assert.equal(stateStore.snapshot().last_successful_run, null);
});

test('a repeated continuation token fails partial before fetch, upsert, or cursor movement', async () => {
  const stateStore = createInMemoryDeltaSyncStateStore();
  let fetches = 0;
  let upserts = 0;
  const run = await runZohoDeltaSync({
    modules: ['Notes'],
    listModified: async ({ page, pageToken }) => {
      const sequence = pageToken ? 11 : page;
      return {
        data: [{ id: `note-${sequence}`, Modified_Time: new Date(Date.parse('2026-08-30T12:00:00.000Z') - sequence * 1_000).toISOString() }],
        info: { more_records: true, next_page_token: 'same-private-token' },
      };
    },
    fetchRecord: async () => { fetches += 1; return {}; },
    upsertRecord: async () => { upserts += 1; },
    stateStore,
    now: monotonicNow(),
    maxPages: 12,
  });

  assert.equal(run.modules.Notes.status, 'partial');
  assert.equal(run.modules.Notes.reason_code, 'PAGE_CONTINUATION_REPEATED');
  assert.equal(fetches, 0);
  assert.equal(upserts, 0);
  assert.equal(stateStore.snapshot().modules.Notes.cursor, null);
});

test('numeric pages 1 through 9 do not require page tokens', async () => {
  const changes = syntheticChanges(1_500, 'numeric-page');
  const newestFirst = [...changes].reverse();
  const calls = [];
  const stateStore = createInMemoryDeltaSyncStateStore();
  const run = await runZohoDeltaSync({
    modules: ['Leads'],
    listModified: async ({ page, pageToken, perPage }) => {
      calls.push({ page, pageToken });
      const offset = (page - 1) * perPage;
      const data = newestFirst.slice(offset, offset + perPage);
      return {
        data,
        info: {
          more_records: offset + data.length < newestFirst.length,
          next_page_token: null,
        },
      };
    },
    fetchRecord: async ({ recordId }) => ({ id: recordId }),
    upsertRecord: async () => {},
    stateStore,
    now: monotonicNow(),
    maxRecordsPerModule: 1_500,
    maxRecordsPerRun: 1_500,
  });

  assert.equal(run.global_success, true);
  assert.equal(run.modules.Leads.pages_scanned, 8);
  assert.deepEqual(calls.map(call => call.page), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.ok(calls.every(call => call.pageToken === null));
});

test('pagination switches from page 10 to page-token-only requests beyond 2,000 rows', async () => {
  const changes = syntheticChanges(2_205, 'token-page');
  const newestFirst = [...changes].reverse();
  const calls = [];
  const stateStore = createInMemoryDeltaSyncStateStore();
  const run = await runZohoDeltaSync({
    modules: ['Tasks'],
    listModified: async ({ page, pageToken, perPage }) => {
      calls.push({ page, pageToken });
      const pageNumber = pageToken ? Number(String(pageToken).replace('token-', '')) : page;
      const offset = (pageNumber - 1) * perPage;
      const data = newestFirst.slice(offset, offset + perPage);
      const moreRecords = offset + data.length < newestFirst.length;
      return {
        data,
        info: {
          more_records: moreRecords,
          next_page_token: moreRecords && pageNumber >= 10 ? `token-${pageNumber + 1}` : null,
        },
      };
    },
    fetchRecord: async ({ recordId }) => ({ id: recordId }),
    upsertRecord: async () => {},
    stateStore,
    now: monotonicNow(),
    maxRecordsPerModule: 100,
    maxRecordsPerRun: 60,
  });

  assert.equal(run.modules.Tasks.pages_scanned, 12);
  assert.equal(run.modules.Tasks.reason_code, 'GLOBAL_RECORD_BUDGET_REACHED');
  assert.deepEqual(calls.slice(0, 10).map(call => call.page), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.ok(calls.slice(0, 10).every(call => call.pageToken === null));
  assert.deepEqual(calls.slice(10), [
    { page: null, pageToken: 'token-11' },
    { page: null, pageToken: 'token-12' },
  ]);
});

test('explicit snapshot strategy double-scans eight IDs, fetches all records, and applies one atomic batch', async () => {
  const ids = numericRecordIds(8);
  const listCalls = [];
  const fetchCalls = [];
  const batches = [];
  const stateStore = createInMemoryDeltaSyncStateStore({
    schema_version: 1,
    modules: {
      DealHistory: {
        cursor: {
          modified_time: '2026-08-01T00:00:00.000Z',
          record_id: '1032257000000000000',
        },
      },
    },
  });

  const run = await runZohoDeltaSync({
    modules: ['DealHistory'],
    moduleStrategies: { DealHistory: { mode: 'snapshot' } },
    listSnapshotIds: async options => {
      listCalls.push(options);
      return snapshotPage(ids);
    },
    fetchRecord: async ({ module, recordId }) => {
      fetchCalls.push({ module, recordId });
      return { id: recordId, safe_value: `value-${fetchCalls.length}` };
    },
    upsertSnapshot: async value => { batches.push(value); },
    stateStore,
    now: monotonicNow(),
    maxRecordsPerModule: 8,
    maxRecordsPerRun: 8,
  });

  assert.equal(run.global_success, true);
  assert.deepEqual(run.modules.DealHistory, {
    status: 'complete',
    pages_scanned: 2,
    discovered_changes: 8,
    attempted_changes: 8,
    processed_changes: 8,
    remaining_changes: 0,
    cursor_advanced: false,
    reason_code: null,
  });
  assert.equal(listCalls.length, 2);
  assert.ok(listCalls.every(call => call.module === 'DealHistory'));
  assert.ok(listCalls.every(call => call.page === 1 && call.pageToken === null && call.perPage === 200));
  assert.ok(listCalls.every(call => call.sortBy === 'id' && call.sortOrder === 'asc'));
  assert.deepEqual(fetchCalls.map(call => call.recordId), ids);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].module, 'DealHistory');
  assert.deepEqual(batches[0].records.map(record => record.id), ids);
  assert.ok(batches[0].records.every(record => !('Modified_Time' in record)));
  assert.ok(batches[0].records.every(record => !('Last_Activity_Time' in record)));
  assert.equal(stateStore.snapshot().modules.DealHistory.cursor, null);
});

test('a valid empty double-scan completes with zero effects and no batch call', async () => {
  let scans = 0;
  let fetches = 0;
  let upserts = 0;
  const run = await runZohoDeltaSync({
    modules: ['DealHistory'],
    moduleStrategies: { DealHistory: { mode: 'snapshot' } },
    listSnapshotIds: async () => { scans += 1; return snapshotPage([]); },
    fetchRecord: async () => { fetches += 1; return {}; },
    upsertSnapshot: async () => { upserts += 1; },
    stateStore: createInMemoryDeltaSyncStateStore(),
    now: monotonicNow(),
  });

  assert.equal(scans, 2);
  assert.equal(fetches, 0);
  assert.equal(upserts, 0);
  assert.equal(run.global_success, true);
  assert.deepEqual(run.modules.DealHistory, {
    status: 'complete',
    pages_scanned: 2,
    discovered_changes: 0,
    attempted_changes: 0,
    processed_changes: 0,
    remaining_changes: 0,
    cursor_advanced: false,
    reason_code: null,
  });
});

test('snapshot list drift fails closed before record fetch or batch upsert', async () => {
  const firstIds = numericRecordIds(3, 20n);
  const secondIds = [firstIds[0], firstIds[1], numericRecordIds(1, 99n)[0]];
  let scan = 0;
  let fetches = 0;
  let upserts = 0;
  const run = await runZohoDeltaSync({
    modules: ['DealHistory'],
    moduleStrategies: { DealHistory: { mode: 'snapshot' } },
    listSnapshotIds: async () => snapshotPage(scan++ === 0 ? firstIds : secondIds),
    fetchRecord: async () => { fetches += 1; return {}; },
    upsertSnapshot: async () => { upserts += 1; },
    stateStore: createInMemoryDeltaSyncStateStore(),
    now: monotonicNow(),
  });

  assert.equal(run.global_success, false);
  assert.equal(run.modules.DealHistory.status, 'partial');
  assert.equal(run.modules.DealHistory.reason_code, 'SNAPSHOT_LIST_DRIFT');
  assert.equal(run.modules.DealHistory.pages_scanned, 2);
  assert.equal(fetches, 0);
  assert.equal(upserts, 0);
  assert.ok(firstIds.every(id => !JSON.stringify(run).includes(id)));
  assert.ok(secondIds.every(id => !JSON.stringify(run).includes(id)));
});

test('snapshot continuation fails closed after one page without effects', async () => {
  const ids = numericRecordIds(2, 40n);
  let scans = 0;
  let fetches = 0;
  let upserts = 0;
  const run = await runZohoDeltaSync({
    modules: ['DealHistory'],
    moduleStrategies: { DealHistory: { mode: 'snapshot' } },
    listSnapshotIds: async () => {
      scans += 1;
      return snapshotPage(ids, { more_records: true, next_page_token: 'private-next-page' });
    },
    fetchRecord: async () => { fetches += 1; return {}; },
    upsertSnapshot: async () => { upserts += 1; },
    stateStore: createInMemoryDeltaSyncStateStore(),
    now: monotonicNow(),
  });

  assert.equal(scans, 1);
  assert.equal(run.modules.DealHistory.reason_code, 'SNAPSHOT_PAGINATION_UNSUPPORTED');
  assert.equal(run.modules.DealHistory.pages_scanned, 1);
  assert.equal(fetches, 0);
  assert.equal(upserts, 0);
  assert.equal(JSON.stringify(run).includes('private-next-page'), false);
});

test('snapshot must fit the complete per-module and global record budgets before any fetch', async t => {
  const ids = numericRecordIds(8, 60n);
  for (const scenario of [
    {
      name: 'per-module bound',
      maxRecordsPerModule: 7,
      maxRecordsPerRun: 8,
      reasonCode: 'MODULE_RECORD_BOUND_REACHED',
    },
    {
      name: 'global bound',
      maxRecordsPerModule: 8,
      maxRecordsPerRun: 7,
      reasonCode: 'GLOBAL_RECORD_BUDGET_REACHED',
    },
  ]) {
    await t.test(scenario.name, async () => {
      let fetches = 0;
      let upserts = 0;
      const run = await runZohoDeltaSync({
        modules: ['DealHistory'],
        moduleStrategies: { DealHistory: { mode: 'snapshot' } },
        listSnapshotIds: async () => snapshotPage(ids),
        fetchRecord: async () => { fetches += 1; return {}; },
        upsertSnapshot: async () => { upserts += 1; },
        stateStore: createInMemoryDeltaSyncStateStore(),
        now: monotonicNow(),
        maxRecordsPerModule: scenario.maxRecordsPerModule,
        maxRecordsPerRun: scenario.maxRecordsPerRun,
      });

      assert.equal(run.modules.DealHistory.reason_code, scenario.reasonCode);
      assert.equal(run.modules.DealHistory.discovered_changes, 8);
      assert.equal(run.modules.DealHistory.attempted_changes, 0);
      assert.equal(run.record_budget.attempted, 0);
      assert.equal(fetches, 0);
      assert.equal(upserts, 0);
    });
  }
});

test('snapshot fetch failure retains the whole atomic batch for retry and leaks no source detail', async () => {
  const ids = numericRecordIds(8, 80n);
  let fetches = 0;
  let upserts = 0;
  const run = await runZohoDeltaSync({
    modules: ['DealHistory'],
    moduleStrategies: { DealHistory: { mode: 'snapshot' } },
    listSnapshotIds: async () => snapshotPage(ids),
    fetchRecord: async ({ recordId }) => {
      fetches += 1;
      if (fetches === 4) throw new Error(`private fetch failure for ${recordId}`);
      return { id: recordId, private_payload: `private-${recordId}` };
    },
    upsertSnapshot: async () => { upserts += 1; },
    stateStore: createInMemoryDeltaSyncStateStore(),
    now: monotonicNow(),
    maxRecordsPerModule: 8,
    maxRecordsPerRun: 8,
  });

  assert.equal(fetches, 4);
  assert.equal(upserts, 0);
  assert.deepEqual(run.modules.DealHistory, {
    status: 'partial',
    pages_scanned: 2,
    discovered_changes: 8,
    attempted_changes: 4,
    processed_changes: 0,
    remaining_changes: 8,
    cursor_advanced: false,
    reason_code: 'SNAPSHOT_RECORD_FETCH_FAILED',
  });
  const serialized = JSON.stringify(run);
  assert.equal(serialized.includes('private fetch failure'), false);
  assert.equal(serialized.includes('private_payload'), false);
  assert.ok(ids.every(id => !serialized.includes(id)));
});

test('snapshot batch-upsert failure reports zero processed and remains retry-safe', async () => {
  const ids = numericRecordIds(8, 100n);
  let batchCalls = 0;
  let failOnce = true;
  const stateStore = createInMemoryDeltaSyncStateStore();
  const options = {
    modules: ['DealHistory'],
    moduleStrategies: { DealHistory: { mode: 'snapshot' } },
    listSnapshotIds: async () => snapshotPage(ids),
    fetchRecord: async ({ recordId }) => ({ id: recordId, private_payload: true }),
    upsertSnapshot: async () => {
      batchCalls += 1;
      if (failOnce) {
        failOnce = false;
        throw new Error(`private batch failure for ${ids[0]}`);
      }
    },
    stateStore,
    now: monotonicNow(),
    maxRecordsPerModule: 8,
    maxRecordsPerRun: 8,
  };
  const run = await runZohoDeltaSync(options);

  assert.equal(batchCalls, 1);
  assert.equal(run.modules.DealHistory.reason_code, 'SNAPSHOT_UPSERT_FAILED');
  assert.equal(run.modules.DealHistory.attempted_changes, 8);
  assert.equal(run.modules.DealHistory.processed_changes, 0);
  assert.equal(run.modules.DealHistory.remaining_changes, 8);
  const serialized = JSON.stringify(run);
  assert.equal(serialized.includes('private batch failure'), false);
  assert.equal(serialized.includes('private_payload'), false);
  assert.ok(ids.every(id => !serialized.includes(id)));

  const retry = await runZohoDeltaSync(options);
  assert.equal(batchCalls, 2);
  assert.equal(retry.global_success, true);
  assert.equal(retry.modules.DealHistory.processed_changes, 8);
  assert.equal(stateStore.snapshot().modules.DealHistory.cursor, null);
});

test('snapshot scan rejects duplicate, invalid, unsorted, and non-plain rows before effects', async t => {
  const ids = numericRecordIds(3, 120n);
  const cases = [
    {
      name: 'duplicate ID',
      page: snapshotPage([ids[0], ids[0]]),
      reasonCode: 'SNAPSHOT_ID_DUPLICATE',
    },
    {
      name: 'invalid ID',
      page: { data: [{ id: 'not-numeric' }], info: { more_records: false } },
      reasonCode: 'SNAPSHOT_ID_INVALID',
    },
    {
      name: 'unsafe numeric ID',
      page: { data: [{ id: Number.MAX_SAFE_INTEGER + 1 }], info: { more_records: false } },
      reasonCode: 'SNAPSHOT_ID_INVALID',
    },
    {
      name: 'unsorted IDs',
      page: snapshotPage([ids[1], ids[0]]),
      reasonCode: 'SNAPSHOT_ID_ORDER_INVALID',
    },
    {
      name: 'non-plain row',
      page: { data: [['not', 'plain']], info: { more_records: false } },
      reasonCode: 'SNAPSHOT_ROW_INVALID',
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, async () => {
      let fetches = 0;
      let upserts = 0;
      const run = await runZohoDeltaSync({
        modules: ['DealHistory'],
        moduleStrategies: { DealHistory: { mode: 'snapshot' } },
        listSnapshotIds: async () => entry.page,
        fetchRecord: async () => { fetches += 1; return {}; },
        upsertSnapshot: async () => { upserts += 1; },
        stateStore: createInMemoryDeltaSyncStateStore(),
        now: monotonicNow(),
      });
      assert.equal(run.modules.DealHistory.reason_code, entry.reasonCode);
      assert.equal(fetches, 0);
      assert.equal(upserts, 0);
    });
  }
});

test('snapshot scan requires an unambiguous data/info completeness envelope', async t => {
  const id = numericRecordIds(1, 130n)[0];
  const cases = [
    { name: 'missing info', page: { data: [{ id }] } },
    { name: 'non-object info', page: { data: [{ id }], info: [] } },
    { name: 'missing more_records', page: { data: [{ id }], info: {} } },
    { name: 'non-boolean more_records', page: { data: [{ id }], info: { more_records: 'false' } } },
    { name: 'records fallback', page: { records: [{ id }], info: { more_records: false } } },
    {
      name: 'ambiguous data and records',
      page: { data: [{ id }], records: [{ id }], info: { more_records: false } },
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, async () => {
      let scans = 0;
      let fetches = 0;
      let upserts = 0;
      const run = await runZohoDeltaSync({
        modules: ['DealHistory'],
        moduleStrategies: { DealHistory: { mode: 'snapshot' } },
        listSnapshotIds: async () => { scans += 1; return entry.page; },
        fetchRecord: async () => { fetches += 1; return {}; },
        upsertSnapshot: async () => { upserts += 1; },
        stateStore: createInMemoryDeltaSyncStateStore(),
        now: monotonicNow(),
      });
      assert.equal(scans, 1);
      assert.equal(run.modules.DealHistory.reason_code, 'SNAPSHOT_PAGE_INVALID');
      assert.equal(fetches, 0);
      assert.equal(upserts, 0);
    });
  }
});

test('snapshot rejects a fetched record whose numeric ID does not exactly match the scanned ID', async () => {
  const ids = numericRecordIds(2, 140n);
  let upserts = 0;
  const run = await runZohoDeltaSync({
    modules: ['DealHistory'],
    moduleStrategies: { DealHistory: { mode: 'snapshot' } },
    listSnapshotIds: async () => snapshotPage(ids),
    fetchRecord: async ({ recordId }) => ({
      id: recordId === ids[1] ? numericRecordIds(1, 999n)[0] : recordId,
    }),
    upsertSnapshot: async () => { upserts += 1; },
    stateStore: createInMemoryDeltaSyncStateStore(),
    now: monotonicNow(),
  });

  assert.equal(run.modules.DealHistory.reason_code, 'SNAPSHOT_RECORD_ID_MISMATCH');
  assert.equal(run.modules.DealHistory.processed_changes, 0);
  assert.equal(run.modules.DealHistory.remaining_changes, 2);
  assert.equal(upserts, 0);
});

test('default and explicit Modified_Time strategies preserve the normal timestamp path', async t => {
  for (const moduleStrategies of [
    undefined,
    { Leads: { mode: 'timestamp', timestamp_field: 'Modified_Time' } },
  ]) {
    await t.test(moduleStrategies ? 'explicit timestamp' : 'default timestamp', async () => {
      const change = syntheticChanges(1, 'unchanged-timestamp')[0];
      let modifiedScans = 0;
      let snapshotScans = 0;
      let recordUpserts = 0;
      let snapshotUpserts = 0;
      const options = {
        modules: ['Leads'],
        listModified: async () => {
          modifiedScans += 1;
          return { data: [change], info: { more_records: false } };
        },
        listSnapshotIds: async () => { snapshotScans += 1; return snapshotPage([]); },
        fetchRecord: async ({ recordId }) => ({ id: recordId }),
        upsertRecord: async () => { recordUpserts += 1; },
        upsertSnapshot: async () => { snapshotUpserts += 1; },
        stateStore: createInMemoryDeltaSyncStateStore(),
        now: monotonicNow(),
      };
      if (moduleStrategies) options.moduleStrategies = moduleStrategies;
      const run = await runZohoDeltaSync(options);

      assert.equal(run.global_success, true);
      assert.equal(run.modules.Leads.cursor_advanced, true);
      assert.equal(modifiedScans, 1);
      assert.equal(snapshotScans, 0);
      assert.equal(recordUpserts, 1);
      assert.equal(snapshotUpserts, 0);
    });
  }
});

test('Last_Activity_Time cannot be configured as a timestamp cursor surrogate', async () => {
  let adapterCalls = 0;
  await assert.rejects(
    runZohoDeltaSync({
      modules: ['DealHistory'],
      moduleStrategies: {
        DealHistory: { mode: 'timestamp', timestamp_field: 'Last_Activity_Time' },
      },
      listModified: async () => { adapterCalls += 1; return { data: [], info: {} }; },
      fetchRecord: async () => { adapterCalls += 1; return {}; },
      upsertRecord: async () => { adapterCalls += 1; },
      stateStore: createInMemoryDeltaSyncStateStore(),
      now: monotonicNow(),
    }),
    error => error instanceof DeltaSyncError && error.code === 'UNSUPPORTED_TIMESTAMP_FIELD',
  );
  assert.equal(adapterCalls, 0);
});
