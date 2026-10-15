import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { events } from './contracts.ts';
import { atomicWrite, readJson, safePath } from './util.ts';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const marker='lumora-governance';
const version='0.4.0';
export function hookConfig(command:string,commandWindows:string) {
  return {description:'Governance for connected local projects',hooks:Object.fromEntries(events.map(event=>[event,[{hooks:[{type:'command',command,commandWindows,timeout:event==='SessionEnd'?3:12,statusMessage:'Connected project governance'}]}]]))};
}
export async function compileRuntime(dest:string) {
  mkdirSync(join(dest,'src'),{recursive:true});
  const files=readdirSync(join(root,'src'));
  if(files.some(file=>file.endsWith('.ts'))) {
    const ts=await import('typescript');
    for(const file of files.filter(f=>f.endsWith('.ts'))) {
      const compiled=ts.transpileModule(readFileSync(join(root,'src',file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext}}).outputText.replace(/(from\s+['"]\.[^'"]+)\.ts(['"])/g,'$1.js$2');
      atomicWrite(join(dest,'src',file.replace(/\.ts$/,'.js')),compiled);
    }
  }else for(const file of files.filter(f=>f.endsWith('.js')))cpSync(join(root,'src',file),join(dest,'src',file));
  for(const folder of ['migrations','skills','web'])cpSync(join(root,folder),join(dest,folder),{recursive:true});
  atomicWrite(join(dest,'package.json'),JSON.stringify({type:'module'}));
}
export async function buildNpm() {
  const dest=safePath(root,'dist/npm');
  // This exact generated output is owned by the build; avoid stale skills on upgrades.
  if(existsSync(dest))rmSync(dest,{recursive:true});
  await compileRuntime(dest);
  atomicWrite(join(dest,'bin','lumora-agent.mjs'),"#!/usr/bin/env node\nimport {main} from '../src/cli.js';\nmain().catch(e=>{process.stderr.write(`${e.message}\\n`);process.exitCode=1;});\n");
  return {path:dest};
}
export async function packagePlugin(output:string) {
  const dest=resolve(output);
  if(existsSync(dest))throw new Error('Package destination already exists; choose a new versioned directory');
  if(dest===root)throw new Error('Package destination must differ from source');
  await compileRuntime(join(dest,'runtime'));
  cpSync(join(root,'skills'),join(dest,'skills'),{recursive:true});
  cpSync(dirname(fileURLToPath(import.meta.resolve('zod/package.json'))),join(dest,'runtime','node_modules','zod'),{recursive:true});
  atomicWrite(join(dest,'runtime','package.json'),JSON.stringify({type:'module'}));
  atomicWrite(join(dest,'runtime','hook.mjs'),"import {hookMain} from './src/hook.js';\nawait hookMain();\n");
  atomicWrite(join(dest,'plugin.json'),JSON.stringify({$schema:'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',name:marker,version,description:'Governance, prompt logs and testing skills for any connected local project; managed through Lumora',extensions:{'com.openai':{hooks:'./hooks/hooks.json'}}},null,2));
  // Compatibility overlay for existing Codex plugin loaders; newer loaders use root manifest.
  atomicWrite(join(dest,'.codex-plugin','plugin.json'),JSON.stringify({name:marker,version,description:'Project governance for any connected local repository',hooks:'./hooks/hooks.json'},null,2));
  const launch=`node -e "import(require('node:url').pathToFileURL(require('node:path').join(process.env.PLUGIN_ROOT,'runtime','hook.mjs')).href)"`;
  atomicWrite(join(dest,'hooks','hooks.json'),JSON.stringify(hookConfig(launch,launch),null,2));
  atomicWrite(join(dest,'README.md'),'# Project governance plugin\n\nWorks with any connected local repository. Lumora is the management platform, not the target project. Requires Node 24+, a per-project connection and its configured token environment variable in the Codex process. Use the local marketplace to install, review /hooks, and trust the definitions. Do not also install the project hook adapter. Skills use each repository\'s own instructions, stack and test runners.\n');
  return {path:dest,version,events:[...events]};
}
type Settings={hooks?:Record<string,Array<{hooks:Array<{command:string,[key:string]:unknown}>,[key:string]:unknown}>>,[key:string]:unknown};
function settingsAt(path:string):Settings {
  if(!existsSync(path))return {};
  const value=readJson(path);
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Existing hooks config is invalid; it was preserved');
  const settings=value as Settings;
  if(settings.hooks)for(const groups of Object.values(settings.hooks)) {
    if(!Array.isArray(groups)||groups.some(g=>!g||!Array.isArray(g.hooks)))throw new Error('Existing hook groups are invalid; config preserved');
  }
  return settings;
}
export function installHooks(project:string,pluginPath:string) {
  const hookFile=safePath(project,'.codex/hooks.json'),runtime=resolve(pluginPath,'runtime','hook.mjs');
  if(!existsSync(runtime))throw new Error('Package runtime missing; package the plugin first');
  // Hook strings are shell code. Reject unusual path metacharacters instead of interpolating them.
  if(/["'`$%\r\n!]/.test(runtime))throw new Error('Runtime path contains shell metacharacters');
  const settings=settingsAt(hookFile);const original=JSON.stringify(settings,null,2);
  settings.hooks??={};
  const command=`node "${runtime}" --${marker}`;
  for(const event of events) {
    const groups=settings.hooks[event]??[];
    settings.hooks[event]=groups.map(g=>({...g,hooks:g.hooks.filter(h=>!h.command?.endsWith(` --${marker}`))})).filter(g=>g.hooks.length);
    settings.hooks[event].push({hooks:[{type:'command',command,commandWindows:command,timeout:event==='SessionEnd'?3:12}]});
  }
  const backup=safePath(project,'.lumora-agent/hooks.before.json');if(!existsSync(backup))atomicWrite(backup,original);
  atomicWrite(hookFile,JSON.stringify(settings,null,2));
  return {path:hookFile,warning:original.includes('lumora-prompt-hook')?'Existing Lumora prompt capture detected: disable one capture path before use to avoid duplicate prompts.':null};
}
export function uninstallHooks(project:string) {
  const path=safePath(project,'.codex/hooks.json'),settings=settingsAt(path);
  for(const [event,groups]of Object.entries(settings.hooks??{})) {
    const kept=groups.map(g=>({...g,hooks:g.hooks.filter(h=>!h.command?.endsWith(` --${marker}`))})).filter(g=>g.hooks.length);
    if(kept.length)settings.hooks![event]=kept;else delete settings.hooks![event];
  }
  atomicWrite(path,JSON.stringify(settings,null,2));return {path,removed:true};
}
