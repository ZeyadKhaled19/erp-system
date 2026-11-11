import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app';
import { openDb } from './db';
import { migrate } from './migrate';
import { seed } from './seed';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const resolve = (p: string) => (path.isAbsolute(p) ? p : path.resolve(root, p));

const PORT = Number(process.env.PORT ?? 4000);
const DATABASE_URL = process.env.DATABASE_URL || undefined;
const PGLITE_DIR = resolve(process.env.PGLITE_DIR || './data/pg');
const BACKUP_DIR = resolve(process.env.BACKUP_DIR || './backups');
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';

if (!process.env.JWT_SECRET) console.warn('⚠ JWT_SECRET غير مضبوط — يُستخدم سر تطوير. اضبطه في .env قبل الاستخدام الفعلي.');

if (!DATABASE_URL) await mkdir(PGLITE_DIR, { recursive: true });
const db = await openDb({ url: DATABASE_URL, dataDir: PGLITE_DIR });
await migrate(db, { backupDir: BACKUP_DIR, log: console.log });
await seed(db, { adminPassword: process.env.ADMIN_INITIAL_PASSWORD });

const app = await buildApp({ db, jwtSecret: JWT_SECRET, backupDir: BACKUP_DIR, webDist: path.join(root, 'apps/web/dist') });
await app.listen({ port: PORT, host: '0.0.0.0' });
console.log(`✓ الخادم يعمل على http://localhost:${PORT} (قاعدة البيانات: ${db.kind === 'pglite' ? `PGlite في ${PGLITE_DIR}` : 'PostgreSQL'})`);

const shutdown = async () => {
  await app.close();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
