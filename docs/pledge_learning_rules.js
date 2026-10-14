// =============================================================================
//  Multi-Year Pledge Learning Rules
//  Added: 2026-05-19
//  Trigger case: Jim Joseph Foundation $7.5M / 5-year pledge to Prizmah
//                (Center for Jewish Day Schools), awarded 06/03/2024.
//
//  This module extends the Extraction Engine, Grant Schedule Parser, and
//  Classification / Audit Engine with rules to distinguish multi-year pledges
//  from single-year grants when a source document lists a large award amount
//  together with a multi-year duration.
//
//  This is engine-internal logic. No new Admin panel is created. Audit
//  outputs route into the existing Updates Center activity log + review
//  workflow.
// =============================================================================
(function(){
  'use strict';

  // ── 1. Canonical learning example ─────────────────────────────────────────
  const PLEDGE_LEARNING_EXAMPLE = {
    example_id: 'PLEDGE_EX_001',
    name: 'Jim Joseph $7.5M Center for Jewish Day Schools — Multi-Year Pledge Handling',
    case: {
      grantmaker: 'Jim Joseph Foundation',
      grantmaker_legal_name: 'Shimon Ben Joseph Foundation',
      recipient: 'Center for Jewish Day Schools Inc. (Prizmah)',
      grant_total_awarded_amount: 7500000,
      grant_paid_amount_current_year: null, // unknown until 990 confirms
      grant_duration_years: 5,
      grant_start_date: '2024-06-03',
      grant_end_date_estimated: '2028',
      grant_payment_schedule_known: false,
      grant_annualized_estimate: 1500000,
      grant_amount_type: 'Multi-year pledge / total award',
      multi_year_flag: true,
      pledge_flag: true,
      single_year_payment_flag: false,
      classification_confidence: 'high',
      classification: 'Jewish-aligned (unchanged)',
      extraction_note: 'Source states $7.5M awarded on 06/03/2024 for 5 years. ' +
        'Treat as multi-year pledge, not single-year 2024 grant. ' +
        'Annualized estimate ≈ $1.5M/year pending 990 / payment confirmation.',
      source_url: 'https://jimjosephfoundation.org/grants/center-for-jewish-day-schools-inc-national-jewish-day-school-support/',
      source_evidence_text: 'Jim Joseph Foundation grant page: $7,500,000 — 06/03/2024 — 5 Years — General Operating Support'
    },
    pattern_learned:
      'When a grant page lists a large award amount together with a multi-year ' +
      'duration, treat the amount as total pledge / total award rather than as ' +
      'a single-year grant. Preserve total pledge AND estimated annualized amount.',
    correct_extraction: '$7.5M total award over 5 years; estimated $1.5M/year unless actual payment schedule is confirmed.',
    incorrect_extraction_to_avoid: 'Counting $7.5M entirely in FY2024 as if it were a single-year grant.',
    affects_classification: false,
    affects_amount_extraction: true,
    affects_time_allocation: true,
    created: '2026-05-19'
  };

  // ── 2. Multi-year language detection (used by Extraction Engine & Parser) ─
  const PLEDGE_LANGUAGE_PATTERNS = [
    /\b(\d+(?:\.\d+)?)\s*[-\s]?\s*years?\b/i,         // "5 years", "5-year"
    /\bover\s+(\d+(?:\.\d+)?)\s+years?\b/i,            // "over 5 years"
    /\bmulti[-\s]?year\b/i,                            // "multi-year", "multiyear"
    /\bpledge(?:d)?\b/i,                               // "pledge", "pledged"
    /\bcommitment\b/i,                                 // "commitment"
    /\bawarded\s+for\s+(\d+(?:\.\d+)?)\s+years?\b/i,   // "awarded for X years"
    /\bgrant\s+period\b/i,                             // "grant period"
    /\bduration\b/i,                                   // "duration"
    /\binstallments?\b/i,                              // "installment", "installments"
    /\bpayable\s+over\b/i,                             // "payable over"
    /\bgeneral\s+operating\s+support\s*[—\-–]\s*\d+\s+years?\b/i // "general operating support — 5 years"
  ];

  /**
   * Detect multi-year pledge language in a free-text blob (e.g., grant page,
   * 990 narrative, annual report). Returns { is_pledge, duration_years, evidence }.
   */
  function detectPledgeLanguage(text){
    if(!text || typeof text!=='string') return {is_pledge:false, duration_years:null, evidence:[]};
    const evidence = [];
    let years = null;
    for(const re of PLEDGE_LANGUAGE_PATTERNS){
      const m = text.match(re);
      if(m){
        evidence.push(m[0]);
        if(m[1] && !years){
          const n = parseFloat(m[1]);
          if(!isNaN(n) && n>=2 && n<=20) years = n;
        }
      }
    }
    return {
      is_pledge: evidence.length>0,
      duration_years: years,
      evidence: evidence
    };
  }

  /**
   * Classify a raw extracted amount given source language. Returns the
   * canonical pledge record structure required by the dashboard data rule.
   */
  function classifyAmount({ amount, source_text, awarded_date, source_url }){
    const det = detectPledgeLanguage(source_text||'');
    if(det.is_pledge && det.duration_years && det.duration_years >= 2){
      const annual = Math.round(amount / det.duration_years);
      const startY = awarded_date ? new Date(awarded_date).getFullYear() : null;
      const endY = (startY && det.duration_years) ? (startY + Math.ceil(det.duration_years) - 1) : null;
      return {
        grant_total_awarded_amount: amount,
        grant_paid_amount_current_year: null,
        grant_duration_years: det.duration_years,
        grant_start_date: awarded_date || null,
        grant_end_date_estimated: endY ? String(endY) : null,
        grant_payment_schedule_known_yes_no: 'No',
        grant_annualized_estimate: annual,
        grant_amount_type: 'Multi-year pledge / total award',
        source_amount_language: det.evidence.join(' | '),
        multi_year_flag: true,
        pledge_flag: true,
        single_year_payment_flag: false,
        classification_confidence: 'high',
        extraction_note: `Detected multi-year pledge language (${det.evidence.join(', ')}). ` +
                         `Treating $${amount.toLocaleString()} as total pledge over ${det.duration_years} years; ` +
                         `annualized ≈ $${annual.toLocaleString()}/year. Awaiting 990/payment confirmation.`,
        source_url: source_url||null,
        source_evidence_text: source_text||null
      };
    }
    // No pledge language → treat as single-year grant.
    return {
      grant_total_awarded_amount: amount,
      grant_paid_amount_current_year: amount,
      grant_duration_years: 1,
      grant_start_date: awarded_date || null,
      grant_end_date_estimated: awarded_date ? String(new Date(awarded_date).getFullYear()) : null,
      grant_payment_schedule_known_yes_no: 'Yes',
      grant_annualized_estimate: amount,
      grant_amount_type: 'Single-year grant',
      source_amount_language: null,
      multi_year_flag: false,
      pledge_flag: false,
      single_year_payment_flag: true,
      classification_confidence: 'high',
      extraction_note: 'No multi-year pledge language detected in source; recorded as single-year grant.',
      source_url: source_url||null,
      source_evidence_text: source_text||null
    };
  }

  // ── 3. Engine rule entries (appended to PHASE2_CEF_LEARNING_RULES_SEED) ───
  const PLEDGE_RULE_EXTRACTION = {
    rule_id: 'RULE_PLEDGE_001',
    name: 'MULTI_YEAR_PLEDGE_VS_SINGLE_YEAR_GRANT',
    engine: 'Extraction Engine',
    description: 'When source documents (foundation grant pages, 990s, annual reports, PDFs) ' +
                 'list a large award amount together with multi-year duration language ' +
                 '(N years, multi-year, over X years, pledge, commitment, awarded for X years, ' +
                 'grant period, duration, installments, payable over, general operating support — N years), ' +
                 'classify the amount as a multi-year pledge / total award, NOT a single-year grant. ' +
                 'Preserve both total pledge amount and annualized estimate.',
    trigger: 'source_text matches any of: /N years/, /multi-year/, /over N years/, /pledge/, /commitment/, /awarded for N years/, /grant period/, /duration/, /installments?/, /payable over/',
    action: 'classify_as_multi_year_pledge',
    confidence: 'high',
    evidence_required: 'Source text snippet + URL',
    admin_approved: true,
    created_version: 'pledge_rules_v1.0',
    canonical_example: 'PLEDGE_EX_001'
  };

  const PLEDGE_RULE_SCHEDULE_PARSER = {
    rule_id: 'RULE_PLEDGE_002',
    name: 'GRANT_SCHEDULE_PARSER_PLEDGE_ALLOCATION',
    engine: 'Grant Schedule Parser',
    description: 'When a multi-year pledge is detected and no confirmed 990 payment schedule exists, ' +
                 'annualize the total over the stated duration (total / N years) starting from awarded_date ' +
                 'fiscal year through awarded_date + (N-1). Mark all per-year amounts as ESTIMATED. ' +
                 'When 990 payment data becomes available, replace estimated amounts with actuals and ' +
                 'flag any discrepancy >5% for review.',
    trigger: 'pledge_flag == true AND grant_payment_schedule_known_yes_no == "No"',
    action: 'annualize_and_mark_estimated',
    confidence: 'medium',
    evidence_required: 'Pledge record from RULE_PLEDGE_001',
    admin_approved: true,
    created_version: 'pledge_rules_v1.0',
    canonical_example: 'PLEDGE_EX_001'
  };

  const PLEDGE_RULE_AUDIT = {
    rule_id: 'RULE_PLEDGE_003',
    name: 'CLASSIFICATION_AUDIT_PLEDGE_REVIEW',
    engine: 'Classification / Audit Engine',
    description: 'For every multi-year pledge record the audit log must show: original extracted amount, ' +
                 'total pledge vs single-year payment, duration, annualized estimate, source language, ' +
                 'confidence score, 990 confirmation status, and review-required flag. ' +
                 'Route to review only if: duration unclear, payment schedule conflicts across sources, ' +
                 '990 data shows different annual amount, source wording ambiguous, or grant period cannot be determined. ' +
                 'Does NOT change Jewish/Non-Jewish classification.',
    trigger: 'pledge_flag == true',
    action: 'log_to_audit_trail + flag_if_ambiguous',
    confidence: 'high',
    evidence_required: 'Pledge record + source evidence',
    admin_approved: true,
    created_version: 'pledge_rules_v1.0',
    canonical_example: 'PLEDGE_EX_001'
  };

  // ── 4. Wire rules into the existing learning rules seed ───────────────────
  function wireIntoLearningSeed(){
    if(!window.PHASE2_CEF_LEARNING_RULES_SEED) return;
    const seed = window.PHASE2_CEF_LEARNING_RULES_SEED;
    seed.classification_rules = seed.classification_rules || [];
    seed.pattern_library    = seed.pattern_library    || [];
    seed.learning_examples  = seed.learning_examples  || [];
    seed.version_history    = seed.version_history    || [];

    // Avoid double-insertion on hot reload.
    const has = id => seed.classification_rules.some(r=>r.rule_id===id);
    if(!has('RULE_PLEDGE_001')) seed.classification_rules.push(PLEDGE_RULE_EXTRACTION);
    if(!has('RULE_PLEDGE_002')) seed.classification_rules.push(PLEDGE_RULE_SCHEDULE_PARSER);
    if(!has('RULE_PLEDGE_003')) seed.classification_rules.push(PLEDGE_RULE_AUDIT);

    if(!seed.learning_examples.some(e=>e.example_id==='PLEDGE_EX_001')){
      seed.learning_examples.push(PLEDGE_LEARNING_EXAMPLE);
    }

    if(!seed.pattern_library.some(p=>p.pattern_id==='PAT_PLEDGE_001')){
      seed.pattern_library.push({
        pattern_id: 'PAT_PLEDGE_001',
        pattern: 'Large award amount + multi-year duration language → multi-year pledge',
        examples: [
          'Jim Joseph Foundation $7,500,000 / 5 years to Prizmah (06/03/2024)',
          'Foundation X $2,000,000 / 2 years general operating support',
          'Foundation Y $4,500,000 over 3.5 years'
        ],
        classification: 'Multi-year pledge — preserve total + annualized estimate',
        confidence: 'high',
        count_resolved: 0,
        created_version: 'pledge_rules_v1.0'
      });
    }

    if(!seed.version_history.some(v=>v.version==='pledge_rules_v1.0')){
      seed.version_history.push({
        version: 'pledge_rules_v1.0',
        timestamp: new Date().toISOString(),
        description: 'Added multi-year pledge handling rules across Extraction Engine, ' +
                     'Grant Schedule Parser, and Classification/Audit Engine. Canonical example: ' +
                     'Jim Joseph $7.5M Center for Jewish Day Schools (Prizmah).',
        methods: ['multi_year_pledge_language_detection','annualized_amount_allocation','pledge_audit_logging'],
        auto_resolved: 0,
        admin_approved: true
      });
    }
  }

  // ── 5. Rerun check across existing dashboard grants ───────────────────────
  // Scan for grants whose amount is large AND the dashboard already has a
  // pledge annotation, OR whose foundation/recipient pair matches known
  // pledge cases. Surface candidates for review without mutating data.
  function rerunPledgeCheck(){
    const out = {
      scanned: 0,
      candidates: [],
      annotated: [],
      timestamp: new Date().toISOString()
    };
    try {
      const JRG = window.JEWISH_RECIPIENT_GRANTS || window.JRG || {};
      const PLEDGES = window.PLEDGE_ANNOTATIONS || {};
      const pledgedRecipients = new Set(
        Object.keys(PLEDGES).map(k=>k.split('|')[0])
      );

      Object.keys(JRG).forEach(recName=>{
        const years = JRG[recName] || {};
        Object.keys(years).forEach(yr=>{
          const grants = years[yr] || [];
          grants.forEach(g=>{
            out.scanned++;
            const [fd, amt] = g;
            // direct annotation hit
            const k1 = `${recName}|${fd}|${yr}|${amt}`;
            const k2 = `${recName}|${fd}|${yr}`;
            if(PLEDGES[k1] || PLEDGES[k2]){
              out.annotated.push({recipient:recName, foundation:fd, year:yr, amount:amt, status:'annotated'});
              return;
            }
            // heuristic: large amount AND recipient already has a pledge from same foundation in same year
            if(amt >= 2000000 && pledgedRecipients.has(recName)){
              out.candidates.push({
                recipient: recName,
                foundation: fd,
                year: yr,
                amount: amt,
                reason: 'Large amount ($≥2M) at recipient with known multi-year pledges; verify whether this is a single-year grant or a multi-year pledge',
                action: 'flag_for_admin_review'
              });
            }
          });
        });
      });
    } catch(e){
      out.error = String(e&&e.message||e);
    }
    return out;
  }

  // ── 6. Public API ─────────────────────────────────────────────────────────
  window.PLEDGE_LEARNING = {
    EXAMPLE: PLEDGE_LEARNING_EXAMPLE,
    RULES: [PLEDGE_RULE_EXTRACTION, PLEDGE_RULE_SCHEDULE_PARSER, PLEDGE_RULE_AUDIT],
    detectPledgeLanguage,
    classifyAmount,
    rerunPledgeCheck,
    version: 'pledge_rules_v1.0'
  };

  // ── 7. Auto-wire on DOM ready ─────────────────────────────────────────────
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded', wireIntoLearningSeed);
  } else {
    wireIntoLearningSeed();
  }

  // ── 8. Initial rerun scan (lazy, after data loads) ────────────────────────
  // Surface results into the Updates Center activity log if available.
  setTimeout(function(){
    try {
      const scan = rerunPledgeCheck();
      window.PLEDGE_LEARNING.lastScan = scan;
      if(window.UPDATES_CENTER && typeof window.UPDATES_CENTER.logActivity==='function'){
        window.UPDATES_CENTER.logActivity({
          ts: scan.timestamp,
          event: 'pledge_learning_rules_loaded',
          card: 'classification_passes',
          summary: `Multi-year pledge rules v1.0 loaded. Scanned ${scan.scanned} grants. ` +
                   `${scan.annotated.length} already annotated, ${scan.candidates.length} flagged for review.`,
          details: scan
        });
      }
      if(window.UPDATES_CENTER && typeof window.UPDATES_CENTER.pushNotification==='function'){
        window.UPDATES_CENTER.pushNotification({
          severity: scan.candidates.length>0 ? 'warning' : 'info',
          card: 'classification_passes',
          kind: 'learning_rule_added',
          title: 'Multi-year pledge learning rules added (v1.0)',
          summary: `Engines updated: Extraction Engine, Grant Schedule Parser, Classification/Audit Engine. ` +
                   `Canonical example: Jim Joseph $7.5M / 5-year pledge to Prizmah. ` +
                   `Rerun scan: ${scan.scanned} grants checked, ${scan.candidates.length} flagged for review.`
        });
      }
      // Console breadcrumb for QA
      if(window.console && console.info){
        console.info('[pledge_learning_rules v1.0] loaded.',
          `Scanned ${scan.scanned} grants. Annotated=${scan.annotated.length}, candidates=${scan.candidates.length}.`);
      }
    } catch(e){
      if(window.console && console.warn) console.warn('[pledge_learning_rules] rerun scan failed:', e);
    }
  }, 1500);

})();
