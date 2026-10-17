/* Study timer: a free stopwatch, or a study plan that alternates study and breaks
   (Pomodoro, 45/15, 50/10, 52/17, 90/20 or your own). Time is kept from timestamps, so it stays
   right when the window sleeps; the state is saved, so a reload keeps it. Minutes spent studying
   (not breaks) add up per day on this device. app.js calls init() and puts button() in the toolbar. */
(() => {
  'use strict';
  const MIN = 60000;
  const METHODS = {
    pomodoro: { name: 'Pomodoro', study: 25, brk: 5, long: 15, every: 4, why: '25 min study, 5 min break, a 15 min break after every 4 rounds. Good for getting started and for flashcards.' },
    m45: { name: '45 / 15', study: 45, brk: 15, why: '45 min study, 15 min break. A steady pace for a long day of revision.' },
    m50: { name: '50 / 10', study: 50, brk: 10, why: '50 min study, 10 min break. Good for dense reading and proofs.' },
    m52: { name: '52 / 17', study: 52, brk: 17, why: '52 min study, 17 min break: the rhythm seen in the most focused people in DeskTime’s usage data.' },
    m90: { name: '90 / 20', study: 90, brk: 20, why: '90 min study, 20 min break, for work you can’t split, like a full past exam.' },
    custom: { name: 'My own', study: 40, brk: 10, why: 'Pick your own study and break lengths.' }
  };
  let A = null;                 // what app.js gives us: t, tn, esc, toast, dir
  let S = load(), last = Date.now(), pop = null;

  function load() {
    const d = { mode: 'free', method: 'pomodoro', custom: { study: 40, brk: 10 }, running: false, started: false, phase: 'study', round: 1, elapsed: 0, saved: 0 };
    try { return { ...d, ...JSON.parse(localStorage.getItem('sn-timer') || '{}') }; } catch (e) { return d; }
  }
  function persist() { S.saved = Date.now(); try { localStorage.setItem('sn-timer', JSON.stringify(S)); } catch (e) {} }
  const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  function logGet() { try { return JSON.parse(localStorage.getItem('sn-study-log') || '{}'); } catch (e) { return {}; } }
  function logAdd(ms) {
    if (ms <= 0) return;
    const l = logGet(), k = dayKey(); l[k] = (l[k] || 0) + ms;
    const keep = Object.keys(l).sort().slice(-60); const out = {}; for (const x of keep) out[x] = l[x];
    try { localStorage.setItem('sn-study-log', JSON.stringify(out)); } catch (e) {}
  }
  function totals() {
    const l = logGet(), now = new Date(); let week = 0;
    for (let i = 0; i < 7; i++) { const d = new Date(now); d.setDate(now.getDate() - i); week += l[dayKey(d)] || 0; }
    return { today: l[dayKey()] || 0, week };
  }

  const M = () => S.method === 'custom' ? { ...METHODS.custom, ...S.custom } : METHODS[S.method] || METHODS.pomodoro;
  const phaseLen = () => { const m = M(); return (S.phase === 'study' ? m.study : S.phase === 'long' ? m.long : m.brk) * MIN; };
  const studying = () => S.mode === 'free' || S.phase === 'study';

  // Advance the clock by the real time since the last tick.
  function tick(now) {
    const dt = Math.max(0, now - last); last = now;
    if (!S.running) return;
    if (S.mode === 'free') { S.elapsed += dt; logAdd(dt); persist(); return; }
    const len = phaseLen(), before = S.elapsed;
    S.elapsed += dt;
    if (S.phase === 'study') logAdd(Math.min(dt, Math.max(0, len - before)));
    if (S.elapsed >= len) nextPhase(true);
    persist();
  }
  function nextPhase(auto) {
    const m = M();
    if (S.phase === 'study') S.phase = m.long && S.round % m.every === 0 ? 'long' : 'break';
    else { S.phase = 'study'; S.round++; }
    S.elapsed = 0;
    if (auto) {
      chime(S.phase === 'study');
      const t = A.t;
      A.toast(S.phase === 'study' ? t('Break’s over. Round {n}: back to studying.', { n: S.round }) : S.phase === 'long' ? t('Round done. Take a long break: {m} min.', { m: m.long }) : t('Round done. Take a break: {m} min.', { m: m.brk }));
    }
  }
  // Two soft notes when a study block or a break ends.
  function chime(up) {
    try {
      const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
      const ctx = chime.ctx || (chime.ctx = new C());
      (up ? [523.25, 783.99] : [783.99, 523.25]).forEach((f, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain(), t0 = ctx.currentTime + i * 0.22;
        o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.18, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
        o.connect(g).connect(ctx.destination); o.start(t0); o.stop(t0 + 1);
      });
    } catch (e) {}
  }

  const fmt = ms => { const s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`; };
  const fmtLong = ms => { const m = Math.floor(ms / MIN), h = Math.floor(m / 60); return h ? A.t('{h} h {m} min', { h, m: m % 60 }) : A.t('{m} min', { m }); };
  const clock = () => S.mode === 'free' ? fmt(S.elapsed) : fmt(phaseLen() - S.elapsed);
  const phaseName = () => S.mode === 'free' ? A.t('Studying') : S.phase === 'study' ? A.t('Study · round {n}', { n: S.round }) : S.phase === 'long' ? A.t('Long break') : A.t('Break');

  const ICON = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="7.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 9.5V13l2.5 1.6M9.5 2.8h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  function button() {
    const { t, esc } = A;
    if (!S.started) return `<button class="btn timer-btn" id="timerBtn" type="button" aria-haspopup="dialog" aria-expanded="${!!pop}">${ICON}${t('Timer')}</button>`;
    return `<button class="btn timer-btn live ${studying() ? 'study' : 'rest'}${S.running ? '' : ' paused'}" id="timerBtn" type="button" aria-haspopup="dialog" aria-expanded="${!!pop}" title="${esc(phaseName())}"><span class="t-dot" aria-hidden="true"></span><span class="t-clock">${clock()}</span>${S.running ? '' : `<span class="t-pause">${t('Paused')}</span>`}</button>`;
  }

  function panel() {
    const { t, esc } = A, m = M(), tot = totals();
    const seg = `<div class="seg" role="group" aria-label="${esc(t('Timer type'))}"><button type="button" data-tm="free" aria-pressed="${S.mode === 'free'}" ${S.started ? 'disabled' : ''}>${t('Free timer')}</button><button type="button" data-tm="plan" aria-pressed="${S.mode === 'plan'}" ${S.started ? 'disabled' : ''}>${t('Study plan')}</button></div>`;
    let body;
    if (S.mode === 'plan' && !S.started) {
      body = `<div class="methods" role="radiogroup" aria-label="${esc(t('Study method'))}">${Object.entries(METHODS).map(([k, x]) => `<button type="button" role="radio" class="method" data-method="${k}" aria-checked="${S.method === k}"><b>${esc(t(x.name))}</b><small>${esc(t(x.why))}</small></button>`).join('')}</div>
        ${S.method === 'custom' ? `<div class="row custom"><label class="field">${t('Study (min)')}<input type="number" id="tmStudy" min="5" max="180" value="${S.custom.study}"></label><label class="field">${t('Break (min)')}<input type="number" id="tmBreak" min="1" max="60" value="${S.custom.brk}"></label></div>` : ''}`;
    } else {
      const pct = S.mode === 'plan' ? Math.min(100, 100 * S.elapsed / phaseLen()) : 0;
      const next = S.mode === 'plan' ? (S.phase === 'study' ? (m.long && S.round % m.every === 0 ? t('Next: a {m} min long break', { m: m.long }) : t('Next: a {m} min break', { m: m.brk })) : t('Next: {m} min of study', { m: m.study })) : t('Counts up. Pause whenever you like.');
      body = `<div class="t-face ${studying() ? 'study' : 'rest'}"><div class="t-phase">${esc(S.mode === 'plan' ? `${t(m.name)} · ${phaseName()}` : phaseName())}</div><div class="t-big" dir="ltr">${clock()}</div>
        ${S.mode === 'plan' ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}<div class="small t-next">${esc(next)}</div></div>`;
    }
    const go = !S.started ? `<button class="btn primary" type="button" data-ta="start">${t('Start')}</button>`
      : S.running ? `<button class="btn primary" type="button" data-ta="pause">${t('Pause')}</button>` : `<button class="btn primary" type="button" data-ta="resume">${t('Resume')}</button>`;
    const more = S.started ? `${S.mode === 'plan' ? `<button class="btn" type="button" data-ta="skip">${S.phase === 'study' ? t('Take the break now') : t('Skip the break')}</button>` : ''}<button class="btn ghost" type="button" data-ta="stop">${t('Stop')}</button>` : '';
    return `<div class="t-head"><h2>${t('Study timer')}</h2><button type="button" class="sn-x" data-ta="close" aria-label="${esc(t('Close'))}">×</button></div>${seg}${body}
      <div class="row">${go}${more}</div>
      <p class="small t-total">${esc(t('Studied today: {a}', { a: fmtLong(tot.today) }))} · ${esc(t('This week: {a}', { a: fmtLong(tot.week) }))}</p>`;
  }

  function place() {
    const b = document.getElementById('timerBtn'); if (!pop || !b) return;
    const r = b.getBoundingClientRect(), w = pop.offsetWidth;
    pop.style.top = Math.round(r.bottom + 8) + 'px';
    const left = A.dir === 'rtl' ? r.left : r.right - w;
    pop.style.left = Math.round(Math.max(12, Math.min(innerWidth - w - 12, left))) + 'px';
  }
  function draw() { if (!pop) return; pop.innerHTML = panel(); place(); }
  function open() {
    if (pop) return close();
    pop = document.createElement('div'); pop.className = 'timer-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', A.t('Study timer')); pop.dir = A.dir;
    document.body.appendChild(pop); draw(); refreshBtn();
    const f = pop.querySelector('[data-ta="start"],[data-ta="pause"],[data-ta="resume"]'); if (f) f.focus();
  }
  function close() { if (pop) { pop.remove(); pop = null; refreshBtn(); const b = document.getElementById('timerBtn'); if (b) b.focus(); } }
  function refreshBtn() { const b = document.getElementById('timerBtn'); if (b) b.outerHTML = button(); }

  function act(a) {
    tick(Date.now());
    if (a === 'start') { if (S.mode === 'plan' && S.method === 'custom') readCustom(); Object.assign(S, { started: true, running: true, phase: 'study', round: 1, elapsed: 0 }); last = Date.now(); }
    else if (a === 'pause') S.running = false;
    else if (a === 'resume') { S.running = true; last = Date.now(); }
    else if (a === 'skip') nextPhase(false);
    else if (a === 'stop') Object.assign(S, { started: false, running: false, phase: 'study', round: 1, elapsed: 0 });
    else if (a === 'close') return close();
    persist(); draw(); refreshBtn(); title();
  }
  function readCustom() {
    const n = (id, lo, hi, d) => { const el = pop && pop.querySelector(id); const v = Math.round(+(el && el.value)); return v >= lo && v <= hi ? v : d; };
    S.custom = { study: n('#tmStudy', 5, 180, S.custom.study), brk: n('#tmBreak', 1, 60, S.custom.brk) };
  }
  function title() { document.title = S.started ? `${clock()} · ${phaseName()} · Study Notebook` : 'Study Notebook'; }

  function init(api) {
    A = api;
    // Closed for a while with the timer running (app shut, laptop asleep): don't count that time.
    if (S.running && Date.now() - (S.saved || 0) > 2 * MIN) { S.running = false; persist(); setTimeout(() => A.toast(A.t('Your study timer was paused while the app was closed.')), 1200); }
    last = Date.now();
    setInterval(() => {
      const phase = S.phase; tick(Date.now());
      if (!S.started) return;
      const b = document.getElementById('timerBtn');
      if (b) { const c = b.querySelector('.t-clock'); if (c) c.textContent = clock(); b.classList.toggle('study', studying()); b.classList.toggle('rest', !studying()); }
      if (pop) { if (phase !== S.phase) draw(); else { const big = pop.querySelector('.t-big'), bar = pop.querySelector('.bar i'); if (big) big.textContent = clock(); if (bar) bar.style.width = Math.min(100, 100 * S.elapsed / phaseLen()) + '%'; } }
      title();
    }, 1000);
    document.addEventListener('click', e => {
      if (e.target.closest('#timerBtn')) { open(); return; }
      if (!pop) return;
      if (!pop.contains(e.target)) { if (!e.target.closest('.toast')) close(); return; }
      const tm = e.target.closest('[data-tm]'); if (tm && !S.started) { S.mode = tm.dataset.tm; persist(); draw(); return; }
      const me = e.target.closest('[data-method]'); if (me && !S.started) { S.method = me.dataset.method; persist(); draw(); return; }
      const a = e.target.closest('[data-ta]'); if (a) act(a.dataset.ta);
    });
    document.addEventListener('change', e => { if (pop && (e.target.id === 'tmStudy' || e.target.id === 'tmBreak')) { readCustom(); persist(); } });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && pop) close(); });
    addEventListener('resize', place);
    title();
  }
  window.StudyTimer = { init, button, place: () => place() };
})();
