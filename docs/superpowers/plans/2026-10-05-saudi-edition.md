# Saudi Edition (EXAM-SAUDI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**ملخص للمالك:** نسخة سعودية معزولة تمامًا عن عُمان — مستودع جديد `EXAM-SAUDI` في `D:\EXAM-SAUDI`، قاعدة بيانات Supabase مستقلة، نطاق فرعي جديد. المحرّك نفسه حرفيًا، وكل ما يخص البلد في ملف واحد. تبدأ بعينة 80 سؤالًا من بنك عُمان، ثم تُستبدل بمحتواك. لا يُعدَّل شيء في `D:\EXAM` ولا في مشروع Supabase الحالي ولا في `oman-em-prep.sootnote.com`.

**Goal:** A second, fully isolated deployment of the same exam-prep engine for Saudi students, running end to end (signup → trial → paywall → admin approval → analytics) on a small sample bank, ready to receive the owner's real content.

**Architecture:** `D:\EXAM-SAUDI` is a clone of `EXAM-OMAN@feat/mobile-pwa` that keeps the shared git history, with the Oman repo as a fetch-only `upstream` remote so engine fixes can be merged later. Everything country-specific that JavaScript renders moves into one new file, `js/edition.js`; the four static files that cannot read JavaScript (`index.html`, `admin.html`, `manifest.json`, `get/index.html`) are edited directly, and a new script `tools/check_edition.js` fails if any Oman-specific string survives anywhere. Data, Supabase project and Hostinger subdomain are all new.

**Tech Stack:** Vanilla JS PWA (no build step, no dependencies), Node scripts in `tools/`, Supabase (Postgres + Auth + Storage) through the Supabase connector, Hostinger static hosting through the Hostinger connector.

**Spec:** the conversation of 2026-10-05 (owner's request + the approved plan table). No separate spec file; this document carries the decisions.

## Global Constraints

- Nothing under `D:\EXAM` is modified, committed or pushed, except this plan file (untracked). The Oman Supabase project `ddqvtbvvxlqjahdhmfup` and the site `oman-em-prep.sootnote.com` are never written to.
- Working names (owner may rename; each is one value): repo `tebidy1/EXAM-SAUDI` (private), folder `D:\EXAM-SAUDI`, app name `Saudi Prep`, site `saudi-prep.sootnote.com`, default branch `main`.
- Currency `ر.س`. Placeholder prices `199 ر.س` (full) and `79 ر.س` (part) — placeholders only, the owner sets the real ones in the admin Payment tab.
- Trial stays 25 questions, parts stay 3, referral rewards stay 30 / 350 (same mechanism, unchanged).
- Storage keys (`oman-em-prep.v1`, `.theme`, `.install`, …) and service-worker cache names are **left as they are**: they are invisible, scoped to the origin, and renaming them only creates merge conflicts with upstream.
- No new dependencies, no build step. New scripts are plain Node like `tools/validate_data.js`.
- User-facing copy stays Arabic where it is Arabic today. No claim with a number (`5,000`, `80%`) may appear unless it is true of the bank being served.
- Commit messages follow the repo's style (`feat(scope): …`) and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Steps marked **OWNER** are done by the owner or need their explicit yes in chat (account creation, anything that costs money, publishing).

## Review Focus

1. **A local run writing to Oman's live database.** The clone starts with Oman's Supabase URL in `js/config.js`. Expected: the Saudi copy can never reach it. → Task 1 blanks the URL first; `check_edition.js` (Task 2) fails on the Oman project ref.
2. **A tiny bank.** 80 questions against milestone tests sized 50, simulations sized 100 and section checkpoints sized 20. Expected: every screen opens, no test offers more questions than exist. → Task 3 browser walk.
3. **The owner's real content arriving malformed.** Duplicate ids across files, `count` in `sections.json` not matching the file, a section in `blueprint.json` that does not exist. Expected: the validator names the file and the problem. → Task 3 validator tests.
4. **A stranger becoming admin.** `schema.sql` makes the first account ever created the admin. Expected: the owner's account exists before the link is public. → Task 6 ordering + SQL check.
5. **A future upstream merge bringing Oman back.** Merging `upstream` can restore deleted bank files or add new Oman strings. Expected: caught before deploy. → `check_edition.js` + `validate_data.js` are the pre-deploy gate (Task 2, documented in README in Task 5).

---

### Task 1: The isolated repository

**Files:**
- Create: `D:\EXAM-SAUDI\` (clone)
- Modify: `D:\EXAM-SAUDI\js\config.js`
- Create: `D:\EXAM-SAUDI\docs\superpowers\plans\2026-10-05-saudi-edition.md` (copy of this file)

**Interfaces:**
- Produces: a git repo at `D:\EXAM-SAUDI` on branch `main`, remote `upstream` = Oman (fetch only), remote `origin` = `https://github.com/tebidy1/EXAM-SAUDI.git`. All later tasks run inside it.

- [ ] **Step 1: Clone and set remotes**

```bash
git clone --branch feat/mobile-pwa https://github.com/tebidy1/EXAM-OMAN.git /d/EXAM-SAUDI
cd /d/EXAM-SAUDI
git branch -m main
git remote rename origin upstream
git remote set-url --push upstream DISABLED
git remote add origin https://github.com/tebidy1/EXAM-SAUDI.git
```

- [ ] **Step 2: Verify**

Run: `git remote -v && git log --oneline -1 && git status --short`
Expected: `upstream` fetch = EXAM-OMAN, `upstream` push = `DISABLED`, `origin` = EXAM-SAUDI, HEAD = `331f003`, clean tree.

- [ ] **Step 3: Disconnect from Oman's database**

In `js/config.js` set `url: ''` and `anonKey: ''` (the file's own comment: empty url = LOCAL mode). Copy this plan into `docs/superpowers/plans/`.

- [ ] **Step 4: Commit**

`chore(edition): start the Saudi edition disconnected from Oman's database`

- [ ] **Step 5 (OWNER): create the empty private repo `EXAM-SAUDI` on github.com** (no README, no licence — `gh` is not installed on this machine). Then `git push -u origin main`. Local work in Tasks 2–5 does not wait for this.

---

### Task 2: One file for everything country-specific

**Files:**
- Create: `js/edition.js`, `tools/check_edition.js`
- Modify: `js/app.js` (lines ≈ 417–418, 676, 909, 1035, 1045, 1171, 1270, 1277, 1662, 1924–1934, 2638–2639, 2661, 2677, 2792, 2863), `js/admin.js` (≈ 125, 160, 217, 295, 417–423, 774, 804, 838, 886, 907, 956, 1168), `index.html`, `admin.html`, `manifest.json`, `tools/dev-server.js` (19–21, 40, 47, 359), header comments in `.htaccess`, `css/styles.css`, `supabase/*.sql`, `js/app.js`

**Interfaces:**
- Produces: `window.EDITION`, loaded by `index.html` and `admin.html` as `js/edition.js?v=1` **before** `config.js`:

```js
window.EDITION = {
  id: 'saudi',
  appName: 'Saudi Prep',
  shortName: 'Saudi Prep',
  currency: 'ر.س',
  priceFull: '199 ر.س',          // shown until prices are saved in admin.html
  pricePart: '79 ر.س',
  phonePlaceholder: '+966 5x xxx xxxx',
  bankPlaceholder: 'اسم البنك',
  whatsappPlaceholder: '+966…',
  copy: {
    authTag: 'استعد لاختبارك بثقة',                    // under the app name on the sign-up screen
    perkBank: 'بنك أسئلة مع شرح كل إجابة',             // sign-up perk; no number
    guideLearnText: '…',                                // intro slide, was "…قسم الطوارئ…"
    guideBankTitle: 'كل سؤال تحلّه يقرّبك من الجاهزية', // intro slide, was the 5,000 / 80% claim
    shareText: 'جرّب Saudi Prep — بنك أسئلة مع شرح كل إجابة. ',
  },
};
```

- Produces: `node tools/check_edition.js` — exit 0 when clean, exit 1 listing `file:line: match`.
- Consumes: `BLUEPRINT.exam.code` (already in `data/blueprint.json`) replaces every hard-coded `OEEM` label in `js/app.js`; fallback text `Simulation` while the blueprint is not loaded.
- Produces for Task 3: `js/admin.js` no longer hard-codes `5093`; it reads the bank size once as the sum of `count` in `data/sections.json` (`BANK_SIZE`, 0 until loaded, and every percentage guards against 0).

- [ ] **Step 1: Write the failing check — `tools/check_edition.js`**

Scans every `git ls-files` path except `docs/superpowers/`, `data/`, binary files and itself. Fails on any match of:

```js
const BANNED = /oman(?!-em-prep\.[a-z-]+\d?['"`])|عُ?مان|OEEM|OMSB|ر\.ع|\+?968|Muscat|NOOR130|5,000|5093|ddqvtbvvxlqjahdhmfup|oman-em-prep\.sootnote/i;
```

(the look-ahead is the storage-key namespace the Global Constraints keep). It then loads `js/edition.js` in a `vm` context with a `window` stub and asserts: `manifest.json` `name === EDITION.appName` and `short_name === EDITION.shortName`; `<title>` of `index.html` and `admin.html` start with `EDITION.appName`; `apple-mobile-web-app-title` equals `EDITION.shortName`; both pages load `js/edition.js` before `js/config.js`.

- [ ] **Step 2: Run it to see it fail**

Run: `node tools/check_edition.js`
Expected: exit 1, ~49 matches plus "js/edition.js missing".

- [ ] **Step 3: Create `js/edition.js`** with the shape above (write `guideLearnText` as the existing slide text with «في قسم الطوارئ» replaced by «في عملك»).

- [ ] **Step 4: Point the engine at it.** Replace each listed literal in `js/app.js` and `js/admin.js` with the matching `EDITION` field (`PRICE_FULL`/`PRICE_PART` become `EDITION.priceFull`/`.pricePart`; every `ر.ع` label in `admin.js` becomes `EDITION.currency`; WhatsApp message templates use `EDITION.appName`). Replace `OEEM` labels with the blueprint code. Replace the four `5093` uses with `BANK_SIZE`. Edit `index.html`, `admin.html`, `manifest.json` text directly and add the `<script src="js/edition.js?v=1">` tag. In `tools/dev-server.js` use `+966` test phones, `ر.س` prices, a neutral bank name, promo code `START100`. Rename the `Oman EM Prep —` header comments to `Saudi Prep —`. In `supabase/003_plans.sql` the default prices become `199 ر.س` / `79 ر.س`; in `supabase/005_launch_offer.sql` the promo becomes `('START100', 'عرض الانطلاق', 45, 100)`.

- [ ] **Step 5: Run the check**

Run: `node tools/check_edition.js`
Expected: only `get/index.html` and `README.md`/`docs/admin-guide.md` matches remain (Tasks 4 and 5 clear them).

- [ ] **Step 6: Browser check on the dev server** (`preview_start` name `dev-2`): sign-up screen shows `Saudi Prep`, the new tagline and `+966` placeholder; payment screen shows `ر.س`; `admin.html` Payment tab placeholders and Analytics labels show `ر.س`; console has no errors.

- [ ] **Step 7: Commit** — `feat(edition): everything that names the country lives in one file`

---

### Task 3: The sample bank

**Files:**
- Create: `tools/make_sample.js` (one-off, kept as the record of how the sample was cut)
- Modify: `data/sections.json`, `data/blueprint.json`, `data/recalls.json`, `tools/validate_data.js`
- Delete: every file in `data/questions/` except `Medicine.json`, `Pediatrics.json`, `Surgery.json`, `OBGYN.json`

**Interfaces:**
- Consumes: `BANK_SIZE` logic from Task 2 (reads `count` from `sections.json`).
- Produces: a bank of 4 sections × 20 questions = 80, and a validator that also guards `count` and the blueprint.

- [ ] **Step 1: Extend `tools/validate_data.js` — three new failures**

  - `sections.json` `count` ≠ number of questions in the file → `fail("<file>: sections.json says <count>, file has <n>")`
  - a `blueprint.json` domain names a section id that is not in `sections.json` → `fail`
  - a milestone `size`, a simulation `size`, or `exam.questions` larger than the number of scored questions in the bank → `fail`

- [ ] **Step 2: Run it against the untouched Oman bank**

Run: `node tools/validate_data.js`
Expected: exit 0 (the Oman bank already satisfies all three — proves the new rules are not false alarms).

- [ ] **Step 3: Cut the sample — `tools/make_sample.js`**

For each of `Medicine`, `Pediatrics`, `Surgery`, `OBGYN`: keep the first 20 records, in file order, whose `correct_answer` is not null; write the file back with the records unchanged. Delete the other bank files. Rewrite `data/sections.json` to those four sections with `count: 20` (ids, names, `nameAr`, icons as today). Set `data/recalls.json` to `[]`.

- [ ] **Step 4: Run the validator to see it fail on the old blueprint**

Run: `node tools/validate_data.js`
Expected: exit 1 — unknown sections in blueprint domains, sizes 50/100 larger than the bank.

- [ ] **Step 5: Write the sample `data/blueprint.json`**

```json
{
  "exam": { "code": "SIM", "name": "Full Simulation", "nameAr": "محاكاة الاختبار", "authority": "", "source": "sample", "questions": 20, "minutes": 30, "format": "20 single best answer MCQs · 30m", "note": "Sample blueprint — replaced with the real one" },
  "milestoneTests": [
    { "id": 1, "unlockAt": 20, "size": 10, "minutes": 15, "mix": { "covered": 0.75, "fresh": 0.25 } },
    { "id": 2, "unlockAt": 40, "size": 10, "minutes": 15, "mix": { "covered": 0.75, "fresh": 0.25 } },
    { "id": 3, "unlockAt": 60, "size": 10, "minutes": 15, "mix": { "covered": 0.75, "fresh": 0.25 } }
  ],
  "simulations": [ { "id": 1, "unlockAtCoverage": 0.80, "size": 20, "minutes": 30, "seed": "saudi-sim-1-v1" } ],
  "domains": [
    { "name": "Medicine",   "weight": 25, "sections": ["medicine"] },
    { "name": "Pediatrics", "weight": 25, "sections": ["pediatrics"] },
    { "name": "Surgery",    "weight": 25, "sections": ["surgery"] },
    { "name": "OBGYN",      "weight": 25, "sections": ["obgyn"] }
  ]
}
```

- [ ] **Step 6: Validator passes**

Run: `node tools/validate_data.js`
Expected: `Sections: 4   Questions: 80   Scored: 80`, exit 0.

- [ ] **Step 7: Browser walk on the dev server (Review Focus 2)** with a dev-server test account: Home, Practice (4 sections), a section page, one study session to the end, the trial wall after 25 unique questions, the payment screen with both plans, Exams tab (3 milestones, 1 simulation labelled `SIM`), the recalls card absent from Home, `admin.html` coverage figures out of 80. If a 20-question checkpoint or any test cannot be built from 20 questions, record exactly which screen and fix it in the engine only if it crashes; a locked-forever test in the sample is acceptable and is noted in the handoff.

- [ ] **Step 8: Commit** — `feat(data): a four-section sample bank, and a validator that guards counts and the blueprint`

---

### Task 4: The landing page

**Files:**
- Modify: `get/index.html`
- Delete: `get/promo.mp4`, `get/promo-poster.jpg`

**Interfaces:**
- Consumes: app name and site host from Global Constraints (static HTML, typed in directly).

- [ ] **Step 1:** Replace all 16 Oman references: title, description and Open Graph tags, hero eyebrow, the brand name, the site host inside the SVG step drawings (`saudi-prep.sootnote.com`), the FAQ item and footer about OMSB (becomes: independent study tool, not affiliated with any examining body). Remove every bank-size number and the "Watch" promo section with its two files (the film is Oman-branded).
- [ ] **Step 2:** The six feature screenshots `get/f-*.jpg`, `get/app-home.jpg`, `get/signup.jpg` show the Oman app. Recapture them from the dev server with `resize_window` preset `mobile` after Tasks 2–3, same file names and dimensions.
- [ ] **Step 3: Run** `node tools/check_edition.js` — Expected: no `get/` matches.
- [ ] **Step 4: Browser check** at `/get/` on the dev server, mobile preset: no broken image, no Oman text, the primary button opens `/?start=signup`.
- [ ] **Step 5: Commit** — `feat(get): the landing page speaks for the Saudi edition`

---

### Task 5: The content kit for the owner

**Files:**
- Create: `docs/content-guide.md` (Arabic), `docs/content-template/sections.json`, `docs/content-template/questions/ExampleSubject.json`, `docs/content-template/blueprint.json`
- Modify: `README.md`, `docs/admin-guide.md`

**Interfaces:**
- Consumes: the record shape `tools/validate_data.js` accepts, and its three new rules from Task 3.

- [ ] **Step 1: `docs/content-guide.md`** — in Arabic, for a non-programmer: one file per subject; the fields of a question (`id` unique across the whole bank, `question`, `options` as `{ "A": …, "B": … }` with 2–8 options, `correct_answer` as a letter, `explanation` — "the explanation is the product"); the optional fields the Oman bank carries (`subject`, `topic`) ; how to list a subject in `sections.json` (`id` kebab-case English, `name`, `nameAr`, `icon`, `file`, `count`); how the blueprint weights sections; the one command to check everything (`node tools/validate_data.js`) and how to read its output; where to drop the files.
- [ ] **Step 2: The template files** — a two-question example subject, a matching `sections.json` and `blueprint.json`, valid as a set.
- [ ] **Step 3: Prove the template is valid** — copy the template over a scratch copy of `data/` and run the validator there. Expected: exit 0.
- [ ] **Step 4: `README.md`** — retitle for the Saudi edition, drop the Oman bank numbers, and add a short section "تحديث المحرّك من نسخة عُمان": `git fetch upstream && git merge upstream/main`, resolve, then `node tools/check_edition.js && node tools/validate_data.js` before any deploy (Review Focus 5). Update `docs/admin-guide.md` wording (currency, app name).
- [ ] **Step 5: Run** `node tools/check_edition.js` — Expected: exit 0, zero matches.
- [ ] **Step 6: Commit** — `docs(content): how to prepare a question bank for this edition`

---

### Task 6: The Saudi database

**Files:**
- Modify: `js/config.js`

**Interfaces:**
- Consumes: `supabase/schema.sql`, `002`…`006` as edited in Task 2.
- Produces: a live Supabase project URL and publishable key in `js/config.js`.

- [ ] **Step 1: Cost and room.** Supabase connector: `list_organizations`, `list_projects` (the free plan allows two active projects), `get_project` on `ddqvtbvvxlqjahdhmfup` for its region, `get_cost` for a new project.
- [ ] **Step 2 (OWNER): confirm the cost in chat.** Only after a yes: `confirm_cost` → `create_project` named `exam-saudi`, same region as Oman.
- [ ] **Step 3: Apply the schema** with `apply_migration`, one per file, in order: `schema`, `002_trial_paywall`, `003_plans`, `004_promo_referral`, `005_launch_offer`, `006_visits`.
- [ ] **Step 4: Verify.** `list_tables` shows `profiles`, `access_codes`, `progress`, `events`, `sessions_log`, `payment_settings`, `access_requests`, `promo_codes`, `visits`; `execute_sql`: `select price, part_price, referral_reward_signup, referral_reward_paid from payment_settings` → `199 ر.س | 79 ر.س | 30 | 350`; `select code, reward_questions, max_uses from promo_codes` → `START100 | 45 | 100`; `select id, public from storage.buckets` → `receipts | false`; `get_advisors` (security) has no new error-level finding beyond what the Oman project shows.
- [ ] **Step 5:** `get_project_url` + `get_publishable_keys` → write both into `js/config.js`, bump `config.js?v=` in `index.html` and `admin.html`. Commit — `feat(backend): the Saudi edition gets its own database`.
- [ ] **Step 6 (OWNER, dashboard):** Authentication → Sign In / Providers → Email → turn **Confirm email** off (it was the cause of the "محاولات كثيرة" signup failures on Oman). Verify from outside: `GET <url>/auth/v1/settings` with the publishable key shows `"mailer_autoconfirm": true`.
- [ ] **Step 7 (OWNER) — before the link is shared (Review Focus 4):** the owner signs up first on the deployed site (Task 7). Then `execute_sql`: `select email, role from profiles order by created_at limit 1` → the owner's email, `admin`.

---

### Task 7: The site

**Files:**
- Create: `tools/.deploy-upload.json` (gitignored, deleted after the upload)

**Interfaces:**
- Consumes: the deploy procedure already written in memory `hostinger-deploy` (stage → `tar.exe` zip naming `.htaccess` explicitly → `tools/hostinger-upload.sh` → `hosting_websites_deploy-static-site-archive` → `hosting_cache_clear-website`), hosting username `u608692420`.

- [ ] **Step 1 (OWNER): yes to creating the subdomain.** Then find the Hostinger operation with the connector's `search` ("subdomain") and create `saudi-prep.sootnote.com`; poll until it answers.
- [ ] **Step 2: Gate.** `node tools/check_edition.js && node tools/validate_data.js` → both exit 0.
- [ ] **Step 3: Stage and upload** exactly as in `hostinger-deploy`, with `domain=saudi-prep.sootnote.com`. Running `bash tools/hostinger-upload.sh` from the new folder will ask for permission once.
- [ ] **Step 4: Verify from outside, plain URLs.** `/`, `/get/`, `/admin.html`, `/js/edition.js`, `/data/sections.json` answer 200 and equal the working tree (`tr -d '\r'` before comparing); the page contains no `oman`; in the browser at mobile size: sign-up screen renders, no console errors, a `landing` → `app_open` → `auth_view` trail lands in the **new** project's `public.visits` and nothing new appears in Oman's.
- [ ] **Step 5:** Task 6 Step 7 (owner's first signup = admin), then the owner fills the Payment tab.
- [ ] **Step 6:** Push `main` to `origin`. Write memory `saudi-edition` (folder, repo, project ref, site, what is placeholder, what the owner still owes) and add it to `MEMORY.md`.

---

## What stays open after this plan

- The exam's real name, audience wording (the UI says «طبيب» / "doctor" throughout) and logo — one pass over `js/edition.js` and the static pages once the owner names the exam.
- Real prices, real promo code, payment details — admin Payment and Growth tabs.
- The real bank and blueprint — owner prepares them with `docs/content-guide.md`; swapping them in is Task 3 again with their files.
- Promo film and final landing screenshots — after the real content.
