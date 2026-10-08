'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildWorkflowRuntimeInventory } = require('../lib/workflow-engine');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_PATH = path.join(ROOT, 'config', 'workflow-runtime.json');
const DEFAULT_LOCAL_ENDPOINT = 'http://127.0.0.1:3100/api/meta/automation';

function parseArgs(argv) {
  const options = { input: null, check: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--input') {
      const value = argv[index + 1];
      if (!value) throw new Error('--input requires a JSON file path.');
      options.input = path.resolve(value);
      index += 1;
    } else if (argument === '--check') {
      options.check = true;
    } else if (argument === '--help') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function assertLocalAutomationEndpoint(endpoint) {
  const url = new URL(endpoint);
  const localHosts = new Set(['127.0.0.1', 'localhost', '::1']);
  if (url.protocol !== 'http:' || !localHosts.has(url.hostname)
    || url.pathname !== '/api/meta/automation' || url.search || url.hash) {
    throw new Error('Workflow inventory may read only the exact local /api/meta/automation endpoint.');
  }
  return url;
}

async function loadCapturedMetadata({ input = null } = {}) {
  if (input) return JSON.parse(fs.readFileSync(input, 'utf8'));
  const endpoint = process.env.WORKFLOW_AUTOMATION_LOCAL_ENDPOINT || DEFAULT_LOCAL_ENDPOINT;
  assertLocalAutomationEndpoint(endpoint);
  const response = await fetch(endpoint, {
    method: 'GET',
    redirect: 'error',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Local captured automation metadata returned HTTP ${response.status}.`);
  return response.json();
}

function writeAtomically(filePath, value) {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o644 });
  fs.renameSync(temporaryPath, filePath);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write([
      'Usage: node scripts/build-workflow-runtime.js [--input captured-automation.json] [--check]',
      '',
      'Without --input, the script performs one GET against the exact localhost',
      '/api/meta/automation endpoint. It never contacts or writes to Zoho.',
      '',
    ].join('\n'));
    return;
  }
  const metadata = await loadCapturedMetadata(options);
  const existing = options.check && fs.existsSync(OUTPUT_PATH)
    ? JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'))
    : null;
  const inventory = buildWorkflowRuntimeInventory(metadata, {
    generatedAt: existing?.generated_at || new Date().toISOString(),
  });
  if (options.check) {
    if (!existing || JSON.stringify(existing) !== JSON.stringify(inventory)) {
      throw new Error('config/workflow-runtime.json does not match the captured local automation metadata.');
    }
    process.stdout.write(`Workflow runtime inventory is current: ${inventory.coverage.plan_eligible_active_rules} plan-eligible, ${inventory.coverage.blocked_active_rules} active blocked.\n`);
    return;
  }
  writeAtomically(OUTPUT_PATH, inventory);
  process.stdout.write(`Built config/workflow-runtime.json: ${inventory.coverage.plan_eligible_active_rules} plan-eligible, ${inventory.coverage.blocked_active_rules} active blocked, ${inventory.coverage.runtime_write_enabled_rules} write-enabled.\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`Workflow runtime inventory failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { assertLocalAutomationEndpoint, loadCapturedMetadata, main, parseArgs };
