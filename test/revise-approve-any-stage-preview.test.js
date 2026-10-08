'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const enginePath = path.resolve(__dirname, '..', 'public', 'revise-approve-any-stage-preview.js');
const corePath = path.resolve(__dirname, '..', 'public', 'revise-quote-preview.js');
const engineSource = fs.readFileSync(enginePath, 'utf8');
const coreSource = fs.readFileSync(corePath, 'utf8');
const blueprintConfig = require('../config/blueprints.json');
const reviseCore = require('../public/revise-quote-preview');
const {
  ReviseApproveAnyStagePreviewError,
  buildPlan,
  constants,
  createContext,
} = require('../public/revise-approve-any-stage-preview');

const PRESENTATIONS = Object.freeze([
  'Kitchen 3D', 'Kitchen L & F', 'Kitchen L & F + EST', 'Kitchen EST', 'Kitchen 3D + EST',
  'Wardrobe 3D', 'Wardrobe L & F', 'Wardrobe L & F + EST', 'Wardrobe EST', 'Wardrobe 3D + EST',
  'Sunrooof 3D', 'Sunrooof L & F', 'Sunrooof L & F + EST', 'Sunrooof EST', 'Sunrooof 3D + EST',
  'Laundry Area 3D', 'Laundry Area L & F', 'Laundry Area L & F + EST', 'Laundry Area EST', 'Laundry Area 3D + EST',
  'Pantry / Utility 3D', 'Pantry / Utility L & F', 'Pantry / Utility L & F + EST', 'Pantry / Utility EST', 'Pantry / Utility 3D + EST',
]);
const THEMES = Object.freeze([
  'Modern PG1', 'Modern PG2', 'Classic PG1', 'Classic PG2',
  'Classical White', 'Classical Wood - Teak', 'Classical Wood - Raw', 'Modern Wooden - Teak',
  'Modern Wooden - Raw', 'Modern White', 'Modern Bronze', 'Modern Grey',
  'Fluted Minimalist Wooden - Teak', 'Fluted Minimalist Wooden - Raw', 'Fluted Minimalist White',
  'Fluted Minimalist Grey', 'Fluted Minimalist Bronze', 'French Window White', 'Louvered Window White',
  'Classical Atrium White', 'Classical Atrium Wooden - Teak', 'Classical Atrium Wooden - Raw',
  'Fluted Minimalist Atrium Wooden - Teak', 'Fluted Minimalist Atrium Wooden - Raw',
  'Fluted Minimalist Atrium White', 'Fluted Minimalist Atrium Bronze', 'Fluted Minimalist Atrium Grey',
  'Arch Window White', 'Double Arch Window White',
]);
const REASONS = Object.freeze([
  'New Items to be added', 'Budget to be reduced', 'Requirements were not clear', 'Layout was incomplete',
  'Civil sizes changed later', 'Decision maker changed', 'Vaastu Issue', 'Design is not as per brief',
  'Immpractial design', 'Estimate Error', 'Price List Revised', 'Product discontinued',
  'Add newly launched product', 'Appliance/ Accessory missing', 'Design Manager changed',
  'Incomplete breif shared to designer', 'Special approval - Management', 'Sales manager changed',
]);

function metadata(apiName, dataType, options = []) {
  return { apiName, dataType, options };
}

function contactMetadata() {
  return [metadata('Stage', 'picklist', ['Design Form Filled', 'Assigned Designer'])];
}

function dealMetadata() {
  return [
    metadata('Stage', 'picklist', ['Sent for Approval', 'None', 'Assign Designer', 'Query to SM', 'Requirement From SM', 'Price Discussion']),
    metadata('Product_Type', 'picklist', [...reviseCore.constants.productTypes, 'Vanity']),
    metadata('Design_Presentation', 'picklist', [...PRESENTATIONS, 'NA']),
    metadata('Design_Theme', 'picklist', [...THEMES, 'NA']),
    metadata('Finished_Kitchen_Ceiling_Height', 'textarea'),
    metadata('Design_Required_on', 'date'),
    metadata('Reason_for_Design_Revision1', 'picklist', [...REASONS, 'Client changed requirement']),
    metadata('Any_Vastu_requirement', 'picklist', ['Yes', 'No', 'North']),
    metadata('Gas_Arrangement', 'picklist', [...reviseCore.constants.gasOptions, 'Not Applicable']),
    metadata('Kitchen_Type', 'multiselectpicklist', [...reviseCore.constants.kitchenTypes]),
    metadata('Kitche_Height', 'picklist', [...reviseCore.constants.kitchenHeights]),
    metadata('Island', 'picklist', [...reviseCore.constants.islandOptions, 'Yes']),
    metadata('Wardrobe_Type', 'multiselectpicklist', [...reviseCore.constants.wardrobeTypes]),
    metadata('Wardrobe_Height', 'picklist', [...reviseCore.constants.wardrobeHeights, 'Option 1']),
  ];
}

function relation(rows = [
  { ordinal: 1, productType: 'Kitchen', stage: 'Sent for Approval' },
  { ordinal: 2, productType: 'SUNROOOF', stage: 'None' },
  { ordinal: 3, productType: 'Wardrobe', stage: 'Sent for Approval' },
  { ordinal: 4, productType: 'Kitchen', stage: 'Query to SM' },
  { ordinal: 5, productType: 'Pantry', stage: 'Price Discussion' },
  { ordinal: 6, productType: 'Kitchen', stage: 'Requirement From SM' },
  { ordinal: 7, productType: 'Wardrobe', stage: 'Assign Designer' },
  { ordinal: 8, productType: '', stage: '' },
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

function buttonContract() {
  return {
    ...constants.buttonContract,
    actionReference: { ...constants.buttonContract.actionReference },
    layoutIds: [...constants.buttonContract.layoutIds],
  };
}

function childTransitionContract() {
  return {
    ...constants.childBlueprintContract,
    transitions: constants.childBlueprintContract.transitions.map(transition => ({ ...transition })),
  };
}

function context(overrides = {}) {
  return createContext({
    buttonContract: buttonContract(),
    childTransitionContract: childTransitionContract(),
    contactFieldMetadata: contactMetadata(),
    contactLayoutId: constants.buttonContract.layoutIds[0],
    dealFieldMetadata: dealMetadata(),
    relationship: relation(),
    ...overrides,
  });
}

function emptyOrder(ordinal, action = 'Skip') {
  return {
    action,
    ceilingHeight: '',
    designRequiredOn: '',
    designTheme: '',
    gas: '',
    island: '',
    kitchenHeight: '',
    kitchenTypes: [],
    ordinal,
    presentation: '',
    reason: '',
    vastu: '',
    wardrobeHeight: '',
    wardrobeTypes: [],
  };
}

function kitchenOrder(ordinal = 1, overrides = {}) {
  return {
    ...emptyOrder(ordinal, 'Revise Quotes'),
    ceilingHeight: '2700 mm',
    designRequiredOn: '2026-09-15',
    designTheme: 'Modern PG1',
    gas: 'Piped Gas',
    island: 'Both Side Storage',
    kitchenHeight: '2500',
    kitchenTypes: ['Chef', 'Utility'],
    presentation: 'Kitchen 3D',
    reason: 'Budget to be reduced',
    vastu: 'Yes',
    ...overrides,
  };
}

function wardrobeOrder(ordinal = 3, overrides = {}) {
  return {
    ...emptyOrder(ordinal, 'Approved Quote'),
    ceilingHeight: '2600',
    designRequiredOn: '2028-02-29',
    designTheme: 'Classic PG1',
    presentation: 'Wardrobe 3D',
    wardrobeHeight: '9',
    wardrobeTypes: ['Glass Hinged'],
    ...overrides,
  };
}

function expectCode(callback, code) {
  assert.throws(callback, error => {
    assert.equal(error instanceof ReviseApproveAnyStagePreviewError, true);
    assert.equal(error.code, code);
    assert.equal(error.message, 'Revise-Approve preview input is invalid.');
    return true;
  });
}

function assertDeepFrozen(value) {
  if (!value || typeof value !== 'object') return;
  assert.equal(Object.isFrozen(value), true);
  Object.values(value).forEach(assertDeepFrozen);
}

test('freezes the exact view-button, two-layout, widget, and no-parent contract', () => {
  assert.deepEqual(constants.buttonContract, {
    action: 'widget',
    actionReference: {
      id: '1032257000017358913',
      name: 'Revise-Approve Quote-Any Stage',
      type: 'widget',
    },
    apiName: 'Revise_Approve_Quote',
    id: '1032257000017358923',
    layoutIds: ['1032257000000000171', '1032257000005515301'],
    module: 'Contacts',
    name: 'Revise-Approve Quote',
    position: 'view',
    sequenceNumber: 2,
    source: 'crm',
  });
  assert.deepEqual(constants.actions, ['Skip', 'Revise Quotes', 'Approved Quote']);
  assert.equal(constants.parentBlueprint, 'not-applicable');
  assert.equal(Object.prototype.hasOwnProperty.call(constants, 'parentContract'), false);
  assertDeepFrozen(constants);
});

test('reuses only the exact source-attested child transition contract', () => {
  assert.deepEqual(constants.childBlueprintContract, reviseCore.constants.childBlueprintContract);
  const sourceBlueprint = blueprintConfig.blueprints.find(item => String(item.id) === constants.childBlueprintContract.blueprintId);
  assert.equal(sourceBlueprint?.name, 'Order Stages');
  assert.equal(sourceBlueprint?.module, 'Deals');
  assert.equal(sourceBlueprint?.state_field, 'Stage');
  assert.equal(String(sourceBlueprint?.layout?.id || ''), '1032257000000000173');
  constants.childBlueprintContract.transitions.forEach(expected => {
    const source = sourceBlueprint?.transitions.find(item => String(item.id) === expected.id);
    assert.equal(source?.name, expected.name);
    assert.equal(source?.from?.display_value, 'Sent for Approval');
    assert.equal(source?.from?.actual_value, 'Sent for Approval');
    assert.equal(source?.to?.display_value, expected.toDisplay);
    assert.equal(source?.to?.actual_value, expected.toActual);
    assert.equal(source?.global, expected.common);
  });
});

test('accepts exactly the two registered Contact layouts and rejects every other layout', () => {
  constants.buttonContract.layoutIds.forEach(contactLayoutId => {
    const previewContext = context({ contactLayoutId });
    assert.equal(previewContext.parentBlueprint, 'not-applicable');
    assert.equal(previewContext.orders.length, 2);
  });
  for (const contactLayoutId of ['', '1032257000000000173', '1032257000005515302']) {
    expectCode(() => context({ contactLayoutId }), 'CONTACT_LAYOUT_INVALID');
  }
});

test('makes every non-Sent for Approval row explicitly blocked and never ignored', () => {
  const previewContext = context();
  assert.deepEqual(previewContext.orders.map(order => [order.label, order.productType, order.stage]), [
    ['Order 1', 'Kitchen', 'Sent for Approval'],
    ['Order 3', 'Wardrobe', 'Sent for Approval'],
  ]);
  assert.deepEqual(previewContext.blockedOrders.map(order => [order.order_label, order.product_type, order.source_stage, order.reason]), [
    ['Order 2', 'SUNROOOF', 'None', 'stage-not-sent-for-approval'],
    ['Order 4', 'Kitchen', 'Query to SM', 'stage-not-sent-for-approval'],
    ['Order 5', 'Pantry', 'Price Discussion', 'stage-not-sent-for-approval'],
    ['Order 6', 'Kitchen', 'Requirement From SM', 'stage-not-sent-for-approval'],
    ['Order 7', 'Wardrobe', 'Assign Designer', 'stage-not-sent-for-approval'],
    ['Order 8', 'Not set', 'Not set', 'stage-not-sent-for-approval'],
  ]);
  assert.equal(previewContext.ignoredOrders, 0);
  assert.deepEqual(previewContext.relationshipCounts, { blocked: 6, eligible: 2, total: 8 });
  assertDeepFrozen(previewContext);
  assert.doesNotMatch(JSON.stringify(previewContext), /\b\d{19}\b|Deal_Name|Contact_Name|Owner|Email|Phone|Mobile|Note|File/i);
});

test('builds anonymous deeply frozen plans without IDs or a parent Blueprint claim', () => {
  const previewContext = context();
  const draft = buildPlan({ context: previewContext, orders: [kitchenOrder(), wardrobeOrder()] });
  assert.equal(draft.preview_only, true);
  assert.equal(draft.persistence, 'disabled');
  assert.equal(draft.source_execution, 'disabled');
  assert.equal(draft.parent_blueprint, 'not-applicable');
  assert.equal(draft.ignored_orders, 0);
  assert.deepEqual(draft.plans.map(plan => [
    plan.order_label,
    plan.product_type,
    plan.source_stage,
    plan.decision,
    plan.intended_transition,
    plan.execution,
  ]), [
    ['Order 1', 'Kitchen', 'Sent for Approval', 'Revise Quotes', { name: 'Revision Required' }, 'disabled'],
    ['Order 3', 'Wardrobe', 'Sent for Approval', 'Approved Quote', { name: 'Design Approved' }, 'disabled'],
  ]);
  assert.equal(draft.plans[0].fields.Reason_for_Design_Revision1, 'Budget to be reduced');
  assert.equal(Object.prototype.hasOwnProperty.call(draft.plans[1].fields, 'Reason_for_Design_Revision1'), false);
  assert.deepEqual(draft.totals, { blocked_orders: 6, eligible_orders: 2, planned_orders: 2, skipped_orders: 0 });
  assert.deepEqual(draft.blocked_orders, previewContext.blockedOrders);
  assertDeepFrozen(draft);
  const serialized = JSON.stringify(draft);
  assert.doesNotMatch(serialized, /\b\d{19}\b|blueprint_id|transition_id|widget_id|button_id|record_id/i);
  assert.doesNotMatch(serialized, /Deal_Name|Contact_Name|Owner|Email|Phone|Mobile|Note_Content|File_Name/i);
});

test('preserves Skip, Revise Quotes, and Approved Quote semantics from the reviewed core', () => {
  const previewContext = context();
  const skipped = buildPlan({ context: previewContext, orders: [emptyOrder(1), wardrobeOrder()] });
  assert.equal(skipped.skipped_orders, 1);
  assert.equal(skipped.plans.length, 1);
  assert.equal(skipped.plans[0].decision, 'Approved Quote');

  expectCode(() => buildPlan({ context: previewContext, orders: [emptyOrder(1), emptyOrder(3)] }), 'PLAN_REQUIRED');
  expectCode(() => buildPlan({ context: previewContext, orders: [kitchenOrder(1, { reason: '' }), emptyOrder(3)] }), 'REVISION_REASON_REQUIRED');
  expectCode(() => buildPlan({ context: previewContext, orders: [kitchenOrder(1, { designRequiredOn: '2027-02-29' }), emptyOrder(3)] }), 'DESIGN_DATE_INVALID');
  expectCode(() => buildPlan({ context: previewContext, orders: [kitchenOrder(1, { action: 'Delete' }), emptyOrder(3)] }), 'ACTION_INVALID');
  expectCode(() => buildPlan({ context: previewContext, orders: [kitchenOrder(), wardrobeOrder(3, { reason: 'Budget to be reduced' })] }), 'APPROVAL_REVISION_DATA_FORBIDDEN');
});

test('supports an all-blocked context but refuses to generate an empty plan', () => {
  const previewContext = context({
    relationship: relation([
      { ordinal: 1, productType: 'Kitchen', stage: 'None' },
      { ordinal: 2, productType: 'Wardrobe', stage: 'Price Discussion' },
    ]),
  });
  assert.equal(previewContext.orders.length, 0);
  assert.equal(previewContext.blockedOrders.length, 2);
  assert.equal(previewContext.ignoredOrders, 0);
  expectCode(() => buildPlan({ context: previewContext, orders: [] }), 'PLAN_REQUIRED');
});

test('fails closed on button, widget, layout-list, and child-contract drift', () => {
  for (const [key, value] of [
    ['id', '1032257000017358924'],
    ['name', 'Revise Quote'],
    ['apiName', 'Revise_Quote'],
    ['position', 'list_view'],
    ['action', 'custom_function'],
    ['source', 'external'],
    ['sequenceNumber', 1],
  ]) {
    expectCode(() => context({ buttonContract: { ...buttonContract(), [key]: value } }), 'BUTTON_CONTRACT_DRIFT');
  }
  expectCode(() => context({
    buttonContract: { ...buttonContract(), actionReference: { ...buttonContract().actionReference, id: '1032257000017358914' } },
  }), 'BUTTON_CONTRACT_DRIFT');
  expectCode(() => context({
    buttonContract: { ...buttonContract(), layoutIds: [...buttonContract().layoutIds].reverse() },
  }), 'BUTTON_CONTRACT_DRIFT');
  expectCode(() => context({
    childTransitionContract: { ...childTransitionContract(), blueprintName: 'Other' },
  }), 'CHILD_TRANSITION_CONTRACT_DRIFT');
});

test('requires exact complete anonymous All_Orders relationship evidence', () => {
  for (const patch of [
    { availability: 'unavailable' },
    { relatedModule: 'Contacts' },
    { linkBasis: 'Fallback' },
    { linkFields: ['Opportunity'] },
    { page: 2 },
    { perPage: 100 },
    { limitApplied: false },
    { hasMore: true },
    { returned: 7 },
  ]) expectCode(() => context({ relationship: { ...relation(), ...patch } }), 'RELATIONSHIP_INVALID');
  expectCode(() => context({
    relationship: relation([{ ordinal: 1, productType: 'Kitchen', stage: 'Sent for Approval', id: 'forbidden' }]),
  }), 'ORDER_DESCRIPTOR_INVALID');
  const sparse = new Array(2);
  sparse[0] = { ordinal: 1, productType: 'Kitchen', stage: 'Sent for Approval' };
  expectCode(() => context({ relationship: relation(sparse) }), 'RELATIONSHIP_INVALID');
});

test('rejects symbols, accessors, prototypes, forged contexts, and context-swap proxies', () => {
  const symbolic = {
    context: context(),
    orders: [kitchenOrder(), wardrobeOrder()],
  };
  symbolic[Symbol('hidden')] = true;
  expectCode(() => buildPlan(symbolic), 'INPUT_INVALID');

  const accessor = { orders: [kitchenOrder(), wardrobeOrder()] };
  Object.defineProperty(accessor, 'context', { enumerable: true, get: () => context() });
  expectCode(() => buildPlan(accessor), 'INPUT_INVALID');

  class ExpandedInput {
    constructor(previewContext) {
      this.context = previewContext;
      this.orders = [kitchenOrder(), wardrobeOrder()];
    }
  }
  expectCode(() => buildPlan(new ExpandedInput(context())), 'INPUT_INVALID');

  const genuine = context();
  expectCode(() => buildPlan({ context: Object.freeze({ ...genuine }), orders: [kitchenOrder(), wardrobeOrder()] }), 'CONTEXT_INVALID');
  expectCode(() => buildPlan({ context: new Proxy(genuine, {}), orders: [kitchenOrder(), wardrobeOrder()] }), 'CONTEXT_INVALID');

  let reads = 0;
  const target = { context: genuine, orders: [kitchenOrder(), wardrobeOrder()] };
  const swapping = new Proxy(target, {
    get(object, key, receiver) {
      reads += 1;
      return Reflect.get(object, key, receiver);
    },
  });
  const draft = buildPlan(swapping);
  assert.equal(reads, 0);
  assert.equal(draft.plans.length, 2);
});

test('snapshots mutable source rows and never changes eligibility after context creation', () => {
  const rawRelationship = relation();
  const previewContext = context({ relationship: rawRelationship });
  rawRelationship.orders[0].stage = 'Price Discussion';
  rawRelationship.orders[1].stage = 'Sent for Approval';
  rawRelationship.orders[2].productType = 'Kitchen';
  assert.deepEqual(previewContext.orders.map(order => [order.ordinal, order.productType]), [[1, 'Kitchen'], [3, 'Wardrobe']]);
  assert.equal(previewContext.blockedOrders[0].order_label, 'Order 2');
  assert.equal(previewContext.blockedOrders[0].source_stage, 'None');
});

test('publishes one frozen browser namespace only after the frozen Revise Quote dependency', () => {
  const missing = { globalThis: null };
  missing.globalThis = missing;
  assert.throws(() => vm.runInNewContext(engineSource, missing, { filename: enginePath }), /dependency is unavailable/i);

  const browser = { globalThis: null };
  browser.globalThis = browser;
  vm.runInNewContext(coreSource, browser, { filename: corePath });
  vm.runInNewContext(engineSource, browser, { filename: enginePath });
  assert.equal(typeof browser.ReviseApproveAnyStagePreview.createContext, 'function');
  assert.equal(typeof browser.ReviseApproveAnyStagePreview.buildPlan, 'function');
  assert.equal(Object.isFrozen(browser.ReviseApproveAnyStagePreview), true);
  const descriptor = Object.getOwnPropertyDescriptor(browser, 'ReviseApproveAnyStagePreview');
  assert.equal(descriptor.writable, false);
  assert.equal(descriptor.configurable, false);
  assert.throws(() => vm.runInNewContext(engineSource, browser, { filename: enginePath }), /namespace is unavailable/i);
});

test('engine exposes no network, write, provider, storage, logging, file, or captured-source execution path', () => {
  for (const pattern of [
    /https?:\/\//i,
    /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|postMessage)\b/,
    /\b(?:localStorage|sessionStorage|indexedDB|document\.cookie|clipboard)\b/,
    /\b(?:FileReader|Blob|FormData|attachFile|addNotes)\b/,
    /\bZOHO\b|\.CRM\b|updateBluePrint|updateRecord|BLUEPRINT\.proceed/,
    /\bconsole\.(?:log|warn|error|info|debug)\b/,
    /\b(?:setTimeout|setInterval)\b/,
    /\beval\s*\(|\bFunction\s*\(/,
    /password|authorization|bearer\s+|api[_-]?key|client[_-]?secret|access[_-]?token/i,
  ]) assert.doesNotMatch(engineSource, pattern);
});
