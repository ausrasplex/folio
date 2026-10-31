import { redirect } from 'next/navigation';
import AuthCard from '@/components/AuthCard';
import { db } from '@/lib/server/db';
import { checkPassword, currentUser, startSession } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

async function signIn(fd: FormData) {
  'use server';
  const email = String(fd.get('email') || '').trim().toLowerCase();
  const pw = String(fd.get('password') || '');
  const u = await db.user.findUnique({ where: { email } });
  if (!u || !(await checkPassword(pw, u.passwordHash))) redirect('/signin?e=1');
  await startSession(u.id, u.totpOn);
  redirect(u.totpOn ? '/twostep' : '/');
}

export default async function Page({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  if ((await db.user.count()) === 0) redirect('/setup');
  if (await currentUser()) redirect('/');
  const sp = await searchParams;
  return (
    <AuthCard title="Sign in to Folio" sub="Your loans and statements stay on this server." error={sp.e ? 'That email and password do not match.' : undefined}>
      <form action={signIn} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label className="afld"><span>Email</span><input name="email" type="email" autoComplete="username" required /></label>
        <label className="afld"><span>Password</span><input name="password" type="password" autoComplete="current-password" required /></label>
        <button className="abtn" type="submit">Sign in</button>
      </form>
      <div className="alink">New here? Ask someone in your household for an invite link.</div>
    </AuthCard>
  );
}
