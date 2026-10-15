import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { releaseSchema, skillResolutionSchema, skillSyncFileSchema, type Release, type SkillResolution } from './contracts.ts';
import { atomicWrite, canonical, readJson, safePath, sha256 } from './util.ts';
import { validateRelease } from './store.ts';

export function makeRelease(directory:string,version='1.0.0'):Release {
  const skills=readdirSync(directory,{withFileTypes:true}).filter(e=>e.isDirectory()&&existsSync(join(directory,e.name,'SKILL.md'))).map(e=> {
    const content=readFileSync(join(directory,e.name,'SKILL.md'),'utf8');
    return {slug:e.name,version,hash:sha256(content),content};
  }).sort((a,b)=>a.slug.localeCompare(b.slug));
  return releaseSchema.parse({version,skills,hash:sha256(canonical(skills.map(({slug,version,hash})=>({slug,version,hash}))))});
}
const receiptSchema=z.object({hash:z.string(),version:z.string(),installedAt:z.string(),files:z.record(z.string(),z.string()),repositoryId:z.uuid().optional(),acceptedRemote:z.record(z.string(),z.string()).default({})});
export function skillRepositoryId(root:string) {
  const path=safePath(root,'.lumora-agent/skills.json');
  return existsSync(path)?receiptSchema.parse(readJson(path)).repositoryId:undefined;
}
const managedPath=/^\.agents\/skills\/(?:lumora-|project-)[a-z0-9-]+\/SKILL\.md$/;
export function localSkills(root:string) {
  const receiptPath=safePath(root,'.lumora-agent/skills.json');
  const receipt=existsSync(receiptPath)?receiptSchema.parse(readJson(receiptPath)):null;
  const directory=safePath(root,'.agents/skills');
  const paths=new Set(Object.keys(receipt?.files??{}));
  if(existsSync(directory))for(const entry of readdirSync(directory)) {
    const path=`.agents/skills/${entry}/SKILL.md`;
    if(/^(?:project-|lumora-)[a-z0-9-]+$/.test(entry)&&existsSync(safePath(root,path)))paths.add(path);
  }
  return [...paths].sort().map(path=>{
    if(!managedPath.test(path))throw new Error('Invalid managed skill receipt');
    const absolute=safePath(root,path),present=existsSync(absolute);
    const hash=present?sha256(readFileSync(absolute,'utf8')):null;
    return {path,absolute,hash,status:!present?'missing':!receipt?.files[path]?'local':hash===receipt.files[path]?'synced':'local override'};
  });
}
export function localSkillContext(root:string) {
  const files=localSkills(root).filter(file=>file.hash);
  if(!files.length)return '';
  return `Repository skill files (paths relative to ${JSON.stringify(root)}): ${files.map(file=>`${file.path} [${file.status}; sha256 ${file.hash}]`).join(', ')}. When using one of these skills, read its current local SKILL.md and apply it instead of the bundled copy. Local edits are repository-specific. Re-read the file when its hash changes; follow the user's task scope and higher-priority instructions.`;
}
export function syncSkills(root:string,input:unknown,resolutions:SkillResolution[]=[]) {
  const release=releaseSchema.parse(input);validateRelease(release);
  resolutions=z.array(skillResolutionSchema).max(200).parse(resolutions);
  const local=safePath(root,'.lumora-agent');mkdirSync(local,{recursive:true});
  const lock=safePath(root,'.lumora-agent/skill-sync.lock');
  let handle:number;
  try{handle=openSync(lock,'wx');}catch{throw new Error('Skill sync already running or interrupted; inspect the lock before retrying');}
  const changed:{path:string,old:string|null}[]=[];
  try {
    const receiptPath=safePath(root,'.lumora-agent/skills.json');
    const previous=existsSync(receiptPath)?receiptSchema.parse(readJson(receiptPath)):null;
    const repositoryId=previous?.repositoryId??randomUUID();
    const acceptedRemote:Record<string,string>={...previous?.acceptedRemote};
    const files:z.infer<typeof skillSyncFileSchema>[]=[];
    const backups:string[]=[];
    const next:Record<string,string>={};const writes:{path:string,content:string}[]=[];
    const seen=new Set<string>(),preserved:string[]=[];
    for(const skill of release.skills) {
      const name=/^(?:project-|lumora-)/.test(skill.slug)?skill.slug:`project-${skill.slug}`;
      const rel=`.agents/skills/${name}/SKILL.md`;
      if(seen.has(rel))throw new Error('Skills map to the same managed directory');
      seen.add(rel);
      // Preserve the platform content exactly. The folder namespace does not rewrite instructions.
      if(!/^---\r?\n[\s\S]*?\bname:\s*[^\r\n]+[\s\S]*?\bdescription:\s*[^\r\n]+[\s\S]*?\r?\n---/.test(skill.content))throw new Error(`Invalid skill frontmatter: ${skill.slug}`);
      const path=safePath(root,rel);const current=existsSync(path)?readFileSync(path,'utf8'):null;
      const localHash=current===null?null:sha256(current);
      if(current!==null && localHash!==skill.hash && (!previous?.files[rel]||localHash!==previous.files[rel])) {
        const decision=resolutions.find(r=>r.path===rel&&r.localHash===localHash&&r.remoteHash===skill.hash);
        if(decision?.choice==='published') {
          const backup=`.lumora-agent/skill-backups/${randomUUID()}/${name}/SKILL.md`;
          atomicWrite(safePath(root,backup),current);backups.push(backup);
        }else {
          if(decision?.choice==='local')acceptedRemote[rel]=skill.hash;
          const conflict=skill.hash!==previous?.files[rel]&&acceptedRemote[rel]!==skill.hash;
          preserved.push(rel);
          // Keep the baseline until the user explicitly accepts the published file.
          if(previous?.files[rel])next[rel]=previous.files[rel];
          files.push({path:rel,localHash,remoteHash:skill.hash,status:conflict?'conflict':'local'});
          continue;
        }
      }
      delete acceptedRemote[rel];
      next[rel]=skill.hash;writes.push({path,content:skill.content});
      files.push({path:rel,localHash:skill.hash,remoteHash:skill.hash,status:'synced'});
    }
    const removals:string[]=[];
    for(const [rel,hash]of Object.entries(previous?.files??{})) {
      if(seen.has(rel))continue;
      if(!managedPath.test(rel))throw new Error('Invalid managed skill receipt');
      const path=safePath(root,rel);
      if(existsSync(path)){const localHash=sha256(readFileSync(path,'utf8'));if(localHash!==hash){preserved.push(rel);next[rel]=hash;files.push({path:rel,localHash,remoteHash:null,status:'local'});}else removals.push(path);}
      if(!next[rel])delete acceptedRemote[rel];
    }
    // Validate every entry before any edit. Roll back completed writes on ordinary I/O failures.
    for(const {path,content}of writes) {
      const old=existsSync(path)?readFileSync(path,'utf8'):null;
      if(old===content)continue;
      changed.push({path,old});atomicWrite(path,content);
    }
    for(const path of removals){changed.push({path,old:readFileSync(path,'utf8')});unlinkSync(path);}
    atomicWrite(receiptPath,JSON.stringify({hash:release.hash,version:release.version,installedAt:new Date().toISOString(),files:next,repositoryId,acceptedRemote},null,2));
    return {version:release.version,hash:release.hash,repositoryId,skills:release.skills.length,changed:changed.length,preserved,files,backups,conflicts:files.filter(f=>f.status==='conflict')};
  }catch(error) {
    for(const item of changed.reverse()){if(item.old===null){if(existsSync(item.path))unlinkSync(item.path);}else atomicWrite(item.path,item.old);}
    throw error;
  }finally{closeSync(handle!);unlinkSync(lock);}
}
