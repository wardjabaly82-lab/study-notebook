'use strict';
// The local link the Claude connector uses to reach this app while it's open.
// - Only this computer can connect (a named pipe on Windows, a socket file on Mac).
// - Every request must carry a secret token that only this user account can read,
//   and is regenerated each time the app starts.
const fs = require('fs');
const net = require('net');
const path = require('path');
const crypto = require('crypto');

const OPS = new Set(['ping', 'list_courses', 'get_outline', 'read_section', 'search_notes', 'save_section', 'save_sections', 'edit_part', 'create_course', 'list_lectures', 'read_lecture', 'save_practice', 'get_practice_overview']);
const MAX_LINE = 2 * 1024 * 1024;

// Must match linkPath() in connector/src/server.js.
function linkPath(dir) {
  if (process.platform === 'win32') return '\\\\.\\pipe\\study-notebook-' + crypto.createHash('sha1').update(dir.toLowerCase()).digest('hex').slice(0, 16);
  return path.join(dir, 'connector.sock');
}

function start(dir, handle, log) {
  fs.mkdirSync(dir, { recursive: true });
  const token = crypto.randomBytes(32).toString('hex');
  const tokenFile = path.join(dir, 'connector.token');
  fs.writeFileSync(tokenFile, token, { encoding: 'utf8', mode: 0o600 });
  const want = Buffer.from(token);
  const where = linkPath(dir);
  if (process.platform !== 'win32') { try { fs.unlinkSync(where); } catch (e) {} }

  const server = net.createServer(sock => {
    let buf = '';
    sock.setEncoding('utf8');
    sock.setTimeout(30000, () => sock.destroy());
    sock.on('error', () => {});
    sock.on('data', async chunk => {
      buf += chunk;
      if (buf.length > MAX_LINE) { sock.destroy(); log.warn('connector.rejected', { reason: 'message too large' }); return; }
      const i = buf.indexOf('\n'); if (i < 0) return;
      const line = buf.slice(0, i); buf = '';
      let msg; try { msg = JSON.parse(line); } catch (e) { sock.destroy(); return; }
      const got = Buffer.from(String(msg && msg.token || ''));
      if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) {
        log.warn('connector.rejected', { reason: 'bad token' });
        sock.end(JSON.stringify({ ok: false, error: 'Not allowed.' }) + '\n'); return;
      }
      if (!OPS.has(msg.op)) { sock.end(JSON.stringify({ ok: false, error: 'Unknown operation.' }) + '\n'); return; }
      const reply = await handle(msg.op, msg.args && typeof msg.args === 'object' ? msg.args : {});
      log.info('connector.op', { op: msg.op, ok: reply.ok });
      if (!sock.destroyed) sock.end(JSON.stringify(reply) + '\n');
    });
  });
  server.on('error', e => log.error('connector.link.failed', { error: e.message }));
  server.listen(where, () => {
    if (process.platform !== 'win32') { try { fs.chmodSync(where, 0o600); } catch (e) {} }
    log.info('connector.link.ready');
  });

  return function stop() {
    try { server.close(); } catch (e) {}
    try { fs.unlinkSync(tokenFile); } catch (e) {}
    if (process.platform !== 'win32') { try { fs.unlinkSync(where); } catch (e) {} }
  };
}

module.exports = { start, linkPath };
