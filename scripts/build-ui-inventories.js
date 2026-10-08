#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  buildReportDashboardCoverage,
  validateReportDashboardCoverage,
} = require('../lib/report-dashboard-coverage');

const root = path.join(__dirname, '..');
const privateUiPath = path.join(root, '.private', 'zoho-discovery', 'report-dashboard-ui.json');
const privateExportManifestPath = path.join(root, '.private', 'zoho-discovery', 'report-export-manifest.json');
const publicConfigPath = path.join(root, 'config', 'report-dashboard-coverage.json');
const publicDocumentPath = path.join(root, 'ZOHO_REPORT_DASHBOARD_INVENTORY.md');

function readRequiredPrivateJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    throw new Error(`Required private ${label} artifact is unavailable or invalid.`);
  }
}

function markdown(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ').trim();
}

function renderCoverageDocument(coverage) {
  const reports = coverage.coverage.reports;
  const dashboards = coverage.coverage.dashboards;
  const selected = dashboards.selected_dashboard;
  const lines = [
    '# Zoho CRM Report and Dashboard Coverage',
    '',
    `Generated from existing authenticated read-only discovery evidence: ${markdown(coverage.generated_at)}`,
    '',
    'This is a data-free coverage artifact. It contains catalog counts and the currently selected dashboard component names only.',
    '',
    '## Reconciled Coverage',
    '',
    '| Area | Discovered | Verified Private Export Coverage | Local Definition Parity | Local Execution | Local Result Parity |',
    '| --- | ---: | --- | --- | --- | --- |',
    `| Reports | ${reports.discovered} across ${reports.categories} categories | ${reports.verified_private_exports}/${reports.discovered} exports; ${reports.verified_private_export_rows} rows counted privately | ${reports.definition_parity} | ${reports.local_execution} | ${reports.local_result_parity} |`,
    `| Dashboards | ${dashboards.discovered} | Selected dashboard structure only | ${dashboards.definition_parity} | ${dashboards.local_execution} | ${dashboards.local_result_parity} |`,
    '',
    `## Current Selected Dashboard — ${markdown(selected.name)}`,
    '',
    `Components captured: ${selected.component_count}.`,
    '',
    '| # | Component Name |',
    '| ---: | --- |',
    ...selected.component_names.map((name, index) => `| ${index + 1} | ${markdown(name)} |`),
    '',
    '## Runtime Boundary',
    '',
    '- Report query execution is blocked.',
    '- Report result access and row parity are blocked.',
    '- Dashboard calculation and result access are blocked.',
    '- Source execution, source writes, scheduled delivery, and outbound delivery are blocked.',
    '- The single verified export proves only that one private export contained 226 rows; it does not establish definition or result parity for the remaining reports.',
    '',
    '## Public Artifact Privacy',
    '',
    'The generated JSON and this document exclude report rows, customer data, source identifiers, URLs and hrefs, recipients, private paths, organization identifiers, credentials, and hashes.',
  ];
  return `${lines.join('\n').trim()}\n`;
}

function writeAtomic(filePath, payload) {
  const temporary = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, payload, { encoding: 'utf8', flag: 'wx' });
  fs.renameSync(temporary, filePath);
}

function main() {
  const privateUi = readRequiredPrivateJson(privateUiPath, 'report/dashboard discovery');
  const privateExportManifest = readRequiredPrivateJson(privateExportManifestPath, 'report export manifest');
  const coverage = buildReportDashboardCoverage(privateUi, privateExportManifest);
  const validated = validateReportDashboardCoverage(coverage);
  writeAtomic(publicConfigPath, `${JSON.stringify(validated, null, 2)}\n`);
  writeAtomic(publicDocumentPath, renderCoverageDocument(validated));
  console.log(`UI coverage built: ${validated.coverage.reports.discovered} reports, ${validated.coverage.reports.categories} categories, ${validated.coverage.dashboards.discovered} dashboards; execution blocked.`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { main, renderCoverageDocument };
