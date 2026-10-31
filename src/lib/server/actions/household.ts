// Household settings: name, members and their roles, invites, deleting the household.
import { type Action, type Ctx, canManage, db, hh, need, str } from '../actions';
import { token } from '../crypto';

const ROLES: Record<string, 'OWNER' | 'EDITOR' | 'VIEWER'> = { Owner: 'OWNER', Editor: 'EDITOR', Viewer: 'VIEWER', OWNER: 'OWNER', EDITOR: 'EDITOR', VIEWER: 'VIEWER' };
const WORD: Record<string, string> = { OWNER: 'an owner', EDITOR: 'an editor', VIEWER: 'a viewer' };

async function ownersLeft(c: Ctx, change?: { userId: string; role?: string; removed?: boolean }) {
  const ms = await db.membership.findMany({ where: { householdId: hh(c), removedAt: null } });
  return ms.filter((m) => {
    if (change && m.userId === change.userId) return !change.removed && (change.role ?? m.role) === 'OWNER';
    return m.role === 'OWNER';
  }).length;
}
async function member(c: Ctx, userId: unknown, removed = false) {
  const m = await db.membership.findFirst({ where: { householdId: hh(c), userId: str(userId), removedAt: removed ? { not: null } : null }, include: { user: true } });
  need(m, 'That person is not in this household.');
  return m!;
}

export const householdActions: Record<string, Action> = {
  renameHousehold: async (c) => {
    canManage(c);
    const name = str(c.p.name, 60);
    need(name, 'A household needs a name.');
    await db.household.update({ where: { id: hh(c) }, data: { name } });
  },
  setRole: async (c) => {
    canManage(c);
    const m = await member(c, c.p.userId);
    const role = ROLES[str(c.p.role)];
    need(role, 'Choose a role.');
    need(await ownersLeft(c, { userId: m.userId, role }), 'A household needs at least one owner.');
    await db.membership.update({ where: { id: m.id }, data: { role } });
    return { text: m.user.displayName + ' is now ' + WORD[role] };
  },
  removeMember: async (c) => {
    canManage(c);
    const m = await member(c, c.p.userId);
    need(m.userId !== c.u.id, 'You cannot remove yourself. Ask another owner.');
    need(await ownersLeft(c, { userId: m.userId, removed: true }), 'A household needs at least one owner. Make someone else an owner first.');
    await db.membership.update({ where: { id: m.id }, data: { removedAt: new Date() } });
    await db.user.updateMany({ where: { id: m.userId, currentHouseholdId: m.householdId }, data: { currentHouseholdId: null } });
  },
  restoreMember: async (c) => {
    canManage(c);
    const m = await member(c, c.p.userId, true);
    await db.membership.update({ where: { id: m.id }, data: { removedAt: null } });
  },
  createInvite: async (c) => {
    canManage(c);
    const role = ROLES[str(c.p.role)] || 'VIEWER';
    const inv = await db.invite.create({ data: { householdId: hh(c), role, token: token(18), createdById: c.u.id, expiresAt: new Date(Date.now() + 7 * 86400000) } });
    return { id: inv.id, token: inv.token };
  },
  revokeInvite: async (c) => {
    canManage(c);
    const inv = await db.invite.findFirst({ where: { id: str(c.p.id), householdId: hh(c), usedAt: null, revokedAt: null } });
    need(inv, 'That invite is no longer waiting.');
    await db.invite.update({ where: { id: inv!.id }, data: { revokedAt: new Date() } });
  },
  /** Only an empty household can go. A blocked delete names only what you can see. */
  deleteHousehold: async (c) => {
    canManage(c);
    const hid = hh(c);
    const loans = await db.loan.findMany({ where: { householdId: hid, status: 'active' }, include: { borrowers: true } });
    const accts = await db.account.findMany({ where: { householdId: hid, deletedAt: null, closedAt: null }, include: { holders: true } });
    const visible = loans.filter((l) => l.borrowers.some((b) => b.userId === c.u.id)).map((l) => l.name).concat(accts.filter((a) => a.holders.some((h) => h.userId === c.u.id)).map((a) => a.name));
    const hidden = loans.length + accts.length - visible.length;
    if (visible.length || hidden) return { blocked: true, visible, hidden: hidden > 0 };
    const hhRow = await db.household.findUnique({ where: { id: hid } });
    need(str(c.p.confirm).toLowerCase() === hhRow!.name.toLowerCase(), 'Type the household name to confirm.');
    await db.household.update({ where: { id: hid }, data: { deletedAt: new Date() } });
    await db.invite.updateMany({ where: { householdId: hid, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    const next = await db.membership.findFirst({ where: { userId: c.u.id, removedAt: null, householdId: { not: hid }, household: { deletedAt: null } } });
    await db.user.update({ where: { id: c.u.id }, data: { currentHouseholdId: next?.householdId || null } });
    return { deleted: true };
  },
  createHousehold: async (c) => {
    const name = str(c.p.name, 60);
    need(name, 'A household needs a name.');
    const h = await db.household.create({ data: { name, memberships: { create: { userId: c.u.id, role: 'OWNER' } } } });
    await db.user.update({ where: { id: c.u.id }, data: { currentHouseholdId: h.id } });
    return { id: h.id };
  }
};
