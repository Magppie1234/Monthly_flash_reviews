'use strict';
// Reads the supplied archive extraction only. No network access or CRM writes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const base=path.join(root,'.private/mis-handover-2026-09-18/MAGPPIE_AI_Project_Handover_2026-09-18/source/public/data');
const read=name=>JSON.parse(fs.readFileSync(path.join(base,name),'utf8'));
const data=read('performance_dashboard.json'),goals=read('goals_snapshot.json');
if(data.meta?.mock_data!==false||data.meta?.data_contract!=='crm-records-only')throw Error('Unexpected source contract');
const pick=(row,keys)=>Object.fromEntries(keys.map(k=>[k,row[k]??null]));
const fields={
 sales_closure_details:['record_id','module','sales_person','sort_date','value'],
 sales_active_opportunities:['contact_id','sales_person','next_action','follow_up_date','follow_up_date_time'],
 sales_attrition_summary:['record_id','module','sales_person','drop_date','drop_reason'],
 bd_records:['record_id','module','bd_name','created_date','bd_value','inr_value'],
 bd_call_records:['call_id','bd_name','call_date','talk_seconds','attempts','who_id','what_id'],
 psm_first_response_records:['record_id','owner','responder','created_at','assigned_at','first_response_at','response_time_minutes','response_status'],
};
const datasets={};for(const [name,keys] of Object.entries(fields)){
 const rows=Array.isArray(data[name])?data[name]:Object.values(data[name]||{}).flat();
 datasets[name]=rows.map(row=>pick(row,keys));
}
const source={archive:'MAGPPIE_AI_Project_Handover_2026-09-18.zip',file:'source/public/data/performance_dashboard.json',generatedAt:data.meta.generated_at,start:data.meta.period_start,end:data.meta.period_end,responseStart:data.meta.response_history_start,
 sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(base,'performance_dashboard.json'))).digest('hex'),
 exclusions:data.meta.owner_exclusion_counts,ownerPolicy:data.meta.owner_policy,
 limitation:'Historical filtered export, not a complete CRM audit. Named attribution is the snapshot attribution; historical reassignments are not verified.'};
const result={version:1,source,datasets,goals:{period:goals.master?.period,sales:goals.sales?.targets||[],psm:goals.bd?.targets||[]}};
const out=path.join(root,'.private/mis-evidence.json');fs.writeFileSync(out,JSON.stringify(result),{mode:0o600});
console.log(JSON.stringify({source,counts:Object.fromEntries(Object.entries(datasets).map(([k,v])=>[k,v.length])),targetPeriod:result.goals.period},null,2));
