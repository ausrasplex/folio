import { beforeEach, describe, expect, it, vi } from 'vitest';

// the request's headers and the cookies set, in place of Next's
let reqHeaders: Record<string, string> = {};
const set: { name: string; value: string; opts: Record<string, unknown> }[] = [];
vi.mock('next/headers', () => ({
  headers: async () => ({ get: (n: string) => reqHeaders[n.toLowerCase()] ?? null }),
  cookies: async () => ({ set: (name: string, value: string, opts: Record<string, unknown>) => set.push({ name, value, opts }), get: () => undefined, delete: () => {} })
}));
vi.mock('./db', () => ({ db: { session: { create: async () => ({}) } } }));

import { COOKIE, SECURE_COOKIE, isHttps, startSession } from './auth';

const h = (o: Record<string, string>) => ({ get: (n: string) => o[n] ?? null });
beforeEach(() => { set.length = 0; reqHeaders = {}; for (const k of ['FOLIO_SECURE_COOKIE', 'FOLIO_URL', 'FOLIO_TRUST_PROXY']) delete process.env[k]; });

describe('session cookie', () => {
  it('is Secure when Folio is reached over HTTPS', () => {
    expect(isHttps(h({}), { FOLIO_URL: 'https://folio.example.com' })).toBe(true);
    expect(isHttps(h({ 'x-forwarded-proto': 'https' }), { FOLIO_TRUST_PROXY: 'true' })).toBe(true);
  });
  it('ignores a client claiming HTTPS when no proxy is trusted', () => {
    expect(isHttps(h({ 'x-forwarded-proto': 'https' }), {})).toBe(false);
    expect(isHttps(h({}), { FOLIO_URL: 'http://folio.home.lan:3000' })).toBe(false);
  });
  it('can be forced either way', () => {
    expect(isHttps(h({}), { FOLIO_URL: 'https://folio.example.com', FOLIO_SECURE_COOKIE: 'false' })).toBe(false);
    expect(isHttps(h({}), { FOLIO_SECURE_COOKIE: 'true' })).toBe(true);
  });
  it('a sign-in through an HTTPS reverse proxy sets a Secure __Host- cookie', async () => {
    process.env.FOLIO_TRUST_PROXY = 'true';
    process.env.FOLIO_SECRET = process.env.FOLIO_SECRET || 'a-test-secret-that-is-long-enough';
    reqHeaders = { 'x-forwarded-proto': 'https' };
    await startSession('u1');
    expect(set[0].name).toBe(SECURE_COOKIE);
    expect(set[0].opts).toMatchObject({ secure: true, httpOnly: true, path: '/', sameSite: 'lax' });
  });
  it('a sign-in over plain HTTP on the home network sets the plain cookie', async () => {
    await startSession('u1');
    expect(set[0].name).toBe(COOKIE);
    expect(set[0].opts.secure).toBe(false);
  });
});
