'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

function boundedSlice(source, startMarker, endMarker, maxLength) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `Missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `Missing source marker after ${startMarker}: ${endMarker}`);
  const value = source.slice(start, end);
  assert.ok(value.length <= maxLength, `Source slice beginning ${startMarker} exceeded ${maxLength} characters.`);
  return value;
}

const getFieldsSource = boundedSlice(
  appSource,
  'async function getFields(mod) {',
  'async function getViews(mod) {',
  700,
);
const predicateSource = boundedSlice(
  appSource,
  'function isAssignTechnicianPreviewInput(mod, blueprint, transition, input) {',
  'function assignPreviewScalar(value) {',
  2600,
);
const addressSource = boundedSlice(
  appSource,
  'function assignPreviewAddress(record) {',
  'function assignPreviewPicklistValues(field, { preferDisplay = false } = {}) {',
  2600,
);
const amsTeamSource = boundedSlice(
  appSource,
  'function assignPreviewAmsTeamOptionCount(field) {',
  'function renderAssignTechnicianPreview(container, record, idPrefix) {',
  2200,
);
const renderSource = boundedSlice(
  appSource,
  'function renderAssignTechnicianPreview(container, record, idPrefix) {',
  'let activeAssignTechnicianPreviewClose = null;',
  15000,
);
const modalSource = boundedSlice(
  appSource,
  'function openAssignTechnicianPreview(mod, rec, bp, transition, input, restoreFocus = document.activeElement) {',
  'function openBlueprintTransition(mod, id, rec, bp, transition) {',
  8500,
);
const recordActionSource = boundedSlice(
  appSource,
  '// Source-defined local Blueprint transitions.',
  'automatic.forEach(t => {',
  8000,
);
const scriptOrderSource = boundedSlice(
  indexSource,
  '<script src="/estimate-widget-preview.js"></script>',
  '</body>',
  600,
);
const sourceActionStyles = boundedSlice(
  styles,
  '.source-action:disabled',
  '/* Assign Technician local-only preview */',
  1000,
);
const assignPreviewStyles = boundedSlice(
  styles,
  '/* Assign Technician local-only preview */',
  '/* Estimate calculation-only preview */',
  10000,
);
const mobileShellStyles = boundedSlice(
  styles,
  '/* ---------- mobile ---------- */',
  '/* ---------- date filter ---------- */',
  10000,
);

test('binds preview eligibility to the exact local blocked Blueprint widget tuple', () => {
  assert.match(predicateSource, /mod === 'AMS_Complaints'/);
  assert.match(predicateSource, /String\(blueprint\?\.blueprint_id \|\| ''\) === '1032257000023685467'/);
  assert.match(predicateSource, /blueprint\?\.blueprint === 'AMS\/Complaint Flow'/);
  assert.match(predicateSource, /blueprint\?\.local === true/);
  assert.match(predicateSource, /String\(transition\?\.id \|\| ''\) === '1032257000023685453'/);
  assert.match(predicateSource, /transition\?\.name === 'Assign Technician'/);
  assert.match(predicateSource, /transition\?\.executable === false/);
  assert.match(predicateSource, /input\?\.kind === 'widget'/);
  assert.match(predicateSource, /String\(input\?\.widget_id \|\| ''\) === '1032257000023774783'/);
  assert.match(predicateSource, /\(input\?\.name \|\| input\?\.label\) === 'Assign Technician Widget'/);
  assert.match(predicateSource, /window\.AssignTechnicianPreview\?\.createContext/);
  assert.match(predicateSource, /window\.AssignTechnicianPreview\?\.buildVisitDraft/);
});

test('adds a separate preview action immediately after the blocked transition action', () => {
  assert.match(recordActionSource, /const assignInput = \(t\.during_inputs \|\| \[\]\)\.find\(input => isAssignTechnicianPreviewInput\(mod, bp, t, input\)\)/);
  assert.match(recordActionSource, /el\('button', 'source-action preview-action assign-preview-action', 'Assign Technician · Preview'\)/);
  assert.match(recordActionSource, /previewButton\.type = 'button'/);
  assert.match(recordActionSource, /previewButton\.setAttribute\('aria-label', 'Open Assign Technician read-only preview'\)/);
  assert.match(recordActionSource, /previewButton\.onclick = \(\) => openAssignTechnicianPreview\(mod, rec, bp, t, assignInput, previewButton\)/);

  const transitionAppend = recordActionSource.indexOf('bpRow.appendChild(btn);');
  const previewCreation = recordActionSource.indexOf("const previewButton = el('button'");
  const previewAppend = recordActionSource.indexOf('bpRow.appendChild(previewButton);');
  assert.ok(transitionAppend >= 0 && previewCreation > transitionAppend && previewAppend > previewCreation);
});

test('opens a separate close-only accessible modal with Escape and focus restoration', () => {
  assert.match(modalSource, /box\.innerHTML = ''/);
  assert.match(modalSource, /const heading = el\('h2', null, 'Assign Technician'\)/);
  assert.match(modalSource, /heading\.id = titleId/);
  assert.match(modalSource, /close\.setAttribute\('aria-label', 'Close Assign Technician preview'\)/);
  assert.match(modalSource, /renderAssignTechnicianPreview\(body, rec, idPrefix\)/);
  assert.match(modalSource, /modal\.setAttribute\('role', 'dialog'\)/);
  assert.match(modalSource, /modal\.setAttribute\('aria-modal', 'true'\)/);
  assert.match(modalSource, /modal\.setAttribute\('aria-labelledby', titleId\)/);
  assert.match(modalSource, /modal\.removeAttribute\('aria-labelledby'\)/);
  assert.doesNotMatch(modalSource, /box\.(?:setAttribute|removeAttribute)\('aria-labelledby'/);
  assert.match(modalSource, /event\.key === 'Escape'/);
  assert.match(modalSource, /restoreFocus && document\.contains\(restoreFocus\)[\s\S]{0,80}restoreFocus\.focus\(\)/);
  assert.match(modalSource, /const done = el\('button', null, 'Close preview'\)/);
  assert.match(modalSource, /footer\.appendChild\(done\)/);
  assert.match(modalSource, /close\.focus\(\)/);
  assert.doesNotMatch(modalSource, /btn-primary|\b(?:Complete|Schedule|Submit|Save|Create Visit)\b|\bapi\s*\(|\.proceed\s*\(/i);
});

test('uses only local Visit metadata, anonymous AMS-team counts, and the safe address fallback', () => {
  assert.match(getFieldsSource, /api\('\/api\/meta\/fields\?module=' \+ mod\)/);
  assert.doesNotMatch(getFieldsSource, /method\s*:/i);
  assert.match(renderSource, /getFields\('Visit_Module'\)/);
  assert.match(renderSource, /field\.api_name === 'Purpose' && field\.data_type === 'picklist'/);
  assert.match(renderSource, /field\.api_name === 'Record_Type' && field\.data_type === 'picklist'/);
  assert.match(renderSource, /field\.api_name === 'Team_Member_Name' && field\.data_type === 'multiselectpicklist'/);
  assert.match(renderSource, /assignPreviewPicklistValues\(recordTypeField, \{ preferDisplay: true \}\)/);
  assert.match(renderSource, /const sourceTeamOptionCount = assignPreviewAmsTeamOptionCount\(teamField\)/);
  assert.doesNotMatch(renderSource, /assignPreviewPicklistValues\(teamField\)/);
  assert.match(amsTeamSource, /\/\\\(AMS\\\)\\s\*\$\/i\.test\(value\)/);
  assert.match(amsTeamSource, /count \+= 1/);
  assert.match(renderSource, /teamOptionCount: sourceTeamOptionCount/);
  assert.match(renderSource, /Anonymized choices derived only from the count of locally configured AMS team options/);

  assert.match(addressSource, /const components = fields\.map/);
  assert.match(addressSource, /if \(components\.length\) return components\.join\(', '\)/);
  assert.match(addressSource, /record\?\.Client_Address/);
});

test('labels every control and exposes a polite non-persisted draft result', () => {
  assert.match(renderSource, /label\.htmlFor = controlId/);
  assert.match(renderSource, /control\.id = controlId/);
  assert.match(renderSource, /control\.setAttribute\('aria-describedby', hintNode\.id\)/);
  assert.match(renderSource, /purpose\.required = true/);
  assert.match(renderSource, /team\.multiple = true/);
  assert.match(renderSource, /team\.required = true/);
  assert.match(renderSource, /visitDate\.type = 'date'/);
  assert.match(renderSource, /visitDate\.required = true/);
  assert.match(renderSource, /fullAddress\.required = true/);
  assert.match(renderSource, /makeField\('Purpose of visit \*'/);
  assert.match(renderSource, /makeField\('Team members \*'/);
  assert.match(renderSource, /makeField\('Visit date \*'/);
  assert.match(renderSource, /makeField\('Full address \*'/);
  assert.match(renderSource, /result\.setAttribute\('aria-live', 'polite'\)/);
  assert.match(renderSource, /preview\.buildVisitDraft\(/);
  assert.match(renderSource, /'Sanitized Visit draft'/);
  assert.match(renderSource, /'Display-only context'/);
  assert.match(renderSource, /Not persisted · Disabled:/);
});

test('preview surface contains no mutation, provider, source-package, or identity-logging capability', () => {
  const previewSurface = [predicateSource, addressSource, amsTeamSource, renderSource, modalSource].join('\n');
  const forbidden = [
    /\bfetch\b/i,
    /XMLHttpRequest/i,
    /\bZOHO\b/i,
    /insertRecord|updateRecord|deleteRecord/i,
    /BLUEPRINT\.proceed|\.proceed\s*\(/i,
    /\bmethod\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i,
    /\/api\/blueprint/i,
    /\b(?:local|session)Storage\b/i,
    /\bconsole\s*\./i,
    /record\?*\.Owner|record\[['"]Owner['"]\]/i,
    /JSON\.stringify\s*\(\s*record\s*\)/i,
    /\.zip\b|\bJSZip\b|\bunzip\b|captured[-_ ]source|source[-_ ]archive/i,
  ];
  for (const pattern of forbidden) assert.doesNotMatch(previewSurface, pattern);
});

test('the public server surface cannot expose a captured ZIP package', () => {
  assert.match(serverSource, /app\.use\(express\.static\(path\.join\(__dirname, 'public'\)/);
  assert.doesNotMatch(serverSource, /(?:sendFile|download)\([^\n]*(?:\.zip|widget[-_ ]source|source[-_ ]archive)/i);
  const publicFiles = fs.readdirSync(path.join(root, 'public'), { recursive: true, withFileTypes: true });
  assert.equal(publicFiles.some(entry => entry.isFile() && /\.zip$/i.test(entry.name)), false);
});

test('loads the isolated engine before app.js and provides responsive focus-visible styling', () => {
  const engine = scriptOrderSource.indexOf('<script src="/assign-technician-preview.js"></script>');
  const app = scriptOrderSource.indexOf('<script src="/app.js"></script>');
  assert.ok(engine >= 0 && app > engine);

  assert.match(sourceActionStyles, /\.source-action\.preview-action\s*\{/);
  assert.match(assignPreviewStyles, /\.assign-preview-form\s*\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(assignPreviewStyles, /\.assign-preview-field input:focus,\.assign-preview-field select:focus,\.assign-preview-field textarea:focus/);
  assert.match(assignPreviewStyles, /@media \(max-width:600px\)[\s\S]*?\.assign-preview-form\s*\{[^}]*grid-template-columns:1fr/);
  assert.match(assignPreviewStyles, /@media \(max-width:600px\)[\s\S]*?\.assign-preview-generate\s*\{[^}]*width:100%/);
  assert.match(mobileShellStyles, /@media \(max-width:\s*820px\)[\s\S]*?#modalBox\s*\{[^}]*width:100vw[^}]*height:100dvh/);
});
