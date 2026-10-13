import type { Event } from './contracts.ts';
// Run BEFORE persistence. Heuristics are not a guarantee that arbitrary sensitive text is safe.
export function redact(text: string): string {
  return text
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|AKIA[A-Z0-9]{16}|lag_[A-Za-z0-9_-]{20,})\b/g, '[REDACTED TOKEN]')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, '$1[REDACTED]')
    .replace(/((?:password|passwd|secret|api[_-]?key|access[_-]?token|session[_-]?token|authorization)\s*["']?\s*[:=]\s*)(["'])([\s\S]*?)\2/gi, '$1$2[REDACTED]$2')
    .replace(/((?:password|passwd|secret|api[_-]?key|access[_-]?token|session[_-]?token|authorization)\s*["']?\s*[:=]\s*["']?)([^\s"',;}]+)/gi, '$1[REDACTED]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[REDACTED]@');
}
export function redactEvent(event:Event):Event {
  return {...event,
    ...(event.prompt!==undefined?{prompt:redact(event.prompt)}:{}),
    ...(event.command!==undefined?{command:redact(event.command)}:{}),
    ...(event.detail!==undefined?{detail:redact(event.detail)}:{}),
    paths:event.paths.map(redact),
    findings:event.findings.map(f=>({...f,message:redact(f.message),...(f.path?{path:redact(f.path)}:{})})),
  };
}
