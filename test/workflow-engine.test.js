'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const runtime = require('../config/workflow-runtime.json');
const {
  WorkflowRuntimeError,
  buildWorkflowRuntimeInventory,
  createMutationPlan,
  evaluateCriteria,
} = require('../lib/workflow-engine');
const { assertLocalAutomationEndpoint } = require('../scripts/build-workflow-runtime');

const eligibleByName = new Map(runtime.rules.filter(rule => rule.plan_status === 'Eligible').map(rule => [rule.name, rule]));

function fieldUpdate(id, field, value, type = 'static') {
  return {
    id,
    name: `Update ${field}`,
    type,
    field: { id: `${id}-field`, api_name: field },
    value,
    module: { id: 'module-1', api_name: 'Leads' },
    source: 'crm',
    associated: true,
    related_module: null,
    dependent_fields: null,
    local_execution: 'Blocked',
  };
}

function rule(id, actions, overrides = {}) {
  return {
    id,
    name: `Rule ${id}`,
    module: { id: 'module-1', api_name: 'Leads' },
    execute_when: { type: 'create', details: { trigger_module: { id: 'module-1', api_name: 'Leads' } } },
    conditions: [{
      id: `${id}-condition`,
      sequence_number: 1,
      criteria_details: { criteria: null, relational_criteria: { module: null, criteria: null, module_selection: null } },
      instant_actions: { actions },
      scheduled_actions: null,
    }],
    status: { active: true },
    ...overrides,
  };
}

function metadata(rules, fieldUpdates = [], functions = []) {
  return {
    automation_synced_at: { at: '2026-08-30T00:00:00.000Z' },
    'automation:workflow_rules': { workflow_rules: rules.map(item => ({ id: item.id, name: item.name })) },
    'automation:workflow_rule_details': { workflow_rules: rules },
    'automation:field_updates': { field_updates: fieldUpdates },
    'automation:functions': { functions },
  };
}

function markVisitRule() {
  return {
    id: '1032257000023782470',
    name: 'Mark Visit Done',
    module: { id: '1032257000022292379', api_name: 'Visit_Module' },
    deprecated: false,
    execute_when: {
      type: 'field_update',
      details: {
        repeat: true,
        criteria: {
          field: { id: '1032257000023782444', api_name: 'Total_Recoads' },
          value: '${ANYVALUE}',
          comparator: '${ANYVALUE}',
        },
        match_all: false,
        trigger_module: { id: '1032257000022292379', api_name: 'Visit_Module' },
      },
    },
    conditions: [{
      id: '1032257000023782471',
      instant_actions: {
        actions: [{ id: '1032257000023782468', name: 'Mark Done Visit', type: 'functions' }],
      },
      sequence_number: 1,
      criteria_details: {
        criteria: null,
        relational_criteria: { module: null, criteria: null, module_selection: null },
      },
      scheduled_actions: null,
    }],
    status: { active: true },
  };
}

function markVisitFunction() {
  return {
    id: '1032257000023782453',
    name: 'Mark Done Visit',
    api_name: 'markdonevisit',
    category: 'Automation',
    language: 'Deluge',
    runtime: 'Deluge 1.0',
    state: 'active',
    return_type: 'void',
    rest_api_mode: ['None'],
    has_draft: false,
    source: 'crm',
    arguments: [
      { name: 'Id', type: 'int' },
      { name: 'recoadcount', type: 'Float' },
      { name: 'teamCount', type: 'int' },
    ],
  };
}

test('captured workflow inventory is exactly reconciled and remains plan-only', () => {
  assert.deepEqual({
    listed: runtime.coverage.listed_rules,
    detailed: runtime.coverage.detailed_rules,
    active: runtime.coverage.active_rules,
    inactive: runtime.coverage.inactive_rules,
    eligible: runtime.coverage.plan_eligible_active_rules,
    blockedActive: runtime.coverage.blocked_active_rules,
    writeEnabled: runtime.coverage.runtime_write_enabled_rules,
    mutations: runtime.coverage.eligible_field_mutation_count,
    adapters: runtime.coverage.eligible_function_adapter_count,
  }, {
    listed: 44,
    detailed: 44,
    active: 39,
    inactive: 5,
    eligible: 4,
    blockedActive: 35,
    writeEnabled: 0,
    mutations: 4,
    adapters: 1,
  });
  assert.equal(runtime.coverage.missing_referenced_field_update_definitions, 1);
  assert.equal(runtime.rules.length, 44);
  assert.ok(runtime.rules.every(rule => rule.write_execution === 'Blocked'));
  assert.equal(runtime.runtime_boundary.source_calls_enabled, false);
  assert.equal(runtime.runtime_boundary.source_writes_enabled, false);
  assert.equal(runtime.runtime_boundary.local_writes_enabled, false);
  assert.equal(runtime.runtime_boundary.outbound_delivery_enabled, false);
});

test('only four fully reviewed deterministic rules expose plans', () => {
  assert.deepEqual([...eligibleByName.keys()].sort(), [
    'Set Last Services Date',
    'Update Expected Closing Date Change Counter',
    'set lead qualified date',
    'updateFormFilledDate',
  ]);
  for (const blocked of runtime.rules.filter(rule => rule.plan_status === 'Blocked')) {
    assert.equal(Object.prototype.hasOwnProperty.call(blocked, 'trigger'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(blocked, 'conditions'), false);
    assert.ok(blocked.block_reasons.length > 0);
  }
});

test('a mixed supported and unsupported rule is blocked as one unit', () => {
  const update = fieldUpdate('field-update-1', 'Lead_Status', 'Qualified');
  const mixed = rule('mixed-rule', [
    { id: update.id, name: update.name, type: 'field_updates' },
    { id: 'webhook-1', name: 'Notify', type: 'webhooks' },
  ]);
  const output = buildWorkflowRuntimeInventory(metadata([mixed], [update]), { generatedAt: '2026-08-30T00:00:00.000Z' });
  const built = output.rules[0];
  assert.equal(built.plan_status, 'Blocked');
  assert.ok(built.block_reasons.some(reason => reason.code === 'OUTBOUND_ACTION_UNSUPPORTED'));
  assert.equal(Object.prototype.hasOwnProperty.call(built, 'conditions'), false);
  assert.equal(output.coverage.plan_eligible_active_rules, 0);
  assert.equal(output.coverage.runtime_write_enabled_rules, 0);
});

test('identity-dependent criteria block a rule even when its field update is simple', () => {
  const update = fieldUpdate('field-update-1', 'Teams', 'Team A');
  const identityRule = rule('identity-rule', [{ id: update.id, name: update.name, type: 'field_updates' }]);
  identityRule.conditions[0].criteria_details.criteria = {
    field: { id: 'owner-field', api_name: 'Owner' },
    comparator: 'equal',
    type: 'value',
    value: { id: 'user-1', name: 'A User' },
  };
  const built = buildWorkflowRuntimeInventory(metadata([identityRule], [update])).rules[0];
  assert.equal(built.plan_status, 'Blocked');
  assert.ok(built.block_reasons.some(reason => reason.code === 'IDENTITY_CRITERIA_UNSUPPORTED'));
});

test('criteria evaluator handles exact groups and fails closed for unknown operators', () => {
  const criteria = {
    kind: 'all',
    criteria: [
      { kind: 'criterion', field: 'Stage', operator: 'equal', value: 'Qualified' },
      {
        kind: 'any',
        criteria: [
          { kind: 'criterion', field: 'Priority', operator: 'equal', value: 'High' },
          { kind: 'criterion', field: 'Priority', operator: 'equal', value: 'Highest' },
        ],
      },
    ],
  };
  assert.equal(evaluateCriteria(criteria, { record: { Stage: 'Qualified', Priority: 'Highest' } }), true);
  assert.equal(evaluateCriteria(criteria, { record: { Stage: 'Qualified', Priority: 'Low' } }), false);
  assert.equal(evaluateCriteria({ kind: 'criterion', field: 'Stage', operator: 'regex', value: '.*' }, { record: { Stage: 'Qualified' } }), false);
});

test('create rule produces a deterministic execution-day mutation plan without writes', () => {
  const ruleDefinition = eligibleByName.get('set lead qualified date');
  const event = {
    event_id: 'event-create-1',
    record_id: 'record-1',
    type: 'create',
    module: 'Contacts',
    origin: 'user',
    occurred_at: '2026-08-30T20:00:00.000Z',
    before: {},
    after: {},
  };
  const first = createMutationPlan(ruleDefinition, event);
  const second = createMutationPlan(ruleDefinition, event);
  assert.deepEqual(first, second);
  assert.equal(first.status, 'Planned');
  assert.equal(first.mutations[0].field, 'Lead_Qualified_Date1');
  assert.equal(first.mutations[0].value, '2026-08-31');
  assert.match(first.idempotency_key, /^workflow:[a-f0-9]{64}$/);
  assert.equal(first.source_calls, false);
  assert.equal(first.source_writes, false);
  assert.equal(first.local_writes, false);
});

test('non-repeating field-update rule requires change evidence and execution history', () => {
  const ruleDefinition = eligibleByName.get('updateFormFilledDate');
  const event = {
    event_id: 'event-update-1',
    record_id: 'deal-1',
    type: 'update',
    module: 'Deals',
    origin: 'user',
    occurred_at: '2026-08-30T20:00:00.000Z',
    before: { Stage: 'Qualification' },
    after: { Stage: 'Form Filled' },
  };
  assert.throws(() => createMutationPlan(ruleDefinition, event), error => error instanceof WorkflowRuntimeError && error.code === 'WORKFLOW_EXECUTION_HISTORY_REQUIRED');
  const planned = createMutationPlan(ruleDefinition, { ...event, previously_executed: false });
  assert.equal(planned.status, 'Planned');
  assert.equal(planned.mutations[0].value, '2026-08-31T01:30:00+05:30');
  assert.equal(createMutationPlan(ruleDefinition, { ...event, previously_executed: true }).reason, 'repeat_suppressed');
  assert.equal(createMutationPlan(ruleDefinition, {
    ...event,
    event_id: 'event-no-change',
    before: { Stage: 'Form Filled' },
    previously_executed: false,
  }).reason, 'trigger_not_matched');
});

test('merge-field rule copies the captured record value into both ordered mutations', () => {
  const ruleDefinition = eligibleByName.get('Set Last Services Date');
  const plan = createMutationPlan(ruleDefinition, {
    event_id: 'event-service-1',
    record_id: 'contact-1',
    type: 'update',
    module: 'Contacts',
    origin: 'user',
    occurred_at: '2026-08-30T12:00:00.000Z',
    before: { First_Service_Date: '2026-08-01' },
    after: { First_Service_Date: '2026-08-30' },
  });
  assert.equal(plan.status, 'Planned');
  assert.deepEqual(plan.mutations.map(item => [item.order, item.field, item.value]), [
    [1, 'Last_Service_Date', '2026-08-30'],
    [2, 'Next_Service_Date', '2026-08-30'],
  ]);
});

test('reviewed counter function adapter produces one bounded deterministic mutation without writes', () => {
  const ruleDefinition = eligibleByName.get('Update Expected Closing Date Change Counter');
  const event = {
    event_id: 'event-close-date-1',
    record_id: 'contact-1',
    type: 'update',
    module: 'Contacts',
    origin: 'user',
    occurred_at: '2026-08-30T12:00:00.000Z',
    before: { Est_Closoure_Date: '2026-09-01', Expected_Closing_Date_Change_Counter: 4 },
    after: { Est_Closoure_Date: '2026-09-15', Expected_Closing_Date_Change_Counter: 4 },
  };
  const plan = createMutationPlan(ruleDefinition, event);
  assert.equal(plan.status, 'Planned');
  assert.deepEqual(plan.mutations, [{
    order: 1,
    action_id: '1032257000016568150',
    operation: 'set_field',
    field: 'Expected_Closing_Date_Change_Counter',
    value: 5,
  }]);
  assert.equal(plan.function_adapters.length, 1);
  assert.equal(plan.function_adapters[0].adapter, 'increment_integer_field_v1');
  assert.equal(plan.source_calls, false);
  assert.equal(plan.source_writes, false);
  assert.equal(plan.local_writes, false);

  const initialized = createMutationPlan(ruleDefinition, {
    ...event,
    event_id: 'event-close-date-2',
    after: { ...event.after, Expected_Closing_Date_Change_Counter: null },
  });
  assert.equal(initialized.mutations[0].value, 1);

  for (const invalid of [undefined, '4', 4.5, -1, 999999999]) {
    const after = { ...event.after };
    if (invalid === undefined) delete after.Expected_Closing_Date_Change_Counter;
    else after.Expected_Closing_Date_Change_Counter = invalid;
    assert.throws(
      () => createMutationPlan(ruleDefinition, { ...event, event_id: `invalid-${String(invalid)}`, after }),
      error => error instanceof WorkflowRuntimeError
        && ['WORKFLOW_FUNCTION_FIELD_VALUE_MISSING', 'WORKFLOW_FUNCTION_FIELD_VALUE_INVALID'].includes(error.code),
    );
  }

  const drifted = JSON.parse(JSON.stringify(ruleDefinition));
  drifted.conditions[0].function_adapter_plan[0].field = 'Another_Counter';
  assert.throws(
    () => createMutationPlan(drifted, event),
    error => error instanceof WorkflowRuntimeError && error.code === 'WORKFLOW_FUNCTION_ADAPTER_CONTRACT_DRIFT',
  );
});

test('Mark Visit Done remains blocked without authoritative parameter-to-field bindings', () => {
  const exact = buildWorkflowRuntimeInventory(metadata([markVisitRule()], [], [markVisitFunction()]));
  assert.equal(exact.runtime_boundary.function_adapters_registered, 2);
  assert.equal(exact.rules[0].plan_status, 'Blocked');
  assert.deepEqual(exact.rules[0].block_reasons, [{
    code: 'FUNCTION_PARAMETER_BINDING_UNVERIFIED',
    message: 'The captured workflow action does not expose authoritative function parameter-to-field bindings.',
  }]);
  const mirrored = runtime.rules.find(item => item.id === '1032257000023782470');
  assert.equal(mirrored.plan_status, 'Blocked');
  assert.throws(
    () => createMutationPlan(mirrored, {
      event_id: 'event-mark-visit-blocked', record_id: 'visit-1', type: 'update', module: 'Visit_Module', origin: 'user',
      occurred_at: '2026-08-30T12:00:00.000Z', before: { Total_Recoads: 1 },
      after: { Total_Recoads: 2, Assigned_Team_Member_Count: 2 },
    }),
    error => error instanceof WorkflowRuntimeError && error.code === 'WORKFLOW_RULE_BLOCKED',
  );

  const definitionDrift = markVisitFunction();
  definitionDrift.arguments[1].name = 'recoad_count';
  const blockedDefinition = buildWorkflowRuntimeInventory(metadata([markVisitRule()], [], [definitionDrift])).rules[0];
  assert.ok(blockedDefinition.block_reasons.some(reason => reason.code === 'FUNCTION_DEFINITION_CONTRACT_DRIFT'));

  const triggerDrift = markVisitRule();
  triggerDrift.execute_when.details.repeat = false;
  const blockedTrigger = buildWorkflowRuntimeInventory(metadata([triggerDrift], [], [markVisitFunction()])).rules[0];
  assert.ok(blockedTrigger.block_reasons.some(reason => reason.code === 'FUNCTION_ADAPTER_CONTRACT_DRIFT'));
});

test('workflow planning snapshots outer rule, event, and record descriptors once before validation', () => {
  const ruleDefinition = eligibleByName.get('Update Expected Closing Date Change Counter');
  const safeAfter = { Est_Closoure_Date: '2026-09-15', Expected_Closing_Date_Change_Counter: 4 };
  const swappedAfter = { Est_Closoure_Date: '2026-09-15', Expected_Closing_Date_Change_Counter: 999999999 };
  const base = {
    event_id: 'event-counter-snapshot',
    record_id: 'contact-1',
    type: 'update',
    module: 'Contacts',
    origin: 'user',
    occurred_at: '2026-08-30T12:00:00.000Z',
    before: { Est_Closoure_Date: '2026-09-01', Expected_Closing_Date_Change_Counter: 4 },
    after: safeAfter,
  };

  let eventGetterReads = 0;
  const accessorEvent = { ...base };
  Object.defineProperty(accessorEvent, 'after', {
    enumerable: true,
    get() { eventGetterReads += 1; return eventGetterReads === 1 ? safeAfter : swappedAfter; },
  });
  assert.throws(
    () => createMutationPlan(ruleDefinition, accessorEvent),
    error => error instanceof WorkflowRuntimeError && error.code === 'WORKFLOW_EVENT_SHAPE_INVALID',
  );
  assert.equal(eventGetterReads, 0);

  let eventProxyGets = 0;
  const proxyEvent = new Proxy(base, {
    get(target, property, receiver) {
      if (property === 'after') eventProxyGets += 1;
      return Reflect.get(target, property, receiver);
    },
  });
  const plan = createMutationPlan(ruleDefinition, proxyEvent);
  assert.equal(eventProxyGets, 0);
  assert.equal(plan.mutations[0].value, 5);

  let ruleGetterReads = 0;
  const accessorRule = { ...ruleDefinition };
  Object.defineProperty(accessorRule, 'conditions', {
    enumerable: true,
    get() { ruleGetterReads += 1; return ruleDefinition.conditions; },
  });
  assert.throws(
    () => createMutationPlan(accessorRule, base),
    error => error instanceof WorkflowRuntimeError && error.code === 'WORKFLOW_RULE_SHAPE_INVALID',
  );
  assert.equal(ruleGetterReads, 0);
});

test('blocked rules and recursive events cannot produce mutation plans', () => {
  const blocked = runtime.rules.find(rule => rule.source_active && rule.plan_status === 'Blocked');
  assert.throws(() => createMutationPlan(blocked, {
    event_id: 'event-1', record_id: 'record-1', occurred_at: '2026-08-30T00:00:00Z',
  }), error => error instanceof WorkflowRuntimeError && error.code === 'WORKFLOW_RULE_BLOCKED');
  assert.throws(() => createMutationPlan(eligibleByName.get('set lead qualified date'), {
    event_id: 'event-2', record_id: 'record-2', type: 'create', module: 'Contacts', origin: 'workflow', depth: 1,
    occurred_at: '2026-08-30T00:00:00Z', before: {}, after: {},
  }), error => error instanceof WorkflowRuntimeError && error.code === 'WORKFLOW_RECURSION_BLOCKED');
});

test('builder refuses incomplete rule/detail reconciliation and non-local endpoints', () => {
  const update = fieldUpdate('field-update-1', 'Lead_Status', 'Qualified');
  const complete = rule('rule-1', [{ id: update.id, name: update.name, type: 'field_updates' }]);
  const broken = metadata([complete], [update]);
  broken['automation:workflow_rule_details'].workflow_rules = [];
  assert.throws(() => buildWorkflowRuntimeInventory(broken), /Both the workflow list and detailed rule collection are required/);
  assert.doesNotThrow(() => assertLocalAutomationEndpoint('http://127.0.0.1:3100/api/meta/automation'));
  assert.throws(() => assertLocalAutomationEndpoint('https://example.invalid/api/meta/automation'), /exact local/);
  assert.throws(() => assertLocalAutomationEndpoint('http://127.0.0.1:3100/api/meta/automation?write=1'), /exact local/);
});
