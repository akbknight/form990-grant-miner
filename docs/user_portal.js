/* ============================================================================
 * user_portal.js — User-facing portal (Users + Guests)
 * ----------------------------------------------------------------------------
 * Renders the User Portal shell with role-aware nav and pages. Reads ONLY
 * from window.PUBLISHED_DATA — never from raw globals.
 *
 * Pages:  Overview · Insights · Recipients · Foundations · Search · About
 *
 * Mounted by portal_auth.js after a successful User or Guest login.
 * ========================================================================== */
(function(){
  'use strict';

  var STATE = {
    page: 'overview',
    session: null,
    filters: { q:'', minValue:0, year:null, sector:null }
  };

  function escH(s){
    return String(s==null?'':s).replace(/[&<>"']/g, function(c){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }
  function fmtMoney(n){
    if(n==null || isNaN(n)) return '—';
    n = Number(n);
    if(n >= 1e9) return '$'+(n/1e9).toFixed(2)+'B';
    if(n >= 1e6) return '$'+(n/1e6).toFixed(2)+'M';
    if(n >= 1e3) return '$'+(n/1e3).toFixed(1)+'K';
    return '$'+n.toFixed(0);
  }
  function fmtInt(n){
    if(n==null || isNaN(n)) return '—';
    return Number(n).toLocaleString('en-US');
  }
  function fmtTs(iso){
    if(!iso) return '—';
    try { return new Date(iso).toISOString().replace('T',' ').replace(/\..*/, ' UTC'); }
    catch(e){ return iso; }
  }

  // ── Data accessors (PUBLISHED layer only) ────────────────────────────────
  function pub(){ return window.PUBLISHED_DATA && window.PUBLISHED_DATA.getCurrent(); }
  function pdata(key){ return window.PUBLISHED_DATA ? window.PUBLISHED_DATA.get(key) : null; }
  function totals(){
    var d = pdata('DASHBOARD_DATA');
    if(d && d.totals) return d.totals;
    return null;
  }
  function recipients(){
    var d = pdata('JEWISH_RECIPIENTS_LIST') || pdata('RECIPIENTS');
    if(Array.isArray(d)) return d;
    if(d && Array.isArray(d.items)) return d.items;
    if(d && Array.isArray(d.rows))  return d.rows;
    return [];
  }
  function foundations(){
    var d = pdata('FOUNDATIONS_LIST');
    if(Array.isArray(d)) return d;
    // Fallback: derive from grants
    var grants = pdata('RECIPIENT_GRANTS') || pdata('JEWISH_RECIPIENT_GRANTS');
    if(!grants || !Array.isArray(grants)) {
      // Try DASHBOARD_DATA.foundations
      var dd = pdata('DASHBOARD_DATA');
      if(dd && Array.isArray(dd.foundations)) return dd.foundations;
      if(dd && Array.isArray(dd.top_funders)) return dd.top_funders;
      return [];
    }
    var map = {};
    grants.forEach(function(g){
      var name = g.foundation_name || g.donor_name || g.funder || g.foundation;
      if(!name) return;
      if(!map[name]) map[name] = { name:name, grant_count:0, total_value:0 };
      map[name].grant_count++;
      map[name].total_value += Number(g.amount || g.grant_value || 0);
    });
    return Object.keys(map).map(function(k){ return map[k]; }).sort(function(a,b){ return b.total_value - a.total_value; });
  }
  function insights(){
    return pdata('INSIGHTS_DATA') || pdata('SUBJECT_TRENDS') || null;
  }

  // ── Style ────────────────────────────────────────────────────────────────
  function injectCss(){
    if(document.getElementById('user-portal-styles')) return;
    var css = ''+
    '#userPortalRoot{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1a1a1a;background:#f4f6fa;min-height:100vh;}'+
    '.up-shell{max-width:1400px;margin:0 auto;padding:24px 28px 60px;}'+
    '.up-banner{background:linear-gradient(135deg,#0a1733,#13284d);color:#fff;padding:18px 24px;border-radius:10px;display:flex;align-items:center;gap:16px;margin-bottom:18px;box-shadow:0 8px 24px rgba(10,23,51,0.15);}'+
    '.up-logo{width:54px;height:54px;border-radius:10px;background:radial-gradient(circle at 30% 30%,#2ce1d8 0%,#1f6f8b 60%,#0a1733 100%);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:22px;letter-spacing:.08em;flex-shrink:0;box-shadow:0 4px 14px rgba(44,225,216,0.35);}'+
    '.up-banner h1{margin:0;font-size:24px;font-weight:900;letter-spacing:.18em;color:#fff;}'+
    '.up-banner .sub{font-size:11px;letter-spacing:.22em;color:#b8893a;text-transform:uppercase;margin-top:3px;}'+
    '.up-meta{margin-left:auto;text-align:right;font-size:11px;color:rgba(255,255,255,0.7);letter-spacing:.04em;line-height:1.6;}'+
    '.up-meta b{color:#9ed3e0;}'+
    '.up-nav{display:flex;gap:4px;background:#fff;border:1px solid #e1e6ed;border-radius:8px;padding:6px;margin-bottom:18px;}'+
    '.up-nav button{flex:0 0 auto;padding:10px 18px;border:none;background:transparent;color:#4b5e7a;font-size:13px;font-weight:600;cursor:pointer;border-radius:6px;letter-spacing:.02em;}'+
    '.up-nav button:hover{background:#f4f6fa;color:#0a1733;}'+
    '.up-nav button.active{background:linear-gradient(90deg,#1f6f8b,#2ce1d8);color:#fff;}'+
    '.up-nav button:disabled{opacity:.35;cursor:not-allowed;}'+
    '.up-publish-banner{background:#fff4d4;border:1px solid #e3c372;border-radius:8px;padding:14px 18px;margin-bottom:18px;display:flex;align-items:center;gap:14px;font-size:13px;color:#5c4400;}'+
    '.up-publish-banner button{margin-left:auto;background:#b8893a;color:#fff;border:none;padding:8px 16px;border-radius:6px;font-weight:600;cursor:pointer;}'+
    '.up-empty{background:#fff;border:1px dashed #d4dae3;border-radius:10px;padding:48px;text-align:center;color:#6a7a92;font-style:italic;}'+
    '.up-card{background:#fff;border:1px solid #e1e6ed;border-radius:10px;padding:20px 22px;box-shadow:0 1px 2px rgba(10,23,51,0.04);}'+
    '.up-card h3{margin:0 0 10px;font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#6a7a92;}'+
    '.up-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-bottom:18px;}'+
    '.up-kpi{background:#fff;border:1px solid #e1e6ed;border-radius:10px;padding:18px 22px;}'+
    '.up-kpi .label{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6a7a92;margin-bottom:6px;}'+
    '.up-kpi .value{font-size:28px;font-weight:800;color:#0a1733;letter-spacing:-0.01em;font-variant-numeric:tabular-nums;}'+
    '.up-kpi .sub{font-size:12px;color:#6a7a92;margin-top:4px;}'+
    '.up-table{width:100%;border-collapse:collapse;font-size:13px;}'+
    '.up-table th{text-align:left;padding:9px 12px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#6a7a92;border-bottom:1px solid #e1e6ed;background:#fafbfd;}'+
    '.up-table td{padding:10px 12px;border-bottom:1px solid #f0f2f6;vertical-align:top;}'+
    '.up-table tr:hover td{background:#fafbfd;}'+
    '.up-table .num{text-align:right;font-variant-numeric:tabular-nums;}'+
    '.up-filters{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;}'+
    '.up-filters input,.up-filters select{padding:8px 12px;border:1px solid #d4dae3;border-radius:6px;font-size:13px;background:#fff;color:#1a1a1a;}'+
    '.up-filters input{min-width:240px;}'+
    '.up-pill{display:inline-block;padding:2px 9px;border-radius:10px;font-size:11px;font-weight:600;background:#e6eef7;color:#1f4a6f;}'+
    '.up-pill.warn{background:#fff4d4;color:#7a5300;}'+
    '.up-pill.ok{background:#dff5e3;color:#1e5c2f;}'+
    '.up-btn{padding:8px 14px;border:1px solid #d4dae3;background:#fff;color:#1a1a1a;border-radius:6px;font-size:12px;font-weight:500;cursor:pointer;}'+
    '.up-btn:hover{background:#f4f6fa;}'+
    '.up-btn.primary{background:#1f6f8b;color:#fff;border-color:#1f6f8b;}'+
    '.up-btn:disabled{opacity:.4;cursor:not-allowed;}'+
    '.up-row-2{display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:18px;}'+
    '@media(max-width:900px){.up-row-2{grid-template-columns:1fr;}}'+
    '.up-bar{height:8px;background:#eef1f6;border-radius:4px;overflow:hidden;margin-top:8px;}'+
    '.up-bar > div{height:100%;background:linear-gradient(90deg,#1f6f8b,#2ce1d8);border-radius:4px;}'+
    '.up-profile-h{display:flex;align-items:baseline;gap:14px;margin-bottom:14px;}'+
    '.up-profile-h h2{margin:0;font-size:22px;font-weight:800;color:#0a1733;letter-spacing:-0.01em;}'+
    '.up-back{background:none;border:none;color:#1f6f8b;cursor:pointer;font-size:13px;font-weight:600;margin-bottom:8px;}'+
    '';
    var s = document.createElement('style');
    s.id = 'user-portal-styles'; s.textContent = css;
    document.head.appendChild(s);
  }

  // ── Pages ────────────────────────────────────────────────────────────────
  function pageOverview(){
    var t = totals(); var p = pub();
    if(!p){
      return '<div class="up-empty">No data has been published to the User Portal yet. Please ask an administrator to publish a version.</div>';
    }
    // Section gating for guests
    function shows(section){ return window.PORTAL_AUTH.canAccessSection('dashboard', section) || window.PORTAL_AUTH.getRole()==='admin'; }
    var kpiHtml = '';
    if(shows('overview_kpis') && t){
      kpiHtml = ''+
      '<div class="up-grid">'+
        '<div class="up-kpi"><div class="label">Total grant value tracked</div><div class="value">'+fmtMoney(t.value)+'</div><div class="sub">All published grants</div></div>'+
        '<div class="up-kpi"><div class="label">Grants</div><div class="value">'+fmtInt(t.grants)+'</div><div class="sub">Across all years</div></div>'+
        '<div class="up-kpi"><div class="label">Grantmaking foundations</div><div class="value">'+fmtInt(t.foundations)+'</div><div class="sub">Active sources</div></div>'+
        '<div class="up-kpi"><div class="label">Approved recipients</div><div class="value">'+fmtInt(recipients().length||t.recipients||0)+'</div><div class="sub">Verified profiles</div></div>'+
      '</div>';
    }
    var compHtml = '';
    if(shows('overview_composition') && t && (t.jewish || t.jewish_value)){
      var j = t.jewish_value || 0, n = t.non_jewish_value || 0, m = t.misc_value || 0;
      var total = j + n + m || 1;
      compHtml = ''+
      '<div class="up-card" style="margin-bottom:18px;">'+
        '<h3>Composition of published grant value</h3>'+
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin-top:10px;">'+
          '<div><div style="font-size:11px;color:#6a7a92;letter-spacing:.05em;">Jewish-oriented</div><div style="font-size:18px;font-weight:700;color:#0a1733;">'+fmtMoney(j)+' <span style="font-size:12px;color:#6a7a92;font-weight:400;">('+(100*j/total).toFixed(1)+'%)</span></div><div class="up-bar"><div style="width:'+(100*j/total).toFixed(1)+'%;"></div></div></div>'+
          '<div><div style="font-size:11px;color:#6a7a92;letter-spacing:.05em;">Non-Jewish</div><div style="font-size:18px;font-weight:700;color:#0a1733;">'+fmtMoney(n)+' <span style="font-size:12px;color:#6a7a92;font-weight:400;">('+(100*n/total).toFixed(1)+'%)</span></div><div class="up-bar"><div style="width:'+(100*n/total).toFixed(1)+'%;background:#b8893a;"></div></div></div>'+
          '<div><div style="font-size:11px;color:#6a7a92;letter-spacing:.05em;">Miscellaneous</div><div style="font-size:18px;font-weight:700;color:#0a1733;">'+fmtMoney(m)+' <span style="font-size:12px;color:#6a7a92;font-weight:400;">('+(100*m/total).toFixed(1)+'%)</span></div><div class="up-bar"><div style="width:'+(100*m/total).toFixed(1)+'%;background:#7a5300;"></div></div></div>'+
        '</div>'+
      '</div>';
    }
    return kpiHtml + compHtml;
  }

  function pageInsights(){
    if(!window.PORTAL_AUTH.canAccessPage('insights')){
      return '<div class="up-empty">Access to the Insights page is not enabled for your account. Please contact an administrator.</div>';
    }
    var ins = insights();
    if(!ins){
      return '<div class="up-empty">No insights have been published yet.</div>';
    }
    // Render whatever shape we got — try common keys
    var html = '<div class="up-grid">';
    if(Array.isArray(ins.top_subjects)){
      html += '<div class="up-card"><h3>Top funding subjects</h3><table class="up-table"><thead><tr><th>Subject</th><th class="num">Value</th></tr></thead><tbody>';
      ins.top_subjects.slice(0,10).forEach(function(s){
        html += '<tr><td>'+escH(s.label||s.subject||'')+'</td><td class="num">'+fmtMoney(s.value||s.total)+'</td></tr>';
      });
      html += '</tbody></table></div>';
    }
    if(Array.isArray(ins.trends)){
      html += '<div class="up-card"><h3>Year-over-year trends</h3><table class="up-table"><thead><tr><th>Year</th><th class="num">Value</th><th class="num">Grants</th></tr></thead><tbody>';
      ins.trends.slice(0,10).forEach(function(s){
        html += '<tr><td>'+escH(s.year||s.label)+'</td><td class="num">'+fmtMoney(s.value||s.total)+'</td><td class="num">'+fmtInt(s.count||s.grants)+'</td></tr>';
      });
      html += '</tbody></table></div>';
    }
    html += '</div>';
    if(html === '<div class="up-grid"></div>'){
      html = '<div class="up-card"><h3>Published insights</h3><pre style="font-size:11px;color:#4b5e7a;overflow:auto;max-height:400px;white-space:pre-wrap;background:#fafbfd;padding:14px;border-radius:6px;">'+escH(JSON.stringify(ins, null, 2).slice(0,4000))+'</pre></div>';
    }
    return html;
  }

  function pageRecipients(){
    if(!window.PORTAL_AUTH.canAccessPage('recipients')){
      return '<div class="up-empty">Recipients are not available for your account.</div>';
    }
    var list = recipients();
    if(!list.length) return '<div class="up-empty">No recipients have been published yet.</div>';
    var q = (STATE.filters.q||'').toLowerCase();
    var filtered = q ? list.filter(function(r){
      return JSON.stringify(r).toLowerCase().indexOf(q) >= 0;
    }) : list;
    var top = filtered.slice(0, 200);
    var html = ''+
      '<div class="up-filters">'+
        '<input type="text" id="upRecipQ" placeholder="Search recipients…" value="'+escH(STATE.filters.q)+'" oninput="window.USER_PORTAL.setFilter(\'q\', this.value)">'+
        '<span class="up-pill">Showing '+top.length+' of '+filtered.length+' published recipients</span>'+
      '</div>'+
      '<div class="up-card">'+
      '<table class="up-table"><thead><tr><th>Recipient</th><th>Location</th><th class="num">Grants</th><th class="num">Total value</th><th></th></tr></thead><tbody>';
    top.forEach(function(r){
      var name = r.name || r.recipient_name || r.org_name || '—';
      var loc  = r.location || r.city || r.state || '';
      var cnt  = r.grant_count || r.num_grants || (r.grants && r.grants.length) || '—';
      var val  = r.total_value || r.total_grant_value || r.value;
      var id   = r.id || r.recipient_id || name;
      html += '<tr>'+
        '<td><b>'+escH(name)+'</b></td>'+
        '<td>'+escH(loc)+'</td>'+
        '<td class="num">'+fmtInt(cnt)+'</td>'+
        '<td class="num">'+(val?fmtMoney(val):'—')+'</td>'+
        '<td><button class="up-btn" onclick="window.USER_PORTAL.openRecipient('+JSON.stringify(String(id)).replace(/"/g,'&quot;')+')">View</button></td>'+
      '</tr>';
    });
    html += '</tbody></table></div>';
    return html;
  }

  function pageFoundations(){
    if(!window.PORTAL_AUTH.canAccessPage('foundations')){
      return '<div class="up-empty">Foundations / Donors are not available for your account.</div>';
    }
    var list = foundations();
    if(!list.length) return '<div class="up-empty">No foundations have been published yet.</div>';
    var q = (STATE.filters.q||'').toLowerCase();
    var filtered = q ? list.filter(function(f){
      return JSON.stringify(f).toLowerCase().indexOf(q) >= 0;
    }) : list;
    var top = filtered.slice(0, 200);
    var html = ''+
      '<div class="up-filters">'+
        '<input type="text" placeholder="Search foundations / donors…" value="'+escH(STATE.filters.q)+'" oninput="window.USER_PORTAL.setFilter(\'q\', this.value)">'+
        '<span class="up-pill">Showing '+top.length+' of '+filtered.length+'</span>'+
      '</div>'+
      '<div class="up-card">'+
      '<table class="up-table"><thead><tr><th>Foundation / Donor</th><th class="num">Grants</th><th class="num">Total value</th><th></th></tr></thead><tbody>';
    top.forEach(function(f){
      var name = f.name || f.foundation_name || f.donor_name || '—';
      var cnt  = f.grant_count || f.num_grants || '—';
      var val  = f.total_value || f.total_grant_value || f.value;
      var id   = f.id || f.foundation_id || name;
      html += '<tr>'+
        '<td><b>'+escH(name)+'</b></td>'+
        '<td class="num">'+fmtInt(cnt)+'</td>'+
        '<td class="num">'+(val?fmtMoney(val):'—')+'</td>'+
        '<td><button class="up-btn" onclick="window.USER_PORTAL.openFoundation('+JSON.stringify(String(id)).replace(/"/g,'&quot;')+')">View</button></td>'+
      '</tr>';
    });
    html += '</tbody></table></div>';
    return html;
  }

  function pageSearch(){
    if(!window.PORTAL_AUTH.canAccessPage('search')){
      return '<div class="up-empty">Search is not available for your account.</div>';
    }
    var q = (STATE.filters.q||'').toLowerCase();
    var html = ''+
      '<div class="up-filters">'+
        '<input type="text" placeholder="Search recipients, foundations, grants…" value="'+escH(STATE.filters.q)+'" oninput="window.USER_PORTAL.setFilter(\'q\', this.value)" autofocus>'+
      '</div>';
    if(!q){
      html += '<div class="up-empty">Type to search across all published recipients and foundations.</div>';
      return html;
    }
    var recHits = recipients().filter(function(r){ return JSON.stringify(r).toLowerCase().indexOf(q)>=0; }).slice(0,50);
    var fndHits = foundations().filter(function(f){ return JSON.stringify(f).toLowerCase().indexOf(q)>=0; }).slice(0,50);
    html += '<div class="up-row-2">'+
      '<div class="up-card"><h3>Recipients ('+recHits.length+')</h3>'+
        (recHits.length?'<table class="up-table"><tbody>'+recHits.map(function(r){
          var name = r.name||r.recipient_name||r.org_name||'—';
          return '<tr><td><b>'+escH(name)+'</b><div style="font-size:11px;color:#6a7a92;">'+escH(r.location||r.city||'')+'</div></td></tr>';
        }).join('')+'</tbody></table>':'<div class="up-empty">No matching recipients.</div>')+
      '</div>'+
      '<div class="up-card"><h3>Foundations / Donors ('+fndHits.length+')</h3>'+
        (fndHits.length?'<table class="up-table"><tbody>'+fndHits.map(function(f){
          var name = f.name||f.foundation_name||f.donor_name||'—';
          return '<tr><td><b>'+escH(name)+'</b></td></tr>';
        }).join('')+'</tbody></table>':'<div class="up-empty">No matching foundations.</div>')+
      '</div>'+
    '</div>';
    return html;
  }

  function pageAbout(){
    var p = pub();
    var stats = p ? p.counts : null;
    return ''+
    '<div class="up-card" style="margin-bottom:14px;">'+
      '<h3>About this data</h3>'+
      '<p style="line-height:1.7;color:#3a4859;">The Deborah User Portal exposes the most recent <b>approved and published</b> snapshot of the Deborah philanthropic intelligence dataset. All records have been reviewed, classified, and signed off by an administrator before publication.</p>'+
      '<p style="line-height:1.7;color:#3a4859;">Draft uploads, staging records, items in the review queue, and flagged records are <b>never</b> visible to Users or Guests. Only the master dataset that the administrator explicitly published reaches this portal.</p>'+
    '</div>'+
    '<div class="up-grid">'+
      '<div class="up-kpi"><div class="label">Published version</div><div class="value" style="font-size:22px;">'+(p?escH(p.version_number):'—')+'</div><div class="sub">'+(p?fmtTs(p.published_at):'No version published yet')+'</div></div>'+
      '<div class="up-kpi"><div class="label">Published by</div><div class="value" style="font-size:18px;">'+(p&&p.published_by?escH(p.published_by.admin_name):'—')+'</div><div class="sub">Administrator</div></div>'+
      '<div class="up-kpi"><div class="label">Recipients</div><div class="value" style="font-size:22px;">'+(stats?fmtInt(stats.recipients):'—')+'</div></div>'+
      '<div class="up-kpi"><div class="label">Grants</div><div class="value" style="font-size:22px;">'+(stats?fmtInt(stats.grants):'—')+'</div></div>'+
    '</div>'+
    '<div class="up-card" style="margin-top:14px;">'+
      '<h3>Confidentiality</h3>'+
      '<p style="line-height:1.7;color:#3a4859;">This information is confidential and intended only for authorized Deborah users. Sharing screenshots, exports, or excerpts outside of your authorized scope is not permitted.</p>'+
      '<p style="line-height:1.7;color:#3a4859;">Developed &amp; Engineered by Akshay Kumar.</p>'+
    '</div>';
  }

  // ── Detail pages ─────────────────────────────────────────────────────────
  STATE.detail = null;
  function openRecipient(id){
    var list = recipients();
    var rec = list.find(function(r){ return String(r.id||r.recipient_id||r.name||r.recipient_name||r.org_name) === String(id); });
    STATE.detail = rec ? { type:'recipient', record: rec } : null;
    render();
  }
  function openFoundation(id){
    var list = foundations();
    var f = list.find(function(r){ return String(r.id||r.foundation_id||r.name||r.foundation_name||r.donor_name) === String(id); });
    STATE.detail = f ? { type:'foundation', record: f } : null;
    render();
  }
  function closeDetail(){ STATE.detail = null; render(); }
  function pageDetail(){
    var d = STATE.detail; if(!d) return '';
    var rec = d.record;
    var name = rec.name || rec.recipient_name || rec.org_name || rec.foundation_name || rec.donor_name || '—';
    var rows = Object.keys(rec).filter(function(k){
      var v = rec[k];
      return v != null && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean');
    }).map(function(k){
      return '<tr><td style="color:#6a7a92;width:34%;text-transform:uppercase;font-size:11px;letter-spacing:.05em;">'+escH(k)+'</td><td>'+escH(rec[k])+'</td></tr>';
    }).join('');
    return ''+
    '<button class="up-back" onclick="window.USER_PORTAL.closeDetail()">← Back</button>'+
    '<div class="up-profile-h"><h2>'+escH(name)+'</h2><span class="up-pill">'+(d.type==='recipient'?'Recipient profile':'Foundation / Donor profile')+'</span></div>'+
    '<div class="up-card"><table class="up-table"><tbody>'+rows+'</tbody></table></div>';
  }

  // ── Render ───────────────────────────────────────────────────────────────
  function setPage(p){ STATE.page = p; STATE.detail = null; render(); }
  function setFilter(k,v){ STATE.filters[k] = v; render(); }

  function buildNav(){
    var s = STATE.session;
    var pages = [
      ['overview','Overview Dashboard'],
      ['insights','Insights'],
      ['recipients','Recipients'],
      ['foundations','Foundations / Donors'],
      ['search','Search'],
      ['about','About the Data']
    ];
    return '<div class="up-nav">'+pages.map(function(p){
      var allowed = window.PORTAL_AUTH.canAccessPage(p[0]);
      var cls = (STATE.page===p[0]?'active':'');
      return '<button class="'+cls+'" '+(!allowed?'disabled title="Not enabled for your account"':'onclick="window.USER_PORTAL.setPage(\''+p[0]+'\')"')+'>'+escH(p[1])+'</button>';
    }).join('')+'</div>';
  }

  function buildBanner(){
    var s = STATE.session;
    var p = pub();
    return ''+
    '<div class="up-banner">'+
      '<div class="up-logo">D</div>'+
      '<div><h1>DEBORAH</h1><div class="sub">Philanthropic Intelligence Platform</div></div>'+
      '<div class="up-meta">'+
        '<div>CONFIDENTIAL — Authorized Users Only</div>'+
        '<div>Logged in as <b>'+escH(s.name)+'</b> · '+escH(s.role.toUpperCase())+(s.expires_at?(' · expires '+fmtTs(s.expires_at)):'')+'</div>'+
        '<div>Data last updated: <b>'+(p?fmtTs(p.published_at):'No published version yet')+'</b></div>'+
        '<div>Published version: <b>'+(p?escH(p.version_number):'—')+'</b></div>'+
      '</div>'+
    '</div>';
  }

  var _pendingUpdate = false;
  function showUpdateBanner(){
    _pendingUpdate = true;
    render();
  }
  function buildUpdateBanner(){
    if(!_pendingUpdate) return '';
    return '<div class="up-publish-banner">'+
      '<b>A new approved Deborah data update is available.</b> Refresh to view the latest published version.'+
      '<button onclick="window.location.reload()">Refresh Now</button>'+
    '</div>';
  }

  function pageBody(){
    if(STATE.detail) return pageDetail();
    switch(STATE.page){
      case 'overview':    return pageOverview();
      case 'insights':    return pageInsights();
      case 'recipients':  return pageRecipients();
      case 'foundations': return pageFoundations();
      case 'search':      return pageSearch();
      case 'about':       return pageAbout();
    }
    return pageOverview();
  }

  function render(){
    var root = document.getElementById('userPortalRoot');
    if(!root) return;
    injectCss();
    root.innerHTML = '<div class="up-shell">'+ buildBanner() + buildUpdateBanner() + buildNav() + pageBody() +'</div>';
  }

  // ── Mount ────────────────────────────────────────────────────────────────
  function mount(session){
    STATE.session = session;
    // Default page based on what the user can access
    if(!window.PORTAL_AUTH.canAccessPage(STATE.page)){
      var pref = ['overview','about','insights','recipients','foundations','search'];
      for(var i=0;i<pref.length;i++){
        if(window.PORTAL_AUTH.canAccessPage(pref[i])){ STATE.page = pref[i]; break; }
      }
    }
    // Ensure root container exists
    var root = document.getElementById('userPortalRoot');
    if(!root){
      root = document.createElement('div');
      root.id = 'userPortalRoot';
      document.body.appendChild(root);
    }
    render();
    // Listen for cross-tab publication events
    window.addEventListener('storage', function(e){
      if(e.key === 'deborah_published_data_v1') showUpdateBanner();
    });
    // Same-tab event (admin published in this tab — shouldn't happen for users,
    // but harmless)
    window.addEventListener('deborah:published', function(){ showUpdateBanner(); });
  }

  // ── Public API ───────────────────────────────────────────────────────────
  window.USER_PORTAL = {
    mount: mount,
    setPage: setPage,
    setFilter: setFilter,
    openRecipient: openRecipient,
    openFoundation: openFoundation,
    closeDetail: closeDetail,
    showUpdateBanner: showUpdateBanner,
    render: render
  };

})();
