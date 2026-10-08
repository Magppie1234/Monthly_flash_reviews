'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildEvidence,day}=require('../lib/flash-mis');
const ui=require('../public/flash-mis');
const person={id:'123',name:'Alice',status:'active'},other={id:'456',name:'Bob',status:'active'};
const directory={roles:{sales_manager:{employees:[person]},asm:{employees:[person]},psm:{employees:[person]}}};
const roster={employees:[person,other]};
function bundle(){return {source:{archive:'test.zip',file:'performance.json',sha256:'abc',start:'2026-01-01',end:'2026-09-18',responseStart:'2026-09-01'},goals:{period:'May 2026',sales:[],psm:[]},datasets:{sales_closure_details:[{record_id:'1',sales_person:'Alice',sort_date:'2026-08-10',value:100},{record_id:'1',sales_person:'Alice',sort_date:'2026-08-10',value:100},{record_id:'2',sales_person:'Bob',sort_date:'2026-08-10',value:999},{record_id:'3',sales_person:'Alice',sort_date:'2026-07-10',value:50}],sales_active_opportunities:[],sales_attrition_summary:[],bd_records:[],bd_call_records:[],psm_first_response_records:[]}};}
const query=(role='sales_manager',month='2026-08')=>({role,employeeId:'123',month});
const evidence=()=>buildEvidence(bundle(),directory,roster,query());
test('employee/date filtering and record deduplication reconcile booking value',()=>{
 const e=evidence(),item=e.items.find(i=>i.id==='sm_w6');assert.equal(item.metric.value,1);assert.deepEqual(item.records.map(r=>r.id),['1']);assert.equal(e.items.length,22);assert.ok(e.items.every(i=>i.suggestedRating===null));
 const july=buildEvidence(bundle(),directory,roster,query('sales_manager','2026-07'));assert.equal(july.items.find(i=>i.id==='sm_w6').metric.value,.5);
});
test('conflicting ownership excludes a record instead of attributing it twice',()=>{
 const b=bundle();b.datasets.sales_closure_details.push({record_id:'1',sales_person:'Bob',sort_date:'2026-08-10',value:100});const item=buildEvidence(b,directory,roster,query()).items.find(i=>i.id==='sm_w6');assert.equal(item.records.length,0);assert.match(item.limitation,/conflicting/);
});
test('unknown employees, unsupported roles and invalid months are rejected',()=>{
 for(const q of [{...query(),employeeId:'456'},query('designer'),query('sales_manager','2026-13')])assert.throws(()=>buildEvidence(bundle(),directory,roster,q));
 assert.equal(ui.supported('designer'),true);assert.equal(ui.supported('factory_head'),true);assert.equal(ui.supported('unknown'),false);
});
test('ambiguous names and out-of-coverage months produce missing evidence',()=>{
 const ambiguous=buildEvidence(bundle(),directory,{employees:[person,{...other,name:'Alice'}]},query());assert.equal(ambiguous.identity.matched,false);assert.ok(ambiguous.items.every(i=>i.status==='missing_data'));
 const absent=buildEvidence(bundle(),directory,roster,query('sales_manager','2026-10'));assert.equal(absent.outside,true);
 const empty=buildEvidence(bundle(),directory,roster,query('sales_manager','2026-06'));assert.equal(empty.items.find(i=>i.id==='sm_w6').status,'no_activity');
});
test('September is partial and snapshot hygiene is not used for older months',()=>{
 const b=bundle();b.datasets.sales_active_opportunities=[{contact_id:'4',sales_person:'Alice',next_action:'Call',follow_up_date:'2026-09-19'}];
 const sept=buildEvidence(b,directory,roster,query('asm','2026-09'));assert.equal(sept.partial,true);assert.equal(sept.items.find(i=>i.id==='asm_w10').records.length,1);
 assert.equal(buildEvidence(b,directory,roster,query('asm')).items.find(i=>i.id==='asm_w10').status,'missing_data');
});
test('PSM call records use call month; first-response timing excludes another responder',()=>{
 const b=bundle();b.datasets.bd_call_records=[{call_id:'5',bd_name:'Alice',call_date:'2026-09-01',attempts:1,talk_seconds:120},{call_id:'6',bd_name:'Bob',call_date:'2026-09-01',attempts:1,talk_seconds:900}];b.datasets.psm_first_response_records=[{record_id:'7',owner:'Alice',responder:'Bob',assigned_at:'2026-09-01',first_response_at:'2026-09-01',response_time_minutes:10}];
 const e=buildEvidence(b,directory,roster,query('psm','2026-09'));assert.deepEqual(e.items.find(i=>i.id==='psm_w4').records.map(r=>r.id),['5']);assert.equal(e.items.find(i=>i.id==='psm_w3').records[0].minutes,null);assert.match(e.items.find(i=>i.id==='psm_w3').summary,/0 observed responses/);
 assert.equal(day('2026-08-31T20:00:00Z'),'2026-09-01');
});
test('the results column shows the fetched number, or a dash when CRM has none',()=>{
 const shown=ui.values({items:[{id:'psm_w1',value:'259'},{id:'psm_w2',value:null},{id:'psm_w6',value:'₹0.00 Cr'}]});
 assert.equal(shown.get('psm_w1'),'259');assert.equal(shown.get('psm_w2'),'—');assert.equal(shown.get('psm_w6'),'₹0.00 Cr');assert.equal(ui.values(null).size,0);
 const open=ui.openable({items:[{id:'a',value:'5',records:5},{id:'b',value:'0',records:0},{id:'c',value:null,records:0}]});assert.deepEqual([...open],['a']);
 assert.equal(ui.zohoLink('https://crm.zoho.in/crm/org1/tab/Leads/1'),'https://crm.zoho.in/crm/org1/tab/Leads/1');assert.equal(ui.zohoLink('javascript:alert(1)'),'');
});
