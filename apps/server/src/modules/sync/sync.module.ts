import { Body, Controller, Get, HttpCode, Inject, Module, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db';
import { applyOp } from '../../ops';
import { pull } from '../../sync';
import { DB } from '../../core/tokens';

/** كل عملية بتتفحص بالتفصيل جوه applyOp (opEnvelopeSchema) علشان المرفوضة تتسجل برقمها وما تتكررش */
const pushSchema = z.object({ ops: z.array(z.any()).max(500) });

/**
 * المزامنة: الأجهزة بترفع طابور العمليات بالترتيب وبتسحب التغييرات من آخر cursor.
 * applyOp هو اللي بيضمن إن نفس op_id ما يتنفذش مرتين، وكل عملية في معاملة واحدة.
 */
@Controller('api/sync')
export class SyncController {
  constructor(@Inject(DB) private db: Db) {}

  @Post('push')
  @HttpCode(200)
  async push(@Req() req: FastifyRequest, @Body({ schema: pushSchema }) b: z.infer<typeof pushSchema>) {
    await this.db.query(`update devices set last_seen = now() where id = $1`, [req.deviceId]);
    const results = [];
    // التنفيذ بالترتيب: عميل/صنف أُنشئ دون اتصال يُرفع قبل الفاتورة التي تستخدمه
    for (const env of b.ops) results.push(await applyOp(this.db, req.user!, req.deviceId!, env));
    return { results };
  }

  @Get('pull')
  pull(@Req() req: FastifyRequest, @Query('cursor') cursor?: string) {
    return pull(this.db, Number(cursor ?? 0) || 0, req.user!);
  }
}

@Module({ controllers: [SyncController] })
export class SyncModule {}
