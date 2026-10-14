/*
 * portal_ux.js — Page states, auto-refresh, and Pilot Access UI for Deborah
 * ------------------------------------------------------------------------
 * Three small responsibilities, all static:
 *   1. PORTAL_VIEW_STATE — verbatim loading/empty/restricted/error messages.
 *   2. PORTAL_AUTOREFRESH — polls deborah_manifest every 60s in User/Guest
 *      portals. If publishedVersion changes, shows a banner with Refresh Now.
 *   3. PILOT_ACCESS — renders the Static Pilot Access Settings panel inside
 *      the Admin page (role-gated to admin). Lets admin toggle Guest section
 *      visibility, view manifest/version history/activity log, export bundle.
 */
(function(){
  'use strict';

  // ============================================================
  // 1. Verbatim spec page-state messages (section 14)
  // ============================================================
  var MESSAGES = {
    loading:    'Loading approved Deborah data…',
    empty_admin:'No approved dashboard version has been published yet. Use the Updates Center to publish the first approved version.',
    empty_user: 'No approved Deborah data has been published yet. Please check back after the administrator publishes an approved version.',
    restricted_guest: 'This section is restricted for Guest accounts. Contact the administrator if you require access.',
    restricted_role:  'You do not have access to this section.',
    error:      'Unable to load the approved Deborah data. Please refresh the page or contact the administrator.'
  };

  function currentRole(){
    try {
      if (window.PORTAL_AUTH && window.PORTAL_AUTH.getSession) {
        var s = window.PORTAL_AUTH.getSession();
        if (s && s.role) return String(s.role).toLowerCase();
      }
    } catch(_){}
    return 'guest';
  }

  function snapshotForRole(role){
    try {
      if (window.STATIC_PUBLISH && window.STATIC_PUBLISH.snapshotForRole) {
        return window.STATIC_PUBLISH.snapshotForRole(role);
      }
    } catch(_){}
    return null;
  }

  function renderStateOverlay(view, role){
    // Find a render anchor per view
    var anchor = null;
    if (view === 'dashboard') anchor = document.getElementById('dashboardView');
    else if (view === 'insights') anchor = document.getElementById('insOverview') || document.getElementById('insightsView');
    else if (view === 'admin') anchor = document.getElementById('adminOverview') || document.getElementById('adminView');
    else if (view === 'updates') anchor = document.getElementById('adminUpdatesView');
    return anchor;
  }

  function escH(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(c){
    return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }

  function showStateCard(view, message, tone){
    var anchor = renderStateOverlay(view);
    if (!anchor) return;
    // Only inject an overlay card if the view is empty — never overwrite
    // already-rendered content.
    var existing = anchor.querySelector('.portal-state-card');
    if (existing) existing.remove();
    var color = tone === 'error' ? '#ff8a8a'
              : tone === 'restricted' ? '#f0c987'
              : '#9ed3e0';
    var html = ''
      + '<div class="portal-state-card" style="margin:24px auto;max-width:720px;padding:20px 22px;'
      + 'background:rgba(20,28,38,0.85);border:1px solid rgba(255,255,255,0.08);'
      + 'border-radius:12px;color:#e6eef5;font-family:inherit;text-align:center;">'
      + '<div style="font-weight:600;font-size:15px;color:'+color+';margin-bottom:6px;">'
      + (tone === 'error' ? 'Unable to load' : tone === 'restricted' ? 'Restricted' : 'Approved data')
      + '</div>'
      + '<div style="font-size:14px;line-height:1.5;color:#cdd6df;">' + escH(message) + '</div>'
      + '</div>';
    // Prepend so it appears above any prior content
    anchor.insertAdjacentHTML('afterbegin', html);
  }

  function clearStateCards(){
    document.querySelectorAll('.portal-state-card').forEach(function(el){ el.remove(); });
  }

  function onRoute(view, role){
    clearStateCards();
    role = role || currentRole();
    var snap = snapshotForRole(role);
    var isAdmin = role === 'admin';

    // Restricted gates: enforced again here for messaging (router already redirects)
    if (!isAdmin && (view === 'admin' || view === 'updates')) {
      showStateCard(view, MESSAGES.restricted_role, 'restricted');
      return;
    }

    // Empty state when no published version exists (User/Guest only)
    if (!isAdmin && !snap) {
      showStateCard(view, MESSAGES.empty_user, 'info');
      return;
    }

    // Admin viewing dashboard with no published version yet → informational
    if (isAdmin && view === 'dashboard' && !snap) {
      // Admin still sees the live working data; just hint via badge, no overlay
    }

    // Guest restricted-section message at insights/dashboard sub-section level
    if (role === 'guest') {
      try {
        var perms = window.STATIC_PUBLISH && window.STATIC_PUBLISH.getGuestPermissions
                    ? window.STATIC_PUBLISH.getGuestPermissions() : null;
        if (perms) {
          var allFalse = perms[view] && Object.values(perms[view]).every(function(v){ return v === false; });
          if (allFalse) {
            showStateCard(view, MESSAGES.restricted_guest, 'restricted');
          }
        }
      } catch(_){}
    }
  }

  function showError(view, errMsg){
    showStateCard(view, MESSAGES.error + (errMsg ? ' ('+errMsg+')' : ''), 'error');
  }

  window.PORTAL_VIEW_STATE = {
    MESSAGES: MESSAGES,
    onRoute: onRoute,
    showError: showError,
    clear: clearStateCards
  };

  // ============================================================
  // 2. Auto-refresh poller (User/Guest only)
  // ============================================================
  var POLL_INTERVAL_MS = 60 * 1000;
  var pollTimer = null;
  var lastSeenVersion = null;
  var refreshBannerShown = false;

  function readManifestVersion(){
    try {
      if (window.STATIC_PUBLISH && window.STATIC_PUBLISH.getManifest) {
        var m = window.STATIC_PUBLISH.getManifest();
        return m && m.publishedVersion || null;
      }
    } catch(_){}
    return null;
  }

  function showRefreshBanner(newVersion){
    if (refreshBannerShown) return;
    refreshBannerShown = true;
    var existing = document.getElementById('portalRefreshBanner');
    if (existing) existing.remove();
    var html = ''
      + '<div id="portalRefreshBanner" role="status" style="position:fixed;top:96px;left:50%;'
      + 'transform:translateX(-50%);z-index:9998;background:rgba(31,111,139,0.95);'
      + 'border:1px solid rgba(158,211,224,0.6);border-radius:10px;padding:10px 16px;'
      + 'color:#fff;font-size:13.5px;box-shadow:0 6px 24px rgba(0,0,0,0.4);'
      + 'display:flex;align-items:center;gap:12px;">'
      + '<span>A new approved Deborah data update is available' + (newVersion ? ' (v'+escH(newVersion)+')' : '') + '.</span>'
      + '<button type="button" id="portalRefreshNowBtn" style="background:#fff;color:#1f6f8b;'
      + 'border:none;border-radius:6px;padding:6px 12px;font-weight:600;cursor:pointer;">Refresh Now</button>'
      + '<button type="button" id="portalRefreshDismissBtn" aria-label="Dismiss" style="background:transparent;'
      + 'color:#fff;border:none;font-size:18px;cursor:pointer;line-height:1;">×</button>'
      + '</div>';
    document.body.insertAdjacentHTML('beforeend', html);
    var btn = document.getElementById('portalRefreshNowBtn');
    if (btn) btn.onclick = function(){ location.reload(); };
    var dis = document.getElementById('portalRefreshDismissBtn');
    if (dis) dis.onclick = function(){
      var b = document.getElementById('portalRefreshBanner');
      if (b) b.remove();
      // Keep refreshBannerShown=true so we don't keep re-popping until next change
    };
  }

  function poll(){
    var role = currentRole();
    if (role === 'admin') return; // admin doesn't need this banner
    var v = readManifestVersion();
    if (lastSeenVersion == null) {
      lastSeenVersion = v;
      return;
    }
    if (v && v !== lastSeenVersion) {
      showRefreshBanner(v);
    }
  }

  function startAutorefresh(){
    if (pollTimer) return;
    lastSeenVersion = readManifestVersion();
    refreshBannerShown = false;
    pollTimer = setInterval(poll, POLL_INTERVAL_MS);
  }
  function stopAutorefresh(){
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  window.PORTAL_AUTOREFRESH = {
    start: startAutorefresh,
    stop: stopAutorefresh,
    poll: poll
  };

  // ============================================================
  // 3. Pilot Access Settings panel (Admin only)
  // ============================================================
  function renderPilotAccessPanel(){
    var role = currentRole();
    if (role !== 'admin') return;
    var anchor = document.getElementById('adminOverview');
    if (!anchor) return;
    var existing = document.getElementById('pilotAccessPanel');
    if (existing) existing.remove();

    var perms = (window.STATIC_PUBLISH && window.STATIC_PUBLISH.getGuestPermissions)
      ? window.STATIC_PUBLISH.getGuestPermissions() : {};
    var manifest = (window.STATIC_PUBLISH && window.STATIC_PUBLISH.getManifest)
      ? window.STATIC_PUBLISH.getManifest() : null;
    var history = (window.STATIC_PUBLISH && window.STATIC_PUBLISH.getVersionHistory)
      ? window.STATIC_PUBLISH.getVersionHistory() : [];
    var activity = (window.STATIC_PUBLISH && window.STATIC_PUBLISH.getActivityLog)
      ? window.STATIC_PUBLISH.getActivityLog() : [];
    var diag = (window.STATIC_PUBLISH && window.STATIC_PUBLISH.diagnostics)
      ? window.STATIC_PUBLISH.diagnostics() : {};

    function toggleRow(section, key, label){
      var checked = !!(perms[section] && perms[section][key]);
      return ''
        + '<label style="display:flex;align-items:center;justify-content:space-between;'
        + 'padding:8px 10px;border:1px solid rgba(255,255,255,0.08);border-radius:8px;'
        + 'margin-bottom:6px;background:rgba(20,28,38,0.4);">'
        + '<span style="color:#cdd6df;font-size:13px;">' + escH(label) + '</span>'
        + '<input type="checkbox" data-section="'+escH(section)+'" data-key="'+escH(key)+'" '
        + (checked ? 'checked' : '') + ' style="transform:scale(1.15);accent-color:#1f6f8b;">'
        + '</label>';
    }

    var dashRows = ''
      + toggleRow('dashboard','summary_cards','Summary cards')
      + toggleRow('dashboard','charts','Charts & visualizations')
      + toggleRow('dashboard','recipients_table','Recipients table')
      + toggleRow('dashboard','grants_drilldown','Grants drilldown')
      + toggleRow('dashboard','jewish_linkage','Jewish linkage analysis');
    var insRows = ''
      + toggleRow('insights','overview','Overview')
      + toggleRow('insights','trends','Trends')
      + toggleRow('insights','classification','Classification engine')
      + toggleRow('insights','identity_review','Identity review queue');

    var manifestHtml = manifest
      ? '<div style="font-size:12px;color:#cdd6df;line-height:1.55;">'
        + '<div><strong>Current version:</strong> ' + escH(manifest.publishedVersion) + '</div>'
        + '<div><strong>Published at:</strong> ' + escH(manifest.publishedAt) + '</div>'
        + '<div><strong>Published by:</strong> ' + escH(manifest.publishedBy) + '</div>'
        + (manifest.notes ? '<div><strong>Notes:</strong> ' + escH(manifest.notes) + '</div>' : '')
        + '</div>'
      : '<div style="font-size:12px;color:#9aa6b2;font-style:italic;">No published version yet.</div>';

    var historyHtml = history.length
      ? '<ul style="margin:0;padding-left:18px;font-size:12px;color:#cdd6df;max-height:140px;overflow:auto;">'
        + history.slice().reverse().slice(0,20).map(function(h){
            return '<li>v' + escH(h.version_number) + ' — ' + escH(h.published_at) + ' by ' + escH(h.published_by) + '</li>';
          }).join('')
        + '</ul>'
      : '<div style="font-size:12px;color:#9aa6b2;font-style:italic;">No history yet.</div>';

    var diagRows = Object.keys(diag).map(function(k){
      var v = diag[k];
      var disp = (typeof v === 'object' && v !== null) ? JSON.stringify(v) : String(v);
      return '<tr><td style="padding:4px 8px;color:#9aa6b2;font-size:12px;">'+escH(k)+'</td>'
           + '<td style="padding:4px 8px;color:#e6eef5;font-size:12px;font-family:monospace;">'+escH(disp)+'</td></tr>';
    }).join('');

    var html = ''
      + '<section id="pilotAccessPanel" style="margin:18px 0;padding:18px 20px;'
      + 'background:rgba(15,22,32,0.7);border:1px solid rgba(255,255,255,0.08);border-radius:12px;">'
      + '<h3 style="margin:0 0 4px 0;color:#9ed3e0;font-size:16px;">Static Pilot Access Settings</h3>'
      + '<p style="margin:0 0 14px 0;color:#9aa6b2;font-size:12px;">'
      + 'These settings are stored in the publishing admin\'s browser only (localStorage). '
      + 'They are not a production-grade access control system.'
      + '</p>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;">'
      + '<div>'
      + '<div style="font-weight:600;color:#cdd6df;font-size:13px;margin-bottom:8px;">Guest — Dashboard sections</div>'
      + dashRows
      + '</div>'
      + '<div>'
      + '<div style="font-weight:600;color:#cdd6df;font-size:13px;margin-bottom:8px;">Guest — Insights sections</div>'
      + insRows
      + '</div>'
      + '</div>'
      + '<div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap;">'
      + '<button type="button" id="pilotSavePermsBtn" style="background:#1f6f8b;color:#fff;border:none;'
      + 'padding:8px 14px;border-radius:6px;font-weight:600;cursor:pointer;">Save Guest permissions</button>'
      + '<button type="button" id="pilotExportBtn" style="background:#2c3e50;color:#fff;border:none;'
      + 'padding:8px 14px;border-radius:6px;cursor:pointer;">Export published bundle (.json)</button>'
      + '<button type="button" id="pilotShareLinkBtn" style="background:#1f6f8b;color:#fff;border:none;'
      + 'padding:8px 14px;border-radius:6px;cursor:pointer;">Copy shareable link for Users/Guests</button>'
      + '<button type="button" id="pilotSeedExportBtn" style="background:#2c3e50;color:#fff;border:none;'
      + 'padding:8px 14px;border-radius:6px;cursor:pointer;" title="Download published_snapshot.json to be baked into the deploy">Export seed snapshot for deploy</button>'
      + '</div>'
      + '<div id="pilotShareLinkOut" style="margin-top:10px;display:none;"></div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:18px;">'
      + '<div>'
      + '<div style="font-weight:600;color:#cdd6df;font-size:13px;margin-bottom:6px;">Manifest</div>'
      + manifestHtml
      + '</div>'
      + '<div>'
      + '<div style="font-weight:600;color:#cdd6df;font-size:13px;margin-bottom:6px;">Version history</div>'
      + historyHtml
      + '</div>'
      + '</div>'
      + '<details style="margin-top:14px;">'
      + '<summary style="cursor:pointer;color:#9ed3e0;font-size:13px;">Diagnostic panel</summary>'
      + '<table style="margin-top:8px;border-collapse:collapse;width:100%;">'
      + diagRows + '</table>'
      + '</details>'
      + '</section>';

    anchor.insertAdjacentHTML('afterend', html);

    // Wire buttons
    var saveBtn = document.getElementById('pilotSavePermsBtn');
    if (saveBtn) saveBtn.onclick = function(){
      var inputs = document.querySelectorAll('#pilotAccessPanel input[type=checkbox][data-section][data-key]');
      var newPerms = JSON.parse(JSON.stringify(perms));
      inputs.forEach(function(inp){
        var s = inp.getAttribute('data-section');
        var k = inp.getAttribute('data-key');
        if (!newPerms[s]) newPerms[s] = {};
        newPerms[s][k] = !!inp.checked;
      });
      if (window.STATIC_PUBLISH && window.STATIC_PUBLISH.setGuestPermissions) {
        var ok = window.STATIC_PUBLISH.setGuestPermissions(newPerms);
        if (window.PORTAL_AUTH_toast) {
          window.PORTAL_AUTH_toast(ok
            ? 'Guest permissions updated. Guest portal will reflect changes on next refresh.'
            : 'Unable to save Guest permissions.',
            ok ? 'success' : 'error');
        }
        renderPilotAccessPanel();
      }
    };

    var exportBtn = document.getElementById('pilotExportBtn');
    if (exportBtn) exportBtn.onclick = function(){
      if (window.STATIC_PUBLISH && window.STATIC_PUBLISH.exportBundle) {
        var r = window.STATIC_PUBLISH.exportBundle();
        if (window.PORTAL_AUTH_toast) {
          window.PORTAL_AUTH_toast(r.ok
            ? 'Published bundle exported.'
            : 'Unable to export bundle.',
            r.ok ? 'success' : 'error');
        }
      }
    };

    var shareBtn = document.getElementById('pilotShareLinkBtn');
    if (shareBtn) shareBtn.onclick = function(){
      if (!(window.STATIC_PUBLISH && window.STATIC_PUBLISH.buildShareUrl)) return;
      var url = window.STATIC_PUBLISH.buildShareUrl();
      if (!url) {
        if (window.PORTAL_AUTH_toast) window.PORTAL_AUTH_toast('Publish a version first, then build a shareable link.', 'warn');
        return;
      }
      var out = document.getElementById('pilotShareLinkOut');
      if (out) {
        out.style.display = 'block';
        out.innerHTML = ''
          + '<div style="font-size:12px;color:#9aa6b2;margin-bottom:4px;">Share this URL with Users/Guests. Opening it once writes the published snapshot into their browser.</div>'
          + '<textarea readonly id="pilotShareLinkText" style="width:100%;height:90px;background:#0c1320;color:#9ed3e0;border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:8px;font-family:monospace;font-size:11px;word-break:break-all;">' + escH(url) + '</textarea>'
          + '<div style="font-size:11px;color:#9aa6b2;margin-top:4px;">Length: ' + url.length.toLocaleString() + ' chars. If too long for chat tools, use Export bundle instead.</div>';
        var ta = document.getElementById('pilotShareLinkText');
        if (ta) {
          ta.select();
          try { document.execCommand('copy'); } catch(_){}
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).catch(function(){});
          }
        }
        if (window.PORTAL_AUTH_toast) window.PORTAL_AUTH_toast('Shareable link copied to clipboard.', 'success');
      }
    };

    var seedBtn = document.getElementById('pilotSeedExportBtn');
    if (seedBtn) seedBtn.onclick = function(){
      if (!(window.STATIC_PUBLISH && window.STATIC_PUBLISH.buildShareEnvelope)) return;
      var env = window.STATIC_PUBLISH.buildShareEnvelope();
      if (!env.manifest) {
        if (window.PORTAL_AUTH_toast) window.PORTAL_AUTH_toast('Publish a version first.', 'warn');
        return;
      }
      try {
        var json = JSON.stringify(env, null, 2);
        var blob = new Blob([json], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'published_snapshot.json';
        document.body.appendChild(a);
        a.click();
        setTimeout(function(){
          try { document.body.removeChild(a); } catch(_){}
          try { URL.revokeObjectURL(url); } catch(_){}
        }, 200);
        if (window.PORTAL_AUTH_toast) window.PORTAL_AUTH_toast('Seed file exported. Send to the agent to bake into the deploy.', 'success');
      } catch(err){
        if (window.PORTAL_AUTH_toast) window.PORTAL_AUTH_toast('Seed export failed: '+err.message, 'error');
      }
    };
  }

  window.PILOT_ACCESS = {
    render: renderPilotAccessPanel
  };

  // ============================================================
  // Boot wiring
  // ============================================================
  function boot(){
    // Start auto-refresh poller for User/Guest
    startAutorefresh();
    // Re-render pilot panel whenever admin view is shown or a publish happens
    var onPub = function(){ setTimeout(renderPilotAccessPanel, 50); };
    try { window.addEventListener('deborah:published', onPub, false); } catch(_){}
    try { document.addEventListener('deborah:published', onPub, false); } catch(_){}
    // Hook into setTopView to render the panel when admin view opens
    var origSet = window.setTopView;
    if (typeof origSet === 'function' && !origSet.__ux_wrapped) {
      window.setTopView = function(v){
        var r = origSet.apply(this, arguments);
        if (v === 'admin') {
          setTimeout(renderPilotAccessPanel, 30);
        }
        return r;
      };
      window.setTopView.__ux_wrapped = true;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    setTimeout(boot, 0);
  }
})();
