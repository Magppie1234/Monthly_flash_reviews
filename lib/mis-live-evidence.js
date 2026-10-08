'use strict';
const numeric=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
const date=v=>{if(!v)return '';if(/^\d{4}-\d{2}-\d{2}$/.test(String(v)))return String(v);const t=Date.parse(v);return Number.isFinite(t)?new Date(t+330*60000).toISOString().slice(0,10):'';};
const oid=v=>v?.id?String(v.id):'';
function applyLive(evidence,snapshot,config={}){
 if(config.liveEnabled===false)return evidence;
 if(!snapshot||snapshot.org!=='60046349006'||!snapshot.completedAt)return evidence;
 const {employeeId,month,policy}=evidence.context,asOf=date(snapshot.startedAt);
 if(month<'2025-11'||month>asOf.slice(0,7))return evidence;
 const items=Object.fromEntries(evidence.items.map(i=>[i.id,i])),modules=snapshot.modules;
 const source={name:'Zoho CRM',runId:snapshot.runId,asOf,checkedAt:snapshot.completedAt,calculationVersion:'mis-live-v1'};
 const usable=m=>modules[m]?.complete===true;
 const rows=m=>usable(m)?modules[m].rows:[];
 const inMonth=v=>date(v).slice(0,7)===month&&date(v)<=asOf;
 const fmt=n=>n.toLocaleString('en-IN',{maximumFractionDigits:3});
 let used=0;
 function put(id,module,records,summary,display,limitation,calculation){if(!items[id]||!usable(module)||config.enabledResponsibilities&&!config.enabledResponsibilities.includes(id))return;used++;Object.assign(items[id],{status:records.length?'available':'no_activity',dataset:module,records,summary:records.length?summary:'No matching records in the accessible CRM snapshot.',display:records.length?display:null,limitation,calculation,metric:null,suggestedRating:null,comparisonUnavailable:true,source});}
 const contacts=rows('Contacts'),own=contacts.filter(r=>oid(r.Owner)===employeeId),contactMap=new Map(contacts.map(r=>[r.id,r]));
 if(policy==='psm'){
  const leads=rows('Leads').filter(r=>oid(r.Owner)===employeeId&&inMonth(r.Created_Time));
  put('psm_w1','Leads',leads.map(r=>({id:r.id,date:date(r.Created_Time),sourceRecorded:!!r.Lead_Source,cityRecorded:!!r.City})),`${leads.length} leads created; ${leads.filter(r=>r.Lead_Source&&r.City).length} with source and city.`,{done:fmt(leads.length),total:null,label:'Leads created',percent:null,expected:'Logging time not verified'},'Current CRM owner attribution. Independent enquiry receipt times are unavailable; creation count is not a logging SLA score.','Leads.Created_Time in review month; Owner.id equals selected employee.');
  const calls=rows('Calls').filter(r=>oid(r.Owner)===employeeId&&inMonth(r.Call_Start_Time));
  put('psm_w4','Calls',calls.map(r=>({id:r.id,date:date(r.Call_Start_Time),talkSeconds:numeric(r.Call_Duration_in_seconds),status:r.Outgoing_Call_Status||r.Call_Result||'Not recorded',relatedRecord:oid(r.Who_Id)||oid(r.What_Id)||null})),`${calls.length} calls; ${fmt(calls.reduce((s,r)=>s+(numeric(r.Call_Duration_in_seconds)||0),0)/60)} recorded talk minutes.`,{done:fmt(calls.length),total:null,label:'Calls recorded',percent:null,expected:'Contact coverage not verified'},'Call owner ID and call start time are used. Missing duration is excluded from recorded talk time, not evidence of no conversation. Calls are not a verified assigned-lead or WhatsApp denominator.','Distinct Calls IDs; selected Owner.id; Call_Start_Time in review month. Replaces overlapping ZIP call evidence, never adds the same activity twice.');
  const histories=rows('Lead_Status_History').filter(r=>oid(r.Lead_Owner)===employeeId&&inMonth(r.Modified_Time));
  put('psm_w5','Lead_Status_History',histories.map(r=>({id:r.id,leadId:oid(r.Full_Name),date:date(r.Modified_Time),status:r.Lead_Status})),`${histories.length} lead-status history entries across ${new Set(histories.map(r=>oid(r.Full_Name))).size} leads.`,{done:fmt(histories.length),total:null,label:'Lead status updates',percent:null,expected:'Qualification SLA not verified'},'History Lead_Owner is the attributed PSM; Modified_By is not treated as work ownership. State transitions are evidence, not proof of timely qualification. Assignment clocks and business-day rules are still needed.','Lead_Status_History.Modified_Time in month; stable Lead_Owner.id matching.');
  const qualified=contacts.filter(r=>oid(r.Sales_Manager)===employeeId&&inMonth(r.Lead_Qualified_Date1));const valued=qualified.filter(r=>numeric(r.Amount)!==null);
  put('psm_w6','Contacts',qualified.map(r=>({id:r.id,date:date(r.Lead_Qualified_Date1),valueLacs:numeric(r.Amount)})),`${qualified.length} dated qualified opportunities; ₹${fmt(valued.reduce((s,r)=>s+Number(r.Amount),0)/100)} Cr current BD value (${valued.length} populated).`,{done:fmt(qualified.length),total:null,label:'Qualified opportunities',percent:null,expected:'Event-time value not verified'},'Sales_Manager is the PSM field in this CRM. Qualification date is used, but current BD value and current PSM assignment are not historical event-time facts; do not auto-fill achievement.','Contacts.Lead_Qualified_Date1 in month, Sales_Manager.id matches employee. Current Amount is labelled BD value (lakh); divided by 100 for context only.');
 }else if(['sales_manager','asm'].includes(policy)){
  const booking=own.filter(r=>inMonth(r.Actual_Closure_Date));const valued=booking.filter(r=>numeric(r.Total_Opportunity_Value)!==null);const sum=valued.reduce((s,r)=>s+Number(r.Total_Opportunity_Value),0)/100;
  put(policy==='asm'?'asm_w8':'sm_w6','Contacts',booking.map(r=>({id:r.id,date:date(r.Actual_Closure_Date),stage:r.Stage,valueLacs:numeric(r.Total_Opportunity_Value)})),`${booking.length} opportunities with actual closure dates; ₹${fmt(sum)} Cr recorded value (${valued.length} populated).`,{done:valued.length?fmt(sum):'—',total:null,label:'Dated closures · ₹ Cr',percent:null,expected:'Booking eligibility needs review'},'Current sales Owner attribution; current value and closure date alone do not establish historical ownership or the final business-closed eligibility rule. These are closure-dated records, not an automatically scored booking total.','Contacts.Actual_Closure_Date in month; Owner.id matching; Total_Opportunity_Value is labelled lakh in live metadata; sum populated values / 100.');
  const meetings=rows('Events').filter(r=>oid(r.Owner)===employeeId&&inMonth(r.Start_DateTime));
  if(policy==='sales_manager'){
   const history=rows('Opportunity_Stage_History').filter(r=>oid(r.Contact_Owner)===employeeId&&inMonth(r.Modified_Time));
   for(const [id,stages,label] of [['sm_w2',['Price Discussion','Price discussion'],'Price-discussion entries'],['sm_w3',['Order Booked'],'Order-booked entries']]){
    const matched=history.filter(r=>stages.includes(r.Stage)),ids=new Set(matched.map(r=>oid(r.Full_Name)));
    put(id,'Opportunity_Stage_History',matched.map(r=>({id:r.id,opportunityId:oid(r.Full_Name),date:date(r.Modified_Time),stage:r.Stage})),`${ids.size} opportunities; ${matched.length} recorded stage entries.`,{done:fmt(ids.size),total:null,label,percent:null,expected:'Conversion cohort not agreed'},'Recorded stage entries only; not a proposal/negotiation conversion rate. Repeated entries count once per opportunity in the headline. History owner IDs are used, not the editor.','Filter exact source stages, selected Contact_Owner.id and Modified_Time month; count distinct Full_Name IDs.');
   }
  }
  const eventRecords=meetings.map(r=>({id:r.id,date:date(r.Start_DateTime),checkIn:date(r.Check_In_Time)||null,status:r.Check_In_Status||'Not recorded'}));
  put(policy==='asm'?'asm_w12':'sm_w12','Events',eventRecords,`${meetings.length} scheduled meetings; ${meetings.filter(r=>r.Check_In_Time).length} check-in timestamps.`,{done:fmt(meetings.length),total:null,label:'Meetings scheduled',percent:null,expected:'AVP attendance not verified'},'Scheduled time and host ownership do not prove the meeting was held, commercial purpose, or AVP attendance. No target progress or rating is inferred.','Events.Start_DateTime in month; host Owner.id matches employee.');
  if(policy==='asm'){
   put('asm_w5','Events',eventRecords,`${meetings.length} scheduled meetings; ${meetings.filter(r=>r.Check_In_Time).length} check-ins recorded.`,{done:fmt(meetings.filter(r=>r.Check_In_Time).length),total:fmt(meetings.length),label:'Check-ins / scheduled',percent:null,expected:'Attendance outcome incomplete'},'Check-ins are evidence only; absent check-ins are not missed appointments. Rescheduling and completed/cancelled outcomes need validation.','Distinct event IDs by scheduled start and host ID.');
   const lost=own.filter(r=>inMonth(r.Lead_Drop_Date));put('asm_w11','Contacts',lost.map(r=>({id:r.id,date:date(r.Lead_Drop_Date),reasonRecorded:!!r.Lead_Drop_Reason})),`${lost.length} dropped opportunities; ${lost.filter(r=>r.Lead_Drop_Reason).length} reasons recorded.`,{done:fmt(lost.filter(r=>r.Lead_Drop_Reason).length),total:fmt(lost.length),label:'Reasons / dropped',percent:null,expected:'Reason validity not verified'},'Nonblank source reason is not proof of a valid mandatory reason code; current sales owner is used.','Lead_Drop_Date in month and stable Owner ID; distinct Contacts IDs.');
  }
  // Current snapshots must never masquerade as historical month-end records.
  if(month===asOf.slice(0,7)){
   if(policy==='sales_manager'&&usable('Opportunity_Stage_History')){
    const latest=new Map();for(const r of rows('Opportunity_Stage_History')){const id=oid(r.Full_Name),prior=latest.get(id);if(date(r.Modified_Time)>asOf)continue;if(!prior||Date.parse(r.Modified_Time)>Date.parse(prior.Modified_Time))latest.set(id,r);}
    const ages=own.map(r=>{const h=latest.get(r.id),age=h&&h.Stage===r.Stage&&oid(h.Contact_Owner)===employeeId?Math.floor((Date.parse(snapshot.startedAt)-Date.parse(h.Modified_Time))/86400000):null;return {id:r.id,date:asOf,stage:r.Stage,stageDays:age!==null&&age>=0?age:null};});
    const known=ages.filter(r=>r.stageDays!==null),mean=known.length?known.reduce((s,r)=>s+r.stageDays,0)/known.length:null;
    put('sm_w10','Contacts',ages,`${known.length} verified current stage ages across ${ages.length} owned opportunities.`,{done:mean===null?'—':mean.toFixed(1),total:null,label:'Average stage age · days',percent:null,expected:`${known.length}/${ages.length} dated · all stages`},'All currently owned stages, including terminal stages. Latest history must match current stage and owner. No historical frozen forecast exists, so forecast accuracy remains manual.','Latest Opportunity_Stage_History per Contact; integer elapsed days to snapshot start; average only matching current owner/stage.');
   }
   const actionable=own.filter(r=>r.Next_Action),follow=own.filter(r=>r.Next_Follow_Up_Date1||r.Next_Follow_UP_Date);
   put(policy==='asm'?'asm_w10':'sm_w9','Contacts',own.map(r=>({id:r.id,date:asOf,stage:r.Stage,nextActionRecorded:!!r.Next_Action,followUp:date(r.Next_Follow_Up_Date1||r.Next_Follow_UP_Date)||null})),`${own.length} owned opportunities (all current stages); ${actionable.length} next actions and ${follow.length} follow-up dates recorded.`,{done:fmt(actionable.length),total:fmt(own.length),label:'Actions / current portfolio',percent:null,expected:policy==='asm'?'Open-stage scope not verified':'Team scope not verified'},'Current personal portfolio across all stages. Missing actions and an unverified open-stage/team denominator prevent a compliance score.','Current Contacts.Owner.id; separately count populated next-action and follow-up fields. Snapshot only.');
   if(policy==='asm'&&usable('Contacts')){
    const orders=rows('Deals').filter(r=>oid(contactMap.get(oid(r.Opportunity_Name))?.Owner)===employeeId),revised=orders.filter(r=>numeric(r.Number_of_Design_Revisions)!==null);
    put('asm_w7','Deals',revised.map(r=>({id:r.id,opportunityId:oid(r.Opportunity_Name),date:asOf,revisions:numeric(r.Number_of_Design_Revisions)})),`${revised.reduce((s,r)=>s+Number(r.Number_of_Design_Revisions),0)} cumulative revisions across ${revised.length} linked orders.`,{done:fmt(revised.reduce((s,r)=>s+Number(r.Number_of_Design_Revisions),0)),total:null,label:'Cumulative revisions',percent:null,expected:'Snapshot, not monthly work'},'Order → Opportunity_Name → Contacts.Owner stable-ID join. Cumulative revisions do not measure monthly ASM work or revisions before preferred-direction signoff.','Sum populated Number_of_Design_Revisions across uniquely linked orders at snapshot date.');
   }
  }
 }
 if(used){evidence.liveSource=source;evidence.outside=false;evidence.partial=month===asOf.slice(0,7);evidence.identity.liveMatched=true;evidence.identity.issue='';}
 return evidence;
}
module.exports={applyLive,date};
