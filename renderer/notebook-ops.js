/* Notebook operations shared by the app and the Claude connector.
   Pure functions: they read the notes (a map of "path -> document") and
   return a result plus the list of writes to apply. The app applies the
   writes through its live database (so the screen updates); the connector
   applies them to the notes file when the app is closed.

   Storage layout (same as the app):
     data/users/local/<courseId>                     course {name, lang, createdAt, chat, files, sourceParts}
     data/users/local/<courseId>/sections/<sectionId> section {title, content, parentId, order, rev, ...} */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NotebookOps = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BASE = 'data/users/local';
  const MAX_CONTENT = 200000;   // characters per section
  const MAX_TITLE = 200;

  class OpError extends Error { constructor(message) { super(message); this.name = 'OpError'; } }

  const rid = p => p + Math.random().toString(36).slice(2, 9) + Math.random().toString(36).slice(2, 5);
  const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

  function courses(docs) {
    const out = [];
    for (const [p, d] of Object.entries(docs)) {
      const parts = p.split('/');
      if (parts.length === 4 && p.startsWith(BASE + '/') && d && d.name) out.push({ id: parts[3], ...d });
    }
    return out.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }

  function sections(docs, cid) {
    const pre = `${BASE}/${cid}/sections/`;
    const out = {};
    for (const [p, d] of Object.entries(docs)) if (p.startsWith(pre) && p.split('/').length === 6 && d) out[p.slice(pre.length)] = { id: p.slice(pre.length), ...d };
    return out;
  }

  function lectures(docs, cid) {
    const pre = `${BASE}/${cid}/lectures/`;
    const out = [];
    for (const [p, d] of Object.entries(docs)) if (p.startsWith(pre) && p.split('/').length === 6 && d) out.push({ id: p.slice(pre.length), ...d });
    return out.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  }
  function cards(docs, cid) {
    const pre = `${BASE}/${cid}/cards/`; const out = [];
    for (const [p, d] of Object.entries(docs)) if (p.startsWith(pre) && p.split('/').length === 6 && d) out.push({ id: p.slice(pre.length), ...d });
    return out.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }
  const KINDS = { flashcard: 'flash', multiple_choice: 'choice', open_question: 'open' };
  const LANG_NAME = { he: 'Hebrew', en: 'English', ar: 'Arabic', auto: 'mixed or unknown' };
  const PART = 40000; // characters of transcript per read_lecture part

  // Finds a course by id, exact name, course number, or part of the name.
  function findCourse(docs, ref) {
    const list = courses(docs);
    if (!list.length) throw new OpError('There are no courses yet. Create one with create_course first.');
    const r = norm(ref);
    if (!r) {
      if (list.length === 1) return list[0];
      throw new OpError(`Say which course. Courses: ${list.map(c => `"${c.name}"`).join(', ')}.`);
    }
    const hit = list.find(c => c.id === ref) || list.find(c => norm(c.name) === r)
      || list.filter(c => { const first = norm(c.name).split(' ')[0]; return norm(c.name).includes(r) || (first.length >= 3 && r.includes(first)); });
    if (hit && !Array.isArray(hit)) return hit;
    if (hit && hit.length === 1) return hit[0];
    if (hit && hit.length > 1) throw new OpError(`"${ref}" matches several courses: ${hit.map(c => `"${c.name}"`).join(', ')}. Use the exact name.`);
    throw new OpError(`No course called "${ref}". Courses: ${list.map(c => `"${c.name}"`).join(', ')}.`);
  }

  function kids(secs, pid) {
    return Object.values(secs).filter(s => (s.parentId || null) === pid)
      .sort((a, b) => (a.order || 0) - (b.order || 0) || (a.createdAt || 0) - (b.createdAt || 0));
  }
  function walk(secs, fn, pid = null, d = 0) { for (const s of kids(secs, pid)) { fn(s, d); walk(secs, fn, s.id, d + 1); } }
  function pathOf(secs, id) { const out = []; let s = secs[id]; let guard = 0; while (s && guard++ < 50) { out.unshift(s.title); s = s.parentId ? secs[s.parentId] : null; } return out.join(' › '); }
  const preview = (t, n = 140) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };

  function cleanText(v, max, what) {
    if (typeof v !== 'string') throw new OpError(`${what} must be text.`);
    const s = v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
    if (!s.trim()) throw new OpError(`${what} is empty.`);
    if (s.length > max) throw new OpError(`${what} is too long (max ${max} characters). Split it into smaller sections.`);
    return s;
  }

  /* ---------------- operations ---------------- */

  const OPS = {
    list_courses(docs) {
      return {
        result: courses(docs).map(c => {
          const n = Object.keys(sections(docs, c.id)).length;
          return { course_id: c.id, name: c.name, notes_language: c.lang === 'he' ? 'Hebrew' : c.lang === 'en' ? 'English' : 'same as the course material', sections: n };
        }),
        writes: []
      };
    },

    get_outline(docs, { course }) {
      const c = findCourse(docs, course);
      const secs = sections(docs, c.id);
      const lines = [];
      walk(secs, (s, d) => lines.push({ section_id: s.id, depth: d, title: s.title, path: pathOf(secs, s.id), preview: preview(s.content), revision: s.rev || 1 }));
      return { result: { course_id: c.id, course: c.name, notes_language: c.lang || 'auto', sections: lines }, writes: [] };
    },

    read_section(docs, { course, section_id }) {
      const c = findCourse(docs, course);
      const secs = sections(docs, c.id);
      const s = secs[section_id];
      if (!s) throw new OpError(`No section "${section_id}" in "${c.name}". Use get_outline to see section ids.`);
      return { result: { course: c.name, section_id: s.id, title: s.title, path: pathOf(secs, s.id), revision: s.rev || 1, content: s.content, sub_sections: kids(secs, s.id).map(k => ({ section_id: k.id, title: k.title })) }, writes: [] };
    },

    search_notes(docs, { query, course }) {
      const q = norm(query);
      if (q.length < 2) throw new OpError('Search for at least 2 characters.');
      const list = course ? [findCourse(docs, course)] : courses(docs);
      const hits = [];
      for (const c of list) {
        const secs = sections(docs, c.id);
        for (const s of Object.values(secs)) {
          const inTitle = norm(s.title).includes(q);
          const i = norm(s.content).indexOf(q);
          if (inTitle || i >= 0) hits.push({ course: c.name, section_id: s.id, title: s.title, path: pathOf(secs, s.id), match: inTitle ? 'title' : 'content', snippet: i >= 0 ? preview(String(s.content).replace(/\s+/g, ' ').slice(Math.max(0, i - 60), i + 120), 180) : preview(s.content) });
        }
      }
      return { result: { query, results: hits.slice(0, 25), more: Math.max(0, hits.length - 25) }, writes: [] };
    },

    create_course(docs, { name, notes_language }, now) {
      const n = cleanText(name, 80, 'Course name').trim();
      const existing = courses(docs).find(c => norm(c.name) === norm(n));
      if (existing) return { result: { course_id: existing.id, name: existing.name, created: false, note: 'A course with this name already exists; use it.' }, writes: [] };
      const lang = notes_language === 'Hebrew' ? 'he' : notes_language === 'English' ? 'en' : 'auto';
      const id = rid('c');
      return { result: { course_id: id, name: n, created: true }, writes: [{ path: `${BASE}/${id}`, data: { name: n, lang, createdAt: now, chat: [], files: [], sourceParts: 0 } }] };
    },

    list_lectures(docs, { course }) {
      const c = findCourse(docs, course);
      return {
        result: { course: c.name, lectures: lectures(docs, c.id).map(l => ({
          lecture_id: l.id, title: l.title, recorded: new Date(l.startedAt || 0).toISOString().slice(0, 16).replace('T', ' '),
          minutes: Math.round((l.durationSec || 0) / 60), spoken_language: LANG_NAME[l.lang] || 'unknown',
          status: l.status === 'done' ? 'complete' : l.status === 'recording' ? 'still recording' : 'incomplete (recording was stopped early)',
          notes_made: !!l.notesAt, parts: Math.max(1, Math.ceil(String(l.text || '').length / PART))
        })) },
        writes: []
      };
    },

    read_lecture(docs, { course, lecture_id, part }) {
      const c = findCourse(docs, course);
      const l = lectures(docs, c.id).find(x => x.id === lecture_id);
      if (!l) throw new OpError(`No lecture "${lecture_id}" in "${c.name}". Use list_lectures to see the recordings.`);
      const text = String(l.text || '');
      const parts = Math.max(1, Math.ceil(text.length / PART));
      const n = Math.min(Math.max(1, parseInt(part, 10) || 1), parts);
      return { result: {
        course: c.name, lecture_id: l.id, title: l.title, spoken_language: LANG_NAME[l.lang] || 'unknown',
        minutes: Math.round((l.durationSec || 0) / 60), part: n, total_parts: parts,
        note: 'Automatic speech-to-text transcript with [mm:ss] times. Expect recognition mistakes, spoken formulas and filler; do not copy it as-is into notes.',
        transcript: text.slice((n - 1) * PART, n * PART) || '(The transcript is empty: no speech was recognized.)'
      }, writes: [] };
    },

    // Saves practice questions and flashcards for a course (optionally under one topic).
    save_practice(docs, { course, topic_section_id, items }, now) {
      const c = findCourse(docs, course);
      const secs = sections(docs, c.id);
      let topic = null;
      if (topic_section_id) {
        if (!secs[topic_section_id]) throw new OpError(`No section "${topic_section_id}" in "${c.name}". Use get_outline to find it.`);
        topic = secs[topic_section_id];
      }
      if (!Array.isArray(items) || !items.length) throw new OpError('Give at least one question or flashcard.');
      if (items.length > 60) throw new OpError('Save at most 60 items at a time.');
      const existing = new Set(cards(docs, c.id).map(x => norm(x.q)));
      const writes = []; let skipped = 0;
      items.forEach((it, i) => {
        if (!it || typeof it !== 'object') throw new OpError(`Item ${i + 1} is not valid.`);
        const kind = KINDS[it.kind];
        if (!kind) throw new OpError(`Item ${i + 1}: kind must be flashcard, multiple_choice or open_question.`);
        const q = cleanText(it.question, 4000, `Item ${i + 1} question`).trim();
        const a = cleanText(it.answer, 8000, `Item ${i + 1} answer`).trim();
        let choices = null, correct = null;
        if (kind === 'choice') {
          if (!Array.isArray(it.choices) || it.choices.length < 2 || it.choices.length > 6) throw new OpError(`Item ${i + 1}: multiple choice needs 2 to 6 choices.`);
          choices = it.choices.map((ch, j) => cleanText(String(ch ?? ''), 1000, `Item ${i + 1} choice ${j + 1}`).trim());
          correct = Number(it.correct_choice);
          if (!Number.isInteger(correct) || correct < 1 || correct > choices.length) throw new OpError(`Item ${i + 1}: correct_choice must be the number (1 to ${choices.length}) of the right choice.`);
          correct -= 1;
        }
        if (existing.has(norm(q))) { skipped++; return; }
        existing.add(norm(q));
        const explain = it.explanation ? cleanText(String(it.explanation), 6000, `Item ${i + 1} explanation`).trim() : '';
        writes.push({ path: `${BASE}/${c.id}/cards/${rid('k')}`, data: { kind, q, a, choices, correct, explain, topicId: topic ? topic.id : null, createdAt: now + i, source: 'claude', srs: { due: now, ivl: 0, ease: 2.5, reps: 0, lapses: 0 }, hist: [] } });
      });
      return { result: { course: c.name, topic: topic ? topic.title : null, saved: writes.length, skipped_duplicates: skipped }, writes };
    },

    // How the student is doing in practice, so new questions can target weak spots.
    get_practice_overview(docs, { course }, now = Date.now()) {
      const c = findCourse(docs, course);
      const secs = sections(docs, c.id);
      const all = cards(docs, c.id);
      const rootOf = id => { let s = secs[id]; let g = 0; while (s && s.parentId && g++ < 40) s = secs[s.parentId]; return s; };
      const topics = {};
      for (const k of all) {
        const t = k.topicId && rootOf(k.topicId);
        const key = t ? t.id : '(no topic)';
        const T = topics[key] || (topics[key] = { topic: t ? t.title : '(no topic)', section_id: t ? t.id : null, items: 0, answered: 0, correct: 0 });
        T.items++;
        for (const h of (k.hist || [])) { T.answered++; if (h.ok) T.correct++; }
      }
      const weak = all.filter(k => (k.hist || []).length).map(k => ({ question: preview(k.q, 160), topic: k.topicId && secs[k.topicId] ? secs[k.topicId].title : null, attempts: k.hist.length, correct: k.hist.filter(h => h.ok).length }))
        .filter(x => x.correct / x.attempts < 0.6).sort((a, b) => a.correct / a.attempts - b.correct / b.attempts).slice(0, 15);
      const covered = new Set(Object.values(topics).map(t => t.section_id));
      return { result: {
        course: c.name, total_items: all.length, due_now: all.filter(k => !k.srs || k.srs.due <= now).length,
        by_topic: Object.values(topics).map(t => ({ ...t, accuracy: t.answered ? Math.round(100 * t.correct / t.answered) + '%' : 'not practiced yet' })),
        weakest_questions: weak,
        topics_without_practice: kids(secs, null).filter(s => !covered.has(s.id)).map(s => ({ section_id: s.id, title: s.title }))
      }, writes: [] };
    },

    // Adds a new section, or replaces an existing one (keeping the previous version for undo).
    save_section(docs, args, now) {
      const out = saveSection(docs, args, now);
      const { lecture_id } = args;
      if (lecture_id) {
        const c = findCourse(docs, args.course);
        const l = lectures(docs, c.id).find(x => x.id === lecture_id);
        if (l) {
          const { id, ...ld } = l;
          const secs = Array.from(new Set([...(ld.sections || []), out.result.section_id])).slice(-500);
          out.writes.push({ path: `${BASE}/${c.id}/lectures/${id}`, data: { ...ld, notesAt: now, sections: secs } });
        }
      }
      return out;
    }
  };

  function saveSection(docs, { course, title, content, section_id, parent_id }, now) {
      const c = findCourse(docs, course);
      const secs = sections(docs, c.id);
      const t = cleanText(title, MAX_TITLE, 'Title').replace(/\n+/g, ' ').trim();
      const body = cleanText(content, MAX_CONTENT, 'Content');
      const base = `${BASE}/${c.id}/sections/`;

      if (section_id) {
        const s = secs[section_id];
        if (!s) throw new OpError(`No section "${section_id}" in "${c.name}". Use get_outline to find the right id, or leave section_id out to add a new section.`);
        const updated = { title: t, content: body, parentId: s.parentId || null, order: s.order || 1, rev: (s.rev || 1) + 1, createdAt: s.createdAt || now, updatedAt: now, prevTitle: s.title, prevContent: s.content, source: 'claude' };
        return { result: { action: 'updated', course: c.name, section_id: s.id, title: t, path: pathOf({ ...secs, [s.id]: { ...s, title: t } }, s.id), revision: updated.rev }, writes: [{ path: base + s.id, data: updated }] };
      }

      let parent = null;
      if (parent_id) {
        if (!secs[parent_id]) throw new OpError(`No parent section "${parent_id}" in "${c.name}". Use get_outline to find it, or leave parent_id out to add a new topic.`);
        parent = parent_id;
      }
      // Avoid duplicates: a section with the same title in the same place is updated instead.
      const twin = kids(secs, parent).find(s => norm(s.title) === norm(t));
      if (twin) return saveSection(docs, { course: c.id, title: t, content: body, section_id: twin.id }, now);

      const siblings = kids(secs, parent);
      const id = rid('s');
      const data = { title: t, content: body, parentId: parent, order: siblings.length ? Math.max(...siblings.map(s => s.order || 0)) + 1 : 1, rev: 1, createdAt: now, updatedAt: now, prevTitle: null, prevContent: null, source: 'claude' };
      return { result: { action: 'added', course: c.name, section_id: id, title: t, path: parent ? pathOf(secs, parent) + ' › ' + t : t }, writes: [{ path: base + id, data }] };
  }

  function run(docs, op, args, now = Date.now()) {
    if (!Object.prototype.hasOwnProperty.call(OPS, op)) throw new OpError(`Unknown operation "${op}".`);
    return OPS[op](docs || {}, args && typeof args === 'object' ? args : {}, now);
  }

  return { run, OpError, OPS: Object.keys(OPS), BASE };
});
