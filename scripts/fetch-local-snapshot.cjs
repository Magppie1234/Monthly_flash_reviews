'use strict';
// Read-only Zoho download for the existing local snapshot server.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(root, '.env') });
const out = path.join(root, '.private', 'offline-snapshot');
const modules = ['Leads', 'Contacts', 'Deals', 'Tasks', 'Calls'];
let token;
async function get(route) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(`${process.env.ZOHO_API_DOMAIN}/crm/v8/${route}`, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` }, signal: AbortSignal.timeout(60000),
    });
    if (response.status === 204) return {};
    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1))); continue;
    }
    const data = await response.json();
    if (!response.ok) throw new Error(`Zoho HTTP ${response.status}: ${data.code || 'request failed'}`);
    return data;
  }
}
function write(name, data) {
  const file = path.join(out, name);
  const bytes = JSON.stringify(data);
  fs.writeFileSync(file + '.tmp', bytes, { mode: 0o600 });
  fs.renameSync(file + '.tmp', file);
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
async function main() {
  if (process.env.ZOHO_ACCOUNTS_URL !== 'https://accounts.zoho.in' || process.env.ZOHO_API_DOMAIN !== 'https://www.zohoapis.in') throw new Error('Unexpected Zoho host');
  const response = await fetch(`${process.env.ZOHO_ACCOUNTS_URL}/oauth/v2/token`, {
    method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', client_id: process.env.ZOHO_CLIENT_ID,
      client_secret: process.env.ZOHO_CLIENT_SECRET, refresh_token: process.env.ZOHO_REFRESH_TOKEN }),
    signal: AbortSignal.timeout(30000),
  });
  token = (await response.json()).access_token;
  if (!token) throw new Error('Token refresh failed');
  const org = await get('org');
  if (org.org?.length !== 1 || String(org.org[0].zgid) !== '60046349006') throw new Error('Organization mismatch');
  fs.mkdirSync(path.join(out, 'records'), { recursive: true, mode: 0o700 });
  const metadata = { org, modules: await get('settings/modules'), fields: {}, layouts: {}, views: {}, related_lists: {}, captured_views: {} };
  const manifest = { schema_version: 4, source_org_id: '60046349006', generated_at: new Date().toISOString(),
    source_snapshot_at: new Date().toISOString(), source_mode: 'zoho-read-only-download', external_sync_enabled: false,
    external_writes_enabled: false, record_counts: {}, record_sha256: {}, module_origins: {}, module_availability: {},
    limitations: ['Only Leads, Contacts, Deals, Tasks and Calls are downloaded. Attachments and subforms are not included. Local snapshot does not refresh automatically.'] };
  for (const name of modules) {
    metadata.fields[name] = await get(`settings/fields?module=${name}`);
    metadata.layouts[name] = { layouts: [] };
    metadata.related_lists[name] = { related_lists: [] };
    const fields = metadata.fields[name].fields.filter(f => !['subform', 'fileupload', 'imageupload', 'profileimage'].includes(f.data_type) && f.api_name !== 'id').map(f => f.api_name);
    metadata.views[name] = { custom_views: [{ id: `local-${name}`, name: 'Local snapshot', display_value: 'Local snapshot', default: true, criteria: null, fields: fields.slice(0, 8) }] };
    const byId = new Map();
    for (let offset = 0; offset < fields.length; offset += 45) {
      const selected = fields.slice(offset, offset + 45);
      let pageToken, page = 1;
      do {
        const query = new URLSearchParams({ fields: selected.join(','), per_page: '200' });
        if (pageToken) query.set('page_token', pageToken); else query.set('page', String(page));
        const data = await get(`${name}?${query}`);
        for (const row of data.data || []) {
          if (!/^1032257\d+$/.test(row.id)) throw new Error('Record namespace mismatch');
          byId.set(row.id, { ...byId.get(row.id), ...row });
        }
        if (!data.info?.more_records) break;
        pageToken = data.info.next_page_token;
        page++;
        if (!pageToken && page > 10) throw new Error('Missing pagination token');
        if (page % 25 === 0) console.log(`${name}: field batch ${1 + offset / 45}, page ${page}`);
      } while (true);
      console.log(`${name}: field batch ${1 + offset / 45}/${Math.ceil(fields.length / 45)}, ${byId.size} records`);
    }
    const rows = [...byId.values()];
    manifest.record_counts[name] = rows.length;
    manifest.record_sha256[name] = write(`records/${name}.json`, rows);
    manifest.module_origins[name] = { source_kind: 'zoho-read-only-api', source_org_id: manifest.source_org_id, record_count: rows.length, source_reconciled: false };
  }
  for (const mod of metadata.modules.modules) manifest.module_availability[mod.api_name] = {
    metadata_captured: !!metadata.fields[mod.api_name], records_available: modules.includes(mod.api_name),
    cached_record_count: manifest.record_counts[mod.api_name] ?? null, source_reconciled: false,
  };
  write('metadata.json', metadata);
  write('manifest.json', manifest);
  console.log('Snapshot ready: ' + JSON.stringify(manifest.record_counts));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
