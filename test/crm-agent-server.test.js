'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCrmAgent } = require('../lib/crm-agent');
const { CrmAgentPolicyError } = require('../lib/crm-agent-policy');

const {
  AGENT_MAX_CONCURRENT_CHATS,
  AGENT_METADATA_BATCH_SIZE,
  AGENT_METADATA_MAX_QUERY_ATTEMPTS,
  AGENT_METADATA_KEY_QUERY,
  AGENT_METADATA_MODULE_QUERY,
  AGENT_METADATA_QUERY,
  AGENT_PROMPT_MAX_BYTES,
  AGENT_PROMPT_MAX_CHARACTERS,
  AGENT_SCOPE_BASIS,
  AGENT_SOURCE_MODE,
  DETERMINISTIC_METADATA_QUERY,
  DETERMINISTIC_SUPPORTED_QUESTIONS,
  createCrmAgentRouteService,
  createLocalCrmAgentHandlers,
  deterministicIntentAvailability,
  deriveCrmAgentScope,
  loadMirroredAgentMetadata,
  metadataRowsToSnapshot,
  mountCrmAgentRoutes,
  parseDeterministicPrompt,
  routeErrorBody,
  validateAgentChatInput,
} = require('../lib/crm-agent-server');

function field(apiName, overrides = {}) {
  return {
    api_name: apiName,
    field_label: apiName.replaceAll('_', ' '),
    data_type: 'text',
    visible: true,
    filterable: true,
    view_type: { view: true, create: true },
    operation_type: { api_create: true },
    profiles: [{ permission_type: 'read_write' }, { permission_type: 'read_write' }],
    pick_list_values: [],
    ...overrides,
  };
}

function layout(id, names) {
  return {
    id,
    name: `Layout ${id}`,
    visible: true,
    status: 'active',
    sections: [{ fields: names.map(api_name => ({ api_name })) }],
  };
}

function metadataFixture({ twoLayouts = false, includeTasks = false, includeCalls = false } = {}) {
  const fields = [
    field('id', { data_type: 'bigint', view_type: { view: false, create: false }, operation_type: { api_create: false }, read_only: true, profiles: [{ permission_type: 'read_only' }, { permission_type: 'read_only' }] }),
    field('Last_Name', {
      system_mandatory: true,
      view_type: { view: false, create: true },
    }),
    field('Lead_Status', { data_type: 'picklist', pick_list_values: [{ actual_value: 'New', display_value: 'New' }] }),
    field('Notes', { data_type: 'textarea', filterable: false }),
    field('Hidden_Profile', { profiles: [{ permission_type: 'read_write' }, { permission_type: 'dont_show' }] }),
    field('Password'),
  ];
  const layouts = [layout('layout-1', fields.map(item => item.api_name))];
  if (twoLayouts) layouts.push(layout('layout-2', ['id', 'Last_Name', 'Lead_Status', 'Notes']));
  const fixture = {
    modules: {
      modules: [{
        api_name: 'Leads',
        module_name: 'Leads',
        plural_label: 'Raw Leads',
        singular_label: 'Lead',
        api_supported: true,
        viewable: true,
        creatable: true,
        global_search_supported: true,
        status: 'visible',
      }],
    },
    fields_by_module: { Leads: { fields } },
    layouts_by_module: { Leads: { layouts } },
  };
  if (includeTasks) {
    const taskFields = [
      field('id', { data_type: 'bigint', view_type: { view: false, create: false }, operation_type: { api_create: false }, read_only: true, profiles: [{ permission_type: 'read_only' }, { permission_type: 'read_only' }] }),
      field('Subject'),
      field('Due_Date', { data_type: 'date' }),
      field('Status', { data_type: 'picklist', pick_list_values: [{ actual_value: 'In Progress' }, { actual_value: 'Completed' }] }),
    ];
    fixture.modules.modules.push({
      api_name: 'Tasks', api_supported: true, viewable: true, creatable: true,
      module_name: 'Tasks', plural_label: 'Tasks', singular_label: 'Task',
      global_search_supported: true, status: 'visible',
    });
    fixture.fields_by_module.Tasks = { fields: taskFields };
    fixture.layouts_by_module.Tasks = { layouts: [layout('task-layout-1', taskFields.map(item => item.api_name))] };
  }
  if (includeCalls) {
    const callFields = [
      field('id', { data_type: 'bigint', view_type: { view: false, create: false }, operation_type: { api_create: false }, read_only: true, profiles: [{ permission_type: 'read_only' }, { permission_type: 'read_only' }] }),
      field('Call_Type', {
        field_label: 'Call Type',
        data_type: 'picklist',
        pick_list_values: [{ actual_value: 'Outbound' }, { actual_value: 'Inbound' }, { actual_value: 'Missed' }],
      }),
      field('Call_Result', {
        field_label: 'Call Result',
        data_type: 'picklist',
        pick_list_values: [{ actual_value: 'Interested' }, { actual_value: 'No response/Busy' }],
      }),
    ];
    fixture.modules.modules.push({
      api_name: 'Calls', api_supported: true, viewable: true, creatable: true,
      module_name: 'Calls', plural_label: 'Calls', singular_label: 'Call',
      global_search_supported: true, status: 'visible',
    });
    fixture.fields_by_module.Calls = { fields: callFields };
    fixture.layouts_by_module.Calls = { layouts: [layout('call-layout-1', callFields.map(item => item.api_name))] };
  }
  return fixture;
}

function metadataRowsForFixture(fixture) {
  return [
    { key: 'modules', data: fixture.modules },
    ...Object.entries(fixture.fields_by_module).map(([module, data]) => ({ key: `fields:${module}`, data })),
    ...Object.entries(fixture.layouts_by_module).map(([module, data]) => ({ key: `layouts:${module}`, data })),
  ];
}

function metadataReadAdapter(fixture, { extraRows = [], transformBatch = rows => rows } = {}) {
  const rows = [...metadataRowsForFixture(fixture), ...extraRows];
  const byKey = new Map(rows.map(row => [row.key, row]));
  const calls = [];
  const readOnlyQuery = async query => {
    calls.push(query);
    if (query === AGENT_METADATA_KEY_QUERY || query === DETERMINISTIC_METADATA_QUERY) {
      return rows.map(row => ({ key: row.key })).sort((a, b) => a.key.localeCompare(b.key));
    }
    if (query === AGENT_METADATA_MODULE_QUERY) return byKey.has('modules') ? [byKey.get('modules')] : [];
    const keys = [...query.matchAll(/'((?:fields|layouts):[A-Za-z][A-Za-z0-9_$]{0,79})'/g)].map(match => match[1]);
    assert.ok(keys.length > 0 && keys.length <= AGENT_METADATA_BATCH_SIZE, 'metadata batch must stay bounded');
    const selected = keys.map(key => byKey.get(key)).filter(Boolean).sort((a, b) => a.key.localeCompare(b.key));
    return transformBatch(selected, { calls, keys });
  };
  return { calls, readOnlyQuery };
}

function fortyOneModuleFixture() {
  const fixture = { modules: { modules: [] }, fields_by_module: {}, layouts_by_module: {} };
  for (let index = 1; index <= 41; index += 1) {
    const module = `Module_${String(index).padStart(2, '0')}`;
    const fields = [
      field('id', {
        data_type: 'bigint', view_type: { view: false, create: false }, operation_type: { api_create: false },
        read_only: true, profiles: [{ permission_type: 'read_only' }, { permission_type: 'read_only' }],
      }),
      field('Status', { data_type: 'picklist', pick_list_values: [{ actual_value: 'Open', display_value: 'Open' }] }),
    ];
    fixture.modules.modules.push({
      api_name: module,
      module_name: module,
      plural_label: `${module} records`,
      singular_label: module,
      api_supported: true,
      viewable: true,
      creatable: true,
      global_search_supported: true,
      status: 'visible',
    });
    fixture.fields_by_module[module] = { fields };
    fixture.layouts_by_module[module] = { layouts: [layout(`layout-${index}`, fields.map(item => item.api_name))] };
  }
  fixture.modules.modules.push({
    api_name: 'Hidden_Module', module_name: 'Hidden_Module', plural_label: 'Hidden records', singular_label: 'Hidden',
    api_supported: true, viewable: true, creatable: true, global_search_supported: true, status: 'hidden',
  });
  fixture.fields_by_module.Hidden_Module = { fields: [field('Private_Status', { data_type: 'picklist' })] };
  fixture.layouts_by_module.Hidden_Module = { layouts: [layout('hidden-layout', ['Private_Status'])] };
  return fixture;
}

test('chat input is exact, bounded, and rejects credential-shaped content before execution', () => {
  assert.deepEqual(validateAgentChatInput({ prompt: '  Count new leads  ' }), { prompt: 'Count new leads' });
  assert.throws(() => validateAgentChatInput({ prompt: 'Count leads', messages: [] }), error => error.code === 'AGENT_CHAT_INPUT_INVALID');
  assert.throws(() => validateAgentChatInput({ prompt: 'x'.repeat(AGENT_PROMPT_MAX_CHARACTERS + 1) }), error => error.code === 'AGENT_CHAT_INPUT_INVALID');
  assert.throws(() => validateAgentChatInput({ prompt: '🙂'.repeat(Math.floor(AGENT_PROMPT_MAX_BYTES / 4) + 1) }), error => error.code === 'AGENT_CHAT_INPUT_INVALID');
  assert.throws(() => validateAgentChatInput({ prompt: 'password=do-not-send-this' }), error => error.code === 'AGENT_SENSITIVE_PROMPT_BLOCKED');
});

test('mirrored metadata loader discovers keys then reads only validated bounded SELECT batches', async () => {
  const fixture = metadataFixture();
  for (const deterministicOnly of [false, true]) {
    const adapter = metadataReadAdapter(fixture);
    const snapshot = await loadMirroredAgentMetadata(adapter.readOnlyQuery, { deterministicOnly });
    assert.equal(adapter.calls.length, 3);
    assert.equal(adapter.calls[0], deterministicOnly ? DETERMINISTIC_METADATA_QUERY : AGENT_METADATA_QUERY);
    assert.equal(adapter.calls[0], AGENT_METADATA_KEY_QUERY);
    assert.equal(adapter.calls[1], AGENT_METADATA_MODULE_QUERY);
    assert.match(adapter.calls[0], /^select key\s+from crm_meta/i);
    assert.doesNotMatch(adapter.calls[0].split(/\bfrom\b/i)[0], /\bdata\b/i);
    assert.match(adapter.calls[2], /where key in \('fields:Leads', 'layouts:Leads'\)/i);
    assert.match(adapter.calls[2], new RegExp(`limit ${2}$`));
    assert.ok(adapter.calls.every(query => /^select\b/i.test(query.trim())));
    assert.ok(adapter.calls.every(query => !/\b(?:insert|update|delete|alter|drop|truncate)\b/i.test(query)));
    assert.ok(adapter.calls.every(query => !/\bcrm_records\b/i.test(query)));
    assert.deepEqual({
      modules: snapshot.modules,
      fields_by_module: { ...snapshot.fields_by_module },
      layouts_by_module: { ...snapshot.layouts_by_module },
    }, fixture);
  }

  const rows = metadataRowsForFixture(fixture);
  assert.throws(() => metadataRowsToSnapshot([...rows, rows[0]]), error => error.code === 'AGENT_PERMISSION_SCOPE_UNAVAILABLE');
  assert.match(DETERMINISTIC_METADATA_QUERY, /like 'fields:%'/i);
  assert.match(DETERMINISTIC_METADATA_QUERY, /like 'layouts:%'/i);
});

test('cold loader preserves the exact 41-module scope and never reads ineligible module documents', async () => {
  const fixture = fortyOneModuleFixture();
  const adapter = metadataReadAdapter(fixture);
  const snapshot = await loadMirroredAgentMetadata(adapter.readOnlyQuery, { deterministicOnly: true });
  const bundle = deriveCrmAgentScope(snapshot);
  assert.equal(Object.keys(snapshot.fields_by_module).length, 41);
  assert.equal(Object.keys(snapshot.layouts_by_module).length, 41);
  assert.equal(bundle.public_scope.module_count, 41);
  assert.equal(bundle.public_scope.modules.length, 41);
  assert.equal(new Set(bundle.public_scope.modules.map(module => module.module)).size, 41);
  assert.equal(Object.prototype.hasOwnProperty.call(snapshot.fields_by_module, 'Hidden_Module'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(snapshot.layouts_by_module, 'Hidden_Module'), false);
  assert.ok(adapter.calls.every(query => !query.includes('fields:Hidden_Module')));
  assert.ok(adapter.calls.every(query => !query.includes('layouts:Hidden_Module')));
  assert.equal(adapter.calls.length, 2 + Math.ceil((41 * 2) / AGENT_METADATA_BATCH_SIZE));
  for (const query of adapter.calls.slice(2)) {
    const keyCount = (query.match(/'(?:fields|layouts):/g) || []).length;
    assert.ok(keyCount > 0 && keyCount <= AGENT_METADATA_BATCH_SIZE);
    assert.match(query, new RegExp(`limit ${keyCount}$`));
  }
  assert.doesNotMatch(JSON.stringify(bundle.public_scope), /Private_Status|Hidden_Module/);
});

test('cold loader recovers from a thrown large batch by splitting into smaller validated SELECT reads', async () => {
  const fixture = fortyOneModuleFixture();
  const adapter = metadataReadAdapter(fixture);
  const attemptedBatchSizes = [];
  const readOnlyQuery = async query => {
    if (!/where key in/i.test(query)) return adapter.readOnlyQuery(query);
    const keyCount = (query.match(/'(?:fields|layouts):/g) || []).length;
    attemptedBatchSizes.push(keyCount);
    if (keyCount > 6) throw new Error('simulated local statement timeout');
    return adapter.readOnlyQuery(query);
  };
  const snapshot = await loadMirroredAgentMetadata(readOnlyQuery, { deterministicOnly: true });
  const bundle = deriveCrmAgentScope(snapshot);
  const expectedModules = fixture.modules.modules.slice(0, 41).map(module => module.api_name);
  assert.equal(bundle.public_scope.module_count, 41);
  assert.deepEqual(Object.keys(snapshot.fields_by_module), expectedModules);
  assert.deepEqual(Object.keys(snapshot.layouts_by_module), expectedModules);
  assert.ok(attemptedBatchSizes.includes(12));
  assert.ok(attemptedBatchSizes.includes(6));
  assert.ok(attemptedBatchSizes.includes(10));
  assert.ok(attemptedBatchSizes.includes(5));
  assert.ok(attemptedBatchSizes.every(size => size >= 1 && size <= AGENT_METADATA_BATCH_SIZE));
  assert.ok(adapter.calls.every(query => /^select\b/i.test(query.trim())));
  assert.ok(adapter.calls.every(query => !/\b(?:insert|update|delete|alter|drop|truncate)\b/i.test(query)));
  assert.doesNotMatch(JSON.stringify(bundle.public_scope), /Private_Status|Hidden_Module/);
});

test('cold loader fails safe when adaptive splitting reaches a thrown single-key read', async () => {
  const fixture = metadataFixture();
  const adapter = metadataReadAdapter(fixture);
  const attemptedBatchSizes = [];
  let thrown;
  try {
    await loadMirroredAgentMetadata(async query => {
      if (!/where key in/i.test(query)) return adapter.readOnlyQuery(query);
      const keyCount = (query.match(/'(?:fields|layouts):/g) || []).length;
      attemptedBatchSizes.push(keyCount);
      if (keyCount > 1 || query.includes("'layouts:Leads'")) {
        throw new Error('postgres://private-user:private-password@host token=private-token');
      }
      return adapter.readOnlyQuery(query);
    });
  } catch (error) {
    thrown = error;
  }
  assert.equal(thrown?.code, 'AGENT_PERMISSION_SCOPE_UNAVAILABLE');
  assert.equal(thrown?.status, 503);
  assert.equal(thrown?.message, 'Mirrored CRM metadata could not be read.');
  assert.deepEqual(attemptedBatchSizes, [2], 'non-resource errors must not be recursively retried');
  assert.doesNotMatch(JSON.stringify(thrown), /private-user|private-password|private-token|postgres|host/);
});

test('adaptive metadata splitting has one total bounded read budget and releases persistent pressure', async () => {
  const fixture = fortyOneModuleFixture();
  const adapter = metadataReadAdapter(fixture);
  let attempts = 0;
  await assert.rejects(
    loadMirroredAgentMetadata(async query => {
      attempts += 1;
      if (!/where key in/i.test(query)) return adapter.readOnlyQuery(query);
      const keyCount = (query.match(/'(?:fields|layouts):/g) || []).length;
      if (keyCount > 1) {
        const error = new Error('simulated statement timeout');
        error.code = '57014';
        throw error;
      }
      return adapter.readOnlyQuery(query);
    }, { deterministicOnly: true }),
    error => error.code === 'AGENT_PERMISSION_SCOPE_UNAVAILABLE'
      && error.message === 'Mirrored CRM metadata read budget was exhausted.',
  );
  assert.equal(attempts, AGENT_METADATA_MAX_QUERY_ATTEMPTS);
});

test('cold metadata discovery and batches fail closed on overflow, invalid keys, duplicates, or drift', async () => {
  const fixture = metadataFixture();
  const overflowKeys = [{ key: 'modules' }];
  for (let index = 0; index < 250; index += 1) {
    overflowKeys.push({ key: `fields:Overflow_${index}` }, { key: `layouts:Overflow_${index}` });
  }
  await assert.rejects(
    loadMirroredAgentMetadata(async query => query === AGENT_METADATA_KEY_QUERY ? overflowKeys : []),
    error => error.code === 'AGENT_PERMISSION_SCOPE_UNAVAILABLE',
  );

  const invalidKey = metadataReadAdapter(fixture, { extraRows: [{ key: 'fields:Invalid-Module', data: {} }] });
  await assert.rejects(loadMirroredAgentMetadata(invalidKey.readOnlyQuery), error => error.code === 'AGENT_PERMISSION_SCOPE_UNAVAILABLE');

  const duplicateKey = metadataReadAdapter(fixture, { extraRows: [{ key: 'fields:Leads', data: fixture.fields_by_module.Leads }] });
  await assert.rejects(loadMirroredAgentMetadata(duplicateKey.readOnlyQuery), error => error.code === 'AGENT_PERMISSION_SCOPE_UNAVAILABLE');

  const incompleteBatch = metadataReadAdapter(fixture, { transformBatch: rows => rows.slice(0, -1) });
  await assert.rejects(loadMirroredAgentMetadata(incompleteBatch.readOnlyQuery), error => error.code === 'AGENT_PERMISSION_SCOPE_UNAVAILABLE');
  assert.equal(incompleteBatch.calls.length, 3, 'validation failures must not trigger adaptive reads');

  const unexpectedBatch = metadataReadAdapter(fixture, {
    transformBatch: rows => [rows[0], { key: 'fields:Unexpected', data: {} }],
  });
  await assert.rejects(loadMirroredAgentMetadata(unexpectedBatch.readOnlyQuery), error => error.code === 'AGENT_PERMISSION_SCOPE_UNAVAILABLE');
  assert.equal(unexpectedBatch.calls.length, 3, 'metadata drift must not trigger adaptive reads');
});

test('permission scope is a conservative intersection of mirrored module, field, profile, and exact layout metadata', () => {
  const bundle = deriveCrmAgentScope(metadataFixture());
  const policy = bundle.permissions.modules.Leads;
  assert.deepEqual(policy.readable_fields, ['id', 'Lead_Status', 'Notes']);
  assert.deepEqual(policy.aggregate_fields, ['id', 'Lead_Status']);
  assert.deepEqual(policy.writable_fields, ['Last_Name', 'Lead_Status', 'Notes']);
  assert.equal(policy.create_draft, true);
  assert.equal(bundle.metadata_by_module.Leads.definition_complete, true);
  assert.equal(bundle.metadata_by_module.Leads.layout_resolved, true);
  assert.equal(bundle.public_scope.basis, AGENT_SCOPE_BASIS);
  assert.deepEqual(bundle.public_scope.modules[0], {
    module: 'Leads',
    capabilities: { aggregate: true, search: true, detail: true, metadata: true, create_draft: true },
    readable_field_count: 3,
    aggregate_field_count: 2,
    writable_draft_field_count: 3,
    layout_resolved: true,
  });
  assert.doesNotMatch(JSON.stringify(bundle), /Hidden_Profile|Password/);
});

test('ambiguous mirrored layouts fail closed for creation drafts while preserving common read scope', () => {
  const bundle = deriveCrmAgentScope(metadataFixture({ twoLayouts: true }));
  assert.equal(bundle.permissions.modules.Leads.create_draft, false);
  assert.deepEqual(bundle.permissions.modules.Leads.writable_fields, []);
  assert.equal(bundle.metadata_by_module.Leads.layout_resolved, false);
  assert.equal(bundle.public_scope.modules[0].layout_resolved, false);
});

test('local handlers issue only bounded SELECT statements and never contact a source or write adapter', async () => {
  const bundle = deriveCrmAgentScope(metadataFixture());
  const queries = [];
  const readOnlyQuery = async query => {
    queries.push(query);
    if (/count\(\*\).*group by/is.test(query)) return [{ value: 'New', count: 3, total: 3 }];
    if (/count\(\*\)::int as total/is.test(query)) return [{ total: 3 }];
    if (/search_text ilike/is.test(query)) return [{ data: { id: '1', Last_Name: 'Rao', Password: 'omit' } }];
    if (/and id =/is.test(query)) return [{ data: { id: '1', Last_Name: 'Rao' } }];
    return [];
  };
  const handlers = createLocalCrmAgentHandlers({ readOnlyQuery, bundle });
  assert.deepEqual(Object.keys(handlers), ['source_mode', 'aggregateRecords', 'searchRecords', 'getRecord', 'getModuleMetadata']);
  assert.equal(handlers.source_mode, AGENT_SOURCE_MODE);
  assert.deepEqual(await handlers.aggregateRecords({
    module: 'Leads', group_by: 'Lead_Status', filters: [], limit: 10,
    field_scope: bundle.permissions.modules.Leads.aggregate_fields, source_mode: AGENT_SOURCE_MODE,
  }), { total: 3, groups: [{ value: 'New', count: 3 }] });
  assert.deepEqual(await handlers.searchRecords({
    module: 'Leads', query: "Rao' OR 1=1 --", limit: 5,
    field_scope: bundle.permissions.modules.Leads.readable_fields, source_mode: AGENT_SOURCE_MODE,
  }), { records: [{ id: '1', Last_Name: 'Rao', Password: 'omit' }] });
  assert.deepEqual(await handlers.getRecord({
    module: 'Leads', record_id: '1', field_scope: bundle.permissions.modules.Leads.readable_fields, source_mode: AGENT_SOURCE_MODE,
  }), { record: { id: '1', Last_Name: 'Rao' } });
  assert.equal((await handlers.getModuleMetadata({ module: 'Leads', purpose: 'inspect', source_mode: AGENT_SOURCE_MODE })).layout_resolved, true);
  assert.ok(queries.every(query => /^select\b/i.test(query.trim())));
  assert.ok(queries.every(query => !/\b(?:insert|update|delete|alter|drop)\b/i.test(query)));
  assert.match(queries.find(query => /search_text ilike/i.test(query)), /Rao'' OR 1=1 --/);
  assert.match(queries.find(query => /count\(\*\).*group by/is.test(query)), /select status as value/);
});

test('reviewed aggregate cache coalesces safe unfiltered reads and clears on record mutation', async () => {
  const bundle = deriveCrmAgentScope(metadataFixture());
  const aggregateCache = new Map();
  let queryCalls = 0;
  const handlers = createLocalCrmAgentHandlers({
    bundle,
    aggregateCache,
    readOnlyQuery: async () => {
      queryCalls += 1;
      await new Promise(resolve => setTimeout(resolve, 5));
      return [{ value: 'New', count: 3, total: 3 }];
    },
  });
  const input = {
    module: 'Leads', group_by: 'Lead_Status', filters: [], limit: 10,
    field_scope: bundle.permissions.modules.Leads.aggregate_fields, source_mode: AGENT_SOURCE_MODE,
  };
  const [first, second] = await Promise.all([handlers.aggregateRecords(input), handlers.aggregateRecords(input)]);
  assert.deepEqual(first, { total: 3, groups: [{ value: 'New', count: 3 }] });
  assert.deepEqual(second, first);
  assert.notEqual(first, second);
  assert.equal(queryCalls, 1);
  await handlers.aggregateRecords(input);
  assert.equal(queryCalls, 1);

  const service = createCrmAgentRouteService({ env: {}, readOnlyQuery: async () => [], aggregateCache });
  service.invalidateDataCache();
  assert.equal(aggregateCache.size, 0);
  await handlers.aggregateRecords(input);
  assert.equal(queryCalls, 2);
});

test('filtered aggregate retries one exact local statement timeout and remains aggregate-only', async () => {
  const bundle = deriveCrmAgentScope(metadataFixture({ includeCalls: true }));
  let queryCalls = 0;
  const handlers = createLocalCrmAgentHandlers({
    bundle,
    readOnlyQuery: async (query, { signal }) => {
      queryCalls++;
      assert.equal(signal.aborted, false);
      assert.match(query, /select[\s\S]*count\(\*\)[\s\S]*group by 1/i);
      assert.doesNotMatch(query, /select\s+data\b/i);
      if (queryCalls === 1) {
        const error = new Error('canceling statement due to statement timeout');
        error.dbCode = '57014';
        throw error;
      }
      return [{ value: 'Outbound', count: 8, total: 8 }];
    },
  });
  const result = await handlers.aggregateRecords({
    module: 'Calls',
    group_by: 'Call_Type',
    filters: [{ field: 'Call_Result', operator: 'is_empty' }],
    limit: 50,
    field_scope: bundle.permissions.modules.Calls.aggregate_fields,
    source_mode: AGENT_SOURCE_MODE,
  });
  assert.deepEqual(result, { total: 8, groups: [{ value: 'Outbound', count: 8 }] });
  assert.equal(queryCalls, 2);
});

test('aggregate invalidation during an in-flight read cannot repopulate stale cache data', async () => {
  const bundle = deriveCrmAgentScope(metadataFixture());
  const aggregateCache = new Map();
  let releaseFirstRead;
  let queryCalls = 0;
  const firstReadGate = new Promise(resolve => { releaseFirstRead = resolve; });
  const handlers = createLocalCrmAgentHandlers({
    bundle,
    aggregateCache,
    readOnlyQuery: async () => {
      queryCalls += 1;
      if (queryCalls === 1) await firstReadGate;
      return [{ value: 'New', count: queryCalls, total: queryCalls }];
    },
  });
  const input = {
    module: 'Leads', group_by: 'Lead_Status', filters: [], limit: 10,
    field_scope: bundle.permissions.modules.Leads.aggregate_fields, source_mode: AGENT_SOURCE_MODE,
  };
  const service = createCrmAgentRouteService({ env: {}, readOnlyQuery: async () => [], aggregateCache });

  const staleRead = handlers.aggregateRecords(input);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(queryCalls, 1);
  assert.equal(aggregateCache.size, 1);
  service.invalidateDataCache();
  assert.equal(aggregateCache.size, 0);
  releaseFirstRead();
  assert.deepEqual(await staleRead, { total: 1, groups: [{ value: 'New', count: 1 }] });
  assert.equal(aggregateCache.size, 0, 'a pre-invalidation completion must not repopulate cache');

  assert.deepEqual(await handlers.aggregateRecords(input), { total: 2, groups: [{ value: 'New', count: 2 }] });
  assert.equal(queryCalls, 2);
  assert.equal(aggregateCache.size, 1);
});

test('assistant permission scope uses the injected cold-load coordinator once and bypasses it when warm', async () => {
  let coordinatorCalls = 0;
  let metadataCalls = 0;
  const service = createCrmAgentRouteService({
    env: {},
    readOnlyQuery: async () => [],
    loadMetadata: async () => {
      metadataCalls += 1;
      await new Promise(resolve => setImmediate(resolve));
      return fortyOneModuleFixture();
    },
    runScopeLoad: async (task, generation) => {
      coordinatorCalls += 1;
      assert.equal(generation, 0);
      return task();
    },
  });

  const [first, duplicate] = await Promise.all([service.status(), service.status()]);
  const warm = await service.status();
  assert.equal(first.permission_scope.module_count, 41);
  assert.deepEqual(duplicate, first);
  assert.deepEqual(warm, first);
  assert.equal(coordinatorCalls, 1);
  assert.equal(metadataCalls, 1);
  assert.throws(
    () => createCrmAgentRouteService({ env: {}, readOnlyQuery: async () => [], runScopeLoad: 'invalid' }),
    /runScopeLoad must be a function/,
  );
});

test('metadata invalidation refreshes permission scope and suppresses stale in-flight write-back', async () => {
  const { createColdReadCoordinator } = require('../lib/cold-read-coordinator');
  const coordinator = createColdReadCoordinator();
  let currentFixture = metadataFixture({ includeTasks: true });
  let releaseFirstLoad;
  let metadataCalls = 0;
  const firstLoadGate = new Promise(resolve => { releaseFirstLoad = resolve; });
  const service = createCrmAgentRouteService({
    env: {},
    readOnlyQuery: async () => [],
    loadMetadata: async () => {
      metadataCalls += 1;
      const captured = currentFixture;
      if (metadataCalls === 1) await firstLoadGate;
      return captured;
    },
    runScopeLoad: (task, generation) => coordinator.runAssistantScope(generation, task),
  });

  const beforeRefresh = service.status();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(metadataCalls, 1);
  currentFixture = metadataFixture({ includeTasks: true });
  currentFixture.modules.modules[0].viewable = false;
  service.invalidateMetadataCache();
  const afterRefresh = service.status();
  releaseFirstLoad();

  const [originalCaller, refreshedCaller] = await Promise.all([beforeRefresh, afterRefresh]);
  assert.equal(metadataCalls, 2);
  assert.equal(originalCaller.permission_scope.module_count, 1);
  assert.equal(refreshedCaller.permission_scope.module_count, 1);
  assert.deepEqual(refreshedCaller.permission_scope.modules.map(module => module.module), ['Tasks']);
  assert.equal((await service.status()).permission_scope.module_count, 1);
  assert.equal(metadataCalls, 2, 'the refreshed scope should be cached');
});

test('no-key status and all seven reviewed prompts use only deterministic permission-scoped local tools', async () => {
  let metadataCalls = 0;
  let agentCalls = 0;
  const queries = [];
  const service = createCrmAgentRouteService({
    env: {},
    readOnlyQuery: async query => {
      queries.push(query);
      if (/data->'Call_Type'/i.test(query) && /data->'Call_Result'/i.test(query) && /is null/i.test(query)) return [
        { value: 'Outbound', count: 8, total: 10 },
        { value: 'Inbound', count: 2, total: 10 },
      ];
      if (/group by 1/i.test(query)) return [
        { value: 'New', count: 7, total: 10 },
        { value: 'Qualified', count: 3, total: 10 },
      ];
      if (/count\(\*\)::int as total/i.test(query)) return [{ total: 10 }];
      if (/module = 'Tasks'/i.test(query)) return [{ data: {
        id: 'task-1', Subject: 'Follow up', Due_Date: '2026-08-29', Status: 'In Progress', Password: 'omit',
      } }];
      throw new Error('unexpected query');
    },
    loadMetadata: async () => { metadataCalls += 1; return metadataFixture({ includeTasks: true, includeCalls: true }); },
    createAgent: async () => { agentCalls += 1; throw new Error('must not construct'); },
  });
  const first = await service.status();
  const second = await service.status();
  assert.deepEqual(first, second);
  assert.equal(first.available, false);
  assert.equal(first.deterministic_available, true);
  assert.equal(first.status, 'DeterministicOnly');
  assert.equal(first.reason_code, 'AI_GATEWAY_CREDENTIAL_MISSING');
  assert.equal(first.model, null);
  assert.equal(first.provider, 'Local deterministic parser');
  assert.equal(first.network_attempted, false);
  assert.equal(first.permission_scope.loaded, true);
  assert.equal(first.permission_scope.module_count, 3);
  assert.equal(first.fallback.network_attempted, false);
  assert.deepEqual(first.fallback.supported_questions, DETERMINISTIC_SUPPORTED_QUESTIONS);
  assert.deepEqual(first.fallback.reviewed_questions, DETERMINISTIC_SUPPORTED_QUESTIONS);
  assert.deepEqual(first.fallback.unavailable_questions, []);

  const count = await service.chat({ prompt: 'Count Leads by Lead Status' });
  assert.equal(count.available, false);
  assert.equal(count.deterministic_available, true);
  assert.equal(count.status, 'Complete');
  assert.equal(count.model, null);
  assert.equal(count.network_attempted, false);
  assert.equal(count.deterministic_intent, 'count_leads_by_status');
  assert.deepEqual(count.executed_tools, ['aggregate_records']);
  assert.match(count.answer, /10 total[\s\S]*New: 7[\s\S]*Qualified: 3/);

  const overdue = await service.chat({ prompt: 'Find up to 10 overdue Tasks' });
  assert.equal(overdue.deterministic_intent, 'find_overdue_tasks');
  assert.deepEqual(overdue.executed_tools, ['search_records']);
  assert.match(overdue.answer, /Follow up — due 2026-08-29 · In Progress/);
  assert.doesNotMatch(JSON.stringify(overdue), /Password|omit/);

  const required = await service.chat({ prompt: 'Show required fields for a new Lead' });
  assert.equal(required.deterministic_intent, 'required_lead_fields');
  assert.deepEqual(required.executed_tools, ['inspect_module_metadata']);
  assert.match(required.answer, /Last Name \(Last_Name\)/);

  const draft = await service.chat({ prompt: 'Prepare a new Lead draft for review with Last Name: Rao' });
  assert.equal(draft.deterministic_intent, 'prepare_lead_draft');
  assert.deepEqual(draft.executed_tools, ['prepare_record_creation_draft']);
  assert.equal(draft.draft_preview.status, 'PreviewOnly');
  assert.deepEqual(draft.draft_preview.values, { Last_Name: 'Rao' });
  assert.equal(draft.draft_preview.ui_handoff.auto_submit, false);
  assert.ok(Object.values(draft.draft_preview.execution).every(value => value === false));

  const moduleCount = await service.chat({ prompt: 'Count records in Raw Leads' });
  assert.equal(moduleCount.deterministic_intent, 'count_module_records');
  assert.deepEqual(moduleCount.executed_tools, ['aggregate_records']);
  assert.match(moduleCount.answer, /Raw Leads — 10 records/);

  const groupedCount = await service.chat({ prompt: 'Count records in Raw Leads by Lead Status' });
  assert.equal(groupedCount.deterministic_intent, 'count_module_by_safe_field');
  assert.deepEqual(groupedCount.executed_tools, ['aggregate_records']);
  assert.match(groupedCount.answer, /Raw Leads by Lead Status — 10 total[\s\S]*New: 7/);

  const filteredGroupedCount = await service.chat({ prompt: 'Count records in Calls by Call Type where Call Result is empty' });
  assert.equal(filteredGroupedCount.deterministic_intent, 'count_module_by_safe_field_where_empty');
  assert.deepEqual(filteredGroupedCount.executed_tools, ['aggregate_records']);
  assert.equal(filteredGroupedCount.draft_preview, null);
  assert.match(filteredGroupedCount.answer, /Calls by Call Type where Call Result is empty — 10 total[\s\S]*Outbound: 8[\s\S]*Inbound: 2/);
  assert.equal(Object.prototype.hasOwnProperty.call(filteredGroupedCount, 'records'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(filteredGroupedCount, 'data'), false);
  assert.doesNotMatch(JSON.stringify(filteredGroupedCount), /Subject|Last_Name|Password/);

  const unsupported = await service.chat({ prompt: 'Delete every Lead' });
  assert.equal(unsupported.deterministic_intent, 'unsupported');
  assert.deepEqual(unsupported.executed_tools, []);
  assert.equal(unsupported.draft_preview, null);
  assert.match(unsupported.answer, /supports only these currently available bounded questions/);

  assert.equal(metadataCalls, 1);
  assert.equal(agentCalls, 0);
  assert.equal(queries.length, 5);
  assert.ok(queries.every(query => /^select\b/i.test(query.trim())));
  assert.ok(queries.every(query => !/\b(?:insert|update|delete|alter|drop)\b/i.test(query)));
  assert.match(queries.find(query => /module = 'Tasks'/i.test(query)), /due_date[\s\S]*current_date[\s\S]*status/);
  const filteredQuery = queries.find(query => /data->'Call_Type'/i.test(query) && /data->'Call_Result'/i.test(query));
  assert.match(filteredQuery, /select[\s\S]*count\(\*\)[\s\S]*group by 1/i);
  assert.match(filteredQuery, /data->'Call_Result'[\s\S]*is null[\s\S]*btrim/i);
  assert.doesNotMatch(filteredQuery, /select\s+data\b/i);
});

test('keyless status preflights each reviewed intent and unavailable prompts execute no tool', async () => {
  let readQueries = 0;
  const service = createCrmAgentRouteService({
    env: {},
    readOnlyQuery: async () => { readQueries += 1; throw new Error('unavailable intent must not query'); },
    loadMetadata: async () => metadataFixture(),
  });
  const status = await service.status();
  assert.equal(status.deterministic_available, true);
  assert.equal(status.fallback.message, 'AI model unavailable. Keyless local mode can answer 6 of 7 reviewed CRM questions with no model or network call.');
  assert.deepEqual(status.fallback.supported_questions, [
    DETERMINISTIC_SUPPORTED_QUESTIONS[0],
    DETERMINISTIC_SUPPORTED_QUESTIONS[2],
    DETERMINISTIC_SUPPORTED_QUESTIONS[3],
    DETERMINISTIC_SUPPORTED_QUESTIONS[4],
    DETERMINISTIC_SUPPORTED_QUESTIONS[5],
    DETERMINISTIC_SUPPORTED_QUESTIONS[6],
  ]);
  assert.deepEqual(status.fallback.unavailable_questions, [{
    question: DETERMINISTIC_SUPPORTED_QUESTIONS[1],
    reason_code: 'TASKS_OVERDUE_SEARCH_UNAVAILABLE',
    message: 'Overdue Tasks are unavailable because the mirrored Tasks search permission or Subject, Due Date, and Status fields are incomplete.',
  }]);

  const response = await service.chat({ prompt: 'Find up to 10 overdue Tasks' });
  assert.equal(response.deterministic_intent, 'find_overdue_tasks');
  assert.equal(response.deterministic_reason_code, 'TASKS_OVERDUE_SEARCH_UNAVAILABLE');
  assert.deepEqual(response.executed_tools, []);
  assert.match(response.answer, /mirrored Tasks search permission/);
  assert.equal(readQueries, 0);

  const ambiguous = deriveCrmAgentScope(metadataFixture({ twoLayouts: true, includeTasks: true }));
  const byName = Object.fromEntries(deterministicIntentAvailability(ambiguous).map(item => [item.name, item.available]));
  assert.deepEqual(byName, {
    count_leads_by_status: true,
    find_overdue_tasks: true,
    required_lead_fields: false,
    prepare_lead_draft: false,
    count_module_records: true,
    count_module_by_safe_field: true,
    count_module_by_safe_field_where_empty: true,
  });
});

test('keyless status is unavailable when no reviewed intent passes preflight', async () => {
  const fixture = metadataFixture();
  fixture.modules.modules[0].api_name = 'Contacts';
  fixture.fields_by_module.Contacts = fixture.fields_by_module.Leads;
  fixture.layouts_by_module.Contacts = fixture.layouts_by_module.Leads;
  fixture.fields_by_module.Contacts.fields.forEach(item => { item.filterable = false; });
  delete fixture.fields_by_module.Leads;
  delete fixture.layouts_by_module.Leads;
  const service = createCrmAgentRouteService({
    env: {},
    readOnlyQuery: async () => { throw new Error('no reviewed intent may query'); },
    loadMetadata: async () => fixture,
  });
  const status = await service.status();
  assert.equal(status.deterministic_available, false);
  assert.equal(status.status, 'Unavailable');
  assert.deepEqual(status.fallback.supported_questions, []);
  assert.equal(status.fallback.reviewed_questions.length, 7);
  assert.equal(status.fallback.unavailable_questions.length, 7);
  assert.match(status.fallback.message, /No reviewed keyless CRM question/);
});

test('deterministic prompt parser is an exact bounded allowlist and never treats arbitrary prose as a tool instruction', () => {
  assert.equal(parseDeterministicPrompt('Count Leads by Lead Status').name, 'count_leads_by_status');
  assert.equal(parseDeterministicPrompt('Find up to 10 overdue Tasks').name, 'find_overdue_tasks');
  assert.equal(parseDeterministicPrompt('Show required fields for a new Lead').name, 'required_lead_fields');
  assert.deepEqual(parseDeterministicPrompt('Prepare a new Lead draft for review with Last Name: Rao').input.values, { Last_Name: 'Rao' });
  assert.deepEqual(parseDeterministicPrompt('Count records in Raw Leads').parameters, { module: 'Raw Leads' });
  assert.deepEqual(parseDeterministicPrompt('Count Raw Leads by Lead Status').parameters, { module: 'Raw Leads', field: 'Lead Status' });
  assert.deepEqual(parseDeterministicPrompt('Please count records in Calls by Call Type where Call Result is empty?'), {
    name: 'count_module_by_safe_field_where_empty',
    toolName: 'aggregate_records',
    parameters: { module: 'Calls', group_field: 'Call Type', filter_field: 'Call Result' },
  });
  assert.equal(parseDeterministicPrompt('run SQL select * from crm_records'), null);
  assert.equal(parseDeterministicPrompt('Prepare a new Contact draft with Last Name: Rao'), null);
  assert.equal(parseDeterministicPrompt(`Prepare a new Lead draft with Last Name: ${'x'.repeat(121)}`), null);
  assert.equal(parseDeterministicPrompt('Count records in Leads; drop table crm_records'), null);
  assert.equal(parseDeterministicPrompt('Count records in Calls by Call Type where Call Result is empty; drop table crm_records'), null);
});

test('generic aggregate prompts fail closed for ambiguous modules and private or unreviewed dimensions', async () => {
  const fixture = metadataFixture({ includeTasks: true });
  const designer = field('Designer_Name', {
    field_label: 'Designer Name',
    data_type: 'picklist',
    pick_list_values: [{ actual_value: 'Private Person', display_value: 'Private Person' }],
  });
  fixture.fields_by_module.Leads.fields.push(designer);
  fixture.layouts_by_module.Leads.layouts[0].sections[0].fields.push({ api_name: 'Designer_Name' });
  fixture.modules.modules.find(module => module.api_name === 'Tasks').plural_label = 'Raw Leads';

  let recordQueries = 0;
  const service = createCrmAgentRouteService({
    env: {},
    readOnlyQuery: async () => { recordQueries += 1; throw new Error('rejected aggregate prompt must not query'); },
    loadMetadata: async () => fixture,
  });

  const ambiguous = await service.chat({ prompt: 'Count records in Raw Leads' });
  assert.equal(ambiguous.deterministic_intent, 'count_module_records');
  assert.equal(ambiguous.deterministic_reason_code, 'DETERMINISTIC_MODULE_UNAVAILABLE');
  assert.deepEqual(ambiguous.executed_tools, []);
  assert.match(ambiguous.answer, /not an exact, uniquely resolved module/);

  const ambiguousFiltered = await service.chat({ prompt: 'Count records in Raw Leads by Lead Status where Lead Status is empty' });
  assert.equal(ambiguousFiltered.deterministic_intent, 'count_module_by_safe_field_where_empty');
  assert.equal(ambiguousFiltered.deterministic_reason_code, 'DETERMINISTIC_MODULE_UNAVAILABLE');
  assert.deepEqual(ambiguousFiltered.executed_tools, []);

  const privateDimension = await service.chat({ prompt: 'Count records in Leads by Designer Name' });
  assert.equal(privateDimension.deterministic_intent, 'count_module_by_safe_field');
  assert.equal(privateDimension.deterministic_reason_code, 'DETERMINISTIC_AGGREGATE_FIELD_UNAVAILABLE');
  assert.deepEqual(privateDimension.executed_tools, []);
  assert.doesNotMatch(JSON.stringify(privateDimension), /Private Person/);

  const privateFilter = await service.chat({ prompt: 'Count records in Leads by Lead Status where Designer Name is empty' });
  assert.equal(privateFilter.deterministic_intent, 'count_module_by_safe_field_where_empty');
  assert.equal(privateFilter.deterministic_reason_code, 'DETERMINISTIC_AGGREGATE_FIELD_UNAVAILABLE');
  assert.deepEqual(privateFilter.executed_tools, []);
  assert.match(privateFilter.answer, /grouping or filter field is not an exact reviewed non-private categorical aggregate field/);
  assert.doesNotMatch(JSON.stringify(privateFilter), /Private Person/);

  const unknown = await service.chat({ prompt: 'Count records in Unknown Module' });
  assert.equal(unknown.deterministic_reason_code, 'DETERMINISTIC_MODULE_UNAVAILABLE');
  assert.deepEqual(unknown.executed_tools, []);

  const ambiguousFieldFixture = metadataFixture();
  const collidingField = field('Lead_Quality', {
    field_label: 'Lead Status',
    data_type: 'picklist',
    pick_list_values: [{ actual_value: 'Reviewed' }],
  });
  ambiguousFieldFixture.fields_by_module.Leads.fields.push(collidingField);
  ambiguousFieldFixture.layouts_by_module.Leads.layouts[0].sections[0].fields.push({ api_name: 'Lead_Quality' });
  const ambiguousFieldService = createCrmAgentRouteService({
    env: {},
    readOnlyQuery: async () => { recordQueries += 1; throw new Error('ambiguous fields must not query'); },
    loadMetadata: async () => ambiguousFieldFixture,
  });
  const ambiguousFields = await ambiguousFieldService.chat({
    prompt: 'Count records in Leads by Lead Status where Lead Status is empty',
  });
  assert.equal(ambiguousFields.deterministic_intent, 'count_module_by_safe_field_where_empty');
  assert.equal(ambiguousFields.deterministic_reason_code, 'DETERMINISTIC_AGGREGATE_FIELD_UNAVAILABLE');
  assert.deepEqual(ambiguousFields.executed_tools, []);
  assert.equal(recordQueries, 0);
});

test('available status exposes safe scope counts, reviewed limits, and no credentials or private identities', async () => {
  const service = createCrmAgentRouteService({
    env: { AI_GATEWAY_API_KEY: 'never-echo-this', CRM_AGENT_MODEL: 'openai/gpt-5.6-sol' },
    readOnlyQuery: async () => [],
    loadMetadata: async () => metadataFixture(),
  });
  const status = await service.status();
  assert.equal(status.available, true);
  assert.equal(status.source_mode, AGENT_SOURCE_MODE);
  assert.equal(status.telemetry_enabled, false);
  assert.equal(status.permission_scope.module_count, 1);
  assert.deepEqual(status.limits, {
    prompt_characters: AGENT_PROMPT_MAX_CHARACTERS,
    prompt_bytes: AGENT_PROMPT_MAX_BYTES,
    max_concurrent_chats: AGENT_MAX_CONCURRENT_CHATS,
    max_agent_steps: 6,
    max_output_tokens: 1200,
  });
  assert.doesNotMatch(JSON.stringify(status), /never-echo-this|read_write|layout-1/);
});

test('chat returns bounded assistant text and preview-only UI handoff without a create route or write execution', async () => {
  const calls = [];
  const service = createCrmAgentRouteService({
    env: { VERCEL_OIDC_TOKEN: 'test-placeholder', CRM_AGENT_MODEL: 'openai/gpt-5.6-sol' },
    readOnlyQuery: async query => { calls.push(['query', query]); return []; },
    loadMetadata: async () => metadataFixture(),
    createAgent: async options => {
      calls.push(['createAgent', options]);
      return {
        available: true,
        agent: {
          async generate(generation) {
            calls.push(['generate', generation]);
            return {
              text: 'Draft prepared. password=must-not-leak',
              toolResults: [{
                toolName: 'prepare_record_creation_draft',
                output: {
                  status: 'PreviewOnly',
                  module: 'Leads',
                  values: { Last_Name: 'Rao', Lead_Status: 'New' },
                  draft_fingerprint: 'a'.repeat(64),
                  validation: {
                    valid: true,
                    metadata_complete: true,
                    missing_required_fields: [],
                    unavailable_required_fields: [],
                    hidden_required_field_count: 0,
                    invalid_or_read_only_fields: [],
                  },
                  approval: { required: true, approved: false },
                  execution: {
                    local_create_route_called: false,
                    local_database_write: false,
                    zoho_contacted: false,
                    zoho_write: false,
                    outbound_action: false,
                  },
                },
              }],
            };
          },
        },
      };
    },
  });
  const response = await service.chat({ prompt: 'Prepare a lead for Rao' });
  assert.equal(response.available, true);
  assert.equal(response.status, 'Complete');
  assert.doesNotMatch(response.answer, /must-not-leak/);
  assert.match(response.answer, /credential omitted/);
  assert.equal(response.draft_preview.status, 'PreviewOnly');
  assert.deepEqual(response.draft_preview.layout, { resolved: true, selection_required: false });
  assert.deepEqual(response.draft_preview.approval, { required: true, approved: false });
  assert.equal(response.draft_preview.ui_handoff.action, 'open_existing_validated_create_form');
  assert.equal(response.draft_preview.ui_handoff.requires_explicit_user_approval, true);
  assert.equal(response.draft_preview.ui_handoff.auto_submit, false);
  assert.equal(response.draft_preview.validation.scope, 'mirrored-required-field-precheck');
  assert.equal(response.draft_preview.validation.requires_existing_create_form_validation, true);
  assert.ok(Object.values(response.draft_preview.execution).every(value => value === false));
  assert.doesNotMatch(JSON.stringify(response), /\/api\/record|method|create_record/);
  const createOptions = calls.find(([name]) => name === 'createAgent')[1];
  assert.equal(createOptions.handlers.source_mode, AGENT_SOURCE_MODE);
  assert.equal(Object.prototype.hasOwnProperty.call(createOptions.handlers, 'createRecord'), false);
  const generation = calls.find(([name]) => name === 'generate')[1];
  assert.deepEqual({ prompt: generation.prompt, timeout: generation.timeout }, { prompt: 'Prepare a lead for Rao', timeout: 30000 });
});

test('real AI SDK ToolLoopAgent construction with server-derived scope remains network-free', async () => {
  const bundle = deriveCrmAgentScope(metadataFixture());
  let queryCalls = 0;
  const handlers = createLocalCrmAgentHandlers({
    bundle,
    readOnlyQuery: async () => { queryCalls += 1; throw new Error('construction must not query'); },
  });
  const created = await createCrmAgent({
    env: { AI_GATEWAY_API_KEY: 'test-placeholder', CRM_AGENT_MODEL: 'openai/gpt-5.6-sol' },
    handlers,
    permissions: bundle.permissions,
  });
  assert.equal(created.available, true);
  assert.equal(created.agent.id, 'magppie-crm-data-agent');
  assert.deepEqual(Object.keys(created.tools), [
    'aggregate_records', 'search_records', 'get_record', 'inspect_module_metadata', 'prepare_record_creation_draft',
  ]);
  assert.equal(queryCalls, 0);
});

test('validation and provider failures return fixed credential-safe route errors', async () => {
  let validationError;
  try { validateAgentChatInput({ messages: [] }); } catch (error) { validationError = error; }
  const invalid = routeErrorBody(validationError);
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.reason_code, 'AGENT_CHAT_INPUT_INVALID');

  const denied = routeErrorBody(new CrmAgentPolicyError(
    'AGENT_PERMISSION_DENIED',
    'The requested local CRM operation is not permitted.',
  ));
  assert.equal(denied.status, 403);
  assert.equal(denied.body.reason_code, 'AGENT_PERMISSION_DENIED');
  assert.equal(denied.body.error.message, 'The requested local CRM operation is not permitted.');

  const service = createCrmAgentRouteService({
    env: { AI_GATEWAY_API_KEY: 'test-placeholder' },
    readOnlyQuery: async () => [],
    loadMetadata: async () => metadataFixture(),
    createAgent: async () => ({
      available: true,
      agent: { generate: async () => { throw new Error('postgres://user:password@host token=top-secret'); } },
    }),
  });
  let thrown;
  try { await service.chat({ prompt: 'Count leads' }); } catch (error) { thrown = error; }
  const failed = routeErrorBody(thrown);
  assert.equal(failed.status, 502);
  assert.equal(failed.body.reason_code, 'AGENT_GENERATION_FAILED');
  assert.doesNotMatch(JSON.stringify(failed), /postgres|password|top-secret|host/);
});

test('route mounting registers the exact GET status and POST chat handlers with bounded safe responses', async () => {
  const routes = {};
  const app = {
    get(path, handler) { routes[`GET ${path}`] = handler; },
    post(path, handler) { routes[`POST ${path}`] = handler; },
  };
  mountCrmAgentRoutes(app, {
    status: async () => ({ available: false, status: 'Unavailable' }),
    chat: async body => ({ available: true, status: 'Complete', answer: body.prompt, draft_preview: null, bounded: true }),
  });
  assert.deepEqual(Object.keys(routes).sort(), ['GET /api/agent/status', 'POST /api/agent/chat']);
  const response = () => ({
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  });
  const getResponse = response();
  await routes['GET /api/agent/status']({}, getResponse);
  assert.equal(getResponse.body.status, 'Unavailable');
  const postResponse = response();
  await routes['POST /api/agent/chat']({ body: { prompt: 'Hello' }, once() {} }, postResponse);
  assert.equal(postResponse.body.answer, 'Hello');
});
