'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  DeletionSyncError,
  createInMemoryDeletionSyncStateStore,
  createPersistedDeletionSyncStateStore,
  runZohoDeletionSync,
} = require('../lib/zoho-deletion-sync');

const BASELINE_TIME = '2026-07-31T00:00:00.000Z';
const DEFAULT_WINDOW_SINCE = '2026-07-30T23:59:59.000Z';
const RUN_TIME = '2026-08-30T00:00:00.000Z';

function readyState(modules, overrides = {}) {
  return {
    schema_version: 1,
    modules: Object.fromEntries(modules.map(module => [module, {
      baseline: { status: 'ready', established_at: BASELINE_TIME },
      successful_through: null,
      window: null,
      ...(overrides[module] || {}),
    }])),
    fairness: { next_module: null },
    last_completed_run: null,
    last_successful_run: null,
  };
}

function fixedNow() {
  return new Date(RUN_TIME);
}

function syntheticDeletions(count, { offset = 0, type = 'permanent' } = {}) {
  const epoch = Date.parse('2026-08-01T00:00:00.000Z');
  return Array.from({ length: count }, (_, index) => ({
    id: (10_000_000_000_000_000n + BigInt(offset + index + 1)).toString(),
    deleted_time: new Date(epoch + (offset + index + 1) * 1_000).toISOString(),
    type,
    ignored_private_field: `never-persist-${index}`,
  }));
}

function candidateTuples(events) {
  return events.map(event => ({
    record_id: String(event.id ?? event.record_id),
    deleted_time: new Date(event.deleted_time).toISOString(),
    deletion_type: event.type ?? event.deletion_type,
  })).sort((left, right) => left.deleted_time.localeCompare(right.deleted_time)
    || left.record_id.localeCompare(right.record_id)
    || left.deletion_type.localeCompare(right.deletion_type));
}

function candidateDigest(candidates) {
  const hash = crypto.createHash('sha256');
  for (const event of candidates) {
    hash.update(`${event.deleted_time}\u0000${event.record_id}\u0000${event.deletion_type}\n`);
  }
  return hash.digest('hex');
}

function persistedWindow(events, {
  since = BASELINE_TIME,
  through = RUN_TIME,
  confirmed = true,
  cursor = null,
} = {}) {
  const candidates = candidateTuples(events);
  return {
    since,
    through,
    digest: candidateDigest(candidates),
    count: candidates.length,
    candidates,
    confirmed,
    cursor,
  };
}

function pagedDeletedSource(eventsByModule, calls = []) {
  return async ({ module, page, perPage, ifModifiedSince, type }) => {
    calls.push({ module, page, perPage, ifModifiedSince, type });
    const events = eventsByModule instanceof Map ? eventsByModule.get(module) : eventsByModule;
    const offset = (page - 1) * perPage;
    const data = events.slice(offset, offset + perPage);
    return {
      data,
      info: {
        page,
        more_records: offset + data.length < events.length,
      },
    };
  };
}

function archiveSuccess(callback = () => {}) {
  return async event => {
    callback(event);
    return { processed: true, applied: true };
  };
}

test('more than 800 deletions converge over bounded fair runs and complete two-pass page scans', async () => {
  const events = syntheticDeletions(1_005);
  const calls = [];
  const archived = [];
  const stateStore = createInMemoryDeletionSyncStateStore(readyState(['Leads']));
  const runs = [];

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const run = await runZohoDeletionSync({
      modules: ['Leads'],
      listDeleted: pagedDeletedSource(events, calls),
      archiveRecord: archiveSuccess(event => archived.push(event.recordId)),
      stateStore,
      now: fixedNow,
      clockSkewMs: 0,
      maxRecordsPerModule: 250,
      maxRecordsPerRun: 250,
    });
    runs.push(run);
    if (run.global_success) break;
  }

  assert.equal(runs.length, 6);
  assert.equal(runs[0].modules.Leads.reason_code, 'DELETION_WINDOW_CONFIRMATION_REQUIRED');
  assert.equal(runs[0].record_budget.attempted, 0);
  assert.ok(runs.slice(0, 5).every(run => run.status === 'partial'));
  assert.equal(runs.at(-1).status, 'succeeded');
  assert.equal(runs.at(-1).modules.Leads.pages_scanned, 12);
  assert.equal(archived.length, events.length);
  assert.equal(new Set(archived).size, events.length);
  assert.ok(calls.every(call => call.type === 'all' && call.ifModifiedSince === DEFAULT_WINDOW_SINCE));
  assert.ok(calls.some(call => call.page === 6));

  const state = stateStore.snapshot();
  assert.equal(state.modules.Leads.window, null);
  assert.equal(state.modules.Leads.successful_through, RUN_TIME);
  assert.equal(state.last_completed_run.global_success, true);
  assert.equal(state.last_successful_run.global_success, true);
});

test('a page N source failure has zero archive effects and preserves a null cursor', async () => {
  const stateStore = createInMemoryDeletionSyncStateStore(readyState(['Tasks']));
  let archives = 0;
  const run = await runZohoDeletionSync({
    modules: ['Tasks'],
    listDeleted: async ({ page }) => {
      if (page === 2) throw new Error('private upstream token and URL');
      return {
        data: syntheticDeletions(200),
        info: { page, more_records: true },
      };
    },
    archiveRecord: archiveSuccess(() => { archives += 1; }),
    stateStore,
    now: fixedNow,
    clockSkewMs: 0,
  });

  assert.equal(run.global_success, false);
  assert.equal(run.modules.Tasks.status, 'error');
  assert.equal(run.modules.Tasks.reason_code, 'DELETION_LIST_FAILED');
  assert.equal(archives, 0);
  assert.equal(stateStore.snapshot().modules.Tasks.window.cursor, null);
  assert.equal(JSON.stringify(run).includes('private upstream'), false);
});

test('a later page failure preserves a previously persisted contiguous cursor', async () => {
  const prior = syntheticDeletions(1)[0];
  const priorCursor = {
    record_id: prior.id,
    deleted_time: prior.deleted_time,
    deletion_type: prior.type,
  };
  const stateStore = createInMemoryDeletionSyncStateStore(readyState(['Tasks'], {
    Tasks: {
      baseline: { status: 'ready', established_at: BASELINE_TIME },
      window: persistedWindow([prior], { cursor: priorCursor }),
    },
  }));
  const run = await runZohoDeletionSync({
    modules: ['Tasks'],
    listDeleted: async ({ page }) => {
      if (page === 2) throw new Error('unavailable');
      return { data: [prior], info: { page, more_records: true } };
    },
    archiveRecord: archiveSuccess(),
    stateStore,
    now: fixedNow,
  });

  assert.equal(run.modules.Tasks.reason_code, 'DELETION_LIST_FAILED');
  assert.deepEqual(stateStore.snapshot().modules.Tasks.window.cursor, priorCursor);
});

test('a repeated non-empty numbered page is rejected before archive effects', async () => {
  const stateStore = createInMemoryDeletionSyncStateStore(readyState(['Notes']));
  const repeated = syntheticDeletions(2);
  let archives = 0;
  const run = await runZohoDeletionSync({
    modules: ['Notes'],
    listDeleted: async ({ page }) => ({
      data: repeated,
      info: { page, more_records: page < 2 },
    }),
    archiveRecord: archiveSuccess(() => { archives += 1; }),
    stateStore,
    now: fixedNow,
    clockSkewMs: 0,
  });

  assert.equal(run.modules.Notes.status, 'partial');
  assert.equal(run.modules.Notes.reason_code, 'DELETION_PAGE_REPEATED');
  assert.equal(archives, 0);
  assert.equal(stateStore.snapshot().modules.Notes.window.cursor, null);
});

test('an unstable second pass archives nothing and retains the fixed window', async () => {
  const stateStore = createInMemoryDeletionSyncStateStore(readyState(['Calls']));
  const first = syntheticDeletions(1);
  const second = syntheticDeletions(2);
  let call = 0;
  let archives = 0;
  const run = await runZohoDeletionSync({
    modules: ['Calls'],
    listDeleted: async ({ page }) => {
      assert.equal(page, 1);
      call += 1;
      return {
        data: call === 1 ? first : second,
        info: { page: 1, more_records: false },
      };
    },
    archiveRecord: archiveSuccess(() => { archives += 1; }),
    stateStore,
    now: fixedNow,
    clockSkewMs: 0,
  });

  assert.equal(run.modules.Calls.reason_code, 'DELETION_SCAN_UNSTABLE');
  assert.equal(archives, 0);
  assert.deepEqual(stateStore.snapshot().modules.Calls.window, {
    since: DEFAULT_WINDOW_SINCE,
    through: RUN_TIME,
    digest: null,
    count: null,
    candidates: null,
    confirmed: false,
    cursor: null,
  });
});

test('pending baselines are disabled by default and make no source or local calls', async () => {
  const stateStore = createInMemoryDeletionSyncStateStore();
  let sourceCalls = 0;
  let localCalls = 0;
  const run = await runZohoDeletionSync({
    modules: ['Leads', 'Tasks'],
    listDeleted: async () => { sourceCalls += 1; return null; },
    archiveRecord: async () => { localCalls += 1; return { processed: true, applied: true }; },
    stateStore,
    now: fixedNow,
  });

  assert.equal(run.status, 'partial');
  assert.equal(run.global_success, false);
  assert.equal(sourceCalls, 0);
  assert.equal(localCalls, 0);
  assert.ok(run.module_results.every(result => result.reason_code === 'DELETION_BASELINE_REQUIRED'));
  assert.ok(Object.values(stateStore.snapshot().modules)
    .every(module => module.baseline.status === 'pending'));
});

test('shared and per-module budgets rotate the next starting module fairly', async () => {
  const modules = ['Leads', 'Tasks', 'Calls'];
  const events = new Map(modules.map((module, index) => [module, syntheticDeletions(3, {
    offset: index * 10,
  })]));
  const stateStore = createInMemoryDeletionSyncStateStore(readyState(modules));
  const attempts = [];
  const adapters = {
    modules,
    listDeleted: pagedDeletedSource(events),
    archiveRecord: archiveSuccess(event => attempts.push(event.module)),
    stateStore,
    now: fixedNow,
    clockSkewMs: 0,
    maxRecordsPerModule: 3,
    maxRecordsPerRun: 2,
  };

  const staged = await runZohoDeletionSync(adapters);
  assert.equal(staged.record_budget.attempted, 0);
  assert.ok(staged.module_results.every(result => (
    result.reason_code === 'DELETION_WINDOW_CONFIRMATION_REQUIRED'
  )));

  const first = await runZohoDeletionSync(adapters);
  assert.deepEqual(attempts, ['Leads', 'Tasks']);
  assert.equal(first.record_budget.attempted, 2);
  assert.equal(stateStore.snapshot().fairness.next_module, 'Calls');

  attempts.length = 0;
  const second = await runZohoDeletionSync(adapters);
  assert.deepEqual(attempts, ['Calls', 'Leads']);
  assert.equal(second.global_success, false);
  assert.equal(stateStore.snapshot().fairness.next_module, 'Tasks');
});

test('a shared source-request budget is never exceeded and rotates discovery after exhaustion', async () => {
  const modules = ['Leads', 'Tasks', 'Calls'];
  const events = new Map(modules.map((module, index) => [module, syntheticDeletions(1, {
    offset: index * 10,
  })]));
  const calls = [];
  const stateStore = createInMemoryDeletionSyncStateStore(readyState(modules));
  const options = {
    modules,
    listDeleted: pagedDeletedSource(events, calls),
    archiveRecord: archiveSuccess(() => assert.fail('Unconfirmed windows must have zero archive effects.')),
    stateStore,
    now: fixedNow,
    clockSkewMs: 0,
    maxPages: 1,
    maxSourceRequestsPerRun: 3,
  };
  const firstCallModules = [];

  for (let runIndex = 0; runIndex < 3; runIndex += 1) {
    const callStart = calls.length;
    const run = await runZohoDeletionSync(options);
    firstCallModules.push(calls[callStart].module);
    assert.deepEqual(run.source_request_budget, {
      limit: 3,
      used: 3,
      remaining_capacity: 0,
      estimated_api_credits: 6,
    });
    assert.equal(run.record_budget.attempted, 0);
    assert.ok(run.module_results.some(result => (
      result.reason_code === 'SOURCE_REQUEST_BUDGET_REACHED'
    )));
  }

  assert.deepEqual(firstCallModules, ['Leads', 'Calls', 'Tasks']);
  assert.equal(stateStore.snapshot().fairness.next_module, 'Leads');
  assert.ok(modules.every(module => stateStore.snapshot().modules[module].window.candidates?.length === 1));
  assert.deepEqual(stateStore.snapshot().last_completed_run.source_request_budget, {
    limit: 3,
    used: 3,
    remaining_capacity: 0,
    estimated_api_credits: 6,
  });
  assert.equal(calls.length, 9);
});

test('an archive failure closes only that module and advances only contiguous successes', async () => {
  const modules = ['Leads', 'Tasks'];
  const events = new Map(modules.map((module, index) => [module, syntheticDeletions(2, {
    offset: index * 10,
  })]));
  const stateStore = createInMemoryDeletionSyncStateStore(readyState(modules));
  const processed = [];
  const options = {
    modules,
    listDeleted: pagedDeletedSource(events),
    archiveRecord: async event => {
      if (event.module === 'Leads') throw new Error('private database detail');
      processed.push(event.recordId);
      return { processed: true, applied: true };
    },
    stateStore,
    now: fixedNow,
    clockSkewMs: 0,
    maxRecordsPerModule: 10,
    maxRecordsPerRun: 10,
  };
  const staged = await runZohoDeletionSync(options);
  assert.equal(staged.record_budget.attempted, 0);
  const run = await runZohoDeletionSync(options);

  assert.equal(run.status, 'partial');
  assert.equal(run.modules.Leads.reason_code, 'ARCHIVE_FAILED');
  assert.equal(run.modules.Leads.cursor_advanced, false);
  assert.equal(run.modules.Tasks.status, 'complete');
  assert.equal(processed.length, 2);
  assert.equal(stateStore.snapshot().modules.Leads.window.cursor, null);
  assert.equal(stateStore.snapshot().modules.Tasks.window, null);
  assert.equal(JSON.stringify(run).includes('private database'), false);
});

test('a later archive failure checkpoints contiguous successes without advancing successful_through', async () => {
  const events = syntheticDeletions(3);
  const candidates = candidateTuples(events);
  const stateStore = createInMemoryDeletionSyncStateStore(readyState(['Leads']));
  const archiveCalls = [];
  let failSecondOnce = true;
  const options = {
    modules: ['Leads'],
    listDeleted: pagedDeletedSource(events),
    archiveRecord: async event => {
      archiveCalls.push(event.recordId);
      if (event.recordId === events[1].id && failSecondOnce) {
        failSecondOnce = false;
        throw new Error('private downstream failure');
      }
      return { processed: true, applied: true };
    },
    stateStore,
    now: fixedNow,
    clockSkewMs: 0,
    maxRecordsPerModule: 10,
    maxRecordsPerRun: 10,
  };

  const staged = await runZohoDeletionSync(options);
  assert.equal(staged.modules.Leads.reason_code, 'DELETION_WINDOW_CONFIRMATION_REQUIRED');
  assert.deepEqual(archiveCalls, []);

  const partial = await runZohoDeletionSync(options);
  assert.equal(partial.status, 'partial');
  assert.equal(partial.modules.Leads.reason_code, 'ARCHIVE_FAILED');
  assert.equal(partial.modules.Leads.attempted_deletions, 2);
  assert.equal(partial.modules.Leads.processed_deletions, 1);
  assert.equal(partial.modules.Leads.remaining_deletions, 2);
  assert.equal(partial.modules.Leads.cursor_advanced, true);
  assert.deepEqual(archiveCalls, [events[0].id, events[1].id]);
  assert.deepEqual(stateStore.snapshot().modules.Leads.window.cursor, candidates[0]);
  assert.equal(stateStore.snapshot().modules.Leads.window.confirmed, true);
  assert.equal(stateStore.snapshot().modules.Leads.successful_through, null);

  const recovered = await runZohoDeletionSync(options);
  assert.equal(recovered.global_success, true);
  assert.equal(recovered.modules.Leads.processed_deletions, 2);
  assert.deepEqual(archiveCalls, [
    events[0].id,
    events[1].id,
    events[1].id,
    events[2].id,
  ]);
  assert.equal(stateStore.snapshot().modules.Leads.window, null);
  assert.equal(stateStore.snapshot().modules.Leads.successful_through, RUN_TIME);
});

test('idempotent replay recovers after a state-save failure without applying twice', async () => {
  const events = syntheticDeletions(1);
  let backingSnapshot = readyState(['Accounts']);
  let failSave = false;
  let archiveCalls = 0;
  let appliedCount = 0;
  const makeStore = () => createPersistedDeletionSyncStateStore({
    loadSnapshot: async () => backingSnapshot,
    saveSnapshot: async snapshot => {
      if (failSave) {
        failSave = false;
        throw new Error('private persistence failure');
      }
      backingSnapshot = snapshot;
    },
  });
  const archiveRecord = async () => {
    archiveCalls += 1;
    const applied = appliedCount === 0;
    if (applied) appliedCount += 1;
    return { processed: true, applied };
  };

  const common = {
    modules: ['Accounts'],
    listDeleted: pagedDeletedSource(events),
    archiveRecord,
    now: fixedNow,
    clockSkewMs: 0,
  };

  const staged = await runZohoDeletionSync({ ...common, stateStore: makeStore() });
  assert.equal(staged.modules.Accounts.reason_code, 'DELETION_WINDOW_CONFIRMATION_REQUIRED');
  assert.equal(archiveCalls, 0);
  failSave = true;

  await assert.rejects(
    runZohoDeletionSync({
      ...common,
      stateStore: makeStore(),
    }),
    error => error instanceof DeletionSyncError
      && error.code === 'STATE_PERSIST_FAILED'
      && !error.message.includes('private'),
  );

  const recovered = await runZohoDeletionSync({
    ...common,
    stateStore: makeStore(),
  });
  assert.equal(recovered.global_success, true);
  assert.equal(recovered.modules.Accounts.processed_deletions, 1);
  assert.equal(recovered.modules.Accounts.applied_deletions, 0);
  assert.equal(archiveCalls, 2);
  assert.equal(appliedCount, 1);
});

test('local and malformed IDs are rejected during both-pass discovery', async () => {
  for (const id of ['local-12345678', '1234567', '123456789012345678901234567890123']) {
    const stateStore = createInMemoryDeletionSyncStateStore(readyState(['Deals']));
    let archives = 0;
    const run = await runZohoDeletionSync({
      modules: ['Deals'],
      listDeleted: async ({ page }) => ({
        data: [{ id, deleted_time: '2026-08-02T00:00:00.000Z', type: 'permanent' }],
        info: { page, more_records: false },
      }),
      archiveRecord: archiveSuccess(() => { archives += 1; }),
      stateStore,
      now: fixedNow,
      clockSkewMs: 0,
    });
    assert.equal(run.modules.Deals.reason_code, 'DELETION_ENTRY_INVALID');
    assert.equal(archives, 0);
  }
});

test('null deletion timestamps and non-object page info are invalid', async () => {
  const invalidBodies = [
    {
      data: [{ id: '100000000000000001', deleted_time: null, type: 'permanent' }],
      info: { page: 1, more_records: false },
    },
    { data: [], info: Object.assign([], { more_records: false }) },
  ];
  for (const body of invalidBodies) {
    const stateStore = createInMemoryDeletionSyncStateStore(readyState(['Deals']));
    let archives = 0;
    const run = await runZohoDeletionSync({
      modules: ['Deals'],
      listDeleted: async () => body,
      archiveRecord: archiveSuccess(() => { archives += 1; }),
      stateStore,
      now: fixedNow,
      clockSkewMs: 0,
    });
    assert.ok(['DELETION_ENTRY_INVALID', 'DELETION_PAGE_INVALID']
      .includes(run.modules.Deals.reason_code));
    assert.equal(archives, 0);
  }
});

test('a monotonic candidate-set change resets confirmation and has zero archive effects', async () => {
  const events = syntheticDeletions(2);
  const prior = candidateTuples([events[0]])[0];
  const stateStore = createInMemoryDeletionSyncStateStore(readyState(['Quotes'], {
    Quotes: {
      baseline: { status: 'ready', established_at: BASELINE_TIME },
      window: persistedWindow([events[0]], { cursor: prior }),
    },
  }));
  const archived = [];
  const run = await runZohoDeletionSync({
    modules: ['Quotes'],
    listDeleted: pagedDeletedSource(events),
    archiveRecord: archiveSuccess(event => archived.push(event.recordId)),
    stateStore,
    now: fixedNow,
    maxRecordsPerModule: 1,
    maxRecordsPerRun: 1,
  });

  assert.deepEqual(archived, []);
  assert.equal(run.modules.Quotes.status, 'partial');
  assert.equal(run.modules.Quotes.reason_code, 'DELETION_WINDOW_CHANGED');
  assert.equal(stateStore.snapshot().modules.Quotes.window.confirmed, false);
  assert.equal(stateStore.snapshot().modules.Quotes.window.cursor, null);
  assert.deepEqual(stateStore.snapshot().modules.Quotes.window.candidates, candidateTuples(events));
});

test('a candidate-set regression retains the prior exact window and never advances the watermark', async () => {
  const events = syntheticDeletions(2);
  let currentEvents = events;
  const archived = [];
  const stateStore = createInMemoryDeletionSyncStateStore(readyState(['Quotes']));
  const options = {
    modules: ['Quotes'],
    listDeleted: async request => pagedDeletedSource(currentEvents)(request),
    archiveRecord: async event => {
      const firstApplication = !archived.includes(event.recordId);
      archived.push(event.recordId);
      return { processed: true, applied: firstApplication };
    },
    stateStore,
    now: fixedNow,
    clockSkewMs: 0,
    maxRecordsPerModule: 1,
    maxRecordsPerRun: 1,
  };

  const staged = await runZohoDeletionSync(options);
  assert.equal(staged.modules.Quotes.reason_code, 'DELETION_WINDOW_CONFIRMATION_REQUIRED');
  const partial = await runZohoDeletionSync(options);
  assert.equal(partial.modules.Quotes.processed_deletions, 1);
  const retainedWindow = stateStore.snapshot().modules.Quotes.window;
  assert.equal(retainedWindow.confirmed, true);
  currentEvents = [events[0]];

  const regression = await runZohoDeletionSync(options);
  assert.equal(regression.modules.Quotes.reason_code, 'DELETION_WINDOW_REGRESSION');
  assert.equal(regression.modules.Quotes.remaining_deletions, 1);
  assert.deepEqual(archived, [events[0].id]);
  assert.deepEqual(stateStore.snapshot().modules.Quotes.window, retainedWindow);
  assert.equal(stateStore.snapshot().modules.Quotes.successful_through, null);
});

test('duplicate record IDs are rejected within a page and across pages, including type variants', async () => {
  const id = '100000000000000099';
  const events = [
    { id, deleted_time: '2026-08-02T00:00:00.000Z', type: 'recycle', deleted_by: { secret: true } },
    { id, deleted_time: '2026-08-03T00:00:00.000Z', type: 'permanent', display_name: 'Private Name' },
  ];
  const sources = [
    pagedDeletedSource(events),
    async ({ page }) => ({
      data: [events[page - 1]],
      info: { page, more_records: page === 1 },
    }),
  ];
  for (const listDeleted of sources) {
    const stateStore = createInMemoryDeletionSyncStateStore(readyState(['Contacts']));
    let archives = 0;
    const run = await runZohoDeletionSync({
      modules: ['Contacts'],
      listDeleted,
      archiveRecord: archiveSuccess(() => { archives += 1; }),
      stateStore,
      now: fixedNow,
      clockSkewMs: 0,
    });
    assert.equal(run.modules.Contacts.reason_code, 'DELETION_RECORD_DUPLICATE');
    assert.equal(archives, 0);
    assert.equal(stateStore.snapshot().modules.Contacts.window.candidates, null);
    assert.equal(JSON.stringify(run).includes(id), false);
  }
});

test('private source fields never leave discovery or aggregate run summaries', async () => {
  const id = '100000000000000099';
  const events = [{
    id,
    deleted_time: '2026-08-03T00:00:00.000Z',
    type: 'permanent',
    deleted_by: { secret: true },
    display_name: 'Private Name',
  }];
  const stateStore = createInMemoryDeletionSyncStateStore(readyState(['Contacts']));
  const received = [];
  const options = {
    modules: ['Contacts'],
    listDeleted: pagedDeletedSource(events),
    archiveRecord: archiveSuccess(event => received.push(event)),
    stateStore,
    now: fixedNow,
    clockSkewMs: 0,
  };
  const staged = await runZohoDeletionSync(options);
  assert.equal(staged.modules.Contacts.reason_code, 'DELETION_WINDOW_CONFIRMATION_REQUIRED');
  const stagedWindow = stateStore.snapshot().modules.Contacts.window;
  assert.deepEqual(stagedWindow.candidates, candidateTuples(events));
  assert.equal(stagedWindow.confirmed, false);
  assert.equal(JSON.stringify(stagedWindow).includes('Private Name'), false);
  assert.equal(JSON.stringify(stagedWindow).includes('secret'), false);
  const run = await runZohoDeletionSync(options);
  assert.equal(run.global_success, true);
  assert.deepEqual(received, [{
    module: 'Contacts',
    recordId: id,
    deletedTime: '2026-08-03T00:00:00.000Z',
    deletionType: 'permanent',
  }]);
  assert.equal(JSON.stringify(run).includes(id), false);
  assert.equal(JSON.stringify(run).includes('digest'), false);
  assert.equal(JSON.stringify(stateStore.snapshot().last_completed_run).includes(id), false);
  assert.equal(JSON.stringify(stateStore.snapshot().last_completed_run).includes('digest'), false);
});

test('Zoho per_page accepts only integer boundaries from 1 through 200', async () => {
  for (const perPage of [0, 201, 1.5, '200']) {
    await assert.rejects(
      runZohoDeletionSync({
        modules: ['Leads'],
        listDeleted: async () => null,
        archiveRecord: archiveSuccess(),
        stateStore: createInMemoryDeletionSyncStateStore(readyState(['Leads'])),
        now: fixedNow,
        perPage,
      }),
      error => error instanceof DeletionSyncError && error.code === 'INVALID_LIMIT',
    );
  }

  for (const perPage of [1, 200]) {
    const calls = [];
    const events = syntheticDeletions(2);
    const run = await runZohoDeletionSync({
      modules: ['Leads'],
      listDeleted: pagedDeletedSource(events, calls),
      archiveRecord: archiveSuccess(() => assert.fail('A first-seen window must not archive.')),
      stateStore: createInMemoryDeletionSyncStateStore(readyState(['Leads'])),
      now: fixedNow,
      clockSkewMs: 0,
      perPage,
      maxPages: 5,
      maxSourceRequestsPerRun: 10,
    });
    assert.equal(run.modules.Leads.reason_code, 'DELETION_WINDOW_CONFIRMATION_REQUIRED');
    assert.ok(calls.every(call => call.perPage === perPage));
    assert.equal(run.source_request_budget.used, perPage === 1 ? 4 : 2);
  }
});

test('maxPages must fit two complete discovery passes inside the source-request budget', async () => {
  for (const limits of [
    { maxPages: 51, maxSourceRequestsPerRun: 100 },
    { maxPages: 50, maxSourceRequestsPerRun: 99 },
    { maxPages: 1, maxSourceRequestsPerRun: 1 },
  ]) {
    let sourceCalls = 0;
    await assert.rejects(
      runZohoDeletionSync({
        modules: ['Leads'],
        listDeleted: async () => {
          sourceCalls += 1;
          return { status: 204, data: [] };
        },
        archiveRecord: archiveSuccess(),
        stateStore: createInMemoryDeletionSyncStateStore(readyState(['Leads'])),
        now: fixedNow,
        ...limits,
      }),
      error => error instanceof DeletionSyncError && error.code === 'INVALID_LIMIT',
    );
    assert.equal(sourceCalls, 0);
  }
});

test('a 51-page window fails closed at defaults and a paired larger budget permits discovery', async () => {
  const events = syntheticDeletions(51);
  const makeSource = calls => async ({ page }) => {
    calls.push(page);
    return {
      data: [events[page - 1]],
      info: { page, more_records: page < events.length },
    };
  };
  const defaultCalls = [];
  const defaultState = createInMemoryDeletionSyncStateStore(readyState(['Leads']));
  let archives = 0;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const run = await runZohoDeletionSync({
      modules: ['Leads'],
      listDeleted: makeSource(defaultCalls),
      archiveRecord: archiveSuccess(() => { archives += 1; }),
      stateStore: defaultState,
      now: fixedNow,
      clockSkewMs: 0,
    });
    assert.equal(run.modules.Leads.reason_code, 'DELETION_PAGE_BOUND_REACHED');
    assert.equal(run.modules.Leads.pages_scanned, 50);
    assert.equal(run.source_request_budget.used, 50);
    assert.equal(defaultCalls.length, (attempt + 1) * 50);
    assert.equal(defaultState.snapshot().modules.Leads.window.candidates, null);
    assert.equal(defaultState.snapshot().modules.Leads.successful_through, null);
  }
  assert.equal(archives, 0);

  const expandedCalls = [];
  const expandedState = createInMemoryDeletionSyncStateStore(readyState(['Leads']));
  const expanded = await runZohoDeletionSync({
    modules: ['Leads'],
    listDeleted: makeSource(expandedCalls),
    archiveRecord: archiveSuccess(() => assert.fail('A first-seen window must not archive.')),
    stateStore: expandedState,
    now: fixedNow,
    clockSkewMs: 0,
    maxPages: 51,
    maxSourceRequestsPerRun: 102,
  });
  assert.equal(expanded.modules.Leads.reason_code, 'DELETION_WINDOW_CONFIRMATION_REQUIRED');
  assert.equal(expanded.modules.Leads.pages_scanned, 102);
  assert.equal(expanded.source_request_budget.used, 102);
  assert.equal(expandedCalls.length, 102);
  assert.equal(expandedState.snapshot().modules.Leads.window.candidates.length, 51);
  assert.equal(expandedState.snapshot().modules.Leads.successful_through, null);
});

test('strict page validation and page bounds prevent all archive effects', async () => {
  const cases = [
    {
      name: 'missing more_records',
      source: async () => ({ data: [], info: {} }),
      reason: 'DELETION_PAGE_INVALID',
    },
    {
      name: 'mismatched page',
      source: async () => ({ data: [], info: { page: 9, more_records: false } }),
      reason: 'DELETION_PAGE_MISMATCH',
    },
    {
      name: 'page bound',
      source: async ({ page }) => ({
        data: syntheticDeletions(1, { offset: page }),
        info: { page, more_records: true },
      }),
      reason: 'DELETION_PAGE_BOUND_REACHED',
    },
    {
      name: 'oversized page body',
      source: async ({ page }) => ({
        data: syntheticDeletions(2),
        info: { page, more_records: false },
      }),
      reason: 'DELETION_PAGE_INVALID',
      options: { perPage: 1 },
    },
    {
      name: 'ambiguous no-content sentinel with pagination info',
      source: async ({ page }) => ({
        status: 204,
        data: [],
        info: { page, more_records: false },
      }),
      reason: 'DELETION_PAGE_INVALID',
    },
    {
      name: 'string no-content status',
      source: async ({ page }) => ({
        status: '304',
        data: [],
        info: { page, more_records: false },
      }),
      reason: 'DELETION_PAGE_INVALID',
    },
  ];

  for (const item of cases) {
    const stateStore = createInMemoryDeletionSyncStateStore(readyState(['Products']));
    let archives = 0;
    const run = await runZohoDeletionSync({
      modules: ['Products'],
      listDeleted: item.source,
      archiveRecord: archiveSuccess(() => { archives += 1; }),
      stateStore,
      now: fixedNow,
      clockSkewMs: 0,
      maxPages: 2,
      ...(item.options || {}),
    });
    assert.equal(run.modules.Products.reason_code, item.reason, item.name);
    assert.equal(archives, 0, item.name);
  }
});

test('null continuation after more_records is incomplete and archives nothing', async () => {
  const stateStore = createInMemoryDeletionSyncStateStore(readyState(['Tasks']));
  let archives = 0;
  const run = await runZohoDeletionSync({
    modules: ['Tasks'],
    listDeleted: async ({ page }) => page === 1
      ? {
        data: syntheticDeletions(1),
        info: { page, more_records: true },
      }
      : null,
    archiveRecord: archiveSuccess(() => { archives += 1; }),
    stateStore,
    now: fixedNow,
    clockSkewMs: 0,
  });

  assert.equal(run.modules.Tasks.status, 'partial');
  assert.equal(run.modules.Tasks.reason_code, 'DELETION_PAGE_INVALID');
  assert.equal(archives, 0);
  assert.equal(stateStore.snapshot().modules.Tasks.window.cursor, null);
});

test('bare null and undefined page bodies are invalid and never stage an empty window', async () => {
  for (const body of [null, undefined]) {
    const stateStore = createInMemoryDeletionSyncStateStore(readyState(['Vendors']));
    let archives = 0;
    const run = await runZohoDeletionSync({
      modules: ['Vendors'],
      listDeleted: async () => body,
      archiveRecord: archiveSuccess(() => { archives += 1; }),
      stateStore,
      now: fixedNow,
      clockSkewMs: 0,
    });

    assert.equal(run.global_success, false);
    assert.equal(run.modules.Vendors.reason_code, 'DELETION_PAGE_INVALID');
    assert.equal(run.modules.Vendors.pages_scanned, 1);
    assert.equal(archives, 0);
    assert.equal(stateStore.snapshot().modules.Vendors.window.candidates, null);
    assert.equal(stateStore.snapshot().modules.Vendors.successful_through, null);
  }
});

test('exact 204 and 304 no-content sentinels require cross-run confirmation', async () => {
  for (const status of [204, 304]) {
    const stateStore = createInMemoryDeletionSyncStateStore(readyState(['Vendors']));
    let calls = 0;
    const sentinel = Object.freeze({
      status,
      data: Object.freeze([]),
    });
    const options = {
      modules: ['Vendors'],
      listDeleted: async () => { calls += 1; return sentinel; },
      archiveRecord: archiveSuccess(),
      stateStore,
      now: fixedNow,
      clockSkewMs: 0,
    };

    const staged = await runZohoDeletionSync(options);
    assert.equal(staged.global_success, false);
    assert.equal(staged.modules.Vendors.reason_code, 'DELETION_WINDOW_CONFIRMATION_REQUIRED');
    assert.equal(stateStore.snapshot().modules.Vendors.successful_through, null);
    const run = await runZohoDeletionSync(options);
    assert.equal(calls, 4);
    assert.equal(run.global_success, true);
    assert.equal(run.modules.Vendors.discovered_deletions, 0);
    assert.equal(stateStore.snapshot().modules.Vendors.successful_through, RUN_TIME);
  }
});
