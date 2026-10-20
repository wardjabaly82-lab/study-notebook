// Windows: no text or buttons sit under the window buttons (top-right 140 x 40), scrolled or not, in English and Hebrew,
// and the window buttons take the colour of what's behind them.
import { launch, shot } from './launch.mjs';
const bad = []; const check = (ok, s) => { console.log((ok ? '✓ ' : '✗ ') + s); if (!ok) bad.push(s); };
const { app, win } = await launch({ fresh: true });
await app.evaluate(({ ipcMain }) => { global.__tb = null; ipcMain.on('app:titleBar', (e, c) => { global.__tb = c; }); });
await win.setViewportSize({ width: 1100, height: 560 });
await win.waitForTimeout(1800); await win.getByRole('button', { name: 'Later' }).click().catch(() => {});
await win.evaluate(() => localStorage.setItem('sn-seen-version', '9.9.9'));
const under = () => win.evaluate(() => {
  const hits = new Set();
  for (let x = innerWidth - 140; x < innerWidth; x += 10) for (let y = 1; y < 40; y += 6)
    for (const el of document.elementsFromPoint(x, y)) {
      if (el.closest('.drag-strip') || el === document.documentElement || el === document.body) continue;
      if ([...el.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim()) || /^(BUTTON|INPUT|svg|IMG|A|LABEL)$/i.test(el.tagName)) hits.add((el.id || el.className || el.tagName).toString().slice(0, 40));
    }
  return [...hits];
});
const behind = () => win.evaluate(() => { const c = document.createElement('canvas').getContext('2d'); let el = document.elementFromPoint(innerWidth - 4, 4);
  while (el && el !== document.body && getComputedStyle(el).backgroundColor === 'rgba(0, 0, 0, 0)') el = el.parentElement;
  c.fillStyle = getComputedStyle(el || document.body).backgroundColor; c.fillRect(0, 0, 1, 1); return '#' + [...c.getImageData(0, 0, 1, 1).data].slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join(''); });
for (const lang of ['en', 'he']) {
  await win.evaluate(l => { localStorage.setItem('sn-ui-lang', l); }, lang); await win.reload(); await win.waitForTimeout(2200);
  check((await under()).length === 0, `${lang}: no text or buttons under the window buttons ${JSON.stringify(await under())}`);
  await win.evaluate(() => { const h = document.querySelector('.home'); if (h) h.scrollTop = 9999; }); await win.waitForTimeout(300);
  check((await under()).length === 0, `${lang}: same with the page scrolled`);
  await win.evaluate(() => document.documentElement.setAttribute('data-theme', 'light')); await win.evaluate(() => window.dispatchEvent(new Event('focus')));
  await win.keyboard.press('Control+b'); await win.waitForTimeout(600); await win.keyboard.press('Control+b'); await win.waitForTimeout(600);
  const sent = await app.evaluate(() => global.__tb), want = await behind();
  check(sent && sent.color.toLowerCase() === want, `${lang}: window buttons use the colour behind them (sent ${sent && sent.color}, behind ${want})`);
  await shot(win, 'tb-' + lang);
}
console.log(bad.length ? `${bad.length} PROBLEM(S)` : 'ALL GOOD');
await app.close();
