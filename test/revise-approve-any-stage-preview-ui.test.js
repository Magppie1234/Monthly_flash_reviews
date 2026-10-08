'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const qaSource = fs.readFileSync(path.join(root, 'scripts', 'qa-local.js'), 'utf8');

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
  'function isReviseApproveAnyStagePreviewButton(button, mod, record, layoutExact, resolvedLayoutId) {',
  'let activeEstimatePreviewClose = null;',
  6500,
);
const metadataSource = boundedSlice(
  appSource,
  'function reviseApproveAnyStagePreviewScalar(value) {',
  'function reviseApproveAnyStagePreviewRelationship(relationship) {',
  9000,
);
const displayStageSource = boundedSlice(
  appSource,
  'function reviseApproveAnyStagePreviewDisplayStage(value) {',
  'function reviseApproveAnyStagePreviewRelationship(relationship) {',
  3000,
);
const relationshipSource = boundedSlice(
  appSource,
  'function reviseApproveAnyStagePreviewRelationship(relationship) {',
  'function reviseApproveAnyStagePreviewChildContract(blueprintStudio, preview) {',
  5500,
);
const evidenceSource = boundedSlice(
  appSource,
  'function reviseApproveAnyStagePreviewChildContract(blueprintStudio, preview) {',
  'function renderReviseApproveAnyStagePreview(container, contactId, idPrefix) {',
  11000,
);
const renderSource = boundedSlice(
  appSource,
  'function renderReviseApproveAnyStagePreview(container, contactId, idPrefix) {',
  'let activeReviseApproveAnyStagePreviewClose = null;',
  35000,
);
const modalSource = boundedSlice(
  appSource,
  'function openReviseApproveAnyStagePreview(mod, contactId, record, button, layoutExact, resolvedLayoutId, restoreFocus = document.activeElement) {',
  '/* Revise-Approve Quote Any Stage local-only preview end */',
  7500,
);
const recordHeaderSource = boundedSlice(
  appSource,
  'async function openRecord(mod, id) {',
  '// stage bar — single scrollable line with progress summary',
  12000,
);
const previewStyles = boundedSlice(
  styles,
  '/* Revise-Approve Quote Any Stage local-only preview */',
  '/* Closure New local-only preview */',
  18000,
);

test('binds only the exact Contacts view-button tuple and an authoritatively resolved registered layout', () => {
  for (const pattern of [
    /mod === 'Contacts'/,
    /layoutExact === true/,
    /String\(resolvedLayoutId \|\| ''\) === layoutId/,
    /String\(button\?\.id \|\| ''\) === '1032257000017358923'/,
    /button\?\.name === 'Revise-Approve Quote'/,
    /button\?\.api_name === 'Revise_Approve_Quote'/,
    /button\?\.position === 'view'/,
    /button\?\.action === 'widget'/,
    /button\?\.source === 'crm'/,
    /button\?\.sequence_number === 2/,
    /String\(button\?\.action_reference\?\.id \|\| ''\) === '1032257000017358913'/,
    /button\?\.action_reference\?\.name === 'Revise-Approve Quote-Any Stage'/,
    /button\?\.action_reference\?\.type === 'widget'/,
    /registeredLayouts\[0\] === '1032257000000000171'/,
    /registeredLayouts\[1\] === '1032257000005515301'/,
    /expectedLayouts\.includes\(layoutId\)/,
    /preview\?\.constants\?\.parentBlueprint === 'not-applicable'/,
  ]) assert.match(predicateSource, pattern);
  assert.doesNotMatch(predicateSource, /record\?\.Stage|profile_ids|user_types|blueprint_id|\/api\/blueprint/);

  assert.match(recordHeaderSource, /isReviseApproveAnyStagePreviewButton\(button, mod, rec, layoutExact, resolvedId\)/);
  assert.match(recordHeaderSource, /Revise-Approve Quote · Preview/);
  assert.match(recordHeaderSource, /sourceButton\.setAttribute\('aria-label', 'Open Revise-Approve Quote read-only preview'\)/);
  assert.match(recordHeaderSource, /openReviseApproveAnyStagePreview\(mod, id, rec, button, layoutExact, resolvedId, sourceButton\)/);
});

test('performs exactly seven direct uncached local GET-only reads on open and repeats them on Generate', () => {
  assert.match(metadataSource, /api\(path, \{ method: 'GET', cache: 'no-store' \}\)/);
  assert.match(evidenceSource, /Promise\.all\(\[/);
  for (const pattern of [
    /reviseApproveAnyStagePreviewGet\(`\/api\/record\/Contacts\/\$\{encodeURIComponent\(contactId\)\}`\)/,
    /reviseApproveAnyStagePreviewGet\('\/api\/meta\/layouts\?module=Contacts'\)/,
    /reviseApproveAnyStagePreviewGet\('\/api\/meta\/fields\?module=Contacts'\)/,
    /reviseApproveAnyStagePreviewGet\('\/api\/meta\/fields\?module=Deals'\)/,
    /reviseApproveAnyStagePreviewGet\(`\/api\/related\/Contacts\/\$\{encodeURIComponent\(contactId\)\}\/All_Orders\?page=1&per_page=200`\)/,
    /reviseApproveAnyStagePreviewGet\('\/api\/meta\/custom_buttons\?module=Contacts'\)/,
    /reviseApproveAnyStagePreviewGet\('\/api\/meta\/blueprint_studio'\)/,
  ]) assert.match(evidenceSource, pattern);
  assert.equal((evidenceSource.match(/reviseApproveAnyStagePreviewGet\s*\(/g) || []).length, 7);
  assert.equal((renderSource.match(/reviseApproveAnyStagePreviewReadEvidence\(contactId, preview\)/g) || []).length, 2);
  assert.doesNotMatch(`${metadataSource}\n${evidenceSource}\n${renderSource}`, /\bgetFields\s*\(|\bgetLayouts\s*\(|\/api\/blueprint\/Contacts\//);
  assert.doesNotMatch(`${metadataSource}\n${evidenceSource}\n${renderSource}`, /method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i);
});

test('requires exact fresh record, active layout, button catalog, fields, relationship, and child contract evidence', () => {
  assert.match(metadataSource, /records\.length !== 1 \|\| String\(records\[0\]\?\.id \|\| ''\) !== String\(expectedRecordId \|\| ''\)/);
  assert.match(metadataSource, /registered\.includes\(layoutId\)/);
  assert.match(metadataSource, /matches\.length !== 1/);
  assert.match(metadataSource, /matches\[0\]\?\.status !== 'active'/);
  assert.match(metadataSource, /matches\[0\]\?\.visible !== true/);
  assert.match(metadataSource, /recordResponse\?\.layout_resolution\?\.exact !== true/);
  assert.match(metadataSource, /String\(recordResponse\?\.layout_resolution\?\.layout_id \|\| ''\) !== layoutId/);
  assert.match(metadataSource, /item\?\.api_name === apiName && item\?\.data_type === dataType/);
  assert.match(metadataSource, /option\?\.type !== 'unused'/);
  assert.match(evidenceSource, /matches\.length === 1 \? matches\[0\] : null/);
  assert.match(evidenceSource, /matchingTransitions\.length === 1 \? matchingTransitions\[0\] : null/);
  assert.match(evidenceSource, /buttonContract: reviseApproveAnyStagePreviewButtonContract\(buttonCatalog\)/);
  assert.match(evidenceSource, /childTransitionContract: reviseApproveAnyStagePreviewChildContract\(blueprintStudio, preview\)/);
  assert.match(evidenceSource, /contactLayoutId: reviseApproveAnyStagePreviewContactLayout/);
  assert.match(evidenceSource, /relationship: reviseApproveAnyStagePreviewRelationship\(relationship\)/);
});

test('keeps relationship IDs only in a private stable ID-to-ordinal fingerprint and compares both snapshots', () => {
  const anonymousProperties = [...relationshipSource.matchAll(/row\?\.([A-Za-z0-9_$]+)/g)].map(match => match[1]);
  assert.deepEqual(anonymousProperties, ['Product_Type', 'Stage', 'id']);
  const anonymousSection = relationshipSource.slice(0, relationshipSource.indexOf('function reviseApproveAnyStagePreviewPrivateFingerprint'));
  assert.doesNotMatch(anonymousSection, /row\?\.(?:id|Deal_Name|Contact_Name|Full_Name|Owner|Email|Phone|Mobile|Opportunity_Name)\b/i);
  assert.match(relationshipSource, /const recordId = String\(row\?\.id \|\| ''\)/);
  assert.match(relationshipSource, /seen\.has\(recordId\)/);
  assert.match(relationshipSource, /return \[index \+ 1, recordId\]/);
  assert.match(relationshipSource, /orderIdToOrdinal: pairs/);
  assert.match(evidenceSource, /anonymousFingerprint: reviseApproveAnyStagePreviewAnonymousFingerprint\(context\)/);
  assert.match(evidenceSource, /privateFingerprint: reviseApproveAnyStagePreviewPrivateFingerprint\(contactId, relationship\)/);
  assert.match(renderSource, /freshEvidence\.privateFingerprint !== reviewedEvidence\.privateFingerprint/);
  assert.match(renderSource, /freshEvidence\.anonymousFingerprint !== reviewedEvidence\.anonymousFingerprint/);
  assert.match(renderSource, /preview\.buildPlan\(\{ context: freshEvidence\.context, orders: collectOrders\(\) \}\)/);
  assert.doesNotMatch(renderSource, /recordId|orderIdToOrdinal|privateFingerprint\s*[),]|textContent\s*=\s*contactId|esc\s*\(\s*contactId/i);
});

test('renders every non-Sent stage as blocked and exposes only the three exact quote decisions', () => {
  assert.match(renderSource, /Eligible Sent for Approval Orders/);
  assert.match(renderSource, /Other stages — explicitly blocked/);
  assert.match(renderSource, /Ignored Orders/);
  assert.match(renderSource, /Explicitly blocked Orders/);
  assert.match(renderSource, /Display Stage is not Sent for Approval/);
  assert.match(renderSource, /context\.blockedOrders\.forEach/);
  assert.match(renderSource, /Choose Skip, Revise Quotes, or Approved Quote/);
  assert.match(renderSource, /const revising = action\.value === 'Revise Quotes'/);
  assert.match(renderSource, /action\.value !== 'Skip'/);
  assert.match(renderSource, /Generate display-only quote plans/);
  assert.match(renderSource, /Display-only quote plans/);
  assert.match(renderSource, /plan\.intended_transition\.name/);
  assert.doesNotMatch(renderSource, /intended_transition\.id|transition_id|record_id|widget_id|button_id/i);
});

test('accepts a structured Stage only from its non-empty own display_value data property', () => {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(`${displayStageSource}\nglobalThis.displayStage = reviseApproveAnyStagePreviewDisplayStage;`, sandbox);

  assert.equal(sandbox.displayStage(' Sent for Approval '), 'Sent for Approval');
  assert.equal(sandbox.displayStage({ display_value: ' Sent for Approval ', actual_value: 'Draft' }), 'Sent for Approval');
  assert.equal(sandbox.displayStage({ actual_value: 'Sent for Approval' }), '');
  assert.equal(sandbox.displayStage({ display_value: '   ', actual_value: 'Sent for Approval' }), '');
  assert.equal(sandbox.displayStage(Object.create({ display_value: 'Sent for Approval' })), '');

  let accessorReads = 0;
  const accessorValue = {};
  Object.defineProperty(accessorValue, 'display_value', {
    configurable: true,
    enumerable: true,
    get() {
      accessorReads += 1;
      return 'Sent for Approval';
    },
  });
  assert.equal(sandbox.displayStage(accessorValue), '');
  assert.equal(accessorReads, 0);
  assert.equal(sandbox.displayStage(new Proxy({}, {
    getOwnPropertyDescriptor() {
      throw new Error('blocked proxy trap');
    },
  })), '');

  assert.match(relationshipSource, /stage: reviseApproveAnyStagePreviewDisplayStage\(row\?\.Stage\)/);
  assert.doesNotMatch(displayStageSource, /actual_value/);
  assert.doesNotMatch(relationshipSource, /row\?\.Stage\?\.(?:actual_value|value)|reviseApproveAnyStagePreviewScalar\(row\?\.Stage\)/);
});

test('builds the final dynamic plan summary as text, never as parsed markup', () => {
  assert.match(renderSource, /const summary = el\('small'\)/);
  assert.match(renderSource, /summary\.textContent = `Not persisted · \$\{draft\.totals\.blocked_orders\} blocked/);
  assert.match(renderSource, /result\.appendChild\(summary\)/);
  assert.doesNotMatch(renderSource, /el\('small', null, `Not persisted · \$\{draft\.totals\.blocked_orders\}/);
});

test('states the no-parent and non-asserted-profile boundaries without requesting parent Blueprint evidence', () => {
  assert.match(renderSource, /Local profile and user-type eligibility are not asserted/);
  assert.match(renderSource, /requests or continues a parent Blueprint/);
  assert.match(renderSource, /\['Parent Blueprint', context\.parentBlueprint\]/);
  assert.match(renderSource, /\['Local profile eligibility', 'Not asserted'\]/);
  assert.match(renderSource, /\['Parent Blueprint', draft\.parent_blueprint\]/);
  assert.doesNotMatch(`${metadataSource}\n${relationshipSource}\n${evidenceSource}\n${renderSource}\n${modalSource}`, /\/api\/blueprint\/Contacts\/|parentContract|parentTransition|parent_blueprint\s*:\s*['"](?:applicable|eligible)/i);
});

test('uses an inert close-only modal with a full focus cycle, Escape, and launcher restoration', () => {
  assert.match(modalSource, /const shell = \$\('#shell'\)/);
  assert.match(modalSource, /const shellWasInert = shell\?\.hasAttribute\('inert'\) === true/);
  assert.match(modalSource, /if \(shell\) shell\.setAttribute\('inert', ''\)/);
  assert.match(modalSource, /modal\.setAttribute\('role', 'dialog'\)/);
  assert.match(modalSource, /modal\.setAttribute\('aria-modal', 'true'\)/);
  assert.match(modalSource, /modal\.setAttribute\('aria-labelledby', titleId\)/);
  assert.match(modalSource, /heading\.id = titleId/);
  assert.match(modalSource, /close\.setAttribute\('aria-label', 'Close Revise-Approve Quote preview'\)/);
  assert.match(modalSource, /const done = el\('button', null, 'Close preview'\)/);
  assert.match(modalSource, /if \(event\.key === 'Escape'/);
  assert.match(modalSource, /if \(event\.key === 'Tab'/);
  assert.match(modalSource, /event\.shiftKey \? focusable\.length - 1 : 0/);
  assert.match(modalSource, /\(activeIndex \+ \(event\.shiftKey \? -1 : 1\) \+ focusable\.length\) % focusable\.length/);
  assert.match(modalSource, /document\.removeEventListener\('keydown', keyHandler\)/);
  assert.match(modalSource, /if \(shell && !shellWasInert\) shell\.removeAttribute\('inert'\)/);
  assert.match(modalSource, /document\.contains\(restoreFocus\)\) restoreFocus\.focus\(\)/);
  assert.match(modalSource, /close\.focus\(\)/);
  assert.doesNotMatch(modalSource, /Save|Submit|Apply|Continue|Proceed|Confirm/);
  assert.equal((appSource.match(/if \(activeReviseApproveAnyStagePreviewClose\) activeReviseApproveAnyStagePreviewClose\(false\);/g) || []).length, 11);
});

test('keeps the UI surface local, GET-only, anonymous, and free of SDK/provider/storage/file/logging paths', () => {
  const previewUiSource = `${metadataSource}\n${relationshipSource}\n${evidenceSource}\n${renderSource}\n${modalSource}`;
  for (const pattern of [
    /https?:\/\//i,
    /\bfetch\b|XMLHttpRequest|WebSocket|EventSource|sendBeacon/i,
    /\b(?:ZOHO|ZDK)\b/i,
    /\.(?:insertRecord|updateRecord|deleteRecord|addNotes?|attachFile|uploadFile|proceed)\s*\(/i,
    /\/api\/(?:workflows?|integrations?|notes?|attachments?|files?)/i,
    /method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i,
    /\b(?:localStorage|sessionStorage|indexedDB|clipboard)\b/i,
    /\b(?:FormData|FileReader|Blob)\b|\.type\s*=\s*['"]file['"]/i,
    /\bconsole\s*\.|setTimeout|setInterval/i,
    /\bgetCurrentUser\b|\/api\/users|\/api\/org|resolveIdentity/i,
    /innerHTML|insertAdjacentHTML|outerHTML|document\.write/i,
  ]) assert.doesNotMatch(previewUiSource, pattern);
});

test('loads the engine before app startup and uses isolated responsive 11–13px styles', () => {
  const engineIndex = indexSource.indexOf('<script src="/revise-approve-any-stage-preview.js"></script>');
  const appIndex = indexSource.indexOf('<script src="/app.js"></script>');
  assert.ok(engineIndex >= 0 && appIndex > engineIndex);
  assert.match(previewStyles, /\.revise-approve-preview-grid \{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(previewStyles, /\.revise-approve-preview-field input:focus,\.revise-approve-preview-field select:focus/);
  assert.match(previewStyles, /\.revise-approve-preview-action:focus-visible/);
  assert.match(previewStyles, /@media \(max-width:600px\)/);
  assert.match(previewStyles, /\.revise-approve-preview-grid \{ grid-template-columns:1fr; \}/);
  assert.match(previewStyles, /@media \(max-width:390px\)/);
  const fontSizes = [...previewStyles.matchAll(/font-size:([0-9.]+)px/g)].map(match => Number(match[1]));
  assert.ok(fontSizes.length >= 10);
  assert.equal(fontSizes.every(value => value >= 11 && value <= 13), true);
  assert.doesNotMatch(previewStyles, /(^|[},\s])(?:body|html|\.modal|\.mh|\.mb|\.mf)(?:\s|,|\{)/m);
});

test('updates local QA to nine implemented, zero candidates, and the exact button/widget contract', () => {
  assert.match(qaSource, /implemented_local_previews === 9/);
  assert.match(qaSource, /local_preview_candidates === 0/);
  assert.match(qaSource, /implementedWidgetProfiles\.length === 9/);
  assert.match(qaSource, /candidateWidgetProfiles\.length === 0/);
  assert.match(qaSource, /const reviseApproveButton = [^\n]+\.find\(button => String\(button\?\.id \|\| ''\) === '1032257000017358923'\)/);
  assert.match(qaSource, /Revise-Approve exact Contacts view-button\/widget\/layout contract drifted/);
  assert.match(qaSource, /reviseApproveButton\?\.local_status === 'Blocked'/);
});
