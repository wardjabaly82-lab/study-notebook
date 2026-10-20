import { launch, shot } from './launch.mjs';
const bad = []; const check = (c, s) => { console.log((c ? '✓ ' : '✗ ') + s); if (!c) bad.push(s); };
const { app, win, logs } = await launch({ fresh: true });
await win.waitForTimeout(1800); await win.getByRole('button', { name: 'Later' }).click();
await win.evaluate(() => localStorage.setItem('sn-seen-version', '9.9.9'));
await win.click('.side .new-course'); await win.waitForTimeout(400); await win.fill('#cfName', 'okay'); await win.click('#cfForm button[type=submit]'); await win.waitForTimeout(600);
await win.evaluate(() => { const b = document.querySelector('[data-act="auto-save"]'); if (b) b.click(); });
await win.waitForTimeout(400);
if (!(await win.$('#copyAuto'))) { await win.click('#moreBtn'); await win.click('[data-act="auto-save"]'); await win.waitForTimeout(400); }
const clip = () => app.evaluate(({ clipboard }) => clipboard.readText());
await win.click('#copyAuto'); await win.waitForTimeout(300); const c1 = await clip();
await win.click('#copyAutoGem'); await win.waitForTimeout(300); const c2 = await clip();
console.log('--- CLAUDE ---\n' + c1 + '\n--- GEMINI ---\n' + c2);
check(/in this project/.test(c1) && /study-notebook/.test(c1) && !/@Study Notebook/.test(c1), 'Claude’s copy is unchanged');
check(/^Study Notebook course: "okay"\nIn each Gemini chat, type @ and pick Study Notebook from the list first[^\n]*\n\n/.test(c2) && !/in this project/.test(c2), 'Gemini’s copy starts with the “type @ and pick Study Notebook” line');
check(c1.split('\n').slice(4).join('\n') === c2.split('\n').slice(5).join('\n'), 'everything else is the same in both');
await shot(win, 'autosave');
console.log('errors:', logs.join('\n') || 'none'); console.log(bad.length ? 'PROBLEMS' : 'ALL GOOD');
await app.close();
