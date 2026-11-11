import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupToFile, restoreFromFile } from './backup';
import { openDb } from './db';
import { migrate } from './migrate';
import { seed } from './seed';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const resolve = (p: string) => (path.isAbsolute(p) ? p : path.resolve(root, p));
const DATABASE_URL = process.env.DATABASE_URL || undefined;
const PGLITE_DIR = resolve(process.env.PGLITE_DIR || './data/pg');
const BACKUP_DIR = resolve(process.env.BACKUP_DIR || './backups');

const [cmd, arg] = process.argv.slice(2);
if (!DATABASE_URL) await mkdir(PGLITE_DIR, { recursive: true });
const db = await openDb({ url: DATABASE_URL, dataDir: PGLITE_DIR });
try {
  if (cmd === 'migrate') {
    const applied = await migrate(db, { backupDir: BACKUP_DIR, log: console.log });
    await seed(db, { adminPassword: process.env.ADMIN_INITIAL_PASSWORD });
    console.log(applied.length ? `تم تطبيق ${applied.length} تحديث` : 'قاعدة البيانات محدثة');
  } else if (cmd === 'backup') {
    console.log('تم حفظ النسخة:', await backupToFile(db, BACKUP_DIR, 'manual'));
  } else if (cmd === 'restore') {
    if (!arg) throw new Error('حدد مسار ملف النسخة: npm run restore -- <file>');
    const safety = await backupToFile(db, BACKUP_DIR, 'pre-restore');
    console.log('نسخة أمان قبل الاستعادة:', safety);
    const r = await restoreFromFile(db, resolve(arg));
    console.log(`تمت الاستعادة (${r.rows} صف)`);
  } else {
    console.log('الأوامر: migrate | backup | restore <file>');
  }
} finally {
  await db.close();
}
