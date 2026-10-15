import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store.ts';
import { defaultPolicy, eventSchema, hookSchema, connectionSchema } from '../src/contracts.ts';
import { redact } from '../src/redact.ts';
import { evaluate, reviewSource } from '../src/policy.ts';
import { canonical, sha256, HttpError } from '../src/util.ts';
import { localSkills, makeRelease, syncSkills } from '../src/skills.ts';
import { installHooks, uninstallHooks } from '../src/package.ts';

const temp=()=>mkdtempSync(join(tmpdir(),'lumora-test-'));
const event=(more:Record<string,unknown>={})=>eventSchema.parse({id:randomUUID(),sessionId:'s1',kind:'UserPromptSubmit',occurredAt:new Date().toISOString(),prompt:'Test tenant isolation',...more});
test('principal isolation, immutable event replay, and ownership survive restart',()=>{
  const path=join(temp(),'data.sqlite');let store=new Store(path);
  const a=store.bootstrap('a','A','alice'),b=store.bootstrap('b','B','bob');
  const agent=store.transaction(()=>store.issue('a',{userId:'charlie',name:'Charlie',role:'agent'}));
  const e=event();assert.equal(store.ingest(a.principal,e).created,true);assert.equal(store.ingest(a.principal,e).created,false);
  assert.throws(()=>store.ingest(a.principal,{...e,prompt:'Different'}),/already used/);
  assert.throws(()=>store.ingest(agent.principal,event()),/another user/);
  assert.throws(()=>store.require(b.principal,'a'),/does not permit/);
  assert.equal(store.listEvents(b.principal,new URLSearchParams()).items.length,0);
  assert.equal(store.listEvents(agent.principal,new URLSearchParams()).items.length,0);
  assert.equal(store.sessions(a.principal).length,1);assert.equal(store.integrity('a').valid,true);
  store.close();store=new Store(path);assert.equal(store.auth(a.token).userId,'alice');assert.equal(store.listEvents(a.principal,new URLSearchParams()).items.length,1);
  store.revoke(a.principal,agent.principal.id);assert.throws(()=>store.auth(agent.token),/revoked/);store.close();
});
test('roles, policy optimistic versioning and audit tamper detection',()=>{
  const s=new Store(':memory:'),a=s.bootstrap('p','P','a');
  const observer=s.transaction(()=>s.issue('p',{userId:'o',name:'Observer',role:'observer'}));
  assert.throws(()=>s.ingest(observer.principal,event()),/does not permit/);
  assert.throws(()=>s.setPolicy(observer.principal,{...defaultPolicy,version:2}),/does not permit/);
  s.setPolicy(a.principal,{...defaultPolicy,version:2,mode:'observe'});
  assert.throws(()=>s.setPolicy(a.principal,{...defaultPolicy,version:2}),/increase/);
  assert.equal(s.integrity('p').valid,true);s.db.prepare("UPDATE audit SET payload='{}' WHERE seq=1").run();assert.equal(s.integrity('p').valid,false);s.close();
});
test('secrets are redacted before stored prompt and audit representations',()=>{
  const s=new Store(':memory:'),a=s.bootstrap('p','P','a');
  const secrets=['sk-abcdefghijklmnopqrstuv','ghp_abcdefghijklmnopqrstuvwxyz','AKIAABCDEFGHIJKLMNOP'];
  s.ingest(a.principal,event({prompt:`api_key=${secrets[0]} Bearer abc.def.ghi ${secrets[1]} ${secrets[2]} postgres://name:password@db/x`}));
  const rows=JSON.stringify(s.db.prepare('SELECT payload FROM events UNION ALL SELECT payload FROM audit').all());
  for(const secret of secrets)assert.ok(!rows.includes(secret));assert.ok(!rows.includes('abc.def.ghi'));assert.ok(!rows.includes('name:password'));
  assert.equal(redact(redact('password=hidden')),redact('password=hidden'));s.close();
});
test('quoted JSON prompts remain capturable and redact their values',()=>{
  const s=new Store(':memory:'),a=s.bootstrap('p','P','a');
  const prompt='Inspect this JSON: {"api_key":"highly-secret-value", "name":"Lumora"}';
  s.ingest(a.principal,event({prompt}));
  const stored=s.listEvents(a.principal,new URLSearchParams()).items[0];
  assert.ok(!stored.prompt.includes('highly-secret-value'));assert.ok(stored.prompt.includes('Lumora'));s.close();
});
test('policy distinguishes blocking violations, observation and architecture findings',()=>{
  const root=temp();const hook=(command:string,tool='Bash')=>hookSchema.parse({hook_event_name:'PreToolUse',session_id:'s',cwd:root,tool_name:tool,tool_input:{command}});
  assert.equal(evaluate(hook('pnpm db:reset'),root).allowed,false);
  assert.equal(evaluate(hook('pnpm test'),root).allowed,true);
  assert.equal(evaluate(hook('pnpm db:reset'),root,{...defaultPolicy,mode:'observe'}).allowed,true);
  assert.equal(evaluate(hook('*** Begin Patch\n*** Update File: ../outside.ts\n+x\n*** End Patch','apply_patch'),root).allowed,false);
  assert.equal(evaluate(hook('*** Begin Patch\n*** Update File: AGENTS.md\n+x\n*** End Patch','apply_patch'),root).allowed,false);
  const source='import { db } from "@/db/client";\nexport interface User {id: string}\n';
  assert.deepEqual(reviewSource('frontend-angular/src/app/example.ts',source),[]);
  const policy={...defaultPolicy,sourceRules:[{id:'my-boundary',pathPrefix:'frontend-angular/',forbiddenText:'@/db/',allowedPathPrefixes:[],message:'This project uses API calls from its UI.'}]};
  assert.deepEqual(reviewSource('frontend-angular/src/app/example.ts',source,policy).map(x=>x.rule),['my-boundary']);
  assert.equal(evaluate(hook('pnpm db:push'),root).allowed,true);
  assert.equal(evaluate(hook('pnpm db:push'),root,{...defaultPolicy,blockDatabasePush:true}).allowed,false);
  const patch='*** Update File: frontend-angular/ui.ts\n+const ok = true;\n*** Update File: backend/db.ts\n+import {db} from "@/db/client";';
  assert.deepEqual(evaluate(hook(patch,'apply_patch'),root,policy).findings,[],'Patch text must remain attributed to its actual file');
  assert.equal(reviewSource('backend/src/lib/ai/client.ts','import OpenAI from "openai";').length,0);
});
test('skill releases validate all hashes and preserve tampered or unmanaged files',()=>{
  const root=temp(),release=makeRelease('skills');
  const result=syncSkills(root,release);assert.equal(result.skills,3);
  assert.equal(syncSkills(root,release).changed,0);
  const bad=structuredClone(release);bad.skills[0].content+='tampered';assert.throws(()=>syncSkills(root,bad),/hash mismatch/);
  const file=join(root,'.agents','skills',release.skills[0].slug,'SKILL.md');writeFileSync(file,'user edit');
  assert.equal(syncSkills(root,release).preserved.length,1);assert.equal(readFileSync(file,'utf8'),'user edit');
  assert.equal(localSkills(root).find(s=>s.absolute===file)?.status,'local override');
  const other=temp();mkdirSync(join(other,'.agents','skills',release.skills[0].slug),{recursive:true});writeFileSync(join(other,'.agents','skills',release.skills[0].slug,'SKILL.md'),'own skill');
  assert.equal(syncSkills(other,release).preserved.length,1);
  const removed={version:'2',skills:[],hash:sha256(canonical([]))};assert.equal(syncSkills(root,removed).preserved.length,1);
  assert.equal(readFileSync(file,'utf8'),'user edit');assert.equal(localSkills(root).length,1);
});

test('local overrides survive repeated upstream upgrades while untouched skills update',()=>{
  const root=temp(),release=makeRelease('skills','1');syncSkills(root,release);
  const file=join(root,'.agents/skills/project-testing/SKILL.md'),custom=readFileSync(file,'utf8')+'\nUse the repository fixtures and cover expired sessions.';
  writeFileSync(file,custom);
  const upgraded=makeRelease('skills','2');
  for(const skill of upgraded.skills){skill.content+='\nUpdated default';skill.hash=sha256(skill.content);}
  upgraded.hash=sha256(canonical(upgraded.skills.map(({slug,version,hash})=>({slug,version,hash}))));
  assert.equal(syncSkills(root,upgraded).preserved.length,1);
  assert.equal(syncSkills(root,upgraded).changed,0);
  assert.equal(readFileSync(file,'utf8'),custom);
  assert.ok(readFileSync(join(root,'.agents/skills/project-review/SKILL.md'),'utf8').endsWith('Updated default'));
  const other=temp();syncSkills(other,upgraded);
  assert.ok(!readFileSync(join(other,'.agents/skills/project-testing/SKILL.md'),'utf8').includes('cover expired sessions'));
});
test('release versions cannot silently change, while rollback activates known content',()=>{
  const s=new Store(':memory:'),a=s.bootstrap('p','P','a'),one=makeRelease('skills','1'),two=makeRelease('skills','2');
  s.publish(a.principal,one);s.publish(a.principal,two);s.publish(a.principal,one);assert.equal(s.release('p')?.version,'1');
  const bad={...two,version:'1'};assert.throws(()=>s.publish(a.principal,bad),/immutable/);s.close();
});
test('installer composes and uninstalls only owned hooks; malformed config is preserved',()=>{
  const root=temp(),pkg=join(temp(),'plugin');mkdirSync(join(pkg,'runtime'),{recursive:true});writeFileSync(join(pkg,'runtime','hook.mjs'),'');
  mkdirSync(join(root,'.codex'));const file=join(root,'.codex','hooks.json');
  const foreign={hooks:{UserPromptSubmit:[{matcher:'x',hooks:[{type:'command',command:'echo foreign'}]}]},other:'preserve'};
  writeFileSync(file,JSON.stringify(foreign));installHooks(root,pkg);installHooks(root,pkg);
  assert.equal(JSON.parse(readFileSync(file,'utf8')).hooks.UserPromptSubmit.length,2);
  uninstallHooks(root);assert.deepEqual(JSON.parse(readFileSync(file,'utf8')),foreign);
  writeFileSync(file,'{bad json');assert.throws(()=>installHooks(root,pkg));assert.equal(readFileSync(file,'utf8'),'{bad json');
});
test('connection contracts refuse credentials and untrusted key shapes',()=>{
  assert.throws(()=>connectionSchema.parse({version:1,projectId:'p',serverUrl:'http://localhost:4318',token:'secret'}));
  assert.throws(()=>eventSchema.parse({...event(),organizationId:'spoof'}));
});
