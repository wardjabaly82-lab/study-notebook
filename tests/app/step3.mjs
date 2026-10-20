// Step 3: does a save from Claude reach the open app live?
import { launch, shot, REPO, CFG } from './launch.mjs';
import fs from 'fs';
import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const DIR = path.join(CFG, 'Study Notebook');
const { app, win } = await launch();
await win.waitForTimeout(2500);
console.log('data folder while app is open:', fs.readdirSync(DIR).filter(f => /connector|notebook-data/.test(f)).join(', '));
const tr = new StdioClientTransport({ command: process.execPath, args: [path.join(REPO, 'connector/src/server.js')], env: { ...process.env, STUDY_NOTEBOOK_DATA_DIR: DIR }, stderr: 'pipe' });
tr.stderr?.on('data', d => process.stdout.write('[connector stderr] ' + d));
const claude = new Client({ name: 't', version: '1' });
await claude.connect(tr);
const t0 = Date.now();
const r = await claude.callTool({ name: 'save_section', arguments: { course: 'מאקרו כלכלה', title: 'בדיקת עדכון חי', content: 'סעיף בדיקה: \\(x^2\\).' } });
console.log(`save took ${Date.now() - t0} ms; reply:\n` + r.content.map(c => c.text).join('\n'));
await win.waitForTimeout(1500);
const titles = await win.$$eval('.toc-link', a => a.map(x => x.textContent.trim()));
console.log('contents in the open app:', titles.join(' | '));
await shot(win, '11-live-save');
await claude.close(); await app.close();
