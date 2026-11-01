// Which accounts a transactions request covers: one account, or ("all") every account the person holds.
import { db } from './db';

export async function accountScope(userId: string, householdId: string, param: string | null) {
  const id = String(param || '');
  const accounts = await db.account.findMany({
    where: { householdId, deletedAt: null, holders: { some: { userId } }, ...(id === 'all' ? {} : { id }) },
    select: { id: true, name: true },
    orderBy: { name: 'asc' }
  });
  if (!id || !accounts.length) return null;
  return { all: id === 'all', accounts, name: id === 'all' ? 'All accounts' : accounts[0].name, nameOf: new Map(accounts.map((a) => [a.id, a.name])) };
}
