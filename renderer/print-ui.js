/* Print / PDF dialog: paper options, a real page-by-page preview, then
   "Save as PDF" or "Print…" (the printer's own dialog handles paper type,
   copies and double-sided printing). */
(() => {
  'use strict';
  const D = window.desktop;
  if (!D) return;
  const T = (k, v) => window.I18N.t(k, v);

  const PAPERS = [
    ['A4', 'A4 · 210 × 297 mm'], ['A5', 'A5 · 148 × 210 mm'], ['A3', 'A3 · 297 × 420 mm'], ['A6', 'A6 · 105 × 148 mm'],
    ['B5', 'B5 · 176 × 250 mm'], ['Letter', 'Letter · 8.5 × 11 in'], ['Legal', 'Legal · 8.5 × 14 in'], ['Tabloid', 'Tabloid · 11 × 17 in'],
    ['custom', 'Custom size…', true]
  ];
  const SIZES = [[9.5, 'Very small'], [10.5, 'Small'], [11.5, 'Normal'], [13, 'Large'], [14.5, 'Very large']];
  const STYLES = [['plain', 'Plain'], ['grid', 'Grid'], ['lined', 'Lined'], ['dotted', 'Dotted']];
  const DEFAULTS = { what: '', paper: 'A4', width: 210, height: 297, orientation: 'portrait', margins: 'normal', fontSize: 11.5, style: 'plain', titlePage: true, contents: true, topicBreaks: true, pageNumbers: true, ink: false };

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let opts = { ...DEFAULTS };
  try { opts = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('sn-print') || '{}') }; } catch (e) {}
  const remember = () => { try { const { what, ...keep } = opts; localStorage.setItem('sn-print', JSON.stringify(keep)); } catch (e) {} };

  const css = `
  .pr-dlg{border:0;border-radius:16px;padding:0;background:var(--raised);color:var(--ink);width:min(1120px,calc(100vw - 32px));height:min(800px,calc(100vh - 40px));box-shadow:var(--shadow-pop);font-family:var(--f-ui);overflow:hidden}
  .pr-dlg[open]{display:flex;flex-direction:column;animation:sheet-in var(--slow) var(--ease)}
  .pr-dlg::backdrop{background:var(--scrim);animation:fade var(--slow) ease}
  .pr-top{display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:.5px solid var(--line-strong)}
  .pr-top h2{margin:0;font-size:17px;font-weight:700;letter-spacing:-.015em;flex:1}
  .pr-main{flex:1;min-height:0;display:grid;grid-template-columns:300px minmax(0,1fr)}
  @media (max-width:760px){.pr-main{grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr)}.pr-side{max-height:42vh}}
  .pr-side{overflow:auto;padding:14px 16px;border-inline-end:.5px solid var(--line-strong);display:grid;background:color-mix(in srgb,var(--fill) 35%,var(--raised));gap:14px;align-content:start}
  .pr-f{display:grid;gap:6px;font-size:12.5px;color:var(--muted)}
  .pr-f > span{font-weight:600;letter-spacing:.04em;text-transform:uppercase;font-size:11.5px}
  .pr-f select,.pr-f input[type=number]{border:0;box-shadow:inset 0 0 0 .5px var(--line-strong);border-radius:8px;padding:7px 9px;background:var(--page);color:var(--ink);font:inherit;font-size:13.5px;width:100%}
  .pr-seg{display:flex;border:0;border-radius:9px;padding:2px;gap:2px;background:var(--fill)}
  .pr-seg button{flex:1;border:0;background:transparent;border-radius:7px;padding:5px 6px;font:inherit;font-size:13px;font-weight:500;color:var(--ink);transition:background-color var(--fast) ease}
  
  .pr-seg button[aria-pressed="true"]{background:var(--page);box-shadow:0 0 0 .5px rgba(0,0,0,.06),0 2px 6px rgba(0,0,0,.12)}
  .pr-sw{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
  .pr-sw button{border:0;box-shadow:inset 0 0 0 .5px var(--line-strong);border-radius:9px;background:#fff;padding:0 0 4px;cursor:pointer;font:inherit;font-size:11.5px;color:#333;display:grid;gap:4px;overflow:hidden}
  .pr-sw button[aria-pressed="true"]{box-shadow:inset 0 0 0 2px var(--accent)}
  .pr-sw i{display:block;height:34px;background:#fff}
  .pr-sw .grid i{background-image:linear-gradient(rgba(43,80,200,.25) 1px,transparent 1px),linear-gradient(90deg,rgba(43,80,200,.25) 1px,transparent 1px);background-size:6px 6px}
  .pr-sw .lined i{background-image:linear-gradient(transparent 7px,rgba(43,80,200,.3) 7px);background-size:100% 8px}
  .pr-sw .dotted i{background-image:radial-gradient(circle,rgba(43,80,200,.5) .8px,transparent 1.1px);background-size:6px 6px}
  .pr-two{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .pr-chk{display:flex;gap:8px;align-items:center;font-size:13.5px;color:var(--ink);cursor:pointer}
  .pr-chk input{width:16px;height:16px;accent-color:var(--accent)}
  .pr-note{font-size:12px;color:var(--muted);line-height:1.45;margin:0;background:var(--fill);border-radius:8px;padding:8px 10px}
  .pr-view{overflow:auto;background:color-mix(in srgb,var(--desk) 70%,#8e8e93 30%);padding:20px;display:flex;flex-direction:column;align-items:center;gap:16px;position:relative}
  .pr-page{background:#fff;border-radius:2px;box-shadow:0 0 0 .5px rgba(0,0,0,.08),0 4px 16px rgba(0,0,0,.16);display:block;max-width:100%}
  .pr-pn{font-size:11.5px;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.4);margin-top:-10px}
  .pr-busy{position:sticky;top:0;align-self:center;background:var(--ink);color:var(--paper);font-size:12.5px;border-radius:99px;padding:5px 12px;z-index:2}
  .pr-bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:12px 18px;border-top:.5px solid var(--line-strong)}
  .pr-info{flex:1;font-size:13px;color:var(--muted);min-width:160px}
  .pr-info.bad{color:var(--danger)}`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  let dlg = null, src = null, reqId = 0, timer = null, busy = false, lastInfo = '';

  function source() {
    src = window.snPrintSource ? window.snPrintSource(opts.what || null) : null;
    return src;
  }
  function sendOpts() {
    return { paper: opts.paper, width: Number(opts.width), height: Number(opts.height), orientation: opts.orientation, margins: opts.margins,
      fontSize: Number(opts.fontSize), style: opts.style, titlePage: opts.titlePage, contents: opts.contents, topicBreaks: opts.topicBreaks, pageNumbers: opts.pageNumbers, ink: opts.ink };
  }
  const payloadOf = s => ({ course: s.course, lang: s.lang, sections: s.sections, subtitle: s.subtitle });

  function seg(name, items) {
    return `<div class="pr-seg" data-name="${name}">${items.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${String(opts[name]) === String(v)}">${esc(l)}</button>`).join('')}</div>`;
  }

  function render() {
    const s = src || source();
    const topics = (s && s.topics) || [];
    dlg.innerHTML = `
      <div class="pr-top"><h2>${T('Print or save as PDF')}</h2><button type="button" class="sn-x" data-close aria-label="${esc(T('Close'))}">×</button></div>
      <div class="pr-main">
        <div class="pr-side">
          <label class="pr-f"><span>${T('What to print')}</span>
            <select data-k="what"><option value="">${T('Whole course')}${s ? ' · ' + esc(s.course) : ''}</option>${topics.map(t => `<option value="${esc(t.id)}"${t.id === opts.what ? ' selected' : ''}>${esc(T('Only: {title}', { title: t.title }))}</option>`).join('')}</select>
          </label>
          <label class="pr-f"><span>${T('Paper size')}</span>
            <select data-k="paper">${PAPERS.map(([v, l, tr]) => `<option value="${v}"${v === opts.paper ? ' selected' : ''}>${esc(tr ? T(l) : l)}</option>`).join('')}</select>
          </label>
          ${opts.paper === 'custom' ? `<div class="pr-two">
            <label class="pr-f">Width (mm)<input type="number" min="50" max="1200" step="1" data-k="width" value="${esc(opts.width)}"></label>
            <label class="pr-f">Height (mm)<input type="number" min="50" max="1200" step="1" data-k="height" value="${esc(opts.height)}"></label></div>` : ''}
          <div class="pr-f"><span>${T('Orientation')}</span>${seg('orientation', [['portrait', T('Portrait')], ['landscape', T('Landscape')]])}</div>
          <div class="pr-f"><span>${T('Margins')}</span>${seg('margins', [['narrow', T('Narrow')], ['normal', T('Normal')], ['wide', T('Wide')]])}</div>
          <label class="pr-f"><span>${T('Text size')}</span>
            <select data-k="fontSize">${SIZES.map(([v, l]) => `<option value="${v}"${Number(opts.fontSize) === v ? ' selected' : ''}>${T(l)}</option>`).join('')}</select>
          </label>
          <div class="pr-f"><span>${T('Paper style')}</span>
            <div class="pr-sw" data-name="style">${STYLES.map(([v, l]) => `<button type="button" class="${v}" data-v="${v}" aria-pressed="${opts.style === v}"><i></i>${T(l)}</button>`).join('')}</div>
          </div>
          <div class="pr-f" style="gap:8px"><span>${T('Include')}</span>
            <label class="pr-chk"><input type="checkbox" data-k="titlePage"${opts.titlePage ? ' checked' : ''}>${T('Title page')}</label>
            <label class="pr-chk"><input type="checkbox" data-k="contents"${opts.contents ? ' checked' : ''}>${T('Contents page')}</label>
            <label class="pr-chk"><input type="checkbox" data-k="topicBreaks"${opts.topicBreaks ? ' checked' : ''}>${T('Start each topic on a new page')}</label>
            <label class="pr-chk"><input type="checkbox" data-k="pageNumbers"${opts.pageNumbers ? ' checked' : ''}>${T('Page numbers')}</label>
            <label class="pr-chk"><input type="checkbox" data-k="ink"${opts.ink ? ' checked' : ''}>${T('Ink saver (black and white)')}</label>
          </div>
          <p class="pr-note">${T('Printing on special paper, like card, photo or colored paper? Click <b>Print…</b> and choose the paper type, copies and double-sided printing in your printer’s window.')}</p>
        </div>
        <div class="pr-view" id="prView" aria-label="${esc(T('Preview'))}"></div>
      </div>
      <div class="pr-bar">
        <span class="pr-info" id="prInfo" role="status">${esc(lastInfo)}</span>
        <button type="button" class="btn" data-close>${T('Cancel')}</button>
        <button type="button" class="btn" id="prPdf">${T('Save as PDF')}</button>
        <button type="button" class="btn primary" id="prPrint">${T('Print…')}</button>
      </div>`;
    wire();
  }

  function info(text, bad) { lastInfo = text; const el = dlg.querySelector('#prInfo'); if (el) { el.textContent = text; el.className = 'pr-info' + (bad ? ' bad' : ''); } }
  function setBusy(b) { busy = b; dlg.querySelectorAll('#prPdf,#prPrint').forEach(x => x.disabled = b); }

  function wire() {
    dlg.querySelectorAll('[data-close]').forEach(b => b.onclick = () => dlg.close());
    dlg.querySelectorAll('[data-k]').forEach(el => {
      el.onchange = () => {
        const k = el.dataset.k;
        opts[k] = el.type === 'checkbox' ? el.checked : el.value;
        if (k === 'what') src = null;
        remember();
        if (k === 'paper' || k === 'what') { render(); }
        schedule();
      };
    });
    dlg.querySelectorAll('[data-name] button').forEach(b => b.onclick = () => {
      const name = b.closest('[data-name]').dataset.name;
      opts[name] = b.dataset.v; remember();
      b.closest('[data-name]').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      schedule();
    });
    dlg.querySelector('#prPdf').onclick = async () => {
      const s = src || source(); if (!s) return;
      setBusy(true); info(T('Preparing the PDF…'));
      const r = await D.printSavePdf(payloadOf(s), sendOpts());
      setBusy(false);
      if (r.ok) {
        info(T('Saved.') + ' ');
        const el = dlg.querySelector('#prInfo');
        const b = document.createElement('button'); b.type = 'button'; b.className = 'sn-link'; b.textContent = T('Open the PDF');
        b.onclick = () => D.openPdf(r.path); el.appendChild(b);
      } else if (!r.cancelled) info(T(r.message || 'Couldn’t save the PDF.'), true);
      else info('');
    };
    dlg.querySelector('#prPrint').onclick = async () => {
      const s = src || source(); if (!s) return;
      setBusy(true); info(T('Opening the print window…'));
      const r = await D.printPaper(payloadOf(s), sendOpts());
      setBusy(false);
      info(r.ok ? T('Sent to the printer.') : r.cancelled ? '' : T(r.message || 'Couldn’t print.'), !r.ok && !r.cancelled);
    };
  }

  function schedule() { clearTimeout(timer); timer = setTimeout(preview, 350); }

  // Builds the real PDF and draws its pages, so what you see is exactly what prints.
  async function preview() {
    const view = dlg && dlg.querySelector('#prView'); if (!view) return;
    const s = src || source();
    if (!s || !s.sections.length) { view.innerHTML = '<p style="color:#fff">This notebook is empty, so there’s nothing to print yet.</p>'; return; }
    if (opts.paper === 'custom' && !(opts.width >= 50 && opts.width <= 1200 && opts.height >= 50 && opts.height <= 1200)) { info(T('Custom paper must be between 50 and 1200 mm on each side.'), true); return; }
    const id = ++reqId;
    let badge = view.querySelector('.pr-busy');
    if (!badge) { badge = document.createElement('div'); badge.className = 'pr-busy'; view.prepend(badge); }
    badge.textContent = T('Updating preview…');
    const r = await D.printPreview(payloadOf(s), sendOpts());
    if (id !== reqId || !dlg.open) return;
    if (!r.ok) { badge.remove(); if (/Already preparing/.test(r.message || '')) { schedule(); return; } info(T(r.message || 'Couldn’t make the preview.'), true); return; }
    try {
      if (!window.pdfjsLib) throw new Error('reader');
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
      const pdf = await pdfjsLib.getDocument({ data: r.data, isEvalSupported: false }).promise;
      if (id !== reqId) return;
      const frag = document.createDocumentFragment();
      const maxW = Math.min(view.clientWidth - 40, 640);
      const show = Math.min(pdf.numPages, 60);
      for (let n = 1; n <= show; n++) {
        const page = await pdf.getPage(n);
        if (id !== reqId) return;
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(maxW / base.width, 1.4);
        const vp = page.getViewport({ scale: scale * (window.devicePixelRatio || 1) });
        const c = document.createElement('canvas');
        c.width = vp.width; c.height = vp.height; c.className = 'pr-page';
        c.style.width = (vp.width / (window.devicePixelRatio || 1)) + 'px';
        c.setAttribute('aria-label', `Page ${n}`);
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        frag.appendChild(c);
        const pn = document.createElement('div'); pn.className = 'pr-pn'; pn.textContent = T('Page {n} of {total}', { n, total: pdf.numPages }); frag.appendChild(pn);
      }
      if (pdf.numPages > show) { const more = document.createElement('div'); more.className = 'pr-pn'; more.textContent = T('…and {n} more pages', { n: pdf.numPages - show }); frag.appendChild(more); }
      view.replaceChildren(frag);
      const paperName = opts.paper === 'custom' ? `${opts.width} × ${opts.height} mm` : opts.paper;
      info(window.I18N.tn(pdf.numPages, '1 page on {paper}, {orientation}', '{n} pages on {paper}, {orientation}', { paper: paperName === 'custom' ? T('Custom size…') : paperName, orientation: T(opts.orientation === 'landscape' ? 'landscape' : 'portrait') }));
    } catch (e) { badge.remove(); info(T('Couldn’t show the preview, but saving and printing still work.'), true); }
  }

  window.openPrint = () => {
    if (!dlg) { dlg = document.createElement('dialog'); dlg.className = 'pr-dlg'; document.body.appendChild(dlg); dlg.addEventListener('close', () => { reqId++; }); }
    src = null; lastInfo = '';
    if (opts.what && !(source() || { topics: [] }).topics.some(t => t.id === opts.what)) opts.what = '';
    src = null; source();
    render();
    if (!dlg.open) dlg.showModal();
    preview();
  };
})();
