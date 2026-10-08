(function attachDeployTeamReadinessPreview(root, createPreview) {
  'use strict';

  const preview = createPreview();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = preview;
    return;
  }
  if (!root || Object.prototype.hasOwnProperty.call(root, 'DeployTeamReadinessPreview')) {
    throw new Error('Deploy Team readiness preview namespace is unavailable.');
  }
  Object.defineProperty(root, 'DeployTeamReadinessPreview', {
    configurable: false,
    enumerable: true,
    value: preview,
    writable: false,
  });
})(typeof globalThis === 'object' ? globalThis : this, function createDeployTeamReadinessPreview() {
  'use strict';

  class DeployTeamReadinessPreviewError extends Error {
    constructor(code) {
      super('Deploy Team readiness preview input is invalid.');
      this.name = 'DeployTeamReadinessPreviewError';
      this.code = code;
    }
  }

  const LIMITS = Object.freeze({ options: 500, orders: 200, teams: 100 });
  const BUTTON_CONTRACT = Object.freeze({
    action: 'widget',
    actionReference: Object.freeze({
      id: '1032257000022961582',
      name: 'Deploy Team',
      type: 'widget',
    }),
    apiName: 'Assign_Visit_for_Installation',
    id: '1032257000022961587',
    layoutIds: Object.freeze(['1032257000000000171']),
    module: 'Contacts',
    name: 'Deploy Team for Installation',
    position: 'view',
    sequenceNumber: 3,
    source: 'crm',
  });
  const CONTACT_LAYOUT = Object.freeze({
    apiName: 'Standard__s',
    id: '1032257000000000171',
    name: 'Standard',
  });
  const VISIT_BLUEPRINT = Object.freeze({
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
  const ELIGIBLE_STAGE = 'Start First Installation Process';
  const UNAVAILABLE_GUARANTEES = Object.freeze([
    'Owner identity',
    'Permission eligibility',
    'Workflow effects',
    'Server validation',
    'Atomic Visit and link-row creation',
  ]);
  const FIELD_DESCRIPTOR_KEYS = Object.freeze([
    'apiName', 'dataType', 'fieldReadOnly', 'lookupApi', 'lookupModule', 'optionCount',
    'readOnly', 'requiredOptionPresent', 'systemMandatory',
  ]);
  const CONTEXT_KEYS = Object.freeze([
    'buttonContract', 'contactLayout', 'dealFieldMetadata', 'eligibleAttestations',
    'relationship', 'serviceFieldMetadata', 'visitBlueprint', 'visitFieldMetadata',
  ]);
  const BUTTON_KEYS = Object.freeze([
    'action', 'actionReference', 'apiName', 'id', 'layoutIds', 'module', 'name',
    'position', 'sequenceNumber', 'source',
  ]);
  const REFERENCE_KEYS = Object.freeze(['id', 'name', 'type']);
  const RELATIONSHIP_KEYS = Object.freeze([
    'availability', 'hasMore', 'limitApplied', 'linkBasis', 'linkFields', 'orders',
    'page', 'perPage', 'relatedModule', 'returned',
  ]);
  const ORDER_KEYS = Object.freeze(['ordinal', 'stage']);
  const BLUEPRINT_KEYS = Object.freeze([
    'blueprintId', 'blueprintName', 'entryField', 'entryOperator', 'entryValue',
    'fromActual', 'fromDisplay', 'initialState', 'module', 'stateField', 'status',
    'toActual', 'toDisplay', 'transitionId', 'transitionName',
  ]);
  const SELECTION_KEYS = Object.freeze([
    'managerOrdinal', 'orderOrdinals', 'taskOrdinal', 'teamOrdinals', 'visitDate',
  ]);
  const createdContexts = new WeakSet();

  function fail(code) {
    throw new DeployTeamReadinessPreviewError(code);
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
    let descriptors;
    try {
      if (Object.getPrototypeOf(value) !== Array.prototype) fail(code);
      descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
      fail(code);
    }
    const ownKeys = Reflect.ownKeys(descriptors);
    const length = descriptors.length?.value;
    if (
      ownKeys.some(key => typeof key !== 'string')
      || !Number.isSafeInteger(length)
      || length < 0
      || length > maxItems
      || ownKeys.length !== length + 1
    ) fail(code);
    const captured = new Array(length);
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value') || descriptor.enumerable !== true) fail(code);
      captured[index] = descriptor.value;
    }
    return Object.freeze(captured);
  }

  function boundedText(value, maxLength, code) {
    if (typeof value !== 'string') fail(code);
    const normalized = value.trim();
    if (!normalized || normalized.length > maxLength || /[\u0000-\u001f\u007f]/.test(normalized)) fail(code);
    return normalized;
  }

  function exactValue(actual, expected, code) {
    if (actual !== expected) fail(code);
    return actual;
  }

  function integer(value, minimum, maximum, code) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail(code);
    return value;
  }

  function uniqueOrdinals(value, maximum, code, { minimumItems = 1 } = {}) {
    const values = denseArray(value, LIMITS.orders, code).map(item => integer(item, 1, maximum, code));
    if (values.length < minimumItems || new Set(values).size !== values.length) fail(code);
    return Object.freeze([...values].sort((left, right) => left - right));
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Reflect.ownKeys(value).forEach(key => deepFreeze(value[key]));
    return Object.freeze(value);
  }

  function validateButton(input) {
    const button = exactObject(input, BUTTON_KEYS, 'BUTTON_CONTRACT_INVALID');
    const reference = exactObject(button.actionReference, REFERENCE_KEYS, 'BUTTON_CONTRACT_INVALID');
    const layouts = denseArray(button.layoutIds, 2, 'BUTTON_CONTRACT_INVALID');
    exactValue(button.action, BUTTON_CONTRACT.action, 'BUTTON_CONTRACT_INVALID');
    exactValue(reference.id, BUTTON_CONTRACT.actionReference.id, 'BUTTON_CONTRACT_INVALID');
    exactValue(reference.name, BUTTON_CONTRACT.actionReference.name, 'BUTTON_CONTRACT_INVALID');
    exactValue(reference.type, BUTTON_CONTRACT.actionReference.type, 'BUTTON_CONTRACT_INVALID');
    exactValue(button.apiName, BUTTON_CONTRACT.apiName, 'BUTTON_CONTRACT_INVALID');
    exactValue(button.id, BUTTON_CONTRACT.id, 'BUTTON_CONTRACT_INVALID');
    exactValue(button.module, BUTTON_CONTRACT.module, 'BUTTON_CONTRACT_INVALID');
    exactValue(button.name, BUTTON_CONTRACT.name, 'BUTTON_CONTRACT_INVALID');
    exactValue(button.position, BUTTON_CONTRACT.position, 'BUTTON_CONTRACT_INVALID');
    exactValue(button.sequenceNumber, BUTTON_CONTRACT.sequenceNumber, 'BUTTON_CONTRACT_INVALID');
    exactValue(button.source, BUTTON_CONTRACT.source, 'BUTTON_CONTRACT_INVALID');
    if (layouts.length !== 1 || layouts[0] !== CONTACT_LAYOUT.id) fail('BUTTON_CONTRACT_INVALID');
    return BUTTON_CONTRACT;
  }

  function metadataByName(input, code) {
    const rows = denseArray(input, 100, code);
    const result = new Map();
    rows.forEach(raw => {
      const row = exactObject(raw, FIELD_DESCRIPTOR_KEYS, code);
      const apiName = boundedText(row.apiName, 160, code);
      if (result.has(apiName)) fail(code);
      if (
        typeof row.fieldReadOnly !== 'boolean'
        || typeof row.readOnly !== 'boolean'
        || typeof row.systemMandatory !== 'boolean'
        || (row.requiredOptionPresent !== null && typeof row.requiredOptionPresent !== 'boolean')
        || (row.lookupApi !== null && typeof row.lookupApi !== 'string')
        || (row.lookupModule !== null && typeof row.lookupModule !== 'string')
      ) fail(code);
      result.set(apiName, Object.freeze({
        apiName,
        dataType: boundedText(row.dataType, 80, code),
        fieldReadOnly: row.fieldReadOnly === true,
        lookupApi: row.lookupApi === null ? null : boundedText(row.lookupApi, 160, code),
        lookupModule: row.lookupModule === null ? null : boundedText(row.lookupModule, 160, code),
        optionCount: integer(row.optionCount, 0, LIMITS.options, code),
        readOnly: row.readOnly === true,
        requiredOptionPresent: row.requiredOptionPresent === null ? null : row.requiredOptionPresent === true,
        systemMandatory: row.systemMandatory === true,
      }));
    });
    return result;
  }

  function requireField(fields, apiName, dataType, code, conditions = {}) {
    const field = fields.get(apiName);
    if (!field || field.dataType !== dataType) fail(code);
    Object.entries(conditions).forEach(([key, value]) => {
      if (field[key] !== value) fail(code);
    });
    return field;
  }

  function validateDealFields(input) {
    const fields = metadataByName(input, 'DEAL_METADATA_INVALID');
    if (fields.size !== 4) fail('DEAL_METADATA_INVALID');
    const stage = requireField(fields, 'Stage', 'picklist', 'DEAL_METADATA_INVALID', {
      fieldReadOnly: false, readOnly: false, requiredOptionPresent: true, systemMandatory: true,
    });
    const managers = requireField(fields, 'Installation_Managers', 'picklist', 'DEAL_METADATA_INVALID', {
      fieldReadOnly: false, readOnly: false, systemMandatory: false,
    });
    requireField(fields, 'Product_Name', 'text', 'DEAL_METADATA_INVALID', {
      fieldReadOnly: false, readOnly: false, systemMandatory: false,
    });
    const products = requireField(fields, 'Product_Type', 'picklist', 'DEAL_METADATA_INVALID', {
      fieldReadOnly: false, readOnly: false, systemMandatory: false,
    });
    if (stage.optionCount < 1 || managers.optionCount < 1 || products.optionCount < 1) fail('DEAL_METADATA_INVALID');
    return deepFreeze([...fields.values()]);
  }

  function validateVisitFields(input) {
    const fields = metadataByName(input, 'VISIT_METADATA_INVALID');
    if (fields.size !== 10) fail('VISIT_METADATA_INVALID');
    requireField(fields, 'Name', 'text', 'VISIT_METADATA_INVALID', {
      fieldReadOnly: false, readOnly: false, systemMandatory: true,
    });
    requireField(fields, 'Client_Name', 'lookup', 'VISIT_METADATA_INVALID', {
      fieldReadOnly: false, lookupModule: 'Contacts', readOnly: false, systemMandatory: false,
    });
    const clientAddress = requireField(fields, 'Client_Address', 'textarea', 'VISIT_METADATA_INVALID');
    if (clientAddress.readOnly || clientAddress.fieldReadOnly) fail('CLIENT_ADDRESS_READ_ONLY_CONFLICT');
    if (clientAddress.systemMandatory) fail('VISIT_METADATA_INVALID');
    const recordType = requireField(fields, 'Record_Type', 'picklist', 'VISIT_METADATA_INVALID', {
      fieldReadOnly: false, readOnly: false, requiredOptionPresent: true, systemMandatory: false,
    });
    const status = requireField(fields, 'AMS_Status', 'picklist', 'VISIT_METADATA_INVALID', {
      fieldReadOnly: false, readOnly: false, requiredOptionPresent: true, systemMandatory: false,
    });
    const manager = requireField(fields, 'Installation_Manager', 'picklist', 'VISIT_METADATA_INVALID', {
      fieldReadOnly: false, readOnly: false, systemMandatory: false,
    });
    const task = requireField(fields, 'Task_Name', 'picklist', 'VISIT_METADATA_INVALID', {
      fieldReadOnly: false, readOnly: false, systemMandatory: false,
    });
    const team = requireField(fields, 'Team_Member_Name', 'multiselectpicklist', 'VISIT_METADATA_INVALID', {
      fieldReadOnly: false, readOnly: false, systemMandatory: false,
    });
    requireField(fields, 'Assigned_Team_Member_Count', 'integer', 'VISIT_METADATA_INVALID', {
      fieldReadOnly: false, readOnly: false, systemMandatory: false,
    });
    requireField(fields, 'Scheduled_Visit_Date', 'date', 'VISIT_METADATA_INVALID', {
      fieldReadOnly: false, readOnly: false, systemMandatory: false,
    });
    if (
      recordType.optionCount < 1 || status.optionCount < 1 || manager.optionCount < 1
      || task.optionCount < 1 || team.optionCount < 1
    ) fail('VISIT_OPTIONS_UNAVAILABLE');
    return deepFreeze([...fields.values()]);
  }

  function validateServiceFields(input) {
    const fields = metadataByName(input, 'LINK_METADATA_INVALID');
    if (fields.size !== 2) fail('LINK_METADATA_INVALID');
    requireField(fields, 'Orders_Name', 'lookup', 'LINK_METADATA_INVALID', {
      fieldReadOnly: false, lookupApi: 'Service_Activities14', lookupModule: 'Deals', readOnly: false, systemMandatory: true,
    });
    requireField(fields, 'Installations_Services', 'lookup', 'LINK_METADATA_INVALID', {
      fieldReadOnly: false, lookupApi: 'Orders14', lookupModule: 'Visit_Module', readOnly: false, systemMandatory: true,
    });
    return deepFreeze([...fields.values()]);
  }

  function validateBlueprint(input) {
    const blueprint = exactObject(input, BLUEPRINT_KEYS, 'VISIT_BLUEPRINT_INVALID');
    Object.entries(VISIT_BLUEPRINT).forEach(([key, expected]) => exactValue(blueprint[key], expected, 'VISIT_BLUEPRINT_INVALID'));
    return VISIT_BLUEPRINT;
  }

  function validateOrders(input) {
    const relationship = exactObject(input, RELATIONSHIP_KEYS, 'ORDER_RELATIONSHIP_INVALID');
    exactValue(relationship.availability, 'queryable', 'ORDER_RELATIONSHIP_INVALID');
    exactValue(relationship.hasMore, false, 'ORDER_RELATIONSHIP_INVALID');
    exactValue(relationship.limitApplied, true, 'ORDER_RELATIONSHIP_INVALID');
    exactValue(relationship.linkBasis, 'Exact source lookup relation', 'ORDER_RELATIONSHIP_INVALID');
    exactValue(relationship.page, 1, 'ORDER_RELATIONSHIP_INVALID');
    exactValue(relationship.perPage, 200, 'ORDER_RELATIONSHIP_INVALID');
    exactValue(relationship.relatedModule, 'Deals', 'ORDER_RELATIONSHIP_INVALID');
    const links = denseArray(relationship.linkFields, 4, 'ORDER_RELATIONSHIP_INVALID');
    if (links.length !== 1 || links[0] !== 'Opportunity_Name') fail('ORDER_RELATIONSHIP_INVALID');
    const orders = denseArray(relationship.orders, LIMITS.orders, 'ORDER_RELATIONSHIP_INVALID').map((raw, index) => {
      const order = exactObject(raw, ORDER_KEYS, 'ORDER_RELATIONSHIP_INVALID');
      exactValue(order.ordinal, index + 1, 'ORDER_RELATIONSHIP_INVALID');
      const stage = boundedText(order.stage, 160, 'ORDER_RELATIONSHIP_INVALID');
      return Object.freeze({ ordinal: index + 1, stage });
    });
    exactValue(relationship.returned, orders.length, 'ORDER_RELATIONSHIP_INVALID');
    return Object.freeze({
      availability: 'queryable',
      hasMore: false,
      limitApplied: true,
      linkBasis: 'Exact source lookup relation',
      linkFields: Object.freeze(['Opportunity_Name']),
      orders: Object.freeze(orders),
      page: 1,
      perPage: 200,
      relatedModule: 'Deals',
      returned: orders.length,
    });
  }

  function validateAttestations(input, relationship) {
    const eligible = relationship.orders.filter(order => order.stage === ELIGIBLE_STAGE);
    const attestations = denseArray(input, LIMITS.orders, 'ORDER_ATTESTATION_INVALID').map((raw, index) => {
      const row = exactObject(raw, ORDER_KEYS, 'ORDER_ATTESTATION_INVALID');
      const expected = eligible[index];
      if (!expected || row.ordinal !== expected.ordinal || row.stage !== ELIGIBLE_STAGE) fail('ORDER_ATTESTATION_INVALID');
      return Object.freeze({ ordinal: row.ordinal, stage: ELIGIBLE_STAGE });
    });
    if (attestations.length !== eligible.length) fail('ORDER_ATTESTATION_INVALID');
    return Object.freeze(attestations);
  }

  function createContext(input) {
    const source = exactObject(input, CONTEXT_KEYS, 'CONTEXT_INVALID');
    const relationship = validateOrders(source.relationship);
    const context = Object.freeze({
      buttonContract: validateButton(source.buttonContract),
      contactLayout: exactValue(source.contactLayout, CONTACT_LAYOUT.name, 'CONTACT_LAYOUT_INVALID'),
      dealFieldMetadata: validateDealFields(source.dealFieldMetadata),
      eligibleAttestations: validateAttestations(source.eligibleAttestations, relationship),
      relationship,
      serviceFieldMetadata: validateServiceFields(source.serviceFieldMetadata),
      visitBlueprint: validateBlueprint(source.visitBlueprint),
      visitFieldMetadata: validateVisitFields(source.visitFieldMetadata),
    });
    createdContexts.add(context);
    return context;
  }

  function field(context, apiName) {
    return context.visitFieldMetadata.find(item => item.apiName === apiName);
  }

  function validIsoDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function buildPlan(input) {
    const source = exactObject(input, ['context', 'selection'], 'PLAN_INVALID');
    if (!createdContexts.has(source.context)) fail('CONTEXT_INVALID');
    const selection = exactObject(source.selection, SELECTION_KEYS, 'SELECTION_INVALID');
    const eligibleOrdinals = new Set(source.context.eligibleAttestations.map(order => order.ordinal));
    const orderOrdinals = uniqueOrdinals(selection.orderOrdinals, LIMITS.orders, 'ORDER_SELECTION_INVALID');
    if (orderOrdinals.some(ordinal => !eligibleOrdinals.has(ordinal))) fail('ORDER_SELECTION_INVALID');
    const managerCount = field(source.context, 'Installation_Manager').optionCount;
    const taskCount = field(source.context, 'Task_Name').optionCount;
    const teamCount = field(source.context, 'Team_Member_Name').optionCount;
    const managerOrdinal = integer(selection.managerOrdinal, 1, managerCount, 'MANAGER_SELECTION_INVALID');
    const taskOrdinal = integer(selection.taskOrdinal, 1, taskCount, 'TASK_SELECTION_INVALID');
    const teamOrdinals = uniqueOrdinals(selection.teamOrdinals, teamCount, 'TEAM_SELECTION_INVALID', {
      minimumItems: 1,
    });
    if (teamOrdinals.length > LIMITS.teams) fail('TEAM_SELECTION_INVALID');
    if (!validIsoDate(selection.visitDate)) fail('VISIT_DATE_INVALID');

    const plan = {
      linkRows: orderOrdinals.map((ordinal, index) => ({
        linkRow: `Link row ${index + 1}`,
        order: `Order ${ordinal}`,
      })),
      notPersisted: true,
      status: 'display-only',
      totals: {
        eligibleOrders: source.context.eligibleAttestations.length,
        linkRows: orderOrdinals.length,
        selectedOrders: orderOrdinals.length,
        selectedTeamOptions: teamOrdinals.length,
      },
      unavailable: [...UNAVAILABLE_GUARANTEES],
      visit: {
        assignedTeamMemberCount: teamOrdinals.length,
        initialStage: VISIT_BLUEPRINT.initialState,
        managerOption: `Manager option ${managerOrdinal}`,
        orderOptions: orderOrdinals.map(ordinal => `Order ${ordinal}`),
        recordType: VISIT_BLUEPRINT.entryValue,
        scheduledVisitDate: selection.visitDate,
        taskOption: `Task option ${taskOrdinal}`,
        teamOptions: teamOrdinals.map(ordinal => `Team option ${ordinal}`),
      },
    };
    return deepFreeze(plan);
  }

  return Object.freeze({
    DeployTeamReadinessPreviewError,
    buildPlan,
    constants: Object.freeze({
      buttonContract: BUTTON_CONTRACT,
      contactLayout: CONTACT_LAYOUT,
      eligibleStage: ELIGIBLE_STAGE,
      limits: LIMITS,
      parentBlueprint: 'not-applicable',
      unavailableGuarantees: UNAVAILABLE_GUARANTEES,
      visitBlueprint: VISIT_BLUEPRINT,
    }),
    createContext,
  });
});
