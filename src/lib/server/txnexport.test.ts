import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import { cell, transactionsCsv, transactionsPdf, type ExportRow } from './txnexport';

const rows: ExportRow[] = [
  { date: '2025-10-21', desc: '=HYPERLINK("http://evil")', cat: 'Other', debit: 14.29, credit: 0, bal: 1392.53, link: { kind: 'file', target: 'statements/Jesse 2026-01-21.pdf', page: 6, label: 'Jesse 2026-01-21' } },
  { date: '2025-10-22', desc: 'JC SERVICES AUST, PAY', cat: 'Income', debit: 0, credit: 4709.9, bal: 6102.43, link: { kind: 'url', target: 'https://folio.home/api/file/abc', page: 6, label: 'Jesse 2026-01-21' } }
];

describe('exporting transactions', () => {
  it('never lets a description become a spreadsheet formula', () => {
    expect(cell('=1+1')).toBe("'=1+1");
    expect(cell('-62.40 refund')).toBe("'-62.40 refund");
    expect(cell('a, b')).toBe('"a, b"');
  });
  it('writes a CSV with a clickable link to each statement and its page', () => {
    const lines = transactionsCsv(rows).trim().split('\r\n');
    expect(lines[0]).toBe('Date,Description,Category,Money in,Money out,Balance,Statement,Page');
    expect(lines[1]).toBe(`2025-10-21,"'=HYPERLINK(""http://evil"")",Other,,14.29,1392.53,"=HYPERLINK(""statements/Jesse 2026-01-21.pdf"",""Jesse 2026-01-21"")",6`);
    expect(lines[2]).toContain('"=HYPERLINK(""https://folio.home/api/file/abc"",""Jesse 2026-01-21"")"');
  });
  it('writes a PDF with a link on every row: to the file beside it at its page, or to the server', async () => {
    const doc = await PDFDocument.load(await transactionsPdf(rows, { account: 'Jesse', filters: 'All transactions', exported: '1 Nov 2026', sumIn: 4709.9, sumOut: 14.29 }));
    const annots = doc.getPages()[0].node.lookup(PDFName.of('Annots')) as unknown as { size: () => number; lookup: (i: number) => { lookup: (n: PDFName) => { lookup: (n: PDFName) => unknown } } };
    expect(annots.size()).toBe(2);
    const action = (i: number) => annots.lookup(i).lookup(PDFName.of('A'));
    expect(String(action(0).lookup(PDFName.of('S')))).toBe('/GoToR');
    expect(String(action(0).lookup(PDFName.of('F')))).toBe('(statements/Jesse 2026-01-21.pdf)');
    expect(String(action(1).lookup(PDFName.of('URI')))).toBe('(https://folio.home/api/file/abc#page=6)');
  });
});
