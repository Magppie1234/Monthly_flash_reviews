'use strict';

const crypto = require('node:crypto');

const CRM_AGENT_TOOL_NAMES = Object.freeze([
  'aggregate_records',
  'search_records',
  'get_record',
  'inspect_module_metadata',
  'prepare_record_creation_draft',
]);

const LIMITS = Object.freeze({
  aggregate_groups: 50,
  aggregate_filters: 6,
  search_records: 20,
  metadata_fields: 200,
  permission_fields: 500,
  record_fields: 80,
  draft_fields: 80,
  string_input: 1000,
  string_output: 500,
  nested_array: 20,
  nested_object_keys: 40,
  nested_depth: 4,
  sanitizer_nodes: 500,
  output_bytes: 65_536,
  record_bytes: 12_000,
  draft_input_bytes: 32_000,
});

const MODULE_PATTERN = /^[A-Za-z][A-Za-z0-9_$]{0,79}$/;
const FIELD_PATTERN = /^[A-Za-z][A-Za-z0-9_$]{0,119}$/;
const RECORD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const MODEL_PATTERN = /^[a-z0-9][a-z0-9.-]{0,39}\/[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const SENSITIVE_KEY_PATTERN = /(?:^|_)(?:api_?key|authorization|bearer|cookie|credential|password|refresh_?token|secret|session_?token|token)(?:$|_)/i;
const BEARER_VALUE_PATTERN = /\bbearer\s+[A-Za-z0-9._~+/=-]{6,}/gi;
const SENSITIVE_ASSIGNMENT_PATTERN = /\b(api[_ -]?key|authorization|password|secret|token|credential)\b\s*(?:[:=]|is)\s*["']?[^\s,;"']{4,}["']?/gi;
const AGGREGATE_OPERATORS = new Set([
  'equal', 'not_equal', 'in', 'not_in', 'greater_than', 'greater_equal',
  'less_than', 'less_equal', 'between', 'is_empty', 'is_not_empty',
]);
const MODULE_POLICY_KEYS = new Set([
  'aggregate', 'search', 'detail', 'metadata', 'create_draft',
  'readable_fields', 'aggregate_fields', 'writable_fields',
]);

class CrmAgentPolicyError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CrmAgentPolicyError';
    this.code = code;
    this.status = code === 'AGENT_PERMISSION_DENIED' ? 403 : 422;
    this.details = details;
  }
}

const isPlainObject = value => value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

function fail(code, message, details) {
  throw new CrmAgentPolicyError(code, message, details);
}

function assertExactKeys(value, allowed, label) {
  if (!isPlainObject(value)) fail('AGENT_INPUT_INVALID', `${label} must be an object.`);
  const extra = Object.keys(value).find(key => !allowed.has(key));
  if (extra) fail('AGENT_INPUT_INVALID', `${label} contains an unsupported property.`, { property: extra });
}

function assertIdentifier(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value)) fail('AGENT_INPUT_INVALID', `${label} is missing or invalid.`);
  if (SENSITIVE_KEY_PATTERN.test(value)) fail('AGENT_SENSITIVE_FIELD_BLOCKED', `${label} is credential-sensitive and cannot be exposed to the CRM agent.`);
  return value;
}

function canonicalFieldList(values, label) {
  if (!Array.isArray(values) || values.length > LIMITS.permission_fields) {
    fail('AGENT_PERMISSION_CONTEXT_INVALID', `${label} must be a bounded field array.`);
  }
  const unique = [];
  const seen = new Set();
  for (const value of values) {
    const field = assertIdentifier(value, FIELD_PATTERN, label);
    if (!seen.has(field)) {
      unique.push(field);
      seen.add(field);
    }
  }
  return Object.freeze(unique);
}

function normalizePermissionContext(input) {
  assertExactKeys(input, new Set(['modules']), 'Permission context');
  if (!isPlainObject(input.modules)) fail('AGENT_PERMISSION_CONTEXT_INVALID', 'Permission context modules are required.');
  const moduleNames = Object.keys(input.modules);
  if (!moduleNames.length || moduleNames.length > 150) fail('AGENT_PERMISSION_CONTEXT_INVALID', 'Permission context module scope is empty or too large.');
  const modules = {};
  for (const name of moduleNames) {
    const module = assertIdentifier(name, MODULE_PATTERN, 'Module');
    const source = input.modules[name];
    assertExactKeys(source, MODULE_POLICY_KEYS, `Permission policy for ${module}`);
    const readable = canonicalFieldList(source.readable_fields, `${module} readable_fields`);
    const aggregate = canonicalFieldList(source.aggregate_fields, `${module} aggregate_fields`);
    const writable = canonicalFieldList(source.writable_fields, `${module} writable_fields`);
    if (aggregate.some(field => !readable.includes(field))) {
      fail('AGENT_PERMISSION_CONTEXT_INVALID', `${module} aggregate fields must also be readable.`);
    }
    modules[module] = Object.freeze({
      aggregate: source.aggregate === true,
      search: source.search === true,
      detail: source.detail === true,
      metadata: source.metadata === true,
      create_draft: source.create_draft === true,
      readable_fields: readable,
      aggregate_fields: aggregate,
      writable_fields: writable,
    });
  }
  return Object.freeze({ modules: Object.freeze(modules) });
}

function modulePolicy(permissions, module, capability) {
  const name = assertIdentifier(module, MODULE_PATTERN, 'Module');
  const policy = permissions?.modules?.[name];
  if (!policy || policy[capability] !== true) {
    fail('AGENT_PERMISSION_DENIED', 'The CRM agent is not permitted to perform this operation for the requested module.', { module: name, capability });
  }
  return { module: name, policy };
}

function authorizeFields(policy, fields, listName) {
  const allowed = new Set(policy[listName]);
  const denied = fields.find(field => !allowed.has(field));
  if (denied) fail('AGENT_PERMISSION_DENIED', 'The CRM agent is not permitted to use one of the requested fields.', { field: denied });
}

function boundedInteger(value, { defaultValue, min, max, label }) {
  if (value === undefined) return defaultValue;
  if (!Number.isInteger(value) || value < min || value > max) fail('AGENT_INPUT_INVALID', `${label} must be between ${min} and ${max}.`);
  return value;
}

function validateFilterValue(value, operator) {
  if (['is_empty', 'is_not_empty'].includes(operator)) {
    if (value !== undefined && value !== null) fail('AGENT_INPUT_INVALID', `${operator} does not accept a value.`);
    return null;
  }
  const scalar = item => item === null || ['string', 'number', 'boolean'].includes(typeof item);
  if (['in', 'not_in'].includes(operator)) {
    if (!Array.isArray(value) || !value.length || value.length > LIMITS.nested_array || value.some(item => !scalar(item))) {
      fail('AGENT_INPUT_INVALID', `${operator} requires a bounded scalar array.`);
    }
    return value.map(item => typeof item === 'string' ? item.slice(0, 200) : item);
  }
  if (operator === 'between') {
    if (!Array.isArray(value) || value.length !== 2 || value.some(item => !scalar(item))) fail('AGENT_INPUT_INVALID', 'between requires exactly two scalar values.');
    return value.map(item => typeof item === 'string' ? item.slice(0, 200) : item);
  }
  if (!scalar(value) || value === undefined || (typeof value === 'string' && value.length > 200)) fail('AGENT_INPUT_INVALID', 'Filter value is missing or too large.');
  return value;
}

function validateAggregateInput(input, permissions) {
  assertExactKeys(input, new Set(['module', 'group_by', 'filters', 'limit']), 'Aggregate input');
  const { module, policy } = modulePolicy(permissions, input.module, 'aggregate');
  const groupBy = input.group_by === undefined || input.group_by === null
    ? null
    : assertIdentifier(input.group_by, FIELD_PATTERN, 'group_by');
  if (groupBy) authorizeFields(policy, [groupBy], 'aggregate_fields');
  const filters = input.filters === undefined ? [] : input.filters;
  if (!Array.isArray(filters) || filters.length > LIMITS.aggregate_filters) fail('AGENT_INPUT_INVALID', 'Aggregate filters exceed the allowed bound.');
  const normalizedFilters = filters.map((filter, index) => {
    assertExactKeys(filter, new Set(['field', 'operator', 'value']), `Filter ${index + 1}`);
    const field = assertIdentifier(filter.field, FIELD_PATTERN, 'Filter field');
    authorizeFields(policy, [field], 'aggregate_fields');
    if (!AGGREGATE_OPERATORS.has(filter.operator)) fail('AGENT_INPUT_INVALID', 'Filter operator is unsupported.');
    return { field, operator: filter.operator, value: validateFilterValue(filter.value, filter.operator) };
  });
  return {
    module,
    group_by: groupBy,
    filters: normalizedFilters,
    limit: boundedInteger(input.limit, { defaultValue: 20, min: 1, max: LIMITS.aggregate_groups, label: 'Aggregate limit' }),
  };
}

function validateSearchInput(input, permissions) {
  assertExactKeys(input, new Set(['module', 'query', 'limit', 'overdue_only']), 'Search input');
  const { module, policy } = modulePolicy(permissions, input.module, 'search');
  if (input.overdue_only !== undefined && typeof input.overdue_only !== 'boolean') {
    fail('AGENT_INPUT_INVALID', 'overdue_only must be a boolean.');
  }
  const overdueOnly = input.overdue_only === true;
  const query = typeof input.query === 'string' ? input.query.trim() : '';
  if (overdueOnly) {
    if (module !== 'Tasks') fail('AGENT_INPUT_INVALID', 'overdue_only is supported only for Tasks.');
    authorizeFields(policy, ['Due_Date', 'Status'], 'readable_fields');
    if (query) fail('AGENT_INPUT_INVALID', 'overdue_only cannot be combined with a free-text query.');
  } else if (!query || query.length > 120) {
    fail('AGENT_INPUT_INVALID', 'Search query must contain 1 to 120 characters.');
  }
  return {
    module,
    query,
    overdue_only: overdueOnly,
    limit: boundedInteger(input.limit, { defaultValue: 10, min: 1, max: LIMITS.search_records, label: 'Search limit' }),
  };
}

function validateDetailInput(input, permissions) {
  assertExactKeys(input, new Set(['module', 'record_id']), 'Record-detail input');
  const { module } = modulePolicy(permissions, input.module, 'detail');
  if (typeof input.record_id !== 'string' || !RECORD_ID_PATTERN.test(input.record_id)) fail('AGENT_INPUT_INVALID', 'record_id is missing or invalid.');
  return { module, record_id: input.record_id };
}

function validateMetadataInput(input, permissions) {
  assertExactKeys(input, new Set(['module', 'required_only', 'limit']), 'Metadata input');
  const { module } = modulePolicy(permissions, input.module, 'metadata');
  if (input.required_only !== undefined && typeof input.required_only !== 'boolean') fail('AGENT_INPUT_INVALID', 'required_only must be a boolean.');
  return {
    module,
    required_only: input.required_only === true,
    limit: boundedInteger(input.limit, { defaultValue: 100, min: 1, max: LIMITS.metadata_fields, label: 'Metadata limit' }),
  };
}

function byteLength(value) {
  return Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
}

function sanitizeNested(value, { depth = 0, output = false, budget = null } = {}) {
  const state = budget || { remaining: LIMITS.sanitizer_nodes };
  if (state.remaining <= 0) return '[value omitted: bound reached]';
  state.remaining -= 1;
  if (value === undefined) {
    if (output) return null;
    fail('AGENT_INPUT_INVALID', 'Draft values must contain JSON-compatible data only.');
  }
  if (value === null || ['number', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'string') return value
    .slice(0, output ? LIMITS.string_output : LIMITS.string_input)
    .replace(BEARER_VALUE_PATTERN, 'Bearer [credential omitted]')
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, '$1: [credential omitted]')
    .slice(0, output ? LIMITS.string_output : LIMITS.string_input);
  if (depth >= LIMITS.nested_depth) return '[nested value omitted]';
  if (Array.isArray(value)) return value.slice(0, LIMITS.nested_array).map(item => sanitizeNested(item, { depth: depth + 1, output, budget: state }));
  if (!isPlainObject(value)) fail('AGENT_INPUT_INVALID', 'Draft values must contain JSON-compatible data only.');
  const out = {};
  for (const key of Object.keys(value).sort().slice(0, LIMITS.nested_object_keys)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) continue;
    out[key] = sanitizeNested(value[key], { depth: depth + 1, output, budget: state });
  }
  return out;
}

function validateDraftInput(input, permissions) {
  assertExactKeys(input, new Set(['module', 'values']), 'Record-creation draft input');
  const { module, policy } = modulePolicy(permissions, input.module, 'create_draft');
  if (!isPlainObject(input.values)) fail('AGENT_INPUT_INVALID', 'Draft values must be an object.');
  const fields = Object.keys(input.values);
  if (!fields.length || fields.length > LIMITS.draft_fields) fail('AGENT_INPUT_INVALID', 'Draft field count is empty or exceeds the allowed bound.');
  fields.forEach(field => assertIdentifier(field, FIELD_PATTERN, 'Draft field'));
  authorizeFields(policy, fields, 'writable_fields');
  const values = {};
  fields.sort().forEach(field => { values[field] = sanitizeNested(input.values[field]); });
  if (byteLength(values) > LIMITS.draft_input_bytes) fail('AGENT_INPUT_INVALID', 'Draft values exceed the total size bound.');
  return { module, values };
}

function validateToolInput(toolName, input, permissions) {
  if (!CRM_AGENT_TOOL_NAMES.includes(toolName)) fail('AGENT_TOOL_NOT_ALLOWED', 'The requested tool is not in the CRM agent allowlist.');
  if (toolName === 'aggregate_records') return validateAggregateInput(input, permissions);
  if (toolName === 'search_records') return validateSearchInput(input, permissions);
  if (toolName === 'get_record') return validateDetailInput(input, permissions);
  if (toolName === 'inspect_module_metadata') return validateMetadataInput(input, permissions);
  return validateDraftInput(input, permissions);
}

function asSchemaValidation(toolName, permissions) {
  return value => {
    try {
      return { success: true, value: validateToolInput(toolName, value, permissions) };
    } catch (error) {
      return { success: false, error };
    }
  };
}

function safeCount(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function sanitizeAggregateResult(result, input) {
  const source = isPlainObject(result) ? result : {};
  const groups = Array.isArray(source.groups) ? source.groups : [];
  const selected = [];
  let used = 1024;
  for (const item of groups.slice(0, input.limit)) {
    const normalized = {
      value: sanitizeNested(isPlainObject(item) ? item.value : null, { output: true }),
      count: safeCount(isPlainObject(item) ? item.count : 0),
    };
    const size = byteLength(normalized);
    if (used + size > LIMITS.output_bytes) break;
    used += size;
    selected.push(normalized);
  }
  return {
    module: input.module,
    group_by: input.group_by,
    total: safeCount(source.total),
    groups: selected,
    bounded: true,
  };
}

function sanitizeRecord(record, policy) {
  if (!isPlainObject(record)) return null;
  const allowed = policy.readable_fields.slice(0, LIMITS.record_fields);
  const out = {};
  const budget = { remaining: LIMITS.sanitizer_nodes };
  for (const field of allowed) {
    if (!Object.prototype.hasOwnProperty.call(record, field)) continue;
    out[field] = sanitizeNested(record[field], { output: true, budget });
    if (byteLength(out) > LIMITS.record_bytes) {
      delete out[field];
      break;
    }
  }
  return out;
}

function sanitizeSearchResult(result, input, permissions) {
  const policy = permissions.modules[input.module];
  const sourceRows = Array.isArray(result) ? result : (Array.isArray(result?.records) ? result.records : (Array.isArray(result?.data) ? result.data : []));
  const records = [];
  let used = 1024;
  for (const source of sourceRows.slice(0, input.limit)) {
    const record = sanitizeRecord(source, policy);
    if (!record) continue;
    const size = byteLength(record);
    if (used + size > LIMITS.output_bytes) break;
    used += size;
    records.push(record);
  }
  return { module: input.module, records, returned: records.length, limit: input.limit, bounded: true };
}

function sanitizeDetailResult(result, input, permissions) {
  const policy = permissions.modules[input.module];
  const source = isPlainObject(result?.record) ? result.record : (Array.isArray(result?.data) ? result.data[0] : result);
  return { module: input.module, record: sanitizeRecord(source, policy), bounded: true };
}

function metadataFields(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.fields)) return result.fields;
  return [];
}

function normalizedMetadataFields(result, module, permissions) {
  const policy = permissions.modules[module];
  const visible = new Set([...policy.readable_fields, ...policy.writable_fields]);
  return metadataFields(result).slice(0, LIMITS.permission_fields).flatMap(field => {
    const apiName = field?.api_name;
    if (typeof apiName !== 'string' || !FIELD_PATTERN.test(apiName) || !visible.has(apiName) || SENSITIVE_KEY_PATTERN.test(apiName)) return [];
    const readOnly = field.read_only === true || field.virtual_field === true;
    const required = field.required === true || field.system_mandatory === true;
    const pickList = Array.isArray(field.pick_list_values) ? field.pick_list_values.slice(0, 50).map(item => sanitizeNested(isPlainObject(item) ? (item.actual_value ?? item.display_value) : item, { output: true })) : [];
    return [{
      api_name: apiName,
      label: String(field.field_label || field.display_label || apiName).slice(0, 160),
      data_type: typeof field.data_type === 'string' ? field.data_type.slice(0, 80) : null,
      required,
      read_only: readOnly,
      create_allowed: policy.writable_fields.includes(apiName) && !readOnly,
      pick_list_values: pickList,
    }];
  });
}

function sanitizeMetadataResult(result, input, permissions) {
  let fields = normalizedMetadataFields(result, input.module, permissions);
  if (input.required_only) fields = fields.filter(field => field.required);
  const selected = [];
  let used = 2048;
  for (const field of fields.slice(0, input.limit)) {
    const size = byteLength(field);
    if (used + size > LIMITS.output_bytes) break;
    used += size;
    selected.push(field);
  }
  return {
    module: input.module,
    required_only: input.required_only,
    definition_complete: result?.definition_complete === true,
    layout_resolved: result?.layout_resolved === true,
    fields: selected,
    returned: selected.length,
    limit: input.limit,
    bounded: true,
  };
}

function blank(value) {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isPlainObject(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function prepareRecordCreationDraft(input, metadataResult, permissions) {
  const fields = normalizedMetadataFields(metadataResult, input.module, permissions);
  const rawFields = metadataFields(metadataResult).slice(0, LIMITS.permission_fields);
  const visible = new Set([...permissions.modules[input.module].readable_fields, ...permissions.modules[input.module].writable_fields]);
  const byName = new Map(fields.map(field => [field.api_name, field]));
  const provided = Object.keys(input.values);
  const invalidFields = provided.filter(field => !byName.has(field) || byName.get(field).create_allowed !== true);
  const requiredFields = fields.filter(field => field.required && field.create_allowed).map(field => field.api_name);
  const unavailableRequiredFields = fields.filter(field => field.required && !field.read_only && !field.create_allowed).map(field => field.api_name);
  const hiddenRequiredFieldCount = rawFields.filter(field => {
    const apiName = field?.api_name;
    const required = field?.required === true || field?.system_mandatory === true;
    const readOnly = field?.read_only === true || field?.virtual_field === true;
    return typeof apiName === 'string' && FIELD_PATTERN.test(apiName) && required && !readOnly && !visible.has(apiName);
  }).length;
  const metadataComplete = metadataResult?.definition_complete === true && metadataResult?.layout_resolved === true;
  const missingRequiredFields = requiredFields.filter(field => !Object.prototype.hasOwnProperty.call(input.values, field) || blank(input.values[field]));
  const valid = metadataComplete && invalidFields.length === 0 && missingRequiredFields.length === 0
    && unavailableRequiredFields.length === 0 && hiddenRequiredFieldCount === 0;
  const draftFingerprint = crypto.createHash('sha256').update(stableJson({ module: input.module, values: input.values })).digest('hex');
  return {
    status: 'PreviewOnly',
    module: input.module,
    values: sanitizeNested(input.values, { output: true }),
    draft_fingerprint: draftFingerprint,
    validation: {
      valid,
      metadata_complete: metadataComplete,
      missing_required_fields: missingRequiredFields,
      unavailable_required_fields: unavailableRequiredFields,
      hidden_required_field_count: hiddenRequiredFieldCount,
      invalid_or_read_only_fields: invalidFields,
    },
    approval: {
      required: true,
      approved: false,
      status: 'Awaiting explicit user approval in the app',
      execution_tool_available_to_agent: false,
      next_step: 'Render this preview in the app. Only after explicit user approval may the app submit these values to the existing validated local create route.',
    },
    execution: {
      local_create_route_called: false,
      local_database_write: false,
      zoho_contacted: false,
      zoho_write: false,
      outbound_action: false,
    },
    bounded: true,
  };
}

function resolveAgentModel(env = {}) {
  const requested = typeof env.CRM_AGENT_MODEL === 'string' && env.CRM_AGENT_MODEL.trim()
    ? env.CRM_AGENT_MODEL.trim()
    : 'openai/gpt-5.6-sol';
  if (!MODEL_PATTERN.test(requested)) return null;
  return requested;
}

function getCrmAgentAvailability(env = {}) {
  const model = resolveAgentModel(env);
  const hasCredential = Boolean(
    (typeof env.AI_GATEWAY_API_KEY === 'string' && env.AI_GATEWAY_API_KEY.trim())
    || (typeof env.VERCEL_OIDC_TOKEN === 'string' && env.VERCEL_OIDC_TOKEN.trim()),
  );
  if (!model) {
    return {
      available: false,
      status: 'Unavailable',
      reason_code: 'CRM_AGENT_MODEL_INVALID',
      model: null,
      fallback: { mode: 'DeterministicLocalOnly', message: 'AI model unavailable. Keyless local mode can answer up to seven reviewed CRM questions after permission and schema preflight, with no model or network call.' },
    };
  }
  if (!hasCredential) {
    return {
      available: false,
      status: 'Unavailable',
      reason_code: 'AI_GATEWAY_CREDENTIAL_MISSING',
      model,
      fallback: { mode: 'DeterministicLocalOnly', message: 'AI model unavailable. Keyless local mode can answer up to seven reviewed CRM questions after permission and schema preflight, with no model or network call.' },
    };
  }
  return {
    available: true,
    status: 'Available',
    reason_code: null,
    model,
    provider: 'Vercel AI Gateway',
    telemetry_enabled: false,
  };
}

module.exports = {
  CRM_AGENT_TOOL_NAMES,
  CrmAgentPolicyError,
  LIMITS,
  asSchemaValidation,
  getCrmAgentAvailability,
  normalizePermissionContext,
  prepareRecordCreationDraft,
  resolveAgentModel,
  sanitizeAggregateResult,
  sanitizeDetailResult,
  sanitizeMetadataResult,
  sanitizeSearchResult,
  validateAggregateInput,
  validateDetailInput,
  validateDraftInput,
  validateMetadataInput,
  validateSearchInput,
  validateToolInput,
};
