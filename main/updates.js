'use strict';
// Automatic updates from GitHub Releases (electron-updater). Only active in an
// installed copy that was built with a "publish" setting; otherwise it stays off.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function create({ log, notify, progress }) {
  const st = { enabled: false, state: 'idle', version: '', current: app.getVersion(), size: 0, done: 0, total: 0, bps: 0 };
  let lastSent = 0;
  let updater = null;
  try {
    const cfg = path.join(process.resourcesPath || '', 'app-update.yml');
    if (app.isPackaged && fs.existsSync(cfg)) {
      updater = require('electron-updater').autoUpdater;
      updater.autoDownload = true;
      updater.autoInstallOnAppQuit = true;   // installs the next time the app closes
      updater.logger = null;
      // Every change of state goes to the window, so Settings updates by itself.
      const push = () => { if (progress) progress({ ...st }); };
      updater.on('checking-for-update', () => { st.state = 'checking'; push(); });
      updater.on('update-available', i => {
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
      updater.on('update-downloaded', i => { st.state = 'ready'; st.version = i.version; st.done = st.total; log.info('update.ready', { version: i.version }); push(); notify(i.version); });
      updater.on('error', e => { st.state = 'error'; log.warn('update.error', { error: e && e.message }); push(); });
      st.enabled = true;
    }
  } catch (e) { log.warn('update.unavailable', { error: e.message }); }

  return {
    status: () => ({ ...st }),
    check: async () => { if (!updater) return st; try { await updater.checkForUpdates(); } catch (e) {} return { ...st }; },
    install: () => { if (updater && st.state === 'ready') updater.quitAndInstall(false, true); },
    startChecking: () => { if (!updater) return; const run = () => updater.checkForUpdates().catch(() => {}); setTimeout(run, 15000); setInterval(run, 6 * 3600 * 1000); }
  };
}
module.exports = { create };
