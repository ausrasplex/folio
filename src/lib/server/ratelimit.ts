import { db } from './db';

/** Limits on password and code attempts. The rules are plain functions of past failures so they can be tested;
 *  the database helpers below record and read those failures (table LoginAttempt, pruned after a day). */

export const WINDOW_MS = 15 * 60000;
const EMAIL_FREE = 5; // failures allowed before the first wait
const EMAIL_FIRST_WAIT = 60000;
const EMAIL_MAX_WAIT = 15 * 60000;
const IP_LIMIT = 30;
const IP_BLOCK = 15 * 60000;

export type Limit = { ok: true } | { ok: false; waitMs: number };

/** Per email: five failures, then a wait of 1 minute that doubles with each further failure, up to 15 minutes.
 *  The wait runs from the latest failure. Attempts refused while waiting are not counted. */
export function emailLimit(fails: number[], now: number): Limit {
  const recent = fails.filter((t) => now - t < WINDOW_MS).sort((a, b) => a - b);
  if (recent.length < EMAIL_FREE) return { ok: true };
  const wait = Math.min(EMAIL_MAX_WAIT, EMAIL_FIRST_WAIT * 2 ** (recent.length - EMAIL_FREE));
  const left = recent[recent.length - 1] + wait - now;
  return left > 0 ? { ok: false, waitMs: left } : { ok: true };
}

/** Per client address: thirty failures in 15 minutes blocks it for 15 minutes from the latest one. */
export function ipLimit(fails: number[], now: number): Limit {
  const recent = fails.filter((t) => now - t < WINDOW_MS);
  if (recent.length < IP_LIMIT) return { ok: true };
  const left = Math.max(...recent) + IP_BLOCK - now;
  return left > 0 ? { ok: false, waitMs: left } : { ok: true };
}

/** "Try again in 3 minutes." */
export function waitText(ms: number) {
  const m = Math.max(1, Math.ceil(ms / 60000));
  return 'Try again in ' + m + (m === 1 ? ' minute.' : ' minutes.');
}

/** The one message for a wrong email or password, with the wait (in whole minutes, from the address bar) when there is one.
 *  The same whether or not the email has an account, and it never says which part was wrong. */
export function noMatchText(minutes?: string | number) {
  const m = Math.floor(Number(minutes) || 0);
  return "That email and password don't match." + (m > 0 ? ' Try again in ' + Math.min(m, 15) + (m === 1 ? ' minute.' : ' minutes.') : '');
}

export const emailKey =(email: string) => 'email:' + String(email || '').trim().toLowerCase();
export const ipKey = (ip: string) => 'ip:' + ip;

/** Failure times for a key in the last 15 minutes. */
export async function failures(key: string, now = Date.now()) {
  const rows = await db.loginAttempt.findMany({ where: { key, ok: false, at: { gt: new Date(now - WINDOW_MS) } }, select: { at: true } });
  return rows.map((r) => r.at.getTime());
}

export async function recordAttempt(key: string, ok: boolean, ip: string | null) {
  await db.loginAttempt.create({ data: { key, ok, ip } });
}

/** A success clears a key's failures. */
export async function clearFailures(key: string) {
  await db.loginAttempt.deleteMany({ where: { key, ok: false } });
}

/** Whether a password may be checked for this email from this address right now. */
export async function passwordLimit(email: string, ip: string | null): Promise<Limit> {
  const now = Date.now();
  const byEmail = emailLimit(await failures(emailKey(email), now), now);
  const byIp: Limit = ip ? ipLimit(await failures(ipKey(ip), now), now) : { ok: true };
  if (byEmail.ok && byIp.ok) return { ok: true };
  return { ok: false, waitMs: Math.max(byEmail.ok ? 0 : byEmail.waitMs, byIp.ok ? 0 : byIp.waitMs) };
}

/** Records the result of a password check: a failure counts against the email and the address, a success clears the email. */
export async function passwordResult(email: string, ip: string | null, ok: boolean) {
  if (ok) { await clearFailures(emailKey(email)); await recordAttempt(emailKey(email), true, ip); return; }
  await recordAttempt(emailKey(email), false, ip);
  if (ip) await recordAttempt(ipKey(ip), false, ip);
}

/** Drops attempts older than a day (run from the background jobs). */
export async function pruneAttempts() {
  await db.loginAttempt.deleteMany({ where: { at: { lt: new Date(Date.now() - 86400000) } } });
}
