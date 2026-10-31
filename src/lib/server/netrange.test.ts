import { describe, expect, it } from 'vitest';
import { localOrVpn, privateIp, vpnIp } from './netrange';

describe('home network and VPN addresses', () => {
  it('counts private, loopback and unique-local addresses as home', () => {
    for (const ip of ['192.168.1.20', '10.0.0.4', '172.16.0.1', '172.31.255.1', '127.0.0.1', '::1', 'fd12:3456::1', 'fe80::1']) expect(privateIp(ip), ip).toBe(true);
    for (const ip of ['172.32.0.1', '203.0.113.9', '8.8.8.8', '2606:4700::1111']) expect(privateIp(ip), ip).toBe(false);
  });
  it('counts the Tailscale range as the VPN', () => {
    expect(vpnIp('100.64.0.1')).toBe(true);
    expect(vpnIp('100.127.255.254')).toBe(true);
    expect(vpnIp('100.63.0.1')).toBe(false);
    expect(vpnIp('100.128.0.1')).toBe(false);
  });
  it('lets invites open only from home or the VPN, never from an unknown address', () => {
    expect(localOrVpn('192.168.1.20')).toBe(true);
    expect(localOrVpn('::ffff:192.168.1.20')).toBe(true);
    expect(localOrVpn('100.101.102.103')).toBe(true);
    expect(localOrVpn('203.0.113.9')).toBe(false);
    expect(localOrVpn(null)).toBe(false);
    expect(localOrVpn('not an address')).toBe(false);
  });
});
