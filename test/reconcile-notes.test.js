'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const {
  AUDIT_KEYS,
  EMPTY_SET_SHA256,
  PRIVATE_AUDIT,
  assertSourcePath,
  buildSanitizedAudit,
  parseArguments,
  sourceActiveNoteIds,
  sourceNoteCount,
  validatePersistableAudit,
  writePrivateAudit,
} = require('../scripts/reconcile-notes');

const STARTED_AT = '2026-08-30T15:59:59.000Z';
const COMPLETED_AT = '2026-08-30T16:00:00.000Z';

function exactAudit() {
  return buildSanitizedAudit({
    sourceIds: new Set(['918000000000000001', '918000000000000002']),
    localIds: new Set(['918000000000000002', '918000000000000001']),
    sourceCountEndpoint: 3,
    startedAt: STARTED_AT,
    completedAt: COMPLETED_AT,
  });
}

test('private Notes evidence uses the dedicated reconciliation path', () => {
  assert.equal(
    PRIVATE_AUDIT,
    path.join(__dirname, '..', '.private', 'data-reconciliation', 'notes-latest.json'),
  );
});

test('Notes source allowlist is limited to the organization, active enumeration, and count GET paths', () => {
  assert.doesNotThrow(() => assertSourcePath('/crm/v8/org'));
  assert.doesNotThrow(() => assertSourcePath('/crm/v8/Notes/actions/count'));
  assert.doesNotThrow(() => assertSourcePath('/crm/v8/Notes?fields=Modified_Time&per_page=200&page=1'));
  assert.doesNotThrow(() => assertSourcePath('/crm/v8/Notes?fields=Modified_Time&per_page=200&page_token=safe-token'));
  assert.throws(() => assertSourcePath('/crm/v8/Notes/918000000000000001'));
  assert.throws(() => assertSourcePath('/crm/v8/Notes?fields=Note_Content&per_page=200&page=1'));
  assert.throws(() => assertSourcePath('/crm/v8/Notes?fields=Modified_Time&per_page=200&page=2'));
  assert.throws(() => assertSourcePath('/crm/v8/Deals'));
  assert.throws(() => assertSourcePath('https://example.com/crm/v8/Notes'));
});

test('CLI has no record-apply mode', () => {
  assert.deepEqual(parseArguments([]), { persistAudit: false, help: false });
  assert.deepEqual(parseArguments(['--audit']), { persistAudit: true, help: false });
  assert.deepEqual(parseArguments(['--help']), { persistAudit: false, help: true });
  assert.throws(() => parseArguments(['--apply']));
});

test('active Notes pagination is exhaustive, unique, and keeps IDs in memory only', async () => {
  const requested = [];
  const ids = await sourceActiveNoteIds(async pathname => {
    requested.push(pathname);
    if (requested.length === 1) return {
      data: [{ id: '918000000000000001' }, { id: '918000000000000002' }],
      info: { more_records: true, next_page_token: 'next' },
    };
    return {
      data: [{ id: '918000000000000003' }],
      info: { more_records: false },
    };
  });
  assert.deepEqual([...ids].sort(), [
    '918000000000000001',
    '918000000000000002',
    '918000000000000003',
  ]);
  assert.equal(requested.length, 2);
  assert.match(requested[1], /page_token=next/);
});

test('count evidence must be an observed non-negative integer', async () => {
  assert.equal(await sourceNoteCount(async () => ({ count: 42 })), 42);
  await assert.rejects(() => sourceNoteCount(async () => ({ count: null })));
  await assert.rejects(() => sourceNoteCount(async () => ({ count: -1 })));
  await assert.rejects(() => sourceNoteCount(async () => ({})));
});

test('sanitized exact audit contains only counts, timestamps, digests, modes, and zero-write facts', () => {
  const audit = exactAudit();
  validatePersistableAudit(audit);
  assert.deepEqual(Object.keys(audit).sort(), [...AUDIT_KEYS].sort());
  assert.equal(audit.status, 'reconciled');
  assert.equal(audit.source_active_id_count, 2);
  assert.equal(audit.local_source_derived_id_count, 2);
  assert.equal(audit.source_only_id_count, 0);
  assert.equal(audit.local_only_source_id_count, 0);
  assert.equal(audit.source_ids_sha256, audit.local_source_ids_sha256);
  assert.equal(audit.source_only_ids_sha256, EMPTY_SET_SHA256);
  assert.equal(audit.local_only_source_ids_sha256, EMPTY_SET_SHA256);
  assert.equal(audit.source_record_writes, 0);
  assert.equal(audit.local_record_writes, 0);
  assert.equal(audit.local_record_deletes, 0);
  const serialized = JSON.stringify(audit);
  assert.doesNotMatch(serialized, /918000000000000001|918000000000000002/);
  assert.doesNotMatch(serialized, /Note_Content|Parent_Id|Owner|credential|password|access_token/i);
});

test('sanitized audit object literal defines status exactly once', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'reconcile-notes.js'), 'utf8');
  const literal = source.slice(
    source.indexOf('function buildSanitizedAudit'),
    source.indexOf('function validatePersistableAudit'),
  );
  assert.equal((literal.match(/^\s+status:/gm) || []).length, 1);
});

test('script has no record mutation path or raw-ID console interpolation', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'reconcile-notes.js'), 'utf8');
  assert.doesNotMatch(source, /crm_bulk_upsert|crm_(?:insert|delete)|--apply|upsertExactNote|Note_Content|Parent_Id/);
  const consoleExpressions = [...source.matchAll(/console\.(?:log|error)\((.*?)\);/gs)]
    .map(match => match[1])
    .join('\n');
  assert.doesNotMatch(consoleExpressions, /\b(?:sourceIds|localIds|sourceOnly|localOnly)\b|\.join\s*\(/);
});

test('a non-zero gap cannot replace exact private evidence', () => {
  const audit = buildSanitizedAudit({
    sourceIds: new Set(['918000000000000001', '918000000000000002']),
    localIds: new Set(['918000000000000001']),
    sourceCountEndpoint: 2,
    startedAt: STARTED_AT,
    completedAt: COMPLETED_AT,
  });
  assert.equal(audit.status, 'gap_detected');
  assert.equal(audit.source_only_id_count, 1);
  assert.throws(() => validatePersistableAudit(audit));
});

test('private audit write is atomic, permission-restricted, and leaves no temporary file', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-audit-test-'));
  try {
    const destination = path.join(temporaryRoot, 'private', 'notes-latest.json');
    writePrivateAudit(exactAudit(), destination);
    assert.deepEqual(JSON.parse(fs.readFileSync(destination, 'utf8')), exactAudit());
    assert.equal(fs.statSync(path.dirname(destination)).mode & 0o777, 0o700);
    assert.equal(fs.statSync(destination).mode & 0o777, 0o600);
    assert.deepEqual(fs.readdirSync(path.dirname(destination)), ['notes-latest.json']);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
