import { cookies, headers } from 'next/headers';
import bcrypt from 'bcryptjs';
import { db } from './db';
import { sha256, token } from './crypto';
import { clientIpFrom } from './clientip';

export { MIN_PASSWORD, passwordProblem, PASSWORD_RULE } from '../password';

export const COOKIE = 'folio_session';
// Over HTTPS the cookie is __Host- prefixed: browsers then only accept it when it is Secure, set by this host and for the whole site.
export const SECURE_COOKIE = '__Host-folio_session';
const DAYS = 30;

/** Whether this request arrived over HTTPS, for the session cookie. FOLIO_SECURE_COOKIE=false forces a plain cookie
 *  (HTTP on the home network) and true forces a Secure one. Otherwise: FOLIO_URL is https, or a trusted proxy says so
 *  (x-forwarded-proto is ignored without FOLIO_TRUST_PROXY, since anyone can send it). */
export function isHttps(h: { get(name: string): string | null }, env: Record<string, string | undefined> = process.env) {
  if (env.FOLIO_SECURE_COOKIE === 'false') return false;
  if (env.FOLIO_SECURE_COOKIE === 'true') return true;
  if (/^https:\/\//i.test(env.FOLIO_URL || '')) return true;
  return env.FOLIO_TRUST_PROXY === 'true' && (h.get('x-forwarded-proto') || '').split(',')[0].trim().toLowerCase() === 'https';
}
/** The session cookie's name and Secure flag for this request. */
async function cookieMode() { const secure = isHttps(await headers()); return { name: secure ? SECURE_COOKIE : COOKIE, secure }; }

export async function hashPassword(p: string) { return bcrypt.hash(p, 11); }
export async function checkPassword(p: string, h: string) { return bcrypt.compare(p, h); }

// A real hash of a random string, made once: checking against it when an email has no account takes as long as a real
// check, so the time a sign-in takes never shows whether the email exists.
let noAccount: Promise<string> | null = null;
/** Checks a password for an email, taking the same time whether or not the account exists. */
export async function passwordMatches(user: { passwordHash: string } | null, pw: string) {
  if (!user) { noAccount = noAccount || hashPassword(token(16)); await checkPassword(pw, await noAccount); return false; }
  return checkPassword(pw, user.passwordHash);
}

/** The address the request came from, worked out only from sources that can be trusted (see clientip.ts). */
export async function requestIp() {
  return clientIpFrom(await headers());
}

export async function startSession(userId: string, pending2fa = false) {
  const t = token(32);
  const h = await headers();
  await db.session.create({ data: { id: sha256(t), userId, pending2fa, userAgent: (h.get('user-agent') || '').slice(0, 300), ip: await requestIp() } });
  const mode = await cookieMode();
  (await cookies()).set(mode.name, t, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: DAYS * 86400, secure: mode.secure });
  return t;
}

export async function endSession() {
  const c = await cookies();
  const t = c.get((await cookieMode()).name)?.value;
  if (t) await db.session.deleteMany({ where: { id: sha256(t) } });
  c.delete(COOKIE);
  // a __Host- cookie is only removed by an expired copy that is itself Secure and for the whole site
  c.set(SECURE_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0, secure: true });
}

/** Swaps the pending two-step session for a new, full one with a fresh token (so the token that was handed out before
 *  the code was entered never becomes a signed-in session). */
export async function completeTwoStep(userId: string, pendingSessionId: string) {
  await db.session.deleteMany({ where: { id: pendingSessionId } });
  await startSession(userId, false);
}

/** The signed-in person, or null. Pass allowPending for the two-step code page. */
export async function currentUser(allowPending = false) {
  // only the cookie for this request's mode counts, so a plain-HTTP cookie cannot be slipped into an HTTPS session
  const t = (await cookies()).get((await cookieMode()).name)?.value;
  if (!t) return null;
  const s = await db.session.findUnique({ where: { id: sha256(t) }, include: { user: true } });
  if (!s) return null;
  if (s.pending2fa && !allowPending) return null;
  // ends after 30 days without use, and after 30 days in all however much it is used
  if (Date.now() - s.lastSeen.getTime() > DAYS * 86400000 || Date.now() - s.createdAt.getTime() > DAYS * 86400000) { await db.session.deleteMany({ where: { id: s.id } }); return null; }
  if (Date.now() - s.lastSeen.getTime() > 3600000) await db.session.update({ where: { id: s.id }, data: { lastSeen: new Date() } });
  return { ...s.user, sessionId: s.id, pending2fa: s.pending2fa };
}

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof currentUser>>>;

// ----- required two-step verification (Server tab)
/** Where someone goes to turn on two-step when the server requires it. */
export const TWO_STEP_PAGE = '/profile?setup=twostep';
/** The only actions that work until then: setting up two-step, and the theme (saved by every screen). */
export const TWO_STEP_ACTIONS = new Set(['tfaStart', 'tfaVerify', 'theme']);
export const TWO_STEP_NEEDED = 'This server needs two-step verification. Turn it on in your profile first.';

/** Whether the admin requires two-step verification for everyone. */
export async function twoStepRequired() {
  const s = await db.serverSetting.findUnique({ where: { key: 'requireTwoStep' } });
  return s?.value === true;
}
/** Signed in without two-step while the server requires it: only Profile and the set-up actions work until it is on. */
export async function needsTwoStep(u: { totpOn: boolean }) {
  return !u.totpOn && (await twoStepRequired());
}
/** For API routes: a 403 to send while two-step still has to be turned on, else null. */
export async function twoStepBlock(u: { totpOn: boolean }) {
  return (await needsTwoStep(u)) ? Response.json({ error: TWO_STEP_NEEDED }, { status: 403 }) : null;
}

/** Membership in the household the person is looking at (first active one if none chosen). */
export async function currentMembership(u: CurrentUser) {
  const ms = await db.membership.findMany({ where: { userId: u.id, removedAt: null, household: { deletedAt: null } }, include: { household: true }, orderBy: { joinedAt: 'asc' } });
  const m = ms.find((x) => x.householdId === u.currentHouseholdId) || ms[0] || null;
  return { m, all: ms };
}
