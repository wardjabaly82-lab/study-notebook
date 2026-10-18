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
  const DEFAULTS = { what: '', pages: '', paper: 'A4', width: 210, height: 297, orientation: 'portrait', margins: 'normal', fontSize: 11.5, style: 'plain', titlePage: true, contents: true, topicBreaks: true, pageNumbers: true, ink: false };

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let opts = { ...DEFAULTS };
  try { opts = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('sn-print') || '{}') }; } catch (e) {}
  const remember = () => { try { const { what, ...keep } = opts; localStorage.setItem('sn-print', JSON.stringify(keep)); } catch (e) {} };
  // Section ids ticked in "Choose sections" (kept only while the app runs). null = the whole course.
  let picked = null;
  const pickIsEmpty = () => opts.what === '__pick' && !!picked && picked.length === 0;

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
  .pr-f select,.pr-f input[type=number],.pr-f input[type=text]{border:0;box-shadow:inset 0 0 0 .5px var(--line-strong);border-radius:8px;padding:7px 9px;background:var(--page);color:var(--ink);font:inherit;font-size:13.5px;width:100%}
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
  .pr-pg{position:relative;display:block;max-width:100%;cursor:pointer;border-radius:2px;outline:none;transition:opacity var(--fast) ease}
  .pr-pg canvas{transition:opacity var(--fast) ease}
  .pr-pg.off canvas{opacity:.38}
  .pr-pg:focus-visible{box-shadow:0 0 0 3px var(--accent)}
  .pr-tick{position:absolute;top:8px;inset-inline-end:8px;width:24px;height:24px;border-radius:50%;background:rgba(0,0,0,.28);border:2px solid #fff;color:#fff;display:grid;place-items:center;font-size:13px;font-weight:700;line-height:1;box-shadow:0 1px 3px rgba(0,0,0,.3);pointer-events:none}
  .pr-pg.on .pr-tick{background:var(--accent);border-color:var(--accent)}
  .pr-pg.off .pr-tick{background:transparent;color:transparent}
  .pr-busy{position:sticky;top:0;align-self:center;background:var(--ink);color:var(--paper);font-size:12.5px;border-radius:99px;padding:5px 12px;z-index:2}
  .pr-bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:12px 18px;border-top:.5px solid var(--line-strong)}
  .pr-info{flex:1;font-size:13px;color:var(--muted);min-width:160px;overflow-wrap:anywhere}
  .pr-info.bad{color:var(--danger)}`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  let dlg = null, src = null, reqId = 0, timer = null, busy = false, lastInfo = '';

  function source() {
    src = window.snPrintSource ? window.snPrintSource(opts.what === '__pick' ? null : (opts.what || null), opts.what === '__pick' ? picked : null) : null;
    return src;
  }
  function sendOpts() {
    const o = { paper: opts.paper, width: Number(opts.width), height: Number(opts.height), orientation: opts.orientation, margins: opts.margins,
      fontSize: Number(opts.fontSize), style: opts.style, titlePage: opts.titlePage, contents: opts.contents, topicBreaks: opts.topicBreaks, pageNumbers: opts.pageNumbers, ink: opts.ink, pages: String(opts.pages || '') };
    // A formula sheet is meant to be short: no title page, no contents, topics run on, smaller text.
    if (opts.what === '__formulas') Object.assign(o, { titlePage: false, contents: false, topicBreaks: false, fontSize: Math.min(o.fontSize, 9.5), margins: opts.margins === 'wide' ? 'normal' : opts.margins });
    return o;
  }
  const payloadOf = s => ({ course: s.course, lang: s.lang, sections: s.sections, subtitle: s.subtitle });

  function seg(name, items) {
    return `<div class="pr-seg" data-name="${name}">${items.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${String(opts[name]) === String(v)}">${esc(l)}</button>`).join('')}</div>`;
  }

  function render() {
    const s = src || source();
    const topics = (s && s.topics) || [];
    const pickEmpty = pickIsEmpty();
    dlg.innerHTML = `
      <div class="pr-top"><h2>${T('Print or save as PDF')}</h2><button type="button" class="sn-x" data-close aria-label="${esc(T('Close'))}">×</button></div>
      <div class="pr-main">
        <div class="pr-side">
          <label class="pr-f"><span>${T('What to print')}</span>
            <select data-k="what"><option value="">${T('Whole course')}${s ? ' · ' + esc(s.course) : ''}</option><option value="__formulas"${opts.what === '__formulas' ? ' selected' : ''}>${T('Formula sheet')}</option><option value="__pick"${opts.what === '__pick' ? ' selected' : ''}>${T('Choose sections…')}</option>${topics.map(t => `<option value="${esc(t.id)}"${t.id === opts.what ? ' selected' : ''}>${esc(T('Only: {title}', { title: t.title }))}</option>`).join('')}</select>
          </label>
          ${opts.what === '__pick' ? pickList(s) : ''}
          <label class="pr-f"><span>${T('Pages')}</span>
            <input type="text" data-k="pages" value="${esc(opts.pages)}" placeholder="${esc(T('All pages'))}" inputmode="numeric" autocomplete="off" spellcheck="false">
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
        <button type="button" class="btn" id="prPdf"${pickEmpty ? ' disabled' : ''}>${T('Save as PDF')}</button>
        <button type="button" class="btn primary" id="prPrint"${pickEmpty ? ' disabled' : ''}>${T('Print…')}</button>
      </div>`;
    wire();
  }

  // Every section with a checkbox, indented by depth, plus All / None.
  function pickList(s) {
    const tree = (s && s.tree) || [];
    const on = new Set(picked || tree.map(x => x.id));
    const rows = tree.map(x => `<label style="display:flex;align-items:center;gap:6px;padding-inline-start:${Math.min(x.depth, 4) * 14}px;font-size:13px;cursor:pointer"><input type="checkbox" data-pick="${esc(x.id)}"${on.has(x.id) ? ' checked' : ''}><span dir="auto">${esc(x.title)}</span></label>`).join('');
    return `<div class="pr-f" style="gap:6px">
      <div style="display:flex;align-items:center;gap:8px"><span style="flex:1">${esc(T('Choose which sections to print'))}</span><button type="button" class="btn" data-pick-all="all">${esc(T('All'))}</button><button type="button" class="btn" data-pick-all="none">${esc(T('None'))}</button></div>
      <div style="display:grid;gap:4px;max-height:220px;overflow:auto;border:1px solid var(--rule);border-radius:8px;padding:8px">${rows || `<span class="pr-note">${esc(T('No sections yet.'))}</span>`}</div>
      ${pickIsEmpty() ? `<p class="pr-note">${esc(T('Choose at least one section.'))}</p>` : ''}
    </div>`;
  }

  function info(text, bad) { lastInfo = text; const el = dlg.querySelector('#prInfo'); if (el) { el.textContent = text; el.className = 'pr-info' + (bad ? ' bad' : ''); } }
  function setBusy(b) { busy = b; dlg.querySelectorAll('#prPdf,#prPrint').forEach(x => x.disabled = b || pickIsEmpty()); }

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
    dlg.querySelectorAll('[data-pick]').forEach(cb => cb.onchange = () => {
      const id = cb.dataset.pick;
      picked = cb.checked ? [...new Set([...(picked || []), id])] : (picked || []).filter(x => x !== id);
      src = null; render(); schedule();
    });
    dlg.querySelectorAll('[data-pick-all]').forEach(b => b.onclick = () => {
      const s = source();
      picked = b.dataset.pickAll === 'all' ? ((s && s.tree) || []).map(x => x.id) : [];
      src = null; render(); schedule();
    });
    dlg.querySelector('#prPdf').onclick = async () => {
      const s = src || source(); if (!s) return;
      setBusy(true); info(T('Preparing the PDF…'));
      const r = await D.printSavePdf(payloadOf(s), sendOpts());
      setBusy(false);
      if (r.ok) {
        info(T('Saved to {path}', { path: r.path }) + ' ');
        const el = dlg.querySelector('#prInfo');
        const b = document.createElement('button'); b.type = 'button'; b.className = 'sn-link'; b.textContent = T('Open the PDF');
        b.onclick = () => D.openPdf(r.path); el.appendChild(b);
        const f = document.createElement('button'); f.type = 'button'; f.className = 'sn-link'; f.textContent = T('Show in folder');
        f.onclick = () => D.showPdfInFolder(r.path); el.appendChild(f);
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

  // Page picking: the preview always shows the whole notebook, and each page can be ticked or dropped.
  let previewTotal = 0;
  // The ticked pages from the Pages text ("1-3, 5"). Empty or unreadable text means every page.
  function parsePageText(text, total) {
    const s = String(text || '').replace(/\s+/g, '');
    if (!s || !/^\d+(-\d+)?(,\d+(-\d+)?)*$/.test(s)) return null;
    const set = new Set();
    for (const part of s.split(',')) {
      const [a, b = a] = part.split('-').map(Number);
      for (let n = Math.max(1, a); n <= Math.min(b, total); n++) set.add(n);
    }
    return set;
  }
  function includedSet(total) {
    return parsePageText(opts.pages, total) || new Set(Array.from({ length: total }, (_, i) => i + 1));
  }
  // Writes the ticked pages back as text, e.g. "1-3,5". All pages means empty text.
  function pagesText(set, total) {
    if (set.size === total) return '';
    const nums = [...set].sort((x, y) => x - y), out = [];
    for (let i = 0; i < nums.length;) {
      let j = i;
      while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
      out.push(nums[i] === nums[j] ? `${nums[i]}` : `${nums[i]}-${nums[j]}`);
      i = j + 1;
    }
    return out.join(',');
  }
  function paperInfo(total, sel) {
    if (sel < total) return T('{n} of {total} pages selected', { n: sel, total });
    const paperName = opts.paper === 'custom' ? `${opts.width} × ${opts.height} mm` : opts.paper;
    return window.I18N.tn(total, '1 page on {paper}, {orientation}', '{n} pages on {paper}, {orientation}', { paper: paperName === 'custom' ? T('Custom size…') : paperName, orientation: T(opts.orientation === 'landscape' ? 'landscape' : 'portrait') });
  }
  function togglePage(n) {
    if (!previewTotal) return;
    const set = includedSet(previewTotal);
    if (set.has(n)) {
      if (set.size === 1) { info(T('Keep at least one page selected.'), true); return; }
      set.delete(n);
    } else set.add(n);
    opts.pages = pagesText(set, previewTotal); remember();
    const input = dlg.querySelector('input[data-k="pages"]'); if (input) input.value = opts.pages;
    const el = dlg.querySelector(`.pr-pg[data-n="${n}"]`);
    if (el) { const on = set.has(n); el.classList.toggle('on', on); el.classList.toggle('off', !on); el.setAttribute('aria-checked', String(on)); }
    info(paperInfo(previewTotal, set.size));
  }

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
    const r = await D.printPreview(payloadOf(s), { ...sendOpts(), pages: '' });
    if (id !== reqId || !dlg.open) return;
    if (!r.ok) { badge.remove(); if (/Already preparing/.test(r.message || '')) { schedule(); return; } info(T(r.message || 'Couldn’t make the preview.'), true); return; }
    try {
      if (!window.pdfjsLib) await new Promise((ok, bad) => { const sc = document.createElement('script'); sc.src = 'vendor/pdf.min.js'; sc.onload = ok; sc.onerror = () => bad(new Error('reader')); document.head.appendChild(sc); });
      if (!window.pdfjsLib) throw new Error('reader');
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
      const pdf = await pdfjsLib.getDocument({ data: r.data, isEvalSupported: false }).promise;
      if (id !== reqId) return;
      const frag = document.createDocumentFragment();
      const maxW = Math.min(view.clientWidth - 40, 640);
      const show = Math.min(pdf.numPages, 60);
      previewTotal = pdf.numPages;
      const ticked = includedSet(previewTotal);
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
        const on = ticked.has(n);
        const wrap = document.createElement('div');
        wrap.className = 'pr-pg ' + (on ? 'on' : 'off');
        wrap.dataset.n = n; wrap.tabIndex = 0; wrap.setAttribute('role', 'checkbox'); wrap.setAttribute('aria-checked', String(on));
        wrap.setAttribute('aria-label', T('Page {n}', { n }));
        const tick = document.createElement('span'); tick.className = 'pr-tick'; tick.textContent = '✓';
        wrap.append(c, tick);
        frag.appendChild(wrap);
        const pn = document.createElement('div'); pn.className = 'pr-pn'; pn.textContent = T('Page {n} of {total}', { n, total: pdf.numPages }); frag.appendChild(pn);
      }
      if (pdf.numPages > show) { const more = document.createElement('div'); more.className = 'pr-pn'; more.textContent = T('…and {n} more pages', { n: pdf.numPages - show }); frag.appendChild(more); }
      view.replaceChildren(frag);
      view.onclick = e => { const pg = e.target.closest && e.target.closest('.pr-pg'); if (pg) togglePage(Number(pg.dataset.n)); };
      view.onkeydown = e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('pr-pg')) { e.preventDefault(); togglePage(Number(e.target.dataset.n)); } };
      info(paperInfo(previewTotal, ticked.size));
    } catch (e) { badge.remove(); info(T('Couldn’t show the preview, but saving and printing still work.'), true); }
  }

  window.openPrint = what => {
    if (typeof what === 'string') opts.what = what;
    if (!dlg) { dlg = document.createElement('dialog'); dlg.className = 'pr-dlg'; document.body.appendChild(dlg); dlg.addEventListener('close', () => { reqId++; }); }
    src = null; lastInfo = '';
    if (opts.what && opts.what !== '__formulas' && opts.what !== '__pick' && !(source() || { topics: [] }).topics.some(t => t.id === opts.what)) opts.what = '';
    src = null; source();
    render();
    if (!dlg.open) dlg.showModal();
    preview();
  };
})();
