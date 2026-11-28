// Exam engine simulation tests:  node engine.test.cjs
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
const sandbox = { window: {}, console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ['js/config.js', 'js/questions/gns.js', 'js/questions/phc.js', 'js/questions/chm.js', 'js/questions/aum.js', 'js/questions/phy.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}
const E = require(path.join(root, 'js/engine.js'));
const CFG = sandbox.window.CBT_CONFIG;
const BANKS = {};
const QMAP = {};
const COURSES = CFG.courses;
for (const c of COURSES) {
  BANKS[c.code] = sandbox.window.QUESTION_BANKS[c.code].questions;
  for (const q of BANKS[c.code]) QMAP[q.id] = q;
}
const PER = CFG.questionsPerCourse;
let passed = 0;
function t(name, fn) { fn(); passed++; console.log('  ok   ' + name); }

console.log(`Banks: ${COURSES.map(c => `${c.code}=${BANKS[c.code].length}`).join(', ')}; ${PER} per course\n`);

// ---------- one student, many attempts ----------
console.log('One student taking repeated exams');
let seen = {};
const history = {}; // code -> list of ids in order seen
COURSES.forEach(c => { history[c.code] = []; });
const exams = [];
for (let a = 1; a <= 8; a++) {
  const built = E.buildExam(COURSES, BANKS, seen, PER);
  seen = built.seen;
  exams.push(built);
  built.sections.forEach(s => history[s.code].push(...s.items.map(i => i.id)));
}

t('every exam has exactly 45 questions per course (all 5 courses = 225)', () => {
  for (const ex of exams) {
    assert.strictEqual(ex.sections.length, COURSES.length);
    ex.sections.forEach(s => assert.strictEqual(s.items.length, PER));
    assert.strictEqual(ex.sections.reduce((n, s) => n + s.items.length, 0), PER * COURSES.length);
  }
});

t('no question appears twice inside the same exam', () => {
  for (const ex of exams) ex.sections.forEach(s => assert.strictEqual(new Set(s.items.map(i => i.id)).size, s.items.length));
});

t('courses are never mixed (each section only has its own course questions)', () => {
  for (const ex of exams) ex.sections.forEach(s => s.items.forEach(i => assert.ok(i.id.startsWith(s.code + '-'))));
});

t('5 attempts: no question repeats across attempts (courses with 300+ questions)', () => {
  for (const c of COURSES.filter(c => BANKS[c.code].length >= PER * 5)) {
    const first5 = history[c.code].slice(0, PER * 5);
    assert.strictEqual(new Set(first5).size, first5.length, c.code + ' repeated a question within 5 attempts');
  }
});

t('no repeats at all until the whole bank has been seen, then a new cycle starts', () => {
  for (const c of COURSES) {
    const n = BANKS[c.code].length;
    const h = history[c.code];
    const full = Math.floor(n / PER);            // exams that fit completely inside the first cycle
    const before = h.slice(0, full * PER);
    assert.strictEqual(new Set(before).size, before.length, c.code + ': repeat before the bank was used up');
    // The next exam must use up every remaining unseen question, so after it the whole bank has been seen.
    const through = new Set(h.slice(0, (full + 1) * PER));
    assert.strictEqual(through.size, n, c.code + ': whole bank should be covered by exam ' + (full + 1));
    assert.ok(h.length > n, 'simulation should go past one full cycle');
  }
});

t('the exam that crosses the end of the bank has no duplicates and seen list resets', () => {
  for (const c of COURSES) {
    const n = BANKS[c.code].length;
    const examsToFinish = Math.ceil(n / PER);
    const crossing = exams[examsToFinish - 1].sections.find(s => s.code === c.code);
    assert.strictEqual(new Set(crossing.items.map(i => i.id)).size, PER);
  }
  // after 8 exams of 45 = 360 questions, every bank has been used up at least once
  for (const c of COURSES) {
    const expected = Math.floor((8 * PER) / BANKS[c.code].length);
    assert.strictEqual(seen[c.code].cycle, expected, c.code + ' cycle');
  }
});

t('in the new cycle, questions from the new cycle do not repeat either', () => {
  for (const c of COURSES) {
    const ids = seen[c.code].ids;
    assert.strictEqual(new Set(ids).size, ids.length);
  }
});

t('questions are spread evenly across topics in every exam', () => {
  // check the first exam (full bank available)
  const ex = exams[0];
  for (const s of ex.sections) {
    const counts = {};
    s.items.forEach(i => { const tp = QMAP[i.id].topic; counts[tp] = (counts[tp] || 0) + 1; });
    const topics = new Set(BANKS[s.code].map(q => q.topic));
    assert.strictEqual(Object.keys(counts).length, Math.min(topics.size, PER), s.code + ' should cover every topic');
    // Even spread: a topic may only have 2+ more questions than another if that other topic has run out.
    const size = {};
    BANKS[s.code].forEach(q => { size[q.topic] = (size[q.topic] || 0) + 1; });
    for (const a of Object.keys(counts)) for (const b of Object.keys(counts)) {
      if (counts[a] > counts[b] + 1) assert.strictEqual(counts[b], size[b], s.code + ' topic spread ' + JSON.stringify(counts));
    }
  }
});

t('question order is shuffled (not grouped by topic)', () => {
  const s = exams[0].sections[0];
  const topics = s.items.map(i => QMAP[i.id].topic);
  let switches = 0;
  for (let i = 1; i < topics.length; i++) if (topics[i] !== topics[i - 1]) switches++;
  assert.ok(switches > topics.length / 2, 'too few topic switches: ' + switches);
});

t('option order is a valid shuffle of A to D and varies between questions', () => {
  const perms = new Set();
  exams[0].sections.forEach(s => s.items.forEach(i => {
    assert.deepStrictEqual([...i.perm].sort(), [0, 1, 2, 3]);
    perms.add(i.perm.join(''));
  }));
  assert.ok(perms.size >= 15, 'only ' + perms.size + ' distinct option orders in 180 questions');
});

t('Physics (98 questions from the class file) starts over after the bank is used up', () => {
  const h = history.PHY, n = BANKS.PHY.length;
  assert.strictEqual(n, 98);
  assert.strictEqual(new Set(h.slice(0, 2 * PER)).size, 2 * PER, 'repeat inside the first 90');
  assert.strictEqual(new Set(h.slice(0, 3 * PER)).size, n, 'exam 3 must finish the remaining 8, then start over');
  for (const ex of exams) {
    const s = ex.sections.find(x => x.code === 'PHY');
    assert.strictEqual(new Set(s.items.map(i => i.id)).size, PER, 'duplicate inside one Physics exam');
  }
});

console.log('\nChoosing courses');
t('an exam with only the chosen courses (e.g. PHY alone, or GNS + CHM)', () => {
  const only = E.buildExam(COURSES.filter(c => c.code === 'PHY'), BANKS, {}, PER);
  assert.deepStrictEqual(only.sections.map(s => s.code), ['PHY']);
  assert.deepStrictEqual(Object.keys(only.seen), ['PHY']);
  const two = E.buildExam(COURSES.filter(c => ['GNS', 'CHM'].includes(c.code)), BANKS, {}, PER);
  assert.deepStrictEqual(two.sections.map(s => s.code), ['GNS', 'CHM']);
});

// ---------- two different students ----------
console.log('\nTwo different students');
const s1 = E.buildExam(COURSES, BANKS, {}, PER);
const s2 = E.buildExam(COURSES, BANKS, {}, PER);
t('two students get mostly different questions', () => {
  for (let k = 0; k < COURSES.length; k++) {
    const a = new Set(s1.sections[k].items.map(i => i.id));
    const shared = s2.sections[k].items.filter(i => a.has(i.id)).length;
    // Expected overlap of two random 45-question picks is 45*45/bank (about 7 for 300, about 21 for Physics' 98).
    const expected = PER * PER / BANKS[COURSES[k].code].length;
    assert.ok(shared <= expected * 1.8 + 5, COURSES[k].code + ' shared ' + shared);
    console.log(`       ${COURSES[k].code}: ${shared} of ${PER} questions in common`);
  }
});
t('a shared question appears in a different position and/or option order', () => {
  let shared = 0, same = 0;
  for (let k = 0; k < COURSES.length; k++) {
    const pos1 = {};
    s1.sections[k].items.forEach((it, i) => { pos1[it.id] = { i, p: it.perm.join('') }; });
    s2.sections[k].items.forEach((it, i) => {
      if (pos1[it.id]) { shared++; if (pos1[it.id].i === i && pos1[it.id].p === it.perm.join('')) same++; }
    });
  }
  assert.ok(shared > 0);
  assert.ok(same <= 1, same + ' of ' + shared + ' shared questions were identical in position and option order');
});

// ---------- marking ----------
console.log('\nMarking');
t('all correct answers score 225/225 (100%)', () => {
  const ex = s1;
  const answers = {};
  ex.sections.forEach(s => { answers[s.code] = {}; s.items.forEach((it, i) => { answers[s.code][i] = it.perm.indexOf(QMAP[it.id].answer); }); });
  const m = E.markExam(ex.sections, answers, id => QMAP[id]);
  assert.strictEqual(m.score, PER * COURSES.length); assert.strictEqual(m.pct, 100);
});
t('blank script scores 0 with everything skipped', () => {
  const m = E.markExam(s1.sections, {}, id => QMAP[id]);
  assert.strictEqual(m.score, 0); assert.strictEqual(m.perCourse.GNS.skipped, PER);
});
t('mixed script: 10 right, 5 wrong per course gives 50/225 = 22.2%', () => {
  const answers = {};
  s1.sections.forEach(s => {
    answers[s.code] = {};
    s.items.forEach((it, i) => {
      const right = it.perm.indexOf(QMAP[it.id].answer);
      if (i < 10) answers[s.code][i] = right;
      else if (i < 15) answers[s.code][i] = (right + 1) % 4;
    });
  });
  const m = E.markExam(s1.sections, answers, id => QMAP[id]);
  assert.strictEqual(m.score, 50); assert.strictEqual(m.pct, 22.2);
  assert.deepStrictEqual(m.perCourse.PHC, { score: 10, total: PER, wrong: 5, skipped: PER - 15 });
});

// ---------- seen merging (Firestore copy + phone backup) ----------
console.log('\nMerging seen lists from two phones');
t('same cycle: lists are combined; higher cycle wins', () => {
  const m = E.mergeSeen({ GNS: { cycle: 0, ids: ['a', 'b'] }, PHC: { cycle: 1, ids: ['x'] } }, { GNS: { cycle: 0, ids: ['b', 'c'] }, PHC: { cycle: 0, ids: ['y', 'z'] } });
  assert.deepStrictEqual(m.GNS, { cycle: 0, ids: ['a', 'b', 'c'] });
  assert.deepStrictEqual(m.PHC, { cycle: 1, ids: ['x'] });
});
t('questions removed from a bank are ignored when picking', () => {
  const r = E.pickForCourse(BANKS.GNS, { cycle: 0, ids: ['GNS-999', 'OLD-1'] }, PER);
  assert.strictEqual(r.questions.length, PER);
  assert.ok(!r.seen.ids.includes('OLD-1'));
});

console.log(`\n${passed} passed`);
