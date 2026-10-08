'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const blueprintsConfig = require('../config/blueprints.json');
const transitionDetailsConfig = require('../config/blueprint-transition-details.json');
const {
  BlueprintStudioError,
  buildBlueprintStudioCatalog,
  getBlueprintStudioCatalog,
} = require('../lib/blueprint-studio');

const clone = value => JSON.parse(JSON.stringify(value));

function expectInvalid(fn, messagePattern) {
  assert.throws(fn, error => (
    error instanceof BlueprintStudioError
    && error.code === 'BLUEPRINT_STUDIO_INVALID'
    && error.status === 503
    && (!messagePattern || messagePattern.test(error.message))
  ));
}

test('Blueprint Studio reconciles all seven graphs and all 202 phase-complete transitions', () => {
  const catalog = getBlueprintStudioCatalog();
  assert.deepEqual(catalog.coverage, {
    blueprint_count: 7,
    active_blueprint_count: 6,
    module_count: 6,
    active_module_count: 5,
    state_count: 175,
    transition_count: 202,
    connection_count: 245,
    phase_detail_count: 202,
    policy_eligible_transition_count: 5,
    policy_blocked_transition_count: 197,
    atomic_runtime_ready_transition_count: 0,
    manual_transition_count: 201,
    automatic_transition_count: 1,
    during_input_count: 187,
    required_input_count: 111,
    after_action_count: 60,
  });
  assert.equal(catalog.reconciliation_status, 'Reconciled');
  assert.equal(catalog.blueprints.length, 7);

  const expected = {
    Leads: [9, 8, 8],
    Contacts: [69, 83, 83],
    Tasks: [5, 5, 6],
    Deals: [65, 80, 80],
    Visit_Module: [2, 1, 1],
  };
  for (const [module, counts] of Object.entries(expected)) {
    const blueprint = catalog.blueprints.find(item => item.module === module);
    assert.ok(blueprint, `${module} Blueprint must be present`);
    assert.deepEqual([blueprint.states.length, blueprint.transitions.length, blueprint.connections.length], counts);
  }
  const complaintBlueprints = catalog.blueprints.filter(item => item.module === 'AMS_Complaints');
  assert.deepEqual(complaintBlueprints.map(item => [item.states.length, item.transitions.length, item.connections.length]), [
    [11, 10, 26],
    [14, 15, 41],
  ]);
});

test('every transition exposes sanitized Before, During, After, graph, and exact execution metadata', () => {
  const catalog = getBlueprintStudioCatalog();
  const transitions = catalog.blueprints.flatMap(blueprint => blueprint.transitions);
  assert.equal(transitions.length, 202);
  assert.equal(transitions.filter(item => item.execution.policy_eligible).length, 5);
  assert.equal(transitions.filter(item => item.execution.runtime_executable).length, 0);
  assert.equal(transitions.filter(item => item.execution.status === 'Policy blocked').length, 197);
  assert.equal(transitions.filter(item => item.trigger_type === 'automatic').length, 1);

  for (const transition of transitions) {
    assert.match(transition.id, /^\d+$/);
    assert.match(transition.from.id, /^\d+$/);
    assert.match(transition.to.id, /^\d+$/);
    assert.equal(typeof transition.before.available, 'boolean');
    assert.ok(Array.isArray(transition.before.owners));
    assert.ok(Array.isArray(transition.before.criteria));
    assert.equal(transition.during.input_count, transition.during.inputs.length);
    assert.equal(transition.during.required_input_count, transition.during.inputs.filter(input => input.required).length);
    assert.equal(transition.after.action_count, transition.after.actions.length);
    assert.equal(transition.after.external_action_count, transition.after.actions.filter(action => action.external).length);
    assert.equal(transition.execution.executable, transition.execution.runtime_executable);
    if (transition.execution.policy_eligible) {
      assert.equal(transition.execution.policy_block_reason, null);
      assert.equal(transition.execution.runtime_executable, false);
      assert.match(transition.execution.runtime_block_reason, /exact transaction function and fail-closed canary/i);
    } else {
      assert.ok(transition.execution.policy_block_reason);
      assert.equal(transition.execution.runtime_block_reason, null);
    }
    assert.ok(transition.execution.block_reason);
  }

  for (const blueprint of catalog.blueprints) {
    const stateIds = new Set(blueprint.states.map(state => state.id));
    const transitionIds = new Set(blueprint.transitions.map(transition => transition.id));
    for (const connection of blueprint.connections) {
      assert.ok(stateIds.has(connection.from_state.id));
      assert.ok(stateIds.has(connection.to_state.id));
      assert.ok(transitionIds.has(connection.transition.id));
    }
  }
});

test('public catalog omits records, credentials, private locations, raw evidence, targets, and action details', () => {
  const catalog = getBlueprintStudioCatalog();
  assert.deepEqual(catalog.execution_boundary, {
    source_writes_enabled: false,
    local_transition_execution_enabled: false,
    exact_atomic_runtime_verified: false,
    outbound_actions_enabled: false,
    customer_records_included: false,
    credentials_included: false,
    filesystem_locations_included: false,
  });

  const forbiddenKeys = new Set([
    'record', 'records', 'payload', 'data', 'content', 'target', 'details', 'source_evidence',
    'owner_details', 'criteria_tree', 'entry_criteria_tree', 'source_display_text', 'transport',
    'navigation_method', 'url', 'href', 'path', 'password', 'secret', 'token', 'credential',
  ]);
  const visit = value => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.equal(forbiddenKeys.has(key.toLowerCase()), false, `forbidden key: ${key}`);
      visit(child);
    }
  };
  visit(catalog);

  const serialized = JSON.stringify(catalog);
  assert.doesNotMatch(serialized, /https?:\/\//i);
  assert.doesNotMatch(serialized, /file:\/\//i);
  assert.doesNotMatch(serialized, /\/Users\//i);
  assert.doesNotMatch(serialized, /\.private[\\/]/i);
  assert.doesNotMatch(serialized, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);

  const externalActions = catalog.blueprints.flatMap(blueprint => blueprint.transitions)
    .flatMap(transition => transition.after.actions)
    .filter(action => action.external);
  assert.ok(externalActions.length > 0);
  assert.ok(externalActions.every(action => !Object.prototype.hasOwnProperty.call(action, 'target')));
  assert.ok(externalActions.every(action => !Object.prototype.hasOwnProperty.call(action, 'details')));
});

test('duplicate Blueprint, state, transition, and connection identities fail closed', () => {
  const duplicateBlueprint = clone(blueprintsConfig);
  duplicateBlueprint.blueprints.push(clone(duplicateBlueprint.blueprints[0]));
  expectInvalid(() => buildBlueprintStudioCatalog(duplicateBlueprint, transitionDetailsConfig), /duplicate ID/i);

  const duplicateState = clone(blueprintsConfig);
  duplicateState.blueprints[0].states.push(clone(duplicateState.blueprints[0].states[0]));
  expectInvalid(() => buildBlueprintStudioCatalog(duplicateState, transitionDetailsConfig), /duplicate ID/i);

  const duplicateTransition = clone(blueprintsConfig);
  duplicateTransition.blueprints[0].transitions.push(clone(duplicateTransition.blueprints[0].transitions[0]));
  expectInvalid(() => buildBlueprintStudioCatalog(duplicateTransition, transitionDetailsConfig), /duplicate ID/i);

  const duplicateConnection = clone(blueprintsConfig);
  duplicateConnection.blueprints[0].connections.push(clone(duplicateConnection.blueprints[0].connections[0]));
  expectInvalid(() => buildBlueprintStudioCatalog(duplicateConnection, transitionDetailsConfig), /duplicate transition path/i);

  const duplicateConnectionId = clone(blueprintsConfig);
  const allConnections = duplicateConnectionId.blueprints.flatMap(blueprint => blueprint.connections);
  const connectionWithId = allConnections.find(connection => connection.id);
  const connectionWithoutId = allConnections.find(connection => !connection.id);
  connectionWithoutId.id = connectionWithId.id;
  expectInvalid(() => buildBlueprintStudioCatalog(duplicateConnectionId, transitionDetailsConfig), /duplicate ID/i);

  const reusedStateId = clone(blueprintsConfig);
  reusedStateId.blueprints[1].states[0].id = reusedStateId.blueprints[0].states[0].id;
  expectInvalid(() => buildBlueprintStudioCatalog(reusedStateId, transitionDetailsConfig), /another Blueprint/i);

  const reusedTransitionId = clone(blueprintsConfig);
  reusedTransitionId.blueprints[1].transitions[0].id = reusedTransitionId.blueprints[0].transitions[0].id;
  expectInvalid(() => buildBlueprintStudioCatalog(reusedTransitionId, transitionDetailsConfig), /another Blueprint/i);
});

test('graph/detail drift and invalid connection references fail before catalog exposure', () => {
  const missingPhase = clone(transitionDetailsConfig);
  const firstBlueprint = blueprintsConfig.blueprints[0];
  delete missingPhase.blueprints[firstBlueprint.id].transitions[firstBlueprint.transitions[0].id];
  expectInvalid(() => buildBlueprintStudioCatalog(blueprintsConfig, missingPhase), /IDs do not reconcile/i);

  const moduleDrift = clone(transitionDetailsConfig);
  moduleDrift.blueprints[firstBlueprint.id].module = 'Contacts';
  expectInvalid(() => buildBlueprintStudioCatalog(blueprintsConfig, moduleDrift), /identity does not reconcile/i);

  const badConnection = clone(blueprintsConfig);
  badConnection.blueprints[0].connections[0].transition.id = '9999999999999999999';
  expectInvalid(() => buildBlueprintStudioCatalog(badConnection, transitionDetailsConfig), /unknown transition/i);
});

test('Studio reports effective execution policy rather than trusting a phase flag', () => {
  const phases = clone(transitionDetailsConfig);
  const contacts = phases.blueprints['1032257000001044611'];
  contacts.transitions['1032257000001044565'].local_execution = 'Implemented';
  contacts.transitions['1032257000001044565'].block_reason = null;
  const catalog = buildBlueprintStudioCatalog(blueprintsConfig, phases);
  const transition = catalog.blueprints.find(item => item.module === 'Contacts').transitions
    .find(item => item.id === '1032257000001044565');
  assert.equal(transition.execution.policy_eligible, false);
  assert.equal(transition.execution.runtime_executable, false);
  assert.match(transition.execution.policy_block_reason, /no reviewed local execution policy/i);
});

test('runtime readiness requires exact SQL verification plus principal authorization and audit-actor binding', () => {
  const exactSqlStatus = {
    verification_complete: true,
    catalog_verified: true,
    fail_closed_canary_rejected: true,
    database_changes: 0,
    runtime_executable: true,
  };
  const sqlOnly = buildBlueprintStudioCatalog(
    blueprintsConfig,
    transitionDetailsConfig,
    undefined,
    exactSqlStatus,
  );
  assert.equal(sqlOnly.coverage.policy_eligible_transition_count, 5);
  assert.equal(sqlOnly.coverage.policy_blocked_transition_count, 197);
  assert.equal(sqlOnly.coverage.atomic_runtime_ready_transition_count, 0);
  assert.equal(sqlOnly.atomic_runtime.catalog_verified, true);
  assert.equal(sqlOnly.atomic_runtime.identity_authorization_verified, false);

  const exactStatus = {
    ...exactSqlStatus,
    request_principal_verified: true,
    identity_authorization_verified: true,
    audit_actor_binding_verified: true,
  };
  const catalog = buildBlueprintStudioCatalog(
    blueprintsConfig,
    transitionDetailsConfig,
    undefined,
    exactStatus,
  );
  const transitions = catalog.blueprints.flatMap(blueprint => blueprint.transitions);
  assert.equal(catalog.coverage.policy_eligible_transition_count, 5);
  assert.equal(catalog.coverage.policy_blocked_transition_count, 197);
  assert.equal(catalog.coverage.atomic_runtime_ready_transition_count, 5);
  assert.equal(transitions.filter(item => item.execution.runtime_executable).length, 5);
  assert.equal(catalog.execution_boundary.local_transition_execution_enabled, true);
  assert.equal(catalog.execution_boundary.exact_atomic_runtime_verified, true);

  for (const drift of [
    { ...exactStatus, catalog_verified: false },
    { ...exactStatus, fail_closed_canary_rejected: false },
    { ...exactStatus, database_changes: 1 },
    { ...exactStatus, request_principal_verified: false },
    { ...exactStatus, identity_authorization_verified: false },
    { ...exactStatus, audit_actor_binding_verified: false },
    { ...exactStatus, runtime_executable: false },
  ]) {
    const blocked = buildBlueprintStudioCatalog(blueprintsConfig, transitionDetailsConfig, undefined, drift);
    assert.equal(blocked.coverage.atomic_runtime_ready_transition_count, 0);
    assert.equal(blocked.execution_boundary.local_transition_execution_enabled, false);
  }
});

test('unsafe public strings reject and returned catalogs are fresh without mutating inputs', () => {
  const graph = clone(blueprintsConfig);
  const phases = clone(transitionDetailsConfig);
  const graphBefore = JSON.stringify(graph);
  const phasesBefore = JSON.stringify(phases);
  const first = buildBlueprintStudioCatalog(graph, phases);
  assert.equal(JSON.stringify(graph), graphBefore);
  assert.equal(JSON.stringify(phases), phasesBefore);
  first.blueprints[0].name = 'changed by caller';
  assert.notEqual(getBlueprintStudioCatalog().blueprints[0].name, 'changed by caller');

  const unsafeGraph = clone(blueprintsConfig);
  const unsafePhases = clone(transitionDetailsConfig);
  const blueprint = unsafeGraph.blueprints[0];
  const transition = blueprint.transitions[0];
  transition.name = 'https://private.example.test/path';
  unsafePhases.blueprints[blueprint.id].transitions[transition.id].name = transition.name;
  expectInvalid(() => buildBlueprintStudioCatalog(unsafeGraph, unsafePhases), /not safe for the public catalog/i);
});
