import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { canonical, HttpError, requestJson, sha256 } from './util.ts';
import { eventSchema, type Event, type Connection } from './contracts.ts';
import { redactEvent } from './redact.ts';

export class Outbox {
  db:DatabaseSync;
  constructor(path:string) {
    mkdirSync(dirname(path),{recursive:true});this.db=new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS queue(id TEXT PRIMARY KEY,identity TEXT NOT NULL,payload TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0,last_error TEXT,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
  }
  close(){this.db.close();}
  identity(config:Connection,token:string){return sha256(`${config.serverUrl}\n${config.projectId}\n${token}`);}
  put(event:Event,identity:string) {
    const payload=canonical(redactEvent(eventSchema.parse(event)));
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const old=this.db.prepare('SELECT payload,identity FROM queue WHERE id=?').get(event.id);
      if(old&&(old.payload!==payload||old.identity!==identity))throw new Error('Outbox ID conflict');
      if(!old) {
        const size=this.db.prepare('SELECT count(*) AS n,COALESCE(sum(length(payload)),0) AS bytes FROM queue').get()!;
        if(Number(size.n)>=10000||Number(size.bytes)+Buffer.byteLength(payload)>32_000_000)throw new Error('Outbox is full; flush before continuing capture');
        this.db.prepare('INSERT INTO queue(id,identity,payload,created_at) VALUES(?,?,?,?)').run(event.id,identity,payload,Date.now());
      }
      this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  get(key:string){const r=this.db.prepare('SELECT value FROM state WHERE key=?').get(key);return r?JSON.parse(String(r.value)):undefined;}
  set(key:string,value:unknown){this.db.prepare('INSERT INTO state VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));}
  status(){const row=this.db.prepare('SELECT count(*) AS pending,COALESCE(max(attempts),0) AS maxAttempts,min(created_at) AS oldest FROM queue').get()!;return {pending:Number(row.pending),maxAttempts:Number(row.maxAttempts),oldest:row.oldest===null?null:Number(row.oldest)};}
  async flush(config:Connection,token:string,options:{force?:boolean,limit?:number,budgetMs?:number}={}) {
    const identity=this.identity(config,token),deadline=Date.now()+(options.budgetMs??3500);
    const rows=this.db.prepare('SELECT * FROM queue WHERE identity=? AND next_at<=? ORDER BY created_at,id LIMIT ?').all(identity,options.force?Number.MAX_SAFE_INTEGER:Date.now(),options.limit??25);
    let sent=0,failed=0;
    for(const row of rows) {
      if(Date.now()>=deadline)break;
      try {
        await requestJson(`${config.serverUrl}/api/projects/${encodeURIComponent(config.projectId)}/events`,token,'POST',JSON.parse(String(row.payload)),Math.min(2000,Math.max(100,deadline-Date.now())));
        this.db.prepare('DELETE FROM queue WHERE id=? AND identity=?').run(row.id,identity);sent++;
      }catch(e) {
        const attempts=Number(row.attempts)+1;
        const error=e instanceof HttpError?`HTTP ${e.status}`:'Network unavailable';
        this.db.prepare('UPDATE queue SET attempts=?,next_at=?,last_error=? WHERE id=?').run(attempts,Date.now()+Math.min(300000,1000*2**Math.min(attempts,8)),error,row.id);
        failed++;break;
      }
    }
    return {sent,failed,...this.status()};
  }
}
