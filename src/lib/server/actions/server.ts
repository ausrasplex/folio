// Server settings (admin only), backups, update checks and the privacy check.
import { promises as dns } from 'dns';
import { type Action, type Ctx, db, need, str } from '../actions';
import { APP_VERSION, backupSettings, makeBackup } from '../backup';

const admin = (c: Ctx) => need(c.u.isAdmin, 'Only the server admin can change server settings.');
const set = (key: string, value: object | string | boolean | number) => db.serverSetting.upsert({ where: { key }, update: { value }, create: { key, value } });

const privateIp = (ip: string) => /^(10\.|127\.|192\.168\.|169\.254\.|::1$|fc|fd|fe80)/i.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
const vpnIp = (ip: string) => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip); // CGNAT range used by Tailscale and similar

export const serverActions: Record<string, Action> = {
  saveServer: async (c) => {
    admin(c);
    const p = c.p;
    if ('signup' in p) await set('signup', p.signup === 'closed' ? 'closed' : 'invite');
    if ('allowOutside' in p) await set('allowOutside', !!p.allowOutside);
    if ('requireTwoStep' in p) {
      // the admin turns it on for themselves first, so this cannot lock them out of their own settings
      if (p.requireTwoStep) need(c.u.totpOn, 'Turn on two-step verification for your own account first, in your profile.');
      await set('requireTwoStep', !!p.requireTwoStep);
    }
    if (p.backups && typeof p.backups === 'object') {
      const cur = await backupSettings();
      const b = p.backups as Record<string, unknown>;
      const folder = 'folder' in b ? str(b.folder, 300) : cur.folder;
      need(folder, 'Choose a folder for backups.');
      await set('backups', { auto: 'auto' in b ? !!b.auto : cur.auto, freq: b.freq === 'weekly' ? 'weekly' : b.freq === 'daily' ? 'daily' : cur.freq, keep: [7, 14, 30].includes(Number(b.keep)) ? Number(b.keep) : cur.keep, folder, remind: 'remind' in b ? !!b.remind : cur.remind });
    }
  },
  backupNow: async (c) => {
    admin(c);
    try { const b = await makeBackup(false); return { id: b.id, name: b.fileName }; }
    catch (e) { need(false, 'The backup could not be written. ' + (e instanceof Error ? e.message : '')); }
  },
  checkUpdate: async (c) => {
    admin(c);
    const url = process.env.FOLIO_UPDATE_URL;
    if (!url) return { text: 'Folio ' + APP_VERSION + ' is installed. Update checks are off because FOLIO_UPDATE_URL is not set.' };
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) }); const j = await r.json();
      const latest = String(j.version || j.tag_name || '').replace(/^v/, '');
      return { text: latest && latest !== APP_VERSION ? 'Folio ' + latest + ' is available. You have ' + APP_VERSION + '.' : 'Folio ' + APP_VERSION + ' is the latest version.' };
    } catch { return { text: 'Could not reach the update address.' }; }
  },
  /** Looks up the address people use to reach Folio and says whether it is private, a VPN address or public. */
  privacyCheck: async (c) => {
    const host = str(c.p.host, 200).replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    let ips: string[] = [];
    if (/^[\d.]+$|:/.test(host)) ips = [host];
    else { try { ips = (await dns.lookup(host, { all: true })).map((a) => a.address); } catch { ips = []; } }
    const reach = !ips.length ? 'Could not look up ' + host : ips.every(privateIp) ? 'This network only' : ips.every((ip) => privateIp(ip) || vpnIp(ip)) ? 'Your VPN' : 'A public address';
    return { host, ips, reach, public: reach === 'A public address', at: new Date().toISOString() };
  }
};
