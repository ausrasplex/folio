import { currentUser } from '@/lib/server/auth';
import { Fail } from '@/lib/server/actions';
import { fetchImage } from '@/lib/server/imagefetch';

export const dynamic = 'force-dynamic';

/** Downloads an image from a pasted link. The screen resizes it and saves it like an uploaded file. */
export async function POST(req: Request) {
  const u = await currentUser();
  if (!u) return Response.json({ error: 'Sign in again' }, { status: 401 });
  let body: { url?: string };
  try { body = await req.json(); } catch { return Response.json({ error: 'Bad request' }, { status: 400 }); }
  try {
    const img = await fetchImage(String(body.url || ''));
    return new Response(new Uint8Array(img.body), { headers: { 'content-type': img.type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" } });
  } catch (e) {
    if (e instanceof Fail) return Response.json({ error: e.message }, { status: 400 });
    console.error('[image]', e);
    return Response.json({ error: 'That image could not be downloaded' }, { status: 500 });
  }
}
