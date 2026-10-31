// Where alerts go: each person connects their own services.
import { type Action, db, need, str } from '../actions';
import { dec, enc } from '../crypto';
import { OUTSIDE, sendTo } from '../notify';

const FIELDS: Record<string, string[]> = {
  discord: ['mode', 'url', 'label', 'token', 'channel'], telegram: ['token', 'chat'], ntfy: ['url', 'topic'], gotify: ['url', 'token'], ha: ['url', 'token', 'service'], webhook: ['url', 'secret']
};
const isSecret = (k: string) => /token|secret/i.test(k);

async function outsideAllowed(service: string) {
  if (!OUTSIDE.includes(service)) return true;
  return (await db.serverSetting.findUnique({ where: { key: 'allowOutside' } }))?.value !== false;
}
/** The draft from the screen, with secrets left as they were when they come back masked. */
async function configOf(userId: string, service: string, p: Record<string, unknown>) {
  need(FIELDS[service], 'Unknown service.');
  const old = await db.channel.findUnique({ where: { userId_service: { userId, service } } });
  const prev = (old?.config || {}) as Record<string, string>;
  const out: Record<string, string> = {};
  for (const k of FIELDS[service]) {
    const v = str(p[k], 500);
    out[k] = isSecret(k) ? (v && !/^•+$/.test(v) ? enc(v) || '' : prev[k] || '') : v;
  }
  for (const k of ['url']) if (out[k]) need(/^https?:\/\//i.test(out[k]), 'Enter a full address starting with http:// or https://');
  return out;
}

export const channelActions: Record<string, Action> = {
  saveChannel: async ({ u, p }) => {
    const service = str(p.service);
    need(await outsideAllowed(service), 'The server admin has turned off outside services.');
    const config = await configOf(u.id, service, p.config || {});
    await db.channel.upsert({ where: { userId_service: { userId: u.id, service } }, update: { config, amounts: !!p.amounts }, create: { userId: u.id, service, config, amounts: !!p.amounts } });
  },
  removeChannel: async ({ u, p }) => { await db.channel.deleteMany({ where: { userId: u.id, service: str(p.service) } }); },
  testChannel: async ({ u, p }) => {
    const service = str(p.service);
    need(await outsideAllowed(service), 'The server admin has turned off outside services.');
    const enc0 = await configOf(u.id, service, p.config || {});
    const cfg = Object.fromEntries(Object.entries(enc0).map(([k, v]) => [k, isSecret(k) ? dec(v) : v])) as Record<string, string>;
    try { await sendTo(service, cfg, { title: 'Folio test message', text: 'Alerts from Folio will arrive here.', amountsText: 'Alerts from Folio will arrive here, with amounts like $1,234.' }, !!p.amounts); }
    catch (e) { need(false, 'The test did not go through. ' + (e instanceof Error ? e.message : '')); }
    return { ok: true };
  }
};
