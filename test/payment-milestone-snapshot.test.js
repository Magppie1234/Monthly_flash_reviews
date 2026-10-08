'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  PAYMENT_MILESTONE_MODULE,
  createPaymentMilestoneSnapshotAdapter,
  validateCapabilityEnvelope,
  validateSnapshotListRequest,
  validateStorageCapabilityProbe,
} = require('../lib/payment-milestone-snapshot');

const NOW = '2026-08-30T12:00:00.000Z';
const IDS = ['1032257000000000001', '1032257000000000002'];

function capabilityFields(overrides = []) {
  return {
    fields: [
      { api_name: 'id' },
      { api_name: 'Name' },
      { api_name: 'Last_Activity_Time' },
      ...overrides,
    ],
  };
}

function toRow(module, record, sourceSeenAt) {
  return {
    module,
    id: record.id,
    data: { ...record },
    name: record.Name,
    search_text: record.Name,
    created_time: null,
    modified_time: null,
    source_org_id: 'org60046349006',
    source_seen_at: sourceSeenAt,
  };
}

test('capability accepts the exact timestamp-less identity contract', () => {
  assert.equal(validateCapabilityEnvelope(capabilityFields()), true);
});

test('capability fails closed on missing, duplicate, malformed, or timestamp-bearing metadata', () => {
  const failures = [
    null,
    {},
    { fields: [] },
    { fields: [{ api_name: 'id' }] },
    { fields: [{ api_name: 'id' }, { api_name: 'Name' }, { api_name: 'Name' }] },
    { fields: [{ api_name: 'id' }, { api_name: 'Name' }, { label: 'Broken' }] },
    capabilityFields([{ api_name: 'Modified_Time' }]),
  ];
  for (const value of failures) {
    assert.throws(() => validateCapabilityEnvelope(value), /metadata|identity|Modified_Time/i);
  }
});

test('list contract accepts only one bounded ascending ID page', async () => {
  const calls = [];
  const adapter = createPaymentMilestoneSnapshotAdapter({
    sourceGet: async pathname => { calls.push(pathname); return { data: [], info: { more_records: false } }; },
    upsertRows: async () => 1,
    recordToRow: toRow,
  });
  const response = await adapter.listSnapshotIds({
    module: PAYMENT_MILESTONE_MODULE,
    page: 1,
    pageToken: null,
    perPage: 200,
    sortBy: 'id',
    sortOrder: 'asc',
  });
  assert.deepEqual(response, { data: [], info: { more_records: false } });
  assert.deepEqual(calls, ['/crm/v8/Payment_Milestones?fields=Name&per_page=200&sort_by=id&sort_order=asc&page=1']);

  for (const override of [
    { module: 'Deals' }, { page: 2 }, { pageToken: 'token' }, { perPage: 201 },
    { sortBy: 'Name' }, { sortOrder: 'desc' },
  ]) {
    assert.throws(() => validateSnapshotListRequest({
      module: PAYMENT_MILESTONE_MODULE,
      page: 1,
      pageToken: null,
      perPage: 200,
      sortBy: 'id',
      sortOrder: 'asc',
      ...override,
    }), /bounded ID-ordered page/);
  }
});

test('capability is checked from source on every explicit preflight', async () => {
  let calls = 0;
  const adapter = createPaymentMilestoneSnapshotAdapter({
    sourceGet: async pathname => {
      calls += 1;
      assert.equal(pathname, '/crm/v8/settings/fields?module=Payment_Milestones');
      return capabilityFields();
    },
    upsertRows: async () => 1,
    recordToRow: toRow,
  });
  assert.equal(await adapter.assertCapability(), true);
  assert.equal(await adapter.assertCapability(), true);
  assert.equal(calls, 2);
});

test('storage preflight accepts only the exact zero-write invalid-batch canary rejection', async () => {
  const exact = {
    status: 400,
    error: { code: '22023', message: 'invalid payment milestone snapshot batch' },
  };
  assert.equal(validateStorageCapabilityProbe(exact), true);

  for (const drift of [
    null,
    { status: 404, error: { code: 'PGRST202', message: 'function absent' } },
    { status: 200, error: null },
    { status: 400, error: { code: '22023', message: 'different rejection' } },
  ]) {
    assert.throws(
      () => validateStorageCapabilityProbe(drift),
      error => error.code === 'SNAPSHOT_STORAGE_UNVERIFIED'
        && !error.message.includes('function absent')
        && !error.message.includes('different rejection'),
    );
  }
});

test('adapter storage preflight is mandatory, fresh, and sanitizes probe failures', async () => {
  const base = {
    sourceGet: async () => capabilityFields(),
    upsertRows: async () => 1,
    recordToRow: toRow,
  };
  const missing = createPaymentMilestoneSnapshotAdapter(base);
  await assert.rejects(() => missing.assertStorageCapability(), error => error.code === 'SNAPSHOT_STORAGE_UNVERIFIED');

  let calls = 0;
  const exact = createPaymentMilestoneSnapshotAdapter({
    ...base,
    storageProbe: async () => {
      calls += 1;
      return { status: 400, error: { code: '22023', message: 'invalid payment milestone snapshot batch' } };
    },
  });
  assert.equal(await exact.assertStorageCapability(), true);
  assert.equal(await exact.assertStorageCapability(), true);
  assert.equal(calls, 2);

  const failed = createPaymentMilestoneSnapshotAdapter({
    ...base,
    storageProbe: async () => { throw new Error('private database response'); },
  });
  await assert.rejects(
    () => failed.assertStorageCapability(),
    error => error.code === 'SNAPSHOT_STORAGE_UNVERIFIED'
      && !error.message.includes('private database response'),
  );
});

test('snapshot rows share one source observation and commit in one exact atomic batch', async () => {
  const batches = [];
  const adapter = createPaymentMilestoneSnapshotAdapter({
    sourceGet: async () => capabilityFields(),
    upsertRows: async rows => { batches.push(rows); return rows.length; },
    recordToRow: toRow,
    now: () => new Date(NOW),
  });
  const result = await adapter.upsertSnapshot({
    module: PAYMENT_MILESTONE_MODULE,
    records: IDS.map((id, index) => ({ id, Name: `Milestone ${index + 1}`, Last_Activity_Time: NOW })),
  });
  assert.deepEqual(result, { processed: 2 });
  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, 2);
  assert.deepEqual(batches[0].map(row => row.id), IDS);
  assert.ok(batches[0].every(row => row.modified_time === null && row.source_seen_at === NOW));
  assert.ok(batches[0].every(row => row.data.Last_Activity_Time === NOW));
});

test('Last_Activity_Time is never promoted to Modified_Time', async () => {
  const rowsSeen = [];
  const adapter = createPaymentMilestoneSnapshotAdapter({
    sourceGet: async () => capabilityFields(),
    upsertRows: async rows => { rowsSeen.push(...rows); return rows.length; },
    recordToRow: toRow,
    now: () => NOW,
  });
  await adapter.upsertSnapshot({
    module: PAYMENT_MILESTONE_MODULE,
    records: [{ id: IDS[0], Name: 'Milestone', Last_Activity_Time: '2026-08-29T00:00:00.000Z' }],
  });
  assert.equal(rowsSeen[0].modified_time, null);
  assert.equal(rowsSeen[0].data.Last_Activity_Time, '2026-08-29T00:00:00.000Z');
});

test('snapshot upsert rejects drift, duplicates, malformed rows, and partial commit counts', async () => {
  const base = {
    sourceGet: async () => capabilityFields(),
    recordToRow: toRow,
    now: () => NOW,
  };
  const exact = createPaymentMilestoneSnapshotAdapter({ ...base, upsertRows: async rows => rows.length });
  await assert.rejects(
    exact.upsertSnapshot({ module: 'Deals', records: [{ id: IDS[0], Name: 'A' }] }),
    /restricted to Payment_Milestones/,
  );
  await assert.rejects(
    exact.upsertSnapshot({ module: PAYMENT_MILESTONE_MODULE, records: [] }),
    /bounded non-empty array/,
  );
  await assert.rejects(
    exact.upsertSnapshot({ module: PAYMENT_MILESTONE_MODULE, records: [{ id: IDS[0] }, { id: IDS[0] }] }),
    /unique numeric source IDs/,
  );
  await assert.rejects(
    exact.upsertSnapshot({ module: PAYMENT_MILESTONE_MODULE, records: [{ id: Number(IDS[0]) }] }),
    /unique numeric source IDs/,
  );
  await assert.rejects(
    exact.upsertSnapshot({ module: PAYMENT_MILESTONE_MODULE, records: [{ id: IDS[0], Modified_Time: null }] }),
    /Timestamp-bearing rows/,
  );

  const partial = createPaymentMilestoneSnapshotAdapter({ ...base, upsertRows: async () => 0 });
  await assert.rejects(
    partial.upsertSnapshot({ module: PAYMENT_MILESTONE_MODULE, records: [{ id: IDS[0], Name: 'A' }] }),
    /atomic payment milestone snapshot upsert was incomplete/,
  );

  const malformed = createPaymentMilestoneSnapshotAdapter({
    ...base,
    upsertRows: async () => 1,
    recordToRow: (module, record, sourceSeenAt) => ({
      ...toRow(module, record, sourceSeenAt),
      modified_time: record.Last_Activity_Time,
    }),
  });
  await assert.rejects(
    malformed.upsertSnapshot({ module: PAYMENT_MILESTONE_MODULE, records: [{ id: IDS[0], Last_Activity_Time: NOW }] }),
    /normalization failed closed/,
  );
});
