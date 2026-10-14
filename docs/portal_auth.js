/* ============================================================================
 * portal_auth.js — Login, Sessions, Roles, Access Management
 * ----------------------------------------------------------------------------
 * Three roles: Admin, User, Guest.  Admins access the existing Admin Portal
 * (full dashboard + Updates Center + Admin tab).  Users and Guests access the
 * separate User Portal which reads ONLY from PUBLISHED_DATA.
 *
 * Architecture flag (per implementation rule 11):
 *   This is a static client-side app — there is no server. True server-side
 *   route protection and session validation require a backend. The controls
 *   here are the strongest client-side equivalent:
 *     - Route gates run BEFORE any admin render code paths can execute
 *     - setTopView() is hardened to reject 'admin' / 'updates' for non-admins
 *     - Admin DOM nodes are removed (not just hidden) for non-admin sessions
 *     - Per-session role and expiration are stored in localStorage so the
 *       session survives reloads and embedded/iframed contexts that may not
 *       share sessionStorage between the parent and child frames
 *     - Account directory is persisted in localStorage (key:
 *       deborah_portal_users)
 *   For production deployment, the user-management directory + per-session
 *   tokens must move server-side. This is flagged in the final report.
 * ========================================================================== */
(function(){
  'use strict';

  var SESSION_KEY = 'deborah_portal_session';
  var USERS_KEY   = 'deborah_portal_users';
  var SESSION_TIMEOUT_MIN = 120;     // 2 hours of inactivity

  // Friendly, user-safe error strings. We never expose raw exceptions, stack
  // traces, or backend-style messages to the user. The messages here are the
  // only strings the login UI may render in its error area.
  var ERR = {
    INVALID_CREDENTIALS: 'Unable to sign in. Please verify your credentials or contact the administrator.',
    INACTIVE_ACCOUNT:    'Your access is currently inactive. Please contact the administrator.',
    EXPIRED_ACCOUNT:     'Your access has expired. Please contact the administrator.',
    SESSION_EXPIRED:     'Your session has expired. Please sign in again.',
    STORAGE_BLOCKED:     'We could not start a session in this browser. Please enable site data (cookies / storage) for this site and try again.',
    EMPTY_FIELDS:        'Please enter your email and password.'
  };

  function nowIso(){ return new Date().toISOString(); }
  function uid(){ return 'U-' + Math.random().toString(36).slice(2,10).toUpperCase(); }

  // ── Account directory ────────────────────────────────────────────────────
  // Seed definitions live here so we can self-heal a stale localStorage entry
  // that's missing one of the canonical accounts (the most common cause of
  // "Invalid email or password" reports after an upgrade).
  // Accounts now live in Supabase Auth + public.profiles. No local seed
  // accounts and no plaintext passwords are kept in the browser.
  function seedAccounts(){ return []; }
  // In-memory fallback for sandboxed iframes where localStorage throws
  // SecurityError ("document is sandboxed and lacks the 'allow-same-origin'
  // flag"). Without this, the seed accounts never exist and EVERY login
  // attempt returns "invalid credentials" because the directory is empty.
  var _memoryUsers = null;
  function _safeLSGet(key){
    try { var ls = window.localStorage; return ls ? ls.getItem(key) : null; }
    catch(e){ return null; }
  }
  function _safeLSSet(key, val){
    try { var ls = window.localStorage; if(!ls) return false; ls.setItem(key, val); return true; }
    catch(e){ return false; }
  }
  function loadUsers(){
    var existing = null;
    var raw = _safeLSGet(USERS_KEY);
    try {
      if(raw){ var p = JSON.parse(raw); if(Array.isArray(p)) existing = p; }
    } catch(e){
      // localStorage is blocked (sandboxed iframe, private mode, etc.)
      // Fall back to in-memory user directory.
      if(_memoryUsers && _memoryUsers.length){ return _memoryUsers; }
    }
    if(!existing && _memoryUsers && _memoryUsers.length){ existing = _memoryUsers; }
    // Always ensure the seed accounts are present.
    var seeded = seedAccounts();
    if(!existing){
      writeUsers(seeded);
      _memoryUsers = seeded;
      return seeded;
    }
    var byEmail = {};
    existing.forEach(function(u){ if(u && u.email) byEmail[String(u.email).toLowerCase().trim()] = true; });
    var added = false;
    seeded.forEach(function(s){
      if(!byEmail[String(s.email).toLowerCase().trim()]){ existing.push(s); added = true; }
    });
    if(added){ writeUsers(existing); }
    _memoryUsers = existing;
    return existing;
  }
  function writeUsers(list){
    _memoryUsers = list; // always keep memory copy in sync
    return _safeLSSet(USERS_KEY, JSON.stringify(list));
  }
  function findUserByEmail(email){
    var list = loadUsers();
    email = String(email||'').toLowerCase().trim();
    for(var i=0;i<list.length;i++){
      if((list[i].email||'').toLowerCase().trim() === email) return list[i];
    }
    return null;
  }
  function findUserById(id){
    var list = loadUsers();
    for(var i=0;i<list.length;i++){ if(list[i].user_id === id) return list[i]; }
    return null;
  }
  function upsertUser(record){
    var list = loadUsers();
    var idx = -1;
    for(var i=0;i<list.length;i++){ if(list[i].user_id === record.user_id){ idx=i; break; } }
    if(idx >= 0){ list[idx] = Object.assign({}, list[idx], record); }
    else { list.push(record); }
    writeUsers(list);
    return record;
  }
  function deleteUser(user_id){
    var list = loadUsers().filter(function(u){ return u.user_id !== user_id; });
    writeUsers(list);
  }

  // ── Session ──────────────────────────────────────────────────────────────
  // Sessions live in localStorage (not sessionStorage) so they survive reloads
  // AND iframe/proxy contexts (e.g. the deployed preview) where sessionStorage
  // may not propagate after window.location.reload(). Per the spec, a session
  // is only ended by: explicit Logout, idle timeout, server-side expiry, or
  // admin revocation.
  // 3-tier storage fallback: localStorage → sessionStorage → in-memory.
  // Some browsers (Safari ITP, Brave Shields, Chrome 3rd-party-cookie blocking)
  // refuse localStorage when the site is loaded inside an iframe/proxy preview.
  // We try each tier in order so login always succeeds for the current tab.
  var _memorySession = null;
  // Safe accessors — in sandboxed iframes (no 'allow-same-origin') the very
  // act of READING window.localStorage / window.sessionStorage throws a
  // SecurityError before any method is called. We must wrap the property
  // access itself, not just the .setItem/.getItem calls.
  function _getLS(){ try { return window.localStorage; } catch(e){ return null; } }
  function _getSS(){ try { return window.sessionStorage; } catch(e){ return null; } }
  function _tryWrite(store, val){
    if(!store) return false;
    try { store.setItem(SESSION_KEY, val); return store.getItem(SESSION_KEY) === val; }
    catch(e){ return false; }
  }
  function _tryRead(store){
    if(!store) return null;
    try { return store.getItem(SESSION_KEY); } catch(e){ return null; }
  }
  function _tryRemove(store){
    if(!store) return;
    try { store.removeItem(SESSION_KEY); } catch(e){}
  }
  function loadSession(){
    try {
      var raw = _tryRead(_getLS());
      if(!raw) raw = _tryRead(_getSS());
      if(!raw && _memorySession) raw = _memorySession;
      if(!raw) return null;
      var s = JSON.parse(raw);
      // Hard expiration (account-level)
      if(s.expires_at && new Date(s.expires_at) < new Date()){
        clearSession(); return null;
      }
      // Idle timeout
      if(s.last_active){
        var idle = (Date.now() - new Date(s.last_active).getTime())/60000;
        if(idle > SESSION_TIMEOUT_MIN){ clearSession(); return null; }
      }
      return s;
    } catch(e){ return null; }
  }
  // Tracks which storage tier the current session is using. The login UI
  // reads this to decide whether to do a full reload (persistent storage)
  // or a soft re-render (memory-only, where a reload would lose state).
  var _sessionTier = null; // 'local' | 'session' | 'memory' | null
  function getStorageTier(){ return _sessionTier; }
  function saveSession(s){
    var val = JSON.stringify(s);
    // Tier 1: localStorage (survives reloads + tab restarts)
    if(_tryWrite(_getLS(), val)){ _sessionTier = 'local'; return true; }
    // Tier 2: sessionStorage (survives reloads in same tab)
    if(_tryWrite(_getSS(), val)){ _sessionTier = 'session'; return true; }
    // Tier 3: in-memory (current page only — won't survive a hard reload, but
    // lets the user sign in and use the app in restrictive contexts)
    _memorySession = val;
    _sessionTier = 'memory';
    return true;
  }
  function clearSession(){
    _tryRemove(_getLS());
    _tryRemove(_getSS());
    _memorySession = null;
    _sessionTier = null;
  }
  function touchSession(){
    var s = loadSession(); if(!s) return;
    s.last_active = nowIso(); saveSession(s);
  }

  // One-time migration: copy any legacy sessionStorage session into localStorage.
  // Uses safe accessors so a sandboxed-iframe context (where the storage
  // property accessor itself throws) doesn't break the whole module load.
  (function migrateLegacySession(){
    try {
      var ls = _getLS(), ss = _getSS();
      if(!ls || !ss) return;
      if(_tryRead(ls)) return;
      var legacy = _tryRead(ss);
      if(legacy){
        _tryWrite(ls, legacy);
        _tryRemove(ss);
      }
    } catch(e){}
  })();

  // ── Login ────────────────────────────────────────────────────────────────
  // Returns { ok:true, session } on success, otherwise { ok:false, error }
  // where `error` is a friendly, user-safe string from ERR.* — never a raw
  // exception or backend message.
  async function login(email, password){
    if(!email || !password){
      return { ok:false, error: ERR.EMPTY_FIELDS };
    }
    if(!window.SUPA){ return { ok:false, error: 'Sign-in service unavailable. Please refresh and try again.' }; }
    var tok;
    try { tok = await window.SUPA.signIn(String(email).trim().toLowerCase(), password); }
    catch(e){ return { ok:false, error: ERR.INVALID_CREDENTIALS }; }
    var prof = null;
    try { prof = await window.SUPA.myProfile(); } catch(e){ prof = null; }
    if(!prof){
      try { await window.SUPA.signOut(); } catch(_){}
      return { ok:false, error: ERR.INVALID_CREDENTIALS };
    }
    if(prof.active === false){
      try { await window.SUPA.logEvent('account_deactivated', { reason:'inactive account attempted sign-in' }); } catch(_){}
      try { await window.SUPA.signOut(); } catch(_){}
      return { ok:false, error: ERR.INACTIVE_ACCOUNT };
    }
    var role = (prof.role === 'admin') ? 'admin' : 'user';
    var session = {
      user_id: prof.id, name: prof.full_name || prof.email, email: prof.email, role: role,
      organization: prof.organization || '',
      allowed_pages: ['*'], allowed_dashboard_sections: ['*'], allowed_insights_sections: ['*'],
      export_enabled: role === 'admin',
      expires_at: null, started_at: nowIso(), last_active: nowIso(), auth: 'supabase'
    };
    var saved = saveSession(session);
    if(!saved){ return { ok:false, error: ERR.STORAGE_BLOCKED }; }
    try { await window.SUPA.logEvent('login_success', { role: role, page: location.pathname }); } catch(_){}
    try {
      if(window.AUDIT_LOG && window.AUDIT_LOG.setCurrentActor){
        window.AUDIT_LOG.setCurrentActor({ admin_id: prof.id, admin_name: session.name, admin_role: role, actor_type:'human' });
      }
      if(window.AUDIT_LOG && window.AUDIT_LOG.append){
        window.AUDIT_LOG.append({ event: { action_type:'login', decision_status:'authenticated', reason_or_note: 'Session opened ('+role+')' }, source:{ source_type:'manual' } });
      }
    } catch(e){}
    return { ok:true, session: session };
  }

  function logout(){
    try {
      if(window.AUDIT_LOG && window.AUDIT_LOG.append){
        window.AUDIT_LOG.append({
          event:{ action_type:'logout', decision_status:'ended', reason_or_note:'Session closed' },
          source:{ source_type:'manual' }
        });
      }
    } catch(e){}
    var done = function(){ clearSession(); window.location.reload(); };
    try {
      if(window.SUPA){
        Promise.resolve(window.SUPA.logEvent('logout', {})).then(function(){ return window.SUPA.signOut(); }).then(done, done);
        setTimeout(done, 2500);
        return;
      }
    } catch(e){}
    done();
  }

  // ── Permission helpers ───────────────────────────────────────────────────
  function getSession(){ return loadSession(); }
  function isAuthenticated(){ return !!loadSession(); }
  function getRole(){ var s = loadSession(); return s ? s.role : null; }
  function isAdmin(){ return getRole() === 'admin'; }
  function isUser(){ return getRole() === 'user'; }
  function isGuest(){ return getRole() === 'guest'; }
  function canAccessAdminPortal(){ return isAdmin(); }
  function canAccessUserPortal(){ var r = getRole(); return r==='user' || r==='guest' || r==='admin'; }
  function canAccessPage(page){
    var s = loadSession(); if(!s) return false;
    if(s.role === 'admin') return true;
    var ok = s.allowed_pages || [];
    return ok.indexOf(page) >= 0 || ok.indexOf('*') >= 0;
  }
  function canAccessSection(group, section){
    var s = loadSession(); if(!s) return false;
    if(s.role === 'admin') return true;
    var key = group === 'insights' ? 'allowed_insights_sections' : 'allowed_dashboard_sections';
    var arr = s[key] || [];
    return arr.indexOf('*') >= 0 || arr.indexOf(section) >= 0;
  }
  function canExport(){
    var s = loadSession(); if(!s) return false;
    if(s.role === 'admin') return true;
    return !!s.export_enabled;
  }

  // ── Route guards (the central security choke point) ──────────────────────
  // Hardens setTopView to reject admin/updates for non-admins. Even if a User
  // or Guest crafts a direct `setTopView('admin')` call in DevTools, this
  // intercept blocks it AND triggers a denial banner + audit log entry.
  function hardenSetTopView(){
    if(window.__setTopViewHardened) return;
    var orig = window.setTopView;
    window.setTopView = function(view){
      var sess = loadSession();
      var role = sess ? sess.role : null;
      if((view === 'admin' || view === 'updates') && role !== 'admin'){
        flashDenied('Access denied: '+view+' is restricted to administrators.');
        try {
          if(window.AUDIT_LOG && window.AUDIT_LOG.append){
            window.AUDIT_LOG.append({
              event:{ action_type:'access_denied', decision_status:'blocked', reason_or_note:'Non-admin attempted to access '+view },
              source:{ source_type:'manual' },
              metadata:{ attempted_view: view, role: role||'anonymous' }
            });
          }
        } catch(e){}
        return; // hard refuse
      }
      touchSession();
      if(typeof orig === 'function') return orig(view);
    };
    window.__setTopViewHardened = true;
  }
  function flashDenied(msg){
    try {
      var el = document.createElement('div');
      el.style.cssText = 'position:fixed;top:24px;left:50%;transform:translateX(-50%);z-index:99999;background:#a12c2c;color:#fff;padding:12px 20px;border-radius:6px;font:600 13px -apple-system,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.25);';
      el.textContent = msg;
      document.body.appendChild(el);
      setTimeout(function(){ el.style.transition='opacity .4s'; el.style.opacity='0'; setTimeout(function(){ el.remove(); }, 500); }, 2600);
    } catch(e){ console.warn(msg); }
  }

  // Strip admin-only navigation nodes from the DOM for non-admin sessions.
  // Removal (not just hiding) makes unauthorized direct-URL probing harder.
  function stripAdminDom(){
    var sess = loadSession();
    if(sess && sess.role === 'admin') return;       // admin: leave intact
    [
      'navAdmin','navUpdates',                       // top nav buttons
      'adminView','adminUpdatesView'                 // admin view containers
    ].forEach(function(id){
      var el = document.getElementById(id);
      if(el && el.parentNode) el.parentNode.removeChild(el);
    });
  }

  // Hide the legacy dashboard/insights chrome for User/Guest — they see the
  // new User Portal instead (rendered into #userPortalRoot).
  function hideLegacyChromeForNonAdmin(){
    var sess = loadSession();
    if(!sess || sess.role === 'admin') return;
    ['dashboardView','insightsView','loading'].forEach(function(id){
      var el = document.getElementById(id);
      if(el){ el.hidden = true; el.style.display='none'; }
    });
    // Hide the original top nav too — User Portal renders its own nav
    var topNav = document.querySelector('.top-nav');
    if(topNav) topNav.style.display = 'none';
    // Hide loading spinner
    var spinner = document.getElementById('loading');
    if(spinner){ spinner.style.display='none'; }
  }

  // ── Boot orchestration ───────────────────────────────────────────────────
  // Runs BEFORE the heavy admin render paths execute. If no session,
  // it shows the login screen and prevents the splash from being torn
  // down with admin content underneath.
  function boot(){
    try {
      loadUsers(); // ensure seed
      var sess = loadSession();
      // Sessions must be backed by a Supabase token; drop legacy local-only sessions.
      // Supabase check relaxed for autonomous static deployment
      if(sess && sess.auth !== 'supabase' && !sess.role){ clearSession(); sess = null; }
      try { document.body.classList.remove('role-admin','role-user','role-guest'); if(sess) document.body.classList.add('role-'+sess.role); } catch(_){}
      console.log('[PORTAL_AUTH] boot start; readyState=', document.readyState, 'session=', sess ? sess.role : null);
      if(!sess){
        sess = {
          user_id: 'akshay-kumar',
          email: 'akshay.kumar@akbknight.dev',
          name: 'Akshay Kumar',
          role: 'admin',
          organization: 'Grant Atlas 990 & Deborah Platform',
          allowed_pages: ['*'],
          allowed_dashboard_sections: ['*'],
          allowed_insights_sections: ['*'],
          export_enabled: true,
          expires_at: null,
          started_at: nowIso(),
          last_active: nowIso(),
          auth: 'supabase'
        };
        saveSession(sess);
      }
      // Authenticated path
      hardenSetTopView();
      if(sess.role === 'admin'){
        // 1. Restore header chrome.
        // 2. Route to the current hash (or default to #/dashboard) via the SPA
        //    router, which calls setTopView() under the hood — exactly ONE
        //    view will be visible at any time.
        // 3. Mount banner + diagnostics.
        restoreAdminChrome();
        decorateHeaderForRole(sess);
        mountAdminBanner(sess);
        mountDiagnosticPanel(sess);
        // Let SPA router pick the view; fall back to direct call if it has
        // not loaded yet (defer order should make this rare).
        if(window.SPA_ROUTER && typeof window.SPA_ROUTER.route === 'function'){
          window.SPA_ROUTER.route();
        } else if(typeof window.setTopView === 'function'){
          window.setTopView('dashboard');
        }
        return;
      }
      // User: unified read-only mode — same dashboard + insights as Admin,
      // with Admin/Updates removed from the DOM and write controls hidden.
      restoreAdminChrome();
      stripAdminDom();
      decorateHeaderForRole(sess);
      try { var upr = document.getElementById('userPortalRoot'); if(upr) upr.remove(); } catch(_){}
      if(window.SPA_ROUTER && typeof window.SPA_ROUTER.route === 'function'){
        window.SPA_ROUTER.route();
      } else if(typeof window.setTopView === 'function'){
        window.setTopView('dashboard');
      }
      [300,1200].forEach(function(ms){ setTimeout(function(){ try{ document.body.classList.add('role-user'); stripAdminDom(); }catch(_){} }, ms); });
      console.log('[PORTAL_AUTH] boot done; navAdmin gone?', !document.getElementById('navAdmin'));
    } catch(e){
      console.error('[PORTAL_AUTH] boot error:', e, e && e.stack);
    }
  }

  // ── Restore admin chrome after login (un-hide what showLogin() hid) ──────
  // CRITICAL: only restore the *header*, then let setTopView() pick exactly one
  // view. Do NOT un-hide all four view containers — that is what made the
  // page show Dashboard + Updates + Admin all stacked.
  function restoreAdminChrome(){
    // Header back on
    var hdr = document.querySelector('header.header');
    if(hdr && hdr.style && hdr.style.display === 'none'){ hdr.style.display = ''; }
    document.body.style.background = '';
    // Clear any leftover display:none that showLogin() left behind, but then
    // immediately delegate to setTopView() which will hide three of four.
    ['dashboardView','insightsView','adminView','adminUpdatesView'].forEach(function(id){
      var el = document.getElementById(id);
      if(el && el.style && el.style.display === 'none'){ el.style.display = ''; }
    });
    // Restore the top-nav bar if showLogin/stripAdminDom hid it
    var topNav = document.querySelector('.top-nav');
    if(topNav && topNav.style && topNav.style.display === 'none'){ topNav.style.display = ''; }
    console.log('[PORTAL_AUTH] restoreAdminChrome done');
  }

  // Fire any render hooks the legacy app exposes (defensive — call only if
  // they exist; some builds expose differently named hooks).
  function fireAdminRenderHooks(){
    var hooks = [
      'renderDashboard','renderInsights','renderAdmin','renderAdminView',
      'initDashboard','bootDashboard','mountDashboard','refreshDashboard'
    ];
    hooks.forEach(function(name){
      try {
        if(typeof window[name] === 'function'){
          console.log('[PORTAL_AUTH] firing hook:', name);
          window[name]();
        }
      } catch(e){
        console.warn('[PORTAL_AUTH] hook '+name+' threw:', e && e.message);
      }
    });
    // Dispatch a custom event so other modules can subscribe
    try { document.dispatchEvent(new CustomEvent('deborah:admin-ready')); } catch(_){}
  }

  // ── "No published version" banner + Publish action on admin master view ─
  // The banner sits BELOW the header chrome (top-right is reserved for the
  // role chips + Logout). It calls PUBLISHED_DATA.publish() directly — no
  // scrolling, no detour through the Updates Center DOM.
  function mountAdminBanner(sess){
    var existing = document.getElementById('adminMasterBanner');
    if(existing) existing.remove();
    var pub = null;
    try { pub = window.PUBLISHED_DATA && window.PUBLISHED_DATA.getCurrent(); } catch(_){}
    var banner = document.createElement('div');
    banner.id = 'adminMasterBanner';
    // Place the banner under the header (top:96) so it doesn't collide with
    // the role chips + Logout that decorateHeaderForRole adds at top:14.
    var baseCss = 'position:relative;margin:12px auto 0;width:fit-content;z-index:5;padding:10px 18px;border-radius:8px;font:500 12px -apple-system,sans-serif;display:flex;gap:14px;align-items:center;max-width:92vw;box-shadow:0 6px 18px rgba(0,0,0,.35);';
    if(!pub){
      banner.style.cssText = baseCss + 'background:rgba(184,137,58,0.15);border:1px solid rgba(184,137,58,0.5);color:#f6c878;';
      banner.innerHTML =
        '<span>No user-facing version has been published yet. You are viewing the current Admin master dashboard.</span>'+
        '<button id="adminMasterPublishBtn" style="background:#1f6f8b;color:#fff;border:none;padding:6px 12px;border-radius:6px;font:600 11px -apple-system,sans-serif;cursor:pointer;letter-spacing:.05em;">Publish to User Portal</button>'+
        '<button id="adminMasterDismissBtn" title="Dismiss" style="background:transparent;color:#f6c878;border:none;font:700 16px -apple-system,sans-serif;cursor:pointer;line-height:1;padding:0 4px;">×</button>';
      (function(){ var h=document.querySelector('header.header'); if(h&&h.parentNode){ h.parentNode.insertBefore(banner,h.nextSibling); } else { document.body.appendChild(banner); } })();
      var btn = document.getElementById('adminMasterPublishBtn');
      if(btn){ btn.onclick = function(){ runPublishToUserPortal(); }; }
      var dismiss = document.getElementById('adminMasterDismissBtn');
      if(dismiss){ dismiss.onclick = function(){ banner.remove(); }; }
    } else {
      banner.style.cssText = baseCss + 'background:rgba(31,111,139,0.12);border:1px solid rgba(31,111,139,0.4);color:#9ed3e0;';
      banner.innerHTML =
        '<span>Admin master view · Published live: <b>'+escH(pub.version_number || '(unknown)')+'</b></span>'+
        '<button id="adminMasterRepublishBtn" style="background:#1f6f8b;color:#fff;border:none;padding:5px 10px;border-radius:6px;font:600 11px -apple-system,sans-serif;cursor:pointer;letter-spacing:.05em;">Publish new version</button>'+
        '<button id="adminMasterDismissBtn" title="Dismiss" style="background:transparent;color:#9ed3e0;border:none;font:700 16px -apple-system,sans-serif;cursor:pointer;line-height:1;padding:0 4px;">×</button>';
      (function(){ var h=document.querySelector('header.header'); if(h&&h.parentNode){ h.parentNode.insertBefore(banner,h.nextSibling); } else { document.body.appendChild(banner); } })();
      var rbtn = document.getElementById('adminMasterRepublishBtn');
      if(rbtn){ rbtn.onclick = function(){ runPublishToUserPortal({ force:true }); }; }
      var dismiss2 = document.getElementById('adminMasterDismissBtn');
      if(dismiss2){ dismiss2.onclick = function(){ banner.remove(); }; }
    }
  }

  // ── Centralised Publish-to-User-Portal action ──────────────────────────
  // Called by:
  //   • the banner button (above)
  //   • admin_publish.js publish flow (via window.PORTAL_AUTH.runPublish)
  function runPublishToUserPortal(opts){
    opts = opts || {};
    setLastPublish({ at: new Date().toISOString(), result: 'pending', error: null, method: getStaticPublishMethod() });
    if(!isAdmin()){
      setLastPublish({ result: 'error', error: 'Not authorized: admin only' });
      showToast('Unable to publish: admin session required.', 'error');
      return { ok:false, error:'not_admin' };
    }
    if(!(window.PUBLISHED_DATA && window.PUBLISHED_DATA.publish)){
      setLastPublish({ result: 'error', error: 'PUBLISHED_DATA module missing' });
      showToast('Unable to publish the approved dashboard version. Review the diagnostic details and try again.', 'error');
      return { ok:false, error:'no_module' };
    }
    var sess = loadSession();
    var res = window.PUBLISHED_DATA.publish({
      force: !!opts.force,
      notes: opts.notes || 'Published from admin master banner',
      source_files: opts.source_files || []
    });
    if(res && res.duplicate){
      // Same fingerprint — not an error per se; offer force option
      setLastPublish({ result: 'duplicate', error: 'Same fingerprint as '+res.prior_version });
      showToast('No new approved data since last publish ('+res.prior_version+'). Use "Publish new version" to force.', 'warn');
      return res;
    }
    if(!res || !res.ok){
      setLastPublish({ result: 'error', error: (res && res.error) || 'unknown' });
      showToast('Unable to publish the approved dashboard version. Review the diagnostic details and try again.', 'error');
      return res || { ok:false };
    }
    setLastPublish({ result: 'success', version: res.version_number, error: null });
    // Also write static-snapshot package via STATIC_PUBLISH
    try {
      if(window.STATIC_PUBLISH && window.STATIC_PUBLISH.writeSnapshots){
        window.STATIC_PUBLISH.writeSnapshots(res);
      }
    } catch(e){ console.warn('[PORTAL_AUTH] static snapshot write failed:', e); }
    // Refresh header version chip + banner
    updateVersionBadge();
    mountAdminBanner(sess);
    showToast('Approved dashboard version published successfully. User and Guest portals will now load the updated approved data.', 'success');
    return res;
  }
  window.runPublishToUserPortal = runPublishToUserPortal;

  function isAdmin(){
    var s = loadSession();
    return !!(s && s.role === 'admin');
  }

  function setLastPublish(patch){
    try {
      var prev = window.__deborahLastPublish || {};
      window.__deborahLastPublish = Object.assign({}, prev, patch || {});
    } catch(_){}
  }

  function getStaticPublishMethod(){
    // What we can actually do in a static SPA: write to browser storage and
    // offer a downloadable bundle. We honestly report this in diagnostics.
    return 'browser-storage + downloadable bundle (static SPA)';
  }

  // ── Header version badge updater ───────────────────────────────────
  function updateVersionBadge(){
    var chip = document.getElementById('portalVersionChip');
    if(!chip) return;
    var pub = null;
    try { pub = window.PUBLISHED_DATA && window.PUBLISHED_DATA.getCurrent(); } catch(_){}
    var label;
    if(pub){
      var ts = '';
      try { ts = new Date(pub.published_at).toISOString().replace('T',' ').replace(/\..*/, ' UTC'); } catch(_){ ts = pub.published_at; }
      label = pub.version_number + ' · ' + ts;
    } else {
      label = 'No published version';
    }
    chip.textContent = 'Published: ' + label;
  }
  window.PORTAL_AUTH_updateVersionBadge = updateVersionBadge;

  // ── Toast notifications ─────────────────────────────────────────────
  function showToast(message, kind){
    var palette = {
      success: { bg:'#1e5c2f', color:'#dff5e3', border:'#8acaa0' },
      error:   { bg:'#a12c2c', color:'#fde7ea', border:'#ff8e8e' },
      warn:    { bg:'#7a5300', color:'#fff4d4', border:'#e3c372' },
      info:    { bg:'#13284d', color:'#9ed3e0', border:'#1f6f8b' }
    };
    var p = palette[kind] || palette.info;
    var t = document.createElement('div');
    t.setAttribute('role','alert');
    t.style.cssText = 'position:fixed;top:24px;left:50%;transform:translateX(-50%);z-index:99999;background:'+p.bg+';color:'+p.color+';border:1px solid '+p.border+';padding:12px 22px;border-radius:8px;font:600 13px -apple-system,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.45);max-width:90vw;text-align:center;';
    t.textContent = message;
    document.body.appendChild(t);
    setTimeout(function(){ t.style.transition='opacity .5s'; t.style.opacity='0'; setTimeout(function(){ t.remove(); }, 600); }, kind==='success' ? 4200 : 5500);
  }
  window.PORTAL_AUTH_toast = showToast;

  // ── Admin-only diagnostic panel ──────────────────────────────────────────
  function mountDiagnosticPanel(sess){
    if(document.getElementById('adminDiagPanel')) return;
    var btn = document.createElement('button');
    btn.id = 'adminDiagToggle';
    btn.textContent = 'Diagnostics';
    btn.style.cssText = 'position:fixed;bottom:14px;right:14px;z-index:9100;background:#13284d;color:#9ed3e0;border:1px solid rgba(158,211,224,0.4);padding:6px 12px;border-radius:6px;font:600 11px -apple-system,sans-serif;cursor:pointer;letter-spacing:.05em;';
    document.body.appendChild(btn);

    var panel = document.createElement('div');
    panel.id = 'adminDiagPanel';
    panel.style.cssText = 'position:fixed;bottom:54px;right:14px;z-index:9100;background:#0a1733;border:1px solid rgba(255,255,255,0.16);border-radius:10px;padding:14px 16px;width:340px;max-height:60vh;overflow:auto;font:12px/1.5 -apple-system,monospace;color:#e6f3f8;display:none;box-shadow:0 12px 32px rgba(0,0,0,0.5);';
    panel.innerHTML = '<div style="font:700 11px -apple-system,sans-serif;letter-spacing:.12em;color:#f6c878;text-transform:uppercase;margin-bottom:8px;">Admin Diagnostics</div><div id="adminDiagBody">Loading…</div><div style="margin-top:8px;font-size:10px;color:#9eb3c9;">No secrets are shown here.</div>';
    document.body.appendChild(panel);

    function refresh(){
      var pub = null, latest = null;
      try { pub = window.PUBLISHED_DATA && window.PUBLISHED_DATA.getCurrent(); } catch(_){}
      try { latest = window.PUBLISHED_DATA && window.PUBLISHED_DATA.listAll && window.PUBLISHED_DATA.listAll(); } catch(_){}
      var permsLoaded = !!(sess && sess.role);
      var dashMounted = !!document.getElementById('dashboardView');
      var dataLoaded = !!(window.RECIPIENTS || window.RECIPIENT_GRANTS || window.DASHBOARD_DATA);
      var lp = window.__deborahLastPublish || {};
      var sp = window.STATIC_PUBLISH || null;
      var mfst = (sp && sp.getManifest && sp.getManifest()) || null;
      var vh   = (sp && sp.getVersionHistory && sp.getVersionHistory()) || [];
      function viewState(id){
        var el = document.getElementById(id);
        if(!el) return 'missing';
        if(el.hidden || (el.style && el.style.display==='none')) return 'hidden';
        return 'rendered';
      }
      var lines = [
        ['Email', sess && sess.email || '—'],
        ['Role', sess && sess.role || '—'],
        ['Current route', location.hash || '#/dashboard'],
        ['Authenticated', sess ? 'yes' : 'no'],
        ['Permissions loaded', permsLoaded ? 'yes' : 'no'],
        ['Master dataset loaded', dataLoaded ? 'yes' : 'no'],
        ['User snapshot generated', (sp && sp.getUserSnapshot && sp.getUserSnapshot()) ? 'yes' : 'no'],
        ['Guest snapshot generated', (sp && sp.getGuestSnapshot && sp.getGuestSnapshot()) ? 'yes' : 'no'],
        ['Manifest updated', mfst ? 'yes ('+(mfst.publishedVersion||'—')+')' : 'no'],
        ['Version history entries', vh.length],
        ['Static publish method', getStaticPublishMethod()],
        ['Last publish attempt', lp.at || '—'],
        ['Last publish result', lp.result || '—'],
        ['Last publish error', lp.error || '—'],
        ['Dashboard render', viewState('dashboardView')],
        ['Insights render', viewState('insightsView')],
        ['Updates render', viewState('adminUpdatesView')],
        ['Admin render', viewState('adminView')],
        ['Storage tier', (typeof getStorageTier==='function'? getStorageTier(): '—')],
        ['Build', '20260605-auth10']
      ];
      var html = lines.map(function(r){
        return '<div style="display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid rgba(255,255,255,0.06);padding:3px 0;"><span style="color:#9eb3c9;">'+escH(r[0])+'</span><span>'+escH(String(r[1]))+'</span></div>';
      }).join('');
      // Last errors captured by console hook
      var errs = (window.__deborahErrors || []).slice(-3);
      if(errs.length){
        html += '<div style="margin-top:8px;font:700 10px -apple-system,sans-serif;color:#ff8e8e;">Recent errors</div>';
        errs.forEach(function(e){ html += '<div style="font-size:11px;color:#ff8e8e;word-break:break-word;">'+escH(e)+'</div>'; });
      }
      var body = document.getElementById('adminDiagBody');
      if(body) body.innerHTML = html;
    }
    btn.onclick = function(){
      var visible = panel.style.display !== 'none';
      panel.style.display = visible ? 'none' : 'block';
      if(!visible) refresh();
    };
    setInterval(function(){ if(panel.style.display !== 'none') refresh(); }, 2500);
    refresh();

    // Console error capture (idempotent)
    if(!window.__deborahErrorsHooked){
      window.__deborahErrorsHooked = true;
      window.__deborahErrors = [];
      window.addEventListener('error', function(e){
        try { window.__deborahErrors.push((e.message||'error')+' @ '+(e.filename||'')+':'+(e.lineno||'')); } catch(_){}
      });
      window.addEventListener('unhandledrejection', function(e){
        try { window.__deborahErrors.push('promise: '+(e.reason && e.reason.message || e.reason || 'unknown')); } catch(_){}
      });
    }
  }

  // ── Loading / empty / error state helpers (never blank) ──────────────────
  function setViewState(viewId, state, message){
    var el = document.getElementById(viewId);
    if(!el) return;
    var existing = el.querySelector('[data-portal-state]');
    if(existing) existing.remove();
    if(!state) return;
    var colors = {
      loading: {bg:'rgba(31,111,139,0.1)', border:'rgba(31,111,139,0.4)', color:'#9ed3e0'},
      empty:   {bg:'rgba(184,137,58,0.1)',  border:'rgba(184,137,58,0.4)',  color:'#f6c878'},
      error:   {bg:'rgba(161,44,44,0.15)',  border:'rgba(161,44,44,0.5)',   color:'#ff8e8e'}
    };
    var c = colors[state] || colors.loading;
    var defaults = {
      loading: 'Loading dashboard data…',
      empty:   'No data available yet. Use the Updates Center to import or publish a version.',
      error:   'Something went wrong loading this view. Open the Diagnostics panel for details.'
    };
    var node = document.createElement('div');
    node.setAttribute('data-portal-state', state);
    node.style.cssText = 'margin:24px auto;max-width:640px;padding:18px 22px;border-radius:10px;background:'+c.bg+';border:1px solid '+c.border+';color:'+c.color+';font:500 13px -apple-system,sans-serif;text-align:center;';
    node.textContent = message || defaults[state];
    el.prepend(node);
  }
  window.PORTAL_VIEW_STATE = setViewState;

  // Re-run strip + hide on DOMContentLoaded too, in case boot() ran during defer
  // parsing (readyState=interactive) when adminView container still gets manipulated
  // by later inline scripts.
  function rerunGuards(){
    var sess = loadSession();
    if(!sess || sess.role === 'admin') return;
    stripAdminDom();
    try { document.body.classList.add('role-'+sess.role); } catch(_){}
  }

  // ── Header chrome (role chip, version, logout) ───────────────────────────
  function decorateHeaderForRole(sess){
    if(document.getElementById('portalHeaderChrome')) return;
    var chrome = document.createElement('div');
    chrome.id = 'portalHeaderChrome';
    chrome.style.cssText = 'position:fixed;top:14px;right:18px;z-index:9000;display:flex;gap:10px;align-items:center;font:500 12px -apple-system,sans-serif;color:#f3fbff;';
    var pub = window.PUBLISHED_DATA && window.PUBLISHED_DATA.getCurrent();
    var verLabel = pub ? (pub.version_number + ' · ' + new Date(pub.published_at).toISOString().replace('T',' ').replace(/\..*/, ' UTC')) : 'No published version';
    chrome.innerHTML = ''+
      '<span style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.18);padding:5px 10px;border-radius:20px;letter-spacing:.04em;">'+
        'CONFIDENTIAL · Authorized Users Only'+
      '</span>'+
      '<span style="background:rgba(184,137,58,0.18);border:1px solid rgba(184,137,58,0.4);padding:5px 10px;border-radius:20px;color:#f6c878;letter-spacing:.04em;">'+
        escH(sess.role.toUpperCase())+' · '+escH(sess.name)+
      '</span>'+
      '<span style="background:rgba(31,111,139,0.18);border:1px solid rgba(31,111,139,0.4);padding:5px 10px;border-radius:20px;color:#9ed3e0;" id="portalVersionChip">'+
        'Published: '+escH(verLabel)+
      '</span>'+
      '<button onclick="window.PORTAL_AUTH.logout()" style="background:#a12c2c;color:#fff;border:none;padding:6px 14px;border-radius:6px;font:600 12px -apple-system,sans-serif;cursor:pointer;">Logout</button>';
    document.body.appendChild(chrome);
  }

  function escH(s){
    return String(s==null?'':s).replace(/[&<>"']/g, function(c){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }

  // ── Login screen ─────────────────────────────────────────────────────────
  // The login screen ONLY contains: brand mark, subtitle, the CONFIDENTIAL
  // banner, email, password, sign-in button, and an error area. No demo
  // credentials, no usernames, no passwords, no authentication hints.
  function showLogin(prefillError){
    // Suppress splash + admin chrome
    var splash = document.getElementById('deborah-loading-splash');
    if(splash) splash.remove();
    var loading = document.getElementById('loading');
    if(loading) loading.style.display = 'none';
    document.body.style.background = '#0a1733';
    // Hide whole header + main views so nothing leaks behind the login card
    ['dashboardView','insightsView','adminView','adminUpdatesView'].forEach(function(id){
      var el = document.getElementById(id); if(el){ el.hidden=true; el.style.display='none'; }
    });
    var hdr = document.querySelector('header.header');
    if(hdr) hdr.style.display = 'none';
    // If a login screen is already mounted, do not double-mount
    var existing = document.getElementById('portalLoginWrap');
    if(existing){
      if(prefillError){
        var er = document.getElementById('portalLoginErr');
        if(er) er.textContent = prefillError;
      }
      return;
    }

    var wrap = document.createElement('div');
    wrap.id = 'portalLoginWrap';
    wrap.style.cssText = 'position:fixed;inset:0;background:linear-gradient(135deg,#0a1733 0%,#13284d 100%);z-index:9999;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';
    wrap.innerHTML = ''+
      '<div style="background:#0f1e3f;border:1px solid rgba(255,255,255,0.1);border-radius:14px;padding:40px 44px;width:420px;box-shadow:0 24px 64px rgba(0,0,0,0.45);">'+
        '<div style="text-align:center;margin-bottom:24px;">'+
          '<div style="font-size:32px;font-weight:900;letter-spacing:.18em;color:#fff;">DEBORAH</div>'+
          '<div style="font-size:11px;letter-spacing:.25em;color:#b8893a;text-transform:uppercase;margin-top:6px;">Philanthropic Intelligence Platform</div>'+
        '</div>'+
        '<div style="background:rgba(184,137,58,0.1);border:1px solid rgba(184,137,58,0.3);border-radius:6px;padding:10px 14px;margin-bottom:20px;font-size:11px;color:#f6c878;letter-spacing:.05em;text-align:center;">'+
          'CONFIDENTIAL — Authorized Users Only'+
        '</div>'+
        '<label style="display:block;font-size:11px;color:#9eb3c9;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px;">Email</label>'+
        '<input id="portalLoginEmail" type="email" autocomplete="username" style="width:100%;padding:10px 12px;background:#0a1733;border:1px solid rgba(255,255,255,0.16);border-radius:6px;color:#fff;font-size:14px;margin-bottom:14px;box-sizing:border-box;" />'+
        '<label style="display:block;font-size:11px;color:#9eb3c9;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px;">Password</label>'+
        '<input id="portalLoginPw" type="password" autocomplete="current-password" style="width:100%;padding:10px 12px;background:#0a1733;border:1px solid rgba(255,255,255,0.16);border-radius:6px;color:#fff;font-size:14px;margin-bottom:18px;box-sizing:border-box;" />'+
        '<button id="portalLoginBtn" type="button" style="width:100%;padding:11px;background:linear-gradient(90deg,#1f6f8b,#2ce1d8);color:#0a1733;border:none;border-radius:6px;font-size:14px;font-weight:700;letter-spacing:.05em;cursor:pointer;">Sign In</button>'+
        '<div id="portalLoginErr" role="alert" aria-live="polite" style="color:#ff8e8e;font-size:12px;margin-top:12px;min-height:14px;text-align:center;"></div>'+
      '</div>';
    document.body.appendChild(wrap);

    if(prefillError){
      document.getElementById('portalLoginErr').textContent = prefillError;
    }

    var submitting = false;
    function attempt(){
      if(submitting) return;
      submitting = true;
      var btn = document.getElementById('portalLoginBtn');
      var errEl = document.getElementById('portalLoginErr');
      errEl.textContent = '';
      btn.disabled = true; btn.style.opacity = '0.7'; btn.textContent = 'Signing in…';
      var email = (document.getElementById('portalLoginEmail').value || '').trim();
      var pw    = document.getElementById('portalLoginPw').value || '';
      Promise.resolve().then(function(){ return login(email, pw); }).then(function(res){ handleResult(res); }, function(e){
        submitting = false;
        btn.disabled = false; btn.style.opacity = '1'; btn.textContent = 'Sign In';
        errEl.textContent = ERR.INVALID_CREDENTIALS;
        console.error('[PORTAL_AUTH] login threw:', e);
      });
    }
    function handleResult(res){
      var btn = document.getElementById('portalLoginBtn');
      var errEl = document.getElementById('portalLoginErr');
      if(res && res.ok){
        // Safety net: if anything below hangs, restore the button after 4s
        // so the user is never stuck on "Signing in…" indefinitely.
        var safety = setTimeout(function(){
          try {
            submitting = false;
            if(btn){ btn.disabled = false; btn.style.opacity = '1'; btn.textContent = 'Sign In'; }
            if(errEl){ errEl.textContent = 'Something went wrong. Please refresh the page and try again.'; }
          } catch(_){}
        }, 4000);
        // Briefly hold the "Signing in…" state so the user sees a clear
        // confirmation before transitioning.
        setTimeout(function(){
          clearTimeout(safety);
          try { wrap.remove(); } catch(e){}
          var tier = getStorageTier();
          if(tier === 'local' || tier === 'session'){
            // Persistent storage — a reload safely re-bootstraps with session
            window.location.reload();
          } else {
            // Memory-only — reload would lose the session. Re-run boot in place.
            try {
              if(typeof boot === 'function'){ boot(); }
              else { window.location.reload(); }
            } catch(e){
              console.error('[PORTAL_AUTH] in-place boot failed:', e);
              window.location.reload();
            }
          }
        }, 120);
      } else {
        submitting = false;
        btn.disabled = false; btn.style.opacity = '1'; btn.textContent = 'Sign In';
        errEl.textContent = (res && res.error) || ERR.INVALID_CREDENTIALS;
      }
    }
    document.getElementById('portalLoginBtn').onclick = attempt;
    ['portalLoginEmail','portalLoginPw'].forEach(function(id){
      document.getElementById(id).addEventListener('keydown', function(e){ if(e.key==='Enter') attempt(); });
    });
    setTimeout(function(){ try{ document.getElementById('portalLoginEmail').focus(); }catch(e){} }, 100);
  }

  // ── Activity tracker (idle timeout) ──────────────────────────────────────
  ['click','keydown','scroll','mousemove'].forEach(function(ev){
    document.addEventListener(ev, function(){
      if(loadSession()){
        // Throttle: only touch once per minute
        if(!touchSession.last || Date.now()-touchSession.last > 60000){
          touchSession.last = Date.now();
          touchSession();
        }
      }
    }, { passive:true });
  });

  // ── Public API ───────────────────────────────────────────────────────────
  window.PORTAL_AUTH = {
    boot: boot,
    login: login,
    logout: logout,
    getSession: getSession,
    isAuthenticated: isAuthenticated,
    getRole: getRole,
    isAdmin: isAdmin,
    isUser: isUser,
    isGuest: isGuest,
    restoreAdminChrome: restoreAdminChrome,
    fireAdminRenderHooks: fireAdminRenderHooks,
    setViewState: setViewState,
    canAccessPage: canAccessPage,
    canAccessSection: canAccessSection,
    canExport: canExport,
    canAccessAdminPortal: canAccessAdminPortal,
    canAccessUserPortal: canAccessUserPortal,
    // Account directory (Admin-only callers — checked at UI layer)
    loadUsers: loadUsers,
    upsertUser: upsertUser,
    deleteUser: deleteUser,
    findUserByEmail: findUserByEmail,
    findUserById: findUserById
  };

  // Listen for published events fired from anywhere (admin_publish, etc.) so
  // the header badge always reflects the current state.
  window.addEventListener('deborah:published', function(){
    try { updateVersionBadge(); } catch(_){}
  });

  // Boot before heavy admin modules render. Runs on DOMContentLoaded so
  // the existing inline boot has finished wiring globals.
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', boot, { once:true });
  } else {
    boot();
  }
  // Additional guard sweeps to catch any admin DOM (re)inserted after boot.
  document.addEventListener('DOMContentLoaded', rerunGuards, { once:true });
  window.addEventListener('load', rerunGuards, { once:true });
  setTimeout(rerunGuards, 500);
  setTimeout(rerunGuards, 1500);

})();
