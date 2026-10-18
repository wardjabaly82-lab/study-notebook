// Copies the PDF reader, Markdown, sanitizer and math libraries into
// renderer/vendor so the app works fully offline. Runs after `npm install`.
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
// The libraries come from the app's node_modules, or (when building the website on Cloudflare,
// where only cloud/ is installed) from cloud/node_modules. An output folder can be given.
const nm = process.env.SN_VENDOR_FROM || path.join(root, 'node_modules');
const out = process.env.SN_VENDOR_TO || path.join(root, 'renderer', 'vendor');
const web = !!process.env.SN_VENDOR_WEB;   // the website needs no PDF reader

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const files = [
  ['marked/marked.min.js', 'marked.min.js'],
  ['dompurify/dist/purify.min.js', 'purify.min.js'],
  ['mermaid/dist/mermaid.min.js', 'mermaid.min.js'],   // diagrams in notes (loaded only when a note has one)
  ['pdfjs-dist/build/pdf.min.js', 'pdf.min.js'],
  ['pdfjs-dist/build/pdf.worker.min.js', 'pdf.worker.min.js']
];
for (const [from, to] of files) if (!(web && /^pdfjs/.test(from))) fs.copyFileSync(path.join(nm, from), path.join(out, to));

// MathJax: the TeX-to-SVG bundle plus the extensions it may load on demand.
const mj = path.join(nm, 'mathjax', 'es5');
const mjOut = path.join(out, 'mathjax');
fs.mkdirSync(mjOut, { recursive: true });
fs.copyFileSync(path.join(mj, 'tex-svg.js'), path.join(mjOut, 'tex-svg.js'));
for (const dir of ['input', 'output', 'ui', 'a11y', 'adaptors']) {
  fs.cpSync(path.join(mj, dir), path.join(mjOut, dir), { recursive: true });
}

// Fonts: Rubik (friendly UI and headings) and Frank Ruhl Libre (reading text); both cover Hebrew.
for (const pkg of ['rubik', 'frank-ruhl-libre']) {
  const from = path.join(nm, '@fontsource-variable', pkg);
  const to = path.join(out, 'fonts', pkg);
  fs.mkdirSync(path.join(to, 'files'), { recursive: true });
  fs.copyFileSync(path.join(from, 'index.css'), path.join(to, 'index.css'));
  for (const f of fs.readdirSync(path.join(from, 'files'))) if (/(latin|hebrew)/.test(f) && f.endsWith('.woff2')) fs.copyFileSync(path.join(from, 'files', f), path.join(to, 'files', f));
}

console.log('Copied offline libraries to renderer/vendor');
