import { z } from 'zod';
import { canonical, HttpError, sha256, trustedUrl } from './util.ts';
import { releaseSchema, type Connection, type Event } from './contracts.ts';
import { redact } from './redact.ts';

// An explicit adapter: no global current session, no implicit tenant selection.
export class LumoraClient {
  config:NonNullable<Connection['lumora']>;
  env:NodeJS.ProcessEnv;
  constructor(config:NonNullable<Connection['lumora']>,env:NodeJS.ProcessEnv=process.env){this.config={...config,url:trustedUrl(config.url)};this.env=env;}
  async request(path:string,body:unknown) {
    const key=this.env[this.config.apiKeyEnv];if(!key)throw new Error(`Missing ${this.config.apiKeyEnv}`);
    const session=this.config.sessionTokenEnv?this.env[this.config.sessionTokenEnv]:undefined;
    if(this.config.sessionTokenEnv&&!session)throw new Error('Configured Lumora user session credential is missing');
    const headers:Record<string,string>={'Content-Type':'application/json',Authorization:`Bearer ${session??key}`};
    if(session)headers['X-Lumora-Api-Key']=key;
    const response=await fetch(`${this.config.url}${path}`,{method:'POST',headers,body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(2000)});
    if(!response.ok)throw new HttpError(response.status,`Lumora HTTP ${response.status}`);
    const text=await response.text();if(text.length>4_000_000)throw new Error('Lumora response exceeds limit');
    return JSON.parse(text);
  }
  async openSession(localId:string) {
    return z.object({id:z.string().min(1)}).parse(await this.request('/api/v1/mcp/sessions',{localId,intent:'Lumora governed Codex session',vibeSource:'CODEX'}));
  }
  async prompt(event:Event,serverSessionId?:string) {
    if(!event.prompt)throw new Error('Prompt content required');
    return this.request('/api/v1/mcp/prompts',{projectId:this.config.projectId,mcpSessionId:serverSessionId??null,role:'user',source:'CODEX',content:redact(event.prompt),clientLocalId:event.id});
  }
  async preTool(event:Event,serverSessionId?:string) {
    // Skill attribution is explicit; an installed skill is not proof it was invoked.
    if(!this.config.skillSlug)throw new Error('Lumora pre-tool checks need a configured integration skill slug');
    const result=await this.request('/api/v1/agents/pre-tool-use',{projectId:this.config.projectId,skillSlug:this.config.skillSlug,tool:event.tool??'unknown',command:event.command,paths:event.paths,sessionId:serverSessionId,runId:event.toolCallId??event.id});
    return z.object({allowed:z.boolean(),reason:z.string().nullable(),runId:z.string(),approvalId:z.string().nullable().optional()}).parse(result);
  }
  async skills() {
    const entry=z.object({slug:z.string(),version:z.string(),hash:z.string(),content:z.string()});
    const bundle=z.object({choreographies:z.array(entry),custom:z.array(entry).optional(),manifestHash:z.string()}).parse(await this.request('/api/v1/mcp/choreographies/sync',{projectId:this.config.projectId}));
    // Project-specific custom entries win by slug, matching the platform's effective scope.
    const entries=new Map([...bundle.choreographies,...(bundle.custom??[])].map(s=>[s.slug,s]));
    const skills=[...entries.values()].sort((a,b)=>a.slug.localeCompare(b.slug));
    return releaseSchema.parse({version:bundle.manifestHash.slice(0,64),skills,hash:sha256(canonical(skills.map(({slug,version,hash})=>({slug,version,hash}))))});
  }
}
