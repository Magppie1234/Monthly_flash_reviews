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
  'function closureNewPreviewLayoutId(record) {',
  'function closureNewPreviewFieldMetadata(fields, fieldTypes) {',
  7500,
);
const displayStageSource = boundedSlice(
  appSource,
  'function closureNewPreviewDisplayStage(value) {',
  'function closureNewPreviewNumber(value) {',
  3000,
);
const metadataSource = boundedSlice(
  appSource,
  'function closureNewPreviewFieldMetadata(fields, fieldTypes) {',
  'function closureNewPreviewOrdersRelationship(relationship) {',
  5000,
);
const orderSnapshotSource = boundedSlice(
  appSource,
  'function closureNewPreviewOrdersRelationship(relationship) {',
  'function closureNewPreviewMilestonesRelationship(relationship) {',
  2500,
);
const milestoneSnapshotSource = boundedSlice(
  appSource,
  'function closureNewPreviewMilestonesRelationship(relationship) {',
  'function closureNewPreviewPrivateRows(relationship) {',
  3000,
);
const evidenceSource = boundedSlice(
  appSource,
  'function closureNewPreviewPrivateRows(relationship) {',
  'function renderClosureNewPreview(container, contactId, idPrefix) {',
  19000,
);
const dealRecordEvidenceSource = boundedSlice(
  appSource,
  'function closureNewPreviewDealRecordEvidence(recordResponse, privateOrder, anonymousOrder, dealLayout, preview) {',
  'function closureNewPreviewChildAttestation(blueprint, privateOrder, preview) {',
  6000,
);
const renderSource = boundedSlice(
  appSource,
  'function renderClosureNewPreview(container, contactId, idPrefix) {',
  'let activeClosureNewPreviewClose = null;',
  30000,
);
const modalSource = boundedSlice(
  appSource,
  'function openClosureNewPreview(mod, contactId, record, blueprint, transition, input, restoreFocus = document.activeElement) {',
  '/* Closure New local-only preview end */',
  6000,
);
const recordActionSource = boundedSlice(
  appSource,
  '// Source-defined local Blueprint transitions.',
  'automatic.forEach(t => {',
  7000,
);
const closureStyles = boundedSlice(
  styles,
  '/* Closure New local-only preview */',
  '/* Deploy Team GET-only readiness preview */',
  11000,
);
const scriptOrderSource = boundedSlice(
  indexSource,
  '<script src="/estimate-widget-preview.js"></script>',
  '</body>',
  1000,
);

const parentBlueprint = blueprintConfig.blueprints.find(item => String(item.id) === '1032257000001044611');
const parentTransition = parentBlueprint?.transitions.find(item => String(item.id) === '1032257000025407204');
const parentDetail = transitionDetails.blueprints['1032257000001044611']?.transitions['1032257000025407204'];
const childBlueprint = blueprintConfig.blueprints.find(item => String(item.id) === '1032257000000535747');
const commonChildTransition = childBlueprint?.transitions.find(item => String(item.id) === '1032257000000535729');
const commonChildDetail = transitionDetails.blueprints['1032257000000535747']?.transitions['1032257000000535729'];
const sunrooofChildTransition = childBlueprint?.transitions.find(item => String(item.id) === '1032257000021717028');
const sunrooofChildDetail = transitionDetails.blueprints['1032257000000535747']?.transitions['1032257000021717028'];

test('retains the exact Contacts parent registration and enriched Closure New widget phase', () => {
  assert.equal(parentBlueprint?.name, 'Opportunity Stage');
  assert.equal(parentBlueprint?.module, 'Contacts');
  assert.equal(parentBlueprint?.state_field, 'Stage');
  assert.deepEqual(parentBlueprint?.layout, {
    id: '1032257000000000171',
    name: 'Standard',
    api_name: 'Standard__s',
  });
  assert.deepEqual(parentTransition?.from, {
    id: '1032257000001044583',
    display_value: 'Principally Closed',
    actual_value: 'Payment Awaited',
  });
  assert.deepEqual(parentTransition?.to, {
    id: '1032257000001044587',
    display_value: 'Closure',
    actual_value: 'Principally Closure',
  });
  assert.equal(parentTransition?.global, false);
  assert.equal(parentDetail?.name, 'Closure New - Pinki');
  assert.equal(parentDetail?.common, false);
  assert.equal(parentDetail?.trigger_type, 'manual');
  assert.deepEqual(parentDetail?.before, { owners: ['Specific Users (1)'], criteria: [] });
  assert.deepEqual(parentDetail?.during_inputs, [{
    kind: 'widget',
    api_name: null,
    widget_id: '1032257000025407208',
    name: 'Closure New - Pinki',
    label: 'Closure New - Pinki',
    data_type: 'widget',
    required: false,
    sequence: 1,
    definition_status: 'Captured package validated; original constrained read-only closure-plan preview implemented',
  }]);
  assert.deepEqual(parentDetail?.after_actions, []);
  assert.equal(parentDetail?.local_execution, 'Blocked');
  assert.match(parentDetail?.block_reason || '', /Specific-user identity.*milestone record updates.*workflow triggering.*child Blueprint.*SUNROOOF.*custom action.*parent Blueprint continuation/i);
});

test('freezes the exact common child Closure path and proves the SUNROOOF path is unsupported', () => {
  assert.equal(childBlueprint?.name, 'Order Stages');
  assert.equal(childBlueprint?.module, 'Deals');
  assert.equal(childBlueprint?.state_field, 'Stage');
  assert.deepEqual(childBlueprint?.layout, {
    id: '1032257000000000173',
    name: 'Standard',
    api_name: 'Standard__s',
  });
  assert.deepEqual(commonChildTransition?.from, {
    id: '1032257000000535672',
    display_value: 'Payment Awaited',
    actual_value: 'Payment Awaited',
  });
  assert.deepEqual(commonChildTransition?.to, {
    id: '1032257000000535675',
    display_value: 'Closure',
    actual_value: 'Closure',
  });
  assert.equal(commonChildDetail?.name, 'Closure');
  assert.equal(commonChildDetail?.common, true);
  assert.deepEqual(commonChildDetail?.before?.owners, ['Specific Users (1)']);
  assert.deepEqual(commonChildDetail?.before?.criteria, []);
  assert.deepEqual(commonChildDetail?.during_inputs, [{
    kind: 'field',
    api_name: 'Est_Handover_Date',
    label: 'Est. Handover Date',
    data_type: 'date',
    required: true,
    sequence: 1,
  }]);
  assert.deepEqual(commonChildDetail?.after_actions, []);
  assert.equal(sunrooofChildTransition?.name, 'Closure Sunrooof');
  assert.equal(sunrooofChildDetail?.common, false);
  assert.equal(sunrooofChildDetail?.before?.criteria_logic_supported, false);
  assert.equal(sunrooofChildDetail?.before?.criteria_display, 'Product Type is SUNROOOF');
  assert.deepEqual(sunrooofChildDetail?.after_actions?.map(action => [action.id, action.type, action.name]), [[
    '1032257000021717034',
    'custom_action',
    'Sync Magppie To Sunrooof',
  ]]);
  assert.equal(sunrooofChildDetail?.local_execution, 'Blocked');
});

test('marks Closure New preview implemented while full runtime remains blocked', () => {
  const runtime = runtimeCompatibility.widgets.find(item => item.id === '1032257000025407208');
  assert.equal(runtime?.name, 'Closure New - Pinki');
  assert.equal(runtime?.preview_classification, 'fixture-preview-candidate');
  assert.equal(runtime?.preview_runtime_status, 'implemented-read-only');
  assert.equal(runtime?.full_runtime_status, 'blocked');
  assert.deepEqual(runtime?.modules_read, ['Contacts', 'Deals', 'Payment_Milestones']);
  assert.deepEqual(runtime?.modules_written, ['Deals', 'Payment_Milestones']);
  assert.match(runtime?.preview_rationale || '', /GET-only local closure-plan preview/i);
  assert.match(runtime?.preview_rationale || '', /SUNROOOF.*writes.*workflows.*child and parent Blueprint continuation.*identity.*storage.*logging.*provider access remain disabled/i);
  assert.equal(runtimeCompatibility.summary.implemented_local_previews, runtimeCompatibility.widgets.filter(item => item.preview_runtime_status === 'implemented-read-only').length);
  assert.equal(runtimeCompatibility.summary.local_preview_candidates, runtimeCompatibility.widgets.filter(item => item.preview_runtime_status === 'candidate').length);
  assert.equal(runtimeCompatibility.summary.quarantined_packages, runtimeCompatibility.widgets.filter(item => item.preview_runtime_status === 'quarantined').length);
  assert.equal(runtimeCompatibility.summary.quarantined_pending_sensitive_review, runtimeCompatibility.widgets.filter(item => item.preview_classification === 'quarantined-pending-review').length);
  assert.equal(runtimeCompatibility.summary.quarantined_review_complete_contract_blocked, runtimeCompatibility.widgets.filter(item => item.preview_classification === 'quarantined-reviewed-contract-blocked').length);
  assert.equal(runtimeCompatibility.archive_set.sensitive_review_completed_packages, runtimeCompatibility.widgets.filter(item => item.archive_evidence.sensitive_literal_review_completed).length);
  assert.equal(runtimeCompatibility.summary.full_local_ready, runtimeCompatibility.widgets.filter(item => item.full_runtime_status === 'ready').length);
});

test('binds the action to the complete parent, widget, common-child, and blocked-SUNROOOF tuple', () => {
  for (const pattern of [
    /mod === 'Contacts'/,
    /closureNewPreviewLayoutId\(record\) === '1032257000000000171'/,
    /closureNewPreviewDisplayStage\(record\?\.Stage\) === 'Principally Closed'/,
    /String\(blueprint\?\.blueprint_id \|\| ''\) === '1032257000001044611'/,
    /blueprint\?\.blueprint === 'Opportunity Stage'/,
    /blueprint\?\.state_field === 'Stage'/,
    /blueprint\?\.current === 'Principally Closed'/,
    /blueprint\?\.local === true/,
    /String\(transition\?\.id \|\| ''\) === '1032257000025407204'/,
    /transition\?\.name === 'Closure New - Pinki'/,
    /transition\?\.next_value === 'Closure'/,
    /transition\?\.next_actual_value === 'Principally Closure'/,
    /transition\?\.common === false/,
    /transition\?\.trigger_type === 'manual'/,
    /transition\?\.executable === false/,
    /owners\.length === 1 && owners\[0\] === 'Specific Users \(1\)'/,
    /criteria\.length === 0/,
    /transition\.during_inputs\.length === 1/,
    /transition\.during_inputs\[0\] === input/,
    /transition\.after_actions\.length === 0/,
    /String\(input\?\.widget_id \|\| ''\) === '1032257000025407208'/,
    /input\?\.definition_status === 'Captured package validated; original constrained read-only closure-plan preview implemented'/,
    /parent\?\.relationshipId === '1032257000025407206'/,
    /child\?\.transitionId === '1032257000000535729'/,
    /child\?\.requiredField === 'Est_Handover_Date'/,
    /blockedSunrooof\?\.productType === 'SUNROOOF'/,
    /blockedSunrooof\?\.transitionId === '1032257000021717028'/,
    /blockedSunrooof\?\.afterActionId === '1032257000021717034'/,
    /typeof preview\?\.createContext === 'function'/,
    /typeof preview\?\.buildPlan === 'function'/,
  ]) assert.match(predicateSource, pattern);
});

test('adds a separate inert Closure New preview action after the blocked transition action', () => {
  assert.match(recordActionSource, /const closureInput = \(t\.during_inputs \|\| \[\]\)\.find\(input => isClosureNewPreviewInput\(mod, rec, bp, t, input\)\)/);
  assert.match(recordActionSource, /el\('button', 'source-action preview-action closure-new-preview-action', 'Closure New · Preview'\)/);
  assert.match(recordActionSource, /closureButton\.type = 'button'/);
  assert.match(recordActionSource, /closureButton\.setAttribute\('aria-label', 'Open Closure New read-only preview'\)/);
  assert.match(recordActionSource, /closureButton\.onclick = \(\) => openClosureNewPreview\(mod, id, rec, bp, t, closureInput, closureButton\)/);
  const transitionAppend = recordActionSource.indexOf('bpRow.appendChild(btn);');
  const previewCreation = recordActionSource.indexOf("const closureButton = el('button'");
  assert.ok(transitionAppend >= 0 && previewCreation > transitionAppend);
});

test('uses uncached bounded GET-only evidence reads and revalidates the exact private and anonymous snapshots', () => {
  assert.match(evidenceSource, /api\(path, \{ method: 'GET', cache: 'no-store' \}\)/);
  for (const pattern of [
    /closureNewPreviewGet\(`\/api\/record\/Contacts\/\$\{encodeURIComponent\(contactId\)\}`\)/,
    /closureNewPreviewGet\('\/api\/meta\/fields\?module=Contacts'\)/,
    /closureNewPreviewGet\('\/api\/meta\/fields\?module=Deals'\)/,
    /closureNewPreviewGet\('\/api\/meta\/fields\?module=Payment_Milestones'\)/,
    /closureNewPreviewGet\('\/api\/meta\/layouts\?module=Deals'\)/,
    /closureNewPreviewGet\(`\/api\/related\/Contacts\/\$\{encodeURIComponent\(contactId\)\}\/All_Orders\?page=1&per_page=200`\)/,
    /closureNewPreviewGet\(`\/api\/related\/Contacts\/\$\{encodeURIComponent\(contactId\)\}\/Payment_Milestones\?page=1&per_page=200`\)/,
    /closureNewPreviewGet\(`\/api\/record\/Deals\/\$\{encodeURIComponent\(privateOrder\.recordId\)\}`\)/,
    /closureNewPreviewGet\(`\/api\/blueprint\/Deals\/\$\{encodeURIComponent\(privateOrder\.recordId\)\}`\)/,
  ]) assert.match(evidenceSource, pattern);
  assert.equal((evidenceSource.match(/\bapi\s*\(/g) || []).length, 1);
  assert.doesNotMatch(evidenceSource, /\bgetFields\s*\(|\bgetLayouts\s*\(/);
  assert.doesNotMatch(evidenceSource, /\bmethod\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i);
  assert.match(evidenceSource, /closureNewPreviewMapLimit\(candidates, 4,/);
  const recordRead = evidenceSource.indexOf('closureNewPreviewGet(`/api/record/Deals/');
  const recordValidation = evidenceSource.indexOf('closureNewPreviewDealRecordEvidence(recordResponse', recordRead);
  const blueprintRead = evidenceSource.indexOf('closureNewPreviewGet(`/api/blueprint/Deals/', recordValidation);
  assert.ok(recordRead >= 0 && recordValidation > recordRead && blueprintRead > recordValidation);
  assert.match(evidenceSource, /closureNewPreviewDealLayout\(dealLayoutMetadata\?\.layouts, preview\)/);
  assert.match(evidenceSource, /String\(blueprint\?\.blueprint_id \|\| ''\) !== child\.blueprintId/);
  assert.match(evidenceSource, /transition\?\.common !== true/);
  assert.match(evidenceSource, /transition\?\.trigger_type !== 'manual'/);
  assert.match(evidenceSource, /owners\.length !== 1 \|\| owners\[0\] !== 'Specific Users \(1\)'/);
  assert.match(evidenceSource, /during\.api_name !== child\.requiredField/);
  assert.match(evidenceSource, /transition\.after_actions\.length !== 0/);
  assert.match(evidenceSource, /transition\?\.executable !== false/);
  assert.equal((renderSource.match(/closureNewPreviewReadEvidence\(contactId, preview\)/g) || []).length, 2);
  assert.match(renderSource, /freshEvidence\.privateFingerprint !== reviewedEvidence\.privateFingerprint/);
  assert.match(renderSource, /freshEvidence\.anonymousFingerprint !== reviewedEvidence\.anonymousFingerprint/);
  assert.match(renderSource, /context: freshEvidence\.context/);
});

test('keeps stable IDs private while reducing engine and rendered evidence to record-ID-free values', () => {
  assert.match(metadataSource, /rows\.length !== 1 \|\| String\(rows\[0\]\?\.id \|\| ''\) !== String\(expectedRecordId \|\| ''\)/);
  assert.match(metadataSource, /layoutId: closureNewPreviewLayoutId\(rows\[0\]\)/);
  assert.match(metadataSource, /stage: closureNewPreviewDisplayStage\(rows\[0\]\?\.Stage\)/);
  assert.match(metadataSource, /layout\?\.status === 'active' && layout\?\.visible === true/);
  assert.match(metadataSource, /layout\?\.name === child\?\.layoutName/);
  assert.match(metadataSource, /resolution: resolved \? 'only_active_layout' : 'unavailable'/);
  assert.match(metadataSource, /linkFields: Array\.isArray\(relationship\?\.link_fields\)/);
  assert.match(metadataSource, /limitApplied: relationship\?\.pagination\?\.limit_applied/);
  assert.match(metadataSource, /hasMore: relationship\?\.pagination\?\.has_more/);

  const orderProperties = [...orderSnapshotSource.matchAll(/row\?\.([A-Za-z0-9_$]+)/g)].map(match => match[1]);
  assert.deepEqual(orderProperties, ['Product_Type', 'Stage']);
  assert.match(orderSnapshotSource, /ordinal: index \+ 1/);
  assert.match(orderSnapshotSource, /stage: closureNewPreviewDisplayStage\(row\?\.Stage\)/);
  assert.doesNotMatch(orderSnapshotSource, /row\?\.(?:id|Deal_Name|Contact_Name|Full_Name|Owner|Email|Phone|Mobile|Opportunity_Name)\b/i);

  const milestoneProperties = [...milestoneSnapshotSource.matchAll(/row\?\.([A-Za-z0-9_$]+)/g)].map(match => match[1]);
  assert.deepEqual(milestoneProperties, [
    'Amount_Received_Now',
    'Amount_Received_Date',
    'Management_Discount_Proposed',
    'Milestone_Number',
    'Percentage',
    'Serial_Number',
  ]);
  assert.match(milestoneSnapshotSource, /ordinal: index \+ 1/);
  assert.doesNotMatch(milestoneSnapshotSource, /row\?\.(?:id|Name|Contact_Name|Full_Name|Owner|Email|Phone|Mobile|Opportunity_Name|Created_By|Modified_By)\b/i);
  assert.match(evidenceSource, /const recordId = String\(row\?\.id \|\| ''\)/);
  assert.doesNotMatch(evidenceSource, /includeLayout|privateOrder\.layoutId|row\?\.Layout|row\?\.\$layout_id/);
  assert.match(evidenceSource, /orders: privateOrders\.map\(row => \[row\.ordinal, row\.recordId\]\)/);
  assert.match(evidenceSource, /privateFingerprint: closureNewPreviewPrivateFingerprint/);
  assert.doesNotMatch(renderSource, /recordId|privateOrders|privateMilestones|Milestone_Number|Reference_No|milestoneName|referenceNumber/);
  assert.doesNotMatch(renderSource, /JSON\.stringify\s*\(\s*(?:parentResponse|ordersRelationship|milestonesRelationship)|textContent\s*=\s*contactId|esc\s*\(\s*contactId/i);
});

test('accepts Closure Stage only from a non-empty own display_value data property', () => {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(`${displayStageSource}\nglobalThis.displayStage = closureNewPreviewDisplayStage;`, sandbox);

  assert.equal(sandbox.displayStage(' Payment Awaited '), 'Payment Awaited');
  assert.equal(sandbox.displayStage({ display_value: ' Payment Awaited ', actual_value: 'Closure' }), 'Payment Awaited');
  assert.equal(sandbox.displayStage({ actual_value: 'Payment Awaited' }), '');
  assert.equal(sandbox.displayStage({ display_value: '   ', actual_value: 'Payment Awaited' }), '');
  assert.equal(sandbox.displayStage(Object.create({ display_value: 'Payment Awaited' })), '');

  let accessorReads = 0;
  const accessorValue = {};
  Object.defineProperty(accessorValue, 'display_value', {
    configurable: true,
    enumerable: true,
    get() {
      accessorReads += 1;
      return 'Payment Awaited';
    },
  });
  assert.equal(sandbox.displayStage(accessorValue), '');
  assert.equal(accessorReads, 0);
  assert.equal(sandbox.displayStage(new Proxy({}, {
    getOwnPropertyDescriptor() {
      throw new Error('blocked proxy trap');
    },
  })), '');

  assert.match(predicateSource, /closureNewPreviewDisplayStage\(record\?\.Stage\) === 'Principally Closed'/);
  assert.match(metadataSource, /stage: closureNewPreviewDisplayStage\(rows\[0\]\?\.Stage\)/);
  assert.match(orderSnapshotSource, /stage: closureNewPreviewDisplayStage\(row\?\.Stage\)/);
  assert.match(dealRecordEvidenceSource, /const directStage = closureNewPreviewDisplayStage\(record\?\.Stage\)/);
  assert.doesNotMatch(displayStageSource, /actual_value/);
  assert.doesNotMatch(`${predicateSource}\n${metadataSource}\n${orderSnapshotSource}\n${dealRecordEvidenceSource}`, /closureNewPreviewScalar\((?:record|rows\[0\]|row)\?\.Stage\)|\.Stage\?\.(?:actual_value|value)/);
});

test('requires exact uncached Deal-record and single-layout evidence before child Blueprint attestation', () => {
  const sandbox = {
    closureNewPreviewScalar(value) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value.display_value ?? value.actual_value ?? '';
      }
      return value ?? '';
    },
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(
    `${displayStageSource}\n${dealRecordEvidenceSource}\nglobalThis.validateDeal = closureNewPreviewDealRecordEvidence;`,
    sandbox,
  );

  const layoutId = '1032257000000000173';
  const recordId = '1032257000000000001';
  const childContract = {
    currentDisplay: 'Payment Awaited',
    layoutId,
  };
  const privateOrder = { ordinal: 1, recordId };
  const anonymousOrder = { ordinal: 1, productType: 'Kitchen', stage: 'Payment Awaited' };
  const dealLayout = {
    activeLayoutIds: [layoutId],
    resolution: 'only_active_layout',
    resolvedId: layoutId,
  };
  const record = {
    id: recordId,
    Product_Type: 'Kitchen',
    Stage: { actual_value: 'Payment Awaited', display_value: 'Payment Awaited' },
  };
  const resolution = {
    candidate_count: 1,
    exact: true,
    layout_id: layoutId,
    reason: null,
    source: 'only_active_layout',
  };
  const validate = response => sandbox.validateDeal(
    response,
    privateOrder,
    anonymousOrder,
    dealLayout,
    { constants: { childContract } },
  );

  assert.doesNotThrow(() => validate({ data: [record], layout_resolution: resolution }));
  assert.doesNotThrow(() => validate({ data: [{ ...record, Layout: undefined }], layout_resolution: resolution }));
  assert.throws(() => validate({ data: [], layout_resolution: resolution }), /child Deal evidence is invalid/);
  assert.throws(() => validate({ data: [record, { ...record }], layout_resolution: resolution }), /child Deal evidence is invalid/);
  assert.throws(() => validate({
    data: [record],
    layout_resolution: { ...resolution, layout_id: '1032257000000000999' },
  }), /child Deal evidence is invalid/);
  assert.throws(() => validate({
    data: [{ ...record, id: '1032257000000000002' }],
    layout_resolution: resolution,
  }), /child Deal evidence is invalid/);
  assert.throws(() => validate({
    data: [{ ...record, Stage: { display_value: 'Closure' } }],
    layout_resolution: resolution,
  }), /child Deal evidence is invalid/);
  assert.throws(() => validate({
    data: [{ ...record, Product_Type: 'WARDROBE' }],
    layout_resolution: resolution,
  }), /child Deal evidence is invalid/);
  assert.throws(() => validate({ data: [record], layout_resolution: { ...resolution, exact: false } }), /child Deal evidence is invalid/);
  assert.throws(() => validate({ data: [record], layout_resolution: { ...resolution, source: 'record_field' } }), /child Deal evidence is invalid/);
  assert.throws(() => validate({ data: [record], layout_resolution: { ...resolution, reason: 'ambiguous' } }), /child Deal evidence is invalid/);
  assert.throws(() => validate({ data: [record], layout_resolution: { ...resolution, candidate_count: 2 } }), /child Deal evidence is invalid/);
  assert.throws(() => sandbox.validateDeal(
    { data: [record], layout_resolution: resolution },
    privateOrder,
    anonymousOrder,
    { ...dealLayout, activeLayoutIds: [layoutId, '1032257000000000999'] },
    { constants: { childContract } },
  ), /child Deal evidence is invalid/);

  for (const pattern of [
    /resolution\?\.exact !== true/,
    /resolution\?\.source !== 'only_active_layout'/,
    /resolution\?\.reason !== null/,
    /String\(resolution\?\.layout_id \|\| ''\) !== child\.layoutId/,
    /resolution\?\.candidate_count !== 1/,
    /activeLayoutIds\.length !== 1/,
    /activeLayoutIds\[0\] !== child\.layoutId/,
  ]) assert.match(dealRecordEvidenceSource, pattern);
  assert.doesNotMatch(dealRecordEvidenceSource, /record\?\.(?:Layout|\$layout_id)/);
});

test('uses exact metadata and source-compatible milestone controls with bounded validation', () => {
  assert.match(metadataSource, /item\?\.api_name === apiName && item\?\.data_type === dataType/);
  assert.match(metadataSource, /option\?\.type !== 'unused'/);
  assert.match(metadataSource, /option\?\.actual_value, option\?\.display_value/);
  assert.match(metadataSource, /value && value !== '-None-'/);
  assert.match(renderSource, /Estimated handover date \*/);
  assert.match(renderSource, /handover\.type = 'date'/);
  assert.match(renderSource, /Magppie percentages must total 100%\. Sunroof percentages remain outside that total/);
  assert.match(renderSource, /Optional numeric payment details appear only on the first serial-ordered row in each group/);
  assert.match(renderSource, /percentage\.min = '0'/);
  assert.match(renderSource, /percentage\.max = '100'/);
  assert.match(renderSource, /percentage\.step = '0\.01'/);
  assert.match(renderSource, /milestone\.classification === 'Magppie'/);
  assert.match(renderSource, /rounded === 100/);
  assert.match(renderSource, /PERCENT_TOTAL_INVALID: 'Magppie milestone percentages must total exactly 100%\.'/);
  assert.match(renderSource, /AMOUNT_RECEIVED_PRECISION_INVALID: 'Use no more than two decimal places for amount received\.'/);
  assert.match(renderSource, /MANAGEMENT_DISCOUNT_PRECISION_INVALID: 'Use no more than two decimal places for management discount\.'/);
  assert.doesNotMatch(renderSource, /Reference number|Reference_No|referenceNumber/);
});

test('renders record-ID-free runtime-attested plans and keeps SUNROOOF and continuation disabled', () => {
  assert.match(renderSource, /Runtime-attested non-SUNROOOF Orders/);
  assert.match(renderSource, /SUNROOOF Orders — blocked/);
  assert.match(renderSource, /SUNROOOF criteria and Sync Magppie To Sunrooof action are unavailable locally/);
  assert.match(renderSource, /No record-ID-free All_Orders row currently has a runtime-attested non-SUNROOOF Payment Awaited common Closure path/);
  assert.match(renderSource, /preview\.buildPlan\(\{/);
  assert.match(renderSource, /Generate display-only closure plans/);
  assert.match(renderSource, /Display-only closure plans/);
  assert.match(renderSource, /orderPlan\.order_label/);
  assert.match(renderSource, /orderPlan\.intended_transition\.name/);
  assert.match(renderSource, /orderPlan\.runtime_attestation/);
  assert.match(renderSource, /orderPlan\.fields\.Est_Handover_Date/);
  assert.match(renderSource, /orderPlan\.execution/);
  assert.match(renderSource, /plan\.blocked_actions\.join\(', '\)/);
  assert.match(renderSource, /Not persisted/);
  assert.doesNotMatch(renderSource, /orderPlan\.(?:id|record_id|transition_id)|milestonePlan\.(?:id|record_id|transition_id)|intended_transition\.id/i);
  assert.doesNotMatch(renderSource, /parent_transition\.(?:id|transition_id)|widget_id|relationship_id/i);
  assert.doesNotMatch(renderSource, /milestonePlan\.milestone_name|Reference_No|referenceNumber/);
});

test('builds the final Closure summary as text rather than parsed markup', () => {
  assert.match(renderSource, /const summary = el\('small'\)/);
  assert.match(renderSource, /summary\.textContent = `Not persisted · \$\{plan\.totals\.selected_orders\} supported Order plan\(s\)/);
  assert.match(renderSource, /result\.appendChild\(summary\)/);
  assert.doesNotMatch(renderSource, /el\('small', null, `Not persisted · \$\{plan\.totals\.selected_orders\}/);
});

test('shows precise errors without injecting dynamic HTML', () => {
  assert.match(renderSource, /result\.setAttribute\('aria-live', 'polite'\)/);
  assert.match(renderSource, /setAttribute\('aria-describedby', orderError\.id\)/);
  assert.match(renderSource, /setAttribute\('aria-describedby', fieldError\.id\)/);
  assert.match(renderSource, /setAttribute\('aria-invalid', 'true'\)/);
  assert.match(renderSource, /target\.focus\(\)/);
  assert.match(renderSource, /const ordinal = Number\(error\?\.details\?\.ordinal\)/);
  assert.match(renderSource, /const field = String\(error\?\.details\?\.field \|\| ''\)/);
  assert.match(renderSource, /milestoneControls\.find\(row => row\.ordinal === ordinal\)/);
  assert.match(renderSource, /exactRow\[field\]/);
  assert.match(renderSource, /EVIDENCE_STALE:/);
  assert.match(renderSource, /result\.setAttribute\('aria-busy', 'true'\)/);
  assert.match(renderSource, /result\.removeAttribute\('aria-busy'\)/);
  assert.match(renderSource, /tableWrap\.tabIndex = 0/);
  assert.match(renderSource, /tableWrap\.setAttribute\('role', 'region'\)/);
  assert.match(renderSource, /tableWrap\.setAttribute\('aria-label', 'Payment milestone plan table'\)/);
  assert.match(renderSource, /No CRM, workflow, or Blueprint action was performed/);
  assert.doesNotMatch(renderSource, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/i);
});

test('uses an inert close-only dialog with Escape, full focus cycling, and focus restoration', () => {
  assert.match(modalSource, /const shell = \$\('#shell'\)/);
  assert.match(modalSource, /const shellWasInert = shell\?\.hasAttribute\('inert'\) === true/);
  assert.match(modalSource, /if \(shell\) shell\.setAttribute\('inert', ''\)/);
  assert.match(modalSource, /modal\.setAttribute\('role', 'dialog'\)/);
  assert.match(modalSource, /modal\.setAttribute\('aria-modal', 'true'\)/);
  assert.match(modalSource, /modal\.setAttribute\('aria-labelledby', titleId\)/);
  assert.match(modalSource, /heading\.id = titleId/);
  assert.match(modalSource, /close\.setAttribute\('aria-label', 'Close Closure New preview'\)/);
  assert.match(modalSource, /const done = el\('button', null, 'Close preview'\)/);
  assert.match(modalSource, /if \(event\.key === 'Escape'/);
  assert.match(modalSource, /if \(event\.key === 'Tab'/);
  assert.match(modalSource, /event\.shiftKey \? focusable\.length - 1 : 0/);
  assert.match(modalSource, /\(activeIndex \+ \(event\.shiftKey \? -1 : 1\) \+ focusable\.length\) % focusable\.length/);
  assert.match(modalSource, /document\.removeEventListener\('keydown', keyHandler\)/);
  assert.match(modalSource, /if \(shell && !shellWasInert\) shell\.removeAttribute\('inert'\)/);
  assert.match(modalSource, /document\.contains\(restoreFocus\)\) restoreFocus\.focus\(\)/);
  assert.match(modalSource, /close\.focus\(\)/);
  assert.doesNotMatch(modalSource, /Save|Update|Delete|Proceed|Continue|Apply|Confirm/);
});

test('keeps the UI route local and excludes SDK, mutation, provider, storage, file, note, logging, timer, and identity paths', () => {
  const previewUiSource = `${metadataSource}\n${orderSnapshotSource}\n${milestoneSnapshotSource}\n${evidenceSource}\n${renderSource}\n${modalSource}`;
  for (const pattern of [
    /https?:\/\//i,
    /\bfetch\b|XMLHttpRequest|WebSocket|EventSource|sendBeacon/i,
    /\b(?:ZOHO|ZDK)\b/i,
    /\.(?:insertRecord|updateRecord|deleteRecord|addNotes?|attachFile|uploadFile|proceed)\s*\(/i,
    /\/api\/(?:workflows?|integrations?|notes?|attachments?|files?)/i,
    /\bmethod\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i,
    /\b(?:localStorage|sessionStorage|indexedDB|clipboard)\b/i,
    /\b(?:FormData|FileReader|Blob)\b|\.type\s*=\s*['"]file['"]/i,
    /\bconsole\s*\.|setTimeout|setInterval/i,
    /\bgetCurrentUser\b|\/api\/users|\/api\/org|resolveIdentity/i,
  ]) assert.doesNotMatch(previewUiSource, pattern);
  assert.match(evidenceSource, /api\(path, \{ method: 'GET', cache: 'no-store' \}\)/);
  assert.match(evidenceSource, /\/api\/record\/Deals\//);
  assert.match(evidenceSource, /\/api\/blueprint\/Deals\//);
  assert.doesNotMatch(evidenceSource, /\bmethod\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i);
});

test('loads the hardened engine before the application and provides isolated responsive styles', () => {
  const engineIndex = scriptOrderSource.indexOf('<script src="/closure-new-preview.js"></script>');
  const appIndex = scriptOrderSource.indexOf('<script src="/app.js"></script>');
  assert.ok(engineIndex >= 0 && appIndex > engineIndex);
  assert.match(packageJson.scripts.precheck, /node --check public\/closure-new-preview\.js/);
  assert.match(packageJson.scripts.check, /node --check public\/closure-new-preview\.js/);
  assert.match(closureStyles, /\.closure-new-preview-grid \{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(closureStyles, /\.closure-new-preview-table-wrap \{[^}]*overflow-x:auto/);
  assert.match(closureStyles, /\.closure-new-preview-table \{[^}]*min-width:660px/);
  assert.match(closureStyles, /@media \(max-width:600px\)/);
  assert.match(closureStyles, /\.closure-new-preview-grid,\.closure-new-preview-plan-grid \{ grid-template-columns:1fr; \}/);
  assert.match(closureStyles, /@media \(max-width:390px\)/);
  assert.match(closureStyles, /\.closure-new-preview-modal-body \{ padding-right:10px!important; padding-left:10px!important; \}/);
  assert.doesNotMatch(closureStyles, /(^|[},\s])(?:body|html|\.modal|\.mh|\.mb|\.mf)(?:\s|,|\{)/m);
});
