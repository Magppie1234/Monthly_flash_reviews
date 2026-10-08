'use strict';
const {day,dedupe}=require('./flash-mis');
const norm=v=>String(v||'').trim().toLowerCase().replace(/\s+/g,' ');
const number=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
const gaps={
 factory_head:'Employee-linked production, BOM consumption, rework costs, maintenance costs and comparable labour output are not available in the evidence pipeline. Company totals cannot be assigned to this employee.',
 purchase_head:'Procurement savings need MSPL/MLPL identification, employee ownership, comparable quantities and approved baseline prices. These are not established by the ZIP or fetched CRM records.',
 logistics_head:'Freight reduction needs employee-linked shipments, actual freight costs, comparable units and a baseline. Dispatch dates alone do not establish cost savings.',
 installation_manager:'Installation responsibility needs the named installation manager and actual dated work. Loading costs, repeat-visit attribution and a comparable complaint baseline are not established.',
 customer_care_head:'Service ownership is not proof of work performed by the department head. Service request timestamps, verified costs, warranty claims and survey responses are needed for the remaining measures.',
 designer:'No verified events for this responsibility. Complete inputs, working-day deadlines, validation, error attribution, communication logs or survey evidence are needed; order creation is not design completion.'
};
function enrichRoles(e,staged,snapshot,config={}){
 const {policy,employeeId,month}=e.context, name=norm(e.employee.name);
 if(!Object.hasOwn(gaps,policy)&&policy!=='avp')return e;
 for(const item of e.items)if(item.status==='missing_data')item.limitation=gaps[policy]||'AVP responsibilities and assessment policy have not been configured.';
 if(policy==='avp')e.items.push({id:'avp_context_meetings',label:'Owned scheduled meetings · activity context',status:'missing_data',summary:'Manual assessment required',limitation:'AVP policy is pending. Meeting ownership does not prove attendance or commercial outcomes.',records:[],benchmark:'No approved AVP benchmark',suggestedRating:null,importable:false});
 const byId=Object.fromEntries(e.items.map(i=>[i.id,i]));
 const put=(id,records,label,limitation,dataset,source,calculation,value)=>{
  if(!byId[id])return;
  Object.assign(byId[id],{status:records.length?'available':'no_activity',records,dataset,source,summary:records.length?`${value??records.length} ${label.toLowerCase()}; ${records.length} supporting records.`:'No matching activity in accessible records.',display:records.length?{done:String(value??records.length),total:null,label,percent:null,expected:'Context only · assess manually'}:null,limitation,calculation,metric:null,suggestedRating:null,comparisonUnavailable:true});
  if(source){e.liveSource=source;e.identity.liveMatched=true;e.outside=false;e.partial=month===source.asOf.slice(0,7);}
  else {e.identity.matched=true;e.identity.issue='';}
 };
 const archived=staged?.datasets||{}, inArchive=v=>day(v).slice(0,7)===month&&day(v)<=e.source.end;
 if(e.identity.nameUnique&&!e.outside&&policy==='designer'){
  const rows=dedupe(archived.design_records||[],'record_id').rows.filter(r=>norm(r.designer)===name);
  // Approval dates are contextual: the export does not distinguish concept from detailed design.
  const approved=rows.filter(r=>inArchive(r.approval_date)).map(r=>({id:r.record_id,date:day(r.approval_date),stage:r.stage,areaSqft:number(r.total_area_sqft)}));
  if(rows.some(r=>day(r.approval_date)))put('dc_w2',approved,'Dated design approvals','Approval dates from the ZIP do not distinguish concept/detailed stages or verify monthly area output. Current named designer attribution; historical assignments are unavailable.','design_records',null,'Distinct order IDs, exact designer name, approval_date in selected month.');
  if(month===e.source.end.slice(0,7)){
   const revisions=rows.filter(r=>number(r.revisions)!==null).map(r=>({id:r.record_id,date:e.source.end,revisions:number(r.revisions)}));
   if(revisions.length)put('dc_w6',revisions,'Cumulative revisions','Snapshot total across named designer orders, not revisions performed during this month. No comparable team denominator.','design_records',null,'Sum nonmissing cumulative revisions for distinct named designer orders.',revisions.reduce((s,r)=>s+r.revisions,0));
  }
 }
 if(!snapshot?.completedAt||snapshot.org!=='60046349006'||config.liveEnabled===false)return e;
 const asOf=day(snapshot.startedAt);if(month<'2025-11'||month>asOf.slice(0,7))return e;
 const source={name:'Zoho CRM',runId:snapshot.runId,asOf,checkedAt:snapshot.completedAt,calculationVersion:'mis-all-roles-v1'};
 const moduleRows=(module,fields)=>{const m=snapshot.modules[module];return m?.complete&&fields.every(f=>m.fields?.includes(f))?dedupe(m.rows,'id').rows:null;};
 const inMonth=v=>day(v).slice(0,7)===month&&day(v)<=asOf;
 if(policy==='designer'&&e.identity.nameUnique){
  const all=moduleRows('Deals',['Designer_Name','Design_Approved_Date','Number_of_Design_Revisions']);
  if(all){const own=all.filter(r=>norm(r.Designer_Name)===name);
   if(own.length){
    const approved=own.filter(r=>inMonth(r.Design_Approved_Date)).map(r=>({id:r.id,date:day(r.Design_Approved_Date),stage:r.Stage}));
    if(own.some(r=>day(r.Design_Approved_Date)))put('dc_w2',approved,'Dated design approvals','Current exact designer name, not order owner. Design approval does not establish detailed-design area or TAT compliance. Missing approval dates are not inferred.','Deals',source,'Distinct order IDs with Design_Approved_Date in the selected month. Live source replaces overlapping ZIP evidence.');
    if(month===asOf.slice(0,7)){const revisions=own.filter(r=>number(r.Number_of_Design_Revisions)!==null).map(r=>({id:r.id,date:asOf,revisions:number(r.Number_of_Design_Revisions)}));
     if(revisions.length)put('dc_w6',revisions,'Cumulative revisions','Current snapshot only; not this month’s completed revisions or a comparison with the team average.','Deals',source,'Sum populated Number_of_Design_Revisions across distinct named designer orders.',revisions.reduce((s,r)=>s+r.revisions,0));
    }
   }
  }
 }
 if(policy==='installation_manager'&&e.identity.nameUnique){
  const all=moduleRows('Deals',['Installation_Managers','Actual_installation_start_date','Actual_End_Date']);
  if(all){const own=all.filter(r=>norm(r.Installation_Managers)===name),completed=own.filter(r=>inMonth(r.Actual_End_Date));
   const records=completed.map(r=>{const start=day(r.Actual_installation_start_date),end=day(r.Actual_End_Date),days=start?(Date.parse(end)-Date.parse(start))/86400000:null;return {id:r.id,date:end,startDate:start||null,days:days!==null&&days>=0?days:null};});
   const timed=records.filter(r=>r.days!==null),mean=timed.length?timed.reduce((s,r)=>s+r.days,0)/timed.length:null;
   if(own.some(r=>day(r.Actual_End_Date)))put('installation_manager_v2_w1',records,mean===null?'Dated first-install completions':'Average first-install days',`${timed.length}/${records.length} completions have valid start/end dates. Calendar elapsed days, not working days. Current named manager; product eligibility, historical attribution and comparable baseline are unverified. No savings or rating calculated.`,'Deals',source,'Selected named Installation_Managers; Actual_End_Date in month. Mean (end − start) in calendar days over valid nonnegative pairs.',mean===null?undefined:mean.toFixed(1));
  }
 }
 if(policy==='customer_care_head'){
  const all=moduleRows('Visit_Module',['Owner','Completion_Date','Deploy_Date']);
  if(all){const own=all.filter(r=>String(r.Owner?.id)===employeeId);
   if(own.length){const records=own.filter(r=>inMonth(r.Completion_Date)).map(r=>({id:r.id,date:day(r.Completion_Date),visitDate:day(r.Deploy_Date),stage:r.AMS_Status}));
    if(own.some(r=>day(r.Completion_Date)))put('customer_care_head_v2_w1',records,'Owned visits completed','Visit owner is the accountable record owner, not necessarily the worker. Request-received time is unavailable; visit dates cannot establish full service turnaround or departmental performance.','Visit_Module',source,'Distinct Visit_Module IDs, Owner.id matches employee, Completion_Date in selected month.');
   }
  }
 }
 if(policy==='avp'){
  const all=moduleRows('Events',['Owner','Start_DateTime']);
  if(all){const records=all.filter(r=>String(r.Owner?.id)===employeeId&&inMonth(r.Start_DateTime)).map(r=>({id:r.id,date:day(r.Start_DateTime)}));
   put('avp_context_meetings',records,'Owned scheduled meetings','Scheduled events only. Attendance, commercial purpose and outcomes are unverified. AVP policy remains pending; this context cannot be applied as a review rating.','Events',source,'Distinct event IDs, Owner.id and Start_DateTime in review month.');
  }
 }
 return e;
}
module.exports={enrichRoles};
