import { describe, expect, it } from 'vitest';
import { fileProblem, servedType } from './filecheck';

const b = (s: string | number[]) => (typeof s === 'string' ? Buffer.from(s, 'utf8') : Buffer.from(s));

describe('checking a statement by its contents', () => {
  it('accepts a real PDF and refuses one that only has the name', () => {
    expect(fileProblem('statement.pdf', b('%PDF-1.7\n...'))).toBe('');
    expect(fileProblem('statement.pdf', b('<html><script>alert(1)</script></html>'))).toMatch(/isn't a real PDF/);
    expect(fileProblem('statement.pdf', b(''))).toMatch(/isn't a real PDF/);
  });
  it('accepts a UTF-8 CSV, with or without a byte-order mark', () => {
    expect(fileProblem('export.csv', b('Date,Description,Amount\n01/09/2026,Café,-4.50\n'))).toBe('');
    expect(fileProblem('export.csv', b([0xef, 0xbb, 0xbf, ...b('Date,Amount\n')]))).toBe('');
  });
  it('refuses a CSV that is not plain text', () => {
    expect(fileProblem('export.csv', b([0x44, 0x61, 0x00, 0x74, 0x65]))).toMatch(/isn't a plain-text CSV/);
    expect(fileProblem('export.csv', b([0x44, 0xff, 0xfe, 0x41]))).toMatch(/isn't a plain-text CSV/);
    expect(fileProblem('export.csv', b('%PDF-1.7 renamed'))).toBe(''); // text, so it is let through; reading it simply finds no columns
  });
});

describe('serving a stored file', () => {
  it('decides the type from the contents, never the uploaded type', () => {
    expect(servedType('statement.pdf', b('%PDF-1.7'), false)).toBe('application/pdf');
    expect(servedType('export.csv', b('a,b\n1,2\n'), false)).toBe('text/plain; charset=utf-8');
    expect(servedType('export.csv', b('a,b\n1,2\n'), true)).toBe('text/csv; charset=utf-8');
    expect(servedType('statement.pdf', b('<html>not a pdf</html>'), false)).toBe('application/octet-stream');
  });
});
