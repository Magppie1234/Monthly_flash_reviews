'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {collect,sanitize,normalize,runPipeline,FIELDS}=require('../lib/mis-pipeline');
const {applyLive}=require('../lib/mis-live-evidence');
const {enrichArchive}=require('../lib/mis-archive-extra');
test('source sanitizer drops names and private fields but retains lookup IDs',()=>{
 assert.deepEqual(sanitize({id:'12',Owner:{id:'34',name:'Person',email:'private'},Phone:'private',Next_Action:'call'},['Owner','Next_Action']),{id:'12',Owner:{id:'34'},Next_Action:'call'});
});
test('pager follows tokens, requires end marker and rejects conflicting duplicates',async()=>{
 const paths=[];let i=0;const client={get:async p=>{paths.push(p);return i++?{data:[{id:'2'}],info:{more_records:false}}:{data:[{id:'1'}],info:{more_records:true,next_page_token:'opaque'}};}};
 const rows=await collect(client,'Contacts',[]);assert.equal(rows.length,2);assert.match(paths[1],/page_token=opaque/);assert.doesNotMatch(paths[1],/[?&]page=/);
 await assert.rejects(collect({get:async()=>({data:[]})},'Contacts',[]),/INCOMPLETE/);
 i=0;await assert.rejects(collect({get:async()=>({data:[{id:'1',Stage:i++?'B':'A'}],info:{more_records:i<2,next_page_token:'t'}})},'Contacts',['Stage']),/SOURCE_CHANGED/);
});
test('failed pipeline keeps prior complete publication and resumes completed modules',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mis-pipeline-test-'));const dir=path.join(root,'.private/mis-pipeline');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'current.json'),JSON.stringify({runId:'old',modules:{}}));let fail=true,reads=0;
 const client={get:async route=>{if(route.startsWith('settings/fields')){const name=new URLSearchParams(route.split('?')[1]).get('module');return {fields:FIELDS[name].map(api_name=>({api_name}))};}reads++;if(fail&&route.startsWith('Leads?'))throw Error('SOURCE_UNAVAILABLE');return {data:[],info:{more_records:false}};}};
 await assert.rejects(runPipeline(root,{client}),/INCOMPLETE_RUN/);assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'current.json'))).runId,'old');
 fail=false;const before=reads;const status=await runPipeline(root,{client});assert.equal(status.state,'complete');assert.equal(reads-before,1);assert.notEqual(JSON.parse(fs.readFileSync(path.join(dir,'current.json'))).runId,'old');
 // Leave the small uniquely named test artifact for diagnosis; no workspace files are modified.
});
function evidence(policy='psm',month='2026-09'){const ids=policy==='psm'?['psm_w1','psm_w3','psm_w4','psm_w5','psm_w6']:['sm_w2','sm_w3','sm_w6','sm_w9','sm_w10','sm_w12'];return {context:{role:policy,policy,employeeId:'1',month},employee:{name:'Alice'},identity:{matched:false},source:{archive:'zip',file:'file',end:'2026-09-18',sha256:'hash'},items:ids.map(id=>({id,label:id,status:'missing_data',records:[]}))};}
function snapshot(){return {org:'60046349006',runId:'run',startedAt:'2026-09-24T09:00:00Z',completedAt:'2026-09-24T09:01:00Z',modules:{}};}
test('live calls use stable owner IDs and IST call month, replace rather than add ZIP rows',()=>{
 const e=evidence(),s=snapshot();s.modules.Calls={complete:true,rows:[{id:'1',Owner:{id:'1'},Call_Start_Time:'2026-08-31T20:00:00Z',Call_Duration_in_seconds:60},{id:'2',Owner:{id:'2'},Call_Start_Time:'2026-09-03'},{id:'3',Owner:{id:'1'},Call_Start_Time:'2026-08-03'}]};
 e.items.find(i=>i.id==='psm_w4').records=[{id:'1'},{id:'old'}];const result=applyLive(e,s),item=result.items.find(i=>i.id==='psm_w4');assert.deepEqual(item.records.map(r=>r.id),['1']);assert.equal(item.display.done,'1');assert.equal(item.metric,null);assert.equal(result.identity.liveMatched,true);
});
test('future months and incomplete modules cannot masquerade as complete live evidence',()=>{
 const s=snapshot();s.modules.Calls={complete:false,rows:[]};assert.equal(applyLive(evidence(),s).liveSource,undefined);s.modules.Calls.complete=true;assert.equal(applyLive(evidence('psm','2026-10'),s).liveSource,undefined);
});
test('archive all-blank next actions disable progress comparisons',()=>{
 const e=evidence('sales_manager');e.identity.matched=true;e.employee.name='Alice';const item=e.items.find(i=>i.id==='sm_w9');item.records=[{id:'a',nextActionRecorded:false}];item.status='available';
 const result=enrichArchive(e,{datasets:{}});assert.equal(item.comparisonUnavailable,true);assert.match(item.summary,/missing/);
});
test('history editor is never normalized as employee actor',()=>{
 const s=snapshot();s.modules.DealHistory={rows:[{id:'3',Modified_By:{id:'9'},Potential_Name:{id:'4'},Modified_Time:'2026-09-01',Stage:'A'}]};const [event]=normalize(s);assert.equal(event.actorId,null);assert.equal(event.editorId,'9');
});
