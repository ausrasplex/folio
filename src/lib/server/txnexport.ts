// Exporting an account's transactions as CSV or PDF, each row linking to the statement it came from.
import { PDFDocument, PDFName, PDFString, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

/** A link to a row's statement: a file beside the export (in the same ZIP), or the statement on the Folio server. */
export type StatementLink = { kind: 'file' | 'url'; target: string; page: number; label: string };
export type ExportRow = { date: string; desc: string; cat: string; debit: number; credit: number; bal: number | null; link: StatementLink | null };
export type ExportInfo = { account: string; filters: string; exported: string; sumIn: number; sumOut: number };

const money = (n: number) => n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const longDate = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** A CSV cell: quoted when needed, and never read as a formula (a description starting with = + - or @). */
export function cell(v: unknown) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
/** A clickable link cell for spreadsheets (Excel, LibreOffice and Numbers make HYPERLINK cells clickable). */
const linkCell = (l: StatementLink) => '"=HYPERLINK(""' + l.target.replace(/"/g, '') + '"",""' + l.label.replace(/"/g, '') + '"")"';

export function transactionsCsv(rows: ExportRow[]) {
  const head = ['Date', 'Description', 'Category', 'Money in', 'Money out', 'Balance', 'Statement', 'Page'].join(',');
  const lines = rows.map((r) => [cell(r.date), cell(r.desc), cell(r.cat), r.credit ? r.credit.toFixed(2) : '', r.debit ? r.debit.toFixed(2) : '', r.bal == null ? '' : r.bal.toFixed(2), r.link ? linkCell(r.link) : '', r.link ? String(r.link.page) : ''].join(','));
  return [head].concat(lines).join('\r\n') + '\r\n';
}

/** Text the PDF's built-in font can draw: curly quotes and dashes made plain, anything else it lacks becomes ?. */
function plain(font: PDFFont, s: string) {
  const t = String(s).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/\s+/g, ' ');
  let out = '';
  for (const ch of t) { try { font.encodeText(ch); out += ch; } catch { out += '?'; } }
  return out;
}
/** Shortened with ... to fit a width. */
function fit(font: PDFFont, s: string, size: number, width: number) {
  if (font.widthOfTextAtSize(s, size) <= width) return s;
  let lo = 0, hi = s.length;
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (font.widthOfTextAtSize(s.slice(0, mid) + '...', size) <= width) lo = mid; else hi = mid - 1; }
  return s.slice(0, lo) + '...';
}
/** A clickable area: opens a file beside this one at a page (GoToR), or a web address. */
function addLink(doc: PDFDocument, page: PDFPage, x: number, y: number, w: number, h: number, l: StatementLink) {
  const action = l.kind === 'file'
    ? doc.context.obj({ S: 'GoToR', F: PDFString.of(l.target), D: [Math.max(0, l.page - 1), PDFName.of('Fit')], NewWindow: true })
    : doc.context.obj({ S: 'URI', URI: PDFString.of(l.target + '#page=' + l.page) });
  const annot = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [x, y, x + w, y + h], Border: [0, 0, 0], A: action }));
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (annots && 'push' in annots) (annots as unknown as { push: (v: unknown) => void }).push(annot);
  else page.node.set(PDFName.of('Annots'), doc.context.obj([annot]));
}

export async function transactionsPdf(rows: ExportRow[], info: ExportInfo) {
  const doc = await PDFDocument.create();
  doc.setTitle(info.account + ' transactions');
  doc.setProducer('Folio');
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 841.89, H = 595.28, M = 36, size = 8.5, rowH = 15;
  const ink = rgb(0.12, 0.12, 0.14), muted = rgb(0.42, 0.42, 0.46), line = rgb(0.86, 0.86, 0.88), linkC = rgb(0.16, 0.33, 0.75);
  // columns: date, description, category, in, out, balance, statement
  const cols = [{ x: M, w: 62 }, { x: M + 66, w: 270 }, { x: M + 340, w: 100 }, { x: M + 444, w: 60, right: true }, { x: M + 508, w: 60, right: true }, { x: M + 572, w: 68, right: true }, { x: M + 648, w: W - M - (M + 648) }];
  const heads = ['Date', 'Description', 'Category', 'Money in', 'Money out', 'Balance', 'Statement'];
  let page: PDFPage = doc.addPage([W, H]), y = 0, pageNo = 0;
  const text = (s: string, x: number, yy: number, f = font, sz = size, color = ink) => page.drawText(plain(f, s), { x, y: yy, size: sz, font: f, color });
  const startPage = (first: boolean) => {
    if (!first) page = doc.addPage([W, H]);
    pageNo++;
    y = H - M;
    if (first) {
      text(info.account + ' Transactions', M, y - 14, bold, 16);
      text(info.filters + ' · Exported ' + info.exported, M, y - 32, font, 9, muted);
      text(rows.length.toLocaleString('en-AU') + ' transactions · $' + money(info.sumIn) + ' in · $' + money(info.sumOut) + ' out', M, y - 46, font, 9, muted);
      y -= 66;
    }
    heads.forEach((h, i) => { const c = cols[i]; const s = plain(bold, h); text(h, c.right ? c.x + c.w - bold.widthOfTextAtSize(s, size) : c.x, y, bold, size, muted); });
    y -= 6;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: line });
    y -= rowH - 4;
    text('Page ' + pageNo, W - M - 40, M - 18, font, 8, muted);
  };
  startPage(true);
  for (const r of rows) {
    if (y < M + 6) startPage(false);
    const cellsTxt = [longDate(r.date), r.desc, r.cat, r.credit ? money(r.credit) : '', r.debit ? money(r.debit) : '', r.bal == null ? '' : money(r.bal)];
    cellsTxt.forEach((s, i) => {
      const c = cols[i];
      const t = fit(font, plain(font, s), size, c.w);
      text(t, c.right ? c.x + c.w - font.widthOfTextAtSize(t, size) : c.x, y);
    });
    if (r.link) {
      const c = cols[6];
      const t = fit(font, plain(font, r.link.label + ', p. ' + r.link.page), size, c.w);
      const tw = font.widthOfTextAtSize(t, size);
      text(t, c.x, y, font, size, linkC);
      page.drawLine({ start: { x: c.x, y: y - 1.5 }, end: { x: c.x + tw, y: y - 1.5 }, thickness: 0.4, color: linkC });
      addLink(doc, page, c.x, y - 3, tw, rowH - 2, r.link);
    }
    page.drawLine({ start: { x: M, y: y - 5 }, end: { x: W - M, y: y - 5 }, thickness: 0.3, color: line });
    y -= rowH;
  }
  return doc.save();
}
