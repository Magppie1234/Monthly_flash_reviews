'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const blueprintConfig = require('../config/blueprints.json');
const transitionDetails = require('../config/blueprint-transition-details.json');
const runtimeCompatibility = require('../config/widget-runtime-compatibility.json');

function boundedSlice(source, startMarker, endMarker, maxLength) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `Missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `Missing source marker after ${startMarker}: ${endMarker}`);
  const value = source.slice(start, end);
  assert.ok(value.length <= maxLength, `Source slice beginning ${startMarker} exceeded ${maxLength} characters.`);
  return value;
}

const predicateSource = boundedSlice(
  appSource,
  'function paymentPreviewLayoutId(record) {',
  'function paymentPreviewScalar(value) {',
  5200,
);
const snapshotSource = boundedSlice(
  appSource,
  'function paymentPreviewScalar(value) {',
  'function renderPaymentMilestonePreview(container, contactId, record, idPrefix) {',
  5000,
);
const renderSource = boundedSlice(
  appSource,
  'function renderPaymentMilestonePreview(container, contactId, record, idPrefix) {',
  'let activePaymentMilestonePreviewClose = null;',
  23000,
);
const modalSource = boundedSlice(
  appSource,
  'function openPaymentMilestonePreview(mod, contactId, record, blueprint, transition, input, restoreFocus = document.activeElement) {',
  '/* Payment Milestone local-only preview end */',
  7500,
);
const recordActionSource = boundedSlice(
  appSource,
  '// Source-defined local Blueprint transitions.',
  'automatic.forEach(t => {',
  11000,
);
const paymentStyles = boundedSlice(
  styles,
  '/* Payment Milestone local-only preview */',
  '/* Revise Quote local-only preview */',
  15000,
);
const scriptOrderSource = boundedSlice(
  indexSource,
  '<script src="/estimate-widget-preview.js"></script>',
  '</body>',
  900,
);

const sourceBlueprint = blueprintConfig.blueprints.find(item => String(item.id) === '1032257000001044611');
const sourceTransition = sourceBlueprint?.transitions.find(item => String(item.id) === '1032257000025407036');
const detail = transitionDetails.blueprints['1032257000001044611']?.transitions['1032257000025407036'];

test('retains the exact Price Discussion Create Payment Terms registration and blocked widget evidence', () => {
  assert.equal(sourceBlueprint?.name, 'Opportunity Stage');
  assert.equal(sourceBlueprint?.module, 'Contacts');
  assert.deepEqual(sourceBlueprint?.layout, {
    id: '1032257000000000171',
    name: 'Standard',
    api_name: 'Standard__s',
  });
  assert.equal(sourceBlueprint?.state_field, 'Stage');
  assert.deepEqual(sourceTransition?.from, {
    id: '1032257000001044579',
    display_value: 'Price Discussion',
    actual_value: 'Price Dicussion',
  });
  assert.deepEqual(sourceTransition?.to, {
    id: '1032257000001044583',
    display_value: 'Principally Closed',
    actual_value: 'Payment Awaited',
  });
  assert.equal(sourceTransition?.global, false);
  assert.equal(detail?.name, 'Create Payment Terms');
  assert.equal(detail?.common, false);
  assert.equal(detail?.trigger_type, 'manual');
  assert.deepEqual(detail?.before, { owners: ['Specific Users (1)'], criteria: [] });
  assert.deepEqual(detail?.during_inputs, [{
    kind: 'widget',
    widget_id: '1032257000007994308',
    name: 'Payment Milestone Widget',
    api_name: null,
    label: 'Payment Milestone Widget',
    data_type: 'widget',
    required: false,
    sequence: 1,
    definition_status: 'Captured package validated; original read-only local allocation preview implemented',
  }]);
  assert.deepEqual(detail?.after_actions, []);
  assert.equal(detail?.local_execution, 'Blocked');
  assert.match(detail?.block_reason || '', /Specific-user identity.*milestone deletion.*Contact updates.*milestone creation.*workflow triggering.*Blueprint continuation/i);
  assert.match(detail?.block_reason || '', /Amount_To_Be_Paid.*absent.*display-only/i);

  const runtime = runtimeCompatibility.widgets.find(item => item.id === '1032257000007994308');
  assert.equal(runtime?.preview_runtime_status, 'implemented-read-only');
  assert.equal(runtime?.full_runtime_status, 'blocked');
  assert.deepEqual(runtime?.modules_read, ['Contacts', 'Payment_Milestones']);
});

test('binds eligibility to the complete exact local record, Blueprint, transition, owner, and widget tuple', () => {
  assert.match(predicateSource, /mod === 'Contacts'/);
  assert.match(predicateSource, /paymentPreviewLayoutId\(record\) === '1032257000000000171'/);
  assert.match(predicateSource, /String\(blueprint\?\.blueprint_id \|\| ''\) === '1032257000001044611'/);
  assert.match(predicateSource, /blueprint\?\.blueprint === 'Opportunity Stage'/);
  assert.match(predicateSource, /blueprint\?\.state_field === 'Stage'/);
  assert.match(predicateSource, /blueprint\?\.current === 'Price Discussion'/);
  assert.match(predicateSource, /blueprint\?\.local === true/);
  assert.match(predicateSource, /String\(transition\?\.id \|\| ''\) === '1032257000025407036'/);
  assert.match(predicateSource, /transition\?\.name === 'Create Payment Terms'/);
  assert.match(predicateSource, /transition\?\.next_value === 'Principally Closed'/);
  assert.match(predicateSource, /transition\?\.next_actual_value === 'Payment Awaited'/);
  assert.match(predicateSource, /transition\?\.common === false/);
  assert.match(predicateSource, /transition\?\.trigger_type === 'manual'/);
  assert.match(predicateSource, /transition\?\.executable === false/);
  assert.match(predicateSource, /owners\.length === 1 && owners\[0\] === 'Specific Users \(1\)'/);
  assert.match(predicateSource, /criteria\.length === 0/);
  assert.match(predicateSource, /Array\.isArray\(transition\?\.during_inputs\)/);
  assert.match(predicateSource, /transition\.during_inputs\.length === 1/);
  assert.match(predicateSource, /transition\.during_inputs\[0\] === input/);
  assert.match(predicateSource, /Array\.isArray\(transition\?\.after_actions\)/);
  assert.match(predicateSource, /transition\.after_actions\.length === 0/);
  assert.match(predicateSource, /String\(input\?\.widget_id \|\| ''\) === '1032257000007994308'/);
  assert.match(predicateSource, /input\?\.name === 'Payment Milestone Widget'/);
  assert.match(predicateSource, /input\?\.definition_status === 'Captured package validated; original read-only local allocation preview implemented'/);
  assert.match(predicateSource, /window\.PaymentMilestonePreview\?\.createContext/);
  assert.match(predicateSource, /window\.PaymentMilestonePreview\?\.buildPaymentMilestoneDraft/);
});

test('adds a separate preview action immediately after the blocked source transition action', () => {
  assert.match(recordActionSource, /const paymentInput = \(t\.during_inputs \|\| \[\]\)\.find\(input => isPaymentMilestonePreviewInput\(mod, rec, bp, t, input\)\)/);
  assert.match(recordActionSource, /el\('button', 'source-action preview-action payment-preview-action', 'Payment Milestone · Preview'\)/);
  assert.match(recordActionSource, /paymentButton\.setAttribute\('aria-label', 'Open Payment Milestone read-only preview'\)/);
  assert.match(recordActionSource, /paymentButton\.onclick = \(\) => openPaymentMilestonePreview\(mod, id, rec, bp, t, paymentInput, paymentButton\)/);
  const transitionAppend = recordActionSource.indexOf('bpRow.appendChild(btn);');
  const previewCreation = recordActionSource.indexOf("const paymentButton = el('button'");
  assert.ok(transitionAppend >= 0 && previewCreation > transitionAppend);
});

test('uses exact complete GET-only Payment_Milestones evidence and reduces rows to a count', () => {
  assert.match(renderSource, /getFields\('Contacts'\)/);
  assert.match(renderSource, /getFields\('Payment_Milestones'\)/);
  assert.match(renderSource, /api\(`\/api\/related\/Contacts\/\$\{encodeURIComponent\(contactId\)\}\/Payment_Milestones\?page=1&per_page=200`\)/);
  assert.equal((renderSource.match(/\bapi\s*\(/g) || []).length, 1);
  assert.doesNotMatch(renderSource, /\bmethod\s*:/i);
  assert.match(renderSource, /relationship\?\.availability === 'queryable'/);
  assert.match(renderSource, /relationship\?\.related_module === 'Payment_Milestones'/);
  assert.match(renderSource, /relationship\.link_fields\.length === 1/);
  assert.match(renderSource, /relationship\.link_fields\[0\] === 'Opportunity_Name'/);
  assert.match(renderSource, /relationship\?\.link_basis === 'Exact source lookup relation'/);
  assert.match(renderSource, /relationship\?\.pagination\?\.page === 1/);
  assert.match(renderSource, /relationship\?\.pagination\?\.per_page === 200/);
  assert.match(renderSource, /relationship\?\.pagination\?\.limit_applied === true/);
  assert.match(renderSource, /relationship\?\.pagination\?\.has_more === false/);
  assert.match(renderSource, /relationship\?\.pagination\?\.returned === relationship\.data\.length/);
  assert.match(renderSource, /existingMilestoneCount: relationship\.data\.length/);
  assert.doesNotMatch(renderSource, /relationship\.data\s*\.(?:map|forEach|filter|find)|relationship\.data\s*\[/);
});

test('checks exact current metadata drift and passes only bounded non-identity record facts into the engine', () => {
  assert.match(snapshotSource, /timeZone: 'Asia\/Kolkata'/);
  assert.match(renderSource, /field\?\.api_name === preview\.constants\.sourceAmountTarget/);
  assert.match(renderSource, /sourceTargetFieldAvailable/);
  assert.match(renderSource, /paymentPreviewFieldMetadata\(contactFields, preview\.constants\.contactFieldTypes\)/);
  assert.match(renderSource, /paymentPreviewFieldMetadata\(paymentFields, preview\.constants\.paymentFieldTypes\)/);
  assert.match(snapshotSource, /record\?\.Product_Details1/);
  assert.match(snapshotSource, /productCount: productRows\.length/);
  for (const field of [
    'No_of_Accessories', 'Amount_After_Discount', 'Est_Closoure_Date', 'Next_Follow_Up_Date1',
    'Grand_Total', 'Management_Discount_Proposed', 'Quotation_Link', 'Region',
  ]) assert.match(snapshotSource, new RegExp(`record\\?\\.${field}`));
  assert.doesNotMatch(snapshotSource, /record\?\.(?:id|Owner|Full_Name|Contact_Name|Email|Phone|Mobile|Name)\b/i);
  assert.doesNotMatch(renderSource, /relationship\.data\s*\.(?:map|forEach)|JSON\.stringify\s*\(\s*(?:record|relationship)|esc\s*\(\s*contactId/i);
  assert.match(renderSource, /Specific-user permission is not asserted/);
  assert.match(renderSource, /Amount_To_Be_Paid target is absent locally/);
});

test('renders exact allocation controls and a display-only immutable result without file or identity inputs', () => {
  assert.match(renderSource, /3 milestones · 50 \/ 30 \/ 20/);
  assert.match(renderSource, /2 milestones · 50 \/ 50/);
  assert.match(renderSource, /retention\.max = '15'/);
  assert.match(renderSource, /preview\.constants\.milestoneNames/);
  assert.match(renderSource, /Magppie milestones · must total 100%/);
  assert.match(renderSource, /Include Sunrooof payment milestone/);
  assert.match(renderSource, /Sunrooof total amount/);
  assert.match(renderSource, /Sunrooof order booking amount/);
  assert.match(renderSource, /preview\.buildPaymentMilestoneDraft\(/);
  assert.match(renderSource, /result\.setAttribute\('aria-live', 'polite'\)/);
  assert.match(renderSource, /control\.removeAttribute\('aria-invalid'\)/);
  assert.match(renderSource, /invalidControl\.setAttribute\('aria-invalid', 'true'\)/);
  assert.match(renderSource, /SUNROOOF_VALUES_REQUIRED/);
  assert.match(renderSource, /valid Sunrooof total below the Contact grand total/);
  assert.match(renderSource, /valid Sunrooof order-booking amount/);
  assert.match(renderSource, /valid Sunrooof management discount/);
  assert.match(renderSource, /Display-only payment schedule/);
  assert.match(renderSource, /Non-persisted Contact values/);
  assert.match(renderSource, /label\.htmlFor = controlId/);
  assert.match(renderSource, /control\.id = controlId/);
  assert.doesNotMatch(renderSource, /\.type\s*=\s*['"]file['"]|FileReader|FormData|filename|Deal_Name|Full_Name|Owner|Email|Phone|Mobile/i);
});

test('opens a close-only accessible same-element-labelled dialog with Escape and focus restoration', () => {
  assert.match(modalSource, /const heading = el\('h2', null, 'Payment Milestones'\)/);
  assert.match(modalSource, /heading\.id = titleId/);
  assert.match(modalSource, /close\.setAttribute\('aria-label', 'Close Payment Milestone preview'\)/);
  assert.match(modalSource, /renderPaymentMilestonePreview\(body, contactId, record, idPrefix\)/);
  assert.match(modalSource, /modal\.setAttribute\('role', 'dialog'\)/);
  assert.match(modalSource, /modal\.setAttribute\('aria-modal', 'true'\)/);
  assert.match(modalSource, /modal\.setAttribute\('aria-labelledby', titleId\)/);
  assert.doesNotMatch(modalSource, /box\.setAttribute\('aria-labelledby'/);
  assert.match(modalSource, /modal\.removeAttribute\('aria-labelledby'\)/);
  assert.match(modalSource, /event\.key === 'Escape'/);
  assert.match(modalSource, /shell\.setAttribute\('inert', ''\)/);
  assert.match(modalSource, /shell\.removeAttribute\('inert'\)/);
  assert.match(modalSource, /event\.key === 'Tab'/);
  assert.match(modalSource, /box\.querySelectorAll\('button:not\(\[disabled\]\)/);
  assert.match(modalSource, /event\.shiftKey/);
  assert.match(modalSource, /event\.preventDefault\(\)/);
  assert.match(modalSource, /focusable\.indexOf\(document\.activeElement\)/);
  assert.match(modalSource, /% focusable\.length/);
  assert.match(modalSource, /focusable\[nextIndex\]\.focus\(\)/);
  assert.match(modalSource, /restoreFocus && document\.contains\(restoreFocus\)[\s\S]{0,80}restoreFocus\.focus\(\)/);
  assert.match(modalSource, /const done = el\('button', null, 'Close preview'\)/);
  assert.equal((modalSource.match(/footer\.appendChild\(/g) || []).length, 1);
  assert.match(modalSource, /close\.focus\(\)/);
  assert.doesNotMatch(modalSource, /btn-primary|\b(?:Complete|Continue|Submit|Save|Update|Delete|Create)\b|\.proceed\s*\(/i);
});

test('bounded Payment surface has no SDK, write, storage, file, source-package, or identity-copy capability', () => {
  const surface = [predicateSource, snapshotSource, renderSource, modalSource].join('\n');
  const forbidden = [
    /\bfetch\b/i,
    /XMLHttpRequest|WebSocket|EventSource|sendBeacon/i,
    /\b(?:ZOHO|ZDK)\b/i,
    /\.(?:insertRecord|updateRecord|deleteRecord|addNotes?|attachFile|uploadFile|proceed)\s*\(/i,
    /\bmethod\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i,
    /\/api\/(?:blueprint|records?|record\/|notes|attachments)/i,
    /\b(?:localStorage|sessionStorage|indexedDB)\b/i,
    /\b(?:FormData|FileReader|Blob)\b/,
    /\.type\s*=\s*['"]file['"]/i,
    /\bconsole\s*\./i,
    /\.zip\b|\bJSZip\b|\bunzip\b|captured[-_ ]source|source[-_ ]archive/i,
    /record\?\.(?:id|Owner|Full_Name|Contact_Name|Email|Phone|Mobile|Name)\b/i,
  ];
  for (const pattern of forbidden) assert.doesNotMatch(surface, pattern);
});

test('loads the isolated engine before app.js and has separate 600px and 390px responsive styling', () => {
  const designer = scriptOrderSource.indexOf('<script src="/designer-form-preview.js"></script>');
  const payment = scriptOrderSource.indexOf('<script src="/payment-milestone-preview.js"></script>');
  const app = scriptOrderSource.indexOf('<script src="/app.js"></script>');
  assert.ok(designer >= 0 && payment > designer && app > payment);
  assert.match(paymentStyles, /\.payment-preview-panel\s*\{[^}]*min-width:0/);
  assert.match(paymentStyles, /\.payment-preview-form\s*\{[^}]*repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(paymentStyles, /\.payment-preview-field input,\.payment-preview-field select\s*\{[^}]*box-sizing:border-box[^}]*width:100%[^}]*min-width:0/);
  assert.match(paymentStyles, /\.payment-preview-field input:focus,\.payment-preview-field select:focus/);
  assert.match(paymentStyles, /\.payment-preview-table-wrap\s*\{[^}]*overflow-x:auto/);
  assert.match(paymentStyles, /@media \(max-width:600px\)[\s\S]*?\.payment-preview-form,\.payment-preview-row,\.payment-preview-sunrooof-grid\s*\{[^}]*grid-template-columns:1fr/);
  assert.match(paymentStyles, /@media \(max-width:390px\)[\s\S]*?\.payment-preview-modal-body\s*\{[^}]*padding-right:10px!important[^}]*padding-left:10px!important/);
  assert.doesNotMatch(paymentStyles, /\.assign-preview|\.designer-preview|\.estimate-preview-form/);
});
