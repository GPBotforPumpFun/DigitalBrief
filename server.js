import Fastify from "fastify";
import staticPlugin from "@fastify/static";
import pg from "pg";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";

const app = Fastify({ logger: true, bodyLimit: 2000000 });
const dir = path.dirname(fileURLToPath(import.meta.url));
await app.register(staticPlugin, { root: path.join(dir, "public"), prefix: "/" });

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const ENV_AI_KEY = process.env.OPENAI_API_KEY || "";
const AI_MODEL = process.env.OPENAI_MODEL || "gpt-5.6";
const CRYPT_KEY = crypto.createHash("sha256").update(process.env.CONNECTOR_ENCRYPTION_KEY || process.env.RUN_SECRET || "lucid-intel-dev").digest();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const RUN_SECRET = process.env.RUN_SECRET || "";
const SETTINGS_CODE = process.env.SETTINGS_CODE || "";
const APP_URL = (process.env.APP_URL || process.env.RAILWAY_STATIC_URL || "").replace(/\/$/,"");
const ENV_RESEND_KEY = process.env.RESEND_API_KEY || "";
const ENV_EMAIL_FROM = process.env.EMAIL_FROM || "";

const schema = [
"create table if not exists intel_clients(id serial primary key,name text not null,website_url text,industry text,geography text,objective text,status text not null default 'active',profile jsonb not null default '{}'::jsonb,created_at timestamptz not null default now())",
"create table if not exists intel_programs(id serial primary key,client_id int not null references intel_clients(id) on delete cascade,name text not null,program_type text not null,cadence text not null default 'weekly',objective text not null,source_plan jsonb not null default '[]'::jsonb,action_plan jsonb not null default '[]'::jsonb,active boolean not null default true,last_run_at timestamptz,created_at timestamptz not null default now())",
"create table if not exists intel_runs(id serial primary key,program_id int not null references intel_programs(id) on delete cascade,client_id int not null references intel_clients(id) on delete cascade,status text not null default 'running',summary text,created_at timestamptz not null default now(),finished_at timestamptz)",
"create table if not exists intel_signals(id serial primary key,run_id int references intel_runs(id) on delete cascade,program_id int not null references intel_programs(id) on delete cascade,client_id int not null references intel_clients(id) on delete cascade,title text not null,what_changed text not null,why_it_matters text not null,source_name text,source_url text,signal_date date,importance int not null default 2,confidence int not null default 70,created_at timestamptz not null default now())",
"create table if not exists intel_actions(id serial primary key,signal_id int references intel_signals(id) on delete cascade,client_id int not null references intel_clients(id) on delete cascade,program_id int references intel_programs(id) on delete set null,action_type text not null,title text not null,rationale text,payload jsonb not null default '{}'::jsonb,status text not null default 'proposed',created_at timestamptz not null default now(),executed_at timestamptz)",
"create table if not exists intel_connectors(id serial primary key,client_id int not null references intel_clients(id) on delete cascade,connector_type text not null,name text not null,encrypted_config text,status text not null default 'configured',created_at timestamptz not null default now())",
"create table if not exists intel_settings(setting_key text primary key,encrypted_value text,updated_at timestamptz not null default now())",
"create table if not exists intel_opportunities(id serial primary key,signal_id int unique references intel_signals(id) on delete set null,client_id int not null references intel_clients(id) on delete cascade,program_id int references intel_programs(id) on delete set null,title text not null,summary text,source_name text,source_url text,document_url text,opportunity_type text not null default 'rfp',fit_score int not null default 0,recommendation text,pursuit_status text not null default 'review',deadline date,qa_deadline date,estimated_value text,geography text,requirements jsonb not null default '[]'::jsonb,created_at timestamptz not null default now(),updated_at timestamptz not null default now())",
"create table if not exists intel_client_users(id serial primary key,client_id int not null references intel_clients(id) on delete cascade,email text not null unique,name text,password_hash text not null,active boolean not null default true,last_login_at timestamptz,created_at timestamptz not null default now())",
"create table if not exists intel_client_sessions(id serial primary key,user_id int not null references intel_client_users(id) on delete cascade,token_hash text not null unique,expires_at timestamptz not null,created_at timestamptz not null default now())",
"create index if not exists ix_opportunities_client_status on intel_opportunities(client_id,pursuit_status)",
"create index if not exists ix_client_sessions_expiry on intel_client_sessions(expires_at)",
"alter table intel_programs add column if not exists client_visible boolean not null default true",
"alter table intel_programs add column if not exists analyst_instructions text",
"alter table intel_programs add column if not exists delivery_settings jsonb not null default '{}'::jsonb",
"alter table intel_signals add column if not exists metadata jsonb not null default '{}'::jsonb",
"alter table intel_signals add column if not exists client_visible boolean not null default true",
"alter table intel_runs add column if not exists run_meta jsonb not null default '{}'::jsonb",
"alter table intel_runs add column if not exists accepted_count int not null default 0",
"alter table intel_runs add column if not exists rejected_count int not null default 0",
"create table if not exists intel_delivery_settings(client_id int primary key references intel_clients(id) on delete cascade,brief_enabled boolean not null default true,urgent_enabled boolean not null default true,updated_at timestamptz not null default now())",
"create table if not exists intel_brief_deliveries(id serial primary key,client_id int not null references intel_clients(id) on delete cascade,user_id int not null references intel_client_users(id) on delete cascade,status text not null,provider_message_id text,error text,new_signal_count int not null default 0,open_action_count int not null default 0,open_opportunity_count int not null default 0,sent_at timestamptz not null default now())",
"create table if not exists intel_alert_deliveries(id serial primary key,signal_id int not null references intel_signals(id) on delete cascade,user_id int not null references intel_client_users(id) on delete cascade,status text not null,provider_message_id text,error text,sent_at timestamptz not null default now(),unique(signal_id,user_id))",
"create index if not exists ix_brief_deliveries_user_sent on intel_brief_deliveries(user_id,sent_at desc)"
];

function encrypt(obj){
  const iv=crypto.randomBytes(12);
  const c=crypto.createCipheriv("aes-256-gcm",CRYPT_KEY,iv);
  const data=Buffer.concat([c.update(JSON.stringify(obj),"utf8"),c.final()]);
  return Buffer.concat([iv,c.getAuthTag(),data]).toString("base64");
}
function decrypt(value){
  const b=Buffer.from(value,"base64");
  const iv=b.subarray(0,12),tag=b.subarray(12,28),data=b.subarray(28);
  const d=crypto.createDecipheriv("aes-256-gcm",CRYPT_KEY,iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(data),d.final()]).toString("utf8"));
}
function cookieValue(req,name){
  const raw=req.headers.cookie||"";
  for(const part of raw.split(";")){
    const i=part.indexOf("=");
    if(i<0) continue;
    if(part.slice(0,i).trim()===name) return decodeURIComponent(part.slice(i+1).trim());
  }
  return "";
}
function setHttpCookie(reply,name,value,maxAge){
  reply.header("Set-Cookie",name+"="+encodeURIComponent(value)+"; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age="+maxAge);
}
function clearHttpCookie(reply,name){
  reply.header("Set-Cookie",name+"=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
}
function adminToken(){
  return crypto.createHmac("sha256",RUN_SECRET||SETTINGS_CODE||"lucid-admin").update("lucid-admin:"+SETTINGS_CODE).digest("hex");
}
function isAdmin(req){
  if(!SETTINGS_CODE) return true;
  const a=cookieValue(req,"intel_admin");
  const b=adminToken();
  if(!a||a.length!==b.length) return false;
  try{return crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b))}catch{return false}
}
function hashPassword(password,salt){
  const s=salt||crypto.randomBytes(16).toString("hex");
  return s+":"+crypto.scryptSync(password,s,64).toString("hex");
}
function verifyPassword(password,stored){
  const parts=String(stored||"").split(":");
  if(parts.length!==2) return false;
  const test=hashPassword(password,parts[0]).split(":")[1];
  if(test.length!==parts[1].length) return false;
  try{return crypto.timingSafeEqual(Buffer.from(test,"hex"),Buffer.from(parts[1],"hex"))}catch{return false}
}
async function getPortalUser(req){
  const token=cookieValue(req,"intel_session");
  if(!token) return null;
  const tokenHash=crypto.createHash("sha256").update(token).digest("hex");
  const q=await pool.query("select u.id user_id,u.client_id,u.email,u.name user_name,c.name client_name,c.website_url,c.industry,c.geography,c.objective from intel_client_sessions s join intel_client_users u on u.id=s.user_id join intel_clients c on c.id=u.client_id where s.token_hash=$1 and s.expires_at>now() and u.active=true",[tokenHash]);
  return q.rows[0]||null;
}
async function requirePortalUser(req,reply){
  const u=await getPortalUser(req);
  if(!u){reply.code(401).send({error:"login_required"});return null}
  return u;
}

app.addHook("onRequest",async function(req,reply){
  if(req.url==="/health") return;
  if((req.url.startsWith("/api/run")||req.url.startsWith("/api/briefs/")) && RUN_SECRET && req.headers["x-run-secret"]===RUN_SECRET) return;
  if(req.url.startsWith("/api/portal/")) return;
  if(req.url==="/api/admin/login"||req.url==="/api/admin/logout") return;
  if(req.url.startsWith("/api/")&&!isAdmin(req)) return reply.code(401).send({error:"admin_auth_required"});
});

function parseJson(text){
  if(!text) return null;
  let s=String(text).trim();
  const fence=String.fromCharCode(96).repeat(3);
  if(s.startsWith(fence)){
    s=s.slice(3);
    if(s.startsWith("json")) s=s.slice(4);
    const end=s.lastIndexOf(fence);
    if(end>=0) s=s.slice(0,end);
    s=s.trim();
  }
  try{return JSON.parse(s)}catch{}
  const a=s.indexOf("{"),b=s.lastIndexOf("}");
  if(a>=0&&b>a){try{return JSON.parse(s.slice(a,b+1))}catch{}}
  return null;
}
async function getSetting(key){
  const r=await pool.query("select encrypted_value from intel_settings where setting_key=$1",[key]);
  if(!r.rows[0]||!r.rows[0].encrypted_value) return "";
  try{
    const v=decrypt(r.rows[0].encrypted_value);
    return v&&v.value?String(v.value):"";
  }catch{return ""}
}
async function setSetting(key,value){
  await pool.query("insert into intel_settings(setting_key,encrypted_value,updated_at) values($1,$2,now()) on conflict(setting_key) do update set encrypted_value=excluded.encrypted_value,updated_at=now()",[key,encrypt({value:value})]);
}
async function getAIKey(){
  const dbKey=await getSetting("openai_api_key");
  return dbKey||ENV_AI_KEY;
}
async function hasAIKey(){return Boolean(await getAIKey())}
async function getEmailConfig(){
  const dbKey=await getSetting("resend_api_key");
  const dbFrom=await getSetting("email_from");
  return {key:dbKey||ENV_RESEND_KEY,from:dbFrom||ENV_EMAIL_FROM};
}
async function sendEmail(to,subject,html,textBody){
  const cfg=await getEmailConfig();
  if(!cfg.key) throw new Error("Email delivery is not configured");
  if(!cfg.from) throw new Error("Email From address is not configured");
  const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:"Bearer "+cfg.key,"Content-Type":"application/json"},body:JSON.stringify({from:cfg.from,to:[to],subject:subject,html:html,text:textBody})});
  const body=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(body.message||("Email provider returned "+r.status));
  return body;
}
function htmlEsc(v){return String(v==null?"":v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function makeMagicToken(userId,clientId){
  const payload=Buffer.from(JSON.stringify({u:Number(userId),c:Number(clientId),exp:Date.now()+72*3600000})).toString("base64url");
  const sig=crypto.createHmac("sha256",RUN_SECRET||SETTINGS_CODE||"lucid-magic").update(payload).digest("base64url");
  return payload+"."+sig;
}
function verifyMagicToken(token){
  try{
    const [payload,sig]=String(token||"").split(".");
    if(!payload||!sig) return null;
    const expected=crypto.createHmac("sha256",RUN_SECRET||SETTINGS_CODE||"lucid-magic").update(payload).digest("base64url");
    if(sig.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected))) return null;
    const data=JSON.parse(Buffer.from(payload,"base64url").toString("utf8"));
    if(!data.exp||Date.now()>Number(data.exp)) return null;
    return data;
  }catch{return null}
}
function deepLink(user,view,itemType,itemId){
  const magic=makeMagicToken(user.id,user.client_id);
  const qs=new URLSearchParams({magic:magic,view:view});
  if(itemType&&itemId) qs.set(itemType,String(itemId));
  return (APP_URL||"")+"/portal?"+qs.toString();
}
async function deliverySettings(clientId){
  const q=await pool.query("select brief_enabled,urgent_enabled from intel_delivery_settings where client_id=$1",[clientId]);
  return q.rows[0]||{brief_enabled:true,urgent_enabled:true};
}
async function briefDataForUser(user){
  const last=await pool.query("select sent_at from intel_brief_deliveries where user_id=$1 and status='sent' order by sent_at desc limit 1",[user.id]);
  const since=last.rows[0]?.sent_at||new Date(Date.now()-24*3600000);
  const all=await Promise.all([
    pool.query("select s.*,p.name program_name,p.program_type from intel_signals s join intel_programs p on p.id=s.program_id where s.client_id=$1 and s.client_visible=true and p.client_visible=true and p.program_type<>'opportunity' and s.created_at>$2 order by s.importance desc,s.created_at desc limit 12",[user.client_id,since]),
    pool.query("select a.*,p.name program_name from intel_actions a left join intel_programs p on p.id=a.program_id where a.client_id=$1 and a.status='proposed' and (p.id is null or p.client_visible=true) order by a.created_at asc limit 12",[user.client_id]),
    pool.query("select o.* from intel_opportunities o join intel_programs p on p.id=o.program_id where o.client_id=$1 and p.client_visible=true and p.active=true and o.pursuit_status='review' order by coalesce(o.deadline,'2999-12-31') asc,o.created_at desc limit 8",[user.client_id])
  ]);
  return {signals:all[0].rows,actions:all[1].rows,opportunities:all[2].rows,since:since};
}
function briefHtml(user,client,data){
  const attention=[];
  for(const a of data.actions){
    attention.push('<div style="border:1px solid #e5e7eb;border-left:4px solid #f3b51b;border-radius:10px;padding:14px;margin:10px 0"><div style="font-size:11px;font-weight:800;color:#8a6500;letter-spacing:.05em">ACTION NEEDED</div><div style="font-size:16px;font-weight:700;margin:4px 0">'+htmlEsc(a.title)+'</div><div style="font-size:13px;color:#616773;margin-bottom:10px">'+htmlEsc(a.rationale||"Lucid Logic has prepared an action for your review.")+'</div><a href="'+htmlEsc(deepLink(user,"actions","action",a.id))+'" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;padding:9px 13px;border-radius:7px;font-size:12px;font-weight:700">Review action</a></div>');
  }
  for(const o of data.opportunities){
    const due=o.deadline?new Date(o.deadline+"T12:00:00").toLocaleDateString():"Deadline not confirmed";
    attention.push('<div style="border:1px solid #e5e7eb;border-left:4px solid #f3b51b;border-radius:10px;padding:14px;margin:10px 0"><div style="font-size:11px;font-weight:800;color:#8a6500;letter-spacing:.05em">OPPORTUNITY TO REVIEW</div><div style="font-size:16px;font-weight:700;margin:4px 0">'+htmlEsc(o.title)+'</div><div style="font-size:13px;color:#616773;margin-bottom:4px">'+htmlEsc(o.summary||"")+'</div><div style="font-size:12px;color:#7b818c;margin-bottom:10px">Fit: '+htmlEsc(o.fit_score||0)+'/100 · '+htmlEsc(due)+'</div><a href="'+htmlEsc(deepLink(user,"opportunities","opp",o.id))+'" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;padding:9px 13px;border-radius:7px;font-size:12px;font-weight:700">Review opportunity</a></div>');
  }
  const intel=data.signals.map(sig=>'<div style="padding:14px 0;border-top:1px solid #eceff3"><div style="font-size:11px;color:#7c8490;font-weight:700">'+htmlEsc(sig.program_name||"Intelligence")+'</div><div style="font-size:16px;font-weight:700;margin:4px 0">'+htmlEsc(sig.title)+'</div><div style="font-size:13px;line-height:1.5;color:#313640">'+htmlEsc(sig.what_changed)+'</div><div style="font-size:13px;line-height:1.5;background:#fffaf0;border-left:3px solid #f3b51b;padding:9px 10px;margin-top:8px"><b>Why it matters:</b> '+htmlEsc(sig.why_it_matters)+'</div><div style="margin-top:9px"><a href="'+htmlEsc(deepLink(user,"intelligence","signal",sig.id))+'" style="font-size:12px;font-weight:700;color:#315bcc;text-decoration:none">View in portal →</a></div></div>').join("");
  const nothing=!attention.length&&!intel;
  return '<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:Arial,sans-serif;color:#111827"><div style="max-width:720px;margin:auto;padding:24px"><div style="background:#11151d;color:#fff;border-radius:14px;padding:22px 24px"><div style="font-size:11px;color:#f3b51b;font-weight:800;letter-spacing:.08em">LUCID LOGIC MANAGED INTELLIGENCE</div><div style="font-size:26px;font-weight:800;margin-top:5px">'+htmlEsc(client.name)+'</div><div style="font-size:13px;color:#c5cad2;margin-top:5px">Daily Intelligence Brief</div></div><div style="background:#fff;border-radius:14px;padding:22px 24px;margin-top:12px">'+
    (attention.length?'<div style="font-size:18px;font-weight:800">Needs your attention</div><div style="font-size:13px;color:#68707c;margin:4px 0 10px">These items need a decision or review.</div>'+attention.join(""):"")+
    (intel?'<div style="font-size:18px;font-weight:800;margin-top:'+(attention.length?24:0)+'px">New intelligence</div><div style="font-size:13px;color:#68707c;margin:4px 0 8px">What changed since your last brief, and why it matters.</div>'+intel:"")+
    (nothing?'<div style="padding:20px 0"><div style="font-size:18px;font-weight:800">Nothing material today.</div><div style="font-size:13px;color:#68707c;margin-top:6px">We are still monitoring. There are no new material changes or outstanding decisions for you right now.</div></div>':"")+
    '<div style="border-top:1px solid #eceff3;margin-top:20px;padding-top:15px;font-size:12px;color:#7d8590">Read in email. Act in the portal. <a href="'+htmlEsc(deepLink(user,"overview"))+'" style="color:#315bcc;font-weight:700;text-decoration:none">Open your workspace →</a></div></div></div></body></html>';
}
function briefText(user,client,data){
  const lines=["LUCID LOGIC MANAGED INTELLIGENCE",client.name,"Daily Intelligence Brief",""];
  if(data.actions.length||data.opportunities.length){
    lines.push("NEEDS YOUR ATTENTION");
    for(const a of data.actions) lines.push("ACTION: "+a.title+"\n"+deepLink(user,"actions","action",a.id));
    for(const o of data.opportunities) lines.push("OPPORTUNITY: "+o.title+"\n"+deepLink(user,"opportunities","opp",o.id));
    lines.push("");
  }
  if(data.signals.length){
    lines.push("NEW INTELLIGENCE");
    for(const sig of data.signals) lines.push(sig.title+"\n"+sig.what_changed+"\nWhy it matters: "+sig.why_it_matters+"\n"+deepLink(user,"intelligence","signal",sig.id)+"\n");
  }
  if(!data.actions.length&&!data.opportunities.length&&!data.signals.length) lines.push("Nothing material today. We are still monitoring.");
  lines.push("","Read in email. Act in the portal.","Open workspace: "+deepLink(user,"overview"));
  return lines.join("\n");
}
async function sendDailyBriefs(onlyClientId=null){
  const cfg=await getEmailConfig();
  if(!cfg.key||!cfg.from) return {sent:0,skipped:true,reason:"email_not_configured"};
  const args=[],where=["u.active=true","c.status='active'"];
  if(onlyClientId){args.push(Number(onlyClientId));where.push("u.client_id=$"+args.length)}
  const q=await pool.query("select u.id,u.client_id,u.email,u.name,c.name client_name from intel_client_users u join intel_clients c on c.id=u.client_id left join intel_delivery_settings d on d.client_id=c.id where "+where.join(" and ")+" and coalesce(d.brief_enabled,true)=true order by u.client_id,u.id",args);
  const results=[];
  for(const user of q.rows){
    const data=await briefDataForUser(user);
    const client={id:user.client_id,name:user.client_name};
    const attention=data.actions.length+data.opportunities.length;
    const subject=(attention?attention+" item"+(attention===1?"":"s")+" need your attention | ":"")+client.name+" Daily Intelligence Brief";
    try{
      const sent=await sendEmail(user.email,subject,briefHtml(user,client,data),briefText(user,client,data));
      await pool.query("insert into intel_brief_deliveries(client_id,user_id,status,provider_message_id,new_signal_count,open_action_count,open_opportunity_count) values($1,$2,'sent',$3,$4,$5,$6)",[user.client_id,user.id,sent.id||null,data.signals.length,data.actions.length,data.opportunities.length]);
      results.push({userId:user.id,email:user.email,status:"sent"});
    }catch(e){
      await pool.query("insert into intel_brief_deliveries(client_id,user_id,status,error,new_signal_count,open_action_count,open_opportunity_count) values($1,$2,'failed',$3,$4,$5,$6)",[user.client_id,user.id,String(e.message||e),data.signals.length,data.actions.length,data.opportunities.length]);
      results.push({userId:user.id,email:user.email,status:"failed",error:String(e.message||e)});
    }
  }
  return {sent:results.filter(x=>x.status==="sent").length,failed:results.filter(x=>x.status==="failed").length,results:results};
}
async function sendUrgentAlertsForRun(runId,clientId){
  const cfg=await getEmailConfig();
  if(!cfg.key||!cfg.from) return {sent:0,skipped:true};
  const ds=await deliverySettings(clientId);
  if(!ds.urgent_enabled) return {sent:0,skipped:true};
  const signals=await pool.query("select s.*,p.name program_name,p.program_type from intel_signals s join intel_programs p on p.id=s.program_id where s.run_id=$1 and s.client_id=$2 and s.client_visible=true and p.client_visible=true and s.importance>=3",[runId,clientId]);
  if(!signals.rows.length) return {sent:0};
  const users=await pool.query("select u.id,u.client_id,u.email,u.name,c.name client_name from intel_client_users u join intel_clients c on c.id=u.client_id where u.client_id=$1 and u.active=true",[clientId]);
  let sentCount=0;
  for(const sig of signals.rows){
    for(const user of users.rows){
      const prior=await pool.query("select 1 from intel_alert_deliveries where signal_id=$1 and user_id=$2",[sig.id,user.id]);
      if(prior.rows[0]) continue;
      const view=sig.program_type==="opportunity"?"opportunities":"intelligence";
      let itemType=sig.program_type==="opportunity"?"opp":"signal",itemId=sig.id;
      if(sig.program_type==="opportunity"){
        const oq=await pool.query("select id from intel_opportunities where signal_id=$1",[sig.id]);
        if(oq.rows[0]) itemId=oq.rows[0].id;
      }
      const link=deepLink(user,view,itemType,itemId);
      const subject="Actionable intelligence | "+user.client_name+" | "+sig.title;
      const html='<div style="font-family:Arial,sans-serif;max-width:650px;margin:auto"><div style="font-size:11px;color:#8a6500;font-weight:800">LUCID LOGIC · ACTIONABLE INTELLIGENCE</div><h2>'+htmlEsc(sig.title)+'</h2><p>'+htmlEsc(sig.what_changed)+'</p><div style="border-left:3px solid #f3b51b;background:#fffaf0;padding:10px 12px"><b>Why it matters:</b> '+htmlEsc(sig.why_it_matters)+'</div><p><a href="'+htmlEsc(link)+'" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;padding:10px 14px;border-radius:7px;font-weight:700">Review now</a></p></div>';
      try{
        const sent=await sendEmail(user.email,subject,html,sig.title+"\n\n"+sig.what_changed+"\n\nWhy it matters: "+sig.why_it_matters+"\n\nReview: "+link);
        await pool.query("insert into intel_alert_deliveries(signal_id,user_id,status,provider_message_id) values($1,$2,'sent',$3)",[sig.id,user.id,sent.id||null]);
        sentCount++;
      }catch(e){
        await pool.query("insert into intel_alert_deliveries(signal_id,user_id,status,error) values($1,$2,'failed',$3) on conflict(signal_id,user_id) do update set status='failed',error=excluded.error,sent_at=now()",[sig.id,user.id,String(e.message||e)]);
      }
    }
  }
  return {sent:sentCount};
}

async function openaiDetailed(prompt,useWeb){
  const key=await getAIKey();
  if(!key) return null;
  const body={model:AI_MODEL,input:prompt,tools:useWeb?[{type:"web_search"}]:[]};
  const r=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(210000)});
  if(!r.ok) throw new Error("OpenAI "+r.status+": "+(await r.text()).slice(0,300));
  const d=await r.json();
  let text=d.output_text||"";
  if(!text){
    const out=[];
    for(const o of d.output||[]) for(const c of o.content||[]) if(c.text) out.push(c.text);
    text=out.join("\n");
  }
  return {text:text,usage:d.usage||{},model:d.model||AI_MODEL,response_id:d.id||null};
}
async function openai(prompt,useWeb){
  const d=await openaiDetailed(prompt,useWeb);
  return d?d.text:null;
}
async function crawl(url){
  let target=url||"";
  if(!/^https?:/i.test(target)) target="https://"+target;
  const r=await fetch(target,{headers:{"user-agent":"LucidLogic-Intelligence/1.0"},redirect:"follow"});
  if(!r.ok) throw new Error("Website returned "+r.status);
  const html=await r.text();
  const $=cheerio.load(html);
  const title=$("title").text().trim();
  const description=$('meta[name="description"]').attr("content")||"";
  $("script,style,noscript,svg").remove();
  const text=$("body").text().replace(/\s+/g," ").trim().slice(0,18000);
  return {url:r.url,title,description,text};
}
async function init(){
  for(const q of schema) await pool.query(q);
  const c=await pool.query("select count(*)::int n from intel_clients");
  if(c.rows[0].n===0) await seed();

  // One-time cleanup of the original seeded example finding. Keep the demo client/programs,
  // but never show fake intelligence, actions or opportunities as if they were real.
  await pool.query("delete from intel_opportunities where source_url='https://example.com/rfp' or document_url='https://example.com/rfp' or title='Regional website modernization RFP identified'");
  await pool.query("delete from intel_signals where source_url='https://example.com/rfp' or source_name='Demo source' or title='Regional website modernization RFP identified'");

  await pool.query("insert into intel_opportunities(signal_id,client_id,program_id,title,summary,source_name,source_url,document_url,opportunity_type,fit_score,recommendation) select s.id,s.client_id,s.program_id,s.title,s.what_changed,s.source_name,s.source_url,s.source_url,'rfp',least(100,greatest(0,s.confidence)),s.why_it_matters from intel_signals s join intel_programs p on p.id=s.program_id where p.program_type='opportunity' and not exists(select 1 from intel_opportunities o where o.signal_id=s.id)");
  await pool.query("delete from intel_client_sessions where expires_at<=now()");
}
async function seed(){
  const c=await pool.query("insert into intel_clients(name,website_url,industry,geography,objective,profile) values($1,$2,$3,$4,$5,$6) returning id",["Lucid Logic Demo","https://lucidlogic.co","Digital consulting","NY + FL","Find qualified opportunities early and turn intelligence into concrete actions",JSON.stringify({demo:true})]);
  const id=c.rows[0].id;
  const ps=[
    ["Revenue Opportunity Radar","opportunity","weekday","Find RFPs, grants, projects and buying signals early enough to act",["RFP/RFQ","grants","procurement","facility expansion"],["proposal","questions","outreach"]],
    ["Competitor Intelligence","competitor","weekly","Watch meaningful competitor changes and recommend a response",["competitor websites","news","hiring","reviews"],["website_post","social_post","alert"]],
    ["Reputation + AI Visibility","visibility","weekly","Monitor reputation, discoverability and AI visibility",["reviews","AI discovery","forums","entity signals"],["website_post","social_post","review_response"]],
    ["Industry Intelligence","industry","weekly","Surface market, regulatory and technical changes that matter",["regulators","trade press","associations","research"],["brief","website_post","social_post"]],
    ["Account Intelligence","account","weekday","Detect trigger events that create a reason to contact accounts",["company news","leadership","funding","hiring","facilities"],["outreach","email_draft","alert"]]
  ];
  for(const p of ps) await pool.query("insert into intel_programs(client_id,name,program_type,cadence,objective,source_plan,action_plan) values($1,$2,$3,$4,$5,$6,$7)",[id,p[0],p[1],p[2],p[3],JSON.stringify(p[4]),JSON.stringify(p[5])]);
}
async function discover(client){
  const site=await crawl(client.website_url);
  let blueprint={
    summary:client.name+" can use managed intelligence to watch revenue, competitors, visibility, industry change and account triggers.",
    priorities:["Find signals early enough to act","Filter routine noise","Attach an executable next step to every material signal"],
    suggested_sources:[
      {label:"Company website",value:site.url,kind:"owned"},
      {label:"Competitor sites",value:"3 to 8 direct competitors",kind:"competitive"},
      {label:"Revenue sources",value:"RFP/RFQ, grants, procurement, permits, funding and expansion news",kind:"revenue"},
      {label:"Industry sources",value:"Regulators, associations, trade press and research",kind:"industry"}
    ],
    suggested_actions:[
      {type:"website_post",label:"Publish or update website content"},
      {type:"social_post",label:"Create a social post"},
      {type:"proposal",label:"Generate proposal starter"},
      {type:"questions",label:"Generate RFP or grant questions"},
      {type:"outreach",label:"Draft account outreach"}
    ]
  };
  if(await hasAIKey()){
    const prompt="Design a managed intelligence program for a paying business client. Promise: monitor information they cannot afford to miss, filter noise, explain why changes matter, and turn changes into business actions.\nClient: "+client.name+"\nIndustry: "+(client.industry||"")+"\nGeography: "+(client.geography||"")+"\nObjective: "+(client.objective||"")+"\nWebsite title: "+site.title+"\nDescription: "+site.description+"\nSite text: "+site.text.slice(0,12000)+"\nReturn ONLY JSON with summary, business_model, priorities[], competitor_queries[], opportunity_queries[], industry_queries[], account_trigger_queries[], suggested_sources[{label,value,kind}], suggested_programs[{name,type,objective,cadence,sources[],actions[]}], suggested_actions[{type,label,reason}]. Make it specific.";
    const out=parseJson(await openai(prompt,false));
    if(out) blueprint=Object.assign(blueprint,out);
  }
  blueprint.site={title:site.title,description:site.description,url:site.url};
  await pool.query("update intel_clients set profile=$1 where id=$2",[JSON.stringify(blueprint),client.id]);
  return blueprint;
}
async function cleanupStaleRuns(){
  await pool.query("update intel_runs set status='failed',summary=coalesce(nullif(summary,''),'Run was interrupted before completion. Please run it again.'),finished_at=now() where status='running' and created_at<now()-interval '10 minutes'");
}
async function runProgram(program,client,options={}){
  let runId=Number(options.runId||0);
  if(!runId){
    const rr=await pool.query("insert into intel_runs(program_id,client_id,run_meta) values($1,$2,$3) returning id",[program.id,client.id,JSON.stringify({source_plan:program.source_plan||[],action_plan:program.action_plan||[],cadence:program.cadence,model:AI_MODEL,program_type:program.program_type})]);
    runId=rr.rows[0].id;
  }
  if(!(await hasAIKey())){
    await pool.query("update intel_runs set status='needs_configuration',summary='Add the OpenAI API key in Settings to enable live research runs.',finished_at=now() where id=$1",[runId]);
    return {runId,status:"needs_configuration"};
  }
  try{
    const prompt="Act as Lucid Logic's managed intelligence analyst. Research the public web for material developments relevant to this client and program.\nCLIENT: "+client.name+"; website "+(client.website_url||"")+"; industry "+(client.industry||"")+"; geography "+(client.geography||"")+"; objective "+(client.objective||"")+".\nPROGRAM: "+program.name+"; type "+program.program_type+"; objective "+program.objective+"; emphasize "+JSON.stringify(program.source_plan)+"; permitted actions "+JSON.stringify(program.action_plan)+".\nANALYST INSTRUCTIONS: "+(program.analyst_instructions||"Use sound judgment. Prefer material, actionable developments over volume.")+".\nFind at most 6 genuinely material recent signals. Reject routine news, duplicates, vague commentary and items with no clear business consequence. For every accepted signal explain what changed and why it matters. Every signal may recommend actions from the permitted action types. Return ONLY JSON with summary, rejected_count, rejected_notes (short array), and signals. Each signal must include title, what_changed, why_it_matters, source_name, source_url, signal_date, importance 1-3, confidence 0-100, metadata object, actions with type,title,rationale,payload. Metadata should preserve type-specific facts: competitor name/change type for competitor intelligence; account/company/trigger/contact clues for account intelligence; platform/metric/old_value/new_value/query for visibility intelligence; regulator/topic/effective_date for industry intelligence. For opportunities also include opportunity with opportunity_type, fit_score 0-100, recommendation, deadline YYYY-MM-DD or null, qa_deadline YYYY-MM-DD or null, estimated_value, geography, requirements array, and document_url.";
    const response=await openaiDetailed(prompt,true);
    const out=parseJson(response&&response.text);
    if(!out||!Array.isArray(out.signals)) throw new Error("Research response did not contain signals");
    let accepted=0;
    for(const item of out.signals.slice(0,6)){
      const ins=await pool.query("insert into intel_signals(run_id,program_id,client_id,title,what_changed,why_it_matters,source_name,source_url,signal_date,importance,confidence,metadata,client_visible) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id",[runId,program.id,client.id,item.title,item.what_changed,item.why_it_matters,item.source_name,item.source_url,item.signal_date||null,item.importance||2,item.confidence||70,JSON.stringify(item.metadata||{}),program.client_visible!==false]);
      accepted++;
      if(program.program_type==="opportunity"){
        const o=item.opportunity||{};
        await pool.query("insert into intel_opportunities(signal_id,client_id,program_id,title,summary,source_name,source_url,document_url,opportunity_type,fit_score,recommendation,deadline,qa_deadline,estimated_value,geography,requirements) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) on conflict(signal_id) do update set title=excluded.title,summary=excluded.summary,source_name=excluded.source_name,source_url=excluded.source_url,document_url=excluded.document_url,opportunity_type=excluded.opportunity_type,fit_score=excluded.fit_score,recommendation=excluded.recommendation,deadline=excluded.deadline,qa_deadline=excluded.qa_deadline,estimated_value=excluded.estimated_value,geography=excluded.geography,requirements=excluded.requirements,updated_at=now()",[ins.rows[0].id,client.id,program.id,item.title,item.what_changed,item.source_name,item.source_url,o.document_url||item.source_url,o.opportunity_type||"rfp",o.fit_score||item.confidence||70,o.recommendation||item.why_it_matters,o.deadline||null,o.qa_deadline||null,o.estimated_value||null,o.geography||client.geography||null,JSON.stringify(o.requirements||[])]);
      }
      for(const a of item.actions||[]) await pool.query("insert into intel_actions(signal_id,client_id,program_id,action_type,title,rationale,payload) values($1,$2,$3,$4,$5,$6,$7)",[ins.rows[0].id,client.id,program.id,a.type,a.title,a.rationale||"",JSON.stringify(a.payload||{})]);
    }
    const rejected=Math.max(0,Number(out.rejected_count||0));
    const meta={source_plan:program.source_plan||[],action_plan:program.action_plan||[],cadence:program.cadence,model:(response&&response.model)||AI_MODEL,program_type:program.program_type,usage:(response&&response.usage)||{},response_id:(response&&response.response_id)||null,rejected_notes:Array.isArray(out.rejected_notes)?out.rejected_notes.slice(0,12):[]};
    await pool.query("update intel_programs set last_run_at=now() where id=$1",[program.id]);
    await pool.query("update intel_runs set status='done',summary=$1,accepted_count=$2,rejected_count=$3,run_meta=$4,finished_at=now() where id=$5",[out.summary||"",accepted,rejected,JSON.stringify(meta),runId]);
    if(!options.suppressUrgent){try{await sendUrgentAlertsForRun(runId,client.id)}catch{}}
    return {runId,status:"done",count:accepted,rejected:rejected};
  }catch(e){
    await pool.query("update intel_runs set status='failed',summary=$1,run_meta=run_meta||$2::jsonb,finished_at=now() where id=$3",[String(e.message||e),JSON.stringify({error:String(e.message||e)}),runId]);
    throw e;
  }
}
async function executeAction(action){
  const cr=await pool.query("select * from intel_clients where id=$1",[action.client_id]);
  const client=cr.rows[0];
  const con=await pool.query("select * from intel_connectors where client_id=$1",[action.client_id]);
  const payload=action.payload||{};
  if(action.action_type==="website_post"){
    const c=con.rows.find(function(x){return x.connector_type==="wordpress"||x.connector_type==="webhook"});
    if(!c) return {executed:false,message:"No website connector configured"};
    const cfg=decrypt(c.encrypted_config);
    if(c.connector_type==="wordpress"){
      const endpoint=(cfg.url||client.website_url||"").replace(/\/$/,"")+"/wp-json/wp/v2/posts";
      const auth=Buffer.from(cfg.username+":"+cfg.appPassword).toString("base64");
      const r=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Basic "+auth},body:JSON.stringify({title:payload.title||action.title,content:payload.body||payload.content||"",status:payload.status||"draft"})});
      if(!r.ok) throw new Error("WordPress returned "+r.status);
      return {executed:true,message:"Sent to WordPress as "+(payload.status||"draft")};
    }
    const headers={"Content-Type":"application/json"};
    if(cfg.token) headers.Authorization="Bearer "+cfg.token;
    const r=await fetch(cfg.url,{method:"POST",headers:headers,body:JSON.stringify({event:"website_post",client:client.name,action:payload})});
    if(!r.ok) throw new Error("Webhook returned "+r.status);
    return {executed:true,message:"Website webhook called"};
  }
  if(action.action_type==="social_post"){
    const c=con.rows.find(function(x){return x.connector_type==="social_webhook"});
    if(!c) return {executed:false,message:"No social publishing connector configured"};
    const cfg=decrypt(c.encrypted_config);
    const headers={"Content-Type":"application/json"};
    if(cfg.token) headers.Authorization="Bearer "+cfg.token;
    const r=await fetch(cfg.url,{method:"POST",headers:headers,body:JSON.stringify({event:"social_post",client:client.name,action:payload})});
    if(!r.ok) throw new Error("Social webhook returned "+r.status);
    return {executed:true,message:"Social publishing webhook called"};
  }
  return {executed:true,message:"Approved and packaged for delivery",result:payload};
}

app.post("/api/admin/login",async function(req,reply){
  const b=req.body||{};
  if(!SETTINGS_CODE||String(b.code||"")!==SETTINGS_CODE) return reply.code(401).send({error:"Invalid admin access code"});
  setHttpCookie(reply,"intel_admin",adminToken(),2592000);
  return {ok:true};
});
app.post("/api/admin/logout",async function(req,reply){
  clearHttpCookie(reply,"intel_admin");
  return {ok:true};
});
app.get("/portal",async function(req,reply){return reply.sendFile("portal.html")});

app.post("/api/portal/login",async function(req,reply){
  const b=req.body||{};
  const email=String(b.email||"").trim().toLowerCase();
  const password=String(b.password||"");
  const q=await pool.query("select * from intel_client_users where lower(email)=$1 and active=true",[email]);
  const u=q.rows[0];
  if(!u||!verifyPassword(password,u.password_hash)) return reply.code(401).send({error:"Invalid email or password"});
  const token=crypto.randomBytes(32).toString("hex");
  const tokenHash=crypto.createHash("sha256").update(token).digest("hex");
  await pool.query("insert into intel_client_sessions(user_id,token_hash,expires_at) values($1,$2,now()+interval '7 days')",[u.id,tokenHash]);
  await pool.query("update intel_client_users set last_login_at=now() where id=$1",[u.id]);
  setHttpCookie(reply,"intel_session",token,604800);
  return {ok:true};
});
app.post("/api/portal/logout",async function(req,reply){
  const token=cookieValue(req,"intel_session");
  if(token){
    const tokenHash=crypto.createHash("sha256").update(token).digest("hex");
    await pool.query("delete from intel_client_sessions where token_hash=$1",[tokenHash]);
  }
  clearHttpCookie(reply,"intel_session");
  return {ok:true};
});
app.post("/api/portal/magic-login",async function(req,reply){
  const data=verifyMagicToken((req.body||{}).token);
  if(!data) return reply.code(401).send({error:"This secure link is invalid or has expired"});
  const q=await pool.query("select id,client_id from intel_client_users where id=$1 and client_id=$2 and active=true",[Number(data.u),Number(data.c)]);
  if(!q.rows[0]) return reply.code(401).send({error:"This secure link is no longer valid"});
  const token=crypto.randomBytes(32).toString("hex");
  const tokenHash=crypto.createHash("sha256").update(token).digest("hex");
  await pool.query("insert into intel_client_sessions(user_id,token_hash,expires_at) values($1,$2,now()+interval '7 days')",[q.rows[0].id,tokenHash]);
  await pool.query("update intel_client_users set last_login_at=now() where id=$1",[q.rows[0].id]);
  setHttpCookie(reply,"intel_session",token,604800);
  return {ok:true};
});
app.get("/api/portal/me",async function(req,reply){
  const u=await requirePortalUser(req,reply);
  if(!u) return;
  return {user:{id:u.user_id,email:u.email,name:u.user_name},client:{id:u.client_id,name:u.client_name,website_url:u.website_url,industry:u.industry,geography:u.geography,objective:u.objective}};
});
app.get("/api/portal/dashboard",async function(req,reply){
  const u=await requirePortalUser(req,reply);
  if(!u) return;
  const id=u.client_id;
  const all=await Promise.all([
    pool.query("select s.*,p.name program_name,p.program_type from intel_signals s join intel_programs p on p.id=s.program_id where s.client_id=$1 and s.client_visible=true and p.client_visible=true order by s.created_at desc limit 100",[id]),
    pool.query("select o.* from intel_opportunities o join intel_programs p on p.id=o.program_id where o.client_id=$1 and p.active=true and p.client_visible=true order by case o.pursuit_status when 'pursue' then 0 when 'review' then 1 else 2 end,coalesce(o.deadline,'2999-12-31') asc,o.created_at desc",[id]),
    pool.query("select a.*,s.title signal_title from intel_actions a left join intel_signals s on s.id=a.signal_id left join intel_programs p on p.id=a.program_id where a.client_id=$1 and (p.id is null or p.client_visible=true) order by a.created_at desc limit 150",[id]),
    pool.query("select id,name,program_type,cadence,objective,last_run_at from intel_programs where client_id=$1 and active=true and client_visible=true order by name",[id])
  ]);
  return {signals:all[0].rows,opportunities:all[1].rows,actions:all[2].rows,programs:all[3].rows};
});
app.post("/api/portal/opportunities/:id/status",async function(req,reply){
  const u=await requirePortalUser(req,reply);
  if(!u) return;
  const status=String((req.body||{}).status||"");
  if(!["review","pursue","pass"].includes(status)) return reply.code(400).send({error:"Invalid status"});
  const r=await pool.query("update intel_opportunities set pursuit_status=$1,updated_at=now() where id=$2 and client_id=$3 returning *",[status,Number(req.params.id),u.client_id]);
  if(!r.rows[0]) return reply.code(404).send({error:"Opportunity not found"});
  return r.rows[0];
});
app.post("/api/portal/opportunities/:id/generate",async function(req,reply){
  const u=await requirePortalUser(req,reply);
  if(!u) return;
  const type=String((req.body||{}).action_type||"questions");
  if(!["questions","proposal","outreach","email_draft"].includes(type)) return reply.code(400).send({error:"Unsupported action"});
  const q=await pool.query("select o.*,s.what_changed,s.why_it_matters from intel_opportunities o left join intel_signals s on s.id=o.signal_id where o.id=$1 and o.client_id=$2",[Number(req.params.id),u.client_id]);
  const o=q.rows[0];
  if(!o) return reply.code(404).send({error:"Opportunity not found"});
  let payload={title:o.title,body:(o.summary||o.what_changed||"")+"\n\nRecommendation: "+(o.recommendation||o.why_it_matters||""),notes:"Generated from the opportunity workspace."};
  if(await hasAIKey()){
    const prompt="Create a client-ready "+type+" for this opportunity. Company: "+u.client_name+". Opportunity: "+o.title+". Summary: "+(o.summary||o.what_changed||"")+". Recommendation: "+(o.recommendation||o.why_it_matters||"")+". Deadline: "+(o.deadline||"unknown")+". Q&A deadline: "+(o.qa_deadline||"unknown")+". Requirements: "+JSON.stringify(o.requirements||[])+". Source: "+(o.document_url||o.source_url||"")+". Return only JSON with title, body and notes.";
    const out=parseJson(await openai(prompt,false));
    if(out) payload=out;
  }
  const r=await pool.query("insert into intel_actions(signal_id,client_id,program_id,action_type,title,rationale,payload) values($1,$2,$3,$4,$5,$6,$7) returning *",[o.signal_id,u.client_id,o.program_id,type,payload.title||("Create "+type),"Created from client opportunity decision workflow",JSON.stringify(payload)]);
  return r.rows[0];
});
app.post("/api/portal/actions/:id/approve",async function(req,reply){
  const u=await requirePortalUser(req,reply);
  if(!u) return;
  const q=await pool.query("select * from intel_actions where id=$1 and client_id=$2",[Number(req.params.id),u.client_id]);
  if(!q.rows[0]) return reply.code(404).send({error:"Action not found"});
  try{
    const result=await executeAction(q.rows[0]);
    await pool.query("update intel_actions set status=$1,executed_at=case when $2 then now() else executed_at end where id=$3",[result.executed?"executed":"approved",result.executed,q.rows[0].id]);
    return result;
  }catch(e){return reply.code(500).send({error:e.message})}
});

app.get("/health",async function(){return {ok:true,service:"Lucid Intelligence OS"}});
app.get("/api/dashboard",async function(){
  await cleanupStaleRuns();
  const all=await Promise.all([
    pool.query("select * from intel_clients order by name"),
    pool.query("select p.*,c.name client_name from intel_programs p join intel_clients c on c.id=p.client_id order by c.name,p.name"),
    pool.query("select s.*,c.name client_name,p.name program_name from intel_signals s join intel_clients c on c.id=s.client_id join intel_programs p on p.id=s.program_id order by s.created_at desc limit 80"),
    pool.query("select a.*,c.name client_name,s.title signal_title from intel_actions a join intel_clients c on c.id=a.client_id left join intel_signals s on s.id=a.signal_id order by a.created_at desc limit 120"),
    pool.query("select r.*,p.name program_name,c.name client_name from intel_runs r join intel_programs p on p.id=r.program_id join intel_clients c on c.id=r.client_id order by r.created_at desc limit 30"),
    pool.query("select o.*,c.name client_name,p.name program_name from intel_opportunities o join intel_clients c on c.id=o.client_id left join intel_programs p on p.id=o.program_id order by coalesce(o.deadline,'2999-12-31') asc,o.created_at desc limit 120")
  ]);
  return {clients:all[0].rows,programs:all[1].rows,signals:all[2].rows,actions:all[3].rows,runs:all[4].rows,opportunities:all[5].rows,aiConfigured:await hasAIKey()};
});
app.post("/api/clients",async function(req,reply){
  const b=req.body||{};
  if(!b.name) return reply.code(400).send({error:"Name required"});
  const r=await pool.query("insert into intel_clients(name,website_url,industry,geography,objective) values($1,$2,$3,$4,$5) returning *",[b.name,b.website_url||null,b.industry||null,b.geography||null,b.objective||null]);
  return r.rows[0];
});
app.get("/api/clients/:id",async function(req,reply){
  const id=Number(req.params.id);
  const all=await Promise.all([
    pool.query("select * from intel_clients where id=$1",[id]),
    pool.query("select * from intel_programs where client_id=$1 order by name",[id]),
    pool.query("select * from intel_signals where client_id=$1 order by created_at desc limit 80",[id]),
    pool.query("select * from intel_actions where client_id=$1 order by created_at desc limit 120",[id]),
    pool.query("select id,client_id,connector_type,name,status,created_at from intel_connectors where client_id=$1 order by created_at",[id]),
    pool.query("select * from intel_opportunities where client_id=$1 order by coalesce(deadline,'2999-12-31') asc,created_at desc",[id]),
    pool.query("select id,client_id,email,name,active,last_login_at,created_at from intel_client_users where client_id=$1 order by email",[id]),
    pool.query("select brief_enabled,urgent_enabled,updated_at from intel_delivery_settings where client_id=$1",[id]),
    pool.query("select status,sent_at,new_signal_count,open_action_count,open_opportunity_count,error from intel_brief_deliveries where client_id=$1 order by sent_at desc limit 8",[id])
  ]);
  if(!all[0].rows[0]) return reply.code(404).send({error:"Not found"});
  return {client:all[0].rows[0],programs:all[1].rows,signals:all[2].rows,actions:all[3].rows,connectors:all[4].rows,opportunities:all[5].rows,portalUsers:all[6].rows,delivery:all[7].rows[0]||{brief_enabled:true,urgent_enabled:true},briefHistory:all[8].rows};
});
app.post("/api/clients/:id/portal-users",async function(req,reply){
  const clientId=Number(req.params.id);
  const b=req.body||{};
  const email=String(b.email||"").trim().toLowerCase();
  const password=String(b.password||"");
  const name=String(b.name||"").trim();
  if(!email||!email.includes("@")) return reply.code(400).send({error:"Valid email required"});
  if(password.length<8) return reply.code(400).send({error:"Password must be at least 8 characters"});
  const exists=await pool.query("select id,client_id from intel_client_users where lower(email)=$1",[email]);
  if(exists.rows[0]&&Number(exists.rows[0].client_id)!==clientId) return reply.code(409).send({error:"That email is already assigned to another client"});
  const passHash=hashPassword(password);
  let r;
  if(exists.rows[0]) r=await pool.query("update intel_client_users set name=$1,password_hash=$2,active=true where id=$3 returning id,client_id,email,name,active,last_login_at,created_at",[name||null,passHash,exists.rows[0].id]);
  else r=await pool.query("insert into intel_client_users(client_id,email,name,password_hash) values($1,$2,$3,$4) returning id,client_id,email,name,active,last_login_at,created_at",[clientId,email,name||null,passHash]);
  return r.rows[0];
});
app.patch("/api/clients/:id/delivery",async function(req,reply){
  const id=Number(req.params.id),b=req.body||{};
  const brief=b.brief_enabled!==false,urgent=b.urgent_enabled!==false;
  const r=await pool.query("insert into intel_delivery_settings(client_id,brief_enabled,urgent_enabled,updated_at) values($1,$2,$3,now()) on conflict(client_id) do update set brief_enabled=excluded.brief_enabled,urgent_enabled=excluded.urgent_enabled,updated_at=now() returning *",[id,brief,urgent]);
  return r.rows[0];
});
app.post("/api/clients/:id/send-brief",async function(req,reply){
  try{return await sendDailyBriefs(Number(req.params.id))}catch(e){return reply.code(500).send({error:e.message})}
});
app.post("/api/opportunities/:id/status",async function(req,reply){
  const status=String((req.body||{}).status||"");
  if(!["review","pursue","pass"].includes(status)) return reply.code(400).send({error:"Invalid status"});
  const r=await pool.query("update intel_opportunities set pursuit_status=$1,updated_at=now() where id=$2 returning *",[status,Number(req.params.id)]);
  if(!r.rows[0]) return reply.code(404).send({error:"Opportunity not found"});
  return r.rows[0];
});

app.post("/api/programs",async function(req,reply){
  const b=req.body||{};
  if(!b.client_id||!b.name||!b.objective) return reply.code(400).send({error:"client_id, name and objective required"});
  const r=await pool.query("insert into intel_programs(client_id,name,program_type,cadence,objective,source_plan,action_plan,client_visible,analyst_instructions,delivery_settings) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *",[b.client_id,b.name,b.program_type||"custom",b.cadence||"weekly",b.objective,JSON.stringify(b.source_plan||[]),JSON.stringify(b.action_plan||["alert"]),b.client_visible!==false,b.analyst_instructions||null,JSON.stringify(b.delivery_settings||{})]);
  return r.rows[0];
});

app.get("/api/programs/:id",async function(req,reply){
  await cleanupStaleRuns();
  const id=Number(req.params.id);
  const all=await Promise.all([
    pool.query("select p.*,c.name client_name from intel_programs p join intel_clients c on c.id=p.client_id where p.id=$1",[id]),
    pool.query("select * from intel_runs where program_id=$1 order by created_at desc limit 30",[id]),
    pool.query("select * from intel_signals where program_id=$1 order by created_at desc limit 40",[id]),
    pool.query("select * from intel_actions where program_id=$1 order by created_at desc limit 40",[id])
  ]);
  if(!all[0].rows[0]) return reply.code(404).send({error:"Program not found"});
  return {program:all[0].rows[0],runs:all[1].rows,signals:all[2].rows,actions:all[3].rows};
});
app.patch("/api/programs/:id",async function(req,reply){
  const id=Number(req.params.id),b=req.body||{};
  const current=await pool.query("select * from intel_programs where id=$1",[id]);
  if(!current.rows[0]) return reply.code(404).send({error:"Program not found"});
  const p=current.rows[0];
  const r=await pool.query("update intel_programs set name=$1,program_type=$2,cadence=$3,objective=$4,source_plan=$5,action_plan=$6,active=$7,client_visible=$8,analyst_instructions=$9,delivery_settings=$10 where id=$11 returning *",[
    b.name??p.name,b.program_type??p.program_type,b.cadence??p.cadence,b.objective??p.objective,
    JSON.stringify(b.source_plan??p.source_plan??[]),JSON.stringify(b.action_plan??p.action_plan??[]),
    b.active===undefined?p.active:Boolean(b.active),b.client_visible===undefined?p.client_visible:Boolean(b.client_visible),
    b.analyst_instructions===undefined?p.analyst_instructions:b.analyst_instructions,
    JSON.stringify(b.delivery_settings??p.delivery_settings??{}),id
  ]);
  return r.rows[0];
});

app.post("/api/clients/:id/discover",async function(req,reply){
  const q=await pool.query("select * from intel_clients where id=$1",[Number(req.params.id)]);
  if(!q.rows[0]||!q.rows[0].website_url) return reply.code(400).send({error:"Client needs a website URL"});
  try{return await discover(q.rows[0])}catch(e){return reply.code(500).send({error:e.message})}
});
app.post("/api/briefs/send",async function(req,reply){
  if(!RUN_SECRET || req.headers["x-run-secret"]!==RUN_SECRET) return reply.code(401).send({error:"unauthorized"});
  try{return await sendDailyBriefs()}catch(e){return reply.code(500).send({error:e.message})}
});

app.post("/api/run",async function(req,reply){
  if(!RUN_SECRET || req.headers["x-run-secret"]!==RUN_SECRET) return reply.code(401).send({error:"unauthorized"});
  await cleanupStaleRuns();
  const q=await pool.query("select p.*,c.name client_name,c.website_url,c.industry,c.geography,c.objective client_objective,c.profile from intel_programs p join intel_clients c on c.id=p.client_id where p.active=true and (p.last_run_at is null or (p.cadence='hourly' and p.last_run_at < now()-interval '55 minutes') or (p.cadence in ('daily','weekday') and p.last_run_at < current_date) or (p.cadence='weekly' and p.last_run_at < now()-interval '6 days') or (p.cadence='monthly' and p.last_run_at < now()-interval '27 days')) order by p.id");
  const suppressUrgent=Boolean((req.body||{}).suppress_urgent);
  const queued=[];
  for(const p of q.rows){
    const existing=await pool.query("select id from intel_runs where program_id=$1 and status='running' and created_at>now()-interval '10 minutes' order by created_at desc limit 1",[p.id]);
    if(existing.rows[0]){queued.push({programId:p.id,runId:existing.rows[0].id,status:"already_running"});continue}
    const rr=await pool.query("insert into intel_runs(program_id,client_id,run_meta) values($1,$2,$3) returning id",[p.id,p.client_id,JSON.stringify({source_plan:p.source_plan||[],action_plan:p.action_plan||[],cadence:p.cadence,model:AI_MODEL,program_type:p.program_type,scheduled:true})]);
    queued.push({programId:p.id,runId:rr.rows[0].id,status:"queued",program:p});
  }
  const work=queued.filter(x=>x.status==="queued");
  setImmediate(async function(){
    for(const item of work){
      const p=item.program;
      const c={id:p.client_id,name:p.client_name,website_url:p.website_url,industry:p.industry,geography:p.geography,objective:p.client_objective,profile:p.profile};
      try{await runProgram(p,c,{runId:item.runId,suppressUrgent:suppressUrgent})}
      catch(e){app.log.error({err:e,runId:item.runId,programId:p.id},"scheduled intelligence run failed")}
    }
  });
  return reply.code(202).send({queued:work.length,alreadyRunning:queued.length-work.length,runs:queued.map(x=>({programId:x.programId,runId:x.runId,status:x.status}))});
});

app.get("/api/runs/:id",async function(req,reply){
  await cleanupStaleRuns();
  const q=await pool.query("select r.*,p.name program_name from intel_runs r join intel_programs p on p.id=r.program_id where r.id=$1",[Number(req.params.id)]);
  if(!q.rows[0]) return reply.code(404).send({error:"Run not found"});
  return q.rows[0];
});

app.post("/api/programs/:id/run",async function(req,reply){
  const q=await pool.query("select p.*,c.name client_name,c.website_url,c.industry,c.geography,c.objective client_objective,c.profile from intel_programs p join intel_clients c on c.id=p.client_id where p.id=$1",[Number(req.params.id)]);
  if(!q.rows[0]) return reply.code(404).send({error:"Not found"});
  const p=q.rows[0],c={id:p.client_id,name:p.client_name,website_url:p.website_url,industry:p.industry,geography:p.geography,objective:p.client_objective,profile:p.profile};
  const existing=await pool.query("select id from intel_runs where program_id=$1 and status='running' and created_at>now()-interval '15 minutes' order by created_at desc limit 1",[p.id]);
  if(existing.rows[0]) return reply.code(202).send({runId:existing.rows[0].id,status:"running",alreadyRunning:true});
  const rr=await pool.query("insert into intel_runs(program_id,client_id,run_meta) values($1,$2,$3) returning id",[p.id,c.id,JSON.stringify({source_plan:p.source_plan||[],action_plan:p.action_plan||[],cadence:p.cadence,model:AI_MODEL,program_type:p.program_type,manual:true})]);
  const runId=rr.rows[0].id;
  setImmediate(function(){
    runProgram(p,c,{runId:runId}).catch(function(e){app.log.error({err:e,runId:runId,programId:p.id},"manual intelligence run failed")});
  });
  return reply.code(202).send({runId:runId,status:"running"});
});
app.post("/api/actions/generate",async function(req,reply){
  const b=req.body||{};
  const q=await pool.query("select s.*,c.name client_name from intel_signals s join intel_clients c on c.id=s.client_id where s.id=$1",[b.signal_id]);
  const s=q.rows[0];
  if(!s) return reply.code(404).send({error:"Signal not found"});
  const type=b.action_type||"social_post";
  let payload={title:s.title,body:s.what_changed+"\n\nWhy it matters: "+s.why_it_matters,notes:"Connect OpenAI for tailored generation."};
  if(await hasAIKey()){
    const prompt="Create a ready-to-use "+type+" for "+s.client_name+" from this signal. Title: "+s.title+". What changed: "+s.what_changed+". Why it matters: "+s.why_it_matters+". Source: "+(s.source_url||"")+". Return only JSON with title, body and notes.";
    const out=parseJson(await openai(prompt,false));
    if(out) payload=out;
  }
  const r=await pool.query("insert into intel_actions(signal_id,client_id,program_id,action_type,title,rationale,payload) values($1,$2,$3,$4,$5,$6,$7) returning *",[s.id,s.client_id,s.program_id,type,payload.title||("Create "+type),"Generated directly from a material intelligence signal",JSON.stringify(payload)]);
  return r.rows[0];
});
app.post("/api/actions/:id/approve",async function(req,reply){
  const q=await pool.query("select * from intel_actions where id=$1",[Number(req.params.id)]);
  if(!q.rows[0]) return reply.code(404).send({error:"Not found"});
  try{
    const result=await executeAction(q.rows[0]);
    await pool.query("update intel_actions set status=$1,executed_at=case when $2 then now() else executed_at end where id=$3",[result.executed?"executed":"approved",result.executed,q.rows[0].id]);
    return result;
  }catch(e){return reply.code(500).send({error:e.message})}
});
app.post("/api/actions/:id/dismiss",async function(req){
  await pool.query("update intel_actions set status='dismissed' where id=$1",[Number(req.params.id)]);
  return {ok:true};
});
app.get("/api/settings/status",async function(){
  const key=await getAIKey(),email=await getEmailConfig(),dbEmailKey=await getSetting("resend_api_key");
  return {aiConfigured:Boolean(key),source:(await getSetting("openai_api_key"))?"dashboard":(ENV_AI_KEY?"environment":"none"),masked:key?("••••"+key.slice(-4)):"",emailConfigured:Boolean(email.key&&email.from),emailSource:dbEmailKey?"dashboard":(ENV_RESEND_KEY?"environment":"none"),emailMasked:email.key?("••••"+email.key.slice(-4)):"",emailFrom:email.from||""};
});
app.post("/api/settings/openai",async function(req,reply){
  if(!SETTINGS_CODE) return reply.code(503).send({error:"Settings access code is not configured"});
  if(req.headers["x-settings-code"]!==SETTINGS_CODE) return reply.code(401).send({error:"Invalid settings code"});
  const b=req.body||{};
  const key=String(b.api_key||"").trim();
  if(!/^sk-[A-Za-z0-9_-]{20,}$/.test(key)) return reply.code(400).send({error:"That does not look like a valid OpenAI API key"});
  try{
    const r=await fetch("https://api.openai.com/v1/models",{headers:{Authorization:"Bearer "+key}});
    if(!r.ok) return reply.code(400).send({error:"OpenAI rejected that API key"});
  }catch(e){return reply.code(502).send({error:"Could not verify the OpenAI API key"})}
  await setSetting("openai_api_key",key);
  return {ok:true,masked:"••••"+key.slice(-4)};
});
app.delete("/api/settings/openai",async function(req,reply){
  if(!SETTINGS_CODE) return reply.code(503).send({error:"Settings access code is not configured"});
  if(req.headers["x-settings-code"]!==SETTINGS_CODE) return reply.code(401).send({error:"Invalid settings code"});
  await pool.query("delete from intel_settings where setting_key='openai_api_key'");
  return {ok:true,aiConfigured:Boolean(ENV_AI_KEY)};
});

app.post("/api/settings/email",async function(req,reply){
  if(!SETTINGS_CODE) return reply.code(503).send({error:"Settings access code is not configured"});
  if(req.headers["x-settings-code"]!==SETTINGS_CODE) return reply.code(401).send({error:"Invalid settings code"});
  const b=req.body||{},key=String(b.api_key||"").trim(),from=String(b.from||"").trim();
  if(!key||key.length<20) return reply.code(400).send({error:"Enter a valid Resend API key"});
  if(!from||!from.includes("@")) return reply.code(400).send({error:"Enter a valid From address"});
  try{
    const r=await fetch("https://api.resend.com/domains",{headers:{Authorization:"Bearer "+key}});
    if(!r.ok) return reply.code(400).send({error:"Resend rejected that API key"});
  }catch{return reply.code(502).send({error:"Could not verify the Resend API key"})}
  await setSetting("resend_api_key",key);
  await setSetting("email_from",from);
  return {ok:true,masked:"••••"+key.slice(-4),from:from};
});
app.post("/api/settings/email/test",async function(req,reply){
  if(!SETTINGS_CODE) return reply.code(503).send({error:"Settings access code is not configured"});
  if(req.headers["x-settings-code"]!==SETTINGS_CODE) return reply.code(401).send({error:"Invalid settings code"});
  const to=String((req.body||{}).to||"").trim();
  if(!to||!to.includes("@")) return reply.code(400).send({error:"Enter a valid test email"});
  try{
    const sent=await sendEmail(to,"Lucid Logic Intelligence email test",'<div style="font-family:Arial,sans-serif"><h2>Email delivery is connected.</h2><p>Your Managed Intelligence daily briefs can now be delivered from the platform.</p></div>',"Email delivery is connected. Your Managed Intelligence daily briefs can now be delivered from the platform.");
    return {ok:true,id:sent.id||null};
  }catch(e){return reply.code(500).send({error:e.message})}
});

app.post("/api/connectors",async function(req,reply){
  const b=req.body||{};
  if(!b.client_id||!b.connector_type||!b.name) return reply.code(400).send({error:"client_id, connector_type and name required"});
  const r=await pool.query("insert into intel_connectors(client_id,connector_type,name,encrypted_config,status) values($1,$2,$3,$4,'configured') returning id,client_id,connector_type,name,status,created_at",[b.client_id,b.connector_type,b.name,encrypt(b.config||{})]);
  return r.rows[0];
});
app.setNotFoundHandler(function(req,reply){
  if(req.url.startsWith("/api/")) return reply.code(404).send({error:"Not found"});
  if(req.url.startsWith("/portal")) return reply.sendFile("portal.html");
  return reply.sendFile("index.html");
});

await init();
await app.listen({port:Number(process.env.PORT||8080),host:"0.0.0.0"});
