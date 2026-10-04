/* ============================================================
   Oman EM Prep — vanilla JS single-page app (no dependencies)
   Data: data/sections.json + data/questions/*.json + data/blueprint.json
   (bank schema unchanged — all intelligence lives here)

   Architecture: 3 tabs (Home / Practice / Exams)
   - Home: "what should I do today?" — resume + 3-item smart queue
   - Practice: 18 sections -> section page with coverage checkpoints
   - Exams: OEEM full simulation (unlock credits) + attempt history
   - First run: intro slides (why / how it works), then a tour of Home

   Scoring model (per question): unseen 0 · streak 1 = 50 · 2 = 75 ·
   3+ = 100 (Mastered); any wrong answer resets the streak.
   ============================================================ */
'use strict';

/* ---------------- helpers ---------------- */
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
/* ---------------- icons + small UI pieces ---------------- */
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-6h4v6"/>',
  book: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>',
  exam: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="m9 13 2 2 4-4"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  chev: '<path d="M9 5l7 7-7 7"/>',
  bookmark: '<path d="M6 4h12v17l-6-4-6 4z"/>',
  grid: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  refresh: '<path d="M4 11a8 8 0 0 1 14-4.5L20 9"/><path d="M20 4v5h-5"/><path d="M20 13a8 8 0 0 1-14 4.5L4 15"/><path d="M4 20v-5h5"/>',
  bolt: '<path d="M13 3 5 13h6l-1 8 8-10h-6z"/>',
  play: '<path d="M8 5v14l11-7z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
  logout: '<path d="M10 4H5v16h5"/><path d="m14 8 4 4-4 4"/><path d="M18 12H9"/>',
  download: '<path d="M12 4v11"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/>',
  share: '<path d="M12 15V3"/><path d="m8 7 4-4 4 4"/><path d="M8 11H5v10h14V11h-3"/>',
  plus: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/>',
  dots: '<path d="M12 5v.01M12 12v.01M12 19v.01" stroke-width="3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7.5v.01" stroke-width="2.6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
};
const icon = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
// the ECG mark — same drawing as icons/icon.svg and tools/make-icons.js
const LOGO = '<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M14 56H35L44 28L56 78L64 56H86"/><circle cx="86" cy="56" r="6.5"/></svg>';
const TRACE = (cls = '') => `<svg class="monitor-trace ${cls}" viewBox="0 0 240 64" preserveAspectRatio="none" aria-hidden="true"><path d="M0 40H34l5-7 5 7h12l7-30 9 46 6-16h16q7-13 14 0h26l5-7 5 7h12l7-30 9 46 6-16H240"/></svg>`;
const ring = (pct, cls = '') => `<span class="ring ${cls}" style="--pct:${pct}"><b>${pct}${cls ? '<i>%</i>' : ''}</b></span>`;
const bar = (pct) => `<span class="mastery" style="display:block"><span class="mastery-fill" style="display:block;width:${Math.max(0, Math.min(100, Math.round(pct)))}%"></span></span>`;
// official four-colour Google G — used by the verify button on every explanation
const GOOGLE_G = '<svg class="glogo" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.7-.4-3.9z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C36.9 39.2 44 34 44 24c0-1.3-.1-2.7-.4-3.9z"/></svg>';
// opens Google with the question stem pre-typed (web results, no AI panel) — results ready, nothing to copy-paste
const googleBtn = (q, seed) => {
  const query = String(seed ?? q.question ?? '').replace(/\s+/g, ' ').trim().slice(0, 110);
  return `<a class="btn btn-sm gsearch" href="https://www.google.com/search?q=${encodeURIComponent(query)}&udm=14" target="_blank" rel="noopener">${GOOGLE_G} Google Search</a>`;
};

function openSheet(html, cls = '') {
  closeSheet();
  const el = document.createElement('div');
  el.className = 'sheet-backdrop';
  el.id = 'sheetRoot';
  el.innerHTML = `<div class="sheet ${cls}" role="dialog" aria-modal="true">${html}</div>`;
  el.addEventListener('click', (e) => { if (e.target === el) closeSheet(); });
  document.body.appendChild(el);
}
function closeSheet() { $('#sheetRoot')?.remove(); }

function toast(msg) {
  $('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.dir = 'auto';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3600);
}

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const EXAM_SEC_PER_Q = 75;
const EXAM_MAX_Q = 30;
const CRAM_MAX = 20;
const CHECKPOINTS = [           // section coverage gates
  { tier: 1, gate: 0.25 },
  { tier: 2, gate: 0.5 },
  { tier: 3, gate: 0.75 },
];

/* ---------------- persistent store (v2) ---------------- */
const STORE_KEY = 'oman-em-prep.v1';

function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s.v === 2) { s.mocksTaken = s.mocksTaken || 0; return s; }
      if (s.v === 1) {
        s.v = 2;
        s.active = null;
        s.mocksTaken = 0;
        Object.values(s.q || {}).forEach((r) => { r.streak = r.lastCorrect ? 1 : 0; });
        return s;
      }
    }
  } catch (e) { /* corrupted -> reset */ }
  return freshStore();
}
function freshStore() { return { v: 2, q: {}, starred: [], history: [], active: null, mocksTaken: 0 }; }
let store = loadStore();

function saveStore() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* private mode */ }
}

// the local cache belongs to one account: another doctor signing in on the
// same browser must not inherit (or upload) the previous one's progress
function adoptStoreFor(uid) {
  if (store.uid && store.uid !== uid) store = freshStore();
  if (store.uid !== uid) { store.uid = uid; saveStore(); }
}

function recordAttempt(qid, correct) {
  const rec = store.q[qid] || { s: 0, c: 0, streak: 0, lastCorrect: null, lastSeen: 0 };
  rec.s += 1;
  if (correct) { rec.c += 1; rec.streak = (rec.streak || 0) + 1; }
  else rec.streak = 0;
  rec.firstTry = rec.s === 1 ? correct : (rec.firstTry ?? null);
  rec.lastCorrect = correct;
  rec.lastSeen = Date.now();
  store.q[qid] = rec;
  saveStore();
  if (window.Sync) {
    Sync.queueQuestion(qid);
    if (!hasFullAccess()) Sync.flush();   // trial answers reach the server at once: it holds the count
  }
}

function pushHistory(entry) {
  store.history.unshift(entry);
  store.history = store.history.slice(0, 50);
  saveStore();
}

/* ---------------- mastery scoring ---------------- */
function masteryOf(rec) {
  if (!rec || rec.s === 0) return 0;
  if (rec.streak >= 3) return 100;
  if (rec.streak === 2) return 75;
  if (rec.streak === 1) return 50;
  return 0;
}
const MASTERY_LABEL = (m) => m >= 100 ? 'Mastered' : m >= 75 ? 'Almost there' : m > 0 ? 'Reviewing' : 'Not seen';

function sectionStats(secId) {
  const qs = sectionQuestions(secId);
  let seen = 0, sum = 0;
  qs.forEach((q) => {
    const r = store.q[q.id];
    if (r && r.s > 0) { seen += 1; sum += masteryOf(r); }
  });
  return { total: qs.length, seen, mastery: qs.length ? Math.round(sum / qs.length) : 0 };
}

function readiness() {
  const total = ALL_QUESTIONS.length;
  let seen = 0, sum = 0, mastered = 0, attempts = 0, correct = 0;
  ALL_QUESTIONS.forEach((q) => {
    const r = store.q[q.id];
    if (r && r.s > 0) {
      seen += 1; sum += masteryOf(r);
      if (masteryOf(r) >= 100) mastered += 1;
      attempts += r.s; correct += r.c;
    }
  });
  return {
    readiness: total ? Math.round(sum / total) : 0,
    seen, total, mastered, attempts, correct,
    accuracy: attempts ? Math.round((correct / attempts) * 100) : 0,
    sessions: store.history.length,
  };
}

function wrongPool() {
  return ALL_QUESTIONS.filter((q) => {
    const r = store.q[q.id];
    return r && r.s > 0 && masteryOf(r) < 75;   // stays until 2 correct in a row
  });
}

function cramPool() {
  const seen = ALL_QUESTIONS
    .filter((q) => {
      if (!isAnswerable(q)) return false;
      const r = store.q[q.id];
      return r && r.s > 0 && masteryOf(r) < 100;
    })
    .sort((a, b) => {
      const ma = masteryOf(store.q[a.id]), mb = masteryOf(store.q[b.id]);
      if (ma !== mb) return ma - mb;
      return (store.q[a.id]?.lastSeen || 0) - (store.q[b.id]?.lastSeen || 0);
    });
  return seen.length >= 3 ? seen : [];
}

/* ---------------- theme ---------------- */
const THEME_KEY = 'oman-em-prep.theme';
const THEME_BAR = { light: '#f3f6f7', dark: '#07181e' };   // = --bg, so the phone's status bar blends into the app

// paintBar=false during launch: the status bar keeps the splash colour until the first screen is up
function applyTheme(paintBar = true) {
  const t = localStorage.getItem(THEME_KEY) ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = t;
  if (paintBar) $('meta[name="theme-color"]')?.setAttribute('content', THEME_BAR[t]);
}

function toggleTheme() {
  const dark = document.documentElement.dataset.theme === 'dark';
  localStorage.setItem(THEME_KEY, dark ? 'light' : 'dark');
  applyTheme();
  openAccount();   // redraw the sheet: its theme row names the other mode now
}

/* ---------------- data ---------------- */
let DB = { sections: [], byId: {} };
let ALL_QUESTIONS = [];
let BLUEPRINT = null;
let RECALLS = null;   // read-only exam-recall archive (data/recalls.json)

const OPT_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const CTRL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;
const cleanText = (s) => String(s ?? '').replace(CTRL_CHARS, ' ').trim();

function normalizeQuestion(raw, sectionId) {
  const opts = Array.isArray(raw.options)
    ? raw.options.map(cleanText).filter(Boolean)
    : OPT_LETTERS
        .map((L) => (raw.options ? cleanText(raw.options[L]) : ''))
        .filter(Boolean);
  let answer = null;
  if (raw.correct_answer != null) {
    const asLetter = OPT_LETTERS.indexOf(String(raw.correct_answer).trim().toUpperCase());
    if (asLetter > -1 && asLetter < opts.length) answer = asLetter;
    else if (Number.isInteger(raw.correct_answer) && raw.correct_answer >= 0 && raw.correct_answer < opts.length) answer = raw.correct_answer;
  }
  return {
    id: String(raw.id),
    sectionId,
    question: cleanText(raw.question),
    vignette: null,
    options: opts,
    answer,
    explanation: cleanText(raw.explanation),
    reference: [
      raw.subject || null,
      raw.topic || null,
      raw.page ? `source p.${raw.page}` : null,
    ].filter(Boolean).join(' · ') || null,
    hasImage: !!raw.has_image,
    selfScored: answer === null,
  };
}

/* ---------------- launch screen: real progress, never a silent wait ---------------- */
const Boot = {
  p: 4, cap: 4, creep: null, slow: null, late: false,
  // jump to `p` percent, then creep toward `cap` while the step is still running
  step(title, p, cap = p, status = '') {
    this.p = Math.max(this.p, p); this.cap = Math.max(cap, this.p);
    const t = $('#bootTitle'), st = $('#bootStatus');
    if (t && title) t.textContent = title;
    if (st && !this.late) st.textContent = status;
    this.paint();
    if (!this.creep) this.creep = setInterval(() => { this.p += (this.cap - this.p) * 0.06; this.paint(); }, 400);
    // long enough to be a bad connection, not a slow phone: say so and offer a way out
    if (!this.slow) this.slow = setTimeout(() => {
      this.late = true;
      const s = $('#bootStatus'), r = $('#bootRetry');
      if (s) s.textContent = 'الاتصال بطيء — ما زلنا نحمّل، لا تغلق التطبيق';
      if (r) r.hidden = false;
    }, 15000);
  },
  paint() {
    const f = $('#bootFill'), bar = $('#bootBar');
    if (!f) return this.done();   // the first screen replaced the launch screen
    f.style.width = this.p.toFixed(1) + '%';
    bar.setAttribute('aria-valuenow', Math.round(this.p));
  },
  done() { clearInterval(this.creep); clearTimeout(this.slow); this.creep = this.slow = null; },
};

// resolves with undefined if `promise` has not settled after `ms` (it keeps running)
const within = (promise, ms) => Promise.race([promise, new Promise((r) => setTimeout(r, ms))]);

// The bank is ~2.5 MB on the wire, so a slow phone gets all the time it needs —
// but a download that stops receiving bytes for `idleMs` is dead: drop it.
async function fetchJson(url, idleMs = 20000) {
  const ctl = new AbortController();
  let timer;
  const alive = () => { clearTimeout(timer); timer = setTimeout(() => ctl.abort(), idleMs); };
  alive();
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
    if (!res.body) return await res.json();
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let text = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      alive();
      text += dec.decode(value, { stream: true });
    }
    return JSON.parse(text + dec.decode());
  } catch (e) {
    throw e.name === 'AbortError' ? new Error(`${url} → no answer`) : e;
  } finally {
    clearTimeout(timer);
  }
}
const fetchJsonRetry = (url) => fetchJson(url).catch(() => fetchJson(url));   // one silent second try

async function loadData() {
  Boot.step('جاري تحميل بنك الأسئلة…', 20, 26);
  const secData = await fetchJsonRetry('data/sections.json');

  // the bar follows the questions that have arrived (20% → 86%), not the file count
  const total = secData.sections.reduce((n, s) => n + (s.count || 1), 0);
  let loaded = 0, got = 0;
  const results = await Promise.all(secData.sections.map(async (s) => {
    const questions = await fetchJsonRetry(s.file);
    loaded += 1; got += s.count || 1;
    const at = 26 + 60 * (got / total);
    Boot.step('', at, Math.min(86, at + 4), `تم تحميل ${loaded} من ${secData.sections.length} قسماً`);
    return { s, questions };
  }));

  const sections = [];
  for (const { s, questions } of results) {
    const norm = questions.map((q) => normalizeQuestion(q, s.id)).filter((q) => q.question && q.options.length >= 2);
    norm.forEach((q) => { DB.byId[q.id] = q; });
    sections.push({ ...s, count: norm.length });
    DB[s.id] = norm;
  }
  DB.sections = sections;
  ALL_QUESTIONS = sections.flatMap((s) => DB[s.id]);

  await loadBlueprint();
}

// on its own so the intro can quote the ladder's numbers before the bank is fetched
async function loadBlueprint() {
  if (BLUEPRINT) return;
  try {
    const bpRes = await fetch('data/blueprint.json');
    if (bpRes.ok) BLUEPRINT = await bpRes.json();
  } catch (e) { /* simulation stays hidden if blueprint missing */ }
}

// recalls never block boot: they are a reading section, not the bank
async function loadRecalls() {
  try {
    const res = await fetch('data/recalls.json');
    if (!res.ok) return;
    RECALLS = await res.json();
    const h = location.hash || '#/';
    if (h === '#/' || h.startsWith('#/recalls')) route();
  } catch (e) { /* section simply stays hidden */ }
}

function sectionQuestions(id) { return DB[id] || []; }
const isAnswerable = (q) => q.answer !== null;

/* ---------------- exam ladder: milestone tests + fixed simulations ---------------- */
/* Coverage = UNIQUE questions answered at least once (repeating the same
   questions never inflates progress). Milestones adapt to what the user
   covered (75/25 mix); simulations are a fixed seeded paper for everyone. */
function uniqueCovered() {
  let n = 0;
  ALL_QUESTIONS.forEach((q) => { const r = store.q[q.id]; if (r && r.s > 0) n++; });
  return n;
}
function coverageRatio() { return ALL_QUESTIONS.length ? uniqueCovered() / ALL_QUESTIONS.length : 0; }

/* ---------------- access: free trial -> payment -> approval ---------------- */
/* A new account gets TRIAL_LIMIT unique questions (counted from the progress
   the server holds, so clearing the browser does not reset it), then the
   payment screen. Full access = admin, redeemed code, or approved receipt.
   The bank can also be bought in PARTS thirds: each approved part raises the
   same limit by a third of the bank, spent in whatever sections the doctor
   likes; the last third is full access. */
const TRIAL_LIMIT = 25;
const PARTS = 3;
const PART_WARN = 100;             // a paid part is not nagged about until this few questions are left
const PRICE_FULL = '25 ر.ع';       // shown until prices are saved in admin.html
const PRICE_PART = '10 ر.ع';
let PAY = {};                      // payment_settings row, managed in admin.html

const partSize = () => Math.ceil(ALL_QUESTIONS.length / PARTS);
const partsOwned = () => Math.min(PARTS, (window.SB && SB.profile?.parts) || 0);
// the profile has no such column until supabase/003_plans.sql has run: only the full plan is offered then
const partsOn = () => SB.profile?.parts !== undefined;
const planPrice = (plan) => (plan === 'part' ? PAY.part_price || PRICE_PART : PAY.price || PRICE_FULL);

function hasFullAccess() {
  if (!window.SB || !SB.configured || !SB.profile) return true;   // local mode
  const p = SB.profile;
  return p.role === 'admin' || !!p.code_id || p.access_status === 'active' || (p.parts || 0) >= PARTS;
}
// extra free questions earned from promo codes and referrals (supabase/004)
const bonusQuestions = () => (window.SB && SB.profile && +SB.profile.bonus_questions) || 0;
// unique questions this account may cover: the free trial (plus any bonus earned), or the parts paid for
function accessLimit() { return (partsOwned() ? partsOwned() * partSize() : TRIAL_LIMIT) + bonusQuestions(); }
function trialLeft() { return Math.max(0, accessLimit() - uniqueCovered()); }

// true (and shows the payment screen) when the trial is used up
function trialBlocked() {
  if (hasFullAccess() || trialLeft() > 0) return false;
  stopTimer();
  session = null;
  renderPaywall();
  return true;
}

function milestoneState(m) {
  const cov = uniqueCovered();
  return {
    unlocked: cov >= m.unlockAt,
    best: store.milestoneBest?.[m.id] ?? null,
    attempts: store.milestoneAttempts?.[m.id] || 0,
    remaining: Math.max(0, m.unlockAt - cov),
  };
}
function simState(s) {
  const ratio = coverageRatio();
  return {
    unlocked: ratio >= s.unlockAtCoverage - 1e-9,
    best: store.simBest?.[s.id] ?? null,
    attempts: store.simAttempts?.[s.id] || 0,
    remaining: Math.max(0, Math.ceil(s.unlockAtCoverage * ALL_QUESTIONS.length) - uniqueCovered()),
  };
}

function domainQuotas(size) {
  const total = BLUEPRINT.domains.reduce((a, d) => a + d.weight, 0);
  const rows = BLUEPRINT.domains.map((d) => {
    const exact = (d.weight / total) * size;
    return { d, q: Math.floor(exact), frac: exact - Math.floor(exact) };
  });
  let rem = size - rows.reduce((a, r) => a + r.q, 0);
  rows.sort((a, b) => b.frac - a.frac);
  for (let i = 0; i < rem; i++) rows[i % rows.length].q += 1;
  return rows.filter((r) => r.q > 0);
}

let SECTION_DOMAIN = null;
function sectionDomainOf(secId) {
  if (!SECTION_DOMAIN) {
    SECTION_DOMAIN = {};
    for (const d of BLUEPRINT?.domains || []) for (const sid of d.sections) if (!SECTION_DOMAIN[sid]) SECTION_DOMAIN[sid] = d.name;
  }
  return SECTION_DOMAIN[secId] || 'General';
}

function buildMilestoneExam(m) {
  const coveredIds = new Set();
  ALL_QUESTIONS.forEach((q) => { const r = store.q[q.id]; if (r && r.s > 0) coveredIds.add(q.id); });
  const used = new Set();
  const picked = [];
  const pull = (domain, want, cov) => {
    if (want <= 0) return 0;
    let pool = [];
    for (const sid of domain.sections) pool.push(...(DB[sid] || []));
    pool = pool.filter((q) => isAnswerable(q) && !used.has(q.id) && (cov ? coveredIds.has(q.id) : !coveredIds.has(q.id)));
    pool = shuffle(pool).slice(0, want);
    pool.forEach((q) => { used.add(q.id); picked.push({ ...q, mockDomain: domain.name, fromCovered: cov }); });
    return pool.length;
  };
  // global covered target (largest-remainder per domain so the 75/25 mix holds exactly)
  const globalC = Math.round(m.size * m.mix.covered);
  const alloc = domainQuotas(m.size).map(({ d, q }) => {
    const exact = q * m.mix.covered;
    return { d, q, c: Math.min(Math.floor(exact), q), frac: exact - Math.floor(exact) };
  });
  let remC = globalC - alloc.reduce((a, x) => a + x.c, 0);
  alloc.sort((a, b) => b.frac - a.frac);
  for (let i = 0; remC > 0 && i < alloc.length * 3; i++) {
    const row = alloc[i % alloc.length];
    if (row.c < row.q) { row.c += 1; remC -= 1; }
  }
  for (const { d, q, c } of alloc) {
    pull(d, c, true);
    pull(d, q - c, false);
  }
  // redistribute unmet quota anywhere, honoring the global covered/fresh intent
  let needC = globalC - picked.filter((p) => p.fromCovered).length;
  let needF = (m.size - globalC) - picked.filter((p) => !p.fromCovered).length;
  while (picked.length < m.size) {
    const wantCovered = needC > 0 ? true : needF > 0 ? false : true;
    let pool = ALL_QUESTIONS.filter((q) => isAnswerable(q) && !used.has(q.id) && (wantCovered ? coveredIds.has(q.id) : !coveredIds.has(q.id)));
    if (!pool.length) pool = ALL_QUESTIONS.filter((q) => isAnswerable(q) && !used.has(q.id));
    if (!pool.length) break;
    const q = pool[Math.floor(Math.random() * pool.length)];
    used.add(q.id);
    picked.push({ ...q, mockDomain: sectionDomainOf(q.sectionId), fromCovered: coveredIds.has(q.id) });
    if (wantCovered && needC > 0) needC--; else if (!wantCovered && needF > 0) needF--;
  }
  return shuffle(picked);
}

/* deterministic PRNG — a fixed simulation must be the identical paper for everyone */
function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seededShuffle(arr, seed) {
  const rnd = mulberry32(seed);
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildFixedSimulation(s) {
  const used = new Set();
  const picked = [];
  for (const { d, q } of domainQuotas(s.size)) {
    let pool = [];
    for (const sid of d.sections) pool.push(...(DB[sid] || []));
    pool = pool.filter((x) => isAnswerable(x) && !used.has(x.id));
    pool = seededShuffle(pool, hashStr(s.seed + '::' + d.name));
    pool.slice(0, q).forEach((x) => { used.add(x.id); picked.push({ ...x, mockDomain: d.name, fromCovered: false }); });
  }
  if (picked.length < s.size) {
    let pool = ALL_QUESTIONS.filter((q) => isAnswerable(q) && !used.has(q.id));
    pool = seededShuffle(pool, hashStr(s.seed + '::fill'));
    pool.slice(0, s.size - picked.length).forEach((q) => {
      used.add(q.id);
      picked.push({ ...q, mockDomain: sectionDomainOf(q.sectionId), fromCovered: false });
    });
  }
  return seededShuffle(picked, hashStr(s.seed + '::order'));
}

function startMilestone(id) {
  const m = (BLUEPRINT?.milestoneTests || []).find((x) => x.id === id);
  if (!BLUEPRINT || !m || !milestoneState(m).unlocked) { renderExams(); return; }
  if (trialBlocked()) return;
  stopTimer();
  const qs = buildMilestoneExam(m);
  if (!qs.length) { renderExams(); return; }
  const total = m.minutes * 60;
  session = {
    sectionId: 'milestone', mode: 'mock', mockKind: 'milestone', milestoneId: m.id,
    title: `Milestone Test ${m.id}`,
    questions: qs, idx: 0,
    picked: qs.map(() => null), submitted: qs.map(() => false), selfGrades: qs.map(() => null),
    flagged: new Set(),
    timeLeft: total, totalTime: total,
    finished: false, timerId: null,
  };
  startTimer(); persistSession(); renderQuiz(); window.scrollTo(0, 0);
}

function startSimulation(id) {
  const s = (BLUEPRINT?.simulations || []).find((x) => x.id === id);
  if (!BLUEPRINT || !s || !simState(s).unlocked) { renderExams(); return; }
  if (trialBlocked()) return;
  stopTimer();
  const qs = buildFixedSimulation(s);
  if (!qs.length) { renderExams(); return; }
  const total = s.minutes * 60;
  session = {
    sectionId: 'oeem', mode: 'mock', mockKind: 'simulation', simId: s.id,
    title: `${BLUEPRINT.exam.code} Simulation ${s.id}`,
    questions: qs, idx: 0,
    picked: qs.map(() => null), submitted: qs.map(() => false), selfGrades: qs.map(() => null),
    flagged: new Set(),
    timeLeft: total, totalTime: total,
    finished: false, timerId: null,
  };
  startTimer(); persistSession(); renderQuiz(); window.scrollTo(0, 0);
}

function findSpec(token) {
  const mm = token.match(/^milestone-(\d+)$/);
  if (mm) return { kind: 'milestone', spec: (BLUEPRINT?.milestoneTests || []).find((m) => m.id === +mm[1]) };
  const ss = token.match(/^sim-(\d+)$/);
  if (ss) return { kind: 'simulation', spec: (BLUEPRINT?.simulations || []).find((x) => x.id === +ss[1]) };
  return null;
}

function renderBriefing() {
  stopTimer();
  const found = findSpec((location.hash.match(/^#\/quiz\/([\w-]+)\/mock/) || [])[1] || '');
  if (!found || !found.spec) { renderExams(); return; }
  const { kind, spec } = found;
  const st = kind === 'milestone' ? milestoneState(spec) : simState(spec);
  if (!st.unlocked) { renderExams(); return; }
  const canResume = store.active && store.active.mode === 'mock' &&
    (kind === 'milestone' ? store.active.milestoneId === spec.id : store.active.simId === spec.id);
  const title = kind === 'milestone' ? `Milestone Test ${spec.id}` : `${BLUEPRINT.exam.code} Simulation ${spec.id}`;
  const sub = kind === 'milestone'
    ? `${spec.size} سؤالاً · 75% من مادة غطّيتها + 25% جديد · ${spec.minutes} دقيقة`
    : `${spec.size} questions · ${spec.minutes} min — نفس الورقة لكل المستخدمين، مبنية للمقارنة الصادقة`;
  app.innerHTML = `
    ${appBar({ back: '#/exams', title: 'Before you begin', right: '' })}
    <main class="wrap">
      <div class="briefing">
        <div class="briefing-mark">${kind === 'milestone' ? 'M' + spec.id : esc(BLUEPRINT.exam.code)}</div>
        <h1>${esc(title)}</h1>
        <p class="briefing-ar" dir="auto">${esc(sub)}</p>
        <div class="facts">
          <div class="fact"><b>${spec.size}</b><span>questions</span></div>
          <div class="fact"><b>${Math.floor(spec.minutes / 60) ? Math.floor(spec.minutes / 60) + 'h ' : ''}${spec.minutes % 60}m</b><span>time limit</span></div>
          <div class="fact"><b>${Math.round((spec.minutes * 60) / spec.size)}s</b><span>per question</span></div>
          <div class="fact"><b>${BLUEPRINT.domains.length}</b><span>domains</span></div>
        </div>
        <ul class="rules">
          <li>No feedback during the exam — full review with explanations after you submit.</li>
          <li>Answers stay editable; jump between questions from the navigator at the top.</li>
          <li>Submits automatically when the timer reaches 0:00.</li>
          ${kind === 'milestone'
            ? '<li dir="rtl">المزيج: 75% من أسئلة غطّيتها فعلاً + 25% جديد — تشويق لما ينتظرك.</li>'
            : `<li>Fixed official blueprint paper — identical for every candidate, built for honest comparison.</li>`}
        </ul>
        <button class="btn btn-primary btn-lg btn-block" onclick="${kind === 'milestone' ? `startMilestone(${spec.id})` : `startSimulation(${spec.id})`}">Begin the exam</button>
        ${canResume ? `<button class="btn btn-lg btn-block" onclick="resumeSession()">${icon('play', 'fill')} Resume your attempt in progress</button>` : ''}
      </div>
    </main>`;
}

function nextGoal() {
  if (!BLUEPRINT) return null;
  const cov = uniqueCovered();
  const total = ALL_QUESTIONS.length;
  const ratio = total ? cov / total : 0;
  const ms = BLUEPRINT.milestoneTests || [];
  const sims = BLUEPRINT.simulations || [];
  const readyM = ms.find((m) => cov >= m.unlockAt && store.milestoneBest?.[m.id] == null);
  if (readyM) return { title: `Milestone ${readyM.id} is ready`, sub: `${readyM.size} questions · ${readyM.minutes} min — 75% مما غطّيته + 25% جديد`, href: `#/quiz/milestone-${readyM.id}/mock`, cta: 'Take it', pct: 100 };
  const readyS = sims.find((s) => ratio >= s.unlockAtCoverage - 1e-9 && store.simBest?.[s.id] == null);
  if (readyS) return { title: `OEEM Simulation ${readyS.id} is ready`, sub: `${readyS.size} questions · ${readyS.minutes} min — الورقة الرسمية نفسها`, href: `#/quiz/sim-${readyS.id}/mock`, cta: 'Take it', pct: 100 };
  const lockM = ms.find((m) => cov < m.unlockAt);
  if (lockM) return { title: `${lockM.unlockAt - cov} أسئلة تفتح Milestone ${lockM.id}`, sub: `${cov}/${lockM.unlockAt} سؤالاً مغطى`, href: '#/exams', cta: 'Ladder', pct: cov / lockM.unlockAt };
  const lockS = sims.find((s) => ratio < s.unlockAtCoverage);
  if (lockS) return { title: `${Math.ceil(lockS.unlockAtCoverage * total) - cov} سؤالاً حتى Simulation ${lockS.id}`, sub: `تغطيتك ${Math.round(ratio * 100)}% من المطلوب ${Math.round(lockS.unlockAtCoverage * 100)}%`, href: '#/exams', cta: 'Ladder', pct: ratio / lockS.unlockAtCoverage };
  return null;
}

function paceState() {
  const t = session.totalTime ? Math.round(((session.totalTime - session.timeLeft) / session.totalTime) * 100) : 0;
  const a = session.questions.length ? Math.round((session.picked.filter((p) => p !== null).length / session.questions.length) * 100) : 0;
  const diff = a - t;
  const cls = diff <= -5 ? 'behind' : diff >= 5 ? 'ahead' : 'ok';
  const label = diff <= -5 ? `Behind pace ${diff}% — pick up speed` : diff >= 5 ? `Ahead of pace +${diff}%` : 'On pace';
  return { t, a, cls, label };
}

function updatePaceUI() {
  const s = paceState();
  const fill = $('#paceTime'); if (fill) fill.style.width = s.t + '%';
  const mk = $('#paceMarker'); if (mk) mk.style.left = s.a + '%';
  const st = $('#paceStatus');
  if (st) { st.textContent = s.label; st.className = 'pace-status ' + s.cls; }
}

function openGrid() {
  const g = $('#gridOverlay');
  if (!g) return;
  g.hidden = false;
  const b = $('#gridSubmit');
  if (b) { b.textContent = 'Submit exam'; b.classList.remove('btn-danger-soft'); b.classList.add('btn-primary'); b.dataset.armed = ''; }
}
function closeGrid() { $('#gridOverlay')?.setAttribute('hidden', ''); }

function submitFromGrid() {
  const unanswered = session.picked.filter((p) => p === null).length;
  const b = $('#gridSubmit');
  if (unanswered > 0 && b && !b.dataset.armed) {
    b.dataset.armed = '1';
    b.textContent = `${unanswered} unanswered — tap again to submit`;
    b.classList.remove('btn-primary');
    b.classList.add('btn-danger-soft');
    return;
  }
  closeGrid();
  finishExam(false);
}

/* ---------------- section coverage checkpoints ---------------- */
function sectionCoverage(secId) {
  const qs = sectionQuestions(secId);
  let seen = 0;
  qs.forEach((q) => { const r = store.q[q.id]; if (r && r.s > 0) seen++; });
  return { total: qs.length, seen, pct: qs.length ? seen / qs.length : 0 };
}

function checkpointState(secId, cp, cov) {
  const unlocked = cov.pct >= cp.gate - 1e-9;
  let best = null, attempts = 0;
  for (const h of store.history) {
    if (h.kind === 'checkpoint' && h.sectionId === secId && h.tier === cp.tier) {
      attempts += 1;
      best = best == null ? h.pct : Math.max(best, h.pct);
    }
  }
  return { unlocked, best, attempts };
}

function startCheckpoint(secId, tier) {
  const sec = DB.sections.find((s) => s.id === secId);
  if (!sec) return;
  const cov = sectionCoverage(secId);
  const cp = CHECKPOINTS[tier - 1];
  if (cov.pct < cp.gate - 1e-9) { renderSectionPage(secId); return; }
  if (trialBlocked()) return;
  const seenQs = sectionQuestions(secId).filter((q) => { const r = store.q[q.id]; return r && r.s > 0; });
  const qs = shuffle(seenQs).slice(0, Math.min(20, seenQs.length));
  if (!qs.length) { renderSectionPage(secId); return; }
  stopTimer();
  const total = qs.length * EXAM_SEC_PER_Q;
  session = {
    sectionId: secId, mode: 'exam',
    title: `${sec.name} — Checkpoint ${tier}`,
    checkpoint: { sectionId: secId, tier },
    questions: qs, idx: 0,
    picked: qs.map(() => null),
    submitted: qs.map(() => false),
    selfGrades: qs.map(() => null),
    flagged: new Set(),
    timeLeft: total, totalTime: total,
    finished: false, timerId: null,
  };
  startTimer();
  persistSession();
  renderQuiz();
  window.scrollTo(0, 0);
}

/* ---------------- session build / persist / resume ---------------- */
let session = null;

function buildSession(sectionId, mode) {
  let qs, title;
  if (mode === 'cram') {
    qs = cramPool();
    title = 'Cram Review — weakest questions';
  } else if (sectionId === 'all') {
    qs = shuffle(ALL_QUESTIONS);
    title = 'Mixed — All Sections';
  } else if (sectionId === 'wrong') {
    qs = shuffle(wrongPool());
    title = 'Practice Wrong Answers';
  } else if (sectionId.startsWith('wrong-')) {
    const sid = sectionId.slice(6);
    const sec = DB.sections.find((s) => s.id === sid);
    qs = shuffle(sectionQuestions(sid).filter((q) => {
      const r = store.q[q.id];
      return r && r.s > 0 && masteryOf(r) < 75;
    }));
    title = `${sec ? sec.name : sid} — Wrong Answers`;
  } else if (sectionId === 'starred') {
    qs = store.starred.map((qid) => DB.byId[qid]).filter(Boolean);
    title = 'Bookmarked Questions';
  } else if (sectionId.startsWith('starred-')) {
    const sid = sectionId.slice(8);
    const sec = DB.sections.find((s) => s.id === sid);
    qs = store.starred.map((qid) => DB.byId[qid]).filter((q) => q && q.sectionId === sid);
    title = `${sec ? sec.name : sid} — Bookmarks`;
  } else {
    qs = shuffle(sectionQuestions(sectionId));
    const sec = DB.sections.find((s) => s.id === sectionId);
    title = sec ? `${sec.name} — ${sec.nameAr}` : sectionId;
  }
  // exam answers are only recorded at the end, so a trial exam is cut to what is left
  if (mode === 'exam') qs = qs.filter(isAnswerable).slice(0, hasFullAccess() ? EXAM_MAX_Q : Math.min(EXAM_MAX_Q, trialLeft()));
  if (mode === 'cram') qs = qs.filter(isAnswerable).slice(0, CRAM_MAX);
  return {
    sectionId, mode, title,
    questions: qs,
    idx: 0,
    picked: qs.map(() => null),
    submitted: qs.map(() => false),
    selfGrades: qs.map(() => null),
    flagged: new Set(),
    timeLeft: mode === 'exam' ? Math.min(qs.length, EXAM_MAX_Q) * EXAM_SEC_PER_Q : null,
    finished: false,
    timerId: null,
  };
}

function persistSession() {
  if (!session || session.mode === 'cram' || session.finished) return;
  store.active = {
    sectionId: session.sectionId,
    mode: session.mode,
    mockKind: session.mockKind,
    milestoneId: session.milestoneId,
    simId: session.simId,
    title: session.title,
    qIds: session.questions.map((q) => q.id),
    meta: session.questions.map((q) => ({ c: q.fromCovered ? 1 : 0, d: q.mockDomain || null })),
    idx: session.idx,
    picked: session.picked,
    submitted: session.submitted,
    selfGrades: session.selfGrades,
    flagged: [...session.flagged],
    timeLeft: session.timeLeft,
    totalTime: session.totalTime,
  };
  saveStore();
}

function clearActive() {
  if (store.active) { store.active = null; saveStore(); }
}

function resumeSession() {
  const a = store.active;
  if (!a) return;
  if (trialBlocked()) return;
  if (a.mode === 'mock' && !a.mockKind) { clearActive(); renderHome(); return; }   // pre-ladder attempt
  const questions = (a.qIds || []).map((id) => DB.byId[id]);
  if (!questions.length || questions.some((q) => !q)) { clearActive(); renderHome(); return; }
  (a.meta || []).forEach((mt, i) => {
    if (questions[i]) { questions[i].fromCovered = !!mt.c; questions[i].mockDomain = mt.d || sectionDomainOf(questions[i].sectionId); }
  });
  stopTimer();
  session = {
    sectionId: a.sectionId, mode: a.mode, title: a.title,
    mockKind: a.mockKind, milestoneId: a.milestoneId, simId: a.simId,
    questions, idx: a.idx || 0,
    picked: a.picked || questions.map(() => null),
    submitted: a.submitted || questions.map(() => false),
    selfGrades: a.selfGrades || questions.map(() => null),
    flagged: new Set(a.flagged || []),
    timeLeft: (a.mode === 'exam' || a.mode === 'mock') ? a.timeLeft : null,
    totalTime: a.totalTime || null,
    finished: false, timerId: null,
  };
  if (session.mode === 'exam' || session.mode === 'mock') startTimer();
  renderQuiz();
}

function discardActive() { clearActive(); renderHome(); }

/* ---------------- routing ---------------- */
const app = $('#app');

window.addEventListener('hashchange', route);

function currentTab() {
  const h = location.hash || '#/';
  if (h.startsWith('#/practice') || h.startsWith('#/section/')) return 'practice';
  if (h.startsWith('#/exams')) return 'exams';
  return 'home';
}

// a link to the screen already in the address bar fires no hashchange (a session
// resumed from Home keeps "#/"), so route it by hand
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#/"]');
  if (a && a.getAttribute('href') === (location.hash || '#/')) { e.preventDefault(); route(); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeSheet(); closeGrid(); Guide.endTour(); } });

const profileOrNull = () => (window.SB && SB.configured && SB.profile) || null;
const initialOf = (p) => (p.name || p.email || '').replace(/^(د|dr)\.?\s*/i, '').trim().charAt(0).toUpperCase();

// back: sub-screen with a back arrow + title; otherwise the brand. right: override the account button
function appBar(o = {}) {
  const p = profileOrNull();
  const lead = o.lead || (o.back
    ? `<div class="bar-lead"><a class="icon-btn" href="${o.back}" aria-label="Back">${icon('back')}</a><div class="bar-title">${esc(o.title || '')}</div></div>`
    : `<a class="brand" href="#/"><div class="brand-logo">${LOGO}</div><div class="brand-name">Oman EM Prep</div></a>`);
  const right = o.right ?? `<button class="avatar-btn" onclick="openAccount()" aria-label="Account and settings">${p && initialOf(p) ? esc(initialOf(p)) : icon('user')}</button>`;
  return `<header class="topbar"><div class="topbar-inner">${lead}<div class="bar-actions">${right}</div></div>${o.below || ''}</header>`;
}

function openAccount() {
  const p = profileOrNull();
  const dark = document.documentElement.dataset.theme === 'dark';
  const own = partsOwned();
  const row = (attrs, ic, title, sub = '', cls = '') => `
    <button class="row ${cls}" ${attrs}>
      <span class="row-icon">${icon(ic)}</span>
      <span class="row-body"><span class="row-title">${title}</span>${sub ? `<span class="row-sub">${sub}</span>` : ''}</span>
    </button>`;
  openSheet(`
    <div dir="rtl">
      ${p ? `<div class="acct-head">
        <div class="avatar-btn lg">${esc(initialOf(p)) || icon('user')}</div>
        <div class="row-body"><span class="row-title">${esc(p.name || 'طبيب')}</span><span class="row-sub" dir="ltr" style="text-align:right">${esc(p.email || '')}</span></div>
      </div>` : ''}
      <div class="list">
        ${!hasFullAccess() ? row(`onclick="closeSheet();location.hash='#/upgrade'"`, 'lock', own ? `اشترك في الجزء ${own + 1} من ${PARTS}` : 'اشترك لتفتح كل الأسئلة',
          own ? `أنت في الجزء ${own}، بقي لك ${trialLeft().toLocaleString('en')} سؤالاً` : `بقي لك ${trialLeft()} من ${accessLimit()} سؤالاً مجانياً`) : ''}
        ${p && !hasFullAccess() && promoReady() ? row('onclick="openPromo()"', 'plus', 'لديك رمز دعائي؟', 'أدخله لتفتح أسئلة إضافية مجاناً') : ''}
        ${p && referralEnabled() ? row('onclick="openReferral()"', 'share', 'ادعُ زميلاً واربح أسئلة', referralPitch()) : ''}
        ${Install.available() ? row('onclick="Install.open()"', 'download', `ثبّت التطبيق على ${Install.device}`, 'يفتح من شاشتك الرئيسية بلمسة واحدة') : ''}
        ${row('onclick="toggleTheme()"', dark ? 'sun' : 'moon', dark ? 'المظهر الفاتح' : 'المظهر الداكن')}
        ${row('onclick="Guide.replay()"', 'info', 'كيف يعمل التطبيق', 'جولة قصيرة في الفكرة والأقسام والاختبارات')}
        ${p ? row('onclick="logout()"', 'logout', 'تسجيل الخروج', '', 'danger') : ''}
      </div>
    </div>`);
}

/* ---------------- promo codes + referrals: bonus free questions ---------------- */
/* Both top up the free-trial limit (profiles.bonus_questions). The server does
   all the granting; the app only collects the code / shares the invite link. */

// until supabase/004 has run the profile has no bonus column: keep the promo entry hidden
const promoReady = () => !!(window.SB && SB.profile && 'bonus_questions' in SB.profile);

// referral is "on" once the admin has set any reward (0 everywhere = hidden)
const referralEnabled = () =>
  !!(SB.profile?.referral_code && (+PAY.referral_reward_signup || +PAY.referral_reward_paid || +PAY.referral_signup_bonus));

function referralLink() {
  const code = SB.profile?.referral_code;
  if (!code) return '';
  return `${location.origin}${location.pathname}?ref=${code}`;
}

// one-line summary for the account row, from whatever rewards the admin set
function referralPitch() {
  const signup = +PAY.referral_reward_signup || 0;
  const paid = +PAY.referral_reward_paid || 0;
  const best = Math.max(signup, paid);
  return best ? `كل زميل ينضم = أسئلة إضافية لك` : 'شارك التطبيق مع زملائك';
}

// enter a promo code -> opens extra questions
function openPromo() {
  closeSheet();
  openSheet(`
    <div dir="rtl" class="promo-sheet">
      <div class="sheet-head"><h2>رمز دعائي</h2>
        <button class="icon-btn" onclick="closeSheet()" aria-label="إغلاق">${icon('close')}</button></div>
      <p class="sheet-sub">أدخل الرمز لتفتح عدداً إضافياً من الأسئلة المجانية فوراً.</p>
      <div class="pay-code-row">
        <input id="promo-in" dir="ltr" placeholder="XXXXXX" autocomplete="off" autocapitalize="characters">
        <button class="btn btn-primary" id="promo-go">تفعيل</button>
      </div>
      <div class="auth-err" id="promo-err" hidden></div>
    </div>`, 'sheet-sm');
  const input = $('#promo-in');
  input?.focus();
  const go = $('#promo-go');
  const fail = (msg) => { const b = $('#promo-err'); b.textContent = msg; b.hidden = false; go.disabled = false; };
  input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') go.click(); });
  go.addEventListener('click', async () => {
    const code = input.value.trim();
    if (!code) return;
    go.disabled = true;
    $('#promo-err').hidden = true;
    let res;
    try { res = await SB.redeemPromo(code); } catch (e) { return fail('تعذر الاتصال — حاول مرة أخرى'); }
    if (res && res.ok) {
      closeSheet();
      toast(`🎉 تم فتح ${(+res.reward).toLocaleString('en')} سؤالاً إضافياً`);
      if (!hasFullAccess() && (location.hash.startsWith('#/upgrade') || trialLeft() <= 0)) { location.hash = '#/'; }
      route();
    } else {
      fail(res && res.error === 'used' ? 'استخدمت هذا الرمز من قبل' : 'رمز غير صالح أو منتهٍ');
    }
  });
}

// share your invite link; the server rewards you automatically when a friend joins
function openReferral() {
  closeSheet();
  const link = referralLink();
  const p = SB.profile || {};
  const signup = +PAY.referral_reward_signup || 0;
  const paid = +PAY.referral_reward_paid || 0;
  const welcome = +PAY.referral_signup_bonus || 0;
  const perk = (text) => `<li>${icon('check')}<span>${text}</span></li>`;
  openSheet(`
    <div dir="rtl" class="referral-sheet">
      <div class="sheet-head"><h2>ادعُ زملاءك</h2>
        <button class="icon-btn" onclick="closeSheet()" aria-label="إغلاق">${icon('close')}</button></div>
      <p class="sheet-sub">شارك رابطك الخاص. يُضاف رصيدك تلقائياً بمجرد انضمام زميلك — بلا أي خطوة منك.</p>
      <ul class="perks">
        ${signup ? perk(`<b>${signup}</b> سؤالاً لك عندما ينضم زميل عبر رابطك`) : ''}
        ${paid ? perk(`<b>${paid}</b> سؤالاً إضافياً عندما يشترك`) : ''}
        ${welcome ? perk(`وزميلك يبدأ بـ <b>${welcome}</b> سؤالاً إضافياً`) : ''}
      </ul>
      <div class="pay-code-row">
        <input id="ref-link" dir="ltr" readonly value="${esc(link)}">
        <button class="btn" id="ref-copy">نسخ</button>
      </div>
      <button class="btn btn-primary btn-lg btn-block" id="ref-share">${icon('share')} مشاركة الرابط</button>
      <div class="ref-stats">
        <div><b>${(+p.referrals || 0).toLocaleString('en')}</b><span>انضموا بدعوتك</span></div>
        <div><b>${(+p.referrals_paid || 0).toLocaleString('en')}</b><span>اشتركوا</span></div>
        <div><b>${bonusQuestions().toLocaleString('en')}</b><span>سؤالاً إضافياً</span></div>
      </div>
    </div>`, 'sheet-sm');

  const shareText = 'جرّب Oman EM Prep — بنك أسئلة اختبار الطوارئ العُماني مع شرح كل إجابة. '
    + (welcome ? `سجّل عبر رابطي وابدأ بـ ${TRIAL_LIMIT + welcome} سؤالاً مجاناً:` : `سجّل عبر رابطي وجرّب ${TRIAL_LIMIT} سؤالاً مجاناً:`);
  $('#ref-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(link);
      const b = $('#ref-copy'); b.textContent = 'تم ✓'; setTimeout(() => { b.textContent = 'نسخ'; }, 1600);
    } catch (e) { $('#ref-link').select(); }
  });
  $('#ref-share').addEventListener('click', async () => {
    if (navigator.share) {
      try { await navigator.share({ title: 'Oman EM Prep', text: shareText, url: link }); return; } catch (e) { /* cancelled */ }
    }
    try {
      await navigator.clipboard.writeText(`${shareText} ${link}`);
      toast('تم نسخ الرابط — الصقه في أي محادثة');
    } catch (e) { $('#ref-link').select(); }
  });
}

function chrome(content, bar = {}) {
  const tab = currentTab();
  const tabs = [
    ['#/', 'home', 'home', 'Home'],
    ['#/practice', 'practice', 'book', 'Practice'],
    ['#/exams', 'exams', 'exam', 'Exams'],
  ];
  let trialBar = '';
  if (!hasFullAccess()) {
    const left = trialLeft();
    const st = SB.profile.access_status;
    const own = partsOwned();
    const msg = st === 'pending' ? `إيصالك قيد المراجعة، بقي لك <b>${left.toLocaleString('en')}</b> سؤالاً`
      : st === 'rejected' ? 'لم نتمكن من قبول الإيصال، أعد رفعه'
      : own ? `الجزء ${own} من ${PARTS}: بقي لك <b>${left}</b> سؤالاً`
      : `بقي لك <b>${left}</b> من ${accessLimit()} سؤالاً مجانياً`;
    if (!own || st !== 'trial' || left <= PART_WARN) {
      trialBar = `<a class="trial-bar ${st === 'rejected' ? 'warn' : ''}" href="#/upgrade">
        <span>${msg}</span><span class="trial-bar-cta">${st === 'pending' ? 'التفاصيل' : own ? 'الجزء التالي' : 'اشترك'}${icon('chev', 'chev')}</span></a>`;
    }
  }
  return `
    ${appBar(bar)}
    <main class="wrap">${trialBar}${content}</main>
    <nav class="navbar" aria-label="Main">
      ${tabs.map(([href, id, ic, label]) => `
        <a class="nav-item ${tab === id ? 'active' : ''}" href="${href}" ${tab === id ? 'aria-current="page"' : ''}>
          <span class="nav-pill">${icon(ic)}</span>${label}
        </a>`).join('')}
    </nav>`;
}

/* ---------------- install as an app ---------------- */
/* Chrome / Edge / Samsung Internet hand us a prompt we can fire from our own
   button. Safari on iPhone has none, so there the sheet shows the three taps. */
const INSTALL_KEY = 'oman-em-prep.install';
const INSTALL_SNOOZE = 14 * 864e5;
const Install = {
  prompt: null,
  state: (() => { try { return JSON.parse(localStorage.getItem(INSTALL_KEY)) || {}; } catch (e) { return {}; } })(),
  save() { try { localStorage.setItem(INSTALL_KEY, JSON.stringify(this.state)); } catch (e) { /* private mode */ } },
  get standalone() { return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; },
  get ios() { return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); },
  get android() { return /Android/i.test(navigator.userAgent); },
  get device() { return this.ios || this.android ? 'جوالك' : 'جهازك'; },

  // not already the installed app, and this device has a way to install it
  available() { return !this.standalone && !this.state.installed && (!!this.prompt || this.ios || this.android); },
  cardVisible() { return this.available() && !(this.state.dismissedAt && Date.now() - this.state.dismissedAt < INSTALL_SNOOZE); },

  cardHtml() {
    if (!this.cardVisible()) return '';
    return `
      <div class="install-card" id="installCard" dir="rtl">
        <img src="icons/icon-192.png" alt="">
        <div class="row-body">
          <span class="row-title">ثبّت التطبيق على ${this.device}</span>
          <span class="row-sub">يفتح من شاشتك الرئيسية بلمسة واحدة</span>
        </div>
        <button class="btn btn-primary btn-sm" onclick="Install.open()">تثبيت</button>
        <button class="icon-btn" onclick="Install.dismiss()" aria-label="إخفاء">${icon('close')}</button>
      </div>`;
  },

  open() {
    const step = (n, text, ic) => `<li><span class="step-n">${n}</span><span>${text}</span>${ic ? icon(ic) : ''}</li>`;
    const how = this.prompt
      ? `<button class="btn btn-primary btn-lg btn-block" onclick="Install.run()">${icon('download')} تثبيت التطبيق</button>`
      : this.ios
        ? `<ol class="steps">
            ${step(1, 'اضغط زر المشاركة في شريط المتصفح', 'share')}
            ${step(2, 'اختر «إضافة إلى الشاشة الرئيسية»', 'plus')}
            ${step(3, 'اضغط «إضافة» — وستجد التطبيق بين تطبيقاتك')}
          </ol>
          <p class="sheet-sub">لا تجد الخيار؟ افتح هذه الصفحة في Safari ثم أعد المحاولة.</p>`
        : `<ol class="steps">
            ${step(1, 'افتح قائمة المتصفح', 'dots')}
            ${step(2, 'اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية»', 'plus')}
            ${step(3, 'أكّد التثبيت — وستجد التطبيق بين تطبيقاتك')}
          </ol>
          <p class="sheet-sub">لا تجد الخيار؟ افتح هذه الصفحة في Chrome ثم أعد المحاولة.</p>`;
    openSheet(`
      <div class="install-sheet" dir="rtl">
        <img src="icons/icon-192.png" alt="">
        <h2>ثبّت Oman EM Prep على ${this.device}</h2>
        <p class="sheet-sub">تطبيق كامل على شاشتك الرئيسية — بلا متجر تطبيقات.</p>
        <ul class="perks">
          <li>${icon('check')}<span>يفتح بلمسة واحدة وبملء الشاشة</span></li>
          <li>${icon('check')}<span>أسرع في كل مرة: الأسئلة محفوظة على جهازك</span></li>
          <li>${icon('check')}<span>تقدّمك محفوظ ويكمل معك حتى مع اتصال ضعيف</span></li>
        </ul>
        ${how}
        <button class="btn btn-ghost btn-block" onclick="Install.dismiss()">ليس الآن</button>
      </div>`);
  },

  async run() {
    const p = this.prompt;
    if (!p) return;
    this.prompt = null;                       // a prompt can be shown once
    p.prompt();
    const choice = await p.userChoice.catch(() => null);
    if (choice && choice.outcome === 'accepted') closeSheet();
    else this.dismiss();
  },

  dismiss() {
    this.state.dismissedAt = Date.now();
    this.save();
    closeSheet();
    $('#installCard')?.remove();
  },

  // the prompt arrives a moment after load: surface the offer on screens already drawn
  refresh() {
    if ($('.monitor') && !$('#installCard') && this.cardVisible()) $('.monitor').insertAdjacentHTML('afterend', this.cardHtml());
    const link = $('#authInstall');
    if (link) link.hidden = !this.available();
  },

  // once, after the doctor has answered a few questions and seen the value
  nudge() {
    if (this.state.nudged || !this.cardVisible() || uniqueCovered() < 5) return;
    this.state.nudged = true;
    this.save();
    setTimeout(() => { if ($('.monitor') && !$('#sheetRoot') && !$('#tourRoot')) this.open(); }, 700);
  },
};

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  Install.prompt = e;
  if (Install.state.installed) { Install.state.installed = false; Install.save(); }   // it was removed since
  Install.refresh();
});
window.addEventListener('appinstalled', () => {
  Install.prompt = null;
  Install.state.installed = true;
  Install.save();
  closeSheet();
  $('#installCard')?.remove();
  toast('تم تثبيت التطبيق — ستجده على شاشتك الرئيسية');
});
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}

/* ---------------- first run: intro slides, then a tour of Home ---------------- */
/* The slides say why the app works the way it does (the explanation at once,
   mistakes that come back, exams that open with coverage); the tour then
   points at the parts of Home. Each runs once per browser and both can be
   replayed from the account sheet. */
const GUIDE_KEY = 'oman-em-prep.guide';
const BEAT = 'h30q5-8 10 0h10l4 4 7-28 8 38 6-14h13q8-12 16 0h16';   // one heartbeat, 120 units wide

// the ladder's numbers as the blueprint states them, so the copy cannot drift from the rules
function ladderFacts() {
  const ms = BLUEPRINT?.milestoneTests || [];
  const sims = BLUEPRINT?.simulations || [];
  if (!ms.length || !sims.length) return null;
  return {
    ms, sims, m: ms[0], sim: sims[0],
    code: esc(BLUEPRINT.exam.code),
    first: ms[0].unlockAt,
    step: ms.length > 1 ? ms[1].unlockAt - ms[0].unlockAt : 0,
    simPct: Math.round(sims[0].unlockAtCoverage * 100),
    covered: Math.round(ms[0].mix.covered * 100),
  };
}

// art: a specimen of the real interface, drawn on the brand panel
function introSlides() {
  const f = ladderFacts();
  const num = (x) => x.toLocaleString('en');
  const row = (lead, text, tail = '', cls = '') => `<div class="sp-row ${cls}">${lead}<span class="sp-t">${text}</span>${tail}</div>`;
  const pips = (...kinds) => `<span class="sp-pips">${kinds.map((k) => `<i class="${k}"></i>`).join('')}</span>`;
  const slides = [
    {
      title: 'تعلّم لتعرف، لا لتجتاز فقط',
      text: 'ما تدرسه بنيّة الفهم يبقى معك في قسم الطوارئ بعد سنوات، وما تحفظه لأجل ورقة الاختبار يتبخّر بعدها. لذلك يظهر شرح كل إجابة فور اختيارك، سواء أصبت أم أخطأت.',
      art: `<div class="sp">
        ${row('<span class="sp-key">B</span>', 'IM adrenaline 0.5 mg', icon('check'), 'ok')}
        <p class="sp-note"><b>Why</b>First-line in anaphylaxis. Give it in the outer thigh and repeat after 5 minutes if there is no response.</p>
      </div>`,
    },
    {
      title: 'أكثر من 5,000 حالة تضعك أمام 80% من أقرانك',
      text: '18 قسماً مرتبة بأوزان المخطط الرسمي للاختبار. كل حالة تحلّها بفهم تقرّبك من مقدمة دفعتك، ومؤشر الجاهزية في الصفحة الرئيسية يريك أين وصلت.',
      art: `<div class="sp sp-people">
        ${Array.from({ length: 10 }, (_, k) => icon('user', k === 8 ? 'you' : '')).join('')}
        <span class="sp-span">80% of your peers</span><span class="sp-span you">You</span>
      </div>`,
    },
    {
      title: 'أخطاؤك تعود إليك حتى تتقنها',
      text: 'كل سؤال تخطئ فيه يدخل قائمة مراجعة الأخطاء، ويبقى فيها حتى تجيبه صحيحاً مرتين متتاليتين. ثلاث إجابات صحيحة متتالية تجعله متقَناً، وأضعف أسئلتك تنتظرك بطاقات سريعة للمراجعة.',
      art: `<div class="sp">
        ${row(pips('no'), 'Wrong: it joins your review pile')}
        ${row(pips('ok', 'ok'), 'Right twice in a row: it leaves the pile')}
        ${row(pips('ok', 'ok', 'ok'), 'Right three times: <b>Mastered</b>')}
      </div>`,
    },
  ];
  if (f) {
    slides.push({
      title: 'الاختبارات تُفتح بما تحلّه',
      text: `أول اختبار يُفتح بعد ${num(f.first)} سؤال${f.step ? `، ثم اختبار جديد كل ${num(f.step)} سؤال` : ''}. محاكاة الاختبار الرسمي تُفتح عندما تغطي ${f.simPct}% من بنك الأسئلة. إعادة السؤال نفسه لا تُحتسب، فالعدّ للأسئلة الجديدة فقط.`,
      art: `<div class="sp">
        ${row(`<span class="sp-gate">${num(f.first)} solved</span>`, 'Milestone Test 1', icon('lock'))}
        ${f.ms[1] ? row(`<span class="sp-gate">${num(f.ms[1].unlockAt)} solved</span>`, 'Milestone Test 2', icon('lock')) : ''}
        ${f.step ? `<p class="sp-more">then one more every ${num(f.step)} questions</p>` : ''}
        ${row(`<span class="sp-gate">${f.simPct}% covered</span>`, `${f.code} Simulation 1`, icon('lock'))}
      </div>`,
    }, {
      title: 'نوعان من الاختبارات',
      // dir on the Latin names keeps the digits that follow them in the Arabic run
      text: [
        `<b dir="ltr">Milestone</b> يقيس ما ترسّخ فعلاً: ${f.m.size} سؤالاً في ${f.m.minutes} دقيقة، ${f.covered}% منها مما درسته و${100 - f.covered}% جديد.`,
        `<b dir="ltr">${f.code} Simulation</b> ورقة واحدة ثابتة لكل الأطباء بتوزيع المخطط الرسمي: ${f.sim.size} سؤال في ${f.sim.minutes} دقيقة.`,
      ],
      art: `<div class="sp sp-duo">
        <div class="sp-card"><b>Milestone test</b><span>${f.ms.length} tests</span><span>${f.m.size} questions, ${f.m.minutes} min</span><span>${f.covered}% studied, ${100 - f.covered}% new</span></div>
        <div class="sp-card alt"><b>${f.code} simulation</b><span>${f.sims.length} papers</span><span>${f.sim.size} questions, ${f.sim.minutes} min</span><span>Same paper for everyone</span></div>
      </div>`,
    });
  }
  return slides;
}

// done: where the last slide leads. login: given when the visitor may already have an account
function renderIntro(done, login = null) {
  session = null;
  const slides = introSlides();
  const trace = `M0 30${BEAT.repeat(3)}`;
  let i = 0;
  app.innerHTML = `
    <div class="auth-wrap intro">
      <div class="auth-hero">
        <div class="intro-bar" dir="rtl">
          <div class="brand-logo">${LOGO}</div>
          <button class="intro-skip" id="in-skip">تخطي</button>
        </div>
        <svg class="intro-trace" viewBox="0 0 360 48" preserveAspectRatio="none" role="img">
          <path class="rail" d="${trace}"/><path class="live" pathLength="100" d="${trace}"/>
        </svg>
        <div class="intro-stage" id="in-stage" aria-hidden="true"></div>
      </div>
      <div class="auth-card" dir="rtl">
        <div class="intro-copy" id="in-copy" aria-live="polite"></div>
        <div class="intro-actions">
          <button class="btn btn-primary btn-lg btn-block" id="in-next"></button>
          <button class="btn btn-ghost btn-block" id="in-alt"></button>
        </div>
      </div>
    </div>`;
  $('meta[name="theme-color"]')?.setAttribute('content', document.documentElement.dataset.theme === 'dark' ? '#113039' : '#0c2a34');
  window.scrollTo(0, 0);

  const leave = (to) => { Guide.mark('intro'); to(); };
  const show = () => {
    const s = slides[i];
    const last = i === slides.length - 1;
    $('#in-stage').innerHTML = `<div class="intro-in">${s.art}</div>`;
    $('#in-copy').innerHTML = `<div class="intro-in"><h1>${s.title}</h1>${[].concat(s.text).map((p) => `<p>${p}</p>`).join('')}</div>`;
    // the trace is the progress bar: it has drawn this far through the slides
    $('.intro-trace .live').style.strokeDashoffset = 100 - ((i + 1) / slides.length) * 100;
    $('.intro-trace').setAttribute('aria-label', `الشاشة ${i + 1} من ${slides.length}`);
    $('#in-next').textContent = !last ? 'التالي' : login ? `ابدأ بـ ${TRIAL_LIMIT} سؤالاً مجاناً` : 'ابدأ الآن';
    $('#in-alt').textContent = i ? 'السابق' : 'لديّ حساب، تسجيل الدخول';
    $('#in-alt').style.visibility = i || login ? '' : 'hidden';
    $('#in-skip').style.visibility = last ? 'hidden' : '';
  };
  const go = (d) => {
    if (i + d < 0 || i + d >= slides.length) return;
    i += d;
    show();
  };
  $('#in-next').addEventListener('click', () => (i === slides.length - 1 ? leave(done) : go(1)));
  $('#in-alt').addEventListener('click', () => (i ? go(-1) : leave(login)));
  $('#in-skip').addEventListener('click', () => leave(done));

  // right-to-left reading: the next slide is pulled in from the left
  let x0 = 0, y0 = 0;
  const wrap = $('.intro');
  wrap.addEventListener('touchstart', (e) => { x0 = e.changedTouches[0].clientX; y0 = e.changedTouches[0].clientY; }, { passive: true });
  wrap.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - x0;
    const dy = e.changedTouches[0].clientY - y0;
    if (Math.abs(dx) >= 60 && Math.abs(dx) > Math.abs(dy) * 2) go(dx > 0 ? 1 : -1);
  }, { passive: true });
  show();
}

const Guide = {
  state: (() => { try { return JSON.parse(localStorage.getItem(GUIDE_KEY)) || {}; } catch (e) { return {}; } })(),
  place: null,   // set while the tour is on screen: re-aims the spotlight after a scroll or resize
  mark(key, on = 1) {
    this.state[key] = on;
    try { localStorage.setItem(GUIDE_KEY, JSON.stringify(this.state)); } catch (e) { /* private mode */ }
  },

  // r: corner radius of the part being pointed at
  tourSteps() {
    const f = ladderFacts();
    return [
      {
        sel: '.monitor', r: 22,
        title: 'مؤشر جاهزيتك للاختبار',
        text: 'يرتفع كلما أجبت السؤال نفسه صحيحاً أكثر من مرة. Coverage ما حللته من البنك، Accuracy دقة إجاباتك، Mastered ما أتقنته بثلاث إجابات صحيحة متتالية.',
      }, {
        sel: '.next-card', r: 20,
        title: 'خطوتك التالية جاهزة دائماً',
        text: 'التطبيق يختار لك ما تفعله الآن: إكمال قسم، مراجعة أخطائك، أو بطاقات سريعة لأضعف أسئلتك. لمسة واحدة وتبدأ.',
      }, {
        sel: '.nav-item[href="#/practice"]', r: 16,
        title: 'Practice: الدراسة بالأقسام',
        text: `${DB.sections.length} قسماً، الأثقل وزناً في الاختبار أولاً. داخل كل قسم أسئلته مع الشرح، وأخطاؤك فيه، وما حفظته بالعلامة، واختبارات قصيرة تُفتح عند 25% و50% و75% من أسئلته.`,
      }, {
        sel: '.nav-item[href="#/exams"]', r: 16,
        title: 'Exams: سلّم الاختبارات',
        text: f
          ? `${f.ms.length} اختبارات Milestone و${f.sims.length} محاكاة للاختبار الرسمي. تُفتح تباعاً بعدد الأسئلة التي حللتها، وأولها بعد ${f.first.toLocaleString('en')} سؤال.`
          : 'اختبارات موقوتة تُفتح تباعاً بعدد الأسئلة التي حللتها.',
      }, {
        sel: '.topbar .avatar-btn', r: 99,
        title: 'حسابك وإعداداتك',
        text: 'المظهر الداكن، تثبيت التطبيق على جوالك، وإعادة هذه الجولة متى شئت.',
      },
    ].filter((s) => $(s.sel));
  },

  // true when the tour took the screen
  startTour() {
    if (this.state.tour || this.place || !$('.monitor')) return false;
    const steps = this.tourSteps();
    if (!steps.length) return false;
    const root = document.createElement('div');
    root.className = 'tour';
    root.id = 'tourRoot';
    root.innerHTML = '<div class="tour-hole"></div><div class="tour-bubble" dir="rtl" role="dialog" aria-live="polite"></div>';
    document.body.appendChild(root);
    app.inert = true;   // the screen underneath is being shown, not used
    const hole = $('.tour-hole', root);
    const bubble = $('.tour-bubble', root);
    let i = 0;

    const place = () => {
      const el = $(steps[i].sel);
      if (!el) { this.endTour(); return; }
      const r = el.getBoundingClientRect();
      const pad = 6, gap = 14;
      Object.assign(hole.style, {
        top: `${r.top - pad}px`, left: `${r.left - pad}px`,
        width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px`,
        borderRadius: `${steps[i].r + pad}px`,
      });
      const vw = document.documentElement.clientWidth, vh = window.innerHeight;
      const bw = bubble.offsetWidth, bh = bubble.offsetHeight;
      const mid = r.left + r.width / 2;
      // under the part when it fits there, otherwise above it
      const below = r.bottom + pad + gap + bh <= vh - 8 || r.top - pad - gap - bh < 8;
      const top = below ? r.bottom + pad + gap : r.top - pad - gap - bh;
      const left = Math.max(12, Math.min(vw - bw - 12, mid - bw / 2));
      bubble.classList.toggle('above', !below);
      bubble.style.top = `${Math.max(8, Math.min(top, vh - bh - 8))}px`;
      bubble.style.left = `${left}px`;
      bubble.style.setProperty('--arrow-x', `${Math.max(18, Math.min(bw - 32, mid - left - 7))}px`);
    };
    const show = () => {
      const s = steps[i];
      const last = i === steps.length - 1;
      bubble.innerHTML = `
        <h3>${s.title}</h3>
        <p>${s.text}</p>
        <div class="tour-foot">
          <span class="tour-count">${i + 1} من ${steps.length}</span>
          ${last ? '' : '<button class="btn btn-ghost btn-sm" data-act="end">تخطي</button>'}
          <button class="btn btn-primary btn-sm" data-act="next">${last ? 'ابدأ الدراسة' : 'التالي'}</button>
        </div>`;
      const el = $(s.sel);
      if (el?.closest('main')) el.scrollIntoView({ block: 'center' });
      place();
      $('[data-act="next"]', bubble).focus({ preventScroll: true });
    };
    root.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act && e.target.closest('.tour-bubble')) return;   // a tap on the text is reading, not "next"
      if (act === 'end' || i === steps.length - 1) { this.endTour(); return; }
      i += 1;
      show();
    });

    this.place = place;
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, { passive: true });
    show();
    document.fonts?.ready.then(() => this.place?.());   // web fonts land after the first paint and move things
    return true;
  },

  endTour() {
    if (!this.place) return;
    window.removeEventListener('resize', this.place);
    window.removeEventListener('scroll', this.place);
    this.place = null;
    $('#tourRoot')?.remove();
    app.inert = false;
    window.scrollTo(0, 0);   // the tour scrolled Home to reach its parts
    this.mark('tour');
  },

  // from the account sheet: the slides again, then the tour
  replay() {
    closeSheet();
    this.mark('tour', 0);
    renderIntro(() => {
      if ((location.hash || '#/') === '#/') route();
      else location.hash = '#/';
    });
  },
};

function route() {
  stopTimer();
  clearInterval(payPoll);
  closeSheet();
  Guide.endTour();
  applyTheme();
  const hash = location.hash || '#/';
  if (!hasFullAccess() && (hash.startsWith('#/upgrade') || trialLeft() === 0)) {
    session = null;
    renderPaywall();
    return;
  }
  const qm = hash.match(/^#\/quiz\/([\w-]+)\/(study|exam|cram|mock)/);
  if (qm) {
    if (qm[2] === 'mock') { renderBriefing(); return; }
    session = buildSession(decodeURIComponent(qm[1]), qm[2]);
    if (session.questions.length === 0) { renderEmpty(session); return; }
    if (session.mode === 'exam') startTimer();
    persistSession();
    renderQuiz();
    return;
  }
  const sm = hash.match(/^#\/section\/([\w-]+)/);
  if (sm) { renderSectionPage(decodeURIComponent(sm[1])); return; }
  if (hash.startsWith('#/practice')) { renderPractice(); return; }
  if (hash.startsWith('#/exams')) { renderExams(); return; }
  if (hash.startsWith('#/recalls')) { renderRecalls(); return; }
  session = null;
  renderHome();
}

/* ---------------- home: today's queue ---------------- */
function todayQueue() {
  const items = [];
  const wrong = wrongPool();
  if (wrong.length >= 3) {
    items.push({
      icon: 'refresh',
      title: `Review ${wrong.length} wrong answers`,
      sub: 'Each one leaves the pile after two correct in a row',
      cta: 'Review them now',
      href: '#/quiz/wrong/study',
    });
  }
  let sec = null, label = null, sub = null;
  const touched = DB.sections
    .map((s) => {
      let seen = 0, last = 0;
      for (const q of DB[s.id]) {
        const r = store.q[q.id];
        if (r && r.s > 0) { seen += 1; last = Math.max(last, r.lastSeen); }
      }
      return { s, seen, last };
    })
    .filter((x) => x.seen > 0)
    .sort((a, b) => b.last - a.last);
  if (touched.length) {
    sec = touched[0].s;
    label = `Continue ${sec.name}`;
    sub = `${touched[0].seen} of ${sec.count} questions covered. Each answer shows its explanation at once.`;
  } else {
    sec = DB.sections.find((s) => s.id === 'medicine') || DB.sections[0];
    label = `Start with ${sec.name}`;
    sub = 'The highest-yield section. Each answer shows its explanation at once.';
  }
  if (sec) {
    items.push({
      icon: 'book',
      title: label,
      sub,
      cta: touched.length ? 'Continue studying' : 'Start studying',
      href: `#/quiz/${sec.id}/study`,
    });
  }
  const crams = cramPool();
  if (crams.length >= 3) {
    items.push({
      icon: 'bolt',
      title: `Cram ${Math.min(crams.length, CRAM_MAX)} flashcards`,
      sub: 'Your weakest questions, fast and unscored',
      cta: 'Start cramming',
      href: '#/quiz/cram/cram',
    });
  }
  return items.slice(0, 3);
}

const histRows = (list, kindOf) => list.map((h) => {
  const pct = h.total ? Math.round((h.correct / h.total) * 100) : 0;
  return `
    <div class="hist-row">
      <span class="hist-score ${pct >= 70 ? 'ok' : 'no'}">${pct}%</span>
      <span class="hist-title">${esc(h.title)}</span>
      <span class="hist-meta">${kindOf(h)} · ${h.correct}/${h.total} · ${new Date(h.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
    </div>`;
}).join('');

let traceDrawn = false;   // the monitor trace draws itself once per launch, not on every visit to Home

function renderHome() {
  const st = readiness();

  const resume = store.active && store.active.qIds?.length ? store.active : null;
  // the session being resumed is not offered a second time further down
  const queue = todayQueue().filter((it) => !resume || it.href !== `#/quiz/${resume.sectionId}/${resume.mode}`);
  const lead = resume ? null : queue.shift();
  let nextCard = '';
  if (resume) {
    const kind = resume.mode === 'exam' ? 'Timed test' : resume.mode === 'mock' ? 'Exam' : 'Study';
    nextCard = `
      <div class="next-card">
        <div class="next-title">Resume where you left off</div>
        <div class="next-sub">${esc(resume.title)}. ${kind}, question ${(resume.idx || 0) + 1} of ${resume.qIds.length}${resume.mode === 'mock' ? `, ${fmtTime(resume.timeLeft || 0)} left` : ''}.</div>
        ${bar(((resume.idx || 0) / resume.qIds.length) * 100)}
        <button class="btn btn-primary btn-lg btn-block" onclick="resumeSession()">${icon('play', 'fill')} Resume</button>
      </div>`;
  } else if (lead) {
    nextCard = `
      <div class="next-card">
        <div class="next-title">${esc(lead.title)}</div>
        <div class="next-sub">${esc(lead.sub)}</div>
        <a class="btn btn-primary btn-lg btn-block" href="${lead.href}">${esc(lead.cta)}</a>
      </div>`;
  }
  const queueRows = queue.map((it) => `
    <a class="row" href="${it.href}">
      <span class="row-icon">${icon(it.icon)}</span>
      <span class="row-body"><span class="row-title">${esc(it.title)}</span><span class="row-sub">${esc(it.sub)}</span></span>
      ${icon('chev', 'chev')}
    </a>`).join('');

  const goal = nextGoal();
  const goalHtml = goal
    ? `<div class="section-heading"><h2>Next exam goal</h2><span>هدفك التالي في سلّم الاختبارات</span></div>
      <div class="list">
        <a class="row" href="${goal.href}">
          <span class="row-icon">${icon('target')}</span>
          <span class="row-body">
            <span class="row-title" dir="auto">${esc(goal.title)}</span>
            ${goal.pct < 100 ? bar(goal.pct * 100) : ''}
            <span class="row-sub" dir="auto">${esc(goal.sub)}</span>
          </span>
          ${icon('chev', 'chev')}
        </a>
      </div>`
    : '';

  const hist = store.history.slice(0, 3);
  const histHtml = hist.length
    ? `<div class="hist-list">${histRows(hist, (h) => h.mode === 'mock' ? 'OEEM' : h.mode === 'exam' ? 'Test' : 'Study')}</div>`
    : `<div class="card"><div class="card-meta">Finish a session and your scores will collect here.</div></div>`;

  const content = `
    <section class="monitor" aria-label="Exam readiness">
      ${TRACE(traceDrawn ? '' : 'draw')}
      <div class="monitor-label">Exam readiness</div>
      <div class="monitor-value">${st.readiness}<span>%</span></div>
      <div class="monitor-channels">
        <div class="ch ch-cov"><span>Coverage</span><b>${st.seen}<i>/${st.total}</i></b></div>
        <div class="ch ch-acc"><span>Accuracy</span><b>${st.accuracy}<i>%</i></b></div>
        <div class="ch ch-mas"><span>Mastered</span><b>${st.mastered}</b></div>
      </div>
    </section>
    ${Install.cardHtml()}
    <div class="section-heading"><h2>Up next</h2><span>قائمة اليوم بالترتيب</span></div>
    ${nextCard}
    ${queueRows ? `<div class="list">${queueRows}</div>` : ''}
    ${goalHtml}
    <div class="section-heading"><h2>Recent sessions</h2><span>آخر الجلسات</span></div>
    ${histHtml}
    ${RECALLS?.length ? recallsHomeCard() : ''}`;
  app.innerHTML = chrome(content);
  traceDrawn = true;
  if (!Guide.startTour()) Install.nudge();   // one thing at a time on a first visit
}

/* ---------------- recalls: read-only archive ---------------- */
function recallsHomeCard() {
  return `
    <div class="section-heading"><h2>Exam recalls</h2><span>أسئلة وردت في اختبارات سابقة</span></div>
    <a class="row" href="#/recalls">
      <span class="row-icon">${icon('bookmark')}</span>
      <span class="row-body">
        <span class="row-title">ريكولات — للقراءة فقط</span>
        <span class="row-sub">${RECALLS.length} سؤالاً كما ورد، مع تبرير علمي موثق لكل واحد</span>
      </span>
      ${icon('chev', 'chev')}
    </a>`;
}

const RECALL_STATE = {
  confirmed: { label: 'مؤكَّد علمياً', cls: 'ok', ic: 'check' },
  probable:  { label: 'مُرجَّح', cls: 'warn', ic: 'info' },
  unresolved:{ label: 'غير محسوم', cls: 'dim', ic: 'search' },
};
// archive options/answers are shown in a handwriting face; the scientific layer stays in the normal face
const splitOpts = (s) => String(s || '').split(/\s*(?:\/|—|؛|;)\s*/).filter(Boolean);

let recallFilter = { q: '', state: 'all' };

function renderRecalls() {
  session = null;
  if (!RECALLS) {
    app.innerHTML = chrome(`<div class="page-head"><h1>Exam recalls</h1><p>…</p></div>`);
    return;
  }
  const counts = { all: RECALLS.length, confirmed: 0, probable: 0, unresolved: 0 };
  RECALLS.forEach((r) => { counts[r.state]++; });
  const q = recallFilter.q.trim().toLowerCase();
  const rows = RECALLS.filter((r) =>
    (recallFilter.state === 'all' || r.state === recallFilter.state) &&
    (!q || [r.raw_text, r.raw_options, r.raw_answer, r.topic, r.answer, r.justification]
      .some((f) => f && String(f).toLowerCase().includes(q))));
  const chip = (id, label) => `
    <button class="recall-chip ${recallFilter.state === id ? 'on' : ''}"
      onclick="recallFilter.state='${id}';renderRecalls()">${label} <b>${counts[id]}</b></button>`;
  const cards = rows.map(recallCard).join('') ||
    `<div class="card"><div class="card-meta">لا نتائج مطابقة.</div></div>`;
  const content = `
    <div class="page-head">
      <h1>Exam recalls</h1>
      <p dir="rtl">أسئلة رويتها دفعات سابقة، معروضة كما وردت حرفياً — والطبقة العلمية تحتها موثقة بمصادر عليا. اضغط أي زر تحقق لتفتح البحث بنتائجه جاهزة.</p>
    </div>
    <div class="recall-chips">
      ${chip('all', 'الكل')}${chip('confirmed', 'مؤكَّد')}${chip('probable', 'مُرجَّح')}${chip('unresolved', 'غير محسوم')}
    </div>
    <input class="recall-search" type="search" placeholder="ابحث في الريكولات…" value="${esc(recallFilter.q)}"
      oninput="recallFilter.q=this.value;clearTimeout(window.__rqT);window.__rqT=setTimeout(renderRecalls,250)" dir="rtl">
    <div class="recall-list">${cards}</div>`;
  app.innerHTML = chrome(content);
}

function recallCard(r) {
  const st = RECALL_STATE[r.state] || RECALL_STATE.unresolved;
  const student = r.raw_answer && !/غير مذكور/.test(r.raw_answer) ? r.raw_answer : null;
  const opts = splitOpts(r.raw_options);
  const sourceLinks = (r.sources || []).map((s) =>
    `<a class="recall-src" href="${esc(s.url)}" target="_blank" rel="noopener">${icon('bookmark')} ${esc(s.label)}</a>`).join('');
  const verdictHtml = r.state === 'unresolved'
    ? `<p class="recall-why" dir="auto">No scientifically verified answer could be established for this item — check it yourself via the search buttons.</p>`
    : `
      ${r.answer ? `<div class="recall-ans" dir="auto"><span>الجواب المُرجَّح</span><b>${esc(r.answer)}</b></div>` : ''}
      <p class="recall-why" dir="auto">${esc(r.justification)}</p>
      ${sourceLinks ? `<div class="recall-srcs">${sourceLinks}</div>` : ''}`;
  const archive = `
    <button class="recall-arch-t" onclick="this.nextElementSibling.toggleAttribute('hidden');this.classList.toggle('open')">
      كما ورد في الريكالات <span class="recall-arch-hint">النص الحرفي لم تُمسّ</span>
    </button>
    <div class="recall-arch" hidden dir="auto">
      <p class="hand">${esc(r.raw_text)}</p>
      ${opts.length ? `<ul class="hand">${opts.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>` : ''}
      ${student ? `<p class="hand recall-student">الجواب كما ورد: ${esc(student)}</p>` : ''}
      <div class="recall-meta">
        <span>${r.type === 'handwritten' ? 'خط يد' : 'مطبوع'}</span>
        <span>المصدر: ${esc(r.source_file)}</span>
        ${r.page ? `<span>صفحة ${esc(r.page)}</span>` : ''}
        <span>ثقة الاستخراج ${r.extraction_confidence}/10</span>
      </div>
    </div>`;
  return `
    <article class="recall-card">
      <div class="recall-top">
        <span class="recall-topic" dir="auto">${esc(r.topic || 'Recall')}</span>
        <span class="recall-badge ${st.cls}">${icon(st.ic)} ${st.label}</span>
      </div>
      ${verdictHtml}
      <div class="recall-searchbtns">
        <a class="btn btn-sm recall-go" href="${esc(r.google_url)}" target="_blank" rel="noopener">تحقق في Google</a>
        <a class="btn btn-sm recall-go alt" href="${esc(r.pubmed_url)}" target="_blank" rel="noopener">PubMed</a>
      </div>
      ${archive}
    </article>`;
}

/* ---------------- practice tab ---------------- */
function recommendedPath() {
  const w = {};
  for (const d of BLUEPRINT?.domains || []) for (const sid of d.sections) w[sid] = (w[sid] || 0) + d.weight;
  return DB.sections
    .map((s) => ({ s, w: w[s.id] || 0 }))
    .sort((a, b) => b.w - a.w || b.s.count - a.s.count)
    .map((x) => x.s);
}

function renderPractice() {
  session = null;
  // one list, already in the order worth studying: heaviest blueprint weight first
  const rows = (BLUEPRINT ? recommendedPath() : DB.sections).map((sec) => {
    const s = sectionStats(sec.id);
    return `
      <a class="row" href="#/section/${sec.id}">
        ${ring(s.mastery)}
        <span class="row-body">
          <span class="row-title">${esc(sec.name)}</span>
          <span class="row-sub">${s.seen} of ${s.total} seen</span>
        </span>
        <span class="sec-ar">${esc(sec.nameAr || '')}</span>
        ${icon('chev', 'chev')}
      </a>`;
  }).join('');

  const content = `
    <div class="page-head">
      <h1>Practice by section</h1>
      <p>Sorted by weight in the official blueprint, so the top of the list earns the most marks. The ring shows your mastery.</p>
    </div>
    <div class="section-heading"><h2>${DB.sections.length} sections</h2><span>مرتبة بأوزان المخطط الرسمي</span></div>
    <div class="list">${rows}</div>`;
  app.innerHTML = chrome(content);
}

/* ---------------- section page ---------------- */
function renderSectionPage(secId) {
  const sec = DB.sections.find((s) => s.id === secId);
  if (!sec) { renderHome(); return; }
  session = null;
  const cov = sectionCoverage(secId);
  const st = sectionStats(secId);
  const wrongN = sectionQuestions(secId).filter((q) => {
    const r = store.q[q.id];
    return r && r.s > 0 && masteryOf(r) < 75;
  }).length;
  const stars = sectionQuestions(secId).filter((q) => store.starred.includes(q.id)).length;

  const checkpoints = CHECKPOINTS.map((cp) => {
    const cs = checkpointState(secId, cp, cov);
    const gatePct = Math.round(cp.gate * 100);
    if (cs.unlocked) {
      return `
        <div class="row">
          <span class="row-icon ${cs.attempts ? 'ok' : ''}">${cs.attempts ? icon('check') : cp.tier}</span>
          <span class="row-body">
            <span class="row-title">Checkpoint ${cp.tier}</span>
            <span class="row-sub">${cs.attempts ? `${cs.attempts} attempt${cs.attempts > 1 ? 's' : ''}${cs.best != null ? `, best <b>${cs.best}%</b>` : ''}` : `${Math.min(20, cov.seen)} questions, timed`}</span>
          </span>
          <button class="btn btn-primary btn-sm" onclick="startCheckpoint('${secId}', ${cp.tier})">${cs.attempts ? 'Retake' : 'Take'}</button>
        </div>`;
    }
    return `
      <div class="row disabled">
        <span class="row-icon muted">${icon('lock')}</span>
        <span class="row-body">
          <span class="row-title">Checkpoint ${cp.tier}</span>
          <span class="row-sub">Unlocks at ${gatePct}% coverage. You are at ${Math.round(cov.pct * 100)}%.</span>
        </span>
      </div>`;
  }).join('');

  const drill = (on, href, ic, title, sub) => on
    ? `<a class="row" href="${href}"><span class="row-icon">${icon(ic)}</span><span class="row-body"><span class="row-title">${title}</span><span class="row-sub">${sub}</span></span>${icon('chev', 'chev')}</a>`
    : `<div class="row disabled"><span class="row-icon muted">${icon(ic)}</span><span class="row-body"><span class="row-title">${title}</span><span class="row-sub">${sub}</span></span></div>`;

  const content = `
    <div class="sec-hero">
      ${ring(st.mastery, 'lg')}
      <div style="min-width:0">
        <h1>${esc(sec.name)}</h1>
        <div class="sec-hero-ar">${esc(sec.nameAr || '')}</div>
        <div class="card-meta">${cov.seen} of ${cov.total} questions covered (${Math.round(cov.pct * 100)}%)</div>
      </div>
    </div>
    <a class="btn btn-primary btn-lg btn-block" href="#/quiz/${sec.id}/study">${cov.seen > 0 ? 'Continue studying' : 'Start studying'}</a>
    <p class="cta-note">Each answer shows its explanation at once</p>
    <div class="section-heading"><h2>Coverage checkpoints</h2><span>اختبر ما غطّيته</span></div>
    <div class="list">${checkpoints}</div>
    <div class="section-heading"><h2>Drills</h2><span>تدريب موجّه</span></div>
    <div class="list">
      ${drill(wrongN, `#/quiz/wrong-${sec.id}/study`, 'refresh', 'Wrong answers', wrongN ? `${wrongN} waiting. Two correct in a row clears each.` : 'Nothing waiting in this section.')}
      ${drill(stars, `#/quiz/starred-${sec.id}/study`, 'bookmark', 'Bookmarks', stars ? `${stars} saved from this section` : 'Tap the bookmark while studying to save a question.')}
    </div>`;
  app.innerHTML = chrome(content, { back: '#/practice', title: 'Practice' });
}

/* ---------------- exams tab: the 13-step ladder ---------------- */
function renderExams() {
  session = null;
  const cov = uniqueCovered();
  const ratio = coverageRatio();
  const tries = (st) => st.attempts ? `${st.attempts} attempt${st.attempts > 1 ? 's' : ''}, best <b>${st.best}%</b>` : 'Not attempted yet';

  const msCards = (BLUEPRINT?.milestoneTests || []).map((m) => {
    const st = milestoneState(m);
    const body = st.unlocked
      ? `<span class="row-sub">${tries(st)}. ${m.size} questions, ${m.minutes} min.</span>`
      : `${bar((cov / m.unlockAt) * 100)}<span class="row-sub">${cov} of ${m.unlockAt} covered, <b>${st.remaining}</b> to go</span>`;
    return `
      <div class="row ${st.unlocked ? '' : 'disabled'}">
        <span class="row-icon ${st.unlocked ? '' : 'muted'}">${st.unlocked ? m.id : icon('lock')}</span>
        <span class="row-body"><span class="row-title">Milestone Test ${m.id}</span>${body}</span>
        ${st.unlocked ? `<a class="btn btn-primary btn-sm" href="#/quiz/milestone-${m.id}/mock">${st.best != null ? 'Retake' : 'Start'}</a>` : ''}
      </div>`;
  }).join('');

  const simCards = (BLUEPRINT?.simulations || []).map((s) => {
    const st = simState(s);
    const need = Math.round(s.unlockAtCoverage * 100);
    const body = st.unlocked
      ? `<span class="row-sub">${tries(st)}. ${s.size} questions, ${s.minutes} min.</span>`
      : `${bar((ratio / s.unlockAtCoverage) * 100)}<span class="row-sub">Unlocks at ${need}% coverage. You are at ${Math.round(ratio * 100)}%, <b>${st.remaining}</b> questions to go.</span>`;
    return `
      <div class="row ${st.unlocked ? '' : 'disabled'}">
        <span class="row-icon ${st.unlocked ? 'solid' : 'muted'}">${st.unlocked ? s.id : icon('lock')}</span>
        <span class="row-body"><span class="row-title">${esc(BLUEPRINT.exam.code)} Simulation ${s.id}</span>${body}</span>
        ${st.unlocked ? `<a class="btn btn-primary btn-sm" href="#/quiz/sim-${s.id}/mock">${st.best != null ? 'Retake' : 'Start'}</a>` : ''}
      </div>`;
  }).join('');

  const hist = store.history.filter((h) => h.mode === 'mock' || h.mode === 'exam').slice(0, 20);
  const histHtml = hist.length
    ? `<div class="hist-list">${histRows(hist, (h) => h.kind === 'simulation' ? 'OEEM' : h.kind === 'milestone' ? 'Milestone' : h.kind === 'checkpoint' ? 'Checkpoint' : 'Test')}</div>`
    : `<div class="card"><div class="card-meta">Your exam attempts will collect here.</div></div>`;

  const content = `
    <div class="page-head">
      <h1>Exam ladder</h1>
      <p>Milestone tests open as your coverage grows. The OEEM simulations are one fixed paper, the same for every doctor.</p>
    </div>
    <div class="section-heading"><h2>Milestone tests</h2><span>75% مما درسته + 25% جديد</span></div>
    <div class="list">${msCards}</div>
    <div class="section-heading"><h2>OEEM simulations</h2><span>ورقة ثابتة للجميع، تفتح بالتغطية</span></div>
    <div class="list">${simCards}</div>
    <div class="section-heading"><h2>Attempt history</h2><span>سجل المحاولات</span></div>
    ${histHtml}`;
  app.innerHTML = chrome(content);
}

/* ---------------- quiz ---------------- */
function startTimer() {
  session.timerId = setInterval(() => {
    session.timeLeft -= 1;
    const t = $('#timer');
    if (t) {
      t.textContent = fmtTime(session.timeLeft);
      t.classList.toggle('danger', session.timeLeft <= (session.mode === 'mock' ? 300 : 60));
    }
    if (session.mode === 'mock') updatePaceUI();
    if (session.timeLeft <= 0) finishExam(true);
  }, 1000);
}
function stopTimer() {
  if (session?.timerId) { clearInterval(session.timerId); session.timerId = null; }
}
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.max(s, 0) % 60).padStart(2, '0')}`;

// leave a session for Home. It stays resumable from there.
function exitQuiz() {
  stopTimer();
  session = null;
  if ((location.hash || '#/') === '#/') route();
  else location.hash = '#/';
}

// how close the gate is: always during the free trial, only near the end of a paid part
function trialPill() {
  if (hasFullAccess()) return '';
  const left = trialLeft();
  const own = partsOwned();
  if (own && left > 20) return '';
  const text = left ? `بقي ${left} سؤالاً ${own ? 'في هذا الجزء' : 'مجانياً'}` : own ? 'آخر سؤال في هذا الجزء' : 'آخر سؤال مجاني';
  return `<span class="trial-pill">${text}</span>`;
}

function renderQuiz() {
  const isExam = session.mode === 'exam';
  const isCram = session.mode === 'cram';
  const isMock = session.mode === 'mock';
  const q = session.questions[session.idx];
  const picked = session.picked[session.idx];
  const revealed = session.submitted[session.idx];
  const isLast = session.idx === session.questions.length - 1;
  const starred = store.starred.includes(q.id);
  const total = session.questions.length;

  const options = q.options.map((opt, i) => {
    let cls = 'option';
    if (isCram) {
      if (revealed && i === q.answer) cls += ' correct';
    } else if (revealed && q.selfScored) {
      const g = session.selfGrades[session.idx];
      if (g == null) { if (i === picked) cls += ' selected'; }
      else if (i === picked) cls += g ? ' correct' : ' wrong';
    } else if (revealed) {
      if (i === q.answer) cls += ' correct';
      else if (i === picked) cls += ' wrong';
    } else if (i === picked) cls += ' selected';
    return `
      <button class="${cls}" data-i="${i}" ${revealed || isCram ? 'disabled' : ''}>
        <span class="option-key">${LETTERS[i]}</span><span>${esc(opt)}</span>
      </button>`;
  }).join('');

  const ref = q.reference ? `<div class="feedback-ref">${esc(q.reference)}</div>` : '';
  const gBtn = googleBtn(q);
  let feedback = '';
  if (revealed && isCram) {
    feedback = `
      <div class="feedback correct">
        <div class="feedback-head">Answer: ${LETTERS[q.answer]}</div>
        <div class="feedback-body">${esc(q.explanation || '')}</div>
        ${ref}
        ${gBtn}
      </div>`;
  } else if (revealed && q.selfScored && session.selfGrades[session.idx] == null) {
    feedback = `
      <div class="feedback">
        <div class="feedback-body">${esc(q.explanation || '')}</div>
        ${ref}
        ${gBtn}
        <div class="self-grade">
          <span class="self-grade-q">After reading the explanation, how did you do? <span dir="rtl">كيف كانت إجابتك؟</span></span>
          <div class="self-grade-btns">
            <button class="btn" onclick="gradeSelf(true)">${icon('check')} I got it</button>
            <button class="btn btn-danger-soft" onclick="gradeSelf(false)">${icon('close')} I missed it</button>
          </div>
        </div>
      </div>`;
  } else if (revealed && q.selfScored) {
    const ok = session.selfGrades[session.idx];
    feedback = `
      <div class="feedback ${ok ? 'correct' : 'wrong'}">
        <div class="feedback-head">${icon(ok ? 'check' : 'close')}${ok ? 'Self-graded: correct' : 'Self-graded: missed'}</div>
        <div class="feedback-body">${esc(q.explanation || '')}</div>
        ${ref}
        ${gBtn}
      </div>`;
  } else if (revealed) {
    const ok = picked === q.answer;
    feedback = `
      <div class="feedback ${ok ? 'correct' : 'wrong'}">
        <div class="feedback-head">${icon(ok ? 'check' : 'close')}${ok ? 'Correct' : `Incorrect. The answer is ${LETTERS[q.answer]}`}</div>
        <div class="feedback-body">${esc(q.explanation || '')}</div>
        ${ref}
        ${gBtn}
      </div>`;
  }

  const timer = (isExam || isMock)
    ? `<span class="quiz-timer ${session.timeLeft <= (isMock ? 300 : 60) ? 'danger' : ''}" id="timer">${fmtTime(session.timeLeft)}</span>`
    : '';
  const modeLabel = isCram ? 'Cram flashcards' : session.title;

  let paceBar = '';
  if (isMock) {
    const s = paceState();
    const answeredN = session.picked.filter((p) => p !== null).length;
    paceBar = `
      <div class="pace-wrap">
        <div class="pace-bar">
          <div class="pace-fill" id="paceTime" style="width:${s.t}%"></div>
          <div class="pace-marker" id="paceMarker" style="left:${s.a}%"></div>
        </div>
        <div class="pace-meta">
          <span class="pace-status ${s.cls}" id="paceStatus">${s.label}</span>
          <span>${answeredN} of ${total} answered</span>
        </div>
      </div>`;
  }

  let gridOverlay = '';
  if (isMock) {
    const answeredN = session.picked.filter((p) => p !== null).length;
    gridOverlay = `
      <div class="sheet-backdrop" id="gridOverlay" hidden>
        <div class="sheet grid-panel" role="dialog" aria-modal="true">
          <div class="grid-panel-head">
            <span>Question navigator</span>
            <button class="icon-btn" id="gridClose" aria-label="Close">${icon('close')}</button>
          </div>
          <div class="qgrid">
            ${session.questions.map((qq, i) => {
              const cls = ['qcell'];
              if (session.picked[i] !== null) cls.push('done');
              if (session.flagged.has(i)) cls.push('mark');
              if (i === session.idx) cls.push('cur');
              return `<button class="${cls.join(' ')}" data-i="${i}">${i + 1}</button>`;
            }).join('')}
          </div>
          <div class="grid-panel-foot">
            <span class="card-meta">${answeredN} answered, ${total - answeredN} unanswered</span>
            <button class="btn btn-primary btn-lg btn-block" id="gridSubmit">Submit exam</button>
          </div>
        </div>
      </div>`;
  }

  // one primary action, always under the thumb
  const key = '<kbd>↵</kbd>';
  const primary = isCram
    ? (revealed
        ? `<button class="btn btn-primary" id="nextBtn">${isLast ? 'Done' : 'Next card'} ${key}</button>`
        : `<button class="btn btn-primary" id="cramBtn">Show answer ${key}</button>`)
    : isMock
      ? (isLast
          ? `<button class="btn btn-primary" id="footerGridBtn">Review and submit</button>`
          : `<button class="btn btn-primary" id="nextBtn" ${picked === null ? 'disabled' : ''}>Next question</button>`)
      : isExam
        ? (isLast
            ? `<button class="btn btn-primary" id="nextBtn">Finish test</button>`
            : `<button class="btn btn-primary" id="nextBtn" ${picked === null ? 'disabled' : ''}>Next question</button>`)
        : (revealed
            ? (q.selfScored && session.selfGrades[session.idx] == null
                ? `<button class="btn btn-primary" disabled>Grade yourself to continue</button>`
                : `<button class="btn btn-primary" id="nextBtn">${isLast ? 'See results' : 'Next question'} ${key}</button>`)
            : `<button class="btn btn-primary" disabled>Choose an answer</button>`);

  app.innerHTML = `
    ${appBar({
      right: `${timer}
        ${isMock ? `<button class="icon-btn" id="headerGridBtn" aria-label="Question navigator">${icon('grid')}</button>` : ''}
        <button class="icon-btn ${starred ? 'on' : ''}" id="flagBtn" aria-label="${starred ? 'Remove bookmark' : 'Bookmark this question'}" aria-pressed="${starred}">${icon('bookmark', starred ? 'fill' : '')}</button>`,
      below: `<div class="progress-track"><div class="progress-fill" style="width:${((session.idx + (revealed || picked !== null ? 1 : 0)) / total) * 100}%"></div></div>`,
      lead: `<div class="bar-lead">
        <button class="icon-btn" onclick="exitQuiz()" aria-label="Exit">${icon('close')}</button>
        <div class="quiz-pos"><b>${session.idx + 1}</b> / ${total}<span class="quiz-mode">${esc(modeLabel)}</span></div>
      </div>`,
    })}
    <main class="wrap quiz-wrap">
      ${trialPill()}
      ${paceBar}
      <div class="q-card">
        ${q.vignette ? `<div class="q-vignette">${esc(q.vignette)}</div>` : ''}
        <div class="q-text">${esc(q.question)}</div>
        <div class="options">${options}</div>
        ${feedback}
      </div>
      ${!isExam && !isCram && !isMock && !revealed ? `<div class="hint keys">Keys <kbd>A</kbd>–<kbd>${LETTERS[q.options.length - 1]}</kbd> answer, <kbd>F</kbd> bookmarks.</div>` : ''}
      ${isCram && !revealed ? `<div class="hint">Flashcards do not change your score. Think first, then reveal.</div>` : ''}
      ${isExam ? `<div class="hint">${EXAM_SEC_PER_Q} seconds per question. Skipped questions count as wrong.</div>` : ''}
    </main>
    <div class="actionbar"><div class="actionbar-inner">
      ${session.idx > 0 ? `<button class="btn btn-prev" id="prevBtn" aria-label="Previous question">${icon('back')}</button>` : ''}
      ${primary}
    </div></div>
    ${gridOverlay}`;

  $$('.option:not(:disabled)').forEach((el) =>
    el.addEventListener('click', () => pick(+el.dataset.i)));
  $('#flagBtn')?.addEventListener('click', toggleFlag);
  $('#prevBtn')?.addEventListener('click', () => { session.idx -= 1; persistSession(); renderQuiz(); window.scrollTo(0, 0); });
  $('#cramBtn')?.addEventListener('click', revealCram);
  $('#nextBtn')?.addEventListener('click', next);
  if (isMock) {
    $('#headerGridBtn')?.addEventListener('click', openGrid);
    $('#footerGridBtn')?.addEventListener('click', openGrid);
    $('#gridClose')?.addEventListener('click', closeGrid);
    $('#gridOverlay')?.addEventListener('click', (e) => { if (e.target.id === 'gridOverlay') closeGrid(); });
    $('#gridSubmit')?.addEventListener('click', submitFromGrid);
    $$('#gridOverlay .qcell').forEach((el) => el.addEventListener('click', () => {
      session.idx = +el.dataset.i;
      closeGrid();
      renderQuiz();
      window.scrollTo(0, 0);
    }));
  }
}

// bring the explanation into view above the action bar once an answer is revealed
function showFeedback() {
  const f = $('.feedback');
  if (!f) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  f.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'nearest' });
}

function pick(i) {
  const mode = session.mode;
  if (mode === 'cram') return;
  if (session.submitted[session.idx]) return;
  if (mode === 'study') {
    session.picked[session.idx] = i;
    session.submitted[session.idx] = true;
    const q = session.questions[session.idx];
    if (!q.selfScored) recordAttempt(q.id, i === q.answer);
    persistSession();
    renderQuiz();
    showFeedback();
    return;
  }
  session.picked[session.idx] = session.picked[session.idx] === i ? null : i;
  persistSession();
  renderQuiz();
}

function gradeSelf(ok) {
  const q = session.questions[session.idx];
  session.selfGrades[session.idx] = ok;
  recordAttempt(q.id, ok);
  persistSession();
  renderQuiz();
}

function revealCram() {
  session.submitted[session.idx] = true;
  renderQuiz();
  showFeedback();
}

function next() {
  if (session.idx < session.questions.length - 1) {
    if (session.mode === 'study' && trialBlocked()) return;   // last free question answered
    session.idx += 1;
    persistSession();
    renderQuiz();
    window.scrollTo(0, 0);
  } else if (session.mode === 'cram') {
    session = null;
    renderHome();
  } else {
    finishExam(false);
  }
}

function toggleFlag() {
  const qid = session.questions[session.idx].id;
  if (store.starred.includes(qid)) store.starred = store.starred.filter((x) => x !== qid);
  else store.starred.push(qid);
  saveStore();
  persistSession();
  renderQuiz();
}

function finishExam(auto) {
  stopTimer();
  session.finished = true;
  const pct = session.questions.length ? Math.round((correct0(session) / session.questions.length) * 100) : 0;
  if (session.mode === 'mock' && session.mockKind === 'milestone') {
    store.milestoneBest = store.milestoneBest || {};
    store.milestoneBest[session.milestoneId] = Math.max(store.milestoneBest[session.milestoneId] ?? -1, pct);
    store.milestoneAttempts = store.milestoneAttempts || {};
    store.milestoneAttempts[session.milestoneId] = (store.milestoneAttempts[session.milestoneId] || 0) + 1;
  }
  if (session.mode === 'mock' && session.mockKind === 'simulation') {
    store.simBest = store.simBest || {};
    store.simBest[session.simId] = Math.max(store.simBest[session.simId] ?? -1, pct);
    store.simAttempts = store.simAttempts || {};
    store.simAttempts[session.simId] = (store.simAttempts[session.simId] || 0) + 1;
  }
  saveStore();
  // study answers were recorded one by one as they were given
  if (session.mode !== 'study') {
    session.questions.forEach((q, i) => {
      if (session.picked[i] !== null) recordAttempt(q.id, session.picked[i] === q.answer);
    });
  }
  const correct = correct0(session);
  const entry = {
    ts: Date.now(),
    title: session.title,
    mode: session.mode,
    kind: session.mode === 'mock' ? session.mockKind : session.mode,
    milestoneId: session.milestoneId,
    simId: session.simId,
    correct,
    total: session.questions.length,
  };
  if (session.checkpoint) {
    entry.kind = 'checkpoint';
    entry.sectionId = session.checkpoint.sectionId;
    entry.tier = session.checkpoint.tier;
    entry.pct = pct;
  }
  pushHistory(entry);
  clearActive();
  if (window.Sync) Sync.logSession(entry);
  renderResults({ correct, total: session.questions.length, auto });
}
// answerless questions are right when the doctor graded themselves right
function isCorrect(sess, i) {
  const q = sess.questions[i];
  return q.selfScored ? sess.selfGrades[i] === true : sess.picked[i] === q.answer;
}
function correct0(sess) {
  return sess.questions.reduce((n, q, i) => n + (isCorrect(sess, i) ? 1 : 0), 0);
}

/* ---------------- results ---------------- */
function renderResults({ correct, total, auto }) {
  const pct = total ? Math.round((correct / total) * 100) : 0;
  const color = pct >= 70 ? 'var(--correct)' : pct >= 50 ? 'var(--flag)' : 'var(--wrong)';
  const isMock = session.mode === 'mock';
  const msg = isMock
    ? (pct >= 70
        ? 'Strong simulation — you are tracking above the typical pass band. Keep your streaks alive.'
        : pct >= 50
          ? 'Pass-zone performance. The domain table below shows exactly where to invest next.'
          : 'Below the pass band — but every wrong answer is now queued in your review pile. Fix them; the next simulation unlocks after 100 more answered questions.')
    : pct >= 85 ? 'Excellent — you are exam-ready on this set. Keep streaks going.'
    : pct >= 70 ? 'Solid work. Review what you missed and you will be there.'
    : pct >= 50 ? 'Good base — focus on the wrong answers below, then retest.'
    : 'This topic needs work. Read every explanation carefully, then practice again.';

  let splitTable = '';
  if (isMock && session.mockKind === 'milestone') {
    const g = { c: { t: 0, ok: 0 }, f: { t: 0, ok: 0 } };
    session.questions.forEach((q, i) => {
      const k = q.fromCovered ? 'c' : 'f';
      g[k].t += 1;
      if (session.picked[i] === q.answer) g[k].ok += 1;
    });
    const row = (label, v, note) => v.t
      ? `<div class="domain-row">
          <span class="domain-name">${esc(label)} <span class="domain-weak" style="background:var(--surface-2);color:var(--text-2)">${esc(note)}</span></span>
          <span class="domain-score ${Math.round((v.ok / v.t) * 100) >= 70 ? 'ok' : Math.round((v.ok / v.t) * 100) >= 50 ? 'mid' : 'low'}">${Math.round((v.ok / v.t) * 100)}%</span>
          <span class="domain-meta">${v.ok}/${v.t}</span>
        </div>`
      : '';
    splitTable = `
      <div class="section-heading"><h2>Studied vs Fresh</h2><span>من مادة درستها مقابل مادة جديدة</span></div>
      <div class="domain-table">
        ${row('From your studied material', g.c, 'قياس فعلي لتعلّمك')}
        ${row('Fresh — first encounter', g.f, 'تشويق لما ينتظرك')}
      </div>`;
  }

  let domainTable = '';
  if (isMock) {
    const by = {};
    session.questions.forEach((q, i) => {
      const d = q.mockDomain || 'General';
      by[d] = by[d] || { total: 0, correct: 0 };
      by[d].total += 1;
      if (session.picked[i] === q.answer) by[d].correct += 1;
    });
    const rows = Object.entries(by)
      .map(([d, v]) => ({ d, v, pct: Math.round((v.correct / v.total) * 100) }))
      .sort((x, y) => x.pct - y.pct)
      .map(({ d, v, pct: p }) => `
        <div class="domain-row">
          <span class="domain-name">${esc(d)}${p < 50 ? ' <span class="domain-weak">focus here</span>' : ''}</span>
          <span class="domain-score ${p >= 70 ? 'ok' : p >= 50 ? 'mid' : 'low'}">${p}%</span>
          <span class="domain-meta">${v.correct}/${v.total}</span>
        </div>`).join('');
    domainTable = `
      <div class="section-heading"><h2>Blueprint Domain Breakdown</h2><span>أداؤك حسب مجالات الاختبار الرسمي</span></div>
      <div class="domain-table">${rows}</div>`;
  }

  const rows = session.questions.map((q, i) => {
    const ok = isCorrect(session, i);
    const skipped = session.picked[i] === null;
    const sec = DB.sections.find((s) => s.id === q.sectionId);
    const m = !ok && masteryOf(store.q[q.id]) === 0 ? 'Needs review' : MASTERY_LABEL(masteryOf(store.q[q.id]));
    return `
      <div class="review-row" data-i="${i}" role="button" tabindex="0" aria-expanded="false">
        <div class="review-status ${ok ? 'ok' : 'no'}">${icon(ok ? 'check' : 'close')}</div>
        <div class="review-main">
          <div class="review-text">${esc(q.question)}</div>
          <div class="review-num">${esc(sec?.name || '')}${skipped ? ', skipped' : ''} · ${m}</div>
        </div>
        ${icon('chev', 'chev')}
      </div>
      <div class="review-detail" id="detail-${i}" hidden>${reviewDetail(q, i)}</div>`;
  }).join('');

  const backHref = !isMock && session.checkpoint ? `#/section/${session.checkpoint.sectionId}` : '#/';
  const backName = !isMock && session.checkpoint ? (DB.sections.find((s) => s.id === session.checkpoint.sectionId)?.name || 'section') : 'Home';
  app.innerHTML = `
    ${appBar({ back: backHref, title: 'Results', right: '' })}
    <main class="wrap">
      <div class="result-hero">
        <div class="score-ring" style="--pct:${pct};--score-color:${color}">
          <div class="score-ring-inner">
            <div class="score-num" style="color:${color}">${pct}%</div>
            <div class="score-label">${correct} of ${total} correct</div>
          </div>
        </div>
        <div class="result-msg">${auto ? 'Time is up, so the exam was submitted automatically. ' : ''}${esc(msg)}</div>
        <div class="result-actions">
          ${isMock ? '' : `<button class="btn btn-primary btn-lg" onclick="retakeSame()">${icon('refresh')} Retake this set</button>`}
          <a class="btn btn-lg" href="${backHref}">Back to ${esc(backName)}</a>
        </div>
      </div>
      ${Install.cardHtml()}
      ${splitTable}
      ${domainTable}
      <div class="section-heading"><h2>Review answers</h2><span>Tap a question for its explanation</span></div>
      <div class="review-list">${rows}</div>
    </main>`;

  const toggle = (el) => {
    const d = $(`#detail-${el.dataset.i}`);
    d.hidden = !d.hidden;
    el.setAttribute('aria-expanded', String(!d.hidden));
    if (!d.hidden) d.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  $$('.review-row').forEach((el) => {
    el.addEventListener('click', () => toggle(el));
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(el); } });
  });
}

function reviewDetail(q, i) {
  const picked = session.picked[i];
  const ok = isCorrect(session, i);
  const verdict = q.selfScored
    ? (ok ? 'You graded this one correct' : 'You graded this one missed')
    : ok ? 'You answered correctly' : `${picked === null ? 'Skipped' : `You picked ${LETTERS[picked]}`}. The answer is ${LETTERS[q.answer]}`;
  const options = q.options.map((opt, j) => {
    let cls = 'option';
    if (q.selfScored) { if (j === picked) cls += ok ? ' correct' : ' wrong'; }
    else if (j === q.answer) cls += ' correct';
    else if (j === picked) cls += ' wrong';
    return `
      <div class="${cls}" style="cursor:default">
        <span class="option-key">${LETTERS[j]}</span><span>${esc(opt)}</span>
      </div>`;
  }).join('');
  return `
    <div class="q-card">
      ${q.vignette ? `<div class="q-vignette">${esc(q.vignette)}</div>` : ''}
      <div class="q-text">${esc(q.question)}</div>
      <div class="options">${options}</div>
      <div class="feedback ${ok ? 'correct' : 'wrong'}" style="margin-top:14px">
        <div class="feedback-head">${icon(ok ? 'check' : 'close')}${verdict}</div>
        <div class="feedback-body">${esc(q.explanation || '')}</div>
        ${q.reference ? `<div class="feedback-ref">${esc(q.reference)}</div>` : ''}
        ${googleBtn(q)}
      </div>
    </div>`;
}

/* ---------------- retake / empty ---------------- */
function retakeSame() {
  if (!session) return;
  stopTimer();
  if (session.mode === 'mock') {
    if (session.mockKind === 'milestone' && session.milestoneId != null) { startMilestone(session.milestoneId); return; }
    if (session.mockKind === 'simulation' && session.simId != null) { startSimulation(session.simId); return; }
  }
  if (session.checkpoint) { startCheckpoint(session.checkpoint.sectionId, session.checkpoint.tier); return; }
  const { sectionId, mode } = session;
  if (trialBlocked()) return;
  session = buildSession(sectionId, mode);
  if (session.questions.length === 0) { renderEmpty(session); return; }
  if (session.mode === 'exam') startTimer();
  persistSession();
  renderQuiz();
  window.scrollTo(0, 0);
}

function renderEmpty(sess) {
  const msg = sess.mode === 'cram'
    ? 'Answer some questions first. Your weakest ones collect here as flashcards.'
    : sess.sectionId === 'wrong'
      ? 'No questions are waiting for review. Study a section to add more.'
      : sess.sectionId.startsWith('wrong-') || sess.sectionId.startsWith('starred-')
        ? 'This drill has no questions yet.'
        : 'This set has no questions.';
  app.innerHTML = `
    ${appBar({ back: '#/', title: sess.title || 'Practice', right: '' })}
    <main class="wrap"><div class="empty">
      <div class="row-icon ok">${icon('check')}</div>
      <h2>Nothing to practice here</h2>
      <p>${esc(msg)}</p>
      <a class="btn btn-primary btn-lg" href="#/practice">Choose a section</a>
    </div></main>`;
}

/* ---------------- keyboard ---------------- */
document.addEventListener('keydown', (e) => {
  if (!session || session.finished) return;
  if (e.target.matches('input, textarea')) return;
  const q = session.questions[session.idx];
  if (!q) return;
  const k = e.key.toUpperCase();
  const isCram = session.mode === 'cram';
  if (e.key === 'Enter') {
    if (isCram) {
      session.submitted[session.idx] ? next() : revealCram();
    } else if (session.mode === 'exam' || session.mode === 'mock') {
      const btn = $('#nextBtn');
      if (btn && !btn.disabled) next();
    } else if (session.submitted[session.idx]) {
      const cur = session.questions[session.idx];
      if (!(cur.selfScored && session.selfGrades[session.idx] == null)) next();
    }
    return;
  }
  if (k === 'G' && session.mode === 'mock') { openGrid(); return; }
  if (k === 'F') { toggleFlag(); return; }
  if (isCram) return;
  const numIdx = '123456'.indexOf(e.key) !== -1 ? +e.key - 1 : LETTERS.indexOf(k);
  if (numIdx > -1 && numIdx < q.options.length) pick(numIdx);
});

/* ---------------- touch: swipe left = next, right = previous ---------------- */
let touchX = 0, touchY = 0;
document.addEventListener('touchstart', (e) => {
  touchX = e.changedTouches[0].clientX;
  touchY = e.changedTouches[0].clientY;
}, { passive: true });
document.addEventListener('touchend', (e) => {
  if (!session || session.finished) return;
  const dx = e.changedTouches[0].clientX - touchX;
  const dy = e.changedTouches[0].clientY - touchY;
  if (Math.abs(dx) < 80 || Math.abs(dx) < Math.abs(dy) * 2) return;
  const revealed = session.submitted[session.idx];
  const nextBtn = $('#nextBtn');
  if (dx < 0) {
    if (session.mode === 'cram') revealed ? next() : revealCram();
    else if (session.mode === 'study' ? revealed : (nextBtn && !nextBtn.disabled)) next();
  } else if (session.idx > 0) {
    session.idx -= 1;
    persistSession();
    renderQuiz();
  }
}, { passive: true });

/* ---------------- sync engine (server = source of truth, local cache) ---------------- */
function progressRow(qid, rec) {
  if (!rec || !SB.session) return null;
  const q = DB.byId[qid];
  return {
    user_id: SB.session.user.id,
    question_id: qid,
    section_id: q ? q.sectionId : null,
    streak: rec.streak || 0,
    attempts: rec.s || 0,
    correct: rec.c || 0,
    last_seen: new Date(rec.lastSeen || Date.now()).toISOString(),
  };
}

const Sync = {
  queue: [],
  start(merged = false) {
    if (!SB.configured || !SB.session) return;
    if (!merged) this.merge().catch(() => {});
    SB.heartbeat().catch(() => {});
    setInterval(() => this.flush(), 30000);
    this.flush();
  },
  async merge() {
    const remote = await SB.fetchProgress();
    const rMap = new Map(remote.map((r) => [r.question_id, r]));
    // server -> local where server is newer
    for (const [qid, r] of rMap) {
      const l = store.q[qid];
      const rTs = new Date(r.last_seen).getTime();
      if (!l || (l.lastSeen || 0) < rTs) {
        store.q[qid] = { s: r.attempts || 0, c: r.correct || 0, streak: r.streak || 0, lastSeen: rTs, lastCorrect: (r.streak || 0) > 0 };
      }
    }
    // local -> server where local is newer or missing remotely
    const up = [];
    for (const [qid, l] of Object.entries(store.q)) {
      const r = rMap.get(qid);
      if (!r || (l.lastSeen || 0) > new Date(r.last_seen).getTime()) {
        const row = progressRow(qid, l);
        if (row) up.push(row);
      }
    }
    if (up.length) await SB.upsertProgress(up);
    saveStore();
    SB.event('login_sync', { uploaded: up.length, remote: remote.length }).catch(() => {});
  },
  queueQuestion(qid) { if (SB.configured && SB.session) this.queue.push(qid); },
  async flush() {
    if (!SB.configured || !SB.session || !this.queue.length) return;
    const ids = [...new Set(this.queue)];
    this.queue = [];
    const rows = ids.map((qid) => progressRow(qid, store.q[qid])).filter(Boolean);
    try {
      if (rows.length) await SB.upsertProgress(rows);
    } catch (e) {
      this.queue.push(...ids);   // retry on next flush
    }
  },
  logSession(entry) {
    if (!SB.configured || !SB.session) return;
    const refId = entry.milestoneId ? 'milestone-' + entry.milestoneId
      : entry.simId ? 'sim-' + entry.simId
      : entry.sectionId || null;
    SB.logSession({ kind: entry.kind || entry.mode, refId, title: entry.title, score: entry.correct, total: entry.total }).catch(() => {});
    SB.event('session_complete', { kind: entry.kind || entry.mode, score: entry.correct, total: entry.total }).catch(() => {});
  },
};
window.Sync = Sync;   // callers above test window.Sync; a top-level const is not a window property

/* ---------------- auth screens ---------------- */
const KNOWN_KEY = 'oman-em-prep.known';   // this browser already has an account: open on login, not signup
const REF_KEY = 'oman-em-prep.ref';       // referral code from an invite link, kept until the visitor signs up

// an invite link looks like  ...?ref=AB12CD  — remember the code and clean the URL
function captureRef() {
  try {
    const params = new URLSearchParams(location.search || '');
    let code = params.get('ref');
    if (!code && location.hash.includes('ref=')) {           // ...#/?ref=AB12CD fallback
      code = new URLSearchParams(location.hash.split('?')[1] || '').get('ref');
    }
    code = (code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
    if (code) {
      localStorage.setItem(REF_KEY, code);
      if (params.has('ref')) {                               // tidy the address bar, keep the route
        params.delete('ref');
        const qs = params.toString();
        history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
      }
    }
  } catch (e) { /* private mode / bad URL: invites just won't track */ }
}
const pendingRef = () => { try { return localStorage.getItem(REF_KEY) || ''; } catch (e) { return ''; } };
const clearRef = () => { try { localStorage.removeItem(REF_KEY); } catch (e) { /* ignore */ } };

function cardShell(inner) {
  app.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-hero">
        <div class="brand-logo">${LOGO}</div>
        <div class="auth-app">Oman EM Prep</div>
        <div class="auth-tag" dir="rtl">استعد لاختبار طب الطوارئ العُماني</div>
      </div>
      <div class="auth-card" dir="rtl">${inner}</div>
    </div>`;
  // these screens open on the brand panel: carry its colour into the status bar
  $('meta[name="theme-color"]')?.setAttribute('content', document.documentElement.dataset.theme === 'dark' ? '#113039' : '#0c2a34');
  window.scrollTo(0, 0);
}

// onboarding (default for a new visitor) + login
function renderAuth(mode = null, msg = null) {
  session = null;
  mode = mode || (localStorage.getItem(KNOWN_KEY) ? 'login' : 'signup');
  const login = mode === 'login';
  const invited = !login && !!pendingRef();   // arrived through a colleague's invite link
  const perk = (text) => `<li>${icon('check')}<span>${text}</span></li>`;
  cardShell(`
    <h1>${login ? 'تسجيل الدخول' : `جرّب ${TRIAL_LIMIT} سؤالاً مجاناً`}</h1>
    <p class="auth-sub">${login ? 'مرحباً بعودتك، تقدّمك بانتظارك' : 'بلا بطاقة ولا رمز تفعيل'}</p>
    ${invited ? `<div class="auth-ok">🎁 وصلتَ بدعوة من زميل — أهلاً بك</div>` : ''}
    ${login ? '' : `
      <ul class="perks">
        ${perk('أكثر من 5,000 سؤال لاختبار الطوارئ مع شرح كل إجابة')}
        ${perk('18 قسماً واختبارات محاكاة بالتوقيت الحقيقي')}
        ${perk('تقدّمك محفوظ ويتبعك على كل أجهزتك')}
      </ul>`}
    ${msg ? `<div class="auth-ok">${esc(msg)}</div>` : ''}
    <div class="auth-err" id="au-err" hidden></div>
    ${login ? '' : `
      <label class="auth-label">الاسم
        <input id="au-name" type="text" autocomplete="name" placeholder="د. ...">
      </label>`}
    <label class="auth-label">البريد الإلكتروني
      <input id="au-email" type="email" dir="ltr" autocomplete="email" placeholder="doctor@example.com">
    </label>
    ${login ? '' : `
      <label class="auth-label">رقم الواتساب
        <input id="au-phone" type="tel" dir="ltr" autocomplete="tel" placeholder="+968 9xxx xxxx">
      </label>`}
    <label class="auth-label">كلمة المرور
      <input id="au-pass" type="password" dir="ltr" autocomplete="${login ? 'current' : 'new'}-password" placeholder="6+ أحرف">
    </label>
    <button class="btn btn-primary btn-lg btn-block" id="au-go">${login ? 'دخول' : 'ابدأ التجربة المجانية'}</button>
    <button class="btn btn-ghost btn-block" id="au-switch">${login ? 'جديد هنا؟ ابدأ تجربتك المجانية' : 'لديك حساب؟ تسجيل الدخول'}</button>
    <button class="btn btn-ghost btn-block" id="authInstall" onclick="Install.open()" ${Install.available() ? '' : 'hidden'}>${icon('download')} ثبّت التطبيق على ${Install.device}</button>
  `);
  const btn = $('#au-go');
  const fail = (text) => {   // inline, so the doctor never retypes the form
    const box = $('#au-err');
    box.textContent = text; box.hidden = false;
    btn.disabled = false;
    btn.textContent = login ? 'دخول' : 'ابدأ التجربة المجانية';
  };
  $('#au-switch').addEventListener('click', () => renderAuth(login ? 'signup' : 'login'));
  $$('.auth-card input').forEach((el) => el.addEventListener('keydown', (e) => { if (e.key === 'Enter') btn.click(); }));
  btn.addEventListener('click', async () => {
    const email = $('#au-email').value.trim();
    const pass = $('#au-pass').value;
    if (!email || !pass) return fail('أدخل البريد وكلمة المرور');
    btn.disabled = true;
    btn.textContent = login ? 'جاري الدخول…' : 'جاري إنشاء حسابك…';
    try {
      if (login) {
        await SB.login(email, pass);
      } else {
        const name = $('#au-name').value.trim();
        const phone = $('#au-phone').value.trim();
        if (!name) return fail('أدخل اسمك');
        if (phone.replace(/\D/g, '').length < 8) return fail('أدخل رقم واتساب صحيحاً');
        if (pass.length < 6) return fail('كلمة المرور قصيرة — 6 أحرف على الأقل');
        const r = await SB.signup(email, pass, name, phone, pendingRef());
        clearRef();   // the invite is consumed; the inviter's reward is granted server-side
        localStorage.setItem(KNOWN_KEY, '1');
        if (r.needsConfirm) { renderAuth('login', 'أرسلنا رابط تأكيد إلى بريدك — افتحه ثم سجّل الدخول هنا'); return; }
        localStorage.removeItem(STORE_KEY);   // a new account starts from zero
      }
      localStorage.setItem(KNOWN_KEY, '1');
      history.replaceState(null, '', location.pathname);   // land on Home (no hashchange before the reload)
      location.reload();
    } catch (e) {
      fail(humanAuthError(e.message));
    }
  });
}

/* ---------------- payment screen: bank details -> receipt -> review ---------------- */
const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;
let payPoll = null;
let payPlan = 'full';              // what the receipt being uploaded pays for: 'full' or 'part'

// phone photos are 3-8 MB; a 1600px JPEG uploads instantly and stays readable
async function compressImage(file) {
  if (!file.type.startsWith('image/')) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.82));
    return blob && blob.size < file.size ? blob : file;
  } catch (e) { return file; }   // format the browser cannot decode: send as-is
}

function payRow(label, value, copy) {
  if (!value) return '';
  return `
    <div class="pay-row">
      <span class="pay-k">${label}</span>
      <span class="pay-v" dir="auto">${esc(value)}</span>
      ${copy ? `<button class="btn pay-copy" data-copy="${esc(value)}">نسخ</button>` : ''}
    </div>`;
}

function renderActivated() {
  clearInterval(payPoll);
  const own = hasFullAccess() ? 0 : partsOwned();   // a part was opened, not the whole bank
  cardShell(`
    <div class="pay-state">${icon('check')}</div>
    <h1>${own ? `تم فتح الجزء ${own} من ${PARTS}` : 'تم تفعيل حسابك'}</h1>
    <p class="auth-sub">${own
      ? `بين يديك الآن ${trialLeft().toLocaleString('en')} سؤالاً من أي قسم تختاره. بالتوفيق.`
      : 'وصول كامل ودائم لكل الأسئلة والاختبارات. بالتوفيق.'}</p>
    <button class="btn btn-primary btn-lg btn-block" id="act-go">ابدأ الآن</button>`);
  $('#act-go').addEventListener('click', () => { location.hash = '#/'; route(); });
}

function renderPaywall(err = null) {
  clearInterval(payPoll);
  const p = SB.profile;
  const left = trialLeft();
  const own = partsOwned();
  const wa = String(PAY.whatsapp || '').replace(/\D/g, '');
  const waLink = (text) => `https://wa.me/${wa}?text=${encodeURIComponent(text)}`;
  const foot = `
    ${left > 0 ? `<a class="btn btn-ghost btn-block" href="#/">${own ? 'متابعة الدراسة' : 'متابعة التجربة'}، بقي ${left.toLocaleString('en')} سؤالاً</a>` : ''}
    <button class="btn btn-ghost btn-block" onclick="logout()">تسجيل الخروج</button>`;

  if (p.access_status === 'pending') {
    cardShell(`
      <div class="pay-state">${icon('check')}</div>
      <h1>استلمنا إيصالك</h1>
      <p class="auth-sub">نراجعه في أقرب وقت، وسيُفتح حسابك هنا تلقائياً. لا حاجة لأي خطوة أخرى.</p>
      ${wa ? `<a class="btn btn-primary btn-lg btn-block" target="_blank" rel="noopener" href="${waLink(`مرحباً، أرسلت إيصال الدفع لتفعيل حسابي في Oman EM Prep — ${p.email || ''}`)}">نبّهنا عبر واتساب لتفعيل أسرع</a>` : ''}
      ${foot}`);
    payPoll = setInterval(async () => {
      await SB.refreshProfile();
      if (hasFullAccess() || partsOwned() > own) renderActivated();
      else if (SB.profile.access_status !== 'pending') renderPaywall();
    }, 15000);
    return;
  }

  const st = readiness();
  const link = /^https?:\/\//i.test(PAY.pay_link || '') ? PAY.pay_link : null;
  const hasDetails = PAY.account || PAY.beneficiary || PAY.bank || link;
  const perk = (text) => `<li>${icon('check')}<span>${text}</span></li>`;
  const total = ALL_QUESTIONS.length.toLocaleString('en');
  const size = partSize().toLocaleString('en');
  // a doctor already paying by parts goes on by parts; a new one chooses between the two plans
  const choose = !own && partsOn();
  if (own) payPlan = 'part';
  else if (!choose) payPlan = 'full';
  const amount = (text) => parseFloat(String(text).replace(/[^\d.]/g, ''));
  const cheaper = amount(planPrice('full')) < amount(planPrice('part')) * PARTS;
  const plan = (id, name, desc, per = '', tag = '') => `
    <button class="plan ${payPlan === id ? 'on' : ''}" role="radio" aria-checked="${payPlan === id}" data-plan="${id}">
      <span class="plan-dot"></span>
      <span class="plan-name">${name}${tag ? `<span class="plan-tag">${tag}</span>` : ''}</span>
      <span class="plan-price"><b dir="auto">${esc(planPrice(id))}</b>${per}</span>
      <span class="plan-desc">${desc}</span>
    </button>`;
  cardShell(`
    <h1>${own ? (left === 0 ? `أنهيت الجزء ${own} من ${PARTS}` : `اشترك في الجزء ${own + 1} من ${PARTS}`)
      : left === 0 ? 'أنهيت أسئلتك المجانية' : 'اختر اشتراكك'}</h1>
    <p class="auth-sub">${own ? `الجزء ${own + 1} يضيف ${size} سؤالاً إلى حسابك، من أي قسم تختاره.`
      : left === 0 && st.accuracy >= 60 ? `بداية قوية، دقتك ${st.accuracy}%. ${choose ? 'اختر اشتراكك وأكمل' : 'أكمل'} الطريق إلى الاختبار.`
      : choose ? 'ادفع مرة واحدة، أو خذ بنك الأسئلة على ثلاثة أجزاء.'
      : 'دفعة واحدة ووصول دائم لكل المحتوى.'}</p>
    ${choose ? `
      <div class="plans" role="radiogroup" aria-label="نوع الاشتراك">
        ${plan('full', 'الاشتراك الكامل', `كل الأسئلة (${total}) وكل الاختبارات، بدفعة واحدة ووصول دائم.`, '', cheaper ? 'الأوفر' : '')}
        ${plan('part', 'على ثلاثة أجزاء', `كل جزء يفتح ${size} سؤالاً من أي قسم تختاره. تدفع الجزء التالي عندما تنهي الحالي.`, ' للجزء')}
      </div>` : own ? '' : `
      <ul class="perks">
        ${perk(`${total} سؤالاً مع الشرح في ${DB.sections.length} قسماً`)}
        ${perk('اختبارات محاكاة بالتوقيت الحقيقي')}
        ${perk('دفعة واحدة، وصول دائم وتقدّمك محفوظ')}
      </ul>`}
    ${p.access_status === 'rejected' ? `<div class="auth-err">لم نتمكن من قبول الإيصال${p.reject_reason ? ': ' + esc(p.reject_reason) : ''}. ارفع إيصالاً آخر وسنراجعه فوراً.</div>` : ''}
    ${err ? `<div class="auth-err">${esc(err)}</div>` : ''}
    <div class="pay-box">
      <div class="pay-price"><span>${own ? `رسوم الجزء ${own + 1} من ${PARTS}` : 'المبلغ المطلوب تحويله'}</span><b dir="auto" id="pay-amount">${esc(planPrice(payPlan))}</b></div>
      ${payRow('المستفيد', PAY.beneficiary)}
      ${payRow('البنك', PAY.bank)}
      ${payRow('رقم الحساب', PAY.account, true)}
      ${link ? `<a class="btn btn-block" target="_blank" rel="noopener" href="${esc(link)}">ادفع عبر الرابط ↗</a>` : ''}
      ${PAY.note ? `<p class="pay-note" dir="auto">${esc(PAY.note)}</p>` : ''}
      ${hasDetails ? '' : '<p class="pay-note">تواصل معنا للحصول على بيانات التحويل.</p>'}
    </div>
    <input type="file" id="rc-file" accept="image/*,application/pdf" hidden>
    <div id="rc-zone">
      <button class="btn btn-primary btn-lg btn-block" id="rc-pick">حوّلت؟ ارفع صورة الإيصال</button>
    </div>
    <details class="pay-code">
      <summary>لديك رمز تفعيل؟</summary>
      <div class="pay-code-row">
        <input id="au-code" dir="ltr" placeholder="XXXX-XXXX" autocomplete="off">
        <button class="btn" id="code-go">تفعيل</button>
      </div>
      <div class="auth-err" id="code-err" hidden>رمز غير صالح أو مستهلك</div>
    </details>
    ${promoReady() ? `<button class="btn btn-ghost btn-block" onclick="openPromo()">${icon('plus')} لديك رمز دعائي؟ افتح أسئلة إضافية</button>` : ''}
    ${referralEnabled() ? `<button class="btn btn-ghost btn-block" onclick="openReferral()">${icon('share')} ادعُ زملاءك واربح أسئلة مجانية</button>` : ''}
    ${wa ? `<a class="btn btn-ghost btn-block" target="_blank" rel="noopener" href="${waLink('مرحباً، لدي استفسار عن تفعيل حسابي في Oman EM Prep')}">💬 تواصل معنا عبر واتساب</a>` : ''}
    ${foot}`);

  $$('.pay-copy').forEach((b) => b.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(b.dataset.copy);
      b.textContent = 'تم النسخ ✓';
      setTimeout(() => { b.textContent = 'نسخ'; }, 1600);
    } catch (e) { /* clipboard blocked: the number stays selectable */ }
  }));
  $$('.plan').forEach((el) => el.addEventListener('click', () => {
    payPlan = el.dataset.plan;
    $$('.plan').forEach((x) => {
      x.classList.toggle('on', x === el);
      x.setAttribute('aria-checked', String(x === el));
    });
    $('#pay-amount').textContent = planPrice(payPlan);
  }));
  $('#rc-pick').addEventListener('click', () => $('#rc-file').click());
  $('#rc-file').addEventListener('change', (e) => { if (e.target.files[0]) previewReceipt(e.target.files[0]); });
  $('#code-go').addEventListener('click', async () => {
    const code = $('#au-code').value.trim();
    if (!code) return;
    const ok = await SB.redeemCode(code).catch(() => false);
    if (ok) renderActivated();
    else $('#code-err').hidden = false;
  });
}

function previewReceipt(file) {
  const isImage = file.type.startsWith('image/');
  $('#rc-zone').innerHTML = `
    <div class="rc-preview">${isImage
      ? `<img src="${URL.createObjectURL(file)}" alt="الإيصال">`
      : `<div class="rc-doc">📄 ${esc(file.name)}</div>`}</div>
    <button class="btn btn-primary btn-block" id="rc-send">إرسال طلب الاشتراك</button>
    <button class="btn btn-ghost btn-block" id="rc-change">اختيار ملف آخر</button>`;
  $('#rc-change').addEventListener('click', () => $('#rc-file').click());
  $('#rc-send').addEventListener('click', async () => {
    const btn = $('#rc-send');
    btn.disabled = true;
    btn.textContent = 'جارٍ الإرسال…';
    try {
      const blob = await compressImage(file);
      if (blob.size > RECEIPT_MAX_BYTES) { renderPaywall('الملف أكبر من 10MB — التقط صورة للإيصال بدلاً منه'); return; }
      await SB.submitReceipt(blob, payPlan);
      renderPaywall();
    } catch (e) {
      renderPaywall('تعذّر إرسال الإيصال — تحقق من اتصالك وحاول مرة أخرى');
    }
  });
}

function humanAuthError(msg) {
  const m = String(msg || '');
  if (m.includes('Invalid login')) return 'بريد أو كلمة مرور غير صحيحة';
  if (m.includes('already registered')) return 'هذا البريد مسجل بالفعل — سجّل الدخول';
  if (m.includes('not confirmed')) return 'أكّد بريدك أولاً من الرسالة التي وصلتك ثم سجّل الدخول';
  if (m.includes('Password') && m.includes('bytes')) return 'كلمة المرور قصيرة — 6 أحرف على الأقل';
  if (m.includes('rate limit') || m.includes('Rate')) return 'محاولات كثيرة — انتظر قليلاً ثم جرّب';
  if (m.includes('Failed to fetch')) return 'تعذر الاتصال بالخادم — تحقق من اتصالك';
  return m;
}

function logout() {
  if (window.SB) SB.logout();
  location.reload();
}

/* ---------------- boot ---------------- */
(async function boot() {
  applyTheme(false);
  captureRef();   // remember ?ref= from an invite link before anything navigates
  if (window.SB && SB.configured) {
    Boot.step('جاري التحقق من حسابك…', 6, 18);
    const authed = await SB.init().catch(() => false);
    if (!authed) {   // these screens keep the brand colour in the status bar
      Boot.done();
      // a first-time visitor meets the idea before the form; a returning one goes straight to sign-in
      if (Guide.state.intro || localStorage.getItem(KNOWN_KEY)) renderAuth();
      else { await loadBlueprint(); renderIntro(() => renderAuth('signup'), () => renderAuth('login')); }
      return;
    }
    adoptStoreFor(SB.session.user.id);
  }
  try {
    await loadData();
    if (window.SB && SB.configured) {
      // payment + referral settings are needed on every screen (even full-access
      // doctors can invite), so load them for everyone
      const pay = SB.paymentSettings().then((row) => { PAY = row; }).catch(() => {});
      if (!hasFullAccess()) {
        // the trial counter is the progress the server holds: pull it (and the
        // payment details) before the first screen so the count is right —
        // but a server that is slow to answer must not hold the doctor here:
        // open on the local count and redraw Home when the answer lands
        Boot.step('جاري مزامنة تقدّمك…', 88, 97, 'خطوة أخيرة');
        let opened = false;
        const merge = Sync.merge().then(() => { if (opened && (location.hash || '#/') === '#/') route(); }).catch(() => {});
        await within(Promise.all([merge, pay]), 8000);
        opened = true;
      }
      Sync.start(!hasFullAccess());
    }
    Boot.done();
    if (!Guide.state.intro && !profileOrNull()) renderIntro(route);   // local mode: no sign-up screen to follow
    else route();
    loadRecalls();
  } catch (err) {
    Boot.done();
    applyTheme();
    const served = location.protocol !== 'file:';
    app.innerHTML = served ? `
      <div class="error-overlay" dir="rtl" lang="ar"><div class="error-box">
        <h2>تعذّر تحميل بنك الأسئلة</h2>
        <p>تحقق من اتصالك بالإنترنت ثم أعد المحاولة. تقدّمك محفوظ.</p>
        <button class="btn btn-primary btn-block" onclick="location.reload()">إعادة المحاولة</button>
        <p dir="ltr" style="font-size:12px;margin:12px 0 0;opacity:.7">${esc(err.message)}</p>
      </div></div>` : `
      <div class="error-overlay"><div class="error-box">
        <h2>Could not load the question bank</h2>
        <p>${esc(err.message)}</p>
        <p>This app reads its JSON files with <code>fetch</code>, which browsers block when opened directly from disk. Serve the folder with any static server:</p>
        <code>cd D:\\EXAM</code>
        <code>python -m http.server 8000</code>
        <p>Then open <strong>http://localhost:8000</strong></p>
        <code>npx serve .</code>
        <p>— or deploy the folder to Netlify / Vercel / GitHub Pages and it will work as-is.</p>
      </div></div>`;
  }
})();
