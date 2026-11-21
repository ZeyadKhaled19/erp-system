import { Body, Controller, Get, HttpCode, Inject, Injectable, Module, Param, Post, Req, Res } from '@nestjs/common';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { backupToFile, exportData, listBackups, restoreFromFile } from '../../backup';
import type { Db } from '../../db';
import { AppError } from '../../errors';
import { Perm } from '../../core/access';
import { APP_OPTIONS, type AppOptions, DB } from '../../core/tokens';

const FILE_RE = /^erp-backup-[\w.-]+\.json$/;
const restoreSchema = z.object({ file: z.string().regex(FILE_RE, 'اسم ملف غير صالح') });

/**
 * النسخ الاحتياطي من الشاشة. النسخ التلقائية (كل ساعة) مش هنا: بتشتغل في local.ts على جهاز المحل وبرنامج الويندوز بس،
 * لأن Vercel ملوش قرص دائم (ephemeralBackups) والنسخة هناك بتتنزل على جهاز المستخدم.
 */
@Injectable()
export class BackupsService {
  constructor(@Inject(DB) private db: Db, @Inject(APP_OPTIONS) private opts: AppOptions) {}

  async list() {
    return { files: this.opts.ephemeralBackups ? [] : await listBackups(this.opts.backupDir), ephemeral: !!this.opts.ephemeralBackups };
  }

  /** نسخة كاملة مضغوطة تُنزَّل مباشرة على جهاز المستخدم (تعمل على أي خادم، والوحيدة المتاحة على Vercel) */
  async download(userId: string, deviceId: string | undefined) {
    const data = await exportData(this.db, 'download');
    const name = `erp-backup-${new Date().toISOString().replace(/[:.]/g, '-')}-download.json`;
    await this.db.query(`insert into audit_log (user_id, device_id, action, details) values ($1,$2,'backup.download',$3)`, [userId, deviceId, JSON.stringify({ file: name })]);
    return { name, body: gzipSync(Buffer.from(JSON.stringify(data))) };
  }

  async create(userId: string, deviceId: string | undefined) {
    if (this.opts.ephemeralBackups) throw new AppError('هذا الخادم لا يحفظ نسخًا عليه؛ استخدم «تنزيل نسخة على جهازي»', 'state');
    const file = await backupToFile(this.db, this.opts.backupDir, 'manual');
    await this.db.query(`insert into audit_log (user_id, device_id, action, details) values ($1,$2,'backup.create',$3)`, [userId, deviceId, JSON.stringify({ file: path.basename(file) })]);
    return { file: path.basename(file) };
  }

  async restore(userId: string, deviceId: string | undefined, file: string) {
    const full = path.join(this.opts.backupDir, file);
    if (!existsSync(full)) throw new AppError('الملف غير موجود', 'not_found');
    // نسخة من الوضع الحالي قبل الاستعادة حتى يمكن التراجع
    const safety = await backupToFile(this.db, this.opts.backupDir, 'pre-restore');
    const r = await restoreFromFile(this.db, full);
    await this.db.query(`insert into audit_log (user_id, device_id, action, details) values ($1,$2,'backup.restore',$3)`, [
      userId, deviceId, JSON.stringify({ file, safety: path.basename(safety), rows: r.rows }),
    ]);
    return { ok: true, rows: r.rows, safety_backup: path.basename(safety) };
  }
}

@Controller('api/admin')
export class BackupsController {
  constructor(@Inject(BackupsService) private backups: BackupsService, @Inject(APP_OPTIONS) private opts: AppOptions) {}

  @Perm('backup.manage')
  @Get('backups')
  list() {
    return this.backups.list();
  }

  @Perm('backup.manage')
  @Get('backup-download')
  async download(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    const { name, body } = await this.backups.download(req.user!.id, req.deviceId);
    reply.header('content-type', 'application/json; charset=utf-8');
    reply.header('content-encoding', 'gzip');
    reply.header('content-disposition', `attachment; filename="${name}"`);
    return reply.send(body);
  }

  @Perm('backup.manage')
  @Post('backups')
  @HttpCode(200)
  create(@Req() req: FastifyRequest) {
    return this.backups.create(req.user!.id, req.deviceId);
  }

  @Perm('backup.manage')
  @Post('backups/restore')
  @HttpCode(200)
  restore(@Req() req: FastifyRequest, @Body({ schema: restoreSchema }) b: z.infer<typeof restoreSchema>) {
    return this.backups.restore(req.user!.id, req.deviceId, b.file);
  }

  @Perm('backup.manage')
  @Get('backups/:file')
  file(@Param('file') file: string, @Res() reply: FastifyReply) {
    if (!FILE_RE.test(file)) throw new AppError('اسم ملف غير صالح');
    reply.header('content-disposition', `attachment; filename="${file}"`);
    return reply.sendFile(file, path.resolve(this.opts.backupDir));
  }
}

@Module({ controllers: [BackupsController], providers: [BackupsService] })
export class BackupsModule {}
