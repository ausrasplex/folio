import { type Action, type Ctx, canEdit, d, db, hh, money, need, str } from '../actions';
import { enc } from '../crypto';
import { startRateOffers, tidyRateRepeats } from '../rates';

const FREQ: Record<string, 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY'> = { weekly: 'WEEKLY', fortnightly: 'FORTNIGHTLY', monthly: 'MONTHLY' };

/** A loan you are a borrower on, in your household. */
export async function myLoan(c: Ctx, id: unknown) {
  const loan = await db.loan.findFirst({ where: { id: str(id), householdId: hh(c), borrowers: { some: { userId: c.u.id } } }, include: { splits: true, lender: true, broker: true, borrowers: true } });
  need(loan, 'That loan is not one of yours.');
  return loan!;
}
async function mySplit(c: Ctx, id: unknown) {
  const sp = await db.loanSplit.findFirst({ where: { id: str(id), loan: { householdId: hh(c), borrowers: { some: { userId: c.u.id } } } } });
  need(sp, 'That split is not on one of your loans.');
  return sp!;
}
export async function memberIds(c: Ctx, ids: unknown) {
  const list = Array.isArray(ids) ? ids.map(String) : [];
  const ms = await db.membership.findMany({ where: { householdId: hh(c), removedAt: null, userId: { in: list } } });
  return ms.map((m) => m.userId);
}
async function lenderByName(c: Ctx, name: string) {
  const l = await db.lender.findFirst({ where: { householdId: hh(c), deletedAt: null, name: { equals: name, mode: 'insensitive' } } });
  need(l, 'Choose a lender.');
  return l!;
}
const snapshot = (o: Record<string, unknown> | null) => (o ? (JSON.parse(JSON.stringify({ name: o.name, phone: o.phone, email: o.email, website: o.website, company: o.company, icon: o.icon })) as Record<string, string>) : undefined);

export const loanActions: Record<string, Action> = {
  createLoan: async (c) => {
    hh(c);
    const p = c.p;
    const name = str(p.nickname, 80);
    need(name, 'Give the loan a name.');
    const lender = await db.lender.findFirst({ where: { id: str(p.lender), householdId: hh(c), deletedAt: null } });
    need(lender, 'Choose a lender.');
    const broker = p.broker ? await db.broker.findFirst({ where: { id: str(p.broker), householdId: hh(c), deletedAt: null } }) : null;
    const start = d(p.start);
    need(start, 'Choose when the loan started.');
    const people = await memberIds(c, p.borrowers);
    if (!people.includes(c.u.id)) people.unshift(c.u.id);
    const splits = Array.isArray(p.splits) ? p.splits : [];
    need(splits.length, 'Add at least one split.');
    const today = new Date();
    const loan = await db.loan.create({
      data: {
        householdId: hh(c), lenderId: lender!.id, brokerId: broker?.id, name, purpose: str(p.purpose, 40) || 'Home loan', startDate: start!, termYears: Math.max(1, Math.min(40, Math.round(Number(p.term) || 30))),
        postingDay: Number(p.postDay) >= 1 && Number(p.postDay) <= 31 ? Math.round(Number(p.postDay)) : null, offsetOrder: str(p.order, 20) || 'auto', redraw: !!p.redraw,
        accountNumber: enc(str(p.loanNo, 40)), customerId: enc(str(p.custId, 40)), createdById: c.u.id,
        borrowers: { create: people.map((userId) => ({ userId })) }
      }
    });
    let i = 0;
    for (const s of splits) {
      const bal = money(s.bal), rate = money(s.rate), repay = money(s.repay), startAmt = money(s.startAmt);
      need(str(s.name) && isFinite(bal) && isFinite(rate) && isFinite(repay), 'Each split needs a name, balance, rate and repayment.');
      const freq = FREQ[String(s.freq)] || 'MONTHLY';
      await db.loanSplit.create({ data: {
        loanId: loan.id, name: str(s.name, 40), accountSuffix: str(s.suffix, 12) || null, kind: s.kind === 'fixed' ? 'FIXED' : 'VARIABLE', fixedUntil: s.kind === 'fixed' ? d(s.fixedUntil) : null,
        openingBalance: isFinite(startAmt) && startAmt > 0 ? startAmt : bal, startRate: rate, repayment: repay, frequency: freq,
        repayDay: freq === 'MONTHLY' ? Math.max(1, Math.min(28, Number(s.dom) || start!.getUTCDate())) : Math.max(0, Math.min(6, Number(s.dow) || 0)),
        anchorDate: freq === 'FORTNIGHTLY' ? d(s.anchor) || null : null, interestOnly: !!s.io, balanceAmount: bal, balanceDate: new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())), sortOrder: i++
      } });
    }
    const accs = Array.isArray(p.offsetAccs) ? p.offsetAccs.map(String) : [];
    if (accs.length) await db.account.updateMany({ where: { id: { in: accs }, householdId: hh(c), offsetLoanId: null, holders: { some: { userId: c.u.id } } }, data: { offsetLoanId: loan.id } });
    return { id: loan.id };
  },

  editLoan: async (c) => {
    const loan = await myLoan(c, c.p.id);
    const name = str(c.p.name, 80);
    need(name, 'Give the loan a name.');
    const lender = await lenderByName(c, str(c.p.lender));
    const people = await memberIds(c, c.p.borrowers);
    need(people.length, 'A loan needs at least one borrower.');
    await db.loan.update({ where: { id: loan.id }, data: { name, lenderId: lender.id } });
    await db.loanBorrower.deleteMany({ where: { loanId: loan.id } });
    await db.loanBorrower.createMany({ data: people.map((userId) => ({ loanId: loan.id, userId })) });
    return { ok: true };
  },

  loanChange: async (c) => {
    const loan = await myLoan(c, c.p.loanId);
    const p = c.p;
    const date = d(p.date);
    need(date, 'Choose the date it applies from.');
    const sp = loan.splits.find((x) => x.id === p.splitId && !x.deletedAt) || loan.splits.find((x) => !x.deletedAt);
    switch (p.type) {
      case 'rate':
        need(sp && isFinite(Number(p.rate)), 'Enter the new rate.');
        await db.rateChange.create({ data: { splitId: sp!.id, effectiveDate: date!, rate: Number(p.rate), source: 'manual' } });
        break;
      case 'repay': {
        const amt = Number(p.repay);
        need(isFinite(amt) && amt > 0, 'Enter the new repayment.');
        const live = loan.splits.filter((x) => !x.deletedAt);
        // the amount covers the whole loan: spread it over the splits by their current repayment share
        const total = live.reduce((t, x) => t + Number(x.repayment), 0) || 1;
        for (const x of live) await db.repaymentChange.create({ data: { splitId: x.id, effectiveDate: date!, amount: Math.round(amt * Number(x.repayment) / total * 100) / 100, frequency: FREQ[String(p.freq)] || x.frequency } });
        break;
      }
      case 'topup': {
        const amt = Number(p.amount);
        need(sp && isFinite(amt) && amt > 0, 'Enter the top-up amount.');
        const cur = Number(sp!.balanceAmount ?? sp!.openingBalance);
        await db.loanSplit.update({ where: { id: sp!.id }, data: { balanceAmount: cur + amt, balanceDate: date! } });
        await db.loanEvent.create({ data: { loanId: loan.id, splitId: sp!.id, kind: 'topup', date: date!, amount: amt, note: str(p.text, 200), createdById: c.u.id } });
        break;
      }
      case 'term': {
        const end = d(p.end);
        need(end, 'Choose the new end date.');
        const years = Math.max(1, Math.round((+end! - +loan.startDate) / (365.25 * 86400000)));
        await db.loan.update({ where: { id: loan.id }, data: { termYears: years } });
        await db.loanEvent.create({ data: { loanId: loan.id, kind: 'term', date: date!, note: str(p.text, 200), createdById: c.u.id } });
        break;
      }
      case 'switch':
        need(sp, 'Choose a split.');
        if (p.sw === 'fixed') {
          need(isFinite(Number(p.fixRate)) && d(p.fixEnd), 'Enter the fixed rate and when it ends.');
          await db.loanSplit.update({ where: { id: sp!.id }, data: { kind: 'FIXED', fixedUntil: d(p.fixEnd) } });
          await db.rateChange.create({ data: { splitId: sp!.id, effectiveDate: date!, rate: Number(p.fixRate) } });
        } else {
          await db.loanSplit.update({ where: { id: sp!.id }, data: { kind: 'VARIABLE', fixedUntil: null } });
          if (isFinite(Number(p.rate)) && p.rate != null) await db.rateChange.create({ data: { splitId: sp!.id, effectiveDate: date!, rate: Number(p.rate) } });
        }
        await db.loanEvent.create({ data: { loanId: loan.id, splitId: sp!.id, kind: 'switch', date: date!, note: str(p.text, 200), createdById: c.u.id } });
        break;
      case 'restructure': {
        const rs = (p.rs || {}) as Record<string, number>;
        for (const x of loan.splits.filter((y) => !y.deletedAt)) if (isFinite(Number(rs[x.id]))) await db.loanSplit.update({ where: { id: x.id }, data: { balanceAmount: Number(rs[x.id]), balanceDate: date! } });
        await db.loanEvent.create({ data: { loanId: loan.id, kind: 'restructure', date: date!, note: str(p.text, 200), createdById: c.u.id } });
        break;
      }
      default:
        need(false, 'Choose what changed.');
    }
    return { ok: true };
  },

  confirmRate: async (c) => {
    const rc = await db.rateChange.findFirst({ where: { id: str(c.p.id), split: { loan: { householdId: hh(c), borrowers: { some: { userId: c.u.id } } } } } });
    need(rc, 'That rate change is not on one of your loans.');
    await db.rateChange.update({ where: { id: rc!.id }, data: { confirmed: true } });
  },

  /** Confirms several rate changes at once (Confirm All on the Changes card). Only changes on your loans are touched. */
  confirmRates: async (c) => {
    const ids = (Array.isArray(c.p.ids) ? c.p.ids : []).map(String).slice(0, 500);
    need(ids.length, 'Choose the rate changes to confirm.');
    const mine = { id: { in: ids }, deletedAt: null, confirmed: false, split: { loan: { householdId: hh(c), borrowers: { some: { userId: c.u.id } } } } };
    // first drop the ones that only repeat the rate already in effect, then confirm the rest
    const splitIds = [...new Set((await db.rateChange.findMany({ where: mine, select: { splitId: true } })).map((x) => x.splitId))];
    let removed = 0;
    for (const id of splitIds) removed += await tidyRateRepeats(id);
    const r = await db.rateChange.updateMany({ where: mine, data: { confirmed: true } });
    return { count: r.count, removed };
  },

  /** Takes a split's starting rate from its first statement. The rate typed in when the loan was added is kept as a
   *  confirmed change on the day it was added, since it was the rate then. */
  useStartRate: async (c) => {
    const sp = await mySplit(c, c.p.id);
    const offer = (await startRateOffers([sp.id])).get(sp.id);
    need(offer, 'There is no starting rate to take from a statement for this split.');
    const added = new Date(Date.UTC(sp.createdAt.getUTCFullYear(), sp.createdAt.getUTCMonth(), sp.createdAt.getUTCDate()));
    const typed = Number(sp.startRate);
    const already = await db.rateChange.findFirst({ where: { splitId: sp.id, deletedAt: null, rate: typed, effectiveDate: { gte: new Date(+added - 3 * 86400000), lte: new Date(+added + 3 * 86400000) } } });
    if (!already) await db.rateChange.create({ data: { splitId: sp.id, effectiveDate: added, rate: typed, confirmed: true, source: 'setup' } });
    await db.loanSplit.update({ where: { id: sp.id }, data: { startRate: offer!.rate, startRateFrom: 'statement' } });
    const tidied = await tidyRateRepeats(sp.id);
    return { rate: offer!.rate, kept: typed, tidied };
  },
  /** Keeps the rate typed in as the starting rate, and stops offering the statement's. */
  keepStartRate: async (c) => {
    const sp = await mySplit(c, c.p.id);
    await db.loanSplit.update({ where: { id: sp.id }, data: { startRateFrom: 'kept' } });
  },
  editSplit: async (c) => {
    const sp = await mySplit(c, c.p.id);
    const name = str(c.p.name, 40);
    need(name, 'Give the split a name.');
    await db.loanSplit.update({ where: { id: sp.id }, data: { name, ...(c.p.suffix !== undefined ? { accountSuffix: str(c.p.suffix, 30) || null } : {}) } });
    return { ok: true };
  },
  removeSplit: async (c) => {
    const sp = await mySplit(c, c.p.id);
    const live = await db.loanSplit.count({ where: { loanId: sp.loanId, deletedAt: null } });
    need(live > 1, 'A loan needs at least one split. Archive the loan instead.');
    await db.loanSplit.update({ where: { id: sp.id }, data: { deletedAt: new Date(), deletedById: c.u.id, deleteReason: str(c.p.reason, 200) } });
    return { ok: true };
  },
  restoreSplit: async (c) => {
    const sp = await mySplit(c, c.p.id);
    await db.loanSplit.update({ where: { id: sp.id }, data: { deletedAt: null, deletedById: null, deleteReason: null } });
    return { ok: true };
  },

  archiveLoan: async (c) => {
    const loan = await myLoan(c, c.p.id);
    await db.loan.update({ where: { id: loan.id }, data: { status: 'archived', closedReason: str(c.p.reason, 40) || 'Archived', closedAt: new Date(), lenderSnapshot: snapshot(loan.lender as never), brokerSnapshot: snapshot(loan.broker as never) } });
    await db.account.updateMany({ where: { offsetLoanId: loan.id }, data: { offsetLoanId: null } });
    return { ok: true };
  },
  unarchiveLoan: async (c) => {
    const loan = await myLoan(c, c.p.id);
    await db.loan.update({ where: { id: loan.id }, data: { status: 'active', closedReason: null, closedAt: null, lenderSnapshot: undefined } });
    return { ok: true };
  },

  refinance: async (c) => {
    canEdit(c);
    const old = await myLoan(c, c.p.loanId);
    const p = c.p;
    const date = d(p.date);
    need(date, 'Choose the payout date.');
    const amount = Number(p.amount);
    need(isFinite(amount) && amount > 0, 'Enter the amount borrowed.');
    const lender = await lenderByName(c, str(p.lender));
    const broker = p.broker && p.broker !== 'none' ? await db.broker.findFirst({ where: { householdId: hh(c), deletedAt: null, name: str(p.broker) } }) : null;
    const people = await memberIds(c, p.borrowers);
    need(people.length, 'A loan needs at least one borrower.');
    const live = old.splits.filter((x) => !x.deletedAt);
    const sp0 = live[0];
    const lastRate = sp0 ? (await db.rateChange.findFirst({ where: { splitId: sp0.id, deletedAt: null }, orderBy: { effectiveDate: 'desc' } }))?.rate ?? sp0.startRate : 6;
    const loan = await db.loan.create({ data: {
      householdId: hh(c), lenderId: lender.id, brokerId: broker?.id, name: str(p.name, 80) || old.name, purpose: old.purpose, startDate: date!, termYears: Math.round(Number(p.term) || old.termYears),
      postingDay: old.postingDay, offsetOrder: old.offsetOrder, createdById: c.u.id, borrowers: { create: people.map((userId) => ({ userId })) },
      splits: { create: [{ name: 'Split 01', accountSuffix: '01', kind: 'VARIABLE', openingBalance: amount, startRate: lastRate, repayment: live.reduce((t, x) => t + Number(x.repayment), 0) || 0, frequency: sp0?.frequency || 'MONTHLY', repayDay: sp0?.repayDay ?? 1, balanceAmount: amount, balanceDate: date! }] }
    } });
    await db.loan.update({ where: { id: old.id }, data: { status: 'archived', closedReason: 'Refinanced', closedAt: date!, lenderSnapshot: snapshot(old.lender as never), brokerSnapshot: snapshot(old.broker as never) } });
    await db.loanEvent.create({ data: { loanId: old.id, kind: 'refinance', date: date!, amount: Number(p.payout) || null, note: 'Refinanced to ' + lender.name, createdById: c.u.id } });
    await db.account.updateMany({ where: { offsetLoanId: old.id }, data: { offsetLoanId: null } });
    if (p.offset && p.offset !== 'none') await db.account.updateMany({ where: { householdId: hh(c), name: str(p.offset), holders: { some: { userId: c.u.id } } }, data: { offsetLoanId: loan.id } });
    return { id: loan.id };
  }
};
