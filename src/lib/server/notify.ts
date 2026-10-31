// Sends alerts to the services a person connected (Discord, Telegram, ntfy, Gotify, Home Assistant, a webhook).
// Secrets are stored encrypted; amounts are left out unless the person allowed them for that service.
import { createHmac } from 'crypto';
import { db } from './db';
import { dec } from './crypto';

export const OUTSIDE = ['discord', 'telegram'];
export type Msg = { title: string; text: string; amountsText?: string; url?: string };

const cfgOf = (c: { config: unknown }) => {
  const raw = (c.config || {}) as Record<string, string>;
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, /token|secret/i.test(k) ? dec(v) : v])) as Record<string, string>;
};

async function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 10000);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body), signal: ctl.signal });
    if (!r.ok) throw new Error('The service answered ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 120));
  } finally { clearTimeout(t); }
}

export async function sendTo(service: string, cfg: Record<string, string>, m: Msg, withAmounts: boolean) {
  const text = withAmounts && m.amountsText ? m.amountsText : m.text;
  const full = m.title + '\n' + text + (m.url ? '\n' + m.url : '');
  switch (service) {
    case 'discord':
      if (cfg.mode === 'bot') return post('https://discord.com/api/v10/channels/' + encodeURIComponent(cfg.channel) + '/messages', { content: '**' + m.title + '**\n' + text + (m.url ? '\n' + m.url : '') }, { authorization: 'Bot ' + cfg.token });
      return post(cfg.url, { username: 'Folio', content: '**' + m.title + '**\n' + text + (m.url ? '\n' + m.url : '') });
    case 'telegram':
      return post('https://api.telegram.org/bot' + cfg.token + '/sendMessage', { chat_id: cfg.chat, text: full });
    case 'ntfy':
      return post(cfg.url.replace(/\/$/, '') + '/' + encodeURIComponent(cfg.topic), text, { title: m.title, 'content-type': 'text/plain', ...(m.url ? { click: m.url } : {}) });
    case 'gotify':
      return post(cfg.url.replace(/\/$/, '') + '/message?token=' + encodeURIComponent(cfg.token), { title: m.title, message: text, priority: 5 });
    case 'ha': {
      const svc = (cfg.service || 'notify.notify').replace(/^notify\./, '');
      return post(cfg.url.replace(/\/$/, '') + '/api/services/notify/' + encodeURIComponent(svc), { title: m.title, message: text }, { authorization: 'Bearer ' + cfg.token });
    }
    case 'webhook': {
      const body = JSON.stringify({ title: m.title, text, url: m.url || null, at: new Date().toISOString() });
      return post(cfg.url, body, cfg.secret ? { 'x-folio-signature': createHmac('sha256', cfg.secret).update(body).digest('hex') } : {});
    }
  }
  throw new Error('Unknown service');
}

/** Sends one alert to every service the person connected. Outside services are skipped when the admin turned them off. */
export async function notifyUser(userId: string, m: Msg) {
  const allowOutside = (await db.serverSetting.findUnique({ where: { key: 'allowOutside' } }))?.value !== false;
  const chans = await db.channel.findMany({ where: { userId } });
  const errors: string[] = [];
  for (const c of chans) {
    if (OUTSIDE.includes(c.service) && !allowOutside) continue;
    try { await sendTo(c.service, cfgOf(c), m, c.amounts); } catch (e) { errors.push(c.service + ': ' + (e instanceof Error ? e.message : 'failed')); }
  }
  return errors;
}
export { cfgOf };
