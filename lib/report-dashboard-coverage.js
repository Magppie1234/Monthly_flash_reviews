'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CONFIG_PATH = path.resolve(__dirname, '..', 'config', 'report-dashboard-coverage.json');

const EXPECTED_COUNTS = Object.freeze({
  reports: 202,
  report_categories: 29,
  dashboards: 32,
  verified_private_report_exports: 1,
  verified_private_export_rows: 226,
});

const EXPECTED_SELECTED_DASHBOARD = Object.freeze({
  name: "Installation's Head Dashboard",
  components: Object.freeze([
    'Raw Leads Qualified Leads Accounts Orders Sales Standup',
    'Tasks Meetings Calls',
    'Visit Module',
    'Projects',
    'Visit A X Orders',
    'AMS/Complaints',
    'Approval for Dispatch',
    'Start Again Installation (Complaint Closed)',
    'Installation Progress',
    'New Installations',
    'Status wise Complaints',
    'Complaint Raised Ticket Status',
    'Orders by Installation Manager',
    'Visits Have to Mark Done',
    'Visits by Installation Manager',
    'Client wise Installation Manager',
    'Installation Progress by Client',
    'Orders by Team Members',
    'Settings Page',
    'Search, Refine, Review and Act - All in one place',
  ]),
});

const FORBIDDEN_KEYS = new Set([
  'credential', 'credentials', 'data', 'hash', 'href', 'id', 'organization_id', 'org_id',
  'path', 'private_path', 'recipient', 'recipients', 'report_id', 'rows', 'sha256', 'token',
  'url', 'urls',
]);

const FORBIDDEN_VALUE_PATTERNS = [
  /https?:\/\//i,
  /\bwww\./i,
  /\/(?:Users|home|var|tmp|opt|etc)\//i,
  /\.private\//i,
  /\borg\d{6,}\b/i,
  /\b\d{15,}\b/,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\bbearer\s+[A-Z0-9._~+/=-]{8,}/i,
  /\b(?:api[_ -]?key|authorization|password|secret|token|credential)\b\s*(?:[:=]|is)\s*["']?[A-Z0-9._~+/=-]{8,}/i,
  /\b[A-F0-9]{32,128}\b/i,
];

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredObject(value, label) {
  if (!isObject(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function requiredString(value, label, maxLength = 500) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new Error(`${label} must be a non-empty bounded string.`);
  }
  return value.trim();
}

function requiredBoolean(value, label) {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean.`);
  return value;
}

function requiredCount(value, expected, label) {
  if (!Number.isInteger(value) || value !== expected) {
    throw new Error(`${label} does not match the reconciled value ${expected}.`);
  }
  return expected;
}

function assertNoSensitivePublicData(value) {
  if (Array.isArray(value)) {
    value.forEach(assertNoSensitivePublicData);
    return;
  }
  if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
        throw new Error('Report/dashboard coverage contains a forbidden sensitive key.');
      }
      assertNoSensitivePublicData(child);
    }
    return;
  }
  if (typeof value === 'string' && FORBIDDEN_VALUE_PATTERNS.some(pattern => pattern.test(value))) {
    throw new Error('Report/dashboard coverage contains a forbidden sensitive value.');
  }
}

function exactStringArray(value, expected, label) {
  if (!Array.isArray(value) || value.length !== expected.length) {
    throw new Error(`${label} does not match the reconciled component count.`);
  }
  return expected.map((expectedValue, index) => {
    const actual = requiredString(value[index], `${label}[${index}]`, 240);
    if (actual !== expectedValue) throw new Error(`${label}[${index}] does not match private discovery evidence.`);
    return actual;
  });
}

function reportIdFromHref(href) {
  return String(href || '').split('/').filter(Boolean).at(-1) || '';
}

function buildReportDashboardCoverage(privateUi, privateExportManifest) {
  const ui = requiredObject(privateUi, 'private report/dashboard discovery');
  const manifest = requiredObject(privateExportManifest, 'private report export manifest');
  const reports = Array.isArray(ui.all_reports) ? ui.all_reports : (Array.isArray(ui.reports) ? ui.reports : []);
  const categories = Array.isArray(ui.report_categories) ? ui.report_categories : [];
  const dashboards = Array.isArray(ui.dashboard_names) ? ui.dashboard_names : [];
  const currentDashboard = requiredObject(ui.current_dashboard, 'current_dashboard');
  const exports = Array.isArray(manifest.exports) ? manifest.exports : [];
  const verifiedExports = exports.filter(item => item?.status === 'verified');

  requiredCount(reports.length, EXPECTED_COUNTS.reports, 'report count');
  requiredCount(categories.length, EXPECTED_COUNTS.report_categories, 'report category count');
  requiredCount(dashboards.length, EXPECTED_COUNTS.dashboards, 'dashboard count');
  requiredCount(verifiedExports.length, EXPECTED_COUNTS.verified_private_report_exports, 'verified private export count');
  requiredCount(Number(verifiedExports[0]?.row_count), EXPECTED_COUNTS.verified_private_export_rows, 'verified private export row count');

  const reportIds = new Set(reports.map(report => reportIdFromHref(report?.href)).filter(Boolean));
  if (!verifiedExports.every(item => item.report_id && reportIds.has(String(item.report_id)))) {
    throw new Error('Verified private report export is not reconciled to the discovered report catalog.');
  }

  const selectedName = requiredString(currentDashboard.name, 'current_dashboard.name', 240);
  if (selectedName !== EXPECTED_SELECTED_DASHBOARD.name) {
    throw new Error('Selected dashboard name does not match private discovery evidence.');
  }
  const componentNames = exactStringArray(
    currentDashboard.components,
    EXPECTED_SELECTED_DASHBOARD.components,
    'current_dashboard.components',
  );

  const output = {
    schema_version: 1,
    generated_at: requiredString(ui.generated_at, 'generated_at', 80),
    source_mode: 'read-only',
    evidence_mode: 'existing private discovery artifacts only',
    coverage: {
      reports: {
        discovered: EXPECTED_COUNTS.reports,
        categories: EXPECTED_COUNTS.report_categories,
        verified_private_exports: EXPECTED_COUNTS.verified_private_report_exports,
        verified_private_export_rows: EXPECTED_COUNTS.verified_private_export_rows,
        catalog_status: 'Reconciled',
        definition_parity: 'Blocked',
        local_execution: 'Blocked',
        local_result_parity: 'Blocked',
      },
      dashboards: {
        discovered: EXPECTED_COUNTS.dashboards,
        catalog_status: 'Reconciled',
        selected_dashboard: {
          name: selectedName,
          component_count: componentNames.length,
          component_names: componentNames,
        },
        definition_parity: 'Blocked',
        local_execution: 'Blocked',
        local_result_parity: 'Blocked',
      },
    },
    execution_boundary: {
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
    },
    privacy: {
      report_rows_exposed: false,
      customer_data_exposed: false,
      source_identifiers_exposed: false,
      urls_or_hrefs_exposed: false,
      recipients_exposed: false,
      private_paths_exposed: false,
      organization_identifiers_exposed: false,
      credentials_exposed: false,
      hashes_exposed: false,
    },
  };
  assertNoSensitivePublicData(output);
  return output;
}

function copyExecutionBoundary(value) {
  const boundary = requiredObject(value, 'execution_boundary');
  const booleanKeys = [
    'local_report_execution_enabled',
    'local_report_result_access_enabled',
    'local_dashboard_execution_enabled',
    'local_dashboard_result_access_enabled',
    'source_execution_enabled',
    'source_writes_enabled',
    'scheduled_delivery_enabled',
    'outbound_delivery_enabled',
  ];
  const output = Object.fromEntries(booleanKeys.map(key => {
    const enabled = requiredBoolean(boundary[key], `execution_boundary.${key}`);
    if (enabled !== false) throw new Error('Report/dashboard execution boundary must remain fail-closed.');
    return [key, false];
  }));
  output.status = requiredString(boundary.status, 'execution_boundary.status', 80);
  output.reason = requiredString(boundary.reason, 'execution_boundary.reason', 700);
  if (output.status !== 'Blocked') throw new Error('Report/dashboard execution boundary must remain Blocked.');
  return output;
}

function copyPrivacy(value) {
  const privacy = requiredObject(value, 'privacy');
  const keys = [
    'report_rows_exposed',
    'customer_data_exposed',
    'source_identifiers_exposed',
    'urls_or_hrefs_exposed',
    'recipients_exposed',
    'private_paths_exposed',
    'organization_identifiers_exposed',
    'credentials_exposed',
    'hashes_exposed',
  ];
  return Object.fromEntries(keys.map(key => {
    const exposed = requiredBoolean(privacy[key], `privacy.${key}`);
    if (exposed) throw new Error(`privacy.${key} must remain false.`);
    return [key, false];
  }));
}

function validateReportDashboardCoverage(rawCoverage) {
  assertNoSensitivePublicData(rawCoverage);
  const raw = requiredObject(rawCoverage, 'report/dashboard coverage');
  if (raw.schema_version !== 1) throw new Error('Report/dashboard coverage schema version is unsupported.');
  if (raw.source_mode !== 'read-only') throw new Error('Report/dashboard source mode must remain read-only.');
  const coverage = requiredObject(raw.coverage, 'coverage');
  const reports = requiredObject(coverage.reports, 'coverage.reports');
  const dashboards = requiredObject(coverage.dashboards, 'coverage.dashboards');
  const selected = requiredObject(dashboards.selected_dashboard, 'coverage.dashboards.selected_dashboard');
  const components = exactStringArray(selected.component_names, EXPECTED_SELECTED_DASHBOARD.components, 'selected dashboard components');
  const selectedName = requiredString(selected.name, 'selected dashboard name', 240);
  if (selectedName !== EXPECTED_SELECTED_DASHBOARD.name) throw new Error('Selected dashboard name does not reconcile.');
  requiredCount(selected.component_count, components.length, 'selected dashboard component count');

  const output = {
    schema_version: 1,
    generated_at: requiredString(raw.generated_at, 'generated_at', 80),
    source_mode: 'read-only',
    evidence_mode: requiredString(raw.evidence_mode, 'evidence_mode', 120),
    coverage: {
      reports: {
        discovered: requiredCount(reports.discovered, EXPECTED_COUNTS.reports, 'coverage.reports.discovered'),
        categories: requiredCount(reports.categories, EXPECTED_COUNTS.report_categories, 'coverage.reports.categories'),
        verified_private_exports: requiredCount(reports.verified_private_exports, EXPECTED_COUNTS.verified_private_report_exports, 'coverage.reports.verified_private_exports'),
        verified_private_export_rows: requiredCount(reports.verified_private_export_rows, EXPECTED_COUNTS.verified_private_export_rows, 'coverage.reports.verified_private_export_rows'),
        catalog_status: requiredString(reports.catalog_status, 'coverage.reports.catalog_status', 80),
        definition_parity: requiredString(reports.definition_parity, 'coverage.reports.definition_parity', 80),
        local_execution: requiredString(reports.local_execution, 'coverage.reports.local_execution', 80),
        local_result_parity: requiredString(reports.local_result_parity, 'coverage.reports.local_result_parity', 80),
      },
      dashboards: {
        discovered: requiredCount(dashboards.discovered, EXPECTED_COUNTS.dashboards, 'coverage.dashboards.discovered'),
        catalog_status: requiredString(dashboards.catalog_status, 'coverage.dashboards.catalog_status', 80),
        selected_dashboard: { name: selectedName, component_count: components.length, component_names: components },
        definition_parity: requiredString(dashboards.definition_parity, 'coverage.dashboards.definition_parity', 80),
        local_execution: requiredString(dashboards.local_execution, 'coverage.dashboards.local_execution', 80),
        local_result_parity: requiredString(dashboards.local_result_parity, 'coverage.dashboards.local_result_parity', 80),
      },
    },
    execution_boundary: copyExecutionBoundary(raw.execution_boundary),
    privacy: copyPrivacy(raw.privacy),
  };

  for (const section of [output.coverage.reports, output.coverage.dashboards]) {
    if (section.catalog_status !== 'Reconciled'
      || section.definition_parity !== 'Blocked'
      || section.local_execution !== 'Blocked'
      || section.local_result_parity !== 'Blocked') {
      throw new Error('Report/dashboard coverage must remain catalog-only and fail-closed.');
    }
  }
  assertNoSensitivePublicData(output);
  return output;
}

function readCoverageConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function blockedOperation(operation) {
  const error = new Error(`${operation} is blocked: local report/dashboard execution and result parity are not implemented.`);
  error.code = 'REPORT_DASHBOARD_EXECUTION_BLOCKED';
  throw error;
}

function createReportDashboardRuntimeAdapter(rawCoverage = readCoverageConfig()) {
  const coverage = validateReportDashboardCoverage(rawCoverage);
  return Object.freeze({
    getCoverage: () => structuredClone(coverage),
    executeReport: () => blockedOperation('Report execution'),
    getReportResults: () => blockedOperation('Report result access'),
    executeDashboard: () => blockedOperation('Dashboard execution'),
    getDashboardResults: () => blockedOperation('Dashboard result access'),
  });
}

function getReportDashboardCoverage() {
  return createReportDashboardRuntimeAdapter().getCoverage();
}

module.exports = {
  EXPECTED_COUNTS,
  EXPECTED_SELECTED_DASHBOARD,
  assertNoSensitivePublicData,
  buildReportDashboardCoverage,
  validateReportDashboardCoverage,
  createReportDashboardRuntimeAdapter,
  getReportDashboardCoverage,
};
