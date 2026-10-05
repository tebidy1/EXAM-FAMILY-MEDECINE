#!/usr/bin/env node
/* ============================================================
   One-off: cut the sample bank this edition started with.
     node tools/make_sample.js
   Keeps four sections of the bank this repository was copied from, and
   in each the first PER_SECTION questions (file order) that carry an
   answer; deletes the other bank files and rewrites data/sections.json.
   Kept as the record of how the sample was made. Running it again on the
   sample changes nothing; it is not needed once the real bank is in.
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
const KEEP = ['medicine', 'pediatrics', 'surgery', 'obgyn'];
const PER_SECTION = 20;

const manifestPath = path.join(DATA, 'sections.json');
const all = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).sections;
const kept = KEEP.map((id) => {
  const s = all.find((x) => x.id === id);
  if (!s) throw new Error(`section "${id}" is not in data/sections.json`);
  return s;
});

const keptFiles = new Set();
for (const s of kept) {
  const file = path.join(DATA, '..', s.file);
  const sample = JSON.parse(fs.readFileSync(file, 'utf8'))
    .filter((q) => q.correct_answer != null && q.correct_answer !== '')
    .slice(0, PER_SECTION);
  fs.writeFileSync(file, JSON.stringify(sample, null, 1) + '\n');
  s.count = sample.length;
  keptFiles.add(path.resolve(file));
  console.log(`  ${s.id.padEnd(12)} ${sample.length} questions`);
}

const qDir = path.join(DATA, 'questions');
for (const name of fs.readdirSync(qDir)) {
  const full = path.resolve(qDir, name);
  if (fs.statSync(full).isFile() && !keptFiles.has(full)) fs.unlinkSync(full);
}

fs.writeFileSync(manifestPath, JSON.stringify({ sections: kept }, null, 2) + '\n');
fs.writeFileSync(path.join(DATA, 'recalls.json'), '[]\n');
console.log(`Sample bank: ${kept.length} sections.`);
