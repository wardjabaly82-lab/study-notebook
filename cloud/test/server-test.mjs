import crypto from 'crypto';
// Run against a local copy: put DEV_FAKE_GOOGLE=1 in cloud/.dev.vars, start `npx wrangler dev`, then `npm test`.
// Checks that students are kept apart (website, Claude, desktop app), sign-in codes, account deletion and big syncs.
const SDK = new URL('../../node_modules/@modelcontextprotocol/sdk/dist/esm/client/', import.meta.url).pathname;
const { Client } = await import(SDK + 'index.js');
const { StreamableHTTPClientTransport } = await import(SDK + 'streamableHttp.js');
const O = process.env.SN_TEST_URL || 'http://127.0.0.1:8787';
const ok = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } console.log('  ✓', m); };
const b64u = b => Buffer.from(b).toString('base64url');
const BASE = 'data/users/local';

// A tiny browser: keeps cookies, doesn't follow redirects.
function browser() {
  const jar = new Map();
  const go = async (path, opts = {}) => {
    const r = await fetch(path.startsWith('http') ? path : O + path, { redirect: 'manual', ...opts, headers: { ...(opts.headers || {}), Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } });
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (/Max-Age=0/.test(c)) jar.delete(k); else jar.set(k, v); }
    return r;
  };
  const follow = async (path, opts) => { let r = await go(path, opts); let n = 0; while (r.status === 302 && n++ < 10) { const loc = r.headers.get('location'); if (!loc.startsWith('/') && !loc.startsWith(O)) return { r, external: loc }; r = await go(loc); } return { r }; };
  return { go, follow, jar };
}
async function signIn(email) {
  const b = browser();
  let r = await b.go('/app/'); ok(r.status === 302 && /\/auth\/google/.test(r.headers.get('location')), `${email}: not signed in → sent to sign-in`);
  r = await b.go(r.headers.get('location'));
  const dev = r.headers.get('location'); const state = new URL(O + dev).searchParams.get('state');
  r = await b.go(`/auth/google/callback?state=${encodeURIComponent(state)}&email=${encodeURIComponent(email)}`);
  ok(r.status === 302 && r.headers.get('location') === '/app/', `${email}: signed in, back to the notebook`);
  return b;
}
const api = (b, path, body) => b.go('/api/' + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Study-Notebook': '1' }, body: JSON.stringify(body) } : {}).then(r => r.json());

console.log('Students');
const alice = await signIn('alice@example.com'), bob = await signIn('bob@example.com');
let r = await alice.go('/app/'); const page = await r.text(); ok(r.status === 200 && /Study Notebook/.test(page), 'the notebook page loads for a signed-in student');
const me = await api(alice, 'me'); ok(me.email === 'alice@example.com', 'api/me knows who is signed in');
const pushed = await api(alice, 'push', { changes: [{ path: `${BASE}/c1`, data: { name: 'Linear algebra', createdAt: 1 } }, { path: `${BASE}/c1/sections/s1`, data: { title: 'Rank', content: 'Alice’s private note', updatedAt: 5 } }] });
ok(pushed.ok && pushed.applied === 2, 'Alice saves notes from the website');
ok(Object.keys((await api(bob, 'docs')).docs).length === 0, 'Bob sees none of Alice’s notes');
// A whole semester at once (more items than the free plan's 50 queries per request).
const many = Array.from({ length: 150 }, (_, i) => ({ path: `${BASE}/c9/sections/s${i}`, data: { title: 'Topic ' + i, content: 'x'.repeat(200), updatedAt: 10 } }));
const big = await api(bob, 'push', { changes: [{ path: `${BASE}/c9`, data: { name: 'Big course' } }, ...many] });
ok(big.ok && big.applied === 151, 'a push of 151 items in one go');
const bigPull = await (await bob.go('/api/pull?since=0')).json();
ok(bigPull.changes.length === 151 && new Set(bigPull.changes.map(c => c.rev)).size === 151, 'each item got its own revision number');
const stale = await api(bob, 'push', { changes: [{ path: `${BASE}/c9/sections/s3`, data: { title: 'Older copy', updatedAt: 5 } }] });
ok(stale.applied === 0 && stale.kept.length === 1 && stale.kept[0].data.title === 'Topic 3', 'an older copy doesn’t overwrite a newer one');
const after = await (await bob.go('/api/pull?since=' + bigPull.rev)).json(); ok(after.changes.length === 0, 'nothing changed by the refused copy');
await api(bob, 'push', { changes: [{ path: `${BASE}/c9/sections/s4`, data: null }] });
ok(!(`${BASE}/c9/sections/s4` in (await api(bob, 'docs')).docs), 'deleting an item works');
r = await bob.go('/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"changes":[]}' }); ok(r.status === 403, 'a change without the site’s own header is refused');
r = await fetch(O + '/api/docs'); ok(r.status === 401, 'no cookie → no data');
r = await bob.go('/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Study-Notebook': '1' }, body: JSON.stringify({ changes: [{ path: '../../users/x', data: {} }] }) }); ok(r.status === 400, 'bad paths refused');

console.log('Claude connects for Alice');
r = await fetch(O + '/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
ok(r.status === 401 && /resource_metadata/.test(r.headers.get('www-authenticate') || ''), 'MCP without sign-in → 401 with sign-in info');
const asm = await (await fetch(O + '/.well-known/oauth-authorization-server')).json();
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const reg = await (await fetch(asm.registration_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: [REDIRECT], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }) })).json();
async function connectClaude(b, label) {
  const verifier = b64u(crypto.randomBytes(32)), challenge = b64u(crypto.createHash('sha256').update(verifier).digest());
  const q = new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz', resource: O + '/mcp' });
  let r = await b.go('/authorize?' + q); const html = await r.text();
  ok(r.status === 200 && /Connect Claude to your notebook/.test(html) && html.includes(label), `${label}: consent page shows the signed-in account`);
  const handle = html.match(/name="handle" value="([^"]+)"/)[1], t = html.match(/name="t" value="([^"]+)"/)[1];
  r = await b.go('/authorize?' + q, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ handle, t, decision: 'approve' }) });
  const loc = r.headers.get('location'); ok(r.status === 302 && loc.startsWith(REDIRECT), 'approved → back to Claude with a code');
  const code = new URL(loc).searchParams.get('code');
  const tok = await (await fetch(asm.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: reg.client_id, code_verifier: verifier }) })).json();
  ok(tok.access_token && tok.refresh_token, 'Claude got its tokens');
  const c = new Client({ name: 'claude-sim', version: '1' });
  await c.connect(new StreamableHTTPClientTransport(new URL(O + '/mcp'), { requestInit: { headers: { Authorization: 'Bearer ' + tok.access_token } } }));
  return c;
}
// Signed-out student asked to connect Claude is sent to Google first, then back to the consent page.
const carol = browser();
r = await carol.go('/authorize?response_type=code&client_id=x'); ok(r.status === 302 && /\/auth\/google\?next=%2Fauthorize/.test(r.headers.get('location')), 'signed out → sign in with Google first, then back to Claude’s request');
const ca = await connectClaude(alice, 'alice@example.com');
const J = x => JSON.parse(x.content[0].text.split('\n\n')[0]);
const call = async (c, name, args) => { const x = await c.callTool({ name, arguments: args }); if (x.isError) throw new Error(x.content[0].text); return J(x); };
ok((await call(ca, 'list_courses', {})).courses?.some?.(x => x.name === 'Linear algebra') || JSON.stringify(await call(ca, 'list_courses', {})).includes('Linear algebra'), 'Claude sees Alice’s course');
const saved = await call(ca, 'save_sections', { course: 'Linear algebra', sections: [{ title: 'Span', content: 'Saved by Claude for Alice' }, { title: 'Basis', under: 1, content: 'x' }] });
ok(saved.saved.length === 2, 'Claude saves 2 topics in one call');

// Recorded lectures are big. They must not slow down Claude's other requests, and the lecture tools must still see them.
const transcript = ('[12:30] the rank of a matrix is the dimension of its column space. ').repeat(18000);   // ~1.2 MB each
for (let i = 1; i <= 6; i++) {
  const lp = await api(alice, 'push', { changes: [{ path: `${BASE}/c1/lectures/L${i}`, data: { title: `Lecture ${i}`, startedAt: i, durationSec: 5400, lang: 'en', status: 'done', text: transcript } }] });
  if (!lp.ok) ok(false, `lecture ${i} pushed`);
}
ok(true, 'six long lecture transcripts (~7 MB) are in Alice’s notebook');
const time = async f => { const t0 = Date.now(); await f(); return Date.now() - t0; };
const tOutline = await time(() => call(ca, 'get_outline', { course: 'Linear algebra' }));
const tSave = await time(() => call(ca, 'save_section', { course: 'Linear algebra', title: 'Dimension', content: 'x' }));
const lects = await call(ca, 'list_lectures', { course: 'Linear algebra' });
ok(lects.lectures.length === 6 && lects.lectures[0].lecture_id === 'L6', 'Claude still sees the lectures (list_lectures)');
const tLecture = await time(() => call(ca, 'read_lecture', { course: 'Linear algebra', lecture_id: 'L2', part: 1 }));
const fromLec = await call(ca, 'save_section', { course: 'Linear algebra', title: 'Rank (lecture 2)', content: 'From the lecture.', lecture_id: 'L2' });
ok(fromLec.action === 'added', 'Claude saves notes linked to a lecture');
const lectsAfter = await call(ca, 'list_lectures', { course: 'Linear algebra' });
ok(lectsAfter.lectures.find(l => l.lecture_id === 'L2').notes_made === true, 'that lecture is marked as having notes; the others are untouched');
ok(lectsAfter.lectures.filter(l => l.notes_made).length === 1, 'no other lecture was changed');
console.log(`    timing: get_outline ${tOutline} ms, save_section ${tSave} ms (lectures skipped) vs read_lecture ${tLecture} ms (lectures loaded)`);
const cb = await connectClaude(bob, 'bob@example.com');
ok(!JSON.stringify(await call(cb, 'list_courses', {})).includes('Linear algebra'), 'Bob’s Claude can’t see Alice’s course');
const s = await cb.callTool({ name: 'search_notes', arguments: { query: 'Alice' } }); console.log('    search reply:', s.content[0].text.slice(0, 120).replace(/\n/g, ' ')); ok(!/private note|Saved by Claude/.test(s.content[0].text), 'Bob’s Claude finds nothing of Alice’s by searching');

console.log('Desktop app links for Alice');
const verifier = b64u(crypto.randomBytes(32)), challenge = b64u(crypto.createHash('sha256').update(verifier).digest()), st = b64u(crypto.randomBytes(18));
r = await alice.go(`/link?port=45678&state=${st}&challenge=${challenge}&device=Jeff%E2%80%99s%20laptop`); let html = await r.text();
ok(/Link the app on your computer/.test(html) && /laptop/.test(html), 'link page asks Alice to confirm');
const t = html.match(/name="t" value="([^"]+)"/)[1];
r = await alice.go('/link', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ port: '45678', state: st, challenge, device: 'Jeff’s laptop', t, decision: 'approve' }) });
const back = new URL(r.headers.get('location')); ok(back.origin === 'http://127.0.0.1:45678' && back.searchParams.get('state') === st, 'sends a one-time code back to the app on this computer only');
r = await fetch(O + '/auth/app/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: back.searchParams.get('code'), verifier: 'wrong' + verifier.slice(5) }) }); ok(r.status === 400, 'code with the wrong secret refused');
const r2 = await alice.go('/link', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ port: '45678', state: st, challenge, device: 'Jeff’s laptop', t, decision: 'approve' }) });
const code2 = new URL(r2.headers.get('location')).searchParams.get('code');
const app = await (await fetch(O + '/auth/app/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code2, verifier }) })).json();
ok(app.token && app.email === 'alice@example.com', 'the app gets its own sign-in for Alice');
r = await fetch(O + '/auth/app/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code2, verifier }) }); ok(r.status === 400, 'a code works only once');
const H = { Authorization: 'Bearer ' + app.token };
const ping = await (await fetch(O + '/sync/ping', { headers: H })).json(); ok(ping.email === 'alice@example.com' && ping.docs === 12, `app sync sees Alice’s ${ping.docs} items (course, 5 topics, 6 lectures)`);
const pull = await (await fetch(O + '/sync/pull?since=0', { headers: H })).json(); ok(pull.changes.some(c => c.data && c.data.content === 'Saved by Claude for Alice'), 'app pulls what Claude saved');
ok((await fetch(O + '/sync/ping', { headers: { Authorization: 'Bearer nonsense-token-nonsense-token' } })).status === 401, 'made-up app token refused');

console.log('Account page');
r = await alice.go('/account'); html = await r.text();
ok(/Your account/.test(html) && /Claude/.test(html) && /Jeff’s laptop/.test(html), 'lists Claude and the linked computer');
r = await alice.go('/api/export'); const exp = await r.json(); ok(exp.version === 1 && Object.keys(exp.docs).length === 12 && /attachment/.test(r.headers.get('content-disposition')), 'download my notes works');
const tb = (await (await bob.go('/account')).text()).match(/name="t" value="([^"]+)"/)[1];
r = await bob.go('/account/delete', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ t: 'forged', sure: '1' }) }); ok(r.status === 302 && (await api(bob, 'me')).email, 'delete with a forged form token does nothing');
r = await bob.go('/account/delete', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ t: tb, sure: '1' }) });
ok(/account is deleted/.test(await r.text()), 'Bob deletes his account');
ok((await bob.go('/api/me')).status === 401, 'Bob’s browser is signed out');
const dead = await cb.callTool({ name: 'list_courses', arguments: {} }).then(() => 'worked', e => 'refused'); ok(dead === 'refused', 'Bob’s Claude connection stops working');
ok(Object.keys((await api(alice, 'docs')).docs).length === 12, 'Alice’s notes untouched');
await ca.close();
console.log('\nSHARED SERVER TEST PASSED');
