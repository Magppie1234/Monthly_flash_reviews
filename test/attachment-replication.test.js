'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const baseline = require('../config/attachment-replication-baseline.json');
const {
  EXPECTED_SOURCE_ORG,
  MAX_BATCH_ITEMS,
  MAX_BATCH_BYTES,
  RESUMABLE_THRESHOLD_BYTES,
  AttachmentReplicationError,
  assertCrmReadMethod,
  assertExpectedSourceOrg,
  deterministicObjectPath,
  normalizeAttachmentMetadata,
  validatePrivateBucket,
  planAttachmentBatches,
  scanAttachmentMetadata,
  mapWithConcurrency,
  transferAttachment,
  safeRunLog,
} = require('../lib/attachment-replication');
const { ZohoAttachmentSourceAdapter } = require('../lib/attachment-replication-adapters');
const { parseArgs } = require('../scripts/replicate-zoho-attachments');

function metadata(id, overrides = {}) {
  return {
    id,
    Parent_Id: { id: `parent-${id}`, module: { api_name: 'Contacts' } },
    File_Name: 'Customer document.pdf',
    Size: 128,
    Created_Time: '2026-01-01T00:00:00+05:30',
    Modified_Time: '2026-01-02T00:00:00+05:30',
    ...overrides,
  };
}

test('source organization and CRM method boundary are hard fail-closed', () => {
  assert.equal(assertExpectedSourceOrg(EXPECTED_SOURCE_ORG, { zgid: EXPECTED_SOURCE_ORG }), EXPECTED_SOURCE_ORG);
  assert.equal(assertCrmReadMethod('get'), 'GET');
  assert.equal(assertCrmReadMethod('HEAD'), 'HEAD');
  assert.throws(() => assertExpectedSourceOrg('another-org'), { code: 'SOURCE_ORG_MISMATCH' });
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.throws(() => assertCrmReadMethod(method), { code: 'SOURCE_WRITE_BLOCKED' });
  }
});

test('manifest normalization is exact, deterministic, private, and quarantines missing parents', () => {
  const row = normalizeAttachmentMetadata(metadata('attachment-1'), EXPECTED_SOURCE_ORG, '2026-08-30T00:00:00.000Z');
  assert.equal(row.source_org_id, EXPECTED_SOURCE_ORG);
  assert.equal(row.attachment_id, 'attachment-1');
  assert.equal(row.parent_module, 'Contacts');
  assert.equal(row.parent_record_id, 'parent-attachment-1');
  assert.equal(row.file_name, 'Customer document.pdf');
  assert.equal(row.declared_size_bytes, 128);
  assert.equal(row.replication_status, 'metadata_only');
  assert.deepEqual(row.quarantine_reasons, []);
  assert.match(row.private_object_path, /^zoho-crm\/[a-f0-9]{20}\/[a-f0-9]{2}\/[a-f0-9]{32}$/);
  assert.equal(row.private_object_path.includes('attachment-1'), false);
  assert.equal(row.private_object_path.includes('parent-attachment-1'), false);
  assert.equal(row.private_object_path.includes('Customer'), false);
  assert.equal(row.private_object_path.includes(EXPECTED_SOURCE_ORG), false);
  assert.equal(
    deterministicObjectPath({
      sourceOrgId: row.source_org_id,
      attachmentId: row.attachment_id,
      parentModule: row.parent_module,
      parentRecordId: row.parent_record_id,
      fileName: row.file_name,
    }),
    row.private_object_path,
  );

  const quarantined = normalizeAttachmentMetadata(metadata('attachment-2', { Parent_Id: null }), EXPECTED_SOURCE_ORG);
  assert.equal(quarantined.replication_status, 'quarantined');
  assert.deepEqual(quarantined.quarantine_reasons, ['missing_parent_module', 'missing_parent_id']);
  assert.throws(() => normalizeAttachmentMetadata({ File_Name: 'no-id.pdf' }, EXPECTED_SOURCE_ORG), { code: 'MISSING_ATTACHMENT_ID' });
});

test('private bucket preflight rejects missing, mismatched, and public buckets', () => {
  assert.throws(() => validatePrivateBucket(null, ''), { code: 'BUCKET_NAME_REQUIRED' });
  assert.throws(() => validatePrivateBucket(null, 'private-files'), { code: 'BUCKET_NOT_FOUND' });
  assert.throws(() => validatePrivateBucket({ name: 'other', public: false }, 'private-files'), { code: 'BUCKET_MISMATCH' });
  assert.throws(() => validatePrivateBucket({ name: 'private-files', public: true }, 'private-files'), { code: 'BUCKET_NOT_PRIVATE' });
  assert.throws(() => validatePrivateBucket({ name: 'private-files' }, 'private-files'), { code: 'BUCKET_NOT_PRIVATE' });
  assert.deepEqual(validatePrivateBucket({ name: 'private-files', public: false }, 'private-files'), {
    name: 'private-files',
    private: true,
  });
});

test('batch planning never exceeds 25 attachments or 250 MB and quarantines oversize rows', () => {
  const rows = Array.from({ length: 63 }, (_, index) => ({
    ...normalizeAttachmentMetadata(metadata(`a-${index}`, { Size: 10 * 1024 * 1024 }), EXPECTED_SOURCE_ORG),
  }));
  const plan = planAttachmentBatches(rows);
  assert.equal(plan.rejected.length, 0);
  assert.equal(plan.batches.length, 3);
  assert.ok(plan.batches.every(batch => batch.item_count <= MAX_BATCH_ITEMS));
  assert.ok(plan.batches.every(batch => batch.declared_bytes <= MAX_BATCH_BYTES));

  const oversized = normalizeAttachmentMetadata(metadata('oversized', { Size: MAX_BATCH_BYTES + 1 }), EXPECTED_SOURCE_ORG);
  const invalid = normalizeAttachmentMetadata(metadata('missing-parent', { Parent_Id: null }), EXPECTED_SOURCE_ORG);
  const rejected = planAttachmentBatches([oversized, invalid]);
  assert.deepEqual(rejected.rejected.map(item => item.reason), ['exceeds_batch_byte_cap', 'quarantined_metadata']);
  assert.throws(() => planAttachmentBatches(rows, { maxItems: 26 }), { code: 'INVALID_BATCH_ITEMS' });
  assert.throws(() => planAttachmentBatches(rows, { maxBytes: MAX_BATCH_BYTES + 1 }), { code: 'INVALID_BATCH_BYTES' });
});

test('metadata scan resumes idempotently after an expired page token', async () => {
  const calls = [];
  let restarted = false;
  const checkpoints = [];
  const result = await scanAttachmentMetadata({
    sourceOrgId: EXPECTED_SOURCE_ORG,
    observedAt: '2026-08-30T00:00:00.000Z',
    onCheckpoint: checkpoint => checkpoints.push(checkpoint),
    fetchPage: async ({ pageToken }) => {
      calls.push(pageToken || 'first');
      if (!pageToken) {
        return { data: [metadata('one')], info: { more_records: true, next_page_token: restarted ? 'valid' : 'expired' } };
      }
      if (pageToken === 'expired') {
        restarted = true;
        const error = new AttachmentReplicationError('TOKEN_EXPIRED', 'page token expired');
        error.status = 400;
        throw error;
      }
      return { data: [metadata('two')], info: { more_records: false } };
    },
  });
  assert.deepEqual(calls, ['first', 'expired', 'first', 'valid']);
  assert.equal(result.rows.length, 2);
  assert.equal(result.reconciliation.fetched_rows, 3);
  assert.equal(result.reconciliation.duplicate_rows, 1);
  assert.equal(result.reconciliation.token_restarts, 1);
  assert.equal(result.checkpoint.next_page_token, null);
  assert.ok(checkpoints.some(item => item.status === 'token_expired_restart'));
  assert.equal(checkpoints.at(-1).status, 'complete');
});

test('worker concurrency is bounded from two through four', async () => {
  for (const invalid of [0, 1, 5, 2.5]) {
    await assert.rejects(() => mapWithConcurrency([1], invalid, async value => value), { code: 'INVALID_CONCURRENCY' });
  }
  let active = 0;
  let maximum = 0;
  const output = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 3, async value => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active -= 1;
    return value * 2;
  });
  assert.deepEqual(output, [2, 4, 6, 8, 10, 12]);
  assert.ok(maximum >= 2 && maximum <= 3);
});

test('small-object transfer streams SHA-256 and requires exact private read-back verification', async () => {
  const bytes = Buffer.from('verified attachment payload');
  const row = normalizeAttachmentMetadata(metadata('small', { Size: bytes.length }), EXPECTED_SOURCE_ORG);
  let uploaded = Buffer.alloc(0);
  const sourceAdapter = {
    async openAttachmentStream() {
      return { body: Readable.from([bytes]), contentType: 'application/pdf' };
    },
  };
  const storageAdapter = {
    async uploadStream({ body }) {
      const chunks = [];
      for await (const chunk of body) chunks.push(chunk);
      uploaded = Buffer.concat(chunks);
    },
    async verifyPrivateObject({ expectedSizeBytes, expectedSha256 }) {
      assert.equal(expectedSizeBytes, bytes.length);
      assert.equal(expectedSha256, crypto.createHash('sha256').update(bytes).digest('hex'));
      return { size: bytes.length, sha256: expectedSha256, etag: 'private-etag' };
    },
  };
  const result = await transferAttachment(row, { sourceAdapter, storageAdapter });
  assert.deepEqual(uploaded, bytes);
  assert.equal(result.uploaded_size_bytes, bytes.length);
  assert.equal(result.content_sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
  assert.equal(result.verification_status, 'sha256_and_size_verified');
  assert.equal(result.storage_etag, 'private-etag');
});

test('large-object transfer requires and verifies the resumable adapter contract', async () => {
  const row = normalizeAttachmentMetadata(metadata('large', { Size: RESUMABLE_THRESHOLD_BYTES + 1 }), EXPECTED_SOURCE_ORG);
  await assert.rejects(
    () => transferAttachment(row, {
      sourceAdapter: { openAttachmentStream: async () => ({ body: Readable.from([]) }) },
      storageAdapter: { verifyPrivateObject: async () => ({ size: row.declared_size_bytes }) },
    }),
    { code: 'RESUMABLE_ADAPTER_REQUIRED' },
  );

  const digest = 'a'.repeat(64);
  let usedResumable = false;
  const result = await transferAttachment(row, {
    sourceAdapter: { openAttachmentStream: async () => ({ body: Readable.from([]) }) },
    storageAdapter: {
      async uploadResumable(request) {
        usedResumable = true;
        assert.equal(request.declaredSizeBytes, row.declared_size_bytes);
        assert.equal(request.chunkSizeBytes, RESUMABLE_THRESHOLD_BYTES);
        assert.equal(request.allowOverwrite, false);
        assert.equal(typeof request.openSource, 'function');
        return { uploadedSizeBytes: row.declared_size_bytes, sha256: digest };
      },
      async verifyPrivateObject({ expectedSha256 }) {
        return { size: row.declared_size_bytes, sha256: expectedSha256 };
      },
    },
  });
  assert.equal(usedResumable, true);
  assert.equal(result.content_sha256, digest);
});

test('safe operational logs cannot include attachment IDs, filenames, paths, URLs, or secrets', () => {
  const serialized = safeRunLog('Attachment batch / customer.pdf', {
    mode: 'metadata_dry_run',
    unique_rows: 78758,
    attachment_id: 'sensitive-id',
    file_name: 'person-name.pdf',
    private_object_path: 'zoho-crm/private/path',
    url: 'https://example.invalid/object',
    token: 'secret-value',
  });
  assert.match(serialized, /"unique_rows":78758/);
  assert.doesNotMatch(serialized, /sensitive-id|person-name|zoho-crm|example\.invalid|secret-value/i);
});

test('the Zoho adapter blocks source POST before token acquisition or network access', async () => {
  const adapter = new ZohoAttachmentSourceAdapter({
    accountsUrl: 'https://accounts.example.invalid',
    apiDomain: 'https://api.example.invalid',
    clientId: 'configured',
    clientSecret: 'configured',
    refreshToken: 'configured',
    sourceOrgId: EXPECTED_SOURCE_ORG,
  });
  await assert.rejects(() => adapter.crmRequest('/crm/v8/Attachments', { method: 'POST' }), { code: 'SOURCE_WRITE_BLOCKED' });
});

test('CLI defaults to dry-run metadata-only and transfer requires exact acknowledgement', () => {
  assert.deepEqual(parseArgs([]), {
    help: false,
    transfer: false,
    applyMetadata: false,
    writePrivateManifest: false,
    resume: false,
    concurrency: 2,
    maxBatches: 1,
    confirmation: null,
  });
  assert.throws(() => parseArgs(['--transfer']), { code: 'TRANSFER_CONFIRMATION_REQUIRED' });
  assert.throws(
    () => parseArgs(['--transfer', '--resume', `--confirm-transfer=${EXPECTED_SOURCE_ORG}`]),
    { code: 'TRANSFER_RESUME_SCAN_BLOCKED' },
  );
  const transfer = parseArgs(['--transfer', `--confirm-transfer=${EXPECTED_SOURCE_ORG}`, '--concurrency=4', '--max-batches=2']);
  assert.equal(transfer.transfer, true);
  assert.equal(transfer.applyMetadata, true);
  assert.equal(transfer.concurrency, 4);
  assert.equal(transfer.maxBatches, 2);
});

test('sanitized audit baseline reconciles exact facts without claiming bucket enumeration or orphan count', () => {
  assert.equal(baseline.source_org_id, EXPECTED_SOURCE_ORG);
  assert.equal(baseline.source_attachment_unique_ids, 78758);
  assert.equal(baseline.source_parent_records, 3734);
  assert.equal(baseline.source_declared_bytes, 205279257214);
  assert.equal(baseline.local_crm_record_attachment_ids, 2);
  assert.equal(baseline.local_ids_present_in_source, 2);
  assert.equal(baseline.source_ids_absent_from_crm_records, 78756);
  assert.equal(baseline.source_attachment_unique_ids - baseline.local_ids_present_in_source, baseline.source_ids_absent_from_crm_records);
  assert.equal(baseline.local_linked_object_bytes, 741460);
  assert.equal(baseline.missing_parent_module_references, 431);
  assert.equal(baseline.missing_parent_id_and_module_references, 5);
  assert.equal(baseline.current_linked_objects_anonymous_head_accessible, true);
  assert.equal(baseline.storage_bucket_enumerated, false);
  assert.equal(baseline.orphan_object_count, null);
  assert.equal(baseline.migration_executed, false);
});

test('SQL migration enforces private paths, exact keying, RLS, verification, and no deletes', () => {
  const schema = fs.readFileSync(path.join(__dirname, '..', 'database', 'attachment-replication.sql'), 'utf8');
  assert.match(schema, /PRIMARY KEY \(source_org_id, attachment_id\)/);
  assert.match(schema, /private_object_path NOT LIKE 'https:\/\/%'/);
  assert.match(schema, /content_sha256 IS NULL OR content_sha256 ~ '\^\[a-f0-9\]\{64\}\$'/);
  assert.match(schema, /crm_attachment_no_delete/);
  assert.match(schema, /tombstone_review_status/);
  assert.match(schema, /ENABLE ROW LEVEL SECURITY/g);
  assert.match(schema, /REVOKE ALL ON public\.crm_attachment_manifest FROM anon, authenticated/);
  assert.doesNotMatch(schema, /GRANT DELETE ON public\.crm_attachment_manifest/i);
  assert.doesNotMatch(schema, /https?:\/\/[a-z0-9]/i);
});
