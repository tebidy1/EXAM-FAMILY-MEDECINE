#!/usr/bin/env node
/* ============================================================
   Edition check — run before every deploy, and after every merge
   from the Oman repository:
     node tools/check_edition.js
   This copy of the engine serves another country. The check fails if
   any tracked file still names Oman, its exam, its currency, its phone
   prefix, its bank-size claims or its database, and if the static pages
   disagree with js/edition.js about the app's name.
   Exit code 0 = nothing of the other edition is left.
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
// storage keys ('oman-em-prep.v1', '.theme', …) stay: invisible, scoped to the
// origin, and renaming them only makes merges from the Oman repository conflict
const BANNED = /oman(?!-em-prep\.[a-z-]+\d?['"`])|عُ?مان|OEEM|OMSB|ر\.ع|\+?968|Muscat|NOOR130|5,000|5093|ddqvtbvvxlqjahdhmfup|oman-em-prep\.sootnote/i;
const SKIP = [/^docs\/superpowers\//, /^data\//, /^tools\/check_edition\.js$/];
const BINARY = /\.(png|jpe?g|gif|webp|ico|mp4|webm|woff2?|ttf|zip|pdf)$/i;

const errors = [];
const fail = (msg) => errors.push(msg);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const files = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)
  .filter((f) => !BINARY.test(f) && !SKIP.some((re) => re.test(f)) && fs.existsSync(path.join(ROOT, f)));

for (const f of files) {
  read(f).split('\n').forEach((line, i) => {
    const m = BANNED.exec(line);
    if (m) fail(`${f}:${i + 1}: "${m[0]}"`);
  });
}

// ---- the static pages cannot read js/edition.js: they must agree with it ----
let EDITION = null;
try {
  const ctx = { window: {} };
  vm.runInNewContext(read('js/edition.js'), ctx);
  EDITION = ctx.window.EDITION;
} catch (e) { /* reported just below */ }

if (!EDITION || !EDITION.appName) {
  fail('js/edition.js is missing or does not set window.EDITION.appName');
} else {
  const manifest = JSON.parse(read('manifest.json'));
  if (manifest.name !== EDITION.appName) fail(`manifest.json: name "${manifest.name}" ≠ EDITION.appName "${EDITION.appName}"`);
  if (manifest.short_name !== EDITION.shortName) fail(`manifest.json: short_name "${manifest.short_name}" ≠ EDITION.shortName "${EDITION.shortName}"`);

  for (const page of ['index.html', 'admin.html']) {
    const html = read(page);
    const title = (/<title>([^<]*)<\/title>/.exec(html) || [])[1] || '';
    if (!title.startsWith(EDITION.appName)) fail(`${page}: <title> "${title}" does not start with "${EDITION.appName}"`);
    const ed = html.indexOf('js/edition.js');
    const cfg = html.indexOf('js/config.js');
    if (ed === -1) fail(`${page}: does not load js/edition.js`);
    else if (cfg !== -1 && ed > cfg) fail(`${page}: js/edition.js must load before js/config.js`);
  }
  const apple = (/apple-mobile-web-app-title" content="([^"]*)"/.exec(read('index.html')) || [])[1];
  if (apple !== EDITION.shortName) fail(`index.html: apple-mobile-web-app-title "${apple}" ≠ EDITION.shortName "${EDITION.shortName}"`);
}

if (errors.length) {
  console.log(`Edition check failed (${errors.length}):`);
  errors.forEach((e) => console.log(`  ✗ ${e}`));
  process.exit(1);
}
console.log(`✔ Edition "${EDITION.id}" is clean — ${files.length} files checked.`);
