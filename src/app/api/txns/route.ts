import { currentMembership, currentUser, twoStepBlock } from '@/lib/server/auth';
import { db } from '@/lib/server/db';
import { householdCategories } from '@/lib/server/catdata';
import { queryTxns, type TxnRow } from '@/lib/server/txnquery';

export const dynamic = 'force-dynamic';

/** An account's transaction history, searched and filtered, a page at a time. Only the account's holders see it. */
export async function GET(req: Request) {
  const u = await currentUser();
  if (!u) return Response.json({ error: 'Sign in again' }, { status: 401 });
  { const blocked = await twoStepBlock(u); if (blocked) return blocked; } // required two-step not on yet
  const { m } = await currentMembership(u);
  if (!m) return Response.json({ error: 'Not found' }, { status: 404 });
  const p = new URL(req.url).searchParams;
  const account = await db.account.findFirst({ where: { id: String(p.get('account') || ''), householdId: m.householdId, deletedAt: null, holders: { some: { userId: u.id } } }, select: { id: true } });
  if (!account) return Response.json({ error: 'Not found' }, { status: 404 });
  const txns = await db.txn.findMany({
    where: { statement: { accountId: account.id, deletedAt: null } },
    select: { id: true, date: true, description: true, debit: true, credit: true, balance: true, category: true, statementId: true }
  });
  const rows: TxnRow[] = txns.map((t) => ({ id: t.id, date: t.date.toISOString().slice(0, 10), description: t.description, debit: Number(t.debit), credit: Number(t.credit), balance: t.balance == null ? null : Number(t.balance), category: t.category, accountId: account.id, statementId: t.statementId }));
  const num = (k: string) => { const v = p.get(k); return v == null || v === '' || !isFinite(Number(v)) ? null : Number(v); };
  const dir = p.get('dir');
  const { own, rules } = await householdCategories(m.householdId);
  const r = queryTxns(rows, rules, own, { q: (p.get('q') || '').slice(0, 100), dir: dir === 'in' || dir === 'out' ? dir : '', year: (p.get('year') || '').slice(0, 4), month: (p.get('month') || '').slice(0, 2), cat: (p.get('cat') || '').slice(0, 60), min: num('min'), max: num('max') });
  const size = Math.min(200, Math.max(10, num('size') ?? 50)), page = Math.max(0, num('page') ?? 0);
  return Response.json({
    ...r, rows: r.rows.slice(page * size, page * size + size).map((t) => ({ id: t.id, date: t.date, desc: t.description, debit: t.debit, credit: t.credit, bal: t.balance, cat: t.cat, catBy: t.catBy, ruleId: t.ruleId })),
    page, size
  });
}
