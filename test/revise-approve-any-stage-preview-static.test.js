'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const engineSource = fs.readFileSync(path.join(root, 'public', 'revise-approve-any-stage-preview.js'), 'utf8');
const packageJson = require('../package.json');
const customButtons = require('../config/custom-buttons.json');
const runtimeCompatibility = require('../config/widget-runtime-compatibility.json');
const { getWidgetProfile, preflightWidgetRuntime } = require('../lib/widget-runtime-compatibility');

const button = customButtons.buttons.find(item => String(item.id) === '1032257000017358923');
const runtime = runtimeCompatibility.widgets.find(item => String(item.id) === '1032257000017358913');

test('retains the exact public Contacts view-button and widget registration without a Blueprint claim', () => {
  assert.deepEqual({
    id: button?.id,
    module: button?.module,
    name: button?.name,
    api_name: button?.api_name,
    position: button?.position,
    action: button?.action,
    source: button?.source,
    sequence_number: button?.sequence_number,
    layout_ids: button?.layout_ids,
    action_reference: button?.action_reference,
  }, {
    id: '1032257000017358923',
    module: 'Contacts',
    name: 'Revise-Approve Quote',
    api_name: 'Revise_Approve_Quote',
    position: 'view',
    action: 'widget',
    source: 'crm',
    sequence_number: 2,
    layout_ids: ['1032257000000000171', '1032257000005515301'],
    action_reference: {
      type: 'widget',
      id: '1032257000017358913',
      name: 'Revise-Approve Quote-Any Stage',
    },
  });
  assert.equal(button?.local_status, 'Blocked');
  assert.match(button?.block_reason || '', /local execution is disabled/i);
  assert.equal(Object.keys(button || {}).some(key => /blueprint/i.test(key)), false);
});

test('keeps Revise-Approve implemented read-only within the reconciled 9/0/3 runtime set', () => {
  assert.deepEqual(runtimeCompatibility.summary, {
    captured_source_read_only_ready: 0,
    local_preview_candidates: 0,
    implemented_local_previews: 9,
    quarantined_packages: 3,
    quarantined_pending_sensitive_review: 0,
    quarantined_review_complete_contract_blocked: 3,
    full_local_ready: 0,
  });
  assert.equal(runtimeCompatibility.archive_set.sensitive_review_completed_packages, 5);
  assert.equal(runtime?.name, 'Revise-Approve Quote-Any Stage');
  assert.equal(runtime?.type, 'Button');
  assert.equal(runtime?.preview_classification, 'fixture-preview-candidate');
  assert.equal(runtime?.preview_runtime_status, 'implemented-read-only');
  assert.equal(runtime?.full_runtime_status, 'blocked');
  assert.deepEqual(runtime?.modules_read, ['Contacts', 'Deals', 'Stage_History']);
  assert.deepEqual(runtime?.modules_written, ['Deals', 'Notes', 'Attachments']);
  assert.match(runtime?.preview_rationale || '', /exact Contacts view-button and two-layout registration/i);
  assert.match(runtime?.preview_rationale || '', /Sent for Approval eligibility.*blocking of every other stage/i);
  assert.match(runtime?.preview_rationale || '', /ID-free plans with no parent Blueprint/i);
  assert.equal(runtimeCompatibility.widgets.filter(item => item.preview_runtime_status === 'candidate').length, 0);
  assert.equal(runtimeCompatibility.widgets.filter(item => item.preview_runtime_status === 'implemented-read-only').length, 9);
  assert.equal(runtimeCompatibility.widgets.filter(item => item.preview_runtime_status === 'quarantined').length, 3);
});

test('runtime preflight permits only the reviewed local read coverage and keeps every execution path disabled', () => {
  const profile = getWidgetProfile('Revise-Approve Quote-Any Stage');
  assert.equal(profile.id, '1032257000017358913');
  const missing = preflightWidgetRuntime(profile.id, { mode: 'local-preview' });
  assert.equal(missing.allowed, false);
  assert.deepEqual(missing.missing_modules, ['Contacts', 'Deals', 'Stage_History']);

  const local = preflightWidgetRuntime(profile.id, {
    mode: 'local-preview',
    localModules: ['Contacts', 'Deals', 'Stage_History'],
  });
  assert.equal(local.allowed, true);
  assert.equal(local.data_source, 'local-mirror');
  assert.equal(local.implementation, 'local-reimplementation-only');
  assert.equal(local.source_code_execution, false);
  assert.equal(local.source_writes, false);
  assert.equal(local.outbound_network, false);

  const captured = preflightWidgetRuntime(profile.id, { mode: 'captured-source' });
  assert.equal(captured.allowed, false);
  assert.equal(captured.source_code_execution, false);
  assert.equal(captured.source_writes, false);
  assert.equal(captured.outbound_network, false);
});

test('loads the strict wrapper after its Revise Quote core and before application startup', () => {
  const coreIndex = indexSource.indexOf('<script src="/revise-quote-preview.js"></script>');
  const wrapperIndex = indexSource.indexOf('<script src="/revise-approve-any-stage-preview.js"></script>');
  const appIndex = indexSource.indexOf('<script src="/app.js"></script>');
  assert.ok(coreIndex >= 0 && wrapperIndex > coreIndex && appIndex > wrapperIndex);
  assert.equal((indexSource.match(/revise-approve-any-stage-preview\.js/g) || []).length, 1);
  assert.match(packageJson.scripts.precheck, /node --check public\/revise-approve-any-stage-preview\.js/);
  assert.match(packageJson.scripts.check, /node --check public\/revise-approve-any-stage-preview\.js/);
  assert.match(engineSource, /require\('\.\/revise-quote-preview'\)/);
});

test('phase 2 loads the separate action, evidence reader, close-only dialog, and isolated styles', () => {
  assert.match(appSource, /function isReviseApproveAnyStagePreviewButton\(/);
  assert.match(appSource, /function reviseApproveAnyStagePreviewReadEvidence\(/);
  assert.match(appSource, /function renderReviseApproveAnyStagePreview\(/);
  assert.match(appSource, /function openReviseApproveAnyStagePreview\(/);
  assert.match(styles, /\/\* Revise-Approve Quote Any Stage local-only preview \*\//);
  assert.match(styles, /\.revise-approve-preview-panel/);
});

test('static engine contains no parent contract or executable external side-effect surface', () => {
  assert.doesNotMatch(engineSource, /coreConstants\.parentContract|constants\s*:\s*Object\.freeze\([^)]*parentContract/);
  const parentClaims = [...engineSource.matchAll(/\b(?:parentBlueprint|parent_blueprint)\s*:\s*([^,\n]+)/g)]
    .map(match => match[1].trim());
  assert.deepEqual(parentClaims, ["'not-applicable'", "'not-applicable'", "'not-applicable'"]);
  assert.match(engineSource, /stage: row\.stage === 'Sent for Approval' \? 'Sent for Approval' : 'None'/);
  assert.match(engineSource, /reason: 'stage-not-sent-for-approval'/);
  assert.match(engineSource, /intended_transition: Object\.freeze\(\{ name: expected\.name \}\)/);
  assert.doesNotMatch(engineSource, /intended_transition:\s*[^\n]*\bid\b/);
  assert.doesNotMatch(engineSource, /https?:\/\/|\bfetch\b|XMLHttpRequest|WebSocket|sendBeacon/i);
  assert.doesNotMatch(engineSource, /localStorage|sessionStorage|indexedDB|clipboard|console\.|setTimeout|setInterval/i);
  assert.doesNotMatch(engineSource, /ZOHO|updateRecord|updateBluePrint|attachFile|addNotes|FormData|FileReader|\.type\s*=\s*['"]file['"]/i);
});
