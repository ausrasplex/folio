// Categories and category rules (shared in the household), and choosing a transaction's category.
import { Prisma } from '@prisma/client';
import { type Action, type Ctx, canEdit, db, hh, need, str } from '../actions';
import { BUILT_IN, COLORS, categoryOf, ordered, ruleMatches, type Cond, type RuleRow } from '../categories';
import { householdCategories } from '../catdata';

const MATCHES = ['contains', 'starts', 'equals', 'pattern'];
const DIRECTIONS = ['any', 'out', 'in'];
const KINDS = ['spend', 'income', 'transfer'];
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** A category name that exists: built in, or one of the household's. */
async function knownCategory(c: Ctx, name: unknown) {
  const n = str(name, 40).trim();
  const own = await db.category.findMany({ where: { householdId: hh(c), builtIn: false }, select: { name: true } });
  const hit = BUILT_IN.find((b) => same(b.name, n))?.name || own.find((o) => same(o.name, n))?.name;
  need(hit, 'Choose a category.');
  return hit!;
}
/** Transactions in accounts the person holds, in this household. */
const myTxns = (c: Ctx) => ({ statement: { householdId: hh(c), deletedAt: null, account: { holders: { some: { userId: c.u.id } } } } });
/** The rule as sent from the editor, checked. */
/** A rule's conditions as sent from the editor, checked: known fields and tests, amounts as numbers, accounts you hold. */
async function condsFrom(c: Ctx, raw: unknown): Promise<Cond[]> {
  const list = (Array.isArray(raw) ? raw : []).slice(0, 20) as Record<string, unknown>[];
  const out: Cond[] = [];
  for (const x of list) {
    const field = str(x.field);
    const join = out.length ? (x.join === 'or' ? 'or' : 'and') : undefined;
    if (field === 'description') {
      const value = str(x.value, 80).trim();
      if (!value) continue;
      const op = ['contains', 'notContains', 'starts', 'equals', 'pattern'].includes(str(x.op)) ? str(x.op) : 'contains';
      out.push({ join, field, op, value });
    } else if (field === 'amount') {
      const n = (v: unknown) => (v === '' || v == null || !isFinite(Number(String(v).replace(/[$,]/g, ''))) ? null : Math.round(Math.abs(Number(String(v).replace(/[$,]/g, ''))) * 100) / 100);
      const op = ['equals', 'over', 'under', 'between'].includes(str(x.op)) ? str(x.op) : 'equals';
      const value = n(x.value), value2 = op === 'between' ? n(x.value2) : null;
      if (value == null || (op === 'between' && value2 == null)) continue;
      out.push({ join, field, op, value, value2 });
    } else if (field === 'direction') {
      out.push({ join, field, value: x.value === 'in' ? 'in' : 'out' });
    } else if (field === 'account') {
      const id = (await db.account.findFirst({ where: { id: str(x.value), householdId: hh(c), deletedAt: null, holders: { some: { userId: c.u.id } } }, select: { id: true } }))?.id;
      if (id) out.push({ join, field, value: id });
    }
  }
  return out;
}

async function ruleFrom(c: Ctx) {
  const p = c.p;
  // a rule built from conditions (with AND and OR) keeps them, and leaves the single-condition fields empty
  if (Array.isArray(p.conditions)) {
    const conditions = await condsFrom(c, p.conditions);
    need(conditions.length, 'Add a condition with words or an amount to match.');
    return { category: await knownCategory(c, p.category), terms: '', match: 'contains', direction: 'any', amountMin: null as number | null, amountMax: null as number | null, accountId: null as string | null, enabled: p.enabled !== false, conditions };
  }
  const terms = str(p.terms, 2000).split(/\n/).map((x) => x.trim().slice(0, 80)).filter(Boolean).join('\n');
  const amt = (v: unknown) => (v === '' || v == null || !isFinite(Number(v)) ? null : Math.round(Math.abs(Number(v)) * 100) / 100);
  const amountMin = amt(p.amountMin), amountMax = amt(p.amountMax);
  need(amountMin == null || amountMax == null || amountMin <= amountMax, 'The lowest amount is more than the highest.');
  const direction = DIRECTIONS.includes(str(p.direction)) ? str(p.direction) : 'any';
  let accountId: string | null = str(p.accountId) || null;
  if (accountId) accountId = (await db.account.findFirst({ where: { id: accountId, householdId: hh(c), deletedAt: null, holders: { some: { userId: c.u.id } } }, select: { id: true } }))?.id || null;
  need(terms || amountMin != null || amountMax != null || direction !== 'any' || accountId, 'Add words or an amount to match.');
  return { category: await knownCategory(c, p.category), terms, match: MATCHES.includes(str(p.match)) ? str(p.match) : 'contains', direction, amountMin, amountMax, accountId, enabled: p.enabled !== false, conditions: null as Cond[] | null };
}
/** A checked rule as stored: no conditions is the database null, not JSON null. */
const forDb = (r: Awaited<ReturnType<typeof ruleFrom>>) => ({ ...r, conditions: r.conditions ? (r.conditions as unknown as Prisma.InputJsonValue) : Prisma.DbNull });
const asRow = (r: Awaited<ReturnType<typeof ruleFrom>>, id = 'new', priority = 1e9): RuleRow => ({ id, priority, ...r });

export const categoryActions: Record<string, Action> = {
  /** Adds or renames one of the household's categories. A rename carries over to its rules and to transactions given it. */
  categorySave: async (c) => {
    canEdit(c);
    const name = str(c.p.name, 40).trim();
    need(name, 'Give the category a name.');
    need(!BUILT_IN.some((b) => same(b.name, name)), name + ' is already a built-in category.');
    const kind = KINDS.includes(str(c.p.kind)) ? str(c.p.kind) : 'spend';
    const id = str(c.p.id);
    const color = (COLORS as readonly string[]).includes(str(c.p.color)) ? str(c.p.color) : undefined;
    const clash = await db.category.findFirst({ where: { householdId: hh(c), builtIn: false, name: { equals: name, mode: 'insensitive' }, ...(id ? { id: { not: id } } : {}) } });
    need(!clash, 'There is already a category called ' + name + '.');
    if (!id) return { id: (await db.category.create({ data: { householdId: hh(c), name, kind, color } })).id };
    const old = await db.category.findFirst({ where: { id, householdId: hh(c), builtIn: false } });
    need(old, 'That category is not in your household.');
    await db.$transaction([
      db.category.update({ where: { id: old!.id }, data: { name, kind, ...(color ? { color } : {}) } }),
      db.categoryRule.updateMany({ where: { householdId: hh(c), category: old!.name }, data: { category: name } }),
      db.txn.updateMany({ where: { category: old!.name, statement: { householdId: hh(c) } }, data: { category: name } })
    ]);
    return { id };
  },
  /** Deletes one of the household's categories, with its rules. Transactions given it go back to rules and the built-in list. */
  categoryDelete: async (c) => {
    canEdit(c);
    const cat = await db.category.findFirst({ where: { id: str(c.p.id), householdId: hh(c), builtIn: false } });
    need(cat, 'That category is not in your household.');
    const [rules, txns] = await db.$transaction([
      db.categoryRule.deleteMany({ where: { householdId: hh(c), category: cat!.name } }),
      db.txn.updateMany({ where: { category: cat!.name, statement: { householdId: hh(c) } }, data: { category: null } }),
      db.category.delete({ where: { id: cat!.id } })
    ]);
    return { rules: rules.count, txns: txns.count };
  },
  /** Sets a category's chip colour: one of the household's own, or a built-in one (kept as a colour-only row). */
  categoryColor: async (c) => {
    canEdit(c);
    const color = str(c.p.color);
    need((COLORS as readonly string[]).includes(color), 'Choose a colour.');
    const name = str(c.p.name, 40).trim();
    const built = BUILT_IN.find((b) => same(b.name, name));
    if (built) {
      const row = await db.category.findFirst({ where: { householdId: hh(c), name: built.name } });
      if (row) await db.category.update({ where: { id: row.id }, data: { color } });
      else await db.category.create({ data: { householdId: hh(c), name: built.name, kind: built.kind, color, builtIn: true } });
      return;
    }
    const r = await db.category.updateMany({ where: { householdId: hh(c), builtIn: false, name }, data: { color } });
    need(r.count, 'That category is not in your household.');
  },
  /** Adds a rule (tried after the others) or changes one. */
  ruleSave: async (c) => {
    canEdit(c);
    const r = await ruleFrom(c);
    const id = str(c.p.id);
    if (id) {
      const old = await db.categoryRule.findFirst({ where: { id, householdId: hh(c) } });
      need(old, 'That rule is not in your household.');
      await db.categoryRule.update({ where: { id }, data: forDb(r) });
      return { id };
    }
    const last = await db.categoryRule.findFirst({ where: { householdId: hh(c) }, orderBy: { priority: 'desc' } });
    return { id: (await db.categoryRule.create({ data: { ...forDb(r), householdId: hh(c), priority: (last?.priority ?? 0) + 1, createdById: c.u.id } })).id };
  },
  ruleDelete: async (c) => {
    canEdit(c);
    const r = await db.categoryRule.deleteMany({ where: { id: str(c.p.id), householdId: hh(c) } });
    need(r.count, 'That rule is not in your household.');
  },
  /** Moves a rule up (tried sooner) or down. */
  ruleMove: async (c) => {
    canEdit(c);
    const list = await db.categoryRule.findMany({ where: { householdId: hh(c) }, orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }], select: { id: true } });
    const i = list.findIndex((x) => x.id === str(c.p.id));
    need(i >= 0, 'That rule is not in your household.');
    const j = i + (Number(c.p.dir) < 0 ? -1 : 1);
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    await db.$transaction(list.map((x, k) => db.categoryRule.update({ where: { id: x.id }, data: { priority: k + 1 } })));
  },
  /** What a rule would match in your accounts, before saving it: how many, a few examples, and how many go elsewhere first. */
  rulePreview: async (c) => {
    const r = await ruleFrom(c);
    const id = str(c.p.id);
    const { rules } = await householdCategories(hh(c));
    const editing = rules.find((x) => x.id === id);
    const before = ordered(rules.filter((x) => x.id !== id && (!editing || x.priority < editing.priority)));
    const me = asRow(r, id || 'new', editing ? editing.priority : 1e9);
    const txns = await db.txn.findMany({ where: myTxns(c), orderBy: { date: 'desc' }, select: { date: true, description: true, debit: true, credit: true, category: true, statement: { select: { accountId: true, account: { select: { name: true } } } } } });
    let count = 0, chosen = 0, earlier = 0;
    const samples: { date: string; desc: string; amount: number; account: string }[] = [];
    for (const t of txns) {
      const row = { description: t.description, debit: Number(t.debit), credit: Number(t.credit), accountId: t.statement.accountId, category: t.category };
      if (!ruleMatches(me, row)) continue;
      count++;
      if (t.category) { chosen++; continue; }
      if (categoryOf({ ...row, category: null }, before).by === 'rule') { earlier++; continue; }
      if (samples.length < 5) samples.push({ date: t.date.toISOString().slice(0, 10), desc: t.description, amount: row.credit - row.debit, account: t.statement.account?.name || '' });
    }
    return { count, chosen, earlier, samples };
  },
  /** Gives transactions a category of your choosing, or (with none) hands them back to the rules. */
  txnCategory: async (c) => {
    const ids = (Array.isArray(c.p.ids) ? c.p.ids : [c.p.id]).map(String).slice(0, 2000);
    need(ids.length, 'Choose a transaction.');
    const category = c.p.category ? await knownCategory(c, c.p.category) : null;
    const r = await db.txn.updateMany({ where: { id: { in: ids }, ...myTxns(c) }, data: { category } });
    need(r.count, 'Those transactions are not in your accounts.');
    return { count: r.count };
  }
};
