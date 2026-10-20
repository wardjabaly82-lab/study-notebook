// Drawing: hold still at the end of a pen stroke and it's tidied (straight line, clean circle, clean box or
// triangle, or a smooth curve); Shift draws straight at 45° steps; a quick stroke stays as drawn.
import { launch, shot, openCourse, REPO, CFG } from './launch.mjs';
import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const bad = []; const check = (c, s) => { console.log((c ? '✓ ' : '✗ ') + s); if (!c) bad.push(s); };
const { app, win, logs } = await launch({ fresh: true });
await win.setViewportSize({ width: 1280, height: 1000 });
await win.waitForTimeout(1800); await win.getByRole('button', { name: 'Later' }).click().catch(() => {});
const claude = new Client({ name: 't', version: '1' });
await claude.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(REPO, 'connector/src/server.js')], env: { ...process.env, STUDY_NOTEBOOK_DATA_DIR: path.join(CFG, 'Study Notebook') } }));
await claude.callTool({ name: 'create_course', arguments: { name: 'Physics', notes_language: 'English' } });
await claude.callTool({ name: 'save_section', arguments: { course: 'Physics', title: 'Motion', content: ('A body keeps moving in a straight line unless a force acts on it. ').repeat(32) } });
await win.evaluate(() => localStorage.setItem('sn-seen-version', '9.9.9')); await win.reload(); await win.waitForTimeout(2000);
await openCourse(win);
await win.click('#drawBtn'); await win.waitForTimeout(400);
const o = await win.evaluate(() => { const r = document.querySelector('#sheet .note p').getBoundingClientRect(); return { x: r.left + 30, y: r.top + 10 }; });
const draw = async (pts, { hold = 0, shift = false } = {}) => {
  if (shift) await win.keyboard.down('Shift');
  await win.mouse.move(pts[0][0], pts[0][1]); await win.mouse.down();
  for (const [x, y] of pts.slice(1)) { await win.mouse.move(x, y, { steps: 2 }); await win.waitForTimeout(8); }
  if (hold) await win.waitForTimeout(hold);
  await win.mouse.up(); if (shift) await win.keyboard.up('Shift'); await win.waitForTimeout(300);
};
// the last stroke's points, read back from the page
const lastPts = () => win.evaluate(() => { const n = [...document.querySelectorAll('#sheet .note [data-ink]')].pop(); const d = n.getAttribute('d') || (n.querySelector('path') || n).getAttribute('d') || '';
  const v = (d.match(/-?\d+(\.\d+)?/g) || []).map(Number); const p = []; for (let i = 0; i + 1 < v.length; i += 2) p.push([v[i], v[i + 1]]); return p; });
const strokes = () => win.$$eval('#sheet .note [data-ink]', n => n.length);
const turns = p => { let n = 0, maxA = 0; for (let i = 1; i < p.length - 1; i++) { const a = Math.atan2(p[i][1] - p[i - 1][1], p[i][0] - p[i - 1][0]), b = Math.atan2(p[i + 1][1] - p[i][1], p[i + 1][0] - p[i][0]); let d = Math.abs(b - a); if (d > Math.PI) d = 2 * Math.PI - d; if (d > 0.5) n++; maxA = Math.max(maxA, d); } return { n, maxA }; };
const jitter = (i, a) => Math.sin(i * 1.7) * a;   // a steady, repeatable wobble

const zig = Array.from({ length: 14 }, (_, i) => [o.x + i * 22, o.y + 30 + (i % 2 ? 10 : -10)]);
await draw(zig);
const quick = await lastPts();
check(quick.length > 6 && turns(quick).maxA > 0.6, `a quick stroke stays as drawn (${quick.length} points)`);

await draw(Array.from({ length: 14 }, (_, i) => [o.x + i * 22, o.y + 90 + jitter(i, 2.5)]), { hold: 700 });
check((await lastPts()).length <= 2, 'a nearly straight stroke, held, becomes a straight line');

await draw(zig.map(([x, y]) => [x, y + 120]), { hold: 700 });
const sm = await lastPts(), st = turns(sm);
check(sm.length > 12 && st.maxA < 0.5, `a zigzag, held, becomes a smooth curve (sharpest bend ${(st.maxA * 57.3).toFixed(0)}°)`);

const cx = o.x + 120, cy = o.y + 290;
await draw(Array.from({ length: 40 }, (_, i) => { const t = i / 38 * 2 * Math.PI, r = 60 + jitter(i, 6); return [cx + r * Math.cos(t), cy + r * Math.sin(t)]; }), { hold: 700 });
const ci = await lastPts(); const mx = ci.reduce((s, p) => s + p[0], 0) / ci.length, my = ci.reduce((s, p) => s + p[1], 0) / ci.length;
const rs = ci.map(p => Math.hypot(p[0] - mx, p[1] - my)), rm = rs.reduce((s, r) => s + r, 0) / rs.length, spread = Math.max(...rs.map(r => Math.abs(r - rm))) / rm;
check(spread < 0.03, `a rough circle, held, becomes a clean circle (radius varies ${(spread * 100).toFixed(1)}%)`);

const sx = o.x + 280, sy = o.y + 230, S = 120, side = (ax, ay, bx, by, k) => Array.from({ length: 8 }, (_, i) => [ax + (bx - ax) * i / 8 + jitter(i + k, 3), ay + (by - ay) * i / 8 + jitter(i + k + 3, 3)]);
await draw([...side(sx, sy, sx + S, sy, 0), ...side(sx + S, sy, sx + S, sy + S, 1), ...side(sx + S, sy + S, sx, sy + S, 2), ...side(sx, sy + S, sx, sy, 3), [sx + 2, sy + 1]], { hold: 700 });
const sq = await lastPts(); const xs = sq.map(p => p[0]), ys = sq.map(p => p[1]); const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
const off = Math.max(...sq.map(([x, y]) => Math.min(Math.abs(x - x0), Math.abs(x - x1), Math.abs(y - y0), Math.abs(y - y1))));
check(off < 1.5, `a rough box, held, becomes a clean box with straight sides (farthest point ${off.toFixed(1)} from an edge)`);

const tx = o.x + 480, ty = o.y + 230;
const tri = [[tx + 60, ty], [tx + 130, ty + 120], [tx - 10, ty + 120]];
await draw([...side(tri[0][0], tri[0][1], tri[1][0], tri[1][1], 0), ...side(tri[1][0], tri[1][1], tri[2][0], tri[2][1], 1), ...side(tri[2][0], tri[2][1], tri[0][0], tri[0][1], 2), [tri[0][0] + 1, tri[0][1] + 2]], { hold: 700 });
const tp = await lastPts(), tt = turns(tp);
check(tt.n >= 2 && tt.n <= 4, `a rough triangle, held, becomes clean straight sides (${tt.n} corners counted)`);

await draw([[o.x, o.y + 420], [o.x + 100, o.y + 426], [o.x + 220, o.y + 431]], { shift: true });
const fl = await lastPts();
check(fl.length <= 2 && Math.abs(fl[0][1] - fl[fl.length - 1][1]) < 0.5, 'with Shift the line is straight and snaps to level');
check(await strokes() === 7, 'every stroke was saved once');
await shot(win, '21-tidy-shapes');
console.log('errors:', logs.join('\n') || 'none'); console.log(bad.length ? `${bad.length} PROBLEM(S)` : 'ALL GOOD');
await claude.close(); await app.close();
