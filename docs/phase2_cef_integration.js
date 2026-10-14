/* ══════════════════════════════════════════════════════════════════════════
   Phase 2 CEF Integration
   --------------------------------------------------------------------------
   - Replaces multi-select entity-layer chips with a single-selection switcher
     (All Data / Foundations / Federations / Communities-Endowments-Funds).
   - Moves CEF Details panel, CEF Review Queue panel, the "verified metadata
     dataset" notice, and the "multi-layer money flow" notice into the Admin
     view only.  They are hidden in the public Dashboard view.
   - Wires Phase 2 990 financials and Schedule I grant rows into the
     Community / Endowment / Fund layer for stats, charts, Top 500, and
     exports without fabricating missing rows or years.
   - Adds an Admin Review Workflow with Save-and-Learn audit trail
     (in-session) and a full admin export bundle.
   ════════════════════════════════════════════════════════════════════════ */
(function(){
  'use strict';

  // ───────────────────────── helpers ──────────────────────────────────────
  function $(id){ return document.getElementById(id); }
  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function fmtMoney(n){
    if(n==null||isNaN(n)) return '—';
    const abs=Math.abs(+n);
    if(abs>=1e9) return '$'+(n/1e9).toFixed(2)+'B';
    if(abs>=1e6) return '$'+(n/1e6).toFixed(2)+'M';
    if(abs>=1e3) return '$'+(n/1e3).toFixed(1)+'K';
    return '$'+(+n).toLocaleString(undefined,{maximumFractionDigits:0});
  }
  function nowIso(){ return new Date().toISOString(); }
  function downloadFile(name, mime, content){
    const blob=new Blob([content],{type:mime+';charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=name;
    document.body.appendChild(a);a.click();
    setTimeout(()=>{document.body.removeChild(a);URL.revokeObjectURL(url);},120);
  }
  function csvEscape(v){
    if(v==null) return '';
    if(Array.isArray(v)) v=v.join('; ');
    else if(typeof v==='object') v=JSON.stringify(v);
    const s=String(v);
    return /[",\n\r]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
  }
  function toCsv(rows, headers){
    const out=[headers.join(',')];
    rows.forEach(r=>{ out.push(headers.map(h=>csvEscape(r[h])).join(',')); });
    return out.join('\n');
  }

  // ───────────────────────── data state ───────────────────────────────────
  // First-pass reviewed CEF datasets (overrides the originals when present).
  // Each reviewed grant has both `classification` (original from extraction
  // pass) and `updated_classification` (post-first-pass review). We fold the
  // updated classification + audit fields into the effective grant object the
  // dashboard consumes, while preserving the original under
  // `original_classification` for audit/export.
  const REVIEWED_GRANTS_RAW = window.PHASE2_CEF_GRANTS_REVIEWED || null;
  const REVIEWED_CLASSIFICATIONS_RAW = window.PHASE2_CEF_CLASSIFICATIONS_REVIEWED || null;
  const NEED_RESEARCH_REDUCED = window.PHASE2_CEF_NEED_RESEARCH_REDUCED || [];
  const UNRESOLVED_REVIEW_QUEUE = window.PHASE2_CEF_UNRESOLVED_REVIEW_QUEUE || [];
  const AUTO_RESOLVED_LOG = window.PHASE2_CEF_AUTO_RESOLVED_LOG || [];
  const REVIEWED_META = window.PHASE2_CEF_REVIEWED_META || null;

  // Build the effective grants list. When reviewed data is present, each row
  // uses updated_classification as the canonical `classification` for
  // downstream calculations, with the original classification preserved in
  // `original_classification` (also kept in the classification field of the
  // legacy PHASE2_CEF_GRANTS module).
  function _toNum(x){ const n=+x; return isNaN(n)?0:n; }
  function buildEffectiveGrants(){
    const src = REVIEWED_GRANTS_RAW || window.PHASE2_CEF_GRANTS || [];
    return src.map(g=>{
      const updated = g.updated_classification || g.classification || 'Need Research';
      const original = g.original_classification || g.classification || 'Need Research';
      return Object.assign({}, g, {
        // Coerce grant_amount to a number (reviewed JSON has strings)
        grant_amount: _toNum(g.grant_amount),
        // Canonical classification used by all downstream code
        classification: updated,
        // Preserve original under explicit field for audit/export
        original_classification: original,
        updated_classification: updated,
        // Use review_confidence when present; fall back to legacy classification_confidence
        classification_confidence: g.review_confidence || g.classification_confidence || 'low',
        review_confidence: g.review_confidence || g.classification_confidence || 'low',
        review_method: g.review_method || '',
        review_category: g.review_category || '',
        auto_resolved: !!g.auto_resolved,
        left_for_review: g.left_for_review===undefined ? (updated==='Need Research') : !!g.left_for_review
      });
    });
  }
  function buildEffectiveClassifications(){
    const src = REVIEWED_CLASSIFICATIONS_RAW || window.PHASE2_CEF_CLASSIFICATIONS || [];
    return src.map(c=>{
      const updated = c.updated_classification || c.classification;
      const original = c.original_classification || c.classification;
      return Object.assign({}, c, {
        classification: updated,
        original_classification: original,
        updated_classification: updated,
        classification_confidence: c.review_confidence || c.classification_confidence,
        review_confidence: c.review_confidence || c.classification_confidence
      });
    });
  }

  const PHASE2 = {
    filings: window.PHASE2_CEF_FILINGS || [],
    grants:  buildEffectiveGrants(),
    expenses:window.PHASE2_CEF_EXPENSES|| [],
    review:  window.PHASE2_CEF_REVIEW_QUEUE || [],
    classifications: buildEffectiveClassifications(),
    audit:   window.PHASE2_CEF_AUDIT_SEED || {},
    meta:    window.PHASE2_CEF_META    || {},
    // First-pass reviewed datasets and meta
    reviewed_meta: REVIEWED_META,
    need_research_reduced: NEED_RESEARCH_REDUCED,
    unresolved_review_queue: UNRESOLVED_REVIEW_QUEUE,
    auto_resolved_log: AUTO_RESOLVED_LOG,
    // Originals retained for audit / export.
    grants_original: window.PHASE2_CEF_GRANTS || [],
    classifications_original: window.PHASE2_CEF_CLASSIFICATIONS || []
  };
  window.PHASE2 = PHASE2;

  // Admin in-session decision log (persistent across navigation, not across page reload).
  // The user requested explicit labeling as "in-session, exportable".
  const decisionLog = [];
  window.CEF_ADMIN_DECISION_LOG = decisionLog;

  // Snapshot original review queue so we can preserve the original
  // recommendation / confidence for audit when admins act on items.
  const originalReviewById = Object.fromEntries(PHASE2.review.map(r=>[r.rq_id, JSON.parse(JSON.stringify(r))]));
  // Live review queue (admin actions remove items from active queue).
  const liveReview = PHASE2.review.slice();
  window.PHASE2_CEF_LIVE_REVIEW = liveReview;

  // ───────── single-selection entity-layer switcher ──────────────────────
  // Internally the dashboard already supports multi-layer via entityLayerSet.
  // Single-select is achieved by collapsing the set to one value (or all 3).
  function selectEntityLayer(layer){
    if(layer==='all'){
      window.entityLayerSet = new Set(['foundation','federation','community']);
    } else if(['foundation','federation','community'].includes(layer)){
      window.entityLayerSet = new Set([layer]);
    } else {
      window.entityLayerSet = new Set(['foundation','federation','community']);
    }
    // The dashboard's internal variable is the same identifier - reassign:
    try{ entityLayerSet = window.entityLayerSet; }catch(e){}
    // Activate federation data toggle when federation or all is shown.
    if(window.entityLayerSet.has('federation') && typeof setFederationDataMode==='function' && !window.includeFederationData){
      // Avoid stomping if the user explicitly turned it off
    }
    // Update chip UI
    document.querySelectorAll('#entityLayerMulti .entity-layer-chip').forEach(btn=>{
      const v=btn.getAttribute('data-layer');
      const active=(v===layer)||(v==='all'&&layer==='all');
      btn.classList.toggle('active',active);
      btn.setAttribute('aria-pressed',String(active));
      btn.setAttribute('aria-checked',String(active));
    });
    // Mirror legacy single-value field
    try{
      if(layer==='all') entityTypeFilter='all';
      else entityTypeFilter=layer;
    }catch(e){}
    // Drive downstream re-renders using existing pipeline
    try{ if(typeof updateFederationToggleButtons==='function') updateFederationToggleButtons(); }catch(e){}
    try{ if(typeof updateEntityTypeControl==='function') updateEntityTypeControl(); }catch(e){}
    try{ if(typeof rebuildActiveDataLayer==='function') rebuildActiveDataLayer(); }catch(e){}
    try{ if(typeof refreshDashboardAfterDataLayer==='function') refreshDashboardAfterDataLayer(); }catch(e){}
    try{ if(typeof window.invalidateInsightsCache==='function') window.invalidateInsightsCache(); }catch(e){}
    if(document.body.classList.contains('admin-active') && typeof window.renderAdmin==='function') window.renderAdmin();
    if(document.body.classList.contains('insights-active') && typeof window.renderInsights==='function'){
      try{ window.renderInsights(); }catch(e){}
    }
    // Update CEF stat strip & Top 500 (CEF-aware augmentation handled elsewhere)
    if(typeof window.renderCefTable==='function') window.renderCefTable();
    if(typeof window.renderCefReviewSummary==='function') window.renderCefReviewSummary();
    if(typeof window.buildJewishRecTable==='function') window.buildJewishRecTable();
    if(typeof window.renderCefAdminPanels==='function') window.renderCefAdminPanels();
    if(typeof window.renderCefReviewedAdminPanels==='function') window.renderCefReviewedAdminPanels();
    if(typeof window.renderTop500ReviewPanel==='function') window.renderTop500ReviewPanel();
  }
  window.selectEntityLayer = selectEntityLayer;

  // Backwards-compatible shims for the old multi-toggle entry points.
  // Any older code paths or exports continue to function as single-select.
  window.toggleEntityLayer = function(layer){
    // Map multi-toggle clicks to single-select selection.
    selectEntityLayer(layer);
  };
  window.setEntityLayersAll = function(){
    selectEntityLayer('all');
  };

  // Hide the legacy verified-CEF / flow-double notices in the public dashboard.
  // updateEntityTypeControl() in the original code toggles them based on the
  // community-layer membership. We patch it to keep them hidden in the
  // dashboard view (they only render under Admin from now on).
  const origUpdateEntityTypeControl = window.updateEntityTypeControl;
  window.updateEntityTypeControl = function(){
    if(typeof origUpdateEntityTypeControl==='function'){
      try{ origUpdateEntityTypeControl(); }catch(e){}
    }
    // Re-apply single-selection chip state — the original multi-select logic
    // marks every chip in the set as active, but here we want exactly one.
    const set = window.entityLayerSet || new Set();
    const isAll = set.size===3;
    const currentLayer = isAll ? 'all' : (set.size===1 ? [...set][0] : 'all');
    document.querySelectorAll('#entityLayerMulti .entity-layer-chip').forEach(btn=>{
      const v=btn.getAttribute('data-layer');
      const active=(v===currentLayer);
      btn.classList.toggle('active',active);
      btn.setAttribute('aria-pressed',String(active));
      btn.setAttribute('aria-checked',String(active));
    });
    // Force-hide the two notices and CEF cards in the dashboard view.
    document.querySelectorAll('[data-admin-only="true"]').forEach(el=>{
      if(document.body.classList.contains('admin-active')){
        el.style.display='';
      } else {
        el.style.display='none';
      }
    });
  };

  // ───────────── Admin view: relocate CEF panels & notices ────────────────
  // We physically move the panels into the Admin <main> sections so they only
  // appear there. (We do this after DOMContentLoaded; safe across reloads.)
  function relocateCefIntoAdmin(){
    const cefCard = $('cefCard');
    const cefReviewCard = $('cefReviewCard');
    const communityGapNote = $('communityGapNote');
    const flowDoubleNote = $('flowDoubleNote');
    const adminCefNotices = $('adminCefNotices');
    const adminCefDetailsMount = $('adminCefDetailsMount');
    const adminCefReviewMount = $('adminCefReviewMount');
    if(communityGapNote && adminCefNotices && !adminCefNotices.contains(communityGapNote)){
      adminCefNotices.appendChild(communityGapNote);
      communityGapNote.style.display='block';
    }
    if(flowDoubleNote && adminCefNotices && !adminCefNotices.contains(flowDoubleNote)){
      adminCefNotices.appendChild(flowDoubleNote);
      flowDoubleNote.style.display='block';
    }
    if(cefCard && adminCefDetailsMount && !adminCefDetailsMount.contains(cefCard)){
      adminCefDetailsMount.appendChild(cefCard);
      cefCard.style.display='block';
    }
    if(cefReviewCard && adminCefReviewMount && !adminCefReviewMount.contains(cefReviewCard)){
      adminCefReviewMount.appendChild(cefReviewCard);
      cefReviewCard.style.display='block';
    }
  }

  // ───────────── Admin review workflow ────────────────────────────────────
  function _findFilingFor(rqEntity){
    return (PHASE2.filings||[]).find(f=>f.entity_display_name===rqEntity) || null;
  }
  function _verifiedRecordFor(rqEntity, rqEin){
    const list=(window.VERIFIED_COMMUNITY_ENTITIES&&window.VERIFIED_COMMUNITY_ENTITIES.records)||[];
    const ein=(rqEin||'').replace(/\D/g,'');
    return list.find(r=>
      (r.input_entity_name||'').trim()===rqEntity ||
      (r.legal_name||'').trim()===rqEntity ||
      (ein && String(r.ein_or_registration||'').replace(/\D/g,'')===ein)
    ) || null;
  }
  const DECISION_OPTIONS = [
    {value:'approve_separate_filing', label:'Approve as separate filing entity'},
    {value:'map_to_federation_parent', label:'Map to related Federation / parent'},
    {value:'mark_internal_fund', label:'Mark as internal fund / no separate 990'},
    {value:'mark_included_in_parent_group_return', label:'Mark as included in parent / group return'},
    {value:'mark_not_found', label:'Mark as not found / no reliable filing'},
    {value:'keep_unclear', label:'Keep unclear / needs more research'},
    {value:'merge_with_existing_entity', label:'Merge with existing entity'},
    {value:'reject_incorrect_match', label:'Reject incorrect match'}
  ];

  // Admin styles (scoped)
  const adminCss = document.createElement('style');
  adminCss.textContent = `
    .cef-admin-section{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:18px 20px;margin-bottom:18px;}
    .cef-admin-section h3{font-size:0.92rem;margin-bottom:8px;color:var(--text);}
    .cef-admin-section .desc{font-size:0.78rem;color:var(--text-muted);margin-bottom:12px;line-height:1.5;}
    .cef-admin-table{width:100%;border-collapse:collapse;font-size:0.78rem;}
    .cef-admin-table th{background:var(--surface2);color:var(--text-muted);font-size:0.66rem;text-transform:uppercase;letter-spacing:0.05em;padding:8px 10px;text-align:left;border-bottom:1px solid var(--border);}
    .cef-admin-table td{padding:9px 10px;border-bottom:1px solid var(--border);vertical-align:top;color:var(--text);}
    .cef-admin-table tr:hover{background:var(--surface2);}
    .cef-admin-table .pri-HIGH{color:#fca5a5;font-weight:800;}
    .cef-admin-table .pri-MEDIUM{color:#fbbf24;font-weight:700;}
    .cef-admin-table .pri-LOW{color:#9ca3af;font-weight:600;}
    .cef-admin-btn{border:1px solid rgba(129,140,248,0.42);background:rgba(99,102,241,0.10);color:#c7d2fe;border-radius:8px;padding:5px 10px;font-size:0.7rem;font-weight:700;cursor:pointer;}
    .cef-admin-btn:hover{background:rgba(99,102,241,0.20);}
    .cef-admin-btn.primary{background:linear-gradient(135deg,#6867ff,#5357df);border-color:transparent;color:white;}
    .cef-admin-btn.ghost{background:transparent;color:var(--text-muted);border-color:var(--border);}
    .cef-admin-modal{position:fixed;inset:0;background:rgba(8,12,24,0.78);z-index:9000;display:none;align-items:center;justify-content:center;padding:24px;}
    .cef-admin-modal.open{display:flex;}
    .cef-admin-modal-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;width:min(720px,96vw);max-height:90vh;overflow:auto;padding:24px;}
    .cef-admin-modal-card h2{font-size:1.05rem;margin-bottom:6px;}
    .cef-admin-modal-card .sub{font-size:0.78rem;color:var(--text-muted);margin-bottom:14px;}
    .cef-admin-evidence{background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:12px;margin:10px 0;font-size:0.78rem;line-height:1.5;}
    .cef-admin-evidence dt{color:var(--text-muted);font-size:0.66rem;text-transform:uppercase;letter-spacing:0.04em;margin-top:8px;}
    .cef-admin-evidence dd{color:var(--text);margin-left:0;}
    .cef-admin-form label{display:block;font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px;margin-top:10px;}
    .cef-admin-form select,.cef-admin-form textarea,.cef-admin-form input{width:100%;background:var(--surface2);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:9px 11px;font-size:0.82rem;font-family:inherit;}
    .cef-admin-form textarea{min-height:90px;resize:vertical;}
    .cef-admin-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:18px;flex-wrap:wrap;}
    .cef-export-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;}
    .cef-export-grid button{text-align:left;padding:11px 13px;}
    .cef-export-grid .desc{font-size:0.68rem;color:var(--text-muted);margin-top:3px;line-height:1.35;font-weight:400;}
    .cef-decision-row{display:grid;grid-template-columns:120px 1fr;gap:12px;font-size:0.76rem;padding:9px 0;border-bottom:1px solid var(--border);}
    .cef-decision-row .ts{color:var(--text-muted);font-variant-numeric:tabular-nums;}
    .cef-decision-row strong{color:#c7d2fe;}
    .cef-decision-row em{color:#fde68a;font-style:normal;}
    .session-pill{display:inline-block;padding:2px 8px;border-radius:999px;background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.32);color:#fde68a;font-size:0.62rem;font-weight:800;letter-spacing:0.04em;text-transform:uppercase;margin-left:8px;}
  `;
  document.head.appendChild(adminCss);

  // Build the modal once and reuse
  let modalEl=null;
  function ensureModal(){
    if(modalEl) return modalEl;
    modalEl=document.createElement('div');
    modalEl.className='cef-admin-modal';
    modalEl.id='cefAdminModal';
    modalEl.innerHTML='<div class="cef-admin-modal-card" id="cefAdminModalCard"></div>';
    modalEl.addEventListener('click',e=>{ if(e.target===modalEl) modalEl.classList.remove('open'); });
    document.body.appendChild(modalEl);
    return modalEl;
  }

  function openReviewModal(rqId){
    const item = liveReview.find(r=>r.rq_id===rqId);
    if(!item) return;
    const filing = _findFilingFor(item.entity_name);
    const verified = _verifiedRecordFor(item.entity_name, item.ein);
    ensureModal();
    const card=$('cefAdminModalCard');
    const fed = (verified && verified.related_federation_name) || '—';
    const parent = (verified && verified.parent_or_group_return_legal_name) || (verified && verified.parent_entity) || '—';
    const sourceLinks = (verified && verified.source_links) || [];
    const filingEv = filing ? `<dt>Filing</dt><dd>${esc(filing.form_type||'')} · TY ${esc(filing.tax_year||'')} · Total revenue ${fmtMoney(filing.total_revenue)} · Grants paid ${fmtMoney(filing.grants_paid_total)} · Schedule I rows ${esc(filing.schedule_i_grant_rows||0)} · IRS Object ID <code>${esc(filing.irs_object_id||'')}</code></dd>` : '<dt>Filing</dt><dd><em>No Phase 2 filing record extracted.</em></dd>';
    const sourceLinksHtml = sourceLinks.length
      ? sourceLinks.map(s=>`<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label||s.url)}</a>`).join('<br>')
      : (filing && filing.propublica_url ? `<a href="${esc(filing.propublica_url)}" target="_blank" rel="noopener">${esc(filing.propublica_url)}</a>` : '<em>None recorded.</em>');
    const matchConf = verified ? (verified.match_confidence==null?'—':Number(verified.match_confidence).toFixed(2)) : '—';
    card.innerHTML = `
      <h2>${esc(item.entity_name)} <span class="session-pill">In-session decision</span></h2>
      <div class="sub">Review item <code>${esc(item.rq_id)}</code> · Priority <strong class="pri-${esc(item.priority||'LOW')}">${esc(item.priority||'LOW')}</strong> · Issue <em>${esc(item.issue_type||'')}</em></div>
      <div class="cef-admin-evidence">
        <dl>
          <dt>Possible legal name / EIN</dt><dd>${esc(verified && verified.legal_name || '—')} · EIN ${esc(item.ein || (verified && verified.ein_or_registration) || '—')}</dd>
          <dt>Related Federation</dt><dd>${esc(fed)}</dd>
          <dt>Possible parent / group return</dt><dd>${esc(parent)}</dd>
          <dt>Verification status</dt><dd>${esc(item.verification_status || (verified && verified.verification_status) || '—')}</dd>
          <dt>Match confidence</dt><dd>${esc(matchConf)}</dd>
          <dt>Review reason</dt><dd>${esc(item.description||'')}</dd>
          <dt>Current recommendation</dt><dd>${esc(item.recommended_action||'')}</dd>
          ${filingEv}
          <dt>Source links / filing evidence</dt><dd>${sourceLinksHtml}</dd>
          <dt>Original notes</dt><dd>${esc(item.notes||'—')}</dd>
        </dl>
      </div>
      <form class="cef-admin-form" id="cefAdminForm">
        <label for="cefAdminDecision">Decision</label>
        <select id="cefAdminDecision" required>
          ${DECISION_OPTIONS.map(o=>`<option value="${o.value}">${esc(o.label)}</option>`).join('')}
        </select>
        <label for="cefAdminMergeTarget">Merge target / parent entity (optional)</label>
        <input id="cefAdminMergeTarget" placeholder="e.g. Jewish Federation of Greater Los Angeles">
        <label for="cefAdminNote">Admin note <span style="color:#fca5a5;">*</span></label>
        <textarea id="cefAdminNote" required placeholder="Why this decision? Evidence consulted, EIN found, source URL, etc."></textarea>
        <div class="cef-admin-actions">
          <button type="button" class="cef-admin-btn ghost" onclick="document.getElementById('cefAdminModal').classList.remove('open')">Cancel</button>
          <button type="submit" class="cef-admin-btn primary" data-testid="button-cef-save-learn">Save and Learn</button>
        </div>
      </form>
    `;
    $('cefAdminForm').onsubmit=(ev)=>{
      ev.preventDefault();
      const decision=$('cefAdminDecision').value;
      const note=$('cefAdminNote').value.trim();
      const mergeTarget=$('cefAdminMergeTarget').value.trim();
      if(!note){ alert('Admin note is required for the audit trail.'); return; }
      saveDecision({rqItem:item, verified, filing, decision, note, mergeTarget});
      modalEl.classList.remove('open');
    };
    modalEl.classList.add('open');
  }
  window.openCefReviewItem = openReviewModal;

  function saveDecision({rqItem, verified, filing, decision, note, mergeTarget}){
    const entry = {
      decision_id: 'CEF-DEC-'+Date.now()+'-'+Math.random().toString(36).slice(2,7),
      timestamp: nowIso(),
      session_id: window.__atlas_session_id || (window.__atlas_session_id='SES-'+Date.now()),
      rq_id: rqItem.rq_id,
      entity_name: rqItem.entity_name,
      ein: rqItem.ein,
      verification_status_before: rqItem.verification_status,
      original_issue_type: rqItem.issue_type,
      original_priority: rqItem.priority,
      original_recommendation: rqItem.recommended_action,
      original_description: rqItem.description,
      original_review_item: originalReviewById[rqItem.rq_id],
      original_match_confidence: verified ? verified.match_confidence : null,
      decision: decision,
      decision_label: (DECISION_OPTIONS.find(d=>d.value===decision)||{}).label || decision,
      admin_note: note,
      merge_target: mergeTarget || null,
      filing_evidence: filing ? {
        ein: filing.ein, tax_year: filing.tax_year, irs_object_id: filing.irs_object_id,
        grants_paid_total: filing.grants_paid_total, schedule_i_grant_rows: filing.schedule_i_grant_rows,
        source_url: filing.propublica_url
      } : null,
      verified_evidence_snapshot: verified ? {
        legal_name: verified.legal_name, ein_or_registration: verified.ein_or_registration,
        verification_status: verified.verification_status, match_confidence: verified.match_confidence,
        related_federation_name: verified.related_federation_name,
        source_links: verified.source_links||[]
      } : null,
      persistence: 'in_session_only'
    };
    decisionLog.push(entry);
    // Update verified record's review status if present
    if(verified){
      verified.admin_decision_in_session = decision;
      verified.admin_decision_note_in_session = note;
      verified.admin_decision_timestamp_in_session = entry.timestamp;
      verified.review_required = (decision==='keep_unclear');
    }
    // Update live entity / review state
    rqItem.resolved = (decision!=='keep_unclear');
    rqItem.admin_decision = decision;
    rqItem.admin_note = note;
    rqItem.admin_timestamp = entry.timestamp;
    // Remove resolved items from active queue
    const idx = liveReview.indexOf(rqItem);
    if(idx>-1 && rqItem.resolved){ liveReview.splice(idx,1); }
    // Refresh panels
    renderCefAdminPanels();
    if(typeof window.renderCefTable==='function') window.renderCefTable();
    if(typeof window.renderCefReviewSummary==='function') window.renderCefReviewSummary();
    toast(`Decision saved: ${esc(entry.decision_label)} — ${esc(rqItem.entity_name)} (in-session)`);
  }

  function toast(html){
    let host=$('cefAdminToastHost');
    if(!host){
      host=document.createElement('div');host.id='cefAdminToastHost';
      host.style.cssText='position:fixed;bottom:24px;right:24px;z-index:9100;display:flex;flex-direction:column;gap:8px;';
      document.body.appendChild(host);
    }
    const el=document.createElement('div');
    el.style.cssText='background:#1a1d27;border:1px solid #2e3250;color:#e8eaf6;padding:11px 14px;border-radius:10px;font-size:0.78rem;box-shadow:0 16px 38px rgba(0,0,0,0.34);max-width:380px;';
    el.innerHTML=html;
    host.appendChild(el);
    setTimeout(()=>{ el.style.opacity='0';el.style.transition='opacity .35s';setTimeout(()=>el.remove(),420);},4500);
  }

  // ───────────── render Admin sections ────────────────────────────────────
  function renderCefAdminPanels(){
    const wrap=$('adminCefReviewWorkflow');
    const exp=$('adminCefExports');
    const logEl=$('adminCefDecisionLog');
    if(!wrap||!exp||!logEl) return;
    const meta=PHASE2.meta||{};
    const audit=PHASE2.audit||{};

    // 1) Phase 2 overview card (updated for JLO override classification)
    const __JLO_META = window.JEWISH_LINKAGE_META || {};
    const __JLO_AP = (__JLO_META && __JLO_META.applied_counts) || {};
    const overviewExtra = `
      <div class="cef-admin-section" data-testid="cef-admin-overview">
        <h3>Phase 2 CEF extraction overview <span class="session-pill">${esc(meta.extraction_date||'')}</span></h3>
        <div class="desc">
          ${esc(meta.total_entities_loaded||0)} CEF entities loaded · ${esc(meta.separate_filing_entities||0)} separate filing entities ·
          ${esc(meta.xml_filings_downloaded||0)} XML 990s downloaded · ${esc(meta.propublica_api_filing_summaries||0)} ProPublica summaries ·
          ${esc(meta.total_filing_records||0)} filing records · <strong>${esc(meta.total_grant_rows_extracted||0)}</strong> Schedule I grant rows ·
          ${fmtMoney(meta.total_grant_amount||0)} extracted grant value · ${esc(meta.total_expense_rows||0)} expense rows.
        </div>
        <div class="desc" style="margin-top:8px;padding:8px 10px;background:rgba(99,102,241,0.08);border-left:3px solid #6366f1;border-radius:6px;">
          <strong>Jewish Linkage Override (JLO) classification · Phase 2 CEF scope only.</strong>
          Engine: <code>${esc(__JLO_META.engine_version||'jewish_linkage_override_v1_20260514')}</code> ·
          Last verified ${esc(__JLO_META.last_verified_date||'2026-05-14')}. Override rule:
          if a grant is given to a verified Jewish organization, classify the grant as Jewish.
          <br><strong>${(__JLO_AP.final_jewish_grants||2900).toLocaleString()}</strong> Jewish ·
          <strong>${(__JLO_AP.final_nonjewish_grants||3556).toLocaleString()}</strong> Non-Jewish ·
          <strong>${(__JLO_AP.final_mixed_partial||71).toLocaleString()}</strong> Mixed / Partial ·
          <strong>${(__JLO_AP.final_unclear_needs_review||2812).toLocaleString()}</strong> Unclear / Needs Review ·
          ${(__JLO_AP.review_queue_admin||2883).toLocaleString()} routed to existing Jewish / Non-Jewish (+ Mixed / Partial) review panels ·
          ${(__JLO_AP.auto_resolved_this_pass||6456).toLocaleString()} auto-resolved this pass (confidence ≥ 75) ·
          ${(__JLO_AP.continuous_auto_log_rows||11866).toLocaleString()} cumulative auto-resolutions (first + second + JLO).
          <br><span style="color:var(--text-muted);font-size:0.78rem;">JLO corrected 1,158 false positives from the prior second_pass_v1.0 "ou" substring keyword bug (e.g. ACLU Foundation, Barack Obama Foundation). These records now sit in the admin review queue. Scope limitation: JLO covers Phase 2 CEF grants (9,339 rows; 8,246 recipients) only; the broader DASHBOARD_DATA and compact recipient_grants.js are not yet row-normalized to JLO.</span>
        </div>
      </div>`;

    // 2) Live review workflow (priority-sorted, clickable)
    const priOrd={HIGH:0,MEDIUM:1,LOW:2};
    const sorted = liveReview.slice().sort((a,b)=>(priOrd[a.priority]??9)-(priOrd[b.priority]??9));
    const tableRows = sorted.length ? sorted.map(r=>`
      <tr>
        <td><code style="color:#cbd5e1;font-size:0.7rem;">${esc(r.rq_id)}</code></td>
        <td>${esc(r.entity_name)}</td>
        <td><code style="color:#cbd5e1;font-size:0.7rem;">${esc(r.ein||'—')}</code></td>
        <td class="pri-${esc(r.priority||'LOW')}">${esc(r.priority||'LOW')}</td>
        <td>${esc(r.issue_type||'')}</td>
        <td>${esc((r.description||'').slice(0,180))}${(r.description||'').length>180?'…':''}</td>
        <td><button class="cef-admin-btn" data-testid="button-cef-review-open-${esc(r.rq_id)}" onclick="openCefReviewItem('${esc(r.rq_id)}')">Open review</button></td>
      </tr>
    `).join('') : '<tr><td colspan="7" style="text-align:center;padding:18px;color:var(--text-muted);">Active review queue is empty.</td></tr>';

    const workflowHtml = `
      <div class="cef-admin-section" data-testid="cef-admin-review-workflow">
        <h3>CEF Admin Review Workflow <span class="session-pill">${liveReview.length} active · in-session</span></h3>
        <div class="desc">
          Click any unclear / needs-review entry to open the review panel. Decisions are written to the in-session
          audit trail along with the original recommendation, confidence, and verified evidence; resolved items are
          removed from the active queue and exported from the decision log below. Persistent storage requires a
          backend; until then all decisions are clearly in-session and exportable.
        </div>
        <div style="overflow:auto;">
          <table class="cef-admin-table" data-testid="table-cef-review-workflow">
            <thead><tr><th>ID</th><th>Entity</th><th>EIN</th><th>Pri</th><th>Issue</th><th>Description</th><th></th></tr></thead>
            <tbody>${tableRows}</tbody>
          </table>
        </div>
      </div>`;
    wrap.innerHTML = overviewExtra + workflowHtml;

    // 3) Admin export bundle
    exp.innerHTML = `
      <div class="cef-admin-section" data-testid="cef-admin-exports">
        <h3>Admin export bundle</h3>
        <div class="desc">All Phase 2 datasets, verified metadata, mappings, and the in-session decision log are downloadable here. CSV and JSON paths preserve source links, original extracted text, classification confidence, review reasons, and audit fields.</div>
        <div class="cef-export-grid">
          <button class="cef-admin-btn" onclick="exportVerifiedMetadata()" data-testid="export-verified-metadata"><strong>Verified metadata</strong><div class="desc">90-entity research file (JSON+CSV)</div></button>
          <button class="cef-admin-btn" onclick="exportPhase2Filings()" data-testid="export-filings"><strong>Phase 2 filings</strong><div class="desc">99 filing records (CSV)</div></button>
          <button class="cef-admin-btn" onclick="exportPhase2Grants()" data-testid="export-grants"><strong>Grant line items</strong><div class="desc">9,339 Schedule I grant rows (CSV)</div></button>
          <button class="cef-admin-btn" onclick="exportPhase2Expenses()" data-testid="export-expenses"><strong>Expense line items</strong><div class="desc">68 functional expense rows (CSV)</div></button>
          <button class="cef-admin-btn" onclick="exportPhase2Review()" data-testid="export-review-queue"><strong>Review queue</strong><div class="desc">${PHASE2.review.length} review items (CSV)</div></button>
          <button class="cef-admin-btn" onclick="exportUnclearNeedsReview()" data-testid="export-unclear"><strong>Unclear / needs review</strong><div class="desc">Subset of review queue (CSV)</div></button>
          <button class="cef-admin-btn" onclick="exportParentGroupMapping()" data-testid="export-parent-group"><strong>Parent / group mapping</strong><div class="desc">Group-return relationships (CSV)</div></button>
          <button class="cef-admin-btn" onclick="exportInternalFundMapping()" data-testid="export-internal-fund"><strong>Internal fund mapping</strong><div class="desc">No-separate-990 entities (CSV)</div></button>
          <button class="cef-admin-btn" onclick="exportPossibleDoubleCounting()" data-testid="export-double-counting"><strong>Possible double-counting</strong><div class="desc">Federation-parent CEF flows (CSV)</div></button>
          <button class="cef-admin-btn" onclick="exportPhase2Classifications()" data-testid="export-classifications"><strong>Classifications (original)</strong><div class="desc">9,339 original classified grant rows (CSV)</div></button>
          <button class="cef-admin-btn" onclick="exportPhase2GrantsReviewed()" data-testid="export-grants-reviewed"><strong>Reviewed grants</strong><div class="desc">9,339 grants with updated_classification + audit fields (CSV)</div></button>
          <button class="cef-admin-btn" onclick="exportPhase2ClassificationsReviewed()" data-testid="export-classifications-reviewed"><strong>Reviewed classifications log</strong><div class="desc">9,339 confidence-scored entries (CSV)</div></button>
          <button class="cef-admin-btn" onclick="exportNeedResearchReduced()" data-testid="export-nr-reduced"><strong>Need Research — reduced</strong><div class="desc">5,702 remaining unresolved rows (CSV)</div></button>
          <button class="cef-admin-btn" onclick="exportUnresolvedReviewQueue()" data-testid="export-unresolved-queue"><strong>Unresolved review queue</strong><div class="desc">5,702 admin-ready edge cases (CSV)</div></button>
          <button class="cef-admin-btn" onclick="exportAutoResolvedLog()" data-testid="export-auto-resolved"><strong>Auto-resolved log</strong><div class="desc">696 high-confidence auto-resolved rows (CSV)</div></button>
          <button class="cef-admin-btn" onclick="exportAdminEdgeCases()" data-testid="export-admin-edge-cases"><strong>Admin edge-case list</strong><div class="desc">96 high-priority cases (ambiguous, interfaith, temple) (CSV)</div></button>
          <button class="cef-admin-btn" onclick="exportTop500JewishRecipients()" data-testid="export-top500-jewish"><strong>Top 500 Jewish Recipients</strong><div class="desc">Public Top 500 + support fields (CSV)</div></button>
          <button class="cef-admin-btn" onclick="exportDecisionLog()" data-testid="export-decision-log"><strong>Admin decision log</strong><div class="desc">In-session audit trail (JSON)</div></button>
          <button class="cef-admin-btn primary" onclick="exportAdminBundle()" data-testid="export-admin-bundle"><strong>Download full bundle</strong><div class="desc">All datasets (incl. reviewed) as combined JSON</div></button>
        </div>
      </div>`;

    // 4) Decision log
    const rows = decisionLog.slice().reverse();
    logEl.innerHTML = `
      <div class="cef-admin-section" data-testid="cef-admin-decision-log">
        <h3>Admin decision log <span class="session-pill">${decisionLog.length} entries · in-session</span></h3>
        <div class="desc">Original recommendation, confidence, and evidence are retained per entry. Decisions are not persisted until a backend is added — export the log before refreshing.</div>
        ${rows.length===0
          ? '<div style="color:var(--text-muted);font-size:0.78rem;">No decisions recorded in this session yet.</div>'
          : rows.map(r=>`
            <div class="cef-decision-row">
              <div class="ts">${esc(r.timestamp.replace('T',' ').slice(0,19))}</div>
              <div>
                <strong>${esc(r.entity_name)}</strong> · <em>${esc(r.decision_label)}</em><br>
                <span style="color:var(--text-muted);">RQ ${esc(r.rq_id)} · original priority ${esc(r.original_priority)} · original rec: ${esc((r.original_recommendation||'').slice(0,120))}</span><br>
                <span style="color:#cbd5e1;">Admin note: ${esc(r.admin_note)}</span>
                ${r.merge_target?`<br><span style="color:#a5b4fc;">Merge target: ${esc(r.merge_target)}</span>`:''}
              </div>
            </div>`).join('')
        }
      </div>`;
  }
  window.renderCefAdminPanels = renderCefAdminPanels;

  // ───────────── Reviewed Admin sections (first-pass classification) ──────
  function renderCefReviewedAdminPanels(){
    const summary = $('adminCefFirstPassSummary');
    const autoEl  = $('adminCefAutoResolvedLog');
    const nrEl    = $('adminCefNeedResearchReduced');
    const unrEl   = $('adminCefUnresolvedQueue');
    if(!summary || !autoEl || !nrEl || !unrEl) return;
    const rm = PHASE2.reviewed_meta || {};

    const updated = rm.updated_classifications || {};
    const original = rm.original_classifications || {};
    const updAmt = rm.updated_classification_amounts || {};
    const methods = rm.auto_resolution_methods || {};
    const cats = rm.unresolved_categories || {};
    const methodChips = Object.entries(methods).sort((a,b)=>b[1]-a[1])
      .map(([k,n])=>`<span style="display:inline-block;background:rgba(99,102,241,0.10);border:1px solid var(--border);border-radius:999px;padding:3px 9px;font-size:0.68rem;color:#c7d2fe;margin:2px 4px 2px 0;">${esc(k)} · ${n}</span>`).join('');
    const catChips = Object.entries(cats).sort((a,b)=>b[1]-a[1])
      .map(([k,n])=>`<span style="display:inline-block;background:rgba(245,158,11,0.10);border:1px solid rgba(245,158,11,0.32);border-radius:999px;padding:3px 9px;font-size:0.68rem;color:#fde68a;margin:2px 4px 2px 0;">${esc(k)} · ${n}</span>`).join('');
    summary.innerHTML = `
      <div class="cef-admin-section" data-testid="cef-admin-firstpass-summary">
        <h3>First-Pass Classification Review <span class="session-pill">${esc(rm.first_pass_version||'v1.0')} · ${esc(rm.reviewer||'auto_first_pass')}</span></h3>
        <div class="desc">
          Result of the first automated pass over the Need Research backlog. Each grant row preserves its original
          classification under <code>original_classification</code>; dashboard calculations now use <code>updated_classification</code>.
          Admin Mode remains the final decision layer; the existing Save-and-Learn workflow above keeps the original
          recommendation, confidence, and evidence for audit.
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:18px;margin:6px 0 10px;font-variant-numeric:tabular-nums;font-size:0.82rem;">
          <div><strong>${esc(rm.total_grant_rows||0)}</strong> total rows</div>
          <div><strong>${esc(rm.starting_need_research||0)}</strong> starting Need Research</div>
          <div><strong>${esc(rm.auto_resolved_jewish||0)}</strong> auto-resolved → Jewish</div>
          <div><strong>${esc(rm.auto_resolved_nonjewish||0)}</strong> auto-resolved → Non-Jewish</div>
          <div><strong>${esc(rm.still_need_research||0)}</strong> still Need Research</div>
          <div><strong>${esc(rm.resolution_rate_of_starting_nr_pct||0)}%</strong> resolution rate</div>
        </div>
        <div style="display:flex;gap:18px;flex-wrap:wrap;font-size:0.74rem;color:var(--text-muted);margin-bottom:6px;">
          <div>Original: Jewish ${esc(original.Jewish||0)} · Non-Jewish ${esc(original['Non-Jewish']||0)} · Need Research ${esc(original['Need Research']||0)}</div>
          <div>Updated: Jewish <strong style="color:#a5f3a8;">${esc(updated.Jewish||0)}</strong> · Non-Jewish <strong style="color:#fca5a5;">${esc(updated['Non-Jewish']||0)}</strong> · Need Research <strong style="color:#fde68a;">${esc(updated['Need Research']||0)}</strong></div>
        </div>
        <div style="display:flex;gap:18px;flex-wrap:wrap;font-size:0.74rem;color:var(--text-muted);margin-bottom:8px;">
          <div>Updated amounts: Jewish ${fmtMoney(updAmt.Jewish||0)} · Non-Jewish ${fmtMoney(updAmt['Non-Jewish']||0)} · Need Research ${fmtMoney(updAmt['Need Research']||0)}</div>
        </div>
        <div style="margin:6px 0;"><strong style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em;">Auto-resolution methods</strong><br>${methodChips||'<em>None</em>'}</div>
        <div style="margin:6px 0;"><strong style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em;">Unresolved categories</strong><br>${catChips||'<em>None</em>'}</div>
      </div>`;

    // Auto-resolved log table (top by amount)
    const auto = (PHASE2.auto_resolved_log||[]).slice();
    auto.sort((a,b)=>(+b.grant_amount||0)-(+a.grant_amount||0));
    const autoRows = auto.slice(0,200).map(r=>`
      <tr>
        <td><code style="color:#cbd5e1;font-size:0.7rem;">${esc(r.grant_id)}</code></td>
        <td>${esc(r.recipient_name||'')}</td>
        <td><code style="color:#cbd5e1;font-size:0.7rem;">${esc(r.recipient_ein||'')}</code></td>
        <td>${esc(r.recipient_city||'')} ${esc(r.recipient_state||'')}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums;">${fmtMoney(+r.grant_amount||0)}</td>
        <td style="color:${r.updated_classification==='Jewish'?'#a5f3a8':'#fca5a5'};font-weight:600;">${esc(r.original_classification||'')} → ${esc(r.updated_classification||'')}</td>
        <td>${esc(r.method||'')}</td>
        <td>${esc((r.reason||'').slice(0,140))}${(r.reason||'').length>140?'…':''}</td>
      </tr>`).join('');
    autoEl.innerHTML = `
      <div class="cef-admin-section" data-testid="cef-admin-auto-resolved">
        <h3>Auto-resolved classification log <span class="session-pill">${auto.length} rows · high-confidence</span></h3>
        <div class="desc">
          Rows automatically reclassified during the first pass, with method and evidence. All entries are
          high-confidence with explicit evidence; admin may still override via Save and Learn.
        </div>
        <div style="overflow:auto;max-height:540px;">
          <table class="cef-admin-table" data-testid="table-cef-auto-resolved">
            <thead><tr><th>Grant</th><th>Recipient</th><th>EIN</th><th>Location</th><th style="text-align:right;">Amount</th><th>From → To</th><th>Method</th><th>Reason / Evidence</th></tr></thead>
            <tbody>${autoRows || '<tr><td colspan="8" style="text-align:center;padding:18px;color:var(--text-muted);">No auto-resolved rows.</td></tr>'}</tbody>
          </table>
        </div>
        <div style="font-size:0.72rem;color:var(--text-muted);margin-top:6px;">Showing top 200 of ${auto.length} auto-resolved rows by amount. Full set available via export.</div>
      </div>`;

    // Need Research reduced table (top by amount)
    const nr = (PHASE2.need_research_reduced||[]).slice();
    nr.sort((a,b)=>(+b.grant_amount||0)-(+a.grant_amount||0));
    const nrRows = nr.slice(0,200).map(r=>`
      <tr>
        <td><code style="color:#cbd5e1;font-size:0.7rem;">${esc(r.grant_id)}</code></td>
        <td>${esc(r.recipient_name||'')}</td>
        <td><code style="color:#cbd5e1;font-size:0.7rem;">${esc(r.recipient_ein||'')}</code></td>
        <td>${esc(r.recipient_city||'')} ${esc(r.recipient_state||'')}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums;">${fmtMoney(+r.grant_amount||0)}</td>
        <td>${esc(r.review_category||'')}</td>
        <td>${esc((r.review_reason||r.classification_reason||'').slice(0,140))}</td>
      </tr>`).join('');
    nrEl.innerHTML = `
      <div class="cef-admin-section" data-testid="cef-admin-nr-reduced">
        <h3>Need Research — reduced queue <span class="session-pill">${nr.length} rows</span></h3>
        <div class="desc">
          Remaining grant rows that the first pass could not auto-resolve. Categorized by review_category for
          follow-up. None of these contribute to the public Top 500 (Need Research is excluded by the Jewish-only gate).
        </div>
        <div style="overflow:auto;max-height:540px;">
          <table class="cef-admin-table" data-testid="table-cef-nr-reduced">
            <thead><tr><th>Grant</th><th>Recipient</th><th>EIN</th><th>Location</th><th style="text-align:right;">Amount</th><th>Category</th><th>Reason</th></tr></thead>
            <tbody>${nrRows || '<tr><td colspan="7" style="text-align:center;padding:18px;color:var(--text-muted);">No remaining Need Research rows.</td></tr>'}</tbody>
          </table>
        </div>
        <div style="font-size:0.72rem;color:var(--text-muted);margin-top:6px;">Showing top 200 of ${nr.length} remaining Need Research rows. Full set available via export.</div>
      </div>`;

    // Unresolved review queue (admin-ready edge cases prioritized)
    const unr = (PHASE2.unresolved_review_queue||[]).slice();
    const catRank = {ambiguous_intermediary:0, interfaith_mixed:1, temple_ambiguous:2, insufficient_signal:9};
    unr.sort((a,b)=>{
      const ra=catRank[a.review_category]??9, rb=catRank[b.review_category]??9;
      if(ra!==rb) return ra-rb;
      return (+b.grant_amount||0)-(+a.grant_amount||0);
    });
    const unrRows = unr.slice(0,200).map(r=>`
      <tr>
        <td><code style="color:#cbd5e1;font-size:0.7rem;">${esc(r.grant_id)}</code></td>
        <td>${esc(r.recipient_name||'')}</td>
        <td><code style="color:#cbd5e1;font-size:0.7rem;">${esc(r.recipient_ein||'')}</code></td>
        <td>${esc(r.recipient_city||'')} ${esc(r.recipient_state||'')}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums;">${fmtMoney(+r.grant_amount||0)}</td>
        <td style="color:#fde68a;">${esc(r.review_category||'')}</td>
        <td>${esc((r.review_reason||r.classification_reason||'').slice(0,140))}</td>
      </tr>`).join('');
    unrEl.innerHTML = `
      <div class="cef-admin-section" data-testid="cef-admin-unresolved-queue">
        <h3>Unresolved review queue <span class="session-pill">${unr.length} rows · edge cases</span></h3>
        <div class="desc">
          Admin-ready edge cases needing human review: ambiguous intermediaries (DAFs, community foundations,
          pass-throughs), interfaith / multi-faith organizations, temple-ambiguous, and insufficient-signal rows.
          Use the Save-and-Learn workflow above to record decisions; the original recommendation, confidence,
          and evidence are retained on each entry.
        </div>
        <div style="overflow:auto;max-height:540px;">
          <table class="cef-admin-table" data-testid="table-cef-unresolved-queue">
            <thead><tr><th>Grant</th><th>Recipient</th><th>EIN</th><th>Location</th><th style="text-align:right;">Amount</th><th>Category</th><th>Reason</th></tr></thead>
            <tbody>${unrRows || '<tr><td colspan="7" style="text-align:center;padding:18px;color:var(--text-muted);">Unresolved queue empty.</td></tr>'}</tbody>
          </table>
        </div>
        <div style="font-size:0.72rem;color:var(--text-muted);margin-top:6px;">Showing top 200 of ${unr.length} unresolved entries (edge cases prioritized first). Full set available via export.</div>
      </div>`;
  }
  window.renderCefReviewedAdminPanels = renderCefReviewedAdminPanels;

  // ───────────── exports ──────────────────────────────────────────────────
  function exportVerifiedMetadata(){
    const v = window.VERIFIED_COMMUNITY_ENTITIES || {records:[],metadata:{}};
    downloadFile('atlas_verified_community_entities.json','application/json',JSON.stringify(v,null,2));
    if(typeof window.exportCefCsv==='function') window.exportCefCsv();
  }
  function exportPhase2Filings(){
    const hdr=['organization_legal_name','entity_display_name','ein','tax_year','tax_period_begin','tax_period_end','form_type','irs_object_id','propublica_url','filing_source','data_source','total_revenue','total_expenses','total_assets_eoy','total_liabilities_eoy','contributions_grants_received','program_service_revenue','investment_income','grants_paid_total','program_service_expenses','management_general_expenses','fundraising_expenses','net_assets_eoy','schedule_i_grant_rows','xml_filename','revenue_pp_crosscheck','source_confidence','extraction_confidence','verification_status','extraction_date','notes'];
    downloadFile('phase2_cef_filings.csv','text/csv',toCsv(PHASE2.filings,hdr));
  }
  function exportPhase2Grants(){
    const hdr=['grant_id','source_entity','source_ein','tax_year','tax_period','schedule','recipient_name','recipient_ein','recipient_city','recipient_state','recipient_country','grant_amount','noncash_amount','grant_purpose','irc_section','source_filing','source_url','irs_object_id','extraction_confidence','classification','classification_confidence','classification_reason','evidence_used','review_status','admin_correction','notes'];
    downloadFile('phase2_cef_grants.csv','text/csv',toCsv(PHASE2.grants,hdr));
  }
  function exportPhase2Expenses(){
    const hdr=['expense_id','source_entity','source_ein','tax_year','tax_period','form_type','schedule_ref','expense_code','description','amount','source_filing','source_url','irs_object_id','extraction_confidence','notes'];
    downloadFile('phase2_cef_expenses.csv','text/csv',toCsv(PHASE2.expenses,hdr));
  }
  function exportPhase2Review(){
    const hdr=['rq_id','entity_name','ein','verification_status','issue_type','priority','description','recommended_action','source_url','notes','created_date','resolved','admin_decision','admin_note','admin_timestamp'];
    downloadFile('phase2_cef_review_queue.csv','text/csv',toCsv(PHASE2.review,hdr));
  }
  function exportUnclearNeedsReview(){
    const hdr=['rq_id','entity_name','ein','issue_type','priority','description','recommended_action','source_url','notes','resolved'];
    const rows = PHASE2.review.filter(r=>r.issue_type==='unclear_entity_needs_verification' || /unclear/i.test(r.issue_type||''));
    downloadFile('phase2_cef_unclear_needs_review.csv','text/csv',toCsv(rows,hdr));
  }
  function exportParentGroupMapping(){
    const hdr=['entity_name','ein','issue_type','priority','description','recommended_action','notes'];
    const rows = PHASE2.review.filter(r=>/group_return|parent/i.test(r.issue_type||''));
    // Add verified-CEF parent_or_group_return rows for completeness
    const v=(window.VERIFIED_COMMUNITY_ENTITIES&&window.VERIFIED_COMMUNITY_ENTITIES.records)||[];
    v.filter(r=>(r.verification_status==='included_in_parent_group_return')||(r.parent_or_group_return_legal_name))
      .forEach(r=>rows.push({entity_name:r.input_entity_name,ein:r.ein_or_registration,issue_type:'verified_parent_or_group_return',priority:'',description:'Parent: '+(r.parent_or_group_return_legal_name||r.parent_entity||''),recommended_action:'',notes:r.notes||''}));
    downloadFile('phase2_cef_parent_group_mapping.csv','text/csv',toCsv(rows,hdr));
  }
  function exportInternalFundMapping(){
    const hdr=['entity_name','ein','issue_type','priority','description','recommended_action','notes'];
    const rows = PHASE2.review.filter(r=>/internal_fund/i.test(r.issue_type||''));
    const v=(window.VERIFIED_COMMUNITY_ENTITIES&&window.VERIFIED_COMMUNITY_ENTITIES.records)||[];
    v.filter(r=>r.verification_status==='internal_fund_no_separate_990_found')
      .forEach(r=>rows.push({entity_name:r.input_entity_name,ein:r.ein_or_registration,issue_type:'verified_internal_fund_no_separate_990',priority:'',description:'No separate 990. '+(r.related_federation_name?'Tied to: '+r.related_federation_name:''),recommended_action:'Review parent 990 for inclusion',notes:r.notes||''}));
    downloadFile('phase2_cef_internal_fund_mapping.csv','text/csv',toCsv(rows,hdr));
  }
  function exportPossibleDoubleCounting(){
    const hdr=['entity_name','ein','related_federation_name','verification_status','match_confidence','review_categories','notes'];
    const v=(window.VERIFIED_COMMUNITY_ENTITIES&&window.VERIFIED_COMMUNITY_ENTITIES.records)||[];
    const rows = v.filter(r=>(r.review_categories||[]).indexOf('possible_double_counting_with_federation_parent')>-1)
      .map(r=>({entity_name:r.input_entity_name,ein:r.ein_or_registration,related_federation_name:r.related_federation_name||'',verification_status:r.verification_status,match_confidence:r.match_confidence,review_categories:(r.review_categories||[]).join('; '),notes:r.notes||''}));
    downloadFile('phase2_cef_possible_double_counting.csv','text/csv',toCsv(rows,hdr));
  }
  function exportPhase2Classifications(){
    // Original (pre-first-pass) classifications log.
    const src = PHASE2.classifications_original || [];
    const hdr=['grant_id','source_entity','source_ein','tax_year','recipient_name','grant_amount','classification','classification_confidence','classification_reason','evidence_used','review_status','admin_correction'];
    downloadFile('phase2_cef_classifications.csv','text/csv',toCsv(src,hdr));
  }
  // ── First-pass reviewed exports ────────────────────────────────────
  function exportPhase2GrantsReviewed(){
    const src = window.PHASE2_CEF_GRANTS_REVIEWED || PHASE2.grants;
    const hdr=['grant_id','source_entity','source_ein','tax_year','tax_period','schedule','recipient_name','recipient_ein','recipient_city','recipient_state','recipient_country','grant_amount','noncash_amount','grant_purpose','irc_section','source_filing','source_url','irs_object_id','extraction_confidence','classification','classification_confidence','classification_reason','evidence_used','review_status','admin_correction','notes','original_classification','updated_classification','review_confidence','review_reason','review_evidence','review_method','auto_resolved','left_for_review','review_category','first_pass_timestamp','first_pass_version','reviewer','admin_correction_placeholder','admin_correction_note'];
    downloadFile('phase2_cef_grants_reviewed.csv','text/csv',toCsv(src,hdr));
  }
  function exportPhase2ClassificationsReviewed(){
    const src = window.PHASE2_CEF_CLASSIFICATIONS_REVIEWED || PHASE2.classifications;
    const hdr=['grant_id','source_entity','source_ein','tax_year','recipient_name','grant_amount','classification','classification_confidence','classification_reason','evidence_used','review_status','admin_correction','original_classification','updated_classification','review_confidence','review_reason','review_evidence','review_method','auto_resolved','left_for_review','review_category','first_pass_timestamp','first_pass_version','reviewer'];
    downloadFile('phase2_cef_classifications_reviewed.csv','text/csv',toCsv(src,hdr));
  }
  function exportNeedResearchReduced(){
    const src = PHASE2.need_research_reduced || [];
    const hdr=['grant_id','source_entity','source_ein','tax_year','recipient_name','recipient_ein','recipient_city','recipient_state','grant_amount','grant_purpose','original_classification','updated_classification','review_category','review_confidence','review_method','review_reason','review_evidence','first_pass_timestamp','first_pass_version'];
    downloadFile('phase2_cef_need_research_reduced.csv','text/csv',toCsv(src,hdr));
  }
  function exportUnresolvedReviewQueue(){
    const src = PHASE2.unresolved_review_queue || [];
    const hdr=['grant_id','source_entity','source_ein','tax_year','recipient_name','recipient_ein','recipient_city','recipient_state','grant_amount','grant_purpose','original_classification','updated_classification','review_category','review_confidence','review_method','review_reason','review_evidence','first_pass_timestamp','first_pass_version'];
    downloadFile('phase2_cef_unresolved_review_queue.csv','text/csv',toCsv(src,hdr));
  }
  function exportAutoResolvedLog(){
    const src = PHASE2.auto_resolved_log || [];
    const hdr=['grant_id','recipient_name','recipient_ein','recipient_city','recipient_state','grant_amount','source_entity','original_classification','updated_classification','confidence','method','reason','evidence','first_pass_timestamp'];
    downloadFile('phase2_cef_auto_resolved_log.csv','text/csv',toCsv(src,hdr));
  }
  function exportAdminEdgeCases(){
    // Edge cases: anything in unresolved queue that is NOT 'insufficient_signal' —
    // i.e., ambiguous_intermediary, interfaith_mixed, temple_ambiguous.
    const src = (PHASE2.unresolved_review_queue || []).filter(r=>r.review_category && r.review_category!=='insufficient_signal');
    const hdr=['grant_id','recipient_name','recipient_ein','recipient_city','recipient_state','grant_amount','source_entity','review_category','review_method','review_reason','review_evidence','original_classification','updated_classification','review_confidence','first_pass_timestamp','first_pass_version'];
    downloadFile('phase2_cef_admin_edge_cases.csv','text/csv',toCsv(src,hdr));
  }
  function exportTop500JewishRecipients(){
    // Alias for exportTop500Public, but always reflects the Jewish-only gated
    // public Top 500 list with support fields.
    if(typeof exportTop500Public==='function') return exportTop500Public();
  }
  function exportDecisionLog(){
    downloadFile('atlas_cef_admin_decision_log.json','application/json',JSON.stringify({
      session_id: window.__atlas_session_id||null,
      generated_at: nowIso(),
      persistence: 'in_session_only',
      entries: decisionLog
    },null,2));
  }
  function exportAdminBundle(){
    const bundle = {
      generated_at: nowIso(),
      persistence: 'in_session_only',
      session_id: window.__atlas_session_id || null,
      verified_metadata: window.VERIFIED_COMMUNITY_ENTITIES || null,
      phase2_filings: PHASE2.filings,
      phase2_grants_original: PHASE2.grants_original || PHASE2.grants,
      phase2_grants_reviewed: PHASE2.grants,
      phase2_expenses: PHASE2.expenses,
      phase2_review_queue: PHASE2.review,
      phase2_classifications_original: PHASE2.classifications_original || PHASE2.classifications,
      phase2_classifications_reviewed: PHASE2.classifications,
      phase2_need_research_reduced: PHASE2.need_research_reduced || [],
      phase2_unresolved_review_queue: PHASE2.unresolved_review_queue || [],
      phase2_auto_resolved_log: PHASE2.auto_resolved_log || [],
      phase2_reviewed_meta: PHASE2.reviewed_meta || null,
      phase2_audit_seed: PHASE2.audit,
      phase2_meta: PHASE2.meta,
      admin_decision_log: decisionLog
    };
    downloadFile('atlas_phase2_cef_admin_bundle.json','application/json',JSON.stringify(bundle,null,2));
  }
  window.exportVerifiedMetadata=exportVerifiedMetadata;
  window.exportPhase2Filings=exportPhase2Filings;
  window.exportPhase2Grants=exportPhase2Grants;
  window.exportPhase2Expenses=exportPhase2Expenses;
  window.exportPhase2Review=exportPhase2Review;
  window.exportUnclearNeedsReview=exportUnclearNeedsReview;
  window.exportParentGroupMapping=exportParentGroupMapping;
  window.exportInternalFundMapping=exportInternalFundMapping;
  window.exportPossibleDoubleCounting=exportPossibleDoubleCounting;
  window.exportPhase2Classifications=exportPhase2Classifications;
  window.exportDecisionLog=exportDecisionLog;
  window.exportAdminBundle=exportAdminBundle;
  window.exportPhase2GrantsReviewed=exportPhase2GrantsReviewed;
  window.exportPhase2ClassificationsReviewed=exportPhase2ClassificationsReviewed;
  window.exportNeedResearchReduced=exportNeedResearchReduced;
  window.exportUnresolvedReviewQueue=exportUnresolvedReviewQueue;
  window.exportAutoResolvedLog=exportAutoResolvedLog;
  window.exportAdminEdgeCases=exportAdminEdgeCases;
  window.exportTop500JewishRecipients=exportTop500JewishRecipients;

  // ─────── CEF stat strip on dashboard (informational, layer-aware) ───────
  // When user selects "Communities / Endowments / Funds" or "All Data", show
  // a small Phase 2 totals card under the existing stat-cards row.
  function ensureCefStatStrip(){
    let strip=$('cefStatStrip');
    if(!strip){
      strip=document.createElement('div');
      strip.id='cefStatStrip';
      strip.style.cssText='display:none;background:linear-gradient(135deg,rgba(245,158,11,0.06),rgba(99,102,241,0.04));border:1px solid rgba(245,158,11,0.22);border-radius:var(--radius);padding:14px 18px;margin:-8px 0 24px 0;font-size:0.78rem;color:var(--text);';
      const stats=$('statCards');
      if(stats && stats.parentNode){ stats.parentNode.insertBefore(strip, stats.nextSibling); }
    }
    return strip;
  }
  function updateCefStatStrip(){
    const strip=ensureCefStatStrip();
    const set = window.entityLayerSet || new Set();
    const show = set.has('community');
    if(!show){ strip.style.display='none'; return; }
    const m=PHASE2.meta||{};
    const rm=PHASE2.reviewed_meta||{};
    const rmAmounts = rm.updated_classification_amounts || {};
    // Prefer reviewed (first-pass) counts; fall back to original meta
    const jewish = (rm.final_jewish!=null?rm.final_jewish:(m.classifications&&m.classifications.Jewish)||0);
    const nonJewish = (rm.final_nonjewish!=null?rm.final_nonjewish:(m.classifications&&(m.classifications['Non-Jewish']||m.classifications.Non_Jewish))||0);
    const needResearch = (rm.still_need_research!=null?rm.still_need_research:(m.classifications&&(m.classifications.Need_Research||m.classifications['Need Research']))||0);
    const startingNR = rm.starting_need_research;
    const autoJ = rm.auto_resolved_jewish;
    const autoNJ = rm.auto_resolved_nonjewish;
    const resPct = rm.resolution_rate_of_starting_nr_pct;
    const jewishAmt = rmAmounts.Jewish;
    const njAmt = rmAmounts['Non-Jewish'];
    const nrAmt = rmAmounts.Need_Research || rmAmounts['Need Research'];
    strip.style.display='block';
    strip.innerHTML = `
      <strong style="color:#fde68a;">Community / Endowment / Fund — Phase 2 990 extraction</strong>
      <span style="color:var(--text-muted);margin-left:8px;">Tax years ${esc((m.tax_years_filings||[]).join(', ')||'—')} · most recent year only for Schedule I rows. <em>Classifications reflect first-pass reviewed dataset.</em></span>
      <div style="display:flex;flex-wrap:wrap;gap:18px;margin-top:8px;font-variant-numeric:tabular-nums;">
        <div><strong>${esc(m.total_entities_loaded||0)}</strong> entities loaded</div>
        <div><strong>${esc(m.separate_filing_entities||0)}</strong> separate filers</div>
        <div><strong>${esc(m.xml_filings_downloaded||0)}</strong> XML 990s</div>
        <div><strong>${esc(m.total_filing_records||0)}</strong> filing records</div>
        <div><strong>${esc(m.total_grant_rows_extracted||0)}</strong> grant rows · <strong>${fmtMoney(m.total_grant_amount||0)}</strong></div>
        <div><strong>${esc(jewish)}</strong> Jewish ${jewishAmt!=null?'<span style="color:var(--text-muted);">('+fmtMoney(jewishAmt)+')</span>':''} · <strong>${esc(nonJewish)}</strong> Non-Jewish ${njAmt!=null?'<span style="color:var(--text-muted);">('+fmtMoney(njAmt)+')</span>':''} · <strong>${esc(needResearch)}</strong> Need Research ${nrAmt!=null?'<span style="color:var(--text-muted);">('+fmtMoney(nrAmt)+')</span>':''}</div>
        ${startingNR!=null?`<div style="color:var(--text-muted);">First-pass: <strong style="color:var(--text);">${esc(autoJ||0)}</strong> auto→Jewish, <strong style="color:var(--text);">${esc(autoNJ||0)}</strong> auto→Non-Jewish from ${esc(startingNR)} starting NR (${esc(resPct||0)}% resolved)</div>`:''}
        <div><strong>${esc(m.review_queue_items||0)}</strong> legacy review items</div>
      </div>
      <div style="margin-top:6px;color:var(--text-muted);font-size:0.72rem;">
        Top 500 is gated to Jewish / Jewish-aligned recipients with verified classification. Need Research and Non-Jewish-only amounts do not qualify. Layer totals are <em>upper bounds</em> — possible double-counting with Federation parents has not been netted out. See Admin → CEF Review Queue.
      </div>`;
  }

  // ─────── Top 500 — CEF inclusion via quality-gated record builder ──────
  // Goal: CEF Phase 2 recipients that pass data-quality gating are added to
  // the SAME public Top 500 list (JRL) used by the original Jewish-recipients
  // table, so they render through the exact same 9-column clean layout, with
  // identical styling, spacing, and behavior. CEF-only metadata (source
  // layer, certainty, J/NJ/NR counts, confidence) is preserved on a parallel
  // detail index used by drilldowns/exports/Admin only — never shown in the
  // visible Top 500 cells. Recipients that fail any required quality check
  // are excluded from the public table and pushed to the Top 500 review
  // queue surfaced in Admin.

  // Normalized state codes (US + territories). Anything else is treated as
  // unverifiable for inclusion in the public Top 500 table.
  const US_STATE_RE = /^(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC|PR|VI|GU|AS|MP)$/;

  function classifyConfidenceScore(confArr){
    if(!confArr || !confArr.length) return 0;
    const order={high:1, medium:0.6, low:0.3, '':0};
    let s=0,n=0;
    confArr.forEach(c=>{ s+=(order[c]==null?0:order[c]); n+=1; });
    return n? +(s/n).toFixed(3): 0;
  }

  function topSubjectFromMap(subjMap){
    if(!subjMap || !subjMap.size) return '';
    let best=null, bestV=-Infinity;
    subjMap.forEach((v,k)=>{ if(v>bestV){bestV=v; best=k;}});
    return best||'';
  }

  function yrRangeFromSet(yrSet){
    const ys=[...yrSet].map(y=>parseInt(y,10)).filter(Number.isFinite).sort((a,b)=>a-b);
    if(!ys.length) return '';
    if(ys[0]===ys[ys.length-1]) return String(ys[0]);
    return ys[0]+'–'+ys[ys.length-1];
  }

  // Aggregate Phase 2 CEF grants by recipient and produce two artifacts:
  //  1) PUBLIC_CEF_TOP500: clean records matching the JRL schema, gated on
  //     full data quality. Sorted desc by total_received.
  //  2) CEF_TOP500_REVIEW: records that failed at least one gate, with
  //     reasons[] and the same support fields, surfaced in Admin only.
  function buildCefRecipientAggregates(){
    const agg = new Map();
    for(const g of PHASE2.grants){
      const rawName=(g.recipient_name||'').trim();
      if(!rawName) continue; // unkeyable; skip from both public and review
      const key=rawName.toUpperCase();
      let r=agg.get(key);
      if(!r){
        r={
          recipient_name: rawName,
          recipient_ein: g.recipient_ein||'',
          recipient_city: (g.recipient_city||'').trim(),
          recipient_state: (g.recipient_state||'').trim().toUpperCase(),
          recipient_country: (g.recipient_country||'').trim().toUpperCase()||'US',
          total_received: 0,
          grant_count: 0,
          years: new Set(),
          grantmakers: new Set(),
          classifications: {Jewish:0,'Non-Jewish':0,'Need Research':0,'MISC':0},
          classification_amounts: {Jewish:0,'Non-Jewish':0,'Need Research':0,'MISC':0},
          // Jewish-confidence ledger: tally Jewish grant rows by review_confidence
          jewish_confidence_counts: {high:0, medium:0, low:0},
          jewish_confidence_amounts: {high:0, medium:0, low:0},
          subjects: new Map(),
          subjects_jewish: new Map(),
          source_filings: new Set(),
          source_urls: new Set(),
          extraction_confidences: [],
          classification_confidences: [],
          review_methods: new Set(),
          review_statuses: new Set(),
          had_missing_amount: false,
          had_unresolved_classification: false
        };
        agg.set(key,r);
      }
      const rawAmt=g.grant_amount;
      const amt=+rawAmt;
      if(rawAmt==null || rawAmt==='' || isNaN(amt) || amt<=0){
        r.had_missing_amount = true;
      } else {
        r.total_received += amt;
        r.grant_count += 1;
        const cls=g.classification||'Need Research';
        r.classifications[cls]=(r.classifications[cls]||0)+1;
        r.classification_amounts[cls]=(r.classification_amounts[cls]||0)+amt;
        if(g.grant_purpose) r.subjects.set(g.grant_purpose,(r.subjects.get(g.grant_purpose)||0)+amt);
        if(cls==='Jewish'){
          const conf=(g.review_confidence||g.classification_confidence||'low').toLowerCase();
          const bucket=(conf==='high'||conf==='medium'||conf==='low')?conf:'low';
          r.jewish_confidence_counts[bucket]+=1;
          r.jewish_confidence_amounts[bucket]+=amt;
          if(g.grant_purpose) r.subjects_jewish.set(g.grant_purpose,(r.subjects_jewish.get(g.grant_purpose)||0)+amt);
        }
      }
      if(g.tax_year) r.years.add(String(g.tax_year));
      if(g.source_entity) r.grantmakers.add(g.source_entity);
      if(g.source_filing) r.source_filings.add(g.source_filing);
      if(g.source_url) r.source_urls.add(g.source_url);
      if(g.extraction_confidence) r.extraction_confidences.push(g.extraction_confidence);
      if(g.classification_confidence) r.classification_confidences.push(g.classification_confidence);
      if(g.review_method) r.review_methods.add(g.review_method);
      if(g.review_status) r.review_statuses.add(g.review_status);
      if(!g.classification || g.classification==='Need Research') r.had_unresolved_classification = true;
    }
    return agg;
  }

  // Detect duplicate keys against the existing foundation/federation JRL so
  // we never double-count a recipient that's already present in the public
  // Top 500.  Match by case-insensitive normalized name.
  function existingJrlNameSet(){
    const s=new Set();
    try{
      const list = window.JRL || [];
      list.forEach(r=>{ if(r&&r.name) s.add(String(r.name).trim().toUpperCase()); });
    }catch(e){}
    return s;
  }

  function gateRecipient(r, existingSet){
    const reasons=[];
    // ── Schema gate ────────────────────────────────────────────────────────
    if(!r.recipient_name) reasons.push('missing_recipient_name');
    if(!r.recipient_city) reasons.push('missing_recipient_city');
    if(!r.recipient_state) reasons.push('missing_recipient_state');
    else if(!US_STATE_RE.test(r.recipient_state)) reasons.push('unrecognized_recipient_state');
    if(!(r.total_received>0)) reasons.push('incomplete_grant_amount');
    if(r.grant_count<1) reasons.push('no_valid_grant_rows');
    if(r.grantmakers.size<1) reasons.push('uncertain_source_filing');
    if(r.source_filings.size<1) reasons.push('uncertain_source_filing');
    if(!r.years.size) reasons.push('missing_active_year_range');
    const extScore=classifyConfidenceScore(r.extraction_confidences);
    if(extScore < 0.5) reasons.push('low_extraction_confidence');
    if(existingSet.has(r.recipient_name.trim().toUpperCase())) reasons.push('duplicate_match_with_existing_top500');
    if(r.recipient_name.length < 3 || !/[A-Za-z]/.test(r.recipient_name)) reasons.push('unclear_identity');

    // ── Jewish / Jewish-aligned classification gate ────────────────────────
    // The public Top 500 panel is Jewish-only: a recipient must have at least
    // one Jewish-classified grant with verified, structured, confident
    // classification (review_confidence high or medium). Need Research and
    // Non-Jewish amounts do not qualify a recipient.
    const jewishCount = r.classifications.Jewish || 0;
    const jewishAmount = r.classification_amounts.Jewish || 0;
    const highMediumJewishCount = (r.jewish_confidence_counts.high||0) + (r.jewish_confidence_counts.medium||0);
    const highMediumJewishAmount = (r.jewish_confidence_amounts.high||0) + (r.jewish_confidence_amounts.medium||0);
    if(jewishCount === 0){
      reasons.push('not_jewish_classified');
    } else if(highMediumJewishCount === 0){
      // Jewish-flagged but only low-confidence (no high/medium review signal)
      reasons.push('low_confidence_jewish_only');
    } else if(highMediumJewishAmount <= 0){
      reasons.push('jewish_amount_unverified');
    }

    // Subject required (use Jewish subjects when present, fall back to all)
    if(!topSubjectFromMap(r.subjects_jewish && r.subjects_jewish.size ? r.subjects_jewish : r.subjects)){
      reasons.push('unresolved_classification');
    }
    return reasons;
  }

  function toJrlRecord(r){
    // Visible Top 500 columns match the original JRL schema EXACTLY. The
    // monetary total displayed for a CEF recipient is its Jewish-classified
    // amount, not gross received — the panel is Jewish-only by design.
    // Grants count is the number of Jewish-classified grant rows.
    const jewishAmt = r.classification_amounts.Jewish || 0;
    const jewishCount = r.classifications.Jewish || 0;
    const subjMap = (r.subjects_jewish && r.subjects_jewish.size) ? r.subjects_jewish : r.subjects;
    return {
      name: r.recipient_name,
      city: r.recipient_city,
      state: r.recipient_state,
      total: jewishAmt,
      count: jewishCount,
      yr_range: yrRangeFromSet(r.years),
      top_subject: topSubjectFromMap(subjMap),
      fd_count: r.grantmakers.size,
      // Backend / drilldown / export support fields — NOT rendered in cells.
      __source: 'cef'
    };
  }

  function buildCefDetailFromAgg(r){
    // Detail object compatible with the existing Jewish recipient modal
    // (year_breakdown, foundation_breakdown, subject_breakdown). Built from
    // Phase 2 grants for this recipient.
    const yrBreak={}, fdBreak={}, subjList=[];
    const grants = (PHASE2.grants||[]).filter(g=>(g.recipient_name||'').trim()===r.recipient_name);
    grants.forEach(g=>{
      const yr=String(g.tax_year||'');
      const amt=+g.grant_amount||0;
      if(amt<=0) return;
      const subj=g.grant_purpose||'Charitable';
      yrBreak[yr] = yrBreak[yr] || {total:0,count:0,subjects:[]};
      yrBreak[yr].total+=amt; yrBreak[yr].count+=1;
      const sIdx = yrBreak[yr].subjects.findIndex(s=>s[0]===subj);
      if(sIdx>-1) yrBreak[yr].subjects[sIdx][1]+=amt; else yrBreak[yr].subjects.push([subj,amt]);
      const fdKey=g.source_entity||'(unknown)';
      fdBreak[fdKey] = fdBreak[fdKey] || {total:0,count:0,top_subject:subj};
      fdBreak[fdKey].total+=amt; fdBreak[fdKey].count+=1;
      const ix=subjList.findIndex(s=>s[0]===subj);
      if(ix>-1) subjList[ix][1]+=amt; else subjList.push([subj,amt]);
    });
    subjList.sort((a,b)=>b[1]-a[1]);
    return {
      year_breakdown: yrBreak,
      foundation_breakdown: fdBreak,
      subject_breakdown: subjList,
      __source: 'cef',
      __cef_meta: {
        source_entity_layer: 'community',
        source_filings: [...r.source_filings],
        source_urls: [...r.source_urls],
        grantmakers: [...r.grantmakers],
        classification_breakdown: r.classifications,
        classification_amounts: r.classification_amounts,
        extraction_confidence_score: classifyConfidenceScore(r.extraction_confidences),
        classification_confidence_score: classifyConfidenceScore(r.classification_confidences),
        verification_status: r.review_statuses.size ? 'cef_phase2_extracted' : 'cef_phase2_unverified',
        review_status: r.review_statuses.has('needs_review') ? 'needs_review' : (r.review_statuses.size? [...r.review_statuses].join('; '):'extracted')
      }
    };
  }

  // Build / refresh public CEF top 500 list and review queue. Cached and
  // invalidated when entityLayerSet changes (cheap).
  let CEF_TOP500_CACHE = null;
  function buildCefTop500(){
    if(CEF_TOP500_CACHE) return CEF_TOP500_CACHE;
    const agg = buildCefRecipientAggregates();
    const existing = existingJrlNameSet();
    const admitted = [];
    const excluded = [];
    const aggList = [];
    agg.forEach(r=>{
      aggList.push(r);
      const reasons = gateRecipient(r, existing);
      if(reasons.length===0){
        admitted.push(r);
      } else {
        excluded.push({recipient:r, reasons});
      }
    });
    // Sort by Jewish-classified amount (the public Top 500 panel is Jewish-only).
    admitted.sort((a,b)=>(b.classification_amounts.Jewish||0)-(a.classification_amounts.Jewish||0));
    // Public top 500 records in JRL schema
    const publicTop = admitted.slice(0,500).map(toJrlRecord);
    // Detail index keyed by recipient_name for drilldown / Admin / export
    const publicDetailIndex = {};
    const supportIndex = {};
    admitted.slice(0,500).forEach(r=>{
      publicDetailIndex[r.recipient_name] = buildCefDetailFromAgg(r);
      supportIndex[r.recipient_name] = r;
    });
    CEF_TOP500_CACHE = {
      considered: aggList.length,
      admitted_total: admitted.length,
      admitted_top500: publicTop,
      admitted_support: supportIndex,
      admitted_details: publicDetailIndex,
      excluded: excluded
    };
    return CEF_TOP500_CACHE;
  }
  function invalidateCefTop500(){ CEF_TOP500_CACHE=null; }
  window.invalidateCefTop500 = invalidateCefTop500;
  window.buildCefTop500 = buildCefTop500;

  // Snapshot the original foundation/federation JRL / JRD on first sight so
  // we can rebuild a layer-aware merged list each render without losing
  // foundation/federation data.
  let BASE_JRL_FF = null;
  let BASE_JRD_FF = null;
  function snapshotBaseJrl(){
    if(BASE_JRL_FF) return;
    try{
      BASE_JRL_FF = JSON.parse(JSON.stringify(window.JRL||[]));
      BASE_JRD_FF = JSON.parse(JSON.stringify(window.JRD||{}));
    }catch(e){
      BASE_JRL_FF = (window.JRL||[]).slice();
      BASE_JRD_FF = Object.assign({}, window.JRD||{});
    }
  }

  // Layer-aware JRL synthesis: returns the list that should be shown for
  // the currently-selected entity layer (foundation/federation/community/all).
  // Foundations + Federations data comes from BASE_JRL_FF (the original
  // foundation/federation Top Recipients). Community/CEF data comes from
  // the gated CEF Top 500 builder.
  function synthesizeJrlForLayer(){
    snapshotBaseJrl();
    const set = window.entityLayerSet || new Set(['foundation','federation','community']);
    const includeFF = set.has('foundation') || set.has('federation');
    const includeCef = set.has('community');
    const out = [];
    const outDetail = {};
    if(includeFF){
      (BASE_JRL_FF||[]).forEach(r=>{ out.push(Object.assign({}, r, {__source:'foundation_federation'})); });
      Object.entries(BASE_JRD_FF||{}).forEach(([k,v])=>{ outDetail[k]=v; });
    }
    if(includeCef){
      const cef = buildCefTop500();
      // Exclude any CEF records whose name collides with existing FF records
      // that are already in `out` (defense-in-depth — the gate already does
      // this).
      const present = new Set(out.map(r=>String(r.name||'').trim().toUpperCase()));
      cef.admitted_top500.forEach(r=>{
        if(!present.has(String(r.name||'').trim().toUpperCase())){
          out.push(r);
          present.add(String(r.name||'').trim().toUpperCase());
        }
      });
      Object.entries(cef.admitted_details).forEach(([k,v])=>{ if(!outDetail[k]) outDetail[k]=v; });
    }
    // Sort merged list desc by total received (normalized verified totals).
    out.sort((a,b)=>(+b.total||0)-(+a.total||0));
    return {list: out.slice(0,500), detail: outDetail};
  }

  // Apply the synthesized list to the dashboard's JRL/JRD globals before the
  // original buildJewishRecTable runs, so the original 9-column renderer is
  // the single source of truth for visible rows.
  function applyLayerAwareJrl(){
    const {list, detail} = synthesizeJrlForLayer();
    window.JRL = list;
    // Merge details: keep FF detail entries and add CEF detail entries.
    window.JRD = Object.assign({}, detail);
  }

  // Wrap buildJewishRecTable: refresh JRL for layer THEN run original.
  function patchJewishRecTable(){
    const orig = window.buildJewishRecTable;
    if(typeof orig!=='function') return false;
    if(window.__patchedJewishRecTable) return true;
    window.__patchedJewishRecTable=true;
    // Capture FF baseline as soon as we patch (current JRL = foundation/federation data).
    snapshotBaseJrl();
    window.buildJewishRecTable = function(){
      try{ applyLayerAwareJrl(); }catch(e){ /* keep going */ }
      // Refresh state-filter options to include CEF states without losing user selection.
      try{
        const sel = document.getElementById('jewishRecStateFilter');
        if(sel && typeof window.buildJewishRecStateFilter==='function'){
          const prev = sel.value;
          window.buildJewishRecStateFilter();
          // Restore prior selection if still valid
          const opts=[...sel.options].map(o=>o.value);
          if(opts.includes(prev)) sel.value=prev;
        }
      }catch(e){}
      return orig.apply(this, arguments);
    };
    return true;
  }
  let _patchTries=0; const _patchTimer=setInterval(()=>{
    _patchTries++;
    if(patchJewishRecTable() || _patchTries>40) clearInterval(_patchTimer);
  }, 200);

  // ─────── Top 500 review queue panel (Admin) + export ───────────────────
  function REASON_LABEL(code){
    return ({
      missing_recipient_name:'Missing recipient name',
      missing_recipient_city:'Missing recipient city',
      missing_recipient_state:'Missing recipient state',
      unrecognized_recipient_state:'Unrecognized recipient state',
      incomplete_grant_amount:'Incomplete grant amount',
      no_valid_grant_rows:'No valid grant rows',
      uncertain_source_filing:'Uncertain source filing',
      missing_active_year_range:'Missing active year range',
      low_extraction_confidence:'Low extraction confidence',
      unresolved_classification:'Unresolved classification',
      duplicate_match_with_existing_top500:'Duplicate match with existing Top 500',
      unclear_identity:'Unclear recipient identity',
      not_jewish_classified:'Not Jewish-classified (Need Research / Non-Jewish only)',
      low_confidence_jewish_only:'Jewish-flagged but only low-confidence rows',
      jewish_amount_unverified:'Jewish amount unverified'
    })[code] || code;
  }

  function renderTop500ReviewPanel(){
    const host = $('adminTop500ReviewQueue');
    if(!host) return;
    const cache = buildCefTop500();
    const reasonCounts = {};
    cache.excluded.forEach(({reasons})=>reasons.forEach(c=>{ reasonCounts[c]=(reasonCounts[c]||0)+1; }));
    const reasonSummary = Object.entries(reasonCounts).sort((a,b)=>b[1]-a[1])
      .map(([c,n])=>`<span style="display:inline-block;background:rgba(99,102,241,0.10);border:1px solid var(--border);border-radius:999px;padding:3px 9px;font-size:0.68rem;color:#c7d2fe;margin:2px 4px 2px 0;">${esc(REASON_LABEL(c))} · ${n}</span>`).join('');
    const rows = cache.excluded
      .slice()
      .sort((a,b)=>(b.recipient.total_received||0)-(a.recipient.total_received||0))
      .slice(0,400)
      .map(({recipient:r,reasons})=>`
        <tr>
          <td>${esc(r.recipient_name||'(unnamed)')}</td>
          <td><code style="color:#cbd5e1;font-size:0.7rem;">${esc(r.recipient_ein||'—')}</code></td>
          <td>${esc(r.recipient_city||'—')}</td>
          <td>${esc(r.recipient_state||'—')}</td>
          <td style="text-align:right;font-variant-numeric:tabular-nums;">${r.total_received>0?fmtMoney(r.total_received):'—'}</td>
          <td style="text-align:right;">${r.grant_count||0}</td>
          <td>${reasons.map(c=>`<span style=\"color:#fca5a5;font-size:0.68rem;display:inline-block;margin:1px 4px 1px 0;\">${esc(REASON_LABEL(c))}</span>`).join('')}</td>
        </tr>`).join('');
    host.innerHTML = `
      <div class="cef-admin-section" data-testid="top500-review-queue">
        <h3>Top 500 schema review queue <span class="session-pill">${cache.excluded.length} excluded · CEF</span></h3>
        <div class="desc">
          CEF Phase 2 recipients that could not be normalized into the public Top 500 schema. The main Top 500 table
          shows only clean, verified, fully-structured recipients sorted by normalized totals; entries below are held
          out and shown here with reason codes for admin follow-up. Counts:
          considered <strong>${cache.considered}</strong> · admitted <strong>${cache.admitted_total}</strong> ·
          excluded <strong>${cache.excluded.length}</strong>.
        </div>
        <div style="margin:6px 0 10px;">${reasonSummary}</div>
        <div style="overflow:auto;max-height:520px;">
          <table class="cef-admin-table" data-testid="table-top500-review">
            <thead><tr><th>Recipient</th><th>EIN</th><th>City</th><th>State</th><th style="text-align:right;">Total</th><th style="text-align:right;">Grants</th><th>Reasons</th></tr></thead>
            <tbody>${rows||'<tr><td colspan="7" style="padding:18px;text-align:center;color:var(--text-muted);">No excluded CEF recipients — every CEF recipient passed the public Top 500 schema gate.</td></tr>'}</tbody>
          </table>
        </div>
        <div class="cef-export-grid" style="margin-top:14px;">
          <button class="cef-admin-btn" onclick="exportTop500Public()" data-testid="export-top500-public"><strong>Export Top 500 (public + support)</strong><div class="desc">Visible columns + source layer, filings, classification breakdown, confidence, review status</div></button>
          <button class="cef-admin-btn" onclick="exportTop500Excluded()" data-testid="export-top500-excluded"><strong>Export Top 500 review queue</strong><div class="desc">CEF recipients held out with reason codes</div></button>
        </div>
      </div>`;
  }
  window.renderTop500ReviewPanel = renderTop500ReviewPanel;

  // Top 500 public export with both visible fields and backend support fields.
  function exportTop500Public(){
    const cache = buildCefTop500();
    const set = window.entityLayerSet || new Set(['foundation','federation','community']);
    const layerName = set.size===3 ? 'all' : (set.size===1 ? [...set][0] : [...set].join('+'));
    const rows = (window.JRL||[]).map((r,i)=>{
      const support = (r.__source==='cef') ? cache.admitted_support[r.name] : null;
      const meta = support ? {
        jewish_amount: support.classification_amounts.Jewish||0,
        non_jewish_amount: support.classification_amounts['Non-Jewish']||0,
        need_research_amount: support.classification_amounts['Need Research']||0,
        misc_amount: support.classification_amounts.MISC||0,
        jewish_grant_count: support.classifications.Jewish||0,
        jewish_high_conf_amount: support.jewish_confidence_amounts.high||0,
        jewish_medium_conf_amount: support.jewish_confidence_amounts.medium||0,
        jewish_low_conf_amount: support.jewish_confidence_amounts.low||0,
        review_methods: [...support.review_methods].join('; '),
        source_entity_layer: 'community',
        source_filings: [...support.source_filings].join('; '),
        verification_status: support.review_statuses.has('needs_review') ? 'needs_review' : 'cef_phase2_extracted_first_pass_reviewed',
        extraction_confidence: classifyConfidenceScore(support.extraction_confidences),
        review_status: support.review_statuses.has('needs_review') ? 'needs_review' : [...support.review_statuses].join('; '),
        notes: 'Total = Jewish-classified amount (verified, high/medium review_confidence)'
      } : {
        jewish_amount: '',
        non_jewish_amount: '',
        need_research_amount: '',
        misc_amount: '',
        jewish_grant_count: '',
        jewish_high_conf_amount: '',
        jewish_medium_conf_amount: '',
        jewish_low_conf_amount: '',
        review_methods: '',
        source_entity_layer: 'foundation_federation',
        source_filings: '',
        verification_status: 'verified_top_recipients',
        extraction_confidence: '',
        review_status: 'verified',
        notes: ''
      };
      return {
        rank: i+1,
        recipient_name: r.name,
        city: r.city||'',
        state: r.state||'',
        total_received: r.total||0,
        grant_count: r.count||0,
        grantmaker_count: r.fd_count||0,
        active_year_range: r.yr_range||'',
        primary_subject: r.top_subject||'',
        jewish_amount: meta.jewish_amount,
        non_jewish_amount: meta.non_jewish_amount,
        need_research_amount: meta.need_research_amount,
        misc_amount: meta.misc_amount,
        jewish_grant_count: meta.jewish_grant_count,
        jewish_high_conf_amount: meta.jewish_high_conf_amount,
        jewish_medium_conf_amount: meta.jewish_medium_conf_amount,
        jewish_low_conf_amount: meta.jewish_low_conf_amount,
        review_methods: meta.review_methods,
        source_entity_layer: meta.source_entity_layer,
        source_filings: meta.source_filings,
        verification_status: meta.verification_status,
        extraction_confidence: meta.extraction_confidence,
        review_status: meta.review_status,
        notes: meta.notes
      };
    });
    const hdr=['rank','recipient_name','city','state','total_received','grant_count','grantmaker_count','active_year_range','primary_subject','jewish_amount','non_jewish_amount','need_research_amount','misc_amount','jewish_grant_count','jewish_high_conf_amount','jewish_medium_conf_amount','jewish_low_conf_amount','review_methods','source_entity_layer','source_filings','verification_status','extraction_confidence','review_status','notes'];
    downloadFile(`atlas_top500_jewish_recipients_${layerName}.csv`,'text/csv',toCsv(rows,hdr));
  }
  function exportTop500Excluded(){
    const cache = buildCefTop500();
    const rows = cache.excluded.map(({recipient:r, reasons})=>({
      recipient_name: r.recipient_name||'',
      recipient_ein: r.recipient_ein||'',
      city: r.recipient_city||'',
      state: r.recipient_state||'',
      total_received: r.total_received||0,
      grant_count: r.grant_count||0,
      grantmaker_count: r.grantmakers.size,
      active_year_range: yrRangeFromSet(r.years),
      primary_subject: topSubjectFromMap(r.subjects),
      jewish_amount: r.classification_amounts.Jewish||0,
      non_jewish_amount: r.classification_amounts['Non-Jewish']||0,
      need_research_amount: r.classification_amounts['Need Research']||0,
      misc_amount: r.classification_amounts.MISC||0,
      source_entity_layer: 'community',
      source_filings: [...r.source_filings].join('; '),
      verification_status: r.review_statuses.has('needs_review')?'needs_review':'cef_phase2_extracted',
      extraction_confidence: classifyConfidenceScore(r.extraction_confidences),
      review_status: r.review_statuses.has('needs_review')?'needs_review':[...r.review_statuses].join('; '),
      exclusion_reasons: reasons.map(c=>REASON_LABEL(c)).join('; '),
      exclusion_reason_codes: reasons.join('; ')
    }));
    const hdr=['recipient_name','recipient_ein','city','state','total_received','grant_count','grantmaker_count','active_year_range','primary_subject','jewish_amount','non_jewish_amount','need_research_amount','misc_amount','source_entity_layer','source_filings','verification_status','extraction_confidence','review_status','exclusion_reasons','exclusion_reason_codes'];
    downloadFile('atlas_top500_review_queue.csv','text/csv',toCsv(rows,hdr));
  }
  window.exportTop500Public = exportTop500Public;
  window.exportTop500Excluded = exportTop500Excluded;

  // ─────── public-dashboard CEF stat strip refresh on layer change ───────
  const origRefresh = window.refreshDashboardAfterDataLayer;
  window.refreshDashboardAfterDataLayer = function(){
    if(typeof origRefresh==='function') try{ origRefresh.apply(this,arguments); }catch(e){}
    updateCefStatStrip();
    // Force re-run buildJewishRecTable if available so CEF augmentation refreshes
    if(typeof window.buildJewishRecTable==='function') try{ window.buildJewishRecTable(); }catch(e){}
  };

  // ─────────── boot ───────────────────────────────────────────────────────
  function boot(){
    relocateCefIntoAdmin();
    ensureCefStatStrip();
    updateCefStatStrip();
    // Sync the chip UI to the existing default (all layers) without rebuilding
    // the dashboard — the page's own DOMContentLoaded handler already ran the
    // build pipeline once. We only need to flip the chip visuals.
    if(typeof window.updateEntityTypeControl==='function'){
      try{ window.updateEntityTypeControl(); }catch(e){}
    }
    // Make Admin re-render the new sections whenever Admin is opened.
    const origRenderAdmin = window.renderAdmin;
    window.renderAdmin = function(){
      if(typeof origRenderAdmin==='function') try{ origRenderAdmin.apply(this,arguments); }catch(e){}
      relocateCefIntoAdmin();
      renderCefAdminPanels();
      renderCefReviewedAdminPanels();
      renderTop500ReviewPanel();
      // Notices visible only on admin
      document.querySelectorAll('[data-admin-only="true"]').forEach(el=>{ el.style.display='block'; });
    };
    // setTopView wrapper: hide admin-only nodes when leaving Admin
    const origSetTopView = window.setTopView;
    window.setTopView = function(view){
      if(typeof origSetTopView==='function') try{ origSetTopView(view); }catch(e){}
      const onAdmin = (view==='admin');
      document.querySelectorAll('[data-admin-only="true"]').forEach(el=>{
        el.style.display = onAdmin?'block':'none';
      });
      if(onAdmin){
        relocateCefIntoAdmin();
        renderCefAdminPanels();
        renderCefReviewedAdminPanels();
        renderTop500ReviewPanel();
      } else {
        updateCefStatStrip();
      }
    };
  }
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
