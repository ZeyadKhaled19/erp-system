import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { openDb } from './db';
import { migrate } from './migrate';
import { seed } from './seed';

/**
 * نقطة دخول الخادم على Vercel (Serverless Function).
 * - نفس تطبيق Fastify المحلي بالضبط، يُبنى مرة لكل نسخة تشغيل ويُعاد استخدامه.
 * - قاعدة البيانات PostgreSQL عبر DATABASE_URL (مثل Neon)، مع اتصالات قليلة لأن النسخ كثيرة.
 * - الـ migrations والبيانات الأولية تُطبق تلقائيًا عند أول تشغيل (مع قفل حتى لا يطبقها خادمان معًا).
 * - النسخ الاحتياطية على Vercel تُنزَّل مباشرة (لا يوجد قرص دائم)، والنسخ الدورية من مزود قاعدة البيانات.
 */
let ready: Promise<FastifyInstance> | null = null;

async function init() {
  const url = process.env.DATABASE_URL;
  const secret = process.env.JWT_SECRET;
  if (!url) throw new Error('DATABASE_URL غير مضبوط في إعدادات Vercel');
  if (!secret || secret.length < 32) throw new Error('JWT_SECRET غير مضبوط أو قصير (32 حرفًا على الأقل) في إعدادات Vercel');
  const db = await openDb({ url, maxConnections: 3 });
  await migrate(db, { log: console.log });
  await seed(db, { adminPassword: process.env.ADMIN_INITIAL_PASSWORD });
  const app = await buildApp({ db, jwtSecret: secret, backupDir: '/tmp/erp-backups', ephemeralBackups: true });
  await app.ready();
  return app;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  // المسار الأصلي يصل كـ ?__path=... من قاعدة التوجيه (/api/x → /api?__path=x)
  const u = new URL(req.url ?? '/', 'http://local');
  const p = u.searchParams.get('__path');
  if (p !== null) {
    u.searchParams.delete('__path');
    const qs = u.searchParams.toString();
    req.url = `/api/${p}${qs ? `?${qs}` : ''}`;
  }
  try {
    ready ??= init().catch((e) => {
      ready = null;
      throw e;
    });
    const app = await ready;
    app.server.emit('request', req, res);
  } catch (e) {
    console.error(e);
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: `الخادم غير جاهز: ${(e as Error).message}` }));
  }
}
