const $=s=>document.querySelector(s);
let token='',me=null,summary=null,policy=null,eventItems=[],cursor=null,current='overview';
const titles={overview:'Govern with evidence.',sessions:'Every session, in context.',events:'A clear record of the work.',skills:'Skills that stay aligned.',policies:'Project rules, made explicit.',team:'The right access for each person.'};
const notice=message=>$('#notice').textContent=message;
function el(tag,text,className){const e=document.createElement(tag);if(text!==undefined)e.textContent=String(text);if(className)e.className=className;return e;}
async function api(resource,options={}) {
  const response=await fetch(resource.startsWith('/api/')?resource:`/api/projects/${encodeURIComponent(me.projectId)}/${resource}`,{...options,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:options.body===undefined?undefined:JSON.stringify(options.body)});
  const data=await response.json();if(!response.ok)throw new Error(data.error??`HTTP ${response.status}`);return data;
}
function task(fn){return async event=>{event?.preventDefault();notice('');try{await fn(event);}catch(e){notice(e.message);}};}
function activity(item){const row=el('div',undefined,'activity');row.append(el('span',item.status==='denied'?'!':item.kind==='UserPromptSubmit'?'↗':'·',`activity-icon ${item.status==='denied'?'denied':''}`));const body=el('div',undefined,'activity-body');body.append(el('p',item.kind==='UserPromptSubmit'?'Prompt captured':item.kind==='PreToolUse'&&item.status==='denied'?'Operation denied':item.kind,'activity-title'),el('div',`${item.userId} · ${new Date(item.occurredAt).toLocaleString()} · ${item.sessionId}`,'activity-meta'));const text=item.prompt??item.command??item.detail;if(text)body.append(el('p',text,'activity-text'));for(const f of item.findings??[])body.append(el('p',`${f.rule}: ${f.message}`,'activity-text'));row.append(body);return row;}
function fill(container,items,render,empty='No activity yet. Start a connected Codex session to see events here.') {const node=$(container);node.replaceChildren();if(!items.length)node.append(el('div',empty,'empty'));else items.forEach(item=>node.append(render(item)));}
async function overview(){summary=await api('summary');policy=summary.policy;$('#project-name').textContent=summary.project.name.toUpperCase();$('#metrics').replaceChildren();for(const [label,count,note]of [['Captured prompts',summary.prompts??0,'Redacted before storage'],['Sessions',summary.sessions,'Across connected users'],['Active contributors',summary.users,'Users with captured events'],['Blocked operations',summary.denied??0,'Recorded pre-tool denials']]){const card=el('article',undefined,'metric');card.append(el('p',label),el('strong',count),el('small',note));$('#metrics').append(card);}const page=await api('events?limit=5');fill('#recent',page.items,activity);$('#policy-posture').textContent=policy.mode==='enforce'?'Enforcement is enabled':'Observation mode';$('#posture').replaceChildren();for(const [label,value]of [['Policy version',policy.version],['Capture source','Codex lifecycle'],['Test verdict','Requires execution'],['Lumora connection','Explicit opt-in']]){const row=el('div',undefined,'posture-row');row.append(el('span',label),el('strong',value));$('#posture').append(row);}$('#verify-audit').hidden=me.role==='agent';}
let eventRequest=0,eventLoading=false;
async function loadEvents(append=false){
  const request=++eventRequest;eventLoading=true;
  const params=new URLSearchParams({limit:'50'});
  for(const [key,id]of [['q','#search'],['kind','#kind'],['session','#session-filter']])if($(id).value)params.set(key,$(id).value);
  if(append&&cursor){params.set('before',cursor);$('#live-events').checked=false;}
  try {
    const data=await api(`events?${params}`);if(request!==eventRequest||!me)return;
    eventItems=append?[...eventItems,...data.items]:data.items;cursor=data.nextCursor;
    fill('#event-list',eventItems,activity,'No events match this view. Clear the filters. If prompts are still missing, follow the capture checks below.');
    $('#more').hidden=!cursor;$('#event-updated').textContent=`Updated ${new Date().toLocaleTimeString()}${append?' · Live updates paused while viewing older events.':''}`;
  }finally{if(request===eventRequest)eventLoading=false;}
}
async function sessions(){const data=await api('sessions');fill('#session-list',data.items,item=>{const row=el('div',undefined,'activity');const body=el('div',undefined,'activity-body');body.append(el('p',item.id,'activity-title'),el('div',`${item.userId} · last seen ${new Date(item.lastSeen).toLocaleString()} · ${item.endedAt?'ended':'no end event recorded'}`,'activity-meta'));const button=el('button','Open logs','secondary');button.onclick=task(async()=>{$('#session-filter').value=item.id;await view('events');});row.append(body,button);return row;});}
let skillRelease=null,skillDraft=null,syncLoading=false;
function openSkillEditor(item=null){
  skillDraft={create:!item,expectedReleaseHash:skillRelease?.hash??null};
  $('#skill-editor').hidden=false;$('#skill-editor-title').textContent=item?`Edit ${item.slug}`:'Create skill';
  $('#skill-name').value=item?.slug??'';$('#skill-name').disabled=!!item;
  $('#skill-description-field').hidden=!!item;$('#skill-description').required=!item;$('#skill-description').value='';
  $('#skill-content-label').textContent=item?'Skill file (SKILL.md)':'Instructions';$('#skill-content').value=item?.content??'';
  (item?$('#skill-content'):$('#skill-name')).focus();
}
async function skills(){
  const data=await api('skills');skillRelease=data.release;
  $('#release-title').textContent=data.release?`Release ${data.release.version}`:'No release published';
  $('#create-skill').hidden=me.role!=='admin';$('#skill-permission').textContent=me.role==='admin'?'':'Sign in as an administrator to create, edit or resolve skill conflicts.';
  fill('#skill-list',data.release?.skills??[],item=>{
    const row=el('div',undefined,'skill'),body=el('div'),actions=el('div',undefined,'skill-actions');
    const name=/^(project-|lumora-)/.test(item.slug)?item.slug:`project-${item.slug}`;
    body.append(el('h3',item.slug),el('code',`.agents/skills/${name}/SKILL.md`));
    const details=el('details');details.append(el('summary','View published instructions'),el('pre',item.content));body.append(details);
    actions.append(el('span',item.version,'pill'));
    if(me.role==='admin'){const button=el('button','Edit skill','secondary');button.setAttribute('aria-label',`Edit ${item.slug}`);button.onclick=()=>openSkillEditor(item);actions.append(button);}
    row.append(body,actions);return row;
  },'No skills published. An administrator can create the first skill here.');
  await loadSkillSyncs();
}
async function loadSkillSyncs(){
  if(syncLoading)return;syncLoading=true;
  try {
    const [data,latest]=await Promise.all([api('skill-syncs'),api('skills')]);
    fill('#skill-sync-list',data.items,report=>{
      const row=el('div',undefined,'sync-repository'),upToDate=report.releaseHash===latest.release?.hash;
      row.append(el('h3',`${report.name} · ${report.userId} · ${report.repositoryId.slice(0,8)}`),el('p',`Last report: ${new Date(report.updatedAt).toLocaleString()} · ${upToDate?'Current release checked':'Awaiting the latest release; send a new prompt or run sync'}`,'muted'));
      for(const file of report.files){
        const line=el('div',undefined,'sync-file');line.append(el('code',file.path),el('p',file.status==='conflict'?'Conflict: local and published instructions differ':file.status==='local'?'Local version preserved':file.status,'muted'));
        const pending=report.resolutions.find(r=>r.path===file.path);
        if(pending)line.append(el('p',`Pending: ${pending.choice==='local'?'keep local':'use published'} on the next prompt or sync.`,'sync-conflict'));
        else if(file.status==='conflict'&&file.remoteHash&&me.role==='admin'&&upToDate){
          const actions=el('div',undefined,'toolbar');
          for(const [choice,label]of [['local','Keep local'],['published','Use published']]){
            const button=el('button',label,'secondary');button.onclick=task(async()=>{
              button.disabled=true;
              try{await api(`skill-syncs/${encodeURIComponent(report.id)}`,{method:'PUT',body:{path:file.path,localHash:file.localHash,remoteHash:file.remoteHash,choice}});await loadSkillSyncs();notice('Choice saved. It will apply on that repository’s next prompt or sync.');}finally{button.disabled=false;}
            });actions.append(button);
          }
          line.append(actions);
        }
        row.append(line);
      }
      return row;
    },'No repository has reported synchronization yet. Use updated, trusted hooks and send a prompt, or run the updated CLI sync command.');
    $('#skill-sync-updated').textContent=`Status checked ${new Date().toLocaleTimeString()}`;
  }finally{syncLoading=false;}
}
const policyLabels={blockDatabaseReset:'Block recognized database resets',blockDatabasePush:'Require versioned migrations (block db:push)',protectGovernanceFiles:'Protect managed governance files',reviewArchitecture:'Apply configured project source rules',stopReminder:'Remind agents to report actual verification'};
async function policies(){policy=await api('policy');$('#policy-mode').value=policy.mode;$('#policy-fields').replaceChildren();for(const [key,label]of Object.entries(policyLabels)){const row=el('label',undefined,'check');row.append(el('span',label));const box=el('input');box.type='checkbox';box.id=`policy-${key}`;box.checked=policy[key];box.disabled=me.role!=='admin';row.append(box);$('#policy-fields').append(row);}fill('#source-rules',policy.sourceRules??[],rule=>el('p',`${rule.id}: ${rule.message}`),'No project-specific source rules configured.');$('#policy-mode').disabled=me.role!=='admin';$('#save-policy').disabled=me.role!=='admin';}
async function team(){if(me.role!=='admin'){$('#team-form').hidden=true;fill('#team-list',[],()=>{},'Administrator access is required to manage credentials.');return;}$('#team-form').hidden=false;const data=await api('principals');fill('#team-list',data.items,item=>{const row=el('div',undefined,'activity'),body=el('div',undefined,'activity-body');body.append(el('p',item.name,'activity-title'),el('div',`${item.userId} · ${item.role} · ${item.revoked?'revoked':'active'}`,'activity-meta'));row.append(body);if(!item.revoked&&item.id!==me.id){const b=el('button','Revoke','secondary');b.onclick=task(async()=>{if(!window.confirm(`Revoke ${item.name}'s credential?`))return;await api(`principals/${item.id}`,{method:'DELETE'});await team();});row.append(b);}return row;});}
let navigation=0;
async function view(name){if(!me)return;const request=++navigation;await ({overview,sessions,events:()=>loadEvents(),skills,policies,team}[name])();if(request!==navigation)return;current=name;document.querySelectorAll('.view').forEach(e=>e.hidden=e.id!==name);document.querySelectorAll('nav button').forEach(e=>e.classList.toggle('active',e.dataset.view===name));$('#page-title').textContent=titles[name];}
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=task(()=>view(b.dataset.view)));
$('#login-form').onsubmit=task(async()=>{token=$('#token').value.trim();try{me=await api('/api/me');}catch(e){token='';throw e;}$('#token').value='';$('#login').hidden=true;$('#workspace').hidden=false;$('#logout').hidden=false;$('#refresh').hidden=false;$('#connection-status').textContent=`${me.name} · ${me.role}`;await view('overview');});
$('#logout').onclick=()=>{token='';me=null;summary=null;policy=null;eventItems=[];location.reload();};
$('#refresh').onclick=task(()=>view(current));$('#search-button').onclick=task(()=>loadEvents());$('#kind').onchange=task(()=>loadEvents());$('#search').onkeydown=event=>{if(event.key==='Enter')task(()=>loadEvents())(event);};$('#more').onclick=task(()=>loadEvents(true));
$('#clear-filters').onclick=task(async()=>{$('#search').value='';$('#kind').value='';$('#session-filter').value='';await loadEvents();});
$('#create-skill').onclick=()=>openSkillEditor();
$('#cancel-skill').onclick=()=>{$('#skill-editor').hidden=true;skillDraft=null;};
$('#refresh-skill-syncs').onclick=task(loadSkillSyncs);
$('#skill-editor').onsubmit=task(async()=>{
  if(!skillDraft||me.role!=='admin')return;
  let name=$('#skill-name').value.trim();
  if(skillDraft.create&&!/^(project-|lumora-)/.test(name))name=`project-${name}`;
  if(name.length>64)throw new Error('Skill names, including the project- prefix, must be 64 characters or fewer.');
  const content=skillDraft.create?`---\nname: ${name}\ndescription: ${JSON.stringify($('#skill-description').value.trim())}\n---\n\n${$('#skill-content').value}\n`:$('#skill-content').value;
  $('#save-skill').disabled=true;
  try{await api(`skills/${encodeURIComponent(name)}`,{method:'PUT',body:{...skillDraft,content}});$('#skill-editor').hidden=true;skillDraft=null;await skills();notice('Skill published. Connected repositories will check for it before the next prompt or when sync runs.');}
  finally{$('#save-skill').disabled=false;}
});
$('#live-events').onchange=task(async()=>{if($('#live-events').checked)await loadEvents();});
setInterval(async()=>{
  if(me&&current==='skills'&&!document.hidden&&!syncLoading){try{await loadSkillSyncs();}catch{$('#skill-sync-updated').textContent='Could not refresh repository status. Check the service.';}return;}
  if(!me||current!=='events'||document.hidden||!$('#live-events').checked||eventLoading)return;
  try{await loadEvents();}catch{$('#event-updated').textContent='Live refresh failed. Check the service or sign in again.';}
},3000);
$('#verify-audit').onclick=task(async()=>{const data=await api('audit');$('#audit-result').textContent=data.valid?`Verified ${data.checked} audit records. Store the chain head externally to detect later truncation: ${data.head.slice(0,16)}…`:`Integrity failure at record ${data.failedAt}.`;});
$('#policy-form').onsubmit=task(async()=>{const next={...policy,version:policy.version+1,mode:$('#policy-mode').value};for(const key of Object.keys(policyLabels))next[key]=$(`#policy-${key}`).checked;policy=await api('policy',{method:'PUT',body:next});notice(`Policy v${policy.version} saved. Clients refresh at session start.`);});
$('#team-form').onsubmit=task(async()=>{const data=await api('principals',{method:'POST',body:{userId:$('#user-id').value,name:$('#user-name').value,role:$('#role').value}});$('#new-token').hidden=false;$('#new-token').textContent=`Copy this credential now; it will not be shown again: ${data.token}`;await team();});
$('#export').onclick=()=>{const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),project:me.projectId,scope:'Currently loaded filtered events',events:eventItems},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download='lumora-events.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
