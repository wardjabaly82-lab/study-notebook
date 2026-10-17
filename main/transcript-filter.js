'use strict';
/*
  Cleans what the speech engine returns before it reaches the transcript.

  Whisper has two well-known failure modes on lecture audio:
  - in quiet stretches, music, laughter or noise it "hears" short stock phrases
    ("I.", "Thank you.", subtitle credits);
  - it can get stuck repeating the same word or phrase ("I. I. I. I. I.").
  The engine reports, per sentence, how sure it was (avg_logprob) and how likely
  the audio held no speech at all (no_speech_prob); both are used here.
*/

const norm = w => String(w).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

// Collapses a word or phrase repeated 3+ times in a row into one copy.
function collapseLoops(text) {
  let words = String(text).split(/\s+/).filter(Boolean);
  let looped = false;
  for (let changed = true; changed;) {
    changed = false;
    for (let n = 1; n <= 8 && !changed; n++) {
      for (let i = 0; i + n * 3 <= words.length; i++) {
        const key = words.slice(i, i + n).map(norm).join(' ');
        if (!key.replace(/ /g, '')) continue;
        let reps = 1;
        while (i + (reps + 1) * n <= words.length && words.slice(i + reps * n, i + (reps + 1) * n).map(norm).join(' ') === key) reps++;
        if (reps >= 3) { words.splice(i + n, (reps - 1) * n); looped = changed = true; break; }
      }
    }
  }
  return { text: words.join(' '), looped };
}

// Whole sentences Whisper typically invents in music, silence or noise.
const STOCK = new Set([
  'i', 'you', 'so', 'oh', 'uh', 'um', 'hmm', 'mm', 'bye', 'thank you', 'thanks', 'thank you very much', 'thank you so much',
  'thanks for watching', 'thank you for watching', 'thanks for listening', 'please subscribe', 'subscribe', 'see you next time',
  'תודה', 'תודה רבה', 'תודה לכם', 'תודה שצפיתם', 'ביי',
  'شكرا', 'شكرا لكم', 'شكرا جزيلا', 'شكرا على المشاهدة', 'اشتركوا في القناة', 'اشترك في القناة'
].map(s => s.split(' ').map(norm).join(' ')));
const CREDITS = /(subtitles?|captions?|transcri(bed|ption)|translat(ed|ion))\s+(by|from)|amara\.org|www\.|\.com\b|כתוביות|תורגם|תרגום|ترجمة|اشترك/i;

function wordCount(t) { return String(t).split(/\s+/).filter(w => norm(w)).length; }

// segments: [{ text, avg_logprob?, no_speech_prob? }]. Returns { text, doubtful }.
// "doubtful" means something was dropped or repaired, so the next piece shouldn't lean on this one.
function filterSegments(segments) {
  const kept = []; let doubtful = false;
  for (const s of segments || []) {
    let t = String((s && s.text) || '').replace(/\s+/g, ' ').trim();
    if (!t || !/[\p{L}\p{N}]/u.test(t)) continue;
    const lp = Number.isFinite(s.avg_logprob) ? s.avg_logprob : 0;
    const ns = Number.isFinite(s.no_speech_prob) ? s.no_speech_prob : 0;
    // Probably no speech and not sure of the words: OpenAI Whisper's own rule.
    if (ns > 0.6 && lp < -1) { doubtful = true; continue; }
    const loop = collapseLoops(t); t = loop.text;
    const n = wordCount(t);
    if (loop.looped) doubtful = true;
    // A loop that boils down to a word or two was never speech.
    if (loop.looped && n <= 2) continue;
    // Stock phrases and subtitle credits that stand alone.
    if (STOCK.has(t.split(/\s+/).map(norm).filter(Boolean).join(' '))) { doubtful = true; continue; }
    if (CREDITS.test(t) && n <= 12) { doubtful = true; continue; }
    // Very short and very unsure.
    if (n <= 3 && lp < -1) { doubtful = true; continue; }
    kept.push(t);
  }
  let text = kept.join(' ');
  // Loops can also span sentence boundaries.
  const all = collapseLoops(text); if (all.looped) { text = all.text; doubtful = true; }
  return { text: text.trim(), doubtful };
}

module.exports = { filterSegments, collapseLoops };
