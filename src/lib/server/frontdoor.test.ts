import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { frontDoor, verifyAccessJwt, type Jwk } from './frontdoor';
import { SOCKET_HEADER } from './socketip';

// a key pair standing in for the Cloudflare team's signing key
const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...(pair.publicKey.export({ format: 'jwk' }) as Jwk), kid: 'k1', alg: 'RS256' };
const keys = async () => [jwk];
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const AUD = 'aud-tag-123', TEAM = 'myteam';
function token(claims: Record<string, unknown> = {}, opts: { key?: crypto.KeyObject; kid?: string } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'RS256', kid: opts.kid ?? 'k1' });
  const body = b64({ aud: [AUD], iss: 'https://myteam.cloudflareaccess.com', exp: now + 300, nbf: now - 10, email: 'alex@example.com', ...claims });
  return head + '.' + body + '.' + crypto.sign('RSA-SHA256', Buffer.from(head + '.' + body), opts.key ?? pair.privateKey).toString('base64url');
}
const verify = (t: string) => verifyAccessJwt(t, { aud: AUD, team: TEAM, keys });

describe('Cloudflare Access tokens', () => {
  it('accepts a token signed by the team, for this application, in date', async () => {
    expect(await verify(token())).toBe(true);
    expect(await verifyAccessJwt(token(), { aud: AUD, team: 'myteam.cloudflareaccess.com', keys })).toBe(true);
  });
  it('refuses any other token', async () => {
    expect(await verify(token({ aud: ['someone-elses-app'] }))).toBe(false);
    expect(await verify(token({ iss: 'https://otherteam.cloudflareaccess.com' }))).toBe(false);
    expect(await verify(token({ exp: Math.floor(Date.now() / 1000) - 3600 }))).toBe(false);
    expect(await verify(token({}, { key: other.privateKey }))).toBe(false);
    expect(await verify(token({}, { kid: 'unknown' }))).toBe(false);
    expect(await verify('not.a.token')).toBe(false);
    const [h, , s] = token().split('.');
    expect(await verify(h + '.' + b64({ aud: [AUD], iss: 'https://myteam.cloudflareaccess.com', exp: 9999999999 }) + '.' + s)).toBe(false); // claims changed after signing
  });
  it('looks for a rotated key once more before refusing', async () => {
    let calls = 0;
    const rotating = async (refresh: boolean) => { calls++; return refresh ? [jwk] : []; };
    expect(await verifyAccessJwt(token(), { aud: AUD, team: TEAM, keys: rotating })).toBe(true);
    expect(calls).toBe(2);
  });
});

describe('the front door', () => {
  const env = { FOLIO_CF_ACCESS_AUD: AUD, FOLIO_CF_ACCESS_TEAM: TEAM };
  const h = (o: Record<string, string>) => ({ get: (n: string) => o[n.toLowerCase()] ?? null });
  it('lets everything through when nothing is configured', async () => {
    expect((await frontDoor(h({}), {})).ok).toBe(true);
  });
  it('needs a valid token when Cloudflare Access is configured', async () => {
    expect((await frontDoor(h({ 'cf-access-jwt-assertion': token() }), env, keys)).ok).toBe(true);
    expect((await frontDoor(h({}), env, keys)).ok).toBe(false);
    expect((await frontDoor(h({ 'cf-access-jwt-assertion': token({ aud: ['x'] }) }), env, keys)).ok).toBe(false);
  });
  it('lets the home network in without a token only when the bypass is on', async () => {
    const lan = h({ [SOCKET_HEADER]: '192.168.7.42' });
    expect((await frontDoor(lan, env, keys)).ok).toBe(false);
    expect((await frontDoor(lan, { ...env, FOLIO_CF_ACCESS_LAN_BYPASS: 'true' }, keys)).ok).toBe(true);
    expect((await frontDoor(h({ [SOCKET_HEADER]: '203.0.113.9' }), { ...env, FOLIO_CF_ACCESS_LAN_BYPASS: 'true' }, keys)).ok).toBe(false);
  });
  it('refuses when the keys cannot be fetched (fails closed)', async () => {
    const r = await frontDoor(h({ 'cf-access-jwt-assertion': token() }), env, async () => { throw new Error('offline'); });
    expect(r.ok).toBe(false);
  });
});
