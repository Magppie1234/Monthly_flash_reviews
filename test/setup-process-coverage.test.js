'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  NOT_YET_AUDITED_MODULES,
  RATE_LIMITED_MODULES,
  UNRESOLVED_MODULES,
  VERIFIED_EMPTY_MODULES,
  buildSetupProcessCoverage,
  getSetupProcessCoverage,
} = require('../lib/setup-process-coverage');

const rawCoverage = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'config', 'source-setup-ui-evidence.json'), 'utf8'));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('publishes exact authenticated read-only setup evidence without claiming unresolved modules are empty', () => {
  const coverage = getSetupProcessCoverage();
  assert.equal(coverage.evidence_scope.source_mode, 'authenticated_read_only_ui');
  assert.equal(coverage.evidence_scope.source_contacted, true);
  assert.equal(coverage.evidence_scope.mutation_attempted, false);
  assert.equal(coverage.evidence_scope.source_mutations, false);
  assert.equal(coverage.evidence_scope.local_mutations, false);
  assert.deepEqual(coverage.pipelines, {
    status: 'Verified empty',
    definitions_observed: 0,
    evidence: 'The authenticated source Pipelines screen showed the new-pipeline onboarding empty state and no configured pipeline rows.',
  });
  assert.deepEqual(coverage.approval_processes, {
    status: 'Verified empty',
    definitions_observed: 0,
    evidence: 'The authenticated source Approval Processes table explicitly stated that no approval process is configured.',
  });
  assert.deepEqual(coverage.validation_rules.verified_empty_modules, VERIFIED_EMPTY_MODULES);
  assert.deepEqual(coverage.validation_rules.unresolved_modules, UNRESOLVED_MODULES);
  assert.deepEqual(coverage.validation_rules.rate_limited_modules, RATE_LIMITED_MODULES);
  assert.deepEqual(coverage.validation_rules.not_yet_audited_modules, NOT_YET_AUDITED_MODULES);
  assert.equal(coverage.validation_rules.verified_empty_module_count, 8);
  assert.equal(coverage.validation_rules.unresolved_module_count, 20);
  assert.equal(coverage.execution_boundary.unresolved_behavior, 'Deny');
});

test('rejects attempts to relabel an unresolved validation scope as verified empty', () => {
  const changed = clone(rawCoverage);
  changed.validation_rules.verified_empty_modules.push('Contacts');
  changed.validation_rules.verified_empty_module_count += 1;
  changed.validation_rules.unresolved_modules.shift();
  changed.validation_rules.unresolved_module_count -= 1;
  assert.throws(() => buildSetupProcessCoverage(changed), /source review/);
});

test('rejects mutation claims, sensitive values, and unreviewed source process definitions', () => {
  const mutation = clone(rawCoverage);
  mutation.evidence_scope.mutation_attempted = true;
  assert.throws(() => buildSetupProcessCoverage(mutation), /source review/);

  const sensitive = clone(rawCoverage);
  sensitive.pipelines.url = 'https://example.invalid';
  assert.throws(() => buildSetupProcessCoverage(sensitive), /forbidden sensitive key/);

  const processDefinition = clone(rawCoverage);
  processDefinition.approval_processes.definitions_observed = 1;
  assert.throws(() => buildSetupProcessCoverage(processDefinition), /source review/);
});

test('server and automation UI expose the reviewed setup evidence and preserve the fail-closed boundary', () => {
  const server = fs.readFileSync(path.resolve(__dirname, '..', 'server.js'), 'utf8');
  const app = fs.readFileSync(path.resolve(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.match(server, /getSetupProcessCoverage/);
  assert.match(server, /app\.get\('\/api\/meta\/setup_process_coverage'/);
  assert.match(app, /\/api\/meta\/setup_process_coverage/);
  assert.match(app, /verified empty/);
  assert.match(app, /unresolved/);
  assert.match(app, /zero configured pipelines and zero approval processes/);
  assert.match(app, /all unverified rule execution remains denied/i);
});
