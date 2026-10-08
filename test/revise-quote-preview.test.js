'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const enginePath = path.resolve(__dirname, '..', 'public', 'revise-quote-preview.js');
const engineSource = fs.readFileSync(enginePath, 'utf8');
const blueprintConfig = require('../config/blueprints.json');
const {
  ReviseQuotePreviewError,
  constants,
  createContext,
  buildPlan,
} = require('../public/revise-quote-preview');

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
    metadata('Stage', 'picklist', ['Sent for Approval', 'None', 'Assign Designer', 'Query to SM', 'Requirement From SM']),
    metadata('Product_Type', 'picklist', [...constants.productTypes, 'Vanity']),
    metadata('Design_Presentation', 'picklist', [...PRESENTATIONS, 'NA']),
    metadata('Design_Theme', 'picklist', [...THEMES, 'NA']),
    metadata('Finished_Kitchen_Ceiling_Height', 'textarea'),
    metadata('Design_Required_on', 'date'),
    metadata('Reason_for_Design_Revision1', 'picklist', [...REASONS, 'Client changed requirement']),
    metadata('Any_Vastu_requirement', 'picklist', ['Yes', 'No', 'North']),
    metadata('Gas_Arrangement', 'picklist', [...constants.gasOptions, 'Not Applicable']),
    metadata('Kitchen_Type', 'multiselectpicklist', [...constants.kitchenTypes]),
    metadata('Kitche_Height', 'picklist', [...constants.kitchenHeights]),
    metadata('Island', 'picklist', [...constants.islandOptions, 'Yes']),
    metadata('Wardrobe_Type', 'multiselectpicklist', [...constants.wardrobeTypes]),
    metadata('Wardrobe_Height', 'picklist', [...constants.wardrobeHeights, 'Option 1']),
  ];
}

function relation(rows = [
  { ordinal: 1, productType: 'Kitchen', stage: 'Sent for Approval' },
  { ordinal: 2, productType: 'Wardrobe', stage: 'Sent for Approval' },
  { ordinal: 3, productType: 'SUNROOOF', stage: 'None' },
  { ordinal: 4, productType: 'Kitchen', stage: 'Query to SM' },
  { ordinal: 5, productType: 'Pantry', stage: 'Price Discussion' },
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

function childTransitionContract() {
  return {
    ...constants.childBlueprintContract,
    transitions: constants.childBlueprintContract.transitions.map(transition => ({ ...transition })),
  };
}

function context(overrides = {}) {
  return createContext({
    childTransitionContract: childTransitionContract(),
    contactFieldMetadata: contactMetadata(),
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

function wardrobeOrder(ordinal = 2, overrides = {}) {
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

function assertPreviewError(callback, code) {
  assert.throws(callback, error => {
    assert.equal(error instanceof ReviseQuotePreviewError, true);
    assert.equal(error.code, code);
    assert.equal(error.message, 'Revise Quote preview input is invalid.');
    return true;
  });
}

test('exports an immutable exact parent and child transition contract', () => {
  assert.deepEqual(constants.parentContract, {
    module: 'Contacts',
    layoutId: '1032257000000000171',
    layoutName: 'Standard',
    blueprintId: '1032257000001044611',
    blueprintName: 'Opportunity Stage',
    stateField: 'Stage',
    currentDisplay: 'Design Form Filled',
    currentActual: 'Assigned Designer',
    transitionId: '1032257000010720046',
    transitionName: 'Approve/Revise Quote',
    nextDisplay: 'Approve/Disapprove Quote',
    nextActual: 'Approve/Disapprove Quote',
    widgetId: '1032257000010720459',
    widgetName: 'Revise Quote - Widget',
  });
  assert.deepEqual(constants.actions, ['Skip', 'Revise Quotes', 'Approved Quote']);
  assert.deepEqual(constants.childBlueprintContract, {
    blueprintId: '1032257000000535747',
    blueprintName: 'Order Stages',
    layoutId: '1032257000000000173',
    layoutName: 'Standard',
    module: 'Deals',
    stateField: 'Stage',
    transitions: [
      {
        action: 'Approved Quote',
        common: false,
        fromActual: 'Sent for Approval',
        fromDisplay: 'Sent for Approval',
        id: '1032257000008327496',
        name: 'Design Approved',
        toActual: 'Price Discussion',
        toDisplay: 'Price Discussion',
        triggerType: 'manual',
      },
      {
        action: 'Revise Quotes',
        common: true,
        fromActual: 'Sent for Approval',
        fromDisplay: 'Sent for Approval',
        id: '1032257000011087211',
        name: 'Revision Required',
        toActual: 'Revision Required',
        toDisplay: 'Revision Required',
        triggerType: 'manual',
      },
    ],
  });
  assert.deepEqual(constants.childTransitions['Revise Quotes'], { id: '1032257000011087211', name: 'Revision Required' });
  assert.deepEqual(constants.childTransitions['Approved Quote'], { id: '1032257000008327496', name: 'Design Approved' });
  assert.equal(Object.isFrozen(constants), true);
  assert.equal(Object.isFrozen(constants.parentContract), true);
  assert.equal(Object.isFrozen(constants.childBlueprintContract), true);
  assert.equal(Object.isFrozen(constants.childBlueprintContract.transitions), true);
  assert.ok(constants.childBlueprintContract.transitions.every(Object.isFrozen));
  assert.equal(Object.isFrozen(constants.childTransitions), true);
});

test('links both child transition tuples to the checked-in Deals Order Stages Blueprint', () => {
  const sourceBlueprint = blueprintConfig.blueprints.find(item => String(item.id) === constants.childBlueprintContract.blueprintId);
  assert.equal(sourceBlueprint?.name, constants.childBlueprintContract.blueprintName);
  assert.equal(sourceBlueprint?.module, constants.childBlueprintContract.module);
  assert.equal(sourceBlueprint?.state_field, constants.childBlueprintContract.stateField);
  assert.equal(String(sourceBlueprint?.layout?.id || ''), constants.childBlueprintContract.layoutId);
  assert.equal(sourceBlueprint?.layout?.name, constants.childBlueprintContract.layoutName);
  const sourceTransitions = constants.childBlueprintContract.transitions.map(expected => {
    const source = sourceBlueprint?.transitions.find(item => String(item.id) === expected.id);
    return {
      action: expected.action,
      common: source?.global,
      fromActual: source?.from?.actual_value,
      fromDisplay: source?.from?.display_value,
      id: String(source?.id || ''),
      name: source?.name,
      toActual: source?.to?.actual_value,
      toDisplay: source?.to?.display_value,
    };
  });
  assert.deepEqual(sourceTransitions, constants.childBlueprintContract.transitions.map(({ triggerType, ...transition }) => transition));
  assert.ok(constants.childBlueprintContract.transitions.every(transition => transition.triggerType === 'manual'));
  assert.deepEqual(
    Object.fromEntries(constants.childBlueprintContract.transitions.map(transition => [transition.action, {
      id: transition.id,
      name: transition.name,
    }])),
    constants.childTransitions,
  );
});

test('fails closed on any runtime child Blueprint or transition contract drift', () => {
  const base = childTransitionContract();
  for (const key of ['blueprintId', 'blueprintName', 'layoutId', 'layoutName', 'module', 'stateField']) {
    assertPreviewError(() => context({
      childTransitionContract: { ...childTransitionContract(), [key]: `${base[key]} drift` },
    }), 'CHILD_TRANSITION_CONTRACT_DRIFT');
  }
  constants.childBlueprintContract.transitions.forEach((expected, index) => {
    Object.keys(expected).forEach(key => {
      const transitions = childTransitionContract().transitions;
      transitions[index] = {
        ...transitions[index],
        [key]: key === 'common' ? !expected.common : `${expected[key]} drift`,
      };
      assertPreviewError(() => context({
        childTransitionContract: { ...childTransitionContract(), transitions },
      }), 'CHILD_TRANSITION_CONTRACT_DRIFT');
    });
  });
  assertPreviewError(() => context({
    childTransitionContract: {
      ...childTransitionContract(),
      transitions: [...childTransitionContract().transitions].reverse(),
    },
  }), 'CHILD_TRANSITION_CONTRACT_DRIFT');
  assertPreviewError(() => context({
    childTransitionContract: { ...childTransitionContract(), transitions: [childTransitionContract().transitions[0]] },
  }), 'CHILD_TRANSITION_CONTRACT_DRIFT');
  assertPreviewError(() => context({
    childTransitionContract: { ...childTransitionContract(), unexpected: true },
  }), 'CHILD_TRANSITION_CONTRACT_DRIFT');
  assertPreviewError(() => context({
    childTransitionContract: {
      ...childTransitionContract(),
      transitions: [{ ...childTransitionContract().transitions[0], unexpected: true }, childTransitionContract().transitions[1]],
    },
  }), 'CHILD_TRANSITION_CONTRACT_DRIFT');
  const sparseTransitions = new Array(2);
  sparseTransitions[0] = childTransitionContract().transitions[0];
  assertPreviewError(() => context({
    childTransitionContract: { ...childTransitionContract(), transitions: sparseTransitions },
  }), 'CHILD_TRANSITION_CONTRACT_DRIFT');
});

test('creates a deeply frozen anonymous context and explicitly counts unsupported source branches', () => {
  const previewContext = context();
  assert.deepEqual(previewContext.orders.map(order => ({
    ordinal: order.ordinal,
    label: order.label,
    productType: order.productType,
    stage: order.stage,
  })), [
    { ordinal: 1, label: 'Order 1', productType: 'Kitchen', stage: 'Sent for Approval' },
    { ordinal: 2, label: 'Order 2', productType: 'Wardrobe', stage: 'Sent for Approval' },
  ]);
  assert.deepEqual(previewContext.unsupportedBranches, { None: 1, Query_to_SM: 1 });
  assert.equal(previewContext.ignoredOrders, 1);
  assert.ok(previewContext.revisionReasons.includes('Budget to be reduced'));
  assert.equal(previewContext.revisionReasons.includes('Incomplete breif shared to designere'), false);
  assert.deepEqual(previewContext.optionSets, {
    kitchenTypes: ['Chef', 'Show', 'Storage', 'Laundry', 'Utility'],
    kitchenHeights: ['2500', '2140'],
    islandOptions: ['No', 'Both Side Storage', 'One side storage & one side sitting'],
    gasOptions: ['Piped Gas', 'Cylinder inside kitchen', 'Cylinder outside kitchen'],
    vastuOptions: ['Yes', 'No'],
    wardrobeTypes: ['Glass Hinged', 'Solid Hinged'],
    wardrobeHeights: ['8', '9'],
  });
  assert.equal(previewContext.orders[0].presentationOptions.includes('NA'), false);
  assert.equal(previewContext.orders[0].themeOptions.includes('NA'), false);
  assert.equal(Object.isFrozen(previewContext), true);
  assert.equal(Object.isFrozen(previewContext.orders), true);
  assert.equal(Object.isFrozen(previewContext.optionSets), true);
  assert.ok(Object.values(previewContext.optionSets).every(Object.isFrozen));
  assert.ok(previewContext.orders.every(order => Object.isFrozen(order) && Object.isFrozen(order.presentationOptions) && Object.isFrozen(order.themeOptions)));
  assert.doesNotMatch(JSON.stringify(previewContext), /\b\d{18,19}\b|Deal_Name|Contact_Name|Owner|Email|Phone|Mobile|Requirements_For_SM|Note|File|Payment/i);
});

test('builds deeply frozen revise and approval plans with only anonymous labels and intended transitions', () => {
  const previewContext = context();
  const rawKitchen = kitchenOrder();
  const rawWardrobe = wardrobeOrder();
  const draft = buildPlan({ context: previewContext, orders: [rawKitchen, rawWardrobe] });
  assert.deepEqual(draft, {
    preview_only: true,
    persistence: 'disabled',
    source_execution: 'disabled',
    plans: [
      {
        order_label: 'Order 1',
        product_type: 'Kitchen',
        source_stage: 'Sent for Approval',
        decision: 'Revise Quotes',
        intended_transition: { id: '1032257000011087211', name: 'Revision Required' },
        fields: {
          Design_Presentation: 'Kitchen 3D',
          Design_Theme: 'Modern PG1',
          Finished_Kitchen_Ceiling_Height: '2700 mm',
          Design_Required_on: '2026-09-15',
          Reason_for_Design_Revision1: 'Budget to be reduced',
          Any_Vastu_requirement: 'Yes',
          Gas_Arrangement: 'Piped Gas',
          Kitchen_Type: ['Chef', 'Utility'],
          Kitche_Height: '2500',
          Island: 'Both Side Storage',
        },
      },
      {
        order_label: 'Order 2',
        product_type: 'Wardrobe',
        source_stage: 'Sent for Approval',
        decision: 'Approved Quote',
        intended_transition: { id: '1032257000008327496', name: 'Design Approved' },
        fields: {
          Design_Presentation: 'Wardrobe 3D',
          Design_Theme: 'Classic PG1',
          Finished_Kitchen_Ceiling_Height: '2600',
          Design_Required_on: '2028-02-29',
          Wardrobe_Type: ['Glass Hinged'],
          Wardrobe_Height: '9',
        },
      },
    ],
    skipped_orders: 0,
    unsupported_orders: { None: 1, Query_to_SM: 1 },
    ignored_orders: 1,
    blocked_actions: [
      'Order update',
      'Note creation',
      'Attachment upload',
      'Workflow trigger',
      'Child Blueprint continuation',
      'Parent Blueprint continuation',
      'SDK or provider request',
    ],
  });
  assert.equal(Object.isFrozen(draft), true);
  assert.equal(Object.isFrozen(draft.plans), true);
  assert.ok(draft.plans.every(plan => Object.isFrozen(plan) && Object.isFrozen(plan.fields) && Object.isFrozen(plan.intended_transition)));
  assert.equal(Object.isFrozen(draft.plans[0].fields.Kitchen_Type), true);
  assert.equal(Object.isFrozen(draft.blocked_actions), true);
  rawKitchen.kitchenTypes.push('Show');
  assert.deepEqual(draft.plans[0].fields.Kitchen_Type, ['Chef', 'Utility']);
  assert.doesNotMatch(JSON.stringify(draft), /Deal_Name|Contact_Name|Owner|Email|Phone|Mobile|Requirements_For_SM|Note_Content|File_Name|Payment/i);
});

test('requires at least one planned order and forbids hidden values in skipped orders', () => {
  const previewContext = context();
  assertPreviewError(() => buildPlan({
    context: previewContext,
    orders: [emptyOrder(1), emptyOrder(2)],
  }), 'PLAN_REQUIRED');
  assertPreviewError(() => buildPlan({
    context: previewContext,
    orders: [{ ...emptyOrder(1), reason: 'Budget to be reduced' }, wardrobeOrder()],
  }), 'SKIPPED_VALUES_PRESENT');
  const draft = buildPlan({ context: previewContext, orders: [emptyOrder(1), wardrobeOrder()] });
  assert.equal(draft.skipped_orders, 1);
  assert.equal(draft.plans.length, 1);
  assert.equal(draft.plans[0].order_label, 'Order 2');
});

test('requires a current exact revision reason and forbids revision data on approval', () => {
  const previewContext = context();
  assertPreviewError(() => buildPlan({
    context: previewContext,
    orders: [kitchenOrder(1, { reason: '' }), wardrobeOrder()],
  }), 'REVISION_REASON_REQUIRED');
  assertPreviewError(() => buildPlan({
    context: previewContext,
    orders: [kitchenOrder(1, { reason: 'Incomplete breif shared to designere' }), wardrobeOrder()],
  }), 'REVISION_REASON_REQUIRED');
  assertPreviewError(() => buildPlan({
    context: previewContext,
    orders: [kitchenOrder(), wardrobeOrder(2, { reason: 'Budget to be reduced' })],
  }), 'APPROVAL_REVISION_DATA_FORBIDDEN');
});

test('validates required common fields, exact source option intersections, and calendar dates', () => {
  const previewContext = context();
  assertPreviewError(() => buildPlan({ context: previewContext, orders: [kitchenOrder(1, { presentation: 'NA' }), emptyOrder(2)] }), 'PRESENTATION_UNSUPPORTED');
  assertPreviewError(() => buildPlan({ context: previewContext, orders: [kitchenOrder(1, { designTheme: 'NA' }), emptyOrder(2)] }), 'THEME_UNSUPPORTED');
  assertPreviewError(() => buildPlan({ context: previewContext, orders: [kitchenOrder(1, { ceilingHeight: '' }), emptyOrder(2)] }), 'CEILING_HEIGHT_REQUIRED');
  assertPreviewError(() => buildPlan({ context: previewContext, orders: [kitchenOrder(1, { designRequiredOn: '' }), emptyOrder(2)] }), 'DESIGN_DATE_INVALID');
  assertPreviewError(() => buildPlan({ context: previewContext, orders: [kitchenOrder(1, { designRequiredOn: '2027-02-29' }), emptyOrder(2)] }), 'DESIGN_DATE_INVALID');
});

test('enforces exact kitchen, wardrobe, and non-applicable product fields', () => {
  const previewContext = context();
  assertPreviewError(() => buildPlan({ context: previewContext, orders: [kitchenOrder(1, { kitchenTypes: [] }), emptyOrder(2)] }), 'KITCHEN_TYPE_REQUIRED');
  assertPreviewError(() => buildPlan({ context: previewContext, orders: [kitchenOrder(1, { kitchenTypes: ['Chef', 'Chef'] }), emptyOrder(2)] }), 'KITCHEN_TYPE_REQUIRED');
  assertPreviewError(() => buildPlan({ context: previewContext, orders: [kitchenOrder(1, { gas: 'Not Applicable' }), emptyOrder(2)] }), 'GAS_UNSUPPORTED');
  assertPreviewError(() => buildPlan({ context: previewContext, orders: [kitchenOrder(1, { wardrobeTypes: ['Glass Hinged'] }), emptyOrder(2)] }), 'NON_APPLICABLE_VALUES');
  assertPreviewError(() => buildPlan({ context: previewContext, orders: [emptyOrder(1), wardrobeOrder(2, { wardrobeHeight: '' })] }), 'WARDROBE_HEIGHT_UNSUPPORTED');
});

test('requires exact complete All_Orders relationship evidence', () => {
  const mutations = [
    { availability: 'unavailable' },
    { relatedModule: 'Contacts' },
    { linkBasis: 'Inferred' },
    { linkFields: ['Other'] },
    { page: 2 },
    { perPage: 199 },
    { limitApplied: false },
    { hasMore: true },
    { returned: 4 },
  ];
  mutations.forEach(patch => assertPreviewError(() => context({ relationship: { ...relation(), ...patch } }), 'RELATIONSHIP_INVALID'));
  const sparse = new Array(1);
  assertPreviewError(() => context({ relationship: relation(sparse) }), 'RELATIONSHIP_INVALID');
  assertPreviewError(() => context({
    relationship: relation([{ ordinal: 1, productType: 'Kitchen', stage: 'Sent for Approval', id: 'forbidden' }]),
  }), 'ORDER_DESCRIPTOR_INVALID');
  const hiddenRow = { ordinal: 1, productType: 'Kitchen', stage: 'Sent for Approval' };
  Object.defineProperty(hiddenRow, 'hidden', { enumerable: false, value: true });
  assertPreviewError(() => context({ relationship: relation([hiddenRow]) }), 'ORDER_DESCRIPTOR_INVALID');
});

test('fails closed for local display/actual stage drift and unsupported products', () => {
  assertPreviewError(() => context({
    relationship: relation([{ ordinal: 1, productType: 'Kitchen', stage: 'Requirement From SM' }]),
  }), 'STAGE_DISPLAY_DRIFT');
  assertPreviewError(() => context({
    relationship: relation([{ ordinal: 1, productType: 'Kitchen', stage: 'Assign Designer' }]),
  }), 'STAGE_DISPLAY_DRIFT');
  assertPreviewError(() => context({
    relationship: relation([{ ordinal: 1, productType: 'Vanity', stage: 'Sent for Approval' }]),
  }), 'PRODUCT_TYPE_UNSUPPORTED');
});

test('fails closed for missing, duplicate, wrong-type, or drifted metadata', () => {
  assertPreviewError(() => context({
    contactFieldMetadata: [metadata('Stage', 'picklist', ['Design Form Filled'])],
  }), 'PARENT_STAGE_METADATA_DRIFT');
  assertPreviewError(() => context({
    dealFieldMetadata: dealMetadata().filter(field => field.apiName !== 'Design_Required_on'),
  }), 'REQUIRED_METADATA_MISSING');
  assertPreviewError(() => context({
    dealFieldMetadata: dealMetadata().map(field => field.apiName === 'Design_Required_on' ? { ...field, dataType: 'datetime' } : field),
  }), 'DEAL_METADATA_INVALID');
  assertPreviewError(() => context({
    dealFieldMetadata: [...dealMetadata(), metadata('Stage', 'picklist', ['Sent for Approval'])],
  }), 'DEAL_METADATA_INVALID');
  assertPreviewError(() => context({
    dealFieldMetadata: dealMetadata().map(field => field.apiName === 'Stage' ? { ...field, options: ['Sent for Approval', 'None'] } : field),
  }), 'DEAL_STAGE_METADATA_DRIFT');
  assertPreviewError(() => context({
    dealFieldMetadata: dealMetadata().map(field => field.apiName === 'Design_Presentation' ? { ...field, options: ['NA'] } : field),
  }), 'PRODUCT_OPTIONS_METADATA_DRIFT');
  assertPreviewError(() => context({
    dealFieldMetadata: dealMetadata().map(field => field.apiName === 'Kitchen_Type' ? { ...field, options: ['Other'] } : field),
  }), 'PRODUCT_OPTIONS_METADATA_DRIFT');
  assertPreviewError(() => context({
    dealFieldMetadata: dealMetadata().map(field => field.apiName === 'Reason_for_Design_Revision1' ? { ...field, options: ['Client changed requirement'] } : field),
  }), 'REVISION_REASON_METADATA_DRIFT');
});

test('rejects sparse, accessor, symbolic, non-enumerable, expanded, and prototype-bearing data', () => {
  const nonEnumerableInput = { context: context(), orders: [kitchenOrder(), emptyOrder(2)] };
  Object.defineProperty(nonEnumerableInput, 'hidden', { value: true, enumerable: false });
  assertPreviewError(() => buildPlan(nonEnumerableInput), 'INPUT_INVALID');

  const symbolic = { context: context(), orders: [kitchenOrder(), emptyOrder(2)] };
  symbolic[Symbol('extra')] = true;
  assertPreviewError(() => buildPlan(symbolic), 'INPUT_INVALID');

  const accessor = { orders: [kitchenOrder(), emptyOrder(2)] };
  Object.defineProperty(accessor, 'context', { enumerable: true, get: () => context() });
  assertPreviewError(() => buildPlan(accessor), 'INPUT_INVALID');

  const sparse = new Array(2); sparse[0] = kitchenOrder();
  assertPreviewError(() => buildPlan({ context: context(), orders: sparse }), 'ORDER_VALUES_INVALID');

  class ExpandedInput {
    constructor(previewContext) {
      this.context = previewContext;
      this.orders = [kitchenOrder(), emptyOrder(2)];
    }
  }
  assertPreviewError(() => buildPlan(new ExpandedInput(context())), 'INPUT_INVALID');

  const expandedOrder = { ...kitchenOrder(), recordId: 'forbidden' };
  assertPreviewError(() => buildPlan({ context: context(), orders: [expandedOrder, emptyOrder(2)] }), 'ORDER_VALUE_INVALID');
});

test('rejects forged and proxied contexts without invoking outer get traps', () => {
  const genuine = context();
  const forged = Object.freeze({ ...genuine });
  assertPreviewError(() => buildPlan({ context: forged, orders: [kitchenOrder(), emptyOrder(2)] }), 'CONTEXT_INVALID');
  assertPreviewError(() => buildPlan({ context: new Proxy(genuine, {}), orders: [kitchenOrder(), emptyOrder(2)] }), 'CONTEXT_INVALID');

  let contextReads = 0;
  const target = { context: forged, orders: [kitchenOrder(), emptyOrder(2)] };
  const swapping = new Proxy(target, {
    get(object, key, receiver) {
      if (key === 'context') {
        contextReads += 1;
        return contextReads === 1 ? genuine : forged;
      }
      return Reflect.get(object, key, receiver);
    },
  });
  assertPreviewError(() => buildPlan(swapping), 'CONTEXT_INVALID');
  assert.equal(contextReads, 0);
});

test('supports no Sent for Approval orders only as a context; generation still fails closed', () => {
  const previewContext = context({
    relationship: relation([
      { ordinal: 1, productType: 'Kitchen', stage: 'None' },
      { ordinal: 2, productType: 'Wardrobe', stage: 'Query to SM' },
    ]),
  });
  assert.equal(previewContext.orders.length, 0);
  assert.deepEqual(previewContext.unsupportedBranches, { None: 1, Query_to_SM: 1 });
  assertPreviewError(() => buildPlan({ context: previewContext, orders: [] }), 'PLAN_REQUIRED');
});

test('browser attachment is immutable and namespace collisions fail closed', () => {
  const browser = { globalThis: null };
  browser.globalThis = browser;
  vm.runInNewContext(engineSource, browser, { filename: enginePath });
  assert.equal(typeof browser.ReviseQuotePreview.createContext, 'function');
  assert.equal(typeof browser.ReviseQuotePreview.buildPlan, 'function');
  const first = browser.ReviseQuotePreview;
  assert.throws(() => vm.runInNewContext(engineSource, browser, { filename: enginePath }), /namespace is unavailable/);
  assert.strictEqual(browser.ReviseQuotePreview, first);
});

test('engine has no CRM, provider, mutation, file, storage, logging, or captured-source execution path', () => {
  assert.doesNotMatch(engineSource, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|postMessage)\b/);
  assert.doesNotMatch(engineSource, /\b(?:localStorage|sessionStorage|indexedDB|document\.cookie)\b/);
  assert.doesNotMatch(engineSource, /\b(?:FileReader|Blob|FormData|attachFile|addNotes)\b/);
  assert.doesNotMatch(engineSource, /\bZOHO\b|\.CRM\b|updateBluePrint|updateRecord|BLUEPRINT\.proceed/);
  assert.doesNotMatch(engineSource, /\bconsole\.(?:log|warn|error|info|debug)\b/);
  assert.doesNotMatch(engineSource, /\beval\s*\(|\bFunction\s*\(/);
  assert.doesNotMatch(engineSource, /password|authorization|bearer\s+|api[_-]?key|client[_-]?secret|access[_-]?token/i);
});
