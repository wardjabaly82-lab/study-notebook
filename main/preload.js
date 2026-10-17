'use strict';
// The only bridge between the page and the computer. The page gets these
// functions and nothing else (no Node, no file system).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  platform: process.platform,

  getSettings: () => ipcRenderer.invoke('settings:get'),
  setTheme: t => ipcRenderer.invoke('app:setTheme', t),

  loadData: () => ipcRenderer.invoke('store:load'),
  saveData: text => ipcRenderer.invoke('store:save', text),
  exportBackup: text => ipcRenderer.invoke('backup:export', text),
  importBackup: () => ipcRenderer.invoke('backup:import'),
  saveFile: (filename, data) => ipcRenderer.invoke('file:save', { filename, data }),
  openDataFolder: () => ipcRenderer.invoke('app:openDataFolder'),
  openExternal: url => ipcRenderer.send('app:openExternal', url),

  printPreview: (payload, opts) => ipcRenderer.invoke('print:preview', { payload, opts }),
  printSavePdf: (payload, opts) => ipcRenderer.invoke('print:savePdf', { payload, opts }),
  printPaper: (payload, opts) => ipcRenderer.invoke('print:paper', { payload, opts }),
  openPdf: p => ipcRenderer.invoke('app:openPath', p),

  copyText: text => ipcRenderer.invoke('clipboard:write', String(text)),
  updateStatus: () => ipcRenderer.invoke('update:status'),
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateInstall: () => ipcRenderer.invoke('update:install'),
  cloudStatus: () => ipcRenderer.invoke('cloud:status'),
  cloudSignIn: () => ipcRenderer.invoke('cloud:signin'),
  cloudDisconnect: () => ipcRenderer.invoke('cloud:disconnect'),
  cloudSync: () => ipcRenderer.invoke('cloud:sync'),
  onCloudStatus(fn) { ipcRenderer.on('cloud:status', (e, s) => fn(s)); },
  textSize: dir => ipcRenderer.invoke('text-size', dir),
  onTextSize(fn) { ipcRenderer.on('text-size', (e, p) => fn(p)); },
  onUpdateReady(fn) { ipcRenderer.on('update:ready', (e, v) => fn(v)); },
  onUpdateProgress(fn) { ipcRenderer.on('update:progress', (e, p) => fn(p)); },

  speechStatus: () => ipcRenderer.invoke('speech:status'),
  speechNeeds: lang => ipcRenderer.invoke('speech:needs', lang),
  speechStart: lang => ipcRenderer.invoke('speech:start', lang),
  speechTranscribe: (pcm, lang, prompt) => ipcRenderer.invoke('speech:transcribe', { pcm: new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), lang, prompt }),
  speechStop: () => ipcRenderer.invoke('speech:stop'),
  speechCancel: () => ipcRenderer.invoke('speech:cancel'),
  speechRemove: () => ipcRenderer.invoke('speech:remove'),
  speechTestAudio: () => ipcRenderer.invoke('speech:testAudio'),
  onSpeechProgress(fn) { ipcRenderer.on('speech:progress', (e, p) => fn(p)); },

  claudeStatus: () => ipcRenderer.invoke('claude:status'),
  claudeConnect: () => ipcRenderer.invoke('claude:connect'),
  claudeRestart: () => ipcRenderer.invoke('claude:restart'),
  claudeDisconnect: () => ipcRenderer.invoke('claude:disconnect'),
  onClaudeSeen(fn) { ipcRenderer.on('connector:seen', () => fn()); },
  connectorInstall: () => ipcRenderer.invoke('connector:install'),
  connectorReveal: () => ipcRenderer.invoke('connector:reveal'),
  // Claude (through the connector) asks the open app to read or change notes.
  onConnectorOp(fn) {
    ipcRenderer.on('connector:op', async (e, { reqId, op, args }) => {
      let r;
      try { r = await fn(op, args); } catch (err) { r = { ok: false, error: 'The app couldn’t do that.' }; }
      ipcRenderer.send('connector:result', { reqId, ...r });
    });
    ipcRenderer.send('connector:ready');
  },

  onFlush(fn) { ipcRenderer.on('app:flush', async () => { try { await fn(); } finally { ipcRenderer.send('app:flushed'); } }); }
});
