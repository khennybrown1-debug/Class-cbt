/*
 * Exam engine: picks questions, shuffles them and marks scripts.
 * Pure functions with no Firebase or page code, so they can be tested in Node.
 */
(function (root) {
  'use strict';

  /* Random integer 0..n-1 using the best randomness available. */
  function randInt(n) {
    var c = root.crypto || (typeof globalThis !== 'undefined' && globalThis.crypto);
    if (c && c.getRandomValues) {
      var buf = new Uint32Array(1);
      var limit = Math.floor(0x100000000 / n) * n;
      do { c.getRandomValues(buf); } while (buf[0] >= limit);
      return buf[0] % n;
    }
    return Math.floor(Math.random() * n);
  }

  /* Fisher-Yates shuffle (returns a new array). */
  function shuffle(arr, rng) {
    var a = arr.slice();
    var r = rng || randInt;
    for (var i = a.length - 1; i > 0; i--) {
      var j = r(i + 1);
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* Pick n questions from pool, spread as evenly as possible across topics:
   * shuffle each topic, then take one question from each topic in turn. */
  function balancedPick(pool, n, rng) {
    var groups = {};
    pool.forEach(function (q) { (groups[q.topic] = groups[q.topic] || []).push(q); });
    var topics = shuffle(Object.keys(groups), rng);
    topics.forEach(function (t) { groups[t] = shuffle(groups[t], rng); });
    var out = [];
    var round = 0;
    while (out.length < n) {
      var added = false;
      for (var k = 0; k < topics.length && out.length < n; k++) {
        var g = groups[topics[k]];
        if (round < g.length) { out.push(g[round]); added = true; }
      }
      if (!added) break;
      round++;
    }
    return out;
  }

  /*
   * Choose the questions for one course.
   *  bank:  array of questions { id, topic, ... }
   *  seen:  { cycle: number, ids: [questionIds already seen in this cycle] }
   *  count: how many to pick
   * Returns { questions, seen: newSeen, reset: bool }
   * Rules: never repeat a seen question until the whole bank has been seen,
   * then start a new cycle. Never the same question twice in one exam.
   */
  function pickForCourse(bank, seen, count, rng) {
    var valid = {};
    bank.forEach(function (q) { valid[q.id] = true; });
    var cycle = (seen && seen.cycle) || 0;
    var seenIds = ((seen && seen.ids) || []).filter(function (id) { return valid[id]; });
    var seenSet = {};
    seenIds.forEach(function (id) { seenSet[id] = true; });
    count = Math.min(count, bank.length);

    var unseen = bank.filter(function (q) { return !seenSet[q.id]; });
    if (unseen.length >= count) {
      var picked = balancedPick(unseen, count, rng);
      return {
        questions: shuffle(picked, rng),
        seen: { cycle: cycle, ids: seenIds.concat(picked.map(function (q) { return q.id; })) },
        reset: false
      };
    }
    // Not enough unseen questions left: use all of them, then start a new cycle
    // and top up from the rest of the bank (excluding the ones just used).
    var takenSet = {};
    unseen.forEach(function (q) { takenSet[q.id] = true; });
    var rest = bank.filter(function (q) { return !takenSet[q.id]; });
    var extra = balancedPick(rest, count - unseen.length, rng);
    return {
      questions: shuffle(unseen.concat(extra), rng),
      seen: { cycle: cycle + 1, ids: extra.map(function (q) { return q.id; }) },
      reset: true
    };
  }

  /* Build a full exam. banks: { CODE: [questions] }, seenAll: { CODE: seen } */
  function buildExam(courses, banks, seenAll, perCourse, rng) {
    var sections = [];
    var newSeen = {};
    courses.forEach(function (c) {
      var bank = banks[c.code] || [];
      var res = pickForCourse(bank, (seenAll || {})[c.code], perCourse, rng);
      newSeen[c.code] = res.seen;
      sections.push({
        code: c.code,
        items: res.questions.map(function (q) {
          return { id: q.id, perm: shuffle([0, 1, 2, 3], rng) }; // perm[displayIndex] = original option index
        })
      });
    });
    return { sections: sections, seen: newSeen };
  }

  /* Mark an exam. answers: { CODE: { itemIndex: displayIndex } } */
  function markExam(sections, answers, lookup) {
    var perCourse = {};
    var score = 0, total = 0;
    sections.forEach(function (s) {
      var a = (answers && answers[s.code]) || {};
      var c = 0, wrong = 0, skipped = 0;
      s.items.forEach(function (it, i) {
        var q = lookup(it.id);
        var chosen = a[i];
        if (chosen === undefined || chosen === null) { skipped++; return; }
        if (q && it.perm[chosen] === q.answer) c++; else wrong++;
      });
      perCourse[s.code] = { score: c, total: s.items.length, wrong: wrong, skipped: skipped };
      score += c; total += s.items.length;
    });
    var pct = total ? Math.round((score / total) * 1000) / 10 : 0;
    return { score: score, total: total, pct: pct, perCourse: perCourse };
  }

  /* Merge two seen records (e.g. Firestore and local backup): the higher
   * cycle wins; within the same cycle the ID lists are combined. */
  function mergeSeen(a, b) {
    var out = {};
    var keys = {};
    Object.keys(a || {}).forEach(function (k) { keys[k] = true; });
    Object.keys(b || {}).forEach(function (k) { keys[k] = true; });
    Object.keys(keys).forEach(function (k) {
      var x = (a || {})[k], y = (b || {})[k];
      if (!x) { out[k] = y; return; }
      if (!y) { out[k] = x; return; }
      var cx = x.cycle || 0, cy = y.cycle || 0;
      if (cx > cy) out[k] = x;
      else if (cy > cx) out[k] = y;
      else {
        var set = {}, ids = [];
        (x.ids || []).concat(y.ids || []).forEach(function (id) { if (!set[id]) { set[id] = true; ids.push(id); } });
        out[k] = { cycle: cx, ids: ids };
      }
    });
    return out;
  }

  var api = {
    shuffle: shuffle,
    balancedPick: balancedPick,
    pickForCourse: pickForCourse,
    buildExam: buildExam,
    markExam: markExam,
    mergeSeen: mergeSeen
  };
  root.CBTEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
