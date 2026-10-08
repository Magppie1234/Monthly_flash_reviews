# Attachment Replication Runbook

This pipeline prepares exact Zoho CRM attachment metadata and a bounded, restartable private-object migration. It does not make source CRM writes. Its default command is metadata-only dry-run, and no attachment bytes were transferred while this toolkit was built or tested. Metadata capture is not body migration: the current audited body-migration count is zero, and the separate on-demand access implementation is tested but unmounted.

## Audited baseline

The sanitized read-only audit for source organization `org60046349006` established:

| Measure | Verified value |
| --- | ---: |
| Unique active source attachment IDs | 78,758 |
| Exact addressable module/record/attachment triples | 78,327 |
| Parent records represented | 3,734 |
| Declared source bytes | 205,279,257,214 |
| User-visible local `crm_records` attachment IDs | 2 |
| Local IDs also present in source | 2 |
| Source IDs proven absent from local `crm_records` | 78,756 |
| Verified attachment bodies migrated by this pipeline | 0 |
| Manifest rows with uploaded bytes | 0 |
| Current linked local-object bytes | 741,460 |
| Missing parent-module references quarantined | 431 |
| Also missing parent ID within that quarantine | 5 |

The currently linked local objects accepted anonymous `HEAD` requests, so the current storage configuration is a confirmed privacy blocker. The audit did not enumerate the storage bucket and therefore did not establish an orphan or unlinked-object count. Do not infer one.

The source metadata was refreshed read-only on 30 August 2026 across 394 API pages. A complete 78,758-row private JSONL manifest was written under ignored `.private/` storage with directory mode `0700` and file mode `0600`; 78,327 rows have exact addressable triples and 431 are quarantined. Its 205,279,257,214 declared bytes were reconciled without downloading attachment content. The two currently linked local objects predate this pipeline and were not migrated by it; both accepted anonymous `HEAD` requests, so byte transfer remains blocked.

The machine-readable, data-free baseline is `config/attachment-replication-baseline.json`. It contains counts only—no attachment IDs, filenames, customer data, object URLs, or credentials.

## Safety boundary

- The source organization is locked in code to `org60046349006`.
- Zoho CRM requests are hard-blocked unless the method is `GET` or `HEAD`. OAuth token exchange still uses the provider-required accounts endpoint.
- Default execution is a dry-run metadata scan. It does not write the database, storage, buckets, source CRM, or private manifest files.
- Metadata apply and byte transfer require a service-role key. The browser-facing anon key is not accepted for this pipeline.
- Before any local metadata or object write, the configured bucket must exist and explicitly report `public=false`. Missing, mismatched, unknown-publicity, or public buckets fail closed.
- Object paths are deterministic hashes of the locked organization, parent, and attachment identity. Raw IDs and filenames are not embedded in paths.
- There are no public or signed object URLs in the manifest or operator output.
- Missing parent module or ID, filename, or valid declared byte size is quarantined. Quarantined rows are never transferred.
- A batch is limited to 25 attachments and 250 MB declared bytes. Concurrency must be 2, 3, or 4.
- Objects over 6 MB require a separately reviewed resumable adapter. Without one, transfer fails before any bytes are moved.
- Standard transfers stream bytes through SHA-256 calculation. Success requires the streamed size, source declared size, uploaded size, authenticated private-object `HEAD` size, and an authenticated private read-back SHA-256 to agree; an anonymous post-upload `HEAD` must also be denied.
- Existing objects are never overwritten (`x-upsert=false`). Ambiguous partial uploads require review instead of an automatic overwrite.
- Metadata re-scans are idempotent and preserve verified hashes and transfer state. Expired page tokens restart safely because metadata upserts use `(source_org_id, attachment_id)` as the key.
- Deletes are not automated. The SQL schema blocks manifest deletion and requires explicit tombstone review; it does not remove storage objects.
- Logs contain only event names, modes, counts, byte totals, status, and bounded error codes. They omit IDs, filenames, object paths, page tokens, URLs, credentials, and customer data.

## Database schema

Review and apply `database/attachment-replication.sql` through an authorized Supabase SQL session. It creates:

- `crm_attachment_manifest`: exact private manifest keyed by organization and attachment ID, including parent reference, filename, size, source timestamps, private path, transfer status, retries, SHA-256, size verification, quarantine reasons, and tombstone-review state.
- `crm_attachment_scan_runs`: count-only run tracking.
- `crm_attachment_scan_checkpoints`: private page-token checkpoints for restart.
- `crm_attachment_tombstone_reviews`: review evidence and decisions without automatic deletion.
- service-role-only RPCs that preserve verified state during metadata upserts and atomically record verification or retry failures.

The migration enables RLS, grants no attachment-table access to `anon` or `authenticated`, grants no delete permission, and installs a delete-blocking trigger. Applying this schema is a separate authorized database change; it was not applied during offline toolkit verification.

## Environment

Populate these values only in the ignored `.env` file:

```text
ZOHO_CRM_ORG_ID=org60046349006
ZOHO_ACCOUNTS_URL=...
ZOHO_API_DOMAIN=...
ZOHO_CLIENT_ID=...
ZOHO_CLIENT_SECRET=...
ZOHO_REFRESH_TOKEN=...
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
ATTACHMENT_STORAGE_BUCKET=...
ATTACHMENT_RESUMABLE_ADAPTER_MODULE=...
```

`ATTACHMENT_STORAGE_BUCKET` has no default. Create or select a dedicated private bucket through an approved administrative process, then independently verify that anonymous `HEAD` and `GET` requests fail before migration approval.

## Operator sequence

1. Reproduce the current private-manifest evidence without loading `.env`, making a source request, or performing a write. This command prints only aggregate counts and booleans; it never prints IDs, filenames, customer data, paths, URLs, or credentials:

   ```bash
   node scripts/discover-zoho.js --audit-attachment-manifest-counts
   ```

   The accepted snapshot is 78,758 unique IDs, 78,327 exact addressable triples, 431 quarantined rows, 2 locally linked IDs, 78,756 source IDs absent locally, 0 verified migrated bodies, 0 rows with uploaded bytes, no duplicates, no wrong-organization rows, and `baseline_counts_match: true`.

2. Run the read-only dry-run. It fetches metadata and prints only reconciled counts:

   ```bash
   npm run attachments:replicate
   ```

3. Optionally write a complete local private JSONL manifest. This file is stored under ignored `.private/`, with directory mode `0700` and file mode `0600`:

   ```bash
   npm run attachments:replicate -- --write-private-manifest
   ```

4. After applying the SQL migration and approving a private bucket, upsert metadata. Bucket preflight occurs before the first manifest write:

   ```bash
   npm run attachments:replicate -- --apply-metadata
   ```

5. If an interrupted metadata apply left a private running checkpoint, resume it. An expired token is discarded and scanning restarts idempotently from the beginning:

   ```bash
   npm run attachments:replicate -- --apply-metadata --resume
   ```

6. Only after reviewing the private-bucket test, resumable adapter, quarantines, capacity, retention, and recovery plan, transfer one bounded batch:

   ```bash
   npm run attachments:replicate -- --transfer --confirm-transfer=org60046349006 --max-batches=1 --concurrency=2
   ```

The explicit acknowledgement, one-batch default, and hard batch limits prevent an accidental full 205 GB run. Increase `--max-batches` only in an approved run window with monitoring and reconciliation.

## Resumable adapter contract

The module in `ATTACHMENT_RESUMABLE_ADAPTER_MODULE` must export either `createResumableAttachmentUploader(context)` or `createUploader(context)`. The factory returns an object with:

```js
async uploadResumable({ bucketName, objectPath, declaredSizeBytes, chunkSizeBytes, allowOverwrite, openSource }) {
  // Resume from an authenticated private session. openSource(offset) performs
  // a Zoho GET with Range and rejects a non-206 resumed response.
  // chunkSizeBytes is 6 MB and allowOverwrite is always false.
  // Return only verified facts; never return or log an object URL.
  return { uploadedSizeBytes: declaredSizeBytes, sha256: '64 lowercase hex characters' };
}
```

Review the adapter for private routing, stable session persistence, chunk acknowledgement, offset reconciliation, retry bounds, and an end-to-end SHA-256 before configuring it. The core pipeline refuses files over 6 MB if this contract is absent or incomplete.

## Reconciliation and tombstones

After each approved batch, reconcile at least:

- source unique ID count versus manifest primary-key count;
- source declared bytes versus manifest declared bytes;
- quarantine count and reason distribution;
- `verified` rows with exact SHA-256 and size agreement;
- retry count, backoff, partial-upload review, and remaining capacity;
- anonymous `HEAD` and `GET` denial for private objects.

Do not mark a missing source item as deletable solely because it was absent from one scan. A complete successful scan must first create a tombstone review candidate. A human must inspect parent records, retention obligations, source recycle state, local references, and audit evidence. This toolkit never deletes the manifest row or object automatically.

## Offline verification

```bash
npm run check
npm test
```

The attachment tests use synthetic metadata and in-memory streams. They do not contact Zoho, Supabase, or any storage service, and they do not transfer customer attachment bytes.

## Evidence cross-links

- [On-demand attachment access design](docs/on-demand-attachment-access.md)
- [Zoho source inventory](ZOHO_SOURCE_INVENTORY.md)
- [Zoho migration manifest](ZOHO_MIGRATION_MANIFEST.md)
- [Zoho reconciliation report](ZOHO_RECONCILIATION_REPORT.md)

## Primary references

- [Zoho CRM V8: Get List of Attachments](https://www.zoho.com/crm/developer/docs/api/v8/get-attachments.html)
- [Zoho CRM V8: Download an Attachment](https://www.zoho.com/crm/developer/docs/api/v8/download-attachments.html)
- [Supabase: Private and public bucket access](https://supabase.com/docs/guides/storage/buckets/fundamentals)
- [Supabase: Standard uploads](https://supabase.com/docs/guides/storage/uploads/standard-uploads)
- [Supabase: Resumable uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads)
