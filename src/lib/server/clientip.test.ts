import { describe, expect, it } from 'vitest';
import { cleanIp, clientIpFrom } from './clientip';
import { SOCKET_HEADER } from './socketip';

const req = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });
const OFF = {}, ON = { FOLIO_TRUST_PROXY: 'true' };

describe('client address', () => {
  it('without a trusted proxy, uses only the connection and ignores forwarded headers', () => {
    expect(clientIpFrom(req({ [SOCKET_HEADER]: '192.168.1.20' }), OFF)).toBe('192.168.1.20');
    expect(clientIpFrom(req({ [SOCKET_HEADER]: '192.168.1.20', 'x-forwarded-for': '6.6.6.6' }), OFF)).toBe('192.168.1.20');
    expect(clientIpFrom(req({ [SOCKET_HEADER]: '192.168.1.20', 'cf-connecting-ip': '6.6.6.6' }), OFF)).toBe('192.168.1.20');
    expect(clientIpFrom(req({ 'x-forwarded-for': '6.6.6.6' }), OFF)).toBeNull();
  });
  it('behind a trusted proxy, prefers Cloudflare\'s header', () => {
    expect(clientIpFrom(req({ [SOCKET_HEADER]: '172.17.0.2', 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '6.6.6.6, 203.0.113.9' }), ON)).toBe('203.0.113.9');
  });
  it('takes the entry the proxy added, never ones the client wrote to its left', () => {
    // the client sent "x-forwarded-for: 6.6.6.6"; the proxy (172.17.0.2) appended the real address
    expect(clientIpFrom(req({ [SOCKET_HEADER]: '172.17.0.2', 'x-forwarded-for': '6.6.6.6, 203.0.113.9' }), ON)).toBe('203.0.113.9');
    // a LAN visitor behind the proxy keeps their own private address
    expect(clientIpFrom(req({ [SOCKET_HEADER]: '172.17.0.2', 'x-forwarded-for': '10.0.0.1, 192.168.1.20' }), ON)).toBe('192.168.1.20');
  });
  it('skips listed proxies when there are two in a row', () => {
    const env = { ...ON, FOLIO_TRUSTED_PROXY_IPS: '10.10.0.5' };
    expect(clientIpFrom(req({ [SOCKET_HEADER]: '172.17.0.2', 'x-forwarded-for': '6.6.6.6, 203.0.113.9, 10.10.0.5' }), env)).toBe('203.0.113.9');
  });
  it('falls back to the connection when the header is missing or garbled', () => {
    expect(clientIpFrom(req({ [SOCKET_HEADER]: '172.17.0.2' }), ON)).toBe('172.17.0.2');
    expect(clientIpFrom(req({ [SOCKET_HEADER]: '172.17.0.2', 'x-forwarded-for': '6.6.6.6, not-an-ip' }), ON)).toBe('172.17.0.2');
  });
  it('cleans up address forms', () => {
    expect(cleanIp('::ffff:192.168.1.20')).toBe('192.168.1.20');
    expect(cleanIp('[::1]')).toBe('::1');
    expect(cleanIp(' 203.0.113.9 ')).toBe('203.0.113.9');
    expect(cleanIp('example.com')).toBeNull();
    expect(cleanIp('')).toBeNull();
  });
});
