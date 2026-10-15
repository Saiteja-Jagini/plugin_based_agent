import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/store.ts';
import { createApp } from '../src/server.ts';
import { makeRelease } from '../src/skills.ts';
import { refreshSkills } from '../src/skill-sync.ts';
import { connectionSchema } from '../src/contracts.ts';
import { handleHook, saveConnection } from '../src/hook.ts';
import { requestJson } from '../src/util.ts';
import { Outbox } from '../src/outbox.ts';

const temp=()=>mkdtempSync(join(tmpdir(),'skill-editor-'));
const content=(name:string,body:string)=>`---\nname: ${name}\ndescription: Test this project's behavior\n---\n\n${body}\n`;
async function fixture(){
  const store=new Store(':memory:'),admin=store.bootstrap('p','Project','manager');store.publish(admin.principal,makeRelease('skills'));
  const agent=store.transaction(()=>store.issue('p',{userId:'dev',name:'Developer',role:'agent'}));
  const observer=store.transaction(()=>store.issue('p',{userId:'watcher',name:'Observer',role:'observer'}));
  const server=createApp(store);server.listen(0,'127.0.0.1');await once(server,'listening');
  const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`,base=`${url}/api/projects/p`;
  const config=connectionSchema.parse({version:1,projectId:'p',serverUrl:url});
  const edit=(name:string,text:string,create=false,expectedReleaseHash=store.release('p')!.hash)=>requestJson(`${base}/skills/${name}`,admin.token,'PUT',{content:text,create,expectedReleaseHash});
  return {store,admin,agent,observer,server,url,base,config,edit,close:async()=>{server.close();await once(server,'close');store.close();}};
}

test('skill editor validates files, enforces admin/project scope, prevents stale saves and preserves other skills',async()=>{
  const s=await fixture();try {
    const original=s.store.release('p')!,name='project-login';
    const input={content:content(name,'Test valid and expired sessions.'),create:true,expectedReleaseHash:original.hash};
    for(const user of [s.agent,s.observer])await assert.rejects(requestJson(`${s.base}/skills/${name}`,user.token,'PUT',input),/403/);
    await assert.rejects(requestJson(`${s.url}/api/projects/other/skills/${name}`,s.admin.token,'PUT',input),/403/);
    await assert.rejects(s.edit(name,'invalid',true),/400/);
    await assert.rejects(s.edit(name,content('different-name','Test'),true),/400/);
    await assert.rejects(s.edit(name,content(name,'Test').replace("Test this project's behavior",'""'),true),/400/);
    const first=await s.edit(name,input.content,true);assert.equal(first.release.skills.length,4);
    assert.notEqual(first.release.version,original.version);assert.notEqual(first.release.hash,original.hash);
    for(const skill of original.skills)assert.deepEqual(first.release.skills.find((x:any)=>x.slug===skill.slug),skill);
    await assert.rejects(s.edit('project-other',content('project-other','Test'),true,original.hash),/409/);
    await assert.rejects(s.edit(name,input.content,true),/409/);
    const updated=await s.edit(name,content(name,'Updated instructions'));
    assert.notEqual(updated.release.version,first.release.version);
    assert.equal(JSON.parse(String(s.store.db.prepare('SELECT payload FROM releases WHERE project_id=? AND version=?').get('p',first.release.version)!.payload)).skills.find((x:any)=>x.slug===name).content,input.content);
    assert.equal(s.store.integrity('p').valid,true);
  }finally{await s.close();}
});

test('new and edited skills reach a connected repository before its next prompt without SessionStart',async()=>{
  const s=await fixture(),root=temp();try {
    saveConnection(root,s.config);
    const env={LUMORA_AGENT_TOKEN:s.agent.token},hook={cwd:root,session_id:'automatic-sync',hook_event_name:'UserPromptSubmit',prompt:'Use the latest instructions'};
    await handleHook(hook,env);
    const path=join(root,'.agents/skills/project-login/SKILL.md'),created=content('project-login','Test expired sessions.');
    await s.edit('project-login',created,true);
    const output=JSON.stringify(await handleHook(hook,env));
    assert.equal(readFileSync(path,'utf8'),created);assert.ok(output.includes('project-login/SKILL.md'));
    const edited=content('project-login','Also test a denied permission.');await s.edit('project-login',edited);
    await handleHook(hook,env);assert.equal(readFileSync(path,'utf8'),edited);
    const reports=await requestJson(`${s.base}/skill-syncs`,s.admin.token);
    assert.equal(reports.items.length,1);assert.equal(reports.items[0].releaseHash,s.store.release('p')!.hash);
    assert.ok(!JSON.stringify(reports).includes('Also test a denied permission'));
    assert.ok(reports.items[0].files.every((f:any)=>f.status==='synced'));
    assert.equal(s.store.listEvents(s.admin.principal,new URLSearchParams({kind:'UserPromptSubmit'})).items.length,3);
  }finally{await s.close();}
});

test('conflicts keep local files, support both choices, back up replaced files and reject stale decisions',async()=>{
  const s=await fixture(),root=temp(),name='project-testing',rel=`.agents/skills/${name}/SKILL.md`,path=join(root,rel);
  const sync=()=>refreshSkills(root,s.config,s.agent.token);
  const report=async()=> (await requestJson(`${s.base}/skill-syncs`,s.admin.token)).items[0];
  const decide=async(choice:'local'|'published')=>{const r=await report(),file=r.files.find((f:any)=>f.path===rel);return requestJson(`${s.base}/skill-syncs/${r.id}`,s.admin.token,'PUT',{path:rel,localHash:file.localHash,remoteHash:file.remoteHash,choice});};
  try {
    await sync();const local=content(name,'My local fixtures.');writeFileSync(path,local);
    assert.equal((await sync()).conflicts.length,0,'Only local edits are not a two-sided conflict');
    await s.edit(name,content(name,'Published revision one.'));
    assert.equal((await sync()).conflicts.length,1);assert.equal(readFileSync(path,'utf8'),local);
    await decide('local');assert.equal((await sync()).conflicts.length,0);assert.equal(readFileSync(path,'utf8'),local);
    assert.equal((await sync()).conflicts.length,0,'Accepted local version must stay accepted for this remote hash');
    const published=content(name,'Published revision two.');await s.edit(name,published);assert.equal((await sync()).conflicts.length,1);
    await decide('published');writeFileSync(path,local+'A newer local edit.');
    assert.equal((await sync()).conflicts.length,1,'A decision must not overwrite a file edited after it was reported');
    assert.equal(readFileSync(path,'utf8'),local+'A newer local edit.');
    await decide('published');const result=await sync();assert.equal(result.conflicts.length,0);assert.equal(readFileSync(path,'utf8'),published);
    assert.equal(result.backups.length,1);assert.equal(readFileSync(join(root,result.backups[0]),'utf8'),local+'A newer local edit.');
    assert.ok(readdirSync(join(root,'.lumora-agent/skill-backups')).length);
    assert.deepEqual((await report()).resolutions,[]);
    writeFileSync(path,local);await s.edit(name,content(name,'Revision three'));await sync();
    await s.edit(name,content(name,'Revision four'));await assert.rejects(decide('published'),/409/);
  }finally{await s.close();}
});

test('sync status and resolution choices remain scoped to a project, repository and credential',async()=>{
  const s=await fixture(),root=temp(),other=temp();try {
    const b=s.store.transaction(()=>s.store.issue('p',{userId:'other',name:'Other',role:'agent'}));
    await refreshSkills(root,s.config,s.agent.token);await refreshSkills(other,s.config,b.token);
    const path=join(root,'.agents/skills/project-testing/SKILL.md');writeFileSync(path,content('project-testing','Private local version'));
    await s.edit('project-testing',content('project-testing','New shared default'));await refreshSkills(root,s.config,s.agent.token);
    const reports=(await requestJson(`${s.base}/skill-syncs`,s.admin.token)).items;
    assert.equal(reports.length,2);
    const a=reports.find((x:any)=>x.userId==='dev'),file=a.files.find((x:any)=>x.status==='conflict');
    const decision={path:file.path,localHash:file.localHash,remoteHash:file.remoteHash,choice:'published'};
    await assert.rejects(requestJson(`${s.base}/skill-syncs/${a.id}`,s.agent.token,'PUT',decision),/403/);
    await assert.rejects(requestJson(`${s.base}/skill-syncs`,s.observer.token,'POST',{}),/403/);
    assert.equal((await requestJson(`${s.base}/skill-syncs`,b.token)).items.length,1);
    await requestJson(`${s.base}/skill-syncs/${a.id}`,s.admin.token,'PUT',decision);
    assert.deepEqual((await requestJson(`${s.base}/skills?repository=${a.repositoryId}`,b.token)).resolutions,[]);
    const p=s.store.bootstrap('other-project','Other project','admin');
    await assert.rejects(requestJson(`${s.base}/skill-syncs/${a.id}`,p.token,'PUT',decision),/403/);
    assert.equal((await requestJson(`${s.url}/api/projects/other-project/skill-syncs`,p.token)).items.length,0);
  }finally{await s.close();}
});

test('an unavailable skill service preserves local files and still queues the prompt',async()=>{
  const s=await fixture(),root=temp();try {
    await refreshSkills(root,s.config,s.agent.token);
    const path=join(root,'.agents/skills/project-testing/SKILL.md'),before=readFileSync(path,'utf8');
    saveConnection(root,{...s.config,serverUrl:'http://127.0.0.1:1'});
    const output=JSON.stringify(await handleHook({cwd:root,session_id:'offline',hook_event_name:'UserPromptSubmit',prompt:'Review tests while offline'},{LUMORA_AGENT_TOKEN:s.agent.token}));
    assert.ok(output.includes('Skill refresh failed'));assert.equal(readFileSync(path,'utf8'),before);
    const queue=new Outbox(join(root,'.lumora-agent/outbox.sqlite'));
    try{assert.equal(queue.status().pending,1);assert.ok(queue.diagnostics().lastPromptCaptured);}finally{queue.close();}
  }finally{await s.close();}
});
