import { type Action, type Ctx, db, Fail, hh, need, str } from '../actions';
import { interestStatus, saveImport } from '../imports';
import { matchFile, offsetBenefitIn, pdfPages, UNREADABLE, type Read } from '../importer';

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
    const m = await matchFile(Buffer.from(f!.data), f!.name, f!.mime, versionId).catch(() => { throw new Fail(UNREADABLE); });
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
  /** Runs the interest check again on loan statements you can see (after a rate or posting-day change, or a fix to
   *  the check). A statement that now matches becomes Reconciled; one that differs is flagged, unless someone has
   *  already reviewed it and kept the statement's figure. */
  recheckStatements: async (c) => {
    const ids = (Array.isArray(c.p.ids) ? c.p.ids : [c.p.id]).map(String);
    const out = { checked: 0, reconciled: 0, attention: 0, notes: [] as string[] };
    for (const id of ids) {
      const s = await myStatement(c, id);
      if (!s.splitId) continue;
      const split = await db.loanSplit.findUnique({ where: { id: s.splitId }, include: { loan: { include: { lender: true, offsetAccounts: { where: { deletedAt: null, closedAt: null } } } } } });
      if (!split || split.loan.offsetAccounts.length) continue; // interest is not re-worked for loans with an offset
      const txns = await db.txn.findMany({ where: { statementId: s.id }, orderBy: [{ date: 'asc' }, { row: 'asc' }] });
      const iso = (d: Date) => d.toISOString().slice(0, 10);
      // statements imported before the offset benefit was kept: read it from the stored PDF once (0 when it prints none)
      let benefit = s.offsetBenefit == null ? null : Number(s.offsetBenefit);
      if (benefit == null && s.fileId) {
        const f = await db.storedFile.findUnique({ where: { id: s.fileId } });
        if (f && f.mime === 'application/pdf') {
          try { benefit = offsetBenefitIn(await pdfPages(Buffer.from(f.data))) ?? 0; await db.statement.update({ where: { id: s.id }, data: { offsetBenefit: benefit } }); } catch { /* checked without it */ }
        }
      }
      const read = {
        period: { start: iso(s.periodStart), end: iso(s.periodEnd) }, opening: Number(s.opening), closing: Number(s.closing), interest: Number(s.interest), offsetBenefit: benefit,
        txns: txns.map((t) => ({ date: iso(t.date), description: t.description, debit: Number(t.debit), credit: Number(t.credit), balance: t.balance == null ? null : Number(t.balance), rate: t.rate == null ? null : Number(t.rate) }))
      } as unknown as Read;
      const r = await interestStatus(read, { id: split.id, postingDay: split.loan.postingDay, dayCount: split.loan.lender.dayCount });
      out.checked++;
      if (r.status === 'Reconciled') { out.reconciled++; await db.statement.update({ where: { id: s.id }, data: { status: 'Reconciled', statusNote: null } }); }
      else { out.attention++; if (r.note) out.notes.push(r.note); if (!s.reviewedAt) await db.statement.update({ where: { id: s.id }, data: { status: 'Needs attention', statusNote: r.note } }); }
    }
    return out;
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
