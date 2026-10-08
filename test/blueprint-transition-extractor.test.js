'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const blueprintConfig = require('../config/blueprints.json');
const phaseDetails = require('../config/blueprint-transition-details.json');
const executionPolicies = require('../config/blueprint-execution-policies.json');

const {
  MAX_BATCH_SIZE,
  ExtractionError,
  chunk,
  crmGet,
  mergePublicPhaseConfig,
  normalizeTransition,
  parseArgs,
  reconcileTransitionDetails,
} = require('../scripts/extract-blueprint-transition-phases');

const manifestEntry = {
  id: '1001',
  blueprint_id: '5001',
  blueprint_name: 'Synthetic Blueprint',
  module: 'Contacts',
  accepted_api_modules: ['Contacts'],
  graph: { name: 'Qualify', global: false, relationship_id: '9001' },
};

const syntheticTransition = () => ({
  id: '1001',
  process_id: '5001',
  name: 'Qualify',
  api_name: 'Qualify',
  trigger_type: 'manual',
  transition_type: 'standalone_transition',
  global: false,
  module: { api_name: 'Contacts', id: '3001' },
  owners: [{ type: 'record_owner', resources: [] }],
  criteria: {
    field: { id: '7001', api_name: 'Stage' },
    comparator: 'equal',
    value: 'Ready',
  },
  during_inputs: [
    {
      id: '8002',
      type: 'field',
      optional: false,
      sequence_number: 2,
      field: { id: '7102', api_name: 'Budget', field_label: 'Budget', data_type: 'currency' },
      validation_filter: { comparator: 'greater_than', value: 0 },
    },
    {
      id: '8001',
      type: 'associated_item',
      optional: true,
      sequence_number: 1,
      field: { id: '7101', api_name: 'Notes', field_label: 'Notes', data_type: 'textarea' },
    },
    {
      id: '8003',
      type: 'checklist',
      optional: false,
      sequence_number: 3,
      checklist_info: { title: 'Confirm', items: [{ id: '1', name: 'Budget confirmed' }] },
    },
  ],
  actions: [{
    id: '8101',
    type: 'webhook',
    name: 'Notify external system',
    details: {
      method: 'POST',
      url: 'https://example.invalid/hook',
      headers: { Authorization: 'Bearer secret-token' },
      nested: { token: 'secret-token', safe_setting: 'retained' },
    },
  }],
});

test('normalizer maps Before, During, and After phases into canonical blocked definitions', () => {
  const normalized = normalizeTransition(syntheticTransition(), manifestEntry);
  assert.equal(normalized.name, 'Qualify');
  assert.equal(normalized.local_execution, 'Blocked');
  assert.deepEqual(normalized.before.owners, ['Record Owner']);
  assert.deepEqual(normalized.before.criteria, [{ field: 'Stage', operator: 'equal', value: 'Ready' }]);
  assert.equal(normalized.before.criteria_logic_supported, true);
  assert.deepEqual(normalized.during_inputs.map(input => input.api_name), ['Notes', 'Budget', null]);
  assert.deepEqual(normalized.during_inputs.map(input => input.required), [false, true, true]);
  assert.equal(normalized.during_inputs[2].kind, 'checklist');
  assert.equal(normalized.after_actions[0].type, 'webhook');
  assert.equal(normalized.after_actions[0].details.method, 'POST');
  assert.equal(normalized.after_actions[0].details.nested.safe_setting, 'retained');
});

test('normalizer removes external targets and credential-shaped action details', () => {
  const serialized = JSON.stringify(normalizeTransition(syntheticTransition(), manifestEntry));
  assert.doesNotMatch(serialized, /https?:\/\//i);
  assert.doesNotMatch(serialized, /secret-token|authorization|headers|\"token\"/i);
  assert.match(serialized, /safe_setting/);
});

test('normalizer refuses to call missing phase keys an empty phase', () => {
  const incomplete = syntheticTransition();
  delete incomplete.actions;
  assert.throws(() => normalizeTransition(incomplete, manifestEntry), error => {
    assert.ok(error instanceof ExtractionError);
    assert.equal(error.code, 'PHASE_METADATA_INCOMPLETE');
    assert.deepEqual(error.details.missing_keys, ['actions']);
    return true;
  });
});

test('exact reconciliation rejects missing, duplicate, unexpected, and wrong-process IDs', () => {
  const manifest = {
    targets: [{ blueprint_id: '5001', name: 'Synthetic Blueprint', module: 'Contacts', transition_count: 2 }],
    entries: [manifestEntry, { ...manifestEntry, id: '1002' }],
  };
  const first = syntheticTransition();
  assert.throws(() => reconcileTransitionDetails([first], manifest), error => error.code === 'TRANSITION_RECONCILIATION_FAILED');
  assert.throws(() => reconcileTransitionDetails([first, first], manifest), error => error.code === 'TRANSITION_RECONCILIATION_FAILED');
  assert.throws(() => reconcileTransitionDetails([first, { ...syntheticTransition(), id: '9999' }], manifest), error => error.code === 'TRANSITION_RECONCILIATION_FAILED');
  assert.throws(() => reconcileTransitionDetails([first, { ...syntheticTransition(), id: '1002', process_id: 'wrong' }], manifest), error => error.code === 'TRANSITION_PROCESS_MISMATCH');
});

test('163 target transitions are split into four batches of at most 50', () => {
  const batches = chunk(Array.from({ length: 163 }, (_, index) => index));
  assert.deepEqual(batches.map(batch => batch.length), [50, 50, 50, 13]);
  assert.ok(batches.every(batch => batch.length <= MAX_BATCH_SIZE));
});

test('CRM transport is hard-coded to GET and rejects absolute or non-CRM paths', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ transitions: [] }) };
  };
  await crmGet('https://www.zohoapis.in', '/crm/v8/org', 'test-token', fetchImpl);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, 'GET');
  await assert.rejects(() => crmGet('https://www.zohoapis.in', 'https://example.invalid/crm/v8/org', 'test-token', fetchImpl), /relative \/crm\//);
  await assert.rejects(() => crmGet('https://www.zohoapis.in', '/books/v3/org', 'test-token', fetchImpl), /relative \/crm\//);
});

test('public config write remains opt-in and merge keeps unrelated Blueprints', () => {
  assert.equal(parseArgs([]).writePublicConfig, false);
  assert.equal(parseArgs(['--write-public-config']).writePublicConfig, true);
  const current = {
    version: 1,
    generated_at: 'old',
    source_mode: 'read-only-ui-inspection',
    blueprints: { keep: { name: 'Keep', module: 'Leads', transitions: { existing: {} } } },
  };
  const preview = {
    generated_at: 'new',
    blueprints: {
      '5001': {
        name: 'Synthetic Blueprint',
        module: 'Contacts',
        phase_coverage: 'Specified',
        transitions: { '1001': normalizeTransition(syntheticTransition(), manifestEntry) },
      },
    },
  };
  const merged = mergePublicPhaseConfig(current, preview);
  assert.ok(merged.blueprints.keep);
  assert.ok(merged.blueprints['5001']);
  assert.equal(merged.blueprints['5001'].transitions['1001'].local_execution, 'Blocked');
  assert.deepEqual(merged.blueprints['5001'].transitions['1001'].before.owner_details, [{ type: 'record_owner', resource_count: 0 }]);
});

test('reviewed execution survives an exact evidence refresh and drifts back to blocked', () => {
  const blueprintId = '1032257000001044611';
  const transitionId = '1032257000001044561';
  const definition = phaseDetails.blueprints[blueprintId].transitions[transitionId];
  const current = { version: 1, blueprints: {} };
  const preview = {
    generated_at: 'new',
    blueprints: {
      [blueprintId]: {
        name: 'Opportunity Stage',
        module: 'Contacts',
        phase_coverage: 'Specified: 83 of 83 transitions',
        transitions: { [transitionId]: { ...definition, local_execution: 'Blocked', block_reason: 'Refreshed evidence defaults to blocked.' } },
      },
    },
  };
  const exact = mergePublicPhaseConfig(current, preview, { executionPolicies, blueprintConfig });
  assert.equal(exact.blueprints[blueprintId].transitions[transitionId].local_execution, 'Implemented');
  assert.equal(exact.blueprints[blueprintId].transitions[transitionId].block_reason, null);

  preview.blueprints[blueprintId].transitions[transitionId] = {
    ...preview.blueprints[blueprintId].transitions[transitionId],
    after_actions: [{ type: 'webhook' }],
  };
  const drifted = mergePublicPhaseConfig(current, preview, { executionPolicies, blueprintConfig });
  assert.equal(drifted.blueprints[blueprintId].transitions[transitionId].local_execution, 'Blocked');
});
