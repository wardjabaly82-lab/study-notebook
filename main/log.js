'use strict';
// A small local log so problems can be investigated afterwards.
// It records what happened (event, provider, error code, HTTP status) and
// never the API key, the student's notes, or the text of questions.
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 1024 * 1024; // keep about 1 MB, then roll over to app.old.log
let file = null;

function init(dir) {
  const logDir = path.join(dir, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  file = path.join(logDir, 'app.log');
}

// Removes anything that looks like a key or token before it is written.
function redact(s) {
  return String(s == null ? '' : s)
    .replace(/sk-ant-[A-Za-z0-9_\-]{8,}/g, 'sk-ant-[hidden]')
    .replace(/sk-[A-Za-z0-9_\-]{12,}/g, 'sk-[hidden]')
    .replace(/AIza[0-9A-Za-z_\-]{20,}/g, 'AIza[hidden]')
    .replace(/(bearer\s+|x-api-key["':\s]+|x-goog-api-key["':\s]+|key=)[^\s"',&]+/gi, '$1[hidden]')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 500);
}

function write(level, event, details) {
  if (!file) return;
  const parts = Object.entries(details || {}).map(([k, v]) => `${k}=${redact(v)}`);
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${event}${parts.length ? ' ' + parts.join(' ') : ''}\n`;
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, file.replace(/\.log$/, '.old.log'));
    fs.appendFileSync(file, line, 'utf8');
  } catch (e) { /* logging must never break the app */ }
}

module.exports = {
  init, redact,
  info: (event, d) => write('info', event, d),
  warn: (event, d) => write('warn', event, d),
  error: (event, d) => write('error', event, d)
};
