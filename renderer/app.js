/* Study Notebook: the notebook you read, organize, practice and print.
   Claude writes the notes and practice questions from the Claude app
   (through the connector); this app shows them, lets you edit, undo,
   practice and record lectures, and saves everything on this computer. */
(() => {
  'use strict';
  const D = window.desktop;
  const WEB = !!D.web;   // the notebook on the website (no recording, printing or local Claude setup there)
  const Ops = window.NotebookOps;
  const { t, tn, lang: uiLang } = window.I18N;
  const BASE = Ops.BASE;
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rid = p => p + Math.random().toString(36).slice(2, 9) + Math.random().toString(36).slice(2, 5);
  const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } };
  const UIDIR = uiLang === 'he' ? 'rtl' : 'ltr';
  const LOCALE = uiLang === 'he' ? 'he-IL' : undefined;

  /* ================= data ================= */
  let docs = {};
  let saveTimer = null, dirty = false, saving = Promise.resolve();
  function save() { dirty = true; clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 350); }
  function saveNow() {
    clearTimeout(saveTimer);
    if (!dirty) return saving;
    dirty = false;
    const text = JSON.stringify({ version: 1, savedAt: Date.now(), docs });
    saving = saving.then(() => D.saveData(text)).then(r => { if (!r || !r.ok) { dirty = true; toast(t('Couldn’t save to this computer. Your last change may not be saved.')); } });
    return saving;
  }
  D.onFlush(() => { if (window.recorderOnClose) window.recorderOnClose(); return saveNow(); });

  const coursePath = id => `${BASE}/${id}`;
  const secPath = (cid, sid) => `${BASE}/${cid}/sections/${sid}`;
  const lecPath = (cid, lid) => `${BASE}/${cid}/lectures/${lid}`;
  const cardPath = (cid, kid) => `${BASE}/${cid}/cards/${kid}`;
  function courses() {
    return Object.entries(docs).filter(([p, d]) => p.split('/').length === 4 && d && d.name)
      .map(([p, d]) => ({ id: p.split('/')[3], ...d })).sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || (a.createdAt || 0) - (b.createdAt || 0));
  }
  function children(cid, kind) {
    const pre = `${BASE}/${cid}/${kind}/`; const out = [];
    for (const [p, d] of Object.entries(docs)) if (p.startsWith(pre) && p.split('/').length === 6 && d) out.push({ id: p.slice(pre.length), ...d });
    return out;
  }
  function sections(cid) { const out = {}; for (const s of children(cid, 'sections')) out[s.id] = s; return out; }
  const lectures = cid => children(cid, 'lectures').sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  const cards = cid => children(cid, 'cards').sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  function kids(secs, pid) { return Object.values(secs).filter(s => (s.parentId || null) === pid).sort((a, b) => (a.order || 0) - (b.order || 0) || (a.createdAt || 0) - (b.createdAt || 0)); }
  function walk(secs, fn, pid = null, d = 0) { for (const s of kids(secs, pid)) { fn(s, d); walk(secs, fn, s.id, d + 1); } }
  function subtree(secs, id) { const out = [id]; for (const k of kids(secs, id)) out.push(...subtree(secs, k.id)); return out; }
  function crumbs(secs, id) { const out = []; let s = secs[id] && secs[id].parentId ? secs[secs[id].parentId] : null; let g = 0; while (s && g++ < 40) { out.unshift(s.title); s = s.parentId ? secs[s.parentId] : null; } return out; }
  function rootOf(secs, id) { let s = secs[id]; let g = 0; while (s && s.parentId && g++ < 40) s = secs[s.parentId]; return s || null; }
  const putSection = (cid, s) => { const { id, ...data } = s; docs[secPath(cid, id)] = data; save(); };
  const dueCount = cid => { const now = Date.now(); return cards(cid).filter(k => !k.srs || k.srs.due <= now).length; };

  /* ================= state ================= */
  // view: 'notes' | 'lecture' | 'practice'
  const S = { claudeSeen: 0, view: 'notes', lecture: null, lecAt: null, confirmLec: false, renamingLec: false, courseId: store('sn-course') || '', search: '', editing: null, confirmDel: null, collapsed: new Set(), flash: new Set(), menu: false, settings: null, lastClaude: 0, prac: null, pracTopic: '', pracMode: 'due', genType: 'mixed' };
  const course = () => courses().find(c => c.id === S.courseId) || null;
  function selectCourse(id) { S.courseId = id || ''; store('sn-course', S.courseId); S.view = 'notes'; S.lecture = null; S.prac = null; S.editing = S.confirmDel = null; S.search = ''; render(); const w = $('sheetWrap'); if (w) w.scrollTop = 0; restorePos(); }
  // Remembers, per course, which section you were reading and where in it, and goes back there.
  let posTimer = null;
  function savePos() {
    if (S.view !== 'notes' || S.search || !S.courseId) return;
    const w = $('sheetWrap'), top = w.getBoundingClientRect().top;
    const sec = [...$('sheet').querySelectorAll(':scope > .sec')].find(el => el.getBoundingClientRect().bottom > top + 8);
    store('sn-pos-' + S.courseId, sec ? JSON.stringify({ id: sec.id, off: Math.round(top - sec.getBoundingClientRect().top) }) : '');
  }
  function restorePos() {
    let p = null; try { p = JSON.parse(store('sn-pos-' + S.courseId) || 'null'); } catch (e) {}
    if (!p || !p.id || S.view !== 'notes') return;
    let moved = false; const stop = () => { moved = true; };
    for (const ev of ['wheel', 'keydown', 'pointerdown', 'touchstart']) addEventListener(ev, stop, { once: true, passive: true });
    const w = $('sheetWrap');
    const go = () => { if (moved) return; const el = document.getElementById(p.id); if (!el) return; w.scrollTop += el.getBoundingClientRect().top - w.getBoundingClientRect().top + (p.off || 0); };
    // Wait (out of sight) until the formulas are drawn, jump straight there, then show the page.
    w.classList.add('restoring');
    Promise.race([S.drawing || Promise.resolve(), new Promise(r => setTimeout(r, 1500))]).then(() => {
      go(); requestAnimationFrame(() => { go(); w.classList.remove('restoring'); });
    });
  }

  /* ================= helpers ================= */
  function ago(ts) {
    if (!ts) return '';
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return t('just now');
    if (m < 60) return t('{n} min ago', { n: m });
    const h = Math.round(m / 60); if (h < 24) return tn(h, '1 hour ago', '{n} hours ago');
    const d = Math.round(h / 24); if (d < 7) return tn(d, '1 day ago', '{n} days ago');
    return new Date(ts).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  let toastT;
  function toast(msg, action) {
    const el = $('toast'); clearTimeout(toastT);
    el.textContent = '';
    const span = document.createElement('span'); span.textContent = msg; el.appendChild(span);
    if (action) { const b = document.createElement('button'); b.type = 'button'; b.className = 'toast-act'; b.textContent = action.label; b.onclick = () => { el.hidden = true; action.fn(); }; el.appendChild(b); }
    el.hidden = false; toastT = setTimeout(() => (el.hidden = true), action ? 8000 : 3600);
  }
  // Deleting keeps a copy for a few seconds, so "Undo" can bring it all back.
  function removeDocs(test) { const kept = {}; for (const p of Object.keys(docs)) if (test(p)) { kept[p] = docs[p]; delete docs[p]; } return kept; }
  function undoable(msg, kept, after) { toast(msg, { label: t('Undo'), fn: () => { Object.assign(docs, kept); save(); if (after) after(); else render(); toast(t('Restored')); } }); }
  const COVERS = ['#6c2330', '#24533f', '#2c3a5e', '#7a4f1d', '#523061', '#255a5e', '#53562a', '#3d4650'];   // bookcloth
  // Which way a course reads. The notes themselves decide (a course set to Hebrew can hold English notes);
  // math is left out of the count. With too little text, the course's language setting decides.
  function dirOf(c) {
    if (!c) return 'ltr';
    const text = children(c.id, 'sections').slice(0, 40).map(s => s.title + ' ' + (s.content || '').slice(0, 600)).join(' ')
      .replace(/\$\$[\s\S]*?\$\$|\\\([\s\S]*?\\\)|\\[a-zA-Z]+/g, ' ');
    const he = (text.match(/[\u0590-\u05FF]/g) || []).length, la = (text.match(/[A-Za-z]/g) || []).length;
    if (he + la >= 40) return he > la ? 'rtl' : 'ltr';
    return c.lang === 'he' ? 'rtl' : c.lang === 'en' ? 'ltr' : /[\u0590-\u05FF]/.test(c.name) ? 'rtl' : 'ltr';
  }
  const dirFor = lang => (lang === 'he' || lang === 'ar') ? 'rtl' : 'ltr';
  const courseNum = c => (c && c.num) || ((c && String(c.name || "").match(/\d{4,6}/)) || [])[0];
  const fmtTs = s => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + String(x).padStart(2, '0'); };
  const parseTs = str => String(str || '').split(':').map(Number).reduce((a, v) => a * 60 + (isNaN(v) ? 0 : v), 0);
  function askClaude(cid, lid) {
    const c = courses().find(x => x.id === cid); const l = lectures(cid).find(x => x.id === lid);
    const nb = c ? (courseNum(c) || c.name) : 'my';
    const title = l ? l.title : 'this lecture';
    return c && c.lang === 'he' ? `תכין סיכום מלא מההרצאה "${title}" ותשמור אותו ב-Study Notebook, בקורס ${nb}` : `Make notes from my lecture "${title}" and save them in Study Notebook, course ${nb}`;
  }
  function askPractice(c, topic) {
    const nb = courseNum(c) || c.name;
    if (c.lang === 'he') return topic ? `תכין לי שאלות תרגול וכרטיסיות על "${topic}" ב-Study Notebook, בקורס ${nb}` : `תכין לי שאלות תרגול לקראת המבחן ב-Study Notebook, בקורס ${nb}, ותתמקד בנושאים שאני חלש בהם`;
    return topic ? `Make practice questions and flashcards on "${topic}" in Study Notebook, course ${nb}` : `Make exam practice questions in Study Notebook, course ${nb}, focusing on my weak topics`;
  }
  async function copy(text, msg) {
    let ok = false;
    try { ok = D.copyText ? await D.copyText(text) : false; } catch (e) {}
    if (!ok) try { await navigator.clipboard.writeText(text); ok = true; } catch (e) {}
    toast(ok ? (msg || t('Copied. Paste it into Claude.')) : t('Couldn’t copy. Select the text and press Ctrl+C.'));
    return ok;
  }

  /* ================= markdown + math ================= */
  function mdToHtml(md) {
    const math = [];
    const s = String(md || '').replace(/\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)/g, m => { math.push(m); return 'MATHPH' + (math.length - 1) + 'X'; });
    let html;
    if (window.marked && window.DOMPurify) html = DOMPurify.sanitize(marked.parse(s, { gfm: true, breaks: false }));
    else html = '<p>' + esc(s).replace(/\n\n+/g, '</p><p>').replace(/\n/g, '<br>') + '</p>';
    return html.replace(/MATHPH(\d+)X/g, (_, i) => esc(math[+i]));
  }
  function decorate(el) {
    decorateShape(el); wireLinks(el);
  }
  function decorateShape(el) {
    el.querySelectorAll('p,li,blockquote,td,th').forEach(n => n.setAttribute('dir', 'auto'));
    el.querySelectorAll('pre').forEach(n => n.setAttribute('dir', 'ltr'));
    el.querySelectorAll('p > strong:first-child').forEach(b => { if (b === b.parentNode.firstChild) b.classList.add('lead'); });   // "**Definition.** …" reads as a label
    el.querySelectorAll('table').forEach(tb => { if (!tb.parentElement.classList.contains('tbl')) { const w = document.createElement('div'); w.className = 'tbl'; tb.replaceWith(w); w.appendChild(tb); } });
  }
  function wireLinks(el) {
    el.querySelectorAll('a').forEach(a => {
      const href = a.getAttribute('href') || '';
      if (href.startsWith('#lec=')) { a.classList.add('lec-ref'); a.title = t('Open this moment in the lecture transcript'); a.addEventListener('click', e => { e.preventDefault(); openLectureAt(href.slice(5)); }); }
      else a.addEventListener('click', e => { e.preventDefault(); if (/^https:\/\//.test(a.href)) D.openExternal(a.href); });
    });
  }
  function typeset(el) {
    const els = (Array.isArray(el) ? el : [el]).filter(Boolean);
    if (!els.length) return Promise.resolve();
    const MJ = window.MathJax;
    if (MJ && MJ.typesetPromise) { try { MJ.typesetClear && MJ.typesetClear(els); } catch (e) {} return MJ.typesetPromise(els).catch(() => {}); }
    return new Promise(r => setTimeout(() => typeset(els).then(r), 300));
  }
  // Notes already drawn (math included) are kept, so a redraw only draws what changed.
  const drawn = new Map();
  const drawnKey = s => `${s.id}|${s.rev || 1}|${s.updatedAt || 0}|${String(s.content || '').length}|${UIDIR}`;
  const hasMath = el => /\\\(|\\\[|\$\$/.test(el.textContent);
  const setMd = (el, md) => { el.innerHTML = mdToHtml(md); decorate(el); typeset(el); };
  function highlight(el, q) {
    if (!q) return;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: n => n.parentElement.closest('mjx-container,code,pre') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    const hits = []; let n;
    while ((n = walker.nextNode())) if (n.nodeValue.toLowerCase().includes(q)) hits.push(n);
    for (const node of hits) {
      const v = node.nodeValue, lower = v.toLowerCase(), frag = document.createDocumentFragment(); let i = 0, j;
      while ((j = lower.indexOf(q, i)) >= 0) { frag.append(v.slice(i, j)); const m = document.createElement('mark'); m.textContent = v.slice(j, j + q.length); frag.append(m); i = j + q.length; }
      frag.append(v.slice(i)); node.replaceWith(frag);
    }
  }

  /* ================= rendering ================= */
  function render() { renderSide(); renderTop(); renderContents(); renderSheet(); requestAnimationFrame(markReading); }

  function renderSide() {
    const list = courses();
    if (S.courseId && !list.some(c => c.id === S.courseId)) S.courseId = list[0] ? list[0].id : '';
    if (!S.courseId && list[0]) S.courseId = list[0].id;
    // Each course is a volume on the shelf: its name on the spine, its course number as the call number.
    // A course keeps its cloth colour wherever it's moved: colours follow the order courses were made in.
    const made = list.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).map(c => c.id);
    if (!S.dragging) $('courses').innerHTML = list.map(c => {
      const n = children(c.id, 'sections').length, nl = lectures(c.id).length, due = dueCount(c.id);
      const parts = [n ? tn(n, '1 section', '{n} sections') : t('Empty')];
      if (nl) parts.push(tn(nl, '1 lecture', '{n} lectures'));
      if (due) parts.push(tn(due, '1 practice item due', '{n} practice items due'));
      const num = courseNum(c), title = (num ? c.name.replace(num, '').replace(/^[\s·:–-]+|[\s·:–-]+$/g, '') : '') || c.name;
      const call = num || title.split(/\s+/).filter(Boolean).slice(0, 3).map(w => w[0]).join('').toUpperCase();
      const ex = daysTo(c.examDate), soon = ex != null && ex >= 0 && ex <= 7;
      if (soon) parts.push(ex === 0 ? t('Exam today') : ex === 1 ? t('Exam tomorrow') : t('Exam in {n} days', { n: ex }));
      return `<button class="course${soon ? ' exam-soon' : ''}${c.photo ? ' has-photo' : ''}" type="button" data-course="${esc(c.id)}" aria-current="${c.id === S.courseId}" style="--c:${COVERS[(c.color ?? made.indexOf(c.id)) % COVERS.length]}${c.photo ? `;--photo:url(${c.photo})` : ''}" title="${esc(c.name + ' · ' + parts.join(t(', ')) + '\n' + t('Drag to move it on the shelf · right-click to edit'))}"><b class="sp-t" dir="auto">${esc(title)}</b><span class="cn" dir="auto">${esc(call)}</span>${soon ? `<span class="sp-exam" aria-hidden="true">${ex === 0 ? '!' : ex}</span>` : ''}${due ? `<span class="due-pill" aria-hidden="true">${due}</span>` : ''}</button>`;
    }).join('') || `<p class="small" style="padding:6px 10px">${t('No courses yet.')}</p>`;
    renderClaudePill(); renderSlip();
    const th = theme();
    $('themeBtn').innerHTML = THEME_ICON[th];
    $('themeBtn').title = t('Appearance: {name} (click to change)', { name: t(THEME_NAME[th]) });
    $('themeBtn').setAttribute('aria-label', t('Appearance: {name}', { name: t(THEME_NAME[th]) }));
  }

  function lastClaude() { if (WEB) return cloudState && cloudState.claude ? Math.max(S.lastClaude, 1) : S.lastClaude; return Math.max(S.lastClaude, S.claudeSeen || 0, (S.settings && (S.settings.connectorLastUse || S.settings.connectorSeen)) || 0); }
  function renderClaudePill() {
    const ts = lastClaude();
    $('claudePill').innerHTML = ts
      ? `<span class="dot on"></span><span><b>${t('Connected to Claude')}</b>${esc((S.settings && S.settings.connectorLastUse) || S.lastClaude ? t('Last saved {when}', { when: ago(Math.max(S.lastClaude, (S.settings && S.settings.connectorLastUse) || 0)) }) : t('Ready to save notes'))}</span>`
      : `<span class="dot"></span><span><b>${t('Connect to Claude')}</b>${t('So Claude can save your notes')}</span>`;
  }

  function recButton() {
    if (WEB) return '';
    const r = window.recorderState ? window.recorderState() : { active: false };
    return r.active ? `<button class="btn rec-btn live" id="recBtn" type="button"><span class="rec-dot on"></span>${t('Recording')} ${r.state === 'recording' ? fmtTs(r.seconds) : '…'}</button>`
      : `<button class="btn rec-btn" id="recBtn" type="button"><span class="rec-dot"></span>${t('Record lecture')}</button>`;
  }

  function renderTop() {
    const c = course(); const top = $('top');
    const navBtn = `<button class="icon-btn nav-btn" id="navBtn" type="button" aria-label="${esc(t('Courses'))}" aria-controls="courses" aria-expanded="false"><svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg></button>`;
    if (!c) { top.innerHTML = `${navBtn}<h1>Study Notebook</h1>`; return; }
    const secs = children(c.id, 'sections');
    const newest = secs.reduce((m, s) => Math.max(m, s.updatedAt || 0), 0);
    const has = secs.length > 0, due = dueCount(c.id), nCards = cards(c.id).length;
    top.innerHTML = `${navBtn}
      <h1><span dir="auto">${esc(c.name)}</span><span class="meta" dir="${UIDIR}">${has ? esc(tn(secs.length, '1 section, updated {when}', '{n} sections, updated {when}', { when: ago(newest) })) : t('No notes yet')}${examChip(c)}</span></h1>
      <div class="tools">
        <label class="search"><svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="m16 16 4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><input id="search" type="search" placeholder="${esc(t('Search this course'))}" value="${esc(S.search)}" aria-label="${esc(t('Search this course'))}" ${has ? '' : 'disabled'}></label>
        ${window.StudyTimer ? window.StudyTimer.button() : ''}
        <button class="btn toc-btn" id="tocBtn" type="button" aria-controls="contents" ${has ? '' : 'disabled'}><svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>${t('Topics')}</button>
        <button class="btn${S.view === 'practice' ? ' on' : ''}" id="pracBtn" type="button"><svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="6" width="13" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M7.5 3.5h10a3 3 0 0 1 3 3v10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>${t('Practice')}${due ? `<span class="count">${due}</span>` : nCards ? '' : ''}</button>
        ${recButton()}
        ${WEB ? '' : `<button class="btn" id="printBtn" type="button" ${has ? '' : 'disabled'}><svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v7H7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>${t('Print / PDF')}</button>`}
        <div class="menu-wrap">
          <button class="btn" id="moreBtn" type="button" aria-haspopup="menu" aria-expanded="${S.menu}" aria-label="${esc(t('More'))}">⋯</button>
          ${S.menu ? `<div class="menu" role="menu">
            <button type="button" role="menuitem" data-act="formulas" ${has ? '' : 'disabled'}>${t('Formula sheet')}</button>
            <button type="button" role="menuitem" data-act="exam-date">${c.examDate ? t('Change exam date') : t('Set exam date')}</button>
            <button type="button" role="menuitem" data-act="auto-save">${t('Auto-save Claude chats to this course')}</button>
            <button type="button" role="menuitem" data-act="add-topic">${t('Add a topic by hand')}</button>
            <button type="button" role="menuitem" data-act="export-md" ${has ? '' : 'disabled'}>${t('Export as Markdown')}</button>
            <button type="button" role="menuitem" data-act="course-settings">${t('Edit course details')}</button>
            <button type="button" role="menuitem" class="danger" data-act="delete-course">${t('Delete course')}</button>
          </div>` : ''}
        </div>
      </div>`;
    if (window.StudyTimer) window.StudyTimer.place();
    const inp = $('search');
    if (inp) inp.addEventListener('input', e => { clearTimeout(inp._t); inp._t = setTimeout(() => { S.search = e.target.value; if (S.view !== 'notes') { S.view = 'notes'; renderContents(); } renderSheet(); }, 160); });
  }

  function renderContents() {
    const c = course(); const el = $('contents');
    if (!c) { el.innerHTML = ''; return; }
    const secs = sections(c.id);
    const roots = kids(secs, null);
    const lecs = lectures(c.id);
    el.setAttribute('dir', dirOf(c));
    const he = dirOf(c) === 'rtl';
    const lecHtml = lecs.length ? `<h2 class="lec-h">${he ? 'הרצאות מוקלטות' : 'Recorded lectures'}</h2><ul class="lec-list">${lecs.map(l => `<li><button type="button" class="lec-link${S.view === 'lecture' && S.lecture === l.id ? ' on' : ''}" data-lecture="${esc(l.id)}"><span class="lec-state ${l.status === 'recording' ? 'live' : l.notesAt ? 'done' : ''}" aria-hidden="true"></span><span dir="auto">${esc(l.title)}</span><small>${esc(new Date(l.startedAt || 0).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' }))}${l.notesAt ? esc(t(', notes made')) : ''}</small></button></li>`).join('')}</ul>` : '';
    if (!roots.length) { el.innerHTML = lecHtml; return; }
    const dayAgo = Date.now() - 86400000;
    // Each topic shows how far you are with it: sub-topics, practice questions and how many you got right.
    const all = cards(c.id), byRoot = new Map();
    for (const k of all) { const r = k.topicId && rootOf(secs, k.topicId); if (r) { const e = byRoot.get(r.id) || { n: 0, ok: 0, tries: 0 }; e.n++; for (const h of k.hist || []) { e.tries++; if (h.ok) e.ok++; } byRoot.set(r.id, e); } }
    const clean = x => String(x || '').replace(/^\s*\d+(\.\d+)*[.)]?\s+/, '');   // the contents number it already; drop "1." typed into the title
    const item = (s, d) => {
      const ch = kids(secs, s.id); const open = !S.collapsed.has(s.id);
      let meta = '';
      if (d === 0) {
        const e = byRoot.get(s.id), parts = [];
        if (ch.length) parts.push(tn(ch.length, '1 sub-topic', '{n} sub-topics'));
        const acc = e && e.tries ? Math.round(100 * e.ok / e.tries) : null;
        parts.push(!e ? t('No questions yet') : acc == null ? tn(e.n, '1 question, not practiced', '{n} questions, not practiced') : t('{p}% right', { p: acc }));
        meta = `<small class="toc-meta" dir="${UIDIR}"><i class="mastery ${acc == null ? '' : acc >= 70 ? 'high' : 'mid'}" aria-hidden="true"></i>${esc(parts.join(' · '))}</small>`;
      }
      return `<li><div class="toc-row"><button type="button" class="toc-tog ${ch.length ? '' : 'none'}" data-tog="${esc(s.id)}" aria-expanded="${open}" aria-label="${esc(t('Show or hide sub-topics'))}">▼</button><button type="button" class="toc-link ${d ? 'sub' : ''} ${s.source === 'claude' && (s.updatedAt || 0) > dayAgo ? 'fresh' : ''}" data-go="${esc(s.id)}" title="${esc(s.title)}"><span class="toc-t" dir="auto">${esc(clean(s.title))}</span>${meta}</button></div>${ch.length && open ? `<ul>${ch.map(k => item(k, d + 1)).join('')}</ul>` : ''}</li>`;
    };
    el.innerHTML = `<h2>${he ? 'תוכן העניינים' : 'Contents'}</h2><ul>${roots.map(s => item(s, 0)).join('')}</ul>${lecHtml}`;
    markReading();
  }
  // The topic you're reading is marked in the contents as you scroll.
  function markReading() {
    const w = $('sheetWrap'), list = $('contents'); if (!w || !list) return;
    let cur = null; const top = w.getBoundingClientRect().top + 90;
    for (const sec of w.querySelectorAll('.sec')) { if (sec.getBoundingClientRect().top <= top) cur = sec; else break; }
    const id = cur ? cur.id.replace(/^sec-/, '') : (w.querySelector('.sec') || { id: '' }).id.replace(/^sec-/, '');
    list.querySelectorAll('.toc-link.on').forEach(b => b.classList.remove('on'));
    const b = id && list.querySelector(`[data-go="${CSS.escape(id)}"]`);
    if (b) { b.classList.add('on'); if (S.view === 'notes') { const r = b.getBoundingClientRect(), lr = list.getBoundingClientRect(); if (r.top < lr.top || r.bottom > lr.bottom) b.scrollIntoView({ block: 'nearest' }); } }
  }
  { let raf = 0; $('sheetWrap').addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (S.view === 'notes') markReading(); }); }, { passive: true }); }

  function sectionHtml(c, s, d, secs) {
    const tag = ['h2', 'h3', 'h4', 'h4', 'h4'][Math.min(d, 4)];
    const recent = (s.updatedAt || 0) > Date.now() - 86400000;
    const badge = s.source === 'claude' && recent ? `<span class="tag">${esc((s.rev || 1) > 1 ? t('Updated by Claude {when}', { when: ago(s.updatedAt) }) : t('Saved by Claude {when}', { when: ago(s.updatedAt) }))}</span>`
      : (s.rev || 1) > 1 && recent ? `<span class="tag plain">${esc(t('Edited {when}', { when: ago(s.updatedAt) }))}</span>` : '';
    const crumb = S.search ? crumbs(secs, s.id) : [];
    let body;
    if (S.editing === s.id) {
      body = `<form class="edit" data-edit="${esc(s.id)}" dir="${UIDIR}">
        <input name="title" value="${esc(s.title)}" maxlength="200" dir="auto" aria-label="${esc(t('Title'))}" required>
        <textarea name="content" dir="auto" aria-label="${esc(t('Notes'))}">${esc(s.content)}</textarea>
        <p class="hint">${t('Markdown: **bold**, - lists, tables. Math: \\( x^2 \\) in a line, $$ x^2 $$ on its own line.')}</p>
        <div class="row"><button class="btn primary" type="submit">${t('Save changes')}</button><button class="btn ghost" type="button" data-act="cancel-edit">${t('Cancel')}</button></div>
      </form>`;
    } else body = `<div class="note" data-note="${esc(s.id)}"></div>`;
    const confirm = S.confirmDel === s.id ? `<div class="confirm" role="alert" dir="${UIDIR}"><span>${esc(kids(secs, s.id).length ? t('Delete “{title}” and everything under it? This can’t be undone.', { title: s.title }) : t('Delete “{title}”? This can’t be undone.', { title: s.title }))}</span><button class="btn danger solid" type="button" data-act="do-delete" data-id="${esc(s.id)}">${t('Delete')}</button><button class="btn ghost" type="button" data-act="cancel-delete">${t('Keep it')}</button></div>` : '';
    return `<section class="sec d${Math.min(d, 4)}${S.flash.has(s.id) ? ' flash' : ''}" id="sec-${esc(s.id)}">
      ${crumb.length ? `<div class="crumb" dir="auto">${crumb.map(esc).join(' › ')}</div>` : ''}
      <div class="sec-head"><${tag} dir="auto"><span class="title-mark">${esc(s.title)}</span></${tag}>${badge}
        <span class="sec-tools" dir="${UIDIR}">
          <button type="button" data-act="edit" data-id="${esc(s.id)}">${t('Edit')}</button>
          ${s.prevContent != null ? `<button type="button" data-act="undo" data-id="${esc(s.id)}" title="${esc(t('Go back to the version before the last change'))}">${t('Undo last change')}</button>` : ''}
          ${d === 0 ? `<button type="button" data-act="add-sub" data-id="${esc(s.id)}">${t('Add sub-topic')}</button>` : ''}
          <button type="button" class="danger" data-act="delete" data-id="${esc(s.id)}">${t('Delete')}</button>
        </span></div>
      ${confirm}${body}</section>`;
  }

  function renderSheet() {
    const sheet = $('sheet'); const c = course();
    sheet.dataset.paper = (c && S.view === 'notes' && c.paper) || 'plain'; sheet.dataset.width = (c && c.width) || 'normal';
    if (!c) {
      sheet.setAttribute('dir', UIDIR);
      sheet.innerHTML = `<div class="empty"><h2>${t('Start your first notebook')}</h2><p>${t('Create a course, then study it with Claude. Claude saves the final explanations here, topic by topic.')}</p><button class="btn primary" type="button" data-act="new-course">${t('Create a course')}</button></div>`;
      return;
    }
    const secs = sections(c.id);
    if (S.view === 'lecture') { const l = lectures(c.id).find(x => x.id === S.lecture); if (l) { renderLecture(sheet, c, l, secs); return; } S.view = 'notes'; }
    if (S.view === 'practice') {
      renderPractice(sheet, c, secs);
      sheet.querySelectorAll('.prac-bar').forEach(n => n.remove());
      sheet.insertAdjacentHTML('afterbegin', `<div class="prac-bar"><button type="button" class="sn-x" data-act="back-notes" aria-label="${esc(t('Close'))}"><svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" style="display:block;margin:auto"><path d="M5 5l14 14M19 5 5 19" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg></button></div>`);
      return;
    }
    if (S.view === 'formulas') { renderFormulas(sheet, c, secs); return; }
    sheet.setAttribute('dir', dirOf(c));
    const list = []; walk(secs, (s, d) => list.push([s, d]));
    if (!list.length) {
      const num = courseNum(c);
      const say = c.lang === 'he' ? `“תשמור את מה שלמדנו ב-Study Notebook, בקורס ${num || c.name}”` : `“Save what we covered in Study Notebook, course ${num || c.name}”`;
      sheet.setAttribute('dir', UIDIR);
      sheet.innerHTML = `<div class="empty"><h2>${t('This notebook is empty')}</h2>
        <p>${esc(t('Open the Claude desktop app and study a topic from {course}: ask questions until it makes sense. Then say:', { course: c.name }))}</p>
        <p class="say" dir="auto">${esc(say)}</p>
        <p class="small">${esc(t('Claude saves the final explanation here, under the right topic.'))}</p>
        ${lastClaude() ? `<button class="btn primary" type="button" data-act="auto-save">${t('Set up auto-saving for this course')}</button>` : `<button class="btn primary" type="button" data-act="settings">${t('Connect to Claude')}</button>`}</div>`;
      return;
    }
    const q = norm(S.search);
    const shown = q ? list.filter(([s]) => norm(s.title).includes(q) || norm(s.content).includes(q)) : list;
    if (q && !shown.length) { sheet.setAttribute('dir', UIDIR); sheet.innerHTML = `<div class="empty"><h2>${esc(t('Nothing matches “{q}”', { q: S.search }))}</h2><p>${t('Try a different word, or search all courses with Ctrl+K.')}</p><button class="btn" type="button" data-act="clear-search">${t('Clear search')}</button></div>`; return; }
    sheet.innerHTML = shown.map(([s, d]) => sectionHtml(c, s, q ? Math.min(d, 1) : d, secs)).join('');
    fillNotes(sheet, secs, q);
  }
  // Fills in the notes inside root, reusing what's already drawn and drawing only new math.
  function fillNotes(root, secs, q) {
    const fresh = [];
    root.querySelectorAll('[data-note]').forEach(el => {
      const s = secs[el.dataset.note], key = drawnKey(s);
      if (!q && drawn.has(key)) { el.innerHTML = drawn.get(key); wireLinks(el); return; }
      el.innerHTML = mdToHtml(s.content); decorate(el); highlight(el, q);
      if (hasMath(el)) fresh.push([el, key]); else if (!q) drawn.set(key, el.innerHTML);
    });
    const heads = [...root.querySelectorAll('.sec-head')].filter(hasMath);
    const pending = fresh.map(x => x[0]).concat(heads);
    S.drawing = pending.length ? typeset(pending).then(() => { if (!q) for (const [el, key] of fresh) if (el.isConnected && !hasMath(el)) drawn.set(key, el.innerHTML); }) : Promise.resolve();
    if (drawn.size > 3000) drawn.clear();
  }

  /* ---------- lecture page ---------- */
  function renderLecture(sheet, c, l, secs) {
    const mins = Math.round((l.durationSec || 0) / 60);
    const len = mins >= 60 ? t('{h} h {m} min', { h: Math.floor(mins / 60), m: mins % 60 }) : t('{m} min', { m: mins });
    const LN = { he: 'Hebrew', en: 'English', ar: 'Arabic', auto: 'Mixed' };
    const tag = l.status === 'recording' ? `<span class="tag rec-tag">${t('Recording now')}</span>` : l.notesAt ? `<span class="tag">${esc(t('Notes made by Claude {when}', { when: ago(l.notesAt) }))}</span>` : l.status === 'stopped' ? `<span class="tag plain">${t('Stopped early')}</span>` : `<span class="tag plain">${t('No notes yet')}</span>`;
    const made = (l.sections || []).map(id => secs[id]).filter(Boolean);
    const paras = String(l.text || '').split(/\n\n+/).filter(Boolean).map(p => { const m = p.match(/^\[(\d+:\d+(?::\d+)?)\]\s*([\s\S]*)$/); return m ? `<p data-ts="${parseTs(m[1])}"><span class="ts">${esc(m[1])}</span>${esc(m[2])}</p>` : `<p>${esc(p)}</p>`; }).join('');
    sheet.setAttribute('dir', UIDIR);
    sheet.innerHTML = `<div class="lec">
      <button class="text-btn back" type="button" data-act="back-notes">${t('← Back to notes')}</button>
      ${S.renamingLec ? `<form class="edit" id="lecRename"><input name="title" value="${esc(l.title)}" maxlength="120" dir="auto" required><div class="row"><button class="btn primary" type="submit">${t('Save name')}</button><button class="btn ghost" type="button" data-act="cancel-rename">${t('Cancel')}</button></div></form>`
        : `<div class="sec-head"><h2 dir="auto">${esc(l.title)}</h2>${tag}</div>`}
      <p class="lec-meta">${esc(t('Recorded {date}. {len}. {lang}.', { date: new Date(l.startedAt || 0).toLocaleString(LOCALE, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }), len, lang: t(LN[l.lang] || 'Mixed') }))}</p>
      ${l.status !== 'recording' ? `<div class="ask"><p>${l.notesAt ? t('To update the notes from this lecture, tell Claude in the Claude app:') : t('To turn this lecture into notes, tell Claude in the Claude app:')}</p><p class="say-box" dir="auto">${esc(askClaude(c.id, l.id))}</p><button class="btn primary" type="button" data-act="copy-ask">${t('Copy')}</button></div>` : ''}
      ${made.length ? `<div class="made"><p>${t('Notes from this lecture')}</p><ul>${made.map(s => `<li><button type="button" class="sn-link" data-go-sec="${esc(s.id)}" dir="auto">${esc(s.title)}</button></li>`).join('')}</ul></div>` : ''}
      <div class="row lec-tools"><button class="btn" type="button" data-act="rename-lec">${t('Rename')}</button><button class="btn" type="button" data-act="export-lec" ${l.text ? '' : 'disabled'}>${t('Export transcript')}</button><button class="btn danger" type="button" data-act="delete-lec" ${l.status === 'recording' ? 'disabled' : ''}>${t('Delete recording')}</button></div>
      ${S.confirmLec ? `<div class="confirm" role="alert"><span>${t('Delete this recording and its transcript? Notes Claude already made stay in the notebook.')}</span><button class="btn danger solid" type="button" data-act="do-delete-lec">${t('Delete')}</button><button class="btn ghost" type="button" data-act="cancel-delete-lec">${t('Keep it')}</button></div>` : ''}
      <h3 class="lec-tr-h">${t('Transcript')}</h3>
      <div class="transcript" dir="${dirFor(l.lang)}">${paras || `<p class="small">${t('No speech recognized yet.')}</p>`}</div>
    </div>`;
    const f = sheet.querySelector('#lecRename');
    if (f) { const i = f.title; i.focus(); i.select(); f.onsubmit = e => { e.preventDefault(); const v = i.value.trim(); if (!v) return; docs[lecPath(c.id, l.id)] = { ...docs[lecPath(c.id, l.id)], title: v.slice(0, 120) }; save(); S.renamingLec = false; render(); }; }
    if (S.lecAt != null) {
      const at = S.lecAt; S.lecAt = null;
      const ps = [...sheet.querySelectorAll('.transcript p[data-ts]')];
      let target = ps[0]; for (const p of ps) if (+p.dataset.ts <= at + 2) target = p;
      if (target) requestAnimationFrame(() => { target.scrollIntoView({ block: 'center', behavior: 'smooth' }); target.classList.add('hit'); setTimeout(() => target.classList.remove('hit'), 3000); });
    }
  }
  function openLectureAt(ref) {
    const m = String(ref).match(/^([A-Za-z0-9_-]{1,64})(?:@([\d:]+))?$/);
    if (!m) return;
    for (const c of courses()) {
      if (lectures(c.id).some(l => l.id === m[1])) {
        if (S.courseId !== c.id) { S.courseId = c.id; store('sn-course', c.id); }
        S.view = 'lecture'; S.lecture = m[1]; S.lecAt = m[2] ? parseTs(m[2]) : null; S.search = '';
        render(); $('sheetWrap').scrollTop = 0; return;
      }
    }
    toast(t('That lecture recording is no longer in the notebook.'));
  }

  /* ---------- practice ---------- */
  // Spaced repetition (a simplified SM-2): grade 0 again, 1 hard, 2 good, 3 easy.
  function schedule(srs, g, now) {
    let { ivl = 0, ease = 2.5, reps = 0, lapses = 0 } = srs || {};
    if (g === 0) return { ivl: 0, ease: Math.max(1.3, ease - 0.2), reps: 0, lapses: lapses + 1, due: now + 10 * 60000 };
    if (g === 1) { ivl = reps ? Math.max(1, ivl * 1.2) : 0.5; ease = Math.max(1.3, ease - 0.15); }
    else if (g === 2) ivl = reps === 0 ? 1 : reps === 1 ? 3 : ivl * ease;
    else { ivl = reps === 0 ? 3 : reps === 1 ? 6 : ivl * ease * 1.3; ease += 0.15; }
    ivl = Math.min(ivl, 365);
    return { ivl, ease, reps: reps + 1, lapses, due: now + ivl * 86400000 };
  }
  const ivlLabel = ivl => ivl <= 0 ? t('10 min') : ivl < 1 ? t('12 h') : ivl < 30 ? tn(Math.round(ivl), '1 day', '{n} days') : tn(Math.round(ivl / 30), '1 month', '{n} months');

  function pracPool(c, secs) {
    const all = cards(c.id), now = Date.now();
    let pool = all;
    if (S.pracTopic) pool = pool.filter(k => k.topicId && rootOf(secs, k.topicId) && rootOf(secs, k.topicId).id === S.pracTopic);
    if (S.pracMode === 'due') pool = pool.filter(k => !k.srs || k.srs.due <= now);
    if (S.pracMode === 'mistakes') pool = pool.filter(k => (k.hist || []).slice(-3).some(h => !h.ok));
    return pool;
  }
  /* ---------- exam date, countdown and today's plan ---------- */
  function daysTo(dateStr) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || '')) return null;
    const [y, m, d] = dateStr.split('-').map(Number); const now = new Date();
    return Math.round((new Date(y, m - 1, d) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  }
  const fmtDay = ds => { const [y, m, d] = ds.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric', month: 'short' }); };
  function examChip(c) {
    const n = daysTo(c.examDate); if (n == null || n < 0) return '';
    const txt = n === 0 ? t('Exam today') : n === 1 ? t('Exam tomorrow') : t('Exam in {n} days', { n });
    return ` <button type="button" class="exam-chip${n <= 3 ? ' soon' : ''}" data-act="exam-date" title="${esc(fmtDay(c.examDate))}">${esc(txt)}</button>`;
  }
  function openExamDate(c) {
    const today = new Date(); const min = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    openDlg('exam', `<form class="dlg-in" id="exForm">${head(esc(t('Exam date for “{course}”', { course: c.name })), esc(t('The app counts down and plans what to review each day so every topic is covered in time.')))}
      <label class="field">${t('Exam date')}<input type="date" id="exDate" required min="${min}" value="${esc(c.examDate || '')}"></label>
      <div class="row"><button class="btn primary" type="submit">${t('Save')}</button>${c.examDate ? `<button class="btn ghost" type="button" id="exClear">${t('Remove date')}</button>` : ''}<button class="btn ghost" type="button" data-close>${t('Cancel')}</button></div></form>`, d => {
      const setDate = v => { const cur = docs[coursePath(c.id)] || {}; const next = { ...cur }; if (v) next.examDate = v; else delete next.examDate; docs[coursePath(c.id)] = next; save(); dlg.close(); render(); };
      d.querySelector('#exForm').onsubmit = e => { e.preventDefault(); const v = d.querySelector('#exDate').value; if (daysTo(v) == null || daysTo(v) < 0) return; setDate(v); toast(t('Exam date saved')); };
      const cl = d.querySelector('#exClear'); if (cl) cl.onclick = () => { setDate(''); toast(t('Exam date removed')); };
    });
  }
  // Spreads the topics that are new or weak over the days left, keeping the last 2 days for a full review.
  function todayPlan(c, secs) {
    const n = daysTo(c.examDate); if (n == null || n < 0) return null;
    const all = cards(c.id), now = Date.now();
    const topics = kids(secs, null).map(r => {
      const ks = all.filter(k => k.topicId && rootOf(secs, k.topicId) && rootOf(secs, k.topicId).id === r.id);
      const hist = ks.flatMap(k => k.hist || []);
      const acc = hist.length ? hist.filter(h => h.ok).length / hist.length : null;
      return { r, n: ks.length, acc, status: !hist.length ? 'new' : acc < 0.7 ? 'weak' : 'ok' };
    });
    const todo = topics.filter(x => x.status !== 'ok').sort((a, b) => (a.status === b.status ? (a.acc || 0) - (b.acc || 0) : a.status === 'new' ? -1 : 1));
    const studyDays = Math.max(1, n - 2);
    const today = n <= 2 ? [] : todo.slice(0, Math.max(1, Math.ceil(todo.length / studyDays)));
    return { days: n, today, left: todo.length, due: all.filter(k => !k.srs || k.srs.due <= now).length, final: n <= 2 };
  }
  function planPanel(c, secs) {
    const p = todayPlan(c, secs);
    if (!p) return `<div class="plan plan-empty"><div><b>${t('Have an exam coming up?')}</b><p class="small">${t('Set its date and the app plans what to review each day.')}</p></div><button class="btn" type="button" data-act="exam-date">${t('Set exam date')}</button></div>`;
    const head = p.days === 0 ? t('Exam today') : p.days === 1 ? t('Exam tomorrow') : t('Exam in {n} days', { n: p.days });
    const rows = [];
    if (p.due) rows.push(`<li><span><b>${esc(tn(p.due, 'Review 1 due question', 'Review {n} due questions'))}</b><small>${t('Spaced repetition: these are due now.')}</small></span><button class="btn" type="button" data-act="plan-due">${t('Start')}</button></li>`);
    for (const x of p.today) rows.push(`<li><span><b dir="auto">${esc(x.r.title)}</b><small>${x.status === 'new' ? (x.n ? t('Not practiced yet') : t('No questions yet: the app makes them')) : esc(t('{p}% right so far', { p: Math.round(x.acc * 100) }))}</small></span><button class="btn" type="button" data-act="plan-topic" data-id="${esc(x.r.id)}">${t('Practice')}</button></li>`);
    if (p.final) rows.push(`<li><span><b>${t('Final review')}</b><small>${t('Read the formula sheet, then practice everything once more.')}</small></span><span class="row"><button class="btn" type="button" data-act="formulas">${t('Formula sheet')}</button><button class="btn" type="button" data-act="plan-all">${t('Practice all')}</button></span></li>`);
    if (!rows.length) rows.push(`<li><span><b>${t('All caught up for today')}</b><small>${t('Every topic is practiced. Come back tomorrow for what’s due.')}</small></span></li>`);
    return `<div class="plan"><div class="plan-head"><div><span class="plan-days">${esc(head)}</span><span class="small"> · ${esc(fmtDay(c.examDate))}${p.final ? '' : ' · ' + esc(tn(p.left, '1 topic left to cover', '{n} topics left to cover'))}</span></div><button type="button" class="sn-link" data-act="exam-date">${t('Change')}</button></div>
      <h3>${t('Today')}</h3><ul class="plan-list">${rows.join('')}</ul></div>`;
  }
  // The date-due slip beside the page: days already reviewed (stamped), today's cards, what comes next, the exam.
  function renderSlip() {
    const el = $('slip'), c = course();
    const show = !!c && children(c.id, 'sections').length > 0;
    el.hidden = !show; $('main').querySelector('.body').classList.toggle('no-slip', !show);
    if (!show) { el.innerHTML = ''; return; }
    const all = cards(c.id), now = Date.now(), DAY = 86400000;
    const dayOf = ts => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return +d; };
    const today = dayOf(now), when = ts => new Date(ts).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' });
    const hist = all.flatMap(k => k.hist || []).map(h => h.t);
    const past = [...new Set(hist.filter(x => x < today && x > today - 21 * DAY).map(dayOf))].sort((a, b) => a - b).slice(-2);
    const stamp = `<span class="stamp">${t('Reviewed')}</span>`;
    const due = all.filter(k => !k.srs || k.srs.due <= now).length;
    const secs = sections(c.id), next = new Map();
    for (const k of all) if (k.srs && k.srs.due >= today + DAY) {
      const d = dayOf(k.srs.due), r = k.topicId && rootOf(secs, k.topicId), e = next.get(d) || { n: 0, topics: new Set() };
      e.n++; if (r) e.topics.add(r.title); next.set(d, e);
    }
    const rows = past.map(d => `<tr><td>${esc(when(d))}</td><td>${stamp}</td></tr>`);
    rows.push(`<tr><td>${t('Today')}</td><td>${due ? esc(tn(due, '1 card · {m} min', '{n} cards · {m} min', { m: Math.max(1, Math.round(due * 0.75)) })) : hist.some(x => x >= today) ? stamp : `<span class="later">${t('Nothing due')}</span>`}</td></tr>`);
    for (const [d, e] of [...next].sort((a, b) => a[0] - b[0]).slice(0, 2)) rows.push(`<tr><td>${esc(when(d))}</td><td class="later" dir="auto">${esc(e.topics.size ? [...e.topics].slice(0, 2).join(', ') : tn(e.n, '1 card', '{n} cards'))}</td></tr>`);
    const n = daysTo(c.examDate);
    const exam = n == null || n < 0 ? `<button type="button" class="sn-link" data-act="exam-date">${t('Set exam date')}</button>`
      : `<div class="exam">${t('Exam')}<b>${esc(new Date(c.examDate + 'T12:00').toLocaleDateString(LOCALE, { day: 'numeric', month: 'long' }))} · ${esc(n === 0 ? t('today') : tn(n, '1 day', '{n} days'))}</b></div>`;
    el.setAttribute('dir', UIDIR);
    el.innerHTML = `<h2>${t('Date due')}</h2><p class="sub">${t('This course’s review slip')}</p>
      ${all.length ? `<table>${rows.join('')}</table>` : `<p class="small">${t('Practice cards appear here once the app makes questions for your topics.')}</p>`}
      ${due ? `<button class="btn primary" type="button" data-act="slip-review">${t('Review today’s cards')}</button>` : ''}${exam}
      ${window.StudyTimer ? `<p class="slip-study">${esc(t('Studied today: {a}', { a: window.StudyTimer.today() }))}</p>` : ''}`;
  }
  function planTopic(c, secs, id) {
    S.pracTopic = id; S.pracMode = 'all';
    if (pracPool(c, secs).length) startPractice(c, secs); else { S.genType = 'mixed'; makeQuestions(c, secs); }
  }

  /* ---------- formula sheet ---------- */
  function formulaItems(c, secs) {
    const list = []; walk(secs, (s, d) => list.push({ id: s.id, title: s.title, depth: d, content: s.content }));
    return window.PracticeGen ? window.PracticeGen.formulaSheet(list, dirOf(c) === 'rtl' ? 'he' : 'en') : [];
  }
  function renderFormulas(sheet, c, secs) {
    const items = formulaItems(c, secs);
    sheet.setAttribute('dir', dirOf(c));
    sheet.innerHTML = `<div class="fs-top" dir="${UIDIR}"><div><h2>${t('Formula sheet')}</h2><p class="small">${t('Definitions, claims and formulas from your notes, on as few pages as possible.')}</p></div>
        <div class="row">${WEB ? '' : `<button class="btn primary" type="button" data-act="print-formulas">${t('Print / PDF')}</button>`}<button class="btn ghost" type="button" data-act="back-notes">${t('← Back to notes')}</button></div></div>
      ${items.length ? `<div class="fsheet">${items.map(x => `<div class="fs-item d${Math.min(x.depth, 2)}"><div class="fs-title" dir="auto">${esc(x.title)}</div>${x.md ? `<div class="note fs-note" data-fs="${esc(x.id)}"></div>` : ''}</div>`).join('')}</div>`
        : `<div class="empty"><p>${t('No definitions or formulas found yet. They appear here as your notes grow.')}</p></div>`}`;
    const byId = Object.fromEntries(items.map(x => [x.id, x]));
    sheet.querySelectorAll('[data-fs]').forEach(el => { el.innerHTML = mdToHtml(byId[el.dataset.fs].md); decorate(el); });
    typeset(sheet);
  }

  // Make new practice questions from the notes, here in the app (no Claude needed).
  function genBox(c, secs, first) {
    const roots = kids(secs, null);
    const types = [['mixed', t('Mixed')], ['flash', t('Flashcards')], ['fill', t('Fill in the blank')], ['choice', t('Multiple choice')]];
    return `<div class="gen">
      <div><h3>${first ? t('Make questions from your notes') : t('Make new questions')}</h3><p class="small">${t('Pick a type and the app writes questions from your notes, right here. No Claude needed.')}</p></div>
      <div class="seg" role="group" aria-label="${esc(t('Question type'))}">${types.map(([k, l]) => `<button type="button" data-gtype="${k}" aria-pressed="${S.genType === k}">${l}</button>`).join('')}</div>
      ${first ? `<label class="field">${t('Topic')}<select id="pracTopic" dir="auto"><option value="">${t('All topics')}</option>${roots.map(r => `<option value="${esc(r.id)}"${S.pracTopic === r.id ? ' selected' : ''}>${esc(r.title)}</option>`).join('')}</select></label>` : ''}
      <button class="btn primary big" type="button" data-act="gen-make" ${roots.length ? '' : 'disabled'}>${roots.length ? (S.pracTopic && secs[S.pracTopic] ? t('Make questions on this topic') : t('Make questions')) : t('Add notes first')}</button>
    </div>`;
  }
  // Saves generated questions as practice cards; returns the new card ids.
  function addGenerated(c, items) {
    const byTopic = {}; for (const it of items) (byTopic[it.topic_section_id] = byTopic[it.topic_section_id] || []).push(it);
    const ids = [];
    for (const [sid, group] of Object.entries(byTopic)) {
      try {
        const { writes } = Ops.run(docs, 'save_practice', { course: c.id, topic_section_id: sid, items: group.map(({ topic_section_id, ...x }) => x) });
        for (const w of writes) { docs[w.path] = { ...w.data, source: 'app' }; ids.push(w.path.split('/').pop()); }
      } catch (e) { /* a group that can't be saved is skipped */ }
    }
    return ids;
  }
  // New topics from Claude get 2–4 practice questions right away, made here (instant, no waiting for Claude).
  function autoPractice(cid, sectionIds) {
    const c = courses().find(x => x.id === cid); if (!c || !window.PracticeGen || !sectionIds.length) return 0;
    const secs = sections(cid); const all = cards(cid);
    const has = new Set(all.map(k => k.topicId).filter(Boolean));
    const existing = new Set(all.map(k => String(k.q || '').toLowerCase().replace(/[*_`>#]/g, '').replace(/\s+/g, ' ').trim()));
    const items = [];
    for (const id of new Set(sectionIds)) {
      if (!secs[id] || has.has(id)) continue;
      items.push(...window.PracticeGen.generate({ sections: [secs[id]], lang: dirOf(c) === 'rtl' ? 'he' : 'en', type: 'mixed', limit: 3, existing }));
    }
    return items.length ? addGenerated(c, items).length : 0;
  }

  function makeQuestions(c, secs) {
    if (!window.PracticeGen) return;
    const inTopic = S.pracTopic && secs[S.pracTopic] ? new Set(subtree(secs, S.pracTopic)) : null;
    const list = Object.values(secs).filter(s => !inTopic || inTopic.has(s.id));
    const existing = new Set(cards(c.id).map(k => String(k.q || '').toLowerCase().replace(/[*_`>#]/g, '').replace(/\s+/g, ' ').trim()));
    const items = window.PracticeGen.generate({ sections: list, lang: dirOf(c) === 'rtl' ? 'he' : 'en', type: S.genType, limit: 15, existing });
    if (!items.length) { toast(t('No new questions to make from these notes. Ask Claude for more, or add notes with definitions and key terms in bold.')); return; }
    const ids = addGenerated(c, items);
    if (!ids.length) { toast(t('No new questions to make from these notes. Ask Claude for more, or add notes with definitions and key terms in bold.')); return; }
    save();
    toast(tn(ids.length, 'Made 1 question from your notes', 'Made {n} questions from your notes'));
    S.prac = { ids: ids.sort(() => Math.random() - 0.5), i: 0, shown: false, chosen: null, order: null, right: 0, wrong: [] };
    renderSide(); renderTop(); renderSheet(); $('sheetWrap').scrollTop = 0;
  }

  function startPractice(c, secs) {
    const pool = pracPool(c, secs).slice().sort((a, b) => ((a.srs && a.srs.due) || 0) - ((b.srs && b.srs.due) || 0));
    if (!pool.length) return;
    const order = S.pracMode === 'due' ? pool.slice(0, 50) : pool.sort(() => Math.random() - 0.5).slice(0, 50);
    S.prac = { ids: order.map(k => k.id), i: 0, shown: false, chosen: null, order: null, right: 0, wrong: [] };
    renderSheet(); $('sheetWrap').scrollTop = 0;
  }
  function grade(c, k, g) {
    const now = Date.now();
    const p = cardPath(c.id, k.id); const d = docs[p]; if (!d) return;
    const ok = g > 0;
    docs[p] = { ...d, srs: schedule(d.srs, g, now), hist: [...(d.hist || []), { t: now, ok }].slice(-30) };
    save();
    if (ok) S.prac.right++; else S.prac.wrong.push(k.id);
    S.prac.i++; S.prac.shown = false; S.prac.chosen = null; S.prac.order = null;
    renderSheet(); renderSide(); renderTop();
  }

  function renderPractice(sheet, c, secs) {
    sheet.setAttribute('dir', UIDIR);
    const all = cards(c.id);
    const he = dirOf(c) === 'rtl';
    if (!all.length) {
      sheet.innerHTML = `<div class="prac"><div class="prac-head"><h2>${t('Practice')}</h2><p>${esc(t('Make questions from your notes, then practice them with spaced repetition.'))}</p></div>${planPanel(c, secs)}${genBox(c, secs, true)}
        <div class="ask"><p>${t('The app also makes questions by itself for each new topic Claude saves. For harder ones, ask Claude in any chat, for example:')}</p><p class="say-box" dir="auto">${esc(askPractice(c))}</p><button class="btn" type="button" data-act="copy-prac">${t('Copy')}</button></div></div>`;
      const ps = sheet.querySelector('#pracTopic'); if (ps) ps.onchange = e => { S.pracTopic = e.target.value; renderSheet(); };
      return;
    }
    const P = S.prac;
    if (P && P.i < P.ids.length) return renderCard(sheet, c, secs, P);
    if (P && P.i >= P.ids.length) {
      const total = P.ids.length;
      sheet.innerHTML = `<div class="prac-done"><h2>${esc(t('You got {right} of {total} right', { right: P.right, total }))}</h2>
        <div class="score"><i style="width:${Math.round(100 * P.right / Math.max(1, total))}%"></i></div>
        <p class="small">${P.wrong.length ? t('The ones you missed come back in 10 minutes, and more often until you know them.') : t('Well done. These come back later, spaced out so you keep remembering them.')}</p>
        <div class="row">${P.wrong.length ? `<button class="btn primary" type="button" data-act="prac-retry">${esc(tn(P.wrong.length, 'Practice the 1 you missed', 'Practice the {n} you missed'))}</button>` : ''}<button class="btn" type="button" data-act="prac-home">${t('Back to practice')}</button><button class="text-btn" type="button" data-act="back-notes">${t('← Back to notes')}</button></div></div>`;
      return;
    }
    // overview
    const now = Date.now();
    const roots = kids(secs, null);
    const stats = roots.map(r => {
      const ks = all.filter(k => k.topicId && rootOf(secs, k.topicId) && rootOf(secs, k.topicId).id === r.id);
      const hist = ks.flatMap(k => k.hist || []);
      return { r, n: ks.length, due: ks.filter(k => !k.srs || k.srs.due <= now).length, acc: hist.length ? hist.filter(h => h.ok).length / hist.length : null };
    });
    const loose = all.filter(k => !k.topicId || !rootOf(secs, k.topicId));
    const pool = pracPool(c, secs);
    const due = all.filter(k => !k.srs || k.srs.due <= now).length;
    sheet.innerHTML = `<div class="prac">
      <div class="prac-head"><h2>${t('Practice')}</h2><p>${esc(t('{n} questions and flashcards, {due} due now', { n: all.length, due }))}</p></div>
      ${planPanel(c, secs)}
      <div class="prac-start">
        <div class="seg" role="group" aria-label="${esc(t('What to practice'))}">
          <button type="button" data-pmode="due" aria-pressed="${S.pracMode === 'due'}">${t('Due now')}</button>
          <button type="button" data-pmode="all" aria-pressed="${S.pracMode === 'all'}">${t('Everything')}</button>
          <button type="button" data-pmode="mistakes" aria-pressed="${S.pracMode === 'mistakes'}">${t('My mistakes')}</button>
        </div>
        <label class="field">${t('Topic')}<select id="pracTopic" dir="auto"><option value="">${t('All topics')}</option>${roots.map(r => `<option value="${esc(r.id)}"${S.pracTopic === r.id ? ' selected' : ''}>${esc(r.title)}</option>`).join('')}</select></label>
        <button class="btn primary big" type="button" data-act="prac-start" ${pool.length ? '' : 'disabled'}>${pool.length ? esc(tn(Math.min(pool.length, 50), 'Start: 1 question', 'Start: {n} questions')) : esc(S.pracMode === 'due' ? t('Nothing due right now') : t('Nothing to practice here'))}</button>
      </div>
      ${genBox(c, secs, false)}
      <h3>${t('By topic')}</h3>
      <ul class="topic-stats" dir="${dirOf(c)}">${stats.map(s => `<li><button type="button" class="ts-row" data-ptopic="${esc(s.r.id)}"><span class="ts-title" dir="auto">${esc(s.r.title)}</span><span class="ts-bar" title="${esc(s.acc == null ? t('Not practiced yet') : t('{p}% right', { p: Math.round(s.acc * 100) }))}"><i class="${s.acc == null ? 'none' : s.acc < 0.6 ? 'low' : s.acc < 0.85 ? 'mid' : 'high'}" style="width:${s.acc == null ? 0 : Math.round(s.acc * 100)}%"></i></span><small dir="${UIDIR}">${s.n ? esc(s.acc == null ? tn(s.n, '1 item, not practiced yet', '{n} items, not practiced yet') : t('{n} items, {p}% right', { n: s.n, p: Math.round(s.acc * 100) })) : esc(t('No questions yet'))}</small></button></li>`).join('')}${loose.length ? `<li><span class="ts-row"><span class="ts-title">${t('Other')}</span><span></span><small>${esc(tn(loose.length, '1 item', '{n} items'))}</small></span></li>` : ''}</ul>
      <div class="ask"><p>${t('Want more questions, or questions on a weak topic? Tell Claude in the Claude app:')}</p><p class="say-box" dir="auto">${esc(askPractice(c, S.pracTopic && secs[S.pracTopic] ? secs[S.pracTopic].title : ''))}</p><button class="btn" type="button" data-act="copy-prac">${t('Copy')}</button></div>
    </div>`;
    sheet.querySelector('#pracTopic').onchange = e => { S.pracTopic = e.target.value; renderSheet(); };
    void he;
  }

  function renderCard(sheet, c, secs, P) {
    const k = cards(c.id).find(x => x.id === P.ids[P.i]);
    if (!k) { P.i++; return renderSheet(); }
    const topic = k.topicId && secs[k.topicId] ? secs[k.topicId].title : '';
    const kindName = { flash: t('Flashcard'), choice: t('Multiple choice'), open: t('Open question') }[k.kind] || '';
    let answerArea = '';
    if (k.kind === 'choice') {
      if (!P.order) P.order = k.choices.map((_, i) => i).sort(() => Math.random() - 0.5);
      answerArea = `<ol class="choices" dir="${dirOf(c)}">${P.order.map((ci, n) => {
        const st = P.chosen == null ? '' : ci === k.correct ? ' right' : ci === P.chosen ? ' wrong' : ' dim';
        return `<li><button type="button" class="choice${st}" data-choice="${ci}" ${P.chosen == null ? '' : 'disabled'}><span class="key">${n + 1}</span><span class="md" data-md="${esc(k.choices[ci])}"></span></button></li>`;
      }).join('')}</ol>`;
      if (P.chosen != null) {
        const ok = P.chosen === k.correct;
        answerArea += `<div class="verdict ${ok ? 'ok' : 'bad'}">${ok ? t('Correct') : t('Not quite. The right answer is marked.')}</div>
          ${k.explain || k.a ? `<div class="answer note" dir="${dirOf(c)}"><div class="md" data-md="${esc(k.explain || k.a)}"></div></div>` : ''}
          <div class="row"><button class="btn primary" type="button" data-grade="${ok ? 2 : 0}" autofocus>${t('Next')}</button></div>`;
      }
    } else if (!P.shown) {
      answerArea = `<div class="row"><button class="btn primary big" type="button" data-act="show-answer">${t('Show answer')}</button><span class="small">${t('Space')}</span></div>`;
    } else {
      const now = Date.now();
      answerArea = `<div class="answer note" dir="${dirOf(c)}"><div class="md" data-md="${esc(k.a)}"></div>${k.explain ? `<div class="md explain" data-md="${esc(k.explain)}"></div>` : ''}</div>
        <p class="small">${t('How well did you know it?')}</p>
        <div class="grades">${[[0, 'Again'], [1, 'Hard'], [2, 'Good'], [3, 'Easy']].map(([g, name]) => `<button type="button" class="grade g${g}" data-grade="${g}"><b>${t(name)}</b><small>${esc(ivlLabel(schedule(k.srs, g, now).ivl))}</small><span class="key">${g + 1}</span></button>`).join('')}</div>`;
    }
    sheet.innerHTML = `<div class="card-view">
      <div class="card-top"><button class="text-btn" type="button" data-act="prac-home">${t('← End practice')}</button><span class="progress">${esc(t('{i} of {n}', { i: P.i + 1, n: P.ids.length }))}</span></div>
      <div class="pbar"><i style="width:${Math.round(100 * P.i / P.ids.length)}%"></i></div>
      <div class="card" dir="${dirOf(c)}">
        <div class="card-meta" dir="${UIDIR}"><span class="tag plain">${esc(kindName)}</span>${topic ? `<span dir="auto">${esc(topic)}</span>` : ''}</div>
        <div class="q note"><div class="md" data-md="${esc(k.q)}"></div></div>
      </div>
      ${answerArea}
    </div>`;
    sheet.querySelectorAll('[data-md]').forEach(el => { el.innerHTML = mdToHtml(el.dataset.md); decorate(el); });
    typeset(sheet);
    const first = sheet.querySelector('[data-grade][autofocus], [data-act="show-answer"]'); if (first) first.focus();
  }

  // Redraws just one section in place (e.g. after Claude updates it), instead of the whole page.
  function patchSection(c, id) {
    if (S.view !== 'notes' || S.search || S.editing || S.confirmDel) return false;
    const old = document.getElementById('sec-' + id); const secs = sections(c.id); const s = secs[id];
    if (!old || !s) return false;
    let d = 0, p = s; while (p.parentId && secs[p.parentId] && d < 10) { p = secs[p.parentId]; d++; }
    const tmp = document.createElement('div'); tmp.innerHTML = sectionHtml(c, s, d, secs);
    const el = tmp.firstElementChild; if (!el || el.id !== 'sec-' + id) return false;
    old.replaceWith(el); fillNotes(el, secs, '');
    return true;
  }

  function flash(id) {
    S.flash.add(id); setTimeout(() => { S.flash.delete(id); }, 2500);
    const el = document.getElementById('sec-' + id);
    if (el) { el.classList.add('flash'); requestAnimationFrame(() => el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })); }
  }
  function goTo(id) {
    const el = document.getElementById('sec-' + id); if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 2500);
  }

  /* ================= actions ================= */
  function deleteCourse(id) {
    const kept = removeDocs(p => p === coursePath(id) || p.startsWith(coursePath(id) + '/'));
    save(); S.courseId = ''; selectCourse(courses()[0] ? courses()[0].id : '');
    undoable(t('Course deleted'), kept, () => selectCourse(id));
  }
  function addSection(parentId) {
    const c = course(); if (!c) return;
    const secs = sections(c.id); const sibs = kids(secs, parentId || null); const now = Date.now();
    const s = { id: rid('s'), title: parentId ? t('New sub-topic') : t('New topic'), content: t('Write your notes here.'), parentId: parentId || null, order: sibs.length ? Math.max(...sibs.map(x => x.order || 0)) + 1 : 1, rev: 1, createdAt: now, updatedAt: now, prevTitle: null, prevContent: null, source: 'me' };
    putSection(c.id, s); S.view = 'notes'; S.editing = s.id; S.search = ''; render(); flash(s.id);
    setTimeout(() => { const i = document.querySelector('form.edit input'); if (i) { i.focus(); i.select(); } }, 60);
  }
  function exportMd() {
    const c = course(); if (!c) return;
    const secs = sections(c.id);
    let md = `# ${c.name}\n\n`;
    walk(secs, (s, d) => { md += `${'#'.repeat(Math.min(d + 2, 6))} ${s.title}\n\n${s.content}\n\n`; });
    D.saveFile((c.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'notes') + '.md', md).then(r => { if (r && r.ok) toast(t('Exported')); });
  }
  const showView = v => { S.view = v; S.editing = S.confirmDel = null; S.confirmLec = S.renamingLec = false; renderTop(); renderContents(); renderSheet(); $('sheetWrap').scrollTop = 0; };

  document.addEventListener('click', e => {
    const courseBtn = e.target.closest('[data-course]'); if (courseBtn) { selectCourse(courseBtn.dataset.course); return; }
    const lec = e.target.closest('[data-lecture]'); if (lec) { S.lecture = lec.dataset.lecture; showView('lecture'); return; }
    const gs = e.target.closest('[data-go-sec]'); if (gs) { showView('notes'); goTo(gs.dataset.goSec); return; }
    const go = e.target.closest('[data-go]'); if (go) { if (S.view !== 'notes' || S.search) { S.search = ''; showView('notes'); } goTo(go.dataset.go); return; }
    const tog = e.target.closest('[data-tog]'); if (tog) { const id = tog.dataset.tog; S.collapsed.has(id) ? S.collapsed.delete(id) : S.collapsed.add(id); renderContents(); return; }
    const pm = e.target.closest('[data-pmode]'); if (pm) { S.pracMode = pm.dataset.pmode; renderSheet(); return; }
    const gt = e.target.closest('[data-gtype]'); if (gt) { S.genType = gt.dataset.gtype; renderSheet(); return; }
    const pt = e.target.closest('[data-ptopic]'); if (pt) { S.pracTopic = pt.dataset.ptopic; S.pracMode = 'all'; renderSheet(); return; }
    const ch = e.target.closest('[data-choice]'); if (ch && S.prac) { S.prac.chosen = +ch.dataset.choice; renderSheet(); return; }
    const gr = e.target.closest('[data-grade]'); if (gr && S.prac) { const c = course(); const k = cards(c.id).find(x => x.id === S.prac.ids[S.prac.i]); if (k) grade(c, k, +gr.dataset.grade); return; }
    if (S.menu && !e.target.closest('.menu-wrap')) { S.menu = false; renderTop(); }
    if (e.target.closest('#moreBtn')) { S.menu = !S.menu; renderTop(); return; }
    if (e.target.closest('#printBtn')) { if (window.openPrint) window.openPrint(); return; }
    if (e.target.closest('#recBtn')) { if (window.openRecorder) window.openRecorder(); return; }
    if (e.target.closest('#pracBtn')) { if (S.view === 'practice' && !S.prac) showView('notes'); else { S.prac = null; showView('practice'); } return; }
    const b = e.target.closest('[data-act]'); if (!b) return;
    const c = course(); const id = b.dataset.id;
    const secs = c ? sections(c.id) : {};
    switch (b.dataset.act) {
      case 'new-course': openNewCourse(); break;
      case 'settings': openSettings(); break;
      case 'clear-search': S.search = ''; render(); break;
      case 'edit': S.editing = id; S.confirmDel = null; renderSheet(); setTimeout(() => { const ta = document.querySelector('form.edit textarea'); if (ta) ta.focus(); }, 30); break;
      case 'cancel-edit': S.editing = null; renderSheet(); break;
      case 'delete': S.confirmDel = id; S.editing = null; renderSheet(); break;
      case 'cancel-delete': S.confirmDel = null; renderSheet(); break;
      case 'do-delete': { const gone = new Set(subtree(secs, id).map(sid => secPath(c.id, sid))); const kept = removeDocs(p => gone.has(p)); S.confirmDel = null; save(); render(); undoable(t('Section deleted'), kept, () => { render(); flash(id); }); break; }
      case 'undo': {
        const s = secs[id]; if (!s || s.prevContent == null) break;
        putSection(c.id, { ...s, title: s.prevTitle || s.title, content: s.prevContent, prevTitle: s.title, prevContent: s.content, rev: (s.rev || 1) + 1, updatedAt: Date.now(), source: 'me' });
        render(); flash(id); toast(t('Went back to the previous version. Press “Undo last change” again to switch back.')); break;
      }
      case 'add-sub': addSection(id); break;
      case 'add-topic': S.menu = false; addSection(null); break;
      case 'export-md': S.menu = false; renderTop(); exportMd(); break;
      case 'course-settings': S.menu = false; renderTop(); openCourseSettings(); break;
      case 'auto-save': S.menu = false; renderTop(); openAutoSave(c); break;
      case 'formulas': S.menu = false; showView('formulas'); break;
      case 'exam-date': S.menu = false; renderTop(); openExamDate(c); break;
      case 'print-formulas': if (window.openPrint) window.openPrint('__formulas'); break;
      case 'plan-topic': planTopic(c, secs, b.dataset.id); break;
      case 'plan-due': S.pracTopic = ''; S.pracMode = 'due'; startPractice(c, secs); break;
      case 'slip-review': S.pracTopic = ''; S.pracMode = 'due'; S.prac = null; showView('practice'); startPractice(c, secs); break;
      case 'plan-all': S.pracTopic = ''; S.pracMode = 'all'; startPractice(c, secs); break;
      case 'delete-course': S.menu = false; renderTop(); openDeleteCourse(); break;
      case 'back-notes': S.prac = null; showView('notes'); break;
      case 'copy-ask': copy(askClaude(c.id, S.lecture)); break;
      case 'copy-prac': copy(askPractice(c, S.pracTopic && secs[S.pracTopic] ? secs[S.pracTopic].title : '')); break;
      case 'rename-lec': S.renamingLec = true; renderSheet(); break;
      case 'cancel-rename': S.renamingLec = false; renderSheet(); break;
      case 'delete-lec': S.confirmLec = true; renderSheet(); break;
      case 'cancel-delete-lec': S.confirmLec = false; renderSheet(); break;
      case 'do-delete-lec': { const lp = lecPath(c.id, S.lecture), lid = S.lecture; const kept = removeDocs(p => p === lp); save(); S.confirmLec = false; S.lecture = null; showView('notes'); renderSide(); undoable(t('Recording deleted'), kept, () => { S.lecture = lid; showView('lecture'); renderSide(); }); break; }
      case 'export-lec': { const l = lectures(c.id).find(x => x.id === S.lecture); if (l) D.saveFile((l.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'lecture') + '.txt', `${l.title}\n\n${l.text || ''}\n`).then(r => { if (r && r.ok) toast(t('Exported')); }); break; }
      case 'prac-start': startPractice(c, secs); break;
      case 'gen-make': makeQuestions(c, secs); break;
      case 'prac-home': S.prac = null; renderSheet(); break;
      case 'prac-retry': { const ids = S.prac.wrong.slice(); S.prac = { ids, i: 0, shown: false, chosen: null, order: null, right: 0, wrong: [] }; renderSheet(); break; }
      case 'show-answer': if (S.prac) { S.prac.shown = true; renderSheet(); } break;
    }
  });
  document.addEventListener('submit', e => {
    const f = e.target.closest('form.edit[data-edit]'); if (!f) return;
    e.preventDefault();
    const c = course(); const s = c && sections(c.id)[f.dataset.edit]; if (!s) return;
    const title = f.title.value.trim().replace(/\s+/g, ' ').slice(0, 200), content = f.content.value;
    if (!title) return;
    if (title !== s.title || content !== s.content) putSection(c.id, { ...s, title, content, prevTitle: s.title, prevContent: s.content, rev: (s.rev || 1) + 1, updatedAt: Date.now(), source: 'me' });
    S.editing = null; render(); toast(t('Changes saved'));
  });
  /* ---------- moving volumes on the shelf ----------
     Drag a course up or down (mouse: just drag; touch: hold, then drag; keyboard: Alt+↑/↓).
     The new order is saved on each course, so it's the same on every device. */
  const shelf = $('courses');
  function saveShelfOrder() {
    const ids = [...shelf.querySelectorAll('.course')].map(b => b.dataset.course);
    let changed = false;
    ids.forEach((id, i) => { const d = docs[coursePath(id)]; if (d && d.order !== i) { docs[coursePath(id)] = { ...d, order: i }; changed = true; } });
    if (changed) save();
    renderSide();
  }
  let drag = null, eatClick = false;
  function dragMove(y) {
    const b = drag.btn, box = shelf.getBoundingClientRect();
    let before = null;
    for (const o of shelf.querySelectorAll('.course')) { if (o === b) continue; const r = o.getBoundingClientRect(); if (y < r.top + r.height / 2) { before = o; break; } }
    if (b.nextElementSibling !== before && before !== b) shelf.insertBefore(b, before);
    b.style.transform = 'none'; const top = b.getBoundingClientRect().top;
    b.style.transform = `translateY(${y - drag.grab - top}px)`;
    if (y < box.top + 36) shelf.scrollTop -= 10; else if (y > box.bottom - 36) shelf.scrollTop += 10;   // near an edge: scroll the shelf
  }
  function dragStart(e) {
    drag.active = true; S.dragging = true; drag.btn.classList.add('lifted'); shelf.classList.add('sorting');
    drag.grab = drag.y - drag.btn.getBoundingClientRect().top;
    try { drag.btn.setPointerCapture(drag.pid); } catch (er) {}
    if (navigator.vibrate && drag.touch) navigator.vibrate(12);
  }
  function dragEnd(commit) {
    if (!drag) return; clearTimeout(drag.timer);
    const was = drag.active, b = drag.btn; drag = null;
    if (!was) return;
    S.dragging = false; eatClick = true; setTimeout(() => { eatClick = false; }, 0);
    b.classList.remove('lifted'); b.style.transform = ''; shelf.classList.remove('sorting');
    if (commit) saveShelfOrder(); else renderSide();
  }
  shelf.addEventListener('pointerdown', e => {
    const b = e.target.closest('.course'); if (!b || e.button > 0) return;
    drag = { btn: b, pid: e.pointerId, x: e.clientX, y: e.clientY, touch: e.pointerType !== 'mouse', active: false };
    if (drag.touch) drag.timer = setTimeout(() => { if (drag && !drag.active) dragStart(); }, 380);   // hold to pick it up
  });
  shelf.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.pid) return;
    const far = Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
    if (!drag.active) {
      if (drag.touch) { if (far > 8) dragEnd(false); return; }   // a finger moving before the hold is a scroll
      if (far < 6) return; dragStart();
    }
    e.preventDefault(); dragMove(e.clientY);
  });
  shelf.addEventListener('pointerup', () => dragEnd(true));
  shelf.addEventListener('pointercancel', () => dragEnd(false));
  shelf.addEventListener('touchmove', e => { if (drag && drag.active) e.preventDefault(); }, { passive: false });
  // Right-click a book to edit that course (name, number, exam, colour, photo, page).
  shelf.addEventListener('contextmenu', e => { e.preventDefault(); if (drag) return; const b = e.target.closest('.course'); if (b) { selectCourse(b.dataset.course); openCourseSettings(); } });
  shelf.addEventListener('click', e => { if (eatClick) { e.stopPropagation(); e.preventDefault(); } }, true);
  shelf.addEventListener('keydown', e => {
    const b = e.target.closest('.course'); if (!b || !e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault(); e.stopPropagation();   // not the page's Alt+↑/↓ (next / previous topic)
    const sib = e.key === 'ArrowUp' ? b.previousElementSibling : b.nextElementSibling; if (!sib) return;
    shelf.insertBefore(b, e.key === 'ArrowUp' ? sib : sib.nextElementSibling);
    const id = b.dataset.course; saveShelfOrder();
    const again = shelf.querySelector(`[data-course="${CSS.escape(id)}"]`); if (again) again.focus();
  });

  // Phone: the course list slides in from the side, the topic list rises from the bottom.
  const scrim = document.createElement('div'); scrim.className = 'nav-scrim'; document.body.appendChild(scrim);
  function phonePanel(which) {
    document.body.classList.toggle('nav-open', which === 'nav');
    document.body.classList.toggle('toc-open', which === 'toc');
    const nb = $('navBtn'); if (nb) nb.setAttribute('aria-expanded', String(which === 'nav'));
    if (which === 'nav') { const cur = document.querySelector('.course[aria-current="true"]') || document.querySelector('.course'); if (cur) setTimeout(() => cur.focus({ preventScroll: true }), 50); }
  }
  scrim.addEventListener('click', () => phonePanel(null));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && (document.body.classList.contains('nav-open') || document.body.classList.contains('toc-open'))) phonePanel(null); });
  document.addEventListener('click', e => {
    if (e.target.closest('#navBtn')) { phonePanel(document.body.classList.contains('nav-open') ? null : 'nav'); return; }
    if (e.target.closest('#tocBtn')) { phonePanel(document.body.classList.contains('toc-open') ? null : 'toc'); return; }
    if (e.target.closest('.side .course, .side .new-course, .side .claude-pill, .side #settingsBtn, .side #searchAllBtn, .contents .toc-link')) setTimeout(() => phonePanel(null), 0);
  });
  $('newCourseBtn').addEventListener('click', openNewCourse);
  // Fold the shelf down to a strip of thin spines, and back.
  function paintFold() { const f = document.documentElement.getAttribute('data-shelf') === 'folded'; const b = $('foldBtn'); const label = f ? t('Unfold the shelf') : t('Fold the shelf'); b.title = label + ' (Ctrl+B)'; b.setAttribute('aria-label', label); b.setAttribute('aria-expanded', String(!f)); }
  function toggleFold() { const f = document.documentElement.getAttribute('data-shelf') !== 'folded'; if (f) document.documentElement.setAttribute('data-shelf', 'folded'); else document.documentElement.removeAttribute('data-shelf'); store('sn-shelf', f ? 'folded' : 'open'); paintFold(); }
  $('foldBtn').addEventListener('click', toggleFold); paintFold();
  document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b' && !e.target.closest('input, textarea, [contenteditable]')) { e.preventDefault(); toggleFold(); } });
  if (window.StudyTimer) window.StudyTimer.init({ t, tn, esc, toast, dir: UIDIR });
  window.__snSlip = () => renderSlip();
  syncTitleBar();
  $('settingsBtn').addEventListener('click', () => openSettings());
  $('claudePill').addEventListener('click', () => openSettings());
  $('searchAllBtn').addEventListener('click', () => openSearchAll());
  $('themeBtn').addEventListener('click', () => { const order = ['system', 'light', 'dark']; setTheme(order[(order.indexOf(theme()) + 1) % 3]); toast(t('Appearance: {name}', { name: t(THEME_NAME[theme()]) })); });
  document.addEventListener('keydown', e => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '');
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearchAll(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { const i = $('search'); if (i && !i.disabled) { e.preventDefault(); i.focus(); i.select(); } }
    if (e.key === 'Escape') { if (S.menu) { S.menu = false; renderTop(); } else if (S.editing && !document.querySelector('dialog[open]')) { S.editing = null; renderSheet(); } }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { const f = document.querySelector('form.edit'); if (f) f.requestSubmit(); }
    const open = document.querySelector('dialog[open]');
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && !open) {
      const k = e.key.toLowerCase();
      if (k === 'p') { e.preventDefault(); const b = $('printBtn'); if (b && !b.disabled && window.openPrint) window.openPrint(); return; }
      if (k === 'n') { e.preventDefault(); openNewCourse(); return; }
      if (k === 'e') { e.preventDefault(); if (S.view === 'practice' && !S.prac) showView('notes'); else { S.prac = null; showView('practice'); } return; }
    }
    if (e.key === '?' && !typing && !open) { e.preventDefault(); openShortcuts(); return; }
    // Alt + ↑ / ↓: previous / next topic
    if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && !typing && !open && S.view === 'notes') {
      e.preventDefault();
      const w = $('sheetWrap'), top = w.getBoundingClientRect().top + 12;
      const secsEls = [...$('sheet').querySelectorAll(':scope > .sec')];
      const cur = secsEls.findIndex(el => el.getBoundingClientRect().bottom > top);
      const next = e.key === 'ArrowDown' ? secsEls[Math.min(secsEls.length - 1, cur + 1)] : secsEls[Math.max(0, (secsEls[cur] && secsEls[cur].getBoundingClientRect().top < top - 4) ? cur : cur - 1)];
      if (next) next.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      return;
    }
    // practice keys
    if (S.view === 'practice' && S.prac && S.prac.i < S.prac.ids.length && !typing && !document.querySelector('dialog[open]')) {
      const c = course(); const k = c && cards(c.id).find(x => x.id === S.prac.ids[S.prac.i]); if (!k) return;
      if (k.kind === 'choice' && S.prac.chosen == null && /^[1-6]$/.test(e.key) && S.prac.order && +e.key <= S.prac.order.length) { S.prac.chosen = S.prac.order[+e.key - 1]; renderSheet(); e.preventDefault(); }
      else if (k.kind !== 'choice' && !S.prac.shown && (e.key === ' ' || e.key === 'Enter')) { S.prac.shown = true; renderSheet(); e.preventDefault(); }
      else if (k.kind !== 'choice' && S.prac.shown && /^[1-4]$/.test(e.key)) { grade(c, k, +e.key - 1); e.preventDefault(); }
    }
  });

  function openShortcuts() {
    const rows = [['Ctrl+K', t('Search all courses')], ['Ctrl+F', t('Search this course')], ['Ctrl+N', t('New course')], ['Ctrl+P', t('Print / PDF')], ['Ctrl+E', t('Practice')],
      ['Alt+↓ / Alt+↑', t('Next / previous topic')], ['Ctrl + / Ctrl −', t('Bigger / smaller text')], ['Ctrl+0', t('Normal text size')], ['Ctrl+Enter', t('Save changes')], ['Esc', t('Close')],
      ['Ctrl+B', t('Fold or unfold the shelf')], ['Alt+↑ / Alt+↓', t('On a course: move it on the shelf')],
      [t('Space, 1–4'), t('In practice: show the answer, then rate it')], ['?', t('This list')]];
    openDlg('keys', `<div class="dlg-in">${head(t('Keyboard shortcuts'))}<div class="keys">${rows.map(([k, l]) => `<div class="krow"><span>${esc(l)}</span><kbd dir="ltr">${esc(k)}</kbd></div>`).join('')}</div></div>`);
  }
  if (D.onTextSize) D.onTextSize(p => toast(t('Text size {p}%', { p })));

  /* ================= theme ================= */
  const THEME_NAME = { system: 'Automatic', light: 'Light', dark: 'Dark' };
  const THEME_ICON = {
    system: '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>',
    light: '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9 5.3 5.3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    dark: '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>'
  };
  const theme = () => document.documentElement.getAttribute('data-theme') || 'system';
  // How warm the paper, shelf and ink look; each student picks their own. Works in light and dark.
  const WARMTH = { neutral: ['Neutral', '#f1f1ef'], paper: ['Paper', '#f4efe5'], warm: ['Warm', '#f1e4cc'], sepia: ['Sepia', '#e9d5ad'] };
  const warmth = () => document.documentElement.getAttribute('data-warmth') || 'paper';
  function setWarmth(w) { document.documentElement.setAttribute('data-warmth', w); store('sn-warmth', w); syncTitleBar(); if (dlg && dlg.open && dlgKind === 'settings') renderSettings(); }
  // The window buttons Windows draws at the top right take the colour of the page behind them.
  function syncTitleBar() {
    if (!D.setTitleBar) return;
    requestAnimationFrame(() => {
      const hex = css => { const c = document.createElement('canvas').getContext('2d'); c.fillStyle = css; c.fillRect(0, 0, 1, 1); const [r, g, b] = c.getImageData(0, 0, 1, 1).data; return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join(''); };
      const st = getComputedStyle(document.body);
      D.setTitleBar(hex(st.backgroundColor), hex(st.color));
    });
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => syncTitleBar());
  function setTheme(th) { document.documentElement.setAttribute('data-theme', th); store('sn-theme', th); Promise.resolve(D.setTheme(th)).then(syncTitleBar); renderSide(); if (dlg && dlg.open && dlgKind === 'settings') renderSettings(); }

  /* ================= dialogs ================= */
  let dlg = null, dlgKind = '';
  function openDlg(kind, html, onOpen) {
    if (!dlg) { dlg = document.createElement('dialog'); dlg.className = 'dlg'; document.body.appendChild(dlg); dlg.addEventListener('scroll', e => { if (e.target.classList && e.target.classList.contains('dlg-in')) dlg.classList.toggle('scrolled', e.target.scrollTop > 4); }, true); dlg.addEventListener('close', () => { dlg.classList.remove('scrolled'); if (dlgKind === 'welcome') store('sn-welcomed', '1'); dlgKind = ''; D.getSettings().then(st => { S.settings = st; renderClaudePill(); if (S.view === 'notes') renderSheet(); }); }); }
    dlgKind = kind; dlg.innerHTML = html; dlg.classList.toggle('wide', kind === 'search'); dlg.classList.remove('scrolled');
    // Move the title and × out of the scrolling area.
    const top = dlg.querySelector('.dlg-in > .dlg-head:first-child'); if (top) { top.classList.add('dlg-top'); dlg.prepend(top); }
    dlg.querySelectorAll('[data-close]').forEach(x => x.onclick = () => dlg.close());
    if (!dlg.open) dlg.showModal();
    if (onOpen) onOpen(dlg);
  }
  const head = (title, sub) => `<div class="dlg-head"><div style="flex:1"><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div><button type="button" class="sn-x" data-close aria-label="${esc(t('Close'))}"><svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" style="display:block;margin:auto"><path d="M5 5l14 14M19 5 5 19" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg></button></div>`;
  const langSelect = (id, v) => `<select id="${id}"><option value="he"${v === 'he' ? ' selected' : ''}>${t('Hebrew')}</option><option value="en"${v === 'en' ? ' selected' : ''}>${t('English')}</option><option value="auto"${!v || v === 'auto' ? ' selected' : ''}>${t('Same as the course material')}</option></select>`;

  // The course form (new course and course details): name, number, language, exam, book colour, photo, page.
  const PAPERS = ['plain', 'lined', 'dotted', 'grid'], WIDTHS = ['narrow', 'normal', 'wide'];
  const segPick = (name, list, cur) => `<div class="seg" role="radiogroup">${list.map(v => `<label><input type="radio" name="${name}" value="${v}" ${v === cur ? 'checked' : ''}><span>${t(v[0].toUpperCase() + v.slice(1))}</span></label>`).join('')}</div>`;
  function courseForm(c, title, sub, go) {
    const color = c.color != null ? c.color : -1;
    return `<form class="dlg-in" id="cfForm">${head(title, sub)}
      <label class="field">${t('Course name')}<input id="cfName" required maxlength="80" value="${esc(c.name || '')}" placeholder="${esc(t('e.g. Probability for Statistics students'))}" dir="auto"></label>
      <div class="row two"><label class="field">${t('Course number')}<input id="cfNum" maxlength="8" inputmode="numeric" value="${esc(c.num || courseNum(c) || '')}" placeholder="52324" dir="ltr"></label>
        <label class="field">${t('Exam date (Moed A)')}<input id="cfExam" type="date" value="${esc(c.examDate || '')}"></label></div>
      <label class="field">${t('Notes language')}${langSelect('cfLang', c.lang || 'he')}</label>
      <div class="field">${t('Book colour')}<div class="swatches" role="radiogroup">${COVERS.map((col, i) => `<label style="--c:${col}"><input type="radio" name="cfColor" value="${i}" ${i === color ? 'checked' : ''} aria-label="${esc(t('Colour {n}', { n: i + 1 }))}"></label>`).join('')}</div></div>
      <div class="field">${t('Photo on the book')}<div class="row"><input type="file" id="cfPhoto" accept="image/*" hidden><button class="btn" type="button" id="cfPhotoBtn">${c.photo ? t('Change photo') : t('Choose a photo')}</button>${c.photo ? `<button class="btn ghost" type="button" id="cfPhotoX">${t('Remove photo')}</button>` : ''}</div></div>
      <div class="field">${t('Page')}${segPick('cfPaper', PAPERS, c.paper || 'plain')}</div>
      <div class="field">${t('Page width')}${segPick('cfWidth', WIDTHS, c.width || 'normal')}</div>
      <div class="row"><button class="btn primary" type="submit">${go}</button><button class="btn ghost" type="button" data-close>${t('Cancel')}</button></div></form>`;
  }
  // A photo becomes a small JPEG (fits on a book spine, keeps the notebook light).
  const shrink = f => new Promise((ok, no) => { const img = new Image(); img.onload = () => { const k = Math.min(1, 360 / Math.max(img.width, img.height)); const cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k); cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(img.src); ok(cv.toDataURL('image/jpeg', 0.78)); }; img.onerror = no; img.src = URL.createObjectURL(f); });
  function wireCourseForm(d, c, done) {
    let photo = c.photo || '';
    const pick = d.querySelector('#cfPhoto');
    d.querySelector('#cfPhotoBtn').onclick = () => pick.click();
    pick.onchange = async () => { const f = pick.files[0]; if (!f) return; try { photo = await shrink(f); d.querySelector('#cfPhotoBtn').textContent = t('Photo chosen'); } catch (e) { toast(t('Couldn’t read that image')); } };
    const x = d.querySelector('#cfPhotoX'); if (x) x.onclick = () => { photo = ''; x.remove(); };
    d.querySelector('#cfName').focus();
    d.querySelector('#cfForm').onsubmit = e => {
      e.preventDefault(); const q = sel => d.querySelector(sel);
      const name = q('#cfName').value.trim(); if (!name) return;
      const v = { name: name.slice(0, 80), lang: q('#cfLang').value, num: q('#cfNum').value.replace(/\D/g, '').slice(0, 8), examDate: q('#cfExam').value,
        paper: (q('[name=cfPaper]:checked') || {}).value || 'plain', width: (q('[name=cfWidth]:checked') || {}).value || 'normal', photo };
      const col = q('[name=cfColor]:checked'); if (col) v.color = +col.value;
      for (const k of ['num', 'examDate', 'photo']) if (!v[k]) v[k] = undefined;
      dlg.close(); done(v);
    };
  }
  function openNewCourse() {
    openDlg('new', courseForm({}, t('New course'), t('Claude will save this course’s notes in the language you choose.'), t('Create course')), d => wireCourseForm(d, {}, v => {
      const id = rid('c'); docs[coursePath(id)] = JSON.parse(JSON.stringify({ ...v, createdAt: Date.now(), chat: [], files: [], sourceParts: 0 })); save(); selectCourse(id); toast(t('Course created'));
    }));
  }
  // One-time setup per course: a Claude Project whose instructions send every chat's notes here.
  function autoSaveText(c) {
    const he = c.lang === 'he';
    return [
      `Study Notebook course: "${c.name}"`,
      ``,
      `In every chat in this project, use the Study Notebook tools and save what we study to the course "${c.name}" automatically, as we go, without asking me:`,
      `- The tools come from the Study Notebook connector; their names contain "study-notebook". If you don't see them, search your tools for "study-notebook" before telling me they're missing.`,
      `- When you finish explaining something, save the final, clear explanation under the right topic (update an existing section instead of adding a duplicate).`,
      `- When I ask about one part of something already saved, replace only that part with a deeper explanation (edit_part), not the whole section.`,
      `- Save notes from a PDF, slides or a lecture in one go (save_sections). The app makes the practice questions itself; write them only when I ask.`,
      `- Don't save anything I say not to save.`,
      `- After each save, tell me in one short line what was saved and where.`,
      he ? `- Write the notes in Hebrew, with formulas in Latin form.` : ''
    ].filter((x, i) => x !== '' || i === 1).join('\n');
  }
  function openAutoSave(c) {
    if (!c) return;
    const text = autoSaveText(c);
    openDlg('auto-save', `<div class="dlg-in">${head(esc(t('Auto-save Claude chats to “{course}”', { course: c.name })), esc(t('Set this up once. After that you just study, and the notes appear here by themselves.')))}
      <ol class="steps">
        <li><div><b>${esc(t('Create a project in the Claude app'))}</b><span>${esc(t('In the Claude desktop app, open Projects and create a new project. Name it “{course}”.', { course: c.name }))}</span></div></li>
        <li><div><b>${esc(t('Paste these instructions into the project'))}</b><span>${esc(t('Open the project’s instructions and paste this text. You only do this once.'))}</span></div></li>
        <li><div><b>${esc(t('Study in that project'))}</b><span>${esc(t('Start your chats inside the project. Claude saves the explanations here as you go, adds practice questions, and when you ask about one part, it deepens just that part. Say “don’t save this” to keep something out.'))}</span></div></li>
        <li><div><b>${esc(t('Use the Claude desktop app on this computer'))}</b><span>${esc(t('Start the chats in the Claude desktop app on this computer. Chats started on your phone or on the web can’t save to Study Notebook.'))}</span></div></li>
      </ol>
      <pre class="auto-text" dir="ltr">${esc(text)}</pre>
      <div class="row"><button class="btn primary" type="button" id="copyAuto">${t('Copy instructions')}</button><button class="btn ghost" type="button" data-close>${t('Done')}</button></div>
      <p class="small">${esc(t('Without a project, Claude still saves automatically, but it guesses the course from the subject or asks you once at the start of a chat.'))}</p></div>`, d => {
      d.querySelector('#copyAuto').onclick = () => copy(text, t('Instructions copied. Paste them into the Claude project.'));
    });
  }

  function openCourseSettings() {
    const c = course(); if (!c) return;
    openDlg('course', courseForm(c, t('Course details'), '', t('Save changes')), d => wireCourseForm(d, c, v => {
      docs[coursePath(c.id)] = JSON.parse(JSON.stringify({ ...docs[coursePath(c.id)], ...v })); save(); render(); toast(t('Changes saved'));
    }));
  }
  function openDeleteCourse() {
    const c = course(); if (!c) return;
    const n = children(c.id, 'sections').length;
    openDlg('delete', `<div class="dlg-in">${head(esc(t('Delete “{name}”?', { name: c.name })), esc(tn(n, 'This removes the course and its 1 section. You can undo it right after.', 'This removes the course and its {n} sections. You can undo it right after.')))}
      <div class="row"><button class="btn danger solid" type="button" id="dcYes">${t('Delete course')}</button><button class="btn ghost" type="button" data-close>${t('Keep it')}</button></div></div>`,
      d => { d.querySelector('#dcYes').onclick = () => { dlg.close(); deleteCourse(c.id); }; });
  }

  /* ---------- search all courses ---------- */
  function openSearchAll() {
    openDlg('search', `<div class="dlg-in">${head(t('Search all courses'))}
      <label class="search big"><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="m16 16 4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><input id="saInput" type="search" placeholder="${esc(t('Notes, lecture transcripts, practice questions…'))}" dir="auto"></label>
      <div class="sa-results" id="saResults"><p class="small">${t('Type at least 2 letters.')}</p></div></div>`, d => {
      const inp = d.querySelector('#saInput'), out = d.querySelector('#saResults');
      inp.focus();
      inp.oninput = () => { clearTimeout(inp._t); inp._t = setTimeout(() => runSearchAll(inp.value, out), 140); };
      out.onclick = e => {
        const r = e.target.closest('[data-hit]'); if (!r) return;
        const [kind, cid, id, at] = r.dataset.hit.split('|');
        dlg.close();
        if (S.courseId !== cid) { S.courseId = cid; store('sn-course', cid); }
        if (kind === 'sec') { S.search = ''; S.view = 'notes'; render(); goTo(id); }
        else if (kind === 'lec') { S.view = 'lecture'; S.lecture = id; S.lecAt = at ? +at : null; render(); }
        else { S.view = 'practice'; S.prac = { ids: [id], i: 0, shown: false, chosen: null, order: null, right: 0, wrong: [] }; render(); }
      };
    });
  }
  function runSearchAll(text, out) {
    const q = norm(text);
    if (q.length < 2) { out.innerHTML = `<p class="small">${t('Type at least 2 letters.')}</p>`; return; }
    const flat = str => String(str || '').replace(/\s+/g, ' ').trim();
    const find = str => flat(str).toLowerCase().indexOf(q);
    const snip = (str, i) => { const s = flat(str); const a = Math.max(0, i - 50); return (a ? '…' : '') + s.slice(a, i + q.length + 90) + (i + q.length + 90 < s.length ? '…' : ''); };
    const mark = s => esc(s).replace(new RegExp(esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), m => `<mark>${m}</mark>`);
    let html = '', total = 0;
    for (const c of courses()) {
      const hits = [];
      const secs = sections(c.id);
      for (const s of Object.values(secs)) {
        const it = norm(s.title).includes(q), i = find(s.content);
        if (it || i >= 0) hits.push(`<button type="button" class="sa-hit" data-hit="sec|${esc(c.id)}|${esc(s.id)}"><b dir="auto">${mark(s.title)}</b>${crumbs(secs, s.id).length ? `<small dir="auto">${esc(crumbs(secs, s.id).join(' › '))}</small>` : ''}${i >= 0 ? `<span dir="auto">${mark(snip(s.content, i))}</span>` : ''}</button>`);
      }
      for (const l of lectures(c.id)) {
        for (const p of String(l.text || '').split(/\n\n+/)) {
          const m = p.match(/^\[([\d:]+)\]/);
          const body = p.replace(/^\[[\d:]+\]\s*/, '');
          const i = find(body); if (i < 0) continue;
          hits.push(`<button type="button" class="sa-hit" data-hit="lec|${esc(c.id)}|${esc(l.id)}|${m ? parseTs(m[1]) : ''}"><b dir="auto">${esc(t('Lecture: {title}', { title: l.title }))}${m ? ` <span class="ts">${esc(m[1])}</span>` : ''}</b><span dir="auto">${mark(snip(body, i))}</span></button>`);
          if (hits.length > 60) break;
        }
      }
      for (const k of cards(c.id)) {
        const i = find(k.q); if (i < 0) continue;
        hits.push(`<button type="button" class="sa-hit" data-hit="card|${esc(c.id)}|${esc(k.id)}"><b>${t('Practice question')}</b><span dir="auto">${mark(snip(k.q, i))}</span></button>`);
      }
      if (hits.length) { total += hits.length; html += `<h3 dir="auto">${esc(c.name)} <small>${hits.length}</small></h3>${hits.slice(0, 30).join('')}`; }
    }
    out.innerHTML = total ? html : `<p class="small">${esc(t('Nothing matches “{q}” in any course.', { q: text }))}</p>`;
  }

  /* ---------- settings ---------- */
  /* ---------- connecting the Claude app ---------- */
  let claudeMsg = null;
  const claudeBox = () => `<div class="claude-setup" id="claudeSetup"><p class="small">${t('Checking…')}</p></div>`;
  async function drawClaude(d) {
    const box = d.querySelector('#claudeSetup'); if (!box) return;
    const st = await D.claudeStatus();
    const seen = Math.max(st.seen || 0, S.claudeSeen || 0, st.lastUse || 0);
    let html;
    if (seen && st.configured) {
      html = `<div class="cs-state ok"><span class="cs-ico">✓</span><div><b>${t('Connected to Claude')}</b><p>${esc(t('Claude can save notes to this notebook. Last contact {when}.', { when: ago(seen) }))}</p></div></div>
        <p class="small">${t('In the Claude app, study as usual. When you understand something, say “save this in Study Notebook”.')}</p>
        <p class="small">${esc(t('If Claude says it can’t find Study Notebook, start a new chat in the Claude desktop app, or tell it: “Search your tools for study-notebook”.'))}</p>`;
    } else if (!st.installed) {
      html = `<div class="cs-state"><span class="cs-ico">1</span><div><b>${t('Install the Claude desktop app')}</b><p>${t('Study Notebook works with the Claude app for Windows or Mac, with your normal Claude account.')}</p></div></div>
        <div class="row"><button class="btn primary" type="button" data-url="https://claude.ai/download">${t('Download the Claude app')}</button><button class="btn ghost" type="button" id="csRecheck">${t('I installed it')}</button></div>`;
    } else if (!st.configured) {
      html = `<div class="cs-state"><span class="cs-ico">1</span><div><b>${t('Connect Study Notebook to Claude')}</b><p>${t('One click. It adds Study Notebook to the Claude app’s settings.')}</p></div></div>
        <div class="row"><button class="btn primary big" type="button" id="csConnect">${t('Connect to Claude')}</button></div>`;
    } else {
      html = `<div class="cs-state wait"><span class="cs-ico">2</span><div><b>${st.running ? t('Restart the Claude app') : t('Open the Claude app')}</b><p>${st.running ? t('Claude reads its settings when it starts, so restart it once. Finish any message you’re writing in Claude first.') : t('Open the Claude app. It picks up Study Notebook when it starts.')}</p></div></div>
        <div class="row">${st.running ? `<button class="btn primary big" type="button" id="csRestart">${t('Restart Claude now')}</button>` : `<button class="btn primary big" type="button" id="csRestart">${t('Open Claude')}</button>`}</div>
        <p class="small">${t('This page turns green as soon as Claude connects. If it doesn’t within a minute, close Claude from the tray icon (right-click → Quit) and open it again.')}</p>`;
    }
    if (claudeMsg) html += `<p class="status ${claudeMsg.kind}">${claudeMsg.html}</p>`;
    html += `<details class="cs-more"><summary>${t('Other ways to connect')}</summary><p class="small">${t('You can also install Study Notebook as a Claude extension file. Open the file with the Claude app, or drag it into the Claude window.')}</p><button class="btn ghost" type="button" id="showMcpb">${t('Show the extension file')}</button>${st.configured ? ` <button class="btn ghost danger" type="button" id="csRemove">${t('Disconnect from Claude')}</button>` : ''}</details>`;
    box.innerHTML = html;
    box.querySelectorAll('[data-url]').forEach(x => x.onclick = () => D.openExternal(x.dataset.url));
    const q = id => box.querySelector(id);
    if (q('#csRecheck')) q('#csRecheck').onclick = () => { claudeMsg = null; drawClaude(d); };
    if (q('#csConnect')) q('#csConnect').onclick = async () => {
      q('#csConnect').disabled = true;
      const r = await D.claudeConnect();
      claudeMsg = r.ok ? null : { kind: 'bad', html: esc(t(r.message || 'Couldn’t update the Claude app’s settings.')) };
      drawClaude(d);
    };
    if (q('#csRestart')) q('#csRestart').onclick = async () => {
      q('#csRestart').disabled = true; q('#csRestart').textContent = t('Restarting Claude…');
      const r = await D.claudeRestart();
      claudeMsg = r.ok ? { kind: '', html: t('Claude is starting. This page updates when it connects.') } : { kind: 'bad', html: t('Couldn’t restart Claude automatically. Close it from the tray icon (right-click → Quit) and open it again.') };
      drawClaude(d);
      let n = 0; const poll = setInterval(async () => { n++; const s2 = await D.claudeStatus(); if (s2.seen > Date.now() - 120000 || n > 30 || !dlg.open) { clearInterval(poll); if (dlg.open) { claudeMsg = null; drawClaude(d); } } }, 2000);
    };
    if (q('#showMcpb')) q('#showMcpb').onclick = () => D.connectorReveal();
    if (q('#csRemove')) q('#csRemove').onclick = async () => { await D.claudeDisconnect(); claudeMsg = null; drawClaude(d); toast(t('Disconnected. Restart Claude to finish.')); };
  }
  function claudeSection() { return `<section class="group"><h3>${t('Claude app')}</h3><div class="box">${claudeBox()}</div></section>`; }
  function wireClaude(d) { drawClaude(d); }

  async function drawSpeech(d) {
    const st = await D.speechStatus();
    const box = d.querySelector('#speechBox'); if (!box) return;
    const ready = st.engineReady && (st.models.general || st.models.hebrew);
    const models = [st.models.hebrew ? t('Hebrew model') : '', st.models.general ? t('English, Arabic and mixed model') : ''].filter(Boolean).join(t(', '));
    box.innerHTML = !st.supported ? `<p class="small">${t('Recording lectures works on Windows for now.')}</p>`
      : `<p class="small" style="color:var(--ink);font-size:14px">${ready ? esc(t('Ready. Transcribes on your {device}, privately on this computer.', { device: st.gpu || t('processor') })) : t('Not set up yet. The first recording downloads the speech engine (about 2 GB, once).')}</p>
        ${ready ? `<p class="small">${esc(t('Downloaded: {models}. Using {gb} GB.', { models, gb: (st.bytes / 1e9).toFixed(1) }))}</p>
        <div class="row"><button class="btn ghost danger" type="button" id="rmSpeech">${t('Remove the speech engine')}</button></div>` : ''}`;
    const rm = box.querySelector('#rmSpeech');
    if (rm) rm.onclick = async () => { if (window.recorderState && window.recorderState().active) { toast(t('Stop the recording first')); return; } if (!confirm(t('Remove the speech engine and models from this computer? Recordings and notes are kept. The next recording downloads it again.'))) return; await D.speechRemove(); drawSpeech(d); toast(t('Speech engine removed')); };
  }
  function drawUpdates(d) {
    const box = d.querySelector('#updBox'); if (!box || !D.updateStatus) return;
    D.updateStatus().then(u => renderUpdBox(box, u));
  }
  function renderUpdBox(box, u) {
    {
      if (!u.enabled) { box.innerHTML = `<p class="small">${esc(t('Version {v}.', { v: (S.settings && S.settings.version) || '' }))} ${t('Automatic updates aren’t set up for this copy.')}</p>`; return; }
      if (u.state === 'available') { box.innerHTML = `<p class="small" id="updLine"></p><div class="bar"><i id="updBar" style="width:0%"></i></div>`; showUpdProgress(u); return; }
      const line = u.state === 'ready' ? t('Version {v} is ready.', { v: u.version }) : u.state === 'checking' ? t('Checking for updates…') : u.state === 'error' ? t('Couldn’t check for updates. Try again later.') : t('You have the latest version ({v}).', { v: u.current });
      box.innerHTML = `<p class="small">${esc(line)}</p><div class="row">${u.state === 'ready' ? `<button class="btn primary" type="button" id="updNow">${t('Restart and update')}</button>` : u.state === 'checking' ? '' : `<button class="btn" type="button" id="updCheck">${t('Check for updates')}</button>`}</div>`;
      const now = box.querySelector('#updNow'); if (now) now.onclick = () => installUpdate();
      const ck = box.querySelector('#updCheck'); if (ck) ck.onclick = () => { renderUpdBox(box, { ...u, state: 'checking' }); D.updateCheck(); };
    }
  }

  // "Downloading version 1.4.1: 34 of 110 MB, about 1 min left"
  const mb = b => (b / 1e6).toFixed(b < 1e7 ? 1 : 0);
  function updText(u) {
    const total = u.total || u.size;
    let txt;
    if (!u.done || !total) txt = u.size ? t('Version {v} is downloading ({size} MB)…', { v: u.version, size: mb(u.size) }) : t('Version {v} is downloading…', { v: u.version });
    else {
      const left = u.bps > 0 ? (total - u.done) / u.bps : 0;
      const when = !left ? '' : left < 60 ? t('less than a minute left') : t('about {m} min left', { m: Math.ceil(left / 60) });
      txt = t('Downloading version {v}: {done} of {total} MB', { v: u.version, done: mb(u.done), total: mb(total) }) + (when ? ', ' + when : '');
      if (u.size && u.total && u.total < u.size * 0.9) txt += '. ' + t('Only the changed parts are downloaded.');
    }
    return txt;
  }
  const updPct = u => { const total = u.total || u.size; return total ? Math.min(100, Math.round(100 * (u.done || 0) / total)) : 0; };
  function showUpdProgress(u) {
    const line = document.getElementById('updLine'), bar = document.getElementById('updBar'); if (!line) return;
    line.textContent = updText(u);
    if (bar) bar.style.width = updPct(u) + '%';
  }
  // A notice in the corner of the window: while a new version downloads, and again when it's ready to install.
  // "Hide" / "Later" put it away for that version; the sidebar button stays until the restart.
  // A notice in the corner of the window as soon as a new version is out ("Update now" or "Later").
  // It downloads in the background either way; "Update now" restarts as soon as the download is done.
  // "Later" puts it away for that version until the download is ready; the sidebar button stays.
  const updHidden = { available: '', ready: '' };
  function updNotice(u) {
    let el = document.getElementById('updNote');
    const show = u && (u.state === 'available' || u.state === 'ready') && u.version && updHidden[u.state] !== u.version;
    if (!show) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.id = 'updNote'; el.className = 'upd-note'; el.setAttribute('role', 'status'); el.dir = UIDIR; document.body.appendChild(el); }
    const kind = u.state === 'ready' ? 'ready' : u.installWhenReady ? 'going' : 'out';
    if (el.dataset.kind !== kind || el.dataset.v !== u.version) {
      el.dataset.kind = kind; el.dataset.v = u.version;
      const btns = kind === 'going' ? '' : `<div class="row"><button class="btn primary" type="button" data-upd="install">${esc(kind === 'ready' ? t('Restart now') : t('Update now'))}</button><button class="btn ghost" type="button" data-upd="later">${esc(t('Later'))}</button></div>`;
      el.innerHTML = kind === 'ready'
        ? `<span class="upd-ico" aria-hidden="true">↻</span><div><b>${esc(t('Version {v} is ready', { v: u.version }))}</b><p>${esc(t('Restart the app to update. It takes a few seconds, and your notes are saved first.'))}</p>${btns}</div>`
        : kind === 'going'
          ? `<span class="upd-ico" aria-hidden="true">↓</span><div><b>${esc(t('Updating to version {v}', { v: u.version }))}</b><p id="updNoteLine"></p><div class="bar"><i id="updNoteBar"></i></div><p>${esc(t('The app restarts by itself when the download is done.'))}</p></div>`
          : `<span class="upd-ico" aria-hidden="true">↓</span><div><b>${esc(t('Version {v} is out', { v: u.version }))}</b><p>${esc(t('Update now, or keep studying: it downloads in the background and installs when you close the app.'))}</p>${btns}</div>`;
      const later = el.querySelector('[data-upd="later"]'); if (later) later.onclick = () => { updHidden[u.state] = u.version; el.remove(); };
      const go = el.querySelector('[data-upd="install"]'); if (go) go.onclick = () => installUpdate();
    }
    if (kind === 'going') { el.querySelector('#updNoteLine').textContent = updText(u); el.querySelector('#updNoteBar').style.width = updPct(u) + '%'; }
  }
  // Live: Settings follows the update by itself (checking → downloading → ready), and a button
  // in the sidebar offers the restart as soon as the download is done.
  if (D.onUpdateProgress) D.onUpdateProgress(p => {
    const box = document.getElementById('updBox');
    if (box) { if (p.state === 'available' && document.getElementById('updLine')) showUpdProgress(p); else renderUpdBox(box, { enabled: true, ...p }); }
    showUpdReady(p.state === 'ready' || p.state === 'available' ? p : null);
    updNotice(p);
  });
  async function installUpdate() {
    if (window.recorderState && window.recorderState().active) { toast(t('Stop the recording first, then restart to update.')); return; }
    await saveNow();
    const u = D.updateStatus ? await D.updateStatus() : null;
    if (!u || u.state === 'ready') toast(t('Updating… Study Notebook will open again in a moment.'));
    setTimeout(() => D.updateInstall(), 600);
  }
  function showUpdReady(u) {
    let b = document.getElementById('updReady');
    if (!u || !u.version) { if (b) b.remove(); return; }
    if (!b) {
      b = document.createElement('button'); b.type = 'button'; b.id = 'updReady'; b.className = 'upd-ready';
      b.onclick = () => installUpdate();
      const foot = document.querySelector('.side-foot'); if (foot) foot.prepend(b);
    }
    const v = u.version;
    b.innerHTML = u.state === 'ready' ? `<span class="upd-ico" aria-hidden="true">↻</span><span><b>${esc(t('Update ready'))}</b>${esc(t('Restart to use version {v}', { v }))}</span>`
      : `<span class="upd-ico" aria-hidden="true">↓</span><span><b>${esc(t('Update available'))}</b>${esc(u.installWhenReady ? t('Downloading version {v}…', { v }) : t('Version {v} is out', { v }))}</span>`;
  }
  if (D.updateStatus) D.updateStatus().then(u => { if (u && (u.state === 'ready' || u.state === 'available')) { showUpdReady(u); updNotice(u); } }).catch(() => {});

  /* ---------- online notebook: use Study Notebook in any Claude chat ---------- */
  const DOC_RX = /^data\/users\/local\/[A-Za-z0-9_-]{1,64}(\/(sections|sources|lectures|cards)\/[A-Za-z0-9_-]{1,64})?$/;
  async function applyCloud(changes) {
    try {
      if (!Array.isArray(changes)) throw new Error('bad');
      let notes = 0; const fresh = {};
      for (const c of changes) {
        if (!c || !DOC_RX.test(c.path) || (c.data !== null && (typeof c.data !== 'object' || Array.isArray(c.data)))) continue;
        const isNew = c.data && !docs[c.path] && c.data.source === 'claude' && c.path.includes('/sections/');
        if (c.data === null) delete docs[c.path]; else docs[c.path] = c.data;
        if (isNew) { const parts = c.path.split('/'); (fresh[parts[3]] = fresh[parts[3]] || []).push(parts[5]); }
        if (c.path.includes('/sections/') || c.path.includes('/cards/')) notes++;
      }
      for (const [cid, ids] of Object.entries(fresh)) autoPractice(cid, ids);
      dirty = true; await saveNow();
      if (!S.editing && !(S.view === 'practice' && S.prac)) render(); else { renderSide(); renderContents(); }
      if (notes) toast(tn(notes, '1 change came in from your online notebook', '{n} changes came in from your online notebook'));
      return { ok: true, result: { applied: changes.length } };
    } catch (e) { return { ok: false, error: 'Couldn’t apply the online changes.' }; }
  }
  let cloudState = null;
  if (D.onCloudStatus) D.onCloudStatus(s => { cloudState = s; const box = document.getElementById('cloudBox'); if (box && !box.dataset.busy) paintCloud(box); });
  async function drawCloud(d) {
    const box = d.querySelector('#cloudBox'); if (!box || !D.cloudStatus) return;
    cloudState = await D.cloudStatus(); paintCloud(box);
  }
  // Your account: signed in with Google, the notebook is online, on the web, and Claude can use it in any chat.
  function paintCloud(box) {
    const s = cloudState || {};
    if (s.enabled && s.email) {
      const when = s.syncing ? t('Syncing…') : s.lastSync ? t('Last synced {when}', { when: ago(s.lastSync) }) : t('Not synced yet');
      const who = s.name ? `${esc(s.name)}<span class="cs-sub">${esc(s.email)}</span>` : esc(s.email);
      const site = (s.mcp || '').replace(/\/mcp$/, '');
      box.innerHTML = `<div class="cs-state ${s.error ? '' : 'ok'}"><span class="cs-ico">${s.error ? '!' : '✓'}</span><div><b>${who}</b><p>${esc(s.error ? t(s.error) : WEB ? t('Your notes are saved online and sync with the app on your computer.') : when)}</p></div></div>
        ${s.claude ? `<p class="small">${t('Claude is connected: in any chat (web, phone or desktop) it saves to this notebook.')}</p>`
          : `<p class="small">${t('To use your notebook in any Claude chat (web, phone or desktop): in Claude open Customize → Connectors → Add custom connector, paste this address, press Add, then Connect and sign in with Google.')}</p>`}
        <div class="row"><code class="path" dir="ltr">${esc(s.mcp || '')}</code><button class="btn" type="button" id="cloudCopy">${t('Copy address')}</button></div>
        <div class="row">${WEB ? '' : `<button class="btn" type="button" id="cloudNow">${t('Sync now')}</button><button class="btn" type="button" id="cloudWeb">${t('Open on the web')}</button>`}<button class="btn" type="button" id="cloudAcct">${t('Your account')}</button><button class="btn ghost" type="button" id="cloudOff">${t('Sign out')}</button></div>`;
      box.querySelector('#cloudCopy').onclick = () => copy(s.mcp, t('Address copied. Paste it in Claude → Customize → Connectors.'));
      if (box.querySelector('#cloudNow')) box.querySelector('#cloudNow').onclick = () => D.cloudSync();
      if (box.querySelector('#cloudWeb')) box.querySelector('#cloudWeb').onclick = () => D.openExternal(site + '/app/');
      box.querySelector('#cloudAcct').onclick = () => D.openExternal(site + '/account');
      box.querySelector('#cloudOff').onclick = async () => {
        if (!WEB && !confirm(t('Sign out on this computer? Your notes stay here and in your account; they just stop syncing until you sign in again.'))) return;
        await D.cloudDisconnect(); if (WEB) return; cloudState = await D.cloudStatus(); paintCloud(box);
      };
      return;
    }
    if (!D.cloudSignIn) { box.innerHTML = `<p class="small">${t('Checking…')}</p>`; return; }
    box.innerHTML = `<p class="small" style="color:var(--ink)">${t('Sign in with Google to use your notebook in any Claude chat, on your phone and on the web. The notes on this computer are copied to your account and kept in sync.')}</p>
      ${s.url && !s.email ? `<p class="small">${t('This app was connected to an online notebook with a password. That way of connecting has been replaced: sign in with Google instead.')}</p>` : ''}
      <p class="status" id="cloudMsg" role="status"></p>
      <div class="row"><button class="btn primary big google-btn" type="button" id="cloudGoogle"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>${t('Sign in with Google')}</button></div>`;
    box.querySelector('#cloudGoogle').onclick = async () => {
      const msg = box.querySelector('#cloudMsg'), btn = box.querySelector('#cloudGoogle');
      btn.disabled = true; box.dataset.busy = '1'; msg.className = 'status'; msg.textContent = t('Finish signing in in your browser. This page updates by itself.');
      const r = await D.cloudSignIn();
      delete box.dataset.busy; btn.disabled = false;
      if (!r.ok) { msg.className = 'status bad'; msg.textContent = t(r.message || 'Couldn’t sign in.'); return; }
      cloudState = await D.cloudStatus(); paintCloud(box); toast(t('Signed in. Your notes are now in your account too.'));
    };
  }

  function renderSettings() {
    const s = S.settings || {};
    openDlg('settings', `<div class="dlg-in">${head(t('Settings'))}
      <section class="group"><h3>${t('Your account')}</h3><div class="box" id="cloudBox"><p class="small">${t('Checking…')}</p></div></section>
      ${WEB ? '' : claudeSection()}
      ${WEB ? `<section class="group"><h3>${t('Lecture recording')}</h3><div class="box"><p class="small">${t('Recording lectures needs the Study Notebook app on a Windows computer. Transcripts you record there show up here too.')}</p></div></section>` : `<section class="group"><h3>${t('Lecture recording')}</h3><div class="box" id="speechBox"><p class="small">${t('Checking…')}</p></div></section>`}
      <section class="group"><h3>${t('Appearance')}</h3>
        <div class="seg" role="group" aria-label="${esc(t('Appearance'))}">${['system', 'light', 'dark'].map(th => `<button type="button" data-theme-pick="${th}" aria-pressed="${theme() === th}">${THEME_ICON[th]}${t(THEME_NAME[th])}</button>`).join('')}</div>
        <p class="small">${t('Automatic follows your computer’s light or dark setting.')}</p>
        <div class="seg" role="group" aria-label="${esc(t('Paper warmth'))}">${Object.entries(WARMTH).map(([k, [name, sw]]) => `<button type="button" data-warmth-pick="${k}" aria-pressed="${warmth() === k}"><i class="swatch" style="background:${sw}" aria-hidden="true"></i>${t(name)}</button>`).join('')}</div>
        <p class="small">${t('Paper warmth: how warm the pages and the shelf look, in light and in dark.')}</p>
        ${WEB ? '' : `<p class="small">${t('Text size: Ctrl + and Ctrl − (Ctrl 0 for normal).')}`} <button type="button" class="sn-link" id="keysLink">${t('All keyboard shortcuts')}</button>${WEB ? '' : '</p>'}</section>
      <section class="group"><h3>${t('Language')}</h3>
        <div class="seg" role="group" aria-label="${esc(t('Language'))}"><button type="button" data-ui-lang="en" aria-pressed="${uiLang === 'en'}">English</button><button type="button" data-ui-lang="he" aria-pressed="${uiLang === 'he'}">עברית</button></div>
        <p class="small">${t('The language of the app’s buttons and menus. Each course’s notes keep their own language.')}</p></section>
      <section class="group"><h3>${t('Your notes')}</h3><div class="box">
        ${WEB ? `<p class="small">${t('Your notes are saved in your account as you go. You can also keep a copy as a file, or replace everything with a backup.')}</p>
        <div class="row"><button class="btn" type="button" id="backup">${t('Back up all notes')}</button><button class="btn" type="button" id="restore">${t('Restore from a backup')}</button></div></div></section></div>` : `<p class="small">${s.lastBackup ? esc(t('Notes save automatically on this computer, and a backup copy is kept each day (the last 14); the latest is from {date}. To move your notes to another laptop, back them up to a file and restore it there.', { date: new Date(s.lastBackup + 'T12:00').toLocaleDateString(LOCALE, { day: 'numeric', month: 'long' }) })) : t('Notes save automatically on this computer, and a backup copy is kept each day (the last 14). To move your notes to another laptop, back them up to a file and restore it there.')}</p>
        <div class="row"><button class="btn" type="button" id="backup">${t('Back up all notes')}</button><button class="btn" type="button" id="restore">${t('Restore from a backup')}</button><button class="btn ghost" type="button" id="folder">${t('Open notes folder')}</button></div>
        <div class="path" dir="ltr">${esc(s.dataDir || '')}</div></div></section>
      <section class="group"><h3>${t('Updates')}</h3><div class="box" id="updBox"><p class="small">${esc(t('Version {v}.', { v: s.version || '' }))}</p></div></section></div>`}`, d => {
      drawCloud(d); if (!WEB) { wireClaude(d); drawSpeech(d); drawUpdates(d); }
      const kl = d.querySelector('#keysLink'); if (kl) kl.onclick = () => openShortcuts();
      d.querySelectorAll('[data-theme-pick]').forEach(b => b.onclick = () => setTheme(b.dataset.themePick));
      d.querySelectorAll('[data-warmth-pick]').forEach(b => b.onclick = () => setWarmth(b.dataset.warmthPick));
      d.querySelectorAll('[data-ui-lang]').forEach(b => b.onclick = async () => { if (b.dataset.uiLang === uiLang) return; window.I18N.set(b.dataset.uiLang); await saveNow(); location.reload(); });
      if (d.querySelector('#folder')) d.querySelector('#folder').onclick = () => D.openDataFolder();
      d.querySelector('#backup').onclick = async () => { await saveNow(); const r = await D.exportBackup(JSON.stringify({ version: 1, app: 'Study Notebook', exportedAt: new Date().toISOString(), docs }, null, 1)); if (r.ok) toast(t('Backup saved')); else if (!r.cancelled) toast(r.message || t('Couldn’t save the backup')); };
      d.querySelector('#restore').onclick = async () => {
        const r = await D.importBackup();
        if (!r.ok) { if (!r.cancelled) toast(r.message || t('Couldn’t read that backup')); return; }
        const n = Object.keys(r.data.docs).filter(p => p.split('/').length === 4).length;
        if (!confirm(tn(n, 'Replace all notes in the app with this backup (1 course)? Your current notes will be replaced.', 'Replace all notes in the app with this backup ({n} courses)? Your current notes will be replaced.'))) return;
        docs = r.data.docs; dirty = true; await saveNow(); dlg.close(); S.courseId = ''; S.view = 'notes'; render(); toast(t('Notes restored'));
      };
    });
  }
  async function openSettings() { S.settings = await D.getSettings(); claudeMsg = null; renderSettings(); }

  function openWelcome() {
    if (WEB) {
      openDlg('welcome', `<div class="dlg-in">${head(t('Welcome to Study Notebook'), t('Your notes, written by Claude while you study.'))}
        <p class="small" style="font-size:14px;color:var(--ink)">${t('Study with Claude as usual, in any chat. When you understand something, Claude saves the final explanation here, under the right course and topic, and makes practice questions for it.')}</p>
        <div class="box" id="cloudBox"><p class="small">${t('Checking…')}</p></div>
        <div class="row"><button class="btn ghost" type="button" data-close>${t('Later')}</button></div></div>`, d => drawCloud(d));
      store('sn-welcomed', '1'); return;
    }
    openDlg('welcome', `<div class="dlg-in">${head(t('Welcome to Study Notebook'), t('Your notes, written by Claude while you study.'))}
      <p class="small" style="font-size:14px;color:var(--ink)">${t('Study with Claude in the Claude app as usual. When you understand something, Claude saves the final explanation here, under the right course and topic. You can also record lectures here and practice for exams.')}</p>
      ${claudeBox()}
      <div class="row"><button class="btn ghost" type="button" data-close>${t('Later')}</button></div></div>`, d => drawClaude(d));
    store('sn-welcomed', '1');
  }

  /* ================= Claude, live ================= */
  D.onConnectorOp(async (op, args) => {
    if (op === '__cloud_apply') return applyCloud(args && args.changes);
    try {
      const { result, writes } = Ops.run(docs, op, args);
      for (const w of writes) { if (w.data === null) delete docs[w.path]; else docs[w.path] = w.data; }
      if (writes.length) {
        dirty = true; await saveNow();
        S.lastClaude = Date.now();
        const cid = writes[0].path.split('/')[3];
        if (op === 'create_course') { toast(t('Claude created the course “{name}”', { name: result.name })); if (!S.courseId) S.courseId = result.course_id; render(); }
        else if (op === 'save_practice') {
          toast(tn(result.saved, 'Claude added 1 practice item to {course}', 'Claude added {n} practice items to {course}', { course: result.course }));
          render();
        } else if (op === 'save_sections') {
          const added = result.saved.filter(x => x.action === 'added').map(x => x.section_id);
          const made = autoPractice(cid, added); if (made) save();
          toast(tn(result.saved.length, 'Claude saved 1 topic in {course}', 'Claude saved {n} topics in {course}', { course: result.course }) + (made ? ' · ' + tn(made, '1 practice question made', '{n} practice questions made') : ''));
          const busy = S.editing || (S.view === 'practice' && S.prac);
          if (cid !== S.courseId && !busy) { S.courseId = cid; store('sn-course', cid); S.search = ''; }
          if (S.view !== 'notes' && !busy && cid === S.courseId && S.view !== 'lecture') S.view = 'notes';
          render(); if (cid === S.courseId && S.view === 'notes' && result.saved[0]) flash(result.saved[0].section_id);
        } else if (op === 'save_section' || op === 'edit_part') {
          if (op === 'save_section' && result.action === 'added' && autoPractice(cid, [result.section_id])) save();
          toast(result.action === 'updated' ? t('Claude updated “{title}” in {course}', { title: result.title, course: result.course }) : t('Claude saved “{title}” in {course}', { title: result.title, course: result.course }));
          const busy = S.editing || (S.view === 'practice' && S.prac);
          if (cid !== S.courseId && !busy) { S.courseId = cid; store('sn-course', cid); S.search = ''; }
          if (S.editing === result.section_id) S.editing = null;
          if (S.view !== 'notes' && !busy && cid === S.courseId && S.view !== 'lecture') S.view = 'notes';
          const c = course();
          if (result.action === 'updated' && c && c.id === cid && !busy && patchSection(c, result.section_id)) { renderSide(); renderTop(); renderContents(); }
          else render();
          if (cid === S.courseId && S.view === 'notes') flash(result.section_id);
        }
      }
      return { ok: true, result };
    } catch (e) {
      return { ok: false, error: e && e.name === 'OpError' ? e.message : 'The app couldn’t do that.' };
    }
  });

  /* ================= shared with the recorder ================= */
  window.SN = {
    // Words from the course (topic titles and bold terms), to help speech recognition spell them right.
    courseVocab(cid) {
      const secs = sections(cid); const count = new Map();
      const strip = w => String(w || '').replace(/\\\([\s\S]*?\\\)|\$[^$]*\$/g, ' ').replace(/\([^)]*\)/g, ' ').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();
      const add = w => { w = w.replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, ''); if (w.length < 2 || w.length > 40 || !/\p{L}{2}/u.test(w)) return; count.set(w, (count.get(w) || 0) + 1); };
      for (const s of Object.values(secs)) {
        for (const part of strip(s.title).split(/[:,;·–—→]/)) add(part);
        // Bold terms inside sentences (not labels like "**Proof**" at the start of a line).
        for (const line of String(s.content || '').split('\n')) for (const m of line.matchAll(/\*\*([^*\n]{2,40}?)\*\*/g)) {
          const before = line.slice(0, m.index).replace(/^\s*([-*]|\d+\.)\s*/, '').trim(), after = line.slice(m.index + m[0].length).trim();
          if (/[.:?]\s*$/.test(m[1]) || (!before && (!after || /^[.:]/.test(after)))) continue;
          add(strip(m[1]));
        }
      }
      const out = []; let len = 0;
      for (const [w] of [...count.entries()].sort((a, b) => b[1] - a[1])) { if (len + w.length > 200) break; out.push(w); len += w.length + 2; }
      return out;
    },
    course, courseById: id => courses().find(c => c.id === id) || null, render, toast, saveNow, dirFor, askClaude, copy, t, tn,
    updateRecBtn() { const b = $('recBtn'); if (b) b.outerHTML = recButton(); },
    putLecture(cid, lid, data) { docs[lecPath(cid, lid)] = data; save(); if (cid === S.courseId) { renderContents(); renderSide(); } },
    patchLecture(cid, lid, patch) {
      const p = lecPath(cid, lid); if (!docs[p]) return;
      docs[p] = { ...docs[p], ...patch }; save();
      if (cid === S.courseId) { if (S.view === 'lecture' && S.lecture === lid && !S.renamingLec) { const w = $('sheetWrap'); const atEnd = w.scrollTop + w.clientHeight >= w.scrollHeight - 40; renderSheet(); if (atEnd) w.scrollTop = w.scrollHeight; } if (patch.status) renderContents(); }
    },
    openLecture(cid, lid) { if (S.courseId !== cid) selectCourse(cid); S.lecture = lid; showView('lecture'); }
  };

  /* ================= print hook ================= */
  window.snPrintSource = (topicId, pickedIds) => {
    const c = course(); if (!c) return null;
    const secs = sections(c.id); const out = [];
    if (topicId === '__formulas') {
      const base = window.snPrintSource(null);
      return { ...base, subtitle: t('Formula sheet'), sections: formulaItems(c, secs).map(x => ({ id: x.id, title: x.title, depth: x.depth, html: x.md ? mdToHtml(x.md) : '' })) };
    }
    const add = (s, d) => out.push({ id: s.id, title: s.title, depth: d, html: mdToHtml(s.content) });
    if (Array.isArray(pickedIds)) walk(secs, (s, d) => { if (pickedIds.includes(s.id)) add(s, d); });
    else if (topicId && secs[topicId]) { add(secs[topicId], 0); walk(secs, (s, d) => add(s, d + 1), topicId); }
    else walk(secs, add);
    const tree = []; walk(secs, (s, d) => tree.push({ id: s.id, title: s.title, depth: d }));
    return { tree, course: c.name, lang: c.lang === 'he' || c.lang === 'en' ? c.lang : (dirOf(c) === 'rtl' ? 'he' : 'auto'), sections: out, topics: kids(secs, null).map(s => ({ id: s.id, title: s.title })), subtitle: topicId && secs[topicId] ? secs[topicId].title : '' };
  };

  /* ================= start ================= */
  D.onClaudeSeen(() => {
    S.claudeSeen = Date.now(); S.lastClaude = Math.max(S.lastClaude, 0); renderClaudePill();
    toast(t('Claude is connected'));
    renderSheet();
    if (dlg && dlg.open && (dlgKind === 'settings' || dlgKind === 'welcome')) { claudeMsg = null; drawClaude(dlg); }
  });
  setInterval(() => { renderClaudePill(); }, 60000);
  (async () => {
    render();
    const [data, settings] = await Promise.all([D.loadData(), D.getSettings()]);
    docs = (data && data.docs) || {};
    // A recording that was still running when the app closed is kept, marked as stopped early.
    for (const [p, d] of Object.entries(docs)) if (p.includes('/lectures/') && d && d.status === 'recording') docs[p] = { ...d, status: 'stopped' };
    S.settings = settings;
    D.setTheme(theme());
    render(); restorePos();
    $('sheetWrap').addEventListener('scroll', () => { clearTimeout(posTimer); posTimer = setTimeout(savePos, 250); }, { passive: true });
    if (WEB) { cloudState = await D.cloudStatus(); renderClaudePill(); if (store('sn-welcomed') !== '1' && !cloudState.claude) setTimeout(openWelcome, 250); }
    else if (store('sn-welcomed') !== '1' && !settings.connectorLastUse) setTimeout(openWelcome, 250);
  })();
})();
