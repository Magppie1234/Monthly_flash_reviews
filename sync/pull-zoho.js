// One-time (re-runnable) full sync: Zoho CRM → Supabase (crm_meta + crm_records).
// Usage: node sync/pull-zoho.js   (reads ../.env for both Zoho + Supabase credentials)
const path = require('path');
const { createZohoOrgGuard, EXPECTED_ZOHO_ZGID } = require('../lib/zoho-org-guard');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ACCOUNTS = process.env.ZOHO_ACCOUNTS_URL;
const API = process.env.ZOHO_API_DOMAIN;
const SUPA = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY;
const SECRET = process.env.CRM_SQL_SECRET;
const SOURCE_ORG_ID = `org${EXPECTED_ZOHO_ZGID}`;

const ALL_MODULES = ['Leads','Contacts','Accounts','Deals','Tasks','Events','Calls','Products','Vendors',
  'Developers','Referral_Partners','Payment_Milestones','Designers','Visit_Module','AMS_Complaints',
  'Service_Managements','Notes'];
const MODULES = process.env.ONLY ? process.env.ONLY.split(',') : ALL_MODULES;
const SKIP_META = !!process.env.ONLY;
const NAME_PRIORITY = ['Full_Name','Deal_Name','Account_Name','Subject','Product_Name','Campaign_Name','Vendor_Name','Case_Subject','Note_Title','Name','Last_Name'];

let tok = null, tokAt = 0;
async function token() {
  if (tok && Date.now() - tokAt < 50 * 60 * 1000) return tok;
  const r = await fetch(`${ACCOUNTS}/oauth/v2/token?refresh_token=${process.env.ZOHO_REFRESH_TOKEN}&client_id=${process.env.ZOHO_CLIENT_ID}&client_secret=${process.env.ZOHO_CLIENT_SECRET}&grant_type=refresh_token`, { method: 'POST' });
  const j = await r.json();
  if (!j.access_token) throw new Error('token: ' + JSON.stringify(j));
  tok = j.access_token; tokAt = Date.now();
  return tok;
}
async function zget(p, retries = 3) {
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(`${API}${p}`, { headers: { Authorization: `Zoho-oauthtoken ${await token()}` } });
      if (r.status === 204) return null;
      if (r.status === 429 || r.status >= 500) { await new Promise(s => setTimeout(s, 2000 * (i + 1))); continue; }
      const j = await r.json().catch(() => null);
      if (r.status >= 400) throw new Error(`${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
      return j;
    } catch (e) { if (i === retries) throw e; await new Promise(s => setTimeout(s, 1500)); }
  }
}
const sourceOrgGuard = createZohoOrgGuard({ loadOrg: () => zget('/crm/v8/org') });
async function rpc(fn, body, retries = 3) {
  for (let i = 0; i <= retries; i++) {
    const r = await fetch(`${SUPA}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.ok) return r.json().catch(() => null);
    const t = await r.text();
    if (i === retries) throw new Error(`${fn} ${r.status}: ${t.slice(0, 300)}`);
    await new Promise(s => setTimeout(s, 2000 * (i + 1)));
  }
}

const log = m => console.log(new Date().toISOString().slice(11, 19), m);

function strip(rec) {
  const out = {};
  for (const [k, v] of Object.entries(rec)) {
    if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) continue;
    out[k] = v;
  }
  return out;
}
function nameOf(rec, fields) {
  for (const n of NAME_PRIORITY) {
    const f = fields.find(x => x.api_name === n);
    if (f && rec[n] != null && typeof rec[n] !== 'object') return String(rec[n]);
    if (rec[n] && typeof rec[n] === 'object' && rec[n].name && n !== 'Account_Name') return rec[n].name;
  }
  return rec.Full_Name || rec.Name || rec.Subject || null;
}
function searchOf(rec, nm) {
  const parts = [nm, rec.Email, rec.Phone, rec.Mobile, rec.Company, rec.Note_Title];
  if (rec.Account_Name?.name) parts.push(rec.Account_Name.name);
  if (rec.Owner?.name) parts.push(rec.Owner.name);
  if (rec.Note_Content) parts.push(String(rec.Note_Content).slice(0, 200));
  return parts.filter(Boolean).join(' ').slice(0, 500);
}

async function syncMeta() {
  log('meta: modules/org/users');
  const mods = await zget('/crm/v8/settings/modules');
  await rpc('crm_meta_upsert', { k: 'modules', d: mods, s: SECRET });
  const org = await zget('/crm/v8/org');
  await rpc('crm_meta_upsert', { k: 'org', d: org, s: SECRET });
  let users = [], upage = 1;
  while (true) {
    const u = await zget(`/crm/v8/users?type=ActiveUsers&per_page=200&page=${upage}`);
    users.push(...(u?.users || []));
    if (!u?.info?.more_records) break; upage++;
  }
  await rpc('crm_meta_upsert', { k: 'users', d: { users }, s: SECRET });

  const fieldsByModule = {};
  for (const m of MODULES) {
    try {
      const f = await zget(`/crm/v8/settings/fields?module=${m}`);
      fieldsByModule[m] = f?.fields || [];
      await rpc('crm_meta_upsert', { k: 'fields:' + m, d: f, s: SECRET });
      const l = await zget(`/crm/v8/settings/layouts?module=${m}`).catch(() => null);
      if (l) await rpc('crm_meta_upsert', { k: 'layouts:' + m, d: l, s: SECRET });
      const rl = await zget(`/crm/v8/settings/related_lists?module=${m}`).catch(() => null);
      if (rl) await rpc('crm_meta_upsert', { k: 'related_lists:' + m, d: rl, s: SECRET });
      const vs = await zget(`/crm/v8/settings/custom_views?module=${m}`).catch(() => null);
      const details = [];
      for (const v of (vs?.custom_views || [])) {
        const vd = await zget(`/crm/v8/settings/custom_views/${v.id}?module=${m}`).catch(() => null);
        const full = vd?.custom_views?.[0];
        details.push(full ? { ...v, ...full } : v);
      }
      await rpc('crm_meta_upsert', { k: 'views:' + m, d: { custom_views: details }, s: SECRET });
      log(`meta: ${m} ok (${fieldsByModule[m].length} fields, ${details.length} views)`);
    } catch (e) { log(`meta: ${m} FAILED ${e.message}`); }
  }
  return fieldsByModule;
}

async function syncModule(m, fields) {
  if (!fields || !fields.length) { log(`${m}: no fields meta, skipped`); return 0; }
  const usable = fields.filter(f => !['subform','fileupload','imageupload','profileimage'].includes(f.data_type) && f.api_name !== 'id');
  const chunks = [];
  for (let i = 0; i < usable.length; i += 45) {
    const set = new Set(usable.slice(i, i + 45).map(f => f.api_name));
    set.add('Created_Time'); set.add('Modified_Time');
    chunks.push([...set]);
  }
  const byId = new Map();
  for (let ci = 0; ci < chunks.length; ci++) {
    const flds = chunks[ci].join(',');
    let pageToken = null, page = 1, got = 0;
    while (true) {
      const q = pageToken
        ? `fields=${encodeURIComponent(flds)}&per_page=200&page_token=${pageToken}`
        : `fields=${encodeURIComponent(flds)}&per_page=200&page=1`;
      let d;
      try { d = await zget(`/crm/v8/${m}?${q}`); } catch (e) { log(`${m} chunk${ci} page${page} ERR ${e.message}`); break; }
      const rows = d?.data || [];
      rows.forEach(r => {
        const prev = byId.get(r.id) || {};
        byId.set(r.id, { ...prev, ...strip(r) });
      });
      got += rows.length;
      if (!d?.info?.more_records || !d?.info?.next_page_token) break;
      pageToken = d.info.next_page_token; page++;
      if (page % 25 === 0) log(`${m}: chunk ${ci + 1}/${chunks.length} page ${page} (${got})`);
    }
    log(`${m}: chunk ${ci + 1}/${chunks.length} done — ${got} rows`);
  }
  // upload
  const all = [...byId.values()];
  const sourceSeenAt = new Date().toISOString();
  let up = 0;
  for (let i = 0; i < all.length; i += 400) {
    const batch = all.slice(i, i + 400).map(rec => {
      const nm = nameOf(rec, fields);
      return {
        module: m, id: rec.id, data: rec, name: nm, search_text: searchOf(rec, nm),
        created_time: rec.Created_Time || null, modified_time: rec.Modified_Time || null,
        source_org_id: SOURCE_ORG_ID, source_seen_at: sourceSeenAt,
      };
    });
    await rpc('crm_bulk_upsert', { rows: batch, s: SECRET });
    up += batch.length;
    if ((i / 400) % 10 === 0) log(`${m}: uploaded ${up}/${all.length}`);
  }
  log(`${m}: DONE — ${all.length} records`);
  return all.length;
}

(async () => {
  const t0 = Date.now();
  await sourceOrgGuard.assertExpectedOrg();
  let fieldsByModule;
  if (SKIP_META) {
    fieldsByModule = {};
    for (const m of MODULES) {
      const f = await zget(`/crm/v8/settings/fields?module=${m}`);
      fieldsByModule[m] = f?.fields || [];
    }
  } else {
    fieldsByModule = await syncMeta();
  }
  const counts = {};
  for (const m of MODULES) {
    try { counts[m] = await syncModule(m, fieldsByModule[m]); }
    catch (e) { log(`${m}: FAILED ${e.message}`); counts[m] = 'ERR: ' + e.message; }
  }
  await rpc('crm_meta_upsert', { k: 'sync_info', d: { at: new Date().toISOString(), counts }, s: SECRET });
  log('ALL DONE in ' + Math.round((Date.now() - t0) / 1000) + 's — ' + JSON.stringify(counts));
})();
