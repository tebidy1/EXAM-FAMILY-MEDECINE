#!/usr/bin/env node
/* ============================================================
   Data validator — run before publishing any question bank:
     node tools/validate_data.js
   Accepts the bank's native record shape:
     options: ["..",".."] OR { "A":"..", "B":".." }
     correct_answer: letter ("B") | index (1) | null (self-scored)
   Exit code 0 = bank is clean and ready.
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_ROOT = path.resolve(ROOT, 'data');     // file paths must stay inside here
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const CTRL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

const errors = [];
const warn = [];
const seenIds = new Map();
let total = 0, scored = 0, selfScored = 0;

function fail(msg) { errors.push(msg); }
function warnMsg(msg) { warn.push(msg); }

function safeDataPath(rel) {
  const target = path.resolve(DATA_ROOT, rel || '_');
  return target === DATA_ROOT || target.startsWith(DATA_ROOT + path.sep) ? target : null;
}

let sections;
try {
  sections = JSON.parse(fs.readFileSync(path.join(DATA_ROOT, 'sections.json'), 'utf8')).sections;
} catch (e) {
  console.error('FATAL: data/sections.json is missing or invalid JSON:', e.message);
  process.exit(1);
}

const sectionIds = new Set();
for (const s of sections) {
  if (!s.id || !/^[a-z0-9-]+$/.test(s.id)) fail(`Section id "${s.id}" is missing or not kebab-case`);
  if (sectionIds.has(s.id)) fail(`Duplicate section id "${s.id}"`);
  sectionIds.add(s.id);
  if (!s.name) fail(`Section "${s.id}" has no name`);
  if (!s.file) fail(`Section "${s.id}" has no file`);
}

for (const s of sections) {
  const file = safeDataPath(path.relative(DATA_ROOT, path.resolve(ROOT, s.file || '_')));
  if (!file) { fail(`${s.file}: path escapes the data/ directory — skipped`); continue; }
  let questions;
  try {
    questions = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    fail(`${s.file}: invalid JSON (${e.message})`);
    continue;
  }
  if (!Array.isArray(questions)) { fail(`${s.file}: expected an array of questions`); continue; }
  if (questions.length === 0) warnMsg(`${s.file}: section "${s.id}" has 0 questions`);
  let noAnswer = 0;

  questions.forEach((raw, i) => {
    total += 1;
    const at = `${s.file}#${i}`;

    if (raw.id == null) { fail(`${at}: missing "id"`); return; }
    const uid = String(raw.id);
    if (seenIds.has(uid)) fail(`${at}: duplicate question id "${uid}" (also in ${seenIds.get(uid)})`);
    seenIds.set(uid, s.file);

    if (!raw.question || !String(raw.question).trim()) fail(`${at} (${uid}): missing "question"`);

    // options: array OR letter-keyed object
    let opts;
    if (Array.isArray(raw.options)) opts = raw.options;
    else if (raw.options && typeof raw.options === 'object') {
      opts = LETTERS.map((L) => raw.options[L]).filter((x) => x != null && String(x).trim() !== '');
      const nKeys = Object.keys(raw.options).length;
      if (nKeys !== opts.length) warnMsg(`${at} (${uid}): options object has ${nKeys} keys, ${opts.length} usable (empty values skipped)`);
    } else {
      fail(`${at} (${uid}): "options" must be an array or a letter-keyed object`);
      return;
    }
    if (opts.length < 2 || opts.length > LETTERS.length) {
      fail(`${at} (${uid}): expected 2–${LETTERS.length} options, found ${opts.length}`);
      return;
    }

    // correct_answer: letter | index | null
    if (raw.correct_answer == null || raw.correct_answer === '') {
      noAnswer += 1;
      selfScored += 1;
      if (!raw.explanation) warnMsg(`${at} (${uid}): no answer AND no explanation — question is unusable`);
    } else {
      scored += 1;
      const asLetter = LETTERS.indexOf(String(raw.correct_answer).trim().toUpperCase());
      const asIndex = Number.isInteger(raw.correct_answer) ? raw.correct_answer : -1;
      const valid = (asLetter > -1 && asLetter < opts.length) || (asIndex >= 0 && asIndex < opts.length);
      if (!valid) fail(`${at} (${uid}): correct_answer "${raw.correct_answer}" outside options range (${opts.length} options)`);
      // cross-check the optional answer text
      if (raw.correct_answer_text && asLetter > -1) {
        const opt = String(opts[asLetter]).trim().toLowerCase();
        const txt = String(raw.correct_answer_text).trim().toLowerCase();
        if (opt && txt && opt !== txt && !opt.includes(txt) && !txt.includes(opt)) {
          warnMsg(`${at} (${uid}): correct_answer_text "${raw.correct_answer_text}" does not match option ${raw.correct_answer}`);
        }
      }
    }

    if (!raw.explanation) warnMsg(`${at} (${uid}): no "explanation" — the explanation is the product, do not skip it`);
    if (String(raw.question ?? '').length > 4000) warnMsg(`${at} (${uid}): question longer than 4000 chars — check for extraction artifacts`);
    if (CTRL_CHARS.test(String(raw.explanation ?? '') + String(raw.question ?? ''))) {
      warnMsg(`${at} (${uid}): contains PDF control characters (the app cleans these at load)`);
      CTRL_CHARS.lastIndex = 0;
    }
  });

  console.log(`  ${String(s.id).padEnd(22)} ${String(questions.length).padStart(4)} questions · ${questions.length - noAnswer} scored · ${noAnswer} self-scored`);
}

console.log(`\nSections: ${sections.length}   Questions: ${total}   Scored: ${scored}   Self-scored: ${selfScored}`);
if (warn.length) {
  console.log(`\nWarnings (${warn.length}) — first 20:`);
  warn.slice(0, 20).forEach((w) => console.log(`  ⚠ ${w}`));
  if (warn.length > 20) console.log(`  … and ${warn.length - 20} more`);
}
if (errors.length) {
  console.log(`\nErrors (${errors.length}) — first 30:`);
  errors.slice(0, 30).forEach((e) => console.log(`  ✗ ${e}`));
  if (errors.length > 30) console.log(`  … and ${errors.length - 30} more`);
  process.exit(1);
}
console.log('\n✔ Question bank is valid — safe to publish.');
