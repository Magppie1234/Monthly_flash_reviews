'use strict';

const defaultBlueprintsConfig = require('../config/blueprints.json');
const defaultTransitionDetailsConfig = require('../config/blueprint-transition-details.json');
const defaultExecutionPolicies = require('../config/blueprint-execution-policies.json');
const { executionPolicyDecision } = require('./blueprint-execution-policy');
const { localExecutionReadiness } = require('./blueprint-engine');

const EXPECTED_BLUEPRINT_COUNT = 7;
const EXPECTED_TRANSITION_COUNT = 202;
const MAX_TEXT_LENGTH = 1200;
const FORBIDDEN_VALUE_PATTERNS = [
  /https?:\/\//i,
  /file:\/\//i,
  /(?:^|[\s"'(])\/(?:Users|home|var|tmp|etc|opt)\//i,
  /(?:^|[\\/])\.private(?:[\\/]|$)/i,
  /\b[A-Z]:\\/i,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\b(?:password|secret|token|api[_ -]?key|authorization)\b\s*(?:[:=]|is)\s*["']?[^\s"']{4,}/i,
];
const ATOMIC_RUNTIME_UNAVAILABLE_MESSAGE = 'Atomic Blueprint execution is unavailable until the exact transaction function and fail-closed canary are verified.';
const IDENTITY_AUTHORIZATION_UNAVAILABLE_MESSAGE = 'Verified local request-principal authorization and audit-actor binding are also required and are not implemented.';

function safeAtomicRuntimeStatus(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const sqlVerified = source.verification_complete === true
    && source.catalog_verified === true
    && source.fail_closed_canary_rejected === true
    && source.database_changes === 0;
  const requestPrincipalVerified = source.request_principal_verified === true;
  const identityAuthorizationVerified = source.identity_authorization_verified === true;
  const auditActorBindingVerified = source.audit_actor_binding_verified === true;
  const runtimeExecutable = sqlVerified
    && requestPrincipalVerified
    && identityAuthorizationVerified
    && auditActorBindingVerified
    && source.runtime_executable === true;
  return {
    verification_complete: source.verification_complete === true,
    catalog_verified: sqlVerified,
    fail_closed_canary_rejected: sqlVerified,
    database_changes: 0,
    request_principal_verified: requestPrincipalVerified,
    identity_authorization_verified: identityAuthorizationVerified,
    audit_actor_binding_verified: auditActorBindingVerified,
    runtime_executable: runtimeExecutable,
    code: runtimeExecutable
      ? 'BLUEPRINT_ATOMIC_RUNTIME_VERIFIED'
      : sqlVerified ? 'BLUEPRINT_IDENTITY_AUTHORIZATION_UNAVAILABLE' : 'BLUEPRINT_ATOMIC_RUNTIME_UNAVAILABLE',
    message: runtimeExecutable
      ? 'The exact atomic Blueprint transaction, fail-closed canary, request authorization, and audit actor binding are verified.'
      : sqlVerified ? IDENTITY_AUTHORIZATION_UNAVAILABLE_MESSAGE : `${ATOMIC_RUNTIME_UNAVAILABLE_MESSAGE} ${IDENTITY_AUTHORIZATION_UNAVAILABLE_MESSAGE}`,
  };
}

class BlueprintStudioError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'BlueprintStudioError';
    this.code = 'BLUEPRINT_STUDIO_INVALID';
    this.status = 503;
    this.details = details;
  }
}

function fail(message, details = {}) {
  throw new BlueprintStudioError(message, details);
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
  return value;
}

function array(value, label, max = 1000) {
  if (!Array.isArray(value) || value.length > max) fail(`${label} must be a bounded array.`);
  return value;
}

function text(value, label, { optional = false, max = MAX_TEXT_LENGTH } = {}) {
  if ((value === null || value === undefined || value === '') && optional) return null;
  if (typeof value !== 'string') fail(`${label} must be text.`);
  const normalized = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized || normalized.length > max) fail(`${label} must be bounded non-empty text.`);
  if (FORBIDDEN_VALUE_PATTERNS.some(pattern => pattern.test(normalized))) {
    fail(`${label} contains a value that is not safe for the public catalog.`);
  }
  return normalized;
}

function id(value, label, { optional = false } = {}) {
  if ((value === null || value === undefined || value === '') && optional) return null;
  const normalized = String(value ?? '');
  if (!/^\d{1,30}$/.test(normalized)) fail(`${label} must be a bounded numeric configuration ID.`);
  return normalized;
}

function apiName(value, label, { optional = false } = {}) {
  if ((value === null || value === undefined || value === '') && optional) return null;
  const normalized = text(value, label, { max: 160 });
  if (!/^[A-Za-z0-9_$]+$/.test(normalized)) fail(`${label} must be a safe API name.`);
  return normalized;
}

function bool(value) {
  return value === true;
}

function integer(value, label, { optional = false, min = -100000, max = 100000 } = {}) {
  if ((value === null || value === undefined || value === '') && optional) return null;
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`${label} must be a bounded integer.`);
  return value;
}

function scalar(value, label) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return text(value, label);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  fail(`${label} must be a safe scalar value.`);
}

function uniqueIds(items, label, getter = item => item?.id) {
  const seen = new Set();
  for (const [index, item] of items.entries()) {
    const itemId = id(getter(item), `${label}[${index}].id`);
    if (seen.has(itemId)) fail(`${label} contains a duplicate ID.`, { id: itemId });
    seen.add(itemId);
  }
  return seen;
}

function reserveUniqueIds(ids, seen, label) {
  for (const itemId of ids) {
    if (seen.has(itemId)) fail(`${label} contains an ID already used by another Blueprint.`, { id: itemId });
    seen.add(itemId);
  }
}

function reserveOptionalIds(items, seen, label) {
  for (const [index, item] of items.entries()) {
    const source = plainObject(item, `${label}[${index}]`);
    const itemId = id(source.id, `${label}[${index}].id`, { optional: true });
    if (itemId === null) continue;
    if (seen.has(itemId)) fail(`${label} contains a duplicate ID.`, { id: itemId });
    seen.add(itemId);
  }
}

function safeCriterion(criterion, label) {
  const source = plainObject(criterion, label);
  return {
    field: apiName(source.field, `${label}.field`),
    operator: text(source.operator, `${label}.operator`, { max: 80 }),
    value: scalar(source.value, `${label}.value`),
  };
}

function safeEndpoint(endpoint, label, stateIds) {
  const source = plainObject(endpoint, label);
  const stateId = id(source.id, `${label}.id`);
  if (!stateIds.has(stateId)) fail(`${label} references an unknown state.`, { id: stateId });
  return {
    id: stateId,
    display_value: text(source.display_value, `${label}.display_value`),
    actual_value: text(source.actual_value, `${label}.actual_value`),
  };
}

function safeValidation(validation, label) {
  if (validation === null || validation === undefined) return null;
  const source = plainObject(validation, label);
  const allowedValues = source.allowed_values === undefined
    ? []
    : array(source.allowed_values, `${label}.allowed_values`, 100).map((value, index) => scalar(value, `${label}.allowed_values[${index}]`));
  return {
    kind: text(source.kind, `${label}.kind`, { max: 80 }),
    logic_supported: bool(source.logic_supported),
    allowed_values: allowedValues,
    min_offset_days: integer(source.min_offset_days, `${label}.min_offset_days`, { optional: true, min: -3660, max: 3660 }),
    max_offset_days: integer(source.max_offset_days, `${label}.max_offset_days`, { optional: true, min: -3660, max: 3660 }),
    message: text(source.message, `${label}.message`, { optional: true }),
  };
}

function safeChecklist(checklist, label) {
  if (checklist === null || checklist === undefined) return null;
  const source = plainObject(checklist, label);
  const items = array(source.items || [], `${label}.items`, 100).map((item, index) => {
    const value = plainObject(item, `${label}.items[${index}]`);
    return {
      name: text(value.name, `${label}.items[${index}].name`, { max: 240 }),
      required: bool(value.required),
    };
  });
  return {
    title: text(source.title, `${label}.title`, { max: 240 }),
    items,
  };
}

function safeInput(input, label) {
  const source = plainObject(input, label);
  return {
    kind: text(source.kind || 'unspecified', `${label}.kind`, { max: 80 }),
    api_name: apiName(source.api_name, `${label}.api_name`, { optional: true }),
    label: text(source.label, `${label}.label`, { optional: true, max: 240 }),
    name: text(source.name, `${label}.name`, { optional: true, max: 240 }),
    data_type: text(source.data_type, `${label}.data_type`, { optional: true, max: 80 }),
    required: bool(source.required),
    sequence: integer(source.sequence, `${label}.sequence`, { optional: true, min: 0, max: 1000 }),
    definition_status: text(source.definition_status, `${label}.definition_status`, { optional: true }),
    message: text(source.message, `${label}.message`, { optional: true }),
    validation: safeValidation(source.validation, `${label}.validation`),
    checklist: safeChecklist(source.checklist_info, `${label}.checklist`),
  };
}

function safeAction(action, label) {
  const source = plainObject(action, label);
  return {
    id: id(source.id, `${label}.id`, { optional: true }),
    type: text(source.type, `${label}.type`, { max: 80 }),
    name: text(source.name, `${label}.name`, { optional: true, max: 300 }),
    api_name: apiName(source.api_name, `${label}.api_name`, { optional: true }),
    value: scalar(source.value, `${label}.value`),
    value_type: text(source.value_type, `${label}.value_type`, { optional: true, max: 80 }),
    day_offset: integer(source.day_offset, `${label}.day_offset`, { optional: true, min: -3660, max: 3660 }),
    business_day_offset: integer(source.business_day_offset, `${label}.business_day_offset`, { optional: true, min: -3660, max: 3660 }),
    due_from_field: apiName(source.due_from_field, `${label}.due_from_field`, { optional: true }),
    status: text(source.status, `${label}.status`, { optional: true, max: 160 }),
    priority: text(source.priority, `${label}.priority`, { optional: true, max: 160 }),
    external: bool(source.external),
    definition_status: text(source.definition_status, `${label}.definition_status`, { optional: true }),
    local_execution: text(source.local_execution, `${label}.local_execution`, { optional: true, max: 80 }),
    block_reason: text(source.block_reason, `${label}.block_reason`, { optional: true }),
    details_available: source.details_present === true || Boolean(source.details),
  };
}

function safeBefore(before, label) {
  if (before === null || before === undefined) {
    return {
      available: false,
      owners: [],
      owner_status: null,
      owner_resource_counts: [],
      criteria: [],
      criteria_evidence_complete: false,
      criteria_logic_supported: false,
    };
  }
  const source = plainObject(before, label);
  const owners = array(source.owners || [], `${label}.owners`, 100)
    .map((owner, index) => text(owner, `${label}.owners[${index}]`, { max: 160 }));
  const ownerResourceCounts = array(source.owner_details || [], `${label}.owner_details`, 100).map((item, index) => {
    const value = plainObject(item, `${label}.owner_details[${index}]`);
    return {
      type: text(value.type, `${label}.owner_details[${index}].type`, { max: 80 }),
      resource_count: integer(value.resource_count, `${label}.owner_details[${index}].resource_count`, { min: 0, max: 10000 }),
    };
  });
  const criteria = array(source.criteria || [], `${label}.criteria`, 100)
    .map((criterion, index) => safeCriterion(criterion, `${label}.criteria[${index}]`));
  return {
    available: true,
    owners,
    owner_status: text(source.owner_status, `${label}.owner_status`, { optional: true }),
    owner_resource_counts: ownerResourceCounts,
    criteria,
    criteria_evidence_complete: source.criteria_evidence_complete !== false,
    criteria_logic_supported: source.criteria_logic_supported !== false,
  };
}

function safeTriggerAfter(triggerAfter, label) {
  if (triggerAfter === null || triggerAfter === undefined) return null;
  const source = plainObject(triggerAfter, label);
  return {
    value: integer(source.value, `${label}.value`, { min: 0, max: 100000 }),
    unit: text(source.unit, `${label}.unit`, { max: 80 }),
  };
}

function safeState(state, label) {
  const source = plainObject(state, label);
  return {
    id: id(source.id, `${label}.id`),
    name: text(source.name, `${label}.name`, { max: 300 }),
    sla_configured: bool(source.sla_configured),
    unsupported_features_present: bool(source.unsupported_features_present),
  };
}

function safeConnection(connection, label, stateIds, transitionIds) {
  const source = plainObject(connection, label);
  const from = plainObject(source.from_state, `${label}.from_state`);
  const to = plainObject(source.to_state, `${label}.to_state`);
  const transition = plainObject(source.transition, `${label}.transition`);
  const fromId = id(from.id, `${label}.from_state.id`);
  const toId = id(to.id, `${label}.to_state.id`);
  const transitionId = id(transition.id, `${label}.transition.id`);
  if (!stateIds.has(fromId) || !stateIds.has(toId)) fail(`${label} references an unknown state.`);
  if (!transitionIds.has(transitionId)) fail(`${label} references an unknown transition.`, { id: transitionId });
  return {
    id: id(source.id, `${label}.id`, { optional: true }),
    from_state: { id: fromId, name: text(from.name, `${label}.from_state.name`, { max: 300 }) },
    to_state: { id: toId, name: text(to.name, `${label}.to_state.name`, { max: 300 }) },
    transition: {
      id: transitionId,
      name: text(transition.name, `${label}.transition.name`, { max: 300 }),
      api_name: apiName(transition.api_name, `${label}.transition.api_name`, { optional: true }),
      common: bool(transition.common),
      precedence: integer(transition.precedence, `${label}.transition.precedence`, { optional: true, min: 0, max: 10000 }),
    },
  };
}

function safeLayout(layout, label) {
  const source = plainObject(layout, label);
  return {
    id: id(source.id, `${label}.id`),
    name: text(source.name, `${label}.name`, { max: 300 }),
    api_name: apiName(source.api_name, `${label}.api_name`, { optional: true }),
  };
}

function safeField(field, label) {
  const source = plainObject(field, label);
  return {
    id: id(source.id, `${label}.id`),
    api_name: apiName(source.api_name, `${label}.api_name`),
    label: text(source.field_label, `${label}.field_label`, { max: 300 }),
  };
}

function sanitizeTransition(graphTransition, phaseTransition, label, stateIds) {
  const graph = plainObject(graphTransition, `${label}.graph`);
  const phase = plainObject(phaseTransition, `${label}.phase`);
  const transitionId = id(graph.id, `${label}.id`);
  const graphName = text(graph.name, `${label}.graph.name`, { max: 300 });
  const phaseName = text(phase.name, `${label}.phase.name`, { max: 300 });
  if (graphName !== phaseName) fail(`${label} name does not reconcile across graph and phase evidence.`, { id: transitionId });
  if (bool(graph.global) !== bool(phase.common)) fail(`${label} common-transition status does not reconcile.`, { id: transitionId });
  if (!Object.prototype.hasOwnProperty.call(phase, 'before')
    || !Object.prototype.hasOwnProperty.call(phase, 'during_inputs')
    || !Object.prototype.hasOwnProperty.call(phase, 'after_actions')) {
    fail(`${label} does not contain complete Before, During, and After phase keys.`, { id: transitionId });
  }
  const inputs = array(phase.during_inputs, `${label}.during_inputs`, 500)
    .map((input, index) => safeInput(input, `${label}.during_inputs[${index}]`));
  const actions = array(phase.after_actions, `${label}.after_actions`, 500)
    .map((action, index) => safeAction(action, `${label}.after_actions[${index}]`));
  if (!['Implemented', 'Blocked'].includes(phase.local_execution)) {
    fail(`${label} has an unsupported local execution status.`, { id: transitionId });
  }
  const executable = phase.local_execution === 'Implemented';
  const triggerType = text(phase.trigger_type || graph.trigger_type || 'manual', `${label}.trigger_type`, { max: 80 });
  return {
    id: transitionId,
    name: graphName,
    api_name: apiName(graph.api_name, `${label}.api_name`, { optional: true }),
    trigger_type: triggerType,
    transition_type: text(graph.transition_type, `${label}.transition_type`, { optional: true, max: 80 }),
    common: bool(phase.common),
    include_all_states: bool(phase.include_all_states),
    from: safeEndpoint(graph.from, `${label}.from`, stateIds),
    to: safeEndpoint(graph.to, `${label}.to`, stateIds),
    trigger_after: safeTriggerAfter(phase.trigger_after, `${label}.trigger_after`),
    before: safeBefore(phase.before, `${label}.before`),
    during: {
      input_count: inputs.length,
      required_input_count: inputs.filter(input => input.required).length,
      inputs,
    },
    after: {
      action_count: actions.length,
      external_action_count: actions.filter(action => action.external).length,
      actions,
    },
    execution: {
      status: phase.local_execution,
      executable,
      block_reason: text(phase.block_reason, `${label}.block_reason`, { optional: executable }),
    },
  };
}

function assertNoDuplicateConnections(connections, label) {
  const seen = new Set();
  connections.forEach((connection, index) => {
    const value = plainObject(connection, `${label}[${index}]`);
    const key = `${value.transition?.id || ''}|${value.from_state?.id || ''}|${value.to_state?.id || ''}`;
    if (seen.has(key)) fail(`${label} contains a duplicate transition path.`);
    seen.add(key);
  });
}

function assertPublicCatalog(value, currentPath = 'catalog') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPublicCatalog(item, `${currentPath}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    const forbiddenKeys = new Set([
      'record', 'records', 'payload', 'data', 'content', 'target', 'details', 'source_evidence',
      'owner_details', 'criteria_tree', 'entry_criteria_tree', 'source_display_text', 'transport',
      'navigation_method', 'url', 'href', 'path', 'password', 'secret', 'token', 'credential',
    ]);
    for (const [key, child] of Object.entries(value)) {
      if (forbiddenKeys.has(key.toLowerCase())) fail(`Public catalog contains forbidden field ${currentPath}.${key}.`);
      assertPublicCatalog(child, `${currentPath}.${key}`);
    }
    return;
  }
  if (typeof value === 'string' && FORBIDDEN_VALUE_PATTERNS.some(pattern => pattern.test(value))) {
    fail(`Public catalog contains a forbidden value at ${currentPath}.`);
  }
}

function buildBlueprintStudioCatalog(
  blueprintsConfig = defaultBlueprintsConfig,
  transitionDetailsConfig = defaultTransitionDetailsConfig,
  executionPolicies = defaultExecutionPolicies,
  atomicRuntimeStatus = null,
) {
  const graphRoot = plainObject(blueprintsConfig, 'blueprintsConfig');
  const phaseRoot = plainObject(transitionDetailsConfig, 'transitionDetailsConfig');
  const graphBlueprints = array(graphRoot.blueprints, 'blueprintsConfig.blueprints', 100);
  const phaseBlueprints = plainObject(phaseRoot.blueprints, 'transitionDetailsConfig.blueprints');
  const atomicRuntime = safeAtomicRuntimeStatus(atomicRuntimeStatus);
  const blueprintIds = uniqueIds(graphBlueprints, 'blueprintsConfig.blueprints');
  const phaseBlueprintIds = Object.keys(phaseBlueprints).map((value, index) => id(value, `transitionDetailsConfig.blueprints[${index}].id`));
  if (new Set(phaseBlueprintIds).size !== phaseBlueprintIds.length) fail('Transition-detail Blueprints contain duplicate IDs.');
  if (blueprintIds.size !== EXPECTED_BLUEPRINT_COUNT || phaseBlueprintIds.length !== EXPECTED_BLUEPRINT_COUNT) {
    fail('Blueprint Studio requires the reviewed seven-Blueprint catalog.');
  }
  if (phaseBlueprintIds.some(value => !blueprintIds.has(value)) || [...blueprintIds].some(value => !phaseBlueprintIds.includes(value))) {
    fail('Blueprint graph and phase-detail Blueprint IDs do not reconcile.');
  }

  let totalTransitions = 0;
  const catalogStateIds = new Set();
  const catalogTransitionIds = new Set();
  const catalogConnectionIds = new Set();
  const blueprints = graphBlueprints.map((graphBlueprint, blueprintIndex) => {
    const graph = plainObject(graphBlueprint, `blueprints[${blueprintIndex}]`);
    const blueprintId = id(graph.id, `blueprints[${blueprintIndex}].id`);
    const phase = plainObject(phaseBlueprints[blueprintId], `phaseBlueprints.${blueprintId}`);
    const moduleName = apiName(graph.module, `blueprints[${blueprintIndex}].module`);
    const blueprintName = text(graph.name, `blueprints[${blueprintIndex}].name`, { max: 300 });
    if (apiName(phase.module, `phaseBlueprints.${blueprintId}.module`) !== moduleName
      || text(phase.name, `phaseBlueprints.${blueprintId}.name`, { max: 300 }) !== blueprintName) {
      fail('Blueprint identity does not reconcile across graph and phase evidence.', { id: blueprintId });
    }

    const graphStates = array(graph.states, `blueprints[${blueprintIndex}].states`, 1000);
    const graphTransitions = array(graph.transitions, `blueprints[${blueprintIndex}].transitions`, 1000);
    const graphConnections = array(graph.connections, `blueprints[${blueprintIndex}].connections`, 5000);
    const stateIds = uniqueIds(graphStates, `blueprints[${blueprintIndex}].states`);
    const transitionIds = uniqueIds(graphTransitions, `blueprints[${blueprintIndex}].transitions`);
    reserveUniqueIds(stateIds, catalogStateIds, 'Blueprint states');
    reserveUniqueIds(transitionIds, catalogTransitionIds, 'Blueprint transitions');
    reserveOptionalIds(graphConnections, catalogConnectionIds, `blueprints[${blueprintIndex}].connections`);
    const phaseTransitions = plainObject(phase.transitions, `phaseBlueprints.${blueprintId}.transitions`);
    const phaseTransitionIds = Object.keys(phaseTransitions).map((value, index) => id(value, `phaseBlueprints.${blueprintId}.transitions[${index}].id`));
    if (new Set(phaseTransitionIds).size !== phaseTransitionIds.length) fail('Transition phase evidence contains duplicate IDs.', { id: blueprintId });
    if (phaseTransitionIds.length !== transitionIds.size
      || phaseTransitionIds.some(value => !transitionIds.has(value))
      || [...transitionIds].some(value => !phaseTransitionIds.includes(value))) {
      fail('Blueprint transition graph and phase-detail IDs do not reconcile.', { id: blueprintId });
    }
    assertNoDuplicateConnections(graphConnections, `blueprints[${blueprintIndex}].connections`);

    const states = graphStates.map((state, index) => safeState(state, `blueprints[${blueprintIndex}].states[${index}]`));
    const transitions = graphTransitions.map((transition, index) => {
      const definition = phaseTransitions[String(transition.id)];
      const sanitized = sanitizeTransition(
        transition,
        definition,
        `blueprints[${blueprintIndex}].transitions[${index}]`,
        stateIds,
      );
      const readiness = localExecutionReadiness(definition, transition);
      let policyEligible = false;
      let policyBlockReason = readiness.reason || sanitized.execution.block_reason;
      if (readiness.executable) {
        const policy = executionPolicyDecision(executionPolicies, graph, transition, definition);
        policyEligible = policy.approved;
        policyBlockReason = policy.approved ? null : policy.reason;
      }
      const runtimeExecutable = policyEligible && atomicRuntime.runtime_executable;
      const runtimeBlockReason = policyEligible && !runtimeExecutable ? atomicRuntime.message : null;
      sanitized.execution = {
        status: policyEligible ? (runtimeExecutable ? 'Atomic runtime ready' : 'Policy eligible') : 'Policy blocked',
        policy_eligible: policyEligible,
        runtime_executable: runtimeExecutable,
        executable: runtimeExecutable,
        policy_block_reason: policyBlockReason,
        runtime_block_reason: runtimeBlockReason,
        block_reason: policyBlockReason || runtimeBlockReason,
      };
      return sanitized;
    });
    const connections = graphConnections.map((connection, index) => safeConnection(
      connection,
      `blueprints[${blueprintIndex}].connections[${index}]`,
      stateIds,
      transitionIds,
    ));
    const connectedTransitionIds = new Set(connections.map(connection => connection.transition.id));
    const unconnected = [...transitionIds].filter(value => !connectedTransitionIds.has(value));
    if (unconnected.length) fail('Blueprint contains a transition without an authoritative connection.', { id: blueprintId });

    totalTransitions += transitions.length;
    const entryCriteria = array(graph.entry_criteria || [], `blueprints[${blueprintIndex}].entry_criteria`, 100)
      .map((criterion, index) => safeCriterion(criterion, `blueprints[${blueprintIndex}].entry_criteria[${index}]`));
    const coverage = {
      state_count: states.length,
      transition_count: transitions.length,
      connection_count: connections.length,
      phase_detail_count: transitions.length,
      policy_eligible_transition_count: transitions.filter(item => item.execution.policy_eligible).length,
      policy_blocked_transition_count: transitions.filter(item => !item.execution.policy_eligible).length,
      atomic_runtime_ready_transition_count: transitions.filter(item => item.execution.runtime_executable).length,
      manual_transition_count: transitions.filter(item => item.trigger_type !== 'automatic').length,
      automatic_transition_count: transitions.filter(item => item.trigger_type === 'automatic').length,
      during_input_count: transitions.reduce((sum, item) => sum + item.during.input_count, 0),
      required_input_count: transitions.reduce((sum, item) => sum + item.during.required_input_count, 0),
      after_action_count: transitions.reduce((sum, item) => sum + item.after.action_count, 0),
    };
    return {
      id: blueprintId,
      name: blueprintName,
      api_name: apiName(graph.api_name, `blueprints[${blueprintIndex}].api_name`, { optional: true }),
      module: moduleName,
      status: text(graph.status, `blueprints[${blueprintIndex}].status`, { max: 80 }),
      continuous: bool(graph.continuous),
      state_field: apiName(graph.state_field, `blueprints[${blueprintIndex}].state_field`),
      layout: safeLayout(graph.layout, `blueprints[${blueprintIndex}].layout`),
      field: safeField(graph.field, `blueprints[${blueprintIndex}].field`),
      entry: {
        criteria: entryCriteria,
        evidence: array(graph.entry_criteria_evidence || [], `blueprints[${blueprintIndex}].entry_criteria_evidence`, 100)
          .map((item, index) => text(item, `blueprints[${blueprintIndex}].entry_criteria_evidence[${index}]`, { max: 500 })),
        logic_supported: graph.entry_criteria_logic_supported !== false,
      },
      coverage,
      states,
      transitions,
      connections,
    };
  });

  if (totalTransitions !== EXPECTED_TRANSITION_COUNT) {
    fail('Blueprint Studio requires the reviewed 202-transition catalog.');
  }
  const allTransitions = blueprints.flatMap(blueprint => blueprint.transitions);
  const catalog = {
    schema_version: 2,
    generated_at: text(phaseRoot.generated_at || graphRoot.generated_at, 'generated_at', { max: 80 }),
    source_mode: 'read-only-captured-metadata',
    reconciliation_status: 'Reconciled',
    atomic_runtime: atomicRuntime,
    execution_boundary: {
      source_writes_enabled: false,
      local_transition_execution_enabled: allTransitions.some(item => item.execution.runtime_executable),
      exact_atomic_runtime_verified: atomicRuntime.runtime_executable,
      outbound_actions_enabled: false,
      customer_records_included: false,
      credentials_included: false,
      filesystem_locations_included: false,
    },
    coverage: {
      blueprint_count: blueprints.length,
      active_blueprint_count: blueprints.filter(blueprint => blueprint.status === 'Active').length,
      module_count: new Set(blueprints.map(blueprint => blueprint.module)).size,
      active_module_count: new Set(blueprints.filter(blueprint => blueprint.status === 'Active').map(blueprint => blueprint.module)).size,
      state_count: blueprints.reduce((sum, blueprint) => sum + blueprint.coverage.state_count, 0),
      transition_count: allTransitions.length,
      connection_count: blueprints.reduce((sum, blueprint) => sum + blueprint.coverage.connection_count, 0),
      phase_detail_count: allTransitions.length,
      policy_eligible_transition_count: allTransitions.filter(item => item.execution.policy_eligible).length,
      policy_blocked_transition_count: allTransitions.filter(item => !item.execution.policy_eligible).length,
      atomic_runtime_ready_transition_count: allTransitions.filter(item => item.execution.runtime_executable).length,
      manual_transition_count: allTransitions.filter(item => item.trigger_type !== 'automatic').length,
      automatic_transition_count: allTransitions.filter(item => item.trigger_type === 'automatic').length,
      during_input_count: allTransitions.reduce((sum, item) => sum + item.during.input_count, 0),
      required_input_count: allTransitions.reduce((sum, item) => sum + item.during.required_input_count, 0),
      after_action_count: allTransitions.reduce((sum, item) => sum + item.after.action_count, 0),
    },
    blueprints,
  };
  assertPublicCatalog(catalog);
  return catalog;
}

function getBlueprintStudioCatalog(atomicRuntimeStatus = null) {
  return buildBlueprintStudioCatalog(
    defaultBlueprintsConfig,
    defaultTransitionDetailsConfig,
    defaultExecutionPolicies,
    atomicRuntimeStatus,
  );
}

module.exports = {
  BlueprintStudioError,
  buildBlueprintStudioCatalog,
  getBlueprintStudioCatalog,
};
