import { db } from '@/lib/server/db';
import { APP_VERSION } from '@/lib/server/backup';

export const dynamic = 'force-dynamic';

/** For the Docker health check: up, and the database answers. Says nothing else about the install. */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ ok: true, version: APP_VERSION }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return Response.json({ ok: false, version: APP_VERSION }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}
