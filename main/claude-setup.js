'use strict';
// One-click connection to the Claude desktop app: adds Study Notebook to the
// Claude app's own settings file (claude_desktop_config.json), so there is no
// file for the student to open. The connector runs with this app's own
// executable in Node mode, so nothing else needs to be installed.
//
// Claude for Windows keeps its settings in one of two places:
//   regular install:        %APPDATA%\Claude
//   Microsoft Store (MSIX): %LOCALAPPDATA%\Packages\Claude_<id>\LocalCache\Roaming\Claude
// We update every one that exists.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');

const KEY = 'study-notebook';

function configDirs() {
  const home = os.homedir();
  const dirs = [];
  if (process.platform === 'win32') {
    const roaming = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    dirs.push({ dir: path.join(roaming, 'Claude'), kind: 'regular' });
    try {
      for (const p of fs.readdirSync(path.join(local, 'Packages'))) {
        if (/^(Anthropic\.)?Claude_/i.test(p)) dirs.push({ dir: path.join(local, 'Packages', p, 'LocalCache', 'Roaming', 'Claude'), kind: 'store', pkg: p });
      }
    } catch (e) {}
  } else if (process.platform === 'darwin') {
    dirs.push({ dir: path.join(home, 'Library', 'Application Support', 'Claude'), kind: 'regular' });
  } else {
    dirs.push({ dir: path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Claude'), kind: 'regular' });
  }
  return dirs;
}

// Is the Claude desktop app installed? (A settings folder or a known install location.)
function claudeInstalled() {
  if (process.env.SN_CLAUDE_CONFIG_DIR) return true;
  const dirs = configDirs();
  if (dirs.some(d => d.kind === 'store' || fs.existsSync(d.dir))) return true;
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return fs.existsSync(path.join(local, 'AnthropicClaude')) || fs.existsSync(path.join(local, 'Programs', 'Claude'));
  }
  if (process.platform === 'darwin') return fs.existsSync('/Applications/Claude.app');
  return false;
}

function targets() {
  if (process.env.SN_CLAUDE_CONFIG_DIR) return [{ dir: process.env.SN_CLAUDE_CONFIG_DIR, kind: 'test' }];
  const dirs = configDirs();
  // Write the regular location only if it exists, unless it's the only option.
  const store = dirs.filter(d => d.kind === 'store');
  const regular = dirs.filter(d => d.kind !== 'store' && (fs.existsSync(d.dir) || !store.length));
  return [...store, ...regular];
}

function readConfig(file) {
  if (!fs.existsSync(file)) return { cfg: {}, existed: false };
  const text = fs.readFileSync(file, 'utf8');
  if (!text.trim()) return { cfg: {}, existed: true };
  const cfg = JSON.parse(text);   // throws on a broken file: we never overwrite something we can't read
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('not an object');
  return { cfg, existed: true };
}

function entry({ exe, script, dataDir }) {
  return { command: exe, args: [script], env: { ELECTRON_RUN_AS_NODE: '1', STUDY_NOTEBOOK_DATA_DIR: dataDir } };
}

// Adds or updates our entry in each Claude settings file. Keeps every other setting.
function connect(opts, log) {
  const want = entry(opts);
  const done = [], failed = [];
  for (const t of targets()) {
    const file = path.join(t.dir, 'claude_desktop_config.json');
    try {
      const { cfg, existed } = readConfig(file);
      const servers = cfg.mcpServers && typeof cfg.mcpServers === 'object' ? cfg.mcpServers : {};
      const same = JSON.stringify(servers[KEY]) === JSON.stringify(want);
      if (!same) {
        if (existed) fs.copyFileSync(file, file + '.before-study-notebook');
        cfg.mcpServers = { ...servers, [KEY]: want };
        fs.mkdirSync(t.dir, { recursive: true });
        fs.writeFileSync(file, JSON.stringify(cfg, null, 2), 'utf8');
      }
      done.push({ file, kind: t.kind, changed: !same });
    } catch (e) {
      failed.push({ file, kind: t.kind, error: e.message });
      log.warn('claude.config.failed', { kind: t.kind, error: e.message });
    }
  }
  log.info('claude.config', { written: done.length, changed: done.filter(d => d.changed).length, failed: failed.length });
  return { done, failed };
}

function disconnect(log) {
  let n = 0;
  for (const t of targets()) {
    const file = path.join(t.dir, 'claude_desktop_config.json');
    try {
      const { cfg, existed } = readConfig(file);
      if (existed && cfg.mcpServers && cfg.mcpServers[KEY]) { delete cfg.mcpServers[KEY]; fs.writeFileSync(file, JSON.stringify(cfg, null, 2), 'utf8'); n++; }
    } catch (e) { log.warn('claude.config.remove_failed', { error: e.message }); }
  }
  return n;
}

function isConfigured(opts) {
  const want = JSON.stringify(entry(opts));
  return targets().some(t => {
    try { const { cfg } = readConfig(path.join(t.dir, 'claude_desktop_config.json')); return cfg.mcpServers && JSON.stringify(cfg.mcpServers[KEY]) === want; }
    catch (e) { return false; }
  });
}

const run = (cmd, args, timeout = 15000) => new Promise(res => execFile(cmd, args, { windowsHide: true, timeout }, (err, out) => res(err ? '' : String(out || ''))));

async function claudeRunning() {
  if (process.platform === 'win32') return /^"?claude\.exe"?,/im.test(await run('tasklist', ['/FI', 'IMAGENAME eq claude.exe', '/FO', 'CSV', '/NH']));
  if (process.platform === 'darwin') return !!(await run('pgrep', ['-x', 'Claude'])).trim();
  return false;
}

// Closes the Claude app completely (including the tray icon) and opens it again,
// so it reads the new settings.
async function restartClaude(log) {
  if (process.platform === 'win32') {
    await run('taskkill', ['/IM', 'claude.exe', '/F', '/T']);
    await new Promise(r => setTimeout(r, 2500));
    // The Start menu ID works for both the regular and the Store version.
    const aumid = (await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "(Get-StartApps | Where-Object { $_.Name -eq 'Claude' } | Select-Object -First 1).AppID"], 20000)).trim();
    if (aumid) { spawn('explorer.exe', ['shell:AppsFolder\\' + aumid], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); log.info('claude.restart', { via: 'start-menu' }); return true; }
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    for (const exe of [path.join(local, 'AnthropicClaude', 'claude.exe'), path.join(local, 'Programs', 'Claude', 'Claude.exe')]) {
      if (fs.existsSync(exe)) { spawn(exe, [], { detached: true, stdio: 'ignore' }).unref(); log.info('claude.restart', { via: 'exe' }); return true; }
    }
    log.warn('claude.restart.not_found');
    return false;
  }
  if (process.platform === 'darwin') {
    await run('osascript', ['-e', 'quit app "Claude"']);
    await new Promise(r => setTimeout(r, 2500));
    spawn('open', ['-a', 'Claude'], { detached: true, stdio: 'ignore' }).unref();
    return true;
  }
  return false;
}

module.exports = { connect, disconnect, isConfigured, claudeInstalled, claudeRunning, restartClaude, KEY };
