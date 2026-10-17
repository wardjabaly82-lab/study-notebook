/* Study Notebook online.
   Your own small server on Cloudflare (free plan) that holds an online copy of your notebook, so that:
   - Claude can use it in any chat (web, phone, desktop) as a custom connector at  https://<your-worker>/mcp
     Claude signs in once with the password you chose when deploying.
   - The Study Notebook app on your laptop syncs with it (address + the same password).
   Notes are stored in your own Cloudflare account; nobody else has the password. */
import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import Ops from './notebook-ops.js';
import { INSTRUCTIONS } from './instructions.js';

const VERSION = '1.0.0';
const DOC_PATH = /^data\/users\/local\/[A-Za-z0-9_-]{1,64}(\/(sections|sources|lectures|cards)\/[A-Za-z0-9_-]{1,64})?$/;
const MAX_DOC = 2_000_000;

/* ---------------- storage (D1) ---------------- */

let schemaReady = false;
async function ensureSchema(env) {
  if (schemaReady) return;
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS docs (path TEXT PRIMARY KEY, data TEXT, rev INTEGER NOT NULL, mtime INTEGER NOT NULL)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS docs_rev ON docs(rev)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)')
  ]);
  schemaReady = true;
}
async function loadDocs(env) {
  await ensureSchema(env);
  const { results } = await env.DB.prepare('SELECT path, data FROM docs WHERE data IS NOT NULL').all();
  const docs = {};
  for (const r of results) { try { docs[r.path] = JSON.parse(r.data); } catch (e) {} }
  return docs;
}
async function currentRev(env) {
  await ensureSchema(env);
  const row = await env.DB.prepare('SELECT COALESCE(MAX(rev), 0) AS rev FROM docs').first();
  return row ? row.rev : 0;
}
// writes: [{ path, data }] (data null = deleted). Each change gets the next revision number.
async function writeDocs(env, writes) {
  if (!writes.length) return currentRev(env);
  await ensureSchema(env);
  const now = Date.now();
  const stmt = env.DB.prepare(`INSERT INTO docs (path, data, rev, mtime) VALUES (?1, ?2, (SELECT COALESCE(MAX(rev), 0) + 1 FROM docs), ?3)
    ON CONFLICT(path) DO UPDATE SET data = excluded.data, rev = (SELECT COALESCE(MAX(rev), 0) + 1 FROM docs), mtime = excluded.mtime`);
  await env.DB.batch(writes.map(w => stmt.bind(w.path, w.data === null || w.data === undefined ? null : JSON.stringify(w.data), now)));
  return currentRev(env);
}

/* ---------------- the password ---------------- */

// The password is either a Cloudflare secret (NOTEBOOK_PASSWORD) or, more simply, chosen from the
// Study Notebook app the first time it connects: then only a salted hash of it is stored here.
const envPassword = env => { const p = String(env.NOTEBOOK_PASSWORD || ''); return p.length >= 6 ? p : ''; };
async function storedPassword(env) {
  await ensureSchema(env);
  const row = await env.DB.prepare("SELECT v FROM meta WHERE k = 'password'").first();
  try { return row ? JSON.parse(row.v) : null; } catch (e) { return null; }
}
async function pbkdf2(password, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256);
  return new Uint8Array(bits);
}
const toHex = a => [...a].map(b => b.toString(16).padStart(2, '0')).join('');
const fromHex = h => new Uint8Array((h.match(/../g) || []).map(x => parseInt(x, 16)));
async function hasPassword(env) { return !!envPassword(env) || !!(await storedPassword(env)); }
async function samePassword(env, given) {
  if (typeof given !== 'string' || !given) return false;
  if (!envPassword(env)) {
    const st = await storedPassword(env); if (!st) return false;
    const got = await pbkdf2(given, fromHex(st.salt)), want = fromHex(st.hash);
    let d = got.length ^ want.length; for (let i = 0; i < Math.min(got.length, want.length); i++) d |= got[i] ^ want[i];
    return d === 0;
  }
  const want = envPassword(env);
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(given)), crypto.subtle.digest('SHA-256', enc.encode(want))]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0; for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
const slow = () => new Promise(r => setTimeout(r, 600));   // makes guessing the password slow

/* ---------------- MCP (what Claude talks to) ---------------- */

const course = { type: 'string', maxLength: 200, description: 'The course: its name, its course number (e.g. 52324), or its course_id. Can be left out if there is only one course.' };
const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const TOOLS = [
  { name: 'list_courses', title: 'List courses', description: 'List the student’s courses with their notes language and number of sections.', inputSchema: obj({}), annotations: RO },
  { name: 'get_outline', title: 'Get a course outline', description: 'Show a course’s notebook as a tree of sections (ids, titles, short previews). Call this before saving, to find where new notes belong and whether a section on the subject already exists.', inputSchema: obj({ course }), annotations: RO },
  { name: 'read_section', title: 'Read a section', description: 'Read the full content of one notebook section, e.g. before updating it.', inputSchema: obj({ course, section_id: { type: 'string', maxLength: 64, description: 'The section id from get_outline or search_notes.' } }, ['section_id']), annotations: RO },
  { name: 'search_notes', title: 'Search notes', description: 'Find notebook sections whose title or content contains some text, in one course or all courses.', inputSchema: obj({ query: { type: 'string', minLength: 2, maxLength: 200, description: 'Words to look for.' }, course }, ['query']), annotations: RO },
  { name: 'save_section', title: 'Save to notebook', description: 'Save a final, clear explanation to the notebook. Without section_id it adds a new section (a topic, or a sub-topic when parent_id is given); with section_id it replaces that section’s content (the previous version is kept for undo in the app). Content is Markdown with \\( \\) and $$ $$ math, no # headings.',
    inputSchema: obj({ course, title: { type: 'string', minLength: 1, maxLength: 200, description: 'Section title, short and specific, in the course’s notes language.' }, content: { type: 'string', minLength: 1, maxLength: 200000, description: 'The complete explanation in Markdown.' }, section_id: { type: 'string', maxLength: 64, description: 'Set this to update an existing section instead of adding one.' }, parent_id: { type: 'string', maxLength: 64, description: 'For a new sub-topic: the id of the topic it belongs under.' }, lecture_id: { type: 'string', maxLength: 64, description: 'When these notes come from a recorded lecture: its lecture_id.' } }, ['title', 'content']), annotations: WRITE },
  { name: 'edit_part', title: 'Replace one part of a section', description: 'Replace one passage inside a saved section, leaving the rest of the section exactly as it is. Use it when the student asks to go deeper into, or didn’t understand, one part of an explanation. Copy the passage from read_section exactly (it must appear once). The previous version is kept for undo in the app.',
    inputSchema: obj({ course, section_id: { type: 'string', maxLength: 64, description: 'The section that contains the passage.' }, find: { type: 'string', minLength: 1, maxLength: 20000, description: 'The exact passage to replace, copied from read_section.' }, replace: { type: 'string', minLength: 1, maxLength: 60000, description: 'The new, deeper or clearer version of that passage, in Markdown with \\( \\) and $$ $$ math.' } }, ['section_id', 'find', 'replace']), annotations: WRITE },
  { name: 'list_lectures', title: 'List recorded lectures', description: 'List the lectures recorded in a course (newest first): title, date, length, spoken language, whether notes were already made, and how many parts the transcript has.', inputSchema: obj({ course }), annotations: RO },
  { name: 'read_lecture', title: 'Read a lecture transcript', description: 'Read one part of a recorded lecture’s automatic transcript. Long lectures have several parts; read them all before writing notes.', inputSchema: obj({ course, lecture_id: { type: 'string', maxLength: 64, description: 'The lecture id from list_lectures.' }, part: { type: 'integer', minimum: 1, maximum: 1000, description: 'Which part to read, starting at 1.' } }, ['lecture_id']), annotations: RO },
  { name: 'save_practice', title: 'Save practice questions', description: 'Save flashcards, multiple-choice questions and open questions for exam practice in the app, optionally linked to a topic section. Duplicates of existing questions are skipped.',
    inputSchema: obj({ course, topic_section_id: { type: 'string', maxLength: 64, description: 'The topic or sub-topic section these questions practice.' },
      items: { type: 'array', minItems: 1, maxItems: 60, items: obj({ kind: { type: 'string', enum: ['flashcard', 'multiple_choice', 'open_question'] }, question: { type: 'string', minLength: 1, maxLength: 4000, description: 'Front of the card or the question (Markdown and math allowed).' }, answer: { type: 'string', minLength: 1, maxLength: 8000, description: 'Back of the card, the correct answer, or a full worked solution.' }, choices: { type: 'array', minItems: 2, maxItems: 6, items: { type: 'string', maxLength: 1000 }, description: 'multiple_choice only: the options.' }, correct_choice: { type: 'integer', minimum: 1, maximum: 6, description: 'multiple_choice only: number of the right option, starting at 1.' }, explanation: { type: 'string', maxLength: 6000, description: 'Why the answer is right and the common mistake behind wrong choices.' } }, ['kind', 'question', 'answer']) } }, ['items']), annotations: WRITE },
  { name: 'get_practice_overview', title: 'Practice results', description: 'How the student is doing in practice: number of items, how many are due, accuracy per topic, the questions they get wrong most, and topics with no practice yet.', inputSchema: obj({ course }), annotations: RO },
  { name: 'create_course', title: 'Create a course', description: 'Create a new course notebook.', inputSchema: obj({ name: { type: 'string', minLength: 1, maxLength: 80, description: 'Course name, e.g. "52324 - Probability for Statistics students".' }, notes_language: { type: 'string', enum: ['Hebrew', 'English', 'Same as the material'], description: 'Language to write this course’s notes in.' } }, ['name']), annotations: WRITE }
];
const READ_ONLY = new Set(TOOLS.filter(t => t.annotations.readOnlyHint).map(t => t.name));
const ONLINE_NOTE = 'Your Study Notebook is online here; the app on the laptop gets this change the next time it syncs (within a minute while it is open).';

async function callTool(env, name, args) {
  if (!TOOLS.some(t => t.name === name)) return { content: [{ type: 'text', text: `Unknown tool "${name}".` }], isError: true };
  try {
    const docs = await loadDocs(env);
    const { result, writes } = Ops.run(docs, name, args || {});
    if (writes && writes.length) await writeDocs(env, writes);
    const text = JSON.stringify(result, null, 2) + (READ_ONLY.has(name) ? '' : '\n\n' + ONLINE_NOTE);
    return { content: [{ type: 'text', text }] };
  } catch (e) {
    const msg = e && e.name === 'OpError' ? e.message : 'Something went wrong while using the notebook.';
    if (!(e && e.name === 'OpError')) console.error('tool failed', name, e && e.stack);
    return { content: [{ type: 'text', text: msg }], isError: true };
  }
}

const PROTOCOLS = ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
async function rpc(env, msg) {
  const reply = result => ({ jsonrpc: '2.0', id: msg.id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id: msg.id ?? null, error: { code, message } });
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(-32600, 'Invalid request');
  if (msg.id === undefined) return null;   // a notification: nothing to answer
  switch (msg.method) {
    case 'initialize': {
      const asked = msg.params && msg.params.protocolVersion;
      return reply({ protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[2], capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'study-notebook', title: 'Study Notebook', version: VERSION }, instructions: INSTRUCTIONS });
    }
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools: TOOLS });
    case 'tools/call': return reply(await callTool(env, msg.params && msg.params.name, msg.params && msg.params.arguments));
    case 'resources/list': return reply({ resources: [] });
    case 'prompts/list': return reply({ prompts: [] });
    default: return fail(-32601, `Method not found: ${msg.method}`);
  }
}

const McpHandler = {
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('Use POST for MCP requests.', { status: 405, headers: { Allow: 'POST' } });
    let body; try { body = await request.json(); } catch (e) { return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400 }); }
    const batch = Array.isArray(body);
    const out = (await Promise.all((batch ? body : [body]).map(m => rpc(env, m)))).filter(Boolean);
    if (!out.length) return new Response(null, { status: 202 });
    return Response.json(batch ? out : out[0], { headers: { 'Cache-Control': 'no-store' } });
  }
};

/* ---------------- sync (what the laptop app talks to) ---------------- */

async function sync(request, env, url) {
  const auth = request.headers.get('Authorization') || '';
  // First connection from the app: choose the password (only while none is set).
  if (url.pathname === '/sync/setup' && request.method === 'POST') {
    if (await hasPassword(env)) return Response.json({ error: 'already_set' }, { status: 409 });
    const pw = auth.replace(/^Bearer\s+/i, '');
    if (pw.length < 8) return Response.json({ error: 'too_short' }, { status: 400 });
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await pbkdf2(pw, salt);
    // INSERT only if still missing, so two first connections can't both set it.
    const r = await env.DB.prepare("INSERT INTO meta (k, v) VALUES ('password', ?1) ON CONFLICT(k) DO NOTHING").bind(JSON.stringify({ salt: toHex(salt), hash: toHex(hash), at: Date.now() })).run();
    if (!r.meta || !r.meta.changes) return Response.json({ error: 'already_set' }, { status: 409 });
    return Response.json({ ok: true });
  }
  if (!(await hasPassword(env))) return Response.json({ error: 'no_password' }, { status: 503 });
  if (!(await samePassword(env, auth.replace(/^Bearer\s+/i, '')))) { await slow(); return Response.json({ error: 'wrong_password' }, { status: 401 }); }
  const route = url.pathname.replace(/^\/sync\/?/, '');
  if (route === 'ping' && request.method === 'GET') {
    const rev = await currentRev(env);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM docs WHERE data IS NOT NULL').first();
    return Response.json({ ok: true, version: VERSION, rev, docs: n ? n.n : 0 });
  }
  if (route === 'pull' && request.method === 'GET') {
    await ensureSchema(env);
    const since = Math.max(0, Number(url.searchParams.get('since')) || 0);
    const { results } = await env.DB.prepare('SELECT path, data, rev FROM docs WHERE rev > ?1 ORDER BY rev LIMIT 5000').bind(since).all();
    const changes = results.map(r => ({ path: r.path, data: r.data === null ? null : JSON.parse(r.data), rev: r.rev }));
    const rev = changes.length ? changes[changes.length - 1].rev : await currentRev(env);
    return Response.json({ rev, more: results.length === 5000, changes });
  }
  if (route === 'push' && request.method === 'POST') {
    let body; try { body = await request.json(); } catch (e) { return Response.json({ error: 'bad_json' }, { status: 400 }); }
    const incoming = Array.isArray(body && body.changes) ? body.changes : null;
    if (!incoming || incoming.length > 5000) return Response.json({ error: 'bad_changes' }, { status: 400 });
    await ensureSchema(env);
    const writes = [], kept = [];
    for (const ch of incoming) {
      if (!ch || typeof ch.path !== 'string' || !DOC_PATH.test(ch.path)) return Response.json({ error: 'bad_path', path: ch && ch.path }, { status: 400 });
      if (ch.data !== null && (typeof ch.data !== 'object' || JSON.stringify(ch.data).length > MAX_DOC)) return Response.json({ error: 'bad_data', path: ch.path }, { status: 400 });
      // If the online copy was changed more recently (e.g. by Claude), keep it.
      if (ch.data && ch.data.updatedAt) {
        const row = await env.DB.prepare('SELECT data FROM docs WHERE path = ?1').bind(ch.path).first();
        let cur = null; try { cur = row && row.data ? JSON.parse(row.data) : null; } catch (e) {}
        if (cur && cur.updatedAt && cur.updatedAt > ch.data.updatedAt) { kept.push({ path: ch.path, data: cur }); continue; }
      }
      writes.push({ path: ch.path, data: ch.data });
    }
    const rev = await writeDocs(env, writes);
    return Response.json({ ok: true, rev, applied: writes.length, kept });
  }
  return Response.json({ error: 'not_found' }, { status: 404 });
}

/* ---------------- pages: sign-in for Claude, and a home page ---------------- */

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>:root{color-scheme:light dark;--bg:#f5f5f7;--card:#fff;--ink:#1d1d1f;--muted:#6e6e73;--accent:#0071e3;--line:rgba(60,60,67,.24);--bad:#d70015}
@media(prefers-color-scheme:dark){:root{--bg:#19191b;--card:#2c2c2e;--ink:#f5f5f7;--muted:#a1a1a6;--accent:#0a84ff;--line:rgba(255,255,255,.18);--bad:#ff453a}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;padding:16px;box-sizing:border-box}
.card{background:var(--card);border-radius:16px;padding:28px;max-width:440px;width:100%;box-shadow:0 0 0 .5px var(--line),0 12px 40px rgba(0,0,0,.08)}
h1{font-size:21px;margin:0 0 6px;letter-spacing:-.02em}p{margin:.4em 0;color:var(--muted)}b{color:var(--ink)}
input{width:100%;box-sizing:border-box;font:inherit;padding:10px 12px;border-radius:10px;border:0;box-shadow:inset 0 0 0 .5px var(--line);background:var(--bg);color:var(--ink);margin:12px 0}
input:focus{outline:3px solid color-mix(in srgb,var(--accent) 40%,transparent)}
.row{display:flex;gap:8px;margin-top:6px}button{font:inherit;font-weight:600;border:0;border-radius:10px;padding:10px 16px;cursor:pointer}
.go{background:var(--accent);color:#fff}.no{background:transparent;color:var(--accent)}.bad{color:var(--bad)}code{font-size:13px;word-break:break-all;color:var(--ink)}</style></head>
<body><main class="card">${body}</main></body></html>`;

async function authorizePage(request, env, error) {
  const oauth = env.OAUTH_PROVIDER;
  const req = await oauth.parseAuthRequest(request);
  const details = await oauth.describeConsent(req);
  const consent = await oauth.beginConsent(req);
  consent.headers.set('Content-Type', 'text/html; charset=utf-8');
  const body = `<h1>Connect your Study Notebook</h1>
    <p><b>${esc(details.clientName || 'An app')}</b> wants to read and add to your notes. Access goes to <b>${esc(details.redirectHost)}</b>.</p>
    ${details.redirectIsLoopback ? '<p><b>This sends access to an app on your computer.</b> Continue only if you just started connecting from it.</p>' : ''}
    <form method="post">
      <input type="hidden" name="handle" value="${esc(consent.handle)}">
      <input type="password" name="password" placeholder="Your notebook password" autocomplete="current-password" required autofocus>
      ${error ? `<p class="bad">${esc(error)}</p>` : ''}
      <div class="row"><button class="go" name="decision" value="approve">Connect</button><button class="no" name="decision" value="deny" formnovalidate>Cancel</button></div>
    </form>`;
  return new Response(page('Connect your Study Notebook', body), { headers: consent.headers });
}

const PagesHandler = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/sync')) return sync(request, env, url);
    if (url.pathname === '/authorize') {
      if (request.method === 'GET') return authorizePage(request, env);
      if (request.method === 'POST') {
        const oauth = env.OAUTH_PROVIDER;
        const form = await request.formData();
        const handle = String(form.get('handle') || '');
        if (form.get('decision') !== 'approve') { const denied = await oauth.denyConsent(request, handle); return new Response(null, { status: 302, headers: denied.headers }); }
        if (!(await samePassword(env, String(form.get('password') || '')))) { await slow(); return authorizePage(request, env, 'That password isn’t right. Use the one you chose when you set up your online notebook.'); }
        const approved = await oauth.approveConsent(request, handle, { scope: approvedScope(form) });
        const { redirectTo } = await oauth.completeAuthorization({ request: approved.request, userId: 'me', metadata: { label: 'Study Notebook' }, scope: approved.request.scope, props: { user: 'me' } });
        approved.headers.set('Location', redirectTo);
        return new Response(null, { status: 302, headers: approved.headers });
      }
    }
    if (url.pathname === '/' || url.pathname === '') {
      const mcp = `${url.origin}/mcp`;
      return new Response(page('Study Notebook online', `<h1>Your Study Notebook is online</h1>
        <p>To use it in any Claude chat, open Claude → <b>Customize → Connectors → Add custom connector</b>, paste this address and press <b>Add</b>, then <b>Connect</b> and enter your notebook password:</p>
        <p><code>${esc(mcp)}</code></p>
        <p>In the Study Notebook app on your laptop: <b>Settings → Use in any chat</b>, with the address <code>${esc(url.origin)}</code> and the same password.</p>`), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    return new Response('Not found', { status: 404 });
  }
};
const approvedScope = form => form.getAll('scope').map(String);

/* ---------------- wiring ---------------- */

// The worker's own address is only known per request (each student deploys their own copy).
const providers = new Map();
function providerFor(origin) {
  if (!providers.has(origin)) providers.set(origin, new OAuthProvider({
    apiRoute: '/mcp',
    apiHandler: McpHandler,
    defaultHandler: PagesHandler,
    authorizeEndpoint: '/authorize',
    tokenEndpoint: '/token',
    clientRegistrationEndpoint: '/register',
    clientIdMetadataDocumentEnabled: true,
    accessTokenTTL: 3600,
    resourceMetadata: { resource: `${origin}/mcp`, authorization_servers: [origin], resource_name: 'Study Notebook' }
  }));
  return providers.get(origin);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/sync/')) return sync(request, env, url);
    if (!(await hasPassword(env))) {
      return new Response(page('Almost there', '<h1>Almost there</h1><p>Your online notebook is running. To finish, open the Study Notebook app on your laptop: <b>Settings → Use in any chat</b>, enter this page’s address and choose a password, then press <b>Connect</b>.</p>'), { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    return providerFor(new URL(request.url).origin).fetch(request, env, ctx);
  }
};
