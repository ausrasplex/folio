// Loads a household's own categories and its rules, ready for categoryOf.
import { db } from './db';
import { ordered, type RuleRow } from './categories';

const n = (v: unknown) => (v == null ? null : Number(v));

export async function householdCategories(householdId: string) {
  const own = await db.category.findMany({ where: { householdId }, orderBy: { name: 'asc' } });
  const rows = await db.categoryRule.findMany({ where: { householdId }, orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] });
  const rules: RuleRow[] = ordered(rows.map((r) => ({
    id: r.id, category: r.category, terms: r.terms, match: r.match, direction: r.direction,
    amountMin: n(r.amountMin), amountMax: n(r.amountMax), accountId: r.accountId, priority: r.priority, enabled: r.enabled
  })));
  return { own, rules };
}
