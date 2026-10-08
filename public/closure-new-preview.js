(function attachClosureNewPreview(root, createPreview) {
  'use strict';

  const preview = createPreview();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = preview;
    return;
  }
  if (!root || Object.prototype.hasOwnProperty.call(root, 'ClosureNewPreview')) {
    throw new Error('Closure New preview namespace is unavailable.');
  }
  Object.defineProperty(root, 'ClosureNewPreview', {
    configurable: false,
    enumerable: true,
    value: preview,
  });
})(typeof globalThis === 'object' ? globalThis : this, function createClosureNewPreview() {
  'use strict';

  class ClosureNewPreviewError extends Error {
    constructor(code, details = null) {
      super('Closure New preview input is invalid.');
      this.name = 'ClosureNewPreviewError';
      this.code = code;
      this.details = details ? Object.freeze({ field: details.field, ordinal: details.ordinal }) : null;
    }
  }

  const LIMITS = Object.freeze({
    fieldMetadata: 12,
    fieldOptions: 180,
    money: 999999999999.99,
    orders: 200,
    milestones: 200,
    reference: 255,
    serial: 999999999,
  });
  const PARENT_CONTRACT = Object.freeze({
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
  const CHILD_CONTRACT = Object.freeze({
    module: 'Deals',
    layoutId: '1032257000000000173',
    layoutName: 'Standard',
    blueprintId: '1032257000000535747',
    blueprintName: 'Order Stages',
    stateField: 'Stage',
    currentDisplay: 'Payment Awaited',
    currentActual: 'Payment Awaited',
    transitionId: '1032257000000535729',
    transitionName: 'Closure',
    nextDisplay: 'Closure',
    nextActual: 'Closure',
    requiredField: 'Est_Handover_Date',
  });
  const BLOCKED_SUNROOOF_CONTRACT = Object.freeze({
    productType: 'SUNROOOF',
    transitionId: '1032257000021717028',
    transitionName: 'Closure Sunrooof',
    criterionDisplay: 'Product Type is SUNROOOF',
    afterActionId: '1032257000021717034',
    afterActionName: 'Sync Magppie To Sunrooof',
    reason: 'criteria-and-after-action-unavailable',
  });
  const SUPPORTED_PRODUCTS = Object.freeze([
    'Kitchen',
    'Wardrobe',
    'Pantry',
    'Countertop / Backplash',
    'Vanity',
  ]);
  const CONTACT_FIELD_TYPES = Object.freeze({ Stage: 'picklist' });
  const DEAL_FIELD_TYPES = Object.freeze({
    Stage: 'picklist',
    Product_Type: 'picklist',
    Opportunity_Name: 'lookup',
    Est_Handover_Date: 'date',
  });
  const PAYMENT_FIELD_TYPES = Object.freeze({
    Opportunity_Name: 'lookup',
    Milestone_Number: 'text',
    Serial_Number: 'integer',
    Percentage: 'percent',
    Amount_Received_Now: 'currency',
    Management_Discount_Proposed: 'currency',
    Amount_Received_Date: 'date',
    Reference_No: 'text',
  });
  const CONTEXT_KEYS = Object.freeze([
    'childBlueprintAttestations',
    'contactFieldMetadata',
    'dealFieldMetadata',
    'dealLayout',
    'milestonesRelationship',
    'ordersRelationship',
    'parent',
    'paymentFieldMetadata',
  ]);
  const PARENT_KEYS = Object.freeze(['layoutId', 'stage']);
  const DEAL_LAYOUT_KEYS = Object.freeze(['activeLayoutIds', 'resolution', 'resolvedId']);
  const RELATIONSHIP_KEYS = Object.freeze([
    'availability',
    'hasMore',
    'limitApplied',
    'linkBasis',
    'linkFields',
    'page',
    'perPage',
    'relatedModule',
    'returned',
  ]);
  const ORDER_RELATIONSHIP_KEYS = Object.freeze([...RELATIONSHIP_KEYS, 'orders']);
  const MILESTONE_RELATIONSHIP_KEYS = Object.freeze([...RELATIONSHIP_KEYS, 'milestones']);
  const ORDER_DESCRIPTOR_KEYS = Object.freeze(['ordinal', 'productType', 'stage']);
  const CHILD_ATTESTATION_KEYS = Object.freeze([
    'afterActionCount',
    'common',
    'criteriaCount',
    'current',
    'duringInputCount',
    'executable',
    'fromActual',
    'fromDisplay',
    'layout',
    'local',
    'nextActual',
    'nextDisplay',
    'ordinal',
    'owner',
    'process',
    'requiredField',
    'stateField',
    'transition',
    'triggerType',
  ]);
  const MILESTONE_DESCRIPTOR_KEYS = Object.freeze([
    'amountReceived',
    'amountReceivedDate',
    'managementDiscount',
    'milestoneName',
    'ordinal',
    'percentage',
    'serialNumber',
  ]);
  const FIELD_METADATA_KEYS = Object.freeze(['apiName', 'dataType', 'options']);
  const INPUT_KEYS = Object.freeze(['context', 'estimatedHandoverDate', 'milestones', 'selectedOrderOrdinals']);
  const MILESTONE_INPUT_KEYS = Object.freeze([
    'amountReceived',
    'amountReceivedDate',
    'managementDiscount',
    'ordinal',
    'percentage',
  ]);
  const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
  const CONTROL = /[\u0000-\u001f\u007f]/;
  const createdContexts = new WeakSet();

  function fail(code, details = null) {
    throw new ClosureNewPreviewError(code, details);
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

  function boundedText(value, maxLength, code, { details = null, optional = false } = {}) {
    if (value === '' && optional) return '';
    if (typeof value !== 'string') fail(code, details);
    const normalized = value.trim();
    if (!normalized) {
      if (optional) return '';
      fail(code, details);
    }
    if (normalized.length > maxLength || CONTROL.test(normalized)) fail(code, details);
    return normalized;
  }

  function exactInteger(value, min, max, code) {
    if (!Number.isInteger(value) || value < min || value > max) fail(code);
    return value;
  }

  function boundedNumber(value, min, max, code, { details = null, nullable = false } = {}) {
    if (nullable && value === null) return null;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(code, details);
    return value;
  }

  function validDate(value, code, { details = null, optional = false } = {}) {
    const text = boundedText(value, 10, code, { details, optional });
    if (!text) return '';
    const match = text.match(DATE);
    if (!match) fail(code, details);
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (year < 1900 || year > 2999) fail(code, details);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) fail(code, details);
    return text;
  }

  function round2(value) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  function normalizeOptions(value, code) {
    const options = denseArray(value, LIMITS.fieldOptions, code).map(option => boundedText(option, 160, code));
    if (new Set(options).size !== options.length) fail(code);
    return Object.freeze(options);
  }

  function normalizeFieldMetadata(value, expectedTypes, code) {
    const expectedNames = Object.keys(expectedTypes);
    const fields = denseArray(value, LIMITS.fieldMetadata, code).map(raw => {
      const field = exactObject(raw, FIELD_METADATA_KEYS, code);
      const apiName = boundedText(field.apiName, 80, code);
      const dataType = boundedText(field.dataType, 40, code);
      if (!Object.prototype.hasOwnProperty.call(expectedTypes, apiName) || expectedTypes[apiName] !== dataType) fail(code);
      const options = normalizeOptions(field.options, code);
      if ((dataType === 'picklist' && options.length === 0) || (dataType !== 'picklist' && options.length !== 0)) fail(code);
      return Object.freeze({ apiName, dataType, options });
    });
    if (fields.length !== expectedNames.length || new Set(fields.map(field => field.apiName)).size !== fields.length) fail(code);
    if (expectedNames.some(name => !fields.some(field => field.apiName === name))) fail(code);
    return Object.freeze(fields);
  }

  function metadataMap(fields) {
    return new Map(fields.map(field => [field.apiName, field]));
  }

  function normalizeParent(raw) {
    const parent = exactObject(raw, PARENT_KEYS, 'PARENT_INVALID');
    const stage = boundedText(parent.stage, 120, 'PARENT_STAGE_INVALID');
    const layoutId = boundedText(parent.layoutId, 24, 'PARENT_LAYOUT_INVALID');
    if (stage !== PARENT_CONTRACT.currentDisplay) fail('PARENT_STAGE_INVALID');
    if (layoutId !== PARENT_CONTRACT.layoutId) fail('PARENT_LAYOUT_INVALID');
    return Object.freeze({ layoutId, stage });
  }

  function normalizeDealLayout(raw) {
    const layout = exactObject(raw, DEAL_LAYOUT_KEYS, 'DEAL_LAYOUT_INVALID');
    const activeIds = denseArray(layout.activeLayoutIds, 8, 'DEAL_LAYOUT_INVALID')
      .map(id => boundedText(id, 24, 'DEAL_LAYOUT_INVALID'));
    if (
      activeIds.length !== 1
      || activeIds[0] !== CHILD_CONTRACT.layoutId
      || layout.resolution !== 'only_active_layout'
      || layout.resolvedId !== CHILD_CONTRACT.layoutId
    ) fail('DEAL_LAYOUT_INVALID');
    return Object.freeze({ activeLayoutIds: Object.freeze([...activeIds]), resolution: 'only_active_layout', resolvedId: CHILD_CONTRACT.layoutId });
  }

  function normalizeRelationshipEnvelope(input, expectedModule, rows, code) {
    if (
      input.availability !== 'queryable'
      || input.relatedModule !== expectedModule
      || input.linkBasis !== 'Exact source lookup relation'
      || input.page !== 1
      || input.perPage !== 200
      || input.limitApplied !== true
      || input.hasMore !== false
    ) fail(code);
    const linkFields = denseArray(input.linkFields, 1, code);
    if (linkFields.length !== 1 || linkFields[0] !== 'Opportunity_Name') fail(code);
    exactInteger(input.returned, 0, 200, code);
    if (input.returned !== rows.length) fail(code);
  }

  function normalizeOrdersRelationship(raw, dealMap) {
    const input = exactObject(raw, ORDER_RELATIONSHIP_KEYS, 'ORDER_RELATIONSHIP_INVALID');
    const rows = denseArray(input.orders, LIMITS.orders, 'ORDER_RELATIONSHIP_INVALID');
    normalizeRelationshipEnvelope(input, 'Deals', rows, 'ORDER_RELATIONSHIP_INVALID');
    const supported = [];
    const blocked = [];
    rows.forEach((rawRow, index) => {
      const row = exactObject(rawRow, ORDER_DESCRIPTOR_KEYS, 'ORDER_DESCRIPTOR_INVALID');
      const ordinal = exactInteger(row.ordinal, 1, LIMITS.orders, 'ORDER_ORDINAL_INVALID');
      if (ordinal !== index + 1) fail('ORDER_ORDINAL_INVALID');
      const stage = boundedText(row.stage, 120, 'ORDER_STAGE_INVALID', { optional: true });
      const productType = boundedText(row.productType, 120, 'PRODUCT_TYPE_INVALID', { optional: true });
      if (stage && !dealMap.get('Stage').options.includes(stage)) fail('ORDER_STAGE_METADATA_DRIFT');
      if (productType && !dealMap.get('Product_Type').options.includes(productType)) fail('PRODUCT_METADATA_DRIFT');
      const base = { label: `Order ${ordinal}`, ordinal, productType, stage };
      if (stage !== CHILD_CONTRACT.currentDisplay) {
        blocked.push(Object.freeze({ ...base, reason: 'stage-not-payment-awaited' }));
      } else if (productType === BLOCKED_SUNROOOF_CONTRACT.productType) {
        blocked.push(Object.freeze({ ...base, reason: BLOCKED_SUNROOOF_CONTRACT.reason }));
      } else if (!SUPPORTED_PRODUCTS.includes(productType)) {
        blocked.push(Object.freeze({ ...base, reason: 'product-not-reviewed' }));
      } else {
        supported.push(Object.freeze(base));
      }
    });
    return Object.freeze({ blocked: Object.freeze(blocked), supported: Object.freeze(supported), total: rows.length });
  }

  function optionalMoney(value, code, precisionCode, details = null) {
    const normalized = boundedNumber(value, 0, LIMITS.money, code, { details, nullable: true });
    if (normalized !== null && round2(normalized) !== normalized) fail(precisionCode, details);
    return normalized;
  }

  function normalizeChildBlueprintAttestations(raw, supportedOrders) {
    const rows = denseArray(raw, LIMITS.orders, 'CHILD_BLUEPRINT_ATTESTATION_INVALID');
    if (rows.length !== supportedOrders.length) fail('CHILD_BLUEPRINT_ATTESTATION_INVALID');
    return Object.freeze(rows.map((rawRow, index) => {
      const row = exactObject(rawRow, CHILD_ATTESTATION_KEYS, 'CHILD_BLUEPRINT_ATTESTATION_INVALID');
      const ordinal = exactInteger(row.ordinal, 1, LIMITS.orders, 'CHILD_BLUEPRINT_ATTESTATION_INVALID');
      if (
        ordinal !== supportedOrders[index]?.ordinal
        || row.afterActionCount !== 0
        || row.common !== true
        || row.criteriaCount !== 0
        || row.current !== CHILD_CONTRACT.currentDisplay
        || row.duringInputCount !== 1
        || row.executable !== false
        || row.fromActual !== CHILD_CONTRACT.currentActual
        || row.fromDisplay !== CHILD_CONTRACT.currentDisplay
        || row.layout !== CHILD_CONTRACT.layoutName
        || row.local !== true
        || row.nextActual !== CHILD_CONTRACT.nextActual
        || row.nextDisplay !== CHILD_CONTRACT.nextDisplay
        || row.owner !== 'Specific Users (1)'
        || row.process !== CHILD_CONTRACT.blueprintName
        || row.requiredField !== CHILD_CONTRACT.requiredField
        || row.stateField !== CHILD_CONTRACT.stateField
        || row.transition !== CHILD_CONTRACT.transitionName
        || row.triggerType !== 'manual'
      ) fail('CHILD_BLUEPRINT_ATTESTATION_INVALID');
      return Object.freeze({ ordinal, verified: true });
    }));
  }

  function normalizeMilestonesRelationship(raw) {
    const input = exactObject(raw, MILESTONE_RELATIONSHIP_KEYS, 'MILESTONE_RELATIONSHIP_INVALID');
    const rows = denseArray(input.milestones, LIMITS.milestones, 'MILESTONE_RELATIONSHIP_INVALID');
    normalizeRelationshipEnvelope(input, 'Payment_Milestones', rows, 'MILESTONE_RELATIONSHIP_INVALID');
    if (rows.length === 0) fail('MILESTONE_REQUIRED');
    const serials = new Set();
    const normalized = rows.map((rawRow, index) => {
      const row = exactObject(rawRow, MILESTONE_DESCRIPTOR_KEYS, 'MILESTONE_DESCRIPTOR_INVALID');
      const relationOrdinal = exactInteger(row.ordinal, 1, LIMITS.milestones, 'MILESTONE_ORDINAL_INVALID');
      if (relationOrdinal !== index + 1) fail('MILESTONE_ORDINAL_INVALID');
      const milestoneName = boundedText(row.milestoneName, 255, 'MILESTONE_NAME_INVALID');
      const compactName = milestoneName.toLowerCase().replace(/[\s_-]/g, '');
      if (/sunro{3,}f/.test(compactName)) fail('SUNROOF_NAME_AMBIGUOUS');
      const serialNumber = exactInteger(row.serialNumber, 0, LIMITS.serial, 'MILESTONE_SERIAL_INVALID');
      if (serials.has(serialNumber)) fail('MILESTONE_SERIAL_DUPLICATE');
      serials.add(serialNumber);
      return {
        amountReceived: optionalMoney(row.amountReceived, 'AMOUNT_RECEIVED_INVALID', 'AMOUNT_RECEIVED_PRECISION_INVALID'),
        amountReceivedDate: validDate(row.amountReceivedDate, 'AMOUNT_RECEIVED_DATE_INVALID', { optional: true }),
        classification: milestoneName.toLowerCase().includes('sunroof') ? 'Sunroof' : 'Magppie',
        managementDiscount: optionalMoney(row.managementDiscount, 'MANAGEMENT_DISCOUNT_INVALID', 'MANAGEMENT_DISCOUNT_PRECISION_INVALID'),
        milestoneName,
        percentage: boundedNumber(row.percentage, 0, 100, 'PERCENT_INVALID', { nullable: true }),
        serialNumber,
      };
    }).sort((left, right) => left.serialNumber - right.serialNumber);
    if (!normalized.some(row => row.classification === 'Magppie')) fail('MAGPPIE_MILESTONE_REQUIRED');
    const first = new Set();
    const milestones = normalized.map((row, index) => {
      const detailAllowed = !first.has(row.classification);
      first.add(row.classification);
      return Object.freeze({
        amountReceived: detailAllowed ? row.amountReceived : null,
        amountReceivedDate: detailAllowed ? row.amountReceivedDate : '',
        classification: row.classification,
        detailAllowed,
        label: `Milestone ${index + 1}`,
        managementDiscount: detailAllowed ? row.managementDiscount : null,
        ordinal: index + 1,
        percentage: row.percentage,
        serialNumber: row.serialNumber,
      });
    });
    return Object.freeze(milestones);
  }

  function createContext(raw) {
    const input = exactObject(raw, CONTEXT_KEYS, 'CONTEXT_INVALID');
    const contactFields = normalizeFieldMetadata(input.contactFieldMetadata, CONTACT_FIELD_TYPES, 'CONTACT_METADATA_INVALID');
    const dealFields = normalizeFieldMetadata(input.dealFieldMetadata, DEAL_FIELD_TYPES, 'DEAL_METADATA_INVALID');
    const paymentFields = normalizeFieldMetadata(input.paymentFieldMetadata, PAYMENT_FIELD_TYPES, 'PAYMENT_METADATA_INVALID');
    const contactMap = metadataMap(contactFields);
    const dealMap = metadataMap(dealFields);
    if (
      !contactMap.get('Stage').options.includes(PARENT_CONTRACT.currentDisplay)
      || !contactMap.get('Stage').options.includes(PARENT_CONTRACT.currentActual)
    ) fail('PARENT_STAGE_METADATA_DRIFT');
    if (
      !dealMap.get('Stage').options.includes(CHILD_CONTRACT.currentDisplay)
      || !dealMap.get('Stage').options.includes(CHILD_CONTRACT.nextDisplay)
      || !SUPPORTED_PRODUCTS.every(product => dealMap.get('Product_Type').options.includes(product))
      || !dealMap.get('Product_Type').options.includes(BLOCKED_SUNROOOF_CONTRACT.productType)
    ) fail('DEAL_METADATA_DRIFT');
    const parent = normalizeParent(input.parent);
    const dealLayout = normalizeDealLayout(input.dealLayout);
    const orders = normalizeOrdersRelationship(input.ordersRelationship, dealMap);
    const childBlueprintAttestations = normalizeChildBlueprintAttestations(input.childBlueprintAttestations, orders.supported);
    const milestones = normalizeMilestonesRelationship(input.milestonesRelationship);
    const context = Object.freeze({
      blockedOrders: orders.blocked,
      childBlueprintAttestations,
      dealFieldMetadata: dealFields,
      dealLayout,
      milestones,
      orders: orders.supported,
      parent,
      paymentFieldMetadata: paymentFields,
      relationshipCounts: Object.freeze({ milestones: milestones.length, orders: orders.total }),
    });
    createdContexts.add(context);
    return context;
  }

  function normalizeSelectedOrdinals(value, context) {
    const values = denseArray(value, LIMITS.orders, 'ORDER_SELECTION_INVALID');
    if (values.length === 0) fail('ORDER_SELECTION_REQUIRED');
    const available = new Set(context.orders.map(order => order.ordinal));
    let previous = 0;
    const selected = values.map(raw => {
      const ordinal = exactInteger(raw, 1, LIMITS.orders, 'ORDER_SELECTION_INVALID');
      if (!available.has(ordinal) || ordinal <= previous) fail('ORDER_SELECTION_INVALID');
      previous = ordinal;
      return ordinal;
    });
    return Object.freeze(selected);
  }

  function normalizeMilestoneInputs(value, context) {
    const rows = denseArray(value, LIMITS.milestones, 'MILESTONE_INPUT_INVALID');
    if (rows.length !== context.milestones.length) fail('MILESTONE_INPUT_INVALID');
    const normalized = rows.map((rawRow, index) => {
      const input = exactObject(rawRow, MILESTONE_INPUT_KEYS, 'MILESTONE_INPUT_INVALID');
      const source = context.milestones[index];
      const ordinal = exactInteger(input.ordinal, 1, LIMITS.milestones, 'MILESTONE_INPUT_INVALID');
      if (ordinal !== index + 1 || ordinal !== source.ordinal) fail('MILESTONE_INPUT_INVALID');
      const percentageDetails = { field: 'percentage', ordinal };
      const percentage = boundedNumber(input.percentage, 0, 100, 'PERCENT_INVALID', { details: percentageDetails });
      if (round2(percentage) !== percentage) fail('PERCENT_PRECISION_INVALID', percentageDetails);
      const amountDetails = { field: 'amountReceived', ordinal };
      const discountDetails = { field: 'managementDiscount', ordinal };
      const dateDetails = { field: 'amountReceivedDate', ordinal };
      const amountReceived = optionalMoney(input.amountReceived, 'AMOUNT_RECEIVED_INVALID', 'AMOUNT_RECEIVED_PRECISION_INVALID', amountDetails);
      const managementDiscount = optionalMoney(input.managementDiscount, 'MANAGEMENT_DISCOUNT_INVALID', 'MANAGEMENT_DISCOUNT_PRECISION_INVALID', discountDetails);
      const amountReceivedDate = validDate(input.amountReceivedDate, 'AMOUNT_RECEIVED_DATE_INVALID', { details: dateDetails, optional: true });
      if (
        !source.detailAllowed
        && (amountReceived !== null || managementDiscount !== null || amountReceivedDate !== '')
      ) fail('COMPACT_DETAIL_FORBIDDEN', amountReceived !== null ? amountDetails : (managementDiscount !== null ? discountDetails : dateDetails));
      return Object.freeze({ amountReceived, amountReceivedDate, managementDiscount, ordinal, percentage });
    });
    const magppieTotal = round2(normalized.reduce((sum, row, index) => (
      context.milestones[index].classification === 'Magppie' ? sum + row.percentage : sum
    ), 0));
    if (magppieTotal !== 100) fail('PERCENT_TOTAL_INVALID');
    return Object.freeze({ magppieTotal, rows: Object.freeze(normalized) });
  }

  function milestoneFields(source, input) {
    const fields = { Percentage: input.percentage };
    if (source.detailAllowed) {
      if (input.amountReceived !== null) fields.Amount_Received_Now = input.amountReceived;
      if (input.managementDiscount !== null) fields.Management_Discount_Proposed = input.managementDiscount;
      if (input.amountReceivedDate) fields.Amount_Received_Date = input.amountReceivedDate;
    }
    return Object.freeze(fields);
  }

  function buildPlan(raw) {
    const input = exactObject(raw, INPUT_KEYS, 'INPUT_INVALID');
    if (!createdContexts.has(input.context)) fail('CONTEXT_INVALID');
    const selected = normalizeSelectedOrdinals(input.selectedOrderOrdinals, input.context);
    const estimatedHandoverDate = validDate(input.estimatedHandoverDate, 'HANDOVER_DATE_INVALID');
    const milestoneInputs = normalizeMilestoneInputs(input.milestones, input.context);
    const selectedSet = new Set(selected);
    const orderPlans = input.context.orders.filter(order => selectedSet.has(order.ordinal)).map(order => Object.freeze({
      execution: 'disabled',
      fields: Object.freeze({ Est_Handover_Date: estimatedHandoverDate }),
      intended_transition: Object.freeze({ name: CHILD_CONTRACT.transitionName }),
      order_label: order.label,
      product_type: order.productType,
      runtime_attestation: 'verified-read-only',
      source_stage: order.stage,
    }));
    const milestonePlans = input.context.milestones.map((source, index) => Object.freeze({
      classification: source.classification,
      execution: 'disabled',
      fields: milestoneFields(source, milestoneInputs.rows[index]),
      milestone_label: source.label,
      serial_number: source.serialNumber,
    }));
    const blockedOrders = input.context.blockedOrders.map(order => Object.freeze({
      order_label: order.label,
      product_type: order.productType || 'Not set',
      reason: order.reason,
      source_stage: order.stage || 'Not set',
    }));
    return Object.freeze({
      blocked_actions: Object.freeze([
        'milestone record updates',
        'workflow triggering',
        'child Blueprint transitions',
        'SUNROOOF custom action',
        'parent Blueprint continuation',
      ]),
      blocked_orders: Object.freeze(blockedOrders),
      milestone_plans: Object.freeze(milestonePlans),
      order_plans: Object.freeze(orderPlans),
      parent_transition: Object.freeze({
        continuation: 'disabled',
        current: PARENT_CONTRACT.currentDisplay,
        name: PARENT_CONTRACT.transitionName,
        next: PARENT_CONTRACT.nextDisplay,
        permissions: 'not evaluated',
      }),
      persistence: 'disabled',
      preview_only: true,
      totals: Object.freeze({
        blocked_orders: blockedOrders.length,
        magppie_percentage: milestoneInputs.magppieTotal,
        milestone_plans: milestonePlans.length,
        selected_orders: orderPlans.length,
      }),
    });
  }

  return Object.freeze({
    ClosureNewPreviewError,
    buildPlan,
    constants: Object.freeze({
      blockedSunrooofContract: BLOCKED_SUNROOOF_CONTRACT,
      childContract: CHILD_CONTRACT,
      contactFieldTypes: CONTACT_FIELD_TYPES,
      dealFieldTypes: DEAL_FIELD_TYPES,
      limits: LIMITS,
      parentContract: PARENT_CONTRACT,
      paymentFieldTypes: PAYMENT_FIELD_TYPES,
      supportedProducts: SUPPORTED_PRODUCTS,
    }),
    createContext,
  });
});
