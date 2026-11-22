#!/usr/bin/env node
/*
 * Builds the ONE-FILE version of the site: single-file/index.html
 * Everything (settings, questions, styles, app code) is placed inside that
 * one file, so it can be uploaded on its own from a phone.
 *
 * Usage (from the project folder):  node tools/build-bundle.js
 * Tailwind CSS is compiled ahead of time when the tailwindcss package is
 * installed (cd tests && npm install). Otherwise the Tailwind CDN line is kept.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'single-file');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const safeScript = (s) => s.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
const safeStyle = (s) => s.replace(/<\/style/gi, '<\\/style');

function compileTailwind() {
  const candidates = [
    path.join(ROOT, 'tests', 'node_modules', '.bin', 'tailwindcss'),
    path.join(ROOT, 'node_modules', '.bin', 'tailwindcss')
  ];
  const bin = candidates.find((p) => fs.existsSync(p));
  if (!bin) return null;
  const input = path.join(OUT_DIR, '.tw-input.css');
  const output = path.join(OUT_DIR, '.tw-output.css');
  fs.writeFileSync(input, '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n');
  execFileSync(bin, ['-c', path.join(ROOT, 'tailwind.config.js'), '-i', input, '-o', output, '--minify'], { cwd: ROOT, stdio: 'pipe' });
  const css = fs.readFileSync(output, 'utf8');
  fs.unlinkSync(input); fs.unlinkSync(output);
  return css;
}

fs.mkdirSync(OUT_DIR, { recursive: true });
let html = read('index.html');

// 1. Tailwind: ready-made CSS instead of the CDN compiler.
const tw = compileTailwind();
html = html.replace(/<!-- TAILWIND:START[\s\S]*?TAILWIND:END -->/, (block) => {
  if (!tw) { console.warn('tailwindcss not installed: keeping the Tailwind CDN script.'); return block; }
  return '<style>/* Tailwind CSS (compiled) */\n' + safeStyle(tw) + '</style>';
});

// 2. Custom CSS
html = html.replace('<link rel="stylesheet" href="css/style.css">', () => '<style>\n' + safeStyle(read('css/style.css')) + '</style>');

// 3. Settings go at the very TOP of the file, so the Firebase keys are the first
//    thing you see when you open the file in the GitHub editor on a phone.
const settings = '<script>\n/* ##################################################################\n' +
  '   ##  SETTINGS AND FIREBASE KEYS: EDIT THIS PART  (search: PASTE KEYS)\n' +
  '   ################################################################## */\n' +
  safeScript(read('js/config.js')) +
  '/* ##################  END OF SETTINGS  ################## */\n</script>';
html = html.replace(/\s*<!-- 1\. Settings[^\n]*\n\s*<script src="js\/config\.js"><\/script>/, '');
html = html.replace('<head>', () => '<head>\n  <meta charset="utf-8">\n  ' + settings);
html = html.replace(/(<head>[\s\S]*?<\/script>)\s*<meta charset="utf-8">/, '$1');

// 4. The other scripts, inlined in the same order.
html = html.replace(/<script src="(js\/[^"]+)"><\/script>/g, (m, src) => '<script>/* ' + src + ' */\n' + safeScript(read(src)) + '</script>');

const outFile = path.join(OUT_DIR, 'index.html');
html = html.replace('<head>', '<head>\n  <!-- ONE-FILE VERSION: built by tools/build-bundle.js. The settings and Firebase keys are just below. -->');
// Make the marker text searchable right next to the Firebase keys.
html = html.replace('firebase: {\n    apiKey:', 'firebase: {   /* PASTE KEYS below */\n    apiKey:');
fs.writeFileSync(outFile, html);

const leftover = html.match(/<script src="js\//g) || html.includes('href="css/style.css"');
if (leftover) { console.error('Some files were not inlined!'); process.exit(1); }
console.log('Built ' + path.relative(ROOT, outFile) + ' (' + Math.round(fs.statSync(outFile).size / 1024) + ' KB)' + (tw ? ' with compiled Tailwind CSS' : ''));
