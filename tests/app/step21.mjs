// Drawing: hold still and the pen stroke snaps straight; Shift draws straight at 45° steps; a quick
// stroke stays as drawn.
import { launch, shot, openCourse, REPO, CFG } from './launch.mjs';
import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const bad = []; const check = (c, s) => { console.log((c ? '✓ ' : '✗ ') + s); if (!c) bad.push(s); };
const { app, win, logs } = await launch({ fresh: true });
await win.setViewportSize({ width: 1280, height: 820 });
await win.waitForTimeout(1800); await win.getByRole('button', { name: 'Later' }).click().catch(() => {});
const claude = new Client({ name: 't', version: '1' });
await claude.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(REPO, 'connector/src/server.js')], env: { ...process.env, STUDY_NOTEBOOK_DATA_DIR: path.join(CFG, 'Study Notebook') } }));
await claude.callTool({ name: 'create_course', arguments: { name: 'Physics', notes_language: 'English' } });
await claude.callTool({ name: 'save_section', arguments: { course: 'Physics', title: 'Motion', content: ('A body keeps moving in a straight line unless a force acts on it. ').repeat(12) } });
await win.evaluate(() => localStorage.setItem('sn-seen-version', '9.9.9')); await win.reload(); await win.waitForTimeout(2000);
await openCourse(win);
await win.click('#drawBtn'); await win.waitForTimeout(400);
const box = await win.evaluate(() => { const r = document.querySelector('#sheet .note p').getBoundingClientRect(); return { x: r.left + 40, y: r.top + 20, w: r.width - 80 }; });
const last = () => win.evaluate(() => { const id = document.querySelector('#sheet .note[data-note]').dataset.note; const s = window.SN && SN.section ? SN.section(id) : null;
  const ink = document.querySelectorAll('#sheet .note [data-ink]'); return { strokes: ink.length }; });
const strokes = async () => (await last()).strokes;
// a wobbly stroke, then hold still
const draw = async (pts, { hold = 0, shift = false } = {}) => {
  if (shift) await win.keyboard.down('Shift');
  await win.mouse.move(pts[0][0], pts[0][1]); await win.mouse.down();
  for (const [x, y] of pts.slice(1)) { await win.mouse.move(x, y, { steps: 3 }); await win.waitForTimeout(15); }
  if (hold) await win.waitForTimeout(hold);
  await win.mouse.up(); if (shift) await win.keyboard.up('Shift'); await win.waitForTimeout(300);
};
const pointsOfLast = () => win.evaluate(() => { const n = [...document.querySelectorAll('#sheet .note [data-ink]')].pop(); const d = n && (n.querySelector('path, polyline, line') || n);
  const a = d.getAttribute('d') || d.getAttribute('points') || ''; return (a.match(/-?\d+(\.\d+)?/g) || []).length / 2; });
const wobble = Array.from({ length: 12 }, (_, i) => [box.x + i * box.w / 22, box.y + (i % 2 ? 9 : -9)]);
const n0 = await strokes();
await draw(wobble);
check(await strokes() === n0 + 1 && await pointsOfLast() > 4, `a quick wobbly stroke stays as drawn (${await pointsOfLast()} points)`);
await draw(wobble.map(([x, y]) => [x, y + 60]), { hold: 700 });
check(await strokes() === n0 + 2 && await pointsOfLast() <= 2, `holding still at the end snaps it to a straight line (${await pointsOfLast()} points)`);
await draw([[box.x, box.y + 120], [box.x + 100, box.y + 126], [box.x + 220, box.y + 131]], { shift: true });
const flat = await win.evaluate(() => { const n = [...document.querySelectorAll('#sheet .note [data-ink]')].pop(); const d = n.querySelector('path, polyline, line') || n; const nums = ((d.getAttribute('d') || d.getAttribute('points') || '').match(/-?\d+(\.\d+)?/g) || []).map(Number); return nums.length >= 4 ? Math.abs(nums[1] - nums[nums.length - 1]) : 99; });
check(await pointsOfLast() <= 2 && flat < 0.5, `with Shift the line is straight and snaps to level (height difference ${flat.toFixed ? flat.toFixed(2) : flat})`);
await shot(win, '21-straight-lines');
console.log('errors:', logs.join('\n') || 'none'); console.log(bad.length ? `${bad.length} PROBLEM(S)` : 'ALL GOOD');
await claude.close(); await app.close();
