// Searching and filtering an account's transaction history.
import { categoryOf, kindOf, type RuleRow } from './categories';

export type TxnRow = { id: string; date: string; description: string; debit: number; credit: number; balance: number | null; category: string | null; accountId: string; statementId: string };
export type TxnFilter = { q?: string; dir?: 'in' | 'out' | ''; year?: string; month?: string; from?: string; to?: string; cat?: string; min?: number | null; max?: number | null };

/** Rows with their category worked out, filtered, newest first; with totals and what each filter can offer. */
export function queryTxns(rows: TxnRow[], rules: RuleRow[], own: { name: string; kind: string }[], f: TxnFilter) {
  const all = rows.map((t) => { const c = categoryOf(t, rules); return { ...t, cat: c.name, catBy: c.by, ruleId: c.ruleId || null }; });
  const q = (f.q || '').trim().toLowerCase();
  const qNum = /^\$?\d[\d,]*(\.\d{1,2})?$/.test(q) ? Number(q.replace(/[$,]/g, '')) : null;
  const inPeriod = (t: { date: string }) => (!f.year || t.date.startsWith(f.year)) && (!f.month || t.date.slice(5, 7) === f.month.padStart(2, '0')) && (!f.from || t.date >= f.from) && (!f.to || t.date <= f.to);
  const hit = all.filter((t) => {
    if (f.dir === 'in' && !(t.credit > 0)) return false;
    if (f.dir === 'out' && !(t.debit > 0)) return false;
    if (!inPeriod(t)) return false;
    if (f.cat && t.cat !== f.cat) return false;
    const amount = t.debit || t.credit;
    if (f.min != null && amount < f.min - 0.001) return false;
    if (f.max != null && amount > f.max + 0.001) return false;
    if (q && !t.description.toLowerCase().includes(q) && !(qNum != null && Math.abs(amount - qNum) < 0.005)) return false;
    return true;
  }).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const r2 = (n: number) => Math.round(n * 100) / 100;
  // spending by category over the matching rows (money out, leaving out income and transfers)
  const byCat: Record<string, number> = {};
  for (const t of hit) if (t.debit > 0 && kindOf(t.cat, own) === 'spend') byCat[t.cat] = r2((byCat[t.cat] || 0) + t.debit);
  return {
    rows: hit, total: hit.length,
    sumIn: r2(hit.reduce((s, t) => s + t.credit, 0)), sumOut: r2(hit.reduce((s, t) => s + t.debit, 0)),
    byCat: Object.entries(byCat).sort((a, b) => b[1] - a[1]),
    years: [...new Set(all.map((t) => t.date.slice(0, 4)))].sort().reverse(),
    cats: [...new Set(all.map((t) => t.cat))].sort()
  };
}
