// Loads a household's own categories and its rules, ready for categoryOf.
import { db } from './db';
import { ordered, type RuleRow } from './categories';

const n = (v: unknown) => (v == null ? null : Number(v));

export async function householdCategories(householdId: string) {
  // a row marked builtIn only holds the colour chosen for a built-in category
  const rows = await db.category.findMany({ where: { householdId }, orderBy: { name: 'asc' } });
  const own = rows.filter((c) => !c.builtIn);
  const colors: Record<string, string | null> = Object.fromEntries(rows.map((c) => [c.name, c.color]));
  const ruleRows = await db.categoryRule.findMany({ where: { householdId }, orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] });
  const rules: RuleRow[] = ordered(ruleRows.map((r) => ({
    id: r.id, category: r.category, terms: r.terms, match: r.match, direction: r.direction,
    amountMin: n(r.amountMin), amountMax: n(r.amountMax), accountId: r.accountId, priority: r.priority, enabled: r.enabled
  })));
  return { own, rules, colors };
}
