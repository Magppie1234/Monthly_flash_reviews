'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { CustomViewFilterError, compileCustomViewFilter } = require('../lib/custom-view-filter');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function noop() {}).constructor;

function routeBody(route) {
  const marker = `app.get('${route}', (req, res) => wrap(res, async () => {`;
  const start = server.indexOf(marker);
  assert.notEqual(start, -1, `${route} route is missing`);
  const bodyStart = start + marker.length;
  const end = server.indexOf('\n}));', bodyStart);
  assert.notEqual(end, -1, `${route} route terminator is missing`);
  return server.slice(bodyStart, end);
}

const moduleBundleBody = routeBody('/api/module_bundle/:module');
const runModuleBundleRoute = new AsyncFunction(
  'req', 'ident', 'meta', 'customViewSQL', 'CustomViewFilterError', 'listRecords',
  moduleBundleBody,
);

function moduleBundleHarness({ fields, views, query = {}, customViewSQL, listRecords }) {
  const calls = { customViewSQL: 0, listRecords: 0 };
  const promise = runModuleBundleRoute(
    { params: { module: 'Leads' }, query },
    value => String(value),
    async key => {
      if (key === 'fields:Leads') return fields;
      if (key === 'views:Leads') return views;
      throw new Error(`Unexpected metadata key: ${key}`);
    },
    async (...args) => {
      calls.customViewSQL += 1;
      return customViewSQL(...args);
    },
    CustomViewFilterError,
    async (...args) => {
      calls.listRecords += 1;
      return listRecords(...args);
    },
  );
  return { calls, promise };
}

const usableFields = { fields: [{ api_name: 'Status', data_type: 'picklist' }] };

test('implicit missing criteria returns unresolved null data and never enters listRecords', async () => {
  const sourceView = { id: 'source-default', name: 'My Leads', default: true };
  const run = moduleBundleHarness({
    fields: usableFields,
    views: { custom_views: [sourceView] },
    customViewSQL: async () => {
      throw new CustomViewFilterError('Captured criteria are unavailable.', {
        code: 'CUSTOM_VIEW_CRITERIA_UNAVAILABLE',
        status: 422,
      });
    },
    listRecords: async () => ({ data: [{ id: 'must-not-be-returned' }], info: { count: 1 } }),
  });

  const result = await run.promise;
  assert.equal(run.calls.customViewSQL, 1);
  assert.equal(run.calls.listRecords, 0);
  assert.equal(result.cvid, null);
  assert.deepEqual(result.records, {
    availability: 'unresolved',
    reason_code: 'CUSTOM_VIEW_CRITERIA_UNAVAILABLE',
    message: 'The captured source view does not include an executable criterion body. Records are not treated as unfiltered.',
    data: null,
    info: null,
  });
  assert.deepEqual(result.view_fallback, {
    applied: false,
    availability: 'unresolved',
    reason_code: 'LOCAL_DEFAULT_VIEW_CRITERIA_UNAVAILABLE',
    source_view_name: 'My Leads',
    selected_view_name: null,
  });
});

test('configuration-missing modules remain unresolved and never inspect criteria or records', async () => {
  const cases = [
    {
      name: 'fields missing',
      fields: { fields: [] },
      views: { custom_views: [{ id: 'all', name: 'All Leads', default: true, criteria: null }] },
    },
    {
      name: 'views missing',
      fields: usableFields,
      views: { custom_views: [] },
    },
  ];

  for (const fixture of cases) {
    const run = moduleBundleHarness({
      fields: fixture.fields,
      views: fixture.views,
      customViewSQL: async () => { throw new Error('criteria query must not run'); },
      listRecords: async () => { throw new Error('record query must not run'); },
    });
    const result = await run.promise;
    assert.equal(run.calls.customViewSQL, 0, fixture.name);
    assert.equal(run.calls.listRecords, 0, fixture.name);
    assert.equal(result.cvid, null, fixture.name);
    assert.equal(result.records.availability, 'unresolved', fixture.name);
    assert.equal(result.records.reason_code, 'MODULE_CONFIGURATION_UNAVAILABLE', fixture.name);
    assert.equal(result.records.data, null, fixture.name);
    assert.equal(result.records.info, null, fixture.name);
    assert.deepEqual(result.view_fallback, {
      applied: false,
      availability: 'unresolved',
      reason_code: 'MODULE_CONFIGURATION_UNAVAILABLE',
      source_view_name: null,
      selected_view_name: null,
    }, fixture.name);
  }
});

test('explicit unsupported view selections bypass fallback and preserve the compiler 422', async () => {
  const selectedView = {
    id: 'selected',
    name: 'Current User Leads',
    default: true,
    criteria: { field: { api_name: 'Status' }, comparator: 'equal', value: '${CURRENTUSER}' },
  };
  const views = { custom_views: [selectedView] };
  const run = moduleBundleHarness({
    fields: usableFields,
    views,
    query: { cvid: 'selected' },
    customViewSQL: async () => { throw new Error('implicit fallback preflight must not run'); },
    listRecords: async (module, options) => compileCustomViewFilter({
      module,
      cvid: options.cvid,
      views: views.custom_views,
      fields: usableFields.fields,
    }),
  });

  await assert.rejects(run.promise, error => {
    assert.equal(error instanceof CustomViewFilterError, true);
    assert.equal(error.code, 'CUSTOM_VIEW_CRITERIA_UNSUPPORTED');
    assert.equal(error.status, 422);
    return true;
  });
  assert.equal(run.calls.customViewSQL, 0);
  assert.equal(run.calls.listRecords, 1);
});

test('boot metadata hydration version invalidates persisted browser metadata', async () => {
  const bootBody = routeBody('/api/boot');
  const runBootRoute = new AsyncFunction(
    'meta', 'BUILD', 'ZOHO_ON', 'ZOHO_SOURCE_MODE', 'publicDeltaSyncStatus', 'blueprintConfig', 'activeBlueprintFor',
    bootBody,
  );
  const requestedKeys = [];
  const boot = await runBootRoute(
    async key => {
      requestedKeys.push(key);
      if (key === 'modules') return { modules: [] };
      if (key === 'org') return { org: [] };
      if (key === 'sync_info') return { at: 'older-record-sync-version' };
      if (key === 'captured_metadata_hydration') return { applied_at: 'hydrated-metadata-v2' };
      throw new Error(`Unexpected metadata key: ${key}`);
    },
    'build-version', false, 'read-only', () => ({ enabled: false }), { blueprints: [] }, () => null,
  );
  assert.ok(requestedKeys.includes('captured_metadata_hydration'));
  assert.equal(boot.metadata_version, 'hydrated-metadata-v2');

  const loadStart = app.indexOf('function loadMetaFromStore(mod)');
  const persistStart = app.indexOf('function persistMeta(mod)', loadStart);
  const prefetchStart = app.indexOf('function prefetchModule(m)', persistStart);
  assert.ok(loadStart >= 0 && persistStart > loadStart && prefetchStart > persistStart);
  const cacheFunctions = app.slice(loadStart, prefetchStart);
  assert.match(app, /state\.syncAt = b\.metadata_version \|\| b\.sync_info\?\.at \|\| 'unknown';/);
  assert.match(cacheFunctions, /st\.at === state\.syncAt/);
  assert.match(cacheFunctions, /at: state\.syncAt/);

  const stored = new Map();
  const context = vm.createContext({
    state: { fields: {}, views: {}, layouts: {}, syncAt: boot.metadata_version },
    localStorage: {
      getItem: key => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, String(value)),
      removeItem: key => stored.delete(key),
    },
  });
  vm.runInContext(`${cacheFunctions}\nglobalThis.cacheApi = { loadMetaFromStore, persistMeta };`, context);

  stored.set('crm_meta_Leads', JSON.stringify({
    at: 'hydrated-metadata-v1',
    fields: [{ api_name: 'Stale_Field' }],
    views: [],
  }));
  assert.equal(context.cacheApi.loadMetaFromStore('Leads'), false);
  assert.equal(context.state.fields.Leads, undefined);

  stored.set('crm_meta_Leads', JSON.stringify({
    at: boot.metadata_version,
    fields: [{ api_name: 'Current_Field' }],
    views: [{ id: 'current-view' }],
  }));
  assert.equal(context.cacheApi.loadMetaFromStore('Leads'), true);
  assert.equal(context.state.fields.Leads[0].api_name, 'Current_Field');

  context.state.fields.Contacts = [{ api_name: 'Full_Name' }];
  context.state.views.Contacts = [{ id: 'all-contacts' }];
  context.cacheApi.persistMeta('Contacts');
  const persisted = JSON.parse(stored.get('crm_meta_Contacts'));
  assert.equal(persisted.at, boot.metadata_version);
});

test('fallback disclosure remains explicit in the list UI', () => {
  assert.match(app, /b\.view_fallback \|\| null/);
  assert.match(app, /viewFallback\?\.applied === true/);
  assert.match(app, /needs a mapped user or unsupported source-relative criterion/);
  assert.match(app, /Records remain unavailable rather than being shown as an unfiltered list/);
  assert.match(app, /recordAvailability\?\.availability === 'unresolved'/);
  assert.match(app, /No record query was executed and no empty result is claimed/);
  assert.match(styles, /\.view-fallback-notice\s*\{/);
});

test('interactive module bundles use indexed order and never start exact count jobs', () => {
  const listStart = server.indexOf('async function listRecords');
  const routeStart = server.indexOf("app.get('/api/module_bundle/:module'");
  const listSource = server.slice(listStart, routeStart);
  assert.match(listSource, /let order = 'modified_time desc';/);
  assert.doesNotMatch(listSource, /let order = 'modified_time desc nulls last';/);
  assert.match(listSource, /qy\.schedule_count !== false/);
  assert.match(moduleBundleBody, /schedule_count: false/);
});
