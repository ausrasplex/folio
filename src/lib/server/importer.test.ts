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
  it('accepts a statement with no transactions when the balance did not change', () => {
    const summary = (closing: string): Page => ({ n: 1, wPt: 595, hPt: 842, text: '', items: [
      { s: '25/04/2026 to 24/10/2026', x: 1, y: 2, w: 15, h: 1.5, page: 1 }, { s: '1,250.00', x: 10, y: 6, w: 6, h: 1.5, page: 1 }, { s: closing, x: 40, y: 6, w: 6, h: 1.5, page: 1 }
    ] });
    const map = { ...accountMap, period: { page: 1, box: [0, 1, 20, 3] }, opening: { page: 1, box: [9, 5, 9, 3] }, closing: { page: 1, box: [39, 5, 9, 3] } };
    const still = readPdf([summary('1,250.00')], map as never, 'account');
    expect(still.ok).toBe(true);
    expect(still.checks.map((c) => c.text)).toContain('No transactions this period, and the balance stayed at $1,250.00');
    // no transactions but a different closing balance: the table was missed
    expect(readPdf([summary('1,400.00')], map as never, 'account').ok).toBe(false);
  });
  it('reads a row just below where the sample table ended, and a summary net of an interest adjustment', () => {
    // the sample's table box ends at y 26; this busier statement's last row sits just below it
    const map = { ...accountMap, table: { page: 1, box: [2, 15, 96, 11] }, period: { page: 1, box: [0, 1, 20, 3] }, opening: { page: 1, box: [9, 5, 9, 3] }, interest: { page: 1, box: [29, 5, 9, 3] }, credits: { page: 1, box: [49, 5, 9, 3] }, closing: { page: 1, box: [69, 5, 9, 3] } };
    const sum = (s: string, x: number): Item => ({ s, x, y: 6, w: 6, h: 1.5, page: 1 });
    const p = page(1, [['10 Jun 2023', 'INTEREST', '823.55', '', '270,415.17'], ['10 Jun 2023', 'INT ADJUSTMENT', '', '1.85', '270,413.32'], ['12 Jun 2023', 'REPAYMT A/C TFR', '', '1,598.00', '268,815.32'], ['13 Jun 2023', 'INTERNET PMT', '', '1.00', '268,814.32']]);
    p.items.push({ s: '12/05/2023 to 11/06/2023', x: 1, y: 2, w: 15, h: 1.5, page: 1 }, sum('269,591.62', 10), sum('$821.70', 30), sum('1,599.00', 50), sum('268,814.32', 70));
    const r = readPdf([p], map as never, 'loan');
    expect(r.txns).toHaveLength(4);
    // the bank's interest (823.55 less the 1.85 adjustment) and credits (without it) add up; no phantom debit
    expect(r.debits).toBe(0);
    expect(r.ok).toBe(true);
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
