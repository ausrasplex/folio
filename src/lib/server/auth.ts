import { cookies, headers } from 'next/headers';
import bcrypt from 'bcryptjs';
import { db } from './db';
import { sha256, token } from './crypto';
import { clientIpFrom } from './clientip';

export const COOKIE = 'folio_session';
const DAYS = 30;

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
  (await cookies()).set(COOKIE, t, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: DAYS * 86400, secure: process.env.FOLIO_SECURE_COOKIE === 'true' });
  return t;
}

export async function endSession() {
  const c = await cookies();
  const t = c.get(COOKIE)?.value;
  if (t) await db.session.deleteMany({ where: { id: sha256(t) } });
  c.delete(COOKIE);
}

/** The signed-in person, or null. Pass allowPending for the two-step code page. */
export async function currentUser(allowPending = false) {
  const t = (await cookies()).get(COOKIE)?.value;
  if (!t) return null;
  const s = await db.session.findUnique({ where: { id: sha256(t) }, include: { user: true } });
  if (!s) return null;
  if (s.pending2fa && !allowPending) return null;
  if (Date.now() - s.lastSeen.getTime() > DAYS * 86400000) { await db.session.delete({ where: { id: s.id } }); return null; }
  if (Date.now() - s.lastSeen.getTime() > 3600000) await db.session.update({ where: { id: s.id }, data: { lastSeen: new Date() } });
  return { ...s.user, sessionId: s.id, pending2fa: s.pending2fa };
}

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof currentUser>>>;

/** Membership in the household the person is looking at (first active one if none chosen). */
export async function currentMembership(u: CurrentUser) {
  const ms = await db.membership.findMany({ where: { userId: u.id, removedAt: null, household: { deletedAt: null } }, include: { household: true }, orderBy: { joinedAt: 'asc' } });
  const m = ms.find((x) => x.householdId === u.currentHouseholdId) || ms[0] || null;
  return { m, all: ms };
}
