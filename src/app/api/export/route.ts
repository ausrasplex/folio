import JSZip from 'jszip';
import { currentMembership, currentUser, twoStepBlock } from '@/lib/server/auth';
import { db } from '@/lib/server/db';
import { myStatements } from '@/lib/server/visible';

export const dynamic = 'force-dynamic';
const q = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '');

/** Selected statements as a ZIP of the original files and/or a CSV summary. ids=a,b&files=1&csv=1&deleted=1 */
export async function GET(req: Request) {
  const u = await currentUser();
  if (!u) return new Response('Sign in again', { status: 401 });
  { const blocked = await twoStepBlock(u); if (blocked) return blocked; } // required two-step not on yet
  const { m } = await currentMembership(u);
  if (!m) return new Response('Not found', { status: 404 });
  const sp = new URL(req.url).searchParams;
  const ids = (sp.get('ids') || '').split(',').filter(Boolean).slice(0, 2000);
  const files = sp.get('files') !== '0', csv = sp.get('csv') !== '0', withDeleted = sp.get('deleted') === '1';
  const rows = await db.statement.findMany({
    where: { ...myStatements(u.id, m.householdId, withDeleted ? null : false), ...(ids.length ? { id: { in: ids } } : {}) },
    include: { file: true, split: { include: { loan: true } }, account: true, layoutVersion: { include: { layout: true } } },
    orderBy: { periodEnd: 'asc' }
  });
  const nameOf = (s: (typeof rows)[number]) => s.split ? s.split.loan.name + (s.split.name ? ' - ' + s.split.name : '') : s.account?.name || '';
  const head = ['Loan or account', 'Start', 'End', 'Opening', 'Closing', 'Interest', 'Credits', 'Debits', 'Rate', 'Status', 'Layout', 'File', 'Deleted'];
  const lines = [head.join(',')].concat(rows.map((s) => [nameOf(s), day(s.periodStart), day(s.periodEnd), s.opening, s.closing, s.interest, s.credits, s.debits, s.rate, s.status, s.layoutVersion ? s.layoutVersion.layout.name + ' v' + s.layoutVersion.version : '', s.file?.name || '', day(s.deletedAt)].map(q).join(',')));
  const stamp = new Date().toISOString().slice(0, 10);
  if (!files) return new Response(lines.join('\n') + '\n', { headers: { 'content-type': 'text/csv', 'content-disposition': `attachment; filename="folio-statements-${stamp}.csv"` } });
  const zip = new JSZip();
  const used = new Set<string>();
  for (const s of rows) {
    if (!s.file) continue;
    let fn = (nameOf(s) + ' ' + day(s.periodEnd)).replace(/[^\w.\- ]/g, '_') + (/\.csv$/i.test(s.file.name) ? '.csv' : '.pdf');
    while (used.has(fn)) fn = fn.replace(/(\.\w+)$/, ' (2)$1');
    used.add(fn);
    zip.file('statements/' + fn, s.file.data);
  }
  if (csv) zip.file('summary.csv', lines.join('\n') + '\n');
  const out = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return new Response(out as unknown as BodyInit, { headers: { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="folio-statements-${stamp}.zip"` } });
}
