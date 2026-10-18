'use strict';
// Automatic updates from GitHub Releases (electron-updater). Only active in an
// installed copy that was built with a "publish" setting; otherwise it stays off.
const fs = require('fs');
const path = require('path');
const { app, shell } = require('electron');

// The Mac app isn't signed with an Apple developer certificate yet, and macOS only lets a signed app
// replace itself. So on a Mac the app tells the student a new version is out and opens its download.
const MANUAL = process.platform === 'darwin';

function create({ log, notify, progress }) {
  const st = { enabled: false, state: 'idle', version: '', current: app.getVersion(), size: 0, done: 0, total: 0, bps: 0, installWhenReady: false, url: '' };
  let lastSent = 0;
  let updater = null;
  try {
    const cfg = path.join(process.resourcesPath || '', 'app-update.yml');
    if (app.isPackaged && fs.existsSync(cfg)) {
      const yml = fs.readFileSync(cfg, 'utf8');
      const owner = (yml.match(/^owner:\s*(\S+)/m) || [])[1], repo = (yml.match(/^repo:\s*(\S+)/m) || [])[1];
      const dmg = v => (owner && repo ? `https://github.com/${owner}/${repo}/releases/download/v${v}/Study-Notebook-${v}-${process.arch === 'arm64' ? 'arm64' : 'x64'}.dmg` : '');
      updater = require('electron-updater').autoUpdater;
      updater.autoDownload = !MANUAL;
      updater.autoInstallOnAppQuit = !MANUAL;   // installs the next time the app closes
      updater.logger = null;
      // Every change of state goes to the window, so Settings updates by itself.
      const push = () => { if (progress) progress({ ...st }); };
      updater.on('checking-for-update', () => { st.state = 'checking'; push(); });
      updater.on('update-available', i => {
        if (MANUAL) { st.state = 'manual'; st.version = i.version; st.url = dmg(i.version); log.info('update.available', { version: i.version, manual: true }); push(); return; }
        st.state = 'available'; st.version = i.version; st.done = 0; st.total = 0; st.bps = 0;
        st.size = (i.files && i.files[0] && i.files[0].size) || 0;   // full installer size
        log.info('update.available', { version: i.version, size: st.size });
        push();
      });
      // How much is downloaded and how fast. With a differential update "total" is only the changed parts.
      updater.on('download-progress', p => {
        st.done = p.transferred || 0; st.total = p.total || 0;
        st.bps = st.bps ? st.bps * 0.7 + (p.bytesPerSecond || 0) * 0.3 : (p.bytesPerSecond || 0);   // smoothed speed
        const now = Date.now(); if (progress && now - lastSent > 400) { lastSent = now; progress({ ...st }); }
      });
      updater.on('update-not-available', () => { st.state = 'latest'; push(); });
      updater.on('update-downloaded', i => {
        st.state = 'ready'; st.version = i.version; st.done = st.total; log.info('update.ready', { version: i.version }); push(); notify(i.version);
        if (st.installWhenReady) setTimeout(() => updater.quitAndInstall(true, true), 800);   // the student already pressed "Update now"
      });
      updater.on('error', e => { st.state = 'error'; log.warn('update.error', { error: e && e.message }); push(); });
      st.enabled = true;
    }
  } catch (e) { log.warn('update.unavailable', { error: e.message }); }

  return {
    status: () => ({ ...st }),
    check: async () => { if (!updater) return st; try { await updater.checkForUpdates(); } catch (e) {} return { ...st }; },
    // Silent: no installer window. The app closes, updates in the background (same folder,
    // notes and settings untouched) and opens again by itself.
    // "Update now": installs at once if the download is done, otherwise as soon as it is.
    install: () => {
      if (!updater) return;
      if (st.state === 'manual') { if (st.url) shell.openExternal(st.url); return; }   // Mac: open the new version's download
      if (st.state === 'ready') updater.quitAndInstall(true, true);
      else if (st.state === 'available') { st.installWhenReady = true; if (progress) progress({ ...st }); }
    },
    startChecking: () => { if (!updater) return; const run = () => updater.checkForUpdates().catch(() => {}); setTimeout(run, 15000); setInterval(run, 30 * 60 * 1000); }   // a new release shows up within half an hour
  };
}
module.exports = { create };
