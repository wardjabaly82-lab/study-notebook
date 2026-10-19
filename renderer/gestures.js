/* Trackpad and touch gestures on the notes page.
   - Pinch on a graph or diagram: zoom into it (up to 5x), around the fingers. It keeps its place on
     the page; two-finger scroll moves around inside it, and at its edges the page scrolls on.
     Double-click (or the "100%" chip) puts it back.
   - Pinch anywhere else on the notes (desktop app): bigger or smaller text, like Ctrl + / Ctrl −.
   - Touch screens: two-finger pinch and drag on a graph or diagram do the same.
   A trackpad pinch reaches the page as a wheel event with Ctrl held, on Windows and Mac alike. */
(function () {
  'use strict';
  const MIN = 1, MAX = 5;
  const state = new WeakMap();   // figure → { s, x, y }
  const D = window.desktop || {};
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

  // Pinch on the rest of the page: text size, one step per pinch movement.
  let pinchAcc = 0, lastWheel = 0, lastStep = 0;
  function pageZoom(dy) {
    if (!D.textSize) return false;                         // the website leaves pinch to the browser
    const now = Date.now();
    if (now - lastWheel > 350) pinchAcc = 0;
    lastWheel = now; pinchAcc += dy;
    if (Math.abs(pinchAcc) >= 50 && now - lastStep > 250) { D.textSize(pinchAcc < 0 ? 1 : -1); pinchAcc = 0; lastStep = now; }
    return true;
  }

  document.addEventListener('wheel', e => {
    if (e.ctrlKey) {
      const f = !drawing() && figureAt(e.clientX, e.clientY);
      if (f) { e.preventDefault(); zoomAt(f, Math.min(1.25, Math.max(0.8, Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.01)))), e.clientX, e.clientY); return; }
      if (pageZoom(e.deltaY)) e.preventDefault();
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

  window.SNGestures = { zoomAt, reset };
})();
