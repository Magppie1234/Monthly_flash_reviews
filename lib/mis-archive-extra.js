'use strict';
const norm=x=>String(x||'').trim().toLowerCase().replace(/\s+/g,' ');
const number=x=>x===null||x===undefined||x===''?null:Number.isFinite(Number(x))?Number(x):null;
function enrichArchive(evidence,staged){
 if(!staged||!evidence.identity.matched)return evidence;
 const {month,policy}=evidence.context,name=norm(evidence.employee.name),byId=Object.fromEntries(evidence.items.map(i=>[i.id,i]));
 const data=staged.datasets||{};
 const hygiene=byId[policy==='asm'?'asm_w10':'sm_w9'];
 if(hygiene?.records?.length&&!hygiene.records.some(r=>r.nextActionRecorded)){
  hygiene.comparisonUnavailable=true;hygiene.display={done:String(hygiene.records.length),total:null,label:'Opportunities in snapshot',percent:null,expected:'Next actions not recorded'};
  hygiene.summary=`${hygiene.records.length} opportunities; next-action evidence is missing. No compliance score calculated.`;
 }
 const response=byId.psm_w3;
 if(response?.records?.length){response.comparisonUnavailable=true;response.display={done:String(response.records.filter(r=>r.responseDate&&r.status==='Employee response recorded').length),total:String(response.records.length),label:'Recorded responses / assigned',percent:null,expected:'Response history incomplete'};}
 if(month!==evidence.source.end.slice(0,7))return evidence;
 const put=(id,rows,summary,display,limitation,dataset,calculation)=>{if(!byId[id]||!rows.length)return;Object.assign(byId[id],{status:'available',records:rows,summary,display,limitation,dataset,calculation,metric:null,comparisonUnavailable:true});};
 if(policy==='sales_manager'){
  const rows=(data.sales_active_opportunities||[]).filter(r=>norm(r.sales_person)===name).map(r=>({id:r.contact_id,date:evidence.source.end,stage:r.stage,stageEntered:r.stage_history_checked&&/^\d+$/.test(String(r.stage_history_id))?r.stage_entered_at:null,stageDays:r.stage_history_checked&&/^\d+$/.test(String(r.stage_history_id))?number(r.stage_days):null,forecastDate:r.est_closure_date||null,valueLacs:number(r.value_lacs)}));
  const aged=rows.filter(r=>r.stageDays!==null&&r.stageDays>=0),average=aged.length?aged.reduce((s,r)=>s+r.stageDays,0)/aged.length:null;
  put('sm_w10',rows,`${rows.length} active opportunities; ${aged.length} verified stage ages${average===null?'':`; average ${average.toFixed(1)} days`}.`,{done:average===null?'—':average.toFixed(1),total:null,label:'Average stage age · days',percent:null,expected:`${aged.length} of ${rows.length} records dated`},'September 18 snapshot only. Current expected closure dates are not a frozen forecast, so forecast accuracy is not scored.','sales_active_opportunities','Mean nonnegative source stage_days only where a numeric stage-history ID and checked history exist. Forecast dates are context, not a historical forecast baseline.');
 }
 if(policy==='asm'){
  const owners=new Map();for(const key of ['sales_qualification_details','sales_active_opportunities'])for(const r of data[key]||[]){const id=r.record_id||r.contact_id;if(!owners.has(id))owners.set(id,new Set());owners.get(id).add(norm(r.sales_person));}
  const seen=new Set(),rows=[];for(const r of data.design_records||[]){const linked=owners.get(r.opportunity_id);if(seen.has(r.record_id)||norm(r.sales_manager)!==name||linked?.size!==1||!linked.has(name)||number(r.revisions)===null)continue;seen.add(r.record_id);rows.push({id:r.record_id,opportunityId:r.opportunity_id,date:r.snapshot_date,revisions:number(r.revisions)});}
  const total=rows.reduce((s,r)=>s+r.revisions,0);
  put('asm_w7',rows,`${total} cumulative design revisions across ${rows.length} linked orders.`,{done:String(total),total:null,label:'Cumulative revisions',percent:null,expected:`${rows.length} linked orders · snapshot`},'Snapshot context only; revisions cannot be attributed to this month or to ASM actions. Order sales-manager name must agree with the linked opportunity owner.','design_records','Distinct order IDs joined to an unambiguous opportunity owner; sum source cumulative revisions. No monthly revision-rate score.');
 }
 return evidence;
}
module.exports={enrichArchive};
