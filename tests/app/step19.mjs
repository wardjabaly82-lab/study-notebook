// Print: comments come out as numbered notes under their topic, keeping line breaks;
// and every print starts with all pages ticked (unticking isn't remembered for next time).
import { launch, REPO, CFG, OUT } from './launch.mjs';
import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const bad = []; const check = (ok, s) => { console.log((ok ? '✓ ' : '✗ ') + s); if (!ok) bad.push(s); };
const { app, win } = await launch({ fresh: true });
const out = await app.evaluate(async ({ BrowserWindow }, { file }) => {
  const w = new BrowserWindow({ show: false, width: 800, height: 1100 });
  await w.loadFile(file);
  const payload = { lang: 'he', course: 'הסתברות', sections: [{ title: 'התפלגות ברנולי', depth: 0, html: '<p>הטלות בלתי תלויות של מטבע מוטה נותנות התפלגות ברנולי.</p><p>ההסתברות של רצף היא מכפלה.</p>',
    marks: [{ id: 'h1', q: 'בלתי תלויות', pre: 'הטלות ', suf: ' של', c: 'note', n: 'שורה ראשונה של הערה ארוכה.\nשורה שנייה: כל הטלה לא משפיעה על האחרות.' }, { id: 'h2', q: 'מכפלה', pre: 'היא ', suf: '.', c: 'yellow', n: 'לזכור לבחינה' }], ink: [] }] };
  const r = await w.webContents.executeJavaScript(`renderPrint(${JSON.stringify({ payload, opts: { titlePage: false, marks: true } })}).then(() => ({
    refs: [...document.querySelectorAll('sup.cm-ref')].map(x => x.textContent), notes: [...document.querySelectorAll('ol.sec-comments li')].map(x => x.textContent),
    inlineLeft: document.querySelectorAll('mark.note-end').length, lines: (document.querySelector('ol.sec-comments li') || {}).innerText }))`);
  r.png = (await w.webContents.capturePage()).toPNG().toString('base64'); w.destroy();
  return r;
}, { file: path.join(REPO, 'renderer', 'print.html') });
(await import('fs')).writeFileSync(path.join(OUT, 'pr-comments.png'), Buffer.from(out.png, 'base64'));
check(out.refs.join() === '1,2' && out.notes.length === 2 && out.inlineLeft === 0, 'comments print as numbered notes ¹ ² under the topic, not inside the sentence');
check(/\n/.test(out.lines), 'a long comment keeps its line breaks in print');

await win.waitForTimeout(1500); await win.getByRole('button', { name: 'Later' }).click().catch(() => {});
const c = new Client({ name: 't', version: '1' });
await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(REPO, 'connector/src/server.js')], env: { ...process.env, STUDY_NOTEBOOK_DATA_DIR: path.join(CFG, 'Study Notebook') } }));
await c.callTool({ name: 'create_course', arguments: { name: 'Probability', notes_language: 'English' } });
for (const t of ['Sample spaces', 'Events', 'Expectation']) await c.callTool({ name: 'save_section', arguments: { course: 'Probability', title: t, content: (t + ' explained in detail. ').repeat(40) } });
await win.evaluate(() => localStorage.setItem('sn-seen-version', '9.9.9')); await win.reload(); await win.waitForTimeout(2200);
await win.evaluate(() => { const b = document.querySelector('.side .course[data-course]'); if (b) b.click(); }); await win.waitForTimeout(1000);
const ticks = () => win.$$eval('.pr-pg', ps => ({ n: ps.length, off: ps.filter(p => p.classList.contains('off')).length }));
await win.click('#printBtn'); await win.waitForSelector('.pr-pg', { timeout: 30000 }); await win.waitForTimeout(800);
const a = await ticks();
check(a.n > 1 && a.off === 0, `print opens with every page ticked (${a.n} pages)`);
await win.click('.pr-pg[data-n="2"]'); await win.waitForTimeout(300);
const b = await ticks();
check(b.off === 1, 'clicking a page unticks it');
await win.keyboard.press('Escape'); await win.waitForTimeout(400);
await win.click('#printBtn'); await win.waitForSelector('.pr-pg', { timeout: 30000 }); await win.waitForTimeout(800);
const d = await ticks();
check(d.off === 0, 'opening print again starts with all pages ticked');
console.log(bad.length ? `${bad.length} PROBLEM(S)` : 'ALL GOOD');
await c.close(); await app.close();
