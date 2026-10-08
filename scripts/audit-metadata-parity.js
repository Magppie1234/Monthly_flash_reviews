#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const {
  buildMetadataParityAudit,
  validateMetadataParityAudit,
} = require('../lib/metadata-parity');

const ROOT = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT, '.env') });

const LOCAL_METADATA_SQL = "select key from crm_meta where key = 'modules' or key = 'pipelines' or key = 'global_picklists' or key like 'fields:%' or key like 'layouts:%' or key like 'views:%' or key like 'related_lists:%' or key like 'pipelines:%' order by key";
const SAFE_METADATA_KEY = /^(?:modules|pipelines|global_picklists|(?:fields|layouts|views|related_lists|pipelines):[A-Za-z][A-Za-z0-9_]*)$/;
const LOCAL_METADATA_BATCH_SIZE = 12;

function parseArgs(argv) {
  const result = {
    snapshot: process.env.ZOHO_METADATA_SNAPSHOT_PATH || '',
    config: path.join(ROOT, 'config', 'metadata-parity-audit.json'),
    document: path.join(ROOT, 'ZOHO_METADATA_PARITY_AUDIT.md'),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--snapshot') result.snapshot = argv[++index] || '';
    else if (flag === '--config') result.config = argv[++index] || '';
    else if (flag === '--document') result.document = argv[++index] || '';
    else throw new Error('Unknown metadata-audit argument.');
  }
  if (!result.snapshot) throw new Error('ZOHO_METADATA_SNAPSHOT_PATH or --snapshot is required.');
  if (!result.config || !result.document) throw new Error('Both public output targets are required.');
  return result;
}

function assertReadOnlyQuery(query) {
  const normalized = String(query || '').trim();
  if (!/^select\b/i.test(normalized)
      || /;\s*\S/.test(normalized)
      || /\b(?:insert|update|delete|merge|alter|drop|truncate|create|grant|revoke|copy|call|do)\b/i.test(normalized)) {
    throw new Error('Local metadata query is not SELECT-only.');
  }
  if (!/\bfrom\s+crm_meta\b/i.test(normalized) || /\bcrm_records\b|\busers\b|\bcrm_secret\b/i.test(normalized)) {
    throw new Error('Local metadata query exceeds the approved crm_meta scope.');
  }
  return normalized;
}

function metadataValueQuery(keys) {
  if (!Array.isArray(keys) || !keys.length || keys.length > LOCAL_METADATA_BATCH_SIZE || keys.some(key => !SAFE_METADATA_KEY.test(String(key)))) {
    throw new Error('Local metadata key batch is invalid.');
  }
  const values = keys.map(key => `'${String(key).replace(/'/g, "''")}'`).join(',');
  return assertReadOnlyQuery(`select key, data from crm_meta where key in (${values}) order by key`);
}

async function readLocalMetadataRows(fetchImpl = fetch) {
  const base = String(process.env.SUPABASE_URL || '');
  const apiKey = String(process.env.SUPABASE_ANON_KEY || '');
  const sqlSecret = String(process.env.CRM_SQL_SECRET || '');
  let parsed;
  try {
    parsed = new URL(base);
  } catch {
    throw new Error('Read-only local metadata connection is not configured.');
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.supabase.co') || !apiKey || !sqlSecret) {
    throw new Error('Read-only local metadata connection failed closed.');
  }
  const query = async q => {
    const response = await fetchImpl(`${base}/rest/v1/rpc/crm_sql`, {
      method: 'POST',
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: assertReadOnlyQuery(q), s: sqlSecret }),
    });
    if (!response.ok) throw new Error(`Read-only local metadata query failed with HTTP ${response.status}.`);
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error('Read-only local metadata query returned an invalid shape.');
    return rows;
  };
  const keyRows = await query(LOCAL_METADATA_SQL);
  const keys = keyRows.map(row => String(row?.key || ''));
  if (keys.some(key => !SAFE_METADATA_KEY.test(key)) || new Set(keys).size !== keys.length) {
    throw new Error('Read-only local metadata key inventory is invalid.');
  }
  const batches = [];
  for (let index = 0; index < keys.length; index += LOCAL_METADATA_BATCH_SIZE) batches.push(keys.slice(index, index + LOCAL_METADATA_BATCH_SIZE));
  const queue = [...batches];
  const output = [];
  const workers = Array.from({ length: Math.min(4, Math.max(1, queue.length)) }, async () => {
    while (queue.length) {
      const batch = queue.shift();
      output.push(...await query(metadataValueQuery(batch)));
    }
  });
  await Promise.all(workers);
  return output.sort((left, right) => String(left.key).localeCompare(String(right.key)));
}

function captureText(area) {
  const capture = area.source_capture;
  if (capture?.field_metadata) {
    return `field ${capture.field_metadata.successful_requests}/${capture.field_metadata.requests}; global ${capture.global_picklists.successful_requests}/${capture.global_picklists.requests}`;
  }
  return `${capture.successful_requests}/${capture.requests}`;
}

function renderDocument(audit) {
  const labels = [
    ['Modules', 'modules'],
    ['Fields', 'fields'],
    ['Layouts', 'layouts'],
    ['Picklists', 'picklists'],
    ['Pipelines', 'pipelines'],
    ['Custom views', 'custom_views'],
    ['Related lists', 'related_lists'],
  ];
  const rows = labels.map(([label, key]) => {
    const area = audit.areas[key];
    return `| ${label} | ${area.source_definitions.toLocaleString('en-US')} | ${area.local_definitions.toLocaleString('en-US')} | ${area.matched_definitions.toLocaleString('en-US')} | ${area.source_only.toLocaleString('en-US')} | ${area.local_only.toLocaleString('en-US')} | ${area.semantic_drift.toLocaleString('en-US')} | ${captureText(area)} | ${area.status} |`;
  });
  const capturedDefinitionsMirrored = ['fields', 'layouts', 'custom_views', 'related_lists']
    .every(key => audit.areas[key].source_only === 0 && audit.areas[key].local_only === 0);
  const options = audit.areas.picklists.option_coverage;
  const criteria = audit.areas.custom_views.criteria_coverage || {};
  return [
    '# Zoho CRM Metadata Parity Audit',
    '',
    `Status: **Blocked**. This is a read-only, metadata-only audit. ${capturedDefinitionsMirrored ? 'All successfully captured field, layout, custom-view list, and related-list definitions are now mirrored locally, but incomplete source responses and unavailable executable definitions still prevent production parity.' : 'Captured definition gaps still exist, and incomplete source responses prevent production parity.'}`,
    '',
    '## Exact captured parity',
    '',
    '| Area | Captured source definitions | Local definitions | Matched | Source-only | Local-only | Drift | Successful source requests | Status |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---|',
    ...rows,
    '',
    'The source column counts definitions present in the existing discovery snapshot. Where source requests failed, it is not an estimate of the inaccessible definitions. Exact status-code counts and affected module scopes are retained in the sanitized JSON artifact.',
    '',
    `Picklists comprise ${audit.areas.picklists.components.field_picklists.source_definitions.toLocaleString('en-US')} captured field-level definitions and ${audit.areas.picklists.components.global_picklists.source_definitions.toLocaleString('en-US')} global definitions, compared with ${audit.areas.picklists.components.field_picklists.local_definitions.toLocaleString('en-US')} local field-level definitions and ${audit.areas.picklists.components.global_picklists.local_definitions.toLocaleString('en-US')} local global definitions. Captured field option values total ${options.source_field_option_values.toLocaleString('en-US')} at source and ${options.local_field_option_values.toLocaleString('en-US')} locally. The global-list response did not include option values.`,
    '',
    'The two custom-view drift cases are changes to the shared `default` flag. Source-only view criteria or local-only enrichment attributes are not called drift: comparison is limited to semantic attributes captured on both sides.',
    '',
    `Custom-view list metadata contains executable criteria bodies for ${Number(criteria.captured_rows_with_criteria || 0).toLocaleString('en-US')}/${Number(criteria.captured_rows || 0).toLocaleString('en-US')} captured rows. Rows without criteria remain visibly unavailable and are never treated as unfiltered views.`,
    '',
    'Pipeline zero-versus-zero is not parity. Only 1 of 70 captured pipeline requests succeeded, that response contained no definitions, and the remaining 69 requests failed.',
    '',
    '## Blockers',
    '',
    ...audit.blockers.map(item => `- ${item}`),
    '',
    '## Safety boundary',
    '',
    '- Existing private discovery evidence was read without making a source request.',
    '- The local database query selects only approved `crm_meta` keys; no CRM records or identity catalogs are queried.',
    '- This audit run performs no source or local metadata writes and never deletes definitions. Missing-only hydration is a separate guarded command with exact-organization verification.',
    '- Public evidence contains aggregate counts and safe module API scopes only. It excludes records, identities, raw IDs, links, credentials, private locations, and hashes.',
    '',
    '## Decision',
    '',
    'Keep failed source scopes, custom-view criteria bodies, pipeline definitions, and global picklist values fail-closed. Never infer missing definitions or treat an incomplete view as unfiltered.',
    '',
  ].join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const snapshot = JSON.parse(fs.readFileSync(path.resolve(args.snapshot), 'utf8'));
  const rows = await readLocalMetadataRows();
  const audit = validateMetadataParityAudit(buildMetadataParityAudit(snapshot, rows));
  fs.mkdirSync(path.dirname(path.resolve(args.config)), { recursive: true });
  fs.writeFileSync(path.resolve(args.config), `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.resolve(args.document), renderDocument(audit), 'utf8');
  const ordered = ['modules', 'fields', 'layouts', 'picklists', 'pipelines', 'custom_views', 'related_lists'];
  const summary = ordered.map(key => `${key} ${audit.areas[key].source_definitions}/${audit.areas[key].local_definitions}`).join('; ');
  console.log(`Read-only metadata audit complete: ${summary}. Parity remains blocked; no metadata was changed.`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Metadata parity audit failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  LOCAL_METADATA_SQL,
  LOCAL_METADATA_BATCH_SIZE,
  parseArgs,
  assertReadOnlyQuery,
  metadataValueQuery,
  readLocalMetadataRows,
  renderDocument,
};
