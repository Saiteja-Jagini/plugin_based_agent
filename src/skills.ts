import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { releaseSchema, type Release } from './contracts.ts';
import { atomicWrite, canonical, readJson, safePath, sha256 } from './util.ts';
import { validateRelease } from './store.ts';

export function makeRelease(directory:string,version='1.0.0'):Release {
  const skills=readdirSync(directory,{withFileTypes:true}).filter(e=>e.isDirectory()&&existsSync(join(directory,e.name,'SKILL.md'))).map(e=> {
    const content=readFileSync(join(directory,e.name,'SKILL.md'),'utf8');
    return {slug:e.name,version,hash:sha256(content),content};
  }).sort((a,b)=>a.slug.localeCompare(b.slug));
  return releaseSchema.parse({version,skills,hash:sha256(canonical(skills.map(({slug,version,hash})=>({slug,version,hash}))))});
}
const receiptSchema=z.object({hash:z.string(),version:z.string(),installedAt:z.string(),files:z.record(z.string(),z.string())});
export function syncSkills(root:string,input:unknown) {
  const release=releaseSchema.parse(input);validateRelease(release);
  const local=safePath(root,'.lumora-agent');mkdirSync(local,{recursive:true});
  const lock=safePath(root,'.lumora-agent/skill-sync.lock');
  let handle:number;
  try{handle=openSync(lock,'wx');}catch{throw new Error('Skill sync already running or interrupted; inspect the lock before retrying');}
  const changed:{path:string,old:string|null}[]=[];
  try {
    const receiptPath=safePath(root,'.lumora-agent/skills.json');
    const previous=existsSync(receiptPath)?receiptSchema.parse(readJson(receiptPath)):null;
    const next:Record<string,string>={};const writes:{path:string,content:string}[]=[];
    for(const skill of release.skills) {
      const name=/^(?:project-|lumora-)/.test(skill.slug)?skill.slug:`project-${skill.slug}`;
      const rel=`.agents/skills/${name}/SKILL.md`;
      if(next[rel])throw new Error('Skills map to the same managed directory');
      // Preserve the platform content exactly. The folder namespace does not rewrite instructions.
      if(!/^---\r?\n[\s\S]*?\bname:\s*[^\r\n]+[\s\S]*?\bdescription:\s*[^\r\n]+[\s\S]*?\r?\n---/.test(skill.content))throw new Error(`Invalid skill frontmatter: ${skill.slug}`);
      const path=safePath(root,rel);const current=existsSync(path)?readFileSync(path,'utf8'):null;
      if(current!==null && (!previous?.files[rel]||sha256(current)!==previous.files[rel]))throw new Error(`Unmanaged or modified skill preserved: ${rel}`);
      next[rel]=skill.hash;writes.push({path,content:skill.content});
    }
    const removals:string[]=[];
    for(const [rel,hash]of Object.entries(previous?.files??{})) {
      if(next[rel])continue;
      if(!/^\.agents\/skills\/(?:lumora-|project-)[a-z0-9-]+\/SKILL\.md$/.test(rel))throw new Error('Invalid managed skill receipt');
      const path=safePath(root,rel);
      if(existsSync(path)){if(sha256(readFileSync(path,'utf8'))!==hash)throw new Error(`Modified stale skill preserved: ${rel}`);removals.push(path);}
    }
    // Validate every entry before any edit. Roll back completed writes on ordinary I/O failures.
    for(const {path,content}of writes) {
      const old=existsSync(path)?readFileSync(path,'utf8'):null;
      if(old===content)continue;
      changed.push({path,old});atomicWrite(path,content);
    }
    for(const path of removals){changed.push({path,old:readFileSync(path,'utf8')});unlinkSync(path);}
    atomicWrite(receiptPath,JSON.stringify({hash:release.hash,version:release.version,installedAt:new Date().toISOString(),files:next},null,2));
    return {version:release.version,hash:release.hash,skills:release.skills.length,changed:changed.length};
  }catch(error) {
    for(const item of changed.reverse()){if(item.old===null){if(existsSync(item.path))unlinkSync(item.path);}else atomicWrite(item.path,item.old);}
    throw error;
  }finally{closeSync(handle!);unlinkSync(lock);}
}
