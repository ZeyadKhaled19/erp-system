import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
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
  { name: 'items', order: 'code' },
  { name: 'item_units', order: 'id' },
  { name: 'item_prices', order: 'id' },
  { name: 'stock_balances', order: 'item_id, warehouse_id' },
  { name: 'parties', order: 'kind, code' },
  { name: 'cashboxes', order: 'name' },
  { name: 'partners', order: 'id' },
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
  const data = JSON.parse(await readFile(file, 'utf8')) as BackupFile;
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
