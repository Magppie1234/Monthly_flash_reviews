'use strict';

const {
  CRM_AGENT_TOOL_NAMES,
  CrmAgentPolicyError,
  LIMITS,
  getCrmAgentAvailability,
  normalizePermissionContext,
} = require('./crm-agent-policy');
const { createCrmAgent } = require('./crm-agent');
const { executeCrmAgentTool } = require('./crm-agent-tools');
const { layoutList, mergeLayoutFields } = require('./layout-schema');
const { executeBoundedLocalRead } = require('./local-read-retry');

const AGENT_SOURCE_MODE = 'local-replica-read-only';
const AGENT_SCOPE_BASIS = 'mirrored-module-field-layout-metadata-conservative-profile-intersection';
const AGENT_PROMPT_MAX_CHARACTERS = 2_000;
const AGENT_PROMPT_MAX_BYTES = 8_000;
const AGENT_ANSWER_MAX_CHARACTERS = 6_000;
const AGENT_CHAT_TIMEOUT_MS = 30_000;
const AGENT_MAX_CONCURRENT_CHATS = 4;
const AGENT_METADATA_ROW_LIMIT = 500;
const AGENT_METADATA_MODULE_LIMIT = 150;
const AGENT_METADATA_BATCH_SIZE = 12;
const AGENT_METADATA_MAX_QUERY_ATTEMPTS = 32;
const AGENT_METADATA_LOAD_BUDGET_MS = 45_000;
const AGENT_AGGREGATE_CACHE_MS = 60_000;
const AGENT_METADATA_KEY_QUERY = `select key
from crm_meta
where key = 'modules' or key like 'fields:%' or key like 'layouts:%'
order by key
limit ${AGENT_METADATA_ROW_LIMIT + 1}`;
const AGENT_METADATA_MODULE_QUERY = `select key, data
from crm_meta
where key = 'modules'
limit 1`;
const AGENT_METADATA_QUERY = AGENT_METADATA_KEY_QUERY;
const DETERMINISTIC_METADATA_QUERY = AGENT_METADATA_QUERY;
const AGENT_SCOPE_CACHE_MS = 10 * 60 * 1000;

const MODULE_PATTERN = /^[A-Za-z][A-Za-z0-9_$]{0,79}$/;
const FIELD_PATTERN = /^[A-Za-z][A-Za-z0-9_$]{0,119}$/;
const SENSITIVE_NAME_PATTERN = /(?:^|_)(?:api_?key|authorization|bearer|cookie|credential|password|refresh_?token|secret|session_?token|token)(?:$|_)/i;
const SENSITIVE_PROMPT_PATTERN = /(?:\bbearer\s+[A-Za-z0-9._~+/=-]{6,}|\b(?:api[_ -]?key|authorization|password|secret|token|credential)\b\s*(?:[:=]|is)\s*["']?[^\s,;"']{4,}|(?:postgres|mysql|mongodb(?:\+srv)?):\/\/[^\s]+:[^\s]+@)/i;
const SENSITIVE_TEXT_PATTERN = /\b(api[_ -]?key|authorization|password|secret|token|credential)\b\s*(?:[:=]|is)\s*["']?[^\s,;"']{4,}["']?/gi;
const BEARER_TEXT_PATTERN = /\bbearer\s+[A-Za-z0-9._~+/=-]{6,}/gi;
const CREDENTIAL_URI_PATTERN = /\b(?:postgres|mysql|mongodb(?:\+srv)?):\/\/[^\s]+:[^\s]+@[^\s]+/gi;
const SQL_STATEMENT_PATTERN = /\b(?:select\s+[\s\S]{0,300}?\s+from|insert\s+into|update\s+[A-Za-z0-9_$."]+\s+set|delete\s+from)\b/i;
const CREATE_ROUTE_PATTERN = /\/?api\/record(?:\/[A-Za-z0-9_$.:~-]+){0,2}/gi;
const FORBIDDEN_DATA_TYPES = new Set(['fileupload', 'imageupload', 'profileimage', 'subform']);
const NUMERIC_DATA_TYPES = new Set(['integer', 'double', 'currency', 'percent', 'bigint']);
const DETERMINISTIC_CATEGORY_DATA_TYPES = new Set(['picklist', 'boolean']);
const DETERMINISTIC_CATEGORY_NAME_PATTERN = /(?:^|_)(?:category|channel|classification|converted|currency|industry|locked|mode|opt_out|priority|purpose|quality|rating|reason|requirement|result|segment|source|stage|status|type|vertical)(?:$|_)/i;
const DETERMINISTIC_PRIVATE_DIMENSION_PATTERN = /(?:^|_)(?:account|address|architect|assigned|birth|contact|dealer|designer|email|employee|gst|manager|mobile|name|owner|pan|phone|postal|street|user|vendor|zip)(?:$|_)/i;
const PROFILE_READ_PERMISSIONS = new Set(['read_write', 'read_only', 'readonly', 'read']);
const PROFILE_WRITE_PERMISSIONS = new Set(['read_write', 'write']);
const DETERMINISTIC_SUPPORTED_QUESTIONS = Object.freeze([
  'Count Leads by Lead Status',
  'Find up to 10 overdue Tasks',
  'Show required fields for a new Lead',
  'Prepare a new Lead draft for review with Last Name: <name>',
  'Count records in <module>',
  'Count records in <module> by <safe field>',
  'Count records in <module> by <safe-group-field> where <safe-filter-field> is empty',
]);
const DETERMINISTIC_INTENT_REQUIREMENTS = Object.freeze([
  Object.freeze({
    name: 'count_leads_by_status',
    question: DETERMINISTIC_SUPPORTED_QUESTIONS[0],
    reason_code: 'LEADS_STATUS_AGGREGATE_UNAVAILABLE',
    unavailable_message: 'Lead Status counts are unavailable because the mirrored Leads aggregate permission or Lead_Status field is incomplete.',
  }),
  Object.freeze({
    name: 'find_overdue_tasks',
    question: DETERMINISTIC_SUPPORTED_QUESTIONS[1],
    reason_code: 'TASKS_OVERDUE_SEARCH_UNAVAILABLE',
    unavailable_message: 'Overdue Tasks are unavailable because the mirrored Tasks search permission or Subject, Due Date, and Status fields are incomplete.',
  }),
  Object.freeze({
    name: 'required_lead_fields',
    question: DETERMINISTIC_SUPPORTED_QUESTIONS[2],
    reason_code: 'LEADS_CREATE_METADATA_UNAVAILABLE',
    unavailable_message: 'Required Lead fields are unavailable because the exact mirrored Lead layout metadata is incomplete or ambiguous.',
  }),
  Object.freeze({
    name: 'prepare_lead_draft',
    question: DETERMINISTIC_SUPPORTED_QUESTIONS[3],
    reason_code: 'LEADS_LAST_NAME_DRAFT_UNAVAILABLE',
    unavailable_message: 'Lead draft preparation is unavailable because Last Name is not verified as writable in the exact mirrored Lead create layout.',
  }),
  Object.freeze({
    name: 'count_module_records',
    question: DETERMINISTIC_SUPPORTED_QUESTIONS[4],
    reason_code: 'MODULE_RECORD_COUNT_UNAVAILABLE',
    unavailable_message: 'Module record counts are unavailable because no complete mirrored module passes the aggregate permission preflight.',
  }),
  Object.freeze({
    name: 'count_module_by_safe_field',
    question: DETERMINISTIC_SUPPORTED_QUESTIONS[5],
    reason_code: 'SAFE_MODULE_AGGREGATE_UNAVAILABLE',
    unavailable_message: 'Grouped module counts are unavailable because no complete mirrored module has a reviewed non-private categorical aggregate field.',
  }),
  Object.freeze({
    name: 'count_module_by_safe_field_where_empty',
    question: DETERMINISTIC_SUPPORTED_QUESTIONS[6],
    reason_code: 'SAFE_FILTERED_MODULE_AGGREGATE_UNAVAILABLE',
    unavailable_message: 'Filtered grouped module counts are unavailable because no complete mirrored module has a reviewed non-private categorical aggregate field.',
  }),
]);

class CrmAgentRouteError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'CrmAgentRouteError';
    this.code = code;
    this.status = status;
  }
}

function fail(code, message, status) {
  throw new CrmAgentRouteError(code, message, status);
}

function byteLength(value) {
  return Buffer.byteLength(String(value), 'utf8');
}

function safeText(value, maxLength = AGENT_ANSWER_MAX_CHARACTERS) {
  const text = String(value || '')
    .replace(BEARER_TEXT_PATTERN, 'Bearer [credential omitted]')
    .replace(SENSITIVE_TEXT_PATTERN, '$1: [credential omitted]')
    .replace(CREDENTIAL_URI_PATTERN, '[credential URI omitted]')
    .replace(CREATE_ROUTE_PATTERN, '[existing validated create form]')
    .slice(0, maxLength);
  return SQL_STATEMENT_PATTERN.test(text)
    ? 'I can answer this through the reviewed CRM tools, but arbitrary SQL is not available. No local or source data was changed.'
    : text;
}

function validateAgentChatInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('AGENT_CHAT_INPUT_INVALID', 'Request body must be an object containing only prompt.', 400);
  }
  const keys = Object.keys(input);
  if (keys.length !== 1 || keys[0] !== 'prompt') {
    fail('AGENT_CHAT_INPUT_INVALID', 'Request body must contain only prompt.', 400);
  }
  if (typeof input.prompt !== 'string') {
    fail('AGENT_CHAT_INPUT_INVALID', 'prompt must be a string.', 400);
  }
  const prompt = input.prompt.trim();
  if (!prompt || prompt.length > AGENT_PROMPT_MAX_CHARACTERS || byteLength(prompt) > AGENT_PROMPT_MAX_BYTES) {
    fail('AGENT_CHAT_INPUT_INVALID', `prompt must contain 1 to ${AGENT_PROMPT_MAX_CHARACTERS} characters and no more than ${AGENT_PROMPT_MAX_BYTES} UTF-8 bytes.`, 400);
  }
  if (/[^\P{C}\n\r\t]/u.test(prompt)) {
    fail('AGENT_CHAT_INPUT_INVALID', 'prompt contains unsupported control characters.', 400);
  }
  if (SENSITIVE_PROMPT_PATTERN.test(prompt)) {
    fail('AGENT_SENSITIVE_PROMPT_BLOCKED', 'Remove credentials or connection secrets before asking the CRM assistant.', 400);
  }
  return Object.freeze({ prompt });
}

function moduleEntries(value) {
  if (Array.isArray(value)) return value;
  return Array.isArray(value?.modules) ? value.modules : [];
}

function metadataKeyParts(value) {
  if (value === 'modules') return { kind: 'modules', module: null };
  for (const kind of ['fields', 'layouts']) {
    const prefix = `${kind}:`;
    if (!String(value || '').startsWith(prefix)) continue;
    const module = String(value).slice(prefix.length);
    return MODULE_PATTERN.test(module) ? { kind, module } : null;
  }
  return null;
}

function validateDiscoveredMetadataKeys(rows) {
  if (!Array.isArray(rows) || rows.length > AGENT_METADATA_ROW_LIMIT) {
    fail('AGENT_PERMISSION_SCOPE_UNAVAILABLE', 'Mirrored CRM metadata key discovery is unavailable or exceeds the reviewed bound.', 503);
  }
  const keys = new Set();
  for (const row of rows) {
    const key = typeof row?.key === 'string' ? row.key : '';
    if (!metadataKeyParts(key) || keys.has(key)) {
      fail('AGENT_PERMISSION_SCOPE_UNAVAILABLE', 'Mirrored CRM metadata key discovery contains an invalid or duplicate definition.', 503);
    }
    keys.add(key);
  }
  if (!keys.has('modules')) {
    fail('AGENT_PERMISSION_SCOPE_UNAVAILABLE', 'Mirrored CRM module metadata is unavailable.', 503);
  }
  return keys;
}

function selectedMetadataKeys(modules, discoveredKeys) {
  const selected = [];
  const modulesSeen = new Set();
  const eligible = moduleEntries(modules).filter(moduleIsEligible).slice(0, AGENT_METADATA_MODULE_LIMIT);
  for (const module of eligible) {
    const name = module.api_name;
    if (modulesSeen.has(name)) {
      fail('AGENT_PERMISSION_SCOPE_UNAVAILABLE', 'Mirrored CRM module metadata contains duplicate module definitions.', 503);
    }
    modulesSeen.add(name);
    const fieldKey = `fields:${name}`;
    const layoutKey = `layouts:${name}`;
    if (discoveredKeys.has(fieldKey) && discoveredKeys.has(layoutKey)) selected.push(fieldKey, layoutKey);
  }
  return selected;
}

function metadataBatchQuery(keys) {
  if (!Array.isArray(keys) || !keys.length || keys.length > AGENT_METADATA_BATCH_SIZE
    || keys.some(key => !metadataKeyParts(key) || key === 'modules')) {
    fail('AGENT_PERMISSION_SCOPE_UNAVAILABLE', 'Mirrored CRM metadata batch keys are invalid or exceed the reviewed bound.', 503);
  }
  return `select key, data
from crm_meta
where key in (${keys.map(key => `'${key}'`).join(', ')})
order by key
limit ${keys.length}`;
}

function validateMetadataBatch(rows, expectedKeys) {
  if (!Array.isArray(rows) || rows.length !== expectedKeys.length) {
    fail('AGENT_PERMISSION_SCOPE_UNAVAILABLE', 'Mirrored CRM metadata batch is incomplete.', 503);
  }
  const expected = new Set(expectedKeys);
  const seen = new Set();
  const rowsByKey = new Map();
  for (const row of rows) {
    const key = typeof row?.key === 'string' ? row.key : '';
    if (!expected.has(key) || seen.has(key)) {
      fail('AGENT_PERMISSION_SCOPE_UNAVAILABLE', 'Mirrored CRM metadata batch contains an unexpected or duplicate definition.', 503);
    }
    seen.add(key);
    rowsByKey.set(key, row);
  }
  return expectedKeys.map(key => rowsByKey.get(key));
}

function isAdaptiveMetadataReadError(error) {
  if (error instanceof CrmAgentRouteError) return false;
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return code === '57014'
    || /(?:statement|query)\s+timeout|canceling statement|resource limit|response too large|payload too large/i.test(message);
}

async function readMetadataBatch(readOnlyQuery, expectedKeys) {
  const query = metadataBatchQuery(expectedKeys);
  let rows;
  try {
    rows = await readOnlyQuery(query);
  } catch (error) {
    if (expectedKeys.length === 1 || !isAdaptiveMetadataReadError(error)) throw error;
    const midpoint = Math.ceil(expectedKeys.length / 2);
    const left = await readMetadataBatch(readOnlyQuery, expectedKeys.slice(0, midpoint));
    const right = await readMetadataBatch(readOnlyQuery, expectedKeys.slice(midpoint));
    return [...left, ...right];
  }
  return validateMetadataBatch(rows, expectedKeys);
}

function metadataRowsToSnapshot(rows) {
  if (!Array.isArray(rows) || rows.length > AGENT_METADATA_ROW_LIMIT) {
    fail('AGENT_PERMISSION_SCOPE_UNAVAILABLE', 'Mirrored CRM metadata is unavailable or exceeds the reviewed bound.', 503);
  }
  let modules = null;
  const fields_by_module = Object.create(null);
  const layouts_by_module = Object.create(null);
  const seen = new Set();
  for (const row of rows) {
    const key = typeof row?.key === 'string' ? row.key : '';
    if (seen.has(key)) fail('AGENT_PERMISSION_SCOPE_UNAVAILABLE', 'Mirrored CRM metadata contains duplicate definitions.', 503);
    seen.add(key);
    if (key === 'modules') modules = row.data;
    else if (key.startsWith('fields:')) {
      const module = key.slice('fields:'.length);
      if (MODULE_PATTERN.test(module)) fields_by_module[module] = row.data;
    } else if (key.startsWith('layouts:')) {
      const module = key.slice('layouts:'.length);
      if (MODULE_PATTERN.test(module)) layouts_by_module[module] = row.data;
    }
  }
  if (!modules) fail('AGENT_PERMISSION_SCOPE_UNAVAILABLE', 'Mirrored CRM module metadata is unavailable.', 503);
  return { modules, fields_by_module, layouts_by_module };
}

async function loadMirroredAgentMetadata(readOnlyQuery, { deterministicOnly = false } = {}) {
  if (typeof readOnlyQuery !== 'function') {
    fail('AGENT_PERMISSION_SCOPE_UNAVAILABLE', 'The local read-only metadata query adapter is unavailable.', 503);
  }
  try {
    const startedAt = Date.now();
    let queryAttempts = 0;
    const boundedReadOnlyQuery = async query => {
      if (queryAttempts >= AGENT_METADATA_MAX_QUERY_ATTEMPTS
        || Date.now() - startedAt >= AGENT_METADATA_LOAD_BUDGET_MS) {
        fail('AGENT_PERMISSION_SCOPE_UNAVAILABLE', 'Mirrored CRM metadata read budget was exhausted.', 503);
      }
      queryAttempts += 1;
      return readOnlyQuery(query);
    };
    const discoveredRows = await boundedReadOnlyQuery(deterministicOnly ? DETERMINISTIC_METADATA_QUERY : AGENT_METADATA_QUERY);
    const discoveredKeys = validateDiscoveredMetadataKeys(discoveredRows);
    const moduleRows = await boundedReadOnlyQuery(AGENT_METADATA_MODULE_QUERY);
    if (!Array.isArray(moduleRows) || moduleRows.length !== 1 || moduleRows[0]?.key !== 'modules') {
      fail('AGENT_PERMISSION_SCOPE_UNAVAILABLE', 'Mirrored CRM module metadata is unavailable or ambiguous.', 503);
    }
    const rows = [...moduleRows];
    const selectedKeys = selectedMetadataKeys(moduleRows[0].data, discoveredKeys);
    for (let index = 0; index < selectedKeys.length; index += AGENT_METADATA_BATCH_SIZE) {
      const batchKeys = selectedKeys.slice(index, index + AGENT_METADATA_BATCH_SIZE);
      rows.push(...await readMetadataBatch(boundedReadOnlyQuery, batchKeys));
    }
    return metadataRowsToSnapshot(rows);
  } catch (error) {
    if (error instanceof CrmAgentRouteError) throw error;
    fail('AGENT_PERMISSION_SCOPE_UNAVAILABLE', 'Mirrored CRM metadata could not be read.', 503);
  }
}

function isSafeName(value, pattern) {
  return typeof value === 'string' && pattern.test(value) && !SENSITIVE_NAME_PATTERN.test(value);
}

function profileAllows(field, allowed) {
  const profiles = Array.isArray(field?.profiles) ? field.profiles : [];
  return profiles.length > 0 && profiles.every(profile => allowed.has(String(profile?.permission_type || '').toLowerCase()));
}

function isVisibleReadableField(field) {
  if (!isSafeName(field?.api_name, FIELD_PATTERN) || field.visible !== true || FORBIDDEN_DATA_TYPES.has(field.data_type)) return false;
  if (field.crypt && (typeof field.crypt !== 'object' || Object.keys(field.crypt).length > 0)) return false;
  if (field.api_name !== 'id' && field.view_type?.view !== true) return false;
  return profileAllows(field, PROFILE_READ_PERMISSIONS);
}

function isWritableDraftField(field) {
  if (!isSafeName(field?.api_name, FIELD_PATTERN) || field.api_name === 'id' || field.visible !== true
    || FORBIDDEN_DATA_TYPES.has(field.data_type)) return false;
  if (field.crypt && (typeof field.crypt !== 'object' || Object.keys(field.crypt).length > 0)) return false;
  if (field.read_only === true || field.field_read_only === true || field.virtual_field === true || field.data_type === 'formula') return false;
  if (field.operation_type?.api_create !== true || field.view_type?.create !== true) return false;
  return profileAllows(field, PROFILE_WRITE_PERMISSIONS);
}

function normalizedMetadataField(field) {
  return {
    api_name: field.api_name,
    field_label: typeof field.field_label === 'string' ? field.field_label.slice(0, 160) : field.api_name,
    display_label: typeof field.display_label === 'string' ? field.display_label.slice(0, 160) : undefined,
    data_type: typeof field.data_type === 'string' ? field.data_type.slice(0, 80) : null,
    required: field.required === true,
    system_mandatory: field.system_mandatory === true,
    read_only: field.read_only === true || field.field_read_only === true,
    virtual_field: field.virtual_field === true,
    pick_list_values: Array.isArray(field.pick_list_values)
      ? field.pick_list_values.slice(0, 50).map(option => ({
        actual_value: ['string', 'number', 'boolean'].includes(typeof option?.actual_value) ? option.actual_value : null,
        display_value: ['string', 'number', 'boolean'].includes(typeof option?.display_value) ? option.display_value : null,
        type: typeof option?.type === 'string' ? option.type.slice(0, 40) : null,
      }))
      : [],
  };
}

function lookupKey(value) {
  return typeof value === 'string' ? value.toLowerCase().replace(/[^a-z0-9]+/g, '') : '';
}

function boundedLabels(values, fallback) {
  const labels = [];
  const seen = new Set();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const label = value.replace(/\s+/g, ' ').trim().slice(0, 160);
    const key = lookupKey(label);
    if (!key || seen.has(key) || SENSITIVE_NAME_PATTERN.test(label)) continue;
    seen.add(key);
    labels.push(label);
  }
  return Object.freeze(labels.length ? labels : [fallback]);
}

function isDeterministicCategoryField(field) {
  const type = String(field?.data_type || '').toLowerCase();
  const name = field?.api_name;
  return DETERMINISTIC_CATEGORY_DATA_TYPES.has(type)
    && isSafeName(name, FIELD_PATTERN)
    && DETERMINISTIC_CATEGORY_NAME_PATTERN.test(name)
    && !DETERMINISTIC_PRIVATE_DIMENSION_PATTERN.test(name);
}

function moduleIsEligible(module) {
  return isSafeName(module?.api_name, MODULE_PATTERN)
    && module.api_supported === true
    && module.viewable === true
    && String(module.status || '').toLowerCase() === 'visible';
}

function conservativeLayoutFields(fields, layoutsMeta) {
  const layouts = layoutList(layoutsMeta);
  if (!layouts.length) return null;
  let merged;
  try {
    merged = layouts.map(layout => mergeLayoutFields(fields, layout));
  } catch {
    return null;
  }
  const commonNames = new Set(merged[0].map(field => field.api_name));
  for (const scopedFields of merged.slice(1)) {
    const names = new Set(scopedFields.map(field => field.api_name));
    for (const name of commonNames) if (!names.has(name)) commonNames.delete(name);
  }
  const baseByName = new Map(fields.map(field => [field.api_name, field]));
  const common = [...commonNames].map(name => {
    const variants = merged.map(scopedFields => scopedFields.find(field => field.api_name === name)).filter(Boolean);
    return {
      ...baseByName.get(name),
      ...variants[0],
      required: variants.some(field => field.required === true || field.system_mandatory === true),
      system_mandatory: variants.some(field => field.system_mandatory === true),
      read_only: variants.some(field => field.read_only === true || field.field_read_only === true),
      virtual_field: variants.some(field => field.virtual_field === true),
    };
  });
  return { layouts, merged, common };
}

function deriveCrmAgentScope(snapshot) {
  const modules = moduleEntries(snapshot?.modules).filter(moduleIsEligible).slice(0, 150);
  const modulePolicies = {};
  const metadata_by_module = Object.create(null);
  const field_types_by_module = Object.create(null);
  const publicModules = [];
  const deterministicModules = [];

  for (const module of modules) {
    const name = module.api_name;
    const fieldMeta = snapshot?.fields_by_module?.[name];
    const fields = Array.isArray(fieldMeta?.fields) ? fieldMeta.fields.filter(field => field && typeof field === 'object') : [];
    if (!fields.length) continue;
    const scoped = conservativeLayoutFields(fields, snapshot?.layouts_by_module?.[name]);
    if (!scoped || !scoped.common.length) continue;

    const readableFields = scoped.common.filter(isVisibleReadableField).slice(0, LIMITS.permission_fields);
    if (!readableFields.length) continue;
    const readableNames = readableFields.map(field => field.api_name);
    const aggregateNames = readableFields
      .filter(field => field.filterable === true && !FORBIDDEN_DATA_TYPES.has(field.data_type))
      .map(field => field.api_name);
    const layoutResolved = scoped.layouts.length === 1;
    const writableFields = layoutResolved && module.creatable === true
      ? scoped.merged[0].filter(isWritableDraftField).slice(0, LIMITS.permission_fields)
      : [];
    const writableNames = writableFields.map(field => field.api_name);
    const metadataFields = new Map();
    [...readableFields, ...writableFields].forEach(field => metadataFields.set(field.api_name, normalizedMetadataField(field)));

    modulePolicies[name] = {
      aggregate: aggregateNames.length > 0,
      search: module.global_search_supported === true,
      detail: true,
      metadata: true,
      create_draft: layoutResolved && writableNames.length > 0,
      readable_fields: readableNames,
      aggregate_fields: aggregateNames,
      writable_fields: writableNames,
    };
    metadata_by_module[name] = Object.freeze({
      definition_complete: true,
      layout_resolved: layoutResolved,
      fields: Object.freeze([...metadataFields.values()]),
    });
    field_types_by_module[name] = Object.freeze(Object.fromEntries(readableFields.map(field => [field.api_name, field.data_type || null])));
    const deterministicFields = readableFields
      .filter(field => aggregateNames.includes(field.api_name) && isDeterministicCategoryField(field))
      .map(field => Object.freeze({
        api_name: field.api_name,
        label: boundedLabels([field.field_label, field.display_label, field.api_name], field.api_name)[0],
        aliases: boundedLabels([field.api_name, field.field_label, field.display_label], field.api_name),
      }));
    deterministicModules.push(Object.freeze({
      api_name: name,
      label: boundedLabels([
        module.plural_label,
        module.actual_plural_label,
        module.module_name,
        module.singular_label,
        module.actual_singular_label,
        name,
      ], name)[0],
      aliases: boundedLabels([
        name,
        module.module_name,
        module.plural_label,
        module.actual_plural_label,
        module.singular_label,
        module.actual_singular_label,
      ], name),
      countable: aggregateNames.length > 0,
      aggregate_fields: Object.freeze(deterministicFields),
    }));
    publicModules.push(Object.freeze({
      module: name,
      capabilities: Object.freeze({
        aggregate: modulePolicies[name].aggregate,
        search: modulePolicies[name].search,
        detail: true,
        metadata: true,
        create_draft: modulePolicies[name].create_draft,
      }),
      readable_field_count: readableNames.length,
      aggregate_field_count: aggregateNames.length,
      writable_draft_field_count: writableNames.length,
      layout_resolved: layoutResolved,
    }));
  }

  if (!Object.keys(modulePolicies).length) {
    fail('AGENT_PERMISSION_SCOPE_UNAVAILABLE', 'No module has complete mirrored module, field, layout, and profile-permission metadata.', 503);
  }
  const permissions = normalizePermissionContext({ modules: modulePolicies });
  return Object.freeze({
    permissions,
    metadata_by_module: Object.freeze(metadata_by_module),
    field_types_by_module: Object.freeze(field_types_by_module),
    deterministic_catalog: Object.freeze({ modules: Object.freeze(deterministicModules) }),
    public_scope: Object.freeze({
      loaded: true,
      basis: AGENT_SCOPE_BASIS,
      module_count: publicModules.length,
      modules: Object.freeze(publicModules),
    }),
  });
}

function sqlLiteral(value) {
  if (value === null) return 'null';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('AGENT_INPUT_INVALID', 'A filter value is not finite.', 400);
    return String(value);
  }
  if (typeof value === 'boolean') return value ? "'true'" : "'false'";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function textExpression(field) {
  const quoted = sqlLiteral(field);
  return `coalesce((data->${quoted})->>'name', data->>${quoted})`;
}

function comparisonExpression(field, dataType) {
  const text = textExpression(field);
  if (!NUMERIC_DATA_TYPES.has(dataType)) return text;
  return `(case when ${text} ~ '^-?([0-9]+([.][0-9]+)?|[.][0-9]+)$' then (${text})::numeric else null end)`;
}

function filterSql(filter, fieldTypes) {
  const dataType = fieldTypes[filter.field];
  const expression = comparisonExpression(filter.field, dataType);
  const numeric = NUMERIC_DATA_TYPES.has(dataType);
  const literal = value => numeric ? sqlLiteral(Number(value)) : sqlLiteral(value === null ? null : String(value));
  if (filter.operator === 'is_empty') return `(${textExpression(filter.field)} is null or btrim(${textExpression(filter.field)}) = '')`;
  if (filter.operator === 'is_not_empty') return `(${textExpression(filter.field)} is not null and btrim(${textExpression(filter.field)}) <> '')`;
  if (filter.operator === 'equal') return filter.value === null ? `${expression} is null` : `${expression} = ${literal(filter.value)}`;
  if (filter.operator === 'not_equal') return filter.value === null ? `${expression} is not null` : `${expression} is distinct from ${literal(filter.value)}`;
  if (filter.operator === 'greater_than') return `${expression} > ${literal(filter.value)}`;
  if (filter.operator === 'greater_equal') return `${expression} >= ${literal(filter.value)}`;
  if (filter.operator === 'less_than') return `${expression} < ${literal(filter.value)}`;
  if (filter.operator === 'less_equal') return `${expression} <= ${literal(filter.value)}`;
  if (filter.operator === 'between') return `${expression} between ${literal(filter.value[0])} and ${literal(filter.value[1])}`;
  if (filter.operator === 'in' || filter.operator === 'not_in') {
    const values = filter.value;
    const nonNull = values.filter(value => value !== null);
    const clauses = [];
    if (nonNull.length) clauses.push(`${expression} ${filter.operator === 'not_in' ? 'not in' : 'in'} (${nonNull.map(literal).join(',')})`);
    if (values.includes(null)) clauses.push(`${expression} is ${filter.operator === 'not_in' ? 'not ' : ''}null`);
    return `(${clauses.join(filter.operator === 'not_in' ? ' and ' : ' or ')})`;
  }
  fail('AGENT_INPUT_INVALID', 'A filter operator is unsupported by the local read-only adapter.', 400);
}

function assertReadOnlyExecution(input, bundle, capability) {
  if (!input || input.source_mode !== AGENT_SOURCE_MODE) fail('AGENT_HANDLER_CONFIGURATION_INVALID', 'The CRM agent attempted to leave local read-only mode.', 500);
  const policy = bundle.permissions.modules[input.module];
  if (!policy || policy[capability] !== true) fail('AGENT_PERMISSION_DENIED', 'The requested local CRM operation is not permitted.', 403);
  return policy;
}

function cloneAggregateResult(result) {
  return {
    total: Number(result?.total || 0),
    groups: Array.isArray(result?.groups) ? result.groups.map(group => ({ value: group.value, count: group.count })) : [],
  };
}

function createLocalCrmAgentHandlers({ readOnlyQuery, bundle, aggregateCache = null, aggregateCacheTtlMs = AGENT_AGGREGATE_CACHE_MS }) {
  if (typeof readOnlyQuery !== 'function') fail('AGENT_HANDLER_CONFIGURATION_INVALID', 'The local read-only query adapter is unavailable.', 500);
  if (aggregateCache !== null && !(aggregateCache instanceof Map)) fail('AGENT_HANDLER_CONFIGURATION_INVALID', 'The local aggregate cache is invalid.', 500);
  if (!Number.isSafeInteger(aggregateCacheTtlMs) || aggregateCacheTtlMs < 1 || aggregateCacheTtlMs > AGENT_AGGREGATE_CACHE_MS) {
    fail('AGENT_HANDLER_CONFIGURATION_INVALID', 'The local aggregate cache lifetime is invalid.', 500);
  }
  return Object.freeze({
    source_mode: AGENT_SOURCE_MODE,
    async aggregateRecords(input, { abortSignal } = {}) {
      const policy = assertReadOnlyExecution(input, bundle, 'aggregate');
      const allowed = new Set(policy.aggregate_fields);
      if ((input.group_by && !allowed.has(input.group_by)) || input.filters.some(filter => !allowed.has(filter.field))) {
        fail('AGENT_PERMISSION_DENIED', 'An aggregate field is outside the mirrored permission scope.', 403);
      }
      const fieldTypes = bundle.field_types_by_module[input.module] || {};
      const filters = input.filters.map(filter => filterSql(filter, fieldTypes));
      const where = [`module = ${sqlLiteral(input.module)}`, "coalesce(data->>'__test_artifact','false') <> 'true'", ...filters].join(' and ');
      const aggregateRead = async statement => (await executeBoundedLocalRead({
        readOnlyQuery,
        statement,
        abortSignal,
      })).result;
      const execute = async () => {
        if (!input.group_by) {
          const rows = await aggregateRead(`select count(*)::int as total from crm_records where ${where}`);
          return { total: Number(rows?.[0]?.total || 0), groups: [] };
        }
        const group = input.module === 'Leads' && input.group_by === 'Lead_Status'
          ? 'status'
          : textExpression(input.group_by);
        const rows = await aggregateRead(`select ${group} as value, count(*)::int as count, sum(count(*)) over()::int as total
from crm_records
where ${where}
group by 1
order by 2 desc, 1 asc nulls last
limit ${Number(input.limit)}`);
        return { total: Number(rows?.[0]?.total || 0), groups: (rows || []).map(row => ({ value: row.value, count: row.count })) };
      };
      if (!aggregateCache || input.filters.length) return execute();
      const cacheKey = `${input.module}|${input.group_by || ''}|${Number(input.limit)}`;
      const hit = aggregateCache.get(cacheKey);
      if (hit && Date.now() - hit.at < aggregateCacheTtlMs) {
        return cloneAggregateResult(hit.promise ? await hit.promise : hit.data);
      }
      const pending = execute();
      const pendingEntry = { at: Date.now(), promise: pending };
      aggregateCache.set(cacheKey, pendingEntry);
      try {
        const result = await pending;
        // A record mutation clears this shared Map. Do not let a read that
        // began before that invalidation repopulate it with a stale result, or
        // overwrite a newer in-flight entry for the same aggregate key.
        if (aggregateCache.get(cacheKey) === pendingEntry) {
          aggregateCache.set(cacheKey, { at: Date.now(), data: cloneAggregateResult(result) });
        }
        return cloneAggregateResult(result);
      } catch (error) {
        if (aggregateCache.get(cacheKey) === pendingEntry) aggregateCache.delete(cacheKey);
        throw error;
      }
    },
    async searchRecords(input) {
      const policy = assertReadOnlyExecution(input, bundle, 'search');
      if (input.overdue_only === true) {
        if (input.module !== 'Tasks' || !policy.readable_fields.includes('Due_Date') || !policy.readable_fields.includes('Status')) {
          fail('AGENT_PERMISSION_DENIED', 'Overdue Task lookup is outside the mirrored permission scope.', 403);
        }
        const rows = await readOnlyQuery(`select data
from crm_records
where module = 'Tasks'
  and coalesce(data->>'__test_artifact','false') <> 'true'
  and due_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  and due_date < to_char(current_date, 'YYYY-MM-DD')
  and coalesce(status,'') <> 'Completed'
  and lower(coalesce(status,'')) <> 'completed'
order by due_date asc, modified_time desc nulls last
limit ${Number(input.limit)}`);
        return { records: (rows || []).map(row => row?.data).filter(record => record && typeof record === 'object' && !Array.isArray(record)) };
      }
      const query = `%${String(input.query).replace(/'/g, "''")}%`;
      const rows = await readOnlyQuery(`select data
from crm_records
where module = ${sqlLiteral(input.module)}
  and coalesce(data->>'__test_artifact','false') <> 'true'
  and search_text ilike '${query}'
order by modified_time desc nulls last
limit ${Number(input.limit)}`);
      return { records: (rows || []).map(row => row?.data).filter(record => record && typeof record === 'object' && !Array.isArray(record)) };
    },
    async getRecord(input) {
      assertReadOnlyExecution(input, bundle, 'detail');
      const rows = await readOnlyQuery(`select data
from crm_records
where module = ${sqlLiteral(input.module)}
  and id = ${sqlLiteral(input.record_id)}
  and coalesce(data->>'__test_artifact','false') <> 'true'
limit 1`);
      return { record: rows?.[0]?.data || null };
    },
    async getModuleMetadata(input) {
      assertReadOnlyExecution(input, bundle, 'metadata');
      return bundle.metadata_by_module[input.module];
    },
  });
}

function unavailablePermissionScope() {
  return Object.freeze({ loaded: false, basis: AGENT_SCOPE_BASIS, module_count: 0, modules: Object.freeze([]) });
}

function routeLimits() {
  return Object.freeze({
    prompt_characters: AGENT_PROMPT_MAX_CHARACTERS,
    prompt_bytes: AGENT_PROMPT_MAX_BYTES,
    max_concurrent_chats: AGENT_MAX_CONCURRENT_CHATS,
    max_agent_steps: 6,
    max_output_tokens: 1_200,
  });
}

function deterministicIntentAvailability(bundle) {
  const modules = bundle?.permissions?.modules || {};
  const leads = modules.Leads || null;
  const tasks = modules.Tasks || null;
  const leadMetadata = bundle?.metadata_by_module?.Leads || null;
  const exactLeadLayout = leadMetadata?.definition_complete === true && leadMetadata?.layout_resolved === true;
  const catalogModules = Array.isArray(bundle?.deterministic_catalog?.modules) ? bundle.deterministic_catalog.modules : [];
  const checks = {
    count_leads_by_status: Boolean(leads?.aggregate === true && leads.aggregate_fields?.includes('Lead_Status')),
    find_overdue_tasks: Boolean(tasks?.search === true
      && ['Subject', 'Due_Date', 'Status'].every(field => tasks.readable_fields?.includes(field))),
    required_lead_fields: Boolean(leads?.metadata === true && exactLeadLayout),
    prepare_lead_draft: Boolean(leads?.create_draft === true && exactLeadLayout && leads.writable_fields?.includes('Last_Name')),
    count_module_records: catalogModules.some(module => module.countable === true),
    count_module_by_safe_field: catalogModules.some(module => module.countable === true && module.aggregate_fields.length > 0),
    count_module_by_safe_field_where_empty: catalogModules.some(module => module.countable === true && module.aggregate_fields.length > 0),
  };
  return Object.freeze(DETERMINISTIC_INTENT_REQUIREMENTS.map(requirement => Object.freeze({
    ...requirement,
    available: checks[requirement.name] === true,
  })));
}

function publicFallback(availability, bundle) {
  const intents = deterministicIntentAvailability(bundle);
  const supported = intents.filter(intent => intent.available);
  return Object.freeze({
    mode: availability.fallback.mode,
    message: supported.length
      ? `AI model unavailable. Keyless local mode can answer ${supported.length} of ${DETERMINISTIC_SUPPORTED_QUESTIONS.length} reviewed CRM questions with no model or network call.`
      : 'AI model unavailable. No reviewed keyless CRM question currently passes the mirrored permission and schema preflight.',
    network_attempted: false,
    supported_questions: Object.freeze(supported.map(intent => intent.question)),
    reviewed_questions: DETERMINISTIC_SUPPORTED_QUESTIONS,
    unavailable_questions: Object.freeze(intents.filter(intent => !intent.available).map(intent => Object.freeze({
      question: intent.question,
      reason_code: intent.reason_code,
      message: intent.unavailable_message,
    }))),
  });
}

function deterministicStatus(availability, bundle) {
  const fallback = publicFallback(availability, bundle);
  const deterministicAvailable = fallback.supported_questions.length > 0;
  return Object.freeze({
    available: false,
    deterministic_available: deterministicAvailable,
    status: deterministicAvailable ? 'DeterministicOnly' : 'Unavailable',
    reason_code: availability.reason_code,
    model: null,
    provider: 'Local deterministic parser',
    source_mode: AGENT_SOURCE_MODE,
    network_attempted: false,
    telemetry_enabled: false,
    tools: CRM_AGENT_TOOL_NAMES,
    permission_scope: bundle.public_scope,
    limits: routeLimits(),
    fallback,
  });
}

function statusWithScope(availability, bundle) {
  return Object.freeze({
    available: true,
    status: 'Available',
    reason_code: null,
    model: availability.model,
    provider: 'Vercel AI Gateway',
    source_mode: AGENT_SOURCE_MODE,
    telemetry_enabled: false,
    tools: CRM_AGENT_TOOL_NAMES,
    permission_scope: bundle.public_scope,
    limits: routeLimits(),
    fallback: null,
  });
}

function parseDeterministicPrompt(prompt) {
  const compact = String(prompt || '').replace(/\s+/g, ' ').trim();
  if (/^(?:please )?count(?: my)? leads by lead status[?.!]*$/i.test(compact)) {
    return Object.freeze({
      name: 'count_leads_by_status',
      toolName: 'aggregate_records',
      input: Object.freeze({ module: 'Leads', group_by: 'Lead_Status', filters: [], limit: 50 }),
    });
  }
  if (/^(?:please )?find(?: up to)? 10 overdue tasks[?.!]*$/i.test(compact)) {
    return Object.freeze({
      name: 'find_overdue_tasks',
      toolName: 'search_records',
      input: Object.freeze({ module: 'Tasks', overdue_only: true, limit: 10 }),
    });
  }
  if (/^(?:please )?show(?: me)? (?:the )?required fields for (?:a )?new lead[?.!]*$/i.test(compact)) {
    return Object.freeze({
      name: 'required_lead_fields',
      toolName: 'inspect_module_metadata',
      input: Object.freeze({ module: 'Leads', required_only: true, limit: 100 }),
    });
  }
  const draftMatch = compact.match(/^(?:please )?prepare (?:a )?new lead draft(?: for review)? with last name\s*:\s*(.+)$/i);
  if (draftMatch) {
    const lastName = draftMatch[1].trim();
    if (lastName && lastName.length <= 120) {
      return Object.freeze({
        name: 'prepare_lead_draft',
        toolName: 'prepare_record_creation_draft',
        input: Object.freeze({ module: 'Leads', values: Object.freeze({ Last_Name: lastName }) }),
      });
    }
  }
  const unpunctuated = compact.replace(/[?.!]+$/, '');
  const filteredGroupedMatch = unpunctuated.match(/^(?:please )?count records in ([A-Za-z][A-Za-z0-9_$ ]{0,79}?) by ([A-Za-z][A-Za-z0-9_$ ]{0,119}?) where ([A-Za-z][A-Za-z0-9_$ ]{0,119}?) is empty$/i);
  if (filteredGroupedMatch) {
    return Object.freeze({
      name: 'count_module_by_safe_field_where_empty',
      toolName: 'aggregate_records',
      parameters: Object.freeze({
        module: filteredGroupedMatch[1].trim(),
        group_field: filteredGroupedMatch[2].trim(),
        filter_field: filteredGroupedMatch[3].trim(),
      }),
    });
  }
  const groupedMatch = unpunctuated.match(/^(?:please )?count records in ([A-Za-z][A-Za-z0-9_$ ]{0,79}) by ([A-Za-z][A-Za-z0-9_$ ]{0,119})$/i)
    || unpunctuated.match(/^(?:please )?count ([A-Za-z][A-Za-z0-9_$ ]{0,79}) by ([A-Za-z][A-Za-z0-9_$ ]{0,119})$/i);
  if (groupedMatch) {
    return Object.freeze({
      name: 'count_module_by_safe_field',
      toolName: 'aggregate_records',
      parameters: Object.freeze({ module: groupedMatch[1].trim(), field: groupedMatch[2].trim() }),
    });
  }
  const countMatch = unpunctuated.match(/^(?:please )?count records in ([A-Za-z][A-Za-z0-9_$ ]{0,79})$/i)
    || unpunctuated.match(/^(?:please )?count ([A-Za-z][A-Za-z0-9_$ ]{0,79}) records$/i);
  if (countMatch) {
    return Object.freeze({
      name: 'count_module_records',
      toolName: 'aggregate_records',
      parameters: Object.freeze({ module: countMatch[1].trim() }),
    });
  }
  return null;
}

function uniqueCatalogMatch(entries, token) {
  const key = lookupKey(token);
  if (!key) return null;
  const matches = entries.filter(entry => entry.aliases.some(alias => lookupKey(alias) === key));
  return matches.length === 1 ? matches[0] : null;
}

function resolveDeterministicIntent(intent, bundle) {
  if (!['count_module_records', 'count_module_by_safe_field', 'count_module_by_safe_field_where_empty'].includes(intent.name)) return { intent };
  const modules = Array.isArray(bundle?.deterministic_catalog?.modules) ? bundle.deterministic_catalog.modules : [];
  const module = uniqueCatalogMatch(modules, intent.parameters?.module);
  if (!module || module.countable !== true) {
    return {
      reason_code: 'DETERMINISTIC_MODULE_UNAVAILABLE',
      message: 'The requested module is not an exact, uniquely resolved module in the mirrored aggregate permission scope. No CRM records were read.',
    };
  }
  if (intent.name === 'count_module_records') {
    return {
      intent: Object.freeze({
        ...intent,
        input: Object.freeze({ module: module.api_name, group_by: null, filters: [], limit: 1 }),
        display: Object.freeze({ module: module.label }),
      }),
    };
  }
  if (intent.name === 'count_module_by_safe_field_where_empty') {
    const groupField = uniqueCatalogMatch(module.aggregate_fields, intent.parameters?.group_field);
    const filterField = uniqueCatalogMatch(module.aggregate_fields, intent.parameters?.filter_field);
    if (!groupField || !filterField) {
      return {
        reason_code: 'DETERMINISTIC_AGGREGATE_FIELD_UNAVAILABLE',
        message: 'A requested grouping or filter field is not an exact reviewed non-private categorical aggregate field for that module. No CRM records were read.',
      };
    }
    return {
      intent: Object.freeze({
        ...intent,
        input: Object.freeze({
          module: module.api_name,
          group_by: groupField.api_name,
          filters: Object.freeze([Object.freeze({ field: filterField.api_name, operator: 'is_empty' })]),
          limit: 50,
        }),
        display: Object.freeze({ module: module.label, field: groupField.label, filter_field: filterField.label }),
      }),
    };
  }
  const field = uniqueCatalogMatch(module.aggregate_fields, intent.parameters?.field);
  if (!field) {
    return {
      reason_code: 'DETERMINISTIC_AGGREGATE_FIELD_UNAVAILABLE',
      message: 'The requested field is not an exact reviewed non-private categorical aggregate field for that module. No CRM records were read.',
    };
  }
  return {
    intent: Object.freeze({
      ...intent,
      input: Object.freeze({ module: module.api_name, group_by: field.api_name, filters: [], limit: 50 }),
      display: Object.freeze({ module: module.label, field: field.label }),
    }),
  };
}

function simpleValue(value) {
  if (value === null || value === undefined || value === '') return 'Not set';
  if (typeof value === 'object') {
    if (typeof value.name === 'string' && value.name.trim()) return value.name.trim();
    return 'Structured value';
  }
  return String(value).slice(0, 240);
}

function deterministicAnswer(intent, result) {
  if (intent.name === 'count_leads_by_status') {
    const groups = Array.isArray(result?.groups) ? result.groups : [];
    const lines = groups.map(group => `${simpleValue(group.value)}: ${Number(group.count || 0).toLocaleString('en-IN')}`);
    return safeText([
      `Leads by Lead Status — ${Number(result?.total || 0).toLocaleString('en-IN')} total.`,
      ...(lines.length ? lines : ['No Lead records were found.']),
    ].join('\n'));
  }
  if (intent.name === 'find_overdue_tasks') {
    const records = Array.isArray(result?.records) ? result.records.slice(0, 10) : [];
    const lines = records.map((record, index) => {
      const subject = simpleValue(record.Subject || record.Name || `Task ${index + 1}`);
      return `${index + 1}. ${subject} — due ${simpleValue(record.Due_Date)} · ${simpleValue(record.Status)}`;
    });
    return safeText(lines.length
      ? `Up to 10 overdue Tasks from the local read-only replica:\n${lines.join('\n')}`
      : 'No overdue Tasks were found in the permission-scoped local replica.');
  }
  if (intent.name === 'count_module_records') {
    return safeText(`${simpleValue(intent.display?.module)} — ${Number(result?.total || 0).toLocaleString('en-IN')} records in the permission-scoped local replica.`);
  }
  if (intent.name === 'count_module_by_safe_field') {
    const groups = Array.isArray(result?.groups) ? result.groups : [];
    const lines = groups.map(group => `${simpleValue(group.value)}: ${Number(group.count || 0).toLocaleString('en-IN')}`);
    return safeText([
      `${simpleValue(intent.display?.module)} by ${simpleValue(intent.display?.field)} — ${Number(result?.total || 0).toLocaleString('en-IN')} total.`,
      ...(lines.length ? lines : ['No records were found.']),
    ].join('\n'));
  }
  if (intent.name === 'count_module_by_safe_field_where_empty') {
    const groups = Array.isArray(result?.groups) ? result.groups : [];
    const lines = groups.map(group => `${simpleValue(group.value)}: ${Number(group.count || 0).toLocaleString('en-IN')}`);
    return safeText([
      `${simpleValue(intent.display?.module)} by ${simpleValue(intent.display?.field)} where ${simpleValue(intent.display?.filter_field)} is empty — ${Number(result?.total || 0).toLocaleString('en-IN')} total.`,
      ...(lines.length ? lines : ['No records were found.']),
    ].join('\n'));
  }
  if (intent.name === 'required_lead_fields') {
    if (result?.definition_complete !== true || result?.layout_resolved !== true) {
      return 'Required Lead fields are unavailable because the exact mirrored Lead create layout is incomplete or ambiguous.';
    }
    const fields = Array.isArray(result?.fields) ? result.fields : [];
    const lines = fields.map(field => `${simpleValue(field.label)} (${simpleValue(field.api_name)})`);
    return safeText(lines.length
      ? `Required fields for a new Lead in the resolved mirrored layout:\n${lines.join('\n')}`
      : 'No create-required Lead fields are visible in the resolved mirrored permission scope.');
  }
  return 'A preview-only Lead draft is ready. No record has been created; review and explicitly submit it through the existing validated Create form.';
}

async function runDeterministicPrompt({ prompt, handlers, permissions, bundle, abortSignal }) {
  const parsedIntent = parseDeterministicPrompt(prompt);
  if (!parsedIntent) {
    const availableQuestions = deterministicIntentAvailability(bundle)
      .filter(item => item.available)
      .map(item => item.question);
    return Object.freeze({
      intent: 'unsupported',
      answer: availableQuestions.length
        ? `Keyless local mode supports only these currently available bounded questions:\n${availableQuestions.map(question => `• ${question}`).join('\n')}`
        : 'No reviewed keyless question currently passes the mirrored permission and schema preflight.',
      draft_preview: null,
      executed_tools: Object.freeze([]),
      reason_code: 'DETERMINISTIC_PROMPT_UNSUPPORTED',
    });
  }
  const availability = deterministicIntentAvailability(bundle).find(item => item.name === parsedIntent.name);
  if (!availability?.available) {
    return Object.freeze({
      intent: parsedIntent.name,
      answer: availability?.unavailable_message || 'This reviewed local question is unavailable because its mirrored permission or schema requirements are incomplete.',
      draft_preview: null,
      executed_tools: Object.freeze([]),
      reason_code: availability?.reason_code || 'DETERMINISTIC_INTENT_UNAVAILABLE',
    });
  }
  const resolved = resolveDeterministicIntent(parsedIntent, bundle);
  if (!resolved.intent) {
    return Object.freeze({
      intent: parsedIntent.name,
      answer: resolved.message,
      draft_preview: null,
      executed_tools: Object.freeze([]),
      reason_code: resolved.reason_code,
    });
  }
  const intent = resolved.intent;
  const result = await executeCrmAgentTool({
    toolName: intent.toolName,
    input: intent.input,
    handlers,
    permissions,
    execution: { abortSignal },
  });
  const draftPreview = intent.name === 'prepare_lead_draft'
    ? draftFromResult({ toolResults: [{ toolName: intent.toolName, output: result }] })
    : null;
  return Object.freeze({
    intent: intent.name,
    answer: deterministicAnswer(intent, result),
    draft_preview: draftPreview,
    executed_tools: Object.freeze([intent.toolName]),
    reason_code: null,
  });
}

function draftFromResult(result) {
  const toolResults = Array.isArray(result?.toolResults) ? result.toolResults : [];
  const candidate = [...toolResults].reverse().find(item => item?.toolName === 'prepare_record_creation_draft' && item?.output?.status === 'PreviewOnly')?.output;
  if (!candidate || candidate.approval?.required !== true || candidate.approval?.approved !== false) return null;
  if (!MODULE_PATTERN.test(candidate.module || '') || !/^[a-f0-9]{64}$/.test(candidate.draft_fingerprint || '')) return null;
  if (!candidate.values || typeof candidate.values !== 'object' || Array.isArray(candidate.values)) return null;
  try {
    if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') > LIMITS.output_bytes) return null;
  } catch {
    return null;
  }
  const execution = candidate.execution || {};
  const executionKeys = ['local_create_route_called', 'local_database_write', 'zoho_contacted', 'zoho_write', 'outbound_action'];
  if (!executionKeys.every(key => execution[key] === false)) return null;
  return {
    status: 'PreviewOnly',
    module: candidate.module,
    layout: { resolved: candidate.validation?.metadata_complete === true, selection_required: candidate.validation?.metadata_complete !== true },
    values: candidate.values,
    draft_fingerprint: candidate.draft_fingerprint,
    validation: {
      ...candidate.validation,
      scope: 'mirrored-required-field-precheck',
      requires_existing_create_form_validation: true,
    },
    approval: { required: true, approved: false },
    execution: {
      local_create_route_called: false,
      local_database_write: false,
      zoho_contacted: false,
      zoho_write: false,
      outbound_action: false,
    },
    ui_handoff: {
      action: 'open_existing_validated_create_form',
      module: candidate.module,
      values: candidate.values,
      draft_fingerprint: candidate.draft_fingerprint,
      requires_explicit_user_approval: true,
      auto_submit: false,
    },
  };
}

function routeErrorBody(error) {
  const known = error instanceof CrmAgentRouteError || error instanceof CrmAgentPolicyError;
  return {
    status: known ? error.status : 502,
    body: {
      available: false,
      status: 'Error',
      reason_code: known ? error.code : 'AGENT_GENERATION_FAILED',
      error: {
        code: known ? error.code : 'AGENT_GENERATION_FAILED',
        message: known ? safeText(error.message, 500) : 'The CRM assistant could not complete this request. No local or source data was changed.',
      },
      draft_preview: null,
      bounded: true,
    },
  };
}

function createCrmAgentRouteService({
  env = process.env,
  readOnlyQuery,
  loadMetadata = null,
  runScopeLoad = null,
  createAgent = createCrmAgent,
  aggregateCache = null,
  aggregateCacheTtlMs = AGENT_AGGREGATE_CACHE_MS,
} = {}) {
  if (aggregateCache !== null && !(aggregateCache instanceof Map)) throw new TypeError('aggregateCache must be a Map when provided.');
  if (runScopeLoad !== null && typeof runScopeLoad !== 'function') throw new TypeError('runScopeLoad must be a function when provided.');
  let activeChats = 0;
  let scopeCache = null;
  let scopeCacheAt = 0;
  let scopeGeneration = 0;
  let scopeInFlight = null;
  const availability = () => getCrmAgentAvailability(env);
  const metadataLoader = typeof loadMetadata === 'function'
    ? loadMetadata
    : () => loadMirroredAgentMetadata(readOnlyQuery, { deterministicOnly: !availability().available });
  const coordinatedScopeLoad = runScopeLoad || ((task, _generation) => task());

  async function scopeBundle() {
    const generation = scopeGeneration;
    if (scopeCache && Date.now() - scopeCacheAt < AGENT_SCOPE_CACHE_MS) return scopeCache;
    if (scopeInFlight?.generation === generation) return scopeInFlight.promise;
    const flight = { generation, promise: null };
    flight.promise = Promise.resolve().then(async () => {
      try {
        const bundle = await coordinatedScopeLoad(async () => {
          const snapshot = await metadataLoader();
          return deriveCrmAgentScope(snapshot);
        }, generation);
        // A metadata refresh may happen while the old scope is loading. The
        // caller must receive the refreshed generation, and the old bundle
        // must never repopulate the permission cache.
        if (scopeGeneration !== generation) return scopeBundle();
        scopeCache = bundle;
        scopeCacheAt = Date.now();
        return bundle;
      } catch (error) {
        if (error instanceof CrmAgentRouteError) throw error;
        fail('AGENT_PERMISSION_SCOPE_UNAVAILABLE', 'Mirrored CRM permission metadata could not be prepared.', 503);
      } finally {
        if (scopeInFlight === flight) scopeInFlight = null;
      }
    });
    scopeInFlight = flight;
    return flight.promise;
  }

  return Object.freeze({
    invalidateDataCache() {
      if (aggregateCache) aggregateCache.clear();
    },
    invalidateMetadataCache() {
      if (aggregateCache) aggregateCache.clear();
      scopeGeneration += 1;
      scopeCache = null;
      scopeCacheAt = 0;
      scopeInFlight = null;
    },
    async status() {
      const currentAvailability = availability();
      if (!currentAvailability.available) return deterministicStatus(currentAvailability, await scopeBundle());
      return statusWithScope(currentAvailability, await scopeBundle());
    },
    async chat(input, { abortSignal } = {}) {
      const { prompt } = validateAgentChatInput(input);
      const currentAvailability = availability();
      if (activeChats >= AGENT_MAX_CONCURRENT_CHATS) {
        fail('AGENT_CHAT_BUSY', 'The CRM assistant is handling the maximum number of local requests. Try again shortly.', 429);
      }
      activeChats += 1;
      try {
        const bundle = await scopeBundle();
        const handlers = createLocalCrmAgentHandlers({ readOnlyQuery, bundle, aggregateCache, aggregateCacheTtlMs });
        if (!currentAvailability.available) {
          const deterministic = await runDeterministicPrompt({ prompt, handlers, permissions: bundle.permissions, bundle, abortSignal });
          const fallback = publicFallback(currentAvailability, bundle);
          return {
            available: false,
            deterministic_available: fallback.supported_questions.length > 0,
            status: 'Complete',
            reason_code: currentAvailability.reason_code,
            model: null,
            provider: 'Local deterministic parser',
            source_mode: AGENT_SOURCE_MODE,
            network_attempted: false,
            answer: deterministic.answer,
            fallback,
            permission_scope: bundle.public_scope,
            deterministic_intent: deterministic.intent,
            deterministic_reason_code: deterministic.reason_code,
            executed_tools: deterministic.executed_tools,
            draft_preview: deterministic.draft_preview,
            bounded: true,
          };
        }
        const created = await createAgent({ env, handlers, permissions: bundle.permissions });
        if (!created?.available || !created.agent || typeof created.agent.generate !== 'function') {
          fail('AGENT_GENERATION_FAILED', 'The CRM assistant is unavailable. No local or source data was changed.', 502);
        }
        let result;
        try {
          result = await created.agent.generate({ prompt, abortSignal, timeout: AGENT_CHAT_TIMEOUT_MS });
        } catch {
          fail('AGENT_GENERATION_FAILED', 'The CRM assistant could not complete this request. No local or source data was changed.', 502);
        }
        const draft_preview = draftFromResult(result);
        const answer = safeText(result?.text) || (draft_preview
          ? 'A record-creation preview is ready. Review it in the existing create form and explicitly approve it before submission.'
          : 'The CRM assistant returned no answer. No local or source data was changed.');
        return {
          available: true,
          status: 'Complete',
          reason_code: null,
          model: currentAvailability.model,
          source_mode: AGENT_SOURCE_MODE,
          answer,
          draft_preview,
          bounded: true,
        };
      } finally {
        activeChats -= 1;
      }
    },
  });
}

function mountCrmAgentRoutes(app, service) {
  if (!app || typeof app.get !== 'function' || typeof app.post !== 'function') throw new TypeError('Express app is required.');
  if (!service || typeof service.status !== 'function' || typeof service.chat !== 'function') throw new TypeError('CRM agent route service is required.');
  app.get('/api/agent/status', async (_req, res) => {
    try {
      res.json(await service.status());
    } catch (error) {
      const response = routeErrorBody(error);
      res.status(response.status).json(response.body);
    }
  });
  app.post('/api/agent/chat', async (req, res) => {
    const controller = new AbortController();
    req.once?.('aborted', () => controller.abort());
    try {
      res.json(await service.chat(req.body, { abortSignal: controller.signal }));
    } catch (error) {
      const response = routeErrorBody(error);
      res.status(response.status).json(response.body);
    }
  });
}

module.exports = {
  AGENT_AGGREGATE_CACHE_MS,
  AGENT_CHAT_TIMEOUT_MS,
  AGENT_MAX_CONCURRENT_CHATS,
  AGENT_METADATA_BATCH_SIZE,
  AGENT_METADATA_LOAD_BUDGET_MS,
  AGENT_METADATA_MAX_QUERY_ATTEMPTS,
  AGENT_METADATA_KEY_QUERY,
  AGENT_METADATA_MODULE_LIMIT,
  AGENT_METADATA_MODULE_QUERY,
  AGENT_METADATA_QUERY,
  AGENT_SCOPE_CACHE_MS,
  AGENT_PROMPT_MAX_BYTES,
  AGENT_PROMPT_MAX_CHARACTERS,
  AGENT_SCOPE_BASIS,
  AGENT_SOURCE_MODE,
  DETERMINISTIC_METADATA_QUERY,
  DETERMINISTIC_INTENT_REQUIREMENTS,
  DETERMINISTIC_SUPPORTED_QUESTIONS,
  CrmAgentRouteError,
  createCrmAgentRouteService,
  createLocalCrmAgentHandlers,
  deriveCrmAgentScope,
  deterministicIntentAvailability,
  draftFromResult,
  loadMirroredAgentMetadata,
  metadataRowsToSnapshot,
  mountCrmAgentRoutes,
  parseDeterministicPrompt,
  routeErrorBody,
  runDeterministicPrompt,
  safeText,
  validateAgentChatInput,
};
