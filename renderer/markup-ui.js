/* The student's highlighter and drawing tools on the notes page.

   - Select text in a note → a small bar with highlighter colors appears. Click a highlight to
     change its color or remove it.
   - "Draw" on a topic → a toolbar with pen, marker, line, arrow, box, circle and eraser, colors,
     sizes and undo. Drawings are pinned to the paragraph they're on (see marks.js).

   Highlights and drawings are saved with the topic (fields "marks" and "ink"), sync like the rest
   of the notes, print, and survive Claude updating the topic. */
(() => {
  'use strict';
  let api = null, bar = null, tools = null, drawing = null;   // drawing = { id, note, overlay, undo: [] }
  const opt = { tool: 'pen', color: 'blue', size: 2, mcolor: 'yellow' };
  try { Object.assign(opt, JSON.parse(localStorage.getItem('sn-draw') || '{}')); } catch (e) {}
  const remember = () => { try { localStorage.setItem('sn-draw', JSON.stringify(opt)); } catch (e) {} };
  const T = (k, v) => (api ? api.t(k, v) : k);
  const rid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const noteOf = n => { const el = n && (n.nodeType === 1 ? n : n.parentElement); return el ? el.closest('.note[data-note]') : null; };
  const noteFor = id => document.querySelector(`.note[data-note="${CSS.escape(id)}"]`);
  const HLNAME = { yellow: 'Yellow', green: 'Green', blue: 'Blue', pink: 'Pink', orange: 'Orange' };
  const INKNAME = { black: 'Black', blue: 'Blue', red: 'Red', green: 'Green', orange: 'Orange', purple: 'Purple', yellow: 'Yellow', pink: 'Pink' };

  /* ---------- showing a topic's highlights and drawings ---------- */
  function apply(note, s) {
    if (!note || !s || !window.SNMarks) return;
    SNMarks.clearHighlights(note);
    SNMarks.applyHighlights(note, s.marks);
    SNMarks.drawInk(note, s.ink);
    if (drawing && drawing.id === note.dataset.note) attachOverlay(note);
  }
  function refreshNote(id) { const n = noteFor(id), s = api && api.section(id); if (n && s) apply(n, s); }

  /* ---------- the highlighter bar ---------- */
  function hideBar() { if (bar) bar.hidden = true; }
  function place(el, rect) {
    el.hidden = false;
    const w = el.offsetWidth, h = el.offsetHeight;
    let top = rect.top - h - 8; if (top < 8) top = rect.bottom + 8;
    let left = rect.left + rect.width / 2 - w / 2; left = Math.max(8, Math.min(left, innerWidth - w - 8));
    el.style.top = top + 'px'; el.style.left = left + 'px';
  }
  function showBar(rect, note, range, hlId) {
    if (!bar) {
      bar = document.createElement('div'); bar.className = 'mark-bar'; bar.setAttribute('role', 'toolbar'); bar.hidden = true;
      document.body.appendChild(bar);
      bar.addEventListener('mousedown', e => e.preventDefault());   // keep the text selected
    }
    const s = api.section(note.dataset.note); if (!s) return;
    const over = range ? [...note.querySelectorAll('mark.uh')].filter(m => range.intersectsNode(m)).map(m => m.dataset.hl) : [];
    const ids = hlId ? [hlId] : [...new Set(over)];
    bar.innerHTML = SNMarks.HL.map(c => `<button type="button" class="mb-c uh-${c}" data-c="${c}" title="${esc(T(hlId ? 'Change to {color}' : 'Highlight {color}', { color: T(HLNAME[c]) }))}" aria-label="${esc(T(hlId ? 'Change to {color}' : 'Highlight {color}', { color: T(HLNAME[c]) }))}"></button>`).join('')
      + (ids.length ? `<span class="mb-sep"></span><button type="button" class="mb-x" data-remove>${esc(T('Remove highlight'))}</button>` : '');
    bar.querySelectorAll('[data-c]').forEach(b => b.onclick = () => {
      const c = b.dataset.c;
      if (hlId) save(note.dataset.note, { marks: (s.marks || []).map(m => (m.id === hlId ? { ...m, c } : m)) });
      else {
        const q = SNMarks.quoteFromRange(note, range); if (!q) return hideBar();
        save(note.dataset.note, { marks: (s.marks || []).filter(m => !ids.includes(m.id)).concat({ id: rid('h'), ...q, c }) });
        getSelection().removeAllRanges();
      }
      hideBar();
    });
    const x = bar.querySelector('[data-remove]');
    if (x) x.onclick = () => { save(note.dataset.note, { marks: (s.marks || []).filter(m => !ids.includes(m.id)) }); if (range) getSelection().removeAllRanges(); hideBar(); };
    place(bar, rect);
  }
  function onPointerUp(e) {
    if (drawing || (e && e.target && e.target.closest && e.target.closest('.mark-bar, .draw-bar, input, textarea, button, a, select'))) return;
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      const m = e && e.target && e.target.closest && e.target.closest('mark.uh');
      if (m && noteOf(m) && api.section(noteOf(m).dataset.note)) return showBar(m.getBoundingClientRect(), noteOf(m), null, m.dataset.hl);
      return hideBar();
    }
    const range = sel.getRangeAt(0), note = noteOf(range.startContainer);
    if (!note || note !== noteOf(range.endContainer) || note.closest('.edit')) return hideBar();
    const r = range.getBoundingClientRect(); if (!r.width && !r.height) return hideBar();
    showBar(r, note, range, null);
  }

  /* ---------- saving ---------- */
  function save(id, patch) { const s = api.save(id, patch); if (s) refreshNote(id); return s; }

  /* ---------- drawing ---------- */
  const TOOLS = [
    ['pen', 'Pen', '<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/>'],
    ['marker', 'Marker', '<path d="M9 15l-4 4h6l1-1"/><path d="M8 14l7-9 4 4-9 7z"/>'],
    ['line', 'Line', '<path d="M5 19L19 5"/>'],
    ['arrow', 'Arrow', '<path d="M5 19L19 5M10 5h9v9"/>'],
    ['rect', 'Box', '<rect x="4" y="6" width="16" height="12" rx="2"/>'],
    ['ellipse', 'Circle', '<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>'],
    ['eraser', 'Eraser', '<path d="M16 4l4 4-10 10H6l-2-2z"/><path d="M11 9l4 4M14 20h6"/>']
  ];
  const PEN_COLORS = ['black', 'blue', 'red', 'green', 'orange', 'purple'], MARK_COLORS = ['yellow', 'green', 'pink', 'blue', 'orange'];
  const icon = d => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  function drawTools() {
    if (!tools) { tools = document.createElement('div'); tools.className = 'draw-bar'; tools.setAttribute('role', 'toolbar'); document.body.appendChild(tools); }
    const colors = opt.tool === 'marker' ? MARK_COLORS : PEN_COLORS, cur = opt.tool === 'marker' ? opt.mcolor : opt.color;
    tools.setAttribute('aria-label', T('Drawing tools'));
    tools.innerHTML = `<div class="db-group">${TOOLS.map(([k, name, d]) => `<button type="button" data-tool="${k}" aria-pressed="${opt.tool === k}" title="${esc(T(name))}" aria-label="${esc(T(name))}">${icon(d)}</button>`).join('')}</div>
      <div class="db-group">${opt.tool === 'eraser' ? `<span class="db-hint">${esc(T('Drag over a drawing to erase it'))}</span>` : colors.map(c => `<button type="button" class="db-c s-${c}" data-color="${c}" aria-pressed="${cur === c}" title="${esc(T(INKNAME[c]))}" aria-label="${esc(T(INKNAME[c]))}"><i class="f-${c}"></i></button>`).join('')}</div>
      ${opt.tool === 'eraser' ? '' : `<div class="db-group">${[1, 2, 3].map(z => `<button type="button" data-size="${z}" aria-pressed="${opt.size === z}" title="${esc(T(['Thin', 'Medium', 'Thick'][z - 1]))}" aria-label="${esc(T(['Thin', 'Medium', 'Thick'][z - 1]))}"><i class="db-dot" style="width:${3 + z * 3}px;height:${3 + z * 3}px"></i></button>`).join('')}</div>`}
      <div class="db-group"><button type="button" data-undo title="${esc(T('Undo (Ctrl+Z)'))}" aria-label="${esc(T('Undo'))}">${icon('<path d="M9 7H4V2"/><path d="M4.5 7A8 8 0 1 1 6 17"/>')}</button>
      <button type="button" class="db-done" data-done>${esc(T('Done'))}</button></div>`;
    tools.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => { opt.tool = b.dataset.tool; remember(); drawTools(); });
    tools.querySelectorAll('[data-color]').forEach(b => b.onclick = () => { if (opt.tool === 'marker') opt.mcolor = b.dataset.color; else opt.color = b.dataset.color; remember(); drawTools(); });
    tools.querySelectorAll('[data-size]').forEach(b => b.onclick = () => { opt.size = +b.dataset.size; remember(); drawTools(); });
    tools.querySelector('[data-undo]').onclick = undo;
    tools.querySelector('[data-done]').onclick = stopDrawing;
    if (drawing && drawing.overlay) drawing.overlay.dataset.tool = opt.tool;
  }
  function attachOverlay(note) {
    if (!drawing) return;
    note.querySelectorAll(':scope > .ink-input').forEach(o => o.remove());
    const ov = document.createElement('div'); ov.className = 'ink-input'; ov.dataset.tool = opt.tool;
    ov.innerHTML = '<svg class="ink-preview" aria-hidden="true"></svg>';
    note.appendChild(ov); drawing.note = note; drawing.overlay = ov;
    ov.addEventListener('pointerdown', down);
    note.closest('.sec') && note.closest('.sec').classList.add('drawing');
  }
  function startDrawing(id) {
    stopDrawing();
    const note = noteFor(id); if (!note || !api.section(id)) return;
    hideBar(); getSelection().removeAllRanges();
    drawing = { id, note: null, overlay: null, undo: [] };
    attachOverlay(note); drawTools(); tools.hidden = false;
    if (api.onDrawingChange) api.onDrawingChange();
  }
  function stopDrawing() {
    if (!drawing) return;
    const { note } = drawing;
    if (note) { note.querySelectorAll(':scope > .ink-input').forEach(o => o.remove()); const sec = note.closest('.sec'); if (sec) sec.classList.remove('drawing'); }
    drawing = null; if (tools) tools.hidden = true;
    if (api && api.onDrawingChange) api.onDrawingChange();
  }
  const toggleDrawing = id => (drawing && drawing.id === id ? stopDrawing() : startDrawing(id));
  function refresh() { if (drawing && !document.body.contains(drawing.note)) { const n = noteFor(drawing.id); if (n) attachOverlay(n); else stopDrawing(); } }

  // Which paragraph a point on the screen belongs to, and the point in that paragraph's units.
  function blockAt(note, y) {
    const bl = SNMarks.blocks(note); let b = 0;
    bl.forEach((el, i) => { if (el.getBoundingClientRect().top <= y) b = i; });
    return { b, el: bl[b] };
  }
  const toUnits = (el, x, y) => { const r = el.getBoundingClientRect(), k = 1000 / Math.max(1, r.width); return [Math.round((x - r.left) * k * 10) / 10, Math.round((y - r.top) * k * 10) / 10]; };
  function simplify(pts, eps) { // Ramer-Douglas-Peucker, keeps strokes small
    if (pts.length < 3) return pts;
    const [a, b] = [pts[0], pts[pts.length - 1]]; let idx = -1, max = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const [x, y] = pts[i], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
      const d = Math.abs(dy * x - dx * y + b[0] * a[1] - b[1] * a[0]) / L;
      if (d > max) { max = d; idx = i; }
    }
    return max > eps ? simplify(pts.slice(0, idx + 1), eps).slice(0, -1).concat(simplify(pts.slice(idx), eps)) : [a, b];
  }
  let live = null;   // the stroke being drawn
  function down(e) {
    if (!drawing || e.button > 0) return;
    e.preventDefault();
    const ov = drawing.overlay; ov.setPointerCapture(e.pointerId);
    if (opt.tool === 'eraser') { live = { erase: true, hit: new Set() }; erase(e); }
    else {
      const { b, el } = blockAt(drawing.note, e.clientY);
      live = { b, el, pts: [[e.clientX, e.clientY]] };
    }
    ov.onpointermove = move; ov.onpointerup = ov.onpointercancel = up;
  }
  function move(e) {
    if (!live) return;
    if (live.erase) return erase(e);
    const last = live.pts[live.pts.length - 1];
    if (Math.hypot(e.clientX - last[0], e.clientY - last[1]) < 1.5) return;
    if (opt.tool === 'pen' || opt.tool === 'marker') live.pts.push([e.clientX, e.clientY]); else live.pts[1] = [e.clientX, e.clientY];
    preview();
  }
  function preview() {
    const svg = drawing.overlay.querySelector('.ink-preview'), r = svg.getBoundingClientRect();
    const k = 1000 / Math.max(1, r.width);
    svg.setAttribute('viewBox', `0 0 1000 ${Math.max(1, r.height * k)}`);
    const pts = live.pts.map(([x, y]) => [(x - r.left) * k, (y - r.top) * k]);
    svg.innerHTML = SNMarks.strokeSvg({ t: opt.tool, c: opt.tool === 'marker' ? opt.mcolor : opt.color, s: opt.size, p: pts });
  }
  function up() {
    const ov = drawing && drawing.overlay; if (!ov) return;
    ov.onpointermove = ov.onpointerup = ov.onpointercancel = null;
    const L = live; live = null;
    ov.querySelector('.ink-preview').innerHTML = '';
    if (!L) return;
    const s = api.section(drawing.id); if (!s) return;
    if (L.erase) {
      if (L.hit.size) { const removed = (s.ink || []).filter(st => L.hit.has(st.id)); drawing.undo.push({ add: removed }); save(drawing.id, { ink: (s.ink || []).filter(st => !L.hit.has(st.id)) }); }
      return;
    }
    let pts = L.pts.map(([x, y]) => toUnits(L.el, x, y));
    const shape = !(opt.tool === 'pen' || opt.tool === 'marker');
    if (shape) { if (pts.length < 2 || Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) < 6) return; pts = [pts[0], pts[1]]; }
    else pts = simplify(pts, 1.2);
    const st = { id: rid('k'), t: opt.tool, c: opt.tool === 'marker' ? opt.mcolor : opt.color, s: opt.size, b: L.b, p: pts };
    drawing.undo.push({ remove: st.id });
    save(drawing.id, { ink: (s.ink || []).concat(st) });
  }
  function erase(e) {
    const s = api.section(drawing.id); if (!s || !s.ink) return;
    const bl = SNMarks.blocks(drawing.note);
    for (const st of s.ink) {
      if (live.hit.has(st.id)) continue;
      const el = bl[Math.min(bl.length - 1, Math.max(0, st.b | 0))]; if (!el) continue;
      const r = el.getBoundingClientRect(), k = r.width / 1000;
      let pts = (st.p || []).map(([x, y]) => [r.left + x * k, r.top + y * k]);
      if (st.t === 'rect' || st.t === 'ellipse') { const [a, b] = [pts[0], pts[pts.length - 1]]; pts = [a, [b[0], a[1]], b, [a[0], b[1]], a]; }
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[i + 1] || a, dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
        const t = L2 ? Math.max(0, Math.min(1, ((e.clientX - a[0]) * dx + (e.clientY - a[1]) * dy) / L2)) : 0;
        if (Math.hypot(e.clientX - (a[0] + t * dx), e.clientY - (a[1] + t * dy)) < 10) { live.hit.add(st.id); const n = drawing.note.querySelector(`[data-ink="${st.id}"]`); if (n) n.style.opacity = '.15'; break; }
      }
    }
  }
  function undo() {
    if (!drawing) return;
    const s = api.section(drawing.id); if (!s) return;
    const step = drawing.undo.pop();
    if (step && step.remove) save(drawing.id, { ink: (s.ink || []).filter(st => st.id !== step.remove) });
    else if (step && step.add) save(drawing.id, { ink: (s.ink || []).concat(step.add) });
    else if (s.ink && s.ink.length) save(drawing.id, { ink: s.ink.slice(0, -1) });   // strokes from before this session
  }

  /* ---------- start ---------- */
  function init(a) {
    api = a;
    document.addEventListener('mouseup', e => setTimeout(() => onPointerUp(e), 0));
    document.addEventListener('keyup', e => { if (e.key === 'Shift' || e.shiftKey) setTimeout(() => onPointerUp(null), 0); });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { if (bar && !bar.hidden) hideBar(); else if (drawing) { stopDrawing(); e.preventDefault(); } }
      if (drawing && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.target.closest('input, textarea')) { e.preventDefault(); undo(); }
    });
    const sw = document.getElementById('sheetWrap'); if (sw) sw.addEventListener('scroll', hideBar, { passive: true });
  }

  window.SNMarkup = { init, apply, toggleDrawing, startDrawing, stopDrawing, refresh, drawingId: () => (drawing ? drawing.id : null) };
})();
