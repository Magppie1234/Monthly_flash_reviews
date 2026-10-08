'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const enginePath = path.resolve(__dirname, '..', 'public', 'handover-post-team-preview.js');
const engineSource = fs.readFileSync(enginePath, 'utf8');
const preview = require('../public/handover-post-team-preview');
const {
  HandoverPostTeamPreviewError,
  buildPlan,
  compareEvidence,
  constants,
  createEvidence,
  displayStage,
  mapLimit,
} = preview;

const clone = value => JSON.parse(JSON.stringify(value));
const privateId = ordinal => `9${String(ordinal).padStart(18, '0')}`;
const stage = value => ({ actual_value: value, display_value: value });

function metadataFor(schemas, optionOverrides = {}) {
  return Object.entries(schemas).map(([apiName, schema]) => ({
    apiName,
    dataType: schema.dataType,
    length: schema.length,
    options: schema.dataType === 'picklist'
      ? clone(optionOverrides[apiName] || [...schema.requiredOptions, `Other ${apiName}`])
      : [],
    readOnly: schema.readOnly,
    relatedModule: schema.relatedModule,
    systemMandatory: schema.systemMandatory,
  }));
}

function transitionFor(contract, duringInputs, afterActions) {
  return {
    afterActions: clone(afterActions),
    common: false,
    criteriaCount: 0,
    duringInputs: clone(duringInputs),
    executable: false,
    fromActual: contract.currentActual,
    fromDisplay: contract.currentDisplay,
    id: contract.transitionId,
    localExecution: 'Blocked',
    name: contract.transitionName,
    ownerCount: 1,
    ownerType: 'record_owner',
    toActual: contract.nextActual,
    toDisplay: contract.nextDisplay,
    triggerType: 'manual',
  };
}

function blueprintFor(contract, recordId, duringInputs, afterActions) {
  return {
    blueprintId: contract.blueprintId,
    blueprintName: contract.blueprintName,
    currentDisplay: contract.currentDisplay,
    layoutId: contract.layoutId,
    layoutName: contract.layoutName,
    local: true,
    module: contract.module,
    recordId,
    stateField: contract.stateField,
    status: contract.status,
    transition: transitionFor(contract, duringInputs, afterActions),
  };
}

function amsBlueprint(contract, index) {
  const expected = contract.blueprints[index];
  return {
    blueprintId: expected.blueprintId,
    blueprintName: expected.blueprintName,
    layoutId: contract.layoutId,
    layoutName: contract.layoutName,
    module: contract.module,
    stateField: contract.stateField,
    status: contract.status,
    transitions: Array.from({ length: expected.transitionCount }, (_, transitionIndex) => ({
      active: true,
      toActual: `Reviewed state ${index + 1}.${transitionIndex + 1}`,
      toDisplay: `Reviewed state ${index + 1}.${transitionIndex + 1}`,
    })),
  };
}

function directOrder(ordinal, id) {
  return {
    blueprint: blueprintFor(
      constants.childContract,
      id,
      constants.childContract.duringInputs,
      constants.childContract.afterActions,
    ),
    layoutResolution: {
      candidateCount: 1,
      exact: true,
      layoutId: constants.childContract.layoutId,
      reason: null,
      source: 'only_active_layout',
    },
    ordinal,
    records: [{ id, stage: stage(constants.childContract.currentDisplay) }],
    requestedId: id,
  };
}

function baseEvidenceInput() {
  const parentId = privateId(1);
  const firstOrderId = privateId(101);
  const secondOrderId = privateId(102);
  const thirdOrderId = privateId(103);
  return {
    amsBlueprintCatalog: {
      blueprints: [amsBlueprint(constants.amsContract, 0), amsBlueprint(constants.amsContract, 1)],
    },
    amsFieldMetadata: metadataFor(constants.amsFieldSchemas, {
      Client_Address_Country_Region: ['India', 'Singapore'],
      Client_Address_State_Province: ['Delhi', 'Karnataka'],
      Record_Type: ['AMS', 'Complaint'],
      Stage: ['Planned', 'Done'],
    }),
    amsLayoutCatalog: {
      layouts: [{ id: constants.amsContract.layoutId, name: 'Standard', status: 'active', visible: true }],
    },
    contactFieldMetadata: metadataFor(constants.contactFieldSchemas),
    contactLayoutCatalog: {
      layouts: [{ id: constants.parentContract.layoutId, name: 'Standard', status: 'active', visible: true }],
    },
    dealFieldMetadata: metadataFor(constants.dealFieldSchemas, {
      Stage: ['Second Installation Done', 'Final Handover', 'Raw Quote'],
    }),
    dealLayoutCatalog: {
      layouts: [{ id: constants.childContract.layoutId, name: 'Standard', status: 'active', visible: true }],
    },
    directOrders: [directOrder(1, firstOrderId), directOrder(3, thirdOrderId)],
    ordersRelationship: {
      availability: 'queryable',
      hasMore: false,
      limitApplied: true,
      linkBasis: 'Exact source lookup relation',
      linkFields: ['Opportunity_Name'],
      orders: [
        { id: firstOrderId, ordinal: 1, stage: stage('Second Installation Done') },
        { id: secondOrderId, ordinal: 2, stage: stage('Final Handover') },
        { id: thirdOrderId, ordinal: 3, stage: stage('Second Installation Done') },
      ],
      page: 1,
      perPage: 200,
      relatedModule: 'Deals',
      returned: 3,
    },
    parentBlueprint: blueprintFor(
      constants.parentContract,
      parentId,
      constants.parentDuringInputs,
      [],
    ),
    parentRecord: {
      records: [{
        id: parentId,
        layoutId: constants.parentContract.layoutId,
        stage: stage(constants.parentContract.currentDisplay),
      }],
      requestedId: parentId,
    },
  };
}

function expectCode(fn, code) {
  assert.throws(fn, error => {
    assert.equal(error instanceof HandoverPostTeamPreviewError, true);
    assert.equal(error.code, code);
    assert.equal(error.message, 'Handover To Post Team preview evidence is invalid.');
    return true;
  });
}

async function expectAsyncCode(promise, code) {
  await assert.rejects(promise, error => {
    assert.equal(error instanceof HandoverPostTeamPreviewError, true);
    assert.equal(error.code, code);
    return true;
  });
}

function assertDeepFrozen(value, seen = new WeakSet()) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function') || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  Reflect.ownKeys(value).forEach(key => assertDeepFrozen(value[key], seen));
}

test('pins and deeply freezes the exact audited parent, child, relationship, and AMS contracts', () => {
  assert.deepEqual(constants.parentContract, {
    blueprintId: '1032257000001044611',
    blueprintName: 'Opportunity Stage',
    currentActual: 'Second Installation Done',
    currentDisplay: 'Second Installation Done',
    layoutId: '1032257000000000171',
    layoutName: 'Standard',
    module: 'Contacts',
    nextActual: 'Final Handover',
    nextDisplay: 'Final Handover',
    stateField: 'Stage',
    status: 'Active',
    transitionId: '1032257000023182424',
    transitionName: 'Final Handover',
  });
  assert.equal(constants.childContract.transitionId, '1032257000008339350');
  assert.equal(constants.childContract.duringInputs[0].checklist.items[0].name, 'Handover Certificate');
  assert.equal(constants.childContract.duringInputs[1].apiName, 'MDR_Done');
  assert.equal(constants.childContract.duringInputs[2].dataType, 'integer');
  assert.equal(constants.childContract.afterActions[0].details.fieldApiName, 'First_Service_Date');
  assert.equal(constants.relationshipContract.linkFields[0], 'Opportunity_Name');
  assert.equal(constants.amsContract.blueprints[0].transitionCount, 10);
  assert.equal(constants.amsContract.blueprints[1].transitionCount, 15);
  assertDeepFrozen(constants);
});

test('extracts only a string or an own data display_value and never falls back to actual_value', () => {
  assert.equal(displayStage('  Final Handover  '), 'Final Handover');
  assert.equal(displayStage({ display_value: '  Second Installation Done ', actual_value: 'Wrong' }), 'Second Installation Done');
  assert.equal(displayStage({ actual_value: 'Second Installation Done' }), '');
  assert.equal(displayStage(Object.create({ display_value: 'Second Installation Done' })), '');
  let reads = 0;
  const accessor = {};
  Object.defineProperty(accessor, 'display_value', {
    configurable: true,
    enumerable: true,
    get() {
      reads += 1;
      return 'Second Installation Done';
    },
  });
  assert.equal(displayStage(accessor), '');
  assert.equal(reads, 0);
  const hostile = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('blocked'); } });
  assert.equal(displayStage(hostile), '');
});

test('creates frozen anonymous evidence from the complete relation and exact direct GET tuples', () => {
  const evidence = createEvidence(baseEvidenceInput());
  assert.deepEqual(evidence.context.eligibleOrders, [
    { label: 'Order 1', ordinal: 1, stage: 'Second Installation Done' },
    { label: 'Order 3', ordinal: 3, stage: 'Second Installation Done' },
  ]);
  assert.deepEqual(evidence.context.blockedOrders, [
    { label: 'Order 2', ordinal: 2, reason: 'stage-not-second-installation-done', stage: 'Final Handover' },
  ]);
  assert.deepEqual(evidence.context.relationshipCounts, { blocked: 1, eligible: 2, total: 3 });
  assert.equal(evidence.context.ams.active_transition_to_planned_count, 0);
  assert.equal(evidence.context.ams.creation, 'disabled');
  assert.equal(evidence.context.ams.enrollment, 'blocked');
  assert.match(evidence.privateFingerprint, /^private-v1-[a-f0-9]{64}$/);
  assert.match(evidence.anonymousFingerprint, /^anonymous-v1-[a-f0-9]{64}$/);
  assertDeepFrozen(evidence);
  const serialized = JSON.stringify(evidence);
  for (const id of [privateId(1), privateId(101), privateId(102), privateId(103)]) {
    assert.doesNotMatch(serialized, new RegExp(id));
  }
  assert.doesNotMatch(serialized, /Client_Mobile|Client_Address|Order_Ids|Order_Names|recordId|requestedId/i);
});

test('builds a deeply frozen ID-free display-only plan with every execution path blocked', () => {
  const evidence = createEvidence(baseEvidenceInput());
  const plan = buildPlan({ context: evidence.context });
  assert.equal(plan.preview_only, true);
  assert.equal(plan.persistence, 'disabled');
  assert.deepEqual(plan.totals, { blocked_orders: 1, eligible_orders: 2, relationship_orders: 3 });
  assert.deepEqual(plan.order_plans.map(row => [row.order_label, row.source_stage, row.intended_transition, row.execution]), [
    ['Order 1', 'Second Installation Done', 'Final Handover', 'disabled'],
    ['Order 3', 'Second Installation Done', 'Final Handover', 'disabled'],
  ]);
  assert.deepEqual(plan.order_plans[0].required_inputs.map(row => [row.label, row.type, row.required]), [
    ['Handover File', 'checklist', true],
    ['Handover Certificate', 'checklist item', true],
    ['MDR Done', 'date', true],
    ['Internal QC', 'integer', true],
  ]);
  assert.deepEqual(plan.order_plans[0].after_effect, { field: 'First Service Date', timing: 'Execution day' });
  assert.deepEqual(plan.ams_plan, {
    blueprint_enrollment: 'blocked',
    creation: 'disabled',
    intended_stage: 'Planned',
    reason: 'no-active-transition-to-planned',
    schema_attestation: '14 reviewed fields',
  });
  assert.deepEqual(plan.blocked_actions, [
    'Handover certificate or file transfer',
    'Deal record updates',
    'child Blueprint transition',
    'workflow triggering',
    'AMS record creation',
    'AMS Planned Blueprint enrollment',
    'parent Blueprint continuation',
    'permission and owner evaluation',
  ]);
  assertDeepFrozen(plan);
  const serialized = JSON.stringify(plan);
  assert.doesNotMatch(serialized, /\b\d{19}\b/);
  assert.doesNotMatch(serialized, /record.?id|transition.?id|blueprint.?id|layout.?id|owner.?id|Client_Name|Order_Ids|Order_Names/i);
});

test('requires the exact one-record parent ID, Standard layout, display Stage, and parent Blueprint binding', () => {
  for (const mutate of [
    raw => { raw.parentRecord.records = []; },
    raw => { raw.parentRecord.records[0].id = privateId(999); },
    raw => { raw.parentRecord.records[0].layoutId = constants.childContract.layoutId; },
    raw => { raw.parentRecord.records[0].stage = stage('Final Handover'); },
  ]) {
    const raw = baseEvidenceInput();
    mutate(raw);
    expectCode(() => createEvidence(raw), 'PARENT_RECORD_INVALID');
  }
  const actualOnly = baseEvidenceInput();
  actualOnly.parentRecord.records[0].stage = { actual_value: 'Second Installation Done' };
  expectCode(() => createEvidence(actualOnly), 'PARENT_STAGE_INVALID');

  for (const [path, value] of [
    ['blueprintId', constants.childContract.blueprintId],
    ['blueprintName', 'Other Process'],
    ['layoutId', constants.childContract.layoutId],
    ['layoutName', 'Other Layout'],
    ['module', 'Deals'],
    ['stateField', 'Status'],
    ['status', 'Inactive'],
    ['currentDisplay', 'Final Handover'],
    ['local', false],
  ]) {
    const raw = baseEvidenceInput();
    raw.parentBlueprint[path] = value;
    expectCode(() => createEvidence(raw), 'PARENT_BLUEPRINT_INVALID');
  }
});

test('requires the exact parent transition owner type/count, During widget, and empty After phase', () => {
  for (const [key, value] of [
    ['id', constants.childContract.transitionId],
    ['name', 'Other Transition'],
    ['common', true],
    ['triggerType', 'automatic'],
    ['fromDisplay', 'Final Handover'],
    ['fromActual', 'Final Handover'],
    ['toDisplay', 'Closed'],
    ['toActual', 'Closed'],
    ['criteriaCount', 1],
    ['ownerType', 'specific_resource'],
    ['ownerCount', 2],
    ['executable', true],
    ['localExecution', 'Implemented'],
  ]) {
    const raw = baseEvidenceInput();
    raw.parentBlueprint.transition[key] = value;
    expectCode(() => createEvidence(raw), 'PARENT_BLUEPRINT_INVALID');
  }
  const wrongWidget = baseEvidenceInput();
  wrongWidget.parentBlueprint.transition.duringInputs[0].label = 'Other Widget';
  expectCode(() => createEvidence(wrongWidget), 'PARENT_BLUEPRINT_INVALID');

  const extraWidget = baseEvidenceInput();
  extraWidget.parentBlueprint.transition.duringInputs.push(clone(constants.parentDuringInputs[0]));
  expectCode(() => createEvidence(extraWidget), 'PARENT_BLUEPRINT_INVALID');

  const after = baseEvidenceInput();
  after.parentBlueprint.transition.afterActions.push(clone(constants.childContract.afterActions[0]));
  expectCode(() => createEvidence(after), 'PARENT_BLUEPRINT_INVALID');
});

test('fails closed on relationship aliases, incompleteness, pagination, count drift, and link drift', () => {
  for (const [key, value] of [
    ['availability', 'unresolved'],
    ['hasMore', true],
    ['limitApplied', false],
    ['linkBasis', 'Fallback relation'],
    ['page', 2],
    ['perPage', 100],
    ['relatedModule', 'Contacts'],
    ['returned', 2],
  ]) {
    const raw = baseEvidenceInput();
    raw.ordersRelationship[key] = value;
    expectCode(() => createEvidence(raw), 'ORDER_RELATIONSHIP_INVALID');
  }
  const link = baseEvidenceInput();
  link.ordersRelationship.linkFields = ['Opportunity'];
  expectCode(() => createEvidence(link), 'ORDER_RELATIONSHIP_INVALID');

  const alias = baseEvidenceInput();
  alias.ordersRelationship.data = alias.ordersRelationship.orders;
  expectCode(() => createEvidence(alias), 'ORDER_RELATIONSHIP_INVALID');
});

test('rejects duplicate identities/ordinals, sparse arrays, symbols, accessors, and hostile proxies', () => {
  const duplicateId = baseEvidenceInput();
  duplicateId.ordersRelationship.orders[1].id = duplicateId.ordersRelationship.orders[0].id;
  expectCode(() => createEvidence(duplicateId), 'ORDER_IDENTITY_INVALID');

  const duplicateOrdinal = baseEvidenceInput();
  duplicateOrdinal.ordersRelationship.orders[1].ordinal = 1;
  expectCode(() => createEvidence(duplicateOrdinal), 'ORDER_ORDINAL_INVALID');

  const sparse = baseEvidenceInput();
  sparse.ordersRelationship.orders = new Array(3);
  expectCode(() => createEvidence(sparse), 'ORDER_RELATIONSHIP_INVALID');

  const symbol = baseEvidenceInput();
  symbol.ordersRelationship.orders[0][Symbol('private')] = true;
  expectCode(() => createEvidence(symbol), 'ORDER_DESCRIPTOR_INVALID');

  let reads = 0;
  const accessor = baseEvidenceInput();
  Object.defineProperty(accessor.ordersRelationship, 'orders', {
    enumerable: true,
    get() {
      reads += 1;
      return [];
    },
  });
  expectCode(() => createEvidence(accessor), 'ORDER_RELATIONSHIP_INVALID');
  assert.equal(reads, 0);

  const hostile = new Proxy(baseEvidenceInput(), { ownKeys() { throw new Error('blocked'); } });
  expectCode(() => createEvidence(hostile), 'EVIDENCE_INVALID');
});

test('requires current exact field types, lengths, flags, lookup target, and semantic picklist options', () => {
  const dealType = baseEvidenceInput();
  dealType.dealFieldMetadata.find(field => field.apiName === 'Internal_QC').dataType = 'date';
  expectCode(() => createEvidence(dealType), 'DEAL_METADATA_INVALID');

  const dealLength = baseEvidenceInput();
  dealLength.dealFieldMetadata.find(field => field.apiName === 'MDR_Done').length = 19;
  expectCode(() => createEvidence(dealLength), 'DEAL_METADATA_INVALID');

  const dealStage = baseEvidenceInput();
  dealStage.dealFieldMetadata.find(field => field.apiName === 'Stage').options = ['Final Handover'];
  expectCode(() => createEvidence(dealStage), 'DEAL_METADATA_INVALID');

  const amsName = baseEvidenceInput();
  amsName.amsFieldMetadata.find(field => field.apiName === 'Name').systemMandatory = false;
  expectCode(() => createEvidence(amsName), 'AMS_METADATA_INVALID');

  const amsOwner = baseEvidenceInput();
  amsOwner.amsFieldMetadata.find(field => field.apiName === 'Owner').readOnly = false;
  expectCode(() => createEvidence(amsOwner), 'AMS_METADATA_INVALID');

  const amsLookup = baseEvidenceInput();
  amsLookup.amsFieldMetadata.find(field => field.apiName === 'Client_Name').relatedModule = 'Deals';
  expectCode(() => createEvidence(amsLookup), 'AMS_METADATA_INVALID');

  const amsStage = baseEvidenceInput();
  amsStage.amsFieldMetadata.find(field => field.apiName === 'Stage').options = ['Done'];
  expectCode(() => createEvidence(amsStage), 'AMS_METADATA_INVALID');

  const expanded = baseEvidenceInput();
  expanded.amsFieldMetadata.push(clone(expanded.amsFieldMetadata[0]));
  expectCode(() => createEvidence(expanded), 'AMS_METADATA_INVALID');

  let reads = 0;
  const accessor = baseEvidenceInput();
  const field = accessor.dealFieldMetadata[0];
  delete field.apiName;
  Object.defineProperty(field, 'apiName', {
    enumerable: true,
    get() {
      reads += 1;
      return 'Stage';
    },
  });
  expectCode(() => createEvidence(accessor), 'DEAL_METADATA_INVALID');
  assert.equal(reads, 0);
});

test('requires exact active-visible layout evidence and only-active resolution for Deals and AMS', () => {
  const contact = baseEvidenceInput();
  contact.contactLayoutCatalog.layouts[0].visible = false;
  expectCode(() => createEvidence(contact), 'CONTACT_LAYOUT_INVALID');

  const duplicate = baseEvidenceInput();
  duplicate.dealLayoutCatalog.layouts.push({ id: privateId(777), name: 'Alternate', status: 'active', visible: true });
  expectCode(() => createEvidence(duplicate), 'DEAL_LAYOUT_INVALID');

  const ams = baseEvidenceInput();
  ams.amsLayoutCatalog.layouts[0].name = 'Alternate';
  expectCode(() => createEvidence(ams), 'AMS_LAYOUT_INVALID');

  for (const [key, value] of [
    ['candidateCount', 2],
    ['exact', false],
    ['layoutId', constants.parentContract.layoutId],
    ['reason', 'ambiguous'],
    ['source', 'stored_layout'],
  ]) {
    const raw = baseEvidenceInput();
    raw.directOrders[0].layoutResolution[key] = value;
    expectCode(() => createEvidence(raw), 'CHILD_LAYOUT_RESOLUTION_INVALID');
  }
});

test('requires one direct record matching relationship identity, ordinal, and exact display Stage', () => {
  const missing = baseEvidenceInput();
  missing.directOrders.pop();
  expectCode(() => createEvidence(missing), 'DIRECT_ORDER_EVIDENCE_INVALID');

  const extraRecord = baseEvidenceInput();
  extraRecord.directOrders[0].records.push(clone(extraRecord.directOrders[0].records[0]));
  expectCode(() => createEvidence(extraRecord), 'DIRECT_ORDER_EVIDENCE_INVALID');

  const wrongId = baseEvidenceInput();
  wrongId.directOrders[0].records[0].id = privateId(888);
  expectCode(() => createEvidence(wrongId), 'DIRECT_ORDER_EVIDENCE_INVALID');

  const wrongOrdinal = baseEvidenceInput();
  wrongOrdinal.directOrders[0].ordinal = 3;
  expectCode(() => createEvidence(wrongOrdinal), 'DIRECT_ORDER_EVIDENCE_INVALID');

  const actualOnly = baseEvidenceInput();
  actualOnly.directOrders[0].records[0].stage = { actual_value: 'Second Installation Done' };
  expectCode(() => createEvidence(actualOnly), 'DIRECT_ORDER_STAGE_INVALID');

  const wrongStage = baseEvidenceInput();
  wrongStage.directOrders[0].records[0].stage = stage('Final Handover');
  expectCode(() => createEvidence(wrongStage), 'DIRECT_ORDER_EVIDENCE_INVALID');
});

test('requires the exact child Blueprint tuple, During checklist/fields, After update, and blocked execution', () => {
  for (const [key, value] of [
    ['blueprintId', constants.parentContract.blueprintId],
    ['blueprintName', 'Other Process'],
    ['layoutId', constants.parentContract.layoutId],
    ['currentDisplay', 'Final Handover'],
    ['recordId', privateId(555)],
  ]) {
    const raw = baseEvidenceInput();
    raw.directOrders[0].blueprint[key] = value;
    expectCode(() => createEvidence(raw), 'CHILD_BLUEPRINT_INVALID');
  }
  for (const [key, value] of [
    ['id', constants.parentContract.transitionId],
    ['common', true],
    ['criteriaCount', 1],
    ['executable', true],
    ['fromActual', 'Final Handover'],
    ['fromDisplay', 'Final Handover'],
    ['localExecution', 'Implemented'],
    ['ownerCount', 2],
    ['ownerType', 'specific_resource'],
    ['toActual', 'Closed'],
    ['toDisplay', 'Closed'],
    ['triggerType', 'automatic'],
  ]) {
    const raw = baseEvidenceInput();
    raw.directOrders[0].blueprint.transition[key] = value;
    expectCode(() => createEvidence(raw), 'CHILD_BLUEPRINT_INVALID');
  }
  const checklist = baseEvidenceInput();
  checklist.directOrders[0].blueprint.transition.duringInputs[0].checklist.items[0].required = false;
  expectCode(() => createEvidence(checklist), 'CHILD_BLUEPRINT_INVALID');

  const field = baseEvidenceInput();
  field.directOrders[0].blueprint.transition.duringInputs[2].dataType = 'date';
  expectCode(() => createEvidence(field), 'CHILD_BLUEPRINT_INVALID');

  const after = baseEvidenceInput();
  after.directOrders[0].blueprint.transition.afterActions[0].details.value = '${EXECUTION_DAY}+1';
  expectCode(() => createEvidence(after), 'CHILD_BLUEPRINT_INVALID');

  const extraAfter = baseEvidenceInput();
  extraAfter.directOrders[0].blueprint.transition.afterActions.push(clone(constants.childContract.afterActions[0]));
  expectCode(() => createEvidence(extraAfter), 'CHILD_BLUEPRINT_INVALID');
});

test('attests the exact AMS schema but rejects any active transition to Planned', () => {
  const active = baseEvidenceInput();
  active.amsBlueprintCatalog.blueprints[0].transitions[0].toDisplay = 'Planned';
  expectCode(() => createEvidence(active), 'AMS_PLANNED_TRANSITION_PRESENT');

  const actual = baseEvidenceInput();
  actual.amsBlueprintCatalog.blueprints[1].transitions[0].toActual = 'Planned';
  expectCode(() => createEvidence(actual), 'AMS_PLANNED_TRANSITION_PRESENT');

  const inactive = baseEvidenceInput();
  inactive.amsBlueprintCatalog.blueprints[0].transitions[0] = {
    active: false,
    toActual: 'Planned',
    toDisplay: 'Planned',
  };
  assert.equal(createEvidence(inactive).context.ams.active_transition_to_planned_count, 0);

  const missing = baseEvidenceInput();
  missing.amsBlueprintCatalog.blueprints[0].transitions.pop();
  expectCode(() => createEvidence(missing), 'AMS_BLUEPRINT_CATALOG_INVALID');

  const wrongBlueprint = baseEvidenceInput();
  wrongBlueprint.amsBlueprintCatalog.blueprints[1].blueprintName = 'Other Blueprint';
  expectCode(() => createEvidence(wrongBlueprint), 'AMS_BLUEPRINT_CATALOG_INVALID');
});

test('compares independently created fresh evidence using opaque anonymous and private fingerprints', () => {
  const reviewed = createEvidence(baseEvidenceInput());
  const equivalent = createEvidence(baseEvidenceInput());
  assert.deepEqual(compareEvidence({ fresh: equivalent, reviewed }), {
    anonymousMatch: true,
    match: true,
    privateMatch: true,
  });

  const identityDrift = baseEvidenceInput();
  const replacement = privateId(404);
  identityDrift.ordersRelationship.orders[0].id = replacement;
  identityDrift.directOrders[0].requestedId = replacement;
  identityDrift.directOrders[0].records[0].id = replacement;
  identityDrift.directOrders[0].blueprint.recordId = replacement;
  const privateChanged = createEvidence(identityDrift);
  assert.deepEqual(compareEvidence({ fresh: privateChanged, reviewed }), {
    anonymousMatch: true,
    match: false,
    privateMatch: false,
  });

  const stageDrift = baseEvidenceInput();
  stageDrift.ordersRelationship.orders[1].stage = stage('Raw Quote');
  const anonymousChanged = createEvidence(stageDrift);
  assert.deepEqual(compareEvidence({ fresh: anonymousChanged, reviewed }), {
    anonymousMatch: false,
    match: false,
    privateMatch: true,
  });

  expectCode(() => compareEvidence({ fresh: { ...equivalent }, reviewed }), 'EVIDENCE_COMPARISON_INVALID');
});

test('does not mutate evidence inputs and snapshots all plan-relevant values against TOCTOU changes', () => {
  const raw = baseEvidenceInput();
  const before = clone(raw);
  const evidence = createEvidence(raw);
  assert.deepEqual(raw, before);

  raw.parentRecord.records[0].stage.display_value = 'Final Handover';
  raw.ordersRelationship.orders[0].stage.display_value = 'Raw Quote';
  raw.directOrders[0].blueprint.transition.afterActions[0].name = 'Changed';
  raw.amsFieldMetadata.find(field => field.apiName === 'Stage').options.push('Changed');
  assert.equal(evidence.context.parent.source_stage, 'Second Installation Done');
  assert.equal(evidence.context.eligibleOrders[0].stage, 'Second Installation Done');
  assert.equal(buildPlan({ context: evidence.context }).order_plans.length, 2);

  expectCode(() => buildPlan({ context: { ...evidence.context } }), 'CONTEXT_INVALID');
  let gets = 0;
  const input = new Proxy({ context: evidence.context }, {
    get(target, key, receiver) {
      gets += 1;
      return Reflect.get(target, key, receiver);
    },
  });
  assert.equal(buildPlan(input).order_plans.length, 2);
  assert.equal(gets, 0);

  const accessor = {};
  Object.defineProperty(accessor, 'context', { enumerable: true, get: () => evidence.context });
  expectCode(() => buildPlan(accessor), 'PLAN_INPUT_INVALID');
});

test('maps in stable order with a hard concurrency ceiling of four and no input mutation', async () => {
  const input = [1, 2, 3, 4, 5, 6, 7, 8];
  const before = [...input];
  let active = 0;
  let peak = 0;
  const output = await mapLimit(input, 4, async (value, index) => {
    active += 1;
    peak = Math.max(peak, active);
    await Promise.resolve();
    active -= 1;
    return `${index}:${value * 2}`;
  });
  assert.deepEqual(output, ['0:2', '1:4', '2:6', '3:8', '4:10', '5:12', '6:14', '7:16']);
  assert.equal(peak, 4);
  assert.equal(Object.isFrozen(output), true);
  assert.deepEqual(input, before);

  await expectAsyncCode(mapLimit([1], 5, async value => value), 'CONCURRENCY_INVALID');
  await expectAsyncCode(mapLimit([1], 0, async value => value), 'CONCURRENCY_INVALID');
  await expectAsyncCode(mapLimit([1], 1, null), 'MAPPER_INVALID');

  const sparse = new Array(2);
  await expectAsyncCode(mapLimit(sparse, 1, async value => value), 'MAP_INPUT_INVALID');
});

test('contains no SDK, network, mutation, provider, persistence, logging, timer, or file-operation surface', () => {
  for (const pattern of [
    /https?:\/\//i,
    /\bfetch\b|XMLHttpRequest|WebSocket|EventSource|sendBeacon/i,
    /\b(?:ZOHO|ZDK)\b/i,
    /\.(?:insertRecord|updateRecord|deleteRecord|updateBluePrint|proceed|attachFile|uploadFile)\s*\(/i,
    /\b(?:localStorage|sessionStorage|indexedDB|clipboard)\b/i,
    /\b(?:FormData|FileReader|Blob)\b|\.type\s*=\s*['"]file['"]/i,
    /\bconsole\s*\.|setTimeout|setInterval/i,
    /method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i,
    /document\.|window\.|navigator\./i,
  ]) assert.doesNotMatch(engineSource, pattern);
});

test('publishes one frozen browser namespace with the same pure API and refuses replacement', () => {
  const sandbox = { globalThis: null };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(engineSource, sandbox, { filename: 'handover-post-team-preview.js' });
  assert.deepEqual(Object.keys(sandbox.HandoverPostTeamPreview), Object.keys(preview));
  assert.equal(typeof sandbox.HandoverPostTeamPreview.createEvidence, 'function');
  assert.equal(typeof sandbox.HandoverPostTeamPreview.compareEvidence, 'function');
  assert.equal(typeof sandbox.HandoverPostTeamPreview.mapLimit, 'function');
  assert.equal(Object.isFrozen(sandbox.HandoverPostTeamPreview), true);
  const descriptor = Object.getOwnPropertyDescriptor(sandbox, 'HandoverPostTeamPreview');
  assert.equal(descriptor.writable, false);
  assert.equal(descriptor.configurable, false);
  assert.throws(
    () => vm.runInContext(engineSource, sandbox, { filename: 'handover-post-team-preview.js' }),
    /namespace is unavailable/i,
  );
});
