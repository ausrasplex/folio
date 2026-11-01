import { describe, expect, it } from 'vitest';
import { datesIn, moneyIn, parseCsv, rateIn, readCsv, readPdf, type Item, type Page } from './importer';

// a two-page account statement table: date, description, debit, credit and balance columns
const COLS = { date: 6, desc: 20, debit: 60, credit: 72, balance: 85 };
function page(n: number, rows: [string, string, string, string, string][]): Page {
  const items: Item[] = [];
  rows.forEach((r, i) => (['date', 'desc', 'debit', 'credit', 'balance'] as const).forEach((k, j) => { if (r[j]) items.push({ s: r[j], x: COLS[k], y: 20 + i * 3, w: 4, h: 1.5, page: n }); }));
  return { n, items, text: items.map((x) => x.s).join(' '), wPt: 595, hPt: 842 };
}
const col = (x: number, w: number) => ({ page: 1, box: [x - 1, 15, w, 80] });
const accountMap = { table: { page: 1, box: [2, 15, 96, 80] }, cDate: col(6, 10), cDesc: col(20, 35), cDebit: col(60, 10), cCredit: col(72, 10), cBal: col(85, 12) };

describe('readPdf', () => {
  it("skips a page's sub total carried forward, at its foot and at the top of the next page", () => {
    const pages = [
      page(1, [['14 May 2026', 'LOAN REPAYMENT', '404.00', '', '41,678.20'], ['14 May 2026', 'STSolarVic', '29.17', '', '41,649.03'], ['', 'SUB TOTAL CARRIED FORWARD TO NEXT PAGE', '', '', '41,649.03']]),
      page(2, [['', 'SUB TOTAL CARRIED FORWARD FROM PREVIOUS PAGE', '', '', '41,649.03'], ['14 May 2026', 'SUPERLOOP', '95.00', '', '41,554.03'], ['31 May 2026', 'CLOSING BALANCE', '', '', '41,554.03']])
    ];
    const r = readPdf(pages, accountMap as never, 'account');
    expect(r.txns.map((t) => t.description)).toEqual(['LOAN REPAYMENT', 'STSolarVic', 'SUPERLOOP']);
    expect(r.debits).toBe(528.17);
  });
  it('splits a date and description held as one piece of text, and names a row that does not agree', () => {
    // from page 2 some PDFs hold "21 MAY LOAN REPAYMENT" as one piece, starting in the Date column
    const p: Page = { n: 1, wPt: 595, hPt: 842, text: '', items: [
      { s: '25/04/2026 to 24/10/2026', x: 1, y: 2, w: 15, h: 1.5, page: 1 },
      { s: '21 MAY LOAN REPAYMENT', x: 6, y: 20, w: 20, h: 1.5, page: 1 }, { s: '404.00', x: 60, y: 20, w: 4, h: 1.5, page: 1 }, { s: '41,274.20', x: 85, y: 20, w: 6, h: 1.5, page: 1 },
      { s: '22 MAY INTERNET DEPOSIT', x: 6, y: 23, w: 21, h: 1.5, page: 1 }, { s: '2,500.00', x: 72, y: 23, w: 5, h: 1.5, page: 1 }, { s: '43,000.00', x: 85, y: 23, w: 6, h: 1.5, page: 1 }
    ] };
    const r = readPdf([p], { ...accountMap, period: { page: 1, box: [0, 1, 20, 3] } } as never, 'account');
    expect(r.txns.map((t) => [t.date.slice(5), t.description])).toEqual([['05-21', 'LOAN REPAYMENT'], ['05-22', 'INTERNET DEPOSIT']]);
    // 41,274.20 + 2,500.00 is 43,774.20, not the 43,000.00 shown
    expect(r.checks.find((c) => /Running balance/.test(c.text))!.text).toContain('22 May INTERNET DEPOSIT: shows $43,000.00, expected $43,774.20');
  });
  it("keeps a loan's opening line when it states the rate", () => {
    const r = readPdf([page(1, [['12 Feb 2025', 'Opening Balance Interest Rate 6.350% PA', '', '', '249,546.10'], ['13 Feb 2025', 'REPAYMT A/C TFR', '', '419.00', '249,127.10']])], accountMap as never, 'loan');
    expect(r.txns.map((t) => t.rate)).toEqual([6.35, null]);
  });
  it('keeps an opening line whose rate wraps onto the next line', () => {
    const r = readPdf([page(1, [['12 Feb 2025', 'Opening Balance', '', '', '249,546.10'], ['', 'Interest Rate 6.350% PA', '', '', ''], ['13 Feb 2025', 'REPAYMT A/C TFR', '', '419.00', '249,127.10']])], accountMap as never, 'loan');
    expect(r.txns.map((t) => t.rate)).toEqual([6.35, null]);
  });
});

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
