'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const computeStart = source.indexOf('async function computeHomeDashboard(');
const computeEnd = source.indexOf('\nconst HOME_DASHBOARD_FRESH_TTL_MS', computeStart);
const computeSource = source.slice(computeStart, computeEnd);
const seedStart = source.indexOf('function seedHomeDashboardFromPersistedCache(');
const seedEnd = source.indexOf("\napp.get('/api/dashboard'", seedStart);
const seedSource = source.slice(seedStart, seedEnd);
const routeStart = source.indexOf("app.get('/api/dashboard'");
const routeEnd = source.indexOf('\nasync function rangedDashboard(', routeStart);
const routeSource = source.slice(routeStart, routeEnd);

test('Home route is backed by the bounded single-flight SWR/LKG service', () => {
  assert.match(source, /createHomeDashboardService/);
  assert.match(source, /const HOME_DASHBOARD_COMPUTE_TIMEOUT_MS = 20_000/);
  assert.match(source, /computeTimeoutMs: HOME_DASHBOARD_COMPUTE_TIMEOUT_MS/);
  assert.match(source, /freshTtlMs: HOME_DASHBOARD_FRESH_TTL_MS/);
  assert.match(routeSource, /await seedHomeDashboardFromPersistedCache\(\)/);
  assert.match(routeSource, /homeDashboardService\.refresh\(\)/);
  assert.match(routeSource, /homeDashboardService\.get\(\)/);
  assert.doesNotMatch(routeSource, /dashCache/);
});

test('Home computation preserves the established payload and passes one abort signal to every database read', () => {
  assert.ok(computeStart >= 0 && computeEnd > computeStart);
  assert.match(computeSource, /async function computeHomeDashboard\(\{ signal, generation \}\)/);
  assert.match(computeSource, /await sql\(q, \{ signal \}\)/);
  assert.match(computeSource, /meta\('sync_info', \{ signal \}\)/);
  assert.match(computeSource, /attachJourneyDashboard\(r, \{ generatedAt, snapshotAt, signal \}\)/);
  for (const key of [
    'generated_at', 'snapshot_at', 'today', 'kpis', 'leadsByStatus', 'dealsByStage',
    'contactsByStatus', 'leadsBySource', 'tasksOpen', 'trend', 'recentLeads',
    'recentDeals', 'taskList', 'journey',
  ]) assert.match(computeSource, new RegExp(`\\b${key}\\b`));
});

test('persisted dash_cache seeding is bounded, generation-safe, and rejects invalidated values', () => {
  assert.ok(seedStart >= 0 && seedEnd > seedStart);
  assert.match(seedSource, /persistedDashboardSeedFlight\?\.generation === generation/);
  assert.match(seedSource, /setTimeout\(\(\) => controller\.abort\(\), PERSISTED_DASHBOARD_CACHE_TIMEOUT_MS\)/);
  assert.match(seedSource, /meta_nocache\('dash_cache', \{ signal: controller\.signal \}\)/);
  assert.match(source, /cached\?\.invalidated !== true/);
  assert.match(source, /cachedAt > persistedDashboardCacheNotBefore/);
  assert.match(source, /homeDashboardService\.status\(\)\.generation === generation/);
  assert.match(seedSource, /homeDashboardService\.seed\(cached\.data, \{ storedAt: cachedAt \}\)/);
  assert.match(seedSource, /\.catch\(\(\) => false\)/);
});

test('dataset invalidation cancels stale seed work and advances the Home service generation', () => {
  const invalidationStart = source.indexOf('function invalidateDerivedReadCaches(');
  const invalidationEnd = source.indexOf('\nasync function cachedAnalyticsOverview(', invalidationStart);
  const invalidationSource = source.slice(invalidationStart, invalidationEnd);
  assert.match(invalidationSource, /derivedReadCacheGeneration \+= 1/);
  assert.match(invalidationSource, /persistedDashboardSeedFlight\.controller\.abort\(\)/);
  assert.match(
    invalidationSource,
    /homeDashboardService\.invalidate\(\{\s*dropLastKnownGood: dropDashboardLastKnownGood,?\s*\}\)/,
  );
  assert.match(invalidationSource, /invalidated: true, data: null/);
  assert.match(computeSource, /generation === derivedReadCacheGeneration/);
  assert.match(computeSource, /invalidated: false, data/);
});
