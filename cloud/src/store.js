/* Storage on D1. Every note belongs to one student (uid) and every query is
   scoped to that student, so one student can never read or change another's notes. */

export const DOC_PATH = /^data\/users\/local\/[A-Za-z0-9_-]{1,64}(\/(sections|sources|lectures|cards)\/[A-Za-z0-9_-]{1,64})?$/;
export const MAX_DOC = 2_000_000;

let ready = false;
export async function ensureSchema(env) {
  if (ready) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, google_sub TEXT NOT NULL UNIQUE, email TEXT NOT NULL, name TEXT,
      created INTEGER NOT NULL, last_seen INTEGER NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS notes (
      uid TEXT NOT NULL, path TEXT NOT NULL, data TEXT, rev INTEGER NOT NULL, mtime INTEGER NOT NULL,
      PRIMARY KEY (uid, path))`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS notes_rev ON notes(uid, rev)'),
    // Sign-ins: the website (cookie) and the desktop app (token). Only a hash of each secret is kept.
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS sessions (
      hash TEXT PRIMARY KEY, uid TEXT NOT NULL, kind TEXT NOT NULL, label TEXT,
      created INTEGER NOT NULL, last_used INTEGER NOT NULL, expires INTEGER NOT NULL)`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS sessions_uid ON sessions(uid)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)')
  ]);
  ready = true;
}

/* ---------- students ---------- */

export async function userBySub(env, sub) {
  await ensureSchema(env);
  return env.DB.prepare('SELECT * FROM users WHERE google_sub = ?1').bind(sub).first();
}
export async function userById(env, id) {
  await ensureSchema(env);
  return env.DB.prepare('SELECT * FROM users WHERE id = ?1').bind(id).first();
}
export async function upsertUser(env, { sub, email, name }) {
  await ensureSchema(env);
  const now = Date.now();
  const found = await userBySub(env, sub);
  if (found) {
    await env.DB.prepare('UPDATE users SET email = ?2, name = ?3, last_seen = ?4 WHERE id = ?1').bind(found.id, email, name || null, now).run();
    return { ...found, email, name, fresh: false };
  }
  const id = 'u' + randomId(12);
  await env.DB.prepare('INSERT INTO users (id, google_sub, email, name, created, last_seen) VALUES (?1, ?2, ?3, ?4, ?5, ?5)').bind(id, sub, email, name || null, now).run();
  return { id, google_sub: sub, email, name, created: now, last_seen: now, fresh: true };
}
export async function countUsers(env) {
  await ensureSchema(env);
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
  return r ? r.n : 0;
}
// Removes the student and everything they have here.
export async function deleteUser(env, uid) {
  await ensureSchema(env);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM notes WHERE uid = ?1').bind(uid),
    env.DB.prepare('DELETE FROM sessions WHERE uid = ?1').bind(uid),
    env.DB.prepare('DELETE FROM users WHERE id = ?1').bind(uid)
  ]);
}

/* ---------- notes ---------- */

export async function loadDocs(env, uid) {
  await ensureSchema(env);
  const { results } = await env.DB.prepare('SELECT path, data FROM notes WHERE uid = ?1 AND data IS NOT NULL').bind(uid).all();
  const docs = {};
  for (const r of results) { try { docs[r.path] = JSON.parse(r.data); } catch (e) {} }
  return docs;
}
export async function currentRev(env, uid) {
  await ensureSchema(env);
  const row = await env.DB.prepare('SELECT COALESCE(MAX(rev), 0) AS rev FROM notes WHERE uid = ?1').bind(uid).first();
  return row ? row.rev : 0;
}
export async function countDocs(env, uid) {
  await ensureSchema(env);
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM notes WHERE uid = ?1 AND data IS NOT NULL').bind(uid).first();
  return row ? row.n : 0;
}
// writes: [{ path, data }] (data null = deleted). Each change gets the student's next revision number.
export async function writeDocs(env, uid, writes) {
  if (!writes.length) return currentRev(env, uid);
  await ensureSchema(env);
  const now = Date.now();
  const stmt = env.DB.prepare(`INSERT INTO notes (uid, path, data, rev, mtime) VALUES (?1, ?2, ?3, (SELECT COALESCE(MAX(rev), 0) + 1 FROM notes WHERE uid = ?1), ?4)
    ON CONFLICT(uid, path) DO UPDATE SET data = excluded.data, rev = (SELECT COALESCE(MAX(rev), 0) + 1 FROM notes WHERE uid = ?1), mtime = excluded.mtime`);
  for (let i = 0; i < writes.length; i += 50) {
    await env.DB.batch(writes.slice(i, i + 50).map(w => stmt.bind(uid, w.path, w.data === null || w.data === undefined ? null : JSON.stringify(w.data), now)));
  }
  return currentRev(env, uid);
}
export async function changesSince(env, uid, since, limit = 5000) {
  await ensureSchema(env);
  const { results } = await env.DB.prepare('SELECT path, data, rev FROM notes WHERE uid = ?1 AND rev > ?2 ORDER BY rev LIMIT ?3').bind(uid, since, limit).all();
  return results.map(r => ({ path: r.path, data: r.data === null ? null : JSON.parse(r.data), rev: r.rev }));
}
export async function docAt(env, uid, path) {
  const row = await env.DB.prepare('SELECT data FROM notes WHERE uid = ?1 AND path = ?2').bind(uid, path).first();
  try { return row && row.data ? JSON.parse(row.data) : null; } catch (e) { return null; }
}

// Applies changes sent by the app or the website; keeps the online copy where it is newer.
export async function applyPush(env, uid, incoming) {
  const writes = [], kept = [];
  for (const ch of incoming) {
    if (!ch || typeof ch.path !== 'string' || !DOC_PATH.test(ch.path)) throw Object.assign(new Error('bad_path'), { code: 'bad_path', path: ch && ch.path });
    if (ch.data !== null && (typeof ch.data !== 'object' || Array.isArray(ch.data) || JSON.stringify(ch.data).length > MAX_DOC)) throw Object.assign(new Error('bad_data'), { code: 'bad_data', path: ch.path });
    if (ch.data && ch.data.updatedAt) {
      const cur = await docAt(env, uid, ch.path);
      if (cur && cur.updatedAt && cur.updatedAt > ch.data.updatedAt) { kept.push({ path: ch.path, data: cur }); continue; }
    }
    writes.push({ path: ch.path, data: ch.data });
  }
  const rev = await writeDocs(env, uid, writes);
  return { rev, applied: writes.length, kept };
}

/* ---------- sessions ---------- */

export function randomId(bytes = 24) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return [...a].map(b => b.toString(36).padStart(2, '0')).join('').slice(0, Math.ceil(bytes * 1.6));
}
export const secret = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export async function sha256(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const DAY = 86400000;
export async function createSession(env, uid, kind, label) {
  await ensureSchema(env);
  const token = secret(); const now = Date.now();
  const ttl = kind === 'app' ? 365 * DAY : 60 * DAY;
  await env.DB.prepare('INSERT INTO sessions (hash, uid, kind, label, created, last_used, expires) VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6)')
    .bind(await sha256(token), uid, kind, label || null, now, now + ttl).run();
  return token;
}
// Returns the student for a session token, or null. Sliding expiry: use keeps it alive.
export async function sessionUser(env, token, kind) {
  if (!token || token.length < 20 || token.length > 200) return null;
  await ensureSchema(env);
  const hash = await sha256(token);
  const s = await env.DB.prepare('SELECT * FROM sessions WHERE hash = ?1').bind(hash).first();
  if (!s || s.kind !== kind) return null;
  const now = Date.now();
  if (s.expires < now) { await env.DB.prepare('DELETE FROM sessions WHERE hash = ?1').bind(hash).run(); return null; }
  const user = await userById(env, s.uid);
  if (!user) return null;
  if (now - s.last_used > DAY) {
    const ttl = kind === 'app' ? 365 * DAY : 60 * DAY;
    await env.DB.prepare('UPDATE sessions SET last_used = ?2, expires = ?3 WHERE hash = ?1').bind(hash, now, now + ttl).run();
  }
  return user;
}
export async function endSession(env, token) {
  if (!token) return;
  await ensureSchema(env);
  await env.DB.prepare('DELETE FROM sessions WHERE hash = ?1').bind(await sha256(token)).run();
}

/* ---------- notes from before accounts ---------- */
// The first version kept one notebook in a "docs" table with a password. Its owner can move it
// into their account once, with that password; then it is removed.

export async function legacyInfo(env) {
  await ensureSchema(env);
  const t = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'docs'").first();
  if (!t) return null;
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM docs WHERE data IS NOT NULL').first();
  const pw = await env.DB.prepare("SELECT v FROM meta WHERE k = 'password'").first();
  if (!n || !n.n) return null;
  let password = null; try { password = pw ? JSON.parse(pw.v) : null; } catch (e) {}
  return { count: n.n, password };
}
export async function claimLegacy(env, uid) {
  const { results } = await env.DB.prepare('SELECT path, data FROM docs WHERE data IS NOT NULL').all();
  const writes = [];
  for (const r of results) { if (!DOC_PATH.test(r.path)) continue; try { writes.push({ path: r.path, data: JSON.parse(r.data) }); } catch (e) {} }
  await writeDocs(env, uid, writes);
  await env.DB.batch([env.DB.prepare('DROP TABLE docs'), env.DB.prepare("DELETE FROM meta WHERE k = 'password'")]);
  return writes.length;
}
async function pbkdf2(password, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256));
}
const fromHex = h => new Uint8Array((h.match(/../g) || []).map(x => parseInt(x, 16)));
export async function legacyPasswordOk(env, given, stored) {
  if (typeof given !== 'string' || !given) return false;
  const envPw = String(env.NOTEBOOK_PASSWORD || '');
  if (envPw.length >= 6) return (await sha256(given)) === (await sha256(envPw));
  if (!stored) return false;
  const got = await pbkdf2(given, fromHex(stored.salt)), want = fromHex(stored.hash);
  let d = got.length ^ want.length; for (let i = 0; i < Math.min(got.length, want.length); i++) d |= got[i] ^ want[i];
  return d === 0;
}
