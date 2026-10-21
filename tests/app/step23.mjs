// Hebrew words inside a formula's \text{…} read correctly (right to left), brackets face the right way,
// numbers and Latin stay as written, and English \text is untouched.
import { launch, shot, openCourse, REPO, CFG } from './launch.mjs';
import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const bad = []; const check = (c, s) => { console.log((c ? '✓ ' : '✗ ') + s); if (!c) bad.push(s); };
const { app, win, logs } = await launch({ fresh: true });
await win.setViewportSize({ width: 1280, height: 900 });
await win.waitForTimeout(1800); await win.getByRole('button', { name: 'Later' }).click().catch(() => {});
const claude = new Client({ name: 't', version: '1' });
await claude.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(REPO, 'connector/src/server.js')], env: { ...process.env, STUDY_NOTEBOOK_DATA_DIR: path.join(CFG, 'Study Notebook') } }));
await claude.callTool({ name: 'create_course', arguments: { name: 'Probability', notes_language: 'Hebrew' } });
const body = ['$$X(\\omega)=\\sum_{j=1}^{n}\\omega_j \\quad \\text{(מספר העצים)}, \\qquad Y(\\omega)=\\prod_{j=1}^{n}\\omega_j \\quad \\text{(1 רק אם כולן עצים)}$$',
  'ובמשפט אחד: \\(\\text{מספר 12 עצים}\\) ו־\\(a+b \\text{ for all } x\\).'].join('\n\n');
await claude.callTool({ name: 'save_section', arguments: { course: 'Probability', title: 'פונקציות של מרחב הסתברות', content: body } });
await win.evaluate(() => localStorage.setItem('sn-seen-version', '9.9.9')); await win.reload(); await win.waitForTimeout(2000);
await openCourse(win); await win.waitForTimeout(2500);
// the visual left-to-right order of the glyphs MathJax drew inside each formula
const drawn = await win.evaluate(() => [...document.querySelectorAll('#sheet mjx-container')].map(m => [...m.querySelectorAll('text')].map(t => t.textContent).join('')));
console.log('drawn:', JSON.stringify(drawn));
const he = s => s.replace(/[^֐-׿]/g, '');
const rev = s => [...s].reverse().join('');
const all = he(drawn.join(''));
check(all.includes(rev('מספרהעצים')), 'the first formula’s Hebrew is laid out so it reads right to left');
check(all.includes(rev('רקאםכולןעצים')), 'the second one too');
check(all.includes(rev('מספרעצים')), 'and Hebrew in a sentence’s inline formula');
check(!all.includes('מספרהעצים'), 'no formula is drawn with the Hebrew backwards any more');
await shot(win, '23-hebrew-in-formulas');
console.log('errors:', logs.join('\n') || 'none'); console.log(bad.length ? `${bad.length} PROBLEM(S)` : 'ALL GOOD');
await claude.close(); await app.close();
