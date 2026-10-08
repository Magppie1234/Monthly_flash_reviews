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
const handoverPreview = require('../public/handover-post-team-preview');

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
  'function handoverPostTeamPreviewLayoutId(record) {',
  'function handoverPostTeamPreviewOptionValues(field) {',
  7000,
);
const displayStageSource = boundedSlice(
  appSource,
  'function handoverPostTeamPreviewDisplayStage(value) {',
  'function handoverPostTeamPreviewLayoutId(record) {',
  2500,
);
const metadataSource = boundedSlice(
  appSource,
  'function handoverPostTeamPreviewOptionValues(field) {',
  'function handoverPostTeamPreviewRelationship(response) {',
  8000,
);
const relationshipSource = boundedSlice(
  appSource,
  'function handoverPostTeamPreviewRelationship(response) {',
  'function handoverPostTeamPreviewDuringInputs(inputs) {',
  4500,
);
const blueprintSource = boundedSlice(
  appSource,
  'function handoverPostTeamPreviewDuringInputs(inputs) {',
  'function handoverPostTeamPreviewAmsBlueprintCatalog(catalog, preview) {',
  18000,
);
const amsAndEvidenceSource = boundedSlice(
  appSource,
  'function handoverPostTeamPreviewAmsBlueprintCatalog(catalog, preview) {',
  'function handoverPostTeamPreviewDefinitionList(container, rows, className =',
  16000,
);
const amsAdapterSource = boundedSlice(
  appSource,
  'function handoverPostTeamPreviewAmsBlueprintCatalog(catalog, preview) {',
  'async function handoverPostTeamPreviewReadEvidence(contactId, preview) {',
  8000,
);
const planRenderSource = boundedSlice(
  appSource,
  'function handoverPostTeamPreviewRenderPlan(result, plan) {',
  'function renderHandoverPostTeamPreview(container, contactId) {',
  18000,
);
const renderSource = boundedSlice(
  appSource,
  'function renderHandoverPostTeamPreview(container, contactId) {',
  'let activeHandoverPostTeamPreviewClose = null;',
  18000,
);
const modalSource = boundedSlice(
  appSource,
  'function openHandoverPostTeamPreview(mod, contactId, record, blueprint, transition, input, restoreFocus = document.activeElement) {',
  '/* Handover To Post Team GET-only preview end */',
  10000,
);
const actionSource = boundedSlice(
  appSource,
  '// Source-defined local Blueprint transitions.',
  'automatic.forEach(t => {',
  10000,
);
const previewStyles = boundedSlice(
  styles,
  '/* Handover To Post Team GET-only preview */',
  '/* ---------- CRM Journey Home ---------- */',
  18000,
);

test('binds only the exact Contacts Standard-layout Final Handover parent widget tuple', () => {
  for (const pattern of [
    /mod === 'Contacts'/,
    /handoverPostTeamPreviewLayoutId\(record\) === '1032257000000000171'/,
    /handoverPostTeamPreviewDisplayStage\(record\?\.Stage\) === 'Second Installation Done'/,
    /String\(blueprint\?\.blueprint_id \|\| ''\) === '1032257000001044611'/,
    /blueprint\?\.blueprint === 'Opportunity Stage'/,
    /blueprint\?\.state_field === 'Stage'/,
    /handoverPostTeamPreviewDisplayStage\(blueprint\?\.current\) === 'Second Installation Done'/,
    /blueprint\?\.local === true/,
    /String\(transition\?\.id \|\| ''\) === '1032257000023182424'/,
    /transition\?\.name === 'Final Handover'/,
    /transition\?\.next_value === 'Final Handover'/,
    /transition\?\.next_actual_value === 'Final Handover'/,
    /transition\?\.common === false/,
    /transition\?\.trigger_type === 'manual'/,
    /transition\?\.executable === false/,
    /owners\.length === 1 && owners\[0\] === 'Record Owner'/,
    /criteria\.length === 0/,
    /transition\.during_inputs\.length === 1/,
    /transition\.during_inputs\[0\] === input/,
    /transition\.after_actions\.length === 0/,
    /input\?\.kind === 'widget'/,
    /input\?\.api_name === null/,
    /input\?\.label === 'Handover To Post Team'/,
    /input\?\.data_type === 'widget'/,
    /input\?\.required === false/,
    /input\?\.sequence === 1/,
    /input\?\.widget_id == null/,
    /input\?\.name == null/,
    /typeof preview\?\.createEvidence === 'function'/,
    /typeof preview\?\.compareEvidence === 'function'/,
    /typeof preview\?\.buildPlan === 'function'/,
    /typeof preview\?\.mapLimit === 'function'/,
  ]) assert.match(predicateSource, pattern);
});

test('accepts Stage only from a string or non-accessor own display_value data property', () => {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(`${displayStageSource}\nglobalThis.displayStage = handoverPostTeamPreviewDisplayStage;`, sandbox);
  assert.equal(sandbox.displayStage(' Second Installation Done '), 'Second Installation Done');
  assert.equal(sandbox.displayStage({ display_value: ' Second Installation Done ', actual_value: 'Final Handover' }), 'Second Installation Done');
  assert.equal(sandbox.displayStage({ actual_value: 'Second Installation Done' }), '');
  assert.equal(sandbox.displayStage({ display_value: '  ', actual_value: 'Second Installation Done' }), '');
  assert.equal(sandbox.displayStage(Object.create({ display_value: 'Second Installation Done' })), '');
  let reads = 0;
  const accessor = {};
  Object.defineProperty(accessor, 'display_value', {
    enumerable: true,
    get() {
      reads += 1;
      return 'Second Installation Done';
    },
  });
  assert.equal(sandbox.displayStage(accessor), '');
  assert.equal(reads, 0);
  assert.equal(sandbox.displayStage(new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('blocked'); } })), '');
  assert.doesNotMatch(displayStageSource, /actual_value/);
});

test('reduces current metadata and layouts to the exact engine-owned schemas without identity values', () => {
  assert.match(metadataSource, /Object\.entries\(schemas\)\.map/);
  assert.match(metadataSource, /field\?\.api_name === apiName && field\?\.data_type === schema\.dataType/);
  assert.match(metadataSource, /matches\.length !== 1/);
  assert.match(metadataSource, /schema\.dataType === 'picklist' \? handoverPostTeamPreviewOptionValues\(field\) : \[\]/);
  assert.match(metadataSource, /readOnly: field\.field_read_only === true/);
  assert.match(metadataSource, /relatedModule: field\?\.lookup\?\.module\?\.api_name \|\| null/);
  assert.match(metadataSource, /systemMandatory: field\.system_mandatory === true/);
  assert.match(metadataSource, /option\?\.type !== 'unused'/);
  assert.match(metadataSource, /value && value !== '-None-'/);
  assert.match(metadataSource, /status: layout\?\.status/);
  assert.match(metadataSource, /visible: layout\?\.visible/);
  assert.doesNotMatch(metadataSource, /field_label|display_label|Owner\.name|Email|Phone|Mobile|Address/i);
});

test('requires the direct authoritative parent record layout resolution and preserves display Stage for engine validation', () => {
  assert.match(metadataSource, /resolution\?\.exact !== true/);
  assert.match(metadataSource, /resolution\?\.source !== 'record'/);
  assert.match(metadataSource, /resolution\?\.reason !== null/);
  assert.match(metadataSource, /String\(resolution\?\.layout_id \|\| ''\) !== expected\?\.layoutId/);
  assert.match(metadataSource, /layoutId: handoverPostTeamPreviewLayoutId\(record\)/);
  assert.match(metadataSource, /stage: record\?\.Stage/);
  assert.match(metadataSource, /requestedId: String\(contactId \|\| ''\)/);
  assert.doesNotMatch(metadataSource, /records\s*\[\s*0\s*\]|layouts\s*\[\s*0\s*\]/);
});

test('adapts only the complete exact All_Orders envelope and keeps relationship identities out of render paths', () => {
  for (const pattern of [
    /availability: response\?\.availability/,
    /hasMore: response\?\.pagination\?\.has_more/,
    /limitApplied: response\?\.pagination\?\.limit_applied/,
    /linkBasis: response\?\.link_basis/,
    /linkFields: Array\.isArray\(response\?\.link_fields\)/,
    /id: String\(row\?\.id \|\| ''\)/,
    /ordinal: index \+ 1/,
    /stage: row\?\.Stage/,
    /page: response\?\.pagination\?\.page/,
    /perPage: response\?\.pagination\?\.per_page/,
    /relatedModule: response\?\.related_module/,
    /returned: response\?\.pagination\?\.returned/,
  ]) assert.match(relationshipSource, pattern);
  assert.doesNotMatch(relationshipSource, /row\?\.(?:Deal_Name|Order_Number|Owner|Email|Phone|Mobile|Client_Name|Opportunity_Name|Product_Name|Address)\b/i);
  assert.doesNotMatch(`${planRenderSource}\n${renderSource}`, /\.privateFingerprint|\.anonymousFingerprint|requestedId|recordId|order\.id|textContent\s*=\s*contactId|handoverPostTeamPreviewNode\([^;\n]*contactId/i);
});

test('reconciles parent and child runtime Blueprint evidence against the exact Studio graph and phase signatures', () => {
  for (const pattern of [
    /matches\.length !== 1/,
    /transitions\.length !== 1/,
    /runtimeMatches\.length !== 1/,
    /studio\.blueprint\?\.name !== contract\?\.blueprintName/,
    /studio\.blueprint\?\.state_field !== contract\?\.stateField/,
    /runtime\?\.blueprint !== studio\.blueprint\?\.name/,
    /runtime\?\.state_field !== studio\.blueprint\?\.state_field/,
    /studio\.transition\?\.name !== contract\?\.transitionName/,
    /transition\?\.name !== studio\.transition\?\.name/,
    /JSON\.stringify\(runtimeDuring\) !== JSON\.stringify\(studioDuring\)/,
    /studio\.transition\?\.during\?\.input_count !== runtimeDuring\.length/,
    /studio\.transition\?\.after\?\.action_count !== runtimeAfter\.length/,
    /action\?\.details_available !== true/,
    /JSON\.stringify\(owners\) !== JSON\.stringify\(studioOwners\)/,
    /studio\.transition\?\.from\?\.display_value !== contract\?\.currentDisplay/,
    /studio\.transition\?\.from\?\.actual_value !== contract\?\.currentActual/,
    /studio\.transition\?\.to\?\.display_value !== transition\?\.next_value/,
    /studio\.transition\?\.to\?\.actual_value !== transition\?\.next_actual_value/,
    /ownerDetails\.length !== 1/,
    /ownerDetails\[0\]\?\.type !== 'record_owner'/,
    /ownerDetails\[0\]\?\.resource_count !== 0/,
    /fieldApiName: action\?\.details\?\.field_api_name/,
    /fieldLabel: action\?\.details\?\.field_label/,
    /value: action\?\.details\?\.value/,
    /localExecution: studio\.transition\?\.execution\?\.status/,
  ]) assert.match(blueprintSource, pattern);
  assert.doesNotMatch(blueprintSource, /owner_details\[[^\]]+\]\.(?:id|name)|specific_resource|profile/i);
});

test('uses exact direct Deal tuple and authoritative single-active-layout resolution for every eligible child', () => {
  assert.match(blueprintSource, /candidateCount: resolution\?\.candidate_count/);
  assert.match(blueprintSource, /exact: resolution\?\.exact/);
  assert.match(blueprintSource, /layoutId: String\(resolution\?\.layout_id \|\| ''\)/);
  assert.match(blueprintSource, /reason: resolution\?\.reason/);
  assert.match(blueprintSource, /source: resolution\?\.source/);
  assert.match(blueprintSource, /records: rows\.map\(record => \(\{/);
  assert.match(blueprintSource, /id: String\(record\?\.id \|\| ''\)/);
  assert.match(blueprintSource, /stage: record\?\.Stage/);
  assert.doesNotMatch(blueprintSource, /record\?\.Layout|record\?\.\$layout_id|record\?\.(?:Deal_Name|Owner|Contact_Name|Product_Name)/i);
});

test('performs every base and per-eligible evidence read as uncached local GETs on open and again on Generate', () => {
  for (const pattern of [
    /handoverPostTeamPreviewGet\(`\/api\/record\/Contacts\/\$\{encodeURIComponent\(contactId\)\}`\)/,
    /handoverPostTeamPreviewGet\('\/api\/meta\/layouts\?module=Contacts'\)/,
    /handoverPostTeamPreviewGet\('\/api\/meta\/fields\?module=Contacts'\)/,
    /handoverPostTeamPreviewGet\('\/api\/meta\/layouts\?module=Deals'\)/,
    /handoverPostTeamPreviewGet\('\/api\/meta\/fields\?module=Deals'\)/,
    /handoverPostTeamPreviewGet\('\/api\/meta\/layouts\?module=AMS_Complaints'\)/,
    /handoverPostTeamPreviewGet\('\/api\/meta\/fields\?module=AMS_Complaints'\)/,
    /handoverPostTeamPreviewGet\(`\/api\/related\/Contacts\/\$\{encodeURIComponent\(contactId\)\}\/All_Orders\?page=1&per_page=200`\)/,
    /handoverPostTeamPreviewGet\(`\/api\/blueprint\/Contacts\/\$\{encodeURIComponent\(contactId\)\}`\)/,
    /handoverPostTeamPreviewGet\('\/api\/meta\/blueprint_studio'\)/,
    /handoverPostTeamPreviewGet\(`\/api\/record\/Deals\/\$\{encodeURIComponent\(order\.id\)\}`\)/,
    /handoverPostTeamPreviewGet\(`\/api\/blueprint\/Deals\/\$\{encodeURIComponent\(order\.id\)\}`\)/,
  ]) assert.match(amsAndEvidenceSource, pattern);
  assert.match(amsAndEvidenceSource, /preview\.mapLimit\(eligibleOrders, 4, async order =>/);
  assert.match(amsAndEvidenceSource, /const recordResponse = await handoverPostTeamPreviewGet\(`\/api\/record\/Deals\/\$\{encodeURIComponent\(order\.id\)\}`\)/);
  assert.match(amsAndEvidenceSource, /const blueprintResponse = await handoverPostTeamPreviewGet\(`\/api\/blueprint\/Deals\/\$\{encodeURIComponent\(order\.id\)\}`\)/);
  const candidateMapper = boundedSlice(
    amsAndEvidenceSource,
    'const directOrders = await preview.mapLimit(eligibleOrders, 4, async order => {',
    'return preview.createEvidence({',
    5000,
  );
  assert.doesNotMatch(candidateMapper, /Promise\.all/);
  assert.equal((renderSource.match(/handoverPostTeamPreviewReadEvidence\(contactId, preview\)/g) || []).length, 2);
  assert.match(renderSource, /preview\.compareEvidence\(\{ fresh: freshEvidence, reviewed: reviewedEvidence \}\)/);
  assert.match(renderSource, /if \(!comparison\.match\)/);
  assert.match(renderSource, /preview\.buildPlan\(\{ context: freshEvidence\.context \}\)/);
  assert.match(appSource, /return api\(path, \{ method: 'GET', cache: 'no-store' \}\)/);
});

test('attests both exact active AMS Blueprints and every transition target while preserving the zero-Planned blocker', () => {
  assert.match(amsAndEvidenceSource, /const blueprints = Array\.isArray\(catalog\?\.blueprints\) \? catalog\.blueprints : \[\]/);
  assert.match(amsAndEvidenceSource, /blueprint\?\.module === expected\?\.module/);
  assert.match(amsAndEvidenceSource, /blueprint\?\.status === expected\?\.status/);
  assert.match(amsAndEvidenceSource, /String\(blueprint\?\.layout\?\.id \|\| ''\) === expected\?\.layoutId/);
  assert.match(amsAndEvidenceSource, /activeRelevantIds\.length !== expectedIds\.length/);
  assert.match(amsAndEvidenceSource, /activeRelevantIds\.some\(\(id, index\) => id !== expectedIds\[index\]\)/);
  assert.match(amsAndEvidenceSource, /expected\?\.blueprints/);
  assert.match(amsAndEvidenceSource, /String\(blueprint\?\.id \|\| ''\) === contract\.blueprintId/);
  assert.match(amsAndEvidenceSource, /active: blueprint\?\.status === 'Active'/);
  assert.match(amsAndEvidenceSource, /toActual: transition\?\.to\?\.actual_value/);
  assert.match(amsAndEvidenceSource, /toDisplay: transition\?\.to\?\.display_value/);
  assert.match(renderSource, /two active reviewed Blueprints · zero active transition to Planned/);
  assert.match(planRenderSource, /Zero active reviewed AMS transition targets Planned/);
  assert.match(planRenderSource, /plan\.ams_plan\.creation/);
  assert.match(planRenderSource, /plan\.ams_plan\.blueprint_enrollment/);
});

test('fails closed when the current Standard-layout AMS module has an unaudited active Blueprint', () => {
  const sandbox = {};
  vm.runInNewContext(`${amsAdapterSource}\nglobalThis.adaptAms = handoverPostTeamPreviewAmsBlueprintCatalog;`, sandbox);
  const expected = handoverPreview.constants.amsContract;
  const catalog = {
    blueprints: expected.blueprints.map(contract => ({
      id: contract.blueprintId,
      layout: { id: expected.layoutId, name: expected.layoutName },
      module: expected.module,
      name: contract.blueprintName,
      state_field: expected.stateField,
      status: expected.status,
      transitions: Array.from({ length: contract.transitionCount }, (_, index) => ({
        to: { actual_value: `State ${index + 1}`, display_value: `State ${index + 1}` },
      })),
    })),
  };
  assert.equal(sandbox.adaptAms(catalog, handoverPreview).blueprints.length, 2);

  catalog.blueprints.push({
    id: '1032257000099999999',
    layout: { id: expected.layoutId, name: expected.layoutName },
    module: expected.module,
    name: 'Unaudited active AMS flow',
    state_field: expected.stateField,
    status: expected.status,
    transitions: [],
  });
  assert.throws(
    () => sandbox.adaptAms(catalog, handoverPreview),
    /active AMS Blueprint set is invalid/,
  );
});

test('renders only anonymous ordinals, required categories, observed effects, and explicit disabled boundaries', () => {
  for (const text of [
    'Handover File checklist',
    'Handover Certificate',
    'MDR Done date',
    'Internal QC integer',
    'First Service Date on execution day · disabled',
    'User identity, Record Owner match, permissions, file transfer, server write validation, workflow effects, and transaction rollback',
    'Nothing was persisted',
  ]) assert.match(`${planRenderSource}\n${renderSource}`, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(planRenderSource, /order\.order_label/);
  assert.match(planRenderSource, /order\.source_stage/);
  assert.match(planRenderSource, /order\.required_inputs\.map/);
  assert.match(planRenderSource, /plan\.blocked_orders\.map/);
  assert.match(planRenderSource, /plan\.blocked_actions/);
  assert.match(renderSource, /It cannot transfer a file, update a Deal, create AMS data, continue a Blueprint, trigger a workflow/);
  assert.doesNotMatch(`${planRenderSource}\n${renderSource}`, /(?:Client_Name|Client_Mobile|Order_Ids|Order_Names|Deal_Name|Contact_Name|Full_Name|Email|Phone|Mobile|Address|Owner\.name|\.id\b|\b\d{19}\b)/i);
});

test('constructs every Handover UI node with textContent and never parses dynamic markup', () => {
  const completePreviewSource = boundedSlice(
    appSource,
    '/* Handover To Post Team GET-only preview start */',
    '/* Handover To Post Team GET-only preview end */',
    35000,
  );
  assert.match(completePreviewSource, /node\.textContent = String\(text\)/);
  assert.match(renderSource, /generate\.textContent = 'Rechecking every evidence source…'/);
  assert.match(renderSource, /generate\.textContent = 'Generate display-only plan'/);
  assert.doesNotMatch(completePreviewSource, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
});

test('announces asynchronous evidence and generated-plan changes through atomic polite live regions', () => {
  assert.match(renderSource, /loading\.setAttribute\('role', 'status'\)/);
  assert.match(renderSource, /loading\.setAttribute\('aria-live', 'polite'\)/);
  assert.match(renderSource, /loading\.setAttribute\('aria-atomic', 'true'\)/);
  assert.match(renderSource, /result\.setAttribute\('aria-live', 'polite'\)/);
  assert.match(renderSource, /result\.setAttribute\('aria-atomic', 'true'\)/);
  assert.match(renderSource, /result\.setAttribute\('aria-busy', 'true'\)/);
  assert.match(renderSource, /result\.removeAttribute\('aria-busy'\)/);
});

test('uses an inert close-only dialog with focus wrap, Escape, and launcher restoration', () => {
  for (const pattern of [
    /const shell = \$\('#shell'\)/,
    /const shellWasInert = shell\?\.hasAttribute\('inert'\) === true/,
    /if \(shell\) shell\.setAttribute\('inert', ''\)/,
    /modal\.setAttribute\('role', 'dialog'\)/,
    /modal\.setAttribute\('aria-modal', 'true'\)/,
    /modal\.setAttribute\('aria-labelledby', titleId\)/,
    /close\.setAttribute\('aria-label', 'Close Handover To Post Team preview'\)/,
    /const done = handoverPostTeamPreviewNode\('button', null, 'Close preview'\)/,
    /if \(event\.key === 'Escape'/,
    /if \(event\.key === 'Tab'/,
    /event\.shiftKey \? focusable\.length - 1 : 0/,
    /\(activeIndex \+ \(event\.shiftKey \? -1 : 1\) \+ focusable\.length\) % focusable\.length/,
    /document\.removeEventListener\('keydown', keyHandler\)/,
    /if \(shell && !shellWasInert\) shell\.removeAttribute\('inert'\)/,
    /document\.contains\(restoreFocus\)\) restoreFocus\.focus\(\)/,
    /close\.focus\(\)/,
  ]) assert.match(modalSource, pattern);
  assert.doesNotMatch(modalSource, /Save|Submit|Apply|Continue|Proceed|Confirm|Upload/);
});

test('keeps the integration free of writes, outbound providers, SDKs, storage, files, logs, and timers', () => {
  const completePreviewSource = boundedSlice(
    appSource,
    '/* Handover To Post Team GET-only preview start */',
    '/* Handover To Post Team GET-only preview end */',
    35000,
  );
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
  ]) assert.doesNotMatch(completePreviewSource, pattern);
});

test('adds one separate preview action after the blocked parent transition action', () => {
  assert.match(actionSource, /const handoverInput = \(t\.during_inputs \|\| \[\]\)\.find\(input => isHandoverPostTeamPreviewInput\(mod, rec, bp, t, input\)\)/);
  assert.match(actionSource, /el\('button', 'source-action preview-action handover-post-team-preview-action', 'Handover To Post Team · Preview'\)/);
  assert.match(actionSource, /handoverButton\.type = 'button'/);
  assert.match(actionSource, /handoverButton\.setAttribute\('aria-label', 'Open Handover To Post Team GET-only preview'\)/);
  assert.match(actionSource, /openHandoverPostTeamPreview\(mod, id, rec, bp, t, handoverInput, handoverButton\)/);
  const blockedTransitionAppend = actionSource.indexOf('bpRow.appendChild(btn);');
  const previewCreation = actionSource.indexOf("const handoverButton = el('button'");
  assert.ok(blockedTransitionAppend >= 0 && previewCreation > blockedTransitionAppend);
});

test('loads the pure engine before app startup, syntax-checks it, and uses isolated responsive styles', () => {
  const deployIndex = indexSource.indexOf('<script src="/deploy-team-readiness-preview.js"></script>');
  const engineIndex = indexSource.indexOf('<script src="/handover-post-team-preview.js"></script>');
  const appIndex = indexSource.indexOf('<script src="/app.js"></script>');
  assert.ok(deployIndex >= 0 && engineIndex > deployIndex && appIndex > engineIndex);
  assert.match(packageJson.scripts.precheck, /node --check public\/handover-post-team-preview\.js/);
  assert.match(packageJson.scripts.check, /node --check public\/handover-post-team-preview\.js/);
  assert.match(previewStyles, /\.handover-post-team-preview-basis,[\s\S]*grid-template-columns:minmax\(180px,\.7fr\) minmax\(0,1fr\)/);
  assert.match(previewStyles, /\.handover-post-team-preview-action:focus-visible/);
  assert.match(previewStyles, /@media \(max-width:600px\)/);
  assert.match(previewStyles, /grid-template-columns:1fr/);
  assert.match(previewStyles, /@media \(max-width:390px\)/);
  assert.doesNotMatch(previewStyles, /(^|[},\s])(?:body|html|\.modal|\.mh|\.mb|\.mf)(?:\s|,|\{)/m);
});
