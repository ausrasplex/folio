import { currentUser, needsTwoStep } from '@/lib/server/auth';
import { buildState } from '@/lib/server/state';

export const dynamic = 'force-dynamic';

export async function GET() {
  const u = await currentUser();
  if (!u) return Response.json({ error: 'Sign in again' }, { status: 401 });
  const st = await buildState(u);
  // until required two-step is on, only what the Profile page needs: nothing about loans, accounts or the household's records
  if (await needsTwoStep(u)) {
    const s = st as { me: unknown; households?: unknown; household?: unknown };
    return Response.json({ me: s.me, households: s.households || [], household: s.household || null, notifications: [], twoStepNeeded: true });
  }
  return Response.json(st);
}
