import { describe, expect, it } from 'vitest';
import { MB, readBody, readForm, restoreMax } from './limits';

// a body that arrives in pieces, with no stated length, the way a chunked upload does
const chunked = (sizes: number[]) => new Request('http://x/', { method: 'POST', duplex: 'half', body: new ReadableStream({ start(c) { for (const n of sizes) c.enqueue(new Uint8Array(n)); c.close(); } }) } as RequestInit);

describe('request size limits', () => {
  it('reads a body within the limit', async () => {
    const b = await readBody(new Request('http://x/', { method: 'POST', body: 'hello' }), 10);
    expect(b?.toString()).toBe('hello');
  });
  it('refuses a body whose stated length is over the limit, without reading it', async () => {
    const r = new Request('http://x/', { method: 'POST', body: 'x'.repeat(20), headers: { 'content-length': '20' } });
    expect(await readBody(r, 10)).toBeNull();
  });
  it('stops reading a body with no stated length as soon as it passes the limit', async () => {
    expect(await readBody(chunked([400, 400, 400]), 1000)).toBeNull();
    expect((await readBody(chunked([400, 400]), 1000))?.length).toBe(800);
  });
  it('reads a form within the limit', async () => {
    const fd = new FormData(); fd.set('name', 'statement.pdf');
    const form = await readForm(new Request('http://x/', { method: 'POST', body: fd }), MB);
    expect(form?.get('name')).toBe('statement.pdf');
  });
  it('takes the restore limit from FOLIO_MAX_RESTORE_MB, 2048 MB by default', () => {
    expect(restoreMax({})).toBe(2048 * MB);
    expect(restoreMax({ FOLIO_MAX_RESTORE_MB: '500' })).toBe(500 * MB);
    expect(restoreMax({ FOLIO_MAX_RESTORE_MB: 'lots' })).toBe(2048 * MB);
  });
});
