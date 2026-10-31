import { db } from './db';

/** Where-clause for statements the person can see: on a loan they borrow on, or an account they hold. */
export const myStatements = (userId: string, householdId: string, deleted: boolean | null = false) => ({
  householdId,
  ...(deleted === null ? {} : { deletedAt: deleted ? { not: null } : null }),
  OR: [{ split: { loan: { borrowers: { some: { userId } } } } }, { account: { holders: { some: { userId } } } }]
});

/** A stored file the person may open: it belongs to one of their statements, or it is their own upload waiting for review. */
export async function myFile(userId: string, householdId: string, id: string) {
  const f = await db.storedFile.findUnique({ where: { id } });
  if (!f) return null;
  const pend = f.pending as { householdId?: string; userId?: string } | null;
  if (pend && pend.householdId === householdId && pend.userId === userId) return f;
  const st = await db.statement.findFirst({ where: { fileId: f.id, ...myStatements(userId, householdId, null) } });
  return st ? f : null;
}
