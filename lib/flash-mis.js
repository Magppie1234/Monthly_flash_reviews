'use strict';
const fs=require('node:fs'),path=require('node:path');
const {buildReviewDirectory}=require('./flash-review-directory');
const {constants}=require('../public/flash-review');
const ALLOWED=Object.keys(constants.ROLE_CONFIGS);
const norm=s=>String(s||'').trim().toLowerCase().replace(/\s+/g,' ');
const num=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
const day=v=>{if(!v)return '';const s=String(v);if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;if(!Number.isFinite(Date.parse(s)))return '';return new Date(Date.parse(s)+330*60000).toISOString().slice(0,10);};
const avg=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
function dedupe(rows,key){const seen=new Map(),conflicts=new Set();for(const row of rows){const id=row[key];if(!id)continue;if(seen.has(id)&&JSON.stringify(seen.get(id))!==JSON.stringify(row))conflicts.add(id);else seen.set(id,row);}return {rows:[...seen].filter(([id])=>!conflicts.has(id)).map(([,v])=>v),conflicts:conflicts.size};}
function buildEvidence(bundle,directory,roster,{role,employeeId,month}){
 if(!ALLOWED.includes(role)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||''))throw Error('Invalid review selection');
 const employee=directory.roles[role]?.employees.find(p=>p.id===employeeId);
 if(!employee)throw Error('Employee is not assigned to this workbook');
 const policy=employee.policyRoleId||role;if(!ALLOWED.includes(policy))throw Error('Workbook does not support MIS');
 const c=constants.ROLE_CONFIGS[policy],source=bundle.source;
 const people=new Map(roster.employees.filter(p=>p.status==='active').map(p=>[p.id,p]));for(const group of Object.values(directory.roles))for(const p of group.employees)people.set(p.id,p);
 const name=norm(employee.name),matches=[...people.values()].filter(p=>norm(p.name)===name);
 const identity=matches.length===1&&matches[0].id===employeeId;
 const end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10);
 const outside=month<source.start.slice(0,7)||month>source.end.slice(0,7);
 const partial=!outside&&(month+'-01'<source.start||end>source.end);
 const datasetNames=new Set(Object.values(bundle.datasets).flat().flatMap(r=>[r.sales_person,r.bd_name,r.owner,r.responder]).filter(Boolean).map(norm));
 const available=identity&&datasetNames.has(name)&&!outside;
 const context={role,policy,employeeId,month};
 const items=[...c.workItems,...c.behaviouralItems,...c.foundationalItems].map(item=>({id:item.id,label:item.label,status:'missing_data',summary:'Manual assessment required',limitation:'The archive does not establish this responsibility: supporting events, benchmark or audit evidence are missing.',records:[],suggestedRating:null,benchmark:item.referenceTarget||item.label.match(/target[^)]*|minimum \d+[^)]*/i)?.[0]||'Reviewer-defined or unavailable'}));
 const byId=Object.fromEntries(items.map(i=>[i.id,i]));
 const make=(id,key,owner,date,idField,calculate,explanation,limit,options={})=>{
  if(!available)return;
  const sourceRows=bundle.datasets[key];if(!Array.isArray(sourceRows))return;
  const deduped=dedupe(sourceRows,idField);
  const rows=deduped.rows.filter(r=>norm(r[owner])===name&&(!date||day(r[date]).slice(0,7)===month)&&(!date||day(r[date])<=source.end)&&(!options.filter||options.filter(r)));
  const result=calculate(rows),item=byId[id];
  const measuredFields={bd_call_records:['attempts','talk_seconds'],bd_records:['bd_value']}[key]||[];
  const incomplete=measuredFields.filter(field=>rows.some(r=>num(r[field])===null));
  if(incomplete.length){result.summary=`${rows.length} records; ${incomplete.join(', ')} incomplete or unavailable. Inspect individual records; missing values are not zero.`;result.metric=null;}
  Object.assign(item,{status:rows.length?'available':'no_activity',summary:rows.length?result.summary:'No matching activity in the exported records.',limitation:limit+(deduped.conflicts?` ${deduped.conflicts} conflicting record IDs excluded from this dataset.`:''),calculation:explanation,dataset:key,records:result.records||rows.map(r=>({id:r[idField],date:date?day(r[date]):source.end})),metric:result.metric??null});
  if(!rows.length&&deduped.conflicts){item.status='missing_data';item.summary='No reliable matching activity; conflicting source records were excluded. Manual assessment required.';}
 };
 if(policy==='psm'){
  byId.psm_w3.limitation='First-response history starts '+source.responseStart+'; earlier months cannot be assessed from this archive.';
  if(month>=source.responseStart.slice(0,7))make('psm_w3','psm_first_response_records','owner','assigned_at','record_id',rows=>{
   const observed=rows.filter(r=>r.first_response_at&&norm(r.responder)===name&&num(r.response_time_minutes)!==null&&num(r.response_time_minutes)>=0);
   const mean=avg(observed.map(r=>num(r.response_time_minutes)));
   return {summary:`${rows.length} assigned leads; ${observed.length} observed responses by this employee${mean===null?'':`; average ${mean.toFixed(1)} minutes`}.`,records:rows.map(r=>({id:r.record_id,date:day(r.assigned_at),responseDate:day(r.first_response_at),minutes:norm(r.responder)===name?num(r.response_time_minutes):null,status:norm(r.responder)===name?'Employee response recorded':r.responder?'Response by another employee — excluded':'No response captured'}))};
  },'Assignment-month cohort. Average of non-negative response_time_minutes where responder matches the selected employee.','Response history begins '+source.responseStart+'. Responses are observed through the snapshot date and may occur after the cohort month. Other responders are excluded from timing; no agreed response window is supplied.');
  make('psm_w4','bd_call_records','bd_name','call_date','call_id',rows=>({summary:`${rows.length} call records; ${rows.reduce((s,r)=>s+(num(r.attempts)||0),0)} recorded attempts; ${(rows.reduce((s,r)=>s+(num(r.talk_seconds)||0),0)/60).toFixed(1)} talk minutes.`,records:rows.map(r=>({id:r.call_id,date:day(r.call_date),attempts:num(r.attempts),talkSeconds:num(r.talk_seconds)}))}),'Distinct call IDs by call date and named caller.','Counts are work evidence only. The export does not establish a complete assigned-lead denominator, two-way interaction or WhatsApp coverage.');
  make('psm_w6','bd_records','bd_name','created_date','record_id',rows=>{const valued=rows.filter(r=>num(r.bd_value)!==null);return {summary:`${rows.length} qualified records created; ₹${(valued.reduce((s,r)=>s+num(r.bd_value),0)/100).toFixed(3)} Cr source Amount (${valued.length}/${rows.length} values recorded).`,records:rows.map(r=>({id:r.record_id,date:day(r.created_date),valueLacs:num(r.bd_value)}))};},'Sum of bd_value (source Contacts.Amount in lakh) ÷ 100. Filtered by qualified-record creation date.','Context only: record creation is the source export’s proxy and does not verify when value moved to Qualified. Do not substitute this for a verified monthly qualification achievement.');
 }else if(['sales_manager','asm'].includes(policy)){
  byId[policy==='asm'?'asm_w10':'sm_w9'].limitation='Only the '+source.end+' active-opportunity snapshot is available; historical month-end hygiene cannot be assessed.';
  make(policy==='asm'?'asm_w8':'sm_w6','sales_closure_details','sales_person','sort_date','record_id',rows=>{
   const valued=rows.filter(r=>num(r.value)!==null),total=valued.reduce((s,r)=>s+num(r.value),0)/100;
   return {summary:`${rows.length} closures; ${valued.length?`₹${total.toFixed(3)} Cr booked`:'Booking values unavailable'} (${valued.length}/${rows.length} values recorded).`,metric:valued.length===rows.length&&rows.length?{value:total,unit:'₹ Cr'}:null,records:rows.map(r=>({id:r.record_id,date:day(r.sort_date),valueLacs:num(r.value)}))};
  },'Deduplicate Contacts record IDs; filter actual closure date; sum source value in lakh ÷ 100.','Uses source snapshot owner attribution and filtered business records. Historical reassignment and completeness against all CRM records are not verified.');
  if(month===source.end.slice(0,7))make(policy==='asm'?'asm_w10':'sm_w9','sales_active_opportunities','sales_person',null,'contact_id',rows=>{
   const count=rows.filter(r=>String(r.next_action||'').trim()&&day(r.follow_up_date_time||r.follow_up_date)).length;
   return {summary:`${count}/${rows.length} exported active opportunities have a next action and valid follow-up date (${rows.length?(100*count/rows.length).toFixed(1):'—'}%).`,records:rows.map(r=>({id:r.contact_id,date:source.end,nextActionRecorded:!!String(r.next_action||'').trim(),followUp:day(r.follow_up_date_time||r.follow_up_date)}))};
  },'Snapshot completeness: next action present AND valid follow-up date.','Snapshot at '+source.end+' only, not daily or historical month-end compliance. For Sales Managers this is personal portfolio evidence, not a team rollup.');
  if(policy==='asm')make('asm_w11','sales_attrition_summary','sales_person','drop_date','record_id',rows=>{
   const count=rows.filter(r=>String(r.drop_reason||'').trim()).length;return {summary:`${count}/${rows.length} exported dropped opportunities have a recorded reason.`,records:rows.map(r=>({id:r.record_id,date:day(r.drop_date),reasonRecorded:!!String(r.drop_reason||'').trim()}))};
  },'Distinct opportunities dropped in the selected month; count nonblank drop reasons.','A nonblank reason does not establish whether the mandatory reason code is valid.');
 }
 const goalRows=policy==='psm'?bundle.goals.psm:bundle.goals.sales;
 const goal=goalRows.filter(r=>norm(r.owner)===name);
 const target=goal.length===1?(policy==='psm'?num(goal[0].targetCr):num(goal[0].salesTargetCr)):null;
 const targetReference=target!==null?`₹${target} Cr monthly reference; source period ${bundle.goals.period}. Confirm before using for this review.`:'No unambiguous individual target found in the goals snapshot.';
 const reason=!identity?'Employee identity is ambiguous in the directory.':!datasetNames.has(name)?'No exact employee-name match in the archive. Aliases are not inferred.':outside?'Selected month is outside archive coverage.':'';
 if(reason)items.forEach(i=>{i.limitation=reason;});
 for(const item of items)if(!c.workItems.some(w=>w.id===item.id))item.limitation='Manual assessment required: activity counts do not establish behaviour or foundational performance.';
 return {context,employee:{id:employee.id,name:employee.name},source,partial,outside,identity:{nameUnique:identity,matched:available,method:'Unique exact name in archive, resolved to the selected local CRM employee ID; no fuzzy matching',issue:reason},targetReference,items};
}
let cached,staged,pipelineSnapshot,pipelineMtime=0,inflight,attemptAt=0;
const evidenceCache=new Map();
function mountMis(app,root){app.get('/api/flash-review/mis',(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 try{
  const mapping=JSON.parse(fs.readFileSync(path.join(root,'config/flash-review-roles.json'))),roster=JSON.parse(fs.readFileSync(path.join(root,'data/flash-review-roster.json')));
  const directory=buildReviewDirectory(roster,mapping);
  const metricConfig=JSON.parse(fs.readFileSync(path.join(root,'config/mis-metrics.json')));
  cached ||= JSON.parse(fs.readFileSync(path.join(root,'.private/mis-evidence.json')));
  let result=buildEvidence(cached,directory,roster,req.query);
  const stagedFile=path.join(root,'.private/mis-archive-staged.json');
  if(!staged&&fs.existsSync(stagedFile))staged=JSON.parse(fs.readFileSync(stagedFile));
  result=require('./mis-archive-extra').enrichArchive(result,staged);
  const liveFile=path.join(root,'.private/mis-pipeline/current.json');
  if(fs.existsSync(liveFile)){const stamp=fs.statSync(liveFile).mtimeMs;if(stamp!==pipelineMtime){pipelineSnapshot=JSON.parse(fs.readFileSync(liveFile));pipelineMtime=stamp;evidenceCache.clear();}}
  const cacheKey=[pipelineSnapshot?.runId||'archive',req.query.role,req.query.employeeId,req.query.month,JSON.stringify(mapping),JSON.stringify(roster),JSON.stringify(metricConfig)].join('|');
  if(!evidenceCache.has(cacheKey)){
   result=require('./mis-live-evidence').applyLive(result,pipelineSnapshot,metricConfig);
   result=require('./mis-all-roles').enrichRoles(result,staged,pipelineSnapshot,metricConfig);
   evidenceCache.set(cacheKey,JSON.stringify(result));if(evidenceCache.size>100)evidenceCache.delete(evidenceCache.keys().next().value);
   const key=require('node:crypto').createHash('sha256').update(cacheKey).digest('hex');
   require('./mis-pipeline').atomic(path.join(root,'.private/mis-pipeline/evidence',key+'.json'),result);
  }else result=JSON.parse(evidenceCache.get(cacheKey));
  const statusFile=path.join(root,'.private/mis-pipeline/status.json');
  let status;try{status=JSON.parse(fs.readFileSync(statusFile));}catch{}
  const stale=!pipelineSnapshot||Date.now()-Date.parse(pipelineSnapshot.startedAt)>Math.max(15,Number(metricConfig.refreshAfterMinutes)||60)*60000;
  if(metricConfig.liveEnabled&&stale&&!inflight&&Date.now()-attemptAt>300000){attemptAt=Date.now();inflight=require('./mis-pipeline').runPipeline(root).catch(()=>{}).finally(()=>{inflight=null;});}
  result.refresh={running:!!inflight||status?.state==='running',stale,failed:status?.state==='failed'};
  return res.json(result);
 }catch(error){const absent=error.code==='ENOENT';res.status(absent?503:400).json({error:absent?'Archive evidence has not been prepared. Manual review remains available.':'Unable to fetch MIS for this selection. Check the workbook, employee and month.'});}
});}
module.exports={buildEvidence,mountMis,dedupe,day};
