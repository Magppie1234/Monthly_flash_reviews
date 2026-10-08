'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ORG='60046349006';
const FIELDS={
 Contacts:['Owner','Sales_Manager','Created_Time','Modified_Time','Stage','Actual_Closure_Date','Total_Opportunity_Value','Amount','Lead_Qualified_Date1','Next_Action','Next_Follow_UP_Date','Next_Follow_Up_Date1','Lead_Drop_Date','Lead_Drop_Reason','Est_Closure_Date'],
 Calls:['Owner','Modified_Time','Call_Start_Time','Call_Duration_in_seconds','Call_Type','Call_Result','Outgoing_Call_Status','Who_Id','What_Id'],
 Events:['Owner','Modified_Time','Start_DateTime','End_DateTime','Who_Id','What_Id','Check_In_Time','Check_In_Status'],
 Leads:['Owner','Created_Time','Modified_Time','Lead_Status','Lead_Source','City','Walk_In','Converted_Contact','Converted_Date_Time'],
 Deals:['Owner','Created_Time','Modified_Time','Opportunity_Name','Stage','Number_of_Design_Revisions','Form_Filled_Date_Time','Send_For_Approval_Date','Design_Approved_Date','Hand_over_received','Handover_Date','Designer_Name','Installation_Managers','Cabinet_Area_Sqft','Backsplash_Area_Sqft','Countertop_Area_Sqft','Actual_installation_start_date','Actual_End_Date'],
 Visit_Module:['Owner','AMS_Status','Completion_Date','Scheduled_Visit_Date','Installation_Manager','Deploy_Date','Total_Cost','Labour_Cost','Status'],
 Lead_Status_History:['Lead_Status','Modified_By','Modified_Time','Full_Name','Lead_Owner','Moved_To__s'],
 Opportunity_Stage_History:['Stage','Modified_By','Modified_Time','Full_Name','Contact_Owner','Sales_Manager','Actual_Closure_Date','Moved_To__s'],
 DealHistory:['Potential_Name','Stage','Modified_By','Modified_Time','Stage_Duration_Calendar_Days','Moved_To__s']
};
function atomic(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(temp,JSON.stringify(value),{mode:0o600});for(let attempt=0;;attempt++){try{fs.renameSync(temp,file);break;}catch(error){if(!["EPERM","EACCES","EBUSY"].includes(error.code)||attempt>=9)throw error;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,50*(attempt+1));}}}
function sanitize(row,fields){const result={id:String(row.id||'')};if(!/^\d+$/.test(result.id))throw Error('INVALID_RECORD_ID');for(const k of fields){const v=row[k];result[k]=v&&typeof v==='object'?(v.id?{id:String(v.id)}:null):v??null;}return result;}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function createClient(root,fetcher=fetch){
 const env=require('dotenv').parse(fs.readFileSync(path.join(root,'.env')));let token;
 async function auth(){const r=await fetcher('https://accounts.zoho.in/oauth/v2/token',{method:'POST',body:new URLSearchParams({grant_type:'refresh_token',client_id:env.ZOHO_CLIENT_ID,client_secret:env.ZOHO_CLIENT_SECRET,refresh_token:env.ZOHO_REFRESH_TOKEN}),signal:AbortSignal.timeout(30000)});const data=await r.json();if(!r.ok||!data.access_token)throw Error('AUTH_FAILED');token=data.access_token;}
 await auth();
 async function get(route){if(!/^(org|settings\/fields\?|[A-Za-z_]+\?)/.test(route))throw Error('READ_ROUTE_REJECTED');
  for(let attempt=0;attempt<4;attempt++){
   let r;try{r=await fetcher('https://www.zohoapis.in/crm/v8/'+route,{headers:{Authorization:'Zoho-oauthtoken '+token},signal:AbortSignal.timeout(30000)});}catch{if(attempt===3)throw Error('SOURCE_UNAVAILABLE');await sleep(500*2**attempt);continue;}
   if(r.status===401&&attempt===0){await auth();continue;}
   if(r.status===429||r.status>=500){if(attempt===3)throw Error('SOURCE_RETRY_EXHAUSTED');await sleep(Math.min(15000,Math.max(1000*2**attempt,Number(r.headers.get('retry-after')||0)*1000)));continue;}
   if(r.status===204)return {data:[],info:{more_records:false}};
   let data;try{data=await r.json();}catch{if(attempt===3)throw Error('INVALID_SOURCE_RESPONSE');await sleep(1000*2**attempt);continue;}if(!r.ok)throw Error(/^[A-Z_]+$/.test(data.code||'')?data.code:'SOURCE_REQUEST_FAILED');return data;
  }throw Error('SOURCE_UNAVAILABLE');
 }
 const org=await get('org');if(org.org?.length!==1||String(org.org[0].zgid)!==ORG)throw Error('ORG_MISMATCH');return {get};
}
async function collect(client,module,fields,onPage=()=>{}){
 const rows=new Map(),seenTokens=new Set();let page=1,token=null;
 for(let requests=0;requests<500;requests++){
  const query=new URLSearchParams({fields:['id',...fields].join(','),per_page:'200',sort_by:'id',sort_order:'asc'});
  if(module==='Leads')query.set('converted','both');
  if(token)query.set('page_token',token);else query.set('page',String(page));
  const result=await client.get(module+'?'+query);if(!Array.isArray(result.data))throw Error('INVALID_PAGE');
  for(const raw of result.data){const row=sanitize(raw,fields),prior=rows.get(row.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(row))throw Error('SOURCE_CHANGED_DURING_PAGING');rows.set(row.id,row);}
  onPage({pages:requests+1,records:rows.size});
  if(result.info?.more_records===false)return [...rows.values()];
  if(!result.info||!result.data.length)throw Error('INCOMPLETE_PAGINATION');
  if(result.info.next_page_token){token=result.info.next_page_token;if(seenTokens.has(token))throw Error('REPEATED_PAGE_TOKEN');seenTokens.add(token);}else{if(token||page>=10)throw Error('MISSING_PAGE_TOKEN');page++;}
 }
 throw Error('RECORD_LIMIT_REACHED');
}
function normalize(snapshot){const events=[];for(const module of ['Lead_Status_History','Opportunity_Stage_History','DealHistory'])for(const r of snapshot.modules[module]?.rows||[]){const actor=r.Lead_Owner?.id||r.Contact_Owner?.id||null;events.push({id:module+':'+r.id,module,parentId:r.Full_Name?.id||r.Potential_Name?.id||null,actorId:actor,editorId:r.Modified_By?.id||null,eventAt:r.Modified_Time,state:r.Lead_Status||r.Stage,attribution:actor?'history-owner':'editor-only-not-work-owner'});}return events;}
async function runPipeline(root,{client:provided,onProgress=()=>{}}={}){
 const dir=path.join(root,'.private/mis-pipeline');fs.mkdirSync(dir,{recursive:true});const lock=path.join(dir,'lock.json');
 if(fs.existsSync(lock)){const old=JSON.parse(fs.readFileSync(lock));let alive=false;try{process.kill(old.pid,0);alive=true;}catch{}if(alive)throw Error('PIPELINE_BUSY');fs.unlinkSync(lock);}
 fs.writeFileSync(lock,JSON.stringify({pid:process.pid,at:new Date().toISOString()}),{flag:'wx',mode:0o600});
 const previousStatus=fs.existsSync(path.join(dir,'status.json'))?JSON.parse(fs.readFileSync(path.join(dir,'status.json'))):null;
 const resume=previousStatus?.state==='failed'&&Date.now()-Date.parse(previousStatus.startedAt)<30*60000?previousStatus:null;
 const runId=crypto.randomUUID(),startedAt=resume?.startedAt||new Date().toISOString(),runDir=path.join(dir,'runs',runId),status={runId,startedAt,state:'running',modules:{}};fs.mkdirSync(runDir,{recursive:true});atomic(path.join(dir,'status.json'),status);
 try{
  const client=provided||await createClient(root),previous=fs.existsSync(path.join(dir,'current.json'))?JSON.parse(fs.readFileSync(path.join(dir,'current.json'))):null;
  const snapshot={version:1,runId,startedAt,org:ORG,modules:{}};const queue=Object.keys(FIELDS);
  async function worker(){while(queue.length){const module=queue.shift();try{
   if(resume?.modules[module]?.state==='complete'){
    const data=JSON.parse(fs.readFileSync(path.join(dir,'runs',resume.runId,module+'.json')));if(data.complete&&FIELDS[module].every(f=>data.fields.includes(f)||data.missingFields.includes(f))){atomic(path.join(runDir,module+'.json'),data);snapshot.modules[module]=data;status.modules[module]={...resume.modules[module],resumedFrom:resume.runId};continue;}
   }
   const meta=await client.get('settings/fields?module='+module);if(!Array.isArray(meta.fields))throw Error('FIELD_METADATA_UNAVAILABLE');const available=new Set(meta.fields.map(f=>f.api_name));const fields=FIELDS[module].filter(f=>available.has(f));const missing=FIELDS[module].filter(f=>!available.has(f));
   const rows=await collect(client,module,fields,progress=>{status.modules[module]={state:'fetching',...progress};atomic(path.join(dir,'status.json'),status);onProgress(module,progress);});
   const priorIds=new Set((previous?.modules[module]?.rows||[]).map(r=>r.id));for(const r of rows)priorIds.delete(r.id);
   const data={complete:true,fetchedAt:new Date().toISOString(),fields,missingFields:missing,rows,removedSincePrevious:[...priorIds],removalMeaning:'Absent from complete accessible snapshot; not proof of deletion'};
   atomic(path.join(runDir,module+'.json'),data);snapshot.modules[module]=data;status.modules[module]={state:'complete',records:rows.length,missingFields:missing};
  }catch(error){status.modules[module]={state:'failed',code:/^[A-Z_]+$/.test(error.message)?error.message:/^[A-Z_]+$/.test(error.code||'')?error.code:'SOURCE_UNAVAILABLE',kind:error.name,operation:error.syscall||null};}atomic(path.join(dir,'status.json'),status);}}
  await Promise.all([worker(),worker()]);
  if(Object.values(status.modules).some(m=>m.state!=='complete')){status.state='failed';throw Error('INCOMPLETE_RUN');}
  snapshot.completedAt=new Date().toISOString();const events=normalize(snapshot);atomic(path.join(runDir,'events.json'),events);atomic(path.join(runDir,'snapshot.json'),snapshot);
  // Publish only a complete run. Prior complete snapshot survives any failed run.
  atomic(path.join(dir,'current.json'),snapshot);status.state='complete';status.completedAt=snapshot.completedAt;status.eventCount=events.length;return status;
 }catch(error){status.state='failed';status.code=/^[A-Z_]+$/.test(error.message)?error.message:'PIPELINE_FAILED';throw Error(status.code);
 }finally{atomic(path.join(dir,'status.json'),status);atomic(path.join(runDir,'run.json'),status);fs.unlinkSync(lock);}
}
module.exports={FIELDS,atomic,sanitize,collect,normalize,runPipeline};
