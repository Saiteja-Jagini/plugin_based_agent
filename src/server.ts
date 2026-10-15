import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { Store } from './store.ts';
import { id, provisionSchema } from './contracts.ts';
import { HttpError } from './util.ts';

async function body(req:IncomingMessage) {
  let bytes=0; const chunks:Buffer[]=[];
  for await (const chunk of req) {
    bytes+=chunk.length;
    if(bytes>2_000_000) throw new HttpError(413,'Request too large');
    chunks.push(Buffer.from(chunk));
  }
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new HttpError(400,'Invalid JSON');}
}
function send(res:ServerResponse,status:number,value:unknown) {
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(value));
}
export function createApp(store:Store) {
  const rates=new Map<string,{count:number,until:number}>();
  const server=createServer(async(req,res)=> {
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader('Referrer-Policy','no-referrer');
    try {
      const host=req.headers.host??'';
      // Loopback deployment: reject DNS rebinding and cross-origin browser writes.
      if(!/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host)) throw new HttpError(403,'Unsupported Host');
      const url=new URL(req.url??'/',`http://${host}`);
      const origin=req.headers.origin;
      if(origin && origin!==url.origin) throw new HttpError(403,'Cross-origin request refused');
      if(url.pathname==='/health'&&req.method==='GET') return send(res,200,{status:'ok',version:'0.4.0',deployment:'local-pilot'});
      const assets:Record<string,[string,string]>={'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/style.css':['style.css','text/css']};
      if(req.method==='GET'&&assets[url.pathname]) {
        const [file,mime]=assets[url.pathname];res.setHeader('Content-Type',`${mime}; charset=utf-8`);res.end(readFileSync(new URL(`../web/${file}`,import.meta.url)));return;
      }
      const token=req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
      if(!token) throw new HttpError(401,'Bearer credential required');
      const principal=store.auth(token);
      const now=Date.now(); if(rates.size>10000) for(const [k,v]of rates)if(v.until<now)rates.delete(k);
      const rate=rates.get(principal.id);if(rate&&rate.until>now){if(++rate.count>1200)throw new HttpError(429,'Rate limit exceeded');}else rates.set(principal.id,{count:1,until:now+60000});
      if(url.pathname==='/api/me'&&req.method==='GET')return send(res,200,principal);
      const match=url.pathname.match(/^\/api\/projects\/([^/]+)\/(summary|events|sessions|policy|skills|skill-syncs|principals|audit)(?:\/([^/]+))?$/);
      if(!match) throw new HttpError(404,'Route not found');
      const project=id.parse(decodeURIComponent(match[1])),resource=match[2],item=match[3];
      store.require(principal,project);
      if(resource==='summary'&&req.method==='GET')return send(res,200,store.summary(principal));
      if(resource==='events'&&req.method==='POST')return send(res,200,store.ingest(principal,await body(req)));
      if(resource==='events'&&req.method==='GET')return send(res,200,store.listEvents(principal,url.searchParams));
      if(resource==='sessions'&&req.method==='GET')return send(res,200,{items:store.sessions(principal)});
      if(resource==='policy'&&req.method==='GET')return send(res,200,store.policy(project));
      if(resource==='policy'&&req.method==='PUT')return send(res,200,store.setPolicy(principal,await body(req)));
      if(resource==='skills'&&req.method==='GET')return send(res,200,{release:store.release(project),resolutions:store.skillResolutions(principal,url.searchParams.get('repository')??'')});
      if(resource==='skills'&&req.method==='POST')return send(res,200,store.publish(principal,await body(req)));
      if(resource==='skills'&&item&&req.method==='PUT')return send(res,200,{release:store.editSkill(principal,decodeURIComponent(item),await body(req))});
      if(resource==='skill-syncs'&&req.method==='POST'&&!item)return send(res,200,store.reportSkills(principal,await body(req)));
      if(resource==='skill-syncs'&&req.method==='GET'&&!item)return send(res,200,{items:store.skillReports(principal)});
      if(resource==='skill-syncs'&&req.method==='PUT'&&item)return send(res,200,store.resolveSkill(principal,item,await body(req)));
      if(resource==='principals'&&req.method==='GET')return send(res,200,{items:store.principals(principal)});
      if(resource==='principals'&&req.method==='POST') {
        store.require(principal,project,['admin']);
        const input=provisionSchema.parse(await body(req));
        return send(res,201,store.transaction(()=>store.issue(project,input)));
      }
      if(resource==='principals'&&item&&req.method==='DELETE'){store.revoke(principal,id.parse(item));return send(res,200,{revoked:true});}
      if(resource==='audit'&&req.method==='GET'){store.require(principal,project,['admin','observer']);return send(res,200,store.integrity(project));}
      throw new HttpError(405,'Method not supported');
    }catch(error) {
      if(error instanceof z.ZodError)return send(res,400,{error:'Invalid request',issues:error.issues.map(i=>({path:i.path,message:i.message}))});
      if(error instanceof HttpError)return send(res,error.status,{error:error.message});
      send(res,500,{error:'Internal error; inspect service diagnostics'});
      process.stderr.write(`Request failed: ${error instanceof Error?error.name:'Error'}\n`);
    }
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  return server;
}
