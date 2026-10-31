import { redirect } from 'next/navigation';
import AuthCard from '@/components/AuthCard';
import { db } from '@/lib/server/db';
import { currentUser, hashPassword, PASSWORD_RULE, passwordMatches, passwordProblem, requestIp, startSession } from '@/lib/server/auth';
import { localOrVpn } from '@/lib/server/netrange';
import { noMatchText, passwordLimit, passwordResult } from '@/lib/server/ratelimit';
import { logEvent, logWrongPassword } from '@/lib/server/security';

export const dynamic = 'force-dynamic';

async function validInvite(t: string) {
  const inv = await db.invite.findUnique({ where: { token: t }, include: { household: true } });
  if (!inv || inv.usedAt || inv.revokedAt || inv.expiresAt < new Date() || inv.household.deletedAt) return null;
  return inv;
}

/** Whether this visitor may open invites. Unless the admin has turned it off, only from the home network or its VPN. */
async function inviteReachable() {
  const s = await db.serverSetting.findUnique({ where: { key: 'invitesLocalOnly' } });
  if (s && s.value === false) return true;
  return localOrVpn(await requestIp());
}

async function join(fd: FormData) {
  'use server';
  const t = String(fd.get('token') || '');
  const inv = await validInvite(t);
  if (!inv || !(await inviteReachable())) redirect('/join?t=' + encodeURIComponent(t));
  const signup = await db.serverSetting.findUnique({ where: { key: 'signup' } });
  const email = String(fd.get('email') || '').trim().toLowerCase();
  const pw = String(fd.get('password') || '');
  const name = String(fd.get('name') || '').trim();
  let u = await db.user.findUnique({ where: { email } });
  if (u) {
    // an existing account: the same limit and message as signing in
    const ip = await requestIp();
    const lim = await passwordLimit(email, ip);
    if (!lim.ok) redirect('/join?t=' + encodeURIComponent(t) + '&e=pw&w=' + Math.ceil(lim.waitMs / 60000));
    const ok = await passwordMatches(u, pw);
    await passwordResult(email, ip, ok);
    if (!ok) { await logWrongPassword(email, u.id, ip); redirect('/join?t=' + encodeURIComponent(t) + '&e=pw'); }
  } else {
    if (signup && signup.value === 'closed') redirect('/join?t=' + encodeURIComponent(t) + '&e=closed');
    if (!name) redirect('/join?t=' + encodeURIComponent(t) + '&e=1');
    if (passwordProblem(pw, email, name)) redirect('/join?t=' + encodeURIComponent(t) + '&e=rule');
    u = await db.user.create({ data: { email, displayName: name, passwordHash: await hashPassword(pw) } });
  }
  await db.membership.upsert({ where: { userId_householdId: { userId: u.id, householdId: inv.householdId } }, update: { removedAt: null, role: inv.role }, create: { userId: u.id, householdId: inv.householdId, role: inv.role } });
  await db.invite.update({ where: { id: inv.id }, data: { usedAt: new Date() } });
  await db.user.update({ where: { id: u.id }, data: { currentHouseholdId: inv.householdId } });
  await startSession(u.id, u.totpOn);
  if (!u.totpOn) await logEvent('signin', { userId: u.id, detail: { via: 'invite' } });
  redirect(u.totpOn ? '/twostep' : '/');
}

export default async function Page({ searchParams }: { searchParams: Promise<{ t?: string; e?: string; w?: string }> }) {
  const sp = await searchParams;
  // checked first: from outside, the page says nothing about the invite or the household
  if (!(await inviteReachable())) return <AuthCard title="Open This Invite at Home" sub="Open this invite on the same network as the server, or over its VPN."><a className="abtn" href="/signin" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>Go to sign in</a></AuthCard>;
  const inv = sp.t ? await validInvite(sp.t) : null;
  if (!inv) return <AuthCard title="This invite has expired" sub="Invite links work once and expire after 7 days. Ask for a new one." ><a className="abtn" href="/signin" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>Go to sign in</a></AuthCard>;
  const me = await currentUser();
  // never says whether the email already has an account
  const err = sp.e === 'pw' ? noMatchText(sp.w) : sp.e === 'closed' ? 'This server is not taking new accounts right now.' : sp.e === 'rule' ? PASSWORD_RULE : sp.e ? 'Fill in your name, email and password.' : undefined;
  return (
    <AuthCard title={'Join ' + inv.household.name} sub={'You have been invited as ' + (inv.role === 'OWNER' ? 'an owner' : inv.role === 'EDITOR' ? 'an editor' : 'a viewer') + '. Already have an account on this server? Use its email and password.'} error={err}>
      <form action={join} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <input type="hidden" name="token" value={inv.token} />
        <label className="afld"><span>Your name</span><input name="name" autoComplete="name" defaultValue={me?.displayName || ''} /></label>
        <label className="afld"><span>Email</span><input name="email" type="email" autoComplete="username" defaultValue={me?.email || ''} required /></label>
        <label className="afld"><span>Password</span><input name="password" type="password" autoComplete="new-password" required /></label>
        <button className="abtn" type="submit">Join household</button>
      </form>
    </AuthCard>
  );
}
