'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildEvidence}=require('../lib/flash-mis'),{enrichRoles}=require('../lib/mis-all-roles'),ui=require('../public/flash-mis');
const {buildReviewDirectory}=require('../lib/flash-review-directory');
const roster=require('../data/flash-review-roster.json'),directory=buildReviewDirectory(roster,require('../config/flash-review-roles.json'));
const bundle={source:{start:'2025-11-01',end:'2026-09-18',responseStart:'2026-09-01',archive:'test.zip'},datasets:{},goals:{sales:[],psm:[]}};
const make=(role,month='2026-09')=>buildEvidence(bundle,directory,roster,{role,employeeId:directory.roles[role].employees[0].id,month});
const snapshot=(module,fields,rows)=>({org:'60046349006',startedAt:'2026-09-24T10:00:00Z',completedAt:'2026-09-24T10:01:00Z',runId:'test',modules:{[module]:{complete:true,fields,rows}}});
test('every assigned employee in every configured workbook gets isolated evidence',()=>{
 let count=0;for(const [role,group] of Object.entries(directory.roles)){assert.equal(ui.supported(role),true);for(const employee of group.employees){const e=buildEvidence(bundle,directory,roster,{role,employeeId:employee.id,month:'2026-09'});assert.equal(e.employee.id,employee.id);assert.ok(e.items.every(i=>i.status==='missing_data'));count++;}}assert.equal(count,43);
});
test('local designers match exact names, not CRM order owners; approvals change with month',()=>{
 const fields=['Designer_Name','Design_Approved_Date','Number_of_Design_Revisions'];
 const live=snapshot('Deals',fields,[{id:'1',Designer_Name:'Atif Hussain',Design_Approved_Date:'2026-08-31T20:00:00Z',Number_of_Design_Revisions:3},{id:'2',Designer_Name:'Rashi',Design_Approved_Date:'2026-09-01',Number_of_Design_Revisions:99},{id:'3',Designer_Name:'Atif Hussain',Design_Approved_Date:'2026-08-05',Number_of_Design_Revisions:null}]);
 const sept=enrichRoles(make('designer'),null,live);assert.equal(sept.identity.nameUnique,true);assert.deepEqual(sept.items.find(i=>i.id==='dc_w2').records.map(r=>r.id),['1']);assert.equal(sept.items.find(i=>i.id==='dc_w6').display.done,'3');
 const aug=enrichRoles(make('designer','2026-08'),null,live);assert.deepEqual(aug.items.find(i=>i.id==='dc_w2').records.map(r=>r.id),['3']);assert.equal(aug.items.find(i=>i.id==='dc_w6').status,'missing_data');
 const ambiguous=make('designer');ambiguous.identity.nameUnique=false;assert.ok(enrichRoles(ambiguous,null,live).items.every(i=>i.status==='missing_data'));
});
test('missing fields or all missing dates do not become zero output',()=>{
 for(const fields of [[],['Designer_Name','Design_Approved_Date','Number_of_Design_Revisions']]){const live=snapshot('Deals',fields,[{id:'1',Designer_Name:'Atif Hussain',Design_Approved_Date:null}]);assert.equal(enrichRoles(make('designer'),null,live).items.find(i=>i.id==='dc_w2').status,'missing_data');}
});
test('installation timing excludes invalid pairs and other managers',()=>{
 const live=snapshot('Deals',['Installation_Managers','Actual_installation_start_date','Actual_End_Date'],[{id:'1',Installation_Managers:'Rishabh',Actual_installation_start_date:'2026-09-01',Actual_End_Date:'2026-09-07'},{id:'2',Installation_Managers:'Rishabh',Actual_installation_start_date:'2026-09-15',Actual_End_Date:'2026-09-07'},{id:'3',Installation_Managers:'Rishab',Actual_installation_start_date:'2026-09-01',Actual_End_Date:'2026-09-20'}]);
 const e=enrichRoles(make('installation_manager'),null,live),i=e.items[0];assert.equal(i.display.done,'6.0');assert.equal(i.records.length,2);assert.equal(i.records[1].days,null);assert.equal(i.suggestedRating,null);
});
test('new role imports require consent, preserve measurements and undo later manual edits',()=>{
 const e=make('installation_manager');Object.assign(e.items[0],{status:'available',summary:'Evidence',dataset:'Deals'});
 const review={ratings:{},mis:{},remarks:{[e.items[0].id]:'Manual'},measurements:{[e.items[0].id]:{actual:42}}},before=JSON.stringify(review),candidate=ui.candidates(e)[0];assert.equal(JSON.stringify(review),before);
 assert.throws(()=>ui.apply(review,e,[candidate.id],[],e.context),/Explicitly/);
 const applied=ui.apply(review,e,[candidate.id],[candidate.id],e.context);assert.deepEqual(applied.measurements,review.measurements);applied.remarks[e.items[0].id]='Later manual';const undone=ui.undo(applied,e.context);assert.equal(undone.review.remarks[e.items[0].id],'Later manual');assert.deepEqual(undone.review.ratings,{});
});
test('AVP context is read-only; operational gaps never receive unrelated evidence',()=>{
 const live=snapshot('Events',['Owner','Start_DateTime'],[{id:'1',Owner:{id:directory.roles.avp.employees[0].id},Start_DateTime:'2026-09-01'}]);
 const avp=enrichRoles(make('avp'),null,live);assert.equal(avp.items[0].records.length,1);assert.deepEqual(ui.candidates(avp),[]);
 for(const role of ['factory_head','purchase_head','logistics_head'])assert.ok(enrichRoles(make(role),null,live).items.every(i=>i.status==='missing_data'&&i.suggestedRating===null));
});
