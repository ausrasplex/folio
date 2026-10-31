import { describe, expect, it, vi } from 'vitest';
import { generate, generateSecret } from 'otplib';

// one person in place of the database; their secret is stored encrypted like the real thing
const person: { id: string; totpOn: boolean; totpSecret: string | null; prefs: Record<string, unknown> } = { id: 'u1', totpOn: true, totpSecret: null, prefs: {} };
vi.mock('./db', () => ({
  db: { user: {
    findUnique: async () => ({ ...person }),
    update: async ({ data }: { data: { prefs: Record<string, unknown> } }) => { person.prefs = data.prefs; }
  } }
}));
process.env.FOLIO_SECRET = process.env.FOLIO_SECRET || 'a-test-secret-that-is-long-enough';

import { enc } from './crypto';
import { checkCode, useTotp } from './twofactor';

describe('two-step codes', () => {
  it('accepts a good code and gives its time step', async () => {
    const secret = await generateSecret();
    const code = await generate({ secret });
    expect(await checkCode(secret, code)).toBe(Math.floor(Date.now() / 1000 / 30));
    expect(await checkCode(secret, '000000')).toBeNull();
    expect(await checkCode(secret, 'abc123')).toBeNull();
  });
  it('refuses a code from a time step already used', async () => {
    const secret = await generateSecret();
    const code = await generate({ secret });
    const step = await checkCode(secret, code);
    expect(await checkCode(secret, code, step)).toBeNull();
    expect(await checkCode(secret, code, (step as number) - 1)).toBe(step);
  });
  it('remembers the last accepted step, so the same code cannot sign in twice', async () => {
    const secret = await generateSecret();
    person.totpSecret = enc(secret);
    person.prefs = { theme: 'lilac' };
    const code = await generate({ secret });
    expect(await useTotp('u1', code)).toBe(true);
    expect(person.prefs.totpLastStep).toBe(Math.floor(Date.now() / 1000 / 30));
    expect(person.prefs.theme).toBe('lilac'); // other preferences are kept
    expect(await useTotp('u1', code)).toBe(false);
  });
  it('only checks a code being set up when asked to', async () => {
    const secret = await generateSecret();
    Object.assign(person, { totpOn: false, totpSecret: enc(secret), prefs: {} });
    const code = await generate({ secret });
    expect(await useTotp('u1', code)).toBe(false);
    expect(await useTotp('u1', code, { setup: true })).toBe(true);
  });
});
