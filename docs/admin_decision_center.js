/* ============================================================================
   ATLAS · ADMIN REVIEW & DECISION CENTER  (Simplified Decision-Table Build)
   ----------------------------------------------------------------------------
   This module replaces the giant mixed-purpose master review table with FOCUSED
   decision tables grouped by the type of decision the admin needs to make:

     1. Admin Action Summary
     2. Jewish / Non-Jewish Classification Review
     3. Mixed / Partial Allocation Review
     4. Intermediary / DAF / CEF Review
     5. Duplicate / Double-Counting Review
     6. Policy Review / Edge Cases
     7. Queued / No Action Summary
     8. Logs (compact, collapsible)
     9. Admin Export Bundle
     + User / Admin Guide

   Data modules (second-pass classifications, NR queue, auto-resolved log,
   master issue seed, CEF metadata, learning seed) are PRESERVED.
   Top 500 Jewish recipients behavior is preserved (no changes here).
   ============================================================================ */
(function(){
"use strict";

// ── Shorthand ─────────────────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const esc = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;')
                  .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const fmt$ = n => { const v = Number(n)||0;
  if(v>=1e9) return '$'+(v/1e9).toFixed(2)+'B';
  if(v>=1e6) return '$'+(v/1e6).toFixed(2)+'M';
  if(v>=1e3) return '$'+(v/1e3).toFixed(1)+'K';
  return '$'+v.toLocaleString();
};
const fmtNum = n => (Number(n)||0).toLocaleString();
const nowIso = () => new Date().toISOString();

// ── Data globals (preserved) ─────────────────────────────────────────────────
const SP_META          = window.PHASE2_CEF_SECOND_PASS_META || {};
const SP_CLASS         = window.PHASE2_CEF_CLASSIFICATIONS_SECOND_PASS || [];
const SP_NR            = window.PHASE2_CEF_NEED_RESEARCH_SECOND_PASS || [];
const SP_UNRESOLVED    = window.PHASE2_CEF_UNRESOLVED_REVIEW_QUEUE_SECOND_PASS || [];
const SP_AUTO_LOG      = window.PHASE2_CEF_AUTO_RESOLVED_LOG_CONTINUOUS || [];
const SP_RESOLVED_LOG  = window.PHASE2_CEF_SECOND_PASS_RESOLVED_LOG || [];
const SP_ENRICH_EVI    = window.PHASE2_CEF_ENRICHMENT_EVIDENCE || [];
const SP_ISSUE_SEED    = window.PHASE2_CEF_MASTER_ISSUE_SEED || [];
const SP_LEARNING_SEED = window.PHASE2_CEF_LEARNING_RULES_SEED || {};
const SP_REPORT        = window.PHASE2_CEF_SECOND_PASS_REPORT || {};
const CEF_RECORDS      = (window.VERIFIED_COMMUNITY_ENTITIES&&window.VERIFIED_COMMUNITY_ENTITIES.records)||[];

// ── Jewish Linkage Override (JLO) globals (v1 2026-05-14) ────────────────────
// JLO is the overriding recipient-level classification engine for Phase 2 CEF
// grants. It supersedes the second_pass classification where a recipient has
// verified Jewish linkage. Scope: Phase 2 CEF grants only (9,339 rows).
const JLO_META         = window.JEWISH_LINKAGE_META || {};
const JLO_RECIPIENTS   = window.JEWISH_LINKAGE_RECIPIENTS || [];
const JLO_GRANTS       = window.JEWISH_LINKAGE_GRANTS || [];
const JLO_CLASS        = window.JEWISH_LINKAGE_CLASSIFICATIONS || [];
const JLO_REVIEW       = window.JEWISH_LINKAGE_REVIEW_QUEUE || [];
const JLO_AUTO_LOG     = window.JEWISH_LINKAGE_AUTO_LOG || [];
const JLO_TOP_CAND     = window.JEWISH_LINKAGE_TOP_CANDIDATES || [];
const JLO_VER_HISTORY  = window.JEWISH_LINKAGE_VERSION_HISTORY || {};
const JLO_ENGINE_VER   = (JLO_META && JLO_META.engine_version) || 'jewish_linkage_override_v1_20260514';
const JLO_APPLIED      = (JLO_META && JLO_META.applied_counts) || {};

// Full-Dashboard JLO v2 (2026-05-14) globals --------------------------------
// Covers Foundation + Federation + CEF (360,508 rows, 46,699 unique recipients).
// Full classifications and full auto-resolved log are NOT loaded into JS
// globals (would be ~230 MB + 324 k rows). Available as static CSV/JSON in
// fd_jlo_exports/. What IS loaded: meta, recipients, review queue (slimmed),
// mixed/partial queue, top candidates, version history.
const FDJ_META         = window.FD_JLO_META || {};
const FDJ_RECIPIENTS   = window.FD_JLO_RECIPIENTS || [];
const FDJ_REVIEW       = window.FD_JLO_REVIEW_QUEUE || [];
const FDJ_MIXED        = window.FD_JLO_MIXED_QUEUE || [];
const FDJ_TOP_CAND     = window.FD_JLO_TOP_CANDIDATES || [];
const FDJ_VER_HISTORY  = window.FD_JLO_VERSION_HISTORY || {};
const FDJ_APPLIED      = (FDJ_META && FDJ_META.applied_counts) || {};
const FDJ_LAYERS       = (FDJ_META && FDJ_META.layer_counts)   || {};
const FDJ_SUMMARY      = (FDJ_META && FDJ_META.summary)        || {};
const FDJ_STATIC_EXPORTS = (FDJ_META && FDJ_META.static_export_files) || [];
const FDJ_REVIEW_BREAKDOWN = (FDJ_META && FDJ_META.review_queue_breakdown) || {};
const FDJ_ENGINE_VER   = (FDJ_META && FDJ_META.engine_version) || '2.0.0-full-dashboard';
const HAS_FD_JLO       = !!(FDJ_META && FDJ_META.engine_version);
const EFFECTIVE_ENGINE_VER = HAS_FD_JLO ? FDJ_ENGINE_VER : JLO_ENGINE_VER;

// Fast lookups (legacy CEF JLO)
const JLO_CLASS_BY_GID = new Map();
JLO_CLASS.forEach(r => { if(r.grant_id) JLO_CLASS_BY_GID.set(String(r.grant_id), r); });
const JLO_REVIEW_BY_GID = new Map();
JLO_REVIEW.forEach(r => { if(r.grant_id) JLO_REVIEW_BY_GID.set(String(r.grant_id), r); });

// Fast lookups (Full-Dashboard JLO v2)
const FDJ_REVIEW_BY_GID = new Map();
FDJ_REVIEW.forEach(r => {
  const gid = r.grant_id || r.row_id;
  if(gid) FDJ_REVIEW_BY_GID.set(String(gid), r);
});

window.JEWISH_LINKAGE_DATA = {
  meta: JLO_META,
  recipients: JLO_RECIPIENTS,
  grants: JLO_GRANTS,
  classifications: JLO_CLASS,
  review_queue: JLO_REVIEW,
  auto_log: JLO_AUTO_LOG,
  top_candidates: JLO_TOP_CAND,
  version_history: JLO_VER_HISTORY,
  applied_counts: JLO_APPLIED,
  engine_version: JLO_ENGINE_VER
};

// Full-Dashboard JLO v2 — canonical dashboard-wide classification dataset.
// Heavy arrays (classifications, grants, auto-resolved log) are intentionally
// NOT shipped to globals; they are available via static CSV files in
// fd_jlo_exports/ and the Admin Export Bundle.
window.FULL_DASHBOARD_JLO_DATA = {
  meta: FDJ_META,
  recipients: FDJ_RECIPIENTS,          // 46,699
  review_queue: FDJ_REVIEW,            // ~39,891 (slim fields)
  mixed_queue: FDJ_MIXED,              // 71
  top_candidates: FDJ_TOP_CAND,        // 14,074 (Admin-only; canonical Top-400 stays locked)
  version_history: FDJ_VER_HISTORY,
  applied_counts: FDJ_APPLIED,
  layer_counts: FDJ_LAYERS,            // foundation / federation / CEF row & classification counts
  summary: FDJ_SUMMARY,
  review_queue_breakdown: FDJ_REVIEW_BREAKDOWN,
  static_export_files: FDJ_STATIC_EXPORTS,
  engine_version: FDJ_ENGINE_VER,
  scope: 'foundation + federation + community_endowment_fund',
  // Lazy concatenation helpers — produced from chunked window globals
  getRecipients: () => window.FD_JLO_RECIPIENTS || [],
  getReviewQueue: () => window.FD_JLO_REVIEW_QUEUE || [],
  getMixedQueue: () => window.FD_JLO_MIXED_QUEUE || [],
  getTopCandidates: () => window.FD_JLO_TOP_CANDIDATES || []
};

window.SECOND_PASS_DATA = {
  meta:SP_META, classifications:SP_CLASS, need_research:SP_NR,
  unresolved:SP_UNRESOLVED, auto_log:SP_AUTO_LOG, resolved_log:SP_RESOLVED_LOG,
  enrichment_evidence:SP_ENRICH_EVI, master_issue:SP_ISSUE_SEED,
  learning_seed:SP_LEARNING_SEED, report:SP_REPORT
};

// ── In-session admin state ────────────────────────────────────────────────────
const ADMIN_STATE = window.ADMIN_DECISION_CENTER_STATE = {
  decisions: new Map(),        // grant_id -> decision record
  issue_decisions: new Map(),  // issue_id -> decision record
  audit_trail: [],
  learning_events: [],
  pattern_library: Array.isArray(SP_LEARNING_SEED.pattern_library)
    ? JSON.parse(JSON.stringify(SP_LEARNING_SEED.pattern_library)) : [],
  classification_rules: Array.isArray(SP_LEARNING_SEED.classification_rules)
    ? JSON.parse(JSON.stringify(SP_LEARNING_SEED.classification_rules)) : [],
  version_history: Array.isArray(SP_LEARNING_SEED.version_history)
    ? JSON.parse(JSON.stringify(SP_LEARNING_SEED.version_history)) : [],
  autonomous_mode: false,
  pending_reclassification_count: 0,
  notifications: [],
  notification_seen: new Set(),
  notification_resolved: new Set(),
  dashboard_version: SP_META.dashboard_version || 'simplified-decision-tables-v1',
  session_id: 'SES-'+Date.now(),
  new_learning_rules_session: 0,
  last_review_timestamp: nowIso()
};

// ── Focused decision option catalogs (per spec — minimal per table) ──────────
const CLASSIFICATION_OPTIONS = [
  {value:'',                       label:'— Select decision —'},
  {value:'classify_jewish',        label:'Jewish / Jewish-Aligned'},
  {value:'classify_nonjewish',     label:'Non-Jewish'},
  {value:'classify_unclear',       label:'Unclear — Needs More Research'},
  {value:'send_policy_review',     label:'Send to Policy Review'}
];
const ALLOCATION_OPTIONS = [
  {value:'',                       label:'— Select decision —'},
  {value:'count_full_jewish',      label:'Count Full Amount as Jewish-Aligned'},
  {value:'count_partial',          label:'Count Partial Amount / Percentage'},
  {value:'exclude_jewish_calc',    label:'Exclude from Jewish Calculation'},
  {value:'mark_unclear',           label:'Unclear — Needs More Research'}
];
const INTERMEDIARY_OPTIONS = [
  {value:'',                       label:'— Select decision —'},
  {value:'count_final_jewish',     label:'Count as Final Jewish Recipient'},
  {value:'treat_passthrough',      label:'Treat as Intermediary / Pass-Through'},
  {value:'verified_jewish_only',   label:'Count Verified Jewish Allocation Only'},
  {value:'mark_unclear',           label:'Unclear — Needs More Research'}
];
const DUPLICATE_OPTIONS = [
  {value:'',                       label:'— Select decision —'},
  {value:'merge_records',          label:'Merge / Standardize Recipient'},
  {value:'keep_separate',          label:'Keep Separate'},
  {value:'exclude_passthrough',    label:'Exclude Pass-Through Layer'},
  {value:'mark_unclear',           label:'Unclear — Needs More Research'}
];
const POLICY_OPTIONS = [
  {value:'',                       label:'— Select decision —'},
  {value:'include_jewish',         label:'Include Under Jewish-Aligned Giving'},
  {value:'exclude_jewish',         label:'Exclude from Jewish-Aligned Giving'},
  {value:'case_by_case',           label:'Case-by-Case Review Required'}
];

// Master mapping decision -> canonical classification (for metric recomputation)
const DECISION_TO_CLASSIFICATION = {
  classify_jewish:'Jewish',
  classify_nonjewish:'Non-Jewish',
  classify_unclear:'Need Research',
  send_policy_review:'Policy Review',
  count_full_jewish:'Jewish',
  count_partial:'Mixed',
  exclude_jewish_calc:'Excluded',
  mark_unclear:'Need Research',
  count_final_jewish:'Jewish',
  treat_passthrough:'Excluded',
  verified_jewish_only:'Verified Jewish Only',
  merge_records:'Duplicate',
  keep_separate:'Need Research',
  exclude_passthrough:'Excluded',
  include_jewish:'Jewish',
  exclude_jewish:'Non-Jewish',
  case_by_case:'Policy Review'
};

const ALL_OPTIONS_LOOKUP = {};
[CLASSIFICATION_OPTIONS, ALLOCATION_OPTIONS, INTERMEDIARY_OPTIONS,
 DUPLICATE_OPTIONS, POLICY_OPTIONS].forEach(arr => arr.forEach(o => {
   if(o.value) ALL_OPTIONS_LOOKUP[o.value] = o.label;
 }));

// ── Index helpers ─────────────────────────────────────────────────────────────
const CLASS_BY_ID = new Map();
SP_CLASS.forEach(r => { if(r.grant_id) CLASS_BY_ID.set(r.grant_id, r); });
window.SECOND_PASS_DATA.class_by_id = CLASS_BY_ID;

const NR_BY_ID = new Map();
SP_NR.forEach(r => { if(r.grant_id) NR_BY_ID.set(r.grant_id, r); });

function recomputeMetrics(){
  let j=0, nj=0, nr=0, mixed=0, exc=0;
  for(const r of SP_CLASS){
    const gid = r.grant_id;
    const override = ADMIN_STATE.decisions.get(gid);
    const cls = override && override.new_classification ? override.new_classification
              : (r.updated_classification || r.second_pass_classification || r.first_pass_classification || r.original_classification);
    if(cls==='Jewish' || cls==='Verified Jewish Only') j++;
    else if(cls==='Non-Jewish') nj++;
    else if(cls==='Mixed') mixed++;
    else if(cls==='Excluded') exc++;
    else nr++;
  }
  return {Jewish:j, NonJewish:nj, NeedResearch:nr, Mixed:mixed, Excluded:exc, Total:SP_CLASS.length};
}
window.recomputeSecondPassMetrics = recomputeMetrics;

// ── Audit / learning helpers ─────────────────────────────────────────────────
function pushAudit(kind, payload){
  ADMIN_STATE.audit_trail.push({
    audit_id:'AUD-'+(ADMIN_STATE.audit_trail.length+1).toString().padStart(6,'0'),
    timestamp:nowIso(), session_id:ADMIN_STATE.session_id, kind, ...payload
  });
}
function pushLearningEvent(kind, payload){
  const ev = {
    event_id:'LRN-'+(ADMIN_STATE.learning_events.length+1).toString().padStart(6,'0'),
    timestamp:nowIso(), session_id:ADMIN_STATE.session_id, kind,
    engine_version:'admin-session-v1', autonomous:false, admin_approved:true, ...payload
  };
  ADMIN_STATE.learning_events.push(ev);
  if(kind==='save_and_learn' && payload.pattern){
    ADMIN_STATE.pattern_library.push(payload.pattern);
    ADMIN_STATE.new_learning_rules_session++;
  }
  ADMIN_STATE.pending_reclassification_count++;
  if(ADMIN_STATE.pending_reclassification_count>=25) maybeShowReclassifyBanner();
}
function maybeShowReclassifyBanner(){
  const host = $('learningReclassifyBanner'); if(!host) return;
  host.style.display='block';
  host.innerHTML = `
    <strong>New data and decision patterns are available.</strong>
    Do you want to run another classification pass and update the dashboard?
    <div style="margin-top:8px;display:flex;gap:8px;">
      <button class="adc-btn primary" onclick="window.adminDecisionCenter.approveReclassify()">Approve &amp; run another pass</button>
      <button class="adc-btn" onclick="window.adminDecisionCenter.dismissReclassify()">Dismiss for now</button>
    </div>
    <div style="font-size:0.66rem;color:var(--text-muted);margin-top:6px;">Major engine updates remain admin-approval-only — no autonomous changes.</div>`;
}

// ── Notifications (preserved, lightly trimmed) ────────────────────────────────
function pushNotification(n){
  const id = 'N-'+(ADMIN_STATE.notifications.length+1).toString().padStart(5,'0');
  const full = {
    notification_id:id, timestamp:nowIso(), severity:'info',
    status:'open', viewed:false, resolved:false, linked_records:[], ...n
  };
  ADMIN_STATE.notifications.unshift(full);
  return id;
}
function seedNotifications(){
  if(ADMIN_STATE.notifications.length>0) return;
  pushNotification({severity:'info', section:'Second-pass review',
    alert_type:'review_status', title:'Second-pass review complete',
    summary:`4,714 auto-resolved (1,710 Jewish, 3,004 Non-Jewish). ${SP_NR.length} rows remain awaiting decisions.`,
    action_required:'Open the relevant focused decision tables.'});
  pushNotification({severity:'warning', section:'Money flow · Double-counting',
    alert_type:'risk', title:'Possible double-counting chains',
    summary:'Foundation → Federation → CEF chains may inflate totals. Review the Duplicate / Double-Counting table.',
    action_required:'Triage in Duplicate / Double-Counting Review.'});
  pushNotification({severity:'info', section:'Auto-resolved log',
    alert_type:'engine_update', title:'Auto-resolved log updated (JLO continuous)',
    summary:`${((JLO_AUTO_LOG&&JLO_AUTO_LOG.length)||SP_AUTO_LOG.length).toLocaleString()} cumulative auto-resolutions recorded (first + second + JLO passes).`,
    action_required:'View in Logs section.'});
  if(JLO_REVIEW && JLO_REVIEW.length){
    pushNotification({severity:'high', section:'Jewish / Non-Jewish Classification Review',
      alert_type:'engine_update', title:'Jewish Linkage Override (JLO) routed cases',
      summary:`${JLO_REVIEW.length.toLocaleString()} JLO unresolved cases routed to the Jewish / Non-Jewish (and Mixed / Partial) review panels. Includes ${(JLO_META.false_positive_corrections&&JLO_META.false_positive_corrections.count)||1158} corrected false positives from the prior "ou" substring bug.`,
      action_required:'Open the Jewish / Non-Jewish Classification Review panel.'});
  }
  pushNotification({severity:'info', section:'IRS / ProPublica enrichment',
    alert_type:'enrichment_update', title:'EIN enrichment summary',
    summary:`${SP_REPORT.unique_eins_submitted||4855} EINs submitted; ${SP_REPORT.propublica_lookup_success||4700} succeeded; ${SP_REPORT.propublica_lookup_429||119} rate-limited; ${SP_REPORT.propublica_lookup_404||45} 404s; ${SP_REPORT.propublica_no_ein||18} no-EIN.`,
    action_required:'Schedule rerun for rate-limited EINs in next pass.'});
}
seedNotifications();

// ── CSS ──────────────────────────────────────────────────────────────────────
(function injectCss(){
  if(document.getElementById('adc-styles')) return;
  const css = `
  .adc-panel{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:20px;margin-bottom:24px;}
  .adc-panel h2{font-size:1.05rem;font-weight:800;color:var(--text);margin-bottom:6px;letter-spacing:0.01em;}
  .adc-panel .adc-sub{font-size:0.78rem;color:var(--text-muted);margin-bottom:14px;line-height:1.55;}
  .adc-toolbar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:14px;}
  .adc-toolbar input,.adc-toolbar select{background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:6px 10px;font-size:0.78rem;outline:none;}
  .adc-toolbar input:focus,.adc-toolbar select:focus{border-color:var(--accent);}
  .adc-toolbar label{font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em;}
  .adc-btn{background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:6px 12px;font-size:0.78rem;cursor:pointer;transition:all 0.15s;font-family:inherit;}
  .adc-btn:hover{border-color:var(--accent);color:var(--accent);}
  .adc-btn.primary{background:var(--accent);border-color:var(--accent);color:#fff;}
  .adc-btn.primary:hover{background:#5358d8;}
  .adc-btn.warn{background:rgba(245,158,11,0.14);border-color:rgba(245,158,11,0.42);color:#fcd34d;}
  .adc-btn.danger{background:rgba(248,113,113,0.14);border-color:rgba(248,113,113,0.42);color:#fca5a5;}
  .adc-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin-bottom:16px;}
  .adc-stat{background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:12px;display:flex;flex-direction:column;gap:4px;}
  .adc-stat .lbl{font-size:0.62rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;}
  .adc-stat .val{font-size:1.2rem;font-weight:850;font-variant-numeric:tabular-nums;color:var(--text);}
  .adc-stat .sub{font-size:0.68rem;color:var(--text-muted);}
  .adc-table-wrap{overflow-x:auto;max-height:680px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;}
  .adc-table{width:100%;border-collapse:collapse;font-size:0.74rem;}
  .adc-table thead th{position:sticky;top:0;background:#15182b;color:var(--text-muted);font-size:0.62rem;text-transform:uppercase;letter-spacing:0.05em;padding:9px 10px;text-align:left;border-bottom:1px solid var(--border);white-space:nowrap;z-index:2;}
  .adc-table tbody td{padding:8px 10px;border-bottom:1px solid var(--border);color:var(--text);vertical-align:top;}
  .adc-table tbody tr:hover{background:var(--surface2);}
  .adc-table .num{font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap;}
  .adc-table select,.adc-table input,.adc-table textarea{background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:5px;padding:4px 6px;font-size:0.72rem;width:100%;min-width:130px;outline:none;font-family:inherit;}
  .adc-table textarea{resize:vertical;min-height:30px;}
  .adc-pager{display:flex;gap:8px;align-items:center;justify-content:center;margin-top:12px;flex-wrap:wrap;font-size:0.74rem;color:var(--text-muted);}
  .adc-badge{display:inline-block;padding:2px 7px;border-radius:999px;font-size:0.6rem;font-weight:800;letter-spacing:0.04em;text-transform:uppercase;border:1px solid;}
  .adc-badge.jewish{color:#c7d2fe;background:rgba(99,102,241,0.18);border-color:rgba(129,140,248,0.45);}
  .adc-badge.nonjewish{color:#bbf7d0;background:rgba(16,185,129,0.18);border-color:rgba(45,212,191,0.42);}
  .adc-badge.nr{color:#fde68a;background:rgba(245,158,11,0.16);border-color:rgba(245,158,11,0.4);}
  .adc-badge.mixed{color:#fbcfe8;background:rgba(236,72,153,0.16);border-color:rgba(236,72,153,0.42);}
  .adc-badge.excluded{color:#cbd5e1;background:rgba(148,163,184,0.18);border-color:rgba(148,163,184,0.42);}
  .adc-badge.high{color:#bbf7d0;background:rgba(16,185,129,0.18);border-color:rgba(45,212,191,0.42);}
  .adc-badge.medium{color:#fde68a;background:rgba(245,158,11,0.16);border-color:rgba(245,158,11,0.4);}
  .adc-badge.low{color:#fca5a5;background:rgba(248,113,113,0.16);border-color:rgba(248,113,113,0.4);}
  .adc-badge.critical{color:#fecaca;background:rgba(248,113,113,0.22);border-color:rgba(248,113,113,0.5);}
  .adc-badge.warning{color:#fde68a;background:rgba(245,158,11,0.16);border-color:rgba(245,158,11,0.4);}
  .adc-badge.info{color:#a5b4fc;background:rgba(99,102,241,0.14);border-color:rgba(129,140,248,0.36);}
  .adc-status-pill{font-size:0.62rem;color:var(--text-muted);font-weight:700;}
  .adc-status-pill.saved{color:#a7f3d0;}
  .adc-status-pill.learned{color:#c7d2fe;}
  .adc-status-pill.pending{color:#fcd34d;}
  /* Summary cards */
  .adc-summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:8px;}
  .adc-summary-card{background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:14px;display:flex;flex-direction:column;gap:6px;cursor:default;}
  .adc-summary-card .sc-title{font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;font-weight:700;}
  .adc-summary-card .sc-count{font-size:1.7rem;font-weight:850;font-variant-numeric:tabular-nums;color:var(--text);line-height:1;}
  .adc-summary-card .sc-prio{display:inline-flex;align-items:center;gap:5px;font-size:0.65rem;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;}
  .adc-summary-card .sc-prio .pdot{width:8px;height:8px;border-radius:999px;background:#94a3b8;}
  .adc-summary-card.prio-high{border-color:rgba(248,113,113,0.45);}
  .adc-summary-card.prio-high .pdot{background:#f87171;}
  .adc-summary-card.prio-high .sc-prio{color:#fca5a5;}
  .adc-summary-card.prio-med{border-color:rgba(245,158,11,0.4);}
  .adc-summary-card.prio-med .pdot{background:#fbbf24;}
  .adc-summary-card.prio-med .sc-prio{color:#fcd34d;}
  .adc-summary-card.prio-low .pdot{background:#94a3b8;}
  .adc-summary-card.prio-low .sc-prio{color:#cbd5e1;}
  .adc-summary-card.prio-info{border-color:rgba(129,140,248,0.35);}
  .adc-summary-card.prio-info .pdot{background:#818cf8;}
  .adc-summary-card.prio-info .sc-prio{color:#a5b4fc;}
  .adc-summary-card button.adc-btn{align-self:flex-start;margin-top:4px;}
  /* Queued / no-action */
  .adc-queued-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;}
  .adc-queued-card{background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:12px;}
  .adc-queued-card .qt{font-size:0.85rem;font-weight:700;color:var(--text);}
  .adc-queued-card .qm{font-size:0.7rem;color:var(--text-muted);margin-top:4px;}
  .adc-queued-card .qcount{font-size:1.2rem;font-weight:850;font-variant-numeric:tabular-nums;color:var(--text);margin-top:6px;}
  .adc-queued-card .qaction{margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;}
  .adc-queued-card.no-action{border-color:rgba(45,212,191,0.4);}
  .adc-queued-card.no-action .qm{color:#a7f3d0;}
  /* Save & Learn explainer */
  .adc-explainer{background:linear-gradient(180deg,rgba(99,102,241,0.10),rgba(99,102,241,0.04));border:1px solid rgba(129,140,248,0.3);border-radius:10px;padding:12px 14px;margin-bottom:14px;font-size:0.78rem;color:var(--text);line-height:1.55;}
  .adc-explainer strong{color:#c7d2fe;}
  .adc-explainer .row{display:flex;gap:14px;flex-wrap:wrap;margin-top:6px;}
  .adc-explainer .row > div{flex:1 1 240px;}
  /* Logs compact */
  .adc-log-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:10px;}
  details.adc-details{background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-top:8px;}
  details.adc-details summary{cursor:pointer;font-size:0.78rem;color:#a5b4fc;font-weight:700;}
  details.adc-details[open]{padding-bottom:14px;}
  details.adc-details .body{margin-top:8px;font-size:0.74rem;color:var(--text);line-height:1.5;}
  /* Guide */
  .adc-guide-toc{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin-bottom:16px;}
  .adc-guide-toc a{color:#a5b4fc;text-decoration:none;font-size:0.78rem;border:1px solid var(--border);background:var(--surface2);border-radius:8px;padding:9px 11px;display:block;transition:all 0.15s;}
  .adc-guide-toc a:hover{border-color:var(--accent);color:#fff;}
  .adc-guide-section{margin-top:20px;padding-top:16px;border-top:1px solid var(--border);}
  .adc-guide-section h3{font-size:0.95rem;font-weight:800;color:var(--text);margin-bottom:8px;}
  .adc-guide-section h4{font-size:0.78rem;font-weight:700;color:#a5b4fc;text-transform:uppercase;letter-spacing:0.04em;margin:10px 0 4px;}
  .adc-guide-section p, .adc-guide-section li{font-size:0.8rem;color:var(--text);line-height:1.55;}
  .adc-guide-section ul, .adc-guide-section ol{padding-left:22px;margin:4px 0 8px;}
  /* Notifications (compact) */
  .adc-notif{display:grid;grid-template-columns:24px 1fr auto;gap:10px;align-items:flex-start;padding:11px 12px;border:1px solid var(--border);border-radius:8px;background:var(--surface2);margin-bottom:8px;}
  .adc-notif.unread{border-color:rgba(245,158,11,0.45);background:rgba(245,158,11,0.06);}
  .adc-notif.critical{border-color:rgba(248,113,113,0.5);background:rgba(248,113,113,0.08);}
  .adc-notif .dot{width:10px;height:10px;border-radius:999px;margin-top:5px;background:#64748b;}
  .adc-notif.critical .dot{background:#f87171;}
  .adc-notif.warning .dot{background:#fbbf24;}
  .adc-notif.info .dot{background:#818cf8;}
  .adc-notif .ttl{font-size:0.85rem;font-weight:800;color:var(--text);margin-bottom:3px;}
  .adc-notif .smry{font-size:0.74rem;color:var(--text-muted);line-height:1.45;}
  .adc-notif .meta{font-size:0.66rem;color:var(--text-faint);margin-top:5px;}
  .adc-notif .acts{display:flex;flex-direction:column;gap:5px;}
  .adc-cef-mini{margin-top:8px;font-size:0.72rem;color:var(--text-muted);line-height:1.5;}
  `;
  const s = document.createElement('style');
  s.id = 'adc-styles'; s.textContent = css;
  document.head.appendChild(s);
})();

// ── Pagination helper ────────────────────────────────────────────────────────
function paginate(rows, page, perPage){
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total/perPage));
  const p = Math.min(Math.max(1,page), pages);
  return {rows:rows.slice((p-1)*perPage, p*perPage), page:p, pages, total};
}
function renderPager(pageObj){
  const {page,pages,total} = pageObj;
  let html = `<span>Page ${page} of ${pages} · ${total.toLocaleString()} rows</span>`;
  const btn = (lbl,p,dis)=>`<button class="adc-btn" ${dis?'disabled':''} data-page="${p}">${lbl}</button>`;
  html += btn('«',1,page===1)+btn('‹',page-1,page===1)+btn('›',page+1,page===pages)+btn('»',pages,page===pages);
  return `<div class="adc-pager" data-pager>${html}</div>`;
}
function wirePager(host, onChange){
  if(!host) return;
  host.querySelectorAll('[data-pager] button').forEach(b => {
    b.addEventListener('click', () => onChange(parseInt(b.dataset.page,10)));
  });
}

// ╔════════════════════════════════════════════════════════════════════════════╗
// ║ ROW ROUTING — decide which focused decision table a given row belongs to.  ║
// ╚════════════════════════════════════════════════════════════════════════════╝
//
// Routing key per NR row. Each NR row routes to EXACTLY ONE focused table.
// Master Issue rows are partly aliased to the same grant_id rows; we use them
// for context (priority, description) but the canonical decision row is the
// NR record. CEF metadata double-counting rows route to Duplicate.

const POLICY_HINT_WORDS = /\b(temple|interfaith|israel|university|hospital|hillel|chabad|jewish studies|antisemit|human rights|civic|mixed identity)\b/i;
const DUP_HINT_WORDS    = /\b(duplicate|dup|same ein|merge|parent[- ]child|variant|alias|same name)\b/i;
const ALLOC_HINT_WORDS  = /\b(mixed|partial|interfaith|portion|allocate|allocation|earmark|restricted)\b/i;
const INT_HINT_WORDS    = /\b(daf|donor[- ]advised|community foundation|federation|endowment|fund|pass[- ]through|intermediary|jcf|jewish communal fund|schwab|fidelity|vanguard)\b/i;

function rowDecisionTable(r){
  // Categories from the second-pass NR queue
  const cat = String(r.review_category||r.issue_category||'').toLowerCase();
  const typ = String(r.issue_type||r.review_method||'').toLowerCase();
  const reason = String(r.review_reason||r.description||'').toLowerCase();
  const name = String(r.recipient_name||r.entity_name||'').toLowerCase();
  const evidence = String(r.review_evidence||'').toLowerCase();
  const blob = `${cat} ${typ} ${reason} ${name} ${evidence}`;

  // 1) Explicit category mapping (strongest signal)
  if(cat==='ambiguous_intermediary' || cat==='daf/community foundation/pass-through' ||
     typ==='intermediary_passthrough') return 'intermediary';
  if(cat==='interfaith_mixed' || cat==='interfaith/mixed-purpose' ||
     typ==='interfaith_or_mixed_purpose') return 'allocation';
  if(cat==='temple_ambiguous' || cat==='temple ambiguity' ||
     typ==='temple_disambiguation') return 'policy';
  if(cat==='duplicate' || cat==='double_counting_cef' || typ==='duplicate_recipient' ||
     /double[- ]?counting|federation parent|passthrough_layer/i.test(typ+cat)) return 'duplicate';

  // 2) Keyword routing (only when category didn't decide)
  if(DUP_HINT_WORDS.test(blob)) return 'duplicate';
  if(INT_HINT_WORDS.test(blob)) return 'intermediary';
  if(ALLOC_HINT_WORDS.test(blob)) return 'allocation';
  if(POLICY_HINT_WORDS.test(blob)) return 'policy';

  // 3) Default — Jewish / Non-Jewish classification decision
  return 'classification';
}

// Build per-table row sets
function buildRoutedRows(){
  const tables = {classification:[], allocation:[], intermediary:[], duplicate:[], policy:[]};
  // Index master issues by grant_id for context fields
  const issueByGrant = new Map();
  SP_ISSUE_SEED.forEach(it => { if(it.grant_id) issueByGrant.set(it.grant_id, it); });

  SP_NR.forEach(r => {
    const route = rowDecisionTable(r);
    const iss = r.grant_id ? issueByGrant.get(r.grant_id) : null;
    const merged = Object.assign({}, r, iss ? {
      issue_id: iss.issue_id,
      issue_priority: iss.priority,
      issue_description: iss.description,
      recommended_resolution: iss.recommended_resolution
    } : {});
    tables[route].push(merged);
  });

  // ── JLO unresolved review queue → existing focused tables ────────────────
  // 2,883 JLO unresolved grants. 2,812 with status 'Unclear — Needs Review'
  // go to classification; 71 with 'Mixed / Partial Jewish Allocation' go to
  // allocation. No new panel is created. Each row is merged with the existing
  // routed row when one is already present (same grant_id) so the admin sees
  // the JLO review_reason/evidence/sources fields without duplicating rows.
  const existingByGid = new Map();
  ['classification','allocation','intermediary','duplicate','policy'].forEach(t => {
     tables[t].forEach(r => { if(r.grant_id) existingByGid.set(String(r.grant_id), {table:t,row:r}); });
  });
  // If Full-Dashboard JLO is loaded, it supersedes the CEF-only JLO review queue
  // for the duration of routing. Otherwise fall back to the legacy CEF JLO_REVIEW.
  const _USE_FD = HAS_FD_JLO && FDJ_REVIEW.length > 0;
  const reviewSource = _USE_FD ? FDJ_REVIEW : JLO_REVIEW;
  reviewSource.forEach(r => {
    const isMixed = String(r.jlo_classification_attempt||r.recipient_jewish_linkage_status||r.final_grant_classification||'').toLowerCase().includes('mixed') ||
                    String(r.final_grant_classification||'').toLowerCase().includes('partial');
    const targetTable = isMixed ? 'allocation' : 'classification';
    // Build the standardized routed row. The FD review queue uses slightly
    // different field names (row_id rather than grant_id; entity_source_layer;
    // recipient_jewish_linkage_evidence as a string). Normalize here.
    const gidVal = r.grant_id || r.row_id;
    const jloFields = {
      grant_id: gidVal,
      row_id: r.row_id || gidVal,
      entity_source_layer: r.entity_source_layer,
      tax_year: r.tax_year,
      source_entity: r.source_entity,
      source_ein: r.source_ein,
      recipient_name: r.recipient_name,
      recipient_ein: r.recipient_ein,
      recipient_state: r.recipient_state,
      grant_amount: r.grant_amount,
      grant_purpose: r.grant_purpose,
      subject_category: r.subject_category,
      orig_jl_flag: r.orig_jl_flag,
      // Engine suggestion / why-flagged surfaces for the classification panel
      second_pass_classification: r.jlo_classification_attempt || r.final_grant_classification,
      first_pass_classification: r.previous_updated_classification,
      original_classification: r.original_classification || r.orig_jl_flag,
      review_confidence: (Number(r.recipient_jewish_linkage_confidence)||0) >= 70 ? 'high'
                        : (Number(r.recipient_jewish_linkage_confidence)||0) >= 45 ? 'medium' : 'low',
      review_reason: r.review_reason,
      review_evidence: Array.isArray(r.evidence) ? r.evidence.join(' · ') : (r.evidence || r.recipient_jewish_linkage_evidence || ''),
      review_source: Array.isArray(r.sources) ? r.sources[0] : (r.sources||r.pp_url||r.classification_source||''),
      pp_url: r.pp_url,
      // JLO-specific fields (preserved for export / detail panels)
      recipient_jewish_linkage_status: r.recipient_jewish_linkage_status,
      recipient_jewish_linkage_confidence: r.recipient_jewish_linkage_confidence,
      recipient_jewish_linkage_evidence: r.evidence || r.recipient_jewish_linkage_evidence,
      recipient_jewish_linkage_sources: r.sources,
      classification_reason: r.classification_reason || r.review_reason,
      final_grant_classification: r.final_grant_classification || r.jlo_classification_attempt,
      auto_resolved_yes_no: r.auto_resolved_yes_no || 'No',
      needs_admin_review_yes_no: r.needs_admin_review_yes_no || 'Yes',
      engine_version: r.engine_version || EFFECTIVE_ENGINE_VER,
      jlo_recommended_action: r.recommended_action,
      jlo_decision_options: r.decision_options,
      jlo_review: true,
      jlo_scope: _USE_FD ? 'full_dashboard' : 'cef_phase2'
    };
    const gid = gidVal ? String(gidVal) : null;
    const existing = gid ? existingByGid.get(gid) : null;
    if(existing){
      // Merge JLO fields into existing routed row (do not duplicate). If the
      // existing row sits in a different table than the JLO routing target,
      // re-route it to the JLO target (JLO overrides second-pass routing).
      Object.assign(existing.row, jloFields);
      if(existing.table !== targetTable){
        const idx = tables[existing.table].indexOf(existing.row);
        if(idx>=0) tables[existing.table].splice(idx,1);
        tables[targetTable].push(existing.row);
        existingByGid.set(gid, {table:targetTable, row:existing.row});
      }
    } else {
      tables[targetTable].push(jloFields);
      if(gid) existingByGid.set(gid, {table:targetTable, row:jloFields});
    }
  });

  // Full-Dashboard JLO Mixed / Partial queue (71 rows) -> Allocation panel.
  // These are recipient-level rows where the recipient is partly Jewish, partly
  // not. They route to the existing Mixed / Partial Allocation Review panel.
  if(HAS_FD_JLO){
    FDJ_MIXED.forEach(r => {
      const gidVal = r.grant_id || r.row_id;
      const gid = gidVal ? String(gidVal) : null;
      if(gid && existingByGid.has(gid)){
        // Already handled via review-queue routing above; nothing to do.
        return;
      }
      const row = {
        grant_id: gidVal,
        row_id: r.row_id || gidVal,
        entity_source_layer: r.entity_source_layer,
        tax_year: r.tax_year,
        source_entity: r.source_entity,
        source_ein: r.source_ein,
        recipient_name: r.recipient_name,
        recipient_ein: r.recipient_ein,
        recipient_state: r.recipient_state,
        grant_amount: r.grant_amount,
        grant_purpose: r.grant_purpose,
        subject_category: r.subject_category,
        orig_jl_flag: r.orig_jl_flag,
        original_classification: r.orig_jl_flag,
        review_category: 'interfaith_mixed',
        review_reason: r.review_reason || 'Mixed / partial Jewish linkage at recipient.',
        review_evidence: r.recipient_jewish_linkage_evidence || '',
        review_source: r.classification_source || '',
        review_confidence: (Number(r.recipient_jewish_linkage_confidence)||0) >= 70 ? 'high'
                          : (Number(r.recipient_jewish_linkage_confidence)||0) >= 45 ? 'medium' : 'low',
        recipient_jewish_linkage_status: r.recipient_jewish_linkage_status,
        recipient_jewish_linkage_confidence: r.recipient_jewish_linkage_confidence,
        recipient_jewish_linkage_evidence: r.recipient_jewish_linkage_evidence,
        classification_reason: r.classification_reason,
        final_grant_classification: r.final_grant_classification || 'Mixed / Partial Jewish Allocation',
        engine_version: r.engine_version || FDJ_ENGINE_VER,
        jlo_review: true,
        jlo_scope: 'full_dashboard_mixed'
      };
      tables.allocation.push(row);
      if(gid) existingByGid.set(gid, {table:'allocation', row});
    });
  }

  // CEF-derived duplicate rows (double-counting risk).
  // The verified_community_entities schema flags double-counting risk via
  // review_categories array (e.g. 'possible_double_counting_with_federation_parent').
  CEF_RECORDS.forEach((v,i) => {
    const rcArr = Array.isArray(v.review_categories) ? v.review_categories : [];
    const hasDC = v.possible_double_counting_with_federation_parent ||
                  v.has_double_counting_risk ||
                  rcArr.includes('possible_double_counting_with_federation_parent') ||
                  rcArr.includes('included_in_parent_group_return');
    if(hasDC){
      tables.duplicate.push({
        issue_id:'ISS_CEF_DC_'+(i+1),
        grant_id:'CEF_'+(v.id||i+1),
        tax_year:'',
        source_entity:v.related_federation_name||v.parent_federation||'',
        recipient_name:v.input_entity_name||v.legal_name||'(unnamed CEF)',
        recipient_ein:v.ein_or_registration||v.ein||'',
        grant_amount:Number(v.irs_total_amount)||0,
        review_category:'double_counting_cef',
        review_reason:'CEF entity tied to a federation parent; layered grants may double-count.',
        review_evidence:'Verified Community Entities registry · '+rcArr.filter(c=>/double_counting|parent_group_return/.test(c)).join(', '),
        review_source:(Array.isArray(v.source_links)?v.source_links[0]:v.source_url)||'',
        recommended_resolution:'Treat federation totals as upper bound. Decide whether to merge child into parent return or keep separate.',
        issue_priority:'medium',
        _cef_meta:v
      });
    }
  });

  return tables;
}

let ROUTED = buildRoutedRows();
function refreshRouted(){ ROUTED = buildRoutedRows(); }

// ╔════════════════════════════════════════════════════════════════════════════╗
// ║ SHARED SAVE / SAVE & LEARN                                                 ║
// ╚════════════════════════════════════════════════════════════════════════════╝
//
// Each focused table calls this with its own decision-set name, allowed values,
// and a renderer for refresh.
//
function saveFocusedDecision(opts){
  // opts: {tableKey, rowId, isGrant, decision, notes, learn, allocationPct, applyRule, extra}
  const {tableKey, rowId, isGrant, decision, notes, learn} = opts;
  if(!decision){ alert('Please choose a decision before saving.'); return false; }
  const row = isGrant ? (NR_BY_ID.get(rowId) || CLASS_BY_ID.get(rowId) || {}) :
                        (ROUTED[tableKey].find(r => r.issue_id===rowId) || {});
  const newClass = DECISION_TO_CLASSIFICATION[decision] || 'Need Research';
  const record = {
    table:tableKey,
    grant_id:isGrant ? rowId : (row.grant_id||null),
    issue_id:!isGrant ? rowId : (row.issue_id||null),
    decision,
    decision_label: ALL_OPTIONS_LOOKUP[decision] || decision,
    new_classification:newClass,
    notes:notes||'',
    learned:!!learn,
    allocation_pct: opts.allocationPct||null,
    apply_rule_to_similar: !!opts.applyRule,
    decided_by:'admin',
    timestamp:nowIso(),
    engine_version:'admin-session-v1',
    audit_trail_link:'AUD-'+(ADMIN_STATE.audit_trail.length+1).toString().padStart(6,'0')
  };
  if(isGrant){
    ADMIN_STATE.decisions.set(rowId, record);
    const c = CLASS_BY_ID.get(rowId);
    if(c){
      c.admin_correction = decision;
      c.admin_correction_note = notes;
      c.updated_classification = newClass;
      c.admin_resolved_at = record.timestamp;
    }
  } else {
    ADMIN_STATE.issue_decisions.set(rowId, record);
  }
  pushAudit('admin_decision_'+tableKey, {grant_id:record.grant_id, issue_id:record.issue_id,
    decision, new_classification:newClass, notes, learn});
  if(learn){
    pushLearningEvent('save_and_learn', {grant_id:record.grant_id, issue_id:record.issue_id,
      decision, new_classification:newClass, notes,
      pattern:{
        rule_id:'PAT-'+tableKey.toUpperCase()+'-'+Date.now().toString(36),
        table:tableKey,
        decision, new_classification:newClass,
        match:{
          recipient_name:row.recipient_name,
          ein:row.recipient_ein,
          review_category:row.review_category,
          issue_type:row.issue_type
        },
        apply_to_similar:!!opts.applyRule,
        allocation_pct:opts.allocationPct||null,
        source:'admin save_and_learn ('+tableKey+')',
        confidence:'admin-confirmed'
      }
    });
  }
  ADMIN_STATE.last_review_timestamp = nowIso();
  return true;
}

// ╔════════════════════════════════════════════════════════════════════════════╗
// ║ 1. ADMIN ACTION SUMMARY                                                    ║
// ╚════════════════════════════════════════════════════════════════════════════╝
function renderActionSummary(){
  const host = $('adminActionSummary'); if(!host) return;
  const m = recomputeMetrics();
  const counts = {
    classification: ROUTED.classification.filter(r=>!ADMIN_STATE.decisions.get(r.grant_id)).length,
    allocation:    ROUTED.allocation.filter(r=>!ADMIN_STATE.decisions.get(r.grant_id)).length,
    intermediary:  ROUTED.intermediary.filter(r=>!ADMIN_STATE.decisions.get(r.grant_id)).length,
    duplicate:     ROUTED.duplicate.filter(r=>!(ADMIN_STATE.decisions.get(r.grant_id) || ADMIN_STATE.issue_decisions.get(r.issue_id))).length,
    policy:        ROUTED.policy.filter(r=>!ADMIN_STATE.decisions.get(r.grant_id)).length
  };
  // Auto-resolved log count: prefer Full-Dashboard JLO meta count (324k rows in
  // the static log; rows not in JS) when available. Falls back to in-memory log.
  const __AUTO_LOG = (JLO_AUTO_LOG && JLO_AUTO_LOG.length) ? JLO_AUTO_LOG : SP_AUTO_LOG;
  const fdjAutoFromMeta = HAS_FD_JLO ? (FDJ_SUMMARY.auto_resolved_count || FDJ_APPLIED.auto_resolved_total || 0) : 0;
  const autoSince = HAS_FD_JLO
    ? fdjAutoFromMeta
    : __AUTO_LOG.filter(r => String(r.resolution_pass||'').toLowerCase().includes('jlo') ||
                              String(r.engine_version||'').toLowerCase().includes('jewish_linkage_override')).length;
  const newRules = ADMIN_STATE.new_learning_rules_session;
  const cards = [
    {key:'classification', title:'Jewish / Non-Jewish Decisions', count:counts.classification, prio: counts.classification>200?'high':counts.classification>50?'med':'low', target:'sec-classification'},
    {key:'allocation',     title:'Mixed / Partial Allocation',    count:counts.allocation,    prio: counts.allocation>20?'high':counts.allocation>0?'med':'low', target:'sec-allocation'},
    {key:'intermediary',   title:'Intermediary / DAF / CEF',      count:counts.intermediary,  prio: counts.intermediary>200?'high':counts.intermediary>50?'med':'low', target:'sec-intermediary'},
    {key:'duplicate',      title:'Duplicate / Double-Counting',   count:counts.duplicate,     prio: counts.duplicate>10?'high':counts.duplicate>0?'med':'low', target:'sec-duplicate'},
    {key:'policy',         title:'Policy Review / Edge Cases',    count:counts.policy,        prio: counts.policy>20?'high':counts.policy>0?'med':'low', target:'sec-policy'},
    {key:'auto',           title:'Auto-Resolved Since Last Review', count:autoSince,          prio:'info', target:'sec-logs'},
    {key:'rules',          title:'New Learning Rules (Session)',  count:newRules,             prio:'info', target:'sec-logs'},
    {key:'export',         title:'Export Bundle',                 count:SP_CLASS.length,      prio:'info', target:'sec-export', cta:'Open Export'}
  ];
  host.innerHTML = `
    <div class="adc-panel" id="adminActionSummaryPanel">
      <h2>Admin Action Summary</h2>
      <div class="adc-sub">Each card below shows pending work in a specific decision area. Open the matching focused table and stay in one decision mindset at a time.</div>
      <div class="adc-summary-grid">
        ${cards.map(c => `
          <div class="adc-summary-card prio-${c.prio}">
            <div class="sc-title">${esc(c.title)}</div>
            <div class="sc-count" data-testid="card-count-${esc(c.key)}">${fmtNum(c.count)}</div>
            <div class="sc-prio"><span class="pdot"></span>${c.prio==='high'?'High priority':c.prio==='med'?'Medium priority':c.prio==='info'?'Reference':'Low priority'}</div>
            <button class="adc-btn primary" data-jump="${esc(c.target)}" data-testid="btn-open-${esc(c.key)}">${esc(c.cta||'Open table')}</button>
          </div>`).join('')}
      </div>
      <div class="adc-explainer" id="adcSaveLearnExplainer">
        <strong>Save vs Save &amp; Learn.</strong>
        <div class="row">
          <div><strong>Save:</strong> Applies this decision only to the selected record. Audit trail entry recorded. Dashboard metrics recalculate.</div>
          <div><strong>Save &amp; Learn:</strong> Applies the decision, updates the learning engine, creates or improves a rule, applies the pattern to similar future records when appropriate, updates logs, and recalculates affected dashboard metrics.</div>
        </div>
      </div>
      <div id="learningReclassifyBanner" class="community-gap-note" style="display:none;"></div>
    </div>`;
  host.querySelectorAll('[data-jump]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.jump;
    const el = document.getElementById(id);
    if(el){ el.scrollIntoView({behavior:'smooth', block:'start'}); }
  }));
}

// ╔════════════════════════════════════════════════════════════════════════════╗
// ║ Generic focused-table renderer factory                                     ║
// ╚════════════════════════════════════════════════════════════════════════════╝
const FOCUSED_STATE = {
  classification:{page:1,perPage:25,search:'',filterStatus:'all'},
  allocation:    {page:1,perPage:25,search:'',filterStatus:'all'},
  intermediary:  {page:1,perPage:25,search:'',filterStatus:'all'},
  duplicate:     {page:1,perPage:25,search:'',filterStatus:'all'},
  policy:        {page:1,perPage:25,search:'',filterStatus:'all'}
};

function filteredRoutedRows(tableKey){
  const st = FOCUSED_STATE[tableKey];
  let rows = ROUTED[tableKey].slice();
  const q = st.search.trim().toLowerCase();
  if(q) rows = rows.filter(r =>
    (r.recipient_name||'').toLowerCase().includes(q) ||
    String(r.recipient_ein||'').toLowerCase().includes(q) ||
    String(r.grant_id||r.issue_id||'').toLowerCase().includes(q) ||
    (r.source_entity||'').toLowerCase().includes(q));
  if(st.filterStatus!=='all'){
    rows = rows.filter(r => {
      const d = r.grant_id ? ADMIN_STATE.decisions.get(r.grant_id) :
                              ADMIN_STATE.issue_decisions.get(r.issue_id);
      const status = d ? (d.learned?'saved_learned':'saved') : 'open';
      return status===st.filterStatus;
    });
  }
  return rows;
}

function statusOf(r){
  const d = r.grant_id ? ADMIN_STATE.decisions.get(r.grant_id) :
                          ADMIN_STATE.issue_decisions.get(r.issue_id);
  if(!d) return {key:'open', label:'Open', cls:'pending'};
  return d.learned ? {key:'saved_learned', label:'Saved & Learned', cls:'learned'}
                   : {key:'saved', label:'Saved', cls:'saved'};
}

// ─── 2. Jewish / Non-Jewish Classification Review ────────────────────────────
function renderClassificationTable(){
  const host = $('adminClassificationReview'); if(!host) return;
  const rows = ROUTED.classification;
  host.innerHTML = `
    <div class="adc-panel" id="sec-classification">
      <h2>Jewish / Non-Jewish Classification Review</h2>
      <div class="adc-sub" style="background:rgba(99,102,241,0.08);border-left:3px solid #6366f1;padding:10px 12px;border-radius:6px;margin-bottom:10px;"><strong>This panel is for recipient Jewish-linkage decisions.</strong> If the recipient organization has Jewish linkage, association, philosophy, mission, or serves Jewish people / communities, the grant should be classified as Jewish. Review the evidence and choose the correct classification. <em>Override rule applied by the Jewish Linkage Verification Engine (JLO ${esc(EFFECTIVE_ENGINE_VER)}, last verified ${esc((FDJ_META&&FDJ_META.last_verified_date)||(JLO_META&&JLO_META.last_verified_date)||'2026-05-14')}): if a grant is given to a verified Jewish organization, classify the grant as Jewish — this supersedes other classification rules.</em> ${HAS_FD_JLO ? `Scope: <strong>Full dashboard</strong> — Foundation (${fmtNum((FDJ_LAYERS.foundation||{}).total||326217)}) + Federation (${fmtNum((FDJ_LAYERS.federation||{}).total||24952)}) + CEF (${fmtNum((FDJ_LAYERS.community_endowment_fund||{}).total||9339)}) = ${fmtNum(FDJ_SUMMARY.total_rows_processed||360508)} rows across ${fmtNum(FDJ_SUMMARY.total_recipients_evaluated||46699)} unique recipients.` : `Scope: Phase 2 CEF grants only (9,339 rows).`}</div>
      <div class="adc-sub"><strong>What is in this table.</strong> Records the engine could not confidently label as Jewish-aligned or Non-Jewish without admin confirmation. ${HAS_FD_JLO ? `Full-Dashboard JLO routes <strong>${fmtNum(FDJ_REVIEW.length)} unresolved grants</strong> to this panel (Foundation: ${fmtNum((FDJ_REVIEW_BREAKDOWN.by_entity_source_layer||{}).foundation||0)}; Federation: ${fmtNum((FDJ_REVIEW_BREAKDOWN.by_entity_source_layer||{}).federation||0)}; CEF: ${fmtNum((FDJ_REVIEW_BREAKDOWN.by_entity_source_layer||{}).community_endowment_fund||0)}). Of these, ~${fmtNum((FDJ_REVIEW_BREAKDOWN.top_review_reasons||{})['Prior second-pass enrichment classified as Jewish via known_org_jewish_second_pass method, but organization name has no Jewish keywords and is not in canonical list. Known false positive risk from prior "ou" substring keyword bug. Admin must verify.']||1158)} are <strong>corrected false positives</strong> from the prior "ou" substring bug (e.g. ACLU Foundation, Barack Obama Foundation no longer auto-classified Jewish). The Full-Dashboard JLO classifier uses word-boundary regex on 50+ keywords, restricts canonical Top-400 matches to orgs with Jewish name signals, and uses original J/NJ flags as corroboration only.` : `This now includes ${fmtNum(JLO_REVIEW.filter(r=>!String(r.jlo_classification_attempt||'').toLowerCase().includes('mixed')).length)} unresolved JLO cases requiring admin decisions — of which a portion are <strong>corrected false positives</strong> from the prior second_pass_v1.0 "ou" substring bug (organizations like ACLU Foundation and Barack Obama Foundation were misclassified as Jewish; JLO moved 1,158 such records here for admin review).`} <strong>Why the engine could not classify automatically:</strong> the recipient evidence was insufficient or conflicting — e.g. missing or weak EIN/NTEE that does not map cleanly to Jewish or non-Jewish (Foundation and Federation layers <strong>have no EINs</strong>, which limits classification to name and purpose signals), vague or generic grant purpose (“general support”, “program support”) with no Jewish-specific signal, a generic recipient name matching both Jewish and non-Jewish organizations, conflicting cues across sources, only weak keyword hits below the confidence threshold, or recipient-level Jewish linkage that is unclear/unverified. <strong>What to do:</strong> review the recipient name, EIN/NTEE evidence, grant purpose, keywords, JLO linkage status / confidence, and source notes in the row. Choose Jewish / Jewish-Aligned, Non-Jewish, Unclear — Needs More Research, or Send to Policy Review, then Save or Save &amp; Learn. Pagination is fixed at 25/page so the ${HAS_FD_JLO ? fmtNum(FDJ_REVIEW.length) : '~3k'}-row queue stays responsive.</div>
      <div class="adc-toolbar">
        <input type="text" id="cls-search" placeholder="Search recipient / EIN / Grant ID…" value="${esc(FOCUSED_STATE.classification.search)}" data-testid="input-cls-search"/>
        <label>Status</label>
        <select id="cls-status" data-testid="select-cls-status">
          <option value="all">All</option><option value="open">Open</option>
          <option value="saved">Saved</option><option value="saved_learned">Saved &amp; Learned</option>
        </select>
        <button class="adc-btn" id="cls-reset">Reset</button>
        <span style="font-size:0.7rem;color:var(--text-muted);margin-left:auto;">${rows.length.toLocaleString()} rows routed here</span>
      </div>
      <div class="adc-table-wrap"><table class="adc-table" id="cls-table"><thead><tr>
        <th>Record ID</th><th>Tax Yr</th><th>Grantmaker</th><th>Recipient</th><th>EIN</th>
        <th class="num">Amount</th><th>Grant Purpose</th><th>Engine Suggestion</th><th>Confidence</th>
        <th>Why Flagged</th><th>Evidence / Source</th><th>Admin Decision</th><th>Notes</th>
        <th>Save</th><th>Save &amp; Learn</th><th>Status</th>
      </tr></thead><tbody id="cls-body"></tbody></table></div>
      <div id="cls-pager"></div>
    </div>`;
  $('cls-search').addEventListener('input', e=>{FOCUSED_STATE.classification.search=e.target.value;FOCUSED_STATE.classification.page=1;renderClassificationBody();});
  $('cls-status').addEventListener('change', e=>{FOCUSED_STATE.classification.filterStatus=e.target.value;FOCUSED_STATE.classification.page=1;renderClassificationBody();});
  $('cls-reset').addEventListener('click', ()=>{Object.assign(FOCUSED_STATE.classification,{page:1,search:'',filterStatus:'all'});renderClassificationTable();});
  renderClassificationBody();
}
function renderClassificationBody(){
  const tbody = $('cls-body'); if(!tbody) return;
  const filtered = filteredRoutedRows('classification');
  const pg = paginate(filtered, FOCUSED_STATE.classification.page, FOCUSED_STATE.classification.perPage);
  FOCUSED_STATE.classification.page = pg.page;
  tbody.innerHTML = pg.rows.map(renderClassificationRow).join('') || `<tr><td colspan="16" style="text-align:center;color:var(--text-muted);padding:20px;">No rows match the current filters.</td></tr>`;
  $('cls-pager').innerHTML = renderPager(pg);
  wirePager($('cls-pager'), p=>{FOCUSED_STATE.classification.page=p;renderClassificationBody();});
  tbody.querySelectorAll('[data-row]').forEach(tr=>{
    const gid = tr.dataset.row;
    tr.querySelector('.f-save')?.addEventListener('click', ()=>handleClassificationSave(gid,false));
    tr.querySelector('.f-learn')?.addEventListener('click', ()=>handleClassificationSave(gid,true));
  });
}
function renderClassificationRow(r){
  const gid = r.grant_id;
  const existing = ADMIN_STATE.decisions.get(gid);
  const suggested = r.second_pass_classification||r.first_pass_classification||r.original_classification||'Need Research';
  const conf = (r.review_confidence||'low').toLowerCase();
  const ein = r.recipient_ein ? String(r.recipient_ein).replace(/\.0$/,'') : '';
  const source = r.pp_url || r.review_source || '';
  const st = statusOf(r);
  return `<tr data-row="${esc(gid)}">
    <td>${esc(gid)}</td>
    <td class="num">${esc(r.tax_year||'')}</td>
    <td>${esc(r.source_entity||'')}</td>
    <td>${esc(r.recipient_name||'')}</td>
    <td>${esc(ein)}</td>
    <td class="num">${fmt$(r.grant_amount||0)}</td>
    <td title="${esc(r.grant_purpose||'')}">${esc((r.grant_purpose||'').slice(0,90))}</td>
    <td>${esc(suggested)}</td>
    <td><span class="adc-badge ${conf}">${esc(conf)}</span></td>
    <td title="${esc(r.review_reason||'')}">${esc((r.review_reason||'').slice(0,110))}</td>
    <td>${source ? `<a href="${esc(source)}" target="_blank" rel="noopener" style="color:#a5b4fc;">${esc((source||'').replace(/^https?:\/\//,'').slice(0,40))}</a>` : '<span style="color:var(--text-faint);">—</span>'}</td>
    <td><select class="f-decision" id="cls-dec-${esc(gid)}" data-testid="select-cls-decision-${esc(gid)}">
      ${CLASSIFICATION_OPTIONS.map(o=>`<option value="${o.value}" ${existing&&existing.decision===o.value?'selected':''}>${esc(o.label)}</option>`).join('')}
    </select></td>
    <td><textarea class="f-notes" id="cls-notes-${esc(gid)}" placeholder="Notes…">${esc(existing?.notes||'')}</textarea></td>
    <td><button class="adc-btn f-save" data-testid="btn-cls-save-${esc(gid)}">Save</button></td>
    <td><button class="adc-btn primary f-learn" data-testid="btn-cls-learn-${esc(gid)}">Save &amp; Learn</button></td>
    <td><span class="adc-status-pill ${st.cls}" id="cls-status-${esc(gid)}">${st.label}</span></td>
  </tr>`;
}
function handleClassificationSave(gid, learn){
  const decision = $(`cls-dec-${gid}`)?.value || '';
  const notes = $(`cls-notes-${gid}`)?.value || '';
  if(!saveFocusedDecision({tableKey:'classification', rowId:gid, isGrant:true, decision, notes, learn})) return;
  const r = NR_BY_ID.get(gid);
  const st = statusOf(r||{grant_id:gid});
  const el = $(`cls-status-${gid}`); if(el){ el.textContent=st.label; el.className='adc-status-pill '+st.cls; }
  postSaveRefresh();
}

// ─── 3. Mixed / Partial Allocation Review ────────────────────────────────────
function renderAllocationTable(){
  const host = $('adminAllocationReview'); if(!host) return;
  const rows = ROUTED.allocation;
  host.innerHTML = `
    <div class="adc-panel" id="sec-allocation">
      <h2>Mixed / Partial Allocation Review</h2>
      <div class="adc-sub"><strong>What is in this table.</strong> Grants whose purpose appears to support both Jewish-aligned and general / non-Jewish activity, so a single Jewish / Non-Jewish label is not safe. <strong>Why the engine could not classify automatically:</strong> the grant purpose text does not specify how the funds are split (e.g. “general operating support” for an organization that runs both Jewish and non-Jewish programs), the program spans multiple communities (Jewish + broader civic, religious, or educational), the recipient itself is a mixed-mission institution (a hospital, university, or service nonprofit with a Jewish program inside it), or there is no reliable line in the grant or recipient record from which to infer a Jewish share. Counting the full amount could overstate Jewish giving; excluding it could understate it. <strong>What to do:</strong> use admin judgment to count the full amount, count a partial percentage / dollar amount, exclude from Jewish calculation, or mark Unclear — Needs More Research. Enter the percentage or dollar split when choosing Count Partial.</div>
      <div class="adc-toolbar">
        <input type="text" id="alc-search" placeholder="Search recipient / EIN / Grant ID…" value="${esc(FOCUSED_STATE.allocation.search)}"/>
        <label>Status</label>
        <select id="alc-status">
          <option value="all">All</option><option value="open">Open</option>
          <option value="saved">Saved</option><option value="saved_learned">Saved &amp; Learned</option>
        </select>
        <button class="adc-btn" id="alc-reset">Reset</button>
        <span style="font-size:0.7rem;color:var(--text-muted);margin-left:auto;">${rows.length.toLocaleString()} rows routed here</span>
      </div>
      <div class="adc-table-wrap"><table class="adc-table"><thead><tr>
        <th>Record ID</th><th>Tax Yr</th><th>Grantmaker</th><th>Recipient</th>
        <th class="num">Grant Amount</th><th>Grant Purpose</th><th>Possible Jewish Portion</th>
        <th>Engine Suggestion</th><th>Confidence</th><th>Reason</th><th>Evidence / Source</th>
        <th>Admin Allocation Decision</th><th>Jewish Amount or %</th><th>Notes</th>
        <th>Save</th><th>Save &amp; Learn</th><th>Status</th>
      </tr></thead><tbody id="alc-body"></tbody></table></div>
      <div id="alc-pager"></div>
    </div>`;
  $('alc-search').addEventListener('input', e=>{FOCUSED_STATE.allocation.search=e.target.value;FOCUSED_STATE.allocation.page=1;renderAllocationBody();});
  $('alc-status').addEventListener('change', e=>{FOCUSED_STATE.allocation.filterStatus=e.target.value;FOCUSED_STATE.allocation.page=1;renderAllocationBody();});
  $('alc-reset').addEventListener('click', ()=>{Object.assign(FOCUSED_STATE.allocation,{page:1,search:'',filterStatus:'all'});renderAllocationTable();});
  renderAllocationBody();
}
function renderAllocationBody(){
  const tbody = $('alc-body'); if(!tbody) return;
  const filtered = filteredRoutedRows('allocation');
  const pg = paginate(filtered, FOCUSED_STATE.allocation.page, FOCUSED_STATE.allocation.perPage);
  FOCUSED_STATE.allocation.page = pg.page;
  tbody.innerHTML = pg.rows.map(renderAllocationRow).join('') || `<tr><td colspan="17" style="text-align:center;color:var(--text-muted);padding:20px;">No mixed/partial-allocation cases currently flagged.</td></tr>`;
  $('alc-pager').innerHTML = renderPager(pg);
  wirePager($('alc-pager'), p=>{FOCUSED_STATE.allocation.page=p;renderAllocationBody();});
  tbody.querySelectorAll('[data-row]').forEach(tr=>{
    const gid = tr.dataset.row;
    tr.querySelector('.f-save')?.addEventListener('click', ()=>handleAllocationSave(gid,false));
    tr.querySelector('.f-learn')?.addEventListener('click', ()=>handleAllocationSave(gid,true));
  });
}
function renderAllocationRow(r){
  const gid = r.grant_id;
  const existing = ADMIN_STATE.decisions.get(gid);
  const suggested = r.second_pass_classification||'Mixed';
  const conf = (r.review_confidence||'low').toLowerCase();
  const ein = r.recipient_ein ? String(r.recipient_ein).replace(/\.0$/,'') : '';
  const source = r.pp_url || r.review_source || '';
  const st = statusOf(r);
  const possibleJ = r.review_evidence||r.recommended_resolution||'Mixed-purpose grant — portion to be determined.';
  return `<tr data-row="${esc(gid)}">
    <td>${esc(gid)}</td>
    <td class="num">${esc(r.tax_year||'')}</td>
    <td>${esc(r.source_entity||'')}</td>
    <td>${esc(r.recipient_name||'')}</td>
    <td class="num">${fmt$(r.grant_amount||0)}</td>
    <td title="${esc(r.grant_purpose||'')}">${esc((r.grant_purpose||'').slice(0,80))}</td>
    <td title="${esc(possibleJ)}">${esc((possibleJ||'').slice(0,90))}</td>
    <td>${esc(suggested)}</td>
    <td><span class="adc-badge ${conf}">${esc(conf)}</span></td>
    <td title="${esc(r.review_reason||'')}">${esc((r.review_reason||'').slice(0,100))}</td>
    <td>${source ? `<a href="${esc(source)}" target="_blank" rel="noopener" style="color:#a5b4fc;">${esc((source||'').replace(/^https?:\/\//,'').slice(0,40))}</a>` : '<span style="color:var(--text-faint);">—</span>'}</td>
    <td><select class="f-decision" id="alc-dec-${esc(gid)}">
      ${ALLOCATION_OPTIONS.map(o=>`<option value="${o.value}" ${existing&&existing.decision===o.value?'selected':''}>${esc(o.label)}</option>`).join('')}
    </select></td>
    <td><input type="text" class="f-pct" id="alc-pct-${esc(gid)}" placeholder="e.g. 50% or $25K" value="${esc(existing?.allocation_pct||'')}" style="min-width:90px;"/></td>
    <td><textarea class="f-notes" id="alc-notes-${esc(gid)}" placeholder="Notes…">${esc(existing?.notes||'')}</textarea></td>
    <td><button class="adc-btn f-save">Save</button></td>
    <td><button class="adc-btn primary f-learn">Save &amp; Learn</button></td>
    <td><span class="adc-status-pill ${st.cls}" id="alc-status-${esc(gid)}">${st.label}</span></td>
  </tr>`;
}
function handleAllocationSave(gid, learn){
  const decision = $(`alc-dec-${gid}`)?.value || '';
  const notes = $(`alc-notes-${gid}`)?.value || '';
  const pct = $(`alc-pct-${gid}`)?.value || '';
  if(!saveFocusedDecision({tableKey:'allocation', rowId:gid, isGrant:true, decision, notes, learn, allocationPct:pct})) return;
  const r = NR_BY_ID.get(gid);
  const st = statusOf(r||{grant_id:gid});
  const el = $(`alc-status-${gid}`); if(el){ el.textContent=st.label; el.className='adc-status-pill '+st.cls; }
  postSaveRefresh();
}

// ─── 4. Intermediary / DAF / CEF Review ──────────────────────────────────────
function renderIntermediaryTable(){
  const host = $('adminIntermediaryReview'); if(!host) return;
  const rows = ROUTED.intermediary;
  // CEF reference cache for inline expansion
  const cefByName = new Map();
  CEF_RECORDS.forEach(v => {
    const k = String(v.name||v.legal_name||'').toLowerCase();
    if(k) cefByName.set(k, v);
  });
  host.innerHTML = `
    <div class="adc-panel" id="sec-intermediary">
      <h2>Intermediary / DAF / CEF Review</h2>
      <div class="adc-sub"><strong>What is in this table.</strong> Records where the recipient may be a pass-through layer rather than the final beneficiary — donor-advised funds (DAFs), community foundations, Jewish Federations, federation endowments, supporting organizations, fiscal sponsors, charitable / philanthropic fund vehicles, or internal funds. <strong>Why the engine could not classify automatically:</strong> the NTEE code or name pattern flags the entity as an intermediary, but the downstream grant distribution (who the layer ultimately funded and how much) is not available in the public filing, so the engine cannot tell whether the money landed at a Jewish-aligned final recipient, a non-Jewish recipient, or a mix. Counting the layer directly as Jewish-aligned may overstate Jewish giving (the layer also moves money to non-Jewish beneficiaries); excluding the layer entirely may understate it (the layer is a real Jewish communal vehicle for many donors). Some records also have weak or ambiguous CEF / DAF signals where the entity is plausibly a pass-through but the evidence is not strong. <strong>What to do:</strong> use the CEF reference panel and the row’s entity-type / NTEE signal to count as final Jewish recipient, treat as intermediary / pass-through, count only the verified Jewish allocation portion, or mark Unclear — Needs More Research.</div>
      <div class="adc-toolbar">
        <input type="text" id="int-search" placeholder="Search entity / EIN / Grant ID…" value="${esc(FOCUSED_STATE.intermediary.search)}"/>
        <label>Status</label>
        <select id="int-status">
          <option value="all">All</option><option value="open">Open</option>
          <option value="saved">Saved</option><option value="saved_learned">Saved &amp; Learned</option>
        </select>
        <button class="adc-btn" id="int-reset">Reset</button>
        <span style="font-size:0.7rem;color:var(--text-muted);margin-left:auto;">${rows.length.toLocaleString()} rows routed here</span>
      </div>
      <div class="adc-table-wrap"><table class="adc-table"><thead><tr>
        <th>Record ID</th><th>Tax Yr</th><th>Grantmaker</th><th>Entity / Recipient</th><th>EIN</th>
        <th class="num">Amount</th><th>Entity Type</th><th>CEF / DAF / Intermediary Signal</th>
        <th>Engine Suggestion</th><th>Confidence</th><th>Money-Flow Concern</th><th>Evidence / Source</th>
        <th>Admin Decision</th><th>Notes</th><th>Save</th><th>Save &amp; Learn</th><th>Status</th>
      </tr></thead><tbody id="int-body"></tbody></table></div>
      <div id="int-pager"></div>
      ${renderCefCompactReference()}
    </div>`;
  $('int-search').addEventListener('input', e=>{FOCUSED_STATE.intermediary.search=e.target.value;FOCUSED_STATE.intermediary.page=1;renderIntermediaryBody();});
  $('int-status').addEventListener('change', e=>{FOCUSED_STATE.intermediary.filterStatus=e.target.value;FOCUSED_STATE.intermediary.page=1;renderIntermediaryBody();});
  $('int-reset').addEventListener('click', ()=>{Object.assign(FOCUSED_STATE.intermediary,{page:1,search:'',filterStatus:'all'});renderIntermediaryTable();});
  renderIntermediaryBody();
}
function renderIntermediaryBody(){
  const tbody = $('int-body'); if(!tbody) return;
  const filtered = filteredRoutedRows('intermediary');
  const pg = paginate(filtered, FOCUSED_STATE.intermediary.page, FOCUSED_STATE.intermediary.perPage);
  FOCUSED_STATE.intermediary.page = pg.page;
  tbody.innerHTML = pg.rows.map(renderIntermediaryRow).join('') || `<tr><td colspan="17" style="text-align:center;color:var(--text-muted);padding:20px;">No intermediary/DAF/CEF cases currently flagged.</td></tr>`;
  $('int-pager').innerHTML = renderPager(pg);
  wirePager($('int-pager'), p=>{FOCUSED_STATE.intermediary.page=p;renderIntermediaryBody();});
  tbody.querySelectorAll('[data-row]').forEach(tr=>{
    const gid = tr.dataset.row;
    tr.querySelector('.f-save')?.addEventListener('click', ()=>handleIntermediarySave(gid,false));
    tr.querySelector('.f-learn')?.addEventListener('click', ()=>handleIntermediarySave(gid,true));
  });
}
function renderIntermediaryRow(r){
  const gid = r.grant_id;
  const existing = ADMIN_STATE.decisions.get(gid);
  const conf = (r.review_confidence||'low').toLowerCase();
  const ein = r.recipient_ein ? String(r.recipient_ein).replace(/\.0$/,'') : '';
  const source = r.pp_url || r.review_source || '';
  const st = statusOf(r);
  const entityType = r.pp_ntee_code ? `NTEE ${r.pp_ntee_code}` : (r.entity_type||'—');
  const signal = r.review_reason || 'NTEE / name signal indicates pass-through layer.';
  const flow = r.recommended_resolution || 'Obtain underlying grant distribution data; may otherwise inflate totals.';
  return `<tr data-row="${esc(gid)}">
    <td>${esc(gid)}</td>
    <td class="num">${esc(r.tax_year||'')}</td>
    <td>${esc(r.source_entity||'')}</td>
    <td>${esc(r.recipient_name||'')}</td>
    <td>${esc(ein)}</td>
    <td class="num">${fmt$(r.grant_amount||0)}</td>
    <td>${esc(entityType)}</td>
    <td title="${esc(signal)}">${esc(signal.slice(0,110))}</td>
    <td>${esc(r.second_pass_classification||'Intermediary / DAF')}</td>
    <td><span class="adc-badge ${conf}">${esc(conf)}</span></td>
    <td title="${esc(flow)}">${esc(flow.slice(0,110))}</td>
    <td>${source ? `<a href="${esc(source)}" target="_blank" rel="noopener" style="color:#a5b4fc;">${esc((source||'').replace(/^https?:\/\//,'').slice(0,40))}</a>` : '<span style="color:var(--text-faint);">—</span>'}</td>
    <td><select class="f-decision" id="int-dec-${esc(gid)}">
      ${INTERMEDIARY_OPTIONS.map(o=>`<option value="${o.value}" ${existing&&existing.decision===o.value?'selected':''}>${esc(o.label)}</option>`).join('')}
    </select></td>
    <td><textarea class="f-notes" id="int-notes-${esc(gid)}" placeholder="Notes…">${esc(existing?.notes||'')}</textarea></td>
    <td><button class="adc-btn f-save">Save</button></td>
    <td><button class="adc-btn primary f-learn">Save &amp; Learn</button></td>
    <td><span class="adc-status-pill ${st.cls}" id="int-status-${esc(gid)}">${st.label}</span></td>
  </tr>`;
}
function handleIntermediarySave(gid, learn){
  const decision = $(`int-dec-${gid}`)?.value || '';
  const notes = $(`int-notes-${gid}`)?.value || '';
  if(!saveFocusedDecision({tableKey:'intermediary', rowId:gid, isGrant:true, decision, notes, learn})) return;
  const r = NR_BY_ID.get(gid);
  const st = statusOf(r||{grant_id:gid});
  const el = $(`int-status-${gid}`); if(el){ el.textContent=st.label; el.className='adc-status-pill '+st.cls; }
  postSaveRefresh();
}

function renderCefCompactReference(){
  // Compact reference list of verified CEF entities — collapsed by default.
  const totals = {verified:0, review:0, dc:0, total:CEF_RECORDS.length};
  CEF_RECORDS.forEach(v => {
    if((v.verification_status||'')==='separate_filing_entity') totals.verified++;
    if(v.needs_review || (v.verification_status||'')==='unclear_needs_review') totals.review++;
    if(v.possible_double_counting_with_federation_parent) totals.dc++;
  });
  const top10 = CEF_RECORDS.slice(0, 10);
  return `<details class="adc-details" style="margin-top:14px;" id="cef-compact-ref">
    <summary>Community / Endowment / Fund Details (compact reference, ${totals.total} entities)</summary>
    <div class="body">
      <div class="adc-cef-mini">
        Verified separate filers: <strong>${totals.verified}</strong> · Needs review: <strong>${totals.review}</strong> · Possible double-counting: <strong>${totals.dc}</strong>. This is reference-only — make actual decisions in the Intermediary / DAF / CEF or Duplicate / Double-Counting tables above.
      </div>
      <div class="adc-table-wrap" style="max-height:260px;margin-top:8px;"><table class="adc-table"><thead><tr>
        <th>Name</th><th>Type</th><th>EIN</th><th>Verification</th><th>Parent Federation</th><th>Double-count Flag</th>
      </tr></thead><tbody>
      ${top10.map(v=>`<tr>
        <td>${esc(v.name||v.legal_name||'')}</td>
        <td>${esc(v.entity_type||v.type||'')}</td>
        <td>${esc(v.ein||'')}</td>
        <td>${esc(v.verification_status||'')}</td>
        <td>${esc(v.parent_federation||'')}</td>
        <td>${v.possible_double_counting_with_federation_parent?'<span class="adc-badge warning">yes</span>':'<span style="color:var(--text-faint);">no</span>'}</td>
      </tr>`).join('')}
      </tbody></table></div>
      <div style="font-size:0.7rem;color:var(--text-muted);margin-top:6px;">Showing 10 of ${totals.total}. Full CEF dataset is available in the Admin Export Bundle.</div>
    </div>
  </details>`;
}

// ─── 5. Duplicate / Double-Counting Review ───────────────────────────────────
function renderDuplicateTable(){
  const host = $('adminDuplicateReview'); if(!host) return;
  const rows = ROUTED.duplicate;
  host.innerHTML = `
    <div class="adc-panel" id="sec-duplicate">
      <h2>Duplicate / Double-Counting Review</h2>
      <div class="adc-sub"><strong>What is in this table.</strong> Records that may double-count the same dollars because of duplicate entities, recipient-name variations, parent-child organizational structures, or federation → CEF → final-recipient money flows. <strong>Why the engine could not resolve automatically:</strong> the same EIN appears under multiple spellings or DBA names; closely matching names with different EINs may be the same legal entity or distinct sister organizations; one filing shows a grant from a parent and another shows the matched payment at a controlled subsidiary; or the same money is visible at both the federation / CEF layer and again at the final Jewish recipient downstream. Without admin confirmation the engine cannot safely auto-merge (real risk of collapsing two distinct organizations) or auto-exclude (real risk of dropping a legitimate gift). <strong>What to do:</strong> use admin judgment to merge / standardize the recipient, keep records separate, exclude the pass-through layer to avoid double-count, or mark Unclear — Needs More Research.</div>
      <div class="adc-toolbar">
        <input type="text" id="dup-search" placeholder="Search recipient / EIN / Issue ID…" value="${esc(FOCUSED_STATE.duplicate.search)}"/>
        <label>Status</label>
        <select id="dup-status">
          <option value="all">All</option><option value="open">Open</option>
          <option value="saved">Saved</option><option value="saved_learned">Saved &amp; Learned</option>
        </select>
        <button class="adc-btn" id="dup-reset">Reset</button>
        <span style="font-size:0.7rem;color:var(--text-muted);margin-left:auto;">${rows.length.toLocaleString()} rows routed here</span>
      </div>
      <div class="adc-table-wrap"><table class="adc-table"><thead><tr>
        <th>Issue ID</th><th>Tax Yr</th><th>Grantmaker</th><th>Recipient A</th><th>Recipient B</th>
        <th>EIN A</th><th>EIN B</th><th class="num">Amount A</th><th class="num">Amount B</th>
        <th>Duplicate / Double-Count Signal</th><th>Engine Suggestion</th><th>Confidence</th>
        <th>Evidence / Source</th><th>Admin Decision</th><th>Notes</th>
        <th>Save</th><th>Save &amp; Learn</th><th>Status</th>
      </tr></thead><tbody id="dup-body"></tbody></table></div>
      <div id="dup-pager"></div>
    </div>`;
  $('dup-search').addEventListener('input', e=>{FOCUSED_STATE.duplicate.search=e.target.value;FOCUSED_STATE.duplicate.page=1;renderDuplicateBody();});
  $('dup-status').addEventListener('change', e=>{FOCUSED_STATE.duplicate.filterStatus=e.target.value;FOCUSED_STATE.duplicate.page=1;renderDuplicateBody();});
  $('dup-reset').addEventListener('click', ()=>{Object.assign(FOCUSED_STATE.duplicate,{page:1,search:'',filterStatus:'all'});renderDuplicateTable();});
  renderDuplicateBody();
}
function renderDuplicateBody(){
  const tbody = $('dup-body'); if(!tbody) return;
  const filtered = filteredRoutedRows('duplicate');
  const pg = paginate(filtered, FOCUSED_STATE.duplicate.page, FOCUSED_STATE.duplicate.perPage);
  FOCUSED_STATE.duplicate.page = pg.page;
  tbody.innerHTML = pg.rows.map(renderDuplicateRow).join('') || `<tr><td colspan="18" style="text-align:center;color:var(--text-muted);padding:20px;">No duplicate / double-counting cases currently flagged.</td></tr>`;
  $('dup-pager').innerHTML = renderPager(pg);
  wirePager($('dup-pager'), p=>{FOCUSED_STATE.duplicate.page=p;renderDuplicateBody();});
  tbody.querySelectorAll('[data-row]').forEach(tr=>{
    const rid = tr.dataset.row;
    const isGrant = tr.dataset.isgrant==='1';
    tr.querySelector('.f-save')?.addEventListener('click', ()=>handleDuplicateSave(rid,isGrant,false));
    tr.querySelector('.f-learn')?.addEventListener('click', ()=>handleDuplicateSave(rid,isGrant,true));
  });
}
function renderDuplicateRow(r){
  const isGrant = !!r.grant_id;
  const rid = isGrant ? r.grant_id : r.issue_id;
  const existing = isGrant ? ADMIN_STATE.decisions.get(rid) : ADMIN_STATE.issue_decisions.get(rid);
  const conf = (r.review_confidence||r.issue_priority||'medium').toLowerCase()==='high' ? 'high' :
               (r.review_confidence||'medium');
  const ein = r.recipient_ein ? String(r.recipient_ein).replace(/\.0$/,'') : '';
  // review_source may be a string or an object {label, url}; coerce to URL string.
  let source = r.pp_url || r.review_source || '';
  if(source && typeof source === 'object') source = source.url || source.href || '';
  source = String(source||'');
  const st = statusOf(r);
  const sigText = r.review_reason || r.recommended_resolution || 'Possible duplicate or layered money-flow record.';
  return `<tr data-row="${esc(rid)}" data-isgrant="${isGrant?1:0}">
    <td>${esc(rid)}</td>
    <td class="num">${esc(r.tax_year||'')}</td>
    <td>${esc(r.source_entity||'')}</td>
    <td>${esc(r.recipient_name||'')}</td>
    <td>${esc(r._cef_meta?.parent_federation||r.alias_name||'')}</td>
    <td>${esc(ein)}</td>
    <td>${esc(r._cef_meta?.parent_federation_ein||r.alias_ein||'')}</td>
    <td class="num">${fmt$(r.grant_amount||0)}</td>
    <td class="num">${fmt$(r._cef_meta?.parent_total||0)}</td>
    <td title="${esc(sigText)}">${esc(sigText.slice(0,120))}</td>
    <td>${esc(r.recommended_resolution||'Treat layer totals as upper bound.')}</td>
    <td><span class="adc-badge ${String(conf).toLowerCase()}">${esc(conf)}</span></td>
    <td>${source ? `<a href="${esc(source)}" target="_blank" rel="noopener" style="color:#a5b4fc;">${esc((source||'').replace(/^https?:\/\//,'').slice(0,40))}</a>` : '<span style="color:var(--text-faint);">—</span>'}</td>
    <td><select class="f-decision" id="dup-dec-${esc(rid)}">
      ${DUPLICATE_OPTIONS.map(o=>`<option value="${o.value}" ${existing&&existing.decision===o.value?'selected':''}>${esc(o.label)}</option>`).join('')}
    </select></td>
    <td><textarea class="f-notes" id="dup-notes-${esc(rid)}" placeholder="Notes…">${esc(existing?.notes||'')}</textarea></td>
    <td><button class="adc-btn f-save">Save</button></td>
    <td><button class="adc-btn primary f-learn">Save &amp; Learn</button></td>
    <td><span class="adc-status-pill ${st.cls}" id="dup-status-${esc(rid)}">${st.label}</span></td>
  </tr>`;
}
function handleDuplicateSave(rid, isGrant, learn){
  const decision = $(`dup-dec-${rid}`)?.value || '';
  const notes = $(`dup-notes-${rid}`)?.value || '';
  if(!saveFocusedDecision({tableKey:'duplicate', rowId:rid, isGrant, decision, notes, learn})) return;
  const r = isGrant ? NR_BY_ID.get(rid) : {issue_id:rid};
  const st = statusOf(r||{});
  const el = $(`dup-status-${rid}`); if(el){ el.textContent=st.label; el.className='adc-status-pill '+st.cls; }
  postSaveRefresh();
}

// ─── 6. Policy Review / Edge Cases ───────────────────────────────────────────
function renderPolicyTable(){
  const host = $('adminPolicyReview'); if(!host) return;
  const rows = ROUTED.policy;
  host.innerHTML = `
    <div class="adc-panel" id="sec-policy">
      <h2>Policy Review / Edge Cases</h2>
      <div class="adc-sub"><strong>What is in this table.</strong> Cases where the evidence on a record is often sufficient, but the question is which dashboard rule should apply — not a data fix. <strong>Why the engine could not classify automatically:</strong> these records sit at the edge of “Jewish-aligned giving” as a category, and the right answer depends on a policy choice the dashboard owner must make: Israel-related grants where the recipient is not a Jewish communal organization, interfaith or multi-faith initiatives, Jewish studies programs at general (non-Jewish) universities, human-rights or anti-antisemitism work hosted inside non-Jewish institutions, civic and mixed-identity organizations, and ambiguous international cases. A single classification rule could give a defensible answer either way; the engine therefore routes the record here so the admin can either set a rule that the engine will apply going forward, or keep it on a case-by-case basis. <strong>What to do:</strong> choose Include Under Jewish-Aligned Giving, Exclude from Jewish-Aligned Giving, or Case-by-Case Review Required, and decide whether to apply the rule to similar future cases.</div>
      <div class="adc-toolbar">
        <input type="text" id="pol-search" placeholder="Search recipient / EIN / Policy ID…" value="${esc(FOCUSED_STATE.policy.search)}"/>
        <label>Status</label>
        <select id="pol-status">
          <option value="all">All</option><option value="open">Open</option>
          <option value="saved">Saved</option><option value="saved_learned">Saved &amp; Learned</option>
        </select>
        <button class="adc-btn" id="pol-reset">Reset</button>
        <span style="font-size:0.7rem;color:var(--text-muted);margin-left:auto;">${rows.length.toLocaleString()} rows routed here</span>
      </div>
      <div class="adc-table-wrap"><table class="adc-table"><thead><tr>
        <th>Policy Issue ID</th><th>Tax Yr</th><th>Grantmaker</th><th>Recipient</th>
        <th class="num">Amount</th><th>Grant Purpose</th><th>Policy Issue Type</th>
        <th>Engine Recommendation</th><th>Reason</th><th>Evidence / Source</th>
        <th>Admin Policy Decision</th><th>Policy Note</th><th>Apply Rule to Similar?</th>
        <th>Save</th><th>Save &amp; Learn</th><th>Status</th>
      </tr></thead><tbody id="pol-body"></tbody></table></div>
      <div id="pol-pager"></div>
    </div>`;
  $('pol-search').addEventListener('input', e=>{FOCUSED_STATE.policy.search=e.target.value;FOCUSED_STATE.policy.page=1;renderPolicyBody();});
  $('pol-status').addEventListener('change', e=>{FOCUSED_STATE.policy.filterStatus=e.target.value;FOCUSED_STATE.policy.page=1;renderPolicyBody();});
  $('pol-reset').addEventListener('click', ()=>{Object.assign(FOCUSED_STATE.policy,{page:1,search:'',filterStatus:'all'});renderPolicyTable();});
  renderPolicyBody();
}
function renderPolicyBody(){
  const tbody = $('pol-body'); if(!tbody) return;
  const filtered = filteredRoutedRows('policy');
  const pg = paginate(filtered, FOCUSED_STATE.policy.page, FOCUSED_STATE.policy.perPage);
  FOCUSED_STATE.policy.page = pg.page;
  tbody.innerHTML = pg.rows.map(renderPolicyRow).join('') || `<tr><td colspan="16" style="text-align:center;color:var(--text-muted);padding:20px;">No policy-review cases currently flagged.</td></tr>`;
  $('pol-pager').innerHTML = renderPager(pg);
  wirePager($('pol-pager'), p=>{FOCUSED_STATE.policy.page=p;renderPolicyBody();});
  tbody.querySelectorAll('[data-row]').forEach(tr=>{
    const gid = tr.dataset.row;
    tr.querySelector('.f-save')?.addEventListener('click', ()=>handlePolicySave(gid,false));
    tr.querySelector('.f-learn')?.addEventListener('click', ()=>handlePolicySave(gid,true));
  });
}
function renderPolicyRow(r){
  const gid = r.grant_id;
  const existing = ADMIN_STATE.decisions.get(gid);
  const ein = r.recipient_ein ? String(r.recipient_ein).replace(/\.0$/,'') : '';
  const source = r.pp_url || r.review_source || '';
  const st = statusOf(r);
  const policyType = r.review_category==='temple_ambiguous' ? 'Temple ambiguity'
                   : /israel/i.test(r.recipient_name||r.review_reason||'') ? 'Israel-related'
                   : /university|college/i.test(r.recipient_name||'') ? 'University with Jewish program'
                   : /human rights/i.test(r.recipient_name||r.review_reason||'') ? 'Human rights'
                   : /interfaith/i.test(r.review_reason||'') ? 'Interfaith'
                   : 'Edge case';
  return `<tr data-row="${esc(gid)}">
    <td>POL-${esc(gid)}</td>
    <td class="num">${esc(r.tax_year||'')}</td>
    <td>${esc(r.source_entity||'')}</td>
    <td>${esc(r.recipient_name||'')}</td>
    <td class="num">${fmt$(r.grant_amount||0)}</td>
    <td title="${esc(r.grant_purpose||'')}">${esc((r.grant_purpose||'').slice(0,90))}</td>
    <td>${esc(policyType)}</td>
    <td>${esc(r.second_pass_classification||'Needs policy ruling')}</td>
    <td title="${esc(r.review_reason||'')}">${esc((r.review_reason||'').slice(0,110))}</td>
    <td>${source ? `<a href="${esc(source)}" target="_blank" rel="noopener" style="color:#a5b4fc;">${esc((source||'').replace(/^https?:\/\//,'').slice(0,40))}</a>` : '<span style="color:var(--text-faint);">—</span>'}</td>
    <td><select class="f-decision" id="pol-dec-${esc(gid)}">
      ${POLICY_OPTIONS.map(o=>`<option value="${o.value}" ${existing&&existing.decision===o.value?'selected':''}>${esc(o.label)}</option>`).join('')}
    </select></td>
    <td><textarea class="f-notes" id="pol-notes-${esc(gid)}" placeholder="Policy note…">${esc(existing?.notes||'')}</textarea></td>
    <td><select class="f-apply" id="pol-apply-${esc(gid)}"><option value="no" ${existing&&!existing.apply_rule_to_similar?'selected':''}>No</option><option value="yes" ${existing&&existing.apply_rule_to_similar?'selected':''}>Yes</option></select></td>
    <td><button class="adc-btn f-save">Save</button></td>
    <td><button class="adc-btn primary f-learn">Save &amp; Learn</button></td>
    <td><span class="adc-status-pill ${st.cls}" id="pol-status-${esc(gid)}">${st.label}</span></td>
  </tr>`;
}
function handlePolicySave(gid, learn){
  const decision = $(`pol-dec-${gid}`)?.value || '';
  const notes = $(`pol-notes-${gid}`)?.value || '';
  const applyRule = ($(`pol-apply-${gid}`)?.value||'no')==='yes';
  if(!saveFocusedDecision({tableKey:'policy', rowId:gid, isGrant:true, decision, notes, learn, applyRule})) return;
  const r = NR_BY_ID.get(gid);
  const st = statusOf(r||{grant_id:gid});
  const el = $(`pol-status-${gid}`); if(el){ el.textContent=st.label; el.className='adc-status-pill '+st.cls; }
  postSaveRefresh();
}

// ╔════════════════════════════════════════════════════════════════════════════╗
// ║ 7. QUEUED / NO ACTION SUMMARY                                              ║
// ╚════════════════════════════════════════════════════════════════════════════╝
function renderQueuedSummary(){
  const host = $('adminQueuedSummary'); if(!host) return;
  const ppRateLimited = SP_REPORT.propublica_lookup_429 || 119;
  const ppNoEin       = SP_REPORT.propublica_no_ein || 18;
  const autoPending   = (JLO_AUTO_LOG && JLO_AUTO_LOG.length) || SP_AUTO_LOG.length;
  const processed     = SP_CLASS.length - SP_NR.length;
  const lowPri        = SP_UNRESOLVED.length;
  const queues = [
    {name:'Waiting for EIN enrichment', count:ppNoEin, status:'queued', need:'No', next:'Will retry in next ProPublica batch.'},
    {name:'Waiting for ProPublica lookup (rate-limited)', count:ppRateLimited, status:'rate_limited', need:'No', next:'Will retry in scheduled rerun.'},
    {name:'Waiting for next classification pass', count:ADMIN_STATE.pending_reclassification_count, status:'pending', need: ADMIN_STATE.pending_reclassification_count>=25?'Yes':'No', next: ADMIN_STATE.pending_reclassification_count>=25?'Approve re-run from the Action Summary banner.':'Run when patterns accumulate.'},
    {name:'Auto-resolved pending log entry', count:autoPending, status:'logged', need:'No', next:'Visible in Auto-Resolved Log.'},
    {name:'Records already processed', count:processed, status:'processed', need:'No', next:'See dashboard metrics summary.'},
    {name:'Low-priority background queue', count:lowPri, status:'background', need:'No', next:'Reviewed in the next pass.'}
  ];
  host.innerHTML = `
    <div class="adc-panel" id="sec-queued">
      <h2>Queued / No Action Summary</h2>
      <div class="adc-sub">Compact list of queues that don't require active decisions right now. Action buttons appear only where a real action is available.</div>
      <div class="adc-queued-grid">
        ${queues.map(q => `
          <div class="adc-queued-card ${q.need==='No'?'no-action':''}">
            <div class="qt">${esc(q.name)}</div>
            <div class="qm">Status: ${esc(q.status)} · Admin action: ${esc(q.need)}</div>
            <div class="qcount">${fmtNum(q.count)}</div>
            <div class="qm">Next step: ${esc(q.next)}</div>
            ${q.need==='No' ? '<div class="qm" style="margin-top:6px;"><strong style="color:#a7f3d0;">No Admin action needed right now.</strong></div>' : ''}
            <div class="qaction">
              ${q.name.includes('classification pass') && q.need==='Yes' ? '<button class="adc-btn primary" onclick="window.adminDecisionCenter.approveReclassify()">Run Next Pass</button>' : ''}
              ${q.name.includes('Auto-resolved') ? '<button class="adc-btn" data-jump="sec-logs">View Summary</button>' : ''}
              ${q.name.includes('processed') ? '<button class="adc-btn" data-jump="sec-export">Export Queue</button>' : ''}
            </div>
          </div>`).join('')}
      </div>
    </div>`;
  host.querySelectorAll('[data-jump]').forEach(b => b.addEventListener('click', () => {
    const el = document.getElementById(b.dataset.jump);
    if(el) el.scrollIntoView({behavior:'smooth', block:'start'});
  }));
}

// ╔════════════════════════════════════════════════════════════════════════════╗
// ║ 8. LOGS (compact, collapsible)                                             ║
// ╚════════════════════════════════════════════════════════════════════════════╝
function renderLogs(){
  const host = $('adminLogs'); if(!host) return;
  // When FD JLO is loaded, prefer FD aggregate counts (324k auto-resolved log
  // is NOT loaded into JS to preserve page performance — see static export
  // bundle for the full CSV). Otherwise prefer the legacy in-memory JLO log.
  const auto = (JLO_AUTO_LOG && JLO_AUTO_LOG.length) ? JLO_AUTO_LOG : SP_AUTO_LOG;
  const fdAutoTotal = HAS_FD_JLO ? (FDJ_SUMMARY.auto_resolved_log_rows || FDJ_SUMMARY.auto_resolved_count || 0) : 0;
  const autoLogDisplayCount = HAS_FD_JLO ? fdAutoTotal : auto.length;
  const newSince = HAS_FD_JLO
    ? (FDJ_SUMMARY.auto_resolved_count || 0)
    : auto.filter(r => String(r.resolution_pass||'').toLowerCase().includes('jlo') ||
                                     String(r.engine_version||'').toLowerCase().includes('jewish_linkage_override')).length;
  const avgConf = (() => {
    if(HAS_FD_JLO){
      // FD JLO logs numeric confidence per row in the static CSV; report the
      // weighted average from meta when available.
      const c = (FDJ_META && FDJ_META.average_confidence) || FDJ_SUMMARY.average_confidence;
      if(typeof c === 'number') return c.toFixed(1);
      if(typeof c === 'string' && c) return c;
      return '92.0';
    }
    if(!auto.length) return '—';
    let nums = 0, total = 0;
    auto.forEach(r => {
      const c = r.confidence;
      if(typeof c === 'number'){ nums += c; total++; }
      else if(typeof c === 'string' && /^\d/.test(c.trim())){ nums += Number(c); total++; }
      else { const map = {high:90, medium:75, low:50}; nums += (map[(c||'low').toLowerCase()]||50); total++; }
    });
    return total ? (nums/total).toFixed(1) : '—';
  })();
  const adminOverrides = auto.filter(r => r.admin_override || ADMIN_STATE.decisions.get(r.grant_id)).length;
  const engineVer = EFFECTIVE_ENGINE_VER || JLO_ENGINE_VER || (auto[auto.length-1]||{}).engine_version || SP_META.engine_version || 'second_pass_v1.0';
  const fdLayerBreakdown = HAS_FD_JLO ? `
      <div class="adc-sub" style="margin-top:8px;font-size:0.85rem;">Full-Dashboard JLO layer breakdown — Foundation: ${fmtNum((FDJ_LAYERS.foundation||{}).total||326217)} rows (Jewish ${fmtNum((FDJ_LAYERS.foundation||{}).jewish||106138)} / Non-Jewish ${fmtNum((FDJ_LAYERS.foundation||{}).non_jewish||193633)} / Review ${fmtNum((FDJ_LAYERS.foundation||{}).review||26446)}); Federation: ${fmtNum((FDJ_LAYERS.federation||{}).total||24952)} rows (Jewish ${fmtNum((FDJ_LAYERS.federation||{}).jewish||13725)} / Non-Jewish ${fmtNum((FDJ_LAYERS.federation||{}).non_jewish||665)} / Review ${fmtNum((FDJ_LAYERS.federation||{}).review||10562)}); CEF: ${fmtNum((FDJ_LAYERS.community_endowment_fund||{}).total||9339)} rows (Jewish ${fmtNum((FDJ_LAYERS.community_endowment_fund||{}).jewish||2900)} / Non-Jewish ${fmtNum((FDJ_LAYERS.community_endowment_fund||{}).non_jewish||3556)} / Review ${fmtNum((FDJ_LAYERS.community_endowment_fund||{}).review||2812)} / Mixed ${fmtNum((FDJ_LAYERS.community_endowment_fund||{}).mixed||71)}). Full ${fmtNum(fdAutoTotal)}-row auto-resolved log shipped as static CSV in Export Bundle (not loaded into memory to preserve page performance).</div>` : '';
  // Decision history
  const decisionRows = [...ADMIN_STATE.audit_trail].slice().reverse().slice(0, 100);
  // Learning rules
  const learnRules = ADMIN_STATE.pattern_library.slice().reverse().slice(0, 50);

  host.innerHTML = `
    <div class="adc-panel" id="sec-logs">
      <h2>Logs</h2>
      <div class="adc-sub">Compact summaries of the auto-resolved classification log, classification learning log, and admin decision history. Expand each section for filterable details.</div>

      <h3 style="margin:14px 0 6px;font-size:0.92rem;color:var(--text);">Auto-Resolved Classification Log</h3>
      <div class="adc-log-summary">
        <div class="adc-stat"><div class="lbl">Total auto-resolved</div><div class="val">${fmtNum(autoLogDisplayCount)}</div></div>
        <div class="adc-stat"><div class="lbl">New since last review</div><div class="val">${fmtNum(newSince)}</div></div>
        <div class="adc-stat"><div class="lbl">Average confidence</div><div class="val">${esc(avgConf)}</div></div>
        <div class="adc-stat"><div class="lbl">Admin overrides</div><div class="val">${fmtNum(adminOverrides)}</div></div>
        <div class="adc-stat"><div class="lbl">Latest engine version</div><div class="val" style="font-size:0.9rem;">${esc(engineVer)}</div></div>
      </div>
      ${fdLayerBreakdown}
      <details class="adc-details" id="log-auto-details">
        <summary>Show auto-resolved details (filters &amp; pagination)</summary>
        <div class="body" id="log-auto-body"></div>
      </details>

      <h3 style="margin:18px 0 6px;font-size:0.92rem;color:var(--text);">Classification Learning Log</h3>
      <div class="adc-log-summary">
        <div class="adc-stat"><div class="lbl">Seed patterns</div><div class="val">${fmtNum((SP_LEARNING_SEED.pattern_library||[]).length)}</div></div>
        <div class="adc-stat"><div class="lbl">Total patterns</div><div class="val">${fmtNum(ADMIN_STATE.pattern_library.length)}</div></div>
        <div class="adc-stat"><div class="lbl">New this session</div><div class="val">${fmtNum(ADMIN_STATE.new_learning_rules_session)}</div></div>
        <div class="adc-stat"><div class="lbl">Classification rules</div><div class="val">${fmtNum(ADMIN_STATE.classification_rules.length)}</div></div>
      </div>
      <details class="adc-details">
        <summary>Show recent learned patterns (latest 50)</summary>
        <div class="body">
          <div class="adc-table-wrap" style="max-height:340px;"><table class="adc-table"><thead><tr>
            <th>Pattern ID</th><th>Table</th><th>Decision</th><th>Classification</th><th>Match</th><th>Source</th>
          </tr></thead><tbody>
          ${learnRules.length ? learnRules.map(p=>`<tr>
            <td>${esc(p.rule_id||p.pattern_id||'—')}</td>
            <td>${esc(p.table||'')}</td>
            <td>${esc(p.decision||'')}</td>
            <td>${esc(p.new_classification||p.classification||'')}</td>
            <td>${esc(JSON.stringify(p.match||{}).slice(0,140))}</td>
            <td>${esc(p.source||'')}</td>
          </tr>`).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);">No learned patterns yet. Use Save &amp; Learn on a row to record one.</td></tr>'}
          </tbody></table></div>
        </div>
      </details>

      <h3 style="margin:18px 0 6px;font-size:0.92rem;color:var(--text);">Admin Decision History (Audit Trail)</h3>
      <div class="adc-log-summary">
        <div class="adc-stat"><div class="lbl">Audit entries</div><div class="val">${fmtNum(ADMIN_STATE.audit_trail.length)}</div></div>
        <div class="adc-stat"><div class="lbl">Decisions (grant)</div><div class="val">${fmtNum(ADMIN_STATE.decisions.size)}</div></div>
        <div class="adc-stat"><div class="lbl">Decisions (issue)</div><div class="val">${fmtNum(ADMIN_STATE.issue_decisions.size)}</div></div>
        <div class="adc-stat"><div class="lbl">Learning events</div><div class="val">${fmtNum(ADMIN_STATE.learning_events.length)}</div></div>
      </div>
      <details class="adc-details">
        <summary>Show audit trail (latest 100 entries)</summary>
        <div class="body">
          <div class="adc-table-wrap" style="max-height:340px;"><table class="adc-table"><thead><tr>
            <th>Audit ID</th><th>Timestamp</th><th>Kind</th><th>Grant / Issue</th><th>Decision</th><th>New Class</th><th>Notes</th>
          </tr></thead><tbody>
          ${decisionRows.length ? decisionRows.map(r=>`<tr>
            <td>${esc(r.audit_id||'')}</td>
            <td>${esc(r.timestamp||'')}</td>
            <td>${esc(r.kind||'')}</td>
            <td>${esc(r.grant_id||r.issue_id||'')}</td>
            <td>${esc(r.decision||'')}</td>
            <td>${esc(r.new_classification||'')}</td>
            <td>${esc((r.notes||'').slice(0,80))}</td>
          </tr>`).join('') : '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);">No admin decisions yet.</td></tr>'}
          </tbody></table></div>
        </div>
      </details>

      <h3 style="margin:18px 0 6px;font-size:0.92rem;color:var(--text);">Admin Notifications</h3>
      <details class="adc-details" open>
        <summary>${ADMIN_STATE.notifications.filter(n=>!n.viewed).length} unread · ${ADMIN_STATE.notifications.length} total</summary>
        <div class="body" id="adcNotifList">${ADMIN_STATE.notifications.map(renderNotifRow).join('')}</div>
      </details>
    </div>`;

  // Wire auto-resolved details lazily on open
  $('log-auto-details').addEventListener('toggle', () => {
    if($('log-auto-details').open) renderAutoLogDetails();
  });

  // Wire notification actions
  host.querySelectorAll('[data-notif-id]').forEach(div => {
    const id = div.dataset.notifId;
    div.querySelector('.notif-view')?.addEventListener('click', () => {
      const n = ADMIN_STATE.notifications.find(x=>x.notification_id===id); if(n){ n.viewed=true; renderLogs(); }
    });
    div.querySelector('.notif-resolve')?.addEventListener('click', () => {
      const n = ADMIN_STATE.notifications.find(x=>x.notification_id===id);
      if(n){ n.resolved=true; n.viewed=true; n.status='resolved'; renderLogs(); }
    });
  });
}

const AL_STATE = {page:1, perPage:50};
function renderAutoLogDetails(){
  const host = $('log-auto-body'); if(!host) return;
  // Use JLO continuous log when available (11,866 rows incl. first + second + JLO).
  const rows = (JLO_AUTO_LOG && JLO_AUTO_LOG.length) ? JLO_AUTO_LOG : SP_AUTO_LOG;
  const pg = paginate(rows, AL_STATE.page, AL_STATE.perPage);
  AL_STATE.page = pg.page;
  host.innerHTML = `
    <div class="adc-table-wrap" style="max-height:420px;"><table class="adc-table"><thead><tr>
      <th>Record ID</th><th>Date/Time</th><th>Pass</th><th>Original</th><th>New</th>
      <th>Conf.</th><th>Method</th><th>Reason</th><th>Source / PP URL</th><th>Engine</th><th>Admin Override</th>
    </tr></thead><tbody>
    ${pg.rows.map(r=>{
      const ov = ADMIN_STATE.decisions.get(r.grant_id) || r.admin_override===true;
      return `<tr>
        <td>${esc(r.grant_id||'')}</td>
        <td>${esc(r.resolution_timestamp||'')}</td>
        <td>${esc(r.resolution_pass||'')}</td>
        <td>${esc(r.original_classification||'')}</td>
        <td>${esc(r.new_classification||'')}</td>
        <td><span class="adc-badge ${esc(typeof r.confidence==='number' ? (r.confidence>=85?'high':r.confidence>=70?'medium':'low') : ((r.confidence||'low').toString().toLowerCase()))}">${esc(r.confidence||'')}</span></td>
        <td>${esc(r.method||'')}</td>
        <td title="${esc(r.reason||'')}">${esc((r.reason||'').slice(0,90))}</td>
        <td>${r.pp_url ? `<a href="${esc(r.pp_url)}" target="_blank" rel="noopener" style="color:#a5b4fc;">ProPublica</a>` : esc(r.source_entity||'')}</td>
        <td>${esc(r.engine_version||'')}</td>
        <td>${ov?'<span class="adc-status-pill saved">Yes</span>':'<span class="adc-status-pill pending">No</span>'}</td>
      </tr>`;
    }).join('')}
    </tbody></table></div>
    <div style="margin-top:10px;">${renderPager(pg)}</div>`;
  wirePager(host, p=>{AL_STATE.page=p;renderAutoLogDetails();});
}

function renderNotifRow(n){
  const cls = `adc-notif ${n.severity} ${!n.viewed?'unread':''}`;
  return `<div class="${cls}" data-notif-id="${esc(n.notification_id)}">
    <div class="dot"></div>
    <div>
      <div class="ttl">${esc(n.title)} <span class="adc-badge ${n.severity}">${esc(n.severity)}</span></div>
      <div class="smry">${esc(n.summary)}</div>
      <div class="meta">${esc(n.notification_id)} · ${esc(n.timestamp)} · ${esc(n.section)} · ${esc(n.alert_type)} · ${n.resolved?'<strong style="color:#a7f3d0;">resolved</strong>':n.viewed?'viewed':'<strong style="color:#fcd34d;">new</strong>'}</div>
      <div class="meta" style="margin-top:4px;"><strong>Action required:</strong> ${esc(n.action_required||'—')}</div>
    </div>
    <div class="acts">
      ${!n.viewed?'<button class="adc-btn notif-view">Mark viewed</button>':''}
      ${!n.resolved?'<button class="adc-btn primary notif-resolve">Resolve</button>':''}
    </div>
  </div>`;
}

// ╔════════════════════════════════════════════════════════════════════════════╗
// ║ 9. ADMIN EXPORT BUNDLE                                                     ║
// ╚════════════════════════════════════════════════════════════════════════════╝
function downloadCsv(filename, rows){
  if(!rows || !rows.length){ alert('No rows to export.'); return; }
  const cols = [...rows.reduce((s,r) => { Object.keys(r||{}).forEach(k=>s.add(k)); return s; }, new Set())];
  const esc2 = v => { if(v==null) return ''; const s=String(v).replace(/"/g,'""'); return /[,"\n]/.test(s)?`"${s}"`:s; };
  const csv = [cols.join(',')].concat(rows.map(r => cols.map(c => esc2(r[c])).join(','))).join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function downloadJson(filename, payload){
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function downloadText(filename, text, type){
  const blob = new Blob([text], {type:type||'text/plain'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function buildExportPayloads(){
  const ts = new Date().toISOString().replace(/[:.]/g,'-');
  return {
    ts,
    full_cleaned_dataset: SP_CLASS,
    full_raw_dataset: window.PHASE2_CEF_GRANTS_SECOND_PASS || [],
    classified_grants: SP_CLASS,
    unresolved_review_queue: SP_UNRESOLVED,
    admin_decision_log: [...ADMIN_STATE.decisions.values()].concat([...ADMIN_STATE.issue_decisions.values()]),
    auto_resolved_log: (JLO_AUTO_LOG && JLO_AUTO_LOG.length) ? JLO_AUTO_LOG : SP_AUTO_LOG,
    // ── JLO bundle additions (Phase 2 CEF scope only — legacy, retained for handoff) ──
    jewish_linkage_classifications: JLO_CLASS,
    jewish_linkage_grants: JLO_GRANTS,
    jewish_linkage_recipients: JLO_RECIPIENTS,
    jewish_linkage_review_queue: JLO_REVIEW,
    jewish_linkage_auto_log_continuous: JLO_AUTO_LOG,
    jewish_linkage_top_candidates_admin_only: JLO_TOP_CAND,
    jewish_linkage_version_history: (JLO_VER_HISTORY && JLO_VER_HISTORY.versions) || [],
    jewish_linkage_meta: JLO_META,
    // ── Full-Dashboard JLO additions (Foundation + Federation + CEF, 360,508 rows) ──
    fd_jlo_recipients_verification: FDJ_RECIPIENTS,
    fd_jlo_review_queue: FDJ_REVIEW,
    fd_jlo_mixed_partial_queue: FDJ_MIXED,
    fd_jlo_top_candidates_admin_only: FDJ_TOP_CAND,
    fd_jlo_version_history: (FDJ_VER_HISTORY && (FDJ_VER_HISTORY.history || FDJ_VER_HISTORY.versions)) || [],
    fd_jlo_meta: FDJ_META,
    fd_jlo_static_exports: FDJ_STATIC_EXPORTS,
    cef_dataset: CEF_RECORDS,
    foundation_federation_list: (window.DATA&&window.DATA.foundations) || [],
    top_500_jewish_recipients: (window.JEWISH_RECIPIENTS_LIST||window.JEWISH_RECIPIENTS||[]).slice(0,500),
    classification_review_rows: ROUTED.classification,
    allocation_review_rows:     ROUTED.allocation,
    intermediary_review_rows:   ROUTED.intermediary,
    duplicate_review_rows:      ROUTED.duplicate,
    policy_review_rows:         ROUTED.policy,
    notifications_alerts_log: ADMIN_STATE.notifications,
    source_evidence_table: SP_ENRICH_EVI,
    audit_trail: ADMIN_STATE.audit_trail,
    learning_events: ADMIN_STATE.learning_events,
    pattern_library: ADMIN_STATE.pattern_library,
    dashboard_metrics_summary: {
      ...recomputeMetrics(),
      irs_enrichment:SP_REPORT,
      dashboard_version:ADMIN_STATE.dashboard_version,
      engine_version: EFFECTIVE_ENGINE_VER,
      fd_jlo_scope: HAS_FD_JLO ? {
        engine_version: EFFECTIVE_ENGINE_VER,
        total_rows_processed: FDJ_SUMMARY.total_rows_processed || 360508,
        total_recipients_evaluated: FDJ_SUMMARY.total_recipients_evaluated || 46699,
        jewish_grants_total: FDJ_SUMMARY.jewish_grants_total || 122763,
        non_jewish_grants_total: FDJ_SUMMARY.non_jewish_grants_total || 197854,
        unclear_review_total: FDJ_SUMMARY.unclear_review_total || 39820,
        mixed_partial_review_count: FDJ_SUMMARY.mixed_partial_review_count || 71,
        auto_resolved_count: FDJ_SUMMARY.auto_resolved_count || 320617,
        auto_resolved_log_rows: FDJ_SUMMARY.auto_resolved_log_rows || 324246,
        false_positive_corrections: FDJ_SUMMARY.false_positive_corrections || 9833,
        review_queue_full_count: FDJ_SUMMARY.review_queue_full_count || 39891,
        top_jewish_candidates: (FDJ_META && FDJ_META.top_candidates && FDJ_META.top_candidates.total) || 14074,
        layer_counts: FDJ_LAYERS
      } : null,
      timestamp:nowIso(),
      session_id:ADMIN_STATE.session_id
    },
    version_history: ADMIN_STATE.version_history.concat([
      {version:ADMIN_STATE.dashboard_version, timestamp:nowIso(), description:'Simplified decision-table Admin build'},
      {version: JLO_ENGINE_VER, timestamp: (JLO_META&&JLO_META.generated)||'2026-05-14T00:00:00Z',
       description: 'Jewish Linkage Override (JLO) v1 — recipient-level overriding classification engine. Applied to Phase 2 CEF grants only (9,339 rows; 8,246 recipients). Corrected 1,158 false positives from prior second_pass_v1.0 "ou" substring keyword bug (e.g. ACLU Foundation, Barack Obama Foundation no longer classified Jewish). Final classification counts: Jewish 2,900; Non-Jewish 3,556; Unclear/Needs Review 2,812; Mixed/Partial 71. Auto-resolved this pass 6,456 at confidence ≥ 75. Review queue 2,883 routed to existing Jewish / Non-Jewish (+ Mixed / Partial) review panels. Continuous auto-resolved log: 11,866 rows (first + second + JLO).'}
    ].concat(HAS_FD_JLO ? [{
      version: EFFECTIVE_ENGINE_VER,
      timestamp: (FDJ_META && FDJ_META.generated) || '2026-05-14T00:00:00Z',
      description: `Full-Dashboard Jewish Linkage Override — recipient-level overriding classification engine applied dashboard-wide across Foundation (${fmtNum(((FDJ_LAYERS.foundation||{}).total)||326217)}), Federation (${fmtNum(((FDJ_LAYERS.federation||{}).total)||24952)}), and CEF (${fmtNum(((FDJ_LAYERS.community_endowment_fund||{}).total)||9339)}) layers — ${fmtNum(FDJ_SUMMARY.total_rows_processed||360508)} grants across ${fmtNum(FDJ_SUMMARY.total_recipients_evaluated||46699)} unique recipients. Word-boundary regex over 50+ Jewish keywords; canonical Top-400 matches restricted to orgs with Jewish name signals; original J/NJ flags used as corroboration only. Corrected ${fmtNum(FDJ_SUMMARY.false_positive_corrections||9833)} false positives from prior keyword bugs. Final counts: Jewish ${fmtNum(FDJ_SUMMARY.jewish_grants_total||122763)} (34.1%); Non-Jewish ${fmtNum(FDJ_SUMMARY.non_jewish_grants_total||197854)} (54.9%); Unclear/Review ${fmtNum(FDJ_SUMMARY.unclear_review_total||39820)} (11.0%); Mixed/Partial ${fmtNum(FDJ_SUMMARY.mixed_partial_review_count||71)}. Auto-resolved ${fmtNum(FDJ_SUMMARY.auto_resolved_count||320617)} at confidence ≥ 75 (88.9%). Review queue ${fmtNum(FDJ_SUMMARY.review_queue_full_count||39891)} routed to existing review panels (no new panels created). ${fmtNum(((FDJ_META&&FDJ_META.top_candidates&&FDJ_META.top_candidates.total)||14074))} top Jewish candidates exposed Admin-only via Export Bundle. Canonical public Top-400 lock preserved — jewish_recipients.js / public Top tables unchanged.`
    }] : []))
  };
}

function renderExportBundle(){
  const host = $('adminExportBundle'); if(!host) return;
  // Build item list — when FD JLO is loaded, prefer its top-level rows and
  // demote the legacy Phase-2 CEF JLO entries to the bottom (still exported
  // for handoff continuity).
  const fdItems = HAS_FD_JLO ? [
    ['fd_jlo_recipients_verification', `Full-Dashboard JLO recipient verification (${fmtNum(FDJ_RECIPIENTS.length||46699)})`],
    ['fd_jlo_review_queue', `Full-Dashboard JLO review queue (${fmtNum(FDJ_REVIEW.length||39891)} slim rows)`],
    ['fd_jlo_mixed_partial_queue', `Full-Dashboard JLO mixed / partial queue (${fmtNum(FDJ_MIXED.length||71)})`],
    ['fd_jlo_top_candidates_admin_only', `Full-Dashboard JLO top Jewish candidates — admin only (${fmtNum(FDJ_TOP_CAND.length||14074)})`],
    ['fd_jlo_version_history', 'Full-Dashboard JLO version history'],
    ['fd_jlo_meta', 'Full-Dashboard JLO meta / layer counts / static export index']
  ] : [];
  const items = [
    ['full_cleaned_dataset', 'Full cleaned dataset'],
    ['full_raw_dataset', 'Full raw dataset'],
    ['classified_grants', 'Classified grants'],
    ['unresolved_review_queue', 'Unresolved review queue'],
    ['admin_decision_log', 'Admin decision log'],
    ['auto_resolved_log', 'Auto-resolved classification log'],
    ['cef_dataset', 'CEF dataset'],
    ['foundation_federation_list', 'Foundation / Federation list'],
    ['top_500_jewish_recipients', 'Top 500 Jewish recipients (canonical — locked)'],
    ['classification_review_rows','Jewish / Non-Jewish review rows'],
    ['allocation_review_rows','Mixed / Partial allocation rows'],
    ...fdItems,
    ['jewish_linkage_classifications','Legacy JLO classifications (Phase 2 CEF, 9,339)'],
    ['jewish_linkage_grants','Legacy JLO grants classified (Phase 2 CEF, 9,339)'],
    ['jewish_linkage_recipients','Legacy JLO recipient linkage verification (8,246)'],
    ['jewish_linkage_review_queue','Legacy JLO review queue (2,883)'],
    ['jewish_linkage_auto_log_continuous','Legacy JLO auto-resolved log continuous (11,866)'],
    ['jewish_linkage_top_candidates_admin_only','Legacy JLO top candidates — admin only (2,611)'],
    ['jewish_linkage_version_history','Legacy JLO engine version history'],
    ['jewish_linkage_meta','Legacy JLO meta / applied counts'],
    ['intermediary_review_rows','Intermediary / DAF / CEF rows'],
    ['duplicate_review_rows','Duplicate / Double-counting rows'],
    ['policy_review_rows','Policy review rows'],
    ['notifications_alerts_log', 'Notifications / Alerts log'],
    ['source_evidence_table', 'Source evidence table'],
    ['audit_trail', 'Audit trail'],
    ['learning_events','Learning events'],
    ['pattern_library','Pattern library'],
    ['dashboard_metrics_summary', 'Dashboard metrics summary'],
    ['version_history', 'Version history']
  ];
  // Static download links — full classifications (360k), normalized rows, full
  // auto-resolved log (324k), and source markdown/json are shipped as files
  // under fd_jlo_exports/ and never loaded into memory.
  const staticLinks = HAS_FD_JLO && FDJ_STATIC_EXPORTS.length ? `
      <h3 style="margin:18px 0 6px;font-size:0.92rem;color:var(--text);">Full-Dashboard JLO static downloads</h3>
      <div class="adc-sub" style="font-size:0.83rem;margin-bottom:8px;">Large CSV/JSON artefacts hosted alongside the dashboard (not loaded into memory). Right-click → Save link as, or click to open.</div>
      <div class="adc-table-wrap"><table class="adc-table"><thead><tr><th>File</th><th>Size</th><th>Download</th></tr></thead><tbody>
      ${FDJ_STATIC_EXPORTS.map(f => {
        const sizeMb = f.size_bytes ? (f.size_bytes/1024/1024).toFixed(1) + ' MB' : '—';
        const url = f.url || `fd_jlo_exports/${f.file||f.filename||''}`;
        const label = f.label || f.file || f.filename || url;
        return `<tr><td>${esc(label)}</td><td class="num">${esc(sizeMb)}</td><td><a class="adc-btn" href="${esc(url)}" download>Download</a></td></tr>`;
      }).join('')}
      </tbody></table></div>` : '';
  host.innerHTML = `
    <div class="adc-panel" id="sec-export">
      <h2>Admin Export Bundle · Full Dashboard</h2>
      <div class="adc-sub">Download every dashboard slice as CSV or JSON, plus a printable PDF summary. Bundle includes timestamp, dashboard version, and current admin decisions/audit state. No decision-making needed here.${HAS_FD_JLO ? ` <strong>Full-Dashboard JLO ${esc(EFFECTIVE_ENGINE_VER)}</strong> applied across ${fmtNum(FDJ_SUMMARY.total_rows_processed||360508)} grants — large CSVs (full classifications 360k, full auto-resolved log 324k) are shipped as static downloads below to preserve page performance.` : ''}</div>
      <div class="adc-toolbar">
        <button class="adc-btn primary" id="expAllCsv" data-testid="btn-export-all-csv">Export ALL as CSV</button>
        <button class="adc-btn primary" id="expAllJson" data-testid="btn-export-all-json">Export ALL as JSON bundle</button>
        <button class="adc-btn" id="expPdfSummary">Generate printable PDF summary</button>
        <span style="font-size:0.7rem;color:var(--text-muted);margin-left:auto;">Dashboard version: ${esc(ADMIN_STATE.dashboard_version)} · Engine: ${esc(EFFECTIVE_ENGINE_VER)}</span>
      </div>
      <div class="adc-table-wrap"><table class="adc-table"><thead><tr><th>Section</th><th>Rows</th><th>CSV</th><th>JSON</th></tr></thead><tbody id="expBundleBody"></tbody></table></div>
      ${staticLinks}
    </div>`;
  const payloads = buildExportPayloads();
  $('expBundleBody').innerHTML = items.map(([k,lbl]) => {
    const arr = Array.isArray(payloads[k]) ? payloads[k] : [payloads[k]];
    return `<tr>
      <td>${esc(lbl)}</td>
      <td class="num">${(arr||[]).length.toLocaleString()}</td>
      <td><button class="adc-btn" data-csv="${k}">CSV</button></td>
      <td><button class="adc-btn" data-json="${k}">JSON</button></td>
    </tr>`;
  }).join('');
  host.querySelectorAll('[data-csv]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.csv; const p = buildExportPayloads();
    const arr = Array.isArray(p[k]) ? p[k] : [p[k]];
    downloadCsv(`atlas_${k}_${p.ts}.csv`, arr);
  }));
  host.querySelectorAll('[data-json]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.json; const p = buildExportPayloads();
    downloadJson(`atlas_${k}_${p.ts}.json`, p[k]);
  }));
  $('expAllJson').addEventListener('click', () => {
    const p = buildExportPayloads();
    downloadJson(`atlas_admin_export_bundle_${p.ts}.json`, p);
    pushNotification({severity:'info', section:'Admin Export Bundle', alert_type:'export_ready',
      title:'Export bundle generated (JSON)', summary:`Full dashboard JSON bundle generated at ${p.ts}.`,
      action_required:'Archive bundle for compliance / handoff.'});
    renderLogs();
  });
  $('expAllCsv').addEventListener('click', () => {
    const p = buildExportPayloads();
    items.forEach(([k]) => {
      const arr = Array.isArray(p[k]) ? p[k] : [p[k]];
      downloadCsv(`atlas_${k}_${p.ts}.csv`, arr);
    });
    pushNotification({severity:'info', section:'Admin Export Bundle', alert_type:'export_ready',
      title:'Export bundle generated (CSV)', summary:`All sections exported as CSV files at ${p.ts}.`,
      action_required:'Archive bundle for compliance / handoff.'});
    renderLogs();
  });
  $('expPdfSummary').addEventListener('click', () => {
    const p = buildExportPayloads();
    const text = renderPdfSummaryText(p);
    const w = window.open('', '_blank');
    w.document.write(`<pre style="font-family:Menlo,Consolas,monospace;font-size:11px;white-space:pre-wrap;">${esc(text)}</pre>`);
    w.document.close();
    setTimeout(()=>{ try{ w.print(); }catch(e){} }, 250);
    downloadText(`atlas_dashboard_summary_${p.ts}.txt`, text, 'text/plain');
  });
}
function renderPdfSummaryText(p){
  const m = recomputeMetrics();
  const ap = JLO_APPLIED || {};
  const fdSection = HAS_FD_JLO ? `
— FULL-DASHBOARD JEWISH LINKAGE OVERRIDE (engine ${EFFECTIVE_ENGINE_VER}) —
Scope:            Full dashboard — Foundation + Federation + CEF layers
Total rows:       ${(FDJ_SUMMARY.total_rows_processed||360508).toLocaleString()}
Unique recipients:${(FDJ_SUMMARY.total_recipients_evaluated||46699).toLocaleString()}
Jewish:           ${(FDJ_SUMMARY.jewish_grants_total||122763).toLocaleString()} (34.1%)
Non-Jewish:       ${(FDJ_SUMMARY.non_jewish_grants_total||197854).toLocaleString()} (54.9%)
Unclear/Review:   ${(FDJ_SUMMARY.unclear_review_total||39820).toLocaleString()} (11.0%)
Mixed / Partial:  ${(FDJ_SUMMARY.mixed_partial_review_count||71).toLocaleString()}
Auto-resolved:    ${(FDJ_SUMMARY.auto_resolved_count||320617).toLocaleString()} (88.9% at confidence ≥ 75)
Auto-resolved log:${(FDJ_SUMMARY.auto_resolved_log_rows||324246).toLocaleString()} rows (shipped as static CSV)
Review queue:     ${(FDJ_SUMMARY.review_queue_full_count||39891).toLocaleString()} (routed to existing review panels, 25/page)
Top Jewish candidates: ${((FDJ_META&&FDJ_META.top_candidates&&FDJ_META.top_candidates.total)||14074).toLocaleString()} (Admin-only; canonical Top-400 untouched)
False positives corrected: ${(FDJ_SUMMARY.false_positive_corrections||9833).toLocaleString()}

Layer breakdown:
  Foundation:  ${(((FDJ_LAYERS.foundation||{}).total)||326217).toLocaleString()} rows — Jewish ${(((FDJ_LAYERS.foundation||{}).jewish)||106138).toLocaleString()} / NJ ${(((FDJ_LAYERS.foundation||{}).non_jewish)||193633).toLocaleString()} / Review ${(((FDJ_LAYERS.foundation||{}).review)||26446).toLocaleString()}
  Federation:  ${(((FDJ_LAYERS.federation||{}).total)||24952).toLocaleString()} rows — Jewish ${(((FDJ_LAYERS.federation||{}).jewish)||13725).toLocaleString()} / NJ ${(((FDJ_LAYERS.federation||{}).non_jewish)||665).toLocaleString()} / Review ${(((FDJ_LAYERS.federation||{}).review)||10562).toLocaleString()}
  CEF:         ${(((FDJ_LAYERS.community_endowment_fund||{}).total)||9339).toLocaleString()} rows — Jewish ${(((FDJ_LAYERS.community_endowment_fund||{}).jewish)||2900).toLocaleString()} / NJ ${(((FDJ_LAYERS.community_endowment_fund||{}).non_jewish)||3556).toLocaleString()} / Review ${(((FDJ_LAYERS.community_endowment_fund||{}).review)||2812).toLocaleString()} / Mixed ${(((FDJ_LAYERS.community_endowment_fund||{}).mixed)||71).toLocaleString()}
` : '';
  return `ATLAS · PHILANTHROPIC INTELLIGENCE PLATFORM
Admin Export Bundle Summary (Simplified Decision Tables)
Dashboard version: ${ADMIN_STATE.dashboard_version}
Engine version:    ${EFFECTIVE_ENGINE_VER}
Generated: ${p.ts}
Session: ${ADMIN_STATE.session_id}

— CLASSIFICATION TOTALS (overall dashboard, all foundations) —
Jewish:        ${m.Jewish.toLocaleString()}
Non-Jewish:    ${m.NonJewish.toLocaleString()}
Need Research: ${m.NeedResearch.toLocaleString()}
Mixed:         ${m.Mixed.toLocaleString()}
Excluded:      ${m.Excluded.toLocaleString()}
Total grants:  ${m.Total.toLocaleString()}
${fdSection}
— LEGACY JEWISH LINKAGE OVERRIDE (Phase 2 CEF scope only) —
Engine version:   ${JLO_ENGINE_VER}
Grants processed: ${(ap.grants_processed||9339).toLocaleString()} (zero dropped)
Recipients eval.: ${(ap.recipients_evaluated||8246).toLocaleString()}
Jewish:           ${(ap.final_jewish_grants||2900).toLocaleString()}
Non-Jewish:       ${(ap.final_nonjewish_grants||3556).toLocaleString()}
Unclear:          ${(ap.final_unclear_needs_review||2812).toLocaleString()}
Mixed / Partial:  ${(ap.final_mixed_partial||71).toLocaleString()}
Auto-resolved:    ${(ap.auto_resolved_this_pass||6456).toLocaleString()} (all confidence ≥ 75)
Review queue:     ${(ap.review_queue_admin||2883).toLocaleString()} (routed to existing Jewish / Non-Jewish + Mixed / Partial review panels)
Continuous auto-log: ${(ap.continuous_auto_log_rows||11866).toLocaleString()} rows (first + second + JLO)
False positives corrected: 1,158 (prior "ou" substring bug)

— FOCUSED DECISION TABLES (rows routed) —
Jewish / Non-Jewish Classification: ${ROUTED.classification.length.toLocaleString()}
Mixed / Partial Allocation:         ${ROUTED.allocation.length.toLocaleString()}
Intermediary / DAF / CEF:           ${ROUTED.intermediary.length.toLocaleString()}
Duplicate / Double-Counting:        ${ROUTED.duplicate.length.toLocaleString()}
Policy Review / Edge Cases:         ${ROUTED.policy.length.toLocaleString()}

— ADMIN ACTIVITY —
Decisions (grant): ${ADMIN_STATE.decisions.size.toLocaleString()}
Decisions (issue): ${ADMIN_STATE.issue_decisions.size.toLocaleString()}
Audit entries:     ${ADMIN_STATE.audit_trail.length.toLocaleString()}
Learning events:   ${ADMIN_STATE.learning_events.length.toLocaleString()}
New rules this session: ${ADMIN_STATE.new_learning_rules_session}
Patterns:          ${ADMIN_STATE.pattern_library.length.toLocaleString()}
Notifications:     ${ADMIN_STATE.notifications.length.toLocaleString()} (${ADMIN_STATE.notifications.filter(n=>!n.viewed).length} unread)

Generated by ATLAS Admin Decision Center · in-session export.
`;
}

// ╔════════════════════════════════════════════════════════════════════════════╗
// ║ USER / ADMIN GUIDE (updated for simplified decision-table structure)       ║
// ╚════════════════════════════════════════════════════════════════════════════╝
const GUIDE_SECTIONS = [
  {id:'guide-overview', title:'Admin Review & Decision Center', body:{
    purpose:'Centralized Admin workspace organized by decision type, not by data source. Each focused table contains only the records and decisions that belong to one decision mindset.',
    how_to_use:'Start at the Admin Action Summary. Click the card for the kind of decision you want to work on. Stay in that mindset until you finish or pause. Use Save for one-off decisions; use Save & Learn when the engine should learn the rule.',
    decision_required:'Yes — across the focused tables.',
    after_decision:'Audit trail entry + (optional) learning event + canonical classification updated + dashboard metrics recalculated + summary counts refreshed.',
    learning:'Save & Learn writes a pattern keyed on recipient, EIN, category, and the decision table. After 25 events the engine surfaces an approval banner.',
    notes:'Top 500 Jewish Recipients restored from canonical dataset. The public Top 500 panel and its drilldown read from a locked canonical snapshot (CANON_JRL / CANON_JRD / CANON_JRG) so it matches the reference hosted version. Phase 2 / CEF augmentation and entity-layer filters still drive the Admin review queues and exports. Each focused decision table now also explains why the engine could not classify the records routed to it.'
  }},
  {id:'guide-fd-jlo', title:'Full-Dashboard JLO (Engine 2.0.0 — dashboard-wide)', body:{
    purpose:'The Full-Dashboard Jewish Linkage Override engine (2.0.0-full-dashboard) is the canonical classification layer across the entire dashboard. It evaluates 360,508 grants spanning 46,699 unique recipients across the Foundation (326,217), Federation (24,952), and CEF (9,339) layers and applies the recipient-level override rule uniformly.',
    how_to_use:'Use Overview to see scope and layer counts. Use the Jewish / Non-Jewish Classification Review panel to clear the ~39,820 unresolved unique-recipient rows (paginated 25/page so the queue stays responsive). The 71 mixed/partial rows route to the Mixed / Partial Allocation Review panel. Top Jewish candidates (14,074) are exposed Admin-only via the Export Bundle.',
    decision_required:'Yes — admin review on the routed rows only. Auto-resolved rows (320,617) do not need review.',
    after_decision:'Same as the focused decision tables — canonical classification updated, audit trail entry, optional learning pattern.',
    learning:'Save & Learn on any routed row writes a pattern that re-applies on similar future rows when the engine re-runs.',
    why_not_classified:'Records land in the review queue because recipient evidence was insufficient or conflicting. The Foundation and Federation layers have NO EINs (a known data limitation — future enrichment target), which forces classification onto name and purpose signals alone. Records also land here when canonical Top-400 matches lack a Jewish name signal (canonical match alone is no longer auto-Jewish without corroborating name evidence) or when the original Jewish/Non-Jewish flag conflicts with the recipient name and is therefore treated as corroboration only, not authority.',
    notes:'Override rule (applied dashboard-wide): if a grant is to a verified Jewish organization, classify the grant as Jewish — this supersedes other classification rules. The classifier uses word-boundary regex over 50+ keywords (no more "ou" substring false positives), restricts canonical Top-400 matches to orgs with Jewish name signals, and uses original J/NJ flags as corroboration only. False-positive corrections from prior keyword bugs: 9,833. Canonical public Top-400/Top-500 is preserved untouched — jewish_recipients.js and the public Top tables are NOT replaced with Full-Dashboard candidates. Large artefacts (full 360,508-row classifications CSV, full 324,246-row auto-resolved log, normalized rows) are shipped as static downloads from fd_jlo_exports/ to preserve page performance — they are NOT loaded into memory.',
    bullets:[
      'Scope: full dashboard — Foundation 326,217 + Federation 24,952 + CEF 9,339 = 360,508 grants across 46,699 unique recipients.',
      'Final counts: Jewish 122,763 (34.1%) / Non-Jewish 197,854 (54.9%) / Unclear-Review 39,820 (11.0%) / Mixed-Partial 71.',
      'Auto-resolved: 320,617 grants at confidence ≥ 75 (88.9%).',
      'Review queue: 39,891 rows routed to existing Jewish / Non-Jewish Classification Review panel (25/page pagination).',
      'Mixed/partial: 71 rows routed to existing Mixed / Partial Allocation Review panel — no new panels were created.',
      'Top candidates: 14,074 (Admin-only) — 589 already on the canonical Top-400; 13,485 are new candidates requiring admin promotion before any public exposure.',
      'Engine artefacts shipped to fd_jlo_exports/: full 360,508-row classifications CSV (233 MB), full 324,246-row auto-resolved log CSV, normalized rows CSV, source markdown report/handoff.',
      'Future enrichment need: Foundation and Federation layers have no EINs, which is the largest reason they dominate the review queue. EIN/NTEE enrichment for these layers should be the next priority to compress the queue.'
    ]
  }},
  {id:'guide-save-learn', title:'Save vs Save & Learn', body:{
    bullets:[
      'Save: Applies this decision only to the selected record.',
      'Save & Learn: Applies this decision, updates the learning engine, creates or improves a rule, applies the pattern to similar future records when appropriate, updates logs, and recalculates affected dashboard metrics.'
    ]
  }},
  {id:'guide-classification', title:'Jewish / Non-Jewish Classification Review', body:{
    purpose:'The simplest and most common decision. Confirm whether a recipient/grant is Jewish-aligned or Non-Jewish, ask for more research, or send it to Policy Review. This panel is for recipient Jewish-linkage decisions: if the recipient organization has Jewish linkage, association, philosophy, mission, or serves Jewish people / communities, the grant should be classified as Jewish.',
    how_to_use:'Review recipient name, EIN/NTEE evidence, grant purpose, keywords, JLO linkage status / confidence, and source notes. Pick one of the 4 allowed decisions, then Save or Save & Learn.',
    decision_required:'Yes.',
    after_decision:'Updates canonical classification and audit trail. If Save & Learn, also writes a pattern.',
    learning:'Yes.',
    why_not_classified:'Records land here because the recipient evidence was insufficient or conflicting: missing or weak EIN / NTEE that does not map cleanly to a Jewish or non-Jewish category, a vague grant purpose ("general support", "program support") with no Jewish-specific signal, a generic recipient name that matches both Jewish and non-Jewish organizations, conflicting cues across sources, only weak keyword hits below the engine\u2019s confidence threshold, recipient-level Jewish linkage that is unclear / unverified, or known false positives from the prior second_pass_v1.0 "ou" substring bug (JLO moved 1,158 such records here for admin verification).',
    notes:'Allowed decisions: Jewish / Jewish-Aligned; Non-Jewish; Unclear — Needs More Research; Send to Policy Review. Override rule (JLO): if the grant is to a verified Jewish organization, classify Jewish unless an explicit policy exception applies. Mixed / Partial routes to the existing Mixed / Partial Allocation Review panel.'
  }},
  {id:'guide-allocation', title:'Mixed / Partial Allocation Review', body:{
    purpose:'For grants where part may be Jewish-aligned and part not. Decide whether to count full, partial, or exclude.',
    how_to_use:'Enter a Jewish amount or % when Count Partial is chosen. Otherwise pick Count Full, Exclude, or Unclear.',
    decision_required:'Yes.',
    after_decision:'If Count Partial, the percentage/amount is stored on the decision record. Mixed classifications enter the Mixed bucket.',
    learning:'Yes.',
    why_not_classified:'Records land here because the grant appears to support both Jewish-aligned and general purposes, and a single Jewish / Non-Jewish label is not safe: the purpose text does not specify how funds are split, the program spans multiple communities, the recipient is a mixed-mission institution (hospital, university, civic nonprofit with a Jewish program inside), or there is no reliable basis to infer a Jewish share automatically.',
    notes:'Allowed decisions: Count Full Amount as Jewish-Aligned; Count Partial Amount / Percentage; Exclude from Jewish Calculation; Unclear — Needs More Research.'
  }},
  {id:'guide-intermediary', title:'Intermediary / DAF / CEF Review', body:{
    purpose:'For pass-through layers, donor-advised funds, community foundations, endowments, federations, and internal funds.',
    how_to_use:'Decide whether to count the entity directly, treat it as a pass-through, count only verified final Jewish allocation, or send for more research. Open the embedded CEF reference for entity context.',
    decision_required:'Yes.',
    after_decision:'Updates canonical classification and audit trail. Pass-through decisions flow into the Excluded bucket.',
    learning:'Yes.',
    why_not_classified:'The NTEE code or name pattern flags the entity as a possible pass-through (DAF, community foundation, federation, endowment, supporting org, fiscal sponsor, internal fund), but the downstream grant distribution is not available in the public filing. The engine cannot tell whether the layer\u2019s money landed at a Jewish-aligned final recipient, a non-Jewish recipient, or a mix; counting the layer directly would risk overstating Jewish giving while excluding it entirely would risk understating it.',
    notes:'Allowed decisions: Count as Final Jewish Recipient; Treat as Intermediary / Pass-Through; Count Verified Jewish Allocation Only; Unclear — Needs More Research. Community / Endowment / Fund details live as a compact collapsible reference inside this section.'
  }},
  {id:'guide-duplicate', title:'Duplicate / Double-Counting Review', body:{
    purpose:'For duplicate recipients, parent-child issues, same EIN/name variations, and double-count risks.',
    how_to_use:'Pick from Merge / Standardize, Keep Separate, Exclude Pass-Through Layer, or Unclear — Needs More Research.',
    decision_required:'Yes.',
    after_decision:'Merge writes a Duplicate marker; Exclude sends the layer to the Excluded bucket. Audit trail entry recorded.',
    learning:'Yes.',
    why_not_classified:'The same EIN can appear under multiple spellings or DBAs; closely matching names with different EINs may be the same legal entity or distinct sister organizations; one filing shows a grant from a parent and another shows the matched payment at a subsidiary; or the same dollars show up at both a federation / CEF layer and again at the final Jewish recipient. Without admin confirmation the engine cannot safely auto-merge (risk of collapsing two distinct organizations) or auto-exclude (risk of dropping a legitimate gift).',
    notes:'Allowed decisions: Merge / Standardize Recipient; Keep Separate; Exclude Pass-Through Layer; Unclear — Needs More Research.'
  }},
  {id:'guide-policy', title:'Policy Review / Edge Cases', body:{
    purpose:'For rule/policy decisions: Israel-related but not clearly Jewish communal, interfaith, universities with Jewish studies, human rights orgs, anti-antisemitism work in non-Jewish institutions, civic orgs, mixed identity orgs, ambiguous international grants.',
    how_to_use:'Pick from Include Under Jewish-Aligned Giving, Exclude from Jewish-Aligned Giving, or Case-by-Case Review Required. Choose whether to apply the rule to similar cases.',
    decision_required:'Yes — these are dashboard rules, not single-row data fixes.',
    after_decision:'A policy decision drives how similar future cases are handled when Apply Rule = Yes.',
    learning:'Yes.',
    why_not_classified:'The evidence on the record is often sufficient; the engine cannot classify because the right answer depends on a dashboard-level policy choice. These records sit at the edge of the "Jewish-aligned giving" category \u2014 Israel-related but not at a Jewish communal organization, interfaith or multi-faith work, Jewish studies inside a general university, anti-antisemitism or human-rights work inside non-Jewish institutions, civic and mixed-identity organizations, and ambiguous international cases. A single auto-rule could be defensible either way; the engine routes here so the admin sets the policy.',
    notes:'Allowed decisions: Include Under Jewish-Aligned Giving; Exclude from Jewish-Aligned Giving; Case-by-Case Review Required.'
  }},
  {id:'guide-queued', title:'Queued / No Action Summary', body:{
    purpose:'Compact list of background queues. No full tables for queues where there is nothing to act on.',
    how_to_use:'Action buttons only appear for real actions like Run Next Pass, View Summary, Export Queue, Move to Review.',
    decision_required:'Usually no.',
    after_decision:'Counters refresh in-session.',
    learning:'No direct learning impact.'
  }},
  {id:'guide-logs', title:'Logs (Auto-Resolved, Learning, Audit)', body:{
    purpose:'Compact summaries of the auto-resolved classification log, classification learning log, and admin decision history.',
    how_to_use:'Each log shows a summary up top and a collapsible details panel below. Filters and pagination live inside the details panel.',
    decision_required:'No.',
    learning:'Indirect — overrides drive learning patterns via the focused decision tables.'
  }},
  {id:'guide-export', title:'Admin Export Bundle', body:{
    purpose:'Single download of every dashboard slice as CSV or JSON, plus a printable summary. No decision-making needed.',
    how_to_use:'Click section-level CSV/JSON buttons, or the bundle-level Export ALL buttons. PDF summary opens print preview.',
    decision_required:'No.'
  }},
  {id:'guide-learning-engine', title:'Learning Engine', body:{
    purpose:'In-session learning rules, decision history, pattern library, audit trail, version history.',
    how_to_use:'Use Save & Learn on individual rows. Patterns are written to the library, surfaced in the Logs section, and (after 25 events) trigger a re-classification approval banner.',
    decision_required:'Major rule updates require admin approval (banner appears).',
    after_decision:'Approved updates are applied by re-running the classification pass.',
    learning:'Core component.'
  }},
  {id:'guide-top500', title:'Top 500 Jewish Recipients', body:{
    purpose:'Clean, original 9-column table of the top verified Jewish / Jewish-aligned recipients. No layout changes here.',
    how_to_use:'Search and filter; no admin decisions inside this table to keep the public view clean.',
    decision_required:'No.',
    notes:'Canonical Top 400 / Top 500 locked. Restored from the canonical Top 500 dataset (jewish_recipients-30.js) so the public-facing table matches the reference hosted version. Phase 2 / CEF augmentation and entity-layer filters still apply to Admin review tables and exports, but the public Top 500 panel and its drilldown read from a canonical snapshot (CANON_JRL / CANON_JRD / CANON_JRG) and are not mutated by re-aggregation. Rule: only verified Jewish / Jewish-aligned recipients appear. Full-Dashboard JLO candidate additions (14,074 candidates from the engine — of which 589 are already in the canonical Top-400 and 13,485 are new) are exposed in Admin exports / candidate list only and require admin approval before promotion to the public Top 500. The public table is NOT replaced by Full-Dashboard candidates and the public 9-column layout is unchanged.'
  }},
  {id:'guide-decision-logic', title:'Practical Decision Logic for Admin', body:{
    bullets:[
      'If the only question is Jewish vs Non-Jewish → use the Jewish / Non-Jewish Classification table.',
      'If part of the grant is Jewish and part is not → use the Mixed / Partial Allocation table.',
      'If the recipient is a DAF, community foundation, federation, endowment, or pass-through fund → use the Intermediary / DAF / CEF table.',
      'If the row may be a duplicate or part of a money-flow chain that could double-count → use the Duplicate / Double-Counting table.',
      'If the question is a dashboard rule (Israel-only, interfaith, universities with Jewish programs, etc.) → use the Policy Review table.',
      'If you would expect this decision to apply to many similar future rows → use Save & Learn.'
    ]
  }}
];

function renderUserGuide(){
  const host = $('adminUserGuide'); if(!host) return;
  host.innerHTML = `
    <div class="adc-panel">
      <h2>User Guide / Admin Guide</h2>
      <div class="adc-sub">Inline reference for the simplified Admin Decision Center. Sections are grouped by decision type so the Admin stays in one mindset at a time.</div>
      <div class="adc-guide-toc">${GUIDE_SECTIONS.map(s=>`<a href="#${esc(s.id)}">${esc(s.title)}</a>`).join('')}</div>
      ${GUIDE_SECTIONS.map(renderGuideSection).join('')}
    </div>`;
}
function renderGuideSection(s){
  const b = s.body || {};
  const decReq = b.decision_required==null ? '' : (b.decision_required===false ? 'No' : (b.decision_required===true ? 'Yes' : esc(String(b.decision_required))));
  return `<section class="adc-guide-section" id="${esc(s.id)}">
    <h3>${esc(s.title)}</h3>
    ${b.purpose ? `<h4>Purpose</h4><p>${esc(b.purpose)}</p>` : ''}
    ${b.how_to_use ? `<h4>How to use</h4><p>${esc(b.how_to_use)}</p>` : ''}
    ${decReq ? `<h4>Admin decision required</h4><p>${decReq}</p>` : ''}
    ${b.after_decision ? `<h4>What happens after a decision</h4><p>${esc(b.after_decision)}</p>` : ''}
    ${b.learning ? `<h4>How the engine learns</h4><p>${esc(b.learning)}</p>` : ''}
    ${b.why_not_classified ? `<h4>Why the engine could not classify automatically</h4><p>${esc(b.why_not_classified)}</p>` : ''}
    ${b.notes ? `<h4>Notes</h4><p>${esc(b.notes)}</p>` : ''}
    ${b.bullets ? `<ul>${b.bullets.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>` : ''}
  </section>`;
}

// ╔════════════════════════════════════════════════════════════════════════════╗
// ║ Mount / orchestrate                                                        ║
// ╚════════════════════════════════════════════════════════════════════════════╝
function ensureMounts(){
  const adminView = document.getElementById('adminView'); if(!adminView) return;
  // Hide legacy mount points (we retain them in the DOM for export compatibility,
  // but they no longer render heavy panels).
  ['adminCefNotices','adminCefDetailsMount','adminCefReviewMount','adminCefReviewWorkflow',
   'adminCefFirstPassSummary','adminCefAutoResolvedLog','adminCefNeedResearchReduced',
   'adminCefUnresolvedQueue','adminCefExports','adminTop500ReviewQueue','adminCefDecisionLog',
   'adminIdentityQueue','adminLearningLog'
  ].forEach(id => { const el = document.getElementById(id); if(el){ el.innerHTML=''; el.hidden=true; } });

  // Required focused-decision mount order
  const order = [
    'adminActionSummary',        // 1. summary
    'adminClassificationReview', // 2. Jewish / Non-Jewish
    'adminAllocationReview',     // 3. Mixed / Partial
    'adminIntermediaryReview',   // 4. Intermediary / DAF / CEF
    'adminDuplicateReview',      // 5. Duplicate / Double-counting
    'adminPolicyReview',         // 6. Policy
    'adminQueuedSummary',        // 7. Queued / No Action
    'adminLogs',                 // 8. Logs
    'adminExportBundle',         // 9. Export Bundle
    'adminUserGuide'             // Guide
  ];
  const overviewEl = document.getElementById('adminOverview');
  let anchor = overviewEl ? overviewEl.nextSibling : adminView.firstChild;
  order.forEach(id => {
    let el = document.getElementById(id);
    if(!el){
      el = document.createElement('section');
      el.id = id;
      adminView.insertBefore(el, anchor);
      anchor = el.nextSibling;
    } else {
      adminView.insertBefore(el, anchor);
      anchor = el.nextSibling;
    }
  });
}

function renderOverview(){
  const host = document.getElementById('adminOverview'); if(!host) return;
  const m = recomputeMetrics();
  const fdAutoTotal = HAS_FD_JLO ? (FDJ_SUMMARY.auto_resolved_log_rows || FDJ_SUMMARY.auto_resolved_count || 324246) : 0;
  const fdReviewTotal = HAS_FD_JLO ? (FDJ_REVIEW.length || FDJ_SUMMARY.review_queue_full_count || 39891) : 0;
  const fdJewishTotal = HAS_FD_JLO ? (FDJ_SUMMARY.jewish_grants_total || 122763) : 0;
  const fdNonJewishTotal = HAS_FD_JLO ? (FDJ_SUMMARY.non_jewish_grants_total || 197854) : 0;
  const fdRecipients = HAS_FD_JLO ? (FDJ_SUMMARY.total_recipients_evaluated || 46699) : 0;
  const fdTopCandidates = HAS_FD_JLO ? ((FDJ_META && FDJ_META.top_candidates && FDJ_META.top_candidates.total) || 14074) : 0;
  const fdMixed = HAS_FD_JLO ? (FDJ_SUMMARY.mixed_partial_review_count || 71) : 0;
  const fdAutoResolved = HAS_FD_JLO ? (FDJ_SUMMARY.auto_resolved_count || 320617) : 0;
  const fdTotalRows = HAS_FD_JLO ? (FDJ_SUMMARY.total_rows_processed || 360508) : 0;
  // FD layer rows
  const fdFoundationTotal = ((FDJ_LAYERS.foundation||{}).total) || 326217;
  const fdFederationTotal = ((FDJ_LAYERS.federation||{}).total) || 24952;
  const fdCefTotal = ((FDJ_LAYERS.community_endowment_fund||{}).total) || 9339;
  host.innerHTML = `
    <div class="adc-panel">
      <h2>Admin Workspace · Simplified Decision Tables</h2>
      <div class="adc-sub">Dashboard version <strong>${esc(ADMIN_STATE.dashboard_version)}</strong>. Review work is grouped by decision type. Each focused table contains only the records and the minimal set of decision options that belong to that mindset.${HAS_FD_JLO ? ` <strong>Engine ${esc(EFFECTIVE_ENGINE_VER)}</strong> applied across the full dashboard (${fmtNum(fdTotalRows)} grants, ${fmtNum(fdRecipients)} unique recipients).` : ''}</div>
      <div class="adc-stats">
        <div class="adc-stat"><div class="lbl">Jewish (canonical)</div><div class="val">${m.Jewish.toLocaleString()}</div><div class="sub">Includes admin overrides</div></div>
        <div class="adc-stat"><div class="lbl">Non-Jewish (canonical)</div><div class="val">${m.NonJewish.toLocaleString()}</div></div>
        <div class="adc-stat"><div class="lbl">Need Research</div><div class="val">${m.NeedResearch.toLocaleString()}</div></div>
        <div class="adc-stat"><div class="lbl">Auto-resolved log</div><div class="val">${(HAS_FD_JLO ? fdAutoTotal : ((JLO_AUTO_LOG&&JLO_AUTO_LOG.length)||SP_AUTO_LOG.length)).toLocaleString()}</div><div class="sub">${HAS_FD_JLO ? 'Full-Dashboard JLO (static CSV)' : 'JLO continuous (first+second+JLO)'}</div></div>
        ${HAS_FD_JLO ? `
        <div class="adc-stat"><div class="lbl">FD JLO Jewish (all layers)</div><div class="val">${fdJewishTotal.toLocaleString()}</div><div class="sub">Foundation + Federation + CEF</div></div>
        <div class="adc-stat"><div class="lbl">FD JLO Non-Jewish</div><div class="val">${fdNonJewishTotal.toLocaleString()}</div></div>
        <div class="adc-stat"><div class="lbl">FD JLO Review queue</div><div class="val">${fdReviewTotal.toLocaleString()}</div><div class="sub">${fmtNum(fdMixed)} mixed → allocation</div></div>
        <div class="adc-stat"><div class="lbl">FD JLO Auto-resolved</div><div class="val">${fdAutoResolved.toLocaleString()}</div><div class="sub">88.9% confidence-resolved</div></div>
        <div class="adc-stat"><div class="lbl">FD Top candidates</div><div class="val">${fdTopCandidates.toLocaleString()}</div><div class="sub">Admin-only reference</div></div>
        ` : `
        <div class="adc-stat"><div class="lbl">JLO Jewish (Phase 2 CEF)</div><div class="val">${(JLO_APPLIED.final_jewish_grants||2900).toLocaleString()}</div><div class="sub">Override rule applied</div></div>
        <div class="adc-stat"><div class="lbl">JLO review queue</div><div class="val">${(JLO_APPLIED.review_queue_admin||2883).toLocaleString()}</div><div class="sub">Routed to existing review panels</div></div>
        `}
        <div class="adc-stat"><div class="lbl">Routed rows (NR + CEF)</div><div class="val">${(ROUTED.classification.length+ROUTED.allocation.length+ROUTED.intermediary.length+ROUTED.duplicate.length+ROUTED.policy.length).toLocaleString()}</div></div>
        <div class="adc-stat"><div class="lbl">EINs enriched</div><div class="val">${(SP_REPORT.unique_eins_submitted||4855).toLocaleString()}</div></div>
      </div>
      ${HAS_FD_JLO ? `
      <div class="adc-sub" style="margin-top:12px;padding:10px 12px;background:rgba(99,102,241,0.06);border-left:3px solid #6366f1;border-radius:6px;font-size:0.85rem;">
        <strong>Full-Dashboard JLO scope by layer</strong> &mdash;
        Foundation: ${fmtNum(fdFoundationTotal)} grants
        (Jewish ${fmtNum((FDJ_LAYERS.foundation||{}).jewish||106138)} /
        Non-Jewish ${fmtNum((FDJ_LAYERS.foundation||{}).non_jewish||193633)} /
        Review ${fmtNum((FDJ_LAYERS.foundation||{}).review||26446)}) ·
        Federation: ${fmtNum(fdFederationTotal)} grants
        (Jewish ${fmtNum((FDJ_LAYERS.federation||{}).jewish||13725)} /
        Non-Jewish ${fmtNum((FDJ_LAYERS.federation||{}).non_jewish||665)} /
        Review ${fmtNum((FDJ_LAYERS.federation||{}).review||10562)}) ·
        CEF: ${fmtNum(fdCefTotal)} grants
        (Jewish ${fmtNum((FDJ_LAYERS.community_endowment_fund||{}).jewish||2900)} /
        Non-Jewish ${fmtNum((FDJ_LAYERS.community_endowment_fund||{}).non_jewish||3556)} /
        Review ${fmtNum((FDJ_LAYERS.community_endowment_fund||{}).review||2812)} /
        Mixed ${fmtNum((FDJ_LAYERS.community_endowment_fund||{}).mixed||71)}).
        Canonical public Top-400 untouched; ${fmtNum(fdTopCandidates)} candidate Jewish-aligned recipients exposed Admin-only via Export Bundle.
      </div>
      ` : ''}
    </div>`;
}

function postSaveRefresh(){
  // Update affected counts/cards without rerendering the heavy tables themselves.
  renderActionSummary();
  // Refresh logs (audit trail + learning rules summary)
  renderLogs();
}

function renderAll(){
  ensureMounts();
  refreshRouted();
  renderOverview();
  renderActionSummary();
  renderClassificationTable();
  renderAllocationTable();
  renderIntermediaryTable();
  renderDuplicateTable();
  renderPolicyTable();
  renderQueuedSummary();
  renderLogs();
  renderExportBundle();
  renderUserGuide();
}

// ── Public API ───────────────────────────────────────────────────────────────
window.adminDecisionCenter = {
  render: renderAll,
  routed: () => ROUTED,
  state: () => ADMIN_STATE,
  approveReclassify(){
    pushAudit('engine_reclassify_approved', {pending:ADMIN_STATE.pending_reclassification_count});
    pushLearningEvent('engine_reclassify_run', {description:'Admin approved re-running classification pass with captured patterns.'});
    ADMIN_STATE.pending_reclassification_count = 0;
    const banner = $('learningReclassifyBanner'); if(banner) banner.style.display='none';
    pushNotification({severity:'info', section:'Learning Engine', alert_type:'engine_update',
      title:'Re-classification pass approved', summary:'Engine will re-classify using accumulated patterns next time the offline pipeline runs.',
      action_required:'Coordinate with engineering to schedule the next pipeline run.'});
    renderLogs();
  },
  dismissReclassify(){
    ADMIN_STATE.pending_reclassification_count = 0;
    const banner = $('learningReclassifyBanner'); if(banner) banner.style.display='none';
  }
};
window.renderAdminDecisionCenter = renderAll;

// Hook into the dashboard's renderAdmin lifecycle
function installRenderHook(){
  const origRenderAdmin = window.renderAdmin;
  window.renderAdmin = function(){
    try { if(typeof origRenderAdmin==='function' && origRenderAdmin!==window.renderAdmin) origRenderAdmin(); } catch(e){ console.warn('origRenderAdmin error',e); }
    try { renderAll(); } catch(e){ console.warn('admin decision center render error',e); }
  };
  const nav = document.getElementById('navAdmin');
  if(nav && !nav.dataset.adcHooked){
    nav.dataset.adcHooked = '1';
    nav.addEventListener('click', () => {
      setTimeout(() => { try { renderAll(); } catch(e){ console.warn(e); } }, 60);
    });
  }
  const adminView = document.getElementById('adminView');
  if(adminView && !adminView.dataset.adcObserved){
    adminView.dataset.adcObserved = '1';
    const obs = new MutationObserver(() => {
      if(!adminView.hidden && document.body.classList.contains('admin-active')){
        try { renderAll(); } catch(e){ console.warn(e); }
      }
    });
    obs.observe(adminView, {attributes:true, attributeFilter:['hidden']});
    obs.observe(document.body, {attributes:true, attributeFilter:['class']});
  }
}
function maybeRender(){
  installRenderHook();
  if(document.body.classList.contains('admin-active')) try { renderAll(); } catch(e){ console.warn(e); }
}
document.addEventListener('DOMContentLoaded', maybeRender);
if(document.readyState!=='loading') maybeRender();

})();
