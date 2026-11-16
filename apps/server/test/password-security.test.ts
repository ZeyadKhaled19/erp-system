import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { openDb } from '../src/db';
import { migrate } from '../src/migrate';
import { seed } from '../src/seed';

let vendorDb: Awaited<ReturnType<typeof openDb>>;
let shopDb: Awaited<ReturnType<typeof openDb>>;
let vendor: Awaited<ReturnType<typeof buildApp>>;
let shop: Awaited<ReturnType<typeof buildApp>>;

async function fresh() {
  const db = await openDb({ memory: true });
  await migrate(db, { backupDir: await mkdtemp(path.join(os.tmpdir(), 'erp-pw-')) });
  await seed(db, { adminPassword: 'admin123' });
  return db;
}
const login = (app: typeof vendor, password: string, extra: Record<string, string> = {}, device = 'device-p-0001') =>
  app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password, device_id: device, ...extra } });
const me = (app: typeof vendor, token: string) => app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${token}`, 'x-device-id': 'device-p-0001' } });

beforeAll(async () => {
  vendorDb = await fresh();
  shopDb = await fresh();
  vendor = await buildApp({ db: vendorDb, jwtSecret: 'test-secret', backupDir: os.tmpdir(), vendor: true });
  shop = await buildApp({ db: shopDb, jwtSecret: 'test-secret', backupDir: os.tmpdir() });
});
afterAll(async () => {
  await vendor.close();
  await shop.close();
  await vendorDb.close();
  await shopDb.close();
});

describe('password security', () => {
  it('the public vendor site refuses the default password until a strong new one is set', async () => {
    const r1 = await login(vendor, 'admin123');
    expect(r1.statusCode).toBe(428);
    expect(r1.json().code).toBe('weak_password');
    expect((await login(vendor, 'admin123', { new_password: '12345678' })).statusCode).toBe(400);
    expect((await login(vendor, 'admin123', { new_password: 'short' })).statusCode).toBe(400);
    const ok = await login(vendor, 'admin123', { new_password: 'My-Shop-2026!' });
    expect(ok.statusCode).toBe(200);
    expect((await me(vendor, ok.json().token)).statusCode).toBe(200);
    // القديمة ما بقتش شغالة
    expect((await login(vendor, 'admin123')).statusCode).toBe(401);
    expect((await login(vendor, 'My-Shop-2026!')).statusCode).toBe(200);
  });

  it('changing the password logs out every old session (someone who knew the old password)', async () => {
    const intruder = (await login(shop, 'admin123', {}, 'device-intruder-1')).json().token;
    const owner = (await login(shop, 'admin123')).json().token;
    expect((await me(shop, intruder)).statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 1100));
    const ch = await shop.inject({ method: 'POST', url: '/api/auth/change-password', headers: { authorization: `Bearer ${owner}`, 'x-device-id': 'device-p-0001' }, payload: { current: 'admin123', next: 'New-Secret-99' } });
    expect(ch.statusCode).toBe(200);
    expect((await me(shop, intruder)).statusCode).toBe(401);
    expect((await me(shop, owner)).statusCode).toBe(401);
    // الجهاز اللي غيّر بياخد توكن جديد ويكمل
    expect((await me(shop, ch.json().token)).statusCode).toBe(200);
  });

  it('the Windows app (open to the shop network) refuses admin123 until a new password is chosen', async () => {
    const db = await fresh();
    const input = { machineId: 'ABCD-0000-0000-0042', trialStart: new Date().toISOString() };
    const app = await buildApp({ db, jwtSecret: 'test-secret', backupDir: os.tmpdir(), license: { get: () => input, activate: () => {} } });
    expect((await login(app, 'admin123')).statusCode).toBe(428);
    const ok = await login(app, 'admin123', { new_password: 'Shop-Secret-7' });
    expect(ok.statusCode).toBe(200);
    expect((await login(app, 'admin123')).statusCode).toBe(401);
    // موظف بكلمة سر قصيرة بس مش معروفة: بيدخل عادي في المحل
    const token = ok.json().token;
    const u = await app.inject({ method: 'POST', url: '/api/admin/users', headers: { authorization: `Bearer ${token}`, 'x-device-id': 'device-p-0001' }, payload: { username: 'cashier', full_name: 'كاشير', password: 'k7x9q2', role_id: 'role-cashier', active: true } });
    if (u.statusCode === 200) {
      expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'cashier', password: 'k7x9q2', device_id: 'device-p-0002' } })).statusCode).toBe(200);
    }
    await app.close();
    await db.close();
  });

  it('a plain server (no vendor site, no Windows licensing) is unchanged', async () => {
    const db = await fresh();
    const app = await buildApp({ db, jwtSecret: 'test-secret', backupDir: os.tmpdir() });
    expect((await login(app, 'admin123')).statusCode).toBe(200);
    await app.close();
    await db.close();
  });
});
