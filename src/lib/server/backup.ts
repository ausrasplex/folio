// Whole-server backups: every table written to one gzipped JSON file in the backup folder, and read back on restore.
import { promises as fs } from 'fs';
import path from 'path';
import { gzipSync, gunzipSync } from 'zlib';
import { Prisma } from '@prisma/client';
import { db } from './db';

export const APP_VERSION = '1.0.0';
// parents before children, so a restore can insert in this order
const ORDER = ['User', 'Household', 'Membership', 'Invite', 'Lender', 'Broker', 'Loan', 'LoanBorrower', 'LoanSplit', 'RateChange', 'RepaymentChange', 'LoanEvent', 'Scenario', 'Account', 'AccountHolder', 'Layout', 'LayoutVersion', 'StoredFile', 'Statement', 'Txn', 'Channel', 'ServerSetting'] as const;
type Delegate = { findMany: (a?: unknown) => Promise<Record<string, unknown>[]>; createMany: (a: unknown) => Promise<unknown>; deleteMany: (a?: unknown) => Promise<unknown> };
const del = (name: string) => (db as unknown as Record<string, Delegate>)[name.charAt(0).toLowerCase() + name.slice(1)];
const fieldsOf = (name: string) => Prisma.dmmf.datamodel.models.find((m) => m.name === name)!.fields.filter((f) => f.kind === 'scalar' || f.kind === 'enum');

export type BackupSettings = { auto: boolean; freq: 'daily' | 'weekly'; keep: number; folder: string; remind: boolean };
export async function backupSettings(): Promise<BackupSettings> {
  const v = ((await db.serverSetting.findUnique({ where: { key: 'backups' } }))?.value || {}) as Partial<BackupSettings>;
  return { auto: v.auto !== false, freq: v.freq === 'weekly' ? 'weekly' : 'daily', keep: [7, 14, 30].includes(Number(v.keep)) ? Number(v.keep) : 7, folder: v.folder || process.env.FOLIO_BACKUP_DIR || './backups', remind: v.remind !== false };
}
export const folderPath = (f: string) => path.resolve(process.cwd(), f);

export async function makeBackup(auto: boolean) {
  const s = await backupSettings();
  const dir = folderPath(s.folder);
  await fs.mkdir(dir, { recursive: true });
  const data: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  for (const name of ORDER) {
    const rows = await del(name).findMany();
    const bytes = fieldsOf(name).filter((f) => f.type === 'Bytes').map((f) => f.name);
    data[name] = rows.map((r) => { const o: Record<string, unknown> = { ...r }; for (const b of bytes) if (o[b]) o[b] = { $b64: Buffer.from(o[b] as Uint8Array).toString('base64') }; return o; });
    counts[name] = rows.length;
  }
  const made = new Date();
  const body = gzipSync(Buffer.from(JSON.stringify({ folio: 'backup', format: 1, appVersion: APP_VERSION, made: made.toISOString(), counts, data })));
  const stamp = made.toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const fileName = 'folio-backup-' + stamp + '.folio';
  await fs.writeFile(path.join(dir, fileName), body);
  const row = await db.backup.create({ data: { fileName, size: body.length, auto } });
  // keep only the newest ones
  const all = await db.backup.findMany({ orderBy: { createdAt: 'desc' } });
  for (const old of all.slice(s.keep)) { await fs.rm(path.join(dir, old.fileName), { force: true }); await db.backup.delete({ where: { id: old.id } }); }
  return row;
}

export function readBackup(buf: Buffer) {
  let j: { folio?: string; format?: number; appVersion?: string; made?: string; counts?: Record<string, number>; data?: Record<string, Record<string, unknown>[]> };
  try { j = JSON.parse(gunzipSync(buf).toString('utf8')); } catch { throw new Error('This is not a Folio backup file.'); }
  if (j.folio !== 'backup' || !j.data) throw new Error('This is not a Folio backup file.');
  return j as Required<typeof j>;
}

/** Replaces everything on the server with the backup. Everyone is signed out. */
export async function restoreBackup(buf: Buffer) {
  const b = readBackup(buf);
  await db.$transaction(async (tx) => {
    const t = (name: string) => (tx as unknown as Record<string, Delegate>)[name.charAt(0).toLowerCase() + name.slice(1)];
    await t('Session').deleteMany();
    for (const name of [...ORDER].reverse()) await t(name).deleteMany();
    for (const name of ORDER) {
      const fields = fieldsOf(name);
      const rows = (b.data[name] || []).map((r) => {
        const o: Record<string, unknown> = {};
        for (const f of fields) {
          const v = r[f.name];
          if (v === undefined || v === null) continue; // nullable columns default to null
          o[f.name] = f.type === 'Bytes' ? Buffer.from((v as { $b64: string }).$b64, 'base64') : v;
        }
        return o;
      });
      for (let i = 0; i < rows.length; i += 500) await t(name).createMany({ data: rows.slice(i, i + 500) });
    }
  }, { timeout: 600000, maxWait: 20000 });
  return b.counts;
}

export async function dirSize(dir: string) {
  try { const names = await fs.readdir(dir); let t = 0; for (const n of names) { const st = await fs.stat(path.join(dir, n)).catch(() => null); if (st && st.isFile()) t += st.size; } return t; } catch { return 0; }
}
export async function freeSpace(dir: string) {
  try { await fs.mkdir(dir, { recursive: true }); const s = await fs.statfs(dir); return { free: s.bavail * s.bsize, total: s.blocks * s.bsize }; } catch { return { free: 0, total: 0 }; }
}
