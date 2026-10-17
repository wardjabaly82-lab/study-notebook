/* Makes practice questions from a course's notes, on this computer, without Claude.
   It reads the structure the notes already have: definitions, claims with proofs,
   question headings ("Why do we need a proof?"), common mistakes, key terms in bold,
   and display formulas, and turns them into flashcards, fill-in-the-blank and
   multiple-choice questions in the notes' own language. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PracticeGen = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TEXT = {
    he: {
      explain: x => `הסבירו: ${x}`,
      define: x => `מהי ההגדרה של ${x}?`,
      prove: x => `הוכיחו: ${x}`,
      mistakes: x => `מהן הטעויות הנפוצות בנושא "${x}"?`,
      formula: (title, ctx) => `${title}: ${ctx} כתבו את הנוסחה.`,
      fill: s => `השלימו את החסר:\n\n${s}`,
      which: s => `איזה מושג חסר?\n\n${s}`,
      topicOf: s => `באיזה נושא נאמר המשפט הזה?\n\n${s}`,
      inTopic: (q, title) => `${q} (${title})`
    },
    en: {
      explain: x => `Explain: ${x}`,
      define: x => `What is the definition of ${x}?`,
      prove: x => `Prove: ${x}`,
      mistakes: x => `What are the common mistakes with "${x}"?`,
      formula: (title, ctx) => `${title}: ${ctx} Write the formula.`,
      fill: s => `Fill in the blank:\n\n${s}`,
      which: s => `Which term is missing?\n\n${s}`,
      topicOf: s => `Which topic is this sentence from?\n\n${s}`,
      inTopic: (q, title) => `${q} (${title})`
    }
  };

  const LABEL = {
    definition: /^(הגדרה|הגדרות|ההגדרה|definition|definitions)\b/i,
    claim: /^(טענה|הטענה|משפט|המשפט|למה|תכונה|theorem|claim|lemma|proposition|property)\b/i,
    proof: /^(הוכחה|ההוכחה|proof)\b/i,
    mistakes: /^(טעויות נפוצות|טעויות|שגיאות נפוצות|common mistakes|mistakes|pitfalls)\b/i,
    skip: /^(דוגמה|דוגמא|דוגמאות|example|examples|סיכום|summary|הערה|note|remark)\b/i
  };

  const norm = s => String(s || '').toLowerCase().replace(/[*_`>#]/g, '').replace(/\s+/g, ' ').trim();
  const clip = (s, n) => { s = String(s || '').trim(); if (s.length <= n) return s; const cut = s.lastIndexOf('\n\n', n); return (cut > n * 0.5 ? s.slice(0, cut) : s.slice(0, n) + '…').trim(); };
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // Removes things that aren't study content: lecture source lines and links.
  function tidy(md) {
    return String(md || '').replace(/\r\n?/g, '\n')
      .replace(/^\s*\*?(Source|מקור)s?:.*$/gim, '')
      .replace(/\[([^\]]+)\]\(#lec=[^)]*\)/g, '$1')
      .replace(/\n{3,}/g, '\n\n').trim();
  }

  // Math must never be cut in half: hide it behind tokens while splitting text.
  function mask(s) {
    const keep = [];
    const out = s.replace(/\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)/g, m => { keep.push(m); return `\u0001${keep.length - 1}\u0002`; });
    return { out, back: t => t.replace(/\u0001(\d+)\u0002/g, (_, i) => keep[+i]) };
  }

  // Splits a section into its labeled blocks: **Label.** text … until the next label.
  function blocks(md) {
    const lines = md.split('\n'); const out = []; let cur = { label: '', lines: [] };
    for (const line of lines) {
      const m = line.match(/^\*\*([^*\n]{1,80}?)\*\*\s*[.:]?\s*(.*)$/);
      if (m) { out.push(cur); cur = { label: m[1].replace(/[.:]\s*$/, '').trim(), lines: m[2] ? [m[2]] : [] }; }
      else cur.lines.push(line);
    }
    out.push(cur);
    return out.map(b => ({ label: b.label, text: b.lines.join('\n').trim() })).filter(b => b.label || b.text);
  }

  // Sentences with a **bold term** inside (not a label at the start of a line).
  function clozes(md) {
    const { out, back } = mask(md);
    const res = [];
    for (const para of out.split(/\n+/)) {
      if (/^\s*\*\*[^*]+\*\*\s*[.:]?\s*$/.test(para)) continue;   // a label on its own
      const body = para.replace(/^\s*([-*]|\d+\.)\s+/, '').replace(/^\*\*[^*]{1,40}?[.:]\*\*\s*|^\*\*[^*]{1,40}\*\*\s*[.:]\s*/, '');
      for (const sent of body.split(/(?<=[.!?;])\s+/)) {
        const terms = [...sent.matchAll(/\*\*([^*\n]{2,40}?)\*\*/g)].map(m => m[1].trim()).filter(t => !/[.:]$/.test(t) && !/^\d+$/.test(t));
        if (!terms.length) continue;
        const plain = sent.replace(/\*\*/g, '');
        if (plain.length < 30 || plain.length > 360) continue;
        const term = terms[0];
        const blanked = sent.replace(`**${term}**`, '_____').replace(/\*\*/g, '');
        res.push({ term: back(term), sentence: back(plain).trim(), blanked: back(blanked).trim() });
      }
    }
    return res;
  }

  // One display formula with the line that introduces it.
  function formula(md) {
    const m = md.match(/(^|\n)([^\n]{8,200})\n(\$\$[\s\S]{3,600}?\$\$)/);
    if (!m) return null;
    const ctx = m[2].replace(/^\s*([-*]|\d+\.)\s+/, '').replace(/\*\*/g, '').trim();
    const words = ctx.replace(/\\\([\s\S]*?\\\)/g, '').split(/\s+/).filter(w => /[\p{L}]{2,}/u.test(w));
    return words.length >= 2 ? { ctx, f: m[3] } : null;
  }

  // sections: [{ id, title, content }], lang 'he' | 'en', type 'mixed' | 'flash' | 'fill' | 'choice'.
  // Returns [{ topic_section_id, kind, question, answer, choices?, correct_choice?, explanation? }].
  function generate({ sections, lang, type = 'mixed', limit = 20, existing = new Set() }) {
    const T = TEXT[lang === 'he' ? 'he' : 'en'];
    const perSection = []; const allTerms = new Map(); const fillsAll = [];
    for (const s of sections) {
      const md = tidy(s.content); if (!md) continue;
      const title = String(s.title || '').trim();
      const flash = [], fill = [], choice = [];
      const bs = blocks(md);
      const proof = bs.find(b => LABEL.proof.test(b.label));
      for (const b of bs) {
        if (!b.label || LABEL.skip.test(b.label) || !b.text) continue;
        if (LABEL.definition.test(b.label)) {
          const term = (b.text.match(/\*\*([^*\n]{2,60}?)\*\*/) || [])[1] || title;
          flash.push({ kind: 'flashcard', question: T.define(term), answer: clip(b.text, 3000) });
        } else if (LABEL.claim.test(b.label)) {
          if (proof && b.text.length < 400) flash.push({ kind: 'open_question', question: T.prove(b.text.replace(/\s+/g, ' ')), answer: clip(proof.text, 5000) });
        } else if (LABEL.mistakes.test(b.label)) {
          flash.push({ kind: 'flashcard', question: T.mistakes(title), answer: clip(b.text, 2500) });
        } else if (/\?\s*$/.test(b.label) && b.text.length >= 40) {
          flash.push({ kind: 'flashcard', question: T.inTopic(b.label, title), answer: clip(b.text, 3000) });
        }
      }
      // The section as a whole: its opening explanation.
      const intro = bs[0] && !bs[0].label ? bs[0].text : '';
      const explainAns = intro.length >= 60 ? clip(intro, 1200) : clip(md, 1200);
      if (explainAns.length >= 60) flash.push({ kind: 'flashcard', question: T.explain(title), answer: explainAns });
      const f = formula(md);
      if (f) flash.push({ kind: 'flashcard', question: T.formula(title, f.ctx), answer: f.f });
      for (const c of clozes(md)) {
        fill.push({ kind: 'flashcard', question: T.fill(c.blanked), answer: `**${c.term}**\n\n${c.sentence}`, _term: c.term, _blanked: c.blanked, _sentence: c.sentence });
        if (!allTerms.has(norm(c.term))) allTerms.set(norm(c.term), c.term);
      }
      fillsAll.push(...fill.map(x => ({ ...x, sid: s.id })));
      perSection.push({ id: s.id, title, flash, fill, choice, intro: intro || md });
    }
    // Multiple choice: the missing term among other terms from the same course.
    const terms = [...allTerms.values()];
    for (const sec of perSection) {
      for (const fl of sec.fill) {
        const others = shuffle(terms.filter(t => norm(t) !== norm(fl._term))).slice(0, 3);
        if (others.length < 3) continue;
        const choices = shuffle([fl._term, ...others]);
        sec.choice.push({ kind: 'multiple_choice', question: T.which(fl._blanked), answer: fl._term, choices, correct_choice: choices.indexOf(fl._term) + 1, explanation: fl._sentence });
      }
    }
    // Not enough terms: ask which topic a question belongs to.
    const titles = perSection.map(s => s.title).filter(Boolean);
    if (titles.length >= 4) for (const sec of perSection) {
      if (sec.choice.length) continue;
      // A sentence from the section that doesn't name the topic itself.
      const words = new Set(norm(sec.title).split(' ').filter(w => w.length > 2));
      const { out, back } = mask(sec.intro || '');
      const sent = out.split(/(?<=[.!?])\s+|\n+/).filter(x => !x.includes('|')).map(x => x.replace(/^\s*([-*]|\d+\.)\s+/, '').replace(/\*\*/g, '').trim())
        .find(x => x.length >= 40 && x.length <= 260 && !norm(x).split(' ').some(w => words.has(w)));
      if (!sent) continue;
      const others = shuffle(titles.filter(t => t !== sec.title)).slice(0, 3);
      const choices = shuffle([sec.title, ...others]);
      sec.choice.push({ kind: 'multiple_choice', question: T.topicOf(back(sent)), answer: sec.title, choices, correct_choice: choices.indexOf(sec.title) + 1 });
    }
    // Pick: spread over the sections, in the order the student asked for.
    const order = type === 'flash' ? ['flash'] : type === 'fill' ? ['fill'] : type === 'choice' ? ['choice'] : ['choice', 'flash', 'fill'];
    const seen = new Set(existing); const picked = [];
    const queues = perSection.map(sec => ({ sec, q: order.map(k => shuffle(sec[k])) }));
    for (let round = 0; picked.length < limit && round < 50; round++) {
      let any = false;
      for (const { sec, q } of shuffle(queues)) {
        if (picked.length >= limit) break;
        const kindQ = q[round % q.length].length ? q[round % q.length] : q.find(x => x.length);
        if (!kindQ) continue;
        while (kindQ.length) {
          const it = kindQ.shift();
          if (seen.has(norm(it.question))) continue;
          seen.add(norm(it.question)); any = true;
          const { _term, _blanked, _sentence, ...clean } = it;
          picked.push({ topic_section_id: sec.id, ...clean });
          break;
        }
      }
      if (!any && queues.every(x => x.q.every(k => !k.length))) break;
    }
    return picked;
  }

  return { generate, _blocks: blocks, _clozes: clozes };
});
