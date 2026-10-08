#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  DEALS_BLUEPRINT_ID,
  BlueprintEditorEvidenceError,
  validateDealsEditorArtifact,
} = require('../lib/blueprint-editor-evidence');
const { mergePublicPhaseConfig } = require('./extract-blueprint-transition-phases');

const ROOT = path.join(__dirname, '..');
const ARTIFACT_PATH = path.join(ROOT, '.private', 'zoho-discovery', 'deals-blueprint-phases-2026-08-30.json');
const PREVIEW_PATH = path.join(ROOT, '.private', 'zoho-discovery', 'deals-blueprint-public-preview-2026-08-30.json');
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
    if (!allowed.has(argument)) throw new BlueprintEditorEvidenceError('INVALID_ARGUMENT', `Unknown argument: ${argument}`);
  }
  return { writePublicConfig: argv.includes('--write-public-config') };
}

function validatePublicPreview(preview, artifact, blueprint) {
  const onlyBlueprintIds = Object.keys(preview?.blueprints || {});
  if (onlyBlueprintIds.length !== 1 || onlyBlueprintIds[0] !== DEALS_BLUEPRINT_ID) {
    throw new BlueprintEditorEvidenceError('PREVIEW_SCOPE_INVALID', 'The sanitized preview must contain only the Deals Blueprint.');
  }
  const captured = preview.blueprints[DEALS_BLUEPRINT_ID];
  const transitions = captured?.transitions || {};
  if (captured?.phase_coverage !== 'Specified: 80 of 80 transitions' || Object.keys(transitions).length !== 80) {
    throw new BlueprintEditorEvidenceError('PREVIEW_COVERAGE_INVALID', 'The sanitized preview must contain all 80 Deals transition definitions.');
  }
  for (const source of artifact.transitions) {
    const definition = transitions[String(source.id)];
    if (!definition || definition.name !== source.name || Boolean(definition.common) !== Boolean(source.common)) {
      throw new BlueprintEditorEvidenceError('PREVIEW_GRAPH_DRIFT', 'The sanitized preview differs from the validated Deals graph.', { transition_id: String(source.id) });
    }
    if (definition.local_execution !== 'Blocked' || definition.source_evidence?.phase_keys_complete !== true || definition.source_evidence?.method !== 'read-only-ui-get') {
      throw new BlueprintEditorEvidenceError('PREVIEW_EXECUTION_BOUNDARY_INVALID', 'Every Deals preview transition must remain source-backed and fail-closed.', { transition_id: String(source.id) });
    }
  }
  const definitions = Object.values(transitions);
  const counts = {
    during_inputs: definitions.reduce((sum, definition) => sum + definition.during_inputs.length, 0),
    during_fields: definitions.reduce((sum, definition) => sum + definition.during_inputs.filter(input => input.kind === 'field').length, 0),
    after_actions: definitions.reduce((sum, definition) => sum + definition.after_actions.length, 0),
    unsupported_criteria: definitions.filter(definition => definition.before?.criteria_logic_supported === false).length,
  };
  if (counts.during_inputs !== 77 || counts.during_fields !== 49 || counts.after_actions !== 25 || counts.unsupported_criteria !== 8) {
    throw new BlueprintEditorEvidenceError('PREVIEW_COMPOSITION_DRIFT', 'The sanitized Deals preview phase composition has drifted.', counts);
  }
  const serialized = JSON.stringify(preview);
  if (/(?:https?:\/\/|Zoho-oauthtoken|client_secret|refresh_token|access_token|authorization|cookie|\/Users\/|Gursharan|Sachin|Mehul|[^\s@]+@[^\s@]+\.[^\s@]+)/i.test(serialized)) {
    throw new BlueprintEditorEvidenceError('PREVIEW_PRIVACY_INVALID', 'The sanitized Deals preview contains a forbidden public value.');
  }
  const graphIds = new Set(blueprint.transitions.map(transition => String(transition.id)));
  if (graphIds.size !== 80 || [...graphIds].some(id => !Object.hasOwn(transitions, id))) {
    throw new BlueprintEditorEvidenceError('PREVIEW_RECONCILIATION_FAILED', 'The sanitized Deals preview does not reconcile exactly to the graph.');
  }
  return counts;
}

function run(options = {}) {
  const artifact = readJson(ARTIFACT_PATH);
  const preview = readJson(PREVIEW_PATH);
  const blueprints = readJson(BLUEPRINT_PATH);
  const blueprint = blueprints.blueprints.find(item => String(item.id) === DEALS_BLUEPRINT_ID);
  validateDealsEditorArtifact(artifact, blueprint);
  const counts = validatePublicPreview(preview, artifact, blueprint);
  if (options.writePublicConfig) {
    const current = readJson(PHASE_PATH);
    atomicWriteJson(PHASE_PATH, mergePublicPhaseConfig(current, preview));
  }
  return {
    status: 'success',
    blueprint: preview.blueprints[DEALS_BLUEPRINT_ID].name,
    module: preview.blueprints[DEALS_BLUEPRINT_ID].module,
    transition_count: 80,
    phase_composition: counts,
    source_crm_methods: ['GET'],
    source_crm_mutations: 0,
    public_config_written: Boolean(options.writePublicConfig),
    local_execution_enabled: 0,
  };
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(run(parseArgs(process.argv.slice(2))), null, 2));
  } catch (error) {
    const expected = error instanceof BlueprintEditorEvidenceError;
    console.error(JSON.stringify({
      status: 'blocked',
      code: expected ? error.code : 'IMPORT_FAILED',
      message: expected ? error.message : 'Deals Blueprint editor evidence import failed.',
      source_crm_allowed_methods: ['GET'],
      source_crm_mutations: 0,
      public_config_written: false,
    }, null, 2));
    process.exitCode = 1;
  }
}

module.exports = { ARTIFACT_PATH, BLUEPRINT_PATH, PHASE_PATH, PREVIEW_PATH, atomicWriteJson, parseArgs, run, validatePublicPreview };
