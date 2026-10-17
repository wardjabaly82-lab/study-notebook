/* Signing in with Google, and the website's session cookie.
   Only the basic Google permissions are asked for (openid, email, profile): the site learns the
   student's name and email address, nothing else, and keeps no Google password or token. */
import { upsertUser, createSession, sessionUser, endSession, randomId, sha256 } from './store.js';

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
export const SESSION_COOKIE = 'sn_session';
const STATE_COOKIE = 'sn_gs';

const isLocal = url => url.hostname === '127.0.0.1' || url.hostname === 'localhost';
// A stand-in for Google, for testing on this computer only. It can never switch on for a real address.
export const devGoogle = (env, url) => env.DEV_FAKE_GOOGLE === '1' && isLocal(url);
export const googleReady = (env, url) => devGoogle(env, url) || (!!env.GOOGLE_CLIENT_ID && !!env.GOOGLE_CLIENT_SECRET);

export function cookie(url, name, value, { maxAge, path = '/' } = {}) {
  const parts = [`${name}=${value}`, `Path=${path}`, 'HttpOnly', 'SameSite=Lax'];
  if (!isLocal(url)) parts.push('Secure');
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
  return parts.join('; ');
}
export function readCookie(request, name) {
  const all = request.headers.get('Cookie') || '';
  for (const part of all.split(/;\s*/)) { const i = part.indexOf('='); if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1); }
  return '';
}
// Only paths on this site may be returned to after signing in.
export const safeNext = n => (typeof n === 'string' && /^\/(?![/\\])/.test(n) && n.length < 4000 ? n : '/app/');

export async function currentUser(request, env) {
  return sessionUser(env, readCookie(request, SESSION_COOKIE), 'web');
}

const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Step 1: send the student to Google.
export async function startGoogle(request, env, next) {
  const url = new URL(request.url);
  const state = randomId(24);
  const verifier = randomId(48);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  await env.OAUTH_KV.put(`gs:${await sha256(state)}`, JSON.stringify({ next: safeNext(next), verifier }), { expirationTtl: 600 });
  const headers = new Headers({ 'Set-Cookie': cookie(url, STATE_COOKIE, state, { maxAge: 600, path: '/auth' }), 'Cache-Control': 'no-store' });
  if (devGoogle(env, url)) {
    headers.set('Location', `/auth/dev-google?state=${encodeURIComponent(state)}`);
  } else {
    const q = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID, redirect_uri: `${url.origin}/auth/google/callback`, response_type: 'code',
      scope: 'openid email profile', state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account'
    });
    headers.set('Location', `${GOOGLE_AUTH}?${q}`);
  }
  return new Response(null, { status: 302, headers });
}

// Step 2: Google sends the student back here. Returns { user, next } or { error }.
export async function finishGoogle(request, env) {
  const url = new URL(request.url);
  const state = url.searchParams.get('state') || '';
  if (url.searchParams.get('error')) return { error: 'cancelled' };
  if (!state || state !== readCookie(request, STATE_COOKIE)) return { error: 'expired' };
  const key = `gs:${await sha256(state)}`;
  const saved = await env.OAUTH_KV.get(key, 'json');
  if (!saved) return { error: 'expired' };
  await env.OAUTH_KV.delete(key);
  const code = url.searchParams.get('code') || '';
  let claims;
  if (devGoogle(env, url) && code.startsWith('dev:')) {
    const email = code.slice(4).toLowerCase();
    claims = { sub: 'dev-' + (await sha256(email)).slice(0, 16), email, email_verified: true, name: email.split('@')[0] };
  } else {
    const res = await fetch(GOOGLE_TOKEN, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: `${url.origin}/auth/google/callback`, grant_type: 'authorization_code', code_verifier: saved.verifier })
    });
    if (!res.ok) { console.error('google token', res.status, await res.text().catch(() => '')); return { error: 'google' }; }
    const tok = await res.json();
    // The ID token came straight from Google over HTTPS, so its contents can be trusted; check it was meant for this site.
    try { claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(tok.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)))); } catch (e) { return { error: 'google' }; }
    if (!ISSUERS.has(claims.iss) || claims.aud !== env.GOOGLE_CLIENT_ID || !(claims.exp * 1000 > Date.now())) return { error: 'google' };
  }
  if (!claims.sub || !claims.email || claims.email_verified === false || claims.email_verified === 'false') return { error: 'unverified' };
  const user = await upsertUser(env, { sub: String(claims.sub), email: String(claims.email).toLowerCase(), name: claims.name ? String(claims.name).slice(0, 120) : '' });
  return { user, next: saved.next };
}

export async function signInResponse(request, env, user, next) {
  const url = new URL(request.url);
  const token = await createSession(env, user.id, 'web', (request.headers.get('User-Agent') || '').slice(0, 120));
  const headers = new Headers({ Location: safeNext(next), 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', cookie(url, SESSION_COOKIE, token, { maxAge: 60 * 86400 }));
  headers.append('Set-Cookie', cookie(url, STATE_COOKIE, '', { maxAge: 0, path: '/auth' }));
  return new Response(null, { status: 302, headers });
}

export async function signOutResponse(request, env, to = '/') {
  const url = new URL(request.url);
  await endSession(env, readCookie(request, SESSION_COOKIE));
  return new Response(null, { status: 302, headers: { Location: to, 'Set-Cookie': cookie(url, SESSION_COOKIE, '', { maxAge: 0 }), 'Cache-Control': 'no-store' } });
}

// Forms on the site carry a token tied to the session cookie, so another site can't submit them.
export async function formToken(request) { return (await sha256('form:' + readCookie(request, SESSION_COOKIE))).slice(0, 32); }
export async function formOk(request, form) {
  return !!readCookie(request, SESSION_COOKIE) && String(form.get('t') || '') === (await formToken(request));
}
