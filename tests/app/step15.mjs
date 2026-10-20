import { launch, shot, REPO, CFG, OUT } from './launch.mjs';
import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const bad = []; const check = (c, s) => { console.log((c ? '✓ ' : '✗ ') + s); if (!c) bad.push(s); };
const { app, win, logs } = await launch({ fresh: true });
await win.setViewportSize({ width: 1440, height: 900 });
await win.waitForTimeout(1800); await win.getByRole('button', { name: 'Later' }).click();
const claude = new Client({ name: 't', version: '1' });
await claude.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(REPO, 'connector/src/server.js')], env: { ...process.env, STUDY_NOTEBOOK_DATA_DIR: path.join(CFG, 'Study Notebook') } }));
await claude.callTool({ name: 'create_course', arguments: { name: 'Econometrics', notes_language: 'English' } });
await claude.callTool({ name: 'save_section', arguments: { course: 'Econometrics', title: 'Zero conditional mean', content: 'The key assumption of simple regression is that the **error term** has mean zero given x. Then the regression line is the conditional expectation of y.\n\n$$E(u \\mid x) = 0 \\implies E(y \\mid x) = \\beta_0 + \\beta_1 x$$\n\nA **regressor** is exogenous when it is uncorrelated with the error term. This is what makes OLS unbiased in practice and in theory as well.' } });
await claude.callTool({ name: 'save_section', arguments: { course: 'Econometrics', title: 'Omitted variable bias', content: 'When a relevant variable is left out, the estimate of **beta one** absorbs part of its effect. The **bias** equals beta two times delta one, which is the slope from regressing the omitted variable on x.' } });
await claude.callTool({ name: 'create_course', arguments: { name: 'Probability', notes_language: 'English' } });
await claude.callTool({ name: 'save_section', arguments: { course: 'Probability', title: 'Discrete spaces', content: 'A **sample space** is the set of all outcomes of an experiment. An **event** is a subset of the sample space. A probability function assigns each event a number between zero and one.' } });
await win.evaluate(() => { localStorage.setItem('sn-seen-version', '9.9.9'); const d = new Date(); const k = x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; const l = {}; for (let i = 0; i < 7; i++) { const x = new Date(d); x.setDate(d.getDate() - i); l[k(x)] = [50, 20, 0, 75, 40, 90, 30][i] * 60000; } localStorage.setItem('sn-study-log', JSON.stringify(l)); });
await win.waitForTimeout(2500);
// exam date for Econometrics through the course form
await win.reload(); await win.waitForTimeout(2500);
check(await win.evaluate(() => !document.getElementById('home').hidden && document.documentElement.hasAttribute('data-home')), 'the app opens on the home screen');
await win.click('.side .course >> nth=0', { button: 'right' }); await win.waitForTimeout(400);
const ex = new Date(); ex.setDate(ex.getDate() + 12); const exs = `${ex.getFullYear()}-${String(ex.getMonth() + 1).padStart(2, '0')}-${String(ex.getDate()).padStart(2, '0')}`;
await win.evaluate(v => { const i = document.getElementById('cfExam'); i.value = v; }, exs); await win.click('#cfForm button[type=submit]'); await win.waitForTimeout(500);
await win.click('#homeBtn'); await win.waitForTimeout(600);
const h = await win.evaluate(() => ({
  plan: [...document.querySelectorAll('.h-plan .h-list li')].map(l => l.textContent.replace(/\s+/g, ' ').trim()),
  saved: [...document.querySelectorAll('.h-saved li')].map(l => l.textContent.replace(/\s+/g, ' ').trim()),
  books: [...document.querySelectorAll('.h-book')].map(l => l.textContent.replace(/\s+/g, ' ').trim()),
  cont: (document.querySelector('.h-cont h2') || {}).textContent, math: !!document.querySelector('.h-cont mjx-container'),
  week: (document.querySelector('.h-big') || {}).textContent, bars: document.querySelectorAll('.h-bars span').length }));
console.log(JSON.stringify(h, null, 1));
check(h.plan.length >= 2 && /Econometrics/.test(h.plan[0]), 'tonight’s plan lists work across courses, nearest exam first');
check(h.saved.length === 3 && h.saved.every(x => /Claude/.test(x)), 'saved today shows the 3 topics Claude saved');
check(h.books.length === 2 && /Exam in 12 days/.test(h.books.join()) && /No exam date/.test(h.books.join()), 'each course shows its exam and readiness');
check(h.week.startsWith('5:05') && h.bars === 7, 'study time this week adds up (5:05) with 7 bars');
await shot(win, 'home-light');
// open a course, read, come back: continue shows it
await win.click('.h-book >> nth=0'); await win.waitForTimeout(800);
check(await win.evaluate(() => document.getElementById('home').hidden && !!document.querySelector('#sheet .sec')), 'clicking a course opens its notes');
await win.evaluate(() => { const w = document.getElementById('sheetWrap'); w.scrollTop = 0; w.dispatchEvent(new Event('scroll')); }); await win.waitForTimeout(500);
await win.click('#homeBtn'); await win.waitForTimeout(800);
const c2 = await win.evaluate(() => ({ t: document.querySelector('.h-cont h2').textContent, math: !!document.querySelector('.h-cont mjx-container') }));
check(c2.t === 'Zero conditional mean' && c2.math, 'continue reading shows the topic you were on, with its formula drawn');
await shot(win, 'home-light2');
await win.click('.h-cont .h-open'); await win.waitForTimeout(800);
check(await win.evaluate(() => document.getElementById('home').hidden && document.querySelector('.top h1').textContent.includes('Econometrics')), 'continue opens that course');
await win.click('#homeBtn'); await win.waitForTimeout(500);
await win.click('.h-go'); await win.waitForTimeout(800);
check(await win.evaluate(() => document.getElementById('home').hidden && !!document.querySelector('#pracBtn.on')), 'Start opens practice in the first course of the plan');

// highlight a sentence, then a word inside it in another colour
await win.click('#homeBtn'); await win.waitForTimeout(400); await win.click('.h-book >> nth=0'); await win.waitForTimeout(800);
const sel = async (word, whole) => { await win.evaluate(([w, all]) => { const p = [...document.querySelectorAll('#sheet .note p')].find(x => x.textContent.includes('regressor')); const tw = document.createTreeWalker(p, NodeFilter.SHOW_TEXT); let n, r = document.createRange();
  if (all) { r.selectNodeContents(p); } else { while ((n = tw.nextNode())) { const i = n.nodeValue.indexOf(w); if (i >= 0) { r.setStart(n, i); r.setEnd(n, i + w.length); break; } } }
  const s = getSelection(); s.removeAllRanges(); s.addRange(r); p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); }, [word, whole]); await win.waitForTimeout(300); };
await sel('', true); await win.click('.mark-bar [data-c="yellow"]'); await win.waitForTimeout(400);
await sel('uncorrelated', false); await win.click('.mark-bar [data-c="green"]'); await win.waitForTimeout(500);
const m = await win.evaluate(() => { const p = [...document.querySelectorAll('#sheet .note p')].find(x => x.textContent.includes('regressor')); return { y: [...p.querySelectorAll('mark.uh-yellow')].map(x => x.textContent).join(''), g: [...p.querySelectorAll('mark.uh-green')].map(x => x.textContent).join(''), gIn: !!p.querySelector('mark.uh-yellow mark.uh-green') }; });
console.log(JSON.stringify(m));
check(m.g === 'uncorrelated' && m.gIn && m.y.length > 100, 'the word turns green and the rest of the sentence stays yellow');
await win.evaluate(() => { const g = document.querySelector('mark.uh-green'); g.scrollIntoView({ block: 'center' }); });
const gb = await win.evaluate(() => { const r = document.querySelector('mark.uh-green').getBoundingClientRect(); return { x: r.x, y: r.y - 60, width: Math.max(500, r.width), height: 140 }; });
await win.screenshot({ path: path.join(OUT, 'nested-hl.png'), clip: { x: Math.max(0, gb.x - 250), y: Math.max(0, gb.y), width: 700, height: 160 } });
await win.reload(); await win.waitForTimeout(2500); await win.click('.h-book >> nth=0'); await win.waitForTimeout(1000);
check(await win.evaluate(() => !!document.querySelector('mark.uh-yellow mark.uh-green')), 'both highlights are still there after reopening');
// selecting the whole sentence again in pink replaces both inside it
await sel('', true); await win.click('.mark-bar [data-c="pink"]'); await win.waitForTimeout(500);
check(await win.evaluate(() => { const p = [...document.querySelectorAll('#sheet .note p')].find(x => x.textContent.includes('regressor')); return p.querySelectorAll('mark.uh-yellow, mark.uh-green').length === 0 && p.querySelectorAll('mark.uh-pink').length > 0; }), 're-highlighting the whole sentence replaces the old colours under it');

// Hebrew, dark, phone
await win.click('#homeBtn'); await win.evaluate(() => { localStorage.setItem('sn-ui-lang', 'he'); }); await win.reload(); await win.waitForTimeout(2500);
await shot(win, 'home-he');
await win.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark')); await win.waitForTimeout(200); await shot(win, 'home-he-dark');
await win.evaluate(() => document.documentElement.removeAttribute('data-theme'));
await win.setViewportSize({ width: 390, height: 844 }); await win.waitForTimeout(500); await shot(win, 'home-phone');
check(await win.evaluate(() => document.documentElement.scrollWidth <= 390 && document.getElementById('home').scrollWidth <= 390), 'no sideways scrolling on a phone');
await win.click('#navBtnHome'); await win.waitForTimeout(500);
check(await win.evaluate(() => document.body.classList.contains('nav-open')), 'the menu button on the phone opens the course list');
console.log('errors:', logs.join('\n') || 'none'); console.log(bad.length ? `${bad.length} PROBLEM(S)` : 'ALL GOOD');
await claude.close(); await app.close();
