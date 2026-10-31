import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { mostChecks, pdfPages, pdfPhrases, pickPdf, readPdf, textFinder, type Page } from './importer';

// The test statement from tools/testdata, and the layout the demo data uses for it (prisma/seed.ts)
const box = (page: number, b: number[]) => ({ page, box: b });
const loanMap = { period: box(1, [58, 19, 38, 7]), opening: box(1, [4, 36, 18, 7]), interest: box(1, [24, 36, 18, 7]), credits: box(1, [62, 36, 16, 7]), closing: box(1, [80, 36, 17, 7]), table: box(2, [4, 12, 92, 80]), cDate: box(2, [4, 12, 12, 80]), cDesc: box(2, [16, 12, 41, 80]), cDebit: box(2, [57, 12, 13, 80]), cCredit: box(2, [70, 12, 13, 80]), cBal: box(2, [83, 12, 13, 80]), acct: box(1, [58, 13, 38, 5]), advance: box(1, [4, 46, 18, 7]), offset: box(1, [62, 46, 16, 7]), rate: box(1, [80, 46, 17, 7]) };
// every box shifted across the page: a layout made for some other statement, which reads nothing here
const moved = JSON.parse(JSON.stringify(loanMap));
for (const k of Object.keys(moved)) moved[k].box[0] = (moved[k].box[0] + 50) % 90;
let n = 0;
const layout = (lenderName: string, map: object, fingerprint: object = {}) => ({ id: 'l' + ++n, name: 'Layout ' + n, lenderName, kind: 'loan', format: 'PDF', status: 'ok', failedNote: null, createdAt: new Date(), deletedAt: null, deletedById: null,
  versions: [{ id: 'v' + n, layoutId: 'l' + n, version: 1, map, fingerprint, createdBy: 'test', createdAt: new Date() }] }) as never;

let pages: Page[] = [];
const load = async () => { if (!pages.length) pages = await pdfPages(fs.readFileSync(path.join(process.cwd(), 'tools', 'testdata', 'home-split01.pdf'))); return pages; };

describe('choosing a layout for a PDF', () => {
  it('matches by what the layout reads, even when the lender is called something else in Folio', async () => {
    const p = await load();
    const r = pickPdf(p, [layout('My Bank Nickname', loanMap)]);
    expect(r.layout?.lenderName).toBe('My Bank Nickname');
    expect(r.read?.ok).toBe(true);
    expect(r.remap).toBeNull();
  });
  it("prefers the layout whose lender name is on the statement when two read it equally well", async () => {
    const p = await load();
    const r = pickPdf(p, [layout('Someone Else', loanMap), layout('Example Bank', loanMap)]);
    expect(r.layout?.lenderName).toBe('Example Bank');
  });
  it('uses the optional identifying text to choose between equal layouts', async () => {
    const p = await load();
    const r = pickPdf(p, [layout('Example Bank', loanMap, { phrases: ['Words not on this statement'] }), layout('Example Bank', loanMap, { phrases: ['Example Bank'] })]);
    expect(pdfPhrases(r.version?.fingerprint)).toEqual(['Example Bank']);
  });
  it('a layout that reads nothing useful is not used, and is not flagged for re-mapping', async () => {
    const p = await load();
    const r = pickPdf(p, [layout('Example Bank', moved)]);
    expect(r.layout).toBeNull();
    expect(mostChecks(readPdf(p, moved as never, 'loan'))).toBe(false);
    expect(r.remap).toBeNull();
  });
});

describe('when a layout needs re-mapping', () => {
  const rd = (oks: boolean[]) => ({ checks: oks.map((ok) => ({ ok, text: '' })) }) as never;
  it('is most but not all of the checks passing', () => {
    expect(mostChecks(rd([true, true, false]))).toBe(true);
    expect(mostChecks(rd([true, false]))).toBe(true);
    expect(mostChecks(rd([true, true, true]))).toBe(false);
    expect(mostChecks(rd([true, false, false]))).toBe(false);
    expect(mostChecks(rd([]))).toBe(false);
  });
});

describe('finding a name in statement text', () => {
  it('ignores case, spacing and words broken up by the PDF', () => {
    const has = textFinder('Statement from COMM ONWEALTH  Bank of Australia, page 3');
    expect(has('Commonwealth Bank')).toBe(true);
    expect(has('commonwealth bank of australia')).toBe(true);
    expect(has('Westpac')).toBe(false);
  });
  it('matches short names only as whole words', () => {
    expect(textFinder('ING Bank (Australia) Limited')('ING')).toBe(true);
    expect(textFinder('Your billing summary')('ING')).toBe(false);
  });
});
