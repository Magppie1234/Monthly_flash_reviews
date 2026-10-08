'use strict';

const TASKS_BLUEPRINT_ID = '1032257000000416694';
const EXPECTED_ORG_DOMAIN = 'org60046349006';
const EXPECTED_LAYOUT_ID = '1032257000000000199';
const EXPECTED_TRANSITION_COUNT = 5;
const FORBIDDEN_PUBLIC_VALUE = /(?:https?:\/\/|Zoho-oauthtoken|client_secret|refresh_token|access_token|authorization|cookie|\/Users\/|\borg\d{6,}\b|[^\s@]+@[^\s@]+\.[^\s@]+)/i;

const FIELD_METADATA = Object.freeze({
  '1032257000000000345': Object.freeze({
    api_name: 'Priority',
    field_label: 'Priority',
    data_type: 'picklist',
    ui_type: '2',
  }),
  '1032257000000000337': Object.freeze({
    api_name: 'Due_Date',
    field_label: 'Due Date',
    data_type: 'date',
    ui_type: '24',
  }),
});

const FIELD_VALIDATIONS = Object.freeze({
  '1032257000000416700:Priority': Object.freeze({
    kind: 'allowed_values',
    allowed_values: Object.freeze(['Highest']),
    message: 'You cannot change priority to lower ranks!',
    required_text: Object.freeze([
      "Priority ISN'T High, Low, Lowest, Normal",
      'AND Priority IS Highest',
      'You cannot change priority to lower ranks!',
    ]),
  }),
  '1032257000000416706:Due_Date': Object.freeze({
    kind: 'date_window',
    min_offset_days: 0,
    max_offset_days: null,
    message: 'Due date cannot be past dates.',
    required_text: Object.freeze([
      'Due Date IS Today',
      'OR Due Date IS Starting tomorrow',
      'Due date cannot be past dates.',
    ]),
  }),
  '1032257000000416709:Due_Date': Object.freeze({
    kind: 'date_window',
    min_offset_days: 1,
    max_offset_days: 30,
    message: 'Due date can only be within 30 days.',
    required_text: Object.freeze([
      'Due Date IS Starting tomorrow',
      'AND Due Date DUE IN DAYS <= 30',
      'Due date can only be within 30 days.',
    ]),
  }),
});

const TASK_ACTIONS = Object.freeze({
  '1032257000000416706': Object.freeze({
    task_id: '1032257000000416655',
    name: 'Reminder task for - ${Tasks.Subject}',
  }),
  '1032257000000416709': Object.freeze({
    task_id: '1032257000000416658',
    name: 'Reminder for deferred task - ${Tasks.Subject}',
  }),
});

class TasksBlueprintEvidenceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'TasksBlueprintEvidenceError';
    this.code = code;
    this.details = details;
  }
}

const arr = value => Array.isArray(value) ? value : [];
const idOf = value => value === null || value === undefined ? '' : String(value);
const hasOwn = (value, key) => Boolean(value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key));

function fail(condition, code, message, details = {}) {
  if (!condition) throw new TasksBlueprintEvidenceError(code, message, details);
}

function comparableText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\r\n/g, '\n');
}

function sameStringSet(left, right) {
  const a = [...new Set(left.map(String))].sort();
  const b = [...new Set(right.map(String))].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function validateFieldMetadata(artifact) {
  const returned = new Map();
  for (const field of arr(artifact.field_metadata)) {
    const fieldId = idOf(field?.id);
    fail(fieldId && FIELD_METADATA[fieldId], 'UNEXPECTED_FIELD_METADATA', 'Tasks evidence contains unexpected field metadata.', { field_id: fieldId || null });
    fail(!returned.has(fieldId), 'DUPLICATE_FIELD_METADATA', 'Tasks evidence contains duplicate field metadata.', { field_id: fieldId });
    const expected = FIELD_METADATA[fieldId];
    fail(field.api_name === expected.api_name && field.field_label === expected.field_label && field.data_type === expected.data_type && idOf(field.ui_type) === expected.ui_type,
      'FIELD_METADATA_DRIFT', 'Tasks field metadata differs from the captured source definition.', { field_id: fieldId });
    returned.set(fieldId, field);
  }
  fail(returned.size === Object.keys(FIELD_METADATA).length, 'FIELD_METADATA_INCOMPLETE', 'Tasks evidence must contain the exact Priority and Due Date field metadata.');
  return returned;
}

function validateTransitionEdge(source, blueprint) {
  const connections = arr(blueprint.connections).filter(connection => idOf(connection?.transition?.id) === idOf(source.id));
  fail(connections.length > 0, 'GRAPH_CONNECTION_MISSING', 'The authoritative Tasks graph has no connection for a captured transition.', { transition_id: idOf(source.id) });
  const expectedSources = connections.map(connection => String(connection.from_state?.name || ''));
  const capturedSources = String(source.from || '').split(/\s+or\s+/i).map(value => value.trim()).filter(Boolean);
  const expectedTargets = [...new Set(connections.map(connection => String(connection.to_state?.name || '')))];
  fail(sameStringSet(capturedSources, expectedSources) && expectedTargets.length === 1 && String(source.to || '') === expectedTargets[0],
    'TRANSITION_EDGE_DRIFT', 'Tasks UI phase evidence differs from the authoritative graph edge.', { transition_id: idOf(source.id) });
}

function validateOwnerEvidence(source) {
  const owners = arr(source.owners);
  fail(owners.length === 1
    && owners[0]?.label === 'Record Owner'
    && owners[0]?.type === 'role'
    && idOf(owners[0]?.value) === '-2',
  'OWNER_EVIDENCE_DRIFT', 'Every Tasks transition must be visible only to the captured Record Owner category.', { transition_id: idOf(source.id) });
}

function validateSourcePhaseEvidence(source) {
  fail(typeof source.before_text === 'string' && Array.isArray(source.during) && Array.isArray(source.after),
    'PHASE_KEYS_INCOMPLETE', 'Tasks evidence is missing Before, During, or After phase data.', { transition_id: idOf(source.id) });
  fail(source.source_evidence?.method === 'read-only-ui-inspection'
    && source.source_evidence?.before_visible === true
    && source.source_evidence?.during_visible === true
    && source.source_evidence?.after_visible === true,
  'PHASE_VISIBILITY_INCOMPLETE', 'Tasks evidence must prove that all three phase tabs were visibly inspected.', { transition_id: idOf(source.id) });
}

function validateDuringInput(input, transitionId, fieldById) {
  fail(input && typeof input === 'object' && !Array.isArray(input), 'DURING_INPUT_INVALID', 'Tasks During-phase evidence contains an invalid input.', { transition_id: transitionId });
  fail(input.module === 'Tasks', 'DURING_MODULE_DRIFT', 'A Tasks During-phase input belongs to an unexpected module.', { transition_id: transitionId });
  if (input.type === 'Info') {
    fail(input.mandatory === false && !input.field_id && typeof input.text === 'string' && input.text.trim(),
      'DURING_MESSAGE_INVALID', 'A Tasks During-phase message is incomplete.', { transition_id: transitionId });
    return { kind: 'message' };
  }
  fail(input.type === 'Field', 'DURING_TYPE_UNSUPPORTED', `Unsupported Tasks During-phase input type: ${String(input.type || 'missing')}.`, { transition_id: transitionId });
  fail(input.mandatory === true, 'MANDATORY_FIELD_DRIFT', 'Every captured Tasks During-phase field must remain mandatory.', { transition_id: transitionId, field_id: idOf(input.field_id) || null });
  const field = fieldById.get(idOf(input.field_id));
  fail(field, 'DURING_FIELD_UNMAPPED', 'A Tasks During-phase field has no exact metadata mapping.', { transition_id: transitionId, field_id: idOf(input.field_id) || null });
  const spec = FIELD_VALIDATIONS[`${transitionId}:${field.api_name}`];
  fail(spec, 'FIELD_VALIDATION_UNMAPPED', 'A Tasks mandatory field has no exact validation definition.', { transition_id: transitionId, field: field.api_name });
  const display = comparableText(input.text);
  fail(spec.required_text.every(fragment => display.includes(fragment)), 'FIELD_VALIDATION_DRIFT', 'Tasks field-validation display evidence has drifted.', { transition_id: transitionId, field: field.api_name });
  return { kind: 'field', field };
}

function validateAfterAction(action, transitionId) {
  fail(action && typeof action === 'object' && !Array.isArray(action), 'AFTER_ACTION_INVALID', 'Tasks After-phase evidence contains an invalid action.', { transition_id: transitionId });
  fail(action.action_type === 'Task', 'AFTER_ACTION_TYPE_UNSUPPORTED', `Unsupported Tasks After-phase action type: ${String(action.action_type || 'missing')}.`, { transition_id: transitionId });
  const expected = TASK_ACTIONS[transitionId];
  const lines = String(action.text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  fail(expected
    && idOf(action.task_id) === expected.task_id
    && action.id === `actionRow_${expected.task_id}`
    && lines[0] === expected.name
    && lines.length >= 2,
  'TASK_ACTION_DRIFT', 'Tasks After-phase task evidence differs from the captured source action.', { transition_id: transitionId });
}

function validateTasksBlueprintArtifact(artifact, blueprint) {
  fail(artifact && typeof artifact === 'object' && !Array.isArray(artifact), 'ARTIFACT_INVALID', 'Tasks Blueprint UI evidence must be an object.');
  fail(artifact.schema_version === 1, 'SCHEMA_VERSION_INVALID', 'Tasks Blueprint UI evidence must use schema version 1.');
  fail(artifact.source_writes === 0, 'SOURCE_WRITE_BOUNDARY_INVALID', 'Tasks Blueprint evidence must prove zero source writes.');
  fail(artifact.source_mode === 'authenticated-read-only-ui-inspection', 'SOURCE_MODE_INVALID', 'Tasks Blueprint evidence must come from authenticated read-only UI inspection.');
  fail(artifact.organization?.domain_name === EXPECTED_ORG_DOMAIN && artifact.organization?.verified_by_editor_url === true,
    'ORG_MISMATCH', `Tasks Blueprint evidence must belong to ${EXPECTED_ORG_DOMAIN}.`);
  fail(artifact.inspection?.page === `/settings/blueprint/${TASKS_BLUEPRINT_ID}?module=Tasks`
    && artifact.inspection?.navigation_method === 'GET'
    && artifact.inspection?.transitions_opened === EXPECTED_TRANSITION_COUNT
    && artifact.inspection?.phase_tabs_inspected === EXPECTED_TRANSITION_COUNT * 3
    && artifact.inspection?.save_actions === 0
    && artifact.inspection?.publish_actions === 0
    && artifact.inspection?.activation_actions === 0,
  'INSPECTION_BOUNDARY_INVALID', 'Tasks evidence does not prove complete GET-navigation inspection with zero Save, Publish, or Activate actions.');
  fail(blueprint && idOf(blueprint.id) === TASKS_BLUEPRINT_ID, 'GRAPH_MISSING', 'The authoritative Tasks Blueprint graph is unavailable.');
  fail(blueprint.module === 'Tasks' && blueprint.ui_module === 'Tasks' && blueprint.status === 'Inactive'
    && idOf(blueprint.layout?.id) === EXPECTED_LAYOUT_ID && arr(blueprint.transitions).length === EXPECTED_TRANSITION_COUNT,
  'GRAPH_IDENTITY_DRIFT', 'The authoritative Tasks Blueprint identity or transition count has drifted.');
  fail(idOf(artifact.blueprint?.id) === TASKS_BLUEPRINT_ID
    && artifact.blueprint?.name === blueprint.name
    && artifact.blueprint?.module === 'Tasks'
    && artifact.blueprint?.ui_module === 'Tasks'
    && artifact.blueprint?.status === 'Inactive'
    && idOf(artifact.blueprint?.layout_id) === EXPECTED_LAYOUT_ID
    && artifact.blueprint?.state_field === 'Status'
    && artifact.blueprint?.total_transitions === EXPECTED_TRANSITION_COUNT
    && artifact.blueprint?.phase_details_captured === EXPECTED_TRANSITION_COUNT,
  'BLUEPRINT_MISMATCH', 'Tasks UI evidence identifies an unexpected Blueprint.');

  const fieldById = validateFieldMetadata(artifact);
  const graphById = new Map(arr(blueprint.transitions).map(transition => [idOf(transition.id), transition]));
  const returnedById = new Map();
  const computed = { names: 0, phaseKeys: 0, owners: 0, messages: 0, fields: 0, actions: 0, unknownActions: 0 };
  const fieldOccurrences = { Priority: 0, Due_Date: 0 };

  for (const source of arr(artifact.transitions)) {
    const transitionId = idOf(source?.id);
    fail(transitionId && graphById.has(transitionId), 'UNEXPECTED_TRANSITION', 'Tasks evidence contains an unexpected transition.', { transition_id: transitionId || null });
    fail(!returnedById.has(transitionId), 'DUPLICATE_TRANSITION', 'Tasks evidence contains a duplicate transition.', { transition_id: transitionId });
    const graph = graphById.get(transitionId);
    fail(source.name === graph.name, 'TRANSITION_NAME_DRIFT', 'Tasks evidence transition name differs from the authoritative graph.', { transition_id: transitionId });
    computed.names += 1;
    fail(Boolean(source.common) === Boolean(graph.global) && source.trigger_type === 'manual',
      'TRANSITION_TYPE_DRIFT', 'Tasks evidence transition type differs from the authoritative graph.', { transition_id: transitionId });
    validateTransitionEdge(source, blueprint);
    validateOwnerEvidence(source);
    computed.owners += 1;
    validateSourcePhaseEvidence(source);
    computed.phaseKeys += 1;
    for (const input of source.during) {
      const result = validateDuringInput(input, transitionId, fieldById);
      if (result.kind === 'message') computed.messages += 1;
      else {
        computed.fields += 1;
        fieldOccurrences[result.field.api_name] += 1;
      }
    }
    const expectedActionCount = TASK_ACTIONS[transitionId] ? 1 : 0;
    fail(source.after.length === expectedActionCount, 'AFTER_ACTION_COUNT_DRIFT', 'Tasks transition After-action count has drifted.', { transition_id: transitionId });
    for (const action of source.after) {
      if (action?.action_type !== 'Task') computed.unknownActions += 1;
      validateAfterAction(action, transitionId);
      computed.actions += 1;
    }
    returnedById.set(transitionId, source);
  }

  fail(returnedById.size === EXPECTED_TRANSITION_COUNT && returnedById.size === graphById.size,
    'TRANSITION_RECONCILIATION_FAILED', 'Tasks UI evidence does not reconcile exactly to the five-transition graph.', { returned: returnedById.size, expected: graphById.size });
  fail(computed.messages === 4 && computed.fields === 3 && fieldOccurrences.Priority === 1 && fieldOccurrences.Due_Date === 2
    && computed.actions === 2 && computed.unknownActions === 0,
  'PHASE_COMPOSITION_DRIFT', 'Tasks Before/During/After phase composition has drifted.', { ...computed, field_occurrences: fieldOccurrences });

  const validation = artifact.validation || {};
  const exactCounters = {
    config_count: EXPECTED_TRANSITION_COUNT,
    graph_count: EXPECTED_TRANSITION_COUNT,
    returned_count: EXPECTED_TRANSITION_COUNT,
    unique_ids: EXPECTED_TRANSITION_COUNT,
    name_match: computed.names,
    phase_keys_complete: computed.phaseKeys,
    record_owner_count: computed.owners,
    during_message_count: computed.messages,
    during_field_count: computed.fields,
    after_action_count: computed.actions,
    unknown_action_count: computed.unknownActions,
  };
  for (const [key, expected] of Object.entries(exactCounters)) {
    fail(validation[key] === expected, 'CAPTURE_VALIDATION_DRIFT', `Tasks capture validation ${key} must equal ${expected}.`);
  }
  return arr(blueprint.transitions).map(transition => returnedById.get(idOf(transition.id)));
}

function normalizeTaskValidation(input, transitionId, field) {
  const spec = FIELD_VALIDATIONS[`${transitionId}:${field.api_name}`];
  const validation = {
    kind: spec.kind,
  };
  if (spec.kind === 'allowed_values') validation.allowed_values = [...spec.allowed_values];
  if (spec.kind === 'date_window') {
    validation.min_offset_days = spec.min_offset_days;
    validation.max_offset_days = spec.max_offset_days;
  }
  validation.source_display_text = String(input.text);
  validation.message = spec.message;
  validation.logic_supported = true;
  return validation;
}

function normalizeTaskDuringInput(input, index, transitionId, fieldById) {
  const sequence = index + 1;
  if (input.type === 'Info') {
    return {
      kind: 'message',
      api_name: null,
      label: 'Message',
      data_type: 'message',
      required: false,
      sequence,
      message: String(input.text),
    };
  }
  const field = fieldById.get(idOf(input.field_id));
  return {
    kind: 'field',
    api_name: field.api_name,
    label: field.field_label,
    data_type: field.data_type,
    required: true,
    sequence,
    validation: normalizeTaskValidation(input, transitionId, field),
  };
}

function normalizeTaskAction(action) {
  const lines = String(action.text).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const detailParts = lines.slice(1).join(' ').split('|').map(value => value.trim()).filter(Boolean);
  return {
    id: idOf(action.task_id),
    type: 'task',
    name: lines[0],
    details: {
      task_id: idOf(action.task_id),
      subject_template: lines[0],
      reminder_display: detailParts[0] || null,
      status_display: detailParts[1] || null,
      priority_display: detailParts[2] || null,
      source_display_text: String(action.text),
    },
    details_present: true,
    local_execution: 'Blocked',
    block_reason: 'The source task action is captured, but local scheduling and identity behavior are not implemented or acceptance-tested.',
  };
}

function normalizeTasksBlueprintEvidence(artifact, blueprint) {
  const ordered = validateTasksBlueprintArtifact(artifact, blueprint);
  const fieldById = new Map(arr(artifact.field_metadata).map(field => [idOf(field.id), field]));
  const transitions = {};
  for (const source of ordered) {
    const transitionId = idOf(source.id);
    transitions[transitionId] = {
      name: source.name,
      common: Boolean(source.common),
      trigger_type: source.trigger_type,
      before: {
        owners: ['Record Owner'],
        criteria: [],
        criteria_logic_supported: true,
        criteria_evidence_complete: true,
      },
      during_inputs: source.during.map((input, index) => normalizeTaskDuringInput(input, index, transitionId, fieldById)),
      after_actions: source.after.map(normalizeTaskAction),
      local_execution: 'Blocked',
      block_reason: 'Captured from authenticated read-only source UI inspection. The source Blueprint is inactive, and local execution remains blocked until source-equivalent identity, validation, action, scheduling, and rollback behavior is implemented and acceptance-tested.',
      source_evidence: {
        method: 'read-only-ui-inspection',
        navigation_method: 'GET',
        transition_id: transitionId,
        process_id: TASKS_BLUEPRINT_ID,
        phase_keys_complete: true,
      },
    };
  }
  const output = {
    name: artifact.blueprint.name,
    module: 'Tasks',
    phase_coverage: 'Specified: 5 of 5 transitions',
    transitions,
  };
  const serialized = JSON.stringify(output);
  fail(!FORBIDDEN_PUBLIC_VALUE.test(serialized), 'PUBLIC_SANITIZATION_FAILED', 'Sanitized Tasks Blueprint evidence contains a forbidden public value.');
  fail(!/(?:before_text|relationship_id|column_name|field_id|actionRow_|transFieldRow_)/i.test(serialized),
    'PUBLIC_INTERNAL_EVIDENCE_LEAK', 'Sanitized Tasks Blueprint evidence contains a private UI implementation field.');
  return output;
}

function buildTasksPublicPreview(artifact, blueprint) {
  return {
    generated_at: artifact.captured_at,
    blueprints: {
      [TASKS_BLUEPRINT_ID]: normalizeTasksBlueprintEvidence(artifact, blueprint),
    },
  };
}

module.exports = {
  EXPECTED_LAYOUT_ID,
  EXPECTED_ORG_DOMAIN,
  FIELD_METADATA,
  FIELD_VALIDATIONS,
  TASKS_BLUEPRINT_ID,
  TASK_ACTIONS,
  TasksBlueprintEvidenceError,
  buildTasksPublicPreview,
  normalizeTaskAction,
  normalizeTaskDuringInput,
  normalizeTaskValidation,
  normalizeTasksBlueprintEvidence,
  validateTasksBlueprintArtifact,
};
