import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';

let key: Buffer | null = null;
function k() {
  if (!key) {
    const s = process.env.FOLIO_SECRET;
    if (!s || s.length < 16) throw new Error('FOLIO_SECRET is missing or shorter than 16 characters. Set it in .env');
    key = scryptSync(s, 'folio-at-rest', 32);
  }
  return key;
}

/** Encrypts short secrets (account numbers, two-step keys). Output: v1:<iv>:<tag>:<data> in base64. */
export function enc(plain: string | null | undefined): string | null {
  if (plain == null || plain === '') return null;
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', k(), iv);
  const data = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

export function dec(blob: string | null | undefined): string {
  if (!blob) return '';
  if (!blob.startsWith('v1:')) return blob;
  try {
    const [, iv, tag, data] = blob.split(':');
    const d = createDecipheriv('aes-256-gcm', k(), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
  } catch {
    return '';
  }
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const token = (n = 24) => randomBytes(n).toString('base64url');
