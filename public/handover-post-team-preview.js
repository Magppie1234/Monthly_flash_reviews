(function attachHandoverPostTeamPreview(root, createPreview) {
  'use strict';

  const preview = createPreview();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = preview;
    return;
  }
  if (!root || Object.prototype.hasOwnProperty.call(root, 'HandoverPostTeamPreview')) {
    throw new Error('Handover To Post Team preview namespace is unavailable.');
  }
  Object.defineProperty(root, 'HandoverPostTeamPreview', {
    configurable: false,
    enumerable: true,
    value: preview,
  });
})(typeof globalThis === 'object' ? globalThis : this, function createHandoverPostTeamPreview() {
  'use strict';

  class HandoverPostTeamPreviewError extends Error {
    constructor(code, details = null) {
      super('Handover To Post Team preview evidence is invalid.');
      this.name = 'HandoverPostTeamPreviewError';
      this.code = code;
      this.details = details && Number.isInteger(details.ordinal)
        ? Object.freeze({ ordinal: details.ordinal })
        : null;
    }
  }

  function deepFreeze(value, seen = new WeakSet()) {
    if (!value || (typeof value !== 'object' && typeof value !== 'function') || seen.has(value)) return value;
    seen.add(value);
    Reflect.ownKeys(value).forEach(key => deepFreeze(value[key], seen));
    return Object.freeze(value);
  }

  const LIMITS = deepFreeze({
    amsBlueprints: 2,
    amsTransitions: 32,
    fields: 14,
    layouts: 32,
    options: 10000,
    orders: 200,
    text: 255,
  });
  const PARENT_CONTRACT = deepFreeze({
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
  const CHILD_CONTRACT = deepFreeze({
    afterActions: [
      {
        details: {
          fieldApiName: 'First_Service_Date',
          fieldLabel: 'First Service Date',
          value: '${EXECUTION_DAY}+0',
        },
        id: '1032257000023782515',
        name: 'Set First Service Date',
        type: 'field_update',
      },
    ],
    blueprintId: '1032257000000535747',
    blueprintName: 'Order Stages',
    currentActual: 'Second Installation Done',
    currentDisplay: 'Second Installation Done',
    duringInputs: [
      {
        apiName: null,
        checklist: {
          items: [{ name: 'Handover Certificate', required: true }],
          title: 'Handover File',
        },
        dataType: 'checklist',
        kind: 'checklist',
        label: 'Handover File',
        required: true,
        sequence: 1,
      },
      {
        apiName: 'MDR_Done',
        dataType: 'date',
        kind: 'field',
        label: 'MDR Done',
        required: true,
        sequence: 2,
      },
      {
        apiName: 'Internal_QC',
        dataType: 'integer',
        kind: 'field',
        label: 'Internal QC',
        required: true,
        sequence: 3,
      },
    ],
    layoutId: '1032257000000000173',
    layoutName: 'Standard',
    module: 'Deals',
    nextActual: 'Final Handover',
    nextDisplay: 'Final Handover',
    stateField: 'Stage',
    status: 'Active',
    transitionId: '1032257000008339350',
    transitionName: 'Final Handover',
  });
  const PARENT_DURING_INPUTS = deepFreeze([
    {
      apiName: null,
      dataType: 'widget',
      kind: 'widget',
      label: 'Handover To Post Team',
      required: false,
      sequence: 1,
    },
  ]);
  const RELATIONSHIP_CONTRACT = deepFreeze({
    availability: 'queryable',
    hasMore: false,
    limitApplied: true,
    linkBasis: 'Exact source lookup relation',
    linkFields: ['Opportunity_Name'],
    page: 1,
    perPage: 200,
    relatedModule: 'Deals',
  });
  const AMS_CONTRACT = deepFreeze({
    blueprints: [
      {
        blueprintId: '1032257000023614991',
        blueprintName: 'Complaint Flow - Installation',
        transitionCount: 10,
      },
      {
        blueprintId: '1032257000023685467',
        blueprintName: 'AMS/Complaint Flow',
        transitionCount: 15,
      },
    ],
    layoutId: '1032257000023545362',
    layoutName: 'Standard',
    module: 'AMS_Complaints',
    plannedStage: 'Planned',
    stateField: 'Stage',
    status: 'Active',
  });
  const CONTACT_FIELD_SCHEMAS = deepFreeze({
    Stage: {
      dataType: 'picklist',
      length: 120,
      readOnly: false,
      relatedModule: null,
      requiredOptions: ['Second Installation Done', 'Final Handover'],
      systemMandatory: false,
    },
  });
  const DEAL_FIELD_SCHEMAS = deepFreeze({
    Stage: {
      dataType: 'picklist',
      length: 120,
      readOnly: false,
      relatedModule: null,
      requiredOptions: ['Second Installation Done', 'Final Handover'],
      systemMandatory: true,
    },
    MDR_Done: {
      dataType: 'date',
      length: 20,
      readOnly: false,
      relatedModule: null,
      requiredOptions: [],
      systemMandatory: false,
    },
    Internal_QC: {
      dataType: 'integer',
      length: 9,
      readOnly: false,
      relatedModule: null,
      requiredOptions: [],
      systemMandatory: false,
    },
    First_Service_Date: {
      dataType: 'date',
      length: 20,
      readOnly: false,
      relatedModule: null,
      requiredOptions: [],
      systemMandatory: false,
    },
  });
  const AMS_FIELD_SCHEMAS = deepFreeze({
    Name: { dataType: 'text', length: 120, readOnly: false, relatedModule: null, requiredOptions: [], systemMandatory: true },
    Client_Name: { dataType: 'lookup', length: 120, readOnly: false, relatedModule: 'Contacts', requiredOptions: [], systemMandatory: false },
    Record_Type: { dataType: 'picklist', length: 120, readOnly: false, relatedModule: null, requiredOptions: ['AMS'], systemMandatory: false },
    Owner: { dataType: 'ownerlookup', length: 120, readOnly: true, relatedModule: null, requiredOptions: [], systemMandatory: false },
    Client_Mobile: { dataType: 'phone', length: 30, readOnly: false, relatedModule: null, requiredOptions: [], systemMandatory: false },
    AMS_Date: { dataType: 'date', length: 20, readOnly: false, relatedModule: null, requiredOptions: [], systemMandatory: false },
    Client_Address_City: { dataType: 'text', length: 255, readOnly: false, relatedModule: null, requiredOptions: [], systemMandatory: false },
    Client_Address_Street_Address: { dataType: 'text', length: 255, readOnly: false, relatedModule: null, requiredOptions: [], systemMandatory: false },
    Client_Address_Zip_Postal_Code: { dataType: 'text', length: 255, readOnly: false, relatedModule: null, requiredOptions: [], systemMandatory: false },
    Client_Address_Country_Region: { dataType: 'picklist', length: 120, readOnly: false, relatedModule: null, requiredOptions: [], systemMandatory: false },
    Client_Address_State_Province: { dataType: 'picklist', length: 120, readOnly: false, relatedModule: null, requiredOptions: [], systemMandatory: false },
    Order_Ids: { dataType: 'text', length: 255, readOnly: false, relatedModule: null, requiredOptions: [], systemMandatory: false },
    Order_Names: { dataType: 'text', length: 255, readOnly: false, relatedModule: null, requiredOptions: [], systemMandatory: false },
    Stage: { dataType: 'picklist', length: 120, readOnly: false, relatedModule: null, requiredOptions: ['Planned'], systemMandatory: false },
  });

  const EVIDENCE_KEYS = deepFreeze([
    'amsBlueprintCatalog',
    'amsFieldMetadata',
    'amsLayoutCatalog',
    'contactFieldMetadata',
    'contactLayoutCatalog',
    'dealFieldMetadata',
    'dealLayoutCatalog',
    'directOrders',
    'ordersRelationship',
    'parentBlueprint',
    'parentRecord',
  ]);
  const FIELD_KEYS = deepFreeze(['apiName', 'dataType', 'length', 'options', 'readOnly', 'relatedModule', 'systemMandatory']);
  const LAYOUT_CATALOG_KEYS = deepFreeze(['layouts']);
  const LAYOUT_KEYS = deepFreeze(['id', 'name', 'status', 'visible']);
  const PARENT_RECORD_KEYS = deepFreeze(['records', 'requestedId']);
  const PARENT_ROW_KEYS = deepFreeze(['id', 'layoutId', 'stage']);
  const RELATIONSHIP_KEYS = deepFreeze([
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
  const RELATIONSHIP_ROW_KEYS = deepFreeze(['id', 'ordinal', 'stage']);
  const DIRECT_ORDER_KEYS = deepFreeze(['blueprint', 'layoutResolution', 'ordinal', 'records', 'requestedId']);
  const DIRECT_RECORD_KEYS = deepFreeze(['id', 'stage']);
  const LAYOUT_RESOLUTION_KEYS = deepFreeze(['candidateCount', 'exact', 'layoutId', 'reason', 'source']);
  const BLUEPRINT_KEYS = deepFreeze([
    'blueprintId',
    'blueprintName',
    'currentDisplay',
    'layoutId',
    'layoutName',
    'local',
    'module',
    'recordId',
    'stateField',
    'status',
    'transition',
  ]);
  const TRANSITION_KEYS = deepFreeze([
    'afterActions',
    'common',
    'criteriaCount',
    'duringInputs',
    'executable',
    'fromActual',
    'fromDisplay',
    'id',
    'localExecution',
    'name',
    'ownerCount',
    'ownerType',
    'toActual',
    'toDisplay',
    'triggerType',
  ]);
  const WIDGET_INPUT_KEYS = deepFreeze(['apiName', 'dataType', 'kind', 'label', 'required', 'sequence']);
  const CHECKLIST_INPUT_KEYS = deepFreeze(['apiName', 'checklist', 'dataType', 'kind', 'label', 'required', 'sequence']);
  const FIELD_INPUT_KEYS = deepFreeze(['apiName', 'dataType', 'kind', 'label', 'required', 'sequence']);
  const CHECKLIST_KEYS = deepFreeze(['items', 'title']);
  const CHECKLIST_ITEM_KEYS = deepFreeze(['name', 'required']);
  const AFTER_ACTION_KEYS = deepFreeze(['details', 'id', 'name', 'type']);
  const AFTER_DETAILS_KEYS = deepFreeze(['fieldApiName', 'fieldLabel', 'value']);
  const AMS_CATALOG_KEYS = deepFreeze(['blueprints']);
  const AMS_BLUEPRINT_KEYS = deepFreeze([
    'blueprintId',
    'blueprintName',
    'layoutId',
    'layoutName',
    'module',
    'stateField',
    'status',
    'transitions',
  ]);
  const AMS_TRANSITION_KEYS = deepFreeze(['active', 'toActual', 'toDisplay']);
  const BUILD_KEYS = deepFreeze(['context']);
  const COMPARE_KEYS = deepFreeze(['fresh', 'reviewed']);
  const CONTROL = /[\u0000-\u001f\u007f]/;
  const RECORD_ID = /^\d{19}$/;
  const createdContexts = new WeakSet();
  const createdEvidence = new WeakSet();

  function fail(code, details = null) {
    throw new HandoverPostTeamPreviewError(code, details);
  }

  function exactObject(value, keys, code, details = null) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code, details);
    let prototype;
    let descriptors;
    try {
      prototype = Object.getPrototypeOf(value);
      descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
      fail(code, details);
    }
    if (prototype !== Object.prototype && prototype !== null) fail(code, details);
    const ownKeys = Reflect.ownKeys(descriptors);
    if (ownKeys.some(key => typeof key !== 'string')) fail(code, details);
    const actual = [...ownKeys].sort();
    const expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(code, details);
    const captured = Object.create(null);
    for (const key of ownKeys) {
      const descriptor = descriptors[key];
      if (!Object.prototype.hasOwnProperty.call(descriptor, 'value') || descriptor.enumerable !== true) fail(code, details);
      Object.defineProperty(captured, key, {
        configurable: false,
        enumerable: true,
        value: descriptor.value,
        writable: false,
      });
    }
    return Object.freeze(captured);
  }

  function denseArray(value, maxItems, code, details = null) {
    if (!Array.isArray(value)) fail(code, details);
    let prototype;
    let descriptors;
    try {
      prototype = Object.getPrototypeOf(value);
      descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
      fail(code, details);
    }
    if (prototype !== Array.prototype) fail(code, details);
    const ownKeys = Reflect.ownKeys(descriptors);
    if (ownKeys.some(key => typeof key !== 'string')) fail(code, details);
    const lengthDescriptor = descriptors.length;
    if (
      !lengthDescriptor
      || !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value')
      || lengthDescriptor.enumerable !== false
      || !Number.isInteger(lengthDescriptor.value)
      || lengthDescriptor.value < 0
      || lengthDescriptor.value > maxItems
      || ownKeys.length !== lengthDescriptor.value + 1
    ) fail(code, details);
    const captured = new Array(lengthDescriptor.value);
    for (let index = 0; index < lengthDescriptor.value; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value') || descriptor.enumerable !== true) fail(code, details);
      captured[index] = descriptor.value;
    }
    return Object.freeze(captured);
  }

  function text(value, maxLength, code, details = null, optional = false) {
    if (typeof value !== 'string') fail(code, details);
    const normalized = value.trim();
    if (!normalized) {
      if (optional) return '';
      fail(code, details);
    }
    if (normalized.length > maxLength || CONTROL.test(normalized)) fail(code, details);
    return normalized;
  }

  function integer(value, min, max, code, details = null) {
    if (!Number.isInteger(value) || value < min || value > max) fail(code, details);
    return value;
  }

  function recordId(value, code, details = null) {
    if (typeof value !== 'string' || !RECORD_ID.test(value)) fail(code, details);
    return value;
  }

  function displayStage(value) {
    if (typeof value === 'string') return value.trim();
    if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, 'display_value');
    } catch {
      return '';
    }
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value') || typeof descriptor.value !== 'string') return '';
    return descriptor.value.trim();
  }

  function bytesFor(value) {
    const bytes = [];
    for (const character of value) {
      const code = character.codePointAt(0);
      if (code <= 0x7f) bytes.push(code);
      else if (code <= 0x7ff) bytes.push(0xc0 | (code >>> 6), 0x80 | (code & 0x3f));
      else if (code <= 0xffff) bytes.push(0xe0 | (code >>> 12), 0x80 | ((code >>> 6) & 0x3f), 0x80 | (code & 0x3f));
      else bytes.push(0xf0 | (code >>> 18), 0x80 | ((code >>> 12) & 0x3f), 0x80 | ((code >>> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
    return bytes;
  }

  function rotateRight(value, count) {
    return (value >>> count) | (value << (32 - count));
  }

  function sha256(value) {
    const bytes = bytesFor(value);
    const bitLength = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    const high = Math.floor(bitLength / 0x100000000);
    const low = bitLength >>> 0;
    for (let shift = 24; shift >= 0; shift -= 8) bytes.push((high >>> shift) & 0xff);
    for (let shift = 24; shift >= 0; shift -= 8) bytes.push((low >>> shift) & 0xff);
    const constants = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    const hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const words = new Array(64);
    for (let offset = 0; offset < bytes.length; offset += 64) {
      for (let index = 0; index < 16; index += 1) {
        const position = offset + (index * 4);
        words[index] = ((bytes[position] << 24) | (bytes[position + 1] << 16) | (bytes[position + 2] << 8) | bytes[position + 3]) >>> 0;
      }
      for (let index = 16; index < 64; index += 1) {
        const first = words[index - 15];
        const second = words[index - 2];
        const sigma0 = rotateRight(first, 7) ^ rotateRight(first, 18) ^ (first >>> 3);
        const sigma1 = rotateRight(second, 17) ^ rotateRight(second, 19) ^ (second >>> 10);
        words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = hash;
      for (let index = 0; index < 64; index += 1) {
        const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
        const choice = (e & f) ^ (~e & g);
        const temporary1 = (h + sum1 + choice + constants[index] + words[index]) >>> 0;
        const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
        const majority = (a & b) ^ (a & c) ^ (b & c);
        const temporary2 = (sum0 + majority) >>> 0;
        h = g;
        g = f;
        f = e;
        e = (d + temporary1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (temporary1 + temporary2) >>> 0;
      }
      hash[0] = (hash[0] + a) >>> 0;
      hash[1] = (hash[1] + b) >>> 0;
      hash[2] = (hash[2] + c) >>> 0;
      hash[3] = (hash[3] + d) >>> 0;
      hash[4] = (hash[4] + e) >>> 0;
      hash[5] = (hash[5] + f) >>> 0;
      hash[6] = (hash[6] + g) >>> 0;
      hash[7] = (hash[7] + h) >>> 0;
    }
    return hash.map(word => word.toString(16).padStart(8, '0')).join('');
  }

  function fingerprint(label, value) {
    return `${label}-v1-${sha256(JSON.stringify(value))}`;
  }

  function normalizeOptions(raw, code) {
    const values = denseArray(raw, LIMITS.options, code).map(value => text(value, LIMITS.text, code));
    if (new Set(values).size !== values.length) fail(code);
    return Object.freeze(values);
  }

  function normalizeMetadata(raw, schemas, code) {
    const expectedNames = Object.keys(schemas);
    const rows = denseArray(raw, expectedNames.length, code);
    if (rows.length !== expectedNames.length) fail(code);
    const byName = new Map();
    rows.forEach(rawRow => {
      const row = exactObject(rawRow, FIELD_KEYS, code);
      const apiName = text(row.apiName, 80, code);
      if (!Object.prototype.hasOwnProperty.call(schemas, apiName) || byName.has(apiName)) fail(code);
      const schema = schemas[apiName];
      const options = normalizeOptions(row.options, code);
      if (
        row.dataType !== schema.dataType
        || row.length !== schema.length
        || row.readOnly !== schema.readOnly
        || row.relatedModule !== schema.relatedModule
        || row.systemMandatory !== schema.systemMandatory
        || (schema.dataType === 'picklist' && options.length === 0)
        || (schema.dataType !== 'picklist' && options.length !== 0)
        || schema.requiredOptions.some(option => !options.includes(option))
      ) fail(code);
      byName.set(apiName, Object.freeze({
        apiName,
        dataType: schema.dataType,
        length: schema.length,
        options,
        readOnly: schema.readOnly,
        relatedModule: schema.relatedModule,
        systemMandatory: schema.systemMandatory,
      }));
    });
    if (expectedNames.some(name => !byName.has(name))) fail(code);
    const fields = Object.freeze(expectedNames.map(name => byName.get(name)));
    return Object.freeze({ fields, signature: fingerprint('metadata', fields) });
  }

  function normalizeLayoutCatalog(raw, expected, code, onlyActiveVisible) {
    const input = exactObject(raw, LAYOUT_CATALOG_KEYS, code);
    const rows = denseArray(input.layouts, LIMITS.layouts, code);
    const seen = new Set();
    const layouts = rows.map(rawRow => {
      const row = exactObject(rawRow, LAYOUT_KEYS, code);
      const id = recordId(row.id, code);
      if (seen.has(id)) fail(code);
      seen.add(id);
      const normalized = Object.freeze({
        id,
        name: text(row.name, 120, code),
        status: text(row.status, 40, code),
        visible: row.visible,
      });
      if (typeof normalized.visible !== 'boolean') fail(code);
      return normalized;
    });
    const exact = layouts.filter(layout => layout.id === expected.layoutId && layout.name === expected.layoutName);
    const activeVisible = layouts.filter(layout => layout.status === 'active' && layout.visible === true);
    if (
      exact.length !== 1
      || exact[0].status !== 'active'
      || exact[0].visible !== true
      || (onlyActiveVisible && (activeVisible.length !== 1 || activeVisible[0].id !== expected.layoutId))
    ) fail(code);
    const sorted = Object.freeze([...layouts].sort((left, right) => left.id.localeCompare(right.id)));
    return Object.freeze({
      activeVisibleCount: activeVisible.length,
      signature: fingerprint('layouts', sorted),
    });
  }

  function normalizeParentRecord(raw) {
    const input = exactObject(raw, PARENT_RECORD_KEYS, 'PARENT_RECORD_INVALID');
    const requestedId = recordId(input.requestedId, 'PARENT_RECORD_INVALID');
    const records = denseArray(input.records, 1, 'PARENT_RECORD_INVALID');
    if (records.length !== 1) fail('PARENT_RECORD_INVALID');
    const row = exactObject(records[0], PARENT_ROW_KEYS, 'PARENT_RECORD_INVALID');
    const id = recordId(row.id, 'PARENT_RECORD_INVALID');
    const stage = text(displayStage(row.stage), 120, 'PARENT_STAGE_INVALID');
    if (
      id !== requestedId
      || row.layoutId !== PARENT_CONTRACT.layoutId
      || stage !== PARENT_CONTRACT.currentDisplay
    ) fail('PARENT_RECORD_INVALID');
    return Object.freeze({ id, stage });
  }

  function normalizeWidgetInput(raw, code, details) {
    const row = exactObject(raw, WIDGET_INPUT_KEYS, code, details);
    return Object.freeze({
      apiName: row.apiName,
      dataType: text(row.dataType, 40, code, details),
      kind: text(row.kind, 40, code, details),
      label: text(row.label, 120, code, details),
      required: row.required,
      sequence: integer(row.sequence, 1, 10, code, details),
    });
  }

  function normalizeChecklistInput(raw, code, details) {
    const row = exactObject(raw, CHECKLIST_INPUT_KEYS, code, details);
    const checklist = exactObject(row.checklist, CHECKLIST_KEYS, code, details);
    const items = denseArray(checklist.items, 10, code, details).map(rawItem => {
      const item = exactObject(rawItem, CHECKLIST_ITEM_KEYS, code, details);
      if (typeof item.required !== 'boolean') fail(code, details);
      return Object.freeze({ name: text(item.name, 120, code, details), required: item.required });
    });
    return Object.freeze({
      apiName: row.apiName,
      checklist: Object.freeze({ items: Object.freeze(items), title: text(checklist.title, 120, code, details) }),
      dataType: text(row.dataType, 40, code, details),
      kind: text(row.kind, 40, code, details),
      label: text(row.label, 120, code, details),
      required: row.required,
      sequence: integer(row.sequence, 1, 10, code, details),
    });
  }

  function normalizeFieldInput(raw, code, details) {
    const row = exactObject(raw, FIELD_INPUT_KEYS, code, details);
    return Object.freeze({
      apiName: text(row.apiName, 80, code, details),
      dataType: text(row.dataType, 40, code, details),
      kind: text(row.kind, 40, code, details),
      label: text(row.label, 120, code, details),
      required: row.required,
      sequence: integer(row.sequence, 1, 10, code, details),
    });
  }

  function normalizeAfterAction(raw, code, details) {
    const row = exactObject(raw, AFTER_ACTION_KEYS, code, details);
    const actionDetails = exactObject(row.details, AFTER_DETAILS_KEYS, code, details);
    return Object.freeze({
      details: Object.freeze({
        fieldApiName: text(actionDetails.fieldApiName, 80, code, details),
        fieldLabel: text(actionDetails.fieldLabel, 120, code, details),
        value: text(actionDetails.value, 80, code, details),
      }),
      id: recordId(row.id, code, details),
      name: text(row.name, 120, code, details),
      type: text(row.type, 40, code, details),
    });
  }

  function normalizeBlueprint(raw, expected, expectedRecordId, kind, details = null) {
    const code = kind === 'parent' ? 'PARENT_BLUEPRINT_INVALID' : 'CHILD_BLUEPRINT_INVALID';
    const input = exactObject(raw, BLUEPRINT_KEYS, code, details);
    const recordIdentity = recordId(input.recordId, code, details);
    const transition = exactObject(input.transition, TRANSITION_KEYS, code, details);
    const duringRows = denseArray(transition.duringInputs, 8, code, details);
    const afterRows = denseArray(transition.afterActions, 8, code, details);
    let duringInputs;
    let afterActions;
    if (kind === 'parent') {
      duringInputs = Object.freeze(duringRows.map(row => normalizeWidgetInput(row, code, details)));
      afterActions = Object.freeze([]);
      if (afterRows.length !== 0 || JSON.stringify(duringInputs) !== JSON.stringify(PARENT_DURING_INPUTS)) fail(code, details);
    } else {
      duringInputs = Object.freeze(duringRows.map((row, index) => (
        index === 0
          ? normalizeChecklistInput(row, code, details)
          : normalizeFieldInput(row, code, details)
      )));
      afterActions = Object.freeze(afterRows.map(row => normalizeAfterAction(row, code, details)));
      if (
        JSON.stringify(duringInputs) !== JSON.stringify(CHILD_CONTRACT.duringInputs)
        || JSON.stringify(afterActions) !== JSON.stringify(CHILD_CONTRACT.afterActions)
      ) fail(code, details);
    }
    const normalizedTransition = Object.freeze({
      afterActions,
      common: transition.common,
      criteriaCount: transition.criteriaCount,
      duringInputs,
      executable: transition.executable,
      fromActual: transition.fromActual,
      fromDisplay: transition.fromDisplay,
      id: transition.id,
      localExecution: transition.localExecution,
      name: transition.name,
      ownerCount: transition.ownerCount,
      ownerType: transition.ownerType,
      toActual: transition.toActual,
      toDisplay: transition.toDisplay,
      triggerType: transition.triggerType,
    });
    if (
      recordIdentity !== expectedRecordId
      || input.blueprintId !== expected.blueprintId
      || input.blueprintName !== expected.blueprintName
      || input.currentDisplay !== expected.currentDisplay
      || input.layoutId !== expected.layoutId
      || input.layoutName !== expected.layoutName
      || input.local !== true
      || input.module !== expected.module
      || input.stateField !== expected.stateField
      || input.status !== expected.status
      || normalizedTransition.common !== false
      || normalizedTransition.criteriaCount !== 0
      || normalizedTransition.executable !== false
      || normalizedTransition.fromActual !== expected.currentActual
      || normalizedTransition.fromDisplay !== expected.currentDisplay
      || normalizedTransition.id !== expected.transitionId
      || normalizedTransition.localExecution !== 'Blocked'
      || normalizedTransition.name !== expected.transitionName
      || normalizedTransition.ownerCount !== 1
      || normalizedTransition.ownerType !== 'record_owner'
      || normalizedTransition.toActual !== expected.nextActual
      || normalizedTransition.toDisplay !== expected.nextDisplay
      || normalizedTransition.triggerType !== 'manual'
    ) fail(code, details);
    return Object.freeze({
      privateRecordId: recordIdentity,
      signature: Object.freeze({
        blueprintId: input.blueprintId,
        blueprintName: input.blueprintName,
        currentDisplay: input.currentDisplay,
        layoutId: input.layoutId,
        layoutName: input.layoutName,
        local: true,
        module: input.module,
        stateField: input.stateField,
        status: input.status,
        transition: normalizedTransition,
      }),
    });
  }

  function normalizeRelationship(raw, dealStageOptions) {
    const input = exactObject(raw, RELATIONSHIP_KEYS, 'ORDER_RELATIONSHIP_INVALID');
    const rows = denseArray(input.orders, LIMITS.orders, 'ORDER_RELATIONSHIP_INVALID');
    const links = denseArray(input.linkFields, 1, 'ORDER_RELATIONSHIP_INVALID');
    if (
      input.availability !== RELATIONSHIP_CONTRACT.availability
      || input.hasMore !== RELATIONSHIP_CONTRACT.hasMore
      || input.limitApplied !== RELATIONSHIP_CONTRACT.limitApplied
      || input.linkBasis !== RELATIONSHIP_CONTRACT.linkBasis
      || links.length !== 1
      || links[0] !== RELATIONSHIP_CONTRACT.linkFields[0]
      || input.page !== RELATIONSHIP_CONTRACT.page
      || input.perPage !== RELATIONSHIP_CONTRACT.perPage
      || input.relatedModule !== RELATIONSHIP_CONTRACT.relatedModule
      || input.returned !== rows.length
    ) fail('ORDER_RELATIONSHIP_INVALID');
    const seenIds = new Set();
    const eligible = [];
    const blocked = [];
    const privateRows = [];
    const anonymousRows = [];
    rows.forEach((rawRow, index) => {
      const row = exactObject(rawRow, RELATIONSHIP_ROW_KEYS, 'ORDER_DESCRIPTOR_INVALID');
      const ordinal = integer(row.ordinal, 1, LIMITS.orders, 'ORDER_ORDINAL_INVALID');
      if (ordinal !== index + 1) fail('ORDER_ORDINAL_INVALID');
      const id = recordId(row.id, 'ORDER_IDENTITY_INVALID', { ordinal });
      if (seenIds.has(id)) fail('ORDER_IDENTITY_INVALID', { ordinal });
      seenIds.add(id);
      const stage = text(displayStage(row.stage), 120, 'ORDER_STAGE_INVALID', { ordinal }, true);
      if (stage && !dealStageOptions.includes(stage)) fail('ORDER_STAGE_METADATA_DRIFT', { ordinal });
      const anonymous = Object.freeze({ label: `Order ${ordinal}`, ordinal, stage });
      anonymousRows.push(Object.freeze({ ordinal, stage }));
      privateRows.push(Object.freeze({ id, ordinal }));
      if (stage === CHILD_CONTRACT.currentDisplay) eligible.push(Object.freeze({ ...anonymous, privateId: id }));
      else blocked.push(Object.freeze({
        label: anonymous.label,
        ordinal,
        reason: 'stage-not-second-installation-done',
        stage,
      }));
    });
    return Object.freeze({
      anonymousRows: Object.freeze(anonymousRows),
      blocked: Object.freeze(blocked),
      eligible: Object.freeze(eligible),
      privateRows: Object.freeze(privateRows),
      total: rows.length,
    });
  }

  function normalizeLayoutResolution(raw, details) {
    const row = exactObject(raw, LAYOUT_RESOLUTION_KEYS, 'CHILD_LAYOUT_RESOLUTION_INVALID', details);
    if (
      row.candidateCount !== 1
      || row.exact !== true
      || row.layoutId !== CHILD_CONTRACT.layoutId
      || row.reason !== null
      || row.source !== 'only_active_layout'
    ) fail('CHILD_LAYOUT_RESOLUTION_INVALID', details);
    return Object.freeze({
      candidateCount: 1,
      exact: true,
      layoutId: CHILD_CONTRACT.layoutId,
      reason: null,
      source: 'only_active_layout',
    });
  }

  function normalizeDirectOrders(raw, eligible) {
    const rows = denseArray(raw, LIMITS.orders, 'DIRECT_ORDER_EVIDENCE_INVALID');
    if (rows.length !== eligible.length) fail('DIRECT_ORDER_EVIDENCE_INVALID');
    const signatures = [];
    const privateRows = [];
    rows.forEach((rawRow, index) => {
      const expected = eligible[index];
      const details = { ordinal: expected.ordinal };
      const row = exactObject(rawRow, DIRECT_ORDER_KEYS, 'DIRECT_ORDER_EVIDENCE_INVALID', details);
      const ordinal = integer(row.ordinal, 1, LIMITS.orders, 'DIRECT_ORDER_EVIDENCE_INVALID', details);
      const requestedId = recordId(row.requestedId, 'DIRECT_ORDER_EVIDENCE_INVALID', details);
      const records = denseArray(row.records, 1, 'DIRECT_ORDER_EVIDENCE_INVALID', details);
      if (ordinal !== expected.ordinal || requestedId !== expected.privateId || records.length !== 1) fail('DIRECT_ORDER_EVIDENCE_INVALID', details);
      const record = exactObject(records[0], DIRECT_RECORD_KEYS, 'DIRECT_ORDER_EVIDENCE_INVALID', details);
      const id = recordId(record.id, 'DIRECT_ORDER_EVIDENCE_INVALID', details);
      const stage = text(displayStage(record.stage), 120, 'DIRECT_ORDER_STAGE_INVALID', details);
      if (id !== requestedId || stage !== expected.stage || stage !== CHILD_CONTRACT.currentDisplay) fail('DIRECT_ORDER_EVIDENCE_INVALID', details);
      const resolution = normalizeLayoutResolution(row.layoutResolution, details);
      const blueprint = normalizeBlueprint(row.blueprint, CHILD_CONTRACT, id, 'child', details);
      signatures.push(Object.freeze({
        blueprint: blueprint.signature,
        layoutResolution: resolution,
        ordinal,
        stage,
      }));
      privateRows.push(Object.freeze({
        blueprintRecordId: blueprint.privateRecordId,
        directRecordId: id,
        ordinal,
        relationshipRecordId: expected.privateId,
        requestedId,
      }));
    });
    return Object.freeze({ privateRows: Object.freeze(privateRows), signatures: Object.freeze(signatures) });
  }

  function normalizeAmsBlueprintCatalog(raw) {
    const input = exactObject(raw, AMS_CATALOG_KEYS, 'AMS_BLUEPRINT_CATALOG_INVALID');
    const rows = denseArray(input.blueprints, LIMITS.amsBlueprints, 'AMS_BLUEPRINT_CATALOG_INVALID');
    if (rows.length !== AMS_CONTRACT.blueprints.length) fail('AMS_BLUEPRINT_CATALOG_INVALID');
    const seen = new Set();
    const normalized = rows.map(rawRow => {
      const row = exactObject(rawRow, AMS_BLUEPRINT_KEYS, 'AMS_BLUEPRINT_CATALOG_INVALID');
      const blueprintId = recordId(row.blueprintId, 'AMS_BLUEPRINT_CATALOG_INVALID');
      if (seen.has(blueprintId)) fail('AMS_BLUEPRINT_CATALOG_INVALID');
      seen.add(blueprintId);
      const expected = AMS_CONTRACT.blueprints.find(item => item.blueprintId === blueprintId);
      if (
        !expected
        || row.blueprintName !== expected.blueprintName
        || row.layoutId !== AMS_CONTRACT.layoutId
        || row.layoutName !== AMS_CONTRACT.layoutName
        || row.module !== AMS_CONTRACT.module
        || row.stateField !== AMS_CONTRACT.stateField
        || row.status !== AMS_CONTRACT.status
      ) fail('AMS_BLUEPRINT_CATALOG_INVALID');
      const transitions = denseArray(row.transitions, LIMITS.amsTransitions, 'AMS_BLUEPRINT_CATALOG_INVALID').map(rawTransition => {
        const transition = exactObject(rawTransition, AMS_TRANSITION_KEYS, 'AMS_BLUEPRINT_CATALOG_INVALID');
        if (typeof transition.active !== 'boolean') fail('AMS_BLUEPRINT_CATALOG_INVALID');
        return Object.freeze({
          active: transition.active,
          toActual: text(transition.toActual, 120, 'AMS_BLUEPRINT_CATALOG_INVALID'),
          toDisplay: text(transition.toDisplay, 120, 'AMS_BLUEPRINT_CATALOG_INVALID'),
        });
      });
      if (transitions.length !== expected.transitionCount) fail('AMS_BLUEPRINT_CATALOG_INVALID');
      const activeToPlanned = transitions.filter(transition => (
        transition.active
        && (transition.toActual === AMS_CONTRACT.plannedStage || transition.toDisplay === AMS_CONTRACT.plannedStage)
      )).length;
      if (activeToPlanned !== 0) fail('AMS_PLANNED_TRANSITION_PRESENT');
      return Object.freeze({
        activeToPlanned,
        blueprintId,
        blueprintName: expected.blueprintName,
        layoutId: AMS_CONTRACT.layoutId,
        layoutName: AMS_CONTRACT.layoutName,
        module: AMS_CONTRACT.module,
        stateField: AMS_CONTRACT.stateField,
        status: AMS_CONTRACT.status,
        transitions: Object.freeze(transitions),
      });
    });
    const sorted = Object.freeze([...normalized].sort((left, right) => left.blueprintId.localeCompare(right.blueprintId)));
    return Object.freeze({ signature: fingerprint('blueprints', sorted), transitionToPlannedCount: 0 });
  }

  function createEvidence(raw) {
    const input = exactObject(raw, EVIDENCE_KEYS, 'EVIDENCE_INVALID');
    const contactMetadata = normalizeMetadata(input.contactFieldMetadata, CONTACT_FIELD_SCHEMAS, 'CONTACT_METADATA_INVALID');
    const dealMetadata = normalizeMetadata(input.dealFieldMetadata, DEAL_FIELD_SCHEMAS, 'DEAL_METADATA_INVALID');
    const amsMetadata = normalizeMetadata(input.amsFieldMetadata, AMS_FIELD_SCHEMAS, 'AMS_METADATA_INVALID');
    const contactLayouts = normalizeLayoutCatalog(input.contactLayoutCatalog, PARENT_CONTRACT, 'CONTACT_LAYOUT_INVALID', false);
    const dealLayouts = normalizeLayoutCatalog(input.dealLayoutCatalog, CHILD_CONTRACT, 'DEAL_LAYOUT_INVALID', true);
    const amsLayouts = normalizeLayoutCatalog(input.amsLayoutCatalog, AMS_CONTRACT, 'AMS_LAYOUT_INVALID', true);
    const parent = normalizeParentRecord(input.parentRecord);
    const parentBlueprint = normalizeBlueprint(input.parentBlueprint, PARENT_CONTRACT, parent.id, 'parent');
    const dealStage = dealMetadata.fields.find(field => field.apiName === 'Stage');
    const relationship = normalizeRelationship(input.ordersRelationship, dealStage.options);
    const directOrders = normalizeDirectOrders(input.directOrders, relationship.eligible);
    const amsBlueprints = normalizeAmsBlueprintCatalog(input.amsBlueprintCatalog);

    const eligibleOrders = Object.freeze(relationship.eligible.map(order => Object.freeze({
      label: order.label,
      ordinal: order.ordinal,
      stage: order.stage,
    })));
    const blockedOrders = Object.freeze(relationship.blocked.map(order => Object.freeze({ ...order })));
    const context = deepFreeze({
      ams: {
        active_transition_to_planned_count: amsBlueprints.transitionToPlannedCount,
        blueprint_catalog: 'verified-read-only',
        creation: 'disabled',
        enrollment: 'blocked',
        field_count: amsMetadata.fields.length,
        layout: 'Single active visible Standard layout',
        reason: 'no-active-transition-to-planned',
        schema: 'verified-read-only',
      },
      blockedOrders,
      eligibleOrders,
      evidenceSignatures: {
        amsBlueprintCatalog: amsBlueprints.signature,
        amsFields: amsMetadata.signature,
        amsLayouts: amsLayouts.signature,
        childBlueprints: fingerprint('child-blueprints', directOrders.signatures),
        contactFields: contactMetadata.signature,
        contactLayouts: contactLayouts.signature,
        dealFields: dealMetadata.signature,
        dealLayouts: dealLayouts.signature,
        parentBlueprint: fingerprint('parent-blueprint', parentBlueprint.signature),
      },
      parent: {
        blueprint: PARENT_CONTRACT.blueprintName,
        intended_stage: PARENT_CONTRACT.nextDisplay,
        layout: PARENT_CONTRACT.layoutName,
        module: PARENT_CONTRACT.module,
        runtime_attestation: 'verified-read-only',
        source_stage: parent.stage,
        transition: PARENT_CONTRACT.transitionName,
      },
      relationship: {
        complete: true,
        link_basis: RELATIONSHIP_CONTRACT.linkBasis,
        related_module: RELATIONSHIP_CONTRACT.relatedModule,
      },
      relationshipCounts: {
        blocked: blockedOrders.length,
        eligible: eligibleOrders.length,
        total: relationship.total,
      },
    });
    createdContexts.add(context);
    const privateFingerprint = fingerprint('private', {
      orders: relationship.privateRows,
      parent: {
        blueprintRecordId: parentBlueprint.privateRecordId,
        directRecordId: parent.id,
      },
      verifiedOrders: directOrders.privateRows,
    });
    const evidence = deepFreeze({
      anonymousFingerprint: fingerprint('anonymous', context),
      context,
      privateFingerprint,
    });
    createdEvidence.add(evidence);
    return evidence;
  }

  function compareEvidence(raw) {
    const input = exactObject(raw, COMPARE_KEYS, 'EVIDENCE_COMPARISON_INVALID');
    if (!createdEvidence.has(input.reviewed) || !createdEvidence.has(input.fresh)) fail('EVIDENCE_COMPARISON_INVALID');
    const anonymousMatch = input.reviewed.anonymousFingerprint === input.fresh.anonymousFingerprint;
    const privateMatch = input.reviewed.privateFingerprint === input.fresh.privateFingerprint;
    return Object.freeze({ anonymousMatch, match: anonymousMatch && privateMatch, privateMatch });
  }

  function buildPlan(raw) {
    const input = exactObject(raw, BUILD_KEYS, 'PLAN_INPUT_INVALID');
    if (!createdContexts.has(input.context)) fail('CONTEXT_INVALID');
    const orderPlans = input.context.eligibleOrders.map(order => Object.freeze({
      after_effect: Object.freeze({
        field: 'First Service Date',
        timing: 'Execution day',
      }),
      execution: 'disabled',
      intended_transition: CHILD_CONTRACT.transitionName,
      order_label: order.label,
      required_inputs: deepFreeze([
        { label: 'Handover File', required: true, type: 'checklist' },
        { label: 'Handover Certificate', required: true, type: 'checklist item' },
        { label: 'MDR Done', required: true, type: 'date' },
        { label: 'Internal QC', required: true, type: 'integer' },
      ]),
      runtime_attestation: 'verified-read-only',
      source_stage: order.stage,
    }));
    const blockedOrders = input.context.blockedOrders.map(order => Object.freeze({
      order_label: order.label,
      reason: order.reason,
      source_stage: order.stage || 'Not set',
    }));
    return deepFreeze({
      ams_plan: {
        blueprint_enrollment: 'blocked',
        creation: 'disabled',
        intended_stage: AMS_CONTRACT.plannedStage,
        reason: input.context.ams.reason,
        schema_attestation: `${input.context.ams.field_count} reviewed fields`,
      },
      blocked_actions: [
        'Handover certificate or file transfer',
        'Deal record updates',
        'child Blueprint transition',
        'workflow triggering',
        'AMS record creation',
        'AMS Planned Blueprint enrollment',
        'parent Blueprint continuation',
        'permission and owner evaluation',
      ],
      blocked_orders: blockedOrders,
      order_plans: orderPlans,
      parent_transition: {
        continuation: 'disabled',
        current: PARENT_CONTRACT.currentDisplay,
        name: PARENT_CONTRACT.transitionName,
        next: PARENT_CONTRACT.nextDisplay,
        permissions: 'not evaluated',
      },
      persistence: 'disabled',
      preview_only: true,
      totals: {
        blocked_orders: blockedOrders.length,
        eligible_orders: orderPlans.length,
        relationship_orders: input.context.relationshipCounts.total,
      },
    });
  }

  async function mapLimit(rawRows, maxConcurrency, mapper) {
    const rows = denseArray(rawRows, LIMITS.orders, 'MAP_INPUT_INVALID');
    if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 4) fail('CONCURRENCY_INVALID');
    if (typeof mapper !== 'function') fail('MAPPER_INVALID');
    const results = new Array(rows.length);
    let cursor = 0;
    async function worker() {
      while (cursor < rows.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await mapper(rows[index], index);
      }
    }
    const workers = Array.from({ length: Math.min(maxConcurrency, rows.length) }, () => worker());
    await Promise.all(workers);
    return Object.freeze(results);
  }

  return deepFreeze({
    HandoverPostTeamPreviewError,
    buildPlan,
    compareEvidence,
    constants: {
      amsContract: AMS_CONTRACT,
      amsFieldSchemas: AMS_FIELD_SCHEMAS,
      childContract: CHILD_CONTRACT,
      contactFieldSchemas: CONTACT_FIELD_SCHEMAS,
      dealFieldSchemas: DEAL_FIELD_SCHEMAS,
      limits: LIMITS,
      parentContract: PARENT_CONTRACT,
      parentDuringInputs: PARENT_DURING_INPUTS,
      relationshipContract: RELATIONSHIP_CONTRACT,
    },
    createEvidence,
    displayStage,
    mapLimit,
  });
});
