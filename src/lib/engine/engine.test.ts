import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { allocateOffset, forecast, runDaily, utcDay, type SplitInput } from './index';

const variable = (id: string, balance: number, rate: number): SplitInput => ({
  id, name: id, kind: 'VARIABLE', balance, rates: [{ from: utcDay(2020, 1, 1), rate }]
});

describe('daily interest', () => {
  it('accrues daily and posts once, rounded half up, on the posting day', () => {
    // 100,000 at 3.65% on a 365-day basis is exactly $10.00 a day.
    const r = runDaily({ splits: [variable('s1', 100000, 3.65)], postingDay: 10 }, utcDay(2026, 1, 11), utcDay(2026, 2, 10));
    expect(r.postings).toHaveLength(1);
    expect(r.postings[0].amount.toFixed(2)).toBe('310.00'); // 31 days, 11 Jan to 10 Feb inclusive
    expect(r.balances.s1.toFixed(2)).toBe('100310.00');
  });

  it('charges interest only on the balance minus the offset', () => {
    const r = runDaily({ splits: [variable('s1', 100000, 3.65)], offset: () => 50000, postingDay: 10 }, utcDay(2026, 1, 11), utcDay(2026, 2, 10));
    expect(r.postings[0].amount.toFixed(2)).toBe('155.00');
  });

  it('applies a repayment before accruing that day', () => {
    const r = runDaily({
      splits: [variable('s1', 100000, 3.65)],
      movements: [{ date: utcDay(2026, 1, 11), splitId: 's1', amount: 50000 }],
      postingDay: 10
    }, utcDay(2026, 1, 11), utcDay(2026, 2, 10));
    expect(r.postings[0].amount.toFixed(2)).toBe('155.00');
  });
});

describe('offset allocation', () => {
  const fixed: SplitInput = { id: 'f', name: 'f', kind: 'FIXED', fixedUntil: utcDay(2027, 3, 14), balance: 50000, rates: [{ from: utcDay(2020, 1, 1), rate: 5.19 }] };

  it('gives fixed splits no offset until they roll to variable', () => {
    const splits = [variable('v', 20000, 6.16), fixed];
    const bal = { v: new Decimal(20000), f: new Decimal(50000) };
    const before = allocateOffset(splits, bal, 80000, utcDay(2026, 10, 1));
    expect(before.v.toNumber()).toBe(20000); // capped at the split's balance
    expect(before.f.toNumber()).toBe(0);
    const after = allocateOffset(splits, bal, 80000, utcDay(2027, 3, 14));
    expect(after.f.toNumber()).toBe(50000); // leftover spills to the next eligible split
  });

  it('fills splits in the given order when listed, spilling the rest to the next', () => {
    // two $50,000 splits and a $60,000 offset: the first listed is covered, $10,000 spills to the other
    const a = variable('a', 50000, 5.66), b = variable('b', 50000, 6.16);
    const bal = { a: new Decimal(50000), b: new Decimal(50000) };
    const listed = allocateOffset([a, b], bal, 60000, utcDay(2026, 10, 1), 'listed');
    expect([listed.a.toNumber(), listed.b.toNumber()]).toEqual([50000, 10000]);
    const byRate = allocateOffset([a, b], bal, 60000, utcDay(2026, 10, 1));
    expect([byRate.a.toNumber(), byRate.b.toNumber()]).toEqual([10000, 50000]);
    // once the first is paid off, the whole offset goes to the other
    const later = allocateOffset([a, b], { a: new Decimal(0), b: new Decimal(50000) }, 60000, utcDay(2026, 10, 1), 'listed');
    expect([later.a.toNumber(), later.b.toNumber()]).toEqual([0, 50000]);
  });
});

describe('forecast', () => {
  const base = {
    start: utcDay(2026, 10, 26),
    postingDay: 10,
    splits: [{ ...variable('s1', 247500, 6.16), repayment: 413, frequency: 'WEEKLY' as const, weekday: 4 }]
  };

  it('pays the loan off and reports total interest', () => {
    const r = forecast(base);
    expect(r.payoffDate).not.toBeNull();
    expect(r.totalInterest.gt(0)).toBe(true);
  });

  it('pays off sooner with an offset and with extra repayments', () => {
    const plain = forecast(base).payoffDate!.getTime();
    expect(forecast({ ...base, offset: 82400 }).payoffDate!.getTime()).toBeLessThan(plain);
    expect(forecast({ ...base, extra: 100 }).payoffDate!.getTime()).toBeLessThan(plain);
  });

  it("records each split's balance and the day each one is paid off", () => {
    const small = { ...variable('s2', 20000, 6.16), repayment: 413, frequency: 'WEEKLY' as const, weekday: 4 };
    const r = forecast({ ...base, splits: [...base.splits, small] });
    for (const p of r.points) expect(Math.abs(p.splits.s1 + p.splits.s2 - p.balance)).toBeLessThan(0.01);
    expect(r.splitPayoffs.s2.getTime()).toBeLessThan(r.splitPayoffs.s1.getTime());
    expect(r.splitPayoffs.s1.getTime()).toBe(r.payoffDate!.getTime());
  });
});
