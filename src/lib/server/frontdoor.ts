import crypto from 'node:crypto';
import { clientIpFrom } from './clientip';
import { localOrVpn } from './netrange';

/**
 * Optional "front door" checks that run before Folio answers anything (src/middleware.ts), for when Folio is
 * reachable from the internet. Folio's own sign-in still applies afterwards.
 *
 * Cloudflare Access (FOLIO_CF_ACCESS_AUD and FOLIO_CF_ACCESS_TEAM): every request must carry a valid
 * Cf-Access-Jwt-Assertion for the Access application, so nobody can reach Folio around the tunnel.
 */

type HeaderSource = { get(name: string): string | null };
type Env = Record<string, string | undefined>;
export type Jwk = { kid?: string; kty: string; n: string; e: string; alg?: string };
export type KeySource = (refresh: boolean) => Promise<Jwk[]>;
export type DoorResult = { ok: true } | { ok: false; why: string };

/** The team's sign-in domain: "myteam" or "myteam.cloudflareaccess.com". */
export const teamDomain = (team: string) => (team.includes('.') ? team : team + '.cloudflareaccess.com').replace(/^https?:\/\//, '').replace(/\/+$/, '');

const b64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** Checks a Cloudflare Access token: signed by one of the team's keys (RS256), for this application, from this team, in date. */
export async function verifyAccessJwt(token: string, opts: { aud: string; team: string; keys: KeySource; now?: number }): Promise<boolean> {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return false;
  let header: { alg?: string; kid?: string }, claims: { aud?: string | string[]; iss?: string; exp?: number; nbf?: number };
  try { header = JSON.parse(b64url(parts[0]).toString('utf8')); claims = JSON.parse(b64url(parts[1]).toString('utf8')); } catch { return false; }
  if (header.alg !== 'RS256') return false;
  // a key we have not seen may be a new one Cloudflare rotated in, so look once more with fresh keys
  let key = (await opts.keys(false)).find((k) => k.kid === header.kid);
  if (!key) key = (await opts.keys(true)).find((k) => k.kid === header.kid);
  if (!key) return false;
  let good = false;
  try { good = crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), crypto.createPublicKey({ key: key as crypto.JsonWebKey, format: 'jwk' }), b64url(parts[2])); } catch { return false; }
  if (!good) return false;
  const now = (opts.now ?? Date.now()) / 1000, skew = 60;
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!auds.includes(opts.aud)) return false;
  if (claims.iss !== 'https://' + teamDomain(opts.team)) return false;
  if (typeof claims.exp !== 'number' || claims.exp + skew < now) return false;
  if (typeof claims.nbf === 'number' && claims.nbf - skew > now) return false;
  return true;
}

// ----- the team's public keys, fetched from Cloudflare and kept for an hour
const cache: { team: string; keys: Jwk[]; at: number } = { team: '', keys: [], at: 0 };
export function cloudflareKeys(team: string): KeySource {
  return async (refresh) => {
    const fresh = cache.team === team && Date.now() - cache.at < (refresh ? 5 * 60000 : 3600000);
    if (fresh && cache.keys.length) return cache.keys;
    const r = await fetch('https://' + teamDomain(team) + '/cdn-cgi/access/certs', { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error('Cloudflare answered ' + r.status);
    const j = (await r.json()) as { keys?: Jwk[] };
    Object.assign(cache, { team, keys: (j.keys || []).filter((k) => k.kty === 'RSA'), at: Date.now() });
    return cache.keys;
  };
}

/** Whether a request may reach Folio. With nothing configured, everything may. */
export async function frontDoor(h: HeaderSource, env: Env = process.env, keys?: KeySource): Promise<DoorResult> {
  const aud = env.FOLIO_CF_ACCESS_AUD, team = env.FOLIO_CF_ACCESS_TEAM;
  if (aud && team) {
    const token = h.get('cf-access-jwt-assertion');
    if (!token) {
      if (env.FOLIO_CF_ACCESS_LAN_BYPASS === 'true' && localOrVpn(clientIpFrom(h, env))) return { ok: true };
      return { ok: false, why: 'Open Folio through its Cloudflare address, where you sign in to Cloudflare Access first.' };
    }
    try {
      if (!(await verifyAccessJwt(token, { aud, team, keys: keys || cloudflareKeys(team) }))) return { ok: false, why: 'Your Cloudflare Access sign-in was not accepted. Sign in again through the Cloudflare address.' };
    } catch {
      // fail closed: when the keys cannot be fetched, nobody gets in around the check
      return { ok: false, why: 'Cloudflare Access could not be checked just now. Try again in a minute.' };
    }
  }
  return { ok: true };
}
