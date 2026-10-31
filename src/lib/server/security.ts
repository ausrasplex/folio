import { db } from './db';
import { requestIp } from './auth';
import { passwordLimit } from './ratelimit';

/** The security log (SecurityEvent): what happened to an account or the server, from where, and when. Kept 180 days. */

export const KEEP_DAYS = 180;

export type SecurityKind =
  | 'signin' | 'signin_failed' | 'signin_paused' | 'code_failed' | 'codes_locked'
  | 'twostep_on' | 'twostep_off' | 'recovery_codes' | 'password_changed' | 'email_changed' | 'password_wrong'
  | 'signed_out_device' | 'signed_out_others' | 'backup' | 'restore' | 'settings';

/** What each kind of event is called on screen. */
export const SECURITY_TITLES: Record<SecurityKind, string> = {
  signin: 'Signed in',
  signin_failed: 'Wrong password when signing in',
  signin_paused: 'Sign-in paused after wrong passwords',
  code_failed: 'Wrong two-step code',
  codes_locked: 'Signed out after too many wrong two-step codes',
  twostep_on: 'Two-step verification turned on',
  twostep_off: 'Two-step verification turned off',
  recovery_codes: 'New recovery codes made',
  password_changed: 'Password changed',
  email_changed: 'Sign-in email changed',
  password_wrong: 'Wrong current password in Profile',
  signed_out_device: 'A device was signed out',
  signed_out_others: 'Other devices were signed out',
  backup: 'Backup made',
  restore: 'Backup restored',
  settings: 'Server settings changed'
};

/** Records an event. Never throws: logging must not stop the thing it records. The address is the request's
 *  unless given (background jobs have none). */
export async function logEvent(kind: SecurityKind, opts: { userId?: string | null; ip?: string | null; detail?: Record<string, unknown> } = {}) {
  try {
    let ip = opts.ip;
    if (ip === undefined) { try { ip = await requestIp(); } catch { ip = null; } }
    await db.securityEvent.create({ data: { kind, userId: opts.userId ?? null, ip: ip ?? null, detail: (opts.detail || {}) as object } });
  } catch (e) {
    console.error('[folio] could not record a security event', kind, e);
  }
}

/** A wrong password at sign-in (or when joining with an existing account): logged, and when it starts a wait, the
 *  pause is logged once too (attempts refused during the wait are not, so nobody can flood the log). */
export async function logWrongPassword(email: string, userId: string | null, ip: string | null) {
  await logEvent('signin_failed', { userId, ip, detail: { email } });
  const now = await passwordLimit(email, ip);
  if (!now.ok) await logEvent('signin_paused', { userId, ip, detail: { email, minutes: Math.ceil(now.waitMs / 60000) } });
}

/** One line of detail for an event, from what was recorded with it. */
export function eventDetail(kind: string, d: Record<string, unknown>) {
  const s = (v: unknown) => String(v ?? '');
  switch (kind) {
    case 'signin': return d.via === 'invite' ? 'Through an invite link' : d.twoStep ? 'With two-step verification' : '';
    case 'signin_failed': return d.email ? 'For ' + s(d.email) : '';
    case 'signin_paused': return (d.email ? 'For ' + s(d.email) + '. ' : '') + 'Waiting ' + s(d.minutes) + (Number(d.minutes) === 1 ? ' minute' : ' minutes');
    case 'email_changed': return d.from ? s(d.from) + ' to ' + s(d.to) : '';
    case 'password_changed': return Number(d.signedOut) ? Number(d.signedOut) + (Number(d.signedOut) === 1 ? ' other device signed out' : ' other devices signed out') : '';
    case 'signed_out_others': return Number(d.count) ? s(d.count) + (Number(d.count) === 1 ? ' device' : ' devices') : '';
    case 'backup': return (d.auto ? 'Automatic: ' : '') + s(d.name);
    case 'restore': return s(d.name);
    case 'settings': return Array.isArray(d.changed) ? (d.changed as string[]).map((k) => SETTING_NAMES[k] || k).join(', ') : '';
    default: return '';
  }
}

const SETTING_NAMES: Record<string, string> = {
  signup: 'Who can create accounts', allowOutside: 'Alerts to outside services', invitesLocalOnly: 'Invites only on your network',
  requireTwoStep: 'Require two-step verification', backups: 'Backups'
};

/** Events as shown on screen, newest first. People are named when they are known. Never throws: if the log
 *  cannot be read, the screens show it as empty rather than failing to load. */
export async function securityRows(where: { userId?: string }, take: number, people?: Map<string, string>) {
  let rows: Awaited<ReturnType<typeof db.securityEvent.findMany>>;
  try { rows = await db.securityEvent.findMany({ where, orderBy: { at: 'desc' }, take }); }
  catch (e) { console.error('[folio] could not read the security log', e); return []; }
  return rows.map((r) => ({
    id: r.id, kind: r.kind, at: r.at.toISOString(), ip: r.ip || '',
    title: SECURITY_TITLES[r.kind as SecurityKind] || r.kind,
    detail: eventDetail(r.kind, (r.detail as Record<string, unknown>) || {}),
    who: people ? (r.userId ? people.get(r.userId) || 'Former member' : '') : undefined
  }));
}

/** Drops events older than 180 days (run from the background jobs). */
export async function pruneEvents() {
  await db.securityEvent.deleteMany({ where: { at: { lt: new Date(Date.now() - KEEP_DAYS * 86400000) } } });
}
