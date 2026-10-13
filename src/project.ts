import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { safePath } from './util.ts';

const ignored=new Set(['.git','.lumora-agent','.codex','.agents','node_modules','dist','build','coverage','.next','.angular','.venv','venv','vendor','target','__pycache__']);

/** Bounded, read-only hints. Never execute package scripts or treat detection as policy. */
export function inspectProject(directory:string) {
  const root=resolve(directory);
  if(!statSync(root).isDirectory())throw new Error('Project root must be a directory');
  const manifests:string[]=[],instructionFiles:string[]=[],warnings:string[]=[];
  const languages=new Set<string>(),frameworks=new Set<string>();
  const testScripts:{directory:string,script:string,runner:string}[]=[];
  const pending:{relative:string,depth:number}[]=[{relative:'',depth:0}];
  let visited=0;
  const warn=(message:string)=>{if(warnings.length<20)warnings.push(message);};
  function walk(relative:string,depth:number) {
    visited++;
    let entries;
    try{entries=readdirSync(safePath(root,relative||'.'),{withFileTypes:true});}catch{warn(`Could not inspect ${relative||'.'}`);return;}
    for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))) {
      if(entry.isSymbolicLink())continue;
      const file=relative?`${relative}/${entry.name}`:entry.name;
      if(entry.isDirectory()) {
        if(ignored.has(entry.name)||entry.name.startsWith('.'))continue;
        // Independent nested repositories must be connected separately.
        if(existsSync(join(root,file,'.git')))continue;
        if(depth<4)pending.push({relative:file,depth:depth+1});else warn(`Depth limit: ${file}`);
        continue;
      }
      if(!entry.isFile())continue;
      if(entry.name==='AGENTS.md')instructionFiles.push(file);
      const kind=entry.name;
      if(!['package.json','pyproject.toml','requirements.txt','Cargo.toml','go.mod','pom.xml','build.gradle','build.gradle.kts','Gemfile','composer.json'].includes(kind)&&!kind.endsWith('.csproj'))continue;
      manifests.push(file);
      if(kind==='package.json') {
        try {
          const path=safePath(root,file);if(statSync(path).size>300000)throw new Error('manifest too large');
          const pkg=JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,''));
          const deps={...pkg.dependencies,...pkg.devDependencies};languages.add('JavaScript');
          if(deps.typescript)languages.add('TypeScript');
          for(const [dependency,label] of Object.entries({'@angular/core':'Angular',next:'Next.js',react:'React',vue:'Vue',express:'Express',vitest:'Vitest',jest:'Jest','@playwright/test':'Playwright'}))if(deps[dependency])frameworks.add(label);
          const base=join(root,relative);
          const runner=existsSync(join(base,'pnpm-lock.yaml'))?'pnpm':existsSync(join(base,'yarn.lock'))?'yarn':existsSync(join(base,'bun.lock'))||existsSync(join(base,'bun.lockb'))?'bun':'npm';
          for(const script of Object.keys(pkg.scripts??{}))if(/^(?:test|lint|typecheck|check|build)(?::[\w-]+)?$/.test(script))testScripts.push({directory:relative||'.',script,runner});
        }catch{warn(`Unreadable manifest: ${file}`);}
      }else if(['pyproject.toml','requirements.txt'].includes(kind))languages.add('Python');
      else if(kind==='Cargo.toml')languages.add('Rust');
      else if(kind==='go.mod')languages.add('Go');
      else if(kind==='Gemfile')languages.add('Ruby');
      else if(kind==='composer.json')languages.add('PHP');
      else if(kind.endsWith('.csproj'))languages.add('C#');
      else languages.add('JVM');
    }
  }
  // Breadth first: a large early subtree must not hide sibling package manifests.
  while(pending.length&&visited<200){const next=pending.shift()!;walk(next.relative,next.depth);}
  if(pending.length)warn('Directory limit reached');
  return {root,name:basename(root),languages:[...languages].sort(),frameworks:[...frameworks].sort(),manifests,instructionFiles,testScripts,warnings,
    scope:'Bounded manifest hints, not exhaustive language detection or execution evidence'};
}

export function projectContext(root:string) {
  const p=inspectProject(root);
  // Paths are JSON quoted data, not instructions supplied by manifest authors.
  return `Connected repository: ${JSON.stringify(p.root)}. Detected stack: ${[...p.languages,...p.frameworks].join(', ')||'unknown; inspect the repository'}. Instruction file candidates: ${JSON.stringify(p.instructionFiles.slice(0,30))}. Read applicable AGENTS.md, repository documentation and existing tests before editing. Follow nested instruction scope. Detection never authorizes executing a script. Do not assume this repository is the Lumora platform codebase. Inspection limits: ${JSON.stringify(p.warnings.slice(0,5))}.`;
}
