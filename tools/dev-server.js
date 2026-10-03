/* ============================================================
   Local dev server — serves the app plus an in-memory stand-in for
   the Supabase endpoints it calls, so signup → free trial → receipt →
   admin approval can be exercised without touching the live project.

     node tools/dev-server.js [port]      (default 8000)

   Nothing is persisted: restart = clean slate. It mirrors the rules of
   supabase/schema.sql + 002_trial_paywall.sql + 003_plans.sql closely enough to test the
   UI; the SQL itself still has to be run on the real project.

   Seeded test accounts (local only):
     admin   admin@test.local    / admin-test-1
   Seeded access code: TEST-CODE (5 uses)
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
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

const db = {
  users: [],          // { id, email, password }
  profiles: [],
  progress: [],
  codes: [{ id: crypto.randomUUID(), code: 'TEST-CODE', label: 'dev', max_uses: 5, uses: 0, expires_at: null, active: true, created_at: new Date().toISOString() }],
  requests: [],
  sessions: [],
  files: new Map(),   // receipt path -> { type, buf }
  tokens: new Map(),  // access token -> user id
  pay: { id: 1, price: '25 ر.ع', part_price: '10 ر.ع', beneficiary: 'Test Beneficiary', bank: 'Bank Muscat', account: 'OM00 0000 0000 0000 0000 000', pay_link: null, whatsapp: '+96890000000', note: null },
};

function addUser(email, password, meta = {}) {
  const id = crypto.randomUUID();
  const first = db.profiles.length === 0;
  db.users.push({ id, email, password });
  db.profiles.push({
    id, email, name: meta.name || email.split('@')[0], phone: meta.phone || null,
    role: first ? 'admin' : 'doctor', code_id: null,
    access_status: first ? 'active' : 'trial', reject_reason: null, parts: 0,
    created_at: new Date().toISOString(), last_seen: new Date().toISOString(),
  });
  return id;
}
addUser('admin@test.local', 'admin-test-1', { name: 'Admin' });

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
      if (!admin) ['role', 'code_id', 'access_status', 'reject_reason', 'parts'].forEach((k) => delete b[k]);   // protect_role()
      Object.assign(row, b);
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

  /* ---- admin views ---- */
  if (p.startsWith('/rest/v1/v_admin_') && !admin) return send(res, 200, []);
  if (p === '/rest/v1/v_admin_users') return send(res, 200, db.profiles.map((x) => ({ ...x, ...stats(x.id) })));
  if (p === '/rest/v1/v_admin_codes') return send(res, 200, db.codes.map((c) => ({ ...c, redeemed_by: db.profiles.filter((x) => x.code_id === c.id).length })));
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
    return send(res, 200, true);
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

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    try {
      if (/^\/(auth|rest|storage)\/v1\//.test(url.pathname)) return api(req, res, url, Buffer.concat(chunks));
      // point the app at this server instead of the live Supabase project
      if (url.pathname === '/js/config.js') return send(res, 200, `window.SB_CONFIG = { url: location.origin, anonKey: 'dev' };`, 'text/javascript');
      const file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)));
      if ((!file.startsWith(ROOT + path.sep) && file !== ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'not found', 'text/plain');
      send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
    } catch (e) {
      send(res, 500, { message: e.message });
    }
  });
}).listen(PORT, () => console.log(`Oman EM Prep dev server → http://localhost:${PORT}  (admin: /admin.html)`));
