/**
 * Calculation engine (see docs/SPEC.md, "Calculation engine").
 *
 * Daily loop, per split:
 *  1. apply any rate change effective that day
 *  2. apply that day's repayments (and other ledger movements)
 *  3. allocate the loan's offset pool across eligible (variable, or fixed past expiry) splits,
 *     capped at each split's balance, leftover spilling to the next split
 *  4. accrue interest: (end-of-day balance - allocated offset) x rate / dayCount, unrounded
 *  5. on the posting day, round the accrued total once (half up, to the cent) and add it
 *
 * All money is Decimal. Dates are handled as UTC calendar days.
 */
import Decimal from 'decimal.js';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type SplitKind = 'VARIABLE' | 'FIXED';
export type Frequency = 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY';
export type OffsetOrder = 'highestRate' | 'proRata';

export interface RatePoint {
  from: Date;
  /** Percent, e.g. 6.16 */
  rate: Decimal.Value;
}

export interface SplitInput {
  id: string;
  name: string;
  kind: SplitKind;
  fixedUntil?: Date | null;
  balance: Decimal.Value;
  rates: RatePoint[];
}

export interface Movement {
  date: Date;
  splitId: string;
  /** Positive reduces the balance (repayment), negative increases it (fee, redraw). */
  amount: Decimal.Value;
}

export interface Posting {
  date: Date;
  splitId: string;
  amount: Decimal;
}

export interface DailyResult {
  balances: Record<string, Decimal>;
  postings: Posting[];
  /** Interest accrued but not yet posted, per split. */
  pending: Record<string, Decimal>;
  totalInterest: Decimal;
}

const DAY = 86_400_000;
export const utcDay = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const sameDay = (a: Date, b: Date) => a.getTime() === b.getTime();
const dayStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export function rateOn(split: SplitInput, day: Date): Decimal {
  let r: Decimal | null = null;
  const sorted = [...split.rates].sort((a, b) => a.from.getTime() - b.from.getTime());
  for (const p of sorted) if (p.from.getTime() <= day.getTime()) r = new Decimal(p.rate);
  if (r === null) throw new Error(`No rate for split ${split.id} on ${day.toISOString().slice(0, 10)}`);
  return r;
}

export function offsetEligible(split: SplitInput, day: Date): boolean {
  if (split.kind === 'VARIABLE') return true;
  return !!split.fixedUntil && day.getTime() >= split.fixedUntil.getTime();
}

/** Split the offset pool across eligible splits. Capped at each balance; leftover spills on. */
export function allocateOffset(
  splits: SplitInput[],
  balances: Record<string, Decimal>,
  pool: Decimal.Value,
  day: Date,
  order: OffsetOrder = 'highestRate'
): Record<string, Decimal> {
  const out: Record<string, Decimal> = {};
  for (const s of splits) out[s.id] = new Decimal(0);
  const eligible = splits.filter((s) => offsetEligible(s, day) && balances[s.id].gt(0));
  let left = Decimal.max(0, new Decimal(pool));
  if (order === 'proRata') {
    const total = eligible.reduce((t, s) => t.plus(balances[s.id]), new Decimal(0));
    if (total.isZero()) return out;
    for (const s of eligible) out[s.id] = Decimal.min(balances[s.id], left.times(balances[s.id]).div(total));
    return out;
  }
  const ordered = [...eligible].sort((a, b) => rateOn(b, day).cmp(rateOn(a, day)));
  for (const s of ordered) {
    const take = Decimal.min(left, balances[s.id]);
    out[s.id] = take;
    left = left.minus(take);
    if (left.lte(0)) break;
  }
  return out;
}

export interface DailyInput {
  splits: SplitInput[];
  movements?: Movement[];
  /** Offset pool for a given day (sum of linked offset accounts). */
  offset?: (day: Date) => Decimal.Value;
  postingDay: number;
  dayCount?: number;
  order?: OffsetOrder;
}

/** Run the daily ledger from `from` to `to`, both inclusive. */
export function runDaily(input: DailyInput, from: Date, to: Date): DailyResult {
  const dayCount = input.dayCount ?? 365;
  const balances: Record<string, Decimal> = {};
  const pending: Record<string, Decimal> = {};
  for (const s of input.splits) {
    balances[s.id] = new Decimal(s.balance);
    pending[s.id] = new Decimal(0);
  }
  const postings: Posting[] = [];
  let totalInterest = new Decimal(0);
  const moves = input.movements ?? [];
  for (let t = dayStart(from).getTime(); t <= dayStart(to).getTime(); t += DAY) {
    const day = new Date(t);
    for (const m of moves) if (sameDay(dayStart(m.date), day)) balances[m.splitId] = balances[m.splitId].minus(m.amount);
    const alloc = allocateOffset(input.splits, balances, input.offset ? input.offset(day) : 0, day, input.order);
    for (const s of input.splits) {
      const base = Decimal.max(0, balances[s.id].minus(alloc[s.id]));
      pending[s.id] = pending[s.id].plus(base.times(rateOn(s, day)).div(100).div(dayCount));
    }
    if (day.getUTCDate() === input.postingDay) {
      for (const s of input.splits) {
        const amt = pending[s.id].toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
        if (amt.gt(0)) {
          balances[s.id] = balances[s.id].plus(amt);
          postings.push({ date: day, splitId: s.id, amount: amt });
          totalInterest = totalInterest.plus(amt);
        }
        pending[s.id] = new Decimal(0);
      }
    }
  }
  return { balances, postings, pending, totalInterest };
}

export interface ForecastSplit extends SplitInput {
  repayment: Decimal.Value;
  frequency: Frequency;
  /** 0 Sunday .. 6 Saturday, for weekly and fortnightly repayments. */
  weekday?: number;
}

export interface ForecastInput {
  start: Date;
  splits: ForecastSplit[];
  postingDay: number;
  /** Flat offset pool used for the whole projection. */
  offset?: Decimal.Value;
  /** Extra amount added to every repayment of the first variable split. */
  extra?: Decimal.Value;
  /** Added to (or taken from) every split's rate, in percentage points. */
  rateDelta?: Decimal.Value;
  /** Changes every split's repayment frequency, keeping the yearly total the same. */
  frequency?: Frequency;
  lumpSum?: { date: Date; amount: Decimal.Value };
  dayCount?: number;
  order?: OffsetOrder;
  maxYears?: number;
}

export interface ForecastPoint {
  date: Date;
  balance: number;
  /** Each split's balance on that day. */
  splits: Record<string, number>;
}

export interface ForecastResult {
  points: ForecastPoint[];
  payoffDate: Date | null;
  totalInterest: Decimal;
  /** The day each split reaches zero, if it does within the horizon. */
  splitPayoffs: Record<string, Date>;
}

const perYear: Record<Frequency, number> = { WEEKLY: 52, FORTNIGHTLY: 26, MONTHLY: 12 };

/** Project the loan forward until every split reaches zero (or the horizon). */
export function forecast(input: ForecastInput): ForecastResult {
  const dayCount = input.dayCount ?? 365;
  const horizon = (input.maxYears ?? 50) * 366;
  const delta = new Decimal(input.rateDelta ?? 0);
  const splits: ForecastSplit[] = input.splits.map((s) => ({
    ...s,
    rates: s.rates.map((r) => ({ from: r.from, rate: new Decimal(r.rate).plus(delta) }))
  }));
  const firstVariable = splits.find((s) => s.kind === 'VARIABLE')?.id;
  const balances: Record<string, Decimal> = {};
  const pending: Record<string, Decimal> = {};
  for (const s of splits) {
    balances[s.id] = new Decimal(s.balance);
    pending[s.id] = new Decimal(0);
  }
  const amountFor = (s: ForecastSplit) => {
    const f = input.frequency ?? s.frequency;
    const base = new Decimal(s.repayment).times(perYear[s.frequency]).div(perYear[f]);
    const extra = s.id === firstVariable ? new Decimal(input.extra ?? 0).times(52).div(perYear[f]) : new Decimal(0);
    return base.plus(extra);
  };
  const isPayday = (s: ForecastSplit, day: Date, i: number) => {
    const f = input.frequency ?? s.frequency;
    if (f === 'MONTHLY') return day.getUTCDate() === Math.min(28, input.start.getUTCDate());
    if (day.getUTCDay() !== (s.weekday ?? 4)) return false;
    return f === 'WEEKLY' || Math.floor(i / 7) % 2 === 0;
  };
  const points: ForecastPoint[] = [];
  let total = new Decimal(0);
  let payoff: Date | null = null;
  const splitPayoffs: Record<string, Date> = {};
  const sumBal = () => Object.values(balances).reduce((t, b) => t.plus(Decimal.max(0, b)), new Decimal(0));
  const each = () => Object.fromEntries(splits.map((s) => [s.id, Decimal.max(0, balances[s.id]).toNumber()]));
  for (let i = 0; i <= horizon; i++) {
    const day = new Date(dayStart(input.start).getTime() + i * DAY);
    for (const s of splits) {
      if (balances[s.id].lte(0)) continue;
      if (i > 0 && isPayday(s, day, i)) balances[s.id] = balances[s.id].minus(amountFor(s));
    }
    if (input.lumpSum && sameDay(dayStart(input.lumpSum.date), day) && firstVariable) {
      balances[firstVariable] = balances[firstVariable].minus(input.lumpSum.amount);
    }
    const alloc = allocateOffset(splits, balances, input.offset ?? 0, day, input.order);
    for (const s of splits) {
      const base = Decimal.max(0, balances[s.id].minus(alloc[s.id]));
      pending[s.id] = pending[s.id].plus(base.times(rateOn(s, day)).div(100).div(dayCount));
    }
    if (day.getUTCDate() === input.postingDay) {
      for (const s of splits) {
        const amt = pending[s.id].toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
        if (balances[s.id].gt(0) && amt.gt(0)) {
          balances[s.id] = balances[s.id].plus(amt);
          total = total.plus(amt);
        }
        pending[s.id] = new Decimal(0);
      }
    }
    for (const s of splits) if (!splitPayoffs[s.id] && balances[s.id].lte(0)) splitPayoffs[s.id] = day;
    if (i === 0 || day.getUTCDate() === 1) points.push({ date: day, balance: sumBal().toNumber(), splits: each() });
    if (sumBal().lte(0)) {
      payoff = day;
      points.push({ date: day, balance: 0, splits: each() });
      break;
    }
  }
  return { points, payoffDate: payoff, totalInterest: total, splitPayoffs };
}
