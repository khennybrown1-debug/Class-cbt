/*
 * CBT Practice app: screens and behaviour.
 * Screens: login/sign up, dashboard, exam, result, corrections.
 * Uses: window.CBT_CONFIG (config.js), window.QUESTION_BANKS (questions),
 *       window.CBTEngine (engine.js), window.CBTStore (store.js).
 */
(function () {
  'use strict';

  var CFG = window.CBT_CONFIG || {};
  var E = window.CBTEngine;
  var Store = window.CBTStore;
  var LS = Store.LS;
  var $app = document.getElementById('app');

  /* ---------- question banks ---------- */
  var BANKS = {}, QMAP = {}, COURSES = [];
  (CFG.courses || []).forEach(function (c) {
    var b = (window.QUESTION_BANKS || {})[c.code];
    if (!b) { console.warn('No question file loaded for ' + c.code); return; }
    COURSES.push({ code: c.code, title: c.title || b.title, count: b.questions.length,
      topics: Array.from(new Set(b.questions.map(function (q) { return q.topic; }))) });
    BANKS[c.code] = b.questions;
    b.questions.forEach(function (q) { QMAP[q.id] = q; });
  });
  var PER_COURSE = Math.max(1, parseInt(CFG.questionsPerCourse, 10) || 45);
  var EXAM_MIN = parseFloat(CFG.examMinutes) > 0 ? parseFloat(CFG.examMinutes) : 120;
  function perCourseFor(code) { return Math.min(PER_COURSE, (BANKS[code] || []).length); }
  var TOTAL_Q = COURSES.reduce(function (n, c) { return n + perCourseFor(c.code); }, 0);
  var LETTERS = ['A', 'B', 'C', 'D'];

  /* ---------- state ---------- */
  var state = {
    view: 'loading',
    student: null,
    authTab: 'login',
    exam: null,
    timerId: null,
    submitting: false,
    lb: null,
    lbError: null,
    lbUnsub: null,
    rankInfo: null,
    seen: null,
    result: null,
    corr: { course: 0, filter: 'all' },
    historyPushed: false
  };

  /* ---------- storage keys ---------- */
  function k(name) { return 'cbt_' + name + '_' + (state.student ? state.student.sid : ''); }
  var SESSION_KEY = 'cbt_session_v1';

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pct(p) { p = Number(p) || 0; return (Math.round(p * 10) / 10) + '%'; }
  function initials(name) {
    var parts = String(name || '?').trim().split(/\s+/);
    return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }
  function firstName(name) { return String(name || '').trim().split(/\s+/)[0] || ''; }
  function clock(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    var mm = (m < 10 ? '0' : '') + m, ss = (x < 10 ? '0' : '') + x;
    return h > 0 ? h + ':' + mm + ':' + ss : mm + ':' + ss;
  }
  function duration(sec) {
    sec = Math.max(0, Math.round(sec));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    var out = [];
    if (h) out.push(h + (h === 1 ? ' hour' : ' hours'));
    if (m) out.push(m + (m === 1 ? ' minute' : ' minutes'));
    if (!h && (s || !out.length)) out.push(s + (s === 1 ? ' second' : ' seconds'));
    return out.join(' ');
  }
  function titleCase(s) {
    return s.toLowerCase().replace(/(^|[\s\-'.])([a-z])/g, function (m, a, b) { return a + b.toUpperCase(); });
  }
  function randId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function friendlyError(e) {
    var c = e && e.code;
    if (c === 'network' || c === 'timeout') return 'We could not reach the server. Check your internet connection and try again.';
    if (c === 'permission') return 'The server refused this request. Ask your class admin to check that the Firestore security rules were published.';
    if (c === 'index') return 'The database needs a quick setup step. Ask your class admin to check the README.';
    return 'Something went wrong. Please try again.';
  }

  var ICON = {
    logo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-6 h-6"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4M7 9l2 2 4-4"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" class="w-4 h-4"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
    logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M5 12l5 5 9-10"/></svg>',
    cross: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" class="w-4 h-4"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    trophy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><path d="M15 18l-6-6 6-6"/></svg>',
    left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M15 18l-6-6 6-6"/></svg>',
    calc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><rect x="5" y="2.5" width="14" height="19" rx="2.5"/><path d="M8.5 6.5h7M8.5 11h.01M12 11h.01M15.5 11h.01M8.5 14.5h.01M12 14.5h.01M15.5 14.5h.01M8.5 18h.01M12 18h.01M15.5 18h.01"/></svg>',
    right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M9 6l6 6-6 6"/></svg>'
  };

  /* ---------- toasts and modals ---------- */
  function toast(msg, kind, ms) {
    var root = document.getElementById('toast-root');
    if (!root) return;
    var cls = kind === 'danger' ? 'bg-red-600 text-white' : kind === 'warn' ? 'bg-amber-500 text-white'
      : kind === 'success' ? 'bg-green-600 text-white' : 'bg-blue-900 text-white';
    var el = document.createElement('div');
    el.className = 'toast pointer-events-auto rounded-xl px-4 py-3 shadow-lg text-sm font-semibold ' + cls;
    el.setAttribute('role', 'status');
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(function () { el.classList.add('toast-out'); setTimeout(function () { el.remove(); }, 300); }, ms || 3800);
  }

  function openModal(opts) {
    var root = document.getElementById('modal-root');
    root.innerHTML =
      '<div class="modal-backdrop fixed inset-0 z-50 bg-slate-900/50 flex items-end sm:items-center justify-center p-0 sm:p-4" data-modal-bg>' +
      '<div class="modal-panel bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl p-6 max-h-[90vh] overflow-y-auto' + (opts.center ? ' text-center' : '') + '" role="dialog" aria-modal="true">' +
      (opts.top || '') +
      '<h2 class="text-lg font-extrabold text-blue-900">' + esc(opts.title) + '</h2>' +
      '<div class="mt-3 text-slate-600 text-sm leading-relaxed">' + opts.body + '</div>' +
      '<div class="mt-6 flex flex-col-reverse sm:flex-row gap-3 ' + (opts.center ? 'sm:justify-center' : 'sm:justify-end') + '">' +
      (opts.actions || []).map(function (a, i) {
        var cls = a.primary ? 'btn btn-primary' : a.danger ? 'btn btn-danger' : 'btn btn-ghost';
        return '<button type="button" class="' + cls + '" data-modal-action="' + i + '">' + esc(a.label) + '</button>';
      }).join('') +
      '</div></div></div>';
    var bg = root.querySelector('[data-modal-bg]');
    bg.addEventListener('click', function (e) {
      if (e.target === bg && opts.dismissable !== false) closeModal();
      var b = e.target.closest('[data-modal-action]');
      if (b) {
        var a = opts.actions[+b.getAttribute('data-modal-action')];
        if (a.onClick) a.onClick(b); else closeModal();
      }
    });
    state.modalOpen = true;
    var first = root.querySelector('.btn-primary') || root.querySelector('button');
    if (first) setTimeout(function () { first.focus(); }, 30);
  }
  function closeModal() {
    document.getElementById('modal-root').innerHTML = '';
    state.modalOpen = false;
  }

  function setBusy(btn, busy, text) {
    if (!btn) return;
    if (busy) {
      btn.dataset.label = btn.dataset.label || btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>' + esc(text);
    } else {
      btn.disabled = false;
      if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
    }
  }

  /* ---------- shared pieces ---------- */
  function demoBanner() {
    if (Store.mode !== 'demo') return '';
    return '<div class="bg-blue-50 border-b border-blue-100 text-blue-900 text-xs sm:text-sm text-center px-4 py-2 font-semibold">' +
      'Demo mode: scores are saved only on this device.</div>';
  }
  function footer() {
    return '<footer class="text-center text-xs text-slate-400 py-8">' + esc(CFG.credit || 'Designed by Faruk Dynova') + '</footer>';
  }
  function avatar(name, cls) {
    return '<div class="avatar ' + (cls || '') + '">' + esc(initials(name)) + '</div>';
  }
  function setView(v) {
    if (window.CBTCalc) window.CBTCalc.close();
    state.view = v;
    document.body.setAttribute('data-view', v);
    window.scrollTo(0, 0);
    if (v !== 'dashboard') stopLeaderboard();
    if (v === 'dashboard') {
      state.historyPushed = false;
    } else if (!state.historyPushed) {
      try { history.pushState({ cbt: v }, ''); state.historyPushed = true; } catch (e) { /* ignore */ }
    }
  }

  /* =====================================================================
   *  BOOT
   * ===================================================================== */
  function renderLoading(text) {
    $app.innerHTML = '<div class="min-h-screen flex flex-col items-center justify-center gap-4 text-blue-900">' +
      '<div class="w-14 h-14 rounded-2xl bg-blue-700 text-white flex items-center justify-center shadow-lg">' + ICON.logo + '</div>' +
      '<div class="flex items-center gap-3 font-semibold"><span class="spinner spinner-blue"></span>' + esc(text || 'Loading...') + '</div></div>';
  }

  function boot() {
    renderLoading('Loading...');
    if (!COURSES.length) {
      $app.innerHTML = '<div class="p-8 text-center text-red-700 font-semibold">No question files were loaded. Check that the js/questions files are uploaded.</div>';
      return;
    }
    Store.init().then(function () {
      var sess = LS.get(SESSION_KEY, null);
      if (!sess || !sess.sid) return showAuth();
      var cached = LS.get('cbt_student_' + sess.sid, null);
      return Store.getStudentBySid(sess.sid).then(function (fresh) {
        return fresh || null;
      }, function () { return cached; }).then(function (st) {
        if (!st) { LS.del(SESSION_KEY); return showAuth(); }
        setStudent(st);
        return afterLogin();
      });
    }).catch(function (e) {
      console.error(e);
      $app.innerHTML = '<div class="min-h-screen flex items-center justify-center p-6"><div class="card p-6 max-w-sm text-center">' +
        '<h1 class="text-lg font-extrabold text-blue-900">Could not connect</h1>' +
        '<p class="mt-2 text-sm text-slate-600">' + esc(friendlyError(e)) + '</p>' +
        '<button type="button" class="btn btn-primary mt-5 w-full" data-action="reload">Try again</button></div></div>';
    });
  }

  function setStudent(st) {
    state.student = st;
    LS.set('cbt_student_' + st.sid, st);
    LS.set(SESSION_KEY, { sid: st.sid });
  }

  function afterLogin() {
    return retryPending().then(function () {
      // If the question files changed (e.g. a question was removed or a course renamed),
      // an unfinished exam or an old result may point to questions that no longer exist.
      var known = function (o) {
        return o && o.sections && o.sections.every(function (s) {
          return s.items.every(function (it) { return QMAP[it.id]; });
        });
      };
      var oldRes = LS.get(k('result'), null);
      if (oldRes && !known(oldRes)) LS.del(k('result'));
      var ex = LS.get(k('exam'), null);
      if (ex && !known(ex)) {
        LS.del(k('exam'));
        ex = null;
        toast('The questions were updated, so your unfinished exam was reset. Please start a new one.', 'info', 6000);
      }
      if (ex && ex.sid === state.student.sid && ex.sections) {
        state.exam = ex;
        if (Date.now() >= ex.endsAt) return submitExam(true);
        return showExam();
      }
      showDashboard();
    });
  }

  /* A result that could not be sent (offline) is retried here. */
  function retryPending() {
    if (!state.student) return Promise.resolve();
    var p = LS.get(k('pending'), null);
    if (!p) return Promise.resolve();
    return Store.submitAttempt(state.student.sid, p).then(function (r) {
      LS.del(k('pending'));
      setStudent(r.student);
      var last = LS.get(k('result'), null);
      if (last && last.examId === p.examId) { last.synced = true; last.improved = r.improved; LS.set(k('result'), last); }
      toast('Your last score has been added to the leaderboard.', 'success');
    }, function (e) { console.warn('Pending result not sent yet', e); });
  }

  /* =====================================================================
   *  AUTH SCREEN
   * ===================================================================== */
  function showAuth(tab) {
    setView('auth');
    state.authTab = tab || state.authTab || 'login';
    document.title = (CFG.siteName || 'CBT Practice') + ': Log in';
    var login = state.authTab === 'login';
    var pinOn = !!CFG.requirePin;
    var tabBtn = function (id, label) {
      var on = state.authTab === id;
      return '<button type="button" role="tab" aria-selected="' + on + '" data-action="auth-tab" data-tab="' + id + '" class="flex-1 py-2.5 rounded-xl text-sm font-bold transition ' +
        (on ? 'bg-white text-blue-700 shadow' : 'text-blue-900/70') + '">' + label + '</button>';
    };
    var field = function (id, label, attrs, hint) {
      return '<label class="block"><span class="text-sm font-semibold text-slate-700">' + label + '</span>' +
        '<input id="' + id + '" class="input mt-1.5" ' + attrs + '>' +
        (hint ? '<span class="block mt-1 text-xs text-slate-400">' + hint + '</span>' : '') + '</label>';
    };
    var fields = login
      ? field('f-matric', 'Matric number', 'autocomplete="username" autocapitalize="characters" placeholder="e.g. UG/24/0123"') +
        (pinOn ? field('f-pin', '4 digit PIN', 'type="password" inputmode="numeric" maxlength="4" autocomplete="current-password" placeholder="****"') : '')
      : field('f-name', 'Full name', 'autocomplete="name" autocapitalize="words" placeholder="e.g. Amina Bello"', 'First name and last name') +
        field('f-matric', 'Matric number', 'autocomplete="username" autocapitalize="characters" placeholder="e.g. UG/24/0123"', 'This cannot be changed later, so type it carefully.') +
        (pinOn ? field('f-pin', 'Choose a 4 digit PIN', 'type="password" inputmode="numeric" maxlength="4" autocomplete="new-password" placeholder="****"', 'You will need this PIN to log in.') +
          field('f-pin2', 'Type the PIN again', 'type="password" inputmode="numeric" maxlength="4" autocomplete="new-password" placeholder="****"') : '');

    $app.innerHTML =
      demoBanner() +
      '<div class="min-h-screen flex flex-col">' +
      '<div class="hero text-white text-center px-6 pt-12 pb-28">' +
      '<div class="mx-auto w-14 h-14 rounded-2xl bg-white/15 flex items-center justify-center ring-1 ring-white/30">' + ICON.logo + '</div>' +
      '<h1 class="mt-4 text-2xl sm:text-3xl font-extrabold tracking-tight">' + esc(CFG.siteName || 'CBT Practice') + '</h1>' +
      '<p class="mt-1 text-blue-100 font-semibold">' + esc(CFG.className || '') + '</p>' +
      '<p class="mt-3 text-sm text-blue-100/90 max-w-sm mx-auto">Practise JAMB style tests and see where you stand on one live class leaderboard.</p>' +
      '</div>' +
      '<div class="px-4 -mt-20 flex-1">' +
      '<div class="card max-w-md mx-auto p-5 sm:p-7 fade-in">' +
      '<div class="flex gap-1 p-1 bg-blue-50 rounded-2xl" role="tablist">' + tabBtn('login', 'Log in') + tabBtn('signup', 'Sign up') + '</div>' +
      '<div class="mt-6 space-y-4">' + fields + '</div>' +
      '<div id="auth-error" class="hidden mt-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-semibold px-4 py-3" role="alert"></div>' +
      '<button type="button" id="auth-submit" class="btn btn-primary w-full mt-6 text-base" data-action="' + (login ? 'login' : 'signup') + '">' +
      (login ? 'Log in' : 'Create account') + '</button>' +
      '<p class="mt-4 text-center text-sm text-slate-500">' +
      (login ? 'New here? <button type="button" class="link" data-action="auth-tab" data-tab="signup">Create an account</button>'
        : 'Already registered? <button type="button" class="link" data-action="auth-tab" data-tab="login">Log in</button>') +
      '</p></div></div>' + footer() + '</div>';
    var first = document.getElementById(login ? 'f-matric' : 'f-name');
    if (first && window.innerWidth > 640) first.focus();
  }

  function authError(msg) {
    var el = document.getElementById('auth-error');
    if (!el) return;
    if (!msg) { el.classList.add('hidden'); el.innerHTML = ''; return; }
    el.innerHTML = msg;
    el.classList.remove('hidden');
  }
  function val(id) { var el = document.getElementById(id); return el ? el.value : ''; }

  function validMatric(m) {
    if (!m) return 'Please enter your matric number.';
    if (m.length < 4 || m.length > 25) return 'Please enter a valid matric number.';
    if (!/^[A-Z0-9/\-.]+$/.test(m)) return 'A matric number can only contain letters, numbers and the symbols / - .';
    return '';
  }

  function doLogin(btn) {
    authError('');
    var matric = Store.normMatric(val('f-matric'));
    var pin = val('f-pin').trim();
    var bad = validMatric(matric);
    if (bad) return authError(esc(bad));
    if (CFG.requirePin && !/^\d{4}$/.test(pin)) return authError('Please enter your 4 digit PIN.');
    setBusy(btn, true, 'Logging in...');
    Store.getStudent(matric).then(function (st) {
      if (!st) {
        setBusy(btn, false);
        return authError('No account found for this matric number. Tap <b>Sign up</b> above to create one.');
      }
      var check = (CFG.requirePin && st.hasPin) ? Store.checkPin(st.sid, pin) : Promise.resolve(true);
      return check.then(function (ok) {
        if (!ok) { setBusy(btn, false); return authError('That PIN is not correct. Please try again.'); }
        setStudent(st);
        toast('Welcome back, ' + firstName(st.name) + '!', 'success');
        return afterLogin();
      });
    }).catch(function (e) { setBusy(btn, false); authError(esc(friendlyError(e))); });
  }

  function doSignup(btn) {
    authError('');
    var name = val('f-name').replace(/\s+/g, ' ').trim();
    var matric = Store.normMatric(val('f-matric'));
    var pin = val('f-pin').trim(), pin2 = val('f-pin2').trim();
    var parts = name.split(' ').filter(function (p) { return p.replace(/[^A-Za-z]/g, '').length >= 2; });
    if (!name) return authError('Please enter your full name.');
    if (!/^[A-Za-z][A-Za-z .'\-]*$/.test(name)) return authError('Your name can only contain letters, spaces, hyphens and apostrophes.');
    if (parts.length < 2) return authError('Please enter your full name: first name and last name (for example, Amina Bello).');
    if (name.length > 60) return authError('That name is too long. Please use your first and last name.');
    var bad = validMatric(matric);
    if (bad) return authError(esc(bad));
    if (CFG.requirePin) {
      if (!/^\d{4}$/.test(pin)) return authError('Your PIN must be exactly 4 digits.');
      if (pin !== pin2) return authError('The two PINs do not match. Please type them again.');
    }
    setBusy(btn, true, 'Creating account...');
    Store.createStudent({ name: titleCase(name), matric: matric, pin: CFG.requirePin ? pin : '' }).then(function (st) {
      setStudent(st);
      toast('Account created. Welcome, ' + firstName(st.name) + '!', 'success');
      return afterLogin();
    }).catch(function (e) {
      setBusy(btn, false);
      if (e && e.code === 'exists') return authError('This matric number already has an account. Tap <b>Log in</b> above to continue.');
      authError(esc(friendlyError(e)));
    });
  }

  function logout() {
    var hasExam = !!LS.get(k('exam'), null);
    openModal({
      title: 'Do you want to log out?',
      body: (hasExam ? '<p>You have an exam in progress. Its timer keeps running while you are logged out.</p>' : '') +
        '<p' + (hasExam ? ' class="mt-2"' : '') + '>Your scores are saved. You can log in again any time with your matric number.</p>',
      actions: [
        { label: 'Stay logged in', primary: true },
        { label: 'Yes, log out', danger: true, onClick: function () {
          closeModal();
          stopTimer();
          stopLeaderboard();
          LS.del(SESSION_KEY);
          state.student = null; state.exam = null; state.result = null; state.rankInfo = null; state.seen = null; state.lb = null;
          showAuth('login');
        } }
      ]
    });
  }

  /* =====================================================================
   *  DASHBOARD
   * ===================================================================== */
  function showDashboard() {
    stopTimer();
    setView('dashboard');
    document.title = CFG.siteName || 'CBT Practice';
    renderDashboard();
    startLeaderboard();
    refreshRank();
    Store.getSeen(state.student.sid).then(function (s) { state.seen = s || {}; renderSeen(); });
  }

  function renderDashboard() {
    var st = state.student;
    var ex = LS.get(k('exam'), null);
    var last = LS.get(k('result'), null);
    var examBtn = ex
      ? '<button type="button" class="btn btn-light w-full sm:w-auto text-base" data-action="resume-exam">Resume exam <span class="opacity-80 font-semibold">(' + clock(ex.endsAt - Date.now()) + ' left)</span></button>'
      : '<button type="button" class="btn btn-light w-full sm:w-auto text-base" data-action="start-exam">Start exam</button>';

    $app.innerHTML =
      demoBanner() +
      '<header class="bg-white/90 backdrop-blur sticky top-0 z-30 border-b border-blue-100">' +
      '<div class="max-w-6xl mx-auto px-4 h-14 flex items-center gap-3">' +
      '<div class="w-9 h-9 rounded-xl bg-blue-700 text-white flex items-center justify-center">' + ICON.logo + '</div>' +
      '<div class="leading-tight min-w-0"><div class="font-extrabold text-blue-900 truncate">' + esc(CFG.siteName || 'CBT Practice') + '</div>' +
      '<div class="text-xs text-slate-500">' + esc(CFG.className || '') + '</div></div>' +
      '<button type="button" class="ml-auto btn btn-ghost btn-sm" data-action="logout">' + ICON.logout + '<span>Log out</span></button>' +
      '</div></header>' +
      '<main class="max-w-6xl mx-auto px-4 py-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-start">' +
      '<div class="space-y-5 min-w-0">' +
      // Welcome card
      '<section class="hero-card rounded-3xl p-5 sm:p-6 text-white shadow-lg fade-in">' +
      '<div class="flex items-center gap-3">' + avatar(st.name, 'avatar-light w-12 h-12 text-lg') +
      '<div class="min-w-0"><p class="text-blue-100 text-sm font-semibold">Welcome back,</p>' +
      '<h1 class="text-xl sm:text-2xl font-extrabold truncate">' + esc(st.name) + '</h1>' +
      '<p class="text-blue-100 text-xs font-semibold tracking-wide">' + esc(st.matric) + '</p></div></div>' +
      '<div class="mt-5 grid grid-cols-3 gap-2 sm:gap-3" id="stats">' + statsHtml() + '</div>' +
      '<div class="mt-5 flex flex-col sm:flex-row gap-3 sm:items-center">' + examBtn +
      (last ? '<button type="button" class="btn btn-outline-light w-full sm:w-auto" data-action="last-result">View last result</button>' : '') +
      '</div>' +
      '<p class="mt-3 text-xs text-blue-100">' + COURSES.length + ' courses, ' + TOTAL_Q + ' questions, ' + EXAM_MIN + ' minutes. New questions every time.</p>' +
      '</section>' +
      '</div>' +
      // Leaderboard
      '<section class="card p-5 lg:row-span-2 min-w-0" id="lb-card">' +
      '<div class="flex items-center gap-2"><span class="text-blue-700">' + ICON.trophy + '</span><h2 class="section-title">Class leaderboard</h2>' +
      '<span id="lb-status" class="ml-auto">' + lbStatusHtml() + '</span></div>' +
      '<p class="text-xs text-slate-500 mt-1">Ranked by best score. If two students tie, the one who got it first ranks higher.</p>' +
      '<div id="lb" class="mt-4">' + leaderboardHtml() + '</div></section>' +
      '<div class="space-y-5 min-w-0">' +
      // Seen progress
      '<section class="card p-5"><h2 class="section-title">Your question progress</h2>' +
      '<p class="text-xs text-slate-500 mt-1">You will not see a question again until you have seen every question in that course.</p>' +
      '<div id="seen" class="mt-4 space-y-4">' + seenHtml() + '</div></section>' +
      // Instructions
      '<section class="card p-5"><h2 class="section-title">Exam instructions</h2><ol class="mt-3 space-y-2 text-sm text-slate-600 list-decimal pl-5">' +
      '<li>The exam has <b>' + COURSES.length + ' courses</b> with <b>' + PER_COURSE + ' questions each</b> (' + TOTAL_Q + ' in total).</li>' +
      '<li>You have <b>' + EXAM_MIN + ' minutes</b> for all courses together. The timer is always at the top.</li>' +
      '<li>Use the course tabs to switch courses. Each course is marked separately.</li>' +
      '<li>Questions come one at a time. Use <b>Previous</b> and <b>Next</b>, or tap a number in the question map to jump.</li>' +
      '<li>Answered questions turn <span class="text-blue-700 font-bold">blue</span> in the map. Unanswered ones stay white.</li>' +
      '<li>On a keyboard: press <b>A, B, C, D</b> to answer, <b>N</b> for next and <b>P</b> for previous.</li>' +
      '<li>If you refresh or close the page, your answers and timer are kept. When time runs out, your answers are submitted automatically.</li>' +
      '<li>After submitting, you get your score, corrections with explanations and your position on the leaderboard.</li>' +
      '</ol></section>' +
      // Courses
      '<section class="card p-5"><h2 class="section-title">Courses</h2><div class="mt-3 divide-y divide-blue-50">' +
      COURSES.map(function (c) {
        return '<div class="py-3 flex items-center gap-3"><div class="course-badge">' + esc(c.code) + '</div>' +
          '<div class="min-w-0"><div class="font-bold text-slate-800">' + esc(c.title) + '</div>' +
          '<div class="text-xs text-slate-500">' + c.count + ' questions in bank, ' + c.topics.length + ' topics, ' + perCourseFor(c.code) + ' per exam</div></div></div>';
      }).join('') + '</div></section>' +
      '</div></main>' + footer();
  }

  function statsHtml() {
    var st = state.student;
    var ri = state.rankInfo;
    var rank = '<span class="text-blue-200">-</span>';
    var rankSub = st.attempts ? 'loading' : 'no attempts yet';
    if (ri && ri.rank) { rank = '#' + ri.rank; rankSub = 'of ' + Math.max(ri.total || 0, ri.rank) + ' students'; }
    else if (ri && !st.attempts) { rankSub = 'take a test'; }
    var tile = function (label, value, sub) {
      return '<div class="rounded-2xl bg-white/10 ring-1 ring-white/20 px-3 py-3"><div class="text-[11px] uppercase tracking-wider text-blue-100 font-bold">' + label +
        '</div><div class="text-xl sm:text-2xl font-extrabold mt-0.5">' + value + '</div><div class="text-[11px] text-blue-100 truncate">' + sub + '</div></div>';
    };
    return tile('Rank', rank, rankSub) +
      tile('Best score', st.attempts ? pct(st.bestPct) : '<span class="text-blue-200">-</span>', st.attempts ? st.bestScore + '/' + st.bestTotal : 'no attempts yet') +
      tile('Attempts', String(st.attempts || 0), st.attempts ? 'last: ' + pct(st.lastPct) : 'start now');
  }
  function renderStats() { var el = document.getElementById('stats'); if (el) el.innerHTML = statsHtml(); }

  function seenHtml() {
    if (!state.seen) return '<div class="text-sm text-slate-400 flex items-center gap-2"><span class="spinner spinner-blue"></span>Loading...</div>';
    return COURSES.map(function (c) {
      var s = state.seen[c.code] || { cycle: 0, ids: [] };
      var valid = (s.ids || []).filter(function (id) { return QMAP[id]; }).length;
      var w = Math.min(100, Math.round(valid / c.count * 100));
      return '<div><div class="flex items-baseline justify-between gap-2 text-sm"><span class="font-bold text-slate-800">' + esc(c.code) +
        ' <span class="font-medium text-slate-500">' + esc(c.title) + '</span></span><span class="text-slate-600 whitespace-nowrap"><b class="text-blue-900">' + valid + '</b> of ' + c.count + ' seen</span></div>' +
        '<div class="bar mt-1.5"><div class="bar-fill" style="width:' + w + '%"></div></div>' +
        (s.cycle ? '<div class="text-[11px] text-blue-700 font-semibold mt-1">Round ' + (s.cycle + 1) + ': you have finished the whole bank ' + s.cycle + (s.cycle === 1 ? ' time' : ' times') + '</div>' : '') +
        '</div>';
    }).join('');
  }
  function renderSeen() { var el = document.getElementById('seen'); if (el) el.innerHTML = seenHtml(); }

  /* ---------- leaderboard ---------- */
  function lbStatusHtml() {
    if (state.lbError) return '<span class="status-pill bg-red-50 text-red-700"><span class="dot bg-red-500"></span>Offline</span>';
    if (Store.mode === 'demo') return '<span class="status-pill bg-blue-50 text-blue-800"><span class="dot bg-blue-500"></span>This device</span>';
    if (!state.lb) return '<span class="status-pill bg-slate-100 text-slate-600"><span class="dot bg-slate-400"></span>Connecting</span>';
    return '<span class="status-pill bg-green-50 text-green-700"><span class="dot dot-live bg-green-500"></span>Live</span>';
  }

  function leaderboardHtml() {
    if (state.lbError) return '<p class="text-sm text-red-700 bg-red-50 rounded-xl p-4">' + esc(friendlyError(state.lbError)) + '</p>';
    if (!state.lb) return '<div class="space-y-3">' + [0, 1, 2, 3].map(function () { return '<div class="skeleton h-12"></div>'; }).join('') + '</div>';
    var list = boardWithMe(state.lb);
    var me = state.student;
    if (!list.length) return '<div class="text-center py-10"><div class="mx-auto w-12 h-12 rounded-full bg-blue-50 text-blue-700 flex items-center justify-center">' + ICON.trophy + '</div>' +
      '<p class="mt-3 font-bold text-blue-900">No scores yet</p><p class="text-sm text-slate-500">Be the first to take the exam and lead the class!</p></div>';

    var podiumOrder = [1, 0, 2].filter(function (i) { return list[i]; });
    var medal = ['gold', 'silver', 'bronze'];
    var podium = '<div class="podium">' + podiumOrder.map(function (i) {
      var s = list[i];
      var mine = s.sid === me.sid;
      return '<div class="podium-col podium-' + medal[i] + (mine ? ' podium-me' : '') + '">' +
        '<div class="podium-avatar">' + esc(initials(s.name)) + '<span class="podium-rank">' + (i + 1) + '</span></div>' +
        '<div class="podium-name" title="' + esc(s.name) + '">' + esc(s.name) + (mine ? ' <span class="you-tag">You</span>' : '') + '</div>' +
        '<div class="podium-matric">' + esc(s.matric) + '</div>' +
        '<div class="podium-pct">' + pct(s.bestPct) + '</div>' +
        '<div class="podium-score">' + s.bestScore + '/' + s.bestTotal + '</div>' +
        '<div class="podium-block">' + (i + 1) + '</div></div>';
    }).join('') + '</div>';

    var rows = list.slice(3).map(function (s, j) {
      var pos = j + 4, mine = s.sid === me.sid;
      return '<li class="lb-row' + (mine ? ' lb-me' : '') + '">' +
        '<span class="lb-pos">' + pos + '</span>' + avatar(s.name, 'w-9 h-9 text-xs shrink-0') +
        '<div class="min-w-0 flex-1"><div class="font-bold text-slate-800 truncate text-sm">' + esc(s.name) + (mine ? ' <span class="you-tag">You</span>' : '') + '</div>' +
        '<div class="text-[11px] text-slate-500 truncate">' + esc(s.matric) + ' &middot; ' + s.attempts + (s.attempts === 1 ? ' attempt' : ' attempts') + '</div></div>' +
        '<div class="text-right shrink-0"><div class="font-extrabold text-blue-900 text-sm">' + pct(s.bestPct) + '</div><div class="text-[11px] text-slate-500">' + s.bestScore + '/' + s.bestTotal + '</div></div></li>';
    }).join('');

    var inList = list.some(function (s) { return s.sid === me.sid; });
    var mine = '';
    if (!inList) {
      var ri = state.rankInfo;
      if (!me.attempts) mine = 'Take your first exam to join the leaderboard.';
      else if (ri && ri.rank) mine = 'Your position: <b>#' + ri.rank + '</b> of ' + Math.max(ri.total, ri.rank) + ' with <b>' + pct(me.bestPct) + '</b>';
      else mine = 'Your best: <b>' + pct(me.bestPct) + '</b>. Working out your position...';
      mine = '<div class="mt-4 rounded-2xl bg-blue-50 ring-1 ring-blue-200 text-blue-900 text-sm px-4 py-3 text-center">' + mine + '</div>';
    }
    return podium + (rows ? '<ol class="mt-4 space-y-2">' + rows + '</ol>' : '') + mine;
  }

  /* Put my own latest record into the list straight away, so a new score
   * shows immediately even before the next live update arrives. */
  function boardWithMe(list) {
    var me = state.student;
    if (!me || !me.attempts) return list;
    var mine = list.filter(function (s) { return s.sid === me.sid; })[0];
    if (mine && mine.attempts >= me.attempts) return list;
    var out = list.filter(function (s) { return s.sid !== me.sid; }).concat([me]);
    out.sort(function (a, b) { return (b.bestPct - a.bestPct) || ((a.bestAt || 0) - (b.bestAt || 0)) || a.name.localeCompare(b.name); });
    return out.slice(0, Math.max(list.length, CFG.leaderboardSize || 100));
  }

  function renderLeaderboard() {
    var el = document.getElementById('lb');
    if (el) el.innerHTML = leaderboardHtml();
    var st = document.getElementById('lb-status');
    if (st) st.innerHTML = lbStatusHtml();
  }

  function startLeaderboard() {
    stopLeaderboard();
    state.lbError = null;
    try {
      state.lbUnsub = Store.subscribeLeaderboard(function (list) {
        state.lb = list;
        state.lbError = null;
        // Keep my own record fresh if the leaderboard has a newer copy.
        var mineFromList = list.filter(function (s) { return s.sid === state.student.sid; })[0];
        if (mineFromList && mineFromList.attempts >= state.student.attempts) {
          state.student = Object.assign({}, state.student, mineFromList);
          LS.set('cbt_student_' + state.student.sid, state.student);
        }
        var idx = boardWithMe(list).findIndex(function (s) { return s.sid === state.student.sid; });
        if (idx >= 0) {
          state.rankInfo = { rank: idx + 1, total: Math.max((state.rankInfo && state.rankInfo.total) || 0, list.length) };
        }
        renderLeaderboard();
        renderStats();
        if (state.rankInfo) maybeMedal(state.rankInfo.rank);
      }, function (e) {
        state.lbError = e;
        renderLeaderboard();
      });
    } catch (e) { state.lbError = e; renderLeaderboard(); }
  }
  function stopLeaderboard() {
    if (state.lbUnsub) { try { state.lbUnsub(); } catch (e) { /* ignore */ } }
    state.lbUnsub = null;
  }

  function refreshRank() {
    var me = state.student;
    return Store.getRank(me).then(function (ri) {
      // Prefer the exact position from the live list when I am in it.
      var idx = (state.lb || []).findIndex(function (s) { return s.sid === me.sid; });
      if (idx >= 0) ri.rank = idx + 1;
      state.rankInfo = ri;
      if (state.view === 'dashboard') { renderStats(); renderLeaderboard(); maybeMedal(ri.rank); }
      return ri;
    }).catch(function (e) { console.warn('rank', e); return null; });
  }

  /* ---------- medal pop-up for the top 3 ---------- */
  var MEDALS = {
    1: { name: 'gold', place: 'first', title: 'You are number 1!', still: 'You are still number 1!',
      msg: ['You are leading the whole class. Keep the crown!', 'Top of the class! Everyone is chasing you now.', 'First place is yours. Stay sharp and defend it!'] },
    2: { name: 'silver', place: 'second', title: 'You are in 2nd place!', still: 'You are still in 2nd place!',
      msg: ['Silver medal! The top spot is only one step away.', 'Second in the whole class. One more push and you are number 1!', 'Brilliant work. Keep practising and take the crown.'] },
    3: { name: 'bronze', place: 'third', title: 'You are in 3rd place!', still: 'You are still in 3rd place!',
      msg: ['You are on the podium! Keep climbing.', 'Bronze medal! You are among the best in the class.', 'Top 3 in the class. Keep going and aim higher!'] }
  };
  function sessGet(key) { try { return sessionStorage.getItem(key); } catch (e) { return null; } }
  function sessSet(key, v) { try { sessionStorage.setItem(key, v); } catch (e) { /* ignore */ } }

  /* Shows once per visit for each new position (1st, 2nd or 3rd). */
  function maybeMedal(rank) {
    var me = state.student;
    if (!me || !me.attempts || !rank || rank > 3) return;
    if (state.view !== 'dashboard' && state.view !== 'result') return;
    if (state.modalOpen) return;
    var sKey = 'cbt_medal_' + me.sid;
    if (sessGet(sKey) === String(rank)) return;
    sessSet(sKey, String(rank));
    var lastKey = 'cbt_lastmedal_' + me.sid;
    var still = String(LS.get(lastKey, '')) === String(rank);
    LS.set(lastKey, rank);
    var m = MEDALS[rank];
    var confetti = '';
    for (var i = 0; i < 14; i++) confetti += '<span class="confetti c' + (i % 7) + '" style="left:' + (6 + i * 6.5) + '%;animation-delay:' + (i % 5) * 0.12 + 's"></span>';
    openModal({
      center: true,
      title: still ? m.still : m.title,
      top: '<div class="medal-wrap">' + confetti +
        '<div class="medal medal-' + m.name + '"><span class="medal-ribbon"></span><span class="medal-disc">' + rank + '</span></div></div>',
      body: '<p class="text-base font-semibold text-slate-700">Congratulations, ' + esc(firstName(me.name)) + '! ' + esc(pick(m.msg)) + '</p>' +
        '<p class="mt-2">Best score: <b>' + pct(me.bestPct) + '</b> (' + me.bestScore + '/' + me.bestTotal + ')</p>',
      actions: [{ label: 'Thank you!', primary: true }]
    });
  }

  /* =====================================================================
   *  EXAM
   * ===================================================================== */
  function confirmStart() {
    openModal({
      title: 'Ready to start?',
      body: '<p>You will get <b>' + TOTAL_Q + ' questions</b> from <b>' + COURSES.length + ' courses</b> and <b>' + EXAM_MIN + ' minutes</b>. The timer starts as soon as you tap Start.</p>' +
        '<p class="mt-2">Find a quiet place and good luck!</p>',
      actions: [{ label: 'Not yet' }, { label: 'Start now', primary: true, onClick: function (b) { startExam(b); } }]
    });
  }

  function startExam(btn) {
    setBusy(btn, true, 'Preparing your questions...');
    var sid = state.student.sid;
    Store.getSeen(sid).then(function (seen) {
      var built = E.buildExam(COURSES, BANKS, seen, PER_COURSE);
      Store.saveSeen(sid, built.seen); // saved straight away so a refresh never re-rolls new questions
      state.seen = built.seen;
      var now = Date.now();
      var ex = {
        v: 1, sid: sid, examId: randId(), startedAt: now, endsAt: now + EXAM_MIN * 60000,
        sections: built.sections, answers: {}, cur: { c: 0, i: 0 }, warned: {}
      };
      state.exam = ex;
      saveExam();
      closeModal();
      showExam();
      toast('Your exam has started. Good luck!', 'success');
    }).catch(function (e) {
      setBusy(btn, false);
      toast(friendlyError(e), 'danger');
    });
  }

  function saveExam() { if (state.exam) LS.set(k('exam'), state.exam); }
  function stopTimer() { if (state.timerId) clearInterval(state.timerId); state.timerId = null; }

  function answeredCount(code, ex) {
    ex = ex || state.exam;
    var a = ex.answers[code] || {};
    return Object.keys(a).filter(function (x) { return a[x] !== null && a[x] !== undefined; }).length;
  }

  function showExam() {
    var ex = state.exam;
    setView('exam');
    document.title = 'Exam in progress';
    var st = state.student;
    $app.innerHTML =
      '<header class="exam-header sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-blue-100 shadow-sm">' +
      '<div class="max-w-6xl mx-auto px-3 sm:px-4 pt-2 flex items-center gap-2 sm:gap-3">' +
      '<button type="button" class="icon-btn" data-action="exam-home" aria-label="Go to dashboard">' + ICON.home + '</button>' +
      '<div class="min-w-0 leading-tight"><div class="text-sm font-extrabold text-blue-900 truncate">' + esc(st.name) + '</div>' +
      '<div class="text-[11px] text-slate-500 truncate">' + esc(st.matric) + '</div></div>' +
      '<button type="button" class="icon-btn ml-auto" data-action="calculator" aria-label="Open calculator" title="Calculator">' + ICON.calc + '</button>' +
      '<div id="timer" class="timer" role="timer" aria-live="off">' + ICON.clock + '<span id="timer-text">' + clock(ex.endsAt - Date.now()) + '</span></div>' +
      '<button type="button" class="btn btn-primary btn-sm" data-action="submit-exam">Submit</button>' +
      '</div>' +
      '<nav id="exam-tabs" class="tabs-fit max-w-6xl mx-auto px-3 sm:px-4 py-2 flex gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar" role="tablist"></nav>' +
      '</header>' +
      '<main class="max-w-6xl mx-auto px-3 sm:px-4 py-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">' +
      '<section id="q-card" class="card p-5 sm:p-6 min-w-0"></section>' +
      '<aside id="palette" class="card p-5 lg:sticky lg:top-32"></aside>' +
      '</main>';
    renderExamParts();
    stopTimer();
    tick();
    state.timerId = setInterval(tick, 1000);
  }

  function renderExamParts() { renderTabs(); renderQuestion(); renderPalette(); }

  function renderTabs() {
    var ex = state.exam;
    var el = document.getElementById('exam-tabs');
    if (!el) return;
    el.innerHTML = ex.sections.map(function (s, ci) {
      var on = ci === ex.cur.c;
      var done = answeredCount(s.code);
      return '<button type="button" role="tab" aria-selected="' + on + '" data-action="goto-course" data-c="' + ci + '" class="tab ' + (on ? 'tab-on' : '') + '">' +
        '<span class="font-extrabold">' + esc(s.code) + '</span><span class="tab-count">' + done + '/' + s.items.length + '</span></button>';
    }).join('');
    var active = el.querySelector('.tab-on');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function renderQuestion() {
    var ex = state.exam;
    var el = document.getElementById('q-card');
    if (!el) return;
    var sec = ex.sections[ex.cur.c];
    var it = sec.items[ex.cur.i];
    var q = QMAP[it.id];
    var chosen = (ex.answers[sec.code] || {})[ex.cur.i];
    var course = COURSES[ex.cur.c];
    var lastInCourse = ex.cur.i === sec.items.length - 1;
    var lastOverall = lastInCourse && ex.cur.c === ex.sections.length - 1;
    var firstOverall = ex.cur.i === 0 && ex.cur.c === 0;
    if (!q) {
      el.innerHTML = '<p class="text-red-700">This question could not be loaded. Tap Next to continue.</p>';
      return;
    }
    el.innerHTML =
      '<div class="flex flex-wrap items-center gap-2 text-xs font-bold">' +
      '<span class="text-blue-700 uppercase tracking-wider">' + esc(course.title) + '</span>' +
      '<span class="ml-auto chip">' + esc(q.topic) + '</span></div>' +
      '<div class="mt-3 text-sm font-bold text-slate-500">Question ' + (ex.cur.i + 1) + ' of ' + sec.items.length + '</div>' +
      '<p class="q-text mt-1">' + esc(q.q) + '</p>' +
      '<div class="mt-5 space-y-3" role="radiogroup">' +
      it.perm.map(function (orig, d) {
        var sel = chosen === d;
        return '<button type="button" role="radio" aria-checked="' + sel + '" class="opt' + (sel ? ' opt-on' : '') + '" data-action="answer" data-d="' + d + '">' +
          '<span class="opt-letter">' + LETTERS[d] + '</span><span class="opt-text">' + esc(q.options[orig]) + '</span></button>';
      }).join('') + '</div>' +
      '<div class="mt-3 h-6 text-right">' + (chosen !== undefined && chosen !== null ? '<button type="button" class="link text-xs" data-action="clear-answer">Clear my answer</button>' : '') + '</div>' +
      '<div class="mt-2 flex items-center gap-3">' +
      '<button type="button" class="btn btn-ghost" data-action="prev" ' + (firstOverall ? 'disabled' : '') + '>' + ICON.left + '<span>Previous</span></button>' +
      (lastOverall
        ? '<button type="button" class="btn btn-primary ml-auto" data-action="submit-exam"><span>Finish and submit</span></button>'
        : '<button type="button" class="btn btn-primary ml-auto" data-action="next"><span>' + (lastInCourse ? 'Next course' : 'Next') + '</span>' + ICON.right + '</button>') +
      '</div>' +
      '<p class="hidden sm:block mt-5 text-[11px] text-slate-400 text-center">Keyboard: A, B, C or D to answer. N for next, P for previous.</p>';
  }

  function renderPalette() {
    var ex = state.exam;
    var el = document.getElementById('palette');
    if (!el) return;
    var sec = ex.sections[ex.cur.c];
    var ans = ex.answers[sec.code] || {};
    el.innerHTML =
      '<div class="flex items-center justify-between"><h2 class="font-extrabold text-blue-900">' + esc(sec.code) + ' question map</h2>' +
      '<span class="text-xs font-bold text-slate-500">' + answeredCount(sec.code) + '/' + sec.items.length + ' answered</span></div>' +
      '<div class="mt-4 grid grid-cols-8 sm:grid-cols-10 lg:grid-cols-6 gap-2">' +
      sec.items.map(function (x, i) {
        var done = ans[i] !== undefined && ans[i] !== null;
        var cur = i === ex.cur.i;
        return '<button type="button" class="pal' + (done ? ' pal-done' : '') + (cur ? ' pal-cur' : '') + '" data-action="goto-q" data-i="' + i + '" aria-label="Question ' + (i + 1) + (done ? ', answered' : ', not answered') + '">' + (i + 1) + '</button>';
      }).join('') + '</div>' +
      '<div class="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-[11px] font-semibold text-slate-500">' +
      '<span class="flex items-center gap-1.5"><span class="legend pal-done"></span>Answered</span>' +
      '<span class="flex items-center gap-1.5"><span class="legend"></span>Not answered</span>' +
      '<span class="flex items-center gap-1.5"><span class="legend pal-cur"></span>Current</span></div>' +
      '<div class="mt-5 pt-4 border-t border-blue-50 text-center"><button type="button" class="link text-red-600 text-sm" data-action="quit-exam">Quit this exam (it will not count)</button></div>';
  }

  function go(c, i) {
    var ex = state.exam;
    ex.cur = { c: c, i: i };
    saveExam();
    renderExamParts();
    if (window.innerWidth < 1024) {
      var card = document.getElementById('q-card');
      if (card && card.getBoundingClientRect().top < 100) window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }
  function next() {
    var ex = state.exam, sec = ex.sections[ex.cur.c];
    if (ex.cur.i < sec.items.length - 1) go(ex.cur.c, ex.cur.i + 1);
    else if (ex.cur.c < ex.sections.length - 1) go(ex.cur.c + 1, 0);
  }
  function prev() {
    var ex = state.exam;
    if (ex.cur.i > 0) go(ex.cur.c, ex.cur.i - 1);
    else if (ex.cur.c > 0) go(ex.cur.c - 1, ex.sections[ex.cur.c - 1].items.length - 1);
  }
  function answer(d) {
    var ex = state.exam, code = ex.sections[ex.cur.c].code;
    ex.answers[code] = ex.answers[code] || {};
    ex.answers[code][ex.cur.i] = d;
    saveExam();
    renderExamParts();
  }
  function clearAnswer() {
    var ex = state.exam, code = ex.sections[ex.cur.c].code;
    if (ex.answers[code]) delete ex.answers[code][ex.cur.i];
    saveExam();
    renderExamParts();
  }

  function tick() {
    var ex = state.exam;
    if (!ex || state.view !== 'exam') return;
    var left = ex.endsAt - Date.now();
    var t = document.getElementById('timer');
    var tt = document.getElementById('timer-text');
    if (tt) tt.textContent = clock(left);
    if (left <= 0) {
      stopTimer();
      toast('Time is up! Your answers are being submitted.', 'danger', 5000);
      submitExam(true);
      return;
    }
    var warnMs = (CFG.warnAtMinutes || 10) * 60000, dangerMs = (CFG.dangerAtMinutes || 5) * 60000;
    if (t) {
      t.classList.toggle('timer-warn', left <= warnMs && left > dangerMs);
      t.classList.toggle('timer-danger', left <= dangerMs);
    }
    if (left <= warnMs && !ex.warned.w) {
      ex.warned.w = 1; saveExam();
      if (left > dangerMs) toast((CFG.warnAtMinutes || 10) + ' minutes left. Check the question map for unanswered questions.', 'warn', 6000);
    }
    if (left <= dangerMs && !ex.warned.d) {
      ex.warned.d = 1; saveExam();
      toast('Only ' + (CFG.dangerAtMinutes || 5) + ' minutes left! Your answers will be submitted automatically when time runs out.', 'danger', 7000);
    }
  }

  /* Quit (forfeit) an exam: nothing is recorded, and its questions go back
   * into the student's pool so they can still get them in a later exam. */
  function confirmQuit() {
    openModal({
      title: 'Quit this exam?',
      body: '<p>Your answers will be thrown away. This exam will <b>not</b> count on the leaderboard and will not be added to your attempts.</p>' +
        '<p class="mt-2">The questions go back into your question bank, so you can still get them in a later exam.</p>',
      actions: [
        { label: 'Keep going', primary: true },
        { label: 'Yes, quit exam', danger: true, onClick: function (b) { quitExam(b); } }
      ]
    });
  }

  function quitExam(btn) {
    var ex = state.exam || LS.get(k('exam'), null);
    if (!ex) { closeModal(); return showDashboard(); }
    setBusy(btn, true, 'Quitting...');
    stopTimer();
    var used = {};
    ex.sections.forEach(function (s) { s.items.forEach(function (it) { used[it.id] = true; }); });
    var sid = state.student.sid;
    Store.getSeen(sid).then(function (seen) {
      seen = seen || {};
      Object.keys(seen).forEach(function (code) {
        var s = seen[code];
        if (s && s.ids) s.ids = s.ids.filter(function (id) { return !used[id]; });
      });
      state.seen = seen;
      return Store.saveSeen(sid, seen);
    }).catch(function (e) { console.warn('Could not give questions back', e); }).then(function () {
      LS.del(k('exam'));
      state.exam = null;
      closeModal();
      showDashboard();
      toast('Exam quit. It was not counted.', 'info');
    });
  }

  function confirmSubmit() {
    var ex = state.exam;
    var totalUn = 0;
    var rows = ex.sections.map(function (s) {
      var un = s.items.length - answeredCount(s.code);
      totalUn += un;
      return '<li class="flex items-center justify-between py-2"><span class="font-bold text-slate-800">' + esc(s.code) + '</span>' +
        (un ? '<span class="text-red-600 font-bold">' + un + ' unanswered</span>' : '<span class="text-green-700 font-bold flex items-center gap-1">' + ICON.check + 'All answered</span>') + '</li>';
    }).join('');
    openModal({
      title: totalUn ? 'Submit with ' + totalUn + ' unanswered?' : 'Submit your exam?',
      body: '<p>You have answered <b>' + (TOTAL_Q - totalUn) + ' of ' + TOTAL_Q + '</b> questions. Time left: <b>' + clock(ex.endsAt - Date.now()) + '</b>.</p>' +
        '<ul class="mt-3 divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200 px-4">' + rows + '</ul>' +
        '<p class="mt-3">You cannot change your answers after submitting.</p>',
      actions: [{ label: 'Go back' }, { label: 'Yes, submit', primary: true, onClick: function () { closeModal(); submitExam(false); } }]
    });
  }

  var MESSAGES = {
    top: [
      'Outstanding! You are leading the class with scores like this. Keep the crown!',
      'Brilliant work! This is top of the class performance. Stay consistent and stay on top.',
      'You are a star! The rest of the class is now chasing you.',
      'Excellent! You clearly know your stuff. Keep shining at the top of the leaderboard.'
    ],
    close: [
      'Great job! You are very close to the top. A little more practice and you could be leading the class.',
      'Well done! The top spot is within reach. Review your corrections and push higher.',
      'Strong performance! You are among the best. One more push and you will be at the top.'
    ],
    half: [
      'Good effort! You are halfway there. Study the corrections carefully and try again.',
      'You are on the right track. Go through the corrections and your next score will be higher.',
      'Halfway there! Focus on the questions you missed and you will see a big improvement.'
    ],
    start: [
      'Every expert was once a beginner. Study the corrections and try again. You will improve.',
      'Do not give up! Every attempt teaches you something new. Check the corrections and keep going.',
      'Great things take time. Learn from the corrections and your next score will be better.',
      'This is just the start. Every practice test makes you stronger. Try again soon!'
    ]
  };
  function messageFor(p) {
    return pick(p >= 75 ? MESSAGES.top : p >= 60 ? MESSAGES.close : p >= 45 ? MESSAGES.half : MESSAGES.start);
  }

  function submitExam(auto) {
    var ex = state.exam || LS.get(k('exam'), null);
    if (!ex || state.submitting) return Promise.resolve();
    state.submitting = true;
    stopTimer();
    closeModal();
    var mark = E.markExam(ex.sections, ex.answers, function (id) { return QMAP[id]; });
    var timeUsedSec = Math.round((Math.min(Date.now(), ex.endsAt) - ex.startedAt) / 1000);
    var payload = { examId: ex.examId, score: mark.score, total: mark.total, pct: mark.pct, perCourse: mark.perCourse, timeUsedSec: timeUsedSec };
    var result = Object.assign({}, payload, {
      sections: ex.sections, answers: ex.answers, submittedAt: Date.now(), auto: !!auto,
      message: messageFor(mark.pct), synced: false, improved: false, rank: null, totalStudents: null,
      attemptsBefore: state.student.attempts
    });
    LS.set(k('result'), result);
    LS.del(k('exam'));
    state.exam = null;
    setView('submitting');
    renderLoading('Submitting your answers...');

    return Store.submitAttempt(state.student.sid, payload).then(function (r) {
      setStudent(r.student);
      result.synced = true;
      result.improved = r.improved;
      result.previousBest = r.previousBest;
      return Store.getRank(r.student).then(function (ri) {
        result.rank = ri.rank; result.totalStudents = ri.total;
      }, function () { /* rank is optional */ });
    }, function (e) {
      console.warn('Submit failed, saved for later', e);
      LS.set(k('pending'), payload);
      result.syncError = friendlyError(e);
    }).then(function () {
      LS.set(k('result'), result);
      state.result = result;
      state.submitting = false;
      showResult();
    });
  }

  /* =====================================================================
   *  RESULT
   * ===================================================================== */
  function ring(p) {
    var r = 52, c = 2 * Math.PI * r, off = c * (1 - Math.max(0, Math.min(100, p)) / 100);
    return '<svg viewBox="0 0 120 120" class="w-40 h-40 sm:w-44 sm:h-44 -rotate-90">' +
      '<circle cx="60" cy="60" r="' + r + '" fill="none" stroke="#dbeafe" stroke-width="12"/>' +
      '<circle class="ring-fg" cx="60" cy="60" r="' + r + '" fill="none" stroke="#1d4ed8" stroke-width="12" stroke-linecap="round" ' +
      'stroke-dasharray="' + c.toFixed(2) + '" stroke-dashoffset="' + c.toFixed(2) + '" data-off="' + off.toFixed(2) + '"/></svg>';
  }

  function showResult() {
    var res = state.result || LS.get(k('result'), null);
    if (!res) return showDashboard();
    state.result = res;
    setView('result');
    document.title = 'Your result';
    var st = state.student;
    var firstAttempt = res.attemptsBefore === 0;
    var badges = '';
    if (res.synced && res.improved) {
      badges += '<span class="badge badge-best">' + ICON.trophy + (firstAttempt ? 'You are on the leaderboard!' : 'New personal best!') + '</span>';
    }
    if (res.synced && res.rank) badges += '<span class="badge badge-rank">You\'re currently #' + res.rank + ' on the leaderboard</span>';

    $app.innerHTML =
      '<header class="bg-white/90 backdrop-blur sticky top-0 z-30 border-b border-blue-100"><div class="max-w-3xl mx-auto px-4 h-14 flex items-center gap-3">' +
      '<button type="button" class="icon-btn" data-action="dashboard" aria-label="Back to dashboard">' + ICON.back + '</button>' +
      '<h1 class="font-extrabold text-blue-900">Your result</h1></div></header>' +
      '<main class="max-w-3xl mx-auto px-4 py-5 space-y-5">' +
      (res.auto ? '<div class="rounded-2xl bg-amber-50 border border-amber-200 text-amber-800 text-sm font-semibold px-4 py-3">Time ran out, so your answers were submitted automatically.</div>' : '') +
      (!res.synced ? '<div class="rounded-2xl bg-amber-50 border border-amber-200 text-amber-800 text-sm px-4 py-3"><b>Not on the leaderboard yet.</b> ' + esc(res.syncError || '') +
        ' Your score is saved on this phone and will be sent automatically next time you open the site with internet.</div>' : '') +
      '<section class="card p-6 text-center fade-in">' +
      '<div class="relative mx-auto w-40 h-40 sm:w-44 sm:h-44">' + ring(res.pct) +
      '<div class="absolute inset-0 flex flex-col items-center justify-center"><div class="text-3xl sm:text-4xl font-extrabold text-blue-900">' + pct(res.pct) + '</div>' +
      '<div class="text-sm font-bold text-slate-500">' + res.score + ' / ' + res.total + '</div></div></div>' +
      '<p class="mt-4 text-slate-500 text-sm">' + esc(st.name) + ' &middot; ' + esc(st.matric) + '</p>' +
      '<div class="mt-3 flex flex-wrap justify-center gap-2">' + badges + '</div>' +
      '<div class="mt-5 grid grid-cols-2 gap-3 text-left">' +
      '<div class="rounded-2xl bg-blue-50 p-3"><div class="text-[11px] font-bold uppercase tracking-wider text-blue-700">Time used</div><div class="font-extrabold text-blue-900 text-sm mt-0.5">' + duration(res.timeUsedSec) + '</div></div>' +
      '<div class="rounded-2xl bg-blue-50 p-3"><div class="text-[11px] font-bold uppercase tracking-wider text-blue-700">Best score</div><div class="font-extrabold text-blue-900 text-sm mt-0.5">' + pct(st.bestPct) + ' (' + st.bestScore + '/' + st.bestTotal + ')</div></div>' +
      '</div></section>' +
      '<section class="rounded-3xl hero-card text-white p-5 sm:p-6 shadow-lg"><p class="text-xs font-bold uppercase tracking-wider text-blue-100">Message for you</p>' +
      '<p class="mt-2 text-lg font-bold leading-snug">' + esc(res.message) + '</p></section>' +
      revisionHtml(res) +
      '<section class="card p-5"><h2 class="section-title">Score per course</h2><div class="mt-4 space-y-5">' +
      res.sections.map(function (s) {
        var pc = res.perCourse[s.code] || { score: 0, total: s.items.length, wrong: 0, skipped: 0 };
        var p = pc.total ? Math.round(pc.score / pc.total * 1000) / 10 : 0;
        var c = COURSES.filter(function (x) { return x.code === s.code; })[0] || { title: s.code };
        return '<div><div class="flex items-baseline justify-between gap-3"><div class="min-w-0"><span class="font-extrabold text-slate-800">' + esc(s.code) + '</span> <span class="text-sm text-slate-500">' + esc(c.title) + '</span></div>' +
          '<div class="text-sm whitespace-nowrap"><b class="text-blue-900">' + pc.score + '/' + pc.total + '</b> <span class="text-slate-500">(' + pct(p) + ')</span></div></div>' +
          '<div class="bar mt-2"><div class="bar-fill" style="width:' + p + '%"></div></div>' +
          '<div class="mt-1.5 text-[11px] font-semibold text-slate-500 flex gap-3"><span class="text-green-700">' + pc.score + ' correct</span><span class="text-red-600">' + pc.wrong + ' wrong</span><span>' + pc.skipped + ' skipped</span></div></div>';
      }).join('') + '</div></section>' +
      '<div class="flex flex-col sm:flex-row gap-3">' +
      '<button type="button" class="btn btn-primary flex-1 text-base" data-action="corrections">View corrections</button>' +
      '<button type="button" class="btn btn-ghost flex-1 text-base" data-action="dashboard">Back to dashboard</button></div>' +
      '</main>' + footer();
    if (res.synced && res.rank && res.rank <= 3) setTimeout(function () { maybeMedal(res.rank); }, 1400);
    requestAnimationFrame(function () {
      var fg = document.querySelector('.ring-fg');
      if (fg) setTimeout(function () { fg.style.strokeDashoffset = fg.getAttribute('data-off'); }, 60);
    });
  }

  /* Topics the student missed questions in, weakest first. */
  function topicStats(res) {
    var out = [];
    res.sections.forEach(function (s, ci) {
      var by = {};
      s.items.forEach(function (it, i) {
        var q = QMAP[it.id];
        if (!q) return;
        var t = by[q.topic] = by[q.topic] || { course: s.code, ci: ci, topic: q.topic, total: 0, missed: 0 };
        t.total++;
        if (itemStatus(res, s.code, i, it) !== 'correct') t.missed++;
      });
      Object.keys(by).forEach(function (k2) { out.push(by[k2]); });
    });
    return out;
  }

  function revisionHtml(res) {
    var list = topicStats(res).filter(function (t) { return t.missed > 0; })
      .sort(function (a, b) { return (b.missed / b.total) - (a.missed / a.total) || b.missed - a.missed; });
    if (!list.length) {
      return '<section class="card p-5"><h2 class="section-title">Topics to revise</h2><p class="mt-2 text-sm text-slate-600">You got every question right. Excellent!</p></section>';
    }
    return '<section class="card p-5"><h2 class="section-title">Topics to revise</h2>' +
      '<p class="text-xs text-slate-500 mt-1">Topics where you missed questions, weakest first. Tap a topic to see those questions with the correct answers and explanations.</p>' +
      '<div class="mt-4 space-y-2">' +
      list.map(function (t) {
        var got = t.total - t.missed;
        var w = Math.round(got / t.total * 100);
        return '<button type="button" class="topic-row" data-action="revise-topic" data-c="' + t.ci + '" data-topic="' + esc(t.topic) + '">' +
          '<span class="course-badge course-badge-sm">' + esc(t.course) + '</span>' +
          '<span class="flex-1 min-w-0 text-left"><span class="block font-bold text-slate-800 text-sm truncate">' + esc(t.topic) + '</span>' +
          '<span class="block text-[11px] text-slate-500">Missed ' + t.missed + ' of ' + t.total + '</span>' +
          '<span class="bar mt-1.5 block"><span class="bar-fill block" style="width:' + w + '%"></span></span></span>' +
          '<span class="text-blue-700 shrink-0">' + ICON.right + '</span></button>';
      }).join('') + '</div></section>';
  }

  /* =====================================================================
   *  CORRECTIONS
   * ===================================================================== */
  function showCorrections() {
    var res = state.result || LS.get(k('result'), null);
    if (!res) return showDashboard();
    state.result = res;
    setView('corrections');
    document.title = 'Corrections';
    renderCorrections();
  }

  function itemStatus(res, code, i, it) {
    var chosen = (res.answers[code] || {})[i];
    var q = QMAP[it.id];
    if (chosen === undefined || chosen === null) return 'skipped';
    return q && it.perm[chosen] === q.answer ? 'correct' : 'wrong';
  }

  function renderCorrections() {
    var res = state.result;
    var ci = Math.min(state.corr.course, res.sections.length - 1);
    var sec = res.sections[ci];
    var counts = { all: sec.items.length, wrong: 0, skipped: 0, correct: 0 };
    sec.items.forEach(function (it, i) { counts[itemStatus(res, sec.code, i, it)]++; });
    var f = state.corr.filter;
    var filterBtn = function (id, label) {
      return '<button type="button" class="fchip ' + (f === id ? 'fchip-on' : '') + '" data-action="corr-filter" data-f="' + id + '">' + label + ' <span class="opacity-70">' + counts[id] + '</span></button>';
    };
    var topicF = state.corr.topic || '';
    var items = sec.items.map(function (it, i) {
      var status = itemStatus(res, sec.code, i, it);
      if (f !== 'all' && f !== status) return '';
      var q = QMAP[it.id];
      if (!q) return '';
      if (topicF && q.topic !== topicF) return '';
      var chosen = (res.answers[sec.code] || {})[i];
      var opts = it.perm.map(function (orig, d) {
        var isRight = orig === q.answer, isMine = chosen === d;
        var cls = isRight ? 'copt copt-right' : (isMine ? 'copt copt-wrong' : 'copt');
        var tag = isRight && isMine ? '<span class="ctag ctag-right">' + ICON.check + 'Your answer</span>'
          : isRight ? '<span class="ctag ctag-right">' + ICON.check + 'Correct answer</span>'
            : isMine ? '<span class="ctag ctag-wrong">' + ICON.cross + 'Your answer</span>' : '';
        return '<div class="' + cls + '"><span class="opt-letter">' + LETTERS[d] + '</span><span class="flex-1 min-w-0">' + esc(q.options[orig]) + '</span>' + tag + '</div>';
      }).join('');
      var badge = status === 'correct' ? '<span class="sbadge sbadge-right">Correct</span>' : status === 'wrong' ? '<span class="sbadge sbadge-wrong">Wrong</span>' : '<span class="sbadge sbadge-skip">Skipped</span>';
      return '<article class="card p-5"><div class="flex items-center gap-2 text-xs font-bold"><span class="text-blue-700">Question ' + (i + 1) + '</span>' + badge +
        '<span class="ml-auto chip">' + esc(q.topic) + '</span></div>' +
        '<p class="mt-2 font-bold text-slate-900 leading-relaxed">' + esc(q.q) + '</p>' +
        '<div class="mt-3 space-y-2">' + opts + '</div>' +
        '<div class="mt-3 rounded-xl bg-blue-50 text-blue-900 text-sm px-4 py-3"><b>Why:</b> ' + esc(q.explain) + '</div></article>';
    }).join('');

    $app.innerHTML =
      '<header class="bg-white/95 backdrop-blur sticky top-0 z-30 border-b border-blue-100 shadow-sm">' +
      '<div class="max-w-3xl mx-auto px-4 h-14 flex items-center gap-3">' +
      '<button type="button" class="icon-btn" data-action="result" aria-label="Back to result">' + ICON.back + '</button>' +
      '<h1 class="font-extrabold text-blue-900">Corrections</h1>' +
      '<button type="button" class="icon-btn ml-auto" data-action="calculator" aria-label="Open calculator" title="Calculator">' + ICON.calc + '</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-action="dashboard">Dashboard</button></div>' +
      '<nav class="tabs-fit max-w-3xl mx-auto px-4 pb-2 flex gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar">' +
      res.sections.map(function (s, i) {
        var pc = res.perCourse[s.code] || { score: 0, total: s.items.length };
        return '<button type="button" class="tab ' + (i === ci ? 'tab-on' : '') + '" data-action="corr-course" data-c="' + i + '"><span class="font-extrabold">' + esc(s.code) + '</span><span class="tab-count">' + pc.score + '/' + pc.total + '</span></button>';
      }).join('') + '</nav>' +
      '<div class="max-w-3xl mx-auto px-4 pb-3 flex gap-2 overflow-x-auto no-scrollbar">' +
      filterBtn('all', 'All') + filterBtn('wrong', 'Wrong') + filterBtn('skipped', 'Skipped') + filterBtn('correct', 'Correct') + '</div>' +
      (topicF ? '<div class="max-w-3xl mx-auto px-4 pb-3"><span class="topic-chip">Topic: ' + esc(topicF) +
        ' <button type="button" class="topic-chip-x" data-action="clear-topic" aria-label="Show all topics">' + ICON.cross + '</button></span></div>' : '') +
      '</header>' +
      '<main class="max-w-3xl mx-auto px-4 py-5 space-y-4">' +
      (items || '<div class="card p-8 text-center text-slate-500">No questions in this list.</div>') +
      '<button type="button" class="btn btn-ghost w-full" data-action="dashboard">Back to dashboard</button>' +
      '</main>';
  }

  /* =====================================================================
   *  EVENTS
   * ===================================================================== */
  var actions = {
    'reload': function () { location.reload(); },
    'auth-tab': function (el) { showAuth(el.getAttribute('data-tab')); },
    'login': doLogin,
    'signup': doSignup,
    'logout': logout,
    'start-exam': confirmStart,
    'resume-exam': function () {
      var ex = LS.get(k('exam'), null);
      if (!ex) return showDashboard();
      state.exam = ex;
      if (Date.now() >= ex.endsAt) return submitExam(true);
      showExam();
    },
    'last-result': function () { state.result = LS.get(k('result'), null); showResult(); },
    'exam-home': function () {
      openModal({
        title: 'Leave the exam page?',
        body: 'Your answers are saved, but the timer keeps running. You can come back with the <b>Resume exam</b> button on the dashboard.',
        actions: [
          { label: 'Stay here', primary: true },
          { label: 'Go to dashboard', onClick: function () { closeModal(); saveExam(); state.exam = null; showDashboard(); } },
          { label: 'Quit exam', danger: true, onClick: function () { confirmQuit(); } }
        ]
      });
    },
    'quit-exam': function () { confirmQuit(); },
    'goto-course': function (el) { go(+el.getAttribute('data-c'), state.exam.cur.c === +el.getAttribute('data-c') ? state.exam.cur.i : 0); },
    'goto-q': function (el) { go(state.exam.cur.c, +el.getAttribute('data-i')); },
    'answer': function (el) { answer(+el.getAttribute('data-d')); },
    'clear-answer': clearAnswer,
    'calculator': function () { if (window.CBTCalc) window.CBTCalc.open(); },
    'next': next,
    'prev': prev,
    'submit-exam': confirmSubmit,
    'dashboard': function () { showDashboard(); },
    'result': function () { showResult(); },
    'corrections': function () { state.corr = { course: 0, filter: 'all', topic: '' }; showCorrections(); },
    'revise-topic': function (el) { state.corr = { course: +el.getAttribute('data-c'), filter: 'all', topic: el.getAttribute('data-topic') }; showCorrections(); },
    'clear-topic': function () { state.corr.topic = ''; renderCorrections(); },
    'corr-course': function (el) { state.corr.course = +el.getAttribute('data-c'); state.corr.topic = ''; renderCorrections(); window.scrollTo(0, 0); },
    'corr-filter': function (el) { state.corr.filter = el.getAttribute('data-f'); renderCorrections(); }
  };

  $app.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    var fn = actions[el.getAttribute('data-action')];
    if (fn) { e.preventDefault(); fn(el); }
  });

  // Enter key submits the login / sign up form (no <form> element is used).
  $app.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && state.view === 'auth' && e.target.tagName === 'INPUT') {
      e.preventDefault();
      var b = document.getElementById('auth-submit');
      if (b && !b.disabled) b.click();
    }
  });

  // Exam keyboard shortcuts
  document.addEventListener('keydown', function (e) {
    if (state.view !== 'exam' || !state.exam || state.modalOpen) return;
    if (window.CBTCalc && window.CBTCalc.isOpen()) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    var key = e.key.toLowerCase();
    var idx = LETTERS.map(function (x) { return x.toLowerCase(); }).indexOf(key);
    if (idx >= 0) { e.preventDefault(); answer(idx); }
    else if (key === 'n' || e.key === 'ArrowRight') { e.preventDefault(); next(); }
    else if (key === 'p' || e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.modalOpen) closeModal();
  });

  // Warn before leaving the page during an exam.
  window.addEventListener('beforeunload', function (e) {
    if (state.view === 'exam' && state.exam) {
      saveExam();
      e.preventDefault();
      e.returnValue = '';
      return '';
    }
  });

  // Phone back button: never leave the exam by accident.
  window.addEventListener('popstate', function () {
    state.historyPushed = false;
    if (state.view === 'exam' && state.exam) {
      try { history.pushState({ cbt: 'exam' }, ''); state.historyPushed = true; } catch (e) { /* ignore */ }
      toast('Your exam is still running. Use Submit when you are done.', 'info');
    } else if (state.view === 'corrections') {
      showResult();
    } else if (state.view === 'result') {
      showDashboard();
    }
  });

  // When the phone comes back online, send any saved result.
  window.addEventListener('online', function () {
    if (state.student) retryPending().then(function () { if (state.view === 'dashboard') { renderStats(); refreshRank(); } });
  });

  // Timer catches up immediately when the tab becomes visible again.
  document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });

  // Small hooks for automated tests.
  window.CBTApp = { state: state, COURSES: COURSES, QMAP: QMAP, messageFor: messageFor };

  boot();
})();
