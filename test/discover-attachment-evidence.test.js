'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const {
  attachmentEvidenceFromBaseline,
  auditAttachmentManifestCounts,
} = require('../scripts/discover-zoho');

test('attachment evidence keeps metadata separate from migrated bodies', () => {
  const evidence = attachmentEvidenceFromBaseline({
    source_attachment_unique_ids: 78758,
    missing_parent_module_references: 431,
    local_crm_record_attachment_ids: 2,
    source_ids_absent_from_crm_records: 78756,
    migration_executed: false,
  });

  assert.deepEqual(evidence, {
    source_attachment_ids: 78758,
    exact_addressable_triples: 78327,
    quarantined_rows: 431,
    locally_linked_ids: 2,
    absent_from_local_records: 78756,
    migrated_attachment_bodies: 0,
  });
});

test('count-only manifest audit exposes aggregates but no attachment data', async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'crm-attachment-count-audit-'));
  const manifestPath = path.join(directory, 'manifest.jsonl');
  const baselinePath = path.join(directory, 'baseline.json');
  const rows = [
    {
      source_org_id: 'org60046349006',
      attachment_id: 'secret-attachment-one',
      parent_module: 'Leads',
      parent_record_id: 'secret-parent-one',
      file_name: 'customer-private.pdf',
      declared_size_bytes: 100,
      uploaded_size_bytes: null,
      content_sha256: null,
      replication_status: 'metadata_only',
      verification_status: 'not_started',
      quarantine_reasons: [],
    },
    {
      source_org_id: 'org60046349006',
      attachment_id: 'secret-attachment-two',
      parent_module: null,
      parent_record_id: 'secret-parent-two',
      file_name: 'customer-private-two.pdf',
      declared_size_bytes: 200,
      uploaded_size_bytes: null,
      content_sha256: null,
      replication_status: 'quarantined',
      verification_status: 'not_started',
      quarantine_reasons: ['missing_parent_module'],
    },
  ];
  const baseline = {
    source_attachment_unique_ids: 2,
    missing_parent_module_references: 1,
    local_crm_record_attachment_ids: 1,
    source_ids_absent_from_crm_records: 1,
    migration_executed: false,
  };

  try {
    await fs.promises.writeFile(manifestPath, `${rows.map(row => JSON.stringify(row)).join('\n')}\n`, 'utf8');
    await fs.promises.writeFile(baselinePath, JSON.stringify(baseline), 'utf8');
    const counts = await auditAttachmentManifestCounts(manifestPath, baselinePath);

    assert.deepEqual(counts, {
      manifest_rows: 2,
      unique_attachment_ids: 2,
      exact_addressable_triples: 1,
      quarantined_rows: 1,
      metadata_only_rows: 1,
      verified_migrated_attachment_bodies: 0,
      rows_with_uploaded_bytes: 0,
      locally_linked_attachment_ids: 1,
      source_ids_absent_from_local_records: 1,
      duplicate_attachment_ids: 0,
      wrong_organization_rows: 0,
      baseline_counts_match: true,
    });
    const serialized = JSON.stringify(counts);
    assert.doesNotMatch(serialized, /secret-|customer-private|Leads/);
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});

test('discovery generator cannot label Attachments data as migrated bodies', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'discover-zoho.js'), 'utf8');
  const generatedSections = [
    ['const sourceInventory = [', "writeDoc('ZOHO_SOURCE_INVENTORY.md'"],
    ['const coverage = [', "writeDoc('ZOHO_CRM_COVERAGE_MATRIX.md'"],
    ['const manifest = [', "writeDoc('ZOHO_MIGRATION_MANIFEST.md'"],
    ['const reconciliation = [', "writeDoc('ZOHO_RECONCILIATION_REPORT.md'"],
  ].map(([startMarker, endMarker]) => {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    assert.ok(start >= 0 && end > start);
    return source.slice(start, end);
  });

  for (const generator of generatedSections) {
    assert.match(generator, /module\.api_name === 'Attachments'/);
    assert.doesNotMatch(generator, /Attachments[^\n]*Data Migrated/);
  }
  assert.match(generatedSections[0], /migrated_attachment_bodies/);
  assert.match(generatedSections[2], /on-demand access unmounted/);
});
