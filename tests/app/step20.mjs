// When saving or syncing breaks: Paste from Claude turns a copied explanation into a topic, and a sync
// problem shows as one plain sentence in the shelf and on Home, with a one-click retry.
import { launch, shot, openCourse, REPO, CFG } from './launch.mjs';
import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const bad = []; const check = (c, s) => { console.log((c ? '✓ ' : '✗ ') + s); if (!c) bad.push(s); };
const { app, win, logs } = await launch({ fresh: true });
await win.waitForTimeout(1800); await win.getByRole('button', { name: 'Later' }).click().catch(() => {});
const claude = new Client({ name: 't', version: '1' });
await claude.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(REPO, 'connector/src/server.js')], env: { ...process.env, STUDY_NOTEBOOK_DATA_DIR: path.join(CFG, 'Study Notebook') } }));
await claude.callTool({ name: 'create_course', arguments: { name: 'Econometrics', notes_language: 'English' } });
await win.evaluate(() => localStorage.setItem('sn-seen-version', '9.9.9')); await win.reload(); await win.waitForTimeout(2000);
await openCourse(win);

// 1) Paste from Claude, from the empty notebook (the test uses the real clipboard, so whatever was copied is put back at the end)
const kept = await app.evaluate(async ({ clipboard }) => { const t = await clipboard.readText(); clipboard.clear(); return t; });
check(await win.isVisible('#sheet [data-act="paste-topic"]'), 'an empty notebook offers Paste from Claude');
await win.click('#sheet [data-act="paste-topic"]'); await win.waitForTimeout(500);
check(await win.evaluate(() => !document.querySelector('form.edit')), 'with nothing copied it only explains what to do');
await app.evaluate(({ clipboard }) => clipboard.writeText('## Omitted variable bias\n\nWhen a relevant variable is left out, **beta one** absorbs part of its effect.\n\n- bias = beta2 · delta1'));
await win.click('#sheet [data-act="paste-topic"]'); await win.waitForTimeout(600);
const ed = await win.evaluate(() => { const f = document.querySelector('form.edit'); return f && { title: f.querySelector('input').value, body: f.querySelector('textarea').value }; });
check(ed && ed.title === 'Omitted variable bias' && /absorbs part of its effect/.test(ed.body) && !/^##/.test(ed.body), `the copied text opens as a new topic, its heading as the title ("${ed && ed.title}")`);
await win.locator('form.edit button', { hasText: 'Save' }).first().click(); await win.waitForTimeout(500);
check((await win.$$eval('.toc-link', a => a.map(x => x.textContent))).some(x => x.includes('Omitted variable bias')), 'after saving it is a topic like any other');
await win.click('#moreBtn'); await win.waitForTimeout(200);
check(await win.isVisible('.menu [data-act="paste-topic"]'), 'Paste from Claude is also in the ⋯ menu');
await win.keyboard.press('Escape');

// 2) A sync problem: plain sentence in the shelf and on Home, one click retries
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('cloud:status', { enabled: true, url: 'https://x', email: 'a@b.c', error: 'Can’t reach your online notebook. Check the internet connection.' }));
await win.waitForTimeout(400);
const pill = await win.evaluate(() => document.getElementById('claudePill').innerText);
check(/Notes aren’t syncing/.test(pill) && /Can’t reach your online notebook\./.test(pill) && !/Check the internet/.test(pill), `the shelf says it in one sentence: "${pill.replace(/\n/g, ' · ')}"`);
await win.click('#homeBtn'); await win.waitForTimeout(500);
check(await win.evaluate(() => /Notes aren’t syncing: Can’t reach/.test((document.querySelector('.h-conn.warn') || {}).textContent || '')), 'Home shows the same sentence as a button');
await shot(win, '20-sync-problem');
await win.click('.h-conn.warn'); await win.waitForTimeout(1200);
check(await win.evaluate(() => !document.querySelector('.h-conn.warn') && !/aren’t syncing/.test(document.getElementById('claudePill').innerText)), 'clicking it tries again, and the warning goes away once sync works');
await app.evaluate(({ clipboard }, t) => { if (t) clipboard.writeText(t); else clipboard.clear(); }, kept);
console.log('errors:', logs.join('\n') || 'none'); console.log(bad.length ? `${bad.length} PROBLEM(S)` : 'ALL GOOD');
await claude.close(); await app.close();
