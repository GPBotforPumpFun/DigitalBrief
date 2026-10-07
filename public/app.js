const q=function(s){return document.querySelector(s)};
const qa=function(s){return Array.from(document.querySelectorAll(s))};
const state={data:null,view:"overview",clientId:localStorage.getItem("intelClientId")||"all",settings:null};

function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
function nice(v){return String(v||"").replaceAll("_"," ").replace(/\b\w/g,function(c){return c.toUpperCase()})}
function ago(v){
  if(!v)return "Never";
  const n=(Date.now()-new Date(v).getTime())/1000;
  if(n<60)return "just now";
  if(n<3600)return Math.floor(n/60)+"m ago";
  if(n<86400)return Math.floor(n/3600)+"h ago";
  return new Date(v).toLocaleDateString();
}
function toast(msg){
  const t=q("#toast"); t.textContent=msg; t.classList.add("show");
  setTimeout(function(){t.classList.remove("show")},2500);
}
async function api(url,opts){
  const o=opts||{};
  o.headers=Object.assign({"Content-Type":"application/json"},o.headers||{});
  const r=await fetch(url,o);
  const d=await r.json().catch(function(){return {}});
  if(!r.ok)throw new Error(d.error||("Request failed "+r.status));
  return d;
}
function scoped(arr){
  if(state.clientId==="all") return arr||[];
  return (arr||[]).filter(function(x){return String(x.client_id)===String(state.clientId)});
}
function currentClient(){
  if(!state.data||state.clientId==="all") return null;
  return state.data.clients.find(function(c){return String(c.id)===String(state.clientId)})||null;
}
function syncClientSelect(){
  const sel=q("#clientSelect");
  if(!sel||!state.data) return;
  const exists=state.data.clients.some(function(c){return String(c.id)===String(state.clientId)});
  if(state.clientId!=="all"&&!exists) state.clientId="all";
  sel.innerHTML='<option value="all">All Clients</option>'+state.data.clients.map(function(c){return '<option value="'+c.id+'">'+esc(c.name)+'</option>'}).join("");
  sel.value=String(state.clientId);
}
function metric(label,value,sub){
  return '<div class="metric"><div class="label">'+esc(label)+'</div><div class="value">'+esc(value)+'</div><div class="sub">'+esc(sub)+'</div></div>';
}
function signalCard(s){
  let buttons="";
  if(s.source_url){
    buttons='<div class="actions"><a class="btn small" href="'+esc(s.source_url)+'" target="_blank">Open source ↗</a>'+
    '<button class="btn small" onclick="generateAction('+s.id+',&quot;social_post&quot;)">Social post</button>'+
    '<button class="btn small" onclick="generateAction('+s.id+',&quot;website_post&quot;)">Website action</button>'+
    '<button class="btn small" onclick="generateAction('+s.id+',&quot;proposal&quot;)">Proposal</button>'+
    '<button class="btn small" onclick="generateAction('+s.id+',&quot;questions&quot;)">Questions</button></div>';
  }
  return '<article class="signal"><div class="row"><div><div class="signal-title">'+esc(s.title)+'</div>'+
  '<div class="meta"><span>'+esc(s.client_name||"")+'</span><span>•</span><span>'+esc(s.program_name||"")+'</span><span>•</span><span>'+ago(s.created_at)+'</span>'+
  '<span class="pill '+(s.importance>=3?"high":"")+'">'+(s.importance>=3?"High priority":"Material")+'</span></div></div>'+
  '<span class="pill">'+esc(s.confidence||70)+'% confidence</span></div>'+
  '<p>'+esc(s.what_changed)+'</p><div class="why"><b>Why it matters:</b> '+esc(s.why_it_matters)+'</div>'+buttons+'</article>';
}
function actionCard(a){
  const p=a.payload||{};
  let body=p.body?'<div class="code">'+esc(p.body)+'</div>':"";
  let buttons="";
  if(a.status==="proposed"){
    buttons='<div class="actions"><button class="btn gold small" onclick="approveAction('+a.id+')">Approve / Execute</button>'+
    '<button class="btn small danger" onclick="dismissAction('+a.id+')">Dismiss</button></div>';
  }
  return '<article class="action"><div class="row"><div><div class="signal-title">'+esc(a.title)+'</div>'+
  '<div class="meta"><span>'+esc(a.client_name||"")+'</span><span>•</span><span class="pill action">'+esc(nice(a.action_type))+'</span><span>•</span><span>'+ago(a.created_at)+'</span></div></div>'+
  '<span class="pill">'+esc(nice(a.status))+'</span></div>'+
  (a.rationale?'<p class="muted">'+esc(a.rationale)+'</p>':"")+body+buttons+'</article>';
}
function overview(){
  const d=state.data;
  const programs=scoped(d.programs),signals=scoped(d.signals),actions=scoped(d.actions);
  const pending=actions.filter(function(a){return a.status==="proposed"}).length;
  const hi=signals.filter(function(x){return x.importance>=3}).length;
  const client=currentClient();
  return '<div class="metrics">'+
  metric(client?"Client workspace":"Active clients",client?client.name:d.clients.length,client?"Scoped dashboard":"Managed in one operating system")+
  metric("Live intel programs",programs.filter(function(p){return p.active}).length,"Revenue, market, visibility and account watches")+
  metric("Actions waiting",pending,"Human approval before execution")+
  metric("High-priority signals",hi,"Material items requiring attention")+'</div>'+
  '<div class="grid"><div><div class="panel"><div class="panel-head"><h2>Latest material signals</h2><button class="btn small" onclick="go(&quot;signals&quot;)">View all</button></div>'+
  (signals.length?signals.slice(0,6).map(signalCard).join(""):'<div class="empty">No signals yet for this client.</div>')+
  '</div></div><div><div class="panel"><div class="panel-head"><h2>Action queue</h2><button class="btn small" onclick="go(&quot;actions&quot;)">Open queue</button></div>'+
  (actions.filter(function(a){return a.status==="proposed"}).slice(0,5).map(actionCard).join("")||'<div class="empty">Nothing waiting for approval.</div>')+
  '</div><div class="profile-box"><h3>THE VALUE LOOP</h3><p><b>Watch → Understand → Decide → Act → Measure.</b><br><br>The brief is evidence. The product is the managed action layer that turns external change into something the client can actually do.</p></div></div></div>';
}
function clientsView(){
  const cards=state.data.clients.map(function(c){
    return '<div class="client-card" onclick="openClient('+c.id+')"><div class="meta">'+esc(c.industry||"Managed intelligence")+'</div><h3>'+esc(c.name)+'</h3>'+
    '<div class="url">'+esc(c.website_url||"No website yet")+'</div><p class="muted">'+esc(c.objective||"Define what this company cannot afford to miss.")+'</p></div>';
  }).join("");
  return '<div class="panel"><div class="panel-head"><div><h2>Managed clients</h2><div class="muted">Each client gets its own sources, cadence, action rules and connectors.</div></div><button class="btn gold" onclick="newClient()">+ Add client</button></div><div class="client-grid">'+cards+'</div></div>';
}
function signalsView(){
  const items=scoped(state.data.signals);
  return '<div class="panel"><div class="panel-head"><div><h2>Signal feed</h2><div class="muted">Only material changes for '+esc(currentClient()?currentClient().name:"all managed clients")+', with business impact and action options attached.</div></div></div>'+
  (items.map(signalCard).join("")||'<div class="empty">No signals yet for this client.</div>')+'</div>';
}
function actionsView(){
  const groups=["proposed","approved","executed","dismissed"];
  return '<div class="panel"><div class="panel-head"><div><h2>Action queue</h2><div class="muted">The system recommends. Lucid Logic or the client approves. Connected systems execute.</div></div></div>'+
  groups.map(function(g){
    const html=scoped(state.data.actions).filter(function(a){return a.status===g}).map(actionCard).join("");
    return '<h3 style="margin-top:22px">'+nice(g)+'</h3>'+(html||'<div class="empty">None</div>');
  }).join("")+'</div>';
}
function programsView(){
  const html=scoped(state.data.programs).map(function(p){
    return '<div class="program"><div class="type">'+esc(p.program_type)+' · '+esc(p.cadence)+'</div><h3>'+esc(p.name)+'</h3><p>'+esc(p.objective)+'</p>'+
    '<div class="meta">Client: '+esc(p.client_name)+' · Last run: '+ago(p.last_run_at)+'</div><div class="actions"><button class="btn gold small" onclick="runProgram('+p.id+')">Run now</button></div></div>';
  }).join("");
  return '<div class="panel"><div class="panel-head"><div><h2>Intelligence programs</h2><div class="muted">Define what to watch, why it matters, how often to scan and what actions can result.</div></div></div><div class="program-list">'+html+'</div></div>';
}
function connectorsView(){
  return '<div class="panel"><div class="panel-head"><div><h2>Action connectors</h2><div class="muted">Connect intelligence to execution without needing access to a client mailbox.</div></div></div>'+
  '<div class="split"><div>'+
  '<div class="connector"><h3>WordPress</h3><p class="muted">Create draft or published posts through the WP REST API using an application password.</p></div>'+
  '<div class="connector"><h3>Static / Railway website</h3><p class="muted">Call a secure content or deployment webhook. This keeps custom sites under Lucid Logic control.</p></div>'+
  '<div class="connector"><h3>Social publishing</h3><p class="muted">Use a client-approved webhook to a publishing platform. Generate first, approve, then publish.</p></div></div><div>'+
  '<div class="connector"><h3>Email without mailbox access</h3><p class="muted">Generate outreach or send through an approved transactional sender. No Gmail or Outlook password required.</p></div>'+
  '<div class="connector"><h3>Proposal / RFP workflow</h3><p class="muted">Qualified opportunities can spawn a proposal starter, compliance checklist, questions, due-date plan and pursuit decision.</p></div>'+
  '<div class="connector"><h3>CRM / webhook</h3><p class="muted">Account triggers can become CRM tasks, Slack alerts or sales follow-ups.</p></div></div></div></div>';
}
function settingsView(){
  const st=state.settings||{};
  const savedCode=localStorage.getItem("intelSettingsCode")||"";
  return '<div class="panel"><div class="panel-head"><div><h2>System Settings</h2><div class="muted">Platform-level configuration. Client data remains separated by workspace.</div></div></div>'+
  '<div class="split"><div><div class="connector"><h3>OpenAI research engine</h3><p class="muted">Status: <b>'+(st.aiConfigured?'Connected':'Not connected')+'</b>'+(st.masked?' · '+esc(st.masked):'')+'</p>'+
  '<p class="muted">The API key is encrypted before it is stored and is never displayed again.</p>'+
  '<form id="openaiSettingsForm"><div class="field"><label>Settings access code</label><input id="settingsCode" type="password" value="'+esc(savedCode)+'" autocomplete="current-password"></div>'+
  '<div class="field"><label>OpenAI API key</label><input id="openaiKey" type="password" placeholder="sk-..." autocomplete="off"></div>'+
  '<div class="actions"><button class="btn gold" type="submit">Save + Verify Key</button>'+(st.source==="dashboard"?'<button class="btn danger" type="button" onclick="clearOpenAIKey()">Remove saved key</button>':'')+'</div></form></div></div>'+
  '<div><div class="profile-box"><h3>CLIENT SEPARATION</h3><p>The selector in the top bar now defines the active client workspace. Signals, actions, programs and Command Center metrics are scoped to that client. Choose <b>All Clients</b> only when you intentionally want the Lucid Logic master view.</p></div>'+
  '<div class="connector"><h3>Research model</h3><p class="muted">'+esc("Current model: "+(st.model||"GPT-5.6"))+'</p></div></div></div></div>';
}
const titles={overview:"Command Center",clients:"Clients",signals:"Signal Feed",actions:"Action Queue",programs:"Intel Programs",connectors:"Connectors",settings:"Settings"};
function render(){
  if(!state.data)return;
  const cc=currentClient(); q("#pageTitle").textContent=(cc?cc.name+" · ":"")+(titles[state.view]||"Intelligence OS");
  qa(".nav").forEach(function(n){n.classList.toggle("active",n.dataset.view===state.view)});
  const views={overview:overview,clients:clientsView,signals:signalsView,actions:actionsView,programs:programsView,connectors:connectorsView,settings:settingsView};
  q("#view").innerHTML=views[state.view]();
}
async function load(){
  const all=await Promise.all([api("/api/dashboard"),api("/api/settings/status")]);
  state.data=all[0];
  state.settings=Object.assign({model:"GPT-5.6"},all[1]);
  q("#aiBadge").textContent=state.data.aiConfigured?"Live research connected":"AI key not connected";
  q("#aiBadge").className="badge "+(state.data.aiConfigured?"ok":"");
  syncClientSelect();
  render();
  bindSettingsForm();
}
window.go=function(v){state.view=v;render();bindSettingsForm()};
q("#clientSelect").onchange=function(){
  state.clientId=this.value;
  localStorage.setItem("intelClientId",state.clientId);
  render();
  bindSettingsForm();
};
qa(".nav").forEach(function(n){n.onclick=function(){state.view=n.dataset.view;render()}});
q("#refreshBtn").onclick=load;
q("#newClientBtn").onclick=function(){window.newClient()};
q("#modalClose").onclick=function(){q("#modal").classList.add("hidden")};
q("#modal").onclick=function(e){if(e.target.id==="modal")q("#modal").classList.add("hidden")};
function modal(html){q("#modalBody").innerHTML=html;q("#modal").classList.remove("hidden")}

function bindSettingsForm(){
  const form=q("#openaiSettingsForm");
  if(!form||form.dataset.bound==="1") return;
  form.dataset.bound="1";
  form.onsubmit=async function(e){
    e.preventDefault();
    const code=q("#settingsCode").value.trim();
    const key=q("#openaiKey").value.trim();
    if(!code||!key){toast("Enter the settings code and OpenAI key");return}
    try{
      const r=await api("/api/settings/openai",{method:"POST",headers:{"X-Settings-Code":code},body:JSON.stringify({api_key:key})});
      localStorage.setItem("intelSettingsCode",code);
      toast("OpenAI key verified and saved");
      await load();
    }catch(x){toast(x.message)}
  };
}
window.clearOpenAIKey=async function(){
  const code=(q("#settingsCode")?q("#settingsCode").value:"")||localStorage.getItem("intelSettingsCode")||"";
  if(!code){toast("Enter the settings access code");return}
  try{
    await api("/api/settings/openai",{method:"DELETE",headers:{"X-Settings-Code":code},body:"{}"});
    toast("Saved OpenAI key removed");
    await load();
  }catch(x){toast(x.message)}
};

window.newClient=function(){
  modal('<h2 class="section-title">Add managed intelligence client</h2><p class="section-sub">Start with a URL. The platform can learn the business and suggest the intelligence program.</p>'+
  '<form id="clientForm"><div class="form-grid"><div class="field"><label>Company name</label><input name="name" required></div>'+
  '<div class="field"><label>Website URL</label><input name="website_url" placeholder="https://..."></div><div class="field"><label>Industry</label><input name="industry"></div>'+
  '<div class="field"><label>Geography</label><input name="geography" placeholder="NY + FL, national, etc."></div>'+
  '<div class="field full"><label>What do they wish someone was constantly watching?</label><textarea name="objective" placeholder="Describe the information problem, opportunity or risk."></textarea></div></div>'+
  '<button class="btn gold" type="submit">Create client</button></form>');
  setTimeout(function(){
    q("#clientForm").onsubmit=async function(e){
      e.preventDefault();
      const b=Object.fromEntries(new FormData(e.target));
      try{
        const c=await api("/api/clients",{method:"POST",body:JSON.stringify(b)});
        q("#modal").classList.add("hidden");
        await load();
        window.openClient(c.id);
      }catch(x){toast(x.message)}
    };
  },0);
};
window.openClient=async function(id){
  state.clientId=String(id);
  localStorage.setItem("intelClientId",state.clientId);
  syncClientSelect();
  render();
  try{
    const x=await api("/api/clients/"+id);
    const c=x.client,p=c.profile||{};
    const programs=x.programs.map(function(pr){
      return '<div class="program"><div class="type">'+esc(pr.program_type)+' · '+esc(pr.cadence)+'</div><b>'+esc(pr.name)+'</b><p>'+esc(pr.objective)+'</p><button class="btn small" onclick="runProgram('+pr.id+')">Run now</button></div>';
    }).join("")||'<div class="empty">No programs yet.</div>';
    const connectors=x.connectors.map(function(k){return '<span class="pill">'+esc(k.name)+'</span>'}).join(" ");
    const priorities=Array.isArray(p.priorities)?'<div class="code">• '+esc(p.priorities.join("\n• "))+'</div>':"";
    modal('<h2 class="section-title">'+esc(c.name)+'</h2><p class="section-sub">'+esc(c.website_url||"")+' · '+esc(c.industry||"")+'</p>'+
    '<div class="split"><div><div class="panel"><h3>Intelligence mandate</h3><p>'+esc(c.objective||"Not defined yet.")+'</p><button class="btn gold" onclick="discover('+c.id+')">Analyze website + design intel</button></div>'+
    '<div class="panel"><div class="panel-head"><h3>Programs</h3><button class="btn small" onclick="programForm('+c.id+')">+ Add program</button></div>'+programs+'</div></div><div><div class="profile-box"><h3>WEBSITE-DERIVED PROFILE</h3><p>'+esc(p.summary||"Run Analyze website to create a business-specific source and action blueprint.")+'</p>'+priorities+'</div>'+
    '<div class="panel"><h3>Connect action channel</h3><p class="muted">Website, social, webhook or delivery integration.</p><button class="btn" onclick="connectorForm('+c.id+')">+ Add connector</button><div style="margin-top:12px">'+connectors+'</div></div></div></div>');
  }catch(e){toast(e.message)}
};
window.discover=async function(id){
  toast("Analyzing website...");
  try{await api("/api/clients/"+id+"/discover",{method:"POST",body:"{}"});toast("Blueprint created");window.openClient(id);load()}catch(e){toast(e.message)}
};
window.runProgram=async function(id){
  toast("Research run started...");
  try{
    const r=await api("/api/programs/"+id+"/run",{method:"POST",body:"{}"});
    toast(r.status==="needs_configuration"?"Add your OpenAI key in Settings for live research":"Research complete");
    await load();
  }catch(e){toast(e.message)}
};
window.generateAction=async function(signal_id,action_type){
  try{await api("/api/actions/generate",{method:"POST",body:JSON.stringify({signal_id:signal_id,action_type:action_type})});toast("Action generated");await load()}catch(e){toast(e.message)}
};
window.approveAction=async function(id){
  try{const r=await api("/api/actions/"+id+"/approve",{method:"POST",body:"{}"});toast(r.message||"Approved");await load()}catch(e){toast(e.message)}
};
window.dismissAction=async function(id){
  try{await api("/api/actions/"+id+"/dismiss",{method:"POST",body:"{}"});toast("Dismissed");await load()}catch(e){toast(e.message)}
};
window.programForm=function(id){
  modal('<h2 class="section-title">Add intelligence program</h2><p class="section-sub">Define exactly what Lucid Logic should watch and what actions may follow.</p>'+
  '<form id="programForm"><div class="form-grid"><div class="field"><label>Program name</label><input name="name" required placeholder="Revenue Opportunity Radar"></div>'+
  '<div class="field"><label>Type</label><select name="program_type"><option value="opportunity">Opportunity</option><option value="competitor">Competitor</option><option value="visibility">Reputation + AI Visibility</option><option value="industry">Industry</option><option value="account">Account</option><option value="custom">Custom</option></select></div>'+
  '<div class="field"><label>Cadence</label><select name="cadence"><option value="weekday">Weekdays</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></div>'+
  '<div class="field full"><label>Objective</label><textarea name="objective" required placeholder="What should this program detect, and why does it matter?"></textarea></div>'+
  '<div class="field full"><label>Sources / queries, one per line</label><textarea name="sources" placeholder="RFP portals\nIndustry association\nSpecific competitor URLs"></textarea></div>'+
  '<div class="field full"><label>Allowed actions, comma-separated</label><input name="actions" value="alert, social_post, website_post, proposal, questions, outreach"></div></div>'+
  '<button class="btn gold">Create program</button></form>');
  setTimeout(function(){
    q("#programForm").onsubmit=async function(e){
      e.preventDefault();
      const f=Object.fromEntries(new FormData(e.target));
      const body={client_id:id,name:f.name,program_type:f.program_type,cadence:f.cadence,objective:f.objective,source_plan:String(f.sources||"").split(/\n+/).map(function(x){return x.trim()}).filter(Boolean),action_plan:String(f.actions||"").split(",").map(function(x){return x.trim()}).filter(Boolean)};
      try{
        await api("/api/programs",{method:"POST",body:JSON.stringify(body)});
        toast("Program created");
        window.openClient(id);
        load();
      }catch(x){toast(x.message)}
    };
  },0);
};

window.connectorForm=function(id){
  modal('<h2 class="section-title">Add action connector</h2><p class="section-sub">Secrets are encrypted before storage.</p>'+
  '<form id="connectorForm"><div class="field"><label>Connector type</label><select name="connector_type"><option value="wordpress">WordPress</option><option value="webhook">Static / Railway webhook</option><option value="social_webhook">Social publishing webhook</option></select></div>'+
  '<div class="field"><label>Name</label><input name="name" placeholder="Client website" required></div><div class="field"><label>Endpoint / site URL</label><input name="url" placeholder="https://..."></div>'+
  '<div class="field"><label>Username (WordPress only)</label><input name="username"></div><div class="field"><label>Application password / token</label><input name="secret" type="password"></div><button class="btn gold">Save connector</button></form>');
  setTimeout(function(){
    q("#connectorForm").onsubmit=async function(e){
      e.preventDefault();
      const f=Object.fromEntries(new FormData(e.target));
      const config={url:f.url};
      if(f.connector_type==="wordpress"){config.username=f.username;config.appPassword=f.secret}else if(f.secret){config.token=f.secret}
      try{
        await api("/api/connectors",{method:"POST",body:JSON.stringify({client_id:id,connector_type:f.connector_type,name:f.name,config:config})});
        toast("Connector saved");
        q("#modal").classList.add("hidden");
        window.openClient(id);
      }catch(x){toast(x.message)}
    };
  },0);
};
load().catch(function(e){q("#view").innerHTML='<div class="empty">'+esc(e.message)+'</div>'});
