// Firestore security rules tests. Run with the emulator:
//   cd tests && npm install && npm run rules
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp, collection, query, orderBy,
  limit, getDocs, getCountFromServer, where
} from 'firebase/firestore';

const dir = path.dirname(fileURLToPath(import.meta.url));
const env = await initializeTestEnvironment({
  projectId: 'demo-cbt',
  firestore: { rules: fs.readFileSync(path.join(dir, '..', 'firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8080 }
});
await env.clearFirestore();
const db = env.unauthenticatedContext().firestore();

let passed = 0, failed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

function newStudent(extra = {}) {
  const now = serverTimestamp();
  return Object.assign({
    name: 'Amina Bello', matric: 'UG/24/0001', hasPin: false, attempts: 0, bestPct: 0, bestScore: 0, bestTotal: 0,
    lastPct: 0, lastExamId: '', bestAt: now, createdAt: now, updatedAt: now
  }, extra);
}
// Same shape as store.js submitAttempt()
async function submit(sid, cur, r, opts = {}) {
  const n = opts.n ?? cur.attempts + 1;
  const improved = r.pct > cur.bestPct;
  const upd = Object.assign({ attempts: n, lastPct: r.pct, lastExamId: r.examId, updatedAt: serverTimestamp() },
    improved ? { bestPct: r.pct, bestScore: r.score, bestTotal: r.total, bestAt: serverTimestamp() } : {}, opts.override || {});
  const b = writeBatch(db);
  b.update(doc(db, 'students', sid), upd);
  if (!opts.skipAttempt) {
    b.set(doc(db, 'attempts', opts.attemptId || `${sid}_${n}`), Object.assign({
      sid, name: cur.name, matric: cur.matric, score: r.score, total: r.total, pct: r.pct,
      perCourse: { GNS: { score: r.score, total: r.total, wrong: 0, skipped: 0 } }, timeUsedSec: 600, examId: r.examId,
      createdAt: serverTimestamp()
    }, opts.attemptOverride || {}));
  }
  return b.commit();
}
async function read(sid) { return (await getDoc(doc(db, 'students', sid))).data(); }

console.log('\nSign up');
await t('valid sign up is allowed', () => assertSucceeds(setDoc(doc(db, 'students', 'UG_24_0001'), newStudent())));
await t('sign up with a non-zero score is rejected', () => assertFails(setDoc(doc(db, 'students', 'UG_24_0002'), newStudent({ bestPct: 90 }))));
await t('sign up with attempts already set is rejected', () => assertFails(setDoc(doc(db, 'students', 'UG_24_0003'), newStudent({ attempts: 3 }))));
await t('sign up with extra fields is rejected', () => assertFails(setDoc(doc(db, 'students', 'UG_24_0004'), newStudent({ admin: true }))));
await t('sign up with a missing field is rejected', async () => {
  const s = newStudent(); delete s.lastExamId;
  await assertFails(setDoc(doc(db, 'students', 'UG_24_0005'), s));
});
await t('sign up with a client clock time instead of server time is rejected', () =>
  assertFails(setDoc(doc(db, 'students', 'UG_24_0006'), newStudent({ createdAt: new Date() }))));
await t('signing up again over an existing matric is rejected', () =>
  assertFails(setDoc(doc(db, 'students', 'UG_24_0001'), newStudent({ name: 'Someone Else' }))));

console.log('\nReading the leaderboard');
await t('anyone can read the leaderboard query', () =>
  assertSucceeds(getDocs(query(collection(db, 'students'), orderBy('bestPct', 'desc'), limit(100)))));
await t('anyone can run the rank count queries', async () => {
  await assertSucceeds(getCountFromServer(query(collection(db, 'students'), where('bestPct', '>', 50))));
  await assertSucceeds(getCountFromServer(query(collection(db, 'students'), where('attempts', '>', 0))));
});

console.log('\nSubmitting attempts');
let cur = await read('UG_24_0001');
await t('first submission (attempt + new best) is allowed', () => assertSucceeds(submit('UG_24_0001', cur, { score: 120, total: 180, pct: 66.7, examId: 'ex1' })));
cur = await read('UG_24_0001');
await t('attempts became 1 and best became 66.7', async () => { if (cur.attempts !== 1 || cur.bestPct !== 66.7 || cur.bestScore !== 120) throw new Error(JSON.stringify(cur)); });
await t('a lower score keeps the best unchanged', () => assertSucceeds(submit('UG_24_0001', cur, { score: 90, total: 180, pct: 50, examId: 'ex2' })));
cur = await read('UG_24_0001');
await t('best still 66.7 after a lower score, attempts 2', async () => { if (cur.attempts !== 2 || cur.bestPct !== 66.7) throw new Error(JSON.stringify(cur)); });
await t('attempts cannot jump by 2', () => assertFails(submit('UG_24_0001', cur, { score: 100, total: 180, pct: 55.6, examId: 'ex3' }, { n: cur.attempts + 2 })));
await t('attempts cannot stay the same', () => assertFails(submit('UG_24_0001', cur, { score: 100, total: 180, pct: 55.6, examId: 'ex3' }, { n: cur.attempts, attemptId: 'UG_24_0001_x' })));
await t('a submission without its attempt record is rejected', () => assertFails(submit('UG_24_0001', cur, { score: 100, total: 180, pct: 55.6, examId: 'ex3' }, { skipAttempt: true })));
await t('best score cannot decrease', () => assertFails(submit('UG_24_0001', cur, { score: 10, total: 180, pct: 5.6, examId: 'ex3' }, { override: { bestPct: 5.6, bestScore: 10 } })));
await t('best score cannot go above 100%', () => assertFails(submit('UG_24_0001', cur, { score: 200, total: 180, pct: 111.1, examId: 'ex3' })));
await t('score above total is rejected', () => assertFails(submit('UG_24_0001', cur, { score: 190, total: 180, pct: 100, examId: 'ex3' })));
await t('attempt pct must match score/total', () => assertFails(submit('UG_24_0001', cur, { score: 50, total: 180, pct: 99, examId: 'ex3' })));
await t('cannot claim a new best without a better last score', () => assertFails(submit('UG_24_0001', cur, { score: 90, total: 180, pct: 50, examId: 'ex3' }, { override: { bestPct: 80, bestScore: 144, bestAt: serverTimestamp() } })));
await t('the same exam cannot be counted twice', () => assertFails(submit('UG_24_0001', cur, { score: 90, total: 180, pct: 50, examId: cur.lastExamId })));
await t('a higher score becomes the new best', () => assertSucceeds(submit('UG_24_0001', cur, { score: 150, total: 180, pct: 83.3, examId: 'ex4' })));
cur = await read('UG_24_0001');
await t('best is now 83.3 and attempts 3', async () => { if (cur.attempts !== 3 || cur.bestPct !== 83.3 || cur.bestScore !== 150) throw new Error(JSON.stringify(cur)); });

console.log('\nName and matric are locked');
await t('name cannot be changed', () => assertFails(updateDoc(doc(db, 'students', 'UG_24_0001'), { name: 'Hacker Person' })));
await t('matric cannot be changed', () => assertFails(updateDoc(doc(db, 'students', 'UG_24_0001'), { matric: 'XX/00/0000' })));
await t('name cannot be changed even together with a valid submission', () =>
  assertFails(submit('UG_24_0001', cur, { score: 10, total: 180, pct: 5.6, examId: 'ex5' }, { override: { name: 'New Name' } })));

console.log('\nNo deleting');
await t('students cannot be deleted', () => assertFails(deleteDoc(doc(db, 'students', 'UG_24_0001'))));
await t('attempts cannot be deleted', () => assertFails(deleteDoc(doc(db, 'attempts', 'UG_24_0001_1'))));
await t('attempts cannot be edited', () => assertFails(updateDoc(doc(db, 'attempts', 'UG_24_0001_1'), { score: 180 })));
await t('a stand-alone fake attempt record is rejected', () => assertFails(setDoc(doc(db, 'attempts', 'UG_24_0001_99'), {
  sid: 'UG_24_0001', name: 'x', matric: 'x', score: 1, total: 1, pct: 100, perCourse: {}, timeUsedSec: 1, examId: 'zz', createdAt: serverTimestamp()
})));

console.log('\nSeen questions');
const seen = { courses: { GNS: { cycle: 0, ids: ['GNS-001', 'GNS-002'] } }, updatedAt: serverTimestamp() };
await t('the app can create the seen record', () => assertSucceeds(setDoc(doc(db, 'seen', 'UG_24_0001'), seen)));
await t('the app can update the seen record (including a cycle reset)', () =>
  assertSucceeds(setDoc(doc(db, 'seen', 'UG_24_0001'), { courses: { GNS: { cycle: 1, ids: [] } }, updatedAt: serverTimestamp() })));
await t('the seen record can be read', () => assertSucceeds(getDoc(doc(db, 'seen', 'UG_24_0001'))));
await t('seen record for a student who does not exist is rejected', () => assertFails(setDoc(doc(db, 'seen', 'NOBODY'), seen)));
await t('seen record with extra fields is rejected', () =>
  assertFails(setDoc(doc(db, 'seen', 'UG_24_0001'), { courses: {}, bestPct: 100, updatedAt: serverTimestamp() })));
await t('seen records cannot be deleted', () => assertFails(deleteDoc(doc(db, 'seen', 'UG_24_0001'))));

console.log('\nOptional PIN');
await t('sign up together with a PIN is allowed', async () => {
  const b = writeBatch(db);
  b.set(doc(db, 'students', 'UG_24_0100'), newStudent({ matric: 'UG/24/0100', hasPin: true }));
  b.set(doc(db, 'students', 'UG_24_0100', 'pin', 'abc123hash'), { createdAt: serverTimestamp() });
  await assertSucceeds(b.commit());
});
await t('the correct PIN document can be read', async () => {
  const s = await getDoc(doc(db, 'students', 'UG_24_0100', 'pin', 'abc123hash'));
  if (!s.exists()) throw new Error('missing');
});
await t('a wrong PIN document simply does not exist', async () => {
  const s = await assertSucceeds(getDoc(doc(db, 'students', 'UG_24_0100', 'pin', 'wronghash')));
  if (s.exists()) throw new Error('should not exist');
});
await t('nobody can list the PIN documents', () => assertFails(getDocs(collection(db, 'students', 'UG_24_0100', 'pin'))));
await t('a second PIN cannot be added after sign up', () =>
  assertFails(setDoc(doc(db, 'students', 'UG_24_0100', 'pin', 'attackerhash'), { createdAt: serverTimestamp() })));
await t('the PIN cannot be deleted', () => assertFails(deleteDoc(doc(db, 'students', 'UG_24_0100', 'pin', 'abc123hash'))));

console.log('\nCourse leaderboards and the overall average');
// UG_24_0001 is an "old" account: 3 attempts, attempt records with perCourse.GNS, no coursesTaken yet.
const boardDoc = (o = {}) => Object.assign({
  name: 'Amina Bello', matric: 'UG/24/0001', bestPct: 83.3, bestScore: 150, bestTotal: 180,
  bestAt: serverTimestamp(), attempts: 3, src: 'UG_24_0001_3', updatedAt: serverTimestamp()
}, o);
const migrateStudent = (o = {}) => Object.assign({ courseBest: { GNS: 83.3 }, coursesTaken: 1, updatedAt: serverTimestamp() }, o);
await t('a course record that does not match its exam record is rejected', () =>
  assertFails(setDoc(doc(db, 'board_GNS', 'UG_24_0001'), boardDoc({ bestPct: 99, bestScore: 178 }))));
await t('a course record pointing at someone else\'s exam is rejected', () =>
  assertFails(setDoc(doc(db, 'board_GNS', 'UG_24_0100'), boardDoc({ name: 'Amina Bello', matric: 'UG/24/0100' }))));
await t('a course record for a course that was not in the exam is rejected', () =>
  assertFails(setDoc(doc(db, 'board_PHY', 'UG_24_0001'), boardDoc())));
await t('a course record with the wrong name is rejected', () =>
  assertFails(setDoc(doc(db, 'board_GNS', 'UG_24_0001'), boardDoc({ name: 'Someone Else' }))));
await t('one-time upgrade of an old account (course record + course bests) is allowed', async () => {
  const b = writeBatch(db);
  b.set(doc(db, 'board_GNS', 'UG_24_0001'), boardDoc());
  b.update(doc(db, 'students', 'UG_24_0001'), migrateStudent());
  await assertSucceeds(b.commit());
});
await t('the upgrade cannot be run a second time', () =>
  assertFails(updateDoc(doc(db, 'students', 'UG_24_0001'), migrateStudent({ courseBest: { GNS: 100 } }))));
await t('a new student can only start with empty course bests', async () => {
  await assertFails(setDoc(doc(db, 'students', 'UG_24_0200'), newStudent({ matric: 'UG/24/0200', courseBest: { GNS: 90 }, coursesTaken: 1 })));
  await assertSucceeds(setDoc(doc(db, 'students', 'UG_24_0200'), newStudent({ matric: 'UG/24/0200', courseBest: {}, coursesTaken: 0 })));
});

// A new-style submission: student + attempt + course records in one batch (same shape as store.js).
async function submitWithBoards(sid, name, matric, perCourse, examId, opts = {}) {
  const s = (await getDoc(doc(db, 'students', sid))).data();
  const n = s.attempts + 1, id = `${sid}_${n}`;
  let score = 0, total = 0;
  Object.values(perCourse).forEach((c) => { score += c.score; total += c.total; });
  const pct = Math.round(score / total * 1000) / 10;
  const courseBest = Object.assign({}, s.courseBest || {});
  const b = writeBatch(db);
  for (const [code, c] of Object.entries(perCourse)) {
    const cur = (await getDoc(doc(db, 'board_' + code, sid))).data();
    const p = Math.round(c.score / c.total * 1000) / 10;
    let rec;
    if (!cur || p > cur.bestPct) rec = { bestPct: p, bestScore: c.score, bestTotal: c.total, bestAt: serverTimestamp(), attempts: (cur ? cur.attempts : 0) + 1 };
    else rec = { bestPct: cur.bestPct, bestScore: cur.bestScore, bestTotal: cur.bestTotal, bestAt: cur.bestAt, attempts: cur.attempts + 1 };
    Object.assign(rec, { name, matric, src: id, updatedAt: serverTimestamp() }, (opts.board || {})[code] || {});
    b.set(doc(db, 'board_' + code, sid), rec);
    courseBest[code] = rec.bestPct;
  }
  const keys = Object.keys(courseBest);
  const upd = { attempts: n, lastPct: pct, lastExamId: examId, updatedAt: serverTimestamp(), courseBest, coursesTaken: keys.length };
  if (keys.length >= 4) { upd.overallPct = Math.round(keys.reduce((a, k) => a + courseBest[k], 0) / keys.length * 10) / 10; upd.overallAt = serverTimestamp(); }
  if (pct > s.bestPct) Object.assign(upd, { bestPct: pct, bestScore: score, bestTotal: total, bestAt: serverTimestamp() });
  Object.assign(upd, opts.student || {});
  b.update(doc(db, 'students', sid), upd);
  b.set(doc(db, 'attempts', id), { sid, name, matric, score, total, pct, perCourse, timeUsedSec: 300, examId, createdAt: serverTimestamp() });
  return b.commit();
}
const S2 = ['UG_24_0200', 'Amina Bello', 'UG/24/0200'];
await t('Physics-only exam: creates the PHY course record', () =>
  assertSucceeds(submitWithBoards(...S2, { PHY: { score: 30, total: 45, wrong: 10, skipped: 5 } }, 'p1')));
await t('lower Physics score: attempts go up, best stays', () =>
  assertSucceeds(submitWithBoards(...S2, { PHY: { score: 20, total: 45, wrong: 20, skipped: 5 } }, 'p2')));
await t('course best cannot be lowered', () =>
  assertFails(submitWithBoards(...S2, { PHY: { score: 10, total: 45, wrong: 30, skipped: 5 } }, 'p3', { board: { PHY: { bestPct: 22.2, bestScore: 10 } } })));
await t('course best cannot be raised above the real score', () =>
  assertFails(submitWithBoards(...S2, { PHY: { score: 10, total: 45, wrong: 30, skipped: 5 } }, 'p3', { board: { PHY: { bestPct: 100, bestScore: 45, bestAt: serverTimestamp() } } })));
await t('course attempts cannot jump by 2', () =>
  assertFails(submitWithBoards(...S2, { PHY: { score: 10, total: 45, wrong: 30, skipped: 5 } }, 'p3', { board: { PHY: { attempts: 9 } } })));
await t('overall average cannot be above 100%', () =>
  assertFails(submitWithBoards(...S2, { GNS: { score: 40, total: 45, wrong: 5, skipped: 0 } }, 'p3', { student: { overallPct: 150, overallAt: serverTimestamp() } })));
await t('4-course exam: joins the Overall leaderboard with the average', async () => {
  await assertSucceeds(submitWithBoards(...S2, {
    GNS: { score: 40, total: 45, wrong: 5, skipped: 0 }, PHC: { score: 30, total: 45, wrong: 15, skipped: 0 },
    CHM: { score: 27, total: 45, wrong: 18, skipped: 0 }
  }, 'p3'));
  const s = (await getDoc(doc(db, 'students', 'UG_24_0200'))).data();
  if (s.coursesTaken !== 4 || typeof s.overallPct !== 'number') throw new Error(JSON.stringify(s));
});
await t('anyone can read the course and overall leaderboards and count them', async () => {
  await assertSucceeds(getDocs(query(collection(db, 'board_PHY'), orderBy('bestPct', 'desc'), limit(100))));
  await assertSucceeds(getDocs(query(collection(db, 'students'), orderBy('overallPct', 'desc'), limit(100))));
  await assertSucceeds(getCountFromServer(query(collection(db, 'board_PHY'), where('bestPct', '>', 50))));
  await assertSucceeds(getCountFromServer(query(collection(db, 'students'), where('overallPct', '>=', 0))));
});
await t('course records cannot be deleted', () => assertFails(deleteDoc(doc(db, 'board_PHY', 'UG_24_0200'))));
await t('old-style submissions (cached old page) still work', async () => {
  cur = await read('UG_24_0001');
  await assertSucceeds(submit('UG_24_0001', cur, { score: 100, total: 180, pct: 55.6, examId: 'old-page' }));
});

console.log('\nOther collections are closed');
await t('random collections cannot be written', () => assertFails(setDoc(doc(db, 'hack', 'x'), { a: 1 })));

console.log(`\n${passed} passed, ${failed} failed`);
await env.cleanup();
process.exit(failed ? 1 : 0);
