// Run: node --test tests/ai/hebrew.test.cjs
// Every string the AI keys and Ask AI screens show must have a Hebrew entry (CLAUDE.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const app = fs.readFileSync(path.join(root, 'renderer', 'app.js'), 'utf8');
const i18n = fs.readFileSync(path.join(root, 'renderer', 'i18n.js'), 'utf8');

// The new block in app.js: from the AI-keys heading to openSettings.
const start = app.indexOf('Your AI keys and Ask AI');
const end = app.indexOf('async function openSettings');
const block = app.slice(start, end);

// Strings a student reads: the text passed to t(...), and the two error tables.
// (Selectors and element names are code, not text, so they are not checked.)
const strings = new Set();
for (const m of block.matchAll(/(?<![\w.])t\(\s*'((?:[^'\\]|\\.)+)'/g)) strings.add(m[1]);
for (const table of ['AI_KEY_ERRORS', 'ASK_ERRORS']) {
  const at = block.indexOf(`const ${table} = {`);
  const body = block.slice(at, block.indexOf('};', at));
  for (const m of body.matchAll(/: '((?:[^'\\]|\\.)+)'/g)) strings.add(m[1]);
}

test('the AI screens have strings to translate', () => {
  assert.ok(strings.size > 25, `found ${strings.size}`);
});

test('every AI string has a Hebrew entry in i18n.js', () => {
  const missing = [];
  for (const s of strings) {
    // The key appears as a quoted dictionary key: 'English text': 'Hebrew'
    const key = s.replace(/\\'/g, "'");
    if (!i18n.includes(`'${key}':`) && !i18n.includes(`'${s}':`)) missing.push(key);
  }
  assert.deepEqual(missing, []);
});
