const q=s=>document.querySelector(s);
const qa=s=>Array.from(document.querySelectorAll(s));
const state={me:null,data:null,view:"overview",intelProgram:"all"};

function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function nice(v){return String(v||"").replaceAll("_"," ").replace(/\b\w/g,c=>c.toUpperCase())}
function ago(v){if(!v)return "Never";const n=(Date.now()-new Date(v).getTime())/1000;if(n<60)return "just now";if(n<3600)return Math.floor(n/60)+"m ago";if(n<86400)return Math.floor(n/3600)+"h ago";return new Date(v).toLocaleDateString()}
function toast(msg){const t=q("#toast");t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2500)}
async function api(url,opts={}){opts.headers=Object.assign({"Content-Type":"application/json"},opts.headers||{});const r=await fetch(url,opts);const d=await r.json().catch(()=>({}));if(!r.ok){const e=new Error(d.error||("Request failed "+r.status));e.status=r.status;throw e}return d}

function metric(label,value,sub,cls=""){return '<div class="metric '+cls+'"><div class="label">'+esc(label)+'</div><div class="value">'+esc(value)+'</div><div class="sub">'+esc(sub)+'</div></div>'}

function actionInfo(type){
  const map={
    proposal:{label:"Proposal Draft",icon:"▤",desc:"A proposal draft prepared from an opportunity."},
    questions:{label:"Questions to Ask",icon:"?",desc:"Questions prepared for an RFP, grant or pursuit."},
    website_post:{label:"Website Update",icon:"W",desc:"Content prepared for your website."},
    social_post:{label:"Social Post",icon:"#",desc:"A social post ready for review."},
    email_draft:{label:"Email Draft",icon:"@",desc:"An email prepared for your team to send."},
    outreach:{label:"Outreach Draft",icon:"↗",desc:"A prospect or account outreach draft."},
    brief:{label:"Brief",icon:"B",desc:"A concise intelligence brief."},
    alert:{label:"Alert",icon:"!",desc:"An item that needs attention."}
  };
  return map[type]||{label:nice(type||"Action"),icon:"✓",desc:"Recommended next step from Lucid Logic."};
}
function approvalLabel(type){
  if(type==="website_post"||type==="social_post") return "Approve & Publish";
  if(type==="proposal"||type==="questions"||type==="brief") return "Approve";
  return "Approve";
}

function intelligenceMeta(meta){
  if(!meta||typeof meta!=="object") return "";
  const preferred=["competitor","company","account","trigger","change_type","platform","metric","old_value","new_value","query","regulator","topic","effective_date","contact"];
  const keys=preferred.filter(k=>meta[k]!==undefined&&meta[k]!==null&&String(meta[k]).trim()!=="").slice(0,6);
  if(!keys.length) return "";
  return '<div class="intel-meta">'+keys.map(k=>'<div><span>'+esc(nice(k))+'</span><b>'+esc(typeof meta[k]==="object"?JSON.stringify(meta[k]):meta[k])+'</b></div>').join("")+'</div>';
}
function signalCard(s){
  const importance=s.importance>=3?"priority":"standard";
  return '<article class="intel-item '+importance+'">'+
    '<div class="intel-rail"><span></span></div>'+
    '<div class="intel-body"><div class="row"><div><div class="intel-kicker">'+esc(s.program_name||"Intelligence")+'</div><h3>'+esc(s.title)+'</h3></div><span class="confidence">'+esc(s.confidence||70)+'% confidence</span></div>'+
    '<div class="intel-section"><span>WHAT CHANGED</span><p>'+esc(s.what_changed)+'</p></div>'+
    intelligenceMeta(s.metadata)+
    '<div class="intel-section matter"><span>WHY IT MATTERS</span><p>'+esc(s.why_it_matters)+'</p></div>'+
    '<div class="intel-footer"><span>'+ago(s.created_at)+'</span>'+(s.source_url?'<a target="_blank" href="'+esc(s.source_url)+'">View source ↗</a>':'')+'</div></div></article>';
}

function actionCard(a){
  const p=a.payload||{};
  const info=actionInfo(a.action_type);
  const body=p.body||p.content||"";
  const note=p.notes||"";
  const pending=a.status==="proposed";
  return '<article class="action-card '+(pending?"needs-action":"done-action")+'">'+
    '<div class="action-icon">'+esc(info.icon)+'</div>'+
    '<div class="action-main"><div class="row"><div><div class="action-type">'+esc(info.label)+'</div><h3>'+esc(a.title)+'</h3></div><span class="status '+esc(a.status)+'">'+esc(nice(a.status))+'</span></div>'+
    '<p class="action-desc">'+esc(a.rationale||info.desc)+'</p>'+
    (body?'<div class="deliverable-preview"><div class="deliverable-label">PREPARED FOR YOU</div><div class="deliverable-body">'+esc(body)+'</div></div>':'')+
    (note?'<p class="note">'+esc(note)+'</p>':'')+
    (pending?'<div class="actions"><button class="btn gold small" onclick="approveAction('+a.id+')">'+esc(approvalLabel(a.action_type))+'</button></div>':'')+
    '<div class="action-time">'+ago(a.created_at)+'</div></div></article>';
}

function opportunityCard(o){
  const source=o.document_url||o.source_url||"";
  const due=o.deadline?new Date(o.deadline+"T12:00:00").toLocaleDateString():"Not found";
  const qaDue=o.qa_deadline?new Date(o.qa_deadline+"T12:00:00").toLocaleDateString():"Not found";
  const reqs=Array.isArray(o.requirements)&&o.requirements.length?'<div class="opp-req"><b>Key requirements</b><ul>'+o.requirements.slice(0,8).map(r=>'<li>'+esc(typeof r==="string"?r:JSON.stringify(r))+'</li>').join("")+'</ul></div>':"";
  return '<article class="opportunity-card"><div class="row"><div><div class="meta"><span>'+esc(nice(o.opportunity_type||"opportunity"))+'</span><span>•</span><span>'+esc(nice(o.pursuit_status))+'</span></div><h3>'+esc(o.title)+'</h3></div><div class="fit-score"><strong>'+esc(o.fit_score||0)+'</strong><span>FIT</span></div></div>'+
  '<p>'+esc(o.summary||"")+'</p><div class="opp-meta"><div><span>Proposal due</span><b>'+esc(due)+'</b></div><div><span>Q&A due</span><b>'+esc(qaDue)+'</b></div><div><span>Est. value</span><b>'+esc(o.estimated_value||"Unknown")+'</b></div><div><span>Geography</span><b>'+esc(o.geography||"Unknown")+'</b></div></div>'+
  (o.recommendation?'<div class="why"><b>Lucid Logic recommendation:</b> '+esc(o.recommendation)+'</div>':'')+reqs+
  '<div class="actions">'+(source?'<a class="btn small" target="_blank" href="'+esc(source)+'">View RFP / source ↗</a>':'')+
  '<button class="btn small" onclick="setOpp('+o.id+',\'pursue\')">Pursue</button><button class="btn small danger" onclick="setOpp('+o.id+',\'pass\')">Pass</button>'+
  '<button class="btn small" onclick="generateOpp('+o.id+',\'questions\')">Generate Questions</button><button class="btn gold small" onclick="generateOpp('+o.id+',\'proposal\')">Build Proposal</button></div></article>';
}

function priorityRow(kind,title,sub,action,label){
  return '<button class="priority-row" onclick="'+action+'"><div class="priority-kind">'+esc(kind)+'</div><div class="priority-copy"><b>'+esc(title)+'</b><span>'+esc(sub)+'</span></div><div class="priority-go">'+esc(label)+' →</div></button>';
}

function hasOpportunityProgram(){
  return state.data.programs.some(p=>p.program_type==="opportunity");
}
function overview(){
  const d=state.data;
  const hasOpp=hasOpportunityProgram();
  const open=hasOpp?d.opportunities.filter(o=>o.pursuit_status!=="pass"):[];
  const pending=d.actions.filter(a=>a.status==="proposed");
  const newIntel=d.signals.filter(s=>Date.now()-new Date(s.created_at).getTime()<7*86400000);
  const topOpp=hasOpp?open[0]:null;
  const topAction=pending[0];
  const topIntel=d.signals[0];
  const priorities=[
    topOpp?priorityRow("OPPORTUNITY",topOpp.title,(topOpp.deadline?"Due "+new Date(topOpp.deadline+"T12:00:00").toLocaleDateString():"Review fit and decide whether to pursue"),"go('opportunities')","Review"):null,
    topAction?priorityRow("ACTION",topAction.title,actionInfo(topAction.action_type).desc,"go('actions')","Open"):null,
    topIntel?priorityRow("NEW INTELLIGENCE",topIntel.title,topIntel.why_it_matters,"go('intelligence')","Read"):null
  ].filter(Boolean).join("");
  const programs=d.programs.map(p=>'<div class="watch-item"><div class="watch-dot"></div><div><b>'+esc(p.name)+'</b><span>'+esc(p.cadence)+' monitoring · '+esc(nice(p.program_type))+'</span></div></div>').join("");
  const metrics=(hasOpp?metric("Open opportunities",open.length,"RFPs, grants and pursuits","accent"):"")+
    metric("Needs your approval",pending.length,"Prepared actions waiting on you")+
    metric("New intelligence",newIntel.length,"Material findings in the last 7 days")+
    metric("Active monitors",d.programs.length,"Areas Lucid Logic is continuously watching");

  return '<div class="welcome"><div><p class="eyebrow">MANAGED FOR '+esc(state.me.client.name.toUpperCase())+'</p><h2>What needs your attention</h2><p>Lucid Logic is monitoring in the background. You only need to come here when something matters or a decision is needed.</p></div></div>'+
  '<div class="metrics '+(hasOpp?"":"metrics-three")+'">'+metrics+'</div>'+
  '<div class="overview-grid"><div class="panel priority-panel"><div class="panel-head"><div><h2>Priority inbox</h2><p class="muted">The few things worth looking at now.</p></div></div>'+(priorities||'<div class="empty">Nothing needs your attention right now.</div>')+'</div>'+
  '<div class="panel watch-panel"><div class="panel-head"><div><h2>What we are watching</h2><p class="muted">You do not need to manage these. Lucid Logic does.</p></div></div>'+programs+'</div></div>';
}

function opportunities(){
  const active=state.data.opportunities.filter(o=>o.pursuit_status!=="pass");
  const passed=state.data.opportunities.filter(o=>o.pursuit_status==="pass");
  return '<div class="page-intro"><div class="page-icon">◆</div><div><h2>Opportunities</h2><p>Revenue opportunities that require an actual pursuit decision. The RFP or source, deadlines, fit analysis and next steps live here.</p></div></div>'+
  '<div class="panel opportunities-panel"><div class="section-label">ACTIVE</div>'+(active.map(opportunityCard).join("")||'<div class="empty">No active opportunities.</div>')+
  (passed.length?'<div class="section-label passed-label">PASSED</div>'+passed.map(opportunityCard).join(""):'')+'</div>';
}

function intelligence(){
  const programs=state.data.programs.filter(p=>p.program_type!=="opportunity");
  const allowedIds=new Set(programs.map(p=>String(p.id)));
  let items=state.data.signals.filter(sig=>sig.program_type!=="opportunity"||allowedIds.has(String(sig.program_id)));
  if(state.intelProgram!=="all") items=items.filter(sig=>String(sig.program_id)===String(state.intelProgram));
  const tabs='<div class="intel-filters"><button class="intel-filter '+(state.intelProgram==="all"?"active":"")+'" onclick="setIntelProgram(\'all\')">All Intelligence <span>'+state.data.signals.filter(sig=>sig.program_type!=="opportunity").length+'</span></button>'+
    programs.map(p=>'<button class="intel-filter '+(String(state.intelProgram)===String(p.id)?"active":"")+'" onclick="setIntelProgram(\''+p.id+'\')">'+esc(p.name)+' <span>'+state.data.signals.filter(sig=>String(sig.program_id)===String(p.id)).length+'</span></button>').join("")+'</div>';
  return '<div class="page-intro intel-intro"><div class="page-icon">◉</div><div><h2>Intelligence</h2><p>This is what Lucid Logic found and why it matters. Filter by the intelligence program you care about, or view everything together.</p></div></div>'+
  tabs+'<div class="intel-feed">'+(items.map(signalCard).join("")||'<div class="empty">No intelligence items in this view yet.</div>')+'</div>';
}
window.setIntelProgram=function(id){state.intelProgram=String(id);render()};

function actions(){
  const pending=state.data.actions.filter(a=>a.status==="proposed");
  const finished=state.data.actions.filter(a=>a.status!=="proposed");
  return '<div class="page-intro action-intro"><div class="page-icon">✓</div><div><h2>Action Center</h2><p>This is where intelligence becomes something useful. Review proposals, question sets, outreach, website content and other work prepared for you.</p></div></div>'+
  '<div class="action-layout"><section><div class="action-section-head"><div><span>NEEDS YOUR APPROVAL</span><h2>Ready for your decision</h2></div><div class="count-badge">'+pending.length+'</div></div>'+
  (pending.map(actionCard).join("")||'<div class="empty">Nothing is waiting on you.</div>')+'</section>'+
  '<section><div class="action-section-head completed"><div><span>HISTORY</span><h2>Approved & completed</h2></div></div>'+
  (finished.map(actionCard).join("")||'<div class="empty">No completed actions yet.</div>')+'</section></div>';
}

const titles={overview:"Overview",opportunities:"Opportunities",intelligence:"Intelligence",actions:"Action Center"};
const views={overview,opportunities,intelligence,actions};
function configureNavigation(){
  const oppNav=q('.nav[data-view="opportunities"]');
  const hasOpp=hasOpportunityProgram();
  if(oppNav) oppNav.classList.toggle("hidden",!hasOpp);
  if(!hasOpp&&state.view==="opportunities") state.view="overview";
}
function render(){
  configureNavigation();
  q("#pageTitle").textContent=titles[state.view]||"Overview";
  qa(".nav").forEach(n=>n.classList.toggle("active",n.dataset.view===state.view));
  q("#view").innerHTML=views[state.view]();
}
window.go=v=>{state.view=v;render()};
qa(".nav").forEach(n=>n.onclick=()=>go(n.dataset.view));

async function start(){
  try{
    state.me=await api("/api/portal/me");
    state.data=await api("/api/portal/dashboard");
    q("#clientName").textContent=state.me.client.name;
    q("#userName").textContent=state.me.user.name||state.me.user.email;
    q("#loginScreen").classList.add("hidden");
    q("#portalApp").classList.remove("hidden");
    render();
  }catch(e){
    if(e.status===401){showLogin();return}
    showLogin(e.message);
  }
}
function showLogin(msg){
  q("#portalApp").classList.add("hidden");
  q("#loginScreen").classList.remove("hidden");
  q("#loginError").textContent=msg&&msg!=="login_required"?msg:"";
}
q("#loginForm").onsubmit=async e=>{e.preventDefault();q("#loginError").textContent="";try{await api("/api/portal/login",{method:"POST",body:JSON.stringify({email:q("#loginEmail").value,password:q("#loginPassword").value})});await start()}catch(x){q("#loginError").textContent=x.message}};
q("#logoutBtn").onclick=async()=>{await api("/api/portal/logout",{method:"POST",body:"{}"}).catch(()=>{});showLogin()};
window.setOpp=async(id,status)=>{try{await api("/api/portal/opportunities/"+id+"/status",{method:"POST",body:JSON.stringify({status})});toast(status==="pursue"?"Marked for pursuit":"Opportunity passed");state.data=await api("/api/portal/dashboard");render()}catch(e){toast(e.message)}};
window.generateOpp=async(id,type)=>{try{await api("/api/portal/opportunities/"+id+"/generate",{method:"POST",body:JSON.stringify({action_type:type})});toast(type==="proposal"?"Proposal draft created":"Question set created");state.data=await api("/api/portal/dashboard");state.view="actions";render()}catch(e){toast(e.message)}};
window.approveAction=async id=>{try{const r=await api("/api/portal/actions/"+id+"/approve",{method:"POST",body:"{}"});toast(r.message||"Approved");state.data=await api("/api/portal/dashboard");render()}catch(e){toast(e.message)}};
start();