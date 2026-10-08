'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { CRM_AGENT_TOOL_NAMES, CrmAgentPolicyError } = require('../lib/crm-agent-policy');
const { createCrmAgentTools, assertLocalHandlers, executeCrmAgentTool } = require('../lib/crm-agent-tools');
const { createCrmAgent, toolApprovalPolicy } = require('../lib/crm-agent');

function permissions() {
  return {
    modules: {
      Leads: {
        aggregate: true,
        search: true,
        detail: true,
        metadata: true,
        create_draft: true,
        readable_fields: ['id', 'Full_Name', 'Last_Name', 'Email', 'Lead_Status', 'Notes'],
        aggregate_fields: ['Lead_Status'],
        writable_fields: ['Last_Name', 'Email', 'Lead_Status', 'Notes'],
      },
      Deals: {
        aggregate: true,
        search: false,
        detail: false,
        metadata: true,
        create_draft: false,
        readable_fields: ['id', 'Deal_Name', 'Stage'],
        aggregate_fields: ['Stage'],
        writable_fields: [],
      },
      Tasks: {
        aggregate: true,
        search: true,
        detail: true,
        metadata: true,
        create_draft: false,
        readable_fields: ['id', 'Subject', 'Due_Date', 'Status'],
        aggregate_fields: ['Due_Date', 'Status'],
        writable_fields: [],
      },
    },
  };
}

function mockAiRuntime() {
  const runtime = {
    gatewayCalls: [],
    stepCounts: [],
    tool: definition => definition,
    jsonSchema: (jsonSchema, options) => ({ jsonSchema, validate: options.validate }),
    gateway(model) {
      runtime.gatewayCalls.push(model);
      return { provider: 'mock-gateway', model };
    },
    isStepCount(count) {
      runtime.stepCounts.push(count);
      return { type: 'step-count', count };
    },
    ToolLoopAgent: class MockToolLoopAgent {
      constructor(settings) {
        this.settings = settings;
        this.tools = settings.tools;
        this.id = settings.id;
      }
    },
  };
  return runtime;
}

function mockHandlers() {
  const calls = [];
  const handlers = {
    source_mode: 'local-replica-read-only',
    async aggregateRecords(query) {
      calls.push(['aggregateRecords', query]);
      return { total: 8, groups: [{ value: 'New', count: 5 }, { value: 'Qualified', count: 3 }] };
    },
    async searchRecords(query) {
      calls.push(['searchRecords', query]);
      if (query.overdue_only) return { records: [{ id: 'task-1', Subject: 'Call customer', Due_Date: '2026-08-29', Status: 'In Progress', Hidden: 'omit' }] };
      return { records: [{ id: '1', Full_Name: 'A Lead', Lead_Status: 'New', Hidden: 'omit', Notes: 'password=handler-secret' }] };
    },
    async getRecord(query) {
      calls.push(['getRecord', query]);
      return { record: { id: query.record_id, Full_Name: 'A Lead', Email: 'lead@example.com', Hidden: 'omit' } };
    },
    async getModuleMetadata(query) {
      calls.push(['getModuleMetadata', query]);
      return { definition_complete: true, layout_resolved: true, fields: [
        { api_name: 'Last_Name', field_label: 'Last Name', data_type: 'text', system_mandatory: true },
        { api_name: 'Email', field_label: 'Email', data_type: 'email' },
        { api_name: 'Lead_Status', field_label: 'Lead Status', data_type: 'picklist', required: true, pick_list_values: [{ actual_value: 'New' }] },
        { api_name: 'Notes', field_label: 'Notes', data_type: 'textarea' },
        { api_name: 'Hidden', field_label: 'Hidden', data_type: 'text' },
        { api_name: 'Password', field_label: 'Password', data_type: 'text' },
      ] };
    },
  };
  Object.defineProperty(handlers, 'calls', { value: calls, enumerable: false });
  return handlers;
}

test('no-key creation returns deterministic fallback without loading an AI runtime or handlers', async () => {
  const runtime = new Proxy({}, { get() { throw new Error('AI runtime must not be touched'); } });
  const first = await createCrmAgent({ env: {}, aiRuntime: runtime });
  const second = await createCrmAgent({ env: { AI_GATEWAY_API_KEY: '' }, aiRuntime: runtime });
  assert.deepEqual(first, second);
  assert.equal(first.available, false);
  assert.equal(first.agent, null);
  assert.equal(first.tools, null);
  assert.equal(first.fallback.network_attempted, false);
  assert.equal(first.fallback.reason_code, 'AI_GATEWAY_CREDENTIAL_MISSING');
});

test('ToolLoopAgent uses Gateway, bounded settings, disabled telemetry, and the exact allowlist', async () => {
  const runtime = mockAiRuntime();
  const result = await createCrmAgent({
    env: { VERCEL_OIDC_TOKEN: 'test-only-placeholder', CRM_AGENT_MODEL: 'openai/gpt-5.6-sol' },
    aiRuntime: runtime,
    handlers: mockHandlers(),
    permissions: permissions(),
  });
  assert.equal(result.available, true);
  assert.deepEqual(runtime.gatewayCalls, ['openai/gpt-5.6-sol']);
  assert.deepEqual(runtime.stepCounts, [6]);
  assert.deepEqual(Object.keys(result.tools), CRM_AGENT_TOOL_NAMES);
  assert.deepEqual(result.agent.settings.activeTools, CRM_AGENT_TOOL_NAMES);
  assert.deepEqual(result.agent.settings.toolOrder, CRM_AGENT_TOOL_NAMES);
  assert.equal(result.agent.settings.maxOutputTokens, 1200);
  assert.equal(result.agent.settings.temperature, 0);
  assert.equal(result.agent.settings.allowSystemInMessages, false);
  assert.deepEqual(result.agent.settings.telemetry, { isEnabled: false, recordInputs: false, recordOutputs: false });
  assert.equal(Object.prototype.hasOwnProperty.call(result.tools, 'create_record'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.tools, 'run_sql'), false);
  assert.equal(toolApprovalPolicy({ toolCall: { toolName: 'search_records', dynamic: false } }), 'not-applicable');
  assert.deepEqual(toolApprovalPolicy({ toolCall: { toolName: 'create_record', dynamic: true } }), {
    type: 'denied', reason: 'Tool is outside the reviewed local CRM read/preview allowlist.',
  });
});

test('the five tools call only structured local read handlers and return bounded outputs', async () => {
  const runtime = mockAiRuntime();
  const handlers = mockHandlers();
  const tools = createCrmAgentTools({ aiRuntime: runtime, handlers, permissions: permissions() });

  const aggregate = await tools.aggregate_records.execute({ module: 'Leads', group_by: 'Lead_Status', limit: 2 });
  assert.deepEqual(aggregate.groups, [{ value: 'New', count: 5 }, { value: 'Qualified', count: 3 }]);
  assert.equal(aggregate.bounded, true);

  const search = await tools.search_records.execute({ module: 'Leads', query: 'Lead', limit: 5 });
  assert.equal(search.returned, 1);
  assert.deepEqual(Object.keys(search.records[0]).sort(), ['Full_Name', 'Lead_Status', 'Notes', 'id'].sort());
  assert.doesNotMatch(search.records[0].Notes, /handler-secret/);

  const detail = await tools.get_record.execute({ module: 'Leads', record_id: '1' });
  assert.deepEqual(detail.record, { id: '1', Full_Name: 'A Lead', Email: 'lead@example.com' });

  const metadata = await tools.inspect_module_metadata.execute({ module: 'Leads', required_only: true, limit: 20 });
  assert.deepEqual(metadata.fields.map(field => field.api_name).sort(), ['Last_Name', 'Lead_Status'].sort());
  assert.ok(metadata.fields.every(field => field.api_name !== 'Password' && field.api_name !== 'Hidden'));

  assert.deepEqual(handlers.calls.map(call => call[0]), [
    'aggregateRecords', 'searchRecords', 'getRecord', 'getModuleMetadata',
  ]);
  assert.ok(handlers.calls.every(([, query]) => query.source_mode === 'local-replica-read-only'));
  assert.equal(Object.values(handlers.calls).some(value => String(value).includes('select ')), false);
});

test('direct deterministic execution reuses the exact validators, handlers, and output sanitizers', async () => {
  const handlers = mockHandlers();
  const result = await executeCrmAgentTool({
    toolName: 'search_records',
    input: { module: 'Tasks', overdue_only: true, limit: 10 },
    handlers,
    permissions: permissions(),
  });
  assert.deepEqual(result.records, [{ id: 'task-1', Subject: 'Call customer', Due_Date: '2026-08-29', Status: 'In Progress' }]);
  assert.equal(result.bounded, true);
  assert.deepEqual(handlers.calls[0][1], {
    module: 'Tasks', query: '', overdue_only: true, limit: 10,
    field_scope: ['id', 'Subject', 'Due_Date', 'Status'], source_mode: 'local-replica-read-only',
  });
  await assert.rejects(
    executeCrmAgentTool({
      toolName: 'search_records',
      input: { module: 'Tasks', query: 'late', overdue_only: true },
      handlers,
      permissions: permissions(),
    }),
    error => error instanceof CrmAgentPolicyError && error.code === 'AGENT_INPUT_INVALID',
  );
});

test('record creation tool produces preview only and has no route or write handler', async () => {
  const runtime = mockAiRuntime();
  const handlers = mockHandlers();
  const tools = createCrmAgentTools({ aiRuntime: runtime, handlers, permissions: permissions() });
  const preview = await tools.prepare_record_creation_draft.execute({
    module: 'Leads',
    values: { Last_Name: 'Rao', Lead_Status: 'New', Email: 'rao@example.com' },
  });
  assert.equal(preview.status, 'PreviewOnly');
  assert.equal(preview.validation.valid, true);
  assert.equal(preview.approval.required, true);
  assert.equal(preview.approval.approved, false);
  assert.equal(preview.approval.execution_tool_available_to_agent, false);
  assert.equal(preview.execution.local_create_route_called, false);
  assert.equal(preview.execution.local_database_write, false);
  assert.equal(preview.execution.zoho_contacted, false);
  assert.equal(handlers.calls.at(-1)[0], 'getModuleMetadata');
  assert.equal(Object.keys(tools).some(name => /create_record|execute|write|send|webhook/i.test(name)), false);
});

test('permission denial and invalid arbitrary properties stop before any handler call', async () => {
  const runtime = mockAiRuntime();
  const handlers = mockHandlers();
  const tools = createCrmAgentTools({ aiRuntime: runtime, handlers, permissions: permissions() });
  await assert.rejects(
    tools.search_records.execute({ module: 'Deals', query: 'Anything' }),
    error => error instanceof CrmAgentPolicyError && error.code === 'AGENT_PERMISSION_DENIED',
  );
  await assert.rejects(
    tools.aggregate_records.execute({ module: 'Leads', sql: 'select * from crm_records' }),
    error => error instanceof CrmAgentPolicyError && error.code === 'AGENT_INPUT_INVALID',
  );
  await assert.rejects(
    tools.prepare_record_creation_draft.execute({ module: 'Leads', values: { Owner: { id: 'user-1' } } }),
    error => error instanceof CrmAgentPolicyError && error.code === 'AGENT_PERMISSION_DENIED',
  );
  assert.equal(handlers.calls.length, 0);
});

test('tool schemas use the same pure validators as direct execution', async () => {
  const tools = createCrmAgentTools({ aiRuntime: mockAiRuntime(), handlers: mockHandlers(), permissions: permissions() });
  const valid = await tools.search_records.inputSchema.validate({ module: 'Leads', query: 'Acme', limit: 5 });
  assert.deepEqual(valid, { success: true, value: { module: 'Leads', query: 'Acme', overdue_only: false, limit: 5 } });
  const invalid = await tools.search_records.inputSchema.validate({ module: 'Deals', query: 'Acme' });
  assert.equal(invalid.success, false);
  assert.equal(invalid.error.code, 'AGENT_PERMISSION_DENIED');
});

test('local handler configuration excludes write and outbound handlers', () => {
  assert.doesNotThrow(() => assertLocalHandlers(mockHandlers()));
  assert.throws(() => assertLocalHandlers({ ...mockHandlers(), createRecord: async () => ({}) }), /read-only local CRM handler allowlist/);
  assert.throws(() => assertLocalHandlers({ ...mockHandlers(), source_mode: 'zoho-live' }), /local-replica-read-only/);
});

test('handler failures do not expose credentials or connection details', async () => {
  const handlers = mockHandlers();
  handlers.getRecord = async () => { throw new Error('postgres://user:password@host token=top-secret'); };
  const tools = createCrmAgentTools({ aiRuntime: mockAiRuntime(), handlers, permissions: permissions() });
  await assert.rejects(tools.get_record.execute({ module: 'Leads', record_id: '1' }), error => {
    assert.equal(error.code, 'AGENT_LOCAL_HANDLER_FAILED');
    assert.doesNotMatch(error.message, /postgres|password|top-secret|host/);
    return true;
  });
});

test('agent foundation contains no network, SQL, Zoho, outbound, or create-route implementation', () => {
  const root = path.resolve(__dirname, '..');
  const source = ['lib/crm-agent.js', 'lib/crm-agent-tools.js', 'lib/crm-agent-policy.js']
    .map(file => fs.readFileSync(path.join(root, file), 'utf8'))
    .join('\n');
  assert.doesNotMatch(source, /\bfetch\s*\(|require\(['"]node:https?['"]\)|\bcrm_(?:insert|patch)\b|\bzoho\s*\(/i);
  assert.doesNotMatch(source, /\b(?:select|insert|update|delete)\s+(?:\*|from|into|crm_records)\b/i);
});
