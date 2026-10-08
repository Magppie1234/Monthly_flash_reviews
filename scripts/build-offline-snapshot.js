'use strict';

// Builds a private, read-only CRM snapshot from genuine caches already present
// on this machine. No network request is made by this script.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const requestedOutput = process.env.CRM_SNAPSHOT_OUTPUT || path.join('.private', 'offline-snapshot');
const OUTPUT = path.resolve(ROOT, requestedOutput);
const DISCOVERY = path.join(ROOT, '.private', 'zoho-discovery', 'latest.json');
const HANDOFF_DATA = '/Users/apple/Downloads/Magppie-360-Handoff/data';
const PERFORMANCE = '/Users/apple/Downloads/magppie-management-command-center/public/data/performance_dashboard.json';
const MODULES = ['Leads', 'Contacts', 'Deals', 'Tasks', 'Calls'];
const RECOVERED = path.join(ROOT, '.private', 'recovered-exports', '2026-08-10-full');
const RECOVERED_MODULES = ['Contacts', 'Deals', 'Visit_Module', 'Product_Details1', 'Service_A_X_Orders'];

function loadRecoveredExports(directory, discovery) {
  if (!fs.existsSync(path.join(directory, 'manifest.json'))) return { records: {}, origins: {} };
  const manifest = readJson(path.join(directory, 'manifest.json'));
  const org = discovery.organization?.data?.org;
  if (manifest.schema_version !== 1 || org?.length !== 1 || String(org[0].zgid) !== manifest.source_org_id) {
    throw new Error('Recovered export organisation/schema mismatch');
  }
  const records = {}, origins = {};
  for (const [name, entry] of Object.entries(manifest.modules)) {
    const definition = discovery.local.modules.find(item => item.api_name === name);
    if (!RECOVERED_MODULES.includes(name) || definition?.id !== entry.module_id) {
      throw new Error('Recovered module identity mismatch or attempted existing-cache overwrite');
    }
    const bytes = fs.readFileSync(path.join(directory, 'records', `${name}.json`));
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== entry.payload_sha256) throw new Error('Recovered payload checksum mismatch');
    const rows = JSON.parse(bytes);
    if (!Array.isArray(rows) || rows.length !== entry.record_count || rows.some(row => typeof row.id !== 'string' || !/^\d{8,32}$/.test(row.id))
      || new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('Recovered payload identity/count validation failed');
    records[name] = rows;
    origins[name] = { ...entry, source_kind: manifest.source_kind, source_org_id: manifest.source_org_id, source_timezone: manifest.source_timezone };
  }
  return { records, origins };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function valueId(value) {
  return value && typeof value === 'object' ? (value.id || null) : (value || null);
}

function owner(id, name) {
  if (!id && !name) return null;
  return { ...(id ? { id: String(id) } : {}), ...(name ? { name: String(name) } : {}) };
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function mapLead(row) {
  return compactObject({
    id: String(row.id), Full_Name: row.nm || null, Phone: row.ph || null,
    Created_Time: row.ct || null, Modified_Time: row.mt || null,
    Lead_Status: row.st || null, Lead_Source: row.src || null,
    Campaign_Name: row.camp || null, AD_Name: row.ad || null,
    Region: row.rg || null, State1: row.state || null, City: row.cityRaw || row.city || null,
    Property_Type: row.lt || null, Type_of_Client: row.toc || null,
    Vertical: row.vert || null, Teams: row.team || null,
    Owner: owner(row.own || row.psm, row.psmName), Current_Owner: row.cur ? { id: String(row.cur) } : null,
    Dead_Reason: row.dead || null, Lead_Disposition: row.disp || null,
    Client_Status1: row.cstat || null, Lead_Ratings: row.lq == null ? null : Number(row.lq) / 20,
    Lead_Type: row.prio || null, Client_Budget_In_Lakhs: row.bud == null ? null : Number(row.bud) / 100000,
    Oppourtunity_Value: row.bdVal == null ? null : Number(row.bdVal) / 100000,
    Est_Budget: row.budBand || null, Experience_center_loctaion: row.ec || null,
    Lead_Assigned_Date: row.ass || null, Follow_Up_Date_Time: row.fud || null,
    Last_Activity_Time: row.la || null, Converted__s: Boolean(row.conv),
  });
}

function mapContact(row) {
  return compactObject({
    id: String(row.id), Full_Name: row.nm || null, Phone: row.ph || null,
    Created_Time: row.ct || null, Modified_Time: row.mt || null, Stage: row.stage || null,
    Lead_Source: row.src || null, Region: row.rg || null,
    Billing_Address_State_Province: row.state || null, City: row.cityRaw || row.city || null,
    Owner: owner(row.own || row.psm, row.psmName), Sales_Manager: owner(row.bd, row.bdName),
    Lead_Drop_Reason: row.dead || null, Property_Type: row.lt || null,
    Type_of_Client: row.toc || null, Product_Type: row.space || null,
    Total_Opportunity_Value: row.netSales == null ? null : Number(row.netSales) / 100000,
    Grand_Total: row.gross == null ? null : Number(row.gross) / 100000,
    Amount: row.bdVal == null ? null : Number(row.bdVal) / 100000,
    Client_Status: row.cstat || null, Lead_Qualified_Date1: row.qd || null,
    Actual_Closure_Date: row.acd || null, Est_Closoure_Date: row.close || null,
    Lead_Drop_Date: row.dropd || null, Imported: Boolean(row.imp),
  });
}

function mapTask(row) {
  return compactObject({
    id: String(row.id), Subject: row.subj || null, Status: row.st || null,
    Priority: row.prio || null, Due_Date: row.due || null, Closed_Time: row.closed || null,
    Created_Time: row.ct || null, Modified_Time: row.mt || null,
    Owner: owner(row.own, row.ownName), What_Id: row.rel ? { id: String(row.rel) } : null,
  });
}

function mapCall(row) {
  return compactObject({
    id: String(row.id), Created_Time: row.ct || null, Modified_Time: row.mt || null,
    Call_Type: row.type || null, Call_Result: row.result || null, Call_Purpose: row.purpose || null,
    Call_Duration_in_seconds: row.dur, Call_Start_Time: row.start || null,
    Owner: owner(row.own, row.ownName), Who_Id: row.who ? { id: String(row.who) } : null,
    What_Id: row.what ? { id: String(row.what) } : null,
  });
}

function assertTargetRecordNamespace(records) {
  // This prefix is evidenced by the target's captured module/record IDs and
  // archive. The excluded dashboards_vercel cache explicitly belongs to org
  // 60038775297 and uses 8870640 IDs. Never join either org by display names.
  for (const rows of Object.values(records)) {
    if (rows.some(row => typeof row.id !== 'string' || !/^1032257\d+$/.test(row.id))) {
      throw new Error('Snapshot contains records outside the verified target organisation namespace');
    }
  }
}

function mergeById(baseRows, overlayRows) {
  const records = new Map();
  for (const row of baseRows) if (row?.id) records.set(String(row.id), row);
  for (const row of overlayRows) {
    if (!row?.id) continue;
    const id = String(row.id);
    records.set(id, compactObject({ ...(records.get(id) || {}), ...row, id }));
  }
  return [...records.values()];
}

function buildRecords() {
  const handoffLeads = readJson(path.join(HANDOFF_DATA, 'leads.json')).map(mapLead);
  const performance = readJson(PERFORMANCE);
  const enrichedLeads = (performance.psm_first_response_records || []).map(row => compactObject({
    id: String(row.lead_id || row.record_id), Full_Name: row.client_name || null,
    Owner: owner(null, row.owner), Lead_Source: row.lead_source || null,
    Created_Time: row.created_at || null, Modified_Time: row.modified_at || null,
    Lead_Status: row.lead_status || null, Lead_Disposition: row.lead_disposition || null,
    Lead_Drop_Date: row.lead_drop_date || null, Reason_for_Cold: row.reason_for_cold || null,
    City: row.city || null, State1: row.state || null, Next_Follow_UP_Date: row.next_follow_up || null,
    Converted__s: Boolean(row.converted),
  }));

  const handoffContacts = readJson(path.join(HANDOFF_DATA, 'opportunities.json')).map(mapContact);
  const activeContacts = (performance.sales_active_opportunities || []).map(row => compactObject({
    id: String(row.contact_id), Full_Name: row.client_name || row.opportunity_name || null,
    Phone: row.mobile || null, Created_Time: row.created_time || row.created_at || null,
    Modified_Time: row.last_activity_time || row.created_time || null,
    Stage: row.stage || row.status || null, Lead_Source: row.source || null,
    Teams: row.teams || null, Vertical: row.vertical || null,
    Owner: owner(null, row.sales_person), Client_Status: row.closing_probability || null,
    City: row.city || null, Billing_Address_State_Province: row.state || null,
    Est_Closoure_Date: row.est_closure_date || null,
    Follow_Up_Date_Time: row.follow_up_date_time || row.follow_up_date || null,
    Total_Opportunity_Value: row.value_lacs == null ? null : Number(row.value_lacs),
  }));

  return {
    Leads: mergeById(handoffLeads, enrichedLeads),
    Contacts: mergeById(handoffContacts, activeContacts),
    Deals: [], // Filled only by the verified target-org historical Orders export.
    Tasks: readJson(path.join(HANDOFF_DATA, 'tasks.json')).map(mapTask),
    Calls: readJson(path.join(HANDOFF_DATA, 'calls-raw.json')).map(mapCall),
  };
}

function captureTime(files) {
  return new Date(Math.max(...files.map(file => fs.statSync(file).mtimeMs))).toISOString();
}

function syntheticView(moduleName) {
  const fields = {
    Leads: ['Owner', 'Full_Name', 'Lead_Status', 'Lead_Disposition', 'Lead_Source', 'City', 'Created_Time', 'Modified_Time'],
    Contacts: ['Full_Name', 'Phone', 'Stage', 'Lead_Source', 'Owner', 'Total_Opportunity_Value', 'Created_Time', 'Modified_Time'],
    Deals: ['Deal_Name', 'Stage', 'Owner', 'Net_Sales', 'Grand_Total_Incl_of_taxes', 'Created_Time', 'Modified_Time'],
    Tasks: ['Subject', 'Status', 'Priority', 'Due_Date', 'Owner', 'Created_Time', 'Modified_Time'],
    Calls: ['Call_Start_Time', 'Call_Type', 'Call_Duration_in_seconds', 'Call_Result', 'Owner', 'Created_Time', 'Modified_Time'],
    Visit_Module: ['Name', 'AMS_Status', 'Purpose', 'Record_Type', 'Client_Name', 'Deploy_Date', 'Status', 'Owner'],
    Product_Details1: ['Product', 'Product_Name', 'Parent_Id', 'Project_Name', 'Quantity', 'Value', 'Stage', 'Modified_Time'],
    Service_A_X_Orders: ['Name', 'Installations_Services', 'Orders_Name', 'Owner', 'Created_Time', 'Modified_Time'],
  }[moduleName] || ['id'];
  return {
    id: `offline-snapshot-${moduleName}`, name: 'Last Synced Snapshot',
    display_value: 'Last Synced Snapshot', default: true, criteria: null,
    system_name: null, category: 'shared_with_me', fields,
  };
}

function buildMetadata(discovery, recordModules = MODULES, origins = {}) {
  const byModule = new Map(discovery.modules.map(entry => [entry.module?.api_name, entry]));
  // Configuration survives disconnection even where no record cache survives.
  // Preserve all definitions; the UI retains source tab/generated-type rules.
  const moduleDefinitions = discovery.local.modules;
  const names = moduleDefinitions.map(item => item.api_name);
  return {
    modules: { modules: moduleDefinitions },
    org: discovery.organization?.data || { org: [] },
    fields: Object.fromEntries(names.map(moduleName => [moduleName, byModule.get(moduleName)?.results?.fields?.data || { fields: [] }])),
    layouts: Object.fromEntries(names.map(moduleName => [moduleName, byModule.get(moduleName)?.results?.layouts?.data || { layouts: [] }])),
    related_lists: Object.fromEntries(names.map(moduleName => [moduleName, byModule.get(moduleName)?.results?.related_lists?.data || { related_lists: [] }])),
    // Keep source view definitions separately until exact local execution is
    // supported. Never relabel unfiltered cache rows as a source saved view.
    captured_views: Object.fromEntries(names.map(moduleName => [moduleName, byModule.get(moduleName)?.results?.views?.data || { custom_views: [] }])),
    views: Object.fromEntries(recordModules.map(moduleName => [moduleName, { custom_views: [{ ...syntheticView(moduleName),
      ...(origins[moduleName] ? { name: 'Historical export', display_value: 'Historical export' } : {}),
    }] }])),
  };
}

function writePrivateJson(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(temporary, file);
  fs.chmodSync(file, 0o600);
}

function main() {
  const discovery = readJson(DISCOVERY);
  const records = buildRecords();
  const recovered = loadRecoveredExports(RECOVERED, discovery);
  if (!recovered.records.Deals) throw new Error('Verified target-org Orders export is required');
  // Retain current target-org Contact rows. Add previously missing historical
  // IDs without overwriting their existing payloads; raw versions remain private.
  const currentContacts = new Map(records.Contacts.map(row => [row.id, row]));
  const historicalContacts = recovered.records.Contacts || [];
  const addedContacts = historicalContacts.filter(row => !currentContacts.has(row.id));
  Object.assign(records, recovered.records, { Contacts: [...currentContacts.values(), ...addedContacts] });
  recovered.origins.Contacts = { ...recovered.origins.Contacts, source_kind: 'mixed-saved-snapshots', added_historical_records: addedContacts.length };
  assertTargetRecordNamespace(records);
  const recordModules = Object.keys(records);
  const sourceFiles = [
    DISCOVERY,
    path.join(HANDOFF_DATA, 'leads.json'),
    path.join(HANDOFF_DATA, 'opportunities.json'),
    path.join(HANDOFF_DATA, 'tasks.json'),
    path.join(HANDOFF_DATA, 'calls-raw.json'),
    PERFORMANCE,
  ];
  const syncState = readJson(path.join(HANDOFF_DATA, 'sync-state.json'));
  recovered.origins.Calls = { source_kind: 'provided-compact-cache', source_org_id: '60046349006',
    export_date: String(syncState.lastSync).slice(0, 10), record_count: records.Calls.length,
    source_filename: 'calls-raw.json', source_reconciled: false };
  fs.mkdirSync(path.join(OUTPUT, 'records'), { recursive: true, mode: 0o700 });
  fs.chmodSync(OUTPUT, 0o700);
  fs.chmodSync(path.join(OUTPUT, 'records'), 0o700);
  writePrivateJson(path.join(OUTPUT, 'metadata.json'), buildMetadata(discovery, recordModules, recovered.origins));
  for (const moduleName of recordModules) writePrivateJson(path.join(OUTPUT, 'records', `${moduleName}.json`), records[moduleName]);
  const manifest = {
    schema_version: 4,
    source_org_id: '60046349006',
    generated_at: new Date().toISOString(),
    source_snapshot_at: captureTime(sourceFiles),
    source_mode: 'local-cache-read-only',
    external_sync_enabled: false,
    external_writes_enabled: false,
    record_counts: Object.fromEntries(recordModules.map(moduleName => [moduleName, records[moduleName].length])),
    record_sha256: Object.fromEntries(recordModules.map(moduleName => [moduleName,
      crypto.createHash('sha256').update(fs.readFileSync(path.join(OUTPUT, 'records', `${moduleName}.json`))).digest('hex')])),
    module_origins: recovered.origins,
    module_availability: Object.fromEntries(discovery.local.modules.map(item => [item.api_name, {
      metadata_captured: true,
      records_available: recordModules.includes(item.api_name),
      cached_record_count: recordModules.includes(item.api_name) ? records[item.api_name].length : null,
      source_reconciled: false,
    }])),
    provenance: {
      metadata_captured_at: discovery.generated_at || null,
      record_sources: sourceFiles.map(file => ({ file: path.basename(file), captured_at: fs.statSync(file).mtime.toISOString() })),
      merge_rule: 'Verified target-org sources only. Existing target Contacts are retained and historical missing IDs added. Orders use the exact historical export. Original excluded other-org files remain untouched.',
      excluded_sources: [{ source: 'dashboards_vercel/.api_cache', source_org_id: '60038775297', reason: 'Different organisation from target 60046349006' }],
    },
    limitations: [
      'This is the newest recoverable local cache, not a fresh CRM sync.',
      'Module capture times differ; source timestamps are retained in provenance.',
      'Edits, creates, deletes, automations, integrations, and external refreshes are disabled.',
    ],
  };
  writePrivateJson(path.join(OUTPUT, 'manifest.json'), manifest);
  console.log(JSON.stringify({ output: OUTPUT, source_snapshot_at: manifest.source_snapshot_at, record_counts: manifest.record_counts }, null, 2));
}

module.exports = { buildMetadata, loadRecoveredExports, assertTargetRecordNamespace };
if (require.main === module) main();
