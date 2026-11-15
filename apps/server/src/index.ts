import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { optionsFromEnv, startLocalServer } from './local';

// التشغيل العادي على جهاز المحل (npm run start). الإعدادات من ملف .env — شوف local.ts
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const opts = optionsFromEnv(root);
if (!process.env.JWT_SECRET) console.warn('⚠ JWT_SECRET غير مضبوط — يُستخدم سر تطوير. اضبطه في .env قبل الاستخدام الفعلي.');

const server = await startLocalServer(opts);

const shutdown = async () => {
  await server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
