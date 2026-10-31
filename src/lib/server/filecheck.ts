/** What an uploaded statement really is, judged by its contents rather than its name or the type the browser claimed. */

/** A PDF starts with %PDF-. */
export const looksLikePdf = (buf: Uint8Array) => Buffer.from(buf.subarray(0, 5)).toString('latin1') === '%PDF-';

/** A CSV is UTF-8 text (a leading byte-order mark is fine) with no NUL bytes. */
export function looksLikeCsv(buf: Uint8Array) {
  if (buf.includes(0)) return false;
  try { new TextDecoder('utf-8', { fatal: true }).decode(buf); return true; } catch { return false; }
}

/** Why a file cannot be imported, or '' when its contents match its kind. */
export function fileProblem(name: string, buf: Uint8Array) {
  if (/\.csv$/i.test(name)) return looksLikeCsv(buf) ? '' : name + " isn't a plain-text CSV file. Export it from your bank again as CSV and import that.";
  return looksLikePdf(buf) ? '' : name + " isn't a real PDF. Download the statement from your bank again and import that file.";
}

/** How a stored file is served: worked out from its contents and name, never the type sent when it was uploaded. */
export function servedType(name: string, buf: Uint8Array, download: boolean) {
  if (looksLikePdf(buf)) return 'application/pdf';
  if (/\.csv$/i.test(name) && looksLikeCsv(buf)) return download ? 'text/csv; charset=utf-8' : 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}
