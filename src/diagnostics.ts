import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { connectionAt, NotConnected } from './hook.ts';
import { Outbox } from './outbox.ts';
import { localSkills } from './skills.ts';
import { HttpError, requestJson, safePath } from './util.ts';

export async function diagnose(root:string,env:NodeJS.ProcessEnv=process.env) {
  let connected;
  try{connected=connectionAt(root);}catch(error){
    if(error instanceof NotConnected)return {connected:false,root:resolve(root),actions:['Run connect for this repository. Installing the plugin alone does not connect a project.']};
    throw error;
  }
  const {config}=connected;root=connected.root;
  const token=env[config.tokenEnv],actions:string[]=[];
  let api='not checked',identity:null|{userId:string,role:string}=null,latestServerPrompt:unknown=null;
  if(!token)actions.push(`Set ${config.tokenEnv} before launching Codex. A variable set in another terminal does not reach an already-running app.`);
  else try {
    const me=await requestJson(`${config.serverUrl}/api/me`,token);
    if(me.projectId!==config.projectId){api='wrong project credential';actions.push('Use a credential issued for this connection project.');}
    else {
      api='authenticated';identity={userId:me.userId,role:me.role};
      if(me.role==='observer')actions.push('Use an agent or administrator credential for capture; observers can only read logs.');
      const page=await requestJson(`${config.serverUrl}/api/projects/${encodeURIComponent(config.projectId)}/events?kind=UserPromptSubmit&user=${encodeURIComponent(me.userId)}&limit=1`,token);
      if(page.items[0]){const e=page.items[0];latestServerPrompt={id:e.id,at:e.occurredAt,sessionId:e.sessionId};}
    }
  }catch(error){api=error instanceof HttpError?`HTTP ${error.status}`:'service unreachable';actions.push(api==='HTTP 401'?'Credential is invalid or revoked; use a valid project credential.':`Check the service at ${config.serverUrl} and the configured service data directory.`);}
  let queue:ReturnType<Outbox['status']>|null=null,capture:ReturnType<Outbox['diagnostics']>|null=null;
  if(existsSync(join(root,'.lumora-agent/outbox.sqlite'))) {
    const outbox=new Outbox(safePath(root,'.lumora-agent/outbox.sqlite'));
    try{queue=outbox.status();capture=outbox.diagnostics();}finally{outbox.close();}
  }
  if(!capture?.lastPromptInvocation)actions.push('No UserPromptSubmit invocation recorded by this runtime. Enable the updated plugin, review/trust its hooks in /hooks, and submit a new prompt in this repository. Older runtimes do not record these diagnostics.');
  if(capture?.lastPromptInvocation?.credential==='missing')actions.push('The last prompt hook ran without its credential. Restart Codex with the configured environment variable. That uncaptured prompt cannot be recovered by flush.');
  if(queue?.pending)actions.push('Run flush with the original capture credential to deliver queued events; credentials cannot replay another identity\'s queue.');
  actions.push('In the dashboard, sign in to the same project, clear search/session filters and select UserPromptSubmit. Agent accounts see only their own events.');
  return {connected:true,root,project:config.projectId,server:config.serverUrl,tokenEnv:config.tokenEnv,credential:token?'present in this process':'missing in this process',api,identity,
    projectHooks:existsSync(join(root,'.codex/hooks.json')),nativeTrust:'Host-controlled: inspect /hooks. A connection or CLI authentication does not prove native hook invocation.',
    queue,capture,latestServerPrompt,skills:localSkills(root),actions};
}
