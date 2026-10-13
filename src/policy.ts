import { relative, resolve } from 'node:path';
import { defaultPolicy, type Finding, type Hook, type Policy } from './contracts.ts';
import { inside } from './util.ts';

export function toolInput(hook: Hook) {
  const input = hook.tool_input;
  const record = input && typeof input === 'object' ? input as Record<string,unknown> : {};
  const command = typeof input === 'string' ? input : String(record.command ?? record.cmd ?? record.patch ?? record.input ?? record.content ?? record.new_string ?? '');
  const paths: string[] = [];
  for (const key of ['file_path','path']) if (typeof record[key] === 'string') paths.push(record[key]);
  if (/apply_patch|Edit|Write/i.test(hook.tool_name ?? '')) {
    for (const match of command.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)) paths.push(match[1].trim());
  }
  return {command, paths: [...new Set(paths)].slice(0,200)};
}
export function reviewSource(path: string, source: string, policy: Policy = defaultPolicy): Finding[] {
  const p = path.replaceAll('\\','/');
  const result: Finding[] = [];
  const lines = source.split('\n');
  if (!policy.reviewArchitecture) return result;
  lines.forEach((line,i)=> {
    for (const rule of policy.sourceRules) {
      if (p.startsWith(rule.pathPrefix) && !rule.allowedPathPrefixes.some(prefix=>p.startsWith(prefix)) && line.includes(rule.forbiddenText)) {
        result.push({rule:rule.id,severity:'warning',message:rule.message,path:p,line:i+1});
      }
    }
  });
  return result;
}
export function evaluate(hook: Hook, root: string, policy: Policy = defaultPolicy) {
  const {command, paths} = toolInput(hook);
  const findings: Finding[] = [];
  const error = (rule:string,message:string,path?:string) => findings.push({rule,severity:'error',message,...(path?{path}:{})});
  if (policy.blockDatabaseReset && /\b(?:db:reset|drop\s+(?:database|schema)|truncate\s+(?:table\s+)?)/i.test(command)) error('database-reset','Database reset requires a disposable test environment and an explicit reviewed workflow.');
  if (policy.blockDatabasePush && /\b(?:db:push|drizzle-kit\s+push)\b/i.test(command)) error('versioned-migrations','Use committed migrations. The pilot policy blocks db:push; configure a disposable-development exception through policy administration.');
  for (const path of paths) {
    const absolute = resolve(hook.cwd, path);
    const rel = relative(root, absolute).replaceAll('\\','/');
    if (!inside(root, absolute)) error('project-boundary','Requested edit is outside the connected project.',path);
    if (policy.protectGovernanceFiles && /(?:^|\/)(?:AGENTS\.md|\.codex(?:\/|$)|\.lumora-agent(?:\/|$)|\.agents\/skills\/(?:lumora-|project-))/i.test(rel)) error('governance-integrity','Change governance configuration through the reviewed administrator workflow.',path);
    if (/(?:^|\/)(?:\.env(?:\.[^/]+)?|id_rsa|id_ed25519)$/.test(rel) && !/\.env\.(?:example|sample)$/.test(rel)) error('secret-file','Do not edit secret files through a coding-agent tool.',path);
  }
  if (policy.reviewArchitecture && paths.length && /apply_patch|Edit|Write/i.test(hook.tool_name ?? '')) {
    // Findings remain advisory: patches contain partial context, not complete ASTs.
    const sections=new Map<string,string[]>();let current:string|undefined;
    for(const line of command.split('\n')) {
      const header=/^\*\*\* (?:Add File|Update File|Delete File): (.+)$/.exec(line);
      if(header){current=header[1].trim();sections.set(current,[]);continue;}
      if(current&&line.startsWith('+')&&!line.startsWith('+++'))sections.get(current)!.push(line.slice(1));
    }
    for (const path of paths) {
      const added=sections.size?(sections.get(path)??[]).join('\n'):command;
      findings.push(...reviewSource(relative(root,resolve(hook.cwd,path)), added, policy));
    }
  }
  return {allowed: policy.mode === 'observe' || !findings.some(f=>f.severity==='error'), findings: findings.slice(0,200), command, paths};
}
