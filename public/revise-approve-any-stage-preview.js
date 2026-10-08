(function attachReviseApproveAnyStagePreview(root, createPreview) {
  'use strict';

  const commonJs = typeof module === 'object' && module && module.exports;
  let reviseQuotePreview;
  if (commonJs) {
    reviseQuotePreview = require('./revise-quote-preview');
  } else {
    let descriptor;
    try {
      descriptor = root && Object.getOwnPropertyDescriptor(root, 'ReviseQuotePreview');
    } catch {
      descriptor = null;
    }
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw new Error('Revise-Approve preview dependency is unavailable.');
    }
    reviseQuotePreview = descriptor.value;
  }

  const preview = createPreview(reviseQuotePreview);
  if (commonJs) {
    module.exports = preview;
    return;
  }
  if (!root || Object.prototype.hasOwnProperty.call(root, 'ReviseApproveAnyStagePreview')) {
    throw new Error('Revise-Approve preview namespace is unavailable.');
  }
  Object.defineProperty(root, 'ReviseApproveAnyStagePreview', {
    configurable: false,
    enumerable: true,
    value: preview,
  });
})(typeof globalThis === 'object' ? globalThis : this, function createReviseApproveAnyStagePreview(coreNamespace) {
  'use strict';

  class ReviseApproveAnyStagePreviewError extends Error {
    constructor(code) {
      super('Revise-Approve preview input is invalid.');
      this.name = 'ReviseApproveAnyStagePreviewError';
      this.code = code;
    }
  }

  const LIMITS = Object.freeze({ ceilingHeight: 64, orders: 200 });
  const BUTTON_CONTRACT = Object.freeze({
    action: 'widget',
    actionReference: Object.freeze({
      id: '1032257000017358913',
      name: 'Revise-Approve Quote-Any Stage',
      type: 'widget',
    }),
    apiName: 'Revise_Approve_Quote',
    id: '1032257000017358923',
    layoutIds: Object.freeze(['1032257000000000171', '1032257000005515301']),
    module: 'Contacts',
    name: 'Revise-Approve Quote',
    position: 'view',
    sequenceNumber: 2,
    source: 'crm',
  });
  const CHILD_BLUEPRINT_CONTRACT = Object.freeze({
    blueprintId: '1032257000000535747',
    blueprintName: 'Order Stages',
    layoutId: '1032257000000000173',
    layoutName: 'Standard',
    module: 'Deals',
    stateField: 'Stage',
    transitions: Object.freeze([
      Object.freeze({
        action: 'Approved Quote',
        common: false,
        fromActual: 'Sent for Approval',
        fromDisplay: 'Sent for Approval',
        id: '1032257000008327496',
        name: 'Design Approved',
        toActual: 'Price Discussion',
        toDisplay: 'Price Discussion',
        triggerType: 'manual',
      }),
      Object.freeze({
        action: 'Revise Quotes',
        common: true,
        fromActual: 'Sent for Approval',
        fromDisplay: 'Sent for Approval',
        id: '1032257000011087211',
        name: 'Revision Required',
        toActual: 'Revision Required',
        toDisplay: 'Revision Required',
        triggerType: 'manual',
      }),
    ]),
  });
  const ACTIONS = Object.freeze(['Skip', 'Revise Quotes', 'Approved Quote']);
  const CONTACT_FIELD_TYPES = Object.freeze({ Stage: 'picklist' });
  const DEAL_FIELD_TYPES = Object.freeze({
    Stage: 'picklist',
    Product_Type: 'picklist',
    Design_Presentation: 'picklist',
    Design_Theme: 'picklist',
    Finished_Kitchen_Ceiling_Height: 'textarea',
    Design_Required_on: 'date',
    Reason_for_Design_Revision1: 'picklist',
    Any_Vastu_requirement: 'picklist',
    Gas_Arrangement: 'picklist',
    Kitchen_Type: 'multiselectpicklist',
    Kitche_Height: 'picklist',
    Island: 'picklist',
    Wardrobe_Type: 'multiselectpicklist',
    Wardrobe_Height: 'picklist',
  });
  const NAMESPACE_KEYS = Object.freeze(['ReviseQuotePreviewError', 'buildPlan', 'constants', 'createContext']);
  const CORE_CONSTANT_KEYS = Object.freeze([
    'actions',
    'childBlueprintContract',
    'childTransitions',
    'contactFieldTypes',
    'dealFieldTypes',
    'gasOptions',
    'islandOptions',
    'kitchenHeights',
    'kitchenTypes',
    'limits',
    'parentContract',
    'productTypes',
    'vastuOptions',
    'wardrobeHeights',
    'wardrobeTypes',
  ]);
  const CONTEXT_KEYS = Object.freeze([
    'buttonContract',
    'childTransitionContract',
    'contactFieldMetadata',
    'contactLayoutId',
    'dealFieldMetadata',
    'relationship',
  ]);
  const INPUT_KEYS = Object.freeze(['context', 'orders']);
  const BUTTON_CONTRACT_KEYS = Object.freeze([
    'action',
    'actionReference',
    'apiName',
    'id',
    'layoutIds',
    'module',
    'name',
    'position',
    'sequenceNumber',
    'source',
  ]);
  const ACTION_REFERENCE_KEYS = Object.freeze(['id', 'name', 'type']);
  const CHILD_BLUEPRINT_CONTRACT_KEYS = Object.freeze([
    'blueprintId',
    'blueprintName',
    'layoutId',
    'layoutName',
    'module',
    'stateField',
    'transitions',
  ]);
  const CHILD_TRANSITION_CONTRACT_KEYS = Object.freeze([
    'action',
    'common',
    'fromActual',
    'fromDisplay',
    'id',
    'name',
    'toActual',
    'toDisplay',
    'triggerType',
  ]);
  const RELATIONSHIP_KEYS = Object.freeze([
    'availability',
    'hasMore',
    'limitApplied',
    'linkBasis',
    'linkFields',
    'orders',
    'page',
    'perPage',
    'relatedModule',
    'returned',
  ]);
  const ORDER_DESCRIPTOR_KEYS = Object.freeze(['ordinal', 'productType', 'stage']);
  const CONTROL = /[\u0000-\u001f\u007f]/;
  const createdContexts = new WeakMap();

  function fail(code) {
    throw new ReviseApproveAnyStagePreviewError(code);
  }

  function exactObject(value, keys, code) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
    let prototype;
    let descriptors;
    try {
      prototype = Object.getPrototypeOf(value);
      descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
      fail(code);
    }
    if (prototype !== Object.prototype && prototype !== null) fail(code);
    const ownKeys = Reflect.ownKeys(descriptors);
    if (ownKeys.some(key => typeof key !== 'string')) fail(code);
    const actual = [...ownKeys].sort();
    const expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(code);
    const captured = Object.create(null);
    for (const key of ownKeys) {
      const descriptor = descriptors[key];
      if (!Object.prototype.hasOwnProperty.call(descriptor, 'value') || descriptor.enumerable !== true) fail(code);
      Object.defineProperty(captured, key, {
        configurable: false,
        enumerable: true,
        value: descriptor.value,
        writable: false,
      });
    }
    return Object.freeze(captured);
  }

  function denseArray(value, maxItems, code) {
    if (!Array.isArray(value)) fail(code);
    let prototype;
    let descriptors;
    try {
      prototype = Object.getPrototypeOf(value);
      descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
      fail(code);
    }
    if (prototype !== Array.prototype) fail(code);
    const ownKeys = Reflect.ownKeys(descriptors);
    if (ownKeys.some(key => typeof key !== 'string')) fail(code);
    const lengthDescriptor = descriptors.length;
    if (
      !lengthDescriptor
      || !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value')
      || lengthDescriptor.enumerable !== false
      || !Number.isInteger(lengthDescriptor.value)
      || lengthDescriptor.value < 0
      || lengthDescriptor.value > maxItems
      || ownKeys.length !== lengthDescriptor.value + 1
    ) fail(code);
    const captured = new Array(lengthDescriptor.value);
    for (let index = 0; index < lengthDescriptor.value; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value') || descriptor.enumerable !== true) fail(code);
      captured[index] = descriptor.value;
    }
    return Object.freeze(captured);
  }

  function boundedText(value, maxLength, code, { optional = false } = {}) {
    if (value === '' && optional) return '';
    if (typeof value !== 'string') fail(code);
    const normalized = value.trim();
    if (!normalized) {
      if (optional) return '';
      fail(code);
    }
    if (normalized.length > maxLength || CONTROL.test(normalized)) fail(code);
    return normalized;
  }

  function exactInteger(value, min, max, code) {
    if (!Number.isInteger(value) || value < min || value > max) fail(code);
    return value;
  }

  function validateStringMap(value, expected, code) {
    const captured = exactObject(value, Object.keys(expected), code);
    if (Object.keys(expected).some(key => captured[key] !== expected[key])) fail(code);
  }

  function validateButtonContract(raw) {
    const button = exactObject(raw, BUTTON_CONTRACT_KEYS, 'BUTTON_CONTRACT_DRIFT');
    for (const key of ['action', 'apiName', 'id', 'module', 'name', 'position', 'sequenceNumber', 'source']) {
      if (button[key] !== BUTTON_CONTRACT[key]) fail('BUTTON_CONTRACT_DRIFT');
    }
    const layoutIds = denseArray(button.layoutIds, 2, 'BUTTON_CONTRACT_DRIFT');
    if (
      layoutIds.length !== BUTTON_CONTRACT.layoutIds.length
      || layoutIds.some((id, index) => id !== BUTTON_CONTRACT.layoutIds[index])
    ) fail('BUTTON_CONTRACT_DRIFT');
    const actionReference = exactObject(button.actionReference, ACTION_REFERENCE_KEYS, 'BUTTON_CONTRACT_DRIFT');
    if (ACTION_REFERENCE_KEYS.some(key => actionReference[key] !== BUTTON_CONTRACT.actionReference[key])) {
      fail('BUTTON_CONTRACT_DRIFT');
    }
  }

  function validateChildTransitionContract(raw) {
    const contract = exactObject(raw, CHILD_BLUEPRINT_CONTRACT_KEYS, 'CHILD_TRANSITION_CONTRACT_DRIFT');
    for (const key of ['blueprintId', 'blueprintName', 'layoutId', 'layoutName', 'module', 'stateField']) {
      if (contract[key] !== CHILD_BLUEPRINT_CONTRACT[key]) fail('CHILD_TRANSITION_CONTRACT_DRIFT');
    }
    const transitions = denseArray(
      contract.transitions,
      CHILD_BLUEPRINT_CONTRACT.transitions.length,
      'CHILD_TRANSITION_CONTRACT_DRIFT',
    );
    if (transitions.length !== CHILD_BLUEPRINT_CONTRACT.transitions.length) fail('CHILD_TRANSITION_CONTRACT_DRIFT');
    transitions.forEach((rawTransition, index) => {
      const transition = exactObject(rawTransition, CHILD_TRANSITION_CONTRACT_KEYS, 'CHILD_TRANSITION_CONTRACT_DRIFT');
      const expected = CHILD_BLUEPRINT_CONTRACT.transitions[index];
      if (CHILD_TRANSITION_CONTRACT_KEYS.some(key => transition[key] !== expected[key])) {
        fail('CHILD_TRANSITION_CONTRACT_DRIFT');
      }
    });
  }

  function normalizeRelationship(raw) {
    const relation = exactObject(raw, RELATIONSHIP_KEYS, 'RELATIONSHIP_INVALID');
    if (
      relation.availability !== 'queryable'
      || relation.relatedModule !== 'Deals'
      || relation.linkBasis !== 'Exact source lookup relation'
      || relation.page !== 1
      || relation.perPage !== 200
      || relation.limitApplied !== true
      || relation.hasMore !== false
    ) fail('RELATIONSHIP_INVALID');
    const linkFields = denseArray(relation.linkFields, 1, 'RELATIONSHIP_INVALID');
    if (linkFields.length !== 1 || linkFields[0] !== 'Opportunity_Name') fail('RELATIONSHIP_INVALID');
    const rows = denseArray(relation.orders, LIMITS.orders, 'RELATIONSHIP_INVALID');
    exactInteger(relation.returned, 0, LIMITS.orders, 'RELATIONSHIP_INVALID');
    if (relation.returned !== rows.length) fail('RELATIONSHIP_INVALID');
    const normalizedRows = rows.map((rawRow, index) => {
      const row = exactObject(rawRow, ORDER_DESCRIPTOR_KEYS, 'ORDER_DESCRIPTOR_INVALID');
      const ordinal = exactInteger(row.ordinal, 1, LIMITS.orders, 'ORDER_ORDINAL_INVALID');
      if (ordinal !== index + 1) fail('ORDER_ORDINAL_INVALID');
      return Object.freeze({
        ordinal,
        productType: boundedText(row.productType, 120, 'PRODUCT_TYPE_INVALID', { optional: true }),
        stage: boundedText(row.stage, 120, 'STAGE_INVALID', { optional: true }),
      });
    });
    return Object.freeze({
      envelope: Object.freeze({
        availability: 'queryable',
        hasMore: false,
        limitApplied: true,
        linkBasis: 'Exact source lookup relation',
        linkFields: Object.freeze(['Opportunity_Name']),
        page: 1,
        perPage: 200,
        relatedModule: 'Deals',
        returned: normalizedRows.length,
      }),
      rows: Object.freeze(normalizedRows),
    });
  }

  function callCore(method, input) {
    try {
      return method(input);
    } catch (error) {
      const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.code)
        ? error.code
        : 'CORE_VALIDATION_FAILED';
      fail(code);
    }
  }

  const core = exactObject(coreNamespace, NAMESPACE_KEYS, 'CORE_CONTRACT_DRIFT');
  if (!Object.isFrozen(coreNamespace) || typeof core.createContext !== 'function' || typeof core.buildPlan !== 'function') {
    fail('CORE_CONTRACT_DRIFT');
  }
  const coreConstants = exactObject(core.constants, CORE_CONSTANT_KEYS, 'CORE_CONTRACT_DRIFT');
  validateChildTransitionContract(coreConstants.childBlueprintContract);
  const coreActions = denseArray(coreConstants.actions, ACTIONS.length, 'CORE_CONTRACT_DRIFT');
  if (coreActions.length !== ACTIONS.length || coreActions.some((action, index) => action !== ACTIONS[index])) {
    fail('CORE_CONTRACT_DRIFT');
  }
  validateStringMap(coreConstants.contactFieldTypes, CONTACT_FIELD_TYPES, 'CORE_CONTRACT_DRIFT');
  validateStringMap(coreConstants.dealFieldTypes, DEAL_FIELD_TYPES, 'CORE_CONTRACT_DRIFT');

  function createContext(raw) {
    const input = exactObject(raw, CONTEXT_KEYS, 'CONTEXT_INVALID');
    validateButtonContract(input.buttonContract);
    validateChildTransitionContract(input.childTransitionContract);
    const contactLayoutId = boundedText(input.contactLayoutId, 24, 'CONTACT_LAYOUT_INVALID');
    if (!BUTTON_CONTRACT.layoutIds.includes(contactLayoutId)) fail('CONTACT_LAYOUT_INVALID');
    const relationship = normalizeRelationship(input.relationship);
    const blockedOrders = Object.freeze(relationship.rows
      .filter(row => row.stage !== 'Sent for Approval')
      .map(row => Object.freeze({
        order_label: `Order ${row.ordinal}`,
        product_type: row.productType || 'Not set',
        reason: 'stage-not-sent-for-approval',
        source_stage: row.stage || 'Not set',
      })));
    const coreRelationship = {
      ...relationship.envelope,
      orders: relationship.rows.map(row => ({
        ordinal: row.ordinal,
        productType: row.productType,
        stage: row.stage === 'Sent for Approval' ? 'Sent for Approval' : 'None',
      })),
    };
    const coreContext = callCore(core.createContext, {
      childTransitionContract: input.childTransitionContract,
      contactFieldMetadata: input.contactFieldMetadata,
      dealFieldMetadata: input.dealFieldMetadata,
      relationship: coreRelationship,
    });
    const context = Object.freeze({
      blockedOrders,
      ignoredOrders: 0,
      optionSets: coreContext.optionSets,
      orders: coreContext.orders,
      parentBlueprint: 'not-applicable',
      relationshipCounts: Object.freeze({
        blocked: blockedOrders.length,
        eligible: coreContext.orders.length,
        total: relationship.rows.length,
      }),
      revisionReasons: coreContext.revisionReasons,
    });
    createdContexts.set(context, Object.freeze({ coreContext }));
    return context;
  }

  function buildPlan(raw) {
    const input = exactObject(raw, INPUT_KEYS, 'INPUT_INVALID');
    const binding = createdContexts.get(input.context);
    if (!binding) fail('CONTEXT_INVALID');
    const corePlan = callCore(core.buildPlan, { context: binding.coreContext, orders: input.orders });
    const plans = Object.freeze(corePlan.plans.map(plan => {
      const expected = CHILD_BLUEPRINT_CONTRACT.transitions.find(transition => transition.action === plan.decision);
      if (
        !expected
        || plan.source_stage !== 'Sent for Approval'
        || plan.intended_transition?.id !== expected.id
        || plan.intended_transition?.name !== expected.name
      ) fail('CORE_OUTPUT_INVALID');
      return Object.freeze({
        decision: plan.decision,
        execution: 'disabled',
        fields: plan.fields,
        intended_transition: Object.freeze({ name: expected.name }),
        order_label: plan.order_label,
        product_type: plan.product_type,
        source_stage: 'Sent for Approval',
      });
    }));
    return Object.freeze({
      blocked_actions: Object.freeze([
        'Order update',
        'Note creation',
        'Attachment upload',
        'Workflow trigger',
        'Child Blueprint transition',
        'SDK or provider request',
        'Storage or logging',
        'File or captured-source access',
      ]),
      blocked_orders: input.context.blockedOrders,
      ignored_orders: 0,
      parent_blueprint: 'not-applicable',
      persistence: 'disabled',
      plans,
      preview_only: true,
      skipped_orders: corePlan.skipped_orders,
      source_execution: 'disabled',
      totals: Object.freeze({
        blocked_orders: input.context.blockedOrders.length,
        eligible_orders: input.context.orders.length,
        planned_orders: plans.length,
        skipped_orders: corePlan.skipped_orders,
      }),
    });
  }

  Object.freeze(ReviseApproveAnyStagePreviewError.prototype);
  Object.freeze(ReviseApproveAnyStagePreviewError);
  return Object.freeze({
    ReviseApproveAnyStagePreviewError,
    buildPlan,
    constants: Object.freeze({
      actions: ACTIONS,
      buttonContract: BUTTON_CONTRACT,
      childBlueprintContract: CHILD_BLUEPRINT_CONTRACT,
      contactFieldTypes: CONTACT_FIELD_TYPES,
      dealFieldTypes: DEAL_FIELD_TYPES,
      limits: LIMITS,
      parentBlueprint: 'not-applicable',
    }),
    createContext,
  });
});
