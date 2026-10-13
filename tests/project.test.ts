import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { inspectProject } from '../src/project.ts';
import { connectionAt, handleHook, saveConnection, NotConnected } from '../src/hook.ts';
import { connectionSchema, defaultPolicy } from '../src/contracts.ts';
import { makeRelease, syncSkills } from '../src/skills.ts';
import { canonical, sha256 } from '../src/util.ts';
import { Store } from '../src/store.ts';
import { createApp } from '../src/server.ts';

const temp=()=>mkdtempSync(join(tmpdir(),'project-governance-'));
function file(root:string,path:string,content:string){const parts=path.split('/');parts.pop();mkdirSync(join(root,...parts),{recursive:true});writeFileSync(join(root,path),content);}

test('manifest discovery distinguishes Angular, Python and unknown projects without executing scripts',()=>{
  const angular=temp(),python=temp(),unknown=temp();
  file(angular,'frontend/package.json',JSON.stringify({dependencies:{'@angular/core':'1'},devDependencies:{typescript:'1'},scripts:{test:'do not execute this',build:'also not executed'}}));
  file(angular,'frontend/pnpm-lock.yaml','');file(angular,'AGENTS.md','Rules');file(angular,'frontend/AGENTS.md','Nested rules');
  file(angular,'node_modules/fake/package.json','{}');file(angular,'nested/.git','gitdir: elsewhere');file(angular,'nested/package.json','{}');
  for(let i=0;i<210;i++)mkdirSync(join(angular,'aaa-cache',String(i)),{recursive:true});
  file(angular,'.data/generated/package.json','{}');
  file(python,'pyproject.toml','[project]\nname="weather"');file(python,'AGENTS.md','Python conventions');
  const a=inspectProject(angular),p=inspectProject(python);
  assert.deepEqual(a.frameworks,['Angular']);assert.deepEqual(a.languages,['JavaScript','TypeScript']);
  assert.deepEqual(a.manifests,['frontend/package.json']);assert.deepEqual(a.instructionFiles,['AGENTS.md','frontend/AGENTS.md']);
  assert.deepEqual(a.testScripts.map(s=>s.runner),['pnpm','pnpm']);
  assert.deepEqual(p.languages,['Python']);assert.deepEqual(p.frameworks,[]);assert.deepEqual(p.testScripts,[]);
  assert.deepEqual(inspectProject(unknown).languages,[]);
});

test('connection resolution respects independent nested repositories and missing roots',()=>{
  const parent=temp();saveConnection(parent,connectionSchema.parse({version:1,projectId:'parent',serverUrl:'http://localhost:4318'}));
  mkdirSync(join(parent,'src'));assert.equal(connectionAt(join(parent,'src')).config.projectId,'parent');
  file(parent,'child/.git','gitdir: separate');assert.throws(()=>connectionAt(join(parent,'child')),NotConnected);
  saveConnection(join(parent,'child'),connectionSchema.parse({version:1,projectId:'child',serverUrl:'http://localhost:4318'}));
  assert.equal(connectionAt(join(parent,'child')).config.projectId,'child');
  assert.throws(()=>inspectProject(join(parent,'missing')));
});

test('generic skill upgrade removes only unchanged receipt-owned legacy instructions',()=>{
  const root=temp(),content='---\nname: lumora-testing\ndescription: Old project-specific skill\n---\nLegacy';
  const skills=[{slug:'lumora-testing',version:'1',hash:sha256(content),content}];
  syncSkills(root,{version:'1',skills,hash:sha256(canonical(skills.map(({slug,version,hash})=>({slug,version,hash}))))});
  const unmanaged=join(root,'.agents/skills/custom/SKILL.md');file(root,'.agents/skills/custom/SKILL.md','Mine');
  syncSkills(root,makeRelease('skills','2'));
  assert.equal(existsSync(join(root,'.agents/skills/lumora-testing/SKILL.md')),false);
  assert.ok(existsSync(join(root,'.agents/skills/project-testing/SKILL.md')));assert.equal(readFileSync(unmanaged,'utf8'),'Mine');
});

test('two connected projects get independent context, policy, skills and prompt records',async()=>{
  const store=new Store(':memory:');const a=store.bootstrap('angular','UI','alice'),p=store.bootstrap('python','API','bob');
  store.setPolicy(a.principal,{...defaultPolicy,version:2,blockDatabasePush:true,sourceRules:[{id:'ui-boundary',pathPrefix:'src/',forbiddenText:'db.select(',allowedPathPrefixes:[],message:'Use the UI service layer.'}]});
  store.publish(a.principal,makeRelease('skills','angular-2'));store.publish(p.principal,makeRelease('skills','python-2'));
  const server=createApp(store);server.listen(0,'127.0.0.1');await once(server,'listening');
  const url=`http://127.0.0.1:${(server.address()as{port:number}).port}`,ar=temp(),pr=temp();
  file(ar,'package.json',JSON.stringify({dependencies:{'@angular/core':'1'}}));file(pr,'pyproject.toml','[project]');
  saveConnection(ar,connectionSchema.parse({version:1,projectId:'angular',serverUrl:url,tokenEnv:'UI_TOKEN'}));
  saveConnection(pr,connectionSchema.parse({version:1,projectId:'python',serverUrl:url,tokenEnv:'API_TOKEN'}));
  const env={UI_TOKEN:a.token,API_TOKEN:p.token};
  try {
    const ah={session_id:'same-local-session',cwd:ar},ph={...ah,cwd:pr};
    const as=JSON.stringify(await handleHook({...ah,hook_event_name:'SessionStart'},env));
    const ps=JSON.stringify(await handleHook({...ph,hook_event_name:'SessionStart'},env));
    assert.ok(as.includes('Angular'));assert.ok(ps.includes('Python'));assert.ok(!ps.includes('Angular'));
    assert.ok(as.includes('angular-2'));assert.ok(ps.includes('python-2'));
    const tool={hook_event_name:'PreToolUse',tool_name:'Bash',tool_input:{command:'pnpm db:push'}};
    assert.ok(JSON.stringify(await handleHook({...ah,...tool},env)).includes('permissionDecision":"deny'));
    assert.ok(!JSON.stringify(await handleHook({...ph,...tool},env)).includes('permissionDecision":"deny'));
    const patch={hook_event_name:'PreToolUse',tool_name:'apply_patch',tool_input:{patch:'*** Update File: src/service.py\n+db.select('}};
    assert.ok(JSON.stringify(await handleHook({...ah,...patch},env)).includes('ui-boundary'));
    assert.ok(!JSON.stringify(await handleHook({...ph,...patch},env)).includes('ui-boundary'));
    await handleHook({...ah,hook_event_name:'UserPromptSubmit',prompt:'UI change'},env);
    await handleHook({...ph,hook_event_name:'UserPromptSubmit',prompt:'API change'},env);
    const ae=JSON.stringify(store.listEvents(a.principal,new URLSearchParams())),pe=JSON.stringify(store.listEvents(p.principal,new URLSearchParams()));
    assert.ok(ae.includes('UI change'));assert.ok(!ae.includes('API change'));assert.ok(pe.includes('API change'));assert.ok(!pe.includes('UI change'));
  }finally{server.close();await once(server,'close');store.close();}
});
