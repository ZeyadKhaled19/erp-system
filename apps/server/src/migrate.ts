import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupToFile } from './backup';
import type { Db } from './db';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/**
 * Migrations آمنة وقابلة لإعادة التشغيل:
 * - كل ملف يُطبّق مرة واحدة ويُسجّل في schema_migrations
 * - كل ملف داخل معاملة؛ إذا فشل لا يُطبق منه شيء
 * - قبل تطبيق أي migration على قاعدة بها بيانات، تُؤخذ نسخة احتياطية تلقائيًا
 */
export async function migrate(db: Db, opts: { backupDir?: string; log?: (m: string) => void } = {}) {
  const log = opts.log ?? (() => {});
  await db.exec(`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
  const applied = new Set((await db.query<{ name: string }>(`select name from schema_migrations`)).map((r) => r.name));
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const pending = files.filter((f) => !applied.has(f));
  if (!pending.length) return [];

  if (applied.size > 0 && opts.backupDir) {
    const file = await backupToFile(db, opts.backupDir, 'pre-migration');
    log(`نسخة احتياطية قبل التحديث: ${file}`);
  }
  for (const f of pending) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, f), 'utf8');
    await db.tx(async (t) => {
      await t.exec(sql);
      await t.query(`insert into schema_migrations (name) values ($1)`, [f]);
    });
    log(`تم تطبيق ${f}`);
  }
  return pending;
}
