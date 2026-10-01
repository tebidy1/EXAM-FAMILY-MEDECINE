/* ============================================================
   SB — zero-dependency Supabase client (REST only)
   Auth (signup/login/refresh/logout) + PostgREST CRUD + RPCs.
   Used by the main app (auth gate + sync) and admin.html.
   ============================================================ */
'use strict';

window.SB = (function () {
  const cfg = window.SB_CONFIG || {};
  const configured = !!(cfg.url && cfg.anonKey);
  const KEY = 'oman-em-prep.sb';
  let session = null;
  let profile = null;

  function hdr(auth = true, json = true) {
    const h = { apikey: cfg.anonKey };
    if (json) h['Content-Type'] = 'application/json';
    if (auth && session) h.Authorization = 'Bearer ' + session.access_token;
    return h;
  }

  async function req(path, opts = {}) {
    const res = await fetch(cfg.url + path, {
      method: opts.method || 'GET',
      headers: { ...hdr(opts.auth !== false, opts.json !== false), ...(opts.headers || {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) {
      let msg = 'HTTP ' + res.status;
      try {
        const j = await res.json();
        msg = j.msg || j.message || j.error_description || j.error || msg;
      } catch (e) { /* non-json */ }
      throw new Error(msg);
    }
    if (res.status === 204) return null;
    const ct = res.headers.get('content-type') || '';
    return ct.includes('json') ? res.json() : res.text();
  }

  function load() {
    try { session = JSON.parse(localStorage.getItem(KEY)); } catch (e) { session = null; }
  }
  function save() {
    try { session ? localStorage.setItem(KEY, JSON.stringify(session)) : localStorage.removeItem(KEY); } catch (e) { /* private mode */ }
  }

  /* ---------- session lifecycle ---------- */
  async function init() {
    if (!configured) return false;
    load();
    if (!session) return false;
    if (session.expires_at && session.expires_at < Date.now() + 60000) {
      try {
        const r = await req('/auth/v1/token?grant_type=refresh_token', {
          method: 'POST', auth: false,
          body: { refresh_token: session.refresh_token },
        });
        session = { access_token: r.access_token, refresh_token: r.refresh_token, expires_at: Date.now() + r.expires_in * 1000, user: r.user };
        save();
      } catch (e) {
        session = null; save();
        return false;
      }
    }
    try {
      profile = (await req('/rest/v1/profiles?id=eq.' + session.user.id + '&select=*'))[0] || null;
    } catch (e) { profile = null; }
    return !!profile;
  }

  async function signup(email, password, name) {
    const r = await req('/auth/v1/signup', {
      method: 'POST', auth: false,
      body: { email, password, data: { name } },
    });
    if (!r.access_token) throw new Error('تحقق من بريدك ثم سجّل الدخول'); // email confirmation on
    session = { access_token: r.access_token, refresh_token: r.refresh_token, expires_at: Date.now() + r.expires_in * 1000, user: r.user };
    save();
    try { profile = (await req('/rest/v1/profiles?id=eq.' + session.user.id + '&select=*'))[0] || null; } catch (e) { profile = null; }
    return { needsCode: !profile || !profile.code_id };
  }

  async function login(email, password) {
    const r = await req('/auth/v1/token?grant_type=password', {
      method: 'POST', auth: false,
      body: { email, password },
    });
    session = { access_token: r.access_token, refresh_token: r.refresh_token, expires_at: Date.now() + r.expires_in * 1000, user: r.user };
    save();
    try { profile = (await req('/rest/v1/profiles?id=eq.' + session.user.id + '&select=*'))[0] || null; } catch (e) { profile = null; }
    return { needsCode: !profile || !profile.code_id };
  }

  async function logout() {
    try { await req('/auth/v1/logout', { method: 'POST' }); } catch (e) { /* best effort */ }
    session = null; profile = null; save();
  }

  /* ---------- access codes ---------- */
  async function checkCode(code) {
    return await req('/rest/v1/rpc/check_code', { method: 'POST', body: { p_code: code } });
  }
  async function redeemCode(code) {
    const ok = await req('/rest/v1/rpc/redeem_code', { method: 'POST', body: { p_code: code } });
    if (ok) { try { profile = (await req('/rest/v1/profiles?id=eq.' + session.user.id + '&select=*'))[0] || profile; } catch (e) { /* keep */ } }
    return ok;
  }

  /* ---------- data ---------- */
  async function fetchProgress() {
    return await req('/rest/v1/progress?user_id=eq.' + session.user.id + '&select=*&order=last_seen.desc');
  }
  async function upsertProgress(rows) {
    if (!rows.length) return;
    await req('/rest/v1/progress?on_conflict=user_id,question_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: rows,
    });
  }
  async function logSession(entry) {
    return await req('/rest/v1/sessions_log', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: {
        user_id: session.user.id,
        kind: entry.kind || entry.mode || null,
        ref_id: entry.refId || null,
        title: entry.title || null,
        score: entry.score ?? null,
        total: entry.total ?? null,
      },
    });
  }
  async function event(name, meta) {
    if (!session) return;
    return await req('/rest/v1/events', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: { user_id: session.user.id, name, meta: meta || {} },
    });
  }
  async function heartbeat() {
    return await req('/rest/v1/profiles?id=eq.' + session.user.id, {
      method: 'PATCH',
      body: { last_seen: new Date().toISOString() },
    });
  }
  async function updateName(name) {
    await req('/rest/v1/profiles?id=eq.' + session.user.id, { method: 'PATCH', body: { name } });
    if (profile) profile.name = name;
  }

  return {
    configured,
    req,
    init, signup, login, logout,
    checkCode, redeemCode,
    fetchProgress, upsertProgress, logSession, event, heartbeat, updateName,
    get session() { return session; },
    get profile() { return profile; },
  };
})();
