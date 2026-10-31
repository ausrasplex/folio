import { describe, expect, it } from 'vitest';
import { chargeDay, engineInterest, type Read } from './importer';
import { rateInEffect } from './imports';

// A statement shaped like a Bank of Melbourne one: 12 January to 11 April, interest charged on the 10th of each month.
const DAY = 86400000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const t0 = Date.UTC(2026, 0, 12), tEnd = Date.UTC(2026, 3, 11);

/** The interest the bank would charge, worked out day by day: accrue each day at that day's rate, add it to the
 *  balance on the 10th. Counting starts the day after the 10 January charge. */
function bankInterest(rateOn: (t: number) => number, opening: number) {
  let bal = opening, pending = 0, total = 0;
  const charges: { date: string; amount: number }[] = [];
  for (let t = Date.UTC(2026, 0, 11); t <= tEnd; t += DAY) {
    pending += bal * rateOn(t) / 100 / 365;
    if (new Date(t).getUTCDate() === 10) { const amt = Math.round(pending * 100) / 100; bal += amt; total += amt; charges.push({ date: iso(t), amount: amt }); pending = 0; }
  }
  return { total: Math.round(total * 100) / 100, charges };
}
function statement(rateOn: (t: number) => number, lines: { date: string; rate: number }[]): Read {
  const bank = bankInterest(rateOn, 400000);
  const txns = [
    ...lines.map((l) => ({ date: l.date, description: (l.date === iso(t0) ? 'Opening Balance Interest Rate ' : 'INTEREST RATE CHANGE TO ') + l.rate + '% PA', debit: 0, credit: 0, balance: null, rate: l.rate })),
    ...bank.charges.map((c) => ({ date: c.date, description: 'INTEREST', debit: c.amount, credit: 0, balance: null, rate: null }))
  ].sort((a, b) => (a.date < b.date ? -1 : 1));
  return { period: { start: iso(t0), end: iso(tEnd) }, opening: 400000, closing: 400000 + bank.total, interest: bank.total, txns } as unknown as Read;
}
const feb17 = Date.UTC(2026, 1, 17);
const steps = (t: number) => (t >= feb17 ? 5.5 : 5);

describe('interest check', () => {
  it('finds the day the bank charges interest from the statement itself', () => {
    expect(chargeDay(statement(steps, [{ date: iso(t0), rate: 5 }, { date: '2026-02-17', rate: 5.5 }]))).toBe(10);
  });
  it('uses each day\'s own rate when the rate changes partway through', () => {
    const read = statement(steps, [{ date: iso(t0), rate: 5 }, { date: '2026-02-17', rate: 5.5 }]);
    expect(engineInterest(read, { rateAt: () => 9.99, confirmed: [] })).toBe(read.interest);
  });
  it('counts the first charge from the day after the previous one, not from the statement\'s first day', () => {
    // with the old window (posting on the statement's last day, counting from its first) it came out wrong
    const read = statement(steps, [{ date: iso(t0), rate: 5 }, { date: '2026-02-17', rate: 5.5 }]);
    expect(engineInterest(read, { rateAt: () => 5, confirmed: [], postingDay: 11 })).not.toBe(read.interest);
    expect(engineInterest(read, { rateAt: () => 5, confirmed: [], postingDay: 10 })).toBe(read.interest);
  });
  it('applies a rate change confirmed in Folio even when the statement does not print it', () => {
    const read = statement(steps, [{ date: iso(t0), rate: 5 }]); // no line for the 17 February change
    expect(engineInterest(read, { rateAt: () => 5, confirmed: [] })).not.toBe(read.interest);
    expect(engineInterest(read, { rateAt: (d) => (d >= '2026-02-17' ? 5.5 : 5), confirmed: [{ date: '2026-02-17', rate: 5.5 }] })).toBe(read.interest);
  });
  it("uses the loan's usual charge day for a statement with no charges of its own", () => {
    // a statement before the loan was drawn: no interest lines, the money arrives on 11 April
    const read = { period: { start: '2026-01-12', end: '2026-04-14' }, opening: 0, closing: 400000, interest: 0,
      txns: [{ date: '2026-04-11', description: 'LOAN DRAWDOWN', debit: 400000, credit: 0, balance: null, rate: null }] } as unknown as Read;
    expect(engineInterest(read, { rateAt: () => 5, confirmed: [] })).toBeGreaterThan(0); // last resort: the 14th, wrongly charging 4 days
    expect(engineInterest(read, { rateAt: () => 5, confirmed: [], usualDay: 10 })).toBe(0);
  });
  it('without an opening rate line, starts from the rate Folio knows for those days', () => {
    const read = statement(() => 5, []);
    expect(engineInterest(read, { rateAt: () => 5, confirmed: [] })).toBe(read.interest);
  });
});

describe('the rate in effect on a day', () => {
  const known = [{ date: new Date('2025-08-11'), rate: 5.66 }, { date: new Date('2026-02-17'), rate: 5.91 }];
  it('is the latest change on or before it, else the loan\'s own rate', () => {
    expect(rateInEffect(2.24, known, new Date('2025-01-01'))).toBe(2.24);
    expect(rateInEffect(2.24, known, new Date('2025-08-11'))).toBe(5.66);
    expect(rateInEffect(2.24, known, new Date('2026-03-01'))).toBe(5.91);
  });
});
