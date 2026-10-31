import { currentMembership, currentUser, twoStepBlock } from '@/lib/server/auth';
import { myFile } from '@/lib/server/visible';

export const dynamic = 'force-dynamic';

/** The original statement file, for viewing or download. Only for statements you can see, or your own pending upload. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await currentUser();
  if (!u) return new Response('Sign in again', { status: 401 });
  { const blocked = await twoStepBlock(u); if (blocked) return blocked; } // required two-step not on yet
  const { m } = await currentMembership(u);
  if (!m) return new Response('Not found', { status: 404 });
  const { id } = await ctx.params;
  const f = await myFile(u.id, m.householdId, id);
  if (!f) return new Response('Not found', { status: 404 });
  const dl = new URL(req.url).searchParams.get('download');
  return new Response(new Uint8Array(f.data), {
    headers: {
      'content-type': f.mime || 'application/octet-stream',
      'content-disposition': (dl ? 'attachment' : 'inline') + '; filename="' + f.name.replace(/[^\w.\- ]/g, '_') + '"',
      'cache-control': 'private, max-age=300'
    }
  });
}
