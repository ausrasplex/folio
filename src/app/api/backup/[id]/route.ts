import { promises as fs } from 'fs';
import path from 'path';
import { currentUser } from '@/lib/server/auth';
import { db } from '@/lib/server/db';
import { backupSettings, folderPath } from '@/lib/server/backup';

export const dynamic = 'force-dynamic';

/** Download one backup file (server admin only). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await currentUser();
  if (!u || !u.isAdmin) return new Response('Not found', { status: 404 });
  const { id } = await ctx.params;
  const b = await db.backup.findUnique({ where: { id } });
  if (!b) return new Response('Not found', { status: 404 });
  const s = await backupSettings();
  const buf = await fs.readFile(path.join(folderPath(s.folder), b.fileName)).catch(() => null);
  if (!buf) return new Response('That backup file is no longer in the backup folder.', { status: 404 });
  return new Response(new Uint8Array(buf), { headers: { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="' + b.fileName + '"' } });
}
