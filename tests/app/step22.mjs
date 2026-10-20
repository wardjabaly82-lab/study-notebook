// The app talks about the assistant the student uses (Gemini only → no "Connect to Claude"), and Arabic works
// as a notes language: right-to-left, Arabic phrases, Arabic practice questions.
import { launch, shot, openCourse, REPO, CFG } from './launch.mjs';
import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const bad = []; const check = (c, s) => { console.log((c ? '✓ ' : '✗ ') + s); if (!c) bad.push(s); };
const { app, win, logs } = await launch({ fresh: true });
await win.waitForTimeout(1800); await win.getByRole('button', { name: 'Later' }).click().catch(() => {});
await win.evaluate(() => localStorage.setItem('sn-seen-version', '9.9.9')); await win.reload(); await win.waitForTimeout(1800);

// 1) Nothing connected yet: it offers both
check(/Connect Claude or Gemini/.test(await win.evaluate(() => document.getElementById('claudePill').innerText)), 'with nothing connected, the shelf says “Connect Claude or Gemini”');
// 2) Only Gemini connected (the online notebook reports it)
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('cloud:status', { enabled: true, url: 'https://x', email: 'a@b.c', error: '', gemini: 1, geminiLast: Date.now() - 60000 }));
await win.waitForTimeout(300);
await win.evaluate(() => document.getElementById('homeBtn').click()); await win.waitForTimeout(300);
const pill = await win.evaluate(() => document.getElementById('claudePill').innerText);
check(/Connected to Gemini/.test(pill) && !/Connect to Claude/.test(pill), `with only Gemini, the shelf says “Connected to Gemini” (${pill.replace(/\n/g, ' · ')})`);

// 3) An Arabic course (Claude stays unconnected until now; the test connector counts as Claude)
const claude = new Client({ name: 't', version: '1' });
await claude.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(REPO, 'connector/src/server.js')], env: { ...process.env, STUDY_NOTEBOOK_DATA_DIR: path.join(CFG, 'Study Notebook') } }));
await claude.callTool({ name: 'create_course', arguments: { name: 'الاقتصاد الكلي', notes_language: 'Arabic' } });
await win.waitForTimeout(1200); await openCourse(win);
const empty = await win.evaluate(() => ({ text: document.getElementById('sheet').innerText, say: (document.querySelector('#sheet .say') || {}).textContent || '' }));
check(/Gemini/.test(empty.text) && /@Study Notebook/.test(empty.text) && !/Connect to Claude/.test(empty.text), 'the empty course explains Gemini (start the chat with @Study Notebook)');
check(/احفظ ما تعلمناه في Study Notebook/.test(empty.say), `what to say is in Arabic (${empty.say})`);
await shot(win, '22-gemini-empty-arabic');
await claude.callTool({ name: 'save_section', arguments: { course: 'الاقتصاد الكلي', title: 'الناتج المحلي الإجمالي', content: '**تعريف.** الناتج المحلي الإجمالي هو القيمة السوقية لجميع **السلع والخدمات النهائية** المنتجة داخل الدولة خلال فترة زمنية معينة. يُقاس عادة سنويًا ويُستخدم لمقارنة حجم الاقتصادات المختلفة.' } });
await win.waitForTimeout(1500);
const sh = await win.evaluate(() => ({ dir: document.getElementById('sheet').getAttribute('dir'), title: (document.querySelector('#sheet .note h2, #sheet .sec h2') || {}).textContent || '' }));
check(sh.dir === 'rtl', `Arabic notes read right to left (dir=${sh.dir})`);
await win.click('#pracBtn'); await win.waitForTimeout(800);
const qs = await win.evaluate(() => document.getElementById('sheet').innerText);
await win.click('[data-act="prac-start"]').catch(() => {}); await win.waitForTimeout(600);
const q = await win.evaluate(() => (document.querySelector('.prac-q, .card-q, .q') || document.getElementById('sheet')).innerText);
check(/تعريف|اشرحوا|أكملوا|ما المصطلح/.test(q) && !/Explain:|What is the definition|Fill in the blank/.test(q), `practice questions are asked in Arabic (“${q.split('\n').find(l => /[؀-ۿ]/.test(l)) || q.slice(0, 60)}”)`);
const ask = await win.evaluate(() => [...document.querySelectorAll('.say-box')].map(x => x.textContent).join(' '));
console.log('practice request shown:', ask.slice(0, 120) || '(none on this screen)');
// the course form offers Arabic
await win.click('.side .course[data-course]', { button: 'right' }); await win.waitForTimeout(400);
check(await win.evaluate(() => [...document.querySelectorAll('dialog[open] select option')].some(o => o.value === 'ar' && o.selected)), 'the course form shows Arabic as the notes language');
console.log('errors:', logs.join('\n') || 'none'); console.log(bad.length ? `${bad.length} PROBLEM(S)` : 'ALL GOOD');
await claude.close(); await app.close();
