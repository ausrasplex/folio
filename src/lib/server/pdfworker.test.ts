import { describe, expect, it } from 'vitest';
import { PDF_MAX_PAGES, UNREADABLE, pdfPages } from './importer';

/** A small but valid PDF with one line of text on each page. */
function makePdf(pages: number) {
  const objs: string[] = [];
  const kids = Array.from({ length: pages }, (_, i) => 4 + i * 2);
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push('<< /Type /Pages /Kids [' + kids.map((k) => k + ' 0 R').join(' ') + '] /Count ' + pages + ' >>');
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  for (let i = 0; i < pages; i++) {
    const text = 'BT /F1 12 Tf 72 720 Td (Page ' + (i + 1) + ') Tj ET';
    objs.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ' + (5 + i * 2) + ' 0 R >>');
    objs.push('<< /Length ' + text.length + ' >>\nstream\n' + text + '\nendstream');
  }
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
  const xref = out.length;
  out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return Buffer.from(out, 'latin1');
}

describe('reading PDFs in a worker', () => {
  it('reads the text of each page', async () => {
    const pages = await pdfPages(makePdf(3));
    expect(pages.map((p) => p.text)).toEqual(['Page 1', 'Page 2', 'Page 3']);
  });
  it('stops after 50 pages', async () => {
    const pages = await pdfPages(makePdf(60));
    expect(PDF_MAX_PAGES).toBe(50);
    expect(pages).toHaveLength(50);
    expect(pages[49].text).toBe('Page 50');
  });
  it('gives "This file could not be read." for random bytes, and keeps going', async () => {
    const junk = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 7919) % 256));
    await expect(pdfPages(junk)).rejects.toThrow(UNREADABLE);
    expect((await pdfPages(makePdf(1)))[0].text).toBe('Page 1'); // the next file still reads
  });
  it('gives the same error when reading takes too long', async () => {
    await expect(pdfPages(makePdf(60), { timeoutMs: 1 })).rejects.toThrow(UNREADABLE);
  });
});
