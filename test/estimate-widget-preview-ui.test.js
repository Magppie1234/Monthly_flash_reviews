'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const buttons = JSON.parse(fs.readFileSync(path.join(root, 'config', 'custom-buttons.json'), 'utf8')).buttons;
const previewStart = appSource.indexOf('/* Estimate preview modal start */');
const previewEnd = appSource.indexOf('/* Estimate preview modal end */', previewStart);
assert.ok(previewStart >= 0 && previewEnd > previewStart, 'Estimate preview modal source was not found.');
const previewSource = appSource.slice(previewStart, previewEnd);

test('loads the isolated calculation engine before the CRM application', () => {
  const engine = indexSource.indexOf('<script src="/estimate-widget-preview.js"></script>');
  const app = indexSource.indexOf('<script src="/app.js"></script>');
  assert.ok(engine >= 0 && app > engine);
});

test('enables only the exact captured Leads Estimate registration as a read-only preview', () => {
  const estimate = buttons.find(button => String(button.id) === '1032257000011958248');
  assert.equal(estimate.module, 'Leads');
  assert.equal(estimate.api_name, 'Estimate');
  assert.equal(estimate.position, 'view');
  assert.equal(estimate.action_reference.id, '1032257000012167001');
  assert.equal(estimate.local_status, 'Read-only preview');
  assert.match(estimate.block_reason, /calculation-only preview/i);
  assert.match(estimate.block_reason, /does not read or save a Lead/i);
  assert.match(estimate.block_reason, /full source action remains blocked/i);
  assert.match(appSource, /function isEstimatePreviewButton\(button, mod\)/);
  assert.match(appSource, /String\(button\?\.id \|\| ''\) === '1032257000011958248'/);
  assert.match(appSource, /String\(button\?\.action_reference\?\.id \|\| ''\) === '1032257000012167001'/);
  assert.match(appSource, /button\?\.local_status === 'Read-only preview'/);
  assert.match(appSource, /sourceButton\.disabled = !previewEnabled/);
  assert.match(appSource, /openEstimateWidgetPreview\(sourceButton\)/);
});

test('preview is accessible, formula-backed, complete, and has no record or outbound capability', () => {
  assert.match(previewSource, /setAttribute\('role', 'dialog'\)/);
  assert.match(previewSource, /setAttribute\('aria-modal', 'true'\)/);
  assert.match(previewSource, /modal\.setAttribute\('aria-labelledby', titleId\)/);
  assert.match(previewSource, /modal\.removeAttribute\('aria-labelledby'\)/);
  assert.doesNotMatch(previewSource, /box\.(?:setAttribute|removeAttribute)\('aria-labelledby'/);
  assert.match(previewSource, /setAttribute\('role', 'radiogroup'\)/);
  assert.match(previewSource, /setAttribute\('aria-live', 'polite'\)/);
  assert.match(previewSource, /event\.key === 'Escape'/);
  assert.match(previewSource, /preview\.calculateEstimate\(/);
  assert.match(previewSource, /wallFeet: inputs\.map\(input => input\.value\)/);
  assert.match(previewSource, /Recalculate/);
  assert.match(previewSource, /All Stone Cabinets/);
  assert.match(previewSource, /GST \(charged actual\)/);
  assert.match(previewSource, /Calculation only/);
  assert.doesNotMatch(previewSource, /\bapi\s*\(|\bfetch\b|XMLHttpRequest|ZOHO|updateRecord|sessionStorage|localStorage|record[_-]?id|Save to Lead/i);
});

test('preview has polished focus states and collapses safely on phones', () => {
  assert.match(styles, /\.source-action\.preview-action\s*\{/);
  assert.match(styles, /\.estimate-shape-option:focus-visible/);
  assert.match(styles, /\.estimate-result-metrics\s*\{[^}]*repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(styles, /@media \(max-width:600px\)[\s\S]*\.estimate-option-grid,\.estimate-wall-grid,\.estimate-scope-grid\s*\{[^}]*grid-template-columns:1fr/);
  assert.match(styles, /@media \(max-width:600px\)[\s\S]*\.estimate-result-metrics\s*\{[^}]*grid-template-columns:1fr/);
});
