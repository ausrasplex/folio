import { cleanIp } from './clientip';

/** Address ranges, shared by the Server tab's privacy check and invites that only open on the home network. */

/** The home network: private IPv4 ranges, loopback, link-local and IPv6 unique-local addresses. */
export const privateIp = (ip: string) => /^(10\.|127\.|192\.168\.|169\.254\.|::1$|fc|fd|fe80)/i.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
/** The CGNAT range used by Tailscale and similar VPNs (100.64.0.0/10). */
export const vpnIp = (ip: string) => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip);

/** On the home network or its VPN. An unknown or malformed address is not. */
export function localOrVpn(ip: string | null | undefined) {
  const c = cleanIp(ip);
  return !!c && (privateIp(c) || vpnIp(c));
}
