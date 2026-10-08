'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const currentReconciliation = require('../config/task-subform-reconciliation.json');
const {
  TARGETS,
  assertSourcePath,
  classifyCountScope,
  chunks,
  diff,
  fieldChunks,
  hashIds,
  mergeChunkRows,
  privateAuditPathForMode,
  safeAuditModule,
  validateSourceRecord,
} = require('../scripts/reconcile-task-subform-gaps');

test('source CRM allowlist permits only GET reconciliation paths', () => {
  assert.doesNotThrow(() => assertSourcePath('/crm/v8/org'));
  for (const target of TARGETS) {
    assert.doesNotThrow(() => assertSourcePath(`/crm/v8/settings/fields?module=${target.module}`));
    assert.doesNotThrow(() => assertSourcePath(`/crm/v8/${target.module}?fields=Modified_Time&per_page=200&page=1`));
    assert.doesNotThrow(() => assertSourcePath(`/crm/v8/${target.module}/actions/count`));
  }
  assert.throws(() => assertSourcePath('/crm/v8/Deals'));
  assert.throws(() => assertSourcePath('/crm/v8/Tasks/123'));
  assert.throws(() => assertSourcePath('/crm/v8/Deals?fields=Deal_Name&per_page=200&page=1'));
  assert.throws(() => assertSourcePath('https://example.com/crm/v8/Tasks'));
});

test('ID diff and digest are exact and deterministic', () => {
  const source = new Set(['3', '1', '2']);
  const local = new Set(['1', '3', '4']);
  assert.deepEqual(diff(source, local), ['2']);
  assert.deepEqual(diff(local, source), ['4']);
  assert.equal(hashIds(source), hashIds(new Set(['1', '2', '3'])));
  assert.notEqual(hashIds(source), hashIds(local));
});

test('count-only subform rows stay blocked while default-module count drift fails closed', () => {
  assert.deepEqual(classifyCountScope(TARGETS[1], 822, 786), {
    delta: 36,
    blocker: '36 count-only rows have no IDs or payloads in the active records API and are not importable',
  });
  assert.deepEqual(classifyCountScope(TARGETS[1], 786, 786), { delta: 0, blocker: null });
  assert.throws(() => classifyCountScope(TARGETS[1], 785, 786));
  assert.throws(() => classifyCountScope(TARGETS[0], 12422, 12421));
});

test('field planning excludes unsafe nested/file payloads and stays within 45 fields', () => {
  const fields = [
    ...Array.from({ length: 50 }, (_, index) => ({ api_name: `Field_${index}`, data_type: 'text' })),
    { api_name: 'Nested', data_type: 'subform' },
    { api_name: 'File', data_type: 'fileupload' },
    { api_name: 'id', data_type: 'bigint' },
  ];
  const planned = fieldChunks(fields);
  assert.deepEqual(planned.map(chunk => chunk.length), [45, 7]);
  assert.ok(planned.every(chunk => chunk.length <= 45));
  assert.ok(planned.flat().includes('Created_Time'));
  assert.ok(planned.flat().includes('Modified_Time'));
  assert.ok(!planned.flat().includes('Nested'));
  assert.ok(!planned.flat().includes('File'));
  assert.ok(!planned.flat().includes('id'));
  assert.deepEqual(chunks(['1', '2', '3'], 2), [['1', '2'], ['3']]);
});

test('chunk merging preserves complete source payloads and rejects duplicate IDs', () => {
  const records = new Map();
  const first = mergeChunkRows(records, [
    { id: '1', Created_Time: '2026-01-01', Field_A: null },
    { id: '2', Created_Time: '2026-01-02', Field_A: 'x' },
  ], ['Created_Time', 'Field_A']);
  assert.equal(first.ids.size, 2);
  mergeChunkRows(records, [
    { id: '1', Modified_Time: '2026-02-01', Field_B: 1 },
    { id: '2', Modified_Time: '2026-02-02', Field_B: 2 },
  ], ['Modified_Time', 'Field_B']);
  assert.deepEqual(records.get('1'), {
    id: '1', Created_Time: '2026-01-01', Field_A: null, Modified_Time: '2026-02-01', Field_B: 1,
  });
  assert.throws(() => mergeChunkRows(new Map(), [{ id: '1' }, { id: '1' }], []));
});

test('subform rows require the exact configured parent while Tasks do not invent one', () => {
  const base = { id: '101', Created_Time: '2026-01-01T00:00:00+05:30', Modified_Time: '2026-01-01T00:00:00+05:30' };
  assert.doesNotThrow(() => validateSourceRecord(TARGETS[0], base));
  assert.doesNotThrow(() => validateSourceRecord(TARGETS[1], {
    ...base, Parent_Id: { id: '201', module: { api_name: 'Deals' } },
  }));
  assert.doesNotThrow(() => validateSourceRecord(TARGETS[1], {
    ...base, Parent_Id: { id: '201' },
  }));
  assert.throws(() => validateSourceRecord(TARGETS[1], { ...base, Parent_Id: { id: '201', module: 'Contacts' } }));
  assert.throws(() => validateSourceRecord(TARGETS[1], base));
});

test('private audit evidence contains exact ID sets and counts but never source payload fields', () => {
  assert.equal(privateAuditPathForMode(false, { latest: 'latest', preview: 'preview' }), 'preview');
  assert.equal(privateAuditPathForMode(true, { latest: 'latest', preview: 'preview' }), 'latest');
  assert.equal(currentReconciliation.summary.source_count_endpoint_total, 24986);
  assert.equal(currentReconciliation.summary.source_active_id_total, 20249);
  assert.equal(currentReconciliation.summary.local_source_id_total_after, 20249);
  assert.equal(currentReconciliation.summary.imported_total, 0);
  assert.equal(currentReconciliation.summary.historical_imported_total, 2);
  const taskEvidence = currentReconciliation.datasets.find(dataset => dataset.module === 'Tasks');
  assert.deepEqual({
    source: taskEvidence.source_active_ids,
    localBefore: taskEvidence.local_before,
    imported: taskEvidence.imported,
    localAfter: taskEvidence.local_after,
    sourceOnlyAfter: taskEvidence.source_only_after,
    localOnlyAfter: taskEvidence.local_only_after,
    historicalImported: taskEvidence.historical_imported,
  }, {
    source: 12422,
    localBefore: 12422,
    imported: 0,
    localAfter: 12422,
    sourceOnlyAfter: 0,
    localOnlyAfter: 0,
    historicalImported: 1,
  });
  const source = {
    reported_count: 2,
    records: new Map([
      ['1', { id: '1', Subject: 'must not appear' }],
      ['2', { id: '2', Description: 'must not appear' }],
    ]),
    count_scope_delta: 0,
    active_id_authority: 'GET /crm/v8/Tasks',
    count_only_blocker: null,
    chunk_coverage: [{ chunk: 1, enumerated_record_count: 2 }],
  };
  const audit = safeAuditModule(TARGETS[0], source, new Set(['1']), ['2'], []);
  const serialized = JSON.stringify(audit);
  assert.deepEqual(audit.source_only_ids, ['2']);
  assert.equal(audit.source_only_count_before, 1);
  assert.ok(!serialized.includes('must not appear'));
  assert.ok(!serialized.includes('Subject'));
  assert.ok(!serialized.includes('Description'));
});
