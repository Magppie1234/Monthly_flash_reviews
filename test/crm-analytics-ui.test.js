'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const overviewServiceSource = fs.readFileSync(path.join(root, 'lib', 'crm-analytics-overview.js'), 'utf8');

const start = appSource.indexOf('/* ---------- analytics command center ---------- */');
const end = appSource.indexOf('/* ---------- dashboard ---------- */', start);
assert.ok(start >= 0 && end > start, 'Analytics UI source was not found.');
const analyticsSource = appSource.slice(start, end);

test('Analytics is a first-class route backed by the bounded overview service', () => {
  assert.match(appSource, /dataset\.mod = '__analytics'/);
  assert.match(appSource, /#\/analytics/);
  assert.match(appSource, /parts\[0\] === 'analytics'/);
  assert.match(serverSource, /createAnalyticsOverviewService\(\{ readOnlyQuery: sql \}\)/);
  assert.match(serverSource, /app\.get\('\/api\/analytics\/overview'/);
  assert.doesNotMatch(serverSource, /app\.post\('\/api\/analytics\/overview'/);
});

test('cold Analytics and assistant scope reads share one coordinator without gating cache hits', () => {
  assert.match(serverSource, /const coldReadCoordinator = createColdReadCoordinator\(\)/);
  assert.match(serverSource, /runScopeLoad: \(task, generation\) => coldReadCoordinator\.runAssistantScope\(generation, task\)/);
  assert.match(serverSource, /app\.post\('\/api\/meta\/refresh'[\s\S]*crmAgentRouteService\.invalidateMetadataCache\(\)/);
  assert.match(serverSource, /coldReadCoordinator\.runAnalytics\(flightKey, \(\) => analyticsOverviewService\.overview\(canonicalInput\)\)/);
  const cacheHitCheck = serverSource.indexOf('if (hit && age < ANALYTICS_CACHE_MS) return hit.data;');
  const inFlightCheck = serverSource.indexOf('if (analyticsOverviewInFlight.has(flightKey)) return analyticsOverviewInFlight.get(flightKey);');
  const coordinatedLoad = serverSource.indexOf('coldReadCoordinator.runAnalytics(flightKey');
  assert.ok(cacheHitCheck >= 0 && cacheHitCheck < coordinatedLoad, 'fresh Analytics cache hits must bypass the coordinator');
  assert.ok(inFlightCheck >= 0 && inFlightCheck < coordinatedLoad, 'same-range Analytics callers must share in-flight work before the coordinator');
  assert.doesNotMatch(serverSource, /statement_timeout\s*=/i);
  assert.match(overviewServiceSource, /MAX_ANALYTICS_SOURCE_ATTEMPTS = LOCAL_READ_MAX_ATTEMPTS/);
  assert.match(overviewServiceSource, /isRetryableAnalyticsStatementTimeout/);
});

test('Analytics renders decision sections and preserves Data Not Available semantics', () => {
  assert.match(analyticsSource, /Analytics Command Center/);
  assert.match(analyticsSource, /Current pipeline and cohort mix/);
  assert.match(analyticsSource, /Compared with the previous equal period/);
  assert.match(analyticsSource, /data\.datasets\?\.period_comparison/);
  assert.match(analyticsSource, /immediately preceding/);
  assert.match(analyticsSource, /Percentage: Data Not Available/);
  assert.match(analyticsSource, /Calls and meetings by day/);
  assert.match(analyticsSource, /Task health/);
  assert.match(analyticsSource, /Data quality & reconciliation/);
  assert.match(analyticsSource, /What this dashboard does not claim/);
  assert.match(analyticsSource, /Data Not Available/);
  assert.match(analyticsSource, /No conversion, attribution, or stage movement is inferred/);
  assert.doesNotMatch(analyticsSource, /recentLeads|recentDeals|Full_Name|Email|Phone|Mobile|Owner/);
});

test('Analytics UI is responsive, accessible, and uses text-safe rendering', () => {
  assert.match(analyticsSource, /setAttribute\('aria-label', 'Executive CRM metrics'\)/);
  assert.match(analyticsSource, /setAttribute\('aria-label', 'Period-over-period CRM activity comparison'\)/);
  assert.match(analyticsSource, /node\.textContent = String\(text\)/);
  assert.doesNotMatch(analyticsSource, /insertAdjacentHTML|document\.write/);
  assert.match(styles, /\.analytics-hero\s*\{/);
  assert.match(styles, /\.analytics-metric:focus-visible/);
  assert.match(styles, /\.analytics-comparison-grid\s*\{[^}]*repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.analytics-comparison-card:focus-visible/);
  assert.match(styles, /@media \(max-width:900px\)[\s\S]*\.analytics-comparison-grid/);
  assert.match(styles, /@media \(max-width:600px\)[\s\S]*\.analytics-comparison-grid\s*\{[^}]*grid-template-columns:1fr/);
  assert.match(styles, /@media \(max-width:600px\)[\s\S]*\.analytics-metrics/);
  assert.match(styles, /@media \(max-width:350px\)[\s\S]*\.analytics-metrics/);
});
