// Reads statement files on this server. PDFs: text with positions (pdf.js), then the saved layout's boxes say
import nodePath from 'path';
// which text is which. CSVs: the header row picks the layout, the layout says what each column holds.
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
  advance: number | null; rate: number | null; acct: string; txns: Txn[]; checks: Check[]; ok: boolean
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

export async function pdfPages(buf: Buffer): Promise<Page[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), disableFontFace: true, isEvalSupported: false, useSystemFonts: false, standardFontDataUrl: nodePath.join(process.cwd(), 'node_modules/pdfjs-dist/standard_fonts') + '/' }).promise;
  const pages: Page[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const p = await doc.getPage(n);
    const vp = p.getViewport({ scale: 1 });
    const tc = await p.getTextContent();
    const items: Item[] = [];
    for (const it of tc.items as { str: string; transform: number[]; width: number; height: number }[]) {
      if (!it.str || !it.str.trim()) continue;
      const [, , , dd, e, f] = it.transform;
      const h = Math.abs(it.height || dd || 10);
      items.push({ s: it.str, x: e / vp.width * 100, y: (vp.height - f - h * 0.8) / vp.height * 100, w: (it.width || 0) / vp.width * 100, h: h / vp.height * 100, page: n });
    }
    items.sort((a, b) => a.y - b.y || a.x - b.x);
    pages.push({ n, items, text: items.map((i) => i.s).join(' '), wPt: vp.width, hPt: vp.height });
  }
  await doc.destroy();
  return pages;
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

export function readPdf(pages: Page[], map: PdfMap, kind: string): Read {
  const f = (k: string) => textIn(pages, map[k]);
  const pd = datesIn(f('period'));
  const tb = map.table;
  const cols = (['cDate', 'cDesc', 'cDebit', 'cCredit', 'cBal'] as const).map((k) => map[k]);
  const txns: Txn[] = [];
  if (tb && cols[0] && cols[1]) {
    for (const p of pages.filter((x) => x.n >= tb.page)) {
      // on continuation pages the table runs from near the top, so widen the box upwards and downwards
      const box = p.n === tb.page ? tb.box : [tb.box[0], 3, tb.box[2], 94];
      const its = p.items.filter((it) => inBox(it, box));
      let row = 0;
      for (const ln of lines(its)) {
        const col = (c: Box | undefined) => c ? ln.filter((it) => { const cx = it.x + it.w / 2; return cx >= c.box[0] && cx <= c.box[0] + c.box[2]; }).map((it) => it.s).join(' ').trim() : '';
        const dTxt = col(cols[0]), desc = col(cols[1]), deb = col(cols[2]), cre = col(cols[3]), bal = col(cols[4]);
        const ds = datesIn(dTxt + (dTxt && !/\d{4}/.test(dTxt) && pd[1] ? ' ' + pd[1].slice(0, 4) : ''));
        if (ds.length) {
          const debit = Math.abs(moneyIn(deb) ?? 0), credit = Math.abs(moneyIn(cre) ?? 0), b = moneyIn(bal);
          txns.push({ date: ds[0], description: desc, debit: r2(debit), credit: r2(credit), balance: b == null ? null : r2(Math.abs(b)), rate: /rate/i.test(desc) ? rateIn(desc) : null, page: p.n, row: row++, y: Math.round(Math.min(...ln.map((it) => it.y)) * 100) / 100, yh: Math.round(Math.max(...ln.map((it) => it.h)) * 100) / 100 });
        } else if (txns.length && desc && !deb && !cre && !/^(date|description|transaction|details)/i.test(desc)) {
          txns[txns.length - 1].description += ' ' + desc; // wrapped line
          if (/rate/i.test(desc) && txns[txns.length - 1].rate == null) txns[txns.length - 1].rate = rateIn(desc);
        }
      }
    }
  }
  const num = (k: string) => { const v = moneyIn(f(k)); return v == null ? null : Math.abs(v); };
  const r: Read = {
    format: 'PDF', pages: pages.length, period: pd.length >= 2 ? { start: pd[0], end: pd[1] } : null,
    opening: num('opening'), closing: num('closing'), interest: kind === 'loan' ? num('interest') : null,
    credits: num('credits'), debits: kind === 'loan' ? num('debits') : num('debits'), advance: num('advance'), rate: rateIn(f('rate')),
    acct: (f('acct').match(/\d[\d\s-]{3,}\d/) || [''])[0].replace(/\s+/g, ' '), txns, checks: [], ok: false
  };
  return finish(r, kind);
}

/** Fills totals from the table where the summary did not give them, then runs the checks. */
function finish(r: Read, kind: string): Read {
  const sum = (k: 'debit' | 'credit', test?: (t: Txn) => boolean) => r2(r.txns.filter((t) => !test || test(t)).reduce((s, t) => s + t[k], 0));
  if (r.credits == null) r.credits = sum('credit');
  if (kind === 'loan') {
    if (r.interest == null) r.interest = sum('debit', (t) => /interest/i.test(t.description));
    if (r.debits == null) r.debits = r2(sum('debit') - (r.interest || 0));
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
    for (const t of r.txns) { if (t.balance == null) continue; const exp = r2(prev + sign * (t.debit - t.credit)); if (Math.abs(exp - t.balance) < 0.011 || (t.debit === 0 && t.credit === 0)) good++; prev = t.balance; }
    checks.push({ ok: good === withBal.length, text: good === withBal.length ? 'Running balance agrees on all ' + withBal.length + ' rows' + (r.pages > 1 ? ' across ' + r.pages + ' pages' : '') : 'Running balance agrees on ' + good + ' of ' + withBal.length + ' rows' });
  } else if (!r.txns.length) checks.push({ ok: false, text: 'No transactions were found in the table' });
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
    const rows = parseCsv(buf.toString('utf8').replace(/^﻿/, ''));
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

/** Engine check for loans without an offset: works the interest out from the daily balances and compares. */
export function engineInterest(read: Read, rateFrom: (iso: string) => number, postingDay: number, dayCount = 365) {
  if (!read.period || read.opening == null) return null;
  const start = new Date(read.period.start + 'T00:00:00Z'), end = new Date(read.period.end + 'T00:00:00Z');
  const moves = read.txns.filter((t) => !/interest/i.test(t.description) && (t.credit || t.debit)).map((t) => ({ date: new Date(t.date + 'T00:00:00Z'), splitId: 's', amount: new Decimal(t.credit).minus(t.debit) }));
  const rates: { from: Date; rate: number }[] = [{ from: new Date(0), rate: rateFrom(read.period.start) }];
  for (const t of read.txns) if (t.rate != null) rates.push({ from: new Date(t.date + 'T00:00:00Z'), rate: t.rate });
  const res = runDaily({ splits: [{ id: 's', name: 's', kind: 'VARIABLE', balance: read.opening, rates }], movements: moves, postingDay, dayCount }, start, end);
  return res.totalInterest.toNumber();
}
