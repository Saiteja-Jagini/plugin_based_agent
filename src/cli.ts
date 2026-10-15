import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { connectionSchema, id, provisionSchema, defaultPolicy, policySchema } from './contracts.ts';
import { Store } from './store.ts';
import { createApp } from './server.ts';
import { atomicWrite, readJson, requestJson, safePath, trustedUrl } from './util.ts';
import { connectionAt, hookMain, saveConnection, NotConnected } from './hook.ts';
import { localSkills, makeRelease, syncSkills } from './skills.ts';
import { Outbox } from './outbox.ts';
import { buildNpm, installHooks, packagePlugin, uninstallHooks } from './package.ts';
import { reviewRepository } from './review.ts';
import { LumoraClient } from './lumora.ts';
import { inspectProject } from './project.ts';
import { diagnose } from './diagnostics.ts';
import { refreshSkills } from './skill-sync.ts';

const HELP=`Project Governance for Codex, connected through Lumora (Node 24+)
  init --project ID --name NAME --user admin [--data .lumora-agent/service]
  serve [--port 4318] [--data .lumora-agent/service]
  connect --root PATH --project ID [--server http://127.0.0.1:4318] [--token-env LUMORA_AGENT_TOKEN]
  package --out NEW_DIRECTORY
  install --root PATH --package PLUGIN_DIRECTORY
  uninstall --root PATH
  publish --root PATH [--skills DIRECTORY] [--version 1.0.0]
  provision --root PATH --user ID --name NAME --role agent|observer|admin
  sync|flush|status|doctor --root PATH
  skills --root PATH  (list local skill files and overrides; no credential required)
  review --root PATH [--out REPORT.json]
  profile --root PATH  (read-only repository detection, no credential required)
  policy --root PATH [--file POLICY.json]  (read policy, or administrator versioned update)
  bridge --root PATH   (explicit prompt delivery to configured Lumora; current user only)
  demo                 (isolated synthetic data and onboarding files)
  hook                 (Codex JSON on stdin)
Credentials are read from environment variables; init/provision print newly created credentials once.
`;
function args(argv:string[]) {
  const options=Object.fromEntries(['root','project','name','user','data','port','server','token-env','out','package','skills','version','role','file'].map(k=>[k,{type:'string' as const}]));
  return parseArgs({args:argv,options,allowPositionals:true});
}
const show=(value:unknown)=>process.stdout.write(`${JSON.stringify(value,null,2)}\n`);
async function connected(root:string) {
  const connection=connectionAt(root),token=process.env[connection.config.tokenEnv];
  if(!token)throw new Error(`Set ${connection.config.tokenEnv} in your shell; do not put credentials in connection.json`);
  return {...connection,token,base:`${connection.config.serverUrl}/api/projects/${encodeURIComponent(connection.config.projectId)}`};
}
export async function main(argv=process.argv.slice(2)) {
  const {values:v,positionals}=args(argv),command=positionals[0],root=resolve(v.root??process.cwd());
  if(!command||command==='help'){process.stdout.write(HELP);return;}
  if(command==='hook'){await hookMain();return;}
  if(command==='init') {
    const store=new Store(resolve(v.data??'.lumora-agent/service','control.sqlite'));
    try{const p=id.parse(v.project);const result=store.bootstrap(p,v.name??p,id.parse(v.user??'admin'));store.publish(result.principal,makeRelease(fileURLToPath(new URL('../skills',import.meta.url)),'2.1.0'));show(result);}finally{store.close();}return;
  }
  if(command==='serve') {
    const port=Number(v.port??4318);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid port');
    const store=new Store(resolve(v.data??'.lumora-agent/service','control.sqlite'));
    const server=createApp(store);server.listen(port,'127.0.0.1',()=>show({url:`http://127.0.0.1:${port}`,deployment:'Local pilot; credentials required'}));
    const stop=()=>server.close(()=>{store.close();process.exit(0);});process.once('SIGINT',stop);process.once('SIGTERM',stop);return;
  }
  if(command==='connect') {
    const profile=inspectProject(root);
    if(existsSync(join(root,'.lumora-agent','connection.json')))throw new Error('Connection exists; preserve it and use its configured environment credential');
    const config=connectionSchema.parse({version:1,projectId:v.project,serverUrl:trustedUrl(v.server??'http://127.0.0.1:4318'),tokenEnv:v['token-env']??'LUMORA_AGENT_TOKEN'});
    const token=process.env[config.tokenEnv];if(!token)throw new Error(`Missing ${config.tokenEnv}`);
    const me=await requestJson(`${config.serverUrl}/api/me`,token);if(me.projectId!==config.projectId)throw new Error('Credential belongs to another project');
    if(me.role==='observer')throw new Error('Capture requires an agent or administrator credential; observers can only read logs');
    config.policy=policySchema.parse(await requestJson(`${config.serverUrl}/api/projects/${encodeURIComponent(config.projectId)}/policy`,token));
    saveConnection(root,config);
    let skills:unknown=null,warning:string|undefined;
    try{skills=await refreshSkills(root,config,token);}catch{warning='Connected, but initial skill sync failed. Run sync to inspect the error; existing files were preserved.';}
    show({connected:true,project:config.projectId,root,profile,skills,warning,next:'Keep the service running. Install the plugin or project hooks, review/trust /hooks, then start Codex in this repository with the same credential environment. Send a new prompt and run doctor to check delivery.'});return;
  }
  if(command==='package'){if(!v.out)throw new Error('--out is required');show(await packagePlugin(v.out));return;}
  if(command==='build'){show(await buildNpm());return;}
  if(command==='install'){if(!v.package)throw new Error('--package is required');show(installHooks(root,v.package));return;}
  if(command==='uninstall'){show(uninstallHooks(root));return;}
  if(command==='profile'){show(inspectProject(root));return;}
  if(command==='skills'){show({root,skills:localSkills(connectionAt(root).root),usage:'Edit the local SKILL.md in your editor. Sync preserves local overrides. Ask Codex to read that file for the task; start a new session for discovery changes.'});return;}
  if(command==='doctor'||command==='status'){show(await diagnose(root));return;}
  if(command==='review'){
    let policy=defaultPolicy,policySource='generic defaults (unconnected repository)';
    try {
      const c=connectionAt(root);policy=c.config.policy;policySource='connection policy fallback';
      if(existsSync(join(c.root,'.lumora-agent/outbox.sqlite'))){const q=new Outbox(safePath(c.root,'.lumora-agent/outbox.sqlite'));try{policy=policySchema.parse(q.get(`policy:${c.config.serverUrl}:${c.config.projectId}`)??policy);policySource='last local policy; may be stale';}finally{q.close();}}
      const token=process.env[c.config.tokenEnv];
      if(token){policy=policySchema.parse(await requestJson(`${c.config.serverUrl}/api/projects/${encodeURIComponent(c.config.projectId)}/policy`,token));policySource='current platform project policy';}
      if(c.root!==root)throw new Error('Review must use the connected repository root so policy paths remain relative to it');
    }catch(error){if(!(error instanceof NotConnected))throw error;}
    const report={...reviewRepository(root,policy),policySource};if(v.out)atomicWrite(resolve(v.out),JSON.stringify(report,null,2));show(report);return;
  }
  if(command==='demo') {
    const dir=resolve('.lumora-agent/demo');const store=new Store(join(dir,'control.sqlite'));
    try {
      const admin=store.bootstrap('lumora-demo','Lumora · demonstration','manager');
      store.publish(admin.principal,makeRelease(fileURLToPath(new URL('../skills',import.meta.url))));
      const agent=store.transaction(()=>store.issue('lumora-demo',{userId:'developer',name:'Developer',role:'agent'}));
      const now=new Date().toISOString();
      store.ingest(agent.principal,{id:'demo-start',sessionId:'demo-session',kind:'SessionStart',occurredAt:now});
      store.ingest(agent.principal,{id:'demo-prompt',sessionId:'demo-session',kind:'UserPromptSubmit',occurredAt:now,prompt:'Write tests for Lumora project isolation and evidence links.'});
      store.ingest(agent.principal,{id:'demo-denial',sessionId:'demo-session',kind:'PreToolUse',occurredAt:now,tool:'Bash',command:'pnpm db:reset',status:'denied',findings:[{rule:'database-reset',severity:'error',message:'Use a disposable test database.'}]});
      atomicWrite(join(dir,'credentials.json'),JSON.stringify({adminToken:admin.token,agentToken:agent.token},null,2));
      show({data:dir,credentials:join(dir,'credentials.json'),next:`node src/cli.ts serve --data "${dir}"`,note:'Synthetic demonstration events; no Lumora connection or tests were executed.'});
    }finally{store.close();}return;
  }
  const c=await connected(root);
  if(command==='policy'){show(await requestJson(`${c.base}/policy`,c.token,v.file?'PUT':'GET',v.file?policySchema.parse(readJson(resolve(v.file))):undefined));return;}
  if(command==='provision'){show(await requestJson(`${c.base}/principals`,c.token,'POST',provisionSchema.parse({userId:v.user,name:v.name,role:v.role??'agent'})));return;}
  if(command==='publish'){show(await requestJson(`${c.base}/skills`,c.token,'POST',makeRelease(resolve(v.skills??fileURLToPath(new URL('../skills',import.meta.url))),v.version??'2.1.0')));return;}
  if(command==='sync') {show(c.config.lumora?syncSkills(c.root,await new LumoraClient(c.config.lumora).skills()):await refreshSkills(c.root,c.config,c.token));return;}
  const queue=new Outbox(safePath(c.root,'.lumora-agent/outbox.sqlite'));
  try {
    if(command==='flush'){show(await queue.flush(c.config,c.token,{force:true,limit:200,budgetMs:30000}));return;}
    if(command==='bridge') {
      if(!c.config.lumora)throw new Error('Configure the optional lumora adapter in connection.json before bridging');
      const me=await requestJson(`${c.config.serverUrl}/api/me`,c.token),client=new LumoraClient(c.config.lumora);
      let before:unknown=undefined,sent=0;
      // Stable event IDs make prompt replay safe; no non-idempotent outcome/session writes.
      const identity=queue.identity(c.config,c.token);
      do {
        const query=new URLSearchParams({kind:'UserPromptSubmit',user:me.userId,limit:'200'});if(before)query.set('before',String(before));
        const page=await requestJson(`${c.base}/events?${query}`,c.token);
        for(const event of page.items) {
          const key=`lumora-prompt:${identity}:${c.config.lumora.url}:${c.config.lumora.projectId}:${event.id}`;
          if(queue.get(key))continue;
          await client.prompt(event);queue.set(key,true);sent++;
        }
        before=page.nextCursor;
      }while(before);
      show({sent,note:'Prompt events only. Session and outcome integration remains explicit.'});return;
    }
    throw new Error(`Unknown command: ${command}`);
  }finally{queue.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{process.stderr.write(`${error instanceof Error?error.message:'Command failed'}\n`);process.exitCode=1;});
