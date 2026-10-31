import { currentMembership, currentUser, twoStepBlock } from '@/lib/server/auth';
import { servedType } from '@/lib/server/filecheck';
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
  const data = new Uint8Array(f.data);
  return new Response(data, {
    headers: {
      // the type comes from the file's contents, never the type sent when it was uploaded, and the browser may not guess
      // otherwise or run anything in it: a statement can never act as a page on Folio's address
      'content-type': servedType(f.name, data, !!dl),
      'content-disposition': (dl ? 'attachment' : 'inline') + '; filename="' + f.name.replace(/[^\w.\- ]/g, '_') + '"',
      'content-security-policy': 'sandbox',
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, max-age=300'
    }
  });
}
