// Step 5: graphs, diagrams, callouts, highlighter and drawing, as a student. Profile at a short path so the live link works.
import { launch, shot, REPO, CFG } from './launch.mjs';
import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const bad = []; const ok = s => console.log('✓ ' + s); const fail = s => { bad.push(s); console.log('✗ ' + s); };
const check = (c, s) => (c ? ok(s) : fail(s));

let { app, win, logs } = await launch({ fresh: true });
await win.waitForTimeout(1800);
await win.getByRole('button', { name: 'Later' }).click();
const claude = new Client({ name: 't', version: '1' });
await claude.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(REPO, 'connector/src/server.js')], env: { ...process.env, STUDY_NOTEBOOK_DATA_DIR: path.join(CFG, 'Study Notebook') } }));
const call = async (name, args) => { const r = await claude.callTool({ name, arguments: args }); const t = r.content.map(c => c.text).join('\n'); if (r.isError) throw new Error(t); return JSON.parse(t.slice(0, t.lastIndexOf('}') + 1)); };
await call('create_course', { name: 'מאקרו כלכלה', notes_language: 'Hebrew' });

const econPlot = '```plot\n{"title": "עלייה בביקוש", "x": {"label": "Q", "min": 0, "max": 10, "names": {"5": "Q_0", "6": "Q_1"}}, "y": {"label": "P", "min": 0, "max": 10, "ticks": false},\n "items": [\n  {"type": "function", "fn": "10 - x", "label": "D_0", "color": "blue"},\n  {"type": "function", "fn": "12 - x", "label": "D_1", "color": "blue", "dash": true},\n  {"type": "function", "fn": "x", "label": "S", "color": "red"},\n  {"type": "point", "at": [5, 5], "label": "E_0", "guides": true},\n  {"type": "point", "at": [6, 6], "label": "E_1", "guides": true},\n  {"type": "area", "between": ["10 - x", "5"], "from": 0, "to": 5, "color": "blue", "label": "CS"},\n  {"type": "arrow", "from": [7.2, 2.4], "to": [8.3, 3.3], "color": "blue"}\n ]}\n```';
const flow = '```mermaid\nflowchart LR\n  H["משקי בית"] -- "הוצאה על מוצרים" --> F["פירמות"]\n  F -- "שכר, ריבית, רווח" --> H\n  H -- "מסים" --> G["ממשלה"]\n  G -- "קניות ממשלה" --> F\n```';
const topicA = `ה==ביקוש== מתאר כמה צרכנים רוצים לקנות בכל מחיר, וה<span class="c-red">היצע</span> כמה יצרנים רוצים למכור.\n\n> [!definition]\n> שיווי משקל הוא המחיר שבו הכמות המבוקשת שווה לכמות המוצעת: \\(Q_d = Q_s\\).\n\nכשהביקוש עולה, העקומה זזה ימינה והמחיר והכמות עולים:\n\n${econPlot}\n\n> [!mistake] טעות נפוצה\n> עלייה במחיר לא "מזיזה" את עקומת הביקוש; היא תזוזה **לאורך** העקומה.\n\nזרימת ההכנסה במשק:\n\n${flow}\n\nבסוף: =={green}המחיר נקבע במפגש בין הביקוש להיצע==.`;
const topicB = 'ההתפלגות הנורמלית הסטנדרטית:\n\n```plot\n{"title": "P(-1 < Z < 1)", "x": {"label": "z", "min": -3.5, "max": 3.5}, "items": [{"fn": "normpdf(x, 0, 1)", "color": "purple"}, {"type": "area", "fn": "normpdf(x, 0, 1)", "from": -1, "to": 1, "color": "purple", "label": "68%"}]}\n```\n\nצמיחה בתמ"ג:\n\n```plot\n{"type": "bar", "title": "צמיחה (%)", "labels": ["2023", "2024", "2025"], "series": [{"name": "ישראל", "values": [2, 0.9, 3.3]}, {"name": "OECD", "values": [1.7, 1.7, 1.8], "color": "gray"}], "show_values": true}\n```\n\nגרף שבור לבדיקה:\n\n```plot\n{"items": [{"fn": "10 - y"}]}\n```';
const saved = await call('save_sections', { course: 'מאקרו כלכלה', sections: [{ title: 'ביקוש והיצע', content: topicA }, { title: 'התפלגויות ונתונים', content: topicB }] });
const idA = saved.saved[0].section_id;
await win.waitForTimeout(2500);

// 1) What the student sees
const view = await win.evaluate(() => ({
  plots: document.querySelectorAll('.note figure.fig-plot svg.plot').length,
  diagrams: document.querySelectorAll('.note figure.fig-dia[data-done] svg').length,
  errors: [...document.querySelectorAll('.note .fig-error p')].map(p => p.textContent),
  callouts: [...document.querySelectorAll('.note blockquote.callout .co-title')].map(t => t.textContent),
  hl: [...document.querySelectorAll('.note mark.hl')].map(m => m.className + ':' + m.textContent),
  red: !!document.querySelector('.note span.c-red'),
  rawFence: /```|"items"/.test([...document.querySelectorAll('.note')].map(n => { const c = n.cloneNode(true); c.querySelectorAll('.fig-error').forEach(x => x.remove()); return c.textContent; }).join(''))
}));
console.log('view:', JSON.stringify(view));
check(view.plots === 3, `3 graphs drawn (supply/demand, normal curve, bar chart): ${view.plots}`);
check(view.diagrams === 1, 'the circular-flow diagram is drawn');
check(view.errors.length === 1 && /unknown name "y"/.test(view.errors[0]), 'the broken graph shows a clear error instead of breaking the page');
check(view.callouts.length === 2 && view.callouts.includes('הגדרה') && view.callouts.includes('טעות נפוצה'), 'callout boxes with Hebrew titles (default "הגדרה", given "טעות נפוצה")');
check(view.hl.length === 2 && view.hl.some(x => /green/.test(x)), '==highlights== from Claude, including a green one');
check(view.red, 'colored text from Claude');
check(!view.rawFence, 'no raw graph code visible');
await win.evaluate(() => document.querySelector('.note figure.fig-plot').scrollIntoView({ block: 'center' }));
await win.waitForTimeout(400); await shot(win, '30-graph');
await win.evaluate(() => document.querySelector('.note figure.fig-dia').scrollIntoView({ block: 'center' }));
await win.waitForTimeout(400); await shot(win, '31-diagram');

// 2) The student highlights a phrase
await win.evaluate(() => { document.querySelector('.note').scrollIntoView({ block: 'start' }); });
await win.waitForTimeout(300);
await win.evaluate(() => {
  const note = document.querySelector('.note'); const w = document.createTreeWalker(note, NodeFilter.SHOW_TEXT); let n;
  while ((n = w.nextNode())) if (n.nodeValue.includes('כמה צרכנים רוצים לקנות')) break;
  const i = n.nodeValue.indexOf('כמה צרכנים רוצים לקנות'); const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 'כמה צרכנים רוצים לקנות'.length);
  getSelection().removeAllRanges(); getSelection().addRange(r); document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
});
await win.waitForTimeout(300);
const barShown = await win.evaluate(() => { const b = document.querySelector('.mark-bar'); return !!b && !b.hidden; });
check(barShown, 'selecting text shows the highlighter colors');
await shot(win, '32-highlighter-bar');
await win.click('.mark-bar [data-c="pink"]'); await win.waitForTimeout(400);
check(await win.evaluate(() => [...document.querySelectorAll('.note mark.uh-pink')].map(m => m.textContent).join('') === 'כמה צרכנים רוצים לקנות'), 'the phrase is highlighted in pink');

// 3) The student draws: a pen stroke, a box and an arrow on the first paragraph
await win.click(`[data-act="draw"][data-id="${idA}"]`); await win.waitForTimeout(300);
check(await win.evaluate(() => !!document.querySelector('.draw-bar:not([hidden])') && !!document.querySelector('.ink-input')), 'Draw opens the drawing toolbar');
const p = await win.evaluate(() => { const r = document.querySelector('.note > p').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
const drag = async (pts) => { await win.mouse.move(pts[0][0], pts[0][1]); await win.mouse.down(); for (const q of pts.slice(1)) await win.mouse.move(q[0], q[1], { steps: 4 }); await win.mouse.up(); await win.waitForTimeout(250); };
await win.click('.draw-bar [data-tool="pen"]'); await win.click('.draw-bar [data-color="red"]');
await drag([[p.x + p.w * 0.55, p.y + p.h + 6], [p.x + p.w * 0.65, p.y + p.h + 9], [p.x + p.w * 0.75, p.y + p.h + 5], [p.x + p.w * 0.9, p.y + p.h + 8]]);
await win.click('.draw-bar [data-tool="rect"]'); await win.click('.draw-bar [data-color="blue"]');
await drag([[p.x + p.w * 0.05, p.y - 4], [p.x + p.w * 0.35, p.y + p.h + 4]]);
await win.click('.draw-bar [data-tool="arrow"]'); await win.click('.draw-bar [data-color="green"]');
await drag([[p.x + p.w * 0.2, p.y + p.h + 40], [p.x + p.w * 0.3, p.y + p.h + 6]]);
await win.click('.draw-bar [data-tool="marker"]'); await win.click('.draw-bar [data-color="yellow"]');
await drag([[p.x + p.w * 0.4, p.y + p.h * 0.5], [p.x + p.w * 0.5, p.y + p.h * 0.5]]);
await win.click('.draw-bar [data-undo]'); await win.waitForTimeout(250);   // the marker stroke goes away again
await shot(win, '33-drawing');
await win.click('.draw-bar [data-done]'); await win.waitForTimeout(200);
const inkCount = await win.evaluate(() => document.querySelectorAll('.note svg.ink > *').length);
check(inkCount === 3, `3 drawings kept (pen, box, arrow; the marker was undone): ${inkCount}`);

// 4) Claude answers a follow-up and adds to the topic: the highlight and drawings stay
const sec = await call('read_section', { course: 'מאקרו כלכלה', section_id: idA });
await call('edit_part', { course: 'מאקרו כלכלה', section_id: idA, find: 'כשהביקוש עולה, העקומה זזה ימינה והמחיר והכמות עולים:', replace: 'כשהביקוש עולה (למשל כי ההכנסה עלתה), העקומה זזה ימינה והמחיר והכמות עולים:' });
await call('save_section', { course: 'מאקרו כלכלה', section_id: idA, title: 'ביקוש והיצע', content: sec.content + '\n\nתוספת קטנה בסוף.' });
await win.waitForTimeout(1500);
check(await win.evaluate(() => !!document.querySelector('.note mark.uh-pink') && document.querySelectorAll('.note svg.ink > *').length === 3), 'after Claude updates the topic (edit_part and save_section) the highlight and drawings are still there');

// 5) Restart: everything is still there; dark mode
await claude.close(); await app.close();
({ app, win, logs: logs } = await launch());
await win.waitForTimeout(3000);
const after = await win.evaluate(() => ({ pink: document.querySelectorAll('.note mark.uh-pink').length, ink: document.querySelectorAll('.note svg.ink > *').length, plots: document.querySelectorAll('.note svg.plot').length, dia: document.querySelectorAll('.note .fig-dia[data-done] svg').length }));
check(after.pink >= 1 && after.ink === 3 && after.plots === 3 && after.dia === 1, `after restarting the app: highlight, 3 drawings, 3 graphs, 1 diagram (${JSON.stringify(after)})`);
await win.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark'); document.querySelector('.note').scrollIntoView({ block: 'start' }); });
await win.waitForTimeout(500); await shot(win, '34-dark-top');
await win.evaluate(() => document.querySelector('.note figure.fig-plot').scrollIntoView({ block: 'center' }));
await win.waitForTimeout(300); await shot(win, '35-dark-graph');
await win.evaluate(() => document.querySelector('.note figure.fig-dia').scrollIntoView({ block: 'center' }));
await win.waitForTimeout(300); await shot(win, '36-dark-diagram');
await win.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));

// 6) Print preview: graphs, diagram, callouts, highlight and drawing on paper
await win.getByRole('button', { name: /Print/ }).first().click();
await win.waitForSelector('.pr-pg', { timeout: 40000 }); await win.waitForTimeout(1200);
const pages = await win.$$eval('.pr-pg', x => x.length);
console.log('printed pages:', pages);
await shot(win, '37-print-preview');
await win.evaluate(() => { const v = document.querySelector('#prView'); v.scrollTop = v.scrollHeight * 0.35; }); await win.waitForTimeout(400); await shot(win, '38-print-page');
console.log('console errors:', logs.join('\n') || 'none');
console.log(bad.length ? `\n${bad.length} PROBLEM(S)` : '\nALL GOOD');
await app.close();
