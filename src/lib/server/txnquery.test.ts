import { describe, expect, it } from 'vitest';
import { queryTxns, type TxnRow } from './txnquery';
import type { RuleRow } from './categories';

const row = (id: string, date: string, description: string, debit: number, credit = 0, category: string | null = null): TxnRow => ({ id, date, description, debit, credit, balance: null, category, accountId: 'a1', statementId: 's1' });
const rows = [
  row('1', '2025-10-18', 'WOOLWORTHS 3342 MELBOURNE', 82.1),
  row('2', '2025-10-21', 'VISA PURCHASE PAYPAL *ADOBESYSTEM', 14.29),
  row('3', '2025-10-22', 'JC SERVICES AUST PAY', 0, 4709.9),
  row('4', '2026-01-05', 'COLES EXPRESS', 40),
  row('5', '2026-01-09', 'INTERNET WITHDRAWAL 09JAN Loan Variable', 400),
  row('6', '2026-01-10', 'SUPERLOOP 1116744', 95, 0, 'Bills')
];
const rules: RuleRow[] = [{ id: 'r1', category: 'Software', terms: 'adobe', match: 'contains', direction: 'out', amountMin: null, amountMax: null, accountId: null, priority: 1, enabled: true }];
const own = [{ name: 'Software', kind: 'spend' }, { name: 'Bills', kind: 'spend' }];
const ids = (r: ReturnType<typeof queryTxns>) => r.rows.map((t) => t.id);

describe('searching and filtering transactions', () => {
  it('lists newest first and works out each category', () => {
    const r = queryTxns(rows, rules, own, {});
    expect(ids(r)).toEqual(['6', '5', '4', '3', '2', '1']);
    expect(r.rows.find((t) => t.id === '2')).toMatchObject({ cat: 'Software', catBy: 'rule' });
    expect(r.rows.find((t) => t.id === '6')).toMatchObject({ cat: 'Bills', catBy: 'you' });
    expect(r.years).toEqual(['2026', '2025']);
  });
  it('filters by money in or out, year and month, category and amount', () => {
    expect(ids(queryTxns(rows, rules, own, { dir: 'in' }))).toEqual(['3']);
    expect(ids(queryTxns(rows, rules, own, { dir: 'out', year: '2025' }))).toEqual(['2', '1']);
    expect(ids(queryTxns(rows, rules, own, { year: '2026', month: '1', cat: 'Groceries' }))).toEqual(['4']);
    expect(ids(queryTxns(rows, rules, own, { min: 50, max: 100 }))).toEqual(['6', '1']);
  });
  it('searches the description, or an amount', () => {
    expect(ids(queryTxns(rows, rules, own, { q: 'coles' }))).toEqual(['4']);
    expect(ids(queryTxns(rows, rules, own, { q: '14.29' }))).toEqual(['2']);
    expect(ids(queryTxns(rows, rules, own, { q: '$4,709.90' }))).toEqual(['3']);
  });
  it('totals the matches, and sums spending by category without income or transfers', () => {
    const r = queryTxns(rows, rules, own, {});
    expect([r.sumIn, r.sumOut]).toEqual([4709.9, 631.39]);
    expect(r.byCat).toEqual([['Groceries', 122.1], ['Bills', 95], ['Software', 14.29]]);
  });
});

describe('transactions not categorised yet', () => {
  it('are the ones with only the built-in suggestion: not chosen by hand and not from a rule', () => {
    const r = queryTxns(rows, rules, own, { cat: '__auto' });
    expect(ids(r)).toEqual(['5', '4', '3', '1']); // 6 was chosen by hand, 2 has a rule
    expect(queryTxns(rows, rules, own, {}).uncategorised).toBe(4);
  });
});
