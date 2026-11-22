#!/usr/bin/env node
/*
 * Question bank checker.
 * Run from the project folder:   node tools/validate-questions.js
 *
 * Checks every course file in js/questions/ for:
 *  - at least MIN_QUESTIONS questions
 *  - exactly 4 non-empty, different options
 *  - a valid answer index (0 to 3)
 *  - a non-empty explanation and topic
 *  - unique, well formed IDs (e.g. PHC-001)
 *  - banned option text ("All of the above", "None of the above", "A and B" ...)
 *  - em dashes (not allowed anywhere in the UI)
 *  - identical and near-duplicate questions (same question reworded, or the
 *    same fact tested twice). Similar pairs are printed so you can replace one.
 *
 * Exit code 1 if any hard error or near duplicate is found.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const MIN_QUESTIONS = 300;
const DIR = path.join(__dirname, '..', 'js', 'questions');
const SIM_QUESTION = 0.72;   // question text similarity that counts as a near duplicate
const SIM_FACT = 0.6;        // question + correct answer similarity (same fact tested twice)

// Pairs a human has reviewed and confirmed test DIFFERENT facts even though the
// wording looks alike (e.g. Boyle's law vs Charles' law). Add "ID1|ID2" here
// after checking a flagged pair yourself.
const REVIEWED_DIFFERENT = new Set([
  'AUM-008|AUM-009', // pharmacokinetics vs pharmacodynamics
  'AUM-061|AUM-062', // synergism vs additive effect
  'CHM-251|CHM-252', 'CHM-251|CHM-253', 'CHM-252|CHM-253', // Boyle, Charles, pressure law
  'GNS-176|GNS-177', // definition of interjection vs identifying one
  'GNS-207|GNS-218', // who an informal letter is for vs where the date goes
  'GNS-227|GNS-228', // phrase vs clause
  'GNS-239|GNS-240', // complex vs compound-complex sentence
  'GNS-293|GNS-304', // "here" vs "can" in reported speech
  'PHC-094|PHC-095', // secondary vs tertiary tier
  'PHC-268|PHC-279'  // a committee function vs a non-function
]);

const STOP = new Set(('a an the of to in on at for and or but is are was were be been being which what who whom whose ' +
  'that this these those it its as by with from into than then there their they them following best ' +
  'mainly usually commonly called known does do did has have had can could may might should would will ' +
  'shall choose correct option sentence word words used use one two not most often also each when how ' +
  'about after before because while between more less very such so if i you he she we our your his her').split(' '));

function tokens(s) {
  return s.toLowerCase()
    .replace(/[^a-z0-9²³¹⁰-₟+\-]+/g, ' ')
    .split(/\s+/)
    .filter(w => w && !STOP.has(w))
    .map(w => w.replace(/(ies|es|s)$/, ''));
}
function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach(x => { if (B.has(x)) inter++; });
  return inter / (A.size + B.size - inter);
}

const sandbox = { window: {} };
vm.createContext(sandbox);
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.js')).sort();
files.forEach(f => vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), sandbox, { filename: f }));
const banks = sandbox.window.QUESTION_BANKS || {};

let errors = 0, warnings = 0;
const err = (m) => { errors++; console.log('  ERROR   ' + m); };
const warn = (m) => { warnings++; console.log('  SIMILAR ' + m); };
const banned = /\b(all of the above|none of the above|both (a|b|c|d) and|a and b|b and c|all of these|none of these)\b/i;

const allIds = new Set();
Object.keys(banks).forEach(code => {
  const bank = banks[code];
  const qs = bank.questions || [];
  console.log(`\n${code} (${bank.title}): ${qs.length} questions`);
  if (qs.length < MIN_QUESTIONS) err(`only ${qs.length} questions, need at least ${MIN_QUESTIONS}`);

  const topics = {};
  qs.forEach((x, i) => {
    const where = x.id || `#${i + 1}`;
    if (!x.id || !new RegExp('^' + code + '-\\d{3,}$').test(x.id)) err(`${where}: bad id`);
    if (allIds.has(x.id)) err(`${where}: duplicate id`);
    allIds.add(x.id);
    if (!x.topic) err(`${where}: missing topic`);
    topics[x.topic] = (topics[x.topic] || 0) + 1;
    if (!x.q || x.q.length < 10) err(`${where}: question text missing or too short`);
    if (!Array.isArray(x.options) || x.options.length !== 4) err(`${where}: must have exactly 4 options`);
    else {
      if (x.options.some(o => !o || !String(o).trim())) err(`${where}: empty option`);
      const norm = x.options.map(o => String(o).trim().toLowerCase());
      if (new Set(norm).size !== 4) err(`${where}: two options are the same`);
      if (x.options.some(o => banned.test(o))) err(`${where}: uses a banned option like "All of the above"`);
    }
    if (!Number.isInteger(x.answer) || x.answer < 0 || x.answer > 3) err(`${where}: answer must be 0, 1, 2 or 3`);
    if (!x.explain || x.explain.length < 5) err(`${where}: missing explanation`);
    if (/—/.test(JSON.stringify(x))) err(`${where}: contains an em dash`);
  });
  console.log('  Topics: ' + Object.entries(topics).map(([t, n]) => `${t} (${n})`).join(', '));

  // Duplicate and near-duplicate detection
  const prepared = qs.map(x => ({
    id: x.id,
    qt: tokens(x.q),
    ft: tokens(x.q + ' ' + (x.options ? x.options[x.answer] : '')),
    exact: x.q.toLowerCase().replace(/\s+/g, ' ').trim(),
    ans: x.options ? String(x.options[x.answer]).toLowerCase().trim() : ''
  }));
  const seenText = {};
  prepared.forEach(p => {
    if (seenText[p.exact]) err(`${p.id}: identical question text to ${seenText[p.exact]}`);
    else seenText[p.exact] = p.id;
  });
  for (let i = 0; i < prepared.length; i++) {
    for (let j = i + 1; j < prepared.length; j++) {
      const a = prepared[i], b = prepared[j];
      const sq = jaccard(a.qt, b.qt);
      const sf = jaccard(a.ft, b.ft);
      const sameAnswer = a.ans.length > 3 && a.ans === b.ans;
      if (REVIEWED_DIFFERENT.has(a.id + '|' + b.id)) continue;
      if (sq >= SIM_QUESTION || sf >= SIM_FACT || (sameAnswer && sq >= 0.45)) {
        warn(`${a.id} ~ ${b.id}  (question ${sq.toFixed(2)}, fact ${sf.toFixed(2)}${sameAnswer ? ', same answer' : ''})`);
      }
    }
  }
});

console.log(`\nTotal: ${allIds.size} questions in ${Object.keys(banks).length} courses. ${errors} error(s), ${warnings} near-duplicate pair(s).`);
process.exit(errors || warnings ? 1 : 0);
