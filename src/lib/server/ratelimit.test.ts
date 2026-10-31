import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// an in-memory LoginAttempt table in place of the database
const rows: { key: string; ok: boolean; at: Date; ip: string | null }[] = [];
vi.mock('./db', () => ({
  db: {
    loginAttempt: {
      findMany: async ({ where }: { where: { key: string; ok: boolean; at: { gt: Date } } }) => rows.filter((r) => r.key === where.key && r.ok === where.ok && r.at > where.at.gt).map((r) => ({ at: r.at })),
      create: async ({ data }: { data: { key: string; ok: boolean; ip: string | null } }) => { rows.push({ ...data, at: new Date() }); },
      deleteMany: async ({ where }: { where: { key?: string; ok?: boolean; at?: { lt: Date } } }) => {
        for (let i = rows.length - 1; i >= 0; i--) { const r = rows[i]; if ((where.key === undefined || r.key === where.key) && (where.ok === undefined || r.ok === where.ok) && (!where.at || r.at < where.at.lt)) rows.splice(i, 1); }
      }
    }
  }
}));

import { emailLimit, ipLimit, noMatchText, passwordLimit, passwordResult, pruneAttempts, waitText } from './ratelimit';

const MIN = 60000;
const T0 = new Date('2026-11-01T10:00:00Z').getTime();
let now = T0;
beforeEach(() => { rows.length = 0; now = T0; vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => { vi.useRealTimers(); });
const at = (ms: number) => { now = T0 + ms; vi.setSystemTime(now); };

// one sign-in attempt, the way the sign-in page does it
async function signIn(pw: string, ip = '203.0.113.7') {
  const lim = await passwordLimit('Alex@Folio.local', ip);
  if (!lim.ok) return 'refused';
  const ok = pw === 'the-right-password';
  await passwordResult('alex@folio.local', ip, ok);
  return ok ? 'signed in' : 'wrong';
}

describe('sign-in limits', () => {
  it('refuses the sixth try inside 15 minutes even with the right password, and allows it after the wait', async () => {
    for (let i = 0; i < 5; i++) { at(i * 1000); expect(await signIn('guess ' + i)).toBe('wrong'); }
    at(5000);
    expect(await signIn('the-right-password')).toBe('refused');
    at(4000 + MIN + 1); // one minute after the fifth failure
    expect(await signIn('the-right-password')).toBe('signed in');
  });
  it('doubles the wait with each further failure, up to 15 minutes', () => {
    const fails = (n: number) => Array.from({ length: n }, (_, i) => T0 + i);
    const wait = (n: number) => { const l = emailLimit(fails(n), T0 + n - 1); return l.ok ? 0 : Math.round(l.waitMs / MIN); };
    expect([4, 5, 6, 7, 8, 9, 12].map(wait)).toEqual([0, 1, 2, 4, 8, 15, 15]);
  });
  it('a success clears the count for that email', async () => {
    for (let i = 0; i < 4; i++) { at(i * 1000); await signIn('guess ' + i); }
    at(5000); expect(await signIn('the-right-password')).toBe('signed in');
    for (let i = 0; i < 4; i++) { at(6000 + i * 1000); expect(await signIn('again ' + i)).toBe('wrong'); }
    at(11000); expect(await signIn('the-right-password')).toBe('signed in');
  });
  it('failures older than 15 minutes no longer count', async () => {
    for (let i = 0; i < 5; i++) { at(i * 1000); await signIn('guess ' + i); }
    at(16 * MIN); expect(await signIn('the-right-password')).toBe('signed in');
  });
  it('blocks an address after thirty failures in 15 minutes, across different emails', async () => {
    const fails = Array.from({ length: 30 }, (_, i) => T0 + i * 1000);
    expect(ipLimit(fails.slice(0, 29), T0 + 29000).ok).toBe(true);
    const l = ipLimit(fails, T0 + 30000);
    expect(l.ok).toBe(false);
    expect(ipLimit(fails, T0 + 29000 + 15 * MIN + 1).ok).toBe(true);
  });
  it('says the same thing whatever was wrong, with the wait in whole minutes', () => {
    expect(noMatchText()).toBe("That email and password don't match.");
    expect(noMatchText('3')).toBe("That email and password don't match. Try again in 3 minutes.");
    expect(noMatchText('1')).toBe("That email and password don't match. Try again in 1 minute.");
    expect(noMatchText('9999')).toBe("That email and password don't match. Try again in 15 minutes.");
    expect(noMatchText('<script>')).toBe("That email and password don't match.");
    expect(waitText(61000)).toBe('Try again in 2 minutes.');
  });
  it('prunes attempts older than a day', async () => {
    await signIn('guess');
    at(25 * 3600000);
    await signIn('later guess');
    await pruneAttempts();
    expect(rows.every((r) => r.at.getTime() > now - 86400000)).toBe(true);
    expect(rows.length).toBe(2); // the later guess, by email and by address
  });
});
