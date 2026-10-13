import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { Store } from '../src/store.ts';
import { createApp } from '../src/server.ts';
import { connectionSchema, eventSchema } from '../src/contracts.ts';
import { requestJson } from '../src/util.ts';
import { Outbox } from '../src/outbox.ts';
import { handleHook, saveConnection } from '../src/hook.ts';
import { makeRelease } from '../src/skills.ts';
import { LumoraClient } from '../src/lumora.ts';
import { packagePlugin } from '../src/package.ts';

const temp=()=>mkdtempSync(join(tmpdir(),'lumora-integration-'));
async function service(){const store=new Store(':memory:'),admin=store.bootstrap('p','Lumora','admin');store.publish(admin.principal,makeRelease('skills'));const server=createApp(store);server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;return {store,admin,server,url,close:async()=>{server.close();await once(server,'close');store.close();}};}
test('HTTP routes enforce identity, roles, body validation, origin and pagination',async()=>{
  const s=await service();try {
    assert.equal((await fetch(`${s.url}/api/projects/p/events`)).status,401);
    const issued=await requestJson(`${s.url}/api/projects/p/principals`,s.admin.token,'POST',{userId:'developer',name:'Dev',role:'agent'});
    const base=`${s.url}/api/projects/p`;
    await requestJson(`${base}/events`,issued.token,'POST',{id:'e',sessionId:'s',kind:'UserPromptSubmit',prompt:'<script>alert(1)</script>',occurredAt:new Date().toISOString()});
    const page=await requestJson(`${base}/events?limit=1`,s.admin.token);assert.equal(page.items.length,1);assert.ok(page.nextCursor);
    assert.equal((await requestJson(`${base}/events?before=${page.nextCursor}`,s.admin.token)).items.length,0);
    await assert.rejects(requestJson(`${s.url}/api/projects/other/events`,issued.token),/403/);
    await assert.rejects(requestJson(`${base}/policy`,issued.token,'PUT',{}),/403/);
    await assert.rejects(requestJson(`${base}/events`,issued.token,'POST',{organizationId:'spoof'}),/400/);
    const origin=await fetch(`${base}/events`,{headers:{Authorization:`Bearer ${issued.token}`,Origin:'https://foreign.test'}});assert.equal(origin.status,403);
    const html=await fetch(s.url);assert.ok(html.headers.get('content-security-policy')?.includes("script-src 'self'"));assert.ok((await html.text()).includes('Govern with evidence.'));
    const script=await(await fetch(`${s.url}/app.js`)).text();assert.ok(!script.includes('innerHTML'));
  }finally{await s.close();}
});
test('offline capture retries with stable ID; another credential cannot replay its queue',async()=>{
  const s=await service(),path=join(temp(),'outbox.sqlite'),q=new Outbox(path);
  try {
    const config=connectionSchema.parse({version:1,projectId:'p',serverUrl:s.url});
    const e=eventSchema.parse({id:'queued',sessionId:'s',kind:'UserPromptSubmit',prompt:'token test',occurredAt:new Date().toISOString()});
    q.put(e,q.identity(config,s.admin.token));
    const other=s.store.transaction(()=>s.store.issue('p',{userId:'b',name:'B',role:'agent'}));
    assert.equal((await q.flush(config,other.token,{force:true})).sent,0);
    const deniedConfig={...config,serverUrl:'http://127.0.0.1:1'};
    // Identity-pinned queue must never be sent to another URL.
    assert.equal((await q.flush(deniedConfig,s.admin.token,{force:true})).sent,0);
    assert.equal((await q.flush(config,s.admin.token,{force:true})).sent,1);
    q.put(e,q.identity(config,s.admin.token));assert.equal((await q.flush(config,s.admin.token,{force:true})).sent,1);
    assert.equal(s.store.listEvents(s.admin.principal,new URLSearchParams()).items.length,1);
  }finally{q.close();await s.close();}
});
test('Codex session refresh, prompt capture, denial and bounded stop execute end to end',async()=>{
  const s=await service(),root=temp();
  try {
    const config=connectionSchema.parse({version:1,projectId:'p',serverUrl:s.url});saveConnection(root,config);
    const env={LUMORA_AGENT_TOKEN:s.admin.token};const base={session_id:'codex-session',cwd:root,turn_id:'turn1'};
    const start=await handleHook({...base,hook_event_name:'SessionStart'},env);assert.ok(JSON.stringify(start).includes('Skill release'));
    assert.ok(existsSync(join(root,'.agents','skills','project-testing','SKILL.md')));
    await handleHook({...base,hook_event_name:'UserPromptSubmit',prompt:'api_key=supersecret Review Lumora'},env);
    const denied=await handleHook({...base,hook_event_name:'PreToolUse',tool_name:'Bash',tool_input:{command:'pnpm db:reset'}},env);
    assert.ok(JSON.stringify(denied).includes('permissionDecision":"deny'));
    const stop=await handleHook({...base,hook_event_name:'Stop'},env);assert.equal('decision' in stop?stop.decision:null,'block');
    const repeated=await handleHook({...base,hook_event_name:'Stop',stop_hook_active:true},env);assert.equal('decision'in repeated,false);
    const page=s.store.listEvents(s.admin.principal,new URLSearchParams());assert.equal(page.items.length,5);assert.ok(!JSON.stringify(page).includes('supersecret'));
    assert.equal(s.store.sessions(s.admin.principal)[0].endedAt,null);
  }finally{await s.close();}
});
test('Lumora adapter uses actual contracts, validates responses and does not guess skill identity',async()=>{
  const requests:{path:string,body:any,headers:any}[]=[];const release=makeRelease('skills');
  const server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;requests.push({path:req.url!,body:JSON.parse(raw),headers:req.headers});res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url?.endsWith('/sync')?{choreographies:release.skills,manifestHash:release.hash}:req.url?.includes('pre-tool')?{allowed:false,reason:'Autonomy required',runId:'r',approvalId:'approval'}:{id:'server-session',created:true}));});
  server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  try {
    const cfg={url,projectId:'lumora-p',apiKeyEnv:'KEY',sessionTokenEnv:'SESSION',skillSlug:'lumora-governance'};
    const client=new LumoraClient(cfg,{KEY:'api-key',SESSION:'session-token'});
    const event=eventSchema.parse({id:'stable',sessionId:'local',kind:'UserPromptSubmit',prompt:'Bearer secret-value',tool:'Bash',occurredAt:new Date().toISOString()});
    await client.openSession('local');await client.prompt(event,'server-session');assert.equal((await client.preTool(event)).allowed,false);assert.equal((await client.skills()).skills.length,3);
    assert.equal(requests[1].body.clientLocalId,'stable');assert.equal(requests[1].body.source,'CODEX');assert.equal(requests[1].headers['x-lumora-api-key'],'api-key');assert.equal(requests[1].headers.authorization,'Bearer session-token');assert.ok(!requests[1].body.content.includes('secret-value'));
    const noSkill=new LumoraClient({...cfg,skillSlug:undefined},{KEY:'key',SESSION:'session'});await assert.rejects(noSkill.preTool(event),/skill slug/);
  }finally{server.close();await once(server,'close');}
});
test('packaged runtime accepts real stdin hook payload without TypeScript dependency',async()=>{
  const dest=join(temp(),'plugin with spaces');await packagePlugin(dest);
  assert.ok(existsSync(join(dest,'plugin.json')));assert.ok(existsSync(join(dest,'runtime','node_modules','zod','package.json')));
  const proc=spawn(process.execPath,[join(dest,'runtime','hook.mjs')],{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';proc.stdout.on('data',x=>stdout+=x);proc.stderr.on('data',x=>stderr+=x);
  proc.stdin.end(JSON.stringify({hook_event_name:'PreToolUse',session_id:'s',cwd:temp(),tool_name:'Bash',tool_input:{command:'pnpm test'}}));
  const [code]=await once(proc,'close');assert.equal(code,0,stderr);assert.deepEqual(JSON.parse(stdout),{},'Plugin must be inactive in unconnected repositories');
  const hooks=JSON.parse(readFileSync(join(dest,'hooks','hooks.json'),'utf8'));
  const launch=hooks.hooks.PreToolUse[0].hooks[0];
  const viaShell=spawn(process.platform==='win32'?launch.commandWindows:launch.command,{shell:true,env:{...process.env,PLUGIN_ROOT:dest},stdio:['pipe','pipe','pipe']});
  let output='',error='';viaShell.stdout.on('data',x=>output+=x);viaShell.stderr.on('data',x=>error+=x);
  viaShell.stdin.end(JSON.stringify({hook_event_name:'PreToolUse',session_id:'shell',cwd:temp(),tool_name:'Bash',tool_input:{command:'pnpm test'}}));
  const [shellCode]=await once(viaShell,'close');assert.equal(shellCode,0,error);assert.deepEqual(JSON.parse(output),{});
});

test('outbox retains redacted events during a real outage and recovers after reopening',async()=>{
  let available=false,received=0;
  const server=createServer(async(req,res)=>{for await(const _ of req){}if(!available){res.writeHead(503);res.end('{}');return;}received++;res.setHeader('Content-Type','application/json');res.end('{"created":true}');});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const config=connectionSchema.parse({version:1,projectId:'p',serverUrl:`http://127.0.0.1:${(server.address()as{port:number}).port}`});
  const path=join(temp(),'queue.sqlite');let queue=new Outbox(path);
  try {
    queue.put(eventSchema.parse({id:'offline-event',sessionId:'s',kind:'UserPromptSubmit',occurredAt:new Date().toISOString(),prompt:'password=secret'}),queue.identity(config,'credential'));
    const failed=await queue.flush(config,'credential',{force:true});assert.equal(failed.failed,1);assert.equal(failed.pending,1);
    assert.ok(!String(queue.db.prepare('SELECT payload FROM queue').get()!.payload).includes('password=secret'));
    queue.close();queue=new Outbox(path);available=true;
    const recovered=await queue.flush(config,'credential',{force:true});assert.equal(recovered.sent,1);assert.equal(recovered.pending,0);assert.equal(received,1);
  }finally{queue.close();server.close();await once(server,'close');}
});

test('missing connection is inactive, while missing connected credentials cannot claim capture',async()=>{
  const root=temp();const hook={hook_event_name:'PreToolUse',session_id:'s',cwd:root,tool_name:'Bash',tool_input:{command:'pnpm test'}};
  assert.deepEqual(await handleHook(hook,{}),{});
  saveConnection(root,connectionSchema.parse({version:1,projectId:'p',serverUrl:'http://localhost:4318'}));
  await assert.rejects(handleHook(hook,{}),/Missing LUMORA_AGENT_TOKEN/);
});
