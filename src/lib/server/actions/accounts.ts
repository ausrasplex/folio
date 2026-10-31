// Bank accounts: only the people on an account (its holders) see it or change it.
import { type Action, type Ctx, canEdit, d, db, hh, money, need, str } from '../actions';
import { enc } from '../crypto';
import { memberIds } from './loans';

const TYPES = ['Everyday', 'Savings', 'Bills', 'Offset'];

async function myAccount(c: Ctx, id: unknown, closed: boolean | null = false) {
  const a = await db.account.findFirst({ where: { id: str(id), householdId: hh(c), deletedAt: null, ...(closed === null ? {} : { closedAt: closed ? { not: null } : null }), holders: { some: { userId: c.u.id } } } });
  need(a, 'That account is not one of yours.');
  return a!;
}
/** An offset link may only point at an active loan you are a borrower on. */
async function linkOf(c: Ctx, v: unknown) {
  const id = str(v);
  if (!id || id === 'none') return null;
  const l = await db.loan.findFirst({ where: { id, householdId: hh(c), status: 'active', borrowers: { some: { userId: c.u.id } } } });
  need(l, 'Choose one of your loans for the offset link.');
  return l!.id;
}
const bsbOk = (s: string) => !s || /^\d{3}-?\d{3}$/.test(s);
const numOk = (s: string) => !s || /^\d{4,12}$/.test(s.replace(/\s/g, ''));

async function fields(c: Ctx) {
  const p = c.p;
  const name = str(p.name, 80);
  need(name, 'Give the account a name.');
  const lender = await db.lender.findFirst({ where: { householdId: hh(c), deletedAt: null, OR: [{ id: str(p.lenderId) }, { name: { equals: str(p.lender), mode: 'insensitive' } }] } });
  need(lender, 'Choose a lender.');
  const type = TYPES.includes(str(p.type ?? p.purpose)) ? str(p.type ?? p.purpose) : 'Everyday';
  const bsb = str(p.bsb, 7), number = str(p.number ?? p.num, 20).replace(/\s/g, '');
  need(bsbOk(bsb), 'A BSB is six digits, like 062-000.');
  need(numOk(number), 'An account number is 4 to 12 digits.');
  return { name, lenderId: lender!.id, type, bsb: bsb ? enc(bsb.replace(/^(\d{3})-?(\d{3})$/, '$1-$2')) : null, number: number ? enc(number) : null, nameOnAccount: str(p.holder, 120) || null, offsetLoanId: await linkOf(c, p.link) };
}

export const accountActions: Record<string, Action> = {
  createAccount: async (c) => {
    canEdit(c);
    const f = await fields(c);
    const dup = await db.account.count({ where: { householdId: hh(c), deletedAt: null, closedAt: null, name: { equals: f.name, mode: 'insensitive' }, holders: { some: { userId: c.u.id } } } });
    need(!dup, 'You already have an account with this name.');
    const people = await memberIds(c, c.p.holders);
    if (!people.includes(c.u.id)) people.unshift(c.u.id);
    const ob = c.p.openingBalance === '' || c.p.openingBalance == null ? 0 : money(c.p.openingBalance);
    need(isFinite(ob), 'Enter the balance as a number.');
    const a = await db.account.create({ data: { ...f, householdId: hh(c), openingBalance: ob, openingDate: d(c.p.openingDate) || new Date(), openedAt: d(c.p.openedAt), holders: { create: people.map((userId) => ({ userId })) } } });
    return { id: a.id };
  },
  editAccount: async (c) => {
    canEdit(c);
    const a = await myAccount(c, c.p.id);
    const f = await fields(c);
    const dup = await db.account.count({ where: { householdId: hh(c), deletedAt: null, closedAt: null, id: { not: a.id }, name: { equals: f.name, mode: 'insensitive' }, holders: { some: { userId: c.u.id } } } });
    need(!dup, 'You already have an account with this name.');
    // the BSB and number stay as they were when the fields come back masked or empty
    const keep = (v: unknown) => v === undefined || /•/.test(String(v));
    await db.account.update({ where: { id: a.id }, data: { ...f, ...(keep(c.p.bsb) ? { bsb: a.bsb } : {}), ...(keep(c.p.number ?? c.p.num) ? { number: a.number } : {}) } });
    if (Array.isArray(c.p.holders)) {
      const people = await memberIds(c, c.p.holders);
      if (!people.includes(c.u.id)) people.unshift(c.u.id);
      await db.accountHolder.deleteMany({ where: { accountId: a.id, userId: { notIn: people } } });
      const have = (await db.accountHolder.findMany({ where: { accountId: a.id } })).map((h) => h.userId);
      await db.accountHolder.createMany({ data: people.filter((x) => !have.includes(x)).map((userId) => ({ accountId: a.id, userId })) });
    }
    return { id: a.id };
  },
  closeAccount: async (c) => {
    canEdit(c);
    const a = await myAccount(c, c.p.id);
    need(!a.offsetLoanId, 'This account offsets a loan. Remove the offset link in Edit details before closing it.');
    await db.account.update({ where: { id: a.id }, data: { closedAt: d(c.p.date) || new Date() } });
  },
  restoreAccount: async (c) => {
    canEdit(c);
    const a = await myAccount(c, c.p.id, true);
    await db.account.update({ where: { id: a.id }, data: { closedAt: null } });
  }
};
