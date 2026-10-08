#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  TASKS_BLUEPRINT_ID,
  TasksBlueprintEvidenceError,
  buildTasksPublicPreview,
  validateTasksBlueprintArtifact,
} = require('../lib/tasks-blueprint-evidence');
const { mergePublicPhaseConfig } = require('./extract-blueprint-transition-phases');

const ROOT = path.join(__dirname, '..');
const ARTIFACT_PATH = path.join(ROOT, '.private', 'zoho-discovery', 'tasks-blueprint-ui-phases-2026-08-30.json');
const BLUEPRINT_PATH = path.join(ROOT, 'config', 'blueprints.json');
const PHASE_PATH = path.join(ROOT, 'config', 'blueprint-transition-details.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function atomicWriteJson(filePath, value) {
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o644, flag: 'wx' });
    fs.renameSync(temporary, filePath);
    fs.chmodSync(filePath, 0o644);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

function parseArgs(argv) {
  const allowed = new Set(['--write-public-config']);
  for (const argument of argv) {
    if (!allowed.has(argument)) throw new TasksBlueprintEvidenceError('INVALID_ARGUMENT', `Unknown argument: ${argument}`);
  }
  return { writePublicConfig: argv.includes('--write-public-config') };
}

function previewComposition(preview) {
  const definitions = Object.values(preview.blueprints[TASKS_BLUEPRINT_ID].transitions);
  return {
    owners_record_owner: definitions.filter(definition => definition.before?.owners?.length === 1 && definition.before.owners[0] === 'Record Owner').length,
    during_messages: definitions.reduce((sum, definition) => sum + definition.during_inputs.filter(input => input.kind === 'message').length, 0),
    mandatory_fields: definitions.reduce((sum, definition) => sum + definition.during_inputs.filter(input => input.kind === 'field' && input.required === true).length, 0),
    priority_fields: definitions.reduce((sum, definition) => sum + definition.during_inputs.filter(input => input.api_name === 'Priority').length, 0),
    due_date_fields: definitions.reduce((sum, definition) => sum + definition.during_inputs.filter(input => input.api_name === 'Due_Date').length, 0),
    after_task_actions: definitions.reduce((sum, definition) => sum + definition.after_actions.filter(action => action.type === 'task').length, 0),
  };
}

function run(options = {}) {
  const artifact = readJson(ARTIFACT_PATH);
  const blueprints = readJson(BLUEPRINT_PATH);
  const blueprint = blueprints.blueprints.find(item => String(item.id) === TASKS_BLUEPRINT_ID);
  validateTasksBlueprintArtifact(artifact, blueprint);
  const preview = buildTasksPublicPreview(artifact, blueprint);
  const captured = preview.blueprints[TASKS_BLUEPRINT_ID];
  const definitions = Object.values(captured.transitions);
  const composition = previewComposition(preview);
  if (captured.phase_coverage !== 'Specified: 5 of 5 transitions'
    || definitions.length !== 5
    || definitions.some(definition => definition.local_execution !== 'Blocked')
    || JSON.stringify(composition) !== JSON.stringify({
      owners_record_owner: 5,
      during_messages: 4,
      mandatory_fields: 3,
      priority_fields: 1,
      due_date_fields: 2,
      after_task_actions: 2,
    })) {
    throw new TasksBlueprintEvidenceError('PREVIEW_COMPOSITION_DRIFT', 'Sanitized Tasks preview does not match the validated five-transition phase composition.', composition);
  }

  if (options.writePublicConfig) {
    const current = readJson(PHASE_PATH);
    atomicWriteJson(PHASE_PATH, mergePublicPhaseConfig(current, preview));
  }
  return {
    status: 'success',
    blueprint: captured.name,
    module: captured.module,
    transition_count: definitions.length,
    phase_coverage: captured.phase_coverage,
    phase_composition: composition,
    source_navigation_methods: ['GET'],
    source_crm_mutations: 0,
    public_config_written: Boolean(options.writePublicConfig),
    local_execution_enabled: 0,
  };
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(run(parseArgs(process.argv.slice(2))), null, 2));
  } catch (error) {
    const expected = error instanceof TasksBlueprintEvidenceError;
    console.error(JSON.stringify({
      status: 'blocked',
      code: expected ? error.code : 'IMPORT_FAILED',
      message: expected ? error.message : 'Tasks Blueprint UI evidence import failed before any public config write.',
      source_navigation_methods: ['GET'],
      source_crm_mutations: 0,
      public_config_written: false,
    }, null, 2));
    process.exitCode = 1;
  }
}

module.exports = {
  ARTIFACT_PATH,
  BLUEPRINT_PATH,
  PHASE_PATH,
  atomicWriteJson,
  parseArgs,
  previewComposition,
  run,
};
