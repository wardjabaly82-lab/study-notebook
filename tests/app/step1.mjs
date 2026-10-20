// Step 1: first launch as a brand-new student.
import { launch, shot } from './launch.mjs';

const { app, win, logs } = await launch({ fresh: true });
await win.waitForTimeout(2500);
console.log('title:', await win.title());
console.log(await shot(win, '01-first-launch'));
const dialogs = await win.$$eval('dialog[open]', ds => ds.map(d => (d.className || d.id) + ': ' + d.innerText.slice(0, 300)));
console.log('open dialogs:', JSON.stringify(dialogs, null, 1));
console.log('errors:', logs.join('\n') || 'none');
await app.close();
