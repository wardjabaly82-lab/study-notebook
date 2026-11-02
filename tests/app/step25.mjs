// Ask AI end to end, against a local stand-in for Google and Anthropic (SN_AI_TEST_BASE).
// Gemini's model is retired (404) and the app must find the new one by itself; the answer
// changes the passage; "Answer here" follows the AI the student picked.
import http from 'http';
import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const bad = []; const check = (c, s) => { console.log((c ? '✓ ' : '✗ ') + s); if (!c) bad.push(s); };

const seen = [];
const server = http.createServer((req, res) => {
  let raw = ''; req.on('data', c => raw += c); req.on('end', () => {
    const body = raw ? JSON.parse(raw) : null;
    const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    seen.push(`${req.method} ${req.url}`);
    if (req.url.startsWith('/v1beta/models?')) return send(200, { models: [{ name: 'models/gemini-4.0-flash', supportedGenerationMethods: ['generateContent'] }] });
    if (req.url.includes('gemini-3.8-flash')) return send(404, { error: { code: 404, message: 'This model models/gemini-3.8-flash is no longer available to new users.' } });
    if (req.url.includes('gemini-4.0-flash')) {
      const last = body.contents[body.contents.length - 1];
      const intro = body.contents[0].parts[0].text || '';
      if (last.parts.some(p => p.functionResponse)) return send(200, { candidates: [{ content: { role: 'model', parts: [{ text: 'Gemini: I rewrote the sentence.' }] }, finishReason: 'STOP' }] });
      if (/Question:/.test(intro)) {
        const id = /Section id: (\S+)/.exec(intro)[1];
        return send(200, { candidates: [{ content: { role: 'model', parts: [{ functionCall: { id: 'c1', name: 'edit_part', args: { section_id: id, find: 'The rank counts the non-zero rows.', replace: 'The rank is the number of independent rows.' } } }] } }] });
      }
      return send(200, { candidates: [{ content: { role: 'model', parts: [{ text: 'OK' }] }, finishReason: 'STOP' }] });
    }
    if (req.url === '/v1/messages') return send(200, { content: [{ type: 'text', text: 'Claude: rank explained.' }], stop_reason: 'end_turn' });
    send(404, { error: { message: 'unknown' } });
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
process.env.SN_AI_TEST_BASE = `http://127.0.0.1:${server.address().port}`;

const { launch, shot, openCourse, REPO, CFG } = await import('./launch.mjs');
const { app, win, logs } = await launch({ fresh: true });
await win.setViewportSize({ width: 1280, height: 900 });
await win.waitForTimeout(1800); await win.getByRole('button', { name: 'Later' }).click().catch(() => {});

const claude = new Client({ name: 't', version: '1' });
await claude.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(REPO, 'connector/src/server.js')], env: { ...process.env, STUDY_NOTEBOOK_DATA_DIR: path.join(CFG, 'Study Notebook') } }));
await claude.callTool({ name: 'create_course', arguments: { name: 'Linear algebra', notes_language: 'English' } });
await claude.callTool({ name: 'save_section', arguments: { course: 'Linear algebra', title: 'Rank', content: 'The rank counts the non-zero rows. Count them after row reduction.' } });
await win.evaluate(() => localStorage.setItem('sn-seen-version', '9.9.9')); await win.reload(); await win.waitForTimeout(2000);
await openCourse(win); await win.waitForTimeout(1500);

// 1. Save both keys; Check key on Gemini works even though its model was retired
await win.locator('#settingsBtn').click(); await win.waitForTimeout(800);
await win.locator('details.adv > summary').click(); await win.waitForTimeout(300);
const save =async (id, key) => { const c = win.locator(`.ai-key[data-ai="${id}"]`); await c.locator('[data-ai-input]').fill(key); await c.locator('[data-ai-save]').click(); await win.waitForTimeout(700); };
await save('anthropic', 'sk-ant-api03-' + 'a'.repeat(30) + 'WXYZ');
await save('gemini', 'AIza' + 'b'.repeat(30) + 'QRST');
const gem = win.locator('.ai-key[data-ai="gemini"]');
await gem.locator('[data-ai-check]').click(); await win.waitForTimeout(1500);
check(/Your Gemini key works/.test(await gem.locator('[data-ai-msg]').textContent()), 'Check key works after Google retires the model');
check(seen.some(s => s.startsWith('GET /v1beta/models')), 'the app asked Google which models it can use');
await win.keyboard.press('Escape'); await win.waitForTimeout(400);

const askOn = async () => {
  await win.evaluate(() => {
    const p = document.querySelector('.sec p') || document.querySelector('.sec');
    const r = document.createRange(); r.selectNodeContents(p.firstChild || p);
    r.setEnd(p.firstChild, 'The rank counts the non-zero rows.'.length);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    const b = p.getBoundingClientRect();
    p.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.left + 10, clientY: b.top + 10 }));
  });
  await win.waitForTimeout(300);
  await win.locator('.ask-menu [data-ask-open]').click(); await win.waitForTimeout(700);
};

// 2. A student who studies with Gemini and saved a key: "Answer here" uses Gemini and changes the passage.
await win.evaluate(() => localStorage.setItem('sn-ai-choice', 'gemini'));
await askOn();
check((await win.locator('[data-ask-chat]').textContent()).trim() === 'Ask in Gemini', 'the window offers the AI the student picked (Gemini)');
check(await win.locator('[data-ask-go]').count() === 1, 'with a key saved, “Answer here” is offered too');
await win.locator('#askQ').fill('Why?');
await win.locator('[data-ask-go]').click(); await win.waitForTimeout(2500);
check(/Gemini: I rewrote the sentence/.test(await win.locator('.ask-answer').textContent()), 'Gemini’s answer is shown');
await shot(win, '25-ask-gemini');
await win.keyboard.press('Escape'); await win.waitForTimeout(500);
const text = await win.locator('.sec').first().textContent();
check(/independent rows/.test(text) && !/counts the non-zero rows/.test(text), 'the passage in the note was changed');
check(/Updated by Gemini/.test(text), 'the note says Gemini made the change');

// 3. A student who studies with Claude: "Answer here" uses the Claude key
await win.evaluate(() => localStorage.setItem('sn-ai-choice', 'claude'));
await win.evaluate(() => { const p = document.querySelector('.sec p'); const r = document.createRange(); r.selectNodeContents(p); const s = getSelection(); s.removeAllRanges(); s.addRange(r); const b = p.getBoundingClientRect(); p.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.left + 10, clientY: b.top + 10 })); });
await win.waitForTimeout(300); await win.locator('.ask-menu [data-ask-open]').click(); await win.waitForTimeout(700);
check((await win.locator('[data-ask-chat]').textContent()).trim() === 'Ask in Claude', 'the window follows the choice (Claude)');
await win.locator('[data-ask-go]').click(); await win.waitForTimeout(2000);
check(/Claude: rank explained/.test(await win.locator('.ask-answer').textContent()), '“Answer here” answers with Claude');
await shot(win, '25-ask-claude');

console.log('errors:', logs.join('\n') || 'none');
console.log(bad.length ? `${bad.length} PROBLEM(S)` : 'ALL GOOD');
await claude.close(); await app.close(); server.close();
