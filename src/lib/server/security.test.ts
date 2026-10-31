import { beforeEach, describe, expect, it, vi } from 'vitest';

// an in-memory SecurityEvent table, and a database that can be made to fail
const events: { kind: string; userId: string | null; ip: string | null; detail: Record<string, unknown>; at: Date }[] = [];
let broken = false;
let paused = false;
vi.mock('./db', () => ({
  db: { securityEvent: {
    create: async ({ data }: { data: { kind: string; userId: string | null; ip: string | null; detail: Record<string, unknown> } }) => { if (broken) throw new Error('database down'); events.push({ ...data, at: new Date() }); },
    deleteMany: async ({ where }: { where: { at: { lt: Date } } }) => { for (let i = events.length - 1; i >= 0; i--) if (events[i].at < where.at.lt) events.splice(i, 1); }
  } }
}));
vi.mock('./auth', () => ({ requestIp: async () => '192.168.7.42' }));
vi.mock('./ratelimit', () => ({ passwordLimit: async () => (paused ? { ok: false, waitMs: 120000 } : { ok: true }) }));

import { eventDetail, logEvent, logWrongPassword, pruneEvents, SECURITY_TITLES } from './security';

beforeEach(() => { events.length = 0; broken = false; paused = false; });

describe('the security log', () => {
  it('records an event with the request address', async () => {
    await logEvent('signin', { userId: 'u1' });
    expect(events).toMatchObject([{ kind: 'signin', userId: 'u1', ip: '192.168.7.42' }]);
  });
  it('never stops the thing it records, even when the database fails', async () => {
    broken = true;
    await expect(logEvent('password_changed', { userId: 'u1' })).resolves.toBeUndefined();
  });
  it('logs a wrong password, and the pause only when one starts', async () => {
    await logWrongPassword('alex@folio.local', 'u1', '203.0.113.9');
    expect(events.map((e) => e.kind)).toEqual(['signin_failed']);
    paused = true;
    await logWrongPassword('alex@folio.local', 'u1', '203.0.113.9');
    expect(events.map((e) => e.kind)).toEqual(['signin_failed', 'signin_failed', 'signin_paused']);
    expect(events[2].detail).toEqual({ email: 'alex@folio.local', minutes: 2 });
  });
  it('drops events older than 180 days', async () => {
    await logEvent('signin', { userId: 'u1' });
    events.push({ kind: 'signin', userId: 'u1', ip: null, detail: {}, at: new Date(Date.now() - 181 * 86400000) });
    await pruneEvents();
    expect(events).toHaveLength(1);
  });
  it('describes each kind of event in words', () => {
    expect(SECURITY_TITLES.signin_paused).toBe('Sign-in paused after wrong passwords');
    expect(eventDetail('signin_paused', { email: 'a@b.co', minutes: 1 })).toBe('For a@b.co. Waiting 1 minute');
    expect(eventDetail('email_changed', { from: 'a@b.co', to: 'c@d.co' })).toBe('a@b.co to c@d.co');
    expect(eventDetail('password_changed', { signedOut: 2 })).toBe('2 other devices signed out');
    expect(eventDetail('settings', { changed: ['requireTwoStep', 'backups'] })).toBe('Require two-step verification, Backups');
    expect(eventDetail('backup', { auto: true, name: 'folio-backup.folio' })).toBe('Automatic: folio-backup.folio');
    expect(eventDetail('signin', { twoStep: true })).toBe('With two-step verification');
  });
});
