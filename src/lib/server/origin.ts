/** Refuses POSTs sent from another site. A browser always names the page a cross-site POST came from in Origin;
 *  when that is present and is not Folio's own address, the request is refused. (Folio's sign-in forms are Next.js
 *  server actions, which Next already checks the same way.) */

type HeaderSource = { get(name: string): string | null };

/** The hosts Folio answers as: the Host header, FOLIO_URL's host, and behind a trusted proxy the forwarded host. */
export function ownHosts(h: HeaderSource, env: Record<string, string | undefined> = process.env) {
  const hosts = new Set<string>();
  const add = (v: string | null | undefined) => { const s = String(v || '').split(',')[0].trim().toLowerCase(); if (s) hosts.add(s); };
  add(h.get('host'));
  if (env.FOLIO_TRUST_PROXY === 'true') add(h.get('x-forwarded-host'));
  try { if (env.FOLIO_URL) add(new URL(env.FOLIO_URL).host); } catch { /* not a full address */ }
  return hosts;
}

/** True when the request may go ahead: no Origin (not a browser's cross-site request), or Origin is our own address. */
export function sameOrigin(h: HeaderSource, env: Record<string, string | undefined> = process.env) {
  const origin = h.get('origin');
  if (origin == null || origin === '') return true;
  let host: string;
  try { host = new URL(origin).host.toLowerCase(); } catch { return false; } // includes "null" from sandboxed pages
  return ownHosts(h, env).has(host);
}

/** For POST routes: a 403 to send when the request came from another site, else null. */
export function crossSiteBlock(req: Request) {
  return sameOrigin(req.headers) ? null : Response.json({ error: 'This request came from another website, so Folio refused it. Open Folio directly and try again.' }, { status: 403 });
}
