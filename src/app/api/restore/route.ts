import { currentUser } from '@/lib/server/auth';
import { readBackup, restoreBackup } from '@/lib/server/backup';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

/** Restore: step 1 (no confirm) reads the file and describes it; step 2 (confirm=RESTORE) replaces everything. Admin only. */
export async function POST(req: Request) {
  const u = await currentUser();
  if (!u || !u.isAdmin) return Response.json({ error: 'Only the server admin can restore a backup.' }, { status: 403 });
  const fd = await req.formData();
  const f = fd.get('file');
  if (!(f instanceof File)) return Response.json({ error: 'Choose a backup file' }, { status: 400 });
  const buf = Buffer.from(await f.arrayBuffer());
  try {
    if (String(fd.get('confirm') || '') !== 'RESTORE') {
      const b = readBackup(buf);
      const c = b.counts || {};
      return Response.json({ name: f.name, made: b.made, appVersion: b.appVersion, households: c.Household || 0, people: c.User || 0, loans: (c.Loan || 0) + (c.Account || 0), statements: c.Statement || 0, size: buf.length });
    }
    await restoreBackup(buf);
    return Response.json({ restored: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'The restore did not work.' }, { status: 400 });
  }
}
