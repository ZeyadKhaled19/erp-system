// يجمع ملفات migrations في ملف TypeScript واحد حتى تُضمَّن داخل حزمة الخادم (Vercel وغيره)
// شغّله بعد إضافة أو تعديل أي ملف في apps/server/src/migrations:  node scripts/gen-migrations.mjs
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../apps/server/src/migrations');
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const body = files.map((f) => `  { name: ${JSON.stringify(f)}, sql: ${JSON.stringify(readFileSync(path.join(dir, f), 'utf8'))} },`).join('\n');
const out = `// ملف مولَّد تلقائيًا من apps/server/src/migrations — لا تعدّله يدويًا (node scripts/gen-migrations.mjs)\nexport const MIGRATIONS: { name: string; sql: string }[] = [\n${body}\n];\n`;
writeFileSync(path.resolve(dir, '../migrations.bundle.ts'), out);
console.log(`migrations.bundle.ts: ${files.length} files`);
