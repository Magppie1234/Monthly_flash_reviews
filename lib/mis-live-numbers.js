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

// History is read whole for the month, not per person, and takes several seconds: keep it briefly
// so the next employee opened for the same month does not wait for it again.
const histories = new WeakMap();   // per Zoho connection, so one login never sees another's rows
function sharedHistory(zoho, key, load) {
  if (!histories.has(zoho)) histories.set(zoho, new Map());
  const kept = histories.get(zoho), hit = kept.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.rows;
  const rows = load().catch(error => { kept.delete(key); throw error; });
  kept.set(key, { at: Date.now(), rows });
  return rows;
}

// Shared reads for one employee and month. Each is fetched once however many rows use it.
function createContext({ zoho, employee, month, now }) {
  const bounds = monthBounds(month);
  const owner = `(Owner:equals:${employee.id})`;
  const within = (field, datetime) => `(${field}:between:${datetime ? `${bounds.fromTime},${bounds.toTime}` : `${bounds.from},${bounds.to}`})`;
  const memo = new Map();
  // A read that comes back null was cut short (Zoho's 2,000-record search limit, or the history
  // page cap). The figure would be wrong, so the row reports the reason instead of a number.
  const complete = (code, load) => async () => { const rows = await load(); if (rows === null) throw Object.assign(new Error(code), { code }); return rows; };
  const once = (key, load) => { if (!memo.has(key)) memo.set(key, load()); return memo.get(key); };
  const full = (key, load) => once(key, complete('TOO_MANY_RECORDS', load));
  const inMonth = value => istDay(value).slice(0, 7) === month;
  const picklistName = escapeCriteria(employee.name);

  return {
    bounds, employee, month, inMonth,
    isCurrentMonth: istDay(new Date(now).toISOString()).slice(0, 7) === month,
    leads: () => full('leads', () => zoho.search('Leads', `(${owner}and${within('Created_Time', true)})`, ['Full_Name', 'Created_Time', 'Lead_Assigned_Date', 'Converted_Contact', 'Dead_Reason'], { converted: 'both' })),
    leadHistory: () => once('leadHistory', complete('HISTORY_TOO_LONG', () => sharedHistory(zoho, `leads|${month}`, () => zoho.listSince('Lead_Status_History', ['Lead_Status', 'Modified_Time', 'Full_Name'], 'Modified_Time', Date.parse(bounds.fromTime))))),
    monthCalls: () => once('monthCalls', () => zoho.search('Calls', `(${owner}and${within('Call_Start_Time', true)})`, ['Subject', 'Call_Start_Time'])),
    callCount: () => once('callCount', () => zoho.count('Calls', `(${owner}and${within('Call_Start_Time', true)})`)),
    // First response is judged against calls up to the window after month end, so a lead created on
    // the last evening is not marked late only because the call fell in the next month.
    calls: () => full('calls', () => {
      const until = new Date(Date.parse(bounds.toTime) + RESPONSE_WINDOW_HOURS * 3600000 + IST_OFFSET_MS).toISOString().slice(0, 19) + '+05:30';
      return zoho.search('Calls', `(${owner}and(Call_Start_Time:between:${bounds.fromTime},${until}))`, ['Call_Start_Time', 'Who_Id', 'What_Id']);
    }),
    qualified: () => full('qualified', () => zoho.search('Contacts', `((Sales_Manager:equals:${employee.id})and${within('Lead_Qualified_Date1', false)})`, ['Full_Name', 'Amount', 'Lead_Qualified_Date1'])),
    closures: () => full('closures', () => zoho.search('Contacts', `(${owner}and${within('Actual_Closure_Date', false)})`, ['Full_Name', 'Total_Opportunity_Value', 'Actual_Closure_Date', 'Est_Closoure_Date', 'Discount', 'Management_Discount_Proposed', 'AVP_Approval_Status'])),
    newOpportunities: () => full('newOpportunities', () => zoho.search('Contacts', `(${owner}and${within('Created_Time', true)})`, ['Full_Name', 'Number_of_Meetings', 'Meeting_Date'])),
    bookedOrders: () => full('bookedOrders', () => zoho.search('Deals', within('Created_Time', true), ['Deal_Name', 'Opportunity_Name', 'Completed_Booking_Approval_Status', 'Completed_Booking_Approval_Approver', 'Token_Received_Date'])),
    allDesignsSent: () => full('allDesignsSent', () => zoho.search('Deals', within('Send_For_Approval_Date', true), ['Deal_Name', 'Opportunity_Name', 'Send_For_Approval_Date', 'Design_Required_on'])),
    revisedArea: () => full('revisedArea', () => zoho.search('Deals', `((Designer_Name:equals:${picklistName})and(Total_Cabinet_Revision_Sqft:greater_than:0))`, ['Deal_Name', 'Total_Cabinet_Revision_Sqft'])),
    complaints: () => full('complaints', () => zoho.search('AMS_Complaints', within('AMS_Date', false), ['Name', 'Owner', 'Complaint_From', 'Complaint_Date', 'AMS_Completed_Date', 'Total_Cost'])),
    dropped: () => full('dropped', () => zoho.search('Contacts', `(${owner}and${within('Lead_Drop_Date', true)})`, ['Full_Name', 'Lead_Drop_Reason'])),
    portfolio: () => full('portfolio', () => zoho.search('Contacts', owner, ['Full_Name', 'Stage', 'Next_Follow_UP_Date', 'Next_Follow_Up_Date1'])),
    events: () => full('events', () => zoho.search('Events', `(${owner}and${within('Start_DateTime', true)})`, ['Event_Title', 'Start_DateTime', 'Check_In_Time'])),
    stageHistory: () => once('stageHistory', complete('HISTORY_TOO_LONG', () => sharedHistory(zoho, `stages|${month}`, () => zoho.listSince('Opportunity_Stage_History', ['Stage', 'Modified_Time', 'Full_Name', 'Contact_Owner'], 'Modified_Time', Date.parse(bounds.fromTime))))),
    handedOver: () => full('handedOver', () => zoho.search('Deals', within('Handover_Date', false), ['Deal_Name', 'Opportunity_Name', 'Handover_Date'])),
    formsFiled: () => full('formsFiled', () => zoho.search('Deals', within('Form_Filled_Date_Time', true), ['Deal_Name', 'Opportunity_Name', 'Form_Filled_Date_Time'])),
    revisedOrders: () => full('revisedOrders', () => zoho.search('Deals', '(Number_of_Design_Revisions:greater_than:0)', ['Deal_Name', 'Opportunity_Name', 'Designer_Name', 'Number_of_Design_Revisions'])),
    designsSent: () => full('designsSent', () => zoho.search('Deals', `((Designer_Name:equals:${picklistName})and${within('Send_For_Approval_Date', true)})`, ['Deal_Name', 'Send_For_Approval_Date', 'Design_Required_on'])),
    designsApproved: () => full('designsApproved', () => zoho.search('Deals', `((Designer_Name:equals:${picklistName})and${within('Design_Approved_Date', true)})`, ['Deal_Name', 'Design_Approved_Date', 'Expected_Design_Date', 'First_Measurement_Status', 'PDI_Status', 'Site_Measurement_Person'])),
    installs: () => full('installs', () => zoho.search('Deals', `((Installation_Managers:equals:${picklistName})and${within('Actual_installation_start_date', false)})`, ['Deal_Name', 'Actual_installation_start_date', 'Actual_End_Date'])),
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
  AMS_Complaints: { tab: 'AMS_Complaints', name: 'Name' },
};
const recordUrl = (module, id) => `https://crm.zoho.in/crm/org${ORG_ID}/tab/${MODULES[module].tab}/${id}`;

// Some figures describe today's portfolio and carry no date, so they cannot be shown for a past month.
const CURRENT_ONLY = { value: null, records: [], note: 'Running total in CRM; only available for the current month' };

const lookupId = value => (value && typeof value === 'object' ? String(value.id || '') : '');
const lookupName = value => (value && typeof value === 'object' ? String(value.name || '') : '');

// A row's answer: the number shown, and the CRM records it was counted from. `detail` is the one
// fact about each record that explains its place in the number (a date, a value, on time or late).
const record = (module, row, detail = '') => ({ id: String(row.id), name: String(row[MODULES[module].name] || '(unnamed)'), detail: String(detail ?? ''), url: recordUrl(module, row.id) });
const answer = (value, module, rows, detail = () => '') => (value === null || value === undefined ? null : { value, records: rows.map(row => record(module, row, detail(row))) });
// A figure built from only part of the records says so, with the count, so it is never read as the whole picture.
const partly = (used, total, what) => (used < total ? `Based on ${used} of ${total} ${what}. The other ${total - used} ${total - used === 1 ? 'has' : 'have'} this field empty in CRM.` : '');
const flagged = (result, warning) => (result && warning ? { ...result, warning } : result);
// Who a record names in a field: a lookup's name or a picklist value. Used to say who should have filled a gap.
const named = (rows, field) => {
  const people = [...new Set(rows.map(row => (row[field] && typeof row[field] === 'object' ? lookupName(row[field]) : row[field])).filter(value => value && value !== '-None-'))];
  return people.length > 2 ? `${people.slice(0, 2).join(', ')} and others` : people.join(' and ');
};
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
  if (!rows.length) return null;
  const valued = rows.filter(row => number(row.Amount) !== null);
  if (!valued.length) return unfilled('Contacts', rows);
  return flagged(answer(asCrore(valued.reduce((sum, row) => sum + number(row.Amount), 0)), 'Contacts', rows, row => (number(row.Amount) === null ? 'No value' : `₹${row.Amount} L`)), partly(valued.length, rows.length, 'qualified opportunities'));
}

async function bookings(ctx) { return counted('Contacts', await ctx.closures(), row => row.Actual_Closure_Date); }

async function bookingValue(ctx) {
  const rows = await ctx.closures();
  const values = rows.map(row => number(row.Total_Opportunity_Value)).filter(value => value !== null);
  if (rows.length && !values.length) return unfilled('Contacts', rows);
  return flagged(answer(asCrore(values.reduce((sum, value) => sum + value, 0)), 'Contacts', rows, row => (number(row.Total_Opportunity_Value) === null ? 'No value' : `₹${row.Total_Opportunity_Value} L`)), partly(values.length, rows.length, 'bookings'));
}

async function followUpCoverage(ctx) {
  if (!ctx.isCurrentMonth) return CURRENT_ONLY;   // the portfolio is today's picture, not a past month's
  const rows = await ctx.portfolio();
  if (!rows) return null;
  const open = rows.filter(row => OPEN_STAGES.has(row.Stage));
  const planned = row => Boolean(row.Next_Follow_UP_Date || row.Next_Follow_Up_Date1);
  return answer(asPercent(open.filter(planned).length, open.length), 'Contacts', open, row => (planned(row) ? 'Follow-up set' : 'No follow-up date'));
}

async function meetings(ctx) { return counted('Events', await ctx.events(), row => istDay(row.Start_DateTime)); }

async function dropReasons(ctx) {
  const rows = await ctx.dropped();
  const given = row => Boolean(String(row.Lead_Drop_Reason || '').trim()) && row.Lead_Drop_Reason !== '-None-';
  return rows && answer(asPercent(rows.filter(given).length, rows.length), 'Contacts', rows, row => (given(row) ? row.Lead_Drop_Reason : 'No reason'));
}

async function averageRevisions(ctx, mine) {
  if (!ctx.isCurrentMonth) return CURRENT_ONLY;   // revision counts are cumulative, with no date of their own
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
  if (!leads.length) return null;
  const dated = leads.filter(lead => lead.Lead_Assigned_Date);
  if (!dated.length) return unfilled('Leads', leads);
  const hours = lead => (Date.parse(lead.Lead_Assigned_Date) - Date.parse(lead.Created_Time)) / 3600000;
  const late = dated.filter(lead => hours(lead) > ASSIGNMENT_WINDOW_HOURS);
  return flagged(answer(asCount(late.length), 'Leads', late, lead => `Assigned after ${hours(lead).toFixed(1)} h`), partly(dated.length, leads.length, 'leads'));
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
  if (!rows.length) return null;
  const dated = rows.filter(row => row[doneField] && row[dueField]);
  if (!dated.length) return unfilled('Deals', rows);
  const met = row => istDay(row[doneField]) <= istDay(row[dueField]);
  return flagged(answer(asPercent(dated.filter(met).length, dated.length), 'Deals', dated, row => (met(row) ? 'On time' : `Late · due ${istDay(row[dueField])}`)), partly(dated.length, rows.length, 'orders'));
}

// A field that exists in CRM but is empty on every record it applies to: there is nothing to
// count, and the reviewer should know that is a gap in data entry, not a result of zero.
// `records` are the ones waiting for the field.
// `by` names whoever is responsible for the field when that is not the person under review.
const unfilled = (module, rows, detail = () => 'Not filled', by = '') => ({ value: null, unfilled: true, by, records: rows.map(row => record(module, row, detail(row))) });
const fromFilled = (module, rows, isFilled, compute, by = () => '') => {
  if (!rows || !rows.length) return null;
  const filled = rows.filter(isFilled);
  return filled.length ? flagged(compute(filled), partly(filled.length, rows.length, 'records')) : unfilled(module, rows, undefined, by(rows));
};

async function duplicateRate(ctx) {
  const leads = await ctx.leads();
  if (!leads || !leads.length) return null;
  const duplicates = leads.filter(lead => lead.Dead_Reason === 'Duplicate Lead');
  return answer(asPercent(duplicates.length, leads.length), 'Leads', duplicates, lead => istDay(lead.Created_Time));
}

// The statuses that settle a lead one way or the other: qualified, parked for later, or ruled out.
// "No response" and "under follow up" are still open, so they do not count as a decision.
const DECIDED = new Set(['qualified/ drawings awiated', 'will buy in future', 'not interested', 'junk lead']);
function nextWorkingDayEnd(created) {
  const day = new Date(Date.parse(istDay(new Date(created).toISOString()) + 'T23:59:59+05:30') + 86400000);
  if (new Date(day.getTime() + IST_OFFSET_MS).getUTCDay() === 0) day.setTime(day.getTime() + 86400000);   // Sunday rolls to Monday
  return day.getTime();
}
async function qualificationSpeed(ctx) {
  const [leads, history] = await Promise.all([ctx.leads(), ctx.leadHistory()]);
  if (!leads || !history || !leads.length) return null;
  const decided = new Map();
  for (const row of history) {
    const id = lookupId(row.Full_Name), at = Date.parse(row.Modified_Time);
    if (id && Number.isFinite(at) && DECIDED.has(normalise(row.Lead_Status)) && (!decided.has(id) || at < decided.get(id))) decided.set(id, at);
  }
  const verdict = lead => { const at = decided.get(String(lead.id)); return at === undefined ? 'No decision yet' : at <= nextWorkingDayEnd(Date.parse(lead.Created_Time)) ? 'On time' : 'Late'; };
  return answer(asPercent(leads.filter(lead => verdict(lead) === 'On time').length, leads.length), 'Leads', leads, verdict);
}

async function forecastAccuracy(ctx) {
  return fromFilled('Contacts', await ctx.closures(), row => row.Est_Closoure_Date, rows => {
    const asForecast = row => String(row.Est_Closoure_Date).slice(0, 7) === String(row.Actual_Closure_Date).slice(0, 7);
    return answer(asPercent(rows.filter(asForecast).length, rows.length), 'Contacts', rows, row => (asForecast(row) ? 'Closed as forecast' : `Forecast ${row.Est_Closoure_Date}`));
  });
}

async function unapprovedDiscounts(ctx) {
  const discounted = row => (number(row.Discount) || 0) > 0 || (number(row.Management_Discount_Proposed) || 0) > 0;
  return fromFilled('Contacts', await ctx.closures(), discounted, rows => {
    const open = rows.filter(row => (number(row.Management_Discount_Proposed) || 0) > 0 && row.AVP_Approval_Status !== 'Approved');
    return answer(asCount(open.length), 'Contacts', open, row => `Proposed ₹${row.Management_Discount_Proposed}`);
  });
}

async function bookingApprovals(ctx) {
  const set = row => row.Completed_Booking_Approval_Status && row.Completed_Booking_Approval_Status !== '-None-';
  return fromFilled('Deals', await ownOrders(ctx, ctx.bookedOrders), set, rows => answer(asPercent(rows.filter(row => row.Completed_Booking_Approval_Status === 'Approved').length, rows.length), 'Deals', rows, row => row.Completed_Booking_Approval_Status), rows => named(rows, 'Completed_Booking_Approval_Approver') || 'the booking approver');
}

async function meetingsHeld(ctx) {
  return fromFilled('Contacts', await ctx.newOpportunities(), row => (number(row.Number_of_Meetings) || 0) > 0 || row.Meeting_Date, rows => answer(asCount(rows.length), 'Contacts', rows, row => row.Meeting_Date || `${row.Number_of_Meetings} meetings`));
}

async function checkIns(ctx) {
  const rows = await ctx.events();
  if (!rows || !rows.length) return null;
  const kept = rows.filter(row => row.Check_In_Time);
  if (!kept.length) return unfilled('Events', rows, () => 'No check-in');
  return answer(asPercent(kept.length, rows.length), 'Events', rows, row => (row.Check_In_Time ? 'Checked in' : 'No check-in'));
}

const statusSet = field => row => row[field] && row[field] !== '-None-' && row[field] !== 'Not Started';
async function approvedShare(ctx, field, team) {
  return fromFilled('Deals', await ctx.designsApproved(), statusSet(field), rows => answer(asPercent(rows.filter(row => row[field] === 'Approved').length, rows.length), 'Deals', rows, row => row[field]), rows => (field === 'First_Measurement_Status' && named(rows, 'Site_Measurement_Person')) || team);
}

async function revisionArea(ctx) {
  if (!ctx.isCurrentMonth) return CURRENT_ONLY;   // cumulative on the order, with no date of its own
  const rows = await ctx.revisedArea();
  if (!rows || !rows.length) return null;
  return answer(`${Math.round(rows.reduce((sum, row) => sum + (number(row.Total_Cabinet_Revision_Sqft) || 0), 0)).toLocaleString('en-IN')} sq ft`, 'Deals', rows, row => `${row.Total_Cabinet_Revision_Sqft} sq ft`);
}

async function installDays(ctx) {
  return fromFilled('Deals', await ctx.installs(), row => row.Actual_End_Date, rows => {
    const span = row => (Date.parse(row.Actual_End_Date) - Date.parse(row.Actual_installation_start_date)) / 86400000;
    const valid = rows.filter(row => span(row) >= 0);
    return answer(asDays(average(valid.map(span))), 'Deals', valid, row => `${span(row)} days`);
  });
}

async function installationComplaints(ctx) {
  return fromFilled('AMS_Complaints', await ctx.complaints(), row => row.Complaint_From && row.Complaint_From !== '-None-', rows => {
    const ours = rows.filter(row => row.Complaint_From === 'Installation Team');
    return answer(asCount(ours.length), 'AMS_Complaints', ours, row => row.Complaint_Date || '');
  }, rows => named(rows, 'Owner'));
}

async function serviceDays(ctx) {
  return fromFilled('AMS_Complaints', await ctx.complaints(), row => row.Complaint_Date && row.AMS_Completed_Date, rows => {
    const span = row => (Date.parse(row.AMS_Completed_Date) - Date.parse(row.Complaint_Date)) / 86400000;
    const valid = rows.filter(row => span(row) >= 0);
    return answer(asDays(average(valid.map(span))), 'AMS_Complaints', valid, row => `${span(row)} days`);
  }, rows => named(rows, 'Owner'));
}

async function serviceCost(ctx) {
  return fromFilled('AMS_Complaints', await ctx.complaints(), row => (number(row.Total_Cost) || 0) > 0, rows => answer(`₹${Math.round(average(rows.map(row => number(row.Total_Cost)))).toLocaleString('en-IN')}`, 'AMS_Complaints', rows, row => `₹${row.Total_Cost}`), rows => named(rows, 'Owner'));
}

// Row id → the number it shows and the records behind it. A row that is absent here has nothing
// in CRM to count.
const ROWS = {
  psm: {
    psm_w1: leadsLogged,
    psm_w2: duplicateRate,
    psm_w3: firstResponse,
    psm_w4: callsMade,
    psm_w5: qualificationSpeed,
    psm_w6: qualifiedValue,
    psm_w7: lateAssignments,
  },
  sales_manager: {
    sm_w2: priceDiscussions,
    sm_w3: bookings,
    sm_w4: unapprovedDiscounts,
    sm_w6: bookingValue,
    sm_w7: bookingApprovals,
    sm_w8: async ctx => counted('Deals', await ownOrders(ctx, ctx.handedOver), row => row.Handover_Date),
    sm_w9: followUpCoverage,
    sm_w10: forecastAccuracy,
    sm_w12: meetings,
  },
  asm: {
    asm_w2: meetingsHeld,
    asm_w3: async ctx => { const rows = await ownOrders(ctx, ctx.allDesignsSent); return onOrBefore(async () => rows, 'Send_For_Approval_Date', 'Design_Required_on'); },
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
    dc_w5: ctx => approvedShare(ctx, 'First_Measurement_Status', 'the site measurement team'),
    dc_w6: ctx => averageRevisions(ctx, async () => { const rows = await ctx.revisedOrders(); return rows && rows.filter(row => normalise(row.Designer_Name) === normalise(ctx.employee.name)); }),
    dc_w7: revisionArea,
    dc_w11: ctx => approvedShare(ctx, 'PDI_Status', 'the PDI team'),
  },
  installation_manager: {
    installation_manager_v2_w1: installDays,
    installation_manager_v2_w4: installationComplaints,
  },
  customer_care_head: {
    customer_care_head_v2_w1: serviceDays,
    customer_care_head_v2_w2: serviceCost,
  },
  avp: {
    avp_context_meetings: meetings,
  },
};

// Designers and the installation manager are matched to CRM by the name in a picklist; everyone
// else by Zoho user id. A project-only person ("local:" id) owns nothing in CRM.
const MATCHED_BY_NAME = new Set(['designer', 'installation_manager']);

// Why a row has no figure although CRM holds data for it.
const ISSUES = {
  TOO_MANY_RECORDS: 'More than 2,000 CRM records match this row, which is more than Zoho returns in one search. The figure cannot be counted exactly, so none is shown.',
  HISTORY_TOO_LONG: 'This month is too far back: the CRM status history is too long to read in one go, so no figure is shown.',
};

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
      if (!result) return { ...blank, note: 'No CRM records this month' };
      records[id] = result.records;
      const note = result.unfilled ? `Field exists but not filled by ${result.by || employee.name}` : result.note || null;
      return { id, value: result.value, records: result.records.length, ...(note ? { note } : {}), ...(result.warning ? { warning: result.warning } : {}) };
    } catch (error) {
      if (ISSUES[error.code]) return { ...blank, warning: ISSUES[error.code] };
      failed += 1;
      return { ...blank, warning: 'Zoho CRM did not answer for this row. Fetch MIS again.' };
    }
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
