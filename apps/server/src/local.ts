import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { buildApp } from './app';
import { startAutoBackups, type AutoBackups } from './backup';
import { openDb } from './db';
import { migrate } from './migrate';
import { seed } from './seed';

/**
 * تشغيل الخادم المحلي (جهاز المحل): قاعدة البيانات + الواجهة + النسخ التلقائي.
 * بيستخدمه `index.ts` (تشغيل عادي) و`desktop.ts` (جوه برنامج الويندوز).
 */
export interface LocalServerOptions {
  port: number;
  /** فولدر قاعدة البيانات المحلية (PGlite)؛ يتجاهل لو `databaseUrl` موجود */
  dataDir: string;
  databaseUrl?: string;
  backupDir: string;
  webDist: string;
  jwtSecret: string;
  adminPassword?: string;
  autoBackup?: boolean;
  backupCopyDir?: string;
  backupEveryMinutes?: number;
  backupKeep?: number;
  backupKeepHourly?: number;
  log?: (m: string) => void;
}

export interface LocalServer {
  backups: AutoBackups | null;
  close: () => Promise<void>;
}

export async function startLocalServer(o: LocalServerOptions): Promise<LocalServer> {
  const log = o.log ?? console.log;
  if (!o.databaseUrl) await mkdir(o.dataDir, { recursive: true });
  const db = await openDb({ url: o.databaseUrl, dataDir: o.dataDir });
  await migrate(db, { backupDir: o.backupDir, log });
  await seed(db, { adminPassword: o.adminPassword });

  const app = await buildApp({ db, jwtSecret: o.jwtSecret, backupDir: o.backupDir, webDist: o.webDist });
  await app.listen({ port: o.port, host: '0.0.0.0' });
  log(`✓ الخادم يعمل على http://localhost:${o.port} (قاعدة البيانات: ${db.kind === 'pglite' ? `PGlite في ${o.dataDir}` : 'PostgreSQL'})`);

  const backups = o.autoBackup === false
    ? null
    : startAutoBackups(db, {
        dir: o.backupDir,
        copyDir: o.backupCopyDir,
        everyMinutes: o.backupEveryMinutes,
        keep: o.backupKeep,
        keepHourly: o.backupKeepHourly,
        log,
      });

  let closed = false;
  return {
    backups,
    close: async () => {
      if (closed) return;
      closed = true;
      backups?.stop();
      // الخادم بيستنى الاتصالات المفتوحة (زي شباك البرنامج) تخلص؛ ما نستناش أكتر من ثانيتين، وبعدين نقفل قاعدة البيانات بأمان
      await Promise.race([app.close(), new Promise((r) => setTimeout(r, 2000))]);
      await db.close();
    },
  };
}

/** الإعدادات من متغيرات البيئة (ملف .env) */
export function optionsFromEnv(root: string): LocalServerOptions {
  const resolve = (p: string) => (path.isAbsolute(p) ? p : path.resolve(root, p));
  const env = process.env;
  return {
    port: Number(env.PORT ?? 4000),
    databaseUrl: env.DATABASE_URL || undefined,
    dataDir: resolve(env.PGLITE_DIR || './data/pg'),
    backupDir: resolve(env.BACKUP_DIR || './backups'),
    webDist: path.join(root, 'apps/web/dist'),
    jwtSecret: env.JWT_SECRET || 'dev-only-secret-change-me',
    adminPassword: env.ADMIN_INITIAL_PASSWORD,
    autoBackup: env.AUTO_BACKUP !== '0',
    backupCopyDir: env.BACKUP_COPY_DIR ? resolve(env.BACKUP_COPY_DIR) : undefined,
    backupEveryMinutes: Number(env.BACKUP_EVERY_MINUTES) || 60,
    backupKeep: Number(env.BACKUP_KEEP) || 30,
    backupKeepHourly: Number(env.BACKUP_KEEP_HOURLY) || 48,
  };
}
