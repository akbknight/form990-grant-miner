/*
 * spa_router.js — Hash-based Single-Page Router for Deborah
 * --------------------------------------------------------
 * Reads location.hash, validates role permissions, and calls
 * the existing window.setTopView() to show exactly ONE view.
 *
 * Routes:
 *   #/dashboard  → Dashboard (all roles)
 *   #/insights   → Insights  (all roles, Guest may see restricted subset)
 *   #/updates    → Updates Center (Admin only)
 *   #/admin      → Admin Console (Admin only)
 *
 * Role gates:
 *   Admin → all 4 routes
 *   User  → dashboard, insights
 *   Guest → dashboard, insights (filtered by guest_permissions)
 *
 * Unauthorized routes redirect to #/dashboard.
 */
(function(){
  'use strict';

  var VALID_VIEWS = ['dashboard','insights','updates','admin'];
  var ROLE_ALLOWED = {
    admin: ['dashboard','insights','updates','admin'],
    user:  ['dashboard','insights'],
    guest: ['dashboard','insights']
  };

  function currentRole(){
    try {
      if (window.PORTAL_AUTH && typeof window.PORTAL_AUTH.getSession === 'function') {
        var sess = window.PORTAL_AUTH.getSession();
        if (sess && sess.role) return String(sess.role).toLowerCase();
      }
    } catch(_){}
    return 'guest';
  }

  function parseHash(){
    var h = String(location.hash || '').replace(/^#\/?/, '').trim().toLowerCase();
    if (!h) return 'dashboard';
    // strip query string if any
    h = h.split('?')[0].split('/')[0];
    return VALID_VIEWS.indexOf(h) >= 0 ? h : 'dashboard';
  }

  function allowedFor(role){
    return ROLE_ALLOWED[role] || ROLE_ALLOWED.guest;
  }

  function setNavActive(view){
    var map = {
      dashboard: 'navDashboard',
      insights:  'navInsights',
      updates:   'navUpdates',
      admin:     'navAdmin'
    };
    Object.keys(map).forEach(function(v){
      var btn = document.getElementById(map[v]);
      if (!btn) return;
      if (v === view) {
        btn.classList.add('active');
        btn.setAttribute('aria-selected','true');
      } else {
        btn.classList.remove('active');
        btn.setAttribute('aria-selected','false');
      }
    });
  }

  function applyRoleVisibility(){
    var role = currentRole();
    var allowed = allowedFor(role);
    var nav = {
      dashboard: 'navDashboard',
      insights:  'navInsights',
      updates:   'navUpdates',
      admin:     'navAdmin'
    };
    Object.keys(nav).forEach(function(v){
      var btn = document.getElementById(nav[v]);
      if (!btn) return;
      btn.style.display = (allowed.indexOf(v) >= 0) ? '' : 'none';
    });
  }

  function route(){
    var view = parseHash();
    var role = currentRole();
    var allowed = allowedFor(role);

    if (allowed.indexOf(view) < 0) {
      // Redirect unauthorized → dashboard (default safe view)
      if (view !== 'dashboard') {
        try {
          if (window.AUDIT_LOG && window.AUDIT_LOG.append) {
            window.AUDIT_LOG.append({
              type: 'route_denied',
              role: role,
              attempted_view: view,
              redirected_to: 'dashboard',
              ts: new Date().toISOString()
            });
          }
        } catch(_){}
      }
      view = 'dashboard';
      // Update the URL hash to reflect redirect, without triggering another route()
      if (location.hash !== '#/dashboard') {
        history.replaceState(null, '', '#/dashboard');
      }
    }

    applyRoleVisibility();
    setNavActive(view);

    if (typeof window.setTopView === 'function') {
      try { window.setTopView(view); }
      catch(err){ console.error('[spa_router] setTopView failed:', err); }
    } else {
      console.warn('[spa_router] window.setTopView not available yet');
    }

    // Page state hook (loading/empty/restricted/error spec messages)
    try {
      if (window.PORTAL_VIEW_STATE && typeof window.PORTAL_VIEW_STATE.onRoute === 'function') {
        window.PORTAL_VIEW_STATE.onRoute(view, role);
      }
    } catch(_){}
  }

  function navigate(view){
    if (VALID_VIEWS.indexOf(view) < 0) view = 'dashboard';
    var target = '#/' + view;
    if (location.hash === target) {
      // Same hash → still re-run route to refresh
      route();
    } else {
      location.hash = target;
    }
  }

  function bindNavButtons(){
    var pairs = [
      ['navDashboard','dashboard'],
      ['navInsights','insights'],
      ['navUpdates','updates'],
      ['navAdmin','admin']
    ];
    pairs.forEach(function(p){
      var btn = document.getElementById(p[0]);
      if (!btn) return;
      // Replace inline onclick so we route via hash
      btn.onclick = function(ev){
        ev.preventDefault();
        ev.stopPropagation();
        navigate(p[1]);
        return false;
      };
    });
  }

  function hasSession(){
    try {
      if (window.PORTAL_AUTH && window.PORTAL_AUTH.getSession) {
        return !!window.PORTAL_AUTH.getSession();
      }
    } catch(_){}
    return false;
  }

  function init(){
    bindNavButtons();
    window.addEventListener('hashchange', function(){
      // Only route if we have an active session; otherwise login is on screen
      if (hasSession()) route();
    }, false);
    // If no hash, set default
    if (!location.hash) {
      history.replaceState(null, '', '#/dashboard');
    }
    // Don't auto-route at init — portal_auth boot path explicitly calls
    // SPA_ROUTER.route() once it determines the session is valid.
    if (hasSession()) route();
  }

  // Public API
  window.SPA_ROUTER = {
    route: route,
    navigate: navigate,
    init: init,
    currentView: parseHash,
    currentRole: currentRole,
    applyRoleVisibility: applyRoleVisibility
  };

  // Auto-init on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    // Defer to next tick so portal_auth boot path can run first
    setTimeout(init, 0);
  }
})();
