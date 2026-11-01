// Reads statement files on this server. PDFs: text with positions (pdf.js), then the saved layout's boxes say
// which text is which. CSVs: the header row picks the layout, the layout says what each column holds.
import nodePath from 'path';
import { pathToFileURL } from 'url';
import { Worker } from 'worker_threads';
import Decimal from 'decimal.js';
import { db } from './db';
import { runDaily } from '../engine';

export type Item = { s: string; x: number; y: number; w: number; h: number; page: number }; // percent of the page, y from the top
export type Page = { n: number; items: Item[]; text: string; wPt: number; hPt: number };
export type Txn = { date: string; description: string; debit: number; credit: number; balance: number | null; rate: number | null; page: number; row: number; y?: number; yh?: number };
export type Check = { ok: boolean; text: string };
export type Read = {
  format: 'PDF' | 'CSV'; pages: number; period: { start: string; end: string } | null;
  opening: number | null; closing: number | null; interest: number | null; credits: number | null; debits: number | null;
  advance: number | null; rate: number | null; acct: string; txns: Txn[]; checks: Check[]; ok: boolean;
  /** Interest the loan's offset saved in the period, as the statement prints it. */
  offsetBenefit?: number | null;
};
type Box = { page: number; box: number[] };
export type PdfMap = Record<string, Box>;
export type CsvMap = { cols: string[]; dateFmt: string; header: string[] };

const r2 = (n: number) => Math.round(n * 100) / 100;
const MON: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const iso = (y: number, m: number, d: number) => { const dt = new Date(Date.UTC(y < 100 ? 2000 + y : y, m, d)); return dt.getUTCMonth() === m && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : ''; };

/** All dates in a piece of text, in order. dd/mm/yyyy, d Mon yyyy, yyyy-mm-dd (or the CSV format given). */
export function datesIn(t: string, fmt = 'dmy'): string[] {
  const out: { i: number; v: string }[] = [];
  for (const m of t.matchAll(/\b(\d{1,4})[/.-](\d{1,2})[/.-](\d{2,4})\b/g)) {
    const [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const v = m[1].length === 4 ? iso(a, b - 1, c) : fmt === 'mdy' ? iso(c, a - 1, b) : fmt === 'ymd' ? iso(a, b - 1, c) : iso(c, b - 1, a);
    if (v) out.push({ i: m.index!, v });
  }
  for (const m of t.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{2,4})\b/g)) {
    const mo = MON[m[2].toLowerCase().slice(0, m[2].toLowerCase().startsWith('sept') ? 4 : 3)];
    if (mo != null) { const v = iso(Number(m[3]), mo, Number(m[1])); if (v) out.push({ i: m.index!, v }); }
  }
  return out.sort((a, b) => a.i - b.i).map((x) => x.v);
}

/** First money amount in text. "1,234.50", "$1,234.50", "1,234.50 CR", "(12.00)", "-12.00". */
export function moneyIn(t: string): number | null {
  const m = String(t).replace(/−/g, '-').match(/(\(?-?\$?\s?\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?\)?|\(?-?\$?\s?\d+(?:\.\d{1,2})?\)?)(?![\d,])\s*(CR|DR|Cr|Dr)?/);
  if (!m) return null;
  let s = m[1];
  const neg = /^\(.*\)$/.test(s) || s.includes('-') || (m[2] || '').toUpperCase() === 'DR';
  s = s.replace(/[()$,\s-]/g, '');
  const n = Number(s);
  if (!isFinite(n)) return null;
  return neg ? -n : n;
}
export const rateIn = (t: string) => { const m = String(t).match(/(\d{1,2}\.\d{1,4})\s*%/); return m ? Number(m[1]) : null; };

// ----- PDF text, read in a separate thread with limits, so a broken or hostile file cannot stall or crash the server
export const PDF_MAX_PAGES = 50;
export const PDF_TIMEOUT_MS = 20000;
export const PDF_MEMORY_MB = 256;
export const UNREADABLE = 'This file could not be read.';

// The worker's code is a string (eval) so it never has to be found on disk after the server is bundled.
const PDF_WORKER = `
const { parentPort, workerData } = require('worker_threads');
// pdf.js loads the native @napi-rs/canvas add-on in Node, only for drawing pages. Reading text does not need it, and a
// native add-on in a worker thread can crash the whole process when the thread stops, so it is never loaded here.
const Module = require('module');
const load = Module._load;
Module._load = function (request, ...rest) {
  if (request === '@napi-rs/canvas' || request.startsWith('@napi-rs/canvas-')) throw new Error('not used when reading text');
  return load.call(this, request, ...rest);
};
(async () => {
  try {
    const pdfjs = await import(workerData.pdfjs);
    const doc = await pdfjs.getDocument({ data: workerData.data, disableFontFace: true, isEvalSupported: false, useSystemFonts: false, standardFontDataUrl: workerData.fonts, verbosity: 0 }).promise;
    const pages = [];
    const last = Math.min(doc.numPages, workerData.maxPages);
    for (let n = 1; n <= last; n++) {
      const p = await doc.getPage(n);
      const vp = p.getViewport({ scale: 1 });
      const tc = await p.getTextContent();
      const items = [];
      for (const it of tc.items) {
        if (!it.str || !it.str.trim()) continue;
        const dd = it.transform[3], e = it.transform[4], f = it.transform[5];
        const h = Math.abs(it.height || dd || 10);
        items.push({ s: it.str, x: e / vp.width * 100, y: (vp.height - f - h * 0.8) / vp.height * 100, w: (it.width || 0) / vp.width * 100, h: h / vp.height * 100, page: n });
      }
      items.sort((a, b) => a.y - b.y || a.x - b.x);
      pages.push({ n, items, text: items.map((i) => i.s).join(' '), wPt: vp.width, hPt: vp.height });
    }
    await doc.destroy();
    parentPort.postMessage({ pages });
  } catch (e) { parentPort.postMessage({ error: String((e && e.message) || e) }); }
})();
`;

/** The text of a PDF's pages (the first 50 at most). Read in a worker thread with a 20-second limit and a memory cap:
 *  a timeout, crash or unreadable file rejects with "This file could not be read." and the server keeps running. */
export function pdfPages(buf: Buffer, opts: { timeoutMs?: number; maxPages?: number } = {}): Promise<Page[]> {
  const modules = nodePath.join(process.cwd(), 'node_modules', 'pdfjs-dist');
  return new Promise((resolve, reject) => {
    let settled = false;
    const w = new Worker(PDF_WORKER, {
      eval: true,
      execArgv: [], // a plain thread: none of the host process's flags or loaders
      workerData: { data: new Uint8Array(buf), pdfjs: pathToFileURL(nodePath.join(modules, 'legacy', 'build', 'pdf.mjs')).href, fonts: nodePath.join(modules, 'standard_fonts') + nodePath.sep, maxPages: opts.maxPages ?? PDF_MAX_PAGES },
      resourceLimits: { maxOldGenerationSizeMb: PDF_MEMORY_MB }
    });
    // settles only once the worker has stopped, so no reader thread outlives the request
    const finish = (pages: Page[] | null, why?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      w.terminate().catch(() => {}).finally(() => {
        if (pages) resolve(pages);
        else { if (why) console.warn('[folio] PDF not read:', why); reject(new Error(UNREADABLE)); }
      });
    };
    const timer = setTimeout(() => finish(null, 'took longer than ' + (opts.timeoutMs ?? PDF_TIMEOUT_MS) / 1000 + ' seconds'), opts.timeoutMs ?? PDF_TIMEOUT_MS);
    w.once('message', (m: { pages?: Page[]; error?: string }) => finish(m.pages || null, m.error));
    w.once('error', (e) => finish(null, e.message));
    w.once('exit', (code) => finish(null, 'the reader stopped (code ' + code + ')'));
  });
}

const inBox = (it: Item, b: number[]) => { const cx = it.x + it.w / 2, cy = it.y + it.h / 2; return cx >= b[0] && cx <= b[0] + b[2] && cy >= b[1] && cy <= b[1] + b[3]; };
const textIn = (pages: Page[], bx: Box | undefined) => { if (!bx) return ''; const p = pages[bx.page - 1]; return p ? p.items.filter((it) => inBox(it, bx.box)).map((it) => it.s).join(' ') : ''; };

/** Groups text into lines (by height on the page). */
function lines(items: Item[]) {
  const out: Item[][] = [];
  for (const it of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0].y - it.y) < Math.max(0.6, it.h * 0.45)) last.push(it); else out.push([it]);
  }
  return out.map((l) => l.sort((a, b) => a.x - b.x));
}

/** The "Interest Offset Benefit" a loan statement prints: the amount just under its label. */
export function offsetBenefitIn(pages: Page[]): number | null {
  for (const p of pages) {
    const label = p.items.find((x) => /offset\s+benefit/i.test(x.s));
    if (!label) continue;
    const below = p.items.filter((x) => x !== label && x.y > label.y + 0.3 && x.y < label.y + 8 && Math.abs(x.x - label.x) < 4 && moneyIn(x.s) != null).sort((a, b) => a.y - b.y)[0];
    if (below) return Math.abs(moneyIn(below.s)!);
  }
  return null;
}

/** A line that only carries a balance: a page's sub total carried forward (or brought forward from the last page), or
 *  the opening or closing balance. Not a transaction, unless it moves money or states a rate (a loan's opening rate line). */
export const BALANCE_LINE = /\b(sub\s*-?\s*total|carried\s+forward|brought\s+forward|balance\s+(brought|carried)|opening\s+balance|closing\s+balance|[bc]\/f)\b/i;
const balanceOnly = (desc: string, debit: number, credit: number) => BALANCE_LINE.test(desc) && !debit && !credit && rateIn(desc) == null;

/** Some PDFs hold a row's date and description as one piece of text starting in the Date column ("21 MAY LOAN
 *  REPAYMENT"). Such a piece is split at the end of the date, its parts placed in proportion to their length. */
const LEADING_DATE = /^(\d{1,2}(?:[ \/.-](?:[A-Za-z]{3,9}|\d{1,2}))(?:[ \/.-]\d{2,4})?)\s+(\S.*)$/;
function splitDates(items: Item[], dateCol: Box): Item[] {
  const [x0, , w0] = dateCol.box;
  return items.flatMap((it) => {
    const m = it.s.match(LEADING_DATE);
    if (!m || it.x < x0 - 1 || it.x > x0 + w0 || it.x + it.w <= x0 + w0 || !datesIn(m[1] + ' 2000').length) return [it];
    const cut = it.w * (m[1].length + 1) / it.s.length;
    return [{ ...it, s: m[1], w: it.w * m[1].length / it.s.length }, { ...it, s: m[2], x: it.x + cut, w: it.w - cut }];
  });
}

export function readPdf(pages: Page[], map: PdfMap, kind: string): Read {
  const f = (k: string) => textIn(pages, map[k]);
  const pd = datesIn(f('period'));
  const tb = map.table;
  const cols = (['cDate', 'cDesc', 'cDebit', 'cCredit', 'cBal'] as const).map((k) => map[k]);
  const txns: Txn[] = [];
  if (tb && cols[0] && cols[1]) {
    for (const p of pages.filter((x) => x.n >= tb.page)) {
      // on continuation pages the table runs from near the top, so widen the box upwards and downwards; on the first
      // page it can run further down than in the sample (a busier period), so it reaches as far down as the others
      const box = p.n === tb.page ? [tb.box[0], tb.box[1], tb.box[2], Math.max(tb.box[3], 97 - tb.box[1])] : [tb.box[0], 3, tb.box[2], 94];
      const its = splitDates(p.items.filter((it) => inBox(it, box)), cols[0]!);
      let row = 0, dated = false; // wrapped text only joins a row on the same page, not a page header after it
      for (const ln of lines(its)) {
        const col = (c: Box | undefined) => c ? ln.filter((it) => { const cx = it.x + it.w / 2; return cx >= c.box[0] && cx <= c.box[0] + c.box[2]; }).map((it) => it.s).join(' ').trim() : '';
        const dTxt = col(cols[0]), desc = col(cols[1]), deb = col(cols[2]), cre = col(cols[3]), bal = col(cols[4]);
        const ds = datesIn(dTxt + (dTxt && !/\d{4}/.test(dTxt) && pd[1] ? ' ' + pd[1].slice(0, 4) : ''));
        if (ds.length) {
          const debit = Math.abs(moneyIn(deb) ?? 0), credit = Math.abs(moneyIn(cre) ?? 0), b = moneyIn(bal);
          dated = true;
          txns.push({ date: ds[0], description: desc, debit: r2(debit), credit: r2(credit), balance: b == null ? null : r2(Math.abs(b)), rate: /rate/i.test(desc) ? rateIn(desc) : null, page: p.n, row: row++, y: Math.round(Math.min(...ln.map((it) => it.y)) * 100) / 100, yh: Math.round(Math.max(...ln.map((it) => it.h)) * 100) / 100 });
        } else if (BALANCE_LINE.test(desc) && !rateIn(desc)) {
          continue; // an undated sub total or carried-forward line: not part of the transaction above
        } else if (dated && desc && !deb && !cre && !/^(date|description|transaction|details)/i.test(desc)) {
          txns[txns.length - 1].description += ' ' + desc; // wrapped line
          if (/rate/i.test(desc) && txns[txns.length - 1].rate == null) txns[txns.length - 1].rate = rateIn(desc);
        }
      }
    }
  }
  // balance lines are dropped once any wrapped text has joined them (a loan's opening line can carry its rate on the next line)
  for (let i = txns.length - 1; i >= 0; i--) if (balanceOnly(txns[i].description, txns[i].debit, txns[i].credit)) txns.splice(i, 1);
  const num = (k: string) => { const v = moneyIn(f(k)); return v == null ? null : Math.abs(v); };
  const r: Read = {
    format: 'PDF', pages: pages.length, period: pd.length >= 2 ? { start: pd[0], end: pd[1] } : null,
    opening: num('opening'), closing: num('closing'), interest: kind === 'loan' ? num('interest') : null,
    credits: num('credits'), debits: kind === 'loan' ? num('debits') : num('debits'), advance: num('advance'), rate: rateIn(f('rate')),
    acct: (f('acct').match(/\d[\d\s-]{3,}\d/) || [''])[0].replace(/\s+/g, ' '), txns, checks: [], ok: false,
    offsetBenefit: kind === 'loan' ? (map.offsetBenefit ? num('offsetBenefit') : offsetBenefitIn(pages)) : null
  };
  return finish(r, kind);
}

/** Fills totals from the table where the summary did not give them, then runs the checks. */
function finish(r: Read, kind: string): Read {
  const sum = (k: 'debit' | 'credit', test?: (t: Txn) => boolean) => r2(r.txns.filter((t) => !test || test(t)).reduce((s, t) => s + t[k], 0));
  if (r.credits == null) r.credits = sum('credit');
  if (kind === 'loan') {
    if (r.interest == null) r.interest = sum('debit', (t) => /interest/i.test(t.description));
    // debits other than interest, counted from the rows (not all debits less the interest figure, which a statement can
    // show net of an interest adjustment credit)
    if (r.debits == null) r.debits = sum('debit', (t) => !/interest/i.test(t.description));
  } else if (r.debits == null) r.debits = sum('debit');
  if (r.opening == null && r.txns.length && r.txns[0].balance != null) r.opening = r2(r.txns[0].balance - r.txns[0].debit * (kind === 'loan' ? 1 : -1) + r.txns[0].credit * (kind === 'loan' ? 1 : -1));
  if (r.closing == null) { const last = [...r.txns].reverse().find((t) => t.balance != null); if (last) r.closing = last.balance; }
  if (!r.period && r.txns.length) r.period = { start: r.txns[0].date, end: r.txns[r.txns.length - 1].date };
  if (r.rate == null) { const rr = [...r.txns].reverse().find((t) => t.rate != null); if (rr) r.rate = rr.rate; }
  const checks: Check[] = [];
  const m = (n: number | null) => '$' + (n ?? 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (!r.period) checks.push({ ok: false, text: 'The statement period could not be read' });
  if (r.opening == null || r.closing == null) checks.push({ ok: false, text: 'The opening or closing balance could not be read' });
  else if (kind === 'loan') {
    const calc = r2(r.opening + (r.interest || 0) + (r.debits || 0) - (r.credits || 0));
    checks.push({ ok: Math.abs(calc - r.closing) < 0.011, text: 'Opening ' + m(r.opening) + ' + interest ' + m(r.interest) + (r.debits ? ' + other debits ' + m(r.debits) : '') + ' − credits ' + m(r.credits) + ' = ' + (Math.abs(calc - r.closing) < 0.011 ? 'closing ' + m(r.closing) : m(calc) + ', but the closing balance says ' + m(r.closing)) });
  } else {
    const calc = r2(r.opening + (r.credits || 0) - (r.debits || 0));
    checks.push({ ok: Math.abs(calc - r.closing) < 0.011, text: 'Opening ' + m(r.opening) + ' + money in ' + m(r.credits) + ' − money out ' + m(r.debits) + ' = ' + (Math.abs(calc - r.closing) < 0.011 ? 'closing ' + m(r.closing) : m(calc) + ', but the closing balance says ' + m(r.closing)) });
  }
  const withBal = r.txns.filter((t) => t.balance != null);
  if (withBal.length && r.opening != null) {
    let prev = r.opening, good = 0;
    const sign = kind === 'loan' ? 1 : -1;
    const off: string[] = []; // the first rows that do not agree, to say where to look
    for (const t of r.txns) {
      if (t.balance == null) continue;
      const exp = r2(prev + sign * (t.debit - t.credit));
      if (Math.abs(exp - t.balance) < 0.011 || (t.debit === 0 && t.credit === 0)) good++;
      else if (off.length < 2) off.push(new Date(t.date + 'T00:00:00Z').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' }) + ' ' + (t.description.slice(0, 40) || 'row') + (r.pages > 1 ? ' (page ' + t.page + ')' : '') + ': shows ' + m(t.balance) + ', expected ' + m(exp));
      prev = t.balance;
    }
    checks.push({ ok: good === withBal.length, text: good === withBal.length ? 'Running balance agrees on all ' + withBal.length + ' rows' + (r.pages > 1 ? ' across ' + r.pages + ' pages' : '') : 'Running balance agrees on ' + good + ' of ' + withBal.length + ' rows. Check ' + off.join('; ') });
  } else if (!r.txns.length) {
    // a period with no activity is still a statement: no transactions, and the balance did not move. With no
    // transactions but a different closing balance, the table was missed.
    const still = r.opening != null && r.closing != null && Math.abs(r.opening - r.closing) < 0.011;
    checks.push({ ok: still, text: still ? 'No transactions this period, and the balance stayed at ' + m(r.closing) : 'No transactions were found in the table' });
  }
  r.checks = checks;
  r.ok = checks.length > 0 && checks.every((c) => c.ok);
  return r;
}

export function parseCsv(text: string): string[][] {
  const delim = (text.split('\n')[0].match(/\t/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? '\t' : (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const rows: string[][] = []; let row: string[] = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; continue; }
    if (ch === '"') q = true; else if (ch === delim) { row.push(cur); cur = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); if (row.some((c) => c.trim())) rows.push(row.map((c) => c.trim())); row = []; cur = ''; } else cur += ch;
  }
  row.push(cur); if (row.some((c) => c.trim())) rows.push(row.map((c) => c.trim()));
  return rows;
}
export const headerKey = (h: string[]) => h.map((x) => x.trim().toLowerCase().replace(/\s+/g, ' ')).join('|');

export function readCsv(rows: string[][], map: CsvMap, kind: string): Read {
  const idx = (role: string) => map.cols.indexOf(role);
  const txns: Txn[] = [];
  rows.slice(1).forEach((r, i) => {
    const ds = datesIn(r[idx('date')] || '', map.dateFmt);
    if (!ds.length) return;
    let debit = 0, credit = 0;
    if (idx('amount') >= 0) { const a = moneyIn(r[idx('amount')] || '') ?? 0; if (a < 0) debit = -a; else credit = a; }
    else { debit = Math.abs(moneyIn(r[idx('debit')] || '') ?? 0); credit = Math.abs(moneyIn(r[idx('credit')] || '') ?? 0); }
    const b = idx('balance') >= 0 ? moneyIn(r[idx('balance')] || '') : null;
    if (balanceOnly(idx('desc') >= 0 ? r[idx('desc')] : '', debit, credit)) return;
    txns.push({ date: ds[0], description: idx('desc') >= 0 ? r[idx('desc')] : '', debit: r2(debit), credit: r2(credit), balance: b, rate: null, page: 1, row: i });
  });
  // newest-first exports are turned around so the running balance reads forwards
  if (txns.length > 1 && txns[0].date > txns[txns.length - 1].date) txns.reverse();
  const first = txns[0];
  const opening = first && first.balance != null ? r2(first.balance - (first.credit - first.debit) * (kind === 'loan' ? -1 : 1)) : null;
  return finish({ format: 'CSV', pages: 1, period: null, opening, closing: null, interest: null, credits: null, debits: null, advance: null, rate: null, acct: '', txns, checks: [], ok: false }, kind);
}

type LayoutRow = Awaited<ReturnType<typeof loadLayouts>>[number];
export async function loadLayouts() { return db.layout.findMany({ where: { deletedAt: null }, include: { versions: { orderBy: { version: 'desc' } } } }); }

/** Finds the layout (and version) that reads this file best: every version of every layout is tried. */
export async function matchFile(buf: Buffer, name: string, mime: string, force?: string | null) {
  const isCsv = /\.csv$/i.test(name) || /csv|text\/plain/.test(mime);
  const layouts = await loadLayouts();
  if (force) {
    // a version the person chose: read with it whether it fits or not
    const l = layouts.find((x) => x.versions.some((v) => v.id === force));
    const v = l?.versions.find((x) => x.id === force);
    if (l && v) {
      if (isCsv) { const rows = parseCsv(buf.toString('utf8').replace(/^\uFEFF/, '')); return { layout: l, version: v, read: readCsv(rows, v.map as unknown as CsvMap, l.kind), rows, forced: true }; }
      const pages = await pdfPages(buf);
      return { layout: l, version: v, read: readPdf(pages, v.map as unknown as PdfMap, l.kind), pages, forced: true };
    }
  }
  if (isCsv) {
    const rows = parseCsv(buf.toString('utf8').replace(/^\uFEFF/, ''));
    const hk = rows[0] ? headerKey(rows[0]) : '';
    for (const l of layouts.filter((x) => x.format === 'CSV')) for (const v of l.versions) {
      const m = v.map as unknown as CsvMap;
      if (m && m.header && headerKey(m.header) === hk) return { layout: l, version: v, read: readCsv(rows, m, l.kind), rows };
    }
    return { layout: null, version: null, read: null, rows };
  }
  return { ...pickPdf(await pdfPages(buf), layouts) };
}

/** Chooses the PDF layout (and version) that reads these pages best. */
export function pickPdf(pages: Page[], layouts: LayoutRow[]) {
  const first = (pages[0]?.text || '').toLowerCase();
  const has = textFinder(pages.map((p) => p.text).join(' '));
  // Every PDF layout reads the file; what it reads decides. The lender's name (on any page) and the layout's
  // optional identifying phrases only rank layouts that read it equally well: they never make a layout pass.
  let best: { layout: LayoutRow; version: LayoutRow['versions'][number]; read: Read; score: number; rank: number } | null = null;
  for (const l of layouts.filter((x) => x.format === 'PDF')) {
    const named = has(l.lenderName);
    for (const v of l.versions) {
      const rd = readPdf(pages, v.map as unknown as PdfMap, l.kind);
      const score = rd.checks.filter((c) => c.ok).length * 10 + (rd.period ? 3 : 0) + Math.min(5, rd.txns.length / 10) + (l.kind === 'loan' && /loan/.test(first) ? 2 : 0) + (l.kind === 'account' && !/loan/.test(first) ? 2 : 0);
      const phrases = pdfPhrases(v.fingerprint);
      const found = phrases.filter(has).length;
      const rank = score + (named ? 4 : 0) + found * 3 - (phrases.length && !found ? 3 : 0);
      if (!best || rank > best.rank) best = { layout: l, version: v, read: rd, score, rank };
    }
  }
  if (best && best.score >= 13) return { layout: best.layout, version: best.version, read: best.read, pages, remap: mostChecks(best.read) ? best.layout : null };
  // Close but not there: most of the checks pass, so the bank has probably moved something. Anything less is not this layout.
  const near = best && mostChecks(best.read) ? best.layout : null;
  return { layout: null, version: null, read: null, pages, near, remap: near };
}

/** True when most, but not all, of a reading's checks pass: the sign of a layout that needs re-mapping. */
export function mostChecks(rd: Read) {
  const n = rd.checks.length, ok = rd.checks.filter((c) => c.ok).length;
  return n > 0 && ok < n && ok / n >= 0.5;
}

/** The optional identifying phrases saved with a PDF layout version. */
export function pdfPhrases(fp: unknown): string[] {
  const p = (fp && typeof fp === 'object' ? (fp as { phrases?: unknown }).phrases : null);
  return Array.isArray(p) ? p.map((x) => String(x).trim()).filter(Boolean).slice(0, 10) : [];
}

/** Looks for a phrase in a statement's text, ignoring case and spacing. PDFs often break words into pieces
 *  ("Comm onwealth"), so longer phrases are also matched with spaces and punctuation removed. */
export function textFinder(text: string) {
  const all = ' ' + text.toLowerCase().replace(/\s+/g, ' ') + ' ';
  const squash = all.replace(/[^a-z0-9]/g, '');
  return (phrase: string) => {
    const x = String(phrase || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!x) return false;
    const sx = x.replace(/[^a-z0-9]/g, '');
    // short names (ING, ANZ) only count as whole words, so "billing" is not ING
    if (sx.length < 5) return new RegExp('(^|[^a-z0-9])' + x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9])').test(all);
    return all.includes(x) || squash.includes(sx);
  };
}

const DAY_MS = 86400000;
const isInterest = (t: { description: string; debit: number }) => /interest/i.test(t.description) && !/rate/i.test(t.description) && t.debit > 0;

/** The day of the month the bank charges interest, read from the statement's own interest lines (the most common
 *  day among them), or null when it has none. */
export function chargeDay(read: Pick<Read, 'txns'>): number | null {
  const days: Record<number, number> = {};
  for (const t of read.txns) if (isInterest(t)) { const d = Number(t.date.slice(8, 10)); days[d] = (days[d] || 0) + 1; }
  const best = Object.entries(days).sort((a, b) => b[1] - a[1])[0];
  return best ? Number(best[0]) : null;
}

/**
 * Engine check for loans without an offset: works the interest out from the daily balances and compares.
 * - Interest is charged on the loan's posting day if set, else the day the statement's interest lines fall on.
 * - The first charge in a statement covers days before it starts, so counting begins the day after the previous
 *   charge (at the opening balance).
 * - Each day uses the rate in effect that day: the statement's rate lines, plus rate changes confirmed in Folio
 *   that fall within the statement (a statement line wins on the same day).
 */
export function engineInterest(read: Read, opts: { rateAt: (iso: string) => number; confirmed: { date: string; rate: number }[]; postingDay?: number | null; usualDay?: number | null; dayCount?: number; bankCharges?: boolean }) {
  if (!read.period || read.opening == null) return null;
  const start = new Date(read.period.start + 'T00:00:00Z'), end = new Date(read.period.end + 'T00:00:00Z');
  // the loan's posting day; else the day this statement's interest lines fall on; else the day the loan's other
  // statements show (usualDay); else, as a last resort, the statement's last day
  const postingDay = opts.postingDay || chargeDay(read) || opts.usualDay || end.getUTCDate();
  // the previous charge: the latest posting day before the statement starts (looking back up to a month)
  let from = start;
  for (let d = new Date(start.getTime() - DAY_MS), i = 0; i < 31; i++, d = new Date(d.getTime() - DAY_MS)) {
    if (d.getUTCDate() === postingDay) { from = new Date(d.getTime() + DAY_MS); break; }
  }
  const moves = read.txns.filter((t) => !/interest/i.test(t.description) && (t.credit || t.debit)).map((t) => ({ date: new Date(t.date + 'T00:00:00Z'), splitId: 's', amount: new Decimal(t.credit).minus(t.debit) }));
  // the rate before the statement: its opening rate line when it has one, else the rate Folio knows for that day
  const lines = read.txns.filter((t) => t.rate != null) as (Read['txns'][number] & { rate: number })[];
  const opening = lines.find((t) => t.date <= read.period!.start);
  const fromIso = from.toISOString().slice(0, 10);
  const rates: { from: Date; rate: number }[] = [{ from: new Date(0), rate: opening ? opening.rate : opts.rateAt(fromIso) }];
  const fromLines = new Set(lines.map((t) => t.date));
  for (const c of opts.confirmed) if (c.date > fromIso && c.date <= read.period.end && !fromLines.has(c.date)) rates.push({ from: new Date(c.date + 'T00:00:00Z'), rate: c.rate });
  for (const t of lines) rates.push({ from: new Date(t.date + 'T00:00:00Z'), rate: t.rate });
  // bankCharges: the balance carries the interest the bank charged (from the day after each charge), not Folio's own
  // figure, so an offset's saving is not compounded into the following months
  const charges = opts.bankCharges ? read.txns.filter((t) => /interest/i.test(t.description) && t.debit > 0).map((t) => ({ date: new Date(new Date(t.date + 'T00:00:00Z').getTime() + DAY_MS), splitId: 's', amount: new Decimal(-t.debit) })) : [];
  const res = runDaily({ splits: [{ id: 's', name: 's', kind: 'VARIABLE', balance: read.opening, rates }], movements: moves.concat(charges), postingDay, dayCount: opts.dayCount ?? 365, capitalise: !opts.bankCharges }, from, end);
  return res.totalInterest.toNumber();
}
