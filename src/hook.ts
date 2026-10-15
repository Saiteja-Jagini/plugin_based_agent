import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { connectionSchema, eventSchema, hookSchema, policySchema, type Connection, type Event, type Hook } from './contracts.ts';
import { atomicWrite, readJson, requestJson, safePath, trustedUrl } from './util.ts';
import { evaluate } from './policy.ts';
import { Outbox } from './outbox.ts';
import { localSkillContext, syncSkills } from './skills.ts';
import { LumoraClient } from './lumora.ts';
import { projectContext } from './project.ts';
import { refreshSkills } from './skill-sync.ts';

export class NotConnected extends Error {}
export function connectionAt(cwd:string) {
  let root=resolve(cwd);
  while(true) {
    const path=join(root,'.lumora-agent','connection.json');
    if(existsSync(path)) {
      const config=connectionSchema.parse(readJson(safePath(root,path)));
      config.serverUrl=trustedUrl(config.serverUrl);
      if(config.lumora)config.lumora.url=trustedUrl(config.lumora.url);
      return {root,config};
    }
    const parent=dirname(root);if(parent===root||existsSync(join(root,'.git')))throw new NotConnected('No platform connection found; run connect for this repository');root=parent;
  }
}
function context(event:string,message:string) {return {hookSpecificOutput:{hookEventName:event,additionalContext:message}};}
function denied(reason:string) {return {hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:reason}};}
function resultStatus(hook:Hook):Event['status'] {
  const output=hook.tool_response;
  if(output&&typeof output==='object') {
    const o=output as Record<string,unknown>;
    if(o.isError===true || (typeof o.exit_code==='number'&&o.exit_code!==0))return 'failed';
    if(o.exit_code===0)return 'succeeded';
  }
  return 'unknown';
}
export async function handleHook(raw:unknown,env:NodeJS.ProcessEnv=process.env) {
  const hook=hookSchema.parse(raw);
  let connected:ReturnType<typeof connectionAt>;
  try{connected=connectionAt(hook.cwd);}catch(error){if(error instanceof NotConnected)return {};throw error;}
  const {root,config}=connected;
  const token=env[config.tokenEnv];
  const outbox=new Outbox(safePath(root,'.lumora-agent/outbox.sqlite'));
  const warnings:string[]=[];
  try {
    const invocation={at:new Date().toISOString(),kind:hook.hook_event_name,sessionId:hook.session_id,project:config.projectId,credential:token?'present':'missing'};
    outbox.set('capture:lastInvocation',invocation);
    if(hook.hook_event_name==='UserPromptSubmit')outbox.set('capture:lastPromptInvocation',invocation);
    if(!token)throw new Error(`Missing ${config.tokenEnv} in the Codex process. Set it before launching Codex, then restart the host; this prompt was not captured.`);
    let policy=policySchema.parse(outbox.get(`policy:${config.serverUrl}:${config.projectId}`)??config.policy);
    let release:string|undefined;
    if(hook.hook_event_name==='SessionStart') {
      try {
        policy=policySchema.parse(await requestJson(`${config.serverUrl}/api/projects/${encodeURIComponent(config.projectId)}/policy`,token));
        outbox.set(`policy:${config.serverUrl}:${config.projectId}`,policy);
      }catch{warnings.push('Platform refresh failed; retained the last verified skills and policy.');}
    }
    if(hook.hook_event_name==='SessionStart'||hook.hook_event_name==='UserPromptSubmit') {
      if(!config.lumora) {
        try {
          const synced=await refreshSkills(root,config,token);release=synced.version;
          if(synced.conflicts.length)warnings.push(`${synced.conflicts.length} skill conflict(s): local files preserved. Resolve them in Project skills in the dashboard.`);
          if(synced.reportWarning)warnings.push(synced.reportWarning);
        }catch{warnings.push('Skill refresh failed; existing local files retained. Check the service and run sync for details.');}
      }
      if(config.lumora) {
        // Lumora is authoritative when the deployment explicitly enables its adapter.
        try{const synced=syncSkills(root,await new LumoraClient(config.lumora,env).skills());release=synced.version;}
        catch{warnings.push('Lumora skill refresh failed; retained the last verified release.');}
      }
    }
    const decision=evaluate(hook,root,policy);
    const event=eventSchema.parse({id:randomUUID(),sessionId:hook.session_id,kind:hook.hook_event_name,occurredAt:new Date().toISOString(),
      turnId:hook.turn_id,toolCallId:hook.tool_use_id,tool:hook.tool_name,prompt:hook.hook_event_name==='UserPromptSubmit'?hook.prompt:undefined,
      command:decision.command?decision.command.slice(0,16000):undefined,paths:decision.paths,
      findings:hook.hook_event_name==='PreToolUse'?decision.findings:[],
      status:hook.hook_event_name==='PreToolUse'?(decision.allowed?'allowed':'denied'):hook.hook_event_name==='PostToolUse'?resultStatus(hook):'observed',
      skillRelease:release,detail:warnings.join(' ').slice(0,2000)||undefined});
    if(hook.hook_event_name==='PreToolUse'&&decision.allowed&&config.lumora) {
      try {
        const remote=await new LumoraClient(config.lumora,env).preTool(event);
        if(!remote.allowed){decision.allowed=false;event.status='denied';event.findings.push({rule:'lumora-policy',severity:'error',message:remote.reason??'Lumora denied this operation'});}
      }catch{decision.allowed=false;event.status='denied';event.findings.push({rule:'lumora-unavailable',severity:'error',message:'Lumora policy could not be verified. Retry after restoring the connection.'});}
    }
    outbox.put(event,outbox.identity(config,token));
    outbox.set('capture:lastCaptured',{at:event.occurredAt,kind:event.kind,eventId:event.id});
    if(event.kind==='UserPromptSubmit')outbox.set('capture:lastPromptCaptured',{at:event.occurredAt,eventId:event.id,sessionId:event.sessionId});
    // Capture is durable before network delivery; a short budget keeps prompt latency bounded.
    const delivery=await outbox.flush(config,token,{budgetMs:1200,limit:10});
    if(delivery.failed)warnings.push('Event queued locally; service delivery is pending.');
    if(hook.hook_event_name==='PreToolUse'&&!decision.allowed)return denied(event.findings.filter(f=>f.severity==='error').map(f=>`${f.rule}: ${f.message}`).join('\n'));
    let skillContext='';
    if(hook.hook_event_name==='SessionStart'||hook.hook_event_name==='UserPromptSubmit') {
      try{skillContext=localSkillContext(root);}catch{warnings.push('Could not inspect local skill files; check paths and the sync receipt.');}
    }
    if(hook.hook_event_name==='SessionStart')return context('SessionStart',`Platform project ID: ${config.projectId}. Policy v${policy.version} (${policy.mode}). ${release?`Skill release ${release} refreshed; local overrides remain active.`:'Using existing project skills.'} ${skillContext} ${projectContext(root)} Test outcomes require actual execution evidence. ${warnings.join(' ')}`);
    if(hook.hook_event_name==='Stop'&&policy.stopReminder&&!hook.stop_hook_active) {
      // One continuation per host turn. No claim that a command exit is test evidence.
      const key=`stop:${hook.session_id}:${hook.turn_id??'session'}`;
      if(!outbox.get(key)) {outbox.set(key,true);return {decision:'block',reason:'Before finalizing, state the actual checks run, their results, and any unverified behavior. Do not claim a project governance pass or create test evidence without execution. If already covered, finish without repeating work.'};}
    }
    if(hook.hook_event_name==='SessionEnd')return warnings.length?{systemMessage:warnings.join(' ')}:{};
    const feedback=[...event.findings.map(f=>`${f.rule}: ${f.message}`),...warnings,skillContext].filter(Boolean).join('\n');
    return feedback?context(hook.hook_event_name,feedback):{};
  }finally{outbox.close();}
}
export async function hookMain() {
  let text='';
  try {
    for await(const chunk of process.stdin){text+=chunk;if(Buffer.byteLength(text)>250000)throw new Error('Hook input exceeds limit');}
    const raw=JSON.parse(text);
    process.stdout.write(`${JSON.stringify(await handleHook(raw))}\n`);
  }catch(error) {
    const message=`Lumora hook failed: ${error instanceof Error?error.message:'unknown error'}`;
    let event:string|undefined;try{event=JSON.parse(text)?.hook_event_name;}catch{}
    process.stdout.write(`${JSON.stringify(event==='PreToolUse'?denied(message):{systemMessage:message})}\n`);
    process.stderr.write(`${message}\n`);
  }
}
export function saveConnection(root:string,config:Connection) {
  const parsed=connectionSchema.parse(config);parsed.serverUrl=trustedUrl(parsed.serverUrl);
  if(parsed.lumora)parsed.lumora.url=trustedUrl(parsed.lumora.url);
  atomicWrite(safePath(root,'.lumora-agent/connection.json'),JSON.stringify(parsed,null,2));
}
