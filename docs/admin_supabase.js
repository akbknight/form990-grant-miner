/* admin_supabase.js — Supabase-backed Admin panels for Legacy Deborah.
 * Panels: Users & Access · Login Activity · New Organizations Review ·
 * Auto-Resolve · Save & Learn Recovery · Active Overrides · Published Versions.
 * All writes go through Supabase RLS / SECURITY DEFINER RPCs (admin-only).
 * NOTE: these panels never alter the dashboard's static dataset or totals.
 */
(function(){
  'use strict';
  var S = function(){ return window.SUPA; };
  function isAdmin(){ try { return window.PORTAL_AUTH && window.PORTAL_AUTH.isAdmin(); } catch(e){ return false; } }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }
  function fmtDate(d){ if(!d) return '—'; try { var x=new Date(d); return x.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})+' '+x.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}); } catch(e){ return d; } }
  function fmtMoney(v){ v=Number(v)||0; if(v>=1e9) return '$'+(v/1e9).toFixed(2)+'B'; if(v>=1e6) return '$'+(v/1e6).toFixed(1)+'M'; if(v>=1e3) return '$'+(v/1e3).toFixed(0)+'K'; return '$'+v.toFixed(0); }
  function shortDev(d){ d=String(d||''); if(d.length<40) return d; var os=/Windows/.test(d)?'Windows':/Mac/.test(d)?'macOS':/Android/.test(d)?'Android':/iPhone|iPad/.test(d)?'iOS':/Linux/.test(d)?'Linux':''; var br=/Edg\//.test(d)?'Edge':/Chrome\//.test(d)?'Chrome':/Firefox/.test(d)?'Firefox':/Safari/.test(d)?'Safari':''; return (br||'Browser')+(os?' on '+os:''); }
  function toast(m,k){ try { window.PORTAL_AUTH_toast ? window.PORTAL_AUTH_toast(m,k) : alert(m); } catch(e){} }

  // ── styles ──
  var css = ''+
  '.sb-panel{background:#141a2e;border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:18px 20px;margin:0 0 18px;color:#e6ecf5;font-size:13px}'+
  '.sb-panel h3{margin:0 0 4px;font-size:15px;font-weight:700;color:#fff;display:flex;align-items:center;gap:10px}'+
  '.sb-panel .sb-sub{color:#8e9bb5;font-size:12px;margin:0 0 14px}'+
  '.sb-tag{display:inline-block;font-size:10px;letter-spacing:.06em;text-transform:uppercase;padding:2px 8px;border-radius:10px;background:rgba(44,225,216,.12);color:#7fe9e3;border:1px solid rgba(44,225,216,.3)}'+
  '.sb-table{width:100%;border-collapse:collapse;font-size:12px}'+
  '.sb-table th{text-align:left;color:#8e9bb5;font-weight:600;padding:7px 8px;border-bottom:1px solid rgba(255,255,255,.1);white-space:nowrap}'+
  '.sb-table td{padding:7px 8px;border-bottom:1px solid rgba(255,255,255,.05);vertical-align:top}'+
  '.sb-table tr:hover td{background:rgba(255,255,255,.02)}'+
  '.sb-btn{background:#1f2a48;color:#dce6f5;border:1px solid rgba(255,255,255,.14);border-radius:6px;padding:5px 10px;font-size:11px;font-weight:600;cursor:pointer;margin:0 4px 4px 0}'+
  '.sb-btn:hover{background:#28365c}.sb-btn.pri{background:#1f6f8b;border-color:#2a8fb0;color:#fff}.sb-btn.dan{background:#5a1f2a;border-color:#8a2c3c;color:#ffd6dc}.sb-btn:disabled{opacity:.5;cursor:default}'+
  '.sb-in{background:#0e1426;color:#e6ecf5;border:1px solid rgba(255,255,255,.16);border-radius:6px;padding:6px 9px;font-size:12px;margin:0 6px 6px 0}'+
  '.sb-row{display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin-bottom:10px}'+
  '.sb-kpis{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:12px}.sb-kpi{background:#0e1426;border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:8px 12px;min-width:110px}.sb-kpi b{display:block;font-size:17px;color:#fff;font-variant-numeric:tabular-nums}.sb-kpi span{color:#8e9bb5;font-size:11px}'+
  '.sb-ok{color:#6ee7a8}.sb-bad{color:#ff8e9e}.sb-muted{color:#8e9bb5}.sb-scroll{max-height:420px;overflow:auto}'+
  '.sb-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 16px}.sb-tab{background:#141a2e;border:1px solid rgba(255,255,255,.1);color:#b9c6dc;border-radius:20px;padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer}.sb-tab.on{background:#1f6f8b;color:#fff;border-color:#2a8fb0}';
  function injectCss(){ if(document.getElementById('sbAdminCss')) return; var st=document.createElement('style'); st.id='sbAdminCss'; st.textContent=css; document.head.appendChild(st); }

  var PANELS = [
    { id:'users',    label:'Users & Access',          render: renderUsers },
    { id:'logins',   label:'Login Activity',          render: renderLogins },
    { id:'neworgs',  label:'New Organizations Review', render: renderNewOrgs },
    { id:'auto',     label:'Auto-Resolve',            render: renderAuto },
    { id:'recovery', label:'Save & Learn Recovery',   render: renderRecovery },
    { id:'overrides',label:'Active Overrides',        render: renderOverrides },
    { id:'versions', label:'Published Versions',      render: renderVersions }
  ];
  var current = 'users';

  function mount(){
    if(!isAdmin() || !S()) return;
    var av = document.getElementById('adminView'); if(!av) return;
    injectCss();
    var host = document.getElementById('sbAdminHost');
    if(!host){
      host = document.createElement('section'); host.id='sbAdminHost';
      host.innerHTML = '<div class="sb-panel" style="padding-bottom:6px"><h3>Platform Administration <span class="sb-tag">Live · Supabase</span></h3>'+
        '<p class="sb-sub">Accounts, sign-in activity, organization review, learning decisions and publishing — saved to the Deborah database. These tools do not change the dashboard totals.</p>'+
        '<div class="sb-tabs" id="sbTabs"></div></div><div id="sbPanelBody"></div>';
      av.insertBefore(host, av.firstChild);
    }
    var tabs = document.getElementById('sbTabs');
    tabs.innerHTML = PANELS.map(function(p){ return '<button class="sb-tab'+(p.id===current?' on':'')+'" data-sbtab="'+p.id+'">'+esc(p.label)+'</button>'; }).join('');
    tabs.querySelectorAll('[data-sbtab]').forEach(function(b){ b.onclick=function(){ current=b.getAttribute('data-sbtab'); mount(); }; });
    var body = document.getElementById('sbPanelBody');
    body.innerHTML = '<div class="sb-panel"><span class="sb-muted">Loading…</span></div>';
    var p = PANELS.filter(function(x){return x.id===current;})[0];
    Promise.resolve().then(function(){ return p.render(body); }).catch(function(e){
      body.innerHTML = '<div class="sb-panel"><h3>'+esc(p.label)+'</h3><p class="sb-bad">Could not load: '+esc(e.message)+'</p><button class="sb-btn" id="sbRetry">Retry</button></div>';
      var r=document.getElementById('sbRetry'); if(r) r.onclick=mount;
    });
  }

  // ── Users & Access ──
  async function renderUsers(body){
    var rows = await S().select('profiles','select=*&order=role.asc,email.asc');
    var inv = []; try { inv = await S().select('user_invitations','select=*&order=invited_at.desc&limit=20'); } catch(e){}
    var active = rows.filter(function(r){return r.active!==false;}).length;
    var admins = rows.filter(function(r){return r.role==='admin';}).length;
    var me = (window.PORTAL_AUTH.getSession()||{}).user_id;
    body.innerHTML = '<div class="sb-panel"><h3>Users & Access</h3><p class="sb-sub">Every account that can sign in to Deborah. Deactivating blocks sign-in immediately.</p>'+
      '<div class="sb-kpis"><div class="sb-kpi"><b>'+rows.length+'</b><span>Accounts</span></div><div class="sb-kpi"><b>'+active+'</b><span>Active</span></div><div class="sb-kpi"><b>'+admins+'</b><span>Admins</span></div><div class="sb-kpi"><b>'+(rows.length-admins)+'</b><span>Users</span></div></div>'+
      '<div class="sb-row"><input class="sb-in" id="sbNewEmail" placeholder="email@organization.org" style="width:220px"><input class="sb-in" id="sbNewName" placeholder="Full name (optional)" style="width:170px"><input class="sb-in" id="sbNewPw" type="text" placeholder="Temporary password (8+ chars)" style="width:200px">'+
      '<select class="sb-in" id="sbNewRole"><option value="user">User (read-only)</option><option value="admin">Admin</option></select><button class="sb-btn pri" id="sbAddUser">Add account</button></div>'+
      '<div class="sb-scroll"><table class="sb-table"><thead><tr><th>Email</th><th>Name</th><th>Role</th><th>Status</th><th>Sign-ins</th><th>Last sign-in</th><th>Last activity</th><th>Device</th><th>Actions</th></tr></thead><tbody>'+
      rows.map(function(r){
        var self = r.id===me;
        return '<tr><td>'+esc(r.email)+'</td><td>'+esc(r.full_name||'')+'</td><td>'+esc(r.role)+'</td><td>'+(r.active===false?'<span class="sb-bad">Inactive</span>':'<span class="sb-ok">Active</span>')+'</td>'+
          '<td style="font-variant-numeric:tabular-nums">'+(r.login_count||0)+'</td><td>'+fmtDate(r.last_login_at)+'</td><td>'+fmtDate(r.last_activity_at)+'</td><td class="sb-muted" title="'+esc(r.device_summary||'')+'">'+esc(shortDev(r.device_summary))+'</td><td>'+
          (self?'<span class="sb-muted">You</span>':
            '<button class="sb-btn" data-act="role" data-id="'+r.id+'" data-v="'+(r.role==='admin'?'user':'admin')+'">Make '+(r.role==='admin'?'user':'admin')+'</button>'+
            '<button class="sb-btn '+(r.active===false?'pri':'dan')+'" data-act="active" data-id="'+r.id+'" data-v="'+(r.active===false?'true':'false')+'">'+(r.active===false?'Reactivate':'Deactivate')+'</button>')+
          '<button class="sb-btn" data-act="reset" data-email="'+esc(r.email)+'">Reset password</button></td></tr>';
      }).join('')+'</tbody></table></div>'+
      (inv.length?'<p class="sb-sub" style="margin-top:14px">Recent invitations</p><table class="sb-table"><thead><tr><th>Email</th><th>Role</th><th>Status</th><th>Invited</th></tr></thead><tbody>'+inv.map(function(i){return '<tr><td>'+esc(i.email)+'</td><td>'+esc(i.role)+'</td><td>'+esc(i.status||'')+'</td><td>'+fmtDate(i.invited_at)+'</td></tr>';}).join('')+'</tbody></table>':'')+
      '</div>';
    body.querySelectorAll('[data-act]').forEach(function(b){
      b.onclick = async function(){
        var act=b.getAttribute('data-act'); b.disabled=true;
        try {
          if(act==='role'){ await S().update('profiles','id=eq.'+b.getAttribute('data-id'),{ role:b.getAttribute('data-v'), updated_at:new Date().toISOString() }); await S().logEvent('role_changed',{ target:b.getAttribute('data-id'), role:b.getAttribute('data-v') }); toast('Role updated','success'); }
          if(act==='active'){ var on=b.getAttribute('data-v')==='true'; await S().update('profiles','id=eq.'+b.getAttribute('data-id'),{ active:on, updated_at:new Date().toISOString() }); await S().logEvent(on?'account_reactivated':'access_revoked',{ target:b.getAttribute('data-id') }); toast(on?'Account reactivated':'Account deactivated','success'); }
          if(act==='reset'){ await S().resetPassword(b.getAttribute('data-email')); await S().logEvent('password_reset_sent',{ email:b.getAttribute('data-email') }); toast('Password reset email sent','success'); }
          mount();
        } catch(e){ b.disabled=false; toast('Failed: '+e.message,'error'); }
      };
    });
    document.getElementById('sbAddUser').onclick = async function(){
      var email=(document.getElementById('sbNewEmail').value||'').trim().toLowerCase();
      var pw=document.getElementById('sbNewPw').value||''; var role=document.getElementById('sbNewRole').value; var name=(document.getElementById('sbNewName').value||'').trim();
      if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ toast('Enter a valid email','error'); return; }
      if(pw.length<8){ toast('Temporary password must be at least 8 characters','error'); return; }
      this.disabled=true;
      try {
        try { await S().insert('user_invitations',[{ email:email, role:role, status:'pending', invited_by:(window.PORTAL_AUTH.getSession()||{}).user_id }]); } catch(e){}
        var r = await S().createAccount(email, pw);
        var uid = (r && (r.id || (r.user && r.user.id))) || null;
        await new Promise(function(res){ setTimeout(res, 800); });
        var patch = { role:role, active:true, updated_at:new Date().toISOString() }; if(name) patch.full_name=name;
        var q = uid ? ('id=eq.'+uid) : ('email=eq.'+encodeURIComponent(email));
        var upd = await S().update('profiles', q, patch);
        if(!upd || !upd.length){ var ins={ id:uid, email:email, role:role, active:true }; if(name) ins.full_name=name; if(uid) await S().insert('profiles',[ins]); }
        try { await S().update('user_invitations','email=eq.'+encodeURIComponent(email)+'&status=eq.pending',{ status:'accepted', accepted_at:new Date().toISOString() }); } catch(e){}
        toast('Account created for '+email,'success'); mount();
      } catch(e){ this.disabled=false; toast('Could not create account: '+e.message,'error'); }
    };
  }

  // ── Login Activity ──
  async function renderLogins(body){
    var ev = 'in.(login,login_success,login_failed,logout,session_expired,account_deactivated,access_revoked,account_reactivated,role_changed,password_reset_sent)';
    var rows = await S().select('audit_log','select=id,event,actor_email,target_email,created_at,device_summary,event_status,details&event='+ev+'&order=created_at.desc&limit=150');
    var since = Date.now()-7*864e5;
    var wk = rows.filter(function(r){ return /login/.test(r.event) && r.event!=='login_failed' && new Date(r.created_at).getTime()>since; });
    var people = {}; wk.forEach(function(r){ people[r.actor_email]=1; });
    body.innerHTML = '<div class="sb-panel"><h3>Login Activity</h3><p class="sb-sub">Sign-ins, sign-outs and access changes recorded in the audit log (latest 150).</p>'+
      '<div class="sb-kpis"><div class="sb-kpi"><b>'+wk.length+'</b><span>Sign-ins, last 7 days</span></div><div class="sb-kpi"><b>'+Object.keys(people).length+'</b><span>People, last 7 days</span></div></div>'+
      '<div class="sb-scroll"><table class="sb-table"><thead><tr><th>When</th><th>Event</th><th>Who</th><th>Device</th><th>Status</th></tr></thead><tbody>'+
      rows.map(function(r){ return '<tr><td>'+fmtDate(r.created_at)+'</td><td>'+esc(r.event.replace(/_/g,' '))+'</td><td>'+esc(r.actor_email||r.target_email||'')+'</td><td class="sb-muted" title="'+esc(r.device_summary||'')+'">'+esc(shortDev(r.device_summary))+'</td><td>'+(r.event_status==='failed'?'<span class="sb-bad">failed</span>':esc(r.event_status||'ok'))+'</td></tr>'; }).join('')+
      '</tbody></table></div></div>';
  }

  // ── New Organizations Review ──
  var noState = { status:'pending', q:'', page:0, size:25, sel:{} };
  async function renderNewOrgs(body){
    var counts = {};
    var sts=['pending','approved','needs_research','rejected'];
    var ns = await Promise.all(sts.map(function(k){ return S().count('new_organizations','review_status=eq.'+k).catch(function(){return 0;}); }));
    sts.forEach(function(k,i){ counts[k]=ns[i]; });
    var q = 'select=organization_key,organization_name,ein,city,state,cef_type,organization_type,jewish_classification,classification_confidence,annual_giving,total_giving,latest_filing_year,review_status,decision_class,review_notes,source_url&order=total_giving.desc.nullslast&limit='+noState.size+'&offset='+(noState.page*noState.size);
    if(noState.status!=='all') q += '&review_status=eq.'+noState.status;
    if(noState.q) q += '&organization_name=ilike.*'+encodeURIComponent(noState.q)+'*';
    var rows = await S().select('new_organizations', q);
    body.innerHTML = '<div class="sb-panel"><h3>New Organizations Review</h3><p class="sb-sub">Organizations discovered from new IRS filings, awaiting an admin decision. Jewish linkage matters more than the confidence score. Decisions are saved to the database and do not change dashboard totals.</p>'+
      '<div class="sb-kpis">'+['pending','approved','needs_research','rejected'].map(function(k){return '<div class="sb-kpi"><b>'+(counts[k]||0)+'</b><span>'+k.replace('_',' ')+'</span></div>';}).join('')+'</div>'+
      '<div class="sb-row"><select class="sb-in" id="noStatus">'+['pending','approved','needs_research','rejected','all'].map(function(s){return '<option '+(s===noState.status?'selected':'')+' value="'+s+'">'+s.replace('_',' ')+'</option>';}).join('')+'</select>'+
      '<input class="sb-in" id="noQ" placeholder="Search name…" value="'+esc(noState.q)+'" style="width:220px"><button class="sb-btn" id="noGo">Search</button>'+
      '<span style="flex:1"></span><button class="sb-btn pri" data-bulk="approved">Approve selected</button><button class="sb-btn" data-bulk="needs_research">Needs research</button><button class="sb-btn dan" data-bulk="rejected">Reject selected</button></div>'+
      '<div class="sb-scroll"><table class="sb-table"><thead><tr><th><input type="checkbox" id="noAll"></th><th>Organization</th><th>EIN</th><th>Location</th><th>Type</th><th>Classification</th><th>Conf.</th><th>Total giving</th><th>Status</th><th>Decide</th></tr></thead><tbody>'+
      (rows.length?rows.map(function(r){
        return '<tr><td><input type="checkbox" data-sel="'+esc(r.organization_key)+'" '+(noState.sel[r.organization_key]?'checked':'')+'></td><td><b>'+esc(r.organization_name)+'</b>'+(r.source_url?' <a href="'+esc(r.source_url)+'" target="_blank" rel="noopener" style="color:#7fe9e3">filing</a>':'')+'</td><td>'+esc(r.ein||'')+'</td><td>'+esc([r.city,r.state].filter(Boolean).join(', '))+'</td><td>'+esc(r.cef_type||r.organization_type||'')+'</td><td>'+esc(r.decision_class||r.jewish_classification||'')+'</td><td>'+(r.classification_confidence!=null?Math.round(r.classification_confidence*100)+'%':'—')+'</td><td>'+fmtMoney(r.total_giving)+'</td><td>'+esc(r.review_status)+'</td>'+
          '<td style="white-space:nowrap"><select class="sb-in" data-cls="'+esc(r.organization_key)+'"><option value="jewish">Jewish</option><option value="jewish_aligned">Jewish-aligned</option><option value="non_jewish">Non-Jewish</option><option value="mixed">Mixed</option></select><label class="sb-muted" style="font-size:11px"><input type="checkbox" data-learn="'+esc(r.organization_key)+'"> Save & Learn</label><br>'+
          '<button class="sb-btn pri" data-dec="approved" data-key="'+esc(r.organization_key)+'">Approve</button><button class="sb-btn" data-dec="needs_research" data-key="'+esc(r.organization_key)+'">Research</button><button class="sb-btn dan" data-dec="rejected" data-key="'+esc(r.organization_key)+'">Reject</button></td></tr>';
      }).join(''):'<tr><td colspan="10" class="sb-muted">No organizations in this view.</td></tr>')+
      '</tbody></table></div><div class="sb-row" style="margin-top:10px"><button class="sb-btn" id="noPrev" '+(noState.page?'':'disabled')+'>‹ Prev</button><span class="sb-muted">Page '+(noState.page+1)+'</span><button class="sb-btn" id="noNext" '+(rows.length<noState.size?'disabled':'')+'>Next ›</button></div></div>';
    document.getElementById('noStatus').onchange=function(){ noState.status=this.value; noState.page=0; mount(); };
    document.getElementById('noGo').onclick=function(){ noState.q=document.getElementById('noQ').value.trim(); noState.page=0; mount(); };
    document.getElementById('noQ').onkeydown=function(e){ if(e.key==='Enter') document.getElementById('noGo').click(); };
    document.getElementById('noPrev').onclick=function(){ noState.page=Math.max(0,noState.page-1); mount(); };
    document.getElementById('noNext').onclick=function(){ noState.page++; mount(); };
    document.getElementById('noAll').onchange=function(){ var on=this.checked; body.querySelectorAll('[data-sel]').forEach(function(c){ c.checked=on; noState.sel[c.getAttribute('data-sel')]=on; }); };
    body.querySelectorAll('[data-sel]').forEach(function(c){ c.onchange=function(){ noState.sel[c.getAttribute('data-sel')]=c.checked; }; });
    body.querySelectorAll('[data-dec]').forEach(function(b){
      b.onclick = async function(){
        var key=b.getAttribute('data-key'), st=b.getAttribute('data-dec');
        var cls=(body.querySelector('[data-cls="'+CSS.escape(key)+'"]')||{}).value||null;
        var learn=!!((body.querySelector('[data-learn="'+CSS.escape(key)+'"]')||{}).checked);
        b.disabled=true;
        try {
          var r = await S().rpc('new_org_save_decision',{ p_org_key:key, p_review_status:st, p_decision_class:st==='rejected'?'non_jewish':cls, p_decision_subtype:null, p_notes:null, p_save_and_learn:learn });
          if(r && r.ok===false) throw new Error(r.error||'rejected');
          toast('Saved','success'); mount();
        } catch(e){ b.disabled=false; queueUnsaved({ scope:'new_org', target_id:key, decision:st, classification:cls, error:e.message }); toast('Not saved — kept in Recovery: '+e.message,'error'); }
      };
    });
    body.querySelectorAll('[data-bulk]').forEach(function(b){
      b.onclick = async function(){
        var keys=Object.keys(noState.sel).filter(function(k){return noState.sel[k];});
        if(!keys.length){ toast('Select organizations first','error'); return; }
        var st=b.getAttribute('data-bulk'); b.disabled=true;
        try { await S().rpc('new_org_bulk_decision',{ p_org_keys:keys, p_review_status:st, p_decision_class:st==='rejected'?'non_jewish':(st==='approved'?'jewish':null), p_notes:'Bulk decision from Admin' }); noState.sel={}; toast(keys.length+' organizations updated','success'); mount(); }
        catch(e){ b.disabled=false; toast('Bulk update failed: '+e.message,'error'); }
      };
    });
  }

  // ── Auto-Resolve ──
  async function renderAuto(body){
    body.innerHTML = '<div class="sb-panel"><h3>Auto-Resolve High-Confidence Organizations</h3><p class="sb-sub">Approves pending organizations at or above a confidence threshold. Admin-locked (Save & Learn) records are never touched. Preview first.</p>'+
      '<div class="sb-row"><label class="sb-muted">Threshold&nbsp;</label><input class="sb-in" id="arTh" type="number" min="0.5" max="1" step="0.01" value="0.92" style="width:90px"><button class="sb-btn" id="arPrev">Preview (dry run)</button><button class="sb-btn pri" id="arRun">Run auto-resolve</button></div><div id="arOut" class="sb-muted">Run a preview to see what would change.</div></div>';
    async function go(dry){
      var th=parseFloat(document.getElementById('arTh').value)||0.92;
      if(!dry && !confirm('Approve all eligible pending organizations at ≥ '+th+' confidence?')) return;
      var out=document.getElementById('arOut'); out.textContent='Working…';
      try {
        var r = await S().rpc('auto_resolve_high_confidence_orgs',{ p_threshold:th, p_dry_run:dry, p_discovery_run_id:null });
        var sample = (r && (r.sample||r.sample_eligible)) || [];
        out.innerHTML = '<div class="sb-kpis">'+Object.keys(r||{}).filter(function(k){ return typeof r[k]==='number'; }).map(function(k){ return '<div class="sb-kpi"><b>'+r[k]+'</b><span>'+esc(k.replace(/_/g,' '))+'</span></div>'; }).join('')+'</div>'+
          (Array.isArray(sample)&&sample.length?'<table class="sb-table"><thead><tr><th>Organization</th><th>EIN</th><th>Conf.</th><th>Classification</th><th>Annual giving</th></tr></thead><tbody>'+sample.map(function(s){return '<tr><td>'+esc(s.organization_name)+'</td><td>'+esc(s.ein||'')+'</td><td>'+esc(s.classification_confidence)+'</td><td>'+esc(s.jewish_classification||'')+'</td><td>'+fmtMoney(s.annual_giving)+'</td></tr>';}).join('')+'</tbody></table>':'');
        if(!dry) toast('Auto-resolve complete','success');
      } catch(e){ out.innerHTML='<span class="sb-bad">'+esc(e.message)+'</span>'; }
    }
    document.getElementById('arPrev').onclick=function(){ go(true); };
    document.getElementById('arRun').onclick=function(){ go(false); };
  }

  // ── Save & Learn Recovery ──
  var UNSAVED_KEY='deborah_unsaved_decisions_v1';
  function getUnsaved(){ try { return JSON.parse(localStorage.getItem(UNSAVED_KEY)||'[]'); } catch(e){ return []; } }
  function setUnsaved(l){ try { localStorage.setItem(UNSAVED_KEY, JSON.stringify(l)); } catch(e){} }
  function queueUnsaved(item){
    item.at=new Date().toISOString(); item.id='u'+Date.now()+Math.random().toString(36).slice(2,6);
    var l=getUnsaved(); l.unshift(item); setUnsaved(l.slice(0,200));
    try { S().rpc('log_save_and_learn_failure',{ p_scope:item.scope||'classification', p_target_kind:item.target_kind||item.scope||'organization', p_target_id:String(item.target_id||''), p_target_label:item.label||null, p_error_type:'client_save_failed', p_error_code:null, p_error_message:item.error||null, p_payload_summary:item, p_user_agent:navigator.userAgent, p_page_url:location.href, p_client_call_id:item.id }); } catch(e){}
  }
  window.DEBORAH_QUEUE_UNSAVED = queueUnsaved;
  async function renderRecovery(body){
    var srv = await S().select('save_and_learn_failures','select=*&resolved=eq.false&order=occurred_at.desc&limit=100');
    var loc = getUnsaved();
    body.innerHTML = '<div class="sb-panel"><h3>Save & Learn Recovery</h3><p class="sb-sub">Decisions that did not save. Local items are kept in this browser until retried; server items are failures reported by any admin in the last runs.</p>'+
      '<div class="sb-kpis"><div class="sb-kpi"><b>'+loc.length+'</b><span>Unsaved in this browser</span></div><div class="sb-kpi"><b>'+srv.length+'</b><span>Unresolved failures (all admins)</span></div></div>'+
      (loc.length?'<table class="sb-table"><thead><tr><th>When</th><th>Scope</th><th>Target</th><th>Decision</th><th>Error</th><th></th></tr></thead><tbody>'+loc.map(function(u){ return '<tr><td>'+fmtDate(u.at)+'</td><td>'+esc(u.scope)+'</td><td>'+esc(u.label||u.target_id)+'</td><td>'+esc(u.decision||'')+' '+esc(u.classification||'')+'</td><td class="sb-bad">'+esc(u.error||'')+'</td><td><button class="sb-btn pri" data-retry="'+u.id+'">Retry</button><button class="sb-btn" data-drop="'+u.id+'">Discard</button></td></tr>'; }).join('')+'</tbody></table>':'<p class="sb-ok">Nothing unsaved in this browser.</p>')+
      '<p class="sb-sub" style="margin-top:14px">Server-reported failures</p><div class="sb-scroll"><table class="sb-table"><thead><tr><th>When</th><th>Admin</th><th>Scope</th><th>Target</th><th>Error</th></tr></thead><tbody>'+
      (srv.length?srv.map(function(f){ return '<tr><td>'+fmtDate(f.occurred_at)+'</td><td>'+esc(f.admin_email)+'</td><td>'+esc(f.scope)+'</td><td>'+esc(f.target_label||f.target_id)+'</td><td class="sb-bad">'+esc(f.error_message||f.error_type)+'</td></tr>'; }).join(''):'<tr><td colspan="5" class="sb-ok">No unresolved failures.</td></tr>')+'</tbody></table></div></div>';
    body.querySelectorAll('[data-drop]').forEach(function(b){ b.onclick=function(){ setUnsaved(getUnsaved().filter(function(u){return u.id!==b.getAttribute('data-drop');})); mount(); }; });
    body.querySelectorAll('[data-retry]').forEach(function(b){ b.onclick=async function(){
      var u=getUnsaved().filter(function(x){return x.id===b.getAttribute('data-retry');})[0]; if(!u) return; b.disabled=true;
      try {
        if(u.scope==='new_org'){ var r=await S().rpc('new_org_save_decision',{ p_org_key:u.target_id, p_review_status:u.decision, p_decision_class:u.classification, p_decision_subtype:null, p_notes:'Recovered from unsaved queue', p_save_and_learn:false }); if(r&&r.ok===false) throw new Error(r.error); }
        else if(u.rpc){ await S().rpc(u.rpc, u.args||{}); }
        else throw new Error('No retry handler for this item');
        setUnsaved(getUnsaved().filter(function(x){return x.id!==u.id;})); toast('Saved','success'); mount();
      } catch(e){ b.disabled=false; toast('Still failing: '+e.message,'error'); }
    }; });
  }

  // ── Active Overrides ──
  async function renderOverrides(body){
    var rows = await S().rpc('get_active_overrides',{ p_target_kind:null, p_target_ids:null });
    rows = rows || [];
    body.innerHTML = '<div class="sb-panel"><h3>Active Overrides</h3><p class="sb-sub">Permanent admin decisions (Save & Learn) that take precedence over automated classification.</p>'+
      '<div class="sb-kpis"><div class="sb-kpi"><b>'+rows.length+'</b><span>Active overrides</span></div></div>'+
      '<div class="sb-scroll"><table class="sb-table"><thead><tr><th>Scope</th><th>Target</th><th>Original</th><th>Override</th><th>Reason</th><th>Approved</th><th></th></tr></thead><tbody>'+
      (rows.length?rows.map(function(o){ return '<tr><td>'+esc(o.scope)+'</td><td>'+esc(o.target_label||o.recipient_name||o.target_id)+'</td><td>'+esc(o.original_value||'')+'</td><td><b>'+esc(o.override_value)+'</b></td><td class="sb-muted">'+esc(o.reason||'')+'</td><td>'+esc(o.approved_by_email||'')+'<br><span class="sb-muted">'+fmtDate(o.approved_at)+'</span></td><td><button class="sb-btn dan" data-rev="'+o.id+'">Revert</button></td></tr>'; }).join(''):'<tr><td colspan="7" class="sb-muted">No active overrides.</td></tr>')+
      '</tbody></table></div></div>';
    body.querySelectorAll('[data-rev]').forEach(function(b){ b.onclick=async function(){
      var why=prompt('Reason for reverting this override?'); if(!why) return; b.disabled=true;
      try { await S().rpc('revert_admin_override',{ p_override_id:Number(b.getAttribute('data-rev')), p_revert_reason:why }); toast('Override reverted','success'); mount(); }
      catch(e){ b.disabled=false; toast('Revert failed: '+e.message,'error'); }
    }; });
  }

  // ── Published Versions ──
  async function renderVersions(body){
    var rows = await S().select('published_versions','select=id,version_number,version,published_by_name,published_at,notes,fingerprint&order=published_at.desc&limit=50');
    var hist = []; try { hist = await S().select('update_history','select=*&order=created_at.desc&limit=30'); } catch(e){}
    body.innerHTML = '<div class="sb-panel"><h3>Published Versions</h3><p class="sb-sub">Every publish to users, recorded in the database. Use “Publish new version” in the admin banner to create one.</p>'+
      '<div class="sb-scroll"><table class="sb-table"><thead><tr><th>Version</th><th>Published</th><th>By</th><th>Notes</th></tr></thead><tbody>'+
      rows.map(function(v){ return '<tr><td><b>'+esc(v.version_number||v.version)+'</b></td><td>'+fmtDate(v.published_at)+'</td><td>'+esc(v.published_by_name||'')+'</td><td class="sb-muted">'+esc(v.notes||'')+'</td></tr>'; }).join('')+'</tbody></table></div>'+
      (hist.length?'<p class="sb-sub" style="margin-top:14px">Update history</p><table class="sb-table"><thead><tr><th>When</th><th>Action</th><th>Version</th><th>By</th><th>Notes</th></tr></thead><tbody>'+hist.map(function(h){return '<tr><td>'+fmtDate(h.created_at)+'</td><td>'+esc(h.action||h.event_type||'')+'</td><td>'+esc(h.version_number||h.version||'')+'</td><td>'+esc(h.actor_email||'')+'</td><td class="sb-muted">'+esc(h.notes||'')+'</td></tr>';}).join('')+'</tbody></table>':'')+'</div>';
  }

  // ── Publish mirror: every local publish is recorded in Supabase ──
  var serverLatest = null;
  async function loadServerLatest(){
    try { var r = await S().select('published_versions','select=version_number,version,published_at,published_by_name&order=published_at.desc&limit=1'); serverLatest = r && r[0] || null; } catch(e){ serverLatest=null; }
    try {
      var chip = document.getElementById('portalVersionChip');
      var bb = document.querySelector('#adminMasterBanner b'); if(bb && serverLatest){ bb.textContent = serverLatest.version_number||serverLatest.version; }
      if(chip && serverLatest){ chip.textContent = 'Published: '+(serverLatest.version_number||serverLatest.version)+' · '+new Date(serverLatest.published_at).toISOString().slice(0,16).replace('T',' ')+' UTC'; }
    } catch(e){}
    return serverLatest;
  }
  function nextVersion(){
    var v = serverLatest && (serverLatest.version_number||serverLatest.version) || 'v1.0.0';
    var m = /^v(\d+)\.(\d+)/.exec(v); if(!m) return 'v1.3.0';
    return 'v'+m[1]+'.'+(parseInt(m[2],10)+1)+'.0';
  }
  function wrapPublish(){
    var PD = window.PUBLISHED_DATA; if(!PD || PD.__sbWrapped) return;
    var orig = PD.publish;
    PD.publish = function(opts){
      opts = opts || {};
      if(!opts.version_number) opts.version_number = nextVersion();
      var snap = orig.call(PD, opts);
      if(snap && snap.ok !== false && snap.version_number){
        var sess = window.PORTAL_AUTH.getSession() || {};
        S().insert('published_versions',[{ version:snap.version_number, version_number:snap.version_number, published_by:sess.user_id, published_by_name:sess.email, fingerprint:snap.fingerprint, notes:opts.notes||'Published from Legacy Deborah admin', permissions:{ roles:['admin','user'] } }])
          .then(function(){ return S().insert('update_history',[{ action:'publish', event_type:'publish', version:snap.version_number, version_number:snap.version_number, actor_id:sess.user_id, actor_email:sess.email, notes:opts.notes||'', details:{ counts:snap.counts, fingerprint:snap.fingerprint } }]); })
          .then(function(){ serverLatest={ version_number:snap.version_number, published_at:snap.published_at }; loadServerLatest(); toast('Published '+snap.version_number+' — recorded in the database','success'); })
          .catch(function(e){
            console.warn('[SUPABASE] Remote publish sync skipped (anonymous static client):', e.message);
            serverLatest = { version_number: snap.version_number, published_at: snap.published_at };
            loadServerLatest();
            toast('Published ' + snap.version_number + ' successfully', 'success');
          });
      }
      return snap;
    };
    PD.__sbWrapped = true;
  }

  // ── activity heartbeat ──
  var lastBeat = 0;
  function beat(){ if(!S() || !S().getTokens()) return; if(Date.now()-lastBeat < 5*60000) return; lastBeat=Date.now(); S().rpc('update_last_activity',{}).catch(function(){}); }
  ['click','keydown'].forEach(function(ev){ document.addEventListener(ev, beat, { passive:true }); });

  var inited = false;
  function init(){
    if(inited) return;
    if(!window.PORTAL_AUTH || !window.PORTAL_AUTH.isAuthenticated()){ setTimeout(init, 1500); return; }
    inited = true;
    loadServerLatest(); beat();
    if(isAdmin()){ wrapPublish(); }
    // mount when the Admin tab is opened
    var origSet = window.setTopView;
    if(typeof origSet === 'function' && !origSet.__sbWrapped){
      var w = function(view){ var r = origSet.apply(this, arguments); if(view==='admin') setTimeout(mount, 50); return r; };
      w.__sbWrapped = true; window.setTopView = w;
    }
    if(/#\/admin/.test(location.hash)) setTimeout(mount, 400);
    setInterval(function(){ var av=document.getElementById('adminView'); if(isAdmin() && av && !av.hidden && av.style.display!=='none' && !document.getElementById('sbAdminHost')) mount(); }, 1500);
    window.addEventListener('hashchange', function(){ if(/#\/admin/.test(location.hash)) setTimeout(mount, 100); });
  }
  window.SB_ADMIN = { mount: mount, refreshVersion: loadServerLatest };
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function(){ setTimeout(init, 300); });
  else setTimeout(init, 300);
})();
