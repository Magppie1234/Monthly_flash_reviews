'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const coverageConfig = require('../config/report-dashboard-coverage.json');
const {
  EXPECTED_COUNTS,
  EXPECTED_SELECTED_DASHBOARD,
  buildReportDashboardCoverage,
  validateReportDashboardCoverage,
  createReportDashboardRuntimeAdapter,
  getReportDashboardCoverage,
} = require('../lib/report-dashboard-coverage');

const root = path.join(__dirname, '..');

function collectKeys(value, output = []) {
  if (Array.isArray(value)) {
    value.forEach(item => collectKeys(item, output));
    return output;
  }
  if (!value || typeof value !== 'object') return output;
  for (const [key, child] of Object.entries(value)) {
    output.push(key.toLowerCase());
    collectKeys(child, output);
  }
  return output;
}

test('public coverage reconciles exact report, category, dashboard, export, and row counts', () => {
  const coverage = validateReportDashboardCoverage(coverageConfig);
  assert.deepEqual(EXPECTED_COUNTS, {
    reports: 202,
    report_categories: 29,
    dashboards: 32,
    verified_private_report_exports: 1,
    verified_private_export_rows: 226,
  });
  assert.equal(coverage.coverage.reports.discovered, 202);
  assert.equal(coverage.coverage.reports.categories, 29);
  assert.equal(coverage.coverage.reports.verified_private_exports, 1);
  assert.equal(coverage.coverage.reports.verified_private_export_rows, 226);
  assert.equal(coverage.coverage.dashboards.discovered, 32);
  assert.equal(coverage.coverage.dashboards.selected_dashboard.component_count, 20);
  assert.deepEqual(coverage.coverage.dashboards.selected_dashboard.component_names, [...EXPECTED_SELECTED_DASHBOARD.components]);
});

test('selected dashboard component names match existing private discovery evidence exactly', () => {
  const privateUi = JSON.parse(fs.readFileSync(path.join(root, '.private', 'zoho-discovery', 'report-dashboard-ui.json'), 'utf8'));
  assert.equal(privateUi.current_dashboard.name, EXPECTED_SELECTED_DASHBOARD.name);
  assert.deepEqual(privateUi.current_dashboard.components, [...EXPECTED_SELECTED_DASHBOARD.components]);
});

test('private artifacts build only the allowlisted data-free coverage payload', () => {
  const privateUi = JSON.parse(fs.readFileSync(path.join(root, '.private', 'zoho-discovery', 'report-dashboard-ui.json'), 'utf8'));
  const privateExport = JSON.parse(fs.readFileSync(path.join(root, '.private', 'zoho-discovery', 'report-export-manifest.json'), 'utf8'));
  privateUi.report_rows = [{ customer_name: 'must not appear', value: 100 }];
  privateUi.unreviewed_url = 'https://example.invalid/private';
  privateExport.exports[0].recipients = ['person@example.invalid'];
  privateExport.exports[0].private_path = '/Users/example/private-export.csv';
  privateExport.exports[0].hash = 'a'.repeat(64);
  const output = buildReportDashboardCoverage(privateUi, privateExport);
  const serialized = JSON.stringify(output);
  assert.equal(serialized.includes(privateUi.all_reports[0].label), false);
  assert.doesNotMatch(serialized, /customer_name|must not appear|example\.invalid|person@|\/Users\/|a{64}/i);
  assert.equal(output.coverage.reports.verified_private_exports, 1);
  assert.equal(output.coverage.reports.verified_private_export_rows, 226);
});

test('public artifacts exclude identifiers, report rows, customer data, URLs, recipients, paths, credentials, and hashes', () => {
  const forbiddenKeys = new Set([
    'credential', 'credentials', 'data', 'hash', 'href', 'id', 'organization_id', 'org_id',
    'path', 'private_path', 'recipient', 'recipients', 'report_id', 'rows', 'sha256', 'token',
    'url', 'urls',
  ]);
  const keys = collectKeys(coverageConfig);
  assert.equal(keys.find(key => forbiddenKeys.has(key)), undefined);

  const document = fs.readFileSync(path.join(root, 'ZOHO_REPORT_DASHBOARD_INVENTORY.md'), 'utf8');
  const serialized = `${JSON.stringify(coverageConfig)}\n${document}`;
  assert.doesNotMatch(serialized, /https?:\/\//i);
  assert.doesNotMatch(serialized, /\bwww\./i);
  assert.doesNotMatch(serialized, /\/(?:Users|home|var|tmp|opt|etc)\//i);
  assert.doesNotMatch(serialized, /\.private\//i);
  assert.doesNotMatch(serialized, /\borg\d{6,}\b/i);
  assert.doesNotMatch(serialized, /\b\d{15,}\b/);
  assert.doesNotMatch(serialized, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  assert.doesNotMatch(serialized, /\b[A-F0-9]{32,128}\b/i);
});

test('runtime adapter returns fresh coverage while every execution and result method fails closed', () => {
  const first = getReportDashboardCoverage();
  const second = getReportDashboardCoverage();
  assert.notStrictEqual(first, second);
  assert.notStrictEqual(first.coverage, second.coverage);
  assert.notStrictEqual(first.coverage.dashboards.selected_dashboard.component_names, second.coverage.dashboards.selected_dashboard.component_names);
  first.coverage.dashboards.selected_dashboard.component_names.push('Synthetic');
  assert.doesNotMatch(JSON.stringify(second), /Synthetic/);

  const adapter = createReportDashboardRuntimeAdapter();
  for (const method of ['executeReport', 'getReportResults', 'executeDashboard', 'getDashboardResults']) {
    assert.throws(() => adapter[method](), error => error?.code === 'REPORT_DASHBOARD_EXECUTION_BLOCKED');
  }
  assert.deepEqual(adapter.getCoverage().execution_boundary, {
    local_report_execution_enabled: false,
    local_report_result_access_enabled: false,
    local_dashboard_execution_enabled: false,
    local_dashboard_result_access_enabled: false,
    source_execution_enabled: false,
    source_writes_enabled: false,
    scheduled_delivery_enabled: false,
    outbound_delivery_enabled: false,
    status: 'Blocked',
    reason: 'Catalog and one private export count are evidence only; report queries, report results, dashboard calculations, and delivery remain unavailable locally.',
  });
});

test('runtime validation rejects count drift, component drift, enabled execution, and sensitive additions', () => {
  const wrongCount = structuredClone(coverageConfig);
  wrongCount.coverage.reports.discovered = 201;
  assert.throws(() => validateReportDashboardCoverage(wrongCount), /reconciled value/i);

  const wrongComponent = structuredClone(coverageConfig);
  wrongComponent.coverage.dashboards.selected_dashboard.component_names[0] = 'Changed';
  assert.throws(() => validateReportDashboardCoverage(wrongComponent), /private discovery evidence/i);

  const enabled = structuredClone(coverageConfig);
  enabled.execution_boundary.local_report_execution_enabled = true;
  assert.throws(() => validateReportDashboardCoverage(enabled), /fail-closed/i);

  const sensitiveKey = structuredClone(coverageConfig);
  sensitiveKey.url = 'omitted';
  assert.throws(() => validateReportDashboardCoverage(sensitiveKey), /forbidden sensitive key/i);

  const sensitiveValue = structuredClone(coverageConfig);
  sensitiveValue.execution_boundary.reason = 'Read https://example.invalid/report';
  assert.throws(() => validateReportDashboardCoverage(sensitiveValue), /forbidden sensitive value/i);
});
