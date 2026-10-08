'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const blueprints = require('../config/blueprints.json');
const details = require('../config/blueprint-transition-details.json');
const policies = require('../config/blueprint-execution-policies.json');
const {
  executionPolicyDecision,
  transitionExecutionContract,
  validatePolicyConfig,
} = require('../lib/blueprint-execution-policy');

function configuredTransition(blueprintId, transitionId) {
  const blueprint = blueprints.blueprints.find(item => String(item.id) === String(blueprintId));
  const transition = blueprint.transitions.find(item => String(item.id) === String(transitionId));
  const definition = details.blueprints[String(blueprintId)].transitions[String(transitionId)];
  return { blueprint, transition, definition };
}

test('reviewed Blueprint execution policies match every implemented transition exactly', () => {
  validatePolicyConfig(policies);
  const implemented = [];
  for (const blueprint of blueprints.blueprints) {
    for (const transition of blueprint.transitions) {
      const definition = details.blueprints[String(blueprint.id)]?.transitions?.[String(transition.id)];
      if (definition?.local_execution === 'Implemented') implemented.push({ blueprint, transition, definition });
    }
  }
  assert.equal(implemented.length, 5);
  assert.equal(policies.policies.length, implemented.length);
  assert.deepEqual(new Set(implemented.map(({ blueprint, transition }) => `${blueprint.id}:${transition.id}`)), new Set([
    '1032257000000416697:1032257000009279001',
    '1032257000000416697:1032257000009322035',
    '1032257000001044611:1032257000001044557',
    '1032257000001044611:1032257000001044561',
    '1032257000001044611:1032257000001044845',
  ]));
  implemented.forEach(({ blueprint, transition, definition }) => {
    assert.deepEqual(executionPolicyDecision(policies, blueprint, transition, definition), { approved: true, reason: null });
  });
});

test('an unreviewed transition remains denied even if its phase flag is changed', () => {
  const { blueprint, transition, definition } = configuredTransition('1032257000001044611', '1032257000001044565');
  assert.equal(executionPolicyDecision(policies, blueprint, transition, { ...definition, local_execution: 'Implemented' }).approved, false);
});

test('contract drift reblocks a reviewed transition', () => {
  const { blueprint, transition, definition } = configuredTransition('1032257000001044611', '1032257000001044845');
  assert.equal(executionPolicyDecision(policies, blueprint, transition, { ...definition, after_actions: [{ type: 'webhook' }] }).approved, false);
  assert.equal(executionPolicyDecision(policies, blueprint, { ...transition, to: { ...transition.to, display_value: 'Changed' } }, definition).approved, false);
});

test('Raw Quotation contract drift fails closed', () => {
  const { blueprint, transition, definition } = configuredTransition('1032257000001044611', '1032257000001044557');
  const optionalDate = {
    ...definition,
    during_inputs: definition.during_inputs.map(input => input.api_name === 'Next_Follow_UP_Date' ? { ...input, required: false } : input),
  };
  assert.equal(executionPolicyDecision(policies, blueprint, transition, optionalDate).approved, false);
  assert.equal(executionPolicyDecision(policies, blueprint, transition, { ...definition, after_actions: [{ type: 'field_update' }] }).approved, false);
  assert.equal(executionPolicyDecision(policies, blueprint, { ...transition, from: { ...transition.from, actual_value: 'Changed' } }, definition).approved, false);
});

test('Raw Quotation policy preserves the exact reviewed During contract', () => {
  const { blueprint, transition, definition } = configuredTransition('1032257000001044611', '1032257000001044557');
  const policy = policies.policies.find(item => item.transition_id === String(transition.id));
  assert.deepEqual(transitionExecutionContract(blueprint, transition, definition), policy.contract);
  assert.deepEqual(policy.contract, {
    name: 'Raw Quotation',
    common: false,
    include_all_states: false,
    trigger_type: 'manual',
    from: { actual_value: 'Approve/Disapprove Quote', display_value: 'Approve/Disapprove Quote' },
    to: { actual_value: 'Raw Quote', display_value: 'Raw Quote' },
    before: { owners: ['All Users'], criteria: [] },
    during_inputs: [
      { kind: 'field', api_name: 'Next_Follow_UP_Date', label: 'Follow Up Date', data_type: 'date', required: true },
      { kind: 'field', api_name: 'Amount', label: 'BD Value', data_type: 'integer', required: false },
    ],
    after_actions: [],
  });
});

test('Revised Design Discussion1 policy preserves its exact reviewed zero-input contract', () => {
  const { blueprint, transition, definition } = configuredTransition('1032257000001044611', '1032257000001044845');
  const policy = policies.policies.find(item => item.transition_id === String(transition.id));
  assert.deepEqual(transitionExecutionContract(blueprint, transition, definition), policy.contract);
  assert.deepEqual(policy.contract, {
    name: 'Revised Design Discussion1',
    common: false,
    include_all_states: false,
    trigger_type: 'manual',
    from: { actual_value: 'Revised Design Discussion', display_value: 'Revised Design Discussion' },
    to: { actual_value: 'Revised Design Discussion1', display_value: 'Revised Design Discussion1' },
    before: { owners: ['All Users'], criteria: [] },
    during_inputs: [],
    after_actions: [],
  });
});

test('policy contract contains only execution-relevant source fields', () => {
  const { blueprint, transition, definition } = configuredTransition('1032257000001044611', '1032257000001044561');
  assert.deepEqual(transitionExecutionContract(blueprint, transition, definition), policies.policies.find(item => item.transition_id === String(transition.id)).contract);
  assert.doesNotMatch(JSON.stringify(policies), /https?:\/\/|Zoho-oauthtoken|client_secret|refresh_token|\/Users\//i);
});
