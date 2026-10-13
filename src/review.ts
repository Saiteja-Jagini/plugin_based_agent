import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { reviewSource } from './policy.ts';
import { safePath } from './util.ts';
import { defaultPolicy, type Finding, type Policy } from './contracts.ts';
import { inspectProject } from './project.ts';

export function reviewRepository(directory:string, policy:Policy=defaultPolicy) {
  const root=resolve(directory);const findings:Finding[]=[];const skipped:string[]=[];
  let files:string[];
  const gitArgs=['-c',`safe.directory=${root.replaceAll('\\','/')}`];
  try {files=execFileSync('git',[...gitArgs,'ls-files','-co','--exclude-standard','-z'],{cwd:root,encoding:'utf8',maxBuffer:4_000_000}).split('\0').filter(Boolean);}
  catch{throw new Error('Repository review requires an existing Git working tree');}
  files=[...new Set(files)];let inspected=0;
  for(const file of files) {
    if(!/\.(?:ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|kt|cs|rb|php|vue|svelte|sql|ya?ml|json|toml)$/.test(file)||/(?:^|\/)(?:node_modules|dist|build|\.next|\.angular|\.lumora-agent|\.venv|venv|vendor|target)\//.test(file))continue;
    try {
      const path=safePath(root,file);if(!existsSync(path))continue;
      if(statSync(path).size>300000){skipped.push(file);continue;}
      const text=readFileSync(path,'utf8');inspected++;
      findings.push(...reviewSource(file,text,policy));
    }catch{skipped.push(file);}
  }
  const playwright=files.filter(f=>/playwright|global-setup/.test(f)&&/\.[cm]?[jt]s$/.test(f));
  for(const file of playwright) {
    try{const text=readFileSync(safePath(root,file),'utf8');if(/db:reset|DROP DATABASE/i.test(text))findings.push({rule:'destructive-test-setup',severity:'error',path:file,message:'Test setup can reset a database. Require an isolated test database before execution.'});}catch{}
  }
  let changed:string[]=[];
  try{changed=execFileSync('git',[...gitArgs,'diff','--name-only','HEAD'],{cwd:root,encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean);}catch{skipped.push('Git HEAD comparison unavailable');}
  return {repository:root,profile:inspectProject(root),policyVersion:policy.version,configuredSourceRules:policy.sourceRules.length,createdAt:new Date().toISOString(),inspected,skipped,findings,checksExecuted:[],classification:'Static review candidates; no runtime test verdict or exhaustive flaw detection',changedFiles:changed};
}
