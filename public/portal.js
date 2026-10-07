const q=s=>document.querySelector(s);
const qa=s=>Array.from(document.querySelectorAll(s));
const state={me:null,data:null,view:"overview"};

function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function nice(v){return String(v||"").replaceAll("_"," ").replace(/\b\w/g,c=>c.toUpperCase())}
function ago(v){if(!v)return "Never";const n=(Date.now()-new Date(v).getTime())/1000;if(n<60)return "just now";if(n<3600)return Math.floor(n/60)+"m ago";if(n<86400)return Math.floor(n/3600)+"h ago";return new Date(v).toLocaleDateString()}
function toast(msg){const t=q("#toast");t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2500)}
async function api(url,opts={}){opts.headers=Object.assign({"Content-Type":"application/json"},opts.headers||{});const r=await fetch(url,opts);const d=await r.json().catch(()=>({}));if(!r.ok){const e=new Error(d.error||("Request failed "+r.status));e.status=r.status;throw e}return d}
function metric(label,value,sub){return '<div class="metric"><div class="label">'+esc(label)+'</div><div class="value">'+esc(value)+'</div><div class="sub">'+esc(sub)+'</div></div>'}
function signalCard(s){return '<article class="signal"><div class="signal-title">'+esc(s.title)+'</div><div class="meta"><span>'+esc(s.program_name||"")+'</span><span>•</span><span>'+ago(s.created_at)+'</span><span class="pill">'+esc(s.confidence||70)+'% confidence</span></div><p>'+esc(s.what_changed)+'</p><div class="why"><b>Why it matters:</b> '+esc(s.why_it_matters)+'</div>'+(s.source_url?'<div class="actions"><a class="btn small" target="_blank" href="'+esc(s.source_url)+'">View source ↗</a></div>':'')+'</article>'}
function actionCard(a){
  const p=a.payload||{};
  return '<article class="action"><div class="row"><div><div class="signal-title">'+esc(a.title)+'</div><div class="meta"><span class="pill gold">'+esc(nice(a.action_type))+'</span><span>•</span><span>'+ago(a.created_at)+'</span></div></div><span class="pill">'+esc(nice(a.status))+'</span></div>'+
  (a.rationale?'<p class="muted">'+esc(a.rationale)+'</p>':'')+(p.body?'<div class="code">'+esc(p.body)+'</div>':'')+
  (a.status==="proposed"?'<div class="actions"><button class="btn gold small" onclick="approveAction('+a.id+')">Approve / Execute</button></div>':'')+'</article>';
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
  '<button class="btn small" onclick="generateOpp('+o.id+',\'questions\')">Generate questions</button><button class="btn gold small" onclick="generateOpp('+o.id+',\'proposal\')">Build proposal</button></div></article>';
}
function overview(){
  const d=state.data;
  const open=d.opportunities.filter(o=>o.pursuit_status!=="pass");
  const pending=d.actions.filter(a=>a.status==="proposed");
  return '<div class="metrics">'+metric("Open opportunities",open.length,"RFPs, grants and pursuits")+metric("Actions waiting",pending.length,"Your approval is needed")+metric("Intel programs",d.programs.length,"What Lucid Logic is watching")+metric("Recent signals",d.signals.length,"Material changes surfaced")+'</div>'+
  '<div class="grid"><div><div class="panel"><div class="panel-head"><h2>Priority opportunities</h2><button class="btn small" onclick="go(\'opportunities\')">View all</button></div>'+(open.slice(0,3).map(opportunityCard).join("")||'<div class="empty">No active opportunities right now.</div>')+'</div>'+
  '<div class="panel"><div class="panel-head"><h2>Latest signals</h2><button class="btn small" onclick="go(\'signals\')">View all</button></div>'+(d.signals.slice(0,4).map(signalCard).join("")||'<div class="empty">No signals yet.</div>')+'</div></div>'+
  '<div><div class="panel"><div class="panel-head"><h2>Needs your decision</h2><button class="btn small" onclick="go(\'actions\')">Action queue</button></div>'+(pending.slice(0,5).map(actionCard).join("")||'<div class="empty">Nothing waiting for approval.</div>')+'</div>'+
  '<div class="panel"><h2>Managed Intelligence</h2><p class="muted">Lucid Logic monitors the information your business cannot afford to miss, analyzes what changed, and turns important developments into specific actions for your team.</p></div></div></div>';
}
function opportunities(){const a=state.data.opportunities.filter(o=>o.pursuit_status!=="pass"),p=state.data.opportunities.filter(o=>o.pursuit_status==="pass");return '<div class="panel"><div class="panel-head"><div><h2>Opportunity workspace</h2><p class="muted">Review the source, deadlines, fit and recommended next step. Then decide whether to pursue.</p></div></div>'+(a.map(opportunityCard).join("")||'<div class="empty">No active opportunities.</div>')+(p.length?'<h3 style="margin-top:28px">Passed</h3>'+p.map(opportunityCard).join(""):'')+'</div>'}
function signals(){return '<div class="panel"><div class="panel-head"><h2>Signal feed</h2></div>'+(state.data.signals.map(signalCard).join("")||'<div class="empty">No signals yet.</div>')+'</div>'}
function actions(){const proposed=state.data.actions.filter(a=>a.status==="proposed"),done=state.data.actions.filter(a=>a.status!=="proposed");return '<div class="panel"><div class="panel-head"><div><h2>Action queue</h2><p class="muted">Approve the work Lucid Logic has prepared or generated from an intelligence signal.</p></div></div>'+(proposed.map(actionCard).join("")||'<div class="empty">Nothing waiting for approval.</div>')+(done.length?'<h3 style="margin-top:28px">Completed / approved</h3>'+done.map(actionCard).join(""):'')+'</div>'}
function documents(){const docs=state.data.actions.filter(a=>["proposal","questions","email_draft","outreach","brief","website_post","social_post"].includes(a.action_type));return '<div class="panel"><div class="panel-head"><div><h2>Work Product</h2><p class="muted">Proposals, question sets, outreach, briefs and content created from your intelligence.</p></div></div>'+(docs.map(actionCard).join("")||'<div class="empty">No generated work product yet.</div>')+'</div>'}
const titles={overview:"Overview",opportunities:"Opportunities",signals:"Signals",actions:"Actions",documents:"Work Product"};
const views={overview,opportunities,signals,actions,documents};
function render(){q("#pageTitle").textContent=titles[state.view]||"Overview";qa(".nav").forEach(n=>n.classList.toggle("active",n.dataset.view===state.view));q("#view").innerHTML=views[state.view]()}
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
window.generateOpp=async(id,type)=>{try{await api("/api/portal/opportunities/"+id+"/generate",{method:"POST",body:JSON.stringify({action_type:type})});toast(type==="proposal"?"Proposal work created":"Question set created");state.data=await api("/api/portal/dashboard");state.view="actions";render()}catch(e){toast(e.message)}};
window.approveAction=async id=>{try{const r=await api("/api/portal/actions/"+id+"/approve",{method:"POST",body:"{}"});toast(r.message||"Approved");state.data=await api("/api/portal/dashboard");render()}catch(e){toast(e.message)}};
start();