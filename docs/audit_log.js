/* ============================================================================
 * audit_log.js — Persistent Historical Audit Trail (Deborah Dashboard)
 * ----------------------------------------------------------------------------
 * Owns the persistent, multi-session, append-only audit trail that backs the
 * Updates Center "Update Logs" surface.
 *
 *   - Storage:  localStorage (key: deborah_audit_log_v1), wrapped in an
 *               adapter so a future REST/SQL backend can drop in without
 *               touching call sites.  INTERIM — see StorageAdapter.
 *   - Schema:   audit_id, timestamp, session_id, actor{}, event{}, target{},
 *               change{}, source{}, rollback{}, metadata{}.  Append-only:
 *               rollbacks WRITE A NEW ENTRY referencing the original.
 *   - Actors:   "Admin Not Assigned" (default human), "System",
 *               "Automated Update Engine", "AI Recommendation Engine",
 *               "Legacy Session User".  setCurrentActor() is the single
 *               hook a future auth layer wires into.
 *   - UI:       Renders inside <section id="updatesActivityLog">.  Provides
 *               sub-tabs (All Historical · Current Session · By Grant ·
 *               By Admin · Rollbacks · Export), a filter bar, an expandable
 *               table with full schema details, a grant-level history modal,
 *               and CSV / TSV / JSON exports.
 *
 * Performance note: synchronous load (after data.js, before updates_center.js)
 * is required so window.AUDIT_LOG is defined when updates_center boots.  We
 * do NOT register any top-level boot global the inline splash watches for.
 * ========================================================================== */
(function(){
  'use strict';

  // ── Constants ─────────────────────────────────────────────────────────────
  var STORAGE_KEY  = 'deborah_audit_log_v1';
  var SESSION_KEY  = 'deborah_audit_session_id';
  var COUNTER_KEY  = 'deborah_audit_counter';
  var SCHEMA_VER   = 1;
  var MAX_ENTRIES  = 50000;     // hard ceiling — protects localStorage budget
  var TRIM_TO      = 45000;     // when MAX exceeded, trim oldest down to here
  var MAX_SNAPSHOT = 4000;      // characters per snapshot field
  var RENDER_PAGE  = 200;       // table rows per page

  var EVENT_TYPES = [
    'run_update','approve','reject','edit','merge','rollback','verify',
    'import','override','sent_to_review','exported','package_ready',
    'run_started','run_failed','ai_recommendation','manual_correction',
    'classification_change','schedule_change','engine_event'
  ];

  var ACTOR_TYPES = ['human','system','ai'];

  // ── Utilities ─────────────────────────────────────────────────────────────
  function nowIso(){ return new Date().toISOString(); }
  function pad(n,w){ var s=String(n); while(s.length<w) s='0'+s; return s; }
  function escH(s){
    return String(s==null?'':s).replace(/[&<>"']/g, function(c){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }
  function safeJson(obj){
    try { return JSON.stringify(obj); } catch(e){ return '"[unserializable]"'; }
  }
  function trimSnap(v){
    if(v==null) return v;
    var s = typeof v==='string' ? v : safeJson(v);
    if(s.length > MAX_SNAPSHOT) s = s.slice(0, MAX_SNAPSHOT) + '…[truncated]';
    return s;
  }
  function deepClone(o){
    try { return JSON.parse(JSON.stringify(o)); } catch(e){ return o; }
  }
  function fmtTs(iso){
    if(!iso) return '—';
    try {
      var d = new Date(iso);
      if(isNaN(d.getTime())) return iso;
      return d.toISOString().replace('T',' ').replace(/\..*/,'') + ' UTC';
    } catch(e){ return iso; }
  }
  function todayStamp(){
    var d = new Date();
    return d.getUTCFullYear() + pad(d.getUTCMonth()+1,2) + pad(d.getUTCDate(),2);
  }
  function uniq(arr){
    var seen={}, out=[];
    for(var i=0;i<arr.length;i++){
      var k = arr[i]==null?'':String(arr[i]);
      if(!seen[k]){ seen[k]=1; out.push(arr[i]); }
    }
    return out;
  }

  // ── Storage Adapter ───────────────────────────────────────────────────────
  // INTERIM: localStorage-backed.  Same interface a future REST/SQL backend
  // implements (load → GET, append → POST, update → PATCH, clear → DELETE).
  function StorageAdapter(){
    var memCache = null;

    function readRaw(){
      if(memCache) return memCache;
      try {
        if(typeof localStorage === 'undefined') return { schema_version:SCHEMA_VER, entries:[] };
        var raw = localStorage.getItem(STORAGE_KEY);
        if(!raw) return { schema_version:SCHEMA_VER, entries:[] };
        var parsed = JSON.parse(raw);
        if(!parsed || !Array.isArray(parsed.entries)) {
          return { schema_version:SCHEMA_VER, entries:[] };
        }
        memCache = parsed;
        return parsed;
      } catch(e){
        console.warn('[AUDIT_LOG] storage read failed; starting fresh in-memory', e);
        return { schema_version:SCHEMA_VER, entries:[] };
      }
    }
    function writeRaw(payload){
      memCache = payload;
      try {
        if(typeof localStorage === 'undefined') return false;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        return true;
      } catch(e){
        // Quota exceeded or other — trim aggressively and retry once.
        try {
          if(payload.entries.length > TRIM_TO){
            payload.entries = payload.entries.slice(-TRIM_TO);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
            return true;
          }
        } catch(e2){
          console.warn('[AUDIT_LOG] storage write failed after trim', e2);
        }
        return false;
      }
    }

    return {
      load: function(){
        var data = readRaw();
        return data.entries.slice();
      },
      append: function(entry){
        var data = readRaw();
        data.schema_version = SCHEMA_VER;
        data.entries.push(entry);
        if(data.entries.length > MAX_ENTRIES){
          data.entries = data.entries.slice(-TRIM_TO);
        }
        writeRaw(data);
        return entry;
      },
      update: function(audit_id, patch){
        // Only used for non-history-bearing metadata (e.g., post-write tagging).
        // Schema is append-only; do NOT use this to mutate event content.
        var data = readRaw();
        for(var i=0;i<data.entries.length;i++){
          if(data.entries[i].audit_id === audit_id){
            data.entries[i].metadata = Object.assign({}, data.entries[i].metadata||{}, patch||{});
            writeRaw(data);
            return data.entries[i];
          }
        }
        return null;
      },
      clear: function(){
        memCache = null;
        try { if(typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY); } catch(e){}
        return true;
      }
    };
  }

  var storage = StorageAdapter();

  // ── Session + counter ─────────────────────────────────────────────────────
  function getOrMakeSessionId(){
    try {
      var s = sessionStorage.getItem(SESSION_KEY);
      if(s) return s;
      s = 'SESSION-' + todayStamp() + '-' + Math.random().toString(36).slice(2,8).toUpperCase();
      sessionStorage.setItem(SESSION_KEY, s);
      return s;
    } catch(e){
      return 'SESSION-' + todayStamp() + '-' + Math.random().toString(36).slice(2,8).toUpperCase();
    }
  }
  var SESSION_ID = getOrMakeSessionId();

  function nextAuditId(){
    var stamp = todayStamp();
    var n = 1;
    try {
      var raw = localStorage.getItem(COUNTER_KEY);
      var c = raw ? JSON.parse(raw) : null;
      if(c && c.stamp === stamp) n = (c.n|0) + 1;
      localStorage.setItem(COUNTER_KEY, JSON.stringify({ stamp:stamp, n:n }));
    } catch(e){ /* fall through */ }
    return 'AUD-' + stamp + '-' + pad(n, 6);
  }

  // ── Current Actor ─────────────────────────────────────────────────────────
  // Multi-admin-ready.  Default is the unauthenticated placeholder so the
  // dashboard can ship before auth lands.  Future auth wires into setCurrentActor.
  var CURRENT_ACTOR = {
    admin_id: 'unassigned',
    admin_name: 'Admin Not Assigned',
    admin_role: 'admin',
    actor_type: 'human'
  };
  function setCurrentActor(actor){
    if(!actor || typeof actor !== 'object') return CURRENT_ACTOR;
    CURRENT_ACTOR = {
      admin_id:   actor.admin_id   || CURRENT_ACTOR.admin_id,
      admin_name: actor.admin_name || CURRENT_ACTOR.admin_name,
      admin_role: actor.admin_role || CURRENT_ACTOR.admin_role,
      actor_type: ACTOR_TYPES.indexOf(actor.actor_type) >= 0 ? actor.actor_type : CURRENT_ACTOR.actor_type
    };
    try { localStorage.setItem('deborah_current_actor', JSON.stringify(CURRENT_ACTOR)); } catch(e){}
    return CURRENT_ACTOR;
  }
  function getCurrentActor(){ return Object.assign({}, CURRENT_ACTOR); }
  // Rehydrate
  try {
    var rawActor = localStorage.getItem('deborah_current_actor');
    if(rawActor){
      var a = JSON.parse(rawActor);
      if(a && a.admin_name) CURRENT_ACTOR = a;
    }
  } catch(e){}

  // System actor presets (for engine-originated events)
  var ACTOR_PRESETS = {
    system:    { admin_id:'system',   admin_name:'System',                    admin_role:'system', actor_type:'system' },
    engine:    { admin_id:'auto-eng', admin_name:'Automated Update Engine',   admin_role:'engine', actor_type:'system' },
    ai:        { admin_id:'ai-rec',   admin_name:'AI Recommendation Engine',  admin_role:'ai',     actor_type:'ai'     },
    legacy:    { admin_id:'legacy',   admin_name:'Legacy Session User',       admin_role:'admin',  actor_type:'human'  }
  };

  // ── Append (the canonical write) ──────────────────────────────────────────
  function append(input){
    var i = input || {};
    var actorIn = i.actor || {};
    var preset = i.actor_preset ? ACTOR_PRESETS[i.actor_preset] : null;
    var actor = preset
      ? Object.assign({}, preset, actorIn)
      : Object.assign({}, CURRENT_ACTOR, actorIn);

    var event = Object.assign({
      action_type: 'engine_event',
      decision_status: '',
      reason_or_note: ''
    }, i.event||{});

    var target = Object.assign({
      grant_id:'', recipient_id:'', recipient_name:'',
      foundation_id:'', foundation_name:'',
      update_package_id:'', update_card_id:'',
      affected_field:''
    }, i.target||{});

    var change = i.change ? {
      previous_value: trimSnap(i.change.previous_value),
      new_value: trimSnap(i.change.new_value),
      previous_record_snapshot: i.change.previous_record_snapshot ? deepClone(i.change.previous_record_snapshot) : null,
      updated_record_snapshot: i.change.updated_record_snapshot ? deepClone(i.change.updated_record_snapshot) : null
    } : { previous_value:null, new_value:null, previous_record_snapshot:null, updated_record_snapshot:null };

    var source = Object.assign({
      source_type: actor.actor_type === 'system' ? 'automated_update'
                  : actor.actor_type === 'ai'     ? 'ai_recommendation'
                  : 'manual',
      source_url:''
    }, i.source||{});

    var rollback = Object.assign({ is_rollback:false, rollback_reference_id:'' }, i.rollback||{});

    var entry = {
      audit_id: nextAuditId(),
      timestamp: i.timestamp || nowIso(),
      session_id: i.session_id || SESSION_ID,
      schema_version: SCHEMA_VER,
      actor: actor,
      event: event,
      target: target,
      change: change,
      source: source,
      rollback: rollback,
      metadata: Object.assign({}, i.metadata||{})
    };

    storage.append(entry);
    try { scheduleRender(); } catch(e){}
    return entry;
  }

  // Convenience: bridge from legacy logActivity(card_id, kind, payload)
  function appendFromLegacy(card_id, kind, payload){
    payload = payload || {};
    var actionMap = {
      'run_started':'run_update',
      'run_failed':'run_update',
      'package_ready':'run_update',
      'merge_completed':'merge',
      'rejected':'reject',
      'sent_to_review':'sent_to_review',
      'exported':'exported',
      'rollback':'rollback'
    };
    var action = actionMap[kind] || kind || 'engine_event';
    var statusMap = {
      'run_started':'started',
      'run_failed':'failed',
      'package_ready':'awaiting_approval',
      'merge_completed':'approved_merged',
      'rejected':'rejected',
      'sent_to_review':'in_review',
      'exported':'exported',
      'rollback':'rolled_back'
    };
    var isRollback = (kind === 'rollback');
    var preset;
    if(kind === 'run_started' || kind === 'package_ready' || kind === 'run_failed') preset = 'engine';
    else preset = null; // human admin action

    return append({
      actor_preset: preset,
      event: {
        action_type: action,
        decision_status: statusMap[kind] || '',
        reason_or_note: payload.note || ''
      },
      target: {
        update_card_id: card_id || '',
        update_package_id: payload.package_id || '',
        grant_id: payload.grant_id || '',
        recipient_id: payload.recipient_id || '',
        recipient_name: payload.recipient_name || '',
        foundation_id: payload.foundation_id || '',
        foundation_name: payload.foundation_name || '',
        affected_field: payload.affected_field || ''
      },
      change: payload.change || null,
      source: {
        source_type: preset === 'engine' ? 'automated_update' : 'manual',
        source_url: payload.source_url || ''
      },
      rollback: {
        is_rollback: isRollback,
        rollback_reference_id: payload.rollback_reference_id || ''
      },
      metadata: {
        legacy_kind: kind,
        action: payload.action || '',
        version: payload.version || '',
        counts: payload.counts || null
      }
    });
  }

  // ── Query API ─────────────────────────────────────────────────────────────
  function all(){ return storage.load(); }

  function query(filters){
    filters = filters || {};
    var rows = storage.load();
    var fromTs = filters.from ? Date.parse(filters.from) : null;
    var toTs   = filters.to   ? Date.parse(filters.to)   : null;
    var kw     = filters.keyword ? String(filters.keyword).toLowerCase() : '';

    return rows.filter(function(r){
      if(filters.session_id && r.session_id !== filters.session_id) return false;
      if(filters.actor_name && (r.actor.admin_name||'') !== filters.actor_name) return false;
      if(filters.actor_type && (r.actor.actor_type||'') !== filters.actor_type) return false;
      if(filters.event_type && (r.event.action_type||'') !== filters.event_type) return false;
      if(filters.status && (r.event.decision_status||'') !== filters.status) return false;
      if(filters.source_type && (r.source.source_type||'') !== filters.source_type) return false;
      if(filters.grant_id && (r.target.grant_id||'') !== filters.grant_id) return false;
      if(filters.recipient_name && (r.target.recipient_name||'').toLowerCase().indexOf(String(filters.recipient_name).toLowerCase()) < 0) return false;
      if(filters.foundation_name && (r.target.foundation_name||'').toLowerCase().indexOf(String(filters.foundation_name).toLowerCase()) < 0) return false;
      if(filters.update_card_id && (r.target.update_card_id||'') !== filters.update_card_id) return false;
      if(filters.update_package_id && (r.target.update_package_id||'').toLowerCase().indexOf(String(filters.update_package_id).toLowerCase()) < 0) return false;
      if(filters.rollbacks_only && !r.rollback.is_rollback) return false;
      if(filters.automated_only && r.source.source_type !== 'automated_update' && r.source.source_type !== 'ai_recommendation') return false;
      if(filters.manual_only && r.source.source_type !== 'manual') return false;
      if(fromTs && Date.parse(r.timestamp) < fromTs) return false;
      if(toTs && Date.parse(r.timestamp) > (toTs + 24*3600*1000 - 1)) return false;
      if(kw){
        var hay = [
          r.audit_id, r.actor.admin_name, r.event.action_type, r.event.decision_status,
          r.event.reason_or_note, r.target.grant_id, r.target.recipient_name,
          r.target.foundation_name, r.target.affected_field, r.target.update_package_id,
          r.source.source_type, r.source.source_url
        ].join(' ').toLowerCase();
        if(hay.indexOf(kw) < 0) return false;
      }
      return true;
    });
  }

  function byGrant(grant_id){
    if(!grant_id) return [];
    return query({ grant_id: grant_id });
  }
  function byAdmin(admin_name){
    if(!admin_name) return [];
    return query({ actor_name: admin_name });
  }
  function rollbacks(){ return query({ rollbacks_only: true }); }
  function currentSession(){ return query({ session_id: SESSION_ID }); }

  // ── Exports ───────────────────────────────────────────────────────────────
  function flatten(r){
    return {
      audit_id: r.audit_id,
      timestamp: r.timestamp,
      session_id: r.session_id,
      admin_name: r.actor.admin_name,
      admin_id: r.actor.admin_id,
      admin_role: r.actor.admin_role,
      actor_type: r.actor.actor_type,
      action_type: r.event.action_type,
      decision_status: r.event.decision_status,
      reason_or_note: r.event.reason_or_note,
      grant_id: r.target.grant_id,
      recipient_id: r.target.recipient_id,
      recipient_name: r.target.recipient_name,
      foundation_id: r.target.foundation_id,
      foundation_name: r.target.foundation_name,
      update_package_id: r.target.update_package_id,
      update_card_id: r.target.update_card_id,
      affected_field: r.target.affected_field,
      previous_value: r.change.previous_value,
      new_value: r.change.new_value,
      source_type: r.source.source_type,
      source_url: r.source.source_url,
      is_rollback: r.rollback.is_rollback,
      rollback_reference_id: r.rollback.rollback_reference_id
    };
  }
  function csvEscape(v){
    if(v==null) return '';
    var s = (typeof v==='string') ? v : (typeof v==='object' ? safeJson(v) : String(v));
    if(/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g,'""') + '"';
    return s;
  }
  function toDelimited(rows, delim){
    if(!rows.length) return '';
    var flat = rows.map(flatten);
    var cols = Object.keys(flat[0]);
    var head = cols.join(delim);
    var body = flat.map(function(r){
      return cols.map(function(c){ return csvEscape(r[c]); }).join(delim);
    }).join('\n');
    return head + '\n' + body;
  }
  function download(filename, content, mime){
    try {
      var blob = new Blob([content], { type: mime || 'text/plain' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function(){ URL.revokeObjectURL(url); }, 1500);
    } catch(e){ console.error('[AUDIT_LOG] download failed', e); }
  }
  function exportRows(rows, format, filename){
    rows = rows || filteredRows();
    var stamp = todayStamp();
    var name = filename || ('deborah_audit_log_' + stamp);
    if(format === 'tsv'){
      download(name + '.tsv', toDelimited(rows, '\t'), 'text/tab-separated-values');
    } else if(format === 'json'){
      download(name + '.json', JSON.stringify(rows, null, 2), 'application/json');
    } else {
      download(name + '.csv', toDelimited(rows, ','), 'text/csv');
    }
    // Self-log the export
    append({
      event: { action_type:'exported', decision_status:'export', reason_or_note: 'Audit log export · ' + (format||'csv').toUpperCase() + ' · ' + rows.length + ' rows' },
      source: { source_type:'manual' },
      metadata: { export_format: format||'csv', export_rows: rows.length }
    });
  }

  // ── UI state ──────────────────────────────────────────────────────────────
  var UI = {
    tab: 'all',                // all | session | grant | admin | rollback | export
    filters: {},
    expanded: {},              // audit_id -> bool
    page: 1,
    grantFocus: '',
    adminFocus: ''
  };

  // ── UI helpers ────────────────────────────────────────────────────────────
  function $$(id){ return document.getElementById(id); }
  function getFilteredRowsForTab(){
    var rows;
    if(UI.tab === 'session')      rows = currentSession();
    else if(UI.tab === 'rollback') rows = rollbacks();
    else if(UI.tab === 'grant')   rows = UI.grantFocus ? byGrant(UI.grantFocus) : all();
    else if(UI.tab === 'admin')   rows = UI.adminFocus ? byAdmin(UI.adminFocus) : all();
    else                          rows = all();
    if(Object.keys(UI.filters).length){
      rows = rows.filter(function(r){
        // apply UI.filters on top
        return query(UI.filters).indexOf(r) >= 0;
      });
      // simpler: re-run query against all then intersect by id
      var idsByQuery = {};
      query(UI.filters).forEach(function(r){ idsByQuery[r.audit_id] = 1; });
      rows = rows.filter(function(r){ return idsByQuery[r.audit_id]; });
    }
    // newest first
    rows.sort(function(a,b){ return (b.timestamp||'').localeCompare(a.timestamp||''); });
    return rows;
  }
  function filteredRows(){ return getFilteredRowsForTab(); }

  // ── Style injection ───────────────────────────────────────────────────────
  function injectCss(){
    if(document.getElementById('audit-log-styles')) return;
    var css = ''+
    '.aud-wrap{font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;}'+
    '.aud-section{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:18px 20px;margin:14px 0;box-shadow:0 1px 2px rgba(0,0,0,.03);}'+
    '.aud-h{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;margin-bottom:8px;}'+
    '.aud-h h2{font-size:17px;font-weight:600;margin:0;letter-spacing:-.01em;}'+
    '.aud-sub{color:#6b7280;font-size:12.5px;margin-bottom:14px;}'+
    '.aud-tabs{display:flex;gap:4px;flex-wrap:wrap;border-bottom:1px solid #e5e7eb;margin-bottom:14px;}'+
    '.aud-tab{padding:8px 14px;font-size:12.5px;border:none;background:none;color:#4b5563;border-bottom:2px solid transparent;cursor:pointer;border-radius:4px 4px 0 0;}'+
    '.aud-tab:hover{background:#f9fafb;color:#111;}'+
    '.aud-tab.active{color:#01696f;border-bottom-color:#01696f;font-weight:600;}'+
    '.aud-filterbar{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:10px;margin-bottom:12px;}'+
    '.aud-filterbar input,.aud-filterbar select{font-size:12px;padding:5px 7px;border:1px solid #d1d5db;border-radius:4px;background:#fff;width:100%;box-sizing:border-box;}'+
    '.aud-filterbar label{font-size:11px;color:#6b7280;display:block;margin-bottom:2px;}'+
    '.aud-actions{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;align-items:center;}'+
    '.aud-btn{font-size:12px;padding:6px 12px;border:1px solid #d1d5db;background:#fff;color:#1a1a1a;border-radius:4px;cursor:pointer;}'+
    '.aud-btn:hover{background:#f3f4f6;border-color:#9ca3af;}'+
    '.aud-btn.primary{background:#01696f;color:#fff;border-color:#01696f;}'+
    '.aud-btn.primary:hover{background:#0c4e54;border-color:#0c4e54;}'+
    '.aud-btn.ghost{background:transparent;border-color:transparent;color:#4b5563;}'+
    '.aud-btn.ghost:hover{background:#f3f4f6;}'+
    '.aud-table{width:100%;border-collapse:collapse;font-size:12px;}'+
    '.aud-table th{text-align:left;font-weight:600;color:#374151;background:#f9fafb;padding:8px 10px;border-bottom:1px solid #e5e7eb;white-space:nowrap;font-size:11.5px;text-transform:uppercase;letter-spacing:.03em;}'+
    '.aud-table td{padding:8px 10px;border-bottom:1px solid #f1f3f4;vertical-align:top;}'+
    '.aud-table tr:hover{background:#fafbfc;}'+
    '.aud-table .mono{font-family:ui-monospace,SF Mono,Consolas,monospace;font-size:11.5px;}'+
    '.aud-pill{display:inline-block;padding:2px 7px;border-radius:10px;font-size:10.5px;font-weight:500;background:#f3f4f6;color:#374151;}'+
    '.aud-pill.ok{background:#e6f4ea;color:#1e6b32;}'+
    '.aud-pill.warn{background:#fff4e0;color:#8a4b00;}'+
    '.aud-pill.err{background:#fde7ea;color:#a12c2c;}'+
    '.aud-pill.info{background:#e3f2f5;color:#0c4e54;}'+
    '.aud-pill.rb{background:#f3e8ff;color:#5b21b6;}'+
    '.aud-pill.ai{background:#fef3c7;color:#92400e;}'+
    '.aud-pill.sys{background:#e0e7ff;color:#3730a3;}'+
    '.aud-empty{padding:32px;text-align:center;color:#6b7280;font-style:italic;background:#fafbfc;border-radius:6px;border:1px dashed #e5e7eb;}'+
    '.aud-drawer{background:#f9fafb;padding:14px;font-size:12px;border-top:1px solid #e5e7eb;}'+
    '.aud-drawer-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;}'+
    '.aud-drawer-grid h4{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;margin:0 0 4px;}'+
    '.aud-drawer-grid div{font-family:ui-monospace,SF Mono,Consolas,monospace;font-size:11.5px;color:#1a1a1a;word-break:break-word;}'+
    '.aud-snap{background:#fff;border:1px solid #e5e7eb;border-radius:4px;padding:8px;font-family:ui-monospace,SF Mono,Consolas,monospace;font-size:11px;max-height:200px;overflow:auto;white-space:pre-wrap;color:#374151;}'+
    '.aud-modal-back{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9998;display:flex;align-items:center;justify-content:center;padding:20px;}'+
    '.aud-modal{background:#fff;border-radius:8px;width:100%;max-width:900px;max-height:85vh;overflow:auto;box-shadow:0 20px 50px rgba(0,0,0,.25);}'+
    '.aud-modal-h{padding:16px 20px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;}'+
    '.aud-modal-b{padding:18px 20px;}'+
    '.aud-row-expand{cursor:pointer;color:#01696f;font-weight:500;}'+
    '.aud-pager{display:flex;gap:6px;align-items:center;font-size:12px;color:#6b7280;}'+
    '.aud-banner{background:#f0f9fa;border:1px solid #b8dde0;border-radius:6px;padding:10px 12px;font-size:12px;color:#0c4e54;margin-bottom:10px;}';
    var style = document.createElement('style');
    style.id = 'audit-log-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ── Render ────────────────────────────────────────────────────────────────
  var _rafToken = null;
  function scheduleRender(){
    if(_rafToken) return;
    _rafToken = (window.requestAnimationFrame||function(cb){return setTimeout(cb,16);})(function(){
      _rafToken = null;
      render();
    });
  }

  function pillFor(r){
    var a = r.event.action_type;
    if(r.rollback.is_rollback) return '<span class="aud-pill rb">rollback</span>';
    if(a==='approve' || a==='merge') return '<span class="aud-pill ok">'+escH(a)+'</span>';
    if(a==='reject' || a==='run_failed') return '<span class="aud-pill err">'+escH(a)+'</span>';
    if(a==='ai_recommendation') return '<span class="aud-pill ai">'+escH(a)+'</span>';
    if(r.actor.actor_type==='system') return '<span class="aud-pill sys">'+escH(a)+'</span>';
    if(a==='sent_to_review') return '<span class="aud-pill warn">'+escH(a)+'</span>';
    return '<span class="aud-pill info">'+escH(a||'event')+'</span>';
  }

  function renderRow(r){
    var expanded = !!UI.expanded[r.audit_id];
    var pkgLabel = r.target.update_card_id ? (r.target.update_card_id + (r.target.update_package_id?(' · '+r.target.update_package_id):'')) : (r.target.update_package_id||'—');
    var actorLabel = escH(r.actor.admin_name||'') + (r.actor.actor_type !== 'human' ? ' <span class="aud-pill ' + (r.actor.actor_type==='ai'?'ai':'sys') + '">'+escH(r.actor.actor_type)+'</span>' : '');
    var grantLabel = r.target.grant_id
      ? '<button class="aud-btn ghost" onclick="window.AUDIT_LOG.showGrantHistory(\''+escH(r.target.grant_id).replace(/'/g,"\\'")+'\')">'+escH(r.target.grant_id)+'</button>'
      : (r.target.recipient_name ? escH(r.target.recipient_name) : '—');

    var rowHtml = ''+
      '<tr data-aid="'+escH(r.audit_id)+'">'+
        '<td class="mono">'+escH(fmtTs(r.timestamp))+'</td>'+
        '<td>'+actorLabel+'</td>'+
        '<td>'+grantLabel+'</td>'+
        '<td>'+escH(pkgLabel)+'</td>'+
        '<td>'+pillFor(r)+'</td>'+
        '<td>'+escH(r.target.affected_field||'—')+'</td>'+
        '<td class="mono">'+escH(r.change.previous_value==null?'—':String(r.change.previous_value).slice(0,80))+'</td>'+
        '<td class="mono">'+escH(r.change.new_value==null?'—':String(r.change.new_value).slice(0,80))+'</td>'+
        '<td>'+escH(r.source.source_type||'—')+'</td>'+
        '<td><span class="aud-row-expand" onclick="window.AUDIT_LOG.toggleRow(\''+escH(r.audit_id)+'\')">'+(expanded?'Hide':'Details')+'</span></td>'+
      '</tr>';

    if(expanded){
      rowHtml += ''+
      '<tr><td colspan="10" class="aud-drawer">'+
        '<div class="aud-drawer-grid">'+
          '<div><h4>Audit ID</h4><div>'+escH(r.audit_id)+'</div></div>'+
          '<div><h4>Session</h4><div>'+escH(r.session_id)+'</div></div>'+
          '<div><h4>Actor</h4><div>'+escH(r.actor.admin_name)+' · '+escH(r.actor.admin_role)+' · '+escH(r.actor.actor_type)+'</div></div>'+
          '<div><h4>Decision status</h4><div>'+escH(r.event.decision_status||'—')+'</div></div>'+
          '<div><h4>Reason / note</h4><div>'+escH(r.event.reason_or_note||'—')+'</div></div>'+
          '<div><h4>Grant ID</h4><div>'+escH(r.target.grant_id||'—')+'</div></div>'+
          '<div><h4>Recipient</h4><div>'+escH(r.target.recipient_name||'—')+(r.target.recipient_id?(' · '+escH(r.target.recipient_id)):'')+'</div></div>'+
          '<div><h4>Foundation</h4><div>'+escH(r.target.foundation_name||'—')+(r.target.foundation_id?(' · '+escH(r.target.foundation_id)):'')+'</div></div>'+
          '<div><h4>Affected field</h4><div>'+escH(r.target.affected_field||'—')+'</div></div>'+
          '<div><h4>Source</h4><div>'+escH(r.source.source_type)+(r.source.source_url?(' · <a href="'+escH(r.source.source_url)+'" target="_blank" rel="noopener">link</a>'):'')+'</div></div>'+
          '<div><h4>Rollback</h4><div>'+(r.rollback.is_rollback?('YES → '+escH(r.rollback.rollback_reference_id||'')):'No')+'</div></div>'+
          '<div><h4>Update package / card</h4><div>'+escH(r.target.update_package_id||'—')+' / '+escH(r.target.update_card_id||'—')+'</div></div>'+
        '</div>'+
        (r.change.previous_record_snapshot || r.change.updated_record_snapshot ?
          '<div style="margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:12px;">'+
            '<div><h4 style="font-size:11px;text-transform:uppercase;color:#6b7280;margin:0 0 4px;">Previous snapshot</h4><div class="aud-snap">'+escH(typeof r.change.previous_record_snapshot==='string'?r.change.previous_record_snapshot:safeJson(r.change.previous_record_snapshot))+'</div></div>'+
            '<div><h4 style="font-size:11px;text-transform:uppercase;color:#6b7280;margin:0 0 4px;">Updated snapshot</h4><div class="aud-snap">'+escH(typeof r.change.updated_record_snapshot==='string'?r.change.updated_record_snapshot:safeJson(r.change.updated_record_snapshot))+'</div></div>'+
          '</div>' : '')+
        (r.metadata && Object.keys(r.metadata).length ?
          '<div style="margin-top:10px;"><h4 style="font-size:11px;text-transform:uppercase;color:#6b7280;margin:0 0 4px;">Metadata</h4><div class="aud-snap">'+escH(safeJson(r.metadata))+'</div></div>' : '')+
      '</td></tr>';
    }
    return rowHtml;
  }

  function buildFilterBar(){
    var rows = all();
    var actors = uniq(rows.map(function(r){ return r.actor.admin_name; }).filter(Boolean));
    var actions = uniq(rows.map(function(r){ return r.event.action_type; }).filter(Boolean));
    var sources = uniq(rows.map(function(r){ return r.source.source_type; }).filter(Boolean));
    var statuses = uniq(rows.map(function(r){ return r.event.decision_status; }).filter(Boolean));
    var cards = uniq(rows.map(function(r){ return r.target.update_card_id; }).filter(Boolean));

    function opts(list){
      return '<option value="">All</option>' + list.map(function(v){ return '<option value="'+escH(v)+'">'+escH(v)+'</option>'; }).join('');
    }
    var f = UI.filters || {};
    return ''+
    '<div class="aud-filterbar">'+
      '<div><label>From date</label><input type="date" value="'+escH(f.from||'')+'" onchange="window.AUDIT_LOG.setFilter(\'from\', this.value)"></div>'+
      '<div><label>To date</label><input type="date" value="'+escH(f.to||'')+'" onchange="window.AUDIT_LOG.setFilter(\'to\', this.value)"></div>'+
      '<div><label>Admin / Actor</label><select onchange="window.AUDIT_LOG.setFilter(\'actor_name\', this.value)">'+opts(actors).replace('value="'+escH(f.actor_name||'')+'"', 'value="'+escH(f.actor_name||'')+'" selected')+'</select></div>'+
      '<div><label>Event type</label><select onchange="window.AUDIT_LOG.setFilter(\'event_type\', this.value)">'+opts(actions).replace('value="'+escH(f.event_type||'')+'"', 'value="'+escH(f.event_type||'')+'" selected')+'</select></div>'+
      '<div><label>Status</label><select onchange="window.AUDIT_LOG.setFilter(\'status\', this.value)">'+opts(statuses).replace('value="'+escH(f.status||'')+'"', 'value="'+escH(f.status||'')+'" selected')+'</select></div>'+
      '<div><label>Source</label><select onchange="window.AUDIT_LOG.setFilter(\'source_type\', this.value)">'+opts(sources).replace('value="'+escH(f.source_type||'')+'"', 'value="'+escH(f.source_type||'')+'" selected')+'</select></div>'+
      '<div><label>Update card</label><select onchange="window.AUDIT_LOG.setFilter(\'update_card_id\', this.value)">'+opts(cards).replace('value="'+escH(f.update_card_id||'')+'"', 'value="'+escH(f.update_card_id||'')+'" selected')+'</select></div>'+
      '<div><label>Grant ID</label><input type="text" placeholder="GR-…" value="'+escH(f.grant_id||'')+'" oninput="window.AUDIT_LOG.setFilter(\'grant_id\', this.value)"></div>'+
      '<div><label>Recipient name</label><input type="text" placeholder="contains…" value="'+escH(f.recipient_name||'')+'" oninput="window.AUDIT_LOG.setFilter(\'recipient_name\', this.value)"></div>'+
      '<div><label>Foundation name</label><input type="text" placeholder="contains…" value="'+escH(f.foundation_name||'')+'" oninput="window.AUDIT_LOG.setFilter(\'foundation_name\', this.value)"></div>'+
      '<div><label>Package ID</label><input type="text" placeholder="PKG-…" value="'+escH(f.update_package_id||'')+'" oninput="window.AUDIT_LOG.setFilter(\'update_package_id\', this.value)"></div>'+
      '<div><label>Keyword</label><input type="text" placeholder="search any field…" value="'+escH(f.keyword||'')+'" oninput="window.AUDIT_LOG.setFilter(\'keyword\', this.value)"></div>'+
      '<div><label>&nbsp;</label><label style="display:flex;align-items:center;gap:4px;font-size:12px;color:#374151;"><input type="checkbox" '+(f.rollbacks_only?'checked':'')+' onchange="window.AUDIT_LOG.setFilter(\'rollbacks_only\', this.checked)"> Rollbacks only</label></div>'+
      '<div><label>&nbsp;</label><label style="display:flex;align-items:center;gap:4px;font-size:12px;color:#374151;"><input type="checkbox" '+(f.automated_only?'checked':'')+' onchange="window.AUDIT_LOG.setFilter(\'automated_only\', this.checked)"> Automated only</label></div>'+
      '<div><label>&nbsp;</label><label style="display:flex;align-items:center;gap:4px;font-size:12px;color:#374151;"><input type="checkbox" '+(f.manual_only?'checked':'')+' onchange="window.AUDIT_LOG.setFilter(\'manual_only\', this.checked)"> Manual only</label></div>'+
      '<div style="grid-column:span 2;align-self:end;"><button class="aud-btn ghost" onclick="window.AUDIT_LOG.clearFilters()">Reset filters</button></div>'+
    '</div>';
  }

  function buildTabs(){
    var rows = all();
    var counts = {
      all: rows.length,
      session: rows.filter(function(r){ return r.session_id===SESSION_ID; }).length,
      rollback: rows.filter(function(r){ return r.rollback.is_rollback; }).length
    };
    function tab(key,label,count){
      return '<button class="aud-tab '+(UI.tab===key?'active':'')+'" onclick="window.AUDIT_LOG.setTab(\''+key+'\')">'+escH(label)+(count!=null?(' <span style="opacity:.6;font-weight:400;">('+count+')</span>'):'')+'</button>';
    }
    return ''+
    '<div class="aud-tabs">'+
      tab('all','All Historical',counts.all)+
      tab('session','Current Session',counts.session)+
      tab('grant','By Grant')+
      tab('admin','By Admin')+
      tab('rollback','Rollbacks',counts.rollback)+
      tab('export','Export')+
    '</div>';
  }

  function buildToolbar(rows){
    return ''+
    '<div class="aud-actions">'+
      '<button class="aud-btn" onclick="window.AUDIT_LOG.exportCsv()">Export CSV</button>'+
      '<button class="aud-btn" onclick="window.AUDIT_LOG.exportTsv()">Export TSV</button>'+
      '<button class="aud-btn" onclick="window.AUDIT_LOG.exportJson()">Export JSON</button>'+
      '<div style="flex:1;"></div>'+
      '<span class="aud-pager">'+rows.length+' entr'+(rows.length===1?'y':'ies')+'</span>'+
    '</div>';
  }

  function buildByGrantPicker(){
    var rows = all();
    var grants = uniq(rows.map(function(r){ return r.target.grant_id; }).filter(Boolean)).sort();
    var grantsHtml = grants.length
      ? '<select style="padding:6px 8px;font-size:12px;border:1px solid #d1d5db;border-radius:4px;" onchange="window.AUDIT_LOG.focusGrant(this.value)">'+
        '<option value="">— Select a grant —</option>'+
        grants.map(function(g){ return '<option value="'+escH(g)+'"'+(UI.grantFocus===g?' selected':'')+'>'+escH(g)+'</option>'; }).join('')+
        '</select>'
      : '<em style="color:#6b7280;">No grant-level entries recorded yet.</em>';
    return '<div class="aud-banner">Grant-level history: each entry below ties to a single grant_id. '+grantsHtml+'</div>';
  }
  function buildByAdminPicker(){
    var rows = all();
    var names = uniq(rows.map(function(r){ return r.actor.admin_name; }).filter(Boolean)).sort();
    var namesHtml = names.length
      ? '<select style="padding:6px 8px;font-size:12px;border:1px solid #d1d5db;border-radius:4px;" onchange="window.AUDIT_LOG.focusAdmin(this.value)">'+
        '<option value="">— Select an admin —</option>'+
        names.map(function(n){ return '<option value="'+escH(n)+'"'+(UI.adminFocus===n?' selected':'')+'>'+escH(n)+'</option>'; }).join('')+
        '</select>'
      : '<em style="color:#6b7280;">No admin entries recorded yet.</em>';
    return '<div class="aud-banner">Admin-level history: each entry below ties to a single actor. '+namesHtml+'</div>';
  }
  function buildExportPanel(rows){
    return ''+
    '<div class="aud-banner">Exports include every column in the persistent schema (audit_id, timestamp, actor, event, target, change, source, rollback). Current filtered set: <b>'+rows.length+'</b> entr'+(rows.length===1?'y':'ies')+'.</div>'+
    '<div class="aud-actions">'+
      '<button class="aud-btn primary" onclick="window.AUDIT_LOG.exportCsv()">Download CSV</button>'+
      '<button class="aud-btn" onclick="window.AUDIT_LOG.exportTsv()">Download TSV</button>'+
      '<button class="aud-btn" onclick="window.AUDIT_LOG.exportJson()">Download JSON</button>'+
    '</div>';
  }

  function render(){
    var host = document.getElementById('updatesActivityLog');
    if(!host) return;
    injectCss();

    var allRows = all();
    var rows = filteredRows();
    var sessionCount = currentSession().length;

    var subtitle = UI.tab === 'session'
      ? (sessionCount + ' event' + (sessionCount===1?'':'s') + ' recorded during the current session.')
      : 'Historical audit trail of update runs, grant-level changes, approvals, rejections, merges, and rollbacks across all sessions.';

    var preBody = '';
    if(UI.tab === 'grant')  preBody += buildByGrantPicker();
    if(UI.tab === 'admin')  preBody += buildByAdminPicker();
    if(UI.tab === 'export') preBody += buildExportPanel(rows);

    var tableHtml;
    if(!allRows.length){
      tableHtml = '<div class="aud-empty">No historical activity has been recorded yet. Future update runs, grant-level edits, approvals, rejections, merges, and rollbacks will appear here.</div>';
    } else if(!rows.length){
      tableHtml = '<div class="aud-empty">No entries match the current filters.</div>';
    } else {
      var pageSize = RENDER_PAGE;
      var pageCount = Math.max(1, Math.ceil(rows.length/pageSize));
      if(UI.page > pageCount) UI.page = pageCount;
      var start = (UI.page-1)*pageSize;
      var pageRows = rows.slice(start, start+pageSize);

      tableHtml = ''+
      '<div style="overflow-x:auto;">'+
      '<table class="aud-table">'+
        '<thead><tr>'+
          '<th>Date &amp; time (UTC)</th>'+
          '<th>Admin / Actor</th>'+
          '<th>Grant / Record</th>'+
          '<th>Update card / Package</th>'+
          '<th>Event</th>'+
          '<th>Field</th>'+
          '<th>Previous</th>'+
          '<th>Updated</th>'+
          '<th>Source</th>'+
          '<th></th>'+
        '</tr></thead>'+
        '<tbody>'+ pageRows.map(renderRow).join('') +'</tbody>'+
      '</table></div>';

      if(pageCount > 1){
        tableHtml += ''+
        '<div class="aud-actions" style="justify-content:center;margin-top:10px;">'+
          '<button class="aud-btn" '+(UI.page<=1?'disabled':'')+' onclick="window.AUDIT_LOG.setPage('+(UI.page-1)+')">‹ Prev</button>'+
          '<span class="aud-pager">Page '+UI.page+' of '+pageCount+'</span>'+
          '<button class="aud-btn" '+(UI.page>=pageCount?'disabled':'')+' onclick="window.AUDIT_LOG.setPage('+(UI.page+1)+')">Next ›</button>'+
        '</div>';
      }
    }

    host.innerHTML = ''+
    '<div class="aud-wrap"><div class="aud-section">'+
      '<div class="aud-h"><h2>Update Logs</h2>'+
        '<span class="aud-pill info">Persistent audit trail · '+allRows.length+' total</span>'+
        '<span class="aud-pill sys">Session '+escH(SESSION_ID)+'</span>'+
        '<span class="aud-pill" title="Current actor (multi-admin ready)">'+escH(CURRENT_ACTOR.admin_name)+'</span>'+
      '</div>'+
      '<div class="aud-sub">'+escH(subtitle)+'</div>'+
      buildTabs()+
      (UI.tab==='export' ? '' : buildFilterBar())+
      preBody+
      (UI.tab==='export' ? '' : buildToolbar(rows))+
      tableHtml+
    '</div></div>';
  }

  // ── Grant-level history modal ─────────────────────────────────────────────
  function showGrantHistory(grant_id){
    var rows = byGrant(grant_id).sort(function(a,b){ return (a.timestamp||'').localeCompare(b.timestamp||''); });
    var back = document.createElement('div');
    back.className = 'aud-modal-back';
    back.onclick = function(e){ if(e.target===back) document.body.removeChild(back); };
    var bodyHtml;
    if(!rows.length){
      bodyHtml = '<div class="aud-empty">No history yet for this grant.</div>';
    } else {
      bodyHtml = '<div style="overflow-x:auto;"><table class="aud-table">'+
        '<thead><tr><th>When</th><th>Actor</th><th>Event</th><th>Field</th><th>Previous → Updated</th><th>Source</th></tr></thead>'+
        '<tbody>'+ rows.map(function(r){
          return '<tr>'+
            '<td class="mono">'+escH(fmtTs(r.timestamp))+'</td>'+
            '<td>'+escH(r.actor.admin_name)+'</td>'+
            '<td>'+pillFor(r)+'</td>'+
            '<td>'+escH(r.target.affected_field||'—')+'</td>'+
            '<td class="mono">'+escH(r.change.previous_value==null?'—':String(r.change.previous_value).slice(0,120))+' → '+escH(r.change.new_value==null?'—':String(r.change.new_value).slice(0,120))+'</td>'+
            '<td>'+escH(r.source.source_type)+'</td>'+
          '</tr>';
        }).join('') +'</tbody></table></div>';
    }
    back.innerHTML = ''+
    '<div class="aud-modal">'+
      '<div class="aud-modal-h">'+
        '<div><div style="font-size:11px;text-transform:uppercase;color:#6b7280;letter-spacing:.05em;">Grant history</div>'+
        '<div style="font-size:16px;font-weight:600;color:#1a1a1a;font-family:ui-monospace,SF Mono,Consolas,monospace;">'+escH(grant_id)+'</div></div>'+
        '<button class="aud-btn ghost" onclick="this.closest(\'.aud-modal-back\').remove()">Close ✕</button>'+
      '</div>'+
      '<div class="aud-modal-b">'+bodyHtml+'</div>'+
    '</div>';
    document.body.appendChild(back);
  }

  // ── Public API ────────────────────────────────────────────────────────────
  window.AUDIT_LOG = {
    // Schema constants
    SCHEMA_VERSION: SCHEMA_VER,
    SESSION_ID: SESSION_ID,
    EVENT_TYPES: EVENT_TYPES,
    ACTOR_PRESETS: ACTOR_PRESETS,

    // Actor
    setCurrentActor: setCurrentActor,
    getCurrentActor: getCurrentActor,

    // Storage adapter (swappable interim → backend)
    storage: storage,

    // Write
    append: append,
    appendFromLegacy: appendFromLegacy,

    // Read
    all: all,
    query: query,
    byGrant: byGrant,
    byAdmin: byAdmin,
    rollbacks: rollbacks,
    currentSession: currentSession,

    // Export
    exportRows: exportRows,
    exportCsv:  function(){ exportRows(filteredRows(), 'csv'); },
    exportTsv:  function(){ exportRows(filteredRows(), 'tsv'); },
    exportJson: function(){ exportRows(filteredRows(), 'json'); },

    // UI
    render: render,
    scheduleRender: scheduleRender,
    setTab: function(t){ UI.tab=t; UI.page=1; render(); },
    setFilter: function(k,v){
      if(v===''||v===null||v===false){ delete UI.filters[k]; } else { UI.filters[k]=v; }
      UI.page = 1; render();
    },
    clearFilters: function(){ UI.filters={}; UI.page=1; render(); },
    setPage: function(p){ UI.page=p; render(); },
    toggleRow: function(id){ UI.expanded[id] = !UI.expanded[id]; render(); },
    focusGrant: function(id){ UI.grantFocus = id; UI.page=1; render(); },
    focusAdmin: function(name){ UI.adminFocus = name; UI.page=1; render(); },
    showGrantHistory: showGrantHistory,

    // Admin utility (kept defensive — append-only ethos)
    _dangerouslyClearAll: function(confirmToken){
      if(confirmToken !== 'I_UNDERSTAND_THIS_WIPES_THE_AUDIT_TRAIL') return false;
      storage.clear();
      render();
      return true;
    }
  };

  // ── Auto-render when host section becomes available ──────────────────────
  function tryRender(){
    if(document.getElementById('updatesActivityLog')) render();
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', tryRender);
  } else {
    tryRender();
  }

})();
