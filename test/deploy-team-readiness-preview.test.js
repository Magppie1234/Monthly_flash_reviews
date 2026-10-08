'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const enginePath = path.join(__dirname, '..', 'public', 'deploy-team-readiness-preview.js');
const engineSource = fs.readFileSync(enginePath, 'utf8');
const {
  DeployTeamReadinessPreviewError,
  buildPlan,
  constants,
  createContext,
} = require('../public/deploy-team-readiness-preview');

function field(apiName, dataType, overrides = {}) {
  return {
    apiName,
    dataType,
    fieldReadOnly: false,
    lookupApi: null,
    lookupModule: null,
    optionCount: 0,
    readOnly: false,
    requiredOptionPresent: null,
    systemMandatory: false,
    ...overrides,
  };
}

function dealFields() {
  return [
    field('Stage', 'picklist', { optionCount: 40, requiredOptionPresent: true, systemMandatory: true }),
    field('Installation_Managers', 'picklist', { optionCount: 7 }),
    field('Product_Name', 'text'),
    field('Product_Type', 'picklist', { optionCount: 7 }),
  ];
}

function visitFields(overrides = {}) {
  const values = [
    field('Name', 'text', { systemMandatory: true }),
    field('Client_Name', 'lookup', { lookupApi: 'All_Services', lookupModule: 'Contacts' }),
    field('Client_Address', 'textarea'),
    field('Record_Type', 'picklist', { optionCount: 5, requiredOptionPresent: true }),
    field('AMS_Status', 'picklist', { optionCount: 39, requiredOptionPresent: true }),
    field('Installation_Manager', 'picklist', { optionCount: 13 }),
    field('Task_Name', 'picklist', { optionCount: 19 }),
    field('Team_Member_Name', 'multiselectpicklist', { optionCount: 106 }),
    field('Assigned_Team_Member_Count', 'integer'),
    field('Scheduled_Visit_Date', 'date'),
  ];
  return values.map(value => value.apiName === overrides.apiName ? { ...value, ...overrides } : value);
}

function serviceFields(overrides = {}) {
  const values = [
    field('Orders_Name', 'lookup', {
      lookupApi: 'Service_Activities14', lookupModule: 'Deals', systemMandatory: true,
    }),
    field('Installations_Services', 'lookup', {
      lookupApi: 'Orders14', lookupModule: 'Visit_Module', systemMandatory: true,
    }),
  ];
  return values.map(value => value.apiName === overrides.apiName ? { ...value, ...overrides } : value);
}

function buttonContract() {
  return {
    ...constants.buttonContract,
    actionReference: { ...constants.buttonContract.actionReference },
    layoutIds: [...constants.buttonContract.layoutIds],
  };
}

function visitBlueprint() {
  return { ...constants.visitBlueprint };
}

function relationship(rows = [
  { ordinal: 1, stage: constants.eligibleStage },
  { ordinal: 2, stage: 'Payment Awaited' },
  { ordinal: 3, stage: constants.eligibleStage },
]) {
  return {
    availability: 'queryable',
    hasMore: false,
    limitApplied: true,
    linkBasis: 'Exact source lookup relation',
    linkFields: ['Opportunity_Name'],
    orders: rows,
    page: 1,
    perPage: 200,
    relatedModule: 'Deals',
    returned: rows.length,
  };
}

function input(overrides = {}) {
  const relation = overrides.relationship || relationship();
  return {
    buttonContract: buttonContract(),
    contactLayout: 'Standard',
    dealFieldMetadata: dealFields(),
    eligibleAttestations: relation.orders
      .filter(order => order.stage === constants.eligibleStage)
      .map(order => ({ ...order })),
    relationship: relation,
    serviceFieldMetadata: serviceFields(),
    visitBlueprint: visitBlueprint(),
    visitFieldMetadata: visitFields(),
    ...overrides,
  };
}

function expectCode(callback, code) {
  assert.throws(callback, error => {
    assert.equal(error instanceof DeployTeamReadinessPreviewError, true);
    assert.equal(error.code, code);
    assert.equal(error.message, 'Deploy Team readiness preview input is invalid.');
    return true;
  });
}

function assertDeepFrozen(value) {
  if (!value || typeof value !== 'object') return;
  assert.equal(Object.isFrozen(value), true);
  Object.values(value).forEach(assertDeepFrozen);
}

test('freezes the exact Contacts view-button, Standard layout, widget, and no-parent contract', () => {
  assert.deepEqual(constants.buttonContract, {
    action: 'widget',
    actionReference: {
      id: '1032257000022961582',
      name: 'Deploy Team',
      type: 'widget',
    },
    apiName: 'Assign_Visit_for_Installation',
    id: '1032257000022961587',
    layoutIds: ['1032257000000000171'],
    module: 'Contacts',
    name: 'Deploy Team for Installation',
    position: 'view',
    sequenceNumber: 3,
    source: 'crm',
  });
  assert.deepEqual(constants.contactLayout, {
    apiName: 'Standard__s', id: '1032257000000000171', name: 'Standard',
  });
  assert.equal(constants.parentBlueprint, 'not-applicable');
  assertDeepFrozen(constants);
});

test('pins the installation Visit Blueprint entry effect without claiming a parent binding', () => {
  assert.deepEqual(constants.visitBlueprint, {
    blueprintId: '1032257000023456624',
    blueprintName: 'Installation Visit Flow',
    entryField: 'Record_Type',
    entryOperator: 'equal',
    entryValue: 'Installation',
    fromActual: 'Open',
    fromDisplay: 'Open',
    initialState: 'Open',
    module: 'Visit_Module',
    stateField: 'AMS_Status',
    status: 'Active',
    toActual: 'Done',
    toDisplay: 'Done',
    transitionId: '1032257000023456614',
    transitionName: 'Visit Done',
  });
  assert.doesNotMatch(JSON.stringify(constants.visitBlueprint), /parent/i);
});

test('creates a deeply frozen anonymous context from exact complete structural evidence', () => {
  const context = createContext(input());
  assert.equal(context.contactLayout, 'Standard');
  assert.deepEqual(context.eligibleAttestations.map(order => order.ordinal), [1, 3]);
  assert.equal(context.relationship.returned, 3);
  assert.equal(context.visitFieldMetadata.find(item => item.apiName === 'Installation_Manager').optionCount, 13);
  assert.equal(context.visitFieldMetadata.find(item => item.apiName === 'Team_Member_Name').optionCount, 106);
  assertDeepFrozen(context);
  assert.doesNotMatch(JSON.stringify(context.relationship.orders), /Deal_Name|Order_Number|Owner|Email|Mobile|Address/i);
});

test('surfaces the current Client_Address read-only conflict instead of treating it as ready', () => {
  for (const drift of [
    { apiName: 'Client_Address', readOnly: true },
    { apiName: 'Client_Address', fieldReadOnly: true },
    { apiName: 'Client_Address', readOnly: true, fieldReadOnly: true },
  ]) {
    expectCode(() => createContext(input({ visitFieldMetadata: visitFields(drift) })), 'CLIENT_ADDRESS_READ_ONLY_CONFLICT');
  }
});

test('fails closed on Deals metadata, Visit constants, option counts, and linking-field drift', () => {
  expectCode(() => createContext(input({
    dealFieldMetadata: dealFields().map(item => item.apiName === 'Stage' ? { ...item, requiredOptionPresent: false } : item),
  })), 'DEAL_METADATA_INVALID');
  expectCode(() => createContext(input({
    visitFieldMetadata: visitFields({ apiName: 'Record_Type', requiredOptionPresent: false }),
  })), 'VISIT_METADATA_INVALID');
  expectCode(() => createContext(input({
    visitFieldMetadata: visitFields({ apiName: 'Team_Member_Name', optionCount: 0 }),
  })), 'VISIT_OPTIONS_UNAVAILABLE');
  expectCode(() => createContext(input({
    serviceFieldMetadata: serviceFields({ apiName: 'Orders_Name', lookupModule: 'Contacts' }),
  })), 'LINK_METADATA_INVALID');
  expectCode(() => createContext(input({
    serviceFieldMetadata: serviceFields({ apiName: 'Installations_Services', lookupApi: 'Changed' }),
  })), 'LINK_METADATA_INVALID');
});

test('requires the exact active Visit Blueprint entry and Open-to-Done transition', () => {
  for (const [key, value] of [
    ['entryValue', 'Service'],
    ['initialState', 'Pending'],
    ['fromDisplay', 'Pending'],
    ['transitionId', '1032257000023456615'],
    ['toActual', 'Closed'],
  ]) {
    expectCode(() => createContext(input({ visitBlueprint: { ...visitBlueprint(), [key]: value } })), 'VISIT_BLUEPRINT_INVALID');
  }
});

test('requires the exact complete All_Orders envelope and one direct attestation per eligible row', () => {
  for (const drift of [
    { hasMore: true },
    { limitApplied: false },
    { linkFields: ['Contact_Name'] },
    { linkBasis: 'Heuristic' },
    { page: 2 },
    { perPage: 100 },
    { relatedModule: 'Contacts' },
    { returned: 2 },
  ]) {
    const relation = { ...relationship(), ...drift };
    expectCode(() => createContext(input({ relationship: relation })), 'ORDER_RELATIONSHIP_INVALID');
  }
  expectCode(() => createContext(input({ eligibleAttestations: [{ ordinal: 1, stage: constants.eligibleStage }] })), 'ORDER_ATTESTATION_INVALID');
  expectCode(() => createContext(input({ eligibleAttestations: [
    { ordinal: 1, stage: constants.eligibleStage },
    { ordinal: 3, stage: 'Payment Awaited' },
  ] })), 'ORDER_ATTESTATION_INVALID');
});

test('builds a deeply frozen ID-free display plan with anonymous option ordinals only', () => {
  const context = createContext(input());
  const plan = buildPlan({
    context,
    selection: {
      managerOrdinal: 2,
      orderOrdinals: [3, 1],
      taskOrdinal: 4,
      teamOrdinals: [7, 2],
      visitDate: '2026-09-30',
    },
  });
  assert.deepEqual(plan, {
    linkRows: [
      { linkRow: 'Link row 1', order: 'Order 1' },
      { linkRow: 'Link row 2', order: 'Order 3' },
    ],
    notPersisted: true,
    status: 'display-only',
    totals: { eligibleOrders: 2, linkRows: 2, selectedOrders: 2, selectedTeamOptions: 2 },
    unavailable: [
      'Owner identity', 'Permission eligibility', 'Workflow effects', 'Server validation',
      'Atomic Visit and link-row creation',
    ],
    visit: {
      assignedTeamMemberCount: 2,
      initialStage: 'Open',
      managerOption: 'Manager option 2',
      orderOptions: ['Order 1', 'Order 3'],
      recordType: 'Installation',
      scheduledVisitDate: '2026-09-30',
      taskOption: 'Task option 4',
      teamOptions: ['Team option 2', 'Team option 7'],
    },
  });
  assertDeepFrozen(plan);
  const serialized = JSON.stringify(plan);
  assert.doesNotMatch(serialized, /\b\d{19}\b|record_id|contact_id|deal_id|widget_id|button_id|blueprint_id|transition_id/i);
  assert.doesNotMatch(serialized, /client|address|email|mobile|owner name|deal name|order number/i);
});

test('rejects ineligible, duplicate, out-of-range, missing, and invalid-date plan selections', () => {
  const context = createContext(input());
  const selection = {
    managerOrdinal: 1,
    orderOrdinals: [1],
    taskOrdinal: 1,
    teamOrdinals: [1],
    visitDate: '2026-09-30',
  };
  expectCode(() => buildPlan({ context, selection: { ...selection, orderOrdinals: [2] } }), 'ORDER_SELECTION_INVALID');
  expectCode(() => buildPlan({ context, selection: { ...selection, orderOrdinals: [1, 1] } }), 'ORDER_SELECTION_INVALID');
  expectCode(() => buildPlan({ context, selection: { ...selection, managerOrdinal: 14 } }), 'MANAGER_SELECTION_INVALID');
  expectCode(() => buildPlan({ context, selection: { ...selection, taskOrdinal: 20 } }), 'TASK_SELECTION_INVALID');
  expectCode(() => buildPlan({ context, selection: { ...selection, teamOrdinals: [] } }), 'TEAM_SELECTION_INVALID');
  expectCode(() => buildPlan({ context, selection: { ...selection, teamOrdinals: [107] } }), 'TEAM_SELECTION_INVALID');
  expectCode(() => buildPlan({ context, selection: { ...selection, visitDate: '2026-02-30' } }), 'VISIT_DATE_INVALID');
});

test('rejects forged contexts, accessors, symbols, sparse arrays, and inherited inputs', () => {
  const valid = input();
  expectCode(() => createContext({ ...valid, extra: true }), 'CONTEXT_INVALID');
  expectCode(() => createContext(Object.create(valid)), 'CONTEXT_INVALID');
  const accessor = { ...valid };
  Object.defineProperty(accessor, 'contactLayout', { enumerable: true, get: () => 'Standard' });
  expectCode(() => createContext(accessor), 'CONTEXT_INVALID');
  expectCode(() => createContext({ ...valid, [Symbol('x')]: true }), 'CONTEXT_INVALID');
  const sparseOrders = new Array(2);
  sparseOrders[0] = { ordinal: 1, stage: constants.eligibleStage };
  expectCode(() => createContext(input({ relationship: relationship(sparseOrders) })), 'ORDER_RELATIONSHIP_INVALID');
  const context = createContext(valid);
  expectCode(() => buildPlan({
    context: { ...context },
    selection: { managerOrdinal: 1, orderOrdinals: [1], taskOrdinal: 1, teamOrdinals: [1], visitDate: '2026-09-30' },
  }), 'CONTEXT_INVALID');
});

test('publishes one frozen browser namespace and has no SDK, transport, storage, file, or logging primitives', () => {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(engineSource, sandbox);
  assert.equal(typeof sandbox.DeployTeamReadinessPreview.createContext, 'function');
  assert.equal(Object.isFrozen(sandbox.DeployTeamReadinessPreview), true);
  assert.throws(() => vm.runInNewContext(engineSource, sandbox), /namespace is unavailable/);
  for (const pattern of [
    /https?:\/\//i,
    /\bfetch\b|XMLHttpRequest|WebSocket|EventSource|sendBeacon/i,
    /\b(?:ZOHO|ZDK)\b/i,
    /\.(?:insertRecord|updateRecord|deleteRecord|addNotes?|attachFile|uploadFile|proceed)\s*\(/i,
    /\b(?:localStorage|sessionStorage|indexedDB|clipboard)\b/i,
    /\b(?:FormData|FileReader|Blob)\b|\.type\s*=\s*['"]file['"]/i,
    /\bconsole\s*\./i,
  ]) assert.doesNotMatch(engineSource, pattern);
});
