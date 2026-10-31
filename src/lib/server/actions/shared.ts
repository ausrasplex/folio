// Lenders and brokers: shared by everyone in the household.
import { type Action, type Ctx, canEdit, d, db, hh, need, str } from '../actions';

const img = (v: unknown) => { const s = String(v ?? ''); if (!s) return null; need(/^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,/.test(s) && s.length < 900000, 'That image is too large or not a picture.'); return s; };
const url = (v: unknown) => { const s = str(v, 300); return s && !/^https?:\/\//i.test(s) ? 'https://' + s : s; };

async function lenderOf(c: Ctx, id: unknown, deleted = false) {
  const l = await db.lender.findFirst({ where: { id: str(id), householdId: hh(c), deletedAt: deleted ? { not: null } : null } });
  need(l, 'That lender is not in your household.');
  return l!;
}
async function brokerOf(c: Ctx, id: unknown, deleted = false) {
  const b = await db.broker.findFirst({ where: { id: str(id), householdId: hh(c), deletedAt: deleted ? { not: null } : null } });
  need(b, 'That broker is not in your household.');
  return b!;
}
async function dupName(model: 'lender' | 'broker', c: Ctx, name: string, except?: string) {
  const where = { householdId: hh(c), deletedAt: null, name: { equals: name, mode: 'insensitive' as const }, NOT: except ? { id: except } : undefined };
  const n = model === 'lender' ? await db.lender.count({ where }) : await db.broker.count({ where });
  need(!n, 'A ' + model + ' with this name is already saved.');
}

const lenderData = (p: Record<string, unknown>) => ({
  name: str(p.name, 80), website: url(p.website ?? p.web) || null, phone: str(p.phone, 40) || null, email: str(p.email, 120) || null, note: str(p.note, 300) || null,
  ...(p.currency ? { currency: str(p.currency, 3).toUpperCase() } : {}), ...(p.dayCount ? { dayCount: Number(p.dayCount) === 360 ? 360 : 365 } : {}),
  ...('icon' in p ? { icon: img(p.icon) } : {}), ...('logo' in p ? { logo: img(p.logo) } : {})
});
const brokerData = (p: Record<string, unknown>) => ({
  name: str(p.name, 80), company: str(p.company, 80) || null, licence: str(p.licence, 60) || null, address: str(p.address, 160) || null, phone: str(p.phone, 40) || null,
  email: str(p.email, 120) || null, website: url(p.website ?? p.web) || null, note: str(p.note, 300) || null, ...('photo' in p ? { photo: img(p.photo) } : {}),
  ...('reviewOn' in p ? { reviewOn: !!p.reviewOn } : {}), ...('lastReview' in p ? { lastReview: d(p.lastReview) } : {}), ...('every' in p ? { reviewEvery: [3, 6, 12].includes(Number(p.every)) ? Number(p.every) : 6 } : {})
});

export const sharedActions: Record<string, Action> = {
  addLender: async (c) => {
    canEdit(c);
    const data = lenderData(c.p);
    need(data.name, 'Give the lender a name.');
    await dupName('lender', c, data.name);
    const l = await db.lender.create({ data: { householdId: hh(c), ...data } });
    return { id: l.id };
  },
  updateLender: async (c) => {
    canEdit(c);
    const l = await lenderOf(c, c.p.id);
    const data = lenderData(c.p);
    need(data.name, 'Give the lender a name.');
    await dupName('lender', c, data.name, l.id);
    const used = await db.loan.count({ where: { lenderId: l.id } });
    if (used && ('currency' in data || 'dayCount' in data)) { delete (data as Record<string, unknown>).currency; delete (data as Record<string, unknown>).dayCount; }
    await db.lender.update({ where: { id: l.id }, data });
    // Layouts are shared by the whole server and key on the lender's name, so they follow a rename,
    // unless another household still has a lender by the old name (its layouts are theirs too).
    if (data.name && data.name.toLowerCase() !== l.name.toLowerCase()) {
      const others = await db.lender.count({ where: { id: { not: l.id }, deletedAt: null, name: { equals: l.name, mode: 'insensitive' } } });
      if (!others) await db.layout.updateMany({ where: { lenderName: { equals: l.name, mode: 'insensitive' } }, data: { lenderName: data.name } });
    }
    return { id: l.id };
  },
  deleteLender: async (c) => {
    canEdit(c);
    const l = await lenderOf(c, c.p.id);
    const inUse = await db.loan.count({ where: { lenderId: l.id, status: 'active' } }) + await db.account.count({ where: { lenderId: l.id, deletedAt: null, closedAt: null } });
    need(!inUse, 'This lender is still used by active loans or accounts.');
    await db.lender.update({ where: { id: l.id }, data: { deletedAt: new Date(), deletedById: c.u.id } });
    return { ok: true };
  },
  restoreLender: async (c) => {
    canEdit(c);
    const l = await lenderOf(c, c.p.id, true);
    await dupName('lender', c, l.name, l.id);
    await db.lender.update({ where: { id: l.id }, data: { deletedAt: null, deletedById: null } });
    return { ok: true };
  },

  addBroker: async (c) => {
    canEdit(c);
    const data = brokerData(c.p);
    need(data.name, 'Give the broker a name.');
    await dupName('broker', c, data.name);
    const b = await db.broker.create({ data: { householdId: hh(c), ...data } });
    if (Array.isArray(c.p.loans)) await setBrokerLoans(c, b.id, c.p.loans);
    return { id: b.id };
  },
  updateBroker: async (c) => {
    canEdit(c);
    const b = await brokerOf(c, c.p.id);
    const data = brokerData(c.p);
    need(data.name, 'Give the broker a name.');
    await dupName('broker', c, data.name, b.id);
    await db.broker.update({ where: { id: b.id }, data });
    if (Array.isArray(c.p.loans)) await setBrokerLoans(c, b.id, c.p.loans);
    return { id: b.id };
  },
  brokerAsked: async (c) => {
    canEdit(c);
    const b = await brokerOf(c, c.p.id);
    await db.broker.update({ where: { id: b.id }, data: { lastReview: new Date(), reviewOn: true } });
  },
  deleteBroker: async (c) => {
    canEdit(c);
    const b = await brokerOf(c, c.p.id);
    const inUse = await db.loan.count({ where: { brokerId: b.id, status: 'active' } });
    need(!inUse, 'This broker is still on active loans.');
    await db.broker.update({ where: { id: b.id }, data: { deletedAt: new Date(), deletedById: c.u.id } });
  },
  restoreBroker: async (c) => {
    canEdit(c);
    const b = await brokerOf(c, c.p.id, true);
    await db.broker.update({ where: { id: b.id }, data: { deletedAt: null, deletedById: null } });
  }
};

/** Only touches loans you can see: you choose the broker for your own loans. */
async function setBrokerLoans(c: Ctx, brokerId: string, ids: unknown[]) {
  const mine = await db.loan.findMany({ where: { householdId: hh(c), borrowers: { some: { userId: c.u.id } }, status: 'active' }, select: { id: true, brokerId: true } });
  const want = new Set(ids.map(String));
  for (const l of mine) {
    if (want.has(l.id) && l.brokerId !== brokerId) await db.loan.update({ where: { id: l.id }, data: { brokerId } });
    if (!want.has(l.id) && l.brokerId === brokerId) await db.loan.update({ where: { id: l.id }, data: { brokerId: null } });
  }
}
