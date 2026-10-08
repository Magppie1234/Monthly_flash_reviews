'use strict';

// Snapshot-based MAGPPIE CRM server. The MIS route has an isolated read-only Zoho pipeline.
// This entrypoint never initializes outbound CRM writes,
// Supabase, telephony, WhatsApp, automation, or AI provider integrations.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const { buildJourneyDashboard, LANE_DEFINITIONS } = require('./lib/journey-dashboard');
const { resolveRelatedListLinkFields } = require('./lib/related-list-resolver');

const app = express();
const PORT = Number(process.env.CLONE_PORT || 3100);
const HOST = process.env.CLONE_HOST || '127.0.0.1';
const ACCESS_CODE = process.env.ACCESS_CODE || '';
const DEFAULT_SNAPSHOT_DIR = process.env.VERCEL
  ? path.join(process.cwd(), 'snapshot-data')
  : path.join(__dirname, '.private', 'offline-snapshot');
const SNAPSHOT_DIR = path.resolve(process.env.CRM_OFFLINE_SNAPSHOT_DIR || DEFAULT_SNAPSHOT_DIR);
// A hosted function evaluates this module again on every cold start. A time-based value would
// look like a new release to the browser's version check and reload the page under the reviewer.
const BUILD = process.env.VERCEL_DEPLOYMENT_ID || `offline-${Date.now()}`;

function readPrivateJson(file) {
  const stat = fs.statSync(file);
  // Vercel normalizes bundled assets to 0644 inside an immutable function
  // image. Local snapshots must remain owner-only; deployed files remain
  // unreachable as static assets and are protected by the application gate.
  // Windows uses NTFS ACLs; its synthesized POSIX mode cannot express 0600.
  if (process.platform !== 'win32' && !process.env.VERCEL && (stat.mode & 0o077) !== 0) {
    throw new Error(`Snapshot permissions are too broad: ${path.basename(file)}`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadSnapshot() {
  // The snapshot is private and never committed, so a deployment built from git has none. The
  // Monthly Flash Review needs only the staff directory: start without CRM data rather than fail
  // to load. A snapshot that is present but incomplete or altered still throws below.
  if (!fs.existsSync(path.join(SNAPSHOT_DIR, 'manifest.json'))) {
    return {
      available: false,
      manifest: { record_counts: {} },
      metadata: { modules: { modules: [] }, fields: {}, views: {}, layouts: {}, related_lists: {} },
      records: {},
      indexes: {},
    };
  }
  const manifest = readPrivateJson(path.join(SNAPSHOT_DIR, 'manifest.json'));
  const metadata = readPrivateJson(path.join(SNAPSHOT_DIR, 'metadata.json'));
  if (manifest.schema_version >= 4 && (manifest.source_org_id !== '60046349006' || metadata.org?.org?.length !== 1 || String(metadata.org.org[0].zgid) !== manifest.source_org_id)) {
    throw new Error('Snapshot organisation identity mismatch');
  }
  const records = {};
  const indexes = {};
  for (const moduleName of Object.keys(manifest.record_counts || {})) {
    records[moduleName] = readPrivateJson(path.join(SNAPSHOT_DIR, 'records', `${moduleName}.json`));
    if (manifest.schema_version >= 4) {
      const bytes = fs.readFileSync(path.join(SNAPSHOT_DIR, 'records', `${moduleName}.json`));
      if (crypto.createHash('sha256').update(bytes).digest('hex') !== manifest.record_sha256?.[moduleName]
        || records[moduleName].length !== manifest.record_counts[moduleName]
        || records[moduleName].some(row => typeof row.id !== 'string' || !/^1032257\d+$/.test(row.id))) {
        throw new Error('Snapshot payload integrity or organisation namespace mismatch');
      }
    }
    indexes[moduleName] = new Map(records[moduleName].map(record => [String(record.id), record]));
  }
  return { available: true, manifest, metadata, records, indexes };
}

const snapshot = loadSnapshot();

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

const LOGIN_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MAGPPIE CRM — Sign in</title><style>body{font-family:Inter,-apple-system,"Segoe UI",sans-serif;background:#f5f6fa;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}.card{background:#fff;border:1px solid #e5e7eb;border-radius:20px;padding:38px 42px;width:330px;text-align:center;box-shadow:0 12px 40px #1416231f}.lg{width:46px;height:46px;border-radius:14px;background:#4f46e5;color:#fff;font-weight:800;font-size:22px;display:flex;align-items:center;justify-content:center;margin:0 auto 14px}h1{font-size:19px;margin:0 0 4px}h1 span{color:#4f46e5}p{color:#7c8291;font-size:13px;margin:0 0 22px}input,button{width:100%;height:42px;border-radius:11px;box-sizing:border-box;font:inherit}input{border:1px solid #e5e7eb;padding:0 13px;margin-bottom:12px}button{border:0;background:#4f46e5;color:#fff;font-weight:600}.err{color:#dc2626;font-size:12px;height:16px;margin-top:8px}</style></head><body><div class="card"><div class="lg">M</div><h1>MAGPPIE <span>CRM</span></h1><p>Local snapshot access</p><input id="c" type="password" placeholder="Access code" autofocus><button onclick="go()">Sign in</button><div class="err" id="e"></div></div><script>function go(){fetch('/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:document.getElementById('c').value})}).then(r=>{if(r.ok)location.reload();else document.getElementById('e').textContent='Wrong code'})}document.getElementById('c').addEventListener('keydown',e=>{if(e.key==='Enter')go()})</script></body></html>`;

function constantTimeEqual(actual, expected) {
  const left = Buffer.from(String(actual || ''));
  const right = Buffer.from(String(expected || ''));
  if (left.length !== right.length) return false;
  return left.length > 0 && crypto.timingSafeEqual(left, right);
}

app.post('/auth', (req, res) => {
  if (ACCESS_CODE && constantTimeEqual(req.body?.code, ACCESS_CODE)) {
    res.setHeader('Set-Cookie', `crm_auth=${encodeURIComponent(ACCESS_CODE)}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax`);
    return res.json({ ok: true });
  }
  return res.status(401).json({ ok: false });
});

app.use((req, res, next) => {
  if (!ACCESS_CODE) return next();
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(item => item.trim().split('=').map(decodeURIComponent)).filter(pair => pair[0]));
  if (constantTimeEqual(cookies.crm_auth, ACCESS_CODE)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'unauthorized' });
  return res.status(401).type('html').send(LOGIN_HTML);
});

// Only the minimal, verified staff directory is added to this snapshot runtime.
// Credentials and live CRM payloads are never served to the browser.
app.get('/api/flash-review/people', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const { buildReviewDirectory } = require('./lib/flash-review-directory');
    const roster = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/flash-review-roster.json'), 'utf8'));
    const mapping = JSON.parse(fs.readFileSync(path.join(__dirname, 'config/flash-review-roles.json'), 'utf8'));
    return res.json(buildReviewDirectory(roster, mapping));
  } catch {
    return res.status(503).json({error:'STAFF_DIRECTORY_UNAVAILABLE',message:'The verified employee directory is unavailable. Please retry after it has been refreshed.'});
  }
});

// Reviews are the one thing this server stores. Mounted ahead of the read-only rule below, which
// protects the CRM snapshot, not the reviews.
require('./lib/review-store').mountReviews(app);

app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'HEAD'].includes(req.method)) {
    return res.status(409).json({
      error: 'SNAPSHOT_READ_ONLY',
      message: 'This CRM is running from the last local snapshot. Writes and external integrations are paused.',
    });
  }
  return next();
});

require('./lib/flash-mis').mountMis(app, __dirname);

// Every route below reads the snapshot. Without one they say so plainly; the browser already
// treats a failed /api/boot as "CRM unavailable" and keeps the Monthly Flash Review usable.
app.use('/api', (req, res, next) => {
  if (snapshot.available || req.path === '/version') return next();
  return res.status(503).json({
    error: 'SNAPSHOT_UNAVAILABLE',
    message: 'This deployment carries no CRM snapshot. Only the Monthly Flash Review is available.',
  });
});

function moduleName(value) {
  const name = String(value || '');
  if (!snapshot.metadata.modules.modules.some(item => item.api_name === name)) {
    const error = new Error('Snapshot module is unavailable.');
    error.status = 404;
    throw error;
  }
  return name;
}

function dateValue(record, keys = ['Created_Time', 'Call_Start_Time']) {
  for (const key of keys) {
    const time = Date.parse(record?.[key] || '');
    if (Number.isFinite(time)) return time;
  }
  return 0;
}

function isInsideRange(record, query) {
  if (!query.from || !query.to) return true;
  const time = dateValue(record);
  const from = Date.parse(`${query.from}T00:00:00+05:30`);
  const to = Date.parse(`${query.to}T23:59:59.999+05:30`);
  return Number.isFinite(from) && Number.isFinite(to) && time >= from && time <= to;
}

function plainValue(value) {
  if (value && typeof value === 'object') return value.name || value.id || JSON.stringify(value);
  return value == null ? '' : value;
}

function list(module, query = {}) {
  if (!Object.prototype.hasOwnProperty.call(snapshot.records, module)) {
    return {
      availability: 'unresolved', reason_code: 'SNAPSHOT_MODULE_DATA_UNAVAILABLE',
      message: 'This module is preserved from the saved Zoho configuration. Its records were not included in the recovered offline cache.',
      data: [], info: { total: null, total_exact: false, more_records: false },
    };
  }
  const page = Math.max(1, Number.parseInt(query.page || '1', 10) || 1);
  const perPage = Math.min(200, Math.max(1, Number.parseInt(query.per_page || '50', 10) || 50));
  const word = String(query.word || query.q || '').trim().toLocaleLowerCase('en-IN').slice(0, 80);
  let rows = snapshot.records[module].filter(record => isInsideRange(record, query));
  if (word) rows = rows.filter(record => JSON.stringify(record).toLocaleLowerCase('en-IN').includes(word));
  const sortBy = String(query.sort_by || 'Modified_Time');
  const direction = String(query.sort_order || 'desc').toLowerCase() === 'asc' ? 1 : -1;
  rows = rows.slice().sort((left, right) => {
    const a = plainValue(left[sortBy]);
    const b = plainValue(right[sortBy]);
    return String(a).localeCompare(String(b), 'en-IN', { numeric: true }) * direction;
  });
  const start = (page - 1) * perPage;
  return {
    data: rows.slice(start, start + perPage),
    snapshot_origin: snapshot.manifest.module_origins?.[module] || null,
    info: { page, per_page: perPage, total: rows.length, total_exact: true, more_records: start + perPage < rows.length },
  };
}

function countBy(rows, key, valueKey = null) {
  const map = new Map();
  for (const row of rows) {
    const label = String(plainValue(row[key]) || '(none)');
    const current = map.get(label) || { raw_value: label === '(none)' ? null : label, count: 0, value_lacs: 0, value_count: 0, invalid_value_count: 0 };
    current.count += 1;
    if (valueKey) {
      const value = Number(row[valueKey]);
      if (Number.isFinite(value)) { current.value_lacs += value; current.value_count += 1; }
      else if (row[valueKey] != null && row[valueKey] !== '') current.invalid_value_count += 1;
    }
    map.set(label, current);
  }
  return [...map.values()];
}

function statusRows(rows, key, outputKey) {
  return countBy(rows, key).map(row => ({ [outputKey]: row.raw_value || '(none)', cnt: row.count }));
}

function formatDay(date) {
  return date.toISOString().slice(0, 10);
}

function dashboard(query) {
  const now = new Date();
  const today = formatDay(now);
  const month = today.slice(0, 7);
  const ranged = Boolean(query.from && query.to);
  const filtered = Object.fromEntries(Object.entries(snapshot.records).map(([name, rows]) => [name, rows.filter(row => isInsideRange(row, query))]));
  const leads = ranged ? filtered.Leads : snapshot.records.Leads;
  const contacts = ranged ? filtered.Contacts : snapshot.records.Contacts;
  const deals = ranged ? filtered.Deals : snapshot.records.Deals;
  const calls = ranged ? filtered.Calls : snapshot.records.Calls;
  const tasks = snapshot.records.Tasks;
  const isDone = value => ['completed', 'closed', 'deferred'].includes(String(value || '').toLowerCase());
  const openTasks = tasks.filter(row => !isDone(row.Status));
  const dueToday = openTasks.filter(row => row.Due_Date === today);
  const overdue = openTasks.filter(row => row.Due_Date && row.Due_Date < today);
  const trend = {};
  if (ranged) {
    for (const row of leads) {
      const key = String(row.Created_Time || '').slice(0, 10);
      if (key) trend[key] = (trend[key] || 0) + 1;
    }
  } else {
    for (let offset = 13; offset >= 0; offset -= 1) {
      const date = new Date(now); date.setDate(now.getDate() - offset); trend[formatDay(date)] = 0;
    }
    for (const row of snapshot.records.Leads) {
      const key = String(row.Created_Time || '').slice(0, 10);
      if (Object.prototype.hasOwnProperty.call(trend, key)) trend[key] += 1;
    }
  }
  const leadRows = countBy(leads, 'Lead_Status');
  const contactRows = countBy(contacts, 'Stage', 'Total_Opportunity_Value');
  const journey = buildJourneyDashboard({
    leadFields: snapshot.metadata.fields.Leads,
    contactFields: snapshot.metadata.fields.Contacts,
    leadRows,
    contactRows,
    snapshotAt: snapshot.manifest.source_snapshot_at,
    generatedAt: new Date().toISOString(),
    range: ranged ? { from: query.from, to: query.to } : null,
  });
  return {
    generated_at: new Date().toISOString(), today, ranged,
    range: ranged ? { from: query.from, to: query.to, daily: true } : null,
    kpis: {
      leadsToday: snapshot.records.Leads.filter(row => String(row.Created_Time || '').startsWith(today)).length,
      leadsMonth: snapshot.records.Leads.filter(row => String(row.Created_Time || '').startsWith(month)).length,
      totalLeads: snapshot.records.Leads.length, totalDeals: snapshot.records.Deals.length,
      callsToday: snapshot.records.Calls.filter(row => String(row.Call_Start_Time || row.Created_Time || '').startsWith(today)).length,
      callsWeek: snapshot.records.Calls.filter(row => dateValue(row) >= now.getTime() - 7 * 86400000).length,
      meetingsToday: 0, tasksOpen: openTasks.length, tasksDueToday: dueToday.length, tasksOverdue: overdue.length,
      rangeLeads: filtered.Leads.length, rangeContacts: filtered.Contacts.length,
      rangeDeals: filtered.Deals.length, rangeCalls: filtered.Calls.length, rangeMeetings: 0,
    },
    trend,
    leadsByStatus: statusRows(leads, 'Lead_Status', 'Lead_Status'),
    contactsByStatus: statusRows(contacts, 'Stage', 'Status'),
    dealsByStage: statusRows(deals, 'Stage', 'Stage'),
    leadsBySource: statusRows(ranged ? filtered.Leads : snapshot.records.Leads.filter(row => String(row.Created_Time || '').startsWith(month)), 'Lead_Source', 'Lead_Source'),
    tasksOpen: statusRows(openTasks, 'Status', 'Status'),
    recentLeads: snapshot.records.Leads.slice().sort((a, b) => dateValue(b) - dateValue(a)).slice(0, 10),
    recentDeals: snapshot.records.Deals.slice().sort((a, b) => dateValue(b, ['Modified_Time', 'Created_Time']) - dateValue(a, ['Modified_Time', 'Created_Time'])).slice(0, 10),
    taskList: [...overdue, ...dueToday].sort((a, b) => String(a.Due_Date).localeCompare(String(b.Due_Date))).slice(0, 50),
    journey,
  };
}

app.get('/api/version', (req, res) => res.json({ v: BUILD }));
app.get('/api/boot', (req, res) => res.json({
  modules: snapshot.metadata.modules,
  org: snapshot.metadata.org,
  sync_info: { at: snapshot.manifest.source_snapshot_at, delta_at: snapshot.manifest.source_snapshot_at, mode: 'snapshot-only' },
  version: BUILD,
  zoho: false,
  zoho_source_mode: 'disabled-snapshot-only',
  snapshot_only: true,
  metadata_version: `${snapshot.manifest.source_snapshot_at}:schema-${snapshot.manifest.schema_version || 1}`,
  module_availability: snapshot.manifest.module_availability || {},
  module_origins: snapshot.manifest.module_origins || {},
  sync_schedule: { enabled: false, running: false, source_mode: 'disabled-snapshot-only' },
  blueprint_modules: [],
}));

app.get('/api/module_bundle/:module', (req, res, next) => {
  try {
    const name = moduleName(req.params.module);
    const fields = snapshot.metadata.fields[name] || { fields: [] };
    const views = snapshot.metadata.views[name] || { custom_views: [] };
    const cvid = views.custom_views?.[0]?.id || null;
    const payload = { cvid, records: list(name, req.query), view_fallback: null };
    if (req.query.meta !== '0') Object.assign(payload, { fields, views });
    return res.json(payload);
  } catch (error) { return next(error); }
});

app.get('/api/records/:module', (req, res, next) => {
  try { return res.json(list(moduleName(req.params.module), req.query)); } catch (error) { return next(error); }
});

app.get('/api/search/:module', (req, res, next) => {
  try { return res.json(list(moduleName(req.params.module), { ...req.query, page: 1 }).data ? list(moduleName(req.params.module), { ...req.query, page: 1 }) : { data: [] }); } catch (error) { return next(error); }
});

app.get('/api/record/:module/:id', (req, res, next) => {
  try {
    const name = moduleName(req.params.module);
    if (!snapshot.indexes[name]) return res.status(409).json(list(name));
    const stored = snapshot.indexes[name].get(String(req.params.id));
    const record = stored ? { ...stored } : null;
    if (record) for (const field of snapshot.metadata.fields[name]?.fields || []) {
      const child = field.associated_module?.module;
      const parent = snapshot.metadata.fields[child]?.fields?.find(item => item.api_name === 'Parent_Id');
      if (field.data_type === 'subform' && snapshot.manifest.module_origins?.[child]
        && parent?.data_type === 'lookup' && parent.lookup?.module?.api_name === name
        && record[field.api_name] === undefined) {
        record[field.api_name] = snapshot.records[child].filter(row => row.Parent_Id?.id === record.id);
      }
    }
    return res.json({ data: record ? [record] : [], layout_resolution: null, source_mode: 'local-snapshot-read-only', snapshot_origin: snapshot.manifest.module_origins?.[name] || null });
  } catch (error) { return next(error); }
});

app.get('/api/meta/fields', (req, res) => res.json(snapshot.metadata.fields[String(req.query.module)] || { fields: [] }));
app.get('/api/meta/layouts', (req, res) => res.json(snapshot.metadata.layouts[String(req.query.module)] || { layouts: [] }));
app.get('/api/meta/views', (req, res) => res.json(snapshot.metadata.views[String(req.query.module)] || { custom_views: [] }));
app.get('/api/meta/captured_views', (req, res) => res.json(snapshot.metadata.captured_views?.[String(req.query.module)] || { custom_views: [] }));
app.get('/api/meta/view', (req, res) => res.json(snapshot.metadata.views[String(req.query.module)] || { custom_views: [] }));
app.get('/api/meta/related_lists', (req, res) => res.json(snapshot.metadata.related_lists[String(req.query.module)] || { related_lists: [] }));
app.get('/api/meta/org', (req, res) => res.json(snapshot.metadata.org));
app.get('/api/meta/sync_info', (req, res) => res.json({ at: snapshot.manifest.source_snapshot_at, mode: 'snapshot-only', enabled: false }));
app.get('/api/meta/custom_buttons', (req, res) => res.json({ buttons: [] }));
app.get('/api/meta/data_completeness', (req, res) => res.json({
  source_mode: 'local-cache-read-only',
  attachments: { source_id_count: 0, current_local_linked_record_count: 0, current_absent_source_id_count: 0 },
  related_lists: { source_definition_count: 0, local_definition_count: 0, source_parent_module_count: 0, local_parent_module_count: 0, queryable_definition_count: 0, unresolved_definition_count: 0 },
}));
app.get('/api/meta/replication_health', (req, res) => res.json({
  generated_at: new Date().toISOString(), overall_classification: 'snapshot_only',
  coverage: { modules: snapshot.manifest.record_counts, source_mode: 'local-cache-read-only' },
  schedule: { enabled: false, message: 'External CRM synchronization is paused.' },
  reconciliation: [], exclusions: { reason: 'Snapshot-only mode' }, deletion_replication: { enabled: false },
}));

app.get('/api/dashboard', (req, res) => res.json(dashboard(req.query)));
app.get('/api/dashboard/journey/records/:lane', (req, res, next) => {
  try {
    const definition = LANE_DEFINITIONS[String(req.params.lane)];
    if (!definition) { const error = new Error('Unknown journey lane.'); error.status = 404; throw error; }
    const values = Array.isArray(req.query.value) ? req.query.value.map(String) : req.query.value ? [String(req.query.value)] : [];
    let rows = snapshot.records[definition.module].filter(row => isInsideRange(row, req.query));
    rows = rows.filter(row => req.query.missing === '1' ? !plainValue(row[definition.field]) : values.includes(String(plainValue(row[definition.field]))));
    const page = Math.max(1, Number.parseInt(req.query.page || '1', 10) || 1);
    const perPage = Math.min(100, Math.max(1, Number.parseInt(req.query.per_page || '50', 10) || 50));
    const start = (page - 1) * perPage;
    const data = rows.slice(start, start + perPage).map(record => ({
      id: record.id,
      record_name: record.Full_Name || record.Deal_Name || record.Subject || '(unnamed record)',
      source_value: plainValue(record[definition.field]) || null,
      owner: plainValue(record.Owner) || null,
      created_time: record.Created_Time || null,
      modified_time: record.Modified_Time || null,
      value_lacs: definition.valueField ? Number(record[definition.valueField] || 0) : null,
    }));
    return res.json({ source_mode: 'local-snapshot-read-only', range: req.query.from && req.query.to ? { from: req.query.from, to: req.query.to } : null, data, info: { page, per_page: perPage, total: rows.length, more_records: start + perPage < rows.length } });
  } catch (error) { return next(error); }
});

app.get('/api/notes/:module/:id', (req, res) => res.json({ data: [], pagination: { page: 1, per_page: 0, returned: 0, has_more: false }, source_mode: 'snapshot-only' }));
app.get('/api/timeline/:module/:id', (req, res) => res.json({ events: [], source_mode: 'snapshot-only' }));
app.get('/api/related/:module/:id/:related', (req, res) => {
  const { module: parent, id, related } = req.params;
  const definition = snapshot.metadata.related_lists[parent]?.related_lists?.find(item => item.api_name === related);
  const target = definition?.module?.api_name;
  // Enable only newly recovered historical datasets with an exact source lookup
  // path. Existing dashboard-derived caches do not prove relationship coverage.
  const origin = snapshot.manifest.module_origins?.[target];
  const resolution = resolveRelatedListLinkFields({ parentModule: parent, relatedList: definition, fields: snapshot.metadata.fields[target]?.fields });
  if (!origin || !snapshot.indexes[parent]?.has(String(id)) || !resolution.available) {
    return res.json({ availability: 'unresolved', reason_code: 'SNAPSHOT_ONLY_RELATED_DATA_UNAVAILABLE', message: 'This related list has no verified relationship path and available parent in the recovered snapshot.', data: [] });
  }
  const rows = snapshot.records[target].filter(row => resolution.link_fields.some(field => row[field]?.id === String(id)));
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const perPage = Math.min(200, Math.max(1, parseInt(req.query.per_page, 10) || 100));
  const data = rows.slice((page - 1) * perPage, page * perPage);
  return res.json({ availability: 'queryable', related_module: target, data, snapshot_origin: origin,
    source_mode: 'historical-export', link_fields: resolution.link_fields,
    pagination: { page, per_page: perPage, returned: data.length, total: rows.length, has_more: page * perPage < rows.length } });
});
app.get('/api/blueprint/:module/:id', (req, res) => res.json({ available: false, reason_code: 'SNAPSHOT_READ_ONLY' }));
app.get('/api/integrations/status', (req, res) => res.json({ enabled: false, source_mode: 'snapshot-only', message: 'Calling and messaging integrations are paused.' }));
app.get('/api/agent/status', (req, res) => res.json({ enabled: false, deterministic_available: false, reason_code: 'SNAPSHOT_ONLY' }));

app.use(express.static(path.join(__dirname, 'public'), { setHeaders: res => res.setHeader('Cache-Control', 'no-cache, must-revalidate') }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  return res.status(error.status || 500).json({ error: error.status === 404 ? 'NOT_FOUND' : 'SNAPSHOT_REQUEST_FAILED', message: error.status === 404 ? error.message : 'The local snapshot request could not be completed.' });
});

module.exports = app;
if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`MAGPPIE CRM (snapshot app; read-only MIS pipeline enabled) → http://${HOST}:${PORT}`);
    if (!snapshot.available) console.log(`No CRM snapshot at ${SNAPSHOT_DIR} · Monthly Flash Review only`);
    else console.log(`Local snapshot: ${snapshot.manifest.source_snapshot_at} · ${Object.values(snapshot.manifest.record_counts).reduce((sum, count) => sum + count, 0).toLocaleString('en-IN')} records`);
  });
}
