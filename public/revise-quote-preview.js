(function attachReviseQuotePreview(root, createPreview) {
  'use strict';

  const preview = createPreview();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = preview;
    return;
  }
  if (!root || Object.prototype.hasOwnProperty.call(root, 'ReviseQuotePreview')) {
    throw new Error('Revise Quote preview namespace is unavailable.');
  }
  Object.defineProperty(root, 'ReviseQuotePreview', {
    configurable: false,
    enumerable: true,
    value: preview,
  });
})(typeof globalThis === 'object' ? globalThis : this, function createReviseQuotePreview() {
  'use strict';

  class ReviseQuotePreviewError extends Error {
    constructor(code) {
      super('Revise Quote preview input is invalid.');
      this.name = 'ReviseQuotePreviewError';
      this.code = code;
    }
  }

  const LIMITS = Object.freeze({
    orders: 200,
    fieldMetadata: 20,
    fieldOptions: 160,
    ceilingHeight: 64,
  });
  const PARENT_CONTRACT = Object.freeze({
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
  const CHILD_TRANSITIONS = Object.freeze(Object.fromEntries(
    CHILD_BLUEPRINT_CONTRACT.transitions.map(transition => [
      transition.action,
      Object.freeze({ id: transition.id, name: transition.name }),
    ]),
  ));
  const CONTEXT_KEYS = Object.freeze(['childTransitionContract', 'contactFieldMetadata', 'dealFieldMetadata', 'relationship']);
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
  const FIELD_METADATA_KEYS = Object.freeze(['apiName', 'dataType', 'options']);
  const INPUT_KEYS = Object.freeze(['context', 'orders']);
  const ORDER_INPUT_KEYS = Object.freeze([
    'action',
    'ceilingHeight',
    'designRequiredOn',
    'designTheme',
    'gas',
    'island',
    'kitchenHeight',
    'kitchenTypes',
    'ordinal',
    'presentation',
    'reason',
    'vastu',
    'wardrobeHeight',
    'wardrobeTypes',
  ]);
  const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
  const CONTROL = /[\u0000-\u001f\u007f]/;
  const createdContexts = new WeakSet();

  const DEFAULT_THEMES = Object.freeze(['Modern PG1', 'Modern PG2', 'Classic PG1', 'Classic PG2']);
  const SUNROOOF_THEMES = Object.freeze([
    'Classical White',
    'Classical Wood - Teak',
    'Classical Wood - Raw',
    'Modern Wooden - Teak',
    'Modern Wooden - Raw',
    'Modern White',
    'Modern Bronze',
    'Modern Grey',
    'Fluted Minimalist Wooden - Teak',
    'Fluted Minimalist Wooden - Raw',
    'Fluted Minimalist White',
    'Fluted Minimalist Grey',
    'Fluted Minimalist Bronze',
    'French Window White',
    'Louvered Window White',
    'Classical Atrium White',
    'Classical Atrium Wooden - Teak',
    'Classical Atrium Wooden - Raw',
    'Fluted Minimalist Atrium Wooden - Teak',
    'Fluted Minimalist Atrium Wooden - Raw',
    'Fluted Minimalist Atrium White',
    'Fluted Minimalist Atrium Bronze',
    'Fluted Minimalist Atrium Grey',
    'Arch Window White',
    'Double Arch Window White',
  ]);
  const PRESENTATIONS = Object.freeze({
    Kitchen: Object.freeze(['Kitchen 3D', 'Kitchen L & F', 'Kitchen L & F + EST', 'Kitchen EST', 'Kitchen 3D + EST']),
    Wardrobe: Object.freeze(['Wardrobe 3D', 'Wardrobe L & F', 'Wardrobe L & F + EST', 'Wardrobe EST', 'Wardrobe 3D + EST']),
    SUNROOOF: Object.freeze(['Sunrooof 3D', 'Sunrooof L & F', 'Sunrooof L & F + EST', 'Sunrooof EST', 'Sunrooof 3D + EST']),
    'Countertop / Backplash': Object.freeze(['Laundry Area 3D', 'Laundry Area L & F', 'Laundry Area L & F + EST', 'Laundry Area EST', 'Laundry Area 3D + EST']),
    Pantry: Object.freeze(['Pantry / Utility 3D', 'Pantry / Utility L & F', 'Pantry / Utility L & F + EST', 'Pantry / Utility EST', 'Pantry / Utility 3D + EST']),
  });
  const KITCHEN_TYPES = Object.freeze(['Chef', 'Show', 'Storage', 'Laundry', 'Utility']);
  const KITCHEN_HEIGHTS = Object.freeze(['2500', '2140']);
  const ISLAND_OPTIONS = Object.freeze(['No', 'Both Side Storage', 'One side storage & one side sitting']);
  const GAS_OPTIONS = Object.freeze(['Piped Gas', 'Cylinder inside kitchen', 'Cylinder outside kitchen']);
  const VASTU_OPTIONS = Object.freeze(['Yes', 'No']);
  const WARDROBE_TYPES = Object.freeze(['Glass Hinged', 'Solid Hinged']);
  const WARDROBE_HEIGHTS = Object.freeze(['8', '9']);
  const REVISION_REASONS = Object.freeze([
    'New Items to be added',
    'Budget to be reduced',
    'Requirements were not clear',
    'Layout was incomplete',
    'Civil sizes changed later',
    'Decision maker changed',
    'Vaastu Issue',
    'Design is not as per brief',
    'Immpractial design',
    'Estimate Error',
    'Price List Revised',
    'Product discontinued',
    'Add newly launched product',
    'Appliance/ Accessory missing',
    'Design Manager changed',
    'Incomplete breif shared to designere',
    'Special approval - Management',
    'Sales manager changed',
  ]);
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
  const BASE_DEAL_FIELDS = Object.freeze([
    'Stage',
    'Product_Type',
    'Design_Presentation',
    'Design_Theme',
    'Finished_Kitchen_Ceiling_Height',
    'Design_Required_on',
    'Reason_for_Design_Revision1',
  ]);
  const KITCHEN_FIELDS = Object.freeze([
    'Any_Vastu_requirement',
    'Gas_Arrangement',
    'Kitchen_Type',
    'Kitche_Height',
    'Island',
  ]);
  const WARDROBE_FIELDS = Object.freeze(['Wardrobe_Type', 'Wardrobe_Height']);

  function fail(code) {
    throw new ReviseQuotePreviewError(code);
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

  function validDate(value, code) {
    const text = boundedText(value, 10, code);
    const match = text.match(DATE);
    if (!match) fail(code);
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) fail(code);
    return text;
  }

  function normalizeOptions(value, code) {
    const options = denseArray(value, LIMITS.fieldOptions, code).map(option => boundedText(option, 160, code));
    if (new Set(options).size !== options.length) fail(code);
    return Object.freeze(options);
  }

  function normalizeFieldMetadata(value, expectedTypes, code) {
    const fields = denseArray(value, LIMITS.fieldMetadata, code).map(raw => {
      const field = exactObject(raw, FIELD_METADATA_KEYS, code);
      const apiName = boundedText(field.apiName, 80, code);
      const dataType = boundedText(field.dataType, 40, code);
      if (!Object.prototype.hasOwnProperty.call(expectedTypes, apiName) || expectedTypes[apiName] !== dataType) fail(code);
      const options = normalizeOptions(field.options, code);
      const optionField = dataType === 'picklist' || dataType === 'multiselectpicklist';
      if ((optionField && options.length === 0) || (!optionField && options.length !== 0)) fail(code);
      return Object.freeze({ apiName, dataType, options });
    });
    if (new Set(fields.map(field => field.apiName)).size !== fields.length) fail(code);
    return Object.freeze(fields);
  }

  function metadataMap(fields) {
    return new Map(fields.map(field => [field.apiName, field]));
  }

  function intersection(sourceOptions, metadataOptions) {
    return Object.freeze(sourceOptions.filter(option => metadataOptions.includes(option)));
  }

  function requireMetadata(fields, names) {
    const available = new Set(fields.map(field => field.apiName));
    if (names.some(name => !available.has(name))) fail('REQUIRED_METADATA_MISSING');
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
    const normalizedRows = Object.freeze(rows.map((rawRow, index) => {
      const row = exactObject(rawRow, ORDER_DESCRIPTOR_KEYS, 'ORDER_DESCRIPTOR_INVALID');
      const ordinal = exactInteger(row.ordinal, 1, LIMITS.orders, 'ORDER_ORDINAL_INVALID');
      if (ordinal !== index + 1) fail('ORDER_ORDINAL_INVALID');
      const stage = boundedText(row.stage, 120, 'STAGE_INVALID', { optional: true });
      const productType = boundedText(row.productType, 120, 'PRODUCT_TYPE_INVALID', { optional: true });
      if (stage === 'Requirement From SM' || stage === 'Assign Designer') fail('STAGE_DISPLAY_DRIFT');
      return Object.freeze({ ordinal, productType, stage });
    }));
    return Object.freeze({ linkFields: Object.freeze([...linkFields]), rows: normalizedRows });
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
      const transition = exactObject(
        rawTransition,
        CHILD_TRANSITION_CONTRACT_KEYS,
        'CHILD_TRANSITION_CONTRACT_DRIFT',
      );
      const expected = CHILD_BLUEPRINT_CONTRACT.transitions[index];
      if (CHILD_TRANSITION_CONTRACT_KEYS.some(key => transition[key] !== expected[key])) {
        fail('CHILD_TRANSITION_CONTRACT_DRIFT');
      }
    });
  }

  function createContext(raw) {
    const input = exactObject(raw, CONTEXT_KEYS, 'CONTEXT_INVALID');
    validateChildTransitionContract(input.childTransitionContract);
    const contactFields = normalizeFieldMetadata(input.contactFieldMetadata, CONTACT_FIELD_TYPES, 'CONTACT_METADATA_INVALID');
    const dealFields = normalizeFieldMetadata(input.dealFieldMetadata, DEAL_FIELD_TYPES, 'DEAL_METADATA_INVALID');
    requireMetadata(contactFields, ['Stage']);
    const contactMap = metadataMap(contactFields);
    if (
      !contactMap.get('Stage').options.includes(PARENT_CONTRACT.currentDisplay)
      || !contactMap.get('Stage').options.includes(PARENT_CONTRACT.currentActual)
    ) fail('PARENT_STAGE_METADATA_DRIFT');

    const relation = normalizeRelationship(input.relationship);
    const supportedRows = relation.rows.filter(row => row.stage === 'Sent for Approval');
    const unsupportedNone = relation.rows.filter(row => row.stage === 'None').length;
    const unsupportedQuery = relation.rows.filter(row => row.stage === 'Query to SM').length;
    const ignoredCount = relation.rows.length - supportedRows.length - unsupportedNone - unsupportedQuery;
    supportedRows.forEach(row => {
      if (!Object.prototype.hasOwnProperty.call(PRESENTATIONS, row.productType)) fail('PRODUCT_TYPE_UNSUPPORTED');
    });

    const requiredFields = new Set(BASE_DEAL_FIELDS);
    if (supportedRows.some(row => row.productType === 'Kitchen')) KITCHEN_FIELDS.forEach(field => requiredFields.add(field));
    if (supportedRows.some(row => row.productType === 'Wardrobe')) WARDROBE_FIELDS.forEach(field => requiredFields.add(field));
    requireMetadata(dealFields, [...requiredFields]);
    const dealMap = metadataMap(dealFields);
    if (
      !dealMap.get('Stage').options.includes('Sent for Approval')
      || !dealMap.get('Stage').options.includes('None')
      || !dealMap.get('Stage').options.includes('Query to SM')
    ) fail('DEAL_STAGE_METADATA_DRIFT');
    supportedRows.forEach(row => {
      if (!dealMap.get('Product_Type').options.includes(row.productType)) fail('PRODUCT_TYPE_METADATA_DRIFT');
    });

    const revisionReasons = intersection(REVISION_REASONS, dealMap.get('Reason_for_Design_Revision1').options);
    if (revisionReasons.length === 0) fail('REVISION_REASON_METADATA_DRIFT');
    const optionSets = Object.freeze({
      kitchenTypes: supportedRows.some(row => row.productType === 'Kitchen')
        ? intersection(KITCHEN_TYPES, dealMap.get('Kitchen_Type').options) : Object.freeze([]),
      kitchenHeights: supportedRows.some(row => row.productType === 'Kitchen')
        ? intersection(KITCHEN_HEIGHTS, dealMap.get('Kitche_Height').options) : Object.freeze([]),
      islandOptions: supportedRows.some(row => row.productType === 'Kitchen')
        ? intersection(ISLAND_OPTIONS, dealMap.get('Island').options) : Object.freeze([]),
      gasOptions: supportedRows.some(row => row.productType === 'Kitchen')
        ? intersection(GAS_OPTIONS, dealMap.get('Gas_Arrangement').options) : Object.freeze([]),
      vastuOptions: supportedRows.some(row => row.productType === 'Kitchen')
        ? intersection(VASTU_OPTIONS, dealMap.get('Any_Vastu_requirement').options) : Object.freeze([]),
      wardrobeTypes: supportedRows.some(row => row.productType === 'Wardrobe')
        ? intersection(WARDROBE_TYPES, dealMap.get('Wardrobe_Type').options) : Object.freeze([]),
      wardrobeHeights: supportedRows.some(row => row.productType === 'Wardrobe')
        ? intersection(WARDROBE_HEIGHTS, dealMap.get('Wardrobe_Height').options) : Object.freeze([]),
    });
    if (
      (supportedRows.some(row => row.productType === 'Kitchen')
        && [optionSets.kitchenTypes, optionSets.kitchenHeights, optionSets.islandOptions, optionSets.gasOptions, optionSets.vastuOptions]
          .some(options => options.length === 0))
      || (supportedRows.some(row => row.productType === 'Wardrobe')
        && [optionSets.wardrobeTypes, optionSets.wardrobeHeights].some(options => options.length === 0))
    ) fail('PRODUCT_OPTIONS_METADATA_DRIFT');
    const orders = Object.freeze(supportedRows.map(row => {
      const presentationOptions = intersection(PRESENTATIONS[row.productType], dealMap.get('Design_Presentation').options);
      const themeOptions = intersection(
        row.productType === 'SUNROOOF' ? SUNROOOF_THEMES : DEFAULT_THEMES,
        dealMap.get('Design_Theme').options,
      );
      if (presentationOptions.length === 0 || themeOptions.length === 0) fail('PRODUCT_OPTIONS_METADATA_DRIFT');
      return Object.freeze({
        ordinal: row.ordinal,
        label: `Order ${row.ordinal}`,
        productType: row.productType,
        stage: 'Sent for Approval',
        presentationOptions,
        themeOptions,
      });
    }));
    const context = Object.freeze({
      contactFieldMetadata: contactFields,
      dealFieldMetadata: dealFields,
      orders,
      revisionReasons,
      optionSets,
      unsupportedBranches: Object.freeze({ None: unsupportedNone, Query_to_SM: unsupportedQuery }),
      ignoredOrders: ignoredCount,
    });
    createdContexts.add(context);
    return context;
  }

  function supportedOption(value, options, code) {
    const normalized = boundedText(value, 160, code);
    if (normalized === '-None-' || !options.includes(normalized)) fail(code);
    return normalized;
  }

  function supportedSelections(value, options, code) {
    const values = denseArray(value, options.length, code).map(item => boundedText(item, 120, code));
    if (values.length === 0 || new Set(values).size !== values.length || values.some(item => !options.includes(item))) fail(code);
    return Object.freeze(values);
  }

  function requireEmpty(value, code) {
    if (value !== '') fail(code);
  }

  function requireEmptyArray(value, code) {
    if (denseArray(value, LIMITS.fieldOptions, code).length !== 0) fail(code);
  }

  function assertSkippedInput(input) {
    [
      input.ceilingHeight,
      input.designRequiredOn,
      input.designTheme,
      input.gas,
      input.island,
      input.kitchenHeight,
      input.presentation,
      input.reason,
      input.vastu,
      input.wardrobeHeight,
    ].forEach(value => requireEmpty(value, 'SKIPPED_VALUES_PRESENT'));
    requireEmptyArray(input.kitchenTypes, 'SKIPPED_VALUES_PRESENT');
    requireEmptyArray(input.wardrobeTypes, 'SKIPPED_VALUES_PRESENT');
  }

  function buildFields(input, order) {
    const fields = {
      Design_Presentation: supportedOption(input.presentation, order.presentationOptions, 'PRESENTATION_UNSUPPORTED'),
      Design_Theme: supportedOption(input.designTheme, order.themeOptions, 'THEME_UNSUPPORTED'),
      Finished_Kitchen_Ceiling_Height: boundedText(input.ceilingHeight, LIMITS.ceilingHeight, 'CEILING_HEIGHT_REQUIRED'),
      Design_Required_on: validDate(input.designRequiredOn, 'DESIGN_DATE_INVALID'),
    };
    if (input.action === 'Revise Quotes') {
      fields.Reason_for_Design_Revision1 = supportedOption(input.reason, input.contextReasons, 'REVISION_REASON_REQUIRED');
    } else {
      requireEmpty(input.reason, 'APPROVAL_REVISION_DATA_FORBIDDEN');
    }
    if (order.productType === 'Kitchen') {
      fields.Any_Vastu_requirement = supportedOption(input.vastu, input.contextOptions.vastuOptions, 'VASTU_UNSUPPORTED');
      fields.Gas_Arrangement = supportedOption(input.gas, input.contextOptions.gasOptions, 'GAS_UNSUPPORTED');
      fields.Kitchen_Type = supportedSelections(input.kitchenTypes, input.contextOptions.kitchenTypes, 'KITCHEN_TYPE_REQUIRED');
      fields.Kitche_Height = supportedOption(input.kitchenHeight, input.contextOptions.kitchenHeights, 'KITCHEN_HEIGHT_UNSUPPORTED');
      fields.Island = supportedOption(input.island, input.contextOptions.islandOptions, 'ISLAND_UNSUPPORTED');
      requireEmptyArray(input.wardrobeTypes, 'NON_APPLICABLE_VALUES');
      requireEmpty(input.wardrobeHeight, 'NON_APPLICABLE_VALUES');
    } else if (order.productType === 'Wardrobe') {
      fields.Wardrobe_Type = supportedSelections(input.wardrobeTypes, input.contextOptions.wardrobeTypes, 'WARDROBE_TYPE_REQUIRED');
      fields.Wardrobe_Height = supportedOption(input.wardrobeHeight, input.contextOptions.wardrobeHeights, 'WARDROBE_HEIGHT_UNSUPPORTED');
      requireEmptyArray(input.kitchenTypes, 'NON_APPLICABLE_VALUES');
      [input.kitchenHeight, input.island, input.gas, input.vastu].forEach(value => requireEmpty(value, 'NON_APPLICABLE_VALUES'));
    } else {
      requireEmptyArray(input.kitchenTypes, 'NON_APPLICABLE_VALUES');
      requireEmptyArray(input.wardrobeTypes, 'NON_APPLICABLE_VALUES');
      [input.kitchenHeight, input.island, input.gas, input.vastu, input.wardrobeHeight].forEach(value => requireEmpty(value, 'NON_APPLICABLE_VALUES'));
    }
    return Object.freeze(fields);
  }

  function buildPlan(raw) {
    const input = exactObject(raw, INPUT_KEYS, 'INPUT_INVALID');
    if (!createdContexts.has(input.context)) fail('CONTEXT_INVALID');
    const context = input.context;
    const values = denseArray(input.orders, LIMITS.orders, 'ORDER_VALUES_INVALID');
    if (values.length !== context.orders.length) fail('ORDER_COUNT_MISMATCH');
    let skippedOrders = 0;
    const plans = [];
    values.forEach((rawOrder, index) => {
      const value = exactObject(rawOrder, ORDER_INPUT_KEYS, 'ORDER_VALUE_INVALID');
      const order = context.orders[index];
      exactInteger(value.ordinal, 1, LIMITS.orders, 'ORDER_ORDINAL_INVALID');
      if (value.ordinal !== order.ordinal) fail('ORDER_ORDINAL_INVALID');
      const action = boundedText(value.action, 40, 'ACTION_INVALID');
      if (action === 'Skip') {
        assertSkippedInput(value);
        skippedOrders += 1;
        return;
      }
      if (!Object.prototype.hasOwnProperty.call(CHILD_TRANSITIONS, action)) fail('ACTION_INVALID');
      const fields = buildFields(Object.assign(Object.create(null), value, {
        contextOptions: context.optionSets,
        contextReasons: context.revisionReasons,
      }), order);
      plans.push(Object.freeze({
        order_label: order.label,
        product_type: order.productType,
        source_stage: order.stage,
        decision: action,
        intended_transition: CHILD_TRANSITIONS[action],
        fields,
      }));
    });
    if (plans.length === 0) fail('PLAN_REQUIRED');
    const frozenPlans = Object.freeze(plans);
    return Object.freeze({
      preview_only: true,
      persistence: 'disabled',
      source_execution: 'disabled',
      plans: frozenPlans,
      skipped_orders: skippedOrders,
      unsupported_orders: context.unsupportedBranches,
      ignored_orders: context.ignoredOrders,
      blocked_actions: Object.freeze([
        'Order update',
        'Note creation',
        'Attachment upload',
        'Workflow trigger',
        'Child Blueprint continuation',
        'Parent Blueprint continuation',
        'SDK or provider request',
      ]),
    });
  }

  Object.freeze(ReviseQuotePreviewError.prototype);
  Object.freeze(ReviseQuotePreviewError);
  return Object.freeze({
    ReviseQuotePreviewError,
    constants: Object.freeze({
      limits: LIMITS,
      parentContract: PARENT_CONTRACT,
      childBlueprintContract: CHILD_BLUEPRINT_CONTRACT,
      childTransitions: CHILD_TRANSITIONS,
      contactFieldTypes: CONTACT_FIELD_TYPES,
      dealFieldTypes: DEAL_FIELD_TYPES,
      productTypes: Object.freeze(Object.keys(PRESENTATIONS)),
      kitchenTypes: KITCHEN_TYPES,
      kitchenHeights: KITCHEN_HEIGHTS,
      islandOptions: ISLAND_OPTIONS,
      gasOptions: GAS_OPTIONS,
      vastuOptions: VASTU_OPTIONS,
      wardrobeTypes: WARDROBE_TYPES,
      wardrobeHeights: WARDROBE_HEIGHTS,
      actions: Object.freeze(['Skip', 'Revise Quotes', 'Approved Quote']),
    }),
    createContext,
    buildPlan,
  });
});
