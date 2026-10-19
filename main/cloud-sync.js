'use strict';
/* Keeps the notes on this laptop and your online notebook (cloud/) in step, both ways.
   - Pull: changes made online (Claude in any chat) since the last sync are applied here.
   - Push: changes made here (by you, the laptop connector, recordings, practice) are sent online.
   Each item (course, section, lecture, card) is synced on its own. If the same item changed in
   both places, the newer version (updatedAt) wins. Deleting syncs too. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Same text for the same content, whatever the order of keys.
function stable(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
}
const hashOf = v => v === undefined || v === null ? null : crypto.createHash('sha1').update(stable(v)).digest('hex');

class SyncError extends Error { constructor(code, message) { super(message || code); this.code = code; } }

const { keepMarks } = require('../renderer/notebook-ops.js');

function create({ dataDir, loadData, applyChanges, log, onStatus, fetchImpl }) {
  const doFetch = fetchImpl || fetch;
  const stateFile = () => path.join(dataDir(), 'sync-state.json');
  const readState = () => { try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch (e) { return { rev: 0, hashes: {} }; } };
  const writeState = s => { const tmp = stateFile() + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(s), { mode: 0o600 }); fs.renameSync(tmp, stateFile()); };

  let cfg = null;              // { url, token }: the site and this computer's sign-in to the student's account
  let running = null, again = false, timer = null, interval = null;
  const status = { enabled: false, url: '', email: '', name: '', mcp: '', claude: 0, lastSync: 0, error: '', syncing: false, pulled: 0, pushed: 0, online: 0 };
  const emit = () => { try { onStatus && onStatus({ ...status }); } catch (e) {} };

  async function api(method, route, body) {
    let res;
    try {
      res = await doFetch(cfg.url.replace(/\/+$/, '') + route, {
        method, headers: { Authorization: 'Bearer ' + cfg.token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000)
      });
    } catch (e) { throw new SyncError('offline', 'Can’t reach your online notebook. Check the internet connection.'); }
    if (res.status === 401) throw new SyncError('signed_out', 'This computer was signed out of your account. Sign in with Google again.');
    if (res.status === 413) throw new SyncError('full', 'Your online notebook is full (15 MB). Delete old recordings or courses to make room.');
    if (!res.ok) throw new SyncError('server', `Your online notebook answered with an error (${res.status}).`);
    try { return await res.json(); } catch (e) { throw new SyncError('server', 'That address doesn’t look like a Study Notebook online server.'); }
  }

  async function syncOnce() {
    const st = readState();
    // 1. Pull what changed online.
    let docs = (loadData().docs) || {};
    const incoming = [];
    let more = true, rev = st.rev || 0;
    while (more) {
      const r = await api('GET', `/sync/pull?since=${rev}`);
      for (const ch of r.changes || []) {
        const remoteHash = hashOf(ch.data), localHash = hashOf(docs[ch.path]), base = st.hashes[ch.path] || null;
        if (remoteHash === localHash) { if (remoteHash) st.hashes[ch.path] = remoteHash; else delete st.hashes[ch.path]; continue; }
        // Unchanged online since we last agreed (often our own upload coming back): what's here wins.
        if (remoteHash === base) continue;
        const localChanged = localHash !== base;
        let takeRemote = !localChanged;
        if (localChanged) {
          const l = docs[ch.path], o = ch.data;
          if (!l) takeRemote = !!o;                                   // gone here, but changed online: bring it back
          else if (!o) takeRemote = false;                            // changed here, deleted online: keep it
          else {
            // both changed: the newer text wins, and highlights/drawings come from the copy marked last
            const newer = (o.updatedAt || 0) > (l.updatedAt || 0);
            const merged = newer ? keepMarks(o, l) : keepMarks(l, o), mh = hashOf(merged);
            if (mh === remoteHash) takeRemote = true;
            else { if (mh !== localHash) incoming.push({ path: ch.path, data: merged }); continue; }   // pushed below
          }
        }
        if (takeRemote) { incoming.push({ path: ch.path, data: ch.data }); if (remoteHash) st.hashes[ch.path] = remoteHash; else delete st.hashes[ch.path]; }
      }
      rev = Math.max(rev, r.rev || 0); more = !!r.more && (r.changes || []).length > 0;
    }
    if (incoming.length) { await applyChanges(incoming); docs = (loadData().docs) || {}; }
    st.rev = rev;
    // 2. Push what changed here.
    const out = [];
    for (const [p, d] of Object.entries(docs)) { const h = hashOf(d); if (st.hashes[p] !== h) out.push({ path: p, data: d, h }); }
    for (const p of Object.keys(st.hashes)) if (!(p in docs)) out.push({ path: p, data: null, h: null });
    let pushed = 0;
    for (let i = 0; i < out.length;) {
      // Batches of up to 400 items and about 4 MB.
      const batch = []; let size = 0;
      while (i < out.length && batch.length < 400 && (size < 4e6 || !batch.length)) { size += JSON.stringify(out[i].data || '').length; batch.push(out[i++]); }
      const r = await api('POST', '/sync/push', { changes: batch.map(({ path: p, data }) => ({ path: p, data })) });
      const kept = new Map((r.kept || []).map(k => [k.path, k.data]));
      for (const b of batch) { if (kept.has(b.path)) continue; if (b.h) st.hashes[b.path] = b.h; else delete st.hashes[b.path]; pushed++; }
      // Online had a newer version of these: take it here.
      if (kept.size) { const back = [...kept].map(([p, d]) => ({ path: p, data: d })); await applyChanges(back); for (const k of back) st.hashes[k.path] = hashOf(k.data); }
    }
    writeState(st);
    // After a sync both sides hold the same items, so no extra request is needed to count them.
    Object.assign(status, { lastSync: Date.now(), error: '', pulled: incoming.length, pushed, online: Object.keys(loadData().docs || {}).length });
    if (incoming.length || pushed) log.info('cloud.synced', { pulled: incoming.length, pushed });
  }

  async function run() {
    if (!cfg) return { ...status };
    if (running) { again = true; return running; }
    status.syncing = true; emit();
    running = (async () => {
      try { await syncOnce(); }
      catch (e) { status.error = e instanceof SyncError ? e.message : 'Sync failed: ' + (e && e.message); log.warn('cloud.sync.failed', { code: e && e.code, error: e && e.message }); }
      finally { status.syncing = false; running = null; emit(); }
      if (again) { again = false; return run(); }
      return { ...status };
    })();
    return running;
  }

  return {
    // The site and this computer's sign-in come from the app's settings (the sign-in is stored encrypted).
    configure(next) {
      cfg = next && next.url && next.token ? { url: next.url, token: next.token } : null;
      Object.assign(status, { enabled: !!cfg, url: cfg ? cfg.url : '', email: (next && next.email) || '', name: (next && next.name) || '', mcp: cfg ? cfg.url.replace(/\/+$/, '') + '/mcp' : '', error: '' });
      clearInterval(interval); interval = cfg ? setInterval(() => run(), 60000) : null;
      emit();
    },
    // Tells the site this computer is signing out (best effort).
    async signOut() { if (!cfg) return; try { await api('POST', '/sync/signout'); } catch (e) {} },
    sync: run,
    soon() { if (!cfg) return; clearTimeout(timer); timer = setTimeout(() => run(), 3000); },
    reset() { try { fs.rmSync(stateFile(), { force: true }); } catch (e) {} },
    status: () => ({ ...status }),
    SyncError
  };
}

module.exports = { create, hashOf };
