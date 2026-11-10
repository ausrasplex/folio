import { describe, expect, it } from 'vitest';
import { categorize, categoryOf, kindOf, ordered, ruleMatches, type RuleRow } from './categories';

const rule = (o: Partial<RuleRow>): RuleRow => ({ id: 'r', category: 'Groceries', terms: '', match: 'contains', direction: 'any', amountMin: null, amountMax: null, accountId: null, priority: 0, enabled: true, ...o });
const out = (description: string, debit: number, accountId = 'a1') => ({ description, debit, credit: 0, accountId });

describe('category rules', () => {
  it('matches any of its words, in the way chosen', () => {
    const r = rule({ terms: 'Woolworths\nColes' });
    expect(ruleMatches(r, out('VISA PURCHASE  WOOLWORTHS 3342 MELBOURNE', 82.1))).toBe(true);
    expect(ruleMatches(r, out('COLES EXPRESS', 40))).toBe(true);
    expect(ruleMatches(r, out('ALDI STORES', 40))).toBe(false);
    expect(ruleMatches(rule({ terms: 'visa purchase', match: 'starts' }), out('VISA PURCHASE 15/10/25 PAYPAL', 14.29))).toBe(true);
    expect(ruleMatches(rule({ terms: 'superloop', match: 'equals' }), out('SUPERLOOP 1116744', 95))).toBe(false);
    expect(ruleMatches(rule({ terms: 'uber*eats', match: 'pattern' }), out('UBER *EATS HELP.UBER.COM', 31))).toBe(true);
    expect(ruleMatches(rule({ terms: 'a.b', match: 'pattern' }), out('AXB', 1))).toBe(false); // only * and ? are special
  });
  it('checks money in or out, the amount range and the account', () => {
    expect(ruleMatches(rule({ terms: 'internet', direction: 'in' }), out('INTERNET WITHDRAWAL', 400))).toBe(false);
    expect(ruleMatches(rule({ terms: '', direction: 'out', amountMin: 95, amountMax: 95 }), out('SUPERLOOP 1116744', 95))).toBe(true);
    expect(ruleMatches(rule({ terms: 'superloop', amountMax: 50 }), out('SUPERLOOP 1116744', 95))).toBe(false);
    expect(ruleMatches(rule({ terms: 'superloop', accountId: 'a2' }), out('SUPERLOOP 1116744', 95))).toBe(false);
    expect(ruleMatches(rule({ terms: 'superloop', enabled: false }), out('SUPERLOOP 1116744', 95))).toBe(false);
  });
});

describe('a transaction category', () => {
  const rules = ordered([rule({ id: 'late', terms: 'superloop', category: 'Phone and internet', priority: 2 }), rule({ id: 'first', terms: 'superloop', category: 'Bills', priority: 1 })]);
  it('is the one chosen for it, then the first rule that matches, then the built-in guess', () => {
    expect(categoryOf({ ...out('SUPERLOOP 1116744', 95), category: 'Work' }, rules)).toEqual({ name: 'Work', by: 'you' });
    expect(categoryOf(out('SUPERLOOP 1116744', 95), rules)).toEqual({ name: 'Bills', by: 'rule', ruleId: 'first' });
    expect(categoryOf(out('BUNNINGS 6342', 50), rules)).toEqual({ name: 'Household', by: 'auto' });
  });
  it('treats transfers and income apart from spending', () => {
    expect(categorize('INTERNET WITHDRAWAL 16OCT 06:02 Loan Variable', 0)).toBe('Transfers');
    expect(categorize('JC SERVICES AUST PAY', 4709.9)).toBe('Income');
    expect(kindOf('Transfers', [])).toBe('transfer');
    expect(kindOf('Holidays', [{ name: 'Holidays', kind: 'spend' }])).toBe('spend');
    expect(kindOf('Side income', [{ name: 'Side income', kind: 'income' }])).toBe('income');
  });
});

describe('category colours', () => {
  it('uses the colour chosen, else the built-in default, else one picked from the name (never grey)', async () => {
    const { colorOf, COLORS } = await import('./categories');
    expect(colorOf('Groceries', {})).toBe('green');
    expect(colorOf('Groceries', { Groceries: 'pink' })).toBe('pink');
    expect(colorOf('Groceries', { Groceries: 'not-a-colour' })).toBe('green');
    const picked = colorOf('Holidays', {});
    expect(COLORS).toContain(picked);
    expect(picked).not.toBe('grey');
    expect(colorOf('Holidays', {})).toBe(picked); // the same every time
  });
});

describe('credit card wording', () => {
  it('treats card payments as transfers, card interest as fees and refunds as not income', () => {
    expect(categorize('CC AUTO PAYMENT 4601845001092611FD', 0)).toBe('Transfers');
    expect(categorize('PAYMENT RECEIVED - THANK YOU', 500)).toBe('Transfers');
    expect(categorize('INTEREST CHARGED ON PURCHASES', 0)).toBe('Fees');
    expect(categorize('REFUND AMAZON MARKETPLACE', 44.56)).toBe('Other');
    expect(categorize('JC SERVICES AUST PAY', 4709.9)).toBe('Income');
  });
});

describe('rules with several conditions', () => {
  const t = (description: string, debit: number, credit = 0, accountId = 'a1') => ({ description, debit, credit, accountId });
  it('joins conditions with AND and OR, AND checked first', async () => {
    const { ruleMatches } = await import('./categories');
    const r = { ...rule({}), conditions: [
      { field: 'description' as const, op: 'contains', value: 'woolworths' },
      { join: 'and' as const, field: 'direction' as const, value: 'out' },
      { join: 'or' as const, field: 'description' as const, op: 'contains', value: 'coles' }
    ] };
    // (woolworths and money out) or coles
    expect(ruleMatches(r, t('WOOLWORTHS 3342', 82.1))).toBe(true);
    expect(ruleMatches(r, t('WOOLWORTHS REFUND', 0, 12))).toBe(false);
    expect(ruleMatches(r, t('COLES EXPRESS', 0, 5))).toBe(true);
    expect(ruleMatches(r, t('ALDI STORES', 40))).toBe(false);
  });
  it('checks amounts, accounts, and descriptions that must not contain words', async () => {
    const { condMatches } = await import('./categories');
    expect(condMatches({ field: 'amount', op: 'over', value: 100 }, t('X', 150))).toBe(true);
    expect(condMatches({ field: 'amount', op: 'under', value: 100 }, t('X', 150))).toBe(false);
    expect(condMatches({ field: 'amount', op: 'between', value: 50, value2: 100 }, t('X', 95))).toBe(true);
    expect(condMatches({ field: 'amount', op: 'equals', value: 14.29 }, t('X', 14.29))).toBe(true);
    expect(condMatches({ field: 'account', value: 'a2' }, t('X', 1))).toBe(false);
    expect(condMatches({ field: 'description', op: 'notContains', value: 'refund' }, t('AMAZON MARKETPLACE', 44.56))).toBe(true);
    expect(condMatches({ field: 'description', op: 'notContains', value: 'refund' }, t('AMAZON REFUND', 0, 44.56))).toBe(false);
  });
});
