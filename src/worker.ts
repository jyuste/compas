import {WorkflowEntrypoint,WorkflowEvent,WorkflowStep} from 'cloudflare:workers';
import {Config,defaults,validate,localDay,resolve,range,choose} from './planner';
type Row={revision:number;json:string};
type Job={id:string;day:string;action:'entry'|'exit';revision:number;target:number;deadline:number;source:string;status:string;detail:string|null};
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function settings(env:Env){await env.DB.prepare('INSERT OR IGNORE INTO config VALUES(1,1,?)').bind(JSON.stringify(defaults())).run();return (await env.DB.prepare('SELECT * FROM config WHERE id=1').first<Row>())!;}
async function plan(env:Env){
 const row=await settings(env), c=JSON.parse(row.json) as Config, day=localDay(Date.now()), resolved=resolve(c,day);
 if(!resolved.rule)return;
 for(const action of ['entry','exit'] as const){
 const done=await env.DB.prepare("SELECT id FROM jobs WHERE day=? AND action=? AND status IN ('success','simulated','uncertain','sending','error') LIMIT 1").bind(day,action).first();if(done)continue;
 const w=range(day,resolved.rule[action]);if(Date.now()>w.to)continue;
 const id=`${day}-${action}-r${row.revision}`;
 await env.DB.prepare('INSERT OR IGNORE INTO jobs(id,day,action,revision,target,deadline,source) VALUES(?,?,?,?,?,?,?)').bind(id,day,action,row.revision,choose(w.from,w.to),w.to,resolved.source!).run();
 const job=await env.DB.prepare('SELECT * FROM jobs WHERE id=?').bind(id).first<Job>();
 if(job?.status==='pending'){try{await env.FICHAJE.create({id,params:{id}});}catch(error){try{await (await env.FICHAJE.get(id)).status();}catch{throw error;}}}
 }
}
async function update(env:Env,id:string,status:string,detail:string){await env.DB.prepare('UPDATE jobs SET status=?,detail=?,updated=CURRENT_TIMESTAMP WHERE id=?').bind(status,detail,id).run();}
export class FichajeWorkflow extends WorkflowEntrypoint<Env,{id:string}>{
 async run(event:WorkflowEvent<{id:string}>,step:WorkflowStep){
 const job=await step.do('Cargar planificación',async()=> (await this.env.DB.prepare('SELECT * FROM jobs WHERE id=?').bind(event.payload.id).first<Job>())!);
 if(job.target>Date.now())await step.sleepUntil('Esperar horario',job.target);
 await step.do('Registrar acción',{retries:{limit:0,delay:'1 second'},timeout:'1 minute'},async()=>{
 const row=await settings(this.env),c=JSON.parse(row.json) as Config;
 if(row.revision!==job.revision||!resolve(c,job.day).rule){await update(this.env,job.id,'skipped','Configuración modificada o día excluido');return;}
 if(localDay(Date.now())!==job.day||Date.now()>job.deadline){await update(this.env,job.id,'skipped','Fuera del intervalo');return;}
 // Claim once in D1 before the network call. A crash after claim requires manual review.
 const claim=await this.env.DB.prepare("UPDATE jobs SET status='sending',detail='Petición en curso; si persiste, revisar en Argon',updated=CURRENT_TIMESTAMP WHERE id=? AND status='pending' AND revision=(SELECT revision FROM config WHERE id=1) AND NOT EXISTS (SELECT 1 FROM jobs other WHERE other.day=jobs.day AND other.action=jobs.action AND other.id<>jobs.id AND other.status IN ('sending','success','simulated','error','uncertain'))").bind(job.id).run();
 if(!claim.meta.changes)return;
 if(this.env.APP_MODE!=='live'){await update(this.env,job.id,'simulated','Simulación: no se ha llamado a Argon');return;}
 if(!this.env.ARGON_TOKEN){await update(this.env,job.id,'error','Falta ARGON_TOKEN');return;}
 try{
 const response=await fetch('https://argon.metech.es/api/v1/work-sessions'+(job.action==='exit'?'/active':''),{method:job.action==='entry'?'POST':'PUT',headers:{Authorization:`Bearer ${this.env.ARGON_TOKEN}`,Accept:'application/json'},signal:AbortSignal.timeout(20000),redirect:'error'});
 const expected=job.action==='entry'?201:200;
 await update(this.env,job.id,response.status===expected?'success':response.status>=500?'uncertain':'error',`HTTP ${response.status}`);
 }catch{await update(this.env,job.id,'uncertain','Resultado incierto. Comprobar en Argon; no se reintenta.');}
 });
 }
}
const enc=new TextEncoder();
async function sign(secret:string,data:string){const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(data))),b=>b.toString(16).padStart(2,'0')).join('');}
async function equal(a:string,b:string){const x=new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(a))),y=new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(b)));let v=0;for(let i=0;i<x.length;i++)v|=x[i]^y[i];return v===0;}
async function authorized(req:Request,env:Env){const token=req.headers.get('Cookie')?.match(/(?:^|; )session=([^;]+)/)?.[1];if(!token||!env.SESSION_SECRET)return false;const [expiry,sig]=token.split('.');return Number(expiry)>Date.now()&&await equal(sig??'',await sign(env.SESSION_SECRET,expiry));}
export default {
 async scheduled(_event:ScheduledController,env:Env,ctx:ExecutionContext){ctx.waitUntil(plan(env).catch(e=>console.error(JSON.stringify({event:'planning_failed',message:String(e)}))));},
 async fetch(req:Request,env:Env):Promise<Response>{
 const url=new URL(req.url);
 if(!url.pathname.startsWith('/api/')){const response=await env.ASSETS.fetch(req);const h=new Headers(response.headers);h.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");h.set('X-Content-Type-Options','nosniff');return new Response(response.body,{status:response.status,headers:h});}
 if(!['GET','HEAD'].includes(req.method)&&req.headers.get('Origin')!==url.origin)return json({error:'Origen no permitido'},403);
 try{
 if(url.pathname==='/api/login'&&req.method==='POST'){
 if(!env.ADMIN_PASSWORD||!env.SESSION_SECRET)return json({error:'Configura ADMIN_PASSWORD y SESSION_SECRET en el servidor.'},503);
 const ip=req.headers.get('CF-Connecting-IP')??'local',now=Date.now();
 await env.DB.prepare('INSERT INTO attempts VALUES(?,1,?) ON CONFLICT(ip) DO UPDATE SET count=CASE WHEN reset<? THEN 1 ELSE count+1 END, reset=CASE WHEN reset<? THEN excluded.reset ELSE reset END').bind(ip,now+900000,now,now).run();
 const a=await env.DB.prepare('SELECT count FROM attempts WHERE ip=?').bind(ip).first<{count:number}>();if(a!.count>10)return json({error:'Demasiados intentos. Espera 15 minutos.'},429);
 const body=await req.json() as {password:string};if(typeof body.password!=='string'||!await equal(body.password,env.ADMIN_PASSWORD))return json({error:'Contraseña incorrecta'},401);
 const expiry=String(now+8*3600000);return new Response('{}',{headers:{'Content-Type':'application/json','Cache-Control':'no-store','Set-Cookie':`session=${expiry}.${await sign(env.SESSION_SECRET,expiry)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${url.protocol==='https:'?'; Secure':''}`}});
 }
 if(!await authorized(req,env))return json({error:'Inicia sesión'},401);
 if(url.pathname==='/api/logout'&&req.method==='POST')return new Response('{}',{headers:{'Set-Cookie':'session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'}});
 if(url.pathname==='/api/state'&&req.method==='GET'){
 const row=await settings(env);const jobs=await env.DB.prepare('SELECT * FROM jobs ORDER BY day DESC,target DESC LIMIT 200').all();return json({config:JSON.parse(row.json),revision:row.revision,jobs:jobs.results,mode:env.APP_MODE,connected:!!env.ARGON_TOKEN,today:localDay(Date.now())});
 }
 if(url.pathname==='/api/config'&&req.method==='PUT'){
 if(Number(req.headers.get('Content-Length')??0)>100000)return json({error:'Configuración demasiado grande'},413);
 const body=await req.json() as {config:Config;revision:number};const config=validate(body.config);
 const change=await env.DB.prepare('UPDATE config SET json=?,revision=revision+1 WHERE id=1 AND revision=?').bind(JSON.stringify(config),body.revision).run();if(!change.meta.changes)return json({error:'Otra sesión ha guardado cambios. Recarga la página.'},409);
 await env.DB.prepare("UPDATE jobs SET status='skipped',detail='Configuración actualizada' WHERE status='pending' AND revision<=?").bind(body.revision).run();await plan(env);return json({ok:true});
 }
 return json({error:'Ruta no encontrada'},404);
 }catch(e){console.error(JSON.stringify({event:'request_failed',message:String(e)}));return json({error:e instanceof Error?e.message:'Error interno'},400);}
 }
} satisfies ExportedHandler<Env>;
