import net from 'node:net';
import { SOCKET_HEADER } from './socketip';

type HeaderSource = { get(name: string): string | null };

/** A plain IP address, or null. IPv4 written as IPv6 (::ffff:1.2.3.4) becomes 1.2.3.4. */
export function cleanIp(v: string | null | undefined) {
  const s = String(v || '').trim().replace(/^\[|\]$/g, '').replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, '$1');
  return net.isIP(s) ? s : null;
}

/** Proxies that may add to x-forwarded-for, from FOLIO_TRUSTED_PROXY_IPS (comma-separated). */
export function trustedProxies(env: Record<string, string | undefined> = process.env) {
  return new Set(String(env.FOLIO_TRUSTED_PROXY_IPS || '').split(',').map(cleanIp).filter((x): x is string => !!x));
}

/**
 * The address a request came from, or null when it cannot be known.
 * FOLIO_TRUST_PROXY off (the default): only the connection's own address; forwarded headers are ignored, since anyone can send them.
 * FOLIO_TRUST_PROXY=true (Folio sits behind a reverse proxy or Cloudflare): cf-connecting-ip when present, else the
 * right-most x-forwarded-for entry that is not one of our proxies (the entry our proxy added; ones to its left come from the client).
 */
export function clientIpFrom(h: HeaderSource, env: Record<string, string | undefined> = process.env): string | null {
  const socket = cleanIp(h.get(SOCKET_HEADER));
  if (env.FOLIO_TRUST_PROXY !== 'true') return socket;
  const cf = cleanIp(h.get('cf-connecting-ip'));
  if (cf) return cf;
  const proxies = trustedProxies(env);
  if (socket) proxies.add(socket);
  const chain = String(h.get('x-forwarded-for') || '').split(',').map(cleanIp);
  for (let i = chain.length - 1; i >= 0; i--) {
    const ip = chain[i];
    if (!ip) return socket; // a malformed entry: nothing to its left can be trusted
    if (!proxies.has(ip)) return ip;
  }
  return socket;
}
