/* MAGPPIE CRM — standalone CRM with connected and local-snapshot modes. */
const $ = s => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const state = {
  modules: [],            // visible tab modules in order
  moduleByApi: {},
  fields: {},             // module -> fields[]
  layouts: {},            // module -> layouts[]
  views: {},              // module -> custom views[]
  viewDetail: {},         // "module:id" -> view
  relLists: {},           // module -> related lists
  customButtons: {},      // module -> custom button metadata
  current: null,          // current module api_name
  page: 1, cvid: null, sort: null, sortOrder: 'desc',
  mode: 'list',           // list | kanban
  nav: 0,                 // navigation sequence — stale async renders abort
  journeyShowAll: { leads: false, opportunities: false },
  analyticsFilter: { key: '30d', from: null, to: null },
  bootReady: false,
  bootError: null,
  snapshotOnly: false,
};

const api = async (path, opts) => {
  const r = await fetch(path, opts);
  if (!r.ok) { const t = await r.text(); throw new Error(`${r.status}: ${t.slice(0, 300)}`); }
  return r.json();
};

/* stale-while-revalidate caches: paint instantly from memory, refresh in background */
const swr = { bundle: new Map(), record: new Map() };

/* module metadata (fields/views/layouts) persisted per snapshot — skips ~470KB per module load */
function loadMetaFromStore(mod) {
  if ((state.fields[mod] || []).length) return true;
  try {
    const st = JSON.parse(localStorage.getItem('crm_meta_' + mod) || 'null');
    if (st && st.at === state.syncAt && Array.isArray(st.fields) && st.fields.length) {
      state.fields[mod] = st.fields;
      state.views[mod] = st.views || [];
      if (st.layouts) state.layouts[mod] = st.layouts;
      return true;
    }
  } catch (e) {}
  return false;
}
function persistMeta(mod) {
  try {
    localStorage.setItem('crm_meta_' + mod, JSON.stringify({
      at: state.syncAt, fields: state.fields[mod] || [], views: state.views[mod] || [], layouts: state.layouts[mod] || null,
    }));
  } catch (e) {
    // quota — clear stored metas and skip
    try { Object.keys(localStorage).filter(k => k.startsWith('crm_meta_')).forEach(k => localStorage.removeItem(k)); } catch (e2) {}
  }
}
function prefetchModule(m) {
  const haveMeta = loadMetaFromStore(m);
  const url = `/api/module_bundle/${m}?page=1&per_page=50` + (haveMeta ? '&meta=0' : '');
  if (!swr.bundle.has(url)) {
    api(url).then(b => {
      swr.bundle.set(url, b);
      if (b.fields?.fields) state.fields[m] = b.fields.fields;
      if (b.views?.custom_views) state.views[m] = b.views.custom_views;
      (b.records?.data || []).forEach(r => swr.record.set(m + '|' + r.id, r));
      if (b.fields?.fields) persistMeta(m);
    }).catch(() => {});
  }
  if (!(state.layouts[m] || []).length) api('/api/meta/layouts?module=' + m).then(l => { state.layouts[m] = l?.layouts || []; persistMeta(m); }).catch(() => {});
}

const SKIP_TAB_TYPES = ['Fileupload', 'Imageupload'];
const isDataModule = m => m.show_as_tab && m.api_supported &&
  !SKIP_TAB_TYPES.some(p => (m.module_name || '').startsWith(p)) &&
  !['linking', 'field_tracker', 'subform'].includes(m.generated_type) &&
  !['Approvals', 'Actions_Performed'].includes(m.api_name);

/* ---------- formatting ---------- */
const inr = n => '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
function fmtVal(v, field) {
  if (v === null || v === undefined || v === '') return '—';
  const dt = field?.data_type;
  if (dt === 'currency') return inr(v);
  if (dt === 'boolean' || typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (dt === 'datetime' || /^\d{4}-\d{2}-\d{2}T/.test(String(v)))
    return new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  if (dt === 'date' || /^\d{4}-\d{2}-\d{2}$/.test(String(v)))
    return new Date(v + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  if (Array.isArray(v)) return v.map(x => (x && typeof x === 'object') ? (x.name || x.Name || '') : x).join(', ') || '—';
  if (typeof v === 'object') return v.name || v.Name || v.display_value || '—';
  return String(v);
}

const CALL_RECORDING_FIELD = 'Voice_Recording__s';
const CALL_RECORDING_HOST = 'phonebridge.zoho.in';
const CALL_RECORDING_PATH = '/phonebridge/recording';

function validatedCallRecordingUrl(value) {
  if (typeof value !== 'string' || !value || value.length > 4096 || value !== value.trim() || /[\u0000-\u0020\u007f]/.test(value)) return null;
  let parsed;
  try { parsed = new URL(value); } catch (e) { return null; }
  if (parsed.protocol !== 'https:'
    || parsed.hostname !== CALL_RECORDING_HOST
    || parsed.port
    || parsed.username
    || parsed.password
    || parsed.hash
    || (parsed.pathname !== CALL_RECORDING_PATH && !parsed.pathname.startsWith(CALL_RECORDING_PATH + '/'))) return null;
  return parsed.href;
}

const isCallRecordingField = (mod, fname) => mod === 'Calls' && fname === CALL_RECORDING_FIELD;
const callRecordingLabel = value => validatedCallRecordingUrl(value) ? 'Recording available' : 'Recording unavailable';

function safeCallRecordingLink(url, label = 'Open recording') {
  const link = el('a', 'call-recording-open');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.referrerPolicy = 'no-referrer';
  link.textContent = label;
  link.setAttribute('aria-label', `${label} in a new tab`);
  return link;
}

function callRecordingControl(value, { compact = false } = {}) {
  const wrap = el('div', compact ? 'call-recording call-recording-compact' : 'call-recording');
  const url = validatedCallRecordingUrl(value);
  if (!url) {
    const unavailable = el('span', 'call-recording-unavailable');
    unavailable.textContent = 'Recording unavailable';
    unavailable.setAttribute('role', 'status');
    unavailable.setAttribute('aria-label', 'Call recording unavailable');
    wrap.appendChild(unavailable);
    return wrap;
  }
  if (compact) {
    wrap.appendChild(safeCallRecordingLink(url, 'Open recording'));
    return wrap;
  }

  const audio = el('audio', 'call-recording-audio');
  audio.controls = true;
  audio.preload = 'metadata';
  audio.src = url;
  audio.setAttribute('aria-label', 'Call recording playback');
  const meta = el('div', 'call-recording-meta');
  const status = el('span', 'call-recording-status');
  status.textContent = 'Zoho PhoneBridge recording';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  audio.addEventListener('error', () => {
    status.textContent = 'Playback unavailable here; use the open-recording control.';
    status.classList.add('call-recording-error');
  });
  meta.append(status, safeCallRecordingLink(url, 'Open recording'));
  wrap.append(audio, meta);
  return wrap;
}

const lookupId = v => (v && typeof v === 'object' && v.id) ? v.id : null;
const hueOf = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

/* ---------- date filter ---------- */
state.dateFilter = { key: 'all', from: null, to: null };
const istNowD = () => new Date(Date.now() + 5.5 * 3600 * 1000);
const fmtD = d => d.toISOString().slice(0, 10);
function rangeFor(key) {
  const n = istNowD();
  const dayAgo = off => new Date(n.getTime() - off * 86400000);
  const dow = (n.getUTCDay() + 6) % 7; // Monday = 0
  switch (key) {
    case 'today': return [fmtD(n), fmtD(n)];
    case 'this_week': return [fmtD(dayAgo(dow)), fmtD(n)];
    case 'last_week': return [fmtD(dayAgo(dow + 7)), fmtD(dayAgo(dow + 1))];
    case 'this_month': return [fmtD(n).slice(0, 8) + '01', fmtD(n)];
    case 'last_month': {
      const y = n.getUTCFullYear(), m = n.getUTCMonth();
      return [fmtD(new Date(Date.UTC(y, m - 1, 1))), fmtD(new Date(Date.UTC(y, m, 0)))];
    }
    default: return [null, null];
  }
}
function dateParams() {
  const { from, to } = state.dateFilter;
  return from && to ? `&from=${from}&to=${to}` : '';
}
function mkDateFilter(onChange) {
  const wrap = el('div', 'dfilter');
  const sel = el('select');
  [['all', 'All Time'], ['today', 'Today'], ['this_week', 'This Week'], ['last_week', 'Last Week'],
   ['this_month', 'This Month'], ['last_month', 'Last Month'], ['custom', 'Custom Range…']].forEach(([v, t]) => {
    const o = el('option'); o.value = v; o.textContent = '📅 ' + t;
    if (state.dateFilter.key === v) o.selected = true;
    sel.appendChild(o);
  });
  const custom = el('span', 'dcustom' + (state.dateFilter.key === 'custom' ? '' : ' hidden'));
  const i1 = el('input'); i1.type = 'date'; i1.value = state.dateFilter.from || '';
  const i2 = el('input'); i2.type = 'date'; i2.value = state.dateFilter.to || '';
  const go = el('button', 'btn-primary', 'Apply');
  go.onclick = () => {
    if (!i1.value || !i2.value) { toast('Pick both dates'); return; }
    let [a, b] = [i1.value, i2.value];
    if (a > b) [a, b] = [b, a];
    state.dateFilter = { key: 'custom', from: a, to: b };
    onChange();
  };
  custom.append(i1, el('span', 'dto', '→'), i2, go);
  sel.onchange = () => {
    if (sel.value === 'custom') { custom.classList.remove('hidden'); return; }
    custom.classList.add('hidden');
    const [from, to] = rangeFor(sel.value);
    state.dateFilter = { key: sel.value, from, to };
    onChange();
  };
  wrap.append(sel, custom);
  return wrap;
}
const pillHtml = v => { const h = hueOf(v); return `<span class="pill" style="background:hsl(${h} 85% 93%);color:hsl(${h} 60% 30%)">${esc(v)}</span>`; };

/* ---------- boot ---------- */
let bootInFlight = false;

function isLocalFirstRoute() {
  return (location.hash || '#/flash-review').startsWith('#/flash-review');
}

function renderBootFailure() {
  const container = $('#content');
  container.innerHTML = '';
  const card = el('section', 'boot-error');
  card.setAttribute('role', 'alert');
  card.append(
    el('div', 'boot-error-mark', '!'),
    el('h1', null, 'CRM data is temporarily unavailable'),
    el('p', null, 'The secure data connection did not complete. No CRM records were changed.'),
  );
  const retry = el('button', 'btn-primary', 'Retry connection');
  retry.type = 'button';
  retry.onclick = async () => {
    retry.disabled = true;
    retry.textContent = 'Retrying…';
    await boot();
  };
  card.append(retry);
  container.append(card);
}

async function boot() {
  if (bootInFlight) return;
  bootInFlight = true;
  // Local-first modules must remain usable even when the CRM metadata source is
  // temporarily unavailable. Paint the stable navigation and requested local
  // route before starting the remote boot request.
  renderTabs();
  if (isLocalFirstRoute()) route();
  try {
    const b = await api('/api/boot');
    state.modules = (b.modules?.modules || []).filter(isDataModule).sort((x, y) => x.sequence_number - y.sequence_number);
    (b.modules?.modules || []).forEach(m => state.moduleByApi[m.api_name] = m);
    state.moduleOrigins = b.module_origins || {};
    state.bootReady = true;
    state.bootError = null;
    assistantOnBootStateChanged();
    const o = (b.org?.org || [])[0];
    if (o) $('#orgName').textContent = 'MAGPPIE SILVERSTONE · ' + (o.primary_email || '');
    state.syncAt = b.metadata_version || b.sync_info?.at || 'unknown';
    state.zoho = !!b.zoho;
    state.zohoSourceMode = b.zoho_source_mode || 'read-only';
    state.snapshotOnly = b.snapshot_only === true;
    state.blueprintByModule = Object.fromEntries((b.blueprint_modules || []).map(blueprint => [blueprint.module, blueprint]));
    const lastDelta = b.sync_info?.delta_at || b.sync_info?.at;
    if (lastDelta) $('#orgName').textContent += ' · synced ' + new Date(lastDelta).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    if (state.zoho) $('#orgName').textContent += ' · Zoho source: read-only';
    if (state.snapshotOnly) {
      $('#orgName').textContent += ' · local snapshot · sync paused';
      $('#refreshMeta').disabled = true;
      $('#refreshMeta').title = 'External metadata refresh is paused in snapshot-only mode.';
    }
    renderTabs();
    route();
    // warm the caches for the most-used modules so first clicks are instant
    setTimeout(() => {
      ['Leads', 'Contacts', 'Deals', 'Tasks', 'Calls'].forEach((m, i) => setTimeout(() => prefetchModule(m), i * 400));
    }, 1200);
  } catch (e) {
    state.bootReady = false;
    state.bootError = 'CRM module metadata could not be loaded.';
    assistantOnBootStateChanged();
    renderTabs();
    if (isLocalFirstRoute()) route();
    else renderBootFailure();
  } finally {
    bootInFlight = false;
  }
}

function renderTabs() {
  const t = $('#tabs'); t.innerHTML = '';
  const flashReview = el('button', 'tab', 'Monthly Flash Review');
  flashReview.dataset.mod = '__flash_review';
  flashReview.onclick = () => { location.hash = '#/flash-review'; };
  t.appendChild(flashReview);
}

function setActiveTab(mod) {
  document.querySelectorAll('#tabs .tab').forEach(d => {
    const active = d.dataset.mod === mod;
    d.classList.toggle('active', active);
    if (active) d.setAttribute('aria-current', 'page');
    else d.removeAttribute('aria-current');
  });
  const active = document.querySelector('#tabs .tab.active');
  if (active) active.scrollIntoView({ inline: 'nearest', block: 'nearest' });
}

function route() {
  const h = location.hash || '#/flash-review';
  const parts = h.slice(2).split('/');
  if (parts[0] === 'home' || !parts[0]) { renderDashboard(); }
  else if (parts[0] === 'flash-review') { renderFlashReview(); }
  else if (parts[0] === 'analytics') { renderAnalytics(); }
  else if (parts[0] === 'blueprints') { renderBlueprintStudio(); }
  else if (parts[0] === 'workflows') { renderWorkflowStudio(); }
  else if (parts[0] === 'automation') { renderAutomation(); }
  else if (parts[0] === 'module' && parts[1]) { openModule(parts[1]); }
  else if (parts[0] === 'record' && parts[1] && parts[2]) { openRecord(parts[1], parts[2]); }
  else renderDashboard();
}

function renderFlashReview() {
  ++state.nav;
  state.current = null;
  setActiveTab('__flash_review');
  const container = $('#content');
  if (!window.MagppieFlashReview || typeof window.MagppieFlashReview.render !== 'function') {
    container.innerHTML = '<div class="loading">Monthly Flash Review is unavailable.</div>';
    return;
  }
  window.MagppieFlashReview.render(container, { toast });
}

/* ---------- automation viewer (workflows, Blueprints, webhooks, functions, buttons/widgets) ---------- */
function workflowActions(rule) {
  const actions = [];
  (rule.conditions || []).forEach(condition => {
    (condition.instant_actions?.actions || []).forEach(action => actions.push({ ...action, timing: 'Instant' }));
    (condition.scheduled_actions || []).forEach(schedule => {
      const delay = schedule.execute_after ? `${schedule.execute_after.unit} ${schedule.execute_after.period}` : 'source-defined delay';
      (schedule.actions || []).forEach(action => actions.push({ ...action, timing: `Scheduled: ${delay}` }));
    });
  });
  return actions;
}

function workflowCriterionText(criteria) {
  if (!criteria) return '';
  if (Array.isArray(criteria.group)) return criteria.group.map(workflowCriterionText).filter(Boolean).join(` ${String(criteria.group_operator || 'AND').toUpperCase()} `);
  const field = criteria.field?.api_name || criteria.field?.name || 'field';
  const value = Array.isArray(criteria.value) ? criteria.value.join(', ') : (criteria.value && typeof criteria.value === 'object' ? (criteria.value.name || criteria.value.display_value || criteria.value.id || '') : criteria.value);
  return `${field} ${criteria.comparator || 'matches'} ${value ?? ''}`.trim();
}

function automationActionDetail(action, catalogs, functionBehaviorByWorkflowAction) {
  const id = String(action.id || '');
  if (action.type === 'field_updates') {
    const item = catalogs.fieldUpdates.get(id);
    if (item) return `${item.field?.api_name || 'field'} = ${fmtVal(item.display_value ?? item.value)} · local execution blocked`;
    return 'Referenced field-update definition was not returned by Zoho · local execution blocked';
  }
  if (action.type === 'tasks') {
    const item = catalogs.tasks.get(id);
    if (item) {
      const mappings = (item.field_mappings || []).map(mapping => `${mapping.field?.api_name || 'field'}: ${fmtVal(mapping.display_value ?? mapping.value)}`);
      return `${mappings.join('; ') || 'Task mapping captured'} · local execution blocked`;
    }
    return 'Referenced task definition was not returned by Zoho · local execution blocked';
  }
  if (action.type === 'email_notifications') {
    const item = catalogs.emailNotifications.get(id);
    if (item) return `Template: ${item.template?.name || 'configured'} · recipients: ${item.recipient_count ?? 'source-configured'} · sending blocked`;
    return 'Referenced email-notification definition was not returned by Zoho · sending blocked';
  }
  if (action.type === 'assign_owner') {
    const names = (action.details?.assign_to || []).map(assignment => assignment.resource?.name).filter(Boolean);
    return `${names.length ? `Assign to ${names.join(', ')}` : 'Source assignment captured'} · local execution blocked`;
  }
  if (action.type === 'functions') {
    const mapped = functionBehaviorByWorkflowAction.get(id);
    return mapped
      ? `${mapped.display_name}: ${mapped.behavior} · local execution blocked`
      : 'Function association captured · source-backed behavior mapping unavailable · local execution blocked';
  }
  if (action.type === 'webhooks') return 'Webhook association captured · outbound delivery blocked';
  return 'Source action association captured · local execution blocked';
}

function buildDataCompletenessCard(dataCompleteness, error = null) {
  const card = el('div', 'card');
  card.appendChild(el('h2', null, 'Data Completeness — Notes, Tasks, Child Data, Attachments & Related Lists'));
  if (!dataCompleteness) {
    card.appendChild(el('div', error ? 'formcallout warning' : 'loading', error
      ? `Completeness inventory unavailable: ${esc(error.message || error)}`
      : 'Loading current completeness checks…'));
    return card;
  }

  const noteCoverage = dataCompleteness.notes || {};
  const attachmentCoverage = dataCompleteness.attachments || {};
  const relatedCoverage = dataCompleteness.related_lists || {};
  const taskSubformCoverage = dataCompleteness.task_subforms || {};
  const taskCoverage = (taskSubformCoverage.datasets || []).find(dataset => dataset.module === 'Tasks') || {};
  const childCoverage = (taskSubformCoverage.datasets || []).filter(dataset => dataset.module !== 'Tasks');
  const childCurrent = childCoverage.reduce((total, dataset) => total + Number(dataset.current_local_source_id_count || 0), 0);
  const childSource = childCoverage.reduce((total, dataset) => total + Number(dataset.source_active_ids || 0), 0);
  const childCountParity = childCoverage.length > 0 && childCoverage.every(dataset => dataset.current_count_parity === true);
  const childExactAvailable = childCoverage.length > 0 && childCoverage.every(dataset => typeof dataset.active_id_parity === 'boolean');
  const childExactParity = childExactAvailable && childCoverage.every(dataset => dataset.active_id_parity === true);
  const childDrift = childCoverage.some(dataset => dataset.current_count_parity === false || dataset.active_id_parity === false);
  const childStatus = childDrift
    ? 'drift detected'
    : childExactParity
    ? 'exact active-ID parity'
    : childCountParity
      ? 'count parity; exact IDs not reverified'
      : 'parity unavailable';
  const currentAttachmentCount = Number(attachmentCoverage.current_local_linked_record_count ?? attachmentCoverage.local_linked_record_count ?? 0);
  const currentAttachmentGap = Number(attachmentCoverage.current_absent_source_id_count ?? attachmentCoverage.absent_local_id_count ?? 0);
  const grid = el('div', 'function-coverage-grid');
  [
    ['Active Note IDs', `${Number(noteCoverage.current_local_source_derived_id_count || 0).toLocaleString('en-IN')}/${Number(noteCoverage.source_active_id_count || 0).toLocaleString('en-IN')} · ${noteCoverage.status || 'Unknown'}`],
    ['Active Task IDs', `${Number(taskCoverage.current_local_source_id_count || 0).toLocaleString('en-IN')}/${Number(taskCoverage.source_active_ids || 0).toLocaleString('en-IN')} · ${taskCoverage.status || 'Unknown'}`],
    ['Child active IDs', `${childCurrent.toLocaleString('en-IN')}/${childSource.toLocaleString('en-IN')} · ${childStatus}`],
    ['Child count-only gap', `${Number(taskSubformCoverage.summary?.blocked_count_only_unavailable_total || 0).toLocaleString('en-IN')} rows blocked`],
    ['Attachment metadata', `${currentAttachmentCount.toLocaleString('en-IN')}/${Number(attachmentCoverage.source_id_count || 0).toLocaleString('en-IN')} linked locally`],
    ['Attachment gap', `${currentAttachmentGap.toLocaleString('en-IN')} IDs · ${Number(attachmentCoverage.source_declared_bytes || 0).toLocaleString('en-IN')} declared bytes`],
    ['Related definitions', `${Number(relatedCoverage.local_definition_count || 0).toLocaleString('en-IN')}/${Number(relatedCoverage.source_definition_count || 0).toLocaleString('en-IN')}`],
    ['Parent modules', `${Number(relatedCoverage.local_parent_module_count || 0).toLocaleString('en-IN')}/${Number(relatedCoverage.source_parent_module_count || 0).toLocaleString('en-IN')}`],
    ['Generic Related UI', `${Number(relatedCoverage.queryable_definition_count || 0).toLocaleString('en-IN')} queryable · ${Number(relatedCoverage.unresolved_definition_count || 0).toLocaleString('en-IN')} unresolved`],
  ].forEach(([label, value]) => grid.appendChild(el('div', 'function-coverage-stat', `<span>${esc(label)}</span><b>${esc(value)}</b>`)));
  card.appendChild(grid);

  const taskClaim = taskCoverage.active_id_parity === false || taskCoverage.current_count_parity === false
    ? 'Task drift is detected.'
    : taskCoverage.active_id_parity === true
    ? 'Tasks match the private audited active-ID digest.'
    : taskCoverage.current_count_parity === true
      ? 'Task counts match, but the current exact ID set was not reverified.'
      : 'Current Task parity is unavailable.';
  const childClaim = childDrift
    ? 'Child-record drift is detected.'
    : childExactParity
    ? 'Enumerable child IDs match their private audited digests.'
    : childCountParity
      ? 'Child counts match, but one or more current exact ID sets were not reverified.'
      : 'Current child-record parity is unavailable.';
  const noteClaim = noteCoverage.current_exact_id_parity === false || noteCoverage.current_count_parity === false
    ? 'Note drift is detected.'
    : noteCoverage.current_exact_id_parity === true
    ? 'Notes have current exact ID parity.'
    : noteCoverage.current_count_parity === true
      ? 'Note counts match the exact audited snapshot, but the current exact ID set was not reverified.'
      : 'Current Note parity is unavailable.';
  card.appendChild(el('div', 'formcallout warning function-behavior-warning', `${esc(noteClaim)} ${esc(taskClaim)} ${esc(childClaim)} Zoho exposes ${esc(Number(taskSubformCoverage.summary?.blocked_count_only_unavailable_total || 0).toLocaleString('en-IN'))} additional child rows only as aggregate counts, without IDs or payloads, so they remain blocked instead of being fabricated. Attachment bodies were not downloaded and storage-bucket enumeration was not performed. Unresolved related-list structures are reported as unavailable, never as verified-empty results.`));
  return card;
}

/* Integration readiness card start */
function integrationStatusNode(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function buildIntegrationReadinessCard(statusResult) {
  const card = integrationStatusNode('section', 'integration-readiness-card');
  card.setAttribute('aria-labelledby', 'integrationReadinessTitle');
  const heading = integrationStatusNode('div', 'integration-readiness-heading');
  const headingCopy = integrationStatusNode('div');
  const title = integrationStatusNode('h2', null, 'Integration Readiness');
  title.id = 'integrationReadinessTitle';
  headingCopy.append(title, integrationStatusNode('p', null, 'Credential-safe configuration status only. No dial or message controls are exposed here.'));
  heading.append(headingCopy, integrationStatusNode('span', 'integration-readiness-overall', 'Not live'));
  card.appendChild(heading);

  const payload = statusResult?.ok === true && statusResult.data?.ok === true ? statusResult.data.integrations : null;
  if (!payload || typeof payload !== 'object') {
    const unavailable = integrationStatusNode('div', 'integration-readiness-unavailable');
    unavailable.setAttribute('role', 'status');
    unavailable.append(
      integrationStatusNode('strong', null, 'Integration status unavailable'),
      integrationStatusNode('span', null, 'The CRM could not verify local integration readiness. Outbound activity remains unavailable.'),
    );
    card.appendChild(unavailable);
    return card;
  }

  const definitions = [
    {
      key: 'ozonetel',
      name: 'Ozonetel',
      initials: 'OZ',
      outboundKey: 'outbound_calls_enabled',
      outboundLabel: 'Outbound calls',
      configuration: [
        ['api_key_configured', 'API key'],
        ['username_configured', 'Username'],
        ['reporting_timezone_offset_configured', 'Reporting timezone offset'],
        ['webhook_secret_configured', 'Webhook secret'],
      ],
    },
    {
      key: 'picky_assist',
      name: 'Picky Assist',
      initials: 'PA',
      outboundKey: 'outbound_messages_enabled',
      outboundLabel: 'Outbound messages',
      configuration: [
        ['api_token_configured', 'API token'],
        ['application_configured', 'Application'],
        ['project_id_configured', 'Project ID'],
        ['webhook_secret_configured', 'Webhook secret'],
      ],
    },
  ];
  const grid = integrationStatusNode('div', 'integration-readiness-grid');
  definitions.forEach(definition => {
    const source = payload[definition.key];
    const provider = integrationStatusNode('article', 'integration-provider-card');
    if (!source || typeof source !== 'object' || source.source_mode !== 'read-only-by-default') {
      provider.classList.add('is-unavailable');
      provider.append(
        integrationStatusNode('h3', null, definition.name),
        integrationStatusNode('p', 'integration-provider-error', 'Status unavailable · outbound remains unavailable.'),
      );
      grid.appendChild(provider);
      return;
    }

    const configured = definition.configuration.filter(([key]) => source[key] === true);
    const missing = definition.configuration.filter(([key]) => source[key] !== true).map(([, label]) => label);
    const outboundEnabled = source[definition.outboundKey] === true;
    const providerHead = integrationStatusNode('div', 'integration-provider-head');
    const identity = integrationStatusNode('div', 'integration-provider-identity');
    identity.append(
      integrationStatusNode('span', 'integration-provider-mark', definition.initials),
      integrationStatusNode('div'),
    );
    identity.lastElementChild.append(
      integrationStatusNode('h3', null, definition.name),
      integrationStatusNode('p', null, 'Read only by default'),
    );
    const stateBadge = integrationStatusNode('span', `integration-provider-state ${outboundEnabled ? 'is-enabled' : 'is-disabled'}`, outboundEnabled ? 'Enabled · confirmation required' : 'Disabled · not live');
    providerHead.append(identity, stateBadge);
    provider.appendChild(providerHead);

    const metrics = integrationStatusNode('div', 'integration-provider-metrics');
    [
      ['Configuration', `${configured.length}/${definition.configuration.length} configured`],
      ['Source mode', 'Read only'],
      [definition.outboundLabel, outboundEnabled ? 'Enabled' : 'Disabled'],
    ].forEach(([label, value]) => {
      const metric = integrationStatusNode('div');
      metric.append(integrationStatusNode('strong', null, label), integrationStatusNode('span', null, value));
      metrics.appendChild(metric);
    });
    provider.appendChild(metrics);

    const configurationLine = integrationStatusNode('p', 'integration-provider-missing');
    configurationLine.append(
      integrationStatusNode('strong', null, missing.length ? 'Still required' : 'Configuration'),
      integrationStatusNode('span', null, missing.length ? missing.join(' · ') : 'All reviewed settings are configured'),
    );
    provider.appendChild(configurationLine);

    const next = integrationStatusNode('p', 'integration-provider-next');
    next.append(
      integrationStatusNode('strong', null, 'Next step'),
      integrationStatusNode('span', null, missing.length
        ? `Configure ${missing.join(', ')} in the server environment; outbound remains disabled.`
        : outboundEnabled
          ? `Keep explicit per-${definition.key === 'ozonetel' ? 'dial' : 'message'} confirmation in place.`
          : 'Obtain explicit live-activation approval before enabling outbound activity.'),
    );
    provider.appendChild(next);
    grid.appendChild(provider);
  });
  card.appendChild(grid);
  card.appendChild(integrationStatusNode('p', 'integration-readiness-foot', 'Status is read from the local integration safety layer. This card cannot send a message, start a call, or change configuration.'));
  return card;
}
/* Integration readiness card end */

async function renderAutomation() {
  const nav = ++state.nav;
  state.current = null;
  setActiveTab('__automation');
  const c = $('#content');
  c.innerHTML = '<div class="loading">Loading automation configuration…</div>';
  try {
    const inventoryRequests = [
      ['Automation metadata', '/api/meta/automation', {}],
      ['Custom buttons', '/api/meta/custom_buttons', { buttons: [] }],
      ['Blueprint catalog', '/api/meta/blueprint_catalog', { blueprints: [] }],
      ['Function-code coverage', '/api/meta/function_code_coverage', { functions: [] }],
      ['Function behavior', '/api/meta/function_behavior_coverage', { functions: [], coverage: {}, affected: {}, execution: {} }],
      ['Widget behavior', '/api/meta/widget_behavior_coverage', { widgets: [], reconciliation: {}, execution_boundary: {}, type_summary: {} }],
      ['Widget runtime compatibility', '/api/meta/widget_runtime_compatibility', { widgets: [], summary: {}, archive_set: {}, execution_boundary: {} }],
      ['Report/dashboard coverage', '/api/meta/report_dashboard_coverage', { coverage: {}, execution_boundary: {} }],
      ['Permission coverage', '/api/meta/permission_coverage', { roles: [], profiles: [], source_coverage: {}, field_permission_model: {}, source_user_aggregates: {}, local_authorization: {}, identity_provider_decision: {}, enforcement_boundary: {} }],
      ['Rule/layout coverage', '/api/meta/rule_layout_coverage', { source_coverage: {}, local_enforcement: {}, enforcement_boundary: {} }],
      ['Metadata parity', '/api/meta/metadata_parity', { areas: {}, parity_status: 'Unavailable' }],
      ['Source setup-process evidence', '/api/meta/setup_process_coverage', { pipelines: {}, approval_processes: {}, validation_rules: {}, execution_boundary: {} }],
      ['Module replication catalog', '/api/meta/module_replication_catalog', { scope: {}, summary: {}, datasets: [], observed_at: null }],
    ];
    const completenessPromise = api('/api/meta/data_completeness')
      .then(data => ({ ok: true, data }), error => ({ ok: false, error }));
    const integrationStatusPromise = api('/api/integrations/status')
      .then(data => ({ ok: true, data }), () => ({ ok: false, data: null }));
    const settled = await Promise.allSettled(inventoryRequests.map(([, endpoint]) => api(endpoint)));
    const inventoryFailures = [];
    const inventoryValues = settled.map((result, index) => {
      if (result.status === 'fulfilled') return result.value;
      inventoryFailures.push(`${inventoryRequests[index][0]}: ${result.reason?.message || result.reason}`);
      return inventoryRequests[index][2];
    });
    const [d, customButtonData, blueprintCatalog, functionCodeCoverage, functionBehaviorCoverage, widgetBehaviorCoverage, widgetRuntimeCompatibility, reportDashboardCoverage, permissionCoverage, ruleLayoutCoverage, metadataParity, setupProcessCoverage, moduleReplicationCatalog] = inventoryValues;
    const integrationStatus = await integrationStatusPromise;
    if (nav !== state.nav) return;
    c.innerHTML = '';
    const wrap = el('div', 'dashwrap');
    wrap.appendChild(buildIntegrationReadinessCard(integrationStatus));
    const syncedAt = d['automation_synced_at']?.at;
    wrap.appendChild(el('div', 'frlabel', 'Automation configuration cloned from Zoho CRM' + (syncedAt ? ' · synced ' + new Date(syncedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ' · not synced yet')));
    if (inventoryFailures.length) {
      wrap.appendChild(el('div', 'formcallout warning function-behavior-warning', `<b>Some inventories are unavailable.</b> ${inventoryFailures.map(esc).join(' · ')} Other sections remain usable and unavailable values are not treated as verified zeroes.`));
    }

    const completenessSlot = el('div', 'completeness-slot');
    completenessSlot.appendChild(buildDataCompletenessCard(null));
    wrap.appendChild(completenessSlot);

    const replicationScope = moduleReplicationCatalog.scope || {};
    const replicationSummary = moduleReplicationCatalog.summary || {};
    const replicationStates = replicationSummary.state_counts || {};
    const replicationCounts = replicationSummary.source_count_observations || {};
    const replicationDatasets = Array.isArray(moduleReplicationCatalog.datasets) ? moduleReplicationCatalog.datasets : [];
    const replicationCatalogReady = Number(replicationScope.api_supported_dataset_count) === 122
      && replicationDatasets.length === 122
      && Number(replicationStates.reconciled) === 1
      && Number(replicationStates.unresolved) === 121;
    const replicationCard = el('div', 'card');
    replicationCard.appendChild(el('h2', null, 'Source Dataset Replication Coverage — 122 API-Supported Modules'));
    const replicationGrid = el('div', 'function-coverage-grid');
    const replicationStats = replicationCatalogReady ? [
      ['Catalog', `${Number(replicationScope.api_supported_dataset_count).toLocaleString('en-IN')}/${Number(replicationScope.api_supported_dataset_count).toLocaleString('en-IN')} classified`],
      ['Reconciled active-ID scope', `${Number(replicationStates.reconciled).toLocaleString('en-IN')} · Tasks`],
      ['Unresolved scopes', Number(replicationStates.unresolved).toLocaleString('en-IN')],
      ['Scheduled refresh', `${Number(replicationSummary.scheduled_datasets).toLocaleString('en-IN')}/${Number(replicationScope.api_supported_dataset_count).toLocaleString('en-IN')} datasets`],
      ['Outside scheduler', Number(replicationSummary.unscheduled_datasets).toLocaleString('en-IN')],
      ['Source count evidence', `${Number(replicationCounts.observed).toLocaleString('en-IN')} observed · ${Number(replicationCounts.unavailable).toLocaleString('en-IN')} unavailable`],
      ['Generated datasets', `${Number(replicationSummary.generated_datasets).toLocaleString('en-IN')} · all unresolved`],
      ['Observed zero counts', `${Number(replicationCounts.observed_zero_but_unresolved).toLocaleString('en-IN')} · none treated as complete`],
    ] : [
      ['Catalog', 'Evidence unavailable · no dataset is treated as reconciled'],
    ];
    replicationStats.forEach(([label, value]) => replicationGrid.appendChild(el('div', 'function-coverage-stat', `<span>${esc(label)}</span><b>${esc(value)}</b>`)));
    replicationCard.appendChild(replicationGrid);
    replicationCard.appendChild(el('div', 'formcallout warning function-behavior-warning', replicationCatalogReady
      ? 'Only Tasks currently has same-epoch active-ID parity without a count-scope gap. The other 121 datasets remain unresolved, including every generated scope and every observed-zero scope. This evidence catalog does not authorize widening the existing 16-dataset scheduler.'
      : 'The reviewed 122-dataset replication catalog is unavailable. Source-unavailable, count-only, generated, and observed-zero scopes are not treated as empty or complete.'));
    wrap.appendChild(replicationCard);

    const metadataAreas = metadataParity.areas || {};
    const sourcePipelines = setupProcessCoverage.pipelines || {};
    const sourceApprovals = setupProcessCoverage.approval_processes || {};
    const sourceValidation = setupProcessCoverage.validation_rules || {};
    const setupProcessEvidenceVerified = sourcePipelines.status === 'Verified empty'
      && sourceApprovals.status === 'Verified empty'
      && Number(sourceValidation.configured_module_count) === 28
      && Number(sourceValidation.verified_empty_module_count) === 8
      && Number(sourceValidation.unresolved_module_count) === 20;
    const metadataCard = el('div', 'card');
    metadataCard.appendChild(el('h2', null, 'Metadata Parity — Modules, Fields, Layouts, Picklists, Views & Related Lists'));
    const metadataGrid = el('div', 'function-coverage-grid');
    [
      ['Modules', `${Number(metadataAreas.modules?.local_definitions || 0).toLocaleString('en-IN')}/${Number(metadataAreas.modules?.source_definitions || 0).toLocaleString('en-IN')} · ${metadataAreas.modules?.status || 'Unknown'}`],
      ['Fields', `${Number(metadataAreas.fields?.local_definitions || 0).toLocaleString('en-IN')}/${Number(metadataAreas.fields?.source_definitions || 0).toLocaleString('en-IN')} · ${Number(metadataAreas.fields?.source_only || 0).toLocaleString('en-IN')} missing`],
      ['Layouts', `${Number(metadataAreas.layouts?.local_definitions || 0).toLocaleString('en-IN')}/${Number(metadataAreas.layouts?.source_definitions || 0).toLocaleString('en-IN')} · ${Number(metadataAreas.layouts?.source_only || 0).toLocaleString('en-IN')} missing`],
      ['Picklist definitions', `${Number(metadataAreas.picklists?.local_definitions || 0).toLocaleString('en-IN')}/${Number(metadataAreas.picklists?.source_definitions || 0).toLocaleString('en-IN')} · ${Number(metadataAreas.picklists?.source_only || 0).toLocaleString('en-IN')} missing`],
      ['Field picklist options', `${Number(metadataAreas.picklists?.option_coverage?.local_field_option_values || 0).toLocaleString('en-IN')}/${Number(metadataAreas.picklists?.option_coverage?.source_field_option_values || 0).toLocaleString('en-IN')} · ${Number(metadataAreas.picklists?.option_coverage?.source_only_field_option_values || 0).toLocaleString('en-IN')} missing`],
      ['Custom views', `${Number(metadataAreas.custom_views?.local_definitions || 0).toLocaleString('en-IN')}/${Number(metadataAreas.custom_views?.source_definitions || 0).toLocaleString('en-IN')} · ${Number(metadataAreas.custom_views?.semantic_drift || 0).toLocaleString('en-IN')} drift`],
      ['Related lists', `${Number(metadataAreas.related_lists?.local_definitions || 0).toLocaleString('en-IN')}/${Number(metadataAreas.related_lists?.source_definitions || 0).toLocaleString('en-IN')} · ${Number(metadataAreas.related_lists?.source_only || 0).toLocaleString('en-IN')} missing`],
      ['Pipelines', setupProcessEvidenceVerified ? `${Number(sourcePipelines.definitions_observed).toLocaleString('en-IN')} definitions · ${sourcePipelines.status}` : 'Evidence unavailable · not treated as zero'],
    ].forEach(([label, value]) => metadataGrid.appendChild(el('div', 'function-coverage-stat', `<span>${esc(label)}</span><b>${esc(value)}</b>`)));
    metadataCard.appendChild(metadataGrid);
    metadataCard.appendChild(el('div', 'formcallout warning function-behavior-warning', setupProcessEvidenceVerified
      ? 'Module definitions reconcile exactly, and authenticated source UI now verifies that Pipelines is empty. Other metadata families remain incomplete or blocked. No automatic metadata updater was generated or applied because missing definitions, incomplete captures, and shared-attribute drift require review.'
      : 'Module definitions reconcile exactly, but the authenticated source Setup evidence is unavailable and Pipelines is not treated as empty. Other metadata families remain incomplete or blocked.'));
    wrap.appendChild(metadataCard);

    const permissionSource = permissionCoverage.source_coverage || {};
    const permissionUsers = permissionCoverage.source_user_aggregates || {};
    const permissionBoundary = permissionCoverage.enforcement_boundary || {};
    const identityDecision = permissionCoverage.identity_provider_decision || {};
    const permissionCard = el('div', 'card');
    permissionCard.appendChild(el('h2', null, 'Roles, Profiles & Field Permissions'));
    const permissionGrid = el('div', 'function-coverage-grid');
    [
      ['Roles', `${permissionSource.roles || 0} source · 0 enforced`],
      ['Profiles', `${permissionSource.profiles || 0} source · 0 assigned`],
      ['Source users', `${permissionSource.users || 0} aggregate-only · ${permissionUsers.local_users_mapped || 0} mapped`],
      ['Module assignments', `${Number(permissionSource.profile_module_assignments || 0).toLocaleString('en-IN')} source · 0 enforced`],
      ['Field exceptions', `${Number(permissionSource.field_exception_assignments || 0).toLocaleString('en-IN')} source · 0 enforced`],
      ['Default decision', `${permissionBoundary.default_permission_decision || 'Deny'} · ${permissionBoundary.status || 'Blocked'}`],
    ].forEach(([label, value]) => permissionGrid.appendChild(el('div', 'function-coverage-stat', `<span>${esc(label)}</span><b>${esc(value)}</b>`)));
    permissionCard.appendChild(permissionGrid);
    permissionCard.appendChild(el('div', 'formcallout warning function-behavior-warning', `<b>Identity decision required:</b> ${esc(identityDecision.required_decision || 'Choose and map a verified local identity before enabling per-user permissions.')} Caller-supplied role/profile claims are never trusted; all user-specific decisions currently deny.`));

    const roleList = el('div', 'widget-list permission-list');
    (permissionCoverage.roles || []).forEach(role => {
      const row = el('div', 'permission-row');
      row.appendChild(el('b', null, esc(role.name)));
      row.appendChild(el('span', null, `${role.reporting_to ? `Reports to ${esc(role.reporting_to)}` : 'Root role'} · Peer sharing: ${role.share_with_peers ? 'Yes' : 'No'} · Local hierarchy: Blocked`));
      roleList.appendChild(row);
    });
    permissionCard.appendChild(el('div', 'section-label', `Role hierarchy (${(permissionCoverage.roles || []).length})`));
    permissionCard.appendChild(roleList);

    const profileList = el('div', 'widget-list permission-list');
    (permissionCoverage.profiles || []).forEach(profile => {
      const permissions = profile.module_permissions || [];
      const totals = ['view', 'create', 'edit', 'delete'].map(action => permissions.filter(permission => permission[action]).length);
      const details = el('details', 'widget-item permission-item');
      details.appendChild(el('summary', null, `<span>${esc(profile.name)}</span><small>${permissions.length} modules · grants V${totals[0]} C${totals[1]} E${totals[2]} D${totals[3]} · Blocked</small>`));
      details.ontoggle = () => {
        if (!details.open || details.dataset.loaded) return;
        details.dataset.loaded = 'true';
        const body = el('div', 'widget-body permission-matrix');
        permissions.forEach(permission => {
          const line = el('div', 'permission-row compact');
          line.appendChild(el('b', null, esc(permission.module)));
          line.appendChild(el('span', null, `View ${permission.view ? 'Yes' : 'No'} · Create ${permission.create ? 'Yes' : 'No'} · Edit ${permission.edit ? 'Yes' : 'No'} · Delete ${permission.delete ? 'Yes' : 'No'} · Local enforcement: ${esc(permission.local_enforcement)}`));
          body.appendChild(line);
        });
        details.appendChild(body);
      };
      profileList.appendChild(details);
    });
    permissionCard.appendChild(el('div', 'section-label', `Profile-module matrix (${Number(permissionSource.profile_module_assignments || 0).toLocaleString('en-IN')} assignments)`));
    permissionCard.appendChild(profileList);

    const exceptionDetails = el('details', 'widget-item permission-exceptions');
    exceptionDetails.appendChild(el('summary', null, `<span>Field-level exceptions</span><small>${Number(permissionSource.field_exception_groups || 0).toLocaleString('en-IN')} fields · ${Number(permissionSource.hidden_field_assignments || 0).toLocaleString('en-IN')} hidden · ${Number(permissionSource.read_only_field_assignments || 0).toLocaleString('en-IN')} read-only · Blocked</small>`));
    exceptionDetails.ontoggle = () => {
      if (!exceptionDetails.open || exceptionDetails.dataset.loaded) return;
      exceptionDetails.dataset.loaded = 'true';
      const body = el('div', 'widget-body permission-matrix');
      (permissionCoverage.field_permission_model?.exceptions || []).forEach(exception => {
        const line = el('div', 'permission-row compact');
        line.appendChild(el('b', null, `${esc(exception.module)}.${esc(exception.field)}`));
        line.appendChild(el('span', null, (exception.profile_permissions || []).map(item => `${esc(item.profile)}: ${esc(String(item.permission).replace('_', ' '))}`).join(' · ')));
        body.appendChild(line);
      });
      exceptionDetails.appendChild(body);
    };
    const exceptionWrap = el('div', 'widget-list permission-list');
    exceptionWrap.appendChild(exceptionDetails);
    permissionCard.appendChild(el('div', 'section-label', 'Field-level permission matrix'));
    permissionCard.appendChild(exceptionWrap);
    wrap.appendChild(permissionCard);

    const sourceRules = ruleLayoutCoverage.source_coverage || {};
    const localRules = ruleLayoutCoverage.local_enforcement || {};
    const ruleBoundary = ruleLayoutCoverage.enforcement_boundary || {};
    const ruleCard = el('div', 'card');
    ruleCard.appendChild(el('h2', null, 'Layouts, Custom Views, Validation, Assignment, Approvals & Pipelines'));
    const ruleGrid = el('div', 'function-coverage-grid');
    [
      ['Layouts', `${Number(sourceRules.layouts?.definitions_captured || 0).toLocaleString('en-IN')} captured · ${Number(sourceRules.layouts?.blocked_responses || 0).toLocaleString('en-IN')} blocked responses`],
      ['Custom views', `${Number(sourceRules.custom_views?.list_rows_captured || 0).toLocaleString('en-IN')} rows · ${Number(sourceRules.custom_views?.criteria_details_captured || 0).toLocaleString('en-IN')} criteria details`],
      ['Validation rules', setupProcessEvidenceVerified ? `${Number(sourceValidation.verified_empty_module_count).toLocaleString('en-IN')}/${Number(sourceValidation.configured_module_count).toLocaleString('en-IN')} verified empty · ${Number(sourceValidation.unresolved_module_count).toLocaleString('en-IN')} unresolved` : 'Evidence unavailable · not treated as zero'],
      ['Assignment rules', `${Number(sourceRules.assignment_rules?.definitions_captured || 0).toLocaleString('en-IN')} listed · ${Number(sourceRules.assignment_rules?.executable_definitions_captured || 0).toLocaleString('en-IN')} executable`],
      ['Approval processes', setupProcessEvidenceVerified ? `${Number(sourceApprovals.definitions_observed).toLocaleString('en-IN')} definitions · ${sourceApprovals.status}` : 'Evidence unavailable · not treated as zero'],
      ['Pipelines', setupProcessEvidenceVerified ? `${Number(sourcePipelines.definitions_observed).toLocaleString('en-IN')} definitions · ${sourcePipelines.status}` : 'Evidence unavailable · not treated as zero'],
      ['Layout enforcement', `${localRules.layouts?.status || 'Unknown'} · profile/action permissions blocked`],
      ['Rule decision', `${ruleBoundary.default_rule_decision || 'Deny'} · ${ruleBoundary.status || 'Blocked'}`],
    ].forEach(([label, value]) => ruleGrid.appendChild(el('div', 'function-coverage-stat', `<span>${esc(label)}</span><b>${esc(value)}</b>`)));
    ruleCard.appendChild(ruleGrid);
    const validationEvidence = el('details', 'widget-item permission-exceptions');
    validationEvidence.appendChild(el('summary', null, `<span>Authenticated source Validation Rules audit</span><small>${Number(sourceValidation.verified_empty_module_count || 0).toLocaleString('en-IN')} verified empty · ${Number(sourceValidation.unresolved_module_count || 0).toLocaleString('en-IN')} unresolved · read-only</small>`));
    const validationEvidenceBody = el('div', 'widget-body permission-matrix');
    validationEvidenceBody.appendChild(el('div', 'permission-row compact', `<b>Verified empty</b><span>${esc((sourceValidation.verified_empty_modules || []).join(', ') || 'None')}</span>`));
    validationEvidenceBody.appendChild(el('div', 'permission-row compact', `<b>Unresolved</b><span>${esc((sourceValidation.unresolved_modules || []).join(', ') || 'None')}</span>`));
    validationEvidence.appendChild(validationEvidenceBody);
    const validationEvidenceWrap = el('div', 'widget-list permission-list');
    validationEvidenceWrap.appendChild(validationEvidence);
    ruleCard.appendChild(validationEvidenceWrap);
    ruleCard.appendChild(el('div', 'formcallout warning function-behavior-warning', setupProcessEvidenceVerified
      ? 'Local layout-aware field validation and a fail-closed custom-view compiler are implemented. Authenticated source UI verifies zero configured pipelines and zero approval processes, plus no Validation Rules in 8 of 28 configurable modules. The remaining 20 Validation Rules scopes and assignment-rule execution details are unresolved; all unverified rule execution remains denied.'
      : 'Local layout-aware field validation and a fail-closed custom-view compiler are implemented. Authenticated source Setup evidence is unavailable, so Pipelines, Approval Processes, and Validation Rules are not treated as verified empty; all unverified rule execution remains denied.'));
    wrap.appendChild(ruleCard);

    const listedRules = d['automation:workflow_rules']?.workflow_rules || [];
    const detailedRules = d['automation:workflow_rule_details']?.workflow_rules || [];
    const fieldUpdates = d['automation:field_updates']?.field_updates || [];
    const automationTasks = d['automation:tasks']?.tasks || [];
    const emailNotifications = d['automation:email_notifications']?.email_notifications || [];
    const actionCatalogs = {
      fieldUpdates: new Map(fieldUpdates.map(action => [String(action.id), action])),
      tasks: new Map(automationTasks.map(action => [String(action.id), action])),
      emailNotifications: new Map(emailNotifications.map(action => [String(action.id), action])),
    };
    const functionBehaviors = functionBehaviorCoverage.functions || [];
    const functionBehaviorById = new Map(functionBehaviors.map(fn => [String(fn.id), fn]));
    const functionBehaviorByWorkflowAction = new Map();
    const functionBehaviorByButtonId = new Map();
    functionBehaviors.forEach(fn => (fn.associations || []).forEach(association => {
      if (association.source === 'active_workflow' && association.action_id) functionBehaviorByWorkflowAction.set(String(association.action_id), fn);
      if (association.source === 'custom_button' && association.button_id) functionBehaviorByButtonId.set(String(association.button_id), fn);
    }));
    const detailById = new Map(detailedRules.map(rule => [String(rule.id), rule]));
    const rules = listedRules.map(rule => detailById.get(String(rule.id)) || rule);
    const catalogByType = { field_updates: actionCatalogs.fieldUpdates, tasks: actionCatalogs.tasks, email_notifications: actionCatalogs.emailNotifications };
    const referencedCatalogActions = rules.flatMap(rule => workflowActions(rule).map(action => ({ ...action, rule_name: rule.name })) ).filter(action => catalogByType[action.type]);
    const unresolvedCatalogActions = referencedCatalogActions.filter(action => !catalogByType[action.type].has(String(action.id)));
    const wfCard = el('div', 'card');
    wfCard.appendChild(el('h2', null, `Workflow Rules (${rules.length}) · ${detailedRules.length} detailed`));
    rules.forEach(rule => {
      const n = el('div', 'note');
      const active = rule.status?.active !== false && rule.active !== false && rule.status !== 'inactive';
      n.appendChild(el('div', 'nt', `${esc(rule.name || '(unnamed)')}${active ? '' : ' · inactive'}`));
      const mod = rule.execute_when?.details?.trigger_module?.api_name || rule.module?.api_name || '';
      const actions = workflowActions(rule);
      n.appendChild(el('div', 'nm2', [mod && `Module: ${mod}`, rule.execute_when?.type && `Trigger: ${rule.execute_when.type}`, `Conditions: ${(rule.conditions || []).length}`, `Actions: ${actions.length}`, detailById.has(String(rule.id)) ? 'Source detail: specified' : 'Source detail: list only'].filter(Boolean).map(esc).join(' · ')));
      (rule.conditions || []).forEach((condition, index) => {
        const criteria = workflowCriterionText(condition.criteria_details?.criteria);
        const relational = workflowCriterionText(condition.criteria_details?.relational_criteria?.criteria);
        const conditionActions = [
          ...(condition.instant_actions?.actions || []).map(action => `${esc(action.type)}: ${esc(action.name)} (instant)<br><span class="action-detail">${esc(automationActionDetail(action, actionCatalogs, functionBehaviorByWorkflowAction))}</span>`),
          ...(condition.scheduled_actions || []).flatMap(schedule => (schedule.actions || []).map(action => `${esc(action.type)}: ${esc(action.name)} (scheduled ${esc(schedule.execute_after?.unit ?? '')} ${esc(schedule.execute_after?.period ?? '')})<br><span class="action-detail">${esc(automationActionDetail(action, actionCatalogs, functionBehaviorByWorkflowAction))}</span>`)),
        ];
        n.appendChild(el('div', 'nc', `Condition ${index + 1}${criteria ? ` · ${esc(criteria)}` : ''}${relational ? ` · Related: ${esc(relational)}` : ''}<small>${conditionActions.length ? conditionActions.join('<br>') : 'No configured actions returned.'}</small>`));
      });
      if (rule.description) n.appendChild(el('div', 'nc', esc(rule.description)));
      wfCard.appendChild(n);
    });
    if (!rules.length) wfCard.appendChild(el('div', 'loading', 'None synced yet'));
    wrap.appendChild(wfCard);

    const actionCard = el('div', 'card');
    actionCard.appendChild(el('h2', null, `Workflow Action Definitions (${fieldUpdates.length + automationTasks.length + emailNotifications.length})`));
    actionCard.appendChild(el('div', 'frlabel', `Field updates: ${fieldUpdates.length} · Task actions: ${automationTasks.length} · Email notifications: ${emailNotifications.length} · Workflow references: ${referencedCatalogActions.length} · Resolved: ${referencedCatalogActions.length - unresolvedCatalogActions.length}`));
    unresolvedCatalogActions.forEach(action => {
      const warning = el('div', 'formcallout warning', `<b>Unresolved source reference:</b> ${esc(action.rule_name)} → ${esc(action.type)} “${esc(action.name || action.id)}” (${esc(action.id)}). Zoho returned the workflow reference but not the action definition; execution remains blocked.`);
      actionCard.appendChild(warning);
    });
    fieldUpdates.forEach(action => {
      const n = el('div', 'note');
      n.appendChild(el('div', 'nt', esc(action.name || '(unnamed field update)')));
      n.appendChild(el('div', 'nm2', `Module: ${esc(action.module?.api_name || '—')} · Field: ${esc(action.field?.api_name || '—')} · Type: ${esc(action.type || '—')} · Associated: ${action.associated === false ? 'No' : 'Yes'}`));
      n.appendChild(el('div', 'nc', `Source value: ${esc(fmtVal(action.display_value ?? action.value))}<small>Definition captured · local execution remains blocked until workflow ordering and rollback paths are verified.</small>`));
      actionCard.appendChild(n);
    });
    automationTasks.forEach(action => {
      const n = el('div', 'note');
      n.appendChild(el('div', 'nt', esc(action.name || '(unnamed task action)')));
      n.appendChild(el('div', 'nm2', `Module: ${esc(action.module?.api_name || '—')} · Field mappings: ${(action.field_mappings || []).length} · Notify: ${action.notify === true ? 'Yes' : 'No'} · Associated: ${action.associated === false ? 'No' : 'Yes'}`));
      const mappings = (action.field_mappings || []).map(mapping => `${mapping.field?.api_name || 'field'}: ${fmtVal(mapping.display_value ?? mapping.value)}`);
      n.appendChild(el('div', 'nc', `${mappings.length ? mappings.map(esc).join('<br>') : 'No mappings returned.'}<small>Definition captured · local task creation remains blocked until execution parity is verified.</small>`));
      actionCard.appendChild(n);
    });
    emailNotifications.forEach(action => {
      const n = el('div', 'note');
      n.appendChild(el('div', 'nt', esc(action.name || '(unnamed email notification)')));
      n.appendChild(el('div', 'nm2', `Module: ${esc(action.module?.api_name || '—')} · Template: ${esc(action.template?.name || '—')} · Recipients: ${esc(action.recipient_count ?? 'source-configured')} · Associated: ${action.associated === false ? 'No' : 'Yes'}`));
      n.appendChild(el('div', 'nc', 'Recipient addresses and sender credentials are not exposed. Email delivery is disabled in localhost.'));
      actionCard.appendChild(n);
    });
    if (!fieldUpdates.length && !automationTasks.length && !emailNotifications.length) actionCard.appendChild(el('div', 'loading', 'Action-definition catalogs have not been synced yet.'));
    wrap.appendChild(actionCard);

    const functionCoverage = functionBehaviorCoverage.coverage || {};
    const functionImpact = functionBehaviorCoverage.affected || {};
    const functionFieldReferences = functionImpact.field_references || {};
    const behaviorCard = el('div', 'card');
    behaviorCard.appendChild(el('h2', null, `Active Workflow & Button Function Behavior (${functionBehaviors.length})`));
    const coverageGrid = el('div', 'function-coverage-grid');
    [
      ['In-scope behavior', `${functionCoverage.analyzed_function_definitions || 0}/${functionCoverage.in_scope_function_definitions || 0}`],
      ['Workflow functions', `${functionCoverage.mapped_workflow_functions || 0} · ${functionCoverage.workflow_function_associations || 0} associations`],
      ['Button functions', `${functionCoverage.mapped_button_functions || 0}/${functionCoverage.custom_function_button_references || 0}`],
      ['Affected modules', functionImpact.module_count || 0],
      ['Field references', `${functionFieldReferences.read || 0} read · ${functionFieldReferences.write || 0} write`],
      ['Execution', functionBehaviorCoverage.execution?.local_status || 'Blocked'],
    ].forEach(([label, value]) => coverageGrid.appendChild(el('div', 'function-coverage-stat', `<span>${esc(label)}</span><b>${esc(value)}</b>`)));
    behaviorCard.appendChild(coverageGrid);
    behaviorCard.appendChild(el('div', 'formcallout warning function-behavior-warning', `Coverage: ${esc(functionCoverage.status || 'Incomplete')} · unresolved in-scope references: ${esc(functionCoverage.unresolved_in_scope_references ?? '—')}. This source-backed behavior catalog is metadata only. Local function execution, source execution, source writes, and outbound delivery all remain blocked.`));
    const moduleImpactText = (functionImpact.modules || []).map(item => `${item.module}: ${item.affected_function_count} function${item.affected_function_count === 1 ? '' : 's'} (${item.read_function_count} read / ${item.write_function_count} write)`).join(' · ');
    if (moduleImpactText) behaviorCard.appendChild(el('div', 'function-impact', `<b>Module impact:</b> ${esc(moduleImpactText)}`));
    functionBehaviors.forEach(fn => {
      const n = el('div', 'note');
      const associationLabels = (fn.associations || []).map(association => association.source === 'active_workflow'
        ? `Workflow: ${association.rule_name} (${association.rule_module || 'module not returned'})`
        : `Button: ${association.button_api_name || association.action_reference_name} (${association.button_module || 'module not returned'})`);
      n.appendChild(el('div', 'nt', `${esc(fn.display_name)} · ${esc(fn.local_execution)}`));
      n.appendChild(el('div', 'nm2', associationLabels.length ? associationLabels.map(esc).join(' · ') : 'Source association unavailable'));
      n.appendChild(el('div', 'nm2', `Reads: ${esc((fn.modules_read || []).join(', ') || 'none')} · Writes: ${esc((fn.modules_written || []).join(', ') || 'none')} · Field references: ${esc(fn.field_references?.read || 0)} read / ${esc(fn.field_references?.write || 0)} write · Complexity: ${esc(fn.local_implementation_complexity)} · Mapping confidence: ${esc(fn.mapping_confidence)}`));
      const blockers = (fn.blockers || []).map(esc).join('<br>');
      n.appendChild(el('div', 'nc', `${esc(fn.behavior)}<small><b>Blockers:</b><br>${blockers || 'No blocker detail returned; execution remains fail-closed.'}</small>`));
      behaviorCard.appendChild(n);
    });
    if (!functionBehaviors.length) behaviorCard.appendChild(el('div', 'loading', 'No sanitized active-function behavior inventory is available; execution remains blocked.'));
    wrap.appendChild(behaviorCard);

    const bpCard = el('div', 'card');
    const bpBody = el('div');
    const blueprints = blueprintCatalog.blueprints || [];
    blueprints.forEach(bp => {
      const n = el('div', 'note');
      n.appendChild(el('div', 'nt', `${esc(bp.name)}${bp.status === 'Active' ? '' : ` · ${esc(bp.status)}`}`));
      n.appendChild(el('div', 'nm2', `Module: ${esc(bp.module)} · State field: ${esc(bp.state_field)} · Graph: ${bp.state_count} states / ${bp.transition_count} transitions / ${bp.connection_count} connections`));
      n.appendChild(el('div', 'nc', `Before/During/After specified: ${bp.phase_detail_count}/${bp.transition_count} · Policy eligible: ${bp.policy_eligible_count}/${bp.transition_count} · Atomic runtime ready: ${bp.atomic_runtime_ready_count}/${bp.transition_count}${bp.automatic_count ? ` · Automatic: ${bp.automatic_count}` : ''}`));
      bpBody.appendChild(n);
    });
    bpCard.appendChild(el('h2', null, `Blueprints (${blueprints.length})`));
    bpCard.appendChild(blueprints.length ? bpBody : el('div', 'loading', 'None synced yet'));
    wrap.appendChild(bpCard);

    const webhooks = d['automation:webhooks']?.webhooks || [];
    const webhookCard = el('div', 'card');
    webhookCard.appendChild(el('h2', null, `Webhooks (${webhooks.length})`));
    webhooks.forEach(webhook => {
      const n = el('div', 'note');
      const active = webhook.status?.active !== false && webhook.active !== false;
      n.appendChild(el('div', 'nt', `${esc(webhook.name || '(unnamed)')}${active ? '' : ' · inactive'}`));
      n.appendChild(el('div', 'nm2', `Module: ${esc(webhook.module?.api_name || '—')} · Method: ${esc(webhook.http_method || '—')} · Feature: ${esc(webhook.feature_type || '—')} · Local status: Blocked`));
      n.appendChild(el('div', 'nc', 'Destination, headers, authentication values, and outbound delivery are not exposed or enabled in the localhost replica.'));
      webhookCard.appendChild(n);
    });
    if (!webhooks.length) webhookCard.appendChild(el('div', 'loading', 'No webhook catalog has been synced yet.'));
    wrap.appendChild(webhookCard);

    const grid = el('div', 'dashgrid');
    const fns = d['automation:functions']?.functions || [];
    const capturedFunctionIds = new Set((functionCodeCoverage.functions || []).filter(item => item.captured).map(item => String(item.id)));
    const fnCard = el('div', 'card');
    fnCard.appendChild(el('h2', null, `Functions — Deluge (${fns.length}) · code captured ${capturedFunctionIds.size}/${fns.length}`));
    if (capturedFunctionIds.size) fnCard.appendChild(el('div', 'frlabel', 'Exact source bodies are stored only in the permission-restricted private discovery area. The browser exposes metadata and coverage, never code or embedded credentials.'));
    fns.forEach(fn => {
      const n = el('div', 'note');
      n.appendChild(el('div', 'nt', `${esc(fn.display_name || fn.name || '')}${fn.state === 'inactive' ? ' · inactive' : ''}`));
      const args = (fn.arguments || []).map(argument => `${argument.name}: ${argument.type}`).join(', ');
      n.appendChild(el('div', 'nm2', [fn.category, fn.runtime, fn.api_name && `API: ${fn.api_name}`, args && `Inputs: ${args}`, fn.modified_time && ('modified ' + fmtVal(fn.modified_time, { data_type: 'datetime' }))].filter(Boolean).map(esc).join(' · ')));
      const behavior = functionBehaviorById.get(String(fn.id));
      n.appendChild(el('div', 'nc', behavior
        ? `Source-backed behavior mapped · ${behavior.field_references.read} read / ${behavior.field_references.write} write field references · local execution blocked.`
        : (capturedFunctionIds.has(String(fn.id)) ? 'Exact body captured privately · not associated with an active workflow or custom-function button in the current scope · local execution blocked.' : 'Metadata captured · exact function body is not available locally.')));
      fnCard.appendChild(n);
    });
    if (!fns.length) fnCard.appendChild(el('div', 'loading', 'None synced yet'));
    grid.appendChild(fnCard);

    const dashes = d['automation:analytics']?.Analytics || [];
    const anCard = el('div', 'card');
    anCard.appendChild(el('h2', null, `Zoho Analytics Dashboards (${dashes.length})`));
    dashes.forEach(dashboard => {
      const n = el('div', 'note');
      n.appendChild(el('div', 'nt', esc(dashboard.name || '')));
      n.appendChild(el('div', 'nm2', [dashboard.access_type, dashboard.sharing_permissions].filter(Boolean).map(esc).join(' · ')));
      anCard.appendChild(n);
    });
    if (!dashes.length) anCard.appendChild(el('div', 'loading', 'None synced yet'));
    grid.appendChild(anCard);
    wrap.appendChild(grid);

    const reportCoverage = reportDashboardCoverage.coverage?.reports || {};
    const dashboardCoverage = reportDashboardCoverage.coverage?.dashboards || {};
    const selectedDashboard = dashboardCoverage.selected_dashboard || {};
    const reportCard = el('div', 'card');
    reportCard.appendChild(el('h2', null, 'Reports & Dashboards — Replication Coverage'));
    const reportCoverageGrid = el('div', 'function-coverage-grid');
    [
      ['Reports discovered', Number(reportCoverage.discovered || 0).toLocaleString('en-IN')],
      ['Report categories', Number(reportCoverage.categories || 0).toLocaleString('en-IN')],
      ['Verified exports', `${reportCoverage.verified_private_exports || 0}/${reportCoverage.discovered || 0}`],
      ['Rows counted privately', Number(reportCoverage.verified_private_export_rows || 0).toLocaleString('en-IN')],
      ['Dashboards discovered', Number(dashboardCoverage.discovered || 0).toLocaleString('en-IN')],
      ['Local execution', reportDashboardCoverage.execution_boundary?.status || 'Blocked'],
    ].forEach(([label, value]) => reportCoverageGrid.appendChild(el('div', 'function-coverage-stat', `<span>${esc(label)}</span><b>${esc(value)}</b>`)));
    reportCard.appendChild(reportCoverageGrid);
    reportCard.appendChild(el('div', 'formcallout warning function-behavior-warning', 'The report/dashboard catalog is reconciled, but source definitions, query formulas, calculations, schedules, sharing, and result sets are not replicated. Report execution, result access, dashboard execution, and delivery remain fail-closed. The one verified private export establishes only its row count.'));
    if (selectedDashboard.name) {
      const selected = el('details', 'widget-item report-dashboard-item');
      selected.appendChild(el('summary', null, `<span>${esc(selectedDashboard.name)}</span><small>${esc(selectedDashboard.component_count || 0)} captured components · structure only · Blocked</small>`));
      const selectedBody = el('div', 'widget-body');
      const components = selectedDashboard.component_names || [];
      selectedBody.appendChild(el('div', 'widget-line', `<b>Captured components:</b><ol>${components.map(component => `<li>${esc(component)}</li>`).join('')}</ol>`));
      selectedBody.appendChild(el('div', 'widget-line', '<b>Boundary:</b> Component names are configuration evidence only; no component query, chart value, customer row, schedule, recipient, or calculation result is exposed here.'));
      selected.appendChild(selectedBody);
      const selectedWrap = el('div', 'widget-list report-dashboard-list');
      selectedWrap.appendChild(selected);
      reportCard.appendChild(selectedWrap);
    }
    wrap.appendChild(reportCard);

    const widgetReconciliation = widgetBehaviorCoverage.reconciliation || {};
    const widgetExecution = widgetBehaviorCoverage.execution_boundary || {};
    const widgetTypes = widgetBehaviorCoverage.type_summary || {};
    const widgets = widgetBehaviorCoverage.widgets || [];
    const widgetRuntimeSummary = widgetRuntimeCompatibility.summary || {};
    const widgetRuntimeArchive = widgetRuntimeCompatibility.archive_set || {};
    const runtimeByWidgetId = new Map((widgetRuntimeCompatibility.widgets || []).map(widget => [String(widget.id), widget]));
    const widgetCard = el('div', 'card');
    widgetCard.appendChild(el('h2', null, `Widget Registrations (${widgets.length})`));
    const widgetCoverageGrid = el('div', 'function-coverage-grid');
    [
      ['Source registrations', widgetReconciliation.source_widget_rows || 0],
      ['Zoho hosted', `${widgetReconciliation.validated_zoho_packages || 0}/${widgetReconciliation.zoho_hosted_widgets || 0} packages validated`],
      ['External hosted', `${widgetReconciliation.external_hosted_widgets || 0} · packages unavailable`],
      ['Blueprint widgets', widgetTypes.Blueprint || 0],
      ['Button widgets', widgetTypes.Button || 0],
      ['Local execution', widgetExecution.status || 'Blocked'],
      ['Runtime previews', `${widgetRuntimeSummary.implemented_local_previews || 0} live read-only · ${widgetRuntimeSummary.local_preview_candidates || 0} candidates · ${widgetRuntimeSummary.quarantined_packages || 0} quarantined · ${widgetRuntimeSummary.quarantined_pending_sensitive_review || 0} review pending · ${widgetRuntimeSummary.quarantined_review_complete_contract_blocked || 0} reviewed/contract blocked`],
      ['Audited archives', `${widgetRuntimeArchive.captured_packages || 0}/${widgetRuntimeArchive.expected_packages || 0} · ${Number(widgetRuntimeArchive.entries || 0).toLocaleString('en-IN')} entries`],
      ['Bounded reviews', `${widgetRuntimeArchive.sensitive_review_completed_packages || 0} completed · ${widgetRuntimeArchive.sensitive_review_required_packages || 0} pending`],
    ].forEach(([label, value]) => widgetCoverageGrid.appendChild(el('div', 'function-coverage-stat', `<span>${esc(label)}</span><b>${esc(value)}</b>`)));
    widgetCard.appendChild(widgetCoverageGrid);
    widgetCard.appendChild(el('div', 'formcallout warning function-behavior-warning', 'All downloaded Zoho packages were inspected offline and validated without executing their code. Nine separate original read-only previews are implemented: Estimate, Assign Technician, Designer Form, Payment Milestone, Revise Quote, Closure New, Revise-Approve Quote-Any Stage, Deploy Team, and Handover To Post Team. All five bounded archive reviews are complete; zero remain pending. Three packages remain quarantined after review: Closure Order Stage Update lacks an authoritative parent/During/attachment contract; Handover to Post Design lacks an authoritative widget-ID-bearing parent binding; and Sunrooof Mark Closures requires credential rotation plus accepted cross-organization CRM, WorkDrive, data, transaction, and file contracts. Deploy Team currently fails closed because Client Address is read-only. Handover To Post Team can show exact requirements only; AMS creation remains blocked because no active reviewed transition enters Planned. External-hosted registrations have no captured package. Captured source, CRM writes, Blueprint continuation, workflows, files, and outbound provider access remain fail-closed.'));
    const widgetGroup = el('div', 'widget-list');
    widgets.forEach(widget => {
      const details = el('details', 'widget-item');
      const context = widget.behavior?.context_modules || [];
      const runtimeProfile = runtimeByWidgetId.get(String(widget.id));
      const runtimeLabel = runtimeProfile
        ? runtimeProfile.preview_runtime_status === 'implemented-read-only'
          ? 'Read-only preview implemented'
          : runtimeProfile.preview_runtime_status === 'quarantined'
            ? runtimeProfile.preview_classification === 'quarantined-reviewed-contract-blocked'
              ? 'Preview quarantined · contract blocked after review'
              : 'Preview quarantined · review pending'
            : 'Read-only preview candidate'
        : 'Runtime blocked';
      const runtimeBoundaryLabel = runtimeProfile?.preview_runtime_status === 'implemented-read-only'
        ? 'separate local reimplementation · source execution disabled · writes disabled · outbound disabled.'
        : 'no local preview enabled · source execution disabled · writes disabled · outbound disabled.';
      const summary = el('summary', null, `<span>${esc(widget.name)}</span><small>${esc(widget.hosting)} · ${esc(widget.type)}${context.length ? ` · ${esc(context.join(', '))}` : ''} · ${esc(runtimeLabel)}</small>`);
      details.appendChild(summary);
      const body = el('div', 'widget-body');
      body.appendChild(el('div', 'nm2', `Source registration: ${esc(widget.id)} · Package: ${widget.package?.captured ? `${esc(widget.package.archive_validation)} · offline analysis completed` : 'not available for external hosting'} · Mapping confidence: ${esc(widget.behavior?.mapping_confidence || 'Unavailable')} · Local feasibility: ${esc(widget.behavior?.local_equivalent_feasibility || 'Blocked')}`));
      body.appendChild(el('div', 'nc', esc(widget.behavior?.purpose || 'Behavior unavailable from the captured source evidence.')));
      const reads = widget.behavior?.modules_read || [];
      const writes = widget.behavior?.modules_written || [];
      body.appendChild(el('div', 'widget-line', `<b>Modules:</b> ${esc(reads.length ? `reads ${reads.join(', ')}` : 'no CRM reads detected')}; ${esc(writes.length ? `writes ${writes.join(', ')}` : 'no CRM writes detected')}`));
      if (runtimeProfile) {
        body.appendChild(el('div', 'widget-line', `<b>Runtime preflight:</b> ${esc(runtimeLabel)} · ${esc(runtimeBoundaryLabel)}`));
        body.appendChild(el('div', 'widget-line', `<b>Preview rationale:</b> ${esc(runtimeProfile.preview_rationale)}`));
      }
      const addWidgetList = (label, values, fallback) => {
        const block = el('div', 'widget-line');
        block.innerHTML = `<b>${esc(label)}:</b> ${values.length ? `<ul>${values.map(value => `<li>${esc(value)}</li>`).join('')}</ul>` : esc(fallback)}`;
        body.appendChild(block);
      };
      addWidgetList('Record actions', widget.behavior?.record_actions || [], 'Not available from captured evidence.');
      addWidgetList(`Mandatory inputs — ${widget.behavior?.mandatory_input_status || 'Unknown'}`, widget.behavior?.mandatory_inputs || [], 'None detected in the package evidence.');
      addWidgetList('Dependencies', widget.behavior?.dependencies || [], 'No dependency metadata returned.');
      addWidgetList('Blockers', widget.behavior?.local_blockers || [], widget.local_execution?.reason || 'Execution remains blocked.');
      details.appendChild(body);
      widgetGroup.appendChild(details);
    });
    widgetCard.appendChild(widgetGroup);
    wrap.appendChild(widgetCard);

    const customButtons = customButtonData.buttons || [];
    const buttonCard = el('div', 'card');
    buttonCard.appendChild(el('h2', null, `Custom Buttons (${customButtons.length})`));
    customButtons.forEach(button => {
      const n = el('div', 'note');
      n.appendChild(el('div', 'nt', esc(button.name)));
      n.appendChild(el('div', 'nm2', `Module: ${esc(button.module)} · Position: ${esc(button.position)} · Action: ${esc(button.action)} · Local status: ${esc(button.local_status)}`));
      if (button.action_reference) n.appendChild(el('div', 'nm2', `Source reference: ${esc(button.action_reference.type)} · ${esc(button.action_reference.name || button.action_reference.id)}`));
      const buttonBehavior = functionBehaviorByButtonId.get(String(button.id));
      n.appendChild(el('div', 'nc', `${buttonBehavior ? `${esc(buttonBehavior.behavior)}<small>Source-backed behavior mapped · field references: ${esc(buttonBehavior.field_references.read)} read / ${esc(buttonBehavior.field_references.write)} write · execution blocked.</small>` : ''}${buttonBehavior ? '<small>' : ''}${esc(button.block_reason)}${buttonBehavior ? '</small>' : ''}`));
      buttonCard.appendChild(n);
    });
    if (!customButtons.length) buttonCard.appendChild(el('div', 'loading', 'No custom buttons discovered'));
    wrap.appendChild(buttonCard);

    wrap.appendChild(el('div', 'dashfoot', 'Zoho remains a read-only source. The localhost catalog shows captured configuration; outbound actions and incomplete local equivalents stay disabled until their code, identity rules, credentials, and rollback behavior are verified.'));
    c.appendChild(wrap);
    completenessPromise.then(result => {
      if (nav !== state.nav || !completenessSlot.isConnected) return;
      completenessSlot.replaceChildren(buildDataCompletenessCard(result.ok ? result.data : null, result.ok ? null : result.error));
    });
  } catch (e) {
    if (nav !== state.nav) return;
    c.innerHTML = `<div class="loading">${esc(e.message)}</div>`;
  }
}

/* ---------- analytics command center ---------- */
function analyticsNode(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function analyticsRangeFor(key = state.analyticsFilter.key) {
  if (key === 'custom' && state.analyticsFilter.from && state.analyticsFilter.to) {
    return { from: state.analyticsFilter.from, to: state.analyticsFilter.to };
  }
  const now = istNowD();
  const to = fmtD(now);
  const ago = days => fmtD(new Date(now.getTime() - days * 86400000));
  if (key === 'today') return { from: to, to };
  if (key === '90d') return { from: ago(89), to };
  if (key === 'this_month') return { from: to.slice(0, 8) + '01', to };
  if (key === 'ytd') return { from: to.slice(0, 4) + '-01-01', to };
  return { from: ago(29), to };
}

function analyticsFilterControl(onChange) {
  const wrap = analyticsNode('div', 'analytics-filter');
  const select = analyticsNode('select');
  select.setAttribute('aria-label', 'Analytics date range');
  [
    ['today', 'Today'],
    ['30d', 'Last 30 days'],
    ['90d', 'Last 90 days'],
    ['this_month', 'This month'],
    ['ytd', 'Year to date'],
    ['custom', 'Custom range…'],
  ].forEach(([value, label]) => {
    const option = analyticsNode('option', null, label);
    option.value = value;
    option.selected = state.analyticsFilter.key === value;
    select.appendChild(option);
  });
  const custom = analyticsNode('span', `analytics-filter-custom${state.analyticsFilter.key === 'custom' ? '' : ' hidden'}`);
  const from = analyticsNode('input');
  const to = analyticsNode('input');
  const today = fmtD(istNowD());
  from.type = to.type = 'date';
  from.max = to.max = today;
  from.value = state.analyticsFilter.from || analyticsRangeFor('30d').from;
  to.value = state.analyticsFilter.to || today;
  from.setAttribute('aria-label', 'Analytics range start');
  to.setAttribute('aria-label', 'Analytics range end');
  const apply = analyticsNode('button', 'btn-primary', 'Apply');
  apply.type = 'button';
  apply.onclick = () => {
    if (!from.value || !to.value) return toast('Pick both analytics dates');
    let start = from.value;
    let end = to.value;
    if (start > end) [start, end] = [end, start];
    const days = Math.round((new Date(end + 'T00:00:00Z') - new Date(start + 'T00:00:00Z')) / 86400000) + 1;
    if (end > today || days > 366) return toast('Analytics supports up to 366 days ending today or earlier');
    state.analyticsFilter = { key: 'custom', from: start, to: end };
    onChange();
  };
  custom.append(from, analyticsNode('span', null, '→'), to, apply);
  select.onchange = () => {
    if (select.value === 'custom') {
      state.analyticsFilter = { ...state.analyticsFilter, key: 'custom' };
      custom.classList.remove('hidden');
      return;
    }
    state.analyticsFilter = { key: select.value, from: null, to: null };
    onChange();
  };
  wrap.append(select, custom);
  return wrap;
}

const analyticsCount = value => value === null || value === undefined
  ? 'Data Not Available'
  : Number(value).toLocaleString('en-IN');

function analyticsSignedCount(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return 'Data Not Available';
  const number = Number(value);
  return `${number > 0 ? '+' : ''}${number.toLocaleString('en-IN')}`;
}

function analyticsSignedPercentage(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return 'Data Not Available';
  const number = Number(value);
  return `${number > 0 ? '+' : ''}${number.toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function analyticsDateTime(value) {
  if (!value) return 'Data Not Available';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Data Not Available';
  return parsed.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/* Replication truth card start */
const REPLICATION_HEALTH_CACHE_MS = 60_000;
const replicationHealthResource = { snapshot: null, cachedAt: 0, inFlight: null };
const replicationHealthClassifications = Object.freeze({
  reconciled_current: { label: 'Reconciled current', tone: 'success' },
  ahead_of_audit_recheck_required: { label: 'Audit recheck required', tone: 'warning' },
  behind_source: { label: 'Behind source', tone: 'danger' },
  partial_refresh: { label: 'Partial refresh', tone: 'warning' },
  unsupported_scope: { label: 'Unsupported scope', tone: 'neutral' },
  unavailable: { label: 'Unavailable', tone: 'neutral' },
});
const replicationRunStates = Object.freeze({
  succeeded: { label: 'Succeeded', tone: 'success' },
  partial: { label: 'Partial', tone: 'warning' },
  failed: { label: 'Failed', tone: 'danger' },
  unavailable: { label: 'Unavailable', tone: 'neutral' },
});
const replicationExclusionDefinitions = Object.freeze([
  ['deletions', 'Deletions', 'Deleted records are not discovered by the scheduled record delta.'],
  ['attachments', 'Attachments', 'Attachment bodies are outside the scheduled record delta.'],
  ['metadata', 'Metadata', 'Module and field metadata are outside this scheduled record delta.'],
  ['reports', 'Reports', 'Report definitions and results are not replicated by this schedule.'],
  ['dashboards', 'Dashboards', 'Dashboard definitions and results are not replicated by this schedule.'],
  ['child_datasets', 'Child datasets', 'Generated child datasets are outside the scheduled record delta.'],
]);
let replicationTrustCardSequence = 0;

function replicationHealthNode(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function replicationSafeCount(value) {
  if (value === null || value === undefined || value === '') return 'Unavailable';
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count.toLocaleString('en-IN') : 'Unavailable';
}

function replicationSafeTimestamp(value) {
  if (!value) return 'Not recorded';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Unavailable';
  return parsed.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function replicationKnownClassification(value) {
  return Object.prototype.hasOwnProperty.call(replicationHealthClassifications, value) ? value : 'unavailable';
}

function replicationKnownRunState(value) {
  return Object.prototype.hasOwnProperty.call(replicationRunStates, value) ? value : 'unavailable';
}

const REPLICATION_HEALTH_RETRY_MS = 1_250;

function requestReplicationHealthSnapshot() {
  const now = Date.now();
  if (replicationHealthResource.snapshot && now - replicationHealthResource.cachedAt < REPLICATION_HEALTH_CACHE_MS) {
    return Promise.resolve({ available: true, snapshot: replicationHealthResource.snapshot });
  }
  if (replicationHealthResource.inFlight) return replicationHealthResource.inFlight;

  replicationHealthResource.inFlight = api('/api/meta/replication_health', { method: 'GET', cache: 'no-store' })
    .catch(() => new Promise(resolve => setTimeout(resolve, REPLICATION_HEALTH_RETRY_MS))
      .then(() => api('/api/meta/replication_health', { method: 'GET', cache: 'no-store' })))
    .then(snapshot => {
      const valid = snapshot && typeof snapshot === 'object'
        && snapshot.coverage && typeof snapshot.coverage === 'object'
        && snapshot.schedule && typeof snapshot.schedule === 'object'
        && Array.isArray(snapshot.reconciliation)
        && snapshot.exclusions && typeof snapshot.exclusions === 'object';
      if (!valid) return { available: false, snapshot: null };
      replicationHealthResource.snapshot = snapshot;
      replicationHealthResource.cachedAt = Date.now();
      return { available: true, snapshot };
    })
    .catch(() => ({ available: false, snapshot: null }))
    .finally(() => { replicationHealthResource.inFlight = null; });
  return replicationHealthResource.inFlight;
}

function replicationTrustHeader({ surface, classification, stateCopy }) {
  const sequence = ++replicationTrustCardSequence;
  const titleId = `replication-trust-title-${sequence}`;
  const descriptionId = `replication-trust-description-${sequence}`;
  const card = replicationHealthNode('section', `replication-trust-card is-${surface}`);
  card.setAttribute('aria-labelledby', titleId);
  card.setAttribute('aria-describedby', descriptionId);

  const header = replicationHealthNode('header', 'replication-trust-header');
  const copy = replicationHealthNode('div', 'replication-trust-heading');
  copy.append(
    replicationHealthNode('span', 'replication-trust-eyebrow', 'Replication truth & freshness'),
    replicationHealthNode('h2', null, 'Local replica trust'),
  );
  copy.lastElementChild.id = titleId;
  const description = replicationHealthNode('p', null, 'Aggregate replication evidence only. No customer records or identifiers are shown.');
  description.id = descriptionId;
  copy.appendChild(description);

  const known = replicationKnownClassification(classification);
  const status = replicationHealthNode('div', `replication-trust-state is-${replicationHealthClassifications[known].tone}`);
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  status.append(
    replicationHealthNode('strong', null, stateCopy || replicationHealthClassifications[known].label),
    replicationHealthNode('code', null, known),
  );
  header.append(copy, status);
  card.appendChild(header);
  return card;
}

function replicationTrustLoadingCard(surface) {
  const card = replicationTrustHeader({ surface, classification: 'unavailable', stateCopy: 'Loading health…' });
  card.setAttribute('aria-busy', 'true');
  const loading = replicationHealthNode('div', 'replication-trust-loading');
  loading.append(
    replicationHealthNode('span', 'replication-trust-loading-mark'),
    replicationHealthNode('p', null, 'Main CRM content is ready while replication health loads separately.'),
  );
  card.appendChild(loading);
  return card;
}

function replicationTrustUnavailableCard(surface) {
  const card = replicationTrustHeader({ surface, classification: 'unavailable', stateCopy: 'Health unavailable' });
  card.setAttribute('aria-busy', 'false');
  card.appendChild(replicationHealthNode('p', 'replication-trust-unavailable', 'Replication health could not be loaded. Main CRM content remains available and no source data was changed.'));
  return card;
}

function replicationOverviewItem(label, value, note) {
  const item = replicationHealthNode('div', 'replication-trust-overview-item');
  item.append(
    replicationHealthNode('span', null, label),
    replicationHealthNode('strong', null, value),
    replicationHealthNode('small', null, note),
  );
  return item;
}

function replicationRunCard(label, run) {
  const card = replicationHealthNode('article', 'replication-trust-run');
  const stateCode = replicationKnownRunState(run?.status);
  const state = replicationRunStates[stateCode];
  const heading = replicationHealthNode('header');
  heading.append(
    replicationHealthNode('span', null, label),
    replicationHealthNode('code', `is-${state.tone}`, stateCode),
  );
  card.append(
    heading,
    replicationHealthNode('strong', null, replicationSafeTimestamp(run?.finished_at)),
  );
  const total = replicationSafeCount(run?.module_summary?.total);
  const complete = replicationSafeCount(run?.module_summary?.complete);
  const partial = replicationSafeCount(run?.module_summary?.partial);
  const errors = replicationSafeCount(run?.module_summary?.error);
  const note = run
    ? `${complete}/${total} modules complete · ${partial} partial · ${errors} failed`
    : 'No persisted run has been recorded.';
  card.appendChild(replicationHealthNode('small', null, note));
  return card;
}

function replicationDatasetCard(datasetLabel, evidence) {
  const card = replicationHealthNode('article', 'replication-trust-dataset');
  const classification = replicationKnownClassification(evidence?.classification);
  const classificationInfo = replicationHealthClassifications[classification];
  const sourceRecheckAt = replicationSafeTimestamp(evidence?.source_recheck_at);
  const auditAt = replicationSafeTimestamp(evidence?.audit_at);
  const currentSourceCount = replicationSafeCount(evidence?.current_source_count);
  const auditedSourceCount = replicationSafeCount(evidence?.audited_source_count);
  const hasCurrentExactRecheck = classification === 'reconciled_current'
    && evidence?.exact_source_local_parity === true
    && currentSourceCount !== 'Unavailable'
    && !['Not recorded', 'Unavailable'].includes(sourceRecheckAt);
  const sourceLabel = hasCurrentExactRecheck ? 'Current source' : 'Source at audit';
  const sourceCount = hasCurrentExactRecheck ? currentSourceCount : auditedSourceCount;
  const sourceTimestamp = hasCurrentExactRecheck
    ? `Source rechecked ${sourceRecheckAt}`
    : !['Not recorded', 'Unavailable'].includes(auditAt)
      ? `Audit recorded ${auditAt}`
      : 'Audit timestamp unavailable';
  const header = replicationHealthNode('header');
  header.append(
    replicationHealthNode('h3', null, datasetLabel),
    replicationHealthNode('code', `is-${classificationInfo.tone}`, classification),
  );
  const counts = replicationHealthNode('dl', 'replication-trust-counts');
  [
    ['Local', replicationSafeCount(evidence?.current_local_count)],
    [sourceLabel, sourceCount],
  ].forEach(([label, value]) => {
    const count = replicationHealthNode('div');
    count.append(replicationHealthNode('dt', null, label), replicationHealthNode('dd', null, value));
    counts.appendChild(count);
  });
  card.append(header, counts, replicationHealthNode('small', null, sourceTimestamp));
  return card;
}

function replicationDeletionExclusionCopy(deletionReplication, fallback) {
  const coverage = deletionReplication?.coverage;
  const readiness = deletionReplication?.readiness;
  const scheduled = Number(coverage?.scheduled_record_modules);
  const documented = Number(coverage?.documented_deleted_record_modules);
  if (!Number.isSafeInteger(scheduled) || scheduled < 1
      || !Number.isSafeInteger(documented) || documented < 0 || documented > scheduled) return fallback;
  if (readiness?.runtime_executable === true && readiness?.operationally_current === true) {
    return `Deleted-record refresh is active for ${documented}/${scheduled} scheduled modules; unsupported module scope remains explicit.`;
  }
  if (readiness?.runtime_executable === true) {
    return `${documented}/${scheduled} scheduled modules have an enabled deleted-record stream, but current successful window evidence is unavailable.`;
  }
  if (readiness?.engine_implemented === true && readiness?.migration_staged === true) {
    return `${documented}/${scheduled} scheduled modules have a documented Zoho deleted-record stream. The reversible runtime is staged but disabled pending database contract, lease, and exact starting-baseline verification.`;
  }
  return `${documented}/${scheduled} scheduled modules have a documented Zoho deleted-record stream, but deleted records remain outside the active refresh.`;
}

function replicationExclusionsDetails(exclusions, deletionReplication = null) {
  const details = replicationHealthNode('details', 'replication-trust-exclusions');
  details.appendChild(replicationHealthNode('summary', null, 'Explicit exclusions · 6 categories'));
  const list = replicationHealthNode('ul');
  replicationExclusionDefinitions.forEach(([key, label, copy]) => {
    const evidence = exclusions && typeof exclusions[key] === 'object' ? exclusions[key] : null;
    const classification = evidence
      ? replicationKnownClassification(evidence.classification)
      : 'unavailable';
    const item = replicationHealthNode('li');
    const heading = replicationHealthNode('div');
    heading.append(
      replicationHealthNode('strong', null, label),
      replicationHealthNode('code', `is-${replicationHealthClassifications[classification].tone}`, classification),
    );
    const explanation = key === 'deletions'
      ? replicationDeletionExclusionCopy(deletionReplication, copy)
      : copy;
    item.append(heading, replicationHealthNode('span', null, explanation));
    list.appendChild(item);
  });
  details.appendChild(list);
  return details;
}

function replicationTrustAvailableCard(snapshot, surface) {
  const overall = replicationKnownClassification(snapshot.overall_classification);
  const card = replicationTrustHeader({ surface, classification: overall });
  card.setAttribute('aria-busy', 'false');
  const coverage = snapshot.coverage || {};
  const schedule = snapshot.schedule || {};
  const scheduled = replicationSafeCount(coverage.scheduled_record_modules);
  const supported = replicationSafeCount(coverage.api_supported_modules);
  const interval = replicationSafeCount(schedule.interval_minutes);
  const schedulerMode = schedule.scheduler_mode === 'vercel-cron'
    ? 'vercel-cron'
    : schedule.scheduler_mode === 'local-interval'
      ? 'local-interval'
      : 'unknown';
  const externallyScheduled = schedulerMode === 'vercel-cron'
    && schedule.externally_scheduled === true;
  const executionFenced = schedule.execution_fenced === true && schedule.state_available !== false;
  const scheduleState = externallyScheduled && executionFenced
    ? 'Scheduled by Vercel'
    : externallyScheduled
      ? 'Vercel cron configured · sync safety setup pending'
    : schedulerMode === 'vercel-cron'
      ? 'Vercel cron not active'
      : schedule.enabled === true && !executionFenced
        ? 'Local sync safety setup pending'
      : schedule.running === true
        ? 'Running now'
        : schedule.enabled === true && schedule.started === true
          ? 'Scheduled locally'
          : schedule.enabled === true
            ? 'Enabled, not started'
            : schedule.enabled === false ? 'Not enabled' : 'Unavailable';
  const scope = scheduled === 'Unavailable' || supported === 'Unavailable'
    ? 'Unavailable'
    : `${scheduled}/${supported}`;
  const nextRun = replicationSafeTimestamp(schedule.next_run_at);
  const intervalCopy = externallyScheduled
    ? `${interval === 'Unavailable' ? 'Cadence unavailable' : `${interval}-minute production cron`} · best effort, no automatic retry · next window ${nextRun}`
    : `${interval === 'Unavailable' ? 'Interval unavailable' : `${interval}-minute local interval`} · next ${nextRun}`;

  const overview = replicationHealthNode('div', 'replication-trust-overview');
  overview.append(
    replicationOverviewItem('Scheduled scope', scope, 'record modules / API-supported modules'),
    replicationOverviewItem('Refresh schedule', scheduleState, intervalCopy),
    replicationOverviewItem('Evidence generated', replicationSafeTimestamp(snapshot.generated_at), 'Read-only aggregate health payload'),
  );
  card.appendChild(overview);

  const runs = replicationHealthNode('section', 'replication-trust-section');
  runs.setAttribute('aria-label', 'Persisted replication run history');
  runs.appendChild(replicationHealthNode('h3', null, 'Persisted run state'));
  const runGrid = replicationHealthNode('div', 'replication-trust-runs');
  runGrid.append(
    replicationRunCard('Last completed', schedule.last_completed_run),
    replicationRunCard('Last successful', schedule.last_successful_run),
  );
  runs.appendChild(runGrid);
  card.appendChild(runs);

  const evidenceByDataset = new Map();
  snapshot.reconciliation.forEach(item => {
    if (item?.dataset_key === 'Notes' || item?.dataset_key === 'Tasks') evidenceByDataset.set(item.dataset_key, item);
  });
  const reconciliation = replicationHealthNode('section', 'replication-trust-section');
  reconciliation.setAttribute('aria-label', 'Notes and Tasks source reconciliation');
  reconciliation.appendChild(replicationHealthNode('h3', null, 'Exact source reconciliation'));
  const reconciliationGrid = replicationHealthNode('div', 'replication-trust-reconciliation');
  reconciliationGrid.append(
    replicationDatasetCard('Notes', evidenceByDataset.get('Notes')),
    replicationDatasetCard('Tasks', evidenceByDataset.get('Tasks')),
  );
  reconciliation.appendChild(reconciliationGrid);
  card.append(
    reconciliation,
    replicationExclusionsDetails(snapshot.exclusions, snapshot.deletion_replication),
  );
  return card;
}

function mountReplicationHealthCard(container, { surface, request, navigationToken }) {
  const slot = replicationHealthNode('div', `replication-trust-slot is-${surface}`);
  slot.appendChild(replicationTrustLoadingCard(surface));
  container.appendChild(slot);
  request.then(result => {
    if (navigationToken !== state.nav || !slot.isConnected) return;
    const card = result.available
      ? replicationTrustAvailableCard(result.snapshot, surface)
      : replicationTrustUnavailableCard(surface);
    slot.replaceChildren(card);
  });
  return slot;
}
/* Replication truth card end */

function analyticsBarRows(rows, emptyCopy = 'No aggregate records in this cohort.') {
  const list = analyticsNode('div', 'analytics-bars');
  const values = Array.isArray(rows) ? rows : [];
  if (!values.length) {
    list.appendChild(analyticsNode('p', 'analytics-empty', emptyCopy));
    return list;
  }
  const maximum = Math.max(1, ...values.map(row => Number(row.count || 0)));
  values.slice().sort((left, right) => Number(right.count || 0) - Number(left.count || 0)).forEach(row => {
    const item = analyticsNode('div', 'analytics-bar-row');
    const name = analyticsNode('span', 'analytics-bar-label', row.name || 'Missing / no value');
    name.title = row.name || 'Missing / no value';
    const track = analyticsNode('span', 'analytics-bar-track');
    const fill = analyticsNode('span', 'analytics-bar-fill');
    fill.style.width = `${Math.max(Number(row.count || 0) ? 2 : 0, Number(row.count || 0) / maximum * 100)}%`;
    track.appendChild(fill);
    item.append(name, track, analyticsNode('strong', 'analytics-bar-value', analyticsCount(row.count)));
    list.appendChild(item);
  });
  return list;
}

function analyticsPipelineCard(lane) {
  const card = analyticsNode('article', 'analytics-card analytics-pipeline-card');
  const moduleLabels = { Leads: 'Lead status mix', Contacts: 'Qualified opportunity stage mix', Deals: 'Order stage mix' };
  const header = analyticsNode('header', 'analytics-card-head');
  const copy = analyticsNode('div');
  copy.append(
    analyticsNode('span', 'analytics-eyebrow', lane.module === 'Contacts' ? 'Contacts module convention' : lane.module),
    analyticsNode('h2', null, moduleLabels[lane.module] || `${lane.module} stage mix`),
  );
  const total = analyticsNode('strong', 'analytics-card-total', analyticsCount(lane.record_count));
  total.appendChild(analyticsNode('small', null, lane.record_count === null ? '' : ' current records'));
  header.append(copy, total);
  card.appendChild(header);
  if (lane.availability !== 'available') {
    card.appendChild(analyticsNode('p', 'analytics-empty is-unavailable', 'Data Not Available — required mirrored field metadata is incomplete.'));
    return card;
  }
  card.appendChild(analyticsBarRows(lane.current_stage_mix));
  const cohort = analyticsNode('details', 'analytics-cohort');
  const summary = analyticsNode('summary', null, `${analyticsCount(lane.created_in_range_count)} created in the selected range · view current stages`);
  cohort.append(summary, analyticsBarRows(lane.created_in_range_current_stage_mix, 'No records were created in this date range.'));
  card.appendChild(cohort);
  return card;
}

function analyticsActivityChart(rows) {
  const wrap = analyticsNode('div', 'analytics-trend-wrap');
  const series = Array.isArray(rows) ? rows : [];
  const available = series.some(row => row.calls !== null || row.events !== null);
  if (!available) {
    wrap.appendChild(analyticsNode('p', 'analytics-empty is-unavailable', 'Data Not Available — required Call or Event timestamp metadata is incomplete.'));
    return wrap;
  }
  const legend = analyticsNode('div', 'analytics-legend');
  [['calls', 'Calls'], ['events', 'Events / meetings']].forEach(([kind, label]) => {
    const item = analyticsNode('span');
    item.append(analyticsNode('i', kind), analyticsNode('span', null, label));
    legend.appendChild(item);
  });
  const chart = analyticsNode('div', 'analytics-trend');
  const maximum = Math.max(1, ...series.map(row => Number(row.calls || 0) + Number(row.events || 0)));
  const labelEvery = Math.max(1, Math.ceil(series.length / 8));
  series.forEach((row, index) => {
    const column = analyticsNode('div', 'analytics-trend-column');
    const count = Number(row.calls || 0) + Number(row.events || 0);
    column.title = `${row.date}: ${Number(row.calls || 0).toLocaleString('en-IN')} calls · ${Number(row.events || 0).toLocaleString('en-IN')} events`;
    const value = analyticsNode('span', 'analytics-trend-value', count ? count.toLocaleString('en-IN') : '');
    const bar = analyticsNode('span', 'analytics-trend-bar');
    bar.style.height = `${Math.max(count ? 5 : 1, count / maximum * 100)}%`;
    const calls = analyticsNode('i', 'calls');
    const events = analyticsNode('i', 'events');
    const denominator = Math.max(1, count);
    calls.style.height = `${Number(row.calls || 0) / denominator * 100}%`;
    events.style.height = `${Number(row.events || 0) / denominator * 100}%`;
    bar.append(calls, events);
    const day = new Date(row.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    const label = analyticsNode('span', 'analytics-trend-label', index % labelEvery === 0 || index === series.length - 1 ? day : '');
    column.append(value, bar, label);
    chart.appendChild(column);
  });
  wrap.append(legend, chart);
  return wrap;
}

function analyticsQualityCard(quality) {
  const card = analyticsNode('section', 'analytics-card analytics-quality');
  const header = analyticsNode('header', 'analytics-card-head');
  const copy = analyticsNode('div');
  copy.append(analyticsNode('span', 'analytics-eyebrow', 'Trust before totals'), analyticsNode('h2', null, 'Data quality & reconciliation'));
  const badge = analyticsNode('span', `analytics-quality-badge is-${quality?.status || 'warn'}`, String(quality?.status || 'warn').toUpperCase());
  header.append(copy, badge);
  card.appendChild(header);
  const checks = analyticsNode('div', 'analytics-checks');
  (quality?.checks || []).forEach(item => {
    const row = analyticsNode('div', `analytics-check is-${item.status || 'warn'}`);
    const title = String(item.id || 'check').replace(/_/g, ' ').replace(/\b\w/g, character => character.toUpperCase());
    const copyNode = analyticsNode('div');
    copyNode.append(analyticsNode('strong', null, title), analyticsNode('span', null, item.note || ''));
    row.append(analyticsNode('i', null, item.status === 'pass' ? '✓' : item.status === 'fail' ? '!' : '•'), copyNode);
    checks.appendChild(row);
  });
  card.appendChild(checks);
  const metadata = analyticsNode('details', 'analytics-quality-details');
  metadata.appendChild(analyticsNode('summary', null, 'Required metadata coverage'));
  const grid = analyticsNode('div', 'analytics-metadata-grid');
  (quality?.metadata_coverage || []).forEach(item => {
    const row = analyticsNode('div');
    row.append(
      analyticsNode('strong', null, item.module),
      analyticsNode('span', item.available && item.required_fields_available ? 'is-ok' : 'is-missing', item.available && item.required_fields_available ? 'Available' : 'Data Not Available'),
    );
    grid.appendChild(row);
  });
  metadata.appendChild(grid);
  card.appendChild(metadata);
  return card;
}

async function renderAnalytics() {
  const nav = ++state.nav;
  state.current = null;
  setActiveTab('__analytics');
  const content = $('#content');
  content.innerHTML = '<div class="loading">Preparing aggregate CRM analytics…</div>';
  const replicationHealthRequest = requestReplicationHealthSnapshot();
  const range = analyticsRangeFor();
  const query = new URLSearchParams(range);
  try {
    const data = await api(`/api/analytics/overview?${query.toString()}`);
    if (nav !== state.nav) return;
    content.innerHTML = '';
    const page = analyticsNode('div', 'analytics-page');

    const hero = analyticsNode('section', 'analytics-hero');
    const heroCopy = analyticsNode('div', 'analytics-hero-copy');
    heroCopy.append(
      analyticsNode('span', 'analytics-eyebrow', 'Decision-ready CRM intelligence'),
      analyticsNode('h1', null, 'Analytics Command Center'),
      analyticsNode('p', null, 'Executive metrics, pipeline mix, activities, workload, and trust checks from the local read-only CRM replica.'),
    );
    const controls = analyticsNode('div', 'analytics-controls');
    controls.append(analyticsFilterControl(renderAnalytics), analyticsNode('span', 'analytics-range-copy', `${fmtVal(data.date_range.from, { data_type: 'date' })} → ${fmtVal(data.date_range.to, { data_type: 'date' })} · ${data.date_range.days} days`));
    heroCopy.appendChild(controls);
    const trust = analyticsNode('div', 'analytics-trust');
    const freshness = data.source?.freshness || {};
    [
      ['Source', data.source?.name || 'Local CRM replica', 'Aggregate only · no customer rows'],
      ['Freshness', freshness.status === 'fresh' ? 'Fresh' : freshness.status === 'delayed' ? 'Delayed' : 'Unavailable', freshness.snapshot_at ? `Snapshot ${analyticsDateTime(freshness.snapshot_at)}` : 'Snapshot time unavailable'],
      ['Refresh policy', `${freshness.expected_refresh_minutes || 15} minutes`, freshness.age_minutes === null || freshness.age_minutes === undefined ? 'Age unavailable' : `${freshness.age_minutes} min snapshot age`],
      ['Data quality', String(data.data_quality?.status || 'warn').toUpperCase(), 'Reconciled checks shown below'],
    ].forEach(([label, value, note]) => {
      const item = analyticsNode('div');
      item.append(analyticsNode('span', null, label), analyticsNode('strong', null, value), analyticsNode('small', null, note));
      trust.appendChild(item);
    });
    hero.append(heroCopy, trust);
    page.appendChild(hero);
    mountReplicationHealthCard(page, {
      surface: 'analytics', request: replicationHealthRequest, navigationToken: nav,
    });

    const metricGrid = analyticsNode('section', 'analytics-metrics');
    metricGrid.setAttribute('aria-label', 'Executive CRM metrics');
    const metricModules = {
      leads_created: 'Leads', qualified_opportunities_created: 'Contacts', calls_logged: 'Calls',
      events_logged: 'Events', open_tasks: 'Tasks', overdue_tasks: 'Tasks',
    };
    (data.hero_metrics || []).forEach(metric => {
      const module = metricModules[metric.id];
      const card = analyticsNode('button', `analytics-metric${metric.id === 'overdue_tasks' && Number(metric.value || 0) > 0 ? ' is-alert' : ''}`);
      card.type = 'button';
      card.disabled = metric.value === null || !module;
      card.append(
        analyticsNode('span', null, metric.label),
        analyticsNode('strong', metric.value === null ? 'is-unavailable' : null, analyticsCount(metric.value)),
        analyticsNode('small', null, metric.value === null ? 'Required metadata is incomplete' : `${metric.unit} · open ${module}`),
      );
      if (!card.disabled) card.onclick = () => { location.hash = `#/module/${module}`; };
      metricGrid.appendChild(card);
    });
    page.appendChild(metricGrid);

    const sectionHead = (eyebrow, title, copy) => {
      const head = analyticsNode('header', 'analytics-section-head');
      const text = analyticsNode('div');
      text.append(analyticsNode('span', 'analytics-eyebrow', eyebrow), analyticsNode('h2', null, title), analyticsNode('p', null, copy));
      head.appendChild(text);
      return head;
    };

    const comparison = analyticsNode('section', 'analytics-section analytics-comparison');
    comparison.setAttribute('aria-label', 'Period-over-period CRM activity comparison');
    const previousRange = data.date_range?.comparison_period;
    const previousRangeCopy = previousRange
      ? `${fmtVal(previousRange.from, { data_type: 'date' })} → ${fmtVal(previousRange.to, { data_type: 'date' })}`
      : 'Previous period unavailable';
    comparison.appendChild(sectionHead(
      'Period over period',
      'Compared with the previous equal period',
      `Current counts are compared with the immediately preceding ${data.date_range?.days || 0} CRM calendar days (${previousRangeCopy}). Counts only; no conversion, attribution, or stage movement is inferred.`,
    ));
    const comparisonGrid = analyticsNode('div', 'analytics-comparison-grid');
    (data.datasets?.period_comparison || []).forEach(metric => {
      const available = metric.availability === 'available';
      const direction = !available ? 'unavailable' : Number(metric.absolute_change || 0) > 0 ? 'positive' : Number(metric.absolute_change || 0) < 0 ? 'negative' : 'flat';
      const card = analyticsNode('button', `analytics-comparison-card is-${direction}`);
      card.type = 'button';
      card.disabled = !available || !metric.module;
      card.setAttribute('aria-label', available ? `${metric.label}: ${analyticsCount(metric.current_count)} in the current period` : `${metric.label}: Data Not Available`);
      const heading = analyticsNode('span', 'analytics-comparison-label', metric.label);
      const current = analyticsNode('strong', available ? null : 'is-unavailable', available ? analyticsCount(metric.current_count) : 'Data Not Available');
      const prior = analyticsNode('small', null, available ? `Previous period ${analyticsCount(metric.previous_count)}` : 'Required metadata is incomplete');
      const change = analyticsNode('span', `analytics-comparison-change is-${direction}`);
      if (available) {
        change.append(
          analyticsNode('b', null, analyticsSignedCount(metric.absolute_change)),
          analyticsNode('span', null, metric.percentage_change === null ? 'Percentage: Data Not Available' : analyticsSignedPercentage(metric.percentage_change)),
        );
      } else {
        change.appendChild(analyticsNode('span', null, 'Data Not Available'));
      }
      card.append(heading, current, prior, change);
      if (!card.disabled) card.onclick = () => { location.hash = `#/module/${metric.module}`; };
      comparisonGrid.appendChild(card);
    });
    comparison.appendChild(comparisonGrid);
    page.appendChild(comparison);

    const pipeline = analyticsNode('section', 'analytics-section');
    pipeline.appendChild(sectionHead('Commercial health', 'Current pipeline and cohort mix', 'Stage labels are current-state aggregates. No conversion, attribution, or stage movement is inferred.'));
    const pipelineGrid = analyticsNode('div', 'analytics-pipeline-grid');
    (data.datasets?.pipeline_stage_mix || []).forEach(lane => pipelineGrid.appendChild(analyticsPipelineCard(lane)));
    pipeline.appendChild(pipelineGrid);
    page.appendChild(pipeline);

    const activityGrid = analyticsNode('section', 'analytics-two-column');
    const activityCard = analyticsNode('article', 'analytics-card analytics-activity');
    activityCard.appendChild(sectionHead('Engagement', 'Calls and meetings by day', data.date_range?.activity_semantics || 'Activities inside the selected date range.'));
    activityCard.appendChild(analyticsActivityChart(data.datasets?.activity_daily));
    activityGrid.appendChild(activityCard);

    const tasks = data.datasets?.task_summary || {};
    const taskCard = analyticsNode('article', 'analytics-card analytics-tasks');
    taskCard.appendChild(sectionHead('Workload', 'Task health', data.date_range?.task_semantics || 'Current Tasks as of today.'));
    if (tasks.availability !== 'available') {
      taskCard.appendChild(analyticsNode('p', 'analytics-empty is-unavailable', 'Data Not Available — required Task status or due-date metadata is incomplete.'));
    } else {
      const taskStats = analyticsNode('div', 'analytics-task-stats');
      [['Open', tasks.open], ['Completed', tasks.completed], ['Due today', tasks.due_today], ['Overdue', tasks.overdue]].forEach(([label, value]) => {
        const item = analyticsNode('div', label === 'Overdue' && Number(value || 0) > 0 ? 'is-alert' : null);
        item.append(analyticsNode('span', null, label), analyticsNode('strong', null, analyticsCount(value)));
        taskStats.appendChild(item);
      });
      taskCard.append(taskStats, analyticsBarRows(data.datasets?.task_status_mix, 'No Task status aggregates are available.'));
      if (tasks.open_missing_or_malformed_due_date) taskCard.appendChild(analyticsNode('p', 'analytics-warning', `${analyticsCount(tasks.open_missing_or_malformed_due_date)} open Tasks have a missing or malformed due date and cannot be classified as due or overdue.`));
    }
    activityGrid.appendChild(taskCard);
    page.appendChild(activityGrid);

    const inventory = analyticsNode('section', 'analytics-section');
    inventory.appendChild(sectionHead('Source coverage', 'Module inventory', 'Current local record totals and records created inside the selected range.'));
    const inventoryGrid = analyticsNode('div', 'analytics-inventory');
    (data.datasets?.module_inventory || []).forEach(item => {
      const card = analyticsNode('button', 'analytics-inventory-card');
      card.type = 'button';
      card.disabled = item.record_count === null;
      card.append(
        analyticsNode('span', null, item.module),
        analyticsNode('strong', item.record_count === null ? 'is-unavailable' : null, analyticsCount(item.record_count)),
        analyticsNode('small', null, item.created_in_range_count === null ? 'Data Not Available' : `${analyticsCount(item.created_in_range_count)} created in range`),
      );
      if (!card.disabled) card.onclick = () => { location.hash = `#/module/${item.module}`; };
      inventoryGrid.appendChild(card);
    });
    inventory.appendChild(inventoryGrid);
    page.appendChild(inventory);

    page.appendChild(analyticsQualityCard(data.data_quality));

    const notes = analyticsNode('section', 'analytics-card analytics-method');
    notes.appendChild(sectionHead('Method & boundaries', 'What this dashboard does not claim', 'Unsupported metrics remain unavailable until verified relationships, history, and definitions exist.'));
    const caveats = analyticsNode('ul');
    (data.caveats || []).forEach(item => caveats.appendChild(analyticsNode('li', null, item)));
    notes.appendChild(caveats);
    const unsupported = analyticsNode('div', 'analytics-unsupported');
    (data.unsupported_metrics || []).forEach(item => unsupported.appendChild(analyticsNode('span', null, String(item).replace(/_/g, ' '))));
    notes.appendChild(unsupported);
    page.appendChild(notes);

    page.appendChild(analyticsNode('p', 'analytics-foot', `Generated ${analyticsDateTime(data.generated_at)} · ${data.source?.query_mode || 'local-read-only'} · aggregate-only output`));
    content.appendChild(page);
  } catch (error) {
    if (nav !== state.nav) return;
    content.innerHTML = '';
    const failure = analyticsNode('div', 'analytics-failure');
    failure.append(analyticsNode('h2', null, 'Analytics unavailable'), analyticsNode('p', null, 'The aggregate analytics request could not be completed. No CRM data was changed.'), analyticsFilterControl(renderAnalytics));
    mountReplicationHealthCard(failure, {
      surface: 'analytics', request: replicationHealthRequest, navigationToken: nav,
    });
    content.appendChild(failure);
  }
}

/* ---------- dashboard ---------- */
function barRows(rows, labelKey, onClick) {
  const max = Math.max(1, ...rows.map(r => r.cnt));
  const box = el('div', 'brs');
  rows.forEach(r => {
    const label = r[labelKey] == null ? '(none)' : r[labelKey];
    const row = el('div', 'br');
    row.appendChild(el('div', 'brl', esc(label)));
    const track = el('div', 'brt');
    const fill = el('div', 'brf');
    fill.style.width = Math.max(1.5, r.cnt / max * 100) + '%';
    track.appendChild(fill);
    row.appendChild(track);
    row.appendChild(el('div', 'brv', r.cnt.toLocaleString('en-IN')));
    row.title = `${label}: ${r.cnt.toLocaleString('en-IN')}`;
    if (onClick) { row.style.cursor = 'pointer'; row.onclick = () => onClick(r); }
    box.appendChild(row);
  });
  return box;
}

const journeyText = (tag, cls, value) => {
  const node = el(tag, cls);
  node.textContent = String(value ?? '');
  return node;
};

function formatJourneyCr(valueLacs) {
  const lacs = Number(valueLacs || 0);
  return `₹${(Number.isFinite(lacs) ? lacs / 100 : 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}Cr`;
}

function journeyTimestamp(value) {
  const date = new Date(value || '');
  if (!Number.isFinite(date.getTime())) return 'Snapshot time unavailable';
  return date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function journeyFreshness(value) {
  const date = new Date(value || '');
  if (!Number.isFinite(date.getTime())) return 'Freshness unavailable';
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 2) return 'Updated just now';
  if (minutes < 60) return `Updated ${minutes.toLocaleString('en-IN')} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `Updated ${hours.toLocaleString('en-IN')} hours ago`;
  return `Updated ${Math.round(hours / 24).toLocaleString('en-IN')} days ago`;
}

function journeyCohortLabel(journey) {
  const cohort = journey?.cohort;
  if (cohort?.kind !== 'created_in_range') return 'All locally replicated records';
  return `Records created ${fmtVal(cohort.from, { data_type: 'date' })} → ${fmtVal(cohort.to, { data_type: 'date' })}`;
}

function closeJourneyDrilldown(modal, restoreFocus) {
  modal.classList.add('hidden');
  modal.removeAttribute('role');
  modal.removeAttribute('aria-modal');
  modal.removeAttribute('aria-labelledby');
  if (restoreFocus && document.contains(restoreFocus)) restoreFocus.focus();
}

let activeJourneyDialogClose = null;
async function openJourneyDrilldown(lane, stage, page = 1, restoreFocus = document.activeElement) {
  if (!stage?.count) return;
  const modal = $('#modal'), box = $('#modalBox');
  if (activeJourneyDialogClose) activeJourneyDialogClose(false);
  if (activeReviseQuotePreviewClose) activeReviseQuotePreviewClose(false);
  if (activeReviseApproveAnyStagePreviewClose) activeReviseApproveAnyStagePreviewClose(false);
  if (activeClosureNewPreviewClose) activeClosureNewPreviewClose(false);
  box.innerHTML = '';
  const titleId = `journey-drill-title-${Date.now()}`;
  const header = el('div', 'mh journey-drill-head');
  const headingWrap = el('div', 'journey-drill-heading');
  const eyebrow = journeyText('span', 'journey-drill-eyebrow', `${lane.module}.${lane.field} · exact current value`);
  const heading = journeyText('h2', null, stage.label);
  heading.id = titleId;
  headingWrap.append(eyebrow, heading);
  const close = journeyText('button', 'x journey-drill-close', '✕');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close contributing records');
  let keyHandler = null;
  const shut = (returnFocus = true) => {
    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    if (activeJourneyDialogClose === shut) activeJourneyDialogClose = null;
    closeJourneyDrilldown(modal, returnFocus ? restoreFocus : null);
  };
  activeJourneyDialogClose = shut;
  close.onclick = shut;
  header.append(headingWrap, close);
  const body = el('div', 'mb journey-drill-body');
  body.appendChild(journeyText('div', 'journey-drill-loading', 'Loading contributing local records…'));
  box.append(header, body);
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', titleId);
  modal.classList.remove('hidden');
  close.focus();

  keyHandler = event => {
    if (event.key === 'Escape' && !modal.classList.contains('hidden')) {
      shut();
    }
  };
  document.addEventListener('keydown', keyHandler);

  const query = new URLSearchParams({ page: String(page), per_page: '50' });
  if (stage.missing) query.set('missing', '1');
  else (stage.raw_values || []).forEach(value => query.append('value', value));
  if (state.dateFilter.from && state.dateFilter.to) {
    query.set('from', state.dateFilter.from);
    query.set('to', state.dateFilter.to);
  }

  try {
    const result = await api(`/api/dashboard/journey/records/${encodeURIComponent(lane.key)}?${query.toString()}`);
    if (modal.classList.contains('hidden') || modal.getAttribute('aria-labelledby') !== titleId) return;
    body.innerHTML = '';
    const summary = el('div', 'journey-drill-summary');
    const count = Number(result.info?.total || 0);
    summary.append(
      journeyText('strong', null, `${count.toLocaleString('en-IN')} contributing ${count === 1 ? 'record' : 'records'}`),
      journeyText('span', null, journeyCohortLabel({ cohort: result.range ? { kind: 'created_in_range', ...result.range } : { kind: 'all_records' } })),
    );
    body.appendChild(summary);

    const rows = Array.isArray(result.data) ? result.data : [];
    if (!rows.length) {
      body.appendChild(journeyText('div', 'journey-drill-empty', 'No records remain in this exact local-data match. Refresh the Home dashboard to update the count.'));
    } else {
      const scroll = el('div', 'journey-drill-scroll');
      const table = el('table', 'grid mini journey-drill-table');
      const columns = lane.key === 'opportunities'
        ? ['Record', 'Current Stage', '₹Cr', 'Owner', 'Created', 'Updated', '']
        : ['Record', 'Current Status', 'Owner', 'Created', 'Updated', ''];
      const thead = el('thead');
      const headRow = el('tr');
      columns.forEach(label => headRow.appendChild(journeyText('th', null, label)));
      thead.appendChild(headRow);
      const tbody = el('tbody');
      rows.forEach(record => {
        const row = el('tr');
        row.appendChild(journeyText('td', 'journey-record-name', record.record_name || '(unnamed record)'));
        row.appendChild(journeyText('td', null, record.source_value || 'Missing / no value'));
        if (lane.key === 'opportunities') row.appendChild(journeyText('td', 'journey-record-value', record.value_lacs == null ? '—' : formatJourneyCr(record.value_lacs)));
        row.appendChild(journeyText('td', null, record.owner || '—'));
        row.appendChild(journeyText('td', null, fmtVal(record.created_time, { data_type: 'datetime' })));
        row.appendChild(journeyText('td', null, fmtVal(record.modified_time, { data_type: 'datetime' })));
        const actionCell = el('td');
        const open = journeyText('button', 'journey-record-open', 'Open');
        open.type = 'button';
        open.setAttribute('aria-label', `Open ${record.record_name || 'record'}`);
        open.onclick = () => {
          shut(false);
          location.hash = `#/record/${lane.module}/${record.id}`;
        };
        actionCell.appendChild(open);
        row.appendChild(actionCell);
        tbody.appendChild(row);
      });
      table.append(thead, tbody);
      scroll.appendChild(table);
      body.appendChild(scroll);
    }

    if (page > 1 || result.info?.more_records) {
      const pager = el('div', 'journey-drill-pager');
      const previous = journeyText('button', null, '← Previous');
      previous.type = 'button';
      previous.disabled = page <= 1;
      previous.onclick = () => openJourneyDrilldown(lane, stage, page - 1, restoreFocus);
      const pageLabel = journeyText('span', null, `Page ${page.toLocaleString('en-IN')}`);
      const next = journeyText('button', null, 'Next →');
      next.type = 'button';
      next.disabled = !result.info?.more_records;
      next.onclick = () => openJourneyDrilldown(lane, stage, page + 1, restoreFocus);
      pager.append(previous, pageLabel, next);
      body.appendChild(pager);
    }
  } catch (error) {
    if (modal.getAttribute('aria-labelledby') !== titleId) return;
    body.innerHTML = '';
    body.appendChild(journeyText('div', 'journey-drill-empty', 'Contributing records are temporarily unavailable. Close this panel and try again.'));
  }
}

function renderJourneyLane(lane, rebuild) {
  const section = el('section', `journey-lane journey-lane-${lane.key}`);
  section.id = `journey-${lane.key}`;
  const header = el('header', 'journey-lane-header');
  const copy = el('div', 'journey-lane-copy');
  copy.append(
    journeyText('span', 'journey-eyebrow', lane.key === 'leads' ? 'Lane 01 · Leads' : 'Lane 02 · Qualified opportunities'),
    journeyText('h2', null, lane.title),
    journeyText('p', null, lane.key === 'leads'
      ? 'Every active Lead_Status option follows the configured CRM picklist order.'
      : 'Every active Contacts.Stage option follows the configured CRM picklist order. Opportunity value uses Total_Opportunity_Value in ₹ lacs.'),
  );
  const tools = el('div', 'journey-lane-tools');
  const stats = el('div', 'journey-lane-stats');
  [
    [lane.configured_count, 'Configured labels'],
    [lane.configured_observed_count, 'Populated configured'],
    [lane.record_count, 'Counted records'],
  ].forEach(([value, label]) => {
    const stat = el('div');
    stat.append(journeyText('strong', null, Number(value || 0).toLocaleString('en-IN')), journeyText('span', null, label));
    stats.appendChild(stat);
  });
  tools.appendChild(stats);
  if (lane.empty_count > 0) {
    const toggle = journeyText('button', 'journey-toggle', state.journeyShowAll[lane.key]
      ? 'Show populated stages only'
      : `Show all configured stages · ${Number(lane.empty_count).toLocaleString('en-IN')} empty`);
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', String(Boolean(state.journeyShowAll[lane.key])));
    toggle.onclick = () => {
      state.journeyShowAll[lane.key] = !state.journeyShowAll[lane.key];
      rebuild();
    };
    tools.appendChild(toggle);
  }
  header.append(copy, tools);
  section.appendChild(header);

  const phaseList = el('div', 'journey-phases');
  const showAll = Boolean(state.journeyShowAll[lane.key]);
  (lane.phases || []).forEach((phase, phaseIndex) => {
    const article = el('article', `journey-phase${phase.kind === 'legacy' ? ' journey-phase-legacy' : ''}`);
    const phaseHeader = el('header', 'journey-phase-header');
    phaseHeader.appendChild(journeyText('span', 'journey-phase-index', String(phaseIndex + 1).padStart(2, '0')));
    const phaseCopy = el('div');
    phaseCopy.append(journeyText('h3', null, phase.title), journeyText('p', null, phase.description));
    const phaseCount = lane.key === 'opportunities'
      ? `${formatJourneyCr(phase.value_lacs)} (${Number(phase.count || 0).toLocaleString('en-IN')})`
      : `${Number(phase.count || 0).toLocaleString('en-IN')} ${Number(phase.count || 0) === 1 ? 'record' : 'records'}`;
    phaseHeader.append(phaseCopy, journeyText('span', 'journey-phase-total', phaseCount));
    article.appendChild(phaseHeader);

    const visibleStages = (phase.stages || []).filter(stage => showAll || stage.count > 0 || phase.kind === 'legacy');
    if (!visibleStages.length) {
      article.appendChild(journeyText('p', 'journey-phase-empty', 'No populated stages in the current cohort. Use “Show all configured stages” to review the complete picklist.'));
    } else {
      const grid = el('div', 'journey-stage-grid');
      visibleStages.forEach(stage => {
        const card = el('button', `journey-stage-card${stage.count ? ' is-active' : ' is-empty'}${stage.kind !== 'configured' ? ' is-legacy' : ''}`);
        card.type = 'button';
        card.disabled = !stage.count;
        card.setAttribute('aria-label', stage.count
          ? `${stage.label}: ${Number(stage.count).toLocaleString('en-IN')} contributing records. Open records.`
          : `${stage.label}: no records in the current cohort.`);
        const sequence = stage.kind === 'configured'
          ? `${lane.key === 'leads' ? 'L' : 'O'}${String(stage.sequence).padStart(2, '0')}`
          : (stage.missing ? 'Missing' : 'Legacy');
        card.append(journeyText('span', 'journey-stage-sequence', sequence), journeyText('span', 'journey-stage-label', stage.label));
        const measure = el('span', 'journey-stage-measure');
        if (lane.key === 'opportunities') {
          measure.append(
            journeyText('strong', null, formatJourneyCr(stage.value_lacs)),
            journeyText('small', null, `(${Number(stage.count || 0).toLocaleString('en-IN')})`),
          );
        } else {
          measure.append(
            journeyText('strong', null, Number(stage.count || 0).toLocaleString('en-IN')),
            journeyText('small', null, Number(stage.count || 0) === 1 ? 'lead' : 'leads'),
          );
        }
        card.appendChild(measure);
        if (stage.count) card.appendChild(journeyText('span', 'journey-stage-open', 'Open contributing records →'));
        card.onclick = () => openJourneyDrilldown(lane, stage, 1, card);
        grid.appendChild(card);
      });
      article.appendChild(grid);
    }
    phaseList.appendChild(article);
  });
  section.appendChild(phaseList);
  return section;
}

function renderJourneyDashboard(journey, rebuild) {
  const root = el('div', 'journey-home');
  if (!journey?.lanes?.leads || !journey?.lanes?.opportunities) {
    root.appendChild(journeyText('div', 'journey-unavailable', 'CRM Journey data is being recomputed from the current local database.'));
    return root;
  }
  const leads = journey.lanes.leads;
  const opportunities = journey.lanes.opportunities;
  const hero = el('section', 'journey-hero');
  hero.setAttribute('aria-labelledby', 'journey-home-title');
  const heroCopy = el('div', 'journey-hero-copy');
  const title = journeyText('h1', null, 'CRM Journey Home');
  title.id = 'journey-home-title';
  heroCopy.append(
    journeyText('span', 'journey-hero-eyebrow', 'Lead-to-qualified-opportunity journey'),
    title,
    journeyText('p', null, 'A current-state map of the complete Lead_Status and Contacts.Stage inventories, recomputed from this local CRM database.'),
  );
  const sourceMeta = el('div', 'journey-source-meta');
  sourceMeta.append(
    journeyText('span', 'journey-source-live', journey.source?.database || 'Local CRM replica'),
    journeyText('span', null, `Source snapshot · ${journeyTimestamp(journey.source?.snapshot_at)}`),
    journeyText('span', null, journeyFreshness(journey.source?.snapshot_at)),
    journeyText('span', null, journeyCohortLabel(journey)),
  );
  heroCopy.appendChild(sourceMeta);
  const heroNav = el('nav', 'journey-hero-nav');
  heroNav.setAttribute('aria-label', 'Jump to CRM Journey lane');
  [['#journey-leads', 'Lead statuses'], ['#journey-opportunities', 'Qualified opportunity stages']].forEach(([href, label]) => {
    const link = journeyText('a', null, label);
    link.href = href;
    heroNav.appendChild(link);
  });
  heroCopy.appendChild(heroNav);
  const heroStats = el('div', 'journey-hero-stats');
  [
    [leads.configured_count, 'Lead Status options', `${Number(leads.record_count).toLocaleString('en-IN')} current cohort records`],
    [opportunities.configured_count, 'Contacts.Stage options', `${Number(opportunities.record_count).toLocaleString('en-IN')} qualified opportunities`],
    [formatJourneyCr(opportunities.value_lacs), 'Qualified opportunity value', `${Number(opportunities.value_count).toLocaleString('en-IN')} records with value · ₹Cr (count)`],
  ].forEach(([value, label, note]) => {
    const stat = el('div');
    stat.append(journeyText('span', null, label), journeyText('strong', null, value), journeyText('small', null, note));
    heroStats.appendChild(stat);
  });
  hero.append(heroCopy, heroStats);
  root.appendChild(hero);

  const bridge = el('section', 'journey-bridge');
  bridge.setAttribute('aria-label', 'Lead to qualified opportunity bridge');
  const bridgeItems = [
    ['01', 'Lead population', journey.bridge?.lead_records, 'Leads · current Lead_Status'],
    ['02', 'Qualification / handoff status', journey.bridge?.leads_in_handoff_statuses, 'Current lead states only'],
    ['03', 'Qualified opportunities', journey.bridge?.qualified_opportunity_records, 'Contacts · current Stage'],
  ];
  bridgeItems.forEach(([sequence, label, value, note], index) => {
    const item = el('div', `journey-bridge-item bridge-${index + 1}`);
    item.appendChild(journeyText('span', null, sequence));
    const itemCopy = el('div');
    itemCopy.append(journeyText('strong', null, label), journeyText('b', null, Number(value || 0).toLocaleString('en-IN')), journeyText('small', null, note));
    item.appendChild(itemCopy);
    bridge.appendChild(item);
    if (index < bridgeItems.length - 1) bridge.appendChild(journeyText('i', 'journey-bridge-arrow', '→'));
  });
  const bridgeCaveat = journeyText('p', 'journey-bridge-caveat', 'Current-state aggregates only. Lead-to-opportunity record linkage is not retained, so this bridge does not claim conversion.');
  bridge.appendChild(bridgeCaveat);
  root.appendChild(bridge);

  root.appendChild(renderJourneyLane(leads, rebuild));
  const divider = el('div', 'journey-handoff-divider');
  divider.setAttribute('role', 'separator');
  divider.append(journeyText('span', null, ''), journeyText('strong', null, 'Lead qualification / opportunity ownership boundary'), journeyText('span', null, ''));
  root.appendChild(divider);
  root.appendChild(renderJourneyLane(opportunities, rebuild));

  const method = el('section', 'journey-method');
  const methodTitle = el('div');
  methodTitle.append(journeyText('span', 'journey-eyebrow', 'Reading this view'), journeyText('h2', null, 'Current state within a creation-date cohort'));
  const caveat = journeyText('p', null, journey.caveat);
  if (opportunities.invalid_value_count) {
    caveat.appendChild(document.createTextNode(` ${Number(opportunities.invalid_value_count).toLocaleString('en-IN')} opportunity value entries could not be parsed and contribute ₹0 to value totals.`));
  }
  method.append(methodTitle, caveat);
  root.appendChild(method);
  return root;
}

function homeDashboardRefreshButton() {
  const button = journeyText('button', 'home-dashboard-refresh', 'Refresh');
  button.type = 'button';
  button.setAttribute('aria-label', 'Refresh Home dashboard');
  button.onclick = () => renderDashboard();
  return button;
}

function homeDashboardNotice(kind, hasCachedView = false) {
  const failed = kind === 'error';
  const notice = el('div', `home-dashboard-notice is-${failed ? 'error' : 'loading'}`);
  notice.setAttribute('role', failed ? 'alert' : 'status');
  notice.setAttribute('aria-live', failed ? 'assertive' : 'polite');
  notice.setAttribute('aria-atomic', 'true');

  const mark = el('span', 'home-dashboard-notice-mark');
  mark.setAttribute('aria-hidden', 'true');
  const copy = el('div', 'home-dashboard-notice-copy');
  if (failed && hasCachedView) {
    copy.append(
      journeyText('strong', null, 'Current refresh unavailable'),
      journeyText('p', null, 'The saved dashboard remains available. CRM data was not changed.'),
    );
  } else if (failed) {
    copy.append(
      journeyText('strong', null, 'Home dashboard temporarily unavailable'),
      journeyText('p', null, 'CRM data was not changed. Check your connection and try again.'),
    );
  } else if (hasCachedView) {
    copy.append(
      journeyText('strong', null, 'Refreshing current data'),
      journeyText('p', null, 'Showing the saved dashboard while a current snapshot loads.'),
    );
  } else {
    copy.append(
      journeyText('strong', null, 'Preparing your Home dashboard'),
      journeyText('p', null, 'The dashboard shell is ready while current CRM aggregates load.'),
    );
  }
  notice.append(mark, copy);
  if (failed) {
    const retry = journeyText('button', 'home-dashboard-retry', 'Try again');
    retry.type = 'button';
    retry.onclick = () => renderDashboard();
    notice.appendChild(retry);
  }
  return notice;
}

function placeHomeDashboardNotice(container, kind, hasCachedView = false) {
  const notice = homeDashboardNotice(kind, hasCachedView);
  const existing = container.querySelector('.home-dashboard-notice');
  if (existing) {
    existing.replaceWith(notice);
    return notice;
  }
  const wrap = container.querySelector('.dashwrap');
  if (!wrap) return null;
  const filter = wrap.querySelector('.filterrow');
  wrap.insertBefore(notice, filter?.nextSibling || wrap.firstChild);
  return notice;
}

function clearHomeDashboardNotice(container) {
  container.querySelector('.home-dashboard-notice')?.remove();
}

function renderHomeDashboardShell(container, replicationHealthRequest, nav) {
  const wrap = el('div', 'dashwrap home-dashboard-shell');
  wrap.setAttribute('aria-busy', 'true');

  const filter = el('div', 'filterrow');
  filter.append(mkDateFilter(() => renderDashboard()), homeDashboardRefreshButton());
  wrap.append(filter, homeDashboardNotice('loading'));

  mountReplicationHealthCard(wrap, {
    surface: 'home', request: replicationHealthRequest, navigationToken: nav,
  });

  const journey = el('section', 'journey-home home-dashboard-skeleton');
  journey.setAttribute('aria-label', 'CRM Journey Home loading');
  const hero = el('div', 'journey-hero home-dashboard-skeleton-hero');
  const heroCopy = el('div', 'journey-hero-copy');
  heroCopy.append(
    journeyText('span', 'journey-hero-eyebrow', 'Lead-to-qualified-opportunity journey'),
    journeyText('h1', null, 'CRM Journey Home'),
    journeyText('p', null, 'Current Lead and qualified-opportunity status insights will appear here.'),
  );
  const heroStats = el('div', 'journey-hero-stats home-dashboard-skeleton-stats');
  ['Lead Status options', 'Qualified opportunity stages', 'Qualified opportunity value'].forEach(label => {
    const item = el('div');
    item.append(journeyText('span', null, label), journeyText('strong', 'home-dashboard-skeleton-value', '—'));
    heroStats.appendChild(item);
  });
  hero.append(heroCopy, heroStats);
  journey.appendChild(hero);
  wrap.appendChild(journey);

  const tiles = el('div', 'tiles home-dashboard-skeleton-tiles');
  ['Leads today', 'Leads this month', 'Total raw leads', 'Total orders', 'Calls today', 'Open tasks'].forEach(label => {
    const tile = el('div', 'tile home-dashboard-skeleton-tile');
    tile.append(journeyText('div', 'tv home-dashboard-skeleton-value', '—'), journeyText('div', 'tl', label));
    tiles.appendChild(tile);
  });
  wrap.appendChild(tiles);

  const cards = el('div', 'dashgrid home-dashboard-skeleton-cards');
  ['Lead trend', 'Raw Leads by Status'].forEach(titleText => {
    const card = el('div', 'card home-dashboard-skeleton-card');
    card.appendChild(journeyText('h2', null, titleText));
    const lines = el('div', 'home-dashboard-skeleton-lines');
    for (let index = 0; index < 4; index += 1) lines.appendChild(el('span'));
    card.appendChild(lines);
    cards.appendChild(card);
  });
  wrap.appendChild(cards);
  container.replaceChildren(wrap);
}

async function renderDashboard() {
  const nav = ++state.nav;
  state.current = null;
  setActiveTab('__home');
  const c = $('#content');
  const replicationHealthRequest = requestReplicationHealthSnapshot();
  const dkey = 'dash-v2|' + dateParams();
  let painted = false;
  const build = d => {
    if (nav !== state.nav) return;
    c.innerHTML = '';
    const wrap = el('div', 'dashwrap');

    // date filter row
    const frow = el('div', 'filterrow');
    frow.appendChild(mkDateFilter(() => renderDashboard()));
    if (d.ranged) frow.appendChild(el('span', 'frlabel', `Showing ${esc(fmtVal(d.range.from, { data_type: 'date' }))} → ${esc(fmtVal(d.range.to, { data_type: 'date' }))}`));
    frow.appendChild(homeDashboardRefreshButton());
    wrap.appendChild(frow);

    mountReplicationHealthCard(wrap, {
      surface: 'home', request: replicationHealthRequest, navigationToken: nav,
    });

    // Modern CRM Journey Home; the existing operational dashboard remains below.
    wrap.appendChild(renderJourneyDashboard(d.journey, () => build(d)));

    // KPI tiles
    const k = d.kpis || {};
    const tiles = d.ranged ? [
      ['Leads Created', k.rangeLeads, '#/module/Leads'],
      ['Qualified Leads Created', k.rangeContacts, '#/module/Contacts'],
      ['Orders Created', k.rangeDeals, '#/module/Deals'],
      ['Calls', k.rangeCalls, '#/module/Calls'],
      ['Meetings', k.rangeMeetings, '#/module/Events'],
      ['Total Raw Leads', k.totalLeads, '#/module/Leads'],
      ['Total Orders', k.totalDeals, '#/module/Deals'],
      ['Open Tasks', k.tasksOpen, '#/module/Tasks'],
      ['Tasks Due Today', k.tasksDueToday, '#/module/Tasks'],
      ['Overdue Tasks', k.tasksOverdue, '#/module/Tasks', 'alert'],
    ] : [
      ['Leads Today', k.leadsToday, '#/module/Leads'],
      ['Leads This Month', k.leadsMonth, '#/module/Leads'],
      ['Total Raw Leads', k.totalLeads, '#/module/Leads'],
      ['Total Orders', k.totalDeals, '#/module/Deals'],
      ['Calls Today', k.callsToday, '#/module/Calls'],
      ['Calls (7 days)', k.callsWeek, '#/module/Calls'],
      ['Meetings Today', k.meetingsToday, '#/module/Events'],
      ['Open Tasks', k.tasksOpen, '#/module/Tasks'],
      ['Tasks Due Today', k.tasksDueToday, '#/module/Tasks'],
      ['Overdue Tasks', k.tasksOverdue, '#/module/Tasks', 'alert'],
    ];
    const trow = el('div', 'tiles');
    tiles.forEach(([label, val, href, kind]) => {
      const t = el('div', 'tile' + (kind === 'alert' && val > 0 ? ' alert' : ''));
      t.appendChild(el('div', 'tv', Number(val ?? 0).toLocaleString('en-IN')));
      t.appendChild(el('div', 'tl', esc(label)));
      t.onclick = () => location.hash = href;
      trow.appendChild(t);
    });
    wrap.appendChild(trow);

    // trend columns
    const trendCard = el('div', 'card');
    const monthly = d.ranged && !d.range.daily;
    trendCard.appendChild(el('h2', null, d.ranged ? `New Leads — ${monthly ? 'by month' : 'by day'} in range` : 'New Leads — last 14 days'));
    const days = Object.entries(d.trend || {});
    const tmax = Math.max(1, ...days.map(([, v]) => v));
    const cols = el('div', 'cols');
    days.forEach(([day, v]) => {
      const cw = el('div', 'colw');
      const lbl = monthly
        ? new Date(day + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
        : new Date(day + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      cw.title = `${lbl}: ${v} leads`;
      const bar = el('div', 'colb');
      bar.style.height = Math.max(2, v / tmax * 100) + '%';
      cw.appendChild(el('div', 'colv', v || ''));
      cw.appendChild(bar);
      cw.appendChild(el('div', 'coll', monthly ? lbl : new Date(day + 'T00:00:00').getDate()));
      cols.appendChild(cw);
    });
    trendCard.appendChild(cols);
    wrap.appendChild(trendCard);

    // charts grid
    const grid = el('div', 'dashgrid');
    const mkCard = (title, rows, labelKey, moduleHref) => {
      const card = el('div', 'card');
      card.appendChild(el('h2', null, title));
      const sorted = (Array.isArray(rows) ? rows : []).slice().sort((a, b) => b.cnt - a.cnt);
      card.appendChild(barRows(sorted, labelKey, moduleHref ? () => location.hash = moduleHref : null));
      return card;
    };
    const sfx = d.ranged ? '(in range)' : '(all time)';
    grid.appendChild(mkCard(`Raw Leads by Status ${sfx}`, d.leadsByStatus, 'Lead_Status', '#/module/Leads'));
    grid.appendChild(mkCard(`Qualified Leads by Status ${sfx}`, d.contactsByStatus, 'Status', '#/module/Contacts'));
    wrap.appendChild(grid);

    const ordersCard = mkCard(`Orders by Stage ${sfx}`, d.dealsByStage, 'Stage', '#/module/Deals');
    wrap.appendChild(ordersCard);

    const grid2 = el('div', 'dashgrid');
    grid2.appendChild(mkCard(d.ranged ? 'Leads by Source (in range)' : 'Leads by Source (this month)', d.leadsBySource, 'Lead_Source', '#/module/Leads'));
    grid2.appendChild(mkCard('Open Tasks by Status', d.tasksOpen, 'Status', '#/module/Tasks'));
    wrap.appendChild(grid2);

    // recent tables
    const rgrid = el('div', 'dashgrid');
    const mkRecent = (title, rows, cols2, mod) => {
      const card = el('div', 'card');
      card.appendChild(el('h2', null, title));
      const tb = el('table', 'grid mini');
      tb.innerHTML = '<thead><tr>' + cols2.map(x => `<th>${esc(x[1])}</th>`).join('') + '</tr></thead>';
      const body = el('tbody');
      (Array.isArray(rows) ? rows : []).forEach(r => {
        const tr = el('tr');
        cols2.forEach(([key], i) => {
          const td = el('td', i === 0 ? 'link' : '', esc(fmtVal(r[key], key.includes('Time') ? { data_type: 'datetime' } : null)));
          if (i === 0) td.onclick = () => location.hash = `#/record/${mod}/${r.id}`;
          tr.appendChild(td);
        });
        body.appendChild(tr);
      });
      tb.appendChild(body);
      card.appendChild(tb);
      return card;
    };
    rgrid.appendChild(mkRecent('Latest Raw Leads', d.recentLeads, [['Full_Name','Name'],['Lead_Status','Status'],['Lead_Source','Source'],['Mobile','Mobile'],['Created_Time','Created']], 'Leads'));
    rgrid.appendChild(mkRecent('Recently Updated Orders', d.recentDeals, [['Deal_Name','Order'],['Stage','Stage'],['Owner','Owner'],['Modified_Time','Updated']], 'Deals'));
    wrap.appendChild(rgrid);

    // today + overdue tasks
    const taskCard = el('div', 'card');
    taskCard.appendChild(el('h2', null, `Today & Overdue Tasks <span class="hint">(due on or before today, not completed — oldest first)</span>`));
    const tl = Array.isArray(d.taskList) ? d.taskList : [];
    if (!tl.length) taskCard.appendChild(el('div', 'loading', 'Nothing due — all clear 🎉'));
    else {
      const tb = el('table', 'grid mini');
      tb.innerHTML = '<thead><tr><th>Subject</th><th>Due</th><th>Priority</th><th>Status</th><th>Owner</th></tr></thead>';
      const body = el('tbody');
      tl.forEach(r => {
        const overdue = r.Due_Date && r.Due_Date < d.today;
        const tr = el('tr');
        const tds = el('td', 'link', esc(r.Subject || '(no subject)'));
        tds.onclick = () => location.hash = `#/record/Tasks/${r.id}`;
        tr.appendChild(tds);
        tr.appendChild(el('td', null, `<span class="${overdue ? 'due-over' : 'due-today'}">${esc(fmtVal(r.Due_Date, { data_type: 'date' }))}${overdue ? ' · overdue' : ' · today'}</span>`));
        tr.appendChild(el('td', null, esc(r.Priority || '—')));
        tr.appendChild(el('td', null, esc(r.Status || '—')));
        tr.appendChild(el('td', null, esc(fmtVal(r.Owner))));
        body.appendChild(tr);
      });
      tb.appendChild(body);
      taskCard.appendChild(tb);
      if ((d.kpis.tasksDueToday + d.kpis.tasksOverdue) > tl.length)
        taskCard.appendChild(el('div', 'dashfoot', `Showing oldest ${tl.length} of ${(d.kpis.tasksDueToday + d.kpis.tasksOverdue).toLocaleString('en-IN')} — open the Tasks tab for all`));
    }
    wrap.appendChild(taskCard);

    wrap.appendChild(el('div', 'dashfoot', state.snapshotOnly
      ? 'Last synced local snapshot · rendered ' + new Date(d.generated_at).toLocaleTimeString('en-IN') + ' · external sync paused'
      : 'MAGPPIE database · computed ' + new Date(d.generated_at).toLocaleTimeString('en-IN') + ' · refreshes every 60s'));
    c.appendChild(wrap);
  };

  let cached = swr.bundle.get(dkey);
  if (!cached) { try { cached = JSON.parse(sessionStorage.getItem(dkey) || 'null'); } catch (e) {} }
  if (cached) { try { build(cached); painted = true; } catch (e) {} }
  if (painted) placeHomeDashboardNotice(c, 'loading', true);
  else renderHomeDashboardShell(c, replicationHealthRequest, nav);
  try {
    const d = await api('/api/dashboard?x=1' + dateParams());
    swr.bundle.set(dkey, d);
    try { sessionStorage.setItem(dkey, JSON.stringify(d)); } catch (e) {}
    if (nav !== state.nav) return;
    if (!painted || JSON.stringify(d.kpis) !== JSON.stringify(cached?.kpis) || JSON.stringify(d.trend) !== JSON.stringify(cached?.trend) || JSON.stringify(d.journey) !== JSON.stringify(cached?.journey)) build(d);
    else clearHomeDashboardNotice(c);
  } catch (e) {
    if (nav !== state.nav) return;
    placeHomeDashboardNotice(c, 'error', painted);
  }
}

/* ---------- metadata helpers ---------- */
async function getFields(mod) {
  if (!state.fields[mod]) state.fields[mod] = (await api('/api/meta/fields?module=' + mod)).fields || [];
  return state.fields[mod];
}
async function getViews(mod) {
  if (!state.views[mod]) state.views[mod] = (await api('/api/meta/views?module=' + mod)).custom_views || [];
  return state.views[mod];
}
async function getViewDetail(mod, id) {
  const k = mod + ':' + id;
  if (!state.viewDetail[k]) state.viewDetail[k] = ((await api(`/api/meta/view?module=${mod}&id=${id}`)).custom_views || [])[0];
  return state.viewDetail[k];
}
async function getLayouts(mod) {
  if (!state.layouts[mod]) state.layouts[mod] = (await api('/api/meta/layouts?module=' + mod)).layouts || [];
  return state.layouts[mod];
}
async function getRelLists(mod) {
  if (!state.relLists[mod]) state.relLists[mod] = (await api('/api/meta/related_lists?module=' + mod)).related_lists || [];
  return state.relLists[mod];
}
async function getCustomButtons(mod) {
  if (!state.customButtons[mod]) state.customButtons[mod] = (await api('/api/meta/custom_buttons?module=' + mod)).buttons || [];
  return state.customButtons[mod];
}

function isEstimatePreviewButton(button, mod) {
  return mod === 'Leads'
    && String(button?.id || '') === '1032257000011958248'
    && button?.module === 'Leads'
    && button?.api_name === 'Estimate'
    && button?.position === 'view'
    && button?.action === 'widget'
    && String(button?.action_reference?.id || '') === '1032257000012167001'
    && button?.local_status === 'Read-only preview'
    && typeof window.EstimateWidgetPreview?.calculateEstimate === 'function';
}

function isReviseApproveAnyStagePreviewButton(button, mod, record, layoutExact, resolvedLayoutId) {
  const preview = window.ReviseApproveAnyStagePreview;
  const contract = preview?.constants?.buttonContract;
  const layoutId = String(record?.Layout?.id || record?.$layout_id?.id || '');
  const registeredLayouts = button?.layout_ids;
  const expectedLayouts = contract?.layoutIds;
  return mod === 'Contacts'
    && layoutExact === true
    && String(resolvedLayoutId || '') === layoutId
    && button?.module === 'Contacts'
    && String(button?.id || '') === '1032257000017358923'
    && button?.name === 'Revise-Approve Quote'
    && button?.api_name === 'Revise_Approve_Quote'
    && button?.position === 'view'
    && button?.action === 'widget'
    && button?.source === 'crm'
    && button?.sequence_number === 2
    && String(button?.action_reference?.id || '') === '1032257000017358913'
    && button?.action_reference?.name === 'Revise-Approve Quote-Any Stage'
    && button?.action_reference?.type === 'widget'
    && Array.isArray(registeredLayouts)
    && registeredLayouts.length === 2
    && registeredLayouts[0] === '1032257000000000171'
    && registeredLayouts[1] === '1032257000005515301'
    && Array.isArray(expectedLayouts)
    && expectedLayouts.length === 2
    && expectedLayouts.every((id, index) => id === registeredLayouts[index])
    && expectedLayouts.includes(layoutId)
    && contract?.module === 'Contacts'
    && contract?.id === '1032257000017358923'
    && contract?.name === 'Revise-Approve Quote'
    && contract?.apiName === 'Revise_Approve_Quote'
    && contract?.position === 'view'
    && contract?.action === 'widget'
    && contract?.source === 'crm'
    && contract?.sequenceNumber === 2
    && contract?.actionReference?.id === '1032257000017358913'
    && contract?.actionReference?.name === 'Revise-Approve Quote-Any Stage'
    && contract?.actionReference?.type === 'widget'
    && preview?.constants?.parentBlueprint === 'not-applicable'
    && typeof preview?.createContext === 'function'
    && typeof preview?.buildPlan === 'function';
}

function isDeployTeamReadinessPreviewButton(button, mod, record, layoutExact, resolvedLayoutId) {
  const preview = window.DeployTeamReadinessPreview;
  const contract = preview?.constants?.buttonContract;
  const layoutId = String(record?.Layout?.id || record?.$layout_id?.id || '');
  return mod === 'Contacts'
    && layoutExact === true
    && String(resolvedLayoutId || '') === '1032257000000000171'
    && layoutId === '1032257000000000171'
    && button?.module === 'Contacts'
    && String(button?.id || '') === '1032257000022961587'
    && button?.name === 'Deploy Team for Installation'
    && button?.api_name === 'Assign_Visit_for_Installation'
    && button?.position === 'view'
    && button?.action === 'widget'
    && button?.source === 'crm'
    && button?.sequence_number === 3
    && Array.isArray(button?.layout_ids)
    && button.layout_ids.length === 1
    && button.layout_ids[0] === '1032257000000000171'
    && String(button?.action_reference?.id || '') === '1032257000022961582'
    && button?.action_reference?.name === 'Deploy Team'
    && button?.action_reference?.type === 'widget'
    && contract?.id === '1032257000022961587'
    && contract?.module === 'Contacts'
    && contract?.name === 'Deploy Team for Installation'
    && contract?.apiName === 'Assign_Visit_for_Installation'
    && contract?.position === 'view'
    && contract?.action === 'widget'
    && contract?.source === 'crm'
    && contract?.sequenceNumber === 3
    && Array.isArray(contract?.layoutIds)
    && contract.layoutIds.length === 1
    && contract.layoutIds[0] === '1032257000000000171'
    && contract?.actionReference?.id === '1032257000022961582'
    && contract?.actionReference?.name === 'Deploy Team'
    && contract?.actionReference?.type === 'widget'
    && preview?.constants?.parentBlueprint === 'not-applicable'
    && typeof preview?.createContext === 'function'
    && typeof preview?.buildPlan === 'function';
}

let activeEstimatePreviewClose = null;
/* Estimate preview modal start */
function openEstimateWidgetPreview(restoreFocus = document.activeElement) {
  const preview = window.EstimateWidgetPreview;
  if (!preview || typeof preview.calculateEstimate !== 'function') {
    toast('Estimate preview is unavailable. No CRM data was accessed.');
    return;
  }
  if (activeJourneyDialogClose) activeJourneyDialogClose(false);
  if (activeEstimatePreviewClose) activeEstimatePreviewClose(false);
  if (activeReviseQuotePreviewClose) activeReviseQuotePreviewClose(false);
  if (activeReviseApproveAnyStagePreviewClose) activeReviseApproveAnyStagePreviewClose(false);
  if (activeClosureNewPreviewClose) activeClosureNewPreviewClose(false);
  const modal = $('#modal');
  const box = $('#modalBox');
  box.innerHTML = '';
  const titleId = `estimate-preview-title-${Date.now()}`;
  const header = el('div', 'mh estimate-preview-head');
  const headingWrap = el('div', 'estimate-preview-heading');
  const badge = el('span', 'estimate-preview-badge', 'Read-only preview');
  const heading = el('h2', null, 'Kitchen Estimate');
  heading.id = titleId;
  headingWrap.append(badge, heading);
  const close = el('button', 'x', '✕');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close estimate preview');
  let keyHandler = null;
  const shut = (returnFocus = true) => {
    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    if (activeEstimatePreviewClose === shut) activeEstimatePreviewClose = null;
    modal.classList.add('hidden');
    modal.removeAttribute('role');
    modal.removeAttribute('aria-modal');
    modal.removeAttribute('aria-labelledby');
    if (returnFocus && restoreFocus && document.contains(restoreFocus)) restoreFocus.focus();
  };
  activeEstimatePreviewClose = shut;
  close.onclick = shut;
  header.append(headingWrap, close);

  const body = el('div', 'mb estimate-preview-body');
  const warning = el('div', 'estimate-preview-warning');
  warning.textContent = 'Calculation only. This preview does not read a Lead, create an Estimate, change CRM data, or contact any external service.';
  body.appendChild(warning);

  const form = el('div', 'estimate-preview-form');
  const shapeSection = el('section', 'estimate-preview-section');
  shapeSection.appendChild(el('h3', null, 'Kitchen shape'));
  const shapePicker = el('div', 'estimate-shape-picker');
  shapePicker.setAttribute('role', 'radiogroup');
  shapePicker.setAttribute('aria-label', 'Kitchen shape');
  shapeSection.appendChild(shapePicker);

  const options = el('div', 'estimate-option-grid');
  const packageField = el('label', 'estimate-field');
  packageField.appendChild(el('span', null, 'Package'));
  const packageSelect = el('select');
  Object.entries(preview.constants.packages).forEach(([value, option]) => {
    const node = el('option');
    node.value = value;
    node.textContent = `${option.label} · ₹${preview.formatIndian(option.pricePerSqft)}/sq ft`;
    node.selected = value === preview.constants.defaults.packageType;
    packageSelect.appendChild(node);
  });
  packageField.appendChild(packageSelect);
  const heightField = el('label', 'estimate-field');
  heightField.appendChild(el('span', null, 'Wall cabinet height'));
  const heightSelect = el('select');
  preview.constants.wallHeightsMM.forEach(value => {
    const node = el('option');
    node.value = String(value);
    node.textContent = `${value.toLocaleString('en-IN')} mm`;
    node.selected = value === preview.constants.defaults.wallHeightMM;
    heightSelect.appendChild(node);
  });
  heightField.appendChild(heightSelect);
  options.append(packageField, heightField);

  const wallSection = el('section', 'estimate-preview-section');
  wallSection.appendChild(el('h3', null, 'Wall lengths'));
  const wallInputs = el('div', 'estimate-wall-grid');
  wallSection.appendChild(wallInputs);

  const resultPanel = el('section', 'estimate-result-panel');
  resultPanel.setAttribute('aria-live', 'polite');
  const resetResult = () => {
    resultPanel.className = 'estimate-result-panel is-empty';
    resultPanel.replaceChildren(el('p', null, 'Enter at least one positive wall length, then recalculate.'));
  };
  let selectedShape = preview.constants.defaults.shape;
  let inputs = [];
  const drawWalls = () => {
    wallInputs.replaceChildren();
    inputs = [];
    const count = preview.constants.shapes[selectedShape].wallCount;
    for (let index = 0; index < count; index += 1) {
      const field = el('label', 'estimate-field');
      field.appendChild(el('span', null, `Wall ${index + 1} length (ft)`));
      const input = el('input');
      input.type = 'number';
      input.min = '0';
      input.step = '0.1';
      input.inputMode = 'decimal';
      input.placeholder = '0.0';
      input.setAttribute('aria-label', `Wall ${index + 1} length in feet`);
      input.oninput = resetResult;
      field.appendChild(input);
      wallInputs.appendChild(field);
      inputs.push(input);
    }
    resetResult();
  };
  Object.entries(preview.constants.shapes).forEach(([value, shape]) => {
    const button = el('button', 'estimate-shape-option', shape.label);
    button.type = 'button';
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', value === selectedShape ? 'true' : 'false');
    button.onclick = () => {
      selectedShape = value;
      shapePicker.querySelectorAll('.estimate-shape-option').forEach(node => {
        const active = node === button;
        node.classList.toggle('is-active', active);
        node.setAttribute('aria-checked', active ? 'true' : 'false');
      });
      drawWalls();
      inputs[0]?.focus();
    };
    if (value === selectedShape) button.classList.add('is-active');
    shapePicker.appendChild(button);
  });
  packageSelect.onchange = resetResult;
  heightSelect.onchange = resetResult;
  drawWalls();

  const recalculate = el('button', 'btn-primary estimate-recalculate', 'Recalculate');
  recalculate.type = 'button';
  recalculate.onclick = () => {
    try {
      const result = preview.calculateEstimate({
        shape: selectedShape,
        packageType: packageSelect.value,
        wallHeightMM: Number(heightSelect.value),
        wallFeet: inputs.map(input => input.value),
      });
      if (!result) {
        resetResult();
        inputs[0]?.focus();
        return;
      }
      resultPanel.className = 'estimate-result-panel';
      resultPanel.replaceChildren();
      const title = el('div', 'estimate-result-title');
      title.append(el('span', null, `${result.shapeLabel} · ${result.packageLabel} · ${result.wallHeightMM.toLocaleString('en-IN')} mm`), el('strong', null, `₹${result.formattedTotalPrice}`));
      const metrics = el('div', 'estimate-result-metrics');
      [
        ['Estimated area', `${result.totalSqft.toLocaleString('en-IN')} sq ft`],
        ['Price per sq ft', `₹${preview.formatIndian(result.pricePerSqft)}`],
        ['Approximate value', `${result.priceInLakhs.toLocaleString('en-IN')} Lakh`],
      ].forEach(([label, value]) => {
        const item = el('div');
        item.append(el('span', null, label), el('strong', null, value));
        metrics.appendChild(item);
      });
      resultPanel.append(title, metrics, el('small', null, 'Indicative calculation from the captured widget formula. GST and other exclusions are not included.'));
    } catch (error) {
      resultPanel.className = 'estimate-result-panel is-error';
      resultPanel.replaceChildren(el('p', null, 'The calculation could not be completed from these inputs. No CRM data was changed.'));
    }
  };
  form.append(shapeSection, options, wallSection, recalculate, resultPanel);
  body.appendChild(form);

  const scope = el('div', 'estimate-scope-grid');
  const included = el('section');
  included.appendChild(el('h3', null, 'Included'));
  const includedList = el('ul');
  ['All Stone Cabinets', 'Lighting', 'Hardware', 'Installation'].forEach(item => includedList.appendChild(el('li', null, item)));
  included.appendChild(includedList);
  const excluded = el('section');
  excluded.appendChild(el('h3', null, 'Excluded'));
  const excludedList = el('ul');
  ['Accessories', 'Transportation', 'GST (charged actual)'].forEach(item => excludedList.appendChild(el('li', null, item)));
  excluded.appendChild(excludedList);
  scope.append(included, excluded);
  body.appendChild(scope);

  const footer = el('div', 'mf');
  const done = el('button', null, 'Close preview');
  done.type = 'button';
  done.onclick = shut;
  footer.appendChild(done);
  box.append(header, body, footer);
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', titleId);
  modal.classList.remove('hidden');
  keyHandler = event => {
    if (event.key === 'Escape' && !modal.classList.contains('hidden')) shut();
  };
  document.addEventListener('keydown', keyHandler);
  close.focus();
}
/* Estimate preview modal end */
function fieldMap(mod) { const m = {}; (state.fields[mod] || []).forEach(f => m[f.api_name] = f); return m; }

function stageField(mod) {
  const fs = state.fields[mod] || [];
  const blueprintState = state.blueprintByModule?.[mod]?.state_field;
  if (blueprintState) {
    const field = fs.find(item => item.api_name === blueprintState && item.data_type === 'picklist');
    if (field) return field;
  }
  for (const name of ['Stage', 'Lead_Status', 'Status', 'Deal_Stage', 'Case_Status'])
    { const f = fs.find(x => x.api_name === name && x.data_type === 'picklist'); if (f) return f; }
  return null;
}
function nameField(mod) {
  const fs = state.fields[mod] || [];
  for (const n of ['Full_Name','Deal_Name','Account_Name','Subject','Product_Name','Campaign_Name','Vendor_Name','Case_Subject','Name','Last_Name']) {
    const f = fs.find(x => x.api_name === n && x.data_type !== 'lookup');
    if (f) return f.api_name;
  }
  return fs.find(f => f.data_type === 'text' && !f.read_only)?.api_name || 'id';
}

/* ---------- list view ---------- */
async function openModule(mod, keep) {
  const nav = ++state.nav;
  if (state.current !== mod) { state.page = 1; state.cvid = null; state.sort = null; state.mode = 'list'; }
  state.current = mod;
  setActiveTab(mod);
  const c = $('#content');
  const haveMeta = loadMetaFromStore(mod);
  const bq = new URLSearchParams({ page: state.page, per_page: 50 });
  if (state.cvid) bq.set('cvid', state.cvid);
  if (state.sort) { bq.set('sort_by', state.sort); bq.set('sort_order', state.sortOrder); }
  if (haveMeta) bq.set('meta', '0');
  const url = `/api/module_bundle/${mod}?` + bq.toString() + dateParams();

  const renderBundle = b => {
    if (nav !== state.nav) return;
    const fields = b.fields?.fields || state.fields[mod] || [];
    const views = b.views?.custom_views || state.views[mod] || [];
    state.fields[mod] = fields;
    state.views[mod] = views;
    if (b.fields?.fields) persistMeta(mod);
    state.cvid = b.cvid;
    let cols = [];
    const vd = views.find(v => String(v.id) === String(state.cvid));
    if (vd) cols = (vd.fields || []).map(f => typeof f === 'string' ? f : f.api_name).filter(Boolean);
    const fm = fieldMap(mod);
    if (!cols.length) cols = fields.filter(f => f.view_type?.view && !['subform','fileupload','imageupload','profileimage'].includes(f.data_type)).slice(0, 8).map(f => f.api_name);
    let customCols = false;
    try {
      const ov = JSON.parse(localStorage.getItem('crm_cols_' + mod + '_' + (state.cvid || '')) || 'null');
      if (Array.isArray(ov) && ov.length) { cols = ov; customCols = true; }
    } catch (e) {}
    cols = cols.filter(cn => fm[cn]);
    if (!customCols) {
      if (!cols.includes('Owner') && fm['Owner']) cols.push('Owner');
      if (mod === 'Leads' && cols.includes('Owner')) cols = ['Owner', ...cols.filter(cn => cn !== 'Owner')];
    }
    const rows = b.records?.data || [];
    rows.forEach(r => swr.record.set(mod + '|' + r.id, r));
    const more = b.records?.info?.more_records;
    renderListChrome(mod, views, cols, rows, more, b.records?.info || {}, fm, b.view_fallback || null, b.records || null);
  };

  const cached = swr.bundle.get(url);
  let painted = false;
  if (cached) { try { renderBundle(cached); painted = true; } catch (e) {} }
  if (!painted && !keep) c.innerHTML = '<div class="loading">Loading ' + esc(state.moduleByApi[mod]?.plural_label || mod) + '…</div>';
  try {
    const b = await api(url);
    swr.bundle.set(url, b);
    if (nav !== state.nav) return;
    if (!painted || JSON.stringify(b.records) !== JSON.stringify(cached?.records)) renderBundle(b);
  } catch (e) {
    if (nav !== state.nav || painted) return;
    c.innerHTML = `<div class="loading">Could not load ${esc(mod)}: ${esc(e.message)}</div>`;
  }
}

function renderListChrome(mod, views, cols, rows, more, count, fm, viewFallback = null, recordAvailability = null) {
  const m = state.moduleByApi[mod];
  const c = $('#content'); c.innerHTML = '';
  const recordsUnavailable = recordAvailability?.availability === 'unresolved';
  if (recordAvailability?.snapshot_origin?.export_date) {
    const notice = el('div', 'view-fallback-notice');
    notice.setAttribute('role', 'status');
    notice.textContent = `Saved data includes ${recordAvailability.snapshot_origin.export_date} ${recordAvailability.snapshot_origin.source_kind === 'mixed-saved-snapshots' ? 'historical records alongside other cached records' : 'records'}. These records have not been refreshed from Zoho.`;
    c.appendChild(notice);
  }
  if (viewFallback?.applied === true) {
    const notice = el('div', 'view-fallback-notice');
    notice.setAttribute('role', 'status');
    notice.textContent = `${viewFallback.source_view_name || 'The source default view'} needs a mapped user or unsupported source-relative criterion. Showing ${viewFallback.selected_view_name || 'an available local view'} instead.`;
    c.appendChild(notice);
  } else if (viewFallback?.availability === 'unresolved') {
    const notice = el('div', 'view-fallback-notice unresolved');
    notice.setAttribute('role', 'status');
    notice.textContent = viewFallback.reason_code === 'MODULE_CONFIGURATION_UNAVAILABLE'
      ? 'Exact source field and view configuration is unavailable. Records remain unavailable rather than being shown as empty or unfiltered.'
      : `${viewFallback.source_view_name || 'The source default view'} has no captured executable criteria. Records remain unavailable rather than being shown as an unfiltered list.`;
    c.appendChild(notice);
  }
  const head = el('div', 'listhead');

  const sel = el('select');
  if (recordsUnavailable) {
    const unavailableOption = el('option');
    unavailableOption.value = '';
    unavailableOption.selected = true;
    unavailableOption.disabled = true;
    unavailableOption.textContent = recordAvailability.reason_code === 'MODULE_CONFIGURATION_UNAVAILABLE'
      ? 'Configuration data unavailable'
      : recordAvailability.reason_code === 'SNAPSHOT_MODULE_DATA_UNAVAILABLE'
      ? 'Data unavailable'
      : 'View criteria unavailable';
    sel.appendChild(unavailableOption);
  }
  views.forEach(v => {
    const o = el('option'); o.value = v.id; o.textContent = v.display_value || v.name;
    if (!Object.prototype.hasOwnProperty.call(v, 'criteria')) {
      o.disabled = true;
      o.textContent += ' · criteria unavailable';
    }
    if (String(v.id) === String(state.cvid)) o.selected = true;
    sel.appendChild(o);
  });
  sel.onchange = () => { state.cvid = sel.value; state.page = 1; delete state.viewDetail[mod + ':' + sel.value]; openModule(mod, true); };
  sel.disabled = recordsUnavailable;
  head.appendChild(sel);
  if (!recordsUnavailable) head.appendChild(mkDateFilter(() => { state.page = 1; openModule(mod, true); }));

  const totalTxt = (count && count.total_exact) ? ` · ${Number(count.total).toLocaleString('en-IN')} total` : (more ? ' · more available' : '');
  head.appendChild(el('span', 'count', recordsUnavailable ? 'Records unavailable' : `${rows.length} shown · page ${state.page}${totalTxt}`));
  head.appendChild(el('div', 'grow'));

  const sf = stageField(mod);
  const vs = el('div', 'viewswitch');
  const mkBtn = (label, mode, fn) => {
    const btn = el('button', state.mode === mode ? 'on' : '', label);
    btn.disabled = recordsUnavailable;
    btn.onclick = fn || (() => { state.mode = mode; openModule(mod, true); });
    vs.appendChild(btn);
  };
  mkBtn('List', 'list');
  mkBtn('Cards', 'cards');
  if (sf) mkBtn('Kanban', 'kanban', () => { state.mode = 'kanban'; renderKanban(mod, sf); });
  mkBtn('Calendar', 'calendar');
  mkBtn('Matrix', 'matrix');
  mkBtn('Excel', 'excel');
  head.appendChild(vs);
  if (state.mode === 'excel') {
    const bcsv = el('button', null, '⬇ CSV');
    bcsv.title = 'Download the rows on this page as CSV';
    bcsv.onclick = () => exportCSV(mod, cols, rows, fm);
    head.appendChild(bcsv);
  }
  const bNew = el('button', 'btn-primary', '+ New ' + esc(m?.singular_label || mod));
  bNew.onclick = () => openForm(mod, null);
  if (state.snapshotOnly) {
    bNew.disabled = true;
    bNew.title = 'Create and edit actions are paused while the CRM is in snapshot-only mode.';
  } else if (!Object.keys(fm).length) {
    bNew.disabled = true;
    bNew.title = 'Exact field and layout metadata is unavailable for this module.';
  }
  head.appendChild(bNew);
  c.appendChild(head);
  getCustomButtons(mod).then(buttons => {
    if (state.current !== mod || !head.isConnected) return;
    buttons.filter(button => button.position === 'list_view').forEach(button => {
      const sourceButton = el('button', 'source-action', esc(button.name));
      sourceButton.disabled = true;
      sourceButton.title = button.block_reason;
      head.insertBefore(sourceButton, bNew);
    });
  }).catch(() => {});

  if (recordsUnavailable) {
    const unavailable = el('div', 'module-unavailable-state');
    const configurationUnavailable = recordAvailability.reason_code === 'MODULE_CONFIGURATION_UNAVAILABLE';
    const snapshotUnavailable = recordAvailability.reason_code === 'SNAPSHOT_MODULE_DATA_UNAVAILABLE';
    unavailable.appendChild(el('h2', null, snapshotUnavailable ? 'Saved records unavailable' : configurationUnavailable ? 'Configuration data not available' : 'View criteria unavailable'));
    unavailable.appendChild(el('p', null, esc(recordAvailability.message || 'The selected source view cannot be reproduced safely from the captured metadata.')));
    unavailable.appendChild(el('small', null, snapshotUnavailable
      ? 'The module is available in navigation. This does not mean it has zero records in Zoho. Synchronization remains paused.'
      : configurationUnavailable
      ? 'No record query was executed and no empty result is claimed. Record creation remains disabled until exact field and layout metadata is available.'
      : 'No record query was executed and no empty result is claimed. Choose a view only after its exact criteria are captured.'));
    c.appendChild(unavailable);
    return;
  }

  if (state.mode === 'kanban' && sf) { renderKanban(mod, sf, c); return; }
  if (state.mode === 'excel') { renderExcelGrid(mod, cols, rows, fm, c, more); return; }
  if (state.mode === 'cards') { renderCardsGrid(mod, cols, rows, fm, c, more); return; }
  if (state.mode === 'calendar') { renderCalendar(mod, fm, c); return; }
  if (state.mode === 'matrix') { renderMatrix(mod, fm, c); return; }

  const wrap = el('div', 'tablewrap');
  const table = el('table', 'grid');
  const thead = el('thead'); const trh = el('tr');
  cols.forEach((cn, ci) => {
    const th = el('th', null, esc(fm[cn]?.field_label || cn) + (state.sort === cn ? (state.sortOrder === 'asc' ? ' ▲' : ' ▼') : ''));
    th.onclick = () => {
      if (state.sort === cn) state.sortOrder = state.sortOrder === 'asc' ? 'desc' : 'asc';
      else { state.sort = cn; state.sortOrder = 'asc'; }
      openModule(mod, true);
    };
    // drag to reorder columns
    th.draggable = true;
    th.title = 'Click to sort · drag to reorder';
    th.addEventListener('dragstart', e => { e.dataTransfer.setData('text/col', String(ci)); e.dataTransfer.effectAllowed = 'move'; th.classList.add('dragging'); });
    th.addEventListener('dragend', () => th.classList.remove('dragging'));
    th.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/col')) { e.preventDefault(); th.classList.add('dropcol'); } });
    th.addEventListener('dragleave', () => th.classList.remove('dropcol'));
    th.addEventListener('drop', e => {
      e.preventDefault(); th.classList.remove('dropcol');
      const from = parseInt(e.dataTransfer.getData('text/col'), 10);
      if (isNaN(from) || from === ci) return;
      const next = cols.slice();
      const [moved] = next.splice(from, 1);
      next.splice(ci, 0, moved);
      saveCols(mod, next);
    });
    trh.appendChild(th);
  });
  const thAdd = el('th', 'addcol', '+');
  thAdd.title = 'Add / remove columns';
  thAdd.onclick = e => { e.stopPropagation(); openColPicker(mod, cols, fm, thAdd); };
  trh.appendChild(thAdd);
  thead.appendChild(trh); table.appendChild(thead);
  const tbody = el('tbody');
  const nf0 = nameField(mod);
  rows.forEach(r => {
    const tr = el('tr');
    cols.forEach((cn, i) => {
      const isLinkCol = i === 0 || cn === nf0;
      const isPill = !isLinkCol && fm[cn]?.data_type === 'picklist' && r[cn] != null && r[cn] !== '';
      const recordingField = isCallRecordingField(mod, cn);
      const td = recordingField
        ? el('td', 'call-recording-table-cell')
        : el('td', isLinkCol ? 'link' : '', isPill ? pillHtml(r[cn]) : esc(fmtVal(r[cn], fm[cn])));
      if (recordingField) td.appendChild(callRecordingControl(r[cn], { compact: true }));
      else if (isLinkCol) td.onclick = () => location.hash = `#/record/${mod}/${r.id}`;
      else {
        const lid = lookupId(r[cn]);
        const lf = fm[cn];
        if (lid && lf?.data_type === 'lookup' && lf.lookup?.module?.api_name) {
          td.classList.add('link');
          td.onclick = () => location.hash = `#/record/${lf.lookup.module.api_name}/${lid}`;
        }
      }
      tr.appendChild(td);
    });
    tr.appendChild(el('td', 'addcol', ''));
    tbody.appendChild(tr);
  });
  if (!rows.length) tbody.appendChild(el('tr', null, `<td colspan="${cols.length + 1}" style="text-align:center;color:var(--muted);padding:30px">No records in this view</td>`));
  table.appendChild(tbody); wrap.appendChild(table); c.appendChild(wrap);

  const pager = el('div', 'pager');
  const prev = el('button', null, '‹ Prev'); prev.disabled = state.page <= 1;
  const next = el('button', null, 'Next ›'); next.disabled = !more;
  prev.onclick = () => { state.page--; openModule(mod, true); };
  next.onclick = () => { state.page++; openModule(mod, true); };
  pager.append(prev, el('span', 'count', 'Page ' + state.page), next);
  c.appendChild(pager);
}

/* ---------- column picker + reorder ---------- */
const colStoreKey = mod => 'crm_cols_' + mod + '_' + (state.cvid || '');
function saveCols(mod, next) {
  try { localStorage.setItem(colStoreKey(mod), JSON.stringify(next)); } catch (e) {}
  openModule(mod, true);
}
function closeColPicker() { document.querySelectorAll('.colpicker').forEach(p => p.remove()); }
function openColPicker(mod, cols, fm, anchor) {
  if (document.querySelector('.colpicker')) { closeColPicker(); return; }
  const panel = el('div', 'colpicker');
  const r = anchor.getBoundingClientRect();
  panel.style.top = (r.bottom + 6) + 'px';
  panel.style.right = Math.max(10, window.innerWidth - r.right - 10) + 'px';
  const inp = el('input'); inp.type = 'text'; inp.placeholder = 'Search fields…';
  const listEl = el('div', 'cp-list');
  const reset = el('button', 'cp-reset', '↺ Reset to view default');
  reset.onclick = () => { try { localStorage.removeItem(colStoreKey(mod)); } catch (e) {} closeColPicker(); openModule(mod, true); };
  const current = () => {
    try { const ov = JSON.parse(localStorage.getItem(colStoreKey(mod)) || 'null'); if (Array.isArray(ov) && ov.length) return ov; } catch (e) {}
    return cols.slice();
  };
  const fields = (state.fields[mod] || [])
    .filter(f => !['subform', 'fileupload', 'imageupload', 'profileimage'].includes(f.data_type))
    .sort((a, b) => (a.field_label || '').localeCompare(b.field_label || ''));
  const renderList = () => {
    const q = inp.value.toLowerCase();
    listEl.innerHTML = '';
    fields.filter(f => (f.field_label || '').toLowerCase().includes(q)).forEach(f => {
      const row = el('label', 'cp-row');
      const cb = el('input'); cb.type = 'checkbox';
      cb.checked = current().includes(f.api_name);
      cb.onchange = () => {
        const cur = current();
        saveCols(mod, cb.checked ? [...cur, f.api_name] : cur.filter(c => c !== f.api_name));
      };
      row.append(cb, document.createTextNode(' ' + f.field_label));
      listEl.appendChild(row);
    });
  };
  inp.oninput = renderList;
  renderList();
  panel.append(inp, listEl, reset);
  document.body.appendChild(panel);
  setTimeout(() => {
    const closer = e => { if (!e.target.closest('.colpicker') && !e.target.closest('.addcol')) { closeColPicker(); document.removeEventListener('click', closer); } };
    document.addEventListener('click', closer);
  }, 0);
}

/* ---------- cards view ---------- */
function renderCardsGrid(mod, cols, rows, fm, c, more) {
  const nf = nameField(mod);
  const wrap = el('div', 'cardsscroll');
  const grid = el('div', 'cardsgrid');
  rows.forEach(r => {
    const card = el('div', 'ccard');
    card.onclick = () => location.hash = `#/record/${mod}/${r.id}`;
    card.appendChild(el('div', 'cc-title', esc(fmtVal(r[nf]) !== '—' ? fmtVal(r[nf]) : (r.Full_Name || r.Name || r.id))));
    const pillCol = cols.find(cn => fm[cn]?.data_type === 'picklist' && r[cn]);
    if (pillCol) card.appendChild(el('div', 'cc-pill', pillHtml(r[pillCol])));
    const body = el('div', 'cc-body');
    cols.filter(cn => cn !== nf && cn !== pillCol && r[cn] != null && r[cn] !== '').slice(0, 4).forEach(cn => {
      const display = isCallRecordingField(mod, cn) ? callRecordingLabel(r[cn]) : fmtVal(r[cn], fm[cn]);
      body.appendChild(el('div', 'cc-row', `<span>${esc(fm[cn]?.field_label || cn)}</span>${esc(display)}`));
    });
    card.appendChild(body);
    if (r.Owner) card.appendChild(el('div', 'cc-owner', '👤 ' + esc(fmtVal(r.Owner))));
    grid.appendChild(card);
  });
  if (!rows.length) grid.appendChild(el('div', 'loading', 'No records'));
  wrap.appendChild(grid);
  c.appendChild(wrap);
  const pager = el('div', 'pager');
  const prev = el('button', null, '‹ Prev'); prev.disabled = state.page <= 1;
  const next = el('button', null, 'Next ›'); next.disabled = !more;
  prev.onclick = () => { state.page--; openModule(mod, true); };
  next.onclick = () => { state.page++; openModule(mod, true); };
  pager.append(prev, el('span', 'count', 'Page ' + state.page), next);
  c.appendChild(pager);
}

/* ---------- calendar view ---------- */
function calDateField(mod) {
  if (mod === 'Tasks') return 'Due_Date';
  if (mod === 'Events') return 'Start_DateTime';
  if (mod === 'Calls') return 'Call_Start_Time';
  return 'Created_Time';
}
state.calFieldByMod = {};
async function renderCalendar(mod, fm, c) {
  const nav = state.nav;
  if (!state.calMonth) state.calMonth = fmtD(istNowD()).slice(0, 7);
  if (!state.calFieldByMod[mod]) state.calFieldByMod[mod] = calDateField(mod);
  const chosenField = state.calFieldByMod[mod];
  const [yy, mm] = state.calMonth.split('-').map(Number);
  const first = `${state.calMonth}-01`;
  const lastDay = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const last = `${state.calMonth}-${String(lastDay).padStart(2, '0')}`;
  const wrap = el('div', 'calwrap', '<div class="loading">Loading calendar…</div>');
  c.appendChild(wrap);
  const df = chosenField;
  const natural0 = calDateField(mod);
  const dfParam = df === 'Created_Time' ? '' : df === 'Modified_Time' ? 'modified' : df === natural0 ? 'auto' : df;
  let rows = [];
  try {
    const q = new URLSearchParams({ page: 1, per_page: 2000, from: first, to: last });
    if (dfParam) q.set('dfield', dfParam);
    if (state.cvid) q.set('cvid', state.cvid);
    const d = await api(`/api/records/${mod}?` + q.toString());
    rows = d.data || [];
  } catch (e) {}
  if (nav !== state.nav) return;
  const byDay = {};
  rows.forEach(r => { const dv = String(r[df] || '').slice(0, 10); if (dv) (byDay[dv] = byDay[dv] || []).push(r); });
  const nf = nameField(mod);
  wrap.innerHTML = '';
  const head = el('div', 'calhead');
  const bp = el('button', null, '‹'); const bn = el('button', null, '›');
  bp.onclick = () => { state.calMonth = `${mm === 1 ? yy - 1 : yy}-${String(mm === 1 ? 12 : mm - 1).padStart(2, '0')}`; openModule(mod, true); };
  bn.onclick = () => { state.calMonth = `${mm === 12 ? yy + 1 : yy}-${String(mm === 12 ? 1 : mm + 1).padStart(2, '0')}`; openModule(mod, true); };
  const fldSel = el('select', 'calfield');
  const natural = calDateField(mod);
  const fldOpts = [[natural, fm[natural]?.field_label || natural.replace(/_/g, ' ')]];
  (state.fields[mod] || [])
    .filter(f => ['date', 'datetime'].includes(f.data_type) && !['Created_Time', 'Modified_Time', natural].includes(f.api_name))
    .forEach(f => fldOpts.push([f.api_name, f.field_label]));
  if (natural !== 'Created_Time') fldOpts.push(['Created_Time', 'Created Time']);
  fldOpts.push(['Modified_Time', 'Modified Time']);
  fldOpts.forEach(([v, t]) => { const o = el('option'); o.value = v; o.textContent = 'by ' + t; if (v === df) o.selected = true; fldSel.appendChild(o); });
  fldSel.onchange = () => { state.calFieldByMod[mod] = fldSel.value; openModule(mod, true); };
  head.append(bp, el('span', 'calmonth', new Date(Date.UTC(yy, mm - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })), bn,
    fldSel, el('span', 'calinfo', `${rows.length} records`));
  wrap.appendChild(head);
  const grid = el('div', 'calgrid');
  ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach(d => grid.appendChild(el('div', 'calwd', d)));
  const firstDow = (new Date(Date.UTC(yy, mm - 1, 1)).getUTCDay() + 6) % 7;
  const today = fmtD(istNowD());
  for (let i = 0; i < firstDow; i++) grid.appendChild(el('div', 'calcell empty'));
  for (let day = 1; day <= lastDay; day++) {
    const key = `${state.calMonth}-${String(day).padStart(2, '0')}`;
    const cell = el('div', 'calcell' + (key === today ? ' today' : ''));
    const recs = byDay[key] || [];
    cell.appendChild(el('div', 'calday', `${day}${recs.length ? ` <span class="calcount">${recs.length}</span>` : ''}`));
    recs.slice(0, 3).forEach(r => {
      const chip = el('div', 'calchip', esc(String(fmtVal(r[nf]) !== '—' ? fmtVal(r[nf]) : (r.Full_Name || r.Subject || r.id)).slice(0, 26)));
      chip.onclick = () => location.hash = `#/record/${mod}/${r.id}`;
      cell.appendChild(chip);
    });
    if (recs.length > 3) {
      const moreEl = el('div', 'calmore', `+${recs.length - 3} more`);
      moreEl.onclick = () => {
        cell.classList.add('expanded');
        moreEl.remove();
        recs.slice(3).forEach(r => {
          const chip = el('div', 'calchip', esc(String(fmtVal(r[nf]) !== '—' ? fmtVal(r[nf]) : (r.Full_Name || r.Subject || r.id)).slice(0, 26)));
          chip.onclick = () => location.hash = `#/record/${mod}/${r.id}`;
          cell.appendChild(chip);
        });
      };
      cell.appendChild(moreEl);
    }
    grid.appendChild(cell);
  }
  wrap.appendChild(grid);
}

/* ---------- matrix (pivot) view ---------- */
state.matrixAxes = {}; // module -> {x, y}
function axisOptions(mod) {
  const fs = state.fields[mod] || [];
  const opts = [['Owner', 'Owner']];
  fs.filter(f => f.data_type === 'picklist').forEach(f => opts.push([f.api_name, f.field_label]));
  fs.filter(f => f.data_type === 'lookup' && f.view_type?.view).slice(0, 8).forEach(f => opts.push([f.api_name, f.field_label + ' (lookup)']));
  return opts;
}
async function renderMatrix(mod, fm, c) {
  const nav = state.nav;
  const sf = stageField(mod);
  if (!state.matrixAxes[mod]) state.matrixAxes[mod] = { y: sf ? sf.api_name : (axisOptions(mod)[1]?.[0] || 'Owner'), x: 'Owner' };
  const ax = state.matrixAxes[mod];
  const wrap = el('div', 'mxwrap');
  const ctrl = el('div', 'mxctrl');
  const mkSel = (val, label) => {
    const lab = el('label', null, label);
    const s = el('select');
    axisOptions(mod).forEach(([v, t]) => { const o = el('option'); o.value = v; o.textContent = t; if (v === val) o.selected = true; s.appendChild(o); });
    ctrl.append(lab, s);
    return s;
  };
  const sy = mkSel(ax.y, 'Rows (Y):');
  const sx = mkSel(ax.x, 'Columns (X):');
  const swap = el('button', null, '⇄ Swap');
  swap.onclick = () => { state.matrixAxes[mod] = { x: ax.y, y: ax.x }; openModule(mod, true); };
  sy.onchange = () => { ax.y = sy.value; openModule(mod, true); };
  sx.onchange = () => { ax.x = sx.value; openModule(mod, true); };
  ctrl.appendChild(swap);
  wrap.appendChild(ctrl);
  const holder = el('div', 'mxscroll', '<div class="loading">Computing matrix…</div>');
  wrap.appendChild(holder);
  c.appendChild(wrap);
  try {
    const q = new URLSearchParams({ x: ax.x, y: ax.y });
    if (state.cvid) q.set('cvid', state.cvid);
    const d = await api(`/api/matrix/${mod}?` + q.toString() + dateParams());
    if (nav !== state.nav) return;
    const cells = {}; const xTotals = {}; const yTotals = {}; let grand = 0;
    (d.rows || []).forEach(r => {
      cells[r.y + '|' + r.x] = r.c;
      xTotals[r.x] = (xTotals[r.x] || 0) + r.c;
      yTotals[r.y] = (yTotals[r.y] || 0) + r.c;
      grand += r.c;
    });
    const xs = Object.keys(xTotals).sort((a, b) => xTotals[b] - xTotals[a]).slice(0, 30);
    const ys = Object.keys(yTotals).sort((a, b) => yTotals[b] - yTotals[a]).slice(0, 50);
    const maxCell = Math.max(1, ...Object.values(cells));
    let html = '<table class="grid mx"><thead><tr><th class="mxy">' + esc(fm[ax.y]?.field_label || ax.y) + ' ↓ \\ ' + esc(fm[ax.x]?.field_label || ax.x) + ' →</th>';
    xs.forEach(x => html += `<th>${esc(x)}</th>`);
    html += '<th class="mxtot">Total</th></tr></thead><tbody>';
    ys.forEach(y => {
      html += `<tr><td class="mxy">${esc(y)}</td>`;
      xs.forEach(x => {
        const v = cells[y + '|' + x] || 0;
        const alpha = v ? (0.08 + 0.55 * (v / maxCell)) : 0;
        html += `<td class="mxc" style="${v ? `background:rgba(79,70,229,${alpha.toFixed(2)});${alpha > 0.4 ? 'color:#fff;' : ''}` : ''}" title="${esc(y)} × ${esc(x)}: ${v}">${v || ''}</td>`;
      });
      html += `<td class="mxtot">${(yTotals[y] || 0).toLocaleString('en-IN')}</td></tr>`;
    });
    html += '<tr><td class="mxy mxtot">Total</td>';
    xs.forEach(x => html += `<td class="mxtot">${(xTotals[x] || 0).toLocaleString('en-IN')}</td>`);
    html += `<td class="mxtot">${grand.toLocaleString('en-IN')}</td></tr></tbody></table>`;
    holder.innerHTML = html;
    holder.insertAdjacentHTML('beforeend', `<div class="dashfoot">${grand.toLocaleString('en-IN')} records · counts refresh every 60s${xs.length === 30 || ys.length === 50 ? ' · largest values shown' : ''}</div>`);
  } catch (e) {
    if (nav !== state.nav) return;
    holder.innerHTML = `<div class="loading">Matrix failed: ${esc(e.message)}</div>`;
  }
}

/* ---------- excel view ---------- */
const CELL_EDITABLE = f => f && !f.read_only && f.view_type?.edit !== false &&
  ['text','email','phone','website','picklist','boolean','date','datetime','integer','double','currency','bigint','percent','textarea']
    .includes(f.data_type);

function cellToZoho(raw, f) {
  if (raw === '' || raw == null) return null;
  const dt = f.data_type;
  if (dt === 'boolean') return raw === 'true';
  if (['integer','bigint'].includes(dt)) return raw;
  if (['double','currency','percent'].includes(dt)) return parseFloat(raw);
  if (dt === 'datetime') return new Date(raw).toISOString().replace(/\.\d{3}Z$/, '+00:00');
  return raw;
}

function makeCellEditor(f, current) {
  let inp;
  if (f.data_type === 'picklist') {
    inp = el('select');
    const none = el('option'); none.value = ''; none.textContent = '-None-'; inp.appendChild(none);
    (f.pick_list_values || []).forEach(p => {
      const o = el('option'); o.value = p.actual_value ?? p.display_value; o.textContent = p.display_value;
      if (current === o.value || current === p.display_value) o.selected = true;
      inp.appendChild(o);
    });
  } else if (f.data_type === 'boolean') {
    inp = el('select');
    [['','-None-'],['true','Yes'],['false','No']].forEach(([v,t]) => { const o = el('option'); o.value = v; o.textContent = t; if (String(current) === v) o.selected = true; inp.appendChild(o); });
  } else if (f.data_type === 'date') { inp = el('input'); inp.type = 'date'; inp.value = current ?? ''; }
  else if (f.data_type === 'datetime') { inp = el('input'); inp.type = 'datetime-local'; inp.value = current ? String(current).slice(0,16) : ''; }
  else if (['integer','double','currency','bigint','percent'].includes(f.data_type)) { inp = el('input'); inp.type = 'number'; inp.step = 'any'; inp.value = current ?? ''; }
  else { inp = el('input'); inp.type = 'text'; inp.value = current ?? ''; }
  inp.className = 'celledit';
  return inp;
}

function renderExcelGrid(mod, cols, rows, fm, c, more) {
  const wrap = el('div', 'tablewrap excelwrap');
  const table = el('table', 'grid excel');
  const thead = el('thead'); const trh = el('tr');
  const cellEditable = cn => !isCallRecordingField(mod, cn) && CELL_EDITABLE(fm[cn]);
  trh.appendChild(el('th', 'rownum', '#'));
  cols.forEach(cn => trh.appendChild(el('th', null, esc(fm[cn]?.field_label || cn) + (cellEditable(cn) ? '' : ' 🔒'))));
  thead.appendChild(trh); table.appendChild(thead);
  const tbody = el('tbody');

  const startEdit = (td, r, cn) => {
    const f = fm[cn];
    if (!cellEditable(cn) || td.querySelector('.celledit')) return;
    const orig = r[cn];
    const inp = makeCellEditor(f, orig);
    td.classList.add('editing');
    td.innerHTML = ''; td.appendChild(inp); inp.focus();
    if (inp.select) try { inp.select(); } catch {}
    let done = false;
    const finish = async (save, moveTo) => {
      if (done) return; done = true;
      td.classList.remove('editing');
      if (!save) { td.textContent = fmtVal(orig, f); return; }
      const newVal = cellToZoho(inp.value, f);
      const oldVal = orig ?? null;
      if (newVal === oldVal || (newVal === null && (oldVal === '' || oldVal == null))) { td.textContent = fmtVal(orig, f); return; }
      td.textContent = fmtVal(inp.value === '' ? null : inp.value, f);
      td.classList.add('saving');
      try {
        const resp = await api(`/api/record/${mod}/${r.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [cn]: newVal }) });
        const item = (resp.data || [])[0];
        if (item?.status === 'success') {
          r[cn] = newVal;
          td.classList.remove('saving'); td.classList.add('saved');
          setTimeout(() => td.classList.remove('saved'), 1200);
        } else throw new Error(item?.message || 'rejected');
      } catch (e) {
        td.classList.remove('saving'); td.classList.add('errored');
        td.textContent = fmtVal(orig, f);
        toast('Rejected: ' + e.message);
        setTimeout(() => td.classList.remove('errored'), 1500);
      }
      if (moveTo) startEdit(moveTo, moveTo._rec, moveTo._col);
    };
    inp.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); finish(true, cellBelow(td)); }
      else if (ev.key === 'Tab') { ev.preventDefault(); finish(true, ev.shiftKey ? cellPrev(td) : cellNext(td)); }
      else if (ev.key === 'Escape') { finish(false); }
    });
    inp.addEventListener('blur', () => setTimeout(() => finish(true), 0));
  };
  const cellBelow = td => { const idx = td.cellIndex; const nr = td.parentElement.nextElementSibling; return nr ? nr.cells[idx] : null; };
  const cellNext = td => { let n = td.nextElementSibling; while (n && !cellEditable(n._col)) n = n.nextElementSibling; return n; };
  const cellPrev = td => { let n = td.previousElementSibling; while (n && (!n._col || !cellEditable(n._col))) n = n.previousElementSibling; return n; };

  rows.forEach((r, ri) => {
    const tr = el('tr');
    const rn = el('td', 'rownum', String((state.page - 1) * 50 + ri + 1));
    rn.title = 'Open record'; rn.style.cursor = 'pointer';
    rn.onclick = () => location.hash = `#/record/${mod}/${r.id}`;
    tr.appendChild(rn);
    cols.forEach(cn => {
      const f = fm[cn];
      const recordingField = isCallRecordingField(mod, cn);
      const td = recordingField
        ? el('td', 'locked call-recording-table-cell')
        : el('td', cellEditable(cn) ? 'editable' : 'locked', esc(fmtVal(r[cn], f)));
      if (recordingField) td.appendChild(callRecordingControl(r[cn], { compact: true }));
      td._rec = r; td._col = cn;
      if (cellEditable(cn)) td.onclick = () => startEdit(td, r, cn);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  if (!rows.length) tbody.appendChild(el('tr', null, `<td colspan="${cols.length + 1}" style="text-align:center;color:var(--muted);padding:30px">No records</td>`));
  table.appendChild(tbody); wrap.appendChild(table); c.appendChild(wrap);

  const pager = el('div', 'pager');
  const prev = el('button', null, '‹ Prev'); prev.disabled = state.page <= 1;
  const next = el('button', null, 'Next ›'); next.disabled = !more;
  prev.onclick = () => { state.page--; openModule(mod, true); };
  next.onclick = () => { state.page++; openModule(mod, true); };
  pager.append(prev, el('span', 'count', 'Page ' + state.page + ' · click any cell to edit'), next);
  c.appendChild(pager);
}

function exportCSV(mod, cols, rows, fm) {
  const header = cols.map(cn => `"${(fm[cn]?.field_label || cn).replace(/"/g, '""')}"`).join(',');
  const lines = rows.map(r => cols.map(cn => {
    const v = fmtVal(r[cn], fm[cn]);
    return `"${(v === '—' ? '' : v).replace(/"/g, '""')}"`;
  }).join(','));
  const blob = new Blob(['﻿' + [header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = el('a'); a.href = URL.createObjectURL(blob);
  a.download = `${state.moduleByApi[mod]?.plural_label || mod}_page${state.page}.csv`;
  a.click(); URL.revokeObjectURL(a.href);
  toast('CSV downloaded');
}

/* ---------- kanban ---------- */
async function renderKanban(mod, sf, container) {
  const nav = state.nav;
  state.mode = 'kanban';
  const c = container || $('#content');
  let wrap = c.querySelector('.kanbanwrap') || c.querySelector('.tablewrap');
  if (wrap) wrap.remove();
  const pg = c.querySelector('.pager'); if (pg) pg.remove();
  c.querySelectorAll('.viewswitch button').forEach(b => b.classList.toggle('on', b.textContent === 'Kanban'));

  wrap = el('div', 'kanbanwrap', '<div class="loading">Loading kanban…</div>');
  c.appendChild(wrap);

  const nf = nameField(mod);
  const fm = fieldMap(mod);
  const blueprintManaged = state.blueprintByModule?.[mod]?.state_field === sf.api_name;
  const extra = ['Amount', 'Closing_Date', 'Owner', 'Account_Name', 'Company', 'Email', 'Phone', 'Mobile'].filter(f => fm[f]);
  const flds = [nf, sf.api_name, ...extra].filter((v, i, a) => a.indexOf(v) === i);

  let all = [];
  try {
    const q = new URLSearchParams({ page: 1, per_page: 2000, fields: flds.join(',') });
    if (state.cvid) q.set('cvid', state.cvid);
    const d = await api(`/api/records/${mod}?` + q.toString() + dateParams());
    all = d.data || [];
  } catch (e) { /* leave empty */ }
  if (nav !== state.nav) return;

  const stages = (sf.pick_list_values || []).filter(p => p.type !== 'unused').map(p => p.display_value);
  const groups = {}; stages.forEach(s => groups[s] = []);
  all.forEach(r => {
    const s = r[sf.api_name];
    if (!groups[s]) groups[s] = [];
    groups[s].push(r);
  });

  wrap.innerHTML = '';
  const colParts = {}; // stage -> {cards, countEl}
  const refreshCounts = () => Object.entries(colParts).forEach(([, p]) => { p.countEl.textContent = p.cards.children.length; });
  Object.entries(groups).forEach(([stg, recs]) => {
    if (!stages.includes(stg) && !recs.length) return;
    const col = el('div', 'kcol');
    const h3 = el('h3', null, `<span style="display:flex;align-items:center;gap:7px"><span style="width:8px;height:8px;border-radius:3px;background:hsl(${hueOf(stg || '')} 70% 55%)"></span>${esc(stg || '(none)')}</span> <span class="amt"></span>`);
    col.appendChild(h3);
    const cards = el('div', 'kcards');
    recs.forEach(r => {
      const card = el('div', 'kcard');
      card.dataset.rid = r.id;
      card.draggable = !blueprintManaged;
      card.title = blueprintManaged ? 'Use an eligible Blueprint transition from the record detail page.' : 'Drag to another column to change ' + (fm[sf.api_name]?.field_label || 'stage');
      card.appendChild(el('div', 't', esc(fmtVal(r[nf]))));
      const subs = extra.filter(f => f !== 'Owner').map(f => r[f] ? `${esc(fm[f].field_label)}: ${esc(fmtVal(r[f], fm[f]))}` : null).filter(Boolean).slice(0, 3);
      if (r.Owner) subs.push('👤 ' + esc(fmtVal(r.Owner)));
      card.appendChild(el('div', 's', subs.join('<br>')));
      card.onclick = () => location.hash = `#/record/${mod}/${r.id}`;
      if (!blueprintManaged) {
        card.addEventListener('dragstart', e => {
          e.dataTransfer.setData('text/plain', JSON.stringify({ id: r.id, from: stg }));
          e.dataTransfer.effectAllowed = 'move';
          card.classList.add('dragging');
        });
        card.addEventListener('dragend', () => card.classList.remove('dragging'));
      }
      cards.appendChild(card);
    });
    col.appendChild(cards);
    colParts[stg] = { cards, countEl: h3.querySelector('.amt') };
    // drop target: change stage by dragging a card here
    if (!blueprintManaged) col.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; col.classList.add('dropok'); });
    if (!blueprintManaged) col.addEventListener('dragleave', () => col.classList.remove('dropok'));
    if (!blueprintManaged) col.addEventListener('drop', async e => {
      e.preventDefault();
      col.classList.remove('dropok');
      let payload;
      try { payload = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
      if (!payload?.id || payload.from === stg) return;
      const cardEl = wrap.querySelector(`.kcard[data-rid="${payload.id}"]`);
      const fromParts = colParts[payload.from];
      if (cardEl) { cards.insertBefore(cardEl, cards.firstChild); refreshCounts(); }
      const pv = (sf.pick_list_values || []).find(p => p.display_value === stg);
      try {
        await api(`/api/record/${mod}/${payload.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [sf.api_name]: pv?.actual_value ?? stg }) });
        toast(`Moved to "${stg}" ✓`);
      } catch (err) {
        if (cardEl && fromParts) { fromParts.cards.appendChild(cardEl); refreshCounts(); }
        toast('Failed: ' + err.message);
      }
    });
    wrap.appendChild(col);
  });
  refreshCounts();
  if (!wrap.children.length) wrap.innerHTML = '<div class="loading">No records</div>';
}

/* ---------- record detail ---------- */
function transitionInputElement(input, field, current) {
  let control;
  const type = field?.data_type || input.data_type;
  if (type === 'picklist') {
    control = el('select');
    const blank = el('option'); blank.value = ''; blank.textContent = '-None-'; control.appendChild(blank);
    (field?.pick_list_values || []).filter(option => option.type !== 'unused' && option.display_value !== '-None-' && option.actual_value !== '-None-').forEach(option => {
      const item = el('option'); item.value = option.actual_value ?? option.display_value; item.textContent = option.display_value;
      if (current === item.value || current === option.display_value) item.selected = true;
      control.appendChild(item);
    });
  } else if (type === 'datetime') {
    control = el('input'); control.type = 'datetime-local'; control.value = current ? String(current).slice(0, 16) : '';
  } else if (type === 'date') {
    control = el('input'); control.type = 'date'; control.value = current || '';
  } else if (['integer','double','currency','percent','bigint'].includes(type)) {
    control = el('input'); control.type = 'number'; control.step = ['integer','bigint'].includes(type) ? '1' : 'any'; control.value = current ?? '';
  } else if (type === 'file') {
    control = el('input'); control.type = 'file';
  } else {
    control = input.kind === 'associated_item' || type === 'textarea' ? el('textarea') : el('input');
    if (control.tagName === 'INPUT') control.type = 'text';
    control.value = current ?? '';
  }
  control.dataset.dt = type || 'text';
  control.required = input.required === true;
  return control;
}

/* Designer Form local-only preview start */
function designerPreviewLayoutId(record) {
  return String(record?.Layout?.id || record?.$layout_id?.id || '');
}

function isDesignerFormPreviewInput(mod, record, blueprint, transition, input) {
  const owners = transition?.before?.owners;
  const criteria = transition?.before?.criteria;
  return mod === 'Contacts'
    && designerPreviewLayoutId(record) === '1032257000000000171'
    && String(blueprint?.blueprint_id || '') === '1032257000001044611'
    && blueprint?.blueprint === 'Opportunity Stage'
    && blueprint?.state_field === 'Stage'
    && blueprint?.current === 'Validated By SM'
    && blueprint?.local === true
    && String(transition?.id || '') === '1032257000010677581'
    && transition?.name === 'Design Form'
    && transition?.next_value === 'Design Form Filled'
    && transition?.next_actual_value === 'Assigned Designer'
    && transition?.common === true
    && transition?.trigger_type === 'manual'
    && transition?.executable === false
    && Array.isArray(owners) && owners.length === 1 && owners[0] === 'All Users'
    && Array.isArray(criteria) && criteria.length === 0
    && input?.kind === 'widget'
    && String(input?.widget_id || '') === '1032257000010677855'
    && input?.name === 'Designer Form Widget'
    && input?.label === 'Designer Form Widget'
    && input?.api_name === null
    && input?.data_type === 'widget'
    && input?.required === false
    && input?.sequence === 1
    && input?.definition_status === 'Captured package validated; original read-only local preview implemented'
    && typeof window.DesignerFormPreview?.createContext === 'function'
    && typeof window.DesignerFormPreview?.buildDesignerDraft === 'function';
}

function designerPreviewScalar(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value.actual_value ?? value.display_value ?? '';
  }
  return value ?? '';
}

function designerPreviewFieldMetadata(fields, fieldTypes) {
  return Object.entries(fieldTypes).flatMap(([apiName, dataType]) => {
    const field = (fields || []).find(item => item?.api_name === apiName && item?.data_type === dataType);
    return field ? [{ apiName, dataType }] : [];
  });
}

function designerPreviewProjectDescriptors(rows) {
  return (rows || [])
    .filter(row => String(designerPreviewScalar(row?.Stage) || '').trim() === 'None')
    .map((row, index) => ({
      ordinal: index + 1,
      productType: String(designerPreviewScalar(row?.Product_Type) || '').trim(),
    }));
}

function renderDesignerFormPreview(container, contactId, idPrefix) {
  const preview = window.DesignerFormPreview;
  const panel = el('section', 'designer-preview-panel');
  panel.setAttribute('aria-label', 'Designer Form read-only preview');
  const header = el('div', 'designer-preview-header');
  header.append(el('span', 'estimate-preview-badge', 'Read-only preview'), el('h3', null, 'Anonymized design drafts'));
  panel.appendChild(header);
  panel.appendChild(el('div', 'designer-preview-warning', 'This original local preview uses only the current Contacts record binding, current Deals field metadata, and the exact All_Orders relationship. Project identities are not displayed or copied. It cannot update an Order, create a note, upload a file, trigger a workflow, or continue the Blueprint.'));
  const loading = el('div', 'bp-phase-summary', 'Loading verified local All_Orders data and Deals metadata…');
  panel.appendChild(loading);
  container.appendChild(panel);

  Promise.all([
    getFields('Deals'),
    api(`/api/related/Contacts/${encodeURIComponent(contactId)}/All_Orders?page=1&per_page=200`),
  ]).then(([fields, relationship]) => {
    if (!panel.isConnected) return;
    const exactRelationship = relationship?.availability === 'queryable'
      && relationship?.related_module === 'Deals'
      && Array.isArray(relationship?.link_fields)
      && relationship.link_fields.length === 1
      && relationship.link_fields[0] === 'Opportunity_Name'
      && relationship?.link_basis === 'Exact source lookup relation'
      && relationship?.pagination?.page === 1
      && relationship?.pagination?.per_page === 200
      && relationship?.pagination?.limit_applied === true
      && relationship?.pagination?.has_more === false
      && Array.isArray(relationship?.data)
      && relationship?.pagination?.returned === relationship.data.length;
    if (!exactRelationship) {
      loading.className = 'designer-preview-error';
      loading.textContent = 'The exact local Contacts → All_Orders relationship is unavailable or incomplete. No draft was generated and no action was performed.';
      return;
    }
    const projects = designerPreviewProjectDescriptors(relationship.data);
    if (!projects.length) {
      loading.className = 'designer-preview-empty';
      loading.textContent = 'No related All_Orders project is currently at source Stage “None”. Nothing was changed.';
      return;
    }
    let context;
    try {
      context = preview.createContext({
        fieldMetadata: designerPreviewFieldMetadata(fields, preview.constants.fieldTypes),
        projects,
      });
    } catch (error) {
      loading.className = 'designer-preview-error';
      loading.textContent = 'The local project types or exact Deals field metadata do not satisfy the reviewed Designer Form contract. No draft was generated and no action was performed.';
      return;
    }

    loading.remove();
    const form = el('div', 'designer-preview-form');
    const controls = [];
    let fieldSequence = 0;
    const makeField = (labelText, control, hint = '') => {
      fieldSequence += 1;
      const field = el('div', 'designer-preview-field');
      const controlId = `${idPrefix}-field-${fieldSequence}`;
      const label = el('label');
      label.htmlFor = controlId;
      label.textContent = labelText;
      control.id = controlId;
      field.append(label, control);
      if (hint) {
        const hintNode = el('small', null, esc(hint));
        hintNode.id = `${controlId}-hint`;
        control.setAttribute('aria-describedby', hintNode.id);
        field.appendChild(hintNode);
      }
      return field;
    };
    const selectControl = (options, placeholder, { multiple = false } = {}) => {
      const select = el('select');
      select.multiple = multiple;
      select.required = true;
      if (multiple) select.size = Math.min(6, Math.max(2, options.length));
      else select.appendChild(Object.assign(el('option', null, esc(placeholder)), { value: '' }));
      options.forEach(value => select.appendChild(Object.assign(el('option', null, esc(value)), { value })));
      return select;
    };

    context.projects.forEach(project => {
      const group = el('fieldset', 'designer-preview-project');
      group.appendChild(el('legend', null, `${esc(project.label)} · ${esc(project.productType)}`));
      const grid = el('div', 'designer-preview-grid');
      const presentation = selectControl(project.presentationOptions, 'Select presentation');
      const designTheme = selectControl(project.themeOptions, 'Select design theme');
      const ceilingHeight = el('input'); ceilingHeight.type = 'text'; ceilingHeight.required = true; ceilingHeight.maxLength = preview.constants.limits.ceilingHeight;
      const designRequiredOn = el('input'); designRequiredOn.type = 'date'; designRequiredOn.required = true;
      const city = el('input'); city.type = 'text'; city.required = true; city.maxLength = preview.constants.limits.city;
      const roomAreaName = el('input'); roomAreaName.type = 'text'; roomAreaName.required = true; roomAreaName.maxLength = preview.constants.limits.roomAreaName;
      grid.append(
        makeField('Design presentation *', presentation),
        makeField('Design theme *', designTheme),
        makeField('Finished ceiling height *', ceilingHeight),
        makeField('Design required on *', designRequiredOn),
        makeField('City *', city, 'Mapped to the current local Deals API field “city”.'),
        makeField('Room / area name *', roomAreaName),
      );
      const projectControls = {
        ordinal: project.ordinal,
        presentation,
        designTheme,
        ceilingHeight,
        designRequiredOn,
        city,
        roomAreaName,
        kitchenTypes: null,
        kitchenHeight: null,
        island: null,
        gas: null,
        vastu: null,
        wardrobeTypes: null,
        wardrobeHeight: null,
      };
      if (project.productType === 'Kitchen') {
        projectControls.kitchenTypes = selectControl(preview.constants.kitchenTypes, '', { multiple: true });
        projectControls.kitchenHeight = selectControl(preview.constants.kitchenHeights, 'Select kitchen height');
        projectControls.island = selectControl(preview.constants.islandOptions, 'Select island');
        projectControls.gas = selectControl(preview.constants.gasOptions, 'Select gas arrangement');
        projectControls.vastu = selectControl(preview.constants.vastuOptions, 'Select Vastu requirement');
        grid.append(
          makeField('Kitchen types *', projectControls.kitchenTypes, 'Select one or more.'),
          makeField('Kitchen height *', projectControls.kitchenHeight),
          makeField('Island *', projectControls.island),
          makeField('Gas arrangement *', projectControls.gas),
          makeField('Vastu requirement *', projectControls.vastu),
        );
      } else if (project.productType === 'Wardrobe') {
        projectControls.wardrobeTypes = selectControl(preview.constants.wardrobeTypes, '', { multiple: true });
        projectControls.wardrobeHeight = selectControl(preview.constants.wardrobeHeights, 'Select wardrobe height');
        grid.append(
          makeField('Wardrobe types *', projectControls.wardrobeTypes, 'Select one or more.'),
          makeField('Wardrobe height *', projectControls.wardrobeHeight),
        );
      }
      controls.push(projectControls);
      group.appendChild(grid);
      form.appendChild(group);
    });

    const generate = el('button', 'btn-primary designer-preview-generate', 'Generate sanitized drafts');
    generate.type = 'button';
    const result = el('section', 'designer-preview-result is-empty');
    result.setAttribute('aria-live', 'polite');
    result.appendChild(el('p', null, 'Complete each project form to generate immutable, non-persisted drafts.'));
    generate.onclick = () => {
      try {
        const drafts = preview.buildDesignerDraft({
          context,
          projects: controls.map(control => ({
            ceilingHeight: control.ceilingHeight.value,
            city: control.city.value,
            designRequiredOn: control.designRequiredOn.value,
            designTheme: control.designTheme.value,
            gas: control.gas?.value || '',
            island: control.island?.value || '',
            kitchenHeight: control.kitchenHeight?.value || '',
            kitchenTypes: control.kitchenTypes ? [...control.kitchenTypes.selectedOptions].map(option => option.value) : [],
            ordinal: control.ordinal,
            presentation: control.presentation.value,
            roomAreaName: control.roomAreaName.value,
            vastu: control.vastu?.value || '',
            wardrobeHeight: control.wardrobeHeight?.value || '',
            wardrobeTypes: control.wardrobeTypes ? [...control.wardrobeTypes.selectedOptions].map(option => option.value) : [],
          })),
        });
        result.className = 'designer-preview-result';
        result.replaceChildren(el('h4', null, 'Sanitized Designer Form drafts'));
        drafts.projects.forEach(draft => {
          const project = el('section', 'designer-preview-draft');
          project.appendChild(el('h5', null, `${esc(draft.project_label)} · ${esc(draft.product_type)}`));
          const fieldsList = el('dl');
          Object.entries(draft.fields).forEach(([apiName, value]) => {
            fieldsList.append(
              el('dt', null, esc(apiName.replace(/_/g, ' '))),
              el('dd', null, esc(Array.isArray(value) ? value.join(', ') : value)),
            );
          });
          project.appendChild(fieldsList);
          result.appendChild(project);
        });
        result.appendChild(el('small', null, `Not persisted · Disabled: ${drafts.blocked_actions.join(', ')}.`));
      } catch (error) {
        result.className = 'designer-preview-result is-error';
        result.replaceChildren(el('p', null, 'The drafts could not be generated from these inputs. No CRM or Blueprint action was performed.'));
        const index = Number(String(error?.code || '').match(/PROJECT_(\d+)/)?.[1] || 1) - 1;
        controls[Math.max(0, index)]?.presentation?.focus();
      }
    };
    form.append(generate, result);
    panel.appendChild(form);
  }).catch(() => {
    if (!panel.isConnected) return;
    loading.className = 'designer-preview-error';
    loading.textContent = 'Required local metadata or All_Orders data is unavailable. No draft was generated and no action was performed.';
  });
}

let activeDesignerFormPreviewClose = null;
let designerFormPreviewSequence = 0;
function openDesignerFormPreview(mod, contactId, record, blueprint, transition, input, restoreFocus = document.activeElement) {
  if (!isDesignerFormPreviewInput(mod, record, blueprint, transition, input)) {
    toast('Designer Form preview is unavailable. No CRM or Blueprint action was performed.');
    return;
  }
  if (activeJourneyDialogClose) activeJourneyDialogClose(false);
  if (activeEstimatePreviewClose) activeEstimatePreviewClose(false);
  if (activeAssignTechnicianPreviewClose) activeAssignTechnicianPreviewClose(false);
  if (activeDesignerFormPreviewClose) activeDesignerFormPreviewClose(false);
  if (activePaymentMilestonePreviewClose) activePaymentMilestonePreviewClose(false);
  if (activeReviseQuotePreviewClose) activeReviseQuotePreviewClose(false);
  if (activeReviseApproveAnyStagePreviewClose) activeReviseApproveAnyStagePreviewClose(false);
  if (activeClosureNewPreviewClose) activeClosureNewPreviewClose(false);
  if (activeBlueprintTransitionClose) activeBlueprintTransitionClose(false);
  const modal = $('#modal'), box = $('#modalBox');
  box.innerHTML = '';
  designerFormPreviewSequence += 1;
  const idPrefix = `designer-form-preview-${designerFormPreviewSequence}`;
  const titleId = `${idPrefix}-title`;
  const header = el('div', 'mh designer-preview-modal-head');
  const headingWrap = el('div', 'designer-preview-heading');
  headingWrap.append(el('span', 'estimate-preview-badge', 'Read-only preview'));
  const heading = el('h2', null, 'Designer Form');
  heading.id = titleId;
  headingWrap.appendChild(heading);
  const close = el('button', 'x', '✕');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close Designer Form preview');
  let keyHandler = null;
  const shut = (returnFocus = true) => {
    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    if (activeDesignerFormPreviewClose === shut) activeDesignerFormPreviewClose = null;
    modal.classList.add('hidden');
    modal.removeAttribute('role');
    modal.removeAttribute('aria-modal');
    modal.removeAttribute('aria-labelledby');
    if (returnFocus && restoreFocus && document.contains(restoreFocus)) restoreFocus.focus();
  };
  activeDesignerFormPreviewClose = shut;
  close.onclick = shut;
  header.append(headingWrap, close);
  const body = el('div', 'mb designer-preview-modal-body');
  renderDesignerFormPreview(body, contactId, idPrefix);
  const footer = el('div', 'mf');
  const done = el('button', null, 'Close preview');
  done.type = 'button';
  done.onclick = shut;
  footer.appendChild(done);
  box.append(header, body, footer);
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', titleId);
  modal.classList.remove('hidden');
  keyHandler = event => {
    if (event.key === 'Escape' && !modal.classList.contains('hidden')) shut();
  };
  document.addEventListener('keydown', keyHandler);
  close.focus();
}
/* Designer Form local-only preview end */

/* Payment Milestone local-only preview start */
function paymentPreviewLayoutId(record) {
  return String(record?.Layout?.id || record?.$layout_id?.id || '');
}

function isPaymentMilestonePreviewInput(mod, record, blueprint, transition, input) {
  const owners = transition?.before?.owners;
  const criteria = transition?.before?.criteria;
  return mod === 'Contacts'
    && paymentPreviewLayoutId(record) === '1032257000000000171'
    && String(blueprint?.blueprint_id || '') === '1032257000001044611'
    && blueprint?.blueprint === 'Opportunity Stage'
    && blueprint?.state_field === 'Stage'
    // Mirrored records and the local Blueprint endpoint expose the source
    // state's display value. The captured state's distinct actual value is
    // retained in Blueprint evidence, but it is not the record value here.
    && blueprint?.current === 'Price Discussion'
    && blueprint?.local === true
    && String(transition?.id || '') === '1032257000025407036'
    && transition?.name === 'Create Payment Terms'
    && transition?.next_value === 'Principally Closed'
    && transition?.next_actual_value === 'Payment Awaited'
    && transition?.common === false
    && transition?.trigger_type === 'manual'
    && transition?.executable === false
    && Array.isArray(owners) && owners.length === 1 && owners[0] === 'Specific Users (1)'
    && Array.isArray(criteria) && criteria.length === 0
    && Array.isArray(transition?.during_inputs)
    && transition.during_inputs.length === 1
    && transition.during_inputs[0] === input
    && Array.isArray(transition?.after_actions)
    && transition.after_actions.length === 0
    && input?.kind === 'widget'
    && String(input?.widget_id || '') === '1032257000007994308'
    && input?.name === 'Payment Milestone Widget'
    && input?.label === 'Payment Milestone Widget'
    && input?.api_name === null
    && input?.data_type === 'widget'
    && input?.required === false
    && input?.sequence === 1
    && input?.definition_status === 'Captured package validated; original read-only local allocation preview implemented'
    && typeof window.PaymentMilestonePreview?.createContext === 'function'
    && typeof window.PaymentMilestonePreview?.buildPaymentMilestoneDraft === 'function';
}

function paymentPreviewScalar(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value.actual_value ?? value.display_value ?? '';
  }
  return value ?? '';
}

function paymentPreviewFieldMetadata(fields, fieldTypes) {
  return Object.entries(fieldTypes).flatMap(([apiName, dataType]) => {
    const field = (fields || []).find(item => item?.api_name === apiName && item?.data_type === dataType);
    return field ? [{ apiName, dataType }] : [];
  });
}

function paymentPreviewToday() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function paymentPreviewRecordSnapshot(record) {
  const rawAccessories = paymentPreviewScalar(record?.No_of_Accessories);
  const productRows = Array.isArray(record?.Product_Details1) ? record.Product_Details1 : [];
  return {
    accessories: rawAccessories === '' || rawAccessories === null ? null : Number(rawAccessories),
    amountAfterDiscountLacs: Number(paymentPreviewScalar(record?.Amount_After_Discount)),
    closureDate: String(paymentPreviewScalar(record?.Est_Closoure_Date) || '').slice(0, 10),
    followUpDateTime: String(paymentPreviewScalar(record?.Next_Follow_Up_Date1) || '').slice(0, 16),
    grandTotalLacs: Number(paymentPreviewScalar(record?.Grand_Total)),
    managementDiscount: Number(paymentPreviewScalar(record?.Management_Discount_Proposed) || 0),
    productCount: productRows.length,
    quotationPresent: Boolean(String(paymentPreviewScalar(record?.Quotation_Link) || '').trim()),
    regionPresent: Boolean(String(paymentPreviewScalar(record?.Region) || '').trim()),
  };
}

function renderPaymentMilestonePreview(container, contactId, record, idPrefix) {
  const preview = window.PaymentMilestonePreview;
  const panel = el('section', 'payment-preview-panel');
  panel.setAttribute('aria-label', 'Payment Milestone read-only preview');
  const header = el('div', 'payment-preview-header');
  header.append(el('span', 'estimate-preview-badge', 'Read-only preview'), el('h3', null, 'Display-only payment allocation'));
  panel.appendChild(header);
  panel.appendChild(el('div', 'payment-preview-warning', 'This original local preview calculates an immutable schedule from the current local formula snapshot. It uses only exact Contacts metadata and the verified Payment_Milestones relationship, reduces existing rows to a count, and does not expose milestone or customer identities. Specific-user permission is not asserted, and the captured Amount_To_Be_Paid target is absent locally, so no schedule is represented as CRM-write compatible.'));
  const loading = el('div', 'bp-phase-summary', 'Loading verified local payment metadata and relationship evidence…');
  panel.appendChild(loading);
  container.appendChild(panel);

  Promise.all([
    getFields('Contacts'),
    getFields('Payment_Milestones'),
    api(`/api/related/Contacts/${encodeURIComponent(contactId)}/Payment_Milestones?page=1&per_page=200`),
  ]).then(([contactFields, paymentFields, relationship]) => {
    if (!panel.isConnected) return;
    const exactRelationship = relationship?.availability === 'queryable'
      && relationship?.related_module === 'Payment_Milestones'
      && Array.isArray(relationship?.link_fields)
      && relationship.link_fields.length === 1
      && relationship.link_fields[0] === 'Opportunity_Name'
      && relationship?.link_basis === 'Exact source lookup relation'
      && relationship?.pagination?.page === 1
      && relationship?.pagination?.per_page === 200
      && relationship?.pagination?.limit_applied === true
      && relationship?.pagination?.has_more === false
      && Array.isArray(relationship?.data)
      && relationship?.pagination?.returned === relationship.data.length;
    if (!exactRelationship) {
      loading.className = 'payment-preview-error';
      loading.textContent = 'The exact local Contacts → Payment_Milestones relationship is unavailable or incomplete. No draft was generated and no action was performed.';
      return;
    }
    const sourceTargetFieldAvailable = paymentFields.some(field => field?.api_name === preview.constants.sourceAmountTarget);
    let context;
    try {
      context = preview.createContext({
        contactFieldMetadata: paymentPreviewFieldMetadata(contactFields, preview.constants.contactFieldTypes),
        existingMilestoneCount: relationship.data.length,
        paymentFieldMetadata: paymentPreviewFieldMetadata(paymentFields, preview.constants.paymentFieldTypes),
        recordSnapshot: paymentPreviewRecordSnapshot(record),
        sourceTargetFieldAvailable,
        today: paymentPreviewToday(),
      });
    } catch (error) {
      loading.className = 'payment-preview-error';
      loading.textContent = sourceTargetFieldAvailable
        ? 'The local target-field evidence changed and requires review before this preview can run. No action was performed.'
        : 'The current record or exact local field metadata does not satisfy the reviewed Payment Milestone contract. No draft was generated and no action was performed.';
      return;
    }

    loading.remove();
    const basis = el('dl', 'payment-preview-basis');
    [
      ['Amount after discount · current formula', `${context.recordSnapshot.amountAfterDiscountLacs.toLocaleString('en-IN')} lakh`],
      ['Grand total · current formula', `${context.recordSnapshot.grandTotalLacs.toLocaleString('en-IN')} lakh`],
      ['Existing milestones', String(context.existingMilestoneCount)],
      ['Source amount target', 'Unavailable locally · display only'],
    ].forEach(([label, value]) => basis.append(el('dt', null, esc(label)), el('dd', null, esc(value))));
    panel.appendChild(basis);

    const form = el('div', 'payment-preview-form');
    let fieldSequence = 0;
    const makeField = (labelText, control, hint = '') => {
      fieldSequence += 1;
      const field = el('div', 'payment-preview-field');
      const controlId = `${idPrefix}-field-${fieldSequence}`;
      const label = el('label');
      label.htmlFor = controlId;
      label.textContent = labelText;
      control.id = controlId;
      field.append(label, control);
      if (hint) {
        const hintNode = el('small', null, esc(hint));
        hintNode.id = `${controlId}-hint`;
        control.setAttribute('aria-describedby', hintNode.id);
        field.appendChild(hintNode);
      }
      return field;
    };

    const closureDate = el('input');
    closureDate.type = 'date'; closureDate.required = true; closureDate.min = context.today;
    closureDate.value = context.recordSnapshot.closureDate;
    const followUp = el('input');
    followUp.type = 'datetime-local'; followUp.required = true; followUp.min = `${context.today}T00:00`;
    followUp.value = context.recordSnapshot.followUpDateTime;
    const preset = el('select');
    [
      ['3.2', '3 milestones · 50 / 30 / 20'],
      ['2', '2 milestones · 50 / 50'],
    ].forEach(([value, label]) => preset.appendChild(Object.assign(el('option', null, label), { value })));
    const retention = el('input');
    retention.type = 'number'; retention.min = '0'; retention.max = '15'; retention.step = '0.01'; retention.value = '0'; retention.required = true;
    form.append(
      makeField('Estimated closure date *', closureDate),
      makeField('Next follow-up date and time *', followUp),
      makeField('Milestone preset *', preset),
      makeField('Retention percentage *', retention, '0–15%. Retention is deducted from the last Magppie milestone.'),
    );

    const rowsFieldset = el('fieldset', 'payment-preview-rows');
    rowsFieldset.appendChild(el('legend', null, 'Magppie milestones · must total 100%'));
    const rowsGrid = el('div', 'payment-preview-row-grid');
    rowsFieldset.appendChild(rowsGrid);
    form.appendChild(rowsFieldset);
    let rowControls = [];
    const rebuildRows = () => {
      rowsGrid.replaceChildren();
      rowControls = preview.constants.presets[preset.value].map((row, index) => {
        const purpose = el('select');
        preview.constants.milestoneNames.forEach(value => purpose.appendChild(Object.assign(el('option', null, esc(value)), { value })));
        purpose.value = row.purpose;
        const percent = el('input');
        percent.type = 'number'; percent.min = '0'; percent.max = '100'; percent.step = '0.01'; percent.value = String(row.percent); percent.required = true;
        const group = el('section', 'payment-preview-row');
        group.setAttribute('aria-label', `Milestone ${index + 1}`);
        group.append(makeField(`Milestone ${index + 1} purpose *`, purpose), makeField(`Milestone ${index + 1} percentage *`, percent));
        rowsGrid.appendChild(group);
        return { percent, purpose };
      });
    };
    preset.onchange = rebuildRows;
    rebuildRows();

    const sunrooofFieldset = el('fieldset', 'payment-preview-sunrooof');
    const sunrooofLegend = el('legend');
    const sunrooofEnabled = el('input'); sunrooofEnabled.type = 'checkbox';
    const sunrooofLabel = el('label');
    const sunrooofId = `${idPrefix}-sunrooof-enabled`;
    sunrooofEnabled.id = sunrooofId; sunrooofLabel.htmlFor = sunrooofId;
    sunrooofLabel.append(sunrooofEnabled, document.createTextNode(' Include Sunrooof payment milestone'));
    sunrooofLegend.appendChild(sunrooofLabel);
    sunrooofFieldset.appendChild(sunrooofLegend);
    const sunrooofGrid = el('div', 'payment-preview-sunrooof-grid hidden');
    const sunrooofTotal = el('input'); sunrooofTotal.type = 'number'; sunrooofTotal.min = '0'; sunrooofTotal.step = '0.01';
    const sunrooofBooking = el('input'); sunrooofBooking.type = 'number'; sunrooofBooking.min = '0'; sunrooofBooking.step = '0.01';
    const sunrooofDiscount = el('input'); sunrooofDiscount.type = 'number'; sunrooofDiscount.min = '0'; sunrooofDiscount.step = '0.01';
    sunrooofGrid.append(
      makeField('Sunrooof total amount *', sunrooofTotal),
      makeField('Sunrooof order booking amount *', sunrooofBooking),
      makeField('Sunrooof management discount', sunrooofDiscount),
    );
    sunrooofEnabled.onchange = () => {
      sunrooofGrid.classList.toggle('hidden', !sunrooofEnabled.checked);
      [sunrooofTotal, sunrooofBooking].forEach(control => { control.required = sunrooofEnabled.checked; });
      if (!sunrooofEnabled.checked) [sunrooofTotal, sunrooofBooking, sunrooofDiscount].forEach(control => { control.value = ''; });
    };
    sunrooofFieldset.appendChild(sunrooofGrid);
    form.appendChild(sunrooofFieldset);

    const generate = el('button', 'btn-primary payment-preview-generate', 'Generate display-only schedule');
    generate.type = 'button';
    const result = el('section', 'payment-preview-result is-empty');
    result.setAttribute('aria-live', 'polite');
    result.appendChild(el('p', null, 'Complete the allocation to generate an immutable, non-persisted schedule.'));
    generate.onclick = () => {
      const validationControls = [closureDate, followUp, retention, sunrooofEnabled, sunrooofTotal, sunrooofBooking, sunrooofDiscount];
      rowControls.forEach(row => validationControls.push(row.percent, row.purpose));
      validationControls.forEach(control => control.removeAttribute('aria-invalid'));
      try {
        const draft = preview.buildPaymentMilestoneDraft({
          closureDate: closureDate.value,
          context,
          followUpDateTime: followUp.value,
          preset: preset.value,
          retentionPercent: Number(retention.value),
          rows: rowControls.map(row => ({ percent: Number(row.percent.value), purpose: row.purpose.value })),
          sunrooof: {
            booking: Number(sunrooofBooking.value || 0),
            discount: Number(sunrooofDiscount.value || 0),
            enabled: sunrooofEnabled.checked,
            total: Number(sunrooofTotal.value || 0),
          },
        });
        result.className = 'payment-preview-result';
        result.replaceChildren(el('h4', null, 'Display-only payment schedule'));
        const tableWrap = el('div', 'payment-preview-table-wrap');
        const table = el('table', 'payment-preview-table');
        const thead = el('thead');
        const headRow = el('tr');
        ['#', 'Milestone', '%', 'Amount allocation', 'Grand total allocation'].forEach(label => headRow.appendChild(el('th', null, label)));
        thead.appendChild(headRow); table.appendChild(thead);
        const tbody = el('tbody');
        draft.schedule.forEach(row => {
          const tr = el('tr');
          [
            row.serial_number,
            row.milestone,
            row.percentage,
            `₹${Number(row.calculated_amount_after_discount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
            `₹${Number(row.calculated_grand_total).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
          ].forEach(value => tr.appendChild(el('td', null, esc(value))));
          tbody.appendChild(tr);
        });
        table.appendChild(tbody); tableWrap.appendChild(table); result.appendChild(tableWrap);
        const contactDraft = el('dl', 'payment-preview-contact-draft');
        Object.entries(draft.contact_draft).forEach(([field, value]) => {
          contactDraft.append(el('dt', null, esc(field.replace(/_/g, ' '))), el('dd', null, esc(value ?? 'Not set')));
        });
        result.append(el('h5', null, 'Non-persisted Contact values'), contactDraft);
        result.appendChild(el('small', null, `Current formula snapshot · ${draft.runtime_evidence.source_amount_target} unavailable locally · Disabled: ${draft.blocked_actions.join(', ')}.`));
      } catch (error) {
        const code = String(error?.code || '');
        let invalidControl = rowControls[0]?.percent || generate;
        let message = 'Check the milestone names and percentages. The milestone percentages must total 100%.';
        if (code.startsWith('CLOSURE')) {
          invalidControl = closureDate;
          message = 'Enter an estimated closure date that is today or later.';
        } else if (code.startsWith('FOLLOW')) {
          invalidControl = followUp;
          message = 'Enter a valid next follow-up date and time that is today or later.';
        } else if (code.startsWith('RETENTION')) {
          invalidControl = retention;
          message = 'Enter a retention percentage from 0% to 15% that does not exceed the final milestone.';
        } else if (code === 'SUNROOOF_VALUES_REQUIRED') {
          invalidControl = Number(sunrooofTotal.value) > 0 ? sunrooofBooking : sunrooofTotal;
          message = 'Enter positive Sunrooof total and order-booking amounts.';
        } else if (code.includes('SUNROOOF_TOTAL')) {
          invalidControl = sunrooofTotal;
          message = 'Enter a valid Sunrooof total below the Contact grand total.';
        } else if (code.includes('SUNROOOF_BOOKING')) {
          invalidControl = sunrooofBooking;
          message = 'Enter a valid Sunrooof order-booking amount that does not exceed its total.';
        } else if (code.includes('SUNROOOF_DISCOUNT')) {
          invalidControl = sunrooofDiscount;
          message = 'Enter a valid Sunrooof management discount that does not exceed its total.';
        } else if (code.startsWith('SUNROOOF')) {
          invalidControl = sunrooofEnabled;
          message = 'Review the Sunrooof allocation values and try again.';
        }
        result.className = 'payment-preview-result is-error';
        result.replaceChildren(el('p', null, `${message} No CRM or Blueprint action was performed.`));
        invalidControl.setAttribute('aria-invalid', 'true');
        invalidControl.focus();
      }
    };
    form.append(generate, result);
    panel.appendChild(form);
  }).catch(() => {
    if (!panel.isConnected) return;
    loading.className = 'payment-preview-error';
    loading.textContent = 'Required local metadata or Payment_Milestones data is unavailable. No draft was generated and no action was performed.';
  });
}

let activePaymentMilestonePreviewClose = null;
let paymentMilestonePreviewSequence = 0;
function openPaymentMilestonePreview(mod, contactId, record, blueprint, transition, input, restoreFocus = document.activeElement) {
  if (!isPaymentMilestonePreviewInput(mod, record, blueprint, transition, input)) {
    toast('Payment Milestone preview is unavailable. No CRM or Blueprint action was performed.');
    return;
  }
  if (activeJourneyDialogClose) activeJourneyDialogClose(false);
  if (activeEstimatePreviewClose) activeEstimatePreviewClose(false);
  if (activeAssignTechnicianPreviewClose) activeAssignTechnicianPreviewClose(false);
  if (activeDesignerFormPreviewClose) activeDesignerFormPreviewClose(false);
  if (activePaymentMilestonePreviewClose) activePaymentMilestonePreviewClose(false);
  if (activeReviseQuotePreviewClose) activeReviseQuotePreviewClose(false);
  if (activeReviseApproveAnyStagePreviewClose) activeReviseApproveAnyStagePreviewClose(false);
  if (activeClosureNewPreviewClose) activeClosureNewPreviewClose(false);
  if (activeBlueprintTransitionClose) activeBlueprintTransitionClose(false);
  const modal = $('#modal'), box = $('#modalBox');
  box.innerHTML = '';
  paymentMilestonePreviewSequence += 1;
  const idPrefix = `payment-milestone-preview-${paymentMilestonePreviewSequence}`;
  const titleId = `${idPrefix}-title`;
  const header = el('div', 'mh payment-preview-modal-head');
  const headingWrap = el('div', 'payment-preview-heading');
  headingWrap.append(el('span', 'estimate-preview-badge', 'Read-only preview'));
  const heading = el('h2', null, 'Payment Milestones');
  heading.id = titleId;
  headingWrap.appendChild(heading);
  const close = el('button', 'x', '✕');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close Payment Milestone preview');
  const shell = $('#shell');
  const shellWasInert = shell?.hasAttribute('inert') === true;
  if (shell) shell.setAttribute('inert', '');
  let keyHandler = null;
  const shut = (returnFocus = true) => {
    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    if (activePaymentMilestonePreviewClose === shut) activePaymentMilestonePreviewClose = null;
    modal.classList.add('hidden');
    modal.removeAttribute('role');
    modal.removeAttribute('aria-modal');
    modal.removeAttribute('aria-labelledby');
    if (shell && !shellWasInert) shell.removeAttribute('inert');
    if (returnFocus && restoreFocus && document.contains(restoreFocus)) restoreFocus.focus();
  };
  activePaymentMilestonePreviewClose = shut;
  close.onclick = shut;
  header.append(headingWrap, close);
  const body = el('div', 'mb payment-preview-modal-body');
  renderPaymentMilestonePreview(body, contactId, record, idPrefix);
  const footer = el('div', 'mf');
  const done = el('button', null, 'Close preview');
  done.type = 'button';
  done.onclick = shut;
  footer.appendChild(done);
  box.append(header, body, footer);
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', titleId);
  modal.classList.remove('hidden');
  keyHandler = event => {
    if (event.key === 'Escape' && !modal.classList.contains('hidden')) shut();
    if (event.key === 'Tab' && !modal.classList.contains('hidden')) {
      const focusable = Array.from(box.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'))
        .filter(node => node.getClientRects().length > 0 && !node.closest('.hidden'));
      event.preventDefault();
      if (!focusable.length) return;
      const activeIndex = focusable.indexOf(document.activeElement);
      const nextIndex = activeIndex < 0
        ? (event.shiftKey ? focusable.length - 1 : 0)
        : (activeIndex + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
      focusable[nextIndex].focus();
    }
  };
  document.addEventListener('keydown', keyHandler);
  close.focus();
}
/* Payment Milestone local-only preview end */

/* Revise Quote local-only preview start */
function reviseQuotePreviewLayoutId(record) {
  return String(record?.Layout?.id || record?.$layout_id?.id || '');
}

function reviseQuotePreviewScalar(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value.display_value ?? value.actual_value ?? '';
  }
  return value ?? '';
}

function isReviseQuotePreviewInput(mod, record, blueprint, transition, input) {
  const preview = window.ReviseQuotePreview;
  const contract = preview?.constants?.parentContract;
  const owners = transition?.before?.owners;
  const criteria = transition?.before?.criteria;
  return mod === 'Contacts'
    && reviseQuotePreviewLayoutId(record) === '1032257000000000171'
    && String(reviseQuotePreviewScalar(record?.Stage)).trim() === 'Design Form Filled'
    && String(blueprint?.blueprint_id || '') === '1032257000001044611'
    && blueprint?.blueprint === 'Opportunity Stage'
    && blueprint?.state_field === 'Stage'
    && blueprint?.current === 'Design Form Filled'
    && blueprint?.local === true
    && String(transition?.id || '') === '1032257000010720046'
    && transition?.name === 'Approve/Revise Quote'
    && transition?.next_value === 'Approve/Disapprove Quote'
    && transition?.next_actual_value === 'Approve/Disapprove Quote'
    && transition?.common === false
    && transition?.trigger_type === 'manual'
    && transition?.executable === false
    && Array.isArray(owners) && owners.length === 1 && owners[0] === 'All Users'
    && Array.isArray(criteria) && criteria.length === 0
    && Array.isArray(transition?.during_inputs)
    && transition.during_inputs.length === 1
    && transition.during_inputs[0] === input
    && Array.isArray(transition?.after_actions)
    && transition.after_actions.length === 0
    && input?.kind === 'widget'
    && String(input?.widget_id || '') === '1032257000010720459'
    && input?.name === 'Revise Quote - Widget'
    && input?.label === 'Revise Quote - Widget'
    && input?.api_name === null
    && input?.data_type === 'widget'
    && input?.required === false
    && input?.sequence === 1
    && input?.definition_status === 'Captured package validated; original read-only local quote-plan preview implemented'
    && contract?.module === 'Contacts'
    && contract?.layoutId === '1032257000000000171'
    && contract?.layoutName === 'Standard'
    && contract?.blueprintId === '1032257000001044611'
    && contract?.blueprintName === 'Opportunity Stage'
    && contract?.stateField === 'Stage'
    && contract?.currentDisplay === 'Design Form Filled'
    && contract?.currentActual === 'Assigned Designer'
    && contract?.transitionId === '1032257000010720046'
    && contract?.transitionName === 'Approve/Revise Quote'
    && contract?.nextDisplay === 'Approve/Disapprove Quote'
    && contract?.nextActual === 'Approve/Disapprove Quote'
    && contract?.widgetId === '1032257000010720459'
    && contract?.widgetName === 'Revise Quote - Widget'
    && typeof preview?.createContext === 'function'
    && typeof preview?.buildPlan === 'function';
}

function reviseQuotePreviewFieldMetadata(fields, fieldTypes) {
  return Object.entries(fieldTypes).flatMap(([apiName, dataType]) => {
    const field = (fields || []).find(item => item?.api_name === apiName && item?.data_type === dataType);
    if (!field) return [];
    const optionField = dataType === 'picklist' || dataType === 'multiselectpicklist';
    const options = optionField
      ? [...new Set((field.pick_list_values || [])
        .filter(option => option?.type !== 'unused')
        .flatMap(option => [option?.actual_value, option?.display_value])
        .filter(value => typeof value === 'string')
        .map(value => value.trim())
        .filter(value => value && value !== '-None-'))]
      : [];
    return [{ apiName, dataType, options }];
  });
}

function reviseQuotePreviewRelationshipSnapshot(relationship) {
  const rows = Array.isArray(relationship?.data) ? relationship.data : [];
  return {
    availability: relationship?.availability,
    hasMore: relationship?.pagination?.has_more,
    limitApplied: relationship?.pagination?.limit_applied,
    linkBasis: relationship?.link_basis,
    linkFields: Array.isArray(relationship?.link_fields) ? [...relationship.link_fields] : [],
    orders: rows.map((row, index) => ({
      ordinal: index + 1,
      productType: String(reviseQuotePreviewScalar(row?.Product_Type) || '').trim(),
      stage: String(reviseQuotePreviewScalar(row?.Stage) || '').trim(),
    })),
    page: relationship?.pagination?.page,
    perPage: relationship?.pagination?.per_page,
    relatedModule: relationship?.related_module,
    returned: relationship?.pagination?.returned,
  };
}

function reviseQuotePreviewChildContractSnapshot(blueprintStudio) {
  const expected = window.ReviseQuotePreview?.constants?.childBlueprintContract;
  const blueprints = Array.isArray(blueprintStudio?.blueprints) ? blueprintStudio.blueprints : [];
  const matchingBlueprints = blueprints.filter(item => String(item?.id || '') === String(expected?.blueprintId || ''));
  const blueprint = matchingBlueprints.length === 1 ? matchingBlueprints[0] : null;
  const transitions = Array.isArray(blueprint?.transitions) ? blueprint.transitions : [];
  const expectedTransitions = Array.isArray(expected?.transitions) ? expected.transitions : [];
  return {
    blueprintId: String(blueprint?.id || ''),
    blueprintName: blueprint?.name,
    layoutId: String(blueprint?.layout?.id || ''),
    layoutName: blueprint?.layout?.name,
    module: blueprint?.module,
    stateField: blueprint?.state_field,
    transitions: expectedTransitions.map(expectedTransition => {
      const matchingTransitions = transitions.filter(item => String(item?.id || '') === String(expectedTransition?.id || ''));
      const transition = matchingTransitions.length === 1 ? matchingTransitions[0] : null;
      return {
        action: expectedTransition?.action,
        common: transition?.common,
        fromActual: transition?.from?.actual_value,
        fromDisplay: transition?.from?.display_value,
        id: String(transition?.id || ''),
        name: transition?.name,
        toActual: transition?.to?.actual_value,
        toDisplay: transition?.to?.display_value,
        triggerType: transition?.trigger_type,
      };
    }),
  };
}

function renderReviseQuotePreview(container, contactId, idPrefix) {
  const preview = window.ReviseQuotePreview;
  const panel = el('section', 'revise-preview-panel');
  panel.setAttribute('aria-label', 'Revise Quote read-only preview');
  const header = el('div', 'revise-preview-header');
  header.append(el('span', 'estimate-preview-badge', 'Read-only preview'), el('h3', null, 'Anonymous quote decision plans'));
  panel.appendChild(header);
  panel.appendChild(el('div', 'revise-preview-warning', 'This original local preview reads only current Contacts and Deals metadata, the exact Order Stages transition contract, and the complete Contacts → All_Orders relationship. It reduces eligible rows to an anonymous order number, product type, and display stage. Immediately before plan generation, it performs fresh local GETs of the Contact and parent Blueprint eligibility. It cannot update an Order, create a note, upload a file, trigger a workflow, continue either Blueprint, use identity, or contact a provider.'));
  const loading = el('div', 'bp-phase-summary', 'Loading verified local metadata, Order Stages contract, and complete All_Orders evidence…');
  panel.appendChild(loading);
  container.appendChild(panel);

  Promise.all([
    getFields('Contacts'),
    getFields('Deals'),
    api('/api/meta/blueprint_studio'),
    api(`/api/related/Contacts/${encodeURIComponent(contactId)}/All_Orders?page=1&per_page=200`),
  ]).then(([contactFields, dealFields, blueprintStudio, relationship]) => {
    if (!panel.isConnected) return;
    let context;
    try {
      context = preview.createContext({
        childTransitionContract: reviseQuotePreviewChildContractSnapshot(blueprintStudio),
        contactFieldMetadata: reviseQuotePreviewFieldMetadata(contactFields, preview.constants.contactFieldTypes),
        dealFieldMetadata: reviseQuotePreviewFieldMetadata(dealFields, preview.constants.dealFieldTypes),
        relationship: reviseQuotePreviewRelationshipSnapshot(relationship),
      });
    } catch (error) {
      loading.className = 'revise-preview-error';
      loading.textContent = 'The exact Order Stages transitions, Contacts → All_Orders relationship, display-stage values, product options, or current field metadata does not satisfy the reviewed Revise Quote contract. No plan was generated and no action was performed.';
      return;
    }

    loading.remove();
    const basis = el('dl', 'revise-preview-basis');
    [
      ['Eligible Sent for Approval orders', context.orders.length],
      ['Stage None — unsupported in v1', context.unsupportedBranches.None],
      ['Query to SM — unsupported in v1', context.unsupportedBranches.Query_to_SM],
      ['Other stages — ignored', context.ignoredOrders],
    ].forEach(([label, value]) => basis.append(el('dt', null, esc(label)), el('dd', null, esc(value))));
    panel.appendChild(basis);
    if (context.unsupportedBranches.None || context.unsupportedBranches.Query_to_SM) {
      panel.appendChild(el('div', 'revise-preview-unsupported', 'V1 explicitly excludes Stage “None” and “Query to SM”. Those rows are not editable, not planned, and cannot continue any child Blueprint transition.'));
    }
    if (!context.orders.length) {
      panel.appendChild(el('div', 'revise-preview-empty', 'No anonymous All_Orders row is currently at display Stage “Sent for Approval”. No quote plan can be generated and nothing was changed.'));
      return;
    }

    const form = el('div', 'revise-preview-form');
    const orderControls = [];
    let fieldSequence = 0;
    const makeField = (labelText, control, hint = '') => {
      fieldSequence += 1;
      const wrapper = el('div', 'revise-preview-field');
      const controlId = `${idPrefix}-field-${fieldSequence}`;
      const label = el('label');
      label.htmlFor = controlId;
      label.textContent = labelText;
      control.id = controlId;
      wrapper.append(label, control);
      const describedBy = [];
      if (hint) {
        const hintNode = el('small', 'revise-preview-hint');
        hintNode.id = `${controlId}-hint`;
        hintNode.textContent = hint;
        describedBy.push(hintNode.id);
        wrapper.appendChild(hintNode);
      }
      const fieldError = el('small', 'revise-preview-field-error');
      fieldError.id = `${controlId}-error`;
      fieldError.setAttribute('aria-live', 'polite');
      describedBy.push(fieldError.id);
      wrapper.appendChild(fieldError);
      control.setAttribute('aria-describedby', describedBy.join(' '));
      control._reviseFieldError = fieldError;
      return wrapper;
    };
    const selectControl = (options, placeholder = '', { multiple = false } = {}) => {
      const select = el('select');
      select.multiple = multiple;
      if (multiple) select.size = Math.min(6, Math.max(2, options.length));
      else if (placeholder) {
        const blank = el('option');
        blank.value = '';
        blank.textContent = placeholder;
        select.appendChild(blank);
      }
      options.forEach(value => {
        const option = el('option');
        option.value = value;
        option.textContent = value;
        select.appendChild(option);
      });
      return select;
    };
    const clearControl = control => {
      if (!control) return;
      if (control.multiple) Array.from(control.options).forEach(option => { option.selected = false; });
      else control.value = '';
    };

    context.orders.forEach(order => {
      const group = el('fieldset', 'revise-preview-order');
      group.appendChild(el('legend', null, `${esc(order.label)} · ${esc(order.productType)} · ${esc(order.stage)}`));
      const grid = el('div', 'revise-preview-grid');
      const action = selectControl(preview.constants.actions);
      action.value = 'Skip';
      grid.appendChild(makeField('Decision *', action, 'Choose Skip, Revise Quotes, or Approved Quote.'));
      const presentation = selectControl(order.presentationOptions, 'Select presentation');
      const designTheme = selectControl(order.themeOptions, 'Select design theme');
      const ceilingHeight = el('input'); ceilingHeight.type = 'text'; ceilingHeight.maxLength = preview.constants.limits.ceilingHeight;
      const designRequiredOn = el('input'); designRequiredOn.type = 'date';
      const reason = selectControl(context.revisionReasons, 'Select revision reason');
      const reasonField = makeField('Revision reason *', reason, 'Required only for Revise Quotes; approval forbids revision data.');
      reasonField.classList.add('revise-preview-reason', 'hidden');
      grid.append(
        makeField('Design presentation *', presentation),
        makeField('Design theme *', designTheme),
        makeField('Finished ceiling height *', ceilingHeight),
        makeField('Design required on *', designRequiredOn, 'Mapped to the exact Deals field Design_Required_on.'),
        reasonField,
      );
      const controls = {
        action,
        ceilingHeight,
        designRequiredOn,
        designTheme,
        gas: null,
        island: null,
        kitchenHeight: null,
        kitchenTypes: null,
        ordinal: order.ordinal,
        presentation,
        reason,
        reasonField,
        vastu: null,
        wardrobeHeight: null,
        wardrobeTypes: null,
      };
      if (order.productType === 'Kitchen') {
        controls.kitchenTypes = selectControl(context.optionSets.kitchenTypes, '', { multiple: true });
        controls.kitchenHeight = selectControl(context.optionSets.kitchenHeights, 'Select kitchen height');
        controls.island = selectControl(context.optionSets.islandOptions, 'Select island');
        controls.gas = selectControl(context.optionSets.gasOptions, 'Select gas arrangement');
        controls.vastu = selectControl(context.optionSets.vastuOptions, 'Select Vastu requirement');
        grid.append(
          makeField('Kitchen types *', controls.kitchenTypes, 'Select one or more reviewed current options.'),
          makeField('Kitchen height *', controls.kitchenHeight),
          makeField('Island *', controls.island),
          makeField('Gas arrangement *', controls.gas),
          makeField('Vastu requirement *', controls.vastu),
        );
      } else if (order.productType === 'Wardrobe') {
        controls.wardrobeTypes = selectControl(context.optionSets.wardrobeTypes, '', { multiple: true });
        controls.wardrobeHeight = selectControl(context.optionSets.wardrobeHeights, 'Select wardrobe height');
        grid.append(
          makeField('Wardrobe types *', controls.wardrobeTypes, 'Select one or more reviewed current options.'),
          makeField('Wardrobe height *', controls.wardrobeHeight),
        );
      }
      controls.plannedControls = [
        presentation, designTheme, ceilingHeight, designRequiredOn,
        controls.kitchenTypes, controls.kitchenHeight, controls.island, controls.gas, controls.vastu,
        controls.wardrobeTypes, controls.wardrobeHeight,
      ].filter(Boolean);
      const toggleDecisionFields = () => {
        const planned = action.value !== 'Skip';
        controls.plannedControls.forEach(control => {
          control.disabled = !planned;
          control.required = planned;
          if (!planned) clearControl(control);
        });
        const revising = action.value === 'Revise Quotes';
        reason.disabled = !revising;
        reason.required = revising;
        reasonField.classList.toggle('hidden', !revising);
        if (!revising) clearControl(reason);
      };
      action.onchange = toggleDecisionFields;
      toggleDecisionFields();
      group.appendChild(grid);
      form.appendChild(group);
      orderControls.push(controls);
    });

    const generate = el('button', 'btn-primary revise-preview-generate', 'Generate display-only quote plans');
    generate.type = 'button';
    const result = el('section', 'revise-preview-result is-empty');
    result.setAttribute('aria-live', 'polite');
    result.appendChild(el('p', null, 'Plan at least one eligible order. A fresh local Contact and parent Blueprint eligibility snapshot will be checked immediately before generating immutable, non-persisted quote plans.'));
    const allControls = () => orderControls.flatMap(control => [control.action, control.reason, ...control.plannedControls]);
    const clearErrors = () => allControls().forEach(control => {
      control.removeAttribute('aria-invalid');
      if (control._reviseFieldError) control._reviseFieldError.textContent = '';
    });
    const plannedOrders = () => orderControls.filter(control => control.action.value !== 'Skip');
    const firstField = (key, invalid = control => !control.value) => {
      const eligible = plannedOrders().filter(control => control[key]);
      return eligible.find(control => invalid(control[key], control))?.[key] || eligible[0]?.[key];
    };
    const errorTarget = code => {
      if (code === 'PLAN_REQUIRED' || code === 'ACTION_INVALID') return orderControls[0]?.action;
      if (code.includes('PRESENTATION')) return firstField('presentation');
      if (code.includes('THEME')) return firstField('designTheme');
      if (code.includes('CEILING')) return firstField('ceilingHeight');
      if (code.includes('DESIGN_DATE')) return firstField('designRequiredOn');
      if (code.includes('REVISION')) return firstField('reason', (control, order) => order.action.value === 'Revise Quotes' && !control.value);
      if (code.includes('APPROVAL')) return firstField('reason', (control, order) => order.action.value === 'Approved Quote' && Boolean(control.value));
      if (code.includes('KITCHEN_TYPE')) return firstField('kitchenTypes', control => control.selectedOptions.length === 0);
      if (code.includes('KITCHEN_HEIGHT')) return firstField('kitchenHeight');
      if (code.includes('ISLAND')) return firstField('island');
      if (code.includes('GAS')) return firstField('gas');
      if (code.includes('VASTU')) return firstField('vastu');
      if (code.includes('WARDROBE_TYPE')) return firstField('wardrobeTypes', control => control.selectedOptions.length === 0);
      if (code.includes('WARDROBE_HEIGHT')) return firstField('wardrobeHeight');
      return plannedOrders()[0]?.action || orderControls[0]?.action || generate;
    };
    const errorMessage = code => ({
      PLAN_REQUIRED: 'Choose Revise Quotes or Approved Quote for at least one eligible order.',
      PRESENTATION_UNSUPPORTED: 'Select a reviewed current presentation option.',
      THEME_UNSUPPORTED: 'Select a reviewed current design theme.',
      CEILING_HEIGHT_REQUIRED: 'Enter the finished ceiling height.',
      DESIGN_DATE_INVALID: 'Enter a valid design-required date.',
      REVISION_REASON_REQUIRED: 'Select a reviewed current revision reason.',
      APPROVAL_REVISION_DATA_FORBIDDEN: 'Approval cannot include a revision reason.',
      KITCHEN_TYPE_REQUIRED: 'Select one or more reviewed kitchen types.',
      KITCHEN_HEIGHT_UNSUPPORTED: 'Select a reviewed kitchen height.',
      ISLAND_UNSUPPORTED: 'Select a reviewed island option.',
      GAS_UNSUPPORTED: 'Select a reviewed gas arrangement.',
      VASTU_UNSUPPORTED: 'Select a reviewed Vastu option.',
      WARDROBE_TYPE_REQUIRED: 'Select one or more reviewed wardrobe types.',
      WARDROBE_HEIGHT_UNSUPPORTED: 'Select a reviewed wardrobe height.',
    }[code] || 'Review the highlighted field against the exact current metadata.');
    const showFreshSnapshotError = message => {
      result.className = 'revise-preview-result is-error';
      result.replaceChildren(el('p', null, `${message} Refresh the record before generating a new plan. No CRM or Blueprint action was performed.`));
    };
    generate.onclick = async () => {
      clearErrors();
      generate.disabled = true;
      generate.setAttribute('aria-busy', 'true');
      result.className = 'revise-preview-result is-empty';
      result.replaceChildren(el('p', null, 'Checking a fresh local Contact and parent Blueprint eligibility snapshot…'));
      let returnFocusToGenerate = false;
      try {
        const [parentResponse, freshBlueprint] = await Promise.all([
          api(`/api/record/Contacts/${encodeURIComponent(contactId)}`),
          api(`/api/blueprint/Contacts/${encodeURIComponent(contactId)}`),
        ]);
        if (!panel.isConnected) return;
        const freshRecords = Array.isArray(parentResponse?.data) ? parentResponse.data : [];
        const freshRecord = freshRecords.length === 1 ? freshRecords[0] : null;
        const matchingTransitions = Array.isArray(freshBlueprint?.transitions)
          ? freshBlueprint.transitions.filter(transition => String(transition?.id || '') === '1032257000010720046')
          : [];
        const freshTransition = matchingTransitions.length === 1 ? matchingTransitions[0] : null;
        const matchingInputs = Array.isArray(freshTransition?.during_inputs)
          ? freshTransition.during_inputs.filter(input => String(input?.widget_id || '') === '1032257000010720459')
          : [];
        const freshInput = matchingInputs.length === 1 ? matchingInputs[0] : null;
        if (!freshRecord || !freshTransition || !freshInput
          || !isReviseQuotePreviewInput('Contacts', freshRecord, freshBlueprint, freshTransition, freshInput)) {
          returnFocusToGenerate = true;
          showFreshSnapshotError('The fresh local Contact or parent Blueprint no longer matches the reviewed Revise Quote eligibility contract.');
          return;
        }
        const draft = preview.buildPlan({
          context,
          orders: orderControls.map(control => ({
            action: control.action.value,
            ceilingHeight: control.ceilingHeight.value,
            designRequiredOn: control.designRequiredOn.value,
            designTheme: control.designTheme.value,
            gas: control.gas?.value || '',
            island: control.island?.value || '',
            kitchenHeight: control.kitchenHeight?.value || '',
            kitchenTypes: control.kitchenTypes ? [...control.kitchenTypes.selectedOptions].map(option => option.value) : [],
            ordinal: control.ordinal,
            presentation: control.presentation.value,
            reason: control.reason.value,
            vastu: control.vastu?.value || '',
            wardrobeHeight: control.wardrobeHeight?.value || '',
            wardrobeTypes: control.wardrobeTypes ? [...control.wardrobeTypes.selectedOptions].map(option => option.value) : [],
          })),
        });
        result.className = 'revise-preview-result';
        result.replaceChildren(el('h4', null, 'Display-only quote plans'));
        draft.plans.forEach(plan => {
          const planNode = el('article', 'revise-preview-plan');
          planNode.appendChild(el('h5', null, `${esc(plan.order_label)} · ${esc(plan.product_type)}`));
          const route = el('dl', 'revise-preview-plan-route');
          [
            ['Source stage', plan.source_stage],
            ['Decision', plan.decision],
            ['Intended child transition', plan.intended_transition.name],
          ].forEach(([label, value]) => route.append(el('dt', null, esc(label)), el('dd', null, esc(value))));
          const fields = el('dl', 'revise-preview-plan-fields');
          Object.entries(plan.fields).forEach(([field, value]) => {
            fields.append(el('dt', null, esc(field.replace(/_/g, ' '))), el('dd', null, esc(Array.isArray(value) ? value.join(', ') : value)));
          });
          planNode.append(route, fields);
          result.appendChild(planNode);
        });
        result.appendChild(el('small', null, `Not persisted · ${draft.skipped_orders} skipped · Disabled: ${draft.blocked_actions.join(', ')}.`));
      } catch (error) {
        if (!(error instanceof preview.ReviseQuotePreviewError)) {
          returnFocusToGenerate = true;
          showFreshSnapshotError('A fresh local Contact and parent Blueprint eligibility snapshot could not be verified.');
          return;
        }
        const code = String(error?.code || '');
        const target = errorTarget(code);
        const message = errorMessage(code);
        result.className = 'revise-preview-result is-error';
        result.replaceChildren(el('p', null, `${message} No CRM or Blueprint action was performed.`));
        if (target) {
          target.setAttribute('aria-invalid', 'true');
          if (target._reviseFieldError) target._reviseFieldError.textContent = message;
          target.focus();
        }
      } finally {
        generate.disabled = false;
        generate.removeAttribute('aria-busy');
        if (returnFocusToGenerate && panel.isConnected) generate.focus();
      }
    };
    form.append(generate, result);
    panel.appendChild(form);
  }).catch(() => {
    if (!panel.isConnected) return;
    loading.className = 'revise-preview-error';
    loading.textContent = 'Required local Contacts or Deals metadata, Order Stages Blueprint Studio evidence, or complete All_Orders relationship evidence is unavailable. No plan was generated and no action was performed.';
  });
}

let activeReviseQuotePreviewClose = null;
let reviseQuotePreviewSequence = 0;
function openReviseQuotePreview(mod, contactId, record, blueprint, transition, input, restoreFocus = document.activeElement) {
  if (!isReviseQuotePreviewInput(mod, record, blueprint, transition, input)) {
    toast('Revise Quote preview is unavailable. No CRM or Blueprint action was performed.');
    return;
  }
  if (activeJourneyDialogClose) activeJourneyDialogClose(false);
  if (activeEstimatePreviewClose) activeEstimatePreviewClose(false);
  if (activeAssignTechnicianPreviewClose) activeAssignTechnicianPreviewClose(false);
  if (activeDesignerFormPreviewClose) activeDesignerFormPreviewClose(false);
  if (activePaymentMilestonePreviewClose) activePaymentMilestonePreviewClose(false);
  if (activeReviseQuotePreviewClose) activeReviseQuotePreviewClose(false);
  if (activeReviseApproveAnyStagePreviewClose) activeReviseApproveAnyStagePreviewClose(false);
  if (activeClosureNewPreviewClose) activeClosureNewPreviewClose(false);
  if (activeBlueprintTransitionClose) activeBlueprintTransitionClose(false);
  const modal = $('#modal'), box = $('#modalBox');
  box.innerHTML = '';
  reviseQuotePreviewSequence += 1;
  const idPrefix = `revise-quote-preview-${reviseQuotePreviewSequence}`;
  const titleId = `${idPrefix}-title`;
  const header = el('div', 'mh revise-preview-modal-head');
  const headingWrap = el('div', 'revise-preview-heading');
  headingWrap.append(el('span', 'estimate-preview-badge', 'Read-only preview'));
  const heading = el('h2', null, 'Revise Quote');
  heading.id = titleId;
  headingWrap.appendChild(heading);
  const close = el('button', 'x', '✕');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close Revise Quote preview');
  const shell = $('#shell');
  const shellWasInert = shell?.hasAttribute('inert') === true;
  if (shell) shell.setAttribute('inert', '');
  let keyHandler = null;
  const shut = (returnFocus = true) => {
    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    if (activeReviseQuotePreviewClose === shut) activeReviseQuotePreviewClose = null;
    modal.classList.add('hidden');
    modal.removeAttribute('role');
    modal.removeAttribute('aria-modal');
    modal.removeAttribute('aria-labelledby');
    if (shell && !shellWasInert) shell.removeAttribute('inert');
    if (returnFocus && restoreFocus && document.contains(restoreFocus)) restoreFocus.focus();
  };
  activeReviseQuotePreviewClose = shut;
  close.onclick = shut;
  header.append(headingWrap, close);
  const body = el('div', 'mb revise-preview-modal-body');
  renderReviseQuotePreview(body, contactId, idPrefix);
  const footer = el('div', 'mf');
  const done = el('button', null, 'Close preview');
  done.type = 'button';
  done.onclick = shut;
  footer.appendChild(done);
  box.append(header, body, footer);
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', titleId);
  modal.classList.remove('hidden');
  keyHandler = event => {
    if (event.key === 'Escape' && !modal.classList.contains('hidden')) shut();
    if (event.key === 'Tab' && !modal.classList.contains('hidden')) {
      const focusable = Array.from(box.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'))
        .filter(node => node.getClientRects().length > 0 && !node.closest('.hidden'));
      event.preventDefault();
      if (!focusable.length) return;
      const activeIndex = focusable.indexOf(document.activeElement);
      const nextIndex = activeIndex < 0
        ? (event.shiftKey ? focusable.length - 1 : 0)
        : (activeIndex + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
      focusable[nextIndex].focus();
    }
  };
  document.addEventListener('keydown', keyHandler);
  close.focus();
}
/* Revise Quote local-only preview end */

/* Revise-Approve Quote Any Stage local-only preview start */
function reviseApproveAnyStagePreviewScalar(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value.display_value ?? value.actual_value ?? '';
  }
  return value ?? '';
}

function reviseApproveAnyStagePreviewLayoutId(record) {
  return String(record?.Layout?.id || record?.$layout_id?.id || '');
}

function reviseApproveAnyStagePreviewGet(path) {
  if (typeof path !== 'string' || !path.startsWith('/api/')) {
    return Promise.reject(new Error('Revise-Approve local evidence path is invalid.'));
  }
  return api(path, { method: 'GET', cache: 'no-store' });
}

function reviseApproveAnyStagePreviewButtonContract(catalog) {
  const buttons = Array.isArray(catalog?.buttons) ? catalog.buttons : [];
  const matches = buttons.filter(button => String(button?.id || '') === '1032257000017358923');
  if (matches.length !== 1) throw new Error('Revise-Approve button evidence is invalid.');
  const button = matches[0];
  return {
    action: button?.action,
    actionReference: {
      id: String(button?.action_reference?.id || ''),
      name: button?.action_reference?.name,
      type: button?.action_reference?.type,
    },
    apiName: button?.api_name,
    id: String(button?.id || ''),
    layoutIds: Array.isArray(button?.layout_ids) ? [...button.layout_ids] : [],
    module: button?.module,
    name: button?.name,
    position: button?.position,
    sequenceNumber: button?.sequence_number,
    source: button?.source,
  };
}

function reviseApproveAnyStagePreviewContactLayout(recordResponse, layoutResponse, expectedRecordId, preview) {
  const records = Array.isArray(recordResponse?.data) ? recordResponse.data : [];
  if (records.length !== 1 || String(records[0]?.id || '') !== String(expectedRecordId || '')) {
    throw new Error('Revise-Approve Contact evidence is invalid.');
  }
  const layoutId = reviseApproveAnyStagePreviewLayoutId(records[0]);
  const registered = preview?.constants?.buttonContract?.layoutIds;
  const layouts = Array.isArray(layoutResponse?.layouts) ? layoutResponse.layouts : [];
  const matches = layouts.filter(layout => String(layout?.id || '') === layoutId);
  if (
    !Array.isArray(registered)
    || registered.length !== 2
    || !registered.includes(layoutId)
    || matches.length !== 1
    || matches[0]?.status !== 'active'
    || matches[0]?.visible !== true
    || recordResponse?.layout_resolution?.exact !== true
    || String(recordResponse?.layout_resolution?.layout_id || '') !== layoutId
  ) throw new Error('Revise-Approve Contact layout evidence is invalid.');
  return layoutId;
}

function reviseApproveAnyStagePreviewFieldMetadata(fields, fieldTypes) {
  return Object.entries(fieldTypes).flatMap(([apiName, dataType]) => {
    const field = (fields || []).find(item => item?.api_name === apiName && item?.data_type === dataType);
    if (!field) return [];
    const optionField = dataType === 'picklist' || dataType === 'multiselectpicklist';
    const options = optionField
      ? [...new Set((field.pick_list_values || [])
        .filter(option => option?.type !== 'unused')
        .flatMap(option => [option?.actual_value, option?.display_value])
        .filter(value => typeof value === 'string')
        .map(value => value.trim())
        .filter(value => value && value !== '-None-'))]
      : [];
    return [{ apiName, dataType, options }];
  });
}

function reviseApproveAnyStagePreviewDisplayStage(value) {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, 'display_value');
  } catch {
    return '';
  }
  if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value') || typeof descriptor.value !== 'string') return '';
  return descriptor.value.trim();
}

function reviseApproveAnyStagePreviewRelationship(relationship) {
  const rows = Array.isArray(relationship?.data) ? relationship.data : [];
  return {
    availability: relationship?.availability,
    hasMore: relationship?.pagination?.has_more,
    limitApplied: relationship?.pagination?.limit_applied,
    linkBasis: relationship?.link_basis,
    linkFields: Array.isArray(relationship?.link_fields) ? [...relationship.link_fields] : [],
    orders: rows.map((row, index) => ({
      ordinal: index + 1,
      productType: String(reviseApproveAnyStagePreviewScalar(row?.Product_Type) || '').trim(),
      stage: reviseApproveAnyStagePreviewDisplayStage(row?.Stage),
    })),
    page: relationship?.pagination?.page,
    perPage: relationship?.pagination?.per_page,
    relatedModule: relationship?.related_module,
    returned: relationship?.pagination?.returned,
  };
}

function reviseApproveAnyStagePreviewPrivateFingerprint(contactId, relationship) {
  if (!/^\d{19}$/.test(String(contactId || ''))) throw new Error('Revise-Approve Contact identity is invalid.');
  const rows = Array.isArray(relationship?.data) ? relationship.data : [];
  const seen = new Set();
  const pairs = rows.map((row, index) => {
    const recordId = String(row?.id || '');
    if (!/^\d{19}$/.test(recordId) || seen.has(recordId)) {
      throw new Error('Revise-Approve relationship identity is invalid.');
    }
    seen.add(recordId);
    return [index + 1, recordId];
  });
  return JSON.stringify({ contact: String(contactId), orderIdToOrdinal: pairs });
}

function reviseApproveAnyStagePreviewChildContract(blueprintStudio, preview) {
  const expected = preview?.constants?.childBlueprintContract;
  const blueprints = Array.isArray(blueprintStudio?.blueprints) ? blueprintStudio.blueprints : [];
  const matches = blueprints.filter(item => String(item?.id || '') === String(expected?.blueprintId || ''));
  const blueprint = matches.length === 1 ? matches[0] : null;
  const transitions = Array.isArray(blueprint?.transitions) ? blueprint.transitions : [];
  const expectedTransitions = Array.isArray(expected?.transitions) ? expected.transitions : [];
  return {
    blueprintId: String(blueprint?.id || ''),
    blueprintName: blueprint?.name,
    layoutId: String(blueprint?.layout?.id || ''),
    layoutName: blueprint?.layout?.name,
    module: blueprint?.module,
    stateField: blueprint?.state_field,
    transitions: expectedTransitions.map(expectedTransition => {
      const matchingTransitions = transitions.filter(item => String(item?.id || '') === String(expectedTransition?.id || ''));
      const transition = matchingTransitions.length === 1 ? matchingTransitions[0] : null;
      return {
        action: expectedTransition?.action,
        common: transition?.common,
        fromActual: transition?.from?.actual_value,
        fromDisplay: transition?.from?.display_value,
        id: String(transition?.id || ''),
        name: transition?.name,
        toActual: transition?.to?.actual_value,
        toDisplay: transition?.to?.display_value,
        triggerType: transition?.trigger_type,
      };
    }),
  };
}

function reviseApproveAnyStagePreviewAnonymousFingerprint(context) {
  return JSON.stringify(context);
}

async function reviseApproveAnyStagePreviewReadEvidence(contactId, preview) {
  const [recordResponse, layoutResponse, contactMetadata, dealMetadata, relationship, buttonCatalog, blueprintStudio] = await Promise.all([
    reviseApproveAnyStagePreviewGet(`/api/record/Contacts/${encodeURIComponent(contactId)}`),
    reviseApproveAnyStagePreviewGet('/api/meta/layouts?module=Contacts'),
    reviseApproveAnyStagePreviewGet('/api/meta/fields?module=Contacts'),
    reviseApproveAnyStagePreviewGet('/api/meta/fields?module=Deals'),
    reviseApproveAnyStagePreviewGet(`/api/related/Contacts/${encodeURIComponent(contactId)}/All_Orders?page=1&per_page=200`),
    reviseApproveAnyStagePreviewGet('/api/meta/custom_buttons?module=Contacts'),
    reviseApproveAnyStagePreviewGet('/api/meta/blueprint_studio'),
  ]);
  const context = preview.createContext({
    buttonContract: reviseApproveAnyStagePreviewButtonContract(buttonCatalog),
    childTransitionContract: reviseApproveAnyStagePreviewChildContract(blueprintStudio, preview),
    contactFieldMetadata: reviseApproveAnyStagePreviewFieldMetadata(contactMetadata?.fields, preview.constants.contactFieldTypes),
    contactLayoutId: reviseApproveAnyStagePreviewContactLayout(recordResponse, layoutResponse, contactId, preview),
    dealFieldMetadata: reviseApproveAnyStagePreviewFieldMetadata(dealMetadata?.fields, preview.constants.dealFieldTypes),
    relationship: reviseApproveAnyStagePreviewRelationship(relationship),
  });
  return Object.freeze({
    anonymousFingerprint: reviseApproveAnyStagePreviewAnonymousFingerprint(context),
    context,
    privateFingerprint: reviseApproveAnyStagePreviewPrivateFingerprint(contactId, relationship),
  });
}

function renderReviseApproveAnyStagePreview(container, contactId, idPrefix) {
  const preview = window.ReviseApproveAnyStagePreview;
  const panel = el('section', 'revise-approve-preview-panel');
  panel.setAttribute('aria-label', 'Revise-Approve Quote read-only preview');
  const header = el('div', 'revise-approve-preview-header');
  header.append(el('span', 'estimate-preview-badge', 'Read-only preview'), el('h3', null, 'Anonymous quote decisions from any Contact stage'));
  panel.appendChild(header);
  panel.appendChild(el('div', 'revise-approve-preview-warning', 'This local preview validates only the exact Contacts view-button registration and either registered Contact layout. Local profile and user-type eligibility are not asserted. It performs seven direct uncached GET-only reads, reduces All_Orders rows to anonymous evidence, and keeps relationship IDs only in a private in-memory ID-to-ordinal fingerprint. It never writes, persists, logs, opens files, executes captured source, contacts a provider, or requests or continues a parent Blueprint.'));
  const loading = el('div', 'bp-phase-summary', 'Loading fresh Contact, layout, fields, button, complete All_Orders, and child transition evidence…');
  panel.appendChild(loading);
  container.appendChild(panel);

  reviseApproveAnyStagePreviewReadEvidence(contactId, preview).then(reviewedEvidence => {
    if (!panel.isConnected) return;
    const context = reviewedEvidence.context;
    loading.remove();

    const basis = el('dl', 'revise-approve-preview-basis');
    [
      ['Eligible Sent for Approval Orders', context.relationshipCounts.eligible],
      ['Other stages — explicitly blocked', context.relationshipCounts.blocked],
      ['Ignored Orders', context.ignoredOrders],
      ['Parent Blueprint', context.parentBlueprint],
      ['Local profile eligibility', 'Not asserted'],
    ].forEach(([label, value]) => basis.append(el('dt', null, esc(label)), el('dd', null, esc(value))));
    panel.appendChild(basis);

    if (context.blockedOrders.length) {
      const blocked = el('section', 'revise-approve-preview-blocked');
      blocked.appendChild(el('h4', null, 'Explicitly blocked Orders'));
      context.blockedOrders.forEach(order => {
        blocked.appendChild(el('p', null, `${esc(order.order_label)} · ${esc(order.product_type)} · ${esc(order.source_stage)} — Display Stage is not Sent for Approval.`));
      });
      panel.appendChild(blocked);
    }
    if (!context.orders.length) {
      panel.appendChild(el('div', 'revise-approve-preview-empty', 'No anonymous All_Orders row is currently at exact display Stage “Sent for Approval”. No plan can be generated and nothing was changed.'));
      return;
    }

    const form = el('div', 'revise-approve-preview-form');
    const orderControls = [];
    let fieldSequence = 0;
    const makeField = (labelText, control, hint = '') => {
      fieldSequence += 1;
      const wrapper = el('div', 'revise-approve-preview-field');
      const controlId = `${idPrefix}-field-${fieldSequence}`;
      const label = el('label');
      label.htmlFor = controlId;
      label.textContent = labelText;
      control.id = controlId;
      wrapper.append(label, control);
      const describedBy = [];
      if (hint) {
        const hintNode = el('small', 'revise-approve-preview-hint');
        hintNode.id = `${controlId}-hint`;
        hintNode.textContent = hint;
        describedBy.push(hintNode.id);
        wrapper.appendChild(hintNode);
      }
      const fieldError = el('small', 'revise-approve-preview-field-error');
      fieldError.id = `${controlId}-error`;
      fieldError.setAttribute('aria-live', 'polite');
      describedBy.push(fieldError.id);
      wrapper.appendChild(fieldError);
      control.setAttribute('aria-describedby', describedBy.join(' '));
      control._reviseApproveFieldError = fieldError;
      return wrapper;
    };
    const selectControl = (options, placeholder = '', { multiple = false } = {}) => {
      const select = el('select');
      select.multiple = multiple;
      if (multiple) select.size = Math.min(6, Math.max(2, options.length));
      else if (placeholder) {
        const blank = el('option');
        blank.value = '';
        blank.textContent = placeholder;
        select.appendChild(blank);
      }
      options.forEach(value => {
        const option = el('option');
        option.value = value;
        option.textContent = value;
        select.appendChild(option);
      });
      return select;
    };
    const clearControl = control => {
      if (!control) return;
      if (control.multiple) Array.from(control.options).forEach(option => { option.selected = false; });
      else control.value = '';
    };

    context.orders.forEach(order => {
      const group = el('fieldset', 'revise-approve-preview-order');
      group.appendChild(el('legend', null, `${esc(order.label)} · ${esc(order.productType)} · ${esc(order.stage)}`));
      const grid = el('div', 'revise-approve-preview-grid');
      const action = selectControl(preview.constants.actions);
      action.value = 'Skip';
      grid.appendChild(makeField('Decision *', action, 'Choose Skip, Revise Quotes, or Approved Quote.'));
      const presentation = selectControl(order.presentationOptions, 'Select presentation');
      const designTheme = selectControl(order.themeOptions, 'Select design theme');
      const ceilingHeight = el('input');
      ceilingHeight.type = 'text';
      ceilingHeight.maxLength = preview.constants.limits.ceilingHeight;
      const designRequiredOn = el('input');
      designRequiredOn.type = 'date';
      const reason = selectControl(context.revisionReasons, 'Select revision reason');
      const reasonField = makeField('Revision reason *', reason, 'Required only for Revise Quotes; approval forbids revision data.');
      reasonField.classList.add('revise-approve-preview-reason', 'hidden');
      grid.append(
        makeField('Design presentation *', presentation),
        makeField('Design theme *', designTheme),
        makeField('Finished ceiling height *', ceilingHeight),
        makeField('Design required on *', designRequiredOn, 'Mapped to the exact Deals field Design_Required_on.'),
        reasonField,
      );
      const controls = {
        action,
        ceilingHeight,
        designRequiredOn,
        designTheme,
        gas: null,
        island: null,
        kitchenHeight: null,
        kitchenTypes: null,
        ordinal: order.ordinal,
        presentation,
        reason,
        reasonField,
        vastu: null,
        wardrobeHeight: null,
        wardrobeTypes: null,
      };
      if (order.productType === 'Kitchen') {
        controls.kitchenTypes = selectControl(context.optionSets.kitchenTypes, '', { multiple: true });
        controls.kitchenHeight = selectControl(context.optionSets.kitchenHeights, 'Select kitchen height');
        controls.island = selectControl(context.optionSets.islandOptions, 'Select island');
        controls.gas = selectControl(context.optionSets.gasOptions, 'Select gas arrangement');
        controls.vastu = selectControl(context.optionSets.vastuOptions, 'Select Vastu requirement');
        grid.append(
          makeField('Kitchen types *', controls.kitchenTypes, 'Select one or more reviewed current options.'),
          makeField('Kitchen height *', controls.kitchenHeight),
          makeField('Island *', controls.island),
          makeField('Gas arrangement *', controls.gas),
          makeField('Vastu requirement *', controls.vastu),
        );
      } else if (order.productType === 'Wardrobe') {
        controls.wardrobeTypes = selectControl(context.optionSets.wardrobeTypes, '', { multiple: true });
        controls.wardrobeHeight = selectControl(context.optionSets.wardrobeHeights, 'Select wardrobe height');
        grid.append(
          makeField('Wardrobe types *', controls.wardrobeTypes, 'Select one or more reviewed current options.'),
          makeField('Wardrobe height *', controls.wardrobeHeight),
        );
      }
      controls.plannedControls = [
        presentation, designTheme, ceilingHeight, designRequiredOn,
        controls.kitchenTypes, controls.kitchenHeight, controls.island, controls.gas, controls.vastu,
        controls.wardrobeTypes, controls.wardrobeHeight,
      ].filter(Boolean);
      const toggleDecisionFields = () => {
        const planned = action.value !== 'Skip';
        controls.plannedControls.forEach(control => {
          control.disabled = !planned;
          control.required = planned;
          if (!planned) clearControl(control);
        });
        const revising = action.value === 'Revise Quotes';
        reason.disabled = !revising;
        reason.required = revising;
        reasonField.classList.toggle('hidden', !revising);
        if (!revising) clearControl(reason);
      };
      action.onchange = toggleDecisionFields;
      toggleDecisionFields();
      group.appendChild(grid);
      form.appendChild(group);
      orderControls.push(controls);
    });

    const generate = el('button', 'btn-primary revise-approve-preview-generate', 'Generate display-only quote plans');
    generate.type = 'button';
    const result = el('section', 'revise-approve-preview-result is-empty');
    result.setAttribute('aria-live', 'polite');
    result.appendChild(el('p', null, 'Plan at least one eligible Order. Generate repeats all seven GET-only evidence reads and requires both anonymous and private fingerprints to match before producing an immutable plan.'));
    const allControls = () => orderControls.flatMap(control => [control.action, control.reason, ...control.plannedControls]);
    const clearErrors = () => allControls().forEach(control => {
      control.removeAttribute('aria-invalid');
      if (control._reviseApproveFieldError) control._reviseApproveFieldError.textContent = '';
    });
    const plannedOrders = () => orderControls.filter(control => control.action.value !== 'Skip');
    const firstField = (key, invalid = control => !control.value) => {
      const eligible = plannedOrders().filter(control => control[key]);
      return eligible.find(control => invalid(control[key], control))?.[key] || eligible[0]?.[key];
    };
    const errorTarget = code => {
      if (code === 'PLAN_REQUIRED' || code === 'ACTION_INVALID') return orderControls[0]?.action;
      if (code.includes('PRESENTATION')) return firstField('presentation');
      if (code.includes('THEME')) return firstField('designTheme');
      if (code.includes('CEILING')) return firstField('ceilingHeight');
      if (code.includes('DESIGN_DATE')) return firstField('designRequiredOn');
      if (code.includes('REVISION')) return firstField('reason', (control, order) => order.action.value === 'Revise Quotes' && !control.value);
      if (code.includes('APPROVAL')) return firstField('reason', (control, order) => order.action.value === 'Approved Quote' && Boolean(control.value));
      if (code.includes('KITCHEN_TYPE')) return firstField('kitchenTypes', control => control.selectedOptions.length === 0);
      if (code.includes('KITCHEN_HEIGHT')) return firstField('kitchenHeight');
      if (code.includes('ISLAND')) return firstField('island');
      if (code.includes('GAS')) return firstField('gas');
      if (code.includes('VASTU')) return firstField('vastu');
      if (code.includes('WARDROBE_TYPE')) return firstField('wardrobeTypes', control => control.selectedOptions.length === 0);
      if (code.includes('WARDROBE_HEIGHT')) return firstField('wardrobeHeight');
      return plannedOrders()[0]?.action || orderControls[0]?.action || generate;
    };
    const errorMessage = code => ({
      PLAN_REQUIRED: 'Choose Revise Quotes or Approved Quote for at least one eligible Order.',
      PRESENTATION_UNSUPPORTED: 'Select a reviewed current presentation option.',
      THEME_UNSUPPORTED: 'Select a reviewed current design theme.',
      CEILING_HEIGHT_REQUIRED: 'Enter the finished ceiling height.',
      DESIGN_DATE_INVALID: 'Enter a valid design-required date.',
      REVISION_REASON_REQUIRED: 'Select a reviewed current revision reason.',
      APPROVAL_REVISION_DATA_FORBIDDEN: 'Approval cannot include a revision reason.',
      KITCHEN_TYPE_REQUIRED: 'Select one or more reviewed kitchen types.',
      KITCHEN_HEIGHT_UNSUPPORTED: 'Select a reviewed kitchen height.',
      ISLAND_UNSUPPORTED: 'Select a reviewed island option.',
      GAS_UNSUPPORTED: 'Select a reviewed gas arrangement.',
      VASTU_UNSUPPORTED: 'Select a reviewed Vastu option.',
      WARDROBE_TYPE_REQUIRED: 'Select one or more reviewed wardrobe types.',
      WARDROBE_HEIGHT_UNSUPPORTED: 'Select a reviewed wardrobe height.',
    }[code] || 'Review the highlighted field against the exact current metadata.');
    const collectOrders = () => orderControls.map(control => ({
      action: control.action.value,
      ceilingHeight: control.ceilingHeight.value,
      designRequiredOn: control.designRequiredOn.value,
      designTheme: control.designTheme.value,
      gas: control.gas?.value || '',
      island: control.island?.value || '',
      kitchenHeight: control.kitchenHeight?.value || '',
      kitchenTypes: control.kitchenTypes ? [...control.kitchenTypes.selectedOptions].map(option => option.value) : [],
      ordinal: control.ordinal,
      presentation: control.presentation.value,
      reason: control.reason.value,
      vastu: control.vastu?.value || '',
      wardrobeHeight: control.wardrobeHeight?.value || '',
      wardrobeTypes: control.wardrobeTypes ? [...control.wardrobeTypes.selectedOptions].map(option => option.value) : [],
    }));
    const showEvidenceError = message => {
      result.className = 'revise-approve-preview-result is-error';
      result.replaceChildren(el('p', null, `${message} Close and reopen the preview before reviewing another plan. Nothing was changed.`));
    };
    generate.onclick = async () => {
      clearErrors();
      generate.disabled = true;
      generate.setAttribute('aria-busy', 'true');
      result.className = 'revise-approve-preview-result is-empty';
      result.replaceChildren(el('p', null, 'Repeating all seven uncached GET-only evidence reads and comparing private and anonymous fingerprints…'));
      let returnFocusToGenerate = false;
      try {
        const freshEvidence = await reviseApproveAnyStagePreviewReadEvidence(contactId, preview);
        if (!panel.isConnected) return;
        if (
          freshEvidence.privateFingerprint !== reviewedEvidence.privateFingerprint
          || freshEvidence.anonymousFingerprint !== reviewedEvidence.anonymousFingerprint
        ) {
          returnFocusToGenerate = true;
          showEvidenceError('Current local Contact, layout, metadata, button, complete All_Orders, or child transition evidence changed.');
          return;
        }
        const draft = preview.buildPlan({ context: freshEvidence.context, orders: collectOrders() });
        result.className = 'revise-approve-preview-result';
        result.replaceChildren(el('h4', null, 'Display-only quote plans'));
        draft.plans.forEach(plan => {
          const planNode = el('article', 'revise-approve-preview-plan');
          planNode.appendChild(el('h5', null, `${esc(plan.order_label)} · ${esc(plan.product_type)}`));
          const route = el('dl', 'revise-approve-preview-plan-route');
          [
            ['Source stage', plan.source_stage],
            ['Decision', plan.decision],
            ['Intended child transition', plan.intended_transition.name],
            ['Parent Blueprint', draft.parent_blueprint],
          ].forEach(([label, value]) => route.append(el('dt', null, esc(label)), el('dd', null, esc(value))));
          const fields = el('dl', 'revise-approve-preview-plan-fields');
          Object.entries(plan.fields).forEach(([field, value]) => {
            fields.append(el('dt', null, esc(field.replace(/_/g, ' '))), el('dd', null, esc(Array.isArray(value) ? value.join(', ') : value)));
          });
          planNode.append(route, fields);
          result.appendChild(planNode);
        });
        const summary = el('small');
        summary.textContent = `Not persisted · ${draft.totals.blocked_orders} blocked · ${draft.skipped_orders} skipped · Disabled: ${draft.blocked_actions.join(', ')}.`;
        result.appendChild(summary);
      } catch (error) {
        if (!(error instanceof preview.ReviseApproveAnyStagePreviewError)) {
          returnFocusToGenerate = true;
          showEvidenceError('The complete current local evidence set could not be revalidated.');
          return;
        }
        const code = String(error?.code || '');
        const target = errorTarget(code);
        const message = errorMessage(code);
        result.className = 'revise-approve-preview-result is-error';
        result.replaceChildren(el('p', null, `${message} Nothing was changed.`));
        if (target) {
          target.setAttribute('aria-invalid', 'true');
          if (target._reviseApproveFieldError) target._reviseApproveFieldError.textContent = message;
          target.focus();
        }
      } finally {
        generate.disabled = false;
        generate.removeAttribute('aria-busy');
        if (returnFocusToGenerate && panel.isConnected) generate.focus();
      }
    };
    form.append(generate, result);
    panel.appendChild(form);
  }).catch(() => {
    if (!panel.isConnected) return;
    loading.className = 'revise-approve-preview-error';
    loading.textContent = 'The exact fresh Contact, registered layout, current fields, custom button, complete All_Orders relationship, or child transition evidence is unavailable. Local profile eligibility is not asserted. No plan was generated and nothing was changed.';
  });
}

let activeReviseApproveAnyStagePreviewClose = null;
let reviseApproveAnyStagePreviewSequence = 0;
function openReviseApproveAnyStagePreview(mod, contactId, record, button, layoutExact, resolvedLayoutId, restoreFocus = document.activeElement) {
  if (!isReviseApproveAnyStagePreviewButton(button, mod, record, layoutExact, resolvedLayoutId)) {
    toast('Revise-Approve Quote preview is unavailable. Nothing was changed.');
    return;
  }
  if (activeJourneyDialogClose) activeJourneyDialogClose(false);
  if (activeEstimatePreviewClose) activeEstimatePreviewClose(false);
  if (activeAssignTechnicianPreviewClose) activeAssignTechnicianPreviewClose(false);
  if (activeDesignerFormPreviewClose) activeDesignerFormPreviewClose(false);
  if (activePaymentMilestonePreviewClose) activePaymentMilestonePreviewClose(false);
  if (activeReviseQuotePreviewClose) activeReviseQuotePreviewClose(false);
  if (activeReviseApproveAnyStagePreviewClose) activeReviseApproveAnyStagePreviewClose(false);
  if (activeClosureNewPreviewClose) activeClosureNewPreviewClose(false);
  if (activeBlueprintTransitionClose) activeBlueprintTransitionClose(false);
  const modal = $('#modal'), box = $('#modalBox');
  box.replaceChildren();
  reviseApproveAnyStagePreviewSequence += 1;
  const idPrefix = `revise-approve-preview-${reviseApproveAnyStagePreviewSequence}`;
  const titleId = `${idPrefix}-title`;
  const header = el('div', 'mh revise-approve-preview-modal-head');
  const headingWrap = el('div', 'revise-approve-preview-heading');
  headingWrap.append(el('span', 'estimate-preview-badge', 'Read-only preview'));
  const heading = el('h2', null, 'Revise-Approve Quote');
  heading.id = titleId;
  headingWrap.appendChild(heading);
  const close = el('button', 'x', '✕');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close Revise-Approve Quote preview');
  const shell = $('#shell');
  const shellWasInert = shell?.hasAttribute('inert') === true;
  if (shell) shell.setAttribute('inert', '');
  let keyHandler = null;
  const shut = (returnFocus = true) => {
    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    if (activeReviseApproveAnyStagePreviewClose === shut) activeReviseApproveAnyStagePreviewClose = null;
    modal.classList.add('hidden');
    modal.removeAttribute('role');
    modal.removeAttribute('aria-modal');
    modal.removeAttribute('aria-labelledby');
    if (shell && !shellWasInert) shell.removeAttribute('inert');
    if (returnFocus && restoreFocus && document.contains(restoreFocus)) restoreFocus.focus();
  };
  activeReviseApproveAnyStagePreviewClose = shut;
  close.onclick = shut;
  header.append(headingWrap, close);
  const body = el('div', 'mb revise-approve-preview-modal-body');
  renderReviseApproveAnyStagePreview(body, contactId, idPrefix);
  const footer = el('div', 'mf');
  const done = el('button', null, 'Close preview');
  done.type = 'button';
  done.onclick = shut;
  footer.appendChild(done);
  box.append(header, body, footer);
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', titleId);
  modal.classList.remove('hidden');
  keyHandler = event => {
    if (event.key === 'Escape' && !modal.classList.contains('hidden')) shut();
    if (event.key === 'Tab' && !modal.classList.contains('hidden')) {
      const focusable = Array.from(box.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'))
        .filter(node => node.getClientRects().length > 0 && !node.closest('.hidden'));
      event.preventDefault();
      if (!focusable.length) return;
      const activeIndex = focusable.indexOf(document.activeElement);
      const nextIndex = activeIndex < 0
        ? (event.shiftKey ? focusable.length - 1 : 0)
        : (activeIndex + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
      focusable[nextIndex].focus();
    }
  };
  document.addEventListener('keydown', keyHandler);
  close.focus();
}
/* Revise-Approve Quote Any Stage local-only preview end */

/* Closure New local-only preview start */
function closureNewPreviewLayoutId(record) {
  return String(record?.Layout?.id || record?.$layout_id?.id || '');
}

function closureNewPreviewScalar(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value.display_value ?? value.actual_value ?? '';
  }
  return value ?? '';
}

function closureNewPreviewDisplayStage(value) {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, 'display_value');
  } catch {
    return '';
  }
  if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value') || typeof descriptor.value !== 'string') return '';
  return descriptor.value.trim();
}

function closureNewPreviewNumber(value) {
  const scalar = value && typeof value === 'object' && !Array.isArray(value)
    ? (value.actual_value ?? value.value ?? value.display_value)
    : value;
  if (scalar === null || scalar === undefined || scalar === '') return null;
  return Number(scalar);
}

function isClosureNewPreviewInput(mod, record, blueprint, transition, input) {
  const preview = window.ClosureNewPreview;
  const parent = preview?.constants?.parentContract;
  const child = preview?.constants?.childContract;
  const blockedSunrooof = preview?.constants?.blockedSunrooofContract;
  const owners = transition?.before?.owners;
  const criteria = transition?.before?.criteria;
  return mod === 'Contacts'
    && closureNewPreviewLayoutId(record) === '1032257000000000171'
    && closureNewPreviewDisplayStage(record?.Stage) === 'Principally Closed'
    && String(blueprint?.blueprint_id || '') === '1032257000001044611'
    && blueprint?.blueprint === 'Opportunity Stage'
    && blueprint?.state_field === 'Stage'
    && blueprint?.current === 'Principally Closed'
    && blueprint?.local === true
    && String(transition?.id || '') === '1032257000025407204'
    && transition?.name === 'Closure New - Pinki'
    && transition?.next_value === 'Closure'
    && transition?.next_actual_value === 'Principally Closure'
    && transition?.common === false
    && transition?.trigger_type === 'manual'
    && transition?.executable === false
    && Array.isArray(owners) && owners.length === 1 && owners[0] === 'Specific Users (1)'
    && Array.isArray(criteria) && criteria.length === 0
    && Array.isArray(transition?.during_inputs)
    && transition.during_inputs.length === 1
    && transition.during_inputs[0] === input
    && Array.isArray(transition?.after_actions)
    && transition.after_actions.length === 0
    && input?.kind === 'widget'
    && String(input?.widget_id || '') === '1032257000025407208'
    && input?.name === 'Closure New - Pinki'
    && input?.label === 'Closure New - Pinki'
    && input?.api_name === null
    && input?.data_type === 'widget'
    && input?.required === false
    && input?.sequence === 1
    && input?.definition_status === 'Captured package validated; original constrained read-only closure-plan preview implemented'
    && parent?.module === 'Contacts'
    && parent?.layoutId === '1032257000000000171'
    && parent?.layoutName === 'Standard'
    && parent?.blueprintId === '1032257000001044611'
    && parent?.blueprintName === 'Opportunity Stage'
    && parent?.stateField === 'Stage'
    && parent?.currentDisplay === 'Principally Closed'
    && parent?.currentActual === 'Payment Awaited'
    && parent?.transitionId === '1032257000025407204'
    && parent?.transitionName === 'Closure New - Pinki'
    && parent?.relationshipId === '1032257000025407206'
    && parent?.nextDisplay === 'Closure'
    && parent?.nextActual === 'Principally Closure'
    && parent?.widgetId === '1032257000025407208'
    && parent?.widgetName === 'Closure New - Pinki'
    && child?.module === 'Deals'
    && child?.layoutId === '1032257000000000173'
    && child?.layoutName === 'Standard'
    && child?.blueprintId === '1032257000000535747'
    && child?.blueprintName === 'Order Stages'
    && child?.stateField === 'Stage'
    && child?.currentDisplay === 'Payment Awaited'
    && child?.currentActual === 'Payment Awaited'
    && child?.transitionId === '1032257000000535729'
    && child?.transitionName === 'Closure'
    && child?.nextDisplay === 'Closure'
    && child?.nextActual === 'Closure'
    && child?.requiredField === 'Est_Handover_Date'
    && blockedSunrooof?.productType === 'SUNROOOF'
    && blockedSunrooof?.transitionId === '1032257000021717028'
    && blockedSunrooof?.afterActionId === '1032257000021717034'
    && typeof preview?.createContext === 'function'
    && typeof preview?.buildPlan === 'function';
}

function closureNewPreviewFieldMetadata(fields, fieldTypes) {
  return Object.entries(fieldTypes).flatMap(([apiName, dataType]) => {
    const field = (fields || []).find(item => item?.api_name === apiName && item?.data_type === dataType);
    if (!field) return [];
    const options = dataType === 'picklist'
      ? [...new Set((field.pick_list_values || [])
        .filter(option => option?.type !== 'unused')
        .flatMap(option => [option?.actual_value, option?.display_value])
        .filter(value => typeof value === 'string')
        .map(value => value.trim())
        .filter(value => value && value !== '-None-'))]
      : [];
    return [{ apiName, dataType, options }];
  });
}

function closureNewPreviewParentSnapshot(response, expectedRecordId) {
  const rows = Array.isArray(response?.data) ? response.data : [];
  if (rows.length !== 1 || String(rows[0]?.id || '') !== String(expectedRecordId || '')) return { layoutId: '', stage: '' };
  return {
    layoutId: closureNewPreviewLayoutId(rows[0]),
    stage: closureNewPreviewDisplayStage(rows[0]?.Stage),
  };
}

function closureNewPreviewDealLayout(layouts, preview) {
  const child = preview?.constants?.childContract;
  const activeLayoutIds = (layouts || [])
    .filter(layout => layout?.status === 'active' && layout?.visible === true)
    .map(layout => String(layout?.id || ''))
    .filter(Boolean);
  const exactLayout = (layouts || []).filter(layout => (
    String(layout?.id || '') === String(child?.layoutId || '')
    && layout?.name === child?.layoutName
    && layout?.status === 'active'
    && layout?.visible === true
  ));
  const resolved = activeLayoutIds.length === 1
    && exactLayout.length === 1
    && activeLayoutIds[0] === child?.layoutId;
  return {
    activeLayoutIds,
    resolution: resolved ? 'only_active_layout' : 'unavailable',
    resolvedId: resolved ? activeLayoutIds[0] : '',
  };
}

function closureNewPreviewRelationshipEnvelope(relationship) {
  return {
    availability: relationship?.availability,
    hasMore: relationship?.pagination?.has_more,
    limitApplied: relationship?.pagination?.limit_applied,
    linkBasis: relationship?.link_basis,
    linkFields: Array.isArray(relationship?.link_fields) ? [...relationship.link_fields] : [],
    page: relationship?.pagination?.page,
    perPage: relationship?.pagination?.per_page,
    relatedModule: relationship?.related_module,
    returned: relationship?.pagination?.returned,
  };
}

function closureNewPreviewOrdersRelationship(relationship) {
  const rows = Array.isArray(relationship?.data) ? relationship.data : [];
  return {
    ...closureNewPreviewRelationshipEnvelope(relationship),
    orders: rows.map((row, index) => ({
      ordinal: index + 1,
      productType: String(closureNewPreviewScalar(row?.Product_Type) || '').trim(),
      stage: closureNewPreviewDisplayStage(row?.Stage),
    })),
  };
}

function closureNewPreviewMilestonesRelationship(relationship) {
  const rows = Array.isArray(relationship?.data) ? relationship.data : [];
  return {
    ...closureNewPreviewRelationshipEnvelope(relationship),
    milestones: rows.map((row, index) => ({
      amountReceived: closureNewPreviewNumber(row?.Amount_Received_Now),
      amountReceivedDate: String(closureNewPreviewScalar(row?.Amount_Received_Date) || '').trim(),
      managementDiscount: closureNewPreviewNumber(row?.Management_Discount_Proposed),
      milestoneName: String(closureNewPreviewScalar(row?.Milestone_Number) || '').trim(),
      ordinal: index + 1,
      percentage: closureNewPreviewNumber(row?.Percentage),
      serialNumber: closureNewPreviewNumber(row?.Serial_Number),
    })),
  };
}

function closureNewPreviewPrivateRows(relationship) {
  const rows = Array.isArray(relationship?.data) ? relationship.data : [];
  const seen = new Set();
  return Object.freeze(rows.map((row, index) => {
    const recordId = String(row?.id || '');
    if (!/^\d{19}$/.test(recordId) || seen.has(recordId)) throw new Error('Closure New relationship identity is unavailable.');
    seen.add(recordId);
    return Object.freeze({
      ordinal: index + 1,
      recordId,
    });
  }));
}

function closureNewPreviewGet(path) {
  if (typeof path !== 'string' || !path.startsWith('/api/')) {
    return Promise.reject(new Error('Closure New local evidence path is invalid.'));
  }
  return api(path, { method: 'GET', cache: 'no-store' });
}

async function closureNewPreviewMapLimit(rows, maxConcurrency, mapper) {
  const values = new Array(rows.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < rows.length) {
      const index = cursor;
      cursor += 1;
      values[index] = await mapper(rows[index], index);
    }
  };
  const workerCount = Math.min(maxConcurrency, rows.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return Object.freeze(values);
}

function closureNewPreviewDealRecordEvidence(recordResponse, privateOrder, anonymousOrder, dealLayout, preview) {
  const child = preview.constants.childContract;
  const rows = Array.isArray(recordResponse?.data) ? recordResponse.data : [];
  const record = rows.length === 1 ? rows[0] : null;
  const resolution = recordResponse?.layout_resolution;
  const activeLayoutIds = Array.isArray(dealLayout?.activeLayoutIds) ? dealLayout.activeLayoutIds : [];
  const directStage = closureNewPreviewDisplayStage(record?.Stage);
  const directProductType = String(closureNewPreviewScalar(record?.Product_Type) || '').trim();
  if (
    !record
    || String(record?.id || '') !== privateOrder.recordId
    || anonymousOrder?.ordinal !== privateOrder.ordinal
    || directStage !== anonymousOrder?.stage
    || directStage !== child.currentDisplay
    || directProductType !== anonymousOrder?.productType
    || resolution?.exact !== true
    || resolution?.source !== 'only_active_layout'
    || resolution?.reason !== null
    || String(resolution?.layout_id || '') !== child.layoutId
    || resolution?.candidate_count !== 1
    || dealLayout?.resolution !== 'only_active_layout'
    || dealLayout?.resolvedId !== child.layoutId
    || activeLayoutIds.length !== 1
    || activeLayoutIds[0] !== child.layoutId
  ) throw new Error('Closure New child Deal evidence is invalid.');
}

function closureNewPreviewChildAttestation(blueprint, privateOrder, preview) {
  const child = preview.constants.childContract;
  const transitions = Array.isArray(blueprint?.transitions) ? blueprint.transitions : [];
  const matching = transitions.filter(transition => String(transition?.id || '') === child.transitionId);
  if (matching.length !== 1) throw new Error('Closure New child Blueprint evidence is invalid.');
  const transition = matching[0];
  const owners = transition?.before?.owners;
  const criteria = transition?.before?.criteria;
  const duringInputs = transition?.during_inputs;
  const during = Array.isArray(duringInputs) && duringInputs.length === 1 ? duringInputs[0] : null;
  if (
    String(blueprint?.blueprint_id || '') !== child.blueprintId
    || blueprint?.blueprint !== child.blueprintName
    || blueprint?.state_field !== child.stateField
    || blueprint?.current !== child.currentDisplay
    || blueprint?.local !== true
    || transition?.name !== child.transitionName
    || transition?.next_value !== child.nextDisplay
    || transition?.next_actual_value !== child.nextActual
    || transition?.common !== true
    || transition?.trigger_type !== 'manual'
    || transition?.executable !== false
    || !Array.isArray(owners) || owners.length !== 1 || owners[0] !== 'Specific Users (1)'
    || !Array.isArray(criteria) || criteria.length !== 0
    || !during
    || during.kind !== 'field'
    || during.api_name !== child.requiredField
    || during.label !== 'Est. Handover Date'
    || during.data_type !== 'date'
    || during.required !== true
    || during.sequence !== 1
    || !Array.isArray(transition?.after_actions) || transition.after_actions.length !== 0
  ) throw new Error('Closure New child Blueprint evidence is invalid.');
  return Object.freeze({
    afterActionCount: 0,
    common: true,
    criteriaCount: 0,
    current: child.currentDisplay,
    duringInputCount: 1,
    executable: false,
    fromActual: child.currentActual,
    fromDisplay: child.currentDisplay,
    layout: child.layoutName,
    local: true,
    nextActual: child.nextActual,
    nextDisplay: child.nextDisplay,
    ordinal: privateOrder.ordinal,
    owner: 'Specific Users (1)',
    process: child.blueprintName,
    requiredField: child.requiredField,
    stateField: child.stateField,
    transition: child.transitionName,
    triggerType: 'manual',
  });
}

async function closureNewPreviewChildAttestations(privateOrders, ordersSnapshot, dealLayout, preview) {
  const child = preview.constants.childContract;
  const supported = new Set(preview.constants.supportedProducts);
  const candidates = ordersSnapshot.orders
    .filter(order => order.stage === child.currentDisplay && supported.has(order.productType))
    .map(order => {
      const privateOrder = privateOrders.find(row => row.ordinal === order.ordinal);
      if (!privateOrder) throw new Error('Closure New child identity evidence is invalid.');
      return Object.freeze({ anonymousOrder: order, privateOrder });
    });
  return closureNewPreviewMapLimit(candidates, 4, async candidate => {
    const { anonymousOrder, privateOrder } = candidate;
    const recordResponse = await closureNewPreviewGet(`/api/record/Deals/${encodeURIComponent(privateOrder.recordId)}`);
    closureNewPreviewDealRecordEvidence(recordResponse, privateOrder, anonymousOrder, dealLayout, preview);
    const blueprint = await closureNewPreviewGet(`/api/blueprint/Deals/${encodeURIComponent(privateOrder.recordId)}`);
    return closureNewPreviewChildAttestation(blueprint, privateOrder, preview);
  });
}

function closureNewPreviewAnonymousFingerprint(context) {
  return JSON.stringify(context);
}

function closureNewPreviewPrivateFingerprint(contactId, privateOrders, privateMilestones) {
  return JSON.stringify({
    contactId: String(contactId),
    milestones: privateMilestones.map(row => [row.ordinal, row.recordId]),
    orders: privateOrders.map(row => [row.ordinal, row.recordId]),
  });
}

async function closureNewPreviewReadEvidence(contactId, preview) {
  const [parentResponse, contactMetadata, dealMetadata, paymentMetadata, dealLayoutMetadata, ordersRelationship, milestonesRelationship] = await Promise.all([
    closureNewPreviewGet(`/api/record/Contacts/${encodeURIComponent(contactId)}`),
    closureNewPreviewGet('/api/meta/fields?module=Contacts'),
    closureNewPreviewGet('/api/meta/fields?module=Deals'),
    closureNewPreviewGet('/api/meta/fields?module=Payment_Milestones'),
    closureNewPreviewGet('/api/meta/layouts?module=Deals'),
    closureNewPreviewGet(`/api/related/Contacts/${encodeURIComponent(contactId)}/All_Orders?page=1&per_page=200`),
    closureNewPreviewGet(`/api/related/Contacts/${encodeURIComponent(contactId)}/Payment_Milestones?page=1&per_page=200`),
  ]);
  const ordersSnapshot = closureNewPreviewOrdersRelationship(ordersRelationship);
  const milestonesSnapshot = closureNewPreviewMilestonesRelationship(milestonesRelationship);
  const privateOrders = closureNewPreviewPrivateRows(ordersRelationship);
  const privateMilestones = closureNewPreviewPrivateRows(milestonesRelationship);
  const dealLayout = closureNewPreviewDealLayout(dealLayoutMetadata?.layouts, preview);
  const childBlueprintAttestations = await closureNewPreviewChildAttestations(privateOrders, ordersSnapshot, dealLayout, preview);
  const context = preview.createContext({
    childBlueprintAttestations,
    contactFieldMetadata: closureNewPreviewFieldMetadata(contactMetadata?.fields, preview.constants.contactFieldTypes),
    dealFieldMetadata: closureNewPreviewFieldMetadata(dealMetadata?.fields, preview.constants.dealFieldTypes),
    dealLayout,
    milestonesRelationship: milestonesSnapshot,
    ordersRelationship: ordersSnapshot,
    parent: closureNewPreviewParentSnapshot(parentResponse, contactId),
    paymentFieldMetadata: closureNewPreviewFieldMetadata(paymentMetadata?.fields, preview.constants.paymentFieldTypes),
  });
  return Object.freeze({
    anonymousFingerprint: closureNewPreviewAnonymousFingerprint(context),
    context,
    privateFingerprint: closureNewPreviewPrivateFingerprint(contactId, privateOrders, privateMilestones),
  });
}

function renderClosureNewPreview(container, contactId, idPrefix) {
  const preview = window.ClosureNewPreview;
  const panel = el('section', 'closure-new-preview-panel');
  panel.setAttribute('aria-label', 'Closure New read-only preview');
  const header = el('div', 'closure-new-preview-header');
  header.append(el('span', 'estimate-preview-badge', 'Read-only preview'), el('h3', null, 'Record-ID-free closure plans'));
  panel.appendChild(header);
  panel.appendChild(el('div', 'closure-new-preview-warning', 'This original local preview uses uncached GET-only reads of the parent, current metadata, the single active visible Standard Deals layout, both complete exact relationships, and each potentially supported child Deal record plus its Blueprint. It keeps record IDs only in a private in-memory comparison map, excludes milestone names and reference free text from the plan, and never writes, triggers workflows, transitions a Blueprint, resolves identity, persists data, or contacts a provider.'));
  const loading = el('div', 'bp-phase-summary', 'Loading current parent, metadata, layout, relationships, child Deal records, and Blueprint evidence…');
  panel.appendChild(loading);
  container.appendChild(panel);

  closureNewPreviewReadEvidence(contactId, preview).then(reviewedEvidence => {
    if (!panel.isConnected) return;
    const context = reviewedEvidence.context;

    loading.remove();
    const sunrooofBlocked = context.blockedOrders.filter(order => order.reason === 'criteria-and-after-action-unavailable').length;
    const otherBlocked = context.blockedOrders.length - sunrooofBlocked;
    const basis = el('dl', 'closure-new-preview-basis');
    [
      ['Runtime-attested non-SUNROOOF Orders', context.orders.length],
      ['SUNROOOF Orders — blocked', sunrooofBlocked],
      ['Other unsupported Orders', otherBlocked],
      ['Complete milestones', context.milestones.length],
      ['Deals layout resolution', 'Single active Standard layout'],
    ].forEach(([label, value]) => basis.append(el('dt', null, esc(label)), el('dd', null, esc(value))));
    panel.appendChild(basis);

    if (context.blockedOrders.length) {
      const blocked = el('section', 'closure-new-preview-blocked');
      blocked.appendChild(el('h4', null, 'Explicitly blocked Orders'));
      context.blockedOrders.forEach(order => {
        const reason = order.reason === 'criteria-and-after-action-unavailable'
          ? 'SUNROOOF criteria and Sync Magppie To Sunrooof action are unavailable locally.'
          : order.reason === 'stage-not-payment-awaited'
            ? 'Display Stage is not Payment Awaited.'
            : 'Product Type is not in the reviewed common Closure branch.';
        blocked.appendChild(el('p', null, `${esc(order.label)} · ${esc(order.productType || 'Not set')} · ${esc(order.stage || 'Not set')} — ${reason}`));
      });
      panel.appendChild(blocked);
    }
    if (!context.orders.length) {
      panel.appendChild(el('div', 'closure-new-preview-empty', 'No record-ID-free All_Orders row currently has a runtime-attested non-SUNROOOF Payment Awaited common Closure path. No closure plan can be generated and nothing was changed.'));
      return;
    }

    const form = el('div', 'closure-new-preview-form');
    const orderControls = [];
    const orderSet = el('fieldset', 'closure-new-preview-orders');
    orderSet.appendChild(el('legend', null, 'Select supported Orders *'));
    context.orders.forEach(order => {
      const label = el('label', 'closure-new-preview-order');
      const checkbox = el('input');
      checkbox.type = 'checkbox';
      checkbox.value = String(order.ordinal);
      label.append(checkbox, el('span', null, `${esc(order.label)} · ${esc(order.productType)} · ${esc(order.stage)}`));
      orderSet.appendChild(label);
      orderControls.push({ checkbox, ordinal: order.ordinal });
    });
    const orderError = el('small', 'closure-new-preview-field-error');
    orderError.id = `${idPrefix}-orders-error`;
    orderError.setAttribute('aria-live', 'polite');
    orderSet.setAttribute('aria-describedby', orderError.id);
    orderSet.appendChild(orderError);
    form.appendChild(orderSet);

    const handoverWrap = el('div', 'closure-new-preview-field');
    const handoverLabel = el('label');
    handoverLabel.htmlFor = `${idPrefix}-handover`;
    handoverLabel.textContent = 'Estimated handover date *';
    const handover = el('input');
    handover.id = `${idPrefix}-handover`;
    handover.type = 'date';
    handover.required = true;
    const handoverError = el('small', 'closure-new-preview-field-error');
    handoverError.id = `${idPrefix}-handover-error`;
    handoverError.setAttribute('aria-live', 'polite');
    handover.setAttribute('aria-describedby', handoverError.id);
    handoverWrap.append(handoverLabel, handover, handoverError);
    form.appendChild(handoverWrap);

    const milestoneSection = el('section', 'closure-new-preview-milestones');
    milestoneSection.appendChild(el('h4', null, 'Payment milestone change preview'));
    milestoneSection.appendChild(el('p', 'closure-new-preview-hint', 'Magppie percentages must total 100%. Sunroof percentages remain outside that total. Optional numeric payment details appear only on the first serial-ordered row in each group; source milestone names and reference free text are intentionally excluded.'));
    const milestoneControls = [];
    context.milestones.forEach(milestone => {
      const fieldset = el('fieldset', 'closure-new-preview-milestone');
      fieldset.appendChild(el('legend', null, esc(milestone.label)));
      const meta = el('div', 'closure-new-preview-milestone-meta');
      meta.append(el('span', null, esc(milestone.classification)), el('span', null, `Serial ${esc(milestone.serialNumber)}`));
      fieldset.appendChild(meta);
      const grid = el('div', 'closure-new-preview-grid');
      const controls = {
        amountReceived: null,
        amountReceivedDate: null,
        managementDiscount: null,
        ordinal: milestone.ordinal,
        percentage: null,
      };
      const addField = (labelText, control, suffix) => {
        const wrapper = el('div', 'closure-new-preview-field');
        const controlId = `${idPrefix}-milestone-${milestone.ordinal}-${suffix}`;
        const label = el('label');
        label.htmlFor = controlId;
        label.textContent = labelText;
        control.id = controlId;
        const fieldError = el('small', 'closure-new-preview-field-error');
        fieldError.id = `${controlId}-error`;
        fieldError.setAttribute('aria-live', 'polite');
        control.setAttribute('aria-describedby', fieldError.id);
        control._closureNewFieldError = fieldError;
        wrapper.append(label, control, fieldError);
        grid.appendChild(wrapper);
        return control;
      };
      const percentage = el('input');
      percentage.type = 'number';
      percentage.min = '0';
      percentage.max = '100';
      percentage.step = '0.01';
      percentage.required = true;
      percentage.value = milestone.percentage === null ? '' : String(milestone.percentage);
      controls.percentage = addField('Percentage *', percentage, 'percentage');
      if (milestone.detailAllowed) {
        const amount = el('input');
        amount.type = 'number'; amount.min = '0'; amount.step = '0.01';
        amount.value = milestone.amountReceived === null ? '' : String(milestone.amountReceived);
        controls.amountReceived = addField('Amount received', amount, 'amount');
        const discount = el('input');
        discount.type = 'number'; discount.min = '0'; discount.step = '0.01';
        discount.value = milestone.managementDiscount === null ? '' : String(milestone.managementDiscount);
        controls.managementDiscount = addField('Management discount', discount, 'discount');
        const date = el('input');
        date.type = 'date'; date.value = milestone.amountReceivedDate;
        controls.amountReceivedDate = addField('Payment date', date, 'date');
      }
      fieldset.appendChild(grid);
      milestoneSection.appendChild(fieldset);
      milestoneControls.push(controls);
    });
    const total = el('div', 'closure-new-preview-total');
    const totalValue = el('strong');
    const refreshTotal = () => {
      const sum = context.milestones.reduce((value, milestone, index) => (
        milestone.classification === 'Magppie'
          ? value + Number(milestoneControls[index].percentage.value || 0)
          : value
      ), 0);
      const rounded = Math.round((sum + Number.EPSILON) * 100) / 100;
      totalValue.textContent = `${rounded}%`;
      total.classList.toggle('is-valid', rounded === 100);
      total.classList.toggle('is-invalid', rounded !== 100);
    };
    milestoneControls.forEach(control => { control.percentage.oninput = refreshTotal; });
    total.append(el('span', null, 'Magppie total'), totalValue);
    milestoneSection.appendChild(total);
    refreshTotal();
    form.appendChild(milestoneSection);

    const generate = el('button', 'btn-primary closure-new-preview-generate', 'Generate display-only closure plans');
    generate.type = 'button';
    const result = el('section', 'closure-new-preview-result is-empty');
    result.setAttribute('aria-live', 'polite');
    result.appendChild(el('p', null, 'Select at least one supported Order and review the milestones to generate immutable, non-persisted plans.'));
    const allControls = () => [handover, ...orderControls.map(row => row.checkbox), ...milestoneControls.flatMap(row => [row.percentage, row.amountReceived, row.managementDiscount, row.amountReceivedDate].filter(Boolean))];
    const clearErrors = () => {
      orderSet.removeAttribute('aria-invalid');
      orderError.textContent = '';
      allControls().forEach(control => {
        control.removeAttribute('aria-invalid');
        if (control._closureNewFieldError) control._closureNewFieldError.textContent = '';
      });
    };
    const errorMessage = code => ({
      ORDER_SELECTION_REQUIRED: 'Select at least one supported Order.',
      ORDER_SELECTION_INVALID: 'Select only the reviewed non-SUNROOOF Payment Awaited Orders.',
      HANDOVER_DATE_INVALID: 'Enter a valid estimated handover date.',
      PERCENT_INVALID: 'Enter a percentage from 0 to 100 for every milestone.',
      PERCENT_PRECISION_INVALID: 'Use no more than two decimal places for percentages.',
      PERCENT_TOTAL_INVALID: 'Magppie milestone percentages must total exactly 100%.',
      AMOUNT_RECEIVED_INVALID: 'Enter a bounded non-negative amount received.',
      AMOUNT_RECEIVED_PRECISION_INVALID: 'Use no more than two decimal places for amount received.',
      MANAGEMENT_DISCOUNT_INVALID: 'Enter a bounded non-negative management discount.',
      MANAGEMENT_DISCOUNT_PRECISION_INVALID: 'Use no more than two decimal places for management discount.',
      AMOUNT_RECEIVED_DATE_INVALID: 'Enter a valid payment date.',
      EVIDENCE_STALE: 'The Contact, relationship membership or order, reviewed values, layout, metadata, or child Blueprint evidence changed. Close and reopen the preview before reviewing a new plan.',
      EVIDENCE_UNAVAILABLE: 'Current local evidence could not be revalidated. Try again after the local replica is available.',
    }[code] || 'Review the highlighted values against the exact current closure contract.');
    const errorTarget = error => {
      const code = String(error?.code || '');
      const ordinal = Number(error?.details?.ordinal);
      const field = String(error?.details?.field || '');
      const exactRow = Number.isInteger(ordinal) ? milestoneControls.find(row => row.ordinal === ordinal) : null;
      if (exactRow && ['percentage', 'amountReceived', 'managementDiscount', 'amountReceivedDate'].includes(field) && exactRow[field]) return exactRow[field];
      if (code.startsWith('ORDER_SELECTION')) return orderControls[0]?.checkbox;
      if (code === 'HANDOVER_DATE_INVALID') return handover;
      if (code === 'PERCENT_TOTAL_INVALID') {
        const index = context.milestones.findIndex(row => row.classification === 'Magppie');
        return milestoneControls[index]?.percentage || milestoneControls[0]?.percentage;
      }
      if (code.includes('PERCENT')) return milestoneControls.find(row => row.percentage.value === '')?.percentage || milestoneControls[0]?.percentage;
      if (code.startsWith('AMOUNT_RECEIVED')) return milestoneControls.find(row => row.amountReceived)?.amountReceived;
      if (code.startsWith('MANAGEMENT_DISCOUNT')) return milestoneControls.find(row => row.managementDiscount)?.managementDiscount;
      if (code === 'AMOUNT_RECEIVED_DATE_INVALID') return milestoneControls.find(row => row.amountReceivedDate)?.amountReceivedDate;
      return generate;
    };
    const collectInput = freshContext => ({
      context: freshContext,
      estimatedHandoverDate: handover.value,
      milestones: milestoneControls.map(control => ({
        amountReceived: control.amountReceived?.value === '' || !control.amountReceived ? null : Number(control.amountReceived.value),
        amountReceivedDate: control.amountReceivedDate?.value || '',
        managementDiscount: control.managementDiscount?.value === '' || !control.managementDiscount ? null : Number(control.managementDiscount.value),
        ordinal: control.ordinal,
        percentage: control.percentage.value === '' ? Number.NaN : Number(control.percentage.value),
      })),
      selectedOrderOrdinals: orderControls.filter(row => row.checkbox.checked).map(row => row.ordinal),
    });
    const evidenceError = code => {
      const error = new Error('Closure New evidence validation failed.');
      error.code = code;
      return error;
    };
    const showPlan = plan => {
      result.className = 'closure-new-preview-result';
      result.replaceChildren(el('h4', null, 'Display-only closure plans'));
      const orderPlans = el('div', 'closure-new-preview-plan-grid');
      plan.order_plans.forEach(orderPlan => {
        const article = el('article', 'closure-new-preview-plan');
        article.appendChild(el('h5', null, `${esc(orderPlan.order_label)} · ${esc(orderPlan.product_type)}`));
        const route = el('dl');
        [
          ['Source stage', orderPlan.source_stage],
          ['Intended transition', orderPlan.intended_transition.name],
          ['Runtime evidence', orderPlan.runtime_attestation],
          ['Estimated handover', orderPlan.fields.Est_Handover_Date],
          ['Execution', orderPlan.execution],
        ].forEach(([label, value]) => route.append(el('dt', null, esc(label)), el('dd', null, esc(value))));
        article.appendChild(route);
        orderPlans.appendChild(article);
      });
      result.appendChild(orderPlans);
      const tableWrap = el('div', 'closure-new-preview-table-wrap');
      tableWrap.tabIndex = 0;
      tableWrap.setAttribute('role', 'region');
      tableWrap.setAttribute('aria-label', 'Payment milestone plan table');
      const table = el('table', 'closure-new-preview-table');
      const head = el('tr');
      ['Milestone', 'Group', 'Serial', 'Planned fields'].forEach(label => head.appendChild(el('th', null, label)));
      const thead = el('thead'); thead.appendChild(head); table.appendChild(thead);
      const tbody = el('tbody');
      plan.milestone_plans.forEach(milestonePlan => {
        const row = el('tr');
        const fieldText = Object.entries(milestonePlan.fields).map(([fieldName, value]) => `${fieldName.replace(/_/g, ' ')}: ${value}`).join(' · ');
        [milestonePlan.milestone_label, milestonePlan.classification, milestonePlan.serial_number, fieldText]
          .forEach(value => row.appendChild(el('td', null, esc(value))));
        tbody.appendChild(row);
      });
      table.appendChild(tbody); tableWrap.appendChild(table); result.appendChild(tableWrap);
      const summary = el('small');
      summary.textContent = `Not persisted · ${plan.totals.selected_orders} supported Order plan(s) · ${plan.totals.blocked_orders} blocked Order(s) · Disabled: ${plan.blocked_actions.join(', ')}.`;
      result.appendChild(summary);
    };
    generate.onclick = async () => {
      clearErrors();
      const submittedInput = collectInput(null);
      generate.disabled = true;
      result.setAttribute('aria-busy', 'true');
      result.className = 'closure-new-preview-result is-empty';
      result.replaceChildren(el('p', null, 'Revalidating current Contact, complete relationships, metadata, layout, child Deal records, and Blueprint evidence…'));
      try {
        let freshEvidence;
        try {
          freshEvidence = await closureNewPreviewReadEvidence(contactId, preview);
        } catch (error) {
          throw evidenceError(error instanceof preview.ClosureNewPreviewError || /^Closure New /.test(String(error?.message || '')) ? 'EVIDENCE_STALE' : 'EVIDENCE_UNAVAILABLE');
        }
        if (!panel.isConnected) return;
        if (
          freshEvidence.privateFingerprint !== reviewedEvidence.privateFingerprint
          || freshEvidence.anonymousFingerprint !== reviewedEvidence.anonymousFingerprint
        ) throw evidenceError('EVIDENCE_STALE');
        const plan = preview.buildPlan({ ...submittedInput, context: freshEvidence.context });
        showPlan(plan);
      } catch (error) {
        const code = String(error?.code || '');
        const message = errorMessage(code);
        const target = errorTarget(error);
        result.className = 'closure-new-preview-result is-error';
        result.replaceChildren(el('p', null, `${message} No CRM, workflow, or Blueprint action was performed.`));
        if (code.startsWith('ORDER_SELECTION')) {
          orderSet.setAttribute('aria-invalid', 'true');
          orderError.textContent = message;
        }
        if (target) {
          target.setAttribute('aria-invalid', 'true');
          if (target._closureNewFieldError) target._closureNewFieldError.textContent = message;
          target.focus();
        }
      } finally {
        result.removeAttribute('aria-busy');
        generate.disabled = false;
      }
    };
    form.append(generate, result);
    panel.appendChild(form);
  }).catch(() => {
    if (!panel.isConnected) return;
    loading.className = 'closure-new-preview-error';
    loading.textContent = 'Required current local parent, uncached metadata, Deals layout, complete relationships, stable private identity mapping, child Deal record evidence, or child Blueprint attestation is unavailable. No plan was generated and no action was performed.';
  });
}

let activeClosureNewPreviewClose = null;
let closureNewPreviewSequence = 0;
function openClosureNewPreview(mod, contactId, record, blueprint, transition, input, restoreFocus = document.activeElement) {
  if (!isClosureNewPreviewInput(mod, record, blueprint, transition, input)) {
    toast('Closure New preview is unavailable. No CRM, workflow, or Blueprint action was performed.');
    return;
  }
  if (activeJourneyDialogClose) activeJourneyDialogClose(false);
  if (activeEstimatePreviewClose) activeEstimatePreviewClose(false);
  if (activeAssignTechnicianPreviewClose) activeAssignTechnicianPreviewClose(false);
  if (activeDesignerFormPreviewClose) activeDesignerFormPreviewClose(false);
  if (activePaymentMilestonePreviewClose) activePaymentMilestonePreviewClose(false);
  if (activeReviseQuotePreviewClose) activeReviseQuotePreviewClose(false);
  if (activeReviseApproveAnyStagePreviewClose) activeReviseApproveAnyStagePreviewClose(false);
  if (activeClosureNewPreviewClose) activeClosureNewPreviewClose(false);
  if (activeBlueprintTransitionClose) activeBlueprintTransitionClose(false);
  const modal = $('#modal'), box = $('#modalBox');
  box.innerHTML = '';
  closureNewPreviewSequence += 1;
  const idPrefix = `closure-new-preview-${closureNewPreviewSequence}`;
  const titleId = `${idPrefix}-title`;
  const header = el('div', 'mh closure-new-preview-modal-head');
  const headingWrap = el('div', 'closure-new-preview-heading');
  headingWrap.append(el('span', 'estimate-preview-badge', 'Read-only preview'));
  const heading = el('h2', null, 'Closure New');
  heading.id = titleId;
  headingWrap.appendChild(heading);
  const close = el('button', 'x', '✕');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close Closure New preview');
  const shell = $('#shell');
  const shellWasInert = shell?.hasAttribute('inert') === true;
  if (shell) shell.setAttribute('inert', '');
  let keyHandler = null;
  const shut = (returnFocus = true) => {
    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    if (activeClosureNewPreviewClose === shut) activeClosureNewPreviewClose = null;
    modal.classList.add('hidden');
    modal.removeAttribute('role');
    modal.removeAttribute('aria-modal');
    modal.removeAttribute('aria-labelledby');
    if (shell && !shellWasInert) shell.removeAttribute('inert');
    if (returnFocus && restoreFocus && document.contains(restoreFocus)) restoreFocus.focus();
  };
  activeClosureNewPreviewClose = shut;
  close.onclick = shut;
  header.append(headingWrap, close);
  const body = el('div', 'mb closure-new-preview-modal-body');
  renderClosureNewPreview(body, contactId, idPrefix);
  const footer = el('div', 'mf');
  const done = el('button', null, 'Close preview');
  done.type = 'button';
  done.onclick = shut;
  footer.appendChild(done);
  box.append(header, body, footer);
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', titleId);
  modal.classList.remove('hidden');
  keyHandler = event => {
    if (event.key === 'Escape' && !modal.classList.contains('hidden')) shut();
    if (event.key === 'Tab' && !modal.classList.contains('hidden')) {
      const focusable = Array.from(box.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'))
        .filter(node => node.getClientRects().length > 0 && !node.closest('.hidden'));
      event.preventDefault();
      if (!focusable.length) return;
      const activeIndex = focusable.indexOf(document.activeElement);
      const nextIndex = activeIndex < 0
        ? (event.shiftKey ? focusable.length - 1 : 0)
        : (activeIndex + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
      focusable[nextIndex].focus();
    }
  };
  document.addEventListener('keydown', keyHandler);
  close.focus();
}
/* Closure New local-only preview end */

/* Deploy Team GET-only readiness preview start */
function deployTeamPreviewNode(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

function deployTeamPreviewGet(path) {
  if (typeof path !== 'string' || !path.startsWith('/api/')) {
    return Promise.reject(new Error('Deploy Team local evidence path is invalid.'));
  }
  return api(path, { method: 'GET', cache: 'no-store' });
}

function deployTeamPreviewOwnData(object, key) {
  if (!object || typeof object !== 'object' || Array.isArray(object) || typeof key !== 'string') {
    return Object.freeze({ present: false, value: undefined });
  }
  try {
    const prototype = Object.getPrototypeOf(object);
    if (prototype !== Object.prototype && prototype !== null) {
      return Object.freeze({ present: false, value: undefined });
    }
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (
      !descriptor
      || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      || descriptor.enumerable !== true
    ) return Object.freeze({ present: false, value: undefined });
    return Object.freeze({ present: true, value: descriptor.value });
  } catch {
    return Object.freeze({ present: false, value: undefined });
  }
}

function deployTeamPreviewOwnArray(object, key, maxItems) {
  const member = deployTeamPreviewOwnData(object, key);
  if (!member.present) return [];
  try {
    if (!Array.isArray(member.value) || Object.getPrototypeOf(member.value) !== Array.prototype) return [];
    const descriptors = Object.getOwnPropertyDescriptors(member.value);
    const lengthDescriptor = descriptors.length;
    if (
      !lengthDescriptor
      || !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value')
      || lengthDescriptor.enumerable !== false
      || !Number.isInteger(lengthDescriptor.value)
      || lengthDescriptor.value < 0
      || lengthDescriptor.value > maxItems
      || Reflect.ownKeys(descriptors).length !== lengthDescriptor.value + 1
    ) return [];
    const values = new Array(lengthDescriptor.value);
    for (let index = 0; index < lengthDescriptor.value; index += 1) {
      const descriptor = descriptors[String(index)];
      if (
        !descriptor
        || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
        || descriptor.enumerable !== true
      ) return [];
      values[index] = descriptor.value;
    }
    return values;
  } catch {
    return [];
  }
}

function deployTeamPreviewDisplayStage(value) {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  let descriptor;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return '';
    descriptor = Object.getOwnPropertyDescriptor(value, 'display_value');
  } catch {
    return '';
  }
  if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value') || typeof descriptor.value !== 'string') return '';
  return descriptor.value.trim();
}

function deployTeamPreviewButtonContract(catalog) {
  const matches = (Array.isArray(catalog?.buttons) ? catalog.buttons : [])
    .filter(button => String(button?.id || '') === '1032257000022961587');
  if (matches.length !== 1) throw new Error('Deploy Team button evidence is invalid.');
  const button = matches[0];
  return {
    action: button?.action,
    actionReference: {
      id: String(button?.action_reference?.id || ''),
      name: button?.action_reference?.name,
      type: button?.action_reference?.type,
    },
    apiName: button?.api_name,
    id: String(button?.id || ''),
    layoutIds: Array.isArray(button?.layout_ids) ? [...button.layout_ids] : [],
    module: button?.module,
    name: button?.name,
    position: button?.position,
    sequenceNumber: button?.sequence_number,
    source: button?.source,
  };
}

function deployTeamPreviewContactLayout(recordResponse, layoutResponse, expectedRecordId, preview) {
  const records = Array.isArray(recordResponse?.data) ? recordResponse.data : [];
  const record = records.length === 1 ? records[0] : null;
  const expected = preview?.constants?.contactLayout;
  const recordLayoutId = String(record?.Layout?.id || record?.$layout_id?.id || '');
  const resolution = recordResponse?.layout_resolution;
  const matches = (Array.isArray(layoutResponse?.layouts) ? layoutResponse.layouts : []).filter(layout => (
    String(layout?.id || '') === String(expected?.id || '')
    && layout?.name === expected?.name
    && layout?.api_name === expected?.apiName
    && layout?.status === 'active'
    && layout?.visible === true
  ));
  if (
    !record
    || String(record?.id || '') !== String(expectedRecordId || '')
    || !/^\d{19}$/.test(String(expectedRecordId || ''))
    || recordLayoutId !== expected?.id
    || matches.length !== 1
    || resolution?.exact !== true
    || resolution?.source !== 'record'
    || resolution?.reason !== null
    || String(resolution?.layout_id || '') !== expected?.id
  ) throw new Error('Deploy Team Contact layout evidence is invalid.');
  return expected.name;
}

function deployTeamPreviewOptionValues(field) {
  const values = [];
  (Array.isArray(field?.pick_list_values) ? field.pick_list_values : []).forEach(option => {
    if (option?.type === 'unused') return;
    const value = String(option?.actual_value ?? option?.display_value ?? '').trim();
    if (!value || value === '-None-' || values.includes(value)) return;
    values.push(value);
  });
  return values;
}

function deployTeamPreviewFieldMetadata(fields, specifications) {
  return specifications.flatMap(specification => {
    const matches = (Array.isArray(fields) ? fields : []).filter(field => (
      field?.api_name === specification.apiName && field?.data_type === specification.dataType
    ));
    if (matches.length !== 1) return [];
    const field = matches[0];
    const options = deployTeamPreviewOptionValues(field);
    return [{
      apiName: specification.apiName,
      dataType: specification.dataType,
      fieldReadOnly: field?.field_read_only === true,
      lookupApi: field?.lookup?.api_name || null,
      lookupModule: field?.lookup?.module?.api_name || null,
      optionCount: options.length,
      readOnly: field?.read_only === true,
      requiredOptionPresent: specification.requiredOption
        ? options.includes(specification.requiredOption)
        : null,
      systemMandatory: field?.system_mandatory === true,
    }];
  });
}

const deployTeamDealFieldSpecifications = Object.freeze([
  Object.freeze({ apiName: 'Stage', dataType: 'picklist', requiredOption: 'Start First Installation Process' }),
  Object.freeze({ apiName: 'Installation_Managers', dataType: 'picklist' }),
  Object.freeze({ apiName: 'Product_Name', dataType: 'text' }),
  Object.freeze({ apiName: 'Product_Type', dataType: 'picklist' }),
]);
const deployTeamVisitFieldSpecifications = Object.freeze([
  Object.freeze({ apiName: 'Name', dataType: 'text' }),
  Object.freeze({ apiName: 'Client_Name', dataType: 'lookup' }),
  Object.freeze({ apiName: 'Client_Address', dataType: 'textarea' }),
  Object.freeze({ apiName: 'Record_Type', dataType: 'picklist', requiredOption: 'Installation' }),
  Object.freeze({ apiName: 'AMS_Status', dataType: 'picklist', requiredOption: 'Open' }),
  Object.freeze({ apiName: 'Installation_Manager', dataType: 'picklist' }),
  Object.freeze({ apiName: 'Task_Name', dataType: 'picklist' }),
  Object.freeze({ apiName: 'Team_Member_Name', dataType: 'multiselectpicklist' }),
  Object.freeze({ apiName: 'Assigned_Team_Member_Count', dataType: 'integer' }),
  Object.freeze({ apiName: 'Scheduled_Visit_Date', dataType: 'date' }),
]);
const deployTeamServiceFieldSpecifications = Object.freeze([
  Object.freeze({ apiName: 'Orders_Name', dataType: 'lookup' }),
  Object.freeze({ apiName: 'Installations_Services', dataType: 'lookup' }),
]);

function deployTeamPreviewRelationship(relationship) {
  const rows = deployTeamPreviewOwnArray(relationship, 'data', 200);
  return {
    availability: relationship?.availability,
    hasMore: relationship?.pagination?.has_more,
    limitApplied: relationship?.pagination?.limit_applied,
    linkBasis: relationship?.link_basis,
    linkFields: Array.isArray(relationship?.link_fields) ? [...relationship.link_fields] : [],
    orders: rows.map((row, index) => ({
      ordinal: index + 1,
      stage: deployTeamPreviewDisplayStage(deployTeamPreviewOwnData(row, 'Stage').value),
    })),
    page: relationship?.pagination?.page,
    perPage: relationship?.pagination?.per_page,
    relatedModule: relationship?.related_module,
    returned: relationship?.pagination?.returned,
  };
}

function deployTeamPreviewPrivateRows(relationship) {
  const seen = new Set();
  return Object.freeze(deployTeamPreviewOwnArray(relationship, 'data', 200).map((row, index) => {
    const idMember = deployTeamPreviewOwnData(row, 'id');
    const recordId = idMember.present && typeof idMember.value === 'string' ? idMember.value : '';
    if (!/^\d{19}$/.test(recordId) || seen.has(recordId)) throw new Error('Deploy Team relationship identity is invalid.');
    seen.add(recordId);
    return Object.freeze({ ordinal: index + 1, recordId });
  }));
}

async function deployTeamPreviewMapLimit(rows, maxConcurrency, mapper) {
  const values = new Array(rows.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < rows.length) {
      const index = cursor;
      cursor += 1;
      values[index] = await mapper(rows[index], index);
    }
  };
  const workerCount = Math.min(maxConcurrency, rows.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return Object.freeze(values);
}

async function deployTeamPreviewDirectAttestations(privateOrders, relationship, preview) {
  const eligibleStage = preview?.constants?.eligibleStage;
  const eligible = relationship.orders
    .filter(order => order.stage === eligibleStage)
    .map(order => {
      const privateOrder = privateOrders.find(item => item.ordinal === order.ordinal);
      if (!privateOrder) throw new Error('Deploy Team child identity evidence is invalid.');
      return { anonymousOrder: order, privateOrder };
    });
  return deployTeamPreviewMapLimit(eligible, 4, async candidate => {
    const response = await deployTeamPreviewGet(`/api/record/Deals/${encodeURIComponent(candidate.privateOrder.recordId)}`);
    const rows = deployTeamPreviewOwnArray(response, 'data', 1);
    const record = rows.length === 1 ? rows[0] : null;
    const idMember = deployTeamPreviewOwnData(record, 'id');
    const directStage = deployTeamPreviewDisplayStage(deployTeamPreviewOwnData(record, 'Stage').value);
    if (
      !record
      || !idMember.present
      || idMember.value !== candidate.privateOrder.recordId
      || directStage !== candidate.anonymousOrder.stage
      || directStage !== eligibleStage
    ) throw new Error('Deploy Team child Deal evidence is invalid.');
    return Object.freeze({ ordinal: candidate.anonymousOrder.ordinal, stage: eligibleStage });
  });
}

function deployTeamPreviewVisitBlueprint(catalog, preview) {
  const expected = preview?.constants?.visitBlueprint;
  const matches = (Array.isArray(catalog?.blueprints) ? catalog.blueprints : [])
    .filter(blueprint => String(blueprint?.id || '') === expected?.blueprintId);
  const blueprint = matches.length === 1 ? matches[0] : null;
  const criteria = Array.isArray(blueprint?.entry?.criteria) ? blueprint.entry.criteria : [];
  const criterion = criteria.length === 1 ? criteria[0] : null;
  const states = Array.isArray(blueprint?.states) ? blueprint.states : [];
  const openStates = states.filter(state => state?.name === expected?.initialState);
  const transitions = (Array.isArray(blueprint?.transitions) ? blueprint.transitions : [])
    .filter(transition => String(transition?.id || '') === expected?.transitionId);
  const transition = transitions.length === 1 ? transitions[0] : null;
  if (
    !blueprint
    || blueprint?.name !== expected?.blueprintName
    || blueprint?.module !== expected?.module
    || blueprint?.status !== expected?.status
    || blueprint?.state_field !== expected?.stateField
    || blueprint?.entry?.logic_supported !== true
    || !criterion
    || criterion?.field !== expected?.entryField
    || criterion?.operator !== expected?.entryOperator
    || criterion?.value !== expected?.entryValue
    || openStates.length !== 1
    || !transition
    || transition?.name !== expected?.transitionName
    || transition?.from?.display_value !== expected?.fromDisplay
    || transition?.from?.actual_value !== expected?.fromActual
    || transition?.to?.display_value !== expected?.toDisplay
    || transition?.to?.actual_value !== expected?.toActual
  ) throw new Error('Deploy Team Visit Blueprint evidence is invalid.');
  return { ...expected };
}

function deployTeamPreviewAnonymousFingerprint(context) {
  return JSON.stringify(context);
}

function deployTeamPreviewPrivateFingerprint(contactId, privateOrders) {
  if (!/^\d{19}$/.test(String(contactId || ''))) throw new Error('Deploy Team Contact identity is invalid.');
  return JSON.stringify({
    contact: String(contactId),
    orderIdToOrdinal: privateOrders.map(order => [order.ordinal, order.recordId]),
  });
}

async function deployTeamPreviewReadEvidence(contactId, preview) {
  const [recordResponse, layouts, dealFields, visitFields, serviceFields, relationshipResponse, buttons, blueprints] = await Promise.all([
    deployTeamPreviewGet(`/api/record/Contacts/${encodeURIComponent(contactId)}`),
    deployTeamPreviewGet('/api/meta/layouts?module=Contacts'),
    deployTeamPreviewGet('/api/meta/fields?module=Deals'),
    deployTeamPreviewGet('/api/meta/fields?module=Visit_Module'),
    deployTeamPreviewGet('/api/meta/fields?module=Service_A_X_Orders'),
    deployTeamPreviewGet(`/api/related/Contacts/${encodeURIComponent(contactId)}/All_Orders?page=1&per_page=200`),
    deployTeamPreviewGet('/api/meta/custom_buttons?module=Contacts'),
    deployTeamPreviewGet('/api/meta/blueprint_studio'),
  ]);
  const relationship = deployTeamPreviewRelationship(relationshipResponse);
  const privateOrders = deployTeamPreviewPrivateRows(relationshipResponse);
  const eligibleAttestations = await deployTeamPreviewDirectAttestations(privateOrders, relationship, preview);
  const context = preview.createContext({
    buttonContract: deployTeamPreviewButtonContract(buttons),
    contactLayout: deployTeamPreviewContactLayout(recordResponse, layouts, contactId, preview),
    dealFieldMetadata: deployTeamPreviewFieldMetadata(dealFields?.fields, deployTeamDealFieldSpecifications),
    eligibleAttestations,
    relationship,
    serviceFieldMetadata: deployTeamPreviewFieldMetadata(serviceFields?.fields, deployTeamServiceFieldSpecifications),
    visitBlueprint: deployTeamPreviewVisitBlueprint(blueprints, preview),
    visitFieldMetadata: deployTeamPreviewFieldMetadata(visitFields?.fields, deployTeamVisitFieldSpecifications),
  });
  return Object.freeze({
    anonymousFingerprint: deployTeamPreviewAnonymousFingerprint(context),
    context,
    privateFingerprint: deployTeamPreviewPrivateFingerprint(contactId, privateOrders),
  });
}

function deployTeamPreviewMetadataCount(context, apiName) {
  return context.visitFieldMetadata.find(field => field.apiName === apiName)?.optionCount || 0;
}

function deployTeamPreviewAppendDefinitionList(container, rows, className = 'deploy-team-preview-basis') {
  const list = deployTeamPreviewNode('dl', className);
  rows.forEach(([term, description]) => {
    list.append(deployTeamPreviewNode('dt', null, term), deployTeamPreviewNode('dd', null, description));
  });
  container.appendChild(list);
}

function renderDeployTeamReadinessPreview(container, contactId, idPrefix) {
  const preview = window.DeployTeamReadinessPreview;
  const panel = deployTeamPreviewNode('section', 'deploy-team-preview-panel');
  panel.setAttribute('aria-label', 'Deploy Team GET-only readiness preview');
  const header = deployTeamPreviewNode('div', 'deploy-team-preview-header');
  header.append(
    deployTeamPreviewNode('span', 'estimate-preview-badge', 'GET-only preview'),
    deployTeamPreviewNode('h3', null, 'Anonymous installation-team readiness'),
  );
  panel.appendChild(header);
  panel.appendChild(deployTeamPreviewNode(
    'div',
    'deploy-team-preview-warning',
    'This original local preview performs uncached GET-only reads, requires the exact registered Contact layout and complete All_Orders relationship, and re-attests every eligible Order with at most four concurrent reads. It never creates a Visit or link row, resolves a user identity, checks a permission, triggers a workflow, persists data, opens a file, runs captured code, or contacts a provider.',
  ));
  const loading = deployTeamPreviewNode('div', 'bp-phase-summary', 'Checking the current button, Contact layout, fields, complete All_Orders relationship, direct eligible Orders, linking schema, and installation Visit Blueprint entry…');
  loading.setAttribute('role', 'status');
  loading.setAttribute('aria-live', 'polite');
  loading.setAttribute('aria-atomic', 'true');
  panel.appendChild(loading);
  container.appendChild(panel);

  deployTeamPreviewReadEvidence(contactId, preview).then(reviewedEvidence => {
    if (!panel.isConnected) return;
    const context = reviewedEvidence.context;
    const eligibleOrders = context.eligibleAttestations;
    const blockedCount = context.relationship.orders.length - eligibleOrders.length;
    const managerCount = deployTeamPreviewMetadataCount(context, 'Installation_Manager');
    const taskCount = deployTeamPreviewMetadataCount(context, 'Task_Name');
    const teamCount = deployTeamPreviewMetadataCount(context, 'Team_Member_Name');
    loading.remove();
    deployTeamPreviewAppendDefinitionList(panel, [
      ['Registration', 'Exact Contacts view button · Standard layout · no parent Blueprint binding'],
      ['All Orders', `${context.relationship.returned} complete anonymous row${context.relationship.returned === 1 ? '' : 's'} · ${eligibleOrders.length} eligible · ${blockedCount} blocked`],
      ['Eligibility', 'Own displayed Stage must equal Start First Installation Process'],
      ['Manager options', `${managerCount} configured · labels and identities withheld`],
      ['Task options', `${taskCount} configured · labels withheld`],
      ['Team options', `${teamCount} configured · labels and identities withheld`],
      ['Visit entry', 'Record Type Installation · initial Stage Open'],
      ['Not attested', 'Owner, permissions, workflow effects, server validation, and atomic creation'],
    ]);

    if (!eligibleOrders.length) {
      panel.appendChild(deployTeamPreviewNode('div', 'deploy-team-preview-empty', 'No anonymous All_Orders row currently has the exact directly re-attested Start First Installation Process display Stage. No plan can be generated.'));
      return;
    }

    const form = deployTeamPreviewNode('div', 'deploy-team-preview-form');
    const orders = deployTeamPreviewNode('fieldset', 'deploy-team-preview-orders');
    orders.appendChild(deployTeamPreviewNode('legend', null, 'Eligible Orders *'));
    const orderControls = eligibleOrders.map(order => {
      const label = deployTeamPreviewNode('label', 'deploy-team-preview-order');
      const input = deployTeamPreviewNode('input');
      input.type = 'checkbox';
      input.value = String(order.ordinal);
      label.append(input, deployTeamPreviewNode('span', null, `Order ${order.ordinal} · Stage attested`));
      orders.appendChild(label);
      return input;
    });
    form.appendChild(orders);

    let fieldSequence = 0;
    const makeField = (labelText, control, hint) => {
      fieldSequence += 1;
      const field = deployTeamPreviewNode('div', 'deploy-team-preview-field');
      const controlId = `${idPrefix}-field-${fieldSequence}`;
      const label = deployTeamPreviewNode('label', null, labelText);
      label.htmlFor = controlId;
      control.id = controlId;
      field.append(label, control);
      if (hint) {
        const hintNode = deployTeamPreviewNode('small', null, hint);
        hintNode.id = `${controlId}-hint`;
        control.setAttribute('aria-describedby', hintNode.id);
        field.appendChild(hintNode);
      }
      return field;
    };
    const ordinalSelect = (placeholder, prefix, count) => {
      const select = deployTeamPreviewNode('select');
      const placeholderOption = deployTeamPreviewNode('option', null, placeholder);
      placeholderOption.value = '';
      select.appendChild(placeholderOption);
      for (let ordinal = 1; ordinal <= count; ordinal += 1) {
        const option = deployTeamPreviewNode('option', null, `${prefix} ${ordinal}`);
        option.value = String(ordinal);
        select.appendChild(option);
      }
      return select;
    };
    const manager = ordinalSelect('Select manager option', 'Manager option', managerCount);
    const task = ordinalSelect('Select task option', 'Task option', taskCount);
    const team = ordinalSelect('', 'Team option', teamCount);
    team.removeChild(team.firstChild);
    team.multiple = true;
    team.size = Math.min(7, teamCount);
    const visitDate = deployTeamPreviewNode('input');
    visitDate.type = 'date';
    form.append(
      makeField('Installation manager *', manager, 'Only anonymous option ordinals are displayed.'),
      makeField('Task *', task, 'Only an anonymous option ordinal is used in the display plan.'),
      makeField('Team members *', team, 'Choose one or more anonymous option ordinals.'),
      makeField('Scheduled visit date *', visitDate, 'Used only in the non-persisted display plan.'),
    );

    const generate = deployTeamPreviewNode('button', 'btn-primary deploy-team-preview-generate', 'Generate display-only plan');
    generate.type = 'button';
    const result = deployTeamPreviewNode('section', 'deploy-team-preview-result is-empty');
    result.setAttribute('aria-live', 'polite');
    result.setAttribute('aria-atomic', 'true');
    result.appendChild(deployTeamPreviewNode('p', null, 'Choose eligible Order, manager, task, team, and date ordinals to generate an ID-free plan.'));
    const showError = text => {
      result.className = 'deploy-team-preview-result is-error';
      result.replaceChildren(deployTeamPreviewNode('p', null, text));
    };
    generate.onclick = async () => {
      const selection = Object.freeze({
        managerOrdinal: Number(manager.value),
        orderOrdinals: Object.freeze(orderControls.filter(control => control.checked).map(control => Number(control.value))),
        taskOrdinal: Number(task.value),
        teamOrdinals: Object.freeze(Array.from(team.selectedOptions).map(option => Number(option.value))),
        visitDate: visitDate.value,
      });
      if (!selection.orderOrdinals.length || !selection.managerOrdinal || !selection.taskOrdinal || !selection.teamOrdinals.length || !selection.visitDate) {
        showError('Complete every required anonymous selection before generating the display-only plan. Nothing was changed.');
        if (!selection.orderOrdinals.length) orderControls[0]?.focus();
        else if (!selection.managerOrdinal) manager.focus();
        else if (!selection.taskOrdinal) task.focus();
        else if (!selection.teamOrdinals.length) team.focus();
        else visitDate.focus();
        return;
      }
      const formControls = [...orderControls, manager, task, team, visitDate];
      formControls.forEach(control => { control.disabled = true; });
      generate.disabled = true;
      generate.textContent = 'Rechecking current evidence…';
      try {
        const freshEvidence = await deployTeamPreviewReadEvidence(contactId, preview);
        if (
          freshEvidence.privateFingerprint !== reviewedEvidence.privateFingerprint
          || freshEvidence.anonymousFingerprint !== reviewedEvidence.anonymousFingerprint
        ) throw new Error('Deploy Team evidence changed.');
        const plan = preview.buildPlan({
          context: freshEvidence.context,
          selection,
        });
        result.className = 'deploy-team-preview-result';
        result.replaceChildren(deployTeamPreviewNode('h4', null, 'Frozen display-only deployment plan'));
        deployTeamPreviewAppendDefinitionList(result, [
          ['Record Type', plan.visit.recordType],
          ['Initial Stage', plan.visit.initialStage],
          ['Scheduled date', plan.visit.scheduledVisitDate],
          ['Manager', plan.visit.managerOption],
          ['Task', plan.visit.taskOption],
          ['Team', plan.visit.teamOptions.join(', ')],
          ['Orders', plan.visit.orderOptions.join(', ')],
          ['Planned link rows', String(plan.totals.linkRows)],
          ['Unavailable guarantees', plan.unavailable.join(' · ')],
        ], 'deploy-team-preview-plan');
        result.appendChild(deployTeamPreviewNode('small', null, 'Not persisted · no record, workflow, permission, identity, validation, or atomic-write claim was made.'));
      } catch {
        showError('Fresh local evidence no longer satisfies the reviewed Deploy Team readiness contract. No plan was generated and nothing was changed.');
      } finally {
        formControls.forEach(control => { control.disabled = false; });
        generate.disabled = false;
        generate.textContent = 'Generate display-only plan';
      }
    };
    form.append(generate, result);
    panel.appendChild(form);
  }).catch(error => {
    if (!panel.isConnected) return;
    loading.className = 'deploy-team-preview-error';
    loading.textContent = error?.code === 'CLIENT_ADDRESS_READ_ONLY_CONFLICT'
      ? 'Blocked by current Visit metadata: Client Address is read-only, while the reviewed source behavior requires a value for the proposed Visit. No plan was generated and nothing was changed.'
      : 'The exact fresh Contact layout, registered button, current fields, complete All_Orders relationship, direct Order evidence, linking schema, or installation Visit Blueprint entry is unavailable. No plan was generated and nothing was changed.';
  });
}

let activeDeployTeamReadinessPreviewClose = null;
let deployTeamReadinessPreviewSequence = 0;
function openDeployTeamReadinessPreview(mod, contactId, record, button, layoutExact, resolvedLayoutId, restoreFocus = document.activeElement) {
  if (!isDeployTeamReadinessPreviewButton(button, mod, record, layoutExact, resolvedLayoutId)) {
    toast('Deploy Team readiness preview is unavailable. Nothing was changed.');
    return;
  }
  if (activeJourneyDialogClose) activeJourneyDialogClose(false);
  if (activeEstimatePreviewClose) activeEstimatePreviewClose(false);
  if (activeAssignTechnicianPreviewClose) activeAssignTechnicianPreviewClose(false);
  if (activeDesignerFormPreviewClose) activeDesignerFormPreviewClose(false);
  if (activePaymentMilestonePreviewClose) activePaymentMilestonePreviewClose(false);
  if (activeReviseQuotePreviewClose) activeReviseQuotePreviewClose(false);
  if (activeReviseApproveAnyStagePreviewClose) activeReviseApproveAnyStagePreviewClose(false);
  if (activeClosureNewPreviewClose) activeClosureNewPreviewClose(false);
  if (activeDeployTeamReadinessPreviewClose) activeDeployTeamReadinessPreviewClose(false);
  if (activeBlueprintTransitionClose) activeBlueprintTransitionClose(false);
  const modal = $('#modal');
  const box = $('#modalBox');
  box.replaceChildren();
  deployTeamReadinessPreviewSequence += 1;
  const idPrefix = `deploy-team-preview-${deployTeamReadinessPreviewSequence}`;
  const titleId = `${idPrefix}-title`;
  const header = deployTeamPreviewNode('div', 'mh deploy-team-preview-modal-head');
  const headingWrap = deployTeamPreviewNode('div', 'deploy-team-preview-heading');
  headingWrap.append(deployTeamPreviewNode('span', 'estimate-preview-badge', 'GET-only preview'));
  const heading = deployTeamPreviewNode('h2', null, 'Deploy Team readiness');
  heading.id = titleId;
  headingWrap.appendChild(heading);
  const close = deployTeamPreviewNode('button', 'x', '✕');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close Deploy Team readiness preview');
  const shell = $('#shell');
  const shellWasInert = shell?.hasAttribute('inert') === true;
  if (shell) shell.setAttribute('inert', '');
  let keyHandler = null;
  const shut = (returnFocus = true) => {
    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    if (activeDeployTeamReadinessPreviewClose === shut) activeDeployTeamReadinessPreviewClose = null;
    modal.classList.add('hidden');
    modal.removeAttribute('role');
    modal.removeAttribute('aria-modal');
    modal.removeAttribute('aria-labelledby');
    if (shell && !shellWasInert) shell.removeAttribute('inert');
    if (returnFocus && restoreFocus && document.contains(restoreFocus)) restoreFocus.focus();
  };
  activeDeployTeamReadinessPreviewClose = shut;
  close.onclick = shut;
  header.append(headingWrap, close);
  const body = deployTeamPreviewNode('div', 'mb deploy-team-preview-modal-body');
  renderDeployTeamReadinessPreview(body, contactId, idPrefix);
  const footer = deployTeamPreviewNode('div', 'mf');
  const done = deployTeamPreviewNode('button', null, 'Close preview');
  done.type = 'button';
  done.onclick = shut;
  footer.appendChild(done);
  box.append(header, body, footer);
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', titleId);
  modal.classList.remove('hidden');
  keyHandler = event => {
    if (event.key === 'Escape' && !modal.classList.contains('hidden')) shut();
    if (event.key === 'Tab' && !modal.classList.contains('hidden')) {
      const focusable = Array.from(box.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'))
        .filter(node => node.getClientRects().length > 0 && !node.closest('.hidden'));
      event.preventDefault();
      if (!focusable.length) return;
      const activeIndex = focusable.indexOf(document.activeElement);
      const nextIndex = activeIndex < 0
        ? (event.shiftKey ? focusable.length - 1 : 0)
        : (activeIndex + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
      focusable[nextIndex].focus();
    }
  };
  document.addEventListener('keydown', keyHandler);
  close.focus();
}
/* Deploy Team GET-only readiness preview end */

/* Handover To Post Team GET-only preview start */
function handoverPostTeamPreviewNode(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

function handoverPostTeamPreviewGet(path) {
  if (typeof path !== 'string' || !path.startsWith('/api/')) {
    return Promise.reject(new Error('Handover To Post Team local evidence path is invalid.'));
  }
  return api(path, { method: 'GET', cache: 'no-store' });
}

function handoverPostTeamPreviewDisplayStage(value) {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, 'display_value');
  } catch {
    return '';
  }
  if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value') || typeof descriptor.value !== 'string') return '';
  return descriptor.value.trim();
}

function handoverPostTeamPreviewLayoutId(record) {
  return String(record?.Layout?.id || record?.$layout_id?.id || '');
}

function isHandoverPostTeamPreviewInput(mod, record, blueprint, transition, input) {
  const preview = window.HandoverPostTeamPreview;
  const parent = preview?.constants?.parentContract;
  const owners = transition?.before?.owners;
  const criteria = transition?.before?.criteria;
  return mod === 'Contacts'
    && handoverPostTeamPreviewLayoutId(record) === '1032257000000000171'
    && handoverPostTeamPreviewDisplayStage(record?.Stage) === 'Second Installation Done'
    && String(blueprint?.blueprint_id || '') === '1032257000001044611'
    && blueprint?.blueprint === 'Opportunity Stage'
    && blueprint?.state_field === 'Stage'
    && handoverPostTeamPreviewDisplayStage(blueprint?.current) === 'Second Installation Done'
    && blueprint?.local === true
    && String(transition?.id || '') === '1032257000023182424'
    && transition?.name === 'Final Handover'
    && transition?.next_value === 'Final Handover'
    && transition?.next_actual_value === 'Final Handover'
    && transition?.common === false
    && transition?.trigger_type === 'manual'
    && transition?.executable === false
    && Array.isArray(owners) && owners.length === 1 && owners[0] === 'Record Owner'
    && Array.isArray(criteria) && criteria.length === 0
    && Array.isArray(transition?.during_inputs)
    && transition.during_inputs.length === 1
    && transition.during_inputs[0] === input
    && Array.isArray(transition?.after_actions)
    && transition.after_actions.length === 0
    && input?.kind === 'widget'
    && input?.api_name === null
    && input?.label === 'Handover To Post Team'
    && input?.data_type === 'widget'
    && input?.required === false
    && input?.sequence === 1
    && input?.widget_id == null
    && input?.name == null
    && parent?.transitionId === '1032257000023182424'
    && typeof preview?.createEvidence === 'function'
    && typeof preview?.compareEvidence === 'function'
    && typeof preview?.buildPlan === 'function'
    && typeof preview?.mapLimit === 'function';
}

function handoverPostTeamPreviewOptionValues(field) {
  return (Array.isArray(field?.pick_list_values) ? field.pick_list_values : [])
    .filter(option => option?.type !== 'unused')
    .map(option => String(option?.actual_value ?? option?.display_value ?? '').trim())
    .filter(value => value && value !== '-None-');
}

function handoverPostTeamPreviewFieldMetadata(response, schemas) {
  const fields = Array.isArray(response?.fields) ? response.fields : [];
  return Object.entries(schemas).map(([apiName, schema]) => {
    const matches = fields.filter(field => field?.api_name === apiName && field?.data_type === schema.dataType);
    if (matches.length !== 1) throw new Error('Handover To Post Team field metadata is invalid.');
    const field = matches[0];
    return {
      apiName: field.api_name,
      dataType: field.data_type,
      length: field.length,
      options: schema.dataType === 'picklist' ? handoverPostTeamPreviewOptionValues(field) : [],
      readOnly: field.field_read_only === true,
      relatedModule: field?.lookup?.module?.api_name || null,
      systemMandatory: field.system_mandatory === true,
    };
  });
}

function handoverPostTeamPreviewLayoutCatalog(response) {
  return {
    layouts: (Array.isArray(response?.layouts) ? response.layouts : []).map(layout => ({
      id: String(layout?.id || ''),
      name: layout?.name,
      status: layout?.status,
      visible: layout?.visible,
    })),
  };
}

function handoverPostTeamPreviewParentRecord(response, contactId, preview) {
  const records = Array.isArray(response?.data) ? response.data : [];
  const resolution = response?.layout_resolution;
  const expected = preview?.constants?.parentContract;
  if (
    resolution?.exact !== true
    || resolution?.source !== 'record'
    || resolution?.reason !== null
    || String(resolution?.layout_id || '') !== expected?.layoutId
  ) throw new Error('Handover To Post Team parent layout resolution is invalid.');
  return {
    records: records.map(record => ({
      id: String(record?.id || ''),
      layoutId: handoverPostTeamPreviewLayoutId(record),
      stage: record?.Stage,
    })),
    requestedId: String(contactId || ''),
  };
}

function handoverPostTeamPreviewRelationship(response) {
  const rows = Array.isArray(response?.data) ? response.data : [];
  return {
    availability: response?.availability,
    hasMore: response?.pagination?.has_more,
    limitApplied: response?.pagination?.limit_applied,
    linkBasis: response?.link_basis,
    linkFields: Array.isArray(response?.link_fields) ? [...response.link_fields] : [],
    orders: rows.map((row, index) => ({
      id: String(row?.id || ''),
      ordinal: index + 1,
      stage: row?.Stage,
    })),
    page: response?.pagination?.page,
    perPage: response?.pagination?.per_page,
    relatedModule: response?.related_module,
    returned: response?.pagination?.returned,
  };
}

function handoverPostTeamPreviewDuringInputs(inputs) {
  return (Array.isArray(inputs) ? inputs : []).map(input => {
    const normalized = {
      apiName: input?.api_name ?? null,
      dataType: input?.data_type,
      kind: input?.kind,
      label: input?.label,
      required: input?.required,
      sequence: input?.sequence,
    };
    const checklist = input?.checklist_info || input?.checklist;
    if (input?.kind === 'checklist') {
      normalized.checklist = {
        items: (Array.isArray(checklist?.items) ? checklist.items : []).map(item => ({
          name: item?.name,
          required: item?.required,
        })),
        title: checklist?.title,
      };
    }
    return normalized;
  });
}

function handoverPostTeamPreviewAfterActions(actions) {
  return (Array.isArray(actions) ? actions : []).map(action => ({
    details: {
      fieldApiName: action?.details?.field_api_name,
      fieldLabel: action?.details?.field_label,
      value: action?.details?.value,
    },
    id: String(action?.id || ''),
    name: action?.name,
    type: action?.type,
  }));
}

function handoverPostTeamPreviewStudioBlueprint(catalog, contract) {
  const matches = (Array.isArray(catalog?.blueprints) ? catalog.blueprints : [])
    .filter(blueprint => String(blueprint?.id || '') === contract?.blueprintId);
  if (matches.length !== 1) throw new Error('Handover To Post Team Blueprint catalog is invalid.');
  const blueprint = matches[0];
  const transitions = (Array.isArray(blueprint?.transitions) ? blueprint.transitions : [])
    .filter(transition => String(transition?.id || '') === contract?.transitionId);
  if (transitions.length !== 1) throw new Error('Handover To Post Team transition catalog is invalid.');
  return { blueprint, transition: transitions[0] };
}

function handoverPostTeamPreviewBlueprint(runtime, catalog, contract, recordId, kind) {
  const studio = handoverPostTeamPreviewStudioBlueprint(catalog, contract);
  const runtimeMatches = [
    ...(Array.isArray(runtime?.transitions) ? runtime.transitions : []),
    ...(Array.isArray(runtime?.automatic_transitions) ? runtime.automatic_transitions : []),
  ].filter(transition => String(transition?.id || '') === contract?.transitionId);
  if (runtimeMatches.length !== 1) throw new Error('Handover To Post Team runtime transition is invalid.');
  const transition = runtimeMatches[0];
  const owners = Array.isArray(transition?.before?.owners) ? transition.before.owners : [];
  const criteria = Array.isArray(transition?.before?.criteria) ? transition.before.criteria : [];
  const runtimeDuring = handoverPostTeamPreviewDuringInputs(transition?.during_inputs);
  const studioDuring = handoverPostTeamPreviewDuringInputs(studio.transition?.during?.inputs);
  const runtimeAfter = handoverPostTeamPreviewAfterActions(transition?.after_actions);
  const studioAfter = Array.isArray(studio.transition?.after?.actions) ? studio.transition.after.actions : [];
  const studioOwners = Array.isArray(studio.transition?.before?.owners) ? studio.transition.before.owners : [];
  const studioCriteria = Array.isArray(studio.transition?.before?.criteria) ? studio.transition.before.criteria : [];
  if (
    studio.blueprint?.name !== contract?.blueprintName
    || studio.blueprint?.state_field !== contract?.stateField
    || runtime?.blueprint !== studio.blueprint?.name
    || runtime?.state_field !== studio.blueprint?.state_field
    || studio.transition?.name !== contract?.transitionName
    || transition?.name !== studio.transition?.name
    || JSON.stringify(runtimeDuring) !== JSON.stringify(studioDuring)
    || studio.transition?.during?.input_count !== runtimeDuring.length
    || studio.transition?.after?.action_count !== runtimeAfter.length
    || studioAfter.length !== runtimeAfter.length
    || studioAfter.some((action, index) => (
      String(action?.id || '') !== runtimeAfter[index]?.id
      || action?.type !== runtimeAfter[index]?.type
      || action?.name !== runtimeAfter[index]?.name
      || action?.details_available !== true
    ))
    || JSON.stringify(owners) !== JSON.stringify(studioOwners)
    || criteria.length !== studioCriteria.length
    || studio.transition?.from?.display_value !== contract?.currentDisplay
    || studio.transition?.from?.actual_value !== contract?.currentActual
    || studio.transition?.to?.display_value !== transition?.next_value
    || studio.transition?.to?.actual_value !== transition?.next_actual_value
  ) throw new Error('Handover To Post Team Blueprint evidence drifted.');
  if (kind === 'child') {
    const ownerDetails = Array.isArray(transition?.before?.owner_details) ? transition.before.owner_details : [];
    if (ownerDetails.length !== 1 || ownerDetails[0]?.type !== 'record_owner' || ownerDetails[0]?.resource_count !== 0) {
      throw new Error('Handover To Post Team child owner evidence is invalid.');
    }
  }
  return {
    blueprintId: String(runtime?.blueprint_id || ''),
    blueprintName: runtime?.blueprint,
    currentDisplay: handoverPostTeamPreviewDisplayStage(runtime?.current),
    layoutId: String(studio.blueprint?.layout?.id || ''),
    layoutName: studio.blueprint?.layout?.name,
    local: runtime?.local,
    module: studio.blueprint?.module,
    recordId: String(recordId || ''),
    stateField: runtime?.state_field,
    status: studio.blueprint?.status,
    transition: {
      afterActions: runtimeAfter,
      common: transition?.common,
      criteriaCount: criteria.length,
      duringInputs: runtimeDuring,
      executable: transition?.executable,
      fromActual: studio.transition?.from?.actual_value,
      fromDisplay: studio.transition?.from?.display_value,
      id: String(transition?.id || ''),
      localExecution: studio.transition?.execution?.status,
      name: transition?.name,
      ownerCount: owners.length,
      ownerType: owners[0] === 'Record Owner' ? 'record_owner' : null,
      toActual: transition?.next_actual_value,
      toDisplay: transition?.next_value,
      triggerType: transition?.trigger_type,
    },
  };
}

function handoverPostTeamPreviewDirectOrder(recordResponse, blueprintResponse, catalog, order, preview) {
  const rows = Array.isArray(recordResponse?.data) ? recordResponse.data : [];
  const resolution = recordResponse?.layout_resolution;
  const recordId = String(order?.id || '');
  return {
    blueprint: handoverPostTeamPreviewBlueprint(
      blueprintResponse,
      catalog,
      preview?.constants?.childContract,
      recordId,
      'child',
    ),
    layoutResolution: {
      candidateCount: resolution?.candidate_count,
      exact: resolution?.exact,
      layoutId: String(resolution?.layout_id || ''),
      reason: resolution?.reason,
      source: resolution?.source,
    },
    ordinal: order?.ordinal,
    records: rows.map(record => ({
      id: String(record?.id || ''),
      stage: record?.Stage,
    })),
    requestedId: recordId,
  };
}

function handoverPostTeamPreviewAmsBlueprintCatalog(catalog, preview) {
  const expected = preview?.constants?.amsContract;
  const blueprints = Array.isArray(catalog?.blueprints) ? catalog.blueprints : [];
  const expectedIds = (Array.isArray(expected?.blueprints) ? expected.blueprints : [])
    .map(contract => contract.blueprintId)
    .sort();
  const activeRelevantIds = blueprints
    .filter(blueprint => (
      blueprint?.module === expected?.module
      && blueprint?.status === expected?.status
      && String(blueprint?.layout?.id || '') === expected?.layoutId
    ))
    .map(blueprint => String(blueprint?.id || ''))
    .sort();
  if (
    activeRelevantIds.length !== expectedIds.length
    || activeRelevantIds.some((id, index) => id !== expectedIds[index])
  ) throw new Error('Handover To Post Team active AMS Blueprint set is invalid.');
  return {
    blueprints: (Array.isArray(expected?.blueprints) ? expected.blueprints : []).map(contract => {
      const matches = blueprints
        .filter(blueprint => String(blueprint?.id || '') === contract.blueprintId);
      if (matches.length !== 1) throw new Error('Handover To Post Team AMS Blueprint evidence is invalid.');
      const blueprint = matches[0];
      return {
        blueprintId: String(blueprint?.id || ''),
        blueprintName: blueprint?.name,
        layoutId: String(blueprint?.layout?.id || ''),
        layoutName: blueprint?.layout?.name,
        module: blueprint?.module,
        stateField: blueprint?.state_field,
        status: blueprint?.status,
        transitions: (Array.isArray(blueprint?.transitions) ? blueprint.transitions : []).map(transition => ({
          active: blueprint?.status === 'Active',
          toActual: transition?.to?.actual_value,
          toDisplay: transition?.to?.display_value,
        })),
      };
    }),
  };
}

async function handoverPostTeamPreviewReadEvidence(contactId, preview) {
  const [
    parentRecordResponse,
    contactLayoutsResponse,
    contactFieldsResponse,
    dealLayoutsResponse,
    dealFieldsResponse,
    amsLayoutsResponse,
    amsFieldsResponse,
    relationshipResponse,
    parentBlueprintResponse,
    blueprintCatalog,
  ] = await Promise.all([
    handoverPostTeamPreviewGet(`/api/record/Contacts/${encodeURIComponent(contactId)}`),
    handoverPostTeamPreviewGet('/api/meta/layouts?module=Contacts'),
    handoverPostTeamPreviewGet('/api/meta/fields?module=Contacts'),
    handoverPostTeamPreviewGet('/api/meta/layouts?module=Deals'),
    handoverPostTeamPreviewGet('/api/meta/fields?module=Deals'),
    handoverPostTeamPreviewGet('/api/meta/layouts?module=AMS_Complaints'),
    handoverPostTeamPreviewGet('/api/meta/fields?module=AMS_Complaints'),
    handoverPostTeamPreviewGet(`/api/related/Contacts/${encodeURIComponent(contactId)}/All_Orders?page=1&per_page=200`),
    handoverPostTeamPreviewGet(`/api/blueprint/Contacts/${encodeURIComponent(contactId)}`),
    handoverPostTeamPreviewGet('/api/meta/blueprint_studio'),
  ]);
  const relationship = handoverPostTeamPreviewRelationship(relationshipResponse);
  const eligibleOrders = relationship.orders.filter(order => (
    handoverPostTeamPreviewDisplayStage(order.stage) === preview?.constants?.childContract?.currentDisplay
  ));
  const directOrders = await preview.mapLimit(eligibleOrders, 4, async order => {
    const recordResponse = await handoverPostTeamPreviewGet(`/api/record/Deals/${encodeURIComponent(order.id)}`);
    const blueprintResponse = await handoverPostTeamPreviewGet(`/api/blueprint/Deals/${encodeURIComponent(order.id)}`);
    return handoverPostTeamPreviewDirectOrder(recordResponse, blueprintResponse, blueprintCatalog, order, preview);
  });
  return preview.createEvidence({
    amsBlueprintCatalog: handoverPostTeamPreviewAmsBlueprintCatalog(blueprintCatalog, preview),
    amsFieldMetadata: handoverPostTeamPreviewFieldMetadata(amsFieldsResponse, preview.constants.amsFieldSchemas),
    amsLayoutCatalog: handoverPostTeamPreviewLayoutCatalog(amsLayoutsResponse),
    contactFieldMetadata: handoverPostTeamPreviewFieldMetadata(contactFieldsResponse, preview.constants.contactFieldSchemas),
    contactLayoutCatalog: handoverPostTeamPreviewLayoutCatalog(contactLayoutsResponse),
    dealFieldMetadata: handoverPostTeamPreviewFieldMetadata(dealFieldsResponse, preview.constants.dealFieldSchemas),
    dealLayoutCatalog: handoverPostTeamPreviewLayoutCatalog(dealLayoutsResponse),
    directOrders,
    ordersRelationship: relationship,
    parentBlueprint: handoverPostTeamPreviewBlueprint(
      parentBlueprintResponse,
      blueprintCatalog,
      preview.constants.parentContract,
      contactId,
      'parent',
    ),
    parentRecord: handoverPostTeamPreviewParentRecord(parentRecordResponse, contactId, preview),
  });
}

function handoverPostTeamPreviewDefinitionList(container, rows, className = 'handover-post-team-preview-basis') {
  const list = handoverPostTeamPreviewNode('dl', className);
  rows.forEach(([term, description]) => {
    list.append(
      handoverPostTeamPreviewNode('dt', null, term),
      handoverPostTeamPreviewNode('dd', null, description),
    );
  });
  container.appendChild(list);
}

function handoverPostTeamPreviewBulletList(container, values, className) {
  const list = handoverPostTeamPreviewNode('ul', className);
  values.forEach(value => list.appendChild(handoverPostTeamPreviewNode('li', null, value)));
  container.appendChild(list);
}

function handoverPostTeamPreviewRenderPlan(result, plan) {
  result.className = 'handover-post-team-preview-result';
  result.replaceChildren(handoverPostTeamPreviewNode('h4', null, 'Frozen display-only handover plan'));
  handoverPostTeamPreviewDefinitionList(result, [
    ['All Orders', `${plan.totals.relationship_orders} complete anonymous row${plan.totals.relationship_orders === 1 ? '' : 's'}`],
    ['Eligible', `${plan.totals.eligible_orders} directly re-attested`],
    ['Blocked by Stage', String(plan.totals.blocked_orders)],
    ['Parent transition', `${plan.parent_transition.current} → ${plan.parent_transition.next} · continuation ${plan.parent_transition.continuation}`],
    ['Permissions', plan.parent_transition.permissions],
    ['Persistence', plan.persistence],
  ], 'handover-post-team-preview-plan-summary');

  const orderSection = handoverPostTeamPreviewNode('section', 'handover-post-team-preview-orders');
  orderSection.appendChild(handoverPostTeamPreviewNode('h5', null, 'Eligible anonymous Orders'));
  if (!plan.order_plans.length) {
    orderSection.appendChild(handoverPostTeamPreviewNode('p', 'handover-post-team-preview-empty', 'No Order currently qualifies for the disabled child handover transition.'));
  }
  plan.order_plans.forEach(order => {
    const card = handoverPostTeamPreviewNode('article', 'handover-post-team-preview-order-card');
    card.appendChild(handoverPostTeamPreviewNode('h6', null, order.order_label));
    handoverPostTeamPreviewDefinitionList(card, [
      ['Observed Stage', order.source_stage],
      ['Intended transition', order.intended_transition],
      ['Execution', order.execution],
      ['Runtime attestation', order.runtime_attestation],
      ['Observed After effect', `${order.after_effect.field} · ${order.after_effect.timing} · disabled`],
    ], 'handover-post-team-preview-order-details');
    handoverPostTeamPreviewBulletList(
      card,
      order.required_inputs.map(input => `${input.label} · ${input.type} · ${input.required ? 'required' : 'optional'} · disabled`),
      'handover-post-team-preview-inputs',
    );
    orderSection.appendChild(card);
  });
  result.appendChild(orderSection);

  const blockedSection = handoverPostTeamPreviewNode('section', 'handover-post-team-preview-blocked-orders');
  blockedSection.appendChild(handoverPostTeamPreviewNode('h5', null, 'Other anonymous Orders'));
  if (!plan.blocked_orders.length) {
    blockedSection.appendChild(handoverPostTeamPreviewNode('p', 'handover-post-team-preview-empty', 'No other All_Orders row was blocked by its current displayed Stage.'));
  } else {
    handoverPostTeamPreviewBulletList(
      blockedSection,
      plan.blocked_orders.map(order => `${order.order_label} · ${order.source_stage} · blocked: Stage is not Second Installation Done`),
      'handover-post-team-preview-blocked-list',
    );
  }
  result.appendChild(blockedSection);

  const ams = handoverPostTeamPreviewNode('section', 'handover-post-team-preview-ams');
  ams.appendChild(handoverPostTeamPreviewNode('h5', null, 'AMS creation and enrollment'));
  handoverPostTeamPreviewDefinitionList(ams, [
    ['Schema', plan.ams_plan.schema_attestation],
    ['Intended Stage', plan.ams_plan.intended_stage],
    ['Creation', plan.ams_plan.creation],
    ['Blueprint enrollment', plan.ams_plan.blueprint_enrollment],
    ['Blocking evidence', 'Zero active reviewed AMS transition targets Planned'],
  ], 'handover-post-team-preview-ams-details');
  result.appendChild(ams);

  const boundaries = handoverPostTeamPreviewNode('section', 'handover-post-team-preview-boundaries');
  boundaries.appendChild(handoverPostTeamPreviewNode('h5', null, 'Execution boundaries'));
  handoverPostTeamPreviewBulletList(boundaries, plan.blocked_actions, 'handover-post-team-preview-boundary-list');
  result.appendChild(boundaries);
  result.appendChild(handoverPostTeamPreviewNode(
    'small',
    null,
    'Nothing was persisted. No record, file, identity, owner, permission, workflow, provider, or Blueprint execution claim was made.',
  ));
}

function renderHandoverPostTeamPreview(container, contactId) {
  const preview = window.HandoverPostTeamPreview;
  const panel = handoverPostTeamPreviewNode('section', 'handover-post-team-preview-panel');
  panel.setAttribute('aria-label', 'Handover To Post Team GET-only preview');
  const header = handoverPostTeamPreviewNode('div', 'handover-post-team-preview-header');
  header.append(
    handoverPostTeamPreviewNode('span', 'estimate-preview-badge', 'GET-only preview'),
    handoverPostTeamPreviewNode('h3', null, 'Anonymous final-handover readiness'),
  );
  panel.appendChild(header);
  panel.appendChild(handoverPostTeamPreviewNode(
    'div',
    'handover-post-team-preview-warning',
    'This original local preview performs uncached GET-only reads. It requires the exact Final Handover parent widget, complete All_Orders data, direct eligible Deal and child Blueprint evidence with at most four concurrent candidates, current metadata, exact layouts, and current AMS Blueprint targets. It cannot transfer a file, update a Deal, create AMS data, continue a Blueprint, trigger a workflow, resolve an identity, evaluate a permission, persist data, or contact a provider.',
  ));
  const loading = handoverPostTeamPreviewNode(
    'div',
    'bp-phase-summary',
    'Checking the current parent record and Blueprint, exact layouts and fields, complete All_Orders relationship, direct eligible Deals and child Blueprints, and AMS schema and Blueprint targets…',
  );
  loading.setAttribute('role', 'status');
  loading.setAttribute('aria-live', 'polite');
  loading.setAttribute('aria-atomic', 'true');
  panel.appendChild(loading);
  container.appendChild(panel);

  handoverPostTeamPreviewReadEvidence(contactId, preview).then(reviewedEvidence => {
    if (!panel.isConnected) return;
    const context = reviewedEvidence.context;
    loading.remove();
    handoverPostTeamPreviewDefinitionList(panel, [
      ['Parent binding', 'Contacts · Standard · Second Installation Done → Final Handover · exact During widget'],
      ['All Orders', `${context.relationshipCounts.total} complete anonymous row${context.relationshipCounts.total === 1 ? '' : 's'} · ${context.relationshipCounts.eligible} eligible · ${context.relationshipCounts.blocked} blocked`],
      ['Direct evidence', `${context.relationshipCounts.eligible} eligible Deal record and child Blueprint pair${context.relationshipCounts.eligible === 1 ? '' : 's'} re-attested · concurrency limit 4`],
      ['Child requirements', 'Handover File checklist · Handover Certificate · MDR Done date · Internal QC integer · all required and disabled'],
      ['Observed After effect', 'First Service Date on execution day · disabled'],
      ['AMS evidence', `${context.ams.field_count} reviewed fields · two active reviewed Blueprints · zero active transition to Planned`],
      ['Unattested authority', 'User identity, Record Owner match, permissions, file transfer, server write validation, workflow effects, and transaction rollback'],
    ]);

    const generate = handoverPostTeamPreviewNode('button', 'btn-primary handover-post-team-preview-generate', 'Generate display-only plan');
    generate.type = 'button';
    const result = handoverPostTeamPreviewNode('section', 'handover-post-team-preview-result is-empty');
    result.setAttribute('aria-live', 'polite');
    result.setAttribute('aria-atomic', 'true');
    result.appendChild(handoverPostTeamPreviewNode('p', null, 'Generate only after every current GET-only evidence source has been read again and compared.'));
    generate.onclick = async () => {
      generate.disabled = true;
      generate.textContent = 'Rechecking every evidence source…';
      result.setAttribute('aria-busy', 'true');
      try {
        const freshEvidence = await handoverPostTeamPreviewReadEvidence(contactId, preview);
        const comparison = preview.compareEvidence({ fresh: freshEvidence, reviewed: reviewedEvidence });
        if (!comparison.match) throw new Error('Handover To Post Team evidence changed.');
        const plan = preview.buildPlan({ context: freshEvidence.context });
        handoverPostTeamPreviewRenderPlan(result, plan);
      } catch {
        result.className = 'handover-post-team-preview-result is-error';
        result.replaceChildren(handoverPostTeamPreviewNode(
          'p',
          null,
          'Fresh local evidence is incomplete, changed, or no longer satisfies the exact Final Handover contract. No plan was generated and nothing was changed.',
        ));
      } finally {
        result.removeAttribute('aria-busy');
        generate.disabled = false;
        generate.textContent = 'Generate display-only plan';
      }
    };
    panel.append(generate, result);
  }).catch(() => {
    if (!panel.isConnected) return;
    loading.className = 'handover-post-team-preview-error';
    loading.textContent = 'The exact parent record, Final Handover widget, layouts, fields, complete All_Orders relationship, direct eligible Deal and child Blueprint evidence, or AMS contract is unavailable. No plan was generated and nothing was changed.';
  });
}

let activeHandoverPostTeamPreviewClose = null;
let handoverPostTeamPreviewSequence = 0;
function openHandoverPostTeamPreview(mod, contactId, record, blueprint, transition, input, restoreFocus = document.activeElement) {
  if (!isHandoverPostTeamPreviewInput(mod, record, blueprint, transition, input)) {
    toast('Handover To Post Team preview is unavailable. No CRM, file, workflow, or Blueprint action was performed.');
    return;
  }
  if (activeJourneyDialogClose) activeJourneyDialogClose(false);
  if (activeEstimatePreviewClose) activeEstimatePreviewClose(false);
  if (activeAssignTechnicianPreviewClose) activeAssignTechnicianPreviewClose(false);
  if (activeDesignerFormPreviewClose) activeDesignerFormPreviewClose(false);
  if (activePaymentMilestonePreviewClose) activePaymentMilestonePreviewClose(false);
  if (activeReviseQuotePreviewClose) activeReviseQuotePreviewClose(false);
  if (activeReviseApproveAnyStagePreviewClose) activeReviseApproveAnyStagePreviewClose(false);
  if (activeClosureNewPreviewClose) activeClosureNewPreviewClose(false);
  if (activeDeployTeamReadinessPreviewClose) activeDeployTeamReadinessPreviewClose(false);
  if (activeHandoverPostTeamPreviewClose) activeHandoverPostTeamPreviewClose(false);
  if (activeBlueprintTransitionClose) activeBlueprintTransitionClose(false);
  const modal = $('#modal');
  const box = $('#modalBox');
  box.replaceChildren();
  handoverPostTeamPreviewSequence += 1;
  const titleId = `handover-post-team-preview-${handoverPostTeamPreviewSequence}-title`;
  const header = handoverPostTeamPreviewNode('div', 'mh handover-post-team-preview-modal-head');
  const headingWrap = handoverPostTeamPreviewNode('div', 'handover-post-team-preview-heading');
  headingWrap.append(handoverPostTeamPreviewNode('span', 'estimate-preview-badge', 'GET-only preview'));
  const heading = handoverPostTeamPreviewNode('h2', null, 'Handover To Post Team');
  heading.id = titleId;
  headingWrap.appendChild(heading);
  const close = handoverPostTeamPreviewNode('button', 'x', '✕');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close Handover To Post Team preview');
  const shell = $('#shell');
  const shellWasInert = shell?.hasAttribute('inert') === true;
  if (shell) shell.setAttribute('inert', '');
  let keyHandler = null;
  const shut = (returnFocus = true) => {
    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    if (activeHandoverPostTeamPreviewClose === shut) activeHandoverPostTeamPreviewClose = null;
    modal.classList.add('hidden');
    modal.removeAttribute('role');
    modal.removeAttribute('aria-modal');
    modal.removeAttribute('aria-labelledby');
    if (shell && !shellWasInert) shell.removeAttribute('inert');
    if (returnFocus && restoreFocus && document.contains(restoreFocus)) restoreFocus.focus();
  };
  activeHandoverPostTeamPreviewClose = shut;
  close.onclick = shut;
  header.append(headingWrap, close);
  const body = handoverPostTeamPreviewNode('div', 'mb handover-post-team-preview-modal-body');
  renderHandoverPostTeamPreview(body, contactId);
  const footer = handoverPostTeamPreviewNode('div', 'mf');
  const done = handoverPostTeamPreviewNode('button', null, 'Close preview');
  done.type = 'button';
  done.onclick = shut;
  footer.appendChild(done);
  box.append(header, body, footer);
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', titleId);
  modal.classList.remove('hidden');
  keyHandler = event => {
    if (event.key === 'Escape' && !modal.classList.contains('hidden')) shut();
    if (event.key === 'Tab' && !modal.classList.contains('hidden')) {
      const focusable = Array.from(box.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'))
        .filter(node => node.getClientRects().length > 0 && !node.closest('.hidden'));
      event.preventDefault();
      if (!focusable.length) return;
      const activeIndex = focusable.indexOf(document.activeElement);
      const nextIndex = activeIndex < 0
        ? (event.shiftKey ? focusable.length - 1 : 0)
        : (activeIndex + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
      focusable[nextIndex].focus();
    }
  };
  document.addEventListener('keydown', keyHandler);
  close.focus();
}
/* Handover To Post Team GET-only preview end */

function blueprintActionDetails(action) {
  const details = [];
  if (action.api_name) details.push(`${action.type === 'field_update' ? 'Field' : 'API name'}: ${action.api_name}`);
  if (action.value != null) details.push(`Value: ${action.value}`);
  if (action.value_type === 'execution_day') details.push(`Execution date${Number(action.day_offset || 0) ? ` ${Number(action.day_offset) > 0 ? '+' : ''}${action.day_offset} day(s)` : ''}`);
  if (action.due_from_field) details.push(`Due from: ${action.due_from_field}`);
  if (action.business_day_offset != null) details.push(`Business-day offset: ${action.business_day_offset}`);
  if (action.status) details.push(`Status: ${action.status}`);
  if (action.priority) details.push(`Priority: ${action.priority}`);
  if (action.definition_status) details.push(action.definition_status);
  return details.join(' · ');
}

function isAssignTechnicianPreviewInput(mod, blueprint, transition, input) {
  return mod === 'AMS_Complaints'
    && String(blueprint?.blueprint_id || '') === '1032257000023685467'
    && blueprint?.blueprint === 'AMS/Complaint Flow'
    && blueprint?.local === true
    && String(transition?.id || '') === '1032257000023685453'
    && transition?.name === 'Assign Technician'
    && transition?.executable === false
    && input?.kind === 'widget'
    && String(input?.widget_id || '') === '1032257000023774783'
    && (input?.name || input?.label) === 'Assign Technician Widget'
    && typeof window.AssignTechnicianPreview?.createContext === 'function'
    && typeof window.AssignTechnicianPreview?.buildVisitDraft === 'function';
}

function assignPreviewScalar(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value.actual_value ?? value.display_value ?? value.name ?? '';
  }
  return value ?? '';
}

function assignPreviewAddress(record) {
  const fields = [
    'Client_Address_Flat_House_No_Building_Apartment_Na',
    'Client_Address_Street_Address',
    'Client_Address_City',
    'Client_Address_State_Province',
    'Client_Address_Zip_Postal_Code',
    'Client_Address_Country_Region',
  ];
  const components = fields.map(field => String(assignPreviewScalar(record?.[field]) || '').trim()).filter(Boolean);
  if (components.length) return components.join(', ');
  return String(assignPreviewScalar(record?.Client_Address) || '').trim();
}

function assignPreviewPicklistValues(field, { preferDisplay = false } = {}) {
  const values = [];
  (field?.pick_list_values || []).forEach(option => {
    if (option?.type === 'unused') return;
    const value = String(preferDisplay
      ? (option?.display_value ?? option?.actual_value ?? '')
      : (option?.actual_value ?? option?.display_value ?? '')).trim();
    if (!value || value === '-None-' || values.includes(value)) return;
    values.push(value);
  });
  return values;
}

function assignPreviewAmsTeamOptionCount(field) {
  let count = 0;
  (field?.pick_list_values || []).forEach(option => {
    if (option?.type === 'unused') return;
    const value = String(option?.display_value ?? option?.actual_value ?? '').trim();
    if (/\(AMS\)\s*$/i.test(value)) count += 1;
  });
  return count;
}

function renderAssignTechnicianPreview(container, record, idPrefix) {
  const preview = window.AssignTechnicianPreview;
  const panel = el('section', 'assign-preview-panel');
  panel.setAttribute('aria-label', 'Assign Technician read-only preview');
  const header = el('div', 'assign-preview-header');
  header.append(el('span', 'estimate-preview-badge', 'Read-only preview'), el('h3', null, 'AMS Visit draft'));
  panel.appendChild(header);
  panel.appendChild(el('div', 'assign-preview-warning', 'This original local preview validates a sanitized Visit draft only. It cannot create a Visit, trigger a workflow, continue the Blueprint, or contact an external service.'));
  const loading = el('div', 'bp-phase-summary', 'Loading local Visit metadata…');
  panel.appendChild(loading);
  container.appendChild(panel);

  getFields('Visit_Module').then(fields => {
    if (!panel.isConnected) return;
    const purposeField = fields.find(field => field.api_name === 'Purpose' && field.data_type === 'picklist');
    const recordTypeField = fields.find(field => field.api_name === 'Record_Type' && field.data_type === 'picklist');
    const teamField = fields.find(field => field.api_name === 'Team_Member_Name' && field.data_type === 'multiselectpicklist');
    const purposeOptions = assignPreviewPicklistValues(purposeField);
    const recordTypeOptions = assignPreviewPicklistValues(recordTypeField, { preferDisplay: true });
    const sourceTeamOptionCount = assignPreviewAmsTeamOptionCount(teamField);
    let context;
    try {
      context = preview.createContext({
        recordType: String(assignPreviewScalar(record?.Record_Type) || '').trim(),
        recordTypeOptions,
        amsDate: String(assignPreviewScalar(record?.AMS_Date) || '').slice(0, 10),
        fullAddress: assignPreviewAddress(record),
        purposeOptions,
        teamOptionCount: sourceTeamOptionCount,
      });
    } catch (error) {
      loading.className = 'assign-preview-error';
      loading.textContent = 'The preview is unavailable because the required local record or Visit metadata is incomplete. No action was performed.';
      return;
    }

    loading.remove();
    const form = el('div', 'assign-preview-form');
    let fieldSequence = 0;
    const makeField = (labelText, control, hint = '') => {
      fieldSequence += 1;
      const field = el('div', 'assign-preview-field');
      const controlId = `${idPrefix}-field-${fieldSequence}`;
      const label = el('label');
      label.htmlFor = controlId;
      label.textContent = labelText;
      control.id = controlId;
      field.appendChild(label);
      field.appendChild(control);
      if (hint) {
        const hintNode = el('small', null, esc(hint));
        hintNode.id = `${controlId}-hint`;
        control.setAttribute('aria-describedby', hintNode.id);
        field.appendChild(hintNode);
      }
      return field;
    };

    const recordType = el('input');
    recordType.type = 'text';
    recordType.value = context.recordType;
    recordType.disabled = true;
    form.appendChild(makeField('Record type · local record', recordType));

    if (context.recordType === 'AMS') {
      const amsDate = el('input');
      amsDate.type = 'date';
      amsDate.value = context.amsDate;
      amsDate.disabled = true;
      form.appendChild(makeField('AMS date · required for AMS', amsDate, context.amsDate ? 'Read from the current local record.' : 'Missing from the current local record.'));
    }

    const purpose = el('select');
    purpose.required = true;
    purpose.appendChild(Object.assign(el('option', null, 'Select purpose'), { value: '' }));
    context.purposeOptions.forEach(value => purpose.appendChild(Object.assign(el('option', null, esc(value)), { value })));
    form.appendChild(makeField('Purpose of visit *', purpose));

    const team = el('select');
    team.multiple = true;
    team.required = true;
    team.size = Math.min(6, context.teamOptions.length);
    context.teamOptions.forEach(option => team.appendChild(Object.assign(el('option', null, option.label), { value: option.value })));
    form.appendChild(makeField('Team members *', team, 'Anonymized choices derived only from the count of locally configured AMS team options. Personnel identities are not displayed or copied.'));

    const visitDate = el('input');
    visitDate.type = 'date';
    visitDate.required = true;
    form.appendChild(makeField('Visit date *', visitDate));

    const fullAddress = el('textarea');
    fullAddress.rows = 3;
    fullAddress.maxLength = preview.constants.limits.address;
    fullAddress.required = true;
    fullAddress.value = context.fullAddress;
    form.appendChild(makeField('Full address *', fullAddress, 'Prefilled from the current local AMS/Complaint record when available.'));

    const generate = el('button', 'btn-primary assign-preview-generate', 'Generate sanitized draft');
    generate.type = 'button';
    const result = el('section', 'assign-preview-result is-empty');
    result.setAttribute('aria-live', 'polite');
    result.appendChild(el('p', null, 'Complete the required fields to generate a non-persisted Visit draft.'));
    const focusForCode = code => {
      if (String(code).startsWith('TEAM')) return team;
      if (String(code).startsWith('PURPOSE')) return purpose;
      if (String(code).startsWith('VISIT_DATE')) return visitDate;
      if (String(code).startsWith('ADDRESS')) return fullAddress;
      return null;
    };
    generate.onclick = () => {
      try {
        const draft = preview.buildVisitDraft({
          context,
          fullAddress: fullAddress.value,
          purpose: purpose.value,
          teamMembers: [...team.selectedOptions].map(option => option.value),
          visitDate: visitDate.value,
        });
        result.className = 'assign-preview-result';
        result.replaceChildren(el('h4', null, 'Sanitized Visit draft'));
        const grid = el('dl', 'assign-preview-draft');
        Object.entries(draft.fields).forEach(([label, value]) => {
          grid.append(el('dt', null, esc(label.replace(/_/g, ' '))), el('dd', null, esc(Array.isArray(value) ? value.join(', ') : value)));
        });
        result.appendChild(grid);
        const displayHeading = el('h4', null, 'Display-only context');
        const displayGrid = el('dl', 'assign-preview-draft assign-preview-display-only');
        Object.entries(draft.display_only).forEach(([label, value]) => {
          displayGrid.append(el('dt', null, esc(label.replace(/_/g, ' '))), el('dd', null, esc(value)));
        });
        result.append(displayHeading, displayGrid);
        result.appendChild(el('small', null, `Not persisted · Disabled: ${draft.blocked_actions.join(', ')}.`));
      } catch (error) {
        result.className = 'assign-preview-result is-error';
        result.replaceChildren(el('p', null, 'The draft could not be generated from these inputs. No CRM or Blueprint action was performed.'));
        focusForCode(error?.code)?.focus();
      }
    };
    form.append(generate, result);
    panel.appendChild(form);
  }).catch(() => {
    if (!panel.isConnected) return;
    loading.className = 'assign-preview-error';
    loading.textContent = 'Local Visit metadata is unavailable. No draft was generated and no action was performed.';
  });
}

let activeAssignTechnicianPreviewClose = null;
let assignTechnicianPreviewSequence = 0;
function openAssignTechnicianPreview(mod, rec, bp, transition, input, restoreFocus = document.activeElement) {
  if (!isAssignTechnicianPreviewInput(mod, bp, transition, input)) {
    toast('Assign Technician preview is unavailable. No CRM or Blueprint action was performed.');
    return;
  }
  if (activeJourneyDialogClose) activeJourneyDialogClose(false);
  if (activeEstimatePreviewClose) activeEstimatePreviewClose(false);
  if (activeAssignTechnicianPreviewClose) activeAssignTechnicianPreviewClose(false);
  if (activeDesignerFormPreviewClose) activeDesignerFormPreviewClose(false);
  if (activePaymentMilestonePreviewClose) activePaymentMilestonePreviewClose(false);
  if (activeReviseQuotePreviewClose) activeReviseQuotePreviewClose(false);
  if (activeReviseApproveAnyStagePreviewClose) activeReviseApproveAnyStagePreviewClose(false);
  if (activeClosureNewPreviewClose) activeClosureNewPreviewClose(false);
  const modal = $('#modal'), box = $('#modalBox');
  box.innerHTML = '';
  assignTechnicianPreviewSequence += 1;
  const idPrefix = `assign-technician-preview-${assignTechnicianPreviewSequence}`;
  const titleId = `${idPrefix}-title`;
  const header = el('div', 'mh assign-preview-modal-head');
  const headingWrap = el('div', 'assign-preview-heading');
  headingWrap.append(el('span', 'estimate-preview-badge', 'Read-only preview'));
  const heading = el('h2', null, 'Assign Technician');
  heading.id = titleId;
  headingWrap.appendChild(heading);
  const close = el('button', 'x', '✕');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close Assign Technician preview');
  let keyHandler = null;
  const shut = (returnFocus = true) => {
    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    if (activeAssignTechnicianPreviewClose === shut) activeAssignTechnicianPreviewClose = null;
    modal.classList.add('hidden');
    modal.removeAttribute('role');
    modal.removeAttribute('aria-modal');
    modal.removeAttribute('aria-labelledby');
    if (returnFocus && restoreFocus && document.contains(restoreFocus)) restoreFocus.focus();
  };
  activeAssignTechnicianPreviewClose = shut;
  close.onclick = shut;
  header.append(headingWrap, close);
  const body = el('div', 'mb assign-preview-modal-body');
  renderAssignTechnicianPreview(body, rec, idPrefix);
  const footer = el('div', 'mf');
  const done = el('button', null, 'Close preview');
  done.type = 'button';
  done.onclick = shut;
  footer.appendChild(done);
  box.append(header, body, footer);
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', titleId);
  modal.classList.remove('hidden');
  keyHandler = event => {
    if (event.key === 'Escape' && !modal.classList.contains('hidden')) shut();
  };
  document.addEventListener('keydown', keyHandler);
  close.focus();
}

let activeBlueprintTransitionClose = null;
let blueprintTransitionSequence = 0;
function openBlueprintTransition(mod, id, rec, bp, transition) {
  if (activeJourneyDialogClose) activeJourneyDialogClose(false);
  if (activeEstimatePreviewClose) activeEstimatePreviewClose(false);
  if (activeAssignTechnicianPreviewClose) activeAssignTechnicianPreviewClose(false);
  if (activeDesignerFormPreviewClose) activeDesignerFormPreviewClose(false);
  if (activePaymentMilestonePreviewClose) activePaymentMilestonePreviewClose(false);
  if (activeReviseQuotePreviewClose) activeReviseQuotePreviewClose(false);
  if (activeReviseApproveAnyStagePreviewClose) activeReviseApproveAnyStagePreviewClose(false);
  if (activeClosureNewPreviewClose) activeClosureNewPreviewClose(false);
  if (activeBlueprintTransitionClose) activeBlueprintTransitionClose(false);
  const inspectionOnly = !transition.runtime_executable;
  const restoreFocus = document.activeElement;
  const modal = $('#modal'), box = $('#modalBox'), fm = fieldMap(mod);
  box.innerHTML = '';
  blueprintTransitionSequence += 1;
  const titleId = `blueprint-transition-title-${blueprintTransitionSequence}`;
  const mh = el('div', 'mh');
  const heading = el('h2', 'blueprint-modal-title', `${esc(bp.blueprint)} · ${esc(transition.name)}`);
  heading.id = titleId;
  const x = el('button', 'x', '✕');
  x.type = 'button';
  x.setAttribute('aria-label', `Close ${transition.name} Blueprint transition`);
  let keyHandler = null;
  const shut = (returnFocus = true) => {
    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    if (activeBlueprintTransitionClose === shut) activeBlueprintTransitionClose = null;
    modal.classList.add('hidden');
    modal.removeAttribute('role');
    modal.removeAttribute('aria-modal');
    modal.removeAttribute('aria-labelledby');
    if (returnFocus && restoreFocus && document.contains(restoreFocus)) restoreFocus.focus();
  };
  activeBlueprintTransitionClose = shut;
  x.onclick = shut;
  mh.append(heading, x);
  const mb = el('div', 'mb blueprint-form');
  mb.appendChild(el('div', 'bp-destination', `Current state: <b>${esc(bp.current ?? '—')}</b><span>→</span>Next state: <b>${esc(transition.next_value ?? '—')}</b>`));
  if (inspectionOnly) {
    const inspectionTitle = transition.policy_eligible ? 'Policy eligible · atomic execution unavailable' : 'Policy blocked · inspection only';
    mb.appendChild(el('div', 'bp-inspection-banner', `<b>${esc(inspectionTitle)}</b><span>${esc(transition.block_reason || 'This transition cannot be executed safely in the local replica yet.')}</span>`));
  }

  mb.appendChild(el('div', 'formsec', 'Before'));
  const owners = transition.before?.owners || [];
  mb.appendChild(el('div', 'bp-phase-summary', owners.length ? `Eligible owners: ${esc(owners.join(', '))}` : 'Eligible-owner definition is not available.'));
  if (transition.before?.owner_status) mb.appendChild(el('div', 'bp-phase-summary', `Owner definition: ${esc(transition.before.owner_status)}`));
  if (transition.before?.criteria?.length) mb.appendChild(el('div', 'bp-phase-summary', `Criteria: ${esc(JSON.stringify(transition.before.criteria))}`));

  mb.appendChild(el('div', 'formsec', 'During · transition inputs'));
  const grid = el('div', 'formgrid');
  const controls = [];
  (transition.during_inputs || []).forEach((input, inputIndex) => {
    if (input.kind === 'widget') {
      const wrapper = el('div', 'bp-phase-summary bp-widget-row', `<b>Widget</b><span>${esc(input.name || input.label || 'Source widget')}</span>${input.definition_status ? `<small>${esc(input.definition_status)}</small>` : ''}`);
      grid.appendChild(wrapper);
      return;
    }
    const field = input.kind === 'field' ? fm[input.api_name] : null;
    const wrapper = el('div', 'ffield');
    const controlId = `blueprint-${String(transition.id || 'transition').replace(/[^A-Za-z0-9_-]/g, '-')}-${inputIndex}`;
    const descriptionId = `${controlId}-description`;
    const label = el('label', null, `${esc(input.label || field?.field_label || input.api_name)}${input.required ? ' <span class="req">*</span>' : ' <span class="optional">Optional</span>'}`);
    label.htmlFor = controlId;
    wrapper.appendChild(label);
    const current = input.kind === 'field' ? rec[input.api_name] : '';
    const control = transitionInputElement(input, field, current);
    control.id = controlId;
    control.setAttribute('aria-describedby', descriptionId);
    if (inspectionOnly) control.disabled = true;
    controls.push({ input, field, control });
    const description = el('small', 'bp-control-hint', input.required ? 'Required Blueprint transition input.' : 'Optional Blueprint transition input.');
    description.id = descriptionId;
    wrapper.append(control, description); grid.appendChild(wrapper);
  });
  if (!(transition.during_inputs || []).length) grid.appendChild(el('div', 'bp-phase-summary', 'No During-phase inputs are configured.'));
  mb.appendChild(grid);

  mb.appendChild(el('div', 'formsec', 'After'));
  const actions = transition.after_actions || [];
  if (!actions.length) mb.appendChild(el('div', 'bp-phase-summary', 'No After actions are configured for this transition.'));
  actions.forEach(action => {
    const detail = blueprintActionDetails(action);
    mb.appendChild(el('div', 'bp-action-row', `<b>${esc(action.type.replace(/_/g, ' '))}</b><span>${esc(action.name || 'Configured action')}${detail ? `<small>${esc(detail)}</small>` : ''}</span>${action.external ? '<em>External</em>' : ''}`));
  });

  const mf = el('div', 'mf');
  const cancel = el('button', null, inspectionOnly ? 'Close' : 'Cancel'); cancel.onclick = shut;
  const proceed = el('button', 'btn-primary', `Complete “${esc(transition.name)}”`);
  proceed.onclick = async () => {
    const data = {}; let notes = '';
    for (const { input, control } of controls) {
      let value = control.value;
      if (input.required && !String(value || '').trim()) { control.focus(); toast(`${input.label} is mandatory`); return; }
      if (!String(value || '').trim()) continue;
      if (['integer','bigint'].includes(control.dataset.dt)) {
        const number = Number(value);
        if (!Number.isSafeInteger(number)) {
          control.focus();
          toast(`${input.label || input.api_name} must be a whole number within the supported range`);
          return;
        }
        value = number;
      }
      if (['double','currency','percent'].includes(control.dataset.dt)) {
        const number = Number(value);
        if (!Number.isFinite(number)) {
          control.focus();
          toast(`${input.label || input.api_name} must be a valid number`);
          return;
        }
        value = number;
      }
      if (control.dataset.dt === 'datetime') value = new Date(value).toISOString().replace(/\.\d{3}Z$/, '+00:00');
      if (input.kind === 'associated_item' && input.api_name === 'Notes') notes = value;
      else data[input.api_name] = value;
    }
    proceed.disabled = true;
    try {
      await api(`/api/blueprint/${mod}/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transition_id: transition.id, data, associated_items: { Notes: { content: notes } } }) });
      shut(false); toast(`Blueprint transition “${transition.name}” completed ✓`); openRecord(mod, id);
    } catch (error) { proceed.disabled = false; toast('Transition failed: ' + error.message); }
  };
  mf.append(cancel);
  if (!inspectionOnly) mf.append(proceed);
  box.append(mh, mb, mf);
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', titleId);
  modal.classList.remove('hidden');
  keyHandler = event => {
    if (event.key === 'Escape' && !modal.classList.contains('hidden')) shut();
  };
  document.addEventListener('keydown', keyHandler);
  x.focus();
}

function displayLayoutContext(layouts, record) {
  const active = (Array.isArray(layouts) ? layouts : []).filter(layout =>
    layout?.id && layout.visible !== false && String(layout.status || 'active').toLowerCase() !== 'inactive');
  const storedId = record?.Layout?.id || record?.$layout_id?.id || null;
  if (storedId) {
    const layout = active.find(item => String(item.id) === String(storedId)) || null;
    return { layout, exact: Boolean(layout), reason: layout ? null : 'unknown_layout', source: 'record', candidates: active };
  }
  if (active.length === 1) return { layout: active[0], exact: true, reason: null, source: 'only_active_layout', candidates: active };
  return { layout: null, exact: false, reason: active.length ? 'ambiguous_layout' : 'layout_metadata_unavailable', source: null, candidates: active };
}

function summaryFieldNames(mod, rec, fm) {
  const configured = Object.values(fm)
    .filter(field => Number.isFinite(Number(field.quick_sequence_number)) && Number(field.quick_sequence_number) > 0)
    .sort((left, right) => Number(left.quick_sequence_number) - Number(right.quick_sequence_number))
    .map(field => field.api_name);
  if (configured.length) return configured.filter(name => rec[name] !== null && rec[name] !== undefined && rec[name] !== '');
  return Object.keys(rec).filter(name => fm[name] && rec[name] !== null && rec[name] !== undefined && rec[name] !== '').slice(0, 5);
}

async function openRecord(mod, id) {
  const nav = ++state.nav;
  setActiveTab(mod);
  const c = $('#content');
  const rkey = mod + '|' + id;
  let painted = false;
  const build = (rec, authoritativeResolution = null) => {
    if (nav !== state.nav) return;
    const layouts = state.layouts[mod] || [];
    const fm = fieldMap(mod);
    const localResolution = displayLayoutContext(layouts, rec);
    const resolvedId = authoritativeResolution?.exact ? authoritativeResolution.layout_id : localResolution.layout?.id;
    const layout = resolvedId ? layouts.find(item => String(item.id) === String(resolvedId)) || null : null;
    const layoutExact = Boolean(layout) && (authoritativeResolution ? authoritativeResolution.exact === true : localResolution.exact === true);
    const layoutReason = authoritativeResolution?.reason || localResolution.reason;
    const nf = nameField(mod);
    const title = fmtVal(rec[nf]) !== '—' ? fmtVal(rec[nf]) : (rec.Full_Name || rec.Name || id);

    c.innerHTML = '';
    const wrap = el('div', 'detailwrap');
    if (state.moduleOrigins?.[mod]?.export_date) {
      const notice = el('div', 'view-fallback-notice');
      notice.textContent = `Saved snapshots include data from ${state.moduleOrigins[mod].export_date}. No fresh Zoho synchronization has been performed.`;
      wrap.appendChild(notice);
    }

    // header
    const head = el('div', 'dethead');
    head.appendChild(el('div', 'avatar', esc(String(title).slice(0, 1).toUpperCase())));
    const tt = el('div');
    tt.appendChild(el('div', 'nm', esc(title)));
    tt.appendChild(el('div', 'sub', esc(state.moduleByApi[mod]?.singular_label || mod) + ' · Owner: ' + esc(fmtVal(rec.Owner)) + (layoutExact ? ' · Layout: ' + esc(layout.name || layout.display_label || layout.id) : ' · Layout unresolved')));
    head.appendChild(tt);
    head.appendChild(el('div', 'grow'));
    const bEdit = el('button', null, '✎ Edit'); bEdit.onclick = () => openForm(mod, rec);
    if (state.snapshotOnly) { bEdit.disabled = true; bEdit.title = 'Editing is paused in snapshot-only mode.'; }
    const bZoho = el('button', null, 'Open in Zoho ↗');
    bZoho.onclick = () => window.open(`https://crm.zoho.in/crm/org60046349006/tab/${mod === 'Events' ? 'Events' : mod}/${id}`, '_blank');
    if (String(id).startsWith('local-')) { bZoho.disabled = true; bZoho.title = 'This record exists only in the local replica.'; }
    const bBack = el('button', null, '← Back'); bBack.onclick = () => history.back();
    head.append(bBack, bEdit, bZoho);
    wrap.appendChild(head);
    if (!layoutExact) {
      const reason = layoutReason === 'ambiguous_layout'
        ? 'This record does not identify one exact layout among the active Zoho layouts.'
        : layoutReason === 'unknown_layout'
          ? 'The layout stored on this record is not present in the captured active-layout metadata.'
          : 'Exact Zoho layout metadata is unavailable for this record.';
      wrap.appendChild(el('div', 'formcallout warning record-layout-warning', `<b>Details are fail-closed.</b> ${esc(reason)} No first-layout fallback is used.`));
      bEdit.disabled = true;
      bEdit.title = 'Editing requires one exact captured Zoho layout.';
    }
    getCustomButtons(mod).then(buttons => {
      if (nav !== state.nav || !head.isConnected) return;
      buttons.filter(button => button.position === 'view').forEach(button => {
        const estimatePreviewEnabled = isEstimatePreviewButton(button, mod);
        const reviseApprovePreviewEnabled = isReviseApproveAnyStagePreviewButton(button, mod, rec, layoutExact, resolvedId);
        const deployTeamPreviewEnabled = isDeployTeamReadinessPreviewButton(button, mod, rec, layoutExact, resolvedId);
        const previewEnabled = estimatePreviewEnabled || reviseApprovePreviewEnabled || deployTeamPreviewEnabled;
        const previewLabel = estimatePreviewEnabled
          ? 'Estimate · Preview'
          : reviseApprovePreviewEnabled
            ? 'Revise-Approve Quote · Preview'
            : deployTeamPreviewEnabled
              ? 'Deploy Team · Readiness'
              : button.name;
        const previewClass = reviseApprovePreviewEnabled
          ? ' revise-approve-preview-action'
          : deployTeamPreviewEnabled
            ? ' deploy-team-preview-action'
            : '';
        const sourceButton = el('button', `source-action${previewEnabled ? ' preview-action' : ''}${previewClass}`, esc(previewLabel));
        sourceButton.type = 'button';
        sourceButton.disabled = !previewEnabled;
        sourceButton.title = estimatePreviewEnabled
          ? 'Open the calculation-only Estimate preview'
          : reviseApprovePreviewEnabled
            ? 'Open the exact registered-layout, GET-only quote-decision preview. Local profile eligibility is not asserted.'
            : deployTeamPreviewEnabled
              ? 'Open the exact Standard-layout, GET-only anonymous installation-team readiness preview. Local profile eligibility is not asserted.'
            : button.block_reason;
        if (estimatePreviewEnabled) sourceButton.onclick = () => openEstimateWidgetPreview(sourceButton);
        if (reviseApprovePreviewEnabled) {
          sourceButton.setAttribute('aria-label', 'Open Revise-Approve Quote read-only preview');
          sourceButton.onclick = () => openReviseApproveAnyStagePreview(mod, id, rec, button, layoutExact, resolvedId, sourceButton);
        }
        if (deployTeamPreviewEnabled) {
          sourceButton.setAttribute('aria-label', 'Open Deploy Team GET-only readiness preview');
          sourceButton.onclick = () => openDeployTeamReadinessPreview(mod, id, rec, button, layoutExact, resolvedId, sourceButton);
        }
        head.insertBefore(sourceButton, bZoho);
      });
    }).catch(() => {});

    // stage bar — single scrollable line with progress summary
    const sf = stageField(mod);
    if (sf && rec[sf.api_name] != null) {
      const blueprintManaged = state.blueprintByModule?.[mod]?.state_field === sf.api_name;
      const stages = (sf.pick_list_values || []).filter(p => p.type !== 'unused' && p.display_value !== '-None-').map(p => p.display_value);
      let idx = stages.indexOf(rec[sf.api_name]);
      const done = idx >= 0 ? idx : 0;
      const remaining = idx >= 0 ? stages.length - idx - 1 : stages.length;
      wrap.appendChild(el('div', 'stageprog', blueprintManaged
        ? `Blueprint state: <b>${esc(rec[sf.api_name])}</b> · state changes require an eligible transition`
        : `Current stage: <b>${esc(rec[sf.api_name])}</b> · <span class="sp-done">${done} completed</span> · <span class="sp-rem">${remaining} remaining</span> of ${stages.length + (idx === -1 ? 1 : 0)} stages`));
      const swrap = el('div', 'stagewrap');
      const bar = el('div', 'stagebar');
      const larr = el('button', 'sarrow', '‹');
      const rarr = el('button', 'sarrow', '›');
      larr.onclick = () => bar.scrollBy({ left: -360, behavior: 'smooth' });
      rarr.onclick = () => bar.scrollBy({ left: 360, behavior: 'smooth' });
      stages.forEach((s, i) => {
        const chip = el('div', 'stagechip' + (!blueprintManaged && i < idx ? ' done' : i === idx ? ' current' : ''), esc(s));
        if (i !== idx && !blueprintManaged) {
          chip.classList.add('clickable');
          chip.title = 'Click to move this record to: ' + s;
          chip.onclick = async () => {
            if (!confirm(`Change stage to "${s}"?`)) return;
            const pv = (sf.pick_list_values || []).find(p => p.display_value === s);
            try {
              await api(`/api/record/${mod}/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [sf.api_name]: pv?.actual_value ?? s }) });
              toast(`Stage changed to "${s}" ✓`);
              openRecord(mod, id);
            } catch (e) { toast('Failed: ' + e.message); }
          };
        }
        bar.appendChild(chip);
      });
      if (idx === -1) bar.appendChild(el('div', 'stagechip current', esc(rec[sf.api_name])));
      swrap.append(larr, bar, rarr);
      wrap.appendChild(swrap);
      requestAnimationFrame(() => {
        const cur = bar.querySelector('.stagechip.current');
        if (cur) bar.scrollLeft = Math.max(0, cur.offsetLeft - bar.clientWidth / 2 + cur.offsetWidth / 2);
      });
      // Source-defined local Blueprint transitions.
      if (blueprintManaged) {
        const bpRow = el('div', 'bprow hidden');
        wrap.insertBefore(bpRow, swrap.nextSibling);
        api(`/api/blueprint/${mod}/${id}`).then(bp => {
          const manual = bp.transitions || [];
          const automatic = bp.automatic_transitions || [];
          if (nav !== state.nav || (!manual.length && !automatic.length)) return;
          bpRow.classList.remove('hidden');
          bpRow.appendChild(el('span', 'bplabel', `${esc(bp.blueprint)} transitions:`));
          manual.forEach(t => {
            const btn = el('button', 'bpbtn', esc(t.name));
            btn.classList.toggle('blocked', !t.runtime_executable);
            btn.setAttribute('aria-label', t.runtime_executable
              ? `${t.name}: atomic Blueprint transition ready`
              : t.policy_eligible
                ? `${t.name}: inspect policy-eligible Blueprint transition; atomic runtime unavailable`
                : `${t.name}: inspect policy-blocked Blueprint transition requirements`);
            btn.title = t.runtime_executable ? `Move to ${t.next_value} with Zoho-matched mandatory inputs in one atomic transaction` : (t.block_reason || 'Transition phases are not fully specified.');
            btn.onclick = () => openBlueprintTransition(mod, id, rec, bp, t);
            bpRow.appendChild(btn);
            const assignInput = (t.during_inputs || []).find(input => isAssignTechnicianPreviewInput(mod, bp, t, input));
            if (assignInput) {
              const previewButton = el('button', 'source-action preview-action assign-preview-action', 'Assign Technician · Preview');
              previewButton.type = 'button';
              previewButton.setAttribute('aria-label', 'Open Assign Technician read-only preview');
              previewButton.title = 'Create a sanitized, non-persisted Visit draft from this local record';
              previewButton.onclick = () => openAssignTechnicianPreview(mod, rec, bp, t, assignInput, previewButton);
              bpRow.appendChild(previewButton);
            }
            const designerInput = (t.during_inputs || []).find(input => isDesignerFormPreviewInput(mod, rec, bp, t, input));
            if (designerInput) {
              const designerButton = el('button', 'source-action preview-action designer-preview-action', 'Designer Form · Preview');
              designerButton.type = 'button';
              designerButton.setAttribute('aria-label', 'Open Designer Form read-only preview');
              designerButton.title = 'Create anonymized, non-persisted design drafts from exact local All_Orders data';
              designerButton.onclick = () => openDesignerFormPreview(mod, id, rec, bp, t, designerInput, designerButton);
              bpRow.appendChild(designerButton);
            }
            const paymentInput = (t.during_inputs || []).find(input => isPaymentMilestonePreviewInput(mod, rec, bp, t, input));
            if (paymentInput) {
              const paymentButton = el('button', 'source-action preview-action payment-preview-action', 'Payment Milestone · Preview');
              paymentButton.type = 'button';
              paymentButton.setAttribute('aria-label', 'Open Payment Milestone read-only preview');
              paymentButton.title = 'Calculate an immutable display-only schedule from exact local payment evidence';
              paymentButton.onclick = () => openPaymentMilestonePreview(mod, id, rec, bp, t, paymentInput, paymentButton);
              bpRow.appendChild(paymentButton);
            }
            const reviseInput = (t.during_inputs || []).find(input => isReviseQuotePreviewInput(mod, rec, bp, t, input));
            if (reviseInput) {
              const reviseButton = el('button', 'source-action preview-action revise-preview-action', 'Revise Quote · Preview');
              reviseButton.type = 'button';
              reviseButton.setAttribute('aria-label', 'Open Revise Quote read-only preview');
              reviseButton.title = 'Generate anonymous, immutable quote-decision plans from exact current local evidence';
              reviseButton.onclick = () => openReviseQuotePreview(mod, id, rec, bp, t, reviseInput, reviseButton);
              bpRow.appendChild(reviseButton);
            }
            const closureInput = (t.during_inputs || []).find(input => isClosureNewPreviewInput(mod, rec, bp, t, input));
            if (closureInput) {
              const closureButton = el('button', 'source-action preview-action closure-new-preview-action', 'Closure New · Preview');
              closureButton.type = 'button';
              closureButton.setAttribute('aria-label', 'Open Closure New read-only preview');
              closureButton.title = 'Generate record-ID-free, immutable closure and milestone plans from current runtime-attested local evidence';
              closureButton.onclick = () => openClosureNewPreview(mod, id, rec, bp, t, closureInput, closureButton);
              bpRow.appendChild(closureButton);
            }
            const handoverInput = (t.during_inputs || []).find(input => isHandoverPostTeamPreviewInput(mod, rec, bp, t, input));
            if (handoverInput) {
              const handoverButton = el('button', 'source-action preview-action handover-post-team-preview-action', 'Handover To Post Team · Preview');
              handoverButton.type = 'button';
              handoverButton.setAttribute('aria-label', 'Open Handover To Post Team GET-only preview');
              handoverButton.title = 'Generate an anonymous, immutable Final Handover plan from complete current local evidence';
              handoverButton.onclick = () => openHandoverPostTeamPreview(mod, id, rec, bp, t, handoverInput, handoverButton);
              bpRow.appendChild(handoverButton);
            }
          });
          automatic.forEach(t => {
            const timing = t.trigger_after ? `${t.trigger_after.value} ${t.trigger_after.unit}` : 'source-defined timing';
            const chip = el('span', 'bpauto', `Automatic: ${esc(t.name)} · ${esc(timing)}`);
            chip.title = t.block_reason || 'Automatic transition scheduling is not implemented locally.';
            bpRow.appendChild(chip);
          });
          const policyEligible = manual.filter(t => t.policy_eligible).length;
          const atomicReady = manual.filter(t => t.runtime_executable).length;
          bpRow.appendChild(el('span', 'hint', `${policyEligible} policy eligible · ${atomicReady} atomically runtime-ready · ${manual.length - policyEligible} policy blocked${automatic.length ? ` · ${automatic.length} automatic pending scheduler` : ''}`));
        }).catch(() => {});
      }
    }

    // body: left summary + right sections/tabs
    const body = el('div', 'detbody');

    const left = el('div', 'panel');
    left.appendChild(el('h2', null, 'Summary'));
    const summaryFields = summaryFieldNames(mod, rec, fm);
    if (!summaryFields.length) left.appendChild(el('div', 'loading', 'No Zoho business-card fields are populated on this record.'));
    summaryFields.forEach(f => left.appendChild(fieldRowEl(f, rec, fm, mod)));
    body.appendChild(left);

    const right = el('div', 'panel');
    const tabs = el('div', 'dettabs');
    const tabC = el('div', 'dettabcontent');
    const tabDefs = [
      ['Details', () => renderSections(tabC, layoutExact ? layout : null, rec, fm, mod)],
      ['Notes', () => renderNotes(tabC, mod, id)],
      ['Files', () => renderFiles(tabC, mod, id)],
      ['Timeline', () => renderTimeline(tabC, mod, id, rec, fm)],
      ['Related', () => renderRelated(tabC, mod, id)],
    ];
    tabDefs.forEach(([name, fn], i) => {
      const t = el('div', i === 0 ? 'on' : '', esc(name));
      t.onclick = () => { tabs.querySelectorAll('div').forEach(x => x.classList.remove('on')); t.classList.add('on'); tabC.innerHTML = ''; fn(); };
      tabs.appendChild(t);
    });
    right.append(tabs, tabC);
    renderSections(tabC, layoutExact ? layout : null, rec, fm, mod);
    body.appendChild(right);
    wrap.appendChild(body);
    c.appendChild(wrap);
  };

  const cached = swr.record.get(rkey);
  if (cached && (state.fields[mod] || []).length && (state.layouts[mod] || []).length) {
    try { build(cached); painted = true; } catch (e) {}
  }
  if (!painted) c.innerHTML = '<div class="loading">Loading record…</div>';
  try {
    const [recResp] = await Promise.all([api(`/api/record/${mod}/${id}`), getFields(mod), getLayouts(mod)]);
    if (nav !== state.nav) return;
    const rec = (recResp.data || [])[0];
    if (!rec) { if (!painted) c.innerHTML = '<div class="loading">Record not found</div>'; return; }
    swr.record.set(rkey, rec);
    if (!painted || JSON.stringify(rec) !== JSON.stringify(cached) || recResp.layout_resolution) build(rec, recResp.layout_resolution);
  } catch (e) {
    if (nav !== state.nav || painted) return;
    c.innerHTML = `<div class="loading">Could not load record: ${esc(e.message)}</div>`;
  }
}

function fieldRowEl(fname, rec, fm, mod) {
  const f = fm[fname];
  const row = el('div', 'fieldrow');
  row.appendChild(el('div', 'k', esc(f?.field_label || fname)));
  const recordingField = isCallRecordingField(mod, fname);
  const v = el('div', recordingField ? 'v call-recording-value' : 'v');
  if (recordingField) v.appendChild(callRecordingControl(rec[fname]));
  else v.innerHTML = esc(fmtVal(rec[fname], f));
  const lid = lookupId(rec[fname]);
  if (!recordingField && lid && f?.data_type === 'lookup' && f.lookup?.module?.api_name) {
    v.classList.add('link');
    v.onclick = () => location.hash = `#/record/${f.lookup.module.api_name}/${lid}`;
  }
  if (!recordingField && f?.data_type === 'email' && rec[fname]) { v.classList.add('link'); v.onclick = () => location.href = 'mailto:' + rec[fname]; }
  row.appendChild(v);
  return row;
}

function renderSections(tabC, layout, rec, fm, mod) {
  tabC.innerHTML = '';
  const sections = layout?.sections || [];
  if (!sections.length) {
    tabC.appendChild(el('div', 'formcallout warning', 'Exact layout sections are unavailable. Record fields are not assigned to guessed sections.'));
    return;
  }
  sections.forEach(sec => {
    const fieldsInSec = (sec.fields || []).filter(f => f.view_type?.view !== false);
    if (!fieldsInSec.length) return;
    tabC.appendChild(el('h2', null, esc(sec.display_label)));
    fieldsInSec.forEach(f => {
      if (['fileupload','imageupload','profileimage'].includes(f.data_type)) return;
      if (f.data_type === 'subform') {
        const rows = rec[f.api_name];
        const label = f.field_label || fm[f.api_name]?.field_label || f.api_name;
        tabC.appendChild(el('div', 'subform-label', esc(label)));
        const childOrigin = state.moduleOrigins?.[f.associated_module?.module];
        if (childOrigin?.export_date) tabC.appendChild(el('div', 'view-fallback-notice', `Saved subform export: ${esc(childOrigin.export_date)}. Export row order is preserved; original CRM row order is unverified.`));
        if (Array.isArray(rows) && rows.length) {
          const sub = el('div', null);
          const keys = Object.keys(rows[0]).filter(k => !k.startsWith('$') && k !== 'id' && rows.some(r2 => r2[k] != null));
          let html = '<div style="overflow:auto"><table class="grid"><thead><tr>' + keys.map(k => `<th>${esc(k.replace(/_/g,' '))}</th>`).join('') + '</tr></thead><tbody>';
          rows.forEach(r2 => { html += '<tr>' + keys.map(k => `<td>${esc(fmtVal(r2[k]))}</td>`).join('') + '</tr>'; });
          html += '</tbody></table></div>';
          sub.innerHTML = html;
          tabC.appendChild(sub);
        } else tabC.appendChild(el('div', 'subform-empty', `No ${esc(label)} rows`));
        return;
      }
      tabC.appendChild(fieldRowEl(f.api_name, rec, fm, mod));
    });
  });
}

async function renderNotes(tabC, mod, id) {
  tabC.innerHTML = '<div class="loading">Loading notes…</div>';
  const add = el('div', 'noteadd');
  const ta = el('textarea'); ta.placeholder = 'Add a note…';
  const b = el('button', 'btn-primary', 'Add Note');
  b.onclick = async () => {
    if (!ta.value.trim()) return;
    b.disabled = true;
    try { await api(`/api/notes/${mod}/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ Note_Content: ta.value }) }); toast('Note added'); renderNotes(tabC, mod, id); }
    catch (e) { toast('Failed: ' + e.message); b.disabled = false; }
  };
  add.append(ta, b);
  try {
    const [d, completeness] = await Promise.all([api(`/api/notes/${mod}/${id}`), api('/api/meta/data_completeness')]);
    tabC.innerHTML = '';
    const noteCoverage = completeness.notes || {};
    tabC.appendChild(el('div', noteCoverage.status === 'Reconciled' ? 'formcallout' : 'formcallout warning', `Source active-ID coverage: ${esc(Number(noteCoverage.current_local_source_derived_id_count || 0).toLocaleString('en-IN'))}/${esc(Number(noteCoverage.source_active_id_count || 0).toLocaleString('en-IN'))} · ${esc(noteCoverage.status || 'Unknown')}.`));
    tabC.appendChild(add);
    const notes = d.data || [];
    if (!notes.length) tabC.appendChild(el('div', 'loading', 'No notes'));
    notes.forEach(n => {
      const nd = el('div', 'note');
      if (n.Note_Title) nd.appendChild(el('div', 'nt', esc(n.Note_Title)));
      nd.appendChild(el('div', 'nc', esc(n.Note_Content || '')));
      nd.appendChild(el('div', 'nm2', esc(fmtVal(n.Created_By)) + ' · ' + esc(fmtVal(n.Created_Time, { data_type: 'datetime' }))));
      tabC.appendChild(nd);
    });
    if (d.pagination) tabC.appendChild(el('div', 'related-page-note', `Page ${esc(d.pagination.page)} · showing ${esc(d.pagination.returned)} · limit ${esc(d.pagination.per_page)} per page${d.pagination.has_more ? ' · more records available' : ''}`));
  } catch (e) { tabC.innerHTML = ''; tabC.appendChild(add); tabC.appendChild(el('div', 'loading', 'Notes unavailable: ' + esc(e.message))); }
}

async function renderTimeline(tabC, mod, id, rec, fm) {
  tabC.innerHTML = '<div class="loading">Loading timeline…</div>';
  const fmtChangeVal = v => {
    if (v === null || v === undefined) return '(empty)';
    if (typeof v === 'object') return v.name || JSON.stringify(v).slice(0, 60);
    return String(v).slice(0, 80);
  };
  try {
    const d = await api(`/api/timeline/${mod}/${id}`);
    const events = d.events || [];
    tabC.innerHTML = '';
    const list = el('div', 'tl');
    events.forEach(ev => {
      const item = el('div', 'tl-item');
      const when = new Date(ev.at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      let icon = '✏️', body = '';
      if (ev.action === 'created') { icon = '✨'; body = '<b>Record created</b>'; }
      else if (ev.action === 'note_added') { icon = '📝'; body = '<b>Note added</b>' + (ev.changes?.preview ? ` — “${esc(ev.changes.preview)}”` : ''); }
      else if (ev.action === 'updated') {
        const parts = (Array.isArray(ev.changes) ? ev.changes : []).map(ch => {
          const label = fm[ch.field]?.field_label || ch.field;
          const stagey = ['Stage', 'Lead_Status', 'Status'].includes(ch.field);
          if (stagey) icon = '🔁';
          return `<b>${esc(label)}</b>: <span class="tl-from">${esc(fmtChangeVal(ch.from))}</span> → <span class="tl-to">${esc(fmtChangeVal(ch.to))}</span>`;
        });
        body = parts.join('<br>') || '<b>Updated</b>';
      } else { body = '<b>' + esc(ev.action) + '</b>'; }
      item.appendChild(el('div', 'tl-dot', icon));
      const c2 = el('div', 'tl-body');
      c2.appendChild(el('div', 'tl-text', body));
      c2.appendChild(el('div', 'tl-when', esc(when) + (ev.actor ? ' · ' + esc(ev.actor) : '')));
      item.appendChild(c2);
      list.appendChild(item);
    });
    // anchor events from the record itself
    if (!events.some(e => e.action === 'created')) {
      const item = el('div', 'tl-item');
      item.appendChild(el('div', 'tl-dot', '✨'));
      const c2 = el('div', 'tl-body');
      c2.appendChild(el('div', 'tl-text', '<b>Record created</b> <span class="tl-from">(from Zoho history)</span>' + (rec.Created_By ? ' by ' + esc(fmtVal(rec.Created_By)) : '')));
      c2.appendChild(el('div', 'tl-when', esc(fmtVal(rec.Created_Time, { data_type: 'datetime' }))));
      item.appendChild(c2);
      list.appendChild(item);
    }
    if (!events.length) {
      list.insertBefore(el('div', 'loading', 'No changes logged yet — edits made in this CRM will appear here from now on.'), list.firstChild);
    }
    tabC.appendChild(list);
  } catch (e) { tabC.innerHTML = `<div class="loading">${esc(e.message)}</div>`; }
}

async function renderFiles(tabC, mod, id) {
  tabC.innerHTML = '<div class="loading">Loading files…</div>';
  try {
    const [d, completeness] = await Promise.all([api(`/api/related/${mod}/${id}/Attachments`), api('/api/meta/data_completeness')]);
    const files = d.data || [];
    tabC.innerHTML = '';
    const attachmentCoverage = completeness.attachments || {};
    const currentLinked = Number(attachmentCoverage.current_local_linked_record_count ?? attachmentCoverage.local_linked_record_count ?? 0);
    const currentAbsent = Number(attachmentCoverage.current_absent_source_id_count ?? attachmentCoverage.absent_local_id_count ?? 0);
    tabC.appendChild(el('div', 'formcallout warning', `Local attachment metadata is incomplete: ${esc(currentLinked.toLocaleString('en-IN'))}/${esc(Number(attachmentCoverage.source_id_count || 0).toLocaleString('en-IN'))} source-derived IDs are linked locally; ${esc(currentAbsent.toLocaleString('en-IN'))} are currently absent. Attachment bodies were not downloaded and storage-bucket enumeration was not performed.`));
    if (!files.length) { tabC.appendChild(el('div', 'loading', 'No locally linked files on this record')); return; }
    files.forEach(f => {
      const row = el('div', 'note');
      const nm = el('div', 'nt');
      nm.appendChild(el('span', null, '📄 ' + esc(f.File_Name || 'file'))); row.appendChild(nm);
      row.appendChild(el('div', 'nm2', `${f.Size ? (Number(f.Size) / 1024).toFixed(0) + ' KB · ' : ''}${esc(fmtVal(f.Created_Time, { data_type: 'datetime' }))}`));
      tabC.appendChild(row);
    });
    if (d.pagination) tabC.appendChild(el('div', 'related-page-note', `Page ${esc(d.pagination.page)} · showing ${esc(d.pagination.returned)} · limit ${esc(d.pagination.per_page)} per page${d.pagination.has_more ? ' · more records available' : ''}`));
  } catch (e) { tabC.innerHTML = `<div class="loading">${esc(e.message)}</div>`; }
}

async function renderRelated(tabC, mod, id) {
  tabC.innerHTML = '<div class="loading">Loading related lists…</div>';
  try {
    const [allRelatedLists, completeness] = await Promise.all([getRelLists(mod), api('/api/meta/data_completeness')]);
    const rels = allRelatedLists.filter(r => r.api_name && !['Notes','Attachments','Emails','Activities','Activities_Upcoming','Cadences','Zoho_Meeting','SocialInteractions','Invited_Events'].includes(r.api_name) && r.type !== 'weblink');
    tabC.innerHTML = '';
    const coverage = completeness.related_lists || {};
    tabC.appendChild(el('div', 'formcallout warning', `Related-list structural coverage: ${esc(Number(coverage.local_definition_count || 0).toLocaleString('en-IN'))}/${esc(Number(coverage.source_definition_count || 0).toLocaleString('en-IN'))} definitions across ${esc(Number(coverage.local_parent_module_count || 0).toLocaleString('en-IN'))}/${esc(Number(coverage.source_parent_module_count || 0).toLocaleString('en-IN'))} parent modules. The generic Related UI has ${esc(Number(coverage.queryable_definition_count || 0).toLocaleString('en-IN'))} queryable and ${esc(Number(coverage.unresolved_definition_count || 0).toLocaleString('en-IN'))} structurally unresolved definitions; unresolved lists are marked unavailable, never empty.`));
    if (!rels.length) { tabC.appendChild(el('div', 'loading', 'No related lists')); return; }
    for (const r of rels) {
      const sec = el('div', 'relsec');
      const h = el('h4');
      const holder = el('div', 'hidden');
      let expanded = false;
      let loadedPage = 0;
      let resolution = '';
      const setHeading = () => {
        const status = resolution === 'unresolved' ? ' · unavailable' : (resolution === 'queryable' ? ' · queryable' : '');
        h.innerHTML = `${expanded ? '▾' : '▸'} ${esc(r.display_label)} <span>(${esc(r.module?.api_name || r.api_name)}${esc(status)})</span>`;
      };
      const loadPage = async page => {
        holder.innerHTML = '<div class="loading">Loading…</div>';
        try {
          const relMod = r.module?.api_name;
          const params = new URLSearchParams({ page: String(page), per_page: '100' });
          if (relMod) {
            const rf = await getFields(relMod);
            const cols = rf.filter(f => f.view_type?.view && !['subform','fileupload','imageupload','profileimage'].includes(f.data_type)).slice(0, 6).map(f => f.api_name);
            if (cols.length) params.set('fields', cols.join(','));
          }
          const d = await api(`/api/related/${mod}/${id}/${r.api_name}?${params}`);
          if (d.availability !== 'queryable') {
            resolution = 'unresolved';
            setHeading();
            holder.innerHTML = `<div class="formcallout warning related-unavailable"><b>Source definition/data unavailable.</b><br>${esc(d.message || 'The relationship cannot be resolved from the local metadata and data snapshot.')}${d.reason_code ? `<small>Reason: ${esc(d.reason_code)}</small>` : ''}</div>`;
            loadedPage = page;
            return;
          }
          resolution = 'queryable';
          setHeading();
          const rows = d.data || [];
          holder.innerHTML = '';
          if (d.snapshot_origin?.export_date) holder.appendChild(el('div', 'view-fallback-notice', `Historical export from ${esc(d.snapshot_origin.export_date)}. Related counts apply to that saved export.`));
          if (!rows.length) holder.appendChild(el('div', 'loading', 'Verified empty in the local replica for this queryable source-defined relationship.'));
          else {
            const keys = Object.keys(rows[0]).filter(k => !k.startsWith('$') && k !== 'id' && rows.some(x => x[k] != null && x[k] !== '')).slice(0, 8);
            let html = '<div style="overflow:auto"><table class="grid"><thead><tr>' + keys.map(k => `<th>${esc(k.replace(/_/g,' '))}</th>`).join('') + '</tr></thead><tbody>';
            rows.forEach(x => {
              html += `<tr data-id="${esc(x.id)}">` + keys.map((k, i) => `<td class="${i===0 && r.module?.api_name ? 'link' : ''}">${esc(fmtVal(x[k]))}</td>`).join('') + '</tr>';
            });
            html += '</tbody></table></div>';
            const tableWrap = el('div'); tableWrap.innerHTML = html; holder.appendChild(tableWrap);
            if (r.module?.api_name) holder.querySelectorAll('tr[data-id] td.link').forEach(td => {
              td.onclick = () => location.hash = `#/record/${r.module.api_name}/${td.parentElement.dataset.id}`;
            });
          }
          const pagination = d.pagination || { page, per_page: 100, returned: rows.length, has_more: false };
          const pager = el('div', 'related-pager');
          const previous = el('button', 'btn-small', 'Previous');
          previous.disabled = pagination.page <= 1;
          previous.onclick = event => { event.stopPropagation(); loadPage(pagination.page - 1); };
          pager.appendChild(previous);
          pager.appendChild(el('span', 'related-page-note', `Page ${esc(pagination.page)} · showing ${esc(pagination.returned)} · limit ${esc(pagination.per_page)} per page${pagination.has_more ? ' · more available' : ''}`));
          const next = el('button', 'btn-small', 'Next');
          next.disabled = !pagination.has_more;
          next.onclick = event => { event.stopPropagation(); loadPage(pagination.page + 1); };
          pager.appendChild(next);
          holder.appendChild(pager);
          loadedPage = page;
        } catch (e) { holder.innerHTML = `<div class="loading">${esc(e.message)}</div>`; }
      };
      setHeading();
      h.onclick = async () => {
        expanded = !expanded;
        holder.classList.toggle('hidden', !expanded);
        setHeading();
        if (expanded && !loadedPage) await loadPage(1);
      };
      sec.append(h, holder);
      tabC.appendChild(sec);
    }
  } catch (e) { tabC.innerHTML = `<div class="loading">${esc(e.message)}</div>`; }
}

/* ---------- create / edit form ---------- */
const EDITABLE = f => !f.read_only && f.view_type?.edit !== false &&
  !['formula','autonumber','subform','rollup_summary','fileupload','imageupload','profileimage','ownerlookup','consent_lookup','multiselectlookup','multiuserlookup'].includes(f.data_type) &&
  !['Created_Time','Modified_Time','Created_By','Modified_By','Owner','Layout','Tag','Record_Image'].includes(f.api_name);

function recordFormValueForPayload(value, dataType) {
  if (dataType === 'boolean') return value === 'true';
  // Preserve exact integer text for authoritative server validation and bigint precision.
  if (['integer','bigint'].includes(dataType)) return value;
  if (['double','currency','percent'].includes(dataType)) return parseFloat(value);
  if (dataType === 'datetime') return new Date(value).toISOString().replace(/\.\d{3}Z$/, '+00:00');
  return value;
}

async function openForm(mod, rec, selectedLayoutId = null, draftPrefill = null) {
  const [fields, layouts] = await Promise.all([getFields(mod), getLayouts(mod)]);
  const fm = fieldMap(mod);
  const storedLayoutId = rec?.Layout?.id || rec?.$layout_id?.id || null;
  const exactLayoutId = storedLayoutId || selectedLayoutId || (layouts.length === 1 ? layouts[0].id : null);
  const layout = layouts.find(item => String(item.id) === String(exactLayoutId)) || null;
  const renderLayout = layout;
  const layoutExact = Boolean(layout);
  const activeDraftPrefill = !rec && layoutExact && draftPrefill && typeof draftPrefill === 'object' && !Array.isArray(draftPrefill)
    ? draftPrefill
    : null;
  const scopedField = layoutField => {
    const base = fm[layoutField.api_name] || layoutField;
    return {
      ...base,
      ...(layoutExact ? layoutField : {}),
      required: base.system_mandatory === true || base.required === true || (layoutExact && (layoutField.required === true || layoutField.system_mandatory === true)),
      system_mandatory: base.system_mandatory === true || (layoutExact && layoutField.system_mandatory === true),
      view_type: { ...(base.view_type || {}), ...(layoutExact ? (layoutField.view_type || {}) : {}) },
    };
  };
  const modal = $('#modal'), box = $('#modalBox');
  box.innerHTML = '';
  const mh = el('div', 'mh', (rec ? 'Edit ' : 'New ') + esc(state.moduleByApi[mod]?.singular_label || mod));
  const x = el('div', 'x', '✕'); x.onclick = () => modal.classList.add('hidden'); mh.appendChild(x);
  const mb = el('div', 'mb');
  const inputs = {};
  const unsupportedRequired = [];

  if (!rec && layouts.length > 1) {
    const chooser = el('div', 'ffield layout-choice');
    chooser.appendChild(el('label', null, 'Layout <span class="req">*</span>'));
    const select = el('select');
    const placeholder = el('option'); placeholder.value = ''; placeholder.textContent = 'Select the exact layout'; select.appendChild(placeholder);
    layouts.forEach(item => {
      const option = el('option'); option.value = item.id; option.textContent = item.name || item.display_label || item.id;
      option.selected = String(item.id) === String(exactLayoutId || ''); select.appendChild(option);
    });
    select.onchange = () => openForm(mod, null, select.value || null);
    chooser.appendChild(select); mb.appendChild(chooser);
  } else if (layoutExact) {
    mb.appendChild(el('div', 'formcallout', `Layout: <b>${esc(layout.name || layout.display_label || layout.id)}</b> · layout-specific mandatory fields are enforced.`));
  } else if (rec && layouts.length > 1) {
    mb.appendChild(el('div', 'formcallout warning', 'This record does not identify an active layout. Layout-specific requirements are not assumed; only source-wide field rules can be enforced safely.'));
  }

  if (activeDraftPrefill) {
    const draftNotice = el('div', 'formcallout assistant-formcallout');
    draftNotice.textContent = 'Assistant draft preview loaded. Nothing has been created—review every value, complete any missing fields, then choose Create to submit through this validated form.';
    mb.appendChild(draftNotice);
  }

  if (!renderLayout && !rec) {
    mb.appendChild(el('div', 'formcallout warning', 'Choose a layout to load its exact fields and mandatory rules.'));
  }

  (renderLayout?.sections || []).forEach(sec => {
    const sectionFields = (sec.fields || []).map(scopedField).filter(Boolean);
    const requiredSubforms = sectionFields.filter(field => layoutExact && field.data_type === 'subform' && field.required === true);
    if (sec.isSubformSection) {
      if (!requiredSubforms.length) return;
      mb.appendChild(el('div', 'formsec', esc(sec.display_label || 'Required subform')));
      requiredSubforms.forEach(field => {
        const rows = Array.isArray(rec?.[field.api_name]) ? rec[field.api_name] : [];
        const note = el('div', `formcallout${rows.length ? '' : ' warning'}`,
          rows.length
            ? `<b>${esc(field.field_label || field.api_name)}</b> is required. ${rows.length} existing row${rows.length === 1 ? '' : 's'} will be retained.`
            : `<b>${esc(field.field_label || field.api_name)}</b> is required by this layout. No value is invented: creation is blocked until a real subform row can be supplied.`);
        mb.appendChild(note);
        if (!rows.length) unsupportedRequired.push(field);
      });
      return;
    }
    const secFields = sectionFields.filter(field => EDITABLE(field));
    if (!secFields.length) return;
    mb.appendChild(el('div', 'formsec', esc(sec.display_label)));
    const grid = el('div', 'formgrid');
    secFields.forEach(f => {
      const w = el('div', 'ffield');
      const required = f.system_mandatory === true || f.required === true;
      w.appendChild(el('label', null, esc(f.field_label) + (required ? ' <span class="req">*</span>' : '')));
      let inp;
      const cur = rec
        ? rec[f.api_name]
        : (activeDraftPrefill && Object.prototype.hasOwnProperty.call(activeDraftPrefill, f.api_name) ? activeDraftPrefill[f.api_name] : null);
      if (f.data_type === 'picklist') {
        inp = el('select');
        inp.appendChild(el('option', null, '-None-')).value = '';
        (f.pick_list_values || []).forEach(p => {
          const o = el('option'); o.value = p.actual_value ?? p.display_value; o.textContent = p.display_value;
          if (cur === o.value || cur === p.display_value) o.selected = true;
          inp.appendChild(o);
        });
      } else if (f.data_type === 'multiselectpicklist') {
        inp = el('select'); inp.multiple = true; inp.style.height = '64px';
        (f.pick_list_values || []).forEach(p => {
          const o = el('option'); o.value = p.actual_value ?? p.display_value; o.textContent = p.display_value;
          if (Array.isArray(cur) && cur.includes(o.value)) o.selected = true;
          inp.appendChild(o);
        });
      } else if (f.data_type === 'boolean') {
        inp = el('select');
        [['','-None-'],['true','Yes'],['false','No']].forEach(([v, t]) => { const o = el('option'); o.value = v; o.textContent = t; if (String(cur) === v) o.selected = true; inp.appendChild(o); });
      } else if (f.data_type === 'textarea') {
        inp = el('textarea'); inp.value = cur ?? '';
      } else if (f.data_type === 'date') {
        inp = el('input'); inp.type = 'date'; inp.value = cur ?? '';
      } else if (f.data_type === 'datetime') {
        inp = el('input'); inp.type = 'datetime-local'; inp.value = cur ? String(cur).slice(0, 16) : '';
      } else if (['integer','double','currency','bigint','percent'].includes(f.data_type)) {
        inp = el('input'); inp.type = 'number'; inp.step = 'any'; inp.value = cur ?? '';
      } else if (f.data_type === 'lookup') {
        inp = el('input'); inp.type = 'text'; inp.placeholder = 'Lookup — keep existing'; inp.disabled = true;
        inp.value = cur ? fmtVal(cur) : '';
      } else {
        inp = el('input'); inp.type = 'text'; inp.value = cur ?? '';
      }
      inp.dataset.dt = f.data_type;
      inp.required = required;
      inputs[f.api_name] = inp;
      w.appendChild(inp);
      grid.appendChild(w);
    });
    mb.appendChild(grid);
  });

  const mf = el('div', 'mf');
  const bc = el('button', null, 'Cancel'); bc.onclick = () => modal.classList.add('hidden');
  const bs = el('button', 'btn-primary', rec ? 'Save' : 'Create');
  if ((!rec && !layoutExact && layouts.length > 1) || (rec && !layoutExact) || unsupportedRequired.length) {
    bs.disabled = true;
    bs.title = unsupportedRequired.length
      ? `${unsupportedRequired.map(field => field.field_label || field.api_name).join(', ')} must contain real subform data.`
      : 'Select the exact layout first.';
  }
  bs.onclick = async () => {
    const payload = {};
    for (const [k, inp] of Object.entries(inputs)) {
      if (inp.disabled) continue;
      const dt = inp.dataset.dt;
      let v;
      if (dt === 'multiselectpicklist') v = [...inp.selectedOptions].map(o => o.value).filter(Boolean);
      else v = inp.value;
      if (inp.required && (v === '' || (Array.isArray(v) && !v.length))) { inp.focus(); toast(`${fm[k]?.field_label || k} is required by this layout`); return; }
      if (v === '' || (Array.isArray(v) && !v.length)) { if (rec && rec[k] != null && rec[k] !== '') payload[k] = null; continue; }
      v = recordFormValueForPayload(v, dt);
      const before = rec ? rec[k] : undefined;
      if (rec && (before === v || (before == null && (v === '' || v == null)))) continue;
      payload[k] = v;
    }
    if (!Object.keys(payload).length) { toast('No changes'); return; }
    bs.disabled = true;
    try {
      const layoutQuery = layoutExact ? `?layout_id=${encodeURIComponent(layout.id)}` : '';
      const r = rec
        ? await api(`/api/record/${mod}/${rec.id}${layoutQuery}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        : await api(`/api/record/${mod}${layoutQuery}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const item = (r.data || [])[0];
      if (item?.status === 'success') {
        toast(rec ? 'Saved ✓' : 'Created ✓');
        modal.classList.add('hidden');
        if (rec) openRecord(mod, rec.id); else if (item.details?.id) location.hash = `#/record/${mod}/${item.details.id}`;
      } else {
        toast('Rejected: ' + (item?.message || JSON.stringify(item).slice(0, 120)));
        bs.disabled = false;
      }
    } catch (e) { toast('Failed: ' + e.message); bs.disabled = false; }
  };
  mf.append(bc, bs);
  box.append(mh, mb, mf);
  modal.classList.remove('hidden');
}

/* ---------- CRM assistant ---------- */
const CRM_ASSISTANT_TURN_LIMIT = 8;
const CRM_ASSISTANT_PROMPT_LIMIT = 2000;
const CRM_ASSISTANT_PROMPT_BYTES = 8000;
const CRM_ASSISTANT_SOURCE_MODE = 'local-replica-read-only';
const CRM_ASSISTANT_SAFETY_HINT = 'Each question is independent. Never paste passwords, tokens, keys, or cookies.';
const CRM_ASSISTANT_REVIEWED_QUESTIONS = Object.freeze([
  'Count Leads by Lead Status',
  'Find up to 10 overdue Tasks',
  'Show required fields for a new Lead',
  'Prepare a new Lead draft for review with Last Name: <name>',
  'Count records in <module>',
  'Count records in <module> by <safe field>',
  'Count records in <module> by <safe-group-field> where <safe-filter-field> is empty',
]);
const CRM_ASSISTANT_EXECUTABLE_EXAMPLES = Object.freeze({
  'Count records in <module>': 'Count records in Leads',
  'Count records in <module> by <safe field>': 'Count records in Calls by Call Result',
  'Count records in <module> by <safe-group-field> where <safe-filter-field> is empty': 'Count records in Calls by Call Type where Call Result is empty',
});
const CRM_ASSISTANT_REQUIRED_TOOLS = [
  'aggregate_records',
  'search_records',
  'get_record',
  'inspect_module_metadata',
  'prepare_record_creation_draft',
];
const crmAssistantState = {
  open: false,
  busy: false,
  turns: 0,
  status: null,
  statusLoading: true,
  statusError: false,
  refs: null,
};

/* CRM assistant safety helpers start */
function assistantPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeAssistantDraftValues(values) {
  if (!assistantPlainObject(values)) return null;
  const keys = Object.keys(values).sort();
  if (!keys.length || keys.length > 50) return null;
  const normalized = {};
  for (const key of keys) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key)) return null;
    const value = values[key];
    if (value === null || typeof value === 'boolean') normalized[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) normalized[key] = value;
    else if (typeof value === 'string' && value.length <= 12000) normalized[key] = value;
    else if (Array.isArray(value) && value.length <= 100 && value.every(item => item === null || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item)) || (typeof item === 'string' && item.length <= 2000))) {
      normalized[key] = value.slice();
    } else return null;
  }
  return normalized;
}

function assistantExactQuestions(value) {
  if (!Array.isArray(value)) return [];
  const reviewed = new Set(CRM_ASSISTANT_REVIEWED_QUESTIONS);
  return [...new Set(value.filter(question => typeof question === 'string' && reviewed.has(question)))];
}

function assistantSupportedQuestions(status = crmAssistantState.status) {
  return assistantExactQuestions(status?.fallback?.supported_questions);
}

function assistantReviewedQuestions(status = crmAssistantState.status) {
  const reviewed = assistantExactQuestions(status?.fallback?.reviewed_questions);
  return reviewed.length ? reviewed : [...CRM_ASSISTANT_REVIEWED_QUESTIONS];
}

function assistantUnavailableQuestionReasons(status = crmAssistantState.status) {
  const reasons = new Map();
  const entries = Array.isArray(status?.fallback?.unavailable_questions) ? status.fallback.unavailable_questions : [];
  entries.forEach(entry => {
    const question = typeof entry === 'string'
      ? entry
      : (typeof entry?.question === 'string' ? entry.question : (typeof entry?.prompt === 'string' ? entry.prompt : ''));
    if (!CRM_ASSISTANT_REVIEWED_QUESTIONS.includes(question)) return;
    const reason = typeof entry === 'object' && entry
      ? String(entry.reason || entry.message || 'Unavailable for the current mirrored permission and schema scope.').slice(0, 240)
      : 'Unavailable for the current mirrored permission and schema scope.';
    reasons.set(question, reason);
  });
  return reasons;
}

function assistantQuestionInput(question) {
  if (CRM_ASSISTANT_EXECUTABLE_EXAMPLES[question]) return CRM_ASSISTANT_EXECUTABLE_EXAMPLES[question];
  return question.includes('<name>') ? question.replace('<name>', '') : question;
}

function assistantQuestionLabel(question) {
  if (CRM_ASSISTANT_EXECUTABLE_EXAMPLES[question]) return CRM_ASSISTANT_EXECUTABLE_EXAMPLES[question];
  return question.includes('<name>') ? question.replace(': <name>', '') : question;
}

function assistantDeterministicStatusUsable(status) {
  const supported = assistantSupportedQuestions(status);
  return Boolean(assistantPlainObject(status)
    && status.available === false
    && status.deterministic_available === true
    && status.status === 'DeterministicOnly'
    && status.model === null
    && status.provider === 'Local deterministic parser'
    && status.network_attempted === false
    && assistantPlainObject(status.fallback)
    && status.fallback.mode === 'DeterministicLocalOnly'
    && status.fallback.network_attempted === false
    && supported.length > 0);
}

function assistantDraftHandoff(draft, status, moduleByApi) {
  if (!assistantPlainObject(draft)
    || draft.status !== 'PreviewOnly'
    || typeof draft.module !== 'string'
    || !Object.prototype.hasOwnProperty.call(moduleByApi || {}, draft.module)
    || !/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(draft.module)
    || !/^[a-f0-9]{64}$/.test(String(draft.draft_fingerprint || ''))
    || !assistantPlainObject(draft.layout)
    || draft.layout.resolved !== true
    || draft.layout.selection_required !== false
    || !assistantPlainObject(draft.validation)
    || draft.validation.valid !== true
    || draft.validation.metadata_complete !== true
    || !Array.isArray(draft.validation.missing_required_fields)
    || draft.validation.missing_required_fields.length !== 0
    || !Array.isArray(draft.validation.unavailable_required_fields)
    || draft.validation.unavailable_required_fields.length !== 0
    || draft.validation.hidden_required_field_count !== 0
    || !Array.isArray(draft.validation.invalid_or_read_only_fields)
    || draft.validation.invalid_or_read_only_fields.length !== 0
    || draft.validation.scope !== 'mirrored-required-field-precheck'
    || draft.validation.requires_existing_create_form_validation !== true
    || !assistantPlainObject(draft.approval)
    || draft.approval.required !== true
    || draft.approval.approved !== false
    || !assistantPlainObject(draft.execution)
    || draft.execution.local_create_route_called !== false
    || draft.execution.local_database_write !== false
    || draft.execution.zoho_contacted !== false
    || draft.execution.zoho_write !== false
    || draft.execution.outbound_action !== false
    || !assistantPlainObject(draft.ui_handoff)
    || draft.ui_handoff.action !== 'open_existing_validated_create_form'
    || draft.ui_handoff.module !== draft.module
    || draft.ui_handoff.draft_fingerprint !== draft.draft_fingerprint
    || draft.ui_handoff.requires_explicit_user_approval !== true
    || draft.ui_handoff.auto_submit !== false
    || !assistantPlainObject(status)
    || !(status.available === true || assistantDeterministicStatusUsable(status))
    || status.source_mode !== CRM_ASSISTANT_SOURCE_MODE
    || !assistantPlainObject(status.permission_scope)
    || status.permission_scope.loaded !== true) return null;

  const modulePermission = Array.isArray(status.permission_scope.modules)
    ? status.permission_scope.modules.find(item => item?.module === draft.module)
    : null;
  if (!assistantPlainObject(modulePermission)
    || !assistantPlainObject(modulePermission.capabilities)
    || modulePermission.capabilities.create_draft !== true
    || modulePermission.layout_resolved !== true) return null;

  const values = normalizeAssistantDraftValues(draft.values);
  const handoffValues = normalizeAssistantDraftValues(draft.ui_handoff.values);
  if (!values || !handoffValues || JSON.stringify(values) !== JSON.stringify(handoffValues)) return null;
  return { mode: 'prefill', module: draft.module, values, draft_fingerprint: draft.draft_fingerprint };
}

async function verifyAssistantDraftCreateLayout(handoff) {
  if (!state.bootReady
    || !assistantPlainObject(handoff)
    || handoff.mode !== 'prefill'
    || !Object.prototype.hasOwnProperty.call(state.moduleByApi, handoff.module)) return null;
  const values = normalizeAssistantDraftValues(handoff.values);
  if (!values) return null;
  const [fields, layouts] = await Promise.all([getFields(handoff.module), getLayouts(handoff.module)]);
  if (!Array.isArray(fields) || !Array.isArray(layouts) || layouts.length !== 1) return null;
  const layout = layouts[0];
  if (!layout || !Array.isArray(layout.sections)) return null;
  const baseByName = new Map(fields.filter(Boolean).map(field => [field.api_name, field]));
  const editableCreateFields = new Set();
  layout.sections.forEach(section => {
    (Array.isArray(section?.fields) ? section.fields : []).forEach(layoutField => {
      if (!layoutField?.api_name) return;
      const base = baseByName.get(layoutField.api_name) || layoutField;
      const scoped = {
        ...base,
        ...layoutField,
        view_type: { ...(base.view_type || {}), ...(layoutField.view_type || {}) },
      };
      if (EDITABLE(scoped) && scoped.data_type !== 'lookup' && scoped.view_type?.create !== false) {
        editableCreateFields.add(scoped.api_name);
      }
    });
  });
  if (!Object.keys(values).every(key => editableCreateFields.has(key))) return null;
  return { layout_id: layout.id, values };
}
/* CRM assistant safety helpers end */

function assistantNode(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function assistantStatusUsable(status = crmAssistantState.status) {
  return Boolean(state.bootReady
    && status
    && (status.available === true || assistantDeterministicStatusUsable(status))
    && status.source_mode === CRM_ASSISTANT_SOURCE_MODE
    && status.permission_scope?.loaded === true
    && Array.isArray(status.tools)
    && CRM_ASSISTANT_REQUIRED_TOOLS.every(tool => status.tools.includes(tool)));
}

function assistantFallbackText(status = crmAssistantState.status) {
  if (status?.reason_code === 'AI_GATEWAY_CREDENTIAL_MISSING' || status?.fallback?.mode === 'DeterministicLocalOnly') {
    const supported = assistantSupportedQuestions(status).length;
    if (supported > 0) {
      return `AI model unavailable. Keyless local mode can answer ${supported} of ${CRM_ASSISTANT_REVIEWED_QUESTIONS.length} reviewed CRM questions with no model or network call.`;
    }
    return 'AI model unavailable. None of the reviewed keyless CRM questions can run safely with the current mirrored permission and schema scope.';
  }
  return 'The CRM assistant is unavailable. Continue with the existing local CRM views and validated forms.';
}

function assistantRenderStatus() {
  const refs = crmAssistantState.refs;
  if (!refs) return;
  refs.status.replaceChildren();
  refs.status.className = 'crm-assistant-status';
  refs.status.setAttribute('aria-busy', crmAssistantState.statusLoading ? 'true' : 'false');

  const top = assistantNode('div', 'crm-assistant-status-top');
  const badge = assistantNode('span', 'crm-assistant-status-badge');
  const summary = assistantNode('span', 'crm-assistant-status-summary');
  if (crmAssistantState.statusLoading) {
    badge.textContent = 'Checking';
    summary.textContent = 'Verifying assistant access and permissions…';
    refs.status.classList.add('is-loading');
  } else if (crmAssistantState.statusError) {
    badge.textContent = 'Unavailable';
    summary.textContent = 'Assistant access could not be verified.';
    refs.status.classList.add('is-error');
  } else if (state.bootError) {
    badge.textContent = 'Unavailable';
    summary.textContent = state.bootError;
    refs.status.classList.add('is-error');
  } else if (!state.bootReady) {
    badge.textContent = 'Checking';
    summary.textContent = 'Loading CRM module metadata before enabling assistant actions…';
    refs.status.classList.add('is-loading');
  } else if (assistantDeterministicStatusUsable(crmAssistantState.status)) {
    const supported = assistantSupportedQuestions(crmAssistantState.status).length;
    const reviewed = assistantReviewedQuestions(crmAssistantState.status).length;
    badge.textContent = 'Local mode';
    summary.textContent = `${supported} of ${reviewed} reviewed questions · no model or network`;
    refs.status.classList.add('is-ready');
  } else if (assistantStatusUsable()) {
    badge.textContent = 'AI ready';
    summary.textContent = 'Bounded, permission-scoped answers';
    refs.status.classList.add('is-ready');
  } else {
    badge.textContent = 'Local fallback';
    summary.textContent = assistantFallbackText();
    refs.status.classList.add('is-fallback');
  }
  top.append(badge, summary);
  refs.status.appendChild(top);

  const status = crmAssistantState.status;
  const scope = status?.permission_scope;
  const sourceText = status?.source_mode === CRM_ASSISTANT_SOURCE_MODE
    ? 'Local CRM replica · read only'
    : 'Source access not verified';
  const permissionText = scope?.loaded === true
    ? `${Number(scope.module_count || scope.modules?.length || 0).toLocaleString('en-IN')} modules · mirrored module, field and layout permissions`
    : 'Permission scope is not loaded';
  const grid = assistantNode('div', 'crm-assistant-status-grid');
  [['Source', sourceText], ['Permissions', permissionText], ['Actions', 'Read answers and draft previews only · never auto-create']].forEach(([label, value]) => {
    const item = assistantNode('div', 'crm-assistant-status-item');
    item.append(assistantNode('strong', null, label), assistantNode('span', null, value));
    grid.appendChild(item);
  });
  refs.status.appendChild(grid);

  if (crmAssistantState.statusError) {
    const retry = assistantNode('button', 'crm-assistant-retry', 'Retry status check');
    retry.type = 'button';
    retry.onclick = assistantLoadStatus;
    refs.status.appendChild(retry);
  }
}

function assistantRenderEmpty() {
  const refs = crmAssistantState.refs;
  if (!refs || refs.log.childElementCount) return;
  refs.empty.replaceChildren();
  refs.empty.classList.remove('hidden');
  const mark = assistantNode('span', 'crm-assistant-empty-mark', '✦');
  mark.setAttribute('aria-hidden', 'true');
  const heading = assistantNode('h3');
  const copy = assistantNode('p');
  if (crmAssistantState.statusLoading) {
    heading.textContent = 'Preparing your CRM assistant';
    copy.textContent = 'Checking the local data source and your mirrored permission scope.';
  } else if (crmAssistantState.statusError) {
    heading.textContent = 'Assistant status unavailable';
    copy.textContent = 'Retry the status check. Your CRM remains available through its normal local views.';
  } else if (state.bootError) {
    heading.textContent = 'CRM metadata unavailable';
    copy.textContent = 'Assistant actions remain disabled because the local CRM module metadata did not load.';
  } else if (!state.bootReady) {
    heading.textContent = 'Preparing CRM metadata';
    copy.textContent = 'Assistant actions will remain disabled until the local module metadata is ready.';
  } else if (!assistantStatusUsable()) {
    heading.textContent = 'Deterministic local fallback';
    copy.textContent = assistantFallbackText();
  } else if (assistantDeterministicStatusUsable(crmAssistantState.status)) {
    const supported = assistantSupportedQuestions(crmAssistantState.status).length;
    const reviewed = assistantReviewedQuestions(crmAssistantState.status).length;
    heading.textContent = 'Keyless local questions';
    copy.textContent = `${supported} of ${reviewed} reviewed questions are available. Choose an enabled prompt below; no model or network call is used.`;
  } else {
    heading.textContent = 'Ask about your CRM';
    copy.textContent = 'Get bounded answers from the local read-only replica, inspect configured metadata, or prepare a record draft for review.';
  }
  refs.empty.append(mark, heading, copy);
}

function assistantOnBootStateChanged() {
  if (!crmAssistantState.refs) return;
  assistantRenderStatus();
  assistantRenderEmpty();
  assistantUpdateComposer();
  if (state.bootReady && !crmAssistantState.statusLoading && (!crmAssistantState.status || crmAssistantState.statusError)) {
    assistantLoadStatus();
  }
}

function assistantSetOpen(open, restoreFocus = true) {
  const refs = crmAssistantState.refs;
  if (!refs) return;
  crmAssistantState.open = Boolean(open);
  refs.panel.classList.toggle('hidden', !crmAssistantState.open);
  refs.launcher.setAttribute('aria-expanded', crmAssistantState.open ? 'true' : 'false');
  refs.launcher.setAttribute('aria-label', crmAssistantState.open ? 'Hide CRM assistant panel' : 'Open CRM assistant');
  refs.launcher.classList.toggle('is-open', crmAssistantState.open);
  if (crmAssistantState.open) {
    setTimeout(() => (assistantStatusUsable() ? refs.input : refs.close).focus(), 0);
  } else if (restoreFocus) refs.launcher.focus();
}

function assistantPromptByteLength(value) {
  if (typeof TextEncoder === 'function') return new TextEncoder().encode(value).length;
  return encodeURIComponent(value).replace(/%[0-9A-F]{2}|./gi, 'x').length;
}

function assistantErrorCopy(error) {
  const byCode = {
    AGENT_CHAT_INPUT_INVALID: 'Enter a shorter, specific CRM question and try again.',
    AGENT_SENSITIVE_PROMPT_BLOCKED: 'For safety, remove passwords, tokens, keys, cookies, or other credentials from the prompt.',
    AGENT_CHAT_BUSY: 'The bounded assistant queue is busy. Wait a moment and try again.',
    AGENT_PERMISSION_SCOPE_UNAVAILABLE: 'The mirrored CRM permission scope is unavailable, so the assistant cannot answer safely.',
    AGENT_PERMISSION_DENIED: 'That operation is outside the current mirrored CRM permission scope. No CRM data was changed.',
    AGENT_INPUT_INVALID: 'The requested CRM operation did not pass the reviewed input contract. No CRM data was changed.',
    AGENT_SENSITIVE_FIELD_BLOCKED: 'That request includes a credential-sensitive field and was blocked before execution.',
    AGENT_TOOL_NOT_ALLOWED: 'That operation is not part of the reviewed CRM assistant tool allowlist.',
    AGENT_LOCAL_HANDLER_FAILED: 'The local read-only CRM operation failed safely. No CRM record or source data was changed.',
    AGENT_GENERATION_FAILED: 'The assistant could not complete this answer. No CRM record or source data was changed.',
  };
  return byCode[error?.code] || 'The assistant request could not be completed. No CRM record or source data was changed.';
}

async function assistantFetchJson(path, options = {}) {
  const response = await fetch(path, { cache: 'no-store', ...options });
  let data = null;
  try { data = await response.json(); } catch (e) {}
  if (!response.ok) {
    const error = new Error('CRM assistant request failed');
    error.status = response.status;
    error.code = data?.error?.code || null;
    throw error;
  }
  return data;
}

function assistantUpdateComposer() {
  const refs = crmAssistantState.refs;
  if (!refs) return;
  const limitReached = crmAssistantState.turns >= CRM_ASSISTANT_TURN_LIMIT;
  const enabled = assistantStatusUsable() && !crmAssistantState.busy && !limitReached;
  const deterministic = assistantDeterministicStatusUsable(crmAssistantState.status);
  const supported = new Set(deterministic ? assistantSupportedQuestions(crmAssistantState.status) : CRM_ASSISTANT_REVIEWED_QUESTIONS);
  const unavailableReasons = assistantUnavailableQuestionReasons(crmAssistantState.status);
  refs.input.disabled = !enabled;
  refs.send.disabled = !enabled || !refs.input.value.trim();
  refs.clear.disabled = crmAssistantState.busy || (crmAssistantState.turns === 0 && refs.log.childElementCount === 0);
  refs.chips.querySelectorAll('button').forEach(button => {
    const question = button.dataset.prompt || '';
    const supportedNow = supported.has(question);
    button.disabled = !enabled || !supportedNow;
    button.classList.toggle('is-unavailable', deterministic && !supportedNow);
    const unavailableReason = unavailableReasons.get(question);
    button.title = deterministic && !supportedNow
      ? (unavailableReason || 'Unavailable for the current mirrored permission and schema scope.')
      : assistantQuestionInput(question);
  });
  refs.turns.textContent = `${crmAssistantState.turns} / ${CRM_ASSISTANT_TURN_LIMIT} questions`;
  refs.limit.classList.toggle('hidden', !limitReached);
  if (limitReached) refs.input.placeholder = 'Clear this conversation to ask more';
  else if (crmAssistantState.statusLoading || !state.bootReady) refs.input.placeholder = 'Checking assistant access and CRM metadata…';
  else if (!assistantStatusUsable()) refs.input.placeholder = 'Assistant unavailable — use local CRM views';
  else if (deterministic) refs.input.placeholder = `Choose one of ${supported.size} available reviewed questions…`;
  else refs.input.placeholder = 'Ask about records, counts, fields, or a draft…';
  if (refs.questionAvailability) {
    if (deterministic) {
      refs.questionAvailability.textContent = `${supported.size} of ${assistantReviewedQuestions(crmAssistantState.status).length} reviewed prompts available in keyless mode.`;
      refs.questionAvailability.classList.toggle('has-unavailable', supported.size < assistantReviewedQuestions(crmAssistantState.status).length);
    } else if (assistantStatusUsable()) {
      refs.questionAvailability.textContent = 'All reviewed suggestions are available.';
      refs.questionAvailability.classList.remove('has-unavailable');
    } else {
      refs.questionAvailability.textContent = 'Reviewed prompts will be enabled when their permission and schema checks pass.';
      refs.questionAvailability.classList.add('has-unavailable');
    }
  }
}

function assistantFieldLabel(module, key) {
  const safeKey = typeof key === 'string' ? key.slice(0, 120) : 'Field';
  const moduleFields = Array.isArray(state.fields[module]) ? state.fields[module] : [];
  const field = moduleFields.find(item => item.api_name === safeKey);
  if (field?.field_label) return field.field_label;
  return safeKey.replace(/__/g, ' ').replace(/_/g, ' ').replace(/\b\w/g, character => character.toUpperCase());
}

function assistantValueText(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.map(item => assistantValueText(item)).join(', ') || '—';
  if (typeof value === 'object') return '[Structured value—review in the Create form]';
  return String(value).slice(0, 2000);
}

function assistantDraftPreview(draft) {
  const card = assistantNode('section', 'crm-assistant-draft');
  card.setAttribute('aria-label', 'Record creation draft preview');
  const head = assistantNode('div', 'crm-assistant-draft-head');
  const copy = assistantNode('div');
  copy.append(
    assistantNode('span', 'crm-assistant-draft-eyebrow', 'Preview only'),
    assistantNode('h4', null, draft?.module ? `New ${state.moduleByApi[draft.module]?.singular_label || draft.module}` : 'Record draft'),
  );
  const validationValid = draft?.validation?.valid === true;
  const badge = assistantNode('span', `crm-assistant-draft-state ${validationValid ? 'is-valid' : 'is-incomplete'}`, validationValid ? 'Ready to review' : 'Needs completion');
  head.append(copy, badge);
  card.appendChild(head);

  const notice = assistantNode('p', 'crm-assistant-draft-notice', 'No record has been created. Review every proposed value before opening the existing validated Create form.');
  card.appendChild(notice);
  if (assistantPlainObject(draft?.values)) {
    const values = assistantNode('dl', 'crm-assistant-draft-values');
    Object.keys(draft.values).sort().slice(0, 50).forEach(key => {
      values.append(
        assistantNode('dt', null, assistantFieldLabel(draft.module, key)),
        assistantNode('dd', null, assistantValueText(draft.values[key])),
      );
    });
    card.appendChild(values);
  }

  const issues = [];
  if (Array.isArray(draft?.validation?.missing_required_fields) && draft.validation.missing_required_fields.length) {
    issues.push(`Missing required: ${draft.validation.missing_required_fields.map(key => assistantFieldLabel(draft.module, key)).join(', ')}`);
  }
  if (Array.isArray(draft?.validation?.unavailable_required_fields) && draft.validation.unavailable_required_fields.length) {
    issues.push(`Required but unavailable in the mirrored Create scope: ${draft.validation.unavailable_required_fields.map(key => assistantFieldLabel(draft.module, key)).join(', ')}`);
  }
  if (Number.isInteger(draft?.validation?.hidden_required_field_count) && draft.validation.hidden_required_field_count > 0) {
    issues.push(`${draft.validation.hidden_required_field_count} required field${draft.validation.hidden_required_field_count === 1 ? ' is' : 's are'} hidden from the mirrored Create scope.`);
  }
  if (Array.isArray(draft?.validation?.invalid_or_read_only_fields) && draft.validation.invalid_or_read_only_fields.length) {
    issues.push(`Unavailable or read-only proposed fields: ${draft.validation.invalid_or_read_only_fields.map(key => assistantFieldLabel(draft.module, key)).join(', ')}`);
  }
  if (draft?.validation?.metadata_complete === false) issues.push('Exact layout metadata is incomplete.');
  if (issues.length) {
    const list = assistantNode('ul', 'crm-assistant-draft-issues');
    issues.forEach(issue => list.appendChild(assistantNode('li', null, issue)));
    card.appendChild(list);
  }

  const handoff = assistantDraftHandoff(draft, crmAssistantState.status, state.moduleByApi);
  if (handoff) {
    const action = assistantNode('button', 'crm-assistant-draft-action', 'Review draft in Create form');
    action.type = 'button';
    action.onclick = async () => {
      action.disabled = true;
      action.textContent = 'Verifying exact Create layout…';
      try {
        const verified = await verifyAssistantDraftCreateLayout(handoff);
        if (!verified) {
          action.textContent = 'Create-form handoff unavailable';
          const blocked = assistantNode('p', 'crm-assistant-draft-blocked', 'The proposed fields do not match the loaded exact editable Create layout. Nothing was created; use the module’s New button to review the current form.');
          blocked.setAttribute('role', 'alert');
          card.appendChild(blocked);
          toast('Draft handoff blocked by the exact Create-layout check.');
          return;
        }
        action.textContent = 'Opening validated form…';
        await openForm(handoff.module, null, verified.layout_id, verified.values);
        assistantSetOpen(false, false);
      } catch (error) {
        toast('Could not open the Create form. Please use the module’s New button.');
        action.disabled = false;
        action.textContent = 'Review draft in Create form';
      }
    };
    card.appendChild(action);
  } else {
    card.appendChild(assistantNode('p', 'crm-assistant-draft-blocked', 'Create-form handoff is unavailable because the draft is incomplete or its exact layout, permission, and preview-only safety metadata could not be verified.'));
  }
  return card;
}

function assistantAppendMessage(role, text, draft = null, kind = '') {
  const refs = crmAssistantState.refs;
  refs.empty.classList.add('hidden');
  const message = assistantNode('article', `crm-assistant-message is-${role}${kind ? ` is-${kind}` : ''}`);
  const label = assistantNode('div', 'crm-assistant-message-label', role === 'user' ? 'You' : 'CRM assistant');
  const bubble = assistantNode('div', 'crm-assistant-message-bubble');
  if (text) bubble.appendChild(assistantNode('p', null, String(text).slice(0, 16000)));
  if (draft) bubble.appendChild(assistantDraftPreview(draft));
  message.append(label, bubble);
  refs.log.appendChild(message);
  refs.scroller.scrollTop = refs.scroller.scrollHeight;
  return message;
}

function assistantResetConversation() {
  if (crmAssistantState.busy) return;
  const refs = crmAssistantState.refs;
  refs.log.replaceChildren();
  crmAssistantState.turns = 0;
  refs.input.value = '';
  refs.input.removeAttribute('aria-invalid');
  refs.hint.textContent = CRM_ASSISTANT_SAFETY_HINT;
  refs.counter.textContent = `0 / ${CRM_ASSISTANT_PROMPT_LIMIT}`;
  assistantRenderEmpty();
  assistantUpdateComposer();
  if (assistantStatusUsable()) refs.input.focus();
}

async function assistantLoadStatus() {
  crmAssistantState.statusLoading = true;
  crmAssistantState.statusError = false;
  assistantRenderStatus();
  assistantRenderEmpty();
  assistantUpdateComposer();
  try {
    const status = await assistantFetchJson('/api/agent/status');
    crmAssistantState.status = assistantPlainObject(status) ? status : null;
    crmAssistantState.statusError = !crmAssistantState.status;
  } catch (error) {
    crmAssistantState.status = null;
    crmAssistantState.statusError = true;
  } finally {
    crmAssistantState.statusLoading = false;
    assistantRenderStatus();
    assistantRenderEmpty();
    assistantUpdateComposer();
  }
}

async function assistantSendPrompt() {
  const refs = crmAssistantState.refs;
  if (crmAssistantState.busy || !assistantStatusUsable() || crmAssistantState.turns >= CRM_ASSISTANT_TURN_LIMIT) return;
  const prompt = refs.input.value.trim();
  const byteLength = assistantPromptByteLength(prompt);
  if (!prompt || prompt.length > CRM_ASSISTANT_PROMPT_LIMIT || byteLength > CRM_ASSISTANT_PROMPT_BYTES) {
    refs.input.focus();
    refs.input.setAttribute('aria-invalid', 'true');
    refs.hint.textContent = 'Use 1–2,000 characters and no more than 8,000 UTF-8 bytes.';
    return;
  }
  refs.input.removeAttribute('aria-invalid');
  refs.hint.textContent = CRM_ASSISTANT_SAFETY_HINT;
  crmAssistantState.turns += 1;
  assistantAppendMessage('user', prompt);
  refs.input.value = '';
  refs.counter.textContent = `0 / ${CRM_ASSISTANT_PROMPT_LIMIT}`;
  crmAssistantState.busy = true;
  refs.scroller.setAttribute('aria-busy', 'true');
  assistantUpdateComposer();
  const pending = assistantAppendMessage('assistant', 'Working with the permission-scoped local replica…', null, 'loading');
  try {
    const response = await assistantFetchJson('/api/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    pending.remove();
    if (response?.deterministic_available === true
      && response.available === false
      && response.status === 'Complete'
      && response.model === null
      && response.provider === 'Local deterministic parser'
      && response.network_attempted === false
      && response.source_mode === CRM_ASSISTANT_SOURCE_MODE
      && response.bounded === true) {
      const answer = typeof response.answer === 'string' && response.answer.trim()
        ? response.answer.trim()
        : 'No bounded local answer was returned. Try an enabled reviewed prompt suggestion.';
      assistantAppendMessage('assistant', answer, assistantPlainObject(response.draft_preview) ? response.draft_preview : null);
    } else if (response?.available === false) {
      crmAssistantState.status = { ...crmAssistantState.status, ...response, permission_scope: crmAssistantState.status?.permission_scope };
      assistantAppendMessage('assistant', assistantFallbackText(crmAssistantState.status), null, 'fallback');
      assistantRenderStatus();
    } else if (response?.available === true
      && response.status === 'Complete'
      && response.source_mode === CRM_ASSISTANT_SOURCE_MODE
      && response.bounded === true) {
      const answer = typeof response.answer === 'string' && response.answer.trim()
        ? response.answer.trim()
        : (response.draft_preview ? 'A record draft preview is ready for your review.' : 'No answer was returned. Try a more specific CRM question.');
      assistantAppendMessage('assistant', answer, assistantPlainObject(response.draft_preview) ? response.draft_preview : null);
    } else {
      const contractError = new Error('CRM assistant response contract mismatch');
      contractError.code = 'AGENT_GENERATION_FAILED';
      throw contractError;
    }
  } catch (error) {
    pending.remove();
    assistantAppendMessage('assistant', assistantErrorCopy(error), null, 'error');
  } finally {
    crmAssistantState.busy = false;
    refs.scroller.setAttribute('aria-busy', 'false');
    assistantUpdateComposer();
    if (assistantStatusUsable() && crmAssistantState.turns < CRM_ASSISTANT_TURN_LIMIT) refs.input.focus();
  }
}

function initCrmAssistant() {
  const root = assistantNode('div', 'crm-assistant');
  const launcher = assistantNode('button', 'crm-assistant-launcher');
  launcher.type = 'button';
  launcher.id = 'crmAssistantLauncher';
  launcher.setAttribute('aria-label', 'Open CRM assistant');
  launcher.setAttribute('aria-controls', 'crmAssistantPanel');
  launcher.setAttribute('aria-expanded', 'false');
  const launcherMark = assistantNode('span', 'crm-assistant-launcher-mark', '✦');
  launcherMark.setAttribute('aria-hidden', 'true');
  launcher.append(launcherMark, assistantNode('span', 'crm-assistant-launcher-copy', 'Ask CRM'));

  const panel = assistantNode('section', 'crm-assistant-panel hidden');
  panel.id = 'crmAssistantPanel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  panel.setAttribute('aria-labelledby', 'crmAssistantTitle');
  const header = assistantNode('header', 'crm-assistant-header');
  const heading = assistantNode('div', 'crm-assistant-heading');
  heading.append(
    assistantNode('span', 'crm-assistant-eyebrow', 'MAGPPIE intelligence'),
    assistantNode('h2', null, 'CRM Assistant'),
    assistantNode('p', null, 'Local data. Permission scoped. Preview before action.'),
  );
  heading.querySelector('h2').id = 'crmAssistantTitle';
  const headerActions = assistantNode('div', 'crm-assistant-header-actions');
  const clear = assistantNode('button', 'crm-assistant-clear', 'Clear');
  clear.type = 'button';
  clear.setAttribute('aria-label', 'Clear CRM assistant conversation');
  clear.onclick = assistantResetConversation;
  const close = assistantNode('button', 'crm-assistant-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close CRM assistant');
  close.onclick = () => assistantSetOpen(false);
  headerActions.append(clear, close);
  header.append(heading, headerActions);

  const status = assistantNode('section', 'crm-assistant-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-label', 'CRM assistant access status');
  const scroller = assistantNode('div', 'crm-assistant-scroller');
  const empty = assistantNode('div', 'crm-assistant-empty');
  const log = assistantNode('div', 'crm-assistant-log');
  log.setAttribute('role', 'log');
  log.setAttribute('aria-live', 'polite');
  log.setAttribute('aria-relevant', 'additions text');
  log.setAttribute('aria-label', 'CRM assistant conversation');
  scroller.append(empty, log);

  const suggestions = assistantNode('div', 'crm-assistant-suggestions');
  const suggestionsHead = assistantNode('div', 'crm-assistant-suggestions-head');
  suggestionsHead.append(assistantNode('span', null, 'Try a prompt'), assistantNode('span', 'crm-assistant-turns', `0 / ${CRM_ASSISTANT_TURN_LIMIT} questions`));
  const chips = assistantNode('div', 'crm-assistant-chips');
  CRM_ASSISTANT_REVIEWED_QUESTIONS.forEach(question => {
    const chipLabel = assistantQuestionLabel(question);
    const chip = assistantNode('button', null, chipLabel);
    chip.type = 'button';
    chip.dataset.prompt = question;
    chip.onclick = () => {
      const refs = crmAssistantState.refs;
      refs.input.value = assistantQuestionInput(question);
      refs.input.dispatchEvent(new Event('input'));
      refs.input.focus();
      refs.input.setSelectionRange(refs.input.value.length, refs.input.value.length);
    };
    chips.appendChild(chip);
  });
  const questionAvailability = assistantNode('p', 'crm-assistant-suggestions-availability');
  questionAvailability.setAttribute('role', 'status');
  suggestions.append(suggestionsHead, chips, questionAvailability);

  const composer = assistantNode('form', 'crm-assistant-composer');
  const label = assistantNode('label', 'crm-assistant-sr-only', 'Ask the CRM assistant');
  label.htmlFor = 'crmAssistantInput';
  const inputRow = assistantNode('div', 'crm-assistant-input-row');
  const input = assistantNode('textarea');
  input.id = 'crmAssistantInput';
  input.rows = 2;
  input.maxLength = CRM_ASSISTANT_PROMPT_LIMIT;
  input.autocomplete = 'off';
  input.spellcheck = true;
  const send = assistantNode('button', 'crm-assistant-send', 'Send');
  send.type = 'submit';
  inputRow.append(input, send);
  const meta = assistantNode('div', 'crm-assistant-composer-meta');
  const hint = assistantNode('span', 'crm-assistant-hint', CRM_ASSISTANT_SAFETY_HINT);
  hint.id = 'crmAssistantHint';
  input.setAttribute('aria-describedby', hint.id);
  const counter = assistantNode('span', 'crm-assistant-counter', `0 / ${CRM_ASSISTANT_PROMPT_LIMIT}`);
  meta.append(hint, counter);
  const limit = assistantNode('p', 'crm-assistant-limit hidden', 'Session limit reached. Clear this conversation to start a new bounded session.');
  limit.setAttribute('role', 'status');
  composer.append(label, inputRow, meta, limit);
  composer.onsubmit = event => { event.preventDefault(); assistantSendPrompt(); };
  input.addEventListener('input', () => {
    input.removeAttribute('aria-invalid');
    counter.textContent = `${input.value.length} / ${CRM_ASSISTANT_PROMPT_LIMIT}`;
    assistantUpdateComposer();
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (!send.disabled) assistantSendPrompt();
    }
  });

  panel.append(header, status, scroller, suggestions, composer);
  root.append(panel, launcher);
  document.body.appendChild(root);
  crmAssistantState.refs = { root, launcher, panel, close, clear, status, scroller, empty, log, chips, questionAvailability, input, send, hint, counter, turns: suggestionsHead.lastElementChild, limit };
  launcher.onclick = () => assistantSetOpen(!crmAssistantState.open);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && crmAssistantState.open) assistantSetOpen(false);
  });
  assistantRenderStatus();
  assistantRenderEmpty();
  assistantUpdateComposer();
  assistantLoadStatus();
}

/* ---------- global search ---------- */
let searchTimer = null;
$('#globalSearch').addEventListener('input', e => {
  clearTimeout(searchTimer);
  const w = e.target.value.trim();
  const box = $('#searchResults');
  if (w.length < 2) { box.classList.add('hidden'); return; }
  searchTimer = setTimeout(async () => {
    try {
      const mod = state.current || 'Leads';
      const d = await api(`/api/search/${mod}?word=${encodeURIComponent(w)}&per_page=15`);
      const rows = d.data || [];
      rows.forEach(r => swr.record.set(mod + '|' + r.id, r));
      box.innerHTML = '';
      if (!rows.length) box.appendChild(el('div', 'sr', '<div class="s">No matches in ' + esc(state.moduleByApi[mod]?.plural_label || mod) + '</div>'));
      const nf = nameField(mod);
      rows.forEach(r => {
        const sr = el('div', 'sr');
        sr.appendChild(el('div', 't', esc(fmtVal(r[nf]) !== '—' ? fmtVal(r[nf]) : (r.Full_Name || r.Name || r.Subject || r.id))));
        sr.appendChild(el('div', 's', esc([r.Email, r.Phone, r.Mobile, r.Company].filter(Boolean).join(' · '))));
        sr.onclick = () => { box.classList.add('hidden'); e.target.value = ''; location.hash = `#/record/${mod}/${r.id}`; };
        box.appendChild(sr);
      });
      box.classList.remove('hidden');
    } catch (err) { box.classList.add('hidden'); }
  }, 350);
});
document.addEventListener('click', e => { if (!e.target.closest('.searchwrap')) $('#searchResults').classList.add('hidden'); });
document.addEventListener('keydown', e => { if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') { e.preventDefault(); $('#globalSearch').focus(); } });

// sidebar hide/show (persisted per browser)
(() => {
  const shell = $('#shell'), btn = $('#menuToggle');
  let hidden = false;
  try { hidden = localStorage.getItem('crm_sidebar_hidden') === '1'; } catch (e) {}
  const apply = () => {
    shell.classList.toggle('side-collapsed', hidden);
    btn.classList.toggle('on', hidden);
    btn.textContent = hidden ? '☰' : '❮';
    btn.title = hidden ? 'Show menu' : 'Hide menu';
  };
  btn.onclick = () => {
    hidden = !hidden;
    try { localStorage.setItem('crm_sidebar_hidden', hidden ? '1' : '0'); } catch (e) {}
    apply();
  };
  apply();
})();

$('#refreshMeta').onclick = async () => {
  if (state.snapshotOnly) {
    toast('External metadata refresh is paused in snapshot-only mode.');
    return;
  }
  await api('/api/meta/refresh', { method: 'POST' });
  state.fields = {}; state.layouts = {}; state.views = {}; state.viewDetail = {}; state.relLists = {};
  toast('Cache refreshed');
  route();
};

function toast(msg) {
  const t = el('div', 'toast', esc(msg));
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

// auto-update: when a new version is deployed, reload to pick it up
let appVersion = null;
async function versionCheck() {
  try {
    const x = await api('/api/version');
    if (appVersion === null) { appVersion = x.v; return; }
    if (x.v !== appVersion) {
      // reload at most once per new version — never loop
      let last = null;
      try { last = sessionStorage.getItem('crm_reloaded_for'); } catch (e) {}
      if (last === x.v) { appVersion = x.v; return; }
      try { sessionStorage.setItem('crm_reloaded_for', x.v); } catch (e) {}
      appVersion = x.v;
      toast('New version available — updating…');
      setTimeout(() => location.reload(), 1300);
    }
  } catch (e) { /* offline etc — ignore */ }
}
versionCheck();
setInterval(versionCheck, 3 * 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) versionCheck(); });

initCrmAssistant();
window.addEventListener('hashchange', route);
boot();
