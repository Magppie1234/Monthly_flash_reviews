'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const blueprintConfig = JSON.parse(fs.readFileSync(path.join(root, 'config', 'blueprints.json'), 'utf8'));
const transitionDetails = JSON.parse(fs.readFileSync(path.join(root, 'config', 'blueprint-transition-details.json'), 'utf8'));

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
  'function designerPreviewLayoutId(record) {',
  'function designerPreviewScalar(value) {',
  4500,
);
const descriptorSource = boundedSlice(
  appSource,
  'function designerPreviewScalar(value) {',
  'function renderDesignerFormPreview(container, contactId, idPrefix) {',
  3000,
);
const renderSource = boundedSlice(
  appSource,
  'function renderDesignerFormPreview(container, contactId, idPrefix) {',
  'let activeDesignerFormPreviewClose = null;',
  18000,
);
const modalSource = boundedSlice(
  appSource,
  'function openDesignerFormPreview(mod, contactId, record, blueprint, transition, input, restoreFocus = document.activeElement) {',
  '/* Designer Form local-only preview end */',
  7000,
);
const recordActionSource = boundedSlice(
  appSource,
  '// Source-defined local Blueprint transitions.',
  'automatic.forEach(t => {',
  9000,
);
const designerStyles = boundedSlice(
  styles,
  '/* Designer Form local-only preview */',
  '/* Estimate calculation-only preview */',
  12000,
);
const scriptOrderSource = boundedSlice(
  indexSource,
  '<script src="/estimate-widget-preview.js"></script>',
  '</body>',
  700,
);

const sourceBlueprint = blueprintConfig.blueprints.find(
  blueprint => String(blueprint.id) === '1032257000001044611',
);
const sourceTransition = sourceBlueprint?.transitions.find(
  transition => String(transition.id) === '1032257000010677581',
);
const detailedBlueprint = transitionDetails.blueprints['1032257000001044611'];
const detailedTransition = detailedBlueprint?.transitions['1032257000010677581'];

test('retains the exact captured Contacts, Standard layout, Blueprint, transition, and state evidence', () => {
  assert.ok(sourceBlueprint);
  assert.equal(sourceBlueprint.name, 'Opportunity Stage');
  assert.equal(sourceBlueprint.module, 'Contacts');
  assert.equal(sourceBlueprint.ui_module, 'Contacts');
  assert.deepEqual(sourceBlueprint.layout, {
    id: '1032257000000000171',
    name: 'Standard',
    api_name: 'Standard__s',
  });
  assert.equal(sourceBlueprint.state_field, 'Stage');

  assert.ok(sourceTransition);
  assert.equal(sourceTransition.name, 'Design Form');
  assert.equal(sourceTransition.global, true);
  assert.deepEqual(sourceTransition.from, {
    id: '1032257000020185344',
    display_value: 'Validated By SM',
    actual_value: 'Validated By SM',
  });
  assert.deepEqual(sourceTransition.to, {
    id: '1032257000011003089',
    display_value: 'Design Form Filled',
    actual_value: 'Assigned Designer',
  });
});

test('retains the exact reviewed Before and During input evidence while full execution remains blocked', () => {
  assert.equal(detailedBlueprint.name, 'Opportunity Stage');
  assert.equal(detailedBlueprint.module, 'Contacts');
  assert.ok(detailedTransition);
  assert.equal(detailedTransition.name, 'Design Form');
  assert.equal(detailedTransition.common, true);
  assert.equal(detailedTransition.trigger_type, 'manual');
  assert.deepEqual(detailedTransition.before, {
    owners: ['All Users'],
    criteria: [],
  });
  assert.deepEqual(detailedTransition.during_inputs, [{
    kind: 'widget',
    widget_id: '1032257000010677855',
    name: 'Designer Form Widget',
    api_name: null,
    label: 'Designer Form Widget',
    data_type: 'widget',
    required: false,
    sequence: 1,
    definition_status: 'Captured package validated; original read-only local preview implemented',
  }]);
  assert.deepEqual(detailedTransition.after_actions, []);
  assert.equal(detailedTransition.local_execution, 'Blocked');
  assert.match(detailedTransition.block_reason, /Order updates/i);
  assert.match(detailedTransition.block_reason, /note creation/i);
  assert.match(detailedTransition.block_reason, /attachment upload/i);
  assert.match(detailedTransition.block_reason, /workflow triggering/i);
  assert.match(detailedTransition.block_reason, /Blueprint continuation/i);
  assert.deepEqual(detailedTransition.source_evidence, {
    method: 'read-only-ui-inspection',
    phase_keys_complete: true,
  });
});

test('binds preview eligibility to the complete exact captured runtime tuple', () => {
  assert.match(predicateSource, /record\?\.Layout\?\.id \|\| record\?\.\$layout_id\?\.id/);
  assert.match(predicateSource, /mod === 'Contacts'/);
  assert.match(predicateSource, /designerPreviewLayoutId\(record\) === '1032257000000000171'/);
  assert.match(predicateSource, /String\(blueprint\?\.blueprint_id \|\| ''\) === '1032257000001044611'/);
  assert.match(predicateSource, /blueprint\?\.blueprint === 'Opportunity Stage'/);
  assert.match(predicateSource, /blueprint\?\.state_field === 'Stage'/);
  assert.match(predicateSource, /blueprint\?\.current === 'Validated By SM'/);
  assert.match(predicateSource, /blueprint\?\.local === true/);
  assert.match(predicateSource, /String\(transition\?\.id \|\| ''\) === '1032257000010677581'/);
  assert.match(predicateSource, /transition\?\.name === 'Design Form'/);
  assert.match(predicateSource, /transition\?\.next_value === 'Design Form Filled'/);
  assert.match(predicateSource, /transition\?\.next_actual_value === 'Assigned Designer'/);
  assert.match(predicateSource, /transition\?\.common === true/);
  assert.match(predicateSource, /transition\?\.trigger_type === 'manual'/);
  assert.match(predicateSource, /transition\?\.executable === false/);
  assert.match(predicateSource, /owners\.length === 1 && owners\[0\] === 'All Users'/);
  assert.match(predicateSource, /criteria\.length === 0/);
  assert.match(predicateSource, /input\?\.kind === 'widget'/);
  assert.match(predicateSource, /String\(input\?\.widget_id \|\| ''\) === '1032257000010677855'/);
  assert.match(predicateSource, /input\?\.name === 'Designer Form Widget'/);
  assert.match(predicateSource, /input\?\.label === 'Designer Form Widget'/);
  assert.match(predicateSource, /input\?\.api_name === null/);
  assert.match(predicateSource, /input\?\.data_type === 'widget'/);
  assert.match(predicateSource, /input\?\.required === false/);
  assert.match(predicateSource, /input\?\.sequence === 1/);
  assert.match(predicateSource, /input\?\.definition_status === 'Captured package validated; original read-only local preview implemented'/);
  assert.match(predicateSource, /window\.DesignerFormPreview\?\.createContext/);
  assert.match(predicateSource, /window\.DesignerFormPreview\?\.buildDesignerDraft/);
});

test('adds a separate Designer preview action immediately after the blocked transition action', () => {
  assert.match(recordActionSource, /const designerInput = \(t\.during_inputs \|\| \[\]\)\.find\(input => isDesignerFormPreviewInput\(mod, rec, bp, t, input\)\)/);
  assert.match(recordActionSource, /el\('button', 'source-action preview-action designer-preview-action', 'Designer Form · Preview'\)/);
  assert.match(recordActionSource, /designerButton\.type = 'button'/);
  assert.match(recordActionSource, /designerButton\.setAttribute\('aria-label', 'Open Designer Form read-only preview'\)/);
  assert.match(recordActionSource, /designerButton\.onclick = \(\) => openDesignerFormPreview\(mod, id, rec, bp, t, designerInput, designerButton\)/);

  const transitionAppend = recordActionSource.indexOf('bpRow.appendChild(btn);');
  const previewCreation = recordActionSource.indexOf("const designerButton = el('button'");
  const previewAppend = recordActionSource.indexOf('bpRow.appendChild(designerButton);');
  assert.ok(transitionAppend >= 0 && previewCreation > transitionAppend && previewAppend > previewCreation);
});

test('uses only exact GET-only local Deals metadata and complete page-one All_Orders evidence', () => {
  assert.match(getFieldsSource, /api\('\/api\/meta\/fields\?module=' \+ mod\)/);
  assert.doesNotMatch(getFieldsSource, /method\s*:/i);
  assert.match(renderSource, /getFields\('Deals'\)/);
  assert.match(renderSource, /api\(`\/api\/related\/Contacts\/\$\{encodeURIComponent\(contactId\)\}\/All_Orders\?page=1&per_page=200`\)/);
  assert.equal((renderSource.match(/\bapi\s*\(/g) || []).length, 1);
  assert.doesNotMatch(renderSource, /\bmethod\s*:/i);
  assert.match(renderSource, /relationship\?\.availability === 'queryable'/);
  assert.match(renderSource, /relationship\?\.related_module === 'Deals'/);
  assert.match(renderSource, /Array\.isArray\(relationship\?\.link_fields\)/);
  assert.match(renderSource, /relationship\.link_fields\.length === 1/);
  assert.match(renderSource, /relationship\.link_fields\[0\] === 'Opportunity_Name'/);
  assert.match(renderSource, /relationship\?\.link_basis === 'Exact source lookup relation'/);
  assert.match(renderSource, /relationship\?\.pagination\?\.page === 1/);
  assert.match(renderSource, /relationship\?\.pagination\?\.per_page === 200/);
  assert.match(renderSource, /relationship\?\.pagination\?\.limit_applied === true/);
  assert.match(renderSource, /relationship\?\.pagination\?\.has_more === false/);
  assert.match(renderSource, /Array\.isArray\(relationship\?\.data\)/);
  assert.match(renderSource, /relationship\?\.pagination\?\.returned === relationship\.data\.length/);
  assert.match(renderSource, /designerPreviewProjectDescriptors\(relationship\.data\)/);
  assert.match(renderSource, /preview\.createContext\(\{[\s\S]*fieldMetadata: designerPreviewFieldMetadata\(fields, preview\.constants\.fieldTypes\),[\s\S]*projects,/);
});

test('derives anonymous projects from only Stage and Product_Type and never displays a source identity', () => {
  const rowProperties = [...descriptorSource.matchAll(/row\?\.([A-Za-z0-9_$]+)/g)].map(match => match[1]);
  assert.deepEqual(rowProperties, ['Stage', 'Product_Type']);
  assert.match(descriptorSource, /=== 'None'/);
  assert.match(descriptorSource, /ordinal: index \+ 1/);
  assert.match(descriptorSource, /productType: String\(designerPreviewScalar\(row\?\.Product_Type\)/);
  assert.doesNotMatch(descriptorSource, /\b(?:id|Deal_Name|Contact_Name|Full_Name|Owner|Email|Phone|Mobile|Payment|Attachment|File)\b/i);

  assert.match(renderSource, /Project identities are not displayed or copied/);
  assert.doesNotMatch(renderSource, /row\?\.(?:id|Deal_Name|Contact_Name|Full_Name|Owner|Email|Phone|Mobile|Payment|Attachment|File)\b/i);
  assert.doesNotMatch(renderSource, /relationship\.data\s*\.(?:map|forEach)|JSON\.stringify\s*\(\s*relationship|esc\s*\(\s*contactId|textContent\s*=\s*contactId/i);
  assert.match(renderSource, /draft\.project_label/);
  assert.match(renderSource, /draft\.product_type/);
  assert.match(renderSource, /Object\.entries\(draft\.fields\)/);
});

test('opens a close-only accessible dialog with same-element labelling, Escape, and focus restoration', () => {
  assert.match(modalSource, /box\.innerHTML = ''/);
  assert.match(modalSource, /const heading = el\('h2', null, 'Designer Form'\)/);
  assert.match(modalSource, /heading\.id = titleId/);
  assert.match(modalSource, /close\.setAttribute\('aria-label', 'Close Designer Form preview'\)/);
  assert.match(modalSource, /renderDesignerFormPreview\(body, contactId, idPrefix\)/);
  assert.match(modalSource, /modal\.setAttribute\('role', 'dialog'\)/);
  assert.match(modalSource, /modal\.setAttribute\('aria-modal', 'true'\)/);
  assert.match(modalSource, /modal\.setAttribute\('aria-labelledby', titleId\)/);
  assert.doesNotMatch(modalSource, /box\.setAttribute\('aria-labelledby'/);
  assert.match(modalSource, /event\.key === 'Escape'/);
  assert.match(modalSource, /restoreFocus && document\.contains\(restoreFocus\)[\s\S]{0,80}restoreFocus\.focus\(\)/);
  assert.match(modalSource, /const done = el\('button', null, 'Close preview'\)/);
  assert.match(modalSource, /done\.type = 'button'/);
  assert.match(modalSource, /footer\.appendChild\(done\)/);
  assert.equal((modalSource.match(/footer\.appendChild\(/g) || []).length, 1);
  assert.match(modalSource, /close\.focus\(\)/);
  assert.doesNotMatch(modalSource, /btn-primary|\b(?:Complete|Continue|Submit|Save|Update|Upload|Create Note)\b|\.proceed\s*\(/i);
});

test('uses labelled fieldsets, bounded product-specific controls, and a polite immutable-draft result', () => {
  assert.match(renderSource, /el\('fieldset', 'designer-preview-project'\)/);
  assert.match(renderSource, /el\('legend', null, `\$\{esc\(project\.label\)\} · \$\{esc\(project\.productType\)\}`\)/);
  assert.match(renderSource, /label\.htmlFor = controlId/);
  assert.match(renderSource, /control\.id = controlId/);
  assert.match(renderSource, /control\.setAttribute\('aria-describedby', hintNode\.id\)/);
  assert.match(renderSource, /select\.multiple = multiple/);
  assert.match(renderSource, /select\.required = true/);
  assert.match(renderSource, /ceilingHeight\.required = true/);
  assert.match(renderSource, /designRequiredOn\.type = 'date'/);
  assert.match(renderSource, /designRequiredOn\.required = true/);
  assert.match(renderSource, /city\.maxLength = preview\.constants\.limits\.city/);
  assert.match(renderSource, /Mapped to the current local Deals API field “city”/);
  assert.match(renderSource, /project\.productType === 'Kitchen'/);
  assert.match(renderSource, /preview\.constants\.kitchenTypes/);
  assert.match(renderSource, /preview\.constants\.kitchenHeights/);
  assert.match(renderSource, /preview\.constants\.islandOptions/);
  assert.match(renderSource, /preview\.constants\.gasOptions/);
  assert.match(renderSource, /preview\.constants\.vastuOptions/);
  assert.match(renderSource, /project\.productType === 'Wardrobe'/);
  assert.match(renderSource, /preview\.constants\.wardrobeTypes/);
  assert.match(renderSource, /preview\.constants\.wardrobeHeights/);
  assert.match(renderSource, /generate\.type = 'button'/);
  assert.match(renderSource, /result\.setAttribute\('aria-live', 'polite'\)/);
  assert.match(renderSource, /preview\.buildDesignerDraft\(/);
  assert.match(renderSource, /Sanitized Designer Form drafts/);
  assert.match(renderSource, /Not persisted · Disabled:/);
});

test('bounded Designer surface has no write, SDK, storage, file, note, payment, or identity-copy capability', () => {
  const previewSurface = [predicateSource, descriptorSource, renderSource, modalSource].join('\n');
  const forbidden = [
    /\bfetch\b/i,
    /XMLHttpRequest/i,
    /\b(?:WebSocket|EventSource|sendBeacon)\b/i,
    /\b(?:ZOHO|ZDK)\b/i,
    /\.(?:insertRecord|updateRecord|deleteRecord|addNotes?|attachFile|uploadFile|proceed)\s*\(/i,
    /\bmethod\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i,
    /\/api\/(?:blueprint|records?|modules?\/[^\s'"`]+\/[^\s'"`]+|bulk)/i,
    /\b(?:localStorage|sessionStorage|indexedDB)\b/i,
    /\bdocument\.cookie\b/i,
    /\b(?:FormData|FileReader|Blob)\b/,
    /\.type\s*=\s*['"]file['"]/i,
    /\bconsole\s*\./i,
    /JSON\.stringify\s*\(\s*(?:record|row|relationship)/i,
    /record\?\.(?:Owner|Email|Phone|Mobile|Full_Name|Contact_Name|Payment|Attachment|File)\b/i,
    /row\?\.(?:id|Owner|Email|Phone|Mobile|Deal_Name|Full_Name|Contact_Name|Payment|Attachment|File)\b/i,
    /\.zip\b|\bJSZip\b|\bunzip\b|captured[-_ ]source|source[-_ ]archive/i,
  ];
  for (const pattern of forbidden) assert.doesNotMatch(previewSurface, pattern);
});

test('loads the isolated Designer engine before app.js with separate responsive 390px-safe styling', () => {
  const estimate = scriptOrderSource.indexOf('<script src="/estimate-widget-preview.js"></script>');
  const assign = scriptOrderSource.indexOf('<script src="/assign-technician-preview.js"></script>');
  const designer = scriptOrderSource.indexOf('<script src="/designer-form-preview.js"></script>');
  const app = scriptOrderSource.indexOf('<script src="/app.js"></script>');
  assert.ok(estimate >= 0 && assign > estimate && designer > assign && app > designer);

  assert.match(designerStyles, /\.designer-preview-project\s*\{[^}]*min-width:0/);
  assert.match(designerStyles, /\.designer-preview-grid\s*\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(designerStyles, /\.designer-preview-field input,\.designer-preview-field select\s*\{[^}]*box-sizing:border-box[^}]*width:100%[^}]*min-width:0/);
  assert.match(designerStyles, /\.designer-preview-field input:focus,\.designer-preview-field select:focus/);
  assert.match(designerStyles, /@media \(max-width:600px\)[\s\S]*?\.designer-preview-grid\s*\{[^}]*grid-template-columns:1fr/);
  assert.match(designerStyles, /@media \(max-width:600px\)[\s\S]*?\.designer-preview-generate\s*\{[^}]*width:100%/);
  assert.match(designerStyles, /@media \(max-width:390px\)[\s\S]*?\.designer-preview-modal-body\s*\{[^}]*padding-right:10px!important[^}]*padding-left:10px!important/);
  assert.match(designerStyles, /@media \(max-width:390px\)[\s\S]*?\.designer-preview-panel,\.designer-preview-project,\.designer-preview-result\s*\{[^}]*max-width:100%[^}]*min-width:0/);
  assert.doesNotMatch(designerStyles, /\.assign-preview|\.estimate-preview-form/);
});
