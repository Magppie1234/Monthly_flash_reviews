'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const runtimeEvidence = require('../config/widget-runtime-compatibility.json');

test('server exposes only sanitized GET widget-runtime compatibility evidence', () => {
  assert.match(serverSource, /getWidgetRuntimeCompatibility/);
  assert.match(serverSource, /app\.get\('\/api\/meta\/widget_runtime_compatibility'/);
  assert.doesNotMatch(serverSource, /app\.post\('\/api\/meta\/widget_runtime_compatibility'/);
});

test('Automation runtime summary binds the exact nine-live, zero-candidate, three-quarantined evidence', () => {
  assert.deepEqual(runtimeEvidence.summary, {
    captured_source_read_only_ready: 0,
    local_preview_candidates: 0,
    implemented_local_previews: 9,
    quarantined_packages: 3,
    quarantined_pending_sensitive_review: 0,
    quarantined_review_complete_contract_blocked: 3,
    full_local_ready: 0,
  });
  assert.equal(runtimeEvidence.archive_set.expected_packages, 12);
  assert.equal(runtimeEvidence.archive_set.captured_packages, 12);
  assert.equal(runtimeEvidence.archive_set.sensitive_review_required_packages, 0);
  assert.equal(runtimeEvidence.archive_set.sensitive_review_completed_packages, 5);
  assert.match(appSource, /Widget runtime compatibility/);
  assert.match(
    appSource,
    /widgetRuntimeSummary\.implemented_local_previews \|\| 0\} live read-only · \$\{widgetRuntimeSummary\.local_preview_candidates \|\| 0\} candidates · \$\{widgetRuntimeSummary\.quarantined_packages \|\| 0\} quarantined · \$\{widgetRuntimeSummary\.quarantined_pending_sensitive_review \|\| 0\} review pending · \$\{widgetRuntimeSummary\.quarantined_review_complete_contract_blocked \|\| 0\} reviewed\/contract blocked/,
  );
  assert.match(appSource, /Nine separate original read-only previews are implemented:/);
  assert.match(appSource, /Estimate, Assign Technician, Designer Form, Payment Milestone, Revise Quote, Closure New, Revise-Approve Quote-Any Stage, Deploy Team, and Handover To Post Team/);
  assert.match(appSource, /five bounded archive reviews are complete/i);
  assert.match(appSource, /Three packages remain quarantined after review:/);
  assert.match(appSource, /Closure Order Stage Update lacks an authoritative parent\/During\/attachment contract/);
  assert.match(appSource, /Handover to Post Design lacks an authoritative widget-ID-bearing parent binding/);
  assert.match(appSource, /Sunrooof Mark Closures requires credential rotation plus accepted cross-organization CRM, WorkDrive, data, transaction, and file contracts/);
  assert.match(appSource, /Deploy Team currently fails closed because Client Address is read-only/);
  assert.match(appSource, /Handover To Post Team can show exact requirements only; AMS creation remains blocked because no active reviewed transition enters Planned/);
  assert.doesNotMatch(appSource, /Seven supplied packages are candidates/);
  assert.doesNotMatch(appSource, /Seven separate original read-only previews are implemented/);
  assert.doesNotMatch(appSource, /five quarantined packages|four packages remain pending bounded review/i);
});

test('Automation maps implemented, quarantined, and candidate widget statuses separately', () => {
  const estimate = runtimeEvidence.widgets.find(widget => widget.name === 'Estimate Widget');
  const assignTechnician = runtimeEvidence.widgets.find(widget => widget.name === 'Assign Technician Widget');
  const designerForm = runtimeEvidence.widgets.find(widget => widget.name === 'Designer Form Widget');
  const paymentMilestone = runtimeEvidence.widgets.find(widget => widget.name === 'Payment Milestone Widget');
  const reviseQuote = runtimeEvidence.widgets.find(widget => widget.name === 'Revise Quote - Widget');
  const closureNew = runtimeEvidence.widgets.find(widget => widget.name === 'Closure New - Pinki');
  const reviseApproveAnyStage = runtimeEvidence.widgets.find(widget => widget.name === 'Revise-Approve Quote-Any Stage');
  const deployTeam = runtimeEvidence.widgets.find(widget => widget.name === 'Deploy Team');
  const handoverPostTeam = runtimeEvidence.widgets.find(widget => widget.name === 'Handover To Post Team');
  const quarantined = runtimeEvidence.widgets.filter(widget => widget.preview_runtime_status === 'quarantined');
  assert.equal(estimate?.preview_runtime_status, 'implemented-read-only');
  assert.equal(assignTechnician?.preview_runtime_status, 'implemented-read-only');
  assert.equal(designerForm?.preview_runtime_status, 'implemented-read-only');
  assert.equal(paymentMilestone?.preview_runtime_status, 'implemented-read-only');
  assert.equal(reviseQuote?.preview_runtime_status, 'implemented-read-only');
  assert.equal(closureNew?.preview_runtime_status, 'implemented-read-only');
  assert.equal(reviseApproveAnyStage?.preview_runtime_status, 'implemented-read-only');
  assert.equal(deployTeam?.preview_runtime_status, 'implemented-read-only');
  assert.equal(deployTeam?.preview_classification, 'fixture-preview-candidate');
  assert.equal(deployTeam?.archive_evidence?.sensitive_literal_review_completed, true);
  assert.deepEqual(deployTeam?.modules_read, ['Contacts', 'Deals', 'Users', 'Visit_Module']);
  assert.equal(deployTeam?.full_runtime_status, 'blocked');
  assert.equal(handoverPostTeam?.preview_runtime_status, 'implemented-read-only');
  assert.equal(handoverPostTeam?.preview_classification, 'fixture-preview-candidate');
  assert.equal(handoverPostTeam?.archive_evidence?.sensitive_literal_review_completed, true);
  assert.deepEqual(handoverPostTeam?.modules_read, ['Contacts', 'Deals', 'AMS_Complaints', 'Attachments']);
  assert.equal(handoverPostTeam?.full_runtime_status, 'blocked');
  assert.deepEqual(quarantined.map(widget => widget.name).sort(), [
    'Closure Order Stage Update',
    'Handover to Post Design',
    'Sunrooof Mark Closures',
  ].sort());
  assert.ok(quarantined.every(widget => widget.preview_classification === 'quarantined-reviewed-contract-blocked'));
  assert.ok(quarantined.every(widget => widget.archive_evidence?.sensitive_literal_review_completed === true));
  assert.match(
    appSource,
    /runtimeProfile\.preview_runtime_status === 'implemented-read-only'[\s\S]{0,80}\? 'Read-only preview implemented'/,
  );
  assert.match(
    appSource,
    /runtimeProfile\.preview_runtime_status === 'quarantined'[\s\S]{0,160}quarantined-reviewed-contract-blocked'[\s\S]{0,100}'Preview quarantined · contract blocked after review'/,
  );
  assert.match(appSource, /'Preview quarantined · review pending'/);
  assert.match(appSource, /: 'Read-only preview candidate'/);
  assert.match(appSource, /no local preview enabled · source execution disabled · writes disabled · outbound disabled/);
});

test('Automation keeps captured source, writes, and outbound access visibly disabled', () => {
  assert.match(appSource, /source execution disabled · writes disabled · outbound disabled/);
  assert.match(appSource, /Captured source, CRM writes,[^.]*outbound provider access remain fail-closed\./);
  assert.doesNotMatch(appSource, /eval\([^)]*runtimeProfile|new Function\([^)]*runtimeProfile/);
});
