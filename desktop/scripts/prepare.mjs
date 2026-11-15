// تجهيز ملفات برنامج الويندوز قبل التشغيل أو عمل ملف التسطيب:
//   desktop/app/server.mjs  ← الخادم كله في ملف واحد (Fastify + قاعدة البيانات المحلية PGlite)
//   desktop/app/web/        ← الواجهة (apps/web/dist)
// الواجهة لازم تكون متبنية الأول: من فولدر المشروع  npm run build
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(desktop, '..');
const web = path.join(root, 'apps/web/dist');
if (!existsSync(path.join(web, 'index.html'))) throw new Error('ابنِ الواجهة الأول: من فولدر المشروع  npm run build');

const out = path.join(desktop, 'app');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

cpSync(web, path.join(out, 'web'), { recursive: true });

await build({
  entryPoints: [path.join(root, 'apps/server/src/desktop.ts')],
  outfile: path.join(out, 'server.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: false,
  legalComments: 'none',
  // PGlite بتقرا ملفات wasm من جنبها، فبتتسطب كمكتبة عادية في desktop/node_modules؛ pg (PostgreSQL) مش مستخدمة هنا
  external: ['@electric-sql/pglite', 'pg-native'],
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; import { fileURLToPath as __fu } from 'node:url'; import { dirname as __dn } from 'node:path'; const require = __cr(import.meta.url); const __filename = __fu(import.meta.url); const __dirname = __dn(__filename);",
  },
  logLevel: 'warning',
});
console.log('✓ desktop/app جاهز (server.mjs + web)');
