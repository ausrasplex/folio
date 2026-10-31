import { currentUser } from '@/lib/server/auth';
import { buildState } from '@/lib/server/state';

export const dynamic = 'force-dynamic';

export async function GET() {
  const u = await currentUser();
  if (!u) return Response.json({ error: 'Sign in again' }, { status: 401 });
  return Response.json(await buildState(u));
}
