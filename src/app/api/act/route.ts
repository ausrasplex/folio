import { crossSiteBlock } from '@/lib/server/origin';
import { currentUser, currentMembership, needsTwoStep, TWO_STEP_ACTIONS, TWO_STEP_NEEDED } from '@/lib/server/auth';
import { ACTIONS, Fail } from '@/lib/server/actions';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  { const blocked = crossSiteBlock(req); if (blocked) return blocked; } // sent from another website
  const u = await currentUser();
  if (!u) return Response.json({ error: 'Sign in again' }, { status: 401 });
  let body: { kind?: string; payload?: Record<string, unknown> };
  try { body = await req.json(); } catch { return Response.json({ error: 'Bad request' }, { status: 400 }); }
  const fn = body.kind ? ACTIONS[body.kind] : undefined;
  if (!fn) return Response.json({ error: 'Unknown action ' + body.kind }, { status: 400 });
  // until required two-step is on, only setting it up works
  if (!TWO_STEP_ACTIONS.has(String(body.kind)) && (await needsTwoStep(u))) return Response.json({ error: TWO_STEP_NEEDED }, { status: 403 });
  try {
    const { m } = await currentMembership(u);
    const out = await fn({ u, m, p: body.payload || {} });
    return Response.json(out ?? { ok: true });
  } catch (e) {
    if (e instanceof Fail) return Response.json({ error: e.message }, { status: 400 });
    console.error('[act]', body.kind, e);
    return Response.json({ error: 'Something went wrong on the server. ' + (e instanceof Error ? e.message : '') }, { status: 500 });
  }
}
