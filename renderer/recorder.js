/* Lecture recorder: captures the sound playing on this computer (the lecture
   in Chrome), transcribes it live with the local speech engine, and saves the
   transcript to the course as it goes. Claude turns it into notes later. */
(() => {
  'use strict';
  const D = window.desktop, SN = window.SN;
  if (!D || !SN) return;
  const T = (k, v) => window.I18N.t(k, v);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const RATE = 16000;
  const SILENT = 0.0045;            // below this level counts as silence
  const TARGET = 20, MAX = 28, MIN_PAUSE_SPLIT = 6;   // seconds
  const LANG_LABEL = { he: 'Hebrew', en: 'English', ar: 'Arabic', auto: 'Mixed or not sure' };
  const fmtTime = s => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + String(x).padStart(2, '0'); };
  const gb = b => (b / 1e9).toFixed(b > 5e9 ? 0 : 1) + ' GB';

  const R = {
    state: 'idle',    // idle | setup | preparing | recording | finishing | done | error
    lang: (() => { try { return localStorage.getItem('sn-rec-lang') || 'he'; } catch (e) { return 'he'; } })(),
    title: '', courseId: '', lectureId: '', error: '', progress: null, needs: null, status: null,
    paused: false, seconds: 0, level: 0, silentFor: 0, live: [], failures: 0, collapsed: false, fellBack: false, variant: ''
  };
  let ctx = null, stream = null, node = null, testSrc = null, timer = null;
  let pending = [], pendingLen = 0, frames = [], chunkStart = 0, queue = Promise.resolve(), text = '';

  /* ---------- panel ---------- */
  const panel = document.createElement('section');
  panel.className = 'rec'; panel.hidden = true; panel.setAttribute('aria-label', T('Lecture recording'));
  document.body.appendChild(panel);

  D.onSpeechProgress(p => {
    if (p.stage === 'download') {
      const now = Date.now(), sp = R.speed;
      if (!sp || sp.label !== p.label || p.done < sp.done) R.speed = { label: p.label, t: now, done: p.done, rate: 0 };
      else if (now - sp.t >= 2000) { const r = (p.done - sp.done) / ((now - sp.t) / 1000); R.speed = { label: p.label, t: now, done: p.done, rate: sp.rate ? sp.rate * 0.6 + r * 0.4 : r }; }
      R.retry = 0;
    } else if (p.stage === 'retry') R.retry = p.attempt;
    if (p.stage !== 'retry') R.progress = p;
    if (R.state === 'preparing') draw();
  });

  function draw() {
    if (R.state === 'idle') { panel.hidden = true; SN.updateRecBtn(); return; }
    panel.hidden = false;
    const c = SN.courseById(R.courseId);
    let body = '';
    if (R.state === 'setup') {
      const n = R.needs && R.needs.bytes;
      body = `<form class="rec-form" id="recForm">
        <label class="field">${T('Lecture name')}<input id="recTitle" maxlength="120" value="${esc(R.title)}" dir="auto" required></label>
        <label class="field">${T('Spoken language')}<select id="recLang">${Object.entries(LANG_LABEL).map(([v, l]) => `<option value="${v}"${v === R.lang ? ' selected' : ''}>${T(l)}</option>`).join('')}</select></label>
        <p class="small">${esc(R.status && !R.status.supported ? T('Lecture recording works on Windows for now.') : n ? T('The first recording downloads the speech engine ({size}, once). It runs on your {device}, privately on this computer.', { size: gb(n), device: R.needs.gpu || T('processor') }) : R.needs && R.needs.gpu ? T('Runs on your {device}, privately on this computer.', { device: R.needs.gpu }) : T('Runs privately on this computer.'))}</p>
        <div class="row"><button class="btn primary" type="submit" ${R.status && !R.status.supported ? 'disabled' : ''}><span class="rec-dot"></span>${T('Start recording')}</button><button class="btn ghost" type="button" data-rec="close">${T('Cancel')}</button></div>
      </form>`;
    } else if (R.state === 'preparing') {
      const p = R.progress;
      const pct = p && p.total ? Math.round(100 * p.done / p.total) : null;
      const line = esc(!p ? T('Getting ready…') : p.stage === 'download' ? T('Downloading the {what}: {done} of {total}', { what: T(p.label), done: gb(p.done), total: gb(p.total) }) : p.stage === 'unpack' ? T('Unpacking the speech engine…') : T('Starting the speech engine…'));
      const rate = R.speed && R.speed.rate && p && p.stage === 'download' ? R.speed.rate : 0;
      const left = rate && p.total ? Math.max(0, (p.total - p.done) / rate) : 0;
      const sub = R.retry ? T('The connection stalled. Reconnecting and continuing where it stopped (try {n} of 6)…', { n: R.retry })
        : rate ? T('{speed} MB/s, about {time} left', { speed: (rate / 1e6).toFixed(1), time: left > 90 ? T('{m} min', { m: Math.ceil(left / 60) }) : T('{s} sec', { s: Math.ceil(left) }) }) : '';
      body = `<p class="rec-line">${line}</p><div class="bar"><i style="width:${pct == null ? 100 : pct}%" class="${pct == null ? 'busy' : ''}"></i></div>
        ${sub ? `<p class="small">${esc(sub)}</p>` : ''}
        <p class="small">${T('This happens once. You can keep using the app. If you cancel, the download continues from the same point next time.')}</p>
        <div class="row"><button class="btn ghost" type="button" data-rec="cancel">${T('Cancel')}</button></div>`;
    } else if (R.state === 'recording' || R.state === 'finishing') {
      const warn = R.state === 'recording' && !R.paused && R.silentFor > 15 ? `<p class="rec-warn">${T('No sound is coming in. Is the lecture playing in Chrome, and not muted?')}</p>` : '';
      body = `<div class="rec-live">
          <span class="rec-dot ${R.paused || R.state === 'finishing' ? 'still' : 'on'}"></span>
          <b>${T(R.state === 'finishing' ? 'Writing the last part…' : R.paused ? 'Paused' : 'Recording')}</b>
          <span class="rec-time">${fmtTime(R.seconds)}</span>
          <span class="meter" aria-hidden="true"><i style="width:${Math.min(100, Math.round(R.level * 900))}%"></i></span>
        </div>
        ${R.state === 'recording' && R.seconds < 20 && !R.live.length ? `<p class="small">${T('Play the lecture in Chrome now. Keep other sounds off; everything you hear gets transcribed.')}</p>` : ''}
        ${warn}
        ${R.collapsed ? '' : `<div data-n="${R.live.length}" class="rec-text" dir="${SN.dirFor(R.lang)}">${R.live.length ? R.live.slice(-6).map(t => { const m = t.match(/^\[([\d:]+)\]\s*(.*)$/); return m ? `<p><span class="ts">${esc(m[1])}</span>${esc(m[2])}</p>` : `<p>${esc(t)}</p>`; }).join('') : `<p class="small">${T('The transcript appears here as the lecture plays.')}</p>`}</div>`}
        <div class="row">${R.state === 'recording' ? `<button class="btn" type="button" data-rec="pause">${T(R.paused ? 'Resume' : 'Pause')}</button><button class="btn danger" type="button" data-rec="stop">${T('Stop and save')}</button>` : ''}
          <button class="btn ghost" type="button" data-rec="collapse">${T(R.collapsed ? 'Show text' : 'Hide text')}</button></div>`;
    } else if (R.state === 'done') {
      body = `<p class="rec-line"><b>${esc(T('Saved to {course}.', { course: c ? c.name : '' }))}</b> ${T('To turn it into notes, tell Claude in the Claude app:')}</p>
        <p class="say-box" dir="auto">${esc(SN.askClaude(R.courseId, R.lectureId))}</p>
        <div class="row"><button class="btn primary" type="button" data-rec="copy">${T('Copy')}</button><button class="btn" type="button" data-rec="open">${T('Open transcript')}</button><button class="btn ghost" type="button" data-rec="close">${T('Close')}</button></div>`;
    } else if (R.state === 'error') {
      body = `<p class="rec-warn">${esc(R.error)}</p><div class="row"><button class="btn" type="button" data-rec="retry">${T('Try again')}</button><button class="btn ghost" type="button" data-rec="close">${T('Close')}</button></div>`;
    }
    panel.innerHTML = `<div class="rec-head"><h2>${R.state === 'setup' ? T('Record a lecture') : esc(R.title || T('Lecture'))}</h2>${R.state === 'recording' || R.state === 'preparing' || R.state === 'finishing' ? '' : '<button class="sn-x" type="button" data-rec="close" aria-label="' + esc(T('Close')) + '">×</button>'}</div>${body}`;
    if (R.state === 'setup') {
      const f = panel.querySelector('#recForm');
      f.onsubmit = e => { e.preventDefault(); R.title = panel.querySelector('#recTitle').value.trim() || R.title; R.lang = panel.querySelector('#recLang').value; try { localStorage.setItem('sn-rec-lang', R.lang); } catch (e2) {} begin(); };
      panel.querySelector('#recLang').onchange = async e => { R.lang = e.target.value; R.needs = await D.speechNeeds(R.lang); R.title = panel.querySelector('#recTitle').value; draw(); };
    }
    SN.updateRecBtn();
  }

  panel.addEventListener('click', async e => {
    const b = e.target.closest('[data-rec]'); if (!b) return;
    switch (b.dataset.rec) {
      case 'close': if (R.state === 'setup' || R.state === 'done' || R.state === 'error') { R.state = 'idle'; draw(); } break;
      case 'pause': R.paused = !R.paused; draw(); break;
      case 'cancel': if (R.state === 'preparing') { R.cancelled = true; D.speechCancel(); } break;
      case 'stop': stop(); break;
      case 'collapse': R.collapsed = !R.collapsed; draw(); break;
      case 'copy': SN.copy(SN.askClaude(R.courseId, R.lectureId)); break;
      case 'open': SN.openLecture(R.courseId, R.lectureId); R.state = 'idle'; draw(); break;
      case 'retry': R.state = 'setup'; draw(); break;
    }
  });

  /* ---------- open ---------- */
  window.openRecorder = async () => {
    if (R.state !== 'idle' && R.state !== 'done' && R.state !== 'error') { R.collapsed = false; draw(); return; }
    const c = SN.course(); if (!c) return;
    R.courseId = c.id; R.state = 'setup'; R.error = ''; R.progress = null;
    const d = new Date();
    R.title = T('Lecture, {date}', { date: d.toLocaleDateString(window.I18N.lang === 'he' ? 'he-IL' : undefined, { day: 'numeric', month: 'short' }) });
    draw();
    [R.status, R.needs] = await Promise.all([D.speechStatus(), D.speechNeeds(R.lang)]);
    if (R.state === 'setup') draw();
  };
  window.recorderState = () => ({ active: ['preparing', 'recording', 'finishing'].includes(R.state), seconds: R.seconds, courseId: R.courseId, lectureId: R.lectureId, state: R.state });

  /* ---------- start ---------- */
  async function begin() {
    R.state = 'preparing'; R.progress = null; R.speed = null; R.retry = 0; R.cancelled = false; draw();
    const s = await D.speechStart(R.lang);
    if (!s.ok && (R.cancelled || s.code === 'cancelled')) { R.state = 'idle'; draw(); SN.toast(T('Download paused. It continues from the same point next time you record.')); return; }
    if (!s.ok) return fail(T(s.message || 'The speech engine didn’t start.'));
    R.fellBack = !!s.fellBack; R.variant = s.variant;
    if (R.fellBack) SN.toast(T('The Hebrew model isn’t available right now, so this lecture uses the general model.'));

    try {
      ctx = new AudioContext();
      await ctx.audioWorklet.addModule('rec-worklet.js');
      node = new AudioWorkletNode(ctx, 'capture');
      const mute = ctx.createGain(); mute.gain.value = 0;
      node.connect(mute).connect(ctx.destination);
      const testBytes = await D.speechTestAudio();
      if (testBytes) {
        const buf = await ctx.decodeAudioData(testBytes.buffer.slice(testBytes.byteOffset, testBytes.byteOffset + testBytes.byteLength));
        testSrc = ctx.createBufferSource(); testSrc.buffer = buf; testSrc.connect(node); testSrc.onended = () => setTimeout(() => { if (R.state === 'recording') stop(); }, 1500); testSrc.start();
      } else {
        stream = await captureSystemSound();
        stream.getVideoTracks().forEach(t => t.stop());
        const a = stream.getAudioTracks();
        if (!a.length) throw new Error('nosound');
        a[0].addEventListener('ended', () => { if (R.state === 'recording') stop(); });
        ctx.createMediaStreamSource(new MediaStream(a)).connect(node);
      }
    } catch (e) {
      console.error('Lecture recording: sound capture failed:', e && e.name, e && e.message);
      cleanup(); D.speechStop();
      return fail(T(e && e.message === 'nosound' ? 'Couldn’t capture the computer’s sound. Make sure sound is playing, then try again.' : 'Couldn’t start capturing sound on this computer.'));
    }

    const now = Date.now();
    R.lectureId = 'l' + now.toString(36) + Math.random().toString(36).slice(2, 6);
    text = ''; goodTail = ''; R.live = []; R.seconds = 0; R.silentFor = 0; R.paused = false; R.failures = 0;
    pending = []; pendingLen = 0; frames = []; chunkStart = 0; queue = Promise.resolve();
    SN.putLecture(R.courseId, R.lectureId, { title: R.title, lang: R.lang, startedAt: now, durationSec: 0, text: '', status: 'recording', engine: R.variant });
    node.port.onmessage = e => onFrame(e.data);
    R.state = 'recording'; draw();
    timer = setInterval(() => { if (R.state === 'recording') drawLive(); }, 500);
  }

  // The sound playing on this computer. The standard screen-capture request first,
  // then Chromium's older desktop-capture request as a backup.
  async function captureSystemSound() {
    try { return await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }); }
    catch (e1) {
      console.error('Lecture recording: getDisplayMedia failed, trying desktop capture:', e1 && e1.name, e1 && e1.message);
      return navigator.mediaDevices.getUserMedia({ audio: { mandatory: { chromeMediaSource: 'desktop' } }, video: { mandatory: { chromeMediaSource: 'desktop' } } });
    }
  }

  function fail(msg) { R.state = 'error'; R.error = msg; draw(); }

  /* ---------- audio in ---------- */
  function resample(f32, from) {
    if (from === RATE) return f32;
    const ratio = from / RATE, n = Math.floor(f32.length / ratio), out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.floor(i * ratio), b = Math.min(f32.length, Math.floor((i + 1) * ratio));
      let s = 0; for (let j = a; j < b; j++) s += f32[j];
      out[i] = s / Math.max(1, b - a);   // averaging also filters out high frequencies
    }
    return out;
  }

  function onFrame(raw) {
    if (R.state !== 'recording' || R.paused) return;
    const f = resample(raw, ctx.sampleRate);
    let sum = 0; for (let i = 0; i < f.length; i++) sum += f[i] * f[i];
    const rms = Math.sqrt(sum / Math.max(1, f.length));
    R.level = rms;
    R.seconds += f.length / RATE;
    R.silentFor = rms < SILENT ? R.silentFor + f.length / RATE : 0;
    pending.push(f); frames.push(rms); pendingLen += f.length;
    const secs = pendingLen / RATE;
    // Cut at a natural pause, or at the quietest moment once the piece is long enough.
    const tail = frames.slice(-7);
    if (secs >= MIN_PAUSE_SPLIT && tail.length === 7 && tail.every(x => x < SILENT * 1.5)) return cut(frames.length);
    if (secs >= TARGET) {
      const look = Math.min(frames.length, 40); let best = frames.length, bestV = Infinity;
      for (let i = frames.length - look; i < frames.length - 2; i++) { const v = frames[i] + frames[i + 1] + frames[i + 2]; if (v < bestV) { bestV = v; best = i + 2; } }
      if (secs >= MAX || bestV < SILENT * 6) return cut(best);
    }
  }

  function cut(nFrames) {
    const take = pending.slice(0, nFrames), levels = frames.slice(0, nFrames);
    pending = pending.slice(nFrames); frames = frames.slice(nFrames);
    pendingLen = pending.reduce((a, x) => a + x.length, 0);
    const len = take.reduce((a, x) => a + x.length, 0);
    const start = chunkStart; chunkStart += len / RATE;
    send(take, len, levels, start);
  }

  function send(parts, len, levels, start) {
    // Trim silence at the start so the timestamp points to where speech begins (keep 0.3 s of lead-in).
    let skip = 0; while (skip < levels.length - 1 && levels[skip] < SILENT) skip++;
    skip = Math.max(0, skip - 3);
    if (skip) { const cut = parts.slice(0, skip).reduce((a, x) => a + x.length, 0); parts = parts.slice(skip); levels = levels.slice(skip); len -= cut; start += cut / RATE; }
    const sorted = levels.slice().sort((a, b) => a - b);
    const loud = sorted[Math.floor(sorted.length * 0.9)] || 0;
    if (loud < SILENT * 1.3 || len < RATE * 0.8) return;   // silence: nothing to transcribe
    const pcm = new Int16Array(len); let o = 0;
    for (const p of parts) for (let i = 0; i < p.length; i++) { const v = Math.max(-1, Math.min(1, p[i])); pcm[o++] = v < 0 ? v * 0x8000 : v * 0x7fff; }
    const lid = R.lectureId, cid = R.courseId, lang = R.lang;
    queue = queue.then(async () => {
      const r = await D.speechTranscribe(pcm, lang, promptFor(cid));
      if (!r.ok) {
        R.failures++;
        add(cid, lid, start, T('(This part couldn’t be transcribed.)'));
        if (R.failures >= 3 && R.state === 'recording') { SN.toast(T('The speech engine stopped working. Saving what was recorded.')); stop(); }
        return;
      }
      R.failures = 0;
      const t = clean(r.text);
      if (t) add(cid, lid, start, t);
      // Only text the engine was sure about is passed on as context, so one mistake can't snowball.
      if (r.doubtful || !t) goodTail = ''; else goodTail = (goodTail + ' ' + t).slice(-200);
    });
  }

  // Context for the next piece: the course name (helps with its vocabulary) and the last reliable text.
  let goodTail = '';
  function promptFor(cid) {
    const c = SN.courseById && SN.courseById(cid);
    return [c && c.name ? c.name + '.' : '', goodTail.trim()].filter(Boolean).join(' ');
  }

  // Drops what speech engines tend to "hear" in music or noise.
  function clean(t) {
    t = String(t || '').replace(/\s+/g, ' ').trim();
    if (!t || /^[\s.,!?…\-–—"'()[\]]*$/.test(t)) return '';
    if (/^\[?(music|מוזיקה|موسيقى|blank_audio|silence)\]?$/i.test(t.replace(/[()*]/g, ''))) return '';
    return t;
  }

  function add(cid, lid, start, t) {
    const line = `[${fmtTime(start)}] ${t}`;
    text += (text ? '\n\n' : '') + line;
    R.live.push(line); if (R.live.length > 40) R.live.shift();
    SN.patchLecture(cid, lid, { text, durationSec: Math.round(Math.max(R.seconds, start)), updatedAt: Date.now() });
    if (R.state === 'recording' || R.state === 'finishing') drawLive();
  }

  function drawLive() {
    const box = panel.querySelector('.rec-text');
    const time = panel.querySelector('.rec-time'); if (time) time.textContent = fmtTime(R.seconds);
    SN.updateRecBtn();
    const meter = panel.querySelector('.meter i'); if (meter) meter.style.width = Math.min(100, Math.round(R.level * 900)) + '%';
    const warnNeeded = !R.paused && R.silentFor > 15, hasWarn = !!panel.querySelector('.rec-warn');
    if (warnNeeded !== hasWarn || (box && box.childElementCount !== Math.min(6, R.live.length || 1)) || (R.live.length && box && box.dataset.n !== String(R.live.length))) draw();
  }

  /* ---------- stop ---------- */
  async function stop() {
    if (R.state !== 'recording') return;
    R.state = 'finishing'; draw();
    if (pending.length) cut(frames.length);
    cleanup();
    await queue.catch(() => {});
    SN.patchLecture(R.courseId, R.lectureId, { text, durationSec: Math.round(R.seconds), endedAt: Date.now(), status: 'done', updatedAt: Date.now() });
    await SN.saveNow();
    D.speechStop();   // frees the graphics card until the next recording
    R.state = 'done'; draw();
    SN.toast(T('Lecture saved'));
  }
  function cleanup() {
    clearInterval(timer); timer = null;
    try { if (testSrc) testSrc.stop(); } catch (e) {} testSrc = null;
    if (stream) stream.getTracks().forEach(t => t.stop()); stream = null;
    if (node) node.port.onmessage = null;
    if (ctx) ctx.close().catch(() => {}); ctx = null; node = null;
  }

  // Closing the app mid-recording: keep what was transcribed.
  window.recorderOnClose = () => {
    if (R.state === 'recording' || R.state === 'finishing') SN.patchLecture(R.courseId, R.lectureId, { text, durationSec: Math.round(R.seconds), endedAt: Date.now(), status: 'stopped' });
  };
})();
