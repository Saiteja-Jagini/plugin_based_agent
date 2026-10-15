import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { canonical, HttpError, sha256 } from './util.ts';
import { defaultPolicy, eventSchema, policySchema, principalSchema, releaseSchema, skillEditSchema, skillResolutionSchema, skillSyncReportSchema, slug, type SkillResolution, type Event, type Principal, type Release } from './contracts.ts';
import { redactEvent } from './redact.ts';

export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path),{recursive:true});
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    this.db.exec(readFileSync(new URL('../migrations/001_initial.sql',import.meta.url),'utf8'));
    this.db.prepare('INSERT OR IGNORE INTO schema_migrations VALUES(1,?)').run(new Date().toISOString());
    this.db.exec(readFileSync(new URL('../migrations/002_skill_sync.sql',import.meta.url),'utf8'));
    this.db.prepare('INSERT OR IGNORE INTO schema_migrations VALUES(2,?)').run(new Date().toISOString());
  }
  close() {this.db.close();}
  transaction<T>(fn:()=>T):T {
    this.db.exec('BEGIN IMMEDIATE');
    try {const value=fn(); this.db.exec('COMMIT'); return value;} catch(e) {this.db.exec('ROLLBACK');throw e;}
  }
  bootstrap(projectId:string,name:string,userId:string) {
    if (this.db.prepare('SELECT id FROM projects WHERE id=?').get(projectId)) throw new HttpError(409,'Project already initialized; use an admin token to provision users');
    return this.transaction(()=> {
      this.db.prepare('INSERT INTO projects VALUES(?,?,?)').run(projectId,name,JSON.stringify(defaultPolicy));
      return this.issue(projectId,{userId,name:'Project administrator',role:'admin'});
    });
  }
  issue(projectId:string,input:{userId:string,name:string,role:Principal['role']}) {
    const principal=principalSchema.parse({id:randomUUID(),projectId,...input});
    const token=`lag_${randomBytes(32).toString('base64url')}`;
    this.db.prepare('INSERT INTO principals(id,project_id,user_id,name,role,token_hash,created_at) VALUES(?,?,?,?,?,?,?)').run(principal.id,projectId,principal.userId,principal.name,principal.role,sha256(token),new Date().toISOString());
    this.audit(projectId,{action:'principal.issued',id:principal.id,userId:principal.userId,role:principal.role});
    return {principal,token};
  }
  auth(token:string):Principal {
    const row=this.db.prepare('SELECT id,project_id AS projectId,user_id AS userId,name,role FROM principals WHERE token_hash=? AND revoked=0').get(sha256(token));
    if (!row) throw new HttpError(401,'Invalid or revoked credential');
    return principalSchema.parse(row);
  }
  require(principal:Principal,projectId:string,roles:Principal['role'][]=['admin','observer','agent']) {
    if (principal.projectId!==projectId || !roles.includes(principal.role)) throw new HttpError(403,'This credential does not permit that operation');
  }
  principals(p:Principal) {
    this.require(p,p.projectId,['admin']);
    return this.db.prepare('SELECT id,user_id AS userId,name,role,revoked,created_at AS createdAt FROM principals WHERE project_id=? ORDER BY created_at').all(p.projectId);
  }
  revoke(p:Principal,id:string) {
    this.require(p,p.projectId,['admin']);
    if(p.id===id) throw new HttpError(409,'Create and verify another administrator before revoking this credential');
    return this.transaction(()=> {
      const result=this.db.prepare('UPDATE principals SET revoked=1 WHERE id=? AND project_id=?').run(id,p.projectId);
      if(!result.changes) throw new HttpError(404,'Credential not found');
      this.audit(p.projectId,{action:'principal.revoked',id,actor:p.userId});
    });
  }
  audit(projectId:string,value:unknown) {
    const payload=canonical(value);
    const previous=String(this.db.prepare('SELECT hash FROM audit WHERE project_id=? ORDER BY seq DESC LIMIT 1').get(projectId)?.hash ?? 'GENESIS');
    this.db.prepare('INSERT INTO audit(project_id,payload,previous_hash,hash) VALUES(?,?,?,?)').run(projectId,payload,previous,sha256(`${previous}\n${payload}`));
  }
  integrity(projectId:string) {
    let previous='GENESIS',count=0;
    for(const row of this.db.prepare('SELECT * FROM audit WHERE project_id=? ORDER BY seq').iterate(projectId)) {
      if(row.previous_hash!==previous||row.hash!==sha256(`${previous}\n${row.payload}`)) return {valid:false,checked:count,failedAt:row.seq};
      previous=String(row.hash);count++;
    }
    return {valid:true,checked:count,head:previous};
  }
  ingest(p:Principal,raw:unknown) {
    this.require(p,p.projectId,['admin','agent']);
    const event=redactEvent(eventSchema.parse(raw));
    const payload=canonical(event);
    return this.transaction(()=> {
      const existing=this.db.prepare('SELECT payload,user_id FROM events WHERE project_id=? AND id=?').get(p.projectId,event.id);
      if(existing) {
        if(existing.payload!==payload||existing.user_id!==p.userId) throw new HttpError(409,'Event ID already used for different content or user');
        return {created:false,id:event.id};
      }
      const session=this.db.prepare('SELECT user_id FROM sessions WHERE project_id=? AND id=?').get(p.projectId,event.sessionId);
      if(session && session.user_id!==p.userId) throw new HttpError(403,'Session belongs to another user');
      const now=new Date().toISOString();
      this.db.prepare('INSERT INTO sessions(project_id,id,user_id,started_at,last_seen,ended_at) VALUES(?,?,?,?,?,?) ON CONFLICT(project_id,id) DO UPDATE SET last_seen=excluded.last_seen, ended_at=COALESCE(excluded.ended_at,sessions.ended_at)').run(p.projectId,event.sessionId,p.userId,now,now,event.kind==='SessionEnd'?now:null);
      this.db.prepare('INSERT INTO events(project_id,id,session_id,user_id,kind,occurred_at,payload) VALUES(?,?,?,?,?,?,?)').run(p.projectId,event.id,event.sessionId,p.userId,event.kind,event.occurredAt,payload);
      this.audit(p.projectId,{action:'event.ingested',userId:p.userId,event});
      return {created:true,id:event.id};
    });
  }
  listEvents(p:Principal,params:URLSearchParams) {
    const conditions=['project_id=?']; const args:(string|number)[]=[p.projectId];
    if(p.role==='agent') {conditions.push('user_id=?');args.push(p.userId);}
    for(const [param,column] of [['session','session_id'],['kind','kind'],['user','user_id']] as const) {
      const value=params.get(param); if(value) {conditions.push(`${column}=?`);args.push(value);}
    }
    const q=params.get('q')?.slice(0,200); if(q) {conditions.push("payload LIKE ? ESCAPE '\\'");args.push(`%${q.replace(/[\\%_]/g,'\\$&')}%`);}
    const before=Number(params.get('before'));if(Number.isSafeInteger(before)&&before>0){conditions.push('seq<?');args.push(before);}
    const limit=Math.min(200,Math.max(1,Number(params.get('limit'))||50));
    const rows=this.db.prepare(`SELECT seq,user_id AS userId,payload FROM events WHERE ${conditions.join(' AND ')} ORDER BY seq DESC LIMIT ?`).all(...args,limit);
    return {items:rows.map(row=>({seq:row.seq,userId:row.userId,...JSON.parse(String(row.payload))})),nextCursor:rows.length===limit?rows.at(-1)!.seq:null};
  }
  sessions(p:Principal) {
    return this.db.prepare(`SELECT id,user_id AS userId,started_at AS startedAt,last_seen AS lastSeen,ended_at AS endedAt FROM sessions WHERE project_id=? ${p.role==='agent'?'AND user_id=?':''} ORDER BY last_seen DESC LIMIT 200`).all(...(p.role==='agent'?[p.projectId,p.userId]:[p.projectId]));
  }
  summary(p:Principal) {
    const where=`project_id=? ${p.role==='agent'?'AND user_id=?':''}`,args=p.role==='agent'?[p.projectId,p.userId]:[p.projectId];
    const counts=this.db.prepare(`SELECT count(*) AS events,count(DISTINCT session_id) AS sessions,count(DISTINCT user_id) AS users, sum(kind='UserPromptSubmit') AS prompts, sum(json_extract(payload,'$.status')='denied') AS denied FROM events WHERE ${where}`).get(...args);
    return {...counts,project:this.db.prepare('SELECT id,name FROM projects WHERE id=?').get(p.projectId),principal:p,policy:this.policy(p.projectId)};
  }
  policy(projectId:string) {return policySchema.parse(JSON.parse(String(this.db.prepare('SELECT policy FROM projects WHERE id=?').get(projectId)?.policy)));}
  setPolicy(p:Principal,input:unknown) {
    this.require(p,p.projectId,['admin']);const policy=policySchema.parse(input);
    return this.transaction(()=> {
      if(policy.version!==this.policy(p.projectId).version+1) throw new HttpError(409,'Policy version must increase by one; refresh and retry');
      this.db.prepare('UPDATE projects SET policy=? WHERE id=?').run(JSON.stringify(policy),p.projectId);
      this.audit(p.projectId,{action:'policy.updated',actor:p.userId,policy});return policy;
    });
  }
  publish(p:Principal,input:unknown) {
    this.require(p,p.projectId,['admin']);const release=releaseSchema.parse(input);validateRelease(release);
    return this.transaction(()=>this.writeRelease(p,release));
  }
  private writeRelease(p:Principal,release:Release) {
      const existing=this.db.prepare('SELECT payload FROM releases WHERE project_id=? AND version=?').get(p.projectId,release.version);
      if(existing && existing.payload!==canonical(release)) throw new HttpError(409,'Release versions are immutable');
      this.db.prepare('INSERT OR IGNORE INTO releases VALUES(?,?,?,?)').run(p.projectId,release.version,canonical(release),new Date().toISOString());
      this.db.prepare('INSERT INTO active_releases VALUES(?,?) ON CONFLICT(project_id) DO UPDATE SET version=excluded.version').run(p.projectId,release.version);
      this.audit(p.projectId,{action:'skills.activated',actor:p.userId,version:release.version,hash:release.hash});return release;
  }
  editSkill(p:Principal,name:string,input:unknown) {
    this.require(p,p.projectId,['admin']);name=slug.parse(name);
    const edit=skillEditSchema.parse(input);
    const front=/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]+)$/.exec(edit.content);
    const declared=front?.[1].match(/^name:\s*["']?([a-z0-9-]+)["']?\s*$/m)?.[1];
    const description=front?.[1].match(/^description:[ \t]*([^\r\n]+)$/m)?.[1].trim();
    if(declared!==name||!description||/^(?:"\s*"|'\s*')$/.test(description)||!front?.[2].trim())throw new HttpError(400,'Provide YAML frontmatter with the matching name and a description, followed by instructions.');
    return this.transaction(()=>{
      const previous=this.release(p.projectId);
      if((previous?.hash??null)!==edit.expectedReleaseHash)throw new HttpError(409,'Skills changed since this editor opened. Copy your draft, refresh, and reopen the editor.');
      const existing=previous?.skills.find(s=>s.slug===name);
      if(edit.create&&existing)throw new HttpError(409,'A skill with this name already exists.');
      if(!edit.create&&!existing)throw new HttpError(404,'Skill no longer exists. Refresh the list.');
      const version=`web-${randomUUID()}`;
      const skills=[...(previous?.skills??[]).filter(s=>s.slug!==name),{slug:name,version,content:edit.content,hash:sha256(edit.content)}].sort((a,b)=>a.slug.localeCompare(b.slug));
      const release=releaseSchema.parse({version,skills,hash:sha256(canonical(skills.map(({slug,version,hash})=>({slug,version,hash}))))});
      validateRelease(release);
      return this.writeRelease(p,release);
    });
  }
  reportSkills(p:Principal,input:unknown) {
    this.require(p,p.projectId,['admin','agent']);const report=skillSyncReportSchema.parse(input);
    if(new Set(report.files.map(f=>f.path)).size!==report.files.length)throw new HttpError(400,'Duplicate sync path');
    return this.transaction(()=>{
      const old=this.db.prepare('SELECT id,resolutions FROM skill_syncs WHERE project_id=? AND principal_id=? AND repository_id=?').get(p.projectId,p.id,report.repositoryId);
      const resolutions:SkillResolution[]=old?JSON.parse(String(old.resolutions)):[];
      const pending=resolutions.filter(r=>report.files.some(f=>f.status==='conflict'&&f.path===r.path&&f.localHash===r.localHash&&f.remoteHash===r.remoteHash));
      const reportId=old?String(old.id):randomUUID();
      this.db.prepare('INSERT INTO skill_syncs VALUES(?,?,?,?,?,?,?) ON CONFLICT(project_id,principal_id,repository_id) DO UPDATE SET payload=excluded.payload,resolutions=excluded.resolutions,updated_at=excluded.updated_at').run(reportId,p.projectId,p.id,report.repositoryId,canonical(report),canonical(pending),new Date().toISOString());
      return {id:reportId};
    });
  }
  skillReports(p:Principal) {
    return this.db.prepare(`SELECT s.id,s.payload,s.resolutions,s.updated_at,p.user_id FROM skill_syncs s JOIN principals p ON s.principal_id=p.id WHERE s.project_id=? ${p.role==='agent'?'AND s.principal_id=?':''} ORDER BY s.updated_at DESC LIMIT 200`).all(...(p.role==='agent'?[p.projectId,p.id]:[p.projectId])).map(row=>({id:row.id,...JSON.parse(String(row.payload)),resolutions:JSON.parse(String(row.resolutions)),updatedAt:row.updated_at,userId:row.user_id}));
  }
  skillResolutions(p:Principal,repositoryId:string):SkillResolution[] {
    const row=this.db.prepare('SELECT resolutions FROM skill_syncs WHERE project_id=? AND principal_id=? AND repository_id=?').get(p.projectId,p.id,repositoryId);
    return row?JSON.parse(String(row.resolutions)):[];
  }
  resolveSkill(p:Principal,reportId:string,input:unknown) {
    this.require(p,p.projectId,['admin']);const decision=skillResolutionSchema.parse(input);
    return this.transaction(()=>{
      const row=this.db.prepare('SELECT payload,resolutions FROM skill_syncs WHERE id=? AND project_id=?').get(reportId,p.projectId);
      if(!row)throw new HttpError(404,'Repository sync report not found');
      const report=skillSyncReportSchema.parse(JSON.parse(String(row.payload)));
      if(!report.files.some(f=>f.status==='conflict'&&f.path===decision.path&&f.localHash===decision.localHash&&f.remoteHash===decision.remoteHash))throw new HttpError(409,'Conflict changed; refresh before choosing a version.');
      const published=this.release(p.projectId)?.skills.find(s=>`.agents/skills/${/^(project-|lumora-)/.test(s.slug)?s.slug:`project-${s.slug}`}/SKILL.md`===decision.path);
      if(published?.hash!==decision.remoteHash)throw new HttpError(409,'Published skill changed. Sync the repository and refresh the conflict.');
      const resolutions:SkillResolution[]=JSON.parse(String(row.resolutions));
      this.db.prepare('UPDATE skill_syncs SET resolutions=? WHERE id=?').run(canonical([...resolutions.filter(r=>r.path!==decision.path),decision]),reportId);
      this.audit(p.projectId,{action:'skill.conflict-resolved',actor:p.userId,reportId,...decision});
      return {pending:true};
    });
  }
  release(projectId:string) {
    const row=this.db.prepare('SELECT r.payload FROM releases r JOIN active_releases a ON r.project_id=a.project_id AND r.version=a.version WHERE r.project_id=?').get(projectId);
    return row?releaseSchema.parse(JSON.parse(String(row.payload))):null;
  }
}
export function validateRelease(release:Release) {
  if(new Set(release.skills.map(s=>s.slug)).size!==release.skills.length) throw new HttpError(400,'Duplicate skill slug');
  if(new Set(release.skills.map(s=>/^(project-|lumora-)/.test(s.slug)?s.slug:`project-${s.slug}`)).size!==release.skills.length)throw new HttpError(400,'Skills map to the same repository path');
  for(const skill of release.skills) if(sha256(skill.content)!==skill.hash) throw new HttpError(400,`Skill hash mismatch: ${skill.slug}`);
  if(sha256(canonical(release.skills.map(({slug,version,hash})=>({slug,version,hash}))))!==release.hash) throw new HttpError(400,'Release hash mismatch');
}
