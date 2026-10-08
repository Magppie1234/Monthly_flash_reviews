(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.MagppieFlashMis=api;})(typeof window!=='undefined'?window:null,function(){
 'use strict';
 const supported=role=>['sales_manager','asm','psm','designer','factory_head','purchase_head','logistics_head','installation_manager','customer_care_head','avp'].includes(role);
 const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 const contextKey=c=>[c.role,c.policy,c.employeeId,c.month].join('|');
 const allowed=path=>/^(remarks|mis)\.(sm|asm|psm|dc)_(w\d+|[bf]_\d+)$/.test(path)||/^(remarks|mis)\.(factory_head|purchase_head|logistics_head|installation_manager|customer_care_head)_v2_[wbf]\d+$/.test(path)||['achieved','targetUnit'].includes(path);
 function read(review,path){return path.split('.').reduce((obj,key)=>obj?.[key],review);}
 function write(review,path,value){const parts=path.split('.');const key=parts.pop();let parent=review;for(const part of parts)parent=parent[part]||=( {} );if(value===undefined)delete parent[key];else parent[key]=value;}
 function candidates(evidence){
  const archiveSource=`${evidence.source.archive} / ${evidence.source.file} · ${evidence.context.month} · snapshot ${evidence.source.end}`;
  const result=[];
  evidence.items.filter(i=>i.status==='available'&&i.importable!==false).forEach(item=>{
   const source=item.source?`${item.source.name} · ${evidence.context.month} · snapshot ${item.source.asOf} · run ${item.source.runId}`:archiveSource;
   result.push({id:item.id+':evidence',label:item.label+' — evidence remark',changes:[{path:'remarks.'+item.id,value:`${item.summary} ${item.limitation} Source: ${source}; ${item.dataset}. Reviewer assessment required.`},{path:'mis.'+item.id,value:(item.source?'Zoho CRM':'Handover ZIP')+' · '+item.dataset}],provenance:{source,sha256:item.source?undefined:evidence.source.sha256,runId:item.source?.runId,dataset:item.dataset,itemId:item.id}});
   if(item.metric)result.push({id:item.id+':achievement',label:`Monthly achieved value: ${item.metric.value.toFixed(3)} ${item.metric.unit} (includes unit; confirm scope and partial coverage)`,changes:[{path:'achieved',value:String(item.metric.value)},{path:'targetUnit',value:item.metric.unit}],provenance:{source,sha256:evidence.source.sha256,dataset:item.dataset,itemId:item.id}});
  });return result;
 }
 function apply(review,evidence,selected,replaceExisting,context){
  if(contextKey(context)!==contextKey(evidence.context))throw Error('The employee or month changed. Fetch MIS again.');
  const choices=candidates(evidence).filter(c=>selected.includes(c.id));if(!choices.length)throw Error('Select at least one suggested entry.');
  const changes=choices.flatMap(c=>c.changes.map(change=>({...change,provenance:c.provenance,candidateId:c.id})));
  for(const change of changes){if(!allowed(change.path))throw Error('Unsupported field');const value=read(review,change.path);if(value!==undefined&&value!==null&&value!==''&&!equal(value,change.value)&&!replaceExisting.includes(change.candidateId))throw Error('Explicitly allow replacement for each selected entry with existing values.');}
  const next=JSON.parse(JSON.stringify(review)),transaction={context:contextKey(context),at:new Date().toISOString(),changes:[]};next.misProvenance||={};
  for(const change of changes){if(equal(read(next,change.path),change.value))continue;transaction.changes.push({path:change.path,before:read(next,change.path),after:change.value,previousProvenance:next.misProvenance[change.path]});write(next,change.path,change.value);next.misProvenance[change.path]={...change.provenance,appliedAt:transaction.at};}
  if(!transaction.changes.length)throw Error('Selected values already match; no changes applied.');
  next.misLastApplication=transaction;return next;
 }
 function undo(review,context){
  const transaction=review.misLastApplication;if(!transaction||transaction.context!==contextKey(context))throw Error('No MIS application to undo for this review.');
  const next=JSON.parse(JSON.stringify(review));let restored=0,preserved=0;
  for(const change of transaction.changes){if(!allowed(change.path))continue;if(equal(read(next,change.path),change.after)){write(next,change.path,change.before);if(change.previousProvenance)next.misProvenance[change.path]=change.previousProvenance;else delete next.misProvenance?.[change.path];restored++;}else preserved++;}
  delete next.misLastApplication;return {review:next,restored,preserved};
 }
 function progress(item,review={}){
  if(item.status!=='available')return null;
  if(item.display)return item.display;
  if(item.comparisonUnavailable)return null;
  const rows=item.records||[],format=n=>Number(n).toLocaleString('en-IN',{maximumFractionDigits:3});
  if(item.dataset==='psm_first_response_records'){
   const done=rows.filter(r=>r.responseDate&&r.status==='Employee response recorded'&&r.minutes!==null&&r.minutes>=0).length;
   return {done:format(done),total:format(rows.length),label:'Responses recorded / assigned',percent:rows.length?100*done/rows.length:null,barLabel:'Response coverage',expected:'Response window not set',note:'Timing not assessed'};
  }
  if(item.dataset==='bd_records')return {done:format(rows.length),total:null,label:'Qualified records created',percent:null,expected:'Target not verified',note:'Creation date only'};
  if(item.dataset==='sales_active_opportunities'){
   const done=rows.filter(r=>r.nextActionRecorded&&r.followUp).length;
   return {done:String(done),total:String(rows.length),label:'With next action & date',percent:rows.length?100*done/rows.length:null,barLabel:'Portfolio coverage',expected:item.id==='sm_w9'?'≥95% of team opportunities':'Target not set',note:item.id==='sm_w9'?'Personal portfolio only. Team progress cannot be calculated.':'Snapshot coverage; not a full-month compliance score.'};
  }
  if(item.dataset==='sales_attrition_summary'){const done=rows.filter(r=>r.reasonRecorded).length;return {done:String(done),total:String(rows.length),label:'Lost opportunities with a reason',percent:rows.length?100*done/rows.length:null,barLabel:'Recorded coverage',expected:'Valid reason on each lost deal',note:'Presence of a reason is shown; reason-code validity is not verified.'};}
  if(item.metric){const target=Number(review.target),valid=String(review.target??'').trim()!==''&&Number.isFinite(target)&&target>0&&review.targetUnit===item.metric.unit;return {done:format(item.metric.value),total:valid?format(target):'—',label:`Booked · ${item.metric.unit}`,percent:valid?100*item.metric.value/target:null,barLabel:'Of reviewer target',expected:valid?`${format(target)} ${item.metric.unit}`:'Enter a monthly target in ₹ Cr',note:'Exported bookings only. Review the source coverage before assessing.'};}
  if(item.dataset==='bd_call_records')return {done:String(rows.length),total:null,label:'Calls recorded',percent:null,expected:'Call target not available',note:'Call counts do not establish contact compliance.'};
  return null;
 }
 function mount(options){
  const {host,body,context,getReview,commit}=options;if(!supported(context.policy))return;
  const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
  const panel=el('section',undefined,'flash-panel flash-mis-panel');panel.setAttribute('aria-label','MIS / Work Evidence');
  panel.append(el('h2','MIS / Work Evidence'),el('p','Click Fetch MIS to see results in the right-hand column. Your ratings and remarks stay unchanged.'));
  const controls=el('div',undefined,'flash-mis-actions'),status=el('p','Select an employee and month, then fetch MIS.','flash-mis-status'),preview=el('div');status.setAttribute('role','status');
  const button=(label,fn)=>{const b=el('button',label,'flash-action-secondary');b.type='button';b.onmousedown=e=>e.preventDefault();b.onclick=()=>{document.activeElement?.blur();fn();};controls.appendChild(b);return b;};
  let evidence=null,request=0;const selected=new Set(),replacements=new Set();
  const drawEvidence=()=>{
   body.querySelectorAll('.flash-mis-inline').forEach(n=>n.remove());
   for(const row of body.querySelectorAll('td.flash-mis-result[data-mis-item]')){
    const item=evidence?.items.find(i=>i.id===row.dataset.misItem),note=el('div',undefined,'flash-mis-inline');
    if(item){const metric=progress(item,getReview());
     if(metric){const box=el('div',undefined,'flash-mis-progress'),numbers=el('div',undefined,'flash-mis-numbers');box.append(el('h3',metric.label));numbers.append(el('strong',metric.done));if(metric.total!==null)numbers.append(el('span',`/ ${metric.total}`));box.append(numbers);
      if(metric.percent!==null){const bar=el('progress');bar.max=100;bar.value=Math.max(0,Math.min(100,metric.percent));bar.setAttribute('aria-label',metric.barLabel);box.append(bar,el('p',`${metric.percent.toFixed(1)}% · ${metric.barLabel.toLowerCase()}`,'flash-mis-percent'));}
      box.append(el('p',metric.expected,'flash-mis-expected'));note.append(box);
      if(item.id==='sm_w9')note.append(el('p','Personal portfolio · team data needed','flash-mis-caption'));
     }else note.append(el('span',item.status==='missing_data'?'No data':item.status==='no_activity'?'No activity found':item.status==='not_applicable'?'Not applicable':item.summary,'flash-mis-empty'));
     const info=el('details',undefined,'flash-mis-detail');info.append(el('summary','Details'),el('p',item.summary),el('p',item.limitation),el('p',`${context.month} · ${item.source?'Zoho CRM':'Handover ZIP'} · Updated ${item.source?.asOf||evidence.source.end}`),el('p',`Benchmark: ${item.benchmark}`));note.append(info);
     if(item.records.length){const details=info,records=el('div',undefined,'flash-mis-records');details.append(el('h4',`Records (${item.records.length})`));let shown=0;const more=el('button','Show 20 more');more.type='button';
      const labels={id:'Record',date:'Date',nextActionRecorded:'Next action',followUp:'Follow-up date',reasonRecorded:'Reason',valueLacs:'Value (₹ lakh)',attempts:'Attempts',talkSeconds:'Talk time (seconds)',responseDate:'Response date',minutes:'Response time (minutes)',status:'Status'};
      const add=()=>{item.records.slice(shown,shown+20).forEach(record=>{const entry=el('dl',undefined,'flash-mis-record');Object.entries(record).forEach(([k,v])=>{entry.append(el('dt',labels[k]||k),el('dd',v===true?'Recorded':v===false?'Not recorded':v===null||v===''?'Not recorded':String(v)));});records.append(entry);});shown+=20;more.hidden=shown>=item.records.length;};info.addEventListener('toggle',()=>{if(info.open&&!shown)add();});more.onclick=add;details.append(el('p',item.calculation||''),records,more);}
    }else note.append(el('p',fetchButton?.disabled?'Fetching…':'Click Fetch MIS to see results.'));
    const provenance=getReview().misProvenance?.['remarks.'+row.dataset.misItem];if(provenance)note.append(el('small','MIS entry copied to remarks. You can edit it.'));row.appendChild(note);
   }
  };
  const fetchButton=button('Fetch MIS',async()=>{
   const ticket=++request;fetchButton.disabled=true;previewButton.disabled=true;evidence=null;selected.clear();replacements.clear();preview.replaceChildren();status.textContent='Fetching MIS…';drawEvidence();
   try{const query=new URLSearchParams({role:context.role,employeeId:context.employeeId,month:context.month});const response=await fetch('/api/flash-review/mis?'+query,{cache:'no-store',signal:AbortSignal.timeout(20000)});const result=await response.json();if(!response.ok)throw Error(result.error||'Unable to fetch MIS.');if(!panel.isConnected||ticket!==request)return;if(contextKey(result.context)!==contextKey(context))throw Error('Evidence does not match this review.');evidence=result;
    const monthLabel=new Date(context.month+'-01T12:00:00').toLocaleDateString('en-IN',{month:'long',year:'numeric'});
    const endLabel=new Date((result.liveSource?.asOf||result.source.end)+'T12:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short'});
    status.textContent=result.outside?`No records available for ${monthLabel}. You can complete the review manually.`:!(result.identity.matched||result.identity.liveMatched)?'Employee could not be matched reliably. Complete the review manually.':`${result.employee.name} · ${monthLabel} — MIS loaded.${result.liveSource?' ZIP + Zoho CRM.':''}${result.partial?` Through ${endLabel}; month incomplete.`:''}${result.refresh?.running?' Refresh in progress; fetch again shortly.':result.refresh?.stale?' Showing last available data.':''}`;previewButton.disabled=false;drawEvidence();
   }catch(error){if(panel.isConnected){status.textContent=`${error.message} You can enter the review manually.`;}}finally{if(panel.isConnected&&ticket===request){fetchButton.disabled=false;if(!evidence)drawEvidence();}}
  });
  const previewButton=button('Preview suggested entries',()=>{
   preview.replaceChildren();selected.clear();replacements.clear();const choices=candidates(evidence);
   preview.append(el('h3','Choose entries to copy'),el('p','Nothing is selected by default. Ratings and targets stay manual. Source values may cover only part of the month.'));
   if(!choices.length){preview.append(el('p','No supported entries for this selection. Complete the review manually.'));return;}
   for(const candidate of choices){const card=el('div',undefined,'flash-mis-candidate'),label=el('label'),check=el('input');check.type='checkbox';check.onchange=()=>check.checked?selected.add(candidate.id):selected.delete(candidate.id);label.append(check,document.createTextNode(candidate.label));card.append(label);
    candidate.changes.forEach(change=>card.append(el('p',`${change.path}: ${String(read(getReview(),change.path)??'(blank)')} → ${change.value}`)));
    const existing=candidate.changes.some(change=>{const v=read(getReview(),change.path);return v!==undefined&&v!==null&&v!==''&&!equal(v,change.value);});
    if(existing){const replaceLabel=el('label'),replace=el('input');replace.type='checkbox';replace.onchange=()=>replace.checked?replacements.add(candidate.id):replacements.delete(candidate.id);replaceLabel.append(replace,document.createTextNode('Allow replacing existing values for this entry'));card.append(replaceLabel);}
    preview.append(card);
   }
   const applyButton=el('button','Apply selected entries','flash-action-primary');applyButton.type='button';applyButton.onclick=()=>{try{const next=apply(getReview(),evidence,[...selected],[...replacements],context);if(commit(next)){preview.replaceChildren();status.textContent='Selected entries applied. All values remain editable; Undo last application is available.';undoButton.disabled=false;drawEvidence();}}catch(error){status.textContent=error.message;}};preview.appendChild(applyButton);
  });previewButton.disabled=true;
  button('Enter manually',()=>{preview.replaceChildren();body.querySelector('.flash-assessment button')?.focus();status.textContent='Enter your ratings and remarks in the responsibility rows. No suggestions were applied.';});
  const undoButton=button('Undo last application',()=>{try{const result=undo(getReview(),context);if(commit(result.review)){status.textContent=`Undone ${result.restored} field changes. Preserved ${result.preserved} fields edited afterward.`;undoButton.disabled=true;preview.replaceChildren();drawEvidence();}}catch(error){status.textContent=error.message;}});undoButton.disabled=!getReview().misLastApplication;
  if(options.readOnly){Array.from(controls.children).forEach(b=>{if(b!==fetchButton)b.hidden=true;});panel.querySelector('p').textContent='Activity context only. AVP responsibilities and scoring are pending.';}
  panel.append(controls,status,preview);host.appendChild(panel);drawEvidence();
  body.addEventListener('change',()=>{if(panel.isConnected&&evidence)drawEvidence();});
 }
 return {supported,candidates,apply,undo,mount,contextKey,progress};
});
