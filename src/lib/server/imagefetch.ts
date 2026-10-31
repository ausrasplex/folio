import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import { Fail } from './actions';

/** Downloads an image from a link someone pasted, for the browser to resize and save like an upload. */

const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 10000;
const MAX_REDIRECTS = 3;
const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon'];

// The server only fetches from the public internet, never this machine or the home network.
// (separate lists: a BlockList also matches IPv4 addresses against its IPv6 rules)
const blocked4 = new net.BlockList(), blocked6 = new net.BlockList();
for (const [a, p] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24],
  ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) blocked4.addSubnet(a, p, 'ipv4');
for (const [a, p] of [['::', 128], ['::1', 128], ['64:ff9b::', 96], ['100::', 64], ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const) blocked6.addSubnet(a, p, 'ipv6');

export function isPrivateIp(ip: string) {
  if (/^::ffff:/i.test(ip)) return true; // IPv4 written as IPv6: never needed for a public image
  const fam = net.isIP(ip);
  if (!fam) return true;
  return fam === 4 ? blocked4.check(ip, 'ipv4') : blocked6.check(ip, 'ipv6');
}

const NOPE = 'Folio can only download images from public websites';

// Checks every address a name resolves to, at connect time, so a lookup cannot be swapped after the check.
function safeLookup(host: string, opts: dns.LookupOptions, cb: (...a: any[]) => void) {
  dns.lookup(host, { ...opts, all: true }, (err, addrs) => {
    if (err) return cb(err);
    if (!addrs.length || addrs.some((x) => isPrivateIp(x.address))) return cb(Object.assign(new Error(NOPE), { code: 'EBLOCKED' }));
    if (opts && opts.all) cb(null, addrs); else cb(null, addrs[0].address, addrs[0].family);
  });
}

export function checkLink(raw: string, base?: URL) {
  let u: URL;
  try { u = new URL(String(raw || '').trim(), base); } catch { throw new Fail('That link is not a web address'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Fail('Use a link that starts with https://');
  if (u.username || u.password) throw new Fail('Use a link without a username or password in it');
  if (u.port && u.port !== '80' && u.port !== '443') throw new Fail(NOPE);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && isPrivateIp(host)) throw new Fail(NOPE);
  if (/^localhost$|\.localhost$|\.local$|\.internal$|\.lan$|\.home\.arpa$/i.test(host) || !host.includes('.') && !net.isIP(host)) throw new Fail(NOPE);
  return u;
}

function get(u: URL): Promise<{ status: number; type: string; location: string; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.get(u, { lookup: safeLookup as any, timeout: TIMEOUT_MS, headers: { 'user-agent': 'Folio/1.0 (image download)', accept: 'image/*' } }, (res) => {
      const status = res.statusCode || 0;
      const type = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      const location = String(res.headers.location || '');
      if (status !== 200) { res.resume(); return resolve({ status, type, location, body: Buffer.alloc(0) }); }
      if (!TYPES.includes(type)) { res.resume(); return reject(new Fail('That link is not an image (it is ' + (type || 'an unknown type') + ')')); }
      if (Number(res.headers['content-length'] || 0) > MAX_BYTES) { res.destroy(); return reject(new Fail('That image is over 5 MB')); }
      const parts: Buffer[] = []; let n = 0;
      res.on('data', (c: Buffer) => { n += c.length; if (n > MAX_BYTES) { res.destroy(); reject(new Fail('That image is over 5 MB')); } else parts.push(c); });
      res.on('end', () => resolve({ status, type, location, body: Buffer.concat(parts) }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Fail('That website took too long to answer')));
    req.on('error', (e: any) => reject(e instanceof Fail ? e : new Fail(e && e.code === 'EBLOCKED' ? NOPE : e && e.code === 'ENOTFOUND' ? 'That website could not be found' : 'That image could not be downloaded')));
  });
}

export async function fetchImage(raw: string) {
  let u = checkLink(raw);
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const r = await get(u);
    if (r.status >= 300 && r.status < 400 && r.location) { u = checkLink(r.location, u); continue; }
    if (r.status !== 200) throw new Fail('That website answered with an error (' + r.status + ')');
    if (!r.body.length) throw new Fail('That image is empty');
    return { type: r.type, body: r.body };
  }
  throw new Fail('That link redirects too many times');
}
