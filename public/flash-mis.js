(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.MagppieFlashMis=api;})(typeof window!=='undefined'?window:null,function(){
 'use strict';
 // The MIS results column: one number per review row, read live from Zoho CRM on Fetch MIS.
 // A row CRM cannot measure shows a dash. Clicking a number lists the CRM records it was counted
 // from, and each of those opens in Zoho CRM. Ratings and remarks are never touched.
 const DASH='-';
 const supported=role=>['sales_manager','asm','psm','designer','factory_head','purchase_head','logistics_head','installation_manager','customer_care_head','avp'].includes(role);
 const contextKey=c=>[c.role,c.policy,c.employeeId,c.month].join('|');
 // Row id → text for its cell. Anything the server did not return a number for is a dash.
 function values(result){return new Map((result?.items||[]).map(item=>[item.id,item.value===null||item.value===undefined||item.value===''?DASH:String(item.value)]));}
 // Row ids whose number has records behind it to open.
 function openable(result){return new Map((result?.items||[]).filter(item=>Number(item.records)>0&&(item.note||(item.value!==null&&item.value!==undefined))).map(item=>[item.id,Number(item.records)]));}
 // Row id → why there is no number although CRM has a field for it.
 // Row id → an issue with that row's figure, shown behind an exclamation mark.
 function warnings(result){return new Map((result?.items||[]).filter(item=>item.warning).map(item=>[item.id,String(item.warning)]));}
 function notes(result){return new Map((result?.items||[]).filter(item=>item.note).map(item=>[item.id,String(item.note)]));}
 // Behavioural and Foundational rows are judged by the manager; no CRM figure exists for them.
 const judged=id=>/_(b|f)_?\d+$/.test(id);
 // Only a Zoho CRM address is ever turned into a link.
 const zohoLink=url=>String(url||'').startsWith('https://crm.zoho.in/')?url:'';
 function mount(options){
  const {host,body,context}=options;if(!supported(context.policy))return;
  const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
  const query=extra=>new URLSearchParams({role:context.role,employeeId:context.employeeId,month:context.month,...extra});
  const read=async extra=>{
   const response=await fetch('/api/flash-review/mis?'+query(extra),{cache:'no-store',signal:AbortSignal.timeout(45000)});
   const result=await response.json();if(!response.ok)throw Error(result.error||'Unable to fetch MIS.');
   if(contextKey(result.context)!==contextKey(context))throw Error('The employee or month changed. Fetch MIS again.');
   return result;
  };
  const panel=el('section',undefined,'flash-panel flash-mis-panel');panel.setAttribute('aria-label','MIS results');
  const controls=el('div',undefined,'flash-mis-actions'),status=el('p','','flash-mis-status');status.setAttribute('role','status');
  const fetchButton=el('button','Fetch MIS','flash-action-secondary');fetchButton.type='button';controls.append(fetchButton,status);
  const dialog=el('dialog',undefined,'flash-mis-dialog');
  const showRecords=async(id,shown,label)=>{
   const head=el('div',undefined,'flash-mis-dialog-head'),title=el('div'),close=el('button','Close','flash-action-secondary');close.type='button';close.onclick=()=>dialog.close();
   title.append(el('strong',shown),el('span',label));head.append(title,close);
   const list=el('div','Loading from Zoho CRM…','flash-mis-records');dialog.replaceChildren(head,list);if(!dialog.open)dialog.showModal();
   try{
    const result=await read({item:id});list.replaceChildren();
    if(!result.records.length){list.textContent='No records to show for this number.';return;}
    list.append(el('p',`${result.records.length.toLocaleString('en-IN')} records · each opens in Zoho CRM`,'flash-mis-records-count'));
    for(const record of result.records){
     const url=zohoLink(record.url),row=el(url?'a':'div',undefined,'flash-mis-record');
     if(url){row.href=url;row.target='_blank';row.rel='noopener noreferrer';}
     row.append(el('span',record.name),el('small',record.detail||''));list.append(row);
    }
   }catch(error){list.textContent=error.name==='TimeoutError'?'Zoho CRM took too long. Try again.':error.message;}
  };
  let request=0;
  const draw=(shown,canOpen,why,issues)=>{for(const cell of body.querySelectorAll('td.flash-mis-result[data-mis-item]')){
   const id=cell.dataset.misItem,text=shown?shown.get(id)||DASH:'',count=canOpen?.get(id)||0,heading=cell.parentElement.querySelector('th');
   const open=()=>showRecords(id,text,heading?.querySelector('strong')?.textContent||heading?.textContent||'');
   const note=why?.get(id)||'';
   const value=el(count&&!note?'button':'span',text,'flash-mis-value'+(text===DASH?' is-none':''));
   if(count&&!note){value.type='button';value.title='Show the CRM records behind this number';value.onclick=open;}
   const issue=issues?.get(id),figure=el('div',undefined,'flash-mis-figure');
   if(issue){const mark=el('span','!','flash-mis-warn');mark.tabIndex=0;mark.title=issue;mark.dataset.tip=issue;mark.setAttribute('role','img');mark.setAttribute('aria-label','Issue with this figure: '+issue);figure.appendChild(mark);}
   figure.appendChild(value);cell.replaceChildren(figure);if(!shown)continue;
   const caption=el(count?'button':'small',note||(count?`${count.toLocaleString('en-IN')} record${count===1?'':'s'} in Zoho`:text!==DASH?'From Zoho CRM':judged(id)?'Assessed by manager':'Not in CRM'),'flash-mis-caption'+(note.startsWith('Field exists')?' is-unfilled':''));
   if(count){caption.type='button';caption.onclick=open;}
   cell.appendChild(caption);
  }};
  fetchButton.onclick=async()=>{
   const ticket=++request;fetchButton.disabled=true;status.textContent='Fetching from Zoho CRM…';draw(null);
   try{
    const result=await read({});if(!panel.isConnected||ticket!==request)return;
    draw(values(result),openable(result),notes(result),warnings(result));
    const at=new Date(result.fetchedAt).toLocaleTimeString('en-IN',{hour:'numeric',minute:'2-digit'});
    status.textContent=`Zoho CRM · ${at}`+(result.incomplete?' · some rows did not load, fetch again':'');
   }catch(error){if(panel.isConnected&&ticket===request)status.textContent=error.name==='TimeoutError'?'Zoho CRM took too long. Try again.':error.message;}
   finally{if(panel.isConnected&&ticket===request)fetchButton.disabled=false;}
  };
  panel.append(controls,dialog);host.appendChild(panel);draw(null);
 }
 return {supported,mount,contextKey,values,openable,notes,warnings,zohoLink};
});
