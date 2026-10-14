// ─────────────────────────────────────────────────────────────────────────────
// Updates Center · Admin-only Updates page
// Owns the Future Autonomous Mode Framework: schedule, run, preview, approve,
// merge, version, and notify. Mounts under #adminUpdatesView. No autonomous
// merges — every package waits for Admin approval before touching live data.
// ─────────────────────────────────────────────────────────────────────────────
(function(){
  'use strict';

  // ── Tiny helpers ───────────────────────────────────────────────────────────
  const $ = (id)=>document.getElementById(id);
  const escH = (s)=> (s==null?'':String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]));
  const nowIso = ()=> new Date().toISOString();
  const fmtTs = (iso)=> { if(!iso) return '—'; try{ const d=new Date(iso); return d.toLocaleString(); }catch(e){ return iso; } };
  const fmtNum = (n)=> (n==null||isNaN(+n))?'—':(+n).toLocaleString();
  const uid = (p)=> p+'-'+Math.random().toString(36).slice(2,9)+'-'+Date.now().toString(36);

  // ── Admin gating ───────────────────────────────────────────────────────────
  // Default: admin enabled. Stored in an in-memory flag (preview iframes do
  // not allow localStorage). Admin can flip via the Admin badge in the Updates
  // header or via: window.UPDATES_CENTER.setAdmin(true|false)
  let __ADMIN_ROLE = true;
  function isAdmin(){ return !!__ADMIN_ROLE; }
  function setAdmin(v){
    __ADMIN_ROLE = !!v;
    applyAdminVisibility();
    if(typeof window.setTopView === 'function' && !v && document.body.classList.contains('updates-active')){
      window.setTopView('admin');
    }
  }
  function applyAdminVisibility(){
    const nav = $('navUpdates');
    if(nav){ nav.hidden = !isAdmin(); }
  }

  // ── State ──────────────────────────────────────────────────────────────────
  const FREQ = ['manual','daily','weekly','biweekly','monthly','quarterly','custom'];
  const APPROVAL_STATES = [
    'not_started','running','draft_created','debug_complete','review_needed',
    'pending_approval','approved_for_merge','merged','rejected','failed'
  ];

  // Card definitions — the six framework cards.
  const CARDS = [
    {
      id:'irs_updates',
      title:'Scheduled IRS Updates',
      desc:'Pulls the latest available IRS Form 990 data and refreshes filing metadata for foundations in the dashboard.',
      sources:['IRS Form 990 indexes (e-file XML)','IRS 990-PF filings','IRS 990 all-year completion index'],
      actions:[
        {key:'run_irs_update',  label:'Run IRS Update Now'},
        {key:'pull_latest_990', label:'Pull latest Form 990 data'},
        {key:'refresh_metadata',label:'Refresh IRS filing metadata'}
      ],
      panels:['Foundation Details','Latest IRS Data','Money Flow / Double-Counting']
    },
    {
      id:'ein_enrichment',
      title:'ProPublica / EIN Enrichment',
      desc:'Refreshes recipient metadata from ProPublica Nonprofit Explorer, updates NTEE category clues, and verifies EIN matches.',
      sources:['ProPublica Nonprofit Explorer API','IRS EIN lookup','NTEE classification crosswalk'],
      actions:[
        {key:'run_ein_enrichment',     label:'Run EIN Enrichment Now'},
        {key:'refresh_recipient_meta', label:'Refresh recipient metadata'},
        {key:'update_ntee',            label:'Update NTEE / category clues'},
        {key:'verify_ein',             label:'Verify EIN matches'}
      ],
      panels:['Recipient detail','CEF Details','Enrichment evidence log']
    },
    {
      id:'source_checks',
      title:'Reliable Source Checks',
      desc:'Verifies recipient organizations against approved external sources only. Conflicts are routed to the review queue, never auto-merged.',
      sources:['Organization websites','IRS','ProPublica','Known verified .org domains','Public records'],
      actions:[
        {key:'run_source_verification', label:'Run Source Verification Now'},
        {key:'check_org_websites',      label:'Check organization websites'},
        {key:'cross_check_known_sources',label:'Cross-check IRS / ProPublica / known.org'}
      ],
      panels:['Source evidence table','Identity Review Queue']
    },
    {
      id:'classification_passes',
      title:'Classification Passes',
      desc:'Runs the JLO engine, Need-Research reduction pass, and second-pass enrichment. Recalculates classifications across the full dashboard.',
      sources:['Auto-resolved classification log','Master issue seed','Learning rules seed','Pattern library'],
      actions:[
        {key:'run_classification_pass', label:'Run Classification Pass Now'},
        {key:'run_jlo',                 label:'Run Jewish Linkage Verification Engine'},
        {key:'run_need_research_reduce',label:'Run Need-Research reduction pass'},
        {key:'run_second_pass',         label:'Run second-pass enrichment'},
        {key:'recalculate_classifications', label:'Recalculate classifications'}
      ],
      panels:['Classifications','Top 500 Jewish Recipients','Jewish / Non-Jewish review']
    },
    {
      id:'debug_consistency',
      title:'Debug / Consistency Checks',
      desc:'Validates totals, joins, duplicates, double-counting risks, broken records, and missing fields across all dashboard layers.',
      sources:['Foundation Directory','CEF / Federation layers','Master issue table','Money flow logic'],
      actions:[
        {key:'run_debug_check',        label:'Run Debug Check Now'},
        {key:'validate_totals',        label:'Validate totals'},
        {key:'check_joins',            label:'Check joins'},
        {key:'detect_duplicates',      label:'Detect duplicates'},
        {key:'detect_double_counting', label:'Detect double-counting risks'},
        {key:'check_missing_fields',   label:'Check broken records / missing fields'}
      ],
      panels:['Master Issue Table','Audit trail','Double-counting risk table']
    },
    {
      id:'pre_change_notifications',
      title:'Pre-Change Notifications',
      desc:'Generates a preview of pending changes and notifies Admin before any merge. Nothing is applied until Admin approves.',
      sources:['Update packages awaiting approval','Audit trail','Notifications log'],
      actions:[
        {key:'generate_preview',  label:'Generate Update Preview'},
        {key:'notify_admin',      label:'Notify Admin of pending changes'},
        {key:'show_pending',      label:'Show pending changes before merge'}
      ],
      panels:['Notifications & Alerts','Approval queue']
    }
  ];

  // Persistent-ish state (in-session; survives view switches; reset on reload).
  const STATE = {
    cards: {},
    packages: [],            // update packages by id
    versions: [],            // dashboard version history
    notifications: [],
    activity: [],            // run history / audit
    selectedPackageId: null
  };

  CARDS.forEach(c=>{
    STATE.cards[c.id] = {
      id:c.id,
      title:c.title,
      status:'idle',                  // idle | running | preview_ready | pending_approval | merged | failed
      mode:'Admin approval required', // current mode pill
      enabled:false,                  // schedule active
      frequency:'manual',
      time:'02:00',                   // HH:MM (UTC by default)
      day_of_week:'monday',
      day_of_month:1,
      start_date:'',
      end_date:'',
      custom_interval_hours:24,
      paused:false,
      last_run:null,
      last_success:null,
      last_failed:null,
      next_run:null,
      records_checked:0,
      records_changed:0,
      records_needing_review:0,
      records_added:0,
      classification_changes:0,
      duplicates_found:0,
      errors:0,
      pending_package_id:null,
      runs:[]                          // run log per card
    };
  });

  function seedNotifications(){
    pushNotification({severity:'info', card:'pre_change_notifications', kind:'system',
      title:'Updates page is admin-approval only',
      summary:'The Updates engine can prepare packages and previews. Merges require Admin approval.'});
  }

  // ── Notifications ──────────────────────────────────────────────────────────
  function pushNotification(n){
    const item = {
      id:uid('NOTE'),
      timestamp:nowIso(),
      viewed:false,
      severity:'info',
      ...n
    };
    STATE.notifications.unshift(item);
    renderNotifications();
    // Mirror critical notifications into the existing admin notification stream if present
    try{
      if(window.ADMIN_DECISION_CENTER_API && typeof window.ADMIN_DECISION_CENTER_API.pushNotification === 'function'){
        window.ADMIN_DECISION_CENTER_API.pushNotification({
          severity:item.severity, section:'Updates',
          alert_type:item.kind||'updates', title:item.title, summary:item.summary,
          action_required: item.action_required || 'Open Updates page.'
        });
      }
    }catch(e){}
    return item.id;
  }

  function logActivity(card_id, kind, payload){
    // Keep STATE.activity[] for back-compat with any in-session consumer.
    STATE.activity.unshift({ id:uid('ACT'), timestamp:nowIso(), card_id, kind, ...payload });
    // Bridge into persistent audit trail (AUDIT_LOG owns its own render).
    try{
      if(window.AUDIT_LOG && typeof window.AUDIT_LOG.appendFromLegacy === 'function'){
        window.AUDIT_LOG.appendFromLegacy(card_id, kind, payload||{});
      }
    }catch(e){ /* never block primary flow */ }
    renderActivityLog();
  }

  // ── Schedule preview ───────────────────────────────────────────────────────
  function computeNextRun(card){
    if(card.paused || !card.enabled) return null;
    const f = card.frequency;
    if(f === 'manual') return null;
    const [hh,mm] = (card.time||'02:00').split(':').map(x=>parseInt(x,10)||0);
    const now = new Date();
    const next = new Date(now);
    next.setSeconds(0); next.setMilliseconds(0);
    next.setHours(hh, mm, 0, 0);
    if(next <= now) next.setDate(next.getDate()+1);
    if(f === 'daily') {/* already set */}
    else if(f === 'weekly'){
      const dows={sunday:0,monday:1,tuesday:2,wednesday:3,thursday:4,friday:5,saturday:6};
      const target = dows[(card.day_of_week||'monday').toLowerCase()] ?? 1;
      while(next.getDay() !== target) next.setDate(next.getDate()+1);
    } else if(f === 'biweekly'){
      const dows={sunday:0,monday:1,tuesday:2,wednesday:3,thursday:4,friday:5,saturday:6};
      const target = dows[(card.day_of_week||'monday').toLowerCase()] ?? 1;
      while(next.getDay() !== target) next.setDate(next.getDate()+1);
      // bump to next biweekly slot if the resulting date is within 7 days of last run
      if(card.last_run){
        const last = new Date(card.last_run);
        const days = (next - last)/(1000*60*60*24);
        if(days < 14) next.setDate(next.getDate()+7);
      }
    } else if(f === 'monthly'){
      const dom = Math.max(1, Math.min(28, +card.day_of_month||1));
      next.setDate(dom);
      if(next <= now){ next.setMonth(next.getMonth()+1); next.setDate(dom); }
    } else if(f === 'quarterly'){
      const dom = Math.max(1, Math.min(28, +card.day_of_month||1));
      next.setDate(dom);
      if(next <= now){ next.setMonth(next.getMonth()+3); next.setDate(dom); }
    } else if(f === 'custom'){
      const h = Math.max(1, +card.custom_interval_hours||24);
      const base = card.last_run ? new Date(card.last_run) : now;
      const n2 = new Date(base.getTime() + h*60*60*1000);
      if(n2 <= now) n2.setTime(now.getTime() + h*60*60*1000);
      return n2.toISOString();
    }
    // Respect start_date / end_date
    if(card.start_date){
      const sd = new Date(card.start_date+'T00:00:00');
      if(next < sd) return sd.toISOString();
    }
    if(card.end_date){
      const ed = new Date(card.end_date+'T23:59:59');
      if(next > ed) return null;
    }
    return next.toISOString();
  }
  function refreshNextRunAll(){ CARDS.forEach(c=>{ STATE.cards[c.id].next_run = computeNextRun(STATE.cards[c.id]); }); }

  // ── Update packages ────────────────────────────────────────────────────────
  function makePackage(cardId, actionKey){
    const card = CARDS.find(c=>c.id===cardId);
    const cs = STATE.cards[cardId];
    // Deterministic-ish simulated numbers, scaled by card type for realism.
    const seed = (cardId.length*7 + (actionKey||'').length*3 + Date.now()%97) | 0;
    const r = (k)=> (((seed * (k+13)) >>> 0) % 1000);
    const counts = {
      irs_updates:            { scanned: 12000+r(1)*4,  updated: 280+r(2),  added: 60+r(3)%80,  classifications: 110+r(4)%70, auto_resolved: 90+r(5)%50, review: 18+r(6)%30, duplicates: 4+r(7)%9, errors: 0+r(8)%3 },
      ein_enrichment:         { scanned:  4855+r(1)*2,  updated: 4700+r(2)%80, added: 30+r(3)%50,  classifications: 60+r(4)%50, auto_resolved: 110+r(5)%80, review: 12+r(6)%24, duplicates: 1+r(7)%4, errors: 0+r(8)%5 },
      source_checks:          { scanned:  9339+r(1),    updated: 240+r(2)%60,  added:  0,           classifications: 12+r(4)%18, auto_resolved: 20+r(5)%24, review: 24+r(6)%40, duplicates: 2+r(7)%6, errors: 0+r(8)%4 },
      classification_passes:  { scanned: 13000+r(1)*3,  updated: 900+r(2)%160, added: 0,           classifications: 700+r(4)%180,auto_resolved: 540+r(5)%120,review: 80+r(6)%60, duplicates: 0,        errors: 0+r(8)%3 },
      debug_consistency:      { scanned: 21000+r(1)*5,  updated: 0,            added: 0,           classifications: 0,           auto_resolved: 0,           review: 6+r(6)%20, duplicates: 9+r(7)%14,errors: 1+r(8)%6 },
      pre_change_notifications:{scanned: STATE.packages.length, updated:0, added:0, classifications:0, auto_resolved:0, review:0, duplicates:0, errors:0}
    }[cardId] || { scanned:0,updated:0,added:0,classifications:0,auto_resolved:0,review:0,duplicates:0,errors:0 };

    const pkg = {
      id: uid('PKG'),
      card_id: cardId,
      card_title: card.title,
      action: actionKey,
      created: nowIso(),
      state: 'draft_created',
      sources_used: card.sources.slice(),
      panels_affected: card.panels.slice(),
      counts,
      raw_new_rows:       counts.scanned,
      cleaned_new_rows:   Math.max(0, counts.scanned - counts.errors),
      enriched_rows:      counts.updated + counts.added,
      proposed_classification_changes: counts.classifications,
      proposed_recipient_updates: counts.updated,
      proposed_metric_changes: [
        {metric:'Total grants $', direction:'up',   estimate:'+0.4%'},
        {metric:'Jewish allocation $', direction:'up', estimate:'+0.2%'},
        {metric:'Records needing review', direction:counts.review>0?'up':'flat', estimate:`+${counts.review}`}
      ],
      review_queue_additions: counts.review,
      auto_resolved_log_additions: counts.auto_resolved,
      learning_updates: Math.floor(counts.auto_resolved/8),
      debug_findings: {
        broken_joins: Math.max(0, Math.floor(counts.errors/2)),
        duplicate_chains: counts.duplicates,
        double_counting_flags: Math.floor(counts.duplicates*0.6),
        missing_fields: counts.errors
      },
      source_evidence: card.sources.length,
      audit_trail: [
        { ts:nowIso(), event:'package_created', actor:'Updates engine', card:cardId, action:actionKey }
      ],
      version_change_notes: `Draft package for ${card.title}: ${counts.updated} updated, ${counts.added} added, ${counts.classifications} classification changes, ${counts.review} sent to review.`,
      confidence_summary: counts.errors===0 && counts.duplicates<=5 ? 'High' : (counts.errors<3 ? 'Medium' : 'Low'),
      recommended_action: counts.errors===0 && counts.duplicates<=5 && counts.review<=50 ? 'Approve and Merge' : 'Send to Review Queue'
    };
    STATE.packages.unshift(pkg);
    return pkg;
  }

  function transitionPackage(pkg, state){
    pkg.state = state;
    pkg.audit_trail.push({ ts:nowIso(), event:'state_change', to:state });
    const cs = STATE.cards[pkg.card_id];
    if(state==='pending_approval') cs.status = 'pending_approval';
    if(state==='approved_for_merge') cs.status = 'pending_approval';
    if(state==='merged'){ cs.status='merged'; cs.pending_package_id=null; }
    if(state==='rejected'){ cs.status='idle'; cs.pending_package_id=null; }
    if(state==='failed'){ cs.status='failed'; cs.pending_package_id=null; }
  }

  // ── Run flow ───────────────────────────────────────────────────────────────
  function runCardAction(cardId, actionKey){
    const cs = STATE.cards[cardId];
    if(!cs) return;
    if(cs.status === 'running'){ pushNotification({severity:'warning', card:cardId, title:`${cs.title}: already running`, summary:'Wait for the current run to finish.'}); return; }
    cs.status = 'running';
    cs.last_run = nowIso();
    logActivity(cardId, 'run_started', { action: actionKey });
    pushNotification({severity:'info', card:cardId, kind:'manual_update_started',
      title:`${cs.title} started`,
      summary:`Action: ${actionKey}. Sources: ${(CARDS.find(c=>c.id===cardId).sources||[]).join(', ')}.`});
    renderAll();

    // Simulated async pipeline. Step 1: draft → Step 2: debug → Step 3: preview → pending approval.
    setTimeout(()=>{
      try{
        const pkg = makePackage(cardId, actionKey);
        cs.last_success = nowIso();
        cs.records_checked += pkg.counts.scanned;
        cs.records_changed += pkg.counts.updated;
        cs.records_added   += pkg.counts.added;
        cs.records_needing_review += pkg.counts.review;
        cs.classification_changes += pkg.counts.classifications;
        cs.duplicates_found += pkg.counts.duplicates;
        cs.errors += pkg.counts.errors;
        cs.pending_package_id = pkg.id;
        cs.runs.unshift({ ts:cs.last_run, action:actionKey, package_id:pkg.id, outcome:'draft_created', counts: pkg.counts });
        transitionPackage(pkg, 'debug_complete');
        transitionPackage(pkg, 'review_needed');
        transitionPackage(pkg, 'pending_approval');
        STATE.selectedPackageId = pkg.id;
        pushNotification({severity:'high', card:cardId, kind:'package_ready',
          title:`Update package ready · ${cs.title}`,
          summary:`Package ${pkg.id} awaits Admin approval. ${fmtNum(pkg.counts.updated)} updated, ${fmtNum(pkg.counts.classifications)} classification changes, ${fmtNum(pkg.counts.review)} flagged for review.`,
          action_required:'Open the Update Preview and approve, reject, or send to review.',
          package_id: pkg.id});
        logActivity(cardId, 'package_ready', { package_id: pkg.id, counts: pkg.counts });
      }catch(err){
        cs.status='failed';
        cs.last_failed = nowIso();
        pushNotification({severity:'warning', card:cardId, kind:'run_failed', title:`${cs.title} failed`, summary: String(err && err.message || err)});
      }
      cs.next_run = computeNextRun(cs);
      renderAll();
    }, 350);
  }

  // ── Approval actions ───────────────────────────────────────────────────────
  function approveAndMerge(pkgId){
    const pkg = STATE.packages.find(p=>p.id===pkgId); if(!pkg) return;
    const cs = STATE.cards[pkg.card_id];
    transitionPackage(pkg, 'approved_for_merge');
    // simulate merge
    setTimeout(()=>{
      transitionPackage(pkg, 'merged');
      const version = {
        id: uid('VER'),
        version_number: 'v' + (STATE.versions.length+1).toString().padStart(3,'0'),
        timestamp: nowIso(),
        update_type: pkg.card_title,
        approved_by: 'Admin (session)',
        records_changed: pkg.counts.updated + pkg.counts.added,
        panels_affected: pkg.panels_affected.slice(),
        metrics_changed: pkg.proposed_metric_changes.slice(),
        logs_updated: ['audit_trail','auto_resolved_log','version_history'],
        package_id: pkg.id,
        rollback_available: true
      };
      STATE.versions.unshift(version);
      pushNotification({severity:'high', card:pkg.card_id, kind:'merge_completed',
        title:`Merge complete · ${cs.title}`,
        summary:`Version ${version.version_number} written. ${fmtNum(version.records_changed)} records changed. Rollback available.`,
        package_id: pkg.id});
      logActivity(pkg.card_id, 'merge_completed', { package_id: pkg.id, version: version.version_number });
      renderAll();
    }, 200);
  }
  function rejectPackage(pkgId, note){
    const pkg = STATE.packages.find(p=>p.id===pkgId); if(!pkg) return;
    pkg.audit_trail.push({ ts:nowIso(), event:'rejected', note:note||'' });
    transitionPackage(pkg, 'rejected');
    pushNotification({severity:'warning', card:pkg.card_id, kind:'merge_rejected',
      title:`Update rejected · ${pkg.card_title}`,
      summary:`Package ${pkg.id} was rejected.${note?` Reason: ${note}.`:''}`,
      package_id: pkg.id});
    logActivity(pkg.card_id, 'rejected', { package_id: pkg.id, note });
    renderAll();
  }
  function sendToReviewQueue(pkgId){
    const pkg = STATE.packages.find(p=>p.id===pkgId); if(!pkg) return;
    pkg.audit_trail.push({ ts:nowIso(), event:'sent_to_review' });
    pkg.state = 'review_needed';
    pushNotification({severity:'info', card:pkg.card_id, kind:'sent_to_review',
      title:`Sent to review · ${pkg.card_title}`,
      summary:`Package ${pkg.id} routed to the relevant review queue.`,
      package_id: pkg.id});
    logActivity(pkg.card_id, 'sent_to_review', { package_id: pkg.id });
    renderAll();
  }
  function runAdditionalChecks(pkgId){
    const pkg = STATE.packages.find(p=>p.id===pkgId); if(!pkg) return;
    pkg.audit_trail.push({ ts:nowIso(), event:'additional_checks_run' });
    // bump debug findings down by half to simulate an extra pass
    pkg.debug_findings.broken_joins = Math.floor(pkg.debug_findings.broken_joins/2);
    pkg.debug_findings.duplicate_chains = Math.floor(pkg.debug_findings.duplicate_chains/2);
    pkg.confidence_summary = 'High';
    pushNotification({severity:'info', card:pkg.card_id, kind:'extra_checks',
      title:`Additional checks complete · ${pkg.card_title}`,
      summary:`Confidence promoted to High. Open the preview to review.`,
      package_id: pkg.id});
    renderAll();
  }
  function exportPackage(pkgId){
    const pkg = STATE.packages.find(p=>p.id===pkgId); if(!pkg) return;
    const blob = new Blob([JSON.stringify(pkg, null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `update_package_${pkg.card_id}_${pkg.id}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
    logActivity(pkg.card_id, 'exported', { package_id: pkg.id });
  }
  function rollbackVersion(verId){
    const v = STATE.versions.find(x=>x.id===verId); if(!v) return;
    if(!v.rollback_available){ pushNotification({severity:'warning', title:'Rollback unavailable', summary:`Version ${v.version_number} cannot be rolled back from this UI.`}); return; }
    v.rollback_available = false;
    v.rolled_back_at = nowIso();
    pushNotification({severity:'high', card:'pre_change_notifications', kind:'rollback',
      title:`Rolled back ${v.version_number}`,
      summary:`Update type: ${v.update_type}. ${fmtNum(v.records_changed)} records reverted.`});
    logActivity('pre_change_notifications', 'rollback', { version: v.version_number, package_id: v.package_id });
    renderAll();
  }

  // ── CSS ────────────────────────────────────────────────────────────────────
  function injectCss(){
    if($('updates-styles')) return;
    const s = document.createElement('style');
    s.id = 'updates-styles';
    s.textContent = `
      .upd-wrap{padding:24px 28px;color:var(--text);}
      .upd-hero{display:flex;flex-wrap:wrap;align-items:center;gap:16px;justify-content:space-between;margin-bottom:18px;}
      .upd-hero h1{font-size:1.35rem;font-weight:850;letter-spacing:0.01em;margin:0;}
      .upd-hero .sub{font-size:0.78rem;color:var(--text-muted);max-width:780px;margin-top:4px;line-height:1.5;}
      .upd-pill{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;font-size:0.66rem;text-transform:uppercase;letter-spacing:0.05em;border:1px solid;background:rgba(99,102,241,0.14);color:#c7d2fe;border-color:rgba(129,140,248,0.45);font-weight:700;}
      .upd-pill.warn{background:rgba(245,158,11,0.18);color:#fcd34d;border-color:rgba(245,158,11,0.55);}
      .upd-pill.good{background:rgba(34,197,94,0.18);color:#86efac;border-color:rgba(34,197,94,0.55);}
      .upd-pill.bad{background:rgba(248,113,113,0.18);color:#fca5a5;border-color:rgba(248,113,113,0.55);}
      .upd-pill.neutral{background:rgba(148,163,184,0.18);color:#cbd5e1;border-color:rgba(148,163,184,0.5);}
      .upd-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:16px;}
      .upd-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:18px 18px 16px;display:flex;flex-direction:column;gap:12px;box-shadow:0 6px 18px rgba(0,0,0,0.18);}
      .upd-card h3{margin:0;font-size:1rem;font-weight:800;letter-spacing:0.01em;}
      .upd-card .desc{font-size:0.76rem;color:var(--text-muted);line-height:1.55;}
      .upd-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;}
      .upd-row.sb{justify-content:space-between;}
      .upd-meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 16px;font-size:0.72rem;color:var(--text-muted);}
      .upd-meta b{color:var(--text);font-weight:700;font-variant-numeric:tabular-nums;}
      .upd-stat-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;}
      .upd-stat{background:rgba(99,102,241,0.07);border:1px solid var(--border);border-radius:8px;padding:8px 10px;}
      .upd-stat .lbl{font-size:0.6rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;}
      .upd-stat .val{font-size:0.95rem;font-weight:800;font-variant-numeric:tabular-nums;}
      .upd-actions{display:flex;flex-wrap:wrap;gap:6px;}
      .upd-btn{background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:6px 11px;font-size:0.74rem;cursor:pointer;font-family:inherit;transition:all 0.12s;}
      .upd-btn:hover{border-color:var(--accent);color:var(--accent);}
      .upd-btn.primary{background:linear-gradient(135deg,#6867ff,#5357df);color:#fff;border-color:transparent;box-shadow:0 0 10px rgba(104,103,255,0.25);}
      .upd-btn.primary:hover{filter:brightness(1.06);color:#fff;}
      .upd-btn.danger{background:rgba(248,113,113,0.18);border-color:rgba(248,113,113,0.45);color:#fca5a5;}
      .upd-btn.warn{background:rgba(245,158,11,0.14);border-color:rgba(245,158,11,0.45);color:#fcd34d;}
      .upd-btn.ghost{background:transparent;}
      .upd-switch{display:inline-flex;align-items:center;gap:8px;font-size:0.74rem;cursor:pointer;user-select:none;}
      .upd-switch input{appearance:none;width:34px;height:18px;background:#2a2f48;border-radius:999px;position:relative;cursor:pointer;border:1px solid var(--border);transition:all 0.15s;}
      .upd-switch input:checked{background:linear-gradient(135deg,#6867ff,#5357df);border-color:transparent;}
      .upd-switch input::after{content:'';position:absolute;top:1px;left:2px;width:14px;height:14px;border-radius:50%;background:#e2e8f0;transition:all 0.15s;}
      .upd-switch input:checked::after{left:17px;background:#fff;}
      .upd-schedule{background:rgba(15,18,32,0.55);border:1px dashed var(--border);border-radius:8px;padding:10px 12px;}
      .upd-schedule .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;}
      .upd-input,.upd-select{background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:5px 8px;font-size:0.74rem;font-family:inherit;width:100%;outline:none;}
      .upd-input:focus,.upd-select:focus{border-color:var(--accent);}
      .upd-label{font-size:0.62rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);margin-bottom:3px;}
      .upd-pkg-table{width:100%;border-collapse:collapse;font-size:0.74rem;}
      .upd-pkg-table th,.upd-pkg-table td{padding:8px 10px;border-bottom:1px solid var(--border);text-align:left;vertical-align:top;}
      .upd-pkg-table thead th{background:#15182b;color:var(--text-muted);font-size:0.6rem;text-transform:uppercase;letter-spacing:0.05em;}
      .upd-section{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:18px;margin-top:18px;}
      .upd-section h2{margin:0 0 8px;font-size:1.02rem;font-weight:800;letter-spacing:0.01em;}
      .upd-section .sub{font-size:0.74rem;color:var(--text-muted);margin-bottom:12px;line-height:1.55;}
      .upd-preview-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;}
      .upd-preview-cell{background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;}
      .upd-preview-cell .lbl{font-size:0.6rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;}
      .upd-preview-cell .val{font-size:0.92rem;font-weight:700;font-variant-numeric:tabular-nums;}
      .upd-source-list{display:flex;flex-wrap:wrap;gap:6px;}
      .upd-source-tag{font-size:0.66rem;background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.4);color:#bbf7d0;border-radius:999px;padding:2px 8px;}
      .upd-empty{font-size:0.78rem;color:var(--text-muted);padding:14px;text-align:center;border:1px dashed var(--border);border-radius:8px;}
      .upd-notify-item{background:var(--surface2);border:1px solid var(--border);border-left-width:3px;border-radius:8px;padding:10px 12px;margin-bottom:8px;}
      .upd-notify-item.warning{border-left-color:#facc15;}
      .upd-notify-item.high{border-left-color:#a5b4fc;}
      .upd-notify-item.info{border-left-color:#94a3b8;}
      .upd-notify-item .t{font-size:0.78rem;font-weight:700;}
      .upd-notify-item .s{font-size:0.72rem;color:var(--text-muted);margin-top:2px;}
      .upd-notify-item .ts{font-size:0.62rem;color:var(--text-muted);margin-top:4px;}
    `;
    document.head.appendChild(s);
  }

  // ── Rendering ──────────────────────────────────────────────────────────────
  function statusPill(status){
    const map = {
      idle:['neutral','Idle'],
      running:['warn','Running'],
      preview_ready:['good','Preview Ready'],
      pending_approval:['warn','Pending Admin Approval'],
      merged:['good','Merged'],
      failed:['bad','Failed']
    };
    const [cls,label] = map[status] || ['neutral', status];
    return `<span class="upd-pill ${cls}">${escH(label)}</span>`;
  }
  function pkgStatePill(state){
    const map = {
      not_started:['neutral','Not Started'],
      running:['warn','Running'],
      draft_created:['neutral','Draft Created'],
      debug_complete:['neutral','Debug Check Complete'],
      review_needed:['warn','Review Needed'],
      pending_approval:['warn','Pending Admin Approval'],
      approved_for_merge:['good','Approved for Merge'],
      merged:['good','Merged'],
      rejected:['bad','Rejected'],
      failed:['bad','Failed']
    };
    const [cls,label] = map[state] || ['neutral', state];
    return `<span class="upd-pill ${cls}">${escH(label)}</span>`;
  }

  function renderHeader(){
    const host = $('updatesHeader'); if(!host) return;
    const pending = STATE.packages.filter(p=>['pending_approval','review_needed','approved_for_merge'].includes(p.state)).length;
    host.innerHTML = `
      <div class="upd-wrap" style="padding-bottom:0;">
        <div class="upd-hero">
          <div>
            <h1>Updates · Admin Console</h1>
            <div class="sub">Schedule, run, preview, approve, and merge autonomous dashboard updates. The engine prepares packages and runs debug + consistency checks, but every major change waits for Admin approval before it touches live dashboard data.</div>
          </div>
          <div class="upd-row" style="gap:8px;">
            <span class="upd-pill">Admin Approval Required</span>
            <span class="upd-pill ${pending>0?'warn':'neutral'}">${pending} pending</span>
            <button class="upd-btn ghost" onclick="window.UPDATES_CENTER.toggleAdmin()">${isAdmin()?'Admin role: On':'Admin role: Off'}</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderCard(card){
    const cs = STATE.cards[card.id];
    cs.next_run = computeNextRun(cs);
    const runs = cs.runs.slice(0,4);
    const pkgPending = cs.pending_package_id ? STATE.packages.find(p=>p.id===cs.pending_package_id) : null;
    return `
    <div class="upd-card" data-card="${card.id}">
      <div class="upd-row sb">
        <div>
          <h3>${escH(card.title)}</h3>
          <div class="desc">${escH(card.desc)}</div>
        </div>
        ${statusPill(cs.status)}
      </div>

      <div class="upd-stat-grid">
        <div class="upd-stat"><div class="lbl">Last Run</div><div class="val">${fmtTs(cs.last_run)}</div></div>
        <div class="upd-stat"><div class="lbl">Next Run</div><div class="val">${fmtTs(cs.next_run)}</div></div>
        <div class="upd-stat"><div class="lbl">Records Changed</div><div class="val">${fmtNum(cs.records_changed)}</div></div>
        <div class="upd-stat"><div class="lbl">Needs Review</div><div class="val">${fmtNum(cs.records_needing_review)}</div></div>
      </div>

      <div class="upd-row sb">
        <label class="upd-switch">
          <input type="checkbox" ${cs.enabled?'checked':''} onchange="window.UPDATES_CENTER.toggleEnabled('${card.id}', this.checked)">
          <span>Schedule ${cs.enabled?'on':'off'}</span>
        </label>
        <span class="upd-pill neutral">Mode: ${escH(cs.mode)}</span>
      </div>

      <div class="upd-schedule">
        <div class="upd-label">Schedule controls</div>
        <div class="grid">
          <div>
            <div class="upd-label">Frequency</div>
            <select class="upd-select" onchange="window.UPDATES_CENTER.setField('${card.id}','frequency',this.value)">
              ${FREQ.map(f=>`<option value="${f}" ${cs.frequency===f?'selected':''}>${f[0].toUpperCase()+f.slice(1)}</option>`).join('')}
            </select>
          </div>
          <div>
            <div class="upd-label">Time (UTC)</div>
            <input class="upd-input" type="time" value="${escH(cs.time)}" onchange="window.UPDATES_CENTER.setField('${card.id}','time',this.value)">
          </div>
          ${['weekly','biweekly'].includes(cs.frequency)?`
          <div>
            <div class="upd-label">Day of week</div>
            <select class="upd-select" onchange="window.UPDATES_CENTER.setField('${card.id}','day_of_week',this.value)">
              ${['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map(d=>`<option value="${d}" ${cs.day_of_week===d?'selected':''}>${d[0].toUpperCase()+d.slice(1)}</option>`).join('')}
            </select>
          </div>`:''}
          ${['monthly','quarterly'].includes(cs.frequency)?`
          <div>
            <div class="upd-label">Day of month</div>
            <input class="upd-input" type="number" min="1" max="28" value="${cs.day_of_month}" onchange="window.UPDATES_CENTER.setField('${card.id}','day_of_month',+this.value)">
          </div>`:''}
          ${cs.frequency==='custom'?`
          <div>
            <div class="upd-label">Interval (hours)</div>
            <input class="upd-input" type="number" min="1" value="${cs.custom_interval_hours}" onchange="window.UPDATES_CENTER.setField('${card.id}','custom_interval_hours',+this.value)">
          </div>`:''}
          <div>
            <div class="upd-label">Start date</div>
            <input class="upd-input" type="date" value="${escH(cs.start_date||'')}" onchange="window.UPDATES_CENTER.setField('${card.id}','start_date',this.value)">
          </div>
          <div>
            <div class="upd-label">End date</div>
            <input class="upd-input" type="date" value="${escH(cs.end_date||'')}" onchange="window.UPDATES_CENTER.setField('${card.id}','end_date',this.value)">
          </div>
        </div>
        <div class="upd-row" style="margin-top:8px;">
          <button class="upd-btn ${cs.paused?'warn':'ghost'}" onclick="window.UPDATES_CENTER.togglePaused('${card.id}')">${cs.paused?'Resume schedule':'Pause schedule'}</button>
          <span class="upd-pill ${cs.paused?'warn':'neutral'}">${cs.paused?'Paused':(cs.enabled?'Scheduled':'Manual only')}</span>
        </div>
      </div>

      <div>
        <div class="upd-label" style="margin-bottom:6px;">Manual update switches</div>
        <div class="upd-actions">
          ${card.actions.map(a=>`<button class="upd-btn primary" onclick="window.UPDATES_CENTER.runAction('${card.id}','${a.key}')" ${cs.status==='running'?'disabled':''}>${escH(a.label)}</button>`).join('')}
        </div>
      </div>

      <div class="upd-meta">
        <div><span>Last successful run</span><br><b>${fmtTs(cs.last_success)}</b></div>
        <div><span>Last failed run</span><br><b>${fmtTs(cs.last_failed)}</b></div>
        <div><span>Records checked</span><br><b>${fmtNum(cs.records_checked)}</b></div>
        <div><span>Classification changes</span><br><b>${fmtNum(cs.classification_changes)}</b></div>
        <div><span>Duplicates found</span><br><b>${fmtNum(cs.duplicates_found)}</b></div>
        <div><span>Errors</span><br><b>${fmtNum(cs.errors)}</b></div>
      </div>

      ${pkgPending?`
      <div class="upd-row sb" style="background:rgba(245,158,11,0.10);border:1px solid rgba(245,158,11,0.35);padding:8px 10px;border-radius:8px;">
        <div style="font-size:0.74rem;">${pkgStatePill(pkgPending.state)} · Package ${escH(pkgPending.id)} ready</div>
        <button class="upd-btn warn" onclick="window.UPDATES_CENTER.selectPackage('${pkgPending.id}')">View Details</button>
      </div>`:''}

      ${runs.length?`
      <details>
        <summary style="font-size:0.72rem;color:var(--text-muted);cursor:pointer;">Update history (${cs.runs.length})</summary>
        <table class="upd-pkg-table" style="margin-top:6px;">
          <thead><tr><th>When</th><th>Action</th><th>Updated</th><th>Review</th><th>Package</th></tr></thead>
          <tbody>
            ${runs.map(r=>`<tr>
              <td>${fmtTs(r.ts)}</td><td>${escH(r.action)}</td>
              <td>${fmtNum(r.counts.updated)}</td><td>${fmtNum(r.counts.review)}</td>
              <td>${r.package_id?`<button class="upd-btn ghost" onclick="window.UPDATES_CENTER.selectPackage('${r.package_id}')">${escH(r.package_id)}</button>`:'—'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </details>`:''}
    </div>`;
  }

  function renderCards(){
    const host = $('updatesCards'); if(!host) return;
    host.innerHTML = `<div class="upd-wrap"><div class="upd-grid">${CARDS.map(renderCard).join('')}</div></div>`;
  }

  function renderPendingApprovals(){
    const host = $('updatesPendingApprovals'); if(!host) return;
    const pending = STATE.packages.filter(p=>['pending_approval','approved_for_merge','review_needed','debug_complete','draft_created'].includes(p.state));
    if(!pending.length){
      host.innerHTML = `<div class="upd-section"><h2>Pending Approvals</h2><div class="upd-empty">No packages awaiting Admin action. Run a manual update or wait for a scheduled run.</div></div>`;
      return;
    }
    host.innerHTML = `
    <div class="upd-section">
      <h2>Pending Approvals (${pending.length})</h2>
      <div class="sub">Every package below was prepared by the engine and is waiting for Admin to approve, reject, or send to review. No package is merged into the live dashboard until you approve it.</div>
      <table class="upd-pkg-table">
        <thead><tr><th>Package</th><th>Update Type</th><th>Created</th><th>Updated</th><th>Classifications</th><th>Review</th><th>Confidence</th><th>State</th><th>Action</th></tr></thead>
        <tbody>
          ${pending.map(p=>`<tr>
            <td>${escH(p.id)}</td>
            <td>${escH(p.card_title)}</td>
            <td>${fmtTs(p.created)}</td>
            <td>${fmtNum(p.counts.updated)}</td>
            <td>${fmtNum(p.counts.classifications)}</td>
            <td>${fmtNum(p.counts.review)}</td>
            <td>${escH(p.confidence_summary)}</td>
            <td>${pkgStatePill(p.state)}</td>
            <td>
              <button class="upd-btn" onclick="window.UPDATES_CENTER.selectPackage('${p.id}')">View</button>
              <button class="upd-btn primary" onclick="window.UPDATES_CENTER.approve('${p.id}')">Approve &amp; Merge</button>
              <button class="upd-btn warn" onclick="window.UPDATES_CENTER.sendToReview('${p.id}')">Send to Review</button>
              <button class="upd-btn danger" onclick="window.UPDATES_CENTER.reject('${p.id}')">Reject</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  }

  function renderPreview(){
    const host = $('updatesPreviewPanel'); if(!host) return;
    const pkg = STATE.selectedPackageId ? STATE.packages.find(p=>p.id===STATE.selectedPackageId) : null;
    if(!pkg){
      host.innerHTML = `<div class="upd-section"><h2>Update Preview</h2><div class="upd-empty">Select a package from Pending Approvals or a card to view the change preview.</div></div>`;
      return;
    }
    host.innerHTML = `
    <div class="upd-section">
      <div class="upd-row sb">
        <h2>Update Preview · ${escH(pkg.card_title)}</h2>
        <div class="upd-row" style="gap:6px;">${pkgStatePill(pkg.state)}<span class="upd-pill ${pkg.confidence_summary==='High'?'good':pkg.confidence_summary==='Medium'?'warn':'bad'}">${escH(pkg.confidence_summary)} confidence</span></div>
      </div>
      <div class="sub">Package <b>${escH(pkg.id)}</b> · created ${fmtTs(pkg.created)} · action <b>${escH(pkg.action||'—')}</b>. Approved sources only. Nothing is merged until Admin approves.</div>

      <div class="upd-preview-grid">
        <div class="upd-preview-cell"><div class="lbl">Records scanned</div><div class="val">${fmtNum(pkg.counts.scanned)}</div></div>
        <div class="upd-preview-cell"><div class="lbl">Records updated</div><div class="val">${fmtNum(pkg.counts.updated)}</div></div>
        <div class="upd-preview-cell"><div class="lbl">New records added</div><div class="val">${fmtNum(pkg.counts.added)}</div></div>
        <div class="upd-preview-cell"><div class="lbl">Classification changes</div><div class="val">${fmtNum(pkg.counts.classifications)}</div></div>
        <div class="upd-preview-cell"><div class="lbl">Auto-resolved</div><div class="val">${fmtNum(pkg.counts.auto_resolved)}</div></div>
        <div class="upd-preview-cell"><div class="lbl">Sent to review</div><div class="val">${fmtNum(pkg.counts.review)}</div></div>
        <div class="upd-preview-cell"><div class="lbl">Duplicates / double-counting</div><div class="val">${fmtNum(pkg.counts.duplicates)}</div></div>
        <div class="upd-preview-cell"><div class="lbl">Errors / conflicts</div><div class="val">${fmtNum(pkg.counts.errors)}</div></div>
      </div>

      <div style="margin-top:12px;">
        <div class="upd-label" style="margin-bottom:4px;">Data sources checked</div>
        <div class="upd-source-list">${pkg.sources_used.map(s=>`<span class="upd-source-tag">${escH(s)}</span>`).join('')}</div>
      </div>

      <div style="margin-top:12px;">
        <div class="upd-label" style="margin-bottom:4px;">Dashboard panels affected</div>
        <div class="upd-source-list">${pkg.panels_affected.map(s=>`<span class="upd-source-tag" style="background:rgba(99,102,241,0.12);border-color:rgba(129,140,248,0.45);color:#c7d2fe;">${escH(s)}</span>`).join('')}</div>
      </div>

      <div style="margin-top:12px;">
        <div class="upd-label" style="margin-bottom:4px;">Metrics affected</div>
        <table class="upd-pkg-table">
          <thead><tr><th>Metric</th><th>Direction</th><th>Estimate</th></tr></thead>
          <tbody>
            ${pkg.proposed_metric_changes.map(m=>`<tr><td>${escH(m.metric)}</td><td>${escH(m.direction)}</td><td>${escH(m.estimate)}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>

      <div style="margin-top:12px;">
        <div class="upd-label" style="margin-bottom:4px;">Debug / consistency findings</div>
        <table class="upd-pkg-table">
          <tbody>
            <tr><td>Broken joins</td><td>${fmtNum(pkg.debug_findings.broken_joins)}</td></tr>
            <tr><td>Duplicate chains</td><td>${fmtNum(pkg.debug_findings.duplicate_chains)}</td></tr>
            <tr><td>Double-counting flags</td><td>${fmtNum(pkg.debug_findings.double_counting_flags)}</td></tr>
            <tr><td>Missing fields</td><td>${fmtNum(pkg.debug_findings.missing_fields)}</td></tr>
          </tbody>
        </table>
      </div>

      <div class="upd-row" style="margin-top:14px;gap:8px;">
        <span class="upd-pill good">Recommended action: ${escH(pkg.recommended_action)}</span>
      </div>

      <div class="upd-row" style="margin-top:12px;gap:8px;">
        <button class="upd-btn primary" onclick="window.UPDATES_CENTER.approve('${pkg.id}')" ${pkg.state==='merged'||pkg.state==='rejected'?'disabled':''}>Approve and Merge</button>
        <button class="upd-btn warn" onclick="window.UPDATES_CENTER.sendToReview('${pkg.id}')" ${pkg.state==='merged'||pkg.state==='rejected'?'disabled':''}>Send to Review Queue</button>
        <button class="upd-btn" onclick="window.UPDATES_CENTER.runChecks('${pkg.id}')" ${pkg.state==='merged'||pkg.state==='rejected'?'disabled':''}>Run Additional Checks</button>
        <button class="upd-btn" onclick="window.UPDATES_CENTER.exportPackage('${pkg.id}')">Export Update Package</button>
        <button class="upd-btn danger" onclick="window.UPDATES_CENTER.reject('${pkg.id}')" ${pkg.state==='merged'||pkg.state==='rejected'?'disabled':''}>Reject Update</button>
      </div>
    </div>`;
  }

  function renderInspector(){
    const host = $('updatesPackageInspector'); if(!host) return;
    const pkg = STATE.selectedPackageId ? STATE.packages.find(p=>p.id===STATE.selectedPackageId) : null;
    if(!pkg){ host.innerHTML = ''; return; }
    host.innerHTML = `
    <div class="upd-section">
      <h2>Update Package · ${escH(pkg.id)}</h2>
      <div class="sub">Inspect raw, cleaned, enriched, and proposed change layers before approving. Each package is signed by the engine session and recorded in the audit trail.</div>
      <div class="upd-preview-grid">
        <div class="upd-preview-cell"><div class="lbl">Raw new rows</div><div class="val">${fmtNum(pkg.raw_new_rows)}</div></div>
        <div class="upd-preview-cell"><div class="lbl">Cleaned rows</div><div class="val">${fmtNum(pkg.cleaned_new_rows)}</div></div>
        <div class="upd-preview-cell"><div class="lbl">Enriched rows</div><div class="val">${fmtNum(pkg.enriched_rows)}</div></div>
        <div class="upd-preview-cell"><div class="lbl">Proposed classification changes</div><div class="val">${fmtNum(pkg.proposed_classification_changes)}</div></div>
        <div class="upd-preview-cell"><div class="lbl">Proposed recipient updates</div><div class="val">${fmtNum(pkg.proposed_recipient_updates)}</div></div>
        <div class="upd-preview-cell"><div class="lbl">Review queue additions</div><div class="val">${fmtNum(pkg.review_queue_additions)}</div></div>
        <div class="upd-preview-cell"><div class="lbl">Auto-resolved log additions</div><div class="val">${fmtNum(pkg.auto_resolved_log_additions)}</div></div>
        <div class="upd-preview-cell"><div class="lbl">Classification learning updates</div><div class="val">${fmtNum(pkg.learning_updates)}</div></div>
        <div class="upd-preview-cell"><div class="lbl">Source evidence rows</div><div class="val">${fmtNum(pkg.source_evidence)}</div></div>
      </div>
      <div style="margin-top:12px;">
        <div class="upd-label" style="margin-bottom:4px;">Version change notes</div>
        <div style="font-size:0.78rem;line-height:1.55;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;">${escH(pkg.version_change_notes)}</div>
      </div>
      <div style="margin-top:12px;">
        <div class="upd-label" style="margin-bottom:4px;">Audit trail</div>
        <table class="upd-pkg-table">
          <thead><tr><th>When</th><th>Event</th><th>Detail</th></tr></thead>
          <tbody>
            ${pkg.audit_trail.map(a=>`<tr><td>${fmtTs(a.ts)}</td><td>${escH(a.event)}</td><td>${escH(a.note||a.to||a.actor||a.action||'')}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  }

  function renderVersions(){
    const host = $('updatesVersionHistory'); if(!host) return;
    if(!STATE.versions.length){
      host.innerHTML = `<div class="upd-section"><h2>Dashboard Version History</h2><div class="upd-empty">No merges yet. Approving an update package will create version v001.</div></div>`;
      return;
    }
    host.innerHTML = `
    <div class="upd-section">
      <h2>Dashboard Version History (${STATE.versions.length})</h2>
      <div class="sub">Every approved merge creates a new dashboard version. Rollback is available where supported.</div>
      <table class="upd-pkg-table">
        <thead><tr><th>Version</th><th>When</th><th>Update Type</th><th>Approved By</th><th>Records</th><th>Panels</th><th>Package</th><th>Action</th></tr></thead>
        <tbody>
          ${STATE.versions.map(v=>`<tr>
            <td><b>${escH(v.version_number)}</b></td>
            <td>${fmtTs(v.timestamp)}</td>
            <td>${escH(v.update_type)}</td>
            <td>${escH(v.approved_by)}</td>
            <td>${fmtNum(v.records_changed)}</td>
            <td>${escH(v.panels_affected.join(', '))}</td>
            <td><button class="upd-btn ghost" onclick="window.UPDATES_CENTER.selectPackage('${v.package_id}')">${escH(v.package_id)}</button></td>
            <td>${v.rollback_available?`<button class="upd-btn warn" onclick="window.UPDATES_CENTER.rollback('${v.id}')">Rollback</button>`:`<span class="upd-pill neutral">Rolled back</span>`}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  }

  function renderActivityLog(){
    const host = $('updatesActivityLog'); if(!host) return;
    // Persistent audit trail owns this section. Delegate to AUDIT_LOG when present.
    if(window.AUDIT_LOG && typeof window.AUDIT_LOG.render === 'function'){
      try{ window.AUDIT_LOG.render(); return; }catch(e){ /* fall through to legacy view */ }
    }
    // Legacy fallback (only if AUDIT_LOG failed to load).
    if(!STATE.activity.length){
      host.innerHTML = `<div class="upd-section"><h2>Update Logs</h2><div class="upd-empty">No activity yet.</div></div>`;
      return;
    }
    host.innerHTML = `
    <div class="upd-section">
      <h2>Update Logs</h2>
      <div class="sub">Run history, approvals, rejections, rollbacks. ${STATE.activity.length} events this session.</div>
      <table class="upd-pkg-table">
        <thead><tr><th>When</th><th>Card</th><th>Event</th><th>Detail</th></tr></thead>
        <tbody>
          ${STATE.activity.slice(0,80).map(a=>`<tr>
            <td>${fmtTs(a.timestamp)}</td>
            <td>${escH((CARDS.find(c=>c.id===a.card_id)||{title:a.card_id}).title)}</td>
            <td>${escH(a.kind)}</td>
            <td>${escH(a.package_id||a.action||a.note||a.version||'')}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  }

  function renderNotifications(){
    const host = $('updatesNotifications'); if(!host) return;
    host.innerHTML = `
    <div class="upd-section">
      <div class="upd-row sb"><h2>Notifications</h2>
        <button class="upd-btn ghost" onclick="window.UPDATES_CENTER.markAllViewed()">Mark all viewed</button>
      </div>
      <div class="sub">Admin-facing notifications generated by the Updates engine. Each links directly to the relevant package.</div>
      ${STATE.notifications.length===0?`<div class="upd-empty">No notifications yet.</div>`:
        STATE.notifications.slice(0,40).map(n=>`
          <div class="upd-notify-item ${escH(n.severity||'info')}">
            <div class="t">${escH(n.title||'')} ${n.viewed?'':'<span class="upd-pill warn" style="margin-left:6px;">new</span>'}</div>
            <div class="s">${escH(n.summary||'')}${n.action_required?` · <i>${escH(n.action_required)}</i>`:''}</div>
            <div class="ts">${fmtTs(n.timestamp)} ${n.package_id?`· <button class="upd-btn ghost" onclick="window.UPDATES_CENTER.selectPackage('${n.package_id}')">Open package</button>`:''}</div>
          </div>`).join('')}
    </div>`;
  }

  function renderAll(){
    refreshNextRunAll();
    injectCss();
    renderHeader();
    renderCards();
    renderPendingApprovals();
    renderPreview();
    renderInspector();
    renderVersions();
    renderActivityLog();
    renderNotifications();
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  window.UPDATES_CENTER = {
    isAdmin, setAdmin,
    toggleAdmin: ()=> { setAdmin(!isAdmin()); },
    render: renderAll,
    runAction: (cardId, actionKey)=> runCardAction(cardId, actionKey),
    toggleEnabled: (cardId, on)=> { STATE.cards[cardId].enabled = !!on; STATE.cards[cardId].paused=false; STATE.cards[cardId].next_run=computeNextRun(STATE.cards[cardId]); renderAll(); },
    togglePaused: (cardId)=> { const cs = STATE.cards[cardId]; cs.paused = !cs.paused; cs.next_run = computeNextRun(cs); renderAll(); },
    setField: (cardId, field, value)=> { STATE.cards[cardId][field] = value; STATE.cards[cardId].next_run = computeNextRun(STATE.cards[cardId]); renderAll(); },
    selectPackage: (pkgId)=> { STATE.selectedPackageId = pkgId; renderAll(); },
    approve: (pkgId)=> approveAndMerge(pkgId),
    reject: (pkgId)=> { const n = prompt('Reason for rejecting this update? (optional)'); rejectPackage(pkgId, n||''); },
    sendToReview: (pkgId)=> sendToReviewQueue(pkgId),
    runChecks: (pkgId)=> runAdditionalChecks(pkgId),
    exportPackage: (pkgId)=> exportPackage(pkgId),
    rollback: (verId)=> rollbackVersion(verId),
    markAllViewed: ()=> { STATE.notifications.forEach(n=> n.viewed=true); renderAll(); },
    // Public hook for engine modules (e.g., pledge_learning_rules.js) to log activity.
    logActivity: function(entry){
      // Accept either (entry_object) or (card_id, kind, payload) for back-compat.
      if(entry && typeof entry==='object' && !Array.isArray(entry)){
        const card = entry.card || entry.card_id || 'classification_passes';
        const kind = entry.event || entry.kind || 'engine_event';
        const payload = Object.assign({}, entry);
        delete payload.card; delete payload.card_id; delete payload.event; delete payload.kind;
        logActivity(card, kind, payload);
      } else {
        logActivity.apply(null, arguments);
      }
      try{ renderAll(); }catch(e){}
    },
    pushNotification: pushNotification,
    _state: STATE
  };

  // ── Boot ───────────────────────────────────────────────────────────────────
  function boot(){
    seedNotifications();
    applyAdminVisibility();
    // Pre-render so admin can switch in instantly.
    try{ renderAll(); }catch(e){ console.error('Updates render boot error', e); }
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})();
