import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { Store } from '../src/store.ts';
import { createApp } from '../src/server.ts';
import { makeRelease } from '../src/skills.ts';
import { handleHook, saveConnection } from '../src/hook.ts';
import { connectionSchema } from '../src/contracts.ts';

test('dashboard login, navigation, filtering, policy save, credential provisioning and mobile layout',async()=>{
  const store=new Store(':memory:'),admin=store.bootstrap('demo','Lumora · testing workspace','manager');
  store.publish(admin.principal,makeRelease('skills'));
  const developer=store.transaction(()=>store.issue('demo',{userId:'saiteja',name:'Saiteja',role:'agent'}));
  const second=store.transaction(()=>store.issue('demo',{userId:'aaditya',name:'Aaditya',role:'agent'}));
  const now=new Date().toISOString();
  for(const [p,session,prompt]of [[developer.principal,'session-codex-01','Write regression tests for Lumora project isolation and evidence links.'],[second.principal,'session-codex-02','Review the governance state transition and its failure cases.']] as const) {
    store.ingest(p,{id:`start-${session}`,sessionId:session,kind:'SessionStart',occurredAt:now});
    store.ingest(p,{id:`prompt-${session}`,sessionId:session,kind:'UserPromptSubmit',occurredAt:now,prompt});
  }
  store.ingest(developer.principal,{id:'denied',sessionId:'session-codex-01',kind:'PreToolUse',occurredAt:now,tool:'Bash',command:'pnpm db:reset',status:'denied',findings:[{rule:'database-reset',severity:'error',message:'Use a disposable test database.'}]});
  const server=createApp(store);server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  let browser;
  try {
    browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL??(process.platform==='win32'?'msedge':undefined)});
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base);await page.getByLabel('Workspace credential').fill(admin.token);await page.getByRole('button',{name:'Open workspace'}).click();
    await page.locator('#metrics .metric').first().waitFor();assert.equal(await page.locator('#metrics .metric strong').first().textContent(),'2');
    mkdirSync('docs/screenshots',{recursive:true});await page.screenshot({path:'docs/screenshots/overview.png',fullPage:true});
    await page.getByRole('button',{name:'Prompt & event logs',exact:true}).click();await page.getByLabel('Search prompt and event text').fill('regression');await page.getByRole('button',{name:'Search',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('#event-list .activity').length===1);
    assert.ok((await page.locator('#event-list').textContent())?.includes('regression'));
    await page.getByRole('button',{name:'Clear filters',exact:true}).click();
    await page.getByLabel('Filter by event',{exact:true}).selectOption('UserPromptSubmit');
    const root=mkdtempSync(join(tmpdir(),'lumora-browser-'));
    saveConnection(root,connectionSchema.parse({version:1,projectId:'demo',serverUrl:base}));
    await handleHook({hook_event_name:'UserPromptSubmit',session_id:'live-ui-capture',cwd:root,prompt:'New prompt delivered through the hook password=private-value'},{LUMORA_AGENT_TOKEN:developer.token});
    await page.locator('#event-list').getByText(/New prompt delivered through the hook/).waitFor({timeout:10000});
    assert.ok(!(await page.locator('#event-list').textContent())?.includes('private-value'));
    assert.equal(await page.locator('#event-list .activity').count(),3);
    await page.screenshot({path:'.lumora-agent/reports/prompt-live.png',fullPage:true});
    await page.getByRole('button',{name:'Project skills',exact:true}).click();await page.locator('#skill-list .skill').first().waitFor();assert.equal(await page.locator('#skill-list .skill').count(),3);
    await page.getByText('View published instructions',{exact:true}).first().click();
    assert.ok((await page.locator('#skill-list pre').first().textContent())?.includes('name: project-'));
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:'.lumora-agent/reports/local-skills-mobile.png',fullPage:true});
    await page.setViewportSize({width:1440,height:1000});
    await page.getByRole('button',{name:'Policy controls',exact:true}).click();await page.getByLabel('Enforcement mode').selectOption('observe');await page.getByRole('button',{name:'Save next policy version'}).click();await page.getByRole('status').filter({hasText:'Policy v2 saved'}).waitFor();assert.equal(store.policy('demo').mode,'observe');
    await page.getByRole('button',{name:'Team access',exact:true}).click();await page.getByLabel('User ID',{exact:true}).fill('reviewer');await page.getByLabel('Display name').fill('Reviewer');await page.getByLabel('Role',{exact:true}).selectOption('observer');await page.getByRole('button',{name:'Create credential'}).click();await page.locator('#new-token:not([hidden])').waitFor();assert.ok((await page.locator('#new-token').textContent())?.includes('lag_'));
    await page.getByRole('button',{name:'Overview',exact:true}).click();await page.getByRole('button',{name:'Verify audit chain'}).click();await page.locator('#audit-result').filter({hasText:'Verified'}).waitFor();
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:'docs/screenshots/mobile.png',fullPage:true});
    await page.reload();await page.getByRole('button',{name:'Open workspace'}).waitFor();assert.equal(await page.locator('#workspace').isVisible(),false);assert.deepEqual(errors,[]);
  }finally{await browser?.close();server.close();await once(server,'close');store.close();}
});

test('dashboard creates and edits skills, resolves repository conflicts, protects drafts and hides edits from agents',async()=>{
  const store=new Store(':memory:'),admin=store.bootstrap('editor','Skill editor workspace','manager');store.publish(admin.principal,makeRelease('skills'));
  const agent=store.transaction(()=>store.issue('editor',{userId:'developer',name:'Developer',role:'agent'}));
  const server=createApp(store);server.listen(0,'127.0.0.1');await once(server,'listening');
  const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`,root=mkdtempSync(join(tmpdir(),'skill-editor-ui-'));
  saveConnection(root,connectionSchema.parse({version:1,projectId:'editor',serverUrl:url}));
  const prompt=()=>handleHook({cwd:root,session_id:'editor-test',hook_event_name:'UserPromptSubmit',prompt:'Use current skills'},{LUMORA_AGENT_TOKEN:agent.token});
  let browser;
  try {
    browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL??(process.platform==='win32'?'msedge':undefined)});
    const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url);await page.getByLabel('Workspace credential').fill(admin.token);await page.getByRole('button',{name:'Open workspace'}).click();
    await page.getByRole('button',{name:'Project skills',exact:true}).click();
    await page.getByRole('button',{name:'Create skill',exact:true}).click();
    await page.getByLabel('Skill name',{exact:true}).fill('login-check');await page.getByLabel('Description',{exact:true}).fill('Test valid and expired sessions.');await page.getByLabel('Instructions',{exact:true}).fill('Use local authentication fixtures.');
    await page.screenshot({path:'.lumora-agent/reports/skill-create-desktop.png',fullPage:true});
    await page.getByRole('button',{name:'Save skill',exact:true}).click();await page.getByRole('status').filter({hasText:'Skill published.'}).waitFor();
    await prompt();const path=join(root,'.agents/skills/project-login-check/SKILL.md');assert.ok(readFileSync(path,'utf8').includes('Use local authentication fixtures.'));
    const local=readFileSync(path,'utf8')+'\nUse my local fixtures.';writeFileSync(path,local);
    await page.getByRole('button',{name:'Edit project-login-check',exact:true}).click();
    const published=readFileSync(path,'utf8').replace('Use my local fixtures.','Use the approved test database.');
    await page.getByLabel('Skill file (SKILL.md)',{exact:true}).fill(published);await page.getByRole('button',{name:'Save skill',exact:true}).click();await page.getByRole('status').filter({hasText:'Skill published.'}).waitFor();
    await prompt();assert.equal(readFileSync(path,'utf8'),local);
    await page.getByRole('button',{name:'Keep local',exact:true}).waitFor({timeout:10000});
    await page.screenshot({path:'.lumora-agent/reports/skill-conflict-desktop.png',fullPage:true});
    await page.getByRole('button',{name:'Keep local',exact:true}).click();await page.getByRole('status').filter({hasText:'Choice saved.'}).waitFor();await prompt();assert.equal(readFileSync(path,'utf8'),local);
    await page.getByRole('button',{name:'Edit project-login-check',exact:true}).click();
    const newer=published+'\nCover expired sessions.';
    await page.getByLabel('Skill file (SKILL.md)',{exact:true}).fill(newer);await page.getByRole('button',{name:'Save skill',exact:true}).click();await page.getByRole('status').filter({hasText:'Skill published.'}).waitFor();await prompt();
    await page.getByRole('button',{name:'Use published',exact:true}).waitFor({timeout:10000});
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:'.lumora-agent/reports/skill-conflict-mobile.png',fullPage:true});
    await page.getByRole('button',{name:'Use published',exact:true}).click();await page.getByRole('status').filter({hasText:'Choice saved.'}).waitFor();await prompt();assert.equal(readFileSync(path,'utf8'),newer);
    await page.getByRole('button',{name:'Edit project-login-check',exact:true}).click();
    const draft=newer+'\nUnsaved draft.';await page.getByLabel('Skill file (SKILL.md)',{exact:true}).fill(draft);
    store.editSkill(admin.principal,'project-login-check',{content:newer+'\nAnother administrator edited this.',create:false,expectedReleaseHash:store.release('editor')!.hash});
    await page.getByRole('button',{name:'Save skill',exact:true}).click();await page.getByRole('status').filter({hasText:'Skills changed since this editor opened.'}).waitFor();
    assert.equal(await page.getByLabel('Skill file (SKILL.md)',{exact:true}).inputValue(),draft);
    await page.screenshot({path:'.lumora-agent/reports/skill-editor-mobile.png',fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const readonly=await browser.newPage();await readonly.goto(url);await readonly.getByLabel('Workspace credential').fill(agent.token);await readonly.getByRole('button',{name:'Open workspace'}).click();await readonly.getByRole('button',{name:'Project skills',exact:true}).click();
    await readonly.locator('#skill-list .skill').first().waitFor();assert.equal(await readonly.getByRole('button',{name:'Create skill',exact:true}).count(),0);assert.equal(await readonly.getByRole('button',{name:'Edit project-login-check',exact:true}).count(),0);
    assert.deepEqual(errors,[]);
  }finally{await browser?.close();server.close();await once(server,'close');store.close();}
});
