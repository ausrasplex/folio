import { redirect } from 'next/navigation';
import AuthCard from '@/components/AuthCard';
import { db } from '@/lib/server/db';
import { hashPassword, MIN_PASSWORD, PASSWORD_RULE, passwordProblem, startSession } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

async function create(fd: FormData) {
  'use server';
  if ((await db.user.count()) > 0) redirect('/signin');
  const name = String(fd.get('name') || '').trim();
  const email = String(fd.get('email') || '').trim().toLowerCase();
  const pw = String(fd.get('password') || '');
  const hh = String(fd.get('household') || '').trim() || name + "'s household";
  if (!name || !email) redirect('/setup?e=1');
  if (passwordProblem(pw, email, name)) redirect('/setup?e=pw');
  const u = await db.user.create({ data: { email, displayName: name, passwordHash: await hashPassword(pw), isAdmin: true } });
  const h = await db.household.create({ data: { name: hh } });
  await db.membership.create({ data: { userId: u.id, householdId: h.id, role: 'OWNER' } });
  await db.user.update({ where: { id: u.id }, data: { currentHouseholdId: h.id } });
  await startSession(u.id);
  redirect('/');
}

export default async function Page({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  if ((await db.user.count()) > 0) redirect('/signin');
  const sp = await searchParams;
  return (
    <AuthCard title="Set up Folio" sub="You are the first person here, so you become the server admin and the owner of your household. You can invite others afterwards." error={sp.e === 'pw' ? PASSWORD_RULE : sp.e ? 'Fill in your name, email and password.' : undefined}>
      <form action={create} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label className="afld"><span>Your name</span><input name="name" autoComplete="name" required /></label>
        <label className="afld"><span>Email</span><input name="email" type="email" autoComplete="username" required /></label>
        <label className="afld"><span>Password</span><input name="password" type="password" autoComplete="new-password" minLength={MIN_PASSWORD} required /></label>
        <label className="afld"><span>Household name</span><input name="household" placeholder="For example, The Smith household" /></label>
        <button className="abtn" type="submit">Create and continue</button>
      </form>
    </AuthCard>
  );
}
