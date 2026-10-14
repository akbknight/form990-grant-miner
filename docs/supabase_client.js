/* supabase_client.js — minimal Supabase REST/Auth client for Deborah (window.SUPA)
 * Uses only the public anon key. All authorization is enforced server-side by
 * Supabase Auth + Row Level Security + SECURITY DEFINER RPCs.
 */
(function(){
  'use strict';
  var URL_ = 'https://nvnehqrukkwxpphclkky.supabase.co';
  var ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im52bmVocXJ1a2t3eHBwaGNsa2t5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2ODUzNjUsImV4cCI6MjA5NjI2MTM2NX0._lKDgYSMIxGyDv65wImzY3CBwzklXNQcmkerjYrjHjE';
  var TOK_KEY = 'deborah_supa_tokens';

  function lsGet(k){ try { return window.localStorage.getItem(k); } catch(e){ return null; } }
  function lsSet(k,v){ try { window.localStorage.setItem(k,v); return true; } catch(e){ return false; } }
  function lsDel(k){ try { window.localStorage.removeItem(k); } catch(e){} }

  var mem = null;
  function getTokens(){
    if(mem) return mem;
    try { var r = lsGet(TOK_KEY); mem = r ? JSON.parse(r) : null; } catch(e){ mem = null; }
    return mem;
  }
  function setTokens(t){ mem = t; if(t) lsSet(TOK_KEY, JSON.stringify(t)); else lsDel(TOK_KEY); }

  function headers(useUser, extra){
    var h = { 'apikey': ANON, 'Content-Type': 'application/json' };
    var t = useUser ? getTokens() : null;
    h['Authorization'] = 'Bearer ' + ((t && t.access_token) || ANON);
    if(extra) for(var k in extra) h[k] = extra[k];
    return h;
  }

  async function parse(res){
    var txt = await res.text(); var body = null;
    try { body = txt ? JSON.parse(txt) : null; } catch(e){ body = txt; }
    if(!res.ok){
      var msg = (body && (body.message || body.msg || body.error_description || body.error)) || ('HTTP ' + res.status);
      var err = new Error(msg); err.status = res.status; err.body = body; throw err;
    }
    return body;
  }

  async function refreshIfNeeded(){
    var t = getTokens(); if(!t) return null;
    var now = Math.floor(Date.now()/1000);
    if(t.expires_at && t.expires_at - now > 60) return t;
    if(!t.refresh_token) return t;
    try {
      var res = await fetch(URL_ + '/auth/v1/token?grant_type=refresh_token', {
        method:'POST', headers: headers(false), body: JSON.stringify({ refresh_token: t.refresh_token })
      });
      var b = await parse(res);
      var nt = { access_token:b.access_token, refresh_token:b.refresh_token, expires_at: now + (b.expires_in||3600), user_id: b.user && b.user.id, email: b.user && b.user.email };
      setTokens(nt); return nt;
    } catch(e){ return t; }
  }

  async function signIn(email, password){
    var res = await fetch(URL_ + '/auth/v1/token?grant_type=password', {
      method:'POST', headers: headers(false), body: JSON.stringify({ email: email, password: password })
    });
    var b = await parse(res);
    var now = Math.floor(Date.now()/1000);
    var t = { access_token:b.access_token, refresh_token:b.refresh_token, expires_at: now + (b.expires_in||3600), user_id: b.user && b.user.id, email: b.user && b.user.email };
    setTokens(t);
    return t;
  }
  async function signOut(){
    var t = getTokens();
    try { if(t) await fetch(URL_ + '/auth/v1/logout', { method:'POST', headers: headers(true) }); } catch(e){}
    setTokens(null);
  }
  async function resetPassword(email){
    var res = await fetch(URL_ + '/auth/v1/recover', { method:'POST', headers: headers(false), body: JSON.stringify({ email: email }) });
    return parse(res);
  }
  async function updatePassword(pw){
    await refreshIfNeeded();
    var res = await fetch(URL_ + '/auth/v1/user', { method:'PUT', headers: headers(true), body: JSON.stringify({ password: pw }) });
    return parse(res);
  }
  // Admin "create account": uses the public sign-up endpoint WITHOUT storing the
  // returned session, so the admin stays signed in. Requires email confirmation
  // to be off (as configured for this project).
  async function createAccount(email, password){
    var res = await fetch(URL_ + '/auth/v1/signup', { method:'POST', headers: headers(false), body: JSON.stringify({ email: email, password: password }) });
    return parse(res);
  }

  async function rpc(fn, args){
    await refreshIfNeeded();
    var res = await fetch(URL_ + '/rest/v1/rpc/' + fn, { method:'POST', headers: headers(true), body: JSON.stringify(args || {}) });
    return parse(res);
  }
  async function select(table, query){
    await refreshIfNeeded();
    var res = await fetch(URL_ + '/rest/v1/' + table + (query ? ('?' + query) : ''), { headers: headers(true) });
    return parse(res);
  }
  async function count(table, query){
    await refreshIfNeeded();
    var res = await fetch(URL_ + '/rest/v1/' + table + '?select=*' + (query ? ('&' + query) : '') + '&limit=1', { headers: headers(true, { 'Prefer':'count=exact', 'Range':'0-0' }) });
    if(!res.ok && res.status !== 206) throw new Error('HTTP ' + res.status);
    var cr = res.headers.get('content-range') || ''; var n = parseInt(cr.split('/')[1], 10);
    return isNaN(n) ? 0 : n;
  }
  async function insert(table, rows){
    await refreshIfNeeded();
    var res = await fetch(URL_ + '/rest/v1/' + table, { method:'POST', headers: headers(true, { 'Prefer':'return=representation' }), body: JSON.stringify(rows) });
    return parse(res);
  }
  async function update(table, query, patch){
    await refreshIfNeeded();
    var res = await fetch(URL_ + '/rest/v1/' + table + '?' + query, { method:'PATCH', headers: headers(true, { 'Prefer':'return=representation' }), body: JSON.stringify(patch) });
    return parse(res);
  }
  async function myProfile(){
    var t = await refreshIfNeeded(); if(!t || !t.user_id) return null;
    var rows = await select('profiles', 'id=eq.' + encodeURIComponent(t.user_id) + '&select=*');
    return rows && rows[0] || null;
  }
  function deviceSummary(){
    var ua = navigator.userAgent || '';
    var os = /Windows/.test(ua)?'Windows':/Mac OS/.test(ua)?'macOS':/Android/.test(ua)?'Android':/iPhone|iPad/.test(ua)?'iOS':/Linux/.test(ua)?'Linux':'Other';
    var br = /Edg\//.test(ua)?'Edge':/Chrome\//.test(ua)?'Chrome':/Firefox\//.test(ua)?'Firefox':/Safari\//.test(ua)?'Safari':'Browser';
    return br + ' on ' + os;
  }
  async function logEvent(event, details){
    try {
      return await rpc('record_login_event', { p_event: event, p_details: details || {}, p_user_agent: navigator.userAgent || null, p_session_id: (getTokens()||{}).user_id || null, p_device_summary: deviceSummary() });
    } catch(e){ console.warn('[SUPA] logEvent failed', event, e.message); return null; }
  }

  window.SUPA = {
    url: URL_, configured: true,
    getTokens: getTokens, refresh: refreshIfNeeded,
    signIn: signIn, signOut: signOut, resetPassword: resetPassword, updatePassword: updatePassword, createAccount: createAccount,
    rpc: rpc, select: select, count: count, insert: insert, update: update,
    myProfile: myProfile, logEvent: logEvent, deviceSummary: deviceSummary
  };
})();
