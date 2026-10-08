'use strict';

const {
  CRM_AGENT_TOOL_NAMES,
  CrmAgentPolicyError,
  LIMITS,
  asSchemaValidation,
  normalizePermissionContext,
  prepareRecordCreationDraft,
  sanitizeAggregateResult,
  sanitizeDetailResult,
  sanitizeMetadataResult,
  sanitizeSearchResult,
  validateToolInput,
} = require('./crm-agent-policy');

const HANDLER_KEYS = new Set([
  'source_mode',
  'aggregateRecords',
  'searchRecords',
  'getRecord',
  'getModuleMetadata',
]);

const FILTER_VALUE_SCHEMA = {
  anyOf: [
    { type: 'string', maxLength: 200 },
    { type: 'number' },
    { type: 'boolean' },
    { type: 'null' },
    { type: 'array', minItems: 1, maxItems: LIMITS.nested_array, items: { type: ['string', 'number', 'boolean', 'null'] } },
  ],
};

const TOOL_SCHEMAS = Object.freeze({
  aggregate_records: {
    type: 'object',
    additionalProperties: false,
    required: ['module'],
    properties: {
      module: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_$]{0,79}$' },
      group_by: { anyOf: [{ type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_$]{0,119}$' }, { type: 'null' }] },
      filters: {
        type: 'array',
        maxItems: LIMITS.aggregate_filters,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['field', 'operator'],
          properties: {
            field: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_$]{0,119}$' },
            operator: { enum: ['equal', 'not_equal', 'in', 'not_in', 'greater_than', 'greater_equal', 'less_than', 'less_equal', 'between', 'is_empty', 'is_not_empty'] },
            value: FILTER_VALUE_SCHEMA,
          },
        },
      },
      limit: { type: 'integer', minimum: 1, maximum: LIMITS.aggregate_groups },
    },
  },
  search_records: {
    type: 'object',
    additionalProperties: false,
    required: ['module'],
    properties: {
      module: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_$]{0,79}$' },
      query: { type: 'string', minLength: 1, maxLength: 120 },
      overdue_only: { type: 'boolean' },
      limit: { type: 'integer', minimum: 1, maximum: LIMITS.search_records },
    },
  },
  get_record: {
    type: 'object',
    additionalProperties: false,
    required: ['module', 'record_id'],
    properties: {
      module: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_$]{0,79}$' },
      record_id: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$' },
    },
  },
  inspect_module_metadata: {
    type: 'object',
    additionalProperties: false,
    required: ['module'],
    properties: {
      module: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_$]{0,79}$' },
      required_only: { type: 'boolean' },
      limit: { type: 'integer', minimum: 1, maximum: LIMITS.metadata_fields },
    },
  },
  prepare_record_creation_draft: {
    type: 'object',
    additionalProperties: false,
    required: ['module', 'values'],
    properties: {
      module: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_$]{0,79}$' },
      values: {
        type: 'object',
        minProperties: 1,
        maxProperties: LIMITS.draft_fields,
        propertyNames: { pattern: '^[A-Za-z][A-Za-z0-9_$]{0,119}$' },
        additionalProperties: true,
      },
    },
  },
});

function assertLocalHandlers(handlers) {
  if (!handlers || typeof handlers !== 'object' || Array.isArray(handlers)) {
    throw new CrmAgentPolicyError('AGENT_HANDLER_CONFIGURATION_INVALID', 'Local CRM agent handlers are required.');
  }
  const extra = Object.keys(handlers).find(key => !HANDLER_KEYS.has(key));
  if (extra) throw new CrmAgentPolicyError('AGENT_HANDLER_CONFIGURATION_INVALID', 'Only the read-only local CRM handler allowlist may be configured.');
  if (handlers.source_mode !== 'local-replica-read-only') {
    throw new CrmAgentPolicyError('AGENT_HANDLER_CONFIGURATION_INVALID', 'CRM agent handlers must declare local-replica-read-only source mode.');
  }
  for (const name of ['aggregateRecords', 'searchRecords', 'getRecord', 'getModuleMetadata']) {
    if (typeof handlers[name] !== 'function') throw new CrmAgentPolicyError('AGENT_HANDLER_CONFIGURATION_INVALID', `Missing local CRM handler: ${name}.`);
  }
  return handlers;
}

async function callHandler(handler, input, execution) {
  try {
    return await handler(input, { abortSignal: execution?.abortSignal });
  } catch (error) {
    if (error instanceof CrmAgentPolicyError) throw error;
    throw new CrmAgentPolicyError('AGENT_LOCAL_HANDLER_FAILED', 'The local CRM read operation failed without exposing private connection details.');
  }
}

async function executeCrmAgentTool({ toolName, input, handlers, permissions, execution }) {
  const local = assertLocalHandlers(handlers);
  const scope = normalizePermissionContext(permissions);
  const query = validateToolInput(toolName, input, scope);
  if (toolName === 'aggregate_records') {
    const policy = scope.modules[query.module];
    const result = await callHandler(local.aggregateRecords, {
      ...query,
      field_scope: policy.aggregate_fields,
      source_mode: 'local-replica-read-only',
    }, execution);
    return sanitizeAggregateResult(result, query);
  }
  if (toolName === 'search_records') {
    const result = await callHandler(local.searchRecords, {
      ...query,
      field_scope: scope.modules[query.module].readable_fields,
      source_mode: 'local-replica-read-only',
    }, execution);
    return sanitizeSearchResult(result, query, scope);
  }
  if (toolName === 'get_record') {
    const result = await callHandler(local.getRecord, {
      ...query,
      field_scope: scope.modules[query.module].readable_fields,
      source_mode: 'local-replica-read-only',
    }, execution);
    return sanitizeDetailResult(result, query, scope);
  }
  if (toolName === 'inspect_module_metadata') {
    const result = await callHandler(local.getModuleMetadata, {
      module: query.module,
      purpose: 'inspect',
      source_mode: 'local-replica-read-only',
    }, execution);
    return sanitizeMetadataResult(result, query, scope);
  }
  const metadata = await callHandler(local.getModuleMetadata, {
    module: query.module,
    purpose: 'create-draft-validation',
    source_mode: 'local-replica-read-only',
  }, execution);
  return prepareRecordCreationDraft(query, metadata, scope);
}

function schema(aiRuntime, toolName, permissions) {
  return aiRuntime.jsonSchema(TOOL_SCHEMAS[toolName], { validate: asSchemaValidation(toolName, permissions) });
}

function createCrmAgentTools({ aiRuntime, handlers, permissions }) {
  if (!aiRuntime || typeof aiRuntime.tool !== 'function' || typeof aiRuntime.jsonSchema !== 'function') {
    throw new CrmAgentPolicyError('AGENT_RUNTIME_INVALID', 'AI SDK tool and jsonSchema helpers are required.');
  }
  const local = assertLocalHandlers(handlers);
  const scope = normalizePermissionContext(permissions);

  const tools = {
    aggregate_records: aiRuntime.tool({
      description: 'Count records or group counts in one permitted module of the local CRM replica. Inputs are structured and bounded; arbitrary SQL is unavailable.',
      inputSchema: schema(aiRuntime, 'aggregate_records', scope),
      execute: (input, execution) => executeCrmAgentTool({ toolName: 'aggregate_records', input, handlers: local, permissions: scope, execution }),
    }),
    search_records: aiRuntime.tool({
      description: 'Search a permitted module in the local CRM replica, or list overdue Tasks through the reviewed structured overdue_only filter. Returns at most 20 records and only explicitly readable fields.',
      inputSchema: schema(aiRuntime, 'search_records', scope),
      execute: (input, execution) => executeCrmAgentTool({ toolName: 'search_records', input, handlers: local, permissions: scope, execution }),
    }),
    get_record: aiRuntime.tool({
      description: 'Read one permitted record from the local CRM replica by exact record ID. Returns only explicitly readable fields.',
      inputSchema: schema(aiRuntime, 'get_record', scope),
      execute: (input, execution) => executeCrmAgentTool({ toolName: 'get_record', input, handlers: local, permissions: scope, execution }),
    }),
    inspect_module_metadata: aiRuntime.tool({
      description: 'Inspect permitted local module fields and required-field metadata. Results are bounded and exclude credential-sensitive fields.',
      inputSchema: schema(aiRuntime, 'inspect_module_metadata', scope),
      execute: (input, execution) => executeCrmAgentTool({ toolName: 'inspect_module_metadata', input, handlers: local, permissions: scope, execution }),
    }),
    prepare_record_creation_draft: aiRuntime.tool({
      description: 'Prepare a validated record-creation preview only. This tool cannot create a record; the app must obtain explicit user approval before calling its existing validated local create route.',
      inputSchema: schema(aiRuntime, 'prepare_record_creation_draft', scope),
      execute: (input, execution) => executeCrmAgentTool({ toolName: 'prepare_record_creation_draft', input, handlers: local, permissions: scope, execution }),
    }),
  };

  if (Object.keys(tools).join('|') !== CRM_AGENT_TOOL_NAMES.join('|')) {
    throw new CrmAgentPolicyError('AGENT_TOOL_SURFACE_INVALID', 'CRM agent tool surface differs from the reviewed allowlist.');
  }
  return Object.freeze(tools);
}

module.exports = {
  TOOL_SCHEMAS,
  assertLocalHandlers,
  createCrmAgentTools,
  executeCrmAgentTool,
};
