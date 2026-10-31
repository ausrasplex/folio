import { redirect } from 'next/navigation';
import AuthCard from '@/components/AuthCard';
import { db } from '@/lib/server/db';
import { checkPassword, currentUser, hashPassword, startSession } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

async function validInvite(t: string) {
  const inv = await db.invite.findUnique({ where: { token: t }, include: { household: true } });
  if (!inv || inv.usedAt || inv.revokedAt || inv.expiresAt < new Date() || inv.household.deletedAt) return null;
  return inv;
}

async function join(fd: FormData) {
  'use server';
  const t = String(fd.get('token') || '');
  const inv = await validInvite(t);
  if (!inv) redirect('/join?t=' + encodeURIComponent(t));
  const signup = await db.serverSetting.findUnique({ where: { key: 'signup' } });
  const email = String(fd.get('email') || '').trim().toLowerCase();
  const pw = String(fd.get('password') || '');
  const name = String(fd.get('name') || '').trim();
  let u = await db.user.findUnique({ where: { email } });
  if (u) {
    if (!(await checkPassword(pw, u.passwordHash))) redirect('/join?t=' + encodeURIComponent(t) + '&e=pw');
  } else {
    if (signup && signup.value === 'closed') redirect('/join?t=' + encodeURIComponent(t) + '&e=closed');
    if (!name || pw.length < 8) redirect('/join?t=' + encodeURIComponent(t) + '&e=1');
    u = await db.user.create({ data: { email, displayName: name, passwordHash: await hashPassword(pw) } });
  }
  await db.membership.upsert({ where: { userId_householdId: { userId: u.id, householdId: inv.householdId } }, update: { removedAt: null, role: inv.role }, create: { userId: u.id, householdId: inv.householdId, role: inv.role } });
  await db.invite.update({ where: { id: inv.id }, data: { usedAt: new Date() } });
  await db.user.update({ where: { id: u.id }, data: { currentHouseholdId: inv.householdId } });
  await startSession(u.id, u.totpOn);
  redirect(u.totpOn ? '/twostep' : '/');
}

export default async function Page({ searchParams }: { searchParams: Promise<{ t?: string; e?: string }> }) {
  const sp = await searchParams;
  const inv = sp.t ? await validInvite(sp.t) : null;
  if (!inv) return <AuthCard title="This invite has expired" sub="Invite links work once and expire after 7 days. Ask for a new one." ><a className="abtn" href="/signin" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>Go to sign in</a></AuthCard>;
  const me = await currentUser();
  const err = sp.e === 'pw' ? 'That account exists, but the password does not match.' : sp.e === 'closed' ? 'This server is not taking new accounts right now.' : sp.e ? 'Fill in every field. The password needs at least 8 characters.' : undefined;
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
