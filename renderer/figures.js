/* Graphs and diagrams inside notes. Used by the notes page (desktop app and website) and the printout.

   ```plot     A small JSON description that this file draws as SVG: functions, curves through points,
               points, lines, arrows, shaded areas, text, and bar / line charts. Formulas such as
               "10 - 2x" or "normpdf(x, 0, 1)" are read by a tiny parser here; nothing is ever evaluated.
   ```mermaid  Flowcharts, cycles, trees, timelines, pie charts... drawn by Mermaid, which is loaded
               only when a note has one.

   Colors are CSS classes (s-blue, f-blue...) so graphs follow light and dark mode and the printout. */
(() => {
  'use strict';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COLORS = ['blue', 'red', 'green', 'orange', 'purple', 'teal', 'pink', 'brown', 'gray', 'black', 'yellow'];
  const colorOf = (c, i) => { c = String(c || '').toLowerCase().replace('grey', 'gray'); return COLORS.includes(c) ? c : COLORS[(i || 0) % 6]; };

  /* ---------------- safe formulas ---------------- */
  const erf = x => { // Abramowitz & Stegun 7.1.26
    const s = Math.sign(x); x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x);
    return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
  };
  const FUNCS = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
    exp: Math.exp, ln: Math.log, log: Math.log10, log10: Math.log10, log2: Math.log2, sqrt: Math.sqrt, abs: Math.abs,
    floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign, min: Math.min, max: Math.max, pow: Math.pow,
    normpdf: (x, m = 0, s = 1) => Math.exp(-((x - m) ** 2) / (2 * s * s)) / (s * Math.sqrt(2 * Math.PI)),
    normcdf: (x, m = 0, s = 1) => 0.5 * (1 + erf((x - m) / (s * Math.SQRT2))),
    exppdf: (x, l = 1) => (x < 0 ? 0 : l * Math.exp(-l * x)),
    unifpdf: (x, a = 0, b = 1) => (x >= a && x <= b ? 1 / (b - a) : 0)
  };
  const CONSTS = { pi: Math.PI, e: Math.E };
  function compile(src) {
    const s = String(src).replace(/−/g, '-').replace(/[·×]/g, '*').replace(/÷/g, '/');
    const toks = []; let i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (/\s/.test(ch)) { i++; continue; }
      const num = s.slice(i).match(/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i);
      if (num) { toks.push({ k: 'n', v: parseFloat(num[0]) }); i += num[0].length; continue; }
      const id = s.slice(i).match(/^[a-zA-Z_][a-zA-Z_0-9]*/);
      if (id) { toks.push({ k: 'i', v: id[0] }); i += id[0].length; continue; }
      if ('+-*/^(),'.includes(ch)) { toks.push({ k: ch }); i++; continue; }
      throw new Error(`can't read "${ch}" in "${src}"`);
    }
    let p = 0;
    const peek = () => toks[p], take = k => (toks[p] && toks[p].k === k ? toks[p++] : null);
    const startsPrimary = t => t && (t.k === 'n' || t.k === 'i' || t.k === '(');
    function expr() { let a = term(); for (;;) { if (take('+')) { const l = a, r = term(); a = x => l(x) + r(x); } else if (take('-')) { const l = a, r = term(); a = x => l(x) - r(x); } else return a; } }
    function term() {
      let a = unary();
      for (;;) {
        if (take('*')) { const l = a, r = unary(); a = x => l(x) * r(x); }
        else if (take('/')) { const l = a, r = unary(); a = x => l(x) / r(x); }
        else if (startsPrimary(peek())) { const l = a, r = unary(); a = x => l(x) * r(x); }   // 2x, 3(x+1)
        else return a;
      }
    }
    function unary() { if (take('-')) { const a = unary(); return x => -a(x); } if (take('+')) return unary(); return power(); }
    function power() { const b = primary(); if (take('^')) { const e = unary(); return x => Math.pow(b(x), e(x)); } return b; }
    function primary() {
      const t = toks[p++];
      if (!t) throw new Error(`"${src}" ends too early`);
      if (t.k === 'n') return () => t.v;
      if (t.k === '(') { const a = expr(); if (!take(')')) throw new Error(`missing ")" in "${src}"`); return a; }
      if (t.k === 'i') {
        const name = t.v.toLowerCase();
        if (FUNCS[name] && peek() && peek().k === '(') {
          p++; const args = [];
          if (!take(')')) { do args.push(expr()); while (take(',')); if (!take(')')) throw new Error(`missing ")" in "${src}"`); }
          const f = FUNCS[name]; return x => f(...args.map(a => a(x)));
        }
        if (name === 'x' || name === 'q' || name === 't') return x => x;
        if (name in CONSTS) return () => CONSTS[name];
        throw new Error(`unknown name "${t.v}" in "${src}" (use x as the variable)`);
      }
      throw new Error(`unexpected "${t.k}" in "${src}"`);
    }
    const f = expr();
    if (p < toks.length) throw new Error(`can't read "${src}"`);
    return x => { const y = f(x); return Number.isFinite(y) ? y : NaN; };
  }
  const fnOf = v => (typeof v === 'number' ? () => v : compile(v));

  /* ---------------- helpers ---------------- */
  function niceStep(span, n) {
    const raw = span / Math.max(1, n), mag = Math.pow(10, Math.floor(Math.log10(raw))), r = raw / mag;
    return (r >= 5 ? 10 : r >= 2 ? 5 : r >= 1 ? 2 : 1) * mag;
  }
  const fmt = v => { const r = Math.round(v * 1e6) / 1e6; return String(Math.abs(r) < 1e-9 ? 0 : r); };
  // "Q_1", "P^*", "x_{t-1}": small sub- and superscripts inside SVG text.
  function rich(text) {
    const s = String(text ?? ''); let out = '', i = 0;
    while (i < s.length) {
      const ch = s[i];
      if ((ch === '_' || ch === '^') && i + 1 < s.length) {
        let part; if (s[i + 1] === '{') { const j = s.indexOf('}', i + 2); part = s.slice(i + 2, j < 0 ? s.length : j); i = j < 0 ? s.length : j + 1; } else { part = s[i + 1]; i += 2; }
        out += `<tspan dy="${ch === '_' ? 4 : -6}" font-size="75%">${esc(part)}</tspan><tspan dy="${ch === '_' ? -4 : 6}">​</tspan>`;
      } else { out += esc(ch); i++; }
    }
    return out;
  }
  const lenient = src => String(src).replace(/,\s*([\]}])/g, '$1');

  /* ---------------- plots ---------------- */
  function plotSvg(spec) {
    if (!spec || typeof spec !== 'object') throw new Error('the graph description must be a JSON object');
    const kind = String(spec.type || 'graph').toLowerCase();
    if (kind === 'bar' || kind === 'line' || kind === 'chart') return chartSvg(spec, kind === 'chart' ? 'bar' : kind);
    const items = Array.isArray(spec.items) ? spec.items : [];
    if (!items.length) throw new Error('add "items" to draw (functions, points, lines...)');
    const W = 640, H = Math.min(600, Math.max(220, Number(spec.height) || 380));
    const X = spec.x || {}, Y = spec.y || {};
    const M = { l: 52, r: 30, t: spec.title ? 34 : 16, b: 44 };

    // The x range: given, or from the points, or 0..10.
    const xs = [], ys = [];
    const pts = it => [it.at, it.from, it.to, ...(Array.isArray(it.points) ? it.points : [])].filter(a => Array.isArray(a) && a.length >= 2);
    for (const it of items) for (const q of pts(it)) { xs.push(+q[0]); ys.push(+q[1]); }
    for (const it of items) { if (it.type === 'vline') xs.push(+it.x); if (it.type === 'hline') ys.push(+it.y); }
    let x0 = Number.isFinite(+X.min) && X.min !== undefined ? +X.min : (xs.length ? Math.min(0, ...xs) : 0);
    let x1 = Number.isFinite(+X.max) && X.max !== undefined ? +X.max : (xs.length ? Math.max(...xs) * 1.1 || 10 : 10);
    if (!(x1 > x0)) x1 = x0 + 10;
    // Compile and sample the functions once.
    const curves = items.map((it, i) => {
      const fn = it.fn ?? it.function ?? it.f;
      if ((it.type === 'function' || (!it.type && fn !== undefined)) && fn !== undefined) {
        const f = fnOf(fn), a = it.from ?? x0, b = it.to ?? x1, n = 260, out = [];
        for (let k = 0; k <= n; k++) { const x = a + (b - a) * k / n; out.push([x, f(x)]); }
        for (const [, y] of out) if (Number.isFinite(y)) ys.push(y);
        return out;
      }
      return null;
    });
    let y0, y1;
    if (Y.min !== undefined && Number.isFinite(+Y.min)) y0 = +Y.min;
    if (Y.max !== undefined && Number.isFinite(+Y.max)) y1 = +Y.max;
    if (y0 === undefined || y1 === undefined) {
      const fin = ys.filter(Number.isFinite); let lo = fin.length ? Math.min(...fin) : 0, hi = fin.length ? Math.max(...fin) : 10;
      if (lo >= 0 && lo < hi * 0.5) lo = 0;                 // start at 0 for prices, quantities, probabilities
      if (hi === lo) { hi = lo + 1; }
      const pad = (hi - lo) * 0.08;
      if (y0 === undefined) y0 = lo === 0 ? 0 : lo - pad;
      if (y1 === undefined) y1 = hi + pad;
    }
    if (!(y1 > y0)) y1 = y0 + 1;
    const px = x => M.l + (x - x0) / (x1 - x0) * (W - M.l - M.r);
    const py = y => H - M.b - (y - y0) / (y1 - y0) * (H - M.t - M.b);
    const clip = 'pc' + Math.random().toString(36).slice(2, 8);
    let g = '', fg = '', labels = '';

    // grid and ticks
    const showGrid = spec.grid !== false;
    const ticks = (lo, hi, opt) => { if (opt.ticks === false) return []; const st = niceStep(hi - lo, Number(opt.ticks) || 6); const out = []; for (let v = Math.ceil(lo / st) * st; v <= hi + st * 1e-6; v += st) out.push(+v.toFixed(10)); return out; };
    const tx = ticks(x0, x1, X), ty = ticks(y0, y1, Y);
    // A number right where a value has a name (e.g. Q* at 6) would be drawn over it: leave it out.
    const namedAt = (opt, toPx) => Object.keys((opt.names || opt.marks) || {}).map(Number).filter(Number.isFinite).map(toPx);
    const nx = namedAt(X, px), ny = namedAt(Y, py), near = (list, p, d) => list.some(q => Math.abs(q - p) < d);
    for (const v of tx) { if (showGrid) g += `<line class="pf-grid" x1="${px(v)}" y1="${M.t}" x2="${px(v)}" y2="${H - M.b}"/>`; if (!near(nx, px(v), 22)) labels += `<text class="pf-tick" x="${px(v)}" y="${H - M.b + 16}" text-anchor="middle">${fmt(v)}</text>`; }
    for (const v of ty) { if (showGrid) g += `<line class="pf-grid" x1="${M.l}" y1="${py(v)}" x2="${W - M.r}" y2="${py(v)}"/>`; if (!near(ny, py(v), 12)) labels += `<text class="pf-tick" x="${M.l - 7}" y="${py(v) + 4}" text-anchor="end">${fmt(v)}</text>`; }
    const named = (opt, axis) => { const m = opt.names || opt.marks; if (!m || typeof m !== 'object') return ''; let s = ''; for (const [k, lab] of Object.entries(m)) { const v = +k; if (!Number.isFinite(v)) continue; s += axis === 'x' ? `<text class="pf-name" x="${px(v)}" y="${H - M.b + 17}" text-anchor="middle">${rich(lab)}</text>` : `<text class="pf-name" x="${M.l - 7}" y="${py(v) + 4}" text-anchor="end">${rich(lab)}</text>`; } return s; };
    labels += named(X, 'x') + named(Y, 'y');

    // axes (at the bottom and left, with arrow tips, as in economics and probability drawings)
    fg += `<line class="pf-axis" x1="${M.l}" y1="${H - M.b}" x2="${W - M.r + 10}" y2="${H - M.b}" marker-end="url(#${clip}-ax)"/>`;
    fg += `<line class="pf-axis" x1="${M.l}" y1="${H - M.b}" x2="${M.l}" y2="${M.t - 8}" marker-end="url(#${clip}-ax)"/>`;
    if (X.label) labels += `<text class="pf-label" x="${W - M.r + 8}" y="${H - M.b + 32}" text-anchor="end">${rich(X.label)}</text>`;
    if (Y.label) labels += `<text class="pf-label" x="${M.l + 8}" y="${M.t - 2}" text-anchor="start">${rich(Y.label)}</text>`;

    const dash = it => (it.dash || it.dashed ? ' stroke-dasharray="7 5"' : '');
    const sw = it => Math.min(6, Math.max(1, Number(it.width) || 2.4));
    const path = arr => { let d = '', pen = false; for (const [x, y] of arr) { if (!Number.isFinite(y) || Math.abs(py(y)) > 1e5) { pen = false; continue; } d += (pen ? 'L' : 'M') + px(x).toFixed(1) + ' ' + py(y).toFixed(1); pen = true; } return d; };
    const arrowDefs = new Set();
    const arrowHead = c => { arrowDefs.add(c); return `url(#${clip}-a-${c})`; };
    let areas = '', lines = '', marks = '';
    const endLabel = (arr, lab, c) => {
      for (let k = arr.length - 1; k >= 0; k--) {
        const [x, y] = arr[k];
        if (Number.isFinite(y) && y >= y0 && y <= y1 && x >= x0 && x <= x1) {
          const X0 = px(x), Y0 = py(y), right = X0 > W - M.r - 40;
          return `<text class="pf-series f-${c}" x="${X0 + (right ? -6 : 6)}" y="${Y0 - 6}" text-anchor="${right ? 'end' : 'start'}">${rich(lab)}</text>`;
        }
      }
      return '';
    };
    items.forEach((it, i) => {
      const type = String(it.type || (it.fn !== undefined || it.function !== undefined ? 'function' : it.points ? 'curve' : it.at ? 'point' : '')).toLowerCase();
      // Curves and areas take the next color; points, guides and arrows are black unless a color is given.
      const c = it.color ? colorOf(it.color, i) : /^(point|points|line|arrow|segment|vline|hline|text|label)$/.test(type) ? 'black' : colorOf('', i);
      if (type === 'function') {
        const arr = curves[i]; lines += `<path class="s-${c}" d="${path(arr)}" fill="none" stroke-width="${sw(it)}"${dash(it)} clip-path="url(#${clip})"/>`;
        if (it.label) labels += endLabel(arr, it.label, c);
      } else if (type === 'curve' || type === 'polyline') {
        const arr = (it.points || []).map(q => [+q[0], +q[1]]);
        let d = path(arr);
        if (it.smooth && arr.length > 2) { // Catmull-Rom through the points
          const P = arr.map(([x, y]) => [px(x), py(y)]); d = `M${P[0][0]} ${P[0][1]}`;
          for (let k = 0; k < P.length - 1; k++) { const p0 = P[k - 1] || P[k], p1 = P[k], p2 = P[k + 1], p3 = P[k + 2] || p2; d += `C${p1[0] + (p2[0] - p0[0]) / 6} ${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6} ${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]} ${p2[1]}`; }
        }
        lines += `<path class="s-${c}" d="${d}" fill="none" stroke-width="${sw(it)}"${dash(it)} clip-path="url(#${clip})"/>`;
        if (it.label) labels += endLabel(arr, it.label, c);
      } else if (type === 'line' || type === 'arrow' || type === 'segment') {
        if (!Array.isArray(it.from) || !Array.isArray(it.to)) throw new Error(`a ${type} needs "from": [x, y] and "to": [x, y]`);
        const [a, b] = [it.from, it.to];
        lines += `<line class="s-${c}" x1="${px(+a[0])}" y1="${py(+a[1])}" x2="${px(+b[0])}" y2="${py(+b[1])}" stroke-width="${type === 'arrow' ? Math.min(sw(it), 2.2) : sw(it)}"${dash(it)}${type === 'arrow' ? ` marker-end="${arrowHead(c)}"` : ''}/>`;
        if (it.label) labels += `<text class="pf-series f-${c}" x="${(px(+a[0]) + px(+b[0])) / 2 + 6}" y="${(py(+a[1]) + py(+b[1])) / 2 - 6}">${rich(it.label)}</text>`;
      } else if (type === 'vline' || type === 'hline') {
        const v = type === 'vline' ? +it.x : +it.y;
        if (!Number.isFinite(v)) throw new Error(`a ${type} needs "${type === 'vline' ? 'x' : 'y'}"`);
        lines += type === 'vline' ? `<line class="s-${c}" x1="${px(v)}" y1="${M.t}" x2="${px(v)}" y2="${H - M.b}" stroke-width="1.6"${it.dash === false ? '' : ' stroke-dasharray="6 5"'}/>`
          : `<line class="s-${c}" x1="${M.l}" y1="${py(v)}" x2="${W - M.r}" y2="${py(v)}" stroke-width="1.6"${it.dash === false ? '' : ' stroke-dasharray="6 5"'}/>`;
        if (it.label) labels += type === 'vline' ? `<text class="pf-series f-${c}" x="${px(v) + 5}" y="${M.t + 12}">${rich(it.label)}</text>` : `<text class="pf-series f-${c}" x="${W - M.r - 4}" y="${py(v) - 6}" text-anchor="end">${rich(it.label)}</text>`;
      } else if (type === 'point' || type === 'points') {
        const list = type === 'points' ? (it.points || it.data || []) : [it.at];
        for (const q of list) {
          if (!Array.isArray(q)) throw new Error('a point needs "at": [x, y]');
          const X0 = px(+q[0]), Y0 = py(+q[1]);
          if (it.guides || it.dashed_to_axes) marks += `<path class="s-${c} pf-guide" d="M${X0} ${Y0}V${H - M.b}M${X0} ${Y0}H${M.l}" fill="none" stroke-width="1.3" stroke-dasharray="4 4"/>`;
          marks += `<circle class="${it.hollow ? 'f-page' : 'f-' + c} s-${c}" cx="${X0}" cy="${Y0}" r="${type === 'points' ? 3.6 : 4.6}" stroke-width="1.8"/>`;
          if (type === 'point' && it.label) labels += `<text class="pf-series f-${c}" x="${X0 + 8}" y="${Y0 - 8}">${rich(it.label)}</text>`;
        }
        if (type === 'points' && it.label && list.length) labels += endLabel(list.map(q => [+q[0], +q[1]]), it.label, c);
      } else if (type === 'area' || type === 'shade') {
        let poly = [];
        const a = +(it.from ?? x0), b = +(it.to ?? x1), n = 160;
        if (Array.isArray(it.points)) poly = it.points.map(q => [+q[0], +q[1]]);
        else {
          const top = fnOf(it.fn ?? (Array.isArray(it.between) ? it.between[0] : undefined) ?? 0);
          const bot = fnOf(Array.isArray(it.between) ? it.between[1] : (it.base ?? 0));
          for (let k = 0; k <= n; k++) { const x = a + (b - a) * k / n; poly.push([x, top(x)]); }
          for (let k = n; k >= 0; k--) { const x = a + (b - a) * k / n; poly.push([x, bot(x)]); }
        }
        poly = poly.filter(([, y]) => Number.isFinite(y));
        if (poly.length > 2) {
          areas += `<path class="f-${c} pf-area" d="M${poly.map(([x, y]) => px(x).toFixed(1) + ' ' + py(Math.min(y1, Math.max(y0, y))).toFixed(1)).join('L')}Z" clip-path="url(#${clip})"/>`;
          if (it.label) { const cx = poly.reduce((s, q) => s + q[0], 0) / poly.length, cy = poly.reduce((s, q) => s + Math.min(y1, Math.max(y0, q[1])), 0) / poly.length; labels += `<text class="pf-series pf-area-label f-${c}" x="${px(cx)}" y="${py(cy) + 4}" text-anchor="middle">${rich(it.label)}</text>`; }
        }
      } else if (type === 'text' || type === 'label') {
        if (!Array.isArray(it.at)) throw new Error('a text needs "at": [x, y]');
        labels += `<text class="pf-series f-${it.color ? c : 'ink'}" x="${px(+it.at[0])}" y="${py(+it.at[1])}" text-anchor="${['start', 'middle', 'end'].includes(it.anchor) ? it.anchor : 'middle'}">${rich(it.text ?? it.label ?? '')}</text>`;
      } else throw new Error(`unknown item type "${it.type}" (use function, curve, line, arrow, point, points, area, vline, hline or text)`);
    });
    const defs = `<defs><clipPath id="${clip}"><rect x="${M.l}" y="${M.t - 4}" width="${W - M.l - M.r + 4}" height="${H - M.t - M.b + 4}"/></clipPath>
      <marker id="${clip}-ax" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="pf-axis-tip" d="M0 0L10 5L0 10z"/></marker>
      ${[...arrowDefs].map(c => `<marker id="${clip}-a-${c}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="f-${c}" d="M0 0L10 5L0 10z"/></marker>`).join('')}</defs>`;
    const title = spec.title ? `<text class="pf-title" x="${W / 2}" y="20" text-anchor="middle">${rich(spec.title)}</text>` : '';
    return `<svg class="plot" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(spec.title || 'Graph')}">${defs}${title}${g}${areas}${fg}${lines}${marks}${labels}</svg>`;
  }

  function chartSvg(spec, kind) {
    const cats = (spec.labels || spec.categories || []).map(String);
    const series = (Array.isArray(spec.series) ? spec.series : spec.values ? [{ name: spec.name || '', values: spec.values }] : []).map((s, i) => ({ name: String(s.name || ''), values: (s.values || s.data || []).map(Number), c: colorOf(s.color, i) }));
    if (!cats.length || !series.length) throw new Error(`a ${kind} chart needs "labels" and "series": [{ "name", "values" }]`);
    const W = 640, H = Math.min(600, Math.max(220, Number(spec.height) || 360));
    const legend = series.length > 1 || series[0].name;
    const M = { l: 56, r: 20, t: (spec.title ? 34 : 14) + (legend ? 22 : 0), b: 48 };
    const vals = series.flatMap(s => s.values).filter(Number.isFinite);
    const Y = spec.y || {};
    let lo = Y.min !== undefined ? +Y.min : Math.min(0, ...vals), hi = Y.max !== undefined ? +Y.max : Math.max(...vals, 0);
    if (!(hi > lo)) hi = lo + 1;
    const st = niceStep(hi - lo, 5); if (Y.max === undefined) hi = Math.ceil(hi / st) * st; if (Y.min === undefined && lo < 0) lo = Math.floor(lo / st) * st;
    const py = v => H - M.b - (v - lo) / (hi - lo) * (H - M.t - M.b);
    const band = (W - M.l - M.r) / cats.length;
    let s = '';
    for (let v = lo; v <= hi + st * 1e-6; v += st) s += `<line class="pf-grid" x1="${M.l}" y1="${py(v)}" x2="${W - M.r}" y2="${py(v)}"/><text class="pf-tick" x="${M.l - 7}" y="${py(v) + 4}" text-anchor="end">${fmt(v)}</text>`;
    s += `<line class="pf-axis" x1="${M.l}" y1="${py(Math.max(lo, 0))}" x2="${W - M.r}" y2="${py(Math.max(lo, 0))}"/>`;
    cats.forEach((c, i) => { s += `<text class="pf-tick" x="${M.l + band * (i + 0.5)}" y="${H - M.b + 17}" text-anchor="middle">${rich(c)}</text>`; });
    if (kind === 'bar') {
      const gw = band * 0.72, bw = gw / series.length;
      series.forEach((se, k) => se.values.forEach((v, i) => {
        if (!Number.isFinite(v) || i >= cats.length) return;
        const x = M.l + band * i + (band - gw) / 2 + bw * k, y = py(Math.max(v, 0)), h = Math.abs(py(v) - py(0));
        s += `<rect class="f-${se.c}" x="${x + 1}" y="${y}" width="${Math.max(1, bw - 2)}" height="${Math.max(0.5, h)}" rx="2"/>`;
        if (spec.show_values || spec.values_on_bars) s += `<text class="pf-tick" x="${x + bw / 2}" y="${y - 5}" text-anchor="middle">${fmt(v)}</text>`;
      }));
    } else {
      series.forEach(se => {
        const P = se.values.map((v, i) => [M.l + band * (i + 0.5), Number.isFinite(v) ? py(v) : null]).slice(0, cats.length);
        s += `<path class="s-${se.c}" fill="none" stroke-width="2.6" d="${P.filter(q => q[1] !== null).map((q, i) => (i ? 'L' : 'M') + q[0] + ' ' + q[1]).join('')}"/>`;
        P.forEach(q => { if (q[1] !== null) s += `<circle class="f-${se.c}" cx="${q[0]}" cy="${q[1]}" r="3.6"/>`; });
      });
    }
    if (spec.x && spec.x.label) s += `<text class="pf-label" x="${W - M.r}" y="${H - 8}" text-anchor="end">${rich(spec.x.label)}</text>`;
    if (Y.label) s += `<text class="pf-label" x="${M.l - 4}" y="${M.t - 10}" text-anchor="start">${rich(Y.label)}</text>`;
    if (legend) { // top right, clear of the axis label on the left
      const y = (spec.title ? 34 : 14) + 6, widths = series.map(se => 34 + se.name.length * 7.5);
      let x = W - M.r - widths.reduce((a, b) => a + b, 0) + 14;
      series.forEach((se, k) => { s += `<rect class="f-${se.c}" x="${x}" y="${y - 9}" width="12" height="12" rx="2"/><text class="pf-tick" x="${x + 17}" y="${y + 1}">${rich(se.name)}</text>`; x += widths[k]; });
    }
    const title = spec.title ? `<text class="pf-title" x="${W / 2}" y="20" text-anchor="middle">${rich(spec.title)}</text>` : '';
    return `<svg class="plot" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(spec.title || 'Chart')}">${title}${s}</svg>`;
  }

  function errorFigure(what, msg, src) {
    const f = document.createElement('figure');
    f.className = 'fig fig-error tex2jax_ignore';
    f.innerHTML = `<p>${esc(what)}: ${esc(msg)}</p><details><summary>Source</summary><pre dir="ltr">${esc(src)}</pre></details>`;
    return f;
  }
  function plotFigure(src) {
    try {
      const spec = JSON.parse(lenient(src));
      const f = document.createElement('figure');
      f.className = 'fig fig-plot tex2jax_ignore';
      f.dir = 'ltr';
      f.innerHTML = plotSvg(spec) + (spec.caption ? `<figcaption dir="auto">${esc(spec.caption)}</figcaption>` : '');
      return f;
    } catch (e) { return errorFigure('This graph couldn’t be drawn', e.message.replace(/^JSON\.parse: /, ''), src); }
  }

  /* ---------------- Mermaid diagrams ---------------- */
  /* Diagram labels can't show typeset formulas, so math written in them (LaTeX like \beta_1, \( E(u \mid x) = 0 \),
     or spelled out like beta1, sigma^2) becomes plain symbols: β₁, E(u | x) = 0, σ². */
  const GREEK = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω' };
  const SYM = { mid: '|', vert: '|', cdot: '·', times: '×', div: '÷', pm: '±', le: '≤', leq: '≤', ge: '≥', geq: '≥', neq: '≠', ne: '≠', approx: '≈', sim: '~', equiv: '≡', infty: '∞', sum: 'Σ', prod: 'Π', int: '∫', partial: '∂', to: '→', rightarrow: '→', Rightarrow: '⇒', leftarrow: '←', Leftrightarrow: '⇔', implies: '⇒', iff: '⇔', in: '∈', notin: '∉', subset: '⊂', cup: '∪', cap: '∩', forall: '∀', exists: '∃', neg: '¬', land: '∧', lor: '∨', ldots: '…', cdots: '⋯', dots: '…', perp: '⊥', circ: '∘', nabla: '∇', emptyset: '∅', varnothing: '∅' };
  const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎', a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ', s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ' };
  const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', d: 'ᵈ', e: 'ᵉ', i: 'ⁱ', j: 'ʲ', k: 'ᵏ', n: 'ⁿ', t: 'ᵗ', T: 'ᵀ', x: 'ˣ', y: 'ʸ', '*': '*', '′': '′' };
  const script = (txt, map, mark) => [...txt].every(c => map[c]) ? [...txt].map(c => map[c]).join('') : mark + (txt.length > 1 ? '(' + txt + ')' : txt);
  function mathText(t) {
    let s = String(t);
    s = s.replace(/\\[()[\]]|\$\$?/g, ' ');
    s = s.replace(/\\(?:text|mathrm|mathit|mathbf|operatorname|textbf|mathbb|mathcal)\s*\{([^{}]*)\}/g, '$1');
    s = s.replace(/\\(hat|widehat|bar|overline|tilde|widetilde|dot|vec)\s*\{([^{}]*)\}|\\(hat|bar|tilde|dot|vec)\s*(\\[A-Za-z]+|[A-Za-z])/g, (m, k1, a1, k2, a2) => {
      const k = k1 || k2, a = a1 || a2; const mark = { hat: '̂', widehat: '̂', bar: '̄', overline: '̄', tilde: '̃', widetilde: '̃', dot: '̇', vec: '⃗' }[k];
      return '{' + a + '}' + mark; });
    s = s.replace(/\\([A-Za-z]+) ?/g, (m, w) => GREEK[w] || (SYM[w] ? SYM[w] + (m.endsWith(' ') ? ' ' : '') : '') || (/^(frac|dfrac|tfrac|sqrt)$/.test(w) ? '\\' + w : /^(left|right|big|Big|bigg|Bigg|displaystyle|limits|quad|qquad)$/.test(w) ? '' : w));
    const wrap = a => (a = a.trim(), [...a].length > 1 ? '(' + a + ')' : a);
    s = s.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (_, a, b) => wrap(a) + '/' + wrap(b));
    s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, (_, a) => '√' + wrap(a));
    s = s.replace(/\\[,;:! ]/g, ' ');
    // spelled-out Greek: beta0, beta_1, sigma^2, "beta" on its own
    s = s.replace(/\b(alpha|beta|gamma|delta|epsilon|theta|lambda|sigma|rho|mu)(?=[\d_^]|\b)/g, (m, w) => GREEK[w]);
    s = s.replace(/([α-ωΑ-Ω̂̄])(\d+)/g, (_, g, d) => g + script(d, SUB, '_'));
    // {x}^ accent groups from above, then sub- and superscripts
    s = s.replace(/\{([^{}]+)\}([̂̄̃̇⃗])/g, (_, a, mark) => a.length === 1 ? a + mark : a + mark);
    s = s.replace(/_\{([^{}]*)\}|_(\\?[A-Za-z0-9+\-α-ω])/g, (_, a, b) => script(a !== undefined ? a : b, SUB, '_'));
    s = s.replace(/\^\{([^{}]*)\}|\^([A-Za-z0-9+\-*′α-ω])/g, (_, a, b) => script(a !== undefined ? a : b, SUP, '^'));
    s = s.replace(/[{}]/g, '').replace(/\s{2,}/g, ' ').trim();
    return s;
  }
  // Only the label text of a diagram is changed (quoted labels, [box], (round), {diamond} and |edge| labels).
  function mermaidMath(src) {
    if (!/[\\_^$]|\b(alpha|beta|gamma|delta|epsilon|theta|lambda|sigma|rho|mu)\d/.test(src)) return src;
    return src.split('\n').map(line => /^\s*(%%|classDef|style|linkStyle|class\s)/.test(line) ? line
      : line.replace(/"([^"\n]*)"/g, (m, a) => '"' + mathText(a).replace(/"/g, "'") + '"')
            .replace(/(\w)(\[\[|\[\(|\(\[|\[|\(\(|\(|\{\{|\{)([^"\]\)\}\n][^\]\)\}\n]*?)(\]\]|\)\]|\]\)|\]|\)\)|\)|\}\}|\})(?=\s|$|-|:|;|&)/g, (m, id, o, a, c) => id + o + mathText(a) + c)
            .replace(/\|([^|"\n]+)\|/g, (m, a) => '|' + mathText(a) + '|')).join('\n');
  }

  let mermaidLoad = null, uid = 0;
  const diagrams = new Map();   // source → drawn SVG, so a redraw of the page is instant
  function scriptBase() { const s = document.querySelector('script[src$="figures.js"]'); return s ? s.getAttribute('src').replace(/figures\.js$/, '') : ''; }
  function loadMermaid() {
    if (!mermaidLoad) mermaidLoad = new Promise((ok, bad) => {
      if (window.mermaid) return ok(window.mermaid);
      const s = document.createElement('script'); s.src = scriptBase() + 'vendor/mermaid.min.js';
      s.onload = () => (window.mermaid ? ok(window.mermaid) : bad(new Error('the diagram library didn’t start')));
      s.onerror = () => bad(new Error('the diagram library couldn’t be loaded'));
      document.head.appendChild(s);
    }).then(m => {
      m.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral', htmlLabels: false, flowchart: { htmlLabels: false, curve: 'basis' }, fontFamily: '"Rubik Variable", "Segoe UI", Arial, sans-serif' });
      return m;
    });
    return mermaidLoad;
  }
  async function drawDiagram(fig) {
    const src = fig.dataset.src || '';
    try {
      let svg = diagrams.get(src);
      if (!svg) { const m = await loadMermaid(); ({ svg } = await m.render('sn-mmd-' + (++uid), mermaidMath(src))); diagrams.set(src, svg); if (diagrams.size > 300) diagrams.clear(); }
      fig.innerHTML = svg; fig.dataset.done = '1';
      const el = fig.querySelector('svg'); if (el) { el.removeAttribute('height'); el.style.maxWidth = Math.min(640, parseFloat(el.style.maxWidth) || 640) + 'px'; el.setAttribute('role', 'img'); }
    } catch (e) {
      document.querySelectorAll('[id^="dsn-mmd-"]').forEach(n => n.remove());   // Mermaid leaves a broken copy behind on errors
      fig.replaceWith(errorFigure('This diagram couldn’t be drawn', String(e && e.message || e).split('\n')[0], src));
    }
  }

  /* ---------------- callout boxes:  > [!tip] Optional title ---------------- */
  const ICON = {
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
    bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>',
    warn: '<path d="M12 3.5 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17v.4"/>',
    star: '<path d="m12 3.5 2.6 5.6 6 .7-4.5 4.1 1.2 6-5.3-3-5.3 3 1.2-6L3.4 9.8l6-.7z"/>'
  };
  const KINDS = {
    note: ['info', 'Note', 'הערה'], info: ['info', 'Note', 'הערה'], definition: ['info', 'Definition', 'הגדרה'], formula: ['info', 'Formula', 'נוסחה'], summary: ['info', 'Summary', 'סיכום'],
    tip: ['bulb', 'Tip', 'טיפ'], example: ['bulb', 'Example', 'דוגמה'],
    important: ['star', 'Important', 'חשוב'], key: ['star', 'Key point', 'נקודת מפתח'],
    warning: ['warn', 'Watch out', 'שימו לב'], caution: ['warn', 'Caution', 'זהירות'], mistake: ['warn', 'Common mistake', 'טעות נפוצה'], danger: ['warn', 'Careful', 'זהירות']
  };
  function callouts(root) {
    root.querySelectorAll('blockquote:not(.callout)').forEach(bq => {
      const p = bq.firstElementChild; if (!p || p.tagName !== 'P') return;
      const tn = p.firstChild; if (!tn || tn.nodeType !== 3) return;
      const m = tn.nodeValue.match(/^\s*\[!([a-zA-Z]+)\][+-]?[ \t]*([^\n]*)\n?/);
      if (!m) return;
      const kind = KINDS[m[1].toLowerCase()] ? m[1].toLowerCase() : 'note', [icon, en, he] = KINDS[kind];
      // Default title in the note's language: Hebrew if the box (or the page) is in Hebrew.
      const rtl = /[֐-׿]/.test(bq.textContent) || !!bq.closest('[dir="rtl"]');
      tn.nodeValue = tn.nodeValue.slice(m[0].length);
      const title = document.createElement('div');
      title.className = 'co-title';
      title.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[icon]}</svg><span dir="auto"></span>`;
      title.lastChild.textContent = m[2].trim() || (rtl ? he : en);
      bq.classList.add('callout', 'co-' + kind);
      bq.insertBefore(title, bq.firstChild);
      if (!p.textContent.trim() && !p.querySelector('mjx-container, img')) p.remove();
    });
  }

  // Turns ```plot and ```mermaid blocks inside root into drawings, and [!tip] quotes into callout
  // boxes. Plots are drawn at once; the returned promise settles when the diagrams are drawn too.
  function upgrade(root) {
    if (!root) return Promise.resolve();
    callouts(root);
    root.querySelectorAll('pre > code').forEach(code => {
      const lang = ((code.className || '').match(/language-([\w-]+)/) || [])[1];
      if (!lang) return;
      const pre = code.parentElement, src = code.textContent;
      if (/^(plot|graph|chart)$/i.test(lang)) pre.replaceWith(plotFigure(src));
      else if (/^(mermaid|diagram)$/i.test(lang)) {
        const f = document.createElement('figure'); f.className = 'fig fig-dia tex2jax_ignore'; f.dir = 'ltr'; f.dataset.src = src;
        f.innerHTML = '<div class="fig-wait">…</div>'; pre.replaceWith(f);
      }
    });
    const jobs = [...root.querySelectorAll('figure.fig-dia:not([data-done])')].map(drawDiagram);
    return jobs.length ? Promise.all(jobs).then(() => {}) : Promise.resolve();
  }

  window.SNFig = { upgrade, plotSvg, compile, mathText, mermaidMath };
})();
