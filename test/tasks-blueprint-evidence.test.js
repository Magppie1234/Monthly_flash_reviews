'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const blueprints = require('../config/blueprints.json');
const {
  TASKS_BLUEPRINT_ID,
  TasksBlueprintEvidenceError,
  buildTasksPublicPreview,
  normalizeTasksBlueprintEvidence,
  validateTasksBlueprintArtifact,
} = require('../lib/tasks-blueprint-evidence');
const {
  PHASE_PATH,
  parseArgs,
  previewComposition,
  run,
} = require('../scripts/import-tasks-blueprint-ui-evidence');

const artifactPath = path.join(__dirname, '..', '.private', 'zoho-discovery', 'tasks-blueprint-ui-phases-2026-08-30.json');
const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
const blueprint = blueprints.blueprints.find(item => String(item.id) === TASKS_BLUEPRINT_ID);
const clone = value => JSON.parse(JSON.stringify(value));

test('Tasks UI phase evidence reconciles exactly to five transitions and six authoritative connections', () => {
  const ordered = validateTasksBlueprintArtifact(artifact, blueprint);
  assert.equal(ordered.length, 5);
  assert.equal(blueprint.connections.length, 6);
  assert.deepEqual(new Set(ordered.map(item => String(item.id))), new Set(blueprint.transitions.map(item => String(item.id))));
  assert.equal(ordered.find(item => String(item.id) === '1032257000000416712').from, 'Waiting for input or Deferred');
  assert.equal(artifact.inspection.save_actions, 0);
  assert.equal(artifact.inspection.publish_actions, 0);
  assert.equal(artifact.inspection.activation_actions, 0);
});

test('Tasks evidence normalizes complete phase coverage while every transition remains blocked', () => {
  const normalized = normalizeTasksBlueprintEvidence(artifact, blueprint);
  const definitions = Object.values(normalized.transitions);
  assert.equal(normalized.phase_coverage, 'Specified: 5 of 5 transitions');
  assert.equal(definitions.length, 5);
  assert.ok(definitions.every(definition => definition.local_execution === 'Blocked'));
  assert.ok(definitions.every(definition => definition.before.owners.length === 1 && definition.before.owners[0] === 'Record Owner'));
  assert.ok(definitions.every(definition => definition.source_evidence.method === 'read-only-ui-inspection'));
  assert.ok(definitions.every(definition => definition.source_evidence.navigation_method === 'GET'));
  assert.deepEqual(previewComposition(buildTasksPublicPreview(artifact, blueprint)), {
    owners_record_owner: 5,
    during_messages: 4,
    mandatory_fields: 3,
    priority_fields: 1,
    due_date_fields: 2,
    after_task_actions: 2,
  });
});

test('Tasks mandatory fields preserve display evidence and expose enforceable validation logic', () => {
  const normalized = normalizeTasksBlueprintEvidence(artifact, blueprint);
  const started = normalized.transitions['1032257000000416700'];
  const awaiting = normalized.transitions['1032257000000416706'];
  const deferred = normalized.transitions['1032257000000416709'];
  const rawById = new Map(artifact.transitions.map(transition => [String(transition.id), transition]));

  const priority = started.during_inputs.find(input => input.api_name === 'Priority');
  assert.deepEqual(priority.validation, {
    kind: 'allowed_values',
    allowed_values: ['Highest'],
    source_display_text: rawById.get('1032257000000416700').during.find(input => input.type === 'Field').text,
    message: 'You cannot change priority to lower ranks!',
    logic_supported: true,
  });

  const awaitingDueDate = awaiting.during_inputs.find(input => input.api_name === 'Due_Date');
  assert.deepEqual(awaitingDueDate.validation, {
    kind: 'date_window',
    min_offset_days: 0,
    max_offset_days: null,
    source_display_text: rawById.get('1032257000000416706').during.find(input => input.type === 'Field').text,
    message: 'Due date cannot be past dates.',
    logic_supported: true,
  });

  const deferredDueDate = deferred.during_inputs.find(input => input.api_name === 'Due_Date');
  assert.deepEqual(deferredDueDate.validation, {
    kind: 'date_window',
    min_offset_days: 1,
    max_offset_days: 30,
    source_display_text: rawById.get('1032257000000416709').during.find(input => input.type === 'Field').text,
    message: 'Due date can only be within 30 days.',
    logic_supported: true,
  });
  assert.equal(Object.values(normalized.transitions).flatMap(definition => definition.during_inputs).filter(input => input.kind === 'message').length, 4);
});

test('Tasks After-phase task actions retain IDs, names, sanitized details, and blocked execution', () => {
  const normalized = normalizeTasksBlueprintEvidence(artifact, blueprint);
  const actions = Object.values(normalized.transitions).flatMap(definition => definition.after_actions);
  assert.deepEqual(actions.map(action => action.id), ['1032257000000416655', '1032257000000416658']);
  assert.deepEqual(actions.map(action => action.name), [
    'Reminder task for - ${Tasks.Subject}',
    'Reminder for deferred task - ${Tasks.Subject}',
  ]);
  assert.ok(actions.every(action => action.type === 'task' && action.local_execution === 'Blocked' && action.details_present === true));
  assert.deepEqual(actions.map(action => action.details.priority_display), ['Highest', 'Highest']);
  assert.deepEqual(actions.map(action => action.details.status_display), ['Waiting on someone else', 'Deferred']);
});

test('Tasks public preview excludes private UI internals and importer defaults to check-only', () => {
  const preview = buildTasksPublicPreview(artifact, blueprint);
  const serialized = JSON.stringify(preview);
  assert.doesNotMatch(serialized, /https?:\/\/|Zoho-oauthtoken|client_secret|refresh_token|access_token|\/Users\/|\borg\d{6,}\b/i);
  assert.doesNotMatch(serialized, /before_text|relationship_id|column_name|field_id|actionRow_|transFieldRow_/i);
  assert.deepEqual(parseArgs([]), { writePublicConfig: false });
  assert.deepEqual(parseArgs(['--write-public-config']), { writePublicConfig: true });
  assert.throws(() => parseArgs(['--unknown']), error => error instanceof TasksBlueprintEvidenceError && error.code === 'INVALID_ARGUMENT');
  const before = fs.readFileSync(PHASE_PATH, 'utf8');
  const summary = run();
  const after = fs.readFileSync(PHASE_PATH, 'utf8');
  assert.equal(summary.public_config_written, false);
  assert.equal(summary.transition_count, 5);
  assert.equal(summary.local_execution_enabled, 0);
  assert.equal(after, before);
});

test('Tasks evidence rejects unknown phase actions and validation display drift', () => {
  const unknownAction = clone(artifact);
  unknownAction.transitions[0].after.push({ action_type: 'Webhook', text: 'Unexpected' });
  assert.throws(() => validateTasksBlueprintArtifact(unknownAction, blueprint), error => error instanceof TasksBlueprintEvidenceError && ['AFTER_ACTION_COUNT_DRIFT', 'AFTER_ACTION_TYPE_UNSUPPORTED'].includes(error.code));

  const driftedValidation = clone(artifact);
  const started = driftedValidation.transitions.find(transition => String(transition.id) === '1032257000000416700');
  started.during.find(input => input.type === 'Field').text = 'Priority can be anything';
  assert.throws(() => validateTasksBlueprintArtifact(driftedValidation, blueprint), error => error instanceof TasksBlueprintEvidenceError && error.code === 'FIELD_VALIDATION_DRIFT');
});
