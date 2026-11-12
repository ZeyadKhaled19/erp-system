import { backupToFile } from './backup';
import type { Db } from './db';
import { MIGRATIONS } from './migrations.bundle';

/**
 * Migrations آمنة وقابلة لإعادة التشغيل:
 * - كل ملف يُطبّق مرة واحدة ويُسجّل في schema_migrations
 * - التطبيق داخل معاملة واحدة مع قفل؛ إذا فشل لا يُطبق شيء، ولا يطبّقها خادمان في نفس اللحظة
 * - قبل تطبيق أي migration على قاعدة بها بيانات، تُؤخذ نسخة احتياطية تلقائيًا (إن كان هناك مجلد نسخ)
 * - نصوص الملفات مضمنة في migrations.bundle.ts (يُولَّد من مجلد migrations) لتعمل داخل أي حزمة
 */
export async function migrate(db: Db, opts: { backupDir?: string; log?: (m: string) => void } = {}) {
  const log = opts.log ?? (() => {});
  await db.exec(`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
  const applied = new Set((await db.query<{ name: string }>(`select name from schema_migrations`)).map((r) => r.name));
  const pending = MIGRATIONS.filter((m) => !applied.has(m.name));
  if (!pending.length) return [];

  if (applied.size > 0 && opts.backupDir) {
    const file = await backupToFile(db, opts.backupDir, 'pre-migration');
    log(`نسخة احتياطية قبل التحديث: ${file}`);
  }
  const done: string[] = [];
  await db.tx(async (t) => {
    await t.query(`select pg_advisory_xact_lock(7340)`);
    // إعادة القراءة بعد القفل: ربما طبّقها خادم آخر في نفس اللحظة
    const now = new Set((await t.query<{ name: string }>(`select name from schema_migrations`)).map((r) => r.name));
    for (const m of pending) {
      if (now.has(m.name)) continue;
      await t.exec(m.sql);
      await t.query(`insert into schema_migrations (name) values ($1)`, [m.name]);
      done.push(m.name);
      log(`تم تطبيق ${m.name}`);
    }
  });
  return done;
}
