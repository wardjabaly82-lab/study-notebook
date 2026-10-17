'use strict';
// The online server (cloud/) must be self-contained for Cloudflare's deploy button, so it keeps
// its own copies of the notebook operations and of what Claude is told. This keeps them identical.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const pairs = [
  ['renderer/notebook-ops.js', 'cloud/src/notebook-ops.js'],
  ['connector/src/instructions.js', 'cloud/src/instructions.js']
];
let changed = 0;
for (const [from, to] of pairs) {
  const a = fs.readFileSync(path.join(root, from));
  const target = path.join(root, to);
  if (!fs.existsSync(target) || !a.equals(fs.readFileSync(target))) { fs.writeFileSync(target, a); changed++; console.log('Updated', to); }
}
if (process.argv.includes('--check') && changed) { console.error('cloud/ copies were out of date (now updated): commit them.'); process.exit(1); }
