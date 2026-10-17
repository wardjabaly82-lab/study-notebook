// Builds a one-file personal installer that also carries your own notes,
// loaded on first start. Usage: npx electron-builder --config personal.config.js --win
const base = require('./package.json').build;
module.exports = {
  ...base,
  extraResources: [...base.extraResources, { from: 'build/seed-notes.json', to: 'seed-notes.json' }],
  win: { ...base.win, artifactName: 'Study-Notebook-Setup-${version}-with-my-notes.${ext}' }
};
