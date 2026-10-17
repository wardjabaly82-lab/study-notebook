/* On the website, there is no desktop app around the notebook. This gives the notebook the same
   functions it gets from the desktop app, backed by the student's online account instead:
   loading and saving notes, changes from Claude arriving live, backups as downloads.
   In the desktop app (window.desktop already exists) this file does nothing. */
(() => {
  'use strict';
  if (window.desktop) return;
  const H = { 'Content-Type': 'application/json', 'X-Study-Notebook': '1' };
  let synced = new Map();          // path -> JSON text of what the server has
  let rev = 0;
  let onOp = null, onCloud = null, me = null, lastSync = 0, error = '', online = 0;
  let pulling = null, pushing = Promise.resolve();
  const signedOut = () => { location.href = '/auth/google?next=' + encodeURIComponent('/app/'); };
  async function req(path, opts = {}) {
    const r = await fetch(path, { credentials: 'same-origin', ...opts, headers: { ...H, ...(opts.headers || {}) } });
    if (r.status === 401) { signedOut(); throw new Error('signed_out'); }
    if (!r.ok) throw new Error('http ' + r.status);
    return r.json();
  }
  const status = () => ({ enabled: true, web: true, email: me && me.email, name: me && me.name, mcp: me && me.mcp, claude: me && me.claude, lastSync, syncing: !!pulling, error, online });
  const tell = () => { if (onCloud) onCloud(status()); };

  async function pull() {
    if (pulling) return pulling;
    pulling = (async () => {
      try {
        let more = true;
        while (more) {
          const r = await req('/api/pull?since=' + rev);
          more = r.more; rev = r.rev;
          const fresh = r.changes.filter(c => { const now = c.data === null ? null : JSON.stringify(c.data); const had = synced.has(c.path) ? synced.get(c.path) : null; return now !== had; });
          for (const c of r.changes) { if (c.data === null) synced.delete(c.path); else synced.set(c.path, JSON.stringify(c.data)); }
          if (fresh.length && onOp) await onOp('__cloud_apply', { changes: fresh.map(c => ({ path: c.path, data: c.data })) });
        }
        lastSync = Date.now(); error = ''; online = synced.size;
      } catch (e) { if (e.message !== 'signed_out') error = 'Can’t reach your online notebook. Changes are kept and sent when the connection is back.'; }
      finally { pulling = null; tell(); }
    })();
    return pulling;
  }

  function saveData(text, keepalive) {
    let docs; try { docs = JSON.parse(text).docs || {}; } catch (e) { return Promise.resolve({ ok: false }); }
    pushing = pushing.then(async () => {
      const changes = [];
      for (const [p, d] of Object.entries(docs)) { const s = JSON.stringify(d); if (synced.get(p) !== s) changes.push({ path: p, data: d, s }); }
      for (const p of synced.keys()) if (!(p in docs)) changes.push({ path: p, data: null, s: null });
      if (!changes.length) return { ok: true };
      try {
        for (let i = 0; i < changes.length; i += 500) {
          const part = changes.slice(i, i + 500);
          const r = await req('/api/push', { method: 'POST', keepalive: !!keepalive, body: JSON.stringify({ changes: part.map(c => ({ path: c.path, data: c.data })) }) });
          for (const c of part) { if (c.s === null) synced.delete(c.path); else synced.set(c.path, c.s); }
          // Where the online copy was newer (e.g. Claude just changed it), take that one.
          if (r.kept && r.kept.length) { for (const k of r.kept) synced.set(k.path, JSON.stringify(k.data)); if (onOp) setTimeout(() => onOp('__cloud_apply', { changes: r.kept }), 0); }
        }
        error = ''; lastSync = Date.now(); online = synced.size; tell();
        return { ok: true };
      } catch (e) { error = 'Can’t reach your online notebook. Changes are kept and sent when the connection is back.'; tell(); return { ok: false }; }
    });
    return pushing;
  }

  function download(name, text, type = 'application/json') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  window.desktop = {
    isDesktop: false, web: true, platform: 'web',
    async getSettings() { return { version: 'web', web: true, theme: null }; },
    setTheme() {},
    async loadData() {
      const [r, m] = await Promise.all([req('/api/docs'), req('/api/me')]);
      me = m; rev = r.rev; synced = new Map(Object.entries(r.docs).map(([p, d]) => [p, JSON.stringify(d)]));
      lastSync = Date.now(); online = synced.size;
      // Claude's changes arrive within seconds while the page is open.
      setInterval(() => { if (document.visibilityState === 'visible') pull(); }, 8000);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pull(); });
      window.addEventListener('online', () => pull());
      return { docs: r.docs };
    },
    saveData: text => saveData(text, false),
    async exportBackup(text) { download(`study-notebook-${new Date().toISOString().slice(0, 10)}.json`, text); return { ok: true }; },
    importBackup() {
      return new Promise(resolve => {
        const i = document.createElement('input'); i.type = 'file'; i.accept = '.json,application/json';
        i.onchange = async () => {
          const f = i.files && i.files[0]; if (!f) return resolve({ ok: false, cancelled: true });
          try { const data = JSON.parse(await f.text()); if (!data || typeof data.docs !== 'object') throw 0; resolve({ ok: true, data }); }
          catch (e) { resolve({ ok: false, message: 'That file isn’t a Study Notebook backup.' }); }
        };
        i.click();
      });
    },
    async saveFile(filename, data) { download(filename, data, 'application/octet-stream'); return { ok: true }; },
    openDataFolder() {},
    openExternal(url) { window.open(url, '_blank', 'noopener'); },
    async copyText(text) { try { await navigator.clipboard.writeText(String(text)); return true; } catch (e) { return false; } },
    async cloudStatus() { return status(); },
    async cloudSync() { await pull(); return status(); },
    async cloudDisconnect() { location.href = '/auth/signout'; },
    onCloudStatus(fn) { onCloud = fn; },
    async refreshMe() { try { me = await req('/api/me'); tell(); } catch (e) {} return status(); },
    onTextSize() {}, onUpdateReady() {}, onUpdateProgress() {}, onSpeechProgress() {}, onClaudeSeen() {},
    onConnectorOp(fn) { onOp = fn; },
    onFlush(fn) {
      const go = () => { try { fn(); } catch (e) {} };
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') go(); });
      window.addEventListener('pagehide', go);
    }
  };
})();
