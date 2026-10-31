// Turns stored loans into what the screens show: balances, next payment, payoff, schedule, projections.
import Decimal from 'decimal.js';
import { forecast, type ForecastSplit, type Frequency } from '../engine';

export interface SplitRow {
  id: string;
  name: string;
  kind: 'VARIABLE' | 'FIXED';
  fixedUntil: Date | null;
  openingBalance: Decimal.Value;
  startRate: Decimal.Value;
  repayment: Decimal.Value;
  frequency: Frequency;
  repayDay: number;
  anchorDate: Date | null;
  interestOnly: boolean;
  balanceAmount: Decimal.Value | null;
  balanceDate: Date | null;
  accountSuffix: string | null;
  rateChanges: { effectiveDate: Date; rate: Decimal.Value; confirmed: boolean; deletedAt: Date | null }[];
  repaymentChanges: { effectiveDate: Date; amount: Decimal.Value; frequency: Frequency; deletedAt: Date | null }[];
  statements: { periodStart: Date; periodEnd: Date; closing: Decimal.Value; opening: Decimal.Value; interest: Decimal.Value; credits: Decimal.Value; rate: Decimal.Value | null; paymentsInAdvance: Decimal.Value | null; deletedAt: Date | null }[];
}

export const DAY = 86400000;
export const today0 = () => { const n = new Date(); return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())); };
export const utc = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
export const yearFrac = (d: Date) => d.getUTCFullYear() + (d.getUTCMonth() + (d.getUTCDate() - 1) / 31) / 12;
export const num = (v: Decimal.Value | null | undefined) => (v == null ? 0 : new Decimal(v).toNumber());
const PER: Record<Frequency, number> = { WEEKLY: 52, FORTNIGHTLY: 26, MONTHLY: 12 };

export function rateNow(s: SplitRow, at = today0()) {
  let r = num(s.startRate);
  let since: Date | null = null;
  for (const c of [...s.rateChanges].filter((x) => !x.deletedAt && x.confirmed).sort((a, b) => +a.effectiveDate - +b.effectiveDate)) if (c.effectiveDate <= at) { r = num(c.rate); since = c.effectiveDate; }
  return { rate: r, since };
}

export function repaymentNow(s: SplitRow, at = today0()) {
  let amount = num(s.repayment), frequency = s.frequency;
  for (const c of [...s.repaymentChanges].filter((x) => !x.deletedAt).sort((a, b) => +a.effectiveDate - +b.effectiveDate)) if (c.effectiveDate <= at) { amount = num(c.amount); frequency = c.frequency; }
  return { amount, frequency };
}

/** Latest known balance of a split and the day it applies to (statement closing beats the entered balance). */
export function balanceOf(s: SplitRow, loanStart: Date) {
  const st = s.statements.filter((x) => !x.deletedAt).sort((a, b) => +b.periodEnd - +a.periodEnd)[0];
  const entered = s.balanceAmount != null && s.balanceDate ? { amount: num(s.balanceAmount), date: s.balanceDate, from: 'entered' as const } : null;
  if (st && (!entered || st.periodEnd >= entered.date)) return { amount: num(st.closing), date: st.periodEnd, from: 'statement' as const };
  if (entered) return entered;
  return { amount: num(s.openingBalance), date: loanStart, from: 'start' as const };
}

/** Next repayment date on or after `from`. */
export function nextPayment(freq: Frequency, repayDay: number, anchor: Date | null, from = today0()) {
  if (freq === 'MONTHLY') {
    const dom = Math.min(28, Math.max(1, repayDay || 1));
    const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), dom));
    return d >= from ? d : new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, dom));
  }
  const d = new Date(from);
  while (d.getUTCDay() !== ((repayDay % 7) + 7) % 7) d.setUTCDate(d.getUTCDate() + 1);
  if (freq === 'FORTNIGHTLY' && anchor) {
    const diff = Math.round((+d - +utc(anchor)) / DAY);
    if (((diff % 14) + 14) % 14 !== 0) d.setUTCDate(d.getUTCDate() + 7);
  }
  return d;
}

/** Balance the loan would have at `at` if it followed its original schedule (P&I over the term at the start rate). */
export function scheduleBalance(original: number, ratePct: number, termYears: number, start: Date, at: Date) {
  const r = ratePct / 1200, n = termYears * 12;
  const k = Math.max(0, Math.min(n, ((+at - +start) / DAY) / 30.4375));
  if (r === 0) return Math.max(0, original * (1 - k / n));
  const pay = original * r / (1 - Math.pow(1 + r, -n));
  return Math.max(0, original * Math.pow(1 + r, k) - pay * (Math.pow(1 + r, k) - 1) / r);
}

export interface LoanSummaryInput {
  startDate: Date;
  termYears: number;
  postingDay: number | null;
  offsetOrder: string;
  dayCount: number;
  splits: SplitRow[];
  offsetBalance: number;
}

/** Everything derived for one loan. Projection uses the engine (exact daily interest). */
export function summarize(l: LoanSummaryInput) {
  const now = today0();
  const splits = l.splits.map((s) => {
    const b = balanceOf(s, l.startDate);
    const r = rateNow(s);
    const p = repaymentNow(s);
    return { s, bal: b.amount, balDate: b.date, balFrom: b.from, rate: r.rate, rateSince: r.since, repay: p.amount, freq: p.frequency };
  });
  const bal = splits.reduce((t, x) => t + x.bal, 0);
  const orig = l.splits.reduce((t, s) => t + num(s.openingBalance), 0);
  const asAt = splits.reduce((d, x) => (x.balDate > d ? x.balDate : d), new Date(0));
  const postingDay = l.postingDay || (() => { const st = l.splits.flatMap((s) => s.statements).find((x) => !x.deletedAt); return st ? st.periodEnd.getUTCDate() : l.startDate.getUTCDate(); })();
  const fsplits: ForecastSplit[] = splits.filter((x) => x.bal > 0).map((x) => ({
    id: x.s.id, name: x.s.name, kind: x.s.kind, fixedUntil: x.s.fixedUntil, balance: x.bal,
    rates: [{ from: new Date(0), rate: x.rate }], repayment: x.repay, frequency: x.freq, weekday: x.freq === 'MONTHLY' ? undefined : x.s.repayDay
  }));
  const start = asAt.getTime() > 0 ? utc(asAt) : now;
  const fc = fsplits.length ? forecast({ start, splits: fsplits, postingDay, offset: l.offsetBalance, dayCount: l.dayCount, order: l.offsetOrder === 'proRata' ? 'proRata' : 'highestRate', maxYears: Math.max(5, l.termYears + 10) }) : { points: [{ date: start, balance: 0, splits: {} }], payoffDate: start, totalInterest: new Decimal(0), splitPayoffs: {} as Record<string, Date> };
  const series = fc.points.map((p) => [Math.round(yearFrac(p.date) * 1000) / 1000, Math.round(p.balance)] as [number, number]);
  // each split's own projection; a split already at zero has none and is paid off as at its balance date
  const splitOut = splits.map((x) => {
    const own = x.bal > 0 ? fc.points.map((p) => [Math.round(yearFrac(p.date) * 1000) / 1000, Math.round(p.splits[x.s.id] ?? 0)] as [number, number]) : [];
    const cut = own.findIndex(([, b]) => b <= 0);
    return { ...x, series: cut >= 0 ? own.slice(0, cut + 1) : own, payoff: x.bal > 0 ? fc.splitPayoffs[x.s.id] || null : x.balDate };
  });
  const weighted = bal > 0 ? splits.reduce((t, x) => t + x.rate * x.bal, 0) / bal : (splits[0]?.rate || 0);
  const startRateW = orig > 0 ? l.splits.reduce((t, s) => t + num(s.startRate) * num(s.openingBalance), 0) / orig : 0;
  const expected = scheduleBalance(orig, startRateW, l.termYears, l.startDate, now);
  const perMonth = splits.reduce((t, x) => t + x.repay * PER[x.freq] / 12, 0);
  const nexts = splits.map((x) => nextPayment(x.freq, x.s.repayDay, x.s.anchorDate)).sort((a, b) => +a - +b);
  return {
    splits: splitOut, bal, orig, asAt: start, postingDay, rate: weighted, expected, ahead: expected - bal, perMonth,
    next: nexts[0] || null, payoff: fc.payoffDate, totalInterest: fc.totalInterest.toNumber(), series
  };
}

export const FREQ_WORD: Record<Frequency, string> = { WEEKLY: 'weekly', FORTNIGHTLY: 'fortnightly', MONTHLY: 'monthly' };
export const perYear = PER;
