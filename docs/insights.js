/* ════════════════════════════════════════════════════════════════════════════
   Foundation Dashboard — Insights Layer
   ────────────────────────────────────────────────────────────────────────────
   Three radial mindmaps built from existing dashboard data:
     1. Subjects/Sectors  (Jewish vs Non-Jewish → Primary Subject)
     2. Institutions      (Grantmakers ↔ Intermediaries ↔ Recipients)
     3. Geography         (US / Israel / International / Misc → States/Countries)

   Source-of-truth: window.DASHBOARD_DATA (D), window.RECIPIENTS (R),
   window.RECIPIENT_GRANTS (RG). Reads via tolerant adapter — falls back to
   empty states if any structure is missing.

   No external libraries — vanilla SVG. The host page already loads Chart.js.
   ════════════════════════════════════════════════════════════════════════════ */
(function(){
  'use strict';

  // ── DATA ADAPTER ──────────────────────────────────────────────────────────
  function getD(){
    if(typeof window === 'undefined') return null;
    return window.D || window.DASHBOARD_DATA || null;
  }
  function getR(){
    if(typeof window === 'undefined') return null;
    return window.R || window.RECIPIENTS || null;
  }
  function getRG(){
    if(typeof window === 'undefined') return null;
    return window.RG || window.RECIPIENT_GRANTS || null;
  }
  function getJRL(){ return window.JRL || window.JEWISH_RECIPIENTS_LIST || null; }

  // formatting helpers (re-defined here so module is self-contained)
  const fmt$ = (n)=>{
    if(!n && n!==0) return '$0';
    const v = Math.abs(n);
    if(v >= 1e9) return '$'+(n/1e9).toFixed(2)+'B';
    if(v >= 1e6) return '$'+(n/1e6).toFixed(1)+'M';
    if(v >= 1e3) return '$'+(n/1e3).toFixed(0)+'K';
    return '$'+Math.round(n);
  };
  const fmtN = (n)=> (!n && n!==0) ? '0' : Number(n).toLocaleString();
  const escH = (s)=> !s ? '' : String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  function orgDisplayLabel(name){
    const s = String(name || '');
    if(/UJA[\s-]?Federation|United Jewish Appeal.*Federation of Jewish Philanthropies/i.test(s)){
      return 'UJA-Federation of NY';
    }
    return s;
  }

  // ── DAF / INTERMEDIARY MARKERS (from research notes) ──────────────────────
  // Confirmed national DAF sponsors / known fiscal sponsors (high confidence).
  const KNOWN_DAF_SPONSORS = [
    'fidelity charitable','fidelity investments charitable','schwab charitable',
    'dafgiving360','vanguard charitable','national philanthropic trust',
    'donorstrust','national christian foundation','tides foundation',
    'new venture fund','silicon valley community foundation',
    'goldman sachs charitable','morgan stanley charitable',
    'morgan stanley global impact','ayco charitable','jp morgan charitable',
    'rockefeller philanthropy advisors','bny mellon charitable',
    'renaissance charitable','american endowment foundation',
    'us charitable gift trust'
  ];
  // Name patterns that strongly imply intermediary status.
  const INTERMEDIARY_NAME_PATTERNS = [
    /community\s+foundation/i,
    /jewish\s+(community\s+)?federation/i,
    /jewish\s+communal\s+fund/i,
    /jewish\s+communities?\b/i,
    /\bunited\s+jewish\b/i,
    /allied\s+jewish/i,
    /charitable\s+gift\s+fund/i,
    /charitable\s+trust\b/i,
    /donor.advised/i,
    /\bdaf\b/i,
    /\bphilanthropic\s+trust\b/i,
    /\bcharitable\s+fund\b/i,
    /\bgiving\s+fund\b/i,
    /\bgiving\s+account\b/i,
    /federated\s+(giving|fund)/i,
    /\bunited\s+way\b/i,
    /catholic\s+charities/i,
    /fiscal\s+sponsor/i,
    /\bpooled\s+fund\b/i,
    /\bcollaborative\s+fund\b/i,
    /borealis\s+philanthropy/i,
    /neo\s+philanthropy/i,
    /hopewell\s+fund/i,
    /windward\s+fund/i,
    /sixteen\s+thirty\s+fund/i,
    /\barabella\s+advisors/i
  ];
  // Federation pattern — distinct so we can label specifically.
  const FEDERATION_PATTERN = /federation\b|federated\s+(giving|fund)|united\s+way/i;
  const COMMUNITY_FOUNDATION_PATTERN = /community\s+foundation/i;
  const FISCAL_SPONSOR_PATTERN = /fiscal\s+sponsor|tides\s+foundation|new\s+venture\s+fund|hopewell\s+fund|windward\s+fund|borealis\s+philanthropy|neo\s+philanthropy|arabella\s+advisors/i;

  function classifyIntermediary(name){
    if(!name) return null;
    const lc = String(name).toLowerCase().trim();
    // Confirmed DAF sponsor
    for(const k of KNOWN_DAF_SPONSORS){
      if(lc.includes(k)) return {tier:'confirmed', kind:'daf_sponsor', label:'Confirmed DAF Sponsor', confidence:'High'};
    }
    if(FEDERATION_PATTERN.test(name)){
      return {tier:'probable', kind:'federation', label:'Federation / Federated Giving', confidence:'Probable'};
    }
    if(COMMUNITY_FOUNDATION_PATTERN.test(name)){
      return {tier:'probable', kind:'community_foundation', label:'Community Foundation', confidence:'Probable'};
    }
    if(FISCAL_SPONSOR_PATTERN.test(name)){
      return {tier:'probable', kind:'fiscal_sponsor', label:'Fiscal Sponsor', confidence:'Probable'};
    }
    for(const re of INTERMEDIARY_NAME_PATTERNS){
      if(re.test(name)) return {tier:'possible', kind:'intermediary', label:'Probable Intermediary', confidence:'Possible'};
    }
    return null;
  }

  // ── MONEY-FLOW NAME MATCHING ─────────────────────────────────────────────
  // Federation and intermediary names often move between legal IRS names,
  // operating names, abbreviations, and "dba" variants.  This layer keeps the
  // existing exact-match engine, but adds a conservative alias matcher so the
  // Insight map can follow "foundation → federation → downstream recipient"
  // when the same institution is named differently across filings.
  function flowNameNorm(name){
    let s = String(name || '').toLowerCase();
    s = s.replace(/&/g, ' and ');
    s = s.replace(/\bnew\s+york\b/g, ' ny ');
    s = s.replace(/\bcalifornia\b/g, ' ca ');
    s = s.replace(/\billinois\b/g, ' il ');
    s = s.replace(/\bmassachusetts\b/g, ' ma ');
    s = s.replace(/\bohio\b/g, ' oh ');
    s = s.replace(/\bgeorgia\b/g, ' ga ');
    s = s.replace(/\bflorida\b/g, ' fl ');
    s = s.replace(/\bnew\s+jersey\b/g, ' nj ');
    s = s.replace(/\bpennsylvania\b/g, ' pa ');
    s = s.replace(/\b(d\/b\/a|dba|doing\s+business\s+as)\b.*$/g, ' ');
    s = s.replace(/[^a-z0-9]+/g, ' ');
    s = s.replace(/\b(the|and|of|for|to|in|at|by|a|an|inc|incorporated|corp|corporation|company|co|llc|ltd|limited|foundation|foundations|fund|funds|charitable|charity|trust|organization|organisations|organizations|org|association|assn|society)\b/g, ' ');
    return s.replace(/\s+/g, ' ').trim();
  }
  function flowNameTokens(name){
    const norm = flowNameNorm(name);
    if(!norm) return [];
    return norm.split(' ').filter(t => t.length > 1);
  }
  function flowTokenScore(aTokens, bTokens){
    if(!aTokens.length || !bTokens.length) return 0;
    const a = new Set(aTokens), b = new Set(bTokens);
    let inter = 0;
    a.forEach(t => { if(b.has(t)) inter++; });
    const smaller = Math.min(a.size, b.size);
    const larger = Math.max(a.size, b.size);
    const containment = smaller ? inter / smaller : 0;
    const jaccard = larger ? inter / larger : 0;
    return (containment * 0.72) + (jaccard * 0.28);
  }
  function flowEntityTypeFor(name, foundationObj){
    if(foundationObj && foundationObj.entity_type) return foundationObj.entity_type;
    const cls = classifyIntermediary(name);
    if(cls && cls.kind === 'federation') return 'Federation';
    if(cls && cls.kind === 'daf_sponsor') return 'DAF sponsor';
    if(cls) return 'Intermediary';
    return 'Organization';
  }

  function buildMoneyFlowIndex(foundations, R, RG, institutionMapAll){
    const foundationObjs = Array.isArray(foundations) ? foundations : [];
    const instObjs = Array.isArray(institutionMapAll) ? institutionMapAll : [];
    const byLower = new Map();
    const byNorm = new Map();
    const candidates = [];

    function addCandidate(name, meta){
      if(!name) return;
      const label = String(name);
      const lower = label.toLowerCase();
      const norm = flowNameNorm(label);
      const tokens = flowNameTokens(label);
      const existing = byLower.get(lower);
      if(existing) return;
      const c = {
        name: label,
        lower,
        norm,
        tokens,
        foundationObj: meta && meta.foundationObj,
        instObj: meta && meta.instObj,
        rgKey: meta && meta.rgKey,
        rKey: meta && meta.rKey
      };
      byLower.set(lower, c);
      if(norm && !byNorm.has(norm)) byNorm.set(norm, c);
      candidates.push(c);
    }

    foundationObjs.forEach(f => addCandidate(f.name, { foundationObj:f }));
    instObjs.forEach(f => addCandidate(f.name, { instObj:f }));
    Object.keys(RG || {}).forEach(k => addCandidate(k, { rgKey:k }));
    Object.keys(R || {}).forEach(k => addCandidate(k, { rKey:k }));
    const fedUpdate = window.FEDERATION_DASHBOARD_UPDATE || {};
    (fedUpdate.foundations || []).forEach(f => addCandidate(f.name, { foundationObj:f }));

    // Merge metadata for candidates whose name already existed.
    foundationObjs.forEach(f => {
      const c = byLower.get(String(f.name||'').toLowerCase());
      if(c && !c.foundationObj) c.foundationObj = f;
    });
    instObjs.forEach(f => {
      const c = byLower.get(String(f.name||'').toLowerCase());
      if(c && !c.instObj) c.instObj = f;
    });
    Object.keys(RG || {}).forEach(k => {
      const c = byLower.get(String(k||'').toLowerCase());
      if(c && !c.rgKey) c.rgKey = k;
    });
    Object.keys(R || {}).forEach(k => {
      const c = byLower.get(String(k||'').toLowerCase());
      if(c && !c.rKey) c.rKey = k;
    });

    function findGrantmakerForRecipient(name){
      if(!name) return null;
      const lower = String(name).toLowerCase();
      if(byLower.has(lower)) return {...byLower.get(lower), matchType:'exact', matchScore:1};
      const norm = flowNameNorm(name);
      if(norm && byNorm.has(norm)) return {...byNorm.get(norm), matchType:'normalized', matchScore:0.98};
      const tokens = flowNameTokens(name);
      if(tokens.length < 3) return null;
      let best = null;
      for(const c of candidates){
        if(!c.tokens || c.tokens.length < 3) continue;
        const score = flowTokenScore(tokens, c.tokens);
        if(score > (best ? best.matchScore : 0)){
          best = {...c, matchType:'token', matchScore:score};
        }
      }
      if(!best || best.matchScore < 0.78) return null;
      // Require the primary institutional noun to agree for fuzzy matches.
      const recipientNorm = flowNameNorm(name);
      const isFedQuery = /\bfederation\b|\buja\b|\bunited jewish\b/.test(recipientNorm);
      const isFedCandidate = /\bfederation\b|\buja\b|\bunited jewish\b/.test(best.norm || '');
      if(isFedQuery && !isFedCandidate) return null;
      return best;
    }

    function getGrantmakerKey(name){
      const match = findGrantmakerForRecipient(name);
      if(!match) return null;
      if(match.rKey && R[match.rKey]) return match.rKey;
      if(R[match.name]) return match.name;
      const exactR = Object.keys(R || {}).find(k => flowNameNorm(k) === match.norm);
      if(exactR) return exactR;
      if(match.rgKey && RG[match.rgKey]) return match.rgKey;
      if(RG[match.name]) return match.name;
      const exactRG = Object.keys(RG || {}).find(k => flowNameNorm(k) === match.norm);
      if(exactRG) return exactRG;
      return match.name;
    }

    function readRecipientRows(sourceName){
      if(!sourceName) return [];
      if(R[sourceName]) return R[sourceName] || [];
      const norm = flowNameNorm(sourceName);
      const key = Object.keys(R || {}).find(k => flowNameNorm(k) === norm);
      return key ? (R[key] || []) : [];
    }

    function rowToRecipient(r){
      return {
        name: r[0],
        city: r[1],
        state: r[2],
        total: +r[3] || 0,
        jewish: +r[4] || 0,
        nonjewish: +r[5] || 0,
        misc: +r[6] || 0,
        count: +r[7] || 0,
        yearMin: r[8],
        yearMax: r[9],
        topSubject: r[10],
        cause: r[11]
      };
    }

    const sourceByLower = new Map(instObjs.map(f => [String(f.name||'').toLowerCase(), f]));
    const hubs = {};
    const bySource = {};
    const byHub = {};
    const byRecipient = {};
    const flowRows = [];

    function ensureHub(match, inboundDisplayName){
      if(!match) return null;
      const key = match.name;
      if(!hubs[key]){
        const fObj = match.foundationObj || foundationObjs.find(f => flowNameNorm(f.name) === match.norm);
        const instObj = match.instObj || sourceByLower.get(String(match.name||'').toLowerCase());
        const cls = classifyIntermediary(match.name) || classifyIntermediary(inboundDisplayName);
        const downstreamRows = readRecipientRows(getGrantmakerKey(match.name) || match.name).map(rowToRecipient);
        const outbound = downstreamRows.reduce((a,c)=>a+(+c.total||0),0);
        const downstreamCount = downstreamRows.reduce((a,c)=>a+(+c.count||0),0);
        hubs[key] = {
          name: match.name,
          display: orgDisplayLabel(match.name),
          entityType: flowEntityTypeFor(match.name, fObj),
          classification: cls,
          inbound: 0,
          inboundCount: 0,
          outbound,
          outboundCount: downstreamCount,
          sourceCount: 0,
          downstreamCount: downstreamRows.length,
          funders: {},
          recipients: {},
          subjects: {},
          inboundEdges: [],
          topDownstream: downstreamRows.sort((a,b)=>b.total-a.total).slice(0, 10),
          foundationObj: fObj,
          instObj
        };
        hubs[key].topDownstream.forEach(r => {
          hubs[key].recipients[r.name] = r.total || 0;
        });
      }
      return hubs[key];
    }

    Object.keys(R || {}).forEach(sourceName => {
      const rows = R[sourceName] || [];
      const sourceMatch = findGrantmakerForRecipient(sourceName);
      const sourceCanonical = sourceMatch ? sourceMatch.name : sourceName;
      const sourceNorm = flowNameNorm(sourceCanonical);
      rows.forEach(r => {
        const rec = rowToRecipient(r);
        if(!rec.name || !rec.total) return;
        const match = findGrantmakerForRecipient(rec.name);
        if(!match) return;
        if(flowNameNorm(match.name) === sourceNorm) return;
        const cls = classifyIntermediary(match.name) || classifyIntermediary(rec.name);
        const hasDownstream = !!(R[getGrantmakerKey(match.name)] || RG[getGrantmakerKey(match.name)] || R[match.name] || RG[match.name]);
        const isFederationLike = (cls && cls.kind === 'federation') || /federation/i.test(match.name) || (match.foundationObj && match.foundationObj.entity_type === 'Federation');
        if(!hasDownstream && !cls) return;
        const hub = ensureHub(match, rec.name);
        if(!hub) return;
        hub.inbound += rec.total || 0;
        hub.inboundCount += rec.count || 0;
        hub.funders[sourceCanonical] = (hub.funders[sourceCanonical] || 0) + (rec.total || 0);
        hub.sourceCount = Object.keys(hub.funders).length;
        if(rec.topSubject) hub.subjects[rec.topSubject] = (hub.subjects[rec.topSubject] || 0) + (rec.total || 0);
        const edge = {
          source: sourceCanonical,
          hub: match.name,
          recipientName: rec.name,
          amount: rec.total || 0,
          count: rec.count || 0,
          subject: rec.topSubject || '',
          cause: rec.cause || '',
          matchType: match.matchType,
          matchScore: match.matchScore,
          isFederationLike,
          hasDownstream
        };
        hub.inboundEdges.push(edge);
        flowRows.push(edge);
        if(!bySource[sourceCanonical]) bySource[sourceCanonical] = [];
        if(!byHub[match.name]) byHub[match.name] = [];
        if(!byRecipient[rec.name]) byRecipient[rec.name] = [];
        bySource[sourceCanonical].push(edge);
        byHub[match.name].push(edge);
        byRecipient[rec.name].push(edge);
      });
    });

    Object.values(hubs).forEach(h => {
      h.inboundEdges.sort((a,b)=>b.amount-a.amount);
      h.topFunders = Object.entries(h.funders).sort((a,b)=>b[1]-a[1]).slice(0, 10).map(([name,amount])=>({name,amount}));
      h.topSubjects = Object.entries(h.subjects).sort((a,b)=>b[1]-a[1]).slice(0, 6).map(([name,amount])=>({name,amount}));
      h.passThroughRisk = h.inbound > 0 && h.outbound > 0 ? Math.min(1, Math.min(h.inbound, h.outbound) / Math.max(h.inbound, h.outbound)) : 0;
      h.score = (h.inbound * 0.8) + (h.outbound * 0.45) + (h.passThroughRisk * 15000000) + ((h.classification && h.classification.kind === 'federation') ? 25000000 : 0);
    });

    const federationFlowHubs = Object.values(hubs)
      .filter(h => h.entityType === 'Federation' || (h.classification && h.classification.kind === 'federation'))
      .sort((a,b)=>b.score-a.score)
      .slice(0, 18);

    return {
      candidates,
      byLower,
      byNorm,
      findGrantmakerForRecipient,
      getGrantmakerKey,
      readRecipientRows,
      flowRows,
      hubs: Object.values(hubs).sort((a,b)=>b.score-a.score),
      hubsByName: hubs,
      bySource,
      byHub,
      byRecipient,
      federationFlowHubs
    };
  }

  // ── SUBJECT TAXONOMY (categorization of every subject string) ─────────────
  // Heuristic, content-driven. Each rule fires in order — first match wins.
  // Categories chosen so that virtually every subject in the IRS BMF subject
  // taxonomy (~700 distinct) lands in a meaningful bucket. All subjects remain
  // visible via the drawer regardless of categorisation.
  const SUBJECT_CATEGORY_RULES = [
    ['Jewish life & religion', /\b(jew|judaism|kosher|kashrut|yeshiv|torah|talmud|kollel|chabad|hassid|hasid|orthodox|conservative|reform|messianic|israel(i)?|zioni|aliyah|holocaust|shoah|antisem|anti[\-\s]?semit|sephardi|ashkenaz|synagog|temple|jcc|hillel|chevra|chevrah)\b/i],
    ['Religion (other)',        /\b(religion|religious|christian|catholic|protestant|evangel|missionar|church|theolog|seminary|pastoral|monaster|chaplain|interfaith|islamic|muslim|hindu|buddhi|spiritual)\b/i],
    ['Higher education',        /\b(univers|college|graduate|doctoral|professional school|academ|law school|medical school|business school|stem education|higher education)\b/i],
    ['K–12 & early education',  /\b(elementary|secondary|middle school|high school|preschool|kindergart|early childhood|primary education|day school|charter school|montessori|tutor|literacy)\b/i],
    ['Other education',         /\b(educat|school|teach|curricul|stem(\s|$)|scholarship|student|library|libraries|learning|pedagog)\b/i],
    ['Health — medical care',   /\b(hospital|medic|clinic|patient|surgery|surgical|nursing|hospice|emergency medical|telehealth|disease|cancer|cardio|diabetes|alzheimer|dental|psychiatr)\b/i],
    ['Health — research',       /\b(biomed|biomedical|medical research|clinical research|public health|epidem|genom|genetic|stem cell|drug research)\b/i],
    ['Mental health & addiction', /\b(mental health|behavioral|addiction|substance abuse|opioid|recovery|suicide|trauma|counseling|therap)\b/i],
    ['Health — other',          /\b(health|wellness|fitness|nutrition|reproductive|HIV|AIDS|infectious|vaccin)\b/i],
    ['Human services',          /\b(human services|social services|family services|child welfare|child abuse|elder|senior|aging|disabilit|developmental|foster|adoption|veteran|caregiver)\b/i],
    ['Housing & homelessness',  /\b(housing|shelter|homeless|residential|rental|tenant|fair housing|eviction|community development|neighborhood)\b/i],
    ['Hunger & food security',  /\b(hunger|food bank|food pantry|food security|food insecurity|nutrition assistance|meals)\b/i],
    ['Employment & workforce',  /\b(employment|workforce|workforce development|jobs|job training|vocational|apprenticeship|career|labor|union|business and industry|entrepreneur|small business|microfinance)\b/i],
    ['Economic development',    /\b(economic development|community and economic|rural development|urban|industry|business|commerce|enterprise|cooperative)\b/i],
    ['Civil rights & democracy',/\b(civil rights|civic|democra|voting|voter|elections?|gerrymander|antidiscrimin|equal|justice|reform|policy reform|public policy|public affairs|government|legislative)\b/i],
    ['Human rights & advocacy', /\b(human rights|advocac|reform|criminal justice|incarcer|police reform|prison|reentry|reentry|peace|international peace)\b/i],
    ['Race, ethnicity & identity', /\b(race|racial|ethnic|minorit|black|african american|hispanic|latin|asian|indigenous|native|tribal|LGBT|gay|lesbian|transgender|queer|gender|women|girls|feminis)\b/i],
    ['Immigration & refugees',  /\b(immigrant|migrant|migration|refugee|asylum|undocument|naturaliz|border)\b/i],
    ['Environment & climate',   /\b(climate|environment|conservation|wildlife|ocean|forest|river|watershed|biodivers|sustainab|natural resourc|land trust|species|pollut|wetland|park|outdoor)\b/i],
    ['Energy & infrastructure', /\b(energy|renewable|solar|wind|nuclear|oil|gas|electric|grid|water supply|utilit|transportation|infrastructure)\b/i],
    ['International development',/\b(international development|developing countr|global health|global development|africa|latin america|asia|middle east|foreign|cross.?border)\b/i],
    ['Arts, culture & humanities', /\b(art|arts|culture|cultural|museum|theatre|theater|orchestra|symphony|opera|dance|ballet|film|cinema|music|musical|literature|poetry|humaniti|history|historic preservation|heritage|design|architecture|public broadcasting|media arts)\b/i],
    ['Media & journalism',      /\b(journal|news|public broadcasting|media|newspaper|investigative|press freedom)\b/i],
    ['Science & technology',    /\b(science|scientif|research|technolog|engineering|mathematics|computer|software|artificial intelligence|innovation|space|astronomy|physics|chemistry|biology)\b/i],
    ['Sports & recreation',     /\b(athletic|sport|recreation|olympi|swimming|football|basketball|baseball|tennis|golf|youth sport)\b/i],
    ['Youth & children',        /\b(child|children|youth|young|teenager|adolescent|after.?school|mentoring|scouts|boys.?girls)\b/i],
    ['Animal welfare',          /\b(animal|pet|veterinary|wildlife rehabilitation|humane|zoo|aquarium)\b/i],
    ['Disasters & emergency',   /\b(disaster|emergenc|relief|humanitar|crisis|war|conflict|displace)\b/i],
    ['Philanthropy & nonprofit infrastructure', /\b(philanthrop|foundation|nonprofit|charit|grantmak|donor|funding|capacity building|board governance)\b/i],
    ['Faith-based services',    /\b(faith.?based|ministry|missionary|outreach|congregat)\b/i],
    ['Public safety & legal',   /\b(safety|legal aid|legal services|attorney|courts|fire|EMS|police|crime|domestic violence)\b/i],
    ['Other / general operating',/.*/i]
  ];
  function classifySubject(s){
    if(!s) return 'Other / general operating';
    for(const [cat, re] of SUBJECT_CATEGORY_RULES){
      if(re.test(s)) return cat;
    }
    return 'Other / general operating';
  }

  // ── BUILD COMPACT INSIGHT DATASETS ────────────────────────────────────────
  // We build these once per dataLayer change and cache.
  let cache = null;
  let cacheKey = null;

  function buildDatasets(){
    const D = getD();
    const R = getR() || {};
    const RG = getRG() || {};

    if(!D){
      return { ok:false, reason:'No DASHBOARD_DATA available.' };
    }

    // Total counts and dollars from D.totals if available
    const totals = D.totals || {};
    const T_jewish = +totals.jewish_amount || 0;
    const T_nonjewish = +totals.non_jewish_amount || 0;
    const T_misc = +totals.misc_amount || 0;
    const T_total = T_jewish + T_nonjewish + T_misc;
    const C_jewish = +totals.jewish_count || 0;
    const C_nonjewish = +totals.non_jewish_count || 0;
    const C_misc = +totals.misc_count || 0;
    const C_total = +totals.total_grants || (C_jewish + C_nonjewish + C_misc);
    const F_total = +totals.total_foundations || (Array.isArray(D.foundations) ? D.foundations.length : 0);

    // ── Subject map (Jewish / Non-Jewish → top subjects) ───────────────────
    // D.top_subjects: list[25] of {subject, jewish, non_jewish, misc}
    const subjectsAll = Array.isArray(D.top_subjects) ? D.top_subjects.slice() : [];
    const jSubjects = subjectsAll
      .map(s => ({ name:s.subject, amount: +s.jewish||0, count:0 }))
      .filter(s => s.amount > 0)
      .sort((a,b)=>b.amount-a.amount)
      .slice(0, 14);
    const njSubjects = subjectsAll
      .map(s => ({ name:s.subject, amount: +s.non_jewish||0, count:0 }))
      .filter(s => s.amount > 0)
      .sort((a,b)=>b.amount-a.amount)
      .slice(0, 14);

    // Augment subject entries with grant counts and top funders/recipients by walking foundations top_subjects
    // (we'll compute them lazily per subject when drilled into — for performance).

    // ── Geography map ──────────────────────────────────────────────────────
    // D.geography: { 'United States': {jewish, non_jewish, misc}, 'Israel': {...}, ... }
    // D.year_geo: { '2024': { 'United States': {j, nj, m}, ... } }
    const geo = D.geography || {};
    const geoBuckets = ['United States','Israel','International','Miscellaneous'].filter(k => geo[k]);
    const geoData = geoBuckets.map(k => ({
      name:k,
      jewish: +geo[k].jewish||0,
      nonjewish: +geo[k].non_jewish||0,
      misc: +geo[k].misc||0,
      total: (+geo[k].jewish||0)+(+geo[k].non_jewish||0)+(+geo[k].misc||0)
    })).sort((a,b)=>b.total-a.total);

    // For state-level breakdown within US: aggregate from foundation.state field
    const stateAgg = {};
    if(Array.isArray(D.foundations)){
      D.foundations.forEach(f => {
        const st = f.state || '—';
        if(!stateAgg[st]) stateAgg[st] = {jewish:0,nonjewish:0,misc:0,count:0,total:0};
        stateAgg[st].jewish += +f.jewish_amount||0;
        stateAgg[st].nonjewish += +f.non_jewish_amount||0;
        stateAgg[st].misc += +f.misc_amount||0;
        stateAgg[st].count += +f.total_count||0;
        stateAgg[st].total += +f.total_amount||0;
      });
    }
    const topStates = Object.entries(stateAgg)
      .map(([state,v])=> ({name:state, ...v}))
      .sort((a,b)=>b.total-a.total)
      .slice(0,12);

    // ── Institutions map ───────────────────────────────────────────────────
    // Top foundations by total $; then for each, look at recipients in R[name],
    // detect intermediaries, and attempt to flag downstream patterns.
    const foundations = Array.isArray(D.foundations) ? D.foundations.slice() : [];
    foundations.sort((a,b) => (+b.total_amount||0) - (+a.total_amount||0));

    // For each foundation, gather top recipients & intermediary count. We render
    // only a readable subset, but keep the full map so major federation hubs
    // like UJA can be focused even when discovered as recipients/intermediaries.
    const mapInstitutionFoundation = (f) => {
      const name = f.name;
      const recRows = (R[name] || []);
      // recRows shape: [name, city, state, total, jewish, nonjewish, misc, count, yearMin, yearMax, topSubject, cause]
      const recList = recRows.slice(0, 50).map(r => ({
        name: r[0],
        city: r[1],
        state: r[2],
        total: +r[3]||0,
        jewish: +r[4]||0,
        nonjewish: +r[5]||0,
        misc: +r[6]||0,
        count: +r[7]||0,
        yearMin: r[8],
        yearMax: r[9],
        topSubject: r[10],
        cause: r[11]
      }));
      const intermediaryRecs = recList
        .map(rec => ({...rec, intermediary: classifyIntermediary(rec.name)}))
        .filter(r => r.intermediary);
      const interTotal = intermediaryRecs.reduce((a,c)=>a+c.total, 0);
      return {
        name,
        state: f.state,
        total: +f.total_amount||0,
        jewish: +f.jewish_amount||0,
        nonjewish: +f.non_jewish_amount||0,
        misc: +f.misc_amount||0,
        count: +f.total_count||0,
        topRecipients: recList.slice(0, 8),
        intermediaryRecs,
        interTotal,
        intermediarySelf: classifyIntermediary(name)
      };
    };
    const institutionMapAll = foundations.map(mapInstitutionFoundation);
    const institutionMap = institutionMapAll.slice(0, 18);

    // Flat list of intermediary recipients across all foundations
    const interRecMap = {};
    Object.keys(R).forEach(fdName => {
      const recRows = R[fdName] || [];
      recRows.forEach(r => {
        const recName = r[0];
        const cls = classifyIntermediary(recName);
        if(!cls) return;
        if(!interRecMap[recName]){
          interRecMap[recName] = {
            name: recName,
            classification: cls,
            total: 0,
            count: 0,
            funders: {},
            jewish: 0,
            nonjewish: 0,
            yearMin: 9999,
            yearMax: 0
          };
        }
        const obj = interRecMap[recName];
        obj.total += +r[3]||0;
        obj.jewish += +r[4]||0;
        obj.nonjewish += +r[5]||0;
        obj.count += +r[7]||0;
        if(r[8] && r[8] < obj.yearMin) obj.yearMin = r[8];
        if(r[9] && r[9] > obj.yearMax) obj.yearMax = r[9];
        obj.funders[fdName] = (obj.funders[fdName] || 0) + (+r[3]||0);
      });
    });
    const intermediariesList = Object.values(interRecMap).sort((a,b)=>b.total-a.total);

    // Estimate "likely intermediary flow" total — sum of grants going to flagged intermediaries
    const interFlowTotal = intermediariesList.reduce((a,c)=>a+c.total, 0);

    const hubMap = {};
    function ensureHub(name, cls){
      if(!name) return null;
      const key = String(name).toLowerCase();
      if(!hubMap[key]){
        hubMap[key] = { name, display:orgDisplayLabel(name), classification:cls || classifyIntermediary(name),
                        inbound:0, outbound:0, count:0, isSource:false, isRecipient:false };
      }
      if(cls && !hubMap[key].classification) hubMap[key].classification = cls;
      return hubMap[key];
    }
    intermediariesList.forEach(h => {
      const obj = ensureHub(h.name, h.classification);
      if(!obj) return;
      obj.inbound += +h.total || 0;
      obj.count += +h.count || 0;
      obj.isRecipient = true;
    });
    institutionMapAll.forEach(f => {
      const cls = f.intermediarySelf;
      if(!cls) return;
      const obj = ensureHub(f.name, cls);
      if(!obj) return;
      obj.outbound += +f.total || 0;
      obj.count += +f.count || 0;
      obj.isSource = true;
    });
    const federationSpotlight = Object.values(hubMap)
      .filter(h => h.classification && (h.classification.kind === 'federation' || h.inbound > 10000000 || h.outbound > 100000000))
      .sort((a,b) => ((b.inbound+b.outbound)+(b.isSource&&b.isRecipient?b.outbound*0.4:0)) - ((a.inbound+a.outbound)+(a.isSource&&a.isRecipient?a.outbound*0.4:0)))
      .slice(0, 8);

    // Years span
    let yearMin = 9999, yearMax = 0;
    if(D.year_trend){
      Object.keys(D.year_trend).forEach(y => {
        const n = +y;
        if(n>0 && n<yearMin) yearMin = n;
        if(n>yearMax) yearMax = n;
      });
    }
    const yearList = D.year_trend ? Object.keys(D.year_trend).map(Number).filter(n=>n>0).sort((a,b)=>a-b) : [];

    // ── Build full subject taxonomy from RG (covers every subject in the data)
    // Each subject → totals by orientation + top funders + top recipients (lazy-deeper for now)
    const subjectIndex = {}; // name -> { name, total, jewish, nonjewish, misc, count, funders:Map, recipients:Map, samples:[] }
    Object.keys(RG).forEach(fdName => {
      const recs = RG[fdName] || {};
      Object.keys(recs).forEach(recName => {
        const grants = recs[recName] || [];
        for(let i=0;i<grants.length;i++){
          const g = grants[i];
          const subj = (g[3]||'').trim();
          if(!subj) continue;
          const amt = +g[1] || 0;
          const cause = g[2] || '';
          let s = subjectIndex[subj];
          if(!s){
            s = subjectIndex[subj] = { name:subj, total:0, jewish:0, nonjewish:0, misc:0, count:0,
                                       funders:{}, recipients:{}, samples:[] };
          }
          s.total += amt; s.count += 1;
          if(cause === 'J') s.jewish += amt;
          else if(cause === 'NJ') s.nonjewish += amt;
          else s.misc += amt;
          s.funders[fdName] = (s.funders[fdName]||0) + amt;
          s.recipients[recName] = (s.recipients[recName]||0) + amt;
          if(s.samples.length < 6 && amt > 0){
            s.samples.push({ year:g[0], funder:fdName, recipient:recName, amount:amt, cause });
          }
        }
      });
    });
    const allSubjects = Object.values(subjectIndex).sort((a,b)=>b.total-a.total);

    // Group subjects into categories. Each subject can fall under one category;
    // we also tag whether it leans Jewish, Non-Jewish, or balanced.
    const subjectCategories = {}; // name -> { name, total, jewish, nonjewish, misc, count, subjects:[], lean }
    allSubjects.forEach(s => {
      const cat = classifySubject(s.name);
      if(!subjectCategories[cat]) subjectCategories[cat] = {
        name:cat, total:0, jewish:0, nonjewish:0, misc:0, count:0, subjects:[]
      };
      const c = subjectCategories[cat];
      c.total += s.total; c.jewish += s.jewish; c.nonjewish += s.nonjewish; c.misc += s.misc; c.count += s.count;
      // tag lean per subject
      const lean = s.jewish > s.nonjewish*2 && s.jewish > 0 ? 'J'
                 : s.nonjewish > s.jewish*2 && s.nonjewish > 0 ? 'NJ'
                 : (s.jewish > 0 || s.nonjewish > 0) ? 'mixed' : 'M';
      s.lean = lean;
      c.subjects.push(s);
    });
    Object.values(subjectCategories).forEach(c => c.subjects.sort((a,b)=>b.total-a.total));
    const subjectCategoriesList = Object.values(subjectCategories).sort((a,b)=>b.total-a.total);

    // ── Foundation-name / alias index so we can detect downstream re-grants.
    // This preserves the original exact lower-case set, then augments it with
    // normalized / token matching for federations and legal-name variants.
    const foundationLCSet = new Set(foundations.map(f => f.name.toLowerCase()));
    // Also include any RG keys (some grantmakers may not be in D.foundations but appear as RG keys)
    Object.keys(RG).forEach(fd => foundationLCSet.add(fd.toLowerCase()));
    const moneyFlowIndex = buildMoneyFlowIndex(foundations, R, RG, institutionMapAll);
    function isAlsoGrantmaker(name){
      if(!name) return false;
      const raw = String(name).toLowerCase();
      if(foundationLCSet.has(raw)) return true;
      const hit = moneyFlowIndex.findGrantmakerForRecipient(name);
      return !!(hit && (RG[hit.name] || R[hit.name] || RG[moneyFlowIndex.getGrantmakerKey(hit.name)] || R[moneyFlowIndex.getGrantmakerKey(hit.name)]));
    }

    // ── Downstream chain mining (recipient -> downstream when recipient is also a grantmaker in RG)
    // We compute it on demand inside the institution graph builder, but we expose helpers here.
    // RG[recipientName] (when present) = { downstreamRecipient: [grants[]] }

    return {
      ok:true,
      totals: { T_jewish, T_nonjewish, T_misc, T_total, C_jewish, C_nonjewish, C_misc, C_total, F_total },
      yearMin, yearMax, yearList,
      jSubjects, njSubjects, subjectsAll,
      // NEW
      subjectIndex, allSubjects, subjectCategoriesList,
      foundationLCSet, isAlsoGrantmaker,
      geoData, topStates,
      institutionMap, institutionMapAll, intermediariesList, interFlowTotal, federationSpotlight,
      moneyFlowIndex, federationFlowHubs: moneyFlowIndex.federationFlowHubs,
      // Index of foundation→recipients for drill-down
      R, RG, foundations
    };
  }

  function getDatasets(){
    const layer = (window.dataLayer || 'existing') + ':' + (window.includeFutureCommitments ? 'fut':'pa');
    if(cache && cacheKey === layer) return cache;
    cache = buildDatasets();
    cacheKey = layer;
    return cache;
  }
  // Expose so dashboard can invalidate after layer toggle
  window.invalidateInsightsCache = function(){ cache = null; cacheKey = null;
    if(window.__insState && window.__insState.mounted) renderInsights(); };

  // ── STATE ─────────────────────────────────────────────────────────────────
  const state = {
    mounted: false,
    map: 'subject',     // subject | institution | geography
    filter: {
      search:'', year:'all', cause:'all', interOnly:false,
      subjectCategory:null,    // focused category (subject map L2)
      subjectName:null,        // focused individual subject (subject map L3)
      focusFoundation:null,    // focused source (institution map L1)
      focusRecipient:null      // focused recipient/intermediary (institution map L2)
    },
    drawerOpen:false,
    drawerSearch:'',
    selectedNodeId: null,
    transform: { x:0, y:0, k:1 },
    // Trace Mode (Institution map only)
    trace: {
      enabled:false,        // Trace Mode toggle on/off
      sourceId:null,        // currently traced L1 source node id
      sourceName:null,
      focusedL2:null,       // optional focused L2 (extends downstream/end-use for that branch)
      step:0,               // 0=idle, 1=source, 2=L2 edges/nodes, 3=L3 downstream, 4=end-use
      stoppedAt:null,       // 'l3'|'l4'|null when trace ends in available records
      paths:[],             // computed top paths for the source (and optional focused L2)
      timer:null            // step timer handle
    },
    // Human-in-the-loop identity training decisions captured in this browser session
    identityReviews:{},
    identityReviewDraft:null,
    identityQueueIndex:{}
  };
  window.__insState = state;

  // ── IDENTITY REVIEW QUEUE ─────────────────────────────────────────────────
  function identityReviewKey(name){
    return String(name||'').toLowerCase().replace(/\s+/g,' ').trim();
  }
  function identityReviewSignals(recName, fdStats, topSubject){
    const name = String(recName||'');
    const subject = String(topSubject||'');
    const reasons = [];
    let score = 0;
    const add = (pts, label) => { score += pts; reasons.push(label); };
    if(/\b(israel|israeli|jerusalem|yerushalayim|tel\s*aviv|galilee|negev|zion|zionist)\b/i.test(name+' '+subject)) add(36, 'Israel/Zionist geography or mission signal');
    if(/\b(hebrew|judaic|judaism|torah|yeshiva|beit|bais|beit\s+midrash|jewish|kosher|shalom|hillel|chabad)\b/i.test(name+' '+subject)) add(34, 'Jewish education / religion / community term');
    if(/\b(holocaust|antisemitism|anti-semitism|survivor|diaspora|olim|aliyah)\b/i.test(name+' '+subject)) add(30, 'Jewish peoplehood / diaspora / Holocaust-related signal');
    if(/\b(american\s+friends\s+of|friends\s+of)\b/i.test(name) && /\b(israel|jerusalem|hebrew|tel\s*hashomer|sheba|hadassah)\b/i.test(name)) add(28, 'American Friends / Israel-linked support pattern');
    const jewishFunderCount = Object.keys(fdStats||{}).filter(fd => /\b(jewish|uja|federation|adelson|schusterman|koret|wexner|crown|steinhardt|klarman|singer|bronfman|natan|jim joseph|revson)\b/i.test(fd)).length;
    if(jewishFunderCount >= 3) add(22, `${jewishFunderCount} Jewish-ecosystem funders`);
    else if(jewishFunderCount >= 1) add(11, `${jewishFunderCount} Jewish-ecosystem funder`);
    if(/\b(religion|graduate and professional education|higher education|human services|immigrant services|senior services)\b/i.test(subject) && jewishFunderCount >= 1) add(10, 'Broad subject plus Jewish funder context');
    return {score, reasons};
  }
  function buildIdentityReviewQueue(ds){
    const byRec = {};
    Object.entries(ds.RG||{}).forEach(([fdName,recs]) => {
      Object.entries(recs||{}).forEach(([recName,grants]) => {
        (grants||[]).forEach(g => {
          const cc = g[2] || 'NJ';
          if(cc === 'J') return;
          const yr = String(g[0]||'');
          if(state.filter.year !== 'all' && yr !== String(state.filter.year)) return;
          const amt = +g[1] || 0;
          const subj = g[3] || '';
          const key = identityReviewKey(recName);
          if(!byRec[key]) byRec[key] = {name:recName,total:0,count:0,subjects:{},funders:{},years:new Set(),classCounts:{NJ:0,M:0}};
          const row = byRec[key];
          row.total += amt; row.count += 1; row.subjects[subj] = (row.subjects[subj]||0)+amt;
          if(cc === 'M') row.classCounts.M += 1; else row.classCounts.NJ += 1;
          row.funders[fdName] = (row.funders[fdName]||0)+amt; if(yr) row.years.add(yr);
        });
      });
    });
    const reviewed = state.identityReviews || {};
    const reviewedKeys = new Set([
      ...Object.keys(reviewed || {}),
      ...(window.IDENTITY_REVIEW_DECISION_LOG || []).map(d => identityReviewKey(d?.recipientName))
    ]);
    return Object.values(byRec).map(row => {
      const topSubject = Object.entries(row.subjects).sort((a,b)=>b[1]-a[1])[0]?.[0] || '';
      const sig = identityReviewSignals(row.name, row.funders, topSubject);
      return {...row, topSubject, score:sig.score, reasons:sig.reasons};
    }).filter(r => r.score >= 34 && !reviewedKeys.has(identityReviewKey(r.name)))
      .sort((a,b) => (b.score-a.score) || (b.total-a.total))
      .slice(0, 8);
  }
  function renderIdentityReviewForm(r, decision){
    const label = decision === 'J' ? 'Approve as Jewish' : decision === 'NJ' ? 'Approve as Non-Jewish' : 'Needs research';
    const prompt = decision === 'J'
      ? 'Why should this recipient or grant flow be treated as Jewish-oriented? Include mission, community served, association, funder ecosystem, or evidence you want future updates to learn from.'
      : decision === 'NJ'
        ? 'Why should this remain Non-Jewish? Include the counter-signal or reason the Jewish/Israel/community hints are not sufficient.'
        : 'What research is needed before classification changes? Add the missing source, uncertainty, or next check.';
    return `<div class="identity-review-form" data-review-form="${escH(identityReviewKey(r.name))}">
      <div class="identity-review-form-title">${escH(label)} · reason required</div>
      <textarea class="identity-review-textarea" data-review-reason="${escH(identityReviewKey(r.name))}" placeholder="${escH(prompt)}"></textarea>
      <div class="identity-review-form-foot">
        <div class="identity-review-error" data-review-error="${escH(identityReviewKey(r.name))}"></div>
        <div>
          <button class="identity-review-cancel" data-review-cancel="${escH(identityReviewKey(r.name))}" type="button">Cancel</button>
          <button class="identity-review-submit" data-review-submit="${escH(identityReviewKey(r.name))}" type="button">Save and Learn</button>
        </div>
      </div>
    </div>`;
  }
  function renderIdentityReviewedPanel(){
    const reviewed = Object.values(state.identityReviews || {});
    if(!reviewed.length) return '';
    const rows = reviewed.slice().reverse().slice(0,6).map(r => {
      const badge = r.decision === 'J' ? 'Approved Jewish' : r.decision === 'NJ' ? 'Approved Non-Jewish' : 'Needs Research';
      return `<div class="identity-review-reviewed-item">
        <strong>${escH(r.name)}</strong>
        <span>${escH(badge)} · ${escH(r.years || 'all years')} · ${fmt$(r.amount || 0)}</span><br>
        <span>Reason: ${escH(r.reason)}</span>
      </div>`;
    }).join('');
    return `<div class="identity-review-reviewed">
      <div class="identity-review-reviewed-title">Session learning log · ${fmtN(reviewed.length)} decision${reviewed.length===1?'':'s'}</div>
      <div class="identity-review-reviewed-list">${rows}</div>
    </div>`;
  }
  function rerenderIdentityReviewHost(){
    if(document.body.classList.contains('admin-active') && typeof window.renderAdmin === 'function') renderAdmin();
    else renderInsights();
  }
  function renderIdentityReviewQueue(ds){
    const queue = buildIdentityReviewQueue(ds);
    state.identityQueueIndex = {};
    const total = queue.reduce((s,r)=>s+r.total,0);
    const rows = queue.map(r => {
      const key = identityReviewKey(r.name);
      const yearVals = [...r.years].map(y=>parseInt(y,10)).filter(Number.isFinite).sort((a,b)=>a-b);
      const yr = yearVals.length ? (yearVals[0]===yearVals[yearVals.length-1] ? String(yearVals[0]) : `${yearVals[0]}–${yearVals[yearVals.length-1]}`) : '—';
      state.identityQueueIndex[key] = {
        name:r.name,
        amount:r.total,
        grantCount:r.count,
        topSubject:r.topSubject,
        years:yr,
        signals:r.reasons.slice(0,6),
        score:r.score
      };
      const topFunders = Object.entries(r.funders).sort((a,b)=>b[1]-a[1]).slice(0,2).map(([f,a])=>`${f} (${fmt$(a)})`).join(' · ');
      const draft = state.identityReviewDraft && state.identityReviewDraft.key === key ? state.identityReviewDraft.decision : null;
      return `<div class="identity-review-row" data-review-row="${escH(key)}">
        <div class="identity-review-top">
          <div class="identity-review-name">${escH(r.name)}</div>
          <div class="identity-review-amt">${fmt$(r.total)}</div>
        </div>
        <div class="identity-review-reasons">${escH(r.reasons.slice(0,3).join(' · '))}</div>
        <div class="identity-review-meta">
          <span class="identity-review-chip">Score ${Math.round(r.score)}</span>
          <span class="identity-review-chip">${fmtN(r.count)} review grants</span>
          <span class="identity-review-chip">${escH(yr)}</span>
          ${r.topSubject ? `<span class="identity-review-chip">${escH(r.topSubject)}</span>` : ''}
        </div>
        ${topFunders ? `<div class="identity-review-note">Top funders: ${escH(topFunders)}</div>` : ''}
        <div class="identity-review-actions">
          <button class="identity-review-action jewish" data-review-action="J" data-review-key="${escH(key)}" type="button">Approve Jewish</button>
          <button class="identity-review-action nonjewish" data-review-action="NJ" data-review-key="${escH(key)}" type="button">Approve Non-Jewish</button>
          <button class="identity-review-action research" data-review-action="RESEARCH" data-review-key="${escH(key)}" type="button">Needs Research</button>
        </div>
        ${draft ? renderIdentityReviewForm(r, draft) : ''}
      </div>`;
    }).join('');
    return `<div class="identity-review-card" data-testid="identity-review-queue">
      <div class="identity-review-head">
        <div>
          <div class="identity-review-title">Identity Review Queue</div>
          <div class="identity-review-sub">For future updates: these remain classified as Non-Jewish or MISC, but show enough weak Jewish/Israel/community or funder-ecosystem signals to require manual review before any change.</div>
        </div>
        <div class="identity-review-badge">${fmtN(queue.length)} review candidates · ${fmt$(total)}</div>
      </div>
      <div class="identity-review-list">${rows || '<div class="identity-review-note">No uncertain candidates above the review threshold under the current filters.</div>'}</div>
      ${renderIdentityReviewedPanel()}
      <div class="identity-review-export">
        <div class="identity-review-note" style="border-top:0;margin-top:0;padding-top:0">This queue is intentionally conservative. Decisions update the current session immediately and export a training patch for permanent future classification rules.</div>
        <button type="button" data-review-export="json">Download training patch</button>
      </div>
    </div>`;
  }
  function wireIdentityReviewQueue(){
    const root = document.querySelector('[data-testid="identity-review-queue"]');
    if(!root) return;
    root.querySelectorAll('[data-review-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.identityReviewDraft = { key: btn.getAttribute('data-review-key'), decision: btn.getAttribute('data-review-action') };
        rerenderIdentityReviewHost();
        setTimeout(() => document.querySelector(`[data-review-reason="${CSS.escape(state.identityReviewDraft.key)}"]`)?.focus(), 0);
      });
    });
    root.querySelectorAll('[data-review-cancel]').forEach(btn => {
      btn.addEventListener('click', () => { state.identityReviewDraft = null; rerenderIdentityReviewHost(); });
    });
    root.querySelectorAll('[data-review-submit]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-review-submit');
        const row = state.identityQueueIndex?.[key];
        const decision = state.identityReviewDraft?.key === key ? state.identityReviewDraft.decision : null;
        const ta = root.querySelector(`[data-review-reason="${CSS.escape(key)}"]`);
        const err = root.querySelector(`[data-review-error="${CSS.escape(key)}"]`);
        const reason = String(ta?.value || '').trim();
        if(!reason){
          if(err) err.textContent = 'Please add a reason so future classification can learn from this decision.';
          ta?.focus();
          return;
        }
        if(!row || !decision){
          if(err) err.textContent = 'Review row could not be found. Please reopen the action.';
          return;
        }
        const reviewed = {
          name: row.name,
          decision,
          reason,
          amount: row.amount,
          grantCount: row.grantCount,
          topSubject: row.topSubject,
          years: row.years,
          signals: row.signals,
          score: row.score,
          reviewedAt: new Date().toISOString()
        };
        state.identityReviews = state.identityReviews || {};
        state.identityReviews[key] = reviewed;
        state.identityReviewDraft = null;
        if(typeof window.applyIdentityReviewDecision === 'function'){
          const result = window.applyIdentityReviewDecision({
            recipientName: row.name,
            decision,
            reason,
            amount: row.amount,
            grantCount: row.grantCount,
            topSubject: row.topSubject,
            years: row.years,
            signals: row.signals
          });
          if(!result?.ok){
            delete state.identityReviews[key];
            if(err) err.textContent = result?.error || 'Could not apply decision.';
            return;
          }
        } else {
          rerenderIdentityReviewHost();
        }
      });
    });
    root.querySelector('[data-review-export]')?.addEventListener('click', () => {
      const decisions = Object.values(state.identityReviews || {});
      if(!decisions.length){ alert('No Identity Review decisions have been saved in this session yet.'); return; }
      const patch = {
        type:'foundation_dashboard_identity_review_training_patch',
        version:1,
        exportedAt:new Date().toISOString(),
        dataLayer:window.dataLayer || 'existing',
        decisions
      };
      const blob = new Blob([JSON.stringify(patch,null,2)], {type:'application/json'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `identity-review-training-patch-${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    });
  }

  // ── RENDER OVERVIEW ───────────────────────────────────────────────────────
  function renderOverview(ds){
    const root = document.getElementById('insOverview');
    if(!root) return;
    if(!ds.ok){
      root.innerHTML = `<div class="ins-overview-card"><div class="ins-overview-title">Insights unavailable</div><div class="ins-overview-text">${escH(ds.reason||'Dashboard data not yet loaded.')}</div></div>`;
      return;
    }
    const t = ds.totals;
    const pctJ = t.T_total ? (t.T_jewish/t.T_total*100).toFixed(1) : '0';
    const interCount = ds.intermediariesList.length;
    const interPct = t.T_total ? (ds.interFlowTotal/t.T_total*100).toFixed(1) : '0';
    const subjectsCovered = (ds.subjectsAll||[]).length;
    const geoCovered = (ds.geoData||[]).length;
    const yearsLabel = (ds.yearMin && ds.yearMax) ? `${ds.yearMin}–${ds.yearMax}` : '—';

    root.innerHTML = `
      <div class="ins-overview-card">
        <div class="ins-overview-title">What this layer does</div>
        <div class="ins-overview-text">
          The Insights layer derives three connected mindmaps from this dashboard's grant records to show <strong>where money flows</strong>:
          across subjects/sectors, between institutions (with neutral, evidence-based markers for likely intermediaries — DAF sponsors, federations, community foundations, fiscal sponsors), and across geography. Click any node for a breakdown — totals, top funders, top recipients, and sample grants. Training and classification-review tools are now separated into the Admin workspace.
        </div>
        <div class="ins-trace-row">
          <span class="ins-trace-pill"><span class="ins-trace-dot t1"></span>Direct — source confirmed</span>
          <span class="ins-trace-pill"><span class="ins-trace-dot t2"></span>Likely direct — single hop</span>
          <span class="ins-trace-pill"><span class="ins-trace-dot t3"></span>Intermediary — donor indeterminate</span>
          <span class="ins-trace-pill"><span class="ins-trace-dot t4"></span>Multi-hop — source untraceable</span>
        </div>
      </div>
      <div class="ins-kpi-row">
        <div class="ins-kpi total">
          <div class="ins-kpi-lbl">Total tracked grants</div>
          <div class="ins-kpi-val">${fmt$(t.T_total)}</div>
          <div class="ins-kpi-sub">${fmtN(t.C_total)} grants · ${yearsLabel}</div>
        </div>
        <div class="ins-kpi subj">
          <div class="ins-kpi-lbl">Organizations</div>
          <div class="ins-kpi-val">${fmtN(t.F_total)}</div>
          <div class="ins-kpi-sub">grantmaking foundations indexed</div>
        </div>
        <div class="ins-kpi inter">
          <div class="ins-kpi-lbl">Likely intermediary flow</div>
          <div class="ins-kpi-val">${fmt$(ds.interFlowTotal)}</div>
          <div class="ins-kpi-sub">${fmtN(interCount)} flagged recipients · ${interPct}% of total</div>
        </div>
        <div class="ins-kpi geo">
          <div class="ins-kpi-lbl">Breadth</div>
          <div class="ins-kpi-val">${subjectsCovered} <span style="font-size:.85rem;color:var(--text-muted);font-weight:500">subjects</span></div>
          <div class="ins-kpi-sub">${geoCovered} geo regions · ${pctJ}% Jewish-orientation</div>
        </div>
      </div>`;
  }

  // ── RENDER TOOLBAR ────────────────────────────────────────────────────────
  function renderToolbar(ds){
    const root = document.getElementById('insToolbar');
    if(!root) return;
    const yearOptions = ['<option value="all">All years</option>'].concat(
      (ds.yearList||[]).map(y => `<option value="${y}">${y}</option>`)
    ).join('');
    const traceSourceOptions = (ds.institutionMapAll || ds.institutionMap || [])
      .slice(0, 160)
      .map(f => `<option value="${escH(f.name)}"></option>`)
      .join('');
    const federationFlowRows = (ds.federationFlowHubs || []).slice(0, 8).map((h, i) => {
      const risk = h.passThroughRisk ? `${Math.round(h.passThroughRisk*100)}% pass-through overlap` : 'one-sided flow';
      const topFunders = (h.topFunders||[]).slice(0,2).map(f => `${orgDisplayLabel(f.name)} ${fmt$(f.amount)}`).join(' · ');
      const topDown = (h.topDownstream||[]).slice(0,2).map(r => `${orgDisplayLabel(r.name)} ${fmt$(r.total)}`).join(' · ');
      const cls = h.classification && h.classification.kind === 'federation' ? 'federation' : 'intermediary';
      return `<div class="ins-flow-hub-card ${cls}" data-flow-hub="${escH(h.name)}">
        <div class="ins-flow-hub-rank">${i+1}</div>
        <div class="ins-flow-hub-main">
          <div class="ins-flow-hub-name" title="${escH(h.name)}">${escH(h.display || orgDisplayLabel(h.name))}</div>
          <div class="ins-flow-hub-meta">
            <span>In ${fmt$(h.inbound||0)}</span>
            <span>Out ${fmt$(h.outbound||0)}</span>
            <span>${fmtN(h.sourceCount||0)} sources</span>
            <span>${fmtN(h.downstreamCount||0)} downstream</span>
          </div>
          <div class="ins-flow-hub-route">${escH(topFunders || 'Inbound sources pending')} <span>→</span> ${escH(topDown || 'downstream recipients pending')}</div>
          <details class="ins-flow-hub-why">
            <summary>Why this is a flow hub</summary>
            <div>${escH((h.classification ? h.classification.label + '. ' : '') + 'This organization receives foundation dollars and also has downstream grant rows in the active Federation overlay. ' + risk + '.')}</div>
          </details>
        </div>
        <div class="ins-flow-hub-actions">
          <button data-flow-focus="${escH(h.name)}">Focus</button>
          <button data-flow-window="${escH(h.name)}">Open window</button>
        </div>
      </div>`;
    }).join('');
    const showFederationFlowBoard = window.includeFederationData !== false && !!federationFlowRows;
    const fedSummary = window.FEDERATION_DASHBOARD_UPDATE && window.FEDERATION_DASHBOARD_UPDATE.summary || {};
    const fedCoverageBadge = fedSummary.latest_filing_coverage_checked_at
      ? `<div class="ins-flow-hubs-badge" title="${escH(fedSummary.latest_filing_note || '')}">Latest filings: ${fmtN(fedSummary.federations_with_2024_structured_extracted||0)} structured 2024 · ${fmtN(fedSummary.federations_with_2024_pdf_pending_extraction||0)} PDF review</div>`
      : '';
    root.innerHTML = `
      <div class="ins-tabs" role="tablist">
        <button class="ins-tab ${state.map==='subject'?'active':''}" data-map="subject" role="tab" aria-selected="${state.map==='subject'}" data-testid="ins-tab-subject">
          <svg class="ins-tab-icon" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2.5" fill="currentColor"/><circle cx="2.5" cy="3" r="1.5" stroke="currentColor" stroke-width="1.4"/><circle cx="13.5" cy="3" r="1.5" stroke="currentColor" stroke-width="1.4"/><circle cx="2.5" cy="13" r="1.5" stroke="currentColor" stroke-width="1.4"/><circle cx="13.5" cy="13" r="1.5" stroke="currentColor" stroke-width="1.4"/><line x1="8" y1="8" x2="2.5" y2="3" stroke="currentColor" stroke-width="1"/><line x1="8" y1="8" x2="13.5" y2="3" stroke="currentColor" stroke-width="1"/><line x1="8" y1="8" x2="2.5" y2="13" stroke="currentColor" stroke-width="1"/><line x1="8" y1="8" x2="13.5" y2="13" stroke="currentColor" stroke-width="1"/></svg>
          Subjects
        </button>
        <button class="ins-tab ${state.map==='institution'?'active':''}" data-map="institution" role="tab" aria-selected="${state.map==='institution'}" data-testid="ins-tab-institution">
          <svg class="ins-tab-icon" viewBox="0 0 16 16" fill="none"><rect x="2" y="6" width="3" height="6" stroke="currentColor" stroke-width="1.4"/><rect x="6.5" y="3" width="3" height="9" stroke="currentColor" stroke-width="1.4"/><rect x="11" y="6" width="3" height="6" stroke="currentColor" stroke-width="1.4"/><line x1="1.5" y1="13" x2="14.5" y2="13" stroke="currentColor" stroke-width="1.2"/></svg>
          Institutions
        </button>
        <button class="ins-tab ${state.map==='geography'?'active':''}" data-map="geography" role="tab" aria-selected="${state.map==='geography'}" data-testid="ins-tab-geography">
          <svg class="ins-tab-icon" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/><path d="M2 8h12M8 2c1.8 2 1.8 10 0 12M8 2c-1.8 2-1.8 10 0 12" stroke="currentColor" stroke-width="1.2"/></svg>
          Geography
        </button>
      </div>
      <div class="ins-filter-group">
        <label>Search</label>
        <input class="ins-input ins-search" id="insSearch" placeholder="Filter nodes by name…" value="${escH(state.filter.search)}" data-testid="ins-search">
      </div>
      <div class="ins-filter-group">
        <label>Year</label>
        <select class="ins-input" id="insYear" data-testid="ins-year">${yearOptions}</select>
      </div>
      <div class="ins-filter-group">
        <label>Orientation</label>
        <select class="ins-input" id="insCause" data-testid="ins-cause">
          <option value="all">All</option>
          <option value="jewish">Jewish</option>
          <option value="nonjewish">Non-Jewish</option>
          <option value="misc">Miscellaneous</option>
        </select>
      </div>
      <label class="ins-filter-group" style="cursor:pointer;">
        <input type="checkbox" id="insInterOnly" ${state.filter.interOnly?'checked':''} data-testid="ins-inter-only">
        <span style="font-size:0.74rem;color:var(--text-muted);">Intermediaries only</span>
      </label>
      ${(state.filter.subjectCategory || state.filter.subjectName || state.filter.focusFoundation || state.filter.focusRecipient) ?
        '<button class="ins-reset" id="insClearFocus" data-testid="ins-clear-focus" style="background:rgba(99,102,241,0.12);color:#c7d2fe;border-color:rgba(99,102,241,0.4);margin-left:6px;">Clear drilldown</button>' : ''}
      ${state.map === 'institution' ? `
        <div class="ins-flow-search" data-testid="ins-flow-search">
          <label for="insTraceSearch">Trace foundation</label>
          <input class="ins-input" id="insTraceSearch" list="insTraceSourceOptions" placeholder="Search a foundation…" value="${escH(state.trace.sourceName || state.filter.focusFoundation || '')}" data-testid="ins-trace-search">
          <datalist id="insTraceSourceOptions">${traceSourceOptions}</datalist>
          <button class="ins-flow-search-btn" id="insTraceSearchBtn" data-testid="ins-trace-search-btn">Trace</button>
        </div>
        <button class="ins-trace-toggle ${state.trace.enabled?'active':''}" id="insTraceToggle" data-testid="ins-trace-toggle" title="Follow money sequentially through the available records" aria-pressed="${state.trace.enabled}">
          <span class="pulse-dot"></span>${state.trace.enabled ? 'Trace mode: on' : 'Trace mode'}
        </button>
        ${state.trace.enabled ? `
          <button class="ins-reset" id="insTraceReset" data-testid="ins-trace-reset">Reset trace</button>
          <button class="ins-reset" id="insTraceExit" data-testid="ins-trace-exit" style="background:rgba(239,68,68,0.1);border-color:rgba(239,68,68,0.3);color:#fca5a5;">Exit trace</button>
        ` : ''}
      ` : ''}
      <button class="ins-reset" id="insResetBtn" data-testid="ins-reset">Reset</button>
      ${state.map === 'institution' && (ds.federationSpotlight||[]).length ? `
        <div class="ins-hub-spotlight" data-testid="ins-hub-spotlight">
          <span class="ins-hub-spotlight-label">Major federation / intermediary hubs</span>
          ${(ds.federationSpotlight||[]).slice(0,6).map(h => `
            <button class="ins-hub-chip ${state.filter.focusRecipient===h.name?'active':''}" data-hub-name="${escH(h.name)}" title="${escH(h.name)} receives ${fmt$(h.inbound||0)} and routes ${fmt$(h.outbound||0)} in available records">
              ${escH(h.display || orgDisplayLabel(h.name))} · ${fmt$(Math.max(h.inbound||0,h.outbound||0))}
            </button>`).join('')}
        </div>` : ''}
      ${showFederationFlowBoard ? `
        <div class="ins-flow-hubs-board" data-testid="ins-federation-flow-hubs">
          <div class="ins-flow-hubs-head">
            <div>
              <div class="ins-flow-hubs-title">Top Federation Flow Hubs</div>
              <div class="ins-flow-hubs-sub">Foundation → Federation → downstream recipient chains detected by alias matching and Form 990 rows</div>
            </div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end;">
              ${fedCoverageBadge}
              <div class="ins-flow-hubs-badge">${fmtN((ds.moneyFlowIndex && ds.moneyFlowIndex.flowRows || []).length)} traced inbound links</div>
            </div>
          </div>
          <div class="ins-flow-hub-grid">${federationFlowRows}</div>
        </div>` : ''}
    `;
    // wire events
    root.querySelectorAll('.ins-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const m = btn.getAttribute('data-map');
        if(m === state.map) return;
        state.map = m;
        state.selectedNodeId = null;
        // Leaving institution → turn trace off automatically
        if(m !== 'institution' && state.trace.enabled){
          stopTraceAnimation();
          state.trace.enabled = false;
          state.trace.sourceId = null; state.trace.sourceName = null;
          state.trace.focusedL2 = null; state.trace.step = 0;
          state.trace.paths = []; state.trace.stoppedAt = null;
          document.body.classList.remove('trace-mode');
        }
        renderToolbar(ds);
        renderMap(ds);
        renderDetail(null);
      });
    });
    const ySel = document.getElementById('insYear');
    if(ySel) ySel.value = state.filter.year;
    const cSel = document.getElementById('insCause');
    if(cSel) cSel.value = state.filter.cause;

    document.getElementById('insSearch').addEventListener('input', (e)=>{
      state.filter.search = e.target.value || '';
      renderMap(ds);
    });
    const runTraceSearch = () => {
      const input = document.getElementById('insTraceSearch');
      const q = input ? String(input.value || '').trim() : '';
      if(!q) return;
      const sources = (ds.institutionMapAll || ds.institutionMap || []);
      const qLC = q.toLowerCase();
      const qNorm = flowNameNorm(q);
      let fObj = sources.find(f => String(f.name||'').toLowerCase() === qLC)
        || sources.find(f => flowNameNorm(f.name) === qNorm)
        || sources.find(f => String(f.name||'').toLowerCase().includes(qLC))
        || sources.find(f => flowTokenScore(flowNameTokens(q), flowNameTokens(f.name)) >= 0.72);
      if(!fObj) return;
      state.map = 'institution';
      state.filter.search = '';
      state.filter.focusFoundation = fObj.name;
      state.filter.focusRecipient = null;
      state.selectedNodeId = `fd:${fObj.name}`;
      state.trace.enabled = true;
      state.trace.sourceId = `fd:${fObj.name}`;
      state.trace.sourceName = fObj.name;
      state.trace.focusedL2 = null;
      state.trace.step = 1;
      state.trace.paths = computeTracePaths(ds, fObj);
      state.trace.stoppedAt = null;
      document.body.classList.add('trace-mode');
      renderToolbar(ds);
      renderMap(ds);
      requestAnimationFrame(() => {
        runTraceAnimation();
        renderTraceDetail(ds);
      });
    };
    const traceSearchBtn = document.getElementById('insTraceSearchBtn');
    if(traceSearchBtn) traceSearchBtn.addEventListener('click', runTraceSearch);
    const traceSearchInput = document.getElementById('insTraceSearch');
    if(traceSearchInput) traceSearchInput.addEventListener('keydown', (e) => {
      if(e.key === 'Enter') runTraceSearch();
    });
    root.querySelectorAll('[data-flow-focus]').forEach(btn => {
      btn.addEventListener('click', () => {
        const name = btn.getAttribute('data-flow-focus');
        if(!name) return;
        state.map = 'institution';
        state.filter.search = '';
        state.filter.focusFoundation = null;
        state.filter.focusRecipient = name;
        state.selectedNodeId = null;
        stopTraceAnimation();
        state.trace.sourceId = null; state.trace.sourceName = null;
        state.trace.focusedL2 = null; state.trace.step = 0;
        renderToolbar(ds);
        renderMap(ds);
        const focusIds = bestVisibleInstitutionNodeIds(name);
        state.selectedNodeId = focusIds[0] || bestVisibleInstitutionNodeId(name);
        applySelectedFlowHighlight(document.getElementById('insSvg'), state._lastGraph, focusIds.length ? focusIds : state.selectedNodeId);
        const hub = (ds.moneyFlowIndex && ds.moneyFlowIndex.hubsByName && ds.moneyFlowIndex.hubsByName[name]) || null;
        renderDetail({ data:{ kind:'recipient_intermediary', name,
          total:(hub&&hub.inbound)||0,
          funders:(hub&&hub.topFunders||[]).map(f => ({funder:f.name, amount:f.amount})),
          intermediary:classifyIntermediary(name), isAlsoGrantmaker:ds.isAlsoGrantmaker(name) } }, ds);
      });
    });
    root.querySelectorAll('[data-flow-window]').forEach(btn => {
      btn.addEventListener('click', () => {
        const name = btn.getAttribute('data-flow-window');
        if(name) openFlowNodeWindow(name, ds);
      });
    });
    root.querySelectorAll('.ins-hub-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const name = btn.getAttribute('data-hub-name');
        if(!name) return;
        state.map = 'institution';
        state.filter.search = '';
        state.filter.focusFoundation = null;
        state.filter.focusRecipient = name;
        state.selectedNodeId = null;
        stopTraceAnimation();
        state.trace.sourceId = null; state.trace.sourceName = null;
        state.trace.focusedL2 = null; state.trace.step = 0;
        renderToolbar(ds);
        renderMap(ds);
        const focusIds = bestVisibleInstitutionNodeIds(name);
        state.selectedNodeId = focusIds[0] || bestVisibleInstitutionNodeId(name);
        applySelectedFlowHighlight(document.getElementById('insSvg'), state._lastGraph, focusIds.length ? focusIds : state.selectedNodeId);
        const inter = (ds.intermediariesList||[]).find(x => String(x.name||'').toLowerCase() === name.toLowerCase());
        const hub = (ds.federationSpotlight||[]).find(x => String(x.name||'').toLowerCase() === name.toLowerCase());
        const funders = inter && inter.funders
          ? Object.entries(inter.funders).sort((a,b)=>b[1]-a[1]).map(([funder,amount])=>({funder,amount}))
          : [];
        renderDetail({ data:{ kind:'recipient_intermediary', name,
          total:(inter&&inter.total)||(hub&&hub.inbound)||0,
          funders, intermediary:classifyIntermediary(name), isAlsoGrantmaker:ds.isAlsoGrantmaker(name) } }, ds);
      });
    });
    document.getElementById('insYear').addEventListener('change', (e)=>{
      state.filter.year = e.target.value;
      renderMap(ds);
    });
    document.getElementById('insCause').addEventListener('change', (e)=>{
      state.filter.cause = e.target.value;
      renderMap(ds);
    });
    document.getElementById('insInterOnly').addEventListener('change', (e)=>{
      state.filter.interOnly = !!e.target.checked;
      renderMap(ds);
    });
    document.getElementById('insResetBtn').addEventListener('click', ()=>{
      state.filter = { search:'', year:'all', cause:'all', interOnly:false,
        subjectCategory:null, subjectName:null, focusFoundation:null, focusRecipient:null };
      state.selectedNodeId = null;
      state.drawerSearch = '';
      // Also clear any trace path (but leave Trace Mode toggled the same)
      stopTraceAnimation();
      state.trace.sourceId = null; state.trace.sourceName = null;
      state.trace.focusedL2 = null; state.trace.step = 0;
      state.trace.paths = []; state.trace.stoppedAt = null;
      renderToolbar(ds);
      renderMap(ds);
      if(state.trace.enabled) renderTraceIntroDetail(ds);
      else renderDetail(null);
    });
    const clearF = document.getElementById('insClearFocus');
    if(clearF) clearF.addEventListener('click', () => {
      state.filter.subjectCategory = null;
      state.filter.subjectName = null;
      state.filter.focusFoundation = null;
      state.filter.focusRecipient = null;
      state.selectedNodeId = null;
      renderToolbar(ds);
      renderMap(ds);
      renderDetail(null);
    });
    // Trace mode wiring
    const traceBtn = document.getElementById('insTraceToggle');
    if(traceBtn) traceBtn.addEventListener('click', () => {
      state.trace.enabled = !state.trace.enabled;
      stopTraceAnimation();
      state.trace.sourceId = null; state.trace.sourceName = null;
      state.trace.focusedL2 = null; state.trace.step = 0; state.trace.paths = []; state.trace.stoppedAt = null;
      document.body.classList.toggle('trace-mode', state.trace.enabled);
      // Clear focusFoundation/focusRecipient so the institution graph shows the full default view
      state.filter.focusFoundation = null;
      state.filter.focusRecipient = null;
      state.selectedNodeId = null;
      renderToolbar(ds);
      renderMap(ds);
      if(state.trace.enabled) renderTraceIntroDetail(ds);
      else renderDetail(null);
    });
    const traceReset = document.getElementById('insTraceReset');
    if(traceReset) traceReset.addEventListener('click', () => {
      stopTraceAnimation();
      state.trace.sourceId = null; state.trace.sourceName = null;
      state.trace.focusedL2 = null; state.trace.step = 0; state.trace.paths = []; state.trace.stoppedAt = null;
      // Re-render to clear trace classes from SVG
      renderMap(ds);
      renderTraceIntroDetail(ds);
    });
    const traceExit = document.getElementById('insTraceExit');
    if(traceExit) traceExit.addEventListener('click', () => {
      stopTraceAnimation();
      state.trace.enabled = false;
      state.trace.sourceId = null; state.trace.sourceName = null;
      state.trace.focusedL2 = null; state.trace.step = 0; state.trace.paths = []; state.trace.stoppedAt = null;
      document.body.classList.remove('trace-mode');
      renderToolbar(ds);
      renderMap(ds);
      renderDetail(null);
    });
  }

  // ── RENDER LEGEND + MAP TITLES ────────────────────────────────────────────
  function renderTitle(){
    const titles = {
      subject:    { t:'Money flowing through subjects & sectors',
                    s:'Four levels: orientation → category → subject → recipient. Open the All-subjects drawer (top-left) to browse every one of the 700+ subjects directly.' },
      institution:{ t:'Money flowing through institutions',
                    s:'Four columns trace each dollar: Source grantmaker → Intermediary or direct recipient → Downstream recipient → End-use. Confirmed DAF sponsors are highlighted with a dashed halo. Where the chain isn’t in the records, a neutral “trace ends here” marker appears.' },
      geography:  { t:'Money flowing through geography',
                    s:'United States · Israel · International · Miscellaneous, with state-level depth where data exists.' }
    };
    const o = titles[state.map];
    document.getElementById('insMapTitle').textContent = o.t;
    document.getElementById('insMapSub').textContent = o.s;
  }
  function renderLegend(){
    const legend = document.getElementById('insLegend');
    if(!legend) return;
    const dot = (color, extra='') => `<span class="ins-legend-dot" style="background:${color};${extra}"></span>`;
    const item = (col, label, extra='') => `<span class="ins-legend-item">${dot(col,extra)}${escH(label)}</span>`;
    const subj = [
      item('var(--subject-jewish)', 'Jewish'),
      item('var(--subject-nonjewish)', 'Non-Jewish'),
      item('var(--subject-misc)', 'Miscellaneous'),
      item('var(--subject-light)', 'Category'),
      item('var(--subject)', 'Subject'),
      item('var(--recipient)', 'Recipient'),
      item('var(--inter-fed)', 'Intermediary'),
      item('var(--daf)', 'Confirmed DAF', 'border:1px dashed var(--daf-light);')
    ].join('');
    const inst = [
      item('var(--src)', 'Source'),
      item('var(--daf)', 'Confirmed DAF', 'border:1px dashed var(--daf-light);'),
      item('var(--inter-fed)', 'Federation / community / fiscal'),
      item('var(--recipient)', 'Direct recipient'),
      item('var(--recipient-light)', 'Downstream recipient'),
      item('var(--enduse)', 'End-use'),
      item('var(--text-muted)', 'Trace stops')
    ].join('');
    const geo = [
      item('var(--geo)', 'Geography'),
      item('var(--jewish)', 'Jewish $'),
      item('var(--nonjewish)', 'Non-Jewish $')
    ].join('');
    legend.innerHTML = state.map === 'subject' ? subj : (state.map === 'institution' ? inst : geo);
  }

  // ── BUILD GRAPH MODEL FOR ACTIVE MAP ──────────────────────────────────────
  // Returns {nodes:[{id,label,r,color,kind,data}], links:[{source,target,kind,weight}]}
  // ── SUBJECT GRAPH — 4-level taxonomy (Root → orientation → category → subject → recipient)
  function buildSubjectGraph(ds){
    const nodes = [];
    const links = [];
    const cause = state.filter.cause;
    const search = (state.filter.search || '').toLowerCase();
    const focusCat = state.filter.subjectCategory || null;     // category drill
    const focusSubject = state.filter.subjectName || null;     // subject drill (level-4 expansion)

    const showJ = cause === 'all' || cause === 'jewish';
    const showNJ = cause === 'all' || cause === 'nonjewish';
    const showM = cause === 'all' || cause === 'misc';

    // Level 0 — universal root
    const rootTotal = ds.totals.T_total;
    nodes.push({
      id:'root:subjects', kind:'root', tier:'root', plane:0,
      label:'All tracked subjects',
      color:'var(--subject)', r:36,
      data:{ kind:'root_subjects', total: rootTotal, count: ds.totals.C_total,
             subjectsCount: (ds.allSubjects||[]).length, categoryCount: (ds.subjectCategoriesList||[]).length }
    });

    // Level 1 — orientation roots (Jewish / Non-Jewish / Misc)
    const orientationRoots = [];
    if(showJ){
      orientationRoots.push({ id:'orient:jewish', label:'Jewish', cause:'J',
        color:'var(--subject-jewish)', total: ds.totals.T_jewish, count: ds.totals.C_jewish });
    }
    if(showNJ){
      orientationRoots.push({ id:'orient:nonjewish', label:'Non-Jewish', cause:'NJ',
        color:'var(--subject-nonjewish)', total: ds.totals.T_nonjewish, count: ds.totals.C_nonjewish });
    }
    if(showM && ds.totals.T_misc > 0){
      orientationRoots.push({ id:'orient:misc', label:'Miscellaneous', cause:'M',
        color:'var(--subject-misc)', total: ds.totals.T_misc, count: ds.totals.C_misc });
    }
    orientationRoots.forEach(o => {
      nodes.push({ id:o.id, kind:'leaf', tier:'l1', plane:1,
                   label:o.label, color:o.color, r:24,
                   data:{ kind:'orientation', cause:o.cause, total:o.total, count:o.count, name:o.label } });
      links.push({ source:'root:subjects', target:o.id, weight:o.total, kind:'category', color:o.color, branch:o.cause });
    });

    // Level 2 — categories (per orientation). For each orientation, derive
    // category totals by summing subject.jewish/nonjewish/misc within that category.
    const causes = [
      ...(showJ ? [{ key:'J', oId:'orient:jewish', col:'var(--subject-jewish)', amt:'jewish' }] : []),
      ...(showNJ ? [{ key:'NJ', oId:'orient:nonjewish', col:'var(--subject-nonjewish)', amt:'nonjewish' }] : []),
      ...(showM ? [{ key:'M', oId:'orient:misc', col:'var(--subject-misc)', amt:'misc' }] : [])
    ];

    // For each orientation, top categories by amount. If a focusCat is set, only show that one expanded.
    const CAT_LIMIT_PER_ORIENT = 6;          // top-N categories surfaced as nodes per orientation when no focus
    const SUBJECT_LIMIT_PER_CAT = focusCat ? 24 : 4; // when a category is focused, show many subjects

    causes.forEach(cz => {
      // Compute per-category totals for this orientation
      const catTotals = (ds.subjectCategoriesList||[]).map(c => ({
        name:c.name,
        amount: c[cz.amt] || 0,
        ref: c
      })).filter(c => c.amount > 0).sort((a,b)=>b.amount-a.amount);

      let cats = catTotals;
      if(focusCat){
        const fcLC = focusCat.toLowerCase();
        cats = catTotals.filter(c => c.name.toLowerCase() === fcLC);
        // also keep top 4 of remaining as siblings for context
        const others = catTotals.filter(c => c.name.toLowerCase() !== fcLC).slice(0, 4);
        cats = cats.concat(others);
      } else {
        cats = cats.slice(0, CAT_LIMIT_PER_ORIENT);
      }

      cats.forEach((c) => {
        const isFocused = focusCat && c.name.toLowerCase() === focusCat.toLowerCase();
        if(search && !c.name.toLowerCase().includes(search) && !isFocused) {
          // soft-keep so child subjects can match too — but skip rendering category if no children would survive
        }
        const catId = `cat:${cz.key}:${c.name}`;
        const r = Math.max(11, Math.min(22, 7 + Math.sqrt(c.amount)/2400));
        nodes.push({ id:catId, kind:'leaf', tier:'l2', plane:2,
          label:c.name, color:cz.col, r,
          data:{ kind:'subject_category', name:c.name, cause:cz.key,
                 total:c.amount, count:c.ref.count,
                 subjects:c.ref.subjects } });
        links.push({ source:cz.oId, target:catId, weight:c.amount, kind:'category', color:cz.col, branch:cz.key });

        // Level 3 — subjects within this category, top-N (or all if focused).
        const subjectsInCat = (c.ref.subjects||[])
          .map(s => ({ s, amt: s[cz.amt]||0 }))
          .filter(o => o.amt > 0)
          .sort((a,b)=>b.amt-a.amt);

        const limit = isFocused ? Math.max(18, SUBJECT_LIMIT_PER_CAT) : SUBJECT_LIMIT_PER_CAT;
        let pushed = 0;
        for(let i=0;i<subjectsInCat.length;i++){
          const o = subjectsInCat[i];
          const sub = o.s;
          if(search && !sub.name.toLowerCase().includes(search) && !isFocused) continue;
          if(pushed >= limit) break;
          pushed++;
          const sid = `subj:${cz.key}:${sub.name}`;
          const sr = Math.max(5, Math.min(13, 4 + Math.sqrt(o.amt)/2600));
          const isSubjFocused = focusSubject && sub.name.toLowerCase() === focusSubject.toLowerCase();
          nodes.push({ id:sid, kind:'leaf', tier:'l3', plane:3,
            label: sub.name, color:cz.col, r:sr,
            data:{ kind:'subject', side: cz.key === 'J' ? 'jewish' : (cz.key==='NJ'?'nonjewish':'misc'),
                   cause:cz.key, name:sub.name,
                   amount:o.amt, total:sub.total,
                   jewish:sub.jewish, nonjewish:sub.nonjewish, misc:sub.misc, count:sub.count,
                   funders:sub.funders, recipients:sub.recipients, samples:sub.samples,
                   category:c.name } });
          links.push({ source:catId, target:sid, weight:o.amt, kind:'category', color:cz.col, branch:cz.key });

          // Level 4 — representative recipients for the FOCUSED subject only (avoid runaway nodes)
          if(isSubjFocused){
            const topRecs = Object.entries(sub.recipients||{}).sort((a,b)=>b[1]-a[1]).slice(0, 8);
            topRecs.forEach(([recName, amt]) => {
              const rid = `subj-rec:${cz.key}:${sub.name}:${recName}`;
              const rr = Math.max(4, Math.min(10, 4 + Math.sqrt(amt)/3000));
              const interCls = classifyIntermediary(recName);
              const color = interCls
                ? (interCls.tier==='confirmed' ? 'var(--daf)' : 'var(--inter-fed)')
                : 'var(--recipient)';
              nodes.push({ id:rid, kind:'leaf', tier:'l4', plane:4,
                label:recName, color, r:rr,
                data:{ kind:'subject_recipient', name:recName, amount:amt, subject:sub.name,
                       cause:cz.key, intermediary:interCls } });
              links.push({ source:sid, target:rid, weight:amt,
                color:cz.col, branch:cz.key,
                kind: interCls ? (interCls.tier==='confirmed' ? 'daf' : 'intermediary') : 'downstream' });
            });
          }
        }
      });
    });

    return { nodes, links, layout:'subject-radial' };
  }

  // ── INSTITUTION GRAPH — layered money flow:
  //   L1 Source grantmaker  →  L2 Direct recipient or intermediary marker  →
  //   L3 Downstream recipient (when L2 is also a grantmaker in RG, otherwise final recipient)  →
  //   L4 End-use descriptor  (subject / support strategy / geography / description snippet)
  function buildInstitutionGraph(ds){
    const nodes = [];
    const links = [];
    const search = (state.filter.search || '').toLowerCase();
    const interOnly = state.filter.interOnly;
    const focusFd = state.filter.focusFoundation || null;
    const focusRecipient = state.filter.focusRecipient || null;

    const RG = ds.RG || {};
    const isAlsoGrantmaker = ds.isAlsoGrantmaker || (()=>false);
    const flowIndex = ds.moneyFlowIndex || {};
    const findGrantmaker = flowIndex.findGrantmakerForRecipient || (()=>null);
    const getGrantmakerKey = flowIndex.getGrantmakerKey || ((name)=>name);

    // Level 1 — source foundations.
    let insts = (ds.institutionMapAll || ds.institutionMap || []).slice();
    const instByLC = new Map(insts.map(f => [String(f.name||'').toLowerCase(), f]));
    if(focusRecipient && !focusFd){
      const recLC = focusRecipient.toLowerCase();
      const focusMatch = findGrantmaker(focusRecipient);
      const focusHub = focusMatch && flowIndex.hubsByName ? flowIndex.hubsByName[focusMatch.name] : null;
      const hub = (ds.intermediariesList || []).find(x => String(x.name||'').toLowerCase() === recLC);
      const sourceNames = focusHub && focusHub.topFunders && focusHub.topFunders.length
        ? focusHub.topFunders.slice(0, 12).map(f => f.name)
        : (hub && hub.funders ? Object.entries(hub.funders).sort((a,b)=>b[1]-a[1]).slice(0, 10).map(([name])=>name) : []);
      const sourceObjs = sourceNames.map(n => instByLC.get(String(n).toLowerCase())).filter(Boolean);
      const selfSource = instByLC.get(recLC) || (focusMatch ? instByLC.get(String(focusMatch.name||'').toLowerCase()) : null);
      insts = (selfSource ? [selfSource] : []).concat(sourceObjs.filter(f => !selfSource || f.name.toLowerCase() !== recLC));
      if(!insts.length) insts = (ds.institutionMap || []).slice(0, 12);
    } else if(focusFd){
      const fLC = focusFd.toLowerCase();
      const focused = insts.filter(f => f.name.toLowerCase() === fLC);
      const others = insts.filter(f => f.name.toLowerCase() !== fLC).slice(0, 7);
      insts = focused.concat(others);
    } else {
      insts = insts.slice(0, 12);
    }

    // Track Level-2 recipient aggregates (across all sources)
    const l2Index = {}; // recName -> { rec, totalIn, sourcesIn, isInter, intermediaryCls }
    function ensureL2(recName, rec){
      if(!l2Index[recName]){
        l2Index[recName] = {
          name: recName,
          rec,
          totalIn: 0,
          sourcesIn: [],
          intermediaryCls: classifyIntermediary(recName),
          isAlsoGm: isAlsoGrantmaker(recName),
          grantmakerMatch: findGrantmaker(recName)
        };
      }
      return l2Index[recName];
    }

    insts.forEach(f => {
      if(!focusFd && search && !f.name.toLowerCase().includes(search) &&
         !(f.intermediarySelf && f.intermediarySelf.label.toLowerCase().includes(search))) return;
      const cls = f.intermediarySelf;
      // Source nodes: blue/indigo unless source itself is a confirmed DAF / intermediary
      const color = cls
        ? (cls.tier === 'confirmed' ? 'var(--daf)' : 'var(--inter-fed)')
        : 'var(--src)';
      const r = Math.max(11, Math.min(26, 9 + Math.sqrt(f.total)/2200));
      const id = `fd:${f.name}`;
      nodes.push({ id, kind:'leaf', tier:'l1', plane:1,
                   label:f.name, color, r,
                   className: cls && cls.tier==='confirmed' ? 'daf-confirmed' : '',
                   data:{ kind:'foundation', name:f.name, total:f.total, jewish:f.jewish,
                          nonjewish:f.nonjewish, count:f.count, state:f.state,
                          intermediary: cls,
                          topRecipients: f.topRecipients,
                          intermediaryRecs: f.intermediaryRecs }});
      // Pull top recipients for this source (L2)
      const recList = (f.topRecipients||[]).slice();
      // When focusing a federation/intermediary hub, surface that recipient even
      // if it sits below the usual top-recipient density cut for a source.
      if(focusRecipient){
        const recRowsFull = (ds.R && ds.R[f.name]) || [];
        const focusNorm = flowNameNorm(focusRecipient);
        const hit = recRowsFull.find(r => {
          const recName = String(r[0]||'');
          if(recName.toLowerCase() === focusRecipient.toLowerCase()) return true;
          if(flowNameNorm(recName) === focusNorm) return true;
          const m = findGrantmaker(recName);
          return !!(m && flowNameNorm(m.name) === focusNorm);
        });
        if(hit && !recList.find(x => x.name === hit[0])){
          recList.unshift({
            name: hit[0], city: hit[1], state: hit[2],
            total:+hit[3]||0, jewish:+hit[4]||0, nonjewish:+hit[5]||0, misc:+hit[6]||0,
            count:+hit[7]||0, yearMin:hit[8], yearMax:hit[9],
            topSubject:hit[10], cause:hit[11]
          });
        }
      }
      // ensure intermediary recipients are surfaced even if outside top 8
      (f.intermediaryRecs||[]).forEach(ir => {
        if(!recList.find(x => x.name === ir.name)) recList.push(ir);
      });
      let surfaced = 0;
      const limit = focusFd && f.name.toLowerCase() === focusFd.toLowerCase() ? 12 : 6;
      for(let i=0;i<recList.length && surfaced<limit;i++){
        const rec = recList[i];
        if(!rec || !rec.name) continue;
        if(interOnly && !classifyIntermediary(rec.name)) continue;
        const l2 = ensureL2(rec.name, rec);
        l2.totalIn += rec.total || 0;
        l2.sourcesIn.push({ funder:f.name, amount:rec.total||0 });
        links.push({ source:id, target:`l2:${rec.name}`, weight: rec.total||0,
                     kind: l2.intermediaryCls
                          ? (l2.intermediaryCls.tier === 'confirmed' ? 'daf' : 'intermediary')
                          : 'source' });
        surfaced++;
      }
      // (no phantom band link — the column layout draws plane bands directly)
    });

    // Emit L2 nodes — cap to keep readable. Always include all confirmed-DAF/intermediary,
    // then top direct recipients by inflow.
    const allL2 = Object.values(l2Index);
    // Keep all flagged intermediaries and top direct recipients by totalIn
    const flagged = allL2.filter(o => o.intermediaryCls);
    const direct  = allL2.filter(o => !o.intermediaryCls).sort((a,b)=>b.totalIn-a.totalIn);
    const L2_DIRECT_CAP = focusFd ? 16 : 10;
    const keepSet = new Set([
      ...flagged.map(o => o.name),
      ...direct.slice(0, L2_DIRECT_CAP).map(o => o.name)
    ]);
    // If a focused recipient exists, ensure it's kept
    if(focusRecipient){
      keepSet.add(focusRecipient);
      const focusNorm = flowNameNorm(focusRecipient);
      Object.keys(l2Index).forEach(k => { if(flowNameNorm(k) === focusNorm) keepSet.add(k); });
    }

    Object.keys(l2Index).forEach(recName => {
      const o = l2Index[recName];
      if(!keepSet.has(recName)) return;
      if(search && !recName.toLowerCase().includes(search) &&
         (o.intermediaryCls ? !o.intermediaryCls.label.toLowerCase().includes(search) : true)) return;
      let color, kind;
      if(o.intermediaryCls){
        if(o.intermediaryCls.tier === 'confirmed'){ color = 'var(--daf)'; }
        else { color = 'var(--inter-fed)'; }
        kind = 'recipient_intermediary';
      } else {
        color = 'var(--recipient)';
        kind = 'recipient_direct';
      }
      const r = Math.max(7, Math.min(18, 5 + Math.sqrt(o.totalIn)/2000));
      const id = `l2:${recName}`;
      nodes.push({ id, kind:'leaf', tier:'l2', plane:2,
        label:recName, color, r,
        className: o.intermediaryCls && o.intermediaryCls.tier==='confirmed' ? 'daf-confirmed' : '',
        data:{ kind, name:recName, total:o.totalIn,
               funders: o.sourcesIn.sort((a,b)=>b.amount-a.amount),
               intermediary: o.intermediaryCls,
               isAlsoGrantmaker: o.isAlsoGm,
               grantmakerMatch: o.grantmakerMatch,
               rec: o.rec } });
    });
    // Drop links pointing to L2 nodes we didn't emit
    const emittedL2 = new Set(nodes.filter(n => n.tier === 'l2').map(n => n.id));
    for(let i = links.length-1; i>=0; i--){
      const l = links[i];
      if(typeof l.target === 'string' && l.target.startsWith('l2:') && !emittedL2.has(l.target)){
        links.splice(i, 1);
      }
    }

    // Level 3 — downstream recipients (only when L2 entity also exists as a grantmaker in RG)
    // Only expanded for the focusRecipient (or when only a few L2s) to keep map manageable.
    const expandDownstream = (l2obj) => {
      const gmKey = getGrantmakerKey(l2obj.name);
      const grants = RG[l2obj.name]
        || (gmKey && RG[gmKey])
        || RG[Object.keys(RG).find(k => k.toLowerCase()===l2obj.name.toLowerCase())]
        || RG[Object.keys(RG).find(k => flowNameNorm(k)===flowNameNorm(l2obj.name))]
        || null;
      if(!grants) return null;
      // Aggregate downstream recipients
      const downAgg = {};
      Object.keys(grants).forEach(downName => {
        const rows = grants[downName] || [];
        rows.forEach(row => {
          const amt = +row[1]||0;
          if(!downAgg[downName]) downAgg[downName] = { name:downName, total:0, count:0, samples:[] };
          downAgg[downName].total += amt;
          downAgg[downName].count += 1;
          if(downAgg[downName].samples.length < 3 && amt > 0){
            downAgg[downName].samples.push({ year: row[0], amount: amt, cause: row[2], subject: row[3] });
          }
        });
      });
      return Object.values(downAgg).sort((a,b)=>b.total-a.total);
    };

    // Always expand downstream for the focused recipient if any
    const downstreamSurfaceFor = new Set();
    const focusedL2Key = focusRecipient
      ? (Object.keys(l2Index).find(k => k.toLowerCase() === focusRecipient.toLowerCase() || flowNameNorm(k) === flowNameNorm(focusRecipient)) || null)
      : null;
    if(focusRecipient && focusedL2Key) downstreamSurfaceFor.add(focusedL2Key);
    // Also expand the top 3 L2 nodes that are also grantmakers (general feel)
    const topAlsoGm = Object.values(l2Index)
      .filter(o => o.isAlsoGm)
      .sort((a,b)=>b.totalIn-a.totalIn)
      .slice(0, 3);
    topAlsoGm.forEach(o => downstreamSurfaceFor.add(o.name));

    const downstreamCache = {};
    downstreamSurfaceFor.forEach(recName => {
      const o = l2Index[recName];
      if(!o) return;
      const downs = expandDownstream(o);
      downstreamCache[recName] = downs;
      if(!downs || downs.length === 0){
        // emit a 'trace stop' marker
        const stopId = `trace-stop:${recName}`;
        nodes.push({ id:stopId, kind:'leaf', tier:'l3', plane:3,
          label:'Trace ends in available records',
          color:'var(--text-muted)', r:7,
          data:{ kind:'trace_stop', source:recName,
                 reason:'No public re-grant rows for this recipient in current dataset.' } });
        links.push({ source:`l2:${recName}`, target:stopId, weight: 0, kind:'downstream' });
        return;
      }
      const limit = focusRecipient && flowNameNorm(focusRecipient)===flowNameNorm(recName) ? 8 : 4;
      downs.slice(0, limit).forEach(d => {
        const id = `l3:${recName}->${d.name}`;
        const r = Math.max(5, Math.min(12, 4 + Math.sqrt(d.total)/2200));
        const interCls = classifyIntermediary(d.name);
        const color = interCls
          ? (interCls.tier==='confirmed' ? 'var(--daf)' : 'var(--inter-fed)')
          : 'var(--recipient-light)';
        nodes.push({ id, kind:'leaf', tier:'l3', plane:3,
          label: d.name, color, r,
          data:{ kind:'downstream', name:d.name, total:d.total, count:d.count,
                 viaIntermediary: o.name, intermediary: interCls,
                 samples: d.samples } });
        links.push({ source:`l2:${recName}`, target:id, weight:d.total, kind:'downstream' });
      });
    });

    // Level 4 — end-use descriptors for focused entities.
    // Sources: subject + count from grant rows of the FOCUSED L2 or focused L1.
    function emitEndUseFor(targetId, grantRows, label){
      // Aggregate top subjects from grant rows
      const subAgg = {};
      const causeAgg = {};
      grantRows.forEach(g => {
        const s = (g.subject||g[3]||'').trim();
        if(s) subAgg[s] = (subAgg[s]||0) + (+g.amount||+g[1]||0);
        const c = g.cause || g[2];
        if(c) causeAgg[c] = (causeAgg[c]||0) + (+g.amount||+g[1]||0);
      });
      const top = Object.entries(subAgg).sort((a,b)=>b[1]-a[1]).slice(0, 4);
      top.forEach(([s, amt]) => {
        const eid = `enduse:${targetId}:${s}`;
        const r = Math.max(4, Math.min(8, 3 + Math.sqrt(amt)/3500));
        nodes.push({ id:eid, kind:'leaf', tier:'l4', plane:4,
          label:s, color:'var(--enduse)', r,
          data:{ kind:'end_use', name:s, amount:amt, parent:label } });
        links.push({ source:targetId, target:eid, weight:amt, kind:'enduse' });
      });
      return Object.keys(subAgg).length;
    }

    // For focused L2 recipient, surface end-use directly under the L2 node.
    if(focusRecipient && focusedL2Key && l2Index[focusedL2Key]){
      const recName = focusedL2Key;
      const gmKey = getGrantmakerKey(recName);
      const grants = RG[recName]
        || (gmKey && RG[gmKey])
        || RG[Object.keys(RG).find(k => k.toLowerCase()===recName.toLowerCase())]
        || RG[Object.keys(RG).find(k => flowNameNorm(k)===flowNameNorm(recName))]
        || null;
      if(grants){
        const flatRows = [];
        Object.keys(grants).forEach(d => (grants[d]||[]).forEach(row =>
          flatRows.push({ year:row[0], amount:+row[1]||0, cause:row[2], subject:row[3] })));
        emitEndUseFor(`l2:${recName}`, flatRows, recName);
      } else {
        // Surface end-use via the upstream funder rows that touched this recipient
        const flatRows = [];
        // walk all source foundations RG to find rows landing on this recipient
        Object.keys(RG).forEach(fdName => {
          const recs = RG[fdName]||{};
          const hitKey = Object.keys(recs).find(k => k.toLowerCase() === recName.toLowerCase() || flowNameNorm(k) === flowNameNorm(recName));
          ((hitKey && recs[hitKey]) || []).forEach(row =>
            flatRows.push({ year:row[0], amount:+row[1]||0, cause:row[2], subject:row[3] }));
        });
        if(flatRows.length){
          emitEndUseFor(`l2:${recName}`, flatRows, recName);
        } else {
          // emit trace-stop end-use marker
          const eid = `enduse-stop:${recName}`;
          nodes.push({ id:eid, kind:'leaf', tier:'l4', plane:4,
            label:'End-use not in records',
            color:'var(--text-muted)', r:5,
            data:{ kind:'trace_stop', source:recName,
                   reason:'No grant rows downstream of this recipient in current dataset.' } });
          links.push({ source:`l2:${recName}`, target:eid, weight:0, kind:'enduse' });
        }
      }
    }

    // For focused L1 source, surface end-use under the source node
    if(focusFd){
      const fName = focusFd;
      const fLC = fName.toLowerCase();
      const fObj = (ds.institutionMapAll||ds.institutionMap||[]).find(x => x.name.toLowerCase() === fLC);
      if(fObj){
        const flatRows = [];
        const grants = RG[fObj.name] || null;
        if(grants){
          Object.keys(grants).forEach(d => (grants[d]||[]).forEach(row =>
            flatRows.push({ year:row[0], amount:+row[1]||0, cause:row[2], subject:row[3] })));
        }
        if(flatRows.length) emitEndUseFor(`fd:${fObj.name}`, flatRows, fObj.name);
      }
    }

    return { nodes, links, layout:'institution-columns' };
  }

  function buildGeographyGraph(ds){
    const nodes = [];
    const links = [];
    const search = (state.filter.search || '').toLowerCase();
    const cause = state.filter.cause;

    nodes.push({ id:'root:geo', kind:'root', label:'All grants', color:'var(--geo)', r:38,
                 data:{ kind:'root_geo', total: ds.totals.T_total, count: ds.totals.C_total }});

    (ds.geoData || []).forEach(g => {
      if(search && !g.name.toLowerCase().includes(search)) return;
      let amount = g.total;
      if(cause === 'jewish') amount = g.jewish;
      else if(cause === 'nonjewish') amount = g.nonjewish;
      else if(cause === 'misc') amount = g.misc;
      if(!amount) return;
      const r = Math.max(14, Math.min(34, 10 + Math.sqrt(amount)/1500));
      const id = `geo:${g.name}`;
      nodes.push({ id, kind:'leaf', label:g.name, color:'var(--geo-light)', r,
                   data:{ kind:'geo', name:g.name, jewish:g.jewish, nonjewish:g.nonjewish, misc:g.misc, total:g.total }});
      links.push({ source:'root:geo', target:id, weight:amount });
    });

    // Top US states ring (only when 'United States' bucket present, as outer ring around US)
    const hasUS = (ds.geoData || []).find(g => g.name === 'United States');
    if(hasUS){
      const usId = 'geo:United States';
      (ds.topStates || []).slice(0, 12).forEach(s => {
        if(search && !s.name.toLowerCase().includes(search)) return;
        let amount = s.total;
        if(cause === 'jewish') amount = s.jewish;
        else if(cause === 'nonjewish') amount = s.nonjewish;
        else if(cause === 'misc') amount = s.misc;
        if(!amount) return;
        const r = Math.max(7, Math.min(18, 6 + Math.sqrt(amount)/1800));
        const id = `state:${s.name}`;
        nodes.push({ id, kind:'leaf', label:`${s.name} (${fmt$(s.total)})`, color:'var(--geo)', r,
                     data:{ kind:'state', name:s.name, jewish:s.jewish, nonjewish:s.nonjewish, misc:s.misc, count:s.count, total:s.total }});
        links.push({ source: usId, target:id, weight: amount });
      });
    }

    return { nodes, links };
  }

  // ── LAY OUT NODES ─────────────────────────────────────────────────────────
  // Dispatches on graph.layout: 'subject-radial' | 'institution-columns' |
  // (default radial tree for geography & legacy graphs).
  function layoutGraph(graph, w, h){
    if(graph.layout === 'institution-columns'){
      return layoutInstitutionColumns(graph, w, h);
    }
    if(graph.layout === 'subject-radial'){
      return layoutSubjectRadial(graph, w, h);
    }
    return layoutDefaultRadial(graph, w, h);
  }

  // 4-level radial taxonomy: root center → orientation inner ring →
  // categories second ring (arc-biased to parent orientation) → subjects third ring
  // (within sibling group) → recipients outer ring.
  function layoutSubjectRadial(graph, w, h){
    const cx = w/2, cy = h*0.5;
    const root = graph.nodes.find(n => n.kind === 'root');
    if(!root){ return layoutDefaultRadial(graph, w, h); }
    const childrenOf = (id) => graph.links.filter(l => l.source === id).map(l => l.target);
    root.x = cx; root.y = cy;

    const minD = Math.min(w,h);
    const ring1 = minD * 0.13;          // orientations
    const ring2 = minD * 0.26;          // categories
    const ring3 = minD * 0.40;          // subjects
    const ring4 = minD * 0.475;         // recipients (level 4)

    const orientations = childrenOf(root.id).map(id => graph.nodes.find(n => n.id === id)).filter(Boolean);
    const oCount = orientations.length;
    // Distribute orientations evenly around a full circle so each gets a fair sector.
    orientations.forEach((o, oi) => {
      // Start at top, distribute clockwise
      const a = -Math.PI/2 + (oi / oCount) * Math.PI * 2;
      o._anchor = a;
      o._sectorWidth = (Math.PI * 2) / oCount * 0.9;  // each orientation owns ~360/N degrees with small gap
      o.x = cx + Math.cos(a) * ring1;
      o.y = cy + Math.sin(a) * ring1;
    });

    // Categories per orientation — distributed within parent's sector
    orientations.forEach(o => {
      const cats = childrenOf(o.id).map(id => graph.nodes.find(n => n.id === id)).filter(Boolean);
      const span = o._sectorWidth;
      const start = o._anchor - span/2;
      cats.forEach((c, ci) => {
        const t = cats.length === 1 ? 0.5 : (ci/(cats.length-1));
        const a = start + t * span;
        c._anchor = a;
        c._sectorWidth = span / Math.max(cats.length, 1) * 1.05;
        c.x = cx + Math.cos(a) * ring2;
        c.y = cy + Math.sin(a) * ring2;

        // Subjects within this category
        const subjs = childrenOf(c.id).map(id => graph.nodes.find(n => n.id === id)).filter(Boolean);
        const subSpan = c._sectorWidth;
        const subStart = a - subSpan/2;
        subjs.forEach((s, si) => {
          const tt = subjs.length === 1 ? 0.5 : (si/(subjs.length-1));
          const aa = subStart + tt * subSpan;
          s._anchor = aa;
          s.x = cx + Math.cos(aa) * ring3;
          s.y = cy + Math.sin(aa) * ring3;

          // Level-4 recipients for the focused subject
          const recs = childrenOf(s.id).map(id => graph.nodes.find(n => n.id === id)).filter(Boolean);
          if(recs.length){
            const rSpan = subSpan * 0.9;
            const rStart = aa - rSpan/2;
            recs.forEach((r, ri) => {
              const ttt = recs.length === 1 ? 0.5 : (ri/(recs.length-1));
              const aaa = rStart + ttt * rSpan;
              r.x = cx + Math.cos(aaa) * ring4;
              r.y = cy + Math.sin(aaa) * ring4;
            });
          }
        });
      });
    });

    // For any orphan nodes (e.g., root_subjects with no children due to filter), place safely
    graph.nodes.forEach(n => { if(n.x == null || n.y == null){ n.x = cx; n.y = cy; }});
  }

  // 4-column layered layout for institution view: Source | Intermediary/Direct |
  // Downstream | End-use. Y position by amount within each band.
  function layoutInstitutionColumns(graph, w, h){
    const padX = 90, padY = 70;
    const innerW = w - padX*2;
    const innerH = h - padY*2;
    const colCount = 4;
    const colXs = [0, 1, 2, 3].map(i => padX + (i + 0.5) * (innerW / colCount));
    // Map plane number → column index (1..4 → 0..3)
    const planeCol = { 1:0, 2:1, 3:2, 4:3 };

    // Group nodes by plane
    const byPlane = {1:[], 2:[], 3:[], 4:[]};
    graph.nodes.forEach(n => {
      const p = n.plane || 1;
      if(byPlane[p]) byPlane[p].push(n);
    });

    // Sort each plane by total weight (largest first → top)
    Object.keys(byPlane).forEach(p => {
      byPlane[p].sort((a, b) => {
        const av = (a.data && (a.data.total || a.data.amount)) || 0;
        const bv = (b.data && (b.data.total || b.data.amount)) || 0;
        return bv - av;
      });
    });

    // Place nodes in their column, evenly stacked
    [1,2,3,4].forEach(p => {
      const list = byPlane[p];
      const x = colXs[planeCol[p]];
      const count = list.length;
      if(count === 0) return;
      const slotH = innerH / Math.max(count, 1);
      list.forEach((n, i) => {
        n.x = x;
        n.y = padY + slotH * (i + 0.5);
      });
    });

    // Stash band metadata for renderer (so plane bands & labels can be drawn)
    graph._bands = [
      { plane:1, x: padX,                                        w: innerW/colCount, label:'Source · grantmaker',     subLabel:'Confirmed donor'  },
      { plane:2, x: padX + innerW/colCount,                      w: innerW/colCount, label:'Intermediary · direct',    subLabel:'DAF / federation / direct recipient' },
      { plane:3, x: padX + (innerW/colCount)*2,                  w: innerW/colCount, label:'Downstream',                subLabel:'Re-grant or final recipient' },
      { plane:4, x: padX + (innerW/colCount)*3,                  w: innerW/colCount, label:'End-use',                   subLabel:'Subject of grant rows' }
    ];
    graph._bandsBox = { padX, padY, innerH, innerW };
  }

  // Default radial tree (used by geography view).
  function layoutDefaultRadial(graph, w, h){
    const cx = w/2, cy = h/2;
    const roots = graph.nodes.filter(n => n.kind === 'root');
    const childrenOf = (id) => graph.links.filter(l => l.source === id).map(l => l.target);
    if(roots.length === 1){
      const root = roots[0];
      root.x = cx; root.y = cy;
      const level1 = childrenOf(root.id).map(id => graph.nodes.find(n => n.id === id)).filter(Boolean);
      const ring1Radius = Math.min(w,h) * 0.28;
      level1.forEach((n,i)=>{
        const angle = (i / level1.length) * Math.PI * 2 - Math.PI/2;
        n.x = cx + Math.cos(angle) * ring1Radius;
        n.y = cy + Math.sin(angle) * ring1Radius;
        const grand = childrenOf(n.id).map(id => graph.nodes.find(nn => nn.id === id)).filter(Boolean);
        if(grand.length){
          const sub = Math.PI / Math.max(2, level1.length);
          const start = angle - sub/2;
          const ring2Radius = ring1Radius + Math.min(w,h)*0.18;
          grand.forEach((g, gi) => {
            const a = grand.length === 1 ? angle : (start + (gi/(grand.length-1))*sub);
            g.x = cx + Math.cos(a) * ring2Radius;
            g.y = cy + Math.sin(a) * ring2Radius;
          });
        }
      });
    }else if(roots.length > 1){
      const rootGap = Math.min(w,h) * 0.32;
      roots.forEach((r, idx) => {
        const sign = idx === 0 ? -1 : 1;
        r.x = cx + sign * rootGap; r.y = cy;
      });
      roots.forEach((r, idx) => {
        const children = childrenOf(r.id).map(id => graph.nodes.find(n => n.id === id)).filter(Boolean);
        if(!children.length) return;
        const arcSweep = Math.PI * 1.0;
        const baseAngle = idx === 0 ? Math.PI : 0;
        const radius = Math.min(w,h) * 0.34;
        children.forEach((c, ci) => {
          const t = children.length === 1 ? 0 : (ci/(children.length-1)) - 0.5;
          const a = baseAngle + t * arcSweep;
          c.x = r.x + Math.cos(a) * radius;
          c.y = r.y + Math.sin(a) * radius;
        });
      });
    }
  }

  // ── RENDER MAP (vanilla SVG) ──────────────────────────────────────────────
  function computeConnectedFlow(graph, nodeId){
    const nodes = new Set();
    const links = new Set();
    if(!graph || !nodeId) return {nodes, links};
    nodes.add(nodeId);
    const outgoing = {}, incoming = {};
    (graph.links||[]).forEach(l => {
      if(!outgoing[l.source]) outgoing[l.source] = [];
      if(!incoming[l.target]) incoming[l.target] = [];
      outgoing[l.source].push(l);
      incoming[l.target].push(l);
    });
    const walk = (start, dict, dir) => {
      const q = [start];
      const seen = new Set([start]);
      while(q.length){
        const cur = q.shift();
        (dict[cur]||[]).forEach(l => {
          links.add(l.source+'|'+l.target);
          const nxt = dir === 'out' ? l.target : l.source;
          nodes.add(nxt);
          if(!seen.has(nxt)){
            seen.add(nxt);
            q.push(nxt);
          }
        });
      }
    };
    walk(nodeId, incoming, 'in');
    walk(nodeId, outgoing, 'out');
    return {nodes, links};
  }
  function clearSelectedFlowHighlight(svg){
    if(!svg) return;
    svg.querySelectorAll('.map-node').forEach(el=>el.classList.remove('selected-context','selected-dim'));
    svg.querySelectorAll('.map-link').forEach(el=>el.classList.remove('selected-flow','selected-dim','highlight'));
  }
  function applySelectedFlowHighlight(svg, graph, nodeId){
    clearSelectedFlowHighlight(svg);
    if(!svg || !graph || !nodeId) return;
    const nodeIds = Array.isArray(nodeId) ? nodeId.filter(Boolean) : [nodeId];
    const flow = { nodes:new Set(), links:new Set() };
    nodeIds.forEach(id => {
      const part = computeConnectedFlow(graph, id);
      part.nodes.forEach(n => flow.nodes.add(n));
      part.links.forEach(l => flow.links.add(l));
    });
    if(!flow.nodes.size) return;
    svg.querySelectorAll('.map-node').forEach(g => {
      const id = g.getAttribute('data-id');
      if(flow.nodes.has(id)) g.classList.add('selected-context');
      else g.classList.add('selected-dim');
    });
    svg.querySelectorAll('.map-link').forEach(p => {
      const key = p.getAttribute('data-source') + '|' + p.getAttribute('data-target');
      if(flow.links.has(key)) p.classList.add('selected-flow');
      else p.classList.add('selected-dim');
    });
  }
  function bestVisibleInstitutionNodeIds(name){
    const graph = state._lastGraph;
    if(!graph || !name) return [];
    const wanted = flowNameNorm(name);
    const lower = String(name).toLowerCase();
    const ids = [];
    const add = (id) => {
      if(id && graph.nodes.some(n => n.id === id) && !ids.includes(id)) ids.push(id);
    };
    add(`l2:${name}`);
    add(`fd:${name}`);
    graph.nodes.forEach(n => {
      const dataName = n.data && n.data.name ? String(n.data.name) : '';
      const label = n.label ? String(n.label) : '';
      if((dataName && flowNameNorm(dataName) === wanted) ||
         (label && flowNameNorm(label) === wanted) ||
         (dataName && dataName.toLowerCase() === lower) ||
         (label && label.toLowerCase() === lower)){
        add(n.id);
      }
      const gmName = n.data && n.data.grantmakerMatch && n.data.grantmakerMatch.name;
      if(gmName && flowNameNorm(gmName) === wanted) add(n.id);
    });
    return ids;
  }
  function bestVisibleInstitutionNodeId(name){
    const ids = bestVisibleInstitutionNodeIds(name);
    return ids.length ? ids[0] : null;
  }
  function renderMap(ds){
    const svg = document.getElementById('insSvg');
    const wrap = document.getElementById('insCanvas');
    if(!svg || !wrap) return;
    renderTitle();
    renderLegend();
    if(!ds.ok){
      svg.innerHTML = '';
      document.getElementById('insEmpty').hidden = false;
      return;
    }
    let graph;
    if(state.map === 'subject') graph = buildSubjectGraph(ds);
    else if(state.map === 'institution') graph = buildInstitutionGraph(ds);
    else graph = buildGeographyGraph(ds);

    if(!graph.nodes.length || graph.nodes.every(n => n.kind === 'root' && !graph.links.length)){
      svg.innerHTML = '';
      document.getElementById('insEmpty').hidden = false;
      document.getElementById('insEmpty').textContent = 'No data matches the current filters.';
      return;
    }
    document.getElementById('insEmpty').hidden = true;

    // Determine viewbox
    const rect = wrap.getBoundingClientRect();
    const W = Math.max(600, rect.width || 800);
    const H = Math.max(540, rect.height || 600);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    layoutGraph(graph, W, H);
    state._lastGraph = graph;

    // Plane bands & rule lines (institution-columns only)
    let bandsMarkup = '';
    if(graph._bands && graph._bandsBox){
      const { padY, innerH } = graph._bandsBox;
      bandsMarkup = graph._bands.map((b, i) => {
        const fill = i % 2 === 0 ? 'rgba(255,255,255,0.018)' : 'rgba(255,255,255,0.008)';
        return `<rect class="map-plane-band" x="${b.x}" y="${padY-30}" width="${b.w}" height="${innerH+50}" fill="${fill}"/>
          <text class="map-plane-label" x="${b.x + b.w/2}" y="${padY-12}" text-anchor="middle">${escH(b.label)}</text>
          <text class="map-plane-label" style="font-size:8.5px;letter-spacing:0.06em;font-weight:500;text-transform:none;opacity:0.5;" x="${b.x + b.w/2}" y="${padY+innerH+22}" text-anchor="middle">${escH(b.subLabel)}</text>`;
      }).join('');
      // Rule lines between columns
      for(let i=1; i<graph._bands.length; i++){
        const x = graph._bands[i].x;
        bandsMarkup += `<line class="map-plane-rule" x1="${x}" y1="${padY-25}" x2="${x}" y2="${padY+innerH+25}"/>`;
      }
    }

    // Build SVG markup
    const linksMarkup = graph.links.map(l => {
      if(l.invisible) return '';
      const s = graph.nodes.find(n => n.id === l.source);
      const t = graph.nodes.find(n => n.id === l.target);
      if(!s || !t || s.x==null || t.x==null) return '';
      // Bezier curvature varies by layout: subject map uses radial Q midpoints,
      // institution columns get a horizontal S-curve via two control points.
      let path;
      if(graph.layout === 'institution-columns'){
        const dx = t.x - s.x;
        const c1x = s.x + dx*0.55, c1y = s.y;
        const c2x = t.x - dx*0.55, c2y = t.y;
        path = `M ${s.x} ${s.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${t.x} ${t.y}`;
      } else {
        const cx1 = (s.x + t.x)/2;
        const cy1 = (s.y + t.y)/2;
        path = `M ${s.x} ${s.y} Q ${cx1} ${cy1} ${t.x} ${t.y}`;
      }
      const kindCls = l.kind ? ` kind-${escH(l.kind)}` : '';
      const w = l.weight || 0;
      // Stroke width by amount (capped)
      const sw = w > 0 ? Math.max(0.7, Math.min(4.5, 0.7 + Math.log10(w+1)*0.55)) : 1;
      const cls = `map-link${kindCls}${l.kind === 'intermediary' ? ' intermediary' : ''}`;
      const strokeStyle = l.color ? ` style="stroke:${escH(l.color)};color:${escH(l.color)}"` : '';
      const branchAttr = l.branch ? ` data-branch="${escH(l.branch)}"` : '';
      return `<path class="${cls}" d="${path}" stroke-width="${sw.toFixed(2)}" data-source="${escH(s.id)}" data-target="${escH(t.id)}"${branchAttr}${strokeStyle}></path>`;
    }).join('');

    const nodesMarkup = graph.nodes.map(n => {
      if(n.x == null || n.y == null) return '';
      const isRoot = n.kind === 'root';
      const tx = `${n.x}`;
      const ty = `${n.y + n.r + 14}`;
      const fullLabel = n.label || '';
      const displayLabel = orgDisplayLabel(fullLabel);
      const trunc = displayLabel.length > 32 ? displayLabel.slice(0,30)+'…' : displayLabel;
      const sel = state.selectedNodeId === n.id ? ' selected' : '';
      const tier = n.tier ? ` tier-${escH(n.tier)}` : '';
      const extra = n.className ? ` ${escH(n.className)}` : '';
      // Confirmed-DAF gets an additional outer halo ring
      const halo = (n.className && /daf-confirmed/.test(n.className))
        ? `<circle cx="${n.x}" cy="${n.y}" r="${n.r + 5}" fill="none" stroke="${n.color}" stroke-opacity="0.55" stroke-dasharray="3 3" stroke-width="1.2"/>`
        : '';
      return `<g class="map-node${sel}${isRoot?' root':''}${tier}${extra}" data-id="${escH(n.id)}" style="color:${n.color}">
        <title>${escH(fullLabel)}</title>
        ${halo}
        <circle cx="${n.x}" cy="${n.y}" r="${n.r}" fill="${n.color}" fill-opacity="${isRoot?0.95:0.85}" stroke="${n.color}" />
        <text x="${tx}" y="${ty}" text-anchor="middle">${escH(trunc)}</text>
      </g>`;
    }).join('');

    svg.innerHTML = `<g id="insViewport" transform="translate(${state.transform.x} ${state.transform.y}) scale(${state.transform.k})">${bandsMarkup}${linksMarkup}${nodesMarkup}</g>`;

    // Show/hide drawer toggle and depth key based on map
    const drawerBtn = document.getElementById('insDrawerBtn');
    const depthKey  = document.getElementById('insDepthKey');
    const drawer    = document.getElementById('insDrawer');
    if(drawerBtn) drawerBtn.hidden = state.map !== 'subject';
    if(depthKey){
      if(state.map === 'institution'){
        depthKey.hidden = false;
        depthKey.innerHTML = `
          <span><span class="dot d-src"></span>Source</span>
          <span><span class="dot d-daf"></span>Confirmed DAF</span>
          <span><span class="dot d-int"></span>Intermediary</span>
          <span><span class="dot d-rec"></span>Recipient</span>
          <span><span class="dot d-end"></span>End-use</span>`;
      } else if(state.map === 'subject'){
        depthKey.hidden = false;
        depthKey.innerHTML = `
          <span><span class="dot d-subj"></span>Subject</span>
          <span><span class="dot" style="background:var(--subject-jewish)"></span>Jewish</span>
          <span><span class="dot" style="background:var(--subject-nonjewish)"></span>Non-Jewish</span>
          <span><span class="dot d-rec"></span>Recipient</span>`;
      } else {
        depthKey.hidden = true;
      }
    }
    if(drawer){
      if(state.map === 'subject') renderDrawer(ds);
      else { drawer.classList.remove('open'); drawer.innerHTML = ''; }
    }
    // Trace-mode stepper visibility & if a trace was already in progress, replay it.
    renderTraceStepper();
    if(state.map === 'institution' && state.trace.enabled && state.trace.sourceId){
      // Defer one frame so the SVG is fully in the DOM before we class it.
      requestAnimationFrame(() => { try{ runTraceAnimation(); }catch(e){ console.warn('trace replay failed', e); } });
    } else if(state.selectedNodeId){
      requestAnimationFrame(() => applySelectedFlowHighlight(svg, graph, state.selectedNodeId));
    }

    // wire node click
    svg.querySelectorAll('.map-node').forEach(g => {
      g.addEventListener('click', (e)=>{
        e.stopPropagation();
        const id = g.getAttribute('data-id');
        const nd = graph.nodes.find(n => n.id === id);

        // ── TRACE MODE intercept: clicking a source (L1) starts trace,
        //    clicking an L2 while a source is active focuses that branch.
        if(state.map === 'institution' && state.trace.enabled && nd){
          if(nd.tier === 'l1' && nd.data && nd.data.kind === 'foundation'){
            startTrace(ds, nd);
            return;
          }
          if(nd.tier === 'l2' && state.trace.sourceId && nd.data &&
             (nd.data.kind === 'recipient_intermediary' || nd.data.kind === 'recipient_direct')){
            focusTraceBranch(ds, nd);
            return;
          }
          // Fall through for trace_stop / end_use / l3 nodes — show the detail
          // panel as usual (the trace visuals stay in place).
        }

        state.selectedNodeId = id;
        // re-render to update selected state
        renderDetail(nd, ds, graph);
        // toggle selected class without full rerender
        svg.querySelectorAll('.map-node.selected').forEach(el => el.classList.remove('selected'));
        g.classList.add('selected');
        // highlight readable money-in / money-out paths and dim unrelated spaghetti lines
        applySelectedFlowHighlight(svg, graph, id);
      });
    });
    // wire pan & zoom (basic)
    enablePanZoom(svg);
  }

  // ── SUBJECT TAXONOMY DRAWER ────────────────────────────────────
  // Renders an expandable list of every subject in the active layer, grouped by
  // category. Search filters subjects by name (auto-expanding matching cats).
  // Click on a subject → sets state.filter.subjectName + subjectCategory and
  // triggers a subject-map re-render with that subject's recipients drilled in.
  function renderDrawer(ds){
    const drawer = document.getElementById('insDrawer');
    if(!drawer || !ds || !ds.ok) return;
    const cats = ds.subjectCategoriesList || [];
    const subjectsTotal = (ds.allSubjects || []).length;
    const search = (state.drawerSearch || '').toLowerCase();
    // Track which categories are expanded (default: focused category, or matched search)
    if(!state._drawerExpanded) state._drawerExpanded = {};
    const expanded = state._drawerExpanded;
    if(state.filter.subjectCategory) expanded[state.filter.subjectCategory.toLowerCase()] = true;

    const catHtml = cats.map(c => {
      const cLC = c.name.toLowerCase();
      // Filter subjects by search
      let subs = c.subjects || [];
      if(search){
        subs = subs.filter(s => s.name.toLowerCase().includes(search));
        if(subs.length === 0) return '';
        expanded[cLC] = true; // auto-expand on match
      }
      // Limit displayed subjects per category to keep DOM manageable
      const MAX = 80;
      const overflow = subs.length > MAX ? subs.length - MAX : 0;
      const visible = subs.slice(0, MAX);
      const isExpanded = expanded[cLC] === true;
      const cls = isExpanded ? 'ins-drawer-cat expanded' : 'ins-drawer-cat';
      const rows = visible.map(s => {
        const tag = s.lean === 'J' ? '<span class="ins-drawer-subj-tag j">J</span>'
                  : s.lean === 'NJ' ? '<span class="ins-drawer-subj-tag nj">NJ</span>' : '';
        const isFocused = state.filter.subjectName && state.filter.subjectName.toLowerCase() === s.name.toLowerCase();
        return `<div class="ins-drawer-subj${isFocused?' match':''}" data-subj="${escH(s.name)}" data-cat="${escH(c.name)}">
          <span class="ins-drawer-subj-name" title="${escH(s.name)}">${escH(s.name)}</span>
          ${tag}
          <span class="ins-drawer-subj-amt">${fmt$(s.total)}</span>
        </div>`;
      }).join('');
      const more = overflow > 0 ? `<div class="ins-drawer-subj" style="opacity:0.55;cursor:default;"><span class="ins-drawer-subj-name">+ ${overflow} more in this category</span></div>` : '';
      return `<div class="${cls}" data-cat="${escH(c.name)}">
        <div class="ins-drawer-cat-head" data-cat-toggle="${escH(c.name)}">
          <span class="chev">▸</span>
          <span class="ins-drawer-cat-name">${escH(c.name)}</span>
          <span class="ins-drawer-cat-amt">${fmt$(c.total)} · ${fmtN((c.subjects||[]).length)}</span>
        </div>
        <div class="ins-drawer-subjects">${rows}${more}</div>
      </div>`;
    }).filter(Boolean).join('');

    drawer.innerHTML = `
      <div class="ins-drawer-head">
        <div class="ins-drawer-title">Subject taxonomy</div>
        <button class="ins-drawer-close" data-testid="ins-drawer-close" aria-label="Close">×</button>
      </div>
      <input class="ins-drawer-search" id="insDrawerSearch" placeholder="Search ${fmtN(subjectsTotal)} subjects…" value="${escH(state.drawerSearch || '')}" data-testid="ins-drawer-search">
      <div class="ins-drawer-meta">${fmtN(cats.length)} categories · ${fmtN(subjectsTotal)} distinct subjects · click any subject to drill in.</div>
      <div class="ins-drawer-list">${catHtml || '<div class="ins-drawer-meta" style="padding:18px;text-align:center;">No subjects match your search.</div>'}</div>
    `;
    if(state.drawerOpen) drawer.classList.add('open'); else drawer.classList.remove('open');

    // Wire close
    const closeBtn = drawer.querySelector('.ins-drawer-close');
    if(closeBtn) closeBtn.addEventListener('click', () => {
      state.drawerOpen = false;
      drawer.classList.remove('open');
    });
    // Wire search
    const searchEl = document.getElementById('insDrawerSearch');
    if(searchEl){
      searchEl.addEventListener('input', (e) => {
        state.drawerSearch = e.target.value || '';
        renderDrawer(ds);
      });
    }
    // Wire category toggle
    drawer.querySelectorAll('.ins-drawer-cat-head').forEach(el => {
      el.addEventListener('click', () => {
        const c = el.getAttribute('data-cat-toggle');
        if(!c) return;
        const k = c.toLowerCase();
        expanded[k] = !expanded[k];
        renderDrawer(ds);
      });
    });
    // Wire subject click
    drawer.querySelectorAll('.ins-drawer-subj[data-subj]').forEach(el => {
      el.addEventListener('click', () => {
        const sName = el.getAttribute('data-subj');
        const cName = el.getAttribute('data-cat');
        state.filter.subjectName = sName;
        state.filter.subjectCategory = cName;
        state.map = 'subject';
        state.drawerOpen = false;
        // close drawer to expose the map
        drawer.classList.remove('open');
        renderToolbar(ds);
        renderMap(ds);
        // Try to find the actual subject node in the latest graph for rich detail
        const g = state._lastGraph;
        let target = null;
        if(g){
          for(const n of g.nodes){
            if(n.data && n.data.kind === 'subject' && n.data.name && n.data.name.toLowerCase() === sName.toLowerCase()){
              target = n; break;
            }
          }
        }
        if(target){
          renderDetail(target, ds);
        } else {
          renderDetail({ id:`subj:${sName}`, label:sName,
            data:{ kind:'subject', name:sName, category:cName, side:'unknown', amount:0, total:0,
                   note:'Not currently in the rendered map (filtered out by category caps). Use Reset or change orientation to surface it.' } }, ds);
        }
      });
    });
  }

  function cssEscape(s){
    if(window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c);
  }

  function enablePanZoom(svg){
    // Avoid double-binding
    if(svg.__panZoomReady) return;
    svg.__panZoomReady = true;
    let dragging=false, sx=0, sy=0, ox=0, oy=0;
    svg.addEventListener('mousedown', (e)=>{
      if(e.target.closest('.map-node')) return; // node click priority
      dragging = true; svg.classList.add('dragging');
      sx = e.clientX; sy = e.clientY; ox = state.transform.x; oy = state.transform.y;
    });
    window.addEventListener('mousemove', (e)=>{
      if(!dragging) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      state.transform.x = ox + dx; state.transform.y = oy + dy;
      const vp = svg.querySelector('#insViewport');
      if(vp) vp.setAttribute('transform', `translate(${state.transform.x} ${state.transform.y}) scale(${state.transform.k})`);
    });
    window.addEventListener('mouseup', ()=>{ dragging=false; svg.classList.remove('dragging'); });
    svg.addEventListener('wheel', (e)=>{
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1/1.1;
      state.transform.k = Math.max(0.4, Math.min(3, state.transform.k * factor));
      const vp = svg.querySelector('#insViewport');
      if(vp) vp.setAttribute('transform', `translate(${state.transform.x} ${state.transform.y}) scale(${state.transform.k})`);
    }, { passive:false });
  }

  // ── DRILLDOWN DETAIL PANEL ────────────────────────────────────────────────
  function renderDetail(node, ds, graph){
    const root = document.getElementById('insDetail');
    if(!root) return;
    if(!node){
      root.innerHTML = `
        <div class="ins-detail-empty">
          <div class="ins-detail-empty-title">Select a node</div>
          <div class="ins-detail-empty-text">Click any node in the mindmap to see a breakdown of dollars, transactions, top participants, and sample grants. Edges show how money flows between entities.</div>
        </div>`;
      return;
    }
    const d = node.data || {};
    if(d.kind === 'root_subjects'){
      root.innerHTML = renderRootSubjectsPanel(d, ds);
      return;
    }
    if(d.kind === 'orientation'){
      root.innerHTML = renderOrientationPanel(d, ds);
      return;
    }
    if(d.kind === 'subject_category'){
      root.innerHTML = renderSubjectCategoryPanel(d, ds);
      return;
    }
    if(d.kind === 'subject_recipient'){
      root.innerHTML = renderSubjectRecipientPanel(d, ds);
      return;
    }
    if(d.kind === 'recipient_intermediary' || d.kind === 'recipient_direct'){
      root.innerHTML = renderRecipientNodePanel(d, ds);
      return;
    }
    if(d.kind === 'downstream'){
      root.innerHTML = renderDownstreamPanel(d, ds);
      return;
    }
    if(d.kind === 'end_use'){
      root.innerHTML = renderEndUsePanel(d, ds);
      return;
    }
    if(d.kind === 'trace_stop'){
      root.innerHTML = renderTraceStopPanel(d, ds);
      return;
    }
    if(d.kind === 'root_jewish' || d.kind === 'root_nonjewish'){
      const orient = d.kind === 'root_jewish' ? 'Jewish' : 'Non-Jewish';
      root.innerHTML = renderRootSubjectPanel(orient, d, ds);
      return;
    }
    if(d.kind === 'root_geo' || d.kind === 'root_inst'){
      root.innerHTML = renderRootGenericPanel(node.label, d, ds);
      return;
    }
    if(d.kind === 'subject'){
      root.innerHTML = renderSubjectPanel(d, ds);
      return;
    }
    if(d.kind === 'foundation'){
      root.innerHTML = renderFoundationPanel(d, ds);
      return;
    }
    if(d.kind === 'recipient'){
      root.innerHTML = renderRecipientPanel(d, ds);
      return;
    }
    if(d.kind === 'geo' || d.kind === 'state'){
      root.innerHTML = renderGeoPanel(d, ds);
      return;
    }
    root.innerHTML = `<div class="ins-detail-title">${escH(node.label)}</div>`;
  }

  function rowStat(label, val){
    return `<div class="ins-stat"><div class="ins-stat-lbl">${escH(label)}</div><div class="ins-stat-val">${escH(val)}</div></div>`;
  }
  function listSection(title, rows){
    if(!rows || !rows.length) return '';
    return `<div class="ins-detail-section">
      <div class="ins-detail-section-title">${escH(title)}</div>
      <div class="ins-list">${rows.map(r => `<div class="ins-list-row"><span class="nm">${escH(r.label)}</span><span class="vl">${escH(r.value)}</span></div>`).join('')}</div>
    </div>`;
  }

  function renderRootSubjectPanel(orient, d, ds){
    const subj = orient === 'Jewish' ? ds.jSubjects : ds.njSubjects;
    return `
      <div class="ins-detail-eyebrow">Orientation root</div>
      <div class="ins-detail-title">${escH(orient)}</div>
      <div class="ins-detail-explain">Aggregate of all grants classified as ${escH(orient)} orientation across the active dashboard layer. Click a connected subject node to drill in.</div>
      <div class="ins-detail-stats">
        ${rowStat('Total $', fmt$(d.total))}
        ${rowStat('Grants', fmtN(d.count))}
        ${rowStat('Subjects shown', fmtN(subj.length))}
        ${rowStat('Share of total', ds.totals.T_total ? ((d.total/ds.totals.T_total)*100).toFixed(1)+'%' : '—')}
      </div>
      ${listSection('Top subjects', subj.slice(0,8).map(s => ({ label:s.name, value:fmt$(s.amount) })))}
    `;
  }
  function renderRootGenericPanel(label, d, ds){
    return `
      <div class="ins-detail-eyebrow">Root</div>
      <div class="ins-detail-title">${escH(label)}</div>
      <div class="ins-detail-explain">Aggregate of all grants in the active dashboard layer.</div>
      <div class="ins-detail-stats">
        ${rowStat('Total $', fmt$(d.total))}
        ${rowStat('Grants', fmtN(d.count))}
        ${rowStat('Foundations', fmtN(ds.totals.F_total))}
        ${rowStat('Years', (ds.yearMin && ds.yearMax) ? `${ds.yearMin}–${ds.yearMax}` : '—')}
      </div>
    `;
  }
  function renderSubjectPanel(d, ds){
    // Top grantmakers + recipients for this subject — mine R/RG
    const orient = d.side === 'jewish' ? 'Jewish' : 'Non-Jewish';
    const causeKey = d.side === 'jewish' ? 'J' : 'NJ';
    const fundersAgg = {};
    const recipientsAgg = {};
    const samples = [];
    const R = ds.R || {}, RG = ds.RG || {};
    const subjLC = d.name.toLowerCase();
    Object.keys(RG).forEach(fdName => {
      const recs = RG[fdName] || {};
      Object.keys(recs).forEach(recName => {
        const grants = recs[recName] || [];
        grants.forEach(g => {
          // g: [year, amount, cause, subject]
          const subj = g[3] || '';
          const cause = g[2];
          if(subj.toLowerCase() !== subjLC) return;
          if(cause !== causeKey) return;
          const amt = +g[1] || 0;
          fundersAgg[fdName] = (fundersAgg[fdName]||0) + amt;
          recipientsAgg[recName] = (recipientsAgg[recName]||0) + amt;
          if(samples.length < 14) samples.push({ year: g[0], funder: fdName, recipient: recName, amount: amt, subject: subj });
        });
      });
    });
    const topFunders = Object.entries(fundersAgg).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k,v])=>({label:k,value:fmt$(v)}));
    const topRecs = Object.entries(recipientsAgg).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k,v])=>({label:k,value:fmt$(v)}));
    const sampleHtml = samples.sort((a,b)=>b.amount-a.amount).slice(0,8).map(s => `
      <div class="ins-grant-row">
        <span class="yr">${escH(s.year)}</span>
        <span class="desc">${escH(s.funder)} → ${escH(s.recipient)}</span>
        <span class="amt">${fmt$(s.amount)}</span>
      </div>`).join('');

    return `
      <div class="ins-detail-eyebrow">${escH(orient)} subject</div>
      <div class="ins-detail-title">${escH(d.name)}</div>
      <div class="ins-detail-explain">Aggregate dollars granted under <strong>${escH(d.name)}</strong> within the ${escH(orient)} orientation, computed from grants whose primary subject equals this label in the active dashboard layer.</div>
      <div class="ins-detail-stats">
        ${rowStat('Total $', fmt$(d.amount))}
        ${rowStat('Distinct funders', fmtN(Object.keys(fundersAgg).length))}
        ${rowStat('Distinct recipients', fmtN(Object.keys(recipientsAgg).length))}
        ${rowStat('Sample grants', fmtN(samples.length))}
      </div>
      ${listSection('Top grantmakers', topFunders)}
      ${listSection('Top recipients', topRecs)}
      ${samples.length ? `<div class="ins-detail-section"><div class="ins-detail-section-title">Sample grants</div>${sampleHtml}</div>` : ''}
    `;
  }
  function renderFoundationPanel(d, ds){
    const cls = d.intermediary;
    const flagHtml = cls
      ? `<div class="ins-detail-flag ${cls.tier==='confirmed'?'t4':'t2'}"><span style="width:6px;height:6px;border-radius:50%;background:currentColor"></span>${escH(cls.label)} · ${escH(cls.confidence)}</div>`
      : `<div class="ins-detail-flag t1"><span style="width:6px;height:6px;border-radius:50%;background:currentColor"></span>Direct grantmaker · Source confirmed</div>`;
    const explain = cls
      ? `${escH(d.name)} matches a known marker for <strong>${escH(cls.label)}</strong> (${escH(cls.confidence)} confidence). Grants flowing through this entity may have an upstream donor whose identity is not publicly disclosed in IRS filings — this is structural to ${cls.kind === 'daf_sponsor' ? 'donor-advised funds' : 'this entity type'}, not an allegation.`
      : `Direct private foundation grantmaker. Donor-to-grantee chain is fully traceable on the 990-PF.`;
    const topRecs = (d.topRecipients||[]).slice(0,8).map(r => ({label:r.name + (r.state?` · ${r.state}`:''), value:fmt$(r.total)}));
    const interRecs = (d.intermediaryRecs||[]).slice(0,8).map(r => ({label:r.name + ` · ${r.intermediary?.label}`, value:fmt$(r.total)}));
    setTimeout(() => {
      const b = document.getElementById('insFocusFoundation');
      if(b) b.addEventListener('click', () => {
        state.filter.focusFoundation = d.name;
        state.selectedNodeId = `fd:${d.name}`;
        const ds = getDatasets();
        renderToolbar(ds); renderMap(ds);
      });
      const flowBtn = document.getElementById('insOpenFlowWindow');
      if(flowBtn) flowBtn.addEventListener('click', () => openFlowNodeWindow(d.name, getDatasets()));
      wireClearDrill();
    }, 0);
    const focused = state.filter.focusFoundation && state.filter.focusFoundation.toLowerCase() === d.name.toLowerCase();
    return `
      <div class="ins-detail-eyebrow">Grantmaker · source</div>
      <div class="ins-detail-title">${escH(d.name)}</div>
      ${flagHtml}
      <div class="ins-detail-explain ${cls?'intermediary':''}">${explain}</div>
      <div class="ins-detail-stats">
        ${rowStat('Total $', fmt$(d.total))}
        ${rowStat('Grants', fmtN(d.count))}
        ${rowStat('Jewish $', fmt$(d.jewish))}
        ${rowStat('Non-Jewish $', fmt$(d.nonjewish))}
      </div>
      ${listSection('Top recipients', topRecs)}
      ${interRecs.length ? listSection('Likely intermediary recipients', interRecs) : ''}
      ${!focused ? `<button class="ins-reset" id="insFocusFoundation" style="margin-top:10px;background:rgba(99,102,241,0.12);color:#c7d2fe;border-color:rgba(99,102,241,0.4);">Focus money flow on this source</button>` : ''}
      <button class="ins-reset" id="insOpenFlowWindow" style="margin-top:10px;background:rgba(20,184,166,0.1);color:#99f6e4;border-color:rgba(20,184,166,0.34);">Open focused flow window</button>
      ${state.filter.focusFoundation ? clearDrillBtn('Clear source focus') : ''}
    `;
  }
  function renderRecipientPanel(d, ds){
    const cls = d.intermediary || {tier:'possible',label:'Probable Intermediary',confidence:'Possible',kind:'intermediary'};
    const tierClass = cls.tier === 'confirmed' ? '' : 't2';
    const explain = cls.kind === 'daf_sponsor'
      ? `${escH(d.name)} is a <strong>confirmed DAF sponsoring organization</strong>. Grants to this entity from a private foundation are legally permitted contributions to a donor-advised fund. The original donor (if any) cannot be identified from public IRS records — this is structural to the public charity disclosure regime, not concealment.`
      : cls.kind === 'community_foundation'
        ? `${escH(d.name)} matches the <strong>community foundation</strong> name pattern. Grants to it may originate from individual DAF accounts, pooled funds, or operating funds. Original donor identity is not publicly traceable.`
        : cls.kind === 'federation'
          ? `${escH(d.name)} matches the <strong>federation/federated giving</strong> pattern. Funds may be allocated to affiliated agencies on a regranting basis. Downstream allocations are not individually disclosed on the immediate 990.`
          : cls.kind === 'fiscal_sponsor'
            ? `${escH(d.name)} matches a <strong>fiscal sponsor</strong> name pattern. The named recipient is likely a fiscal host for one or more projects that are the intended beneficiaries. Final project recipient(s) are not disclosed on the 990.`
            : `${escH(d.name)} matches an <strong>intermediary</strong> name pattern (donor-indeterminate tier). Treat downstream traceability as reduced.`;
    return `
      <div class="ins-detail-eyebrow">Recipient · likely intermediary</div>
      <div class="ins-detail-title">${escH(d.name)}</div>
      <div class="ins-detail-flag ${tierClass}"><span style="width:6px;height:6px;border-radius:50%;background:currentColor"></span>${escH(cls.label)} · ${escH(cls.confidence)}</div>
      <div class="ins-detail-explain intermediary">${explain}</div>
      <div class="ins-detail-stats">
        ${rowStat('Total received', fmt$(d.total))}
        ${rowStat('Funders shown', fmtN((d.funders||[]).length))}
        ${rowStat('Confidence tier', escH(cls.confidence))}
        ${rowStat('Marker', escH(cls.label))}
      </div>
      ${listSection('Top funders flowing in', (d.funders||[]).slice(0,10).map(f=>({label:f.funder, value:fmt$(f.amount)})))}
    `;
  }
  // ── NEW DETAIL PANELS (4-level subject + columnar institution map) ─────────────
  function clearDrillBtn(label){
    return `<button class="ins-reset" id="insClearDrill" style="margin-top:10px;">← ${escH(label)}</button>`;
  }
  function wireClearDrill(){
    const btn = document.getElementById('insClearDrill');
    if(!btn) return;
    btn.addEventListener('click', () => {
      state.filter.subjectCategory = null;
      state.filter.subjectName = null;
      state.filter.focusFoundation = null;
      state.filter.focusRecipient = null;
      state.selectedNodeId = null;
      const ds = getDatasets();
      renderToolbar(ds);
      renderMap(ds);
      renderDetail(null);
    });
  }
  function renderRootSubjectsPanel(d, ds){
    const html = `
      <div class="ins-detail-eyebrow">Universal root</div>
      <div class="ins-detail-title">All tracked subjects</div>
      <div class="ins-detail-explain">Every grant in the active dashboard layer rolls up under a single subject taxonomy. Three orientation roots branch out (Jewish, Non-Jewish, Miscellaneous), each surfacing top categories. Open the <strong>All subjects</strong> drawer (top-left of the map) to browse every subject directly — search, expand any category, click any subject to drill in.</div>
      <div class="ins-detail-stats">
        ${rowStat('Total $', fmt$(d.total))}
        ${rowStat('Grants', fmtN(d.count))}
        ${rowStat('Subjects', fmtN(d.subjectsCount))}
        ${rowStat('Categories', fmtN(d.categoryCount))}
      </div>
      ${listSection('Top categories overall', (ds.subjectCategoriesList||[]).slice(0,8).map(c => ({label:c.name, value:fmt$(c.total)})))}
    `;
    return html;
  }
  function renderOrientationPanel(d, ds){
    // List top categories for this orientation
    const causeKey = d.cause; // 'J'|'NJ'|'M'
    const amtKey = causeKey === 'J' ? 'jewish' : (causeKey === 'NJ' ? 'nonjewish' : 'misc');
    const cats = (ds.subjectCategoriesList||[])
      .map(c => ({ name:c.name, amount: c[amtKey]||0 }))
      .filter(c => c.amount > 0).sort((a,b)=>b.amount-a.amount).slice(0,12);
    return `
      <div class="ins-detail-eyebrow">Orientation root</div>
      <div class="ins-detail-title">${escH(d.name)}</div>
      <div class="ins-detail-explain">Aggregate of all grants classified as <strong>${escH(d.name)}</strong> orientation. Branch nodes show top categories within this orientation — click any category to surface its constituent subjects.</div>
      <div class="ins-detail-stats">
        ${rowStat('Total $', fmt$(d.total))}
        ${rowStat('Grants', fmtN(d.count))}
        ${rowStat('Categories shown', fmtN(cats.length))}
        ${rowStat('Share of total', ds.totals.T_total ? ((d.total/ds.totals.T_total)*100).toFixed(1)+'%' : '—')}
      </div>
      ${listSection('Top categories', cats.map(c => ({label:c.name, value:fmt$(c.amount)})))}
    `;
  }
  function renderSubjectCategoryPanel(d, ds){
    const orient = d.cause === 'J' ? 'Jewish' : (d.cause === 'NJ' ? 'Non-Jewish' : 'Miscellaneous');
    const subs = (d.subjects||[]).slice(0, 14).map(s => ({label:s.name, value:fmt$(s.total)}));
    setTimeout(wireClearDrill, 0);
    return `
      <div class="ins-detail-eyebrow">${escH(orient)} · category</div>
      <div class="ins-detail-title">${escH(d.name)}</div>
      <div class="ins-detail-explain">A category groups related subjects (heuristic, name-based). Subjects within this category are surfaced as L3 nodes; click any subject to drill to its top recipients.</div>
      <div class="ins-detail-stats">
        ${rowStat(orient + ' $', fmt$(d.total))}
        ${rowStat('Subjects in category', fmtN((d.subjects||[]).length))}
        ${rowStat('Grants', fmtN(d.count))}
        ${rowStat('Orientation', escH(orient))}
      </div>
      ${listSection('Subjects in this category', subs)}
      ${state.filter.subjectCategory ? clearDrillBtn('Clear category focus') : ''}
    `;
  }
  function renderSubjectRecipientPanel(d, ds){
    const inter = d.intermediary;
    const flag = inter
      ? `<div class="ins-detail-flag ${inter.tier === 'confirmed' ? 't4' : 't2'}"><span style="width:6px;height:6px;border-radius:50%;background:currentColor"></span>${escH(inter.label)} · ${escH(inter.confidence)}</div>`
      : '';
    const explain = inter
      ? `${escH(d.name)} matches an intermediary marker (${escH(inter.label)}). Funds touching this recipient under <em>${escH(d.subject)}</em> may be re-granted; further trace requires switching to the Institutions map and drilling into this entity directly.`
      : `Direct recipient of grants categorised under <em>${escH(d.subject)}</em>. The dollar amount shown is this recipient's share of the subject's total in the active layer.`;
    return `
      <div class="ins-detail-eyebrow">Subject recipient</div>
      <div class="ins-detail-title">${escH(d.name)}</div>
      ${flag}
      <div class="ins-detail-explain ${inter?'intermediary':''}">${explain}</div>
      <div class="ins-detail-stats">
        ${rowStat('Received under subject', fmt$(d.amount))}
        ${rowStat('Subject', escH(d.subject))}
        ${rowStat('Orientation', d.cause === 'J' ? 'Jewish' : (d.cause === 'NJ' ? 'Non-Jewish' : 'Misc'))}
        ${rowStat('Recipient type', inter ? escH(inter.label) : 'Direct recipient')}
      </div>
    `;
  }
  function renderRecipientNodePanel(d, ds){
    const cls = d.intermediary;
    const isInter = !!cls;
    const sourceObj = (ds.institutionMapAll||ds.institutionMap||[]).find(f => String(f.name||'').toLowerCase() === String(d.name||'').toLowerCase());
    const downstream = sourceObj ? (sourceObj.topRecipients||[]).slice(0,8).map(r => ({label:r.name + (r.state?` · ${r.state}`:''), value:fmt$(r.total)})) : [];
    const flagCls = !cls ? 't1' : (cls.tier === 'confirmed' ? 't4' : 't2');
    const flagLabel = cls ? `${cls.label} · ${cls.confidence}` : 'Direct recipient · source confirmed';
    const explain = isInter
      ? (cls.kind === 'daf_sponsor'
          ? `${escH(d.name)} is a <strong>confirmed DAF sponsoring organization</strong>. Inflows here are contributions to a donor-advised fund. The original donor cannot be identified from public IRS records — this is structural, not concealment. Click <em>Drill downstream</em> to surface re-grants from this entity that appear in the dataset.`
          : cls.kind === 'community_foundation'
            ? `${escH(d.name)} matches a <strong>community foundation</strong> name pattern. Funds may pool donor contributions; downstream allocations appear in this dataset where they were filed by the foundation. Click <em>Drill downstream</em> to expand.`
            : cls.kind === 'federation'
              ? `${escH(d.name)} matches a <strong>federation / federated giving</strong> pattern. Allocations to affiliated agencies are typically pooled. Click <em>Drill downstream</em> to surface what this entity then re-granted.`
              : cls.kind === 'fiscal_sponsor'
                ? `${escH(d.name)} matches a <strong>fiscal sponsor</strong> name pattern. The named recipient is likely a fiscal host for one or more projects — click <em>Drill downstream</em> to see further hops where present.`
                : `${escH(d.name)} matches an <strong>intermediary</strong> name pattern (donor-indeterminate tier).`)
      : `${escH(d.name)} appears as a final recipient in the available records. Funders flowing in are listed below.`;
    const isAlsoGm = d.isAlsoGrantmaker;
    const drillBtn = isAlsoGm
      ? `<button class="ins-reset" id="insExpandDownstream" style="margin-top:10px;background:rgba(99,102,241,0.12);color:#c7d2fe;border-color:rgba(99,102,241,0.4);">Drill downstream</button>`
      : `<div class="ins-detail-flag t2" style="margin-top:10px;"><span style="width:6px;height:6px;border-radius:50%;background:currentColor"></span>Trace ends in available records</div>`;
    setTimeout(() => {
      const b = document.getElementById('insExpandDownstream');
      if(b) b.addEventListener('click', () => {
        state.filter.focusRecipient = d.name;
        state.selectedNodeId = null;
        const ds = getDatasets();
        renderToolbar(ds); renderMap(ds);
        const focusIds = bestVisibleInstitutionNodeIds(d.name);
        state.selectedNodeId = focusIds[0] || bestVisibleInstitutionNodeId(d.name);
        applySelectedFlowHighlight(document.getElementById('insSvg'), state._lastGraph, focusIds.length ? focusIds : state.selectedNodeId);
      });
      const flowBtn = document.getElementById('insOpenFlowWindow');
      if(flowBtn) flowBtn.addEventListener('click', () => openFlowNodeWindow(d.name, getDatasets()));
      wireClearDrill();
    }, 0);
    return `
      <div class="ins-detail-eyebrow">Recipient · ${isInter ? 'intermediary' : 'direct'}</div>
      <div class="ins-detail-title">${escH(d.name)}</div>
      <div class="ins-detail-flag ${flagCls}"><span style="width:6px;height:6px;border-radius:50%;background:currentColor"></span>${escH(flagLabel)}</div>
      <div class="ins-detail-explain ${isInter?'intermediary':''}">${explain}</div>
      <div class="ins-detail-stats">
        ${rowStat('Total received', fmt$(d.total))}
        ${rowStat('Funders', fmtN((d.funders||[]).length))}
        ${rowStat('Marker', isInter ? escH(cls.label) : 'Direct')}
        ${rowStat('Also grantmaker?', isAlsoGm ? 'Yes — has filings' : 'Not in dataset')}
        ${sourceObj ? rowStat('Outbound routed', fmt$(sourceObj.total)) : ''}
      </div>
      ${listSection('Top funders flowing in', (d.funders||[]).slice(0,10).map(f => ({label:f.funder, value:fmt$(f.amount)})))}
      ${downstream.length ? listSection('Top downstream recipients from this org', downstream) : ''}
      ${drillBtn}
      <button class="ins-reset" id="insOpenFlowWindow" style="margin-top:10px;background:rgba(20,184,166,0.1);color:#99f6e4;border-color:rgba(20,184,166,0.34);">Open focused flow window</button>
      ${state.filter.focusRecipient ? clearDrillBtn('Clear recipient focus') : ''}
    `;
  }
  function renderDownstreamPanel(d, ds){
    const samples = (d.samples||[]).slice(0,6).map(s => `
      <div class="ins-grant-row">
        <span class="yr">${escH(s.year)}</span>
        <span class="desc">${escH(s.subject||'—')}</span>
        <span class="amt">${fmt$(s.amount)}</span>
      </div>`).join('');
    setTimeout(wireClearDrill, 0);
    return `
      <div class="ins-detail-eyebrow">Downstream recipient</div>
      <div class="ins-detail-title">${escH(d.name)}</div>
      <div class="ins-detail-explain">${escH(d.name)} received funds via <strong>${escH(d.viaIntermediary)}</strong>. The path is: original source → ${escH(d.viaIntermediary)} (intermediary) → ${escH(d.name)}. Source-to-recipient attribution is via the intermediary's filings, not the original donor.</div>
      <div class="ins-detail-stats">
        ${rowStat('Received via intermediary', fmt$(d.total))}
        ${rowStat('Grants', fmtN(d.count))}
        ${rowStat('Via', escH(d.viaIntermediary))}
        ${rowStat('Marker', d.intermediary ? escH(d.intermediary.label) : 'Direct (downstream)')}
      </div>
      ${samples ? `<div class="ins-detail-section"><div class="ins-detail-section-title">Sample grants</div>${samples}</div>` : ''}
      ${state.filter.focusRecipient ? clearDrillBtn('Clear focus') : ''}
    `;
  }
  function renderEndUsePanel(d, ds){
    return `
      <div class="ins-detail-eyebrow">End-use · subject</div>
      <div class="ins-detail-title">${escH(d.name)}</div>
      <div class="ins-detail-explain">Where money lands in subject terms. Aggregated from grant rows whose immediate parent in the column flow is <strong>${escH(d.parent || '—')}</strong>. This is the deepest hop visible in the records for this branch.</div>
      <div class="ins-detail-stats">
        ${rowStat('Amount', fmt$(d.amount))}
        ${rowStat('Subject', escH(d.name))}
        ${rowStat('Anchor', escH(d.parent || '—'))}
      </div>
    `;
  }
  function renderTraceStopPanel(d, ds){
    return `
      <div class="ins-detail-eyebrow">Trace stop</div>
      <div class="ins-detail-title">Trace ends in available records</div>
      <div class="ins-detail-flag t2"><span style="width:6px;height:6px;border-radius:50%;background:currentColor"></span>Neutral marker</div>
      <div class="ins-detail-explain">No further regrant rows for <strong>${escH(d.source||'this entity')}</strong> appear in the active dashboard layer. ${escH(d.reason||'')} This is a statement about <em>data availability</em>, not about the entity — records may exist that aren't represented here, particularly where the entity is a public charity not required to file a 990-PF.</div>
    `;
  }

  function renderGeoPanel(d, ds){
    return `
      <div class="ins-detail-eyebrow">Geography · ${d.kind === 'state' ? 'State' : 'Region'}</div>
      <div class="ins-detail-title">${escH(d.name)}</div>
      <div class="ins-detail-explain">Aggregate of grants whose recipient geography resolves to <strong>${escH(d.name)}</strong>. State-level totals come from grantmakers headquartered in that state; regional totals come from the dashboard's geography classification.</div>
      <div class="ins-detail-stats">
        ${rowStat('Total $', fmt$(d.total))}
        ${rowStat('Jewish $', fmt$(d.jewish||0))}
        ${rowStat('Non-Jewish $', fmt$(d.nonjewish||0))}
        ${d.kind==='state' ? rowStat('Grants', fmtN(d.count||0)) : rowStat('Misc $', fmt$(d.misc||0))}
      </div>
    `;
  }

  // ── FOCUSED MONEY-FLOW WINDOW ─────────────────────────────────────────────
  function findFlowSourceObj(ds, name){
    if(!name) return null;
    const norm = flowNameNorm(name);
    return (ds.institutionMapAll||ds.institutionMap||[]).find(f =>
      flowNameNorm(f.name) === norm || String(f.name||'').toLowerCase() === String(name||'').toLowerCase()
    ) || null;
  }

  function findFlowHub(ds, name){
    const flowIndex = ds.moneyFlowIndex || {};
    const hubsByName = flowIndex.hubsByName || {};
    if(!name) return null;
    if(hubsByName[name]) return hubsByName[name];
    const norm = flowNameNorm(name);
    const exact = Object.values(hubsByName).find(h => flowNameNorm(h.name) === norm || flowNameNorm(h.display) === norm);
    if(exact) return exact;
    const match = flowIndex.findGrantmakerForRecipient ? flowIndex.findGrantmakerForRecipient(name) : null;
    if(match && hubsByName[match.name]) return hubsByName[match.name];
    if(match){
      return Object.values(hubsByName).find(h => flowNameNorm(h.name) === flowNameNorm(match.name)) || null;
    }
    return null;
  }

  function aggregateInboundEdges(edges){
    const map = {};
    (edges||[]).forEach(e => {
      const name = e.source || e.funder || e.sourceName;
      if(!name) return;
      if(!map[name]) map[name] = { name, amount:0, count:0 };
      map[name].amount += +e.amount || 0;
      map[name].count += +e.count || 0;
    });
    return Object.values(map).sort((a,b)=>b.amount-a.amount);
  }

  function buildFlowWindowModel(nodeName, ds){
    const flowIndex = ds.moneyFlowIndex || {};
    const hub = findFlowHub(ds, nodeName);
    const sourceObj = findFlowSourceObj(ds, nodeName);
    const norm = flowNameNorm(nodeName);
    const incomingFromRecipient = Object.entries(flowIndex.byRecipient || {})
      .filter(([k]) => flowNameNorm(k) === norm)
      .flatMap(([,rows]) => rows || []);
    const incomingEdges = hub ? (hub.inboundEdges || []) : incomingFromRecipient;
    const upstream = hub && hub.topFunders && hub.topFunders.length
      ? hub.topFunders.map(f => ({ name:f.name, amount:f.amount || 0, count:0 }))
      : aggregateInboundEdges(incomingEdges).slice(0, 12);
    const downstreamMap = {};
    function addDownstream(name, amount, count, subject, state){
      if(!name) return;
      const key = flowNameNorm(name);
      if(!downstreamMap[key]) downstreamMap[key] = { name, amount:0, count:0, subject:subject||'', state:state||'' };
      downstreamMap[key].amount += +amount || 0;
      downstreamMap[key].count += +count || 0;
      if(subject && !downstreamMap[key].subject) downstreamMap[key].subject = subject;
      if(state && !downstreamMap[key].state) downstreamMap[key].state = state;
    }
    (hub && hub.topDownstream || []).forEach(r => addDownstream(r.name, r.total, r.count, r.topSubject, r.state));
    (sourceObj && sourceObj.topRecipients || []).forEach(r => addDownstream(r.name, r.total, r.count, r.topSubject, r.state));
    (sourceObj && sourceObj.intermediaryRecs || []).forEach(r => addDownstream(r.name, r.total, r.count, r.topSubject, r.state));
    const downstream = Object.values(downstreamMap).sort((a,b)=>b.amount-a.amount).slice(0, 14);

    const subjectMap = {};
    (hub && hub.topSubjects || []).forEach(s => { subjectMap[s.name] = (subjectMap[s.name] || 0) + (+s.amount || 0); });
    downstream.forEach(d => { if(d.subject) subjectMap[d.subject] = (subjectMap[d.subject] || 0) + (+d.amount || 0); });
    const rgKey = flowIndex.getGrantmakerKey ? flowIndex.getGrantmakerKey(nodeName) : nodeName;
    const rgRows = (ds.RG && (ds.RG[rgKey] || ds.RG[nodeName])) || null;
    if(rgRows){
      Object.values(rgRows).forEach(rows => (rows||[]).forEach(g => {
        const subj = (g[3]||'').trim();
        if(subj) subjectMap[subj] = (subjectMap[subj] || 0) + (+g[1] || 0);
      }));
    }
    const subjects = Object.entries(subjectMap).sort((a,b)=>b[1]-a[1]).slice(0, 12).map(([name,amount])=>({name,amount}));
    const cls = (hub && hub.classification) || (sourceObj && sourceObj.intermediarySelf) || classifyIntermediary(nodeName);
    const nodeType = hub ? (hub.entityType || (cls && cls.label) || 'Flow hub')
      : sourceObj ? (sourceObj.intermediarySelf ? sourceObj.intermediarySelf.label : 'Source foundation')
      : cls ? cls.label : 'Recipient / endpoint';
    const inbound = hub ? (hub.inbound || 0) : upstream.reduce((a,c)=>a+(+c.amount||0),0);
    const outbound = hub ? (hub.outbound || 0) : (sourceObj ? (sourceObj.total || 0) : downstream.reduce((a,c)=>a+(+c.amount||0),0));
    return {
      name: hub ? hub.name : (sourceObj ? sourceObj.name : nodeName),
      display: hub ? (hub.display || orgDisplayLabel(hub.name)) : orgDisplayLabel(sourceObj ? sourceObj.name : nodeName),
      hub, sourceObj, cls, nodeType,
      inbound, outbound,
      upstream, downstream, subjects,
      incomingEdges,
      passThroughRisk: hub ? (hub.passThroughRisk || 0) : (inbound > 0 && outbound > 0 ? Math.min(1, Math.min(inbound,outbound)/Math.max(inbound,outbound)) : 0)
    };
  }

  function traceFlowSourceName(ds, name){
    const sources = (ds.institutionMapAll || ds.institutionMap || []);
    const qNorm = flowNameNorm(name);
    const fObj = sources.find(f => flowNameNorm(f.name) === qNorm)
      || sources.find(f => String(f.name||'').toLowerCase().includes(String(name||'').toLowerCase()))
      || sources.find(f => flowTokenScore(flowNameTokens(name), flowNameTokens(f.name)) >= 0.72);
    if(!fObj) return false;
    state.map = 'institution';
    state.filter.search = '';
    state.filter.focusFoundation = fObj.name;
    state.filter.focusRecipient = null;
    state.selectedNodeId = `fd:${fObj.name}`;
    state.trace.enabled = true;
    state.trace.sourceId = `fd:${fObj.name}`;
    state.trace.sourceName = fObj.name;
    state.trace.focusedL2 = null;
    state.trace.step = 1;
    state.trace.paths = computeTracePaths(ds, fObj);
    state.trace.stoppedAt = null;
    document.body.classList.add('trace-mode');
    renderToolbar(ds);
    renderMap(ds);
    requestAnimationFrame(() => {
      runTraceAnimation();
      renderTraceDetail(ds);
    });
    return true;
  }

  function focusFlowNodeOnMap(ds, name){
    const sourceObj = findFlowSourceObj(ds, name);
    state.map = 'institution';
    state.filter.search = '';
    state.filter.focusFoundation = sourceObj && !findFlowHub(ds, name) ? sourceObj.name : null;
    state.filter.focusRecipient = state.filter.focusFoundation ? null : name;
    state.selectedNodeId = null;
    stopTraceAnimation();
    state.trace.sourceId = null; state.trace.sourceName = null;
    state.trace.focusedL2 = null; state.trace.step = 0;
    state.trace.paths = []; state.trace.stoppedAt = null;
    renderToolbar(ds);
    renderMap(ds);
    const focusName = state.filter.focusFoundation || name;
    const focusIds = bestVisibleInstitutionNodeIds(focusName);
    state.selectedNodeId = focusIds[0] || (state.filter.focusFoundation ? `fd:${state.filter.focusFoundation}` : bestVisibleInstitutionNodeId(name));
    applySelectedFlowHighlight(document.getElementById('insSvg'), state._lastGraph, focusIds.length ? focusIds : state.selectedNodeId);
    const hub = findFlowHub(ds, name);
    if(sourceObj && state.filter.focusFoundation) renderDetail({ data:{ kind:'foundation', ...sourceObj } }, ds);
    else renderDetail({ data:{ kind:'recipient_intermediary', name, total:(hub&&hub.inbound)||0,
      funders:(hub&&hub.topFunders||[]).map(f => ({funder:f.name, amount:f.amount})),
      intermediary:classifyIntermediary(name), isAlsoGrantmaker:ds.isAlsoGrantmaker(name) } }, ds);
  }

  function openFlowNodeWindow(nodeName, ds){
    ds = ds || getDatasets();
    const model = buildFlowWindowModel(nodeName, ds);
    const existing = document.querySelector('.ins-flow-modal-backdrop');
    if(existing) existing.remove();
    const laneItems = (items, attr, emptyText) => {
      if(!items || !items.length) return `<div class="ins-flow-empty">${escH(emptyText)}</div>`;
      return items.slice(0, 10).map(item => `<button class="ins-flow-item" ${attr}="${escH(item.name)}" title="${escH(item.name)}">
        <span class="name">${escH(orgDisplayLabel(item.name))}</span>
        <span class="amt">${fmt$(item.amount || 0)}</span>
      </button>`).join('');
    };
    const topSource = model.upstream && model.upstream[0] && model.upstream[0].name;
    const note = model.hub
      ? 'This node has both inbound foundation support and outbound grant rows in the loaded federation/foundation records.'
      : model.sourceObj
        ? 'This node is treated as a source grantmaker; outbound recipients are drawn from its loaded Form 990 rows.'
        : 'This node appears as a recipient endpoint; further hops are shown only where records match a grantmaking entity.';
    const backdrop = document.createElement('div');
    backdrop.className = 'ins-flow-modal-backdrop';
    backdrop.setAttribute('role','dialog');
    backdrop.setAttribute('aria-modal','true');
    backdrop.innerHTML = `
      <div class="ins-flow-modal" role="document">
        <div class="ins-flow-modal-head">
          <div>
            <div class="ins-flow-modal-eyebrow">Focused money-flow window</div>
            <div class="ins-flow-modal-title">${escH(model.display)}</div>
            <div class="ins-flow-modal-sub">Forward and backward trace around the selected node. Click an upstream source to trace from that foundation, or click a downstream node to open that node as the new center without losing the current map context.</div>
          </div>
          <button class="ins-flow-modal-close" data-flow-close aria-label="Close flow window">×</button>
        </div>
        <div class="ins-flow-window-stats">
          <div class="ins-flow-window-stat"><div class="lbl">Inbound observed</div><div class="val">${fmt$(model.inbound||0)}</div></div>
          <div class="ins-flow-window-stat"><div class="lbl">Outbound observed</div><div class="val">${fmt$(model.outbound||0)}</div></div>
          <div class="ins-flow-window-stat"><div class="lbl">Upstream sources</div><div class="val">${fmtN((model.upstream||[]).length)}</div></div>
          <div class="ins-flow-window-stat"><div class="lbl">Pass-through overlap</div><div class="val">${Math.round((model.passThroughRisk||0)*100)}%</div></div>
        </div>
        <div class="ins-flow-modal-grid">
          <div class="ins-flow-lane">
            <div class="ins-flow-lane-title"><span class="dot" style="color:var(--src);background:var(--src);"></span>Upstream sources</div>
            ${laneItems(model.upstream, 'data-flow-source', 'No upstream source rows are linked to this node in the active dataset.')}
          </div>
          <div class="ins-flow-lane ins-flow-node-center">
            <div class="ins-flow-node-core">
              <div class="node-type">${escH(model.nodeType)}</div>
              <div class="node-name">${escH(model.display)}</div>
              <div class="node-note">${escH(note)} ${model.cls ? escH(model.cls.label + ' · ' + model.cls.confidence + ' confidence.') : ''}</div>
            </div>
          </div>
          <div class="ins-flow-lane">
            <div class="ins-flow-lane-title"><span class="dot" style="color:var(--recipient);background:var(--recipient);"></span>Downstream recipients</div>
            ${laneItems(model.downstream, 'data-flow-open-node', 'No downstream grant rows are available for this node. Trace stops here in the current records.')}
          </div>
          <div class="ins-flow-lane">
            <div class="ins-flow-lane-title"><span class="dot" style="color:var(--subject);background:var(--subject);"></span>Subjects / end-use</div>
            ${laneItems(model.subjects, 'data-flow-subject', 'No subject-level end-use rows are attached to this node.')}
          </div>
        </div>
        <div class="ins-flow-window-actions">
          <button data-flow-focus-map>Focus this node in map</button>
          ${topSource ? `<button data-flow-trace-source="${escH(topSource)}">Trace top source</button>` : ''}
          <button class="secondary" data-flow-close>Close / back to previous map</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    const close = () => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
    };
    const onKey = (e) => { if(e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    backdrop.addEventListener('click', (e) => { if(e.target === backdrop) close(); });
    backdrop.querySelectorAll('[data-flow-close]').forEach(btn => btn.addEventListener('click', close));
    backdrop.querySelector('[data-flow-focus-map]')?.addEventListener('click', () => {
      close();
      focusFlowNodeOnMap(ds, model.name);
    });
    backdrop.querySelectorAll('[data-flow-source]').forEach(btn => btn.addEventListener('click', () => {
      const name = btn.getAttribute('data-flow-source');
      close();
      if(name) traceFlowSourceName(ds, name);
    }));
    backdrop.querySelectorAll('[data-flow-trace-source]').forEach(btn => btn.addEventListener('click', () => {
      const name = btn.getAttribute('data-flow-trace-source');
      close();
      if(name) traceFlowSourceName(ds, name);
    }));
    backdrop.querySelectorAll('[data-flow-open-node]').forEach(btn => btn.addEventListener('click', () => {
      const name = btn.getAttribute('data-flow-open-node');
      if(name){
        close();
        openFlowNodeWindow(name, ds);
      }
    }));
    backdrop.querySelectorAll('[data-flow-subject]').forEach(btn => btn.addEventListener('click', () => {
      const name = btn.getAttribute('data-flow-subject');
      if(!name) return;
      close();
      state.map = 'subject';
      state.filter.subjectName = name;
      state.filter.subjectCategory = null;
      renderToolbar(ds);
      renderMap(ds);
    }));
  }

  // ── CAVEAT FOOTER ─────────────────────────────────────────────────────────
  function renderCaveat(){
    const root = document.getElementById('insCaveat');
    if(!root) return;
    root.innerHTML = `
      <strong>Method &amp; caveats.</strong> Markers like <em>Confirmed DAF sponsor</em>, <em>Community foundation</em>, <em>Federation</em>, <em>Fiscal sponsor</em>, and <em>Probable intermediary</em> are <strong>structural, evidence-based observations</strong> derived from name and known-entity matching against a curated reference list (Fidelity Charitable, Schwab/DAFgiving360, Vanguard Charitable, NPT, DonorsTrust, NCF, Tides, New Venture Fund, Silicon Valley CF, Goldman Sachs Charitable, Morgan Stanley Global Impact, etc.). They flag patterns consistent with reduced donor-to-grantee traceability and <strong>do not imply concealment, wrongdoing, or improper intent</strong>. Community foundations, federations, and fiscal sponsors serve legitimate grantmaking functions; per the DAF Research Collaborative, &lt;4% of DAF grants are fully anonymous. Public charities (which include DAF sponsors) are not required by IRS rules to disclose individual contributor names — this is statutory, not concealment. See the Foundation Dashboard research notes for full source citations and confidence-tier definitions.
    `;
  }

  // ── MOUNT ─────────────────────────────────────────────────────────────────
  function wireDrawerToggle(ds){
    const btn = document.getElementById('insDrawerBtn');
    if(!btn || btn.__wired) return;
    btn.__wired = true;
    btn.addEventListener('click', () => {
      state.drawerOpen = !state.drawerOpen;
      const drawer = document.getElementById('insDrawer');
      if(!drawer) return;
      if(state.drawerOpen){
        renderDrawer(ds);
        drawer.classList.add('open');
      } else {
        drawer.classList.remove('open');
      }
    });
  }

  function renderInsights(){
    const ds = getDatasets();
    renderOverview(ds);
    renderToolbar(ds);
    renderMap(ds);
    renderCaveat();
    wireDrawerToggle(ds);
    state.mounted = true;
  }
  window.renderInsights = renderInsights;

  function learningLogClass(label){
    const s = String(label||'').toLowerCase();
    if(s.includes('jewish') && !s.includes('non')) return 'j';
    if(s.includes('non-jewish') || s.includes('non jewish')) return 'nj';
    if(s.includes('research') || s.includes('misc')) return 'research';
    return '';
  }
  function getLearningLogRows(){
    const rows = [];
    (window.CLASSIFICATION_CORRECTION_LOG || []).forEach((e,idx) => rows.push({
      id:'correction_'+idx,
      priority:3,
      source:e.source || 'Admin Edit',
      timestamp:e.correction_timestamp || '',
      recipient:e.recipient_name || '',
      grantmaker:e.grantmaker_name || '',
      taxYear:e.tax_year || '',
      amount:+e.amount || 0,
      original:e.original_classification || '—',
      corrected:e.corrected_classification || '—',
      reason:e.admin_reason || 'No reason captured',
      confidence:e.confidence_score,
      learningStatus:e.learning_status || 'saved',
      applied:e.applied_to_historical_records ? 'Historical apply' : 'Single row'
    }));
    (window.IDENTITY_REVIEW_DECISION_LOG || []).forEach((e,idx) => rows.push({
      id:'identity_'+idx,
      priority:2,
      source:e.source || 'Identity Review Queue',
      timestamp:e.reviewedAt || '',
      recipient:e.recipientName || '',
      grantmaker:'—',
      taxYear:e.years || '',
      amount:+e.amount || 0,
      original:'Review candidate',
      corrected:e.decisionLabel || (e.decision === 'J' ? 'Approved Jewish' : e.decision === 'NJ' ? 'Approved Non-Jewish' : 'Needs Research'),
      reason:e.reason || 'No reason captured',
      confidence:e.score,
      learningStatus:e.learning_status || 'saved_and_applied',
      applied:e.grantCount ? `${fmtN(e.grantCount)} candidate${e.grantCount===1?'':'s'}` : 'Review decision'
    }));
    (window.CLASSIFICATION_AUDIT_TRAIL || []).forEach((e,idx) => {
      const priorityText = `${e.recipient_name||''} ${e.subject||''} ${e.admin_reason||''}`;
      const priority = /tikvah|lubavitch|chabad/i.test(priorityText) ? 2 : (/jewish\s+community\s+infrastructure/i.test(priorityText) ? 1 : 0);
      rows.push({
        id:'audit_'+idx+'_'+(e.audit_key||idx),
        priority,
        source:e.corrected_by_admin ? 'Admin rule applied' : 'Engine rule applied',
        timestamp:e.correction_timestamp || '',
        recipient:e.recipient_name || '',
        grantmaker:e.grantmaker_name || '',
        taxYear:e.tax_year || '',
        amount:+e.amount || 0,
        original:e.original_classification || '—',
        corrected:e.corrected_classification || '—',
        reason:(e.admin_reason || 'Classification rule correction') + (e.subject ? ` · Subject: ${e.subject}` : ''),
        confidence:e.confidence_score,
        learningStatus:e.learning_status || 'applied_to_active_dashboard',
        applied:e.applied_to_historical_records ? 'Historical apply' : 'Single row'
      });
    });
    const seen = new Set();
    return rows.filter(r => {
      const key = [r.source,r.recipient,r.grantmaker,r.taxYear,r.amount,r.original,r.corrected,r.reason].join('|');
      if(seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a,b) => (b.priority||0)-(a.priority||0) || String(b.timestamp||'').localeCompare(String(a.timestamp||'')));
  }
  function renderClassificationLearningLog(){
    const root = document.getElementById('adminLearningLog');
    if(!root) return;
    const rows = getLearningLogRows();
    const manual = rows.filter(r => /Admin Edit|Identity Review/i.test(r.source)).length;
    const applied = rows.filter(r => /rule applied/i.test(r.source)).length;
    const jewish = rows.filter(r => /jewish/i.test(r.corrected) && !/non/i.test(r.corrected)).length;
    const research = rows.filter(r => /research|misc/i.test(r.corrected)).length;
    const shown = rows.slice(0, 75);
    root.innerHTML = `<div class="learning-log-card" data-testid="classification-learning-log">
      <div class="learning-log-head">
        <div>
          <div class="learning-log-title">Classification Learning Log</div>
          <div class="learning-log-sub">Review every Admin correction, Identity Review decision, and high-confidence rule application currently active in this dashboard session. Original extracted values remain preserved; corrected labels and reasons are tracked separately as learning signals.</div>
        </div>
        <div class="learning-log-actions">
          <button type="button" data-learning-export="json">Download learning log</button>
        </div>
      </div>
      <div class="learning-log-stats">
        <div class="learning-log-stat"><div class="lbl">Manual decisions</div><div class="val">${fmtN(manual)}</div></div>
        <div class="learning-log-stat"><div class="lbl">Rule-applied records</div><div class="val">${fmtN(applied)}</div></div>
        <div class="learning-log-stat"><div class="lbl">Jewish corrections</div><div class="val">${fmtN(jewish)}</div></div>
        <div class="learning-log-stat"><div class="lbl">Need research / misc</div><div class="val">${fmtN(research)}</div></div>
      </div>
      <div class="learning-log-table-wrap">
        <table class="learning-log-table">
          <thead><tr>
            <th>Source</th><th>Recipient</th><th>Grantmaker</th><th>Year</th><th>Amount</th><th>Original → Corrected</th><th>Reason / evidence</th><th>Status</th>
          </tr></thead>
          <tbody>${shown.length ? shown.map(r => `<tr>
            <td><span class="learning-log-pill">${escH(r.source)}</span></td>
            <td class="entity">${escH(r.recipient || '—')}</td>
            <td>${escH(r.grantmaker || '—')}</td>
            <td>${escH(r.taxYear || '—')}</td>
            <td style="font-variant-numeric:tabular-nums;white-space:nowrap;">${r.amount ? fmt$(r.amount) : '—'}</td>
            <td><span class="learning-log-pill ${learningLogClass(r.original)}">${escH(r.original)}</span> <span style="color:var(--text-faint);">→</span> <span class="learning-log-pill ${learningLogClass(r.corrected)}">${escH(r.corrected)}</span></td>
            <td class="reason">${escH(r.reason || 'No reason captured')}${r.confidence ? `<br><span style="color:var(--text-faint);">Confidence: ${Math.round((+r.confidence || 0)*100)}%</span>` : ''}</td>
            <td>${escH(r.learningStatus || 'saved')}<br><span style="color:var(--text-faint);">${escH(r.applied || '')}</span></td>
          </tr>`).join('') : `<tr><td colspan="8" style="padding:16px;color:var(--text-muted);">No learning decisions or audit-applied corrections are active yet.</td></tr>`}</tbody>
        </table>
      </div>
      <div class="identity-review-note" style="border-top:0;margin-top:10px;padding-top:0;">Showing latest ${fmtN(shown.length)} of ${fmtN(rows.length)} active learning records. Use the export for the full session log.</div>
    </div>`;
    root.querySelector('[data-learning-export]')?.addEventListener('click', () => {
      const payload = {type:'atlas_classification_learning_log', version:1, exportedAt:new Date().toISOString(), dataLayer:window.dataLayer || 'existing', rows};
      const blob = new Blob([JSON.stringify(payload,null,2)], {type:'application/json'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `classification-learning-log-${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    });
  }

  function renderAdmin(){
    const ds = getDatasets();
    const overview = document.getElementById('adminOverview');
    const queueRoot = document.getElementById('adminIdentityQueue');
    const learningRoot = document.getElementById('adminLearningLog');
    if(!overview || !queueRoot || !learningRoot) return;
    if(!ds.ok){
      overview.innerHTML = `<div class="ins-overview-card"><div class="ins-overview-title">Admin unavailable</div><div class="ins-overview-text">${escH(ds.reason||'Dashboard data not yet loaded.')}</div></div>`;
      queueRoot.innerHTML = '';
      learningRoot.innerHTML = '';
      return;
    }
    overview.innerHTML = `
      <div class="ins-overview-card">
        <div class="ins-overview-title">Admin · training and development workspace</div>
        <div class="ins-overview-text">
          This page is reserved for classification training, review queues, extraction QA, and future development engines.
          Access control will be added later; for now it is separated from the reader-facing Insights page so end users see only the analysis maps.
        </div>
        <div class="ins-trace-row">
          <span class="ins-trace-pill"><span class="ins-trace-dot t1"></span>Human approval required</span>
          <span class="ins-trace-pill"><span class="ins-trace-dot t2"></span>Reasons become training notes</span>
          <span class="ins-trace-pill"><span class="ins-trace-dot t3"></span>Export patches for future builds</span>
        </div>
      </div>`;
    queueRoot.innerHTML = renderIdentityReviewQueue(ds);
    wireIdentityReviewQueue();
    renderClassificationLearningLog();
  }
  window.renderAdmin = renderAdmin;

  // Expose top-view switch
  window.setTopView = function(view){
    const body = document.body;
    const dash = document.getElementById('dashboardView');
    const ins  = document.getElementById('insightsView');
    const admin = document.getElementById('adminView');
    const updates = document.getElementById('adminUpdatesView');
    const navD = document.getElementById('navDashboard');
    const navI = document.getElementById('navInsights');
    const navA = document.getElementById('navAdmin');
    const navU = document.getElementById('navUpdates');
    const isAdmin = !!(window.UPDATES_CENTER && window.UPDATES_CENTER.isAdmin && window.UPDATES_CENTER.isAdmin());
    // Admin gate for Updates view
    if(view === 'updates' && !isAdmin){ view = 'admin'; }
    if(view === 'insights'){
      body.classList.add('insights-active');
      body.classList.remove('admin-active');
      body.classList.remove('updates-active');
      if(ins) ins.hidden = false;
      if(dash) dash.hidden = true;
      if(admin) admin.hidden = true;
      if(updates) updates.hidden = true;
      if(navI){ navI.classList.add('active'); navI.setAttribute('aria-selected','true'); }
      if(navD){ navD.classList.remove('active'); navD.setAttribute('aria-selected','false'); }
      if(navA){ navA.classList.remove('active'); navA.setAttribute('aria-selected','false'); }
      if(navU){ navU.classList.remove('active'); navU.setAttribute('aria-selected','false'); }
      // render
      try{ renderInsights(); }catch(err){ console.error('Insights render error:', err);
        const el = document.getElementById('insOverview');
        if(el) el.innerHTML = `<div class="ins-overview-card"><div class="ins-overview-title">Couldn’t render Insights</div><div class="ins-overview-text">${escH(err && err.message || String(err))}</div></div>`;
      }
    }else if(view === 'admin'){
      body.classList.remove('insights-active');
      body.classList.add('admin-active');
      body.classList.remove('updates-active');
      if(ins) ins.hidden = true;
      if(dash) dash.hidden = true;
      if(admin) admin.hidden = false;
      if(updates) updates.hidden = true;
      if(navI){ navI.classList.remove('active'); navI.setAttribute('aria-selected','false'); }
      if(navD){ navD.classList.remove('active'); navD.setAttribute('aria-selected','false'); }
      if(navA){ navA.classList.add('active'); navA.setAttribute('aria-selected','true'); }
      if(navU){ navU.classList.remove('active'); navU.setAttribute('aria-selected','false'); }
      try{ renderAdmin(); }catch(err){ console.error('Admin render error:', err);
        const el = document.getElementById('adminOverview');
        if(el) el.innerHTML = `<div class="ins-overview-card"><div class="ins-overview-title">Couldn’t render Admin</div><div class="ins-overview-text">${escH(err && err.message || String(err))}</div></div>`;
      }
    }else if(view === 'updates'){
      body.classList.remove('insights-active');
      body.classList.remove('admin-active');
      body.classList.add('updates-active');
      if(ins) ins.hidden = true;
      if(dash) dash.hidden = true;
      if(admin) admin.hidden = true;
      if(updates) updates.hidden = false;
      if(navI){ navI.classList.remove('active'); navI.setAttribute('aria-selected','false'); }
      if(navD){ navD.classList.remove('active'); navD.setAttribute('aria-selected','false'); }
      if(navA){ navA.classList.remove('active'); navA.setAttribute('aria-selected','false'); }
      if(navU){ navU.classList.add('active'); navU.setAttribute('aria-selected','true'); }
      try{ if(window.UPDATES_CENTER && window.UPDATES_CENTER.render) window.UPDATES_CENTER.render(); }
      catch(err){ console.error('Updates render error:', err); }
    }else{
      body.classList.remove('insights-active');
      body.classList.remove('admin-active');
      body.classList.remove('updates-active');
      if(ins) ins.hidden = true;
      if(dash) dash.hidden = false;
      if(admin) admin.hidden = true;
      if(updates) updates.hidden = true;
      if(navD){ navD.classList.add('active'); navD.setAttribute('aria-selected','true'); }
      if(navI){ navI.classList.remove('active'); navI.setAttribute('aria-selected','false'); }
      if(navA){ navA.classList.remove('active'); navA.setAttribute('aria-selected','false'); }
      if(navU){ navU.classList.remove('active'); navU.setAttribute('aria-selected','false'); }
    }
  };

  // Re-render on resize (debounced) when active
  let resizeT = null;
  window.addEventListener('resize', ()=>{
    if(!document.body.classList.contains('insights-active')) return;
    clearTimeout(resizeT);
    resizeT = setTimeout(()=> { try{ renderMap(getDatasets()); }catch(e){} }, 180);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TRACE MODE ENGINE
  // ─────────────────────────────────────────────────────────────────────────
  // Builds a deterministic, evidence-only trace from a chosen source through
  // the available institutional records. Every hop is taken from data the
  // app already loaded (institutionMap, RG). When no further hop exists we
  // explicitly mark the endpoint as a 'trace stop in available records' —
  // we never invent unobserved downstream hops.

  function stopTraceAnimation(){
    if(state.trace.timer){
      clearTimeout(state.trace.timer);
      state.trace.timer = null;
    }
  }

  // Build all observed paths starting from a source foundation.
  // A path is: { source, l2, l2Kind, l3?, endUse?, amount, count, stoppedAt }
  function computeTracePaths(ds, sourceFoundation){
    const RG = ds.RG || {};
    const isAlsoGm = ds.isAlsoGrantmaker || (()=>false);
    const flowIndex = ds.moneyFlowIndex || {};
    const getGrantmakerKey = flowIndex.getGrantmakerKey || ((name)=>name);
    const rgKeyByName = (name) => {
      if(!name) return null;
      const keyed = getGrantmakerKey(name);
      if(keyed && RG[keyed]) return keyed;
      if(RG[name]) return name;
      const norm = flowNameNorm(name);
      return Object.keys(RG).find(k => flowNameNorm(k) === norm) || null;
    };
    const paths = [];
    const recList = (sourceFoundation.topRecipients || []).slice();
    // ensure intermediaries are surfaced even if outside top-N
    (sourceFoundation.intermediaryRecs || []).forEach(ir => {
      if(!recList.find(x => x.name === ir.name)) recList.push(ir);
    });
    recList.forEach(rec => {
      if(!rec || !rec.name) return;
      const interCls = classifyIntermediary(rec.name);
      const l2Kind = interCls
        ? (interCls.tier === 'confirmed' ? 'daf' : 'inter')
        : 'rec';
      const l2Amount = rec.total || 0;
      const l2Count  = rec.count || 0;

      // Try to expand downstream if L2 is also a grantmaker in available records
      const grantsKey = rgKeyByName(rec.name);
      const grants = grantsKey ? RG[grantsKey] : null;

      if(grants && Object.keys(grants).length){
        // For each downstream we have a row, emit a path with that L3.
        const downAgg = {};
        Object.keys(grants).forEach(downName => {
          const rows = grants[downName] || [];
          if(!downAgg[downName]) downAgg[downName] = { name:downName, total:0, count:0, subjAgg:{} };
          rows.forEach(row => {
            const amt = +row[1] || 0;
            downAgg[downName].total += amt;
            downAgg[downName].count += 1;
            const s = (row[3]||'').trim();
            if(s) downAgg[downName].subjAgg[s] = (downAgg[downName].subjAgg[s]||0) + amt;
          });
        });
        const downs = Object.values(downAgg).sort((a,b)=>b.total-a.total).slice(0, 6);
        downs.forEach(d => {
          const topSubj = Object.entries(d.subjAgg).sort((a,b)=>b[1]-a[1])[0];
          paths.push({
            source: sourceFoundation.name,
            l2: rec.name, l2Kind, l2InterLabel: interCls && interCls.label,
            l3: d.name, l3IsInter: !!classifyIntermediary(d.name),
            endUse: topSubj ? topSubj[0] : null,
            amount: d.total, count: d.count,
            stoppedAt: null
          });
        });
      } else {
        // No re-grant rows in dataset → trace stops at L2.
        // Try to mine end-use subject(s) directly from this source's grant rows to L2.
        const sourceGrantsKey = rgKeyByName(sourceFoundation.name);
        const sourceGrants = sourceGrantsKey ? (RG[sourceGrantsKey] || {}) : {};
        const recNorm = flowNameNorm(rec.name);
        const recRowsKey = Object.keys(sourceGrants).find(k => flowNameNorm(k) === recNorm);
        const recRows = recRowsKey ? sourceGrants[recRowsKey] || [] : [];
        const subjAgg = {};
        recRows.forEach(r => {
          const s = (r[3]||'').trim();
          if(s) subjAgg[s] = (subjAgg[s]||0) + (+r[1]||0);
        });
        const topSubj = Object.entries(subjAgg).sort((a,b)=>b[1]-a[1])[0];
        paths.push({
          source: sourceFoundation.name,
          l2: rec.name, l2Kind, l2InterLabel: interCls && interCls.label,
          l3: null, l3IsInter:false,
          endUse: topSubj ? topSubj[0] : null,
          amount: l2Amount, count: l2Count,
          // If the L2 is a known intermediary and re-grant rows aren't in the dataset,
          // mark the trace as stopping at L3 (downstream untraceable in records).
          // If L2 is a direct recipient, we still explicitly say the trace ends here.
          stoppedAt: interCls ? 'l3' : (topSubj ? null : 'l4')
        });
      }
    });
    paths.sort((a,b)=>b.amount-a.amount);
    return paths;
  }

  function startTrace(ds, sourceNode){
    stopTraceAnimation();
    const fdName = sourceNode.data && sourceNode.data.name;
    if(!fdName) return;
    const fObj = (ds.institutionMapAll||ds.institutionMap||[]).find(x => x.name.toLowerCase() === fdName.toLowerCase());
    if(!fObj) return;

    state.trace.sourceId   = sourceNode.id;
    state.trace.sourceName = fdName;
    state.trace.focusedL2  = null;
    state.trace.step = 1;
    state.trace.stoppedAt = null;
    state.trace.paths = computeTracePaths(ds, fObj);
    state.selectedNodeId = sourceNode.id;

    // Drive the visual animation on the SVG that's currently mounted.
    runTraceAnimation();
    renderTraceStepper();
    renderTraceDetail(ds);
  }

  function focusTraceBranch(ds, l2Node){
    if(!state.trace.sourceId || !state.trace.sourceName) return;
    state.trace.focusedL2 = l2Node.data && l2Node.data.name;
    state.selectedNodeId = l2Node.id;
    // Re-run animation focused on this branch (highlights paths through this L2).
    runTraceAnimation();
    renderTraceStepper();
    renderTraceDetail(ds);
  }

  // Walk the existing SVG and apply trace-* classes step-by-step.
  function runTraceAnimation(){
    stopTraceAnimation();
    const svg = document.getElementById('insSvg');
    if(!svg) return;
    const graph = state._lastGraph;
    if(!graph) return;
    const sourceId = state.trace.sourceId;
    const focusedL2 = state.trace.focusedL2;
    clearSelectedFlowHighlight(svg);

    // 1) Clear all trace classes.
    svg.querySelectorAll('.map-node').forEach(g => {
      g.classList.remove('trace-dim','trace-active','trace-source','trace-pulse','trace-reveal');
    });
    svg.querySelectorAll('.map-link').forEach(p => {
      p.classList.remove('trace-dim','trace-flow','trace-draw');
    });

    // 2) Determine reachable IDs from source through the graph.
    const reach = computeReachableIds(graph, sourceId, focusedL2);

    // 3) Dim all non-reachable nodes/links.
    svg.querySelectorAll('.map-node').forEach(g => {
      const id = g.getAttribute('data-id');
      if(!reach.nodes.has(id)) g.classList.add('trace-dim');
      else g.classList.add('trace-active');
    });
    svg.querySelectorAll('.map-link').forEach(p => {
      const s = p.getAttribute('data-source');
      const t = p.getAttribute('data-target');
      const inPath = reach.links.has(s+'|'+t);
      if(!inPath) p.classList.add('trace-dim');
    });

    // 4) Step 1 — pulse source. Then progressively reveal L2, L3, L4.
    const sourceEl = svg.querySelector(`.map-node[data-id="${cssEscape(sourceId)}"]`);
    if(sourceEl){
      sourceEl.classList.add('trace-source','trace-pulse');
    }

    const stepDelay = 700;
    const animateLinks = (predicate) => {
      // Activate links that match predicate (give them trace-flow).
      svg.querySelectorAll('.map-link').forEach(p => {
        const s = p.getAttribute('data-source');
        const t = p.getAttribute('data-target');
        if(predicate(s,t) && reach.links.has(s+'|'+t)){
          p.classList.remove('trace-dim');
          p.classList.add('trace-flow');
        }
      });
    };
    const revealNodes = (predicate) => {
      svg.querySelectorAll('.map-node').forEach(g => {
        const id = g.getAttribute('data-id');
        if(reach.nodes.has(id) && predicate(id)){
          g.classList.remove('trace-dim');
          g.classList.add('trace-active','trace-reveal');
        }
      });
    };

    // Step 2: source → L2
    state.trace.timer = setTimeout(() => {
      state.trace.step = 2;
      animateLinks((s,t) => s === sourceId && t.startsWith('l2:'));
      revealNodes(id => id.startsWith('l2:') && reach.nodes.has(id));
      renderTraceStepper();

      // Step 3: L2 → L3 (downstream)
      state.trace.timer = setTimeout(() => {
        state.trace.step = 3;
        animateLinks((s,t) => s.startsWith('l2:') && (t.startsWith('l3:') || t.startsWith('trace-stop:')));
        revealNodes(id => (id.startsWith('l3:') || id.startsWith('trace-stop:')) && reach.nodes.has(id));
        renderTraceStepper();

        // Step 4: end-use
        state.trace.timer = setTimeout(() => {
          state.trace.step = 4;
          animateLinks((s,t) => t.startsWith('enduse:') || t.startsWith('enduse-stop:'));
          revealNodes(id => (id.startsWith('enduse:') || id.startsWith('enduse-stop:')) && reach.nodes.has(id));
          // Determine whether the trace stopped before reaching end-use
          const hasL3   = [...reach.nodes].some(id => id.startsWith('l3:'));
          const hasEnd  = [...reach.nodes].some(id => id.startsWith('enduse:'));
          const hasStop = [...reach.nodes].some(id => id.startsWith('trace-stop:') || id.startsWith('enduse-stop:'));
          if(!hasEnd && hasStop) state.trace.stoppedAt = hasL3 ? 'l4' : 'l3';
          else state.trace.stoppedAt = null;
          renderTraceStepper();
          // Render the detail panel one more time so 'stoppedAt' is reflected.
          const ds = getDatasets();
          renderTraceDetail(ds);
          state.trace.timer = null;
        }, stepDelay);
      }, stepDelay);
    }, stepDelay);
  }

  // Walks the rendered graph forward from sourceId (optionally narrowed to focusedL2)
  // and returns reachable node IDs and link "source|target" keys.
  function computeReachableIds(graph, sourceId, focusedL2){
    const nodes = new Set();
    const links = new Set();
    if(!sourceId) return { nodes, links };
    nodes.add(sourceId);
    const linksBySource = {};
    graph.links.forEach(l => {
      if(!linksBySource[l.source]) linksBySource[l.source] = [];
      linksBySource[l.source].push(l);
    });
    const queue = [sourceId];
    while(queue.length){
      const cur = queue.shift();
      const outs = linksBySource[cur] || [];
      outs.forEach(l => {
        // If focusedL2 is set, only follow the L2 with that name (and its descendants).
        if(focusedL2 && cur === sourceId && typeof l.target === 'string' && l.target.startsWith('l2:')){
          const recName = l.target.slice(3);
          if(recName.toLowerCase() !== focusedL2.toLowerCase()) return;
        }
        links.add(l.source + '|' + l.target);
        if(!nodes.has(l.target)){
          nodes.add(l.target);
          queue.push(l.target);
        }
      });
    }
    return { nodes, links };
  }

  function renderTraceStepper(){
    const el = document.getElementById('insTraceStepper');
    if(!el) return;
    if(!state.trace.enabled || state.map !== 'institution'){
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    el.hidden = false;
    const labels = ['Source','Intermediary','Downstream','End-use'];
    const cur = state.trace.step;
    el.innerHTML = labels.map((lbl, i) => {
      const stepNum = i+1;
      const cls = stepNum < cur ? 'done' : (stepNum === cur ? 'current' : '');
      return `<span class="ins-trace-step ${cls}"><span class="num">${stepNum}</span>${escH(lbl)}</span>`
           + (i < labels.length-1 ? '<span class="arrow">→</span>' : '');
    }).join('');
  }

  // Detail panel — shown when Trace Mode is on but no source chosen yet.
  function renderTraceIntroDetail(ds){
    const root = document.getElementById('insDetail');
    if(!root) return;
    const sourceCount = ((ds && (ds.institutionMapAll || ds.institutionMap)) || []).length;
    root.innerHTML = `
      <div class="ins-trace-banner"><span class="pulse-dot"></span>Trace mode is on</div>
      <div class="ins-detail-eyebrow">Step 1 — pick a source</div>
      <div class="ins-detail-title">Follow the money through available records</div>
      <div class="ins-detail-explain">
        Click any source / grantmaker in column&nbsp;1 to begin a trace. The map will progressively reveal
        each hop — source → intermediary → downstream → end-use — using only relations present in the
        loaded dashboard records. Where the chain isn't in the data, the endpoint is marked
        <em>"Trace ends in available records"</em>. These markers are <strong>structural, not concealment</strong>;
        the original donor remains <strong>indeterminate</strong> for any flow routed through DAF sponsors,
        community foundations, federations, or fiscal sponsors.
      </div>
      <div class="ins-detail-stats">
        <div class="ins-stat"><div class="ins-stat-lbl">Source candidates</div><div class="ins-stat-val">${fmtN(sourceCount)}</div></div>
        <div class="ins-stat"><div class="ins-stat-lbl">Steps revealed</div><div class="ins-stat-val">4</div></div>
      </div>
      <div class="ins-detail-section">
        <div class="ins-detail-section-title">Tip</div>
        <div class="ins-list">
          <div class="ins-list-row"><span class="nm">While trace runs, click an L2 (DAF / intermediary / direct recipient)</span><span class="vl">focus that branch</span></div>
          <div class="ins-list-row"><span class="nm">Reset trace</span><span class="vl">restart picker</span></div>
          <div class="ins-list-row"><span class="nm">Exit trace</span><span class="vl">restore full graph</span></div>
        </div>
      </div>
    `;
  }

  function renderTraceDetail(ds){
    const root = document.getElementById('insDetail');
    if(!root) return;
    const sourceName = state.trace.sourceName;
    const focusedL2 = state.trace.focusedL2;
    if(!sourceName){ renderTraceIntroDetail(ds); return; }

    // Filter paths to focused L2 if applicable
    let paths = state.trace.paths.slice();
    if(focusedL2){
      paths = paths.filter(p => p.l2.toLowerCase() === focusedL2.toLowerCase());
    }

    // Compute summary stats from paths
    const totalDollars = paths.reduce((s,p)=>s + (p.amount||0), 0);
    const totalCount   = paths.reduce((s,p)=>s + (p.count||0), 0);
    const l2Set = new Set(paths.map(p => p.l2));
    // Count terminals: distinct L3 + endUse-only stops
    const terminalSet = new Set();
    paths.forEach(p => {
      if(p.l3) terminalSet.add('l3:'+p.l3);
      else if(p.endUse) terminalSet.add('e:'+p.l2+':'+p.endUse);
      else terminalSet.add('stop:'+p.l2);
    });
    const stops = paths.filter(p => p.stoppedAt).length;

    // Confidence language based on path mix
    const fObj = (ds.institutionMapAll||ds.institutionMap||[]).find(x => x.name.toLowerCase() === sourceName.toLowerCase());
    const sourceIsInter = fObj && fObj.intermediarySelf;
    let confidence = 'Direct — source confirmed';
    let confCls = 't1';
    if(sourceIsInter && sourceIsInter.tier === 'confirmed'){
      confidence = 'Intermediary source — donor indeterminate';
      confCls = 't3';
    } else if(sourceIsInter){
      confidence = 'Probable intermediary source — donor partially traceable';
      confCls = 't2';
    }

    const top5 = paths.slice(0, 5);
    const pathRowsHtml = top5.length ? top5.map(p => {
      const hops = [];
      hops.push(`<span class="hop">${escH(p.source)}</span>`);
      const l2Cls = p.l2Kind === 'daf' ? 'daf' : (p.l2Kind === 'inter' ? 'inter' : 'rec');
      hops.push('<span class="arrow">→</span>');
      hops.push(`<span class="hop ${l2Cls}" title="${escH(p.l2InterLabel||'')}">${escH(p.l2)}</span>`);
      if(p.l3){
        hops.push('<span class="arrow">→</span>');
        hops.push(`<span class="hop ${p.l3IsInter?'inter':'rec'}">${escH(p.l3)}</span>`);
      }
      if(p.endUse){
        hops.push('<span class="arrow">→</span>');
        hops.push(`<span class="hop" style="background:rgba(134,239,172,0.12);border-color:rgba(134,239,172,0.35);color:#bbf7d0;">${escH(p.endUse)}</span>`);
      } else if(p.stoppedAt){
        hops.push('<span class="arrow">→</span>');
        hops.push(`<span class="hop stop">Trace ends in available records</span>`);
      }
      return `<div class="ins-trace-path">
        <div class="hops">${hops.join('')}</div>
        <div class="meta"><span>${fmtN(p.count||0)} grant${(p.count||0)===1?'':'s'} observed</span><span class="amt">${fmt$(p.amount||0)}</span></div>
      </div>`;
    }).join('') : `<div class="ins-list-row"><span class="nm" style="color:var(--text-muted);font-style:italic;">No paths in available records for this branch.</span></div>`;

    const stopText = state.trace.stoppedAt === 'l3'
      ? 'For at least one branch, downstream re-grants are not in the records (intermediary). Trace ends in available records.'
      : (state.trace.stoppedAt === 'l4'
        ? 'No end-use subject rows for one or more branches. Trace ends in available records.'
        : null);

    root.innerHTML = `
      <div class="ins-trace-banner">
        <span class="pulse-dot"></span>Trace mode — ${escH(focusedL2 ? `branch: ${focusedL2}` : 'all branches from source')}
      </div>
      <div class="ins-detail-eyebrow">Tracing source</div>
      <div class="ins-detail-title">${escH(sourceName)}</div>
      <div class="ins-detail-flag ${confCls}"><span style="width:6px;height:6px;border-radius:50%;background:currentColor;"></span>${escH(confidence)}</div>
      <div class="ins-detail-explain">
        Showing the money flow that's <strong>traceable in the dashboard's loaded records</strong> from
        <em>${escH(sourceName)}</em>${focusedL2 ? ` through <em>${escH(focusedL2)}</em>` : ''}. Markers like
        <em>Confirmed DAF sponsor</em>, <em>Federation</em>, <em>Community foundation</em>, and <em>Probable intermediary</em>
        are <strong>structural observations</strong> based on name matching against a curated reference list — they
        flag patterns consistent with reduced donor-to-grantee traceability and <strong>do not imply concealment or wrongdoing</strong>.
        Where the chain isn't in the records, the trace stops and is labelled accordingly. Donor identity for
        intermediary-routed flows is <strong>indeterminate by design</strong> of public charity reporting.
      </div>
      <div class="ins-detail-stats">
        <div class="ins-stat"><div class="ins-stat-lbl">Total traced · visible</div><div class="ins-stat-val">${fmt$(totalDollars)}</div></div>
        <div class="ins-stat"><div class="ins-stat-lbl">Grants observed</div><div class="ins-stat-val">${fmtN(totalCount)}</div></div>
        <div class="ins-stat"><div class="ins-stat-lbl">Intermediary / direct nodes</div><div class="ins-stat-val">${fmtN(l2Set.size)}</div></div>
        <div class="ins-stat"><div class="ins-stat-lbl">Terminal recipients / end-use</div><div class="ins-stat-val">${fmtN(terminalSet.size)}</div></div>
      </div>
      ${stops > 0 || stopText ? `<div class="ins-detail-flag t2" style="margin:0 0 12px;"><span style="width:6px;height:6px;border-radius:50%;background:currentColor;"></span>${escH(stopText || `${stops} branch${stops===1?'':'es'} end in available records`)}</div>` : ''}
      <div class="ins-trace-actions">
        <button class="primary" id="insTraceReplay" data-testid="ins-trace-replay">Replay animation</button>
        ${focusedL2 ? '<button id="insTraceUnfocus" data-testid="ins-trace-unfocus">Show all branches</button>' : ''}
        <button id="insTraceShowAll" data-testid="ins-trace-showall">Show all (exit trace)</button>
      </div>
      <div class="ins-detail-section">
        <div class="ins-detail-section-title">Top traced paths · by dollars</div>
        <div class="ins-trace-paths">${pathRowsHtml}</div>
      </div>
      <div class="ins-detail-section">
        <div class="ins-detail-section-title">Method &amp; caveat</div>
        <div class="ins-list">
          <div class="ins-list-row"><span class="nm" style="white-space:normal;line-height:1.45;color:var(--text-muted);">Trace uses only observed grant rows — no unobserved hops are inferred. "Intermediary" is structural, evidence-based; original donor remains indeterminate where flows pass through DAF sponsors, federations, fiscal sponsors, or community foundations.</span></div>
        </div>
      </div>
    `;
    // Wire panel buttons
    const replay = document.getElementById('insTraceReplay');
    if(replay) replay.addEventListener('click', () => { runTraceAnimation(); });
    const unfocus = document.getElementById('insTraceUnfocus');
    if(unfocus) unfocus.addEventListener('click', () => {
      state.trace.focusedL2 = null;
      runTraceAnimation();
      renderTraceDetail(getDatasets());
    });
    const showAll = document.getElementById('insTraceShowAll');
    if(showAll) showAll.addEventListener('click', () => {
      stopTraceAnimation();
      state.trace.enabled = false;
      state.trace.sourceId = null; state.trace.sourceName = null;
      state.trace.focusedL2 = null; state.trace.step = 0; state.trace.paths = []; state.trace.stoppedAt = null;
      document.body.classList.remove('trace-mode');
      const ds = getDatasets();
      renderToolbar(ds);
      renderMap(ds);
      renderDetail(null);
    });
  }

  // Hook into dataLayer toggle if dashboard exposes it (best-effort)
  const _origSetDataLayer = window.setDataLayer;
  if(typeof _origSetDataLayer === 'function'){
    window.setDataLayer = function(layer){
      _origSetDataLayer.apply(this, arguments);
      window.invalidateInsightsCache();
    };
  }
})();
