'use strict';
/* Puts together the website's files in cloud/public: the notebook pages (the same ones the
   desktop app uses, from renderer/) and the landing page's pictures (cloud/landing/).
   Run by wrangler before every deploy or local run. */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const out = path.join(root, 'cloud', 'public');
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, 'renderer'), out, { recursive: true, filter: src => !/pdf(\.worker)?\.min\.js$/.test(src) });
const landing = path.join(root, 'cloud', 'landing');
if (fs.existsSync(landing)) fs.cpSync(landing, path.join(out, 'landing'), { recursive: true });
let n = 0; (function count(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) f.isDirectory() ? count(path.join(d, f.name)) : n++; })(out);
console.log(`Website files ready: ${n} files in cloud/public`);
