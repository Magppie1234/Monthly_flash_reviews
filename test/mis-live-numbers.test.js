'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const live = require('../lib/mis-live-numbers');
const { mountMis } = require('../lib/flash-mis');

const employee = { id: '1032257000000451017', name: 'Sowmya' };
const at = (day, hour = 10) => `2026-09-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00+05:30`;
const NOW = Date.parse('2026-09-20T06:00:00Z');

// Answers by module; `searches` records every criteria string so tests can check the filter sent.
function fakeZoho(data = {}, searches = []) {
  return {
    count: async (module, criteria) => { searches.push([module, criteria]); return data[`${module}#count`] ?? 0; },
    search: async (module, criteria) => { searches.push([module, criteria]); const rows = data[module]; return typeof rows === 'function' ? rows(criteria) : rows === undefined ? [] : rows; },
    listSince: async module => data[module] ?? [],
  };
}
async function numbers(policy, data, { month = '2026-09', who = employee, ids } = {}) {
  const itemIds = ids || Object.keys(live.ROWS[policy]);
  const result = await live.fetchNumbers({ zoho: fakeZoho(data), policy, employee: who, month, itemIds, now: NOW });
  return { ...Object.fromEntries(result.items.map(item => [item.id, item.value])), failed: result.failed };
}

test('month filters use IST boundaries and the real last day', () => {
  assert.deepEqual(live.monthBounds('2026-02'), { from: '2026-02-01', to: '2026-02-28', fromTime: '2026-02-01T00:00:00+05:30', toTime: '2026-02-28T23:59:59+05:30' });
  assert.equal(live.istDay('2026-08-31T20:00:00Z'), '2026-09-01');
});

test('PSM rows: leads logged, first response inside the window, calls, qualified value, late assignments', async () => {
  const leads = [
    { id: 'L1', Created_Time: at(1), Lead_Assigned_Date: at(1, 11) },      // called 2h later, assigned in 1h
    { id: 'L2', Created_Time: at(2), Lead_Assigned_Date: at(2, 15) },      // called after 13h, assigned after 5h
    { id: 'L3', Created_Time: at(3), Converted_Contact: { id: 'C3' } },    // call logged on the converted contact
    { id: 'L4', Created_Time: at(4) },                                     // never called
  ];
  const calls = [
    { id: 'K1', Call_Start_Time: at(1, 12), Who_Id: { id: 'L1' } },
    { id: 'K2', Call_Start_Time: at(2, 23), Who_Id: { id: 'L2' } },
    { id: 'K3', Call_Start_Time: at(3, 11), Who_Id: { id: 'C3' } },
    { id: 'K0', Call_Start_Time: at(1, 8), Who_Id: { id: 'L1' } },         // before the lead existed: not a response
  ];
  const result = await numbers('psm', { Leads: leads, Calls: calls, Contacts: [{ id: 'C1', Amount: 18 }, { id: 'C2', Amount: 132 }, { id: 'C4', Amount: null }] });
  assert.equal(result.psm_w1, '4');
  assert.equal(result.psm_w3, '50%');
  assert.equal(result.psm_w4, '4');
  assert.equal(result.psm_w6, '₹1.50 Cr');
  assert.equal(result.psm_w7, '1');
  assert.equal(result.failed, 0);
  assert.equal(live.RESPONSE_WINDOW_HOURS, 12);
});

test('rows with nothing in CRM, project-only people and incomplete searches give a dash, never zero', async () => {
  const everything = ['psm_w1', 'psm_w2', 'psm_w5', 'psm_w8', 'psm_b_1', 'psm_f_1'];
  const result = await numbers('psm', { Leads: [] }, { ids: everything });
  assert.equal(result.psm_w1, '0');
  for (const id of everything.slice(1)) assert.equal(result[id], null, id);
  const local = await numbers('psm', { Leads: [{ id: 'L1', Created_Time: at(1) }] }, { who: { id: 'local:someone', name: 'Someone' } });
  assert.ok(Object.entries(local).every(([id, value]) => id === 'failed' || value === null));
  // null from search means the 2,000-record limit was reached: the count would be wrong, so show nothing
  assert.equal((await numbers('psm', { Leads: null }, { ids: ['psm_w1', 'psm_w3'] })).psm_w1, null);
});

test('a failing Zoho read blanks only its own row and is reported', async () => {
  const result = await numbers('psm', { Leads: () => { throw new Error('boom'); }, Calls: null, 'Calls#count': 5 }, { ids: ['psm_w1', 'psm_w4'] });
  assert.equal(result.psm_w1, null);
  assert.equal(result.psm_w4, '5');
  assert.equal(result.failed, 1);
});

test('sales rows: bookings, booked value, price discussions, own handovers and follow-up coverage', async () => {
  const owner = { id: employee.id };
  const data = {
    Contacts: criteria => {
      if (criteria.includes('Actual_Closure_Date')) return [{ id: 'C1', Total_Opportunity_Value: 80 }, { id: 'C2', Total_Opportunity_Value: 35 }];
      return [   // portfolio
        { id: 'C1', Stage: 'Price Dicussion', Next_Follow_UP_Date: '2026-09-25' },
        { id: 'C2', Stage: 'Under Follow Up' },
        { id: 'C3', Stage: 'Not Interested' },
        { id: 'C4', Stage: 'Design Discussion', Next_Follow_Up_Date1: at(22) },
      ];
    },
    Opportunity_Stage_History: [
      { id: 'H1', Stage: 'Price Dicussion', Modified_Time: at(5), Full_Name: { id: 'C1' }, Contact_Owner: owner },
      { id: 'H2', Stage: 'Price Discussion', Modified_Time: at(6), Full_Name: { id: 'C1' }, Contact_Owner: owner },   // same opportunity again
      { id: 'H3', Stage: 'Price Dicussion', Modified_Time: at(7), Full_Name: { id: 'C9' }, Contact_Owner: { id: 'someone-else' } },
      { id: 'H4', Stage: 'Order Booked', Modified_Time: at(8), Full_Name: { id: 'C2' }, Contact_Owner: owner },
    ],
    Deals: [{ id: 'D1', Opportunity_Name: { id: 'C1' } }, { id: 'D2', Opportunity_Name: { id: 'not-mine' } }],
    Events: [{ id: 'E1' }, { id: 'E2', Check_In_Time: at(9) }],
  };
  const sm = await numbers('sales_manager', data);
  assert.deepEqual({ w2: sm.sm_w2, w3: sm.sm_w3, w6: sm.sm_w6, w8: sm.sm_w8, w9: sm.sm_w9, w12: sm.sm_w12 }, { w2: '1', w3: '2', w6: '₹1.15 Cr', w8: '1', w9: '67%', w12: '2' });
  // the portfolio is today's picture, so a past month shows no follow-up figure
  assert.equal((await numbers('sales_manager', data, { month: '2026-08' })).sm_w9, null);
  const asm = await numbers('asm', data);
  assert.equal(asm.asm_w5, '50%');
  assert.equal(asm.asm_w8, '₹1.15 Cr');
});

test('designers are matched by name and judged on dates met', async () => {
  const searches = [];
  const zoho = fakeZoho({ Deals: criteria => (criteria.includes('Send_For_Approval_Date')
    ? [{ id: 'D1', Send_For_Approval_Date: at(10), Design_Required_on: '2026-09-12' }, { id: 'D2', Send_For_Approval_Date: at(20), Design_Required_on: '2026-09-15' }, { id: 'D3', Send_For_Approval_Date: at(21) }]
    : [{ id: 'D4', Design_Approved_Date: at(11), Expected_Design_Date: '2026-09-11' }]) }, searches);
  const result = await live.fetchNumbers({ zoho, policy: 'designer', employee: { id: 'local:designer-rashi', name: 'Rashi' }, month: '2026-09', itemIds: ['dc_w1', 'dc_w2', 'dc_w3', 'dc_w4'], now: NOW });
  assert.deepEqual(result.items.map(item => item.value), ['3', '1', '50%', '100%']);
  assert.ok(searches.some(([module, criteria]) => module === 'Deals' && criteria.includes('(Designer_Name:equals:Rashi)')));
});

test('GET /api/flash-review/mis returns one value per review row and validates the selection', async t => {
  const app = express();
  mountMis(app, path.join(__dirname, '..'), { zoho: fakeZoho({ Leads: [{ id: 'L1', Full_Name: 'Asha Rao', Created_Time: at(1) }], Calls: Array.from({ length: 7 }, (_, index) => ({ id: `K${index}`, Subject: 'Call', Call_Start_Time: at(2) })) }) });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/flash-review/mis`;
  const ok = await fetch(`${base}?role=psm&employeeId=${employee.id}&month=2026-09`);
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.deepEqual(body.context, { role: 'psm', policy: 'psm', employeeId: employee.id, month: '2026-09' });
  assert.equal(body.items.length, 18);
  assert.equal(body.items.find(item => item.id === 'psm_w1').value, '1');
  assert.equal(body.items.find(item => item.id === 'psm_w4').value, '7');
  assert.equal(body.items.find(item => item.id === 'psm_b_1').value, null);
  assert.deepEqual(body.items.find(item => item.id === 'psm_w1'), { id: 'psm_w1', value: '1', records: 1 });
  assert.deepEqual(body.items.find(item => item.id === 'psm_b_1'), { id: 'psm_b_1', value: null, records: 0 });
  // the records behind a number, each with the address of that record in Zoho CRM
  const behind = await (await fetch(`${base}?role=psm&employeeId=${employee.id}&month=2026-09&item=psm_w1`)).json();
  assert.deepEqual(behind.records, [{ id: 'L1', name: 'Asha Rao', detail: '2026-09-01', url: 'https://crm.zoho.in/crm/org60046349006/tab/Leads/L1' }]);
  assert.deepEqual((await (await fetch(`${base}?role=psm&employeeId=${employee.id}&month=2026-09&item=psm_b_1`)).json()).records, []);
  assert.equal((await fetch(`${base}?role=psm&employeeId=999&month=2026-09`)).status, 400);
  assert.equal((await fetch(`${base}?role=psm&employeeId=${employee.id}&month=2026-13`)).status, 400);
});
