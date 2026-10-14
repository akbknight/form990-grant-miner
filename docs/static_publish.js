/*
 * static_publish.js — Static Snapshot & Manifest Writer for Deborah
 * -----------------------------------------------------------------
 * Persists the published dashboard data to localStorage so that the
 * User & Guest portals can load an approved, frozen snapshot without
 * any backend.
 *
 * IMPORTANT (honest limitations — surfaced in diagnostic panel):
 *   • Data lives in the publishing admin's localStorage only.
 *   • Other browsers/devices will see "No published version" until
 *     either (a) they import the exported bundle, or (b) the admin
 *     publishes a redeploy of the static site with snapshot files.
 *   • This is NOT production-grade security — anyone with admin
 *     credentials can publish from their browser.
 *
 * localStorage keys:
 *   deborah_manifest             — pointer/metadata for the current publish
 *   deborah_user_snapshot        — full snapshot for User role
 *   deborah_guest_snapshot       — filtered snapshot for Guest role
 *   deborah_version_history      — array of historical manifests
 *   deborah_activity_log         — array of publish/revert events
 *   deborah_guest_permissions    — Admin-configurable Guest section toggles
 */
(function(){
  'use strict';

  var KEYS = {
    MANIFEST:   'deborah_manifest',
    USER_SNAP:  'deborah_user_snapshot',
    GUEST_SNAP: 'deborah_guest_snapshot',
    HISTORY:    'deborah_version_history',
    ACTIVITY:   'deborah_activity_log',
    GUEST_PERM: 'deborah_guest_permissions'
  };

  // -------- Storage helpers (resilient to sandboxed iframes) --------
  var memStore = {};

  function safeRead(key){
    try {
      if (typeof localStorage !== 'undefined') {
        var v = localStorage.getItem(key);
        if (v != null) return v;
      }
    } catch(_){}
    try {
      if (typeof sessionStorage !== 'undefined') {
        var v2 = sessionStorage.getItem(key);
        if (v2 != null) return v2;
      }
    } catch(_){}
    return memStore[key] != null ? memStore[key] : null;
  }

  function safeWrite(key, value){
    var stored = false;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(key, value);
        stored = true;
      }
    } catch(_){}
    if (!stored) {
      try {
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.setItem(key, value);
          stored = true;
        }
      } catch(_){}
    }
    memStore[key] = value;
    return stored;
  }

  function readJSON(key, fallback){
    var raw = safeRead(key);
    if (!raw) return fallback;
    try { return JSON.parse(raw); }
    catch(_){ return fallback; }
  }

  function writeJSON(key, obj){
    try { return safeWrite(key, JSON.stringify(obj)); }
    catch(err){ console.warn('[static_publish] write failed for', key, err); return false; }
  }

  // -------- Default Guest permissions --------
  var DEFAULT_GUEST_PERM = {
    dashboard: {
      summary_cards: true,
      charts: true,
      recipients_table: false,
      grants_drilldown: false,
      jewish_linkage: false
    },
    insights: {
      overview: true,
      trends: true,
      classification: false,
      identity_review: false
    }
  };

  function getGuestPermissions(){
    var p = readJSON(KEYS.GUEST_PERM, null);
    if (!p) return JSON.parse(JSON.stringify(DEFAULT_GUEST_PERM));
    // Merge with defaults so newly added sections appear
    return mergeDefaults(p, DEFAULT_GUEST_PERM);
  }

  function setGuestPermissions(perms){
    if (!perms || typeof perms !== 'object') return false;
    var merged = mergeDefaults(perms, DEFAULT_GUEST_PERM);
    var ok = writeJSON(KEYS.GUEST_PERM, merged);
    appendActivity({
      type: 'guest_permissions_updated',
      permissions: merged
    });
    // Re-derive guest snapshot from current user snapshot
    rebuildGuestSnapshot();
    return ok;
  }

  function mergeDefaults(input, defaults){
    var out = {};
    Object.keys(defaults).forEach(function(section){
      out[section] = {};
      Object.keys(defaults[section]).forEach(function(k){
        out[section][k] = (input[section] && typeof input[section][k] === 'boolean')
          ? input[section][k] : defaults[section][k];
      });
    });
    return out;
  }

  // -------- Snapshot construction --------
  function buildUserSnapshot(publishResult){
    // PUBLISHED_DATA.publish() result already contains the full payload.
    // Mirror the keys the User Portal expects.
    return {
      version_number: publishResult.version_number || null,
      published_at:   publishResult.published_at || new Date().toISOString(),
      published_by:   publishResult.published_by || (publishResult.actor && publishResult.actor.admin_name) || 'Admin Not Assigned',
      notes:          publishResult.notes || '',
      source_files:   publishResult.source_files || [],
      payload:        publishResult.payload || publishResult.snapshot || publishResult.data || null,
      visible_sections: {
        dashboard: { summary_cards:true, charts:true, recipients_table:true, grants_drilldown:true, jewish_linkage:true },
        insights:  { overview:true, trends:true, classification:true, identity_review:true }
      }
    };
  }

  function buildGuestSnapshot(userSnapshot, perms){
    // Filter sections by permission flags. Payload itself is kept;
    // the portal renderer is responsible for honoring visible_sections.
    var clone = JSON.parse(JSON.stringify(userSnapshot));
    clone.visible_sections = perms;
    clone.is_guest = true;
    return clone;
  }

  function rebuildGuestSnapshot(){
    var user = readJSON(KEYS.USER_SNAP, null);
    if (!user) return false;
    var perms = getGuestPermissions();
    var guest = buildGuestSnapshot(user, perms);
    writeJSON(KEYS.GUEST_SNAP, guest);
    // Also bump manifest's guestSnapshot pointer timestamp
    var manifest = readJSON(KEYS.MANIFEST, null);
    if (manifest) {
      manifest.guestSnapshot = {
        version_number: guest.version_number,
        permissions_updated_at: new Date().toISOString()
      };
      writeJSON(KEYS.MANIFEST, manifest);
    }
    return true;
  }

  // -------- Activity log --------
  function appendActivity(entry){
    var log = readJSON(KEYS.ACTIVITY, []);
    if (!Array.isArray(log)) log = [];
    log.push(Object.assign({ ts: new Date().toISOString() }, entry || {}));
    // Cap to last 500 events
    if (log.length > 500) log = log.slice(-500);
    writeJSON(KEYS.ACTIVITY, log);
  }

  // -------- Main write path --------
  function writeSnapshots(publishResult){
    if (!publishResult || !publishResult.ok) {
      return { ok:false, error:'publishResult missing or not ok' };
    }
    var nowIso = new Date().toISOString();

    var userSnap = buildUserSnapshot(publishResult);
    var perms = getGuestPermissions();
    var guestSnap = buildGuestSnapshot(userSnap, perms);

    var manifest = {
      publishedVersion: userSnap.version_number,
      publishedAt:      userSnap.published_at,
      publishedBy:      userSnap.published_by,
      notes:            userSnap.notes,
      userSnapshot: {
        version_number: userSnap.version_number,
        size_bytes_estimate: (JSON.stringify(userSnap).length)
      },
      guestSnapshot: {
        version_number: guestSnap.version_number,
        permissions_updated_at: nowIso
      },
      manifest_written_at: nowIso
    };

    writeJSON(KEYS.USER_SNAP, userSnap);
    writeJSON(KEYS.GUEST_SNAP, guestSnap);
    writeJSON(KEYS.MANIFEST, manifest);

    // Append to version history
    var hist = readJSON(KEYS.HISTORY, []);
    if (!Array.isArray(hist)) hist = [];
    hist.push({
      version_number: userSnap.version_number,
      published_at:   userSnap.published_at,
      published_by:   userSnap.published_by,
      notes:          userSnap.notes,
      manifest_ref:   nowIso
    });
    // Cap to last 100
    if (hist.length > 100) hist = hist.slice(-100);
    writeJSON(KEYS.HISTORY, hist);

    appendActivity({
      type: 'publish',
      version_number: userSnap.version_number,
      published_by: userSnap.published_by,
      notes: userSnap.notes
    });

    return { ok:true, manifest:manifest };
  }

  // -------- Accessors --------
  function getManifest(){       return readJSON(KEYS.MANIFEST, null); }
  function getUserSnapshot(){   return readJSON(KEYS.USER_SNAP, null); }
  function getGuestSnapshot(){  return readJSON(KEYS.GUEST_SNAP, null); }
  function getVersionHistory(){ return readJSON(KEYS.HISTORY, []) || []; }
  function getActivityLog(){    return readJSON(KEYS.ACTIVITY, []) || []; }

  // -------- Snapshot for current role --------
  function snapshotForRole(role){
    role = String(role || '').toLowerCase();
    if (role === 'admin' || role === 'user') return getUserSnapshot();
    if (role === 'guest') return getGuestSnapshot();
    return null;
  }

  // -------- Exportable bundle --------
  function buildBundle(){
    return {
      exported_at: new Date().toISOString(),
      manifest: getManifest(),
      user_snapshot: getUserSnapshot(),
      guest_snapshot: getGuestSnapshot(),
      version_history: getVersionHistory(),
      activity_log: getActivityLog(),
      guest_permissions: getGuestPermissions()
    };
  }

  function exportBundle(){
    var data = buildBundle();
    var json = JSON.stringify(data, null, 2);
    try {
      var blob = new Blob([json], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      var v = (data.manifest && data.manifest.publishedVersion) || 'no-version';
      a.download = 'deborah_published_bundle_' + v + '_' + Date.now() + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(function(){
        try { document.body.removeChild(a); } catch(_){}
        try { URL.revokeObjectURL(url); } catch(_){}
      }, 200);
      appendActivity({ type: 'bundle_exported', version_number: v });
      return { ok:true, filename:a.download };
    } catch(err){
      console.error('[static_publish] exportBundle failed:', err);
      return { ok:false, error: String(err && err.message || err) };
    }
  }

  // -------- Diagnostics --------
  function diagnostics(){
    var m = getManifest();
    var u = getUserSnapshot();
    var g = getGuestSnapshot();
    var h = getVersionHistory();
    var a = getActivityLog();
    var lastPublish = null;
    for (var i = a.length - 1; i >= 0; i--) {
      if (a[i].type === 'publish') { lastPublish = a[i]; break; }
    }
    return {
      manifest_present:        !!m,
      manifest_version:        m && m.publishedVersion || null,
      user_snapshot_present:   !!u,
      user_snapshot_version:   u && u.version_number || null,
      guest_snapshot_present:  !!g,
      guest_snapshot_version:  g && g.version_number || null,
      version_history_count:   h.length,
      activity_log_count:      a.length,
      last_publish_at:         lastPublish && lastPublish.ts || null,
      last_publish_result:     lastPublish ? 'success' : 'never',
      last_publish_error:      null,
      guest_permissions:       getGuestPermissions()
    };
  }

  // -------- Shareable link (encode snapshot into URL hash) --------
  // Strategy: write a slim 'share envelope' containing just what a User/Guest
  // portal needs (manifest + user_snapshot + guest_snapshot + permissions),
  // base64-encode it after gzipping with native CompressionStream when
  // available. Decode on portal load and write into localStorage.

  function b64encodeUtf8(str){
    // Robust UTF-8 → base64 (avoid btoa's Latin1 limitation)
    var utf8 = unescape(encodeURIComponent(str));
    return btoa(utf8);
  }
  function b64decodeUtf8(b64){
    var bin = atob(b64);
    return decodeURIComponent(escape(bin));
  }

  function buildShareEnvelope(){
    return {
      v: 1,
      manifest:           getManifest(),
      user_snapshot:      getUserSnapshot(),
      guest_snapshot:     getGuestSnapshot(),
      guest_permissions:  getGuestPermissions()
    };
  }

  function encodeShare(envelope){
    var json = JSON.stringify(envelope);
    return b64encodeUtf8(json);
  }

  function decodeShare(token){
    try {
      var json = b64decodeUtf8(token);
      return JSON.parse(json);
    } catch(err){
      console.warn('[static_publish] decodeShare failed:', err);
      return null;
    }
  }

  function buildShareUrl(){
    var env = buildShareEnvelope();
    if (!env.manifest) return null;
    var token = encodeShare(env);
    // Use a dedicated query param so it doesn't collide with the SPA hash
    // router. Place it before the hash so it survives normal navigation.
    var base = location.origin + location.pathname;
    return base + '?deborah_share=' + encodeURIComponent(token) + '#/dashboard';
  }

  function importShareEnvelope(env){
    if (!env || env.v !== 1) return { ok:false, error:'bad envelope' };
    if (env.manifest)          writeJSON(KEYS.MANIFEST,   env.manifest);
    if (env.user_snapshot)     writeJSON(KEYS.USER_SNAP,  env.user_snapshot);
    if (env.guest_snapshot)    writeJSON(KEYS.GUEST_SNAP, env.guest_snapshot);
    if (env.guest_permissions) writeJSON(KEYS.GUEST_PERM, env.guest_permissions);
    // Also write to PUBLISHED_DATA so existing code paths see it
    try {
      if (window.PUBLISHED_DATA && env.user_snapshot) {
        var key = 'deborah_published_data_v1';
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(key, JSON.stringify(
            env.user_snapshot.payload || env.user_snapshot
          ));
        }
      }
    } catch(_){}
    appendActivity({
      type: 'share_imported',
      version_number: env.manifest && env.manifest.publishedVersion
    });
    return { ok:true, version: env.manifest && env.manifest.publishedVersion };
  }

  function importFromUrl(){
    try {
      var qs = new URLSearchParams(location.search || '');
      var token = qs.get('deborah_share');
      if (!token) return { ok:false, error:'no token' };
      var env = decodeShare(token);
      if (!env) return { ok:false, error:'decode failed' };
      var res = importShareEnvelope(env);
      // Clean the URL so the token isn't visible in the bar after import
      if (res.ok) {
        try {
          var clean = location.origin + location.pathname + (location.hash || '#/dashboard');
          history.replaceState(null, '', clean);
        } catch(_){}
      }
      return res;
    } catch(err){
      return { ok:false, error: String(err && err.message || err) };
    }
  }

  // -------- Seed loader (fetch baked snapshot from deploy) --------
  // If localStorage has no manifest and the deploy ships a
  // published_snapshot.json, fetch and import it.
  function loadSeedIfEmpty(){
    if (getManifest()) return Promise.resolve({ ok:false, reason:'already populated' });
    return fetch('published_snapshot.json', { cache: 'no-cache' })
      .then(function(r){
        if (!r.ok) return null;
        return r.json();
      })
      .then(function(env){
        if (!env) return { ok:false, reason:'no seed file' };
        var res = importShareEnvelope(env);
        if (res.ok) {
          appendActivity({ type: 'seed_imported', version_number: res.version });
        }
        return res;
      })
      .catch(function(err){
        return { ok:false, error: String(err && err.message || err) };
      });
  }

  // -------- Public API --------
  window.STATIC_PUBLISH = {
    KEYS: KEYS,
    writeSnapshots:     writeSnapshots,
    getManifest:        getManifest,
    getUserSnapshot:    getUserSnapshot,
    getGuestSnapshot:   getGuestSnapshot,
    getVersionHistory:  getVersionHistory,
    getActivityLog:     getActivityLog,
    snapshotForRole:    snapshotForRole,
    getGuestPermissions: getGuestPermissions,
    setGuestPermissions: setGuestPermissions,
    rebuildGuestSnapshot: rebuildGuestSnapshot,
    exportBundle:       exportBundle,
    buildBundle:        buildBundle,
    appendActivity:     appendActivity,
    diagnostics:        diagnostics,
    // Shareable link
    buildShareEnvelope: buildShareEnvelope,
    buildShareUrl:      buildShareUrl,
    encodeShare:        encodeShare,
    decodeShare:        decodeShare,
    importShareEnvelope: importShareEnvelope,
    importFromUrl:      importFromUrl,
    loadSeedIfEmpty:    loadSeedIfEmpty
  };

  // -------- Auto-import on load --------
  // Run as early as possible so the rest of the app sees populated storage.
  (function autoImport(){
    // 1. URL-based shareable link wins
    var fromUrl = importFromUrl();
    if (fromUrl.ok) return;
    // 2. Fall back to seed file in deploy (async)
    if (typeof fetch === 'function') {
      loadSeedIfEmpty().then(function(res){
        if (res && res.ok) {
          // Fire a synthetic event so the badge + portal refresh
          try {
            var snap = getUserSnapshot();
            var ev = new CustomEvent('deborah:published', { detail: snap });
            window.dispatchEvent(ev);
            document.dispatchEvent(ev);
          } catch(_){}
        }
      });
    }
  })();

  // React to publish events from PUBLISHED_DATA so other pages stay current.
  // Listen on BOTH window and document because dispatchers vary.
  function onPublishedEvent(ev){
    var detail = ev && ev.detail;
    if (!detail) return;
    // Two shapes:
    //  - PUBLISHED_DATA.setCurrent fires the raw snapshot (no .ok flag)
    //  - runPublishToUserPortal fires the publish() result (.ok=true, .version_number)
    var snapshot = detail.ok ? detail : (detail.version_number ? detail : null);
    if (!snapshot) return;
    var current = getManifest();
    if (current && current.publishedVersion === snapshot.version_number) return;
    // Normalize to publish-result shape for writeSnapshots()
    writeSnapshots({
      ok: true,
      version_number: snapshot.version_number,
      published_at:   snapshot.published_at,
      published_by:   snapshot.published_by,
      notes:          snapshot.notes || '',
      source_files:   snapshot.source_files || [],
      payload:        snapshot.payload || snapshot.snapshot || snapshot.data || snapshot
    });
  }
  try { window.addEventListener('deborah:published', onPublishedEvent, false); } catch(_){}
  try { document.addEventListener('deborah:published', onPublishedEvent, false); } catch(_){}
})();
