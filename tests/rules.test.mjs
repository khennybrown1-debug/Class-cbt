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

console.log('\nOther collections are closed');
await t('random collections cannot be written', () => assertFails(setDoc(doc(db, 'hack', 'x'), { a: 1 })));

console.log(`\n${passed} passed, ${failed} failed`);
await env.cleanup();
process.exit(failed ? 1 : 0);
