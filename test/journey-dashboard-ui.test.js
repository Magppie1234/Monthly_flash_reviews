'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const journeyDialogStart = appSource.indexOf('function closeJourneyDrilldown(');
const journeyDialogEnd = appSource.indexOf('function journeyStageCard(', journeyDialogStart);
const journeyDialogSource = appSource.slice(journeyDialogStart, journeyDialogEnd);

test('Home renders the complete modern journey before retaining the operational dashboard', () => {
  assert.match(appSource, /CRM Journey Home/);
  assert.match(appSource, /Lead-to-qualified-opportunity journey/);
  assert.match(appSource, /Current-state aggregates only/);
  assert.match(appSource, /does not claim conversion/);
  assert.match(appSource, /₹Cr \(count\)/);
  assert.match(appSource, /Show all configured stages/);
  assert.match(appSource, /Missing \/ no value/);
  assert.match(appSource, /renderJourneyDashboard\(d\.journey[\s\S]*\/\/ KPI tiles/);
});

test('contributing-record modal carries the same date range and uses accessible controls', () => {
  assert.match(appSource, /api\/dashboard\/journey\/records/);
  assert.match(appSource, /query\.set\('from', state\.dateFilter\.from\)/);
  assert.match(appSource, /query\.set\('to', state\.dateFilter\.to\)/);
  assert.match(appSource, /aria-modal/);
  assert.match(appSource, /Close contributing records/);
  assert.match(appSource, /Open contributing records/);
  assert.match(journeyDialogSource, /modal\.setAttribute\('role', 'dialog'\)/);
  assert.match(journeyDialogSource, /modal\.setAttribute\('aria-labelledby', titleId\)/);
  assert.match(journeyDialogSource, /modal\.removeAttribute\('aria-labelledby'\)/);
  assert.doesNotMatch(journeyDialogSource, /(?:box|\$\('#modalBox'\))\.(?:setAttribute|removeAttribute)\('aria-labelledby'/);
});

test('server journey uses current metadata, hard-allowlisted lanes and exact equality drilldown', () => {
  const drilldownStart = serverSource.indexOf("app.get('/api/dashboard/journey/records/:lane'");
  const drilldownEnd = serverSource.indexOf("\napp.get('*'", drilldownStart);
  const drilldownSource = serverSource.slice(drilldownStart, drilldownEnd);
  assert.match(serverSource, /meta\('fields:Leads', \{ signal \}\)/);
  assert.match(serverSource, /meta\('fields:Contacts', \{ signal \}\)/);
  assert.match(serverSource, /Total_Opportunity_Value/);
  assert.match(drilldownSource, /LANE_DEFINITIONS\[String\(req\.params\.lane/);
  assert.match(drilldownSource, /status = any\(array\[/);
  assert.doesNotMatch(drilldownSource, /req\.query\.field/);
  assert.doesNotMatch(drilldownSource, /req\.query\.module/);
});

test('record mutations invalidate derived dashboards without stale in-flight cache repopulation', () => {
  assert.match(serverSource, /let derivedReadCacheGeneration = 0/);
  assert.match(serverSource, /queuePersistedDashboardCache/);
  assert.match(serverSource, /PERSISTED_DASHBOARD_CACHE_TIMEOUT_MS = 3_000/);
  assert.match(serverSource, /cachedAt > persistedDashboardCacheNotBefore/);
  assert.match(serverSource, /if \(generation === derivedReadCacheGeneration\) \{[\s\S]*queuePersistedDashboardCache/);
  assert.match(serverSource, /if \(generation === derivedReadCacheGeneration\) rangeCache\.set/);
  assert.match(serverSource, /await invalidateDerivedReadCaches\(\{ persistDashboardInvalidation: true \}\)/);
  assert.match(serverSource, /analyticsOverviewGeneration === generation/);
});

test('journey styling includes responsive lanes, cards and drilldown table', () => {
  assert.match(styles, /\.journey-hero\s*\{/);
  assert.match(styles, /\.journey-stage-card:focus-visible/);
  assert.match(styles, /\.journey-drill-scroll\s*\{/);
  assert.match(styles, /@media \(max-width:820px\)[\s\S]*\.journey-bridge\s*\{ grid-template-columns:1fr; \}/);
  assert.match(styles, /@media \(max-width:520px\)[\s\S]*\.journey-stage-grid\s*\{ grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});
