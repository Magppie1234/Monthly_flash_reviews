'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const enginePath = path.resolve(__dirname, '..', 'public', 'closure-new-preview.js');
const engineSource = fs.readFileSync(enginePath, 'utf8');
const {
  ClosureNewPreviewError,
  buildPlan,
  constants,
  createContext,
} = require('../public/closure-new-preview');

const field = (apiName, dataType, options = []) => ({ apiName, dataType, options });
const childAttestation = ordinal => ({
  afterActionCount: 0,
  common: true,
  criteriaCount: 0,
  current: 'Payment Awaited',
  duringInputCount: 1,
  executable: false,
  fromActual: 'Payment Awaited',
  fromDisplay: 'Payment Awaited',
  layout: 'Standard',
  local: true,
  nextActual: 'Closure',
  nextDisplay: 'Closure',
  ordinal,
  owner: 'Specific Users (1)',
  process: 'Order Stages',
  requiredField: 'Est_Handover_Date',
  stateField: 'Stage',
  transition: 'Closure',
  triggerType: 'manual',
});

function baseContextInput() {
  return {
    childBlueprintAttestations: [childAttestation(1), childAttestation(3)],
    contactFieldMetadata: [field('Stage', 'picklist', ['Principally Closed', 'Payment Awaited', 'Closure', 'Principally Closure'])],
    dealFieldMetadata: [
      field('Stage', 'picklist', ['Payment Awaited', 'Closure', 'Sent for Approval']),
      field('Product_Type', 'picklist', ['Kitchen', 'Wardrobe', 'Pantry', 'Countertop / Backplash', 'Vanity', 'SUNROOOF']),
      field('Opportunity_Name', 'lookup'),
      field('Est_Handover_Date', 'date'),
    ],
    dealLayout: {
      activeLayoutIds: ['1032257000000000173'],
      resolution: 'only_active_layout',
      resolvedId: '1032257000000000173',
    },
    milestonesRelationship: {
      availability: 'queryable',
      hasMore: false,
      limitApplied: true,
      linkBasis: 'Exact source lookup relation',
      linkFields: ['Opportunity_Name'],
      milestones: [
        {
          amountReceived: null,
          amountReceivedDate: '',
          managementDiscount: null,
          milestoneName: 'Dispatch Payment',
          ordinal: 1,
          percentage: 20,
          serialNumber: 4,
        },
        {
          amountReceived: null,
          amountReceivedDate: '',
          managementDiscount: null,
          milestoneName: 'Production Payment',
          ordinal: 2,
          percentage: 30,
          serialNumber: 3,
        },
        {
          amountReceived: null,
          amountReceivedDate: '',
          managementDiscount: null,
          milestoneName: 'Order Booking Payment',
          ordinal: 3,
          percentage: 50,
          serialNumber: 2,
        },
        {
          amountReceived: null,
          amountReceivedDate: '',
          managementDiscount: 100,
          milestoneName: 'Order Booking Sunroof Milestone',
          ordinal: 4,
          percentage: 50,
          serialNumber: 1,
        },
      ],
      page: 1,
      perPage: 200,
      relatedModule: 'Payment_Milestones',
      returned: 4,
    },
    ordersRelationship: {
      availability: 'queryable',
      hasMore: false,
      limitApplied: true,
      linkBasis: 'Exact source lookup relation',
      linkFields: ['Opportunity_Name'],
      orders: [
        { ordinal: 1, productType: 'Wardrobe', stage: 'Payment Awaited' },
        { ordinal: 2, productType: 'SUNROOOF', stage: 'Payment Awaited' },
        { ordinal: 3, productType: 'Kitchen', stage: 'Payment Awaited' },
        { ordinal: 4, productType: 'Pantry', stage: 'Closure' },
      ],
      page: 1,
      perPage: 200,
      relatedModule: 'Deals',
      returned: 4,
    },
    parent: { layoutId: '1032257000000000171', stage: 'Principally Closed' },
    paymentFieldMetadata: [
      field('Opportunity_Name', 'lookup'),
      field('Milestone_Number', 'text'),
      field('Serial_Number', 'integer'),
      field('Percentage', 'percent'),
      field('Amount_Received_Now', 'currency'),
      field('Management_Discount_Proposed', 'currency'),
      field('Amount_Received_Date', 'date'),
      field('Reference_No', 'text'),
    ],
  };
}

function planInput(context) {
  return {
    context,
    estimatedHandoverDate: '2026-09-15',
    milestones: context.milestones.map(row => ({
      amountReceived: row.amountReceived,
      amountReceivedDate: row.amountReceivedDate,
      managementDiscount: row.managementDiscount,
      ordinal: row.ordinal,
      percentage: row.percentage,
    })),
    selectedOrderOrdinals: [1, 3],
  };
}

function expectCode(fn, code, details = undefined) {
  assert.throws(fn, error => {
    assert.equal(error instanceof ClosureNewPreviewError, true);
    assert.equal(error.code, code);
    assert.equal(error.message, 'Closure New preview input is invalid.');
    if (details !== undefined) assert.deepEqual(error.details, details);
    return true;
  });
}

function assertDeepFrozen(value) {
  if (!value || typeof value !== 'object') return;
  assert.equal(Object.isFrozen(value), true);
  Object.values(value).forEach(assertDeepFrozen);
}

test('freezes the exact parent, common child, and blocked SUNROOOF contracts', () => {
  assert.deepEqual(constants.parentContract, {
    module: 'Contacts',
    layoutId: '1032257000000000171',
    layoutName: 'Standard',
    blueprintId: '1032257000001044611',
    blueprintName: 'Opportunity Stage',
    stateField: 'Stage',
    currentDisplay: 'Principally Closed',
    currentActual: 'Payment Awaited',
    transitionId: '1032257000025407204',
    transitionName: 'Closure New - Pinki',
    relationshipId: '1032257000025407206',
    nextDisplay: 'Closure',
    nextActual: 'Principally Closure',
    widgetId: '1032257000025407208',
    widgetName: 'Closure New - Pinki',
  });
  assert.equal(constants.childContract.transitionId, '1032257000000535729');
  assert.equal(constants.childContract.requiredField, 'Est_Handover_Date');
  assert.equal(constants.blockedSunrooofContract.transitionId, '1032257000021717028');
  assert.equal(constants.blockedSunrooofContract.afterActionId, '1032257000021717034');
  assertDeepFrozen(constants);
});

test('creates an anonymous context with exact complete relationships and deterministic layout resolution', () => {
  const context = createContext(baseContextInput());
  assert.deepEqual(context.orders.map(order => order.label), ['Order 1', 'Order 3']);
  assert.deepEqual(context.orders.map(order => order.productType), ['Wardrobe', 'Kitchen']);
  assert.deepEqual(context.blockedOrders.map(order => [order.label, order.reason]), [
    ['Order 2', 'criteria-and-after-action-unavailable'],
    ['Order 4', 'stage-not-payment-awaited'],
  ]);
  assert.deepEqual(context.milestones.map(row => [row.label, row.serialNumber, row.classification, row.detailAllowed]), [
    ['Milestone 1', 1, 'Sunroof', true],
    ['Milestone 2', 2, 'Magppie', true],
    ['Milestone 3', 3, 'Magppie', false],
    ['Milestone 4', 4, 'Magppie', false],
  ]);
  assert.deepEqual(context.dealLayout, {
    activeLayoutIds: ['1032257000000000173'],
    resolution: 'only_active_layout',
    resolvedId: '1032257000000000173',
  });
  assert.deepEqual(context.childBlueprintAttestations, [
    { ordinal: 1, verified: true },
    { ordinal: 3, verified: true },
  ]);
  assertDeepFrozen(context);
  assert.doesNotMatch(JSON.stringify(context), /Deal_Name|Contact_Name|Owner|Email|Phone|Mobile|milestoneName|referenceNumber|\"id\"/i);
});

test('builds frozen display-only milestone and common Closure plans without IDs', () => {
  const context = createContext(baseContextInput());
  const input = planInput(context);
  input.milestones[0] = {
    ...input.milestones[0],
    amountReceived: 250000,
    amountReceivedDate: '2026-09-01',
    managementDiscount: 100,
  };
  input.milestones[1] = {
    ...input.milestones[1],
    amountReceived: 500000,
    amountReceivedDate: '2026-09-02',
    managementDiscount: 0,
  };
  const plan = buildPlan(input);
  assert.equal(plan.preview_only, true);
  assert.equal(plan.persistence, 'disabled');
  assert.deepEqual(plan.totals, {
    blocked_orders: 2,
    magppie_percentage: 100,
    milestone_plans: 4,
    selected_orders: 2,
  });
  assert.deepEqual(plan.order_plans.map(row => [row.order_label, row.product_type, row.source_stage, row.intended_transition.name]), [
    ['Order 1', 'Wardrobe', 'Payment Awaited', 'Closure'],
    ['Order 3', 'Kitchen', 'Payment Awaited', 'Closure'],
  ]);
  assert.deepEqual(plan.order_plans[0].fields, { Est_Handover_Date: '2026-09-15' });
  assert.deepEqual(plan.milestone_plans[0].fields, {
    Percentage: 50,
    Amount_Received_Now: 250000,
    Management_Discount_Proposed: 100,
    Amount_Received_Date: '2026-09-01',
  });
  assert.deepEqual(plan.milestone_plans[2].fields, { Percentage: 30 });
  assert.equal(plan.parent_transition.continuation, 'disabled');
  assert.equal(plan.parent_transition.permissions, 'not evaluated');
  assert.equal(plan.order_plans[0].runtime_attestation, 'verified-read-only');
  assertDeepFrozen(plan);
  assert.doesNotMatch(JSON.stringify(plan), /\b\d{19}\b/);
  assert.doesNotMatch(JSON.stringify(plan), /record_id|transition_id|widget_id|owner|identity|milestone_name|Reference_No/i);
});

test('requires the exact parent display stage and stored Standard layout', () => {
  for (const [key, value, code] of [
    ['stage', 'Payment Awaited', 'PARENT_STAGE_INVALID'],
    ['layoutId', '1032257000005515301', 'PARENT_LAYOUT_INVALID'],
  ]) {
    const raw = baseContextInput();
    raw.parent[key] = value;
    expectCode(() => createContext(raw), code);
  }
});

test('requires exact current display and actual stage metadata', () => {
  const missingActual = baseContextInput();
  missingActual.contactFieldMetadata[0].options = ['Principally Closed', 'Closure'];
  expectCode(() => createContext(missingActual), 'PARENT_STAGE_METADATA_DRIFT');

  const missingProduct = baseContextInput();
  missingProduct.dealFieldMetadata.find(item => item.apiName === 'Product_Type').options = ['Kitchen', 'Wardrobe', 'SUNROOOF'];
  expectCode(() => createContext(missingProduct), 'DEAL_METADATA_DRIFT');
});

test('requires only-active-layout resolution for the exact Deals Standard layout', () => {
  for (const mutate of [
    raw => { raw.dealLayout.activeLayoutIds.push('1032257000000000174'); },
    raw => { raw.dealLayout.resolution = 'stored_layout'; },
    raw => { raw.dealLayout.resolvedId = '1032257000000000174'; },
  ]) {
    const raw = baseContextInput();
    mutate(raw);
    expectCode(() => createContext(raw), 'DEAL_LAYOUT_INVALID');
  }
});

test('requires exact ordinal-only runtime child Blueprint attestations for every supported order', () => {
  const missing = baseContextInput();
  missing.childBlueprintAttestations.pop();
  expectCode(() => createContext(missing), 'CHILD_BLUEPRINT_ATTESTATION_INVALID');

  const reordered = baseContextInput();
  reordered.childBlueprintAttestations.reverse();
  expectCode(() => createContext(reordered), 'CHILD_BLUEPRINT_ATTESTATION_INVALID');

  for (const [key, value] of [
    ['process', 'Other Process'],
    ['layout', 'Other Layout'],
    ['current', 'Closure'],
    ['transition', 'Other Transition'],
    ['common', false],
    ['triggerType', 'automatic'],
    ['fromActual', 'Price Discussion'],
    ['fromDisplay', 'Price Discussion'],
    ['nextActual', 'Closed Won'],
    ['nextDisplay', 'Closed Won'],
    ['owner', 'Record Owner'],
    ['requiredField', 'Other_Field'],
    ['afterActionCount', 1],
    ['criteriaCount', 1],
    ['duringInputCount', 2],
    ['executable', true],
    ['local', false],
  ]) {
    const raw = baseContextInput();
    raw.childBlueprintAttestations[0][key] = value;
    expectCode(() => createContext(raw), 'CHILD_BLUEPRINT_ATTESTATION_INVALID');
  }

  const leakedId = baseContextInput();
  leakedId.childBlueprintAttestations[0].transitionId = '1032257000000535729';
  expectCode(() => createContext(leakedId), 'CHILD_BLUEPRINT_ATTESTATION_INVALID');
});

test('fails closed on relationship aliasing, truncation, pagination, and count drift', () => {
  for (const [target, key, value, code] of [
    ['ordersRelationship', 'availability', 'unresolved', 'ORDER_RELATIONSHIP_INVALID'],
    ['ordersRelationship', 'relatedModule', 'Contacts', 'ORDER_RELATIONSHIP_INVALID'],
    ['ordersRelationship', 'linkBasis', 'Fallback relation', 'ORDER_RELATIONSHIP_INVALID'],
    ['ordersRelationship', 'hasMore', true, 'ORDER_RELATIONSHIP_INVALID'],
    ['ordersRelationship', 'page', 2, 'ORDER_RELATIONSHIP_INVALID'],
    ['milestonesRelationship', 'perPage', 100, 'MILESTONE_RELATIONSHIP_INVALID'],
    ['milestonesRelationship', 'returned', 3, 'MILESTONE_RELATIONSHIP_INVALID'],
  ]) {
    const raw = baseContextInput();
    raw[target][key] = value;
    expectCode(() => createContext(raw), code);
  }
  const wrongLink = baseContextInput();
  wrongLink.ordersRelationship.linkFields = ['Opportunity'];
  expectCode(() => createContext(wrongLink), 'ORDER_RELATIONSHIP_INVALID');
});

test('rejects sparse arrays, symbol properties, accessors, and duplicate order ordinals', () => {
  const sparse = baseContextInput();
  sparse.ordersRelationship.orders = new Array(2);
  sparse.ordersRelationship.returned = 2;
  expectCode(() => createContext(sparse), 'ORDER_RELATIONSHIP_INVALID');

  const symbol = baseContextInput();
  symbol.ordersRelationship.orders[0][Symbol('hidden')] = true;
  expectCode(() => createContext(symbol), 'ORDER_DESCRIPTOR_INVALID');

  const accessor = baseContextInput();
  Object.defineProperty(accessor.parent, 'stage', { enumerable: true, get: () => 'Principally Closed' });
  expectCode(() => createContext(accessor), 'PARENT_INVALID');

  const duplicate = baseContextInput();
  duplicate.ordersRelationship.orders[1].ordinal = 1;
  expectCode(() => createContext(duplicate), 'ORDER_ORDINAL_INVALID');
});

test('rejects missing, duplicate, invalid, and ambiguous milestone evidence', () => {
  const empty = baseContextInput();
  empty.milestonesRelationship.milestones = [];
  empty.milestonesRelationship.returned = 0;
  expectCode(() => createContext(empty), 'MILESTONE_REQUIRED');

  const duplicate = baseContextInput();
  duplicate.milestonesRelationship.milestones[1].serialNumber = 4;
  expectCode(() => createContext(duplicate), 'MILESTONE_SERIAL_DUPLICATE');

  const noMagppie = baseContextInput();
  noMagppie.milestonesRelationship.milestones.forEach(row => { row.milestoneName = `Sunroof ${row.ordinal}`; });
  expectCode(() => createContext(noMagppie), 'MAGPPIE_MILESTONE_REQUIRED');

  const ambiguous = baseContextInput();
  ambiguous.milestonesRelationship.milestones[0].milestoneName = 'Order Booking Sunrooof Milestone';
  expectCode(() => createContext(ambiguous), 'SUNROOF_NAME_AMBIGUOUS');
});

test('allows nullable existing percentages but requires exact finite two-decimal input and Magppie total 100', () => {
  const nullable = baseContextInput();
  nullable.milestonesRelationship.milestones[0].percentage = null;
  const context = createContext(nullable);
  const missing = planInput(context);
  expectCode(() => buildPlan(missing), 'PERCENT_INVALID');

  const valid = createContext(baseContextInput());
  const precision = planInput(valid);
  precision.milestones[1].percentage = 50.001;
  expectCode(() => buildPlan(precision), 'PERCENT_PRECISION_INVALID');

  const total = planInput(valid);
  total.milestones[3].percentage = 19;
  expectCode(() => buildPlan(total), 'PERCENT_TOTAL_INVALID');

  const sunroofOutsideTotal = planInput(valid);
  sunroofOutsideTotal.milestones[0].percentage = 80;
  assert.equal(buildPlan(sunroofOutsideTotal).totals.magppie_percentage, 100);
});

test('enforces valid dates plus bounded exact two-decimal payment money', () => {
  const context = createContext(baseContextInput());
  for (const date of ['', '2026-02-30', '1899-12-31', '3000-01-01']) {
    const input = planInput(context);
    input.estimatedHandoverDate = date;
    expectCode(() => buildPlan(input), 'HANDOVER_DATE_INVALID');
  }
  const money = planInput(context);
  money.milestones[0].amountReceived = constants.limits.money + 1;
  expectCode(() => buildPlan(money), 'AMOUNT_RECEIVED_INVALID');

  const amountPrecision = planInput(context);
  amountPrecision.milestones[1].amountReceived = 0.001;
  expectCode(() => buildPlan(amountPrecision), 'AMOUNT_RECEIVED_PRECISION_INVALID', { field: 'amountReceived', ordinal: 2 });

  const discountPrecision = planInput(context);
  discountPrecision.milestones[1].managementDiscount = 0.009;
  expectCode(() => buildPlan(discountPrecision), 'MANAGEMENT_DISCOUNT_PRECISION_INVALID', { field: 'managementDiscount', ordinal: 2 });

  const boundary = planInput(context);
  boundary.milestones[1].amountReceived = constants.limits.money;
  boundary.milestones[1].managementDiscount = 0.01;
  assert.equal(buildPlan(boundary).milestone_plans[1].fields.Amount_Received_Now, constants.limits.money);

  const sourcePrecision = baseContextInput();
  sourcePrecision.milestonesRelationship.milestones[0].amountReceived = 1.001;
  expectCode(() => createContext(sourcePrecision), 'AMOUNT_RECEIVED_PRECISION_INVALID');
});

test('returns exact later-row validation details and excludes milestone and reference free text', () => {
  const raw = baseContextInput();
  raw.milestonesRelationship.milestones[1].milestoneName = 'Payment for Alice Sharma alice@example.com';
  const context = createContext(raw);
  const laterPercentage = planInput(context);
  laterPercentage.milestones[2].percentage = 30.001;
  expectCode(() => buildPlan(laterPercentage), 'PERCENT_PRECISION_INVALID', { field: 'percentage', ordinal: 3 });

  const laterDate = planInput(context);
  laterDate.milestones[3].amountReceivedDate = null;
  expectCode(() => buildPlan(laterDate), 'AMOUNT_RECEIVED_DATE_INVALID', { field: 'amountReceivedDate', ordinal: 4 });

  const planText = JSON.stringify(buildPlan(planInput(context)));
  assert.doesNotMatch(planText, /Alice|example\.com|milestone_name|Reference_No|referenceNumber/i);
  assert.doesNotMatch(JSON.stringify(context), /Alice|example\.com|milestoneName|referenceNumber/i);

  const injectedReference = baseContextInput();
  injectedReference.milestonesRelationship.milestones[0].referenceNumber = '1032257000026160092';
  expectCode(() => createContext(injectedReference), 'MILESTONE_DESCRIPTOR_INVALID');
});

test('forbids detail values on compact milestones and preserves optional blank omission', () => {
  const context = createContext(baseContextInput());
  const forbidden = planInput(context);
  forbidden.milestones[2].amountReceived = 1;
  expectCode(() => buildPlan(forbidden), 'COMPACT_DETAIL_FORBIDDEN');

  const plan = buildPlan(planInput(context));
  assert.deepEqual(plan.milestone_plans[1].fields, { Percentage: 50 });
  assert.deepEqual(plan.milestone_plans[2].fields, { Percentage: 30 });
});

test('requires a non-empty ascending selection drawn only from supported anonymous orders', () => {
  const context = createContext(baseContextInput());
  const empty = planInput(context);
  empty.selectedOrderOrdinals = [];
  expectCode(() => buildPlan(empty), 'ORDER_SELECTION_REQUIRED');

  for (const ordinals of [[2], [3, 1], [1, 1], [1, 4]]) {
    const input = planInput(context);
    input.selectedOrderOrdinals = ordinals;
    expectCode(() => buildPlan(input), 'ORDER_SELECTION_INVALID');
  }
});

test('created contexts are unforgeable and snapshot mutable source values', () => {
  const raw = baseContextInput();
  const context = createContext(raw);
  raw.parent.stage = 'Closure';
  raw.ordersRelationship.orders[0].productType = 'SUNROOOF';
  raw.milestonesRelationship.milestones[2].percentage = 0;
  assert.equal(context.parent.stage, 'Principally Closed');
  assert.equal(context.orders[0].productType, 'Wardrobe');
  assert.equal(context.milestones[1].percentage, 50);

  const forged = planInput({ ...context });
  expectCode(() => buildPlan(forged), 'CONTEXT_INVALID');
});

test('descriptor snapshots avoid outer input getters and context-swap traps', () => {
  const context = createContext(baseContextInput());
  const target = planInput(context);
  let gets = 0;
  const proxy = new Proxy(target, {
    get(object, key, receiver) {
      gets += 1;
      return Reflect.get(object, key, receiver);
    },
  });
  const plan = buildPlan(proxy);
  assert.equal(gets, 0);
  assert.equal(plan.totals.selected_orders, 2);

  const swapped = planInput(context);
  Object.defineProperty(swapped, 'context', { enumerable: true, get: () => context });
  expectCode(() => buildPlan(swapped), 'INPUT_INVALID');
});

test('does not expose mutation, SDK, provider, storage, logging, timer, file, or identity paths', () => {
  for (const pattern of [
    /https?:\/\//i,
    /\bfetch\b|XMLHttpRequest|WebSocket|EventSource|sendBeacon/i,
    /\b(?:ZOHO|ZDK)\b/i,
    /\.(?:insertRecord|updateRecord|deleteRecord|addNotes?|attachFile|uploadFile|proceed)\s*\(/i,
    /\b(?:localStorage|sessionStorage|indexedDB|clipboard)\b/i,
    /\b(?:FormData|FileReader|Blob)\b|\.type\s*=\s*['"]file['"]/i,
    /\bconsole\s*\.|setTimeout|setInterval/i,
    /\b(?:Owner|Email|Phone|Mobile|Contact_Name|Deal_Name|Full_Name)\b/,
  ]) assert.doesNotMatch(engineSource, pattern);
});

test('publishes one frozen browser namespace and refuses replacement', () => {
  const sandbox = { globalThis: null };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(engineSource, sandbox, { filename: 'closure-new-preview.js' });
  assert.equal(typeof sandbox.ClosureNewPreview.createContext, 'function');
  assert.equal(typeof sandbox.ClosureNewPreview.buildPlan, 'function');
  assert.equal(Object.isFrozen(sandbox.ClosureNewPreview), true);
  const descriptor = Object.getOwnPropertyDescriptor(sandbox, 'ClosureNewPreview');
  assert.equal(descriptor.writable, false);
  assert.equal(descriptor.configurable, false);
  assert.throws(() => vm.runInContext(engineSource, sandbox, { filename: 'closure-new-preview.js' }), /namespace is unavailable/i);
});
