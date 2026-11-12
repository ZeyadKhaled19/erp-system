import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../src/migrations.bundle';

// الخادم (محليًا وعلى Vercel) يطبق الـ migrations من الملف المضمّن؛ يجب أن يطابق مجلد migrations دائمًا
describe('migrations bundle', () => {
  it('matches apps/server/src/migrations (run: node scripts/gen-migrations.mjs)', () => {
    const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/migrations');
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    expect(MIGRATIONS.map((m) => m.name)).toEqual(files);
    for (const m of MIGRATIONS) expect(m.sql).toBe(readFileSync(path.join(dir, m.name), 'utf8'));
  });
});
