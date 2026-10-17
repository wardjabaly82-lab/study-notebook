'use strict';
// The speech-to-text engine for lecture recording: whisper.cpp, running
// privately on this computer. Downloaded once (verified by checksum), then
// started as a local server that only this computer can reach.
const fs = require('fs');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const WHISPER_VERSION = 'v1.8.2';
const RELEASES = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_VERSION}`;

// Windows builds of the engine, pinned by SHA-256.
const ENGINES = {
  cuda: { label: 'NVIDIA graphics card', file: 'whisper-cublas-12.4.0-bin-x64.zip', size: 457274520, sha256: '54a3c012e6c567e2e8bed874cdf49c55f018ec8d90bb5d5271568aa573291b2d' },
  cpu: { label: 'processor', file: 'whisper-bin-x64.zip', size: 3832432, sha256: 'b1514ebc099765e39fa37eb780b92a140a94c86bb0b3b3d98226b38825979732' }
};

// Speech models. "general" handles English, Arabic and mixed lectures; "hebrew"
// is the ivrit.ai model trained on Hebrew speech.
const MODELS = {
  general: { label: 'Whisper large-v3-turbo', file: 'ggml-large-v3-turbo.bin', url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin', size: 1624555275, sha1: '4af2b29d7ec73d781377bfd1758ca957a807e941' },
  hebrew: { label: 'ivrit.ai Hebrew model', repo: 'ivrit-ai/whisper-large-v3-turbo-ggml', file: 'ggml-ivrit-large-v3-turbo.bin' }
};

const LANGS = { he: 'hebrew', en: 'general', ar: 'general', auto: 'general' };

class EngineError extends Error { constructor(code, message) { super(message || code); this.code = code; } }

function create({ dataDir, log, onProgress }) {
  const engineDir = path.join(dataDir, 'speech');
  const stateFile = path.join(engineDir, 'state.json');
  const readState = () => { try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch (e) { return {}; } };
  const writeState = s => { fs.mkdirSync(engineDir, { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(s, null, 2)); };

  // Developer/test override: a whisper-server binary and model given directly.
  const override = process.env.SN_WHISPER_SERVER ? { server: process.env.SN_WHISPER_SERVER, model: process.env.SN_WHISPER_MODEL } : null;
  const supported = !!override || (process.platform === 'win32' && process.arch === 'x64');

  let gpu = undefined;          // undefined = not checked, null = none, string = GPU name
  let server = null;            // { proc, port, modelKey, variant }
  let starting = null;
  let downloading = null;

  function detectGpu() {
    if (gpu !== undefined) return Promise.resolve(gpu);
    if (process.platform !== 'win32') return Promise.resolve(gpu = null);
    return new Promise(res => {
      execFile('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader'], { timeout: 8000, windowsHide: true }, (err, out) => {
        gpu = !err && out && out.trim() ? out.trim().split('\n')[0].split(',')[0].trim() : null;
        log.info('speech.gpu', { gpu: gpu || 'none' });
        res(gpu);
      });
    });
  }

  /* ---------- downloads (resumable, verified) ---------- */

  // Downloads with resume. If the connection stalls (no data for STALL ms) it
  // reconnects and continues where it stopped, up to RETRIES times.
  const STALL = Number(process.env.SN_STALL_MS) || 20000, RETRIES = 6;
  let current = null;   // { ctl, cancelled } for the download in progress

  async function download(url, dest, info) {
    for (let attempt = 0; ; attempt++) {
      try { return await downloadOnce(url, dest, info); }
      catch (e) {
        if (e.code === 'cancelled' || e.code === 'checksum' || attempt >= RETRIES) throw e;
        log.warn('speech.download.retry', { label: info.label, attempt: attempt + 1, reason: e.code || e.message });
        onProgress({ stage: 'retry', label: info.label, attempt: attempt + 1 });
        await new Promise(r => setTimeout(r, Math.min(15000, 1500 * 2 ** attempt)));
        if (current && current.cancelled) throw new EngineError('cancelled', 'Download cancelled.');
      }
    }
  }

  async function downloadOnce(url, dest, { size, sha256, sha1, label }) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const part = dest + '.part';
    const algo = sha256 ? 'sha256' : 'sha1';
    const want = (sha256 || sha1 || '').toLowerCase();
    const hash = crypto.createHash(algo);
    let have = 0;
    if (fs.existsSync(part)) {
      // Resume: hash what is already on disk first.
      await new Promise((ok, bad) => fs.createReadStream(part).on('data', d => { hash.update(d); have += d.length; }).on('end', ok).on('error', bad));
    }
    const ctl = new AbortController();
    const me = current = { ctl, cancelled: current ? current.cancelled : false };
    if (me.cancelled) throw new EngineError('cancelled', 'Download cancelled.');
    let stalled = false, timer = null;
    const watch = () => { clearTimeout(timer); timer = setTimeout(() => { stalled = true; ctl.abort(); }, STALL); };
    const why = e => me.cancelled ? new EngineError('cancelled', 'Download cancelled.') : stalled ? new EngineError('stalled', 'The download stopped receiving data.') : e instanceof EngineError ? e : new EngineError('network', (e && e.message) || 'network error');
    watch();
    let res;
    try { res = await fetch(url, { headers: have ? { Range: `bytes=${have}-` } : {}, redirect: 'follow', signal: ctl.signal }); }
    catch (e) { clearTimeout(timer); throw why(e); }
    if (have && res.status === 200) { // server ignored the range: start over
      clearTimeout(timer); ctl.abort(); fs.rmSync(part, { force: true });
      return downloadOnce(url, dest, { size, sha256, sha1, label });
    }
    if (have && res.status === 416) { clearTimeout(timer); ctl.abort(); fs.rmSync(part, { force: true }); throw new EngineError('network', 'range not satisfiable'); }
    if (!res.ok && res.status !== 206) { clearTimeout(timer); throw new EngineError('download_failed', `HTTP ${res.status} for ${label}`); }
    const total = size || (Number(res.headers.get('content-length')) || 0) + have;
    const out = fs.createWriteStream(part, { flags: have ? 'a' : 'w' });
    let last = 0;
    try {
      for await (const chunk of res.body) {
        watch();
        hash.update(chunk); have += chunk.length;
        if (!out.write(chunk)) await new Promise(r => out.once('drain', r));
        const now = Date.now();
        if (now - last > 400) { last = now; onProgress({ stage: 'download', label, done: have, total }); }
      }
    } catch (e) { throw why(e); }
    finally { clearTimeout(timer); await new Promise(r => out.end(r)); }
    if (me.cancelled) throw new EngineError('cancelled', 'Download cancelled.');
    if (total && have < total) throw new EngineError('network', `incomplete: ${have} of ${total}`);
    const got = hash.digest('hex');
    if (want && got !== want) {
      fs.rmSync(part, { force: true });
      log.error('speech.checksum', { label, want, got });
      throw new EngineError('checksum', `The ${label} download was damaged. Try again.`);
    }
    fs.renameSync(part, dest);
    onProgress({ stage: 'download', label, done: have, total, finished: true });
  }

  // Stops a download in progress; what was downloaded so far is kept for next time.
  function cancel() { if (current) { current.cancelled = true; try { current.ctl.abort(); } catch (e) {} } }

  // Unpacks a zip with Windows' built-in tar.
  function unzip(zip, dir) {
    return new Promise((ok, bad) => {
      fs.mkdirSync(dir, { recursive: true });
      execFile('tar', ['-xf', zip, '-C', dir], { windowsHide: true, timeout: 600000 }, err => err ? bad(new EngineError('unpack', 'Couldn’t unpack the speech engine.')) : ok());
    });
  }

  function engineBinary(variant) {
    const p = path.join(engineDir, 'engine-' + variant, 'Release', 'whisper-server.exe');
    return fs.existsSync(p) ? p : null;
  }
  const modelPath = key => path.join(engineDir, MODELS[key].file);

  async function ensureEngine(variant) {
    if (engineBinary(variant)) return engineBinary(variant);
    const e = ENGINES[variant];
    const zip = path.join(engineDir, e.file);
    await download(`${RELEASES}/${e.file}`, zip, { size: e.size, sha256: e.sha256, label: 'speech engine' });
    onProgress({ stage: 'unpack', label: 'speech engine' });
    await unzip(zip, path.join(engineDir, 'engine-' + variant));
    fs.rmSync(zip, { force: true });
    if (!engineBinary(variant)) throw new EngineError('unpack', 'The speech engine is incomplete.');
    log.info('speech.engine.ready', { variant });
    return engineBinary(variant);
  }

  // The Hebrew model's file name and checksum come from the model site's listing.
  async function hebrewModelInfo() {
    const res = await fetch(`https://huggingface.co/api/models/${MODELS.hebrew.repo}/tree/main`);
    if (!res.ok) throw new EngineError('no_hebrew_model', `HTTP ${res.status}`);
    const files = (await res.json()).filter(f => /\.bin$/.test(f.path) && f.lfs && f.lfs.oid);
    const pick = files.find(f => !/q\d|quant/i.test(f.path)) || files[0];
    if (!pick) throw new EngineError('no_hebrew_model', 'No model file listed');
    return { url: `https://huggingface.co/${MODELS.hebrew.repo}/resolve/main/${pick.path}`, size: pick.size || pick.lfs.size, sha256: pick.lfs.oid };
  }

  async function ensureModel(key) {
    const dest = modelPath(key);
    if (fs.existsSync(dest)) return { path: dest, key };
    if (key === 'hebrew') {
      try {
        const info = await hebrewModelInfo();
        await download(info.url, dest, { size: info.size, sha256: info.sha256, label: 'Hebrew speech model' });
        return { path: dest, key };
      } catch (e) {
        if (e.code === 'cancelled') throw e;
        log.warn('speech.hebrew_model.unavailable', { error: e.message });
        const g = await ensureModel('general');
        return { ...g, fellBack: true };
      }
    }
    const m = MODELS[key];
    await download(m.url, dest, { size: m.size, sha1: m.sha1, label: 'speech model' });
    return { path: dest, key };
  }

  /* ---------- the local server ---------- */

  const freePort = () => new Promise((ok, bad) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); s.on('error', bad); });

  async function launch(bin, model, variant) {
    const port = await freePort();
    const threads = Math.max(2, Math.min(8, require('os').cpus().length - 1));
    const args = ['-m', model, '--host', '127.0.0.1', '--port', String(port), '-t', String(threads), '-nt'];
    const proc = spawn(bin, args, { cwd: path.dirname(bin), windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let errTail = '';
    proc.stderr.on('data', d => { errTail = (errTail + d).slice(-2000); });
    const exited = new Promise(r => proc.once('exit', code => r(code)));
    const t0 = Date.now();
    while (Date.now() - t0 < 180000) {
      const code = await Promise.race([exited, new Promise(r => setTimeout(() => r('wait'), 400))]);
      if (code !== 'wait') { log.warn('speech.server.exited', { variant, code, tail: errTail.slice(-400) }); return null; }
      try { const r = await fetch(`http://127.0.0.1:${port}/`); if (r.ok) { log.info('speech.server.ready', { variant, ms: Date.now() - t0 }); return { proc, port }; } } catch (e) {}
    }
    proc.kill(); return null;
  }

  async function start(lang) {
    const key = LANGS[lang] || 'general';
    if (server && server.modelKey === key && server.proc.exitCode === null) return server;
    if (starting) await starting.catch(() => {});
    if (server && server.modelKey === key && server.proc.exitCode === null) return server;
    starting = (async () => {
      stop();
      current = null;
      if (!supported) throw new EngineError('unsupported', 'Lecture recording works on Windows for now.');
      if (override) {
        const s = await launch(override.server, override.model, 'test');
        if (!s) throw new EngineError('start_failed', 'The speech engine didn’t start.');
        return (server = { ...s, modelKey: key, variant: 'test', fellBack: false });
      }
      downloading = true;
      try {
        await detectGpu();
        const model = await ensureModel(key);
        let variant = gpu ? 'cuda' : 'cpu';
        let bin = await ensureEngine(variant);
        onProgress({ stage: 'starting' });
        let s = await launch(bin, model.path, variant);
        if (!s && variant === 'cuda') {
          // The graphics card build didn't start (e.g. an old driver): use the processor build.
          log.warn('speech.cuda_fallback');
          variant = 'cpu'; bin = await ensureEngine('cpu'); onProgress({ stage: 'starting' });
          s = await launch(bin, model.path, variant);
        }
        if (!s) throw new EngineError('start_failed', 'The speech engine didn’t start.');
        const st = readState(); st.variant = variant; st.gpu = gpu; writeState(st);
        return (server = { ...s, modelKey: model.key, wanted: key, variant, fellBack: !!model.fellBack });
      } finally { downloading = false; }
    })();
    try { return await starting; } finally { starting = null; }
  }

  function stop() { if (server) { try { server.proc.kill(); } catch (e) {} server = null; } }

  // 16 kHz mono 16-bit PCM -> WAV file bytes.
  function wav(pcm16) {
    const data = Buffer.from(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength);
    const h = Buffer.alloc(44);
    h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
    h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(16000, 24);
    h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
    return Buffer.concat([h, data]);
  }

  async function transcribe(pcm16, lang, prompt) {
    const s = await start(lang);
    const form = new FormData();
    form.append('file', new Blob([wav(pcm16)], { type: 'audio/wav' }), 'chunk.wav');
    form.append('language', lang === 'auto' ? 'auto' : lang);
    form.append('response_format', 'json');
    form.append('temperature', '0');
    if (prompt) form.append('prompt', String(prompt).slice(-220));
    const res = await fetch(`http://127.0.0.1:${s.port}/inference`, { method: 'POST', body: form });
    if (!res.ok) throw new EngineError('transcribe_failed', `HTTP ${res.status}`);
    const j = await res.json();
    if (j.error) throw new EngineError('transcribe_failed', j.error);
    return String(j.text || '').trim();
  }

  function status() {
    const st = readState();
    const has = k => fs.existsSync(modelPath(k));
    let bytes = 0;
    const walk = d => { try { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else bytes += fs.statSync(p).size; } } catch (e) {} };
    walk(engineDir);
    return {
      supported, gpu: gpu === undefined ? st.gpu : gpu, variant: server ? server.variant : st.variant || null,
      engineReady: !!override || !!(engineBinary('cuda') || engineBinary('cpu')),
      models: { general: !!override || has('general'), hebrew: !!override || has('hebrew') },
      bytes, running: !!server, downloading: !!downloading, fellBack: !!(server && server.fellBack)
    };
  }

  // What the first recording in a language will download, for the setup message.
  async function needs(lang) {
    if (override || !supported) return { bytes: 0 };
    await detectGpu();
    const key = LANGS[lang] || 'general';
    const variant = gpu ? 'cuda' : 'cpu';
    let bytes = 0;
    if (!engineBinary(variant)) bytes += ENGINES[variant].size;
    if (!fs.existsSync(modelPath(key))) bytes += key === 'hebrew' ? 1624555275 : MODELS.general.size;
    return { bytes, gpu };
  }

  function remove() {
    stop();
    fs.rmSync(engineDir, { recursive: true, force: true });
    log.info('speech.removed');
  }

  return { start, stop, cancel, transcribe, status, needs, remove, detectGpu, EngineError, _download: download };
}

module.exports = { create, LANGS };
