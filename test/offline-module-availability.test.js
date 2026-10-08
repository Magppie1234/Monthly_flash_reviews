'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildMetadata } = require('../scripts/build-offline-snapshot');

test('offline metadata retains uncached modules and exact source view definitions', () => {
  const module = { api_name: 'Visit_Module', plural_label: 'Visit Module', show_as_tab: true };
  const fields = { fields: [{ api_name: 'Name', field_label: 'Visit Name' }] };
  const views = { custom_views: [{ id: '90071992547409931234', name: 'My Visits', criteria: { field: 'Owner' } }] };
  const result = buildMetadata({ local: { modules: [module] }, modules: [{ module, results: { fields: { data: fields }, views: { data: views } } }] });
  assert.deepEqual(result.modules.modules, [module]);
  assert.deepEqual(result.fields.Visit_Module, fields);
  assert.deepEqual(result.captured_views.Visit_Module, views);
  assert.equal(result.views.Visit_Module, undefined, 'unsupported source criteria must not be executable');
});

test('uncached modules remain distinct from empty cached modules on all record routes', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-offline-modules-'));
  fs.mkdirSync(path.join(directory, 'records'), { mode: 0o700 });
  const write = (name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value), { mode: 0o600 });
  write('manifest.json', { schema_version: 2, record_counts: { Leads: 0 }, source_snapshot_at: '2026-09-06T00:00:00Z' });
  write('metadata.json', { modules: { modules: [{ api_name: 'Leads' }, { api_name: 'Visit_Module' }] }, fields: {}, views: {}, layouts: {}, related_lists: {} });
  write('records/Leads.json', []);
  process.env.CRM_OFFLINE_SNAPSHOT_DIR = directory;
  process.env.ACCESS_CODE = 'isolated-test-code';
  const app = require('../server-offline');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { Cookie: 'crm_auth=isolated-test-code' };
  const boot = await (await fetch(`${base}/api/boot`, { headers })).json();
  assert.equal(boot.modules.modules.length, 2);
  assert.equal(boot.zoho, false);
  assert.equal(boot.sync_schedule.enabled, false);
  for (const route of ['/api/records/Visit_Module', '/api/search/Visit_Module', '/api/module_bundle/Visit_Module']) {
    const response = await fetch(base + route, { headers });
    assert.equal(response.status, 200);
    const body = await response.json();
    const records = body.records || body;
    assert.equal(records.reason_code, 'SNAPSHOT_MODULE_DATA_UNAVAILABLE');
    assert.equal(records.info.total, null);
    assert.equal(records.info.total_exact, false);
  }
  assert.equal((await fetch(`${base}/api/record/Visit_Module/123`, { headers })).status, 409);
  const empty = await (await fetch(`${base}/api/records/Leads`, { headers })).json();
  assert.equal(empty.info.total, 0);
  assert.equal(empty.info.total_exact, true);
  assert.equal((await fetch(`${base}/api/records/Unknown`, { headers })).status, 404);
  assert.equal((await fetch(`${base}/api/record/Leads`, { method: 'POST', headers })).status, 409);
  assert.equal((await fetch(`${base}/api/boot`)).status, 401);
});

test('a deployment without a snapshot still serves the Monthly Flash Review', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-offline-absent-'));
  const previous = { dir: process.env.CRM_OFFLINE_SNAPSHOT_DIR, code: process.env.ACCESS_CODE };
  process.env.CRM_OFFLINE_SNAPSHOT_DIR = directory;
  delete process.env.ACCESS_CODE;
  delete require.cache[require.resolve('../server-offline')];
  const app = require('../server-offline');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => {
    server.close();
    fs.rmSync(directory, { recursive: true, force: true });
    delete require.cache[require.resolve('../server-offline')];
    for (const [name, value] of [['CRM_OFFLINE_SNAPSHOT_DIR', previous.dir], ['ACCESS_CODE', previous.code]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const people = await fetch(`${base}/api/flash-review/people`);
  assert.equal(people.status, 200);
  assert.ok(Object.keys((await people.json()).roles).length > 0);
  assert.equal((await fetch(`${base}/api/version`)).status, 200);
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /flash-review\.js/);
  for (const route of ['/api/boot', '/api/dashboard', '/api/records/Leads', '/api/module_bundle/Leads', '/api/meta/org']) {
    const response = await fetch(base + route);
    assert.equal(response.status, 503, route);
    assert.equal((await response.json()).error, 'SNAPSHOT_UNAVAILABLE');
  }
  assert.equal((await fetch(`${base}/api/record/Leads`, { method: 'POST' })).status, 409);
});
