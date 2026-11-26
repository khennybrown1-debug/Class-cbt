/*
 * Data store.
 *  - FIREBASE MODE (when js/config.js has Firebase keys): everything is saved
 *    in Firestore and shared by every phone. The leaderboard is live.
 *  - DEMO MODE (no keys yet): everything is saved in this browser only.
 * Both modes expose exactly the same functions to app.js.
 *
 * Firestore layout
 *   students/{sid}            name, matric, hasPin, attempts, bestPct, bestScore,
 *                             bestTotal, bestAt, lastPct, lastExamId, createdAt, updatedAt,
 *                             courseBest {GNS: 66.7, ...}, coursesTaken, overallPct, overallAt
 *                             (overallPct = average of course bests, only after 4+ courses)
 *   board_{CODE}/{sid}        one leaderboard record per course: name, matric, bestPct,
 *                             bestScore, bestTotal, bestAt, attempts, src (attempt id), updatedAt
 *   students/{sid}/pin/{hash} exists only if the student chose a PIN (hash of matric + PIN)
 *   seen/{sid}                courses: { GNS: { cycle, ids: [...] }, ... }, updatedAt
 *   attempts/{sid}_{n}        one record per submitted exam
 * sid = matric number in capitals with any symbol replaced by "_" (UG/23/001 -> UG_23_001)
 */
(function () {
  'use strict';
  var CFG = window.CBT_CONFIG || {};
  var E = window.CBTEngine;
  var FIREBASE_VERSION = '10.12.2';
  var NET_TIMEOUT_MS = 20000;

  /* ---------- small helpers ---------- */
  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };
  function normMatric(m) { return String(m || '').toUpperCase().replace(/\s+/g, ''); }
  function sidOf(m) { return normMatric(m).replace(/[^A-Z0-9]/g, '_'); }
  /* The "CHT/" (College of Health Technology) prefix is optional:
   * CHT/PHT/26/1635 and PHT/26/1635 are the same student.
   * Returns the other spelling's ID so both can be checked. */
  var OPTIONAL_PREFIX = 'CHT_';
  function altSidOf(m) {
    var sid = sidOf(m);
    return sid.indexOf(OPTIONAL_PREFIX) === 0 ? sid.slice(OPTIONAL_PREFIX.length) : OPTIONAL_PREFIX + sid;
  }
  function err(code, message) { var e = new Error(message || code); e.code = code; return e; }

  // cyrb53 string hash (two seeds = 106 bits). Same result on every device.
  function cyrb53(str, seed) {
    var h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (var i = 0, ch; i < str.length; i++) {
      ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
  }
  function pinHash(sid, pin) {
    var s = sid + ':' + pin + ':cbt-pin-v1';
    return cyrb53(s, 7) + cyrb53(s, 1931);
  }
  function withTimeout(p, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(err('timeout', 'The network is too slow.')); }, ms || NET_TIMEOUT_MS);
      p.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }
  var MIN_OVERALL = Math.max(1, parseInt(CFG.overallMinCourses, 10) || 4);
  var LB_SIZE = CFG.leaderboardSize || 100;
  function pctOf(score, total) { return total ? Math.round(score / total * 1000) / 10 : 0; }
  function round1(x) { return Math.round(x * 10) / 10; }
  function overallOf(courseBest) {
    var keys = Object.keys(courseBest || {});
    if (keys.length < MIN_OVERALL) return null;
    var sum = keys.reduce(function (s, k2) { return s + (Number(courseBest[k2]) || 0); }, 0);
    return round1(sum / keys.length);
  }
  function sortEntries(list) {
    return list.sort(function (a, b) {
      return (b.pct - a.pct) || ((a.at || 0) - (b.at || 0)) || String(a.name).localeCompare(String(b.name));
    });
  }
  function localSeenKey(sid) { return 'cbt_seen_' + sid; }

  /*
   * Work out what a submitted exam changes. Shared by demo and Firebase mode.
   *  student: current student record; boards: { CODE: current course record or null }
   *  r: { perCourse: { CODE: { score, total } }, ... }; now: timestamp value to store
   */
  function planSubmission(student, boards, r, attemptId, now) {
    var courseBest = Object.assign({}, student.courseBest || {});
    var improved = [];
    var newBoards = {};
    Object.keys(r.perCourse || {}).forEach(function (code) {
      var pc = r.perCourse[code];
      var p = pctOf(pc.score, pc.total);
      var cur = boards[code];
      var b;
      if (!cur) {
        b = { bestPct: p, bestScore: pc.score, bestTotal: pc.total, bestAt: now, attempts: 1 };
        improved.push(code);
      } else if (p > cur.bestPct) {
        b = { bestPct: p, bestScore: pc.score, bestTotal: pc.total, bestAt: now, attempts: (cur.attempts || 0) + 1 };
        improved.push(code);
      } else {
        b = { bestPct: cur.bestPct, bestScore: cur.bestScore, bestTotal: cur.bestTotal, bestAt: cur.bestAtRaw, attempts: (cur.attempts || 0) + 1 };
      }
      b.name = student.name; b.matric = student.matric; b.src = attemptId; b.updatedAt = now;
      newBoards[code] = b;
      courseBest[code] = b.bestPct;
    });
    var overall = overallOf(courseBest);
    var studentFields = { courseBest: courseBest, coursesTaken: Object.keys(courseBest).length };
    if (overall !== null && overall !== student.overallPct) { studentFields.overallPct = overall; studentFields.overallAt = now; }
    return {
      studentFields: studentFields, boards: newBoards, improved: improved,
      overallBefore: student.overallPct == null ? null : student.overallPct, overallAfter: overall
    };
  }

  /* Rebuild course bests from old exam records (for accounts made before course leaderboards). */
  function planMigration(attemptList) {
    var per = {};
    attemptList.forEach(function (a) {
      Object.keys(a.perCourse || {}).forEach(function (code) {
        var pc = a.perCourse[code];
        if (!pc || !pc.total) return;
        var p = pctOf(pc.score, pc.total);
        var c = per[code] = per[code] || { attempts: 0, best: null };
        c.attempts++;
        if (!c.best || p > c.best.pct || (p === c.best.pct && a.at < c.best.at)) c.best = { pct: p, score: pc.score, total: pc.total, src: a.id, at: a.at };
      });
    });
    var courseBest = {};
    Object.keys(per).forEach(function (code) { courseBest[code] = per[code].best.pct; });
    return { per: per, courseBest: courseBest, overall: overallOf(courseBest) };
  }

  function entryFromStudent(s) {
    return { sid: s.sid, name: s.name, matric: s.matric, pct: s.overallPct, at: s.overallAt || 0, attempts: s.attempts || 0, courses: s.coursesTaken || 0 };
  }

  /* =====================================================================
   * DEMO STORE (localStorage only)
   * ===================================================================== */
  var DEMO_KEY = 'cbt_demo_db_v1';
  function demoDb() {
    var d = LS.get(DEMO_KEY, null) || {};
    d.students = d.students || {}; d.seen = d.seen || {}; d.attempts = d.attempts || {}; d.pins = d.pins || {}; d.boards = d.boards || {};
    return d;
  }
  function demoSave(db) {
    LS.set(DEMO_KEY, db);
    try { window.dispatchEvent(new Event('cbt-demo-change')); } catch (e) { /* ignore */ }
  }
  function delay(v) { return new Promise(function (r) { setTimeout(function () { r(v); }, 250); }); }
  function demoBoard(db, code) { return db.boards[code] = db.boards[code] || {}; }
  function demoEntries(db, board) {
    if (board === 'overall') {
      return Object.keys(db.students).map(function (k2) { return db.students[k2]; })
        .filter(function (s) { return s.overallPct != null; }).map(entryFromStudent);
    }
    var b = db.boards[board] || {};
    return Object.keys(b).map(function (sid) {
      var x = b[sid];
      return { sid: sid, name: x.name, matric: x.matric, pct: x.bestPct, score: x.bestScore, total: x.bestTotal, at: x.bestAt || 0, attempts: x.attempts || 0 };
    });
  }

  var DemoStore = {
    mode: 'demo',
    init: function () { return Promise.resolve(); },
    sidOf: sidOf,
    normMatric: normMatric,

    getStudent: function (matric) {
      var db = demoDb();
      var s = db.students[sidOf(matric)] || db.students[altSidOf(matric)];
      return delay(s ? Object.assign({}, s) : null);
    },
    getStudentBySid: function (sid) {
      var s = demoDb().students[sid];
      return delay(s ? Object.assign({}, s) : null);
    },
    createStudent: function (o) {
      var db = demoDb();
      var sid = sidOf(o.matric);
      if (db.students[sid] || db.students[altSidOf(o.matric)]) return delay(null).then(function () { throw err('exists'); });
      var now = Date.now();
      var s = {
        sid: sid, name: o.name, matric: normMatric(o.matric), hasPin: !!o.pin,
        attempts: 0, bestPct: 0, bestScore: 0, bestTotal: 0, bestAt: now, lastPct: 0, lastExamId: '', createdAt: now,
        courseBest: {}, coursesTaken: 0
      };
      db.students[sid] = s;
      if (o.pin) db.pins[sid] = pinHash(sid, o.pin);
      demoSave(db);
      return delay(Object.assign({}, s));
    },
    checkPin: function (sid, pin) {
      return delay(demoDb().pins[sid] === pinHash(sid, pin));
    },
    getSeen: function (sid) {
      var remote = demoDb().seen[sid] || {};
      return Promise.resolve(E.mergeSeen(remote, LS.get(localSeenKey(sid), {})));
    },
    saveSeen: function (sid, courses) {
      LS.set(localSeenKey(sid), courses);
      var db = demoDb();
      db.seen[sid] = courses;
      demoSave(db);
      return Promise.resolve();
    },
    submitAttempt: function (sid, r) {
      var db = demoDb();
      var s = db.students[sid];
      if (!s) return Promise.reject(err('not-found'));
      if (s.lastExamId === r.examId) return delay({ student: Object.assign({}, s), improved: [], alreadySaved: true, overallBefore: s.overallPct, overallAfter: s.overallPct });
      var n = s.attempts + 1;
      var now = Date.now();
      var cur = {};
      Object.keys(r.perCourse).forEach(function (code) {
        var x = demoBoard(db, code)[sid];
        cur[code] = x ? Object.assign({ bestAtRaw: x.bestAt }, x) : null;
      });
      var plan = planSubmission(s, cur, r, sid + '_' + n, now);
      s.attempts = n; s.lastPct = r.pct; s.lastExamId = r.examId;
      if (r.pct > s.bestPct) { s.bestPct = r.pct; s.bestScore = r.score; s.bestTotal = r.total; s.bestAt = now; }
      Object.assign(s, plan.studentFields);
      Object.keys(plan.boards).forEach(function (code) { demoBoard(db, code)[sid] = plan.boards[code]; });
      db.attempts[sid + '_' + n] = {
        sid: sid, name: s.name, matric: s.matric, score: r.score, total: r.total, pct: r.pct,
        perCourse: r.perCourse, timeUsedSec: r.timeUsedSec, examId: r.examId, createdAt: now
      };
      demoSave(db);
      return delay({ student: Object.assign({}, s), improved: plan.improved, overallBefore: plan.overallBefore, overallAfter: plan.overallAfter });
    },
    migrate: function (student) {
      if (!student || !student.attempts || student.coursesTaken != null) return Promise.resolve(student);
      var db = demoDb();
      var list = Object.keys(db.attempts).filter(function (id) { return db.attempts[id].sid === student.sid; })
        .map(function (id) { var a = db.attempts[id]; return { id: id, perCourse: a.perCourse, at: a.createdAt || 0 }; });
      var m = planMigration(list);
      var s = db.students[student.sid];
      var now = Date.now();
      Object.keys(m.per).forEach(function (code) {
        var c = m.per[code];
        demoBoard(db, code)[student.sid] = { name: s.name, matric: s.matric, bestPct: c.best.pct, bestScore: c.best.score, bestTotal: c.best.total, bestAt: now, attempts: c.attempts, src: c.best.src, updatedAt: now };
      });
      s.courseBest = m.courseBest; s.coursesTaken = Object.keys(m.courseBest).length;
      if (m.overall !== null) { s.overallPct = m.overall; s.overallAt = now; }
      demoSave(db);
      return Promise.resolve(Object.assign({}, s));
    },
    subscribeBoard: function (board, cb) {
      function push() { cb(sortEntries(demoEntries(demoDb(), board)).slice(0, LB_SIZE)); }
      function onStorage(e) { if (!e || e.key === DEMO_KEY) push(); }
      window.addEventListener('cbt-demo-change', push);
      window.addEventListener('storage', onStorage);
      setTimeout(push, 0);
      return function () {
        window.removeEventListener('cbt-demo-change', push);
        window.removeEventListener('storage', onStorage);
      };
    },
    getRank: function (student, board) {
      var list = sortEntries(demoEntries(demoDb(), board));
      var i = list.findIndex(function (s) { return s.sid === student.sid; });
      return Promise.resolve({ rank: i >= 0 ? i + 1 : null, total: list.length });
    }
  };

  /* =====================================================================
   * FIREBASE STORE (Cloud Firestore)
   * ===================================================================== */
  var fs = null, db = null, initPromise = null;
  function ms(v) { return v && typeof v.toMillis === 'function' ? v.toMillis() : (typeof v === 'number' ? v : 0); }
  function toStudent(id, d) {
    if (!d) return null;
    return {
      sid: id, name: d.name, matric: d.matric, hasPin: !!d.hasPin,
      attempts: d.attempts || 0, bestPct: d.bestPct || 0, bestScore: d.bestScore || 0, bestTotal: d.bestTotal || 0,
      bestAt: ms(d.bestAt) || Date.now(), lastPct: d.lastPct || 0, lastExamId: d.lastExamId || '', createdAt: ms(d.createdAt) || Date.now(),
      courseBest: d.courseBest || {}, coursesTaken: d.coursesTaken == null ? null : d.coursesTaken,
      overallPct: d.overallPct == null ? null : d.overallPct, overallAt: ms(d.overallAt)
    };
  }
  function toBoardEntry(id, d) {
    return { sid: id, name: d.name, matric: d.matric, pct: d.bestPct || 0, score: d.bestScore || 0, total: d.bestTotal || 0, at: ms(d.bestAt), attempts: d.attempts || 0 };
  }
  function mapFbError(e) {
    if (e && e.code && /^(exists|not-found|timeout|wrong-pin)$/.test(e.code)) return e;
    var c = (e && e.code) || '';
    if (c === 'permission-denied') return err('permission', e.message);
    if (c === 'unavailable' || c === 'deadline-exceeded' || /offline|network/i.test((e && e.message) || '')) return err('network', e && e.message);
    if (c === 'failed-precondition' && /index/i.test((e && e.message) || '')) return err('index', e.message);
    return err('unknown', e && e.message);
  }

  var FirebaseStore = {
    mode: 'firebase',
    sidOf: sidOf,
    normMatric: normMatric,

    init: function () {
      if (initPromise) return initPromise;
      var base = 'https://www.gstatic.com/firebasejs/' + FIREBASE_VERSION + '/';
      initPromise = Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-firestore.js')])
        .then(function (mods) {
          fs = mods[1];
          var app = mods[0].initializeApp(CFG.firebase);
          db = fs.getFirestore(app);
          // Only used for local testing with the Firebase emulator, e.g. emulator: "127.0.0.1:8080"
          if (CFG.emulator) {
            var hp = String(CFG.emulator).split(':');
            fs.connectFirestoreEmulator(db, hp[0], parseInt(hp[1], 10) || 8080);
          }
        })
        .catch(function (e) { initPromise = null; throw err('network', 'Could not load Firebase: ' + (e && e.message)); });
      return initPromise;
    },

    // Try the matric exactly as typed, then the other spelling (with or without CHT/).
    getStudent: function (matric) {
      return FirebaseStore.getStudentBySid(sidOf(matric)).then(function (s) {
        return s || FirebaseStore.getStudentBySid(altSidOf(matric));
      });
    },
    getStudentBySid: function (sid) {
      return withTimeout(fs.getDoc(fs.doc(db, 'students', sid)))
        .then(function (snap) { return snap.exists() ? toStudent(snap.id, snap.data()) : null; })
        .catch(function (e) { throw mapFbError(e); });
    },

    createStudent: function (o) {
      var sid = sidOf(o.matric);
      var ref = fs.doc(db, 'students', sid);
      var altRef = fs.doc(db, 'students', altSidOf(o.matric));
      return withTimeout(Promise.all([fs.getDoc(ref), fs.getDoc(altRef)])).then(function (snaps) {
        if (snaps[0].exists() || snaps[1].exists()) throw err('exists');
        var now = fs.serverTimestamp();
        var batch = fs.writeBatch(db);
        batch.set(ref, {
          name: o.name, matric: normMatric(o.matric), hasPin: !!o.pin,
          attempts: 0, bestPct: 0, bestScore: 0, bestTotal: 0, lastPct: 0, lastExamId: '',
          bestAt: now, createdAt: now, updatedAt: now, courseBest: {}, coursesTaken: 0
        });
        if (o.pin) batch.set(fs.doc(db, 'students', sid, 'pin', pinHash(sid, o.pin)), { createdAt: now });
        return withTimeout(batch.commit());
      }).then(function () {
        return {
          sid: sid, name: o.name, matric: normMatric(o.matric), hasPin: !!o.pin, attempts: 0, bestPct: 0,
          bestScore: 0, bestTotal: 0, bestAt: Date.now(), lastPct: 0, lastExamId: '', createdAt: Date.now(),
          courseBest: {}, coursesTaken: 0, overallPct: null, overallAt: 0
        };
      }).catch(function (e) {
        // If someone created the same matric at the same moment, the rules reject our write.
        if (e && e.code === 'permission-denied') throw err('exists');
        throw mapFbError(e);
      });
    },

    checkPin: function (sid, pin) {
      return withTimeout(fs.getDoc(fs.doc(db, 'students', sid, 'pin', pinHash(sid, pin))))
        .then(function (snap) { return snap.exists(); })
        .catch(function (e) { throw mapFbError(e); });
    },

    getSeen: function (sid) {
      var local = LS.get(localSeenKey(sid), {});
      return withTimeout(fs.getDoc(fs.doc(db, 'seen', sid)), 12000)
        .then(function (snap) { return E.mergeSeen(snap.exists() ? (snap.data().courses || {}) : {}, local); })
        .catch(function () { return local; }); // offline: fall back to this phone's copy
    },

    saveSeen: function (sid, courses) {
      LS.set(localSeenKey(sid), courses);
      // Not awaited by the exam: the SDK keeps retrying while the page is open.
      return fs.setDoc(fs.doc(db, 'seen', sid), { courses: courses, updatedAt: fs.serverTimestamp() })
        .catch(function (e) { console.warn('Could not save seen questions', e); });
    },

    submitAttempt: function (sid, r) {
      var ref = fs.doc(db, 'students', sid);
      var codes = Object.keys(r.perCourse || {});
      var boardRefs = codes.map(function (code) { return fs.doc(db, 'board_' + code, sid); });
      var out = null;
      return withTimeout(fs.runTransaction(db, function (tx) {
        return Promise.all([tx.get(ref)].concat(boardRefs.map(function (b) { return tx.get(b); }))).then(function (snaps) {
          var snap = snaps[0];
          if (!snap.exists()) throw err('not-found');
          var s = toStudent(snap.id, snap.data());
          if (s.lastExamId === r.examId) {
            out = { student: s, improved: [], alreadySaved: true, overallBefore: s.overallPct, overallAfter: s.overallPct };
            return;
          }
          var n = s.attempts + 1;
          var attemptId = sid + '_' + n;
          var cur = {};
          codes.forEach(function (code, i) {
            var bs = snaps[i + 1];
            if (bs.exists()) { var d = bs.data(); cur[code] = Object.assign({}, d, { bestAtRaw: d.bestAt }); } else cur[code] = null;
          });
          var now = fs.serverTimestamp();
          var plan = planSubmission(s, cur, r, attemptId, now);
          var upd = Object.assign({ attempts: n, lastPct: r.pct, lastExamId: r.examId, updatedAt: now }, plan.studentFields);
          if (r.pct > s.bestPct) { upd.bestPct = r.pct; upd.bestScore = r.score; upd.bestTotal = r.total; upd.bestAt = now; }
          tx.update(ref, upd);
          tx.set(fs.doc(db, 'attempts', attemptId), {
            sid: sid, name: s.name, matric: s.matric, score: r.score, total: r.total, pct: r.pct,
            perCourse: r.perCourse, timeUsedSec: r.timeUsedSec, examId: r.examId, createdAt: now
          });
          codes.forEach(function (code, i) { tx.set(boardRefs[i], plan.boards[code]); });
          var ns = Object.assign({}, s, { attempts: n, lastPct: r.pct, lastExamId: r.examId }, plan.studentFields);
          if (r.pct > s.bestPct) Object.assign(ns, { bestPct: r.pct, bestScore: r.score, bestTotal: r.total, bestAt: Date.now() });
          if (ns.overallAt && typeof ns.overallAt !== 'number') ns.overallAt = Date.now();
          out = { student: ns, improved: plan.improved, overallBefore: plan.overallBefore, overallAfter: plan.overallAfter };
        });
      }), 30000).then(function () { return out; }).catch(function (e) { throw mapFbError(e); });
    },

    // One-time upgrade for accounts made before course leaderboards existed.
    migrate: function (student) {
      if (!student || !student.attempts || student.coursesTaken != null) return Promise.resolve(student);
      var sid = student.sid;
      return withTimeout(fs.getDocs(fs.query(fs.collection(db, 'attempts'), fs.where('sid', '==', sid)))).then(function (qs) {
        var list = [];
        qs.forEach(function (d) { var a = d.data(); list.push({ id: d.id, perCourse: a.perCourse, at: ms(a.createdAt) }); });
        var m = planMigration(list);
        var now = fs.serverTimestamp();
        var batch = fs.writeBatch(db);
        Object.keys(m.per).forEach(function (code) {
          var c = m.per[code];
          batch.set(fs.doc(db, 'board_' + code, sid), {
            name: student.name, matric: student.matric, bestPct: c.best.pct, bestScore: c.best.score, bestTotal: c.best.total,
            bestAt: now, attempts: c.attempts, src: c.best.src, updatedAt: now
          });
        });
        var upd = { courseBest: m.courseBest, coursesTaken: Object.keys(m.courseBest).length, updatedAt: now };
        if (m.overall !== null) { upd.overallPct = m.overall; upd.overallAt = now; }
        batch.update(fs.doc(db, 'students', sid), upd);
        return withTimeout(batch.commit()).then(function () {
          return Object.assign({}, student, { courseBest: m.courseBest, coursesTaken: upd.coursesTaken, overallPct: m.overall, overallAt: m.overall !== null ? Date.now() : 0 });
        });
      }).catch(function (e) { console.warn('Upgrade of old scores failed', e); return student; });
    },

    subscribeBoard: function (board, cb, onError) {
      var q = board === 'overall'
        ? fs.query(fs.collection(db, 'students'), fs.orderBy('overallPct', 'desc'), fs.limit(LB_SIZE))
        : fs.query(fs.collection(db, 'board_' + board), fs.orderBy('bestPct', 'desc'), fs.limit(LB_SIZE));
      return fs.onSnapshot(q, function (snap) {
        var list = [];
        snap.forEach(function (d) { list.push(board === 'overall' ? entryFromStudent(toStudent(d.id, d.data())) : toBoardEntry(d.id, d.data())); });
        cb(sortEntries(list));
      }, function (e) { if (onError) onError(mapFbError(e)); });
    },

    // Count queries are cheap: about 1 read per 1000 records.
    getRank: function (student, board) {
      var overall = board === 'overall';
      var col = overall ? fs.collection(db, 'students') : fs.collection(db, 'board_' + board);
      var field = overall ? 'overallPct' : 'bestPct';
      var mine = overall ? student.overallPct : (student.courseBest || {})[board];
      var totalQ = fs.getCountFromServer(overall ? fs.query(col, fs.where('overallPct', '>=', 0)) : col);
      if (mine == null) {
        return withTimeout(totalQ).then(function (t) { return { rank: null, total: t.data().count }; }).catch(function (e) { throw mapFbError(e); });
      }
      var aheadQ = fs.getCountFromServer(fs.query(col, fs.where(field, '>', mine)));
      return withTimeout(Promise.all([aheadQ, totalQ])).then(function (res) {
        return { rank: res[0].data().count + 1, total: res[1].data().count };
      }).catch(function (e) { throw mapFbError(e); });
    }
  };

  var useFirebase = !!(CFG.firebase && String(CFG.firebase.apiKey || '').trim() && String(CFG.firebase.projectId || '').trim());
  var store = useFirebase ? FirebaseStore : DemoStore;
  store.LS = LS;
  store.pinHash = pinHash;
  store.planMigration = planMigration;
  store.overallOf = overallOf;
  store.MIN_OVERALL = MIN_OVERALL;
  window.CBTStore = store;
})();
