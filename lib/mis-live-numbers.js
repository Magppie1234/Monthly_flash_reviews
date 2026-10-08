'use strict';

// One number per review row, read from Zoho CRM at the moment Fetch MIS is clicked.
//
// Every call is a read: the filtered count and search endpoints, plus one capped list read of the
// stage history (that module cannot be searched with this login). Nothing is written to Zoho or
// to disk, so the same code runs locally and on a host with no private files.
// A row that CRM cannot answer returns null and the page shows a dash; null never means zero.

const ORG_ID = '60046349006';
const RESPONSE_WINDOW_HOURS = 12;
const ASSIGNMENT_WINDOW_HOURS = 2;
const SEARCH_LIMIT = 2000;          // Zoho returns at most 2,000 records for one search
const HISTORY_PAGE_LIMIT = 60;      // 12,000 stage-history rows; older months give up instead of crawling
const CACHE_MS = 5 * 60 * 1000;
const IST_OFFSET_MS = 330 * 60000;

// Opportunities that have not been booked, dropped or parked for later.
const OPEN_STAGES = new Set([
  'Raw Quote', 'Ringing No Response', 'Under Follow Up', 'Design Discussion', 'Revised Design Discussion',
  'Revised Design Discussion1', 'Price Dicussion', 'Payment Awaited', 'Principally Closure', 'On Hold',
  'Assigned Designer', 'Approve/Disapprove Quote', 'Revision Req. Quote',
]);
const PRICE_DISCUSSION = new Set(['price dicussion', 'price discussion']);

const normalise = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
const istDay = value => {
  if (!value) return '';
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const time = Date.parse(text);
  return Number.isFinite(time) ? new Date(time + IST_OFFSET_MS).toISOString().slice(0, 10) : '';
};
const number = value => (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));
const average = values => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
const escapeCriteria = value => String(value).replace(/([(),\\])/g, '\\$1');

const asCount = value => (value === null ? null : Number(value).toLocaleString('en-IN'));
const asPercent = (part, whole) => (whole ? `${Math.round((100 * part) / whole)}%` : null);
const asCrore = lakhs => (lakhs === null ? null : `₹${(lakhs / 100).toFixed(2)} Cr`);
const asDays = days => (days === null ? null : `${days.toFixed(1)} days`);

function monthBounds(month) {
  const [year, index] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year, index, 0)).getUTCDate();
  const from = `${month}-01`;
  const to = `${month}-${String(last).padStart(2, '0')}`;
  return { from, to, fromTime: `${from}T00:00:00+05:30`, toTime: `${to}T23:59:59+05:30` };
}

function credentials(env = process.env) {
  const value = name => String(env[name] || '').trim();
  const creds = {
    clientId: value('ZOHO_CLIENT_ID'), clientSecret: value('ZOHO_CLIENT_SECRET'), refreshToken: value('ZOHO_REFRESH_TOKEN'),
    accountsUrl: value('ZOHO_ACCOUNTS_URL') || 'https://accounts.zoho.in', apiDomain: value('ZOHO_API_DOMAIN') || 'https://www.zohoapis.in',
  };
  return creds.clientId && creds.clientSecret && creds.refreshToken ? creds : null;
}

function createZoho(creds, { fetchImpl = fetch } = {}) {
  let token = null;
  let signingIn = null;
  let orgCheck = null;

  // Rows run in parallel; they must share one sign-in. Zoho throttles repeated token requests.
  function authorise() {
    signingIn ||= requestToken().finally(() => { signingIn = null; });
    return signingIn;
  }

  async function requestToken() {
    const response = await fetchImpl(`${creds.accountsUrl}/oauth/v2/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(15000),
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: creds.clientId, client_secret: creds.clientSecret, refresh_token: creds.refreshToken }),
    });
    const body = await response.json().catch(() => ({}));
    if (!body.access_token) throw Object.assign(new Error('Zoho sign-in failed'), { code: 'ZOHO_AUTH_FAILED' });
    token = body.access_token;
  }

  async function get(route) {
    for (let attempt = 0; ; attempt += 1) {
      if (!token) await authorise();
      const response = await fetchImpl(`${creds.apiDomain}/crm/v8/${route}`, { headers: { Authorization: `Zoho-oauthtoken ${token}` }, signal: AbortSignal.timeout(15000) });
      if (response.status === 401 && attempt === 0) { token = null; continue; }
      if ((response.status === 429 || response.status >= 500) && attempt < 2) { await new Promise(resolve => setTimeout(resolve, 600 * (attempt + 1))); continue; }
      if (response.status === 204) return {};
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(`Zoho read failed (${response.status})`), { code: body.code || 'ZOHO_READ_FAILED' });
      return body;
    }
  }

  // The app is built for one organisation; a login pointed anywhere else must not produce numbers.
  function ready() {
    orgCheck ||= get('org').then(body => {
      const org = body.org || [];
      if (org.length !== 1 || String(org[0].zgid) !== ORG_ID) throw Object.assign(new Error('Unexpected Zoho organisation'), { code: 'ORG_MISMATCH' });
    }).catch(error => { orgCheck = null; throw error; });
    return orgCheck;
  }

  async function count(module, criteria) {
    await ready();
    return (await get(`${module}/actions/count?criteria=${encodeURIComponent(criteria)}`)).count ?? 0;
  }

  // Returns every match, or null when the search limit was reached and the set would be incomplete.
  async function search(module, criteria, fields, { converted } = {}) {
    await ready();
    const rows = [];
    for (let page = 1; page <= SEARCH_LIMIT / 200; page += 1) {
      const query = `fields=${['id', ...fields].join(',')}&per_page=200&page=${page}${converted ? `&converted=${converted}` : ''}&criteria=${encodeURIComponent(criteria)}`;
      const body = await get(`${module}/search?${query}`);
      rows.push(...(body.data || []));
      if (!body.info?.more_records) return rows;
    }
    return null;
  }

  // Newest first, stopping at the first row older than `since`. Null when the page cap is hit first.
  async function listSince(module, fields, dateField, since) {
    await ready();
    const rows = [];
    let pageToken = '';
    for (let page = 1; page <= HISTORY_PAGE_LIMIT; page += 1) {
      const paging = pageToken ? `page_token=${encodeURIComponent(pageToken)}` : `page=${page}`;
      const body = await get(`${module}?fields=${['id', ...fields].join(',')}&per_page=200&sort_by=${dateField}&sort_order=desc&${paging}`);
      for (const row of body.data || []) {
        if (Date.parse(row[dateField]) < since) return rows;
        rows.push(row);
      }
      if (!body.info?.more_records) return rows;
      pageToken = body.info.next_page_token || '';
    }
    return null;
  }

  return { count, search, listSince };
}

// Shared reads for one employee and month. Each is fetched once however many rows use it.
function createContext({ zoho, employee, month, now }) {
  const bounds = monthBounds(month);
  const owner = `(Owner:equals:${employee.id})`;
  const within = (field, datetime) => `(${field}:between:${datetime ? `${bounds.fromTime},${bounds.toTime}` : `${bounds.from},${bounds.to}`})`;
  const memo = new Map();
  const once = (key, load) => { if (!memo.has(key)) memo.set(key, load()); return memo.get(key); };
  const inMonth = value => istDay(value).slice(0, 7) === month;
  const picklistName = escapeCriteria(employee.name);

  return {
    bounds, employee, month, inMonth,
    isCurrentMonth: istDay(new Date(now).toISOString()).slice(0, 7) === month,
    leads: () => once('leads', () => zoho.search('Leads', `(${owner}and${within('Created_Time', true)})`, ['Full_Name', 'Created_Time', 'Lead_Assigned_Date', 'Converted_Contact'], { converted: 'both' })),
    monthCalls: () => once('monthCalls', () => zoho.search('Calls', `(${owner}and${within('Call_Start_Time', true)})`, ['Subject', 'Call_Start_Time'])),
    callCount: () => once('callCount', () => zoho.count('Calls', `(${owner}and${within('Call_Start_Time', true)})`)),
    // First response is judged against calls up to the window after month end, so a lead created on
    // the last evening is not marked late only because the call fell in the next month.
    calls: () => once('calls', () => {
      const until = new Date(Date.parse(bounds.toTime) + RESPONSE_WINDOW_HOURS * 3600000 + IST_OFFSET_MS).toISOString().slice(0, 19) + '+05:30';
      return zoho.search('Calls', `(${owner}and(Call_Start_Time:between:${bounds.fromTime},${until}))`, ['Call_Start_Time', 'Who_Id', 'What_Id']);
    }),
    qualified: () => once('qualified', () => zoho.search('Contacts', `((Sales_Manager:equals:${employee.id})and${within('Lead_Qualified_Date1', false)})`, ['Full_Name', 'Amount', 'Lead_Qualified_Date1'])),
    closures: () => once('closures', () => zoho.search('Contacts', `(${owner}and${within('Actual_Closure_Date', false)})`, ['Full_Name', 'Total_Opportunity_Value', 'Actual_Closure_Date'])),
    dropped: () => once('dropped', () => zoho.search('Contacts', `(${owner}and${within('Lead_Drop_Date', true)})`, ['Full_Name', 'Lead_Drop_Reason'])),
    portfolio: () => once('portfolio', () => zoho.search('Contacts', owner, ['Full_Name', 'Stage', 'Next_Follow_UP_Date', 'Next_Follow_Up_Date1'])),
    events: () => once('events', () => zoho.search('Events', `(${owner}and${within('Start_DateTime', true)})`, ['Event_Title', 'Start_DateTime', 'Check_In_Time'])),
    stageHistory: () => once('stageHistory', () => zoho.listSince('Opportunity_Stage_History', ['Stage', 'Modified_Time', 'Full_Name', 'Contact_Owner'], 'Modified_Time', Date.parse(bounds.fromTime))),
    handedOver: () => once('handedOver', () => zoho.search('Deals', within('Handover_Date', false), ['Deal_Name', 'Opportunity_Name', 'Handover_Date'])),
    formsFiled: () => once('formsFiled', () => zoho.search('Deals', within('Form_Filled_Date_Time', true), ['Deal_Name', 'Opportunity_Name', 'Form_Filled_Date_Time'])),
    revisedOrders: () => once('revisedOrders', () => zoho.search('Deals', '(Number_of_Design_Revisions:greater_than:0)', ['Deal_Name', 'Opportunity_Name', 'Designer_Name', 'Number_of_Design_Revisions'])),
    designsSent: () => once('designsSent', () => zoho.search('Deals', `((Designer_Name:equals:${picklistName})and${within('Send_For_Approval_Date', true)})`, ['Deal_Name', 'Send_For_Approval_Date', 'Design_Required_on'])),
    designsApproved: () => once('designsApproved', () => zoho.search('Deals', `((Designer_Name:equals:${picklistName})and${within('Design_Approved_Date', true)})`, ['Deal_Name', 'Design_Approved_Date', 'Expected_Design_Date'])),
    installs: () => once('installs', () => zoho.search('Deals', `((Installation_Managers:equals:${picklistName})and${within('Actual_End_Date', false)})`, ['Deal_Name', 'Actual_installation_start_date', 'Actual_End_Date'])),
    visits: () => once('visits', () => zoho.search('Visit_Module', `(${owner}and${within('Completion_Date', false)})`, ['Name', 'Scheduled_Visit_Date', 'Completion_Date'])),
  };
}

// How each module is named in a Zoho CRM web address, and which field holds a record's name.
const MODULES = {
  Leads: { tab: 'Leads', name: 'Full_Name' },
  Contacts: { tab: 'Contacts', name: 'Full_Name' },
  Deals: { tab: 'Potentials', name: 'Deal_Name' },
  Calls: { tab: 'Calls', name: 'Subject' },
  Events: { tab: 'Events', name: 'Event_Title' },
  Visit_Module: { tab: 'CustomModule9', name: 'Name' },
};
const recordUrl = (module, id) => `https://crm.zoho.in/crm/org${ORG_ID}/tab/${MODULES[module].tab}/${id}`;

const lookupId = value => (value && typeof value === 'object' ? String(value.id || '') : '');
const lookupName = value => (value && typeof value === 'object' ? String(value.name || '') : '');

// A row's answer: the number shown, and the CRM records it was counted from. `detail` is the one
// fact about each record that explains its place in the number (a date, a value, on time or late).
const record = (module, row, detail = '') => ({ id: String(row.id), name: String(row[MODULES[module].name] || '(unnamed)'), detail: String(detail ?? ''), url: recordUrl(module, row.id) });
const answer = (value, module, rows, detail = () => '') => (value === null || value === undefined ? null : { value, records: rows.map(row => record(module, row, detail(row))) });
const counted = (module, rows, detail) => (rows === null ? null : answer(asCount(rows.length), module, rows, detail));

async function ownedContactIds(ctx) {
  const portfolio = await ctx.portfolio();
  return portfolio && new Set(portfolio.map(row => String(row.id)));
}

// Orders carry no sales owner of their own; they belong to whoever owns the linked opportunity.
async function ownOrders(ctx, load) {
  const [orders, owned] = await Promise.all([load(), ownedContactIds(ctx)]);
  return orders && owned ? orders.filter(row => owned.has(lookupId(row.Opportunity_Name))) : null;
}

async function leadsLogged(ctx) { return counted('Leads', await ctx.leads(), row => istDay(row.Created_Time)); }

async function callsMade(ctx) {
  const rows = await ctx.monthCalls();
  if (rows) return counted('Calls', rows, row => istDay(row.Call_Start_Time));
  return { value: asCount(await ctx.callCount()), records: [] };   // over the search limit: the count is still exact
}

async function qualifiedValue(ctx) {
  const rows = await ctx.qualified();
  return rows && answer(asCrore(rows.reduce((sum, row) => sum + (number(row.Amount) || 0), 0)), 'Contacts', rows, row => (number(row.Amount) === null ? 'No value' : `₹${row.Amount} L`));
}

async function bookings(ctx) { return counted('Contacts', await ctx.closures(), row => row.Actual_Closure_Date); }

async function bookingValue(ctx) {
  const rows = await ctx.closures();
  if (!rows) return null;
  const values = rows.map(row => number(row.Total_Opportunity_Value)).filter(value => value !== null);
  if (rows.length && !values.length) return null;
  return answer(asCrore(values.reduce((sum, value) => sum + value, 0)), 'Contacts', rows, row => (number(row.Total_Opportunity_Value) === null ? 'No value' : `₹${row.Total_Opportunity_Value} L`));
}

async function followUpCoverage(ctx) {
  if (!ctx.isCurrentMonth) return null;   // the portfolio is today's picture, not a past month's
  const rows = await ctx.portfolio();
  if (!rows) return null;
  const open = rows.filter(row => OPEN_STAGES.has(row.Stage));
  const planned = row => Boolean(row.Next_Follow_UP_Date || row.Next_Follow_Up_Date1);
  return answer(asPercent(open.filter(planned).length, open.length), 'Contacts', open, row => (planned(row) ? 'Follow-up set' : 'No follow-up date'));
}

async function meetings(ctx) { return counted('Events', await ctx.events(), row => istDay(row.Start_DateTime)); }

async function checkIns(ctx) {
  const rows = await ctx.events();
  return rows && answer(asPercent(rows.filter(row => row.Check_In_Time).length, rows.length), 'Events', rows, row => (row.Check_In_Time ? 'Checked in' : 'No check-in'));
}

async function dropReasons(ctx) {
  const rows = await ctx.dropped();
  const given = row => Boolean(String(row.Lead_Drop_Reason || '').trim()) && row.Lead_Drop_Reason !== '-None-';
  return rows && answer(asPercent(rows.filter(given).length, rows.length), 'Contacts', rows, row => (given(row) ? row.Lead_Drop_Reason : 'No reason'));
}

async function averageRevisions(ctx, mine) {
  if (!ctx.isCurrentMonth) return null;   // revision counts are cumulative, with no date of their own
  const rows = await mine();
  if (!rows || !rows.length) return null;
  return answer(average(rows.map(row => number(row.Number_of_Design_Revisions) || 0)).toFixed(1), 'Deals', rows, row => `${row.Number_of_Design_Revisions} revisions`);
}

async function firstResponse(ctx) {
  const [leads, calls] = await Promise.all([ctx.leads(), ctx.calls()]);
  if (!leads || !calls || !leads.length) return null;
  const callTimes = new Map();
  for (const call of calls) {
    const at = Date.parse(call.Call_Start_Time);
    for (const id of [lookupId(call.Who_Id), lookupId(call.What_Id)]) {
      if (id && Number.isFinite(at)) callTimes.set(id, [...(callTimes.get(id) || []), at]);
    }
  }
  // A call logged before the lead existed is not a response to it.
  const response = lead => {
    const created = Date.parse(lead.Created_Time);
    const after = [String(lead.id), lookupId(lead.Converted_Contact)].flatMap(id => callTimes.get(id) || []).filter(at => at >= created);
    if (!after.length) return 'No call';
    return Math.min(...after) - created <= RESPONSE_WINDOW_HOURS * 3600000 ? 'On time' : 'Late';
  };
  return answer(asPercent(leads.filter(lead => response(lead) === 'On time').length, leads.length), 'Leads', leads, response);
}

async function lateAssignments(ctx) {
  const leads = await ctx.leads();
  if (!leads) return null;
  const dated = leads.filter(lead => lead.Lead_Assigned_Date);
  if (!dated.length) return null;
  const hours = lead => (Date.parse(lead.Lead_Assigned_Date) - Date.parse(lead.Created_Time)) / 3600000;
  const late = dated.filter(lead => hours(lead) > ASSIGNMENT_WINDOW_HOURS);
  return answer(asCount(late.length), 'Leads', late, lead => `Assigned after ${hours(lead).toFixed(1)} h`);
}

async function priceDiscussions(ctx) {
  const rows = await ctx.stageHistory();
  if (!rows) return null;
  const entered = new Map();
  for (const row of rows) {
    if (lookupId(row.Contact_Owner) === ctx.employee.id && ctx.inMonth(row.Modified_Time) && PRICE_DISCUSSION.has(normalise(row.Stage))) {
      entered.set(lookupId(row.Full_Name), { id: lookupId(row.Full_Name), Full_Name: lookupName(row.Full_Name), at: row.Modified_Time });
    }
  }
  return counted('Contacts', [...entered.values()], row => istDay(row.at));
}

async function onOrBefore(load, doneField, dueField) {
  const rows = await load();
  if (!rows) return null;
  const dated = rows.filter(row => row[doneField] && row[dueField]);
  const met = row => istDay(row[doneField]) <= istDay(row[dueField]);
  return answer(asPercent(dated.filter(met).length, dated.length), 'Deals', dated, row => (met(row) ? 'On time' : `Late · due ${istDay(row[dueField])}`));
}

async function averageSpan(module, load, startField, endField) {
  const rows = await load();
  if (!rows) return null;
  const span = row => (Date.parse(istDay(row[endField])) - Date.parse(istDay(row[startField]))) / 86400000;
  const valid = rows.filter(row => Number.isFinite(span(row)) && span(row) >= 0);
  return answer(asDays(average(valid.map(span))), module, valid, row => `${span(row)} days`);
}

// Row id → the number it shows and the records behind it. A row that is absent here has nothing
// in CRM to count.
const ROWS = {
  psm: {
    psm_w1: leadsLogged,
    psm_w3: firstResponse,
    psm_w4: callsMade,
    psm_w6: qualifiedValue,
    psm_w7: lateAssignments,
  },
  sales_manager: {
    sm_w2: priceDiscussions,
    sm_w3: bookings,
    sm_w6: bookingValue,
    sm_w8: async ctx => counted('Deals', await ownOrders(ctx, ctx.handedOver), row => row.Handover_Date),
    sm_w9: followUpCoverage,
    sm_w12: meetings,
  },
  asm: {
    asm_w5: checkIns,
    asm_w7: ctx => averageRevisions(ctx, () => ownOrders(ctx, ctx.revisedOrders)),
    asm_w8: bookingValue,
    asm_w9: async ctx => counted('Deals', await ownOrders(ctx, ctx.formsFiled), row => istDay(row.Form_Filled_Date_Time)),
    asm_w10: followUpCoverage,
    asm_w11: dropReasons,
    asm_w12: meetings,
  },
  designer: {
    dc_w1: async ctx => counted('Deals', await ctx.designsSent(), row => istDay(row.Send_For_Approval_Date)),
    dc_w2: async ctx => counted('Deals', await ctx.designsApproved(), row => istDay(row.Design_Approved_Date)),
    dc_w3: ctx => onOrBefore(ctx.designsSent, 'Send_For_Approval_Date', 'Design_Required_on'),
    dc_w4: ctx => onOrBefore(ctx.designsApproved, 'Design_Approved_Date', 'Expected_Design_Date'),
    dc_w6: ctx => averageRevisions(ctx, async () => { const rows = await ctx.revisedOrders(); return rows && rows.filter(row => normalise(row.Designer_Name) === normalise(ctx.employee.name)); }),
  },
  installation_manager: {
    installation_manager_v2_w1: ctx => averageSpan('Deals', ctx.installs, 'Actual_installation_start_date', 'Actual_End_Date'),
  },
  customer_care_head: {
    customer_care_head_v2_w1: ctx => averageSpan('Visit_Module', ctx.visits, 'Scheduled_Visit_Date', 'Completion_Date'),
  },
  avp: {
    avp_context_meetings: meetings,
  },
};

// Designers and the installation manager are matched to CRM by the name in a picklist; everyone
// else by Zoho user id. A project-only person ("local:" id) owns nothing in CRM.
const MATCHED_BY_NAME = new Set(['designer', 'installation_manager']);

// items: what the results column shows. records: row id → the CRM records behind that number.
async function fetchNumbers({ zoho, policy, employee, month, itemIds, now = Date.now() }) {
  const rows = ROWS[policy] || {};
  const inCrm = MATCHED_BY_NAME.has(policy) || /^\d+$/.test(employee.id);
  const ctx = createContext({ zoho, employee, month, now });
  const records = {};
  let failed = 0;
  const items = await Promise.all(itemIds.map(async id => {
    const blank = { id, value: null, records: 0 };
    if (!rows[id] || !inCrm) return blank;
    try {
      const result = await rows[id](ctx);
      if (!result) return blank;
      records[id] = result.records;
      return { id, value: result.value, records: result.records.length };
    } catch { failed += 1; return blank; }
  }));
  return { items, records, failed };
}

const cache = new Map();
async function cachedNumbers(key, load, now = Date.now()) {
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.value;
  const value = load();
  cache.set(key, { at: now, value });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  try { return await value; } catch (error) { cache.delete(key); throw error; }
}

const forget = key => cache.delete(key);

module.exports = { ROWS, forget, RESPONSE_WINDOW_HOURS, credentials, createZoho, fetchNumbers, cachedNumbers, monthBounds, istDay, recordUrl };
