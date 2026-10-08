#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const {
  EXPECTED_SOURCE_ORG,
  MAX_BATCH_ITEMS,
  MAX_BATCH_BYTES,
  RESUMABLE_THRESHOLD_BYTES,
  scanAttachmentMetadata,
  planAttachmentBatches,
  mapWithConcurrency,
  transferAttachment,
  validateConcurrency,
  safeRunLog,
  AttachmentReplicationError,
} = require('../lib/attachment-replication');
const {
  ZohoAttachmentSourceAdapter,
  SupabasePrivateStorageAdapter,
  SupabaseAttachmentManifestAdapter,
  loadResumableAdapter,
  writePrivateJsonLines,
} = require('../lib/attachment-replication-adapters');

const ROOT = path.join(__dirname, '..');
const PRIVATE_DIR = path.join(ROOT, '.private', 'attachment-replication');
const CHECKPOINT_PATH = path.join(PRIVATE_DIR, 'checkpoint.json');
const MANIFEST_PATH = path.join(PRIVATE_DIR, 'manifest.jsonl');

function usage() {
  return [
    'Attachment replication (Zoho CRM source is hard GET-only)',
    '',
    'Default: metadata dry-run; no local database, bucket, object, or source writes.',
    '',
    '  npm run attachments:replicate',
    '  npm run attachments:replicate -- --write-private-manifest',
    '  npm run attachments:replicate -- --apply-metadata [--resume]',
    '  npm run attachments:replicate -- --transfer --confirm-transfer=org60046349006 --max-batches=1',
    '',
    'Transfer safety limits: 25 files or 250 MB per batch, concurrency 2-4, one batch by default.',
    'Objects over 6 MB require ATTACHMENT_RESUMABLE_ADAPTER_MODULE.',
  ].join('\n');
}

function parsePositiveInteger(value, name, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new AttachmentReplicationError('INVALID_ARGUMENT', `${name} must be a positive integer.`);
  return parsed;
}

function parseArgs(argv) {
  const flags = new Set(argv.filter(arg => arg.startsWith('--') && !arg.includes('=')));
  const values = Object.fromEntries(argv.filter(arg => arg.startsWith('--') && arg.includes('='))
    .map(arg => {
      const index = arg.indexOf('=');
      return [arg.slice(2, index), arg.slice(index + 1)];
    }));
  const transfer = flags.has('--transfer');
  const applyMetadata = flags.has('--apply-metadata') || transfer;
  const options = {
    help: flags.has('--help'),
    transfer,
    applyMetadata,
    writePrivateManifest: flags.has('--write-private-manifest'),
    resume: flags.has('--resume'),
    concurrency: parsePositiveInteger(values.concurrency, 'concurrency', 2),
    maxBatches: parsePositiveInteger(values['max-batches'], 'max-batches', 1),
    confirmation: values['confirm-transfer'] || null,
  };
  validateConcurrency(options.concurrency);
  if (options.maxBatches > 100) {
    throw new AttachmentReplicationError('MAX_BATCHES_TOO_HIGH', 'A single invocation cannot exceed 100 bounded transfer batches.');
  }
  if (options.transfer && options.confirmation !== EXPECTED_SOURCE_ORG) {
    throw new AttachmentReplicationError('TRANSFER_CONFIRMATION_REQUIRED', `Transfer requires --confirm-transfer=${EXPECTED_SOURCE_ORG}.`);
  }
  if (options.resume && !options.applyMetadata) {
    throw new AttachmentReplicationError('RESUME_REQUIRES_MANIFEST_DB', '--resume is available only with --apply-metadata or --transfer.');
  }
  if (options.resume && options.writePrivateManifest) {
    throw new AttachmentReplicationError('RESUME_PRIVATE_EXPORT_BLOCKED', 'A complete private manifest export requires a fresh full scan, not a page-token resume.');
  }
  if (options.resume && options.transfer) {
    throw new AttachmentReplicationError('TRANSFER_RESUME_SCAN_BLOCKED', 'Finish metadata resume first, then run transfer from a fresh complete scan.');
  }
  return options;
}

function ensurePrivateDirectory() {
  fs.mkdirSync(PRIVATE_DIR, { recursive: true, mode: 0o700 });
  fs.chmodSync(PRIVATE_DIR, 0o700);
}

function writePrivateCheckpoint(checkpoint) {
  ensurePrivateDirectory();
  const temp = `${CHECKPOINT_PATH}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify({
    source_org_id: EXPECTED_SOURCE_ORG,
    source_module: 'Attachments',
    ...checkpoint,
    updated_at: new Date().toISOString(),
  }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  fs.renameSync(temp, CHECKPOINT_PATH);
  fs.chmodSync(CHECKPOINT_PATH, 0o600);
}

function readResumeToken(options) {
  if (!options.resume) return null;
  let checkpoint;
  try {
    checkpoint = JSON.parse(fs.readFileSync(CHECKPOINT_PATH, 'utf8'));
  } catch {
    throw new AttachmentReplicationError('CHECKPOINT_NOT_FOUND', 'No valid private attachment checkpoint is available to resume.');
  }
  if (checkpoint.source_org_id !== EXPECTED_SOURCE_ORG || checkpoint.source_module !== 'Attachments') {
    throw new AttachmentReplicationError('CHECKPOINT_SCOPE_MISMATCH', 'Private attachment checkpoint does not match the locked source scope.');
  }
  if (checkpoint.status !== 'running' || !checkpoint.next_page_token) {
    throw new AttachmentReplicationError('CHECKPOINT_NOT_RESUMABLE', 'Private attachment checkpoint is not in a resumable state.');
  }
  return checkpoint.next_page_token;
}

function chunks(rows, size = MAX_BATCH_ITEMS) {
  const output = [];
  for (let index = 0; index < rows.length; index += size) output.push(rows.slice(index, index + size));
  return output;
}

function sourceAdapterFromEnvironment() {
  return new ZohoAttachmentSourceAdapter({
    accountsUrl: process.env.ZOHO_ACCOUNTS_URL,
    apiDomain: process.env.ZOHO_API_DOMAIN,
    clientId: process.env.ZOHO_CLIENT_ID,
    clientSecret: process.env.ZOHO_CLIENT_SECRET,
    refreshToken: process.env.ZOHO_REFRESH_TOKEN,
    sourceOrgId: process.env.ZOHO_CRM_ORG_ID,
  });
}

function localAdaptersFromEnvironment(options) {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY
      && process.env.SUPABASE_ANON_KEY
      && process.env.SUPABASE_SERVICE_ROLE_KEY === process.env.SUPABASE_ANON_KEY) {
    throw new AttachmentReplicationError('SERVICE_ROLE_REQUIRED', 'Attachment replication cannot use the browser-facing anon key.');
  }
  const context = {
    supabaseUrl: process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    bucketName: process.env.ATTACHMENT_STORAGE_BUCKET,
  };
  const resumableUploader = options.transfer
    ? loadResumableAdapter(process.env.ATTACHMENT_RESUMABLE_ADAPTER_MODULE, context)
    : null;
  const storage = new SupabasePrivateStorageAdapter({ ...context, resumableUploader });
  const manifest = new SupabaseAttachmentManifestAdapter({
    supabaseUrl: context.supabaseUrl,
    serviceRoleKey: context.serviceRoleKey,
    storageAdapter: storage,
  });
  return { storage, manifest };
}

async function transferBoundedBatches({ rows, source, storage, manifest, options }) {
  if (rows.some(row => row.replication_status !== 'quarantined'
      && row.declared_size_bytes > RESUMABLE_THRESHOLD_BYTES)
      && !storage.resumableUploader) {
    throw new AttachmentReplicationError(
      'RESUMABLE_ADAPTER_REQUIRED',
      'The manifest includes attachments over 6 MB; configure a reviewed resumable adapter before transferring any bytes.',
    );
  }
  const plan = planAttachmentBatches(rows, {
    maxItems: MAX_BATCH_ITEMS,
    maxBytes: MAX_BATCH_BYTES,
  });
  let processedBatches = 0;
  let verifiedCount = 0;
  let failedCount = 0;

  for (let index = 0; index < plan.batches.length && processedBatches < options.maxBatches; index += 1) {
    const batch = plan.batches[index];
    const states = await manifest.getTransferState(batch.rows);
    const stateById = new Map(states.map(state => [String(state.attachment_id), state]));
    const now = Date.now();
    const pending = batch.rows.filter(row => {
      const state = stateById.get(row.attachment_id);
      if (!state || state.replication_status === 'verified' || state.replication_status === 'quarantined') return false;
      if (state.replication_status === 'failed' && state.next_attempt_at && Date.parse(state.next_attempt_at) > now) return false;
      return true;
    });
    if (!pending.length) continue;
    processedBatches += 1;
    console.log(safeRunLog('attachment_batch_started', {
      mode: 'bounded_transfer',
      batch_number: processedBatches,
      item_count: pending.length,
      declared_bytes: pending.reduce((sum, row) => sum + row.declared_size_bytes, 0),
    }));

    await mapWithConcurrency(pending, options.concurrency, async row => {
      try {
        const result = await transferAttachment(row, { sourceAdapter: source, storageAdapter: storage });
        await manifest.recordVerification(row, result);
        verifiedCount += 1;
      } catch (error) {
        failedCount += 1;
        await manifest.recordFailure(row, error?.code || 'TRANSFER_FAILED');
      }
    });
  }

  return {
    batch_count: processedBatches,
    verified_count: verifiedCount,
    failed_count: failedCount,
    rejected_count: plan.rejected.length,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const source = sourceAdapterFromEnvironment();
  let storage = null;
  let manifest = null;
  if (options.applyMetadata) {
    ({ storage, manifest } = localAdaptersFromEnvironment(options));
    await storage.preflightPrivateBucket();
  }
  await source.verifyOrganization();

  const resumePageToken = readResumeToken(options);
  const scan = await scanAttachmentMetadata({
    sourceOrgId: EXPECTED_SOURCE_ORG,
    fetchPage: request => source.listAttachmentPage(request),
    resumePageToken,
    onPage: options.applyMetadata
      ? async pageRows => {
        for (const pageChunk of chunks(pageRows)) await manifest.upsertRows(pageChunk);
      }
      : null,
    onCheckpoint: options.applyMetadata ? writePrivateCheckpoint : null,
  });

  const reconciliationLog = {
    mode: options.applyMetadata ? 'metadata_apply' : 'metadata_dry_run',
    ...scan.reconciliation,
    status: options.resume ? 'resume_segment_complete' : 'complete',
  };
  if (options.resume) delete reconciliationLog.unique_rows;
  console.log(safeRunLog('attachment_metadata_complete', reconciliationLog));

  if (options.writePrivateManifest) {
    ensurePrivateDirectory();
    writePrivateJsonLines(MANIFEST_PATH, scan.rows);
    console.log(safeRunLog('private_manifest_written', { mode: 'metadata_dry_run', unique_rows: scan.rows.length, status: 'complete' }));
  }

  if (options.transfer) {
    const result = await transferBoundedBatches({ rows: scan.rows, source, storage, manifest, options });
    console.log(safeRunLog('attachment_transfer_complete', { mode: 'bounded_transfer', ...result, status: 'complete' }));
  }
}

if (require.main === module) {
  main().catch(error => {
    const code = error instanceof AttachmentReplicationError ? error.code : 'UNEXPECTED_FAILURE';
    console.error(safeRunLog('attachment_replication_failed', { mode: 'blocked', status: 'failed', error_code: code }));
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, usage, chunks, transferBoundedBatches };
