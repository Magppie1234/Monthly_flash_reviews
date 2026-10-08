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
  'function reviseQuotePreviewLayoutId(record) {',
  'function reviseQuotePreviewFieldMetadata(fields, fieldTypes) {',
  10000,
);
const snapshotSource = boundedSlice(
  appSource,
  'function reviseQuotePreviewFieldMetadata(fields, fieldTypes) {',
  'function renderReviseQuotePreview(container, contactId, idPrefix) {',
  6500,
);
const renderSource = boundedSlice(
  appSource,
  'function renderReviseQuotePreview(container, contactId, idPrefix) {',
  'let activeReviseQuotePreviewClose = null;',
  36000,
);
const modalSource = boundedSlice(
  appSource,
  'function openReviseQuotePreview(mod, contactId, record, blueprint, transition, input, restoreFocus = document.activeElement) {',
  '/* Revise Quote local-only preview end */',
  10000,
);
const recordActionSource = boundedSlice(
  appSource,
  '// Source-defined local Blueprint transitions.',
  'automatic.forEach(t => {',
  16000,
);
const reviseStyles = boundedSlice(
  styles,
  '/* Revise Quote local-only preview */',
  '/* Closure New local-only preview */',
  22000,
);
const scriptOrderSource = boundedSlice(
  indexSource,
  '<script src="/estimate-widget-preview.js"></script>',
  '</body>',
  1100,
);

const sourceBlueprint = blueprintConfig.blueprints.find(item => String(item.id) === '1032257000001044611');
const sourceTransition = sourceBlueprint?.transitions.find(item => String(item.id) === '1032257000010720046');
const sourceChildBlueprint = blueprintConfig.blueprints.find(item => String(item.id) === '1032257000000535747');
const detail = transitionDetails.blueprints['1032257000001044611']?.transitions['1032257000010720046'];

test('retains the exact Standard Contacts Revise Quote registration and blocked phase tuple', () => {
  assert.equal(sourceBlueprint?.name, 'Opportunity Stage');
  assert.equal(sourceBlueprint?.module, 'Contacts');
  assert.equal(sourceBlueprint?.state_field, 'Stage');
  assert.deepEqual(sourceBlueprint?.layout, {
    id: '1032257000000000171',
    name: 'Standard',
    api_name: 'Standard__s',
  });
  assert.deepEqual(sourceTransition?.from, {
    id: '1032257000011003089',
    display_value: 'Design Form Filled',
    actual_value: 'Assigned Designer',
  });
  assert.deepEqual(sourceTransition?.to, {
    id: '1032257000011003091',
    display_value: 'Approve/Disapprove Quote',
    actual_value: 'Approve/Disapprove Quote',
  });
  assert.equal(sourceTransition?.global, false);
  assert.equal(detail?.name, 'Approve/Revise Quote');
  assert.equal(detail?.common, false);
  assert.equal(detail?.trigger_type, 'manual');
  assert.deepEqual(detail?.before, { owners: ['All Users'], criteria: [] });
  assert.deepEqual(detail?.during_inputs, [{
    kind: 'widget',
    api_name: null,
    widget_id: '1032257000010720459',
    name: 'Revise Quote - Widget',
    label: 'Revise Quote - Widget',
    data_type: 'widget',
    required: false,
    sequence: 1,
    definition_status: 'Captured package validated; original read-only local quote-plan preview implemented',
  }]);
  assert.deepEqual(detail?.after_actions, []);
  assert.equal(detail?.local_execution, 'Blocked');
  assert.match(detail?.block_reason || '', /Order updates.*note creation.*attachment upload.*workflow triggering.*child Blueprint transitions.*parent Blueprint continuation/i);
});

test('retains the two exact config-linked Deals Order Stages child transitions', () => {
  assert.equal(sourceChildBlueprint?.name, 'Order Stages');
  assert.equal(sourceChildBlueprint?.module, 'Deals');
  assert.equal(sourceChildBlueprint?.state_field, 'Stage');
  assert.deepEqual(sourceChildBlueprint?.layout, {
    id: '1032257000000000173',
    name: 'Standard',
    api_name: 'Standard__s',
  });
  assert.deepEqual(
    ['1032257000008327496', '1032257000011087211'].map(id => {
      const transition = sourceChildBlueprint?.transitions.find(item => String(item.id) === id);
      return {
        from: transition?.from,
        global: transition?.global,
        id: String(transition?.id || ''),
        name: transition?.name,
        to: transition?.to,
      };
    }),
    [
      {
        from: { id: '1032257000008327456', display_value: 'Sent for Approval', actual_value: 'Sent for Approval' },
        global: false,
        id: '1032257000008327496',
        name: 'Design Approved',
        to: { id: '1032257000000535671', display_value: 'Price Discussion', actual_value: 'Price Discussion' },
      },
      {
        from: { id: '1032257000008327456', display_value: 'Sent for Approval', actual_value: 'Sent for Approval' },
        global: true,
        id: '1032257000011087211',
        name: 'Revision Required',
        to: { id: '1032257000010762010', display_value: 'Revision Required', actual_value: 'Revision Required' },
      },
    ],
  );
});

test('marks the exact widget implemented read-only while full execution remains blocked', () => {
  const runtime = runtimeCompatibility.widgets.find(item => item.id === '1032257000010720459');
  assert.equal(runtime?.name, 'Revise Quote - Widget');
  assert.equal(runtime?.preview_runtime_status, 'implemented-read-only');
  assert.equal(runtime?.full_runtime_status, 'blocked');
  assert.deepEqual(runtime?.modules_read, ['Contacts', 'Deals', 'Stage_History']);
  assert.match(runtime?.preview_rationale || '', /GET-only local quote-plan preview/i);
  assert.match(runtime?.preview_rationale || '', /None and Query to SM branches.*remain disabled/i);
});

test('binds eligibility to the complete record, Blueprint, transition, owner, phase, and widget contract', () => {
  for (const pattern of [
    /mod === 'Contacts'/,
    /reviseQuotePreviewLayoutId\(record\) === '1032257000000000171'/,
    /reviseQuotePreviewScalar\(record\?\.Stage\)[\s\S]{0,80}=== 'Design Form Filled'/,
    /String\(blueprint\?\.blueprint_id \|\| ''\) === '1032257000001044611'/,
    /blueprint\?\.blueprint === 'Opportunity Stage'/,
    /blueprint\?\.state_field === 'Stage'/,
    /blueprint\?\.current === 'Design Form Filled'/,
    /blueprint\?\.local === true/,
    /String\(transition\?\.id \|\| ''\) === '1032257000010720046'/,
    /transition\?\.name === 'Approve\/Revise Quote'/,
    /transition\?\.next_value === 'Approve\/Disapprove Quote'/,
    /transition\?\.next_actual_value === 'Approve\/Disapprove Quote'/,
    /transition\?\.common === false/,
    /transition\?\.trigger_type === 'manual'/,
    /transition\?\.executable === false/,
    /owners\.length === 1 && owners\[0\] === 'All Users'/,
    /criteria\.length === 0/,
    /transition\.during_inputs\.length === 1/,
    /transition\.during_inputs\[0\] === input/,
    /transition\.after_actions\.length === 0/,
    /String\(input\?\.widget_id \|\| ''\) === '1032257000010720459'/,
    /input\?\.name === 'Revise Quote - Widget'/,
    /input\?\.label === 'Revise Quote - Widget'/,
    /input\?\.api_name === null/,
    /input\?\.data_type === 'widget'/,
    /input\?\.required === false/,
    /input\?\.sequence === 1/,
    /contract\?\.layoutName === 'Standard'/,
    /contract\?\.currentActual === 'Assigned Designer'/,
    /typeof preview\?\.createContext === 'function'/,
    /typeof preview\?\.buildPlan === 'function'/,
  ]) assert.match(predicateSource, pattern);
});

test('adds a separate Revise Quote preview action after the blocked transition action', () => {
  assert.match(recordActionSource, /const reviseInput = \(t\.during_inputs \|\| \[\]\)\.find\(input => isReviseQuotePreviewInput\(mod, rec, bp, t, input\)\)/);
  assert.match(recordActionSource, /el\('button', 'source-action preview-action revise-preview-action', 'Revise Quote · Preview'\)/);
  assert.match(recordActionSource, /reviseButton\.type = 'button'/);
  assert.match(recordActionSource, /reviseButton\.setAttribute\('aria-label', 'Open Revise Quote read-only preview'\)/);
  assert.match(recordActionSource, /reviseButton\.onclick = \(\) => openReviseQuotePreview\(mod, id, rec, bp, t, reviseInput, reviseButton\)/);
  const transitionAppend = recordActionSource.indexOf('bpRow.appendChild(btn);');
  const previewCreation = recordActionSource.indexOf("const reviseButton = el('button'");
  assert.ok(transitionAppend >= 0 && previewCreation > transitionAppend);
});

test('uses only bounded local GETs for metadata, child Blueprint evidence, relationships, and fresh parent eligibility', () => {
  assert.match(renderSource, /getFields\('Contacts'\)/);
  assert.match(renderSource, /getFields\('Deals'\)/);
  assert.match(renderSource, /api\('\/api\/meta\/blueprint_studio'\)/);
  assert.match(renderSource, /api\(`\/api\/related\/Contacts\/\$\{encodeURIComponent\(contactId\)\}\/All_Orders\?page=1&per_page=200`\)/);
  assert.match(renderSource, /api\(`\/api\/record\/Contacts\/\$\{encodeURIComponent\(contactId\)\}`\)/);
  assert.match(renderSource, /api\(`\/api\/blueprint\/Contacts\/\$\{encodeURIComponent\(contactId\)\}`\)/);
  assert.equal((renderSource.match(/\bapi\s*\(/g) || []).length, 4);
  assert.doesNotMatch(renderSource, /\bmethod\s*:/i);
  assert.match(renderSource, /childTransitionContract: reviseQuotePreviewChildContractSnapshot\(blueprintStudio\)/);
  assert.match(renderSource, /contactFieldMetadata: reviseQuotePreviewFieldMetadata\(contactFields, preview\.constants\.contactFieldTypes\)/);
  assert.match(renderSource, /dealFieldMetadata: reviseQuotePreviewFieldMetadata\(dealFields, preview\.constants\.dealFieldTypes\)/);
  assert.match(renderSource, /relationship: reviseQuotePreviewRelationshipSnapshot\(relationship\)/);
  assert.doesNotMatch(renderSource, /getFields\('Stage_History'\)|\/Stage_History/);
});

test('derives only the strict anonymous two-transition snapshot from Blueprint Studio', () => {
  assert.match(snapshotSource, /function reviseQuotePreviewChildContractSnapshot\(blueprintStudio\)/);
  assert.match(snapshotSource, /window\.ReviseQuotePreview\?\.constants\?\.childBlueprintContract/);
  assert.match(snapshotSource, /blueprintStudio\?\.blueprints/);
  assert.match(snapshotSource, /matchingBlueprints = blueprints\.filter\(item => String\(item\?\.id \|\| ''\) === String\(expected\?\.blueprintId \|\| ''\)\)/);
  assert.match(snapshotSource, /matchingBlueprints\.length === 1 \? matchingBlueprints\[0\] : null/);
  assert.match(snapshotSource, /expectedTransitions\.map\(expectedTransition =>/);
  assert.match(snapshotSource, /matchingTransitions = transitions\.filter\(item => String\(item\?\.id \|\| ''\) === String\(expectedTransition\?\.id \|\| ''\)\)/);
  assert.match(snapshotSource, /matchingTransitions\.length === 1 \? matchingTransitions\[0\] : null/);
  for (const property of [
    'action', 'common', 'fromActual', 'fromDisplay', 'id', 'name', 'toActual', 'toDisplay', 'triggerType',
  ]) assert.match(snapshotSource, new RegExp(`${property}:`));
  assert.doesNotMatch(snapshotSource, /transition\?\.(?:before|during|after|execution)|blueprint\?\.(?:coverage|connections|entry|states)/);
  assert.doesNotMatch(snapshotSource, /Owner|Email|Phone|Mobile|Contact_Name|Deal_Name|Requirements_For_SM|Notes?|Attachments?|Payment/i);
});

test('reduces relationship rows to only anonymous ordinal, Product_Type, and display Stage evidence', () => {
  const rowProperties = [...snapshotSource.matchAll(/row\?\.([A-Za-z0-9_$]+)/g)].map(match => match[1]);
  assert.deepEqual(rowProperties, ['Product_Type', 'Stage']);
  assert.match(predicateSource, /return value\.display_value \?\? value\.actual_value \?\? ''/);
  assert.match(snapshotSource, /ordinal: index \+ 1/);
  assert.match(snapshotSource, /availability: relationship\?\.availability/);
  assert.match(snapshotSource, /relatedModule: relationship\?\.related_module/);
  assert.match(snapshotSource, /linkBasis: relationship\?\.link_basis/);
  assert.match(snapshotSource, /linkFields: Array\.isArray\(relationship\?\.link_fields\)/);
  assert.match(snapshotSource, /page: relationship\?\.pagination\?\.page/);
  assert.match(snapshotSource, /perPage: relationship\?\.pagination\?\.per_page/);
  assert.match(snapshotSource, /limitApplied: relationship\?\.pagination\?\.limit_applied/);
  assert.match(snapshotSource, /hasMore: relationship\?\.pagination\?\.has_more/);
  assert.match(snapshotSource, /returned: relationship\?\.pagination\?\.returned/);
  assert.doesNotMatch(snapshotSource, /row\?\.(?:id|Deal_Name|Contact_Name|Full_Name|Owner|Email|Phone|Mobile|Requirements_For_SM|Notes?|Attachments?|File|Payment)\b/i);
  assert.doesNotMatch(renderSource, /JSON\.stringify\s*\(\s*relationship|esc\s*\(\s*contactId|textContent\s*=\s*contactId/i);
});

test('sanitizes current metadata options and lets the engine enforce exact reviewed intersections', () => {
  assert.match(snapshotSource, /item\?\.api_name === apiName && item\?\.data_type === dataType/);
  assert.match(snapshotSource, /dataType === 'picklist' \|\| dataType === 'multiselectpicklist'/);
  assert.match(snapshotSource, /option\?\.type !== 'unused'/);
  assert.match(snapshotSource, /option\?\.actual_value, option\?\.display_value/);
  assert.match(snapshotSource, /value && value !== '-None-'/);
  assert.match(renderSource, /context\.orders\.forEach\(order =>/);
  assert.match(renderSource, /order\.presentationOptions/);
  assert.match(renderSource, /order\.themeOptions/);
  assert.match(renderSource, /context\.revisionReasons/);
  assert.match(renderSource, /context\.optionSets\.kitchenTypes/);
  assert.match(renderSource, /context\.optionSets\.wardrobeTypes/);
  assert.doesNotMatch(renderSource, /preview\.constants\.(?:kitchenTypes|wardrobeTypes|gasOptions|islandOptions|vastuOptions)/);
});

test('explicitly excludes None and Query to SM and fails closed when no eligible order exists', () => {
  assert.match(renderSource, /Stage None — unsupported in v1/);
  assert.match(renderSource, /Query to SM — unsupported in v1/);
  assert.match(renderSource, /V1 explicitly excludes Stage “None” and “Query to SM”/);
  assert.match(renderSource, /Those rows are not editable, not planned, and cannot continue any child Blueprint transition/);
  assert.match(renderSource, /if \(!context\.orders\.length\)/);
  assert.match(renderSource, /No anonymous All_Orders row is currently at display Stage “Sent for Approval”/);
  assert.match(renderSource, /No quote plan can be generated and nothing was changed/);
});

test('renders only the three reviewed choices and enforces revision-only reason semantics', () => {
  assert.match(renderSource, /selectControl\(preview\.constants\.actions\)/);
  assert.match(renderSource, /action\.value = 'Skip'/);
  assert.match(renderSource, /const planned = action\.value !== 'Skip'/);
  assert.match(renderSource, /const revising = action\.value === 'Revise Quotes'/);
  assert.match(renderSource, /reason\.disabled = !revising/);
  assert.match(renderSource, /reason\.required = revising/);
  assert.match(renderSource, /reasonField\.classList\.toggle\('hidden', !revising\)/);
  assert.match(renderSource, /if \(!revising\) clearControl\(reason\)/);
  assert.match(renderSource, /Design required on \*/);
  assert.match(renderSource, /Design_Required_on/);
  assert.match(renderSource, /Plan at least one eligible order/);
});

test('builds exact common and product-specific inputs and immutable anonymous output', () => {
  for (const pattern of [
    /Design presentation \*/,
    /Design theme \*/,
    /Finished ceiling height \*/,
    /Design required on \*/,
    /Kitchen types \*/,
    /Kitchen height \*/,
    /Island \*/,
    /Gas arrangement \*/,
    /Vastu requirement \*/,
    /Wardrobe types \*/,
    /Wardrobe height \*/,
    /preview\.buildPlan\(\{/,
    /Generate display-only quote plans/,
    /Display-only quote plans/,
    /plan\.order_label/,
    /plan\.product_type/,
    /plan\.source_stage/,
    /plan\.decision/,
    /plan\.intended_transition\.name/,
    /Object\.entries\(plan\.fields\)/,
    /Not persisted/,
  ]) assert.match(renderSource, pattern);
  assert.doesNotMatch(renderSource, /plan\.intended_transition\.id|draft\.plans\[[^\]]+\]\.id/);
  assert.doesNotMatch(renderSource, /relationship\.data\s*\.(?:forEach|filter|find)|row\?\.(?:id|Deal_Name|Contact_Name|Owner|Email|Phone|Mobile)/i);
});

test('provides field-specific errors, aria-invalid state, and focused recovery', () => {
  assert.match(renderSource, /const fieldError = el\('small', 'revise-preview-field-error'\)/);
  assert.match(renderSource, /fieldError\.setAttribute\('aria-live', 'polite'\)/);
  assert.match(renderSource, /control\.setAttribute\('aria-describedby', describedBy\.join\(' '\)\)/);
  assert.match(renderSource, /control\.removeAttribute\('aria-invalid'\)/);
  assert.match(renderSource, /target\.setAttribute\('aria-invalid', 'true'\)/);
  assert.match(renderSource, /target\._reviseFieldError\.textContent = message/);
  assert.match(renderSource, /target\.focus\(\)/);
  for (const code of [
    'PLAN_REQUIRED', 'PRESENTATION_UNSUPPORTED', 'THEME_UNSUPPORTED', 'CEILING_HEIGHT_REQUIRED',
    'DESIGN_DATE_INVALID', 'REVISION_REASON_REQUIRED', 'APPROVAL_REVISION_DATA_FORBIDDEN',
    'KITCHEN_TYPE_REQUIRED', 'KITCHEN_HEIGHT_UNSUPPORTED', 'ISLAND_UNSUPPORTED', 'GAS_UNSUPPORTED',
    'VASTU_UNSUPPORTED', 'WARDROBE_TYPE_REQUIRED', 'WARDROBE_HEIGHT_UNSUPPORTED',
  ]) assert.match(renderSource, new RegExp(code));
});

test('revalidates the exact fresh Contact and parent Blueprint immediately before building any plan', () => {
  const freshnessCheck = renderSource.indexOf("api(`/api/record/Contacts/${encodeURIComponent(contactId)}`)");
  const planBuild = renderSource.indexOf('const draft = preview.buildPlan({');
  assert.ok(freshnessCheck >= 0 && planBuild > freshnessCheck);
  assert.match(renderSource, /generate\.onclick = async \(\) =>/);
  assert.match(renderSource, /generate\.disabled = true/);
  assert.match(renderSource, /generate\.setAttribute\('aria-busy', 'true'\)/);
  assert.match(renderSource, /const \[parentResponse, freshBlueprint\] = await Promise\.all/);
  assert.match(renderSource, /freshRecords\.length === 1/);
  assert.match(renderSource, /matchingTransitions\.length === 1/);
  assert.match(renderSource, /matchingInputs\.length === 1/);
  assert.match(renderSource, /isReviseQuotePreviewInput\('Contacts', freshRecord, freshBlueprint, freshTransition, freshInput\)/);
  assert.match(renderSource, /fresh local Contact or parent Blueprint no longer matches the reviewed Revise Quote eligibility contract/);
  assert.match(renderSource, /Refresh the record before generating a new plan/);
  assert.match(renderSource, /finally \{[\s\S]{0,220}generate\.disabled = false[\s\S]{0,220}generate\.removeAttribute\('aria-busy'\)/);
  assert.match(renderSource, /returnFocusToGenerate && panel\.isConnected[\s\S]{0,80}generate\.focus\(\)/);
});

test('opens a close-only same-element-labelled dialog with inert shell, full focus cycle, Escape, and restoration', () => {
  assert.match(modalSource, /const heading = el\('h2', null, 'Revise Quote'\)/);
  assert.match(modalSource, /heading\.id = titleId/);
  assert.match(modalSource, /close\.setAttribute\('aria-label', 'Close Revise Quote preview'\)/);
  assert.match(modalSource, /renderReviseQuotePreview\(body, contactId, idPrefix\)/);
  assert.match(modalSource, /modal\.setAttribute\('role', 'dialog'\)/);
  assert.match(modalSource, /modal\.setAttribute\('aria-modal', 'true'\)/);
  assert.match(modalSource, /modal\.setAttribute\('aria-labelledby', titleId\)/);
  assert.doesNotMatch(modalSource, /box\.setAttribute\('aria-labelledby'/);
  assert.match(modalSource, /shell\.setAttribute\('inert', ''\)/);
  assert.match(modalSource, /shell\.removeAttribute\('inert'\)/);
  assert.match(modalSource, /event\.key === 'Escape'/);
  assert.match(modalSource, /event\.key === 'Tab'/);
  assert.match(modalSource, /box\.querySelectorAll\('button:not\(\[disabled\]\)/);
  assert.match(modalSource, /event\.preventDefault\(\)/);
  assert.match(modalSource, /focusable\.indexOf\(document\.activeElement\)/);
  assert.match(modalSource, /event\.shiftKey/);
  assert.match(modalSource, /% focusable\.length/);
  assert.match(modalSource, /focusable\[nextIndex\]\.focus\(\)/);
  assert.match(modalSource, /restoreFocus && document\.contains\(restoreFocus\)[\s\S]{0,80}restoreFocus\.focus\(\)/);
  assert.match(modalSource, /const done = el\('button', null, 'Close preview'\)/);
  assert.equal((modalSource.match(/footer\.appendChild\(/g) || []).length, 1);
  assert.match(modalSource, /close\.focus\(\)/);
  assert.doesNotMatch(modalSource, /btn-primary|\b(?:Complete|Continue|Submit|Save|Update|Delete|Upload|Create Note)\b|\.proceed\s*\(/i);
});

test('bounded preview surface has no write, SDK, provider request, storage, file, logging, or identity-copy path', () => {
  const surface = [predicateSource, snapshotSource, renderSource, modalSource].join('\n');
  for (const pattern of [
    /\bfetch\b/i,
    /XMLHttpRequest|WebSocket|EventSource|sendBeacon/i,
    /\b(?:ZOHO|ZDK)\b/i,
    /\.(?:insertRecord|updateRecord|deleteRecord|addNotes?|attachFile|uploadFile|proceed)\s*\(/i,
    /\bmethod\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i,
    /\/api\/(?:notes|attachments)(?:\/|\b)/i,
    /\b(?:localStorage|sessionStorage|indexedDB)\b/i,
    /\b(?:FormData|FileReader|Blob)\b/,
    /\.type\s*=\s*['"]file['"]/i,
    /\bconsole\s*\./i,
    /\.zip\b|\bJSZip\b|\bunzip\b|captured[-_ ]source|source[-_ ]archive/i,
    /row\?\.(?:id|Deal_Name|Contact_Name|Full_Name|Owner|Email|Phone|Mobile|Requirements_For_SM|Notes?|Attachments?|File|Payment)\b/i,
  ]) assert.doesNotMatch(surface, pattern);
});

test('loads the isolated engine before app.js and keeps isolated desktop and mobile styling', () => {
  const payment = scriptOrderSource.indexOf('<script src="/payment-milestone-preview.js"></script>');
  const revise = scriptOrderSource.indexOf('<script src="/revise-quote-preview.js"></script>');
  const automation = scriptOrderSource.indexOf('<script src="/automation-studios.js"></script>');
  const app = scriptOrderSource.indexOf('<script src="/app.js"></script>');
  assert.ok(payment >= 0 && revise > payment && automation > revise && app > automation);
  assert.match(reviseStyles, /\.revise-preview-panel\s*\{[^}]*min-width:0/);
  assert.match(reviseStyles, /\.revise-preview-grid\s*\{[^}]*repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(reviseStyles, /\.revise-preview-field input,\.revise-preview-field select\s*\{[^}]*box-sizing:border-box[^}]*width:100%[^}]*min-width:0/);
  assert.match(reviseStyles, /\.revise-preview-field input:focus,\.revise-preview-field select:focus/);
  assert.match(reviseStyles, /\.revise-preview-warning\s*\{[^}]*font-size:12px/);
  assert.match(reviseStyles, /\.revise-preview-field\s*\{[^}]*font-size:11\.5px/);
  assert.match(reviseStyles, /\.revise-preview-field input,\.revise-preview-field select\s*\{[^}]*font-size:13px/);
  assert.match(reviseStyles, /\.revise-preview-hint\s*\{[^}]*font-size:11px/);
  assert.match(reviseStyles, /\.revise-preview-plan-route dt,[^}]*font-size:11\.5px/);
  assert.doesNotMatch(reviseStyles, /font-size:(?:8\.5|9\.5|10|10\.5)px/);
  assert.match(reviseStyles, /@media \(max-width:600px\)[\s\S]*?\.revise-preview-grid\s*\{[^}]*grid-template-columns:1fr/);
  assert.match(reviseStyles, /@media \(max-width:390px\)[\s\S]*?\.revise-preview-modal-body\s*\{[^}]*padding-right:10px!important[^}]*padding-left:10px!important/);
  assert.doesNotMatch(reviseStyles, /\.assign-preview|\.designer-preview|\.payment-preview|\.estimate-preview-form/);
});
