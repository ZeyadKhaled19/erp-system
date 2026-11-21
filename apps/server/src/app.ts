import 'reflect-metadata';
import { existsSync } from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { AppModule } from './app.module';
import { AllExceptionsFilter, schemaPipe } from './core/http';
import type { Db } from './db';
import type { LicenseGate } from './licensing';
import { LicensingService } from './modules/licensing/licensing.service';

export interface AppOptions {
  db: Db;
  jwtSecret: string;
  backupDir: string;
  webDist?: string;
  logger?: boolean;
  /** خادم بلا قرص دائم (Vercel): لا تُحفظ نسخ على الخادم، والنسخة تُنزَّل مباشرة على جهاز المستخدم */
  ephemeralBackups?: boolean;
  /** برنامج الويندوز: التجربة 7 أيام والقفل وكود التفعيل */
  license?: LicenseGate;
  /** موقع صاحب السيستم: صفحة «جرّب مجانًا» وصفحة التراخيص */
  vendor?: boolean;
  /** مفتاح توقيع أكواد التفعيل (على موقع صاحب السيستم بس) */
  licensePrivateKey?: string;
  /** لينك تحميل برنامج الويندوز (اختياري) */
  downloadUrl?: string;
  /** موقع صاحب السيستم (برنامج الويندوز بيسجل التجربة عليه) */
  vendorUrl?: string;
}

/**
 * Builds the HTTP server: a NestJS application on the Fastify adapter.
 *
 * It returns the underlying Fastify instance, so every caller keeps the same contract as before
 * NestJS: local.ts calls listen()/close(), vercel.ts emits requests on .server, and the tests use
 * inject(). Routes live in src/modules/*; the business rules they call (posting, sync, reports)
 * are unchanged in src/posting, src/ops.ts, src/sync.ts and src/reports.ts.
 */
export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const adapter = new FastifyAdapter({ logger: opts.logger ?? false, bodyLimit: 20 * 1024 * 1024 });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.register(opts), adapter, { logger: false, abortOnError: false });
  const fastify = app.getHttpAdapter().getInstance() as unknown as FastifyInstance;
  const log = (e: unknown) => fastify.log.error(e);
  const serveWeb = !!(opts.webDist && existsSync(opts.webDist));

  app.enableCors({ origin: true });
  app.useGlobalPipes(schemaPipe());
  app.useGlobalFilters(new AllExceptionsFilter(serveWeb, log));
  // برنامج الويندوز: القفل قبل أي توجيه أو تسجيل دخول، علشان يشمل كل طلبات /api حتى من أجهزة الشبكة
  if (opts.license) fastify.addHook('onRequest', app.get(LicensingService).lockHook);

  // ---------------- الواجهة (PWA) ----------------
  if (serveWeb) {
    await app.register(fastifyStatic as any, {
      root: path.resolve(opts.webDist!),
      // wildcard: يخدم الملفات من القرص مباشرة، فلا يحتاج الخادم إعادة تشغيل بعد إعادة بناء الواجهة
      wildcard: true,
      // ملفات assets تحمل بصمة في اسمها فتُخزّن طويلًا؛ index.html و sw.js يجب أن يُتحقق منهما دائمًا
      // @fastify/static 10 passes the Fastify reply (v8 passed the raw response)
      setHeaders(reply: { header(k: string, v: string): unknown }, filePath: string) {
        if (/[\\/]assets[\\/]/.test(filePath)) reply.header('cache-control', 'public, max-age=31536000, immutable');
        else reply.header('cache-control', 'no-cache');
      },
    });
  } else {
    // reply.sendFile لتنزيل النسخ الاحتياطية، من غير ما يخدم أي ملفات
    await app.register(fastifyStatic as any, { root: path.resolve(opts.backupDir), serve: false });
  }

  // Nest installs Fastify's error and not-found handlers itself and routes both through AllExceptionsFilter
  await app.init();
  await fastify.ready();
  return fastify;
}
