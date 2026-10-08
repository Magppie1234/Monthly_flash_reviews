// MAGPPIE CRM — standalone CRM backed by its own Supabase database.
// The interactive UI reads and writes only the local database. Optional Zoho
// access is permanently constrained to GET/HEAD for discovery and replication.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const { ValidationError, validatePayload } = require('./lib/crm-validation');
const { LayoutSchemaError, asLayoutId, mergeLayoutFields, recordLayoutId, resolveLayout } = require('./lib/layout-schema');
const {
  BlueprintTransitionError,
  localExecutionReadiness,
  transitionEligible,
  transitionStateValue,
  validateTransitionPayload,
} = require('./lib/blueprint-engine');
const { getBlueprintStudioCatalog } = require('./lib/blueprint-studio');
const {
  BlueprintAtomicRuntimeError,
  createBlueprintAtomicRuntime,
} = require('./lib/blueprint-atomic-runtime');
const { getBlueprintIdentityAuthorizationStatus } = require('./lib/blueprint-identity-authorization');
const { verifyBlueprintTransitionRpc } = require('./scripts/verify-blueprint-transition-rpc');
const { publicErrorResponse } = require('./lib/public-error-response');
const { buildWorkflowStudioCatalog } = require('./lib/workflow-studio');
const { CustomViewFilterError, compileCustomViewFilter } = require('./lib/custom-view-filter');
const { buildFunctionBehaviorInventory } = require('./lib/function-behavior-inventory');
const { getWidgetBehaviorInventory } = require('./lib/widget-behavior-inventory');
const { getWidgetRuntimeCompatibility } = require('./lib/widget-runtime-compatibility');
const { getReportDashboardCoverage } = require('./lib/report-dashboard-coverage');
const { getPermissionCoverage } = require('./lib/permission-coverage');
const { getRuleLayoutCoverage } = require('./lib/rule-layout-coverage');
const { getMetadataParityAudit } = require('./lib/metadata-parity');
const { getSetupProcessCoverage } = require('./lib/setup-process-coverage');
const { getModuleReplicationCatalog } = require('./lib/module-replication-catalog');
const { executionPolicyDecision } = require('./lib/blueprint-execution-policy');
const { resolveRelatedListLinkFields } = require('./lib/related-list-resolver');
const { createIntervalRunner } = require('./lib/interval-runner');
const {
  emptyDeltaSyncState,
  normalizeDeltaSyncState,
  runZohoDeltaSync,
} = require('./lib/zoho-delta-sync');
const { createDeltaSyncLeaseClient } = require('./lib/delta-sync-lease');
const { createBoundedDeltaSyncJob } = require('./lib/delta-sync-job');
const {
  PAYMENT_MILESTONE_MODULE,
  createPaymentMilestoneSnapshotAdapter,
} = require('./lib/payment-milestone-snapshot');
const {
  buildReplicationHealth,
  classifyReconciliationEvidence,
  createBoundedSnapshotCache,
} = require('./lib/replication-health');
const { buildSourceDeletionReadiness } = require('./lib/source-deletion-readiness');
const { createKeyedTaskQueue } = require('./lib/keyed-task-queue');
const { createColdReadCoordinator } = require('./lib/cold-read-coordinator');
const { executeBoundedLocalRead } = require('./lib/local-read-retry');
const {
  DEFAULT_DATA_COMPLETENESS_CACHE_TTL_MS,
  createDataCompletenessCache,
} = require('./lib/data-completeness-cache');
const { createHomeDashboardService } = require('./lib/home-dashboard-service');
const { createZohoOrgGuard, EXPECTED_ZOHO_ZGID } = require('./lib/zoho-org-guard');
const { buildJourneyDashboard, LANE_DEFINITIONS, normalizeDrilldownValues } = require('./lib/journey-dashboard');
const { createAnalyticsOverviewService } = require('./lib/crm-analytics-overview');
const { createCrmAgentRouteService, mountCrmAgentRoutes } = require('./lib/crm-agent-server');
const { createIntegrationRouter } = require('./lib/integration-router');
const blueprintConfig = require('./config/blueprints.json');
const blueprintTransitionDetails = require('./config/blueprint-transition-details.json');
const blueprintExecutionPolicies = require('./config/blueprint-execution-policies.json');
const customButtonConfig = require('./config/custom-buttons.json');
const activeFunctionBehaviorConfig = require('./config/active-function-behavior-inventory.json');
const dataCompletenessConfig = require('./config/data-completeness.json');
const taskSubformReconciliationConfig = require('./config/task-subform-reconciliation.json');
const workflowRuntimeConfig = require('./config/workflow-runtime.json');

const PRIVATE_TASK_SUBFORM_AUDIT = path.join(__dirname, '.private', 'data-reconciliation', 'tasks-subforms-latest.json');
const PRIVATE_NOTES_AUDIT = path.join(__dirname, '.private', 'data-reconciliation', 'notes-latest.json');
const COMPLETENESS_FORBIDDEN_KEYS = new Set([
  'authorization', 'body', 'code', 'content', 'cookie', 'credential', 'credentials',
  'hash', 'href', 'local_only_ids', 'local_only_ids_sha256', 'password', 'path',
  'payload', 'payloads', 'private_path', 'secret', 'sha256', 'source_ids',
  'source_ids_sha256', 'source_only_ids', 'source_only_ids_sha256', 'token', 'url', 'urls',
]);
const COMPLETENESS_FORBIDDEN_VALUES = [
  /https?:\/\//i,
  /\bwww\./i,
  /\/(?:Users|home|var|tmp|opt|etc)\//i,
  /\.private\//i,
  /\borg\d{6,}\b/i,
  /\b\d{15,25}\b/,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\bbearer\s+[A-Z0-9._~+/=-]{8,}/i,
  /\b(?:api[_ -]?key|authorization|password|secret|token|credential)\b\s*(?:[:=]|is)\s*["']?[A-Z0-9._~+/=-]{8,}/i,
];

function completenessCount(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${label} must be a non-negative safe integer.`);
  return parsed;
}

function completenessText(value, label, maxLength = 1200) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) throw new Error(`${label} must be a bounded non-empty string.`);
  return value.trim();
}

function assertSafeCompletenessOutput(value, currentPath = 'data_completeness') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeCompletenessOutput(item, `${currentPath}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (COMPLETENESS_FORBIDDEN_KEYS.has(key.toLowerCase())) throw new Error(`Data-completeness output contains forbidden field ${currentPath}.${key}.`);
      assertSafeCompletenessOutput(child, `${currentPath}.${key}`);
    }
    return;
  }
  if (typeof value === 'string' && COMPLETENESS_FORBIDDEN_VALUES.some(pattern => pattern.test(value))) {
    throw new Error(`Data-completeness output contains a forbidden value at ${currentPath}.`);
  }
}

function loadRestrictedPrivateJson(filePath) {
  const stat = fs.statSync(filePath);
  if ((stat.mode & 0o077) !== 0) throw new Error('Private reconciliation evidence permissions are too broad.');
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function privateTaskSubformDigests() {
  try {
    const audit = loadRestrictedPrivateJson(PRIVATE_TASK_SUBFORM_AUDIT);
    if (
      audit?.status !== 'reconciled'
      || audit?.source_mode !== 'read-only'
      || audit?.completed_at !== taskSubformReconciliationConfig.audited_at
      || !Array.isArray(audit?.modules)
    ) return new Map();
    const configuredDatasets = new Map(taskSubformReconciliationConfig.datasets.map(dataset => [dataset.module, dataset]));
    const digests = new Map();
    audit.modules.forEach(module => {
      const configured = configuredDatasets.get(module?.module);
      const sourceDigest = String(module?.source_ids_sha256 || '').toLowerCase();
      const localDigest = String(module?.local_source_ids_sha256_after || '').toLowerCase();
      const sourceCount = Number(module?.source_enumerated_count);
      const localCount = Number(module?.local_source_id_count_after);
      if (
        configured
        && /^[a-f0-9]{64}$/.test(sourceDigest)
        && sourceDigest === localDigest
        && Number.isSafeInteger(sourceCount)
        && sourceCount === Number(configured.source_active_ids)
        && localCount === sourceCount
        && Number(module?.source_only_count_after) === 0
        && Number(module?.local_only_count_after) === 0
      ) digests.set(module.module, sourceDigest);
    });
    return digests;
  } catch {
    return new Map();
  }
}

function privateNotesAudit() {
  try {
    const audit = loadRestrictedPrivateJson(PRIVATE_NOTES_AUDIT);
    const completedAt = String(audit?.completed_at || '');
    const sourceDigest = String(audit?.source_ids_sha256 || '').toLowerCase();
    const localDigest = String(audit?.local_source_ids_sha256 || '').toLowerCase();
    const sourceCount = Number(audit?.source_active_id_count);
    const localCount = Number(audit?.local_source_derived_id_count);
    if (
      audit?.dataset !== 'Notes'
      || audit?.status !== 'reconciled'
      || audit?.source_mode !== 'read-only'
      || completedAt !== dataCompletenessConfig.audited_at
      || !Array.isArray(audit?.crm_methods_used)
      || audit.crm_methods_used.some(method => method !== 'GET')
      || !/^[a-f0-9]{64}$/.test(sourceDigest)
      || sourceDigest !== localDigest
      || sourceCount !== Number(dataCompletenessConfig.notes.source_active_id_count)
      || localCount !== sourceCount
      || Number(audit?.source_only_id_count) !== 0
      || Number(audit?.local_only_source_id_count) !== 0
      || Number(audit?.source_record_writes) !== 0
      || Number(audit?.local_record_writes) !== 0
      || Number(audit?.local_record_deletes) !== 0
    ) return null;
    return { completed_at: completedAt, source_count: sourceCount, local_count: localCount, set_digest: sourceDigest };
  } catch {
    return null;
  }
}

const app = express();
app.use(express.json({ limit: '2mb' }));

const PORT = process.env.CLONE_PORT || 3100;
const HOST = process.env.CLONE_HOST || '127.0.0.1';
const SUPA = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY;
const SECRET = process.env.CRM_SQL_SECRET;

const VERCEL_CRON_DELTA_SYNC_PATH = '/api/cron/delta-sync';

function constantTimeStringEqual(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  const actualBytes = Buffer.from(actual, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  const comparisonLength = Math.max(actualBytes.length, expectedBytes.length, 1);
  const paddedActual = Buffer.alloc(comparisonLength);
  const paddedExpected = Buffer.alloc(comparisonLength);
  actualBytes.copy(paddedActual);
  expectedBytes.copy(paddedExpected);
  const contentMatches = crypto.timingSafeEqual(paddedActual, paddedExpected);
  return contentMatches && actualBytes.length === expectedBytes.length;
}

function isExactVercelCronDeltaSyncRequest(req) {
  return req?.method === 'GET' && req?.path === VERCEL_CRON_DELTA_SYNC_PATH;
}

const DELTA_SYNC_UNAVAILABLE_ERROR_CODES = new Set([
  'ZOHO_NOT_CONFIGURED',
  'ZOHO_ORG_MISMATCH',
  'ZOHO_ORG_VERIFICATION_FAILED',
  'LEASE_ACQUIRE_FAILED',
  'DELTA_SYNC_DEADLINE_EXCEEDED',
  'SNAPSHOT_STORAGE_UNVERIFIED',
  'SNAPSHOT_CAPABILITY_UNVERIFIED',
  'SNAPSHOT_STRATEGY_DRIFT',
  'SOURCE_REPLICATION_LOCK_MISMATCH',
]);

function createVercelCronDeltaSyncHandler({
  getCronSecret = () => process.env.CRON_SECRET,
  isConfigured = () => ZOHO_ON,
  trigger = options => deltaSyncRunner.trigger(options),
} = {}) {
  return async function handleVercelCronDeltaSync(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    const cronSecret = getCronSecret();
    if (typeof cronSecret !== 'string' || cronSecret.length === 0) {
      return res.status(503).json({ status: 'unavailable' });
    }

    const authorization = typeof req.get === 'function'
      ? req.get('authorization')
      : req.headers?.authorization;
    if (!constantTimeStringEqual(authorization, `Bearer ${cronSecret}`)) {
      return res.status(401).json({ status: 'unauthorized' });
    }
    if (!isConfigured()) return res.status(503).json({ status: 'unavailable' });

    try {
      const outcome = await trigger({ reason: 'vercel-cron' });
      if (outcome?.accepted === false) {
        return res.status(202).json({ status: 'already_running', accepted: false });
      }
      if (outcome?.accepted !== true || outcome?.result?.global_success !== true) {
        return res.status(503).json({ status: 'partial_refresh', global_success: false });
      }
      return res.status(200).json({ status: 'succeeded', global_success: true });
    } catch (error) {
      if (error?.code === 'DELTA_SYNC_ALREADY_RUNNING') {
        return res.status(202).json({ status: 'already_running', accepted: false });
      }
      if (error?.code === 'DELTA_SYNC_INCOMPLETE') {
        return res.status(503).json({ status: 'partial_refresh', global_success: false });
      }
      if (DELTA_SYNC_UNAVAILABLE_ERROR_CODES.has(error?.code)) {
        return res.status(503).json({ status: 'unavailable' });
      }
      return res.status(500).json({ status: 'failed' });
    }
  };
}

const vercelCronDeltaSyncHandler = createVercelCronDeltaSyncHandler({
  trigger: () => deltaSyncRunner.trigger({ reason: 'vercel-cron' }),
});

// This exact production-cron request is authenticated independently before the
// interactive CRM access gate. Every other method and path continues through
// the regular access policy below.
app.use((req, res, next) => {
  if (!isExactVercelCronDeltaSyncRequest(req)) return next();
  return vercelCronDeltaSyncHandler(req, res);
});

// ---------- access gate (enabled when ACCESS_CODE is set) ----------
const ACCESS_CODE = process.env.ACCESS_CODE || '';
const LOGIN_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MAGPPIE CRM — Sign in</title><style>body{font-family:'Inter',-apple-system,'Segoe UI',Roboto,sans-serif;background:linear-gradient(160deg,#f6f7f9,#eef0f7);display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{background:#fff;border:1px solid #e7e8ec;border-radius:20px;padding:38px 42px;width:330px;text-align:center;box-shadow:0 12px 40px rgba(20,22,35,.12)}
.lg{width:46px;height:46px;border-radius:14px;background:linear-gradient(135deg,#6366f1,#4338ca);color:#fff;font-weight:800;font-size:22px;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;box-shadow:0 6px 18px rgba(79,70,229,.35)}
h1{font-size:19px;margin:0 0 4px;letter-spacing:-.2px}h1 span{color:#4f46e5}p{color:#7c8291;font-size:13px;margin:0 0 22px}
input{width:100%;height:42px;border:1px solid #e7e8ec;border-radius:11px;padding:0 13px;font-size:14px;box-sizing:border-box;margin-bottom:12px;outline:none;font-family:inherit}
input:focus{border-color:#4f46e5;box-shadow:0 0 0 3px rgba(79,70,229,.12)}
button{width:100%;height:42px;border:none;border-radius:11px;background:#4f46e5;color:#fff;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit}
button:hover{background:#4338ca}
.err{color:#dc2626;font-size:12.5px;height:16px;margin-top:8px}</style></head><body>
<div class="card"><div class="lg">M</div><h1>MAGPPIE <span>CRM</span></h1><p>Enter access code to continue</p>
<input id="c" type="password" placeholder="Access code" autofocus>
<button onclick="go()">Sign in</button><div class="err" id="e"></div></div>
<script>function go(){fetch('/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:document.getElementById('c').value})}).then(r=>{if(r.ok)location.reload();else document.getElementById('e').textContent='Wrong code'})}
document.getElementById('c').addEventListener('keydown',e=>{if(e.key==='Enter')go()})</script></body></html>`;

app.post('/auth', (req, res) => {
  if (ACCESS_CODE && req.body?.code === ACCESS_CODE) {
    res.setHeader('Set-Cookie', `crm_auth=${encodeURIComponent(ACCESS_CODE)}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax`);
    return res.json({ ok: true });
  }
  res.status(401).json({ ok: false });
});

app.use((req, res, next) => {
  if (!ACCESS_CODE) return next();
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=').map(decodeURIComponent)).filter(p => p[0]));
  if (cookies.crm_auth === ACCESS_CODE) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'unauthorized' });
  res.status(401).type('html').send(LOGIN_HTML);
});

// Provider routes inherit the application access gate above and retain their
// own strict body validation, rate limits, confirmations and outbound flags.
app.use('/api/integrations', createIntegrationRouter());

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: res => res.setHeader('Cache-Control', 'no-cache, must-revalidate'),
}));

// build identity — lets the SPA detect a new deploy and reload itself
const BUILD = process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_URL || String(Date.now());
app.get('/api/version', (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ v: BUILD }); });

// never let the CDN cache API responses — version-skew between cached and live answers causes reload loops
app.use('/api', (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

// ---------- Zoho bridge (read-only source connection) ----------
const ZOHO_ON = !!(process.env.ZOHO_REFRESH_TOKEN && process.env.ZOHO_CLIENT_ID);
// Zoho CRM is the source of truth and must never be mutated by this replica.
// Keep this boundary in code so an environment-variable mistake cannot enable writes.
const ZOHO_SOURCE_MODE = 'read-only';
const ZOHO_SOURCE_ORG_ID = `org${EXPECTED_ZOHO_ZGID}`;
let zTok = { token: null, at: 0 };
async function zohoToken(signal) {
  if (zTok.token && Date.now() - zTok.at < 50 * 60 * 1000) return zTok.token;
  const r = await fetch(`${process.env.ZOHO_ACCOUNTS_URL}/oauth/v2/token?refresh_token=${process.env.ZOHO_REFRESH_TOKEN}&client_id=${process.env.ZOHO_CLIENT_ID}&client_secret=${process.env.ZOHO_CLIENT_SECRET}&grant_type=refresh_token`, { method: 'POST', signal });
  const j = await r.json();
  if (!j.access_token) throw new Error('zoho token failed');
  zTok = { token: j.access_token, at: Date.now() };
  return zTok.token;
}
async function zoho(pathname, opts = {}) {
  const method = String(opts.method || 'GET').toUpperCase();
  if (!['GET', 'HEAD'].includes(method)) {
    const e = new Error(`Zoho source is read-only; blocked ${method} request`);
    e.code = 'ZOHO_SOURCE_READ_ONLY';
    throw e;
  }
  const token = await zohoToken(opts.signal);
  const r = await fetch(`${process.env.ZOHO_API_DOMAIN}${pathname}`, {
    ...opts,
    headers: { Authorization: `Zoho-oauthtoken ${token}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) },
  });
  if (r.status === 204) return null;
  const body = await r.json().catch(() => null);
  if (r.status >= 400) throw new Error(`zoho ${r.status}: ${JSON.stringify(body).slice(0, 250)}`);
  return body;
}

// Verify the canonical public Zoho organization identifier before every
// refresh window. The short cache still forces a new check before the next
// scheduled 15-minute run, while coalescing concurrent manual requests.
const zohoOrgGuard = createZohoOrgGuard({
  loadOrg: ({ signal } = {}) => zoho('/crm/v8/org', { signal }),
});

const automationRef = (value, keys = ['id', 'name', 'api_name']) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out = {};
  keys.forEach(key => {
    if (['string', 'number', 'boolean'].includes(typeof value[key])) out[key] = value[key];
  });
  return Object.keys(out).length ? out : null;
};
const safeAutomationValue = (value, depth = 0) => {
  if (value === undefined) return null;
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (depth >= 5) return '[nested configuration omitted]';
  if (Array.isArray(value)) return value.map(item => safeAutomationValue(item, depth + 1));
  if (typeof value !== 'object') return String(value);
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (/(authorization|credential|secret|password|token|cookie|connection|header|endpoint|\burl\b)/i.test(key)) continue;
    out[key] = safeAutomationValue(child, depth + 1);
  }
  return out;
};
const sanitizeFieldUpdate = action => ({
  id: String(action.id),
  name: action.name || null,
  module: automationRef(action.module),
  related_module: automationRef(action.related_module),
  feature_type: action.feature_type || null,
  source: action.source || null,
  type: action.type || null,
  update_type: action.update_type || null,
  field: automationRef(action.field, ['id', 'api_name']),
  value: safeAutomationValue(action.value),
  display_value: safeAutomationValue(action.display_value),
  dependent_fields: safeAutomationValue(action.dependent_fields),
  associated: action.associated,
  editable: action.editable,
  deletable: action.deletable,
  local_execution: 'Blocked',
});
const sanitizeAutomationTask = action => ({
  id: String(action.id),
  name: action.name || null,
  module: automationRef(action.module),
  related_module: automationRef(action.related_module),
  feature_type: action.feature_type || null,
  source: action.source || null,
  notify: action.notify,
  field_mappings: (action.field_mappings || []).map(mapping => ({
    field: automationRef(mapping.field, ['id', 'api_name']),
    type: mapping.type || null,
    value: safeAutomationValue(mapping.value),
    display_value: safeAutomationValue(mapping.display_value),
  })),
  associated: action.associated,
  editable: action.editable,
  deletable: action.deletable,
  local_execution: 'Blocked',
});
const recipientShape = value => {
  const recipients = Array.isArray(value) ? value : [];
  return recipients.map(recipient => ({
    type: recipient?.type || recipient?.category || null,
    field: automationRef(recipient?.field || recipient?.details, ['id', 'api_name']),
    module: automationRef(recipient?.module),
    resource: automationRef(recipient?.resource, ['id', 'name', 'type']),
    literal_address_count: [recipient?.email, recipient?.email_address, recipient?.address, ...(Array.isArray(recipient?.details?.emails) ? recipient.details.emails : [])].filter(Boolean).length,
  }));
};
const sanitizeEmailNotification = action => ({
  id: String(action.id),
  name: action.name || null,
  module: automationRef(action.module),
  related_module: automationRef(action.related_module),
  template: automationRef(action.template),
  feature_type: action.feature_type || null,
  source: action.source || null,
  bulk_email: action.bulk_email,
  recipient_count: action.recipient_count ?? ['to', 'cc', 'bcc'].reduce((sum, key) => sum + (Array.isArray(action.recipients?.[key]) ? action.recipients[key].length : 0), 0),
  recipients: recipientShape(action.recipients?.to || action.to),
  cc_recipients: recipientShape(action.recipients?.cc || action.cc || action.cc_recipients),
  bcc_recipients: recipientShape(action.recipients?.bcc || action.bcc || action.bcc_recipients),
  from_address_configured: Boolean(action.from_address),
  reply_to_address_configured: Boolean(action.reply_to_address),
  associated: action.associated,
  editable: action.editable,
  deletable: action.deletable,
  local_execution: 'Blocked',
});
async function zohoAutomationActionDetails(responseKey, referencedIds = []) {
  let listed = [], page = 1;
  while (page <= 5) {
    const data = await zoho(`/crm/v8/settings/automation/${responseKey}?per_page=200&page=${page}`);
    listed.push(...(data?.[responseKey] || []));
    if (!data?.info?.more_records) break;
    page++;
  }
  const listedById = new Map(listed.map(action => [String(action.id), action]));
  for (const id of referencedIds) {
    if (!listedById.has(String(id))) listed.push({ id: String(id), referenced_only: true });
  }
  const detailed = [];
  for (let index = 0; index < listed.length; index += 4) {
    const batch = await Promise.all(listed.slice(index, index + 4).map(action => zoho(`/crm/v8/settings/automation/${responseKey}/${encodeURIComponent(action.id)}`).catch(() => null)));
    detailed.push(...batch.map((item, offset) => item?.[responseKey]?.[0] || (listed[index + offset].referenced_only ? null : listed[index + offset])).filter(Boolean));
  }
  return detailed;
}
// ---------- database helpers ----------
async function sql(q, { signal } = {}) {
  let r;
  try {
    r = await fetch(`${SUPA}/rest/v1/rpc/crm_sql`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, s: SECRET }),
      signal,
    });
  } catch (cause) {
    const error = new Error('The database transport is unavailable.');
    error.operation = 'crm_sql_transport';
    const transportCode = cause && typeof cause === 'object' && cause.cause && typeof cause.cause === 'object'
      ? cause.cause.code
      : null;
    if (typeof transportCode === 'string' && /^[A-Z0-9_]{3,40}$/i.test(transportCode)) error.transportCode = transportCode;
    if (cause && typeof cause === 'object' && typeof cause.name === 'string' && /^[A-Za-z]{3,30}$/.test(cause.name)) error.transportName = cause.name;
    throw error;
  }
  if (!r.ok) {
    const responseText = (await r.text()).slice(0, 300);
    const error = new Error('db ' + r.status + ': ' + responseText);
    error.operation = 'crm_sql';
    error.upstreamStatus = r.status;
    try {
      const databaseError = JSON.parse(responseText);
      if (/^[A-Z0-9]{5}$/i.test(String(databaseError?.code || ''))) error.dbCode = String(databaseError.code);
    } catch {}
    throw error;
  }
  return r.json();
}
async function rpc(fn, body, { signal } = {}) {
  const r = await fetch(`${SUPA}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, s: SECRET }),
    signal,
  });
  if (!r.ok) throw new Error(fn + ' ' + r.status + ': ' + (await r.text()).slice(0, 300));
  return r.json().catch(() => null);
}
const BLUEPRINT_DATABASE_ERRORS = new Map([
  ['40001|Blueprint expected-current-state conflict', ['40001', 'Blueprint expected-current-state conflict']],
  ['40001|Blueprint expected-modified-time conflict', ['40001', 'Blueprint expected-modified-time conflict']],
  ['P0002|Blueprint record not found', ['P0002', 'Blueprint record not found']],
]);
async function blueprintAtomicRpc(request, { signal } = {}) {
  const body = Object.freeze({ ...request, s: SECRET });
  const response = await fetch(`${SUPA}/rest/v1/rpc/crm_blueprint_transition`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    let databaseError = null;
    try {
      databaseError = JSON.parse((await response.text()).slice(0, 4000));
    } catch {}
    const safe = BLUEPRINT_DATABASE_ERRORS.get(`${databaseError?.code || ''}|${databaseError?.message || ''}`);
    const error = new Error('The atomic Blueprint transaction was rejected.');
    if (safe) [error.dbCode, error.dbMessage] = safe;
    throw error;
  }
  try {
    return await response.json();
  } catch {
    throw new Error('The atomic Blueprint transaction returned an invalid response.');
  }
}
const blueprintAtomicRuntime = createBlueprintAtomicRuntime({
  verify: ({ signal }) => verifyBlueprintTransitionRpc({ env: process.env, fetchImpl: fetch, signal }),
  callRpc: blueprintAtomicRpc,
  getIdentityAuthorizationStatus: getBlueprintIdentityAuthorizationStatus,
});
const lit = v => "'" + String(v).replace(/'/g, "''") + "'";
const ident = f => { if (!/^[A-Za-z0-9_$]+$/.test(f)) throw new Error('bad field'); return f; };
const USER_DATA_ONLY = "coalesce(data->>'__test_artifact','false') <> 'true'";
const relatedPage = query => {
  const parsedPage = Number.parseInt(query.page || '1', 10);
  const parsedPerPage = Number.parseInt(query.per_page || '100', 10);
  const page = Math.min(Math.max(Number.isFinite(parsedPage) ? parsedPage : 1, 1), 10000);
  const per_page = Math.min(Math.max(Number.isFinite(parsedPerPage) ? parsedPerPage : 100, 1), 200);
  return { page, per_page, offset: (page - 1) * per_page };
};
const paginatedRelatedResponse = (rows, pageInfo, extra = {}) => {
  const has_more = rows.length > pageInfo.per_page;
  const data = rows.slice(0, pageInfo.per_page).map(row => row.data);
  return {
    availability: 'queryable',
    data,
    pagination: {
      page: pageInfo.page,
      per_page: pageInfo.per_page,
      returned: data.length,
      has_more,
      limit_applied: true,
    },
    ...extra,
  };
};
const unresolvedRelatedResponse = (reason_code, message, extra = {}) => ({
  availability: 'unresolved',
  reason_code,
  message,
  data: [],
  pagination: null,
  ...extra,
});
const ownErrorValue = (error, key) => {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, key);
    return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value') ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
};
const wrap = (res, fn) => fn().then(d => res.json(d)).catch(error => {
  const controlledClass = error instanceof ValidationError
    || error instanceof LayoutSchemaError
    || error instanceof BlueprintTransitionError
    || error instanceof BlueprintAtomicRuntimeError
    || error instanceof CustomViewFilterError;
  const details = ownErrorValue(error, error instanceof ValidationError ? 'errors' : 'details');
  const exposed = publicErrorResponse(error, { controlledClass, includeDetails: controlledClass, details });
  return res.status(exposed.status).json(exposed.body);
});

const activeBlueprintsFor = module => blueprintConfig.blueprints.filter(blueprint => blueprint.module === module && blueprint.status === 'Active');
const blueprintMatchesRecord = (blueprint, record) => {
  const scopedLayoutId = asLayoutId(blueprint?.layout?.id);
  const storedLayoutId = recordLayoutId(record);
  if (scopedLayoutId && storedLayoutId !== scopedLayoutId) return false;
  return (blueprint.entry_criteria || []).every(criterion => {
    if (criterion.operator !== 'equal') return false;
    const value = record?.[criterion.field];
    const scalarValue = value && typeof value === 'object' ? (value.actual_value || value.display_value || value.name || value.id) : value;
    return String(scalarValue ?? '') === String(criterion.value ?? '');
  });
};
const activeBlueprintFor = (module, record = null) => {
  const blueprints = activeBlueprintsFor(module).sort((a, b) => (b.entry_criteria?.length || 0) - (a.entry_criteria?.length || 0));
  return record ? blueprints.find(blueprint => blueprintMatchesRecord(blueprint, record)) : blueprints[0];
};
async function activeBlueprintForRecord(module, record) {
  if (!record || recordLayoutId(record)) return activeBlueprintFor(module, record);
  const layoutResolution = resolveLayout(await meta(`layouts:${module}`), { record });
  if (!layoutResolution.exact || !layoutResolution.layout?.id || layoutResolution.source !== 'only_active_layout') return null;
  return activeBlueprintFor(module, { ...record, Layout: { id: String(layoutResolution.layout.id) } });
}
const transitionDetailFor = (blueprint, transitionId) => blueprintTransitionDetails.blueprints?.[String(blueprint?.id)]?.transitions?.[String(transitionId)] || null;
const transitionPolicyReadinessFor = (blueprint, transition, definition) => {
  const readiness = localExecutionReadiness(definition, transition);
  if (!readiness.executable) return readiness;
  const policy = executionPolicyDecision(blueprintExecutionPolicies, blueprint, transition, definition);
  return policy.approved ? readiness : { executable: false, reason: policy.reason };
};
const authoritativeConnectionsFor = blueprint => blueprint?.graph_source === 'settings-blueprint-detail' ? (blueprint.connections || []) : [];
async function layoutContextForRecord(module, { layoutId = null, recordId = null, isCreate = false } = {}) {
  const layoutMeta = await meta('layouts:' + module);
  let record = null;
  if (recordId) {
    const rows = await sql(`select data from crm_records where module = ${lit(module)} and id = ${lit(recordId)}`);
    record = rows[0]?.data || null;
  }
  const storedId = recordLayoutId(record);
  const requestedId = asLayoutId(layoutId);
  if (storedId && requestedId && storedId !== requestedId) {
    throw new ValidationError([{ field: 'Layout', code: 'layout_mismatch', message: 'The selected layout does not match this record\'s stored layout.' }]);
  }
  const context = resolveLayout(layoutMeta, { layoutId: storedId ? null : requestedId, record });
  if (requestedId && !context.exact) {
    throw new ValidationError([{ field: 'Layout', code: 'invalid_layout', message: 'The selected layout is not active for this module.' }]);
  }
  if (context.reason === 'ambiguous_layout') {
    throw new ValidationError([{ field: 'Layout', code: 'layout_required', message: `Select the exact layout before ${isCreate ? 'creating' : 'changing'} this record.` }]);
  }
  if (!context.exact || !context.layout) {
    throw new LayoutSchemaError('Exact layout metadata is required before this record can be validated.', {
      details: { module, reason: context.reason || 'layout_unresolved' },
    });
  }
  return { ...context, record };
}
async function validateRecordPayload(module, payload, { isCreate = false, recordId = null, layoutId = null, layoutContext = null, allowBlueprintState = false } = {}) {
  const fieldMeta = await meta('fields:' + module);
  const context = layoutContext || await layoutContextForRecord(module, { layoutId, recordId, isCreate });
  if (!context?.exact || !context.layout) {
    throw new LayoutSchemaError('Exact layout metadata is required before this record can be validated.', {
      details: { module, reason: context?.reason || 'layout_unresolved' },
    });
  }
  const fields = mergeLayoutFields(fieldMeta?.fields || [], context.layout);
  validatePayload(fields, payload, { isCreate });
  const blueprint = activeBlueprintsFor(module).find(item => item.state_field && Object.prototype.hasOwnProperty.call(payload, item.state_field));
  if (!allowBlueprintState && blueprint) {
    const error = new Error(`${blueprint.state_field} is controlled by an active Blueprint.`);
    error.status = 409;
    error.code = 'BLUEPRINT_TRANSITION_REQUIRED';
    throw error;
  }
  for (const [apiName, value] of Object.entries(payload)) {
    const field = fields.find(item => item.api_name === apiName);
    if (!field?.unique || value === null || value === undefined || value === '') continue;
    const rows = await sql(`select count(*)::int as c from crm_records where module = ${lit(module)} and data->>${lit(apiName)} = ${lit(value)}${recordId ? ` and id <> ${lit(recordId)}` : ''}`);
    if (Number(rows[0]?.c || 0) > 0) {
      throw new ValidationError([{ field: apiName, code: 'duplicate', message: `${field.field_label || apiName} must be unique.` }]);
    }
  }
  return payload;
}

// ---------- meta (from crm_meta; cached in memory) ----------
const memCache = new Map();
async function meta(key, { signal } = {}) {
  if (memCache.has(key)) return memCache.get(key);
  const rows = await sql(`select data from crm_meta where key = ${lit(key)}`, { signal });
  const d = rows[0]?.data ?? null;
  memCache.set(key, d);
  return d;
}
async function meta_nocache(key, { signal } = {}) {
  const rows = await sql(`select data from crm_meta where key = ${lit(key)}`, { signal });
  return rows[0]?.data ?? null;
}
const crmAgentAggregateCache = new Map();
// Analytics and assistant permission discovery are the two substantial cold
// read paths. Serialize only their cache misses so they cannot contend for the
// database statement budget; warm reads and all ordinary CRM APIs bypass it.
const coldReadCoordinator = createColdReadCoordinator();
const crmAgentRouteService = createCrmAgentRouteService({
  env: process.env,
  readOnlyQuery: sql,
  aggregateCache: crmAgentAggregateCache,
  runScopeLoad: (task, generation) => coldReadCoordinator.runAssistantScope(generation, task),
});
mountCrmAgentRoutes(app, crmAgentRouteService);
const analyticsOverviewService = createAnalyticsOverviewService({ readOnlyQuery: sql });
const analyticsOverviewCache = new Map();
const analyticsOverviewInFlight = new Map();
const ANALYTICS_CACHE_MS = 60_000;
const ANALYTICS_STALE_MS = 5 * 60_000;
let analyticsOverviewGeneration = 0;
let derivedReadCacheGeneration = 0;
let persistedDashboardCacheNotBefore = 0;
let analyticsPrewarmTimer = null;
let persistedDashboardCacheQueue = Promise.resolve();
let persistedDashboardSeedFlight = null;
let persistedDashboardSeedCompletedGeneration = -1;
let homeDashboardService = null;
let replicationSetEvidenceService = null;
let replicationHealthStateService = null;
let dataCompletenessCache = null;
const PERSISTED_DASHBOARD_CACHE_TIMEOUT_MS = 3_000;
const REPLICATION_HEALTH_RESPONSE_WAIT_MS = 750;
const REPLICATION_HEALTH_FALLBACK_RETRY_MS = 2_000;
const REPLICATION_SET_EVIDENCE_FRESH_TTL_MS = 60_000;
const REPLICATION_SET_EVIDENCE_QUERY_TIMEOUT_MS = 30_000;
const REPLICATION_HEALTH_STATE_FRESH_TTL_MS = 10_000;
const REPLICATION_HEALTH_STATE_QUERY_TIMEOUT_MS = 15_000;
function queuePersistedDashboardCache(operation) {
  const runBounded = async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PERSISTED_DASHBOARD_CACHE_TIMEOUT_MS);
    try {
      return await operation(controller.signal);
    } finally {
      clearTimeout(timer);
    }
  };
  const pending = persistedDashboardCacheQueue.then(runBounded, runBounded);
  persistedDashboardCacheQueue = pending.catch(() => {});
  return pending;
}
function clearAnalyticsOverviewCache() {
  analyticsOverviewGeneration += 1;
  analyticsOverviewCache.clear();
}
function invalidateDerivedReadCaches({
  prewarmAnalytics = true,
  persistDashboardInvalidation = true,
  dropDashboardLastKnownGood = false,
} = {}) {
  derivedReadCacheGeneration += 1;
  persistedDashboardCacheNotBefore = Date.now();
  if (dataCompletenessCache) dataCompletenessCache.invalidate();
  if (persistedDashboardSeedFlight) persistedDashboardSeedFlight.controller.abort();
  persistedDashboardSeedFlight = null;
  persistedDashboardSeedCompletedGeneration = -1;
  if (replicationSetEvidenceService) replicationSetEvidenceService.invalidate();
  if (replicationHealthStateService) replicationHealthStateService.invalidate();
  if (homeDashboardService) homeDashboardService.invalidate({
    dropLastKnownGood: dropDashboardLastKnownGood,
  });
  rangeCache.clear();
  listCountCache.clear();
  matrixCache.clear();
  crmAgentRouteService.invalidateDataCache();
  clearAnalyticsOverviewCache();
  const persistedInvalidation = persistDashboardInvalidation
    ? queuePersistedDashboardCache(signal => rpc('crm_meta_upsert', {
      k: 'dash_cache',
      d: { at: new Date().toISOString(), invalidated: true, data: null },
    }, { signal })).catch(() => {})
    : Promise.resolve();
  if (prewarmAnalytics) {
    if (analyticsPrewarmTimer) clearTimeout(analyticsPrewarmTimer);
    analyticsPrewarmTimer = setTimeout(async () => {
      analyticsPrewarmTimer = null;
      const generation = analyticsOverviewGeneration;
      if (analyticsOverviewInFlight.size) await Promise.allSettled([...analyticsOverviewInFlight.values()]);
      if (analyticsOverviewGeneration === generation) cachedAnalyticsOverview({}).catch(() => {});
    }, 250);
  }
  return persistedInvalidation;
}
async function cachedAnalyticsOverview(input) {
  const normalized = analyticsOverviewService.plan(input || {}).date_range;
  const canonicalInput = { from: normalized.from, to: normalized.to };
  const key = `${canonicalInput.from}|${canonicalInput.to}`;
  const generation = analyticsOverviewGeneration;
  const flightKey = `${generation}:${key}`;
  const hit = analyticsOverviewCache.get(key);
  const age = hit ? Date.now() - hit.at : Infinity;
  if (hit && age < ANALYTICS_CACHE_MS) return hit.data;
  if (hit && age < ANALYTICS_STALE_MS && analyticsOverviewInFlight.has(flightKey)) return hit.data;
  if (analyticsOverviewInFlight.has(flightKey)) return analyticsOverviewInFlight.get(flightKey);
  const pending = coldReadCoordinator.runAnalytics(flightKey, () => analyticsOverviewService.overview(canonicalInput)).then(data => {
    if (analyticsOverviewGeneration === generation) analyticsOverviewCache.set(key, { at: Date.now(), data });
    return data;
  }).finally(() => analyticsOverviewInFlight.delete(flightKey));
  analyticsOverviewInFlight.set(flightKey, pending);
  if (hit && age < ANALYTICS_STALE_MS) {
    pending.catch(() => {});
    return hit.data;
  }
  return pending;
}
app.get('/api/analytics/overview', (req, res) => wrap(res, async () => {
  try {
    return await cachedAnalyticsOverview({ from: req.query.from, to: req.query.to });
  } catch (error) {
    if (Number(error?.status) >= 400 && Number(error?.status) < 500) throw error;
    const unavailable = new Error('Analytics is temporarily unavailable. Existing CRM records were not changed.');
    unavailable.status = 503;
    unavailable.code = 'ANALYTICS_SOURCE_UNAVAILABLE';
    throw unavailable;
  }
}));
app.get('/api/meta/modules', (req, res) => wrap(res, () => meta('modules')));
app.get('/api/meta/fields', (req, res) => wrap(res, () => meta('fields:' + ident(req.query.module))));
app.get('/api/meta/layouts', (req, res) => wrap(res, () => meta('layouts:' + ident(req.query.module))));
app.get('/api/meta/views', (req, res) => wrap(res, () => meta('views:' + ident(req.query.module))));
app.get('/api/meta/view', (req, res) => wrap(res, async () => {
  const all = await meta('views:' + ident(req.query.module));
  const v = (all?.custom_views || []).find(x => String(x.id) === String(req.query.id));
  return { custom_views: v ? [v] : [] };
}));
app.get('/api/meta/related_lists', (req, res) => wrap(res, () => meta('related_lists:' + ident(req.query.module))));
app.get('/api/meta/users', (req, res) => wrap(res, () => meta('users')));
app.get('/api/meta/org', (req, res) => wrap(res, () => meta('org')));
app.get('/api/meta/sync_info', (req, res) => wrap(res, () => meta('sync_info')));
async function computeDataCompleteness({ signal } = {}) {
  const taskSubformModules = taskSubformReconciliationConfig.datasets.map(dataset => dataset.module);
  const completenessStatement = `with record_sets as (
    select
      module,
      count(*)::int as c,
      encode(extensions.digest(coalesce(string_agg(id, E'\\n' order by id), ''), 'sha256'), 'hex') as set_digest
    from crm_records
    where module = any(array[${[...taskSubformModules, 'Notes'].map(lit).join(',')}])
      -- Source replication accepts numeric IDs only, while local and QA rows
      -- use schema-enforced local-* namespaces. Keep this aggregate on the
      -- (module, id) key instead of opening every source record's JSON body.
      and id ~ '^[0-9]+$'
    group by module
  )
  select
    clock_timestamp() as observed_at,
    coalesce((select c from record_sets where module = 'Notes'), 0)::int as source_notes,
    (select set_digest from record_sets where module = 'Notes') as source_notes_digest,
    (select count(*)::int from crm_records where module = 'Attachments' and id ~ '^[0-9]+$' and ${USER_DATA_ONLY} and coalesce(data->'Parent_Id'->>'id','') <> '') as linked_attachments,
    coalesce((select jsonb_object_agg(module, jsonb_build_object('count', c, 'set_digest', set_digest)) from record_sets where module <> 'Notes'), '{}'::jsonb) as record_sets`;
  const { result: rows } = await executeBoundedLocalRead({
    readOnlyQuery: sql,
    statement: completenessStatement,
    abortSignal: signal,
  });
  const current = rows[0] || {};
  const currentObservedAt = new Date(current.observed_at || Date.now()).toISOString();
  const currentSourceNotes = Number(current.source_notes || 0);
  const currentSourceNotesDigest = String(current.source_notes_digest || '').toLowerCase();
  const currentLinkedAttachments = Number(current.linked_attachments || 0);
  const currentRecordSets = current.record_sets || {};
  const auditedDigests = privateTaskSubformDigests();
  const taskSubformDatasets = taskSubformReconciliationConfig.datasets.map(dataset => {
    const currentSet = currentRecordSets[dataset.module] || {};
    const currentLocalCount = completenessCount(currentSet.count || 0, `${dataset.module}.current_local_source_id_count`);
    const currentCountParity = currentLocalCount === completenessCount(dataset.source_active_ids, `${dataset.module}.source_active_ids`);
    const expectedDigest = auditedDigests.get(dataset.module) || null;
    const exactIdParity = expectedDigest
      ? currentCountParity && String(currentSet.set_digest || '').toLowerCase() === expectedDigest
      : null;
    const verdict = classifyReconciliationEvidence({
      supported: true,
      refreshStatus: 'complete',
      audit: { at: taskSubformReconciliationConfig.audited_at, count: dataset.source_active_ids, exact: true },
      local: { observedAt: currentObservedAt, count: currentLocalCount },
      sourceRecheck: expectedDigest ? {
        at: taskSubformReconciliationConfig.audited_at,
        count: dataset.source_active_ids,
        exactIdParity,
      } : null,
    });
    const exactStatus = verdict.classification === 'reconciled_current'
      ? (dataset.count_only_unavailable > 0 ? 'Exact active-ID parity; count-only rows blocked' : 'Reconciled current')
      : verdict.classification === 'ahead_of_audit_recheck_required'
        ? (dataset.count_only_unavailable > 0 ? 'Source recheck required; count-only rows blocked' : 'Source recheck required')
        : verdict.classification === 'behind_source'
          ? 'Behind audited source'
          : (dataset.count_only_unavailable > 0 ? 'Partial refresh; count-only rows blocked' : 'Partial refresh');
    return {
      module: completenessText(dataset.module, `${dataset.module}.module`, 100),
      parent_module: dataset.parent_module ? completenessText(dataset.parent_module, `${dataset.module}.parent_module`, 100) : null,
      source_count_endpoint: completenessCount(dataset.source_count_endpoint, `${dataset.module}.source_count_endpoint`),
      source_active_ids: completenessCount(dataset.source_active_ids, `${dataset.module}.source_active_ids`),
      count_only_unavailable: completenessCount(dataset.count_only_unavailable, `${dataset.module}.count_only_unavailable`),
      local_before: completenessCount(dataset.local_before, `${dataset.module}.local_before`),
      source_only_before: completenessCount(dataset.source_only_before, `${dataset.module}.source_only_before`),
      local_only_before: completenessCount(dataset.local_only_before, `${dataset.module}.local_only_before`),
      imported: completenessCount(dataset.imported, `${dataset.module}.imported`),
      exact_payloads_verified: completenessCount(dataset.exact_payloads_verified || 0, `${dataset.module}.exact_payloads_verified`),
      historical_imported: completenessCount(dataset.historical_imported || 0, `${dataset.module}.historical_imported`),
      historical_exact_payloads_verified: completenessCount(dataset.historical_exact_payloads_verified || 0, `${dataset.module}.historical_exact_payloads_verified`),
      local_after: completenessCount(dataset.local_after, `${dataset.module}.local_after`),
      source_only_after: completenessCount(dataset.source_only_after, `${dataset.module}.source_only_after`),
      local_only_after: completenessCount(dataset.local_only_after, `${dataset.module}.local_only_after`),
      current_local_source_id_count: currentLocalCount,
      current_count_parity: currentCountParity,
      active_id_parity: verdict.classification === 'reconciled_current' ? exactIdParity : null,
      audited_snapshot_id_parity: Boolean(expectedDigest),
      current_matches_audited_set: exactIdParity,
      reconciliation_classification: verdict.classification,
      reconciliation_reason: verdict.reason_code,
      current_observed_at: currentObservedAt,
      parity_basis: expectedDigest ? 'Private audited ID-set digest' : 'Current count only',
      status: exactStatus,
    };
  });
  const currentTaskSubformTotal = taskSubformDatasets.reduce((total, dataset) => total + dataset.current_local_source_id_count, 0);
  const noteSourceCount = completenessCount(dataCompletenessConfig.notes.source_active_id_count, 'notes.source_active_id_count');
  const noteCountParity = currentSourceNotes === noteSourceCount;
  const noteAudit = privateNotesAudit();
  const noteExactIdParity = noteAudit
    ? noteCountParity && currentSourceNotesDigest === noteAudit.set_digest
    : null;
  const noteVerdict = classifyReconciliationEvidence({
    supported: true,
    refreshStatus: 'complete',
    audit: { at: dataCompletenessConfig.audited_at, count: noteSourceCount, exact: true },
    local: { observedAt: currentObservedAt, count: currentSourceNotes },
    sourceRecheck: noteAudit ? {
      at: noteAudit.completed_at,
      count: noteAudit.source_count,
      exactIdParity: noteExactIdParity,
    } : null,
  });
  const attachmentSourceCount = completenessCount(dataCompletenessConfig.attachments.source_id_count, 'attachments.source_id_count');
  const currentAbsentAttachments = Math.max(0, attachmentSourceCount - currentLinkedAttachments);
  const exactParityAvailable = taskSubformDatasets.every(dataset => dataset.audited_snapshot_id_parity === true);
  const currentActiveParityValues = taskSubformDatasets.map(dataset => dataset.active_id_parity);
  const response = {
    schema_version: completenessCount(dataCompletenessConfig.schema_version, 'schema_version'),
    audited_at: completenessText(dataCompletenessConfig.audited_at, 'audited_at', 80),
    source_mode: ZOHO_SOURCE_MODE,
    notes: {
      scope: completenessText(dataCompletenessConfig.notes.scope, 'notes.scope'),
      source_active_id_count: noteSourceCount,
      local_source_derived_id_count: completenessCount(dataCompletenessConfig.notes.local_source_derived_id_count, 'notes.local_source_derived_id_count'),
      source_only_id_count: completenessCount(dataCompletenessConfig.notes.source_only_id_count, 'notes.source_only_id_count'),
      local_only_source_id_count: completenessCount(dataCompletenessConfig.notes.local_only_source_id_count, 'notes.local_only_source_id_count'),
      audited_snapshot_id_parity: dataCompletenessConfig.notes.id_parity === true,
      content_comparison: completenessText(dataCompletenessConfig.notes.content_comparison, 'notes.content_comparison'),
      current_local_source_derived_id_count: currentSourceNotes,
      current_count_parity: noteCountParity,
      current_exact_id_parity: noteVerdict.classification === 'reconciled_current' ? noteExactIdParity : null,
      current_matches_audited_set: noteExactIdParity,
      current_observed_at: currentObservedAt,
      reconciliation_classification: noteVerdict.classification,
      reconciliation_reason: noteVerdict.reason_code,
      parity_basis: noteAudit ? 'Private audited ID-set digest compared to current local set' : 'Audited snapshot; current count only',
      status: noteVerdict.classification === 'reconciled_current'
        ? 'Reconciled current'
        : noteVerdict.classification === 'ahead_of_audit_recheck_required'
          ? 'Source recheck required'
          : noteVerdict.classification === 'behind_source'
            ? 'Behind audited source'
            : 'Partial refresh',
    },
    attachments: {
      scope: completenessText(dataCompletenessConfig.attachments.scope, 'attachments.scope'),
      source_id_count: attachmentSourceCount,
      local_linked_record_count: completenessCount(dataCompletenessConfig.attachments.local_linked_record_count, 'attachments.local_linked_record_count'),
      audited_snapshot_absent_local_id_count: completenessCount(dataCompletenessConfig.attachments.absent_local_id_count, 'attachments.absent_local_id_count'),
      source_declared_bytes: completenessCount(dataCompletenessConfig.attachments.source_declared_bytes, 'attachments.source_declared_bytes'),
      content_downloaded: dataCompletenessConfig.attachments.content_downloaded === true,
      storage_bucket_enumerated: dataCompletenessConfig.attachments.storage_bucket_enumerated === true,
      storage_bucket_status: completenessText(dataCompletenessConfig.attachments.storage_bucket_status, 'attachments.storage_bucket_status'),
      current_local_linked_record_count: currentLinkedAttachments,
      absent_local_id_count: currentAbsentAttachments,
      current_absent_source_id_count: currentAbsentAttachments,
      current_count_complete: currentLinkedAttachments === attachmentSourceCount,
      status: currentLinkedAttachments === attachmentSourceCount ? 'Current count complete; exact ID-set not reverified' : 'Incomplete',
    },
    related_lists: {
      audited_at: completenessText(dataCompletenessConfig.related_lists.audited_at, 'related_lists.audited_at', 80),
      scope: completenessText(dataCompletenessConfig.related_lists.scope, 'related_lists.scope'),
      source_definition_count: completenessCount(dataCompletenessConfig.related_lists.source_definition_count, 'related_lists.source_definition_count'),
      source_parent_module_count: completenessCount(dataCompletenessConfig.related_lists.source_parent_module_count, 'related_lists.source_parent_module_count'),
      local_definition_count: completenessCount(dataCompletenessConfig.related_lists.local_definition_count, 'related_lists.local_definition_count'),
      local_parent_module_count: completenessCount(dataCompletenessConfig.related_lists.local_parent_module_count, 'related_lists.local_parent_module_count'),
      visible_parent_module_count: completenessCount(dataCompletenessConfig.related_lists.visible_parent_module_count, 'related_lists.visible_parent_module_count'),
      visible_parent_modules_with_definitions: completenessCount(dataCompletenessConfig.related_lists.visible_parent_modules_with_definitions, 'related_lists.visible_parent_modules_with_definitions'),
      visible_definition_count: completenessCount(dataCompletenessConfig.related_lists.visible_definition_count, 'related_lists.visible_definition_count'),
      generic_ui_excluded_definition_count: completenessCount(dataCompletenessConfig.related_lists.generic_ui_excluded_definition_count, 'related_lists.generic_ui_excluded_definition_count'),
      generic_ui_evaluated_definition_count: completenessCount(dataCompletenessConfig.related_lists.generic_ui_evaluated_definition_count, 'related_lists.generic_ui_evaluated_definition_count'),
      queryable_definition_count: completenessCount(dataCompletenessConfig.related_lists.queryable_definition_count, 'related_lists.queryable_definition_count'),
      unresolved_definition_count: completenessCount(dataCompletenessConfig.related_lists.unresolved_definition_count, 'related_lists.unresolved_definition_count'),
      queryable_basis_counts: {
        exact_source_lookup_relation: completenessCount(dataCompletenessConfig.related_lists.queryable_basis_counts.exact_source_lookup_relation, 'related_lists.queryable_basis_counts.exact_source_lookup_relation'),
        source_polymorphic_base_relation: completenessCount(dataCompletenessConfig.related_lists.queryable_basis_counts.source_polymorphic_base_relation, 'related_lists.queryable_basis_counts.source_polymorphic_base_relation'),
      },
      unresolved_reason_counts: {
        RELATED_LINK_PATH_UNRESOLVED: completenessCount(dataCompletenessConfig.related_lists.unresolved_reason_counts.RELATED_LINK_PATH_UNRESOLVED, 'related_lists.unresolved_reason_counts.RELATED_LINK_PATH_UNRESOLVED'),
        RELATED_TARGET_FIELDS_UNAVAILABLE: completenessCount(dataCompletenessConfig.related_lists.unresolved_reason_counts.RELATED_TARGET_FIELDS_UNAVAILABLE, 'related_lists.unresolved_reason_counts.RELATED_TARGET_FIELDS_UNAVAILABLE'),
        RELATED_TARGET_MODULE_UNRESOLVED: completenessCount(dataCompletenessConfig.related_lists.unresolved_reason_counts.RELATED_TARGET_MODULE_UNRESOLVED, 'related_lists.unresolved_reason_counts.RELATED_TARGET_MODULE_UNRESOLVED'),
      },
      unresolved_behavior: completenessText(dataCompletenessConfig.related_lists.unresolved_behavior, 'related_lists.unresolved_behavior'),
      status: 'Incomplete',
    },
    task_subforms: {
      schema_version: completenessCount(taskSubformReconciliationConfig.schema_version, 'task_subforms.schema_version'),
      audited_at: completenessText(taskSubformReconciliationConfig.audited_at, 'task_subforms.audited_at', 80),
      source_mode: completenessText(taskSubformReconciliationConfig.source_mode, 'task_subforms.source_mode', 40),
      source_writes: completenessCount(taskSubformReconciliationConfig.source_writes, 'task_subforms.source_writes'),
      local_deletes: completenessCount(taskSubformReconciliationConfig.local_deletes, 'task_subforms.local_deletes'),
      summary: {
        source_count_endpoint_total: completenessCount(taskSubformReconciliationConfig.summary.source_count_endpoint_total, 'task_subforms.summary.source_count_endpoint_total'),
        source_active_id_total: completenessCount(taskSubformReconciliationConfig.summary.source_active_id_total, 'task_subforms.summary.source_active_id_total'),
        count_only_unavailable_total: completenessCount(taskSubformReconciliationConfig.summary.count_only_unavailable_total, 'task_subforms.summary.count_only_unavailable_total'),
        local_source_id_total_before: completenessCount(taskSubformReconciliationConfig.summary.local_source_id_total_before, 'task_subforms.summary.local_source_id_total_before'),
        source_only_active_id_total_before: completenessCount(taskSubformReconciliationConfig.summary.source_only_active_id_total_before, 'task_subforms.summary.source_only_active_id_total_before'),
        imported_total: completenessCount(taskSubformReconciliationConfig.summary.imported_total, 'task_subforms.summary.imported_total'),
        exact_payloads_verified: completenessCount(taskSubformReconciliationConfig.summary.exact_payloads_verified, 'task_subforms.summary.exact_payloads_verified'),
        historical_imported_total: completenessCount(taskSubformReconciliationConfig.summary.historical_imported_total || 0, 'task_subforms.summary.historical_imported_total'),
        historical_exact_payloads_verified: completenessCount(taskSubformReconciliationConfig.summary.historical_exact_payloads_verified || 0, 'task_subforms.summary.historical_exact_payloads_verified'),
        local_source_id_total_after: completenessCount(taskSubformReconciliationConfig.summary.local_source_id_total_after, 'task_subforms.summary.local_source_id_total_after'),
        source_only_active_id_total_after: completenessCount(taskSubformReconciliationConfig.summary.source_only_active_id_total_after, 'task_subforms.summary.source_only_active_id_total_after'),
        local_only_source_id_total_after: completenessCount(taskSubformReconciliationConfig.summary.local_only_source_id_total_after, 'task_subforms.summary.local_only_source_id_total_after'),
        current_local_source_id_total: currentTaskSubformTotal,
        current_count_parity: taskSubformDatasets.every(dataset => dataset.current_count_parity),
        exact_id_parity_available: exactParityAvailable,
        active_id_parity: currentActiveParityValues.every(value => typeof value === 'boolean')
          ? currentActiveParityValues.every(Boolean)
          : null,
        current_matches_audited_sets: taskSubformDatasets.every(dataset => dataset.current_matches_audited_set === true),
        blocked_count_only_unavailable_total: completenessCount(taskSubformReconciliationConfig.summary.count_only_unavailable_total, 'task_subforms.summary.count_only_unavailable_total'),
      },
      datasets: taskSubformDatasets,
      blocker: completenessText(taskSubformReconciliationConfig.blocker, 'task_subforms.blocker'),
    },
  };
  assertSafeCompletenessOutput(response);
  return response;
}
dataCompletenessCache = createDataCompletenessCache({
  load: computeDataCompleteness,
  freshTtlMs: DEFAULT_DATA_COMPLETENESS_CACHE_TTL_MS,
});
app.get('/api/meta/data_completeness', (req, res) => wrap(res, async () => dataCompletenessCache.get({
  generation: derivedReadCacheGeneration,
})));
app.get('/api/meta/custom_buttons', (req, res) => wrap(res, async () => ({
  buttons: req.query.module ? customButtonConfig.buttons.filter(button => button.module === ident(req.query.module)) : customButtonConfig.buttons,
  source_mode: ZOHO_SOURCE_MODE,
})));
app.get('/api/meta/function_code_coverage', (req, res) => wrap(res, async () => {
  const manifestPath = path.join(__dirname, '.private', 'zoho-discovery', 'functions-code', 'manifest.json');
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return {
      source_mode: manifest.source_mode,
      generated_at: manifest.generated_at,
      reconciliation: manifest.reconciliation,
      functions: (manifest.functions || []).map(fn => ({
        id: String(fn.id),
        api_name: fn.api_name || null,
        byte_length: fn.byte_length || 0,
        captured: fn.status === 200 && Number(fn.byte_length) > 0,
      })),
    };
  } catch {
    return { source_mode: 'read-only', generated_at: null, reconciliation: null, functions: [] };
  }
}));
app.get('/api/meta/function_behavior_coverage', (req, res) => wrap(res, async () => (
  buildFunctionBehaviorInventory(activeFunctionBehaviorConfig)
)));

app.get('/api/meta/widget_behavior_coverage', (req, res) => wrap(res, async () => (
  getWidgetBehaviorInventory()
)));

app.get('/api/meta/widget_runtime_compatibility', (req, res) => wrap(res, async () => (
  getWidgetRuntimeCompatibility()
)));

app.get('/api/meta/report_dashboard_coverage', (req, res) => wrap(res, async () => (
  getReportDashboardCoverage()
)));

app.get('/api/meta/permission_coverage', (req, res) => wrap(res, async () => (
  getPermissionCoverage()
)));
app.get('/api/meta/rule_layout_coverage', (req, res) => wrap(res, async () => (
  getRuleLayoutCoverage()
)));
app.get('/api/meta/metadata_parity', (req, res) => wrap(res, async () => (
  getMetadataParityAudit()
)));
app.get('/api/meta/setup_process_coverage', (req, res) => wrap(res, async () => (
  getSetupProcessCoverage()
)));
app.get('/api/meta/module_replication_catalog', (req, res) => wrap(res, async () => (
  getModuleReplicationCatalog()
)));
app.post('/api/meta/refresh', (req, res) => wrap(res, async () => {
  memCache.clear();
  crmAgentRouteService.invalidateMetadataCache();
  await invalidateDerivedReadCaches();
  return { ok: true };
}));

// ---------- view criteria → SQL ----------
async function customViewSQL(module, cvid) {
  const [viewMeta, fieldMeta] = await Promise.all([meta('views:' + module), meta('fields:' + module)]);
  return compileCustomViewFilter({
    module,
    cvid,
    views: viewMeta?.custom_views,
    fields: fieldMeta?.fields,
  }).sql;
}

// ---------- records ----------
async function listRecords(m, qy) {
  const per = Math.min(parseInt(qy.per_page || '50', 10), 2000);
  const page = Math.max(parseInt(qy.page || '1', 10), 1);
  let where = `module = ${lit(m)} and ${USER_DATA_ONLY}`;
  let filtered = true;
  if (qy.cvid) {
    const viewFilter = await customViewSQL(m, qy.cvid);
    if (viewFilter) where += ' and ' + viewFilter;
  }
  const dOk = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
  // dfield=auto → filter on the module's natural date (Tasks: due date, Calls/Meetings: start time)
  let fromExpr = d => `created_time >= (${lit(d + 'T00:00:00+05:30')})::timestamptz`;
  let toExpr = d => `created_time < ((${lit(d + 'T00:00:00+05:30')})::timestamptz + interval '1 day')`;
  if (qy.dfield === 'auto') {
    if (m === 'Tasks') { fromExpr = d => `due_date >= ${lit(d)}`; toExpr = d => `due_date <= ${lit(d)}`; }
    else if (m === 'Calls' || m === 'Events') { fromExpr = d => `ts2 >= ${lit(d)}`; toExpr = d => `ts2 < ${lit(d + 'T23:59:59')}`; }
  } else if (qy.dfield === 'modified') {
    fromExpr = d => `modified_time >= (${lit(d + 'T00:00:00+05:30')})::timestamptz`;
    toExpr = d => `modified_time < ((${lit(d + 'T00:00:00+05:30')})::timestamptz + interval '1 day')`;
  } else if (qy.dfield && qy.dfield !== 'created') {
    // any date/datetime field of the module (validated against metadata)
    const fmeta2 = await meta('fields:' + m);
    const fd = (fmeta2?.fields || []).find(f => f.api_name === qy.dfield && ['date', 'datetime'].includes(f.data_type));
    if (fd) {
      const fe = `data->>'${ident(fd.api_name)}'`;
      fromExpr = d => `${fe} >= ${lit(d)}`;
      toExpr = d => `${fe} <= ${lit(d + 'T23:59:59+05:30')}`;
    }
  }
  if (dOk(qy.from)) where += ' and ' + fromExpr(qy.from);
  if (dOk(qy.to)) where += ' and ' + toExpr(qy.to);
  // Match the deployed (module, modified_time DESC) index exactly. Explicit
  // NULLS LAST forces a full sort in PostgreSQL and made large modules take
  // seconds; source CRM rows normally have Modified_Time populated.
  let order = 'modified_time desc';
  if (qy.sort_by) {
    const sf = ident(qy.sort_by);
    order = `data->'${sf}' ${qy.sort_order === 'asc' ? 'asc' : 'desc'} nulls last`;
  }
  // rows come from a cheap indexed limit-scan; exact counts never block the response
  const rows = await sql(`select data from crm_records where ${where} order by ${order} limit ${per} offset ${(page - 1) * per}`);
  const data = rows.map(r => r.data);
  const cc = listCountCache.get(where);
  const cachedTotal = (cc && Date.now() - cc.at < 600_000) ? cc.total : null;
  if (cachedTotal === null && qy.schedule_count !== false) {
    listCountQueue.run(where, async () => {
      const r = await sql(`select count(*) as c from crm_records where ${where}`);
      listCountCache.set(where, { at: Date.now(), total: r[0]?.c ?? 0 });
    }).catch(() => {});
  }
  const total = cachedTotal ?? (page - 1) * per + data.length + (data.length === per ? 1 : 0);
  return { data, info: { count: data.length, total, total_exact: cachedTotal !== null, more_records: cachedTotal !== null ? page * per < cachedTotal : data.length === per, filtered } };
}
const listCountCache = new Map();
// Exact totals are non-blocking UI enrichment. Bound and coalesce them so a
// cold start across many modules cannot create a database-count thundering herd.
const listCountQueue = createKeyedTaskQueue({ concurrency: 1, maxQueued: 250 });
app.get('/api/records/:module', (req, res) => wrap(res, () => listRecords(ident(req.params.module), req.query)));

// matrix (pivot) — counts grouped by two chosen axes
const matrixCache = new Map();
const statusFieldFor = m => m === 'Leads' ? 'Lead_Status' : (m === 'Deals' || m === 'Contacts') ? 'Stage' : 'Status';
app.get('/api/matrix/:module', (req, res) => wrap(res, async () => {
  const m = ident(req.params.module);
  const fmeta = await meta('fields:' + m);
  const fm = {}; (fmeta?.fields || []).forEach(f => fm[f.api_name] = f);
  const axisExpr = f => {
    f = ident(f);
    if (f === 'Owner') return 'owner';
    if (f === statusFieldFor(m)) return 'status';
    const fd = fm[f];
    if (!fd) throw new Error('unknown field ' + f);
    if (['lookup', 'ownerlookup', 'userlookup'].includes(fd.data_type)) return `data->'${f}'->>'name'`;
    return `data->>'${f}'`;
  };
  const x = req.query.x || 'Owner';
  const y = req.query.y || statusFieldFor(m);
  let where = `module = ${lit(m)} and ${USER_DATA_ONLY}`;
  if (req.query.cvid) {
    const viewFilter = await customViewSQL(m, req.query.cvid);
    if (viewFilter) where += ' and ' + viewFilter;
  }
  const dOk = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
  if (dOk(req.query.from)) where += ` and created_time >= (${lit(req.query.from + 'T00:00:00+05:30')})::timestamptz`;
  if (dOk(req.query.to)) where += ` and created_time < ((${lit(req.query.to + 'T00:00:00+05:30')})::timestamptz + interval '1 day')`;
  const ck = [m, x, y, req.query.cvid, req.query.from, req.query.to].join('|');
  const hit = matrixCache.get(ck);
  if (hit && Date.now() - hit.at < 60_000) return hit.data;
  const rows = await sql(`select coalesce(${axisExpr(y)}, '(none)') as y, coalesce(${axisExpr(x)}, '(none)') as x, count(*)::int as c from crm_records where ${where} group by 1, 2 limit 3000`);
  const data = { x, y, rows };
  matrixCache.set(ck, { at: Date.now(), data });
  return data;
}));

// one-round-trip bundles
app.get('/api/boot', (req, res) => wrap(res, async () => {
  try {
    const [modules, org, sync_info, metadata_hydration] = await Promise.all([
      meta('modules'),
      meta('org'),
      meta('sync_info').catch(() => null),
      meta('captured_metadata_hydration').catch(() => null),
    ]);
    return {
      modules, org, sync_info, version: BUILD, zoho: ZOHO_ON, zoho_source_mode: ZOHO_SOURCE_MODE,
      metadata_version: metadata_hydration?.applied_at || sync_info?.at || BUILD,
      sync_schedule: publicDeltaSyncStatus(),
      blueprint_modules: [...new Map(blueprintConfig.blueprints.filter(blueprint => blueprint.status === 'Active').map(blueprint => [blueprint.module, { module: blueprint.module, name: activeBlueprintFor(blueprint.module)?.name, state_field: blueprint.state_field }])).values()],
    };
  } catch (error) {
    const operation = ownErrorValue(error, 'operation');
    const upstreamStatus = Number(ownErrorValue(error, 'upstreamStatus'));
    const dbCode = ownErrorValue(error, 'dbCode');
    const transportCode = ownErrorValue(error, 'transportCode');
    const transportName = ownErrorValue(error, 'transportName');
    let supabaseUrlValid = false;
    try {
      const parsed = new URL(SUPA);
      supabaseUrlValid = parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.hash;
    } catch {}
    console.error('[crm_boot_failure]', JSON.stringify({
      category: operation === 'crm_sql_transport' ? 'database_transport'
        : operation === 'crm_sql' ? 'database_rpc_rejected'
          : 'database_unknown',
      configuration: {
        supabase_url: typeof SUPA === 'string' && SUPA.length > 0,
        supabase_url_valid: supabaseUrlValid,
        supabase_key: typeof KEY === 'string' && KEY.length > 0,
        sql_secret: typeof SECRET === 'string' && SECRET.length > 0,
      },
      upstream_status: Number.isInteger(upstreamStatus) ? upstreamStatus : null,
      db_code: typeof dbCode === 'string' && /^[A-Z0-9]{5}$/i.test(dbCode) ? dbCode : null,
      transport_code: typeof transportCode === 'string' && /^[A-Z0-9_]{3,40}$/i.test(transportCode) ? transportCode : null,
      transport_name: typeof transportName === 'string' && /^[A-Za-z]{3,30}$/.test(transportName) ? transportName : null,
    }));
    throw error;
  }
}));
app.get('/api/meta/automation', (req, res) => wrap(res, async () => {
  const keys = [
    'automation:workflow_rules', 'automation:workflow_rule_details',
    'automation:field_updates', 'automation:tasks', 'automation:email_notifications',
    'automation:webhooks', 'automation:functions', 'automation:analytics', 'automation_synced_at',
  ];
  const bpMods = ['Leads', 'Contacts', 'Deals', 'Tasks', 'Visit_Module', 'AMS_Complaints', 'Service_Managements', 'Calls'];
  const rows = await sql(`select key, data from crm_meta where key = any(array[${[...keys, ...bpMods.map(m => 'automation:blueprints:' + m)].map(lit).join(',')}])`);
  const o = {}; rows.forEach(r => o[r.key] = r.data);
  return o;
}));
app.get('/api/meta/blueprint_catalog', (req, res) => wrap(res, async () => {
  const atomicRuntime = await blueprintAtomicRuntime.initialize();
  const blueprints = blueprintConfig.blueprints.map(blueprint => {
    const definitions = blueprintTransitionDetails.blueprints?.[String(blueprint.id)]?.transitions || {};
    const transitions = blueprint.transitions || [];
    const policyEligibleCount = transitions.filter(transition => transitionPolicyReadinessFor(
      blueprint,
      transition,
      definitions[String(transition.id)],
    ).executable).length;
    return {
      id: String(blueprint.id),
      name: blueprint.name,
      module: blueprint.module,
      layout: blueprint.layout,
      state_field: blueprint.state_field,
      status: blueprint.status,
      graph_source: blueprint.graph_source,
      state_count: (blueprint.states || []).length,
      transition_count: transitions.length,
      connection_count: (blueprint.connections || []).length,
      phase_detail_count: transitions.filter(transition => definitions[String(transition.id)]).length,
      policy_eligible_count: policyEligibleCount,
      policy_blocked_count: transitions.length - policyEligibleCount,
      atomic_runtime_ready_count: atomicRuntime.runtime_executable ? policyEligibleCount : 0,
      automatic_count: transitions.filter(transition => (definitions[String(transition.id)]?.trigger_type || transition.trigger_type) === 'automatic').length,
    };
  });
  const transitionCount = blueprints.reduce((sum, blueprint) => sum + blueprint.transition_count, 0);
  const policyEligibleCount = blueprints.reduce((sum, blueprint) => sum + blueprint.policy_eligible_count, 0);
  return {
    atomic_runtime: atomicRuntime,
    coverage: {
      blueprint_count: blueprints.length,
      transition_count: transitionCount,
      policy_eligible_transition_count: policyEligibleCount,
      policy_blocked_transition_count: transitionCount - policyEligibleCount,
      atomic_runtime_ready_transition_count: blueprints.reduce((sum, blueprint) => sum + blueprint.atomic_runtime_ready_count, 0),
    },
    blueprints,
  };
}));
app.get('/api/meta/blueprint_studio', (req, res) => wrap(res, async () => {
  const atomicRuntime = await blueprintAtomicRuntime.initialize();
  return getBlueprintStudioCatalog(atomicRuntime);
}));
app.get('/api/meta/workflow_studio', (req, res) => wrap(res, async () => buildWorkflowStudioCatalog(workflowRuntimeConfig)));
app.get('/api/module_bundle/:module', (req, res) => wrap(res, async () => {
  const m = ident(req.params.module);
  const skipMeta = req.query.meta === '0'; // client already holds fields/views for this snapshot
  const [views, fields] = await Promise.all([meta('views:' + m), meta('fields:' + m)]);
  const vlist = views?.custom_views || [];
  let cvid = req.query.cvid || (vlist.find(v => v.default) || vlist[0])?.id || null;
  let view_fallback = null;
  let unavailableDefaultView = null;
  const moduleConfigurationUnavailable = !Array.isArray(fields?.fields) || fields.fields.length === 0 || vlist.length === 0;
  if (moduleConfigurationUnavailable) {
    unavailableDefaultView = {
      availability: 'unresolved',
      reason_code: 'MODULE_CONFIGURATION_UNAVAILABLE',
      message: 'Exact field and view configuration is unavailable for this module. Records are not treated as an empty or unfiltered dataset.',
    };
    cvid = null;
    view_fallback = {
      applied: false,
      availability: 'unresolved',
      reason_code: 'MODULE_CONFIGURATION_UNAVAILABLE',
      source_view_name: null,
      selected_view_name: null,
    };
  } else if (!req.query.cvid && cvid) {
    try {
      await customViewSQL(m, cvid);
    } catch (error) {
      if (!(error instanceof CustomViewFilterError)) throw error;
      const sourceView = vlist.find(view => String(view.id) === String(cvid));
      const fallbackView = vlist.find(view => view.criteria === null && /^all\b/i.test(String(view.name || view.display_value || '')))
        || vlist.find(view => view.criteria === null);
      if (!fallbackView || String(fallbackView.id) === String(cvid)) {
        unavailableDefaultView = {
          availability: 'unresolved',
          reason_code: error.code || 'CUSTOM_VIEW_CRITERIA_UNAVAILABLE',
          message: 'The captured source view does not include an executable criterion body. Records are not treated as unfiltered.',
        };
        cvid = null;
        view_fallback = {
          applied: false,
          availability: 'unresolved',
          reason_code: 'LOCAL_DEFAULT_VIEW_CRITERIA_UNAVAILABLE',
          source_view_name: sourceView?.display_value || sourceView?.name || 'Source default view',
          selected_view_name: null,
        };
      } else {
        cvid = fallbackView.id;
        view_fallback = {
          applied: true,
          reason_code: 'LOCAL_DEFAULT_VIEW_CRITERIA_UNAVAILABLE',
          source_view_name: sourceView?.display_value || sourceView?.name || 'Source default view',
          selected_view_name: fallbackView.display_value || fallbackView.name || 'Unfiltered view',
        };
      }
    }
  }
  const records = unavailableDefaultView ? {
    ...unavailableDefaultView,
    data: null,
    info: null,
  } : await listRecords(m, { ...req.query, cvid, schedule_count: false });
  if (skipMeta) return { cvid, records, view_fallback };
  return { fields, views, cvid, records, view_fallback };
}));

app.get('/api/search/:module', (req, res) => wrap(res, async () => {
  const m = ident(req.params.module);
  const w = String(req.query.word || '').slice(0, 80);
  const per = Math.min(parseInt(req.query.per_page || '15', 10), 100);
  const rows = await sql(`select data from crm_records where module = ${lit(m)} and ${USER_DATA_ONLY} and search_text ilike ${lit('%' + w + '%')} order by modified_time desc nulls last limit ${per}`);
  return { data: rows.map(r => r.data) };
}));

app.get('/api/record/:module/:id', (req, res) => wrap(res, async () => {
  const module = ident(req.params.module);
  const [rows, layoutMeta] = await Promise.all([
    sql(`select data from crm_records where module = ${lit(module)} and id = ${lit(req.params.id)}`),
    meta('layouts:' + module),
  ]);
  const record = rows[0]?.data || null;
  const resolution = record ? resolveLayout(layoutMeta, { record }) : null;
  return {
    data: rows.map(row => row.data),
    layout_resolution: resolution ? {
      exact: resolution.exact,
      source: resolution.source,
      reason: resolution.reason,
      layout_id: resolution.layout?.id ? String(resolution.layout.id) : null,
      candidate_count: resolution.candidates.length,
    } : null,
  };
}));

app.get('/api/related/:module/:id/:related', (req, res) => wrap(res, async () => {
  const m = ident(req.params.module), id = req.params.id, relName = ident(req.params.related);
  const pageInfo = relatedPage(req.query);
  if (relName === 'Attachments') {
    const rows = await sql(`select data from crm_records where module = 'Attachments' and ${USER_DATA_ONLY} and data->'Parent_Id'->>'id' = ${lit(id)} order by created_time desc limit ${pageInfo.per_page + 1} offset ${pageInfo.offset}`);
    return paginatedRelatedResponse(rows, pageInfo, { related_module: 'Attachments' });
  }
  if (relName === 'Notes') {
    const rows = await sql(`select data from crm_records where module = 'Notes' and ${USER_DATA_ONLY} and data->'Parent_Id'->>'id' = ${lit(id)} order by created_time desc limit ${pageInfo.per_page + 1} offset ${pageInfo.offset}`);
    return paginatedRelatedResponse(rows, pageInfo, { related_module: 'Notes' });
  }
  const rls = await meta('related_lists:' + m);
  const rl = (rls?.related_lists || []).find(x => x.api_name === relName);
  if (!rl) return unresolvedRelatedResponse('RELATED_DEFINITION_NOT_MIRRORED', 'Source related-list definition/data unavailable in the local metadata snapshot.');
  const relMod = rl?.module?.api_name;
  if (!relMod) return unresolvedRelatedResponse('RELATED_TARGET_MODULE_UNRESOLVED', 'Source related-list target module/data unavailable in the local replica.');
  const fmeta = await meta('fields:' + relMod);
  if (!Array.isArray(fmeta?.fields)) return unresolvedRelatedResponse('RELATED_TARGET_FIELDS_UNAVAILABLE', 'Source related-list field metadata/data unavailable in the local replica.', { related_module: relMod });
  const resolution = resolveRelatedListLinkFields({ parentModule: m, relatedList: rl, fields: fmeta.fields });
  if (!resolution.available) return unresolvedRelatedResponse(resolution.reason_code, 'Source relationship definition is present, but its exact local link path/data is unavailable.', { related_module: relMod });
  const lookups = resolution.link_fields;
  const cond = lookups.map(f => `data->'${ident(f)}'->>'id' = ${lit(id)}`).join(' or ');
  const rows = await sql(`select data from crm_records where module = ${lit(relMod)} and ${USER_DATA_ONLY} and (${cond}) order by modified_time desc nulls last limit ${pageInfo.per_page + 1} offset ${pageInfo.offset}`);
  return paginatedRelatedResponse(rows, pageInfo, { related_module: relMod, link_fields: lookups, link_basis: resolution.basis });
}));

app.get('/api/notes/:module/:id', (req, res) => wrap(res, async () => {
  const pageInfo = relatedPage(req.query);
  const rows = await sql(`select data from crm_records where module = 'Notes' and ${USER_DATA_ONLY} and data->'Parent_Id'->>'id' = ${lit(req.params.id)} order by created_time desc limit ${pageInfo.per_page + 1} offset ${pageInfo.offset}`);
  return paginatedRelatedResponse(rows, pageInfo, { related_module: 'Notes' });
}));

// ---------- writes (to our database) ----------
const IST = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().replace(/\.\d{3}Z$/, '+05:30');
async function insertLocalNote(module, recordId, { title = '', content = '', invalidateAnalytics = true } = {}) {
  const id = `local-note-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const d = {
    id, Note_Title: title, Note_Content: content,
    Parent_Id: { id: recordId }, Created_Time: IST(), Modified_Time: IST(),
    Created_By: { name: 'MAGPPIE CRM' },
  };
  await rpc('crm_insert', { p_module: 'Notes', p_id: id, d, p_name: d.Note_Title || null, p_search: (d.Note_Title + ' ' + d.Note_Content).slice(0, 300) });
  rpc('crm_log', { p_module: module, p_record: recordId, p_action: 'note_added', p_changes: { preview: String(content).slice(0, 120) } }).catch(() => {});
  if (invalidateAnalytics) await invalidateDerivedReadCaches({ persistDashboardInvalidation: true });
  return id;
}
app.put('/api/record/:module/:id', (req, res) => wrap(res, async () => {
  const m = ident(req.params.module);
  const patch = await validateRecordPayload(m, { ...req.body }, { recordId: req.params.id, layoutId: req.query.layout_id });
  const data = await rpc('crm_patch', { p_module: m, p_id: req.params.id, patch });
  await invalidateDerivedReadCaches({ persistDashboardInvalidation: true });
  return { data: [{ status: 'success', details: { id: req.params.id }, data }] };
}));
app.post('/api/record/:module', (req, res) => wrap(res, async () => {
  const m = ident(req.params.module);
  const layoutContext = await layoutContextForRecord(m, { layoutId: req.query.layout_id, isCreate: true });
  const payload = await validateRecordPayload(m, { ...req.body }, { isCreate: true, layoutContext });
  const id = `local-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const layoutRef = layoutContext.exact ? { id: String(layoutContext.layout.id), name: layoutContext.layout.name, display_label: layoutContext.layout.display_label || layoutContext.layout.name } : null;
  const d = { ...payload, ...(layoutRef ? { Layout: layoutRef, $layout_id: layoutRef } : {}), id, Created_Time: IST(), Modified_Time: IST() };
  const nm = d.Full_Name || d.Deal_Name || d.Name || d.Subject || d.Last_Name || null;
  await rpc('crm_insert', { p_module: m, p_id: id, d, p_name: nm, p_search: [nm, d.Email, d.Phone, d.Mobile, d.Company].filter(Boolean).join(' ') });
  await invalidateDerivedReadCaches({ persistDashboardInvalidation: true });
  return { data: [{ status: 'success', details: { id } }] };
}));
app.post('/api/notes/:module/:id', (req, res) => wrap(res, async () => {
  const module = ident(req.params.module);
  const id = await insertLocalNote(module, req.params.id, { title: req.body.Note_Title || '', content: req.body.Note_Content || '' });
  return { data: [{ status: 'success', details: { id } }] };
}));

// change timeline (audit log kept by crm_patch / crm_insert / crm_log)
app.get('/api/timeline/:module/:id', (req, res) => wrap(res, async () => {
  const rows = await sql(`select at, actor, action, changes from crm_audit where module = ${lit(ident(req.params.module))} and record_id = ${lit(req.params.id)} order by at desc limit 200`);
  return { events: rows };
}));
app.post('/api/coql', (req, res) => res.status(410).json({ error: 'COQL retired — data now lives in the MAGPPIE database' }));

// ---------- Zoho sync: delta records + automation metadata ----------
const SYNC_MODULES = ['Leads', 'Contacts', 'Accounts', 'Deals', 'Tasks', 'Events', 'Calls', 'Products', 'Vendors',
  'Developers', 'Referral_Partners', 'Payment_Milestones', 'Designers', 'Visit_Module', 'AMS_Complaints', 'Notes'];
// Zoho documents deleted-record reads for standard/custom modules, but not
// Notes. The separate deletion engine and reversible SQL contract are staged;
// runtime execution stays disabled until catalog/lease verification and exact
// per-module starting baselines are available.
const DELETION_SYNC_MODULES = SYNC_MODULES.filter(moduleKey => moduleKey !== 'Notes');
const DELETION_ARCHIVE_MIGRATION = path.join(
  __dirname,
  'database',
  'migrations',
  '20260830_source_deletion_archive.sql',
);
const DELTA_SYNC_INTERVAL_MS = 15 * 60 * 1000;
const DELTA_SYNC_STATE_KEY = 'delta_sync_state_v2';
const DELTA_SYNC_PER_PAGE = 200;
const DELTA_SYNC_MAX_PAGES = 1_000;
const DELTA_SYNC_MAX_RECORDS_PER_MODULE = 60;
const DELTA_SYNC_MAX_RECORDS_PER_RUN = 60;
const DELTA_SYNC_SOURCE_DEADLINE_MS = 35_000;
const DELTA_SYNC_HARD_DEADLINE_MS = 55_000;
const DELTA_SYNC_MODULE_STRATEGIES = Object.freeze({
  [PAYMENT_MILESTONE_MODULE]: Object.freeze({ mode: 'snapshot' }),
});
const LEGACY_CURSOR_RECORD_SENTINEL = '0';
const NAME_PRIO = ['Full_Name', 'Deal_Name', 'Account_Name', 'Subject', 'Product_Name', 'Vendor_Name', 'Note_Title', 'Name', 'Last_Name'];
function recRow(m, rec, sourceSeenAt = new Date().toISOString()) {
  const data = {};
  for (const [k, v] of Object.entries(rec)) {
    if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) continue;
    data[k] = v;
  }
  let nm = null;
  for (const n of NAME_PRIO) { const v = data[n]; if (v != null && typeof v !== 'object') { nm = String(v); break; } }
  const parts = [nm, data.Email, data.Phone, data.Mobile, data.Company];
  if (data.Owner?.name) parts.push(data.Owner.name);
  if (data.Account_Name?.name) parts.push(data.Account_Name.name);
  return {
    module: m, id: data.id, data, name: nm,
    search_text: parts.filter(Boolean).join(' ').slice(0, 500),
    created_time: data.Created_Time || null, modified_time: data.Modified_Time || null,
    source_org_id: ZOHO_SOURCE_ORG_ID,
    source_seen_at: new Date(sourceSeenAt).toISOString(),
  };
}

function legacyDeltaStateSeed(info) {
  const state = emptyDeltaSyncState();
  const cursors = info?.delta_cursor && typeof info.delta_cursor === 'object' ? info.delta_cursor : {};
  for (const moduleKey of SYNC_MODULES) {
    const epoch = Date.parse(cursors[moduleKey]);
    if (!Number.isFinite(epoch)) continue;
    state.modules[moduleKey] = {
      cursor: {
        modified_time: new Date(Math.max(0, epoch - 1)).toISOString(),
        record_id: LEGACY_CURSOR_RECORD_SENTINEL,
      },
    };
  }
  return state;
}

async function loadLegacyDeltaSyncState({ signal } = {}) {
  const persisted = await meta_nocache(DELTA_SYNC_STATE_KEY, { signal });
  if (persisted) return normalizeDeltaSyncState(persisted);
  return legacyDeltaStateSeed((await meta_nocache('sync_info', { signal })) || {});
}

function makeDeltaSyncLeaseClient({ signal } = {}) {
  return createDeltaSyncLeaseClient({
    callRpc: (name, body) => rpc(name, body, { signal }),
  });
}

async function loadDeltaSyncStateEvidence({ signal } = {}) {
  try {
    const snapshot = await makeDeltaSyncLeaseClient({ signal }).readState();
    return {
      available: true,
      lease_active: snapshot.lease_active,
      state: normalizeDeltaSyncState(snapshot.state),
    };
  } catch {
    const state = await loadLegacyDeltaSyncState({ signal }).catch(() => emptyDeltaSyncState());
    return { available: false, lease_active: false, state };
  }
}

async function ensureSourceReplicationLock({ signal } = {}) {
  const existing = await meta_nocache('source_replication_lock', { signal });
  if (existing !== null) {
    if (
      !existing
      || typeof existing !== 'object'
      || Array.isArray(existing)
      || existing.verified !== true
      || existing.source_org_id !== ZOHO_SOURCE_ORG_ID
    ) {
      const error = new Error('The local source replication organization lock does not match the verified Zoho organization.');
      error.code = 'SOURCE_REPLICATION_LOCK_MISMATCH';
      throw error;
    }
    return;
  }
  await rpc('crm_meta_upsert', {
    k: 'source_replication_lock',
    d: {
      verified: true,
      source_org_id: ZOHO_SOURCE_ORG_ID,
      source_mode: ZOHO_SOURCE_MODE,
      verified_at: new Date().toISOString(),
    },
  }, { signal });
  memCache.delete('source_replication_lock');
}

async function listZohoModifiedRecords({ module, page, pageToken, perPage }, { signal } = {}) {
  const continuation = pageToken
    ? `page_token=${encodeURIComponent(String(pageToken))}`
    : `page=${encodeURIComponent(String(page))}`;
  return zoho(`/crm/v8/${module}?fields=Modified_Time&per_page=${perPage}&sort_by=Modified_Time&sort_order=desc&${continuation}`, { signal });
}

async function fetchZohoRecord({ module, recordId }, { signal } = {}) {
  const response = await zoho(`/crm/v8/${module}/${encodeURIComponent(String(recordId))}`, { signal });
  return response?.data?.[0] || null;
}

async function upsertReplicatedRecord({ module, record }, { signal } = {}) {
  const row = recRow(module, record);
  if (!row.id) {
    const error = new Error('Source record is missing its stable identifier.');
    error.code = 'SOURCE_RECORD_ID_MISSING';
    throw error;
  }
  const changed = await rpc('crm_bulk_upsert', { rows: [row] }, { signal });
  if (changed !== 1) {
    const error = new Error('The atomic source record upsert was incomplete.');
    error.code = 'SOURCE_UPSERT_COUNT_MISMATCH';
    throw error;
  }
}

function paymentMilestoneSnapshotAdapterForRun({ signal } = {}) {
  return createPaymentMilestoneSnapshotAdapter({
    sourceGet: pathname => zoho(pathname, { signal }),
    storageProbe: async () => {
      const response = await fetch(`${SUPA}/rest/v1/rpc/crm_payment_milestone_snapshot_upsert`, {
        method: 'POST',
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: [], s: SECRET }),
        signal,
      });
      const body = await response.json().catch(() => null);
      return {
        status: response.status,
        error: body && typeof body === 'object' && !Array.isArray(body)
          ? { code: body.code, message: body.message }
          : null,
      };
    },
    upsertRows: rows => rpc('crm_payment_milestone_snapshot_upsert', { rows }, { signal }),
    recordToRow: recRow,
  });
}

async function runDeltaSync({ stateStore, signal } = {}) {
  if (!stateStore || typeof stateStore.load !== 'function' || typeof stateStore.save !== 'function') {
    const error = new Error('A fenced delta-sync state store is required.');
    error.code = 'DELTA_SYNC_STATE_FENCE_REQUIRED';
    throw error;
  }
  if (!ZOHO_ON) {
    const error = new Error('Zoho read-only replication is not configured.');
    error.code = 'ZOHO_NOT_CONFIGURED';
    throw error;
  }
  const paymentMilestoneSnapshotAdapter = paymentMilestoneSnapshotAdapterForRun({ signal });
  await paymentMilestoneSnapshotAdapter.assertStorageCapability();
  await zohoOrgGuard.assertExpectedOrg({ signal });
  await ensureSourceReplicationLock({ signal });
  await paymentMilestoneSnapshotAdapter.assertCapability();
  const run = await runZohoDeltaSync({
    modules: SYNC_MODULES,
    moduleStrategies: DELTA_SYNC_MODULE_STRATEGIES,
    listModified: options => listZohoModifiedRecords(options, { signal }),
    listSnapshotIds: options => paymentMilestoneSnapshotAdapter.listSnapshotIds(options),
    fetchRecord: options => fetchZohoRecord(options, { signal }),
    upsertRecord: options => upsertReplicatedRecord(options, { signal }),
    upsertSnapshot: snapshot => paymentMilestoneSnapshotAdapter.upsertSnapshot(snapshot),
    stateStore,
    perPage: DELTA_SYNC_PER_PAGE,
    maxPages: DELTA_SYNC_MAX_PAGES,
    maxRecordsPerModule: DELTA_SYNC_MAX_RECORDS_PER_MODULE,
    maxRecordsPerRun: DELTA_SYNC_MAX_RECORDS_PER_RUN,
  });
  if (run.record_budget.processed > 0) {
    await invalidateDerivedReadCaches({ persistDashboardInvalidation: true });
  }
  return run;
}

async function runDeltaSyncJob() {
  return boundedDeltaSyncJob();
}

const boundedDeltaSyncJob = createBoundedDeltaSyncJob({
  createLeaseClient: makeDeltaSyncLeaseClient,
  runSync: runDeltaSync,
  sourceDeadlineMs: DELTA_SYNC_SOURCE_DEADLINE_MS,
  hardDeadlineMs: DELTA_SYNC_HARD_DEADLINE_MS,
});

const deltaSyncRunner = createIntervalRunner({
  intervalMs: DELTA_SYNC_INTERVAL_MS,
  run: () => runDeltaSyncJob(),
});

function vercelCronConfigured() {
  return process.env.VERCEL === '1'
    && process.env.VERCEL_ENV === 'production'
    && typeof process.env.CRON_SECRET === 'string'
    && process.env.CRON_SECRET.length > 0;
}

function nextVercelCronWindow(now = Date.now()) {
  return new Date((Math.floor(now / DELTA_SYNC_INTERVAL_MS) + 1) * DELTA_SYNC_INTERVAL_MS).toISOString();
}

function publicDeltaSyncStatus({ stateContractAvailable = null, leaseActive = false } = {}) {
  const current = deltaSyncRunner.status();
  const external = vercelCronConfigured();
  return {
    enabled: ZOHO_ON,
    started: external ? true : current.started,
    running: external ? leaseActive === true : current.running,
    scheduler_mode: external ? 'vercel-cron' : 'local-interval',
    externally_scheduled: external,
    execution_fenced: stateContractAvailable === true,
    source_mode: ZOHO_SOURCE_MODE,
    organization_lock: 'verified-before-refresh',
    interval_minutes: current.interval_minutes,
    next_run_at: external ? nextVercelCronWindow() : current.next_run_at,
    last_started_at: external ? null : current.last_started_at,
    last_finished_at: external ? null : current.last_finished_at,
    last_succeeded_at: external ? null : current.last_succeeded_at,
    last_trigger: external ? 'vercel-cron' : current.last_trigger,
    last_error: external ? null : (current.last_error ? 'Last refresh failed.' : null),
  };
}

async function publicDeltaSyncStatusWithState() {
  const evidence = await loadDeltaSyncStateEvidence();
  return {
    ...publicDeltaSyncStatus({
      stateContractAvailable: evidence.available,
      leaseActive: evidence.lease_active,
    }),
    state_available: evidence.available,
    last_completed_run: evidence.state.last_completed_run,
    last_successful_run: evidence.state.last_successful_run,
  };
}

app.get('/api/sync/status', (req, res) => wrap(res, () => publicDeltaSyncStatusWithState()));

app.get('/api/sync/delta', (req, res) => wrap(res, async () => {
  if (!ZOHO_ON) return { status: 'unavailable', source_mode: ZOHO_SOURCE_MODE, schedule: await publicDeltaSyncStatusWithState() };
  try {
    const outcome = await deltaSyncRunner.trigger({ reason: 'manual' });
    if (!outcome.accepted) return { status: 'already_running', schedule: await publicDeltaSyncStatusWithState() };
    return { status: 'succeeded', global_success: true, schedule: await publicDeltaSyncStatusWithState() };
  } catch (error) {
    if (error?.code === 'DELTA_SYNC_ALREADY_RUNNING') {
      return { status: 'already_running', schedule: await publicDeltaSyncStatusWithState() };
    }
    if (DELTA_SYNC_UNAVAILABLE_ERROR_CODES.has(error?.code)) {
      return { status: 'unavailable', source_mode: ZOHO_SOURCE_MODE, schedule: await publicDeltaSyncStatusWithState() };
    }
    if (error?.code !== 'DELTA_SYNC_INCOMPLETE') throw error;
    return { status: 'partial_refresh', global_success: false, schedule: await publicDeltaSyncStatusWithState() };
  }
}));

function normalizeReplicationSetEvidence(rows) {
  const observedAt = new Date(rows[0]?.observed_at || '').toISOString();
  const datasets = rows[0]?.datasets;
  if (!datasets || typeof datasets !== 'object' || Array.isArray(datasets)) {
    throw new Error('Current replication-set evidence is unavailable.');
  }
  const normalized = {};
  for (const moduleKey of ['Notes', 'Tasks']) {
    const count = Number(datasets[moduleKey]?.count);
    const setDigest = String(datasets[moduleKey]?.set_digest || '').toLowerCase();
    if (!Number.isSafeInteger(count) || count < 0 || !/^[a-f0-9]{64}$/.test(setDigest)) {
      throw new Error('Current replication-set evidence is incomplete.');
    }
    normalized[moduleKey] = {
      count,
      set_digest: setDigest,
      observed_at: observedAt,
      refresh_status: 'complete',
    };
  }
  return { observed_at: observedAt, datasets: normalized };
}

async function queryCurrentReplicationSetEvidence({ signal } = {}) {
  const rows = await sql(`with current_sets as (
    select
      module,
      count(*)::int as c,
      encode(extensions.digest(coalesce(string_agg(id, E'\\n' order by id), ''), 'sha256'), 'hex') as set_digest
    from crm_records
    where module = any(array['Notes', 'Tasks'])
      -- Source-derived CRM IDs are numeric; local/QA IDs are namespaced. Keeping
      -- this predicate on the primary-key columns avoids opening large JSON
      -- bodies while preserving the audited source-ID set definition.
      and id ~ '^[0-9]+$'
    group by module
  )
  select
    statement_timestamp() as observed_at,
    coalesce(jsonb_object_agg(module, jsonb_build_object('count', c, 'set_digest', set_digest)), '{}'::jsonb) as datasets
  from current_sets`, { signal });
  return normalizeReplicationSetEvidence(rows);
}

function degradedReplicationSetEvidence(evidence) {
  return {
    observed_at: evidence?.observed_at || null,
    datasets: Object.fromEntries(['Notes', 'Tasks'].map(moduleKey => [moduleKey, {
      count: Number.isSafeInteger(evidence?.datasets?.[moduleKey]?.count)
        ? evidence.datasets[moduleKey].count
        : null,
      set_digest: /^[a-f0-9]{64}$/.test(String(evidence?.datasets?.[moduleKey]?.set_digest || '').toLowerCase())
        ? String(evidence.datasets[moduleKey].set_digest).toLowerCase()
        : '',
      observed_at: evidence?.datasets?.[moduleKey]?.observed_at || evidence?.observed_at || null,
      refresh_status: 'partial',
    }])),
  };
}

function auditedReplicationSetEvidence({ notesAudit, taskDigests, taskDataset }) {
  return degradedReplicationSetEvidence({
    observed_at: null,
    datasets: {
      Notes: {
        count: Number.isSafeInteger(notesAudit?.local_count) ? notesAudit.local_count : null,
        set_digest: notesAudit?.set_digest || '',
        observed_at: notesAudit?.completed_at || null,
      },
      Tasks: {
        count: Number.isSafeInteger(Number(taskDataset?.source_active_ids))
          ? Number(taskDataset.source_active_ids)
          : null,
        set_digest: taskDigests.get('Tasks') || '',
        observed_at: taskSubformReconciliationConfig.audited_at || null,
      },
    },
  });
}

async function currentReplicationSetEvidence(fallbackEvidence) {
  if (!replicationSetEvidenceService) {
    replicationSetEvidenceService = createBoundedSnapshotCache({
      load: queryCurrentReplicationSetEvidence,
      degrade: degradedReplicationSetEvidence,
      freshTtlMs: REPLICATION_SET_EVIDENCE_FRESH_TTL_MS,
      fallbackRetryMs: REPLICATION_HEALTH_FALLBACK_RETRY_MS,
      responseWaitMs: REPLICATION_HEALTH_RESPONSE_WAIT_MS,
      queryTimeoutMs: REPLICATION_SET_EVIDENCE_QUERY_TIMEOUT_MS,
    });
  }
  return replicationSetEvidenceService.get({
    generation: derivedReadCacheGeneration,
    fallback: fallbackEvidence,
  });
}

async function queryReplicationHealthState({ signal } = {}) {
  return loadDeltaSyncStateEvidence({ signal });
}

async function boundedReplicationHealthState() {
  if (!replicationHealthStateService) {
    replicationHealthStateService = createBoundedSnapshotCache({
      load: ({ signal }) => queryReplicationHealthState({ signal }),
      degrade: evidence => ({
        available: false,
        state: evidence?.state || emptyDeltaSyncState(),
      }),
      freshTtlMs: REPLICATION_HEALTH_STATE_FRESH_TTL_MS,
      fallbackRetryMs: REPLICATION_HEALTH_FALLBACK_RETRY_MS,
      responseWaitMs: REPLICATION_HEALTH_RESPONSE_WAIT_MS,
      queryTimeoutMs: REPLICATION_HEALTH_STATE_QUERY_TIMEOUT_MS,
    });
  }
  return replicationHealthStateService.get({
    generation: derivedReadCacheGeneration,
    fallback: { state: emptyDeltaSyncState() },
  });
}

function exactReplicationEvidence({ datasetKey, auditedAt, sourceCount, sourceDigest, current }) {
  const exactIdParity = Boolean(
    sourceDigest
    && /^[a-f0-9]{64}$/.test(sourceDigest)
    && current.count === sourceCount
    && current.set_digest === sourceDigest
  );
  return {
    dataset: datasetKey,
    supported: true,
    refreshStatus: current.refresh_status || 'complete',
    audit: { at: auditedAt, count: sourceCount, exact: Boolean(sourceDigest) },
    local: { observedAt: current.observed_at, count: current.count },
    sourceRecheck: sourceDigest ? {
      at: auditedAt,
      count: sourceCount,
      exactIdParity,
    } : null,
  };
}

async function currentReplicationHealth() {
  const notesAudit = privateNotesAudit();
  const taskDigests = privateTaskSubformDigests();
  const taskDataset = taskSubformReconciliationConfig.datasets.find(dataset => dataset.module === 'Tasks');
  const fallbackEvidence = auditedReplicationSetEvidence({ notesAudit, taskDigests, taskDataset });
  const [stateEvidence, currentSets] = await Promise.all([
    boundedReplicationHealthState(),
    currentReplicationSetEvidence(fallbackEvidence),
  ]);
  const notesCurrent = currentSets.datasets.Notes;
  const tasksCurrent = currentSets.datasets.Tasks;
  const deletionReplication = buildSourceDeletionReadiness({
    scheduledModules: SYNC_MODULES,
    documentedModules: DELETION_SYNC_MODULES,
    engineImplemented: true,
    migrationStaged: fs.existsSync(DELETION_ARCHIVE_MIGRATION),
    contractVerified: false,
    leaseVerified: false,
    baselineReadyModules: 0,
    featureEnabledModules: 0,
    operationalEvidence: null,
  });
  return buildReplicationHealth({
    generatedAt: new Date(),
    catalog: { moduleDefinitions: 153, apiSupportedModules: 122 },
    schedule: {
      ...publicDeltaSyncStatus({
        stateContractAvailable: stateEvidence.available,
        leaseActive: stateEvidence.lease_active,
      }),
      scheduledRecordModules: SYNC_MODULES.length,
      stateAvailable: stateEvidence.available,
    },
    persistedState: stateEvidence.state,
    deletionReplication,
    reconciliation: [
      exactReplicationEvidence({
        datasetKey: 'Notes',
        auditedAt: dataCompletenessConfig.audited_at,
        sourceCount: Number(dataCompletenessConfig.notes.source_active_id_count),
        sourceDigest: notesAudit?.set_digest || null,
        current: notesCurrent,
      }),
      exactReplicationEvidence({
        datasetKey: 'Tasks',
        auditedAt: taskSubformReconciliationConfig.audited_at,
        sourceCount: Number(taskDataset?.source_active_ids || 0),
        sourceDigest: taskDigests.get('Tasks') || null,
        current: tasksCurrent,
      }),
    ],
  });
}

app.get('/api/meta/replication_health', (req, res) => wrap(res, () => currentReplicationHealth()));

app.get('/api/sync/automation', (req, res) => wrap(res, async () => {
  if (!ZOHO_ON) return { error: 'zoho not configured' };
  const out = {};
  const save = (k, d) => rpc('crm_meta_upsert', { k, d });
  let workflowDetails = [];
  try {
    let rules = [], page = 1;
    while (page <= 5) {
      const d = await zoho(`/crm/v8/settings/automation/workflow_rules?per_page=200&page=${page}`);
      rules.push(...(d?.workflow_rules || []));
      if (!d?.info?.more_records) break; page++;
    }
    await save('automation:workflow_rules', { workflow_rules: rules });
    out.workflow_rules = rules.length;
    for (let index = 0; index < rules.length; index += 4) {
      const batch = await Promise.all(rules.slice(index, index + 4).map(rule => zoho(`/crm/v8/settings/automation/workflow_rules/${encodeURIComponent(rule.id)}`).catch(() => null)));
      workflowDetails.push(...batch.flatMap(item => item?.workflow_rules || []));
    }
    await save('automation:workflow_rule_details', { workflow_rules: workflowDetails });
    out.workflow_rule_details = workflowDetails.length;
  } catch (e) { out.workflow_rules = 'ERR ' + String(e.message).slice(0, 80); }
  for (const spec of [
    { responseKey: 'field_updates', metaKey: 'automation:field_updates', sanitize: sanitizeFieldUpdate },
    { responseKey: 'tasks', metaKey: 'automation:tasks', sanitize: sanitizeAutomationTask },
    { responseKey: 'email_notifications', metaKey: 'automation:email_notifications', sanitize: sanitizeEmailNotification },
  ]) {
    try {
      const referencedIds = [...new Set(workflowDetails.flatMap(rule => (rule.conditions || []).flatMap(condition => [
        ...(condition.instant_actions?.actions || []),
        ...(condition.scheduled_actions || []).flatMap(schedule => schedule.actions || []),
      ])).filter(action => action.type === spec.responseKey).map(action => String(action.id)))];
      const detailed = await zohoAutomationActionDetails(spec.responseKey, referencedIds);
      const sanitized = detailed.map(spec.sanitize);
      await save(spec.metaKey, { [spec.responseKey]: sanitized });
      out[spec.responseKey] = sanitized.length;
    } catch (e) {
      out[spec.responseKey] = 'ERR ' + String(e.message).slice(0, 80);
    }
  }
  try {
    let webhooks = [], page = 1;
    while (page <= 5) {
      const d = await zoho(`/crm/v8/settings/automation/webhooks?per_page=200&page=${page}`);
      webhooks.push(...(d?.webhooks || []));
      if (!d?.info?.more_records) break; page++;
    }
    const sanitized = webhooks.map(webhook => ({
      id: String(webhook.id),
      name: webhook.name || null,
      module: webhook.module ? { id: webhook.module.id ? String(webhook.module.id) : null, api_name: webhook.module.api_name || null } : null,
      http_method: webhook.http_method || webhook.method || null,
      feature_type: webhook.feature_type || null,
      content_type: webhook.content_type || null,
      source: webhook.source || null,
      active: webhook.active,
      status: webhook.status && typeof webhook.status === 'object' ? { active: webhook.status.active } : null,
      created_time: webhook.created_time || null,
      modified_time: webhook.modified_time || null,
      endpoint_stored: false,
      headers_stored: false,
    }));
    await save('automation:webhooks', { webhooks: sanitized });
    out.webhooks = sanitized.length;
  } catch (e) { out.webhooks = 'ERR ' + String(e.message).slice(0, 80); }
  out.blueprints = {};
  for (const m of ['Leads', 'Contacts', 'Deals', 'Tasks', 'Visit_Module', 'AMS_Complaints', 'Service_Managements', 'Calls']) {
    try {
      const d = await zoho(`/crm/v8/settings/blueprints?module=${m}`);
      if (d?.blueprints?.length) { await save('automation:blueprints:' + m, d); out.blueprints[m] = d.blueprints.length; }
    } catch (e) {}
  }
  try {
    let fns = [], page = 1;
    while (page <= 5) {
      const d = await zoho(`/crm/v8/settings/functions?per_page=200&page=${page}`);
      fns.push(...(d?.functions || []));
      if (!d?.info?.more_records) break; page++;
    }
    await save('automation:functions', { functions: fns });
    out.functions = fns.length;
  } catch (e) { out.functions = 'ERR ' + String(e.message).slice(0, 80); }
  try {
    const d = await zoho('/crm/v8/Analytics?per_page=200');
    await save('automation:analytics', d);
    out.analytics = (d?.Analytics || []).length;
  } catch (e) { out.analytics = 'ERR ' + String(e.message).slice(0, 80); }
  await rpc('crm_meta_upsert', { k: 'automation_synced_at', d: { at: new Date().toISOString(), out } }).catch(() => {});
  return out;
}));

// Blueprint: source-defined local state machines. Source Zoho is never called
// here. Any enabled transition is one verified, atomic local-database RPC.
app.get('/api/blueprint/:module/:id', (req, res) => wrap(res, async () => {
  const module = ident(req.params.module);
  const atomicRuntime = await blueprintAtomicRuntime.initialize();
  const rows = await sql(`select data from crm_records where module = ${lit(module)} and id = ${lit(req.params.id)}`);
  const record = rows[0]?.data;
  if (!record) return { transitions: [], current: null, local: true, atomic_runtime: atomicRuntime };
  const blueprint = await activeBlueprintForRecord(module, record);
  if (!blueprint) return { transitions: [], current: null, local: true, atomic_runtime: atomicRuntime };
  const current = record[blueprint.state_field] ?? null;
  const eligible = blueprint.transitions
    .map(transition => {
      const definition = transitionDetailFor(blueprint, transition.id);
      return { transition, definition, policy: transitionPolicyReadinessFor(blueprint, transition, definition) };
    })
    .filter(({ transition, definition }) => transitionEligible(transition, definition, current, authoritativeConnectionsFor(blueprint), record))
    .map(({ transition, definition, policy }) => {
      const runtimeExecutable = policy.executable && atomicRuntime.runtime_executable;
      const policyBlockReason = policy.executable ? null : policy.reason;
      const runtimeBlockReason = policy.executable && !runtimeExecutable ? atomicRuntime.message : null;
      return {
        id: transition.id,
        name: definition?.name || String(transition.name || '').replace(/C$/, ''),
        next_value: transition.to?.display_value,
        next_actual_value: transition.to?.actual_value,
        common: transition.global === true || definition?.common === true,
        trigger_type: definition?.trigger_type || transition.trigger_type || 'manual',
        trigger_after: definition?.trigger_after || null,
        before: definition?.before || null,
        during_inputs: definition?.during_inputs || [],
        after_actions: definition?.after_actions || [],
        phase_coverage: definition ? 'Specified' : 'Not Inspected',
        policy_eligible: policy.executable,
        runtime_executable: runtimeExecutable,
        executable: runtimeExecutable,
        policy_block_reason: policyBlockReason,
        runtime_block_reason: runtimeBlockReason,
        block_reason: policyBlockReason || runtimeBlockReason,
      };
    });
  const transitions = eligible.filter(transition => transition.trigger_type !== 'automatic');
  const automatic_transitions = eligible.filter(transition => transition.trigger_type === 'automatic');
  return {
    blueprint: blueprint.name,
    blueprint_id: blueprint.id,
    state_field: blueprint.state_field,
    transitions,
    automatic_transitions,
    current,
    local: true,
    source_mode: ZOHO_SOURCE_MODE,
    atomic_runtime: atomicRuntime,
  };
}));
app.post('/api/blueprint/:module/:id', (req, res) => wrap(res, async () => {
  const module = ident(req.params.module);
  const rows = await sql(`select data from crm_records where module = ${lit(module)} and id = ${lit(req.params.id)}`);
  const record = rows[0]?.data;
  if (!record) {
    const error = new Error('Record not found.'); error.status = 404; error.code = 'RECORD_NOT_FOUND'; throw error;
  }
  const blueprint = await activeBlueprintForRecord(module, record);
  if (!blueprint) {
    const error = new Error('No active Blueprint applies to this record.'); error.status = 409; error.code = 'BLUEPRINT_NOT_APPLICABLE'; throw error;
  }
  const transition = blueprint.transitions.find(item => String(item.id) === String(req.body?.transition_id || ''));
  if (!transition) {
    const error = new Error('Transition is not part of the active Blueprint.'); error.status = 404; error.code = 'TRANSITION_NOT_FOUND'; throw error;
  }
  const definition = transitionDetailFor(blueprint, transition.id);
  const current = record[blueprint.state_field] ?? null;
  if (!transitionEligible(transition, definition, current, authoritativeConnectionsFor(blueprint), record)) {
    const error = new Error('Transition is not eligible from the record’s current state.'); error.status = 409; error.code = 'TRANSITION_NOT_ELIGIBLE'; throw error;
  }
  if ((definition?.trigger_type || transition.trigger_type) === 'automatic') {
    const error = new Error('Automatic Blueprint transitions cannot be submitted as user actions.'); error.status = 409; error.code = 'AUTOMATIC_TRANSITION'; throw error;
  }
  const policy = transitionPolicyReadinessFor(blueprint, transition, definition);
  if (!policy.executable) {
    const error = new Error(policy.reason); error.status = 409; error.code = 'TRANSITION_EXECUTION_BLOCKED'; throw error;
  }

  const { data, notes } = validateTransitionPayload(definition, record, req.body || {});
  const nextState = transitionStateValue(transition);
  await validateRecordPayload(module, { ...data, [blueprint.state_field]: nextState }, { recordId: req.params.id, allowBlueprintState: true });
  const result = await blueprintAtomicRuntime.execute({
    module,
    recordId: req.params.id,
    stateField: blueprint.state_field,
    expectedState: current,
    expectedModifiedTime: record.Modified_Time,
    nextState,
    blueprintId: String(blueprint.id),
    blueprintName: blueprint.name,
    transitionId: String(transition.id),
    transitionName: definition.name,
    patch: data,
    note: notes ? { title: `${definition.name} — Blueprint`, content: notes } : null,
  });
  await invalidateDerivedReadCaches({ prewarmAnalytics: false, persistDashboardInvalidation: true });
  return {
    data: [{ status: 'success', details: { transition_id: result.transition_id } }],
    blueprint: blueprint.name,
    transition: definition.name,
    from: result.from,
    to: result.to,
    modified_time: result.modified_time,
    note_created: result.note_created,
    source_mode: ZOHO_SOURCE_MODE,
  };
}));

// ---------- dashboard (single SQL round trip behind resilient SWR/LKG service) ----------
const istDay = (offsetDays = 0) => new Date(Date.now() + 5.5 * 3600 * 1000 - offsetDays * 86400 * 1000).toISOString().slice(0, 10);
const rangeCache = new Map();
const CONTACT_VALUE_TEXT = `replace(replace(btrim(coalesce(data->>'Total_Opportunity_Value','')), ',', ''), '₹', '')`;
const CONTACT_VALUE_VALID = `${CONTACT_VALUE_TEXT} ~ '^-?([0-9]+([.][0-9]+)?|[.][0-9]+)$'`;
const journeyLeadAggregate = filter => `(select coalesce(jsonb_agg(t),'[]') from (
  select status as raw_value, count(*)::int as count
  from crm_records where module='Leads' and ${USER_DATA_ONLY}${filter ? ` and ${filter}` : ''}
  group by status
) t)`;
const journeyContactAggregate = filter => `(select coalesce(jsonb_agg(t),'[]') from (
  select status as raw_value,
    count(*)::int as count,
    coalesce(sum(case when ${CONTACT_VALUE_VALID} then (${CONTACT_VALUE_TEXT})::numeric else 0 end), 0)::float8 as value_lacs,
    count(*) filter (where ${CONTACT_VALUE_VALID})::int as value_count,
    count(*) filter (where nullif(btrim(coalesce(data->>'Total_Opportunity_Value','')), '') is not null and not (${CONTACT_VALUE_VALID}))::int as invalid_value_count
  from crm_records where module='Contacts' and ${USER_DATA_ONLY}${filter ? ` and ${filter}` : ''}
  group by status
) t)`;
async function attachJourneyDashboard(result, { generatedAt, snapshotAt, range = null, signal } = {}) {
  const [leadFields, contactFields] = await Promise.all([
    meta('fields:Leads', { signal }),
    meta('fields:Contacts', { signal }),
  ]);
  return buildJourneyDashboard({
    leadFields,
    contactFields,
    leadRows: result.journeyLeads,
    contactRows: result.journeyContacts,
    snapshotAt,
    generatedAt,
    range,
  });
}
async function computeHomeDashboard({ signal, generation }) {
  const today = istDay(0), month = today.slice(0, 8) + '01', d14 = istDay(13);
  // aggregates run on extracted, indexed columns (status/due_date/ts2) — never on the JSON documents
  const istTs = day => `(${lit(day + 'T00:00:00+05:30')})::timestamptz`;
  const q = `select jsonb_build_object(
    'leadsByStatus', (select coalesce(jsonb_agg(t),'[]') from (select status as "Lead_Status", count(*)::int as cnt from crm_records where module='Leads' group by 1) t),
    'dealsByStage', (select coalesce(jsonb_agg(t),'[]') from (select status as "Stage", count(*)::int as cnt from crm_records where module='Deals' group by 1) t),
    'contactsByStatus', (select coalesce(jsonb_agg(t),'[]') from (select status as "Status", count(*)::int as cnt from crm_records where module='Contacts' and ${USER_DATA_ONLY} group by 1) t),
    'journeyLeads', ${journeyLeadAggregate('')},
    'journeyContacts', ${journeyContactAggregate('')},
    'leadsBySource', (select coalesce(jsonb_agg(t),'[]') from (select data->>'Lead_Source' as "Lead_Source", count(*)::int as cnt from crm_records where module='Leads' and created_time >= ${istTs(month)} group by 1) t),
    'tasksOpen', (select coalesce(jsonb_agg(t),'[]') from (select status as "Status", count(*)::int as cnt from crm_records where module='Tasks' and coalesce(status,'') != 'Completed' group by 1) t),
    'leadsToday', (select count(*)::int from crm_records where module='Leads' and created_time >= ${istTs(today)}),
    'leadsMonth', (select count(*)::int from crm_records where module='Leads' and created_time >= ${istTs(month)}),
    'callsToday', (select count(*)::int from crm_records where module='Calls' and ts2 >= ${lit(today)}),
    'callsWeek', (select count(*)::int from crm_records where module='Calls' and ts2 >= ${lit(istDay(6))}),
    'meetingsToday', (select count(*)::int from crm_records where module='Events' and ts2 >= ${lit(today)}),
    'totalLeads', (select count(*)::int from crm_records where module='Leads'),
    'totalDeals', (select count(*)::int from crm_records where module='Deals'),
    'tasksDueToday', (select count(*)::int from crm_records where module='Tasks' and due_date = ${lit(today)} and coalesce(status,'') != 'Completed'),
    'tasksOverdue', (select count(*)::int from crm_records where module='Tasks' and due_date < ${lit(today)} and coalesce(status,'') != 'Completed'),
    'trendRows', (select coalesce(jsonb_agg(t),'[]') from (select to_char(created_time at time zone 'Asia/Kolkata', 'YYYY-MM-DD') d, count(*)::int c from crm_records where module='Leads' and created_time >= ${istTs(d14)} group by 1) t),
    'recentLeads', (select coalesce(jsonb_agg(t.data),'[]') from (select data from crm_records where module='Leads' order by created_time desc nulls last limit 6) t),
    'recentDeals', (select coalesce(jsonb_agg(t.data),'[]') from (select data from crm_records where module='Deals' order by modified_time desc nulls last limit 6) t),
    'taskList', (select coalesce(jsonb_agg(t.data),'[]') from (select data from crm_records where module='Tasks' and due_date <= ${lit(today)} and coalesce(status,'') != 'Completed' order by due_date asc limit 12) t)
  ) r`;
  const rows = await sql(q, { signal });
  const r = rows[0]?.r || {};
  const trend = {};
  for (let i = 13; i >= 0; i--) trend[istDay(i)] = 0;
  (r.trendRows || []).forEach(x => { if (x.d in trend) trend[x.d] = x.c; });
  const sync = await meta('sync_info', { signal }).catch(error => {
    if (signal?.aborted) throw error;
    return null;
  });
  const generatedAt = new Date().toISOString();
  const snapshotAt = sync?.delta_at || sync?.at || null;
  const journey = await attachJourneyDashboard(r, { generatedAt, snapshotAt, signal });
  const data = {
    generated_at: generatedAt,
    snapshot_at: sync?.at || null,
    today,
    kpis: {
      leadsToday: r.leadsToday, leadsMonth: r.leadsMonth, callsToday: r.callsToday, callsWeek: r.callsWeek,
      meetingsToday: r.meetingsToday, totalLeads: r.totalLeads, totalDeals: r.totalDeals,
      tasksOpen: (r.tasksOpen || []).reduce((a, x) => a + x.cnt, 0),
      tasksDueToday: r.tasksDueToday, tasksOverdue: r.tasksOverdue,
    },
    leadsByStatus: r.leadsByStatus, dealsByStage: r.dealsByStage, contactsByStatus: r.contactsByStatus, leadsBySource: r.leadsBySource, tasksOpen: r.tasksOpen,
    trend, recentLeads: r.recentLeads, recentDeals: r.recentDeals, taskList: r.taskList, journey,
  };
  if (generation === derivedReadCacheGeneration) {
    queuePersistedDashboardCache(async persistSignal => {
      if (generation !== derivedReadCacheGeneration) return;
      await rpc('crm_meta_upsert', {
        k: 'dash_cache',
        d: { at: new Date().toISOString(), invalidated: false, data },
      }, { signal: persistSignal });
    }).catch(() => {});
  }
  return data;
}

const HOME_DASHBOARD_FRESH_TTL_MS = 60_000;
// crm_sql has a 15s database statement bound. Allow network/serialization
// headroom so the application does not abort a query the database can still
// complete, while keeping cold Home reads strictly bounded.
const HOME_DASHBOARD_COMPUTE_TIMEOUT_MS = 20_000;
const PERSISTED_HOME_DASHBOARD_MAX_AGE_MS = 660_000;

homeDashboardService = createHomeDashboardService({
  compute: computeHomeDashboard,
  freshTtlMs: HOME_DASHBOARD_FRESH_TTL_MS,
  computeTimeoutMs: HOME_DASHBOARD_COMPUTE_TIMEOUT_MS,
});

function persistedHomeDashboardIsUsable(cached, cachedAt, generation) {
  return cached?.invalidated !== true
    && cached?.data
    && typeof cached.data === 'object'
    && !Array.isArray(cached.data)
    && cached.data.journey?.schema_version === 1
    && Number.isFinite(cachedAt)
    && cachedAt > persistedDashboardCacheNotBefore
    && Date.now() - cachedAt >= 0
    && Date.now() - cachedAt < PERSISTED_HOME_DASHBOARD_MAX_AGE_MS
    && generation === derivedReadCacheGeneration
    && homeDashboardService.status().generation === generation;
}

function seedHomeDashboardFromPersistedCache() {
  const generation = derivedReadCacheGeneration;
  if (homeDashboardService.status().has_last_known_good) return Promise.resolve(false);
  if (persistedDashboardSeedCompletedGeneration === generation) return Promise.resolve(false);
  if (persistedDashboardSeedFlight?.generation === generation) return persistedDashboardSeedFlight.promise;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PERSISTED_DASHBOARD_CACHE_TIMEOUT_MS);
  const flight = { generation, controller, promise: null };
  flight.promise = meta_nocache('dash_cache', { signal: controller.signal })
    .then(cached => {
      const cachedAt = Date.parse(cached?.at || '');
      if (!persistedHomeDashboardIsUsable(cached, cachedAt, generation)) return false;
      return homeDashboardService.seed(cached.data, { storedAt: cachedAt });
    })
    .catch(() => false)
    .finally(() => {
      clearTimeout(timer);
      if (generation === derivedReadCacheGeneration) persistedDashboardSeedCompletedGeneration = generation;
      if (persistedDashboardSeedFlight === flight) persistedDashboardSeedFlight = null;
    });
  persistedDashboardSeedFlight = flight;
  return flight.promise;
}

app.get('/api/dashboard', (req, res) => wrap(res, async () => {
  const dOk = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
  if (dOk(req.query.from) && dOk(req.query.to)) return rangedDashboard(req.query.from, req.query.to);

  const force = req.query.force === '1';
  if (!force) await seedHomeDashboardFromPersistedCache();
  return force ? homeDashboardService.refresh() : homeDashboardService.get();
}));

async function rangedDashboard(from, to) {
  const generation = derivedReadCacheGeneration;
  const ck = from + ':' + to;
  const hit = rangeCache.get(ck);
  if (hit && Date.now() - hit.at < 60_000) return hit.data;
  const today = istDay(0);
  const tsFrom = `(${lit(from + 'T00:00:00+05:30')})::timestamptz`;
  const tsToEx = `((${lit(to + 'T00:00:00+05:30')})::timestamptz + interval '1 day')`;
  const cf = `created_time >= ${tsFrom} and created_time < ${tsToEx}`;
  const nextDay = new Date(new Date(to + 'T00:00:00Z').getTime() + 86400000).toISOString().slice(0, 10);
  const tf = `ts2 >= ${lit(from)} and ts2 < ${lit(nextDay)}`;
  const spanDays = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
  const daily = spanDays <= 62;
  const trendExpr = daily ? `to_char(created_time at time zone 'Asia/Kolkata', 'YYYY-MM-DD')` : `to_char(created_time at time zone 'Asia/Kolkata', 'YYYY-MM')`;
  const q = `select jsonb_build_object(
    'leadsByStatus', (select coalesce(jsonb_agg(t),'[]') from (select status as "Lead_Status", count(*)::int as cnt from crm_records where module='Leads' and ${cf} group by 1) t),
    'dealsByStage', (select coalesce(jsonb_agg(t),'[]') from (select status as "Stage", count(*)::int as cnt from crm_records where module='Deals' and ${cf} group by 1) t),
    'contactsByStatus', (select coalesce(jsonb_agg(t),'[]') from (select status as "Status", count(*)::int as cnt from crm_records where module='Contacts' and ${USER_DATA_ONLY} and ${cf} group by 1) t),
    'journeyLeads', ${journeyLeadAggregate(cf)},
    'journeyContacts', ${journeyContactAggregate(cf)},
    'leadsBySource', (select coalesce(jsonb_agg(t),'[]') from (select data->>'Lead_Source' as "Lead_Source", count(*)::int as cnt from crm_records where module='Leads' and ${cf} group by 1) t),
    'tasksOpen', (select coalesce(jsonb_agg(t),'[]') from (select status as "Status", count(*)::int as cnt from crm_records where module='Tasks' and coalesce(status,'') != 'Completed' group by 1) t),
    'rangeLeads', (select count(*)::int from crm_records where module='Leads' and ${cf}),
    'rangeDeals', (select count(*)::int from crm_records where module='Deals' and ${cf}),
    'rangeContacts', (select count(*)::int from crm_records where module='Contacts' and ${USER_DATA_ONLY} and ${cf}),
    'rangeCalls', (select count(*)::int from crm_records where module='Calls' and ${tf}),
    'rangeMeetings', (select count(*)::int from crm_records where module='Events' and ${tf}),
    'totalLeads', (select count(*)::int from crm_records where module='Leads'),
    'totalDeals', (select count(*)::int from crm_records where module='Deals'),
    'tasksDueToday', (select count(*)::int from crm_records where module='Tasks' and due_date = ${lit(today)} and coalesce(status,'') != 'Completed'),
    'tasksOverdue', (select count(*)::int from crm_records where module='Tasks' and due_date < ${lit(today)} and coalesce(status,'') != 'Completed'),
    'trendRows', (select coalesce(jsonb_agg(t),'[]') from (select ${trendExpr} d, count(*)::int c from crm_records where module='Leads' and ${cf} group by 1 order by 1) t),
    'recentLeads', (select coalesce(jsonb_agg(t.data),'[]') from (select data from crm_records where module='Leads' and ${cf} order by created_time desc nulls last limit 6) t),
    'recentDeals', (select coalesce(jsonb_agg(t.data),'[]') from (select data from crm_records where module='Deals' and ${cf} order by modified_time desc nulls last limit 6) t),
    'taskList', (select coalesce(jsonb_agg(t.data),'[]') from (select data from crm_records where module='Tasks' and due_date <= ${lit(today)} and coalesce(status,'') != 'Completed' order by due_date asc limit 12) t)
  ) r`;
  const rows = await sql(q);
  const r = rows[0]?.r || {};
  const trend = {};
  if (daily) {
    for (let i = 0; i < spanDays; i++) trend[new Date(new Date(from + 'T00:00:00Z').getTime() + i * 86400000).toISOString().slice(0, 10)] = 0;
  }
  (r.trendRows || []).forEach(x => { trend[x.d] = x.c; });
  const sync = await meta('sync_info').catch(() => null);
  const generatedAt = new Date().toISOString();
  const snapshotAt = sync?.delta_at || sync?.at || null;
  const journey = await attachJourneyDashboard(r, { generatedAt, snapshotAt, range: { from, to } });
  const data = {
    generated_at: generatedAt, snapshot_at: sync?.at || null, today,
    ranged: true, range: { from, to, daily },
    kpis: {
      rangeLeads: r.rangeLeads, rangeDeals: r.rangeDeals, rangeContacts: r.rangeContacts,
      rangeCalls: r.rangeCalls, rangeMeetings: r.rangeMeetings,
      totalLeads: r.totalLeads, totalDeals: r.totalDeals,
      tasksOpen: (r.tasksOpen || []).reduce((a, x) => a + x.cnt, 0),
      tasksDueToday: r.tasksDueToday, tasksOverdue: r.tasksOverdue,
    },
    leadsByStatus: r.leadsByStatus, dealsByStage: r.dealsByStage, contactsByStatus: r.contactsByStatus,
    leadsBySource: r.leadsBySource, tasksOpen: r.tasksOpen,
    trend, recentLeads: r.recentLeads, recentDeals: r.recentDeals, taskList: r.taskList, journey,
  };
  if (generation === derivedReadCacheGeneration) rangeCache.set(ck, { at: Date.now(), data });
  return data;
}

function journeyRangeFilter(query) {
  const from = String(query.from || '');
  const to = String(query.to || '');
  const present = Boolean(from || to);
  const valid = /^\d{4}-\d{2}-\d{2}$/;
  if (!present) return { sql: '', range: null };
  if (!valid.test(from) || !valid.test(to) || from > to) {
    const error = new Error('A valid from/to date range is required.');
    error.status = 400;
    error.code = 'INVALID_JOURNEY_DATE_RANGE';
    throw error;
  }
  return {
    sql: ` and created_time >= (${lit(from + 'T00:00:00+05:30')})::timestamptz and created_time < ((${lit(to + 'T00:00:00+05:30')})::timestamptz + interval '1 day')`,
    range: { from, to },
  };
}

// Dashboard drilldown is intentionally narrower than the generic record API:
// module and field are hard-allowlisted, and every non-missing match is exact.
app.get('/api/dashboard/journey/records/:lane', (req, res) => wrap(res, async () => {
  const definition = LANE_DEFINITIONS[String(req.params.lane || '')];
  if (!definition) {
    const error = new Error('Unknown journey lane.');
    error.status = 404;
    error.code = 'JOURNEY_LANE_NOT_FOUND';
    throw error;
  }
  const missing = req.query.missing === '1';
  let values;
  try {
    values = normalizeDrilldownValues(req.query.value);
  } catch (error) {
    error.status = 400;
    error.code = 'INVALID_JOURNEY_MATCH';
    throw error;
  }
  if ((missing && values.length) || (!missing && !values.length)) {
    const error = new Error('Choose either a missing-value match or one or more exact field values.');
    error.status = 400;
    error.code = 'INVALID_JOURNEY_MATCH';
    throw error;
  }
  const { sql: dateFilter, range } = journeyRangeFilter(req.query);
  const perPageInput = Number.parseInt(req.query.per_page || '50', 10);
  const pageInput = Number.parseInt(req.query.page || '1', 10);
  const perPage = Math.min(Math.max(Number.isFinite(perPageInput) ? perPageInput : 50, 1), 100);
  const page = Math.max(Number.isFinite(pageInput) ? pageInput : 1, 1);
  const statusFilter = missing
    ? ` and (status is null or btrim(status) = '')`
    : ` and status = any(array[${values.map(lit).join(',')}]::text[])`;
  const valueExpression = definition.valueField
    ? `case when ${CONTACT_VALUE_VALID} then (${CONTACT_VALUE_TEXT})::float8 else null end`
    : 'null::float8';
  const where = `module = ${lit(definition.module)} and ${USER_DATA_ONLY}${statusFilter}${dateFilter}`;
  const rows = await sql(`with matched as (
    select id,
      coalesce(nullif(name, ''), nullif(data->>'Full_Name', ''), '(unnamed record)') as record_name,
      status as source_value,
      owner,
      created_time,
      modified_time,
      ${valueExpression} as value_lacs
    from crm_records
    where ${where}
  )
  select jsonb_build_object(
    'data', (select coalesce(jsonb_agg(t), '[]') from (
      select id, record_name, source_value, owner, created_time, modified_time, value_lacs
      from matched order by modified_time desc nulls last, id desc
      limit ${perPage} offset ${(page - 1) * perPage}
    ) t),
    'total', (select count(*)::int from matched)
  ) r`);
  const result = rows[0]?.r || { data: [], total: 0 };
  const total = Number(result.total || 0);
  return {
    source_mode: 'local-read-only',
    match: {
      lane: definition.key,
      module: definition.module,
      field: definition.field,
      kind: missing ? 'missing' : 'exact',
      values: missing ? [] : values,
    },
    range,
    data: Array.isArray(result.data) ? result.data : [],
    info: {
      page,
      per_page: perPage,
      total,
      more_records: page * perPage < total,
    },
  };
}));

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

module.exports = app;
module.exports.constantTimeStringEqual = constantTimeStringEqual;
module.exports.createVercelCronDeltaSyncHandler = createVercelCronDeltaSyncHandler;
module.exports.isExactVercelCronDeltaSyncRequest = isExactVercelCronDeltaSyncRequest;
if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`MAGPPIE CRM (own database) → http://${HOST}:${PORT}`);
    cachedAnalyticsOverview({})
      .catch(() => null)
      .then(() => crmAgentRouteService.status())
      .then(status => status?.deterministic_available === true
        ? Promise.allSettled([
          crmAgentRouteService.chat({ prompt: 'Count Leads by Lead Status' }),
          crmAgentRouteService.chat({ prompt: 'Count records in Leads' }),
          crmAgentRouteService.chat({ prompt: 'Count records in Calls by Call Result' }),
        ])
        : null)
      .catch(() => {});
    if (ZOHO_ON) {
      deltaSyncRunner.start();
      console.log('Zoho GET-only delta refresh scheduled every 15 minutes.');
    }
  });
}
