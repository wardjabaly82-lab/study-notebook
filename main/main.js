'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, nativeTheme, Menu, desktopCapturer, powerSaveBlocker, clipboard, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const crypto = require('crypto');
const log = require('./log');
const printer = require('./print');
const link = require('./connector-link');
const Ops = require('../renderer/notebook-ops.js');
const Engine = require('./engine');
const Updates = require('./updates');
const CloudSync = require('./cloud-sync');
const claudeSetup = require('./claude-setup');

const RENDERER = path.join(__dirname, '..', 'renderer');

// Serve the page from app://notebook/ so it has a real origin (workers, storage).
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

log.init(app.getPath('userData'));
log.info('app.start', { version: app.getVersion(), platform: process.platform, packaged: app.isPackaged });
process.on('uncaughtException', e => log.error('main.crash', { error: e && e.stack }));
process.on('unhandledRejection', e => log.error('main.rejection', { error: e && (e.stack || e) }));

const DEV = !app.isPackaged;

let win = null;

/* ---------- input checks for everything the page sends ---------- */

const MAX_DATA_BYTES = 150 * 1024 * 1024;  // whole notes file
const DOC_PATH = /^data\/users\/local\/[A-Za-z0-9_-]{1,64}(\/(sections|sources|lectures|cards)\/[A-Za-z0-9_-]{1,64})?$/;
const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// The notes file must be exactly the shape the app writes; anything else is rejected.
function validateData(d) {
  if (!isPlainObject(d) || !isPlainObject(d.docs)) return 'That file isn’t a Study Notebook backup.';
  for (const [k, v] of Object.entries(d.docs)) {
    if (!DOC_PATH.test(k) || !isPlainObject(v)) return 'That backup contains data the app doesn’t recognize.';
  }
  return null;
}

function safeFilename(name) {
  const base = path.basename(String(name || 'notes.md')).replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').trim().slice(0, 120);
  return base || 'notes.md';
}

/* ---------- files in the app's data folder ---------- */

const dataDir = () => app.getPath('userData');
const DATA = () => path.join(dataDir(), 'notebook-data.json');
const SETTINGS = () => path.join(dataDir(), 'settings.json');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}

// Write to a temp file first, then swap it in, so a crash never leaves a half-written file.
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  // Readable only by this user account (on Mac/Linux; Windows keeps the profile folder private).
  fs.writeFileSync(tmp, text, { encoding: 'utf8', mode: 0o600 });
  if (fs.existsSync(file)) { try { fs.copyFileSync(file, file.replace(/\.json$/, '.previous.json')); } catch (e) {} }
  fs.renameSync(tmp, file);
}

function loadData() {
  const d = readJson(DATA(), null);
  if (d && d.docs) return d;
  // Fall back to the previous save if the main file is unreadable.
  const prev = readJson(DATA().replace(/\.json$/, '.previous.json'), null);
  return prev && prev.docs ? prev : { version: 1, docs: {} };
}

// A personal installer can carry starter notes. They are loaded once, on the
// very first start, and never replace notes that already exist.
function seedIfFirstRun() {
  if (!app.isPackaged && !process.env.SN_SEED) return;
  const seed = process.env.SN_SEED || path.join(process.resourcesPath, 'seed-notes.json');
  if (!fs.existsSync(seed) || fs.existsSync(DATA()) || fs.existsSync(DATA().replace(/\.json$/, '.previous.json'))) return;
  const d = readJson(seed, null);
  const bad = validateData(d);
  if (bad) { log.warn('seed.rejected', { reason: bad }); return; }
  writeAtomic(DATA(), JSON.stringify({ version: 1, savedAt: Date.now(), docs: d.docs }));
  log.info('seed.loaded', { docs: Object.keys(d.docs).length });
}

/* ---------- automatic daily backups ---------- */
// Notes live only on this computer, so keep a dated copy each day (the last 14).
const BACKUPS = () => path.join(dataDir(), 'backups');
function dailyBackup() {
  try {
    if (!fs.existsSync(DATA())) return;
    fs.mkdirSync(BACKUPS(), { recursive: true });
    const today = new Date().toLocaleDateString('sv');   // YYYY-MM-DD, local date
    const target = path.join(BACKUPS(), `notes-${today}.json`);
    if (!fs.existsSync(target)) {
      const d = readJson(DATA(), null);
      if (d && d.docs && Object.keys(d.docs).length) { fs.copyFileSync(DATA(), target); try { fs.chmodSync(target, 0o600); } catch (e) {} log.info('backup.daily'); }
    }
    const all = fs.readdirSync(BACKUPS()).filter(f => /^notes-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    for (const f of all.slice(0, Math.max(0, all.length - 14))) fs.rmSync(path.join(BACKUPS(), f), { force: true });
  } catch (e) { log.warn('backup.daily.failed', { error: e.message }); }
}
function lastBackup() {
  try { const all = fs.readdirSync(BACKUPS()).filter(f => /^notes-.*\.json$/.test(f)).sort(); return all.length ? all[all.length - 1].slice(6, 16) : null; } catch (e) { return null; }
}

/* ---------- settings ---------- */

function loadSettings() { return readJson(SETTINGS(), {}); }
function saveSettings(s) { writeAtomic(SETTINGS(), JSON.stringify(s, null, 2)); }

// Earlier versions could store AI API keys. The app no longer uses them, so remove them.
function dropOldAiSettings() {
  const s = loadSettings();
  if (s.providers || s.active !== undefined) {
    delete s.providers; delete s.active;
    saveSettings(s);
    log.info('settings.ai_keys_removed');
  }
}

function publicSettings() {
  const s = loadSettings();
  return { dataDir: dataDir(), version: app.getVersion(), lastBackup: lastBackup(), connectorSeen: s.connectorSeen || 0, connectorLastUse: s.connectorLastUse || 0, connectorFile: fs.existsSync(connectorBundle()) };
}
ipcMain.handle('settings:get', () => publicSettings());

/* ---------- notes data ---------- */

ipcMain.handle('store:load', async () => {
  // If the Claude connector is in the middle of saving (app was closed), wait for it.
  const lock = path.join(dataDir(), 'notebook-data.lock');
  for (let i = 0; i < 30 && fs.existsSync(lock); i++) await new Promise(r => setTimeout(r, 100));
  return loadData();
});

ipcMain.handle('store:save', (ev, text) => {
  try {
    if (typeof text !== 'string' || text.length > MAX_DATA_BYTES) throw new Error('data too large');
    const bad = validateData(JSON.parse(text));
    if (bad) throw new Error('invalid data shape');
    writeAtomic(DATA(), text);
    if (cloud) cloud.soon();
    return { ok: true };
  } catch (e) { log.error('store.save.failed', { error: e && e.message }); return { ok: false }; }
});

ipcMain.handle('backup:export', async (ev, text) => {
  const stamp = new Date().toISOString().slice(0, 10);
  const r = await dialog.showSaveDialog(win, {
    title: 'Back up all notes',
    defaultPath: path.join(app.getPath('documents'), `Study Notebook backup ${stamp}.json`),
    filters: [{ name: 'Study Notebook backup', extensions: ['json'] }]
  });
  if (r.canceled || !r.filePath) return { ok: false, cancelled: true };
  if (typeof text !== 'string' || text.length > MAX_DATA_BYTES) return { ok: false };
  try { fs.writeFileSync(r.filePath, text, 'utf8'); } catch (e) { log.error('backup.export.failed', { error: e.message }); return { ok: false, message: 'Couldn’t write the backup there.' }; }
  log.info('backup.export');
  return { ok: true };
});

ipcMain.handle('backup:import', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Restore notes from a backup',
    defaultPath: fs.existsSync(BACKUPS()) ? BACKUPS() : app.getPath('documents'),
    properties: ['openFile'],
    filters: [{ name: 'Study Notebook backup', extensions: ['json'] }]
  });
  if (r.canceled || !r.filePaths[0]) return { ok: false, cancelled: true };
  try { if (fs.statSync(r.filePaths[0]).size > MAX_DATA_BYTES) return { ok: false, message: 'That file is too large to be a Study Notebook backup.' }; }
  catch (e) { return { ok: false, message: 'Couldn’t open that file.' }; }
  const d = readJson(r.filePaths[0], null);
  const bad = validateData(d);
  if (bad) { log.warn('backup.import.rejected', { reason: bad }); return { ok: false, message: bad }; }
  log.info('backup.import', { docs: Object.keys(d.docs).length });
  return { ok: true, data: { docs: d.docs } };
});

ipcMain.handle('file:save', async (ev, req) => {
  const { filename, data } = isPlainObject(req) ? req : {};
  if (typeof data !== 'string' || data.length > MAX_DATA_BYTES) return { ok: false };
  const r = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('documents'), safeFilename(filename)),
    filters: [{ name: 'Markdown', extensions: ['md'] }, { name: 'All files', extensions: ['*'] }]
  });
  if (r.canceled || !r.filePath) return { ok: false, cancelled: true };
  try { fs.writeFileSync(r.filePath, data, 'utf8'); } catch (e) { log.error('file.save.failed', { error: e.message }); return { ok: false }; }
  return { ok: true };
});

/* ---------- print / PDF ---------- */

let printing = false;
let lastSavedPdf = null; // the only file the page may ask to open
async function onePrintAtATime(fn) {
  if (printing) return { ok: false, message: 'Already preparing a printout. Wait a moment.' };
  printing = true;
  try { return await fn(); }
  catch (e) { log.warn('print.failed', { error: e && e.message }); return { ok: false, message: /^(Custom paper|These notes|Nothing to print|Page numbers look wrong)/.test(e && e.message) ? e.message : 'Couldn’t prepare the printout. Try again.' }; }
  finally { printing = false; }
}

ipcMain.handle('print:preview', (ev, req) => onePrintAtATime(async () => {
  const { data } = await printer.makePdf(req && req.payload, req && req.opts, DEV);
  return { ok: true, data };
}));

ipcMain.handle('print:savePdf', (ev, req) => onePrintAtATime(async () => {
  const { data, payload } = await printer.makePdf(req && req.payload, req && req.opts, DEV);
  const name = safeFilename((payload.subtitle ? `${payload.course} - ${payload.subtitle}` : `${payload.course} - Study notes`) + '.pdf').replace(/(\.pdf)?$/i, '.pdf');
  const r = await dialog.showSaveDialog(win, {
    title: 'Save notes as PDF',
    defaultPath: path.join(app.getPath('documents'), name),
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (r.canceled || !r.filePath) return { ok: false, cancelled: true };
  fs.writeFileSync(r.filePath, data);
  lastSavedPdf = r.filePath;
  log.info('print.pdf', { bytes: data.length });
  return { ok: true, path: r.filePath };
}));

ipcMain.handle('print:paper', (ev, req) => onePrintAtATime(async () => {
  const r = await printer.printPaper(req && req.payload, req && req.opts, DEV);
  log.info('print.paper', { ok: r.ok, reason: r.reason });
  if (!r.ok && /cancel/i.test(r.reason)) return { ok: false, cancelled: true };
  return r.ok ? { ok: true } : { ok: false, message: 'The printout didn’t go through. Check the printer and try again.' };
}));

ipcMain.handle('app:openPath', (ev, p) => { if (p && p === lastSavedPdf && fs.existsSync(p)) shell.openPath(p); });
ipcMain.handle('app:showInFolder', (ev, p) => { if (p && p === lastSavedPdf && fs.existsSync(p)) shell.showItemInFolder(p); });

/* ---------- Claude connector ---------- */

const connectorBundle = () => app.isPackaged ? path.join(process.resourcesPath, 'Study Notebook.mcpb') : path.join(__dirname, '..', 'build', 'Study Notebook.mcpb');
let pageReady = false;
const pendingOps = new Map();

function noteConnectorUse(op) {
  if (op !== 'save_section' && op !== 'create_course') return;
  const s = loadSettings(); s.connectorLastUse = Date.now(); saveSettings(s);
}

// While the window is open, the page applies the change so it shows up live.
function forwardToPage(op, args) {
  return new Promise(resolve => {
    const reqId = crypto.randomUUID();
    const t = setTimeout(() => { pendingOps.delete(reqId); resolve({ ok: false, error: 'The Study Notebook app is busy. Try again.' }); }, 15000);
    pendingOps.set(reqId, r => { clearTimeout(t); resolve(r); });
    win.webContents.send('connector:op', { reqId, op, args });
  });
}
ipcMain.on('connector:ready', () => { pageReady = true; if (cloud) cloud.sync(); });
ipcMain.on('connector:result', (ev, r) => {
  const done = r && pendingOps.get(r.reqId);
  if (!done) return;
  pendingOps.delete(r.reqId);
  done({ ok: !!r.ok, result: r.result, error: r.ok ? undefined : String(r.error || 'The app couldn’t do that.').slice(0, 500) });
});

// Without a window (e.g. closed on a Mac but still running), apply it to the file.
function applyToFile(op, args) {
  try {
    const d = loadData();
    const { result, writes } = Ops.run(d.docs, op, args);
    if (writes.length) {
      for (const w of writes) { if (w.data === null) delete d.docs[w.path]; else d.docs[w.path] = w.data; }
      const bad = validateData(d); if (bad) throw new Error(bad);
      writeAtomic(DATA(), JSON.stringify({ version: 1, savedAt: Date.now(), docs: d.docs }));
    }
    return { ok: true, result };
  } catch (e) {
    if (!(e instanceof Ops.OpError)) log.error('connector.file.failed', { error: e.message });
    return { ok: false, error: e instanceof Ops.OpError ? e.message : 'Couldn’t save to the notes file.' };
  }
}

/* ---------- online notebook (use Study Notebook in any Claude chat) ---------- */
let cloud = null;
// Changes from the online notebook: the open window applies them live; otherwise straight to the file.
async function applyCloudChanges(changes) {
  if (win && !win.isDestroyed() && pageReady) {
    const r = await forwardToPage('__cloud_apply', { changes });
    if (r.ok) return;
    throw new Error(r.error || 'The app couldn’t apply the online changes.');
  }
  const d = loadData();
  for (const c of changes) { if (c.data === null) delete d.docs[c.path]; else d.docs[c.path] = c.data; }
  const bad = validateData(d); if (bad) throw new Error(bad);
  writeAtomic(DATA(), JSON.stringify({ version: 1, savedAt: Date.now(), docs: d.docs }));
}
const seal = pw => safeStorage.isEncryptionAvailable() ? { key: safeStorage.encryptString(pw).toString('base64'), sealed: true } : { key: Buffer.from(pw, 'utf8').toString('base64'), sealed: false };
const unseal = c => { try { return c.sealed ? safeStorage.decryptString(Buffer.from(c.key, 'base64')) : Buffer.from(c.key, 'base64').toString('utf8'); } catch (e) { return ''; } };
// The shared Study Notebook site. Each student signs in there with Google; this app links to that account.
const SITE = (process.env.SN_SITE || 'https://study-notebook.wardjabaly82.workers.dev').replace(/\/+$/, '');
function cloudConfig() {
  const c = loadSettings().cloud;
  if (!c || c.kind !== 'google' || !c.url || !c.key) return null;     // an old password connection no longer works
  return { url: c.url, token: unseal(c), email: c.email, name: c.name };
}
function startCloud() {
  cloud = CloudSync.create({ dataDir, loadData, applyChanges: applyCloudChanges, log, onStatus: s => { if (win && !win.isDestroyed()) win.webContents.send('cloud:status', s); } });
  cloud.configure(cloudConfig());
}
ipcMain.handle('cloud:status', () => {
  const st = cloud ? cloud.status() : { enabled: false };
  const c = loadSettings().cloud;
  if (!st.enabled && c && c.kind !== 'google' && c.url) st.url = c.url;   // shows "sign in with Google instead"
  return st;
});

// Opens a link in the person's browser. Tests set SN_OPEN_LOG to receive the link instead.
function openInBrowser(url) {
  if (process.env.SN_OPEN_LOG) { fs.appendFileSync(process.env.SN_OPEN_LOG, url + '\n'); return; }
  shell.openExternal(url);
}
const b64url = buf => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
let signingIn = null;
// Sign in with Google: the browser opens the site, the student approves linking this computer, and the
// site hands a one-time code back to a small listener on this computer only (127.0.0.1), which the app
// trades (with a secret it never sent) for its own sign-in.
ipcMain.handle('cloud:signin', async () => {
  if (signingIn) { signingIn.abort(); }
  const http = require('http'); const os = require('os');
  const state = b64url(crypto.randomBytes(24)), verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  let server; const ctl = { abort: () => {} }; signingIn = ctl;
  try {
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { msg: 'Signing in took too long. Try again.' })), 10 * 60 * 1000);
      ctl.abort = () => { clearTimeout(timer); reject(Object.assign(new Error('aborted'), { msg: 'Signing in was restarted.' })); };
      server = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://127.0.0.1');
        if (u.pathname !== '/done' || u.searchParams.get('state') !== state) { res.writeHead(404); res.end(); return; }
        const ok = !!u.searchParams.get('code');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Study Notebook</title><style>body{font:16px/1.5 -apple-system,"Segoe UI",system-ui,sans-serif;background:#f5f5f7;color:#1d1d1f;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}@media(prefers-color-scheme:dark){body{background:#19191b;color:#f5f5f7}}main{max-width:420px}h1{font-size:24px;letter-spacing:-.02em;margin:0 0 8px}</style><main><h1>${ok ? 'You’re signed in' : 'Not linked'}</h1><p>${ok ? 'Go back to the Study Notebook app. You can close this tab.' : 'Nothing was changed. You can close this tab.'}</p></main>`);
        clearTimeout(timer);
        if (ok) resolve(u.searchParams.get('code')); else reject(Object.assign(new Error('denied'), { msg: 'Signing in was cancelled.' }));
      });
      server.on('error', e => { clearTimeout(timer); reject(Object.assign(e, { msg: 'Couldn’t start signing in on this computer.' })); });
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        const q = new URLSearchParams({ port: String(port), state, challenge, device: os.hostname().slice(0, 60) });
        openInBrowser(`${SITE}/link?${q}`);
      });
    });
    let r;
    try {
      r = await fetch(`${SITE}/auth/app/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, verifier }), signal: AbortSignal.timeout(30000) });
    } catch (e) { return { ok: false, message: 'Can’t reach Study Notebook online. Check the internet connection.' }; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.token) return { ok: false, message: 'Signing in didn’t finish. Try again.' };
    const s = loadSettings(); s.cloud = { kind: 'google', url: SITE, ...seal(j.token), email: j.email, name: j.name, since: Date.now() }; saveSettings(s);
    cloud.reset(); cloud.configure({ url: SITE, token: j.token, email: j.email, name: j.name });
    const st = await cloud.sync();
    log.info('cloud.signedin');
    if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.focus(); }
    return { ok: !st.error, status: st, message: st.error || '' };
  } catch (e) {
    return { ok: false, message: e.msg || 'Couldn’t sign in.' };
  } finally {
    if (signingIn === ctl) signingIn = null;
    if (server) server.close();
  }
});
ipcMain.handle('cloud:disconnect', async () => { if (cloud) await cloud.signOut(); const s = loadSettings(); delete s.cloud; saveSettings(s); cloud.configure(null); cloud.reset(); log.info('cloud.signedout'); return { ok: true }; });
ipcMain.handle('cloud:sync', () => cloud ? cloud.sync() : { enabled: false });

async function handleConnector(op, args) {
  if (op === 'ping') {
    // The Claude app just started the connector: it's connected.
    const s = loadSettings(); s.connectorSeen = Date.now(); saveSettings(s);
    log.info('connector.seen');
    if (win && !win.isDestroyed()) win.webContents.send('connector:seen');
    return { ok: true, result: { app: 'Study Notebook', version: app.getVersion() } };
  }
  const r = (win && !win.isDestroyed() && pageReady) ? await forwardToPage(op, args) : applyToFile(op, args);
  if (r.ok) noteConnectorUse(op);
  return r;
}

// The connector script, shipped unpacked so the Claude app can run it.
const connectorScript = () => app.isPackaged ? path.join(process.resourcesPath, 'connector', 'server.js') : path.join(__dirname, '..', 'connector', 'dist', 'server', 'index.js');
const setupOpts = () => ({ exe: process.execPath, script: connectorScript(), dataDir: dataDir() });

ipcMain.handle('claude:status', async () => {
  const s = loadSettings();
  return { installed: claudeSetup.claudeInstalled(), configured: claudeSetup.isConfigured(setupOpts()), running: await claudeSetup.claudeRunning(), seen: s.connectorSeen || 0, lastUse: s.connectorLastUse || 0 };
});
ipcMain.handle('claude:connect', async () => {
  if (!fs.existsSync(connectorScript())) return { ok: false, message: 'The Claude connector file is missing from this installation.' };
  const r = claudeSetup.connect(setupOpts(), log);
  if (!r.done.length) return { ok: false, message: r.failed.length ? 'Couldn’t update the Claude app’s settings.' : 'The Claude desktop app isn’t installed.' , noClaude: !r.failed.length };
  return { ok: true, running: await claudeSetup.claudeRunning(), installed: claudeSetup.claudeInstalled() };
});
ipcMain.handle('claude:restart', async () => ({ ok: await claudeSetup.restartClaude(log) }));
ipcMain.handle('claude:disconnect', () => { claudeSetup.disconnect(log); return { ok: true }; });

ipcMain.handle('connector:install', async () => {
  const f = connectorBundle();
  if (!fs.existsSync(f)) return { ok: false, message: 'The Claude connector file is missing from this installation.' };
  const err = await shell.openPath(f);
  log.info('connector.install.open', { ok: !err });
  return err ? { ok: false, noClaude: true } : { ok: true };
});
ipcMain.handle('connector:reveal', () => { const f = connectorBundle(); if (fs.existsSync(f)) shell.showItemInFolder(f); });

const HEX = /^#[0-9a-f]{6}$/i;
ipcMain.on('app:titleBar', (ev, c) => {
  if (!win || win.isDestroyed() || process.platform === 'darwin' || !c || !HEX.test(c.color) || !HEX.test(c.symbol)) return;
  try { win.setTitleBarOverlay({ color: c.color, symbolColor: c.symbol, height: 40 }); win.setBackgroundColor(c.color); } catch (e) {}
});
ipcMain.handle('app:setTheme', (ev, t) => {
  if (['system', 'light', 'dark'].includes(t)) nativeTheme.themeSource = t;
  const s = loadSettings(); if (s.theme !== t && ['system', 'light', 'dark'].includes(t)) { s.theme = t; saveSettings(s); }
  if (win && !win.isDestroyed()) win.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#18181a' : '#e5e4df');
});

/* ---------- lecture recording ---------- */

const engine = Engine.create({
  dataDir: dataDir(), log,
  vadModel: app.isPackaged ? path.join(process.resourcesPath, 'speech', 'ggml-silero-v5.1.2.bin') : path.join(__dirname, '..', 'build', 'speech', 'ggml-silero-v5.1.2.bin'),
  onProgress: p => { if (win && !win.isDestroyed()) win.webContents.send('speech:progress', p); }
});
const SPEECH_LANGS = new Set(['he', 'en', 'ar', 'auto']);
const engineErr = e => ({ ok: false, code: (e && e.code) || 'failed', message: e && e.code && e.message ? e.message : 'The speech engine had a problem.' });

ipcMain.handle('speech:status', () => engine.status());
ipcMain.handle('speech:needs', (ev, lang) => SPEECH_LANGS.has(lang) ? engine.needs(lang).catch(() => ({ bytes: 0 })) : { bytes: 0 });
ipcMain.handle('speech:start', async (ev, lang) => {
  if (!SPEECH_LANGS.has(lang)) return { ok: false, code: 'failed' };
  try {
    const s = await engine.start(lang);
    if (awake === null) awake = powerSaveBlocker.start('prevent-app-suspension');   // no sleeping mid-lecture
    return { ok: true, variant: s.variant, fellBack: !!s.fellBack };
  }
  catch (e) { log.warn('speech.start.failed', { code: e.code, error: e.message }); return engineErr(e); }
});
ipcMain.handle('speech:transcribe', async (ev, req) => {
  const { pcm, lang, prompt } = isPlainObject(req) ? req : {};
  if (!(pcm instanceof Uint8Array) || pcm.byteLength % 2 || pcm.byteLength > 16000 * 2 * 40 || !SPEECH_LANGS.has(lang)) return { ok: false, code: 'failed' };
  try {
    const copy = new Int16Array(pcm.byteLength / 2); new Uint8Array(copy.buffer).set(pcm);
    const r = await engine.transcribe(copy, lang, typeof prompt === 'string' ? prompt.slice(-600) : '');
    return { ok: true, text: r.text, doubtful: r.doubtful };
  } catch (e) { log.warn('speech.transcribe.failed', { code: e.code, error: e.message }); return engineErr(e); }
});
ipcMain.handle('speech:stop', () => { engine.stop(); releaseAwake(); });
ipcMain.handle('speech:cancel', () => { engine.cancel(); });
let awake = null;
function releaseAwake() { if (awake !== null) { try { powerSaveBlocker.stop(awake); } catch (e) {} awake = null; } }
ipcMain.handle('speech:remove', () => { engine.remove(); return engine.status(); });
// Tests only: a recording to play instead of the computer's sound.
ipcMain.handle('speech:testAudio', () => process.env.SN_TEST_AUDIO && fs.existsSync(process.env.SN_TEST_AUDIO) ? new Uint8Array(fs.readFileSync(process.env.SN_TEST_AUDIO)) : null);

/* ---------- updates ---------- */
let updates = null;
// Copy text for the student (the page itself isn't allowed to write to the clipboard).
// Text size for the whole app (Ctrl + / Ctrl − / Ctrl 0), remembered between starts.
const ZOOMS = [0.8, 0.9, 1, 1.1, 1.2, 1.35, 1.5, 1.75];
function textSize(dir) {
  if (!win || win.isDestroyed()) return;
  const s = loadSettings(); const cur = Number(s.zoom) || 1;
  let i = ZOOMS.findIndex(z => Math.abs(z - cur) < 0.01); if (i < 0) i = 2;
  const z = dir === 0 ? 1 : ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, i + dir))];
  s.zoom = z; saveSettings(s); win.webContents.setZoomFactor(z);
  win.webContents.send('text-size', Math.round(z * 100));
}
ipcMain.handle('text-size', (ev, dir) => { if ([-1, 0, 1].includes(dir)) textSize(dir); });
ipcMain.handle('clipboard:write', (ev, text) => { if (typeof text !== 'string' || text.length > 200000) return false; clipboard.writeText(text); return true; });
ipcMain.handle('update:status', () => updates ? updates.status() : { enabled: false });
ipcMain.handle('update:check', () => updates ? updates.check() : { enabled: false });
ipcMain.handle('update:install', () => { if (updates) updates.install(); });

ipcMain.handle('app:openDataFolder', () => shell.openPath(dataDir()));

ipcMain.on('app:openExternal', (ev, url) => {
  try { const u = new URL(String(url)); if (u.protocol === 'https:') shell.openExternal(u.toString()); } catch (e) {}
});

/* ---------- window ---------- */

function createWindow() {
  win = new BrowserWindow({
    width: 1320, height: 860, minWidth: 900, minHeight: 600,
    title: 'Study Notebook',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#18181a' : '#e5e4df',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    // No grey system title bar or menu row: the app draws its own top, and Windows draws the
    // minimise/maximise/close buttons over it in the app's colours (see app:titleBar).
    ...(process.platform === 'darwin' ? {} : { titleBarStyle: 'hidden', titleBarOverlay: { color: nativeTheme.shouldUseDarkColors ? '#18181a' : '#e5e4df', symbolColor: nativeTheme.shouldUseDarkColors ? '#ece8e1' : '#1f1d1a', height: 40 }, autoHideMenuBar: true }),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true,
      devTools: DEV, webSecurity: true, allowRunningInsecureContent: false
    }
  });
  // The app never needs the camera, microphone, location or notifications.
  // Only the app's own page may capture the computer's sound (for lecture recording);
  // every other permission (camera, microphone, location...) stays denied.
  const ours = u => String(u || '').startsWith('app://notebook');
  // Electron names screen/sound capture 'media' (sometimes 'display-capture').
  win.webContents.session.setPermissionRequestHandler((wc, perm, cb, details) => cb((perm === 'media' || perm === 'display-capture') && ours(details && (details.requestingUrl || details.securityOrigin))));
  win.webContents.session.setPermissionCheckHandler((wc, perm, origin) => (perm === 'media' || perm === 'display-capture') && ours(origin));
  win.webContents.session.setDisplayMediaRequestHandler((request, callback) => {
    if (!ours(request.securityOrigin) && !ours(request.frame && request.frame.url)) return callback({});
    desktopCapturer.getSources({ types: ['screen'] }).then(src => {
      if (!src.length) return callback({});
      // 'loopback' = the sound playing on this computer (Windows).
      callback(process.platform === 'win32' ? { video: src[0], audio: 'loopback' } : { video: src[0] });
    }).catch(() => callback({}));
  });
  win.webContents.on('render-process-gone', (e, d) => log.error('renderer.gone', { reason: d && d.reason }));
  win.webContents.on('console-message', (e, level, message) => {
    const lvl = typeof level === 'number' ? level : (e && e.level);
    const msg = typeof message === 'string' ? message : (e && e.message);
    if (lvl === 3 || lvl === 'error') log.warn('renderer.error', { message: msg });
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.on('did-finish-load', () => { const z = Number(loadSettings().zoom) || 1; if (z !== 1) win.webContents.setZoomFactor(z); });
  win.loadURL('app://notebook/index.html');

  // Links open in the normal browser; the app window never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) { e.preventDefault(); if (/^https:\/\//i.test(url)) shell.openExternal(url); } });

  // Let the page flush unsaved notes before the window closes.
  let closing = false;
  win.on('close', e => {
    if (closing) return;
    e.preventDefault(); closing = true;
    const done = () => { if (win && !win.isDestroyed()) win.destroy(); };
    const t = setTimeout(done, 1500);
    ipcMain.once('app:flushed', () => { clearTimeout(t); done(); });
    win.webContents.send('app:flush');
  });
  win.on('closed', () => { win = null; pageReady = false; });
  win.webContents.on('did-start-loading', () => { pageReady = false; });
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(() => {
  startCloud();
  protocol.handle('app', req => {
    const url = new URL(req.url);
    if (url.host !== 'notebook' || req.method !== 'GET') return new Response('Not found', { status: 404 });
    const file = path.normalize(path.join(RENDERER, decodeURIComponent(url.pathname)));
    // Only files inside the app's own page folder can be served.
    if (!file.startsWith(RENDERER + path.sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  // Developer tools appear only when running from source, never in the installed app.
  const view = [
    { label: 'Bigger text', accelerator: 'CmdOrCtrl+=', click: () => textSize(+1) },
    { label: 'Bigger text', accelerator: 'CmdOrCtrl+Plus', visible: false, acceleratorWorksWhenHidden: true, click: () => textSize(+1) },
    { label: 'Smaller text', accelerator: 'CmdOrCtrl+-', click: () => textSize(-1) },
    { label: 'Normal text size', accelerator: 'CmdOrCtrl+0', click: () => textSize(0) },
    { type: 'separator' }, { role: 'togglefullscreen' }];
  if (DEV) view.push({ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [process.platform === 'darwin' ? { role: 'close' } : { role: 'quit', label: 'Exit' }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: view },
    ...(process.platform === 'darwin' ? [{ role: 'windowMenu' }] : [])
  ]));
  seedIfFirstRun();
  dropOldAiSettings();
  dailyBackup();
  setInterval(dailyBackup, 6 * 3600 * 1000);
  updates = Updates.create({ log, notify: v => { if (win && !win.isDestroyed()) win.webContents.send('update:ready', v); }, progress: p => { if (win && !win.isDestroyed()) win.webContents.send('update:progress', p); } });
  updates.startChecking();
  const t = loadSettings().theme; if (['system', 'light', 'dark'].includes(t)) nativeTheme.themeSource = t;
  createWindow();
  const stopLink = link.start(dataDir(), handleConnector, log);
  app.on('will-quit', () => { stopLink(); engine.stop(); });
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
