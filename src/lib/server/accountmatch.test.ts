import { describe, expect, it } from 'vitest';
import { byAccount } from './imports';

// two loans at the same bank, each with a 01 and a 02 split, and a savings account
const dests = [
  { kind: 'split', id: 'a1', loanId: 'A', suffix: '01', number: '3112335939' },
  { kind: 'split', id: 'a2', loanId: 'A', suffix: '02', number: '3112335939' },
  { kind: 'split', id: 'b1', loanId: 'B', suffix: '01', number: '3119990001' },
  { kind: 'split', id: 'b2', loanId: 'B', suffix: '02', number: '3119990001' },
  { kind: 'split', id: 'c1', loanId: 'C', suffix: '01', number: '' },
  { kind: 'account', id: 'sav', loanId: '' }
];
const ids = (acct: string) => byAccount(dests, acct).hits.map((d) => d.id);

describe('matching a statement by its account number', () => {
  it("picks the loan by its number, then the split by its suffix", () => {
    expect(ids('311 2335939 01')).toEqual(['a1']);
    expect(ids('311-2335939-02')).toEqual(['a2']);
    expect(ids('311 9990001 02')).toEqual(['b2']);
    expect(byAccount(dests, '311 2335939 02').byNumber).toBe(true);
    // the loan number typed with the first split's suffix still finds the other split
    const typed = dests.map((d) => (d.loanId === 'A' ? { ...d, number: '311233593901' } : d));
    expect(byAccount(typed, '311 2335939 02').hits.map((d) => d.id)).toEqual(['a2']);
  });
  it('falls back to the suffix alone for loans with no number on file', () => {
    expect(ids('555 0000000 01')).toEqual(['c1']);
  });
  it('ignores accounts and statements without an account number', () => {
    expect(ids('')).toEqual([]);
    expect(ids('311 2335939 07')).toEqual(['a1', 'a2']); // the loan is known, the split is not
  });
});
