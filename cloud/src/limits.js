/* Rate limits, so one person (or a script) can't flood the site, fill the database or wear out
   the free daily allowance for everyone. Uses Cloudflare's rate-limit counters (wrangler.jsonc):
   - per account: everything a signed-in student, their app or their Claude does
   - per network address: sign-in pages and anonymous requests
   Claude's requests come from Anthropic's servers, shared by all students, so /mcp is only ever
   limited per account, never per address. Without the counters (old setup), nothing is limited. */
export async function over(counter, key) {
  if (!counter || !key) return false;
  try { return !(await counter.limit({ key })).success; } catch (e) { console.error('ratelimit', e && e.message); return false; }
}
export const address = request => request.headers.get('CF-Connecting-IP') || 'local';
export const MESSAGE = 'Too many requests in a short time. Wait a minute and try again.';
export const tooMany = () => Response.json({ error: 'rate_limited', message: MESSAGE }, { status: 429, headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' } });
