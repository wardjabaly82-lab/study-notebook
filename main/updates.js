'use strict';
// Automatic updates from GitHub Releases (electron-updater). Only active in an
// installed copy that was built with a "publish" setting; otherwise it stays off.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function create({ log, notify }) {
  const st = { enabled: false, state: 'idle', version: '', current: app.getVersion() };
  let updater = null;
  try {
    const cfg = path.join(process.resourcesPath || '', 'app-update.yml');
    if (app.isPackaged && fs.existsSync(cfg)) {
      updater = require('electron-updater').autoUpdater;
      updater.autoDownload = true;
      updater.autoInstallOnAppQuit = true;   // installs the next time the app closes
      updater.logger = null;
      updater.on('checking-for-update', () => { st.state = 'checking'; });
      updater.on('update-available', i => { st.state = 'available'; st.version = i.version; log.info('update.available', { version: i.version }); });
      updater.on('update-not-available', () => { st.state = 'latest'; });
      updater.on('update-downloaded', i => { st.state = 'ready'; st.version = i.version; log.info('update.ready', { version: i.version }); notify(i.version); });
      updater.on('error', e => { st.state = 'error'; log.warn('update.error', { error: e && e.message }); });
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
