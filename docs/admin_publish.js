/* ============================================================================
 * admin_publish.js — Admin-side Publish to User Portal + Access Management
 * ----------------------------------------------------------------------------
 * Adds three new Admin-only sections inside the Updates Center:
 *   1. Publish to User Portal — clearly separate from "Approve & Merge"
 *   2. Published Version History — list + rollback
 *   3. Access Management — invite / activate / revoke / configure users
 *
 * Mounts after updates_center.js has rendered and only if the current
 * session role is admin.
 * ========================================================================== */
(function(){
  'use strict';

  function escH(s){
    return String(s==null?'':s).replace(/[&<>"']/g, function(c){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }
  function fmtTs(iso){
    if(!iso) return '—';
    try { return new Date(iso).toISOString().replace('T',' ').replace(/\..*/, ' UTC'); }
    catch(e){ return iso; }
  }
  function fmtInt(n){
    if(n==null) return '—';
    try { return Number(n).toLocaleString('en-US'); } catch(e){ return String(n); }
  }

  function isAdmin(){
    return window.PORTAL_AUTH && window.PORTAL_AUTH.isAdmin && window.PORTAL_AUTH.isAdmin();
  }

  function injectCss(){
    if(document.getElementById('admin-publish-styles')) return;
    var css = ''+
    '.ap-section{background:#fff;border:1px solid #e1e6ed;border-radius:8px;padding:18px 22px;margin:14px 0;}'+
    '.ap-section h2{margin:0 0 8px;font-size:17px;font-weight:600;}'+
    '.ap-section .sub{color:#6b7280;font-size:12.5px;margin-bottom:14px;}'+
    '.ap-btn{padding:9px 18px;border-radius:6px;border:1px solid #d1d5db;background:#fff;color:#1a1a1a;font-size:13px;font-weight:600;cursor:pointer;}'+
    '.ap-btn:hover{background:#f4f6fa;}'+
    '.ap-btn.primary{background:#01696f;color:#fff;border-color:#01696f;}'+
    '.ap-btn.primary:hover{background:#0c4e54;}'+
    '.ap-btn.danger{background:#a12c2c;color:#fff;border-color:#a12c2c;}'+
    '.ap-btn.warn{background:#b8893a;color:#fff;border-color:#b8893a;}'+
    '.ap-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:14px;}'+
    '.ap-kpi{background:#fafbfd;border:1px solid #e1e6ed;border-radius:6px;padding:12px 14px;}'+
    '.ap-kpi .lbl{font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;}'+
    '.ap-kpi .val{font-size:20px;font-weight:700;color:#0a1733;font-variant-numeric:tabular-nums;}'+
    '.ap-table{width:100%;border-collapse:collapse;font-size:12.5px;}'+
    '.ap-table th{text-align:left;padding:8px 10px;background:#fafbfd;border-bottom:1px solid #e5e7eb;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:#374151;white-space:nowrap;}'+
    '.ap-table td{padding:8px 10px;border-bottom:1px solid #f0f2f6;vertical-align:top;}'+
    '.ap-pill{display:inline-block;padding:2px 7px;border-radius:10px;font-size:10.5px;font-weight:600;background:#e6eef7;color:#1f4a6f;}'+
    '.ap-pill.ok{background:#dff5e3;color:#1e5c2f;}'+
    '.ap-pill.warn{background:#fff4d4;color:#7a5300;}'+
    '.ap-pill.err{background:#fde7ea;color:#a12c2c;}'+
    '.ap-form{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px;}'+
    '.ap-form label{display:block;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;}'+
    '.ap-form input,.ap-form select,.ap-form textarea{width:100%;padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px;box-sizing:border-box;}'+
    '.ap-banner{background:#dff5e3;border:1px solid #8acaa0;color:#1e5c2f;padding:10px 14px;border-radius:6px;font-size:13px;margin-bottom:12px;}';
    var s = document.createElement('style'); s.id='admin-publish-styles'; s.textContent=css;
    document.head.appendChild(s);
  }

  // ── Publish workflow UI ──────────────────────────────────────────────────
  function renderPublishPanel(){
    var host = document.getElementById('updatesPublishPanel');
    if(!host) return;
    var current = window.PUBLISHED_DATA.getCurrent();
    var counts  = window.PUBLISHED_DATA.inferCounts();
    var html = ''+
    '<div class="ap-section">'+
      '<h2>Publish to User Portal</h2>'+
      '<div class="sub">Separate from "Approve &amp; Merge." Merge updates first, review the resulting Dashboard and Insights, then publish a new version for User and Guest sessions.</div>'+
      (current ?
        '<div class="ap-banner">Currently published: <b>'+escH(current.version_number)+'</b> · '+escH(fmtTs(current.published_at))+' · by <b>'+escH(current.published_by&&current.published_by.admin_name||'—')+'</b></div>'
        :
        '<div class="ap-banner" style="background:#fff4d4;border-color:#e3c372;color:#7a5300;">No version has been published to the User Portal yet. Users and Guests cannot see any data until you publish.</div>'
      )+
      '<div class="ap-grid">'+
        '<div class="ap-kpi"><div class="lbl">Recipients (live)</div><div class="val">'+fmtInt(counts.recipients)+'</div></div>'+
        '<div class="ap-kpi"><div class="lbl">Grants (live)</div><div class="val">'+fmtInt(counts.grants)+'</div></div>'+
        '<div class="ap-kpi"><div class="lbl">Foundations (live)</div><div class="val">'+fmtInt(counts.foundations)+'</div></div>'+
        '<div class="ap-kpi"><div class="lbl">Total grant value (live)</div><div class="val">'+(counts.total_grant_value?('$'+(counts.total_grant_value/1e9).toFixed(2)+'B'):'—')+'</div></div>'+
      '</div>'+
      '<div class="ap-form">'+
        '<div><label>Publication notes (optional)</label><textarea id="apPublishNotes" rows="2" placeholder="Summary of what changed in this version…"></textarea></div>'+
        '<div><label>Source file label (optional)</label><input id="apPublishSrc" placeholder="e.g. irs_q1_2026.csv"></div>'+
      '</div>'+
      '<div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap;">'+
        '<button class="ap-btn primary" id="apPublishBtn">Publish to User Portal</button>'+
        '<button class="ap-btn" onclick="document.getElementById(\'updatesVersionHistory\').scrollIntoView({behavior:\'smooth\'})">View version history</button>'+
      '</div>'+
    '</div>';
    host.innerHTML = html;
    document.getElementById('apPublishBtn').onclick = function(){
      if(!confirm('Publish a new version to the User Portal? Users and Guests will see this data immediately.')) return;
      var notes = (document.getElementById('apPublishNotes').value||'').trim();
      var src   = (document.getElementById('apPublishSrc').value||'').trim();
      // Prefer the unified flow that also writes the static snapshots,
      // updates the badge, and fires the success toast.
      if (typeof window.runPublishToUserPortal === 'function') {
        window.runPublishToUserPortal({ notes: notes, source_files: src ? [src] : [] });
        renderPublishPanel();
        renderVersionHistory();
        return;
      }
      // Fallback: direct publish + manual snapshot write.
      var v = window.PUBLISHED_DATA.publish({
        notes: notes,
        source_files: src ? [src] : []
      });
      if (v && v.ok && window.STATIC_PUBLISH && window.STATIC_PUBLISH.writeSnapshots) {
        try { window.STATIC_PUBLISH.writeSnapshots(v); } catch(_){}
      }
      if (window.PORTAL_AUTH_updateVersionBadge) {
        try { window.PORTAL_AUTH_updateVersionBadge(); } catch(_){}
      }
      alert('Published '+v.version_number+' to the User Portal at '+fmtTs(v.published_at)+'.');
      renderPublishPanel();
      renderVersionHistory();
    };
  }

  function renderVersionHistory(){
    var host = document.getElementById('updatesVersionHistoryPublished');
    if(!host) return;
    var list = window.PUBLISHED_DATA.listVersions().slice().reverse();
    var current = window.PUBLISHED_DATA.getCurrent();
    var rows = list.map(function(v){
      var isCurrent = current && current.version_number === v.version_number;
      return '<tr>'+
        '<td><b>'+escH(v.version_number)+'</b>'+(isCurrent?' <span class="ap-pill ok">current</span>':'')+(v.rolled_back_to_source?' <span class="ap-pill warn">rollback</span>':'')+'</td>'+
        '<td>'+escH(fmtTs(v.published_at))+'</td>'+
        '<td>'+escH(v.published_by&&v.published_by.admin_name||'—')+'</td>'+
        '<td>'+fmtInt(v.counts&&v.counts.recipients)+' / '+fmtInt(v.counts&&v.counts.grants)+' / '+fmtInt(v.counts&&v.counts.foundations)+'</td>'+
        '<td>'+escH(v.notes||'—')+'</td>'+
        '<td>'+(isCurrent ? '<span style="color:#6b7280;">—</span>' : '<button class="ap-btn warn" onclick="window.ADMIN_PUBLISH.rollback(\''+escH(v.version_number)+'\')">Roll back to this</button>')+'</td>'+
      '</tr>';
    }).join('');
    host.innerHTML = ''+
    '<div class="ap-section">'+
      '<h2>Published Version History</h2>'+
      '<div class="sub">Every Publish-to-User-Portal action is recorded with a new version number. Roll back to a prior version at any time — the rollback writes a new version entry referencing the source.</div>'+
      (list.length ? ('<div style="overflow-x:auto;"><table class="ap-table"><thead><tr><th>Version</th><th>Published</th><th>By</th><th>Recip / Grants / Found</th><th>Notes</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div>')
                   : '<div style="color:#6b7280;font-style:italic;padding:18px;text-align:center;">No published versions yet.</div>')+
    '</div>';
  }

  function rollback(versionNumber){
    if(!confirm('Roll the User Portal back to '+versionNumber+'? A new version will be created.')) return;
    var v = window.PUBLISHED_DATA.rollback(versionNumber);
    if(!v){ alert('Version not found.'); return; }
    alert('Rolled back. New current version: '+v.version_number);
    renderPublishPanel();
    renderVersionHistory();
  }

  // ── Access Management UI ─────────────────────────────────────────────────
  var EDITING = null;
  function renderAccessManagement(){
    var host = document.getElementById('updatesAccessManagement');
    if(!host) return;
    var users = window.PORTAL_AUTH.loadUsers();
    var html = ''+
    '<div class="ap-section">'+
      '<h2>Access Management</h2>'+
      '<div class="sub">Manage Admin, User, and Guest accounts. Configure per-page and per-section permissions, export controls, and Guest expiration dates.</div>'+
      '<div style="margin-bottom:12px;"><button class="ap-btn primary" onclick="window.ADMIN_PUBLISH.editUser(null)">+ Invite new user</button></div>'+
      '<div style="overflow-x:auto;"><table class="ap-table"><thead><tr>'+
        '<th>Name</th><th>Email</th><th>Organization</th><th>Role</th><th>Status</th>'+
        '<th>Invited</th><th>Last login</th><th>Expires</th><th>Pages</th><th>Export</th><th></th>'+
      '</tr></thead><tbody>'+
      users.map(function(u){
        var statusClass = u.status==='active'?'ok':(u.status==='revoked'||u.status==='expired'?'err':'warn');
        var expired = u.expires_at && new Date(u.expires_at) < new Date();
        return '<tr>'+
          '<td><b>'+escH(u.name)+'</b></td>'+
          '<td>'+escH(u.email)+'</td>'+
          '<td>'+escH(u.organization||'—')+'</td>'+
          '<td><span class="ap-pill">'+escH(u.role)+'</span></td>'+
          '<td><span class="ap-pill '+statusClass+'">'+escH(u.status)+(expired?' (expired)':'')+'</span></td>'+
          '<td>'+escH(fmtTs(u.invited_at))+'</td>'+
          '<td>'+escH(u.last_login?fmtTs(u.last_login):'never')+'</td>'+
          '<td>'+escH(u.expires_at?fmtTs(u.expires_at):'—')+'</td>'+
          '<td style="font-size:11px;">'+escH((u.allowed_pages||[]).join(', ')||'—')+'</td>'+
          '<td>'+(u.export_enabled?'<span class="ap-pill ok">enabled</span>':'<span class="ap-pill">disabled</span>')+'</td>'+
          '<td>'+
            '<button class="ap-btn" onclick="window.ADMIN_PUBLISH.editUser(\''+escH(u.user_id)+'\')">Edit</button> '+
            (u.status==='active'?
              '<button class="ap-btn warn" onclick="window.ADMIN_PUBLISH.setUserStatus(\''+escH(u.user_id)+'\',\'inactive\')">Deactivate</button> '+
              '<button class="ap-btn danger" onclick="window.ADMIN_PUBLISH.setUserStatus(\''+escH(u.user_id)+'\',\'revoked\')">Revoke</button>'
              :
              '<button class="ap-btn primary" onclick="window.ADMIN_PUBLISH.setUserStatus(\''+escH(u.user_id)+'\',\'active\')">Activate</button>'
            )+
          '</td>'+
        '</tr>';
      }).join('')+
      '</tbody></table></div>'+
      '<div id="apEditUserMount"></div>'+
    '</div>';
    host.innerHTML = html;
    if(EDITING) renderEditUser();
  }

  function editUser(user_id){
    if(user_id){
      EDITING = window.PORTAL_AUTH.findUserById(user_id);
    } else {
      EDITING = {
        user_id: null, name:'', email:'', organization:'', role:'user', status:'active',
        password:'', invited_at:new Date().toISOString(), last_login:null, expires_at:null,
        allowed_pages:['overview','insights','recipients','foundations','search','about'],
        allowed_dashboard_sections:['*'], allowed_insights_sections:['*'],
        export_enabled:false, notes:''
      };
    }
    renderEditUser();
  }
  function renderEditUser(){
    var host = document.getElementById('apEditUserMount');
    if(!host || !EDITING) return;
    var u = EDITING;
    var pages = ['overview','insights','recipients','foundations','search','about'];
    var pageChecks = pages.map(function(p){
      var checked = (u.allowed_pages||[]).indexOf(p)>=0 || (u.allowed_pages||[]).indexOf('*')>=0;
      return '<label style="display:inline-flex;align-items:center;gap:5px;font-size:12px;margin-right:14px;"><input type="checkbox" data-page="'+p+'" '+(checked?'checked':'')+'> '+escH(p)+'</label>';
    }).join('');
    host.innerHTML = ''+
    '<div class="ap-section" style="background:#fafbfd;border-style:dashed;">'+
      '<h2 style="font-size:15px;">'+(u.user_id?'Edit user · '+escH(u.name):'Invite new user')+'</h2>'+
      '<div class="ap-form">'+
        '<div><label>Name</label><input id="apEdName" value="'+escH(u.name)+'"></div>'+
        '<div><label>Email</label><input id="apEdEmail" value="'+escH(u.email)+'"'+(u.user_id?' readonly':'')+'></div>'+
        '<div><label>Organization</label><input id="apEdOrg" value="'+escH(u.organization||'')+'"></div>'+
        '<div><label>Role</label><select id="apEdRole">'+
          ['admin','user','guest'].map(function(r){ return '<option value="'+r+'"'+(u.role===r?' selected':'')+'>'+r+'</option>'; }).join('')+
          '</select></div>'+
        '<div><label>Status</label><select id="apEdStatus">'+
          ['active','inactive','revoked','expired'].map(function(s){ return '<option value="'+s+'"'+(u.status===s?' selected':'')+'>'+s+'</option>'; }).join('')+
          '</select></div>'+
        '<div><label>Password (demo — leave blank to keep)</label><input id="apEdPw" type="text" placeholder="'+(u.user_id?'·····':'set initial password')+'"></div>'+
        '<div><label>Expiration date (Guest)</label><input id="apEdExp" type="date" value="'+(u.expires_at?u.expires_at.slice(0,10):'')+'"></div>'+
        '<div><label>Export enabled</label><select id="apEdExport"><option value="false"'+(!u.export_enabled?' selected':'')+'>disabled</option><option value="true"'+(u.export_enabled?' selected':'')+'>enabled</option></select></div>'+
      '</div>'+
      '<div style="margin-top:12px;"><label style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;">Allowed pages</label><div id="apEdPages" style="margin-top:6px;">'+pageChecks+'</div></div>'+
      '<div style="margin-top:12px;"><label style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;">Notes</label><textarea id="apEdNotes" rows="2" style="width:100%;padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px;box-sizing:border-box;margin-top:4px;">'+escH(u.notes||'')+'</textarea></div>'+
      '<div style="margin-top:14px;display:flex;gap:8px;">'+
        '<button class="ap-btn primary" id="apEdSaveBtn">Save</button>'+
        '<button class="ap-btn" onclick="window.ADMIN_PUBLISH.cancelEdit()">Cancel</button>'+
        (u.user_id && u.role!=='admin' ? '<button class="ap-btn danger" style="margin-left:auto;" onclick="window.ADMIN_PUBLISH.deleteUser(\''+escH(u.user_id)+'\')">Delete user</button>':'')+
      '</div>'+
    '</div>';
    document.getElementById('apEdSaveBtn').onclick = saveEdit;
  }
  function saveEdit(){
    var u = EDITING; if(!u) return;
    u.name = document.getElementById('apEdName').value.trim();
    if(!u.user_id) u.email = document.getElementById('apEdEmail').value.trim().toLowerCase();
    u.organization = document.getElementById('apEdOrg').value.trim();
    u.role = document.getElementById('apEdRole').value;
    u.status = document.getElementById('apEdStatus').value;
    var newPw = document.getElementById('apEdPw').value;
    if(newPw) u.password = newPw;
    var exp = document.getElementById('apEdExp').value;
    u.expires_at = exp ? new Date(exp+'T23:59:59Z').toISOString() : null;
    u.export_enabled = document.getElementById('apEdExport').value === 'true';
    u.allowed_pages = Array.from(document.querySelectorAll('#apEdPages input[data-page]')).filter(function(c){return c.checked;}).map(function(c){return c.dataset.page;});
    u.notes = document.getElementById('apEdNotes').value;
    if(!u.user_id){
      u.user_id = 'U-'+Math.random().toString(36).slice(2,10).toUpperCase();
      u.invited_at = new Date().toISOString();
      u.password = u.password || 'changeme';
    }
    if(!u.name || !u.email){ alert('Name and email are required.'); return; }
    window.PORTAL_AUTH.upsertUser(u);
    EDITING = null;
    renderAccessManagement();
  }
  function cancelEdit(){ EDITING = null; renderAccessManagement(); }
  function setUserStatus(user_id, status){
    var u = window.PORTAL_AUTH.findUserById(user_id);
    if(!u) return;
    u.status = status;
    window.PORTAL_AUTH.upsertUser(u);
    renderAccessManagement();
  }
  function deleteUserAction(user_id){
    if(!confirm('Permanently delete this user account?')) return;
    window.PORTAL_AUTH.deleteUser(user_id);
    EDITING = null;
    renderAccessManagement();
  }

  // ── Mount: inject new section hosts into the existing Updates view ───────
  function ensureHosts(){
    var updatesView = document.getElementById('adminUpdatesView');
    if(!updatesView) return false;
    // Add three new <section> hosts at the top of Updates if not already there
    var needed = [
      ['updatesPublishPanel', 'updatesPendingApprovals'],
      ['updatesVersionHistoryPublished', 'updatesActivityLog'],
      ['updatesAccessManagement', null]
    ];
    needed.forEach(function(pair){
      if(document.getElementById(pair[0])) return;
      var el = document.createElement('section');
      el.id = pair[0];
      if(pair[1] && document.getElementById(pair[1])){
        updatesView.insertBefore(el, document.getElementById(pair[1]));
      } else {
        updatesView.appendChild(el);
      }
    });
    return true;
  }

  function renderAll(){
    injectCss();
    if(!ensureHosts()) return;
    renderPublishPanel();
    renderVersionHistory();
    renderAccessManagement();
  }

  function boot(){
    if(!isAdmin()) return;
    // Render on initial load, then re-render whenever Updates view opens
    renderAll();
    // Watch for the updates view becoming visible (the existing setTopView toggles `hidden`)
    var view = document.getElementById('adminUpdatesView');
    if(view){
      var mo = new MutationObserver(function(){ if(!view.hidden) renderAll(); });
      mo.observe(view, { attributes:true, attributeFilter:['hidden'] });
    }
  }

  window.ADMIN_PUBLISH = {
    renderAll: renderAll,
    rollback: rollback,
    editUser: editUser,
    cancelEdit: cancelEdit,
    setUserStatus: setUserStatus,
    deleteUser: deleteUserAction
  };

  // Boot after auth has settled
  function tryBoot(){
    if(window.PORTAL_AUTH){ boot(); }
    else setTimeout(tryBoot, 100);
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', tryBoot, { once:true });
  } else {
    setTimeout(tryBoot, 200);
  }

})();
