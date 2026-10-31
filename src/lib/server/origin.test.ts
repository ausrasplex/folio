import { describe, expect, it } from 'vitest';
import { sameOrigin } from './origin';

const h = (o: Record<string, string>) => ({ get: (n: string) => o[n] ?? null });

describe('where a request came from', () => {
  it('allows requests without an Origin, and from Folio itself', () => {
    expect(sameOrigin(h({ host: 'folio.home.lan:3000' }), {})).toBe(true);
    expect(sameOrigin(h({ host: 'folio.home.lan:3000', origin: 'http://folio.home.lan:3000' }), {})).toBe(true);
    expect(sameOrigin(h({ host: 'FOLIO.home.lan:3000', origin: 'http://folio.home.lan:3000' }), {})).toBe(true);
  });
  it('refuses another website, and the "null" origin of sandboxed pages', () => {
    expect(sameOrigin(h({ host: 'folio.home.lan:3000', origin: 'https://evil.example' }), {})).toBe(false);
    expect(sameOrigin(h({ host: 'folio.home.lan:3000', origin: 'null' }), {})).toBe(false);
    expect(sameOrigin(h({ host: 'folio.home.lan:3000', origin: 'http://folio.home.lan:3001' }), {})).toBe(false);
  });
  it("accepts FOLIO_URL's address, for when a proxy changes the Host header", () => {
    expect(sameOrigin(h({ host: '172.17.0.5:3000', origin: 'https://folio.example.com' }), { FOLIO_URL: 'https://folio.example.com' })).toBe(true);
  });
  it('trusts the forwarded host only behind a trusted proxy', () => {
    const req = h({ host: '172.17.0.5:3000', 'x-forwarded-host': 'folio.example.com', origin: 'https://folio.example.com' });
    expect(sameOrigin(req, {})).toBe(false);
    expect(sameOrigin(req, { FOLIO_TRUST_PROXY: 'true' })).toBe(true);
  });
});
