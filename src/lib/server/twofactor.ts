import { generateSecret, generateURI, verify } from 'otplib';
import { db } from './db';
import { dec, enc, sha256, token } from './crypto';

export async function newSecret() { return generateSecret(); }
export function otpUri(secret: string, email: string) { return generateURI({ secret, label: email, issuer: 'Folio' }); }

/** Checks a 6-digit code. A code from a time step at or before afterTimeStep is refused (already used).
 *  Returns the code's time step when it is good, else null. */
export async function checkCode(secret: string, code: string, afterTimeStep?: number | null) {
  if (!/^\d{6}$/.test(code)) return null;
  try {
    const r = await verify({ secret, token: code, ...(afterTimeStep != null ? { afterTimeStep } : {}) });
    return r && r.valid && 'timeStep' in r ? (r as { timeStep: number }).timeStep : null;
  } catch { return null; }
}

const lastStep = (prefs: unknown) => { const n = Number((prefs as { totpLastStep?: unknown } | null)?.totpLastStep); return Number.isFinite(n) ? n : null; };

/** Checks a code against someone's secret (their current one, or the one being set up) and, when it is good,
 *  remembers its time step so the same code cannot be used again in its 30 seconds. */
export async function useTotp(userId: string, code: string, opts: { setup?: boolean } = {}) {
  const u = await db.user.findUnique({ where: { id: userId } });
  if (!u || !u.totpSecret || (!opts.setup && !u.totpOn)) return false;
  const step = await checkCode(dec(u.totpSecret), code, lastStep(u.prefs));
  if (step == null) return false;
  await db.user.update({ where: { id: userId }, data: { prefs: { ...((u.prefs as Record<string, unknown>) || {}), totpLastStep: step } } });
  return true;
}

export const checkTotp = (userId: string, code: string) => useTotp(userId, code);

export function makeRecoveryCodes() { return Array.from({ length: 8 }, () => token(6).replace(/[^A-Za-z0-9]/g, 'x').slice(0, 4).toUpperCase() + '-' + token(6).replace(/[^A-Za-z0-9]/g, 'x').slice(0, 4).toUpperCase()); }

export async function useRecoveryCode(userId: string, code: string) {
  const u = await db.user.findUnique({ where: { id: userId } });
  const list = (u?.recoveryCodes as string[] | null) || [];
  const h = sha256(code.toUpperCase());
  if (!list.includes(h)) return false;
  await db.user.update({ where: { id: userId }, data: { recoveryCodes: list.filter((x) => x !== h) } });
  return true;
}

export { enc };
