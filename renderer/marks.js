/* The student's own highlights and drawings on a note. Shared by the notes page and the printout.

   Highlights are stored as the marked text plus a few words around it ({ q, pre, suf, c }), not as
   positions, so they find their place again after the page reflows, in the printout, and after
   Claude adds text elsewhere in the section. If the marked words are gone, the highlight just
   doesn't show.

   Drawings are stored per stroke, pinned to the paragraph (block) they were drawn on: x and y are
   in thousandths of that block's width, measured from its top-left corner. Each block that has
   strokes gets an SVG laid over it that scales with its width, so drawings stay with their text
   on any screen and on paper. */
(() => {
  'use strict';
  const SKIP = 'mjx-container, .fig, svg, script, style, .co-title';
  const HL = ['yellow', 'green', 'blue', 'pink', 'orange'];
  const INK = ['black', 'blue', 'red', 'green', 'orange', 'purple', 'yellow', 'pink'];
  const PEN = [2.5, 4.5, 8], MARKER = [14, 22, 34];

  // The note's top-level blocks (paragraphs, lists, tables, figures...). Tables get a wrapper so a
  // drawing can sit on top of them.
  function blocks(root) {
    const out = [];
    for (const el of [...root.children]) {
      if (el.tagName === 'TABLE') { const w = document.createElement('div'); w.className = 'tbl'; el.replaceWith(w); w.appendChild(el); out.push(w); }
      else if (!el.classList.contains('ink-input') && !(el.tagName === 'svg' && el.classList.contains('ink'))) out.push(el);
    }
    return out;
  }

  /* ---------- highlights ---------- */
  function textIndex(root) {
    const nodes = []; let text = '';
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => (n.parentElement && n.parentElement.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    let n;
    while ((n = walker.nextNode())) { nodes.push({ node: n, start: text.length, end: text.length + n.nodeValue.length }); text += n.nodeValue; }
    return { text, nodes };
  }
  const sameEnd = (a, b) => { let k = 0; while (k < a.length && k < b.length && a[a.length - 1 - k] === b[b.length - 1 - k]) k++; return k; };
  const sameStart = (a, b) => { let k = 0; while (k < a.length && k < b.length && a[k] === b[k]) k++; return k; };
  function locate(idx, h) {
    const q = String(h.q || ''); if (!q) return null;
    let best = null, bestScore = -1;
    for (let i = idx.text.indexOf(q), guard = 0; i >= 0 && guard < 500; i = idx.text.indexOf(q, i + 1), guard++) {
      const pre = String(h.pre || ''), suf = String(h.suf || '');
      const score = sameEnd(idx.text.slice(Math.max(0, i - pre.length), i), pre) + sameStart(idx.text.slice(i + q.length, i + q.length + suf.length), suf);
      if (score > bestScore) { best = [i, i + q.length]; bestScore = score; }
    }
    return best || near(idx.text, h);
  }
  // When the exact words aren't there any more (Claude reworded the topic a little, spacing or
  // punctuation changed), look for the same words with any spacing/punctuation between them, then
  // for the longest part of the highlight that is still there, near its old neighbours.
  const RX = c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function near(text, h) {
    const words = String(h.q || '').split(/[\s.,;:!?()"'“”׳״\-–—]+/).filter(Boolean);
    if (!words.length) return null;
    const ctx = (i, j) => sameEnd(text.slice(Math.max(0, i - 64), i), String(h.pre || '')) + sameStart(text.slice(j, j + 64), String(h.suf || ''));
    const find = ws => {
      const rx = new RegExp(ws.map(RX).join('[\\s.,;:!?()"\'“”׳״\\-–—]+'), 'g');
      let m, best = null, bs = -1, guard = 0;
      while ((m = rx.exec(text)) && guard++ < 200) { const sc = ctx(m.index, m.index + m[0].length); if (sc > bs) { bs = sc; best = [m.index, m.index + m[0].length]; } if (!m[0].length) rx.lastIndex++; }
      return best;
    };
    const all = find(words); if (all) return all;
    // the longest run of the highlighted words still in the text (at least 2 words, or 1 long word)
    for (let len = words.length - 1; len >= 1; len--) {
      for (let st = 0; st + len <= words.length; st++) {
        const part = words.slice(st, st + len);
        if (len === 1 && part[0].length < 5) continue;
        const r = find(part); if (r) return r;
      }
    }
    return null;
  }
  function wrap(idx, start, end, h) {
    const color = HL.includes(h.c) || h.c === 'note' || h.c === 'fresh' ? h.c : 'yellow';
    const note = typeof h.n === 'string' && h.n.trim() ? h.n.trim() : '';
    let last = null;
    for (const seg of idx.nodes) {
      if (seg.end <= start || seg.start >= end) continue;
      let node = seg.node;
      const s = Math.max(start, seg.start) - seg.start, e = Math.min(end, seg.end) - seg.start;
      if (e <= s || !node.parentNode) continue;
      if (!node.nodeValue.slice(s, e).trim()) continue;            // whitespace between list items, cells...
      if (/^(UL|OL|TABLE|TBODY|THEAD|TR)$/.test(node.parentNode.nodeName)) continue;
      if (s > 0) node = node.splitText(s);
      if (e - s < node.nodeValue.length) node.splitText(e - s);
      const m = document.createElement('mark');
      m.className = 'uh uh-' + color + (note ? ' has-note' : ''); m.dataset.hl = h.id || '';
      if (note) m.title = note;
      node.parentNode.insertBefore(m, node); m.appendChild(node); last = m;
    }
    // a comment shows as a small bubble after the marked words (and as the text itself when printed)
    if (last && note) { last.classList.add('note-end'); last.dataset.noteText = note; }
  }
  function clearHighlights(root) {
    root.querySelectorAll('mark.uh').forEach(m => m.replaceWith(...m.childNodes));
    root.querySelectorAll('.fresh-fig').forEach(f => f.classList.remove('fresh-fig'));
    root.normalize();
  }
  function applyHighlights(root, list) {
    let shown = 0;
    for (const h of Array.isArray(list) ? list : []) {
      const idx = textIndex(root), at = locate(idx, h);
      if (at) { wrap(idx, at[0], at[1], h); shown++; }
    }
    return shown;
  }
  // What a selection in the note covers, as a highlight to save.
  function quoteFromRange(root, range) {
    const idx = textIndex(root); let start = -1, end = -1;
    for (const seg of idx.nodes) {
      if (!range.intersectsNode(seg.node)) continue;
      const s = seg.node === range.startContainer ? range.startOffset : 0;
      const e = seg.node === range.endContainer ? range.endOffset : seg.node.nodeValue.length;
      if (e <= s) continue;
      if (start < 0) start = seg.start + s;
      end = seg.start + e;
    }
    if (start < 0 || end <= start) return null;
    while (start < end && /\s/.test(idx.text[start])) start++;
    while (end > start && /\s/.test(idx.text[end - 1])) end--;
    if (end <= start || end - start > 3000) return null;
    return { q: idx.text.slice(start, end), pre: idx.text.slice(Math.max(0, start - 32), start), suf: idx.text.slice(end, end + 32) };
  }

  /* ---------- drawings ---------- */
  const r1 = v => Math.round(v * 10) / 10;
  function strokeSvg(st) {
    const c = INK.includes(st.c) ? st.c : 'black', size = Math.min(3, Math.max(1, st.s | 0 || 2)) - 1;
    const p = (Array.isArray(st.p) ? st.p : []).filter(q => Array.isArray(q) && q.length >= 2).map(q => [+q[0], +q[1]]);
    if (!p.length) return '';
    const id = st.id ? ` data-ink="${String(st.id).replace(/[^\w-]/g, '')}"` : '';
    if (st.t === 'pen' || st.t === 'marker') {
      const w = (st.t === 'marker' ? MARKER : PEN)[size];
      let d = `M${r1(p[0][0])} ${r1(p[0][1])}`;
      if (p.length === 1) d += `l0.1 0`;
      for (let i = 1; i < p.length - 1; i++) { const mx = (p[i][0] + p[i + 1][0]) / 2, my = (p[i][1] + p[i + 1][1]) / 2; d += `Q${r1(p[i][0])} ${r1(p[i][1])} ${r1(mx)} ${r1(my)}`; }
      if (p.length > 1) d += `L${r1(p[p.length - 1][0])} ${r1(p[p.length - 1][1])}`;
      return `<path${id} class="s-${c}${st.t === 'marker' ? ' mk' : ''}" stroke-width="${w}" d="${d}"/>`;
    }
    const [a, b] = [p[0], p[p.length - 1]], w = PEN[size];
    if (st.t === 'line') return `<line${id} class="s-${c}" stroke-width="${w}" x1="${r1(a[0])}" y1="${r1(a[1])}" x2="${r1(b[0])}" y2="${r1(b[1])}"/>`;
    if (st.t === 'arrow') {
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), L = 14 + w * 2.2, s = 0.45;
      const h1 = [b[0] - L * Math.cos(ang - s), b[1] - L * Math.sin(ang - s)], h2 = [b[0] - L * Math.cos(ang + s), b[1] - L * Math.sin(ang + s)];
      return `<path${id} class="s-${c}" stroke-width="${w}" d="M${r1(a[0])} ${r1(a[1])}L${r1(b[0])} ${r1(b[1])}M${r1(h1[0])} ${r1(h1[1])}L${r1(b[0])} ${r1(b[1])}L${r1(h2[0])} ${r1(h2[1])}"/>`;
    }
    const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]), wd = Math.abs(b[0] - a[0]), ht = Math.abs(b[1] - a[1]);
    if (st.t === 'rect') return `<rect${id} class="s-${c}" stroke-width="${w}" x="${r1(x)}" y="${r1(y)}" width="${r1(wd)}" height="${r1(ht)}" rx="6"/>`;
    if (st.t === 'ellipse') return `<ellipse${id} class="s-${c}" stroke-width="${w}" cx="${r1(x + wd / 2)}" cy="${r1(y + ht / 2)}" rx="${r1(wd / 2)}" ry="${r1(ht / 2)}"/>`;
    return '';
  }
  function drawInk(root, strokes) {
    root.querySelectorAll('svg.ink').forEach(s => s.remove());
    const list = Array.isArray(strokes) ? strokes : [];
    if (!list.length) return;
    const bl = blocks(root); if (!bl.length) return;
    const by = new Map();
    for (const st of list) { const b = Math.min(bl.length - 1, Math.max(0, st.b | 0)); if (!by.has(b)) by.set(b, []); by.get(b).push(st); }
    for (const [b, group] of by) {
      const el = bl[b]; el.classList.add('ink-anchor');
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'ink'); svg.setAttribute('viewBox', '0 0 1000 1000'); svg.setAttribute('aria-hidden', 'true');
      svg.innerHTML = group.map(strokeSvg).join('');
      el.appendChild(svg);
    }
  }


  /* ---------- what Claude changed ---------- */
  // When Claude (or Gemini) deepens or fixes part of a topic, the sentences and pictures that are new
  // compared with the version before are found here, so the page can mark them for the student.
  const FENCE = /^```[^\n]*\n[\s\S]*?^```[ \t]*$/gm;
  function plain(md) {
    return String(md || '')
      .replace(FENCE, '\n')
      .replace(/\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|(?<![\\$\w])\$(?=[^\s$])[^$\n]+?(?<=[^\s\\$])\$(?![\w$])/g, '')       // formulas aren't part of the text that gets marked
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/==(?:\{\w+\})?([^=\n]+?)==/g, '$1').replace(/\*\*|__|~~|`/g, '').replace(/(^|\s)[*_](?=\S)|(?<=\S)[*_](?=\s|$|[.,;:!?])/g, '$1')
      .replace(/^[ \t]*(#{1,6}|>|[-*+]|\d+[.)])[ \t]+/gm, '').replace(/^\s*\[!\w+\][^\n]*$/gm, '').replace(/\|/g, ' ').replace(/^[ \t]*:?-{3,}:?[ \t]*$/gm, '');
  }
  const sentences = txt => txt.split(/\n+|(?<=[.!?…:;])\s+/).map(x => x.trim()).filter(x => /[\p{L}\p{N}]{2,}/u.test(x));
  const key = x => x.toLowerCase().replace(/[\s.,;:!?()"'“”׳״\-–—]+/g, ' ').trim();
  function changes(prev, cur) {
    if (typeof prev !== 'string' || typeof cur !== 'string' || prev === cur) return null;
    const before = new Set(sentences(plain(prev)).map(key));
    const all = plain(cur), parts = [];
    let from = 0;
    for (const sn of sentences(all)) {
      const at = all.indexOf(sn, from); if (at >= 0) from = at + sn.length;
      if (before.has(key(sn)) || key(sn).length < 3) continue;
      parts.push({ q: sn, pre: at > 0 ? all.slice(Math.max(0, at - 32), at) : '', suf: at >= 0 ? all.slice(at + sn.length, at + sn.length + 32) : '', c: 'fresh' });
    }
    const fences = md => String(md || '').match(FENCE) || [];
    const old = new Set(fences(prev).map(f => f.replace(/\s+/g, ' ').trim()));
    const figs = []; fences(cur).forEach((f, i) => { if (!old.has(f.replace(/\s+/g, ' ').trim())) figs.push(i); });
    return parts.length || figs.length ? { parts: parts.slice(0, 80), figs } : null;
  }
  // Marks what changed on a note: the new sentences, and the new pictures (by their order on the page).
  function applyChanges(root, ch) {
    if (!root || !ch) return 0;
    let n = applyHighlights(root, ch.parts);
    if (ch.figs.length) {
      const blocksIn = [...root.querySelectorAll('pre, figure.fig')].filter(el => !el.parentElement.closest('pre, figure.fig'));
      for (const i of ch.figs) if (blocksIn[i]) { blocksIn[i].classList.add('fresh-fig'); n++; }
    }
    return n;
  }
  window.SNMarks = { plain, changes, applyChanges, blocks, textIndex, applyHighlights, clearHighlights, quoteFromRange, drawInk, strokeSvg, HL, INK };
})();
