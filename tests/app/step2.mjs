// Step 2: a student's first session, end to end. Claude's side goes through the real local connector.
import { launch, shot, REPO, CFG } from './launch.mjs';
import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const findings = [];
const note = (s) => { findings.push(s); console.log('• ' + s); };
async function step(name, fn) { try { await fn(); console.log(`✓ ${name}`); } catch (e) { note(`STEP FAILED: ${name}: ${e.message.split('\n')[0]}`); } }

const { app, win, logs } = await launch({ fresh: true });
await win.waitForTimeout(2000);

await step('dismiss welcome', async () => { await win.getByRole('button', { name: 'Later' }).click(); await win.waitForTimeout(400); await shot(win, '02-empty'); });

await step('create a course', async () => {
  await win.click('#newCourseBtn'); await win.waitForTimeout(500);
  await shot(win, '03-new-course-form');
  const fields = await win.$$eval('#cfForm input, #cfForm select', els => els.map(e => `${e.id}:${e.type || e.tagName}`));
  console.log('form fields:', fields.join(', '));
  await win.fill('#cfName', 'מאקרו כלכלה');
  await win.fill('#cfNum', '57305');
  const lang = await win.$('#cfForm select');
  if (lang) { const opts = await lang.$$eval('option', o => o.map(x => x.value + '=' + x.textContent)); console.log('language options:', opts.join(' | ')); const he = opts.find(o => /^he=|Hebrew|עברית/.test(o)); if (he) await lang.selectOption(he.split('=')[0]); }
  await win.click('#cfForm button[type=submit]'); await win.waitForTimeout(800);
  await shot(win, '04-course-created');
});

// Claude's side: the real connector over stdio, like the Claude desktop app runs it.
const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(REPO, 'connector/src/server.js')], env: { ...process.env, STUDY_NOTEBOOK_DATA_DIR: path.join(CFG, 'Study Notebook') } });
const claude = new Client({ name: 'student-test', version: '1' });
const call = async (name, args) => { const r = await claude.callTool({ name, arguments: args }); const txt = r.content.map(c => c.text).join('\n'); if (r.isError) throw new Error(`${name}: ${txt}`); return txt; };
const J = (txt) => { const a = Math.min(...['{','['].map(c => txt.indexOf(c)).filter(i => i >= 0)); const b = Math.max(txt.lastIndexOf('}'), txt.lastIndexOf(']')); const tail = txt.slice(b + 1).trim(); if (tail) console.log('   (connector added: ' + tail + ')'); return JSON.parse(txt.slice(a, b + 1)); };

let topicId = '';
await step('Claude connects and sees the course', async () => {
  await claude.connect(transport);
  const inst = claude.getInstructions() || '';
  if (!/Follow-up questions about something already saved/.test(inst)) note('connector instructions are missing the new follow-up rule');
  const tools = (await claude.listTools()).tools.map(t => t.name);
  console.log('tools:', tools.join(', '));
  console.log('list_courses:', (await call('list_courses', {})).slice(0, 300));
});

await step('Claude saves a lesson with formulas (save_sections)', async () => {
  const r = J(await call('save_sections', { course: 'מאקרו כלכלה', sections: [
    { title: 'התוצר (תמ״ג)', content: 'התוצר המקומי הגולמי הוא ערך כל הסחורות והשירותים הסופיים שמיוצרים במשק בתקופה מסוימת.\n\nמצד השימושים, התוצר מתחלק לארבעה רכיבים:\n\n$$Y = C + I + G + NX$$\n\nבישראל הצריכה הפרטית היא הרכיב הגדול ביותר, בערך \\(55\\%\\) מהתוצר.' },
    { title: 'תוצר נומינלי וריאלי', under: 1, content: 'תוצר נומינלי נמדד במחירי השנה הנוכחית; תוצר ריאלי נמדד במחירי שנת בסיס, ולכן הוא מנטרל שינויי מחירים:\n\n$$\\text{Real GDP}_t = \\frac{\\text{Nominal GDP}_t}{P_t}\\cdot 100$$\n\nכאשר \\(P_t\\) הוא מדד המחירים (מחירי שנת הבסיס = 100).' },
    { title: 'אינפלציה', content: 'אינפלציה היא עלייה מתמשכת ברמת המחירים הכללית. שיעור האינפלציה:\n\n$$\\pi_t = \\frac{P_t - P_{t-1}}{P_{t-1}}$$' }
  ] }));
  topicId = r.saved[0].section_id;
  console.log('saved:', r.saved.map(s => s.path).join(' / '));
  console.log('outline now:', JSON.stringify(J(await call('get_outline', { course: 'מאקרו כלכלה' })).sections.map(x => x.title)));
});

await step('Student asks "what are the letters?" → Claude adds it under the formula (edit_part)', async () => {
  const sec = J(await call('read_section', { course: 'מאקרו כלכלה', section_id: topicId }));
  if (!sec.content.includes('$$Y = C + I + G + NX$$')) throw new Error('formula not found in saved section');
  await call('edit_part', { course: 'מאקרו כלכלה', section_id: topicId, find: '$$Y = C + I + G + NX$$',
    replace: '$$Y = C + I + G + NX$$\n\n- \\(Y\\): התוצר.\n- \\(C\\): צריכה פרטית (Consumption).\n- \\(I\\): השקעה (Investment).\n- \\(G\\): צריכה ציבורית (Government).\n- \\(NX\\): יצוא נטו, יצוא פחות יבוא (Net exports).' });
  const after = J(await call('read_section', { course: 'מאקרו כלכלה', section_id: topicId })).content;
  const iF = after.indexOf('$$Y = C'), iL = after.indexOf('צריכה פרטית'), iEnd = after.indexOf('55');
  if (!(iF < iL && iL < iEnd)) note('follow-up answer did not land right under the formula');
  console.log('section after follow-up:\n' + after);
});

await step('notes show in the app, formulas drawn', async () => {
  await win.waitForTimeout(2500);
  await shot(win, '05-notes-after-claude');
  const s = await win.evaluate(() => {
    const notes = [...document.querySelectorAll('.note')];
    const raw = notes.map(n => n.textContent).join('\n');
    return { notes: notes.length, math: document.querySelectorAll('.note mjx-container').length, rawDollar: /\$\$|\\\(|\\\)/.test(raw), toc: [...document.querySelectorAll('.toc-link')].map(a => a.textContent.trim()) };
  });
  console.log('app view:', JSON.stringify(s));
  if (!s.notes) { note('notes saved by Claude did not appear in the open app without reloading'); await win.reload(); await win.waitForTimeout(2500); const n2 = await win.$$eval('.note', n => n.length); console.log('after reload, notes:', n2); await shot(win, '05b-after-reload'); }
  if (s.rawDollar) note('some math is still shown as raw text in the app');
});

await step('search', async () => {
  await win.keyboard.press('Control+K'); await win.waitForTimeout(500);
  await win.keyboard.type('צריכה'); await win.waitForTimeout(900);
  await shot(win, '06-search');
  await win.keyboard.press('Escape'); await win.waitForTimeout(400);
  const still = await win.$$eval('dialog[open]', d => d.length);
  if (still) { note('Escape does not close the search window'); await win.click('dialog[open] .sn-x'); await win.waitForTimeout(300); }
});

await step('print: preview, click a page to drop it', async () => {
  const btn = await win.$('[data-act="print"], #printBtn, button[title*="Print" i], button[aria-label*="Print" i]');
  if (btn) await btn.click(); else { note('no visible Print button found in the course view; opened print from code'); await win.evaluate(() => window.openPrint()); }
  await win.waitForSelector('.pr-pg', { timeout: 30000 });
  await win.waitForTimeout(800);
  await shot(win, '07-print-preview');
  const before = await win.$$eval('.pr-pg', p => p.map(x => x.className));
  await win.click('.pr-pg[data-n="1"]'); await win.waitForTimeout(400);
  const pages = await win.inputValue('input[data-k="pages"]');
  const info = await win.textContent('#prInfo');
  console.log(`pages: ${before.length}, after dropping page 1 → Pages box "${pages}", info "${info}"`);
  if (before.length > 1 && !pages) note('dropping a page did not fill the Pages box');
  await shot(win, '08-print-page-dropped');
  await win.click('.pr-pg[data-n="1"]'); await win.waitForTimeout(300);
  await win.keyboard.press('Escape'); await win.waitForTimeout(300);
});

await step('settings and the Claude panel', async () => {
  await win.click('#settingsBtn'); await win.waitForTimeout(700);
  await shot(win, '09-settings');
  const txt = await win.evaluate(() => document.querySelector('dialog[open]')?.innerText || '');
  console.log('settings text (first 900):\n' + txt.slice(0, 900));
  await win.keyboard.press('Escape'); await win.waitForTimeout(300);
});

await step('practice', async () => {
  const p = win.getByRole('button', { name: /Practice|תרגול/ }).first();
  if (await p.count()) { await p.click(); await win.waitForTimeout(800); await shot(win, '10-practice'); await win.keyboard.press('Escape'); }
  else note('no Practice button visible in the course view');
});

console.log('\nconsole errors:\n' + (logs.join('\n') || 'none'));
console.log('\nFINDINGS:\n' + (findings.join('\n') || 'none'));
await claude.close().catch(() => {});
await app.close();
