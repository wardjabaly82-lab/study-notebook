/* The site's own small pages: connecting Claude, linking the desktop app, the account page,
   privacy, and errors. Same visual world as the app: system type, calm neutral surfaces, one blue. */

export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

const MARK = `<svg class="mark" width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><rect x="4" y="2.5" width="18" height="21" rx="3" fill="var(--cover)"/><rect x="7" y="2.5" width="2" height="21" fill="var(--cover-edge)"/><path d="M12 9h7M12 13h7M12 17h4.5" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>`;
export const GOOGLE_G = `<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`;

export const CSS = `
:root{--desk:#f5f5f7;--page:#fff;--fill:rgba(120,120,128,.12);--fill-hover:rgba(120,120,128,.18);--fill-press:rgba(120,120,128,.24);
--ink:#1d1d1f;--muted:#6e6e73;--line:rgba(60,60,67,.14);--accent:#0071e3;--accent-hover:#0077ed;--accent-press:#006edb;--accent-soft:rgba(0,113,227,.12);
--danger:#d70015;--danger-soft:rgba(255,59,48,.10);--ok:#1f7a37;--cover:#0071e3;--cover-edge:#005bb8;
--f:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI Variable Text","Segoe UI",system-ui,"Helvetica Neue",Arial,sans-serif;
--ease:cubic-bezier(.2,.9,.25,1);color-scheme:light}
@media (prefers-color-scheme:dark){:root{--desk:#19191b;--page:#232325;--fill:rgba(120,120,128,.24);--fill-hover:rgba(120,120,128,.32);--fill-press:rgba(120,120,128,.4);
--ink:#f5f5f7;--muted:#a1a1a6;--line:rgba(255,255,255,.10);--accent:#0a84ff;--accent-hover:#2290ff;--accent-press:#0077ed;--accent-soft:rgba(10,132,255,.22);
--danger:#ff453a;--danger-soft:rgba(255,69,58,.18);--ok:#30d158;--cover:#0a84ff;--cover-edge:#0066cc;color-scheme:dark}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;min-height:100vh;min-height:100dvh;background:var(--desk);color:var(--ink);font:16px/1.5 var(--f);-webkit-font-smoothing:antialiased;caret-color:var(--accent)}
::selection{background:var(--accent-soft)}
a{color:var(--accent);text-underline-offset:.18em;text-decoration-thickness:1px}
a:hover{text-decoration-thickness:2px}
:focus-visible{outline:3px solid color-mix(in srgb,var(--accent) 45%,transparent);outline-offset:2px;border-radius:8px}
.bar{display:flex;align-items:center;gap:10px;padding:16px clamp(16px,4vw,32px);font-weight:600;font-size:17px;letter-spacing:-.01em}
.bar a.home{display:flex;align-items:center;gap:10px;color:inherit;text-decoration:none}
.bar .end{margin-inline-start:auto;font-weight:400;font-size:15px}
main{width:100%;max-width:480px;margin:0 auto;padding:clamp(24px,8vh,72px) 16px 64px}
main.wide{max-width:680px}
.sheet{background:var(--page);border-radius:18px;padding:clamp(22px,5vw,32px)}
h1{font-size:28px;line-height:1.15;letter-spacing:-.025em;margin:0 0 10px;text-wrap:balance}
h2{font-size:19px;line-height:1.25;letter-spacing:-.015em;margin:36px 0 8px;text-wrap:balance}
h2:first-child{margin-top:0}
p{margin:0 0 12px;text-wrap:pretty}
.muted{color:var(--muted)}
.small{font-size:14px}
.who{display:flex;align-items:center;gap:12px;background:var(--fill);border-radius:14px;padding:12px 14px;margin:20px 0}
.who .av{flex:none;width:36px;height:36px;border-radius:50%;background:var(--accent);color:#fff;display:grid;place-items:center;font-weight:600}
.who .nm{font-weight:600;line-height:1.25}
.who .em{color:var(--muted);font-size:14px;overflow-wrap:anywhere}
.who a{margin-inline-start:auto;font-size:14px;white-space:nowrap}
.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:24px}
.btn{appearance:none;border:0;font:inherit;font-weight:600;font-size:16px;min-height:44px;padding:10px 20px;border-radius:12px;cursor:pointer;
display:inline-flex;align-items:center;justify-content:center;gap:10px;text-decoration:none;background:var(--fill);color:var(--ink);
transition:background-color 160ms var(--ease),transform 160ms var(--ease)}
.btn:hover{background:var(--fill-hover);text-decoration:none}
.btn:active{background:var(--fill-press);transform:scale(.98)}
.btn.primary{background:var(--accent);color:#fff}
.btn.primary:hover{background:var(--accent-hover)}.btn.primary:active{background:var(--accent-press)}
.btn.danger{background:var(--danger-soft);color:var(--danger)}
.btn.block{width:100%}
.btn[disabled]{opacity:.45;cursor:default;transform:none}
.google{background:var(--page);color:var(--ink);box-shadow:inset 0 0 0 1px var(--line)}
.google:hover{background:var(--fill)}
input[type=password],input[type=email],input[type=text]{width:100%;font:inherit;font-size:16px;min-height:44px;padding:10px 14px;border-radius:12px;border:0;
background:var(--fill);color:var(--ink);margin:6px 0 4px}
input::placeholder{color:var(--muted)}
input:focus{outline:3px solid color-mix(in srgb,var(--accent) 45%,transparent);outline-offset:0}
label{font-weight:600;font-size:15px}
.err{color:var(--danger);font-weight:500}
.okmsg{color:var(--ok);font-weight:500}
ul.rows{list-style:none;margin:8px 0 0;padding:0;background:var(--fill);border-radius:14px}
ul.rows li{display:flex;align-items:center;gap:12px;padding:12px 14px;min-height:56px}
ul.rows li+li{box-shadow:0 -1px 0 var(--line)}
ul.rows .t{font-weight:600;line-height:1.3}
ul.rows .d{color:var(--muted);font-size:14px}
ul.rows form{margin-inline-start:auto}
ul.rows .btn{min-height:36px;padding:6px 14px;font-size:14px;border-radius:10px;background:var(--page)}
.empty{color:var(--muted);font-size:15px;margin:8px 0 0}
.steps{margin:10px 0 0;padding-inline-start:22px;font-size:15px;line-height:1.5}.steps li{margin:6px 0}
.prose h2{margin-top:32px}.prose ul{padding-inline-start:1.2em;margin:0 0 12px}.prose li{margin:4px 0}
details{margin-top:12px}
summary{cursor:pointer;font-weight:600;color:var(--danger);min-height:44px;display:flex;align-items:center}
.confirm{display:flex;gap:10px;align-items:flex-start;margin:12px 0;font-weight:400}
.confirm input{width:20px;height:20px;margin:2px 0 0;accent-color:var(--danger);flex:none}
footer{max-width:680px;margin:0 auto;padding:0 16px 40px;color:var(--muted);font-size:14px;display:flex;gap:18px;flex-wrap:wrap;justify-content:center}
footer a{color:inherit}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`;

export function layout(title, body, { wide = false, user = null, bare = false } = {}) {
  const end = user ? `<a class="end" href="/account">${esc(user.name || user.email)}</a>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="light dark"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><meta name="referrer" content="no-referrer"><title>${esc(title)}</title><style>${CSS}</style></head>
<body>${bare ? '' : `<header class="bar"><a class="home" href="/">${MARK}<span>Study Notebook</span></a>${end}</header>`}
<main class="${wide ? 'wide' : ''}">${body}</main>
<footer><a href="/privacy">Privacy</a>${user ? '<a href="/account">Your account</a><a href="/app/">Open notebook</a>' : ''}</footer></body></html>`;
}
export const html = (s, status = 200, headers = {}) => new Response(s, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'", ...headers } });

const initial = u => esc(((u.name || u.email || '?').trim()[0] || '?').toUpperCase());
export function whoRow(u, switchTo) {
  return `<div class="who"><div class="av" aria-hidden="true">${initial(u)}</div><div><div class="nm">${esc(u.name || u.email)}</div>${u.name ? `<div class="em">${esc(u.email)}</div>` : ''}</div>
  <a href="/auth/signout?next=${encodeURIComponent(switchTo)}">Not you?</a></div>`;
}

export function googleButton(next, label = 'Continue with Google') {
  return `<a class="btn google block" href="/auth/google?next=${encodeURIComponent(next)}">${GOOGLE_G}<span>${esc(label)}</span></a>`;
}

export function signInPage(next, { title = 'Sign in to Study Notebook', text = 'Sign in with your Google account to open your notebook.', error = '' } = {}) {
  return layout(title, `<div class="sheet"><h1>${esc(title)}</h1><p class="muted">${esc(text)}</p>
  ${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}
  <div class="actions">${googleButton(next)}</div>
  <p class="muted small" style="margin-top:16px">Only your name and email address come from Google. <a href="/privacy">Privacy</a></p></div>`);
}

export function claudeConsentPage({ user, handle, token, clientName, redirectHost, app, isClaude, loopback, here }) {
  const who = app === 'gemini' ? 'Gemini' : app === 'claude' || !clientName || /claude/i.test(clientName) ? 'Claude' : esc(clientName);
  const known = isClaude || (app === 'gemini' && /(^|\.)google\.com$/.test(String(redirectHost || '')));
  return layout(`Connect ${who}`, `<div class="sheet"><h1>Connect ${who} to your notebook</h1>
  <p>${who} will read your notes and save new ones while you study with it. You can disconnect it any time on your account page.</p>
  ${whoRow(user, here)}
  ${known ? '' : `<p class="small"><b>Access goes to ${esc(redirectHost)}.</b> ${loopback ? 'That is an app on your computer; continue only if you just started connecting from it.' : 'Continue only if you trust it.'}</p>`}
  <form method="post"><input type="hidden" name="handle" value="${esc(handle)}"><input type="hidden" name="t" value="${esc(token)}">
  <div class="actions"><button class="btn primary" name="decision" value="approve" autofocus>Connect</button><button class="btn" name="decision" value="deny">Cancel</button></div></form></div>`, { user });
}

export function appLinkPage({ user, token, fields, here, device }) {
  const hidden = Object.entries(fields).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');
  return layout('Link the Study Notebook app', `<div class="sheet"><h1>Link the app on your computer</h1>
  <p>The Study Notebook app${device ? ` on <b>${esc(device)}</b>` : ''} will keep your notes in sync with this account: what you or Claude save shows up in both places.</p>
  ${whoRow(user, here)}
  <form method="post" action="/link">${hidden}<input type="hidden" name="t" value="${esc(token)}">
  <div class="actions"><button class="btn primary" name="decision" value="approve" autofocus>Link this computer</button><button class="btn" name="decision" value="deny">Cancel</button></div></form></div>`, { user });
}

export function messagePage(title, text, { user = null, action = '' } = {}) {
  return layout(title, `<div class="sheet"><h1>${esc(title)}</h1><p>${text}</p>${action ? `<div class="actions">${action}</div>` : ''}</div>`, { user });
}

const when = ms => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
export function accountPage({ user, token, notes, grants, computers, legacy, msg, uses = {} }) {
  const grantRows = grants.length ? `<ul class="rows">${grants.map(g => `<li><div><div class="t">${esc(g.client || 'Claude')}</div><div class="d">Connected ${when(g.createdAt * 1000)}${uses[g.app === 'gemini' ? 'gemini' : 'claude'] ? ` · last used ${when(uses[g.app === 'gemini' ? 'gemini' : 'claude'])}` : ' · not used yet'}</div></div>
    <form method="post" action="/account/revoke"><input type="hidden" name="t" value="${esc(token)}"><input type="hidden" name="grant" value="${esc(g.id)}"><button class="btn">Disconnect</button></form></li>`).join('')}</ul>`
    : `<p class="empty">Not connected yet. It takes about a minute, once:</p>
    <ol class="steps"><li>Copy this address: <b>${esc(user.mcp)}</b></li>
      <li>In Claude, open <b>Customize → Connectors</b>, click <b>Add custom connector</b>, name it Study Notebook, paste the address and click Add.</li>
      <li>Click <b>Connect</b> next to it, choose this Google account (${esc(user.email)}), then click the blue <b>Connect</b> on the Study Notebook page that opens.</li></ol>
    <div class="actions"><a class="btn" href="https://claude.ai/customize/connectors" target="_blank" rel="noopener">Open Claude’s connectors</a></div>
    <p class="empty">Gemini can use the same notebook too (Google offers this in the US for now): on gemini.google.com open Settings → Connected Apps → Add a custom app, paste the same address and follow the steps.</p>`;
  const pcRows = computers.length ? `<ul class="rows">${computers.map(c => `<li><div><div class="t">${esc(c.label || 'A computer')}</div><div class="d">Linked ${when(c.created)} · last synced ${when(c.last_used)}</div></div>
    <form method="post" action="/account/unlink"><input type="hidden" name="t" value="${esc(token)}"><input type="hidden" name="id" value="${esc(c.id)}"><button class="btn">Unlink</button></form></li>`).join('')}</ul>`
    : `<p class="empty">No computer linked. In the Study Notebook app: Settings → Sign in with Google.</p>`;
  return layout('Your account', `<div class="sheet">
  <h1>Your account</h1>
  ${msg ? `<p class="okmsg" role="status">${esc(msg)}</p>` : ''}
  ${whoRow(user, '/account')}
  <p>${notes} ${notes === 1 ? 'item' : 'items'} in your notebook. <a href="/app/">Open notebook</a></p>
  <h2>Claude and Gemini</h2>${grantRows}
  <h2>Computers</h2>${pcRows}
  ${legacy ? `<h2>Notes from the password version</h2><p>This site still holds ${legacy.count} items from before accounts existed. If they're yours, enter that notebook's old password to move them into your account.</p>
  <form method="post" action="/account/claim"><input type="hidden" name="t" value="${esc(token)}"><label for="pw">Old notebook password</label><input id="pw" type="password" name="password" autocomplete="current-password" required>
  <div class="actions"><button class="btn primary">Move them to my account</button></div></form>` : ''}
  <h2>Your data</h2>
  <p>Download everything as one file. The Study Notebook app can open it (Settings → Restore from backup).</p>
  <div class="actions"><a class="btn" href="/api/export">Download my notes</a><a class="btn" href="/auth/signout">Sign out</a></div>
  <details><summary>Delete my account</summary>
  <p>This removes your notes, practice and recordings' transcripts from this site right away, and disconnects Claude and your computers. Notes already on your computer stay there.</p>
  <form method="post" action="/account/delete"><input type="hidden" name="t" value="${esc(token)}">
  <label class="confirm"><input type="checkbox" name="sure" value="1" required> I understand this can’t be undone.</label>
  <button class="btn danger">Delete my account</button></form></details>
  </div>`, { user, wide: true });
}

export function privacyPage(user, owner) {
  return layout('Privacy', `<div class="sheet prose">
  <h1>Privacy</h1>
  <p>Study Notebook is a small, free study tool run by a student${owner ? ` (${esc(owner)})` : ''} for friends and classmates. This page says plainly what it keeps and who can see it.</p>
  <h2>What is kept</h2>
  <ul><li>Your name and email address, from Google, to know which notebook is yours.</li>
  <li>Your notebook: courses, notes, practice questions and your answers, and transcripts of lectures you recorded in the app. (The audio stays on your computer.)</li>
  <li>Sign-in records: which browsers, computers and Claude connections are signed in, so you can disconnect them.</li></ul>
  <h2>Who can see it</h2>
  <ul><li>You, on this site and in the app on computers you linked.</li>
  <li>Claude, only after you connected it on this site, and only your own notebook.</li>
  <li>No other student. Every request is checked against your account.</li>
  <li>The site's owner technically can, because the notes are stored on the owner's Cloudflare account and Claude needs to read them on the server. The owner doesn't look at notebooks, and no one else gets access.</li></ul>
  <h2>What isn't done</h2>
  <ul><li>Nothing is sold, shared or used for ads. There are no trackers or analytics.</li>
  <li>No Google password or Google access is kept; the site only asked for your name and email.</li></ul>
  <h2>Where it lives</h2>
  <p>On Cloudflare (its Workers and D1 database), which runs the site. Conversations with Claude happen in your own Claude account, under Anthropic's terms.</p>
  <h2>Leaving</h2>
  <p>On <a href="/account">your account page</a> you can download everything and delete your account. Deleting removes your data from this site right away.</p>
  </div>`, { user, wide: true });
}

export function devGooglePage(state) {
  return layout('Test sign-in', `<div class="sheet"><h1>Test sign-in</h1><p class="muted">This stand-in for Google only exists on a test copy running on this computer.</p>
  <form method="get" action="/auth/google/callback"><input type="hidden" name="state" value="${esc(state)}"><label for="e">Email</label>
  <input id="e" type="email" name="email" required autofocus><div class="actions"><button class="btn primary">Sign in</button></div></form></div>`);
}
