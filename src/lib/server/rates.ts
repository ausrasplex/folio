import { db } from './db';

/** Rate history helpers, shared by imports, the loan actions and the state. */

/** The rate in effect on a day: the latest known change on or before it (confirmed or not), else the loan's own rate. */
export function rateInEffect(startRate: number, known: { date: Date; rate: number }[], day: Date) {
  let r = startRate, at = -Infinity;
  for (const c of known) if (+c.date <= +day && +c.date >= at) { r = c.rate; at = +c.date; }
  return r;
}

/**
 * Add a Loan asks for the rate when the loan is added, not the rate it started at. For splits whose starting rate is
 * still that one (startRateFrom empty): the rate their earliest statement opens at, when it differs, to offer instead.
 */
export async function startRateOffers(splitIds: string[]) {
  const offers = new Map<string, { rate: number; from: string; current: number }>();
  if (!splitIds.length) return offers;
  const splits = await db.loanSplit.findMany({ where: { id: { in: splitIds }, startRateFrom: null, deletedAt: null }, select: { id: true, startRate: true } });
  for (const sp of splits) {
    const first = await db.statement.findFirst({ where: { splitId: sp.id, deletedAt: null }, orderBy: { periodStart: 'asc' }, include: { txns: { where: { rate: { not: null } }, orderBy: [{ date: 'asc' }, { row: 'asc' }], take: 1 } } });
    const line = first?.txns[0];
    // only a rate the statement opens at (a line on or before its first day), not a change later in it
    if (!first || !line || line.date > first.periodStart || line.rate == null) continue;
    if (Math.abs(Number(line.rate) - Number(sp.startRate)) < 0.0001) continue;
    offers.set(sp.id, { rate: Number(line.rate), from: first.periodStart.toISOString().slice(0, 10), current: Number(sp.startRate) });
  }
  return offers;
}

/** Marks deleted the rate changes from statements, still to confirm, that only repeat the rate already in effect. */
export async function tidyRateRepeats(splitId: string) {
  const sp = await db.loanSplit.findUnique({ where: { id: splitId }, include: { rateChanges: { where: { deletedAt: null }, orderBy: { effectiveDate: 'asc' } } } });
  if (!sp) return 0;
  const kept = sp.rateChanges.filter((c) => c.confirmed).map((c) => ({ date: c.effectiveDate, rate: Number(c.rate) }));
  const repeats: string[] = [];
  for (const c of sp.rateChanges.filter((x) => !x.confirmed && x.source === 'statement')) {
    const rate = Number(c.rate);
    if (Math.abs(rateInEffect(Number(sp.startRate), kept, c.effectiveDate) - rate) < 0.0001) repeats.push(c.id); else kept.push({ date: c.effectiveDate, rate });
  }
  if (repeats.length) await db.rateChange.updateMany({ where: { id: { in: repeats } }, data: { deletedAt: new Date() } });
  return repeats.length;
}
