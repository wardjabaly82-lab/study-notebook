// Step 3: a save from Claude reaches the open app live, without reloading.
import { launch, shot, openCourse, REPO, CFG } from './launch.mjs';
import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const bad = []; const check = (c, s) => { console.log((c ? '✓ ' : '✗ ') + s); if (!c) bad.push(s); };
const { app, win, logs } = await launch({ fresh: true });
await win.waitForTimeout(1800); await win.getByRole('button', { name: 'Later' }).click().catch(() => {});
const claude = new Client({ name: 't', version: '1' });
await claude.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(REPO, 'connector/src/server.js')], env: { ...process.env, STUDY_NOTEBOOK_DATA_DIR: path.join(CFG, 'Study Notebook') } }));
await claude.callTool({ name: 'create_course', arguments: { name: 'מאקרו כלכלה', notes_language: 'Hebrew' } });
await win.waitForTimeout(1000); await openCourse(win);
const t0 = Date.now();
const r = await claude.callTool({ name: 'save_section', arguments: { course: 'מאקרו כלכלה', title: 'בדיקת עדכון חי', content: 'סעיף בדיקה: \\(x^2\\).' } });
check(!r.isError, `Claude's save is accepted (${Date.now() - t0} ms)`);
let shown = false; for (let i = 0; i < 10 && !shown; i++) { await win.waitForTimeout(400); shown = (await win.$$eval('.toc-link', a => a.map(x => x.textContent))).some(x => x.includes('בדיקת עדכון חי')); }
check(shown, 'the new topic shows in the open app without reloading');
check(await win.evaluate(() => !!document.querySelector('#sheet mjx-container')), 'its formula is drawn');
await shot(win, '11-live-save');
console.log('errors:', logs.join('\n') || 'none'); console.log(bad.length ? `${bad.length} PROBLEM(S)` : 'ALL GOOD');
await claude.close(); await app.close();
