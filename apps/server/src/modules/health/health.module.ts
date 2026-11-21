import { Controller, Get, Inject, Module } from '@nestjs/common';
import type { Db } from '../../db';
import { Public } from '../../core/access';
import { DB } from '../../core/tokens';

/** فحص الحياة والجاهزية: الخادم شغال وقاعدة البيانات بترد (نفس الرد اللي سكربتات التحديث بتستناه) */
@Controller('api/health')
export class HealthController {
  constructor(@Inject(DB) private db: Db) {}

  @Public()
  @Get()
  async health() {
    await this.db.one('select 1');
    return { ok: true, time: new Date().toISOString(), db: this.db.kind };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
