import { type Action, db, need, str } from '../actions';
import { checkPassword, hashPassword, requestIp } from '../auth';
import { clearFailures, emailLimit, failures, passwordLimit, passwordResult, recordAttempt, totpKey, waitText } from '../ratelimit';
import { enc, sha256 } from '../crypto';
import { makeRecoveryCodes, newSecret, otpUri, useRecoveryCode, useTotp } from '../twofactor';

const img = (v: unknown) => { const s = String(v ?? ''); if (!s) return null; need(/^data:image\/(png|jpeg|webp|gif);base64,/.test(s) && s.length < 600000, 'That image is too large or not a picture.'); return s; };
const freshCodes = async (userId: string) => { const codes = makeRecoveryCodes(); await db.user.update({ where: { id: userId }, data: { recoveryCodes: codes.map((c) => sha256(c.toUpperCase())) } }); return codes; };

/** Checks your own password, under the same limit as signing in (a stolen session cannot guess it freely). */
const ownPassword = async (u: { email: string; passwordHash: string }, pw: unknown, wrong: string) => {
  const ip = await requestIp();
  const lim = await passwordLimit(u.email, ip);
  need(lim.ok, 'Too many wrong passwords. ' + (lim.ok ? '' : waitText(lim.waitMs)));
  const ok = await checkPassword(String(pw || ''), u.passwordHash);
  await passwordResult(u.email, ip, ok);
  need(ok, wrong);
};

/** Checks one of your own two-step codes (or, with recovery, a recovery code). Wrong codes count like wrong passwords:
 *  five, then a wait of 1 minute doubling to 15. A good code cannot be used again in its 30 seconds. */
const ownCode = async (u: { id: string }, code: string, wrong: string, opts: { setup?: boolean; recovery?: boolean } = {}) => {
  const key = totpKey(u.id);
  const now = Date.now();
  const lim = emailLimit(await failures(key, now), now);
  need(lim.ok, 'Too many wrong codes. ' + (lim.ok ? '' : waitText(lim.waitMs)));
  const ok = (await useTotp(u.id, code, { setup: opts.setup })) || (!!opts.recovery && (await useRecoveryCode(u.id, code)));
  if (ok) await clearFailures(key); else await recordAttempt(key, false, await requestIp());
  need(ok, wrong);
};

const mergePrefs = async (userId: string, patch: Record<string, unknown>) => {
  const u = await db.user.findUnique({ where: { id: userId } });
  const p = { ...((u?.prefs as Record<string, unknown>) || {}), ...patch };
  await db.user.update({ where: { id: userId }, data: { prefs: p as object } });
  return p;
};

export const userActions: Record<string, Action> = {
  theme: async ({ u, p }) => {
    const themes = ['lilac', 'ocean', 'forest', 'sunset', 'graphite'];
    await db.user.update({ where: { id: u.id }, data: { theme: themes.includes(p.theme) ? p.theme : 'lilac', mode: p.mode === 'dark' ? 'dark' : 'light' } });
  },
  alertsRead: async ({ u, p }) => {
    const prev = ((u.prefs as Record<string, unknown>)?.readAlerts as string[]) || [];
    const ids = Array.isArray(p.ids) ? p.ids.map(String) : [];
    await mergePrefs(u.id, { readAlerts: Array.from(new Set(prev.concat(ids))).slice(-500) });
  },
  prefs: async ({ u, p }) => {
    const allowed = ['loansHeroCards', 'accountsHeroCards', 'loanHeroCards', 'alerts', 'missDays', 'revLead'];
    const patch: Record<string, unknown> = {};
    for (const k of allowed) if (k in p) patch[k] = p[k];
    await mergePrefs(u.id, patch);
  },
  setName: async ({ u, p }) => {
    const name = str(p.name, 60);
    need(name, 'Enter a name.');
    await db.user.update({ where: { id: u.id }, data: { displayName: name } });
  },
  setPhoto: async ({ u, p }) => { await db.user.update({ where: { id: u.id }, data: { photo: img(p.photo) } }); },
  /** There is no mail server on a home install, so the sign-in email changes straight away after the password is checked. */
  changeEmail: async ({ u, p }) => {
    const email = str(p.email, 120).toLowerCase();
    need(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'Enter a valid email address.');
    await ownPassword(u, p.password, 'That password is not right.');
    need(!(await db.user.count({ where: { email, id: { not: u.id } } })), 'Another account on this server uses that email.');
    await db.user.update({ where: { id: u.id }, data: { email, pendingEmail: null, emailToken: null } });
  },
  changePassword: async ({ u, p }) => {
    await ownPassword(u, p.cur, 'Your current password is not right.');
    const nw = String(p.nw || '');
    need(nw.length >= 12, 'The new password needs at least 12 characters.');
    need(nw !== p.cur, 'Choose a password you have not used here.');
    await db.user.update({ where: { id: u.id }, data: { passwordHash: await hashPassword(nw) } });
    await mergePrefs(u.id, { pwChanged: new Date().toISOString() });
    // a new password signs out every other device, so a password that leaked stops working everywhere at once
    await db.session.deleteMany({ where: { userId: u.id, id: { not: u.sessionId } } });
  },
  tfaStart: async ({ u }) => {
    need(!u.totpOn, 'Two-step verification is already on.');
    const secret = await newSecret();
    await db.user.update({ where: { id: u.id }, data: { totpSecret: enc(secret) } });
    return { secret, uri: otpUri(secret, u.email) };
  },
  tfaVerify: async ({ u, p }) => {
    const fresh = await db.user.findUnique({ where: { id: u.id } });
    need(fresh?.totpSecret, 'Start the set-up again.');
    await ownCode(u, str(p.code).replace(/\s/g, ''), 'That code did not match. Check the time on your phone and try the newest code.', { setup: true });
    await db.user.update({ where: { id: u.id }, data: { totpOn: true } });
    await mergePrefs(u.id, { tfaOn: new Date().toISOString() });
    return { codes: await freshCodes(u.id) };
  },
  tfaCodes: async ({ u, p }) => {
    need(u.totpOn && u.totpSecret, 'Two-step verification is off.');
    await ownCode(u, str(p.code).replace(/\s/g, ''), 'That code did not match. Enter the newest code from your app.');
    return { codes: await freshCodes(u.id) };
  },
  tfaOff: async ({ u, p }) => {
    need(u.totpOn && u.totpSecret, 'Two-step verification is already off.');
    const code = str(p.code).replace(/\s/g, '');
    await ownCode(u, code, 'That code did not match. Enter the newest code from your app, or a recovery code.', { recovery: true });
    await db.user.update({ where: { id: u.id }, data: { totpOn: false, totpSecret: null, recoveryCodes: [] } });
  },
  signOutSession: async ({ u, p }) => {
    need(str(p.id) !== u.sessionId, 'Use Log out to sign out of this device.');
    await db.session.deleteMany({ where: { userId: u.id, id: str(p.id) } });
  },
  signOutOthers: async ({ u }) => { await db.session.deleteMany({ where: { userId: u.id, id: { not: u.sessionId } } }); },
  leaveHousehold: async ({ u, p }) => {
    const m = await db.membership.findFirst({ where: { userId: u.id, householdId: str(p.id), removedAt: null } });
    need(m, 'You are not in that household.');
    if (m!.role === 'OWNER') need(await db.membership.count({ where: { householdId: m!.householdId, removedAt: null, role: 'OWNER', userId: { not: u.id } } }), 'You are the only owner. Make someone else an owner first, or delete the household.');
    await db.membership.update({ where: { id: m!.id }, data: { removedAt: new Date() } });
    if (u.currentHouseholdId === m!.householdId) {
      const next = await db.membership.findFirst({ where: { userId: u.id, removedAt: null, household: { deletedAt: null } } });
      await db.user.update({ where: { id: u.id }, data: { currentHouseholdId: next?.householdId || null } });
    }
  },
  switchHousehold: async ({ u, p }) => {
    const m = await db.membership.findFirst({ where: { userId: u.id, householdId: str(p.id), removedAt: null } });
    need(m, 'You are not in that household.');
    await db.user.update({ where: { id: u.id }, data: { currentHouseholdId: m!.householdId } });
  }
};
export { mergePrefs };
