import { redirect } from 'next/navigation';
import AuthCard from '@/components/AuthCard';
import { db } from '@/lib/server/db';
import { currentUser, passwordMatches, requestIp, startSession } from '@/lib/server/auth';
import { noMatchText, passwordLimit, passwordResult } from '@/lib/server/ratelimit';

export const dynamic = 'force-dynamic';

async function signIn(fd: FormData) {
  'use server';
  const email = String(fd.get('email') || '').trim().toLowerCase();
  const pw = String(fd.get('password') || '');
  const ip = await requestIp();
  // too many wrong passwords: refuse without checking, and say only how long to wait
  const lim = await passwordLimit(email, ip);
  if (!lim.ok) redirect('/signin?e=1&w=' + Math.ceil(lim.waitMs / 60000));
  const u = await db.user.findUnique({ where: { email } });
  const ok = await passwordMatches(u, pw);
  await passwordResult(email, ip, ok);
  if (!ok || !u) redirect('/signin?e=1');
  await startSession(u.id, u.totpOn);
  redirect(u.totpOn ? '/twostep' : '/');
}

export default async function Page({ searchParams }: { searchParams: Promise<{ e?: string; w?: string }> }) {
  if ((await db.user.count()) === 0) redirect('/setup');
  if (await currentUser()) redirect('/');
  const sp = await searchParams;
  return (
    <AuthCard title="Sign in to Folio" sub="Your loans and statements stay on this server." error={sp.e === 'codes' ? 'Too many wrong codes. Sign in again, then enter the newest code from your authenticator app.' : sp.e ? noMatchText(sp.w) : undefined}>
      <form action={signIn} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label className="afld"><span>Email</span><input name="email" type="email" autoComplete="username" required /></label>
        <label className="afld"><span>Password</span><input name="password" type="password" autoComplete="current-password" required /></label>
        <button className="abtn" type="submit">Sign in</button>
      </form>
      <div className="alink">New here? Ask someone in your household for an invite link.</div>
    </AuthCard>
  );
}
