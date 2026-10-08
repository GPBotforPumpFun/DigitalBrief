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
  if(a.owner_type==="lucid_logic"){
    if(canAutoExecute(a)&&a.action_type==="website_post") return "Approve & Send to Website";
    if(canAutoExecute(a)&&a.action_type==="social_post") return "Approve & Publish";
    return "Request Lucid Logic";
  }
  return "Add to My Next Steps";
}
function actionStatusMessage(a){
  if(a.status==="requested") return '<div class="managed-status requested"><b>Requested from Lucid Logic</b><span>Lucid Logic owns the next step. Nothing has been marked complete yet.</span></div>';
  if(a.status==="in_progress"&&a.owner_type==="lucid_logic") return '<div class="managed-status progress"><b>In progress with Lucid Logic</b><span>This managed work is underway and will remain here until Lucid Logic marks it complete.</span></div>';
  if(a.status==="in_progress") return '<div class="managed-status progress client-progress"><b>Your next step</b><span>Your team owns this action. Mark it complete when you have actually done it.</span></div>';
  if(a.status==="executed") return '<div class="managed-status complete"><b>Executed through a connected system</b><span>The connected channel completed this action.</span></div>';
  if(a.status==="completed") return '<div class="managed-status complete"><b>Completed</b><span>This action has been marked complete.</span></div>';
  return "";
}
function tacticArtifactType(text){
  const t=String(text||"").toLowerCase();
  if(/prospect|account list|build.*list|prioritized.*list|target list|entities|organizations/.test(t)) return "prospect_list";
  if(/outreach|email|message|contact|approach|referral/.test(t)) return "outreach_draft";
  if(/website|page|article|content|landing page|service page/.test(t)) return "content_draft";
  if(/social|linkedin|post/.test(t)) return "social_draft";
  if(/audit|assessment|inventory|checklist|risk assessment|remediation plan|roadmap|plan/.test(t)) return "checklist";
  return "assist";
}
function tacticButtonLabel(type){
  return {prospect_list:"Build List",outreach_draft:"Draft Outreach",content_draft:"Draft Content",social_draft:"Draft Social Post",checklist:"Build Checklist",assist:"Help Me Do This"}[type]||"Help Me Do This";
}
function actionArtifactsFor(actionId){
  return (state.data.actionArtifacts||[]).filter(x=>String(x.action_id)===String(actionId));
}
function linkifyArtifact(text){
  const escaped=esc(text||"");
  return escaped.replace(/(https?:\/\/[^\s<]+)/g,'<a target="_blank" rel="noopener" href="$1">$1</a>').replace(/\n/g,"<br>");
}
function actionArtifactCard(a){
  if(a.status==="generating") return '<div class="action-artifact generating"><div><b>'+esc(a.title||"Building work product")+'</b><span>Working on this now. You can leave this page and come back.</span></div><div class="artifact-spinner">…</div></div>';
  if(a.status==="failed") return '<div class="action-artifact failed"><b>Could not build this</b><span>'+esc(a.error||"Please try again.")+'</span></div>';
  return '<details class="action-artifact ready" open><summary>'+esc(a.title||nice(a.artifact_type))+' <span>Ready</span></summary><div class="action-artifact-body">'+linkifyArtifact(a.body||"")+'</div>'+(a.notes?'<div class="artifact-notes">'+esc(a.notes)+'</div>':'')+'<button class="btn small" onclick="copyActionArtifact('+a.id+')">Copy</button></details>';
}
function supportingTacticsHtml(a,tactics){
  if(!Array.isArray(tactics)||!tactics.length) return "";
  const artifacts=actionArtifactsFor(a.id);
  const rows=tactics.slice(0,5).map(function(t,index){
    const text=typeof t==="string"?t:JSON.stringify(t);
    const type=tacticArtifactType(text);
    const tacticKey=String(index)+":"+text.toLowerCase().slice(0,500);
    const artifact=artifacts.find(x=>String(x.tactic_key)===tacticKey);
    const button=artifact
      ?'<button class="btn small" disabled>'+(artifact.status==="generating"?"Building…":"Built")+'</button>'
      :'<button class="btn small tactic-btn" onclick="buildTactic('+a.id+','+index+',\''+encodeURIComponent(text)+'\',\''+type+'\')">'+esc(tacticButtonLabel(type))+'</button>';
    return '<div class="tactic-row"><div class="tactic-copy">'+esc(text)+'</div>'+button+'</div>';
  }).join("");
  const artifactHtml=artifacts.length?'<div class="action-work-products"><div class="work-products-label">WORK PRODUCED FROM THIS ACTION</div>'+artifacts.map(actionArtifactCard).join("")+'</div>':"";
  return '<div class="supporting-tactics"><span>SUPPORTING TACTICS</span>'+rows+artifactHtml+'</div>';
}
window.copyActionArtifact=function(id){
  const a=(state.data.actionArtifacts||[]).find(x=>String(x.id)===String(id));
  if(!a)return;
  navigator.clipboard.writeText(a.body||"").then(()=>toast("Copied")).catch(()=>toast("Could not copy"));
};
function actionCard(a){
  const p=a.payload||{};
  const info=actionInfo(a.action_type);
  const body=p.body||p.content||"";
  const note=p.notes||"";
  const pending=a.status==="proposed";
  const tactics=supportingTacticsHtml(a,p.supporting_tactics);
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
    (a.client_step?'<div class="client-step"><span>NEXT STEP</span><b>'+esc(a.client_step)+'</b></div>':'')+
    actionStatusMessage(a)+
    (pending?'<div class="action-decision-note">'+(a.owner_type==="lucid_logic"?"If you request this, Lucid Logic will own the work. It will stay visible until actually completed.":"This is your team\'s action. Adding it to My Next Steps does not send anything or involve Lucid Logic.")+'</div><div class="actions"><button class="btn gold small" onclick="approveAction('+a.id+')">'+esc(actionDecisionLabel(a))+'</button></div>':'')+
    (a.status==="in_progress"&&a.owner_type!=="lucid_logic"?'<div class="actions"><button class="btn gold small" onclick="completeMyAction('+a.id+')">Mark Complete</button></div>':'')+
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
  const rows=(state.data.opportunityArtifacts||[]).filter(a=>String(a.opportunity_id)===String(id));
  const byType={};
  rows.forEach(a=>{if(!byType[a.artifact_type])byType[a.artifact_type]=a});
  return Object.values(byType);
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
  const qArt=artifacts.find(a=>a.artifact_type==="questions");
  const pArt=artifacts.find(a=>a.artifact_type==="proposal");
  const generatingQ=qArt&&qArt.status==="generating";
  const generatingP=pArt&&pArt.status==="generating";
  const readyQ=qArt&&qArt.status==="ready";
  const readyP=pArt&&pArt.status==="ready";
  const artifactHtml=artifacts.length?'<div class="pursuit-work-products"><div class="work-products-label">PURSUIT WORKSPACE</div>'+artifacts.map(artifactCard).join("")+'</div>':"";
  const active=["pursue","submitted"].includes(o.pursuit_status);
  const pursuit=active
    ?'<div class="pursuit-active"><b>'+esc(o.pursuit_status==="submitted"?"Submitted":"Active pursuit")+'</b><span>'+(o.pursuit_status==="submitted"?"Your team has marked the response submitted. Track the outcome here.":"Your team owns the response and submission. Lucid Logic supplies the intelligence and drafting tools, but nothing is submitted for you.")+'</span></div>'
    :"";
  const lifecycle=o.pursuit_status==="pursue"
    ?'<button class="btn small" onclick="setOpp('+o.id+',\'submitted\')">Mark Submitted</button>'
    :o.pursuit_status==="submitted"
      ?'<button class="btn small" onclick="setOpp('+o.id+',\'won\')">Mark Won</button><button class="btn small danger" onclick="setOpp('+o.id+',\'lost\')">Mark Lost</button>'
      :"";
  return '<article id="opp-'+o.id+'" class="opportunity-card status-'+esc(o.pursuit_status||"review")+'"><div class="opp-card-head"><div class="row"><div><div class="meta"><span>'+esc(nice(o.opportunity_type||"opportunity"))+'</span><span>•</span><span>'+esc(nice(o.pursuit_status))+'</span></div><h3>'+esc(o.title)+'</h3></div><div class="fit-score"><strong>'+esc(o.fit_score||0)+'</strong><span>FIT</span></div></div></div>'+
  '<p>'+esc(o.summary||"")+'</p><div class="opp-meta"><div><span>Proposal due</span><b>'+esc(due)+'</b></div><div><span>Q&A due</span><b>'+esc(qaDue)+'</b></div><div><span>Est. value</span><b>'+esc(o.estimated_value||"Unknown")+'</b></div><div><span>Geography</span><b>'+esc(o.geography||"Unknown")+'</b></div></div>'+
  (o.recommendation?'<div class="why"><b>Lucid Logic recommendation:</b> '+esc(o.recommendation)+'</div>':'')+reqs+pursuit+
  '<div class="opp-action-explainer"><b>Your team owns the pursuit</b><span>Mark Pursue when you want to go after it. Generate Questions and Proposal Draft are self-service tools that stay here. Your team reviews, finalizes and submits the response.</span></div>'+
  '<div class="actions opp-actions-bar">'+(source?'<a class="btn small" target="_blank" href="'+esc(source)+'">View RFP / source ↗</a>':'')+
  (o.pursuit_status==="review"?'<button class="btn small" onclick="setOpp('+o.id+',\'pursue\')">Mark Pursue</button>':'')+
  (!["pass","won","lost"].includes(o.pursuit_status)?'<button class="btn small danger" onclick="setOpp('+o.id+',\'pass\')">Pass</button>':'')+
  lifecycle+
  '<button class="btn small" '+(generatingQ||readyQ?'disabled':'onclick="generateOpp('+o.id+',\'questions\')"')+'>'+(generatingQ?'Generating Questions…':readyQ?'Questions Ready':'Generate Questions')+'</button>'+
  '<button class="btn gold small" '+(generatingP||readyP?'disabled':'onclick="generateOpp('+o.id+',\'proposal\')"')+'>'+(generatingP?'Generating Draft…':readyP?'Proposal Draft Ready':'Generate Proposal Draft')+'</button></div>'+artifactHtml+'</article>';
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
  const open=hasOpp?d.opportunities.filter(o=>!["pass","won","lost"].includes(o.pursuit_status)):[];
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
      const rank={pursue:0,submitted:1,review:2,won:3,lost:4,pass:5};
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
  if(status==="active") return items.filter(o=>!["pass","won","lost"].includes(o.pursuit_status));
  return items.filter(o=>o.pursuit_status===status);
}
function opportunityControls(){
  return '<div class="opp-controls"><div class="opp-control-group"><span>Status</span><select onchange="setOppStatusFilter(this.value)">'+
    ['active','review','pursue','submitted','won','lost','pass','all'].map(v=>'<option value="'+v+'" '+(state.oppStatus===v?'selected':'')+'>'+esc(v==='active'?'Active':nice(v))+'</option>').join('')+
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
  const clientDecisions=state.data.actions.filter(a=>a.status==="proposed"&&a.owner_type!=="lucid_logic").sort((a,b)=>Number(b.priority_score||0)-Number(a.priority_score||0));
  const llDecisions=state.data.actions.filter(a=>a.status==="proposed"&&a.owner_type==="lucid_logic").sort((a,b)=>Number(b.priority_score||0)-Number(a.priority_score||0));
  const myWork=state.data.actions.filter(a=>a.status==="in_progress"&&a.owner_type!=="lucid_logic").sort((a,b)=>Number(b.priority_score||0)-Number(a.priority_score||0));
  const llWork=state.data.actions.filter(a=>(a.status==="requested"||a.status==="in_progress")&&a.owner_type==="lucid_logic").sort((a,b)=>Number(b.priority_score||0)-Number(a.priority_score||0));
  const finished=state.data.actions.filter(a=>a.status==="completed"||a.status==="executed");
  return '<div class="page-intro action-intro"><div class="page-icon">✓</div><div><h2>Next Steps</h2><p>Every item tells you who owns it. Your team handles business decisions, outreach and submissions. Lucid Logic only owns work you specifically request us to perform, or work that a connected system can execute.</p></div></div>'+
  '<div class="action-layout">'+
  '<section><div class="action-section-head"><div><span>YOUR DECISIONS</span><h2>What your team should do next</h2></div><div class="count-badge">'+clientDecisions.length+'</div></div>'+(clientDecisions.map(actionCard).join("")||'<div class="empty">No new decisions for your team.</div>')+'</section>'+
  (myWork.length?'<section><div class="action-section-head managed-head"><div><span>YOUR NEXT STEPS</span><h2>Actions your team took on</h2></div><div class="count-badge neutral">'+myWork.length+'</div></div>'+myWork.map(actionCard).join("")+'</section>':'')+
  '<section><div class="action-section-head managed-head"><div><span>LUCID LOGIC CAN HANDLE</span><h2>Digital work you can ask us to do</h2></div><div class="count-badge neutral">'+llDecisions.length+'</div></div>'+(llDecisions.map(actionCard).join("")||'<div class="empty">Nothing currently needs to be handed to Lucid Logic.</div>')+'</section>'+
  (llWork.length?'<section><div class="action-section-head managed-head"><div><span>MANAGED BY LUCID LOGIC</span><h2>Requested or in progress</h2></div><div class="count-badge neutral">'+llWork.length+'</div></div>'+llWork.map(actionCard).join("")+'</section>':'')+
  '<section><div class="action-section-head completed"><div><span>COMPLETED</span><h2>Finished actions</h2></div></div>'+(finished.map(actionCard).join("")||'<div class="empty">No completed actions yet.</div>')+'</section></div>';
}

const titles={overview:"Overview",opportunities:"Opportunities",intelligence:"Intelligence",actions:"Next Steps"};
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
async function waitForActionArtifact(artifactId,actionId){
  const started=Date.now();
  while(Date.now()-started<240000){
    await new Promise(r=>setTimeout(r,3000));
    try{
      const a=await api("/api/portal/action-artifacts/"+artifactId);
      state.data=await api("/api/portal/dashboard");
      state.view="actions";
      render();
      if(a.status==="ready"){
        toast("Built and attached to this next step");
        setTimeout(()=>document.getElementById("action-"+actionId)?.scrollIntoView({behavior:"smooth",block:"center"}),60);
        return;
      }
      if(a.status==="failed"){toast(a.error||"Could not build this");return}
    }catch(e){toast(e.message);return}
  }
  toast("Still working. You can leave this page and come back later.");
}
window.buildTactic=async function(actionId,index,encoded,type){
  const tactic=decodeURIComponent(encoded);
  try{
    const r=await api("/api/portal/actions/"+actionId+"/work-products",{method:"POST",body:JSON.stringify({tactic:tactic,tactic_index:index,artifact_type:type})});
    toast(r.message||"Building this now");
    state.data=await api("/api/portal/dashboard");
    state.view="actions";
    render();
    if(r.status==="ready") return;
    waitForActionArtifact(r.artifactId,actionId);
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
window.completeMyAction=async id=>{
  try{
    const r=await api("/api/portal/actions/"+id+"/status",{method:"PATCH",body:JSON.stringify({status:"completed"})});
    toast(r.message||"Marked complete");
    state.data=await api("/api/portal/dashboard");
    state.view="actions";
    render();
  }catch(e){toast(e.message)}
};
start();