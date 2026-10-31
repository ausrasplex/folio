import { beforeEach, describe, expect, it, vi } from 'vitest';

// a loan split, its first statement and its rate changes, in place of the database
type Change = { id: string; splitId: string; effectiveDate: Date; rate: number; confirmed: boolean; source: string; deletedAt: Date | null };
let split: { id: string; startRate: number; startRateFrom: string | null; deletedAt: null };
let firstStatement: { periodStart: Date; txns: { date: Date; rate: number | null }[] } | null;
let changes: Change[];
vi.mock('./db', () => ({
  db: {
    loanSplit: {
      findMany: async ({ where }: { where: { startRateFrom: null } }) => (split.startRateFrom === where.startRateFrom ? [split] : []),
      findUnique: async () => ({ ...split, rateChanges: changes.filter((c) => !c.deletedAt).sort((a, b) => +a.effectiveDate - +b.effectiveDate) })
    },
    statement: { findFirst: async () => firstStatement },
    rateChange: { updateMany: async ({ where }: { where: { id: { in: string[] } } }) => { for (const c of changes) if (where.id.in.includes(c.id)) c.deletedAt = new Date(); } }
  }
}));

import { startRateOffers, tidyRateRepeats } from './rates';

const D = (s: string) => new Date(s + 'T00:00:00Z');
const change = (id: string, date: string, rate: number, confirmed = false, source = 'statement'): Change => ({ id, splitId: 's1', effectiveDate: D(date), rate, confirmed, source, deletedAt: null });
beforeEach(() => {
  split = { id: 's1', startRate: 6.41, startRateFrom: null, deletedAt: null };
  firstStatement = { periodStart: D('2020-10-12'), txns: [{ date: D('2020-10-12'), rate: 2.24 }] };
  changes = [];
});

describe('the starting rate', () => {
  it('offers the rate the first statement opens at when it differs from the one typed in', async () => {
    expect((await startRateOffers(['s1'])).get('s1')).toEqual({ rate: 2.24, from: '2020-10-12', current: 6.41 });
  });
  it('offers nothing once the person has chosen, or when the rates already agree', async () => {
    split.startRateFrom = 'kept';
    expect((await startRateOffers(['s1'])).size).toBe(0);
    split.startRateFrom = null; split.startRate = 2.24;
    expect((await startRateOffers(['s1'])).size).toBe(0);
  });
  it('only looks at a rate the statement opens at, not a change later in it', async () => {
    firstStatement = { periodStart: D('2020-10-12'), txns: [{ date: D('2021-03-01'), rate: 2.5 }] };
    expect((await startRateOffers(['s1'])).size).toBe(0);
    firstStatement = null;
    expect((await startRateOffers(['s1'])).size).toBe(0);
  });
});

describe('tidying repeated rate changes', () => {
  it('removes changes to confirm that only repeat the rate in effect, and keeps real ones', async () => {
    split.startRate = 2.24;
    changes = [change('a', '2020-10-12', 2.24), change('b', '2021-08-15', 2.24), change('c', '2025-08-12', 5.66), change('d', '2026-02-12', 5.66), change('e', '2026-10-30', 6.41, true, 'setup')];
    expect(await tidyRateRepeats('s1')).toBe(3);
    expect(changes.filter((c) => !c.deletedAt).map((c) => c.id)).toEqual(['c', 'e']);
  });
});
