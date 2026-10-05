/* ============================================================
   Admin — users, usage analytics, access codes,
   payment requests (receipt review) + payment details
   Standalone page (admin.html) guarded by profile.role='admin'.
   Zero dependencies: SB REST client + this file.
   ============================================================ */
'use strict';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const app = $('#admin');
let adminTab = 'overview';
let usersCache = null;
let codesCache = null;
let sessionsCache = null;
let requestsCache = [];
let promosCache = [];
let payCache = {};
let eventsCache = [];
let promoRedCache = [];
let funnelCache = [];              // v_admin_funnel: the way in, before any account exists
let failuresCache = [];            // v_admin_signup_errors: why a sign-up was refused
let sourcesCache = [];             // v_admin_visit_sources: which browser or site sent them
let rejectingId = null;            // request whose reject reasons are open
const receiptUrls = new Map();     // receipt_path -> { url, type } once fetched from the private bucket
let drillId = null;
let anDrill = null;                // analytics: { kind, key } of the figure we drilled into
let drillFrom = null;              // where a doctor card was opened from, so "back" returns there

/* ---------------- boot ---------------- */
(async function boot() {
  if (!window.SB_CONFIG || !SB_CONFIG.url || !SB_CONFIG.anonKey) {
    return renderSetup();
  }
  const authed = await SB.init().catch(() => false);
  if (!authed) return renderLogin();
  if (SB.profile?.role !== 'admin') return renderDenied();
  await loadAll();
  if (pendingRequests().length) adminTab = 'requests';   // someone is waiting: start there
  render();
  startAutoRefresh();
})();

// the bank's size, for coverage percentages: summed from the file the app itself reads
let BANK_SIZE = 0;

async function loadAll() {
  if (!BANK_SIZE) {
    BANK_SIZE = await fetch('data/sections.json').then((r) => r.json())
      .then((d) => d.sections.reduce((a, x) => a + (x.count || 0), 0)).catch(() => 0);
  }
  const [users, codes, sessions, requests, promos, pay, events, promoRed, funnel, failures, sources] = await Promise.all([
    SB.req('/rest/v1/v_admin_users?select=*&order=last_seen.desc'),
    SB.req('/rest/v1/v_admin_codes?select=*&order=created_at.desc'),
    SB.req('/rest/v1/v_admin_sessions?select=*&order=ts.desc&limit=1000'),
    // these need supabase/002_trial_paywall.sql / 004_promo_referral.sql; stay usable without them
    SB.req('/rest/v1/v_admin_requests?select=*&order=created_at.desc&limit=200').catch(() => []),
    SB.req('/rest/v1/v_admin_promos?select=*&order=created_at.desc').catch(() => []),
    SB.paymentSettings().catch(() => ({})),
    // funnel history for Analytics: who got how many bonus questions, from what, and when
    SB.req('/rest/v1/events?select=*&order=ts.desc&limit=5000').catch(() => []),
    SB.req('/rest/v1/promo_redemptions?select=*').catch(() => []),
    // the visitor funnel (supabase/006_visits.sql); empty until that is run
    SB.req('/rest/v1/v_admin_funnel?select=*').catch(() => []),
    SB.req('/rest/v1/v_admin_signup_errors?select=*').catch(() => []),
    SB.req('/rest/v1/v_admin_visit_sources?select=*').catch(() => []),
  ]);
  usersCache = users || [];
  codesCache = codes || [];
  sessionsCache = sessions || [];
  requestsCache = requests || [];
  promosCache = promos || [];
  payCache = pay || {};
  eventsCache = events || [];
  promoRedCache = promoRed || [];
  funnelCache = funnel || [];
  failuresCache = failures || [];
  sourcesCache = sources || [];
}

const pendingRequests = () => requestsCache.filter((r) => r.status === 'pending');

// new receipts show up without a manual reload (never while a form is in use)
function startAutoRefresh() {
  setInterval(async () => {
    if (document.hidden || rejectingId || drillId || !['overview', 'requests'].includes(adminTab)) return;
    try { await loadAll(); render(); } catch (e) { /* next tick */ }
  }, 45000);
}

/* ---------------- shells ---------------- */
function renderSetup() {
  app.innerHTML = shell(`
    <div class="card"><h2>المنصة الإدارية غير مربوطة</h2>
      <p class="card-meta">املأ <code>js/config.js</code> بـ url و anonKey من مشروع Supabase، وشغّل <code>supabase/schema.sql</code>، ثم أعد تحميل الصفحة.</p>
    </div>`);
}

function renderLogin(err) {
  app.innerHTML = shell(`
    <div class="card" style="max-width:420px;margin:40px auto">
      <h2>دخول المدير</h2>
      <p class="card-meta">سجّل بحساب المدير (أول حساب منشأ في المنصة).</p>
      ${err ? `<div class="auth-err">${esc(err)}</div>` : ''}
      <label class="auth-label">البريد<input id="al-email" type="email" dir="ltr"></label>
      <label class="auth-label">كلمة المرور<input id="al-pass" type="password" dir="ltr"></label>
      <button class="btn btn-primary btn-block" id="al-go">دخول</button>
    </div>`);
  $('#al-go').addEventListener('click', async () => {
    try {
      await SB.login($('#al-email').value.trim(), $('#al-pass').value);
      if (SB.profile?.role !== 'admin') return renderDenied();
      await loadAll();
      if (pendingRequests().length) adminTab = 'requests';
      render();
      startAutoRefresh();
    } catch (e) { renderLogin(e.message); }
  });
}

function renderDenied() {
  app.innerHTML = shell(`<div class="card"><h2>غير مصرح</h2><p class="card-meta">هذه الصفحة لحسابات المديرين فقط. حسابك: ${esc(SB.profile?.email || '')}</p>
    <button class="btn" onclick="SB.logout();location.reload()">تبديل الحساب</button></div>`);
}

function shell(inner) {
  const waiting = pendingRequests().length;
  document.title = (waiting ? `(${waiting}) ` : '') + EDITION.appName + ' — Admin';
  const tabs = [
    ['overview', '📊', 'Overview'],
    ['requests', '🧾', 'Requests' + (waiting ? `<span class="tab-badge">${waiting}</span>` : '')],
    ['doctors', '👨‍⚕️', 'Doctors'],
    ['analytics', '📈', 'Analytics'],
    ['codes', '🔑', 'Codes'],
    ['growth', '🎁', 'Growth'],
    ['payment', '💳', 'Payment'],
  ];
  return `
    <div class="topbar"><div class="topbar-inner">
      <div class="brand"><div class="brand-logo">AD</div>
        <div><div class="brand-name">Admin</div></div></div>
      <div style="display:flex;gap:8px;align-items:center">
        ${SB.profile ? `<span class="card-meta">${esc(SB.profile.email)}</span>` : ''}
        ${SB.session ? `<button class="btn" onclick="SB.logout();location.reload()">خروج</button>` : ''}
      </div>
    </div></div>
    <div class="wrap" style="max-width:1060px">
      ${SB.session ? `<nav class="tabbar">${tabs.map(([id, icon, label]) =>
        `<a class="tab ${adminTab === id ? 'active' : ''}" href="#" onclick="switchTab('${id}');return false">
          <span class="tab-icon">${icon}</span><span class="tab-text"><span class="tab-label">${label}</span></span></a>`).join('')}</nav>` : ''}
      ${inner}
    </div>`;
}

function switchTab(t) { adminTab = t; drillId = null; rejectingId = null; anDrill = null; drillFrom = null; render(); }

/* ---------------- overview ---------------- */
function renderOverview() {
  const doctors = usersCache.filter((u) => u.role === 'doctor');
  const weekAgo = Date.now() - 7 * 864e5;
  const active7 = doctors.filter((u) => new Date(u.last_seen).getTime() > weekAgo).length;
  const totalCovered = doctors.reduce((a, u) => a + (u.covered || 0), 0);
  const avgCoverage = doctors.length ? Math.round((totalCovered / doctors.length / (BANK_SIZE || 1)) * 100) : 0;
  const codesLeft = codesCache.filter((c) => c.active).reduce((a, c) => a + Math.max(0, c.max_uses - c.uses), 0);

  // activity: sessions per day, last 14 days
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5);
    days.push({ key: d.toISOString().slice(0, 10), label: d.toLocaleDateString(undefined, { weekday: 'narrow' }), n: 0 });
  }
  const byKey = new Map(days.map((d) => [d.key, d]));
  sessionsCache.forEach((s) => { const d = byKey.get(String(s.ts).slice(0, 10)); if (d) d.n++; });
  const maxN = Math.max(1, ...days.map((d) => d.n));

  const recent = doctors.slice(0, 5);

  return `
    <div class="overall" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">
      <div class="stat-card"><div class="stat-num">${doctors.length}</div><div class="stat-label">Doctors</div></div>
      <div class="stat-card"><div class="stat-num">${active7}</div><div class="stat-label">Active last 7 days</div></div>
      <div class="stat-card"><div class="stat-num">${avgCoverage}%</div><div class="stat-label">Avg coverage</div></div>
      <div class="stat-card"><div class="stat-num">${codesLeft}</div><div class="stat-label">Codes remaining</div></div>
      <div class="stat-card" style="cursor:pointer" onclick="switchTab('requests')"><div class="stat-num">${pendingRequests().length}</div><div class="stat-label">Receipts to review</div></div>
    </div>
    <div class="card">
      <div class="section-heading" style="margin:0 0 10px"><h2>Sessions — last 14 days</h2></div>
      <div class="bars">${days.map((d) => `
        <div class="bar-col" title="${d.key}: ${d.n} sessions">
          <div class="bar" style="height:${Math.round((d.n / maxN) * 64)}px"></div>
          <span>${d.label}</span>
        </div>`).join('')}</div>
    </div>
    <div class="section-heading"><h2>Latest signups / activity</h2></div>
    <div class="hist-list">${recent.map((u) => `
      <div class="hist-row">
        <span class="hist-title">${esc(u.name || u.email)}</span>
        <span class="hist-meta">${u.covered || 0} covered · ${new Date(u.last_seen).toLocaleDateString()}</span>
      </div>`).join('') || '<div class="card"><div class="card-meta">No doctors yet.</div></div>'}</div>`;
}

/* ---------------- doctors ---------------- */
const PARTS = 3;   // the bank can be bought in thirds (supabase/003_plans.sql)
const accessOf = (u) => (u.code_id || u.access_status === 'active' || (u.parts || 0) >= PARTS) ? 'active' : (u.access_status || 'trial');
// a doctor paying by parts shows how many they hold: "part 1/3", "pending 1/3"
const accessLabel = (u) => {
  const a = accessOf(u);
  return a === 'active' || !u.parts ? a : `${a === 'trial' ? 'part' : a} ${u.parts}/${PARTS}`;
};
const statusChip = (u) => u.role === 'admin' ? '' : ` <span class="status-chip ${accessOf(u)}">${accessLabel(u)}</span>`;
const planLabel = (r) => r.plan === 'part' ? `جزء من ${PARTS}` : 'اشتراك كامل';
const waHref = (phone) => 'https://wa.me/' + String(phone || '').replace(/\D/g, '');

function renderDoctors() {
  if (drillId) return renderDrill();
  const q = (window._docQuery || '').toLowerCase();
  const rows = usersCache
    .filter((u) => !q || (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q))
    .map((u) => {
      const covPct = BANK_SIZE ? Math.round(((u.covered || 0) / BANK_SIZE) * 100) : 0;
      const rel = relTime(u.last_seen);
      return `
        <div class="hist-row" style="cursor:pointer" onclick="openDrill('${u.id}')">
          <span class="hist-title">${esc(u.name || u.email)}${u.role === 'admin' ? ' <span class="domain-weak" style="background:var(--primary-soft);color:var(--primary)">admin</span>' : ''}${statusChip(u)}<br>
            <span class="hist-meta" style="font-weight:400">${esc(u.email || '')}</span></span>
          <span class="hist-meta">coverage ${covPct}% · ${u.attempts || 0} attempts · mastered ${u.mastered || 0} · ${rel}</span>
        </div>`;
    }).join('');
  return `
    <input id="doc-search" placeholder="بحث بالاسم أو البريد…" dir="auto"
      style="width:100%;max-width:380px;padding:9px 13px;border:1.5px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text);font-family:inherit;margin-bottom:12px"
      value="${esc(window._docQuery || '')}">
    <div class="hist-list" id="doc-list">${rows || '<div class="card"><div class="card-meta">لا نتائج.</div></div>'}</div>`;
}

async function openDrill(id) {
  drillId = id;
  render();
  try {
    const [prog, sess] = await Promise.all([
      SB.req('/rest/v1/progress?user_id=eq.' + id + '&select=*'),
      SB.req('/rest/v1/sessions_log?user_id=eq.' + id + '&select=*&order=ts.desc&limit=10'),
    ]);
    drillData = { prog: prog || [], sess: sess || [] };
    render();
  } catch (e) { drillData = { err: e.message }; render(); }
}
let drillData = null;

function closeDrill() {
  drillId = null; drillData = null;
  if (drillFrom) { adminTab = drillFrom.tab; anDrill = drillFrom.anDrill; drillFrom = null; }
  render();
}

function renderDrill() {
  const u = usersCache.find((x) => x.id === drillId);
  if (!u) { closeDrill(); return ''; }
  let weak = '', sessHtml = '';
  if (drillData) {
    if (drillData.err) weak = `<div class="card"><div class="card-meta">${esc(drillData.err)}</div></div>`;
    else {
      const bySec = {};
      drillData.prog.forEach((r) => {
        const k = r.section_id || 'general';
        bySec[k] = bySec[k] || { covered: 0, mastered: 0, attempts: 0, correct: 0 };
        bySec[k].covered++;
        if ((r.streak || 0) >= 3) bySec[k].mastered++;
        bySec[k].attempts += r.attempts || 0;
        bySec[k].correct += r.correct || 0;
      });
      weak = Object.entries(bySec)
        .map(([k, v]) => ({ k, acc: v.attempts ? Math.round((v.correct / v.attempts) * 100) : 0, ...v }))
        .sort((a, b) => a.acc - b.acc)
        .slice(0, 6)
        .map((v) => `<div class="domain-row">
            <span class="domain-name">${esc(v.k)}</span>
            <span class="domain-score ${v.acc >= 70 ? 'ok' : v.acc >= 50 ? 'mid' : 'low'}">${v.acc}%</span>
            <span class="domain-meta">${v.correct}/${v.attempts}</span>
          </div>`).join('') || '<div class="card"><div class="card-meta">لا بيانات بعد.</div></div>';
      sessHtml = drillData.sess.map((s) => `
        <div class="hist-row">
          <span class="hist-score ${s.total ? Math.round((s.score / s.total) * 100) >= 70 ? 'ok' : 'no' : 'no'}">${s.total ? Math.round((s.score / s.total) * 100) + '%' : '—'}</span>
          <span class="hist-title">${esc(s.title || s.kind || '')}</span>
          <span class="hist-meta">${s.score}/${s.total} · ${new Date(s.ts).toLocaleDateString()}</span>
        </div>`).join('') || '<div class="card"><div class="card-meta">لا جلسات.</div></div>';
    }
  } else {
    weak = '<div class="card"><div class="card-meta">…loading</div></div>';
  }
  return `
    <button class="back-link" onclick="closeDrill()">${drillFrom ? '← رجوع إلى التقرير' : '← All doctors'}</button>
    <div class="sec-hero">
      <div class="card-icon big">👨‍⚕️</div>
      <div>
        <h1>${esc(u.name || u.email)}</h1>
        <div class="card-meta">${esc(u.email || '')} · member since ${new Date(u.created_at).toLocaleDateString()} · last seen ${relTime(u.last_seen)}</div>
        <div class="card-meta">coverage ${u.covered || 0}/${BANK_SIZE} · attempts ${u.attempts || 0} · mastered ${u.mastered || 0}</div>
        ${(u.bonus_questions || u.referrals || u.referral_code) ? `<div class="card-meta">🎁 bonus ${u.bonus_questions || 0} · referred ${u.referrals || 0} (${u.referrals_paid || 0} paid)${u.referral_code ? ' · code ' + esc(u.referral_code) : ''}</div>` : ''}
        ${u.role === 'admin' ? '' : `
          <div class="req-actions">
            <span class="status-chip ${accessOf(u)}">${accessLabel(u)}</span>
            ${u.phone ? `<a class="btn" target="_blank" rel="noopener" href="${waHref(u.phone)}">💬 ${esc(u.phone)}</a>` : ''}
            ${accessOf(u) === 'active'
              ? (u.code_id ? '' : `<button class="btn" onclick="setAccess('${u.id}', 'trial')">إلغاء التفعيل</button>`)
              : `<button class="btn btn-primary" onclick="setAccess('${u.id}', 'active')">تفعيل يدوي (وصول كامل)</button>
                 ${u.parts === undefined ? '' : `<button class="btn" onclick="addPart('${u.id}', ${(u.parts || 0) + 1})">فتح الجزء ${(u.parts || 0) + 1} من ${PARTS} يدوياً</button>`}`}
          </div>`}
      </div>
    </div>
    <div class="section-heading"><h2>Weakest sections</h2></div>
    <div class="domain-table">${weak}</div>
    <div class="section-heading"><h2>Recent sessions</h2></div>
    <div class="hist-list">${sessHtml}</div>`;
}

// activate (or revert) a doctor without a receipt — e.g. paid in cash
async function setAccess(id, status) {
  try {
    await SB.req('/rest/v1/profiles?id=eq.' + id, { method: 'PATCH', body: { access_status: status, reject_reason: null } });
    await loadAll(); render();
  } catch (e) { alert('تعذر التعديل: ' + e.message); }
}

// open one more third without a receipt; the last third is full access
async function addPart(id, parts) {
  try {
    await SB.req('/rest/v1/profiles?id=eq.' + id, { method: 'PATCH', body: { parts, access_status: parts >= PARTS ? 'active' : 'trial', reject_reason: null } });
    await loadAll(); render();
  } catch (e) { alert('تعذر التعديل: ' + e.message); }
}

/* ---------------- requests: receipt review ---------------- */
const REJECT_REASONS = ['الصورة غير واضحة', 'المبلغ غير مطابق', 'لم نجد التحويل في الحساب'];

function receiptThumb(r) {
  const got = receiptUrls.get(r.receipt_path);
  if (!got) return `<div class="req-thumb" data-path="${esc(r.receipt_path)}">…loading</div>`;
  if (got.err) return `<div class="req-thumb">تعذر تحميل الإيصال</div>`;
  return `<div class="req-thumb" onclick="window.open('${got.url}', '_blank')">${got.type.startsWith('image/')
    ? `<img src="${got.url}" alt="receipt">`
    : '📄 فتح الإيصال'}</div>`;
}

function renderRequests() {
  const pending = pendingRequests();
  const done = requestsCache.filter((r) => r.status !== 'pending').slice(0, 30);
  const pendingHtml = pending.map((r) => `
    <div class="card req-card">
      ${receiptThumb(r)}
      <div class="req-body">
        <div class="card-title">${esc(r.name || r.email)}</div>
        <div class="card-meta">${esc(r.email || '')} · ${r.covered || 0} questions answered · sent ${relTime(r.created_at)}</div>
        <div class="card-meta">يطلب: <b>${r.plan === 'part' ? `الجزء ${(r.parts || 0) + 1} من ${PARTS}` : 'الاشتراك الكامل'}</b> · المبلغ المتوقع في الإيصال: <b dir="auto">${esc((r.plan === 'part' ? payCache.part_price : payCache.price) || '—')}</b></div>
        ${r.phone ? `<a class="btn" style="margin-top:8px" target="_blank" rel="noopener" href="${waHref(r.phone)}">💬 ${esc(r.phone)}</a>` : ''}
        ${rejectingId === r.id ? `
          <div class="card-meta" style="margin-top:10px">سبب الرفض — يظهر للطبيب ويستطيع إعادة الرفع فوراً:</div>
          <div class="req-actions">
            ${REJECT_REASONS.map((t) => `<button class="btn btn-danger-soft" onclick="rejectRequest('${r.id}', '${t}')">${t}</button>`).join('')}
            <button class="btn btn-ghost" onclick="openReject(null)">تراجع</button>
          </div>` : `
          <div class="req-actions">
            <button class="btn btn-primary" onclick="approveRequest('${r.id}')">${r.plan === 'part' ? `✓ قبول وفتح الجزء ${(r.parts || 0) + 1}` : '✓ قبول وفتح الحساب'}</button>
            <button class="btn" onclick="openReject('${r.id}')">✗ رفض</button>
          </div>`}
      </div>
    </div>`).join('') || '<div class="card"><div class="card-meta">لا إيصالات بانتظار المراجعة 🎉</div></div>';

  const doneHtml = done.map((r) => `
    <div class="hist-row">
      <span class="hist-title">${esc(r.name || r.email)} <span class="status-chip ${r.status}">${r.status}</span> <span class="hist-meta">${planLabel(r)}</span>
        ${r.reject_reason ? `<span class="hist-meta">${esc(r.reject_reason)}</span>` : ''}</span>
      <span class="hist-meta">${new Date(r.reviewed_at || r.created_at).toLocaleDateString()}</span>
      <button class="btn" onclick="openReceipt('${esc(r.receipt_path)}')">الإيصال</button>
    </div>`).join('');

  return `
    <div class="section-heading"><h2>Waiting for review</h2><span>${pending.length} إيصال</span></div>
    ${pendingHtml}
    ${doneHtml ? `<div class="section-heading"><h2>Reviewed</h2><span>آخر المراجعات</span></div><div class="hist-list">${doneHtml}</div>` : ''}`;
}

const receiptJobs = new Map();      // receipt_path -> promise, so each file is fetched once
function loadReceipt(path) {
  if (!receiptJobs.has(path)) {
    receiptJobs.set(path, SB.fetchReceipt(path)
      .then((blob) => ({ url: URL.createObjectURL(blob), type: blob.type || '' }))
      .catch(() => ({ err: true }))
      .then((got) => { receiptUrls.set(path, got); return got; }));
  }
  return receiptJobs.get(path);
}

async function openReceipt(path) {
  const tab = window.open('', '_blank');   // opened in the click itself, so it is not blocked
  const got = await loadReceipt(path);
  if (got.err) { tab?.close(); alert('تعذر تحميل الإيصال'); }
  else if (tab) tab.location = got.url;
}

function openReject(id) { rejectingId = id; render(); }

async function approveRequest(id) {
  try {
    await SB.req('/rest/v1/rpc/approve_request', { method: 'POST', body: { p_id: id } });
    await loadAll(); render();
  } catch (e) { alert('تعذر القبول: ' + e.message); }
}

async function rejectRequest(id, reason) {
  try {
    await SB.req('/rest/v1/rpc/reject_request', { method: 'POST', body: { p_id: id, p_reason: reason } });
    rejectingId = null;
    await loadAll(); render();
  } catch (e) { alert('تعذر الرفض: ' + e.message); }
}

/* ---------------- payment details shown to doctors ---------------- */
const PAY_FIELDS = [
  ['price', 'سعر الاشتراك الكامل', EDITION.priceFull],
  ['part_price', 'سعر الجزء الواحد (البنك 3 أجزاء)', EDITION.pricePart],
  ['beneficiary', 'اسم المستفيد', ''],
  ['bank', 'البنك', EDITION.bankPlaceholder],
  ['account', 'رقم الحساب / IBAN', ''],
  ['pay_link', 'رابط دفع (اختياري)', 'https://…'],
  ['whatsapp', 'واتساب الدعم (بمفتاح الدولة)', EDITION.whatsappPlaceholder],
];

function renderPayment() {
  return `
    <div class="card">
      <div class="section-heading" style="margin:0 0 12px"><h2>Payment details</h2><span>تظهر للطبيب بعد انتهاء أسئلته المجانية — الفارغ لا يظهر</span></div>
      <div class="settings-grid">
        ${PAY_FIELDS.map(([key, label, ph]) => `
          <label class="auth-label">${label}
            <input id="pay-${key}" dir="auto" placeholder="${esc(ph)}" value="${esc(payCache[key] || '')}">
          </label>`).join('')}
        <label class="auth-label" style="grid-column:1/-1">ملاحظة للطبيب (اختياري)
          <textarea id="pay-note" dir="auto" placeholder="مثال: اكتب اسمك في خانة وصف التحويل">${esc(payCache.note || '')}</textarea>
        </label>
      </div>
      <div style="display:flex;gap:10px;align-items:center">
        <button class="btn btn-primary" id="pay-save">حفظ</button>
        <span id="pay-out" class="card-meta"></span>
      </div>
    </div>`;
}

async function savePayment() {
  const body = { updated_at: new Date().toISOString(), note: $('#pay-note').value.trim() || null };
  PAY_FIELDS.forEach(([key]) => { body[key] = $('#pay-' + key).value.trim() || null; });
  if (!('part_price' in payCache)) delete body.part_price;   // the column arrives with supabase/003_plans.sql
  try {
    await SB.req('/rest/v1/payment_settings?id=eq.1', { method: 'PATCH', body });
    payCache = { ...payCache, ...body };
    $('#pay-out').textContent = 'تم الحفظ ✓';
  } catch (e) {
    $('#pay-out').textContent = 'خطأ: ' + e.message;
  }
}

/* ---------------- analytics: who pays, who is free, and why ---------------- */
/* Walkable three levels deep: every figure opens the list behind it (anOpen),
   and every person in that list opens their doctor card (anDoctor, which comes
   back here). Built from what the admin already loads — profiles, access_requests,
   promo_codes/redemptions and public.events (code_redeemed / receipt_submitted /
   promo_redeemed / referral_signup / referral_paid). */
const AN_RANGES = [[7, '7 أيام'], [30, '30 يوماً'], [90, '90 يوماً'], [0, 'الكل']];
const SOURCE_ORDER = ['trial', 'pending', 'paid_full', 'paid_part', 'code', 'manual', 'rejected'];
const SOURCE_LABEL = {
  trial: 'تجربة مجانية', pending: 'بانتظار المراجعة',
  paid_full: 'مدفوع — اشتراك كامل', paid_part: 'مدفوع — بالأجزاء',
  code: 'رمز وصول مجاني', manual: 'تفعيل يدوي بلا إيصال', rejected: 'مرفوض',
};
const SOURCE_WHY = {
  trial: 'ما زالوا داخل الأسئلة المجانية ولم يرسلوا إيصالاً',
  pending: 'أرسلوا إيصالاً ينتظر مراجعتك الآن',
  paid_full: 'إيصال اشتراك كامل مقبول — بيع حقيقي',
  paid_part: 'إيصال جزء مقبول — بيع حقيقي لم يكتمل بعد',
  code: 'دخلوا برمز من تبويب Codes — وصول مجاني، ليس بيعاً',
  manual: 'فعّلتَ حسابهم يدوياً بلا إيصال ولا رمز',
  rejected: 'رُفض إيصالهم ولم يرسلوا بديلاً',
};
const EVENT_LABEL = {
  promo_redeemed: 'استخدم بروموكود',
  referral_signup: 'مكافأة دعوة — انضم صديق',
  referral_paid: 'مكافأة دعوة — اشترك صديق',
  code_redeemed: 'استخدم رمز وصول',
  receipt_submitted: 'أرسل إيصالاً',
};
const BONUS_KINDS = ['promo_redeemed', 'referral_signup', 'referral_paid'];
const REALLY_PAID = new Set(['paid_full', 'paid_part']);   // a receipt was accepted; a free code is not a sale
const priceNum = (s) => parseFloat(String(s || '').match(/[\d.]+/)?.[0] || 0) || 0;
const dayStr = (ts) => new Date(ts).toLocaleDateString();
const timeStr = (ts) => new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
// Arabic noun agreement after a written digit: only 3-10 (by the last two digits)
// takes the plural — "2 إيصال", "7 أطباء", "500 سؤال"
const arN = (n, one, few) => ((n % 100) >= 3 && (n % 100) <= 10 ? few : one);
const arDoc = (n) => `${n} ${arN(n, 'طبيب', 'أطباء')}`;
const arRec = (n) => `${n} ${arN(n, 'إيصال', 'إيصالات')}`;
const arQ = (n) => `${n} ${arN(n, 'سؤال', 'أسئلة')}`;
const arAcc = (n) => `${n} ${arN(n, 'حساب', 'حسابات')}`;
const arInv = (n) => `${n} ${arN(n, 'دعوة', 'دعوات')}`;
const anRangeLabel = () => {
  const r = window._anRange ?? 30;
  return r ? AN_RANGES.find(([v]) => v === r)[1] : 'كل الفترات';
};

// why a doctor currently has (or doesn't have) access: a real receipt, a free code,
// an admin's manual override, or still trial/pending/rejected
function sourceOf(u, reqByUser) {
  const reqs = reqByUser.get(u.id) || [];
  if (u.code_id) return 'code';
  if (reqs.some((r) => r.status === 'approved' && r.plan === 'full')) return 'paid_full';
  if (reqs.some((r) => r.status === 'approved' && r.plan === 'part')) return 'paid_part';
  if (u.access_status === 'active' || (u.parts || 0) >= 3) return 'manual';
  if (u.access_status === 'pending') return 'pending';
  if (u.access_status === 'rejected') return 'rejected';
  return 'trial';
}

// everything both the dashboard and its drill-downs read, computed once
function anModel() {
  const range = window._anRange ?? 30;
  const cutoff = range ? Date.now() - range * 864e5 : 0;
  const inRange = (ts) => new Date(ts).getTime() >= cutoff;
  const doctors = usersCache.filter((u) => u.role !== 'admin');
  const allById = new Map(usersCache.map((u) => [u.id, u]));

  const reqByUser = new Map();
  requestsCache.forEach((r) => { const a = reqByUser.get(r.user_id) || []; a.push(r); reqByUser.set(r.user_id, a); });
  const srcByUser = new Map();
  const counts = {};
  doctors.forEach((u) => { const s = sourceOf(u, reqByUser); srcByUser.set(u.id, s); counts[s] = (counts[s] || 0) + 1; });

  const amountOf = (r) => (r.plan === 'part' ? priceNum(payCache.part_price) : priceNum(payCache.price));
  const reqs = requestsCache.filter((r) => inRange(r.created_at));
  const approved = reqs.filter((r) => r.status === 'approved');
  const rejected = reqs.filter((r) => r.status === 'rejected');
  const pending = requestsCache.filter((r) => r.status === 'pending');   // they are waiting now, whatever the period
  const revenue = approved.reduce((a, r) => a + amountOf(r), 0);
  const cohort = doctors.filter((u) => inRange(u.created_at));
  const cohortPaid = cohort.filter((u) => REALLY_PAID.has(srcByUser.get(u.id)));
  const events = eventsCache.filter((e) => inRange(e.ts));

  const bonus = {};
  events.forEach((e) => { if (BONUS_KINDS.includes(e.name)) bonus[e.name] = (bonus[e.name] || 0) + ((e.meta && e.meta.reward) || 0); });

  // one bar per day for short periods, per week for long ones
  const unitDays = range && range <= 30 ? 1 : 7;
  const span = range === 7 ? 7 : range === 30 ? 30 : 13;
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const series = [];
  for (let i = span - 1; i >= 0; i--) {
    const to = midnight.getTime() + 864e5 - i * unitDays * 864e5;
    const from = to - unitDays * 864e5;
    const hit = (ts) => { const t = new Date(ts).getTime(); return t > from && t <= to; };
    const paidHere = approved.filter((r) => hit(r.reviewed_at || r.created_at));
    const d = new Date(from);
    series.push({
      from, to,
      signups: doctors.filter((u) => hit(u.created_at)).length,
      paid: paidHere.length,
      revenue: paidHere.reduce((a, r) => a + amountOf(r), 0),
      // short labels only — a date string per column makes the chart wider than a phone;
      // the full date is in the column's tooltip and in its drill-down
      label: span <= 14 || i % 5 === 0 ? String(d.getDate()) : '',
      title: unitDays === 1 ? dayStr(from) : 'أسبوع ' + dayStr(from),
    });
  }

  return { range, inRange, doctors, allById, srcByUser, counts, amountOf, reqs, approved, rejected, pending, revenue, cohort, cohortPaid, events, bonus, series };
}

function setAnRange(n) { window._anRange = n; anDrill = null; render(); }
function anOpen(kind, key) { anDrill = { kind, key: key === undefined ? null : String(key) }; render(); window.scrollTo(0, 0); }
function anBack() { anDrill = null; render(); }
// open a doctor's card and remember to come back to this exact report view
function anDoctor(id) { drillFrom = { tab: 'analytics', anDrill }; adminTab = 'doctors'; openDrill(id); }

function hbar(label, n, max, click) {
  const pct = max ? Math.round((n / max) * 100) : 0;
  return `<div class="hbar-row${click ? ' click' : ''}"${click ? ` onclick="${click}"` : ''}>
    <span class="hbar-label">${esc(label)}</span>
    <div class="hbar-track"><div class="hbar-fill" style="width:${pct}%"></div></div>
    <span class="hbar-num">${n} <small>${pct}%</small></span></div>`;
}

const anCard = (num, label, click) => `<div class="stat-card${click ? ' click' : ''}"${click ? ` onclick="${click}"` : ''}>
  <div class="stat-num">${num}</div><div class="stat-label">${label}</div></div>`;

// one clickable person row; `meta` is already-escaped html
const anDocRow = (u, meta) => (u
  ? `<div class="hist-row" style="cursor:pointer" onclick="anDoctor('${u.id}')">
      <span class="hist-title">${esc(u.name || u.email || '—')}${statusChip(u)}<br>
        <span class="hist-meta" style="font-weight:400">${esc(u.email || '')}</span></span>
      <span class="hist-meta">${meta}</span></div>`
  : `<div class="hist-row"><span class="hist-title">حساب محذوف</span><span class="hist-meta">${meta}</span></div>`);

const anEmpty = (t) => `<div class="card"><div class="card-meta bidi">${esc(t)}</div></div>`;

/* ---------------- the visitors who never became doctors ---------------- */
/* public.events starts at the account; this starts at the first screen. The
   rows are aggregates by design — the visitor is anonymous, so no figure here
   opens on a name. Counting is by browser per day: a doctor who comes back
   tomorrow is a second visit, not a second person. */
const STEP_ORDER = [
  ['landing', 'فتحوا صفحة الهبوط', null],
  ['landing_cta', 'ضغطوا زر البدء', 'landing'],
  ['app_open', 'وصلوا إلى التطبيق', null],      // a second door: some open the app's address itself
  ['auth_view', 'رأوا نموذج التسجيل', 'app_open'],
  ['auth_try', 'حاولوا إنشاء الحساب', 'auth_view'],
  ['auth_ok', 'أنشأوا الحساب', 'auth_try'],
  ['first_question', 'أجابوا أول سؤال', 'auth_ok'],
];
const FAIL_LABEL = {
  email_taken: 'بريد مسجّل من قبل', wrong_password: 'كلمة مرور خاطئة',
  short_password: 'كلمة المرور قصيرة', bad_phone: 'رقم واتساب غير مقبول',
  no_name: 'لم يُدخل الاسم', empty: 'ترك حقلاً فارغاً',
  needs_confirm: 'ينتظر تأكيد البريد', rate_limit: 'محاولات كثيرة',
  network: 'انقطع الاتصال', other: 'سبب آخر',
};
const DEVICE_LABEL = { iphone: 'آيفون', android: 'أندرويد', desktop: 'حاسوب', other: 'غير معروف' };
const arVisit = (n) => `${n} ${arN(n, 'زيارة', 'زيارات')}`;

function visitModel() {
  const range = window._anRange ?? 30;
  const cutoff = range ? new Date(Date.now() - range * 864e5).toISOString().slice(0, 10) : '';
  const inR = (r) => !cutoff || String(r.day) >= cutoff;
  const rows = funnelCache.filter(inR);

  const sum = (pick) => rows.reduce((a, r) => (pick(r) ? a + (r.visitors || 0) : a), 0);
  const steps = STEP_ORDER.map(([key, label, base]) => ({ key, label, base, n: sum((r) => r.step === key) }));

  // the same funnel per device, and for a visit that arrived inside a social app
  const cut = (pick) => ({
    landing: sum((r) => pick(r) && (r.step === 'landing' || r.step === 'app_open')),
    account: sum((r) => pick(r) && r.step === 'auth_ok'),
  });
  const devices = ['iphone', 'android', 'desktop'].map((d) => ({ key: d, label: DEVICE_LABEL[d], ...cut((r) => r.device === d) }));
  const inApp = cut((r) => r.in_app);
  const plain = cut((r) => !r.in_app);

  const install = {
    sheet: sum((r) => r.step === 'install_sheet'),
    ok: sum((r) => r.step === 'install_ok'),
    skip: sum((r) => r.step === 'install_skip'),
  };

  const fails = new Map();
  failuresCache.filter(inR).forEach((r) => fails.set(r.reason, (fails.get(r.reason) || 0) + (r.visitors || 0)));
  const failRows = [...fails.entries()].sort((a, b) => b[1] - a[1]);
  const failTotal = failRows.reduce((a, [, n]) => a + n, 0);

  const src = new Map();
  sourcesCache.filter(inR).forEach((r) => {
    const key = r.source !== 'browser' ? r.source : (r.came_from || 'مباشرة');
    src.set(key, (src.get(key) || 0) + (r.visitors || 0));
  });
  const srcRows = [...src.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

  return { steps, devices, inApp, plain, install, failRows, failTotal, srcRows, any: rows.length > 0 };
}

function renderVisitors() {
  const v = visitModel();
  const rl = anRangeLabel();
  if (!v.any) {
    return `
      <div class="section-heading"><h2>الزوار قبل التسجيل</h2><span>${rl}</span></div>
      ${anEmpty('لا بيانات زوار بعد. تصل أول الأرقام بعد نشر نسخة فيها js/track.js — وتأكد أن supabase/006_visits.sql شُغّل على المشروع.')}`;
  }

  const byKey = Object.fromEntries(v.steps.map((st) => [st.key, st.n]));
  const top = Math.max(1, ...v.steps.map((st) => st.n));
  const rows = v.steps.map((st) => {
    const base = st.base ? byKey[st.base] || 0 : 0;
    const pass = base ? Math.round((st.n / base) * 100) : null;
    const lost = Math.max(0, base - st.n);
    const note = pass === null ? '<small>مدخل</small>' : `<small>${pass}% · فقدنا ${lost}</small>`;
    return `<div class="hbar-row">
      <span class="hbar-label">${esc(st.label)}</span>
      <div class="hbar-track"><div class="hbar-fill" style="width:${Math.round((st.n / top) * 100)}%"></div></div>
      <span class="hbar-num">${st.n} ${note}</span>
    </div>`;
  }).join('');

  const rate = (c) => (c.landing ? Math.round((c.account / c.landing) * 100) : 0);
  const deviceRows = v.devices.map((d) => hbar(`${d.label} — ${d.account} من ${d.landing}`, rate(d), 100)).join('');

  const failRows = v.failRows.map(([reason, n]) => `
    <div class="hist-row">
      <span class="hist-title">${esc(FAIL_LABEL[reason] || reason)}</span>
      <span class="hist-meta">${arVisit(n)} · ${v.failTotal ? Math.round((n / v.failTotal) * 100) : 0}%</span>
    </div>`).join('') || anEmpty('لا محاولة تسجيل فاشلة في هذه الفترة — وهذا خبر جيد.');

  const srcRows = v.srcRows.map(([name, n]) => `
    <div class="hist-row"><span class="hist-title">${esc(name)}</span><span class="hist-meta">${arVisit(n)}</span></div>`).join('')
    || anEmpty('لا مصادر مسجّلة بعد.');

  const inAppNote = v.inApp.landing
    ? `جاء ${arVisit(v.inApp.landing)} من داخل متصفح فيسبوك/إنستغرام/تيك توك، أنشأ منها ${v.inApp.account} حساباً (${rate(v.inApp)}%) — مقابل ${rate(v.plain)}% من المتصفح العادي.`
    : 'لم تصل زيارات من داخل تطبيقات التواصل في هذه الفترة.';

  return `
    <div class="section-heading"><h2>الزوار قبل التسجيل</h2><span>${rl} · أرقام مجهولة، لا تُفتح على أسماء</span></div>

    <div class="card">
      <div class="section-heading" style="margin:0 0 6px"><h2>مسار الدخول</h2><span>كل سطر: كم وصل، وكم عبر من السطر الذي قبله</span></div>
      ${rows}
      <div class="card-meta bidi" style="margin-top:8px">للدخول بابان، وكلٌّ منهما «مدخل» لا نسبة له: صفحة الهبوط، وعنوان التطبيق نفسه لمن يفتحه مباشرة أو من رابط دعوة. كل سطر بعدهما نسبة من السطر الذي يسبقه مباشرة. والعدّ بالمتصفح في اليوم: من عاد غداً يُحسب زيارة أخرى، لا شخصاً آخر.</div>
    </div>

    <div class="card">
      <div class="section-heading" style="margin:0 0 6px"><h2>نسبة من أنشأ حساباً، بحسب الجهاز</h2><span>${rl}</span></div>
      ${deviceRows}
      <div class="card-meta bidi" style="margin-top:8px">${inAppNote}</div>
    </div>

    <div class="card">
      <div class="section-heading" style="margin:0 0 6px"><h2>التثبيت</h2><span>${rl}</span></div>
      ${hbar('ثبّتوا التطبيق', v.install.ok, v.install.sheet || 1)}
      ${hbar('أجّلوا التثبيت', v.install.skip, v.install.sheet || 1)}
      <div class="card-meta bidi" style="margin-top:8px">عُرضت ورقة التثبيت ${arVisit(v.install.sheet)}.</div>
    </div>

    <div class="section-heading"><h2>لماذا فشل التسجيل</h2><span>${arVisit(v.failTotal)} · ${rl}</span></div>
    <div class="hist-list">${failRows}</div>

    <div class="section-heading"><h2>من أين جاء الزوار</h2><span>${rl}</span></div>
    <div class="hist-list">${srcRows}</div>`;
}

function renderAnalytics() {
  const m = anModel();
  if (anDrill) return renderAnDrill(m);
  const rl = anRangeLabel();
  const total = m.doctors.length || 1;
  const maxBar = Math.max(1, ...m.series.map((s) => Math.max(s.signups, s.paid)));
  const reviewed = m.approved.length + m.rejected.length;
  const approvalRate = reviewed ? Math.round((m.approved.length / reviewed) * 100) : 0;
  const convRate = m.cohort.length ? Math.round((m.cohortPaid.length / m.cohort.length) * 100) : 0;
  const avgCovered = m.reqs.length ? Math.round(m.reqs.reduce((a, r) => a + (r.covered || 0), 0) / m.reqs.length) : 0;
  const grantedTotal = BONUS_KINDS.reduce((a, k) => a + (m.bonus[k] || 0), 0);
  const heldNow = m.doctors.reduce((a, u) => a + (u.bonus_questions || 0), 0);

  const promoRows = promosCache.map((c) => {
    const reds = promoRedCache.filter((r) => r.promo_id === c.id);
    const granted = reds.length ? reds.reduce((a, r) => a + (r.reward || 0), 0) : c.uses * (c.reward_questions || 0);
    const paid = reds.filter((r) => REALLY_PAID.has(m.srcByUser.get(r.user_id))).length;
    return `<div class="hist-row" style="cursor:pointer" onclick="anOpen('promo','${c.id}')">
      <span class="hist-title"><code style="font-size:14px;letter-spacing:.06em">${esc(c.code)}</code>
        ${c.label ? `<span class="hist-meta">${esc(c.label)}</span>` : ''}${c.active ? '' : ' · <b style="color:var(--wrong)">ملغى</b>'}</span>
      <span class="hist-meta">${c.uses}/${c.max_uses} استخدام · ${arQ(granted)} مُنح · ${paid} دفعوا بعده</span>
    </div>`;
  }).join('') || anEmpty('لا رموز دعائية بعد — أنشئ واحداً من تبويب Growth.');

  const totalReferrals = m.doctors.reduce((a, u) => a + (u.referrals || 0), 0);
  const totalReferralsPaid = m.doctors.reduce((a, u) => a + (u.referrals_paid || 0), 0);
  const referrerRows = m.doctors.filter((u) => (u.referrals || 0) > 0)
    .sort((a, b) => (b.referrals_paid - a.referrals_paid) || (b.referrals - a.referrals)).slice(0, 8)
    .map((u) => `<div class="hist-row" style="cursor:pointer" onclick="anOpen('referrer','${u.id}')">
      <span class="hist-title">${esc(u.name || u.email)}</span>
      <span class="hist-meta">${arInv(u.referrals)} · ${u.referrals_paid} اشترك · رصيده ${arQ(u.bonus_questions || 0)}</span>
    </div>`).join('') || anEmpty('لا دعوات بعد.');

  const eventRows = m.events.slice(0, 10).map((e) => anDocRow(m.allById.get(e.user_id), anEventMeta(e)))
    .join('') || anEmpty('لا أحداث في هذه الفترة.');

  return `
    <div class="seg">${AN_RANGES.map(([v, l]) => `<button class="seg-btn ${m.range === v ? 'active' : ''}" onclick="setAnRange(${v})">${l}</button>`).join('')}</div>
    <div class="card-meta bidi" style="margin:-6px 0 12px">اضغط أي رقم أو سطر لرؤية مَن وراءه، ثم اضغط اسم الطبيب لفتح بطاقته.</div>

    <div class="overall" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
      ${anCard(m.cohort.length, 'تسجيلات جديدة', "anOpen('signups')")}
      ${anCard(m.approved.length, 'اشتراكات مدفوعة', "anOpen('requests','approved')")}
      ${anCard(m.revenue, `عائد تقديري (${EDITION.currency})`, "anOpen('revenue')")}
      ${anCard(convRate + '%', 'سجّلوا ثم دفعوا', "anOpen('cohort_paid')")}
      ${anCard(approvalRate + '%', 'نسبة قبول الإيصالات', "anOpen('reviewed')")}
      ${anCard(avgCovered, 'متوسط الأسئلة قبل الطلب', "anOpen('requests','all')")}
    </div>

    ${renderVisitors()}

    <div class="card">
      <div class="section-heading" style="margin:0 0 10px"><h2>الحركة</h2><span>${rl} · اضغط أي عمود</span></div>
      <div class="bars${m.series.length > 7 ? ' dense' : ''}">${m.series.map((s, i) => `
        <div class="bar-col click" title="${esc(s.title)}: ${s.signups} تسجيل، ${s.paid} اشتراك" onclick="anOpen('span',${i})">
          <div class="bar-pair">
            <div class="bar" style="height:${Math.round((s.signups / maxBar) * 64)}px"></div>
            <div class="bar alt" style="height:${Math.round((s.paid / maxBar) * 64)}px"></div>
          </div>
          <span>${esc(s.label)}</span>
        </div>`).join('')}</div>
      <div class="legend"><span><i></i>تسجيلات جديدة</span><span><i class="alt"></i>اشتراكات مدفوعة</span></div>
    </div>

    <div class="card">
      <div class="section-heading" style="margin:0 0 6px"><h2>نوع دخول الأطباء الآن</h2><span>${arDoc(m.doctors.length)} · كل الفترات</span></div>
      ${SOURCE_ORDER.map((k) => hbar(SOURCE_LABEL[k], m.counts[k] || 0, total, `anOpen('source','${k}')`)).join('')}
    </div>

    <div class="section-heading"><h2>الإيصالات</h2><span>${rl}</span></div>
    <div class="hist-list">
      <div class="hist-row" style="cursor:pointer" onclick="anOpen('requests','approved')">
        <span class="hist-title">مقبولة <span class="status-chip approved">approved</span></span>
        <span class="hist-meta">${arRec(m.approved.length)} · ${m.revenue} ${EDITION.currency}</span></div>
      <div class="hist-row" style="cursor:pointer" onclick="anOpen('requests','rejected')">
        <span class="hist-title">مرفوضة <span class="status-chip rejected">rejected</span></span>
        <span class="hist-meta">${arRec(m.rejected.length)}</span></div>
      <div class="hist-row" style="cursor:pointer" onclick="anOpen('requests','pending')">
        <span class="hist-title">بانتظار المراجعة <span class="status-chip pending">pending</span></span>
        <span class="hist-meta">${arRec(m.pending.length)} · كل الوقت</span></div>
    </div>

    <div class="section-heading"><h2>أداء أكواد البروموكود</h2><span>${promosCache.length} كود · كل الفترات</span></div>
    <div class="hist-list">${promoRows}</div>

    <div class="section-heading"><h2>أداء الدعوات (الريفيرال)</h2><span>${arInv(totalReferrals)} · ${totalReferralsPaid} اشترك</span></div>
    <div class="hist-list">${referrerRows}</div>

    <div class="card">
      <div class="section-heading" style="margin:0 0 6px"><h2>مصدر الأسئلة الإضافية الممنوحة</h2><span>${arQ(grantedTotal)} · ${rl}</span></div>
      ${BONUS_KINDS.map((k) => hbar(EVENT_LABEL[k], m.bonus[k] || 0, grantedTotal || 1, `anOpen('bonus','${k}')`)).join('')}
      <div class="card-meta bidi" style="margin-top:8px">الرصيد المجمّع لدى كل الأطباء الآن: ${arQ(heldNow)}.</div>
    </div>

    <div class="section-heading"><h2>آخر الأحداث</h2><span style="cursor:pointer;color:var(--primary)" onclick="anOpen('events')">عرض الكل ←</span></div>
    <div class="hist-list">${eventRows}</div>`;
}

const anEventMeta = (e) => `${esc(EVENT_LABEL[e.name] || e.name)}`
  + (e.meta && e.meta.reward ? ` · +${arQ(e.meta.reward)}` : '')
  + (e.meta && e.meta.code ? ` · ${esc(e.meta.code)}` : '')
  + (e.meta && e.meta.plan ? ` · ${e.meta.plan === 'part' ? 'جزء' : 'اشتراك كامل'}` : '')
  + ` · ${dayStr(e.ts)}`;

/* ---- level 2: the list behind one figure ---- */
function renderAnDrill(m) {
  const { kind, key } = anDrill;
  const reqMeta = (r) => `${planLabel(r)} · ${m.amountOf(r)} ${EDITION.currency} · ${arQ(r.covered || 0)} وقت الطلب · ${dayStr(r.reviewed_at || r.created_at)}`
    + (r.reject_reason ? ` · ${esc(r.reject_reason)}` : '');
  const newest = (a, b) => new Date(b.created_at) - new Date(a.created_at);
  let title = '', sub = '', extra = '', rows = [];

  if (kind === 'source') {
    const list = m.doctors.filter((u) => m.srcByUser.get(u.id) === key)
      .sort((a, b) => new Date(b.last_seen) - new Date(a.last_seen));
    title = SOURCE_LABEL[key] || '—';
    sub = arDoc(list.length);
    extra = anEmpty(SOURCE_WHY[key] || '')
      + (key === 'pending' ? `<div class="card"><button class="btn btn-primary" onclick="switchTab('requests')">مراجعة الإيصالات الآن</button></div>` : '');
    rows = list.map((u) => anDocRow(u, `${arQ(u.covered || 0)} · آخر ظهور ${relTime(u.last_seen)}`));

  } else if (kind === 'signups') {
    const c = {};
    m.cohort.forEach((u) => { const s = m.srcByUser.get(u.id); c[s] = (c[s] || 0) + 1; });
    title = 'تسجيلات جديدة';
    sub = `${arAcc(m.cohort.length)} · ${anRangeLabel()}`;
    extra = `<div class="card"><div class="section-heading" style="margin:0 0 6px"><h2>وضعهم الآن</h2></div>
      ${SOURCE_ORDER.filter((k) => c[k]).map((k) => hbar(SOURCE_LABEL[k], c[k], m.cohort.length, `anOpen('source','${k}')`)).join('')}</div>`;
    rows = [...m.cohort].sort(newest).map((u) => anDocRow(u, `سجّل ${dayStr(u.created_at)} · ${arQ(u.covered || 0)}`));

  } else if (kind === 'cohort_paid') {
    title = 'سجّلوا ثم دفعوا';
    sub = `${m.cohortPaid.length} من ${arAcc(m.cohort.length)} جديد · ${anRangeLabel()}`;
    rows = [...m.cohortPaid].sort(newest)
      .map((u) => anDocRow(u, `سجّل ${dayStr(u.created_at)} · ${SOURCE_LABEL[m.srcByUser.get(u.id)]}`));

  } else if (kind === 'requests') {
    const list = key === 'pending' ? m.pending : key === 'all' ? m.reqs : m.reqs.filter((r) => r.status === key);
    title = key === 'approved' ? 'إيصالات مقبولة' : key === 'rejected' ? 'إيصالات مرفوضة'
      : key === 'pending' ? 'إيصالات بانتظار المراجعة' : 'كل الإيصالات';
    sub = `${arRec(list.length)} · ${key === 'pending' ? 'كل الوقت' : anRangeLabel()}`;
    const sorted = key === 'all'
      ? [...list].sort((a, b) => (b.covered || 0) - (a.covered || 0))
      : [...list].sort(newest);
    if (key === 'all') extra = anEmpty('مرتّبة بعدد الأسئلة التي حلّها الطبيب قبل إرسال الإيصال — يوضح متى يقتنع الأطباء بالدفع.');
    rows = sorted.map((r) => anDocRow(m.allById.get(r.user_id), reqMeta(r)));

  } else if (kind === 'reviewed') {
    const list = [...m.approved, ...m.rejected].sort((a, b) => new Date(b.reviewed_at || b.created_at) - new Date(a.reviewed_at || a.created_at));
    title = 'الإيصالات المُراجَعة';
    sub = `${m.approved.length} مقبول · ${m.rejected.length} مرفوض · ${anRangeLabel()}`;
    rows = list.map((r) => anDocRow(m.allById.get(r.user_id), `<span class="status-chip ${r.status}">${r.status}</span> ${reqMeta(r)}`));

  } else if (kind === 'revenue') {
    title = 'العائد التقديري';
    sub = `${m.revenue} ${EDITION.currency} من ${arRec(m.approved.length)} · ${anRangeLabel()}`;
    extra = anEmpty(`السعر المستخدم في الحساب: اشتراك كامل ${payCache.price || '—'} · جزء ${payCache.part_price || '—'} — من تبويب Payment، فالرقم تقديري إن كان السعر مختلفاً وقت البيع.`);
    rows = [...m.approved].sort((a, b) => new Date(b.reviewed_at || b.created_at) - new Date(a.reviewed_at || a.created_at))
      .map((r) => anDocRow(m.allById.get(r.user_id), reqMeta(r)));

  } else if (kind === 'promo') {
    const c = promosCache.find((x) => x.id === key);
    if (!c) { title = 'كود غير موجود'; } else {
      const reds = promoRedCache.filter((r) => r.promo_id === c.id);
      const inP = reds.filter((r) => !r.redeemed_at || m.inRange(r.redeemed_at));
      const paidUsers = reds.filter((r) => REALLY_PAID.has(m.srcByUser.get(r.user_id)));
      const granted = reds.length ? reds.reduce((a, r) => a + (r.reward || 0), 0) : c.uses * (c.reward_questions || 0);
      const earned = paidUsers.reduce((sum, r) => sum + requestsCache
        .filter((q) => q.user_id === r.user_id && q.status === 'approved')
        .reduce((a, q) => a + m.amountOf(q), 0), 0);
      title = esc(c.code) + (c.label ? ` — ${esc(c.label)}` : '');
      sub = `${c.uses}/${c.max_uses} استخدام · ${arQ(c.reward_questions)} لكل استخدام`;
      extra = `<div class="overall" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))">
          ${anCard(inP.length, 'استخدامات خلال ' + anRangeLabel())}
          ${anCard(granted, 'أسئلة مُنحت')}
          ${anCard(paidUsers.length, 'دفعوا بعده')}
          ${anCard(earned, `عائد منهم (${EDITION.currency})`)}
        </div>
        ${anEmpty(`${c.active ? 'الكود نشط' : 'الكود ملغى'}${c.expires_at ? ' · ينتهي ' + dayStr(c.expires_at) : ' · بلا تاريخ انتهاء'} · أُنشئ ${dayStr(c.created_at)}`)}`;
      rows = [...reds].sort((a, b) => new Date(b.redeemed_at || 0) - new Date(a.redeemed_at || 0))
        .map((r) => anDocRow(m.allById.get(r.user_id),
          `+${arQ(r.reward || c.reward_questions || 0)} · ${r.redeemed_at ? dayStr(r.redeemed_at) : 'تاريخ غير مسجل'}`));
      if (!reds.length && c.uses) extra += anEmpty('الاستخدامات مسجّلة على الكود لكن تفاصيل من استخدمه غير متاحة.');
    }

  } else if (kind === 'referrer') {
    const u = m.allById.get(key);
    const invitees = usersCache.filter((x) => x.referred_by === key);
    title = 'دعوات ' + esc(u ? (u.name || u.email) : '—');
    sub = `${arInv((u && u.referrals) || invitees.length)} · ${(u && u.referrals_paid) || 0} اشترك`;
    extra = `<div class="overall" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))">
        ${anCard((u && u.referrals) || 0, 'دعوات انضمّت')}
        ${anCard((u && u.referrals_paid) || 0, 'منهم اشترك')}
        ${anCard((u && u.bonus_questions) || 0, 'رصيده من الأسئلة')}
      </div>
      <div class="card"><button class="btn" onclick="anDoctor('${key}')">فتح بطاقة الداعي</button></div>`;
    rows = [...invitees].sort(newest).map((x) => anDocRow(x,
      `${REALLY_PAID.has(m.srcByUser.get(x.id)) ? 'اشترك ✓' : 'لم يشترك بعد'} · انضم ${dayStr(x.created_at)}`));

  } else if (kind === 'bonus') {
    const list = m.events.filter((e) => e.name === key);
    title = EVENT_LABEL[key] || 'أسئلة إضافية';
    sub = `${arQ(m.bonus[key] || 0)} في ${list.length} مرة · ${anRangeLabel()}`;
    rows = list.map((e) => anDocRow(m.allById.get(e.user_id), anEventMeta(e)));

  } else if (kind === 'events') {
    title = 'سجل الأحداث';
    sub = `${m.events.length} حدث · ${anRangeLabel()}`;
    rows = m.events.slice(0, 200).map((e) => anDocRow(m.allById.get(e.user_id), anEventMeta(e)));

  } else if (kind === 'span') {
    const s = m.series[+key];
    if (!s) { title = '—'; } else {
      const hit = (ts) => { const t = new Date(ts).getTime(); return t > s.from && t <= s.to; };
      const items = [];
      m.doctors.filter((u) => hit(u.created_at)).forEach((u) => items.push({ ts: u.created_at, uid: u.id, text: 'تسجيل جديد' }));
      requestsCache.forEach((r) => {
        if (hit(r.created_at)) items.push({ ts: r.created_at, uid: r.user_id, text: 'أرسل إيصال ' + planLabel(r) });
        if (r.reviewed_at && hit(r.reviewed_at)) items.push({ ts: r.reviewed_at, uid: r.user_id, text: (r.status === 'approved' ? 'قُبل إيصاله' : 'رُفض إيصاله') + ' — ' + planLabel(r) });
      });
      eventsCache.forEach((e) => {
        if (hit(e.ts) && BONUS_KINDS.includes(e.name)) items.push({ ts: e.ts, uid: e.user_id, text: EVENT_LABEL[e.name] + ' +' + ((e.meta && e.meta.reward) || 0) });
      });
      items.sort((a, b) => new Date(b.ts) - new Date(a.ts));
      title = s.title;
      sub = `${s.signups} تسجيل · ${s.paid} اشتراك مدفوع · ${s.revenue} ${EDITION.currency}`;
      rows = items.map((it) => anDocRow(m.allById.get(it.uid), `${esc(it.text)} · ${timeStr(it.ts)}`));
    }
  }

  return `
    <button class="back-link" onclick="anBack()">← رجوع إلى التقرير</button>
    <div class="section-heading"><h2>${title}</h2><span>${esc(sub)}</span></div>
    ${extra}
    <div class="hist-list">${rows.join('') || anEmpty('لا بيانات في هذه الفئة.')}</div>`;
}

/* ---------------- codes ---------------- */
function genCode() {
  const A = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const pick = () => A[crypto.getRandomValues(new Uint32Array(1))[0] % A.length];
  return pick() + pick() + pick() + pick() + '-' + pick() + pick() + pick() + pick();
}

function renderCodes() {
  const rows = codesCache.map((c) => `
    <div class="hist-row">
      <span class="hist-title"><code style="font-size:14px;letter-spacing:.06em">${esc(c.code)}</code>
        ${c.label ? `<span class="hist-meta">${esc(c.label)}</span>` : ''}</span>
      <span class="hist-meta">${c.uses}/${c.max_uses} used · ${c.redeemed_by} accounts
        ${c.expires_at ? '· expires ' + new Date(c.expires_at).toLocaleDateString() : ''}
        ${c.active ? '' : '· <b style="color:var(--wrong)">revoked</b>'}</span>
      <button class="btn" onclick="toggleCode('${c.id}', ${!c.active})">${c.active ? 'Revoke' : 'Restore'}</button>
    </div>`).join('') || '<div class="card"><div class="card-meta">لا رموز بعد — أنشئ أول دفعة.</div></div>';

  return `
    <div class="card">
      <div class="section-heading" style="margin:0 0 12px"><h2>Generate a batch</h2><span>أعطِ كل طبيب رمزاً واحداً</span></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end">
        <label class="auth-label" style="margin:0">Count<input id="cd-count" type="number" min="1" max="100" value="10" style="width:90px"></label>
        <label class="auth-label" style="margin:0">Label<input id="cd-label" type="text" placeholder="دفعة فبراير" style="width:160px"></label>
        <label class="auth-label" style="margin:0">Max uses<input id="cd-uses" type="number" min="1" max="999" value="1" style="width:90px"></label>
        <label class="auth-label" style="margin:0">Valid days<input id="cd-days" type="number" min="0" max="730" value="90" style="width:90px"></label>
        <button class="btn btn-primary" id="cd-gen">Generate</button>
      </div>
      <div id="cd-out" class="card-meta" style="margin-top:10px"></div>
    </div>
    <div class="section-heading"><h2>All codes</h2><span>${codesCache.length} codes</span></div>
    <div class="hist-list">${rows}</div>`;
}

async function toggleCode(id, active) {
  try {
    await SB.req('/rest/v1/access_codes?id=eq.' + id, { method: 'PATCH', body: { active } });
    await loadAll(); render();
  } catch (e) { alert('تعذر التعديل: ' + e.message); }
}

async function generateCodes() {
  const count = Math.min(100, Math.max(1, +$('#cd-count').value || 1));
  const label = $('#cd-label').value.trim() || null;
  const maxUses = Math.min(999, Math.max(1, +$('#cd-uses').value || 1));
  const days = +$('#cd-days').value || 0;
  const expires = days > 0 ? new Date(Date.now() + days * 864e5).toISOString() : null;
  const codes = Array.from({ length: count }, () => genCode());
  try {
    await SB.req('/rest/v1/access_codes', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: codes.map((code) => ({ code, label, max_uses: maxUses, expires_at: expires })),
    });
    $('#cd-out').innerHTML = `تم إنشاء ${count} رمزاً — انسخها قبل مغادرة الصفحة: <code>${codes.map(esc).join(', ')}</code>`;
    await loadAll(); render();
  } catch (e) {
    $('#cd-out').textContent = 'خطأ: ' + e.message;
  }
}

/* ---------------- growth: promo codes + referral rewards ---------------- */
/* Both open BONUS QUESTIONS (not full access): they lift a doctor's free-trial
   ceiling. Needs supabase/004_promo_referral.sql. */
const REF_FIELDS = [
  ['referral_reward_signup', 'مكافأة الداعي عند تسجيل صديق', 'عدد الأسئلة التي يحصل عليها من يدعو، بمجرد انضمام الصديق'],
  ['referral_reward_paid', 'مكافأة الداعي عند اشتراك صديقه', 'أسئلة إضافية للداعي عندما يشترك الصديق (اجعلها أكبر للتحفيز)'],
  ['referral_signup_bonus', 'مكافأة الترحيب للمدعو', 'أسئلة إضافية يبدأ بها الصديق الجديد (0 = بلا مكافأة)'],
];

function genPromoCode() {
  const A = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const pick = () => A[crypto.getRandomValues(new Uint32Array(1))[0] % A.length];
  return Array.from({ length: 6 }, pick).join('');
}

function renderGrowth() {
  const needs = !('referral_reward_signup' in payCache);   // 004 not run yet
  const refCard = `
    <div class="card">
      <div class="section-heading" style="margin:0 0 12px"><h2>Referral rewards</h2><span>مكافآت الدعوة بالأسئلة المجانية — 0 يُخفي الخيار من التطبيق</span></div>
      ${needs ? '<div class="auth-err">شغّل <code>supabase/004_promo_referral.sql</code> في SQL Editor لتفعيل البرومو والدعوات.</div>' : ''}
      <div class="settings-grid">
        ${REF_FIELDS.map(([key, label, hint]) => `
          <label class="auth-label">${label}
            <input id="rf-${key}" type="number" min="0" max="100000" dir="ltr" value="${esc(payCache[key] ?? 0)}" ${needs ? 'disabled' : ''}>
            <span class="card-meta" style="font-weight:400">${hint}</span>
          </label>`).join('')}
      </div>
      <div style="display:flex;gap:10px;align-items:center">
        <button class="btn btn-primary" id="rf-save" ${needs ? 'disabled' : ''}>حفظ</button>
        <span id="rf-out" class="card-meta"></span>
      </div>
    </div>`;

  const promoRows = promosCache.map((c) => `
    <div class="hist-row">
      <span class="hist-title"><code style="font-size:14px;letter-spacing:.06em">${esc(c.code)}</code>
        <span class="hist-meta">+${c.reward_questions} سؤالاً${c.label ? ' · ' + esc(c.label) : ''}</span></span>
      <span class="hist-meta">${c.uses}/${c.max_uses} used · ${c.redeemed_by} accounts
        ${c.expires_at ? '· expires ' + new Date(c.expires_at).toLocaleDateString() : ''}
        ${c.active ? '' : '· <b style="color:var(--wrong)">revoked</b>'}</span>
      <button class="btn" onclick="togglePromo('${c.id}', ${!c.active})">${c.active ? 'Revoke' : 'Restore'}</button>
    </div>`).join('') || '<div class="card"><div class="card-meta">لا رموز دعائية بعد.</div></div>';

  const promoCard = `
    <div class="card">
      <div class="section-heading" style="margin:0 0 12px"><h2>Promo codes</h2><span>كل رمز يفتح عدداً من الأسئلة المجانية — للحملات الدعائية</span></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end">
        <label class="auth-label" style="margin:0">Questions opened<input id="pr-reward" type="number" min="1" max="100000" value="50" style="width:120px" ${needs ? 'disabled' : ''}></label>
        <label class="auth-label" style="margin:0">Code (اختياري)<input id="pr-code" type="text" placeholder="تلقائي" style="width:140px" dir="ltr" ${needs ? 'disabled' : ''}></label>
        <label class="auth-label" style="margin:0">Max uses<input id="pr-uses" type="number" min="1" max="1000000" value="100" style="width:110px" ${needs ? 'disabled' : ''}></label>
        <label class="auth-label" style="margin:0">Label<input id="pr-label" type="text" placeholder="حملة انستغرام" style="width:150px" ${needs ? 'disabled' : ''}></label>
        <label class="auth-label" style="margin:0">Valid days<input id="pr-days" type="number" min="0" max="730" value="30" style="width:90px" ${needs ? 'disabled' : ''}></label>
        <button class="btn btn-primary" id="pr-gen" ${needs ? 'disabled' : ''}>Create</button>
      </div>
      <div id="pr-out" class="card-meta" style="margin-top:10px"></div>
    </div>
    <div class="section-heading"><h2>All promo codes</h2><span>${promosCache.length} codes</span></div>
    <div class="hist-list">${promoRows}</div>`;

  return refCard + promoCard;
}

async function saveReferralSettings() {
  const body = { updated_at: new Date().toISOString() };
  REF_FIELDS.forEach(([key]) => { body[key] = Math.max(0, Math.min(100000, +$('#rf-' + key).value || 0)); });
  try {
    await SB.req('/rest/v1/payment_settings?id=eq.1', { method: 'PATCH', body });
    payCache = { ...payCache, ...body };
    $('#rf-out').textContent = 'تم الحفظ ✓';
  } catch (e) {
    $('#rf-out').textContent = 'خطأ: ' + e.message;
  }
}

async function generatePromo() {
  const reward = Math.max(1, Math.min(100000, +$('#pr-reward').value || 1));
  const maxUses = Math.max(1, Math.min(1000000, +$('#pr-uses').value || 1));
  const label = $('#pr-label').value.trim() || null;
  const typed = $('#pr-code').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const code = typed || genPromoCode();
  const days = +$('#pr-days').value || 0;
  const expires = days > 0 ? new Date(Date.now() + days * 864e5).toISOString() : null;
  try {
    await SB.req('/rest/v1/promo_codes', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: { code, label, reward_questions: reward, max_uses: maxUses, expires_at: expires },
    });
    $('#pr-out').innerHTML = `تم إنشاء الرمز <code>${esc(code)}</code> — يفتح ${reward} سؤالاً، حتى ${maxUses} استخدام.`;
    await loadAll(); render();
  } catch (e) {
    $('#pr-out').textContent = e.message.includes('duplicate') ? 'هذا الرمز موجود مسبقاً — اختر رمزاً آخر.' : 'خطأ: ' + e.message;
  }
}

async function togglePromo(id, active) {
  try {
    await SB.req('/rest/v1/promo_codes?id=eq.' + id, { method: 'PATCH', body: { active } });
    await loadAll(); render();
  } catch (e) { alert('تعذر التعديل: ' + e.message); }
}

/* ---------------- render root ---------------- */
function render() {
  if (adminTab === 'doctors') app.innerHTML = shell(renderDoctors());
  else if (adminTab === 'analytics') app.innerHTML = shell(renderAnalytics());
  else if (adminTab === 'codes') app.innerHTML = shell(renderCodes());
  else if (adminTab === 'growth') app.innerHTML = shell(renderGrowth());
  else if (adminTab === 'requests') app.innerHTML = shell(renderRequests());
  else if (adminTab === 'payment') app.innerHTML = shell(renderPayment());
  else app.innerHTML = shell(renderOverview());
  // receipts sit in a private bucket: fetch each once, then redraw with the image
  $$('.req-thumb[data-path]').forEach((el) => {
    if (receiptJobs.has(el.dataset.path)) return;
    loadReceipt(el.dataset.path).then(() => { if (adminTab === 'requests') render(); });
  });
  $('#pay-save')?.addEventListener('click', savePayment);
  const search = $('#doc-search');
  if (search) {
    search.addEventListener('input', (e) => {
      window._docQuery = e.target.value;
      const list = $('#doc-list');
      if (list) list.innerHTML = doctorsListHtml();
    });
    // keep focus while typing
    search.focus();
  }
  $('#cd-gen')?.addEventListener('click', generateCodes);
  $('#rf-save')?.addEventListener('click', saveReferralSettings);
  $('#pr-gen')?.addEventListener('click', generatePromo);
}

function doctorsListHtml() {
  const q = (window._docQuery || '').toLowerCase();
  const rows = usersCache
    .filter((u) => !q || (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q))
    .map((u) => `
      <div class="hist-row" style="cursor:pointer" onclick="openDrill('${u.id}')">
        <span class="hist-title">${esc(u.name || u.email)}${statusChip(u)}<br>
          <span class="hist-meta" style="font-weight:400">${esc(u.email || '')}</span></span>
        <span class="hist-meta">coverage ${Math.round(((u.covered || 0) / (BANK_SIZE || 1)) * 100)}% · ${u.attempts || 0} attempts · mastered ${u.mastered || 0} · ${relTime(u.last_seen)}</span>
      </div>`).join('');
  return rows || '<div class="card"><div class="card-meta">لا نتائج.</div></div>';
}

function relTime(ts) {
  const d = Date.now() - new Date(ts).getTime();
  if (d < 36e5) return Math.max(1, Math.round(d / 6e4)) + ' min ago';
  if (d < 864e5) return Math.round(d / 36e5) + ' h ago';
  return Math.round(d / 864e5) + ' d ago';
}

/* expose handlers */
Object.assign(window, {
  switchTab, openDrill, closeDrill, toggleCode, togglePromo, SB,
  setAccess, addPart, approveRequest, rejectRequest, openReject, openReceipt,
  setAnRange, anOpen, anBack, anDoctor,
});
