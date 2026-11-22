// Calculator maths tests:  node calculator.test.cjs
const C = require('../js/calculator.js');
const cases = [
  ['2+3*4', 14], ['(2+3)*4', 20], ['2^10', 1024], ['2^-1', 0.5], ['-3^2', -9], ['sqrt(16)', 4], ['9^(-1)', 1 / 9],
  ['sin(30)', 0.5], ['cos(60)', 0.5], ['tan(45)', 1], ['sin(180)', 0], ['asin(0.5)', 30], ['atan(1)', 45],
  ['log(1000)', 3], ['ln(e)', 1], ['10^(2)', 100], ['e^(0)', 1], ['5!', 120], ['50%', 0.5], ['2π', 2 * Math.PI],
  ['6.02E23*2', 1.204e24], ['1.6E-19*2', 3.2e-19], ['3(4)', 12], ['2sin(30)', 1], ['(2+3', 5], ['Ans*2', 20],
  ['0.693/5', 0.1386], ['22.4*0.25', 5.6], ['(8.314*300)/101325', 0.024615]
];
let pass = 0, fail = 0;
for (const [expr, want] of cases) {
  let got;
  try { got = C.evaluate(expr, { deg: true, ans: 10 }); } catch (e) { got = 'ERR ' + e.message; }
  const ok = typeof got === 'number' && Math.abs(got - want) <= Math.abs(want) * 1e-4 + 1e-9;
  ok ? pass++ : fail++;
  if (!ok) console.log('  FAIL', expr, '=>', got, 'expected', want);
}
// radians mode
const r = C.evaluate('sin(π/2)', { deg: false });
Math.abs(r - 1) < 1e-12 ? pass++ : (fail++, console.log('  FAIL radians', r));
// errors must not crash
for (const bad of ['5/0', 'sqrt(-1)', 'log(0)', '2++*', 'tan(90)', 'asin(2)']) {
  try { C.evaluate(bad, { deg: true }); fail++; console.log('  FAIL should be an error:', bad); } catch (e) { pass++; }
}
console.log('format:', C.format(6.02e23), '|', C.format(0.1386), '|', C.format(1 / 3));
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
