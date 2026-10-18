/* The site's own firewall, checked before anything else:
   - a block list the site owner can set in the Cloudflare dashboard (Workers → study-notebook →
     Settings → Variables → BLOCKED_IPS), e.g. "203.0.113.7, 198.51.100.0/24, 2001:db8::/32"
   - an automatic ban: an address that goes over the rate limit in 3 different minutes within
     10 minutes is shut out for an hour (one busy minute, e.g. a whole class on campus wifi, is fine)
   - basic rules: only normal request types, no oversized uploads.
   (Cloudflare itself already stops large DDoS attacks before they reach this code.) */
const MAX_BODY = 30 * 1024 * 1024;
const METHODS = new Set(['GET', 'HEAD', 'POST', 'OPTIONS', 'DELETE']);
const STRIKES = 3, STRIKE_WINDOW = 10 * 60 * 1000, BAN_FOR = 60 * 60 * 1000;

function toBits(ip) {
  if (ip.includes(':')) {
    let [head, tail = ''] = ip.toLowerCase().split('::');
    const h = head ? head.split(':') : [], t = ip.includes('::') ? (tail ? tail.split(':') : []) : [];
    const groups = ip.includes('::') ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h;
    if (groups.length !== 8 || groups.some(g => !/^[0-9a-f]{1,4}$/.test(g))) return null;
    return groups.map(g => parseInt(g, 16).toString(2).padStart(16, '0')).join('');
  }
  const p = ip.split('.');
  if (p.length !== 4 || p.some(x => !/^\d{1,3}$/.test(x) || +x > 255)) return null;
  return p.map(x => (+x).toString(2).padStart(8, '0')).join('');
}
let parsedFrom = null, rules = [];
function blockRules(list) {
  if (list === parsedFrom) return rules;
  parsedFrom = list;
  rules = String(list || '').split(/[\s,;]+/).filter(Boolean).map(r => {
    const [ip, len] = r.split('/'); const bits = toBits(ip);
    if (!bits) return null;
    const n = len === undefined ? bits.length : Number(len);
    return Number.isInteger(n) && n >= 0 && n <= bits.length ? bits.slice(0, n) : null;
  }).filter(r => r !== null);
  return rules;
}
export const isBlocked = (env, ip) => { const b = toBits(ip); return !!b && blockRules(env.BLOCKED_IPS).some(r => b.startsWith(r)); };

// Automatic bans live in this server copy's memory (no storage costs, nothing to clean up).
const strikes = new Map(), banned = new Map();
export function isBanned(ip, now = Date.now()) {
  const until = banned.get(ip);
  if (!until) return false;
  if (until > now) return true;
  banned.delete(ip); return false;
}
export function strike(ip, now = Date.now()) {
  if (ip === 'local') return;
  const recent = (strikes.get(ip) || []).filter(t => now - t < STRIKE_WINDOW);
  if (recent.length && now - recent[recent.length - 1] < 60 * 1000) return;   // once per minute
  recent.push(now);
  if (recent.length >= STRIKES) { banned.set(ip, now + BAN_FOR); strikes.delete(ip); console.warn('firewall: banned', ip, 'for an hour'); }
  else strikes.set(ip, recent);
  if (strikes.size > 5000) strikes.clear();
  if (banned.size > 5000) for (const [k, v] of banned) if (v <= now) banned.delete(k);
}

const deny = (status, text) => new Response(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
// Returns a refusal, or null when the request may go on.
export function firewall(request, env, ip) {
  if (isBlocked(env, ip)) return deny(403, 'Access from this network is blocked.');
  if (isBanned(ip)) return deny(429, 'Too many requests from this network. Try again in an hour.');
  if (!METHODS.has(request.method)) return deny(405, 'Not allowed.');
  const size = Number(request.headers.get('Content-Length') || 0);
  if (size > MAX_BODY) return deny(413, 'That upload is too large.');
  return null;
}
