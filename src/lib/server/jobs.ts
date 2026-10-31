import { db } from './db';
import { backupSettings, makeBackup } from './backup';
import { notifyUser } from './notify';
import { buildState } from './state';

const g = globalThis as unknown as { folioJobs?: boolean };

/** Automatic backup when one is due: daily at 2am, or weekly on Sunday at 2am (server time). */
async function backupIfDue() {
  const s = await backupSettings();
  if (!s.auto) return;
  const now = new Date();
  const slot = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 2, 0);
  if (now < slot) slot.setDate(slot.getDate() - 1);
  if (s.freq === 'weekly') while (slot.getDay() !== 0) slot.setDate(slot.getDate() - 1);
  const last = await db.backup.findFirst({ where: { auto: true }, orderBy: { createdAt: 'desc' } });
  if (!last || last.createdAt < slot) await makeBackup(true);
}

/** New alerts go out once to each person's connected services. */
async function sendAlerts() {
  const people = await db.user.findMany({ where: { channels: { some: {} } } });
  for (const p of people) {
    const st = await buildState({ ...p, sessionId: '' } as Parameters<typeof buildState>[0]);
    const alerts = (st as { notifications?: { id: string; title: string; text: string; href: string }[] }).notifications || [];
    const prefs = (p.prefs || {}) as Record<string, unknown>;
    const sent = new Set((prefs.sentAlerts as string[]) || []);
    const fresh = alerts.filter((a) => !sent.has(a.id));
    if (!fresh.length) continue;
    const base = process.env.FOLIO_URL || '';
    for (const a of fresh) await notifyUser(p.id, { title: a.title, text: a.text, url: base ? base.replace(/\/$/, '') + a.href : undefined });
    await db.user.update({ where: { id: p.id }, data: { prefs: { ...prefs, sentAlerts: Array.from(sent).concat(fresh.map((a) => a.id)).slice(-500) } } });
  }
}

export function startJobs() {
  if (g.folioJobs) return;
  g.folioJobs = true;
  const tick = async () => {
    try { await backupIfDue(); } catch (e) { console.error('[folio] backup failed', e); }
    try { await sendAlerts(); } catch (e) { console.error('[folio] alerts failed', e); }
  };
  setTimeout(tick, 60000);
  setInterval(tick, 15 * 60000);
}
