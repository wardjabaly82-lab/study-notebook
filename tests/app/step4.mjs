// Step 4: re-test after the fix. MODE=fallback (link can't connect) or MODE=live.
import { launch, shot, REPO, CFG } from './launch.mjs';
import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const MODE = process.env.MODE;
const bad = []; const ok = s => console.log('✓ ' + s); const fail = s => { bad.push(s); console.log('✗ ' + s); };
const fresh = MODE === 'live';
const { app, win, logs } = await launch({ fresh });
await win.waitForTimeout(2000);
if (fresh) {
  await shot(win, `20-${MODE}-welcome`);
  const welcome = await win.evaluate(() => document.querySelector('dialog[open]')?.innerText || '');
  /Sign in with Google/.test(welcome) ? ok('welcome leads with Sign in with Google') : fail('welcome does not offer Google sign-in');
  await win.getByRole('button', { name: 'Later' }).click();
}
const claude = new Client({ name: 't', version: '1' });
await claude.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(REPO, 'connector/src/server.js')], env: { ...process.env, STUDY_NOTEBOOK_DATA_DIR: path.join(CFG, 'Study Notebook') } }));
const call = async (name, args) => { const r = await claude.callTool({ name, arguments: args }); const t = r.content.map(c => c.text).join('\n'); if (r.isError) throw new Error(t); return t; };
if (fresh) { await call('create_course', { name: 'מאקרו כלכלה', notes_language: 'Hebrew' }); await win.waitForTimeout(800); }
const tocHas = async title => (await win.$$eval('.toc-link', a => a.map(x => x.textContent))).some(x => x.includes(title));

// 1) Claude saves a topic while the app is open.
const reply = await call('save_section', { course: 'מאקרו כלכלה', title: `שער חליפין ${MODE}`, content: 'שער החליפין \\(e\\) הוא מחיר מטבע חוץ במטבע מקומי.' });
console.log('connector says:', reply.split('\n').pop());
let shown = false; for (let i = 0; i < 10 && !shown; i++) { await win.waitForTimeout(500); shown = await tocHas(`שער חליפין ${MODE}`); }
shown ? ok('Claude’s save shows in the open app without reloading') : fail('Claude’s save did not show in the open app');
await shot(win, `21-${MODE}-after-save`);

// 2) Claude saves again, and right away the student edits a different topic in the app.
await call('save_section', { course: 'מאקרו כלכלה', title: `ריבית ${MODE}`, content: 'הריבית היא מחיר הכסף.' });
const edit = win.locator('.sec-tools button', { hasText: 'Edit' }).first();
if (await edit.count()) {
  await edit.click(); await win.waitForTimeout(300);
  const ta = win.locator('.edit textarea').first();
  await ta.fill((await ta.inputValue()) + '\n\nהערה של הסטודנט.');
  await win.locator('.edit button', { hasText: 'Save' }).first().click();
  await win.waitForTimeout(3500);
} else fail('could not find an Edit button to simulate a student edit');

// 3) Restart the app: both Claude's topic and the student's edit must still be there.
await claude.close(); await app.close();
const again = await launch();
await again.win.waitForTimeout(2500);
const toc = await again.win.$$eval('.toc-link', a => a.map(x => x.textContent));
const text = await again.win.$$eval('.note', n => n.map(x => x.textContent).join('\n'));
toc.some(x => x.includes(`ריבית ${MODE}`)) ? ok('Claude’s second save survived the student’s edit and a restart') : fail('Claude’s second save was LOST after the student edited');
text.includes('הערה של הסטודנט') ? ok('the student’s own edit survived too') : fail('the student’s edit was lost');

// 4) Escape closes search (first press may clear the text).
await again.win.keyboard.press('Control+K'); await again.win.keyboard.type('ריבית'); await again.win.waitForTimeout(500);
await again.win.keyboard.press('Escape'); await again.win.waitForTimeout(200);
let open = await again.win.$$eval('dialog[open]', d => d.length);
if (open) { await again.win.keyboard.press('Escape'); await again.win.waitForTimeout(200); open = await again.win.$$eval('dialog[open]', d => d.length); console.log('  (first Escape cleared the text, second closed)'); }
open ? fail('search window stays open after Escape twice') : ok('Escape closes search');
console.log('errors:', [...logs, ...again.logs].join('\n') || 'none');
console.log(bad.length ? `\n${bad.length} PROBLEM(S)` : '\nALL GOOD');
await again.app.close();
