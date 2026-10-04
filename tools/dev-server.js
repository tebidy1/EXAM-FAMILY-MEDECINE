/* ============================================================
   Local dev server — serves the app plus an in-memory stand-in for
   the Supabase endpoints it calls, so signup → free trial → receipt →
   admin approval can be exercised without touching the live project.

     node tools/dev-server.js [port]      (default 8000)

   Nothing is persisted: restart = clean slate. It mirrors the rules of
   supabase/schema.sql + 002_trial_paywall.sql + 003_plans.sql + 004_promo_referral.sql
   closely enough to test the UI; the SQL itself still has to be run on the real project.

   Seeded test accounts (local only):
     admin   admin@test.local    / admin-test-1
   Seeded access code: TEST-CODE (5 uses)
   Referral rewards and the NOOR130 promo mirror supabase/005_launch_offer.sql
   (30 on signup / 350 on paid / no welcome bonus); more promo codes are created
   from the admin Growth tab.
   Suggested signup values for test doctors:
     doctor1@test.local / doctor-test-1 / +968 9000 0001
     doctor2@test.local / doctor-test-2 / +968 9000 0002
     doctor3@test.local / doctor-test-3 / +968 9000 0003
   ============================================================ */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = +process.argv[2] || 8000;
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.mp4': 'video/mp4' };

const db = {
  users: [],          // { id, email, password }
  profiles: [],
  progress: [],
  codes: [{ id: crypto.randomUUID(), code: 'TEST-CODE', label: 'dev', max_uses: 5, uses: 0, expires_at: null, active: true, created_at: new Date().toISOString() }],
  requests: [],
  sessions: [],
  promos: [{ id: crypto.randomUUID(), code: 'NOOR130', label: 'عرض الانطلاق', reward_questions: 45, max_uses: 130, uses: 0, expires_at: null, active: true, created_at: new Date().toISOString() }],         // { id, code, label, reward_questions, max_uses, uses, expires_at, active, created_at }
  redemptions: [],    // { user_id, promo_id }
  files: new Map(),   // receipt path -> { type, buf }
  tokens: new Map(),  // access token -> user id
  // referral_* mirror supabase/004 + 005 (the launch offer)
  pay: { id: 1, price: '25 ر.ع', part_price: '10 ر.ع', beneficiary: 'Test Beneficiary', bank: 'Bank Muscat', account: 'OM00 0000 0000 0000 0000 000', pay_link: null, whatsapp: '+96890000000', note: null, referral_reward_signup: 30, referral_reward_paid: 350, referral_signup_bonus: 0 },
};

const genRef = () => {
  const A = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  let c; do { c = Array.from({ length: 6 }, () => A[Math.floor(Math.random() * A.length)]).join(''); }
  while (db.profiles.some((p) => p.referral_code === c));
  return c;
};

function addUser(email, password, meta = {}) {
  const id = crypto.randomUUID();
  const first = db.profiles.length === 0;
  db.users.push({ id, email, password });
  const ref = (meta.ref || '').toUpperCase();
  const inviter = ref ? db.profiles.find((p) => p.referral_code === ref) : null;
  db.profiles.push({
    id, email, name: meta.name || email.split('@')[0], phone: meta.phone || null,
    role: first ? 'admin' : 'doctor', code_id: null,
    access_status: first ? 'active' : 'trial', reject_reason: null, parts: 0,
    bonus_questions: inviter ? (+db.pay.referral_signup_bonus || 0) : 0,
    referral_code: genRef(), referred_by: inviter ? inviter.id : null,
    referrals: 0, referrals_paid: 0, ref_paid_rewarded: false,
    created_at: new Date().toISOString(), last_seen: new Date().toISOString(),
  });
  if (inviter) {
    inviter.bonus_questions = (+inviter.bonus_questions || 0) + (+db.pay.referral_reward_signup || 0);
    inviter.referrals = (+inviter.referrals || 0) + 1;
  }
  return id;
}
addUser('admin@test.local', 'admin-test-1', { name: 'Admin' });

// mirror supabase/004: reward the inviter the first time an invitee reaches full access
function maybeGrantReferralPaid(owner) {
  if (!owner || !owner.referred_by || owner.ref_paid_rewarded) return;
  const full = owner.access_status === 'active' || (owner.parts || 0) >= 3 || !!owner.code_id;
  if (!full) return;
  owner.ref_paid_rewarded = true;
  const inviter = profileOf(owner.referred_by);
  if (inviter) {
    inviter.bonus_questions = (+inviter.bonus_questions || 0) + (+db.pay.referral_reward_paid || 0);
    inviter.referrals_paid = (+inviter.referrals_paid || 0) + 1;
  }
}

const sessionFor = (id) => {
  const token = 'tok-' + crypto.randomUUID();
  db.tokens.set(token, id);
  const u = db.users.find((x) => x.id === id);
  return { access_token: token, refresh_token: 'ref-' + id, expires_in: 3600, user: { id, email: u.email } };
};
const profileOf = (id) => db.profiles.find((p) => p.id === id);
const eq = (q, key) => (q.get(key) || '').replace(/^eq\./, '');
const stats = (id) => {
  const rows = db.progress.filter((r) => r.user_id === id);
  return {
    attempts: rows.reduce((a, r) => a + r.attempts, 0),
    covered: rows.length,
    mastered: rows.filter((r) => r.streak >= 3).length,
  };
};

function send(res, status, body, type = 'application/json') {
  const out = body === null ? '' : Buffer.isBuffer(body) ? body : type === 'application/json' ? JSON.stringify(body) : body;
  res.writeHead(status, body === null ? {} : { 'Content-Type': type + (type.startsWith('text') || type.includes('json') ? '; charset=utf-8' : '') });
  res.end(out);
}

function api(req, res, url, raw) {
  const p = url.pathname;
  const q = url.searchParams;
  const uid = db.tokens.get((req.headers.authorization || '').replace('Bearer ', '')) || null;
  const me = uid ? profileOf(uid) : null;
  const admin = !!me && me.role === 'admin';
  const body = () => (raw.length ? JSON.parse(raw.toString('utf8')) : {});
  const deny = () => send(res, 401, { message: 'not allowed' });

  /* ---- auth ---- */
  if (p === '/auth/v1/signup') {
    const b = body();
    if (db.users.some((u) => u.email === b.email)) return send(res, 422, { msg: 'User already registered' });
    if ((b.password || '').length < 6) return send(res, 422, { msg: 'Password should be at least 6 characters' });
    return send(res, 200, sessionFor(addUser(b.email, b.password, b.data)));
  }
  if (p === '/auth/v1/token') {
    const b = body();
    if (q.get('grant_type') === 'refresh_token') return send(res, 200, sessionFor(String(b.refresh_token).slice(4)));
    const u = db.users.find((x) => x.email === b.email && x.password === b.password);
    return u ? send(res, 200, sessionFor(u.id)) : send(res, 400, { error_description: 'Invalid login credentials' });
  }
  if (p === '/auth/v1/logout') return send(res, 204, null);
  if (!me) return deny();

  /* ---- tables ---- */
  if (p === '/rest/v1/profiles') {
    const id = eq(q, 'id');
    if (id !== uid && !admin) return send(res, 200, []);
    const row = profileOf(id);
    if (req.method === 'PATCH') {
      const b = body();
      if (!admin) ['role', 'code_id', 'access_status', 'reject_reason', 'parts', 'bonus_questions', 'referral_code', 'referred_by', 'referrals', 'referrals_paid', 'ref_paid_rewarded'].forEach((k) => delete b[k]);   // protect_role()
      Object.assign(row, b);
      maybeGrantReferralPaid(row);   // admin may have just activated an invited doctor
      return send(res, 204, null);
    }
    return send(res, 200, row ? [row] : []);
  }
  if (p === '/rest/v1/progress') {
    if (req.method === 'POST') {
      body().forEach((r) => {
        if (r.user_id !== uid) return;
        const i = db.progress.findIndex((x) => x.user_id === uid && x.question_id === r.question_id);
        if (i > -1) db.progress[i] = r; else db.progress.push(r);
      });
      return send(res, 201, null);
    }
    const id = eq(q, 'user_id');
    return send(res, 200, id === uid || admin ? db.progress.filter((r) => r.user_id === id) : []);
  }
  if (p === '/rest/v1/sessions_log') {
    if (req.method === 'POST') { db.sessions.push({ id: db.sessions.length + 1, ts: new Date().toISOString(), ...body() }); return send(res, 201, null); }
    return send(res, 200, db.sessions.filter((s) => s.user_id === eq(q, 'user_id')));
  }
  if (p === '/rest/v1/events') return send(res, 201, null);
  if (p === '/rest/v1/payment_settings') {
    if (req.method === 'PATCH') { if (!admin) return deny(); Object.assign(db.pay, body()); return send(res, 204, null); }
    return send(res, 200, [db.pay]);
  }
  if (p === '/rest/v1/access_codes') {
    if (!admin) return deny();
    if (req.method === 'POST') body().forEach((c) => db.codes.push({ id: crypto.randomUUID(), uses: 0, active: true, created_at: new Date().toISOString(), ...c }));
    else Object.assign(db.codes.find((c) => c.id === eq(q, 'id')), body());
    return send(res, 204, null);
  }
  if (p === '/rest/v1/promo_codes') {
    if (!admin) return deny();
    if (req.method === 'POST') {
      const b = body();
      const one = (c) => {
        if (db.promos.some((x) => x.code === c.code)) throw new Error('duplicate key value');
        db.promos.push({ id: crypto.randomUUID(), uses: 0, active: true, created_at: new Date().toISOString(), reward_questions: 0, max_uses: 1, expires_at: null, label: null, ...c });
      };
      try { (Array.isArray(b) ? b : [b]).forEach(one); } catch (e) { return send(res, 409, { message: e.message }); }
    } else Object.assign(db.promos.find((c) => c.id === eq(q, 'id')), body());
    return send(res, 204, null);
  }

  /* ---- admin views ---- */
  if (p.startsWith('/rest/v1/v_admin_') && !admin) return send(res, 200, []);
  if (p === '/rest/v1/v_admin_users') return send(res, 200, db.profiles.map((x) => ({ ...x, ...stats(x.id) })));
  if (p === '/rest/v1/v_admin_codes') return send(res, 200, db.codes.map((c) => ({ ...c, redeemed_by: db.profiles.filter((x) => x.code_id === c.id).length })));
  if (p === '/rest/v1/v_admin_promos') return send(res, 200, db.promos.map((c) => ({ ...c, redeemed_by: db.redemptions.filter((r) => r.promo_id === c.id).length })));
  if (p === '/rest/v1/v_admin_sessions') return send(res, 200, db.sessions.map((s) => ({ ...s, ...(({ email, name }) => ({ email, name }))(profileOf(s.user_id) || {}) })));
  if (p === '/rest/v1/v_admin_requests') {
    return send(res, 200, [...db.requests].reverse().map((r) => {
      const o = profileOf(r.user_id) || {};
      return { ...r, name: o.name, email: o.email, phone: o.phone, covered: stats(r.user_id).covered, parts: o.parts };
    }));
  }

  /* ---- RPCs ---- */
  const liveCode = (code) => db.codes.find((c) => c.code === String(code || '').trim().toUpperCase() && c.active && c.uses < c.max_uses);
  if (p === '/rest/v1/rpc/check_code') return send(res, 200, !!liveCode(body().p_code));
  if (p === '/rest/v1/rpc/redeem_code') {
    const c = liveCode(body().p_code);
    if (!c) return send(res, 200, false);
    c.uses += 1;
    Object.assign(me, { code_id: c.id, access_status: 'active', reject_reason: null });
    maybeGrantReferralPaid(me);   // a redeemed full-access code also pays the inviter
    return send(res, 200, true);
  }
  if (p === '/rest/v1/rpc/redeem_promo') {
    const code = String(body().p_code || '').trim().toUpperCase();
    const c = db.promos.find((x) => x.code === code && x.active && x.uses < x.max_uses && (!x.expires_at || new Date(x.expires_at) > new Date()));
    if (!c) return send(res, 200, { ok: false, error: 'invalid' });
    if (db.redemptions.some((r) => r.user_id === uid && r.promo_id === c.id)) return send(res, 200, { ok: false, error: 'used' });
    c.uses += 1;
    db.redemptions.push({ user_id: uid, promo_id: c.id });
    me.bonus_questions = (+me.bonus_questions || 0) + (+c.reward_questions || 0);
    return send(res, 200, { ok: true, reward: +c.reward_questions || 0 });
  }
  if (p === '/rest/v1/rpc/submit_request') {
    const { p_path, p_plan = 'full' } = body();
    if (!String(p_path).startsWith(uid + '/')) return send(res, 400, { message: 'bad receipt path' });
    if (!['full', 'part'].includes(p_plan)) return send(res, 400, { message: 'bad plan' });
    if (me.access_status === 'active' || me.parts >= 3) return send(res, 200, null);
    db.requests = db.requests.filter((r) => !(r.user_id === uid && r.status === 'pending'));
    const r = { id: crypto.randomUUID(), user_id: uid, receipt_path: p_path, plan: p_plan, status: 'pending', reject_reason: null, created_at: new Date().toISOString(), reviewed_at: null };
    db.requests.push(r);
    Object.assign(me, { access_status: 'pending', reject_reason: null });
    return send(res, 200, r.id);
  }
  if (p === '/rest/v1/rpc/approve_request' || p === '/rest/v1/rpc/reject_request') {
    if (!admin) return send(res, 400, { message: 'admin only' });
    const b = body();
    const r = db.requests.find((x) => x.id === b.p_id);
    if (!r) return send(res, 200, false);
    const approve = p.endsWith('approve_request');
    if (approve && r.status !== 'pending') return send(res, 200, false);   // a second click cannot add a second part
    Object.assign(r, { status: approve ? 'approved' : 'rejected', reject_reason: approve ? null : b.p_reason, reviewed_at: new Date().toISOString() });
    const owner = profileOf(r.user_id);
    if (approve && r.plan === 'part') {
      owner.parts = Math.min(owner.parts + 1, 3);
      Object.assign(owner, { access_status: owner.parts >= 3 ? 'active' : 'trial', reject_reason: null });
    } else if (approve) Object.assign(owner, { access_status: 'active', reject_reason: null });
    else if (owner.access_status !== 'active') Object.assign(owner, { access_status: 'rejected', reject_reason: b.p_reason });
    if (approve) maybeGrantReferralPaid(owner);   // the invitee just subscribed: pay the inviter
    return send(res, 200, true);
  }

  /* ---- storage (private "receipts" bucket) ---- */
  const up = p.match(/^\/storage\/v1\/object\/receipts\/(.+)$/);
  if (up && req.method === 'POST') {
    if (!up[1].startsWith(uid + '/')) return send(res, 403, { message: 'new row violates row-level security policy' });
    db.files.set(up[1], { type: req.headers['content-type'], buf: raw });
    return send(res, 200, { Key: 'receipts/' + up[1] });
  }
  const down = p.match(/^\/storage\/v1\/object\/authenticated\/receipts\/(.+)$/);
  if (down) {
    const f = db.files.get(down[1]);
    if (!f || !(admin || down[1].startsWith(uid + '/'))) return send(res, 404, { message: 'not found' });
    return send(res, 200, f.buf, f.type);
  }
  return send(res, 404, { message: 'dev-server: no such endpoint ' + p });
}

// simulate a request that never answers (a phone on a dead-but-connected network):
//   /__dev/stall?match=/rest/v1/progress   → matching requests hang;  /__dev/stall  → back to normal
let stall = null;
const held = [];   // the hanging sockets: a browser allows 6 per host, so drop them when the stall changes

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/__dev/stall') {
    const m = url.searchParams.get('match');
    stall = m ? new RegExp(m) : null;
    held.splice(0).forEach((r) => r.destroy());
    return send(res, 200, { stall: m || null });
  }
  if (stall && stall.test(url.pathname)) { held.push(res); return; }   // never answered
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    try {
      if (/^\/(auth|rest|storage)\/v1\//.test(url.pathname)) return api(req, res, url, Buffer.concat(chunks));
      // point the app at this server instead of the live Supabase project
      if (url.pathname === '/js/config.js') return send(res, 200, `window.SB_CONFIG = { url: location.origin, anonKey: 'dev' };`, 'text/javascript');
      let file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)));
      if ((!file.startsWith(ROOT + path.sep) && file !== ROOT) || !fs.existsSync(file)) return send(res, 404, 'not found', 'text/plain');
      // a folder answers with its index.html, like the real host (/get → /get/)
      if (fs.statSync(file).isDirectory()) {
        if (!url.pathname.endsWith('/')) { res.writeHead(301, { Location: url.pathname + '/' }); return res.end(); }
        file = path.join(file, 'index.html');
        if (!fs.existsSync(file)) return send(res, 404, 'not found', 'text/plain');
      }
      send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
    } catch (e) {
      send(res, 500, { message: e.message });
    }
  });
}).listen(PORT, () => console.log(`Oman EM Prep dev server → http://localhost:${PORT}  (admin: /admin.html)`));
