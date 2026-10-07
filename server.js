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
"create index if not exists ix_client_sessions_expiry on intel_client_sessions(expires_at)"
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
  if(req.url.startsWith("/api/run") && RUN_SECRET && req.headers["x-run-secret"]===RUN_SECRET) return;
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
async function openai(prompt,useWeb){
  const key=await getAIKey();
  if(!key) return null;
  const body={model:AI_MODEL,input:prompt,tools:useWeb?[{type:"web_search"}]:[]};
  const r=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify(body)});
  if(!r.ok) throw new Error("OpenAI "+r.status+": "+(await r.text()).slice(0,300));
  const d=await r.json();
  if(d.output_text) return d.output_text;
  const out=[];
  for(const o of d.output||[]) for(const c of o.content||[]) if(c.text) out.push(c.text);
  return out.join("\n");
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
  const s=await pool.query("insert into intel_signals(program_id,client_id,title,what_changed,why_it_matters,source_name,source_url,importance,confidence) values((select id from intel_programs where client_id=$1 and program_type='opportunity'),$1,$2,$3,$4,$5,$6,3,88) returning id",[id,"Regional website modernization RFP identified","A regional organization posted a website redesign and digital strategy opportunity with a multi-week response window.","It matches Lucid Logic capabilities and has enough lead time to qualify before spending proposal effort.","Demo source","https://example.com/rfp"]);
  await pool.query("insert into intel_actions(signal_id,client_id,program_id,action_type,title,rationale,payload) values($1,$2,(select id from intel_programs where client_id=$2 and program_type='opportunity'),'proposal',$3,$4,$5)",[s.rows[0].id,id,"Generate first-pass proposal","Move a qualified opportunity directly from detection to pursuit readiness",JSON.stringify({deliverable:"Proposal starter",sections:["Executive summary","Need","Approach","Timeline","Relevant experience","Questions"]})]);
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
async function runProgram(program,client){
  const rr=await pool.query("insert into intel_runs(program_id,client_id) values($1,$2) returning id",[program.id,client.id]);
  const runId=rr.rows[0].id;
  if(!(await hasAIKey())){
    await pool.query("update intel_runs set status='needs_configuration',summary='Add the OpenAI API key in Settings to enable live research runs.',finished_at=now() where id=$1",[runId]);
    return {runId,status:"needs_configuration"};
  }
  try{
    const prompt="Act as Lucid Logic's managed intelligence analyst. Research the public web for material developments relevant to this client and program.\nCLIENT: "+client.name+"; website "+(client.website_url||"")+"; industry "+(client.industry||"")+"; geography "+(client.geography||"")+"; objective "+(client.objective||"")+".\nPROGRAM: "+program.name+"; type "+program.program_type+"; objective "+program.objective+"; emphasize "+JSON.stringify(program.source_plan)+"; permitted actions "+JSON.stringify(program.action_plan)+".\nFind at most 6 genuinely material recent signals. Avoid routine news and duplicates. For opportunities assess fit, geography, estimated practical value, proposal deadline, Q&A deadline, source document and lead time. Every signal needs an action. Return ONLY JSON with summary and signals. Each signal must include title, what_changed, why_it_matters, source_name, source_url, signal_date, importance 1-3, confidence 0-100, actions with type,title,rationale,payload, and when program type is opportunity include opportunity with opportunity_type, fit_score 0-100, recommendation, deadline YYYY-MM-DD or null, qa_deadline YYYY-MM-DD or null, estimated_value, geography, requirements array, and document_url.";
    const out=parseJson(await openai(prompt,true));
    if(!out||!Array.isArray(out.signals)) throw new Error("Research response did not contain signals");
    for(const s of out.signals.slice(0,6)){
      const ins=await pool.query("insert into intel_signals(run_id,program_id,client_id,title,what_changed,why_it_matters,source_name,source_url,signal_date,importance,confidence) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id",[runId,program.id,client.id,s.title,s.what_changed,s.why_it_matters,s.source_name,s.source_url,s.signal_date||null,s.importance||2,s.confidence||70]);
      if(program.program_type==="opportunity"){
        const o=s.opportunity||{};
        await pool.query("insert into intel_opportunities(signal_id,client_id,program_id,title,summary,source_name,source_url,document_url,opportunity_type,fit_score,recommendation,deadline,qa_deadline,estimated_value,geography,requirements) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) on conflict(signal_id) do update set title=excluded.title,summary=excluded.summary,source_name=excluded.source_name,source_url=excluded.source_url,document_url=excluded.document_url,opportunity_type=excluded.opportunity_type,fit_score=excluded.fit_score,recommendation=excluded.recommendation,deadline=excluded.deadline,qa_deadline=excluded.qa_deadline,estimated_value=excluded.estimated_value,geography=excluded.geography,requirements=excluded.requirements,updated_at=now()",[ins.rows[0].id,client.id,program.id,s.title,s.what_changed,s.source_name,s.source_url,o.document_url||s.source_url,o.opportunity_type||"rfp",o.fit_score||s.confidence||70,o.recommendation||s.why_it_matters,o.deadline||null,o.qa_deadline||null,o.estimated_value||null,o.geography||client.geography||null,JSON.stringify(o.requirements||[])]);
      }
      for(const a of s.actions||[]) await pool.query("insert into intel_actions(signal_id,client_id,program_id,action_type,title,rationale,payload) values($1,$2,$3,$4,$5,$6,$7)",[ins.rows[0].id,client.id,program.id,a.type,a.title,a.rationale||"",JSON.stringify(a.payload||{})]);
    }
    await pool.query("update intel_programs set last_run_at=now() where id=$1",[program.id]);
    await pool.query("update intel_runs set status='done',summary=$1,finished_at=now() where id=$2",[out.summary||"",runId]);
    return {runId,status:"done",count:out.signals.length};
  }catch(e){
    await pool.query("update intel_runs set status='failed',summary=$1,finished_at=now() where id=$2",[String(e.message||e),runId]);
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
    pool.query("select s.*,p.name program_name from intel_signals s join intel_programs p on p.id=s.program_id where s.client_id=$1 order by s.created_at desc limit 80",[id]),
    pool.query("select * from intel_opportunities where client_id=$1 order by case pursuit_status when 'pursue' then 0 when 'review' then 1 else 2 end,coalesce(deadline,'2999-12-31') asc,created_at desc",[id]),
    pool.query("select a.*,s.title signal_title from intel_actions a left join intel_signals s on s.id=a.signal_id where a.client_id=$1 order by a.created_at desc limit 120",[id]),
    pool.query("select id,name,program_type,cadence,objective,last_run_at from intel_programs where client_id=$1 and active=true order by name",[id])
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
    pool.query("select id,client_id,email,name,active,last_login_at,created_at from intel_client_users where client_id=$1 order by email",[id])
  ]);
  if(!all[0].rows[0]) return reply.code(404).send({error:"Not found"});
  return {client:all[0].rows[0],programs:all[1].rows,signals:all[2].rows,actions:all[3].rows,connectors:all[4].rows,opportunities:all[5].rows,portalUsers:all[6].rows};
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
  const r=await pool.query("insert into intel_programs(client_id,name,program_type,cadence,objective,source_plan,action_plan) values($1,$2,$3,$4,$5,$6,$7) returning *",[b.client_id,b.name,b.program_type||"custom",b.cadence||"weekly",b.objective,JSON.stringify(b.source_plan||[]),JSON.stringify(b.action_plan||["alert"])]);
  return r.rows[0];
});

app.post("/api/clients/:id/discover",async function(req,reply){
  const q=await pool.query("select * from intel_clients where id=$1",[Number(req.params.id)]);
  if(!q.rows[0]||!q.rows[0].website_url) return reply.code(400).send({error:"Client needs a website URL"});
  try{return await discover(q.rows[0])}catch(e){return reply.code(500).send({error:e.message})}
});
app.post("/api/run",async function(req,reply){
  if(!RUN_SECRET || req.headers["x-run-secret"]!==RUN_SECRET) return reply.code(401).send({error:"unauthorized"});
  const q=await pool.query("select p.*,c.name client_name,c.website_url,c.industry,c.geography,c.objective client_objective,c.profile from intel_programs p join intel_clients c on c.id=p.client_id where p.active=true and (p.last_run_at is null or (p.cadence in ('daily','weekday') and p.last_run_at < current_date) or (p.cadence='weekly' and p.last_run_at < now()-interval '6 days') or (p.cadence='monthly' and p.last_run_at < now()-interval '27 days')) order by p.id");
  const results=[];
  for(const p of q.rows){
    const c={id:p.client_id,name:p.client_name,website_url:p.website_url,industry:p.industry,geography:p.geography,objective:p.client_objective,profile:p.profile};
    try{results.push({programId:p.id,result:await runProgram(p,c)})}catch(e){results.push({programId:p.id,error:String(e.message||e)})}
  }
  return {ran:results.length,results:results};
});

app.post("/api/programs/:id/run",async function(req,reply){
  const q=await pool.query("select p.*,c.name client_name,c.website_url,c.industry,c.geography,c.objective client_objective,c.profile from intel_programs p join intel_clients c on c.id=p.client_id where p.id=$1",[Number(req.params.id)]);
  if(!q.rows[0]) return reply.code(404).send({error:"Not found"});
  const p=q.rows[0],c={id:p.client_id,name:p.client_name,website_url:p.website_url,industry:p.industry,geography:p.geography,objective:p.client_objective,profile:p.profile};
  try{return await runProgram(p,c)}catch(e){return reply.code(500).send({error:e.message})}
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
  const key=await getAIKey();
  return {aiConfigured:Boolean(key),source:(await getSetting("openai_api_key"))?"dashboard":(ENV_AI_KEY?"environment":"none"),masked:key?("••••"+key.slice(-4)):""};
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
