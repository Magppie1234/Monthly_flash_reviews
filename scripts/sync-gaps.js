#!/usr/bin/env node
'use strict';

// Idempotent source-to-local gap importer. Source access is GET-only; all
// writes are restricted to the local Supabase replica through pull-zoho.js.
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const discoveryPath = path.join(root, '.private', 'zoho-discovery', 'latest.json');
let discovery;
try {
  discovery = require(discoveryPath);
} catch {
  console.error('Run npm run discover:zoho before syncing gaps.');
  process.exit(1);
}

const localCounts = discovery.local?.record_counts || {};
const gaps = discovery.modules
  .filter(entry => entry.source_count?.ok)
  .map(entry => ({
    module: entry.module.api_name,
    source: Number(entry.source_count.count || 0),
    local: Number(localCounts[entry.module.api_name] || 0),
  }))
  .filter(item => item.source > item.local && item.source > 0);

if (!gaps.length) {
  console.log('No importable source-to-local record gaps were found.');
  process.exit(0);
}

console.log(`Importing ${gaps.length} source-to-local module gaps with GET-only Zoho access.`);
for (const gap of gaps) console.log(`${gap.module}: source ${gap.source}, local ${gap.local}`);

const child = spawnSync(process.execPath, [path.join(root, 'sync', 'pull-zoho.js')], {
  cwd: root,
  env: { ...process.env, ONLY: gaps.map(item => item.module).join(',') },
  stdio: 'inherit',
});
if (child.error) throw child.error;
process.exit(child.status ?? 1);
