import JSZip from 'jszip';
import { currentMembership, currentUser, twoStepBlock } from '@/lib/server/auth';
import { db } from '@/lib/server/db';
import { householdCategories } from '@/lib/server/catdata';
import { queryTxns, type TxnRow } from '@/lib/server/txnquery';
import { transactionsCsv, transactionsPdf, type ExportRow, type StatementLink } from '@/lib/server/txnexport';
import { accountScope } from '@/lib/server/txnscope';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * An account's transactions, with the list's filters, as CSV and/or PDF: format=csv|pdf|both, files=1 to put the
 * statement files beside them in a ZIP. Each row links to its statement: the file in the ZIP, or else the statement on
 * the Folio server (opened at its page once signed in). Only the account's holders can export it.
 */
export async function GET(req: Request) {
  const u = await currentUser();
  if (!u) return new Response('Sign in again', { status: 401 });
  { const blocked = await twoStepBlock(u); if (blocked) return blocked; } // required two-step not on yet
  const { m } = await currentMembership(u);
  if (!m) return new Response('Not found', { status: 404 });
  const url = new URL(req.url), p = url.searchParams;
  // one account, or (account=all) every account the person holds
  const scope = await accountScope(u.id, m.householdId, p.get('account'));
  if (!scope) return new Response('Not found', { status: 404 });
  const account = { name: scope.name };
  const statements = await db.statement.findMany({ where: { accountId: { in: scope.accounts.map((a) => a.id) }, deletedAt: null }, select: { id: true, periodEnd: true, accountId: true, file: { select: { id: true, name: true } } }, orderBy: { periodEnd: 'asc' } });
  const stAccount = new Map(statements.map((s) => [s.id, s.accountId || '']));
  const txns = await db.txn.findMany({ where: { statementId: { in: statements.map((s) => s.id) } }, select: { id: true, date: true, description: true, debit: true, credit: true, balance: true, category: true, statementId: true, page: true } });
  const rows: TxnRow[] = txns.map((t) => ({ id: t.id, date: t.date.toISOString().slice(0, 10), description: t.description, debit: Number(t.debit), credit: Number(t.credit), balance: t.balance == null ? null : Number(t.balance), category: t.category, accountId: stAccount.get(t.statementId) || '', statementId: t.statementId }));
  const pageOf = new Map(txns.map((t) => [t.id, t.page || 1]));
  const num = (k: string) => { const v = p.get(k); return v == null || v === '' || !isFinite(Number(v)) ? null : Number(v); };
  const isoOr = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
  const dir = p.get('dir');
  const f = { q: (p.get('q') || '').slice(0, 100), dir: (dir === 'in' || dir === 'out' ? dir : '') as 'in' | 'out' | '', year: (p.get('year') || '').slice(0, 4), month: (p.get('month') || '').slice(0, 2), from: isoOr(p.get('from')), to: isoOr(p.get('to')), cat: (p.get('cat') || '').slice(0, 60), min: num('min'), max: num('max') };
  const { own, rules } = await householdCategories(m.householdId);
  const r = queryTxns(rows, rules, own, f);
  const format = ['csv', 'pdf', 'both'].includes(String(p.get('format'))) ? String(p.get('format')) : 'csv';
  const withFiles = p.get('files') === '1';
  // where each statement's file goes in the ZIP, or its address on the server
  const origin = (process.env.FOLIO_URL || url.origin).replace(/\/$/, '');
  const used = new Set<string>();
  const fileName = new Map<string, string>();
  for (const s of statements) {
    if (!s.file) continue;
    let fn = ((scope.nameOf.get(s.accountId || '') || account.name) + ' ' + s.periodEnd.toISOString().slice(0, 10)).replace(/[^\w.\- ]/g, '_') + (/\.csv$/i.test(s.file.name) ? '.csv' : '.pdf');
    while (used.has(fn)) fn = fn.replace(/(\.\w+)$/, ' (2)$1');
    used.add(fn);
    fileName.set(s.id, fn);
  }
  const fileOf = new Map(statements.map((s) => [s.id, s.file]));
  const linkOf = (statementId: string, page: number): StatementLink | null => {
    const file = fileOf.get(statementId), fn = fileName.get(statementId);
    if (!file || !fn) return null;
    return withFiles ? { kind: 'file', target: 'statements/' + fn, page, label: fn.replace(/\.\w+$/, '') } : { kind: 'url', target: origin + '/api/file/' + file.id, page, label: fn.replace(/\.\w+$/, '') };
  };
  const out: ExportRow[] = r.rows.map((t) => ({ date: t.date, desc: t.description, acct: scope.all ? scope.nameOf.get(t.accountId) || '' : undefined, cat: t.cat, debit: t.debit, credit: t.credit, bal: t.balance, link: linkOf(t.statementId, pageOf.get(t.id) || 1) }));
  const parts = [f.q && 'matching "' + f.q + '"', f.dir === 'in' ? 'money in' : f.dir === 'out' ? 'money out' : '', f.cat === '__auto' ? 'not categorised' : f.cat, f.year && (f.month ? f.month + '/' : '') + f.year, f.from && f.from + ' to ' + (f.to || 'now'), f.min != null && 'from $' + f.min, f.max != null && 'up to $' + f.max].filter(Boolean);
  const info = { account: account.name, filters: parts.length ? 'Filtered: ' + parts.join(', ') : 'All transactions', exported: new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }), sumIn: r.sumIn, sumOut: r.sumOut };
  const stamp = new Date().toISOString().slice(0, 10);
  const base = ('folio-' + account.name + '-transactions-' + stamp).replace(/[^\w.\-]/g, '_');
  const csv = format !== 'pdf' ? transactionsCsv(out) : null;
  const pdf = format !== 'csv' ? await transactionsPdf(out, info) : null;
  if (!withFiles && format !== 'both') {
    return csv != null
      ? new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${base}.csv"` } })
      : new Response(pdf as unknown as BodyInit, { headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${base}.pdf"` } });
  }
  const zip = new JSZip();
  if (csv != null) zip.file('transactions.csv', csv);
  if (pdf) zip.file('transactions.pdf', pdf);
  if (withFiles) {
    const needed = new Set(r.rows.map((t) => t.statementId));
    for (const s of statements) {
      if (!needed.has(s.id) || !s.file) continue;
      const f2 = await db.storedFile.findUnique({ where: { id: s.file.id }, select: { data: true } });
      if (f2) zip.file('statements/' + fileName.get(s.id), f2.data);
    }
  }
  const z = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return new Response(z as unknown as BodyInit, { headers: { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${base}.zip"` } });
}
