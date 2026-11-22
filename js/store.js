/*
 * Data store.
 *  - FIREBASE MODE (when js/config.js has Firebase keys): everything is saved
 *    in Firestore and shared by every phone. The leaderboard is live.
 *  - DEMO MODE (no keys yet): everything is saved in this browser only.
 * Both modes expose exactly the same functions to app.js.
 *
 * Firestore layout
 *   students/{sid}            name, matric, hasPin, attempts, bestPct, bestScore,
 *                             bestTotal, bestAt, lastPct, lastExamId, createdAt, updatedAt
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
  function sortBoard(list) {
    return list
      .filter(function (s) { return (s.attempts || 0) > 0; })
      .sort(function (a, b) { return (b.bestPct - a.bestPct) || ((a.bestAt || 0) - (b.bestAt || 0)) || a.name.localeCompare(b.name); });
  }
  function localSeenKey(sid) { return 'cbt_seen_' + sid; }

  /* =====================================================================
   * DEMO STORE (localStorage only)
   * ===================================================================== */
  var DEMO_KEY = 'cbt_demo_db_v1';
  function demoDb() { return LS.get(DEMO_KEY, null) || { students: {}, seen: {}, attempts: {}, pins: {} }; }
  function demoSave(db) {
    LS.set(DEMO_KEY, db);
    try { window.dispatchEvent(new Event('cbt-demo-change')); } catch (e) { /* ignore */ }
  }
  function delay(v) { return new Promise(function (r) { setTimeout(function () { r(v); }, 250); }); }

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
        attempts: 0, bestPct: 0, bestScore: 0, bestTotal: 0, bestAt: now, lastPct: 0, lastExamId: '', createdAt: now
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
      var previousBest = s.bestPct;
      if (s.lastExamId === r.examId) return delay({ student: Object.assign({}, s), improved: false, previousBest: previousBest, alreadySaved: true });
      s.attempts += 1;
      s.lastPct = r.pct;
      s.lastExamId = r.examId;
      var improved = r.pct > s.bestPct;
      if (improved) { s.bestPct = r.pct; s.bestScore = r.score; s.bestTotal = r.total; s.bestAt = Date.now(); }
      db.attempts[sid + '_' + s.attempts] = {
        sid: sid, name: s.name, matric: s.matric, score: r.score, total: r.total, pct: r.pct,
        perCourse: r.perCourse, timeUsedSec: r.timeUsedSec, examId: r.examId, createdAt: Date.now()
      };
      demoSave(db);
      return delay({ student: Object.assign({}, s), improved: improved, previousBest: previousBest });
    },
    subscribeLeaderboard: function (cb) {
      function push() {
        var db = demoDb();
        var all = Object.keys(db.students).map(function (k) { return db.students[k]; });
        cb(sortBoard(all).slice(0, CFG.leaderboardSize || 100));
      }
      function onStorage(e) { if (!e || e.key === DEMO_KEY) push(); }
      window.addEventListener('cbt-demo-change', push);
      window.addEventListener('storage', onStorage);
      setTimeout(push, 0);
      return function () {
        window.removeEventListener('cbt-demo-change', push);
        window.removeEventListener('storage', onStorage);
      };
    },
    getRank: function (student) {
      var db = demoDb();
      var board = sortBoard(Object.keys(db.students).map(function (k) { return db.students[k]; }));
      var i = board.findIndex(function (s) { return s.sid === student.sid; });
      return Promise.resolve({ rank: i >= 0 ? i + 1 : null, total: board.length });
    }
  };

  /* =====================================================================
   * FIREBASE STORE (Cloud Firestore)
   * ===================================================================== */
  var fs = null, db = null, initPromise = null;
  function toStudent(id, d) {
    if (!d) return null;
    var ts = function (v) { return v && typeof v.toMillis === 'function' ? v.toMillis() : (typeof v === 'number' ? v : Date.now()); };
    return {
      sid: id, name: d.name, matric: d.matric, hasPin: !!d.hasPin,
      attempts: d.attempts || 0, bestPct: d.bestPct || 0, bestScore: d.bestScore || 0, bestTotal: d.bestTotal || 0,
      bestAt: ts(d.bestAt), lastPct: d.lastPct || 0, lastExamId: d.lastExamId || '', createdAt: ts(d.createdAt)
    };
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
          bestAt: now, createdAt: now, updatedAt: now
        });
        if (o.pin) batch.set(fs.doc(db, 'students', sid, 'pin', pinHash(sid, o.pin)), { createdAt: now });
        return withTimeout(batch.commit());
      }).then(function () {
        return {
          sid: sid, name: o.name, matric: normMatric(o.matric), hasPin: !!o.pin, attempts: 0, bestPct: 0,
          bestScore: 0, bestTotal: 0, bestAt: Date.now(), lastPct: 0, lastExamId: '', createdAt: Date.now()
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
      var out = null;
      return withTimeout(fs.runTransaction(db, function (tx) {
        return tx.get(ref).then(function (snap) {
          if (!snap.exists()) throw err('not-found');
          var s = toStudent(snap.id, snap.data());
          if (s.lastExamId === r.examId) {
            out = { student: s, improved: false, previousBest: s.bestPct, alreadySaved: true };
            return;
          }
          var n = s.attempts + 1;
          var improved = r.pct > s.bestPct;
          var upd = { attempts: n, lastPct: r.pct, lastExamId: r.examId, updatedAt: fs.serverTimestamp() };
          if (improved) {
            upd.bestPct = r.pct; upd.bestScore = r.score; upd.bestTotal = r.total; upd.bestAt = fs.serverTimestamp();
          }
          tx.update(ref, upd);
          tx.set(fs.doc(db, 'attempts', sid + '_' + n), {
            sid: sid, name: s.name, matric: s.matric, score: r.score, total: r.total, pct: r.pct,
            perCourse: r.perCourse, timeUsedSec: r.timeUsedSec, examId: r.examId, createdAt: fs.serverTimestamp()
          });
          var ns = Object.assign({}, s, { attempts: n, lastPct: r.pct, lastExamId: r.examId });
          if (improved) Object.assign(ns, { bestPct: r.pct, bestScore: r.score, bestTotal: r.total, bestAt: Date.now() });
          out = { student: ns, improved: improved, previousBest: s.bestPct };
        });
      }), 30000).then(function () { return out; }).catch(function (e) { throw mapFbError(e); });
    },

    subscribeLeaderboard: function (cb, onError) {
      var q = fs.query(fs.collection(db, 'students'), fs.orderBy('bestPct', 'desc'), fs.limit(CFG.leaderboardSize || 100));
      return fs.onSnapshot(q, function (snap) {
        var list = [];
        snap.forEach(function (d) { list.push(toStudent(d.id, d.data())); });
        cb(sortBoard(list));
      }, function (e) { if (onError) onError(mapFbError(e)); });
    },

    // Two count queries: cheap (about 1 read per 1000 students each).
    getRank: function (student) {
      var col = fs.collection(db, 'students');
      var totalQ = fs.getCountFromServer(fs.query(col, fs.where('attempts', '>', 0)));
      if (!student || !student.attempts) {
        return withTimeout(totalQ).then(function (t) { return { rank: null, total: t.data().count }; }).catch(function (e) { throw mapFbError(e); });
      }
      var aheadQ = fs.getCountFromServer(fs.query(col, fs.where('bestPct', '>', student.bestPct)));
      return withTimeout(Promise.all([aheadQ, totalQ])).then(function (r) {
        return { rank: r[0].data().count + 1, total: r[1].data().count };
      }).catch(function (e) { throw mapFbError(e); });
    }
  };

  var useFirebase = !!(CFG.firebase && String(CFG.firebase.apiKey || '').trim() && String(CFG.firebase.projectId || '').trim());
  var store = useFirebase ? FirebaseStore : DemoStore;
  store.LS = LS;
  store.pinHash = pinHash;
  window.CBTStore = store;
})();
