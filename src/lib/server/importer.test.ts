import { describe, expect, it } from 'vitest';
import { datesIn, moneyIn, parseCsv, rateIn, readCsv } from './importer';

describe('moneyIn', () => {
  it('reads plain, comma and signed amounts', () => {
    expect(moneyIn('1800.00')).toBe(1800);
    expect(moneyIn('235,921.26')).toBe(235921.26);
    expect(moneyIn('$1,007.42')).toBe(1007.42);
    expect(moneyIn('-62.40')).toBe(-62.4);
    expect(moneyIn('(71.25)')).toBe(-71.25);
    expect(moneyIn('384.00 DR')).toBe(-384);
    expect(moneyIn('12345')).toBe(12345);
    expect(moneyIn('')).toBeNull();
  });
});

describe('datesIn and rateIn', () => {
  it('reads common date shapes', () => {
    expect(datesIn('12/02/2026 to 11/08/2026')).toEqual(['2026-02-12', '2026-08-11']);
    expect(datesIn('10 Apr 2026')).toEqual(['2026-04-10']);
  });
  it('reads a rate from a rate-change line', () => {
    expect(rateIn('INTEREST RATE CHANGE TO 5.91% PA')).toBe(5.91);
  });
});

describe('readCsv', () => {
  it('reads an account export and checks it adds up', () => {
    const rows = parseCsv('Date,Narrative,Debit,Credit,Balance\n01/09/2026,Opening transfer,,500.00,500.00\n05/09/2026,Woolworths,62.40,,437.60\n12/09/2026,Pay,,1800.00,2237.60\n');
    const r = readCsv(rows, { cols: ['date', 'desc', 'debit', 'credit', 'balance'], dateFmt: 'dmy', header: rows[0] }, 'account');
    expect(r.txns).toHaveLength(3);
    expect(r.closing).toBe(2237.6);
    expect(r.ok).toBe(true);
  });
  it('turns newest-first exports around', () => {
    const rows = parseCsv('Date,Narrative,Amount,Balance\n12/09/2026,Pay,1800.00,2237.60\n05/09/2026,Woolworths,-62.40,437.60\n01/09/2026,Opening,500.00,500.00\n');
    const r = readCsv(rows, { cols: ['date', 'desc', 'amount', 'balance'], dateFmt: 'dmy', header: rows[0] }, 'account');
    expect(r.txns[0].date).toBe('2026-09-01');
    expect(r.ok).toBe(true);
  });
});
