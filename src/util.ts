import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export function readJson(path: string): unknown { return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')); }
export function atomicWrite(path: string, text: string) {
  mkdirSync(dirname(path), {recursive: true});
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, text, {mode: 0o600, flag: 'wx'});
  renameSync(temp, path);
}
export function inside(root: string, path: string) {
  const r = relative(resolve(root), resolve(path));
  return r === '' || (!isAbsolute(r) && r !== '..' && !r.startsWith(`..${sep}`));
}
export function safePath(root: string, path: string) {
  const absolute = resolve(root, path);
  if (!inside(root, absolute)) throw new Error('Path leaves the project root');
  // Reject junctions as well as symlinks, including existing parent components.
  let current = absolute;
  while (true) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error(`Linked path refused: ${current}`);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return absolute;
}
export function trustedUrl(raw: string) {
  const url = new URL(raw);
  if (url.username || url.password || url.search || url.hash) throw new Error('Service URL must not contain credentials, query or fragment');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(url.hostname))) throw new Error('Use HTTPS or a loopback HTTP service');
  return url.toString().replace(/\/$/, '');
}
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export async function requestJson(url: string, token: string, method = 'GET', body?: unknown, timeout = 2500) {
  const response = await fetch(url, {method, redirect: 'error', headers: {'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json'},
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeout)});
  if (!response.ok) throw new HttpError(response.status, `Service returned HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > 4_000_000) throw new Error('Response exceeds limit');
  return JSON.parse(text);
}
