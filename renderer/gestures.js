/* Trackpad and touch gestures on the notes page.
   - Pinch on a graph or diagram: zoom into it (up to 5x), around the fingers. It keeps its place on
     the page; two-finger scroll moves around inside it, and at its edges the page scrolls on.
     Double-click (or the "100%" chip) puts it back.
   - Pinch anywhere else on the notes: only the notes text gets bigger or smaller, around the mouse
     (the rest of the app keeps its size). Ctrl + / Ctrl − still size the whole app.
   - Touch screens: two-finger pinch and drag on a graph or diagram do the same.
   A trackpad pinch reaches the page as a wheel event with Ctrl held, on Windows and Mac alike. */
(function () {
  'use strict';
  const MIN = 1, MAX = 5;
  const state = new WeakMap();   // figure → { s, x, y }
  const drawing = () => !!(window.SNMarkup && SNMarkup.isDrawing && SNMarkup.isDrawing());

  function figureAt(x, y) {
    for (const el of document.elementsFromPoint(x, y)) {
      const f = el.closest && el.closest('figure.fig-plot, figure.fig-dia');
      if (f && f.querySelector('svg')) return f;
    }
    return null;
  }
  // Zooming makes the drawing really bigger (crisp, not a stretched picture) inside a box that keeps
  // the figure's place on the page; the box scrolls, so two-finger scrolling moves around in it.
  function get(f) { let st = state.get(f); if (!st) { st = { s: 1 }; state.set(f, st); } return st; }
  function scroller(f) {
    let box = f.querySelector(':scope > .fig-scroll');
    if (!box) {
      const svg = f.querySelector('svg'); if (!svg) return null;
      const st = get(f);
      st.w = svg.getBoundingClientRect().width; st.h = f.offsetHeight; st.maxW = svg.style.maxWidth;
      box = document.createElement('div'); box.className = 'fig-scroll';
      box.style.height = svg.getBoundingClientRect().height + 'px';
      svg.replaceWith(box); box.appendChild(svg);
      svg.style.maxWidth = 'none';
    }
    return box;
  }
  function paint(f, st) {
    const on = st.s > 1.001;
    f.classList.toggle('zoomed', on);
    let chip = f.querySelector(':scope > .zoom-chip');
    if (on && !chip) {
      chip = document.createElement('button'); chip.type = 'button'; chip.className = 'zoom-chip';
      chip.title = window.I18N ? I18N.t('Back to normal size') : 'Back to normal size';
      chip.addEventListener('click', e => { e.stopPropagation(); reset(f); });
      f.appendChild(chip);
    }
    if (chip) { if (on) chip.textContent = Math.round(st.s * 100) + '%'; else chip.remove(); }
  }
  function zoomAt(f, factor, cx, cy) {
    const st = get(f), box = scroller(f); if (!box) return;
    const svg = box.querySelector('svg');
    const s2 = Math.min(MAX, Math.max(MIN, st.s * factor));
    if (s2 <= 1.001) return reset(f);
    const r = box.getBoundingClientRect();
    const vx = cx - r.left, vy = cy - r.top;                     // the point under the fingers stays put
    // (an SVG has no offsetLeft/Top, so positions come from its box on screen)
    const at = () => { const a = svg.getBoundingClientRect(), b = box.getBoundingClientRect(); return { x: a.left - b.left + box.scrollLeft, y: a.top - b.top + box.scrollTop }; };
    const o = at();
    const px = (box.scrollLeft + vx - o.x) / st.s, py = (box.scrollTop + vy - o.y) / st.s;
    st.s = s2;
    svg.style.width = st.w * s2 + 'px';
    const n = at();
    box.scrollLeft = px * s2 + n.x - vx; box.scrollTop = py * s2 + n.y - vy;
    paint(f, st);
  }
  function reset(f) {
    const st = get(f), box = f.querySelector(':scope > .fig-scroll');
    if (box) { const svg = box.querySelector('svg'); svg.style.width = ''; svg.style.maxWidth = st.maxW || ''; box.replaceWith(svg); }
    st.s = 1; paint(f, st);
  }

  // Pinch on the notes: only the notes text gets bigger or smaller (not the sidebar, toolbar or
  // buttons), and the line under the mouse stays under the mouse. Remembered on this device.
  const ZKEY = 'sn-note-zoom', ZMIN = 0.75, ZMAX = 2.5;
  let noteZoom = 1;
  try { noteZoom = Math.min(ZMAX, Math.max(ZMIN, Number(localStorage.getItem(ZKEY)) || 1)); } catch (e) {}
  const applyZoom = () => document.documentElement.style.setProperty('--note-zoom', String(noteZoom));
  applyZoom();
  let badge = null, badgeTimer = 0, saveTimer = 0;
  function showBadge() {
    if (!badge) { badge = document.createElement('div'); badge.className = 'zoom-badge'; badge.setAttribute('role', 'status'); document.body.appendChild(badge); }
    badge.textContent = Math.round(noteZoom * 100) + '%';
    badge.classList.add('on'); clearTimeout(badgeTimer);
    badgeTimer = setTimeout(() => badge.classList.remove('on'), 900);
  }
  function notesZoomAt(factor, cx, cy) {
    const wrap = document.getElementById('sheetWrap');
    const z2 = Math.min(ZMAX, Math.max(ZMIN, noteZoom * factor));
    if (Math.abs(z2 - noteZoom) < 0.001) { showBadge(); return; }
    // the block under the mouse, and how far down it the mouse is
    const el = (document.elementsFromPoint(cx, cy).find(n => n.closest && n.closest('#sheet') && n.id !== 'sheet') || null);
    const r0 = el && el.getBoundingClientRect(), f = r0 && r0.height ? (cy - r0.top) / r0.height : 0;
    noteZoom = z2; applyZoom();
    if (el && wrap && el.isConnected) { const r1 = el.getBoundingClientRect(); wrap.scrollTop += (r1.top + f * r1.height) - cy; }
    showBadge();
    clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { localStorage.setItem(ZKEY, String(noteZoom)); } catch (e) {} }, 400);
  }
  function setNoteZoom(z) {
    noteZoom = Math.min(ZMAX, Math.max(ZMIN, Number(z) || 1)); applyZoom(); showBadge();
    try { localStorage.setItem(ZKEY, String(noteZoom)); } catch (e) {}
  }
  const overNotes = (x, y) => document.elementsFromPoint(x, y).some(n => n.id === 'sheet' || n.id === 'sheetWrap');

  document.addEventListener('wheel', e => {
    if (e.ctrlKey) {
      const f = !drawing() && figureAt(e.clientX, e.clientY);
      if (f) { e.preventDefault(); zoomAt(f, Math.min(1.25, Math.max(0.8, Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.01)))), e.clientX, e.clientY); return; }
      if (overNotes(e.clientX, e.clientY)) { e.preventDefault(); notesZoomAt(Math.min(1.12, Math.max(0.9, Math.exp(-e.deltaY * (e.deltaMode ? 0.03 : 0.006)))), e.clientX, e.clientY); }
      return;
    }
  }, { passive: false, capture: true });

  document.addEventListener('dblclick', e => {
    const f = e.target.closest && e.target.closest('figure.zoomed');
    if (f) { e.preventDefault(); reset(f); }
  });

  // Mac Safari-style gesture events (the website on an iPad or a Mac browser): stop the whole page zooming over a figure.
  document.addEventListener('gesturestart', e => { if (figureAt(e.clientX || 0, e.clientY || 0)) e.preventDefault(); });

  // Touch screens: two fingers on a figure pinch-zoom and drag it.
  const touches = new Map(); let pinch = null;
  document.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch' || drawing()) return;
    const f = figureAt(e.clientX, e.clientY); if (!f) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY, f });
    if (touches.size === 2) {
      const [a, b] = [...touches.values()];
      if (a.f === b.f) pinch = { f: a.f, d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    }
  });
  document.addEventListener('pointermove', e => {
    const t = touches.get(e.pointerId); if (!t) return;
    t.x = e.clientX; t.y = e.clientY;
    if (!pinch || touches.size !== 2) return;
    const [a, b] = [...touches.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    if (pinch.d > 10) zoomAt(pinch.f, d / pinch.d, mx, my);
    const box = pinch.f.querySelector(':scope > .fig-scroll');
    if (box) { box.scrollLeft -= mx - pinch.mx; box.scrollTop -= my - pinch.my; }
    pinch.d = d; pinch.mx = mx; pinch.my = my;
  });
  const lift = e => { touches.delete(e.pointerId); if (touches.size < 2) pinch = null; };
  document.addEventListener('pointerup', lift); document.addEventListener('pointercancel', lift);

  window.SNGestures = { zoomAt, reset, notesZoomAt, setNoteZoom, noteZoom: () => noteZoom };
})();
