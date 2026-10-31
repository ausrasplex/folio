/** Size limits on request bodies. The body is read in pieces and reading stops as soon as it passes the limit,
 *  so an oversized request is never held in memory whole. */

export const MB = 1024 * 1024;
export const ACT_MAX = 2 * MB;
export const IMPORT_MAX = 26 * MB; // one statement (25 MB) plus the form around it
export const restoreMax = (env: Record<string, string | undefined> = process.env) => {
  const n = Number(env.FOLIO_MAX_RESTORE_MB);
  return (Number.isFinite(n) && n > 0 ? n : 2048) * MB;
};

/** The body, or null when it is larger than max (by its stated length or by what actually arrives). */
export async function readBody(req: Request, max: number): Promise<Buffer | null> {
  if (Number(req.headers.get('content-length') || 0) > max) return null;
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) { await reader.cancel().catch(() => {}); return null; }
    parts.push(value);
  }
  return Buffer.concat(parts);
}

/** Reads a multipart form within a size limit, or null when it is too large. */
export async function readForm(req: Request, max: number) {
  const buf = await readBody(req, max);
  if (!buf) return null;
  return new Response(new Uint8Array(buf), { headers: { 'content-type': req.headers.get('content-type') || '' } }).formData();
}

export const tooLarge = (what: string) => Response.json({ error: what }, { status: 413 });
