// Saving a read statement into a loan split or an account.
import { Prisma } from '@prisma/client';
import { db } from './db';
import { dec } from './crypto';
import { chargeDay, engineInterest, matchFile, type Read } from './importer';
import { rateInEffect, tidyRateRepeats } from './rates';

export { rateInEffect };

export type Dest = { kind: 'split'; id: string; loanId: string; name: string; offset: boolean; postingDay: number | null; dayCount: number } | { kind: 'account'; id: string; name: string };

/** Loan splits and accounts the person can import into. */
export async function destinations(userId: string, householdId: string) {
  const loans = await db.loan.findMany({ where: { householdId, status: 'active', borrowers: { some: { userId } } }, include: { lender: true, splits: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } }, offsetAccounts: { where: { deletedAt: null, closedAt: null } } } });
  const accts = await db.account.findMany({ where: { householdId, deletedAt: null, closedAt: null, holders: { some: { userId } } }, include: { lender: true } });
  const out: (Dest & { lender: string; label: string; suffix?: string; suffixSaved?: boolean; number?: string })[] = [];
  // a split without a saved suffix is 01, 02 … in order, as the screens show it
  for (const l of loans) l.splits.forEach((s, k) => out.push({ kind: 'split', id: s.id, loanId: l.id, name: l.name + (l.splits.length > 1 ? ' · ' + s.name : ''), offset: l.offsetAccounts.length > 0, postingDay: l.postingDay, dayCount: l.lender.dayCount, lender: l.lender.name, label: l.splits.length > 1 ? 'Loan split' : 'Loan', suffix: s.accountSuffix || String(k + 1).padStart(2, '0'), suffixSaved: !!s.accountSuffix, number: digits(dec(l.accountNumber)) }));
  for (const a of accts) out.push({ kind: 'account', id: a.id, name: a.name, lender: a.lender.name, label: 'Account' });
  return out;
}

const digits = (s: string | null | undefined) => (s || '').replace(/\D/g, '');

/** The loan splits the account number on a statement points to: the loan whose account number it contains, then the split whose suffix it ends with. */
export function byAccount<D extends { kind: string; suffix?: string; number?: string }>(cands: D[], acct: string | null | undefined): { hits: D[]; byNumber: boolean } {
  const a = digits(acct);
  if (a.length < 2) return { hits: [], byNumber: false };
  let c = cands.filter((d) => d.kind === 'split');
  // the loan number may have been typed with a split suffix on the end (…01), so it also matches without its last two digits
  const core = (n: string) => (n.length >= 8 ? n.slice(0, -2) : n);
  const numbered = c.filter((d) => d.number && d.number.length >= 4 && (a.includes(d.number) || a.slice(0, -2).includes(core(d.number))));
  // a loan whose number is on file and is not on the statement is not this loan
  c = numbered.length ? numbered : c.filter((d) => !d.number || d.number.length < 4);
  const tail = a.slice(-2);
  const hit = c.filter((d) => d.suffix && digits(d.suffix).slice(-2).padStart(2, '0') === tail);
  return { hits: hit.length ? hit : numbered, byNumber: numbered.length > 0 };
}

/** A destination chosen before the upload (from a loan or a split's row) gives way to the split the statement's account number names: another split of the same loan, or a split whose loan number matches. */
export async function checkDest(userId: string, householdId: string, dest: string, read: Read | null) {
  if (!read || !read.acct) return dest;
  const all = await destinations(userId, householdId);
  const cur = all.find((d) => d.id === dest);
  if (!cur || cur.kind !== 'split') return dest;
  // only a suffix that was saved (typed in, or learnt from a statement) can move it; the 01, 02 … guess cannot
  const { hits, byNumber } = byAccount(all.map((d) => ('suffixSaved' in d && !d.suffixSaved ? { ...d, suffix: undefined } : d)), read.acct);
  if (hits.length !== 1 || hits[0].id === dest) return dest;
  const h = hits[0];
  return h.kind === 'split' && (byNumber || h.loanId === cur.loanId) ? h.id : dest;
}

export async function guessDest(userId: string, householdId: string, lenderName: string | null, kind: string | null, read: Read | null) {
  const all = await destinations(userId, householdId);
  let c = all.filter((d) => (!lenderName || d.lender.toLowerCase() === lenderName.toLowerCase()) && (!kind || (kind === 'loan' ? d.kind === 'split' : d.kind === 'account')));
  if (read && read.acct) { const { hits } = byAccount(c, read.acct); if (hits.length >= 1 && hits.length < c.length) c = hits; }
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

/** Folio's interest check for a statement on a loan split with no linked offset accounts. Used on import and by Check again.
 *  When the statement prints an offset benefit, that is taken as true: Folio works the interest out with no offset, on the
 *  balance the bank charged, and takes the benefit off. */
export async function interestStatus(read: Read, dest: { id: string; postingDay: number | null; dayCount: number }): Promise<{ status: string; note: string | null }> {
  if (read.interest == null) return { status: 'Reconciled', note: null };
  const sp = await db.loanSplit.findUnique({ where: { id: dest.id }, include: { rateChanges: { where: { deletedAt: null, confirmed: true }, orderBy: { effectiveDate: 'asc' } } } });
  const confirmed = (sp?.rateChanges || []).map((c) => ({ date: c.effectiveDate.toISOString().slice(0, 10), rate: Number(c.rate) }));
  const rateAt = (iso: string) => { let r = Number(sp?.startRate ?? 0); for (const c of confirmed) if (c.date <= iso) r = c.rate; return r; };
  // the day the bank charges interest on this loan, from its other statements (for a statement with no charges of its own)
  const usualDay = dest.postingDay ? null : chargeDay({ txns: (await db.txn.findMany({ where: { statement: { splitId: dest.id, deletedAt: null }, description: { contains: 'interest', mode: 'insensitive' }, debit: { gt: 0 } }, select: { date: true, description: true, debit: true } })).map((t) => ({ date: t.date.toISOString().slice(0, 10), description: t.description, debit: Number(t.debit) })) } as unknown as Pick<Read, 'txns'>);
  const benefit = read.offsetBenefit && read.offsetBenefit > 0 ? read.offsetBenefit : 0;
  const gross = engineInterest(read, { rateAt, confirmed, postingDay: dest.postingDay, usualDay, dayCount: dest.dayCount, bankCharges: benefit > 0 });
  if (gross == null) return { status: 'Reconciled', note: null };
  // an interest adjustment (a credit such as INT ADJUSTMENT) is netted into the statement's interest figure
  const adjust = Math.round(read.txns.filter((t) => t.credit > 0 && /\bint(erest)?\b/i.test(t.description) && /adj/i.test(t.description)).reduce((s, t) => s + t.credit, 0) * 100) / 100;
  const calc = Math.round((gross - benefit - adjust) * 100) / 100;
  const after = (benefit ? ', after the statement\'s offset benefit of $' + benefit.toFixed(2) : '') + (adjust ? (benefit ? ' and' : ', after') + ' an interest adjustment of $' + adjust.toFixed(2) : '');
  if (Math.abs(calc - read.interest) <= 0.011) return { status: 'Reconciled', note: benefit || adjust ? 'Interest matches' + after : null };
  return { status: 'Needs attention', note: 'Interest differs by $' + Math.abs(calc - read.interest).toFixed(2) + ' (statement $' + read.interest.toFixed(2) + ', Folio worked out $' + calc.toFixed(2) + after + ')' };
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
  if (dest.kind === 'split' && !dest.offset) ({ status, note } = await interestStatus(read, dest));
  const st = await db.statement.create({ data: {
    householdId: o.householdId, splitId: dest.kind === 'split' ? dest.id : null, accountId: dest.kind === 'account' ? dest.id : null,
    periodStart: start, periodEnd: end, opening: read.opening, closing: read.closing, interest: read.interest || 0, credits: read.credits || 0, debits: read.debits || 0,
    paymentsInAdvance: read.advance, offsetBenefit: read.offsetBenefit ?? null, rate: read.rate, status, statusNote: note, layoutVersionId: m.version.id, fileId: file.id, pages: read.pages, importedById: o.userId
  } });
  await db.txn.createMany({ data: fresh.map((t, i) => ({ statementId: st.id, date: new Date(t.date + 'T00:00:00Z'), description: t.description.slice(0, 300), debit: t.debit, credit: t.credit, balance: t.balance, rate: t.rate, page: t.page, row: t.row, y: t.y ?? null, yh: t.yh ?? null, dedupeKey: dest.id + ':' + t.date + ':' + i })) });
  // a new rate shown on a loan statement becomes a rate change to confirm, but only when it is a change: the same
  // rate repeated (for example on each statement's opening line) is not
  if (dest.kind === 'split') {
    // a split with no saved suffix takes the one this statement's account number ends with (…00, …01)
    const tail = (read.acct || '').replace(/\D/g, '');
    if (tail.length >= 4) await db.loanSplit.updateMany({ where: { id: dest.id, OR: [{ accountSuffix: null }, { accountSuffix: '' }] }, data: { accountSuffix: tail.slice(-2) } });
    const sp = await db.loanSplit.findUnique({ where: { id: dest.id }, include: { rateChanges: { where: { deletedAt: null } } } });
    const known = sp!.rateChanges.map((c) => ({ date: c.effectiveDate, rate: Number(c.rate) }));
    const add = async (date: Date, rate: number) => {
      if (Math.abs(rateInEffect(Number(sp!.startRate), known, date) - rate) < 0.0001) return;
      if (known.some((c) => Math.abs(c.rate - rate) < 0.0001 && Math.abs(+c.date - +date) < 3 * 86400000)) return;
      await db.rateChange.create({ data: { splitId: dest.id, effectiveDate: date, rate, confirmed: false, source: 'statement' } });
      known.push({ date, rate });
    };
    const lines = (read.txns.filter((t) => t.rate != null) as (typeof read.txns[number] & { rate: number })[]).sort((a, b) => (a.date < b.date ? -1 : 1));
    for (const t of lines) await add(new Date(t.date + 'T00:00:00Z'), t.rate);
    if (!lines.length && read.rate != null) await add(end, read.rate);
    // statements imported out of date order leave later changes repeating an earlier one
    await tidyRateRepeats(dest.id);
  }
  await db.storedFile.update({ where: { id: file.id }, data: { pending: Prisma.DbNull } });
  return { statementId: st.id, status, note, skipped: read.txns.length - fresh.length };
}
