// Every change the screens can make. Each checks access itself.
import type { Membership, Household } from '@prisma/client';
import type { CurrentUser } from './auth';
import { db } from './db';

export class Fail extends Error {}
export type Ctx = { u: CurrentUser; m: (Membership & { household: Household }) | null; p: Record<string, any> };
export type Action = (c: Ctx) => Promise<unknown>;

export const need = (cond: unknown, msg: string) => { if (!cond) throw new Fail(msg); };
export const hh = (c: Ctx) => { need(c.m, 'You are not in a household yet.'); return c.m!.householdId; };
export const canEdit = (c: Ctx) => need(c.m && (c.m.role !== 'VIEWER' || c.u.isAdmin), 'Viewers cannot change household settings.');
export const canManage = (c: Ctx) => need(c.m && (c.m.role === 'OWNER' || c.u.isAdmin), 'Only household owners can do that.');
export const str = (v: unknown, max = 200) => String(v ?? '').trim().slice(0, max);
export const d = (v: unknown) => { const s = String(v || ''); if (!s) return null; const x = new Date(s.length === 10 ? s + 'T00:00:00Z' : s); return isNaN(+x) ? null : x; };
export const money = (v: unknown) => { const n = Number(String(v ?? '').replace(/[$,\s]/g, '')); return isFinite(n) ? Math.round(n * 100) / 100 : NaN; };

import { userActions } from './actions/user';
import { householdActions } from './actions/household';
import { sharedActions } from './actions/shared';
import { loanActions } from './actions/loans';
import { accountActions } from './actions/accounts';
import { statementActions } from './actions/statements';
import { layoutActions } from './actions/layouts';
import { serverActions } from './actions/server';
import { channelActions } from './actions/channels';

export const ACTIONS: Record<string, Action> = {
  ...userActions, ...householdActions, ...sharedActions, ...loanActions, ...accountActions, ...statementActions, ...layoutActions, ...serverActions, ...channelActions
};
export { db };
