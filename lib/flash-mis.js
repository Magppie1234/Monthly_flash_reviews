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
// Show formulae: how each row's figure is worked out, for whoever holds the formula code.
// The code is a setting (FORMULA_CODE), never written into this repository.
const wrongGuesses=[];
function formulaCodeMatches(given){
 const crypto=require('node:crypto'),expected=String(process.env.FORMULA_CODE||'');if(!expected)return false;
 const a=crypto.createHash('sha256').update(String(given||'')).digest(),b=crypto.createHash('sha256').update(expected).digest();
 return crypto.timingSafeEqual(a,b);
}
function mountFormulae(app){app.get('/api/flash-review/formulae',(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 if(!process.env.FORMULA_CODE)return res.status(503).json({error:'Formulae are not switched on for this site.'});
 const now=Date.now();while(wrongGuesses.length&&now-wrongGuesses[0]>600000)wrongGuesses.shift();
 if(wrongGuesses.length>=8)return res.status(429).json({error:'Too many wrong codes. Try again in a few minutes.'});
 if(!formulaCodeMatches(req.get('X-Formula-Code'))){wrongGuesses.push(now);return res.status(403).json({error:'That code is not right.'});}
 const role=String(req.query.role||''),config=constants.ROLE_CONFIGS[role];
 if(!config)return res.status(400).json({error:'Unknown workbook.'});
 const live=require('./mis-live-numbers'),ids=role==='avp'?['avp_context_meetings']:[...config.workItems,...config.behaviouralItems,...config.foundationalItems].map(item=>item.id);
 return res.json({role,scoring:'Each rating scores Above 3, Meets 2, Below 1. The month\u2019s score weights Work, Behavioural, Foundational and Target as shown in the Annual summary.',items:Object.fromEntries(ids.map(id=>[id,live.formulaFor(id)]))});
});}
// Fetch MIS: one live number per review row. See lib/mis-live-numbers.js.
let liveClient;
function mountMis(app,root,options={}){mountFormulae(app);app.get('/api/flash-review/mis',async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 const live=require('./mis-live-numbers');
 try{
  // A hosted copy serves CRM figures to whoever can open it, so it must sit behind the access code.
  if(process.env.VERCEL_ENV&&!process.env.ACCESS_CODE)return res.status(503).json({error:'Fetch MIS is switched off on this site until an access code is set.'});
  const {role,employeeId,month}=req.query;
  if(!ALLOWED.includes(role)&&role!=='avp'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||''))return res.status(400).json({error:'Check the workbook, employee and month.'});
  const mapping=JSON.parse(fs.readFileSync(path.join(root,'config/flash-review-roles.json'))),roster=JSON.parse(fs.readFileSync(path.join(root,'data/flash-review-roster.json')));
  const employee=buildReviewDirectory(roster,mapping).roles[role]?.employees.find(p=>p.id===employeeId);
  if(!employee)return res.status(400).json({error:'Employee is not assigned to this workbook.'});
  const policy=employee.policyRoleId||role,config=constants.ROLE_CONFIGS[policy];
  const itemIds=policy==='avp'?['avp_context_meetings']:[...config.workItems,...config.behaviouralItems,...config.foundationalItems].map(item=>item.id);
  let zoho=options.zoho;
  if(!zoho){const creds=live.credentials();if(!creds)return res.status(503).json({error:'Zoho CRM is not connected on this server.'});zoho=liveClient||=live.createZoho(creds);}
  const load=()=>live.fetchNumbers({zoho,policy,employee,month,itemIds});
  const key=[role,employeeId,month].join('|');
  const result=await live.cachedNumbers(key,load);
  if(result.failed)live.forget(key);
  const context={role,policy,employeeId,month};
  // ?item=<row id> returns the CRM records behind that row's number, each with its Zoho address.
  if(req.query.item)return res.json({context,item:String(req.query.item),records:result.records[req.query.item]||[]});
  return res.json({context,fetchedAt:new Date().toISOString(),items:result.items,incomplete:result.failed>0});
 }catch(error){return res.status(502).json({error:error.code==='ORG_MISMATCH'?'This server is connected to a different Zoho organisation.':'Zoho CRM did not answer. Try again in a moment.'});}
});}
module.exports={buildEvidence,mountMis,dedupe,day};
