'use strict';
// Turns the notes into a PDF or sends them to a printer.
// The notes are laid out in a hidden window (renderer/print.html), then
// Chromium's print engine paginates them on the chosen paper.
const { BrowserWindow } = require('electron');

// Paper sizes in millimetres (portrait).
const PAPER = {
  A3: [297, 420], A4: [210, 297], A5: [148, 210], A6: [105, 148],
  B5: [176, 250], Letter: [215.9, 279.4], Legal: [215.9, 355.6], Tabloid: [279.4, 431.8]
};
const MARGINS = { narrow: 10, normal: 18, wide: 25 };
const FONT_SIZES = [9.5, 10.5, 11.5, 13, 14.5];
const STYLES = ['plain', 'grid', 'lined', 'dotted'];

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// "1-3, 5" → [{from:0,to:2},{from:4,to:4}] (0-based, as the print engine wants). Empty means every page.
function parsePages(text) {
  const s = String(text || '').replace(/\s+/g, '');
  if (!s) return null;
  const bad = () => new Error('Page numbers look wrong. Try something like 1-3, 5.');
  if (!/^\d+(-\d+)?(,\d+(-\d+)?)*$/.test(s)) throw bad();
  return s.split(',').map(part => {
    const [a, b = a] = part.split('-').map(Number);
    if (a < 1 || b < a || b > 9999) throw bad();
    return { from: a - 1, to: b - 1 };
  });
}

// Accepts only known values; anything unexpected falls back to a safe default.
function cleanOpts(o) {
  o = isObj(o) ? o : {};
  let size;
  if (o.paper === 'custom') {
    const w = Number(o.width), h = Number(o.height);
    if (!(w >= 50 && w <= 1200 && h >= 50 && h <= 1200)) throw new Error('Custom paper must be between 50 and 1200 mm on each side.');
    size = [w, h];
  } else size = PAPER[o.paper] || PAPER.A4;
  let [w, h] = size;
  const landscape = o.orientation === 'landscape';
  if (landscape) [w, h] = [Math.max(w, h), Math.min(w, h)];
  const margin = MARGINS[o.margins] || MARGINS.normal;
  return {
    widthMm: w, heightMm: h, margin,
    fontSize: FONT_SIZES.includes(Number(o.fontSize)) ? Number(o.fontSize) : 11.5,
    style: STYLES.includes(o.style) ? o.style : 'plain',
    contents: !!o.contents, topicBreaks: !!o.topicBreaks, ink: !!o.ink, titlePage: !!o.titlePage, pageNumbers: o.pageNumbers !== false,
    pageRanges: parsePages(o.pages)
  };
}

function cleanPayload(p) {
  if (!isObj(p) || !Array.isArray(p.sections) || !p.sections.length || p.sections.length > 5000) throw new Error('Nothing to print.');
  let total = 0;
  const sections = p.sections.map(s => {
    if (!isObj(s)) throw new Error('bad section');
    const html = String(s.html || ''); total += html.length;
    return { title: String(s.title || '').slice(0, 300), depth: Math.max(0, Math.min(10, parseInt(s.depth, 10) || 0)), html };
  });
  if (total > 60 * 1024 * 1024) throw new Error('These notes are too large to print in one go. Print one topic at a time.');
  return {
    course: String(p.course || 'Study notes').slice(0, 200),
    subtitle: String(p.subtitle || '').slice(0, 300),
    lang: ['he', 'en', 'auto'].includes(p.lang) ? p.lang : 'auto',
    date: new Date().toLocaleDateString(p.lang === 'he' ? 'he-IL' : 'en-GB', { year: 'numeric', month: 'long', day: 'numeric' }),
    sections
  };
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mmToIn = mm => mm / 25.4;

async function layout(payload, opts, dev) {
  const w = new BrowserWindow({
    show: false, width: 900, height: 1200,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: dev }
  });
  w.webContents.on('will-navigate', e => e.preventDefault());
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  try {
    await w.loadURL('app://notebook/print.html');
    // JSON.stringify keeps the content as data; it is never evaluated as code.
    await w.webContents.executeJavaScript(`window.renderPrint(${JSON.stringify({ payload, opts })})`);
    return w;
  } catch (e) { w.destroy(); throw e; }
}

function footer(payload, opts) {
  if (!opts.pageNumbers) return '<span></span>';
  const side = `padding:0 ${opts.margin}mm`;
  return `<div style="font-family:Arial,sans-serif;font-size:8px;color:#777;width:100%;display:flex;justify-content:space-between;${side}"><span>${esc(payload.course)}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;
}

async function makePdf(rawPayload, rawOpts, dev) {
  const payload = cleanPayload(rawPayload), opts = cleanOpts(rawOpts);
  const w = await layout(payload, opts, dev);
  try {
    const m = mmToIn(opts.margin);
    const data = await w.webContents.printToPDF({
      pageSize: { width: mmToIn(opts.widthMm), height: mmToIn(opts.heightMm) },
      landscape: false,
      margins: { top: m, bottom: opts.pageNumbers ? Math.max(m, mmToIn(14)) : m, left: m, right: m },
      printBackground: true,
      displayHeaderFooter: opts.pageNumbers,
      headerTemplate: '<span></span>',
      footerTemplate: footer(payload, opts),
      generateDocumentOutline: true,
      // Chromium's own page-range text, e.g. "1-3,5" (1-based).
      ...(opts.pageRanges ? { pageRanges: opts.pageRanges.map(r => (r.from === r.to ? `${r.from + 1}` : `${r.from + 1}-${r.to + 1}`)).join(',') } : {})
    });
    return { data, payload, opts };
  } finally { w.destroy(); }
}

// Opens the computer's own print dialog, where the student picks the printer,
// paper type (plain, photo, card...), copies and double-sided printing.
async function printPaper(rawPayload, rawOpts, dev) {
  const payload = cleanPayload(rawPayload), opts = cleanOpts(rawOpts);
  const w = await layout(payload, opts, dev);
  const px = mm => Math.round(mm * 96 / 25.4);
  return new Promise(resolve => {
    w.webContents.print({
      silent: false,
      printBackground: true,
      pageSize: { width: Math.round(opts.widthMm * 1000), height: Math.round(opts.heightMm * 1000) },
      landscape: false,
      margins: { marginType: 'custom', top: px(opts.margin), bottom: px(opts.margin), left: px(opts.margin), right: px(opts.margin) },
      footer: opts.pageNumbers ? payload.course : undefined,
      ...(opts.pageRanges ? { pageRanges: opts.pageRanges } : {})
    }, (ok, reason) => { w.destroy(); resolve({ ok, reason: ok ? '' : String(reason || '') }); });
  });
}

module.exports = { makePdf, printPaper, PAPER };
