import { crossSiteBlock } from '@/lib/server/origin';
import { currentMembership, currentUser, twoStepBlock } from '@/lib/server/auth';
import { db } from '@/lib/server/db';
import { matchFile } from '@/lib/server/importer';
import { guessDest, saveImport } from '@/lib/server/imports';
import { IMPORT_MAX, readForm, tooLarge } from '@/lib/server/limits';
import { attemptsSince, importKey, IMPORTS_PER_MINUTE, recordAttempt } from '@/lib/server/ratelimit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Upload a statement: it is stored, read and matched. With autoSave and a destination it is saved when everything checks out. */
export async function POST(req: Request) {
  { const blocked = crossSiteBlock(req); if (blocked) return blocked; } // sent from another website
  const u = await currentUser();
  if (!u) return Response.json({ error: 'Sign in again' }, { status: 401 });
  { const blocked = await twoStepBlock(u); if (blocked) return blocked; } // required two-step not on yet
  const { m } = await currentMembership(u);
  if (!m) return Response.json({ error: 'You are not in a household yet.' }, { status: 400 });
  // at most 20 files a minute per person
  const key = importKey(u.id);
  if ((await attemptsSince(key, new Date(Date.now() - 60000))) >= IMPORTS_PER_MINUTE) return Response.json({ error: "You've sent " + IMPORTS_PER_MINUTE + ' files in the last minute. Wait a minute, then send the rest.' }, { status: 429 });
  await recordAttempt(key, true, null);
  const fd = await readForm(req, IMPORT_MAX);
  if (!fd) return tooLarge('That file is larger than 25 MB. Statements are usually much smaller; check it is the right file.');
  const f = fd.get('file');
  if (!(f instanceof File)) return Response.json({ error: 'Choose a file' }, { status: 400 });
  if (f.size > 25 * 1024 * 1024) return Response.json({ error: f.name + ' is larger than 25 MB.' }, { status: 400 });
  if (!/\.(pdf|csv)$/i.test(f.name)) return Response.json({ error: f.name + ' is not a PDF or CSV file.' }, { status: 400 });
  const buf = Buffer.from(await f.arrayBuffer());
  const dest = String(fd.get('dest') || '');
  const stored = await db.storedFile.create({ data: { name: f.name.slice(0, 200), mime: f.type || (/\.csv$/i.test(f.name) ? 'text/csv' : 'application/pdf'), size: f.size, data: buf, pending: { householdId: m.householdId, userId: u.id, dest } } });
  let match;
  try { match = await matchFile(buf, f.name, stored.mime); } catch (e) {
    return Response.json({ fileId: stored.id, name: f.name, error: 'This file could not be read. ' + (e instanceof Error ? e.message : ''), layout: null });
  }
  // most but not all of the checks passed with this layout: it probably needs re-mapping (this raises the alert)
  if ('remap' in match && match.remap) {
    await db.layout.update({ where: { id: match.remap.id }, data: { status: 'remap', failedNote: new Date().toISOString().slice(0, 10) } }).catch(() => {});
  }
  const guess = dest || (await guessDest(u.id, m.householdId, match.layout?.lenderName || null, match.layout?.kind || null, match.read));
  if (fd.get('autoSave') && guess && match.read && match.read.ok) {
    try { const s = await saveImport({ fileId: stored.id, destId: guess, userId: u.id, householdId: m.householdId }); return Response.json({ saved: true, ...s }); } catch { /* falls through to review */ }
  }
  return Response.json({
    fileId: stored.id, name: f.name, size: f.size, format: /\.csv$/i.test(f.name) ? 'CSV' : 'PDF',
    layout: match.layout ? { id: match.layout.id, name: match.layout.name, lenderName: match.layout.lenderName, kind: match.layout.kind, version: match.version!.version, versionId: match.version!.id } : null,
    near: 'near' in match && match.near ? { id: match.near.id, name: match.near.name } : null,
    read: match.read, dest: guess
  });
}
