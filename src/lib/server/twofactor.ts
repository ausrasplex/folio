import { generateSecret, generateURI, verify } from 'otplib';
import { db } from './db';
import { dec, enc, sha256, token } from './crypto';

export async function newSecret() { return generateSecret(); }
export function otpUri(secret: string, email: string) { return generateURI({ secret, label: email, issuer: 'Folio' }); }

export async function checkCode(secret: string, code: string) {
  if (!/^\d{6}$/.test(code)) return false;
  try { const r = await verify({ secret, token: code }); return !!(r && r.valid); } catch { return false; }
}

export async function checkTotp(userId: string, code: string) {
  const u = await db.user.findUnique({ where: { id: userId } });
  if (!u || !u.totpOn || !u.totpSecret) return false;
  return checkCode(dec(u.totpSecret), code);
}

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
