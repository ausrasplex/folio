import { currentMembership, currentUser, twoStepBlock } from '@/lib/server/auth';
import { db } from '@/lib/server/db';
import { myStatements } from '@/lib/server/visible';

export const dynamic = 'force-dynamic';
const n = (v: unknown) => (v == null ? null : Number(v));

/** Transactions of one statement you can see (deleted ones too, so they can be looked at before restoring). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await currentUser();
  if (!u) return Response.json({ error: 'Sign in again' }, { status: 401 });
  { const blocked = await twoStepBlock(u); if (blocked) return blocked; } // required two-step not on yet
  const { m } = await currentMembership(u);
  if (!m) return Response.json({ error: 'Not found' }, { status: 404 });
  const { id } = await ctx.params;
  const s = await db.statement.findFirst({ where: { id, ...myStatements(u.id, m.householdId, null) }, include: { txns: { orderBy: [{ page: 'asc' }, { row: 'asc' }, { date: 'asc' }] } } });
  if (!s) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json({
    id: s.id,
    txns: s.txns.map((t) => ({ date: t.date.toISOString().slice(0, 10), desc: t.description, debit: n(t.debit) || 0, credit: n(t.credit) || 0, bal: n(t.balance), rate: n(t.rate), page: t.page, row: t.row, y: t.y, yh: t.yh, cat: t.category }))
  });
}
