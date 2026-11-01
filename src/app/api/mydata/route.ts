import JSZip from 'jszip';
import { currentMembership, currentUser, twoStepBlock } from '@/lib/server/auth';
import { db } from '@/lib/server/db';
import { dec } from '@/lib/server/crypto';
import { categoryOf } from '@/lib/server/categories';
import { householdCategories } from '@/lib/server/catdata';

export const dynamic = 'force-dynamic';
const q = (v: unknown) => { const s = v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const csv = (head: string[], rows: unknown[][]) => [head.join(',')].concat(rows.map((r) => r.map(q).join(','))).join('\n') + '\n';
const safe = (s: string) => s.replace(/[^\w.\- ]/g, '_');

/** Your own data in this household: the loans you borrow on and the accounts you hold. fmt=csv|json, files=1 adds the original statements. */
export async function GET(req: Request) {
  const u = await currentUser();
  if (!u) return new Response('Sign in again', { status: 401 });
  { const blocked = await twoStepBlock(u); if (blocked) return blocked; } // required two-step not on yet
  const { m } = await currentMembership(u);
  if (!m) return new Response('Not found', { status: 404 });
  const sp = new URL(req.url).searchParams;
  const fmt = sp.get('fmt') === 'json' ? 'json' : 'csv', withFiles = sp.get('files') === '1';
  const loans = await db.loan.findMany({ where: { householdId: m.householdId, borrowers: { some: { userId: u.id } } }, include: { lender: true, splits: { include: { rateChanges: true, repaymentChanges: true, statements: { where: { deletedAt: null }, include: { txns: true, file: withFiles } } } }, events: true } });
  const accts = await db.account.findMany({ where: { householdId: m.householdId, deletedAt: null, holders: { some: { userId: u.id } } }, include: { lender: true, statements: { where: { deletedAt: null }, include: { txns: true, file: withFiles } } } });
  const stamp = new Date().toISOString().slice(0, 10);
  const zip = new JSZip();
  const strip = <T extends Record<string, unknown>>(o: T) => JSON.parse(JSON.stringify(o, (k, v) => (k === 'file' || k === 'data' ? undefined : v)));
  if (fmt === 'json') {
    const out = { exported: new Date().toISOString(), person: { name: u.displayName, email: u.email },
      loans: loans.map((l) => strip({ ...l, accountNumber: dec(l.accountNumber), customerId: dec(l.customerId) })),
      accounts: accts.map((a) => strip({ ...a, bsb: dec(a.bsb), number: dec(a.number) })) };
    if (!withFiles) return new Response(JSON.stringify(out, null, 2), { headers: { 'content-type': 'application/json', 'content-disposition': `attachment; filename="folio-my-data-${stamp}.json"` } });
    zip.file('folio-my-data.json', JSON.stringify(out, null, 2));
  } else {
    for (const l of loans) for (const s of l.splits) {
      const base = safe(l.name + (l.splits.length > 1 ? ' - ' + s.name : ''));
      zip.file(base + '/statements.csv', csv(['Start', 'End', 'Opening', 'Closing', 'Interest', 'Credits', 'Debits', 'Rate', 'Status'], s.statements.map((x) => [x.periodStart, x.periodEnd, x.opening, x.closing, x.interest, x.credits, x.debits, x.rate, x.status])));
      zip.file(base + '/transactions.csv', csv(['Date', 'Description', 'Debit', 'Credit', 'Balance', 'Rate'], s.statements.flatMap((x) => x.txns).sort((a, b) => +a.date - +b.date).map((t) => [t.date, t.description, t.debit, t.credit, t.balance, t.rate])));
      zip.file(base + '/rates.csv', csv(['From', 'Rate', 'Confirmed', 'Source'], [[l.startDate, s.startRate, true, 'start']].concat(s.rateChanges.filter((r) => !r.deletedAt).map((r) => [r.effectiveDate, r.rate, r.confirmed, r.source]))));
    }
    // each transaction's category as the app shows it: chosen by hand, else the household's rules, else the built-in guess
    const { rules } = await householdCategories(m.householdId);
    for (const a of accts) {
      const base = safe(a.name);
      zip.file(base + '/statements.csv', csv(['Start', 'End', 'Opening', 'Closing', 'Money in', 'Money out', 'Status'], a.statements.map((x) => [x.periodStart, x.periodEnd, x.opening, x.closing, x.credits, x.debits, x.status])));
      zip.file(base + '/transactions.csv', csv(['Date', 'Description', 'Debit', 'Credit', 'Balance', 'Category'], a.statements.flatMap((x) => x.txns).sort((p, q2) => +p.date - +q2.date).map((t) => [t.date, t.description, t.debit, t.credit, t.balance, categoryOf({ description: t.description, debit: Number(t.debit), credit: Number(t.credit), category: t.category, accountId: a.id }, rules).name])));
    }
  }
  if (withFiles) {
    const all = loans.flatMap((l) => l.splits.flatMap((s) => s.statements.map((x) => ({ x, name: l.name + (l.splits.length > 1 ? ' - ' + s.name : '') })))).concat(accts.flatMap((a) => a.statements.map((x) => ({ x, name: a.name }))));
    for (const { x, name } of all) if (x.file) zip.file('originals/' + safe(name) + '/' + x.periodEnd.toISOString().slice(0, 10) + (/\.csv$/i.test(x.file.name) ? '.csv' : '.pdf'), x.file.data);
  }
  const out = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return new Response(out as unknown as BodyInit, { headers: { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="folio-my-data-${stamp}.zip"` } });
}
