'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../config/blueprints.json');
const phaseDetails = require('../config/blueprint-transition-details.json');

const byId = new Map(config.blueprints.map(blueprint => [String(blueprint.id), blueprint]));

test('public Blueprint config is a sanitized read-only structural graph', () => {
  assert.equal(config.source_mode, 'read-only');
  assert.ok(config.blueprints.length > 0);
  const serialized = JSON.stringify(config);
  assert.doesNotMatch(serialized, /https?:\/\//i);
  assert.doesNotMatch(serialized, /Zoho-oauthtoken|oauth\/v2\/token|client_secret|refresh_token/i);

  for (const blueprint of config.blueprints) {
    assert.equal(typeof blueprint.status, 'string');
    assert.ok(Array.isArray(blueprint.entry_criteria));
    assert.ok(Object.hasOwn(blueprint, 'entry_criteria_tree'));
    assert.ok(Array.isArray(blueprint.states));
    assert.ok(Array.isArray(blueprint.transitions));
    assert.ok(Array.isArray(blueprint.connections));
    for (const transition of blueprint.transitions) {
      assert.ok(Object.hasOwn(transition, 'api_name'));
      assert.ok(Object.hasOwn(transition, 'trigger_type'));
      assert.equal(typeof transition.global, 'boolean');
      assert.ok(Array.isArray(transition.include_states));
    }
  }
});

test('authoritative Blueprint connections reference sanitized states and transitions', () => {
  const authoritative = config.blueprints.filter(blueprint => blueprint.graph_source === 'settings-blueprint-detail');
  assert.ok(authoritative.length > 0);
  for (const blueprint of authoritative) {
    const stateIds = new Set(blueprint.states.map(state => String(state.id)));
    const transitionIds = new Set(blueprint.transitions.map(transition => String(transition.id)));
    assert.equal(transitionIds.size, blueprint.transitions.length);
    for (const connection of blueprint.connections) {
      assert.ok(stateIds.has(String(connection.from_state.id)));
      assert.ok(stateIds.has(String(connection.to_state.id)));
      assert.ok(transitionIds.has(String(connection.transition.id)));
    }
  }
});

test('authoritative entry criteria preserve Zoho field API names and AND grouping', () => {
  const task = byId.get('1032257000000416694');
  const installationVisit = byId.get('1032257000023456624');
  const complaint = byId.get('1032257000023614991');
  assert.deepEqual(task.entry_criteria, [{ field: 'Priority', operator: 'equal', value: 'Highest' }]);
  assert.deepEqual(installationVisit.entry_criteria, [{ field: 'Record_Type', operator: 'equal', value: 'Installation' }]);
  assert.equal(complaint.entry_criteria_tree.group_operator, 'AND');
  assert.deepEqual(complaint.entry_criteria.map(item => item.field), ['Record_Type', 'Complaint_From']);
});

test('captured phase definitions match every transition in seven completed Blueprints', () => {
  const expected = {
    '1032257000001044611': 83,
    '1032257000000416697': 8,
    '1032257000000416694': 5,
    '1032257000000535747': 80,
    '1032257000023456624': 1,
    '1032257000023614991': 10,
    '1032257000023685467': 15,
  };
  assert.equal(Object.keys(phaseDetails.blueprints).length, 7);
  for (const [blueprintId, count] of Object.entries(expected)) {
    const blueprint = byId.get(blueprintId);
    const definedIds = new Set(Object.keys(phaseDetails.blueprints[blueprintId].transitions));
    assert.equal(definedIds.size, count);
    assert.deepEqual(definedIds, new Set(blueprint.transitions.map(transition => String(transition.id))));
  }
  const serialized = JSON.stringify(phaseDetails);
  assert.doesNotMatch(serialized, /Zoho-oauthtoken|client_secret|refresh_token/i);
});

test('public Blueprint phase coverage is 202 of 202 with 5 implementation candidates and 197 blocked definitions', () => {
  const coverage = config.blueprints.map(blueprint => ({
    blueprint,
    definitions: Object.values(phaseDetails.blueprints[String(blueprint.id)]?.transitions || {}),
  }));
  assert.equal(coverage.reduce((total, item) => total + item.blueprint.transitions.length, 0), 202);
  assert.equal(coverage.reduce((total, item) => total + item.definitions.length, 0), 202);
  assert.equal(coverage.reduce((total, item) => total + item.definitions.filter(definition => definition.local_execution === 'Implemented').length, 0), 5);
  assert.equal(coverage.reduce((total, item) => total + item.definitions.filter(definition => definition.local_execution === 'Blocked').length, 0), 197);

  const task = coverage.find(item => String(item.blueprint.id) === '1032257000000416694');
  assert.equal(task?.blueprint.module, 'Tasks');
  assert.equal(task?.blueprint.transitions.length, 5);
  assert.equal(task?.definitions.length, 5);
  assert.equal(phaseDetails.blueprints['1032257000000416694']?.phase_coverage, 'Specified: 5 of 5 transitions');
  assert.ok(task?.definitions.every(definition => definition.local_execution === 'Blocked'));
});

test('Assign Technician During evidence identifies the captured widget while execution remains blocked', () => {
  const transition = phaseDetails.blueprints['1032257000023685467']?.transitions?.['1032257000023685453'];
  assert.equal(transition?.name, 'Assign Technician');
  assert.deepEqual(transition?.during_inputs, [{
    kind: 'widget',
    widget_id: '1032257000023774783',
    name: 'Assign Technician Widget',
    label: 'Assign Technician Widget',
    definition_status: 'Captured package validated; original read-only local preview implemented',
  }]);
  assert.equal(transition?.local_execution, 'Blocked');
  assert.match(transition?.block_reason || '', /Visit creation.*Blueprint continuation.*not implemented locally/i);
  assert.doesNotMatch(transition?.definition_status || '', /package not captured/i);
});

test('complete Deals phase evidence remains sanitized and fail-closed', () => {
  const blueprintId = '1032257000000535747';
  const blueprint = byId.get(blueprintId);
  const capturedBlueprint = phaseDetails.blueprints[blueprintId];
  const definitions = Object.values(capturedBlueprint?.transitions || {});

  assert.equal(blueprint?.module, 'Deals');
  assert.equal(blueprint?.transitions.length, 80);
  assert.equal(capturedBlueprint?.phase_coverage, 'Specified: 80 of 80 transitions');
  assert.equal(definitions.length, 80);
  assert.equal(definitions.reduce((total, item) => total + item.during_inputs.length, 0), 77);
  assert.equal(definitions.reduce((total, item) => total + item.during_inputs.filter(input => input.kind === 'field').length, 0), 49);
  assert.equal(definitions.reduce((total, item) => total + item.after_actions.length, 0), 25);
  assert.equal(definitions.filter(item => item.before.criteria_logic_supported === false).length, 8);
  assert.ok(definitions.every(item => item.local_execution === 'Blocked'));
  assert.ok(definitions.every(item => item.source_evidence?.method === 'read-only-ui-get'));

  const serialized = JSON.stringify(capturedBlueprint);
  assert.doesNotMatch(serialized, /https?:\/\/|Zoho-oauthtoken|client_secret|refresh_token|\/Users\//i);
  assert.doesNotMatch(serialized, /Gursharan|Sachin|Mehul/i);
  assert.doesNotMatch(serialized, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
});

test('complete Contacts phase evidence preserves the exact Ready For Handover safeguards', () => {
  const blueprintId = '1032257000001044611';
  const transitionId = '1032257000023182422';
  const blueprint = byId.get(blueprintId);
  const capturedBlueprint = phaseDetails.blueprints[blueprintId];
  const transition = capturedBlueprint?.transitions?.[transitionId];

  assert.equal(blueprint?.module, 'Contacts');
  assert.equal(capturedBlueprint?.phase_coverage, 'Specified: 83 of 83 transitions');
  assert.equal(Object.keys(capturedBlueprint?.transitions || {}).length, 83);
  assert.equal(blueprint?.transitions.find(item => String(item.id) === transitionId)?.name, 'Ready For Handover');
  assert.equal(transition?.name, 'Ready For Handover');
  assert.equal(transition?.common, false);
  assert.equal(transition?.trigger_type, 'manual');
  assert.deepEqual(transition?.before, { owners: ['Record Owner'], criteria: [] });
  assert.deepEqual(transition?.during_inputs, [
    {
      kind: 'widget',
      api_name: null,
      label: 'Handover To Post Team',
      data_type: 'widget',
      required: false,
      sequence: 1,
    },
  ]);
  assert.deepEqual(transition?.after_actions, []);
  assert.equal(transition?.local_execution, 'Blocked');
  assert.match(transition?.block_reason || '', /identity and permission rules.*During inputs.*After action/i);
  assert.equal(transition?.source_evidence?.method, 'read-only-ui-inspection');
  assert.equal(Object.values(capturedBlueprint.transitions).filter(item => item.local_execution === 'Implemented').length, 3);
  assert.equal(capturedBlueprint.transitions['1032257000001044557']?.name, 'Raw Quotation');
  assert.equal(capturedBlueprint.transitions['1032257000001044557']?.local_execution, 'Implemented');
  assert.equal(capturedBlueprint.transitions['1032257000001044557']?.block_reason, null);
  assert.equal(capturedBlueprint.transitions['1032257000001044561']?.name, 'Ringing No Response');
  assert.equal(capturedBlueprint.transitions['1032257000001044561']?.local_execution, 'Implemented');
  assert.equal(capturedBlueprint.transitions['1032257000001044845']?.name, 'Revised Design Discussion1');
  assert.equal(capturedBlueprint.transitions['1032257000001044845']?.local_execution, 'Implemented');
  assert.equal(capturedBlueprint.transitions['1032257000001044845']?.block_reason, null);
  assert.equal(Object.values(capturedBlueprint.transitions).filter(item => item.local_execution === 'Blocked').length, 80);
});
