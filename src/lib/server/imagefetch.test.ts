import { describe, it, expect } from 'vitest';
import { checkLink, isPrivateIp, fetchImage } from './imagefetch';

describe('image links', () => {
  it('blocks private, loopback and odd addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.10', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1'])
      expect(isPrivateIp(ip), ip).toBe(true);
    for (const ip of ['1.1.1.1', '142.250.70.78', '2606:4700:4700::1111']) expect(isPrivateIp(ip), ip).toBe(false);
  });
  it('accepts plain public web links', () => {
    expect(checkLink('https://cdn.example.com/logo.png').hostname).toBe('cdn.example.com');
    expect(checkLink('http://example.com:80/a.svg').hostname).toBe('example.com');
  });
  it('refuses links the server should not follow', () => {
    for (const bad of ['', 'not a link', 'ftp://example.com/a.png', 'file:///etc/passwd', 'data:image/png;base64,AAAA', 'javascript:alert(1)',
      'http://localhost/a.png', 'http://printer.local/a.png', 'http://nas/a.png', 'http://127.0.0.1/a.png', 'http://2130706433/a.png', 'http://[::1]/a.png',
      'http://192.168.0.1/a.png', 'https://example.com:8443/a.png', 'https://user:pw@example.com/a.png'])
      expect(() => checkLink(bad), bad).toThrow();
  });
  it('resolves redirects against the page they came from', () => {
    expect(checkLink('/img/logo.png', new URL('https://example.com/brand/')).href).toBe('https://example.com/img/logo.png');
    expect(() => checkLink('http://10.0.0.5/x.png', new URL('https://example.com/'))).toThrow();
  });
  it('refuses a public name that resolves to this machine', async () => {
    // localtest.me is a public name pointing at 127.0.0.1
    await expect(fetchImage('http://localtest.me/a.png')).rejects.toThrow(/public websites|could not be found/);
  });
});
