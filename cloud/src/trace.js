/* A short, private trace of connection (sign-in) steps, so a failing connection from Claude or
   Gemini can be diagnosed. Only the steps of connecting are noted, never notes, codes or tokens:
   which step, its answer, which app asked (by its sign-in return address) and any error name.
   Kept for 2 days; only the site owner can see it (account page). */
const KEEP = 2 * 86400;
const STEPS = p => p.startsWith('/.well-known/') || p === '/register' || p === '/authorize' || p === '/token' || p === '/mcp';
export function wants(request, url) {
  const p = url.pathname;
  if (!STEPS(p)) return false;
  // normal use of the notebook by a connected assistant isn't noted, only connecting
  if (p === '/mcp' && request.headers.get('Authorization')) return 'mcp-auth';
  return true;
}
const hostOf = u => { try { return new URL(u).hostname; } catch (e) { return ''; } };
export async function note(env, request, url, response, kind) {
  try {
    if (kind === 'mcp-auth' && response.status !== 401) return;   // a token that stopped working is worth noting
    const e = { t: Date.now(), m: request.method, p: url.pathname, s: response.status, ua: (request.headers.get('User-Agent') || '').slice(0, 80) };
    const q = url.searchParams;
    if (q.get('client_id')) e.client = q.get('client_id').slice(0, 80);
    if (q.get('redirect_uri')) e.back = hostOf(q.get('redirect_uri'));
    if (q.get('scope')) e.scope = q.get('scope').slice(0, 200);
    if (url.pathname === '/token' || url.pathname === '/register') {
      try {
        const body = await request.text();
        if (url.pathname === '/token') { const f = new URLSearchParams(body); e.grant = f.get('grant_type'); if (f.get('client_id')) e.client = f.get('client_id').slice(0, 80); if (f.get('redirect_uri')) e.back = hostOf(f.get('redirect_uri')); e.basic = /^Basic /i.test(request.headers.get('Authorization') || ''); }
        else { const j = JSON.parse(body || '{}'); e.name = String(j.client_name || '').slice(0, 60); e.back = (j.redirect_uris || []).map(hostOf).join(' '); e.auth = j.token_endpoint_auth_method; e.scope = j.scope; }
      } catch (x) {}
    }
    if (response.status >= 400) { try { const j = await response.clone().json(); e.err = String(j.error || '').slice(0, 60); e.why = String(j.error_description || '').slice(0, 160); } catch (x) {} }
    await env.OAUTH_KV.put(`trace:${e.t}:${Math.random().toString(36).slice(2, 6)}`, JSON.stringify(e), { expirationTtl: KEEP });
  } catch (x) {}
}
export async function recent(env, limit = 60) {
  const out = [];
  try {
    const list = await env.OAUTH_KV.list({ prefix: 'trace:', limit: 1000 });
    const keys = list.keys.map(k => k.name).sort().slice(-limit);
    for (const k of keys) { const v = await env.OAUTH_KV.get(k, 'json'); if (v) out.push(v); }
  } catch (e) {}
  return out.reverse();
}

// What a connected app other than Claude asked the notebook (method, tool name, how many tools it was
// given, error codes), so a chat that doesn't get the tools can be diagnosed. No arguments or notes.
export async function noteRpc(env, app, msgs, out, request, status = 200) {
  try {
    const byId = new Map(out.map(r => [r && r.id, r]));
    const steps = msgs.slice(0, 10).map(m => {
      const r = m && byId.get(m.id), x = { m: m && m.method };
      if (m && m.method === 'tools/call') x.tool = String((m.params || {}).name || '').slice(0, 40);
      if (m && m.method === 'initialize') x.v = String((m.params || {}).protocolVersion || '').slice(0, 20) + ' ' + String(((m.params || {}).clientInfo || {}).name || '').slice(0, 30);
      if (r && r.result && Array.isArray(r.result.tools)) x.tools = r.result.tools.length;
      if (r && r.result && r.result.isError) x.err = 'tool error';
      if (r && r.error) x.err = String(r.error.code);
      return x;
    });
    const e = { t: Date.now(), m: request.method, p: '/mcp', s: status, app, rpc: steps, ua: (request.headers.get('User-Agent') || '').slice(0, 80), acc: (request.headers.get('Accept') || '').slice(0, 60) };
    await env.OAUTH_KV.put(`trace:${e.t}:${Math.random().toString(36).slice(2, 6)}`, JSON.stringify(e), { expirationTtl: KEEP });
  } catch (x) {}
}
