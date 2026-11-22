/*
 * Scientific calculator (opens over the exam).
 * Safe: expressions are worked out by a small parser below, never with eval().
 * Supports: + − × ÷, brackets, powers, √, x², 1/x, x!, %, sin cos tan and
 * their inverses (DEG or RAD), log, ln, 10ˣ, eˣ, π, e, EXP (×10ⁿ) and Ans.
 */
(function (root) {
  'use strict';

  /* ---------- parser ---------- */
  var FUNCS = {
    sin: 1, cos: 1, tan: 1, asin: 1, acos: 1, atan: 1, log: 1, ln: 1, sqrt: 1
  };

  function tokenize(s) {
    var out = [], i = 0;
    while (i < s.length) {
      var c = s[i];
      if (c === ' ') { i++; continue; }
      if (/[0-9.]/.test(c)) {
        var m = /^(\d*\.?\d*)(E[+-]?\d+)?/.exec(s.slice(i));
        if (!m[0] || m[0] === '.') throw new Error('bad number');
        if (m[1].split('.').length > 2) throw new Error('bad number');
        out.push({ t: 'num', v: parseFloat(m[1].replace(/^\./, '0.').replace(/\.$/, '') + (m[2] ? m[2].replace('E', 'e') : '')) });
        i += m[0].length;
        continue;
      }
      if (s.slice(i, i + 3) === 'Ans') { out.push({ t: 'ans' }); i += 3; continue; }
      var name = /^[a-z]+/.exec(s.slice(i));
      if (name && FUNCS[name[0]]) { out.push({ t: 'fn', v: name[0] }); i += name[0].length; continue; }
      if (c === 'π') { out.push({ t: 'const', v: Math.PI }); i++; continue; }
      if (c === 'e') { out.push({ t: 'const', v: Math.E }); i++; continue; }
      if ('+-*/^()!%'.indexOf(c) >= 0) { out.push({ t: c }); i++; continue; }
      throw new Error('bad character ' + c);
    }
    return out;
  }

  function factorial(n) {
    if (n < 0 || Math.floor(n) !== n || n > 170) throw new Error('factorial');
    var r = 1;
    for (var k = 2; k <= n; k++) r *= k;
    return r;
  }

  function evaluate(expr, opts) {
    opts = opts || {};
    var deg = opts.deg !== false;
    var ans = opts.ans || 0;
    // close any brackets the user left open
    var open = 0;
    for (var j = 0; j < expr.length; j++) { if (expr[j] === '(') open++; else if (expr[j] === ')') open--; }
    while (open-- > 0) expr += ')';
    var toks = tokenize(expr);
    var p = 0;
    var peek = function () { return toks[p]; };
    var take = function (t) { if (!toks[p] || (t && toks[p].t !== t)) throw new Error('syntax'); return toks[p++]; };
    var toRad = function (x) { return deg ? x * Math.PI / 180 : x; };
    var fromRad = function (x) { return deg ? x * 180 / Math.PI : x; };
    var startsPrimary = function (tk) { return tk && (tk.t === 'num' || tk.t === 'const' || tk.t === 'ans' || tk.t === 'fn' || tk.t === '('); };

    function expression() {
      var v = term();
      while (peek() && (peek().t === '+' || peek().t === '-')) {
        var op = take().t;
        var r = term();
        v = op === '+' ? v + r : v - r;
      }
      return v;
    }
    function term() {
      var v = unary();
      for (;;) {
        var tk = peek();
        if (tk && (tk.t === '*' || tk.t === '/')) {
          take();
          var r = unary();
          if (tk.t === '/' && r === 0) throw new Error('divide by zero');
          v = tk.t === '*' ? v * r : v / r;
        } else if (startsPrimary(tk)) {
          v = v * power(); // implicit multiplication: 2π, 3(4), 2sin(30)
        } else return v;
      }
    }
    // A minus sign binds less tightly than a power: -3^2 = -9 (like a scientific calculator).
    function unary() {
      if (peek() && peek().t === '-') { take(); return -unary(); }
      if (peek() && peek().t === '+') { take(); return unary(); }
      return power();
    }
    // Powers are right-associative and the exponent may have a sign: 2^-3, 2^3^2 = 2^9.
    function power() {
      var base = postfix();
      if (peek() && peek().t === '^') { take(); return Math.pow(base, unary()); }
      return base;
    }
    function postfix() {
      var v = primary();
      while (peek() && (peek().t === '!' || peek().t === '%')) {
        v = take().t === '!' ? factorial(v) : v / 100;
      }
      return v;
    }
    function primary() {
      var tk = take();
      if (tk.t === 'num' || tk.t === 'const') return tk.v;
      if (tk.t === 'ans') return ans;
      if (tk.t === '(') { var v = expression(); take(')'); return v; }
      if (tk.t === 'fn') {
        take('(');
        var x = expression();
        take(')');
        switch (tk.v) {
          case 'sin': return clean(Math.sin(toRad(x)));
          case 'cos': return clean(Math.cos(toRad(x)));
          case 'tan':
            if (deg && Math.abs(((x % 180) + 180) % 180 - 90) < 1e-12) throw new Error('tan undefined');
            return clean(Math.tan(toRad(x)));
          case 'asin': if (x < -1 || x > 1) throw new Error('domain'); return fromRad(Math.asin(x));
          case 'acos': if (x < -1 || x > 1) throw new Error('domain'); return fromRad(Math.acos(x));
          case 'atan': return fromRad(Math.atan(x));
          case 'log': if (x <= 0) throw new Error('domain'); return Math.log10(x);
          case 'ln': if (x <= 0) throw new Error('domain'); return Math.log(x);
          case 'sqrt': if (x < 0) throw new Error('domain'); return Math.sqrt(x);
        }
      }
      throw new Error('syntax');
    }
    // sin(180) should be 0, not 1.2e-16
    function clean(x) { return Math.abs(x) < 1e-12 ? 0 : x; }

    var result = expression();
    if (p !== toks.length) throw new Error('syntax');
    if (!isFinite(result) || isNaN(result)) throw new Error('math error');
    return result;
  }

  /* Pretty result: up to 10 significant figures, scientific notation when very big or small. */
  function format(x) {
    if (x === 0) return '0';
    var ax = Math.abs(x);
    if (ax >= 1e10 || ax < 1e-6) {
      var parts = x.toExponential(8).split('e');
      var mant = parts[0].replace(/\.?0+$/, '');
      return mant + ' × 10^' + parseInt(parts[1], 10);
    }
    var s = parseFloat(x.toPrecision(10)).toString();
    return s;
  }

  /* ---------- user interface ---------- */
  // Each key: label shown, text inserted, optional class.
  var KEYS = [
    [{ id: 'deg', l: 'DEG', c: 'ck-mode' }, { l: 'sin', i: 'sin(' }, { l: 'cos', i: 'cos(' }, { l: 'tan', i: 'tan(' }, { l: 'π', i: 'π' }],
    [{ l: 'sin⁻¹', i: 'asin(' }, { l: 'cos⁻¹', i: 'acos(' }, { l: 'tan⁻¹', i: 'atan(' }, { l: 'log', i: 'log(' }, { l: 'ln', i: 'ln(' }],
    [{ l: 'x²', i: '^2' }, { l: 'xʸ', i: '^' }, { l: '√', i: 'sqrt(' }, { l: '10ˣ', i: '10^(' }, { l: 'eˣ', i: 'e^(' }],
    [{ l: '(', i: '(' }, { l: ')', i: ')' }, { l: '1/x', i: '^(-1)' }, { l: 'x!', i: '!' }, { l: 'e', i: 'e' }],
    [{ l: '7', i: '7', c: 'ck-num' }, { l: '8', i: '8', c: 'ck-num' }, { l: '9', i: '9', c: 'ck-num' }, { l: '÷', i: '/', c: 'ck-op' }, { id: 'ac', l: 'AC', c: 'ck-danger' }],
    [{ l: '4', i: '4', c: 'ck-num' }, { l: '5', i: '5', c: 'ck-num' }, { l: '6', i: '6', c: 'ck-num' }, { l: '×', i: '*', c: 'ck-op' }, { id: 'del', l: '⌫', c: 'ck-op' }],
    [{ l: '1', i: '1', c: 'ck-num' }, { l: '2', i: '2', c: 'ck-num' }, { l: '3', i: '3', c: 'ck-num' }, { l: '−', i: '-', c: 'ck-op' }, { l: 'Ans', i: 'Ans' }],
    [{ l: '0', i: '0', c: 'ck-num' }, { l: '.', i: '.', c: 'ck-num' }, { l: 'EXP', i: 'E' }, { l: '+', i: '+', c: 'ck-op' }, { id: 'eq', l: '=', c: 'ck-eq' }]
  ];
  var PRETTY = [
    [/asin\(/g, 'sin⁻¹('], [/acos\(/g, 'cos⁻¹('], [/atan\(/g, 'tan⁻¹('], [/sqrt\(/g, '√('],
    [/\*/g, '×'], [/\//g, '÷'], [/-/g, '−'], [/E/g, 'ᴇ']
  ];

  var st = { tokens: [], ans: 0, deg: true, result: '', justEvaluated: false, open: false };
  var el = null;

  function exprString() { return st.tokens.join(''); }
  function pretty(s) { PRETTY.forEach(function (r) { s = s.replace(r[0], r[1]); }); return s; }

  function build() {
    if (el) return;
    el = document.createElement('div');
    el.id = 'calc-root';
    el.innerHTML =
      '<div class="calc-panel" role="dialog" aria-label="Scientific calculator">' +
      '<div class="calc-head"><span class="calc-title">Calculator</span>' +
      '<button type="button" class="calc-close" data-calc="close" aria-label="Close calculator">Close</button></div>' +
      '<div class="calc-display"><div class="calc-expr" id="calc-expr"></div><div class="calc-res" id="calc-res">0</div></div>' +
      '<div class="calc-keys">' +
      KEYS.map(function (row) {
        return row.map(function (kk) {
          return '<button type="button" class="ck ' + (kk.c || '') + '" data-calc="' + (kk.id || 'ins') + '"' +
            (kk.i !== undefined ? ' data-ins="' + kk.i.replace(/"/g, '&quot;') + '"' : '') + '>' + kk.l + '</button>';
        }).join('');
      }).join('') +
      '</div></div>';
    document.body.appendChild(el);
    el.addEventListener('click', function (e) {
      if (e.target === el) { close(); return; }
      var b = e.target.closest('[data-calc]');
      if (!b) return;
      press(b.getAttribute('data-calc'), b.getAttribute('data-ins'));
    });
  }

  function render() {
    document.getElementById('calc-expr').textContent = pretty(exprString()) || ' ';
    document.getElementById('calc-res').textContent = st.result || (st.tokens.length ? ' ' : '0');
    var m = el.querySelector('[data-calc="deg"]');
    if (m) m.textContent = st.deg ? 'DEG' : 'RAD';
  }

  function press(kind, ins) {
    if (kind === 'close') return close();
    if (kind === 'deg') { st.deg = !st.deg; return render(); }
    if (kind === 'ac') { st.tokens = []; st.result = ''; st.justEvaluated = false; return render(); }
    if (kind === 'del') { st.tokens.pop(); st.result = ''; st.justEvaluated = false; return render(); }
    if (kind === 'eq') {
      if (!st.tokens.length) return;
      try {
        var v = evaluate(exprString(), { deg: st.deg, ans: st.ans });
        st.ans = v;
        st.result = '= ' + format(v);
      } catch (err) {
        st.result = 'Error: check your entry';
      }
      st.justEvaluated = true;
      return render();
    }
    // After "=", a number starts a fresh sum; an operator continues from the answer.
    if (st.justEvaluated) {
      if (/^[+\-*/^!%]/.test(ins) || ins === '^2' || ins === '^(-1)') st.tokens = ['Ans'];
      else st.tokens = [];
      st.justEvaluated = false;
    }
    st.result = '';
    st.tokens.push(ins);
    render();
  }

  function onKey(e) {
    if (!st.open) return;
    var k = e.key;
    var map = { '*': '*', 'x': '*', '/': '/', '+': '+', '-': '-', '(': '(', ')': ')', '.': '.', '^': '^', '!': '!', '%': '%' };
    var handled = true;
    if (/^[0-9]$/.test(k)) press('ins', k);
    else if (map[k]) press('ins', map[k]);
    else if (k === 'Enter' || k === '=') press('eq');
    else if (k === 'Backspace') press('del');
    else if (k === 'Escape') close();
    else if (k === 'Delete') press('ac');
    else handled = false;
    // Stop the exam shortcuts (A, B, C, D, N, P) while the calculator is open.
    e.stopPropagation();
    if (handled) e.preventDefault();
  }

  function open() {
    build();
    st.open = true;
    el.classList.add('calc-open');
    render();
  }
  function close() {
    st.open = false;
    if (el) el.classList.remove('calc-open');
  }

  if (typeof document !== 'undefined') document.addEventListener('keydown', onKey, true);

  var api = { open: open, close: close, isOpen: function () { return st.open; }, evaluate: evaluate, format: format };
  root.CBTCalc = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
