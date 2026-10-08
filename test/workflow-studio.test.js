'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const runtime = require('../config/workflow-runtime.json');
const { buildWorkflowStudioCatalog } = require('../lib/workflow-studio');

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

test('builds an immutable, reconciled 44-rule Workflow Studio catalog', () => {
  const catalog = buildWorkflowStudioCatalog(runtime);
  assert.deepEqual({
    total: catalog.aggregates.total_rules,
    detailed: catalog.aggregates.detailed_rules,
    active: catalog.aggregates.active_rules,
    inactive: catalog.aggregates.inactive_rules,
    eligible: catalog.aggregates.eligible_plan_only_rules,
    blockedActive: catalog.aggregates.blocked_active_rules,
    conditions: catalog.aggregates.eligible_conditions,
    mutations: catalog.aggregates.planned_field_mutations,
    adapters: catalog.aggregates.function_adapters,
    writeEnabled: catalog.aggregates.runtime_write_enabled_rules,
  }, {
    total: 44,
    detailed: 44,
    active: 39,
    inactive: 5,
    eligible: 4,
    blockedActive: 35,
    conditions: 4,
    mutations: 4,
    adapters: 1,
    writeEnabled: 0,
  });
  assert.equal(new Set(catalog.rules.map(rule => rule.id)).size, 44);
  assert.equal(Object.isFrozen(catalog), true);
  assert.equal(Object.isFrozen(catalog.rules), true);
  assert.ok(catalog.rules.every(rule => Object.isFrozen(rule.execution)));
});

test('preserves exact triggers, conditions, four field templates, and one eligible reviewed adapter for four eligible rules', () => {
  const catalog = buildWorkflowStudioCatalog(runtime);
  const eligible = catalog.rules.filter(rule => rule.studio_status === 'Eligible plan only');
  assert.deepEqual(eligible.map(rule => [rule.id, rule.name, rule.module]), [
    ['1032257000022813289', 'Set Last Services Date', 'Contacts'],
    ['1032257000004081038', 'set lead qualified date', 'Contacts'],
    ['1032257000016568154', 'Update Expected Closing Date Change Counter', 'Contacts'],
    ['1032257000013277102', 'updateFormFilledDate', 'Deals'],
  ]);
  for (const rule of eligible) {
    const source = runtime.rules.find(item => item.id === rule.id);
    assert.equal(rule.plan_status, source.plan_status);
    assert.equal(rule.write_execution, source.write_execution);
    assert.deepEqual(rule.trigger, source.trigger);
    assert.deepEqual(rule.conditions, source.conditions);
    assert.equal(rule.definition_available, true);
    assert.deepEqual(rule.block_reasons, []);
  }
  assert.deepEqual(eligible.flatMap(rule => rule.planned_field_mutations.map(mutation => [
    rule.id,
    mutation.condition_sequence,
    mutation.order,
    mutation.field,
    mutation.value,
  ])), [
    ['1032257000022813289', 1, 1, 'Last_Service_Date', { kind: 'record_field', field: 'First_Service_Date' }],
    ['1032257000022813289', 1, 2, 'Next_Service_Date', { kind: 'record_field', field: 'First_Service_Date' }],
    ['1032257000004081038', 1, 1, 'Lead_Qualified_Date1', { kind: 'execution_date', offset_days: 0 }],
    ['1032257000013277102', 1, 1, 'Form_Filled_Date_Time', { kind: 'execution_datetime', offset_days: 0 }],
  ]);
  const counter = eligible.find(rule => rule.id === '1032257000016568154');
  assert.deepEqual(counter.planned_function_adapters, [{
    condition_sequence: 1,
    order: 1,
    action_id: '1032257000016568150',
    action_name: 'Update Expected Closing Date Change Counter',
    adapter: 'increment_integer_field_v1',
    operation: 'increment_field',
    field: 'Expected_Closing_Date_Change_Counter',
    default_value: 0,
    increment: 1,
    minimum_current: 0,
    maximum_current: 999999998,
  }]);
});

test('exposes exact block reasons while withholding unavailable definitions', () => {
  const catalog = buildWorkflowStudioCatalog(runtime);
  const blockedActive = catalog.rules.filter(rule => rule.studio_status === 'Blocked active');
  const inactive = catalog.rules.filter(rule => rule.studio_status === 'Inactive');
  assert.equal(blockedActive.length, 35);
  assert.equal(inactive.length, 5);
  for (const rule of [...blockedActive, ...inactive]) {
    const source = runtime.rules.find(item => item.id === rule.id);
    assert.equal(rule.plan_status, source.plan_status);
    assert.equal(rule.write_execution, source.write_execution);
    assert.deepEqual(rule.block_reasons, source.block_reasons);
    assert.equal(rule.definition_available, false);
    assert.equal(rule.trigger, null);
    assert.deepEqual(rule.conditions, []);
    assert.deepEqual(rule.planned_field_mutations, []);
    assert.deepEqual(rule.planned_function_adapters, []);
  }
  assert.ok(blockedActive.every(rule => rule.block_reasons.every(reason => reason.code !== 'RULE_INACTIVE')));
  assert.ok(inactive.every(rule => rule.block_reasons.length === 1 && rule.block_reasons[0].code === 'RULE_INACTIVE'));
  assert.deepEqual(catalog.aggregates.inactive_reason_counts, { RULE_INACTIVE: 5 });
  assert.deepEqual(catalog.aggregates.blocked_active_reason_counts, runtime.coverage.blocked_active_reason_counts);
  const markVisit = blockedActive.find(rule => rule.id === '1032257000023782470');
  assert.deepEqual(markVisit?.block_reasons, [{
    code: 'FUNCTION_PARAMETER_BINDING_UNVERIFIED',
    message: 'The captured workflow action does not expose authoritative function parameter-to-field bindings.',
  }]);
});

test('keeps every action fail-closed and emits no records, credentials, targets, or private paths', () => {
  const catalog = buildWorkflowStudioCatalog(runtime);
  assert.ok(catalog.rules.every(rule => rule.execution.status === 'Blocked'
    && rule.execution.enabled === false
    && rule.execution.source_calls === false
    && rule.execution.source_writes === false
    && rule.execution.local_writes === false
    && rule.execution.outbound_delivery === false));
  assert.deepEqual(catalog.privacy, {
    crm_records_included: false,
    credentials_included: false,
    private_paths_included: false,
    external_targets_included: false,
    source_code_included: false,
  });
  const serialized = JSON.stringify(catalog);
  assert.doesNotMatch(serialized, /https?:\/\/|\/Users\/|\.private\/|bearer\s|password\s*[:=]|api[_ -]?key\s*[:=]/i);
  assert.equal(Object.prototype.hasOwnProperty.call(catalog, 'evidence'), false);
});

test('derives stable module aggregates without mutating the source input', () => {
  const input = copy(runtime);
  const before = JSON.stringify(input);
  const first = buildWorkflowStudioCatalog(input);
  const second = buildWorkflowStudioCatalog(input);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(first, second);
  assert.deepEqual(first.aggregates.modules, [
    { module: 'Calls', total_rules: 3, active_rules: 3, inactive_rules: 0, eligible_plan_only: 0, blocked_active: 3 },
    { module: 'Contacts', total_rules: 18, active_rules: 18, inactive_rules: 0, eligible_plan_only: 3, blocked_active: 15 },
    { module: 'Deals', total_rules: 5, active_rules: 3, inactive_rules: 2, eligible_plan_only: 1, blocked_active: 2 },
    { module: 'Emails', total_rules: 1, active_rules: 1, inactive_rules: 0, eligible_plan_only: 0, blocked_active: 1 },
    { module: 'Leads', total_rules: 15, active_rules: 13, inactive_rules: 2, eligible_plan_only: 0, blocked_active: 13 },
    { module: 'Tasks', total_rules: 1, active_rules: 0, inactive_rules: 1, eligible_plan_only: 0, blocked_active: 0 },
    { module: 'Visit_Module', total_rules: 1, active_rules: 1, inactive_rules: 0, eligible_plan_only: 0, blocked_active: 1 },
  ]);
});

test('fails closed on count, identity, definition, status, or sensitive-shape drift', () => {
  const badCoverage = copy(runtime);
  badCoverage.coverage.active_rules = 38;
  assert.throws(() => buildWorkflowStudioCatalog(badCoverage), /coverage\.active_rules does not reconcile/);

  const duplicate = copy(runtime);
  duplicate.rules[1].id = duplicate.rules[0].id;
  assert.throws(() => buildWorkflowStudioCatalog(duplicate), /identity drifted/);

  const changedReason = copy(runtime);
  changedReason.rules[0].block_reasons[0].message = 'A plausible but non-authoritative reason.';
  assert.throws(() => buildWorkflowStudioCatalog(changedReason), /reconciled block reason/);

  const changedMutation = copy(runtime);
  const eligible = changedMutation.rules.find(rule => rule.id === '1032257000013277102');
  eligible.conditions[0].field_update_plan[0].field = 'Stage';
  assert.throws(() => buildWorkflowStudioCatalog(changedMutation), /conditions drifted/);

  const changedAdapter = copy(runtime);
  const adapterRule = changedAdapter.rules.find(rule => rule.id === '1032257000016568154');
  adapterRule.conditions[0].function_adapter_plan[0].maximum_current = 999999999;
  assert.throws(() => buildWorkflowStudioCatalog(changedAdapter), /conditions drifted/);

  const enabled = copy(runtime);
  enabled.runtime_boundary.local_writes_enabled = true;
  assert.throws(() => buildWorkflowStudioCatalog(enabled), /local_writes_enabled must remain false/);

  const extraSensitiveShape = copy(runtime);
  extraSensitiveShape.credentials = { password: 'not-allowed' };
  assert.throws(() => buildWorkflowStudioCatalog(extraSensitiveShape), /unsupported or missing property/);

  const privatePath = copy(runtime);
  privatePath.rules[0].name = '/Users/example/private-rule';
  assert.throws(() => buildWorkflowStudioCatalog(privatePath), /identity drifted/);
});
