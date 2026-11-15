import { copyFile, mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import type { Db } from './db';

/**
 * النسخ الاحتياطي بصيغة JSON مستقلة عن نوع قاعدة البيانات (PGlite أو PostgreSQL).
 * الاستعادة تتم داخل معاملة واحدة: إذا فشل أي جزء لا يتغير شيء.
 */

/** ترتيب الجداول يراعي العلاقات (الأب قبل الابن) */
export const BACKUP_TABLES: { name: string; order: string }[] = [
  { name: 'schema_migrations', order: 'name' },
  { name: 'settings', order: 'key' },
  { name: 'roles', order: 'id' },
  { name: 'users', order: 'created_at, id' },
  { name: 'devices', order: 'first_seen, id' },
  { name: 'accounts', order: 'length(code), code' },
  { name: 'warehouses', order: 'code' },
  { name: 'categories', order: 'name' },
  { name: 'price_lists', order: 'sort, id' },
  { name: 'sales_reps', order: 'id' },
  { name: 'party_groups', order: 'sort, id' },
  { name: 'scooter_brands', order: 'sort, id' },
  { name: 'items', order: 'code' },
  { name: 'item_units', order: 'id' },
  { name: 'item_prices', order: 'id' },
  { name: 'stock_balances', order: 'item_id, warehouse_id' },
  { name: 'parties', order: 'kind, code' },
  { name: 'cashboxes', order: 'name' },
  { name: 'partners', order: 'id' },
  // الموظفون قبل المستندات (السلف والرواتب مربوطة بيهم)
  { name: 'departments', order: 'id' },
  { name: 'job_titles', order: 'id' },
  { name: 'employees', order: 'id' },
  { name: 'attendance', order: 'date, id' },
  { name: 'doc_sequences', order: 'key' },
  { name: 'documents', order: 'created_at, id' },
  { name: 'document_lines', order: 'document_id, line_no' },
  { name: 'deliveries', order: 'created_at, id' },
  { name: 'delivery_lines', order: 'id' },
  { name: 'document_payments', order: 'id' },
  { name: 'instruments', order: 'id' },
  { name: 'allocations', order: 'id' },
  { name: 'serials', order: 'id' },
  { name: 'serial_moves', order: 'id' },
  { name: 'stock_lots', order: 'id' },
  { name: 'lot_moves', order: 'id' },
  { name: 'cashier_shifts', order: 'opened_at, id' },
  { name: 'stock_moves', order: 'id' },
  { name: 'journal_entries', order: 'number' },
  { name: 'journal_lines', order: 'id' },
  { name: 'processed_ops', order: 'received_at, op_id' },
  { name: 'sync_conflicts', order: 'created_at, id' },
  { name: 'audit_log', order: 'id' },
];

const SERIAL_SEQS: { seq: string; table: string; col: string }[] = [
  { seq: 'stock_moves_id_seq', table: 'stock_moves', col: 'id' },
  { seq: 'journal_lines_id_seq', table: 'journal_lines', col: 'id' },
  { seq: 'audit_log_id_seq', table: 'audit_log', col: 'id' },
  { seq: 'journal_no_seq', table: 'journal_entries', col: 'number' },
  { seq: 'allocations_id_seq', table: 'allocations', col: 'id' },
  { seq: 'serial_moves_id_seq', table: 'serial_moves', col: 'id' },
  { seq: 'lot_moves_id_seq', table: 'lot_moves', col: 'id' },
  { seq: 'delivery_lines_id_seq', table: 'delivery_lines', col: 'id' },
];

export interface BackupFile {
  format: 'erp-backup';
  version: 1;
  created_at: string;
  reason: string;
  tables: Record<string, any[]>;
}

export async function exportData(db: Db, reason = 'manual'): Promise<BackupFile> {
  return db.tx(async (t) => {
    const tables: Record<string, any[]> = {};
    for (const tb of BACKUP_TABLES) {
      const exists = await t.one(`select to_regclass($1) as r`, [tb.name]);
      if (!exists?.r) continue;
      tables[tb.name] = await t.query(`select * from ${tb.name} order by ${tb.order}`);
    }
    return { format: 'erp-backup', version: 1, created_at: new Date().toISOString(), reason, tables };
  });
}

function toParam(v: unknown) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

export async function importData(db: Db, data: BackupFile): Promise<{ rows: number }> {
  if (data?.format !== 'erp-backup') throw new Error('ملف النسخة الاحتياطية غير صالح');
  let rows = 0;
  await db.tx(async (t) => {
    const present = BACKUP_TABLES.filter((tb) => data.tables[tb.name]);
    await t.exec(`TRUNCATE ${BACKUP_TABLES.map((x) => x.name).join(', ')} RESTART IDENTITY CASCADE`);
    for (const tb of present) {
      const jsonCols = new Set(
        (await t.query(`select column_name from information_schema.columns where table_name = $1 and data_type in ('json','jsonb')`, [tb.name])).map((c) => c.column_name),
      );
      for (const row of data.tables[tb.name]) {
        const r = { ...row };
        // الارتباطات الدائرية تُضبط بعد الإدخال
        const deferred: Record<string, unknown> = {};
        if (tb.name === 'journal_entries' && r.reversed_by_id) {
          deferred.reversed_by_id = r.reversed_by_id;
          r.reversed_by_id = null;
        }
        if (tb.name === 'documents' && r.converted_to_id) {
          (data as any)._deferredDocs ??= [];
          (data as any)._deferredDocs.push([r.id, r.converted_to_id]);
          r.converted_to_id = null;
        }
        const cols = Object.keys(r);
        const sql = `insert into ${tb.name} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})`;
        await t.query(
          sql,
          cols.map((c) => (jsonCols.has(c) ? (r[c] === undefined ? null : JSON.stringify(r[c])) : toParam(r[c]))),
        );
        if (deferred.reversed_by_id) {
          (data as any)._deferred ??= [];
          (data as any)._deferred.push([r.id, deferred.reversed_by_id]);
        }
        rows++;
      }
    }
    for (const [id, rev] of ((data as any)._deferred ?? []) as [string, string][]) {
      await t.query(`update journal_entries set reversed_by_id = $2 where id = $1`, [id, rev]);
    }
    for (const [id, conv] of ((data as any)._deferredDocs ?? []) as [string, string][]) {
      await t.query(`update documents set converted_to_id = $2 where id = $1`, [id, conv]);
    }
    for (const s of SERIAL_SEQS) {
      await t.query(`select setval('${s.seq}', greatest((select coalesce(max(${s.col}), 0) from ${s.table}), 1))`);
    }
    // حقبة جديدة: تجبر كل الأجهزة على إعادة السحب الكامل بعد الاستعادة
    await t.query(
      `insert into settings (key, value) values ('db_epoch', $1) on conflict (key) do update set value = excluded.value`,
      [JSON.stringify(crypto.randomUUID())],
    );
  });
  return { rows };
}

export async function backupToFile(db: Db, dir: string, reason = 'manual'): Promise<string> {
  await mkdir(dir, { recursive: true });
  const data = await exportData(db, reason);
  const stamp = data.created_at.replace(/[:.]/g, '-');
  const file = path.join(dir, `erp-backup-${stamp}-${reason}.json`);
  await writeFile(file, JSON.stringify(data));
  return file;
}

export async function restoreFromFile(db: Db, file: string) {
  // يقبل الملف عادي أو مضغوط (gzip) — زي اللي بينزل من «تنزيل نسخة على جهازي» لو المتصفح ما فكّهوش
  const raw = await readFile(file);
  const text = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw).toString('utf8') : raw.toString('utf8');
  const data = JSON.parse(text.replace(/^﻿/, '')) as BackupFile;
  return importData(db, data);
}

export async function listBackups(dir: string) {
  try {
    const files = await readdir(dir);
    return files.filter((f) => f.startsWith('erp-backup-') && f.endsWith('.json')).sort().reverse();
  } catch {
    return [];
  }
}

// =====================================================================================
// النسخ التلقائي (للتشغيل المحلي على جهاز المحل): كل ساعة لو فيه تغيير، وأول نسخة كل يوم بتتعلّم «daily»
// =====================================================================================

/** يمسح القديم من نوع معيّن (daily / hourly) ويسيب آخر `keep` نسخة؛ النسخ اليدوية وما قبل التحديث ما بتتمسحش */
export async function pruneBackups(dir: string, reason: 'daily' | 'hourly', keep: number) {
  const files = (await listBackups(dir)).filter((f) => f.endsWith(`-${reason}.json`));
  for (const f of files.slice(Math.max(1, keep))) {
    await unlink(path.join(dir, f)).catch(() => {});
  }
}
/** للتوافق: مسح النسخ اليومية القديمة */
export const pruneDailyBackups = (dir: string, keep: number) => pruneBackups(dir, 'daily', keep);

/** بصمة لحالة البيانات: بتتغير مع أي كتابة (كل الجداول المتزامنة بتزوّد sync_seq، والعمليات بتتسجل في audit_log/processed_ops) */
async function dataFingerprint(db: Db): Promise<string> {
  const r = await db.one<{ f: string }>(
    `select (select last_value from sync_seq)::text || '/' || (select coalesce(max(id), 0) from audit_log)::text || '/' || (select count(*) from processed_ops)::text as f`,
  );
  return r?.f ?? '';
}

/** وقت النسخة من اسم الملف: erp-backup-2026-11-15T11-02-04-282Z-daily.json */
export function backupFileTime(file: string): Date | null {
  const m = file.match(/^erp-backup-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/);
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export interface AutoBackupOptions {
  dir: string;
  /** فولدر تاني تتنسخ فيه كل نسخة (فلاشة أو هارد خارجي أو فولدر Google Drive) */
  copyDir?: string;
  /** كل كام دقيقة (افتراضي 60) */
  everyMinutes?: number;
  /** عدد النسخ اليومية اللي تفضل (افتراضي 30) */
  keep?: number;
  /** عدد نسخ الساعات اللي تفضل (افتراضي 48 = يومين) */
  keepHourly?: number;
  log?: (m: string) => void;
}

export interface AutoBackups {
  stop: () => void;
  /** نسخة فورية (مثلًا قبل قفل البرنامج). `onlyIfChanged` يتخطاها لو مفيش تغيير من آخر نسخة */
  backupNow: (opts?: { reason?: string; onlyIfChanged?: boolean }) => Promise<{ file: string | null; skipped: boolean }>;
  /** تغيير فولدر النسخة التانية من غير إعادة تشغيل (فاضي = من غير نسخة تانية) */
  setCopyDir: (dir: string | undefined) => void;
}

export function startAutoBackups(db: Db, opts: AutoBackupOptions): AutoBackups {
  const log = opts.log ?? (() => {});
  const every = Math.max(1, opts.everyMinutes ?? 60) * 60_000;
  const keepDaily = opts.keep ?? 30;
  const keepHourly = opts.keepHourly ?? 48;
  let lastPrint: string | null = null;
  let copyDir = opts.copyDir;
  let lastAt = 0;
  let chain: Promise<unknown> = Promise.resolve();

  const take = async (reason: string) => {
    const file = await backupToFile(db, opts.dir, reason);
    lastAt = Date.now();
    lastPrint = await dataFingerprint(db);
    log(`نسخة احتياطية (${reason}): ${file}`);
    if (copyDir) {
      try {
        await mkdir(copyDir, { recursive: true });
        await copyFile(file, path.join(copyDir, path.basename(file)));
        if (reason === 'daily' || reason === 'hourly') await pruneBackups(copyDir, reason, reason === 'daily' ? keepDaily : keepHourly);
      } catch (e) {
        log(`⚠ ما قدرتش أنسخها في ${copyDir}: ${(e as Error).message} (النسخة الأساسية اتحفظت عادي)`);
      }
    }
    if (reason === 'daily' || reason === 'hourly') await pruneBackups(opts.dir, reason, reason === 'daily' ? keepDaily : keepHourly);
    return file;
  };

  // أول نسخة في اليوم «daily» (بتتحفظ 30 يوم)، والباقي «hourly» (بتتحفظ يومين)
  const scheduledReason = async () => {
    const today = localDay();
    const hasToday = (await listBackups(opts.dir)).some((f) => {
      if (!f.endsWith('-daily.json')) return false;
      const t = backupFileTime(f);
      return !!t && localDay(t) === today;
    });
    return hasToday ? 'hourly' : 'daily';
  };

  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = chain.then(fn, fn);
    chain = p.catch(() => {});
    return p;
  };

  const tick = () =>
    serial(async () => {
      try {
        if (!lastAt) {
          // بعد إعادة التشغيل: آخر نسخة موجودة بتحدد الميعاد
          const last = (await listBackups(opts.dir)).find((f) => /-(daily|hourly)\.json$/.test(f));
          lastAt = last ? (await stat(path.join(opts.dir, last))).mtimeMs : 0;
        }
        const reason = await scheduledReason();
        if (reason !== 'daily' && Date.now() - lastAt < every) return;
        const fp = await dataFingerprint(db);
        if (reason !== 'daily' && lastPrint !== null && fp === lastPrint) return; // مفيش جديد من آخر نسخة
        await take(reason);
      } catch (e) {
        log(`⚠ فشلت النسخة الاحتياطية التلقائية: ${(e as Error).message}`);
      }
    });

  void tick();
  const timer = setInterval(() => void tick(), Math.min(every, 5 * 60_000));
  timer.unref?.();

  return {
    stop: () => clearInterval(timer),
    setCopyDir: (dir) => { copyDir = dir || undefined; },
    backupNow: ({ reason = 'manual', onlyIfChanged = false } = {}) =>
      serial(async () => {
        if (onlyIfChanged && lastPrint !== null && (await dataFingerprint(db)) === lastPrint) return { file: null, skipped: true };
        return { file: await take(reason), skipped: false };
      }),
  };
}
