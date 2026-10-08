'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const rawConfig = require('../config/widget-runtime-compatibility.json');
const behaviorInventory = require('../config/widget-behavior-inventory.json');
const {
  WidgetRuntimePolicyError,
  buildWidgetRuntimeCompatibility,
  getWidgetRuntimeCompatibility,
  getWidgetProfile,
  preflightWidgetRuntime,
  scanTextForSensitiveShapes,
  validateArchiveEntryMetadata,
} = require('../lib/widget-runtime-compatibility');

const EXPECTED_WIDGETS = [
  'Assign Technician Widget',
  'Closure New - Pinki',
  'Closure Order Stage Update',
  'Deploy Team',
  'Designer Form Widget',
  'Estimate Widget',
  'Handover to Post Design',
  'Handover To Post Team',
  'Payment Milestone Widget',
  'Revise Quote - Widget',
  'Revise-Approve Quote-Any Stage',
  'Sunrooof Mark Closures',
].sort();

function collectKeys(value, keys = []) {
  if (Array.isArray(value)) {
    value.forEach(child => collectKeys(child, keys));
    return keys;
  }
  if (!value || typeof value !== 'object') return keys;
  Object.entries(value).forEach(([key, child]) => {
    keys.push(key.toLowerCase());
    collectKeys(child, keys);
  });
  return keys;
}

test('captured widget compatibility reconciles the twelve supplied packages exactly', () => {
  const config = getWidgetRuntimeCompatibility();
  assert.equal(config.schema_version, 1);
  assert.equal(config.source_mode, 'offline-static-analysis');
  assert.deepEqual(config.widgets.map(widget => widget.name).sort(), EXPECTED_WIDGETS);
  assert.equal(config.widgets.length, 12);
  assert.equal(new Set(config.widgets.map(widget => widget.id)).size, 12);
  assert.equal(config.widgets.reduce((sum, widget) => sum + widget.archive_evidence.entries, 0), 35);
  assert.equal(
    config.widgets.reduce((sum, widget) => sum + widget.archive_evidence.uncompressed_bytes, 0),
    734029,
  );
  assert.equal(config.archive_set.crc_reads_passed, true);
  assert.deepEqual(config.summary, {
    captured_source_read_only_ready: 0,
    local_preview_candidates: 0,
    implemented_local_previews: 9,
    quarantined_packages: 3,
    quarantined_pending_sensitive_review: 0,
    quarantined_review_complete_contract_blocked: 3,
    full_local_ready: 0,
  });
});

test('per-widget preview runtime status reconciles nine implementations, zero candidates, and three quarantines', () => {
  const config = getWidgetRuntimeCompatibility();
  const statuses = Object.fromEntries(config.widgets.map(widget => [widget.name, widget.preview_runtime_status]));
  assert.deepEqual(statuses, {
    'Assign Technician Widget': 'implemented-read-only',
    'Closure New - Pinki': 'implemented-read-only',
    'Closure Order Stage Update': 'quarantined',
    'Deploy Team': 'implemented-read-only',
    'Designer Form Widget': 'implemented-read-only',
    'Estimate Widget': 'implemented-read-only',
    'Handover to Post Design': 'quarantined',
    'Handover To Post Team': 'implemented-read-only',
    'Payment Milestone Widget': 'implemented-read-only',
    'Revise Quote - Widget': 'implemented-read-only',
    'Revise-Approve Quote-Any Stage': 'implemented-read-only',
    'Sunrooof Mark Closures': 'quarantined',
  });

  const count = status => config.widgets.filter(widget => widget.preview_runtime_status === status).length;
  assert.equal(count('candidate'), config.summary.local_preview_candidates);
  assert.equal(count('implemented-read-only'), config.summary.implemented_local_previews);
  assert.equal(count('quarantined'), config.summary.quarantined_packages);

  const estimate = getWidgetProfile('Estimate Widget', config);
  assert.equal(estimate.preview_classification, 'calculation-preview-candidate');
  assert.equal(estimate.preview_runtime_status, 'implemented-read-only');
  assert.equal(estimate.archive_evidence.sensitive_literal_review_required, false);
  assert.deepEqual(estimate.modules_read, []);

  const assignTechnician = getWidgetProfile('Assign Technician Widget', config);
  assert.equal(assignTechnician.preview_classification, 'fixture-preview-candidate');
  assert.equal(assignTechnician.preview_runtime_status, 'implemented-read-only');
  assert.equal(assignTechnician.archive_evidence.sensitive_literal_review_required, false);
  assert.deepEqual(assignTechnician.modules_read, ['AMS_Complaints', 'Visit_Module']);

  const designerForm = getWidgetProfile('Designer Form Widget', config);
  assert.equal(designerForm.preview_classification, 'fixture-preview-candidate');
  assert.equal(designerForm.preview_runtime_status, 'implemented-read-only');
  assert.equal(designerForm.archive_evidence.sensitive_literal_review_required, false);
  assert.deepEqual(designerForm.modules_read, ['Contacts', 'Deals']);

  const paymentMilestone = getWidgetProfile('Payment Milestone Widget', config);
  assert.equal(paymentMilestone.preview_classification, 'fixture-preview-candidate');
  assert.equal(paymentMilestone.preview_runtime_status, 'implemented-read-only');
  assert.equal(paymentMilestone.archive_evidence.sensitive_literal_review_required, false);
  assert.deepEqual(paymentMilestone.modules_read, ['Contacts', 'Payment_Milestones']);

  const reviseQuote = getWidgetProfile('Revise Quote - Widget', config);
  assert.equal(reviseQuote.preview_classification, 'fixture-preview-candidate');
  assert.equal(reviseQuote.preview_runtime_status, 'implemented-read-only');
  assert.equal(reviseQuote.archive_evidence.sensitive_literal_review_required, false);
  assert.deepEqual(reviseQuote.modules_read, ['Contacts', 'Deals', 'Stage_History']);

  const closureNew = getWidgetProfile('Closure New - Pinki', config);
  assert.equal(closureNew.preview_classification, 'fixture-preview-candidate');
  assert.equal(closureNew.preview_runtime_status, 'implemented-read-only');
  assert.equal(closureNew.archive_evidence.sensitive_literal_review_required, false);
  assert.deepEqual(closureNew.modules_read, ['Contacts', 'Deals', 'Payment_Milestones']);

  const reviseApproveAnyStage = getWidgetProfile('Revise-Approve Quote-Any Stage', config);
  assert.equal(reviseApproveAnyStage.preview_classification, 'fixture-preview-candidate');
  assert.equal(reviseApproveAnyStage.preview_runtime_status, 'implemented-read-only');
  assert.equal(reviseApproveAnyStage.archive_evidence.sensitive_literal_review_required, false);
  assert.deepEqual(reviseApproveAnyStage.modules_read, ['Contacts', 'Deals', 'Stage_History']);

  const deployTeam = getWidgetProfile('Deploy Team', config);
  assert.equal(deployTeam.preview_classification, 'fixture-preview-candidate');
  assert.equal(deployTeam.preview_runtime_status, 'implemented-read-only');
  assert.equal(deployTeam.archive_evidence.sensitive_literal_review_required, false);
  assert.equal(deployTeam.archive_evidence.sensitive_literal_review_completed, true);
  assert.deepEqual(deployTeam.modules_read, ['Contacts', 'Deals', 'Users', 'Visit_Module']);

  const handoverPostTeam = getWidgetProfile('Handover To Post Team', config);
  assert.equal(handoverPostTeam.preview_classification, 'fixture-preview-candidate');
  assert.equal(handoverPostTeam.preview_runtime_status, 'implemented-read-only');
  assert.equal(handoverPostTeam.archive_evidence.sensitive_literal_review_required, false);
  assert.equal(handoverPostTeam.archive_evidence.sensitive_literal_review_completed, true);
  assert.deepEqual(handoverPostTeam.modules_read, ['Contacts', 'Deals', 'AMS_Complaints', 'Attachments']);

  config.widgets.filter(widget => widget.preview_runtime_status === 'candidate').forEach(widget => {
    assert.equal(widget.preview_classification, 'fixture-preview-candidate');
    assert.equal(widget.archive_evidence.sensitive_literal_review_required, false);
    assert.equal(widget.archive_evidence.sensitive_literal_review_completed, false);
  });
  const pendingReview = config.widgets.filter(widget => widget.preview_classification === 'quarantined-pending-review');
  assert.deepEqual(pendingReview, []);
  const reviewedContractBlocked = config.widgets.filter(widget => widget.preview_classification === 'quarantined-reviewed-contract-blocked');
  assert.deepEqual(reviewedContractBlocked.map(widget => widget.name).sort(), [
    'Closure Order Stage Update',
    'Handover to Post Design',
    'Sunrooof Mark Closures',
  ].sort());
  assert.ok(reviewedContractBlocked.every(widget => widget.archive_evidence.sensitive_literal_review_completed === true));
  assert.deepEqual(config.widgets.filter(widget => widget.archive_evidence.sensitive_literal_review_completed).map(widget => widget.name).sort(), [
    'Closure Order Stage Update',
    'Deploy Team',
    'Handover To Post Team',
    'Handover to Post Design',
    'Sunrooof Mark Closures',
  ].sort());
  const closureOrderStageUpdate = getWidgetProfile('Closure Order Stage Update', config);
  assert.equal(closureOrderStageUpdate.preview_runtime_status, 'quarantined');
  assert.equal(closureOrderStageUpdate.preview_classification, 'quarantined-reviewed-contract-blocked');
  assert.equal(closureOrderStageUpdate.archive_evidence.sensitive_literal_review_required, false);
  assert.equal(closureOrderStageUpdate.archive_evidence.sensitive_literal_review_completed, true);
  assert.match(closureOrderStageUpdate.preview_rationale, /exact parent Blueprint, layout, transition, and During-input binding are absent/i);
  assert.match(closureOrderStageUpdate.preview_rationale, /behavior and attachment contracts drift/i);
});

test('execution boundary is fail-closed and no profile claims third-party provider access', () => {
  const config = getWidgetRuntimeCompatibility();
  assert.deepEqual(config.execution_boundary, {
    captured_source_execution_enabled: false,
    source_writes_enabled: false,
    third_party_outbound_enabled: false,
    protected_value_use_enabled: false,
    preview_implementation: 'local-reimplementation-only',
    status: 'Fail closed',
  });
  assert.ok(config.widgets.every(widget => widget.modules_written.length > 0));
  assert.ok(config.widgets.every(widget => widget.full_runtime_status === 'blocked'));
  assert.ok(config.widgets.every(widget => widget.third_party_providers.length === 0));
});

test('each runtime profile remains anchored to the reconciled captured behavior inventory', () => {
  const config = getWidgetRuntimeCompatibility();
  config.widgets.forEach(profile => {
    const behavior = behaviorInventory.widgets.find(widget => widget.id === profile.id);
    assert.ok(behavior, `${profile.name} is missing from the behavior inventory`);
    assert.equal(behavior.package.captured, true);
    assert.equal(behavior.package.archive_validation, 'Passed');
    assert.equal(behavior.name, profile.name);
    assert.equal(behavior.type, profile.type);
    assert.deepEqual(behavior.behavior.modules_read, profile.modules_read);
    assert.deepEqual(behavior.behavior.modules_written, profile.modules_written);
  });
});

test('public compatibility evidence excludes source bodies, locations, targets, and protected values', () => {
  const forbiddenKeys = new Set([
    'archive_name', 'body', 'code', 'content', 'credential', 'credentials', 'endpoint',
    'external_target', 'file', 'hash', 'headers', 'local_path', 'password', 'path',
    'secret', 'secrets', 'sha256', 'source_body', 'source_code', 'token', 'tokens',
    'url', 'urls',
  ]);
  assert.equal(collectKeys(rawConfig).find(key => forbiddenKeys.has(key)), undefined);
  const serialized = JSON.stringify(rawConfig);
  assert.doesNotMatch(serialized, /https?:\/\//i);
  assert.doesNotMatch(serialized, /\/(?:Users|home|var|tmp|opt|etc)\//i);
  assert.doesNotMatch(serialized, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  assert.doesNotMatch(serialized, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i);
  assert.doesNotMatch(serialized, /\bbearer\s+[A-Z0-9._~+/=-]{8,}/i);
});

test('runtime adapter returns fresh allowlisted objects and rejects sensitive drift', () => {
  const first = getWidgetRuntimeCompatibility();
  const second = getWidgetRuntimeCompatibility();
  assert.notStrictEqual(first, second);
  assert.notStrictEqual(first.widgets, second.widgets);
  assert.notStrictEqual(first.widgets[0], second.widgets[0]);
  first.widgets[0].name = 'mutated';
  first.widgets[0].modules_read.push('Synthetic');
  assert.notEqual(second.widgets[0].name, 'mutated');
  assert.doesNotMatch(JSON.stringify(second), /Synthetic/);

  const injected = structuredClone(rawConfig);
  injected.widgets[0].source_code = 'omitted';
  assert.throws(() => buildWidgetRuntimeCompatibility(injected), /forbidden sensitive key/i);

  const protectedValue = structuredClone(rawConfig);
  protectedValue.widgets[0].preview_rationale = 'password="do-not-copy-this-value"';
  assert.throws(() => buildWidgetRuntimeCompatibility(protectedValue), /forbidden sensitive value/i);
});

test('runtime adapter rejects preview status, classification pairing, and summary drift', () => {
  const unsupported = structuredClone(rawConfig);
  unsupported.widgets[0].preview_runtime_status = 'ready';
  assert.throws(() => buildWidgetRuntimeCompatibility(unsupported), /preview_runtime_status is invalid/i);

  const estimateDemoted = structuredClone(rawConfig);
  estimateDemoted.widgets.find(widget => widget.name === 'Estimate Widget').preview_runtime_status = 'candidate';
  assert.throws(() => buildWidgetRuntimeCompatibility(estimateDemoted), /does not match reviewed implementation evidence/i);

  const assignDemoted = structuredClone(rawConfig);
  assignDemoted.widgets.find(widget => widget.name === 'Assign Technician Widget').preview_runtime_status = 'candidate';
  assert.throws(() => buildWidgetRuntimeCompatibility(assignDemoted), /does not match reviewed implementation evidence/i);

  const designerDemoted = structuredClone(rawConfig);
  designerDemoted.widgets.find(widget => widget.name === 'Designer Form Widget').preview_runtime_status = 'candidate';
  assert.throws(() => buildWidgetRuntimeCompatibility(designerDemoted), /does not match reviewed implementation evidence/i);

  const paymentDemoted = structuredClone(rawConfig);
  paymentDemoted.widgets.find(widget => widget.name === 'Payment Milestone Widget').preview_runtime_status = 'candidate';
  assert.throws(() => buildWidgetRuntimeCompatibility(paymentDemoted), /does not match reviewed implementation evidence/i);

  const reviseQuoteDemoted = structuredClone(rawConfig);
  reviseQuoteDemoted.widgets.find(widget => widget.name === 'Revise Quote - Widget').preview_runtime_status = 'candidate';
  assert.throws(() => buildWidgetRuntimeCompatibility(reviseQuoteDemoted), /does not match reviewed implementation evidence/i);

  const closureNewDemoted = structuredClone(rawConfig);
  closureNewDemoted.widgets.find(widget => widget.name === 'Closure New - Pinki').preview_runtime_status = 'candidate';
  assert.throws(() => buildWidgetRuntimeCompatibility(closureNewDemoted), /does not match reviewed implementation evidence/i);

  const reviseApproveDemoted = structuredClone(rawConfig);
  reviseApproveDemoted.widgets.find(widget => widget.name === 'Revise-Approve Quote-Any Stage').preview_runtime_status = 'candidate';
  assert.throws(() => buildWidgetRuntimeCompatibility(reviseApproveDemoted), /does not match reviewed implementation evidence/i);

  const deployDemoted = structuredClone(rawConfig);
  deployDemoted.widgets.find(widget => widget.name === 'Deploy Team').preview_runtime_status = 'candidate';
  assert.throws(() => buildWidgetRuntimeCompatibility(deployDemoted), /does not match reviewed implementation evidence/i);

  const handoverPostTeamDemoted = structuredClone(rawConfig);
  handoverPostTeamDemoted.widgets.find(widget => widget.name === 'Handover To Post Team').preview_runtime_status = 'candidate';
  assert.throws(() => buildWidgetRuntimeCompatibility(handoverPostTeamDemoted), /does not match reviewed implementation evidence/i);

  const completedReviewErased = structuredClone(rawConfig);
  completedReviewErased.widgets.find(widget => widget.name === 'Closure Order Stage Update').archive_evidence.sensitive_literal_review_completed = false;
  assert.throws(() => buildWidgetRuntimeCompatibility(completedReviewErased), /review state is inconsistent/i);

  const implementedReviewErased = structuredClone(rawConfig);
  implementedReviewErased.widgets.find(widget => widget.name === 'Deploy Team').archive_evidence.sensitive_literal_review_completed = false;
  assert.throws(() => buildWidgetRuntimeCompatibility(implementedReviewErased), /review state is inconsistent/i);

  const unexpectedReviewCompleted = structuredClone(rawConfig);
  unexpectedReviewCompleted.widgets.find(widget => widget.name === 'Assign Technician Widget').archive_evidence.sensitive_literal_review_completed = true;
  assert.throws(() => buildWidgetRuntimeCompatibility(unexpectedReviewCompleted), /review state is inconsistent/i);

  const classificationDrift = structuredClone(rawConfig);
  classificationDrift.widgets.find(widget => widget.name === 'Estimate Widget').preview_classification = 'fixture-preview-candidate';
  assert.throws(() => buildWidgetRuntimeCompatibility(classificationDrift), /classification and runtime status are inconsistent/i);

  const candidateCountDrift = structuredClone(rawConfig);
  candidateCountDrift.summary.local_preview_candidates = 6;
  assert.throws(() => buildWidgetRuntimeCompatibility(candidateCountDrift), /does not match audited evidence/i);

  const implementedCountDrift = structuredClone(rawConfig);
  implementedCountDrift.summary.implemented_local_previews = 1;
  assert.throws(() => buildWidgetRuntimeCompatibility(implementedCountDrift), /does not match audited evidence/i);
});

test('captured source execution is blocked for every supplied widget', () => {
  const config = getWidgetRuntimeCompatibility();
  config.widgets.forEach(widget => {
    const result = preflightWidgetRuntime(widget.id, { mode: 'captured-source' });
    assert.equal(result.allowed, false);
    assert.equal(result.source_code_execution, false);
    assert.equal(result.source_writes, false);
    assert.equal(result.outbound_network, false);
    assert.ok(result.blockers.some(item => item.code === 'CAPTURED_SOURCE_EXECUTION_DISABLED'));
    assert.ok(result.blockers.some(item => item.code === 'SOURCE_MUTATION_HANDLERS_PRESENT'));
  });
});

test('Estimate Widget is implemented read-only while writes and network remain denied', () => {
  const profile = getWidgetProfile('Estimate Widget');
  assert.equal(profile.preview_runtime_status, 'implemented-read-only');
  const result = preflightWidgetRuntime('Estimate Widget', { mode: 'local-preview' });
  assert.equal(result.allowed, true);
  assert.equal(result.classification, 'calculation-preview-candidate');
  assert.equal(result.implementation, 'local-reimplementation-only');
  assert.equal(result.data_source, 'local-mirror');
  assert.deepEqual(result.missing_modules, []);
  assert.equal(result.source_code_execution, false);
  assert.equal(result.source_writes, false);
  assert.equal(result.outbound_network, false);
});

test('implemented Assign Technician preview requires local read coverage or an explicitly reviewed fixture set', () => {
  const profile = getWidgetProfile('Assign Technician Widget');
  assert.equal(profile.preview_runtime_status, 'implemented-read-only');
  const missing = preflightWidgetRuntime('Assign Technician Widget', { mode: 'local-preview' });
  assert.equal(missing.allowed, false);
  assert.deepEqual(missing.missing_modules, ['AMS_Complaints', 'Visit_Module']);
  assert.ok(missing.blockers.some(item => item.code === 'MODULE_DATA_UNAVAILABLE'));

  const local = preflightWidgetRuntime('Assign Technician Widget', {
    mode: 'local-preview',
    localModules: ['AMS_Complaints', 'Visit_Module'],
  });
  assert.equal(local.allowed, true);
  assert.equal(local.data_source, 'local-mirror');
  assert.equal(local.classification, 'fixture-preview-candidate');
  assert.equal(local.implementation, 'local-reimplementation-only');
  assert.equal(local.source_code_execution, false);
  assert.equal(local.source_writes, false);
  assert.equal(local.outbound_network, false);

  const fixture = preflightWidgetRuntime('Assign Technician Widget', {
    mode: 'local-preview',
    fixtures: 'reviewed',
  });
  assert.equal(fixture.allowed, true);
  assert.equal(fixture.data_source, 'reviewed-fixtures');
});

test('implemented Designer Form preview requires exact local Contacts and Deals coverage', () => {
  const profile = getWidgetProfile('Designer Form Widget');
  assert.equal(profile.preview_runtime_status, 'implemented-read-only');
  const missing = preflightWidgetRuntime('Designer Form Widget', { mode: 'local-preview' });
  assert.equal(missing.allowed, false);
  assert.deepEqual(missing.missing_modules, ['Contacts', 'Deals']);
  assert.ok(missing.blockers.some(item => item.code === 'MODULE_DATA_UNAVAILABLE'));

  const local = preflightWidgetRuntime('Designer Form Widget', {
    mode: 'local-preview',
    localModules: ['Contacts', 'Deals'],
  });
  assert.equal(local.allowed, true);
  assert.equal(local.data_source, 'local-mirror');
  assert.equal(local.classification, 'fixture-preview-candidate');
  assert.equal(local.implementation, 'local-reimplementation-only');
  assert.equal(local.source_code_execution, false);
  assert.equal(local.source_writes, false);
  assert.equal(local.outbound_network, false);
});

test('implemented Payment Milestone preview requires exact local Contacts and Payment_Milestones coverage', () => {
  const profile = getWidgetProfile('Payment Milestone Widget');
  assert.equal(profile.preview_runtime_status, 'implemented-read-only');
  const missing = preflightWidgetRuntime('Payment Milestone Widget', { mode: 'local-preview' });
  assert.equal(missing.allowed, false);
  assert.deepEqual(missing.missing_modules, ['Contacts', 'Payment_Milestones']);
  assert.ok(missing.blockers.some(item => item.code === 'MODULE_DATA_UNAVAILABLE'));

  const local = preflightWidgetRuntime('Payment Milestone Widget', {
    mode: 'local-preview',
    localModules: ['Contacts', 'Payment_Milestones'],
  });
  assert.equal(local.allowed, true);
  assert.equal(local.data_source, 'local-mirror');
  assert.equal(local.classification, 'fixture-preview-candidate');
  assert.equal(local.implementation, 'local-reimplementation-only');
  assert.equal(local.source_code_execution, false);
  assert.equal(local.source_writes, false);
  assert.equal(local.outbound_network, false);
});

test('implemented Revise Quote preview requires its reviewed local read coverage', () => {
  const profile = getWidgetProfile('Revise Quote - Widget');
  assert.equal(profile.preview_runtime_status, 'implemented-read-only');
  const missing = preflightWidgetRuntime('Revise Quote - Widget', { mode: 'local-preview' });
  assert.equal(missing.allowed, false);
  assert.deepEqual(missing.missing_modules, ['Contacts', 'Deals', 'Stage_History']);
  assert.ok(missing.blockers.some(item => item.code === 'MODULE_DATA_UNAVAILABLE'));

  const local = preflightWidgetRuntime('Revise Quote - Widget', {
    mode: 'local-preview',
    localModules: ['Contacts', 'Deals', 'Stage_History'],
  });
  assert.equal(local.allowed, true);
  assert.equal(local.data_source, 'local-mirror');
  assert.equal(local.classification, 'fixture-preview-candidate');
  assert.equal(local.implementation, 'local-reimplementation-only');
  assert.equal(local.source_code_execution, false);
  assert.equal(local.source_writes, false);
  assert.equal(local.outbound_network, false);
});

test('implemented Closure New preview requires exact Contacts, Deals, and Payment_Milestones coverage', () => {
  const profile = getWidgetProfile('Closure New - Pinki');
  assert.equal(profile.preview_runtime_status, 'implemented-read-only');
  const missing = preflightWidgetRuntime('Closure New - Pinki', { mode: 'local-preview' });
  assert.equal(missing.allowed, false);
  assert.deepEqual(missing.missing_modules, ['Contacts', 'Deals', 'Payment_Milestones']);
  assert.ok(missing.blockers.some(item => item.code === 'MODULE_DATA_UNAVAILABLE'));

  const local = preflightWidgetRuntime('Closure New - Pinki', {
    mode: 'local-preview',
    localModules: ['Contacts', 'Deals', 'Payment_Milestones'],
  });
  assert.equal(local.allowed, true);
  assert.equal(local.data_source, 'local-mirror');
  assert.equal(local.classification, 'fixture-preview-candidate');
  assert.equal(local.implementation, 'local-reimplementation-only');
  assert.equal(local.source_code_execution, false);
  assert.equal(local.source_writes, false);
  assert.equal(local.outbound_network, false);
});

test('implemented Revise-Approve Any Stage preview requires exact Contacts, Deals, and Stage_History coverage', () => {
  const profile = getWidgetProfile('Revise-Approve Quote-Any Stage');
  assert.equal(profile.preview_runtime_status, 'implemented-read-only');
  const missing = preflightWidgetRuntime('Revise-Approve Quote-Any Stage', { mode: 'local-preview' });
  assert.equal(missing.allowed, false);
  assert.deepEqual(missing.missing_modules, ['Contacts', 'Deals', 'Stage_History']);
  assert.ok(missing.blockers.some(item => item.code === 'MODULE_DATA_UNAVAILABLE'));

  const local = preflightWidgetRuntime('Revise-Approve Quote-Any Stage', {
    mode: 'local-preview',
    localModules: ['Contacts', 'Deals', 'Stage_History'],
  });
  assert.equal(local.allowed, true);
  assert.equal(local.data_source, 'local-mirror');
  assert.equal(local.classification, 'fixture-preview-candidate');
  assert.equal(local.implementation, 'local-reimplementation-only');
  assert.equal(local.source_code_execution, false);
  assert.equal(local.source_writes, false);
  assert.equal(local.outbound_network, false);
});

test('implemented Deploy Team readiness preview requires its reviewed local read coverage', () => {
  const profile = getWidgetProfile('Deploy Team');
  assert.equal(profile.preview_runtime_status, 'implemented-read-only');
  assert.equal(profile.archive_evidence.sensitive_literal_review_completed, true);
  const missing = preflightWidgetRuntime(profile.name, { mode: 'local-preview' });
  assert.equal(missing.allowed, false);
  assert.deepEqual(missing.missing_modules, ['Contacts', 'Deals', 'Users', 'Visit_Module']);
  assert.ok(missing.blockers.some(item => item.code === 'MODULE_DATA_UNAVAILABLE'));

  const local = preflightWidgetRuntime(profile.name, {
    mode: 'local-preview',
    localModules: ['Contacts', 'Deals', 'Users', 'Visit_Module'],
  });
  assert.equal(local.allowed, true);
  assert.equal(local.data_source, 'local-mirror');
  assert.equal(local.classification, 'fixture-preview-candidate');
  assert.equal(local.source_code_execution, false);
  assert.equal(local.source_writes, false);
  assert.equal(local.outbound_network, false);
});

test('implemented Final Handover evidence preview requires Contacts, Deals, AMS, and attachment read coverage', () => {
  const profile = getWidgetProfile('Handover To Post Team');
  assert.equal(profile.preview_runtime_status, 'implemented-read-only');
  assert.equal(profile.archive_evidence.sensitive_literal_review_completed, true);
  const missing = preflightWidgetRuntime(profile.name, { mode: 'local-preview' });
  assert.equal(missing.allowed, false);
  assert.deepEqual(missing.missing_modules, ['Contacts', 'Deals', 'AMS_Complaints', 'Attachments']);
  assert.ok(missing.blockers.some(item => item.code === 'MODULE_DATA_UNAVAILABLE'));

  const local = preflightWidgetRuntime(profile.name, {
    mode: 'local-preview',
    localModules: ['Contacts', 'Deals', 'AMS_Complaints', 'Attachments'],
  });
  assert.equal(local.allowed, true);
  assert.equal(local.data_source, 'local-mirror');
  assert.equal(local.classification, 'fixture-preview-candidate');
  assert.equal(local.source_code_execution, false);
  assert.equal(local.source_writes, false);
  assert.equal(local.outbound_network, false);
});

test('local preview never accepts captured source or relaxed write and outbound guards', () => {
  const captured = preflightWidgetRuntime('Estimate Widget', {
    mode: 'local-preview',
    useCapturedSource: true,
  });
  assert.equal(captured.allowed, false);
  assert.ok(captured.blockers.some(item => item.code === 'REIMPLEMENTATION_REQUIRED'));

  const writeEnabled = preflightWidgetRuntime('Estimate Widget', {
    mode: 'local-preview',
    writeGuard: 'allow',
  });
  assert.equal(writeEnabled.allowed, false);
  assert.ok(writeEnabled.blockers.some(item => item.code === 'WRITE_GUARD_REQUIRED'));

  const outboundEnabled = preflightWidgetRuntime('Estimate Widget', {
    mode: 'local-preview',
    networkGuard: 'allow',
  });
  assert.equal(outboundEnabled.allowed, false);
  assert.ok(outboundEnabled.blockers.some(item => item.code === 'NETWORK_GUARD_REQUIRED'));
});

test('all five bounded reviews are complete and the exact three incomplete contracts remain quarantined', () => {
  const config = getWidgetRuntimeCompatibility();
  assert.deepEqual(config.widgets.filter(widget => widget.archive_evidence.sensitive_literal_review_required), []);
  const reviewed = config.widgets.filter(widget => widget.archive_evidence.sensitive_literal_review_completed);
  assert.deepEqual(
    reviewed.map(widget => widget.name).sort(),
    [
      'Closure Order Stage Update',
      'Deploy Team',
      'Handover To Post Team',
      'Handover to Post Design',
      'Sunrooof Mark Closures',
    ].sort(),
  );
  const quarantined = config.widgets.filter(widget => widget.preview_classification === 'quarantined-reviewed-contract-blocked');
  assert.deepEqual(quarantined.map(widget => widget.name).sort(), [
    'Closure Order Stage Update',
    'Handover to Post Design',
    'Sunrooof Mark Closures',
  ].sort());
  quarantined.forEach(widget => {
    const blocked = preflightWidgetRuntime(widget.name, {
      mode: 'local-preview',
      fixtures: 'reviewed',
    });
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.blockers.some(item => item.code === 'PREVIEW_CONTRACT_INCOMPLETE'));
    assert.equal(blocked.blockers.some(item => item.code === 'SENSITIVE_REVIEW_REQUIRED'), false);

    const callerClaim = preflightWidgetRuntime(widget.name, {
      mode: 'local-preview',
      fixtures: 'reviewed',
      sensitiveReviewApproved: true,
    });
    assert.equal(callerClaim.allowed, false);
    assert.equal(callerClaim.classification, 'quarantined-reviewed-contract-blocked');
    assert.ok(callerClaim.blockers.some(item => item.code === 'PREVIEW_CONTRACT_INCOMPLETE'));
    assert.equal(callerClaim.source_code_execution, false);
  });
});

test('each reviewed contract-blocked package keeps captured and preview execution disabled', () => {
  for (const name of ['Closure Order Stage Update', 'Handover to Post Design', 'Sunrooof Mark Closures']) {
    const profile = getWidgetProfile(name);
    assert.equal(profile.archive_evidence.sensitive_literal_review_required, false);
    assert.equal(profile.archive_evidence.sensitive_literal_review_completed, true);
    assert.equal(profile.preview_classification, 'quarantined-reviewed-contract-blocked');
    assert.equal(profile.preview_runtime_status, 'quarantined');

    const preview = preflightWidgetRuntime(profile.name, { mode: 'local-preview', fixtures: 'reviewed' });
    assert.equal(preview.allowed, false);
    assert.equal(preview.classification, 'quarantined-reviewed-contract-blocked');
    assert.ok(preview.blockers.some(item => item.code === 'PREVIEW_CONTRACT_INCOMPLETE'));
    assert.equal(preview.blockers.some(item => item.code === 'SENSITIVE_REVIEW_REQUIRED'), false);
    assert.equal(preview.source_code_execution, false);
    assert.equal(preview.source_writes, false);
    assert.equal(preview.outbound_network, false);

    const captured = preflightWidgetRuntime(profile.id, { mode: 'captured-source' });
    assert.equal(captured.allowed, false);
    assert.ok(captured.blockers.some(item => item.code === 'CAPTURED_SOURCE_EXECUTION_DISABLED'));
    assert.ok(captured.blockers.some(item => item.code === 'SOURCE_MUTATION_HANDLERS_PRESENT'));
    assert.equal(captured.blockers.some(item => item.code === 'SENSITIVE_REVIEW_REQUIRED'), false);
  }
});

test('full local execution remains blocked even if a caller claims every capability', () => {
  const profile = getWidgetProfile('Payment Milestone Widget');
  const result = preflightWidgetRuntime(profile.id, {
    mode: 'full-local',
    availableCapabilities: profile.required_capabilities,
  });
  assert.equal(result.allowed, false);
  assert.deepEqual(result.missing_capabilities, []);
  assert.ok(result.blockers.some(item => item.code === 'SOURCE_WRITES_DISABLED'));
  assert.ok(result.blockers.some(item => item.code === 'PROVIDER_ACCESS_DISABLED'));
});

test('archive metadata validator accepts a small regular package without exposing names', () => {
  const result = validateArchiveEntryMetadata([
    { name: 'app/', kind: 'directory', uncompressedBytes: 0, compressedBytes: 0, unixMode: 0o040755 },
    { name: 'app/widget.html', kind: 'file', uncompressedBytes: 4000, compressedBytes: 1800, unixMode: 0o100644 },
    { name: 'app/translations/en.json', kind: 'file', uncompressedBytes: 200, compressedBytes: 120, unixMode: 0o100644 },
  ]);
  assert.deepEqual(result, {
    entries: 3,
    regular_files: 2,
    uncompressed_bytes: 4200,
    path_safety: 'passed',
    special_file_safety: 'passed',
    compression_safety: 'passed',
  });
  assert.doesNotMatch(JSON.stringify(result), /widget\.html|translations/i);
});

test('archive metadata validator rejects traversal, absolute, encoded, backslash, and duplicate names', () => {
  const invalidNames = [
    '../private.txt',
    '/absolute.txt',
    'C:/absolute.txt',
    'app\\widget.html',
    'app/%2e%2e/private.txt',
    'app//widget.html',
  ];
  invalidNames.forEach(name => {
    assert.throws(
      () => validateArchiveEntryMetadata([{ name, kind: 'file', uncompressedBytes: 10, compressedBytes: 10 }]),
      error => error instanceof WidgetRuntimePolicyError && error.code === 'ARCHIVE_PATH_UNSAFE',
    );
  });
  assert.throws(
    () => validateArchiveEntryMetadata([
      { name: 'app/Widget.html', uncompressedBytes: 10, compressedBytes: 10 },
      { name: 'app/widget.html', uncompressedBytes: 10, compressedBytes: 10 },
    ]),
    error => error instanceof WidgetRuntimePolicyError && error.code === 'ARCHIVE_DUPLICATE_ENTRY',
  );
});

test('archive metadata validator rejects symbolic links, bombs, and bounded-size drift', () => {
  assert.throws(
    () => validateArchiveEntryMetadata([
      { name: 'app/link', kind: 'file', unixMode: 0o120777, uncompressedBytes: 5, compressedBytes: 5 },
    ]),
    error => error instanceof WidgetRuntimePolicyError && error.code === 'ARCHIVE_SPECIAL_FILE',
  );
  assert.throws(
    () => validateArchiveEntryMetadata([
      { name: 'app/widget.html', uncompressedBytes: 1024 * 1024, compressedBytes: 10 },
    ]),
    error => error instanceof WidgetRuntimePolicyError && error.code === 'ARCHIVE_COMPRESSION_UNSAFE',
  );
  assert.throws(
    () => validateArchiveEntryMetadata([
      { name: 'app/widget.html', uncompressedBytes: 3 * 1024 * 1024, compressedBytes: 2 * 1024 * 1024 },
    ]),
    error => error instanceof WidgetRuntimePolicyError && error.code === 'ARCHIVE_LIMIT_EXCEEDED',
  );
});

test('archive errors and unknown-widget errors never echo caller-controlled values', () => {
  const protectedValue = 'do-not-echo-this-protected-value';
  assert.throws(
    () => validateArchiveEntryMetadata([
      { name: `../${protectedValue}`, uncompressedBytes: 10, compressedBytes: 10 },
    ]),
    error => {
      assert.equal(error.code, 'ARCHIVE_PATH_UNSAFE');
      assert.doesNotMatch(error.message, new RegExp(protectedValue));
      return true;
    },
  );
  assert.throws(
    () => getWidgetProfile(protectedValue),
    error => {
      assert.equal(error.code, 'WIDGET_NOT_FOUND');
      assert.doesNotMatch(error.message, new RegExp(protectedValue));
      return true;
    },
  );
});

test('sensitive-text scanner reports categories only and never returns matched values', () => {
  const protectedValue = 'do-not-copy-this-value';
  const result = scanTextForSensitiveShapes(`password="${protectedValue}" contact@example.invalid`);
  assert.deepEqual(result, {
    review_required: true,
    categories: ['protected_assignment', 'email_address'],
    matched_values_exposed: false,
  });
  assert.doesNotMatch(JSON.stringify(result), new RegExp(protectedValue));
  assert.doesNotMatch(JSON.stringify(result), /contact@example\.invalid/);
  assert.deepEqual(scanTextForSensitiveShapes('const total = width * height;'), {
    review_required: false,
    categories: [],
    matched_values_exposed: false,
  });
});
