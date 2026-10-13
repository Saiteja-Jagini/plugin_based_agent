import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { Store } from '../src/store.ts';
import { createApp } from '../src/server.ts';
import { makeRelease } from '../src/skills.ts';

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
    await page.getByRole('button',{name:'Project skills',exact:true}).click();await page.locator('#skill-list .skill').first().waitFor();assert.equal(await page.locator('#skill-list .skill').count(),3);
    await page.getByRole('button',{name:'Policy controls',exact:true}).click();await page.getByLabel('Enforcement mode').selectOption('observe');await page.getByRole('button',{name:'Save next policy version'}).click();await page.getByRole('status').filter({hasText:'Policy v2 saved'}).waitFor();assert.equal(store.policy('demo').mode,'observe');
    await page.getByRole('button',{name:'Team access',exact:true}).click();await page.getByLabel('User ID',{exact:true}).fill('reviewer');await page.getByLabel('Display name').fill('Reviewer');await page.getByLabel('Role',{exact:true}).selectOption('observer');await page.getByRole('button',{name:'Create credential'}).click();await page.locator('#new-token:not([hidden])').waitFor();assert.ok((await page.locator('#new-token').textContent())?.includes('lag_'));
    await page.getByRole('button',{name:'Overview',exact:true}).click();await page.getByRole('button',{name:'Verify audit chain'}).click();await page.locator('#audit-result').filter({hasText:'Verified'}).waitFor();
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:'docs/screenshots/mobile.png',fullPage:true});
    await page.reload();await page.getByRole('button',{name:'Open workspace'}).waitFor();assert.equal(await page.locator('#workspace').isVisible(),false);assert.deepEqual(errors,[]);
  }finally{await browser?.close();server.close();await once(server,'close');store.close();}
});
