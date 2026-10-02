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
let payCache = {};
let rejectingId = null;            // request whose reject reasons are open
const receiptUrls = new Map();     // receipt_path -> { url, type } once fetched from the private bucket
let drillId = null;

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

async function loadAll() {
  const [users, codes, sessions, requests, pay] = await Promise.all([
    SB.req('/rest/v1/v_admin_users?select=*&order=last_seen.desc'),
    SB.req('/rest/v1/v_admin_codes?select=*&order=created_at.desc'),
    SB.req('/rest/v1/v_admin_sessions?select=*&order=ts.desc&limit=1000'),
    // these two need supabase/002_trial_paywall.sql; stay usable without it
    SB.req('/rest/v1/v_admin_requests?select=*&order=created_at.desc&limit=200').catch(() => []),
    SB.paymentSettings().catch(() => ({})),
  ]);
  usersCache = users || [];
  codesCache = codes || [];
  sessionsCache = sessions || [];
  requestsCache = requests || [];
  payCache = pay || {};
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
  document.title = (waiting ? `(${waiting}) ` : '') + 'Oman EM Prep — Admin';
  const tabs = [
    ['overview', '📊', 'Overview'],
    ['requests', '🧾', 'Requests' + (waiting ? `<span class="tab-badge">${waiting}</span>` : '')],
    ['doctors', '👨‍⚕️', 'Doctors'],
    ['codes', '🔑', 'Codes'],
    ['payment', '💳', 'Payment'],
  ];
  return `
    <div class="topbar"><div class="topbar-inner">
      <div class="brand"><div class="brand-logo" style="background:#0b3d3a">AD</div>
        <div><div class="brand-name">Admin — Oman EM Prep</div></div></div>
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

function switchTab(t) { adminTab = t; drillId = null; rejectingId = null; render(); }

/* ---------------- overview ---------------- */
function renderOverview() {
  const doctors = usersCache.filter((u) => u.role === 'doctor');
  const weekAgo = Date.now() - 7 * 864e5;
  const active7 = doctors.filter((u) => new Date(u.last_seen).getTime() > weekAgo).length;
  const totalCovered = doctors.reduce((a, u) => a + (u.covered || 0), 0);
  const avgCoverage = doctors.length ? Math.round((totalCovered / doctors.length / 5093) * 100) : 0;
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
const accessOf = (u) => (u.code_id || u.access_status === 'active') ? 'active' : (u.access_status || 'trial');
const statusChip = (u) => u.role === 'admin' ? '' : ` <span class="status-chip ${accessOf(u)}">${accessOf(u)}</span>`;
const waHref = (phone) => 'https://wa.me/' + String(phone || '').replace(/\D/g, '');

function renderDoctors() {
  if (drillId) return renderDrill();
  const q = (window._docQuery || '').toLowerCase();
  const rows = usersCache
    .filter((u) => !q || (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q))
    .map((u) => {
      const covPct = 5093 ? Math.round(((u.covered || 0) / 5093) * 100) : 0;
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

function closeDrill() { drillId = null; drillData = null; render(); }

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
    <button class="back-link" onclick="closeDrill()">← All doctors</button>
    <div class="sec-hero">
      <div class="card-icon big">👨‍⚕️</div>
      <div>
        <h1>${esc(u.name || u.email)}</h1>
        <div class="card-meta">${esc(u.email || '')} · member since ${new Date(u.created_at).toLocaleDateString()} · last seen ${relTime(u.last_seen)}</div>
        <div class="card-meta">coverage ${u.covered || 0}/5093 · attempts ${u.attempts || 0} · mastered ${u.mastered || 0}</div>
        ${u.role === 'admin' ? '' : `
          <div class="req-actions">
            <span class="status-chip ${accessOf(u)}">${accessOf(u)}</span>
            ${u.phone ? `<a class="btn" target="_blank" rel="noopener" href="${waHref(u.phone)}">💬 ${esc(u.phone)}</a>` : ''}
            ${accessOf(u) === 'active'
              ? (u.code_id ? '' : `<button class="btn" onclick="setAccess('${u.id}', 'trial')">إلغاء التفعيل</button>`)
              : `<button class="btn btn-primary" onclick="setAccess('${u.id}', 'active')">تفعيل يدوي (وصول كامل)</button>`}
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
        ${r.phone ? `<a class="btn" style="margin-top:8px" target="_blank" rel="noopener" href="${waHref(r.phone)}">💬 ${esc(r.phone)}</a>` : ''}
        ${rejectingId === r.id ? `
          <div class="card-meta" style="margin-top:10px">سبب الرفض — يظهر للطبيب ويستطيع إعادة الرفع فوراً:</div>
          <div class="req-actions">
            ${REJECT_REASONS.map((t) => `<button class="btn btn-danger-soft" onclick="rejectRequest('${r.id}', '${t}')">${t}</button>`).join('')}
            <button class="btn btn-ghost" onclick="openReject(null)">تراجع</button>
          </div>` : `
          <div class="req-actions">
            <button class="btn btn-primary" onclick="approveRequest('${r.id}')">✓ قبول وفتح الحساب</button>
            <button class="btn" onclick="openReject('${r.id}')">✗ رفض</button>
          </div>`}
      </div>
    </div>`).join('') || '<div class="card"><div class="card-meta">لا إيصالات بانتظار المراجعة 🎉</div></div>';

  const doneHtml = done.map((r) => `
    <div class="hist-row">
      <span class="hist-title">${esc(r.name || r.email)} <span class="status-chip ${r.status}">${r.status}</span>
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
  ['price', 'رسوم التفعيل', '15 ر.ع'],
  ['beneficiary', 'اسم المستفيد', ''],
  ['bank', 'البنك', 'Bank Muscat'],
  ['account', 'رقم الحساب / IBAN', ''],
  ['pay_link', 'رابط دفع (اختياري)', 'https://…'],
  ['whatsapp', 'واتساب الدعم (بمفتاح الدولة)', '+968…'],
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
  try {
    await SB.req('/rest/v1/payment_settings?id=eq.1', { method: 'PATCH', body });
    payCache = { ...payCache, ...body };
    $('#pay-out').textContent = 'تم الحفظ ✓';
  } catch (e) {
    $('#pay-out').textContent = 'خطأ: ' + e.message;
  }
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

/* ---------------- render root ---------------- */
function render() {
  if (adminTab === 'doctors') app.innerHTML = shell(renderDoctors());
  else if (adminTab === 'codes') app.innerHTML = shell(renderCodes());
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
}

function doctorsListHtml() {
  const q = (window._docQuery || '').toLowerCase();
  const rows = usersCache
    .filter((u) => !q || (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q))
    .map((u) => `
      <div class="hist-row" style="cursor:pointer" onclick="openDrill('${u.id}')">
        <span class="hist-title">${esc(u.name || u.email)}${statusChip(u)}<br>
          <span class="hist-meta" style="font-weight:400">${esc(u.email || '')}</span></span>
        <span class="hist-meta">coverage ${Math.round(((u.covered || 0) / 5093) * 100)}% · ${u.attempts || 0} attempts · mastered ${u.mastered || 0} · ${relTime(u.last_seen)}</span>
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
  switchTab, openDrill, closeDrill, toggleCode, SB,
  setAccess, approveRequest, rejectRequest, openReject, openReceipt,
});
