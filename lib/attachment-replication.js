'use strict';

const crypto = require('crypto');
const { Readable, Transform } = require('stream');
const { finished } = require('stream/promises');

const EXPECTED_SOURCE_ORG = 'org60046349006';
const MAX_BATCH_ITEMS = 25;
const MAX_BATCH_BYTES = 250 * 1024 * 1024;
const RESUMABLE_THRESHOLD_BYTES = 6 * 1024 * 1024;
const MIN_CONCURRENCY = 2;
const MAX_CONCURRENCY = 4;

class AttachmentReplicationError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'AttachmentReplicationError';
    this.code = code;
  }
}

function assertCrmReadMethod(method) {
  const normalized = String(method || 'GET').toUpperCase();
  if (!['GET', 'HEAD'].includes(normalized)) {
    throw new AttachmentReplicationError(
      'SOURCE_WRITE_BLOCKED',
      `Zoho CRM source method ${normalized} is blocked; only GET and HEAD are permitted.`,
    );
  }
  return normalized;
}

function assertExpectedSourceOrg(configuredOrg, sourceOrg = {}) {
  if (String(configuredOrg || '').trim() !== EXPECTED_SOURCE_ORG) {
    throw new AttachmentReplicationError(
      'SOURCE_ORG_MISMATCH',
      `ZOHO_CRM_ORG_ID must be exactly ${EXPECTED_SOURCE_ORG}.`,
    );
  }
  const candidates = [sourceOrg.id, sourceOrg.zgid, sourceOrg.domain_name]
    .filter(Boolean)
    .map(String);
  if (candidates.length && !candidates.includes(EXPECTED_SOURCE_ORG)) {
    throw new AttachmentReplicationError(
      'AUTHENTICATED_ORG_MISMATCH',
      'The authenticated Zoho organization does not match the locked source organization.',
    );
  }
  return EXPECTED_SOURCE_ORG;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function moduleSlug(moduleName) {
  const slug = String(moduleName || 'quarantine')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 48);
  return slug || 'quarantine';
}

function deterministicObjectPath({ sourceOrgId, attachmentId }) {
  if (!sourceOrgId || !attachmentId) {
    throw new AttachmentReplicationError('INVALID_OBJECT_KEY', 'Source organization and attachment ID are required.');
  }
  const orgSegment = sha256(`org\0${sourceOrgId}`).slice(0, 20);
  const attachmentSegment = sha256(`attachment\0${sourceOrgId}\0${attachmentId}`).slice(0, 32);
  return `zoho-crm/${orgSegment}/${attachmentSegment.slice(0, 2)}/${attachmentSegment}`;
}

function firstString(...values) {
  const found = values.find(value => value !== null && value !== undefined && String(value).trim());
  return found === undefined ? null : String(found).trim();
}

function exactParentModule(record) {
  const parent = record?.Parent_Id;
  return firstString(
    parent?.module?.api_name,
    typeof parent?.module === 'string' ? parent.module : null,
    parent?.$module,
    record?.Parent_Module?.api_name,
    typeof record?.Parent_Module === 'string' ? record.Parent_Module : null,
    record?.$se_module,
  );
}

function exactParentId(record) {
  const parent = record?.Parent_Id;
  return firstString(parent?.id, typeof parent === 'string' || typeof parent === 'number' ? parent : null);
}

function exactSize(record) {
  const raw = record?.Size ?? record?.File_Size;
  if (raw === null || raw === undefined || raw === '') return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function normalizeAttachmentMetadata(record, sourceOrgId = EXPECTED_SOURCE_ORG, observedAt = new Date().toISOString()) {
  assertExpectedSourceOrg(sourceOrgId);
  const attachmentId = firstString(record?.id);
  if (!attachmentId) {
    throw new AttachmentReplicationError('MISSING_ATTACHMENT_ID', 'Attachment metadata has no source ID and cannot be keyed safely.');
  }

  const parentModule = exactParentModule(record);
  const parentRecordId = exactParentId(record);
  const fileName = firstString(record?.File_Name);
  const declaredSizeBytes = exactSize(record);
  const quarantineReasons = [];
  if (!parentModule) quarantineReasons.push('missing_parent_module');
  if (!parentRecordId) quarantineReasons.push('missing_parent_id');
  if (!fileName) quarantineReasons.push('missing_file_name');
  if (declaredSizeBytes === null) quarantineReasons.push('invalid_declared_size');

  return {
    source_org_id: sourceOrgId,
    attachment_id: attachmentId,
    parent_module: parentModule,
    parent_record_id: parentRecordId,
    file_name: fileName,
    declared_size_bytes: declaredSizeBytes,
    source_created_at: firstString(record?.Created_Time),
    source_modified_at: firstString(record?.Modified_Time),
    private_object_path: deterministicObjectPath({
      sourceOrgId,
      attachmentId,
      parentModule,
      parentRecordId,
      fileName,
    }),
    replication_status: quarantineReasons.length ? 'quarantined' : 'metadata_only',
    retry_count: 0,
    content_sha256: null,
    uploaded_size_bytes: null,
    verification_status: 'not_started',
    quarantine_reasons: quarantineReasons,
    source_seen_at: observedAt,
    tombstone_review_status: 'not_candidate',
  };
}

function manifestKey(row) {
  return `${row.source_org_id}\0${row.attachment_id}`;
}

function validatePrivateBucket(bucket, expectedName) {
  if (!expectedName || !String(expectedName).trim()) {
    throw new AttachmentReplicationError('BUCKET_NAME_REQUIRED', 'ATTACHMENT_STORAGE_BUCKET is required.');
  }
  if (!bucket || typeof bucket !== 'object') {
    throw new AttachmentReplicationError('BUCKET_NOT_FOUND', 'The configured attachment bucket was not found.');
  }
  if (String(bucket.name || bucket.id || '') !== String(expectedName)) {
    throw new AttachmentReplicationError('BUCKET_MISMATCH', 'Storage preflight returned a different bucket.');
  }
  if (bucket.public !== false) {
    throw new AttachmentReplicationError('BUCKET_NOT_PRIVATE', 'Attachment storage is blocked unless the bucket explicitly reports public=false.');
  }
  return { name: String(expectedName), private: true };
}

function validateConcurrency(value) {
  const concurrency = Number(value);
  if (!Number.isInteger(concurrency) || concurrency < MIN_CONCURRENCY || concurrency > MAX_CONCURRENCY) {
    throw new AttachmentReplicationError(
      'INVALID_CONCURRENCY',
      `Attachment concurrency must be an integer from ${MIN_CONCURRENCY} to ${MAX_CONCURRENCY}.`,
    );
  }
  return concurrency;
}

function planAttachmentBatches(rows, options = {}) {
  const maxItems = Number(options.maxItems ?? MAX_BATCH_ITEMS);
  const maxBytes = Number(options.maxBytes ?? MAX_BATCH_BYTES);
  if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > MAX_BATCH_ITEMS) {
    throw new AttachmentReplicationError('INVALID_BATCH_ITEMS', `Batch size cannot exceed ${MAX_BATCH_ITEMS} attachments.`);
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BATCH_BYTES) {
    throw new AttachmentReplicationError('INVALID_BATCH_BYTES', `Batch bytes cannot exceed ${MAX_BATCH_BYTES}.`);
  }

  const batches = [];
  const rejected = [];
  let current = [];
  let currentBytes = 0;
  const flush = () => {
    if (!current.length) return;
    batches.push({ rows: current, item_count: current.length, declared_bytes: currentBytes });
    current = [];
    currentBytes = 0;
  };

  for (const row of rows) {
    if (row.replication_status === 'quarantined' || (row.quarantine_reasons || []).length) {
      rejected.push({ row, reason: 'quarantined_metadata' });
      continue;
    }
    const bytes = Number(row.declared_size_bytes);
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      rejected.push({ row, reason: 'invalid_declared_size' });
      continue;
    }
    if (bytes > maxBytes) {
      rejected.push({ row, reason: 'exceeds_batch_byte_cap' });
      continue;
    }
    if (current.length >= maxItems || currentBytes + bytes > maxBytes) flush();
    current.push(row);
    currentBytes += bytes;
  }
  flush();
  return { batches, rejected };
}

function isExpiredPageTokenError(error) {
  const code = String(error?.code || error?.responseCode || '').toUpperCase();
  const message = String(error?.message || '').toLowerCase();
  const status = Number(error?.status || 0);
  return [400, 404].includes(status)
    && (['TOKEN_EXPIRED', 'INVALID_PAGE_TOKEN', 'INVALID_DATA', 'INVALID_URL_PATTERN'].includes(code)
      || (message.includes('page') && message.includes('token')));
}

async function scanAttachmentMetadata({
  sourceOrgId = EXPECTED_SOURCE_ORG,
  fetchPage,
  resumePageToken = null,
  maxTokenRestarts = 2,
  observedAt = new Date().toISOString(),
  onCheckpoint = null,
  onPage = null,
  seedRows = [],
}) {
  assertExpectedSourceOrg(sourceOrgId);
  if (typeof fetchPage !== 'function') throw new TypeError('fetchPage is required');
  const rowsByKey = new Map();
  for (const row of seedRows) rowsByKey.set(manifestKey(row), row);
  let pageToken = resumePageToken;
  let pageNumber = pageToken ? null : 1;
  let tokenRestarts = 0;
  let fetchedRows = 0;
  let duplicateRows = 0;
  let pages = 0;

  while (true) {
    let response;
    try {
      response = await fetchPage({ pageToken, pageNumber });
    } catch (error) {
      if (!pageToken || !isExpiredPageTokenError(error) || tokenRestarts >= maxTokenRestarts) throw error;
      pageToken = null;
      pageNumber = 1;
      tokenRestarts += 1;
      if (typeof onCheckpoint === 'function') {
        await onCheckpoint({ status: 'token_expired_restart', next_page_token: null, token_restarts: tokenRestarts });
      }
      continue;
    }

    pages += 1;
    const sourceRows = Array.isArray(response?.data) ? response.data : [];
    const normalizedPageRows = [];
    for (const raw of sourceRows) {
      const row = normalizeAttachmentMetadata(raw, sourceOrgId, observedAt);
      normalizedPageRows.push(row);
      const key = manifestKey(row);
      if (rowsByKey.has(key)) duplicateRows += 1;
      rowsByKey.set(key, row);
      fetchedRows += 1;
    }
    if (typeof onPage === 'function' && normalizedPageRows.length) {
      await onPage(normalizedPageRows, { page: pages, token_restart_count: tokenRestarts });
    }

    const info = response?.info || {};
    if (!info.more_records) {
      if (typeof onCheckpoint === 'function') {
        await onCheckpoint({ status: 'complete', next_page_token: null, token_restarts: tokenRestarts, unique_rows: rowsByKey.size });
      }
      break;
    }
    if (!info.next_page_token) {
      throw new AttachmentReplicationError('MISSING_NEXT_PAGE_TOKEN', 'Source indicated more attachment metadata without a next page token.');
    }
    pageToken = String(info.next_page_token);
    pageNumber = null;
    if (typeof onCheckpoint === 'function') {
      await onCheckpoint({ status: 'running', next_page_token: pageToken, token_restarts: tokenRestarts, unique_rows: rowsByKey.size });
    }
  }

  const rows = [...rowsByKey.values()].sort((a, b) => a.attachment_id.localeCompare(b.attachment_id));
  return {
    rows,
    reconciliation: {
      pages,
      fetched_rows: fetchedRows,
      unique_rows: rows.length,
      duplicate_rows: duplicateRows,
      quarantined_rows: rows.filter(row => row.replication_status === 'quarantined').length,
      token_restarts: tokenRestarts,
      complete: true,
    },
    checkpoint: {
      status: 'complete',
      next_page_token: null,
      token_restarts: tokenRestarts,
      unique_rows: rows.length,
    },
  };
}

async function mapWithConcurrency(items, concurrency, worker) {
  const limit = validateConcurrency(concurrency);
  if (typeof worker !== 'function') throw new TypeError('worker is required');
  const results = new Array(items.length);
  let next = 0;
  async function runWorker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runWorker));
  return results;
}

function hashMeter() {
  const digest = crypto.createHash('sha256');
  let bytes = 0;
  const stream = new Transform({
    transform(chunk, encoding, callback) {
      bytes += chunk.length;
      digest.update(chunk);
      callback(null, chunk);
    },
  });
  let finalized = false;
  return {
    stream,
    finish() {
      if (finalized) throw new AttachmentReplicationError('HASH_ALREADY_FINALIZED', 'Attachment hash was already finalized.');
      finalized = true;
      return { bytes, sha256: digest.digest('hex') };
    },
  };
}

async function transferAttachment(row, { sourceAdapter, storageAdapter }) {
  if (row.replication_status === 'quarantined' || (row.quarantine_reasons || []).length) {
    throw new AttachmentReplicationError('QUARANTINED_ATTACHMENT', 'Quarantined attachment metadata cannot be transferred.');
  }
  const declaredSize = Number(row.declared_size_bytes);
  if (!Number.isSafeInteger(declaredSize) || declaredSize < 0) {
    throw new AttachmentReplicationError('INVALID_DECLARED_SIZE', 'Attachment has no safe declared byte size.');
  }
  if (!sourceAdapter || !storageAdapter) throw new TypeError('sourceAdapter and storageAdapter are required');

  let uploaded;
  if (declaredSize > RESUMABLE_THRESHOLD_BYTES) {
    if (typeof storageAdapter.uploadResumable !== 'function') {
      throw new AttachmentReplicationError('RESUMABLE_ADAPTER_REQUIRED', 'Attachments over 6 MB require a resumable upload adapter.');
    }
    uploaded = await storageAdapter.uploadResumable({
      objectPath: row.private_object_path,
      declaredSizeBytes: declaredSize,
      chunkSizeBytes: RESUMABLE_THRESHOLD_BYTES,
      allowOverwrite: false,
      openSource: offset => sourceAdapter.openAttachmentStream(row, { offset }),
    });
    if (!uploaded || !/^[a-f0-9]{64}$/.test(String(uploaded.sha256 || '')) || uploaded.uploadedSizeBytes !== declaredSize) {
      throw new AttachmentReplicationError('RESUMABLE_VERIFICATION_FAILED', 'Resumable adapter did not return an exact size and SHA-256 verification result.');
    }
  } else {
    const source = await sourceAdapter.openAttachmentStream(row, { offset: 0 });
    if (!source || !source.body) throw new AttachmentReplicationError('EMPTY_SOURCE_STREAM', 'Source attachment stream is unavailable.');
    const readable = typeof source.body.getReader === 'function' ? Readable.fromWeb(source.body) : source.body;
    const meter = hashMeter();
    const body = readable.pipe(meter.stream);
    try {
      await storageAdapter.uploadStream({
        objectPath: row.private_object_path,
        body,
        declaredSizeBytes: declaredSize,
        contentType: source.contentType || 'application/octet-stream',
      });
      await finished(meter.stream);
    } catch (error) {
      readable.destroy?.();
      throw error;
    }
    const measured = meter.finish();
    if (measured.bytes !== declaredSize) {
      throw new AttachmentReplicationError('SOURCE_SIZE_MISMATCH', 'Downloaded byte count does not match source metadata.');
    }
    uploaded = { sha256: measured.sha256, uploadedSizeBytes: measured.bytes };
  }

  if (typeof storageAdapter.verifyPrivateObject !== 'function') {
    throw new AttachmentReplicationError('PRIVATE_VERIFICATION_REQUIRED', 'Authenticated private-object size and SHA-256 read-back verification is required.');
  }
  const verification = await storageAdapter.verifyPrivateObject({
    objectPath: row.private_object_path,
    expectedSizeBytes: declaredSize,
    expectedSha256: uploaded.sha256,
  });
  if (!verification
      || Number(verification.size) !== declaredSize
      || String(verification.sha256 || '') !== uploaded.sha256) {
    throw new AttachmentReplicationError('STORAGE_CONTENT_MISMATCH', 'Authenticated private-object read-back does not match source size and SHA-256.');
  }
  return {
    replication_status: 'verified',
    uploaded_size_bytes: declaredSize,
    content_sha256: uploaded.sha256,
    verification_status: 'sha256_and_size_verified',
    verified_at: new Date().toISOString(),
    storage_etag: verification.etag || null,
  };
}

function safeRunLog(event, facts = {}) {
  const allowed = {};
  const allowedKeys = new Set([
    'mode', 'pages', 'fetched_rows', 'unique_rows', 'duplicate_rows', 'quarantined_rows',
    'token_restarts', 'batch_count', 'batch_number', 'item_count', 'declared_bytes',
    'verified_count', 'failed_count', 'status', 'error_code',
  ]);
  for (const [key, value] of Object.entries(facts)) {
    if (!allowedKeys.has(key)) continue;
    if (typeof value === 'string' && !/^[a-z0-9_-]{1,40}$/i.test(value)) continue;
    if (typeof value === 'number' && Number.isFinite(value)) allowed[key] = value;
    if (typeof value === 'boolean') allowed[key] = value;
    if (typeof value === 'string') allowed[key] = value;
  }
  return JSON.stringify({ event: moduleSlug(event), ...allowed });
}

module.exports = {
  EXPECTED_SOURCE_ORG,
  MAX_BATCH_ITEMS,
  MAX_BATCH_BYTES,
  RESUMABLE_THRESHOLD_BYTES,
  MIN_CONCURRENCY,
  MAX_CONCURRENCY,
  AttachmentReplicationError,
  assertCrmReadMethod,
  assertExpectedSourceOrg,
  deterministicObjectPath,
  normalizeAttachmentMetadata,
  manifestKey,
  validatePrivateBucket,
  validateConcurrency,
  planAttachmentBatches,
  isExpiredPageTokenError,
  scanAttachmentMetadata,
  mapWithConcurrency,
  transferAttachment,
  safeRunLog,
};
