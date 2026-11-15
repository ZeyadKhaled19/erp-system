import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportData, pruneDailyBackups, restoreFromFile, startAutoBackups } from '../src/backup';
import { setup } from './helpers';

let env: Awaited<ReturnType<typeof setup>>;

beforeAll(async () => {
  env = await setup();
});
afterAll(async () => {
  await env.app.close();
  await env.db.close();
});

const waitFor = async (fn: () => Promise<boolean>) => {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('timeout');
};

describe('daily automatic backups', () => {
  it('takes one at start-up, copies it to the second folder, and skips when a fresh one exists', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'erp-auto-'));
    const copyDir = await mkdtemp(path.join(os.tmpdir(), 'erp-copy-'));
    const stop = startAutoBackups(env.db, { dir, copyDir });
    await waitFor(async () => (await readdir(copyDir)).some((f) => f.endsWith('-daily.json')));
    stop();
    expect((await readdir(dir)).filter((f) => f.endsWith('-daily.json'))).toHaveLength(1);

    // نسخة جديدة موجودة: تشغيل تاني ما يعملش نسخة زيادة
    const stop2 = startAutoBackups(env.db, { dir });
    await new Promise((r) => setTimeout(r, 400));
    stop2();
    expect((await readdir(dir)).filter((f) => f.endsWith('-daily.json'))).toHaveLength(1);
  });

  it('keeps only the newest daily backups and never touches manual ones', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'erp-prune-'));
    for (let d = 1; d <= 5; d++) await writeFile(path.join(dir, `erp-backup-2026-11-0${d}T00-00-00-000Z-daily.json`), '{}');
    await writeFile(path.join(dir, 'erp-backup-2026-10-01T00-00-00-000Z-manual.json'), '{}');
    await pruneDailyBackups(dir, 3);
    expect((await readdir(dir)).sort()).toEqual([
      'erp-backup-2026-10-01T00-00-00-000Z-manual.json',
      'erp-backup-2026-11-03T00-00-00-000Z-daily.json',
      'erp-backup-2026-11-04T00-00-00-000Z-daily.json',
      'erp-backup-2026-11-05T00-00-00-000Z-daily.json',
    ]);
  });

  it('restores from a gzip-compressed backup file', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'erp-gz-'));
    const file = path.join(dir, 'download.json.gz');
    const before = (await env.db.one(`select count(*)::int as c from accounts`)).c;
    await writeFile(file, gzipSync(Buffer.from(JSON.stringify(await exportData(env.db)))));
    await restoreFromFile(env.db, file);
    expect((await env.db.one(`select count(*)::int as c from accounts`)).c).toBe(before);
  });
});
