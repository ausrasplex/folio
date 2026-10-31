// The offset balance a loan's statements imply, for loans with no linked offset account.
// A statement's offset benefit is the interest the offset saved: the offset balance times each day's rate over the
// period. Dividing the benefit by the sum of the daily rates gives the average offset balance for that period.

const DAY = 86400000;

export type BenefitStatement = { id: string; periodStart: Date; periodEnd: Date; offsetBenefit: number; rate: number | null };
export type RateLine = { statementId: string; date: Date; rate: number };
export type OffsetPeriod = { start: string; end: string; amount: number };

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The average offset balance over one statement's period, from its benefit and the rates the statement shows. */
export function averageOffset(st: BenefitStatement, lines: RateLine[], dayCount = 365): number | null {
  const own = lines.filter((l) => l.statementId === st.id).sort((a, b) => +a.date - +b.date);
  // the rate at the start: the statement's opening rate line, else its summary rate, else the first line it has
  let rate = own.find((l) => l.date <= st.periodStart)?.rate ?? st.rate ?? own[0]?.rate ?? null;
  if (rate == null || !(st.offsetBenefit > 0)) return null;
  let factor = 0;
  for (let t = st.periodStart.getTime(); t <= st.periodEnd.getTime(); t += DAY) {
    for (const l of own) if (l.date.getTime() === t) rate = l.rate;
    factor += rate / 100 / dayCount;
  }
  return factor > 0 ? Math.round(st.offsetBenefit / factor) : null;
}

/** Each statement period's offset balance (splits ending on the same day added together), oldest first. */
export function offsetFromStatements(statements: BenefitStatement[], lines: RateLine[], dayCount = 365): OffsetPeriod[] {
  const byEnd = new Map<string, OffsetPeriod>();
  for (const st of statements) {
    const avg = averageOffset(st, lines, dayCount);
    if (avg == null) continue;
    const k = iso(st.periodEnd);
    const cur = byEnd.get(k);
    if (cur) cur.amount += avg;
    else byEnd.set(k, { start: iso(st.periodStart), end: k, amount: avg });
  }
  return [...byEnd.values()].sort((a, b) => (a.end < b.end ? -1 : 1));
}
