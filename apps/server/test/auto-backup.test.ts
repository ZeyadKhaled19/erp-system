import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { backupFileTime, exportData, pruneBackups, restoreFromFile, startAutoBackups } from '../src/backup';
import { item, setup, type Client } from './helpers';

let env: Awaited<ReturnType<typeof setup>>;
let A: Client;

beforeAll(async () => {
  env = await setup();
  A = await env.login();
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
const count = async (dir: string, reason: string) => (await readdir(dir)).filter((f) => f.endsWith(`-${reason}.json`)).length;

describe('automatic backups', () => {
  it('takes the day\'s first backup as "daily" at start-up and copies it to the second folder', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'erp-auto-'));
    const copyDir = await mkdtemp(path.join(os.tmpdir(), 'erp-copy-'));
    const b = startAutoBackups(env.db, { dir, copyDir });
    await waitFor(async () => (await count(copyDir, 'daily')) === 1);
    b.stop();
    expect(await count(dir, 'daily')).toBe(1);

    // نفس اليوم بعد إعادة التشغيل: ما يعملش «daily» تاني
    const b2 = startAutoBackups(env.db, { dir });
    await new Promise((r) => setTimeout(r, 400));
    b2.stop();
    expect(await count(dir, 'daily')).toBe(1);
  });

  it('backs up on close only when the data changed since the last backup', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'erp-close-'));
    const b = startAutoBackups(env.db, { dir });
    await waitFor(async () => (await count(dir, 'daily')) === 1);

    const same = await b.backupNow({ reason: 'on-close', onlyIfChanged: true });
    expect(same).toEqual({ file: null, skipped: true });

    expect((await A.op(item('ab-item', 'AB1', 'صنف النسخ'))).status).toBe('accepted');
    const changed = await b.backupNow({ reason: 'on-close', onlyIfChanged: true });
    expect(changed.skipped).toBe(false);
    expect(path.basename(changed.file!)).toMatch(/-on-close\.json$/);
    b.stop();
  });

  it('keeps only the newest of each kind and never touches manual ones', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'erp-prune-'));
    for (let d = 1; d <= 5; d++) {
      await writeFile(path.join(dir, `erp-backup-2026-11-0${d}T00-00-00-000Z-daily.json`), '{}');
      await writeFile(path.join(dir, `erp-backup-2026-11-0${d}T05-00-00-000Z-hourly.json`), '{}');
    }
    await writeFile(path.join(dir, 'erp-backup-2026-10-01T00-00-00-000Z-manual.json'), '{}');
    await pruneBackups(dir, 'daily', 3);
    await pruneBackups(dir, 'hourly', 2);
    const left = (await readdir(dir)).sort();
    expect(left.filter((f) => f.endsWith('-daily.json'))).toHaveLength(3);
    expect(left.filter((f) => f.endsWith('-hourly.json'))).toEqual(['erp-backup-2026-11-04T05-00-00-000Z-hourly.json', 'erp-backup-2026-11-05T05-00-00-000Z-hourly.json']);
    expect(left).toContain('erp-backup-2026-10-01T00-00-00-000Z-manual.json');
  });

  it('reads the time from a backup file name', () => {
    expect(backupFileTime('erp-backup-2026-11-15T11-02-04-282Z-daily.json')?.toISOString()).toBe('2026-11-15T11:02:04.282Z');
    expect(backupFileTime('something-else.json')).toBeNull();
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
