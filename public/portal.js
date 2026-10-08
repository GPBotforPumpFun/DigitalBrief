const q=s=>document.querySelector(s);
const qa=s=>Array.from(document.querySelectorAll(s));
const state={me:null,data:null,view:"overview",intelProgram:"all",oppSort:"fit",oppStatus:"active"};

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
    alert:{label:"Alert",icon:"!",desc:"An item that needs attention."},
    client_outreach:{label:"Client Outreach",icon:"↗",desc:"Reach out to existing clients with a timely offer or recommendation."},
    prospect_outreach:{label:"Prospect Outreach",icon:"↗",desc:"Use the intelligence to create a timely sales conversation."},
    service_offer:{label:"Service Opportunity",icon:"$",desc:"Package this intelligence into a concrete service offer."},
    risk_response:{label:"Risk Response",icon:"!",desc:"Take a concrete step to reduce material business risk."},
    account_followup:{label:"Account Follow-up",icon:"@",desc:"Follow up with a specific account based on a trigger event."},
    reputation_response:{label:"Reputation Response",icon:"★",desc:"Take a concrete action to improve or protect reputation."},
    other:{label:"Recommended Action",icon:"✓",desc:"A prioritized next step from Lucid Logic."}
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
  return '<article id="signal-'+s.id+'" class="intel-item '+importance+'">'+
    '<div class="intel-rail"><span></span></div>'+
    '<div class="intel-body"><div class="row"><div><div class="intel-kicker">'+esc(s.program_name||"Intelligence")+'</div><h3>'+esc(s.title)+'</h3></div><span class="confidence">'+esc(s.confidence||70)+'% confidence</span></div>'+
    '<div class="intel-section"><span>WHAT CHANGED</span><p>'+esc(s.what_changed)+'</p></div>'+
    intelligenceMeta(s.metadata)+
    '<div class="intel-section matter"><span>WHY IT MATTERS</span><p>'+esc(s.why_it_matters)+'</p></div>'+
    '<div class="intel-footer"><span>'+ago(s.created_at)+'</span>'+(s.source_url?'<a target="_blank" href="'+esc(s.source_url)+'">View source ↗</a>':'')+'</div></div></article>';
}

function canAutoExecute(a){
  const types=(state.data.connectors||[]).map(c=>c.connector_type);
  if(a.action_type==="website_post") return types.includes("wordpress")||types.includes("webhook");
  if(a.action_type==="social_post") return types.includes("social_webhook");
  return false;
}
function actionDecisionLabel(a){
  if(canAutoExecute(a)&&a.action_type==="website_post") return "Approve & Send to Website";
  if(canAutoExecute(a)&&a.action_type==="social_post") return "Approve & Publish";
  return "Request Lucid Logic Action";
}
function actionStatusMessage(a){
  if(a.status==="requested") return '<div class="managed-status requested"><b>Requested from Lucid Logic</b><span>Lucid Logic owns the next step. Nothing has been marked complete yet.</span></div>';
  if(a.status==="in_progress") return '<div class="managed-status progress"><b>In progress with Lucid Logic</b><span>This work is underway and will remain here until it is marked complete.</span></div>';
  if(a.status==="executed") return '<div class="managed-status complete"><b>Executed through a connected system</b><span>The connected channel completed this action.</span></div>';
  if(a.status==="completed") return '<div class="managed-status complete"><b>Completed by Lucid Logic</b><span>This managed action has been marked complete.</span></div>';
  return "";
}
function actionCard(a){
  const p=a.payload||{};
  const info=actionInfo(a.action_type);
  const body=p.body||p.content||"";
  const note=p.notes||"";
  const pending=a.status==="proposed";
  const tactics=Array.isArray(p.supporting_tactics)&&p.supporting_tactics.length
    ?'<div class="supporting-tactics"><span>SUPPORTING TACTICS</span><ul>'+p.supporting_tactics.slice(0,5).map(t=>'<li>'+esc(typeof t==="string"?t:JSON.stringify(t))+'</li>').join("")+'</ul></div>'
    :"";
  const context=a.signal_title?'<div class="action-context"><span>SOURCE INTELLIGENCE</span><b>'+esc(a.signal_title)+'</b>'+(a.signal_what_changed?'<p>'+esc(a.signal_what_changed)+'</p>':'')+'</div>':"";
  const outcome=a.business_outcome||p.business_outcome||"";
  const audience=a.target_audience||p.target_audience||"";
  return '<article id="action-'+a.id+'" class="action-card '+(pending?"needs-action":"done-action")+'">'+
    '<div class="action-icon">'+esc(info.icon)+'</div>'+
    '<div class="action-main"><div class="row"><div><div class="action-type">'+esc(info.label)+' · '+esc(nice(a.action_category||"general"))+'</div><h3>'+esc(a.title)+'</h3></div><div class="action-score"><strong>'+esc(a.priority_score||50)+'</strong><span>PRIORITY</span></div></div>'+
    '<p class="action-desc">'+esc(a.rationale||info.desc)+'</p>'+
    (outcome?'<div class="action-outcome"><span>BUSINESS OUTCOME</span><b>'+esc(outcome)+'</b>'+(audience?'<small>Target: '+esc(audience)+'</small>':'')+'</div>':'')+
    context+tactics+
    (body?'<div class="deliverable-preview"><div class="deliverable-label">PREPARED FOR YOU</div><div class="deliverable-body">'+esc(body)+'</div></div>':'')+
    (note?'<p class="note">'+esc(note)+'</p>':'')+
    actionStatusMessage(a)+
    (pending?'<div class="action-decision-note">This does not mark the work complete. If the channel is connected, the system can execute it. Otherwise it becomes a managed Lucid Logic task.</div><div class="actions"><button class="btn gold small" onclick="approveAction('+a.id+')">'+esc(actionDecisionLabel(a))+'</button></div>':'')+
    '<div class="action-time">'+ago(a.created_at)+'</div></div></article>';
}

function opportunityDate(value){
  if(!value) return "Not found";
  let d;
  if(value instanceof Date) d=value;
  else {
    const raw=String(value);
    const iso=raw.match(/^\d{4}-\d{2}-\d{2}/);
    d=iso?new Date(iso[0]+"T12:00:00"):new Date(raw);
  }
  return Number.isNaN(d.getTime())?"Not found":d.toLocaleDateString();
}
function opportunityDateValue(value){
  if(!value) return Number.MAX_SAFE_INTEGER;
  const raw=String(value);
  const iso=raw.match(/^\d{4}-\d{2}-\d{2}/);
  const d=iso?new Date(iso[0]+"T12:00:00"):new Date(raw);
  return Number.isNaN(d.getTime())?Number.MAX_SAFE_INTEGER:d.getTime();
}
function artifactsForOpportunity(id){
  return (state.data.opportunityArtifacts||[]).filter(a=>String(a.opportunity_id)===String(id));
}
function artifactCard(a){
  if(a.status==="generating") return '<div class="opp-artifact generating"><div><b>'+esc(a.artifact_type==="proposal"?"Proposal draft":"Questions")+'</b><span>Generating now. You can leave this page and come back.</span></div><div class="artifact-spinner">…</div></div>';
  if(a.status==="failed") return '<div class="opp-artifact failed"><b>Generation failed</b><span>'+esc(a.error||"Please try again.")+'</span></div>';
  return '<details class="opp-artifact ready"><summary>'+esc(a.title||nice(a.artifact_type))+' <span>Ready</span></summary><div class="artifact-body">'+esc(a.body||"")+'</div>'+(a.notes?'<div class="artifact-notes">'+esc(a.notes)+'</div>':'')+'<button class="btn small" onclick="copyArtifact('+a.id+')">Copy</button></details>';
}
window.copyArtifact=function(id){
  const a=(state.data.opportunityArtifacts||[]).find(x=>String(x.id)===String(id));
  if(!a)return;
  navigator.clipboard.writeText(a.body||"").then(()=>toast("Copied")).catch(()=>toast("Could not copy"));
};
function opportunityCard(o){
  const source=o.document_url||o.source_url||"";
  const due=opportunityDate(o.deadline);
  const qaDue=opportunityDate(o.qa_deadline);
  const reqs=Array.isArray(o.requirements)&&o.requirements.length?'<div class="opp-req"><b>Key requirements</b><ul>'+o.requirements.slice(0,8).map(r=>'<li>'+esc(typeof r==="string"?r:JSON.stringify(r))+'</li>').join("")+'</ul></div>':"";
  const artifacts=artifactsForOpportunity(o.id);
  const generatingQ=artifacts.some(a=>a.artifact_type==="questions"&&a.status==="generating");
  const generatingP=artifacts.some(a=>a.artifact_type==="proposal"&&a.status==="generating");
  const artifactHtml=artifacts.length?'<div class="pursuit-work-products"><div class="work-products-label">PURSUIT WORKSPACE</div>'+artifacts.map(artifactCard).join("")+'</div>':"";
  const pursuit=o.pursuit_status==="pursue"
    ?'<div class="pursuit-active"><b>Active pursuit</b><span>You have decided to pursue this opportunity. Nothing has been submitted externally. Questions and proposal drafts generated below stay in this workspace until you decide what to do with them.</span></div>'
    :"";
  return '<article id="opp-'+o.id+'" class="opportunity-card"><div class="row"><div><div class="meta"><span>'+esc(nice(o.opportunity_type||"opportunity"))+'</span><span>•</span><span>'+esc(nice(o.pursuit_status))+'</span></div><h3>'+esc(o.title)+'</h3></div><div class="fit-score"><strong>'+esc(o.fit_score||0)+'</strong><span>FIT</span></div></div>'+
  '<p>'+esc(o.summary||"")+'</p><div class="opp-meta"><div><span>Proposal due</span><b>'+esc(due)+'</b></div><div><span>Q&A due</span><b>'+esc(qaDue)+'</b></div><div><span>Est. value</span><b>'+esc(o.estimated_value||"Unknown")+'</b></div><div><span>Geography</span><b>'+esc(o.geography||"Unknown")+'</b></div></div>'+
  (o.recommendation?'<div class="why"><b>Lucid Logic recommendation:</b> '+esc(o.recommendation)+'</div>':'')+reqs+pursuit+
  '<div class="opp-action-explainer"><b>What these buttons do</b><span>Pursue only marks the opportunity active. Generate buttons create drafts here. Nothing is emailed, submitted or sent to the issuer automatically.</span></div>'+
  '<div class="actions">'+(source?'<a class="btn small" target="_blank" href="'+esc(source)+'">View RFP / source ↗</a>':'')+
  (o.pursuit_status==="pursue"?'<button class="btn small active-state" disabled>Pursuing</button>':'<button class="btn small" onclick="setOpp('+o.id+',\'pursue\')">Mark Pursue</button>')+
  '<button class="btn small danger" onclick="setOpp('+o.id+',\'pass\')">Pass</button>'+
  '<button class="btn small" '+(generatingQ?'disabled':'onclick="generateOpp('+o.id+',\'questions\')"')+'>'+(generatingQ?'Generating Questions…':'Generate Questions')+'</button>'+
  '<button class="btn gold small" '+(generatingP?'disabled':'onclick="generateOpp('+o.id+',\'proposal\')"')+'>'+(generatingP?'Generating Draft…':'Generate Proposal Draft')+'</button></div>'+artifactHtml+'</article>';
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
  const managed=d.actions.filter(a=>a.status==="requested"||a.status==="in_progress");
  const intelSignals=d.signals.filter(sig=>sig.program_type!=="opportunity");
  const newIntel=intelSignals.filter(sig=>Date.now()-new Date(sig.created_at).getTime()<7*86400000);
  const priorityRows=[];
  if(hasOpp&&open[0]){
    const o=open[0];
    priorityRows.push(priorityRow("OPPORTUNITY",o.title,(o.deadline?"Due "+opportunityDate(o.deadline):"Review fit and decide whether to pursue"),"go('opportunities')","Review"));
  }
  pending.slice(0,2).forEach(function(a){
    priorityRows.push(priorityRow("ACTION",a.title,actionInfo(a.action_type).desc,"go('actions')","Open"));
  });
  const rankedIntel=intelSignals.slice().sort(function(a,b){
    const ia=Number(a.importance||0),ib=Number(b.importance||0);
    if(ib!==ia) return ib-ia;
    const ca=Number(a.confidence||0),cb=Number(b.confidence||0);
    if(cb!==ca) return cb-ca;
    return new Date(b.created_at)-new Date(a.created_at);
  });
  const remaining=Math.max(0,5-priorityRows.length);
  rankedIntel.slice(0,remaining).forEach(function(sig){
    priorityRows.push(priorityRow("NEW INTELLIGENCE",sig.title,sig.why_it_matters,"go('intelligence')","Read"));
  });
  const priorities=priorityRows.join("");
  const programs=d.programs.map(p=>'<div class="watch-item"><div class="watch-dot"></div><div><b>'+esc(p.name)+'</b><span>'+esc(p.cadence)+' monitoring · '+esc(nice(p.program_type))+'</span></div></div>').join("");
  const hasIntel=intelSignals.length>0||d.programs.some(p=>p.program_type!=="opportunity");
  const metrics=(hasOpp?metric("Open opportunities",open.length,"RFPs, grants and pursuits","accent"):"")+
    metric("Needs your decision",pending.length,managed.length?managed.length+" managed action"+(managed.length===1?"":"s")+" in progress":"Prepared actions waiting on you")+
    (hasIntel?metric("New intelligence",newIntel.length,"Material findings in the last 7 days"):"")+
    metric("Active monitors",d.programs.length,"Areas Lucid Logic is continuously watching");
  const metricCount=(hasOpp?1:0)+1+(hasIntel?1:0)+1;

  return '<div class="welcome"><div><p class="eyebrow">MANAGED FOR '+esc(state.me.client.name.toUpperCase())+'</p><h2>What needs your attention</h2><p>Lucid Logic is monitoring in the background. You only need to come here when something matters or a decision is needed.</p></div></div>'+
  '<div class="metrics metrics-'+metricCount+'">'+metrics+'</div>'+
  '<div class="overview-grid"><div class="panel priority-panel"><div class="panel-head"><div><h2>Priority inbox</h2><p class="muted">The highest-priority decisions and intelligence right now, not the full feed.</p></div></div>'+(priorities||'<div class="empty">Nothing needs your attention right now.</div>')+
  (intelSignals.length?'<div class="priority-footer"><button class="btn small" onclick="go(\'intelligence\')">View all '+intelSignals.length+' intelligence items →</button></div>':"")+'</div>'+
  '<div class="panel watch-panel"><div class="panel-head"><div><h2>What we are watching</h2><p class="muted">You do not need to manage these. Lucid Logic does.</p></div></div>'+programs+'</div></div>';
}

function sortOpportunities(items,sort){
  const list=items.slice();
  list.sort((a,b)=>{
    if(sort==="deadline"){
      const ad=opportunityDateValue(a.deadline);
      const bd=opportunityDateValue(b.deadline);
      if(ad!==bd)return ad-bd;
      return Number(b.fit_score||0)-Number(a.fit_score||0);
    }
    if(sort==="newest") return new Date(b.created_at)-new Date(a.created_at);
    if(sort==="oldest") return new Date(a.created_at)-new Date(b.created_at);
    if(sort==="status"){
      const rank={pursue:0,review:1,pass:2};
      const d=(rank[a.pursuit_status]??9)-(rank[b.pursuit_status]??9);
      if(d!==0)return d;
    }
    const fit=Number(b.fit_score||0)-Number(a.fit_score||0);
    if(fit!==0)return fit;
    return new Date(b.created_at)-new Date(a.created_at);
  });
  return list;
}
function filterOpportunities(items,status){
  if(status==="all") return items;
  if(status==="active") return items.filter(o=>o.pursuit_status!=="pass");
  return items.filter(o=>o.pursuit_status===status);
}
function opportunityControls(){
  return '<div class="opp-controls"><div class="opp-control-group"><span>Status</span><select onchange="setOppStatusFilter(this.value)">'+
    ['active','review','pursue','pass','all'].map(v=>'<option value="'+v+'" '+(state.oppStatus===v?'selected':'')+'>'+esc(v==='active'?'Active':nice(v))+'</option>').join('')+
    '</select></div><div class="opp-control-group"><span>Sort</span><select onchange="setOppSort(this.value)">'+
    [['fit','Best fit'],['deadline','Deadline soonest'],['newest','Newest found'],['oldest','Oldest found'],['status','Pursuit status']].map(v=>'<option value="'+v[0]+'" '+(state.oppSort===v[0]?'selected':'')+'>'+v[1]+'</option>').join('')+
    '</select></div></div>';
}
window.setOppStatusFilter=v=>{state.oppStatus=v;render()};
window.setOppSort=v=>{state.oppSort=v;render()};
function opportunities(){
  const all=state.data.opportunities||[];
  const items=sortOpportunities(filterOpportunities(all,state.oppStatus),state.oppSort);
  return '<div class="page-intro"><div class="page-icon">◆</div><div><h2>Opportunities</h2><p>Revenue opportunities that require an actual pursuit decision. The RFP or source, deadlines, fit analysis and next steps live here.</p></div></div>'+
  '<div class="panel opportunities-panel"><div class="opp-toolbar"><div><div class="section-label">OPPORTUNITY PIPELINE</div><div class="muted">'+items.length+' of '+all.length+' shown</div></div>'+opportunityControls()+'</div>'+
  (items.map(opportunityCard).join("")||'<div class="empty">No opportunities match this view.</div>')+'</div>';
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
  const decisions=state.data.actions.filter(a=>a.status==="proposed").sort((a,b)=>Number(b.priority_score||0)-Number(a.priority_score||0));
  const managed=state.data.actions.filter(a=>a.status==="requested"||a.status==="in_progress").sort((a,b)=>Number(b.priority_score||0)-Number(a.priority_score||0));
  const finished=state.data.actions.filter(a=>a.status==="completed"||a.status==="executed");
  return '<div class="page-intro action-intro"><div class="page-icon">✓</div><div><h2>Action Center</h2><p>This is the short list of business actions that rise above the intelligence. A client decision does not mean the work is complete. Requested work stays visible until Lucid Logic or a connected system actually completes it.</p></div></div>'+
  '<div class="action-layout"><section><div class="action-section-head"><div><span>NEEDS YOUR DECISION</span><h2>Recommended next actions</h2></div><div class="count-badge">'+decisions.length+'</div></div>'+
  (decisions.map(actionCard).join("")||'<div class="empty">Nothing currently needs your decision.</div>')+'</section>'+
  '<section><div class="action-section-head managed-head"><div><span>MANAGED WORK</span><h2>Requested or in progress</h2></div><div class="count-badge neutral">'+managed.length+'</div></div>'+
  (managed.map(actionCard).join("")||'<div class="empty">No managed work is currently in progress.</div>')+'</section>'+
  '<section><div class="action-section-head completed"><div><span>COMPLETED</span><h2>Actually completed</h2></div></div>'+
  (finished.map(actionCard).join("")||'<div class="empty">No completed actions yet.</div>')+'</section></div>';
}
const titles={overview:"Overview",opportunities:"Opportunities",intelligence:"Intelligence",actions:"Action Center"};
const views={overview,opportunities,intelligence,actions};
function configureNavigation(){
  const oppNav=q('.nav[data-view="opportunities"]');
  const intelNav=q('.nav[data-view="intelligence"]');
  const hasOpp=hasOpportunityProgram();
  const hasIntel=state.data.programs.some(p=>p.program_type!=="opportunity");
  if(oppNav) oppNav.classList.toggle("hidden",!hasOpp);
  if(intelNav) intelNav.classList.toggle("hidden",!hasIntel);
  if((!hasOpp&&state.view==="opportunities")||(!hasIntel&&state.view==="intelligence")) state.view="overview";
}
function render(){
  configureNavigation();
  q("#pageTitle").textContent=titles[state.view]||"Overview";
  qa(".nav").forEach(n=>n.classList.toggle("active",n.dataset.view===state.view));
  q("#view").innerHTML=views[state.view]();
}
window.go=v=>{state.view=v;render()};
qa(".nav").forEach(n=>n.onclick=()=>go(n.dataset.view));

function urlIntent(){
  const p=new URLSearchParams(location.search);
  return {magic:p.get("magic")||"",view:p.get("view")||"",action:p.get("action")||"",opp:p.get("opp")||"",signal:p.get("signal")||""};
}
function applyUrlIntent(){
  const intent=urlIntent();
  if(intent.view&&views[intent.view]) state.view=intent.view;
  render();
  const target=intent.action?("action-"+intent.action):intent.opp?("opp-"+intent.opp):intent.signal?("signal-"+intent.signal):"";
  if(target){
    setTimeout(function(){
      const el=document.getElementById(target);
      if(el){el.classList.add("deep-target");el.scrollIntoView({behavior:"smooth",block:"center"})}
    },80);
  }
}
async function redeemMagicLink(){
  const intent=urlIntent();
  if(!intent.magic) return false;
  try{
    await api("/api/portal/magic-login",{method:"POST",body:JSON.stringify({token:intent.magic})});
    const p=new URLSearchParams(location.search);
    p.delete("magic");
    history.replaceState(null,"",location.pathname+(p.toString()?"?"+p.toString():""));
    return true;
  }catch(e){
    showLogin(e.message);
    return false;
  }
}

async function start(){
  try{
    const intent=urlIntent();
    if(intent.magic) await redeemMagicLink();
    state.me=await api("/api/portal/me");
    state.data=await api("/api/portal/dashboard");
    q("#clientName").textContent=state.me.client.name;
    q("#userName").textContent=state.me.user.name||state.me.user.email;
    q("#loginScreen").classList.add("hidden");
    q("#portalApp").classList.remove("hidden");
    applyUrlIntent();
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
window.setOpp=async(id,status)=>{
  try{
    const r=await api("/api/portal/opportunities/"+id+"/status",{method:"POST",body:JSON.stringify({status})});
    toast(r.message||"Opportunity updated");
    state.data=await api("/api/portal/dashboard");
    state.view="opportunities";
    render();
    setTimeout(()=>document.getElementById("opp-"+id)?.scrollIntoView({behavior:"smooth",block:"center"}),60);
  }catch(e){toast(e.message)}
};
async function waitForArtifact(artifactId,oppId){
  const started=Date.now();
  while(Date.now()-started<240000){
    await new Promise(r=>setTimeout(r,3000));
    try{
      const a=await api("/api/portal/opportunity-artifacts/"+artifactId);
      state.data=await api("/api/portal/dashboard");
      state.view="opportunities";
      render();
      if(a.status==="ready"){
        toast("Generated and saved in this opportunity workspace");
        setTimeout(()=>document.getElementById("opp-"+oppId)?.scrollIntoView({behavior:"smooth",block:"center"}),60);
        return;
      }
      if(a.status==="failed"){toast(a.error||"Generation failed");return}
    }catch(e){toast(e.message);return}
  }
  toast("Generation is still running. You can leave this page and return later.");
}
window.generateOpp=async(id,type)=>{
  try{
    const r=await api("/api/portal/opportunities/"+id+"/generate",{method:"POST",body:JSON.stringify({action_type:type})});
    toast(r.message||"Generation started");
    state.data=await api("/api/portal/dashboard");
    state.view="opportunities";
    render();
    waitForArtifact(r.artifactId,id);
  }catch(e){toast(e.message)}
};
window.approveAction=async id=>{
  try{
    const r=await api("/api/portal/actions/"+id+"/approve",{method:"POST",body:"{}"});
    toast(r.message||"Action updated");
    state.data=await api("/api/portal/dashboard");
    state.view="actions";
    render();
  }catch(e){toast(e.message)}
};
start();