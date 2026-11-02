// Your AI keys in Settings, and Ask AI on a selected passage (right-click).
// No network: a made-up key is saved and removed, and the Ask AI path without a key is checked.
import { launch, shot, openCourse, REPO, CFG } from './launch.mjs';
import path from 'path';
import fs from 'fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const bad = []; const check = (c, s) => { console.log((c ? '✓ ' : '✗ ') + s); if (!c) bad.push(s); };
const { app, win, logs } = await launch({ fresh: true });
await win.setViewportSize({ width: 1280, height: 900 });
await win.waitForTimeout(1800); await win.getByRole('button', { name: 'Later' }).click().catch(() => {});

// A course with one section, made through the connector (as the other tests do).
const claude = new Client({ name: 't', version: '1' });
await claude.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(REPO, 'connector/src/server.js')], env: { ...process.env, STUDY_NOTEBOOK_DATA_DIR: path.join(CFG, 'Study Notebook') } }));
await claude.callTool({ name: 'create_course', arguments: { name: 'Linear algebra', notes_language: 'English' } });
await claude.callTool({ name: 'save_section', arguments: { course: 'Linear algebra', title: 'Rank', content: 'The rank counts the non-zero rows. Count them after row reduction.' } });
await win.evaluate(() => localStorage.setItem('sn-seen-version', '9.9.9')); await win.reload(); await win.waitForTimeout(2000);
await openCourse(win); await win.waitForTimeout(1500);

// 1. Settings shows two key cards
await win.locator('#settingsBtn').click(); await win.waitForTimeout(800);
check(!(await win.locator('details.adv').evaluate(e => e.open)), 'AI keys are tucked away under a closed “Advanced”');
await win.locator('details.adv > summary').click(); await win.waitForTimeout(300);
const cards = await win.locator('.ai-key').count();
check(cards === 2, 'Settings shows a key card for Claude and one for Gemini');
const states = await win.locator('.ai-key [data-ai-state]').allTextContents();
check(states.every(s => s.trim() === 'Not set'), 'both keys start as “Not set”');
await shot(win, '24-settings-ai-keys');

// 2. A wrong-shaped key is refused, and nothing is saved
const claudeCard = win.locator('.ai-key[data-ai="anthropic"]');
await claudeCard.locator('[data-ai-input]').fill('hello');
await claudeCard.locator('[data-ai-save]').click(); await win.waitForTimeout(700);
const msg1 = await claudeCard.locator('[data-ai-msg]').textContent();
check(/doesn.t look like a key/.test(msg1), 'a wrong key is refused with a plain message');
check((await claudeCard.locator('[data-ai-state]').textContent()).trim() === 'Not set', 'nothing is saved after a refused key');

// 3. A well-shaped key is saved; the page shows only its last four characters
const fake = 'sk-ant-api03-' + 'a'.repeat(30) + 'WXYZ';
await claudeCard.locator('[data-ai-input]').fill(fake);
await claudeCard.locator('[data-ai-save]').click(); await win.waitForTimeout(900);
const state2 = await claudeCard.locator('[data-ai-state]').textContent();
check(/Saved \(ends in WXYZ\)/.test(state2), 'a saved key shows “Saved (ends in WXYZ)”');
check((await claudeCard.locator('[data-ai-input]').inputValue()) === '', 'the key is cleared from the box after saving');
const pageHtml = await win.content();
check(!pageHtml.includes(fake), 'the full key never appears in the page');

// 3b. Check key sends one real request to Anthropic. The made-up key must be refused with a plain message.
await claudeCard.locator('[data-ai-check]').click(); await win.waitForTimeout(6000);
const checkMsg = await claudeCard.locator('[data-ai-msg]').textContent();
check(/That key was not accepted/.test(checkMsg), 'Check key sends a real request; a made-up key is refused plainly');

// 4. Remove puts it back to “Not set”
win.once('dialog', d => d.accept());
await claudeCard.locator('[data-ai-clear]').click(); await win.waitForTimeout(900);
check((await claudeCard.locator('[data-ai-state]').textContent()).trim() === 'Not set', 'Remove puts the key back to “Not set”');
await win.keyboard.press('Escape'); await win.waitForTimeout(400);

// 5. Right-click a selected passage: Ask AI is offered; with no key it says so and opens Settings
await win.evaluate(() => {
  const p = document.querySelector('.sec p') || document.querySelector('.sec');
  const r = document.createRange(); r.selectNodeContents(p);
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
});
await win.evaluate(() => {
  const p = document.querySelector('.sec p') || document.querySelector('.sec');
  const b = p.getBoundingClientRect();
  p.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.left + 10, clientY: b.top + 10 }));
});
await win.waitForTimeout(400);
const menu = await win.locator('.ask-menu [data-ask-open]').count();
check(menu === 1, 'right-clicking selected text offers “Ask AI about this”');
await shot(win, '24-ask-menu');
await win.locator('.ask-menu [data-ask-open]').click(); await win.waitForTimeout(900);
// 6. With no key, Ask AI still works: it hands the question to the student's Claude chat
check((await win.locator('[data-ask-chat]').textContent()).trim() === 'Ask in Claude', 'with no key, the window offers “Ask in Claude”');
check(await win.locator('[data-ask-go]').count() === 0, 'and no “Answer here” (that needs a key)');
await win.locator('#askQ').fill('Why after row reduction?');
const opened = path.join(REPO, 'tests/app/shots/opened-urls.txt'); try { fs.unlinkSync(opened); } catch (e) {}
await win.locator('[data-ask-chat]').click(); await win.waitForTimeout(900);
check(/https:\/\/claude\.ai\/new/.test(fs.readFileSync(opened, 'utf8')), 'it opens a new Claude chat');
const pasted = await app.evaluate(({ clipboard }) => clipboard.readText());
check(/Linear algebra/.test(pasted) && /section id \S+/.test(pasted) && /> The rank counts/.test(pasted) && /Why after row reduction\?/.test(pasted) && /edit_part/.test(pasted),
  'the copied question names the course, topic and section, quotes the passage and asks to fix it');
check(/Question copied/.test(await win.locator('[data-ask-msg]').textContent()), 'the window says the question was copied');
await shot(win, '24-ask-in-chat');

console.log('errors:', logs.join('\n') || 'none');
console.log(bad.length ? `${bad.length} PROBLEM(S)` : 'ALL GOOD');
await claude.close(); await app.close();
