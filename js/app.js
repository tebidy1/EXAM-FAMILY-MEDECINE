/* ============================================================
   Oman EM Prep — vanilla JS single-page app (no dependencies)
   Data: data/sections.json + data/questions/*.json + data/blueprint.json
   (bank schema unchanged — all intelligence lives here)

   Architecture: 3 tabs (Home / Practice / Exams)
   - Home: "what should I do today?" — resume + 3-item smart queue
   - Practice: 18 sections -> section page with coverage checkpoints
   - Exams: OEEM full simulation (unlock credits) + attempt history

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
  return { v: 2, q: {}, starred: [], history: [], active: null, mocksTaken: 0 };
}
let store = loadStore();

function saveStore() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* private mode */ }
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
  if (window.Sync) Sync.queueQuestion(qid);
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

function applyTheme() {
  const t = localStorage.getItem(THEME_KEY) ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = t;
}

function themeButtonHtml() {
  const dark = document.documentElement.dataset.theme === 'dark';
  return `<button class="btn theme-btn" onclick="toggleTheme()" title="${dark ? 'Light mode' : 'Dark mode'}">${dark ? '☀️' : '🌙'}</button>`;
}

function toggleTheme() {
  const dark = document.documentElement.dataset.theme === 'dark';
  localStorage.setItem(THEME_KEY, dark ? 'light' : 'dark');
  applyTheme();
  refreshView();
}

function refreshView() {
  if (session && !session.finished) renderQuiz();
  else route();
}

/* ---------------- data ---------------- */
let DB = { sections: [], byId: {} };
let ALL_QUESTIONS = [];
let BLUEPRINT = null;

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

async function loadData() {
  const secRes = await fetch('data/sections.json');
  if (!secRes.ok) throw new Error('sections.json not found');
  const secData = await secRes.json();

  let loaded = 0;
  const results = await Promise.all(secData.sections.map(async (s) => {
    const res = await fetch(s.file);
    if (!res.ok) throw new Error(`Could not load ${s.file}`);
    const questions = await res.json();
    loaded += 1;
    const st = $('#bootStatus');
    if (st) st.textContent = `Loaded ${loaded}/${secData.sections.length} sections…`;
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

  try {
    const bpRes = await fetch('data/blueprint.json');
    if (bpRes.ok) BLUEPRINT = await bpRes.json();
  } catch (e) { /* simulation stays hidden if blueprint missing */ }
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
    <div class="topbar"><div class="topbar-inner">
      <div class="brand" onclick="location.hash='#/'">
        <div class="brand-logo">EM</div><div><div class="brand-name">Oman EM Prep</div></div>
      </div>
      ${themeButtonHtml()}
    </div></div>
    <div class="wrap" style="max-width:620px">
      <div class="q-card briefing">
        <div class="oeem-logo big">${kind === 'milestone' ? 'M' + spec.id : esc(BLUEPRINT.exam.code)}</div>
        <h1>${esc(title)}</h1>
        <p class="briefing-ar">${esc(sub)}</p>
        <div class="facts">
          <div class="fact"><b>${spec.size}</b><span>questions</span></div>
          <div class="fact"><b>${Math.floor(spec.minutes / 60) ? Math.floor(spec.minutes / 60) + 'h ' : ''}${spec.minutes % 60}m</b><span>time limit</span></div>
          <div class="fact"><b>${Math.round((spec.minutes * 60) / spec.size)}s</b><span>per question</span></div>
          <div class="fact"><b>${BLUEPRINT.domains.length}</b><span>domains</span></div>
        </div>
        <ul class="rules">
          <li>No feedback during the exam — full review with explanations after you submit.</li>
          <li>Answers stay editable; jump between questions from the ⊞ Navigator.</li>
          <li>Submits automatically when the timer reaches 0:00.</li>
          ${kind === 'milestone'
            ? '<li>المزيج: 75% من أسئلة غطّيتها فعلاً + 25% جديد — تشويق لما ينتظرك.</li>'
            : `<li>Fixed official blueprint paper — identical for every candidate, built for honest comparison.</li>`}
        </ul>
        ${canResume ? `<button class="btn btn-block" onclick="resumeSession()">▶ Resume your in-progress attempt</button>` : ''}
        <button class="btn btn-primary btn-block" onclick="${kind === 'milestone' ? `startMilestone(${spec.id})` : `startSimulation(${spec.id})`}">Begin</button>
        <a class="btn btn-ghost btn-block" href="#/exams">← Back to Exams</a>
      </div>
    </div>`;
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
  if (b) { b.textContent = 'Submit Exam'; b.classList.remove('btn-danger-soft'); b.dataset.armed = ''; }
}
function closeGrid() { $('#gridOverlay')?.setAttribute('hidden', ''); }

function submitFromGrid() {
  const unanswered = session.picked.filter((p) => p === null).length;
  const b = $('#gridSubmit');
  if (unanswered > 0 && b && !b.dataset.armed) {
    b.dataset.armed = '1';
    b.textContent = `${unanswered} unanswered — tap again to submit`;
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
  } else {
    qs = shuffle(sectionQuestions(sectionId));
    const sec = DB.sections.find((s) => s.id === sectionId);
    title = sec ? `${sec.name} — ${sec.nameAr}` : sectionId;
  }
  if (mode === 'exam') qs = qs.filter(isAnswerable).slice(0, EXAM_MAX_Q);
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

function chrome(content) {
  const tab = currentTab();
  const tabs = [
    ['#/', '🏠', 'Home', 'الرئيسية'],
    ['#/practice', '📚', 'Practice', 'التدريب'],
    ['#/exams', '🎓', 'Exams', 'الاختبارات'],
  ];
  const userChip = (window.SB && SB.configured && SB.profile)
    ? `<button class="btn user-chip" onclick="logout()" title="تسجيل الخروج">${esc(SB.profile.name || SB.profile.email || 'طبيب')} · خروج</button>`
    : '';
  return `
    <div class="topbar"><div class="topbar-inner">
      <div class="brand" onclick="location.hash='#/'">
        <div class="brand-logo">EM</div>
        <div><div class="brand-name">Oman EM Prep</div>
        <div class="brand-sub">استعد لاختبار الطوارئ</div></div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        ${userChip}
        ${themeButtonHtml()}
      </div>
    </div></div>
    <nav class="tabbar">
      ${tabs.map(([href, icon, en, ar]) => {
        const t = href === '#/' ? 'home' : href === '#/practice' ? 'practice' : 'exams';
        return `<a class="tab ${tab === t ? 'active' : ''}" href="${href}">
          <span class="tab-icon">${icon}</span>
          <span class="tab-text"><span class="tab-label">${en}</span><span class="tab-ar">${ar}</span></span>
        </a>`;
      }).join('')}
    </nav>
    <div class="wrap">${content}</div>`;
}

function route() {
  stopTimer();
  const hash = location.hash || '#/';
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
  session = null;
  renderHome();
}

/* ---------------- home: today's queue ---------------- */
function todayQueue() {
  const items = [];
  const wrong = wrongPool();
  if (wrong.length >= 3) {
    items.push({
      icon: '🔁',
      title: `Review ${wrong.length} wrong answers`,
      sub: 'Highest learning value — each leaves the pile after two correct in a row',
      cta: 'Review',
      href: '#/quiz/wrong/study',
    });
  }
  let sec = null, label = null;
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
    label = `Continue ${sec.name} — ${touched[0].seen}/${sec.count} covered`;
  } else {
    sec = DB.sections.find((s) => s.id === 'medicine') || DB.sections[0];
    label = `Start ${sec.name} — the highest-yield section`;
  }
  if (sec) {
    items.push({
      icon: sec.icon || '📖',
      title: label,
      sub: 'Study mode — instant feedback with every answer',
      cta: 'Continue',
      href: `#/quiz/${sec.id}/study`,
    });
  }
  const crams = cramPool();
  if (crams.length >= 3) {
    items.push({
      icon: '⚡',
      title: `Cram review — ${Math.min(crams.length, CRAM_MAX)} flashcards`,
      sub: 'Your weakest questions as flashcards. Fast, no scoring',
      cta: 'Cram',
      href: '#/quiz/cram/cram',
    });
  }
  return items.slice(0, 3);
}

function renderHome() {
  const st = readiness();
  const ringColor = st.readiness >= 70 ? 'var(--correct)' : st.readiness >= 40 ? 'var(--flag)' : 'var(--wrong)';

  const resume = store.active;
  const resumeHtml = resume && resume.qIds?.length
    ? `<div class="card resume-card">
        <div class="card-top">
          <div class="card-icon">⏸</div>
          <div style="min-width:0;flex:1">
            <div class="card-title">Resume where you left off</div>
            <div class="card-meta">${esc(resume.title)} · ${resume.mode === 'exam' ? 'Timed Test' : resume.mode === 'mock' ? 'OEEM Simulation' : 'Study'} · Question ${(resume.idx || 0) + 1} of ${resume.qIds.length}${resume.mode === 'mock' ? ` · ${fmtTime(resume.timeLeft || 0)} left` : ''}</div>
          </div>
          <button class="btn btn-primary" onclick="resumeSession()">▶ Resume</button>
        </div>
      </div>`
    : '';

  const queue = todayQueue();
  const queueHtml = queue.length
    ? queue.map((it, i) => `
        <div class="card queue-card">
          <div class="queue-rank">${i + 1}</div>
          <div class="queue-body">
            <div class="queue-title">${it.icon} ${esc(it.title)}</div>
            <div class="queue-sub">${esc(it.sub)}</div>
          </div>
          <a class="btn btn-primary" href="${it.href}">${esc(it.cta)}</a>
        </div>`).join('')
    : `<div class="card"><div class="card-meta">Open the Practice tab and pick a section to begin.</div></div>`;

  const goal = nextGoal();
  const oeemStrip = goal
    ? `<a class="card oeem-strip" href="${goal.href}">
        <div class="oeem-logo">🎯</div>
        <div style="min-width:0;flex:1">
          <div class="oeem-strip-title">${esc(goal.title)}</div>
          ${goal.pct < 100 ? `<div class="mastery oeem-progress" style="margin-top:4px"><div class="mastery-fill" style="width:${Math.round(goal.pct * 100)}%"></div></div>` : ''}
          <div class="oeem-progress-label">${esc(goal.sub)}</div>
        </div>
        <span class="oeem-chevron">›</span>
      </a>`
    : '';

  const hist = store.history.slice(0, 3);
  const histHtml = hist.length
    ? `<div class="hist-list">` + hist.map((h) => {
        const pct = h.total ? Math.round((h.correct / h.total) * 100) : 0;
        const kind = h.mode === 'mock' ? 'OEEM' : h.mode === 'exam' ? 'Test' : 'Study';
        return `
          <div class="hist-row">
            <span class="hist-score ${pct >= 70 ? 'ok' : 'no'}">${pct}%</span>
            <span class="hist-title">${esc(h.title)}</span>
            <span class="hist-meta">${kind} · ${h.correct}/${h.total} · ${new Date(h.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
          </div>`;
      }).join('') + `</div>`
    : `<div class="card"><div class="card-meta">Finish a session and your scores will collect here.</div></div>`;

  const content = `
    <div class="card readiness-compact">
      <div class="score-ring sm" style="--pct:${st.readiness};--score-color:${ringColor}">
        <div class="score-ring-inner"><b style="color:${ringColor}">${st.readiness}%</b></div>
      </div>
      <div class="rc-stats">
        <div><b>${st.readiness}%</b><span>Exam readiness</span></div>
        <div><b>${st.seen}<i>/${st.total}</i></b><span>Coverage</span></div>
        <div><b>${st.accuracy}%</b><span>Accuracy</span></div>
        <div><b>${st.mastered}</b><span>Mastered</span></div>
      </div>
    </div>
    ${resumeHtml}
    <div class="section-heading"><h2>Today</h2><span>قائمة اليوم — بالترتيب</span></div>
    ${queueHtml}
    <div class="section-heading"><h2>Exam Ladder</h2><span>سلّم الاختبارات — هدفك التالي</span></div>
    ${oeemStrip}
    <div class="section-heading"><h2>Recent</h2><span>آخر الجلسات</span></div>
    ${histHtml}`;
  app.innerHTML = chrome(content);
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
  const cards = DB.sections.map((sec) => {
    const s = sectionStats(sec.id);
    return `
      <a class="card sec-card" href="#/section/${sec.id}">
        <div class="card-top">
          <div class="card-icon">${sec.icon || '📋'}</div>
          <div style="min-width:0">
            <div class="card-title">${esc(sec.name)}</div>
            <div class="card-title-ar">${esc(sec.nameAr || '')}</div>
          </div>
        </div>
        <div>
          <div class="mastery"><div class="mastery-fill" style="width:${s.mastery}%"></div></div>
          <div class="card-meta" style="margin-top:5px">Mastery ${s.mastery}% · ${s.seen}/${s.total} seen</div>
        </div>
      </a>`;
  }).join('');

  const covBySec = {};
  DB.sections.forEach((s) => { covBySec[s.id] = sectionCoverage(s.id).seen; });
  const path = BLUEPRINT ? recommendedPath() : [];
  const trail = path.length
    ? `<div class="path-strip">${path.map((s, i) =>
        `<a class="path-chip ${covBySec[s.id] ? 'touched' : ''}" href="#/section/${s.id}"><b>${i + 1}</b>${s.icon || ''} ${esc(s.name)}</a>`).join('')}</div>
      <div class="card-meta" style="margin:6px 2px 0">المسار المقترح — مرتب بأوزان المخطط الرسمي. اتبعه أو اختر حرّاً؛ اختبارات المحطات تتكيف مع تغطيتك أياً كان مسارك.</div>`
    : '';

  const content = `
    <div class="hero" style="padding-top:8px">
      <h1 style="font-size:20px">Practice by section</h1>
      <p>Study with instant feedback — coverage checkpoints test what you have covered.</p>
    </div>
    ${trail}
    <div class="grid">${cards}</div>`;
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
        <div class="cp-row open">
          <span class="cp-state">✓</span>
          <div class="cp-body">
            <div class="cp-name">Checkpoint ${cp.tier} — ${Math.min(20, cov.seen)} questions · 25 min</div>
            <div class="cp-meta">${cs.attempts ? `${cs.attempts} attempt${cs.attempts > 1 ? 's' : ''}${cs.best != null ? ` · best ${cs.best}%` : ''}` : 'Not attempted yet'}</div>
          </div>
          <button class="btn btn-primary" onclick="startCheckpoint('${secId}', ${cp.tier})">Take</button>
        </div>`;
    }
    return `
      <div class="cp-row locked">
        <span class="cp-state">🔒</span>
        <div class="cp-body">
          <div class="cp-name">Checkpoint ${cp.tier}</div>
          <div class="cp-meta">Unlocks at ${gatePct}% coverage — you are at ${Math.round(cov.pct * 100)}%</div>
        </div>
        <button class="btn" disabled>Locked</button>
      </div>`;
  }).join('');

  const content = `
    <button class="back-link" onclick="location.hash='#/practice'">← All sections</button>
    <div class="sec-hero">
      <div class="card-icon big">${sec.icon || '📋'}</div>
      <div>
        <h1>${esc(sec.name)}</h1>
        <div class="sec-hero-ar">${esc(sec.nameAr || '')}</div>
        <div class="card-meta">${sec.count} questions · Mastery ${st.mastery}% · ${cov.seen}/${cov.total} covered (${Math.round(cov.pct * 100)}%)</div>
        <div class="mastery" style="margin-top:8px"><div class="mastery-fill" style="width:${st.mastery}%"></div></div>
      </div>
    </div>
    <a class="btn btn-primary btn-block sec-cta" href="#/quiz/${sec.id}/study">
      ▶ ${cov.seen > 0 ? 'Continue studying' : 'Start studying'} — instant feedback per answer
    </a>
    <div class="section-heading"><h2>Coverage checkpoints</h2><span>اختبر ما غطّيته — 20 سؤالاً · 25 دقيقة</span></div>
    <div class="cp-list">${checkpoints}</div>
    <div class="section-heading"><h2>Drills</h2><span>تدريب موجّه</span></div>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">
      <div class="card">
        <div class="card-top"><div class="card-icon">🔁</div>
          <div><div class="card-title">Wrong answers</div><div class="card-title-ar">أخطاء هذا القسم</div></div>
        </div>
        <div class="card-meta">${wrongN ? `${wrongN} waiting — two correct in a row clears each` : 'Nothing waiting. Nice.'}</div>
        ${wrongN ? `<a class="btn btn-primary btn-block" href="#/quiz/wrong-${sec.id}/study">Drill ${wrongN} wrong</a>` : `<button class="btn btn-block" disabled>Empty</button>`}
      </div>
      <div class="card">
        <div class="card-top"><div class="card-icon">⭐</div>
          <div><div class="card-title">Bookmarks</div><div class="card-title-ar">محفوظات القسم</div></div>
        </div>
        <div class="card-meta">${stars ? `${stars} bookmarked here` : 'Press F while studying to bookmark.'}</div>
        ${stars ? `<a class="btn btn-primary btn-block" href="#/quiz/starred-${sec.id}/study">Study ${stars} bookmarks</a>` : `<button class="btn btn-block" disabled>None yet</button>`}
      </div>
    </div>`;
  app.innerHTML = chrome(content);
}

/* ---------------- exams tab: the 13-step ladder ---------------- */
function renderExams() {
  session = null;
  const cov = uniqueCovered();
  const ratio = coverageRatio();

  const msCards = (BLUEPRINT?.milestoneTests || []).map((m) => {
    const st = milestoneState(m);
    const body = st.unlocked
      ? `<div class="card-meta">${st.attempts ? `${st.attempts} attempt${st.attempts > 1 ? 's' : ''} · best <b>${st.best}%</b>` : 'Not attempted yet'} · ${m.size}q · ${m.minutes}min · 75/25 mix</div>`
      : `<div class="mastery" style="margin-top:4px"><div class="mastery-fill" style="width:${Math.min(100, Math.round((cov / m.unlockAt) * 100))}%"></div></div>
         <div class="card-meta" style="margin-top:5px">${cov}/${m.unlockAt} covered — <b>${st.remaining}</b> remaining</div>`;
    const action = st.unlocked
      ? `<a class="btn btn-primary" href="#/quiz/milestone-${m.id}/mock">${st.best != null ? 'Retake' : 'Start'}</a>`
      : `<button class="btn" disabled>🔒</button>`;
    return `
      <div class="card ms-row ${st.unlocked ? '' : 'locked'}">
        <div class="ms-num">${m.id}</div>
        <div style="flex:1;min-width:0">
          <div class="card-title">Milestone Test ${m.id}</div>
          ${body}
        </div>
        ${action}
      </div>`;
  }).join('');

  const simCards = (BLUEPRINT?.simulations || []).map((s) => {
    const st = simState(s);
    const need = Math.round(s.unlockAtCoverage * 100);
    const body = st.unlocked
      ? `<div class="card-meta">${st.attempts ? `${st.attempts} attempt${st.attempts > 1 ? 's' : ''} · best <b>${st.best}%</b>` : 'Not attempted yet'} · ${s.size}q · ${s.minutes}min · fixed paper</div>`
      : `<div class="mastery" style="margin-top:4px"><div class="mastery-fill" style="width:${Math.min(100, Math.round((ratio / s.unlockAtCoverage) * 100))}%"></div></div>
         <div class="card-meta" style="margin-top:5px">unlocks at ${need}% coverage — you are at ${Math.round(ratio * 100)}% · <b>${st.remaining}</b> remaining</div>`;
    const action = st.unlocked
      ? `<a class="btn oeem-cta" href="#/quiz/sim-${s.id}/mock">${st.best != null ? 'Retake' : 'Start'}</a>`
      : `<button class="btn" disabled>🔒</button>`;
    return `
      <div class="card ms-row sim ${st.unlocked ? '' : 'locked'}">
        <div class="ms-num">${s.id}</div>
        <div style="flex:1;min-width:0">
          <div class="card-title">${esc(BLUEPRINT.exam.code)} Simulation ${s.id} ${need}%</div>
          ${body}
        </div>
        ${action}
      </div>`;
  }).join('');

  const hist = store.history.filter((h) => h.mode === 'mock' || h.mode === 'exam').slice(0, 20);
  const histHtml = hist.length
    ? `<div class="hist-list">` + hist.map((h) => {
        const pct = h.total ? Math.round((h.correct / h.total) * 100) : 0;
        const kind = h.kind === 'simulation' ? '🎓 OEEM' : h.kind === 'milestone' ? '🧩 Milestone' : h.kind === 'checkpoint' ? '🏁 Checkpoint' : '⏱ Test';
        return `
          <div class="hist-row">
            <span class="hist-score ${pct >= 70 ? 'ok' : 'no'}">${pct}%</span>
            <span class="hist-title">${esc(h.title)}</span>
            <span class="hist-meta">${kind} · ${h.correct}/${h.total} · ${new Date(h.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
          </div>`;
      }).join('') + `</div>`
    : `<div class="card"><div class="card-meta">Your ladder attempts will collect here.</div></div>`;

  const content = `
    <div class="hero" style="padding-top:8px">
      <h1 style="font-size:20px">Exam Ladder</h1>
      <p>10 milestone tests as you grow (every 300 covered questions) — then 3 fixed OEEM simulations, the same paper for everyone.</p>
    </div>
    <div class="section-heading"><h2>Milestone Tests</h2><span>اختبارات المحطات — 75% مما درسته + 25% جديد</span></div>
    <div class="ms-list">${msCards}</div>
    <div class="section-heading"><h2>OEEM Simulations</h2><span>المحاكاة الحقيقية — ورقة ثابتة للجميع، تفتح بالتغطية</span></div>
    <div class="ms-list">${simCards}</div>
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

function renderQuiz() {
  const isExam = session.mode === 'exam';
  const isCram = session.mode === 'cram';
  const isMock = session.mode === 'mock';
  const q = session.questions[session.idx];
  const picked = session.picked[session.idx];
  const revealed = session.submitted[session.idx];
  const isLast = session.idx === session.questions.length - 1;
  const starred = store.starred.includes(q.id);

  const progress = session.questions.length > 1
    ? `<div class="progress-track"><div class="progress-fill" style="width:${(session.idx / session.questions.length) * 100}%"></div></div>`
    : '';

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

  let feedback = '';
  if (revealed && isCram) {
    feedback = `
      <div class="feedback correct">
        <div class="feedback-head">Answer: ${LETTERS[q.answer]}</div>
        <div class="feedback-body">${esc(q.explanation || '')}</div>
        ${q.reference ? `<div class="feedback-ref">📚 ${esc(q.reference)}</div>` : ''}
      </div>`;
  } else if (revealed && q.selfScored && session.selfGrades[session.idx] == null) {
    feedback = `
      <div class="feedback">
        <div class="feedback-body">${esc(q.explanation || '')}</div>
        ${q.reference ? `<div class="feedback-ref">📚 ${esc(q.reference)}</div>` : ''}
        <div class="self-grade">
          <span class="self-grade-q">بعد قراءة الشرح — كيف كانت إجابتك؟ · How did you do?</span>
          <div class="self-grade-btns">
            <button class="btn" onclick="gradeSelf(true)">✓ I answered correctly</button>
            <button class="btn btn-danger-soft" onclick="gradeSelf(false)">✗ I missed it</button>
          </div>
        </div>
      </div>`;
  } else if (revealed && q.selfScored) {
    const ok = session.selfGrades[session.idx];
    feedback = `
      <div class="feedback ${ok ? 'correct' : 'wrong'}">
        <div class="feedback-head">${ok ? '✓ Self-graded: correct' : '✗ Self-graded: missed'}</div>
        <div class="feedback-body">${esc(q.explanation || '')}</div>
        ${q.reference ? `<div class="feedback-ref">📚 ${esc(q.reference)}</div>` : ''}
      </div>`;
  } else if (revealed) {
    const ok = picked === q.answer;
    feedback = `
      <div class="feedback ${ok ? 'correct' : 'wrong'}">
        <div class="feedback-head">${ok ? '✓ Correct' : `✗ Incorrect — correct answer: ${LETTERS[q.answer]}`}</div>
        <div class="feedback-body">${esc(q.explanation || '')}</div>
        ${q.reference ? `<div class="feedback-ref">📚 ${esc(q.reference)}</div>` : ''}
      </div>`;
  }

  const timer = (isExam || isMock)
    ? `<span class="quiz-timer ${session.timeLeft <= (isMock ? 300 : 60) ? 'danger' : ''}" id="timer">${fmtTime(session.timeLeft)}</span>`
    : '';

  const modeBadge = isMock ? session.title : isExam ? 'Timed Test' : isCram ? '⚡ Cram' : 'Study Mode';
  const noun = isCram ? 'Card' : 'Question';

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
          <span>${answeredN}/${session.questions.length} answered · ${fmtTime(session.timeLeft)} left</span>
        </div>
      </div>`;
  }

  let gridOverlay = '';
  if (isMock) {
    const answeredN = session.picked.filter((p) => p !== null).length;
    gridOverlay = `
      <div class="grid-overlay" id="gridOverlay" hidden>
        <div class="grid-panel">
          <div class="grid-panel-head">
            <b>Question Navigator</b>
            <button class="btn btn-ghost" id="gridClose">✕</button>
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
            <span class="card-meta">${answeredN} answered · ${session.flagged.size} flagged · ${session.questions.length - answeredN} unanswered</span>
            <button class="btn btn-primary" id="gridSubmit">Submit Exam</button>
          </div>
        </div>
      </div>`;
  }

  app.innerHTML = `
    <div class="topbar"><div class="topbar-inner">
      <div class="brand" onclick="location.hash='#/'">
        <div class="brand-logo">EM</div>
        <div><div class="brand-name">Oman EM Prep</div></div>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <span class="quiz-mode-badge ${isExam || isMock ? 'exam' : ''}">${esc(modeBadge)}</span>
        ${timer}
        ${isMock ? `<button class="btn" id="headerGridBtn">⊞</button>` : ''}
        ${themeButtonHtml()}
      </div>
    </div></div>
    <div class="wrap">
      <div class="quiz-header">
        <button class="back-link" onclick="location.hash='#/'">← Exit</button>
        <span class="quiz-counter">${noun} ${session.idx + 1} of ${session.questions.length}</span>
      </div>
      ${progress}
      ${paceBar}
      <div class="q-card">
        ${q.vignette ? `<div class="q-vignette">${esc(q.vignette)}</div>` : ''}
        <div class="q-text">${esc(q.question)}</div>
        <div class="options">${options}</div>
        ${feedback}
      </div>
      <div class="quiz-footer">
        <button class="btn ${starred ? 'flagged' : 'ghost'}" id="flagBtn">
          ${starred ? '⭐ Bookmarked' : '☆ Bookmark'} <kbd>F</kbd>
        </button>
        <div class="quiz-footer-right">
          ${session.idx > 0 ? `<button class="btn" id="prevBtn">← Previous</button>` : ''}
          ${isCram
            ? (revealed
                ? `<button class="btn btn-primary" id="nextBtn">${isLast ? 'Done' : 'Next →'} <kbd>↵</kbd></button>`
                : `<button class="btn btn-primary" id="cramBtn">Show Answer <kbd>↵</kbd></button>`)
            : isMock
              ? (isLast
                  ? `<button class="btn btn-primary" id="footerGridBtn">Review & Submit</button>`
                  : `<button class="btn btn-primary" id="nextBtn" ${picked === null ? 'disabled' : ''}>Next →</button>`)
              : isExam
                ? (isLast
                    ? `<button class="btn btn-primary" id="nextBtn">Finish Exam</button>`
                    : `<button class="btn btn-primary" id="nextBtn" ${picked === null ? 'disabled' : ''}>Next →</button>`)
                : (revealed
                    ? `<button class="btn btn-primary" id="nextBtn">${isLast ? 'See Results' : 'Next →'} <kbd>↵</kbd></button>`
                    : ``)}
        </div>
      </div>
      ${!isExam && !isCram && !isMock ? `<div class="hint">Tap an answer — the result and explanation appear instantly. Keys <kbd>A</kbd>–<kbd>${LETTERS[q.options.length - 1]}</kbd> work too.</div>` : ''}
      ${isCram ? `<div class="hint">Flashcards don't affect your score — think first, then reveal. ⭐ to keep for later.</div>` : ''}
      ${isExam ? `<div class="hint">Exam pace: ${EXAM_SEC_PER_Q}s per question. Skipped questions count as wrong.</div>` : ''}
      ${isMock ? `<div class="hint">Blueprint simulation — answers stay editable, ⊞ Navigator jumps anywhere and submits.</div>` : ''}
    </div>
    ${gridOverlay}`;

  $$('.option:not(:disabled)').forEach((el) =>
    el.addEventListener('click', () => pick(+el.dataset.i)));
  $('#flagBtn')?.addEventListener('click', toggleFlag);
  $('#prevBtn')?.addEventListener('click', () => { session.idx -= 1; persistSession(); renderQuiz(); });
  $('#cramBtn')?.addEventListener('click', revealCram);
  $('#nextBtn')?.addEventListener('click', next);
  if (isMock) {
    $('#headerGridBtn')?.addEventListener('click', openGrid);
    $('#footerGridBtn')?.addEventListener('click', openGrid);
    $('#gridClose')?.addEventListener('click', closeGrid);
    $('#gridSubmit')?.addEventListener('click', submitFromGrid);
    $$('#gridOverlay .qcell').forEach((el) => el.addEventListener('click', () => {
      session.idx = +el.dataset.i;
      closeGrid();
      renderQuiz();
      window.scrollTo(0, 0);
    }));
  }
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
}

function next() {
  if (session.idx < session.questions.length - 1) {
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
  session.questions.forEach((q, i) => {
    if (session.picked[i] !== null) recordAttempt(q.id, session.picked[i] === q.answer);
  });
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
function correct0(sess) {
  return sess.questions.reduce((n, q, i) => n + (sess.picked[i] === q.answer ? 1 : 0), 0);
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
    const ok = session.picked[i] === q.answer;
    const skipped = session.picked[i] === null;
    const sec = DB.sections.find((s) => s.id === q.sectionId);
    const m = MASTERY_LABEL(masteryOf(store.q[q.id]));
    return `
      <div class="review-row" data-i="${i}">
        <div class="review-status ${ok ? 'ok' : 'no'}">${ok ? '✓' : '✗'}</div>
        <div class="review-text">${esc(q.question)}</div>
        <div class="review-num">${esc(sec?.name || '')} · ${m}</div>
      </div>
      <div class="review-detail" id="detail-${i}" hidden>${reviewDetail(q, i)}</div>`;
  }).join('');

  app.innerHTML = `
    <div class="topbar"><div class="topbar-inner">
      <div class="brand" onclick="location.hash='#/'">
        <div class="brand-logo">EM</div>
        <div><div class="brand-name">Oman EM Prep</div></div>
      </div>
      ${themeButtonHtml()}
    </div></div>
    <div class="wrap">
      <div class="result-hero">
        <div class="score-ring" style="--pct:${pct};--score-color:${color}">
          <div class="score-ring-inner">
            <div class="score-num" style="color:${color}">${pct}%</div>
            <div class="score-label">${correct} / ${total} correct</div>
          </div>
        </div>
        <div class="result-msg">${auto ? '⏱ Time is up — the exam was submitted automatically. ' : ''}${esc(msg)}</div>
        <div style="display:flex;gap:10px;justify-content:center;margin-top:20px;flex-wrap:wrap">
          <a class="btn" href="${isMock ? '#/' : session.checkpoint ? `#/section/${session.checkpoint.sectionId}` : '#/'}">← Back to ${isMock ? 'Home' : session.checkpoint ? (DB.sections.find((s) => s.id === session.checkpoint.sectionId)?.name || 'Section') : 'Home'}</a>
          ${isMock ? '' : `<button class="btn btn-primary" onclick="retakeSame()">↻ Retake this set</button>`}
        </div>
      </div>
      ${splitTable}
      ${domainTable}
      <div class="section-heading"><h2>Review Answers</h2><span>tap a question to see the explanation</span></div>
      <div class="review-list">${rows}</div>
    </div>`;

  $$('.review-row').forEach((el) =>
    el.addEventListener('click', () => {
      const d = $(`#detail-${el.dataset.i}`);
      d.hidden = !d.hidden;
      if (!d.hidden) d.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }));
}

function reviewDetail(q, i) {
  const picked = session.picked[i];
  const ok = picked === q.answer;
  const options = q.options.map((opt, j) => {
    let cls = 'option';
    if (j === q.answer) cls += ' correct';
    else if (j === picked) cls += ' wrong';
    return `
      <div class="${cls}" style="cursor:default">
        <span class="option-key">${LETTERS[j]}</span><span>${esc(opt)}</span>
      </div>`;
  }).join('');
  return `
    <div class="q-card" style="margin:10px 0 6px">
      ${q.vignette ? `<div class="q-vignette">${esc(q.vignette)}</div>` : ''}
      <div class="q-text">${esc(q.question)}</div>
      <div class="options">${options}</div>
      <div class="feedback ${ok ? 'correct' : 'wrong'}" style="margin-top:14px">
        <div class="feedback-head">${ok ? '✓ You answered correctly' : `✗ You picked ${picked === null ? 'nothing (skipped)' : LETTERS[picked]} — correct answer: ${LETTERS[q.answer]}`}</div>
        <div class="feedback-body">${esc(q.explanation || '')}</div>
        ${q.reference ? `<div class="feedback-ref">📚 ${esc(q.reference)}</div>` : ''}
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
  session = buildSession(session.sectionId, session.mode);
  if (session.questions.length === 0) { renderEmpty(session); return; }
  if (session.mode === 'exam') startTimer();
  persistSession();
  renderQuiz();
  window.scrollTo(0, 0);
}

function renderEmpty(sess) {
  const msg = sess.mode === 'cram'
    ? 'Nothing to cram yet — answer some questions first and your weakest will collect here.'
    : sess.sectionId === 'wrong'
      ? 'You have no questions waiting for review right now.'
      : sess.sectionId.startsWith('wrong-') || sess.sectionId.startsWith('starred-')
        ? 'This drill is empty right now.'
        : 'This set is empty.';
  app.innerHTML = `
    <div class="topbar"><div class="topbar-inner">
      <div class="brand" onclick="location.hash='#/'">
        <div class="brand-logo">EM</div><div><div class="brand-name">Oman EM Prep</div></div>
      </div>
      ${themeButtonHtml()}
    </div></div>
    <div class="wrap"><div class="empty" style="margin-top:32px">
      <div class="empty-icon">🌤</div>
      <h2 style="margin-bottom:6px">Nothing to practice here</h2>
      <p>${esc(msg)}</p>
      <a class="btn btn-primary" style="margin-top:16px" href="#/">Back to Home</a>
    </div></div>`;
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
  start() {
    if (!SB.configured || !SB.session) return;
    this.merge().catch(() => {});
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
  queueQuestion(qid) { this.queue.push(qid); },
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

/* ---------------- auth screens ---------------- */
function authShell(inner) {
  app.innerHTML = `
    <div class="auth-wrap">
      <div class="q-card auth-card">
        <div class="brand-logo auth-logo">EM</div>
        <h1>Oman EM Prep</h1>
        <p class="auth-sub">استعد لاختبار الطوارئ — تقدّمك يتبعك على كل أجهزتك</p>
        ${inner}
      </div>
    </div>`;
}

function renderAuth(mode = 'login', msg = null, err = null) {
  session = null;
  const login = mode === 'login';
  authShell(`
    ${msg ? `<div class="auth-ok">${esc(msg)}</div>` : ''}
    ${err ? `<div class="auth-err">${esc(err)}</div>` : ''}
    <label class="auth-label">البريد الإلكتروني
      <input id="au-email" type="email" dir="ltr" autocomplete="email" placeholder="doctor@example.com">
    </label>
    <label class="auth-label">كلمة المرور
      <input id="au-pass" type="password" dir="ltr" autocomplete="${login ? 'current' : 'new'}-password" placeholder="6+ أحرف">
    </label>
    ${!login ? `
      <label class="auth-label">الاسم
        <input id="au-name" type="text" placeholder="د. ...">
      </label>
      <label class="auth-label">رمز التفعيل
        <input id="au-code" dir="ltr" placeholder="XXXX-XXXX" autocomplete="off">
      </label>` : ''}
    <button class="btn btn-primary btn-block" id="au-go">${login ? 'دخول' : 'إنشاء الحساب'}</button>
    <button class="btn btn-ghost btn-block" id="au-switch">${login ? 'ليس لديك حساب؟ أنشئ حساباً برمز تفعيل' : 'لديك حساب؟ تسجيل الدخول'}</button>
  `);
  $('#au-switch').addEventListener('click', () => renderAuth(login ? 'signup' : 'login'));
  $('#au-go').addEventListener('click', async () => {
    const btn = $('#au-go');
    const email = $('#au-email').value.trim();
    const pass = $('#au-pass').value;
    if (!email || !pass) { renderAuth(mode, null, 'أدخل البريد وكلمة المرور'); return; }
    btn.disabled = true;
    try {
      if (login) {
        const r = await SB.login(email, pass);
        if (r.needsCode) { renderRedeem(); return; }
        location.reload();
      } else {
        const name = $('#au-name').value.trim();
        const code = $('#au-code').value.trim();
        if (!name || !code) { renderAuth(mode, null, 'أدخل الاسم ورمز التفعيل'); return; }
        const valid = await SB.checkCode(code);
        if (!valid) { renderAuth(mode, null, 'رمز التفعيل غير صالح أو منتهي — تأكد من كتابته كما أُعطي لك'); return; }
        const r = await SB.signup(email, pass, name);
        if (r.needsCode) {
          const ok = await SB.redeemCode(code);
          if (!ok) { renderAuth(mode, null, 'تعذر تفعيل الرمز — جرّب مرة أخرى'); return; }
        }
        location.reload();
      }
    } catch (e) {
      renderAuth(mode, null, humanAuthError(e.message));
    }
  });
}

function renderRedeem(err = null) {
  session = null;
  authShell(`
    ${err ? `<div class="auth-err">${esc(err)}</div>` : ''}
    <p class="auth-note">بقي خطوة واحدة — أدخل رمز التفعيل الذي حصلت عليه لفتح المنصة.</p>
    <label class="auth-label">رمز التفعيل
      <input id="au-code" dir="ltr" placeholder="XXXX-XXXX" autocomplete="off">
    </label>
    <button class="btn btn-primary btn-block" id="au-go">تفعيل</button>
    <button class="btn btn-ghost btn-block" onclick="logout()">تسجيل الخروج</button>
  `);
  $('#au-go').addEventListener('click', async () => {
    const code = $('#au-code').value.trim();
    if (!code) { renderRedeem('أدخل الرمز'); return; }
    const ok = await SB.redeemCode(code).catch(() => false);
    if (ok) location.reload();
    else renderRedeem('رمز غير صالح أو مستهلك');
  });
}

function humanAuthError(msg) {
  const m = String(msg || '');
  if (m.includes('Invalid login')) return 'بريد أو كلمة مرور غير صحيحة';
  if (m.includes('already registered')) return 'هذا البريد مسجل بالفعل — سجّل الدخول';
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
  applyTheme();
  if (window.SB && SB.configured) {
    const authed = await SB.init().catch(() => false);
    if (!authed) { renderAuth(); return; }
    if (SB.profile && SB.profile.role !== 'admin' && !SB.profile.code_id) { renderRedeem(); return; }
  }
  try {
    await loadData();
    route();
    if (window.SB && SB.configured) Sync.start();
  } catch (err) {
    const served = location.protocol !== 'file:';
    app.innerHTML = `
      <div class="error-overlay"><div class="error-box">
        <h2>⚠️ Could not load the question bank</h2>
        <p>${esc(err.message)}</p>
        ${!served ? `
          <p>This app reads its JSON files with <code>fetch</code>, which browsers block when opened directly from disk. Serve the folder with any static server:</p>
          <code>cd D:\\EXAM</code>
          <code>python -m http.server 8000</code>
          <p>Then open <strong>http://localhost:8000</strong></p>
          <code>npx serve .</code>
          <p>— or deploy the folder to Netlify / Vercel / GitHub Pages and it will work as-is.</p>
        ` : `
          <p>Check that <code>data/sections.json</code> and the question files listed in it exist and contain valid JSON.</p>
        `}
      </div></div>`;
  }
})();
