/* Study Notebook online: one shared site where each student signs in with Google and keeps a
   private notebook.
   - The website (/app/) is the same notebook as the desktop app, for phone and laptop.
   - Claude connects as a custom connector at /mcp; the student signs in with Google once.
   - The desktop app links to the account (/link) and syncs with it (/sync/*).
   Every note is stored with its owner's account id, and every read and write is scoped to it. */
import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import { McpHandler, VERSION } from './mcp.js';
import * as store from './store.js';
import { currentUser, startGoogle, finishGoogle, signInResponse, signOutResponse, formToken, formOk, readCookie, safeNext, googleReady, devGoogle, SESSION_COOKIE } from './auth.js';
import * as P from './pages.js';
import { landingPage } from './landing.js';
import { over, address, tooMany } from './limits.js';

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 26 26"><rect x="4" y="2.5" width="18" height="21" rx="3" fill="#0071e3"/><rect x="7" y="2.5" width="2" height="21" fill="#005bb8"/><path d="M12 9h7M12 13h7M12 17h4.5" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const json = (data, status = 200, headers = {}) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
const redirect = (to, headers = {}) => new Response(null, { status: 302, headers: { Location: to, 'Cache-Control': 'no-store', ...headers } });
const here = url => url.pathname + url.search;
const signInFirst = url => redirect(`/auth/google?next=${encodeURIComponent(here(url))}`);
const ERRORS = {
  cancelled: 'Sign-in was cancelled.',
  expired: 'That sign-in took too long or was opened in another browser. Try again.',
  google: 'Google didn’t confirm the sign-in. Try again in a moment.',
  unverified: 'That Google account has no confirmed email address.'
};

/* ---------------- the website's data API (signed-in browser) ---------------- */

async function api(request, env, url, user) {
  const route = url.pathname.slice('/api/'.length);
  if (await over(env.RL_USER, 'u:' + user.id)) return tooMany();
  // Reading and changing data needs this header, which other sites can't send with the cookie.
  if (request.method !== 'GET' && request.headers.get('X-Study-Notebook') !== '1') return json({ error: 'forbidden' }, 403);
  if (route === 'me' && request.method === 'GET') {
    let claude = 0; try { claude = (await env.OAUTH_PROVIDER.listUserGrants(user.id)).items.length; } catch (e) {}
    return json({ email: user.email, name: user.name || '', mcp: `${url.origin}/mcp`, claude, rev: await store.currentRev(env, user.id) });
  }
  if (route === 'docs' && request.method === 'GET') {
    const rev = await store.currentRev(env, user.id);
    return json({ rev, docs: await store.loadDocs(env, user.id) });
  }
  if (route === 'pull' && request.method === 'GET') {
    const since = Math.max(0, Number(url.searchParams.get('since')) || 0);
    const changes = await store.changesSince(env, user.id, since);
    return json({ rev: changes.length ? changes[changes.length - 1].rev : await store.currentRev(env, user.id), more: changes.length === 5000, changes });
  }
  if (route === 'push' && request.method === 'POST') return push(request, env, user.id);
  if (route === 'export' && request.method === 'GET') {
    const docs = await store.loadDocs(env, user.id);
    const day = new Date().toISOString().slice(0, 10);
    return new Response(JSON.stringify({ version: 1, savedAt: Date.now(), docs }), { headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="study-notebook-${day}.json"`, 'Cache-Control': 'no-store' } });
  }
  return json({ error: 'not_found' }, 404);
}
async function push(request, env, uid) {
  let body; try { body = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400); }
  const incoming = Array.isArray(body && body.changes) ? body.changes : null;
  if (!incoming || incoming.length > 5000) return json({ error: 'bad_changes' }, 400);
  try { return json({ ok: true, ...(await store.applyPush(env, uid, incoming)) }); }
  catch (e) { if (e.code === 'full') return json({ error: 'full', message: 'Your notebook is full (15 MB). Delete old recordings or courses to make room.' }, 413); if (e.code) return json({ error: e.code, path: e.path }, 400); throw e; }
}

/* ---------------- the desktop app's sync (signed in with a token) ---------------- */

async function sync(request, env, url) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const user = await store.sessionUser(env, token, 'app');
  if (!user) return json({ error: 'signed_out' }, 401);
  if (await over(env.RL_USER, 'u:' + user.id)) return tooMany();
  const route = url.pathname.replace(/^\/sync\/?/, '');
  if (route === 'ping' && request.method === 'GET') {
    return json({ ok: true, version: VERSION, rev: await store.currentRev(env, user.id), docs: await store.countDocs(env, user.id), email: user.email, name: user.name || '', mcp: `${url.origin}/mcp` });
  }
  if (route === 'pull' && request.method === 'GET') {
    const since = Math.max(0, Number(url.searchParams.get('since')) || 0);
    const changes = await store.changesSince(env, user.id, since);
    return json({ rev: changes.length ? changes[changes.length - 1].rev : await store.currentRev(env, user.id), more: changes.length === 5000, changes });
  }
  if (route === 'push' && request.method === 'POST') return push(request, env, user.id);
  if (route === 'signout' && request.method === 'POST') { await store.endSession(env, token); return json({ ok: true }); }
  return json({ error: 'not_found' }, 404);
}

// The app finishes linking: it trades the one-time code (and its PKCE secret) for its own token.
async function appToken(request, env) {
  let body; try { body = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400); }
  const code = String((body && body.code) || ''), verifier = String((body && body.verifier) || '');
  if (!code || !verifier) return json({ error: 'bad_request' }, 400);
  const key = `lc:${await store.sha256(code)}`;
  const saved = await env.OAUTH_KV.get(key, 'json');
  if (!saved) return json({ error: 'expired' }, 400);
  await env.OAUTH_KV.delete(key);
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(d))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  if (challenge !== saved.challenge) return json({ error: 'mismatch' }, 400);
  const user = await store.userById(env, saved.uid);
  if (!user) return json({ error: 'expired' }, 400);
  const token = await store.createSession(env, user.id, 'app', saved.device || 'A computer');
  return json({ token, email: user.email, name: user.name || '' });
}

/* ---------------- pages ---------------- */

async function linkPage(request, env, url, user) {
  if (request.method === 'GET') {
    const q = url.searchParams;
    const port = Number(q.get('port')), state = q.get('state') || '', challenge = q.get('challenge') || '';
    if (!(port > 1023 && port < 65536) || !/^[A-Za-z0-9_-]{16,128}$/.test(state) || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) {
      return P.html(P.messagePage('This link isn’t complete', 'Start again from the Study Notebook app: Settings → Sign in with Google.', { user }), 400);
    }
    const device = String(q.get('device') || '').slice(0, 60);
    return P.html(P.appLinkPage({ user, token: await formToken(request), fields: { port, state, challenge, device }, here: here(url), device }));
  }
  const form = await request.formData();
  if (!(await formOk(request, form))) return P.html(P.messagePage('Try again', 'This page was open too long. Start again from the app.', { user }), 400);
  const port = Number(form.get('port')), state = String(form.get('state') || ''), challenge = String(form.get('challenge') || '');
  if (!(port > 1023 && port < 65536) || !/^[A-Za-z0-9_-]{16,128}$/.test(state) || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return P.html(P.messagePage('This link isn’t complete', 'Start again from the app.', { user }), 400);
  const back = `http://127.0.0.1:${port}/done`;
  if (form.get('decision') !== 'approve') return redirect(`${back}?state=${encodeURIComponent(state)}&error=denied`);
  const code = store.secret();
  await env.OAUTH_KV.put(`lc:${await store.sha256(code)}`, JSON.stringify({ uid: user.id, challenge, device: String(form.get('device') || '').slice(0, 60) }), { expirationTtl: 300 });
  return redirect(`${back}?state=${encodeURIComponent(state)}&code=${encodeURIComponent(code)}`);
}

async function accountGrants(env, uid) {
  const out = [];
  try {
    let cursor;
    do {
      const page = await env.OAUTH_PROVIDER.listUserGrants(uid, { cursor });
      for (const g of page.items) {
        let client = null; try { client = await env.OAUTH_PROVIDER.lookupClient(g.clientId); } catch (e) {}
        out.push({ id: g.id, client: client && client.clientName, createdAt: g.createdAt });
      }
      cursor = page.cursor;
    } while (cursor);
  } catch (e) { console.error('grants', e); }
  return out;
}
async function computers(env, uid) {
  const { results } = await env.DB.prepare("SELECT hash, label, created, last_used FROM sessions WHERE uid = ?1 AND kind = 'app' ORDER BY created").bind(uid).all();
  return results.map(r => ({ id: r.hash.slice(0, 16), label: r.label, created: r.created, last_used: r.last_used }));
}
async function account(request, env, url, user) {
  const u = { ...user, mcp: `${url.origin}/mcp` };
  if (request.method === 'GET' && url.pathname === '/account') {
    const [notes, grants, pcs, owner] = await Promise.all([store.countDocs(env, user.id), accountGrants(env, user.id), computers(env, user.id), store.isOwner(env, user.id)]);
    const legacy = owner ? await store.legacyInfo(env) : null;   // only the site's owner can claim the old password notebook
    return P.html(P.accountPage({ user: u, token: await formToken(request), notes, grants, computers: pcs, legacy, msg: url.searchParams.get('done') || '' }));
  }
  if (request.method !== 'POST') return redirect('/account');
  const form = await request.formData();
  if (!(await formOk(request, form))) return redirect('/account');
  if (url.pathname === '/account/revoke') {
    try { await env.OAUTH_PROVIDER.revokeGrant(String(form.get('grant') || ''), user.id); } catch (e) {}
    return redirect('/account?done=' + encodeURIComponent('Claude is disconnected.'));
  }
  if (url.pathname === '/account/unlink') {
    const id = String(form.get('id') || '');
    if (/^[0-9a-f]{16}$/.test(id)) await env.DB.prepare("DELETE FROM sessions WHERE uid = ?1 AND kind = 'app' AND substr(hash, 1, 16) = ?2").bind(user.id, id).run();
    return redirect('/account?done=' + encodeURIComponent('That computer is unlinked.'));
  }
  if (url.pathname === '/account/claim') {
    const legacy = (await store.isOwner(env, user.id)) ? await store.legacyInfo(env) : null;
    if (!legacy) return redirect('/account');
    if (!(await store.legacyPasswordOk(env, String(form.get('password') || ''), legacy.password))) {
      await new Promise(r => setTimeout(r, 800));
      return redirect('/account?done=' + encodeURIComponent('That password isn’t right; nothing was moved.'));
    }
    const n = await store.claimLegacy(env, user.id);
    return redirect('/account?done=' + encodeURIComponent(`${n} items moved into your account.`));
  }
  if (url.pathname === '/account/delete') {
    if (form.get('sure') !== '1') return redirect('/account');
    for (const g of await accountGrants(env, user.id)) { try { await env.OAUTH_PROVIDER.revokeGrant(g.id, user.id); } catch (e) {} }
    await store.deleteUser(env, user.id);
    const res = P.html(P.messagePage('Your account is deleted', 'Your notebook and sign-ins were removed from this site. Thanks for studying with Study Notebook.', { action: '<a class="btn" href="/">Done</a>' }));
    res.headers.append('Set-Cookie', `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${url.hostname === '127.0.0.1' || url.hostname === 'localhost' ? '' : '; Secure'}`);
    return res;
  }
  return redirect('/account');
}

async function claudeConsent(request, env, url, user) {
  const oauth = env.OAUTH_PROVIDER;
  if (request.method === 'GET') {
    let req; try { req = await oauth.parseAuthRequest(request); } catch (e) { return P.html(P.messagePage('This connection link isn’t valid', 'Start connecting again from Claude.', { user }), 400); }
    const details = await oauth.describeConsent(req);
    const consent = await oauth.beginConsent(req);
    const host = String(details.redirectHost || '');
    const page = P.claudeConsentPage({ user, handle: consent.handle, token: await formToken(request), clientName: details.clientName, redirectHost: host, isClaude: /(^|\.)claude\.(ai|com)$/.test(host), loopback: details.redirectIsLoopback, here: here(url) });
    const res = P.html(page);
    for (const [k, v] of consent.headers) if (k.toLowerCase() === 'set-cookie') res.headers.append(k, v);
    return res;
  }
  const form = await request.formData();
  const handle = String(form.get('handle') || '');
  if (!(await formOk(request, form)) || form.get('decision') !== 'approve') {
    const denied = await oauth.denyConsent(request, handle);
    return new Response(null, { status: 302, headers: denied.headers });
  }
  const approved = await oauth.approveConsent(request, handle, { scope: form.getAll('scope').map(String) });
  const { redirectTo } = await oauth.completeAuthorization({ request: approved.request, userId: user.id, metadata: { label: 'Study Notebook' }, scope: approved.request.scope, props: { uid: user.id } });
  approved.headers.set('Location', redirectTo);
  return new Response(null, { status: 302, headers: approved.headers });
}

// The notebook itself: the same pages as the desktop app, served only to a signed-in student.
async function notebook(request, env, url, user) {
  if (url.pathname === '/app') return redirect('/app/');
  const path = url.pathname.slice('/app'.length) || '/';
  const assetUrl = new URL(path, url.origin);
  return withHeaders(await env.ASSETS.fetch(new Request(assetUrl, request)));
  function withHeaders(r) {
    const out = new Response(r.body, r);
    const loc = out.headers.get('Location');
    if (loc && loc.startsWith('/')) out.headers.set('Location', '/app' + loc);
    out.headers.set('X-Frame-Options', 'DENY');
    if (/\.html?$|\/$/.test(assetUrl.pathname)) out.headers.set('Cache-Control', 'no-store');
    return out;
  }
}

const Pages = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;
    if (p === '/auth/google') {
      if (!googleReady(env, url)) return P.html(P.messagePage('Sign-in isn’t set up yet', 'The site owner still needs to add the Google sign-in key. Try again later.'), 503);
      return startGoogle(request, env, url.searchParams.get('next'));
    }
    if (p === '/auth/dev-google' && devGoogle(env, url)) return P.html(P.devGooglePage(url.searchParams.get('state') || ''));
    if (p === '/auth/google/callback') {
      if (devGoogle(env, url) && url.searchParams.get('email')) url.searchParams.set('code', 'dev:' + url.searchParams.get('email'));
      const r = await finishGoogle(new Request(url, request), env);
      if (r.error) return P.html(P.signInPage('/app/', { error: ERRORS[r.error] || ERRORS.google }), 400);
      return signInResponse(request, env, r.user, r.next);
    }
    if (p === '/auth/signout') return signOutResponse(request, env, safeNext(url.searchParams.get('next') || '/'));
    if (p === '/privacy') return P.html(P.privacyPage(await currentUser(request, env), env.OWNER_NAME || ''));

    const user = await currentUser(request, env);
    if (p === '/') return user ? redirect('/app/') : P.html(landingPage({ ready: googleReady(env, url) }), 200, { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; font-src 'self'; script-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'" });
    if (p.startsWith('/landing/') && request.method === 'GET') return env.ASSETS.fetch(new Request(new URL(p, url.origin), request));
    if (p === '/favicon.ico' || p === '/favicon.svg') return new Response(FAVICON, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' } });
    const NEEDS_SIGN_IN = p === '/app' || p.startsWith('/app/') || p === '/authorize' || p === '/link' || p === '/account' || p.startsWith('/account/');
    if (!user) {
      if (p.startsWith('/api/')) return json({ error: 'signed_out' }, 401);
      // Only real pages start a sign-in; stray requests (icons, typos) must not restart one in progress.
      if (request.method === 'GET' && NEEDS_SIGN_IN && /text\/html|\*\/\*/.test(request.headers.get('Accept') || '*/*')) return signInFirst(url);
      if (NEEDS_SIGN_IN) return redirect('/');
      return P.html(P.messagePage('Not found', 'There’s nothing at this address.', { action: '<a class="btn" href="/">Go to Study Notebook</a>' }), 404);
    }
    if (p === '/app' || p.startsWith('/app/')) return notebook(request, env, url, user);
    if (p.startsWith('/api/')) return api(request, env, url, user);
    if (p === '/authorize') return claudeConsent(request, env, url, user);
    if (p === '/link') return linkPage(request, env, url, user);
    if (p === '/account' || p.startsWith('/account/')) return account(request, env, url, user);
    return P.html(P.messagePage('Not found', 'There’s nothing at this address.', { user, action: '<a class="btn" href="/app/">Open notebook</a>' }), 404);
  }
};

/* ---------------- wiring ---------------- */

const providers = new Map();
function providerFor(origin) {
  if (!providers.has(origin)) providers.set(origin, new OAuthProvider({
    apiRoute: '/mcp',
    apiHandler: McpHandler,
    defaultHandler: Pages,
    authorizeEndpoint: '/authorize',
    tokenEndpoint: '/token',
    clientRegistrationEndpoint: '/register',
    clientIdMetadataDocumentEnabled: true,
    accessTokenTTL: 3600,
    resourceMetadata: { resource: `${origin}/mcp`, authorization_servers: [origin], resource_name: 'Study Notebook' }
  }));
  return providers.get(origin);
}

// Requests that only fetch the site's own files (pages, scripts, fonts) aren't counted.
const isFile = (request, p) => request.method === 'GET' && (/^\/(app|landing)\/.+\.[a-z0-9]{1,8}$/i.test(p) || p === '/favicon.ico' || p === '/favicon.svg');
const SIGN_IN = p => p.startsWith('/auth/') || p === '/link' || p === '/register';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname, ip = address(request);
    if (SIGN_IN(p) && await over(env.RL_AUTH, p === '/register' ? 'r:' + ip : 'a:' + ip)) return tooMany();
    if (p !== '/mcp' && p !== '/token' && p !== '/register' && !isFile(request, p) && await over(env.RL_IP, ip)) return tooMany();
    if (url.pathname.startsWith('/sync/')) return sync(request, env, url);
    if (url.pathname === '/auth/app/token' && request.method === 'POST') return appToken(request, env);
    return providerFor(url.origin).fetch(request, env, ctx);
  }
};
