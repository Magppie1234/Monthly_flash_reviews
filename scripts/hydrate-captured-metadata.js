#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const {
  assertOrganizationMatch,
  buildCapturedMetadataHydrationPlan,
} = require('../lib/captured-metadata-hydration');

const ROOT = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT, '.env') });

// Only the organization row needs its value. Existing metadata values may be
// multi-megabyte documents, so selecting them would add latency and exposure
// without helping a missing-key-only plan.
const LOCAL_METADATA_SQL = "select key, case when key = 'org' then data else '{}'::jsonb end as data from crm_meta where key = 'org' or key like 'fields:%' or key like 'layouts:%' or key like 'views:%' or key like 'related_lists:%' order by key";

function parseArgs(argv) {
  const output = {
    snapshot: process.env.ZOHO_METADATA_SNAPSHOT_PATH || path.join(ROOT, '.private', 'zoho-discovery', 'latest.json'),
    apply: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--snapshot') output.snapshot = argv[++index] || '';
    else if (flag === '--apply') output.apply = true;
    else throw new Error('Unknown captured-metadata hydration argument.');
  }
  if (!output.snapshot) throw new Error('A captured metadata snapshot is required.');
  return output;
}

function connection() {
  const base = String(process.env.SUPABASE_URL || '');
  const apiKey = String(process.env.SUPABASE_ANON_KEY || '');
  const sqlSecret = String(process.env.CRM_SQL_SECRET || '');
  let parsed;
  try {
    parsed = new URL(base);
  } catch {
    throw new Error('Local CRM database connection is not configured.');
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.supabase.co') || !apiKey || !sqlSecret) {
    throw new Error('Local CRM database connection failed closed.');
  }
  return { base, apiKey, sqlSecret };
}

async function rpc(name, body, fetchImpl = fetch) {
  const { base, apiKey } = connection();
  const response = await fetchImpl(`${base}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Local metadata operation failed with HTTP ${response.status}.`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function localMetadataRows() {
  const { sqlSecret } = connection();
  return rpc('crm_sql', { q: LOCAL_METADATA_SQL, s: sqlSecret });
}

async function writeEntry(entry) {
  const { sqlSecret } = connection();
  await rpc('crm_meta_upsert', { k: entry.key, d: entry.data, s: sqlSecret });
}

function summaryText(plan) {
  return Object.entries(plan.coverage)
    .map(([dataset, stats]) => `${dataset}: ${stats.planned_missing} missing scopes / ${stats.definitions_planned} definitions`)
    .join('; ');
}

async function applyPlan(plan) {
  const queue = [...plan.entries];
  const workers = Array.from({ length: Math.min(4, Math.max(1, queue.length)) }, async () => {
    while (queue.length) {
      const entry = queue.shift();
      await writeEntry(entry);
    }
  });
  await Promise.all(workers);
  const { sqlSecret } = connection();
  await rpc('crm_meta_upsert', {
    k: 'captured_metadata_hydration',
    d: {
      applied_at: new Date().toISOString(),
      source_mode: plan.source_mode,
      overwrite_existing: false,
      module_scopes: plan.module_scopes,
      entries_applied: plan.entries.length,
      coverage: plan.coverage,
    },
    s: sqlSecret,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const snapshot = JSON.parse(fs.readFileSync(path.resolve(args.snapshot), 'utf8'));
  const rows = await localMetadataRows();
  if (!Array.isArray(rows)) throw new Error('Local metadata query returned an invalid shape.');
  const orgRow = rows.find(row => row.key === 'org');
  assertOrganizationMatch(snapshot, orgRow?.data);
  const plan = buildCapturedMetadataHydrationPlan(snapshot, rows.map(row => row.key));
  console.log(`Captured metadata hydration ${args.apply ? 'apply' : 'dry run'}: ${plan.entries.length} local-only upserts; ${summaryText(plan)}.`);
  if (!args.apply) {
    console.log('No metadata was changed. Re-run with --apply to insert only missing scopes.');
    return;
  }
  await applyPlan(plan);
  console.log(`Captured metadata hydration complete: ${plan.entries.length} missing scopes inserted; existing local metadata preserved; Zoho source calls 0; Zoho writes 0.`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Captured metadata hydration failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  LOCAL_METADATA_SQL,
  applyPlan,
  connection,
  localMetadataRows,
  parseArgs,
  rpc,
  summaryText,
};
