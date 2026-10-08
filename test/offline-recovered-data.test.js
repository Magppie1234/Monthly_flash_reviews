'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { loadRecoveredExports, assertTargetRecordNamespace } = require('../scripts/build-offline-snapshot');

test('target-org recovery rejects the unrelated dashboard record namespace', () => {
  assert.doesNotThrow(() => assertTargetRecordNamespace({ Calls: [{ id: '1032257000001234567' }] }));
  assert.throws(() => assertTargetRecordNamespace({ Calls: [{ id: '887064000000123456' }] }), /organisation namespace/);
  assert.throws(() => assertTargetRecordNamespace({ Leads: [{ id: 1032257000001234567 }] }), /organisation namespace/);
});

test('recovered payloads require exact organisation, module identity, checksum, and unique IDs', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-recovery-contract-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'records'));
  const bytes = JSON.stringify([{ id: '90071992547409931234', Name: 'Test visit' }]);
  fs.writeFileSync(path.join(dir, 'records/Visit_Module.json'), bytes);
  const manifest = { schema_version: 1, source_org_id: '60046349006', modules: { Visit_Module: {
    module_id: '12345678', record_count: 1, payload_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  } } };
  const write = () => fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  const discovery = { organization: { data: { org: [{ zgid: '60046349006' }] } }, local: { modules: [{ api_name: 'Visit_Module', id: '12345678' }] } };
  write();
  assert.equal(loadRecoveredExports(dir, discovery).records.Visit_Module[0].id, '90071992547409931234');
  manifest.source_org_id = 'different-org'; write();
  assert.throws(() => loadRecoveredExports(dir, discovery), /organisation/);
  manifest.source_org_id = '60046349006';
  manifest.modules.Visit_Module.module_id = 'different-module'; write();
  assert.throws(() => loadRecoveredExports(dir, discovery), /identity/);
  manifest.modules.Visit_Module.module_id = '12345678'; write();
  fs.appendFileSync(path.join(dir, 'records/Visit_Module.json'), ' ');
  assert.throws(() => loadRecoveredExports(dir, discovery), /checksum/);
});

test('historical related records use exact source lookup and preserve pagination and provenance', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-recovered-api-'));
  fs.mkdirSync(path.join(dir, 'records'), { mode: 0o700 });
  const write = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value), { mode: 0o600 });
  write('manifest.json', { schema_version: 3, source_snapshot_at: '2026-09-06', record_counts: { Contacts: 1, Visit_Module: 3, Product_Details1: 1 },
    module_origins: { Visit_Module: { export_date: '2026-08-08', source_kind: 'provided-historical-export' }, Product_Details1: { export_date: '2026-08-09' } } });
  write('metadata.json', { modules: { modules: [{ api_name: 'Contacts' }, { api_name: 'Visit_Module' }] }, views: {}, layouts: {},
    fields: {
      Contacts: { fields: [{ api_name: 'Product_Details1', data_type: 'subform', associated_module: { module: 'Product_Details1' } }] },
      Product_Details1: { fields: [{ api_name: 'Parent_Id', data_type: 'lookup', lookup: { module: { api_name: 'Contacts' } } }] },
      Visit_Module: { fields: [{ api_name: 'Client_Name', data_type: 'lookup', lookup: { module: { api_name: 'Contacts' }, api_name: 'All_Services' } }] } },
    related_lists: { Contacts: { related_lists: [
      { api_name: 'All_Services', module: { api_name: 'Visit_Module' } },
      { api_name: 'Wrong_Sibling', module: { api_name: 'Visit_Module' } },
    ] } } });
  write('records/Contacts.json', [{ id: '90071992547409931234' }]);
  write('records/Product_Details1.json', [{ id: '100000004', Parent_Id: { id: '90071992547409931234' }, Quantity: '2' }]);
  write('records/Visit_Module.json', [
    { id: '100000001', Client_Name: { id: '90071992547409931234' } },
    { id: '100000002', Client_Name: { id: '90071992547409931234' } },
    { id: '100000003', Client_Name: { id: '90071992547409931235' } },
  ]);
  process.env.CRM_OFFLINE_SNAPSHOT_DIR = dir;
  process.env.ACCESS_CODE = 'fixture-access';
  const app = require('../server-offline');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async route => (await fetch(base + route, { headers: { Cookie: 'crm_auth=fixture-access' } })).json();
  const first = await get('/api/related/Contacts/90071992547409931234/All_Services?per_page=1');
  assert.equal(first.availability, 'queryable');
  assert.equal(first.data.length, 1);
  assert.equal(first.data[0].id, '100000001');
  assert.equal(first.pagination.total, 2);
  assert.equal(first.pagination.has_more, true);
  assert.equal(first.snapshot_origin.export_date, '2026-08-08');
  const second = await get('/api/related/Contacts/90071992547409931234/All_Services?per_page=1&page=2');
  assert.equal(second.data[0].id, '100000002');
  assert.equal(second.pagination.has_more, false);
  assert.equal((await get('/api/related/Contacts/90071992547409931234/Wrong_Sibling')).availability, 'unresolved');
  assert.equal((await get('/api/related/Contacts/90071992547409931235/All_Services')).availability, 'unresolved');
  assert.equal((await get('/api/records/Visit_Module')).snapshot_origin.export_date, '2026-08-08');
  assert.equal((await get('/api/record/Visit_Module/100000001')).snapshot_origin.export_date, '2026-08-08');
  assert.equal((await get('/api/record/Contacts/90071992547409931234')).data[0].Product_Details1[0].Quantity, '2');
  assert.equal((await get('/api/records/Contacts')).data[0].Product_Details1, undefined, 'record expansion must not mutate stored payload');
});
