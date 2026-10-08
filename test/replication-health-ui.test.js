'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const cardStart = appSource.indexOf('/* Replication truth card start */');
const cardEnd = appSource.indexOf('/* Replication truth card end */', cardStart);
assert.ok(cardStart >= 0 && cardEnd > cardStart, 'Replication truth card source was not found.');
const cardSource = appSource.slice(cardStart, cardEnd);
const trustStyleStart = styles.indexOf('/* ---------- replication truth & freshness ---------- */');
const trustStyleEnd = styles.indexOf('/* ---------- analytics command center ---------- */', trustStyleStart);
assert.ok(trustStyleStart >= 0 && trustStyleEnd > trustStyleStart, 'Replication trust styles were not found.');
const trustStyles = styles.slice(trustStyleStart, trustStyleEnd);

function sourceBetween(startMarker, endMarker) {
  const start = appSource.indexOf(startMarker);
  const end = appSource.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `Could not isolate ${startMarker}.`);
  return appSource.slice(start, end);
}

class FakeNode {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.className = '';
    this.id = '';
    this.children = [];
    this.attributes = {};
    this._textContent = '';
  }

  set textContent(value) { this._textContent = String(value); }
  get textContent() { return this._textContent; }
  get lastElementChild() { return this.children[this.children.length - 1] || null; }
  appendChild(child) { this.children.push(child); return child; }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  allText() { return [this._textContent, ...this.children.map(child => child.allText())].filter(Boolean).join(' '); }
  findAll(tag) {
    const wanted = String(tag).toUpperCase();
    return [
      ...(this.tagName === wanted ? [this] : []),
      ...this.children.flatMap(child => child.findAll(wanted)),
    ];
  }
}

function loadCardFactory() {
  const context = {
    document: { createElement: tag => new FakeNode(tag) },
    api: () => Promise.reject(new Error('not used by this rendering test')),
    state: { nav: 1 },
    console,
  };
  vm.runInNewContext(`${cardSource}\nthis.__cardFactory = replicationTrustAvailableCard;`, context);
  return context.__cardFactory;
}

function sampleHealth() {
  return {
    schema_version: 2,
    generated_at: '2026-08-30T12:00:00.000Z',
    source_mode: 'read-only',
    overall_classification: 'partial_refresh',
    coverage: {
      module_definitions: 153,
      api_supported_modules: 122,
      scheduled_record_modules: 16,
      unscheduled_api_supported_modules: 106,
      classification: 'partial_refresh',
    },
    schedule: {
      enabled: true,
      started: false,
      running: false,
      scheduler_mode: 'vercel-cron',
      externally_scheduled: true,
      execution_fenced: true,
      state_available: true,
      interval_minutes: 15,
      next_run_at: '2026-08-30T12:15:00.000Z',
      last_completed_run: {
        finished_at: '2026-08-30T11:46:00.000Z',
        status: 'partial',
        global_success: false,
        module_summary: { total: 16, complete: 15, partial: 1, error: 0 },
      },
      last_successful_run: {
        finished_at: '2026-08-30T11:31:00.000Z',
        status: 'succeeded',
        global_success: true,
        module_summary: { total: 16, complete: 16, partial: 0, error: 0 },
      },
    },
    reconciliation: [
      {
        dataset_key: 'Notes',
        classification: 'reconciled_current',
        audit_at: '2026-08-29T12:00:00.000Z',
        audited_source_count: 67_793,
        local_observed_at: '2026-08-30T11:58:00.000Z',
        current_local_count: 67_798,
        current_source_count: 67_798,
        source_recheck_at: '2026-08-30T11:59:00.000Z',
        exact_source_local_parity: true,
      },
      {
        dataset_key: 'Tasks',
        classification: 'reconciled_current',
        audit_at: '2026-08-29T12:00:00.000Z',
        audited_source_count: 12_417,
        local_observed_at: '2026-08-30T11:58:00.000Z',
        current_local_count: 12_422,
        current_source_count: 12_422,
        source_recheck_at: '2026-08-30T11:59:00.000Z',
        exact_source_local_parity: true,
      },
      {
        dataset_key: 'Private_Customer_Name',
        classification: 'reconciled_current',
        current_local_count: 1,
        current_source_count: 1,
      },
    ],
    exclusions: Object.fromEntries([
      'deletions', 'attachments', 'metadata', 'reports', 'dashboards', 'child_datasets',
    ].map(key => [key, {
      included: false,
      classification: key === 'deletions' ? 'partial_refresh' : 'unsupported_scope',
    }])),
    deletion_replication: {
      classification: 'partial_refresh',
      reason_code: 'DELETION_ARCHIVE_CONTRACT_UNVERIFIED',
      coverage: {
        scheduled_record_modules: 16,
        documented_deleted_record_modules: 15,
        unsupported_scheduled_modules: 1,
      },
      readiness: {
        engine_implemented: true,
        migration_staged: true,
        contract_verified: false,
        lease_verified: false,
        baseline_ready_modules: 0,
        feature_enabled_modules: 0,
        runtime_executable: false,
        operationally_current: false,
      },
    },
  };
}

test('Home and Analytics start the GET health request without awaiting it', () => {
  assert.match(cardSource, /api\('\/api\/meta\/replication_health', \{ method: 'GET', cache: 'no-store' \}\)/);
  assert.match(cardSource, /const REPLICATION_HEALTH_RETRY_MS = 1_250/);
  assert.match(cardSource, /setTimeout\(resolve, REPLICATION_HEALTH_RETRY_MS\)/);
  const analyticsSource = sourceBetween('async function renderAnalytics()', '/* ---------- dashboard ---------- */');
  const homeSource = sourceBetween('async function renderDashboard()', '/* ---------- metadata helpers ---------- */');
  for (const source of [analyticsSource, homeSource]) {
    assert.match(source, /const replicationHealthRequest = requestReplicationHealthSnapshot\(\);/);
    assert.match(source, /mountReplicationHealthCard\(/);
    assert.doesNotMatch(source, /await\s+(?:requestReplicationHealthSnapshot\(\)|replicationHealthRequest)/);
  }
  assert.ok(
    analyticsSource.indexOf('requestReplicationHealthSnapshot()') < analyticsSource.indexOf("await api(`/api/analytics/overview"),
    'Analytics health fetch should start in parallel with the main overview request.',
  );
  assert.match(homeSource, /surface: 'home'/);
  assert.match(analyticsSource, /surface: 'analytics'/);
});

test('the trust card renders exact scope, persisted states, and allowlisted Notes and Tasks evidence', () => {
  const card = loadCardFactory()(sampleHealth(), 'home');
  const text = card.allText();
  for (const expected of [
    '16/122', 'Last completed', 'partial', 'Last successful', 'succeeded',
    'Notes', '67,798', 'Tasks', '12,422', 'reconciled_current', 'Current source', 'Source rechecked',
  ]) assert.ok(text.includes(expected), `Expected rendered trust text to include ${expected}.`);
  assert.equal(text.includes('Private_Customer_Name'), false, 'Unexpected reconciliation datasets must not be rendered.');
  assert.equal(card.attributes['aria-busy'], 'false');
  assert.ok(card.attributes['aria-labelledby']);
  assert.ok(card.attributes['aria-describedby']);
});

test('Vercel cron is rendered as externally scheduled without trusting process-local runner flags', () => {
  const health = sampleHealth();
  health.schedule.running = true;
  health.schedule.started = false;
  const text = loadCardFactory()(health, 'home').allText();
  assert.ok(text.includes('Scheduled by Vercel'));
  assert.ok(text.includes('15-minute production cron'));
  assert.ok(text.includes('best effort, no automatic retry'));
  assert.ok(text.includes('next window'));
  assert.equal(text.includes('Running now'), false);
  assert.equal(text.includes('Enabled, not started'), false);
});

test('configured Vercel cron is not presented as operational before the durable state fence is available', () => {
  const health = sampleHealth();
  health.schedule.execution_fenced = false;
  health.schedule.state_available = false;
  const text = loadCardFactory()(health, 'home').allText();
  assert.ok(text.includes('Vercel cron configured · sync safety setup pending'));
  assert.equal(text.includes('Scheduled by Vercel'), false);
});

test('local interval state continues to use process-local started and running flags', () => {
  const health = sampleHealth();
  Object.assign(health.schedule, {
    scheduler_mode: 'local-interval',
    externally_scheduled: false,
    started: true,
    running: true,
  });
  const text = loadCardFactory()(health, 'home').allText();
  assert.ok(text.includes('Running now'));
  assert.ok(text.includes('15-minute local interval'));
  assert.equal(text.includes('Scheduled by Vercel'), false);
});

test('a frozen audit count is labelled and timestamped as audit evidence, never current source', () => {
  const health = sampleHealth();
  Object.assign(health.reconciliation[0], {
    classification: 'ahead_of_audit_recheck_required',
    current_source_count: 67_798,
    source_recheck_at: null,
    exact_source_local_parity: false,
  });
  const card = loadCardFactory()(health, 'home');
  const notesCard = card.findAll('ARTICLE').find(node => node.allText().includes('Notes'));
  assert.ok(notesCard, 'Notes reconciliation card was not rendered.');
  const text = notesCard.allText();
  assert.ok(text.includes('Source at audit'));
  assert.ok(text.includes('67,793'));
  assert.ok(text.includes('Audit recorded'));
  assert.equal(text.includes('Current source'), false);
  assert.equal(text.includes('Source rechecked'), false);
});

test('an unavailable local aggregate is rendered as unavailable, never as a zero record count', () => {
  const health = sampleHealth();
  health.reconciliation[0].classification = 'partial_refresh';
  health.reconciliation[0].current_local_count = null;
  health.reconciliation[0].exact_source_local_parity = false;
  const card = loadCardFactory()(health, 'home');
  const notesCard = card.findAll('ARTICLE').find(node => node.allText().includes('Notes'));
  const text = notesCard.allText();
  assert.ok(text.includes('Local Unavailable'));
  assert.equal(text.includes('Local 0'), false);
});

test('all explicit exclusions are progressively disclosed with accessible live state', () => {
  const card = loadCardFactory()(sampleHealth(), 'analytics');
  const text = card.allText();
  for (const label of ['Deletions', 'Attachments', 'Metadata', 'Reports', 'Dashboards', 'Child datasets']) {
    assert.ok(text.includes(label), `Missing exclusion ${label}.`);
  }
  assert.ok(text.includes('Explicit exclusions · 6 categories'));
  assert.ok(text.includes('unsupported_scope'));
  assert.ok(text.includes('15/16 scheduled modules'));
  assert.ok(text.includes('reversible runtime is staged but disabled'));
  assert.ok(text.includes('partial_refresh'));
  assert.equal(card.findAll('DETAILS').length, 1);
  assert.equal(card.findAll('SUMMARY').length, 1);
  const liveStates = card.findAll('DIV').filter(node => node.attributes.role === 'status');
  assert.equal(liveStates.length, 1);
  assert.equal(liveStates[0].attributes['aria-live'], 'polite');
  assert.equal(liveStates[0].attributes['aria-atomic'], 'true');
});

test('response values use text-safe construction and unavailable health does not block CRM content', () => {
  assert.match(cardSource, /node\.textContent = String\(text\)/);
  assert.doesNotMatch(cardSource, /\.innerHTML\s*=|insertAdjacentHTML|document\.write/);
  assert.match(cardSource, /\.catch\(\(\) => \(\{ available: false, snapshot: null \}\)\)/);
  assert.match(cardSource, /Main CRM content remains available/);
  assert.match(cardSource, /navigationToken !== state\.nav \|\| !slot\.isConnected/);
  assert.match(cardSource, /dataset_key === 'Notes' \|\| item\?\.dataset_key === 'Tasks'/);
});

test('trust cards collapse to readable single-column layouts at 390px and 320px', () => {
  assert.match(styles, /\.replication-trust-overview\s*\{[^}]*repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(styles, /@media \(max-width:620px\)[\s\S]*\.replication-trust-overview,[\s\S]*\.replication-trust-exclusions ul\s*\{ grid-template-columns:1fr; \}/);
  assert.match(styles, /@media \(max-width:420px\)[\s\S]*\.replication-trust-header\s*\{ padding:13px 12px 11px; \}/);
  assert.match(styles, /@media \(max-width:350px\)[\s\S]*\.replication-trust-counts\s*\{ grid-template-columns:1fr; \}/);
  assert.match(styles, /\.replication-trust-exclusions > summary:focus-visible/);
  assert.match(styles, /@media \(prefers-reduced-motion:reduce\)[^}]*\.replication-trust-loading-mark/);
});

test('trust-card labels, status, code, and body copy use an 11px readable minimum', () => {
  const explicitSizes = [...trustStyles.matchAll(/font-size:\s*([0-9.]+)px/g)].map(match => Number(match[1]));
  const shorthandSizes = [...trustStyles.matchAll(/font:\s*\d+\s+([0-9.]+)px\//g)].map(match => Number(match[1]));
  assert.ok(explicitSizes.length > 0 && shorthandSizes.length > 0);
  for (const size of [...explicitSizes, ...shorthandSizes]) {
    assert.ok(size >= 11, `Replication trust typography must be at least 11px; found ${size}px.`);
  }
});
