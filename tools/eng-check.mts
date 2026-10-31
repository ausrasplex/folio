import { PrismaClient } from '@prisma/client';
import { engineInterest } from '../src/lib/server/importer.ts';
const db = new PrismaClient();
for (const nm of ['Car loan', 'Investment Property']) {
  const st = await db.statement.findFirst({ where: { deletedAt: null, split: { loan: { name: nm } } }, orderBy: { periodEnd: 'desc' }, include: { txns: { orderBy: [{ date: 'asc' }, { row: 'asc' }] }, split: { include: { rateChanges: true, loan: true } } } });
  const read: any = { period: { start: st!.periodStart.toISOString().slice(0, 10), end: st!.periodEnd.toISOString().slice(0, 10) }, opening: Number(st!.opening), txns: st!.txns.map((t) => ({ date: t.date.toISOString().slice(0, 10), description: t.description, debit: Number(t.debit), credit: Number(t.credit), rate: t.rate == null ? null : Number(t.rate) })) };
  const calc = engineInterest(read, () => Number(st!.split!.startRate), st!.split!.loan.postingDay!, 365);
  console.log(nm, 'statement', Number(st!.interest), 'engine', calc);
}
await db.$disconnect();
