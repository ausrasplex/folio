import { type Action, type Ctx, db, hh, need, str } from '../actions';
import { saveImport } from '../imports';
import { matchFile } from '../importer';

/** A statement on a loan or account you can see. */
async function myStatement(c: Ctx, id: unknown, deleted = false) {
  const s = await db.statement.findFirst({ where: { id: str(id), householdId: hh(c), deletedAt: deleted ? { not: null } : null, OR: [{ split: { loan: { borrowers: { some: { userId: c.u.id } } } } }, { account: { holders: { some: { userId: c.u.id } } } }] } });
  need(s, 'That statement is not one of yours.');
  return s!;
}

export const statementActions: Record<string, Action> = {
  importConfirm: async (c) => {
    const out = [];
    const items = Array.isArray(c.p.items) ? c.p.items : [{ fileId: c.p.fileId, dest: c.p.dest }];
    for (const it of items) {
      try { out.push({ fileId: it.fileId, ok: true, ...(await saveImport({ fileId: str(it.fileId), destId: str(it.dest), userId: c.u.id, householdId: hh(c) })) }); }
      catch (e) { out.push({ fileId: it.fileId, ok: false, error: e instanceof Error ? e.message : 'Could not import' }); }
    }
    return { results: out };
  },
  /** Read a waiting file again with a layout version the person chose (or the automatic match when versionId is empty). */
  importReread: async (c) => {
    const f = await db.storedFile.findUnique({ where: { id: str(c.p.fileId) } });
    const pend = (f?.pending || null) as { householdId?: string; versionId?: string } | null;
    need(f && pend && pend.householdId === hh(c), 'That file is not waiting to be imported.');
    const versionId = str(c.p.versionId) || null;
    await db.storedFile.update({ where: { id: f!.id }, data: { pending: { ...pend, versionId } } });
    const m = await matchFile(Buffer.from(f!.data), f!.name, f!.mime, versionId);
    return {
      layout: m.layout ? { id: m.layout.id, name: m.layout.name, lenderName: m.layout.lenderName, kind: m.layout.kind, version: m.version!.version, versionId: m.version!.id } : null,
      read: m.read, forced: !!versionId
    };
  },
  importDiscard: async (c) => {
    const ids = (Array.isArray(c.p.ids) ? c.p.ids : [c.p.fileId]).map(String);
    const files = await db.storedFile.findMany({ where: { id: { in: ids }, statements: { none: {} } } });
    for (const f of files) if ((f.pending as { householdId?: string } | null)?.householdId === hh(c)) await db.storedFile.delete({ where: { id: f.id } });
  },
  reviewStatement: async (c) => {
    const s = await myStatement(c, c.p.id);
    await db.statement.update({ where: { id: s.id }, data: { reviewedAt: new Date(), reviewNote: str(c.p.note, 300) || null, status: s.status === 'Needs attention' ? 'Reconciled' : s.status } });
  },
  deleteStatements: async (c) => {
    const ids = (Array.isArray(c.p.ids) ? c.p.ids : [c.p.id]).map(String);
    for (const id of ids) { const s = await myStatement(c, id); await db.statement.update({ where: { id: s.id }, data: { deletedAt: new Date(), deletedById: c.u.id, deleteReason: str(c.p.reason, 200) || null } }); }
    return { count: ids.length };
  },
  restoreStatement: async (c) => {
    const s = await myStatement(c, c.p.id, true);
    const clash = await db.statement.findFirst({ where: { deletedAt: null, periodEnd: s.periodEnd, OR: [{ splitId: s.splitId ?? undefined }, { accountId: s.accountId ?? undefined }].filter((x) => Object.values(x)[0]) } });
    need(!clash, 'Another statement for this period is already there.');
    await db.statement.update({ where: { id: s.id }, data: { deletedAt: null, deletedById: null, deleteReason: null } });
  }
};
