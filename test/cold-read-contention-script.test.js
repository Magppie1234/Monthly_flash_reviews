'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'scripts', 'qa-cold-read-contention.js'), 'utf8');
const pkg = require('../package.json');

test('cold contention QA is isolated, source-disabled, concurrent, bounded, and privacy-safe', () => {
  assert.equal(pkg.scripts['qa:cold-read'], 'node scripts/qa-cold-read-contention.js');
  assert.match(source, /ZOHO_REFRESH_TOKEN: ''/);
  assert.match(source, /ZOHO_CLIENT_ID: ''/);
  assert.match(source, /Promise\.all\(\[/);
  assert.match(source, /timedJson\('\/api\/agent\/status'\)/);
  assert.match(source, /timedJson\('\/api\/analytics\/overview'\)/);
  assert.match(source, /module_count === 41/);
  assert.match(source, /period_comparison\.length === 5/);
  assert.match(source, /source_query_attempts/);
  assert.match(source, /AbortSignal\.timeout\(REQUEST_TIMEOUT_MS\)/);
  assert.match(source, /mode: 0o600/);
  assert.match(source, /stopChild\(child\)/);
  assert.doesNotMatch(source, /body:\s*(?:assistant|analytics)\.body|permission_scope\.modules|datasets:\s*analytics\.body/);
});
