// Saving a read statement into a loan split or an account.
import { Prisma } from '@prisma/client';
import { db } from './db';
import { categorize } from './state';
import { engineInterest, matchFile, type Read } from './importer';

export type Dest = { kind: 'split'; id: string; loanId: string; name: string; offset: boolean; postingDay: number | null; dayCount: number } | { kind: 'account'; id: string; name: string };

/** Loan splits and accounts the person can import into. */
export async function destinations(userId: string, householdId: string) {
  const loans = await db.loan.findMany({ where: { householdId, status: 'active', borrowers: { some: { userId } } }, include: { lender: true, splits: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } }, offsetAccounts: { where: { deletedAt: null, closedAt: null } } } });
  const accts = await db.account.findMany({ where: { householdId, deletedAt: null, closedAt: null, holders: { some: { userId } } }, include: { lender: true } });
  const out: (Dest & { lender: string; label: string; suffix?: string | null; numberTail?: string })[] = [];
  for (const l of loans) for (const s of l.splits) out.push({ kind: 'split', id: s.id, loanId: l.id, name: l.name + (l.splits.length > 1 ? ' · ' + s.name : ''), offset: l.offsetAccounts.length > 0, postingDay: l.postingDay, dayCount: l.lender.dayCount, lender: l.lender.name, label: l.splits.length > 1 ? 'Loan split' : 'Loan', suffix: s.accountSuffix });
  for (const a of accts) out.push({ kind: 'account', id: a.id, name: a.name, lender: a.lender.name, label: 'Account' });
  return out;
}

export async function guessDest(userId: string, householdId: string, lenderName: string | null, kind: string | null, read: Read | null) {
  const all = await destinations(userId, householdId);
  let c = all.filter((d) => (!lenderName || d.lender.toLowerCase() === lenderName.toLowerCase()) && (!kind || (kind === 'loan' ? d.kind === 'split' : d.kind === 'account')));
  if (read && read.acct) { const tail = read.acct.replace(/\D/g, '').slice(-2); const hit = c.filter((d) => 'suffix' in d && d.suffix && d.suffix.replace(/\D/g, '').slice(-2) === tail); if (hit.length === 1) c = hit; }
  if (c.length > 1 && read && read.period) {
    // a loan or account that already has this exact period wins (the duplicate is then reported); otherwise the one whose latest statement ends just before this one starts
    const st0 = +new Date(read.period.start + 'T00:00:00Z'), end0 = +new Date(read.period.end + 'T00:00:00Z');
    const scored = await Promise.all(c.map(async (d) => {
      const w = d.kind === 'split' ? { splitId: d.id, deletedAt: null } : { accountId: d.id, deletedAt: null };
      if (await db.statement.count({ where: { ...w, periodEnd: new Date(end0) } })) return { d, gap: 3 * 86400000 }; // a near-perfect continuation elsewhere still wins
      const last = await db.statement.findFirst({ where: { ...w, periodEnd: { lte: new Date(st0) } }, orderBy: { periodEnd: 'desc' } });
      return { d, gap: last ? st0 - +last.periodEnd : 1e13 };
    }));
    scored.sort((a, b) => a.gap - b.gap);
    return scored[0].d.id;
  }
  return c[0]?.id || '';
}

export async function saveImport(o: { fileId: string; destId: string; userId: string; householdId: string }) {
  const file = await db.storedFile.findUnique({ where: { id: o.fileId } });
  if (!file || !file.pending || (file.pending as { householdId?: string }).householdId !== o.householdId) throw new Error('That file is not waiting to be imported.');
  const dests = await destinations(o.userId, o.householdId);
  const dest = dests.find((d) => d.id === o.destId);
  if (!dest) throw new Error('Choose a loan or account you can see.');
  const m = await matchFile(Buffer.from(file.data), file.name, file.mime, (file.pending as { versionId?: string }).versionId || null);
  if (!m.read || !m.version) throw new Error('No saved layout reads this file yet. Map one first.');
  const read = m.read;
  if (!read.period || read.opening == null || read.closing == null) throw new Error('The statement period or balances could not be read.');
  if (!read.ok) throw new Error('This file does not add up with the matched layout: ' + read.checks.filter((c) => !c.ok).map((c) => c.text).join('. '));
  if ((m.layout!.kind === 'loan') !== (dest.kind === 'split')) throw new Error(m.layout!.kind === 'loan' ? 'This is a loan statement. Choose a loan.' : 'This is an account statement. Choose an account.');
  const where = dest.kind === 'split' ? { splitId: dest.id } : { accountId: dest.id };
  const end = new Date(read.period.end + 'T00:00:00Z'), start = new Date(read.period.start + 'T00:00:00Z');
  const dup = await db.statement.findFirst({ where: { ...where, deletedAt: null, periodEnd: end } });
  if (dup) throw new Error('A statement for this period is already imported for ' + dest.name + '.');
  // transactions already imported from an overlapping statement are skipped
  const existing = new Set((await db.txn.findMany({ where: { statement: { ...where, deletedAt: null }, date: { gte: start, lte: end } }, select: { date: true, debit: true, credit: true, description: true } })).map((t) => t.date.toISOString().slice(0, 10) + '|' + Number(t.debit) + '|' + Number(t.credit) + '|' + t.description));
  const fresh = read.txns.filter((t) => !existing.has(t.date + '|' + t.debit + '|' + t.credit + '|' + t.description));
  let status = dest.kind === 'split' ? 'Reconciled' : 'Imported', note: string | null = null;
  if (dest.kind === 'split' && !dest.offset && read.interest != null) {
    const sp = await db.loanSplit.findUnique({ where: { id: dest.id }, include: { rateChanges: { where: { deletedAt: null, confirmed: true }, orderBy: { effectiveDate: 'asc' } } } });
    const rateFrom = (isoD: string) => { let r = Number(sp!.startRate); for (const c of sp!.rateChanges) if (c.effectiveDate <= new Date(isoD + 'T00:00:00Z')) r = Number(c.rate); return r; };
    const pd = dest.postingDay || end.getUTCDate();
    const calc = engineInterest(read, rateFrom, pd, dest.dayCount);
    if (calc != null && Math.abs(calc - read.interest) > 0.011) { status = 'Needs attention'; note = 'Interest differs by $' + Math.abs(calc - read.interest).toFixed(2) + ' (statement $' + read.interest.toFixed(2) + ', Folio worked out $' + calc.toFixed(2) + ')'; }
  }
  const st = await db.statement.create({ data: {
    householdId: o.householdId, splitId: dest.kind === 'split' ? dest.id : null, accountId: dest.kind === 'account' ? dest.id : null,
    periodStart: start, periodEnd: end, opening: read.opening, closing: read.closing, interest: read.interest || 0, credits: read.credits || 0, debits: read.debits || 0,
    paymentsInAdvance: read.advance, rate: read.rate, status, statusNote: note, layoutVersionId: m.version.id, fileId: file.id, pages: read.pages, importedById: o.userId
  } });
  await db.txn.createMany({ data: fresh.map((t, i) => ({ statementId: st.id, date: new Date(t.date + 'T00:00:00Z'), description: t.description.slice(0, 300), debit: t.debit, credit: t.credit, balance: t.balance, rate: t.rate, page: t.page, row: t.row, y: t.y ?? null, yh: t.yh ?? null, category: dest.kind === 'account' ? categorize(t.description, t.credit) : null, dedupeKey: dest.id + ':' + t.date + ':' + i })) });
  // a new rate shown on a loan statement becomes a rate change to confirm
  if (dest.kind === 'split') {
    const sp = await db.loanSplit.findUnique({ where: { id: dest.id }, include: { rateChanges: { where: { deletedAt: null } } } });
    const known = (d: string, r: number) => sp!.rateChanges.some((c) => Math.abs(Number(c.rate) - r) < 0.0001 && Math.abs(+c.effectiveDate - +new Date(d + 'T00:00:00Z')) < 3 * 86400000);
    const lines = read.txns.filter((t) => t.rate != null) as (typeof read.txns[number] & { rate: number })[];
    for (const t of lines) if (!known(t.date, t.rate)) await db.rateChange.create({ data: { splitId: dest.id, effectiveDate: new Date(t.date + 'T00:00:00Z'), rate: t.rate, confirmed: false, source: 'statement' } });
    if (!lines.length && read.rate != null) {
      let cur = Number(sp!.startRate); for (const c of [...sp!.rateChanges].sort((a, b) => +a.effectiveDate - +b.effectiveDate)) if (c.effectiveDate <= end) cur = Number(c.rate);
      if (Math.abs(cur - read.rate) > 0.0001) await db.rateChange.create({ data: { splitId: dest.id, effectiveDate: end, rate: read.rate, confirmed: false, source: 'statement' } });
    }
  }
  await db.storedFile.update({ where: { id: file.id }, data: { pending: Prisma.DbNull } });
  return { statementId: st.id, status, note, skipped: read.txns.length - fresh.length };
}
