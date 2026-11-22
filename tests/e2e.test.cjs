// End-to-end browser tests (Playwright + Firestore emulator).
//   cd tests && npm install && npm run e2e
// Screenshots are written to tests/screenshots/.
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(__dirname, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const FIREBASE_DIR = path.join(__dirname, 'node_modules', 'firebase');
const WITH_EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST;

// Tailwind CSS compiled once and served in place of the Tailwind CDN (blocked in CI sandboxes).
const twIn = path.join(__dirname, '.tw-in.css'), twOut = path.join(__dirname, '.tw-out.css');
fs.writeFileSync(twIn, '@tailwind base;@tailwind components;@tailwind utilities;');
execFileSync(path.join(__dirname, 'node_modules', '.bin', 'tailwindcss'), ['-c', path.join(ROOT, 'tailwind.config.js'), '-i', twIn, '-o', twOut, '--minify'], { cwd: ROOT, stdio: 'pipe' });
const TW_CSS = fs.readFileSync(twOut, 'utf8');
fs.unlinkSync(twIn); fs.unlinkSync(twOut);

// ---------- tiny static server ----------
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

let passed = 0, failed = 0;
const errors = [];
async function t(name, fn) {
  try { await fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + String(e && e.stack || e).split('\n').slice(0, 3).join('\n       ')); }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const baseConfig = fs.readFileSync(path.join(ROOT, 'js/config.js'), 'utf8');
function configWith(overrides) {
  return baseConfig + '\nObject.assign(window.CBT_CONFIG, ' + JSON.stringify(overrides) + ');\n';
}

async function newPhone(browser, { config, label }) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[${label}] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|ERR_|net::|Failed to load resource|PERMISSION_DENIED|GrpcConnection/.test(m.text())) errors.push(`[${label}] console: ${m.text()}`); });
  page.on('dialog', (d) => { page._lastDialog = d.type(); d.accept().catch(() => {}); });
  // Close the top-3 medal pop-up automatically (it is tested on its own in section H).
  await page.addInitScript(() => {
    new MutationObserver(() => {
      if (window.__keepMedal) return;
      const b = document.querySelector('.medal') && document.querySelector('.modal-panel .btn-primary');
      if (b) { window.__medals = (window.__medals || 0) + 1; b.click(); }
    }).observe(document, { childList: true, subtree: true });
  });
  await page.route('https://cdn.tailwindcss.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.tailwind={};document.head.insertAdjacentHTML("beforeend",' + JSON.stringify('<style>' + TW_CSS + '</style>') + ');' }));
  await page.route('https://www.gstatic.com/firebasejs/**', (r) => {
    const file = path.join(FIREBASE_DIR, path.basename(new URL(r.request().url()).pathname));
    return fs.existsSync(file) ? r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(file, 'utf8') }) : r.abort();
  });
  await page.route('https://fonts.googleapis.com/**', (r) => r.abort());
  if (config) await page.route('**/js/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: config }));
  return { ctx, page };
}

// ---------- page helpers ----------
const S = (page, fn, arg) => page.evaluate(fn, arg);
async function signup(page, name, matric, pin) {
  await page.click('[data-action=auth-tab][data-tab=signup]');
  await page.fill('#f-name', name);
  await page.fill('#f-matric', matric);
  if (pin) { await page.fill('#f-pin', pin); await page.fill('#f-pin2', pin); }
  await page.click('#auth-submit');
}
async function login(page, matric, pin) {
  await page.click('[data-action=auth-tab][data-tab=login]');
  await page.fill('#f-matric', matric);
  if (pin !== undefined) await page.fill('#f-pin', pin);
  await page.click('#auth-submit');
}
async function logout(page) {
  await page.click('[data-action=logout]');
  await page.click('[data-modal-action="1"]');
  await page.waitForSelector('#auth-submit');
}
async function startExam(page) {
  await page.click('[data-action=start-exam]');
  await page.click('.modal-panel .btn-primary');
  await page.waitForSelector('#q-card .opt');
}
async function correctIndex(page) {
  return S(page, () => {
    const A = window.CBTApp, ex = A.state.exam, sec = ex.sections[ex.cur.c], it = sec.items[ex.cur.i];
    return it.perm.indexOf(A.QMAP[it.id].answer);
  });
}
async function answerN(page, n, { correct = true } = {}) {
  for (let i = 0; i < n; i++) {
    const c = await correctIndex(page);
    const d = correct ? c : (c + 1) % 4;
    await page.click(`#q-card [data-action=answer][data-d="${d}"]`);
    await page.click('#q-card [data-action=next]');
  }
}
async function submit(page) {
  await page.click('header [data-action=submit-exam]');
  await page.waitForSelector('.modal-panel');
  const body = await page.textContent('.modal-panel');
  await page.click('.modal-panel .btn-primary');
  await page.waitForSelector('[data-action=corrections]', { timeout: 20000 });
  return body;
}
async function noHorizontalScroll(page) {
  const w = await S(page, () => document.documentElement.scrollWidth);
  assert(w <= 390, 'page is ' + w + 'px wide at a 390px viewport');
}
const shot = async (page, name) => { await sleep(450); return page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: false }); };
const timerSeconds = (txt) => txt.split(':').map(Number).reduce((a, b) => a * 60 + b, 0);

(async () => {
  await new Promise((r) => server.listen(5179, r));
  const URL_DEV = 'http://localhost:5179/index.html';
  const URL_ONE = 'http://localhost:5179/single-file/index.html';
  const browser = await chromium.launch();

  // =================================================================
  console.log('\nA. Demo mode, full flow on a 390px phone');
  // =================================================================
  const { ctx: ctxA, page } = await newPhone(browser, { label: 'demo' });
  await page.goto(URL_DEV);
  await page.waitForSelector('#auth-submit');

  await t('login screen shows demo banner and footer credit', async () => {
    const txt = await page.textContent('body');
    assert(txt.includes('Demo mode: scores are saved only on this device.'), 'no demo banner');
    assert(txt.includes('Designed by Faruk Dynova'), 'no credit');
    await noHorizontalScroll(page);
    await shot(page, '01-login');
  });
  await t('sign up rejects a single name', async () => {
    await signup(page, 'Amina', 'UG/24/0001');
    assert((await page.textContent('#auth-error')).includes('first name and last name'));
  });
  await t('sign up works, shows "Creating account..." and tidies the name', async () => {
    await page.fill('#f-name', '  amina   bello ');
    await page.fill('#f-matric', 'ug/24/0001');
    await Promise.all([
      page.waitForFunction(() => (document.getElementById('auth-submit') || {}).textContent === 'Creating account...', null, { timeout: 3000 }),
      page.click('#auth-submit')
    ]);
    await page.waitForSelector('[data-action=start-exam]');
    const txt = await page.textContent('body');
    assert(txt.includes('Amina Bello') && txt.includes('UG/24/0001'), 'name/matric not shown');
  });
  await t('dashboard shows stats, seen progress, instructions, courses, credit', async () => {
    await page.waitForSelector('#seen .bar');
    const txt = await page.textContent('body');
    for (const s of ['Rank', 'Best score', 'Attempts', '0 of 332 seen', '0 of 303 seen', 'Exam instructions', 'Use of English', 'Primary Health Care', 'General Chemistry', 'Action and Use of Medicine', 'Designed by Faruk Dynova', 'No scores yet'])
      assert(txt.includes(s), 'missing: ' + s);
    await noHorizontalScroll(page);
  });
  await t('log out, then unknown matric shows the "No account found" message', async () => {
    await logout(page);
    await login(page, 'UG/24/9999');
    await page.waitForFunction(() => !document.getElementById('auth-error').classList.contains('hidden'));
    assert((await page.textContent('#auth-error')).includes('No account found for this matric number. Tap Sign up above to create one.'));
  });
  await t('signing up with an existing matric shows the "already has an account" message', async () => {
    await signup(page, 'Someone Else', 'UG/24/0001');
    await page.waitForFunction(() => !document.getElementById('auth-error').classList.contains('hidden'));
    assert((await page.textContent('#auth-error')).includes('This matric number already has an account. Tap Log in above to continue.'));
  });
  await t('log in with matric (Enter key) shows "Logging in..." and opens dashboard', async () => {
    await page.click('[data-action=auth-tab][data-tab=login]');
    await page.fill('#f-matric', 'ug/24/0001');
    await Promise.all([
      page.waitForFunction(() => (document.getElementById('auth-submit') || {}).textContent === 'Logging in...', null, { timeout: 3000 }),
      page.press('#f-matric', 'Enter')
    ]);
    await page.waitForSelector('[data-action=start-exam]');
    await shot(page, '02-dashboard-empty');
  });

  let timerBefore = 0;
  await t('start exam: 4 course tabs with 0/45, timer, question with 4 options', async () => {
    await startExam(page);
    const tabs = await page.$$eval('#exam-tabs .tab', (els) => els.map((e) => e.textContent.replace(/\s+/g, '')));
    assert(JSON.stringify(tabs) === JSON.stringify(['GNS0/45', 'PHC0/45', 'CHM0/45', 'AUM0/45']), JSON.stringify(tabs));
    assert((await page.$$('#q-card .opt')).length === 4);
    assert((await page.$$('#palette .pal')).length === 45);
    const tt = await page.textContent('#timer-text');
    assert(timerSeconds(tt) > 119 * 60 && timerSeconds(tt) <= 120 * 60, 'timer ' + tt);
    await noHorizontalScroll(page);
    await shot(page, '03-exam');
  });
  await t('tapping an option marks it, updates tab count and palette (blue)', async () => {
    await page.click('#q-card [data-action=answer][data-d="2"]');
    assert(await page.$('#q-card .opt-on[data-d="2"]'));
    assert((await page.textContent('#exam-tabs .tab-on')).includes('1/45'));
    assert(await page.$('#palette .pal[data-i="0"].pal-done.pal-cur'));
  });
  await t('keyboard: B answers, N next, P previous', async () => {
    await page.keyboard.press('b');
    assert(await page.$('#q-card .opt-on[data-d="1"]'), 'B did not select option B');
    await page.keyboard.press('n');
    assert((await page.textContent('#q-card')).includes('Question 2 of 45'));
    await page.keyboard.press('p');
    assert((await page.textContent('#q-card')).includes('Question 1 of 45'));
  });
  await t('palette jump goes straight to question 30', async () => {
    await page.click('#palette .pal[data-i="29"]');
    assert((await page.textContent('#q-card')).includes('Question 30 of 45'));
    await page.click('#palette .pal[data-i="0"]');
  });
  await t('answer 20 GNS correctly, switch to PHC tab and answer 10 correctly', async () => {
    await page.click('#palette .pal[data-i="0"]');
    await answerN(page, 20);
    await page.click('#exam-tabs .tab[data-c="1"]');
    assert((await page.textContent('#q-card')).includes('Primary Health Care'));
    await answerN(page, 10);
    const tabs = await page.$$eval('#exam-tabs .tab', (els) => els.map((e) => e.textContent.replace(/\s+/g, '')));
    assert(tabs[0] === 'GNS20/45' && tabs[1] === 'PHC10/45', JSON.stringify(tabs));
    timerBefore = timerSeconds(await page.textContent('#timer-text'));
  });
  await t('refresh mid-exam: warning shown, timer keeps counting, answers kept', async () => {
    await sleep(2100);
    await page.reload();
    await page.waitForSelector('#q-card .opt');
    assert(page._lastDialog === 'beforeunload', 'no leave-page warning (got ' + page._lastDialog + ')');
    const after = timerSeconds(await page.textContent('#timer-text'));
    assert(after < timerBefore && after > timerBefore - 30, `timer before ${timerBefore}s, after ${after}s`);
    const tabs = await page.$$eval('#exam-tabs .tab', (els) => els.map((e) => e.textContent.replace(/\s+/g, '')));
    assert(tabs[0] === 'GNS20/45' && tabs[1] === 'PHC10/45', JSON.stringify(tabs));
    assert((await page.textContent('#q-card')).includes('Primary Health Care'), 'did not return to the same course');
  });
  await t('submit asks for confirmation and lists unanswered per course', async () => {
    await page.click('header [data-action=submit-exam]');
    const body = await page.textContent('.modal-panel');
    assert(body.includes('150 unanswered') || body.includes('Submit with 150 unanswered'), body);
    assert(body.includes('25 unanswered') && body.includes('35 unanswered') && body.includes('45 unanswered'), body);
    await shot(page, '04-submit-confirm');
    await page.click('.modal-panel [data-modal-action="0"]'); // Go back
    assert(!(await page.$('.modal-panel')));
  });
  await t('result: 30/180, 16.7%, ring, per course, time used, motivation, rank #1', async () => {
    await submit(page);
    const txt = await page.textContent('body');
    for (const s of ['16.7%', '30 / 180', 'Time used', 'Score per course', '20/45', '10/45', "You're currently #1 on the leaderboard", 'You are on the leaderboard!'])
      assert(txt.includes(s), 'missing: ' + s);
    const msgs = ['Every expert was once a beginner', 'Do not give up', 'Great things take time', 'This is just the start'];
    assert(msgs.some((m) => txt.includes(m)), 'no low band motivational message');
    await noHorizontalScroll(page);
    await sleep(1300);
    await shot(page, '05-result');
  });
  await t('corrections: course tabs, filters with counts, green/red marks and "Why:"', async () => {
    await page.click('[data-action=corrections]');
    await page.waitForSelector('.fchip');
    const chips = await page.$$eval('.fchip', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
    assert(JSON.stringify(chips) === JSON.stringify(['All 45', 'Wrong 0', 'Skipped 25', 'Correct 20']), JSON.stringify(chips));
    assert((await page.$$('article')).length === 45);
    await page.click('.fchip[data-f=correct]');
    assert((await page.$$('article')).length === 20);
    assert((await page.$$('article .copt-right')).length === 20 && (await page.$$('article .copt-wrong')).length === 0);
    assert((await page.textContent('article')).includes('Why:'));
    await page.click('.fchip[data-f=skipped]');
    assert((await page.$$('article')).length === 25);
    await page.click('[data-action=corr-course][data-c="2"]');
    assert((await page.$$('article')).length === 45, 'CHM all skipped should show 45 in Skipped');
    await noHorizontalScroll(page);
    await shot(page, '06-corrections');
  });
  await t('result lists "Topics to revise"; tapping one shows only that topic in corrections', async () => {
    await page.click('header [data-action=result]');
    await page.waitForSelector('.topic-row');
    const rows = await page.$$eval('.topic-row', (els) => els.map((e) => e.getAttribute('data-topic')));
    assert(rows.length > 10, 'only ' + rows.length + ' topics to revise');
    const topic = rows[0];
    await page.click('.topic-row');
    await page.waitForSelector('.topic-chip');
    const chips = await page.$$eval('article .chip', (els) => els.map((e) => e.textContent));
    assert(chips.length > 0 && chips.every((c) => c === topic), topic + ' vs ' + JSON.stringify(chips));
    await shot(page, '06b-revise-topic');
    await page.click('[data-action=clear-topic]');
    assert(!(await page.$('.topic-chip')));
    await page.click('header [data-action=result]');
    await page.waitForSelector('.topic-row');
    await page.$eval('.topic-row', (e) => e.scrollIntoView({ block: 'center' }));
    await shot(page, '05b-topics-to-revise');
  });
  await t('back on dashboard: leaderboard has Amina #1 with 16.7%, seen counts updated', async () => {
    await page.click('header [data-action=dashboard]');
    await page.waitForSelector('#lb .podium');
    const lb = await page.textContent('#lb');
    assert(lb.includes('Amina Bello') && lb.includes('16.7%') && lb.includes('30/180'), lb);
    await page.waitForFunction(() => document.getElementById('seen').textContent.includes('45 of 332'));
    const stats = await page.textContent('#stats');
    assert(stats.includes('#1') && stats.includes('16.7%') && stats.includes('1'), stats);
  });
  await t('second student on the same device joins the same leaderboard and takes #1', async () => {
    await logout(page);
    await signup(page, 'Chidi Okeke', 'UG/24/0002');
    await page.waitForSelector('[data-action=start-exam]');
    await startExam(page);
    await answerN(page, 45);
    await page.click('#exam-tabs .tab[data-c="1"]');
    await answerN(page, 30);
    await submit(page);
    const txt = await page.textContent('body');
    assert(txt.includes('75 / 180') && txt.includes('41.7%'), 'score');
    assert(txt.includes("You're currently #1 on the leaderboard"), 'rank');
    await page.click('header [data-action=dashboard]');
    await page.waitForSelector('#lb .podium');
    const names = await page.$$eval('#lb .podium-name', (els) => els.map((e) => e.textContent)); // must be right on first render
    assert(names.length === 2 && names[0].includes('Amina') && names[1].includes('Chidi'), JSON.stringify(names)); // order: 2nd, 1st
    assert(await page.$('.podium-gold.podium-me'), 'Chidi should be gold and highlighted');
    await shot(page, '07-dashboard-two-students');
  });
  await t('motivational messages: 4 score bands, several random messages each', async () => {
    const r = await S(page, () => {
      const f = window.CBTApp.messageFor, out = {};
      for (const [band, p] of [['top', 80], ['close', 65], ['half', 50], ['start', 20]]) {
        const seen = new Set(); for (let i = 0; i < 60; i++) seen.add(f(p)); out[band] = [...seen];
      }
      return out;
    });
    assert(r.top.every((m) => /leading|top|chasing/i.test(m)) && r.top.length >= 3, JSON.stringify(r.top));
    assert(r.close.every((m) => /top/i.test(m)) && r.close.length >= 3, JSON.stringify(r.close));
    assert(r.half.length >= 3 && r.half.some((m) => /halfway/i.test(m)), JSON.stringify(r.half));
    assert(r.start.length >= 3 && r.start.some((m) => m.includes('Every expert was once a beginner')), JSON.stringify(r.start));
  });
  await t('no em dashes anywhere in the UI text or questions', async () => {
    const files = ['index.html', 'js/app.js', 'js/config.js', 'js/questions/gns.js', 'js/questions/phc.js', 'js/questions/chm.js', 'js/questions/aum.js'];
    for (const f of files) assert(!fs.readFileSync(path.join(ROOT, f), 'utf8').includes('\u2014'), 'em dash in ' + f);
    assert(!(await page.textContent('body')).includes('\u2014'), 'em dash on the page');
  });
  await ctxA.close();

  // =================================================================
  console.log('\nH. Medal pop-up for the top 3');
  // =================================================================
  {
    const { ctx, page: p } = await newPhone(browser, { label: 'medal' });
    await p.goto(URL_DEV);
    await p.waitForSelector('#auth-submit');
    await p.evaluate(() => { window.__keepMedal = true; });
    await signup(p, 'Kemi Adeyemi', 'UG/24/0900');
    await p.waitForSelector('[data-action=start-exam]');
    await p.evaluate(() => { window.__keepMedal = true; });
    await startExam(p);
    await answerN(p, 30);
    await p.click('header [data-action=submit-exam]');
    await p.click('.modal-panel .btn-primary');
    await t('first place gets a gold medal pop-up with congratulations', async () => {
      await p.waitForSelector('.medal-gold', { timeout: 6000 });
      const txt = await p.textContent('.modal-panel');
      assert(txt.includes('You are number 1!') && txt.includes('Congratulations, Kemi!'), txt);
      await sleep(1200);
      await shot(p, '19-medal-gold');
      await p.click('.modal-panel .btn-primary');
    });
    await t('the medal does not pop up again for the same position in the same visit', async () => {
      await p.click('header [data-action=dashboard]');
      await p.waitForSelector('#lb .podium');
      await sleep(1500);
      assert(!(await p.$('.medal')), 'medal shown twice');
    });
    await t('next visit says "still" in first position', async () => {
      await p.evaluate(() => sessionStorage.clear());
      await p.reload();
      await p.evaluate(() => { window.__keepMedal = true; });
      await p.waitForSelector('.medal-gold', { timeout: 6000 });
      assert((await p.textContent('.modal-panel')).includes('You are still number 1!'));
    });
    await ctx.close();
  }

  // =================================================================
  console.log('\nG. Quit exam and log out confirmation');
  // =================================================================
  {
    const { ctx, page: p } = await newPhone(browser, { label: 'quit' });
    await p.goto(URL_DEV);
    await p.waitForSelector('#auth-submit');
    await signup(p, 'Awwal Mubarak', 'PHT/26/1006');
    await p.waitForSelector('[data-action=start-exam]');
    await startExam(p);
    await answerN(p, 3);
    await t('quit exam asks first, then nothing is counted and questions go back', async () => {
      await p.click('#palette [data-action=quit-exam]');
      await p.waitForSelector('.modal-panel');
      assert((await p.textContent('.modal-panel')).includes('not</b> count') || (await p.textContent('.modal-panel')).includes('not count'));
      await shot(p, '17-quit-confirm');
      await p.click('.modal-panel .btn-danger');
      await p.waitForSelector('[data-action=start-exam]');
      const txt = await p.textContent('body');
      assert(!txt.includes('Resume exam'), 'exam still there');
      assert((await p.textContent('#stats')).includes('0'), 'attempts');
      await p.waitForFunction(() => document.getElementById('seen').textContent.includes('0 of 332'));
      assert((await p.textContent('#lb')).includes('No scores yet'), 'quit exam should not be on the leaderboard');
    });
    await t('log out asks "Stay logged in" or "Yes, log out"', async () => {
      await p.click('[data-action=logout]');
      const body = await p.textContent('.modal-panel');
      assert(body.includes('Stay logged in') && body.includes('Yes, log out'), body);
      await shot(p, '18-logout-confirm');
      await p.click('.modal-panel .btn-primary');
      assert(!(await p.$('.modal-panel')) && await p.$('[data-action=start-exam]'), 'should stay on dashboard');
    });
    await ctx.close();
  }

  // =================================================================
  console.log('\nB. Timer colours and auto submit (exam shortened to 15 seconds)');
  // =================================================================
  {
    const { ctx, page: p } = await newPhone(browser, { label: 'timer', config: configWith({ examMinutes: 0.25, warnAtMinutes: 0.2, dangerAtMinutes: 0.1 }) });
    await p.goto(URL_DEV);
    await p.waitForSelector('#auth-submit');
    await signup(p, 'Tunde Ade', 'UG/24/0500');
    await p.waitForSelector('[data-action=start-exam]');
    await startExam(p);
    await t('timer turns amber with a toast warning', async () => {
      await p.waitForSelector('#timer.timer-warn', { timeout: 8000 });
      await p.waitForFunction(() => document.getElementById('toast-root').textContent.includes('left'), null, { timeout: 3000 });
      await shot(p, '08-timer-amber');
    });
    await t('timer turns red and blinks with a toast', async () => {
      await p.waitForSelector('#timer.timer-danger', { timeout: 8000 });
      const anim = await p.$eval('#timer', (e) => getComputedStyle(e).animationName);
      assert(anim === 'blink', 'animation ' + anim);
      await shot(p, '09-timer-red');
    });
    await t('auto submit when time runs out', async () => {
      await p.waitForSelector('[data-action=corrections]', { timeout: 15000 });
      assert((await p.textContent('body')).includes('Time ran out, so your answers were submitted automatically.'));
    });
    await ctx.close();
  }

  // =================================================================
  console.log('\nC. One-file version (single-file/index.html)');
  // =================================================================
  {
    const { ctx, page: p } = await newPhone(browser, { label: 'one-file' });
    let tailwindCdnUsed = false;
    p.on('request', (r) => { if (r.url().includes('cdn.tailwindcss.com')) tailwindCdnUsed = true; });
    await p.goto(URL_ONE);
    await p.waitForSelector('#auth-submit');
    await t('one-file version loads with styles and no Tailwind CDN', async () => {
      assert(!tailwindCdnUsed, 'bundle should not need the Tailwind CDN');
      const bg = await p.$eval('#auth-submit', (e) => getComputedStyle(e).backgroundColor);
      assert(bg === 'rgb(29, 78, 216)', 'primary button colour ' + bg);
      await noHorizontalScroll(p);
    });
    await t('one-file version: sign up, exam, submit, result', async () => {
      await signup(p, 'Ngozi Eze', 'UG/24/0700');
      await p.waitForSelector('[data-action=start-exam]');
      await startExam(p);
      await answerN(p, 5);
      await submit(p);
      assert((await p.textContent('body')).includes('5 / 180'));
    });
    await ctx.close();
  }

  // =================================================================
  console.log('\nD. Desktop layout');
  // =================================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push('[desktop] ' + e.message));
    await p.route('https://cdn.tailwindcss.com/**', (r) => r.abort());
    await p.route('https://fonts.googleapis.com/**', (r) => r.abort());
    await p.goto(URL_ONE);
    await p.waitForSelector('#auth-submit');
    await shot(p, '10-desktop-login');
    await signup(p, 'Bola Ahmed', 'UG/24/0800');
    await p.waitForSelector('#lb');
    await t('desktop dashboard renders', async () => { await shot(p, '11-desktop-dashboard'); });
    await startExam(p);
    await answerN(p, 3);
    await t('desktop exam renders with side palette', async () => {
      const box = await p.$eval('#palette', (e) => e.getBoundingClientRect().left);
      assert(box > 600, 'palette should be on the right side, left=' + box);
      await shot(p, '12-desktop-exam');
    });
    await ctx.close();
  }

  // =================================================================
  console.log('\nF. Leaderboard with a full class (demo data, list limited to 6)');
  // =================================================================
  {
    const { ctx, page: p } = await newPhone(browser, { label: 'class', config: configWith({ leaderboardSize: 6 }) });
    await p.goto(URL_DEV);
    await p.waitForSelector('#auth-submit');
    const names = ['Zainab Musa', 'Ifeanyi Nwosu', 'Halima Sani', 'Oluwaseun Ade', 'Grace Okon', 'Ibrahim Lawal', 'Precious Uche', 'Kemi Adeyemi', 'Musa Danjuma', 'Ruth Bassey'];
    const pcts = [91.1, 84.4, 84.4, 76.7, 70, 66.1, 60, 52.8, 47.2, 38.9];
    await S(p, ({ names, pcts }) => {
      const db = { students: {}, seen: {}, attempts: {}, pins: {} };
      names.forEach((n, i) => {
        const sid = 'CLS_' + (i + 1);
        db.students[sid] = { sid, name: n, matric: 'CLS/24/' + String(i + 1).padStart(3, '0'), hasPin: false, attempts: 1 + (i % 4),
          bestPct: pcts[i], bestScore: Math.round(pcts[i] * 1.8), bestTotal: 180, bestAt: 1000 + (i === 1 ? 50 : i === 2 ? 10 : i), lastPct: pcts[i], lastExamId: 'x' + i, createdAt: 1 };
      });
      localStorage.setItem('cbt_demo_db_v1', JSON.stringify(db));
      localStorage.setItem('cbt_session_v1', JSON.stringify({ sid: 'CLS_9' }));
    }, { names, pcts });
    await p.reload();
    await p.waitForSelector('#lb .podium');
    await t('top 3 podium in gold, silver, bronze order', async () => {
      const gold = await p.textContent('.podium-gold .podium-name');
      assert(gold.includes('Zainab Musa'), gold);
    });
    await t('tie-breaker: same best %, whoever reached it first ranks higher', async () => {
      const silver = await p.textContent('.podium-silver .podium-name');
      const bronze = await p.textContent('.podium-bronze .podium-name');
      assert(silver.includes('Halima Sani') && bronze.includes('Ifeanyi Nwosu'), silver + ' / ' + bronze);
    });
    await t('positions 4 to 6 show position, name, matric, attempts, best % and score', async () => {
      const rows = await p.$$eval('#lb .lb-row', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
      assert(rows.length === 3, JSON.stringify(rows));
      assert(rows[0].startsWith('4') && rows[0].includes('Oluwaseun Ade') && rows[0].includes('CLS/24/004') && rows[0].includes('attempt') && rows[0].includes('76.7%') && rows[0].includes('138/180'), rows[0]);
    });
    await t('student outside the shown list sees "Your position: #9 of 10 with 47.2%"', async () => {
      await p.waitForFunction(() => document.getElementById('lb').textContent.includes('Your position'), null, { timeout: 5000 });
      const txt = (await p.textContent('#lb')).replace(/\s+/g, ' ');
      assert(txt.includes('Your position: #9 of 10 with 47.2%'), txt.slice(-120));
      const stats = await p.textContent('#stats');
      assert(stats.includes('#9') && stats.includes('of 10'), stats);
      await shot(p, '15-leaderboard-outside');
    });
    await t('own row is highlighted when inside the list', async () => {
      await S(p, () => localStorage.setItem('cbt_session_v1', JSON.stringify({ sid: 'CLS_5' })));
      await p.reload();
      await p.waitForSelector('#lb .lb-row.lb-me');
      assert((await p.textContent('#lb .lb-me')).includes('Grace Okon'));
      await p.$eval('#lb-card', (e) => e.scrollIntoView());
      await shot(p, '16-leaderboard-me');
    });
    await ctx.close();
  }

  // =================================================================
  if (WITH_EMULATOR) {
    console.log('\nE. Firebase mode: two phones, one shared live leaderboard (Firestore emulator, PIN on)');
    // =================================================================
    const fbConfig = configWith({
      firebase: { apiKey: 'demo-key', authDomain: 'demo-cbt.firebaseapp.com', projectId: 'demo-cbt', storageBucket: '', messagingSenderId: '1', appId: '1:1:web:1' },
      emulator: process.env.FIRESTORE_EMULATOR_HOST, requirePin: true
    });
    const A = await newPhone(browser, { label: 'phone A', config: fbConfig });
    const B = await newPhone(browser, { label: 'phone B', config: fbConfig });
    await A.page.goto(URL_DEV); await B.page.goto(URL_DEV);
    await A.page.waitForSelector('#auth-submit'); await B.page.waitForSelector('#auth-submit');

    await t('no demo banner in Firebase mode', async () => {
      assert(!(await A.page.textContent('body')).includes('Demo mode'));
    });
    await t('phone A and phone B sign up with PINs', async () => {
      await signup(A.page, 'Fatima Yusuf', 'MED/24/101', '1234');
      await signup(B.page, 'Emeka Obi', 'MED/24/102', '5678');
      await A.page.waitForSelector('[data-action=start-exam]');
      await B.page.waitForSelector('[data-action=start-exam]');
    });
    await t('both phones show the green Live indicator', async () => {
      await A.page.waitForFunction(() => document.getElementById('lb-status').textContent.includes('Live'), null, { timeout: 10000 });
      await B.page.waitForFunction(() => document.getElementById('lb-status').textContent.includes('Live'), null, { timeout: 10000 });
    });
    await t('duplicate matric on Firebase shows the "already has an account" message', async () => {
      const C = await newPhone(browser, { label: 'phone C', config: fbConfig });
      await C.page.goto(URL_DEV);
      await C.page.waitForSelector('#auth-submit');
      await signup(C.page, 'Fake Person', 'med/24/101', '0000');
      await C.page.waitForFunction(() => !document.getElementById('auth-error').classList.contains('hidden'), null, { timeout: 10000 });
      assert((await C.page.textContent('#auth-error')).includes('already has an account'));
      await C.ctx.close();
    });
    let aFirstExamIds = [];
    await t('phone A takes an exam (60 correct) and is #1', async () => {
      await startExam(A.page);
      aFirstExamIds = await S(A.page, () => window.CBTApp.state.exam.sections.flatMap((s) => s.items.map((i) => i.id)));
      await answerN(A.page, 45);
      await A.page.click('#exam-tabs .tab[data-c="1"]');
      await answerN(A.page, 15);
      await submit(A.page);
      const txt = await A.page.textContent('body');
      assert(txt.includes('60 / 180') && txt.includes('33.3%') && txt.includes("You're currently #1"), txt.slice(0, 400));
    });
    await t('phone B sees phone A on its leaderboard LIVE without refreshing', async () => {
      await B.page.waitForFunction(() => document.getElementById('lb').textContent.includes('Fatima Yusuf'), null, { timeout: 10000 });
      assert((await B.page.textContent('#lb')).includes('33.3%'));
      await shot(B.page, '13-firebase-phoneB-sees-A');
    });
    await t('phone A goes to dashboard; phone B scores higher; A sees B at #1 live', async () => {
      await A.page.click('header [data-action=dashboard]');
      await A.page.waitForSelector('#lb .podium');
      await startExam(B.page);
      await answerN(B.page, 45);
      await B.page.click('#exam-tabs .tab[data-c="1"]');
      await answerN(B.page, 45);
      await submit(B.page);
      assert((await B.page.textContent('body')).includes("You're currently #1"));
      await A.page.waitForFunction(() => {
        const n = [...document.querySelectorAll('#lb .podium-gold .podium-name')].map((e) => e.textContent).join();
        return n.includes('Emeka Obi');
      }, null, { timeout: 10000 });
      const stats = await A.page.textContent('#stats');
      assert(stats.includes('#2'), 'phone A rank should now be #2: ' + stats);
      await shot(A.page, '14-firebase-phoneA-live-update');
    });
    await t('CHT/ prefix is optional: log in either way, and no duplicate account', async () => {
      const C = await newPhone(browser, { label: 'phone CHT', config: fbConfig });
      await C.page.goto(URL_DEV);
      await C.page.waitForSelector('#auth-submit');
      await signup(C.page, 'Bisi Lawal', 'CHT/PHT/26/1635', '4321');
      await C.page.waitForSelector('[data-action=start-exam]');
      await logout(C.page);
      await login(C.page, 'PHT/26/1635', '4321');
      await C.page.waitForSelector('[data-action=start-exam]', { timeout: 10000 });
      assert((await C.page.textContent('body')).includes('CHT/PHT/26/1635'), 'should be the same account');
      await logout(C.page);
      await signup(C.page, 'Bisi Copy', 'PHT/26/1635', '1111');
      await C.page.waitForFunction(() => !document.getElementById('auth-error').classList.contains('hidden'), null, { timeout: 10000 });
      assert((await C.page.textContent('#auth-error')).includes('already has an account'));
      await signup(C.page, 'Tolu Ade', 'PHT/26/1700', '2222');
      await C.page.waitForSelector('[data-action=start-exam]');
      await logout(C.page);
      await signup(C.page, 'Tolu Copy', 'CHT/PHT/26/1700', '2222');
      await C.page.waitForFunction(() => !document.getElementById('auth-error').classList.contains('hidden'), null, { timeout: 10000 });
      assert((await C.page.textContent('#auth-error')).includes('already has an account'));
      await login(C.page, 'cht/pht/26/1700', '2222');
      await C.page.waitForSelector('[data-action=start-exam]', { timeout: 10000 });
      await C.ctx.close();
    });
    await t('wrong PIN is refused, correct PIN logs in', async () => {
      await B.page.click('header [data-action=dashboard]');
      await B.page.waitForSelector('[data-action=logout]');
      await logout(B.page);
      await login(B.page, 'MED/24/102', '1111');
      await B.page.waitForFunction(() => !document.getElementById('auth-error').classList.contains('hidden'), null, { timeout: 10000 });
      assert((await B.page.textContent('#auth-error')).includes('PIN is not correct'));
      await login(B.page, 'MED/24/102', '5678');
      await B.page.waitForSelector('[data-action=start-exam]');
    });
    await t('switching phones: A logs in on a new phone; seen list comes from Firestore; no repeats', async () => {
      const D = await newPhone(browser, { label: 'phone D', config: fbConfig });
      await D.page.goto(URL_DEV);
      await D.page.waitForSelector('#auth-submit');
      await login(D.page, 'MED/24/101', '1234');
      await D.page.waitForSelector('[data-action=start-exam]');
      await D.page.waitForFunction(() => document.getElementById('seen').textContent.includes('45 of 332'), null, { timeout: 10000 });
      await startExam(D.page);
      const ids = await S(D.page, () => window.CBTApp.state.exam.sections.flatMap((s) => s.items.map((i) => i.id)));
      const overlap = ids.filter((id) => aFirstExamIds.includes(id));
      assert(ids.length === 180 && overlap.length === 0, overlap.length + ' repeated questions on the new phone');
      await D.ctx.close();
    });
    await t('stats card shows rank, best score and attempts from Firestore', async () => {
      await A.page.reload();
      await A.page.waitForSelector('#stats');
      await A.page.waitForFunction(() => document.getElementById('stats').textContent.includes('#2'), null, { timeout: 10000 });
      const s = await A.page.textContent('#stats');
      assert(s.includes('33.3%') && s.includes('60/180'), s);
    });
    await A.ctx.close(); await B.ctx.close();
  } else {
    console.log('\n(E. Firebase tests skipped: run through "npm run e2e" to start the emulator)');
  }

  console.log('\nPage errors: ' + (errors.length ? '\n  ' + errors.join('\n  ') : 'none'));
  if (errors.length) failed++;
  console.log(`\n${passed} passed, ${failed} failed. Screenshots in tests/screenshots/`);
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
