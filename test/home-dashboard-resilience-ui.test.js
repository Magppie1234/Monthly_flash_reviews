'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const start = appSource.indexOf('function homeDashboardRefreshButton()');
const end = appSource.indexOf('/* ---------- metadata helpers ---------- */', start);
assert.ok(start >= 0 && end > start, 'Home dashboard resilience source was not found.');
const homeSource = appSource.slice(start, end);
const renderStart = homeSource.indexOf('async function renderDashboard()');
const renderSource = homeSource.slice(renderStart);

test('Home paints a useful shell before awaiting the current dashboard response', () => {
  assert.match(homeSource, /function renderHomeDashboardShell\(/);
  assert.match(homeSource, /CRM Journey Home/);
  assert.match(homeSource, /Lead Status options/);
  assert.match(homeSource, /Current Lead and qualified-opportunity status insights will appear here/);
  assert.ok(
    renderSource.indexOf('renderHomeDashboardShell(c, replicationHealthRequest, nav)')
      < renderSource.indexOf("await api('/api/dashboard?x=1'"),
    'The immediate shell must paint before the dashboard request is awaited.',
  );
  assert.doesNotMatch(renderSource, /Loading dashboard/);
});

test('saved content paints immediately and remains visible while hydration runs', () => {
  assert.match(renderSource, /sessionStorage\.getItem\(dkey\)/);
  assert.match(renderSource, /if \(cached\) \{ try \{ build\(cached\); painted = true;/);
  assert.match(renderSource, /if \(painted\) placeHomeDashboardNotice\(c, 'loading', true\)/);
  assert.match(homeSource, /Showing the saved dashboard while a current snapshot loads/);
  assert.match(renderSource, /else clearHomeDashboardNotice\(c\)/);
});

test('Home failures use fixed privacy-safe copy and expose a clear retry action', () => {
  assert.match(homeSource, /Home dashboard temporarily unavailable/);
  assert.match(homeSource, /The saved dashboard remains available/);
  assert.match(homeSource, /CRM data was not changed/);
  assert.match(homeSource, /Try again/);
  assert.match(homeSource, /retry\.onclick = \(\) => renderDashboard\(\)/);
  assert.doesNotMatch(renderSource, /(?:e|error)\.message/);
  assert.doesNotMatch(renderSource, /Dashboard failed/);
});

test('Home refresh, loading and error controls are accessible', () => {
  assert.match(homeSource, /aria-label', 'Refresh Home dashboard'/);
  assert.match(homeSource, /notice\.setAttribute\('role', failed \? 'alert' : 'status'\)/);
  assert.match(homeSource, /notice\.setAttribute\('aria-live', failed \? 'assertive' : 'polite'\)/);
  assert.match(homeSource, /wrap\.setAttribute\('aria-busy', 'true'\)/);
  assert.match(styles, /\.home-dashboard-refresh:focus-visible,\.home-dashboard-retry:focus-visible/);
});

test('Home loading and failure layouts avoid clipping at desktop, 390px and 320px', () => {
  assert.match(styles, /\.home-dashboard-notice \{[^}]*min-width:0/);
  assert.match(styles, /\.home-dashboard-notice-copy strong,\.home-dashboard-notice-copy p \{[^}]*overflow-wrap:anywhere/);
  assert.match(styles, /@media \(max-width: 420px\)[\s\S]*\.home-dashboard-notice \{ display:grid; grid-template-columns:auto minmax\(0,1fr\)/);
  assert.match(styles, /@media \(max-width: 350px\)[\s\S]*\.home-dashboard-skeleton-tiles \{ grid-template-columns:1fr; \}/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.home-dashboard-notice-mark,\.home-dashboard-skeleton-value \{ animation:none; \}/);
});

test('contributing-record drilldown never renders raw request details', () => {
  assert.match(appSource, /Contributing records are temporarily unavailable\. Close this panel and try again\./);
  assert.doesNotMatch(appSource, /Could not load contributing records: \$\{error\.message\}/);
});
