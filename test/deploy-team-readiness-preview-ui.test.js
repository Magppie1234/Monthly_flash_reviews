'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const packageJson = require('../package.json');

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
  'function isDeployTeamReadinessPreviewButton(button, mod, record, layoutExact, resolvedLayoutId) {',
  'let activeEstimatePreviewClose = null;',
  8000,
);
const helperSource = boundedSlice(
  appSource,
  '/* Deploy Team GET-only readiness preview start */',
  'function deployTeamPreviewRelationship(relationship) {',
  18000,
);
const displayStageSource = boundedSlice(
  appSource,
  'function deployTeamPreviewDisplayStage(value) {',
  'function deployTeamPreviewButtonContract(catalog) {',
  3000,
);
const adapterSource = boundedSlice(
  appSource,
  'function deployTeamPreviewOwnData(object, key) {',
  'async function deployTeamPreviewMapLimit(rows, maxConcurrency, mapper) {',
  14000,
);
const relationshipSource = boundedSlice(
  appSource,
  'function deployTeamPreviewRelationship(relationship) {',
  'function deployTeamPreviewVisitBlueprint(catalog, preview) {',
  13000,
);
const evidenceSource = boundedSlice(
  appSource,
  'function deployTeamPreviewVisitBlueprint(catalog, preview) {',
  'function deployTeamPreviewMetadataCount(context, apiName) {',
  15000,
);
const renderSource = boundedSlice(
  appSource,
  'function renderDeployTeamReadinessPreview(container, contactId, idPrefix) {',
  'let activeDeployTeamReadinessPreviewClose = null;',
  30000,
);
const modalSource = boundedSlice(
  appSource,
  'function openDeployTeamReadinessPreview(mod, contactId, record, button, layoutExact, resolvedLayoutId, restoreFocus = document.activeElement) {',
  '/* Deploy Team GET-only readiness preview end */',
  9000,
);
const actionSource = boundedSlice(
  appSource,
  "buttons.filter(button => button.position === 'view').forEach(button => {",
  '// stage bar — single scrollable line with progress summary',
  9000,
);
const previewStyles = boundedSlice(
  styles,
  '/* Deploy Team GET-only readiness preview */',
  '/* ---------- CRM Journey Home ---------- */',
  15000,
);

test('binds only the exact registered Contacts Standard-layout view button and widget', () => {
  for (const pattern of [
    /mod === 'Contacts'/,
    /layoutExact === true/,
    /String\(resolvedLayoutId \|\| ''\) === '1032257000000000171'/,
    /layoutId === '1032257000000000171'/,
    /String\(button\?\.id \|\| ''\) === '1032257000022961587'/,
    /button\?\.name === 'Deploy Team for Installation'/,
    /button\?\.api_name === 'Assign_Visit_for_Installation'/,
    /button\?\.position === 'view'/,
    /button\?\.action === 'widget'/,
    /button\?\.source === 'crm'/,
    /button\?\.sequence_number === 3/,
    /button\.layout_ids\[0\] === '1032257000000000171'/,
    /String\(button\?\.action_reference\?\.id \|\| ''\) === '1032257000022961582'/,
    /button\?\.action_reference\?\.name === 'Deploy Team'/,
    /preview\?\.constants\?\.parentBlueprint === 'not-applicable'/,
  ]) assert.match(predicateSource, pattern);
  assert.doesNotMatch(predicateSource, /profile_ids|user_types|blueprint_id|record\?\.Stage/);
});

test('requires a direct authoritative Contact layout rather than a first-layout fallback', () => {
  assert.match(helperSource, /recordLayoutId !== expected\?\.id/);
  assert.match(helperSource, /resolution\?\.exact !== true/);
  assert.match(helperSource, /resolution\?\.source !== 'record'/);
  assert.match(helperSource, /resolution\?\.reason !== null/);
  assert.match(helperSource, /String\(resolution\?\.layout_id \|\| ''\) !== expected\?\.id/);
  assert.match(helperSource, /layout\?\.status === 'active'/);
  assert.match(helperSource, /layout\?\.visible === true/);
  assert.doesNotMatch(helperSource, /layouts\s*\[\s*0\s*\]|only_active_layout/);
});

test('reduces metadata to types, booleans, lookup contracts, option counts, and exact constant presence', () => {
  assert.match(helperSource, /requiredOptionPresent: specification\.requiredOption/);
  assert.match(helperSource, /options\.includes\(specification\.requiredOption\)/);
  for (const name of [
    'Stage', 'Installation_Managers', 'Product_Name', 'Product_Type', 'Name',
    'Client_Name', 'Client_Address', 'Record_Type', 'AMS_Status', 'Installation_Manager',
    'Task_Name', 'Team_Member_Name', 'Assigned_Team_Member_Count', 'Scheduled_Visit_Date',
    'Orders_Name', 'Installations_Services',
  ]) assert.match(helperSource, new RegExp(`apiName: '${name}'`));
  for (const value of ['Start First Installation Process', 'Installation', 'Open']) {
    assert.match(helperSource, new RegExp(`requiredOption: '${value}'`));
  }
  assert.doesNotMatch(helperSource, /return \[\{[^}]*\boptions\s*:/s);
});

test('accepts Stage only from a string or a non-accessor own display_value data property', () => {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(`${displayStageSource}\nglobalThis.displayStage = deployTeamPreviewDisplayStage;`, sandbox);
  assert.equal(sandbox.displayStage(' Start First Installation Process '), 'Start First Installation Process');
  const valid = vm.runInNewContext(`({ display_value: ' Start First Installation Process ', actual_value: 'Changed' })`, sandbox);
  const actualOnly = vm.runInNewContext(`({ actual_value: 'Start First Installation Process' })`, sandbox);
  const inherited = vm.runInNewContext(`Object.create({ display_value: 'Start First Installation Process' })`, sandbox);
  const accessor = vm.runInNewContext(`(() => { let reads = 0; const value = {}; Object.defineProperty(value, 'display_value', { enumerable: true, get() { reads += 1; return 'Start First Installation Process'; } }); return { value, reads: () => reads }; })()`, sandbox);
  const throwingProxy = vm.runInNewContext(`new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('blocked'); } })`, sandbox);
  assert.equal(sandbox.displayStage(valid), 'Start First Installation Process');
  assert.equal(sandbox.displayStage(actualOnly), '');
  assert.equal(sandbox.displayStage(inherited), '');
  assert.equal(sandbox.displayStage(accessor.value), '');
  assert.equal(accessor.reads(), 0);
  assert.equal(sandbox.displayStage(throwingProxy), '');
  assert.doesNotMatch(displayStageSource, /actual_value/);
});

test('reads relationship and direct-record identity and Stage through own data descriptors only', () => {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(`${displayStageSource}\n${adapterSource}\nglobalThis.relationship = deployTeamPreviewRelationship; globalThis.privateRows = deployTeamPreviewPrivateRows;`, sandbox);
  const valid = vm.runInNewContext(`({ data: [{ id: '1234567890123456789', Stage: { display_value: 'Start First Installation Process' } }], availability: 'available', pagination: { has_more: false, limit_applied: true, page: 1, per_page: 200, returned: 1 }, link_basis: 'Exact source lookup relation', link_fields: ['Opportunity_Name'], related_module: 'Deals' })`, sandbox);
  assert.equal(sandbox.relationship(valid).orders[0].stage, 'Start First Installation Process');
  assert.equal(sandbox.privateRows(valid)[0].recordId, '1234567890123456789');

  const inherited = vm.runInNewContext(`({ data: [Object.assign(Object.create({ id: '1234567890123456789', Stage: { display_value: 'Start First Installation Process' } }), {})] })`, sandbox);
  assert.equal(sandbox.relationship(inherited).orders[0].stage, '');
  assert.throws(() => sandbox.privateRows(inherited), /identity is invalid/i);

  const accessor = vm.runInNewContext(`(() => { let reads = 0; const row = { id: '1234567890123456789' }; Object.defineProperty(row, 'Stage', { enumerable: true, get() { reads += 1; return { display_value: 'Start First Installation Process' }; } }); return { relationship: { data: [row] }, reads: () => reads }; })()`, sandbox);
  assert.equal(sandbox.relationship(accessor.relationship).orders[0].stage, '');
  assert.equal(accessor.reads(), 0);

  const throwingProxy = vm.runInNewContext(`({ data: [new Proxy({}, { getPrototypeOf() { throw new Error('blocked'); }, get() { throw new Error('must not read'); } })] })`, sandbox);
  assert.equal(sandbox.relationship(throwingProxy).orders[0].stage, '');
  assert.throws(() => sandbox.privateRows(throwingProxy), /identity is invalid/i);
});

test('uses complete exact All_Orders evidence and keeps record IDs only in a private transient fingerprint', () => {
  assert.match(evidenceSource, /\/api\/related\/Contacts\/\$\{encodeURIComponent\(contactId\)\}\/All_Orders\?page=1&per_page=200/);
  assert.match(relationshipSource, /availability: relationship\?\.availability/);
  assert.match(relationshipSource, /hasMore: relationship\?\.pagination\?\.has_more/);
  assert.match(relationshipSource, /linkFields: Array\.isArray\(relationship\?\.link_fields\)/);
  const anonymousSection = relationshipSource.slice(0, relationshipSource.indexOf('function deployTeamPreviewPrivateRows'));
  assert.doesNotMatch(anonymousSection, /row\?\.(?:id|Deal_Name|Order_Number|Owner|Email|Phone|Mobile|Client_Name|Opportunity_Name|Product_Name|Address)\b/i);
  assert.match(relationshipSource, /const idMember = deployTeamPreviewOwnData\(row, 'id'\)/);
  assert.match(relationshipSource, /typeof idMember\.value === 'string'/);
  assert.match(relationshipSource, /seen\.has\(recordId\)/);
  assert.match(evidenceSource, /orderIdToOrdinal: privateOrders\.map\(order => \[order\.ordinal, order\.recordId\]\)/);
  assert.doesNotMatch(renderSource, /privateFingerprint\s*[),]|recordId|orderIdToOrdinal|contactId\s*\)|textContent\s*=\s*contactId/i);
});

test('directly re-attests every eligible Deal with a hard concurrency ceiling of four', () => {
  assert.match(relationshipSource, /return deployTeamPreviewMapLimit\(eligible, 4, async candidate =>/);
  assert.match(relationshipSource, /deployTeamPreviewGet\(`\/api\/record\/Deals\/\$\{encodeURIComponent\(candidate\.privateOrder\.recordId\)\}`\)/);
  assert.match(relationshipSource, /directStage !== candidate\.anonymousOrder\.stage/);
  assert.match(relationshipSource, /directStage !== eligibleStage/);
  assert.match(relationshipSource, /const workerCount = Math\.min\(maxConcurrency, rows\.length\)/);
  assert.match(evidenceSource, /eligibleAttestations = await deployTeamPreviewDirectAttestations/);
});

test('validates the exact linking lookups and installation Visit Blueprint entry effect', () => {
  assert.match(evidenceSource, /blueprint\?\.entry\?\.logic_supported !== true/);
  assert.match(evidenceSource, /criterion\?\.field !== expected\?\.entryField/);
  assert.match(evidenceSource, /criterion\?\.operator !== expected\?\.entryOperator/);
  assert.match(evidenceSource, /criterion\?\.value !== expected\?\.entryValue/);
  assert.match(evidenceSource, /transition\?\.from\?\.display_value !== expected\?\.fromDisplay/);
  assert.match(evidenceSource, /transition\?\.to\?\.actual_value !== expected\?\.toActual/);
  assert.match(evidenceSource, /deployTeamPreviewGet\('\/api\/meta\/fields\?module=Service_A_X_Orders'\)/);
  assert.match(evidenceSource, /deployTeamPreviewGet\('\/api\/meta\/blueprint_studio'\)/);
  assert.doesNotMatch(`${helperSource}\n${relationshipSource}\n${evidenceSource}\n${renderSource}`, /\/api\/blueprint\/Contacts\//);
});

test('surfaces the current Client_Address read-only conflict and unavailable guarantees', () => {
  assert.match(renderSource, /error\?\.code === 'CLIENT_ADDRESS_READ_ONLY_CONFLICT'/);
  assert.match(renderSource, /Client Address is read-only/);
  for (const text of [
    'Owner, permissions, workflow effects, server validation, and atomic creation',
    'labels and identities withheld',
    'No plan was generated and nothing was changed',
  ]) assert.match(renderSource, new RegExp(text));
});

test('re-reads all evidence before building one frozen ID-free display plan', () => {
  assert.match(renderSource, /const freshEvidence = await deployTeamPreviewReadEvidence\(contactId, preview\)/);
  assert.match(renderSource, /freshEvidence\.privateFingerprint !== reviewedEvidence\.privateFingerprint/);
  assert.match(renderSource, /freshEvidence\.anonymousFingerprint !== reviewedEvidence\.anonymousFingerprint/);
  assert.match(renderSource, /preview\.buildPlan\(\{/);
  assert.match(renderSource, /context: freshEvidence\.context/);
  assert.match(renderSource, /const selection = Object\.freeze\(\{/);
  assert.match(renderSource, /selection,\n\s*\}\);/);
  assert.ok(renderSource.indexOf('const selection = Object.freeze({') < renderSource.indexOf('const freshEvidence = await deployTeamPreviewReadEvidence'));
  assert.match(renderSource, /formControls\.forEach\(control => \{ control\.disabled = true; \}\)/);
  assert.match(renderSource, /formControls\.forEach\(control => \{ control\.disabled = false; \}\)/);
  assert.match(renderSource, /Frozen display-only deployment plan/);
  assert.match(renderSource, /plan\.visit\.managerOption/);
  assert.match(renderSource, /plan\.visit\.teamOptions\.join/);
  assert.match(renderSource, /plan\.unavailable\.join/);
  assert.doesNotMatch(renderSource, /plan\.(?:recordId|contactId|dealId|buttonId|widgetId|blueprintId|transitionId)/i);
});

test('announces loading, blockers, and plan results through atomic live regions', () => {
  assert.match(renderSource, /loading\.setAttribute\('role', 'status'\)/);
  assert.match(renderSource, /loading\.setAttribute\('aria-live', 'polite'\)/);
  assert.match(renderSource, /loading\.setAttribute\('aria-atomic', 'true'\)/);
  assert.match(renderSource, /result\.setAttribute\('aria-live', 'polite'\)/);
  assert.match(renderSource, /result\.setAttribute\('aria-atomic', 'true'\)/);
});

test('constructs all preview content with textContent and never parses dynamic markup', () => {
  assert.match(helperSource, /node\.textContent = String\(text\)/);
  assert.match(renderSource, /generate\.textContent = 'Rechecking current evidence…'/);
  assert.match(renderSource, /generate\.textContent = 'Generate display-only plan'/);
  assert.doesNotMatch(`${helperSource}\n${relationshipSource}\n${evidenceSource}\n${renderSource}\n${modalSource}`, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
});

test('uses an inert close-only modal with full focus cycling, Escape, and launcher restoration', () => {
  assert.match(modalSource, /const shell = \$\('#shell'\)/);
  assert.match(modalSource, /const shellWasInert = shell\?\.hasAttribute\('inert'\) === true/);
  assert.match(modalSource, /if \(shell\) shell\.setAttribute\('inert', ''\)/);
  assert.match(modalSource, /modal\.setAttribute\('role', 'dialog'\)/);
  assert.match(modalSource, /modal\.setAttribute\('aria-modal', 'true'\)/);
  assert.match(modalSource, /modal\.setAttribute\('aria-labelledby', titleId\)/);
  assert.match(modalSource, /close\.setAttribute\('aria-label', 'Close Deploy Team readiness preview'\)/);
  assert.match(modalSource, /const done = deployTeamPreviewNode\('button', null, 'Close preview'\)/);
  assert.match(modalSource, /if \(event\.key === 'Escape'/);
  assert.match(modalSource, /if \(event\.key === 'Tab'/);
  assert.match(modalSource, /event\.shiftKey \? focusable\.length - 1 : 0/);
  assert.match(modalSource, /\(activeIndex \+ \(event\.shiftKey \? -1 : 1\) \+ focusable\.length\) % focusable\.length/);
  assert.match(modalSource, /document\.removeEventListener\('keydown', keyHandler\)/);
  assert.match(modalSource, /if \(shell && !shellWasInert\) shell\.removeAttribute\('inert'\)/);
  assert.match(modalSource, /document\.contains\(restoreFocus\)\) restoreFocus\.focus\(\)/);
  assert.match(modalSource, /close\.focus\(\)/);
  assert.doesNotMatch(modalSource, /Save|Submit|Apply|Continue|Proceed|Confirm/);
});

test('keeps the preview UI GET-only and free of outbound, SDK, storage, file, and logging paths', () => {
  const source = `${helperSource}\n${relationshipSource}\n${evidenceSource}\n${renderSource}\n${modalSource}`;
  for (const pattern of [
    /https?:\/\//i,
    /\bfetch\b|XMLHttpRequest|WebSocket|EventSource|sendBeacon/i,
    /\b(?:ZOHO|ZDK)\b/i,
    /\.(?:insertRecord|updateRecord|deleteRecord|addNotes?|attachFile|uploadFile|proceed)\s*\(/i,
    /method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i,
    /\/api\/(?:workflows?|integrations?|notes?|attachments?|files?)/i,
    /\b(?:localStorage|sessionStorage|indexedDB|clipboard)\b/i,
    /\b(?:FormData|FileReader|Blob)\b|\.type\s*=\s*['"]file['"]/i,
    /\bconsole\s*\.|setTimeout|setInterval/i,
    /\bgetCurrentUser\b|\/api\/users|\/api\/org|resolveIdentity/i,
  ]) assert.doesNotMatch(source, pattern);
  assert.match(helperSource, /return api\(path, \{ method: 'GET', cache: 'no-store' \}\)/);
});

test('adds the exact record action without enabling other blocked Contacts widgets', () => {
  assert.match(actionSource, /const deployTeamPreviewEnabled = isDeployTeamReadinessPreviewButton/);
  assert.match(actionSource, /Deploy Team · Readiness/);
  assert.match(actionSource, /Open Deploy Team GET-only readiness preview/);
  assert.match(actionSource, /openDeployTeamReadinessPreview\(mod, id, rec, button, layoutExact, resolvedId, sourceButton\)/);
  assert.match(actionSource, /sourceButton\.disabled = !previewEnabled/);
});

test('loads the engine before app startup, includes syntax checks, and uses isolated responsive styling', () => {
  const engineIndex = indexSource.indexOf('<script src="/deploy-team-readiness-preview.js"></script>');
  const appIndex = indexSource.indexOf('<script src="/app.js"></script>');
  assert.ok(engineIndex >= 0 && appIndex > engineIndex);
  assert.match(packageJson.scripts.precheck, /node --check public\/deploy-team-readiness-preview\.js/);
  assert.match(packageJson.scripts.check, /node --check public\/deploy-team-readiness-preview\.js/);
  assert.match(previewStyles, /\.deploy-team-preview-form \{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(previewStyles, /\.deploy-team-preview-field input:focus,\.deploy-team-preview-field select:focus/);
  assert.match(previewStyles, /\.deploy-team-preview-action:focus-visible/);
  assert.match(previewStyles, /@media \(max-width:600px\)/);
  assert.match(previewStyles, /\.deploy-team-preview-form \{ grid-template-columns:1fr; \}/);
  assert.match(previewStyles, /@media \(max-width:390px\)/);
  assert.doesNotMatch(previewStyles, /(^|[},\s])(?:body|html|\.modal|\.mh|\.mb|\.mf)(?:\s|,|\{)/m);
});
