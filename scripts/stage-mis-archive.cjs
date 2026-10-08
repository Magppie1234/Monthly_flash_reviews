'use strict';
// ZIP-only staging for the MIS plan. Not published or imported into reviews.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),base=path.join(root,'.private/mis-handover-2026-09-18/MAGPPIE_AI_Project_Handover_2026-09-18/source/public/data');
const input=path.join(base,'performance_dashboard.json'),data=JSON.parse(fs.readFileSync(input));
const fields={
 sales_qualification_details:['record_id','module','created_date','opportunity_created_time','opportunity_created_date','sales_person','qualification_person','value_lacs'],
 sales_active_opportunities:['contact_id','sales_person','created_date','lead_qualified_date','status','stage','project_stage','stage_history_id','stage_history_checked','stage_entered_at','stage_days','est_closure_date','est_closure_month','date_change_count','follow_up_date','follow_up_date_time','next_action','avp_meeting','value_lacs'],
 sales_first_response_records:['record_id','contact_id','owner','responder','created_at','lead_qualified_date','first_response_at','first_response_stage','stage_history_id','response_time_minutes','response_status','value_lacs'],
 psm_first_response_records:['record_id','lead_id','owner','responder','created_at','assigned_at','walk_in','first_response_at','first_response_stage','status_history_id','response_time_minutes','response_status','lead_status','lead_disposition','lead_drop_date','modified_at','converted'],
 psm_not_interested_records:['record_id','lead_id','owner','lead_status','status_history_id','status_history_status','status_history_modified_time','not_interested_at','lead_drop_date','created_at','assigned_at'],
 bd_call_records:['call_id','bd_name','call_date','call_start_time','call_status','call_type','call_result','call_purpose','outgoing_call_status','who_id','what_id','se_module','talk_seconds','connected_proxy','attempts'],
 design_records:['record_id','module','designer','sales_manager','stage','created_date','order_created_date','opportunity_id','approval_date','revisions','revision_type','stage_duration_days','snapshot_date','total_area_sqft','revision_area_sqft']
};
fields.installation_records=['record_id','installation_manager','stage','status','stage_date','created_date','stage_days'];
fields.ams_service_records=['record_id','owner','record_type','status','scheduled_date','created_date','completion_date','is_done'];
const result={source:{archive:'MAGPPIE_AI_Project_Handover_2026-09-18.zip',snapshot:data.meta.generated_at,sha256:crypto.createHash('sha256').update(fs.readFileSync(input)).digest('hex')},status:'staged-not-published',datasets:{}};
for(const [name,keys] of Object.entries(fields)){const rows=Array.isArray(data[name])?data[name]:Object.values(data[name]||{}).flat();result.datasets[name]=rows.map(r=>Object.fromEntries(keys.map(k=>[k,r[k]??null])));}
const orders=JSON.parse(fs.readFileSync(path.join(base,'order_pipeline.json')));
const orderKeys=['id','stage','owner','salesperson','createdDate','valueLacs','discountAmount','managementDiscount','designApprovedDate','handoverDate'];
result.orderSource={file:'order_pipeline.json',sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(base,'order_pipeline.json'))).digest('hex')};
result.datasets.orders=(orders.orders||[]).map(r=>Object.fromEntries(orderKeys.map(k=>[k,r[k]??null])));
const summary=Object.fromEntries(Object.entries(result.datasets).map(([k,rows])=>[k,{count:rows.length,fields:Object.fromEntries(Object.keys(rows[0]||{}).map(f=>[f,rows.filter(r=>r[f]!==null&&r[f]!==undefined&&r[f]!=='').length]))}]));
fs.writeFileSync(path.join(root,'.private/mis-archive-staged.json'),JSON.stringify(result));
fs.writeFileSync(path.join(root,'.private/mis-archive-staged-summary.json'),JSON.stringify(summary,null,2));
console.log(JSON.stringify(Object.fromEntries(Object.entries(summary).map(([k,v])=>[k,v.count])),null,2));
