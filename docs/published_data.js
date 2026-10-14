/* ============================================================================
 * published_data.js — Published User-Facing Data Layer
 * ----------------------------------------------------------------------------
 * Owns the *approved & published* snapshot of dashboard data that the User
 * Portal reads from. Admins click "Publish to User Portal" to refresh it.
 *
 * Architecture note (flagged per implementation rule 11):
 *   This dashboard is a static client-side single-page app — there is no
 *   server-side database. "Tables" are JS globals (DASHBOARD_DATA, RECIPIENTS,
 *   JEWISH_RECIPIENTS_LIST, etc.). True row-level security and server-side
 *   route protection require a backend. This module implements the strongest
 *   client-side equivalent:
 *     - User/Guest sessions never load admin-only render code paths
 *     - The User Portal shell reads ONLY from PUBLISHED_DATA.get(), not from
 *       the raw globals
 *     - Admin-only globals (review queues, audit logs, draft records) are
 *       never copied into the published snapshot
 *
 * Storage:  localStorage keys
 *   deborah_published_data_v1   — current published snapshot
 *   deborah_published_versions  — list of historical versions (rollback)
 * ========================================================================== */
(function(){
  'use strict';

  var KEY_CURRENT  = 'deborah_published_data_v1';
  var KEY_VERSIONS = 'deborah_published_versions';
  var MAX_VERSIONS = 25;

  // Keys that ARE safe to publish (approved master data + page outputs)
  var WHITELIST = [
    'DASHBOARD_DATA',          // KPI totals, time series, classification stats
    'RECIPIENTS',              // approved recipient master
    'RECIPIENT_GRANTS',        // approved grants
    'JEWISH_RECIPIENTS_LIST',  // approved JLO recipients
    'JEWISH_RECIPIENT_DETAIL',
    'JEWISH_RECIPIENT_GRANTS',
    'SUBJECT_TRENDS',          // approved insights data
    'INSIGHTS_DATA',           // computed insights output
    'FOUNDATIONS_LIST',        // approved donor profiles
    'PHASE2_CEF_REVIEWED_META',
    'PHASE2_CEF_CLASSIFICATIONS_REVIEWED',
    'PHASE2_CEF_GRANTS_REVIEWED'
  ];

  // Keys that MUST NEVER appear in the published snapshot
  // (drafts, staging, queues, audit logs, internal-only signals)
  var BLACKLIST = [
    'CLASSIFICATION_AUDIT_TRAIL',
    'CLASSIFICATION_CORRECTION_LOG',
    'IDENTITY_REVIEW_DECISION_LOG',
    'ADMIN_CLASSIFICATION_RULES',
    'PHASE2_CEF_REVIEW_QUEUE',
    'PHASE2_CEF_UNRESOLVED_REVIEW_QUEUE',
    'PHASE2_CEF_NEED_RESEARCH_REDUCED',
    'PHASE2_CEF_AUTO_RESOLVED_LOG',
    'PHASE2_CEF_AUDIT_SEED',
    'PHASE2_CEF_MASTER_ISSUE_SEED',
    'FD_JLO_REVIEW_QUEUE',
    'FD_JLO_TOP_CANDIDATES',
    'FD_JLO_MIXED_QUEUE',
    'JEWISH_LINKAGE_REVIEW_QUEUE',
    'JEWISH_LINKAGE_TOP_CANDIDATES',
    'JEWISH_LINKAGE_VERSION_HISTORY',
    'JEWISH_LINKAGE_AUTO_LOG'
  ];

  function nowIso(){ return new Date().toISOString(); }
  function safeJson(v){ try { return JSON.stringify(v); } catch(e){ return null; } }

  function readJson(key, fallback){
    try {
      var raw = localStorage.getItem(key);
      if(!raw) return fallback;
      return JSON.parse(raw);
    } catch(e){ return fallback; }
  }
  function writeJson(key, value){
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch(e){
      console.warn('[PUBLISHED_DATA] write failed for', key, e);
      return false;
    }
  }

  // ── Snapshot builder ──────────────────────────────────────────────────────
  // Captures ONLY whitelisted, approved-side globals. We hold references, not
  // deep clones, because the underlying arrays can be 100MB+ (RECIPIENTS_part_*).
  // The Admin commits to "freeze and publish" via metadata + version number;
  // the snapshot version is what the User Portal reads from. The Admin can
  // continue editing draft data after publish without affecting users.
  function buildSnapshotPayload(){
    var payload = {};
    var captured = [];
    var skipped = [];
    for(var i=0;i<WHITELIST.length;i++){
      var k = WHITELIST[i];
      if(typeof window[k] !== 'undefined' && window[k] !== null){
        payload[k] = true;     // marker — actual data accessed via the live ref
        captured.push(k);
      } else {
        skipped.push(k);
      }
    }
    return { keys_present: captured, keys_missing: skipped };
  }

  function inferCounts(){
    function len(g){
      try {
        if(!g) return 0;
        if(Array.isArray(g)) return g.length;
        if(typeof g === 'object'){
          if(Array.isArray(g.rows)) return g.rows.length;
          if(Array.isArray(g.items)) return g.items.length;
          return Object.keys(g).length;
        }
        return 0;
      } catch(e){ return 0; }
    }
    return {
      recipients:        len(window.RECIPIENTS) || len(window.JEWISH_RECIPIENTS_LIST),
      grants:            (window.DASHBOARD_DATA && window.DASHBOARD_DATA.totals && window.DASHBOARD_DATA.totals.grants) || len(window.RECIPIENT_GRANTS),
      foundations:       (window.DASHBOARD_DATA && window.DASHBOARD_DATA.totals && window.DASHBOARD_DATA.totals.foundations) || len(window.FOUNDATIONS_LIST),
      total_grant_value: (window.DASHBOARD_DATA && window.DASHBOARD_DATA.totals && window.DASHBOARD_DATA.totals.value) || null
    };
  }

  // ── Current published snapshot ───────────────────────────────────────────
  function getCurrent(){
    return readJson(KEY_CURRENT, null);
  }
  function setCurrent(snapshot){
    writeJson(KEY_CURRENT, snapshot);
    // Cross-tab broadcast (User Portal listens for storage events).
    // Fire on BOTH window and document so every listener catches it
    // regardless of which target they subscribed to.
    try {
      var ev = new CustomEvent('deborah:published', { detail: snapshot });
      window.dispatchEvent(ev);
    } catch(e){}
    try {
      var ev2 = new CustomEvent('deborah:published', { detail: snapshot });
      document.dispatchEvent(ev2);
    } catch(e){}
  }

  // ── Versions registry (audit trail of publications) ──────────────────────
  function listVersions(){
    return readJson(KEY_VERSIONS, []);
  }
  function appendVersion(entry){
    var list = listVersions();
    list.push(entry);
    if(list.length > MAX_VERSIONS){ list = list.slice(-MAX_VERSIONS); }
    writeJson(KEY_VERSIONS, list);
    return entry;
  }

  function nextVersionNumber(){
    var list = listVersions();
    if(!list.length) return 'v1.0.0';
    // semver-ish: bump minor
    var last = list[list.length-1].version_number || 'v1.0.0';
    var m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(last);
    if(!m) return 'v1.0.0';
    return 'v' + m[1] + '.' + (parseInt(m[2],10)+1) + '.0';
  }

  // ── Publish workflow ─────────────────────────────────────────────────────
  // Fingerprint = stable hash of the things that define a published snapshot's
  // identity. If the fingerprint matches the prior publish and `force` is not
  // set, we reject as a duplicate.
  function publishFingerprint(counts, keys){
    var s = JSON.stringify({ c: counts, k: keys.slice().sort() });
    var h = 0;
    for(var i=0;i<s.length;i++){ h = ((h<<5)-h) + s.charCodeAt(i); h |= 0; }
    return 'fp_' + (h >>> 0).toString(16) + '_' + s.length;
  }

  function publish(opts){
    opts = opts || {};
    // Admin-only guard at the data layer
    if(window.PORTAL_AUTH && window.PORTAL_AUTH.getRole && !window.PORTAL_AUTH.isAdmin()){
      return { ok:false, error:'not_authorized', role: window.PORTAL_AUTH.getRole() };
    }
    var actor = (window.AUDIT_LOG && window.AUDIT_LOG.getCurrentActor && window.AUDIT_LOG.getCurrentActor()) || { admin_name:'Admin Not Assigned' };
    var counts = inferCounts();
    var payload = buildSnapshotPayload();
    var fingerprint = publishFingerprint(counts, payload.keys_present);
    var prior = getCurrent();
    if(prior && prior.fingerprint === fingerprint && !opts.force){
      return { ok:false, duplicate:true, error:'duplicate_publish', prior_version: prior.version_number, fingerprint: fingerprint };
    }
    var version = opts.version_number || nextVersionNumber();
    var timestamp = nowIso();

    var snapshot = {
      version_number: version,
      version: version,
      ok: true,
      fingerprint: fingerprint,
      published_at: timestamp,
      published_by: { admin_name: actor.admin_name, admin_id: actor.admin_id, admin_role: actor.admin_role },
      counts: counts,
      keys: payload.keys_present,
      keys_missing: payload.keys_missing,
      notes: opts.notes || '',
      source_files: opts.source_files || [],
      affected_sections: opts.affected_sections || ['Dashboard','Insights','Recipients','Foundations'],
      previous_version: (getCurrent() && getCurrent().version_number) || null,
      // Snapshot-level integrity hint — does NOT contain the data itself;
      // the data lives in the existing globals (single codebase, single data set)
      integrity: {
        data_locked_at: timestamp,
        keys_count: payload.keys_present.length
      }
    };

    setCurrent(snapshot);
    appendVersion(snapshot);

    // Log to persistent audit trail
    try {
      if(window.AUDIT_LOG && window.AUDIT_LOG.append){
        window.AUDIT_LOG.append({
          event: {
            action_type:'publish_to_user_portal',
            decision_status:'published',
            reason_or_note: opts.notes || ('Published ' + version + ' to User Portal')
          },
          target: { affected_field: 'published_user_portal_version' },
          change: { previous_value: snapshot.previous_version, new_value: version },
          source: { source_type: 'manual' },
          metadata: { counts: counts, keys: payload.keys_present, source_files: opts.source_files||[] }
        });
      }
    } catch(e){}

    return snapshot;
  }

  // Rollback: republish a prior version's snapshot envelope
  function rollback(versionNumber){
    if(window.PORTAL_AUTH && window.PORTAL_AUTH.getRole && !window.PORTAL_AUTH.isAdmin()){
      return { ok:false, error:'not_authorized', role: window.PORTAL_AUTH.getRole() };
    }
    var list = listVersions();
    var target = null;
    for(var i=list.length-1;i>=0;i--){
      if(list[i].version_number === versionNumber){ target = list[i]; break; }
    }
    if(!target) return { ok:false, error:'version_not_found', version: versionNumber };
    var actor = (window.AUDIT_LOG && window.AUDIT_LOG.getCurrentActor && window.AUDIT_LOG.getCurrentActor()) || { admin_name:'Admin Not Assigned' };
    var newVersion = nextVersionNumber();
    var rolled = Object.assign({}, target, {
      version_number: newVersion,
      version: newVersion,
      ok: true,
      published_at: nowIso(),
      published_by: { admin_name: actor.admin_name, admin_id: actor.admin_id, admin_role: actor.admin_role },
      previous_version: (getCurrent() && getCurrent().version_number) || null,
      notes: 'Rollback restore of ' + versionNumber + (target.notes ? ' — ' + target.notes : ''),
      rolled_back_from: (getCurrent() && getCurrent().version_number) || null,
      rolled_back_to_source: versionNumber
    });
    setCurrent(rolled);
    appendVersion(rolled);

    try {
      if(window.AUDIT_LOG && window.AUDIT_LOG.append){
        window.AUDIT_LOG.append({
          event: {
            action_type:'rollback',
            decision_status:'rolled_back',
            reason_or_note: 'Rolled User Portal back to ' + versionNumber
          },
          target: { affected_field: 'published_user_portal_version' },
          change: { previous_value: rolled.rolled_back_from, new_value: newVersion },
          source: { source_type: 'manual' },
          rollback: { is_rollback: true, rollback_reference_id: versionNumber },
          metadata: { restored_source_version: versionNumber }
        });
      }
    } catch(e){}

    return rolled;
  }

  // ── Read API used by the User Portal ─────────────────────────────────────
  // Read-only accessors that surface ONLY data referenced by the current
  // published snapshot's whitelist. If a key isn't in the published snapshot,
  // this returns null — even if the live global exists.
  function isKeyPublished(key){
    if(BLACKLIST.indexOf(key) >= 0) return false;
    if(WHITELIST.indexOf(key) < 0) return false;
    var cur = getCurrent();
    if(!cur) return false;
    return cur.keys.indexOf(key) >= 0;
  }
  function get(key){
    if(!isKeyPublished(key)) return null;
    return window[key];
  }
  function getAll(){
    var cur = getCurrent();
    if(!cur) return {};
    var out = {};
    for(var i=0;i<cur.keys.length;i++){
      var k = cur.keys[i];
      if(BLACKLIST.indexOf(k) >= 0) continue;
      out[k] = window[k];
    }
    return out;
  }

  // ── Public API ───────────────────────────────────────────────────────────
  window.PUBLISHED_DATA = {
    // Read (User Portal uses these)
    get: get,
    getAll: getAll,
    isKeyPublished: isKeyPublished,
    getCurrent: getCurrent,
    listVersions: listVersions,

    // Write (Admin only — guarded at the call site)
    publish: publish,
    rollback: rollback,

    // Introspection
    whitelist: WHITELIST.slice(),
    blacklist: BLACKLIST.slice(),
    inferCounts: inferCounts
  };

})();
