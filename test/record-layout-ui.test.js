'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appSource = fs.readFileSync(path.resolve(__dirname, '..', 'public', 'app.js'), 'utf8');
const serverSource = fs.readFileSync(path.resolve(__dirname, '..', 'server.js'), 'utf8');

test('record details use exact layout resolution and never guess the first layout', () => {
  assert.match(serverSource, /layout_resolution:\s*resolution/);
  assert.match(serverSource, /resolveLayout\(layoutMeta, \{ record \}\)/);
  assert.match(appSource, /function displayLayoutContext\(/);
  assert.match(appSource, /Details are fail-closed/);
  assert.doesNotMatch(appSource, /const layout = layouts\.find\([^\n]+\) \|\| layouts\[0\]/);
  assert.doesNotMatch(appSource, /const renderLayout = layout \|\| \(rec \? layouts\[0\]/);
});

test('record Summary uses captured Zoho quick-sequence fields', () => {
  assert.match(appSource, /function summaryFieldNames\(/);
  assert.match(appSource, /field\.quick_sequence_number/);
  assert.doesNotMatch(appSource, /const summaryFields = \['Email','Phone','Mobile'/);
});

test('captured subform sections render a table or an explicit empty state', () => {
  assert.doesNotMatch(appSource, /if \(sec\.isSubformSection\) return/);
  assert.match(appSource, /subform-label/);
  assert.match(appSource, /subform-empty/);
});
