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

  // A phone on a connected-but-dead network never gets an answer, and fetch() would wait
  // on it forever. Give up after TIMEOUT and report it as the TypeError fetch() throws
  // when offline, so every caller's "no network" path covers it too.
  const TIMEOUT = 12000;
  async function req(path, opts = {}) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opts.timeout || TIMEOUT);
    try {
      const res = await fetch(cfg.url + path, {
        method: opts.method || 'GET',
        headers: { ...hdr(opts.auth !== false, opts.json !== false), ...(opts.headers || {}) },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: ctl.signal,
      });
      if (!res.ok) {
        let msg = 'HTTP ' + res.status;
        try {
          const j = await res.json();
          msg = j.msg || j.message || j.error_description || j.error || msg;
        } catch (e) { if (e.name === 'AbortError') throw e; /* else non-json */ }
        throw new Error(msg);
      }
      if (res.status === 204) return null;
      const ct = res.headers.get('content-type') || '';
      return await (ct.includes('json') ? res.json() : res.text());
    } catch (e) {
      if (e.name === 'AbortError') throw new TypeError('Failed to fetch (timed out)');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  const PKEY = KEY + '.profile';   // last profile the server gave us, so the installed app still opens offline
  function load() {
    try { session = JSON.parse(localStorage.getItem(KEY)); } catch (e) { session = null; }
    try { profile = JSON.parse(localStorage.getItem(PKEY)); } catch (e) { profile = null; }
    if (!session || !profile || profile.id !== session.user?.id) profile = null;
  }
  function save() {
    try {
      session ? localStorage.setItem(KEY, JSON.stringify(session)) : localStorage.removeItem(KEY);
      session && profile ? localStorage.setItem(PKEY, JSON.stringify(profile)) : localStorage.removeItem(PKEY);
    } catch (e) { /* private mode */ }
  }

  /* ---------- session lifecycle ---------- */
  const BOOT_TIMEOUT = 8000;   // the launch screen waits on these two calls: keep them short
  async function init() {
    if (!configured) return false;
    load();
    if (!session) return false;
    if (session.expires_at && session.expires_at < Date.now() + 60000) {
      try {
        const r = await req('/auth/v1/token?grant_type=refresh_token', {
          method: 'POST', auth: false, timeout: BOOT_TIMEOUT,
          body: { refresh_token: session.refresh_token },
        });
        session = { access_token: r.access_token, refresh_token: r.refresh_token, expires_at: Date.now() + r.expires_in * 1000, user: r.user };
        save();
      } catch (e) {
        // fetch() throws TypeError when there is no network: stay signed in and
        // run on the cached profile. Any answer from the server means the session is dead.
        if (!(e instanceof TypeError)) {
          session = null; save();
          return false;
        }
      }
    }
    return !!(await refreshProfile(BOOT_TIMEOUT));
  }

  async function refreshProfile(timeout) {
    try {
      profile = (await req('/rest/v1/profiles?id=eq.' + session.user.id + '&select=*', { timeout }))[0] || null;
      save();
    } catch (e) { /* offline blip: keep what we have */ }
    return profile;
  }

  async function signup(email, password, name, phone, ref) {
    const data = { name, phone };
    if (ref) data.ref = ref;   // referral code from the invite link -> handle_new_user()
    const r = await req('/auth/v1/signup', {
      method: 'POST', auth: false,
      body: { email, password, data },
    });
    if (!r.access_token) return { needsConfirm: true }; // email confirmation on
    session = { access_token: r.access_token, refresh_token: r.refresh_token, expires_at: Date.now() + r.expires_in * 1000, user: r.user };
    profile = null;
    save();
    await refreshProfile();
    return { needsConfirm: false };
  }

  async function login(email, password) {
    const r = await req('/auth/v1/token?grant_type=password', {
      method: 'POST', auth: false,
      body: { email, password },
    });
    session = { access_token: r.access_token, refresh_token: r.refresh_token, expires_at: Date.now() + r.expires_in * 1000, user: r.user };
    profile = null;
    save();
    await refreshProfile();
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

  /* ---------- promo codes: open extra free questions (needs supabase/004) ---------- */
  // returns { ok, reward } on success, or { ok:false, error:'invalid'|'used'|'auth' }
  async function redeemPromo(code) {
    const res = await req('/rest/v1/rpc/redeem_promo', { method: 'POST', body: { p_code: code } });
    if (res && res.ok) await refreshProfile();   // bonus_questions is now higher
    return res || { ok: false, error: 'invalid' };
  }

  /* ---------- payment: settings + receipt upload ---------- */
  async function paymentSettings() {
    return (await req('/rest/v1/payment_settings?id=eq.1&select=*'))[0] || {};
  }
  const RECEIPT_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif', 'application/pdf': 'pdf' };
  // plan: 'full', or 'part' for one third of the bank (needs supabase/003_plans.sql)
  async function submitReceipt(blob, plan = 'full') {
    const path = session.user.id + '/' + Date.now() + '.' + (RECEIPT_EXT[blob.type] || 'jpg');
    const res = await fetch(cfg.url + '/storage/v1/object/receipts/' + path, {
      method: 'POST',
      headers: { ...hdr(true, false), 'Content-Type': blob.type || 'image/jpeg' },
      body: blob,
    });
    if (!res.ok) {
      let msg = 'HTTP ' + res.status;
      try { const j = await res.json(); msg = j.message || j.error || msg; } catch (e) { /* non-json */ }
      throw new Error(msg);
    }
    // a full-plan call keeps the old one-argument shape, so it works before and after 003 has run
    await req('/rest/v1/rpc/submit_request', { method: 'POST', body: plan === 'part' ? { p_path: path, p_plan: plan } : { p_path: path } });
    await refreshProfile();
  }
  async function fetchReceipt(path) {   // admin (or owner): private bucket -> blob
    const res = await fetch(cfg.url + '/storage/v1/object/authenticated/receipts/' + path, { headers: hdr(true, false) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.blob();
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
    init, signup, login, logout, refreshProfile,
    checkCode, redeemCode, redeemPromo,
    paymentSettings, submitReceipt, fetchReceipt,
    fetchProgress, upsertProgress, logSession, event, heartbeat, updateName,
    get session() { return session; },
    get profile() { return profile; },
  };
})();
