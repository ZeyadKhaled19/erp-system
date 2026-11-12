// بناء النشر على Vercel بصيغة Build Output API v3 (مخرجات جاهزة، لا تعتمد على اكتشاف Vercel التلقائي):
//   .vercel/output/static/              ← واجهة PWA (apps/web/dist)
//   .vercel/output/functions/api.func/  ← الخادم كله في ملف واحد (Fastify + PostgreSQL)
//   .vercel/output/config.json          ← التوجيه: /api/* للخادم، والباقي ملفات ثم index.html
// الاستخدام (يشغله Vercel تلقائيًا عبر vercel.json):  npm run build:vercel
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.vercel/output');
const web = path.join(root, 'apps/web/dist');
if (!existsSync(path.join(web, 'index.html'))) throw new Error('ابنِ الواجهة أولًا: npm run build');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// 1) الواجهة
cpSync(web, path.join(out, 'static'), { recursive: true });

// 2) الخادم: حزمة ESM واحدة تعمل على Node في Vercel
const fn = path.join(out, 'functions/api.func');
mkdirSync(fn, { recursive: true });
await build({
  entryPoints: [path.join(root, 'apps/server/src/vercel.ts')],
  outfile: path.join(fn, 'index.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: false,
  legalComments: 'none',
  // PGlite للتشغيل المحلي فقط (تُحمّل عند الحاجة ولا تُستخدم على Vercel)، وpg-native اختياري
  external: ['@electric-sql/pglite', 'pg-native'],
  // مكتبات CommonJS داخل حزمة ESM تحتاج require و __dirname
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; import { fileURLToPath as __fu } from 'node:url'; import { dirname as __dn } from 'node:path'; const require = __cr(import.meta.url); const __filename = __fu(import.meta.url); const __dirname = __dn(__filename);",
  },
  logLevel: 'warning',
});
writeFileSync(
  path.join(fn, '.vc-config.json'),
  JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 60 }, null, 2),
);

// 3) التوجيه والتخزين المؤقت
const config = {
  version: 3,
  routes: [
    // ملفات assets تحمل بصمة في اسمها: تخزين طويل. index.html و sw.js والـ manifest: تحقق دائم حتى تصل التحديثات
    { src: '^/assets/(.*)$', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
    { src: '^/(sw\\.js|index\\.html|manifest\\.webmanifest|registerSW\\.js|workbox-.*\\.js)$', headers: { 'cache-control': 'no-cache' }, continue: true },
    // الخادم: كل /api/* إلى دالة واحدة، والمسار الأصلي في __path
    { src: '^/api/(.*)$', dest: '/api?__path=$1' },
    { handle: 'filesystem' },
    // ملف غير موجود (مثل سكربت قديم) = 404 وليس صفحة التطبيق
    { src: '^/(assets/.*|.*\\.[a-zA-Z0-9]{2,5})$', status: 404 },
    // أي مسار آخر في التطبيق (مثل /pos أو /reports/daily) يفتح الواجهة
    { src: '^/(.*)$', dest: '/index.html', headers: { 'cache-control': 'no-cache' } },
  ],
};
writeFileSync(path.join(out, 'config.json'), JSON.stringify(config, null, 2));
console.log('✓ .vercel/output جاهز (static + functions/api.func)');
