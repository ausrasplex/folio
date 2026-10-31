import { redirect } from 'next/navigation';
import AuthCard from '@/components/AuthCard';
import { db } from '@/lib/server/db';
import { completeTwoStep, currentUser, endSession, requestIp } from '@/lib/server/auth';
import { CODES_PER_SESSION, clearFailures, failuresSince, recordAttempt, totpKey } from '@/lib/server/ratelimit';
import { checkTotp, useRecoveryCode } from '@/lib/server/twofactor';

export const dynamic = 'force-dynamic';

async function verify(fd: FormData) {
  'use server';
  const u = await currentUser(true);
  if (!u) redirect('/signin');
  if (!u.pending2fa) redirect('/');
  const code = String(fd.get('code') || '').replace(/\s/g, '');
  const ok = (await checkTotp(u.id, code)) || (await useRecoveryCode(u.id, code));
  const key = totpKey(u.id);
  if (!ok) {
    // five wrong codes end this sign-in: the person has to start again with their password
    await recordAttempt(key, false, await requestIp());
    const s = await db.session.findUnique({ where: { id: u.sessionId } });
    if (!s || (await failuresSince(key, s.createdAt)) >= CODES_PER_SESSION) { await endSession(); redirect('/signin?e=codes'); }
    redirect('/twostep?e=1');
  }
  await clearFailures(key);
  await completeTwoStep(u.id, u.sessionId);
  redirect('/');
}

async function cancel() {
  'use server';
  await endSession();
  redirect('/signin');
}

export default async function Page({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const u = await currentUser(true);
  if (!u) redirect('/signin');
  if (!u.pending2fa) redirect('/');
  const sp = await searchParams;
  return (
    <AuthCard title="Enter your code" sub="Open your authenticator app and enter the 6-digit code for Folio. Lost your phone? Enter one of your recovery codes instead." error={sp.e ? "That code didn't work. Enter the newest code from your app; each code works once." : undefined}>
      <form action={verify} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label className="afld"><span>Code</span><input name="code" inputMode="numeric" autoComplete="one-time-code" autoFocus required /></label>
        <button className="abtn" type="submit">Continue</button>
      </form>
      <form action={cancel} className="alink"><button type="submit" style={{ border: 0, background: 'none', color: 'var(--ink)', fontWeight: 600, cursor: 'pointer', font: 'inherit' }}>Use another account</button></form>
    </AuthCard>
  );
}
