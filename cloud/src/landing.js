/* The front page. Built as the object the product makes: a notebook page (the card over the real
   notebook), the slips Claude saves, a price list, and the back of the card. Pictures are real
   screenshots of the notebook with sample notes. */
import { GOOGLE_G } from './pages.js';

const RELEASES = 'https://github.com/wardjabaly82-lab/study-notebook/releases/latest';
const SOURCE = 'https://github.com/wardjabaly82-lab/study-notebook';

const img = (name, alt, w, h, extra = '') => `<img src="/landing/${name}.webp" alt="${alt}" width="${w}" height="${h}" ${extra}>`;
const go = (cls = '') => `<a class="btn go ${cls}" href="/auth/google?next=%2Fapp%2F">${GOOGLE_G}<span>Continue with Google</span></a>`;

const SLIPS = [
  { h: 'Saved to Linear Algebra › Rank of a matrix', lines: ['Rank–nullity: dim ker A + rank A = n.', 'Ax = b has a solution exactly when rank A = rank [A | b].', 'Common mistake: counting rows before row reduction.', 'Source: Lecture 4, 11:05'], tall: 40 },
  { h: 'Practice, made by the app', lines: ['What is a basis of V?', 'A set of vectors that is independent and spans V.', 'Flashcard · Basis and dimension', 'Next review in 3 days'], tall: 32, tilt: -1.5 },
  { h: 'נשמר ב-הסתברות › אקסיומות', rtl: true, lines: ['הטענה: P(∅) = 0', 'כי Ω = Ω ∪ ∅ ∪ ∅ ∪ …', 'ולכן 1 = 1 + Σ P(∅).', 'מאי-שליליות: P(∅) = 0.'], tall: 44 },
  { h: 'Updated one part', lines: ['Probability › Countable additivity', 'Only the step you asked about was rewritten, deeper.', 'The rest of the section stayed exactly as it was.'], tall: 28, tilt: 1.2 },
  { h: 'From a PDF, in one save', lines: ['Linear independence', 'Span', 'Basis and dimension', 'Rank of a matrix', 'Finding the rank by row reduction', 'Determinants'], tall: 38 },
  { h: 'Exam plan · 12 days left', lines: ['Today: 6 cards', 'Rank of a matrix', 'Determinants', 'Two you got wrong last time'], tall: 30, tilt: -1 }
];
const slip = (s, i) => `<article class="slip" style="--h:${s.tall}svh;--t:${s.tilt || 0}deg" ${s.rtl ? 'dir="rtl" lang="he"' : ''} data-reveal>
  <h3>${s.h}</h3><p class="dots" aria-hidden="true">· · · · · · · · · · · · · · · ·</p>${s.lines.map(l => `<p>${l}</p>`).join('')}</article>`;

// The live thing: pick a question you'd ask Claude, and the page prints what gets saved.
const ASK = [
  { q: 'Why is P(∅) = 0?', save: 'Saved to Probability › Axioms › The empty event', note: ['Write Ω = Ω ∪ ∅ ∪ ∅ ∪ …, a disjoint union.', 'Countable additivity gives 1 = 1 + Σ P(∅).', 'Each term is ≥ 0, so P(∅) = 0.'], prac: 'Practice: Prove P(∅) = 0 from the axioms.' },
  { q: 'What does rank tell me about Ax = b?', save: 'Saved to Linear Algebra › Rank of a matrix', note: ['A solution exists exactly when rank A = rank [A | b].', 'It is unique when, also, rank A = n.', 'Example: rank 2 in ℝ³ leaves a line of solutions.'], prac: 'Practice: When does Ax = b have exactly one solution?' },
  { q: 'Is det(A + B) = det A + det B?', save: 'Updated one part › Determinants › Common mistake', note: ['No. Try A = B = I in 2×2:', 'det(2I) = 4, but det I + det I = 2.', 'What does hold: det(AB) = det A · det B.'], prac: 'Practice: Give a counterexample to det(A + B) = det A + det B.' }
];

export function landingPage({ ready }) {
  const action = ready ? go() : '<span class="btn go is-off" aria-disabled="true">Sign-in opens soon</span>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Study Notebook · Your notes from Claude, saved</title>
<meta name="description" content="A free notebook for Hebrew University students: study with Claude in any chat, and the final explanations save themselves by course and topic, with practice questions.">
<meta name="color-scheme" content="light"><meta name="theme-color" content="#0b3d91"><link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/landing/fonts/rubik-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<script>document.documentElement.classList.add('js')</script>
<style>${CSS}</style></head>
<body>
<main id="top">

<section class="hero" aria-labelledby="h1">
  <div class="room">${img('room-notes', 'The Study Notebook app with a Linear Algebra course open: notes on linear independence that Claude saved', 2400, 1500, 'fetchpriority="high"')}</div>
  <div class="hero-pin">
    <div class="card">
      <h1 id="h1"><span>Study</span><span>Notebook</span></h1>
      <div class="facts"><p>For Hebrew University students</p><p>Works in any Claude chat</p><p>Free, with your Google account</p></div>
      <p class="claim">Study with Claude. Your notes save themselves.</p>
      <div class="card-foot"><p class="credit">Made by a HUJI student</p>${action}<a class="link" href="#saved">See what gets saved</a></div>
    </div>
  </div>
</section>

<section class="saved" id="saved" aria-labelledby="h-saved">
  <div class="saved-photo">${img('room-hebrew', 'A Hebrew probability course in the notebook, right to left, with formulas', 2400, 1500, 'loading="lazy"')}</div>
  <div class="saved-text" data-reveal>
    <h2 id="h-saved">What Claude saves</h2>
    <p>The final explanation, not the chat, under the right course and topic.</p>
  </div>
  <div class="printer" data-reveal>
    <p class="printer-q">Try a question you’d ask Claude:</p>
    <div class="asks" role="group" aria-label="Sample questions">${ASK.map((a, i) => `<button type="button" class="ask" data-ask="${i}" aria-pressed="${i === 0}">${a.q}</button>`).join('')}</div>
  </div>
  <div class="slips" role="list" aria-label="Examples of what gets saved">
    <article class="slip live" id="liveSlip" role="listitem" aria-live="polite" style="--h:46svh;--t:0deg">
      <h3>${ASK[0].save}</h3><p class="dots" aria-hidden="true">· · · · · · · · · · · · · · · ·</p>${ASK[0].note.map(l => `<p>${l}</p>`).join('')}<p class="prac">${ASK[0].prac}</p>
    </article>
    ${SLIPS.map(slip).join('')}
  </div>
</section>

<section class="session" aria-labelledby="h-session">
  <div class="session-head">
    <h2 id="h-session" data-reveal>One study session</h2>
    <div class="row-btns"><button type="button" class="sq" data-row="-1" aria-label="Back">${ARROW_L}</button><button type="button" class="sq" data-row="1" aria-label="Forward">${ARROW_R}</button></div>
  </div>
  <div class="track" aria-hidden="true"><span class="track-on"></span></div>
  <div class="row" tabindex="0" aria-label="The steps of one study session, scroll sideways">
    ${[
      ['First, connect once', 'Sign in with Google, add the notebook to Claude, and study as usual: on the web, the phone or the desktop app.', 'connected', 'Settings showing the account signed in and Claude connected', 96],
      ['Then Claude saves', 'When you get it, the final explanation goes under the right topic. A whole PDF is one save.', 'saved', 'Linear Algebra notes marked "Saved by Claude just now"', 140],
      ['Practice appears', 'The app writes two to four questions for every new topic, the moment it’s saved.', 'practice', 'The practice page: 16 questions and flashcards, 16 due now', 80],
      ['The answer, and why', 'Every answer shows the explanation it came from, and asks how well you knew it.', 'answer', 'A flashcard answer on linear independence with Again, Hard, Good and Easy', 120],
      ['On the bus', 'Read and practise on your phone. The topics rise from the bottom, under your thumb.', 'phone-topics', 'The topic list of the probability course on a phone, in Hebrew', 100],
      ['After the lecture', 'Record it in the Windows app. Claude makes notes that link to the exact minute.', 'lecture', 'A lecture transcript with times, the line at 11:05 highlighted', 136],
      ['Late at night', 'Dark mode follows your phone, formulas included.', 'phone-dark', 'The probability notes on a phone in dark mode', 88]
    ].map(([cap, text, pic, alt, gap], i) => `<figure class="moment" style="--gap:${gap}px" data-reveal><figcaption><b>${cap}</b><span>${text}</span></figcaption>${img(pic, alt, 800, 1000, 'loading="lazy"')}</figure>`).join('')}
  </div>
</section>

<section class="menu-ground" aria-labelledby="h-menu">
  <div class="menu-sheet" data-reveal>
    <h2 id="h-menu">What’s included</h2>
    ${[
      ['While you study', [['Notes from any Claude chat', 'automatic', 'Web, phone or desktop; one Google sign-in.'], ['Going deeper on one step', 'only that part', 'The rest of the explanation stays as it was.'], ['A whole PDF or slides', 'one save', 'Every topic and sub-topic in place at once.'], ['Hebrew and English', 'both', 'Right-to-left notes, formulas kept in Latin form.']]],
      ['Before the exam', [['Practice questions', '2–4 per topic', 'Flashcards, multiple choice, fill in the blank.'], ['Spaced repetition', 'included', 'What you get wrong comes back sooner.'], ['Exam-date plan', 'a daily list', 'Set the date; the app spreads the review.'], ['Formula sheet', 'one page', 'Every formula in the course, collected.']]],
      ['Where it works', [['Phone and laptop browser', 'included', 'Sign in and your notebook is there.'], ['Windows and Mac app', 'free download', 'Lecture recording on Windows, transcribed on your computer.'], ['Price', 'free', 'No card, no trial, no ads.']]]
    ].map(([g, rows]) => `<table class="price"><caption>${g}</caption><tbody>${rows.map(([n, v, d]) => `<tr><th scope="row">${n}</th><td class="lead" aria-hidden="true"></td><td class="val">${v}</td><td class="ds">${d}</td></tr>`).join('')}</tbody></table>`).join('')}
  </div>
</section>

<section class="faq" aria-labelledby="h-faq">
  <div class="faq-text">
    <h2 id="h-faq" data-reveal>Good questions</h2>
    <div class="facts2" data-reveal><p>Free. No card, no trial.</p><p>You need a Claude account; the free plan works.</p><p>Your notebook is visible only to you.</p></div>
    <div class="qs" data-reveal>
      ${[
        ['Do I need a paid Claude plan?', 'No. Free Claude accounts can add one custom connector, and that is all Study Notebook needs.'],
        ['How do I connect Claude?', 'Sign in here, then open Settings in the notebook: it walks you through it in three steps (copy the address, add it in Claude’s connector settings, click Connect) and turns green when Claude is connected.'],
        ['Can other students see my notes?', 'No. Each notebook belongs to one Google account, and every request is checked against it. The <a href="/privacy">privacy page</a> says plainly what is kept and who could see it.'],
        ['Does it work in Hebrew?', 'Yes. Hebrew notes are set right to left with formulas in Latin form, and the app’s buttons come in Hebrew or English.'],
        ['Can I record lectures?', `In the free <a href="${RELEASES}">Windows app</a>. Speech is transcribed on your own computer; the audio never leaves it.`],
        ['What if I want to leave?', 'Download everything as one file and delete your account on the account page. It is removed right away.']
      ].map(([q, a]) => `<details><summary><span>${q}</span><i aria-hidden="true"></i></summary><div class="ans"><p>${a}</p></div></details>`).join('')}
    </div>
    <div class="faq-act" data-reveal>${action}<a class="link" href="/privacy">Privacy</a></div>
  </div>
  <div class="faq-pics" data-reveal>
    ${img('phone-tall', 'The probability notes on a phone', 900, 1200, 'loading="lazy" class="tall"')}
    ${img('phone-card', 'The practice page on a phone', 800, 800, 'loading="lazy" class="sqpic"')}
  </div>
</section>

</main>

<footer class="back">
  <div class="postcard">
    <svg class="scallops s12" viewBox="0 0 1200 24" preserveAspectRatio="none" aria-hidden="true"><path fill="var(--field)" d="${scallops(12)}"/></svg>
    <svg class="scallops s6" viewBox="0 0 600 24" preserveAspectRatio="none" aria-hidden="true"><path fill="var(--field)" d="${scallops(6)}"/></svg>
    <div class="pc-left">
      <h2>Good luck this semester</h2>
      <p>Study Notebook is made by a Data Science and Economics student at the Hebrew University, for friends and classmates. If something is broken or missing, say so on GitHub and it gets fixed.</p>
    </div>
    <div class="pc-right">
      <div class="stamp">${img('phone-dark', '', 800, 1000, 'loading="lazy"')}</div>
      <ul class="addr"><li><a href="/app/">Open your notebook</a></li><li><a href="${RELEASES}">The Windows and Mac app</a></li><li><a href="/privacy">Privacy</a></li><li><a href="${SOURCE}">Source and feedback</a></li></ul>
    </div>
    <p class="imprint">Study Notebook · Free · Not affiliated with the Hebrew University of Jerusalem or Anthropic</p>
  </div>
</footer>

<a class="stub" href="/auth/google?next=%2Fapp%2F" aria-label="Continue with Google" tabindex="-1"><svg class="mk" width="22" height="22" viewBox="0 0 26 26" aria-hidden="true"><rect x="4" y="2.5" width="18" height="21" rx="3" fill="#0071e3"/><rect x="7" y="2.5" width="2" height="21" fill="#005bb8"/><path d="M12 9h7M12 13h7M12 17h4.5" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg><span>Continue with Google</span></a>
<script>${JS(ASK)}</script>
</body></html>`;
}

// A row of n half-circles cut into the top edge (drawn in the ground colour over the paper).
const scallops = n => { const w = 100; let d = 'M0 0'; for (let i = 0; i < n; i++) d += ` L${i * w} 0 A${w / 2} 24 0 0 0 ${(i + 1) * w} 0`; return d + ' Z'; };
const ARROW_L = '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ARROW_R = '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const CSS = `
@font-face{font-family:"Rubik";src:url(/landing/fonts/rubik-latin-wght-normal.woff2) format("woff2");font-weight:300 900;font-display:swap;unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
@font-face{font-family:"Rubik";src:url(/landing/fonts/rubik-hebrew-wght-normal.woff2) format("woff2");font-weight:300 900;font-display:swap;unicode-range:U+0307-0308,U+0590-05FF,U+200C-2010,U+20AA,U+25CC,U+FB1D-FB4F}
:root{
  --field:#0b3d91; --field-ink:#ffffff; --field-soft:#c9d8f2;
  --desk:#eef0f4; --paper:#ffffff; --ink:#1d1d1f; --soft:#55555c;
  --accent:#0071e3; --accent-press:#005bb8; --accent-ink:#ffffff; --marker:#ffe066;
  --display:"Rubik",-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
  --text:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI Variable Text","Segoe UI","Rubik",system-ui,sans-serif;
  --m:clamp(16px,2.2vw,32px); --gap:clamp(120px,14vw,200px);
  --s-small:14px; --s-body:17px; --s-lead:clamp(22px,1.1rem + .6vw,28px); --s-head:clamp(40px,1.5rem + 2.6vw,60px); --s-title:clamp(52px,1rem + 5.4vw,104px);
  --ease:cubic-bezier(.2,.9,.25,1); color-scheme:light}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%;scroll-behavior:smooth}
body{margin:0;background:var(--field);color:var(--ink);font:400 var(--s-body)/1.55 var(--text);-webkit-font-smoothing:antialiased;caret-color:var(--accent)}
::selection{background:var(--marker);color:var(--ink)}
img{display:block;max-width:100%;height:auto}
a{color:inherit;text-underline-offset:.2em;text-decoration-thickness:2px}
:focus-visible{outline:3px solid var(--marker);outline-offset:3px}
h1,h2,h3{font-family:var(--display);font-weight:700;letter-spacing:-.03em;line-height:.95;margin:0;text-wrap:balance}
h2{font-size:var(--s-head)}
p{margin:0;text-wrap:pretty}
main{position:relative;z-index:2;background:var(--field)}

/* buttons: one shape (fully round), one fill */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:12px;min-height:52px;padding:12px 26px;border-radius:999px;font:600 var(--s-body)/1 var(--text);text-decoration:none;border:0;cursor:pointer;transition:transform 160ms var(--ease),background-color 160ms var(--ease)}
.btn:active{transform:scale(.97)}
.go{background:var(--accent);color:var(--accent-ink)}
.go svg{background:#fff;border-radius:50%;padding:4px;width:26px;height:26px}
.go:hover{background:var(--accent-press)}
.go.is-off{background:var(--desk);color:var(--soft);cursor:default}
.link{font-weight:600;color:var(--accent);text-decoration:underline 2px transparent;text-underline-offset:.25em;transition:text-decoration-color 200ms var(--ease)}
.link:hover{text-decoration-color:currentColor}

/* hero: the card over the notebook */
.hero{position:relative;height:150svh}
.room{position:sticky;top:0;height:100svh;overflow:hidden;margin-bottom:-100svh}
.room img{width:100%;height:100%;object-fit:cover;object-position:left top;filter:grayscale(.3)}
.room::after{content:"";position:absolute;inset:0;background:var(--field);opacity:.78}
.hero-pin{position:sticky;top:0;height:100svh;display:grid;place-items:center;padding:var(--m)}
.card{position:relative;z-index:1;width:min(64vw,880px);min-height:min(54svh,540px);background:var(--paper);padding:clamp(22px,2.6vw,36px);display:grid;grid-template-rows:auto 1fr auto auto;gap:clamp(18px,2.2vw,30px);transform-origin:0 100%}
.card h1{font-size:min(var(--s-title),5.9vw);display:flex;justify-content:space-between;flex-wrap:wrap;gap:0 .3em;text-transform:uppercase;letter-spacing:-.035em;line-height:.86}
.facts{display:grid;gap:4px;align-content:start;font:600 var(--s-lead)/1.12 var(--display);letter-spacing:-.01em}
.claim{font:600 var(--s-lead)/1.12 var(--display);letter-spacing:-.01em;max-width:30ch;color:var(--accent)}
.card-foot{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:16px}
.credit{font-size:var(--s-small);color:var(--soft)}
.card-foot .link{justify-self:end}

/* saved: slips of real output along the bottom edge */
.saved{position:relative;min-height:100svh;padding-top:clamp(64px,12svh,140px);overflow:hidden;color:var(--field-ink);display:grid;grid-template-rows:auto auto 1fr}
.saved-photo{position:absolute;inset:0;z-index:0}
.saved-photo img{width:100%;height:100%;object-fit:cover;filter:grayscale(.3)}
.saved-photo::after{content:"";position:absolute;inset:0;background:var(--field);opacity:.92}
.saved-text,.printer{position:relative;z-index:1;margin-inline-start:18vw;max-width:min(34ch,70vw)}
.saved-text{max-width:min(40ch,70vw);display:grid;gap:22px}
.saved-text h2{font-size:var(--s-head)}
.saved-text p{font-size:var(--s-lead);line-height:1.25;max-width:30ch}
.printer{margin-top:36px;max-width:min(860px,78vw)}
.printer-q{font-weight:600;margin-bottom:12px}
.asks{display:flex;flex-wrap:wrap;gap:10px}
.ask{font:600 var(--s-body)/1.2 var(--text);border:0;border-radius:999px;min-height:44px;padding:10px 18px;background:rgba(255,255,255,.14);color:#fff;cursor:pointer;transition:background-color 160ms var(--ease),transform 160ms var(--ease)}
.ask:hover{background:rgba(255,255,255,.24)}
.ask:active{transform:scale(.97)}
.ask[aria-pressed="true"]{background:var(--paper);color:var(--ink)}
.slips{position:relative;z-index:1;align-self:end;display:flex;gap:12px;align-items:flex-end;padding:56px var(--m) 0;margin-bottom:-2px}
.slip{flex:1 1 0;min-width:0;height:var(--h);background:var(--paper);color:var(--ink);padding:18px 18px 0;font-size:var(--s-small);line-height:1.45;overflow:hidden;transform:rotate(var(--t));transform-origin:50% 100%}
.slip h3{font:600 var(--s-small)/1.3 var(--text);letter-spacing:0;margin-bottom:6px}
.slip .dots{color:var(--soft);letter-spacing:.1em;overflow:hidden;white-space:nowrap;margin-bottom:6px}
.slip p+p{margin-top:4px}
.slip.live{flex-grow:1.35;background:var(--marker)}
.slip.live .prac{margin-top:12px;font-weight:600}
.slip.live.print{animation:print 520ms var(--ease)}
@keyframes print{from{transform:translateY(40%)}}

/* one study session: a drag row of moments */
.session{background:var(--desk);padding:var(--gap) 0 calc(var(--gap) * .8)}
.session-head{display:flex;align-items:end;justify-content:space-between;gap:24px;padding:0 var(--m)}
.row-btns{display:flex;gap:8px}
.sq{width:48px;height:48px;display:grid;place-items:center;border:0;background:var(--ink);color:#fff;cursor:pointer;transition:transform 160ms var(--ease),background-color 160ms var(--ease)}
.sq:hover{background:var(--accent)}
.sq:active{transform:scale(.94)}
.track{margin:24px var(--m) 40px;height:6px;background:#d5d9e2;position:relative}
.track-on{position:absolute;inset-block:0;inset-inline-start:0;width:18%;background:var(--ink);transition:width 120ms linear}
.row{display:flex;gap:32px;overflow-x:auto;scroll-snap-type:x mandatory;padding:0 var(--m) 12px;scrollbar-width:none;outline:none}
.row::-webkit-scrollbar{display:none}
.moment{flex:none;width:280px;margin:0;scroll-snap-align:start;display:flex;flex-direction:column}
.moment figcaption{display:grid;gap:8px;min-height:7.5em}
.moment b{font:700 var(--s-body)/1.2 var(--display);letter-spacing:-.01em}
.moment span{font-size:var(--s-small);color:var(--soft);line-height:1.45}
.moment img{margin-top:var(--gap);width:280px;aspect-ratio:4/5;object-fit:cover;object-position:left top;background:var(--paper)}

/* what's included: a price list on paper with cut edges */
.menu-ground{padding:var(--gap) var(--m);display:grid;justify-items:center}
.menu-sheet{width:min(600px,100%);background:var(--paper);padding:64px clamp(20px,4vw,48px) 72px;
  clip-path:polygon(0 12px,4% 0,8% 12px,12% 0,16% 12px,20% 0,24% 12px,28% 0,32% 12px,36% 0,40% 12px,44% 0,48% 12px,52% 0,56% 12px,60% 0,64% 12px,68% 0,72% 12px,76% 0,80% 12px,84% 0,88% 12px,92% 0,96% 12px,100% 0,100% calc(100% - 12px),96% 100%,92% calc(100% - 12px),88% 100%,84% calc(100% - 12px),80% 100%,76% calc(100% - 12px),72% 100%,68% calc(100% - 12px),64% 100%,60% calc(100% - 12px),56% 100%,52% calc(100% - 12px),48% 100%,44% calc(100% - 12px),40% 100%,36% calc(100% - 12px),32% 100%,28% calc(100% - 12px),24% 100%,20% calc(100% - 12px),16% 100%,12% calc(100% - 12px),8% 100%,4% calc(100% - 12px),0 100%)}
.menu-sheet h2{text-align:center;margin-bottom:40px}
.price{width:100%;border-collapse:collapse;margin-top:44px}
.price:first-of-type{margin-top:0}
.price caption{text-align:start;font:700 var(--s-lead)/1.2 var(--display);letter-spacing:-.01em;padding-bottom:10px}
.price tr{display:grid;grid-template-columns:auto minmax(24px,1fr) auto;align-items:baseline;column-gap:10px;padding:9px 0}
.price th{text-align:start;font-weight:600;font-size:var(--s-body)}
.price .lead{border-bottom:4px dotted #c7ccd6;align-self:end;margin-bottom:.35em}
.price .val{text-align:end;white-space:nowrap;font-weight:600;color:var(--accent)}
.price .ds{grid-column:1/-1;font-size:var(--s-small);color:var(--soft);max-width:40ch;padding-top:2px}

/* questions beside a tall picture */
.faq{background:var(--paper);display:grid;grid-template-columns:5fr 1fr 6fr;padding:0 var(--m) var(--gap);gap:0}
.faq-text{grid-column:1;padding-top:var(--gap);display:grid;gap:28px;align-content:start}
.facts2{display:grid;gap:6px;font-weight:600}
.qs{display:grid;gap:12px}
details{border-radius:0}
summary{list-style:none;display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:44px;cursor:pointer;font:600 var(--s-body)/1.3 var(--text)}
summary::-webkit-details-marker{display:none}
summary i{flex:none;width:12px;height:12px;position:relative;transition:transform 220ms var(--ease)}
summary i::before,summary i::after{content:"";position:absolute;top:5px;width:8px;height:2px;background:currentColor;border-radius:2px}
summary i::before{left:0;transform:rotate(45deg)}summary i::after{right:0;transform:rotate(-45deg)}
details[open] summary i{transform:rotate(180deg)}
.ans{padding:6px 0 10px;color:var(--soft);max-width:52ch}
.ans a{color:var(--accent)}
.faq-act{display:flex;align-items:center;gap:24px;flex-wrap:wrap;margin-top:8px}
.faq-pics{grid-column:3;position:relative;padding-bottom:80px;width:min(100%,460px);justify-self:end}
.faq-pics .tall{width:100%;aspect-ratio:3/4;object-fit:cover;object-position:top}
.faq-pics .sqpic{position:absolute;width:34%;aspect-ratio:1;object-fit:cover;object-position:top;left:-40px;bottom:40px;outline:10px solid var(--paper)}

/* the back of the card, revealed from under the page */
.back{position:relative;background:var(--field);padding:96px var(--m) var(--m)}
.postcard{position:relative;width:min(1180px,100%);margin:0 auto;background:var(--paper);min-height:420px;padding:72px clamp(20px,4vw,56px) 28px;display:grid;grid-template-columns:1fr 1fr;gap:32px 56px}
.scallops{position:absolute;top:-1px;left:0;width:100%;height:24px}
.scallops.s6{display:none}
.pc-left{display:grid;gap:18px;align-content:start}
.pc-left h2{font-size:var(--s-lead);letter-spacing:-.02em;line-height:1.05}
.pc-left p{max-width:44ch}
.pc-right{position:relative;padding-top:12px}
.stamp{position:absolute;top:-24px;inset-inline-end:0;width:88px;background:var(--paper);padding:6px;transform:rotate(3deg)}
.stamp img{width:100%;aspect-ratio:3/4;object-fit:cover;object-position:top}
.addr{list-style:none;margin:0;padding:0;display:grid;gap:12px}
.addr a{font-weight:600;text-decoration:underline 2px transparent;text-underline-offset:.25em;transition:text-decoration-color 200ms var(--ease)}
.addr a:hover{text-decoration-color:currentColor}
.imprint{grid-column:1/-1;text-align:center;font-size:var(--s-small);color:var(--soft);align-self:end}

/* the stub: once the card has gone, the action stays at hand */
.stub .mk{background:#fff;border-radius:50%;padding:3px;width:28px;height:28px}
.stub{position:fixed;left:var(--m);bottom:calc(var(--m) + env(safe-area-inset-bottom));z-index:5;display:flex;align-items:center;gap:10px;min-height:52px;padding:10px 20px 10px 14px;border-radius:999px;background:var(--accent);color:var(--accent-ink);font-weight:600;text-decoration:none;
  transform:translateY(160%);transition:transform 360ms var(--ease)}
.stub.on{transform:none}
.stub:active{transform:scale(.97)}

/* motion: entrances (content is never left hidden without script) */
@media (prefers-reduced-motion:no-preference){
  .js [data-reveal]{opacity:0;translate:0 24px;transition:opacity 700ms var(--ease),translate 700ms var(--ease)}
  .js [data-reveal].is-in{opacity:1;translate:0 0}
  .js .moment[data-reveal]:nth-child(2){transition-delay:70ms}.js .moment[data-reveal]:nth-child(3){transition-delay:140ms}.js .moment[data-reveal]:nth-child(4){transition-delay:210ms}
  .js .slips .slip[data-reveal]{translate:0 60px}
  .js .slips .slip[data-reveal]:nth-of-type(3){transition-delay:80ms}.js .slips .slip[data-reveal]:nth-of-type(4){transition-delay:160ms}.js .slips .slip[data-reveal]:nth-of-type(5){transition-delay:240ms}.js .slips .slip[data-reveal]:nth-of-type(6){transition-delay:320ms}.js .slips .slip[data-reveal]:nth-of-type(7){transition-delay:400ms}
  .room img{animation:drift 26s ease-in-out infinite alternate}
  @keyframes drift{from{transform:scale(1.04) translate3d(0,0,0)}to{transform:scale(1.1) translate3d(-1.5%,-1%,0)}}
  @supports (animation-timeline:view()){
    .card{animation:to-stub linear both;animation-timeline:scroll(root);animation-range:0 100svh}
    @keyframes to-stub{to{transform:scale(.3) translate(-30vw,50svh);opacity:0}}
  }
}

/* phone */
@media (max-width:760px){
  :root{--s-title:clamp(44px,13vw,64px)}
  .hero{height:170svh}
  .card{width:100%;min-height:70svh;padding:22px 20px}
  .card h1{flex-direction:column;gap:0;font-size:clamp(44px,14vw,64px)}
  .facts,.claim{font-size:clamp(20px,5.2vw,24px)}
  .card-foot{grid-template-columns:1fr;justify-items:stretch;text-align:center;gap:14px}
  .card-foot .credit{order:3}.card-foot .link{justify-self:center;order:2}
  .saved-text,.printer{margin-inline-start:var(--m);max-width:calc(100vw - 2 * var(--m))}
  .slips{overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none}
  .slips::-webkit-scrollbar{display:none}
  .slip{flex:none;width:62vw;scroll-snap-align:start}
  .slip.live{width:78vw}
  .row-btns{display:none}
  .row{gap:16px}
  .moment{width:72vw}
  .moment img{width:100%;margin-top:calc(var(--gap) * .4)}
  .faq{grid-template-columns:1fr;padding-bottom:72px}
  .faq-pics{grid-column:1;grid-row:1;margin:0 calc(var(--m) * -1);padding-bottom:0}
  .faq-pics .tall{aspect-ratio:4/5}
  .faq-pics .sqpic{width:38%;left:auto;right:16px;bottom:-24px}
  .faq-text{grid-column:1;padding-top:64px}
  .faq-act .btn{width:100%}
  .postcard{grid-template-columns:1fr;padding-top:64px}
  .scallops.s12{display:none}.scallops.s6{display:block}
  .stamp{width:64px;top:-40px}
  .menu-sheet{width:100%;padding:56px 20px 64px}
  .price tr{grid-template-columns:minmax(0,1fr) auto}
  .price .lead{display:none}
  .stub{display:none}
}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}.stub{transition:none}}
`;

const JS = ask => `
(()=>{
  // Entrances: reveal once, never leave content hidden.
  const els=[...document.querySelectorAll('[data-reveal]')];
  if('IntersectionObserver' in window){const io=new IntersectionObserver(es=>{for(const e of es)if(e.isIntersecting){e.target.classList.add('is-in');io.unobserve(e.target)}},{rootMargin:'0px 0px -10% 0px',threshold:.08});els.forEach(e=>io.observe(e));
    addEventListener('load',()=>setTimeout(()=>els.forEach(e=>{const r=e.getBoundingClientRect();if(r.top<innerHeight&&r.bottom>0)e.classList.add('is-in')}),2000));}
  else els.forEach(e=>e.classList.add('is-in'));
  // The stub appears once the card has gone.
  const stub=document.querySelector('.stub'),hero=document.querySelector('.hero'),back=document.querySelector('.back');
  let past=false,atEnd=false,inSlips=false,inFaq=false;const paint=()=>{const on=past&&!atEnd&&!inSlips&&!inFaq;stub.classList.toggle('on',on);stub.tabIndex=on?0:-1};
  new IntersectionObserver(([e])=>{inSlips=e.isIntersecting;paint()},{threshold:0}).observe(document.querySelector('.saved'));
  new IntersectionObserver(([e])=>{inFaq=e.isIntersecting;paint()},{threshold:0}).observe(document.querySelector('.faq'));
  addEventListener('scroll',()=>{past=scrollY>innerHeight*.9;atEnd=innerHeight+scrollY>=document.documentElement.scrollHeight-back.offsetHeight*.6;paint()},{passive:true});
  // The printer: pick a question, print what gets saved.
  const ASK=${JSON.stringify(ask)};
  const live=document.getElementById('liveSlip');
  const esc=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
  document.querySelectorAll('[data-ask]').forEach(b=>b.addEventListener('click',()=>{
    const a=ASK[+b.dataset.ask];document.querySelectorAll('[data-ask]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));
    live.innerHTML='<h3>'+esc(a.save)+'</h3><p class="dots" aria-hidden="true">· · · · · · · · · · · · · · · ·</p>'+a.note.map(l=>'<p>'+esc(l)+'</p>').join('')+'<p class="prac">'+esc(a.prac)+'</p>';
    live.classList.remove('print');void live.offsetWidth;live.classList.add('print');
  }));
  // The row of moments: buttons, and a bar that shows how far it has been scrolled.
  const row=document.querySelector('.row'),bar=document.querySelector('.track-on');
  const prog=()=>{const max=row.scrollWidth-row.clientWidth;bar.style.width=(max>0?Math.max(.12,(row.scrollLeft+row.clientWidth)/row.scrollWidth)*100:100)+'%'};
  row.addEventListener('scroll',prog,{passive:true});addEventListener('resize',prog);prog();
  document.querySelectorAll('[data-row]').forEach(b=>b.addEventListener('click',()=>row.scrollBy({left:+b.dataset.row*312,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'})));
})();`;
